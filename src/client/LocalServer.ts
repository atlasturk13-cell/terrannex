import { ClientEnv } from "src/client/ClientEnv";
import { z } from "zod";
import { EventBus } from "../core/EventBus";
import { UserSettings } from "../core/game/UserSettings";
import {
  AllPlayersStats,
  ClientID,
  ClientMessage,
  ClientSendWinnerMessage,
  PartialGameRecord,
  PartialGameRecordSchema,
  PlayerRecord,
  ServerMessage,
  ServerStartGameMessage,
  StampedIntent,
  Turn,
} from "../core/Schemas";
import {
  createPartialGameRecord,
  decompressGameRecord,
  replacer,
} from "../core/Util";
import { getApiBase } from "./Api";
import { getAuthHeader, getPersistentID } from "./Auth";
import { LobbyConfig } from "./ClientGameRunner";
import {
  GameSpeedDownIntentEvent,
  GameSpeedUpIntentEvent,
  ReplaySpeedChangeEvent,
  RequestReplaySpeedEvent,
} from "./InputHandler";
import {
  defaultReplaySpeedMultiplier,
  ReplaySpeedMultiplier,
} from "./utilities/ReplaySpeedMultiplier";

// Live local games expose bounded pacing; unbounded catch-up remains replay-only.
const LIVE_SPEED_ORDER: ReplaySpeedMultiplier[] = [
  ReplaySpeedMultiplier.slow,
  ReplaySpeedMultiplier.normal,
  ReplaySpeedMultiplier.fast,
];

// build a small backlog so MAX can catch up.
const MAX_REPLAY_BACKLOG_TURNS = 60;

declare const localConnectionHandleBrand: unique symbol;
export type LocalConnectionHandle = {
  readonly [localConnectionHandleBrand]: true;
};

interface LocalConnection {
  handle: LocalConnectionHandle;
  clientID: ClientID;
  clientConnect: () => void;
  clientMessage: (message: ServerMessage) => void;
  initialStartSent: boolean;
  acknowledgedTurns: number;
  deliveredTurns: number;
}

export class LocalServer {
  // All turns from the game record on replay.
  private replayTurns: Turn[] = [];

  private turns: Turn[] = [];

  private intents: StampedIntent[] = [];
  private startedAt: number;

  private paused = false;
  private replaySpeedMultiplier = defaultReplaySpeedMultiplier;

  private clientID: ClientID | undefined;
  private winner: ClientSendWinnerMessage | null = null;
  private allPlayersStats: AllPlayersStats = {};
  // Set only once an upload got a 2xx, so endGame() retries failed or
  // skipped win-time uploads during teardown.
  private archived = false;
  private archiveInFlight = false;

  private turnStartTime = 0;

  private turnCheckInterval: NodeJS.Timeout | undefined;
  private connections = new Map<ClientID, LocalConnection>();
  private connectionsByHandle = new WeakMap<
    LocalConnectionHandle,
    LocalConnection
  >();
  private handleConnectionsUsed = false;
  private connectingLegacy = false;
  private legacyConnectionHandle: LocalConnectionHandle | undefined;
  private pendingDefaultCallbacks:
    | {
        clientConnect: () => void;
        clientMessage: (message: ServerMessage) => void;
      }
    | undefined;
  private started = false;
  private speedListenersBound = false;

  private readonly handleReplaySpeedChange = (
    event: ReplaySpeedChangeEvent,
  ) => {
    this.replaySpeedMultiplier =
      !this.isReplay &&
      event.replaySpeedMultiplier === ReplaySpeedMultiplier.fastest
        ? ReplaySpeedMultiplier.fast
        : event.replaySpeedMultiplier;
  };

  private readonly handleReplaySpeedRequest = () => {
    this.eventBus.emit(new ReplaySpeedChangeEvent(this.replaySpeedMultiplier));
  };

  private readonly handleGameSpeedUp = () => {
    const idx = LIVE_SPEED_ORDER.indexOf(this.replaySpeedMultiplier);
    if (idx < 0 || idx >= LIVE_SPEED_ORDER.length - 1) return;
    this.replaySpeedMultiplier = LIVE_SPEED_ORDER[idx + 1];
    this.eventBus.emit(new ReplaySpeedChangeEvent(this.replaySpeedMultiplier));
  };

