import { GameMap, TileRef } from "./GameMap";

/**
 * A city is not a single tile: it spreads over an urban footprint centred on
 * its structure tile that grows with the city's level. The footprint is what
 * the client paints as built-up land and what a nuclear blast has to cover
 * to actually destroy the city — a bomb that only reaches the outskirts
 * knocks off levels in proportion to the share of the footprint it erased.
 *
 * Everything here is integer arithmetic so the simulation stays
 * deterministic across clients.
 */

/** Footprint radius (in tiles) of a level-1 city. */
export const CITY_FOOTPRINT_BASE_RADIUS = 6;
/** Extra footprint radius per level above 1. */
export const CITY_FOOTPRINT_RADIUS_PER_LEVEL = 2;

export function cityFootprintRadius(level: number): number {
  const lvl = Math.max(1, Math.floor(level));
  return (
    CITY_FOOTPRINT_BASE_RADIUS + CITY_FOOTPRINT_RADIUS_PER_LEVEL * (lvl - 1)
  );
}

/** Land tiles inside the city's footprint, including the centre tile. */
export function cityFootprintTiles(
  map: GameMap,
  center: TileRef,
  level: number,
): TileRef[] {
  const radius = cityFootprintRadius(level);
  const r2 = radius * radius;
  const cx = map.x(center);
  const cy = map.y(center);
  const tiles: TileRef[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    const y = cy + dy;
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = cx + dx;
      if (!map.isValidCoord(x, y)) continue;
      const tile = map.ref(x, y);
      if (map.isLand(tile)) tiles.push(tile);
    }
  }
  return tiles;
}

/**
 * Levels a city loses when `destroyed` of its `total` footprint tiles were
 * erased: `round(level * destroyed / total)` in integer arithmetic. A hit
 * that erases the whole footprint (or the centre tile — the caller handles
 * that) costs every level; a glancing blow that erases less than half a
 * level's share costs nothing.
 */
export function cityLevelsLost(
  level: number,
  destroyed: number,
  total: number,
): number {
  if (total <= 0 || destroyed <= 0 || level <= 0) return 0;
  if (destroyed >= total) return level;
  return Math.floor((2 * level * destroyed + total) / (2 * total));
}
