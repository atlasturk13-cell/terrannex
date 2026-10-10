/**
 * ShipMotion — per-ship display smoothing.
 *
 * The simulation moves a ship one whole tile per step and the client only
 * learns about it once per tick. Lerping lastPos→pos inside a single tick
 * reproduces every artifact of that sampling: the hull stalls when a tick
 * arrives late, hops when one arrives early, stops dead between steps for
 * slow hulls, and swings its bow through 45° every tile on a grid path.
 *
 * Instead each ship keeps a short history of (time, tile) samples and is
 * drawn a fixed delay behind the newest one, interpolating between the two
 * samples that bracket the render time — the entity-interpolation scheme
 * networked games use. Between on-time ticks the hull moves in a straight
 * line at constant speed, ticks that arrive late or early only shift where
 * inside the history the render time falls, and hulls that step every N
 * ticks glide at N times the interval instead of hopping and waiting.
 * A light follow filter rounds the corners of the tile path and the bow
 * turns toward the direction the display point actually travels, rate
 * limited, so headings sweep smoothly through zig-zag grid paths.
 * Everything here is pure so it can be unit tested.
 */

export interface ShipDisplay {
  /** Smoothed world position (tile units, tile origin — not centered). */
  x: number;
  y: number;
  /** Smoothed heading, radians clockwise from north (screen +y is down). */
  heading: number;
  /** Latest tile target from the simulation. */
  tx: number;
  ty: number;
  /** Ring of (timeMs, x, y) samples, oldest first. */
  samples: number[];
  /** Measured interval between samples (ms); sets the render delay. */
  intervalMs: number;
}

/** Above this distance the display snaps instead of gliding (teleports). */
export const SHIP_SNAP_DISTANCE = 6;
/**
 * Minimum render delay behind the newest sample so there is always a segment
 * to interpolate. Hulls that step less often get a proportionally longer
 * delay (see renderDelayMs) — otherwise the history runs out between steps.
 */
export const SHIP_RENDER_DELAY_MS = 120;
/** Render delay as a multiple of the measured sample interval. */
const DELAY_INTERVAL_FACTOR = 1.2;
const MAX_RENDER_DELAY_MS = 1500;
/** Weight of the newest measurement in the sample-interval estimate. */
const INTERVAL_EMA = 0.5;
/** How many samples to keep (enough to bracket the delay even at slow cadences). */
const MAX_SAMPLES = 6;
const SAMPLE_STRIDE = 3;
/** Follow filter time constant (ms): rounds path corners without adding lag. */
const FOLLOW_TAU_MS = 45;
/** Heading smoothing time constant (ms). */
const TURN_TAU_MS = 120;
/** Hard cap on turn rate: radians per millisecond (one full turn per 0.8 s). */
const MAX_TURN_RATE = (Math.PI * 2) / 800;
/** Ignore the direction sample below this per-frame travel (noise near rest). */
const HEADING_MIN_TRAVEL = 0.002;
/** Frame deltas above this are clamped (tab was hidden, debugger paused). */
const MAX_FRAME_DT_MS = 100;
/** Below this distance the display is considered parked on its target. */
const ARRIVE_EPSILON = 0.001;

export function headingByteToRadians(byte: number): number {
  return (byte / 256) * Math.PI * 2;
}

export function headingToByte(rad: number): number {
  const turns = rad / (Math.PI * 2);
  return Math.round((turns - Math.floor(turns)) * 256) & 255;
}

export function createShipDisplay(
  x: number,
  y: number,
  headingByte: number,
  nowMs: number,
): ShipDisplay {
  return {
    x,
    y,
    heading: headingByteToRadians(headingByte),
    tx: x,
    ty: y,
    samples: [nowMs, x, y],
    intervalMs: SHIP_RENDER_DELAY_MS / DELAY_INTERVAL_FACTOR,
  };
}

/**
 * Feed the newest simulation tile for this ship. Called once per tick with
 * the tick's arrival time; a changed tile appends a sample.
 */
