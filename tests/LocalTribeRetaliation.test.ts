import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createSinglePlayerSession,
  LOCAL_SKIRMISH_CLIENT_ID,
  LOCAL_SKIRMISH_GAME_ID,
} from "../src/client/SinglePlayerSession";
import { TribeExecution } from "../src/core/execution/TribeExecution";
import { AiAttackBehavior } from "../src/core/execution/utils/AiAttackBehavior";
import {
  Difficulty,
  Game,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Player,
  PlayerType,
  TerraNullius,
} from "../src/core/game/Game";
import { GameUpdateType, HashUpdate } from "../src/core/game/GameUpdates";
import { GameConfig, GameStartInfo, StampedIntent } from "../src/core/Schemas";
import { NodeGameMapLoader } from "./perf/fullgame/NodeGameMapLoader";

const MAPS_DIR = path.resolve(process.cwd(), "resources/maps");
const HUMAN_SPAWN_X = 1139;
const HUMAN_SPAWN_Y = 100;
const WILDERNESS_ATTACK_TURNS = [2, 153, 279, 391, 450] as const;
const HUMAN_ATTACK_TURN = 504;
const HUMAN_ATTACK_TROOPS = 12_000;
const PRE_RESPONSE_CHECK_TURN = 537;
const FINAL_TURN = 576;

interface PlayerState {
  id: string;
  type: PlayerType;
  alive: boolean;
  tiles: number;
  troops: number;
  gold: number;
  ownershipHash: string;
}

interface FixtureResult {
  gameID: string;
  clientID: string;
  botName: string;
  botID: string;
  botTilesAfterSpawn: number;
  botTilesBeforeHumanAttack: number;
  firstSharedBorderTurn: number;
  humanAttackTroops: number;
  incomingTroopsBeforeResponse: number;
  responseTurn: number;
  responseSourceTile: number | null;
  responseSharedBorder: boolean;
  responseTroops: number;
  incomingTroopsAfterResponse: number | null;
  canonicalPlayers: PlayerState[];
  stateHash: HashUpdate;
}

function localGameConfig(): GameConfig {
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
  };
}

function ownedTileHash(player: Player): string {
  const tiles = Array.from(player.tiles()).sort((a, b) => a - b);
  let hash = 0x811c9dc5;
  for (const tile of tiles) hash = Math.imul(hash ^ tile, 0x01000193) >>> 0;
  return `${tiles.length}:${hash.toString(16).padStart(8, "0")}`;
}

