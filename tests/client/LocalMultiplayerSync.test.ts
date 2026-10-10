import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../src/core/EventBus";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  PlayerType,
  Structures,
  type Game,
  type Player,
  type Unit,
} from "../../src/core/game/Game";
import { GameUpdateType } from "../../src/core/game/GameUpdates";
import {
  LocalSkirmishProfile,
  type ClientID,
  type GameConfig,
  type GameRecord,
  type GameStartInfo,
  type ServerMessage,
  type Turn,
} from "../../src/core/Schemas";

vi.mock("../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => ""),
  getPersistentID: vi.fn(() => "123e4567-e89b-12d3-a456-426614174000"),
  getPlayToken: vi.fn(async () => "test-token"),
}));

vi.mock("../../src/client/Api", () => ({
  getApiBase: vi.fn(() => "https://api.test"),
}));

vi.mock("src/client/ClientEnv", () => ({
  ClientEnv: {
    turnIntervalMs: vi.fn(() => 0),
    gitCommit: vi.fn(() => "DEV"),
    isLocalOnly: vi.fn(() => true),
  },
}));

import type { LobbyConfig } from "../../src/client/ClientGameRunner";
import {
  LocalServer,
  type LocalConnectionHandle,
} from "../../src/client/LocalServer";
import {
  SendAttackIntentEvent,
  SendDonateGoldIntentEvent,
  SendSpawnIntentEvent,
  Transport,
} from "../../src/client/Transport";
import type {
  ErrorUpdate,
  GameUpdateViewData,
  HashUpdate,
} from "../../src/core/game/GameUpdates";
import type { GameRunner } from "../../src/core/GameRunner";
import { NodeGameMapLoader } from "../perf/fullgame/NodeGameMapLoader";

const CLIENT_A = "LocalP01";
const CLIENT_B = "LocalP02";

function localConfig(): GameConfig {
  return {
    gameMap: GameMapType.TheBox,
    gameMapSize: GameMapSize.Normal,
    gameType: GameType.Singleplayer,
    gameMode: GameMode.FFA,
    playerTeams: 2,
    difficulty: Difficulty.Easy,
    bots: 1,
    nations: "disabled",
    donateGold: false,
    donateTroops: false,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    disabledUnits: [],
    localSkirmishProfile: LocalSkirmishProfile.TheBox,
  };
}

function gameStartInfo(): GameStartInfo {
  return {
    gameID: "LocalBox",
    lobbyCreatedAt: 0,
    config: localConfig(),
    players: [
      { clientID: CLIENT_A, username: "Player A", clanTag: null },
      { clientID: CLIENT_B, username: "Player B", clanTag: null },
    ],
  };
}

function lobbyConfig(gameStart: GameStartInfo): LobbyConfig {
  return {
    cosmetics: {},
    playerName: "Local player",
    playerClanTag: null,
    playerRole: null,
    gameID: gameStart.gameID,
    turnstileToken: null,
    gameStartInfo: gameStart,
  };
}

async function nextTimerTurn() {
  await vi.advanceTimersByTimeAsync(5);
}

