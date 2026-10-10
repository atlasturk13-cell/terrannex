import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  Difficulty,
  Game,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Player,
  PlayerType,
  Unit,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { GameUpdateType, HashUpdate } from "../src/core/game/GameUpdates";
import {
  AllPlayersStatsSchema,
  GameConfigSchema,
  GameStartInfoSchema,
  LocalSkirmishProfile,
  StampedIntentSchema,
  TurnSchema,
  type StampedIntent,
  type Turn,
} from "../src/core/Schemas";
import {
  GOLD_INDEX_TRAIN_OTHER,
  GOLD_INDEX_TRAIN_SELF,
  GOLD_INDEX_WAR,
  GOLD_INDEX_WORK,
} from "../src/core/StatsSchemas";
import { NodeGameMapLoader } from "./perf/fullgame/NodeGameMapLoader";

const MAPS_DIR = path.resolve(process.cwd(), "resources/maps");
const GAME_ID = "EconPlay";
const HUMAN_CLIENT_ID = "EcoP0001";
const SPAWN_X = 435;
const SPAWN_Y = 1647;
const FIRST_WILDERNESS_ATTACK_TURN = 2;
const WILDERNESS_ATTACK_INTERVAL = 600;
const CITY_BUILD_TURN = 1500;
const FACTORY_BUILD_TURN = 4000;
const CHECKPOINT_TICKS = [600, 3000, 9000] as const;
const FINAL_TICK = CHECKPOINT_TICKS[CHECKPOINT_TICKS.length - 1];
const STRUCTURE_COST = 125_000n;

interface PlayerTempoSnapshot {
  alive: boolean;
  tiles: number;
  troops: number;
  maxTroops: number;
  troopsPerSecond: number;
  gold: number;
}

interface TempoCheckpoint {
  tick: number;
  human: PlayerTempoSnapshot;
  bot: PlayerTempoSnapshot;
  cityCount: number;
  factoryCount: number;
  trainSelfGold: number;
  trainOtherGold: number;
  stateHash: HashUpdate;
}

interface StructureEvidence {
  requestedTile: TileRef;
  resolvedTile: TileRef;
  requestedTurn: number;
  firstVisibleTick: number;
  completedTick: number;
  cost: bigint;
  configuredConstructionTicks: number;
}

interface EconomyResult {
  gameID: string;
  config: ReturnType<typeof GameConfigSchema.parse>;
  roster: {
    playerCount: number;
    humanType: PlayerType;
    botType: PlayerType;
    botClientID: string | null;
  };
  turns: Turn[];
  firstAttack: {
    troopsBeforeTurn: number;
    troopsAvailableAtDispatch: number;
    troopsSent: number;
    ratio: number;
  };
  wildernessAttackTurns: number[];
  city: StructureEvidence & { configuredMaxTroopBonus: number };
  factory: StructureEvidence & {
    distanceSquaredFromCity: number;
    ghostRailPathCount: number;
    activeStationCount: number;
    connectedRailCount: number;
    clusterSize: number;
  };
  checkpoints: TempoCheckpoint[];
  final: {
    humanGold: bigint;
    workerGold: bigint;
    warGold: bigint;
    trainSelfGold: bigint;
    trainOtherGold: bigint;
    paidStructureCost: bigint;
    accountedGold: bigint;
    runtimeErrors: string[];
  };
}

function productionEconomyConfig(depthProgression?: boolean) {
  return GameConfigSchema.parse({
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
    ...(depthProgression === undefined ? {} : { depthProgression }),
  });
}

function tempoSnapshot(game: Game, player: Player): PlayerTempoSnapshot {
  const config = game.config();
  return {
    alive: player.isAlive(),
    tiles: player.numTilesOwned(),
    troops: player.troops(),
    maxTroops: Math.round(config.maxTroops(player)),
    troopsPerSecond: Math.round(config.troopIncreaseRate(player) * 10),
    gold: Number(player.gold()),
  };
}

function activeWildernessAttack(player: Player) {
  return player
    .outgoingAttacks()
    .find((attack) => attack.isActive() && !attack.target().isPlayer());
}

