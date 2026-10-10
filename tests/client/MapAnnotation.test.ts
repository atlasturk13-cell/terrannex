import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOVER_REST_MS,
  MapAnnotation,
} from "../../src/client/hud/layers/annotation/MapAnnotation";
import {
  ContextMenuEvent,
  MouseMoveEvent,
  MouseUpEvent,
  TouchEvent,
} from "../../src/client/InputHandler";
import type { TransformHandler } from "../../src/client/TransformHandler";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import { UnitType } from "../../src/core/game/Game";
import type { UserSettings } from "../../src/core/game/UserSettings";

const W = 100;
const ref = (x: number, y: number) => y * W + x;

function harness(options: { enabled?: boolean } = {}) {
  const owner = {
    isPlayer: () => true,
    smallID: () => 4,
    displayName: () => "Admiral Blue",
  };
  let shipActive = true;
  const ship = {
    id: () => 11,
    type: () => UnitType.Warship,
    tile: () => ref(40, 40),
    isActive: () => shipActive,
    aircraftState: () => ({}),
  };
  const game = {
    isValidCoord: (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < W,
    ref,
    owner: (tile: number) =>
      tile === ref(10, 10) || tile === ref(11, 10)
        ? owner
        : { isPlayer: () => false },
    isLand: (tile: number) => tile < ref(0, 90),
    isOcean: () => true,
    nearbyUnits: (tile: number, range: number) =>
      [ship]
        .map((u) => {
          const dx = (u.tile() % W) - (tile % W);
          const dy = Math.floor(u.tile() / W) - Math.floor(tile / W);
          return { unit: u, distSquared: dx * dx + dy * dy };
        })
        .filter(({ distSquared }) => distSquared <= range * range),
    unit: (id: number) => (id === 11 ? ship : undefined),
    playerBySmallID: () => undefined,
  };
  // Screen = world × 10.
  const transform = {
    screenToWorldCoordinatesFloat: (x: number, y: number) => ({
      x: x / 10,
      y: y / 10,
    }),
  };
  const eventBus = new EventBus();
  const element = new MapAnnotation();
  element.game = game as unknown as GameView;
  element.transform = transform as unknown as TransformHandler;
  element.eventBus = eventBus;
  element.userSettings = {
    mapAnnotations: () => options.enabled ?? true,
  } as unknown as UserSettings;
  document.body.append(element);
  element.init();
  let clock = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const move = async (x: number, y: number) => {
    clock += 50;
    eventBus.emit(new MouseMoveEvent(x, y));
    await element.updateComplete;
  };
  const rest = async () => {
    vi.advanceTimersByTime(HOVER_REST_MS);
    await element.updateComplete;
  };
  const chip = () =>
    element.querySelector<HTMLElement>(".map-annotation-label");
  return {
    element,
    eventBus,
    move,
    rest,
    chip,
    sinkShip: () => {
      shipActive = false;
    },
  };
}

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Map annotation label", () => {
  it("shows one small name after a short rest and follows the cursor over the same thing", async () => {
    expect(HOVER_REST_MS).toBeLessThan(500);
    const { move, rest, chip } = harness();
    await move(430, 410); // world (43, 41): 3.2 tiles from the ship
    expect(chip()).toBeNull();
    await rest();
    const label = chip();
    expect(label).not.toBeNull();
    expect(label?.dataset.annotationKind).toBe("unit");
    expect(label?.textContent?.trim()).toBe("unit_type.warship");
    expect(label?.textContent).not.toContain("Admiral Blue");
    expect(label?.className).toContain("text-[10px]");
    expect(label?.style.left).toBe("442px");
    expect(label?.style.top).toBe("426px");

    // Moving across the same ship keeps the chip and moves it, no new rest.
    await move(390, 400);
    expect(chip()?.textContent?.trim()).toBe("unit_type.warship");
    expect(chip()?.style.left).toBe("402px");
  });

  it("names empty owned land by its owner and open water by the terrain word", async () => {
    const { move, rest, chip } = harness();
    await move(100, 100); // owned plains at (10, 10)
    await rest();
    expect(chip()?.dataset.annotationKind).toBe("territory");
    expect(chip()?.textContent?.trim()).toBe("Admiral Blue");
    // Still that owner one tile over: no flicker.
    await move(110, 100);
    expect(chip()?.textContent?.trim()).toBe("Admiral Blue");
    // Something else hides the chip until the next rest.
    await move(950, 950);
    expect(chip()).toBeNull();
    await rest();
    expect(chip()?.dataset.annotationKind).toBe("terrain");
    expect(chip()?.textContent?.trim()).toBe("annotation.terrain.ocean");
  });

  it("never pins anything: clicks, taps and right-clicks add nothing", async () => {
    const { element, eventBus, move, rest, chip } = harness();
    await move(430, 410);
    await rest();
    eventBus.emit(new MouseUpEvent(430, 410));
    eventBus.emit(new ContextMenuEvent(430, 410));
    eventBus.emit(new TouchEvent(430, 410));
    await element.updateComplete;
    expect(element.querySelectorAll(".map-annotation-label")).toHaveLength(1);
    expect(element.querySelector(".map-annotation-card")).toBeNull();
    expect(element.querySelector("button")).toBeNull();
    expect(chip()?.textContent?.trim()).toBe("unit_type.warship");
  });

  it("ignores non-finite coordinates instead of throwing inside the event bus", async () => {
    const { move, rest, chip } = harness();
    await move(430, 410);
    await rest();
    expect(chip()).not.toBeNull();
    await expect(move(Number.NaN, 410)).resolves.toBeUndefined();
    expect(chip()).toBeNull();
    await expect(move(Number.POSITIVE_INFINITY, 0)).resolves.toBeUndefined();
    expect(chip()).toBeNull();
  });

  it("hides when the named unit disappears or the setting is off", async () => {
    const { element, move, rest, chip, sinkShip } = harness();
    await move(430, 410);
    await rest();
    expect(chip()).not.toBeNull();
    sinkShip();
    element.tick();
    await element.updateComplete;
    expect(chip()).toBeNull();

    const off = harness({ enabled: false });
    await off.move(430, 410);
    await off.rest();
    expect(off.chip()).toBeNull();
  });
});
