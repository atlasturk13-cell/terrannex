import { ClientEnv } from "../client/ClientEnv";
import { terrainMapFileLoader } from "../client/TerrainMapFileLoader";
import { SendWinnerEvent } from "../client/Transport";
import { GameView } from "../client/view/GameView";
import { Config } from "../core/configuration/Config";
import { EventBus } from "../core/EventBus";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  RankedType,
} from "../core/game/Game";
import {
  GameUpdateType,
  type GameUpdateViewData,
  type HashUpdate,
  type WinUpdate,
} from "../core/game/GameUpdates";
import { loadTerrainMap } from "../core/game/TerrainMapLoader";
import {
  GameConfigSchema,
  GameStartInfoSchema,
  StampedIntentSchema,
  TurnSchema,
  type StampedIntent,
} from "../core/Schemas";
import { WorkerClient } from "../core/worker/WorkerClient";

const GAME_ID = "WinLoss3";
const WINNER_CLIENT_ID = "Winner01";
const LOSER_CLIENT_ID = "Loser001";
const EXPECTED_CONQUEST_TICK = 353;
const EXPECTED_WIN_TICK = 361;
const EXPECTED_HASH_TURN = 360;
const EXPECTED_HASH = 138_215_780_088_193;

function requireStatusElement(): HTMLOutputElement {
  const element = document.querySelector<HTMLOutputElement>("#qa-status");
  if (element === null) throw new Error("missing QA status element");
  return element;
}

const status = requireStatusElement();

let worker: WorkerClient | null = null;
let hasFailed = false;

