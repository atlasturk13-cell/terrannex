import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canRestartSinglePlayer,
  consumeSinglePlayerRestart,
  forgetSinglePlayerStart,
  rememberSinglePlayerStart,
  restartSinglePlayer,
  SINGLE_PLAYER_RESTART_KEY,
} from "../../src/client/SinglePlayerRestart";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    map,
  };
}

const start = {
  gameID: "LocalNE1",
  gameStartInfo: {
    gameID: "LocalNE1",
    players: [
      {
        clientID: "LocalP01",
        username: "Atlas",
        clanTag: null,
        cosmetics: { color: { color: "#ff0000" } },
      },
    ],
    config: {
      gameMap: "World",
      gameType: "Singleplayer",
      difficulty: "Impossible",
      infiniteGold: true,
      instantBuild: true,
      bots: 0,
    },
    lobbyCreatedAt: 1,
  },
  source: "singleplayer" as const,
};
type Lobby = Parameters<typeof rememberSinglePlayerStart>[0];

describe("single-player restart with the same settings", () => {
  beforeEach(() => forgetSinglePlayerStart());

  it("remembers a fresh single-player start, stashes it on restart and joins it once after the reload", () => {
    expect(canRestartSinglePlayer()).toBe(false);
    rememberSinglePlayerStart(start as unknown as Lobby);
    expect(canRestartSinglePlayer()).toBe(true);

    const storage = memoryStorage();
    const navigate = vi.fn();
    expect(restartSinglePlayer(storage, navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledWith("/");
    expect(JSON.parse(storage.map.get(SINGLE_PLAYER_RESTART_KEY)!)).toEqual(
      start,
    );

    expect(consumeSinglePlayerRestart(storage)).toEqual(start);
    expect(storage.map.has(SINGLE_PLAYER_RESTART_KEY)).toBe(false);
    expect(consumeSinglePlayerRestart(storage)).toBeNull();
  });

  it("forgets replays and multiplayer lobbies and never navigates without a start", () => {
    rememberSinglePlayerStart(start as unknown as Lobby);
    rememberSinglePlayerStart({
      ...start,
      gameRecord: { turns: [] },
    } as unknown as Lobby);
    expect(canRestartSinglePlayer()).toBe(false);

    rememberSinglePlayerStart(start as unknown as Lobby);
    rememberSinglePlayerStart({ gameID: "ABCDEFGH", source: "public" });
    expect(canRestartSinglePlayer()).toBe(false);

    const storage = memoryStorage();
    const navigate = vi.fn();
    expect(restartSinglePlayer(storage, navigate)).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(storage.map.size).toBe(0);
  });

  it("drops malformed or foreign stashes instead of joining them", () => {
    const storage = memoryStorage();
    storage.setItem(SINGLE_PLAYER_RESTART_KEY, "{not json");
    expect(consumeSinglePlayerRestart(storage)).toBeNull();
    expect(storage.map.has(SINGLE_PLAYER_RESTART_KEY)).toBe(false);

    for (const junk of [
      { gameID: 7, gameStartInfo: start.gameStartInfo, source: "singleplayer" },
      {
        gameID: "LocalNE1",
        gameStartInfo: { config: {} },
        source: "singleplayer",
      },
      {
        gameID: "LocalNE1",
        gameStartInfo: start.gameStartInfo,
        source: "public",
      },
      null,
      "LocalNE1",
    ]) {
      storage.setItem(SINGLE_PLAYER_RESTART_KEY, JSON.stringify(junk));
      expect(consumeSinglePlayerRestart(storage)).toBeNull();
    }
    expect(consumeSinglePlayerRestart(null)).toBeNull();
  });
});
