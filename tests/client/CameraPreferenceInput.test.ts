import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DragEvent as CameraDragEvent,
  InputHandler,
  ZoomEvent,
} from "../../src/client/InputHandler";
import type { UIState } from "../../src/client/UIState";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import { UserSettings } from "../../src/core/game/UserSettings";

function resetSettings() {
  localStorage.clear();
  const statics = UserSettings as unknown as {
    cache: Map<string, string | null>;
    playerId: string | null;
  };
  statics.cache.clear();
  statics.playerId = null;
}

describe("InputHandler camera preferences", () => {
  let input: InputHandler;
  let eventBus: EventBus;

  beforeEach(() => {
    vi.useFakeTimers();
    resetSettings();
    const settings = new UserSettings();
    settings.setCameraPanSensitivity(2);
    settings.setCameraZoomSensitivity(2);

    eventBus = new EventBus();
    input = new InputHandler(
      {
        inSpawnPhase: () => false,
        myPlayer: () => undefined,
      } as unknown as GameView,
      {
        attackRatio: 20,
        ghostStructure: null,
        rocketDirectionUp: true,
        upgradeMultiplier: 1,
      } as UIState,
      document.createElement("canvas"),
      eventBus,
    );
    input.initialize();
  });

  afterEach(() => {
    input.destroy();
    vi.useRealTimers();
  });

  it("scales keyboard pan and keyboard zoom", () => {
    const events: unknown[] = [];
    vi.spyOn(eventBus, "emit").mockImplementation((event) => {
      events.push(event);
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyE" }));
    vi.advanceTimersByTime(2);

    expect(events).toContainEqual(expect.objectContaining({ deltaY: 10 }));
    expect(
      events.some(
        (event) => event instanceof CameraDragEvent && event.deltaY === 10,
      ),
    ).toBe(true);
    expect(
      events.some((event) => event instanceof ZoomEvent && event.delta === -20),
    ).toBe(true);
  });

  it("scales wheel, WebKit gesture and two-pointer pinch zoom", () => {
    const zooms: ZoomEvent[] = [];
    vi.spyOn(eventBus, "emit").mockImplementation((event) => {
      if (event instanceof ZoomEvent) zooms.push(event);
    });

    input["onScroll"](new WheelEvent("wheel", { deltaY: 20 }) as WheelEvent);

    input["lastGestureScale"] = 1;
    input["onGestureChange"]({
      scale: 1.2,
      clientX: 100,
      clientY: 80,
    } as any);

    input["pointerDown"] = true;
    input["lastPinchDistance"] = 10;
    input["pointers"].set(1, {
      pointerId: 1,
      clientX: 0,
      clientY: 0,
    } as PointerEvent);
    input["onPointerMove"]({
      pointerId: 2,
      button: 0,
      clientX: 20,
      clientY: 0,
    } as PointerEvent);

    expect(zooms[0].delta).toBe(40);
    expect(zooms[1].delta).toBeCloseTo(600 * (1 / 1.2 - 1) * 2, 10);
    expect(zooms[2].delta).toBe(-40);
  });
});
