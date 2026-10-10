import { describe, expect, it } from "vitest";
import {
  applyPerMille,
  applyPerMilleBigint,
  levelForXp,
  MATCH_XP,
  matchOutcome,
  MAX_PROGRESSION_LEVEL,
  progressionBonus,
  xpAtLevel,
  xpForNextLevel,
} from "../../src/core/Progression";

describe("account progression", () => {
  it("needs more experience for every level and stops at the cap", () => {
    expect(xpForNextLevel(0)).toBe(100);
    expect(xpForNextLevel(1)).toBe(140);
    expect(xpForNextLevel(29)).toBe(1260);
    expect(xpAtLevel(1)).toBe(100);
    expect(xpAtLevel(2)).toBe(240);
    expect(xpAtLevel(MAX_PROGRESSION_LEVEL)).toBe(20_400);
    expect(levelForXp(0)).toBe(0);
    expect(levelForXp(99)).toBe(0);
    expect(levelForXp(100)).toBe(1);
    expect(levelForXp(239)).toBe(1);
    expect(levelForXp(240)).toBe(2);
    expect(levelForXp(20_400)).toBe(MAX_PROGRESSION_LEVEL);
    expect(levelForXp(20_399)).toBe(MAX_PROGRESSION_LEVEL - 1);
    expect(levelForXp(1_000_000)).toBe(MAX_PROGRESSION_LEVEL);
    expect(levelForXp(-5)).toBe(0);
  });

  it("is slow: the cap is hundreds of wins away", () => {
    expect(Math.ceil(xpAtLevel(MAX_PROGRESSION_LEVEL) / MATCH_XP.win)).toBe(
      340,
    );
    expect(Math.ceil(xpAtLevel(MAX_PROGRESSION_LEVEL) / MATCH_XP.played)).toBe(
      1020,
    );
    // The first level takes two wins or five ordinary matches.
    expect(levelForXp(2 * MATCH_XP.win)).toBe(1);
    expect(levelForXp(4 * MATCH_XP.played)).toBe(0);
    expect(levelForXp(5 * MATCH_XP.played)).toBe(1);
  });

  it("gives a small, capped head start", () => {
    expect(progressionBonus(0)).toEqual({
      level: 0,
      troopsPerMille: 0,
      goldPerMille: 0,
      spawnRings: 0,
    });
    expect(progressionBonus(7)).toEqual({
      level: 7,
      troopsPerMille: 35,
      goldPerMille: 70,
      spawnRings: 0,
    });
    expect(progressionBonus(10).spawnRings).toBe(1);
    expect(progressionBonus(MAX_PROGRESSION_LEVEL)).toEqual({
      level: 30,
      troopsPerMille: 150,
      goldPerMille: 300,
      spawnRings: 3,
    });
    expect(progressionBonus(99)).toEqual(progressionBonus(30));
    expect(progressionBonus(-1)).toEqual(progressionBonus(0));
  });

  it("applies per-mille bonuses with integer results", () => {
    expect(applyPerMille(25_000, 0)).toBe(25_000);
    expect(applyPerMille(25_000, 35)).toBe(25_875);
    expect(applyPerMille(25_000, 150)).toBe(28_750);
    expect(applyPerMille(333, 5)).toBe(334);
    expect(applyPerMilleBigint(100_000n, 70)).toBe(107_000n);
    expect(applyPerMilleBigint(1n, 300)).toBe(1n);
  });

  it("maps placements to outcomes", () => {
    expect(matchOutcome(1, 2)).toBe("win");
    expect(matchOutcome(2, 2)).toBe("played");
    expect(matchOutcome(2, 4)).toBe("podium");
    expect(matchOutcome(3, 8)).toBe("podium");
    expect(matchOutcome(4, 8)).toBe("played");
    expect(matchOutcome(2, 3)).toBe("played");
  });
});