export function retargetShip(
  d: ShipDisplay,
  tx: number,
  ty: number,
  nowMs: number,
): void {
  if (tx === d.tx && ty === d.ty) return;
  const hop = Math.hypot(tx - d.tx, ty - d.ty);
  d.tx = tx;
  d.ty = ty;
  if (hop > SHIP_SNAP_DISTANCE) {
    // Teleport (respawn, plan reset): forget the history and start over here.
    d.x = tx;
    d.y = ty;
    d.samples.length = 0;
  } else if (d.samples.length >= SAMPLE_STRIDE) {
    const prevTime = d.samples[d.samples.length - SAMPLE_STRIDE];
    const measured = Math.max(0, nowMs - prevTime);
    d.intervalMs += (measured - d.intervalMs) * INTERVAL_EMA;
  }
  d.samples.push(nowMs, tx, ty);
  if (d.samples.length > MAX_SAMPLES * SAMPLE_STRIDE) {
    d.samples.splice(0, d.samples.length - MAX_SAMPLES * SAMPLE_STRIDE);
  }
}

function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  a = ((a + Math.PI) % twoPi) - Math.PI;
  return a < -Math.PI ? a + twoPi : a;
}

/** How far behind the newest sample this ship is drawn. */
export function renderDelayMs(d: ShipDisplay): number {
  return Math.min(
    MAX_RENDER_DELAY_MS,
    Math.max(SHIP_RENDER_DELAY_MS, d.intervalMs * DELAY_INTERVAL_FACTOR),
  );
}

/** Position on the sample history at `t`, holding at either end. */
export function sampleShipPath(d: ShipDisplay, t: number): [number, number] {
  const s = d.samples;
  const n = s.length / SAMPLE_STRIDE;
  if (n === 0) return [d.tx, d.ty];
  if (t <= s[0]) return [s[1], s[2]];
  const lastOff = (n - 1) * SAMPLE_STRIDE;
  if (t >= s[lastOff]) return [s[lastOff + 1], s[lastOff + 2]];
  for (let i = 1; i < n; i++) {
    const off = i * SAMPLE_STRIDE;
    if (t <= s[off]) {
      const prev = off - SAMPLE_STRIDE;
      const span = s[off] - s[prev];
      const a = span <= 0 ? 1 : (t - s[prev]) / span;
      return [
        s[prev + 1] + (s[off + 1] - s[prev + 1]) * a,
        s[prev + 2] + (s[off + 2] - s[prev + 2]) * a,
      ];
    }
  }
  return [s[lastOff + 1], s[lastOff + 2]];
}

/**
 * Advance the display point to wall-clock `nowMs` (frame delta `dtMs`).
 * Returns true while the ship is still travelling.
 */
export function advanceShipDisplay(
  d: ShipDisplay,
  dtMs: number,
  nowMs: number,
): boolean {
  const dt = Math.min(MAX_FRAME_DT_MS, Math.max(0, dtMs));
  const [px, py] = sampleShipPath(d, nowMs - renderDelayMs(d));

  const dx = px - d.x;
  const dy = py - d.y;
  const dist = Math.hypot(dx, dy);
  if (dist > SHIP_SNAP_DISTANCE) {
    d.x = px;
    d.y = py;
    return false;
  }
  if (dist <= ARRIVE_EPSILON) {
    d.x = px;
    d.y = py;
    return false;
  }

  const k = 1 - Math.exp(-dt / FOLLOW_TAU_MS);
  const mx = dx * k;
  const my = dy * k;
  d.x += mx;
  d.y += my;

  const travel = Math.hypot(mx, my);
  if (travel > HEADING_MIN_TRAVEL) {
    const target = Math.atan2(mx, -my);
    const delta = wrapAngle(target - d.heading);
    const kt = 1 - Math.exp(-dt / TURN_TAU_MS);
    const maxTurn = MAX_TURN_RATE * dt;
    const turn = Math.max(-maxTurn, Math.min(maxTurn, delta * kt));
    d.heading = wrapAngle(d.heading + turn);
  }
  return true;
}
