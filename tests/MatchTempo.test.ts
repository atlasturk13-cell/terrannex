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
  UnitType,
  VictoryCondition,
} from "../src/core/game/Game";
import { GameConfig, GameConfigSchema } from "../src/core/Schemas";

function gameConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    gameMap: GameMapType.World,
    gameMapSize: GameMapSize.Normal,
    gameType: GameType.Singleplayer,
    gameMode: GameMode.FFA,
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
    ...overrides,
  };
}

function player(): Player {
  return {
    type: () => PlayerType.Human,
    numTilesOwned: () => 10_000,
    troops: () => 250_000,
    units: () => [],
    isLobbyCreator: () => false,
  } as unknown as Player;
}

describe("match tempo compatibility", () => {
  it("accepts the named choices and rejects unknown wire values", () => {
    expect(
      GameConfigSchema.safeParse(
        gameConfig({
          matchTempo: MatchTempo.Slow,
          victoryCondition: VictoryCondition.Elimination,
        }),
      ).success,
    ).toBe(true);
    expect(
      GameConfigSchema.safeParse({
        ...gameConfig(),
        matchTempo: "turbo",
        victoryCondition: "score",
      }).success,
    ).toBe(false);
  });

  it("keeps omitted fields absent and resolves exact legacy defaults", () => {
    const oldConfig = gameConfig();
    const parsed = GameConfigSchema.parse(oldConfig);
    const omitted = new Config(parsed, null, false);
    const medium = new Config(
      gameConfig({
        matchTempo: MatchTempo.Medium,
        victoryCondition: VictoryCondition.Territory,
      }),
      null,
      false,
    );
    const fixture = player();

    expect(parsed).not.toHaveProperty("matchTempo");
    expect(parsed).not.toHaveProperty("victoryCondition");
    expect(omitted.matchTempo()).toBe(MatchTempo.Medium);
    expect(omitted.victoryCondition()).toBe(VictoryCondition.Territory);
    expect(omitted.msPerTick()).toBe(100);
    expect(omitted.goldAdditionRate(fixture)).toBe(
      medium.goldAdditionRate(fixture),
    );
    expect(omitted.troopIncreaseRate(fixture)).toBe(
      medium.troopIncreaseRate(fixture),
    );
    expect(omitted.unitInfo(UnitType.City).constructionDuration).toBe(
      medium.unitInfo(UnitType.City).constructionDuration,
    );
    expect(omitted.SAMCooldown()).toBe(medium.SAMCooldown());
    expect(omitted.fighterLaunchCooldown()).toBe(
      medium.fighterLaunchCooldown(),
    );
  });

  it("changes rates and construction/cooldown ticks without changing playback", () => {
    const slow = new Config(
      gameConfig({ matchTempo: MatchTempo.Slow }),
      null,
      false,
    );
    const medium = new Config(
      gameConfig({ matchTempo: MatchTempo.Medium }),
      null,
      false,
    );
    const fast = new Config(
      gameConfig({ matchTempo: MatchTempo.Fast }),
      null,
      false,
    );
    const fixture = player();
    const mediumTroops = medium.troopIncreaseRate(fixture);

    expect(slow.goldAdditionRate(fixture)).toBe(75n);
    expect(medium.goldAdditionRate(fixture)).toBe(100n);
    expect(fast.goldAdditionRate(fixture)).toBe(150n);
    expect(slow.troopIncreaseRate(fixture)).toBeCloseTo(
      mediumTroops * 0.75,
      10,
    );
    expect(fast.troopIncreaseRate(fixture)).toBeCloseTo(mediumTroops * 1.5, 10);
    expect([
      slow.unitInfo(UnitType.City).constructionDuration,
      medium.unitInfo(UnitType.City).constructionDuration,
      fast.unitInfo(UnitType.City).constructionDuration,
    ]).toEqual([27, 20, 13]);
    expect([
      slow.SiloCooldown(),
      medium.SiloCooldown(),
      fast.SiloCooldown(),
    ]).toEqual([120, 90, 60]);
    expect([slow.msPerTick(), medium.msPerTick(), fast.msPerTick()]).toEqual([
      100, 100, 100,
    ]);
  });
});
