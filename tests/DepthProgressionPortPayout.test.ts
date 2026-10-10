import { Config } from "../src/core/configuration/Config";
import { TradeShipExecution } from "../src/core/execution/TradeShipExecution";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../src/core/game/Game";
import { GameConfig } from "../src/core/Schemas";
import { GOLD_INDEX_STEAL, GOLD_INDEX_TRADE } from "../src/core/StatsSchemas";
import { setup } from "./util/Setup";

function gameConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    gameMap: GameMapType.NaturalEarthWorld,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Singleplayer,
    difficulty: Difficulty.Medium,
    nations: "disabled",
    donateGold: false,
    donateTroops: false,
    bots: 0,
    infiniteGold: true,
    infiniteTroops: false,
    instantBuild: true,
    randomSpawn: false,
    goldMultiplier: 2,
    ...overrides,
  };
}

function port(
  level: number,
  options: {
    active?: boolean;
    underConstruction?: boolean;
    markedForDeletion?: boolean;
  } = {},
): Unit {
  return {
    level: () => level,
    isActive: () => options.active ?? true,
    isUnderConstruction: () => options.underConstruction ?? false,
    isMarkedForDeletion: () => options.markedForDeletion ?? false,
  } as Unit;
}

function payoutPlayer(ports: Unit[]): Player {
  return {
    units: () => ports,
    isLobbyCreator: () => false,
  } as Player;
}

function payoutConfig(
  depthProgression: boolean | undefined,
  overrides: Partial<GameConfig> = {},
): Config {
  return new Config(
    gameConfig({ depthProgression, ...overrides }),
    null,
    false,
  );
}

function addLevels(unit: Unit, targetLevel: number): void {
  while (unit.level() < targetLevel) unit.increaseLevel();
}

interface CompletionSnapshot {
  sourceDelta: bigint;
  destinationDelta: bigint;
  sourceTradeStat: bigint;
  destinationTradeStat: bigint;
}

async function completeNormalTrade(
  depthProgression: boolean | undefined,
  overrides: Partial<GameConfig> = {},
): Promise<CompletionSnapshot> {
  const sourceInfo = new PlayerInfo(
    "Source",
    PlayerType.Human,
    "source-client",
    "source",
    true,
  );
  const destinationInfo = new PlayerInfo(
    "Destination",
    PlayerType.Human,
    "destination-client",
    "destination",
  );
  const game = await setup(
    "half_land_half_ocean",
    gameConfig({ depthProgression, ...overrides }),
    [sourceInfo, destinationInfo],
  );
  const source = game.player(sourceInfo.id);
  const destination = game.player(destinationInfo.id);
  const sourcePort = source.buildUnit(UnitType.Port, game.ref(7, 10), {});
  const destinationPort = destination.buildUnit(
    UnitType.Port,
    game.ref(7, 3),
    {},
  );
  addLevels(destinationPort, 3);
  const tradeShip = source.buildUnit(UnitType.TradeShip, game.ref(8, 10), {
    targetUnit: destinationPort,
  });
  const execution = new TradeShipExecution(source, sourcePort, destinationPort);
  execution.init(game, game.ticks());
  const internals = execution as unknown as {
    tradeShip: Unit;
    tilesTraveled: number;
    complete(): void;
  };
  internals.tradeShip = tradeShip;
  internals.tilesTraveled = 300;
  const sourceGold = source.gold();
  const destinationGold = destination.gold();

  internals.complete();

  return {
    sourceDelta: source.gold() - sourceGold,
    destinationDelta: destination.gold() - destinationGold,
    sourceTradeStat:
      game.stats().getPlayerStats(source)?.gold?.[GOLD_INDEX_TRADE] ?? 0n,
    destinationTradeStat:
      game.stats().getPlayerStats(destination)?.gold?.[GOLD_INDEX_TRADE] ?? 0n,
  };
}

interface CaptureSnapshot {
  victimDelta: bigint;
  captorDelta: bigint;
  captorStealStat: bigint;
  victimTradeStat: bigint | undefined;
}

async function completeCapturedTrade(
  depthProgression: boolean | undefined,
): Promise<CaptureSnapshot> {
  const victimInfo = new PlayerInfo(
    "Victim",
    PlayerType.Human,
    "victim-client",
    "victim",
  );
  const captorInfo = new PlayerInfo(
    "Captor",
    PlayerType.Human,
    "captor-client",
    "captor",
  );
  const game = await setup(
    "half_land_half_ocean",
    gameConfig({ depthProgression }),
    [victimInfo, captorInfo],
  );
  const victim = game.player(victimInfo.id);
  const captor = game.player(captorInfo.id);
  const sourcePort = victim.buildUnit(UnitType.Port, game.ref(7, 10), {});
  addLevels(sourcePort, 5);
  const captorPort = captor.buildUnit(UnitType.Port, game.ref(7, 3), {});
  addLevels(captorPort, 2);
  const tradeShip = victim.buildUnit(UnitType.TradeShip, game.ref(8, 10), {
    targetUnit: captorPort,
  });
  captor.captureUnit(tradeShip);
  const execution = new TradeShipExecution(victim, sourcePort, captorPort);
  execution.init(game, game.ticks());
  const internals = execution as unknown as {
    tradeShip: Unit;
    tilesTraveled: number;
    wasCaptured: boolean;
    complete(): void;
  };
  internals.tradeShip = tradeShip;
  internals.tilesTraveled = 300;
  internals.wasCaptured = true;
  const victimGold = victim.gold();
  const captorGold = captor.gold();

  internals.complete();

  return {
    victimDelta: victim.gold() - victimGold,
    captorDelta: captor.gold() - captorGold,
    captorStealStat:
      game.stats().getPlayerStats(captor)?.gold?.[GOLD_INDEX_STEAL] ?? 0n,
    victimTradeStat: game.stats().getPlayerStats(victim)?.gold?.[
      GOLD_INDEX_TRADE
    ],
  };
}