  private readonly handleGameSpeedDown = () => {
    const idx = LIVE_SPEED_ORDER.indexOf(this.replaySpeedMultiplier);
    if (idx <= 0) return;
    this.replaySpeedMultiplier = LIVE_SPEED_ORDER[idx - 1];
    this.eventBus.emit(new ReplaySpeedChangeEvent(this.replaySpeedMultiplier));
  };

  constructor(
    private lobbyConfig: LobbyConfig,
    private isReplay: boolean,
    private eventBus: EventBus,
  ) {
    this.replaySpeedMultiplier = isReplay
      ? defaultReplaySpeedMultiplier
      : (new UserSettings().localGameSpeed() as ReplaySpeedMultiplier);
  }

  public updateCallback(
    clientConnect: () => void,
    clientMessage: (message: ServerMessage) => void,
  ) {
    if (this.handleConnectionsUsed) {
      throw new Error(
        "legacy local callbacks cannot be mixed with handle connections",
      );
    }
    if (this.clientID === undefined) {
      this.pendingDefaultCallbacks = { clientConnect, clientMessage };
      return;
    }
    if (
      this.legacyConnectionHandle === undefined ||
      this.activeConnection(this.legacyConnectionHandle) === undefined
    ) {
      this.connectLegacy(this.clientID, clientConnect, clientMessage);
      return;
    }
    this.updateConnection(
      this.legacyConnectionHandle,
      clientConnect,
      clientMessage,
    );
  }

  public connect(
    clientID: ClientID,
    clientConnect: (handle: LocalConnectionHandle) => void,
    clientMessage: (message: ServerMessage) => void,
  ): LocalConnectionHandle {
    this.assertRosterClientID(clientID);
    if (!this.connectingLegacy) {
      if (
        this.legacyConnectionHandle !== undefined ||
        this.pendingDefaultCallbacks !== undefined
      ) {
        throw new Error(
          "handle connections cannot be mixed with legacy local callbacks",
        );
      }
      this.handleConnectionsUsed = true;
    }
    const handle = Object.freeze({}) as LocalConnectionHandle;
    const connection: LocalConnection = {
      handle,
      clientID,
      clientConnect: () => clientConnect(handle),
      clientMessage,
      initialStartSent: false,
      acknowledgedTurns: 0,
      deliveredTurns: 0,
    };
    // Install the sender identity before clientConnect: the callback may
    // synchronously send join, rejoin, or intent messages.
    this.connections.set(clientID, connection);
    this.connectionsByHandle.set(handle, connection);
    clientConnect(handle);
    return handle;
  }

  public updateConnection(
    handle: LocalConnectionHandle,
    clientConnect: () => void,
    clientMessage: (message: ServerMessage) => void,
  ): boolean {
    const connection = this.activeConnection(handle);
    if (connection === undefined) {
      return false;
    }
    connection.clientConnect = clientConnect;
    connection.clientMessage = clientMessage;
    return true;
  }

  public disconnect(handle: LocalConnectionHandle): boolean {
    const connection = this.activeConnection(handle);
    if (connection === undefined) {
      return false;
    }
    this.connections.delete(connection.clientID);
    return true;
  }

