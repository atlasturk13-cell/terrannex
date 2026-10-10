import { afterEach, describe, expect, test, vi } from "vitest";
import {
  alignClusterOrder,
  AttackingTroopsController,
  Slot,
} from "../../../../src/client/controllers/AttackingTroopsController";
import { AlternateViewEvent } from "../../../../src/client/InputHandler";
import { EventBus } from "../../../../src/core/EventBus";
import { Cell, PlayerType } from "../../../../src/core/game/Game";

// Slots only need the `dst` fields populated for `alignClusterOrder` — it
// compares the new positions against the previous targets to decide whether
// the worker reordered same-size clusters.
const slot = (x: number, y: number): Slot => ({
  curX: x,
  curY: y,
  srcX: x,
  srcY: y,
  dstX: x,
  dstY: y,
  startMs: 0,
});

describe("alignClusterOrder", () => {
  const c = (x: number, y: number) => new Cell(x, y);

  test("preserves order when direct mapping is closer", () => {
    const next = [c(10, 10), c(100, 100)];
    const prev = [slot(12, 11), slot(98, 102)];
    alignClusterOrder(next, prev);
    expect(next[0].x).toBe(10);
    expect(next[1].x).toBe(100);
  });

  test("swaps when the worker reordered same-size clusters", () => {
    // prev[0] is near (10,10), prev[1] is near (100,100); the worker returned
    // them in the opposite order. Expect swap so each label sticks to its front.
    const next = [c(101, 99), c(11, 12)];
    const prev = [slot(10, 10), slot(100, 100)];
    alignClusterOrder(next, prev);
    expect(next[0].x).toBe(11);
    expect(next[1].x).toBe(101);
  });

  test("does not swap on a tie (strict less-than)", () => {
    const next = [c(0, 0), c(10, 0)];
    const prev = [slot(5, 0), slot(5, 0)];
    alignClusterOrder(next, prev);
    expect(next[0].x).toBe(0);
    expect(next[1].x).toBe(10);
  });

  test("no-op when fewer than two new positions", () => {
    const single = [c(99, 99)];
    alignClusterOrder(single, [slot(0, 0), slot(1000, 1000)]);
    expect(single[0].x).toBe(99);

    const empty: Cell[] = [];
    alignClusterOrder(empty, [slot(0, 0), slot(1000, 1000)]);
    expect(empty.length).toBe(0);
  });

  test("no-op when fewer than two previous slots (initial render)", () => {
    const next = [c(100, 100), c(0, 0)];
    alignClusterOrder(next, [slot(0, 0)]);
    expect(next[0].x).toBe(100);
    expect(next[1].x).toBe(0);

    alignClusterOrder(next, []);
    expect(next[0].x).toBe(100);
    expect(next[1].x).toBe(0);
  });

  test("no-op when more than two new positions (assumed cap)", () => {
    const next = [c(100, 0), c(0, 0), c(50, 0)];
    alignClusterOrder(next, [slot(0, 0), slot(100, 0)]);
    expect(next.map((p) => p.x)).toEqual([100, 0, 50]);
  });
});

