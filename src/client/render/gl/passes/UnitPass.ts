/**
 * UnitPass — GPU-rendered mobile unit sprites.
 *
 * Renders all mobile (non-structure) units: boats, aircraft, nukes, shells,
 * SAM missiles, and MIRV warheads. Sprites are tiny grayscale PNGs colorized on the
 * GPU using the standard 3-band gray replacement (180/130/70). MIRV
 * Warhead uses a programmatic 3×3 white square (colorized to border
 * color); Shell is a single white pixel.
 *
 * Three instanced draw calls per frame — ground, air, and missiles are
 * split into separate buffers for correct layer ordering:
 *   Ground/sea (boats, trains) → rendered below structures
 *   Air (fighter sorties) → rendered above structures and below UI bars
 *   Missiles (nukes, shells, SAM, MIRV warheads) → rendered above structures
 *
 * Atlas layout (13 columns × 13px cells):
 *   Col 0: Transport (5×5)
 *   Col 1: Trade Ship (5×5)
 *   Col 2: Warship (11×11)
 *   Col 3: Atom Bomb (7×7)
 *   Col 4: Hydrogen Bomb (9×9)
 *   Col 5: MIRV (13×13, grayscale colorized)
 *   Col 6: SAM Missile (3×3)
 *   Col 7: Shell (1×1 white pixel)
 *   Col 8: MIRV Warhead (3×3 white square)
 *   Col 9: Train Engine (5×5)
 *   Col 10: Train Carriage (5×5)
 *   Col 11: Train Carriage Loaded (5×5)
 *   Col 12: Fighter Jet (11×11)
 *
 * Data flow:
 *   FrameSnapshot.units → filter by typeToAtlasIdx → instance VBO → GPU
 *   Shells emit 2 instances (pos + lastPos) to match live game's 2-pixel trail.
 */

import { assetUrl } from "src/core/AssetUrls";
import type { Config } from "src/core/configuration/Config";
import type { RendererConfig, UnitState } from "../../types";
import {
  SMOOTHED_MISSILE_TYPES,
  TrainType,
  UT_ATOM_BOMB,
  UT_FIGHTER_BOMB,
  UT_FIGHTER_JET,
  UT_FIGHTER_MISSILE,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_MIRV_WARHEAD,
  UT_SAM_MISSILE,
  UT_SHELL,
  UT_TRADE_SHIP,
  UT_TRAIN,
  UT_TRANSPORT,
  UT_WARSHIP,
} from "../../types";
import { DynamicInstanceBuffer } from "../DynamicBuffer";
import type { RenderSettings } from "../RenderSettings";
import aircraftFragSrc from "../shaders/unit/aircraft.frag.glsl?raw";
import aircraftVertSrc from "../shaders/unit/aircraft.vert.glsl?raw";
import shipFragSrc from "../shaders/unit/ship.frag.glsl?raw";
import shipVertSrc from "../shaders/unit/ship.vert.glsl?raw";
import unitFragSrc from "../shaders/unit/unit.frag.glsl?raw";
import unitVertSrc from "../shaders/unit/unit.vert.glsl?raw";
import {
  getPaletteSize,
  MAX_TRAIL_COLORS,
  WARSHIP_EFFECT_BLOCK,
} from "../utils/ColorUtils";
import { createProgram, shaderSrc } from "../utils/GlUtils";
import {
  advanceShipDisplay,
  createShipDisplay,
  headingToByte,
  retargetShip,
  type ShipDisplay,
} from "./ShipMotion";

const unitAtlasUrl = assetUrl("atlases/unit-atlas.png");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Unit types in atlas column order. Index = atlas column.
 *  TrainEngine/TrainCarriage/TrainCarriageLoaded are synthetic names —
 *  they don't match header.unitTypes directly. Train resolution is
 *  handled specially in updateUnits() via trainType + loaded fields.
 */
const UNIT_ORDER = [
  UT_TRANSPORT,
  UT_TRADE_SHIP,
  UT_WARSHIP,
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_SAM_MISSILE,
  UT_SHELL,
  UT_MIRV_WARHEAD,
  "TrainEngine",
  "TrainCarriage",
  "TrainCarriageLoaded",
  UT_FIGHTER_JET,
] as const;

/** Resolve a wire unit type to the atlas column used by the GPU pass. */
export function unitAtlasColumnForType(
  unitType: string,
  airportOperationsV1 = false,
): number {
  return unitType === UT_FIGHTER_BOMB ||
    (airportOperationsV1 && unitType === UT_FIGHTER_MISSILE)
    ? UNIT_ORDER.indexOf(UT_ATOM_BOMB)
    : unitType === UT_FIGHTER_MISSILE
      ? UNIT_ORDER.indexOf(UT_SAM_MISSILE)
      : UNIT_ORDER.indexOf(unitType as (typeof UNIT_ORDER)[number]);
}

const ATLAS_COLS = UNIT_ORDER.length;

/** Atlas column of the hydrogen bomb — drives the GPU glow halo. */
const HYDROGEN_BOMB_COL = UNIT_ORDER.indexOf(UT_HYDROGEN_BOMB);

/** Atlas column of the warship — gates the warship cosmetic effect. */
const WARSHIP_COL = UNIT_ORDER.indexOf(UT_WARSHIP);

/** Fighter-only render constants; simulation size and camera behavior stay unchanged. */
const FIGHTER_JET_COL = UNIT_ORDER.indexOf(UT_FIGHTER_JET);
export const FIGHTER_JET_RENDER_SCALE = 1.3;
/**
 * Quad scale of the procedural aircraft silhouette relative to the unit cell.
 * The airframe spans about half the quad; the rest is contrail/afterburner
 * margin, so the visible jet stays close to the sprite footprint it replaces.
 */