describe("shared local session connection semantics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("binds sender identity before connect, applies per-client ACKs, and rejoins with an exact slice", async () => {
    const startInfo = gameStartInfo();
    const server = new LocalServer(
      lobbyConfig(startInfo),
      false,
      new EventBus(),
    );
    const turnsA: Turn[] = [];
    const turnsB: Turn[] = [];
    const rejoinStarts: Turn[][] = [];
    let acknowledgeB = true;
    let handleA!: LocalConnectionHandle;
    let handleB!: LocalConnectionHandle;

    const onMessage = (
      clientID: ClientID,
      handle: LocalConnectionHandle,
      turns: Turn[],
      message: ServerMessage,
    ) => {
      if (message.type === "start") {
        expect(message.myClientID).toBe(clientID);
        if (message.turns.length > 0) rejoinStarts.push(message.turns);
        for (const turn of message.turns) {
          turns.push(turn);
          server.turnComplete(handle);
        }
      } else if (message.type === "turn") {
        turns.push(message.turn);
        if (clientID === CLIENT_A || acknowledgeB) {
          server.turnComplete(handle);
        }
      }
    };

    server.connect(
      CLIENT_A,
      (handle) => {
        handleA = handle;
        server.onMessage(handle, {
          type: "intent",
          intent: { type: "attack", targetID: null, troops: null },
        });
      },
      (message) => onMessage(CLIENT_A, handleA, turnsA, message),
    );
    server.connect(
      CLIENT_B,
      (handle) => {
        handleB = handle;
        server.onMessage(handle, {
          type: "intent",
          intent: { type: "attack", targetID: null, troops: null },
        });
      },
      (message) => onMessage(CLIENT_B, handleB, turnsB, message),
    );
    server.start();

    await nextTimerTurn();
    expect(turnsA[0]).toEqual(turnsB[0]);
    expect(turnsA[0].intents.map((intent) => intent.clientID)).toEqual([
      CLIENT_A,
      CLIENT_B,
    ]);

    acknowledgeB = false;
    await nextTimerTurn();
    expect(turnsA.map((turn) => turn.turnNumber)).toEqual([0, 1]);
    await vi.advanceTimersByTimeAsync(25);
    expect(turnsA.map((turn) => turn.turnNumber)).toEqual([0, 1]);
    server.turnComplete(handleB);
    acknowledgeB = true;

    await nextTimerTurn();
    await nextTimerTurn();
    await nextTimerTurn();
    expect(turnsA.map((turn) => turn.turnNumber)).toEqual([0, 1, 2, 3, 4]);

    server.disconnect(handleB);
    await nextTimerTurn();
    await nextTimerTurn();
    await nextTimerTurn();
    expect(turnsA.map((turn) => turn.turnNumber)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);

    server.connect(
      CLIENT_B,
      (handle) => {
        handleB = handle;
      },
      (message) => onMessage(CLIENT_B, handleB, turnsB, message),
    );
    server.onMessage(handleB, {
      type: "rejoin",
      gameID: startInfo.gameID,
      lastTurn: 5,
      token: "123e4567-e89b-12d3-a456-426614174000",
    });

    expect(rejoinStarts).toHaveLength(1);
    expect(rejoinStarts[0].map((turn) => turn.turnNumber)).toEqual([5, 6, 7]);
    expect(turnsB.map((turn) => turn.turnNumber)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    server.endGame();
  });

  it("makes every operation from a replaced connection handle stale", async () => {
    const startInfo = gameStartInfo();
    const server = new LocalServer(
      lobbyConfig(startInfo),
      false,
      new EventBus(),
    );
    const oldMessages: ServerMessage[] = [];
    const replacementMessages: ServerMessage[] = [];
    let oldHandle!: LocalConnectionHandle;
    let replacementHandle!: LocalConnectionHandle;

    server.connect(
      CLIENT_A,
      (handle) => {
        oldHandle = handle;
      },
      (message) => oldMessages.push(message),
    );
    server.start();
    server.connect(
      CLIENT_A,
      (handle) => {
        replacementHandle = handle;
      },
      (message) => replacementMessages.push(message),
    );
    server.onMessage(replacementHandle, {
      type: "rejoin",
      gameID: startInfo.gameID,
      lastTurn: 0,
      token: "123e4567-e89b-12d3-a456-426614174000",
    });
    server.onMessage(replacementHandle, {
      type: "join",
      gameID: startInfo.gameID,
      username: "Player A",
      clanTag: null,
      cosmetics: {},
      turnstileToken: null,
      token: "123e4567-e89b-12d3-a456-426614174000",
    });

    expect(
      replacementMessages.filter((message) => message.type === "start"),
    ).toHaveLength(1);

    expect(
      server.onMessage(oldHandle, {
        type: "intent",
        intent: { type: "attack", targetID: null, troops: 1 },
      }),
    ).toBe(false);
    expect(
      server.updateConnection(
        oldHandle,
        () => {},
        (message) => oldMessages.push(message),
      ),
    ).toBe(false);
    expect(server.turnComplete(oldHandle)).toBe(false);
    expect(server.disconnect(oldHandle)).toBe(false);
    expect(
      server.onMessage({
        type: "intent",
        intent: { type: "attack", targetID: null, troops: 3 },
      }),
    ).toBe(false);
    expect(server.turnComplete()).toBe(false);
    expect(() =>
      server.updateCallback(
        () => {},
        () => {},
      ),
    ).toThrow("legacy local callbacks cannot be mixed with handle connections");

    expect(
      server.onMessage(replacementHandle, {
        type: "intent",
        intent: { type: "attack", targetID: null, troops: 2 },
      }),
    ).toBe(true);
    await nextTimerTurn();
    expect(
      replacementMessages.filter((message) => message.type === "turn"),
    ).toHaveLength(1);
    expect(oldMessages.filter((message) => message.type === "turn")).toEqual(
      [],
    );
    const replacementTurn = replacementMessages.find(
      (message) => message.type === "turn",
    );
    expect(replacementTurn).toMatchObject({
      type: "turn",
      turn: {
        turnNumber: 0,
        intents: [{ clientID: CLIENT_A, troops: 2 }],
      },
    });

    // A stale ACK cannot release the replacement's outstanding turn.
    expect(server.turnComplete(oldHandle)).toBe(false);
    await vi.advanceTimersByTimeAsync(25);
    expect(
      replacementMessages.filter((message) => message.type === "turn"),
    ).toHaveLength(1);
    expect(server.turnComplete(replacementHandle)).toBe(true);
    await nextTimerTurn();
    expect(
      replacementMessages.filter((message) => message.type === "turn"),
    ).toHaveLength(2);
    server.endGame();
  });

  it("rejects unknown shared identities while replay connections stay spectators", () => {
    const startInfo = gameStartInfo();
    const server = new LocalServer(
      lobbyConfig(startInfo),
      false,
      new EventBus(),
    );
    expect(() =>
      server.connect(
        "Unknown1",
        () => {},
        () => {},
      ),
    ).toThrow("local client Unknown1 is not in the game roster");
    expect(
      () =>
        new Transport(
          lobbyConfig(startInfo),
          new EventBus(),
          server,
          "Unknown1",
        ),
    ).toThrow("local client Unknown1 is not in the game roster");

    const replayLobby = {
      ...lobbyConfig(startInfo),
      gameRecord: {
        info: { num_turns: 0 },
        turns: [],
      } as unknown as GameRecord,
    };
    const replayServer = new LocalServer(replayLobby, true, new EventBus());
    const replayMessages: ServerMessage[] = [];
    replayServer.connect(
      CLIENT_A,
      () => {},
      (message) => replayMessages.push(message),
    );
    replayServer.start();
    expect(replayMessages[0]).toMatchObject({
      type: "start",
      turns: [],
      myClientID: undefined,
    });
    replayServer.endGame();
  });

  it("preserves the caller-owned single-client Transport default", async () => {
    const startInfo = gameStartInfo();
    startInfo.players = [startInfo.players[0]];
    const eventBus = new EventBus();
    const transport = new Transport(lobbyConfig(startInfo), eventBus);
    const messages: ServerMessage[] = [];
    let connected = false;

    transport.connect(
      () => {
        connected = true;
      },
      (message) => {
        messages.push(message);
        if (message.type === "turn") transport.turnComplete();
      },
    );
    expect(connected).toBe(true);
    expect(messages[0]).toMatchObject({
      type: "start",
      myClientID: CLIENT_A,
      turns: [],
    });

    eventBus.emit(new SendAttackIntentEvent(null, null));
    await nextTimerTurn();
    expect(messages[1]).toMatchObject({
      type: "turn",
      turn: {
        turnNumber: 0,
        intents: [{ type: "attack", clientID: CLIENT_A }],
      },
    });

    eventBus.emit(
      new SendDonateGoldIntentEvent({ id: () => CLIENT_B } as never, 0n),
    );
    await nextTimerTurn();
    expect(messages[2]).toMatchObject({
      type: "turn",
      turn: {
        turnNumber: 1,
        intents: [
          {
            type: "donate_gold",
            clientID: CLIENT_A,
            recipient: CLIENT_B,
            gold: 0,
          },
        ],
      },
    });

    eventBus.emit(
      new SendDonateGoldIntentEvent({ id: () => CLIENT_B } as never, null),
    );
    await nextTimerTurn();
    expect(messages[3]).toMatchObject({
      type: "turn",
      turn: {
        turnNumber: 2,
        intents: [
          {
            type: "donate_gold",
            clientID: CLIENT_A,
            recipient: CLIENT_B,
            gold: null,
          },
        ],
      },
    });
    transport.leaveGame();
  });

  it("sends one initial start when an async local join follows server startup", async () => {
    const startInfo = gameStartInfo();
    startInfo.players = [startInfo.players[0]];
    const transport = new Transport(lobbyConfig(startInfo), new EventBus());
    const messages: ServerMessage[] = [];
    let joinComplete!: Promise<void>;

    transport.connect(
      () => {
        // joinLobby may wait for an asynchronous clan-tag ownership check in
        // this callback. The owned LocalServer starts before that wait settles.
        joinComplete = Promise.resolve().then(() => transport.joinGame());
      },
      (message) => messages.push(message),
    );
    await joinComplete;

    expect(messages.filter((message) => message.type === "start")).toEqual([
      expect.objectContaining({
        type: "start",
        myClientID: CLIENT_A,
        turns: [],
      }),
    ]);
    transport.leaveGame();
  });
});

