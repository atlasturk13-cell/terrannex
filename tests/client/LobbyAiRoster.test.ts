import { describe, expect, it } from "vitest";
import {
  AI_JOIN_WINDOW_MS,
  aiCommanderTotal,
  aiCommandersPresent,
  aiRoster,
} from "../../src/client/LobbyAiRoster";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  HumansVsNations,
} from "../../src/core/game/Game";
import type { GameConfig } from "../../src/core/Schemas";

function config(overrides: Partial<GameConfig>): GameConfig {
  return {
    gameMap: GameMapType.NaturalEarthWorld,
    difficulty: Difficulty.Medium,
    donateGold: false,
    donateTroops: false,
    gameType: GameType.Public,
    gameMode: GameMode.FFA,
    gameMapSize: GameMapSize.Normal,
    nations: "default",
    bots: 400,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    ...overrides,
  } as GameConfig;
}

const NAMES = Array.from({ length: 20 }, (_, i) => `Nation ${i + 1}`);

describe("AI commanders in public lobbies", () => {
  it("counts the nations the match will spawn", () => {
    expect(aiCommanderTotal(undefined, 20, 3)).toBe(0);
    expect(aiCommanderTotal(config({}), 20, 3)).toBe(20);
    expect(
      aiCommanderTotal(config({ gameMapSize: GameMapSize.Compact }), 20, 3),
    ).toBe(5);
    expect(aiCommanderTotal(config({ nations: "disabled" }), 20, 3)).toBe(0);
    expect(
      aiCommanderTotal(config({ gameMode: GameMode.Team, nations: 7 }), 20, 3),
    ).toBe(7);
    // Humans vs nations matches the humans in the lobby.
    expect(
      aiCommanderTotal(
        config({ gameMode: GameMode.Team, playerTeams: HumansVsNations }),
        20,
        4,
      ),
    ).toBe(4);
  });

  it("derives one roster per game id, the same on every client", () => {
    const a = aiRoster("GAME0001", NAMES, 12);
    const b = aiRoster("GAME0001", NAMES, 12);
    const other = aiRoster("GAME0002", NAMES, 12);
    expect(a).toEqual(b);
    expect(a.map((e) => e.name)).not.toEqual(other.map((e) => e.name));
    expect(new Set(a.map((e) => e.name)).size).toBe(12);
    for (const entry of a) expect(NAMES).toContain(entry.name);
    // Beyond the map's nations the roster gets generated nation names.
    const padded = aiRoster("GAME0001", NAMES.slice(0, 2), 30);
    expect(padded).toHaveLength(30);
    expect(new Set(padded.map((e) => e.name)).size).toBe(30);
    expect(aiRoster("GAME0001", NAMES, 0)).toEqual([]);
  });

  it("fills the lobby over the countdown and is complete before the start", () => {
    const roster = aiRoster("GAME0003", NAMES, 20);
    const queued = aiCommandersPresent(roster, null);
    const opening = aiCommandersPresent(roster, AI_JOIN_WINDOW_MS);
    const midway = aiCommandersPresent(roster, AI_JOIN_WINDOW_MS / 2);
    const lastSecond = aiCommandersPresent(roster, 1000);
    expect(queued).toHaveLength(6);
    expect(opening).toHaveLength(6);
    expect(midway.length).toBeGreaterThan(opening.length);
    expect(midway.length).toBeLessThan(20);
    expect(lastSecond).toHaveLength(20);
    expect(aiCommandersPresent(roster, -5000)).toHaveLength(20);
    // Arrivals only ever add names; nobody leaves as time runs down.
    let previous: string[] = [];
    for (let ms = AI_JOIN_WINDOW_MS; ms >= 0; ms -= 500) {
      const names = aiCommandersPresent(roster, ms).map((e) => e.name);
      expect(names.slice(0, previous.length)).toEqual(previous);
      previous = names;
    }
  });
});
