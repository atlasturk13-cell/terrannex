import fs from "fs";
import path from "path";
import {
  createShipDisplay,
  retargetShip,
  type ShipDisplay,
} from "../../../../src/client/render/gl/passes/ShipMotion";
import {
  HULL_CLASS_SHIFT,
  HULL_TRADE_SHIP,
  HULL_TRANSPORT,
  HULL_UNDER_WAY_BIT,
  HULL_WARSHIP,
  hullClassForType,
  seaInstanceFlags,
  SHIP_SILHOUETTE_SCALE,
  UnitPass,
} from "../../../../src/client/render/gl/passes/UnitPass";
import type { UnitState } from "../../../../src/client/render/types";
import { UnitType } from "../../../../src/core/game/Game";

const root = path.resolve(__dirname, "../../../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function unit(
  partial: Partial<UnitState> & Pick<UnitState, "id" | "unitType" | "pos">,
): UnitState {
  return {
    ownerID: 1,
    lastOwnerID: null,
    lastPos: partial.pos,
    isActive: true,
    reachedTarget: false,
    retreating: false,
    targetable: true,
    waitTicks: 0,
    markedForDeletion: false,
    health: null,
    underConstruction: false,
    targetUnitId: null,
    targetTile: null,
    troops: 0,
    missileTimerQueue: [],
    level: 1,
    veterancy: 0,
    hasTrainStation: false,
    trainType: null,
    loaded: null,
    constructionStartTick: null,
    ...partial,
  };
}

interface Harness {
  pass: UnitPass;
  sea: Uint8Array;
  seaF32: Float32Array;
  state: {
    seaCount: number;
    groundCount: number;
    airCount: number;
    seaTrack: number[];
    seaDisplays: Map<number, ShipDisplay>;
  };
}

/** A UnitPass without its GL constructor: only what updateUnits touches. */
function makeHarness(): Harness {
  const mk = (n: number) => {
    const storage = new ArrayBuffer(16 * n);
    return {
      ensureCapacity: vi.fn(),
      float32: new Float32Array(storage),
      uint8: new Uint8Array(storage),
      buffer: {},
    };
  };
  const seaBuf = mk(8);
  const pass = Object.create(UnitPass.prototype) as UnitPass;
  const typeToAtlasCol = new Map<string, number>([
    [UnitType.TransportShip, 0],
    [UnitType.TradeShip, 1],
    [UnitType.Warship, 2],
    [UnitType.FighterJet, 12],
  ]);
  Object.assign(pass, {
    gl: { ARRAY_BUFFER: 0x8892, bindBuffer: vi.fn(), bufferSubData: vi.fn() },
    typeToAtlasCol,
    mapW: 100,
    lastGameTick: -1,
    lastUnitsUpdateMs: 0,
    groundBuf: mk(8),
    groundCount: 0,
    seaBuf,
    seaCount: 0,
    seaTrack: [],
    seaDisplays: new Map<number, ShipDisplay>(),
    lastSeaFrameMs: 0,
    airBuf: mk(8),
    airCount: 0,
    airSmoothSegs: [],
    airHeadings: new Map<number, number>(),
    missileBuf: mk(8),
    missileCount: 0,
    smoothSegs: [],
    localPlayerID: 0,
    friendlyOwners: new Set<number>(),
    structures: new Map(),
  });
  return {
    pass,
    sea: seaBuf.uint8,
    seaF32: seaBuf.float32,
    state: pass as unknown as Harness["state"],
  };
}

