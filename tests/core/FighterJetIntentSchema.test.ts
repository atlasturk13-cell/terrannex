import { AirMissionType, UnitType } from "../../src/core/game/Game";
import {
  AirMissionOrderSchema,
  BuildUnitIntentSchema,
  CommandAirPatrolIntentSchema,
  IntentSchema,
  LaunchAirMissionIntentSchema,
} from "../../src/core/Schemas";

describe("fighter air mission intent schema", () => {
  const validOrders = [
    { mission: AirMissionType.Intercept, targetTile: 42 },
    { mission: AirMissionType.Intercept, targetUnitId: 5 },
    { mission: AirMissionType.NavalStrike, targetUnitId: 7 },
    { mission: AirMissionType.PrecisionStrike, targetTile: 84 },
    { mission: AirMissionType.Escort, targetUnitId: 9 },
    { mission: AirMissionType.CombatAirPatrol, targetTile: 126 },
  ] as const;

  it.each(validOrders)("accepts $mission", (order) => {
    const intent = { type: "launch_air_mission", order };
    expect(LaunchAirMissionIntentSchema.safeParse(intent).success).toBe(true);
    expect(IntentSchema.safeParse(intent).success).toBe(true);
  });

  it("rejects mismatched, fractional and negative targets", () => {
    const invalidOrders = [
      { mission: AirMissionType.NavalStrike, targetTile: 1 },
      { mission: AirMissionType.PrecisionStrike, targetTile: 1.5 },
      { mission: AirMissionType.Escort, targetUnitId: -1 },
      {
        mission: AirMissionType.Intercept,
        targetTile: 1,
        targetUnitId: 2,
      },
    ];
    for (const order of invalidOrders) {
      expect(AirMissionOrderSchema.safeParse(order).success).toBe(false);
    }
  });

  it("accepts only one or two requested sorties and defaults old intents to one", () => {
    const order = { mission: AirMissionType.Intercept, targetTile: 42 };
    expect(
      LaunchAirMissionIntentSchema.safeParse({
        type: "launch_air_mission",
        order,
      }).success,
    ).toBe(true);
    for (const amount of [1, 2]) {
      expect(
        LaunchAirMissionIntentSchema.safeParse({
          type: "launch_air_mission",
          order,
          amount,
        }).success,
      ).toBe(true);
    }
    for (const amount of [0, 1.5, 3]) {
      expect(
        LaunchAirMissionIntentSchema.safeParse({
          type: "launch_air_mission",
          order,
          amount,
        }).success,
      ).toBe(false);
    }
  });

  it("rejects FighterJet through the generic construction protocol", () => {
    for (const unit of [UnitType.FighterJet, UnitType.FighterMissile]) {
      const generic = { type: "build_unit", unit, tile: 42 };
      expect(BuildUnitIntentSchema.safeParse(generic).success).toBe(false);
      expect(IntentSchema.safeParse(generic).success).toBe(false);
    }
  });

  it("accepts only strict, bounded airborne-patrol commands", () => {
    const validCommands = [
      { mission: AirMissionType.Intercept, targetUnitId: 5 },
      { mission: AirMissionType.NavalStrike, targetUnitId: 7 },
      { mission: AirMissionType.PrecisionStrike, targetTile: 84 },
    ] as const;
    for (const order of validCommands) {
      const intent = { type: "command_air_patrol", order, amount: 2 };
      expect(CommandAirPatrolIntentSchema.safeParse(intent).success).toBe(true);
      expect(IntentSchema.safeParse(intent).success).toBe(true);
    }

    const invalidCommands = [
      {
        type: "command_air_patrol",
        order: { mission: AirMissionType.Intercept, targetTile: 5 },
        amount: 1,
      },
      {
        type: "command_air_patrol",
        order: {
          mission: AirMissionType.NavalStrike,
          targetUnitId: 7,
          targetTile: 8,
        },
        amount: 1,
      },
      {
        type: "command_air_patrol",
        order: { mission: AirMissionType.CombatAirPatrol, targetTile: 9 },
        amount: 1,
      },
      {
        type: "command_air_patrol",
        order: { mission: AirMissionType.PrecisionStrike, targetTile: -1 },
        amount: 1,
      },
    ];
    for (const intent of invalidCommands) {
      expect(CommandAirPatrolIntentSchema.safeParse(intent).success).toBe(
        false,
      );
      expect(IntentSchema.safeParse(intent).success).toBe(false);
    }
  });
});
