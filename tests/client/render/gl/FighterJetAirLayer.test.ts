import fs from "fs";
import path from "path";
import { BarPass } from "../../../../src/client/render/gl/passes/BarPass";
import {
  AIRCRAFT_SILHOUETTE_SCALE,
  AIRFRAME_MODEL_SHIFT,
  airInstanceFlags,
  FIGHTER_JET_RENDER_SCALE,
  fighterHeadingByte,
  fighterHeadingOctant,
  UnitPass,
} from "../../../../src/client/render/gl/passes/UnitPass";
import type { UnitState } from "../../../../src/client/render/types";
import { aircraftModelIndex } from "../../../../src/client/view/UnitView";
import { AircraftType, UnitType } from "../../../../src/core/game/Game";

describe("Fighter Jet air render layer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses a fighter-only strategic-map legibility scale", () => {
    expect(FIGHTER_JET_RENDER_SCALE).toBe(1.3);
  });

  it("quantizes sampled fighter movement into deterministic octants", () => {
    const center = 50 * 100 + 50;
    expect(fighterHeadingOctant(center, 49 * 100 + 50, 100)).toBe(0);
    expect(fighterHeadingOctant(center, 49 * 100 + 51, 100)).toBe(1);
    expect(fighterHeadingOctant(center, 50 * 100 + 51, 100)).toBe(2);
    expect(fighterHeadingOctant(center, 51 * 100 + 51, 100)).toBe(3);
    expect(fighterHeadingOctant(center, 51 * 100 + 50, 100)).toBe(4);
    expect(fighterHeadingOctant(center, 51 * 100 + 49, 100)).toBe(5);
    expect(fighterHeadingOctant(center, 50 * 100 + 49, 100)).toBe(6);
    expect(fighterHeadingOctant(center, 49 * 100 + 49, 100)).toBe(7);
    expect(fighterHeadingOctant(center, center, 100)).toBe(0);
    expect(fighterHeadingOctant(center, 51 * 100 + 55, 100)).toBe(2);
  });

  it("derives a continuous clockwise-from-north heading byte and holds it while stationary", () => {
    const center = 50 * 100 + 50;
    expect(fighterHeadingByte(center, 49 * 100 + 50, 100, 77)).toBe(0); // north
    expect(fighterHeadingByte(center, 50 * 100 + 51, 100, 77)).toBe(64); // east
    expect(fighterHeadingByte(center, 51 * 100 + 50, 100, 77)).toBe(128); // south
    expect(fighterHeadingByte(center, 50 * 100 + 49, 100, 77)).toBe(192); // west
    expect(fighterHeadingByte(center, 49 * 100 + 51, 100, 77)).toBe(32); // north-east
    expect(fighterHeadingByte(center, center, 100, 77)).toBe(77);
    // Octants and bytes agree on the eight cardinal/diagonal headings.
    for (const [dx, dy] of [
      [0, -1],
      [1, -1],
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
    ]) {
      const pos = (50 + dy) * 100 + 50 + dx;
      expect(fighterHeadingByte(center, pos, 100, 0)).toBe(
        fighterHeadingOctant(center, pos, 100) * 32,
      );
    }
  });

  it("draws aircraft as a procedural silhouette with owner paint and a contrail", () => {
    const root = path.resolve(__dirname, "../../../..");
    const frag = fs.readFileSync(
      path.join(root, "src/client/render/gl/shaders/unit/aircraft.frag.glsl"),
      "utf8",
    );
    const vert = fs.readFileSync(
      path.join(root, "src/client/render/gl/shaders/unit/aircraft.vert.glsl"),
      "utf8",
    );
    const pass = fs.readFileSync(
      path.join(root, "src/client/render/gl/passes/UnitPass.ts"),
      "utf8",
    );
    expect(AIRCRAFT_SILHOUETTE_SCALE).toBeGreaterThan(1);
    expect(vert).toContain("6.2831853 / 256.0");
    expect(frag).toContain("sdTriangle");
    expect(frag).toContain("burner");
    expect(frag).toContain("trail");
    expect(frag).toContain("uAffiliation");
    expect(pass).toContain("gl.useProgram(this.aircraftProgram)");
    expect(pass).toContain("fighterHeadingByte(");
  });

  it("packs the airframe silhouette into the high bits of the flags byte", () => {
    expect(aircraftModelIndex(undefined)).toBe(0);
    expect(aircraftModelIndex(AircraftType.F16)).toBe(0);
    expect(aircraftModelIndex(AircraftType.F35)).toBe(1);
    expect(aircraftModelIndex(AircraftType.B2)).toBe(2);
    expect(aircraftModelIndex(AircraftType.F22)).toBe(3);
    expect(aircraftModelIndex(AircraftType.KAAN)).toBe(4);
    expect(aircraftModelIndex(AircraftType.Typhoon)).toBe(5);
    expect(aircraftModelIndex(AircraftType.A10)).toBe(6);
    expect(aircraftModelIndex(AircraftType.B52)).toBe(7);
    expect(AIRFRAME_MODEL_SHIFT).toBe(4);
    expect(airInstanceFlags(0, undefined)).toBe(0);
    expect(airInstanceFlags(1, 0)).toBe(1);
    expect(airInstanceFlags(1, 2)).toBe(1 | (2 << 4));
    expect(airInstanceFlags(5, 1)).toBe(5 | (1 << 4));
    expect(airInstanceFlags(0, 7)).toBe(7 << 4);
    // The low nibble is preserved and the model is clamped to three bits.
    expect(airInstanceFlags(0x3f, 9)).toBe(0x0f | (7 << 4));
    const root = path.resolve(__dirname, "../../../..");
    const frag = fs.readFileSync(
      path.join(root, "src/client/render/gl/shaders/unit/aircraft.frag.glsl"),
      "utf8",
    );
    const vert = fs.readFileSync(
      path.join(root, "src/client/render/gl/shaders/unit/aircraft.vert.glsl"),
      "utf8",
    );
    expect(vert).toContain("vModel = floor(aInstFlags.y / 16.0)");
    expect(frag).toContain("flat in float vModel;");
    expect(frag).toContain("int model = int(vModel + 0.5);");
    expect(frag).toContain("flyingWing");
  });

  it("packs fighter heading into the existing fourth instance byte", () => {
    const storage = new ArrayBuffer(16);
    const pass = Object.create(UnitPass.prototype) as UnitPass;
    Object.assign(pass, {
      airCount: 0,
      airBuf: {
        ensureCapacity: vi.fn(),
        float32: new Float32Array(storage),
        uint8: new Uint8Array(storage),
      },
    });

    (
      pass as unknown as {
        emitAir(
          x: number,
          y: number,
          ownerID: number,
          atlasIdx: number,
          flags: number,
          headingOctant: number,
        ): void;
      }
    ).emitAir(10, 20, 3, 12, 0, 7);

    const bytes = new Uint8Array(storage);
    expect(bytes[12]).toBe(12);
    expect(bytes[13]).toBe(0);
    expect(bytes[15]).toBe(7);
  });

  it("smooths high-speed air steps and uploads only active instances", () => {
    const f32 = new Float32Array(8);
    const bufferSubData = vi.fn();
    const gl = {
      ARRAY_BUFFER: 0x8892,
      bindBuffer: vi.fn(),
      bufferSubData,
    };
    vi.spyOn(performance, "now").mockReturnValue(1050);
    const pass = Object.create(UnitPass.prototype) as UnitPass;
    Object.assign(pass, {
      gl,
      airSmoothSegs: [0, 10, 20, 30, 40],
      airCount: 1,
      airBuf: { float32: f32, buffer: {} },
      lastUnitsUpdateMs: 1000,
      tickIntervalMs: 100,
    });

    (pass as unknown as { applyAirSmoothing(): void }).applyAirSmoothing();

    expect(f32[0]).toBeCloseTo(20);
    expect(f32[1]).toBeCloseTo(30);
    expect(bufferSubData).toHaveBeenCalledWith(gl.ARRAY_BUFFER, 0, f32, 0, 4);
  });

  it("does not render fighters with the warship-specific health bar", () => {
    const pass = Object.create(BarPass.prototype) as BarPass;
    Object.assign(pass, {
      healthData: new Float32Array(6),
      healthCount: 0,
      progressData: new Float32Array(6),
      progressCount: 0,
      veterancyData: new Float32Array(6),
      veterancyCount: 0,
      mapW: 100,
      maxBars: 2,
      warshipMaxHealth: 100,
      veterancyHealthBonus: 0,
    });
    const fighter = {
      unitType: UnitType.FighterJet,
      pos: 25,
      health: 50,
      veterancy: 0,
    } as unknown as UnitState;
    const warship = {
      unitType: UnitType.Warship,
      pos: 30,
      health: 50,
      veterancy: 1,
    } as unknown as UnitState;

    pass.updateBars(new Map([[1, fighter]]), new Map(), 0);
    expect((pass as unknown as { healthCount: number }).healthCount).toBe(0);
    expect((pass as unknown as { veterancyCount: number }).veterancyCount).toBe(
      0,
    );

    pass.updateBars(new Map([[2, warship]]), new Map(), 0);
    const state = pass as unknown as {
      healthCount: number;
      healthData: Float32Array;
      veterancyCount: number;
    };
    expect(state.healthCount).toBe(1);
    expect(Array.from(state.healthData.slice(0, 3))).toEqual([30, 0, 0.5]);
    expect(state.veterancyCount).toBe(1);
  });
});
