import { AirDefenseRange, AirDefenseSystem, UnitType } from "./Game";

/**
 * Deterministic authoritative balance for the air-defense systems a SAM
 * Launcher may be built as. A launcher without a system is the unchanged
 * baseline (every legacy, remote, nation-AI and archived launcher): today's
 * radius curve, reload, jet hit, every warhead, no stealth counter, full
 * price.
 */
export type AirDefenseProfile = Readonly<{
  range: AirDefenseRange;
  /** Level-1 engagement radius in Euclidean tiles; grows with the level. */
  radius: number;
  /** Ticks one interceptor slot needs to reload, at medium tempo. */
  reloadTicks: number;
  /** Hull damage one interceptor deals to a jet. */
  jetDamage: number;
  /** Warheads this system can engage. */
  warheads: readonly UnitType[];
  /** Sees and engages stealth airframes (the F-35). */
  countersStealth: boolean;
  /** Price as a percentage of the SAM Launcher cost curve. */
  costPercent: number;
}>;

const ATOM_ONLY: readonly UnitType[] = [UnitType.AtomBomb];
const ATOM_AND_HYDROGEN: readonly UnitType[] = [
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
];
const EVERY_WARHEAD: readonly UnitType[] = [
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRVWarhead,
];

/** Weakest first inside each class; short range before long range. */
export const AIR_DEFENSE_SYSTEMS: readonly AirDefenseSystem[] = [
  AirDefenseSystem.PantsirS1,
  AirDefenseSystem.IronDome,
  AirDefenseSystem.HisarO,
  AirDefenseSystem.DavidsSling,
  AirDefenseSystem.Patriot,
  AirDefenseSystem.Siper,
  AirDefenseSystem.S400,
  AirDefenseSystem.S500,
];

const AIR_DEFENSE_PROFILES: Readonly<
  Record<AirDefenseSystem, AirDefenseProfile>
> = {
  [AirDefenseSystem.PantsirS1]: {
    range: AirDefenseRange.Short,
    radius: 35,
    reloadTicks: 30,
    jetDamage: 200,
    warheads: ATOM_ONLY,
    countersStealth: false,
    costPercent: 45,
  },
  [AirDefenseSystem.IronDome]: {
    range: AirDefenseRange.Short,
    radius: 40,
    reloadTicks: 40,
    jetDamage: 150,
    warheads: ATOM_ONLY,
    countersStealth: false,
    costPercent: 50,
  },
  [AirDefenseSystem.HisarO]: {
    range: AirDefenseRange.Short,
    radius: 48,
    reloadTicks: 50,
    jetDamage: 225,
    warheads: ATOM_ONLY,
    countersStealth: false,
    costPercent: 60,
  },
  [AirDefenseSystem.DavidsSling]: {
    range: AirDefenseRange.Short,
    radius: 60,
    reloadTicks: 60,
    jetDamage: 300,
    warheads: ATOM_AND_HYDROGEN,
    countersStealth: false,
    costPercent: 80,
  },
  [AirDefenseSystem.Patriot]: {
    range: AirDefenseRange.Long,
    radius: 80,
    reloadTicks: 90,
    jetDamage: 300,
    warheads: EVERY_WARHEAD,
    countersStealth: false,
    costPercent: 100,
  },
  [AirDefenseSystem.Siper]: {
    range: AirDefenseRange.Long,
    radius: 95,
    reloadTicks: 80,
    jetDamage: 350,
    warheads: EVERY_WARHEAD,
    countersStealth: false,
    costPercent: 120,
  },
  [AirDefenseSystem.S400]: {
    range: AirDefenseRange.Long,
    radius: 110,
    reloadTicks: 70,
    jetDamage: 450,
    warheads: EVERY_WARHEAD,
    countersStealth: false,
    costPercent: 150,
  },
  [AirDefenseSystem.S500]: {
    range: AirDefenseRange.Long,
    radius: 130,
    reloadTicks: 60,
    jetDamage: 600,
    warheads: EVERY_WARHEAD,
    countersStealth: true,
    costPercent: 200,
  },
};

export function airDefenseProfile(system: AirDefenseSystem): AirDefenseProfile {
  return AIR_DEFENSE_PROFILES[system];
}

export function isAirDefenseSystem(value: unknown): value is AirDefenseSystem {
  return (
    typeof value === "string" &&
    (AIR_DEFENSE_SYSTEMS as readonly string[]).includes(value)
  );
}

/** Systems of one range class, weakest first. */
export function airDefenseSystemsForRange(
  range: AirDefenseRange,
): AirDefenseSystem[] {
  return AIR_DEFENSE_SYSTEMS.filter(
    (system) => AIR_DEFENSE_PROFILES[system].range === range,
  );
}

/** Exact integer price of a launcher built as `system`; missing is baseline. */
export function airDefenseCost(
  baseCost: bigint,
  system: AirDefenseSystem | undefined,
): bigint {
  if (system === undefined) return baseCost;
  return (baseCost * BigInt(AIR_DEFENSE_PROFILES[system].costPercent)) / 100n;
}

/**
 * Engagement radius at a level: the system's level-1 radius plus whatever the
 * shared SAM curve has grown since level 1. The baseline launcher is the
 * shared curve itself.
 */
export function airDefenseRadius(
  system: AirDefenseSystem | undefined,
  samRangeAtLevel: number,
  samRangeAtLevelOne: number,
): number {
  if (system === undefined) return samRangeAtLevel;
  return (
    AIR_DEFENSE_PROFILES[system].radius + (samRangeAtLevel - samRangeAtLevelOne)
  );
}

/** Whether the launcher can engage this warhead; the baseline engages all. */
export function airDefenseEngagesWarhead(
  system: AirDefenseSystem | undefined,
  warhead: UnitType,
): boolean {
  if (system === undefined) return EVERY_WARHEAD.includes(warhead);
  return AIR_DEFENSE_PROFILES[system].warheads.includes(warhead);
}

export function airDefenseCountersStealth(
  system: AirDefenseSystem | undefined,
): boolean {
  return system !== undefined && AIR_DEFENSE_PROFILES[system].countersStealth;
}
