import { describe, expect, it } from "vitest";
import { GameMapType, GameType } from "../src/core/game/Game";
import { GameStartInfo } from "../src/core/Schemas";
import { toWireGameStartInfo } from "../src/core/Util";

function startInfo(config: Record<string, unknown>): GameStartInfo {
  return {
    gameID: "test-game",
    lobbyCreatedAt: 0,
    config,
    players: [
      {
        clientID: "clientAAA",
        username: "alice",
        clanTag: "AA",
        friends: ["clientBBB"],
        teamIndex: 0,
      },
      {
        clientID: "clientBBB",
        username: "bob",
        clanTag: null,
        friends: [],
        teamIndex: 1,
      },
    ],
  } as GameStartInfo;
}

describe("toWireGameStartInfo", () => {
  it("nulls every clanTag when clan tags are disabled, keeping friends", () => {
    const info = startInfo({
      gameType: GameType.Public,
      disableClanTags: true,
    });

    const wire = toWireGameStartInfo(info);

    expect(wire.players.map((p) => p.clanTag)).toEqual([null, null]);
    expect(wire.players[0].friends).toEqual(["clientBBB"]);
    // Non-simulation identity fields are untouched.
    expect(wire.players[0]).toMatchObject({
      clientID: "clientAAA",
      username: "alice",
      teamIndex: 0,
    });
  });

  it("nulls clanTags and drops friends when names are anonymized", () => {
    const info = startInfo({
      gameType: GameType.Private,
      anonymizeNames: true,
    });

    const wire = toWireGameStartInfo(info);

    expect(wire.players.map((p) => p.clanTag)).toEqual([null, null]);
    expect(wire.players.map((p) => p.friends)).toEqual([undefined, undefined]);
  });

  it("returns the record info untouched when neither setting is on", () => {
    const info = startInfo({ gameType: GameType.Public });

    expect(toWireGameStartInfo(info)).toBe(info);
  });

  it("leaves singleplayer records alone — they were simulated unblanked", () => {
    const info = startInfo({
      gameType: GameType.Singleplayer,
      disableClanTags: true,
      anonymizeNames: true,
    });

    expect(toWireGameStartInfo(info)).toBe(info);
  });

  it("keeps an absent depth profile absent in a legacy singleplayer replay", () => {
    const info = startInfo({
      gameType: GameType.Singleplayer,
      gameMap: GameMapType.NaturalEarthWorld,
    });
    const wire = toWireGameStartInfo(info);

    expect(wire).toBe(info);
    expect("depthProgression" in wire.config).toBe(false);
  });

  it.each([
    [GameType.Private, GameMapType.NaturalEarthWorld],
    [GameType.Public, GameMapType.NaturalEarthWorld],
    [GameType.Singleplayer, GameMapType.World],
  ])(
    "strips stale depth progression from %s / %s replay input",
    (gameType, gameMap) => {
      const info = startInfo({ gameType, gameMap, depthProgression: true });
      const wire = toWireGameStartInfo(info);

      expect(wire).not.toBe(info);
      expect("depthProgression" in wire.config).toBe(false);
      expect(info.config.depthProgression).toBe(true);
    },
  );

  it.each([GameMapType.NaturalEarthWorld, GameMapType.TheBox])(
    "preserves recorded depth progression for admitted %s local replays",
    (gameMap) => {
      const info = startInfo({
        gameType: GameType.Singleplayer,
        gameMap,
        depthProgression: true,
      });

      const wire = toWireGameStartInfo(info);

      expect(wire).toBe(info);
      expect(wire.config.depthProgression).toBe(true);
    },
  );

  it("preserves admitted recorded air superiority and strips stale copies", () => {
    const admitted = startInfo({
      airSuperiorityV1: true,
      gameType: GameType.Singleplayer,
      gameMap: GameMapType.NaturalEarthWorld,
    });
    expect(toWireGameStartInfo(admitted)).toBe(admitted);

    const stale = startInfo({
      airSuperiorityV1: true,
      gameType: GameType.Public,
      gameMap: GameMapType.NaturalEarthWorld,
    });
    const wire = toWireGameStartInfo(stale);
    expect(wire).not.toBe(stale);
    expect(wire.config.airSuperiorityV1).toBeUndefined();
    expect(stale.config.airSuperiorityV1).toBe(true);
  });

  it("does not mutate the input record", () => {
    const info = startInfo({
      gameType: GameType.Public,
      anonymizeNames: true,
    });

    toWireGameStartInfo(info);

    expect(info.players[0].clanTag).toBe("AA");
    expect(info.players[0].friends).toEqual(["clientBBB"]);
  });
});