export const AIRCRAFT_SILHOUETTE_SCALE = 2.2;

// ---------------------------------------------------------------------------
// Instance data layout
// ---------------------------------------------------------------------------

/**
 * Per-instance data (16 bytes):
 *   float x, y, ownerID   — 12 bytes (3 floats)
 *   uint8 atlasIdx         —  1 byte  (atlas column 0–12)
 *   uint8 flags            —  1 byte  (0 = normal, 1 = flicker, 2 = angry, 3 = trade-friendly, 4 = retreating, 5 = flicker-untargetable;
 *                                       air layer only: bits 4–5 carry the airframe silhouette, see airInstanceFlags)
 *   uint8 flickerHash      —  1 byte  (per-instance flicker phase offset)
 *   uint8 headingOctant    —  1 byte  (fighter: 0=N, 2=E, 4=S, 6=W)
 */
const FLOATS_PER_INSTANCE = 4;
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;

/** Flag values — passed as uint8, received as float in shader via normalized attribute */
const FLAG_NORMAL = 0;
const FLAG_FLICKER = 1;
const FLAG_ANGRY = 2;
const FLAG_TRADE_FRIENDLY = 3;
const FLAG_RETREATING = 4;
const FLAG_FLICKER_UNTARGETABLE = 5;

/** Atlas column indices for train sub-types (resolved from trainType + loaded) */
const TRAIN_ENGINE_COL = UNIT_ORDER.indexOf("TrainEngine");
const TRAIN_CARRIAGE_COL = UNIT_ORDER.indexOf("TrainCarriage");
const TRAIN_CARRIAGE_LOADED_COL = UNIT_ORDER.indexOf("TrainCarriageLoaded");

/** Nuke + warhead types — rendered with flickering hot colors */
const FLICKER_TYPES: ReadonlySet<string> = new Set([
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_MIRV_WARHEAD,
  UT_FIGHTER_MISSILE,
  UT_FIGHTER_BOMB,
  UT_SAM_MISSILE,
  UT_SHELL,
]);

/** Missile/projectile types — rendered on top of structures in the layer order.
 *  Ground/sea units (boats, trains) render below structures. */
const MISSILE_TYPES: ReadonlySet<string> = new Set([
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_SAM_MISSILE,
  UT_SHELL,
  UT_MIRV_WARHEAD,
  UT_FIGHTER_MISSILE,
  UT_FIGHTER_BOMB,
]);

/** Aircraft render in their own layer above structures, never as ground units. */
const AIR_TYPES: ReadonlySet<string> = new Set([UT_FIGHTER_JET]);

/** Ships (transport, trade ship, warship — see hullClassForType) render as
 *  procedural hulls in their own sea layer, below structures like ground
 *  units, instead of the 13-pixel atlas cells. */

/** Quad enlargement of the ship layer over the 13-tile sprite cell; the hull
 *  classes scale further down inside the shader (warship 1, trade ship 0.85,
 *  transport 0.75). Simulation size and camera behaviour stay unchanged. */
export const SHIP_SILHOUETTE_SCALE = 1.7;

/** Hull class of a sea instance, packed into bits 4–5 of the flags byte. */
export const HULL_CLASS_SHIFT = 4;
export const HULL_TRANSPORT = 0;
export const HULL_TRADE_SHIP = 1;
export const HULL_WARSHIP = 2;
/** Bit 6 of a sea instance's flags byte: the ship moved this tick (wake). */
export const HULL_UNDER_WAY_BIT = 0x40;

export function hullClassForType(unitType: string): number | undefined {
  switch (unitType) {
    case UT_TRANSPORT:
      return HULL_TRANSPORT;
    case UT_TRADE_SHIP:
      return HULL_TRADE_SHIP;
    case UT_WARSHIP:
      return HULL_WARSHIP;
    default:
      return undefined;
  }
}

/** Sea instances only: the FLAG_* state keeps the low nibble, the hull class
 *  rides in bits 4–5 and the under-way bit in bit 6. */
export function seaInstanceFlags(
  flags: number,
  hullClass: number,
  underWay: boolean,
): number {
  const hull = Math.min(3, Math.max(0, Math.floor(hullClass)));
  return (
    (flags & 0x0f) |
    (hull << HULL_CLASS_SHIFT) |
    (underWay ? HULL_UNDER_WAY_BIT : 0)
  );
}

/** Values per smoothing segment in the flat `smoothSegs` array:
 *  (instanceIdx, lastX, lastY, x, y). The push site and the read loop must
 *  agree on this width — it's the record size, not a tunable. */
const SMOOTH_SEG_STRIDE = 5;

/** Per-instance flicker phase offset, hashed from the tick position. Computed
 *  CPU-side (not from the shader's instance position) so per-frame position
 *  smoothing doesn't re-roll the flicker every frame. Matches the formula the
 *  vertex shader previously applied to its rendered position. */
/** Air instances only: the airframe silhouette index rides in bits 4–6. */
export const AIRFRAME_MODEL_SHIFT = 4;
export const AIRFRAME_MODEL_COUNT = 8;

export function airInstanceFlags(
  flags: number,
  aircraftModel: number | undefined,
): number {
  const model = Math.min(
    AIRFRAME_MODEL_COUNT - 1,
    Math.max(0, Math.floor(aircraftModel ?? 0)),
  );
  return (flags & 0x0f) | (model << AIRFRAME_MODEL_SHIFT);
}