async function runFixture(): Promise<FixtureResult> {
  vi.resetModules();
  const { createGameRunner } = await import("../src/core/GameRunner");
  const session = createSinglePlayerSession(localGameConfig(), true);
  expect(session.config).toMatchObject({
    gameMap: GameMapType.TheBox,
    difficulty: Difficulty.Easy,
    bots: 1,
    nations: "disabled",
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
  });
  const start: GameStartInfo = {
    gameID: session.gameID,
    lobbyCreatedAt: 0,
    config: session.config,
    players: [
      {
        clientID: session.clientID,
        username: "Local Commander",
        clanTag: null,
        cosmetics: {},
      },
    ],
  };

  let stateHash: HashUpdate | undefined;
  let runtimeError: string | undefined;
  const runner = await createGameRunner(
    start,
    session.clientID,
    new NodeGameMapLoader(MAPS_DIR),
    (update) => {
      if ("errMsg" in update) {
        runtimeError = update.errMsg;
        return;
      }
      const hashes = update.updates[GameUpdateType.Hash] as HashUpdate[];
      if (hashes.length > 0) stateHash = hashes[hashes.length - 1];
    },
  );

  let nextTurn = 0;
  const executeTurn = (intents: StampedIntent[] = []) => {
    const turn = nextTurn++;
    runner.addTurn({ turnNumber: turn, intents });
    if (!runner.executeNextTick() || runtimeError !== undefined) {
      throw new Error(
        `local tribe fixture failed on turn ${turn}: ${runtimeError ?? "runner rejected turn"}`,
      );
    }
    return turn;
  };

  executeTurn([
    {
      type: "spawn",
      tile: runner.game.ref(HUMAN_SPAWN_X, HUMAN_SPAWN_Y),
      clientID: session.clientID,
    },
  ]);
  executeTurn();

  const human = runner.game.playerByClientID(session.clientID);
  if (human === null || !human.hasSpawned()) {
    throw new Error("local human did not spawn");
  }
  const bot = runner.game
    .allPlayers()
    .find((player) => player.type() === PlayerType.Bot);
  if (bot === undefined || !bot.hasSpawned()) {
    throw new Error("local tribe bot did not spawn");
  }
  const botTilesAfterSpawn = bot.numTilesOwned();

  let firstSharedBorderTurn = -1;
  const runUntil = (targetTurn: number) => {
    while (nextTurn < targetTurn) {
      const turn = executeTurn();
      if (firstSharedBorderTurn === -1 && human.sharesBorderWith(bot)) {
        firstSharedBorderTurn = turn;
      }
    }
  };

  for (const attackTurn of WILDERNESS_ATTACK_TURNS) {
    runUntil(attackTurn);
    executeTurn([
      {
        type: "attack",
        targetID: null,
        troops: null,
        clientID: session.clientID,
      },
    ]);
    if (firstSharedBorderTurn === -1 && human.sharesBorderWith(bot)) {
      firstSharedBorderTurn = attackTurn;
    }
  }

  runUntil(HUMAN_ATTACK_TURN);
  const botTilesBeforeHumanAttack = bot.numTilesOwned();
  expect(human.sharesBorderWith(bot)).toBe(true);
  executeTurn([
    {
      type: "attack",
      targetID: bot.id(),
      troops: HUMAN_ATTACK_TROOPS,
      clientID: session.clientID,
    },
  ]);

  const humanAttack = bot
    .incomingAttacks()
    .find((attack) => attack.attacker() === human);
  if (humanAttack === undefined) {
    throw new Error("tribe bot did not observe the ordinary human land attack");
  }
  const humanAttackTroops = humanAttack.troops();

  runUntil(PRE_RESPONSE_CHECK_TURN + 1);
  const incomingBeforeResponse = bot
    .incomingAttacks()
    .find((attack) => attack.attacker() === human);
  if (incomingBeforeResponse === undefined) {
    throw new Error("human attack ended before the tribe decision window");
  }
  const incomingTroopsBeforeResponse = incomingBeforeResponse.troops();

  let responseTurn = -1;
  let responseSourceTile: number | null = -1;
  let responseSharedBorder = false;
  let responseTroops = -1;
  let incomingTroopsAfterResponse: number | null = -1;
  while (nextTurn <= FINAL_TURN) {
    const turn = executeTurn();
    const response = bot
      .outgoingAttacks()
      .find((attack) => attack.target() === human);
    if (responseTurn === -1 && response !== undefined) {
      responseTurn = turn;
      responseSourceTile = response.sourceTile();
      responseSharedBorder = bot.sharesBorderWith(human);
      responseTroops = response.troops();
      incomingTroopsAfterResponse =
        bot
          .incomingAttacks()
          .find((attack) => attack.attacker() === human)
          ?.troops() ?? null;
    }
  }

  if (stateHash === undefined) throw new Error("runner emitted no state hash");

  const canonicalPlayers = runner.game
    .allPlayers()
    .map((player) => ({
      id: player.id(),
      type: player.type(),
      alive: player.isAlive(),
      tiles: player.numTilesOwned(),
      troops: player.troops(),
      gold: Number(player.gold()),
      ownershipHash: ownedTileHash(player),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    gameID: session.gameID,
    clientID: session.clientID,
    botName: bot.displayName(),
    botID: bot.id(),
    botTilesAfterSpawn,
    botTilesBeforeHumanAttack,
    firstSharedBorderTurn,
    humanAttackTroops,
    incomingTroopsBeforeResponse,
    responseTurn,
    responseSourceTile,
    responseSharedBorder,
    responseTroops,
    incomingTroopsAfterResponse,
    canonicalPlayers,
    stateHash,
  };
}

describe("local The Box tribe retaliation", () => {
  it("prioritizes an active human land attack over routine wilderness expansion", async () => {
    const first = await runFixture();
    const second = await runFixture();

    expect(first.gameID).toBe(LOCAL_SKIRMISH_GAME_ID);
    expect(first.clientID).toBe(LOCAL_SKIRMISH_CLIENT_ID);
    expect(first.botName).toBe("Danish Mandate");
    expect(first.botID).toBe("42cl1w7i");
    expect(first.botTilesAfterSpawn).toBe(52);
    expect(first.botTilesBeforeHumanAttack).toBe(5_960);
    expect(first.botTilesBeforeHumanAttack).toBeGreaterThan(
      first.botTilesAfterSpawn,
    );
    expect(first.firstSharedBorderTurn).toBe(460);
    expect(first.humanAttackTroops).toBe(HUMAN_ATTACK_TROOPS);
    expect(first.incomingTroopsBeforeResponse).toBeCloseTo(
      75.54983510960864,
      8,
    );
    expect(first.responseTurn).toBe(538);
    expect(first.responseSourceTile).toBeNull();
    expect(first.responseSharedBorder).toBe(true);
    expect(first.responseTroops).toBeCloseTo(53.44449358865121, 8);
    expect(first.incomingTroopsAfterResponse).toBeNull();
    expect(first.canonicalPlayers).toEqual([
      {
        id: "42cl1w7i",
        type: PlayerType.Bot,
        alive: true,
        tiles: 5_804,
        troops: 39_790,
        gold: 28_750,
        ownershipHash: "5804:9f2c7ffe",
      },
      {
        id: "ew35c12y",
        type: PlayerType.Human,
        alive: true,
        tiles: 8_069,
        troops: 107_520,
        gold: 57_500,
        ownershipHash: "8069:001416b0",
      },
    ]);
    expect(first.stateHash).toEqual({
      type: GameUpdateType.Hash,
      // Hashes are emitted every ten ticks; the last one before FINAL_TURN.
      tick: 570,
      hash: 58525639496472,
    });
    expect(
      first.canonicalPlayers.find((player) => player.id === first.botID),
    ).toMatchObject({
      type: PlayerType.Bot,
      alive: true,
    });
    expect(second).toEqual(first);
    expect(second.canonicalPlayers).toEqual(first.canonicalPlayers);
    expect(second.stateHash).toEqual(first.stateHash);
    expect(
      second.canonicalPlayers.map((player) => player.ownershipHash),
    ).toEqual(first.canonicalPlayers.map((player) => player.ownershipHash));
  }, 120_000);

  it("continues the ordinary wilderness fallback when a threat response cannot be sent", () => {
    const attacker = { isPlayer: () => true } as Player;
    const wilderness = { isPlayer: () => false } as TerraNullius;
    const tribe = {
      id: () => "fallback_tribe",
      isAlive: () => true,
      incomingAllianceRequests: () => [],
      alliances: () => [],
      canDeleteUnit: () => false,
      units: () => [],
      nearby: () => [wilderness],
      isFriendly: () => false,
      allianceWith: () => null,
      breakAlliance: vi.fn(),
    } as unknown as Player;
    const game = {
      terraNullius: () => wilderness,
      addExecution: vi.fn(),
    } as unknown as Game;

    const findIncoming = vi
      .spyOn(AiAttackBehavior.prototype, "findIncomingAttackPlayer")
      .mockReturnValue(attacker);
    const getTraitor = vi
      .spyOn(AiAttackBehavior.prototype, "getNeighborTraitorToAttack")
      .mockReturnValue(null);
    const sendAttack = vi
      .spyOn(AiAttackBehavior.prototype, "sendAttack")
      .mockImplementation((target) => target !== attacker);
    const randomFallback = vi
      .spyOn(AiAttackBehavior.prototype, "attackRandomTarget")
      .mockImplementation(() => undefined);

    try {
      const execution = new TribeExecution(tribe);
      execution.init(game);
      for (
        let tick = 0;
        tick < 200 && sendAttack.mock.calls.length < 3;
        tick++
      ) {
        execution.tick(tick);
      }

      expect(findIncoming).toHaveBeenCalledOnce();
      expect(getTraitor).toHaveBeenCalledOnce();
      expect(sendAttack.mock.calls).toEqual([
        [wilderness],
        [attacker],
        [wilderness],
      ]);
      expect(randomFallback).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