interface ProductionRunner {
  runner: GameRunner;
  hashes: Map<number, number>;
  runtimeErrors: string[];
}

async function createIsolatedProductionRunner(
  startInfo: GameStartInfo,
  clientID: ClientID,
): Promise<ProductionRunner> {
  // Browser workers have separate module realms. Resetting between imports
  // reproduces that isolation, including TerrainMapLoader's mutable cache.
  vi.resetModules();
  const { createGameRunner } = await import("../../src/core/GameRunner");
  const hashes = new Map<number, number>();
  const runtimeErrors: string[] = [];
  const runner = await createGameRunner(
    startInfo,
    clientID,
    new NodeGameMapLoader(path.resolve(process.cwd(), "resources/maps")),
    (update: GameUpdateViewData | ErrorUpdate) => {
      if ("errMsg" in update) {
        runtimeErrors.push(`${update.errMsg}\n${update.stack ?? ""}`);
        return;
      }
      const hashUpdates = update.updates[GameUpdateType.Hash] as HashUpdate[];
      for (const hash of hashUpdates) hashes.set(hash.tick, hash.hash);
    },
  );
  return { runner, hashes, runtimeErrors };
}

interface TransportRunnerHarness extends ProductionRunner {
  eventBus: EventBus;
  transport: Transport;
  receivedTurns: Turn[];
  rejoinBatches: Turn[][];
  serverErrors: ServerMessage[];
  startIdentities: Array<ClientID | undefined>;
}