  start() {
    if (this.started) {
      return;
    }
    console.log("local server starting");
    if (this.lobbyConfig.gameStartInfo === undefined) {
      throw new Error("missing gameStartInfo");
    }
    this.clientID = this.lobbyConfig.gameStartInfo.players[0]?.clientID;
    if (!this.clientID) {
      throw new Error("missing clientID");
    }
    if (this.lobbyConfig.gameRecord) {
      this.replayTurns = decompressGameRecord(
        this.lobbyConfig.gameRecord,
      ).turns;
    }
    if (this.pendingDefaultCallbacks !== undefined) {
      this.connectLegacy(
        this.clientID,
        this.pendingDefaultCallbacks.clientConnect,
        this.pendingDefaultCallbacks.clientMessage,
      );
      this.pendingDefaultCallbacks = undefined;
    }

    this.started = true;
    this.startedAt = Date.now();
    this.turnCheckInterval = setInterval(() => {
      const turnIntervalMs =
        ClientEnv.turnIntervalMs() * this.replaySpeedMultiplier;
      const backlog = Math.max(
        0,
        ...Array.from(this.connections.values(), (connection) =>
          Math.max(0, connection.deliveredTurns - connection.acknowledgedTurns),
        ),
      );
      const allowReplayBacklog =
        this.replaySpeedMultiplier === ReplaySpeedMultiplier.fastest &&
        this.lobbyConfig.gameRecord !== undefined;
      const maxBacklog = allowReplayBacklog ? MAX_REPLAY_BACKLOG_TURNS : 0;

      const canQueueNextTurn =
        this.connections.size > 0 &&
        (backlog === 0 || (maxBacklog > 0 && backlog < maxBacklog));
      if (
        canQueueNextTurn &&
        Date.now() > this.turnStartTime + turnIntervalMs
      ) {
        this.turnStartTime = Date.now();
        // End turn on the server means the client will start processing the turn.
        this.endTurn();
      }
    }, 5);

    this.eventBus.on(ReplaySpeedChangeEvent, this.handleReplaySpeedChange);
    this.eventBus.on(RequestReplaySpeedEvent, this.handleReplaySpeedRequest);

    if (!this.isReplay) {
      this.eventBus.on(GameSpeedUpIntentEvent, this.handleGameSpeedUp);
      this.eventBus.on(GameSpeedDownIntentEvent, this.handleGameSpeedDown);
    }
    this.speedListenersBound = true;

    for (const connection of this.connections.values()) {
      this.sendInitialStartMessage(connection);
    }
  }

  onMessage(clientMsg: ClientMessage): boolean;
  onMessage(handle: LocalConnectionHandle, clientMsg: ClientMessage): boolean;
  onMessage(
    handleOrMessage: LocalConnectionHandle | ClientMessage,
    maybeClientMsg?: ClientMessage,
  ) {
    const handle =
      maybeClientMsg === undefined
        ? this.legacyConnectionHandle
        : (handleOrMessage as LocalConnectionHandle);
    const clientMsg = maybeClientMsg ?? (handleOrMessage as ClientMessage);
    const connection =
      handle === undefined ? undefined : this.activeConnection(handle);
    if (connection === undefined) {
      return false;
    }
    const clientID = connection.clientID;
    if (clientMsg.type === "join") {
      if (this.started) {
        this.sendInitialStartMessage(connection);
      }
      return true;
    }
    if (clientMsg.type === "rejoin") {
      this.sendStartMessage(connection, clientMsg.lastTurn);
    }
    if (clientMsg.type === "intent") {
      // Server stamps clientID - client doesn't send it
      const stampedIntent = {
        ...clientMsg.intent,
        clientID,
      };
      if (stampedIntent.type === "toggle_pause") {
        if (stampedIntent.paused) {
          // Pausing: add intent and end turn before pause takes effect
          this.intents.push(stampedIntent);
          this.endTurn();
          this.paused = true;
        } else {
          // Unpausing: clear pause flag before adding intent so next turn can execute
          this.paused = false;
          this.intents.push(stampedIntent);
          this.endTurn();
        }
        return true;
      }
      // False is an explicit enqueue rejection; Transport uses it to keep a
      // tagged structure placement retryable instead of waiting forever.
      if (this.lobbyConfig.gameRecord || this.paused) {
        return false;
      }

      this.intents.push(stampedIntent);
    }
    if (clientMsg.type === "hash") {
      if (!this.lobbyConfig.gameRecord) {
        if (clientMsg.turnNumber % 100 === 0) {
          // In singleplayer, only store hash every 100 turns to reduce size of game record.
          const turn = this.turns[clientMsg.turnNumber];
          if (turn) {
            turn.hash = clientMsg.hash;
          }
        }
        return true;
      }
      // If we are replaying a game then verify hash.
      const archivedHash = this.replayTurns[clientMsg.turnNumber].hash;
      if (!archivedHash) {
        console.warn(
          `no archived hash found for turn ${clientMsg.turnNumber}, client hash: ${clientMsg.hash}`,
        );
        return true;
      }
      if (archivedHash !== clientMsg.hash) {
        console.error(
          `desync detected on turn ${clientMsg.turnNumber}, client hash: ${clientMsg.hash}, server hash: ${archivedHash}`,
        );
        connection.clientMessage({
          type: "desync",
          turn: clientMsg.turnNumber,
          correctHash: archivedHash,
          clientsWithCorrectHash: 0,
          totalActiveClients: 1,
          yourHash: clientMsg.hash,
        });
      } else {
        console.log(
          `hash verified on turn ${clientMsg.turnNumber}, client hash: ${clientMsg.hash}, server hash: ${archivedHash}`,
        );
      }
    }
    if (clientMsg.type === "winner") {
      this.winner = clientMsg;
      this.allPlayersStats = clientMsg.allPlayersStats;
      if (!this.isReplay) {
        // Archive as soon as the game is decided: endGame() only runs during
        // page teardown, where the auth refresh and upload race document
        // destruction and can silently lose the record (#4931).
        this.archiveGameRecord(false);
      }
    }
    return true;
  }

