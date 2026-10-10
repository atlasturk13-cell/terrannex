import { AirMissionType, StrikeTargetClass } from "../../src/core/game/Game";
import {
  AirPatrolCommandOrderSchema,
  AirportAirPatrolCommandOrderSchema,
  AirportCommandAirPatrolIntentSchema,
  CommandAirPatrolIntentSchema,
  IntentSchema,
  StampedIntentSchema,
} from "../../src/core/Schemas";

const strike = {
  mission: AirMissionType.PrecisionStrike,
  targetTile: 84,
} as const;

describe("strike plan schema", () => {
  it("admits every plan on the local Airport command and nothing else", () => {
    for (const targetClass of Object.values(StrikeTargetClass)) {
      const order = { ...strike, targetClass };
      expect(AirportAirPatrolCommandOrderSchema.safeParse(order).success).toBe(
        true,
      );
      expect(
        AirportCommandAirPatrolIntentSchema.safeParse({
          type: "command_air_patrol",
          order,
          amount: 7,
        }).success,
      ).toBe(true);
      expect(
        StampedIntentSchema.safeParse({
          clientID: "PLAN0001",
          type: "command_air_patrol",
          order,
          amount: 7,
        }).success,
      ).toBe(true);
    }
    for (const targetClass of ["bases", "", "FACTORIES", 3]) {
      expect(
        AirportAirPatrolCommandOrderSchema.safeParse({ ...strike, targetClass })
          .success,
      ).toBe(false);
    }
    expect(
      AirportAirPatrolCommandOrderSchema.safeParse({
        mission: AirMissionType.Intercept,
        targetUnitId: 5,
        targetClass: StrikeTargetClass.Factories,
      }).success,
    ).toBe(false);
  });

  it("admits an explicit jet selection on the local Airport command only", () => {
    const order = { ...strike, fighterIds: [3, 7, 11] };
    expect(AirportAirPatrolCommandOrderSchema.safeParse(order).success).toBe(
      true,
    );
    expect(
      StampedIntentSchema.safeParse({
        clientID: "PLAN0001",
        type: "command_air_patrol",
        order,
        amount: 3,
      }).success,
    ).toBe(true);
    for (const fighterIds of [
      [],
      [1.5],
      [-1],
      ["7"],
      Array.from({ length: 101 }, (_, index) => index),
    ]) {
      expect(
        AirportAirPatrolCommandOrderSchema.safeParse({ ...strike, fighterIds })
          .success,
      ).toBe(false);
    }
    expect(AirPatrolCommandOrderSchema.safeParse(order).success).toBe(false);
    expect(
      IntentSchema.safeParse({
        type: "command_air_patrol",
        order,
        amount: 3,
      }).success,
    ).toBe(false);
  });

  it("keeps the plan out of the legacy and remote command shapes", () => {
    const order = { ...strike, targetClass: StrikeTargetClass.AirDefense };
    expect(AirPatrolCommandOrderSchema.safeParse(order).success).toBe(false);
    expect(
      CommandAirPatrolIntentSchema.safeParse({
        type: "command_air_patrol",
        order,
        amount: 1,
      }).success,
    ).toBe(false);
    expect(
      IntentSchema.safeParse({
        type: "command_air_patrol",
        order,
        amount: 1,
      }).success,
    ).toBe(false);
    // A plan-free strike still parses everywhere.
    expect(AirPatrolCommandOrderSchema.safeParse(strike).success).toBe(true);
    expect(AirportAirPatrolCommandOrderSchema.safeParse(strike).success).toBe(
      true,
    );
  });
});