describe("Ship sea render layer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("draws ships as procedural hulls with heading, owner paint and a wake", () => {
    const vert = read("src/client/render/gl/shaders/unit/ship.vert.glsl");
    const frag = read("src/client/render/gl/shaders/unit/ship.frag.glsl");
    const pass = read("src/client/render/gl/passes/UnitPass.ts");
    const renderer = read("src/client/render/gl/Renderer.ts");
    expect(SHIP_SILHOUETTE_SCALE).toBeGreaterThan(1);
    expect(vert).toContain("6.2831853 / 256.0");
    expect(vert).toContain("vHull = mod(upper, 4.0)");
    expect(vert).toContain("vUnderWay = mod(floor(upper / 4.0), 2.0)");
    for (const marker of [
      "sdPolygon",
      "hullOutline",
      "wake",
      "foam",
      "uAffiliation",
      "warshipEffectColor",
      "uAngryColor",
      "FLAG_RETREATING",
      "helideck",
      "ramp",
      "Container bay",
    ]) {
      expect(frag).toContain(marker);
    }
    expect(pass).toContain("gl.useProgram(this.shipProgram)");
    expect(pass).toContain("seaInstanceFlags(flags, hullClass, underWay)");
    expect(renderer).toContain("this.unitPass.drawGround(cam);");
    expect(renderer).toContain("this.unitPass.drawSea(cam);");
    // Ships stay below structures: the sea draw follows the ground draw and
    // precedes the structure pass.
    expect(renderer.indexOf("unitPass.drawSea(cam)")).toBeGreaterThan(
      renderer.indexOf("unitPass.drawGround(cam)"),
    );
    expect(renderer.indexOf("unitPass.drawSea(cam)")).toBeLessThan(
      renderer.indexOf("this.structurePass.draw(cam, zoom)"),
    );
  });

  it("packs the hull class and the under-way bit above the FLAG_* nibble", () => {
    expect(hullClassForType(UnitType.TransportShip)).toBe(HULL_TRANSPORT);
    expect(hullClassForType(UnitType.TradeShip)).toBe(HULL_TRADE_SHIP);
    expect(hullClassForType(UnitType.Warship)).toBe(HULL_WARSHIP);
    expect(hullClassForType(UnitType.FighterJet)).toBeUndefined();
    expect(hullClassForType(UnitType.Train)).toBeUndefined();
    expect(HULL_CLASS_SHIFT).toBe(4);
    expect(HULL_UNDER_WAY_BIT).toBe(0x40);
    expect(seaInstanceFlags(0, HULL_TRANSPORT, false)).toBe(0);
    expect(seaInstanceFlags(2, HULL_WARSHIP, true)).toBe(2 | (2 << 4) | 0x40);
    expect(seaInstanceFlags(4, HULL_WARSHIP, false)).toBe(4 | (2 << 4));
    expect(seaInstanceFlags(3, HULL_TRADE_SHIP, true)).toBe(
      3 | (1 << 4) | 0x40,
    );
    // The state nibble is preserved and the hull is clamped to two bits.
    expect(seaInstanceFlags(0x7f, 9, false)).toBe(0x0f | (3 << 4));
  });

  it("routes the three ship types to the sea buffer with heading and wake, trains stay ground", () => {
    const h = makeHarness();
    const units = new Map<number, UnitState>([
      // Warship heading east: lastPos (10,20) → pos (11,20).
      [
        1,
        unit({
          id: 1,
          unitType: UnitType.Warship,
          pos: 20 * 100 + 11,
          lastPos: 20 * 100 + 10,
          targetUnitId: 7,
        }),
      ],
      // Trade ship docked: no movement, heading held from a previous frame.
      [
        2,
        unit({
          id: 2,
          unitType: UnitType.TradeShip,
          pos: 30 * 100 + 5,
          ownerID: 3,
        }),
      ],
      // Transport heading south.
      [
        3,
        unit({
          id: 3,
          unitType: UnitType.TransportShip,
          pos: 41 * 100 + 8,
          lastPos: 40 * 100 + 8,
        }),
      ],
      // A train engine is still a ground sprite.
      [
        4,
        unit({
          id: 4,
          unitType: UnitType.Train,
          pos: 50 * 100 + 8,
          trainType: 0,
        }),
      ],
      // A jet stays in the air layer.
      [
        5,
        unit({
          id: 5,
          unitType: UnitType.FighterJet,
          pos: 60 * 100 + 8,
          lastPos: 60 * 100 + 7,
        }),
      ],
    ]);
    // The docked trade ship was seen before, pointing south-west.
    h.state.seaDisplays.set(2, createShipDisplay(5, 30, 192, 0));

    h.pass.updateUnits(units, 1);

    expect(h.state.seaCount).toBe(3);
    expect(h.state.groundCount).toBe(1);
    expect(h.state.airCount).toBe(1);
    // Warship: atlas 2, angry state + warship hull + under way, heading east.
    expect(h.sea[12]).toBe(2);
    expect(h.sea[13]).toBe(2 | (HULL_WARSHIP << 4) | HULL_UNDER_WAY_BIT);
    expect(h.sea[15]).toBe(64);
    expect(h.seaF32[0]).toBe(11);
    expect(h.seaF32[1]).toBe(20);
    // Trade ship: docked, previous heading kept, no wake bit.
    expect(h.sea[16 + 13]).toBe(HULL_TRADE_SHIP << 4);
    expect(h.sea[16 + 15]).toBe(192);
    expect(h.seaF32[4 + 2]).toBe(3);
    // Transport: heading south, under way.
    expect(h.sea[32 + 13]).toBe((HULL_TRANSPORT << 4) | HULL_UNDER_WAY_BIT);
    expect(h.sea[32 + 15]).toBe(128);
    // Every ship is tracked (instance, id) for per-frame smoothing.
    expect(h.state.seaTrack).toEqual([0, 1, 1, 2, 2, 3]);
    // Display state persists per ship id and vanishes with the ship.
    expect(h.state.seaDisplays.get(1)?.heading).toBeCloseTo(Math.PI / 2);
    expect(h.state.seaDisplays.get(1)?.tx).toBe(11);
    units.delete(1);
    h.pass.updateUnits(units, 2);
    expect(h.state.seaDisplays.has(1)).toBe(false);
  });

  it("glides ships between tile steps from their sample history", () => {
    const storage = new ArrayBuffer(32);
    const f32 = new Float32Array(storage);
    const u8 = new Uint8Array(storage);
    const bufferSubData = vi.fn();
    const gl = { ARRAY_BUFFER: 0x8892, bindBuffer: vi.fn(), bufferSubData };
    // Ship 1 (instance 1) stepped (10,20) → (11,20) at t=1000; the frame
    // renders 120 ms behind, inside that segment.
    const display = createShipDisplay(10, 20, 64, 900);
    retargetShip(display, 11, 20, 1000);
    vi.spyOn(performance, "now").mockReturnValue(1075);
    const pass = Object.create(UnitPass.prototype) as UnitPass;
    Object.assign(pass, {
      gl,
      seaTrack: [1, 1],
      seaDisplays: new Map([[1, display]]),
      seaCount: 2,
      seaBuf: { float32: f32, uint8: u8, buffer: {} },
      lastSeaFrameMs: 1065,
    });
    (pass as unknown as { applySeaSmoothing(): void }).applySeaSmoothing();
    expect(f32[4]).toBeGreaterThan(10);
    expect(f32[4]).toBeLessThan(11);
    expect(f32[5]).toBeCloseTo(20);
    expect(u8[16 + 15]).toBe(64);
    expect(bufferSubData).toHaveBeenCalledWith(gl.ARRAY_BUFFER, 0, f32, 0, 8);
  });
});
