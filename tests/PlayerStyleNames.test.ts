import { aiCommanderTotal, aiRoster } from "../src/client/LobbyAiRoster";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  HumansVsNations,
} from "../src/core/game/Game";
import { createNationsForGame } from "../src/core/game/NationCreation";
import {
  playerStyleNames,
  usesPlayerStyleNames,
} from "../src/core/game/PlayerStyleNames";
import { Nation as ManifestNation } from "../src/core/game/TerrainMapLoader";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { GameConfig, GameStartInfo, UsernameSchema } from "../src/core/Schemas";

function config(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    gameMap: GameMapType.World,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Public,
    difficulty: Difficulty.Medium,
    nations: 30,
    donateGold: false,
    donateTroops: false,
    bots: 0,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    ...overrides,
  };
}

function start(c: GameConfig, gameID = "Ab12Cd34"): GameStartInfo {
  return { gameID, lobbyCreatedAt: 0, config: c, players: [] };
}

const manifest: ManifestNation[] = Array.from({ length: 12 }, (_, i) => ({
  coordinates: [i * 3, i * 2],
  flag: "",
  name: `Country${i}`,
}));

describe("player-style AI commander names", () => {
  it("apply to public lobbies except Humans vs Nations", () => {
    expect(usesPlayerStyleNames(config())).toBe(true);
    expect(
      usesPlayerStyleNames(config({ gameMode: GameMode.Team, playerTeams: 4 })),
    ).toBe(true);
    expect(
      usesPlayerStyleNames(
        config({ gameMode: GameMode.Team, playerTeams: HumansVsNations }),
      ),
    ).toBe(false);
    expect(usesPlayerStyleNames(config({ gameType: GameType.Private }))).toBe(
      false,
    );
    expect(
      usesPlayerStyleNames(config({ gameType: GameType.Singleplayer })),
    ).toBe(false);
  });

  it("are deterministic, distinct, short and valid player names", () => {
    const a = playerStyleNames("Ab12Cd34", 60);
    expect(playerStyleNames("Ab12Cd34", 60)).toEqual(a);
    expect(playerStyleNames("Zz99Yy88", 60)).not.toEqual(a);
    expect(new Set(a).size).toBe(60);
    for (const name of a) {
      expect(name.length).toBeLessThanOrEqual(20);
      expect(UsernameSchema.safeParse(name).success).toBe(true);
    }
    // A prefix of a longer list: the lobby and the match agree on any count.
    expect(playerStyleNames("Ab12Cd34", 10)).toEqual(a.slice(0, 10));
  });

  it("rename public-lobby nations without touching spawns, ids or the PRNG", () => {
    const publicStart = start(config());
    const privateStart = start(config({ gameType: GameType.Private }));
    const r1 = new PseudoRandom(42);
    const r2 = new PseudoRandom(42);
    const pub = createNationsForGame(publicStart, manifest, [], 1, r1);
    const priv = createNationsForGame(privateStart, manifest, [], 1, r2);

    expect(pub).toHaveLength(30);
    expect(pub.map((n) => n.playerInfo.name)).toEqual(
      playerStyleNames("Ab12Cd34", 30),
    );
    expect(pub.map((n) => n.playerInfo.id)).toEqual(
      priv.map((n) => n.playerInfo.id),
    );
    expect(pub.map((n) => n.spawnCell?.x)).toEqual(
      priv.map((n) => n.spawnCell?.x),
    );
    // Same main stream position afterwards: the rest of the match is unchanged.
    expect(r1.next()).toBe(r2.next());
    expect(priv[0].playerInfo.name.startsWith("Country")).toBe(true);
  });

  it("are the names the lobby card shows", () => {
    const c = config({ nations: 19 });
    const total = aiCommanderTotal(c, manifest.length, 2);
    expect(total).toBe(19);
    const roster = aiRoster("Ab12Cd34", ["Country0"], total, c);
    expect(new Set(roster.map((e) => e.name))).toEqual(
      new Set(playerStyleNames("Ab12Cd34", 19)),
    );
    const matchNames = createNationsForGame(
      start(c),
      manifest,
      [],
      2,
      new PseudoRandom(7),
    ).map((n) => n.playerInfo.name);
    expect(new Set(matchNames)).toEqual(new Set(roster.map((e) => e.name)));
  });
});