  // This is so the client can tell us when it finished processing the turn.
  public turnComplete(
    handle: LocalConnectionHandle | undefined = this.legacyConnectionHandle,
  ): boolean {
    const connection =
      handle === undefined ? undefined : this.activeConnection(handle);
    if (connection === undefined) {
      return false;
    }
    if (connection.acknowledgedTurns < connection.deliveredTurns) {
      connection.acknowledgedTurns++;
    }
    return true;
  }

  // endTurn in this context means the server has collected all the intents
  // and will send the turn to the client.
  private endTurn() {
    if (this.paused) {
      return;
    }
    if (this.replayTurns.length > 0) {
      if (this.turns.length >= this.replayTurns.length) {
        this.endGame();
        return;
      }
      this.intents = this.replayTurns[this.turns.length].intents;
    }
    const pastTurn: Turn = {
      turnNumber: this.turns.length,
      intents: this.intents,
    };
    this.turns.push(pastTurn);
    this.intents = [];
    for (const connection of Array.from(this.connections.values())) {
      connection.deliveredTurns = pastTurn.turnNumber + 1;
      connection.clientMessage({
        type: "turn",
        turn: pastTurn,
      });
    }
  }

  private sendStartMessage(connection: LocalConnection, lastTurn: number) {
    if (this.lobbyConfig.gameStartInfo === undefined) {
      throw new Error("missing gameStartInfo");
    }
    // Any delivered start establishes this connection. Explicit rejoins still
    // call this method directly, but a later ordinary join must not add a
    // second automatic initial start.
    connection.initialStartSent = true;
    const missedTurns = this.turns.slice(lastTurn);
    connection.acknowledgedTurns = this.turns.length - missedTurns.length;
    connection.deliveredTurns = this.turns.length;
    connection.clientMessage({
      type: "start",
      gameStartInfo: this.lobbyConfig.gameStartInfo,
      turns: missedTurns,
      lobbyCreatedAt: this.lobbyConfig.gameStartInfo.lobbyCreatedAt,
      // Don't send myClientID for replays — viewer has no player identity.
      myClientID: this.lobbyConfig.gameRecord ? undefined : connection.clientID,
    } satisfies ServerStartGameMessage);
  }

  private sendInitialStartMessage(connection: LocalConnection) {
    if (connection.initialStartSent) {
      return;
    }
    // sendStartMessage marks before invoking the callback, so a synchronous
    // join triggered by start delivery cannot re-enter here.
    this.sendStartMessage(connection, 0);
  }

  private connectLegacy(
    clientID: ClientID,
    clientConnect: () => void,
    clientMessage: (message: ServerMessage) => void,
  ) {
    this.connectingLegacy = true;
    try {
      const handle = this.connect(
        clientID,
        (connectedHandle) => {
          this.legacyConnectionHandle = connectedHandle;
          clientConnect();
        },
        clientMessage,
      );
      this.legacyConnectionHandle = handle;
    } finally {
      this.connectingLegacy = false;
    }
  }

  private activeConnection(
    handle: LocalConnectionHandle,
  ): LocalConnection | undefined {
    const connection = this.connectionsByHandle.get(handle);
    if (
      connection === undefined ||
      this.connections.get(connection.clientID) !== connection
    ) {
      return undefined;
    }
    return connection;
  }