function findBuildRequest(
  game: Game,
  human: Player,
  unitType: UnitType.City | UnitType.Factory,
  city?: Unit,
): {
  requestedTile: TileRef;
  resolvedTile: TileRef;
  distanceSquaredFromCity: number;
  ghostRailPathCount: number;
} {
  const candidates = Array.from(human.tiles()).filter((tile) => {
    if (city === undefined) return true;
    const distance = game.euclideanDistSquared(city.tile(), tile);
    return (
      distance > game.config().trainStationMinRange() ** 2 && distance < 90 ** 2
    );
  });
  candidates.sort((a, b) => {
    if (city === undefined) {
      return (
        game.euclideanDistSquared(human.spawnTile()!, a) -
        game.euclideanDistSquared(human.spawnTile()!, b)
      );
    }
    return (
      game.euclideanDistSquared(city.tile(), a) -
      game.euclideanDistSquared(city.tile(), b)
    );
  });

  for (const requestedTile of candidates) {
    const resolvedTile = human.canBuild(unitType, requestedTile);
    if (resolvedTile === false) continue;
    const distanceSquaredFromCity =
      city === undefined
        ? 0
        : game.euclideanDistSquared(city.tile(), resolvedTile);
    if (
      city !== undefined &&
      (distanceSquaredFromCity <= game.config().trainStationMinRange() ** 2 ||
        distanceSquaredFromCity >= game.config().trainStationMaxRange() ** 2)
    ) {
      continue;
    }
    const ghostRailPathCount = game
      .railNetwork()
      .computeGhostRailPaths(unitType, resolvedTile).length;
    if (city !== undefined && ghostRailPathCount === 0) continue;
    return {
      requestedTile,
      resolvedTile,
      distanceSquaredFromCity,
      ghostRailPathCount,
    };
  }
  throw new Error(`no legal ${unitType} build request found`);
}

function goldStat(stats: bigint[] | undefined, index: number): bigint {
  return stats?.[index] ?? 0n;
}

