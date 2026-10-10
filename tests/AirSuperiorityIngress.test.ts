import { expect, it } from "vitest";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  UnitType,
} from "../src/core/game/Game";
import {
  GameConfigSchema,
  RemoteGameConfigPartialSchema,
  RemoteGameConfigSchema,
  UpdateGameConfigIntentSchema,
} from "../src/core/Schemas";

const config = {
  gameMap: GameMapType.NaturalEarthWorld,
  difficulty: Difficulty.Medium,
  donateGold: false,
  donateTroops: false,
  gameType: GameType.Singleplayer,
  gameMode: GameMode.FFA,
  gameMapSize: GameMapSize.Normal,
  nations: "default" as const,
  bots: 4,
  infiniteGold: false,
  infiniteTroops: false,
  instantBuild: false,
  randomSpawn: false,
};

it("records the optional air-superiority flag but rejects it at every remote config ingress", () => {
  expect(
    GameConfigSchema.safeParse({ ...config, airSuperiorityV1: true }).success,
  ).toBe(true);
  expect(
    RemoteGameConfigSchema.safeParse({
      ...config,
      airSuperiorityV1: true,
    }).success,
  ).toBe(false);
  expect(
    RemoteGameConfigSchema.safeParse({
      ...config,
      airSuperiorityV1: false,
    }).success,
  ).toBe(true);
  expect(
    RemoteGameConfigPartialSchema.safeParse({ airSuperiorityV1: true }).success,
  ).toBe(false);
  expect(
    UpdateGameConfigIntentSchema.safeParse({
      type: "update_game_config",
      config: { airSuperiorityV1: true },
    }).success,
  ).toBe(false);
});

it("rejects the internal Fighter Missile in disabledUnits without throwing on stale input", () => {
  const stale = { ...config, disabledUnits: [UnitType.FighterMissile] };
  expect(() => GameConfigSchema.safeParse(stale)).not.toThrow();
  expect(GameConfigSchema.safeParse(stale).success).toBe(false);
  expect(
    GameConfigSchema.safeParse({
      ...config,
      disabledUnits: [UnitType.FighterJet],
    }).success,
  ).toBe(true);
});