  private assertRosterClientID(clientID: ClientID) {
    const gameStartInfo = this.lobbyConfig.gameStartInfo;
    if (gameStartInfo === undefined) {
      throw new Error("missing gameStartInfo");
    }
    if (!gameStartInfo.players.some((player) => player.clientID === clientID)) {
      throw new Error(`local client ${clientID} is not in the game roster`);
    }
  }

  public endGame() {
    console.log("local server ending game");
    clearInterval(this.turnCheckInterval);
    this.unbindSpeedListeners();
    if (this.isReplay) {
      return;
    }
    // Fallback for games that end without a winner (e.g. quitting early);
    // decided games were already archived at win time.
    this.archiveGameRecord(true);
  }

  private unbindSpeedListeners() {
    if (!this.speedListenersBound) return;
    this.eventBus.off(ReplaySpeedChangeEvent, this.handleReplaySpeedChange);
    this.eventBus.off(RequestReplaySpeedEvent, this.handleReplaySpeedRequest);
    if (!this.isReplay) {
      this.eventBus.off(GameSpeedUpIntentEvent, this.handleGameSpeedUp);
      this.eventBus.off(GameSpeedDownIntentEvent, this.handleGameSpeedDown);
    }
    this.speedListenersBound = false;
  }

  private archiveGameRecord(unloading: boolean) {
    if (ClientEnv.isLocalOnly()) {
      return;
    }
    if (this.archived || this.archiveInFlight) {
      return;
    }
    const players: PlayerRecord[] = [
      {
        persistentID: getPersistentID(),
        username: this.lobbyConfig.playerName,
        clanTag: this.lobbyConfig.playerClanTag ?? null,
        clientID: this.clientID!,
        stats: this.allPlayersStats[this.clientID!],
        cosmetics: this.lobbyConfig.gameStartInfo?.players[0].cosmetics,
      },
    ];
    if (this.lobbyConfig.gameStartInfo === undefined) {
      throw new Error("missing gameStartInfo");
    }
    const record = createPartialGameRecord(
      this.lobbyConfig.gameStartInfo.gameID,
      this.lobbyConfig.gameStartInfo.config,
      players,
      this.turns,
      this.startedAt,
      Date.now(),
      this.winner?.winner,
    );

    const result = PartialGameRecordSchema.safeParse(record);
    if (!result.success) {
      const error = z.prettifyError(result.error);
      console.error("Error parsing game record", error);
      return;
    }

    this.archiveGame(result.data, unloading);
  }

  private async archiveGame(
    record: PartialGameRecord,
    unloading: boolean,
  ): Promise<void> {
    this.archiveInFlight = true;
    try {
      const authHeader = await getAuthHeader();
      if (authHeader === "") {
        // The archive API requires a session. Guests have one too, so this
        // only trips when none could be established (e.g. API unreachable).
        return;
      }
      // Replays refuse to load unless the archived commit matches the client
      // build, and the API worker can't stamp it (it has a different build).
      const jsonString = JSON.stringify(
        { ...record, gitCommit: ClientEnv.gitCommit() },
        replacer,
      );
      const compressedData = await compress(jsonString);
      const response = await fetch(
        `${getApiBase()}/archive_singleplayer_game`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Encoding": "gzip",
            Authorization: authHeader,
          },
          body: compressedData,
          // keepalive lets the request outlive page teardown but caps the body
          // at 64 KiB, so only set it when the page is actually unloading.
          keepalive: unloading,
        },
      );
      if (response.ok) {
        this.archived = true;
      } else {
        console.error(
          `Failed to archive singleplayer game: ${response.status}`,
        );
      }
    } catch (error) {
      console.error("Failed to archive singleplayer game:", error);
    } finally {
      this.archiveInFlight = false;
    }
  }
}

async function compress(data: string): Promise<ArrayBuffer> {
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();

  // Write the data to the compression stream
  writer.write(new TextEncoder().encode(data));
  writer.close();

  // Read the compressed data
  const chunks: Uint8Array[] = [];
  let done = false;
  while (!done) {
    const { value, done: readerDone } = await reader.read();
    done = readerDone;
    if (value) {
      chunks.push(value);
    }
  }

  // Combine all chunks into a single Uint8Array
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const compressedData = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    compressedData.set(chunk, offset);
    offset += chunk.length;
  }

  return compressedData.buffer;
}
