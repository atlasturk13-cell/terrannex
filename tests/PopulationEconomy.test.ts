import { describe, expect, it } from "vitest";
import { Config } from "../src/core/configuration/Config";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  MatchTempo,
  Player,
  PlayerType,
  Unit,
  UnitType,
} from "../src/core/game/Game";
import { GameConfig } from "../src/core/Schemas";

interface LevelFixture {
  level: number;
  underConstruction?: boolean;
}

interface PlayerFixture {
  type?: PlayerType;
  tiles?: number;
  troops: number;
  cities?: LevelFixture[];
  barracks?: LevelFixture[];
  warships?: Array<{ troops: number; active: boolean }>;
}

function config(
  options: {
    depthProgression?: boolean;
    difficulty?: Difficulty;
    matchTempo?: MatchTempo;
  } = {},
): Config {
  const gameConfig: GameConfig = {
    gameMap: GameMapType.TheBox,
    gameMapSize: GameMapSize.Normal,
    gameType: GameType.Singleplayer,
    gameMode: GameMode.FFA,
    playerTeams: 2,
    difficulty: options.difficulty ?? Difficulty.Hard,
    bots: 0,
    nations: "disabled",
    donateGold: false,
    donateTroops: false,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    disabledUnits: [],
    ...(options.depthProgression === undefined
      ? {}
      : { depthProgression: options.depthProgression }),
    ...(options.matchTempo === undefined
      ? {}
      : { matchTempo: options.matchTempo }),
  };
  return new Config(gameConfig, null, false);
}

function structures(levels: LevelFixture[] | undefined): Unit[] {
  return (levels ?? []).map(
    ({ level, underConstruction = false }) =>
      ({
        isUnderConstruction: () => underConstruction,
        level: () => level,
      }) as Unit,
  );
}

function player(fixture: PlayerFixture): Player {
  const cities = structures(fixture.cities);
  const barracks = structures(fixture.barracks);
  const warships = (fixture.warships ?? []).map(
    ({ troops, active }) =>
      ({ isActive: () => active, troops: () => troops }) as Unit,
  );
  return {
    type: () => fixture.type ?? PlayerType.Human,
    numTilesOwned: () => fixture.tiles ?? 0,
    troops: () => fixture.troops,
    units: (unitType: UnitType) => {
      if (unitType === UnitType.City) return cities;
      if (unitType === UnitType.Barracks) return barracks;
      if (unitType === UnitType.Warship) return warships;
      return [];
    },
  } as unknown as Player;
}

/** The population growth rule, written out independently of the code. */
function expectedRate(
  population: number,
  army: number,
  barracksLevels: number,
  modifier = 1,
  tempo = 1,
): number {
  const remaining = population - army;
  const base = 10 + Math.pow(population, 0.73) / 8;
  const barracks = Math.min(4, 1 + 0.25 * barracksLevels);
  return Math.min(
    base * (remaining / population) * barracks * modifier * tempo,
    remaining,
  );
}

