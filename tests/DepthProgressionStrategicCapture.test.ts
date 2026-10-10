import { describe, expect, it } from "vitest";
import { Config } from "../src/core/configuration/Config";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { GameConfig } from "../src/core/Schemas";
import { setup } from "./util/Setup";

const humanInfo = new PlayerInfo("Human", PlayerType.Human, null, "human");
const botInfo = new PlayerInfo("Tribe", PlayerType.Bot, null, "tribe");
const nationInfo = new PlayerInfo("Nation", PlayerType.Nation, null, "nation");

function config(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    gameMap: GameMapType.NaturalEarthWorld,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Singleplayer,
    difficulty: Difficulty.Medium,
    nations: "default",
    donateGold: false,
    donateTroops: false,
    bots: 1,
    infiniteGold: true,
    infiniteTroops: true,
    instantBuild: true,
    randomSpawn: false,
    ...overrides,
  };
}

async function players(gameConfig: Partial<GameConfig> = {}) {
  const game = await setup("plains", config(gameConfig), [
    humanInfo,
    botInfo,
    nationInfo,
  ]);
  const human = game.player(humanInfo.id);
  const bot = game.player(botInfo.id);
  const nation = game.player(nationInfo.id);
  human.conquer(game.ref(5, 5));
  bot.conquer(game.ref(6, 5));
  nation.conquer(game.ref(7, 5));
  return { game, human, bot, nation };
}

describe("depth progression strategic structure capture", () => {
  it("enables only for explicitly recorded local single-player maps", () => {
    expect(
      new Config(
        config({ depthProgression: true }),
        null,
        true,
      ).depthProgressionEnabled(),
    ).toBe(true);
    expect(
      new Config(
        config({ gameMap: GameMapType.TheBox, depthProgression: true }),
        null,
        true,
      ).depthProgressionEnabled(),
    ).toBe(true);
    expect(
      new Config(
        config({ gameMap: GameMapType.World, depthProgression: true }),
        null,
        true,
      ).depthProgressionEnabled(),
    ).toBe(false);
    expect(
      new Config(
        config({ gameType: GameType.Private, depthProgression: true }),
        null,
        true,
      ).depthProgressionEnabled(),
    ).toBe(false);
    expect(
      new Config(
        config({ depthProgression: false }),
        null,
        true,
      ).depthProgressionEnabled(),
    ).toBe(false);
  });

  it("destroys captured Silo and SAM before a simple Tribe can own or execute them", async () => {
    const { game, human, bot } = await players({ depthProgression: true });
    const silo = human.buildUnit(UnitType.MissileSilo, game.ref(5, 5), {});
    const sam = human.buildUnit(UnitType.SAMLauncher, game.ref(5, 6), {});

    bot.captureUnit(silo);
    bot.captureUnit(sam);

    expect(silo.isActive()).toBe(false);
    expect(sam.isActive()).toBe(false);
    expect(silo.owner()).toBe(human);
    expect(sam.owner()).toBe(human);
    expect(bot.units(UnitType.MissileSilo)).toHaveLength(0);
    expect(bot.units(UnitType.SAMLauncher)).toHaveLength(0);
    expect(human.units(UnitType.MissileSilo)).toHaveLength(0);
    expect(human.units(UnitType.SAMLauncher)).toHaveLength(0);
  });

  it("still transfers strategic structures to Human and Nation captors", async () => {
    const { game, human, nation } = await players({ depthProgression: true });
    const silo = human.buildUnit(UnitType.MissileSilo, game.ref(5, 5), {});
    const sam = nation.buildUnit(UnitType.SAMLauncher, game.ref(7, 5), {});

    nation.captureUnit(silo);
    human.captureUnit(sam);

    expect(silo.isActive()).toBe(true);
    expect(silo.owner()).toBe(nation);
    expect(sam.isActive()).toBe(true);
    expect(sam.owner()).toBe(human);
  });

  it.each([undefined, false])(
    "keeps legacy active Tribe transfers when depthProgression is %s",
    async (depthProgression) => {
      const { game, human, bot } = await players({ depthProgression });
      const silo = human.buildUnit(UnitType.MissileSilo, game.ref(5, 5), {});
      const sam = human.buildUnit(UnitType.SAMLauncher, game.ref(5, 6), {});

      bot.captureUnit(silo);
      bot.captureUnit(sam);

      expect(silo.isActive()).toBe(true);
      expect(sam.isActive()).toBe(true);
      expect(silo.owner()).toBe(bot);
      expect(sam.owner()).toBe(bot);
    },
  );

  it("does not alter Ports, Cities, Factories, or ship captures", async () => {
    const { game, human, bot } = await players({ depthProgression: true });
    const captured = [
      human.buildUnit(UnitType.Port, game.ref(5, 5), {}),
      human.buildUnit(UnitType.City, game.ref(5, 6), {}),
      human.buildUnit(UnitType.Factory, game.ref(5, 7), {}),
      human.buildUnit(UnitType.TransportShip, game.ref(5, 8), { troops: 0 }),
    ];

    for (const unit of captured) bot.captureUnit(unit);

    for (const unit of captured) {
      expect(unit.isActive()).toBe(true);
      expect(unit.owner()).toBe(bot);
    }
  });
});
