import { AircraftState, AircraftType, PATROL_AIRCRAFT_TYPES } from "./Game";

/** Deterministic authoritative balance for Airport-profile aircraft. */
export type AircraftProfile = Readonly<{
  /** Tiles flown per tick on every mission, persistent patrol included. */
  speed: number;
  bombSpeed: number;
  costMultiplier: number;
  /** Hull points. The F-16 equals the generic FighterJet unit info. */
  health: number;
  /** Air-to-air / anti-ship missile hit as a percentage of the base hit. */
  missileDamagePercent: number;
  troopPercent: number;
  maxTroopDamage: number;
  areaRadius: number;
  areaUnitDamage: number;
  maxAreaTargets: number;
  /** Euclidean tiles around the impact within which hostile structures die. */
  structureRadius: number;
  /** Most hostile structures one bomb may destroy (nearest first, then ID). */
  maxStructures: number;
  /**
   * Euclidean tiles around the impact that are razed: hostile land is
   * relinquished and becomes fallout, unowned land becomes fallout, and every
   * hostile unit standing on a razed tile is destroyed.
   */
  razeRadius: number;
  bypassesSAM: boolean;
}>;

/**
 * The airframe ladder. Hull and missile hit are tuned so that with the
 * 300-point air hit a B-2 missile (200 %) downs an F-16 or an F-35 in one
 * shot, an F-35 missile (125 %) downs an F-16 in one shot but needs four on a
 * B-2, and an F-16 missile needs five on a B-2. No airframe flies faster than
 * 11 tiles per tick, one below the profile missile speed.
 */
const AIRCRAFT_PROFILES: Readonly<Record<AircraftType, AircraftProfile>> = {
  [AircraftType.F16]: {
    speed: 10,
    bombSpeed: 10,
    costMultiplier: 1,
    health: 300,
    missileDamagePercent: 100,
    troopPercent: 10,
    maxTroopDamage: 100_000,
    areaRadius: 3,
    areaUnitDamage: 150,
    maxAreaTargets: 2,
    structureRadius: 0,
    maxStructures: 1,
    razeRadius: 2,
    bypassesSAM: false,
  },
  // Stealth: invisible to every air-defense system that does not counter
  // stealth. Tougher and harder-hitting than the F-16, well short of the B-2.
  [AircraftType.F35]: {
    speed: 10,
    bombSpeed: 9,
    costMultiplier: 2,
    health: 500,
    missileDamagePercent: 125,
    troopPercent: 15,
    maxTroopDamage: 175_000,
    areaRadius: 4,
    areaUnitDamage: 250,
    maxAreaTargets: 4,
    structureRadius: 1,
    maxStructures: 2,
    razeRadius: 3,
    bypassesSAM: true,
  },
  // Eurofighter Typhoon: a fast, cheap interceptor. Its missile downs an F-16
  // or another Typhoon in one shot; the bomb is the F-16's.
  [AircraftType.Typhoon]: {
    speed: 11,
    bombSpeed: 10,
    costMultiplier: 2,
    health: 400,
    missileDamagePercent: 140,
    troopPercent: 10,
    maxTroopDamage: 100_000,
    areaRadius: 3,
    areaUnitDamage: 150,
    maxAreaTargets: 2,
    structureRadius: 0,
    maxStructures: 1,
    razeRadius: 2,
    bypassesSAM: false,
  },
  // A-10: slow and very tough, weak in the air, hits troops hard over a wide
  // area — the close-air-support choice.
  [AircraftType.A10]: {
    speed: 8,
    bombSpeed: 8,
    costMultiplier: 2,
    health: 900,
    missileDamagePercent: 60,
    troopPercent: 20,
    maxTroopDamage: 250_000,
    areaRadius: 5,
    areaUnitDamage: 350,
    maxAreaTargets: 6,
    structureRadius: 1,
    maxStructures: 2,
    razeRadius: 3,
    bypassesSAM: false,
  },
  // KAAN: stealth multirole between the F-35 and the F-22 — tougher and
  // harder-hitting than the F-35 with the F-35's bomb.
  [AircraftType.KAAN]: {
    speed: 10,
    bombSpeed: 9,
    costMultiplier: 3,
    health: 550,
    missileDamagePercent: 150,
    troopPercent: 15,
    maxTroopDamage: 175_000,
    areaRadius: 4,
    areaUnitDamage: 250,
    maxAreaTargets: 4,
    structureRadius: 1,
    maxStructures: 2,
    razeRadius: 3,
    bypassesSAM: true,
  },
  // F-22: the air-superiority fighter. Stealth, fast, and its missile (555)
  // downs every fighter up to the KAAN in one shot; light precision bomb.
  [AircraftType.F22]: {
    speed: 11,
    bombSpeed: 10,
    costMultiplier: 3,
    health: 600,
    missileDamagePercent: 185,
    troopPercent: 10,
    maxTroopDamage: 100_000,
    areaRadius: 3,
    areaUnitDamage: 150,
    maxAreaTargets: 2,
    structureRadius: 0,
    maxStructures: 1,
    razeRadius: 2,
    bypassesSAM: true,
  },
  // B-52: heavy carpet bomber — the widest area bomb short of the B-2's raze,
  // slow and nearly defenceless against other jets.
  [AircraftType.B52]: {
    speed: 9,
    bombSpeed: 7,
    costMultiplier: 4,
    health: 1200,
    missileDamagePercent: 40,
    troopPercent: 28,
    maxTroopDamage: 450_000,
    areaRadius: 9,
    areaUnitDamage: 400,
    maxAreaTargets: 9,
    structureRadius: 2,
    maxStructures: 3,
    razeRadius: 5,
    bypassesSAM: false,
  },
  // Speed 11 stays below the profile missile speed (12) so a pursuing
  // missile always closes on a fleeing B-2 by at least one tile per tick.
  [AircraftType.B2]: {
    speed: 11,
    bombSpeed: 8,
    costMultiplier: 5,
    health: 1500,
    missileDamagePercent: 200,
    troopPercent: 25,
    maxTroopDamage: 400_000,
    areaRadius: 8,
    areaUnitDamage: 450,
    maxAreaTargets: 8,
    structureRadius: 3,
    maxStructures: 4,
    razeRadius: 5,
    bypassesSAM: false,
  },
};