describe("population economy", () => {
  it("territory adds no population; the capital, cities and barracks do", () => {
    const rules = config();
    expect(rules.maxTroops(player({ tiles: 0, troops: 0 }))).toBe(150_000);
    expect(rules.maxTroops(player({ tiles: 50_000, troops: 0 }))).toBe(150_000);
    expect(
      rules.maxTroops(
        player({
          tiles: 10,
          troops: 0,
          cities: [
            { level: 2 },
            { level: 1 },
            { level: 3, underConstruction: true },
          ],
          barracks: [{ level: 2 }, { level: 1, underConstruction: true }],
        }),
      ),
    ).toBe(150_000 + 3 * 250_000 + 2 * 50_000);
  });

  it("is the same in the depth profile and in multiplayer", () => {
    const fixture = player({
      troops: 200_000,
      cities: [{ level: 1 }],
      barracks: [{ level: 2 }],
    });
    for (const depthProgression of [true, false, undefined]) {
      const rules = config({ depthProgression });
      expect(rules.maxTroops(fixture)).toBe(500_000);
      expect(rules.troopIncreaseRate(fixture)).toBeCloseTo(
        expectedRate(500_000, 200_000, 2),
        9,
      );
    }
  });

  it("a bigger population trains faster, and each barracks level adds a quarter", () => {
    const rules = config();
    const at = (cities: number, barracks: number) => {
      const fixture = {
        troops: 0,
        cities: Array.from({ length: cities }, () => ({ level: 1 })),
        barracks: Array.from({ length: barracks }, () => ({ level: 1 })),
      };
      const population = rules.maxTroops(player(fixture));
      // Compare at the same fill (half the population under arms).
      return rules.troopIncreaseRate(
        player({ ...fixture, troops: population / 2 }),
      );
    };
    expect(at(4, 0)).toBeGreaterThan(at(1, 0));
    expect(at(1, 0)).toBeGreaterThan(at(0, 0));
    // Barracks: +25% per level on the rate of the same population…
    const rulesPopulation = 400_000;
    const same = (levels: number) =>
      rules.troopIncreaseRate(
        player({
          troops: 100_000,
          cities: [{ level: 1 }],
          barracks: levels === 0 ? [] : [{ level: levels }],
        }),
      );
    // …while the barracks also house people, so compare with the formula.
    expect(same(0)).toBeCloseTo(expectedRate(rulesPopulation, 100_000, 0), 9);
    expect(same(2)).toBeCloseTo(
      expectedRate(rulesPopulation + 100_000, 100_000, 2),
      9,
    );
    expect(rules.barracksTroopRateMultiplier(0)).toBe(1);
    expect(rules.barracksTroopRateMultiplier(4)).toBe(2);
    expect(rules.barracksTroopRateMultiplier(12)).toBe(4);
    expect(rules.barracksTroopRateMultiplier(40)).toBe(4);
  });

  it("slows as the army fills the population and counts troops at sea", () => {
    const rules = config();
    const full = player({ troops: 150_000 });
    expect(rules.troopIncreaseRate(full)).toBe(0);
    const ashore = player({ troops: 100_000 });
    const withMarines = player({
      troops: 100_000,
      warships: [
        { troops: 30_000, active: true },
        { troops: 99_000, active: false },
      ],
    });
    expect(rules.troopIncreaseRate(ashore)).toBeCloseTo(
      expectedRate(150_000, 100_000, 0),
      9,
    );
    expect(rules.troopIncreaseRate(withMarines)).toBeCloseTo(
      expectedRate(150_000, 130_000, 0),
      9,
    );
    // Never more than the room left.
    const almost = player({ troops: 149_990, barracks: [{ level: 12 }] });
    expect(rules.troopIncreaseRate(almost)).toBeLessThanOrEqual(
      rules.maxTroops(almost) - 149_990,
    );
  });

  it("an army above the population, after a city is lost, dwindles back", () => {
    const rules = config();
    const over = player({ troops: 400_000 });
    const rate = rules.troopIncreaseRate(over);
    expect(rate).toBeLessThan(0);
    expect(-rate).toBeLessThanOrEqual(250_000);
    expect(rate).toBeCloseTo(
      -(10 + Math.pow(400_000, 0.73) / 4) * (250_000 / 150_000),
      9,
    );
  });

  it.each([
    [Difficulty.Easy, 0.5, 0.9],
    [Difficulty.Medium, 0.75, 0.95],
    [Difficulty.Hard, 1, 1],
    [Difficulty.Impossible, 1.25, 1.05],
  ])(
    "nations on %s get the cap and pace modifiers",
    (difficulty, capModifier, paceModifier) => {
      const rules = config({ difficulty });
      const nation = player({
        type: PlayerType.Nation,
        troops: 0,
        cities: [{ level: 1 }],
      });
      const population = 400_000 * capModifier;
      expect(rules.maxTroops(nation)).toBeCloseTo(population, 9);
      const half = player({
        type: PlayerType.Nation,
        troops: population / 2,
        cities: [{ level: 1 }],
      });
      expect(rules.troopIncreaseRate(half)).toBeCloseTo(
        expectedRate(population, population / 2, 0, paceModifier),
        9,
      );
    },
  );

  it("match tempo scales the pace, not the population", () => {
    for (const [tempo, factor] of [
      [MatchTempo.Slow, 0.75],
      [MatchTempo.Medium, 1],
      [MatchTempo.Fast, 1.5],
    ] as const) {
      const rules = config({ matchTempo: tempo });
      const fixture = player({ troops: 50_000 });
      expect(rules.maxTroops(fixture)).toBe(150_000);
      expect(rules.troopIncreaseRate(fixture)).toBeCloseTo(
        expectedRate(150_000, 50_000, 0, 1, factor),
        9,
      );
    }
  });

  it("tribes keep the land-based cap and their old pace", () => {
    const rules = config();
    const tribe = player({ type: PlayerType.Bot, tiles: 10_000, troops: 0 });
    const cap = (2 * (Math.pow(10_000, 0.6) * 1000 + 50_000)) / 3;
    expect(rules.maxTroops(tribe)).toBeCloseTo(cap, 9);
    const half = player({
      type: PlayerType.Bot,
      tiles: 10_000,
      troops: cap / 2,
    });
    expect(rules.troopIncreaseRate(half)).toBeCloseTo(
      (10 + Math.pow(cap / 2, 0.73) / 4) * 0.5 * 0.5,
      9,
    );
    const depth = config({ depthProgression: true });
    const remaining = cap / 2;
    expect(depth.troopIncreaseRate(half)).toBeCloseTo(
      (10 + Math.pow(cap, 0.73) / 6) * (remaining / cap) * 0.2,
      9,
    );
  });

  it("barracks are an upgradable structure cheaper than a city", () => {
    const rules = config();
    const info = rules.unitInfo(UnitType.Barracks);
    expect(info.upgradable).toBe(true);
    expect(info.constructionDuration).toBe(150);
    const cost = (owned: number) =>
      info.cost(
        {} as never,
        {
          type: () => PlayerType.Human,
          unitsOwned: () => owned,
          unitsConstructed: () => owned,
        } as never,
      );
    expect(cost(0)).toBe(75_000n);
    expect(cost(1)).toBe(150_000n);
    expect(cost(3)).toBe(600_000n);
    expect(cost(6)).toBe(600_000n);
  });
});
