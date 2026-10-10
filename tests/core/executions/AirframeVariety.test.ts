import { FighterJetExecution } from "../../../src/core/execution/FighterJetExecution";
import {
  aircraftBypassesSAM,
  aircraftMissileDamage,
  aircraftProfile,
} from "../../../src/core/game/AircraftProfiles";
import {
  AircraftType,
  AirMissionType,
  Difficulty,
  Game,
  GameMapType,
  PATROL_AIRCRAFT_TYPES,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";

const AIR_HIT = 300;
const FIGHTER_PRICE = 750_000n;
const NEW_AIRFRAMES = [
  AircraftType.Typhoon,
  AircraftType.A10,
  AircraftType.KAAN,
  AircraftType.F22,
  AircraftType.B52,
] as const;

const commanderInfo = new PlayerInfo(
  "variety commander",
  PlayerType.Human,
  "VARIETY1",
  "variety-commander-id",
);

async function airportGame(): Promise<{ game: Game; commander: Player }> {
  const game = await setup(
    "big_plains",
    {
      airportOperationsV1: true,
      airSuperiorityV1: true,
      difficulty: Difficulty.Impossible,
      gameMap: GameMapType.NaturalEarthWorld,
      combinedArmsV1: true,
      combinedArmsV2: true,
      instantBuild: true,
    },
    [commanderInfo],
  );
  const commander = game.player(commanderInfo.id);
  commander.addGold(100_000_000n);
  const tile = game.ref(10, 10);
  commander.conquer(tile);
  commander.buildUnit(UnitType.Airport, tile, {});
  return { game, commander };
}

function shotsToDown(shooter: AircraftType, victim: AircraftType): number {
  return Math.ceil(
    aircraftProfile(victim).health / aircraftMissileDamage(AIR_HIT, shooter),
  );
}

describe("Airframe variety", () => {
  it("keeps every airframe slower than the profile missile and prices them by the ladder", async () => {
    const { game } = await airportGame();
    const missileSpeed = game.config().fighterMissileSpeed();
    for (const type of PATROL_AIRCRAFT_TYPES) {
      const profile = aircraftProfile(type);
      expect(profile.speed).toBeLessThan(missileSpeed);
      expect(profile.bombSpeed).toBeGreaterThan(0);
      expect(profile.health).toBeGreaterThan(0);
      expect(profile.costMultiplier).toBeGreaterThan(0);
      expect(profile.razeRadius).toBeLessThanOrEqual(
        aircraftProfile(AircraftType.B2).razeRadius,
      );
    }
    expect(
      NEW_AIRFRAMES.map((type) => aircraftProfile(type).costMultiplier),
    ).toEqual([2, 2, 3, 3, 4]);
    // Stealth is the edge of the F-35, KAAN and F-22 only.
    expect(
      PATROL_AIRCRAFT_TYPES.filter((type) =>
        aircraftBypassesSAM({ aircraftType: type }),
      ),
    ).toEqual([AircraftType.F35, AircraftType.KAAN, AircraftType.F22]);
  });

  it("gives each new airframe a distinct air-to-air role", () => {
    // The Typhoon's missile downs an F-16 in one shot, like the F-35's.
    expect(shotsToDown(AircraftType.Typhoon, AircraftType.F16)).toBe(1);
    expect(shotsToDown(AircraftType.Typhoon, AircraftType.F35)).toBe(2);
    // The F-22 downs every fighter up to the KAAN in one shot.
    expect(aircraftMissileDamage(AIR_HIT, AircraftType.F22)).toBe(555);
    for (const victim of [
      AircraftType.F16,
      AircraftType.Typhoon,
      AircraftType.F35,
      AircraftType.KAAN,
    ]) {
      expect(shotsToDown(AircraftType.F22, victim)).toBe(1);
    }
    expect(shotsToDown(AircraftType.F22, AircraftType.F22)).toBe(2);
    expect(shotsToDown(AircraftType.F22, AircraftType.B2)).toBe(3);
    // The KAAN sits between the F-35 and the F-22.
    expect(shotsToDown(AircraftType.KAAN, AircraftType.F16)).toBe(1);
    expect(shotsToDown(AircraftType.KAAN, AircraftType.F35)).toBe(2);
    expect(aircraftProfile(AircraftType.KAAN).health).toBeGreaterThan(
      aircraftProfile(AircraftType.F35).health,
    );
    expect(aircraftProfile(AircraftType.KAAN).health).toBeLessThan(
      aircraftProfile(AircraftType.F22).health,
    );
    // Ground attackers are weak in the air but tough and heavy-handed.
    expect(shotsToDown(AircraftType.A10, AircraftType.F16)).toBe(2);
    expect(shotsToDown(AircraftType.B52, AircraftType.F16)).toBe(3);
    expect(shotsToDown(AircraftType.F16, AircraftType.A10)).toBe(3);
    expect(shotsToDown(AircraftType.F16, AircraftType.B52)).toBe(4);
    const a10 = aircraftProfile(AircraftType.A10);
    const b52 = aircraftProfile(AircraftType.B52);
    const b2 = aircraftProfile(AircraftType.B2);
    expect(a10.troopPercent).toBeGreaterThan(
      aircraftProfile(AircraftType.F35).troopPercent,
    );
    expect(b52.areaRadius).toBeGreaterThan(b2.areaRadius);
    expect(b52.razeRadius).toBe(b2.razeRadius);
    expect(b52.costMultiplier).toBeLessThan(b2.costMultiplier);
    expect(b52.missileDamagePercent).toBeLessThan(a10.missileDamagePercent);
  });

  it.each(NEW_AIRFRAMES)(
    "launches a %s patrol with its own hull, price and airframe on the unit",
    async (type) => {
      const { game, commander } = await airportGame();
      const anchor = game.ref(10, 10);
      const goldBefore = commander.gold();
      game.addExecution(
        new FighterJetExecution(
          commander,
          {
            mission: AirMissionType.CombatAirPatrol,
            targetTile: anchor,
            aircraftType: type,
          },
          1,
        ),
      );
      game.executeNextTick();

      const fighters = commander.units(UnitType.FighterJet);
      expect(fighters).toHaveLength(1);
      const fighter = fighters[0];
      const profile = aircraftProfile(type);
      expect(fighter.aircraftState().aircraftType).toBe(type);
      expect(fighter.aircraftState().mission).toBe(
        AirMissionType.CombatAirPatrol,
      );
      expect(fighter.maxHealth()).toBe(profile.health);
      expect(fighter.health()).toBe(profile.health);
      expect(goldBefore - commander.gold()).toBe(
        FIGHTER_PRICE * BigInt(profile.costMultiplier),
      );
    },
  );
});
