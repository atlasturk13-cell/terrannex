import { AirDefenseSystem, UnitType } from "../../src/core/game/Game";
import {
  BuildUnitIntentSchema,
  ClientIntentMessageSchema,
  IntentSchema,
  LegacyBuildUnitIntentSchema,
  RecordedIntentSchema,
  StampedIntentSchema,
} from "../../src/core/Schemas";

const sam = {
  type: "build_unit",
  unit: UnitType.SAMLauncher,
  tile: 4242,
} as const;

describe("air-defense build intent schema", () => {
  it("admits every system on a local SAM Launcher build and nothing else", () => {
    for (const airDefenseSystem of Object.values(AirDefenseSystem)) {
      const intent = { ...sam, airDefenseSystem };
      expect(BuildUnitIntentSchema.safeParse(intent).success).toBe(true);
      expect(RecordedIntentSchema.safeParse(intent).success).toBe(true);
      expect(
        StampedIntentSchema.safeParse({ ...intent, clientID: "AIRD0001" })
          .success,
      ).toBe(true);
    }
    for (const airDefenseSystem of ["s300", "", "S400", 4, null]) {
      expect(
        BuildUnitIntentSchema.safeParse({ ...sam, airDefenseSystem }).success,
      ).toBe(false);
    }
    for (const unit of [
      UnitType.City,
      UnitType.MissileSilo,
      UnitType.DefensePost,
      UnitType.Warship,
      UnitType.AtomBomb,
    ]) {
      expect(
        BuildUnitIntentSchema.safeParse({
          ...sam,
          unit,
          airDefenseSystem: AirDefenseSystem.IronDome,
        }).success,
      ).toBe(false);
    }
  });

  it("keeps the plain SAM Launcher build unchanged everywhere", () => {
    expect(BuildUnitIntentSchema.safeParse(sam).success).toBe(true);
    expect(LegacyBuildUnitIntentSchema.safeParse(sam).success).toBe(true);
    expect(IntentSchema.safeParse(sam).success).toBe(true);
    expect(RecordedIntentSchema.safeParse(sam).success).toBe(true);
    expect(
      ClientIntentMessageSchema.safeParse({ type: "intent", intent: sam })
        .success,
    ).toBe(true);
    const parsed = BuildUnitIntentSchema.parse(sam);
    expect(parsed.airDefenseSystem).toBeUndefined();
  });

  it("rejects the system on the remote/legacy intent and message schemas", () => {
    const intent = { ...sam, airDefenseSystem: AirDefenseSystem.S500 };
    expect(LegacyBuildUnitIntentSchema.safeParse(intent).success).toBe(false);
    expect(IntentSchema.safeParse(intent).success).toBe(false);
    expect(
      ClientIntentMessageSchema.safeParse({ type: "intent", intent }).success,
    ).toBe(false);
  });

  it("keeps the rocket target-list rules on both variants", () => {
    const rockets = {
      type: "build_unit",
      unit: UnitType.AtomBomb,
      tile: 1,
      amount: 2,
      targetTiles: [1, 2],
    } as const;
    expect(BuildUnitIntentSchema.safeParse(rockets).success).toBe(true);
    expect(LegacyBuildUnitIntentSchema.safeParse(rockets).success).toBe(true);
    const wrong = { ...rockets, amount: 3 };
    expect(BuildUnitIntentSchema.safeParse(wrong).success).toBe(false);
    expect(LegacyBuildUnitIntentSchema.safeParse(wrong).success).toBe(false);
  });
});