function connectRunner(
  server: LocalServer,
  startInfo: GameStartInfo,
  clientID: ClientID,
  production: ProductionRunner,
): TransportRunnerHarness {
  const eventBus = new EventBus();
  const transport = new Transport(
    {
      ...lobbyConfig(startInfo),
      playerName: clientID,
    },
    eventBus,
    server,
    clientID,
  );
  const receivedTurns: Turn[] = [];
  const rejoinBatches: Turn[][] = [];
  const serverErrors: ServerMessage[] = [];
  const startIdentities: Array<ClientID | undefined> = [];

  const execute = (turn: Turn) => {
    receivedTurns.push(turn);
    production.runner.addTurn(turn);
    if (!production.runner.executeNextTick()) {
      throw new Error(`production runner rejected turn ${turn.turnNumber}`);
    }
    transport.turnComplete();
  };
  const onMessage = (message: ServerMessage) => {
    if (message.type === "start") {
      startIdentities.push(message.myClientID);
      if (message.turns.length > 0) rejoinBatches.push(message.turns);
      for (const turn of message.turns) execute(turn);
    } else if (message.type === "turn") {
      execute(message.turn);
    } else if (message.type === "error" || message.type === "desync") {
      serverErrors.push(message);
    }
  };
  transport.connect(() => {}, onMessage);

  return {
    ...production,
    eventBus,
    transport,
    receivedTurns,
    rejoinBatches,
    serverErrors,
    startIdentities,
  };
}