export function flickerHashByte(x: number, y: number): number {
  const f = x * 0.1731 + y * 0.3179;
  return ((f - Math.floor(f)) * 255) | 0;
}

/**
 * Continuous fighter heading as a byte (0..255 = 0..2π clockwise from north).
 * A stationary fighter keeps its previous heading so it never snaps back to
 * north between sampled route steps.
 */
export function fighterHeadingByte(
  lastPos: number,
  pos: number,
  mapW: number,
  previous: number,
): number {
  if (lastPos === pos) return previous;
  const lastX = lastPos % mapW;
  const lastY = (lastPos - lastX) / mapW;
  const x = pos % mapW;
  const y = (pos - x) / mapW;
  const dx = x - lastX;
  const dy = y - lastY;
  if (dx === 0 && dy === 0) return previous;
  const angle = Math.atan2(dx, -dy); // clockwise from north, screen y down
  const turns = angle / (Math.PI * 2);
  return Math.round((turns - Math.floor(turns)) * 256) & 255;
}

/**
 * Interpolates two heading bytes (0..255 = one turn) along the shorter arc.
 * Exported for tests.
 */
export function lerpHeadingByte(
  previous: number,
  next: number,
  t: number,
): number {
  let delta = ((next - previous + 128) & 255) - 128;
  if (delta === -128) delta = 128;
  return Math.round(previous + delta * Math.min(1, Math.max(0, t))) & 255;
}

/**
 * Quantize a fighter movement vector into one of eight stable headings.
 *
 * The source sprite points north. Integer comparisons keep the result
 * deterministic and avoid frame-to-frame angle shimmer on long sampled air
 * steps. A stationary fighter retains the north-facing source orientation.
 */
export function fighterHeadingOctant(
  lastPos: number,
  pos: number,
  mapW: number,
): number {
  if (lastPos === pos) return 0;

  const lastX = lastPos % mapW;
  const lastY = (lastPos - lastX) / mapW;
  const x = pos % mapW;
  const y = (pos - x) / mapW;
  const dx = x - lastX;
  const dy = y - lastY;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (absX > absY * 2) return dx > 0 ? 2 : 6;
  if (absY > absX * 2) return dy > 0 ? 4 : 0;
  if (dx > 0) return dy > 0 ? 3 : 1;
  return dy > 0 ? 5 : 7;
}

// ---------------------------------------------------------------------------
// Helper: create a VAO for instanced unit rendering
// ---------------------------------------------------------------------------

function createUnitVao(
  gl: WebGL2RenderingContext,
  quadBuf: WebGLBuffer,
  instanceBuf: WebGLBuffer,
): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  // Attribute 0: unit quad [0,0]->[1,1]
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Attribute 1: per-instance vec3 (x, y, ownerID) — 3 floats at offset 0
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuf);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, BYTES_PER_INSTANCE, 0);
  gl.vertexAttribDivisor(1, 1);

  // Attribute 2: per-instance (atlasIdx, flags, flickerHash, headingOctant)
  // — 4 uint8s at offset 12, converted to float.
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, false, BYTES_PER_INSTANCE, 12);
  gl.vertexAttribDivisor(2, 1);

  gl.bindVertexArray(null);
  return vao;
}

// ---------------------------------------------------------------------------
// UnitPass
// ---------------------------------------------------------------------------