function qaAttribute(name: string, value: string | number): void {
  status.setAttribute(`data-qa-${name}`, String(value));
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function reportFailure(value: unknown): void {
  if (hasFailed) return;
  hasFailed = true;
  const error = asError(value);
  qaAttribute("status", "error");
  qaAttribute("error-name", error.name);
  qaAttribute("error-message", error.message);
  qaAttribute("error-stack", error.stack ?? "");
  qaAttribute(
    "error-details",
    `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`,
  );
  status.textContent = `WinLoss3 QA error: ${error.message}`;
  console.error("[WinLoss3 QA]", error);
}

window.addEventListener("error", (event) => {
  reportFailure(event.error ?? new Error(event.message));
});
window.addEventListener("unhandledrejection", (event) => {
  reportFailure(event.reason);
});
window.addEventListener("pagehide", () => {
  worker?.cleanup();
});

function productionRankedConfig() {
  return GameConfigSchema.parse({
    gameMap: GameMapType.TheBox,
    gameMapSize: GameMapSize.Normal,
    gameType: GameType.Public,
    gameMode: GameMode.FFA,
    rankedType: RankedType.OneVOne,
    maxPlayers: 2,
    difficulty: Difficulty.Medium,
    bots: 0,
    nations: "disabled",
    donateGold: false,
    donateTroops: false,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    disabledUnits: [],
  });
}

function parsedTurn(turnNumber: number, rawIntents: StampedIntent[] = []) {
  const intents = rawIntents.map((intent) => StampedIntentSchema.parse(intent));
  return TurnSchema.parse({ turnNumber, intents });
}

function tickPromise(target: number) {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  const timeout = window.setTimeout(
    () => reject(new Error(`timed out waiting for worker tick ${target}`)),
    120_000,
  );
  return {
    promise,
    resolve: () => {
      window.clearTimeout(timeout);
      resolve();
    },
    reject: (error: Error) => {
      window.clearTimeout(timeout);
      reject(error);
    },
  };
}

async function run(): Promise<void> {
  const environment =
    document.querySelector<HTMLMetaElement>("#qa-environment");
  window.BOOTSTRAP_CONFIG = {
    gitCommit: "DEV-QA",
    assetManifest: {},
    cdnBase: "",
    gameEnv: "dev",
    numWorkers: 1,
    turnstileSiteKey: "1x00000000000000000000AA",
    jwtAudience: "localhost",
    instanceId: "WINLOSS3_QA",
    localOnly: environment?.dataset.localOnly === "true",
  };

  if (!ClientEnv.isLocalOnly()) {
    throw new Error("WinLoss3 QA requires ClientEnv.isLocalOnly()");
  }

  const search = new URL(window.location.href).searchParams;
  const viewer = search.get("viewer");
  qaAttribute("viewer", viewer ?? "");
  if (
    search.size !== 1 ||
    (viewer !== WINNER_CLIENT_ID && viewer !== LOSER_CLIENT_ID)
  ) {
    throw new Error("viewer must be exactly Winner01 or Loser001");
  }

  const previousLanguage = localStorage.getItem("lang");
  localStorage.setItem("lang", "en");
  let WinModalClass: typeof import("../client/hud/layers/WinModal").WinModal;
  try {
    const [{ WinModal }] = await Promise.all([
      import("../client/hud/layers/WinModal"),
      import("../client/LangSelector"),
      import("../client/components/baseComponents/Button"),
      import("../client/styles.css"),
    ]);
    WinModalClass = WinModal;
  } finally {
    if (previousLanguage === null) localStorage.removeItem("lang");
    else localStorage.setItem("lang", previousLanguage);
  }

  const langSelector = document.querySelector("lang-selector") as
    | (HTMLElement & {
        translations?: Record<string, string>;
        updateComplete: Promise<boolean>;
      })
    | null;
  if (langSelector === null) throw new Error("missing production LangSelector");
  const languageDeadline = performance.now() + 10_000;
  while (langSelector.translations === undefined) {
    if (performance.now() > languageDeadline) {
      throw new Error("timed out loading English translations");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 10));
  }
  await langSelector.updateComplete;
  document.title = "WinLoss3 viewer QA";

  const modalElement = document.querySelector("win-modal");
  if (!(modalElement instanceof WinModalClass)) {
    throw new Error("missing production WinModal");
  }

  qaAttribute("status", "running");
  status.textContent = `WinLoss3 QA is running for ${viewer}…`;

  const config = productionRankedConfig();
  const startInfo = GameStartInfoSchema.parse({
    gameID: GAME_ID,
    lobbyCreatedAt: 0,
    config,
    players: [
      {
        clientID: WINNER_CLIENT_ID,
        username: WINNER_CLIENT_ID,
        clanTag: null,
        cosmetics: {},
      },
      {
        clientID: LOSER_CLIENT_ID,
        username: LOSER_CLIENT_ID,
        clanTag: null,
        cosmetics: {},
      },
    ],
  });
  const terrain = await loadTerrainMap(
    config.gameMap,
    config.gameMapSize,
    terrainMapFileLoader,
    false,
  );
  worker = new WorkerClient(startInfo, viewer);
  await worker.initialize();

  const gameView = new GameView(
    worker,
    new Config(config, null, false, startInfo.listed),
    terrain,
    viewer,
    viewer,
    null,
    startInfo.gameID,
    startInfo.players,
  );
  const eventBus = new EventBus();
  modalElement.eventBus = eventBus;
  modalElement.game = gameView;
  modalElement.init();

  const conquestTicks: number[] = [];
  const winTicks: number[] = [];
  const hashes: HashUpdate[] = [];
  const winnerEvents: SendWinnerEvent[] = [];
  const intentTypes: string[] = [];
  let turnCount = 0;
  let workerError: Error | null = null;
  const tick351 = tickPromise(351);
  const tick361 = tickPromise(361);

  eventBus.on(SendWinnerEvent, (event) => {
    winnerEvents.push(event);
    qaAttribute("winner-event-count", winnerEvents.length);
  });

  const rejectTicks = (error: Error) => {
    workerError = error;
    tick351.reject(error);
    tick361.reject(error);
  };

  worker.start((update) => {
    if (workerError !== null) return;
    try {
      if ("errMsg" in update) {
        rejectTicks(new Error(`${update.errMsg}\n${update.stack ?? ""}`));
        return;
      }

      const genuineUpdate: GameUpdateViewData = update;
      gameView.update(genuineUpdate);
      modalElement.tick();

      const conquestCount =
        genuineUpdate.updates[GameUpdateType.ConquestEvent].length;
      for (let i = 0; i < conquestCount; i++) {
        conquestTicks.push(genuineUpdate.tick);
      }
      for (const win of genuineUpdate.updates[
        GameUpdateType.Win
      ] as WinUpdate[]) {
        void win;
        winTicks.push(genuineUpdate.tick);
      }
      hashes.push(
        ...(genuineUpdate.updates[GameUpdateType.Hash] as HashUpdate[]),
      );

      qaAttribute("conquest-tick", conquestTicks.join(","));
      qaAttribute("win-tick", winTicks.join(","));
      qaAttribute("win-count", winTicks.length);
      const latestHash = hashes[hashes.length - 1];
      if (latestHash !== undefined) {
        qaAttribute("hash-turn", latestHash.tick);
        qaAttribute("hash", latestHash.hash);
      }

      if (genuineUpdate.tick === 351) tick351.resolve();
      if (genuineUpdate.tick === 361) tick361.resolve();
    } catch (error) {
      rejectTicks(asError(error));
    }
  });

  const send = (turn: ReturnType<typeof TurnSchema.parse>) => {
    if (turn.intents.length > 0) {
      intentTypes.push(...turn.intents.map((intent) => intent.type));
    }
    worker!.sendTurn(turn);
    turnCount++;
    qaAttribute("turn-count", turnCount);
    qaAttribute("intents", intentTypes.join(","));
  };

  send(
    parsedTurn(0, [
      {
        type: "spawn",
        tile: terrain.gameMap.ref(256, 256),
        clientID: WINNER_CLIENT_ID,
      },
      {
        type: "spawn",
        tile: terrain.gameMap.ref(264, 256),
        clientID: LOSER_CLIENT_ID,
      },
    ]),
  );
  for (let turn = 1; turn <= 350; turn++) send(parsedTurn(turn));
  await tick351.promise;

  const loser = gameView.playerByClientID(LOSER_CLIENT_ID);
  if (loser === null) {
    throw new Error("GameView did not resolve the loser at tick 351");
  }
  send(
    parsedTurn(351, [
      {
        type: "attack",
        targetID: loser.id(),
        troops: null,
        clientID: WINNER_CLIENT_ID,
      },
    ]),
  );
  for (let turn = 352; turn <= 360; turn++) send(parsedTurn(turn));
  await tick361.promise;
  await modalElement.updateComplete;
  await Promise.all(
    Array.from(modalElement.querySelectorAll("o-button")).map(
      (button) =>
        (button as HTMLElement & { updateComplete: Promise<boolean> })
          .updateComplete,
    ),
  );

  const latestHash = hashes[hashes.length - 1];
  const winnerEvent = winnerEvents[winnerEvents.length - 1];
  const title = modalElement.querySelector("h2")?.textContent?.trim() ?? "";
  const actions = Array.from(modalElement.querySelectorAll("o-button span"))
    .map((element) => element.textContent?.trim() ?? "")
    .filter(Boolean);
  const expectedTitle =
    viewer === WINNER_CLIENT_ID ? "You Won!" : "Winner01 has won!";
  const expectedLastAction =
    viewer === WINNER_CLIENT_ID ? "Keep Playing" : "Spectate";
  const promotionalSelector =
    'iframe, a[href^="http"], steam-wishlist, cosmetic-card, purchase-button, [data-win-cosmetic-promo]';
  const drifts = [
    turnCount === 361 ? null : `turn count ${turnCount} !== 361`,
    intentTypes.join(",") === "spawn,spawn,attack"
      ? null
      : `intents ${intentTypes.join(",")} drifted`,
    conquestTicks.length === 1 && conquestTicks[0] === EXPECTED_CONQUEST_TICK
      ? null
      : `conquest ticks ${conquestTicks.join(",")} drifted`,
    winTicks.length === 1 && winTicks[0] === EXPECTED_WIN_TICK
      ? null
      : `win ticks ${winTicks.join(",")} drifted`,
    latestHash?.tick === EXPECTED_HASH_TURN && latestHash.hash === EXPECTED_HASH
      ? null
      : `hash ${latestHash?.tick ?? "none"}/${latestHash?.hash ?? "none"} drifted`,
    winnerEvents.length === 1 &&
    winnerEvent?.winner?.[0] === "player" &&
    winnerEvent.winner[1] === WINNER_CLIENT_ID
      ? null
      : `winner event count/payload drifted (${winnerEvents.length})`,
    title === expectedTitle
      ? null
      : `modal title ${JSON.stringify(title)} !== ${JSON.stringify(expectedTitle)}`,
    actions[actions.length - 1] === expectedLastAction
      ? null
      : `modal action ${JSON.stringify(actions[actions.length - 1])} !== ${JSON.stringify(expectedLastAction)}`,
    document.querySelector(promotionalSelector) === null
      ? null
      : "external or promotional DOM was constructed",
  ].filter((drift): drift is string => drift !== null);

  qaAttribute("modal-title", title);
  qaAttribute("actions", actions.join(","));
  if (drifts.length > 0) {
    throw new Error(`deterministic WinLoss3 drift: ${drifts.join("; ")}`);
  }

  qaAttribute("status", "pass");
  status.textContent = `WinLoss3 QA passed for ${viewer}.`;
}

void run().catch(reportFailure);