/** Missing is the compatibility spelling of the baseline F-16. */
export function effectiveAircraftType(
  aircraftType: AircraftType | undefined,
): AircraftType {
  return aircraftType ?? AircraftType.F16;
}

export function isPatrolAircraftType(
  aircraftType: AircraftType | undefined,
): boolean {
  return (
    aircraftType === undefined ||
    (PATROL_AIRCRAFT_TYPES as readonly AircraftType[]).includes(aircraftType)
  );
}

export function aircraftProfile(
  aircraftType: AircraftType | undefined,
): AircraftProfile {
  return AIRCRAFT_PROFILES[effectiveAircraftType(aircraftType)];
}

export function aircraftStateProfile(
  state: Pick<AircraftState, "aircraftType">,
): AircraftProfile {
  return aircraftProfile(state.aircraftType);
}

export function aircraftBypassesSAM(
  state: Pick<AircraftState, "aircraftType">,
): boolean {
  return aircraftStateProfile(state).bypassesSAM;
}

export function aircraftSortieCost(
  baseCost: bigint,
  aircraftType: AircraftType | undefined,
): bigint {
  return baseCost * BigInt(aircraftProfile(aircraftType).costMultiplier);
}

/** Integer missile hit for the launching airframe; F-16 keeps the base hit. */
export function aircraftMissileDamage(
  baseDamage: number,
  aircraftType: AircraftType | undefined,
): number {
  return Math.floor(
    (baseDamage * aircraftProfile(aircraftType).missileDamagePercent) / 100,
  );
}

/** Any positive defended force takes an observable, bounded hit. */
export function aircraftTroopDamage(
  defendingTroops: number,
  aircraftType: AircraftType | undefined,
): number {
  if (!Number.isFinite(defendingTroops) || defendingTroops <= 0) return 0;
  const profile = aircraftProfile(aircraftType);
  const proportional = Math.floor(
    (defendingTroops * profile.troopPercent) / 100,
  );
  return Math.min(
    Math.floor(defendingTroops),
    profile.maxTroopDamage,
    Math.max(1, proportional),
  );
}
