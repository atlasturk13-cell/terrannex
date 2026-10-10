import {
  AircraftType,
  AirMissionType,
  Nukes,
  UnitType,
} from "../../src/core/game/Game";
import {
  AirportCommandAirPatrolIntentSchema,
  AirportLaunchAirMissionIntentSchema,
  BuildUnitIntentSchema,
  CommandAirPatrolIntentSchema,
  LaunchAirMissionIntentSchema,
  RemoteGameConfigPartialSchema,
  StampedIntentSchema,
  TurnSchema,
  UpgradeStructureIntentSchema,
} from "../../src/core/Schemas";

describe("Airport operations wire compatibility", () => {
  const patrol = {
    mission: AirMissionType.CombatAirPatrol,
    targetTile: 42,
  } as const;
  const strike = {
    mission: AirMissionType.PrecisionStrike,
    targetTile: 84,
  } as const;

  it("keeps legacy direct schemas at two while local commands accept safe integers", () => {
    expect(
      LaunchAirMissionIntentSchema.safeParse({
        type: "launch_air_mission",
        order: patrol,
        amount: 3,
      }).success,
    ).toBe(false);
    expect(
      CommandAirPatrolIntentSchema.safeParse({
        type: "command_air_patrol",
        order: strike,
        amount: 3,
      }).success,
    ).toBe(false);

    for (const amount of [3, 100, 101, Number.MAX_SAFE_INTEGER]) {
      expect(
        AirportLaunchAirMissionIntentSchema.safeParse({
          type: "launch_air_mission",
          order: patrol,
          amount,
        }).success,
      ).toBe(true);
      expect(
        AirportCommandAirPatrolIntentSchema.safeParse({
          type: "command_air_patrol",
          order: strike,
          amount,
        }).success,
      ).toBe(true);
      expect(
        StampedIntentSchema.safeParse({
          clientID: "AIRPORT1",
          type: "launch_air_mission",
          order: patrol,
          amount,
        }).success,
      ).toBe(true);
    }

    for (const amount of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        AirportLaunchAirMissionIntentSchema.safeParse({
          type: "launch_air_mission",
          order: patrol,
          amount,
        }).success,
      ).toBe(false);
      expect(
        AirportCommandAirPatrolIntentSchema.safeParse({
          type: "command_air_patrol",
          order: strike,
          amount,
        }).success,
      ).toBe(false);
    }
  });

  it("parses every aircraft type for strikes and patrols and rejects unknown ones", () => {
    for (const aircraftType of Object.values(AircraftType)) {
      expect(
        AirportLaunchAirMissionIntentSchema.safeParse({
          type: "launch_air_mission",
          order: { ...strike, aircraftType },
          amount: 1,
        }).success,
      ).toBe(true);
    }
    expect(
      AirportLaunchAirMissionIntentSchema.safeParse({
        type: "launch_air_mission",
        order: { ...strike, aircraftType: "mig29" },
        amount: 1,
      }).success,
    ).toBe(false);
    for (const aircraftType of Object.values(AircraftType)) {
      expect(
        AirportLaunchAirMissionIntentSchema.safeParse({
          type: "launch_air_mission",
          order: { ...patrol, aircraftType },
          amount: 1,
        }).success,
      ).toBe(true);
    }
    expect(
      AirportLaunchAirMissionIntentSchema.safeParse({
        type: "launch_air_mission",
        order: { ...patrol, aircraftType: "mig29" },
        amount: 1,
      }).success,
    ).toBe(false);
    for (const order of [
      { ...strike, aircraftType: AircraftType.B2 },
      { ...patrol, aircraftType: AircraftType.B2 },
    ]) {
      expect(
        LaunchAirMissionIntentSchema.safeParse({
          type: "launch_air_mission",
          order,
          amount: 1,
        }).success,
      ).toBe(false);
    }
  });

  it("rejects internal fighter projectiles through every generic build ingress", () => {
    for (const unit of [
      UnitType.FighterJet,
      UnitType.FighterMissile,
      UnitType.FighterBomb,
    ]) {
      expect(
        BuildUnitIntentSchema.safeParse({
          type: "build_unit",
          unit,
          tile: 42,
        }).success,
      ).toBe(false);
    }
    expect(Nukes.has(UnitType.FighterMissile)).toBe(false);
    expect(Nukes.has(UnitType.FighterBomb)).toBe(false);
  });

  it("isolates the local Airport unit from remote build, upgrade, and config ingress", () => {
    expect(
      BuildUnitIntentSchema.safeParse({
        type: "build_unit",
        unit: UnitType.Airport,
        tile: 42,
        rocketDirectionUp: false,
        amount: 1,
        targetTiles: undefined,
      }).success,
    ).toBe(false);
    expect(
      UpgradeStructureIntentSchema.safeParse({
        type: "upgrade_structure",
        unit: UnitType.Airport,
        unitId: 7,
      }).success,
    ).toBe(false);
    expect(
      RemoteGameConfigPartialSchema.safeParse({
        disabledUnits: [UnitType.Airport],
      }).success,
    ).toBe(false);
    expect(
      StampedIntentSchema.safeParse({
        clientID: "AIRPORT1",
        type: "build_unit",
        unit: UnitType.Airport,
        tile: 42,
        rocketDirectionUp: false,
        amount: 1,
        targetTiles: undefined,
      }).success,
    ).toBe(true);
    expect(
      TurnSchema.safeParse({
        turnNumber: 3,
        intents: [
          {
            clientID: "AIRPORT1",
            type: "build_unit",
            unit: UnitType.Airport,
            tile: 42,
            rocketDirectionUp: false,
            amount: 1,
            targetTiles: undefined,
          },
        ],
      }).success,
    ).toBe(true);
    for (const invalid of [
      { amount: 2, rocketDirectionUp: false },
      { amount: 1, rocketDirectionUp: true },
      { amount: 1, rocketDirectionUp: false, targetTiles: [42, 43] },
    ]) {
      expect(
        StampedIntentSchema.safeParse({
          clientID: "AIRPORT1",
          type: "build_unit",
          unit: UnitType.Airport,
          tile: 42,
          ...invalid,
        }).success,
      ).toBe(false);
    }
  });

  it("rejects the local-only Airport flag at remote config ingress", () => {
    expect(
      RemoteGameConfigPartialSchema.safeParse({
        airportOperationsV1: true,
      }).success,
    ).toBe(false);
    expect(
      RemoteGameConfigPartialSchema.safeParse({
        airportOperationsV1: false,
      }).success,
    ).toBe(true);
  });
});