function canonicalPlayerIdentity(player: Player): string {
  return player.clientID() ?? `${player.type()}:${String(player.id())}`;
}

function ownedTileHash(ownedTiles: number[]): string {
  let hash = 0x811c9dc5;
  for (const tile of ownedTiles) {
    hash = Math.imul(hash ^ tile, 0x01000193) >>> 0;
  }
  return `${ownedTiles.length}:${hash.toString(16).padStart(8, "0")}`;
}

function canonicalUnit(unit: Unit) {
  return {
    id: unit.id(),
    type: unit.type(),
    tile: unit.tile(),
    lastTile: unit.lastTile(),
    active: unit.isActive(),
    markedForDeletion: unit.isMarkedForDeletion(),
    hash: unit.hash(),
  };
}

function canonicalGameSnapshot(game: Game) {
  const winner = game.getWinner();
  return {
    tick: game.ticks(),
    winner:
      winner === null
        ? null
        : typeof winner === "string"
          ? `team:${winner}`
          : canonicalPlayerIdentity(winner),
    players: game
      .allPlayers()
      .map((player) => {
        const ownedTiles = Array.from(player.tiles()).sort((a, b) => a - b);
        const allUnits = player
          .units()
          .slice()
          .sort((a, b) => a.id() - b.id());
        return {
          owner: canonicalPlayerIdentity(player),
          type: player.type(),
          ownedTiles,
          ownedTileHash: ownedTileHash(ownedTiles),
          troops: player.troops(),
          gold: Number(player.gold()),
          structures: allUnits
            .filter((unit) => Structures.has(unit.type()))
            .map((unit) => ({
              ...canonicalUnit(unit),
              level: unit.level(),
              underConstruction: unit.isUnderConstruction(),
            })),
          units: allUnits
            .filter((unit) => !Structures.has(unit.type()))
            .map(canonicalUnit),
          alive: player.isAlive(),
        };
      })
      .sort((a, b) => a.owner.localeCompare(b.owner)),
  };
}

