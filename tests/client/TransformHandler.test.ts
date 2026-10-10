import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CenterCameraEvent,
  DragEvent,
  ZoomEvent,
} from "../../src/client/InputHandler";
import {
  GOTO_INTERVAL_MS,
  TransformHandler,
} from "../../src/client/TransformHandler";
import type { GameView, PlayerView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import { Cell } from "../../src/core/game/Game";

const MAP_WIDTH = 2048;
const MAP_HEIGHT = 2048;

interface Harness {
  canvas: HTMLElement;
  eventBus: EventBus;
  handler: TransformHandler;
  rect: DOMRect;
}

function domRect(width: number, height: number, left = 0, top = 0): DOMRect {
  return {
    x: left,
    y: top,
    width,
    height,
    left,
    top,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

function createHarness(
  viewportWidth = 1280,
  viewportHeight = 720,
  playerNameLocation?: { x: number; y: number },
): Harness {
  const canvas = document.createElement("div");
  const rect = domRect(viewportWidth, viewportHeight, 37, 23);
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(rect);

  const player = {
    nameLocation: () =>
      playerNameLocation === undefined
        ? undefined
        : { ...playerNameLocation, size: 1 },
  } as unknown as PlayerView;
  const game = {
    width: () => MAP_WIDTH,
    height: () => MAP_HEIGHT,
    myPlayer: () =>
      playerNameLocation === undefined ? null : (player as PlayerView),
  } as unknown as GameView;
  const eventBus = new EventBus();
  const handler = new TransformHandler(game, eventBus, canvas);
  return { canvas, eventBus, handler, rect };
}

function expectFiniteTransform(handler: TransformHandler): void {
  expect(Number.isFinite(handler.scale)).toBe(true);
  expect(Number.isFinite(handler.offsetX)).toBe(true);
  expect(Number.isFinite(handler.offsetY)).toBe(true);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("TransformHandler production camera contract", () => {
  it("keeps the world point under an off-center cursor fixed while zooming", () => {
    const { eventBus, handler, rect } = createHarness();
    handler.override(123.25, -87.75, 1.8);
    const cursor = { x: rect.left + 996.25, y: rect.top + 603.5 };
    const before = handler.screenToWorldCoordinatesFloat(cursor.x, cursor.y);

    eventBus.emit(new ZoomEvent(cursor.x, cursor.y, -240));

    const after = handler.screenToWorldCoordinatesFloat(cursor.x, cursor.y);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1e-9);
    expectFiniteTransform(handler);
  });

  it("clamps extreme zoom input exactly and keeps the transform finite", () => {
    const { eventBus, handler, rect } = createHarness();
    const cursorX = rect.left + 731;
    const cursorY = rect.top + 419;

    handler.override(0, 0, 1.8);
    eventBus.emit(new ZoomEvent(cursorX, cursorY, Number.MAX_VALUE));
    expect(handler.scale).toBe(0.2);
    expectFiniteTransform(handler);

    handler.override(0, 0, 1.8);
    eventBus.emit(new ZoomEvent(cursorX, cursorY, -600));
    expect(handler.scale).toBe(20);
    expectFiniteTransform(handler);
  });

  it("clamps repeated large pans to the bounds derived from map and viewport", () => {
    const { eventBus, handler, rect } = createHarness();
    const scale = 1.7;
    handler.override(0, 0, scale);
    const minX =
      -MAP_WIDTH / 2 + (MAP_WIDTH - rect.width) / (2 * handler.scale);
    const maxX = MAP_WIDTH / 2 + (MAP_WIDTH - rect.width) / (2 * handler.scale);
    const minY =
      -MAP_HEIGHT / 2 + (MAP_HEIGHT - rect.height) / (2 * handler.scale);
    const maxY =
      MAP_HEIGHT / 2 + (MAP_HEIGHT - rect.height) / (2 * handler.scale);

    for (let i = 0; i < 100; i++) {
      eventBus.emit(new DragEvent(1_000_000, 1_000_000));
    }
    expect(handler.offsetX).toBe(minX);
    expect(handler.offsetY).toBe(minY);

    for (let i = 0; i < 100; i++) {
      eventBus.emit(new DragEvent(-1_000_000, -1_000_000));
    }
    expect(handler.offsetX).toBe(maxX);
    expect(handler.offsetY).toBe(maxY);
    expect(handler.offsetX).toBeGreaterThanOrEqual(minX);
    expect(handler.offsetX).toBeLessThanOrEqual(maxX);
    expect(handler.offsetY).toBeGreaterThanOrEqual(minY);
    expect(handler.offsetY).toBeLessThanOrEqual(maxY);
    expectFiniteTransform(handler);
  });

  it.each([
    [1280, 720],
    [390, 844],
  ])(
    "centerAll(0.9) keeps the whole map visible at %ix%i",
    (viewportWidth, viewportHeight) => {
      const { handler, rect } = createHarness(viewportWidth, viewportHeight);

      handler.centerAll(0.9);

      const topLeft = handler.worldToScreenCoordinates(new Cell(0, 0));
      const bottomRight = handler.worldToScreenCoordinates(
        new Cell(MAP_WIDTH, MAP_HEIGHT),
      );
      expect(topLeft.x).toBeGreaterThanOrEqual(rect.left);
      expect(topLeft.y).toBeGreaterThanOrEqual(rect.top);
      expect(bottomRight.x).toBeLessThanOrEqual(rect.right);
      expect(bottomRight.y).toBeLessThanOrEqual(rect.bottom);
      expect(bottomRight.x).toBeGreaterThan(topLeft.x);
      expect(bottomRight.y).toBeGreaterThan(topLeft.y);
      expectFiniteTransform(handler);
    },
  );

  it("centers once on the player name and stops its interval", () => {
    vi.useFakeTimers();
    const playerName = { x: 1510, y: 690 };
    const { eventBus, handler } = createHarness(1280, 720, playerName);

    eventBus.emit(new CenterCameraEvent());
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(GOTO_INTERVAL_MS * 600);

    const center = handler.screenCenter();
    expect(
      Math.hypot(center.screenX - playerName.x, center.screenY - playerName.y),
    ).toBeLessThan(2);
    expect(vi.getTimerCount()).toBe(0);
    expectFiniteTransform(handler);
  });
});
