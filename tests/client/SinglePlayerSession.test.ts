import { describe, expect, it, vi } from "vitest";
import {
  createSinglePlayerSession,
  LOCAL_NATURAL_EARTH_GAME_ID,
  LOCAL_SKIRMISH_CLIENT_ID,
  LOCAL_SKIRMISH_GAME_ID,
} from "../../src/client/SinglePlayerSession";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  MatchTempo,
  VictoryCondition,
} from "../../src/core/game/Game";
import { LOCAL_PROVENANCE_SAFE_MAPS } from "../../src/core/game/LocalProvenanceSafeMaps";
import { GameConfig, ID, LocalSkirmishProfile } from "../../src/core/Schemas";

function config(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    gameMap: GameMapType.NaturalEarthWorld,
    difficulty: Difficulty.Hard,
    donateGold: false,
    donateTroops: false,
    gameType: GameType.Singleplayer,
    gameMode: GameMode.FFA,
    gameMapSize: GameMapSize.Compact,
    nations: "default",
    bots: 400,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    ...overrides,
  };
}

describe("createSinglePlayerSession", () => {
  it("uses the exact seven-map provenance-safe registry", () => {
    expect(LOCAL_PROVENANCE_SAFE_MAPS).toEqual([
      GameMapType.NaturalEarthWorld,
      GameMapType.TheBox,
      GameMapType.EuropeMediterranean,
      GameMapType.NorthAmericaCaribbean,
      GameMapType.NaturalEarthSouthAmerica,
      GameMapType.AfricaMiddleEast,
      GameMapType.AsiaPacific,
    ]);
  });

  it.each(LOCAL_PROVENANCE_SAFE_MAPS)(
    "preserves local air and depth rules on %s",
    (gameMap) => {
      const selected = config({
        gameMap,
        combinedArmsV1: true,
        combinedArmsV2: true,
        airSuperiorityV1: true,
        airportOperationsV1: true,
        depthProgression: true,
      });
      const session = createSinglePlayerSession(selected, true);
      expect(session.config.airportOperationsV1).toBe(true);
      expect(session.config.airSuperiorityV1).toBe(true);
      expect(session.config.depthProgression).toBe(true);
    },
  );
  it("preserves every selected Natural Earth setting and uses its stable ID", () => {
    const generateId = vi.fn(() => {
      throw new Error("local sessions must not generate random IDs");
    });
    const selected = config({
      difficulty: Difficulty.Impossible,
      bots: 7,
      nations: 12,
      infiniteGold: true,
      disabledUnits: [],
      startingGold: 4_000_000,
      combinedArmsV1: true,
      combinedArmsV2: true,
      airSuperiorityV1: true,
      airportOperationsV1: true,
      depthProgression: true,
      matchTempo: MatchTempo.Fast,
      victoryCondition: VictoryCondition.Elimination,
    });
    const session = createSinglePlayerSession(selected, true, generateId);

    expect(session).toEqual({
      gameID: LOCAL_NATURAL_EARTH_GAME_ID,
      clientID: LOCAL_SKIRMISH_CLIENT_ID,
      config: selected,
    });
    expect(ID.safeParse(session.gameID).success).toBe(true);
    expect(ID.safeParse(session.clientID).success).toBe(true);
    expect(session.config.localSkirmishProfile).toBeUndefined();
    expect(generateId).not.toHaveBeenCalled();
  });

  it("preserves The Box settings while applying only its wilderness profile", () => {
    const generateId = vi.fn(() => {
      throw new Error("local sessions must not generate random IDs");
    });
    const selected = config({
      gameMap: GameMapType.TheBox,
      difficulty: Difficulty.Hard,
      bots: 3,
      nations: 5,
      randomSpawn: true,
    });

    const session = createSinglePlayerSession(selected, true, generateId);

    expect(session).toEqual({
      gameID: LOCAL_SKIRMISH_GAME_ID,
      clientID: LOCAL_SKIRMISH_CLIENT_ID,
      config: {
        ...selected,
        localSkirmishProfile: LocalSkirmishProfile.TheBox,
      },
    });
    expect(generateId).not.toHaveBeenCalled();
  });

  it("removes a stale The Box profile from Natural Earth sessions", () => {
    const session = createSinglePlayerSession(
      config({ localSkirmishProfile: LocalSkirmishProfile.TheBox }),
      true,
    );
    expect(session.config.localSkirmishProfile).toBeUndefined();
  });

  it("fails closed for maps outside the local provenance allowlist", () => {
    expect(() =>
      createSinglePlayerSession(config({ gameMap: GameMapType.World }), true),
    ).toThrow("Map World is not available in local-only mode");
  });

  it("keeps non-local settings and fresh-ID generation behavior", () => {
    const ids = ["Client01", "Game0001", "Client02", "Game0002"];
    const generateId = vi.fn(() => ids.shift()!);
    const selected = config({
      gameMap: GameMapType.World,
      localSkirmishProfile: LocalSkirmishProfile.TheBox,
      airSuperiorityV1: true,
      airportOperationsV1: true,
      depthProgression: true,
    });

    const first = createSinglePlayerSession(selected, false, generateId);
    const second = createSinglePlayerSession(selected, false, generateId);
    const expectedConfig = { ...selected };
    delete expectedConfig.depthProgression;
    delete expectedConfig.airSuperiorityV1;
    delete expectedConfig.airportOperationsV1;

    expect(first).toEqual({
      clientID: "Client01",
      gameID: "Game0001",
      config: expectedConfig,
    });
    expect(second).toEqual({
      clientID: "Client02",
      gameID: "Game0002",
      config: expectedConfig,
    });
    expect(first.config.localSkirmishProfile).toBe(LocalSkirmishProfile.TheBox);
    expect(first.config.depthProgression).toBeUndefined();
    expect(first.config.airSuperiorityV1).toBeUndefined();
    expect(first.config.airportOperationsV1).toBeUndefined();
    expect(first.gameID).not.toBe(second.gameID);
    expect(first.clientID).not.toBe(second.clientID);
    expect(generateId).toHaveBeenCalledTimes(4);
  });

  it("preserves absent and false depth values by object identity outside local mode", () => {
    const absent = config({ gameMap: GameMapType.World });
    const disabled = config({
      gameMap: GameMapType.World,
      depthProgression: false,
    });
    const ids = ["Client01", "Game0001", "Client02", "Game0002"];
    const generateId = () => ids.shift()!;

    expect(createSinglePlayerSession(absent, false, generateId).config).toBe(
      absent,
    );
    expect(createSinglePlayerSession(disabled, false, generateId).config).toBe(
      disabled,
    );
  });

  it("strips local-only rules from a local session that is not Singleplayer", () => {
    const session = createSinglePlayerSession(
      config({
        airSuperiorityV1: true,
        airportOperationsV1: true,
        gameType: GameType.Private,
        depthProgression: true,
      }),
      true,
    );

    expect(session.config.depthProgression).toBeUndefined();
    expect(session.config.airSuperiorityV1).toBeUndefined();
    expect(session.config.airportOperationsV1).toBeUndefined();
  });
});