describe("AttackingTroopsController", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("renders wilderness and incoming tribe fronts and clears every hidden state", async () => {
    let overlayEnabled = true;
    let outgoing = [
      {
        attackerID: 1,
        targetID: 0,
        troops: 123_450,
        id: "wilderness-front",
        retreating: false,
      },
    ];
    let incoming = [
      {
        attackerID: 2,
        targetID: 1,
        troops: 98_760,
        id: "tribe-front",
        retreating: false,
      },
    ];
    const clusteredPositions = vi.fn().mockResolvedValue([
      {
        id: "wilderness-front",
        positions: [new Cell(10, 20), new Cell(30, 40)],
      },
      { id: "tribe-front", positions: [new Cell(50, 60)] },
    ]);
    const myPlayer = {
      outgoingAttacks: () => outgoing,
      incomingAttacks: () => incoming,
      attackClusteredPositions: clusteredPositions,
    };
    const game = {
      myPlayer: () => myPlayer,
      playerBySmallID: (id: number) => {
        if (id === 0) return { isPlayer: () => false };
        return {
          isPlayer: () => true,
          type: () => (id === 2 ? PlayerType.Bot : PlayerType.Human),
        };
      },
    };
    const eventBus = new EventBus();
    const userSettings = {
      attackingTroopsOverlay: () => overlayEnabled,
    };
    const view = { setAttackTroopLabels: vi.fn() };
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frame = callback;
        return 1;
      }),
    );
    vi.spyOn(performance, "now").mockReturnValue(1_000);

    const controller = new AttackingTroopsController(
      game as never,
      eventBus,
      userSettings as never,
      view as never,
    );
    controller.init();
    const renderFrame = () => {
      const callback = frame;
      expect(callback).toBeDefined();
      callback!(1_000);
    };
    const settlePositions = async () => {
      await Promise.resolve();
      await Promise.resolve();
    };

    controller.tick();
    await settlePositions();
    renderFrame();

    expect(view.setAttackTroopLabels).toHaveBeenLastCalledWith([
      {
        x: 10,
        y: 20,
        text: "12.3K",
        colorR: 0x3f / 255,
        colorG: 0xa9 / 255,
        colorB: 0xf5 / 255,
      },
      {
        x: 30,
        y: 40,
        text: "12.3K",
        colorR: 0x3f / 255,
        colorG: 0xa9 / 255,
        colorB: 0xf5 / 255,
      },
      {
        x: 50,
        y: 60,
        text: "9.87K",
        colorR: 0xf8 / 255,
        colorG: 0x71 / 255,
        colorB: 0x71 / 255,
      },
    ]);

    // An ended attack must remove its old WebGL labels on the next frame.
    outgoing = [];
    incoming = [];
    controller.tick();
    await settlePositions();
    renderFrame();
    expect(view.setAttackTroopLabels).toHaveBeenLastCalledWith([]);

    // Disabling the overlay clears already-rendered labels without polling.
    outgoing = [
      {
        attackerID: 1,
        targetID: 0,
        troops: 123_450,
        id: "wilderness-front",
        retreating: false,
      },
    ];
    controller.tick();
    await settlePositions();
    renderFrame();
    overlayEnabled = false;
    controller.tick();
    renderFrame();
    expect(view.setAttackTroopLabels).toHaveBeenLastCalledWith([]);

    // Alternate view uses the same immediate cleanup path and does not poll.
    overlayEnabled = true;
    controller.tick();
    await settlePositions();
    renderFrame();
    const requestsBeforeHiddenTicks = clusteredPositions.mock.calls.length;
    eventBus.emit(new AlternateViewEvent(true));
    controller.tick();
    renderFrame();
    expect(view.setAttackTroopLabels).toHaveBeenLastCalledWith([]);
    expect(clusteredPositions).toHaveBeenCalledTimes(requestsBeforeHiddenTicks);
  });

  test("caps its scheduled worker request rate at five polls per second", () => {
    const pending = new Promise<never>(() => {});
    const clusteredPositions = vi.fn(() => pending);
    const myPlayer = {
      outgoingAttacks: () => [],
      incomingAttacks: () => [],
      attackClusteredPositions: clusteredPositions,
    };
    const controller = new AttackingTroopsController(
      {
        myPlayer: () => myPlayer,
        playerBySmallID: vi.fn(),
      } as never,
      new EventBus(),
      { attackingTroopsOverlay: () => true } as never,
      { setAttackTroopLabels: vi.fn() } as never,
    );

    expect(controller.getTickIntervalMs()).toBe(200);
    expect(1_000 / controller.getTickIntervalMs()).toBe(5);
    for (let i = 0; i < 10; i++) controller.tick();
    expect(clusteredPositions).toHaveBeenCalledTimes(1);
  });
});
