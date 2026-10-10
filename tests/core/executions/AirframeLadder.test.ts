import {
  aircraftMissileDamage,
  aircraftProfile,
  aircraftSortieCost,
} from "../../../src/core/game/AircraftProfiles";
import {
  AircraftType,
  AirMissionType,
  PATROL_AIRCRAFT_TYPES,
} from "../../../src/core/game/Game";
import {
  AirportLaunchAirMissionIntentSchema,
  LaunchAirMissionIntentSchema,
} from "../../../src/core/Schemas";

/** The shared air-to-air missile hit of the Airport profile (V2 value). */
const AIR_HIT = 300;
const FIGHTER_PRICE = 750_000n;

function shotsToDown(shooter: AircraftType, victim: AircraftType): number {
  const hit = aircraftMissileDamage(AIR_HIT, shooter);
  return Math.ceil(aircraftProfile(victim).health / hit);
}

describe("Airframe ladder", () => {
  it("orders the eight airframes cheapest first and keeps the original three unchanged", () => {
    expect(PATROL_AIRCRAFT_TYPES).toEqual([
      AircraftType.F16,
      AircraftType.Typhoon,
      AircraftType.F35,
      AircraftType.A10,
      AircraftType.KAAN,
      AircraftType.F22,
      AircraftType.B52,
      AircraftType.B2,
    ]);
    const costs = PATROL_AIRCRAFT_TYPES.map(
      (type) => aircraftProfile(type).costMultiplier,
    );
    expect(costs).toEqual([1, 2, 2, 2, 3, 3, 4, 5]);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    const f16 = aircraftProfile(AircraftType.F16);
    const f35 = aircraftProfile(AircraftType.F35);
    const b2 = aircraftProfile(AircraftType.B2);
    expect([f16.health, f35.health, b2.health]).toEqual([300, 500, 1500]);
    expect([
      f16.missileDamagePercent,
      f35.missileDamagePercent,
      b2.missileDamagePercent,
    ]).toEqual([100, 125, 200]);
    expect([f16.costMultiplier, f35.costMultiplier, b2.costMultiplier]).toEqual(
      [1, 2, 5],
    );
    expect(
      [AircraftType.F16, AircraftType.F35, AircraftType.B2].map((type) =>
        aircraftSortieCost(FIGHTER_PRICE, type),
      ),
    ).toEqual([750_000n, 1_500_000n, 3_750_000n]);
    // Stealth is the F-35's edge; the others are visible to air defense.
    expect(f35.bypassesSAM).toBe(true);
    expect(f16.bypassesSAM).toBe(false);
    expect(b2.bypassesSAM).toBe(false);
  });

  it("lets the B-2 down any other jet in one shot while needing several hits itself", () => {
    expect(aircraftMissileDamage(AIR_HIT, AircraftType.B2)).toBe(600);
    expect(shotsToDown(AircraftType.B2, AircraftType.F16)).toBe(1);
    expect(shotsToDown(AircraftType.B2, AircraftType.F35)).toBe(1);
    expect(shotsToDown(AircraftType.B2, AircraftType.B2)).toBe(3);

    expect(aircraftMissileDamage(AIR_HIT, AircraftType.F35)).toBe(375);
    expect(shotsToDown(AircraftType.F35, AircraftType.F16)).toBe(1);
    expect(shotsToDown(AircraftType.F35, AircraftType.F35)).toBe(2);
    expect(shotsToDown(AircraftType.F35, AircraftType.B2)).toBe(4);

    expect(aircraftMissileDamage(AIR_HIT, AircraftType.F16)).toBe(300);
    expect(shotsToDown(AircraftType.F16, AircraftType.F16)).toBe(1);
    expect(shotsToDown(AircraftType.F16, AircraftType.F35)).toBe(2);
    expect(shotsToDown(AircraftType.F16, AircraftType.B2)).toBe(5);
  });

  it("admits an F-35 patrol order locally and keeps rejecting it remotely", () => {
    const order = {
      mission: AirMissionType.CombatAirPatrol,
      targetTile: 12,
      aircraftType: AircraftType.F35,
    };
    expect(
      AirportLaunchAirMissionIntentSchema.safeParse({
        type: "launch_air_mission",
        order,
        amount: 2,
      }).success,
    ).toBe(true);
    expect(
      LaunchAirMissionIntentSchema.safeParse({
        type: "launch_air_mission",
        order,
        amount: 2,
      }).success,
    ).toBe(false);
  });
});
