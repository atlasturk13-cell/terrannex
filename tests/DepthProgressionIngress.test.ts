import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../src/core/game/Game";
import {
  GameConfigSchema,
  RemoteGameConfigPartialSchema,
  RemoteGameConfigSchema,
  UpdateGameConfigIntentSchema,
} from "../src/core/Schemas";
import {
  CreateGameInputSchema,
  GameInputSchema,
} from "../src/core/WorkerSchemas";
import { GameManager } from "../src/server/GameManager";
import { MasterMessageSchema } from "../src/server/IPCBridgeSchema";

const config = {
  gameMap: GameMapType.World,
  difficulty: Difficulty.Medium,
  donateGold: false,
  donateTroops: false,
  gameType: GameType.Private,
  gameMode: GameMode.FFA,
  gameMapSize: GameMapSize.Normal,
  nations: "default" as const,
  bots: 4,
  infiniteGold: false,
  infiniteTroops: false,
  instantBuild: false,
  randomSpawn: false,
};

describe("depth progression ingress schemas", () => {
  it("keeps the optional game config compatible while remote full and partial inputs reject true", () => {
    expect(GameConfigSchema.safeParse(config).success).toBe(true);
    expect(
      GameConfigSchema.safeParse({ ...config, depthProgression: true }).success,
    ).toBe(true);
    expect(
      RemoteGameConfigSchema.safeParse({ ...config, depthProgression: false })
        .success,
    ).toBe(true);
    expect(
      RemoteGameConfigSchema.safeParse({ ...config, depthProgression: true })
        .success,
    ).toBe(false);
    expect(GameInputSchema.safeParse({ depthProgression: true }).success).toBe(
      false,
    );
    expect(GameInputSchema.safeParse({ depthProgression: false }).success).toBe(
      true,
    );
    expect(
      RemoteGameConfigPartialSchema.safeParse({ depthProgression: true })
        .success,
    ).toBe(false);
    expect(
      CreateGameInputSchema.safeParse({ ...config, depthProgression: true })
        .success,
    ).toBe(false);
    expect(CreateGameInputSchema.safeParse(config).success).toBe(true);
    expect(
      CreateGameInputSchema.safeParse({ ...config, depthProgression: false })
        .success,
    ).toBe(true);
  });

  it("rejects remote config updates and public IPC creation before they reach a game", () => {
    expect(
      UpdateGameConfigIntentSchema.safeParse({
        type: "update_game_config",
        config: { depthProgression: true },
      }).success,
    ).toBe(false);
    expect(
      UpdateGameConfigIntentSchema.safeParse({
        type: "update_game_config",
        config: {},
      }).success,
    ).toBe(true);
    expect(
      UpdateGameConfigIntentSchema.safeParse({
        type: "update_game_config",
        config: { depthProgression: false },
      }).success,
    ).toBe(true);
    expect(
      MasterMessageSchema.safeParse({
        type: "createGame",
        gameID: "PublicDP1",
        gameConfig: {
          ...config,
          gameType: GameType.Public,
          depthProgression: true,
        },
        publicGameType: "ffa",
      }).success,
    ).toBe(false);
  });
});

describe("depth progression allocation backstop", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  it("refuses true without storing a game while absent and false remain allocatable", () => {
    const log: any = { child: vi.fn().mockReturnThis(), warn: vi.fn() };
    const games = new GameManager(log);

    expect(
      games.createGame("depthTrue", { depthProgression: true }),
    ).toBeNull();
    expect(games.game("depthTrue")).toBeNull();
    expect(
      games.createGame("depthFalse", { depthProgression: false }),
    ).not.toBeNull();
    expect(games.createGame("depthAbsent", undefined)).not.toBeNull();
    expect(games.game("depthFalse")?.gameConfig.depthProgression).toBe(false);
    expect(
      games.game("depthAbsent")?.gameConfig.depthProgression,
    ).toBeUndefined();
  });
});
