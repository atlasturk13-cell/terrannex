import { describe, expect, it } from "vitest";
import {
  advanceShipDisplay,
  createShipDisplay,
  headingByteToRadians,
  headingToByte,
  retargetShip,
  sampleShipPath,
  SHIP_RENDER_DELAY_MS,
  SHIP_SNAP_DISTANCE,
} from "../../../src/client/render/gl/passes/ShipMotion";

const TICK_MS = 100;
const FRAME_MS = 10;

/** Drive a ship along +x one tile per `stepTicks` ticks for `ticks` ticks. */
function drive(
  stepTicks: number,
  ticks: number,
  onFrame?: (t: number, x: number, y: number) => void,
  jitter: (tick: number) => number = () => 0,
) {
  const d = createShipDisplay(0, 0, 0, 0);
  let nextTick = 1;
  const end = ticks * TICK_MS + SHIP_RENDER_DELAY_MS + 400;
  for (let t = FRAME_MS; t <= end; t += FRAME_MS) {
    while (nextTick <= ticks && t >= nextTick * TICK_MS + jitter(nextTick)) {
      if (nextTick % stepTicks === 0) {
        retargetShip(d, nextTick / stepTicks, 0, t);
      }
      nextTick++;
    }
    advanceShipDisplay(d, FRAME_MS, t);
    onFrame?.(t, d.x, d.y);
  }
  return d;
}

describe("ShipMotion", () => {
  it("round-trips heading bytes", () => {
    for (const byte of [0, 1, 64, 128, 200, 255]) {
      expect(headingToByte(headingByteToRadians(byte))).toBe(byte);
    }
  });

  it("stays put and keeps its heading while the target does not move", () => {
    const d = createShipDisplay(10, 10, 64, 0);
    expect(advanceShipDisplay(d, 16, 500)).toBe(false);
    expect(d.x).toBe(10);
    expect(d.y).toBe(10);
    expect(d.heading).toBeCloseTo(headingByteToRadians(64));
  });

  it("interpolates the sample history linearly and holds at both ends", () => {
    const d = createShipDisplay(0, 0, 0, 0);
    retargetShip(d, 1, 0, 100);
    retargetShip(d, 1, 1, 200);
    expect(sampleShipPath(d, -50)).toEqual([0, 0]);
    expect(sampleShipPath(d, 50)).toEqual([0.5, 0]);
    expect(sampleShipPath(d, 150)).toEqual([1, 0.5]);
    expect(sampleShipPath(d, 999)).toEqual([1, 1]);
  });

  it("moves at a steady speed while the target advances one tile per tick", () => {
    const speeds: number[] = [];
    let lastX = 0;
    const d = drive(1, 30, (t, x) => {
      if (t > 600 && t <= 2500) speeds.push(x - lastX);
      lastX = x;
    });
    const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    // One tile per 100 ms → 0.1 tiles per 10 ms frame.
    expect(mean).toBeCloseTo(0.1, 2);
    for (const s of speeds) expect(Math.abs(s - mean)).toBeLessThan(0.005);
    // Eventually settles exactly on the final tile.
    expect(d.x).toBeCloseTo(30, 3);
  });

  it("glides continuously for hulls that step once every three ticks", () => {
    const speeds: number[] = [];
    let lastX = 0;
    drive(3, 30, (t, x) => {
      if (t > 900 && t <= 2500) speeds.push(x - lastX);
      lastX = x;
    });
    const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    expect(mean).toBeCloseTo(0.1 / 3, 2);
    // No stop-and-go: never stationary mid-route, never faster than 2x cruise.
    for (const s of speeds) {
      expect(s).toBeGreaterThan(mean * 0.5);
      expect(s).toBeLessThan(mean * 1.5);
    }
  });

  it("absorbs tick jitter without stalling or hopping", () => {
    const speeds: number[] = [];
    let lastX = 0;
    // Alternate ticks arrive 40 ms late / on time.
    drive(
      1,
      30,
      (t, x) => {
        if (t > 600 && t <= 2500) speeds.push(x - lastX);
        lastX = x;
      },
      (tick) => (tick % 2 === 0 ? 40 : 0),
    );
    for (const s of speeds) {
      expect(s).toBeGreaterThan(0.02);
      expect(s).toBeLessThan(0.2);
    }
  });

  it("turns the bow gradually instead of snapping on a zig-zag grid path", () => {
    const d = createShipDisplay(0, 0, 0, 0);
    // North for a while, then a 90° turn to the east.
    retargetShip(d, 0, -1, 100);
    retargetShip(d, 0, -2, 200);
    retargetShip(d, 1, -2, 300);
    retargetShip(d, 2, -2, 400);
    retargetShip(d, 3, -2, 500);
    const headings: number[] = [];
    for (let t = FRAME_MS; t <= 900; t += FRAME_MS) {
      advanceShipDisplay(d, FRAME_MS, t);
      headings.push(d.heading);
    }
    let prev = 0;
    for (const h of headings) {
      expect(Math.abs(h - prev)).toBeLessThan(Math.PI / 8);
      prev = h;
    }
    // Ends up pointing east (π/2 clockwise from north).
    expect(headings[headings.length - 1]).toBeCloseTo(Math.PI / 2, 1);
  });

  it("snaps instead of gliding across a teleport", () => {
    const d = createShipDisplay(0, 0, 0, 0);
    retargetShip(d, SHIP_SNAP_DISTANCE + 20, 0, TICK_MS);
    expect(d.x).toBe(SHIP_SNAP_DISTANCE + 20);
    advanceShipDisplay(d, FRAME_MS, TICK_MS + FRAME_MS);
    expect(d.x).toBe(SHIP_SNAP_DISTANCE + 20);
  });

  it("clamps huge frame deltas so a hidden tab does not fling the ship", () => {
    const d = createShipDisplay(0, 0, 0, 0);
    retargetShip(d, 3, 0, TICK_MS);
    advanceShipDisplay(d, 60_000, 60_000);
    // Follows toward the (held) final sample but only one clamped frame's worth.
    expect(d.x).toBeGreaterThan(0);
    expect(d.x).toBeLessThan(3);
  });
});
