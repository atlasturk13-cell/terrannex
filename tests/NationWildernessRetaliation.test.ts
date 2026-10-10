import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Player,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { GameUpdateType, HashUpdate } from "../src/core/game/GameUpdates";
import {
  GameConfig,
  GameStartInfo,
  ID,
  StampedIntent,
} from "../src/core/Schemas";
import { NodeGameMapLoader } from "./perf/fullgame/NodeGameMapLoader";

const MAPS_DIR = path.resolve(process.cwd(), "resources/maps");
const GAME_ID = "BotTest2";
const CLIENT_ID = "HumanP01";
const ATTACK_TURN = 317;
const FINAL_TURN = ATTACK_TURN + 60;
const HUMAN_SPAWN_X = 435;
const HUMAN_SPAWN_Y = 1647;

interface FixtureResult {
  nationTilesAt200: number;
  firstBorderTurn: number;
  humanAttackTroops: number;
  retaliationTurn: number;
  retaliationTarget: string;
  retaliationTroops: number;
  humanTilesAtAttack: number;
  nationTilesAtAttack: number;
  finalOwnershipHashes: { human: string; nation: string };
  finalStateHash: HashUpdate;
}

function productionConfig(): GameConfig {
  return {
    gameMap: GameMapType.TheBox,
    gameMapSize: GameMapSize.Normal,
    gameType: GameType.Singleplayer,
    gameMode: GameMode.FFA,
    playerTeams: 0,
    difficulty: Difficulty.Hard,
    nations: 1,
    bots: 0,
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

function levels(player: Player, type: UnitType): number {
  return player
    .units(type)
    .filter((unit) => !unit.isUnderConstruction())
    .reduce((sum, unit) => sum + unit.level(), 0);
}

/** Population economy: capital + cities + barracks; land adds nothing. */
function expectedHardCap(player: Player): number {
  return (
    150_000 +
    levels(player, UnitType.City) * 250_000 +
    levels(player, UnitType.Barracks) * 50_000
  );
}

function expectedHardGrowth(player: Player, maxTroops: number): number {
  const army =
    player.troops() +
    player
      .units(UnitType.Warship)
      .reduce((sum, ship) => sum + (ship.isActive() ? ship.troops() : 0), 0);
  if (army > maxTroops) {
    const overflow = Math.min(player.troops(), army - maxTroops);
    return -Math.min(
      overflow,
      (10 + Math.pow(player.troops(), 0.73) / 4) * (overflow / maxTroops),
    );
  }
  const remaining = maxTroops - army;
  if (remaining === 0) return 0;
  const barracks = Math.min(4, 1 + 0.25 * levels(player, UnitType.Barracks));
  return Math.min(
    (10 + Math.pow(maxTroops, 0.73) / 8) * (remaining / maxTroops) * barracks,
    remaining,
  );
}

async function runFixture(): Promise<FixtureResult> {
  vi.resetModules();
  const { createGameRunner } = await import("../src/core/GameRunner");
  const config = productionConfig();
  expect(ID.safeParse(GAME_ID).success).toBe(true);
  expect(ID.safeParse(CLIENT_ID).success).toBe(true);
  const start: GameStartInfo = {
    gameID: GAME_ID,
    lobbyCreatedAt: 0,
    config,
    players: [
      {
        clientID: CLIENT_ID,
        username: CLIENT_ID,
        clanTag: null,
        cosmetics: {},
      },
    ],
  };

  let stateHash: HashUpdate | undefined;
  let runtimeError: string | undefined;
  const runner = await createGameRunner(
    start,
    CLIENT_ID,
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
        `production fixture failed on turn ${turn}: ${runtimeError ?? "runner rejected turn"}`,
      );
    }
    return turn;
  };

  executeTurn([
    {
      type: "spawn",
      tile: runner.game.ref(HUMAN_SPAWN_X, HUMAN_SPAWN_Y),
      clientID: CLIENT_ID,
    },
  ]);
  executeTurn();

  const human = runner.game.playerByClientID(CLIENT_ID);
  if (human === null || !human.hasSpawned()) {
    throw new Error("production human did not spawn");
  }
  expect(human.spawnTile()).toBe(runner.game.ref(HUMAN_SPAWN_X, HUMAN_SPAWN_Y));

  executeTurn([
    { type: "attack", targetID: null, troops: null, clientID: CLIENT_ID },
  ]);
  const wildernessAttack = human
    .outgoingAttacks()
    .find((attack) => !attack.target().isPlayer());
  expect(wildernessAttack?.troops()).toBeGreaterThan(0);

  const nation = runner.game
    .allPlayers()
    .find((player) => player.type() === PlayerType.Nation);
  if (nation === undefined) throw new Error("production nation did not spawn");
  expect(nation.displayName()).toBe("Fullsender");
  expect(nation.id()).toBe("10rpjhqo");
  expect(nation.type()).toBe(PlayerType.Nation);

  // This is the public production ruleset, not a local-skirmish/host-cheat
  // profile. Hard nations deliberately share human start/cap/growth/gold rules.
  expect(config.localSkirmishProfile).toBeUndefined();
  expect(config.hostCheats).toBeUndefined();
  expect(config).toMatchObject({
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
  });
  expect(runner.game.config().startManpower(human.info())).toBe(25_000);
  expect(runner.game.config().startManpower(nation.info())).toBe(25_000);

  let nationTilesAt200 = -1;
  let firstBorderTurn = -1;
  while (nextTurn < ATTACK_TURN) {
    const turn = executeTurn();
    if (turn === 200) nationTilesAt200 = nation.numTilesOwned();
    if (firstBorderTurn === -1 && nation.sharesBorderWith(human)) {
      firstBorderTurn = turn;
    }
  }

  const humanTilesAtAttack = human.numTilesOwned();
  const nationTilesAtAttack = nation.numTilesOwned();
  executeTurn([
    {
      type: "attack",
      targetID: nation.id(),
      troops: 80_000,
      clientID: CLIENT_ID,
    },
  ]);
  if (firstBorderTurn === -1 && nation.sharesBorderWith(human)) {
    firstBorderTurn = ATTACK_TURN;
  }
  const humanAttack = nation
    .incomingAttacks()
    .find((attack) => attack.attacker() === human);
  if (humanAttack === undefined) {
    throw new Error("nation did not observe the human's production attack");
  }
  const humanAttackTroops = humanAttack.troops();

  let retaliationTurn = -1;
  let retaliationTroops = -1;
  while (nextTurn <= FINAL_TURN) {
    const turn = executeTurn();
    const retaliation = nation
      .outgoingAttacks()
      .find(
        (attack) => attack.target() === human && attack.sourceTile() === null,
      );
    if (retaliationTurn === -1 && retaliation !== undefined) {
      retaliationTurn = turn;
      retaliationTroops = retaliation.troops();
    }
  }

  const gameConfig = runner.game.config();
  expect(gameConfig.attackAmount(human, nation)).toBe(human.troops() / 5);
  expect(gameConfig.attackAmount(nation, human)).toBe(nation.troops() / 5);
  for (const player of [human, nation]) {
    const cap = gameConfig.maxTroops(player);
    expect(cap).toBeCloseTo(expectedHardCap(player), 8);
    expect(gameConfig.troopIncreaseRate(player)).toBeCloseTo(
      expectedHardGrowth(player, cap),
      8,
    );
    expect(gameConfig.goldAdditionRate(player)).toBe(100n);
  }
  if (stateHash === undefined) throw new Error("runner emitted no state hash");

  return {
    nationTilesAt200,
    firstBorderTurn,
    humanAttackTroops,
    retaliationTurn,
    retaliationTarget: retaliationTurn === -1 ? "" : human.id(),
    retaliationTroops,
    humanTilesAtAttack,
    nationTilesAtAttack,
    finalOwnershipHashes: {
      human: ownedTileHash(human),
      nation: ownedTileHash(nation),
    },
    finalStateHash: stateHash,
  };
}

describe("production nation retaliation beside wilderness", () => {
  it("does not let normal wilderness expansion starve an active human-threat response", async () => {
    const first = await runFixture();
    const second = await runFixture();

    expect(first.nationTilesAt200).toBe(5955);
    expect(first.firstBorderTurn).toBe(107);
    expect(first.humanAttackTroops).toBe(80_000);
    expect(first.retaliationTurn).toBe(364);
    expect(first.retaliationTarget).toBe("p0dbxa9h");
    expect(first.retaliationTroops).toBeCloseTo(839.8526231244632, 8);
    expect(first.humanTilesAtAttack).toBe(373);
    expect(first.nationTilesAtAttack).toBe(10273);
    expect(first.finalOwnershipHashes).toEqual({
      human: "2314:b4b90451",
      nation: "8749:865027f1",
    });
    expect(first.finalStateHash).toEqual({
      type: GameUpdateType.Hash,
      tick: 370,
      hash: 112563533599842,
    });
    expect(second).toEqual(first);
  }, 120_000);
});
