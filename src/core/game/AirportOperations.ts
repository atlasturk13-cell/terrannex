import { AIRPORT_FIGHTER_CAPACITY, Game, Player, Unit, UnitType } from "./Game";
import { TileRef } from "./GameMap";

/** Ticks between two jets of one Airport order leaving the runway. */
export const AIRPORT_TAKEOFF_INTERVAL_TICKS = 2;
/** Minimum Manhattan distance between the anchors of one patrol order. */
export const PATROL_ANCHOR_SPACING = 6;

/**
 * Anchors for `count` patrol jets: the player's border tiles nearest to the
 * reference tile (then by tile ID), skipping any tile closer than the
 * spacing to an already chosen anchor, so jets of one order loiter apart and
 * stay individually visible. A small border relaxes the spacing (6 → 3 → 1)
 * before anchors are reused, and cycles only when even adjacent border tiles
 * run out; empty when the player has no border at all.
 */
export function selectPatrolAnchors(
  game: Game,
  player: Player,
  reference: TileRef,
  count: number,
): TileRef[] {
  if (count < 1) return [];
  const borders = Array.from(player.borderTiles()).sort(
    (a, b) =>
      game.manhattanDist(reference, a) - game.manhattanDist(reference, b) ||
      a - b,
  );
  let chosen: TileRef[] = [];
  for (const spacing of [PATROL_ANCHOR_SPACING, 3, 1]) {
    const spaced: TileRef[] = [];
    for (const tile of borders) {
      if (spaced.length >= count) break;
      if (
        spaced.every((anchor) => game.manhattanDist(anchor, tile) >= spacing)
      ) {
        spaced.push(tile);
      }
    }
    if (spaced.length > chosen.length) chosen = spaced;
    if (chosen.length >= count) break;
  }
  if (chosen.length === 0) return [];
  const anchors: TileRef[] = [];
  for (let i = 0; i < count; i++) anchors.push(chosen[i % chosen.length]);
  return anchors;
}

/** Airport readiness shared by launch validation and deterministic AI probes. */
export function isOperationalAirport(airport: Unit, owner: Player): boolean {
  return (
    airport.type() === UnitType.Airport &&
    airport.owner() === owner &&
    airport.isActive() &&
    !airport.isUnderConstruction() &&
    !airport.isMarkedForDeletion()
  );
}

/**
 * Capacity follows the physical Airport ID across capture. Jets owned by a
 * prior owner therefore continue to occupy their launch Airport's slots.
 */
export function attributedLiveFighterCount(
  game: Game,
  airportID: number,
): number {
  let count = 0;
  for (const fighter of game.units(UnitType.FighterJet)) {
    if (
      fighter.isActive() &&
      !fighter.isMarkedForDeletion() &&
      fighter.aircraftState().homeFactoryId === airportID
    ) {
      count++;
    }
  }
  return count;
}

export function liveAirportRearmSlots(
  airport: Unit,
  ticks: number,
  cooldown: number,
): number {
  let count = 0;
  for (const launchedAt of airport.missileTimerQueue()) {
    if (ticks - launchedAt < cooldown) count++;
  }
  return count;
}

/** Number of jets this Airport can accept in one fully preflighted order. */
export function availableAirportFighterSlots(
  game: Game,
  airport: Unit,
  ticks: number,
): number {
  const activeSlots =
    AIRPORT_FIGHTER_CAPACITY - attributedLiveFighterCount(game, airport.id());
  const cooldownSlots =
    AIRPORT_FIGHTER_CAPACITY -
    liveAirportRearmSlots(
      airport,
      ticks,
      game.config().fighterLaunchCooldown(),
    );
  return Math.max(0, Math.min(activeSlots, cooldownSlots));
}

/** Mutates the queue only after an order has passed its complete preflight. */
export function pruneExpiredAirportRearmSlots(
  game: Game,
  airport: Unit,
  ticks: number,
): void {
  const cooldown = game.config().fighterLaunchCooldown();
  while (
    airport.missileTimerQueue().length > 0 &&
    ticks - airport.missileTimerQueue()[0] >= cooldown
  ) {
    airport.reloadMissile();
  }
}

/**
 * Pick the release tile on the configured Manhattan ring around the target.
 * With the default range of zero the ring is the target tile itself, so the
 * jet overflies the target and drops on arrival; a positive range keeps the
 * older stand-off release. Ranking by travel distance and then tile ID keeps
 * close/over-target retasks stable.
 */
export function selectFighterBombReleaseTile(
  game: Game,
  sourceTile: number,
  targetTile: number,
): number | null {
  const radius = game.config().fighterBombStandOffRange();
  const targetX = game.x(targetTile);
  const targetY = game.y(targetTile);
  const candidates: number[] = [];

  for (let dx = -radius; dx <= radius; dx++) {
    const dy = radius - Math.abs(dx);
    const x = targetX + dx;
    const upperY = targetY - dy;
    const lowerY = targetY + dy;
    if (game.isValidCoord(x, upperY)) candidates.push(game.ref(x, upperY));
    if (dy !== 0 && game.isValidCoord(x, lowerY)) {
      candidates.push(game.ref(x, lowerY));
    }
  }

  candidates.sort(
    (a, b) =>
      game.manhattanDist(sourceTile, a) - game.manhattanDist(sourceTile, b) ||
      a - b,
  );
  return candidates[0] ?? null;
}