async function runProductionEconomy(
  depthProgression?: boolean,
): Promise<EconomyResult> {
  // Browser workers have isolated module state. A fresh graph likewise avoids
  // sharing TerrainMapLoader's mutable cache between deterministic realms.
  vi.resetModules();
  const { createGameRunner } = await import("../src/core/GameRunner");
  const config = productionEconomyConfig(depthProgression);
  const start = GameStartInfoSchema.parse({
    gameID: GAME_ID,
    lobbyCreatedAt: 0,
    config,
    players: [
      {
        clientID: HUMAN_CLIENT_ID,
        username: "Economy Commander",
        clanTag: null,
        cosmetics: {},
      },
    ],
  });

  const runtimeErrors: string[] = [];
  const hashes = new Map<number, HashUpdate>();
  const runner = await createGameRunner(
    start,
    HUMAN_CLIENT_ID,
    new NodeGameMapLoader(MAPS_DIR),
    (update) => {
      if ("errMsg" in update) {
        runtimeErrors.push(`${update.errMsg}\n${update.stack ?? ""}`);
        return;
      }
      for (const hash of update.updates[GameUpdateType.Hash] as HashUpdate[]) {
        hashes.set(hash.tick, structuredClone(hash));
      }
    },
  );

  const turns: Turn[] = [];
  let nextTurn = 0;
  const executeTurn = (intents: StampedIntent[] = []) => {
    for (const intent of intents) StampedIntentSchema.parse(intent);
    const turn = TurnSchema.parse({ turnNumber: nextTurn++, intents });
    turns.push(turn);
    runner.addTurn(turn);
    if (!runner.executeNextTick() || runtimeErrors.length > 0) {
      throw new Error(
        `production economy failed on turn ${turn.turnNumber}: ${runtimeErrors[runtimeErrors.length - 1] ?? "runner rejected turn"}`,
      );
    }
  };

  executeTurn([
    {
      type: "spawn",
      tile: runner.game.ref(SPAWN_X, SPAWN_Y),
      clientID: HUMAN_CLIENT_ID,
    },
  ]);
  executeTurn();

  const human = runner.game.playerByClientID(HUMAN_CLIENT_ID);
  const bot = runner.game
    .allPlayers()
    .find((player) => player.type() === PlayerType.Bot);
  if (human === null || !human.hasSpawned()) {
    throw new Error("production economy human did not spawn");
  }
  if (bot === undefined || !bot.hasSpawned()) {
    throw new Error("production economy Tribe Bot did not spawn");
  }

  const wildernessAttackTurns: number[] = [];
  const troopsBeforeFirstAttack = human.troops();
  let firstAttackTroops = -1;
  let firstAttackAvailableTroops = -1;
  let cityRequest: ReturnType<typeof findBuildRequest> | undefined;
  let factoryRequest: ReturnType<typeof findBuildRequest> | undefined;
  let cityFirstVisibleTick = -1;
  let cityCompletedTick = -1;
  let factoryFirstVisibleTick = -1;
  let factoryCompletedTick = -1;
  const checkpoints: TempoCheckpoint[] = [];

  while (nextTurn <= FINAL_TICK) {
    const turnNumber = nextTurn;
    const intents: StampedIntent[] = [];

    if (
      turnNumber >= FIRST_WILDERNESS_ATTACK_TURN &&
      (turnNumber - FIRST_WILDERNESS_ATTACK_TURN) %
        WILDERNESS_ATTACK_INTERVAL ===
        0 &&
      activeWildernessAttack(human) === undefined
    ) {
      intents.push({
        type: "attack",
        targetID: null,
        troops: null,
        clientID: HUMAN_CLIENT_ID,
      });
      wildernessAttackTurns.push(turnNumber);
    }

    if (turnNumber === CITY_BUILD_TURN) {
      cityRequest = findBuildRequest(runner.game, human, UnitType.City);
      intents.push({
        type: "build_unit",
        unit: UnitType.City,
        tile: cityRequest.requestedTile,
        clientID: HUMAN_CLIENT_ID,
      });
    }
    if (turnNumber === FACTORY_BUILD_TURN) {
      const city = human.units(UnitType.City)[0];
      if (city === undefined || city.isUnderConstruction()) {
        throw new Error("completed City missing before Factory request");
      }
      factoryRequest = findBuildRequest(
        runner.game,
        human,
        UnitType.Factory,
        city,
      );
      intents.push({
        type: "build_unit",
        unit: UnitType.Factory,
        tile: factoryRequest.requestedTile,
        clientID: HUMAN_CLIENT_ID,
      });
    }

    executeTurn(intents);

    const city = human.units(UnitType.City)[0];
    if (city !== undefined) {
      if (cityFirstVisibleTick === -1)
        cityFirstVisibleTick = runner.game.ticks();
      if (!city.isUnderConstruction() && cityCompletedTick === -1) {
        cityCompletedTick = runner.game.ticks();
      }
    }
    const factory = human.units(UnitType.Factory)[0];
    if (factory !== undefined) {
      if (factoryFirstVisibleTick === -1) {
        factoryFirstVisibleTick = runner.game.ticks();
      }
      if (!factory.isUnderConstruction() && factoryCompletedTick === -1) {
        factoryCompletedTick = runner.game.ticks();
      }
    }

    if (turnNumber === FIRST_WILDERNESS_ATTACK_TURN) {
      firstAttackTroops = activeWildernessAttack(human)?.troops() ?? -1;
      firstAttackAvailableTroops = human.troops() + firstAttackTroops;
    }

    if (CHECKPOINT_TICKS.includes(turnNumber as 600 | 3000 | 9000)) {
      const stateHash = hashes.get(turnNumber);
      if (stateHash === undefined) {
        throw new Error(
          `production runner emitted no hash for tick ${turnNumber}`,
        );
      }
      const stats = AllPlayersStatsSchema.parse(runner.game.stats().stats());
      const gold = stats[HUMAN_CLIENT_ID]?.gold;
      checkpoints.push({
        tick: turnNumber,
        human: tempoSnapshot(runner.game, human),
        bot: tempoSnapshot(runner.game, bot),
        cityCount: human.units(UnitType.City).length,
        factoryCount: human.units(UnitType.Factory).length,
        trainSelfGold: Number(goldStat(gold, GOLD_INDEX_TRAIN_SELF)),
        trainOtherGold: Number(goldStat(gold, GOLD_INDEX_TRAIN_OTHER)),
        stateHash,
      });
    }
  }

  if (cityRequest === undefined || factoryRequest === undefined) {
    throw new Error("structure requests were not issued");
  }
  const city = human.units(UnitType.City)[0];
  const factory = human.units(UnitType.Factory)[0];
  if (city === undefined || factory === undefined) {
    throw new Error("production structures missing at final tick");
  }
  const cityStation = runner.game
    .railNetwork()
    .stationManager()
    .findStation(city);
  const factoryStation = runner.game
    .railNetwork()
    .stationManager()
    .findStation(factory);
  if (cityStation === null || factoryStation === null) {
    throw new Error("production rail stations missing at final tick");
  }
  const finalStats = AllPlayersStatsSchema.parse(runner.game.stats().stats());
  const humanGoldStats = finalStats[HUMAN_CLIENT_ID]?.gold;
  const workerGold = goldStat(humanGoldStats, GOLD_INDEX_WORK);
  const warGold = goldStat(humanGoldStats, GOLD_INDEX_WAR);
  const trainSelfGold = goldStat(humanGoldStats, GOLD_INDEX_TRAIN_SELF);
  const trainOtherGold = goldStat(humanGoldStats, GOLD_INDEX_TRAIN_OTHER);
  const paidStructureCost = STRUCTURE_COST * 2n;

  return {
    gameID: start.gameID,
    config,
    roster: {
      playerCount: runner.game.allPlayers().length,
      humanType: human.type(),
      botType: bot.type(),
      botClientID: bot.clientID(),
    },
    turns,
    firstAttack: {
      troopsBeforeTurn: troopsBeforeFirstAttack,
      troopsAvailableAtDispatch: firstAttackAvailableTroops,
      troopsSent: firstAttackTroops,
      ratio: firstAttackTroops / firstAttackAvailableTroops,
    },
    wildernessAttackTurns,
    city: {
      requestedTile: cityRequest.requestedTile,
      resolvedTile: city.tile(),
      requestedTurn: CITY_BUILD_TURN,
      firstVisibleTick: cityFirstVisibleTick,
      completedTick: cityCompletedTick,
      cost: STRUCTURE_COST,
      configuredConstructionTicks:
        runner.game.unitInfo(UnitType.City).constructionDuration ?? 0,
      configuredMaxTroopBonus: runner.game.config().cityTroopIncrease(),
    },
    factory: {
      requestedTile: factoryRequest.requestedTile,
      resolvedTile: factory.tile(),
      requestedTurn: FACTORY_BUILD_TURN,
      firstVisibleTick: factoryFirstVisibleTick,
      completedTick: factoryCompletedTick,
      cost: STRUCTURE_COST,
      configuredConstructionTicks:
        runner.game.unitInfo(UnitType.Factory).constructionDuration ?? 0,
      distanceSquaredFromCity: runner.game.euclideanDistSquared(
        city.tile(),
        factory.tile(),
      ),
      ghostRailPathCount: factoryRequest.ghostRailPathCount,
      activeStationCount: runner.game.railNetwork().stationManager().getAll()
        .size,
      connectedRailCount: factoryStation.getRailroads().size,
      clusterSize: factoryStation.getCluster()?.size() ?? 0,
    },
    checkpoints,
    final: {
      humanGold: human.gold(),
      workerGold,
      warGold,
      trainSelfGold,
      trainOtherGold,
      paidStructureCost,
      accountedGold: workerGold + warGold + trainSelfGold + trainOtherGold,
      runtimeErrors,
    },
  };
}