export class UnitPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private program: WebGLProgram;

  private uCamera: WebGLUniformLocation;
  private uTick: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private uUnitSize: WebGLUniformLocation;
  private uFlickerSpeed: WebGLUniformLocation;
  private uAngryColor: WebGLUniformLocation;
  private uAltView: WebGLUniformLocation;
  private uHBombGlowScale: WebGLUniformLocation;
  private uHBombGlowColor: WebGLUniformLocation;
  private uHBombGlowStrength: WebGLUniformLocation;
  private uHBombGlowInner: WebGLUniformLocation;
  private uUntargetableAlpha: WebGLUniformLocation;

  private affiliationTex: WebGLTexture | null = null;
  private altView = false;

  // Ground/sea units (boats, trains) — render below structures
  private groundVao: WebGLVertexArrayObject;
  private groundBuf: DynamicInstanceBuffer;
  private groundCount = 0;

  // Ships — procedural hulls, drawn right after the ground layer
  private seaVao: WebGLVertexArrayObject;
  private shipProgram: WebGLProgram;
  private uShipCamera: WebGLUniformLocation;
  private uShipUnitSize: WebGLUniformLocation;
  private uShipTime: WebGLUniformLocation;
  private uShipAltView: WebGLUniformLocation;
  private uShipAngryColor: WebGLUniformLocation;
  /** Smoothed display state per ship id (see ShipMotion). */
  private seaDisplays = new Map<number, ShipDisplay>();
  private seaBuf: DynamicInstanceBuffer;
  private seaCount = 0;
  /** Flat (instanceIdx, unitId) pairs for every ship emitted this tick. */
  private seaTrack: number[] = [];
  private lastSeaFrameMs = 0;

  // Aircraft — render above structures and below bars/selection overlays
  private airVao: WebGLVertexArrayObject;
  private aircraftProgram: WebGLProgram;
  private uAircraftCamera: WebGLUniformLocation;
  private uAircraftUnitSize: WebGLUniformLocation;
  private uAircraftTime: WebGLUniformLocation;
  private uAircraftAltView: WebGLUniformLocation;
  /** Last rendered heading byte per fighter id — keeps stationary jets steady. */
  private airHeadings = new Map<number, number>();
  // Per-frame heading smoothing: (instanceIdx, previousByte, headingByte)
  // for jets whose heading changed this tick, turned along the short arc.
  private airHeadingSegs: number[] = [];
  private airBuf: DynamicInstanceBuffer;
  private airCount = 0;
  private airSmoothSegs: number[] = [];

  // Missiles/projectiles (nukes, shells, SAM) — render above structures
  private missileVao: WebGLVertexArrayObject;
  private missileBuf: DynamicInstanceBuffer;
  private missileCount = 0;

  // Per-frame nuke smoothing: flat SMOOTH_SEG_STRIDE-wide tuples
  // (instanceIdx, lastX, lastY, x, y) recorded each tick, lerped into the
  // missile buffer in drawMissiles.
  private smoothSegs: number[] = [];
  private lastUnitsUpdateMs = 0;
  /** Simulation tick duration in ms (Config.msPerTick). */
  private tickIntervalMs: number;

  private quadBuf: WebGLBuffer;
  private paletteTex: WebGLTexture;
  private effectTex: WebGLTexture;
  private atlasTex: WebGLTexture;

  /** Render frame counter received from renderer — drives uTick shader uniform and flicker effects */
  private frameTick = 0;
  /** Last game engine tick received for smoothing calculation resets */
  private lastGameTick = -1;
  /** Wall-clock start, for uTime (seconds) — matches StructurePass so the
   *  warship effect animates at the same pace as the structures effect. */
  private startTime = performance.now();

  /** unitType string → atlas column (0-12) */
  private typeToAtlasCol = new Map<string, number>();
  private mapW: number;

  // Trade-friendly detection: enemy trade ships heading to a self/allied port
  private localPlayerID = 0;
  private friendlyOwners = new Set<number>();
  private structures: Map<number, UnitState> = new Map();

  constructor(
    gl: WebGL2RenderingContext,
    header: RendererConfig,
    paletteTex: WebGLTexture,
    effectTex: WebGLTexture,
    settings: RenderSettings,
    config: Config,
  ) {
    this.gl = gl;
    this.settings = settings;
    this.mapW = header.mapWidth;
    this.paletteTex = paletteTex;
    this.effectTex = effectTex;
    this.tickIntervalMs = config.msPerTick();

    // Build unitType string → atlas column mapping
    for (let i = 0; i < header.unitTypes.length; i++) {
      const col = unitAtlasColumnForType(
        header.unitTypes[i],
        config.airportOperationsV1Enabled?.() === true,
      );
      if (col >= 0) {
        this.typeToAtlasCol.set(header.unitTypes[i], col);
      }
    }

    // Compile shaders
    this.program = createProgram(
      gl,
      shaderSrc(unitVertSrc, {
        ATLAS_COLS,
        HYDROGEN_BOMB_COL,
        FIGHTER_JET_COL,
        FIGHTER_JET_SCALE: FIGHTER_JET_RENDER_SCALE,
      }),
      shaderSrc(unitFragSrc, {
        PALETTE_SIZE: getPaletteSize(),
        ATLAS_COLS,
        WARSHIP_COL,
        WARSHIP_EFFECT_ROW_BASE: WARSHIP_EFFECT_BLOCK * MAX_TRAIL_COLORS,
      }),
    );
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uTick = gl.getUniformLocation(this.program, "uTick")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;
    this.uUnitSize = gl.getUniformLocation(this.program, "uUnitSize")!;
    this.uFlickerSpeed = gl.getUniformLocation(this.program, "uFlickerSpeed")!;
    this.uAngryColor = gl.getUniformLocation(this.program, "uAngryColor")!;

    this.uAltView = gl.getUniformLocation(this.program, "uAltView")!;
    this.uHBombGlowScale = gl.getUniformLocation(
      this.program,
      "uHBombGlowScale",
    )!;
    this.uHBombGlowColor = gl.getUniformLocation(
      this.program,
      "uHBombGlowColor",
    )!;
    this.uHBombGlowStrength = gl.getUniformLocation(
      this.program,
      "uHBombGlowStrength",
    )!;
    this.uHBombGlowInner = gl.getUniformLocation(
      this.program,
      "uHBombGlowInner",
    )!;
    this.uUntargetableAlpha = gl.getUniformLocation(
      this.program,
      "uUntargetableAlpha",
    )!;

    // Procedural aircraft silhouette for the air layer (same instance layout).
    this.aircraftProgram = createProgram(
      gl,
      shaderSrc(aircraftVertSrc, {
        AIRCRAFT_SCALE: AIRCRAFT_SILHOUETTE_SCALE,
      }),
      shaderSrc(aircraftFragSrc, {
        PALETTE_SIZE: getPaletteSize(),
      }),
    );
    this.uAircraftCamera = gl.getUniformLocation(
      this.aircraftProgram,
      "uCamera",
    )!;
    this.uAircraftUnitSize = gl.getUniformLocation(
      this.aircraftProgram,
      "uUnitSize",
    )!;
    this.uAircraftTime = gl.getUniformLocation(this.aircraftProgram, "uTime")!;
    this.uAircraftAltView = gl.getUniformLocation(
      this.aircraftProgram,
      "uAltView",
    )!;
    gl.useProgram(this.aircraftProgram);
    gl.uniform1i(gl.getUniformLocation(this.aircraftProgram, "uPalette"), 0);
    gl.uniform1i(
      gl.getUniformLocation(this.aircraftProgram, "uAffiliation"),
      2,
    );

    // Procedural ship hulls for the sea layer (same instance layout).
    this.shipProgram = createProgram(
      gl,
      shaderSrc(shipVertSrc, { SHIP_SCALE: SHIP_SILHOUETTE_SCALE }),
      shaderSrc(shipFragSrc, {
        PALETTE_SIZE: getPaletteSize(),
        WARSHIP_EFFECT_ROW_BASE: WARSHIP_EFFECT_BLOCK * MAX_TRAIL_COLORS,
      }),
    );
    this.uShipCamera = gl.getUniformLocation(this.shipProgram, "uCamera")!;
    this.uShipUnitSize = gl.getUniformLocation(this.shipProgram, "uUnitSize")!;
    this.uShipTime = gl.getUniformLocation(this.shipProgram, "uTime")!;
    this.uShipAltView = gl.getUniformLocation(this.shipProgram, "uAltView")!;
    this.uShipAngryColor = gl.getUniformLocation(
      this.shipProgram,
      "uAngryColor",
    )!;
    gl.useProgram(this.shipProgram);
    gl.uniform1i(gl.getUniformLocation(this.shipProgram, "uPalette"), 0);
    gl.uniform1i(gl.getUniformLocation(this.shipProgram, "uAffiliation"), 2);
    gl.uniform1i(gl.getUniformLocation(this.shipProgram, "uEffect"), 3);

    // Texture unit bindings
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPalette"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uAtlas"), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "uAffiliation"), 2);
    gl.uniform1i(gl.getUniformLocation(this.program, "uEffect"), 3);

    // Create placeholder atlas texture (1x1 gray pixel)
    this.atlasTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([128, 128, 128, 255]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Start async atlas build
    this.loadAtlas();

    // --- Shared quad buffer ---
    this.quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );

    // --- Ground instance buffer + VAO ---
    const groundGlBuf = gl.createBuffer()!;
    this.groundBuf = new DynamicInstanceBuffer(
      gl,
      groundGlBuf,
      1024,
      FLOATS_PER_INSTANCE,
    );
    this.groundVao = createUnitVao(gl, this.quadBuf, groundGlBuf);

    // --- Sea instance buffer + VAO ---
    const seaGlBuf = gl.createBuffer()!;
    this.seaBuf = new DynamicInstanceBuffer(
      gl,
      seaGlBuf,
      256,
      FLOATS_PER_INSTANCE,
    );
    this.seaVao = createUnitVao(gl, this.quadBuf, seaGlBuf);

    // --- Air instance buffer + VAO ---
    const airGlBuf = gl.createBuffer()!;
    this.airBuf = new DynamicInstanceBuffer(
      gl,
      airGlBuf,
      128,
      FLOATS_PER_INSTANCE,
    );
    this.airVao = createUnitVao(gl, this.quadBuf, airGlBuf);

    // --- Missile instance buffer + VAO ---
    const missileGlBuf = gl.createBuffer()!;
    this.missileBuf = new DynamicInstanceBuffer(
      gl,
      missileGlBuf,
      512,
      FLOATS_PER_INSTANCE,
    );
    this.missileVao = createUnitVao(gl, this.quadBuf, missileGlBuf);
  }

  private async loadAtlas(): Promise<void> {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = unitAtlasUrl;
    await img.decode();
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  private emitGround(
    x: number,
    y: number,
    ownerID: number,
    atlasIdx: number,
    flags: number,
  ): void {
    this.groundBuf.ensureCapacity(this.groundCount + 1);
    const off = this.groundCount * FLOATS_PER_INSTANCE;
    this.groundBuf.float32[off + 0] = x;
    this.groundBuf.float32[off + 1] = y;
    this.groundBuf.float32[off + 2] = ownerID;
    const byteOff = this.groundCount * BYTES_PER_INSTANCE;
    this.groundBuf.uint8[byteOff + 12] = atlasIdx;
    this.groundBuf.uint8[byteOff + 13] = flags;
    this.groundBuf.uint8[byteOff + 14] = flickerHashByte(x, y);
    this.groundBuf.uint8[byteOff + 15] = 0;
    this.groundCount++;
  }

  private emitMissile(
    x: number,
    y: number,
    ownerID: number,
    atlasIdx: number,
    flags: number,
  ): void {
    this.missileBuf.ensureCapacity(this.missileCount + 1);
    const off = this.missileCount * FLOATS_PER_INSTANCE;
    this.missileBuf.float32[off + 0] = x;
    this.missileBuf.float32[off + 1] = y;
    this.missileBuf.float32[off + 2] = ownerID;
    const byteOff = this.missileCount * BYTES_PER_INSTANCE;
    this.missileBuf.uint8[byteOff + 12] = atlasIdx;
    this.missileBuf.uint8[byteOff + 13] = flags;
    this.missileBuf.uint8[byteOff + 14] = flickerHashByte(x, y);
    this.missileBuf.uint8[byteOff + 15] = 0;
    this.missileCount++;
  }

  private emitSea(
    x: number,
    y: number,
    ownerID: number,
    atlasIdx: number,
    flags: number,
    heading: number,
  ): void {
    this.seaBuf.ensureCapacity(this.seaCount + 1);
    const off = this.seaCount * FLOATS_PER_INSTANCE;
    this.seaBuf.float32[off + 0] = x;
    this.seaBuf.float32[off + 1] = y;
    this.seaBuf.float32[off + 2] = ownerID;
    const byteOff = this.seaCount * BYTES_PER_INSTANCE;
    this.seaBuf.uint8[byteOff + 12] = atlasIdx;
    this.seaBuf.uint8[byteOff + 13] = flags;
    this.seaBuf.uint8[byteOff + 14] = flickerHashByte(x, y);
    this.seaBuf.uint8[byteOff + 15] = heading;
    this.seaCount++;
  }

  private emitAir(
    x: number,
    y: number,
    ownerID: number,
    atlasIdx: number,
    flags: number,
    headingOctant: number,
  ): void {
    this.airBuf.ensureCapacity(this.airCount + 1);
    const off = this.airCount * FLOATS_PER_INSTANCE;
    this.airBuf.float32[off + 0] = x;
    this.airBuf.float32[off + 1] = y;
    this.airBuf.float32[off + 2] = ownerID;
    const byteOff = this.airCount * BYTES_PER_INSTANCE;
    this.airBuf.uint8[byteOff + 12] = atlasIdx;
    this.airBuf.uint8[byteOff + 13] = flags;
    this.airBuf.uint8[byteOff + 14] = flickerHashByte(x, y);
    this.airBuf.uint8[byteOff + 15] = headingOctant;
    this.airCount++;
  }

  setFrameTick(frameTick: number): void {
    this.frameTick = frameTick;
  }

  updateUnits(units: Map<number, UnitState>, gameTick: number): void {
    if (gameTick !== this.lastGameTick) {
      this.lastGameTick = gameTick;
      this.lastUnitsUpdateMs = performance.now();
    }
    this.groundCount = 0;
    this.seaCount = 0;
    this.seaTrack.length = 0;
    this.airCount = 0;
    this.airSmoothSegs.length = 0;
    (this.airHeadingSegs ??= []).length = 0;
    this.missileCount = 0;
    this.smoothSegs.length = 0;
    if (this.airHeadings.size > 0) {
      for (const id of this.airHeadings.keys()) {
        if (!units.has(id)) this.airHeadings.delete(id);
      }
    }
    if (this.seaDisplays.size > 0) {
      for (const id of this.seaDisplays.keys()) {
        if (!units.has(id)) this.seaDisplays.delete(id);
      }
    }

    for (const unit of units.values()) {
      if (!unit.isActive || unit.waitTicks > 0) continue;

      let atlasIdx = this.typeToAtlasCol.get(unit.unitType);

      // Train sub-type resolution: "Train" isn't in UNIT_ORDER.
      // Resolve to engine/carriage/loaded carriage based on trainType + loaded fields.
      if (atlasIdx === undefined && unit.unitType === UT_TRAIN) {
        const tt = unit.trainType;
        if (tt === TrainType.Engine || tt === TrainType.TailEngine) {
          atlasIdx = TRAIN_ENGINE_COL;
        } else {
          atlasIdx = unit.loaded
            ? TRAIN_CARRIAGE_LOADED_COL
            : TRAIN_CARRIAGE_COL;
        }
      }

      if (atlasIdx === undefined) continue;

      const isRetreatingWarship =
        unit.unitType === UT_WARSHIP && unit.retreating;
      const isAngryWarship =
        unit.unitType === UT_WARSHIP && unit.targetUnitId !== null;
      const isFlicker = FLICKER_TYPES.has(unit.unitType);

      // Enemy trade ships heading to a self/allied port get FLAG_TRADE_FRIENDLY
      // so alt-view renders them yellow instead of red.
      let isTradeFriendly = false;
      if (
        unit.unitType === UT_TRADE_SHIP &&
        unit.targetUnitId !== null &&
        this.localPlayerID > 0
      ) {
        const targetPort = this.structures.get(unit.targetUnitId);
        if (targetPort) {
          const portOwner = targetPort.ownerID;
          // Only recolor enemy-owned ships: a self/allied ship already renders
          // green/yellow via its affiliation color (e.g. a captured trade ship
          // heading to our port is ours and must stay green, not yellow).
          isTradeFriendly =
            unit.ownerID !== this.localPlayerID &&
            !this.friendlyOwners.has(unit.ownerID) &&
            (portOwner === this.localPlayerID ||
              this.friendlyOwners.has(portOwner));
        }
      }

      let flags = FLAG_NORMAL;
      if (isTradeFriendly) {
        flags = FLAG_TRADE_FRIENDLY;
      } else if (isRetreatingWarship) {
        flags = FLAG_RETREATING;
      } else if (isAngryWarship) {
        flags = FLAG_ANGRY;
      } else if (isFlicker) {
        // Untargetable nukes render dimmed so players can tell SAMs can't hit them
        flags = unit.targetable ? FLAG_FLICKER : FLAG_FLICKER_UNTARGETABLE;
      }
      const isMissile = MISSILE_TYPES.has(unit.unitType);
      const isAir = AIR_TYPES.has(unit.unitType);
      const hullClass = hullClassForType(unit.unitType);

      const x = unit.pos % this.mapW;
      const y = (unit.pos - x) / this.mapW;

      if (hullClass !== undefined) {
        const underWay = unit.lastPos !== unit.pos;
        const now = this.lastUnitsUpdateMs;
        let display = this.seaDisplays.get(unit.id);
        if (display === undefined) {
          display = createShipDisplay(
            x,
            y,
            fighterHeadingByte(unit.lastPos, unit.pos, this.mapW, 0),
            now,
          );
          this.seaDisplays.set(unit.id, display);
        } else {
          retargetShip(display, x, y, now);
        }
        this.seaTrack.push(this.seaCount, unit.id);
        this.emitSea(
          display.x,
          display.y,
          unit.ownerID,
          atlasIdx,
          seaInstanceFlags(flags, hullClass, underWay),
          headingToByte(display.heading),
        );
      } else if (isAir) {
        if (unit.lastPos !== unit.pos) {
          const lx = unit.lastPos % this.mapW;
          const ly = (unit.lastPos - lx) / this.mapW;
          this.airSmoothSegs.push(this.airCount, lx, ly, x, y);
        }
        const previousHeading = this.airHeadings.get(unit.id);
        const heading = fighterHeadingByte(
          unit.lastPos,
          unit.pos,
          this.mapW,
          previousHeading ?? 0,
        );
        this.airHeadings.set(unit.id, heading);
        if (previousHeading !== undefined && previousHeading !== heading) {
          (this.airHeadingSegs ??= []).push(
            this.airCount,
            previousHeading,
            heading,
          );
        }
        this.emitAir(
          x,
          y,
          unit.ownerID,
          atlasIdx,
          airInstanceFlags(flags, unit.aircraftModel),
          heading,
        );
      } else if (isMissile) {
        if (
          SMOOTHED_MISSILE_TYPES.has(unit.unitType) &&
          unit.lastPos !== unit.pos
        ) {
          const lx = unit.lastPos % this.mapW;
          const ly = (unit.lastPos - lx) / this.mapW;
          this.smoothSegs.push(this.missileCount, lx, ly, x, y);
        }
        this.emitMissile(x, y, unit.ownerID, atlasIdx, flags);

        // Shells emit a second instance at lastPos (2-pixel trail effect)
        if (unit.unitType === UT_SHELL && unit.lastPos !== unit.pos) {
          const lx = unit.lastPos % this.mapW;
          const ly = (unit.lastPos - lx) / this.mapW;
          this.emitMissile(lx, ly, unit.ownerID, atlasIdx, flags);
        }
      } else {
        this.emitGround(x, y, unit.ownerID, atlasIdx, flags);
      }
    }

    const gl = this.gl;
    if (this.groundCount > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.groundBuf.buffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.groundBuf.float32,
        0,
        this.groundCount * FLOATS_PER_INSTANCE,
      );
    }
    if (this.seaCount > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.seaBuf.buffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.seaBuf.float32,
        0,
        this.seaCount * FLOATS_PER_INSTANCE,
      );
    }
    if (this.missileCount > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.missileBuf.buffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.missileBuf.float32,
        0,
        this.missileCount * FLOATS_PER_INSTANCE,
      );
    }
    if (this.airCount > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.airBuf.buffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.airBuf.float32,
        0,
        this.airCount * FLOATS_PER_INSTANCE,
      );
    }
  }

  setAltView(active: boolean): void {
    this.altView = active;
  }
  setAffiliationTex(tex: WebGLTexture): void {
    this.affiliationTex = tex;
  }
  setLocalPlayer(id: number): void {
    this.localPlayerID = id;
  }
  setAllies(allies: Set<number>): void {
    this.friendlyOwners = allies;
  }
  setStructures(structs: Map<number, UnitState>): void {
    this.structures = structs;
  }

  /** Bind shared program state + uniforms (call before drawGround/drawMissiles). */
  private bindProgram(cameraMatrix: Float32Array): void {
    const gl = this.gl;
    gl.useProgram(this.program);

    const us = this.settings.unit;
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uTick, this.frameTick);
    gl.uniform1f(this.uTime, (performance.now() - this.startTime) / 1000);
    gl.uniform1f(this.uUnitSize, us.unitSize);
    gl.uniform1f(this.uFlickerSpeed, us.flickerSpeed);
    gl.uniform3f(this.uAngryColor, us.angryR, us.angryG, us.angryB);
    gl.uniform1i(this.uAltView, this.altView ? 1 : 0);
    gl.uniform1f(this.uHBombGlowScale, us.hBombGlowScale);
    gl.uniform3f(
      this.uHBombGlowColor,
      us.hBombGlowR,
      us.hBombGlowG,
      us.hBombGlowB,
    );
    gl.uniform1f(this.uHBombGlowStrength, us.hBombGlowStrength);
    gl.uniform1f(this.uHBombGlowInner, us.hBombGlowInner);
    gl.uniform1f(this.uUntargetableAlpha, us.untargetableAlpha);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);

    if (this.affiliationTex) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.affiliationTex);
    }

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.effectTex);
  }

  /** Draw ground/sea units (boats, trains). Render below structures. */
  drawGround(cameraMatrix: Float32Array): void {
    if (this.groundCount === 0) return;
    this.bindProgram(cameraMatrix);
    const gl = this.gl;
    gl.bindVertexArray(this.groundVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.groundCount);
  }

  /** Draw ships as procedural hulls, right after the ground layer. */
  drawSea(cameraMatrix: Float32Array): void {
    if (this.seaCount === 0) return;
    this.applySeaSmoothing();
    const gl = this.gl;
    gl.useProgram(this.shipProgram);
    gl.uniformMatrix3fv(this.uShipCamera, false, cameraMatrix);
    gl.uniform1f(this.uShipUnitSize, this.settings.unit.unitSize);
    gl.uniform1f(this.uShipTime, (performance.now() - this.startTime) / 1000);
    gl.uniform1i(this.uShipAltView, this.altView ? 1 : 0);
    const u = this.settings.unit;
    gl.uniform3f(this.uShipAngryColor, u.angryR, u.angryG, u.angryB);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    if (this.affiliationTex) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.affiliationTex);
    }
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.effectTex);
    gl.bindVertexArray(this.seaVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.seaCount);
  }

  /**
   * Ships step one tile per simulation step; each frame the display point
   * chases that target at the ship's measured cruise speed and the bow turns
   * toward its travel direction (ShipMotion), then the active part of the
   * instance buffer is re-uploaded.
   */
  private applySeaSmoothing(): void {
    if (this.seaTrack.length === 0) return;
    const now = performance.now();
    const dt = this.lastSeaFrameMs === 0 ? 0 : now - this.lastSeaFrameMs;
    this.lastSeaFrameMs = now;
    const f32 = this.seaBuf.float32;
    const u8 = this.seaBuf.uint8;
    for (let i = 0; i < this.seaTrack.length; i += 2) {
      const display = this.seaDisplays.get(this.seaTrack[i + 1]);
      if (display === undefined) continue;
      advanceShipDisplay(display, dt, now);
      const instance = this.seaTrack[i];
      const off = instance * FLOATS_PER_INSTANCE;
      f32[off + 0] = display.x;
      f32[off + 1] = display.y;
      u8[instance * BYTES_PER_INSTANCE + 15] = headingToByte(display.heading);
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.seaBuf.buffer);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      f32,
      0,
      this.seaCount * FLOATS_PER_INSTANCE,
    );
  }

  /** Lerp each recorded segment lastPos→pos by wall-clock progress through the
   *  current tick and re-upload the active part of the instance buffer. */
  private lerpSmoothedInstances(
    segs: number[],
    buf: DynamicInstanceBuffer,
    count: number,
  ): void {
    if (segs.length === 0) return;
    const alpha = Math.min(
      1,
      (performance.now() - this.lastUnitsUpdateMs) / this.tickIntervalMs,
    );
    const f32 = buf.float32;
    for (let i = 0; i < segs.length; i += SMOOTH_SEG_STRIDE) {
      const off = segs[i] * FLOATS_PER_INSTANCE;
      f32[off + 0] = segs[i + 1] + (segs[i + 3] - segs[i + 1]) * alpha;
      f32[off + 1] = segs[i + 2] + (segs[i + 4] - segs[i + 2]) * alpha;
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, f32, 0, count * FLOATS_PER_INSTANCE);
  }

  /** Draw aircraft above structures while keeping tactical overlays legible. */
  drawAir(cameraMatrix: Float32Array): void {
    if (this.airCount === 0) return;
    this.applyAirSmoothing();
    const gl = this.gl;
    gl.useProgram(this.aircraftProgram);
    gl.uniformMatrix3fv(this.uAircraftCamera, false, cameraMatrix);
    gl.uniform1f(this.uAircraftUnitSize, this.settings.unit.unitSize);
    gl.uniform1f(
      this.uAircraftTime,
      (performance.now() - this.startTime) / 1000,
    );
    gl.uniform1i(this.uAircraftAltView, this.altView ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    if (this.affiliationTex) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.affiliationTex);
    }
    gl.bindVertexArray(this.airVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.airCount);
  }

  /** Smooth the fighter's high-speed tile steps without changing simulation. */
  private applyAirSmoothing(): void {
    const segs = this.airSmoothSegs;
    const headingSegs = this.airHeadingSegs ?? [];
    if (segs.length === 0 && headingSegs.length === 0) return;
    const alpha = Math.min(
      1,
      (performance.now() - this.lastUnitsUpdateMs) / this.tickIntervalMs,
    );
    const f32 = this.airBuf.float32;
    for (let i = 0; i < segs.length; i += SMOOTH_SEG_STRIDE) {
      const off = segs[i] * FLOATS_PER_INSTANCE;
      f32[off + 0] = segs[i + 1] + (segs[i + 3] - segs[i + 1]) * alpha;
      f32[off + 1] = segs[i + 2] + (segs[i + 4] - segs[i + 2]) * alpha;
    }
    // Headings turn along the short arc over the tick instead of snapping.
    const u8 = this.airBuf.uint8;
    for (let i = 0; i < headingSegs.length; i += 3) {
      u8[headingSegs[i] * BYTES_PER_INSTANCE + 15] = lerpHeadingByte(
        headingSegs[i + 1],
        headingSegs[i + 2],
        alpha,
      );
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.airBuf.buffer);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      f32,
      0,
      this.airCount * FLOATS_PER_INSTANCE,
    );
  }

  /** Draw missiles/projectiles (nukes, shells, SAM, MIRV warheads). Render above structures. */
  drawMissiles(cameraMatrix: Float32Array): void {
    if (this.missileCount === 0) return;
    this.applyMissileSmoothing();
    this.bindProgram(cameraMatrix);
    const gl = this.gl;
    gl.bindVertexArray(this.missileVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.missileCount);
  }

  /** Lerp smoothed nukes lastPos→pos by wall-clock progress through the
   *  current tick and re-upload the (small) missile instance buffer. */
  private applyMissileSmoothing(): void {
    const segs = this.smoothSegs;
    if (segs.length === 0) return;
    const alpha = Math.min(
      1,
      (performance.now() - this.lastUnitsUpdateMs) / this.tickIntervalMs,
    );
    const f32 = this.missileBuf.float32;
    for (let i = 0; i < segs.length; i += SMOOTH_SEG_STRIDE) {
      const off = segs[i] * FLOATS_PER_INSTANCE;
      f32[off + 0] = segs[i + 1] + (segs[i + 3] - segs[i + 1]) * alpha;
      f32[off + 1] = segs[i + 2] + (segs[i + 4] - segs[i + 2]) * alpha;
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.missileBuf.buffer);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      f32,
      0,
      this.missileCount * FLOATS_PER_INSTANCE,
    );
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteProgram(this.aircraftProgram);
    gl.deleteProgram(this.shipProgram);
    this.groundBuf.dispose();
    this.seaBuf.dispose();
    this.airBuf.dispose();
    this.missileBuf.dispose();
    gl.deleteBuffer(this.quadBuf);
    gl.deleteVertexArray(this.groundVao);
    gl.deleteVertexArray(this.seaVao);
    gl.deleteVertexArray(this.airVao);
    gl.deleteVertexArray(this.missileVao);
    gl.deleteTexture(this.atlasTex);
  }
}