describe("depth progression Port payout", () => {
  it("matches the exact L0-L5 golden table at multiplier 1", () => {
    const config = payoutConfig(true, { goldMultiplier: 1 });
    const distances = [100, 300, 600, 1000];
    const expected = [
      [60_000n, 75_000n, 88_500n, 100_650n, 111_585n, 121_426n],
      [80_000n, 100_000n, 118_000n, 134_200n, 148_780n, 161_902n],
      [110_000n, 137_500n, 162_250n, 184_525n, 204_572n, 222_615n],
      [150_000n, 187_500n, 221_250n, 251_625n, 278_962n, 303_566n],
    ];

    expect(
      distances.map((distance) =>
        Array.from({ length: 6 }, (_, level) =>
          config.tradeShipGold(
            distance,
            payoutPlayer(level === 0 ? [] : [port(level)]),
          ),
        ),
      ),
    ).toEqual(expected);
  });

  it("matches the exact L0-L5 golden table at audited distances and multiplier 2", () => {
    const config = payoutConfig(true);
    const distances = [100, 300, 600, 1000];
    const expected = [
      [120_000n, 150_000n, 177_000n, 201_300n, 223_170n, 242_853n],
      [160_000n, 200_000n, 236_000n, 268_400n, 297_560n, 323_804n],
      [220_000n, 275_000n, 324_500n, 369_050n, 409_145n, 445_230n],
      [300_000n, 375_000n, 442_500n, 503_250n, 557_925n, 607_132n],
    ];

    const actual = distances.map((distance) =>
      Array.from({ length: 6 }, (_, level) =>
        config.tradeShipGold(
          distance,
          payoutPlayer(level === 0 ? [] : [port(level)]),
        ),
      ),
    );

    expect(actual).toEqual(expected);
  });

  it("sums separate physical Ports beyond five effective levels", () => {
    const config = payoutConfig(true, { goldMultiplier: 1 });
    expect(config.tradeShipGold(300, payoutPlayer([port(3), port(3)]))).toBe(
      173_711n,
    );
  });

  it("clamps each completed physical Port to five effective levels", () => {
    const config = payoutConfig(true, { goldMultiplier: 1 });
    const player = payoutPlayer([
      port(10),
      port(5, { underConstruction: true }),
    ]);
    expect(config.effectivePortLevels(player)).toBe(5);
    expect(config.tradeShipGold(300, player)).toBe(161_902n);
  });

  it("excludes under-construction and inactive Ports", () => {
    const config = payoutConfig(true);
    const player = payoutPlayer([
      port(2),
      port(5, { underConstruction: true }),
      port(5, { active: false }),
    ]);

    expect(config.tradeShipGold(300, player)).toBe(236_000n);
  });

  it("continues to count an active Port whose pending deletion is cancelable", () => {
    const config = payoutConfig(true, { goldMultiplier: 1 });
    expect(
      config.tradeShipGold(
        300,
        payoutPlayer([port(1, { markedForDeletion: true })]),
      ),
    ).toBe(100_000n);
  });

  it.each([undefined, false])(
    "preserves the legacy payout table when depthProgression is %s",
    (depthProgression) => {
      const config = payoutConfig(depthProgression, { goldMultiplier: 1 });
      const player = payoutPlayer([port(5)]);
      expect(
        [50, 100, 300, 600, 1000].map((distance) =>
          config.tradeShipGold(distance, player),
        ),
      ).toEqual([2_541n, 5_185n, 52_500n, 104_990n, 124_999n]);
    },
  );

  it.each([undefined, false])(
    "preserves legacy shared normal settlement when depthProgression is %s",
    async (depthProgression) => {
      expect(
        await completeNormalTrade(depthProgression, {
          hostCheats: { goldMultiplier: 3 },
        }),
      ).toEqual({
        sourceDelta: 157_500n,
        destinationDelta: 157_500n,
        sourceTradeStat: 157_500n,
        destinationTradeStat: 157_500n,
      });
    },
  );

  it("settles a real normal TradeShip asymmetrically and records exact stats", async () => {
    expect(await completeNormalTrade(true)).toEqual({
      sourceDelta: 200_000n,
      destinationDelta: 268_400n,
      sourceTradeStat: 200_000n,
      destinationTradeStat: 268_400n,
    });
  });

  it("uses the host source multiplier and destination base multiplier in separate ledgers", async () => {
    expect(
      await completeNormalTrade(true, {
        hostCheats: { goldMultiplier: 3 },
      }),
    ).toEqual({
      sourceDelta: 300_000n,
      destinationDelta: 268_400n,
      sourceTradeStat: 300_000n,
      destinationTradeStat: 268_400n,
    });
  });

  it("repeats the same real completion with an identical gold/stat ledger", async () => {
    const first = await completeNormalTrade(true);
    const second = await completeNormalTrade(true);
    expect(second).toEqual(first);
  });

  it("pays a captured route only to the captor using the captor's levels", async () => {
    expect(await completeCapturedTrade(true)).toEqual({
      victimDelta: 0n,
      captorDelta: 236_000n,
      captorStealStat: 236_000n,
      victimTradeStat: undefined,
    });
  });

  it.each([undefined, false])(
    "preserves legacy captured settlement when depthProgression is %s",
    async (depthProgression) => {
      expect(await completeCapturedTrade(depthProgression)).toEqual({
        victimDelta: 0n,
        captorDelta: 105_000n,
        captorStealStat: 105_000n,
        victimTradeStat: undefined,
      });
    },
  );
});