describe("shared local Transport production synchronization", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps two production runners identical across detach, exact rejoin, and live turns", async () => {
    const startInfo = gameStartInfo();
    const productionA = await createIsolatedProductionRunner(
      startInfo,
      CLIENT_A,
    );
    const productionB = await createIsolatedProductionRunner(
      startInfo,
      CLIENT_B,
    );
    const server = new LocalServer(
      lobbyConfig(startInfo),
      false,
      new EventBus(),
    );
    const clientA = connectRunner(server, startInfo, CLIENT_A, productionA);
    const clientB = connectRunner(server, startInfo, CLIENT_B, productionB);

    try {
      server.start();
      expect(clientA.startIdentities).toEqual([CLIENT_A]);
      expect(clientB.startIdentities).toEqual([CLIENT_B]);

      const spawnA = productionA.runner.game.ref(256, 256);
      const spawnB = productionB.runner.game.ref(1792, 1792);
      clientA.eventBus.emit(new SendSpawnIntentEvent(spawnA));
      clientB.eventBus.emit(new SendSpawnIntentEvent(spawnB));
      await nextTimerTurn(); // turn 0: deterministic spawns
      await nextTimerTurn(); // turn 1: spawn executions apply

      clientA.eventBus.emit(new SendAttackIntentEvent(null, null));
      clientB.eventBus.emit(new SendAttackIntentEvent(null, null));
      await nextTimerTurn(); // turn 2: ordinary Terra Nullius attacks
      while (clientA.receivedTurns.length < 60) await nextTimerTurn();

      clientB.transport.leaveGame();
      while (clientA.receivedTurns.length < 80) await nextTimerTurn();
      expect(clientB.receivedTurns).toHaveLength(60);

      clientB.transport.connect(
        () => {},
        (message) => {
          if (message.type === "start") {
            clientB.startIdentities.push(message.myClientID);
            if (message.turns.length > 0) {
              clientB.rejoinBatches.push(message.turns);
            }
            for (const turn of message.turns) {
              clientB.receivedTurns.push(turn);
              clientB.runner.addTurn(turn);
              expect(clientB.runner.executeNextTick()).toBe(true);
              clientB.transport.turnComplete();
            }
          } else if (message.type === "turn") {
            clientB.receivedTurns.push(message.turn);
            clientB.runner.addTurn(message.turn);
            expect(clientB.runner.executeNextTick()).toBe(true);
            clientB.transport.turnComplete();
          } else if (message.type === "error" || message.type === "desync") {
            clientB.serverErrors.push(message);
          }
        },
      );
      await clientB.transport.rejoinGame(60);

      expect(clientB.rejoinBatches).toHaveLength(1);
      expect(clientB.rejoinBatches[0].map((turn) => turn.turnNumber)).toEqual(
        Array.from({ length: 20 }, (_, index) => index + 60),
      );
      while (clientA.receivedTurns.length < 110) await nextTimerTurn();

      const expectedTurnNumbers = Array.from(
        { length: 110 },
        (_, index) => index,
      );
      expect(clientA.receivedTurns.map((turn) => turn.turnNumber)).toEqual(
        expectedTurnNumbers,
      );
      expect(clientB.receivedTurns.map((turn) => turn.turnNumber)).toEqual(
        expectedTurnNumbers,
      );
      expect(clientB.receivedTurns).toEqual(clientA.receivedTurns);
      expect(
        clientA.receivedTurns[0].intents.map((intent) => [
          intent.type,
          intent.clientID,
        ]),
      ).toEqual([
        ["spawn", CLIENT_A],
        ["spawn", CLIENT_B],
      ]);
      expect(
        clientA.receivedTurns[2].intents.map((intent) => [
          intent.type,
          intent.clientID,
        ]),
      ).toEqual([
        ["attack", CLIENT_A],
        ["attack", CLIENT_B],
      ]);

      expect(clientA.hashes.get(100)).toBe(81_143_483_388_203);
      expect(clientB.hashes.get(100)).toBe(clientA.hashes.get(100));
      const snapshotA = canonicalGameSnapshot(clientA.runner.game);
      const snapshotB = canonicalGameSnapshot(clientB.runner.game);
      // This compares every canonical owner, its exact sorted tile list/hash,
      // economy, complete structure/unit state, liveness, winner, and tick.
      expect(snapshotB).toEqual(snapshotA);
      expect(snapshotA.tick).toBe(110);
      expect(snapshotA.winner).toBeNull();
      expect(
        snapshotA.players
          .filter((player) => player.type === PlayerType.Human)
          .map((player) => ({
            owner: player.owner,
            tiles: player.ownedTiles.length,
            troops: player.troops,
            gold: player.gold,
            alive: player.alive,
          })),
      ).toEqual([
        {
          owner: CLIENT_A,
          tiles: 458,
          troops: 74_801,
          gold: 10_800,
          alive: true,
        },
        {
          owner: CLIENT_B,
          tiles: 458,
          troops: 74_801,
          gold: 10_800,
          alive: true,
        },
      ]);
      const bot = snapshotA.players.find(
        (player) => player.type === PlayerType.Bot,
      );
      expect(bot).toMatchObject({
        type: PlayerType.Bot,
        troops: 11_421,
        gold: 5_400,
        alive: true,
      });
      expect(bot?.ownedTiles).toHaveLength(857);
      expect(clientA.runtimeErrors).toEqual([]);
      expect(clientB.runtimeErrors).toEqual([]);
      expect(clientA.serverErrors).toEqual([]);
      expect(clientB.serverErrors).toEqual([]);
    } finally {
      clientA.transport.leaveGame();
      clientB.transport.leaveGame();
      server.endGame();
    }
  }, 30_000);
});
