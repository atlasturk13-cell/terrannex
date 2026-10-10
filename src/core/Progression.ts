/**
 * Account progression: experience earned from finished multiplayer matches
 * becomes a level, and the level gives a small, capped head start in the
 * next match. Everything here is pure integer arithmetic so the server (which
 * awards experience) and every client (which applies the head start inside
 * the deterministic simulation) agree to the digit.
 *
 * Deliberately slow: a win is worth about three defeats, a level needs more
 * wins than the one before, and the strongest possible head start is a
 * modest one — progression is a reason to come back, not a way to beat new
 * players on day one.
 */

export const MAX_PROGRESSION_LEVEL = 30;

/** Experience for one finished match, by placement. */
export const MATCH_XP = {
  win: 60,
  /** Second or third place (of at least four players). */
  podium: 35,
  /** Any other finished match the player stayed in. */
  played: 20,
} as const;

export type MatchOutcome = keyof typeof MATCH_XP;

/**
 * Experience needed to go from `level` to `level + 1`: 100 at level 0,
 * growing by 40 per level (100, 140, 180, …). Level 30 needs 20,400 in total
 * — about 340 wins or 1,000 ordinary matches.
 */
export function xpForNextLevel(level: number): number {
  return 100 + 40 * Math.max(0, Math.min(level, MAX_PROGRESSION_LEVEL - 1));
}

/** Total experience at which `level` begins. */
export function xpAtLevel(level: number): number {
  let total = 0;
  for (let l = 0; l < Math.min(level, MAX_PROGRESSION_LEVEL); l++) {
    total += xpForNextLevel(l);
  }
  return total;
}

export function levelForXp(xp: number): number {
  let level = 0;
  let remaining = Math.max(0, Math.floor(xp));
  while (level < MAX_PROGRESSION_LEVEL) {
    const needed = xpForNextLevel(level);
    if (remaining < needed) break;
    remaining -= needed;
    level++;
  }
  return level;
}

/**
 * The head start a level gives at the start of a match. Each value is a
 * per-mille integer so the simulation stays integer-exact:
 * - troops: +5‰ per level (level 30: +15 %),
 * - gold: +10‰ per level (level 30: +30 %),
 * - spawn: one extra ring of starting land every ten levels (at most +3).
 */
export interface ProgressionBonus {
  level: number;
  troopsPerMille: number;
  goldPerMille: number;
  spawnRings: number;
}

export function progressionBonus(level: number): ProgressionBonus {
  const l = Math.max(0, Math.min(MAX_PROGRESSION_LEVEL, Math.floor(level)));
  return {
    level: l,
    troopsPerMille: 5 * l,
    goldPerMille: 10 * l,
    spawnRings: Math.floor(l / 10),
  };
}

export function applyPerMille(value: number, perMille: number): number {
  return Math.floor((value * (1000 + perMille)) / 1000);
}

export function applyPerMilleBigint(value: bigint, perMille: number): bigint {
  return (value * BigInt(1000 + perMille)) / 1000n;
}

/** Placement → outcome. `players` is the number of human players at start. */
export function matchOutcome(placement: number, players: number): MatchOutcome {
  if (placement === 1) return "win";
  if (placement <= 3 && players >= 4) return "podium";
  return "played";
}
