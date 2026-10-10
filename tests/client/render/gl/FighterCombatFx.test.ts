import fs from "fs";
import path from "path";
import {
  FX_NUKE,
  FX_SAM_EXPLOSION,
  FX_SINKING_SHIP,
  FX_UNIT_EXPLOSION,
  FxSpritePass,
  NUKE_EXPLOSION_RADII,
} from "../../../../src/client/render/gl/passes/fx-pass/FxSpritePass";
import { unitAtlasColumnForType } from "../../../../src/client/render/gl/passes/UnitPass";
import type { DeadUnitFx } from "../../../../src/client/render/types";
import {
  ALL_UNIT_TYPES,
  NUKE_TYPES,
  SMOOTHED_MISSILE_TYPES,
  UT_ATOM_BOMB,
  UT_FIGHTER_BOMB,
  UT_FIGHTER_JET,
  UT_FIGHTER_MISSILE,
  UT_SAM_MISSILE,
  UT_WARSHIP,
} from "../../../../src/client/render/types";
import { nukeExplosionTypeForUnit } from "../../../../src/client/WebGLFrameBuilder";

function fxTypes(
  unitType: string,
  reachedTarget: boolean,
  combatDestroyed = false,
  airportOperations = false,
): number[] {
  const pass = Object.create(FxSpritePass.prototype) as FxSpritePass;
  Object.assign(pass, {
    activeFx: [],
    mapW: 100,
    config: {
      airportOperationsV1Enabled: () => airportOperations,
    },
  });
  pass.spawnFxForUnit(
    {
      ownerSmallID: 1,
      pos: 5050,
      reachedTarget,
      combatDestroyed,
      unitType,
    } satisfies DeadUnitFx,
    1_000,
  );
  return (
    pass as unknown as { activeFx: Array<{ fxType: number }> }
  ).activeFx.map((fx) => fx.fxType);
}

describe("fighter combat rendering contract", () => {
  it("keeps legacy missile art and switches only the Airport profile to Atom Bomb art", () => {
    expect(ALL_UNIT_TYPES).toContain(UT_FIGHTER_MISSILE);
    expect(unitAtlasColumnForType(UT_FIGHTER_MISSILE)).toBe(
      unitAtlasColumnForType(UT_SAM_MISSILE),
    );
    expect(unitAtlasColumnForType(UT_FIGHTER_MISSILE, true)).toBe(
      unitAtlasColumnForType(UT_ATOM_BOMB),
    );
    expect(SMOOTHED_MISSILE_TYPES.has(UT_FIGHTER_MISSILE)).toBe(true);
  });

  it("uses nuke-style visuals without classifying conventional fighter ordnance as nuclear", () => {
    expect(ALL_UNIT_TYPES).toContain(UT_FIGHTER_BOMB);
    expect(unitAtlasColumnForType(UT_FIGHTER_BOMB)).toBe(
      unitAtlasColumnForType(UT_ATOM_BOMB),
    );
    expect(SMOOTHED_MISSILE_TYPES.has(UT_FIGHTER_BOMB)).toBe(true);
    expect(NUKE_TYPES.has(UT_FIGHTER_MISSILE)).toBe(false);
    expect(NUKE_TYPES.has(UT_FIGHTER_BOMB)).toBe(false);
    expect(NUKE_EXPLOSION_RADII[UT_FIGHTER_MISSILE]).toBeUndefined();
    expect(NUKE_EXPLOSION_RADII[UT_FIGHTER_BOMB]).toBeUndefined();
    expect(nukeExplosionTypeForUnit(UT_FIGHTER_MISSILE)).toBeUndefined();
    expect(nukeExplosionTypeForUnit(UT_FIGHTER_BOMB)).toBeUndefined();
    expect(fxTypes(UT_FIGHTER_MISSILE, true)).toEqual([FX_SAM_EXPLOSION]);
    // Airport profile: missile hits and bomb impacts are procedural bursts
    // (FxPass / AirStrikeEvent), never the 60-tile nuke sprite.
    expect(fxTypes(UT_FIGHTER_MISSILE, true, false, true)).toEqual([]);
    expect(fxTypes(UT_FIGHTER_BOMB, true)).toEqual([]);
    expect(fxTypes(UT_FIGHTER_MISSILE, false)).toEqual([]);
    expect(fxTypes(UT_FIGHTER_BOMB, false)).toEqual([]);
    expect(FX_NUKE).toBe(0);
  });

  it("routes downed fighters and missile hits to procedural bursts", () => {
    const fxPass = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../src/client/render/gl/passes/fx-pass/index.ts",
      ),
      "utf8",
    );
    expect(fxPass).toContain("unit.combatDestroyed === true");
    expect(fxPass).toContain("pushAirStrikeBurst(x, y, 4.5, reducedMotion)");
    expect(fxPass).toContain(
      "pushAirStrikeBurst(x, y, 3, prefersReducedMotion())",
    );
    expect(fxPass).toContain("applyAirStrikeEvents");
  });

  it("shows only combat-destroyed fighters while preserving Warship explosion and sinking", () => {
    expect(fxTypes(UT_FIGHTER_JET, false, true)).toEqual([]);
    expect(fxTypes(UT_FIGHTER_JET, false, false)).toEqual([]);
    expect(fxTypes(UT_WARSHIP, false)).toEqual([
      FX_UNIT_EXPLOSION,
      FX_SINKING_SHIP,
    ]);
  });
});