describe("production local economy tempo", () => {
  it("replays authentic 1/5/15-minute expansion, structures, and rail trade", async () => {
    const first = await runProductionEconomy();
    const second = await runProductionEconomy();
    const explicitFalse = await runProductionEconomy(false);

    expect(second).toEqual(first);
    expect(explicitFalse.config.depthProgression).toBe(false);
    expect(explicitFalse.checkpoints).toEqual(first.checkpoints);
    expect(explicitFalse.final).toEqual(first.final);
    expect(
      explicitFalse.checkpoints.map(({ stateHash }) => stateHash.hash),
    ).toEqual([
      175_280_501_690_062, 710_579_406_781_892, 2_147_567_172_775_230,
    ]);
    expect(first.gameID).toBe(GAME_ID);
    expect(first.roster).toEqual({
      playerCount: 2,
      humanType: PlayerType.Human,
      botType: PlayerType.Bot,
      botClientID: null,
    });
    expect(first.config).toEqual({
      gameMap: GameMapType.TheBox,
      localSkirmishProfile: LocalSkirmishProfile.TheBox,
      difficulty: Difficulty.Easy,
      donateGold: false,
      donateTroops: false,
      gameType: GameType.Singleplayer,
      gameMode: GameMode.FFA,
      gameMapSize: GameMapSize.Normal,
      nations: "disabled",
      bots: 1,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      randomSpawn: false,
      disabledUnits: [],
      playerTeams: 2,
    });
    expect(first.config).not.toHaveProperty("hostCheats");
    expect(first.config).not.toHaveProperty("startingGold");

    const nonEmptyTurns = first.turns.filter((turn) => turn.intents.length > 0);
    expect(first.turns).toHaveLength(FINAL_TICK + 1);
    expect(first.turns[FINAL_TICK].turnNumber).toBe(FINAL_TICK);
    expect(
      first.turns.every((turn) => TurnSchema.safeParse(turn).success),
    ).toBe(true);
    expect(
      nonEmptyTurns.every((turn) =>
        turn.intents.every(
          (intent) => StampedIntentSchema.safeParse(intent).success,
        ),
      ),
    ).toBe(true);
    expect(
      nonEmptyTurns.map((turn) => ({
        turnNumber: turn.turnNumber,
        intents: turn.intents.map((intent) => ({
          type: intent.type,
          ...(intent.type === "spawn" ? { tile: intent.tile } : {}),
          ...(intent.type === "build_unit"
            ? { unit: intent.unit, tile: intent.tile }
            : {}),
        })),
      })),
    ).toEqual([
      { turnNumber: 0, intents: [{ type: "spawn", tile: 3_373_491 }] },
      { turnNumber: 2, intents: [{ type: "attack" }] },
      { turnNumber: 602, intents: [{ type: "attack" }] },
      { turnNumber: 1202, intents: [{ type: "attack" }] },
      {
        turnNumber: 1500,
        intents: [{ type: "build_unit", unit: UnitType.City, tile: 3_373_491 }],
      },
      { turnNumber: 1802, intents: [{ type: "attack" }] },
      { turnNumber: 2402, intents: [{ type: "attack" }] },
      { turnNumber: 3002, intents: [{ type: "attack" }] },
      { turnNumber: 3602, intents: [{ type: "attack" }] },
      {
        turnNumber: 4000,
        intents: [
          { type: "build_unit", unit: UnitType.Factory, tile: 3_342_772 },
        ],
      },
      { turnNumber: 4202, intents: [{ type: "attack" }] },
      { turnNumber: 4802, intents: [{ type: "attack" }] },
      { turnNumber: 5402, intents: [{ type: "attack" }] },
      { turnNumber: 6002, intents: [{ type: "attack" }] },
      { turnNumber: 6602, intents: [{ type: "attack" }] },
      { turnNumber: 7202, intents: [{ type: "attack" }] },
      { turnNumber: 7802, intents: [{ type: "attack" }] },
      { turnNumber: 8402, intents: [{ type: "attack" }] },
    ]);
    expect(first.firstAttack).toMatchObject({
      troopsBeforeTurn: 25_000,
      troopsAvailableAtDispatch: 25_633.6,
      troopsSent: 5_126.6,
    });
    expect(first.firstAttack.ratio).toBeCloseTo(0.2, 4);
    expect(first.wildernessAttackTurns).toEqual([
      2, 602, 1202, 1802, 2402, 3002, 3602, 4202, 4802, 5402, 6002, 6602, 7202,
      7802, 8402,
    ]);

    expect(first.city).toMatchObject({
      requestedTile: 3_373_491,
      resolvedTile: 3_373_491,
      requestedTurn: CITY_BUILD_TURN,
      firstVisibleTick: 1502,
      completedTick: 1523,
      cost: STRUCTURE_COST,
      configuredConstructionTicks: 20,
      configuredMaxTroopBonus: 250_000,
    });
    expect(first.factory).toMatchObject({
      requestedTile: 3_342_772,
      resolvedTile: 3_342_772,
      requestedTurn: FACTORY_BUILD_TURN,
      firstVisibleTick: 4002,
      completedTick: 4023,
      cost: STRUCTURE_COST,
      configuredConstructionTicks: 20,
      distanceSquaredFromCity: 226,
      ghostRailPathCount: 1,
      activeStationCount: 2,
      connectedRailCount: 1,
      clusterSize: 2,
    });
    expect(first.city.completedTick - first.city.firstVisibleTick).toBe(21);
    expect(first.factory.completedTick - first.factory.firstVisibleTick).toBe(
      21,
    );
    expect(first.city.completedTick - first.city.firstVisibleTick - 1).toBe(
      first.city.configuredConstructionTicks,
    );
    expect(
      first.factory.completedTick - first.factory.firstVisibleTick - 1,
    ).toBe(first.factory.configuredConstructionTicks);
    expect(first.factory.distanceSquaredFromCity).toBeGreaterThan(15 ** 2);
    expect(first.factory.ghostRailPathCount).toBeGreaterThan(0);
    expect(first.factory.activeStationCount).toBeGreaterThanOrEqual(2);
    expect(first.factory.connectedRailCount).toBeGreaterThan(0);
    expect(first.factory.clusterSize).toBeGreaterThanOrEqual(2);

    expect(first.checkpoints.map(({ tick }) => tick)).toEqual([
      600, 3000, 9000,
    ]);
    expect(first.checkpoints).toEqual([
      {
        tick: 600,
        human: {
          alive: true,
          tiles: 501,
          troops: 143_716,
          maxTroops: 150_000,
          troopsPerSecond: 319,
          gold: 59_900,
        },
        bot: {
          alive: true,
          tiles: 8118,
          troops: 25_980,
          maxTroops: 181_101,
          troopsPerSecond: 1831,
          gold: 29_950,
        },
        cityCount: 0,
        factoryCount: 0,
        trainSelfGold: 0,
        trainOtherGold: 0,
        stateHash: {
          type: GameUpdateType.Hash,
          tick: 600,
          hash: 175_280_501_690_062,
        },
      },
      {
        tick: 3000,
        human: {
          alive: true,
          tiles: 17_838,
          troops: 390_825,
          maxTroops: 400_000,
          troopsPerSecond: 355,
          gold: 174_900,
        },
        bot: {
          alive: true,
          tiles: 107_484,
          troops: 123_831,
          maxTroops: 729_503,
          troopsPerSecond: 5460,
          gold: 149_950,
        },
        cityCount: 1,
        factoryCount: 0,
        trainSelfGold: 0,
        trainOtherGold: 0,
        stateHash: {
          type: GameUpdateType.Hash,
          tick: 3000,
          hash: 710_579_406_781_892,
        },
      },
      {
        tick: 9000,
        human: {
          alive: true,
          tiles: 86_320,
          troops: 391_305,
          maxTroops: 400_000,
          troopsPerSecond: 336,
          gold: 949_900,
        },
        bot: {
          alive: true,
          tiles: 729_030,
          troops: 370_709,
          maxTroops: 2_228_947,
          troopsPerSecond: 12_156,
          gold: 449_950,
        },
        cityCount: 1,
        factoryCount: 1,
        trainSelfGold: 300_000,
        trainOtherGold: 0,
        stateHash: {
          type: GameUpdateType.Hash,
          tick: 9000,
          hash: 2_147_567_172_775_230,
        },
      },
    ]);
    const [atOneMinute, atFiveMinutes, atFifteenMinutes] = first.checkpoints;
    expect(atOneMinute.human.tiles).toBeGreaterThanOrEqual(475);
    // Population economy: the capital holds 150k; the one City adds 250k;
    // the 86k tiles won by the fifteenth minute add nobody.
    expect(atOneMinute.human.maxTroops).toBe(150_000);
    expect(atFiveMinutes.human.maxTroops).toBe(400_000);
    expect(atFifteenMinutes.human.maxTroops).toBe(400_000);
    expect(atFiveMinutes.human.tiles).toBeGreaterThanOrEqual(15_000);
    expect(atFiveMinutes.bot.tiles).toBeGreaterThanOrEqual(100_000);
    expect(atFiveMinutes.cityCount).toBe(1);
    expect(atFifteenMinutes.human.tiles).toBeGreaterThanOrEqual(80_000);
    expect(atFifteenMinutes.bot.tiles).toBeGreaterThanOrEqual(700_000);
    // The army refills its population between the wilderness pushes.
    expect(atFifteenMinutes.human.troops).toBeGreaterThanOrEqual(
      0.95 * atFifteenMinutes.human.maxTroops,
    );
    expect(atFifteenMinutes.cityCount).toBe(1);
    expect(atFifteenMinutes.factoryCount).toBe(1);
    expect(atFifteenMinutes.trainSelfGold).toBeGreaterThanOrEqual(250_000);

    expect(first.final.runtimeErrors).toEqual([]);
    expect(first.final.humanGold).toBeGreaterThanOrEqual(0n);
    expect(first.final.workerGold).toBeGreaterThanOrEqual(0n);
    expect(first.final.warGold).toBeGreaterThanOrEqual(0n);
    expect(first.final.trainSelfGold).toBeGreaterThanOrEqual(250_000n);
    expect(first.final.trainOtherGold).toBeGreaterThanOrEqual(0n);
    expect(first.final).toEqual({
      humanGold: 949_900n,
      workerGold: 899_900n,
      warGold: 0n,
      trainSelfGold: 300_000n,
      trainOtherGold: 0n,
      paidStructureCost: 250_000n,
      accountedGold: 1_199_900n,
      runtimeErrors: [],
    });
    expect(first.final.humanGold + first.final.paidStructureCost).toBe(
      first.final.accountedGold,
    );
    for (const checkpoint of first.checkpoints) {
      expect(checkpoint.human.alive).toBe(true);
      expect(checkpoint.bot.alive).toBe(true);
      for (const player of [checkpoint.human, checkpoint.bot]) {
        expect(player.tiles).toBeGreaterThan(0);
        expect(player.troops).toBeGreaterThanOrEqual(0);
        expect(player.gold).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(player.maxTroops)).toBe(true);
        expect(Number.isFinite(player.troopsPerSecond)).toBe(true);
      }
    }
  }, 120_000);

  it("replays the enabled depth profile deterministically", async () => {
    const first = await runProductionEconomy(true);
    const second = await runProductionEconomy(true);

    expect(second).toEqual(first);
    expect(first.config.depthProgression).toBe(true);
    expect(first.checkpoints).toEqual([
      {
        tick: 600,
        human: {
          alive: true,
          tiles: 501,
          troops: 143_716,
          maxTroops: 150_000,
          troopsPerSecond: 319,
          gold: 59_900,
        },
        bot: {
          alive: true,
          tiles: 7561,
          troops: 25_388,
          maxTroops: 174_931,
          troopsPerSecond: 1932,
          gold: 29_950,
        },
        cityCount: 0,
        factoryCount: 0,
        trainSelfGold: 0,
        trainOtherGold: 0,
        stateHash: {
          type: GameUpdateType.Hash,
          tick: 600,
          hash: 173_455_881_975_676,
        },
      },
      {
        tick: 3000,
        human: {
          alive: true,
          tiles: 17_838,
          troops: 390_825,
          maxTroops: 400_000,
          troopsPerSecond: 355,
          gold: 174_900,
        },
        bot: {
          alive: true,
          tiles: 104_129,
          troops: 122_729,
          maxTroops: 716_382,
          troopsPerSecond: 5211,
          gold: 149_950,
        },
        cityCount: 1,
        factoryCount: 0,
        trainSelfGold: 0,
        trainOtherGold: 0,
        stateHash: {
          type: GameUpdateType.Hash,
          tick: 3000,
          hash: 703_501_660_857_594,
        },
      },
      {
        tick: 9000,
        human: {
          alive: true,
          tiles: 86_320,
          troops: 391_305,
          maxTroops: 400_000,
          troopsPerSecond: 336,
          gold: 949_900,
        },
        bot: {
          alive: true,
          tiles: 733_028,
          troops: 374_925,
          maxTroops: 2_236_164,
          troopsPerSecond: 11_993,
          gold: 449_950,
        },
        cityCount: 1,
        factoryCount: 1,
        trainSelfGold: 300_000,
        trainOtherGold: 0,
        stateHash: {
          type: GameUpdateType.Hash,
          tick: 9000,
          hash: 2_160_611_059_924_026,
        },
      },
    ]);
    expect(first.final).toEqual({
      humanGold: 949_900n,
      workerGold: 899_900n,
      warGold: 0n,
      trainSelfGold: 300_000n,
      trainOtherGold: 0n,
      paidStructureCost: 250_000n,
      accountedGold: 1_199_900n,
      runtimeErrors: [],
    });
  }, 120_000);
});
