import type { ConquestFx, DeadUnitFx, TerritoryClaimFx } from "./Renderer";

// ── Supporting event types ──────────────────────────────────────────────

export interface BonusEvent {
  playerID: string;
  smallID: number;
  tile: number;
  gold: number;
  troops: number;
}

/** A conventional fighter bomb detonated on hostile land this tick. */
export interface AirStrikeFx {
  x: number; // impact tile X
  y: number; // impact tile Y
  attackerSmallID: number;
  targetSmallID: number;
  troops: number; // authoritative troop loss applied to the target
  structures: number; // hostile structures destroyed at impact
  tilesRazed: number; // land tiles razed to fallout around the impact
  aircraftType: string; // wire aircraft type (f16 / f35 / b2)
  local: boolean; // the local player fired or received this strike
}

// ── FrameEvents ─────────────────────────────────────────────────────────

/**
 * Everything that happened THIS frame. Accumulated state and derived data
 * live on FrameData directly — per-frame ephemeral events live here.
 *
 * Empty arrays when nothing happened. Producers must always populate every
 * field (no undefined — consumers shouldn't need null checks).
 */
export interface FrameEvents {
  readonly deadUnits: DeadUnitFx[];
  readonly conquestEvents: ConquestFx[];
  readonly territoryClaimEvents: TerritoryClaimFx[];
  readonly bonusEvents: BonusEvent[];
  readonly airStrikeEvents: AirStrikeFx[];
}
