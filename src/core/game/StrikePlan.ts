import { StrikeTargetClass } from "./Game";

/** Canonical order of the strike plans (the enum order), for determinism. */
const CLASS_ORDER: readonly StrikeTargetClass[] =
  Object.values(StrikeTargetClass);

/**
 * The plans a Jet Attack actually deals its jets over. Duplicates are
 * dropped and the result follows the enum order, so every client derives the
 * same groups whatever order the player clicked in. "All structures" already
 * covers every class, so it stands alone; the clicked tile is a group of its
 * own only when nothing else is chosen. An empty choice means the tile.
 */
export function normalizeStrikeClasses(
  classes: readonly StrikeTargetClass[] | undefined,
): StrikeTargetClass[] {
  const chosen = new Set(classes ?? []);
  if (chosen.has(StrikeTargetClass.AllStructures)) {
    return [StrikeTargetClass.AllStructures];
  }
  const structureClasses = CLASS_ORDER.filter(
    (id) => id !== StrikeTargetClass.Tile && chosen.has(id),
  );
  return structureClasses.length > 0
    ? structureClasses
    : [StrikeTargetClass.Tile];
}

/**
 * How many of `jets` each of `groups` target groups receives: an equal share,
 * the remainder going one each to the first groups. 46 jets over two groups
 * are 23 + 23; five over three are 2 + 2 + 1.
 */
export function evenStrikeShares(jets: number, groups: number): number[] {
  if (groups < 1) return [];
  const base = Math.floor(jets / groups);
  const remainder = jets - base * groups;
  return Array.from({ length: groups }, (_, index) =>
    index < remainder ? base + 1 : base,
  );
}

/**
 * Deals jets (already in departure order) over target groups: jet `i` joins
 * group `i mod groups`, which yields the equal shares above and lets the
 * first departures cover every group; inside a group the jets cycle over its
 * targets, nearest first, so with fewer jets than targets the nearest ones
 * are hit and with more jets the targets are hit several times.
 */
export function dealStrikeTargets<T>(
  jetCount: number,
  groups: readonly (readonly T[])[],
): T[] {
  const live = groups.filter((group) => group.length > 0);
  if (live.length === 0) return [];
  const used = new Array<number>(live.length).fill(0);
  const targets: T[] = [];
  for (let jet = 0; jet < jetCount; jet++) {
    const groupIndex = jet % live.length;
    const group = live[groupIndex];
    targets.push(group[used[groupIndex] % group.length]);
    used[groupIndex]++;
  }
  return targets;
}
