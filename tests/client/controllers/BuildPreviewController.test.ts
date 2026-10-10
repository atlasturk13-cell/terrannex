import { describe, expect, test, vi } from "vitest";
import type { LobbyConfig } from "../../../src/client/ClientGameRunner";
import {
  AuthoritativeStructurePlacementOutcomeEvent,
  type CommandQuantityRequest,
  maxFreshConstructionAmount,
  RequestCommandQuantityEvent,
  RequestStructurePlacementEvent,
} from "../../../src/client/CommandQuantity";
import {
  BuildPreviewController,
  resolvedBuildMultiplier,
  samThreatensNukePreview,
  shouldPreserveGhostAfterBuild,
} from "../../../src/client/controllers/BuildPreviewController";
import { BuildMenu } from "../../../src/client/hud/layers/BuildMenu";
import {
  InputHandler,
  MouseMoveEvent,
  MouseUpEvent,
} from "../../../src/client/InputHandler";
import { ghostCommandTopText } from "../../../src/client/render/GhostCommandLabel";
import {
  BuildUnitIntentEvent,
  SendUpgradeStructureIntentEvent,
  Transport,
} from "../../../src/client/Transport";
import {
  beginRocketTargetSelectionRequest,
  beginStructurePlacementRequest,
  startStructurePlacementQueue,
  structurePlacementRevision,
  type UIState,
} from "../../../src/client/UIState";
import type { GameView } from "../../../src/client/view";
import { EventBus } from "../../../src/core/EventBus";
import {
  AirDefenseSystem,
  BuildableUnit,
  UnitType,
} from "../../../src/core/game/Game";

function quantityController(buildableUnit: BuildableUnit) {
  const eventBus = new EventBus();
  const player = {
    gold: () => 1_000n,
    readyMissileCount: () => 2,
    smallID: () => 1,
  };
  const game = {
    config: () => ({
      airDefenseRadius: () => 20,
      depthProgressionEnabled: () => true,
      trainStationMaxRange: () => 30,
    }),
    height: () => 100,
    isImpassable: () => false,
    isValidCoord: () => true,
    myPlayer: () => player,
    ref: () => 42,
    x: () => 1,
    y: () => 2,
  } as unknown as GameView;
  const uiState = {
    ghostStructure: buildableUnit.type,
    rocketDirectionUp: false,
    upgradeMultiplier: 5,
  } as UIState;
  const view = {
    updateGhostPreview: vi.fn(),
    updateNukeTrajectory: vi.fn(),
  };
  const controller = new BuildPreviewController(
    game,
    eventBus,
    uiState,
    { screenToWorldCoordinates: () => ({ x: 1, y: 2 }) } as never,
    view as never,
    {
      cursorCostLabel: () => true,
      nukeAllianceSafetyDuration: () => 0,
    } as never,
  );
  Object.assign(controller, { ghostUnit: { buildableUnit } });
  let quantityRequest: CommandQuantityRequest | null = null;
  const quantityEvents = vi.fn();
  eventBus.on(RequestCommandQuantityEvent, (event) => {
    quantityRequest = event.request;
    quantityEvents(event);
  });
  const buildIntent = vi.fn();
  const upgradeIntent = vi.fn();
  eventBus.on(BuildUnitIntentEvent, buildIntent);
  eventBus.on(SendUpgradeStructureIntentEvent, upgradeIntent);

  const confirmGhost = () =>
    (
      controller as unknown as { createStructure(event: MouseUpEvent): void }
    ).createStructure(new MouseUpEvent(10, 20));
  confirmGhost();
  return {
    buildIntent,
    confirmGhost,
    controller,
    quantityEvents,
    quantityRequest: () => quantityRequest,
    uiState,
    upgradeIntent,
  };
}

function queuedPlacementController(initialBuildable: BuildableUnit) {
  const eventBus = new EventBus();
  let buildableUnit = initialBuildable;
  let currentTick = 100;
  let units: Array<{ id(): number; tile(): number }> = [];
  let deferredBuildables:
    | {
        promise: Promise<BuildableUnit[]>;
        resolve: (value: BuildableUnit[]) => void;
      }
    | undefined;
  const buildables = vi.fn(() => {
    if (deferredBuildables !== undefined) {
      const pending = deferredBuildables.promise;
      deferredBuildables = undefined;
      return pending;
    }
    return Promise.resolve([buildableUnit]);
  });
  const player = {
    buildables,
    gold: () => 2_000_000n,
    readyMissileCount: () => 50,
    smallID: () => 1,
    units: () => units,
  };
  const game = {
    config: () => ({
      airDefenseRadius: () => 20,
      depthProgressionEnabled: () => true,
      trainStationMaxRange: () => 30,
    }),
    height: () => 100,
    isImpassable: () => false,
    isValidCoord: () => true,
    myPlayer: () => player,
    ref: (x: number, y: number) => x * 100 + y,
    ticks: () => currentTick,
    x: (tile: number) => Math.floor(tile / 100),
    y: (tile: number) => tile % 100,
  } as unknown as GameView;
  const uiState = {
    attackRatio: 20,
    ghostStructure: initialBuildable.type,
    rocketDirectionUp: true,
    upgradeMultiplier: 1,
  } as UIState;
  const view = {
    triggerBlockedFlash: vi.fn(),
    updateGhostPreview: vi.fn(),
    updateNukeTrajectory: vi.fn(),
  };
  const controller = new BuildPreviewController(
    game,
    eventBus,
    uiState,
    {
      screenToWorldCoordinates: (x: number, y: number) => ({ x, y }),
      screenToWorldCoordinatesFloat: (x: number, y: number) => ({ x, y }),
    } as never,
    view as never,
    {
      cursorCostLabel: () => true,
      nukeAllianceSafetyDuration: () => 0,
    } as never,
  );
  let cursorFrame: FrameRequestCallback | undefined;
  const animationFrame = vi
    .spyOn(globalThis, "requestAnimationFrame")
    .mockImplementation((callback) => {
      cursorFrame ??= callback;
      return 0;
    });
  controller.init();
  animationFrame.mockRestore();
  (controller as unknown as { syncGhostState(): void }).syncGhostState();

  let quantityRequest: CommandQuantityRequest | null = null;
  eventBus.on(RequestCommandQuantityEvent, (event) => {
    quantityRequest = event.request;
  });
  const buildIntent = vi.fn();
  eventBus.on(BuildUnitIntentEvent, buildIntent);

  return {
    buildIntent,
    buildables,
    click: (x: number, y: number) => eventBus.emit(new MouseUpEvent(x, y)),
    controller,
    deferNextBuildables: () => {
      let resolve!: (value: BuildableUnit[]) => void;
      const promise = new Promise<BuildableUnit[]>((done) => {
        resolve = done;
      });
      deferredBuildables = { promise, resolve };
      return { resolve };
    },
    eventBus,
    move: (x: number, y: number) => eventBus.emit(new MouseMoveEvent(x, y)),
    quantityRequest: () => quantityRequest,
    emitOutcome: (
      tag: { generation: number; requestId: number },
      outcome: "accepted" | "rejected",
      spawnTile?: number,
    ) =>
      eventBus.emit(
        new AuthoritativeStructurePlacementOutcomeEvent(
          tag,
          outcome,
          spawnTile,
        ),
      ),
    setBuildable: (next: BuildableUnit) => {
      buildableUnit = next;
      const ghostUnit = (
        controller as unknown as {
          ghostUnit: { buildableUnit: BuildableUnit } | null;
        }
      ).ghostUnit;
      if (ghostUnit !== null) ghostUnit.buildableUnit = next;
    },
    setTick: (tick: number) => {
      currentTick = tick;
    },
    setUnits: (next: Array<{ id(): number; tile(): number }>) => {
      units = next;
    },
    tick: () => controller.tick(),
    uiState,
    view,
    runCursorFrame: () => {
      const schedule = vi
        .spyOn(globalThis, "requestAnimationFrame")
        .mockReturnValue(0);
      try {
        cursorFrame?.(performance.now());
      } finally {
        schedule.mockRestore();
      }
    },
  };
}

async function flushAsyncPlacement(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("BuildPreviewController ghost preservation (locked nuke / Enter confirm)", () => {
  test("shows the remaining rocket-target count above the ghost", () => {
    expect(
      ghostCommandTopText({ remainingTargetSelections: 2 } as never),
    ).toMatch(/2 rocket targets left|rocket_targets_left/);
  });

  describe("shouldPreserveGhostAfterBuild", () => {
    test("returns true for AtomBomb so ghost is not cleared after placement", () => {
      expect(shouldPreserveGhostAfterBuild(UnitType.AtomBomb)).toBe(true);
    });

    test("returns true for HydrogenBomb so ghost is not cleared after placement", () => {
      expect(shouldPreserveGhostAfterBuild(UnitType.HydrogenBomb)).toBe(true);
    });

    test("returns false for City so ghost is cleared after placement", () => {
      expect(shouldPreserveGhostAfterBuild(UnitType.City)).toBe(false);
    });

    test("returns false for Factory so ghost is cleared after placement", () => {
      expect(shouldPreserveGhostAfterBuild(UnitType.Factory)).toBe(false);
    });

    test("returns false for other buildable types (Port, DefensePost, MissileSilo, SAMLauncher, Warship, MIRV)", () => {
      expect(shouldPreserveGhostAfterBuild(UnitType.Port)).toBe(false);
      expect(shouldPreserveGhostAfterBuild(UnitType.DefensePost)).toBe(false);
      expect(shouldPreserveGhostAfterBuild(UnitType.MissileSilo)).toBe(false);
      expect(shouldPreserveGhostAfterBuild(UnitType.SAMLauncher)).toBe(false);
      expect(shouldPreserveGhostAfterBuild(UnitType.Warship)).toBe(false);
      expect(shouldPreserveGhostAfterBuild(UnitType.MIRV)).toBe(false);
    });
  });
});

describe("resolvedBuildMultiplier (depth exact-next-level UI)", () => {
  test.each([
    UnitType.Port,
    UnitType.City,
    UnitType.Factory,
    UnitType.MissileSilo,
    UnitType.SAMLauncher,
  ])("forces admitted %s structure upgrades to x1", (type) => {
    expect(resolvedBuildMultiplier(true, type, true, 5)).toBe(1);
  });

  test("preserves legacy structure and depth AtomBomb bulk multipliers", () => {
    expect(resolvedBuildMultiplier(false, UnitType.City, true, 5)).toBe(5);
    expect(resolvedBuildMultiplier(true, UnitType.AtomBomb, false, 5)).toBe(5);
  });
});

describe("BuildPreviewController quantity confirmation", () => {
  test("opening a rocket target chooser cancels an older structure queue", () => {
    const uiState = {
      ghostStructure: UnitType.City,
      rocketDirectionUp: false,
      upgradeMultiplier: 1,
    } as UIState;
    const structureRevision = beginStructurePlacementRequest(uiState);
    expect(
      startStructurePlacementQueue(
        uiState,
        UnitType.City,
        3,
        structureRevision,
      ),
    ).not.toBe(false);
    expect(uiState.structurePlacementQueue).toBeDefined();

    beginRocketTargetSelectionRequest(uiState);

    expect(uiState.structurePlacementQueue).toBeUndefined();
    expect(uiState.rocketTargetSelectionQueue).toBeUndefined();
  });

  test("uses exact cumulative fresh-build prices and fails closed without them", () => {
    const city = {
      canBuild: 42,
      canUpgrade: false,
      cost: 125_000n,
      freshBuildCosts: [125_000n, 375_000n, 875_000n],
      ghostRailPaths: [],
      overlappingRailroads: [],
      type: UnitType.City,
    } satisfies BuildableUnit;
    expect(maxFreshConstructionAmount(city, 375_000n, 3)).toBe(2);
    expect(maxFreshConstructionAmount(city, 875_000n, 3)).toBe(3);
    expect(
      maxFreshConstructionAmount(
        { ...city, freshBuildCosts: undefined },
        875_000n,
        3,
      ),
    ).toBe(1);
  });

  test("shows and sends the resolved structure tile, not the raw cursor tile", async () => {
    const result = queuedPlacementController({
      canBuild: 3530,
      canUpgrade: false,
      cost: 125_000n,
      freshBuildCosts: [125_000n, 375_000n, 875_000n],
      ghostRailPaths: [],
      overlappingRailroads: [],
      type: UnitType.City,
    });
    result.move(30, 30);
    Object.assign(result.controller, { lastGhostQueryAt: -Infinity });

    result.controller.renderGhost();
    await flushAsyncPlacement();
    result.runCursorFrame();

    expect(result.view.updateGhostPreview).toHaveBeenLastCalledWith(
      expect.objectContaining({
        radiusTileX: 35,
        radiusTileY: 30,
        tileX: 35,
        tileY: 30,
      }),
    );

    result.click(30, 30);
    await flushAsyncPlacement();
    result.quantityRequest()!.onConfirm(3);
    await flushAsyncPlacement();

    expect(result.buildIntent).toHaveBeenCalledOnce();
    expect(result.buildIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1,
        rocketDirectionUp: false,
        tile: 3530,
        unit: UnitType.City,
      }),
    );
  });

  test("serializes public x3 clicks and decrements only after observed units", async () => {
    const result = queuedPlacementController({
      canBuild: 42,
      canUpgrade: false,
      cost: 125_000n,
      freshBuildCosts: [125_000n, 375_000n, 875_000n],
      ghostRailPaths: [],
      overlappingRailroads: [],
      type: UnitType.City,
    });

    result.click(1, 2);
    await flushAsyncPlacement();
    expect(result.quantityRequest()).toEqual(
      expect.objectContaining({
        kind: "construction",
        max: 3,
        separatePlacement: true,
        totalCost: undefined,
      }),
    );
    result.quantityRequest()!.onConfirm(3);
    await flushAsyncPlacement();

    expect(result.buildIntent).toHaveBeenCalledOnce();
    expect(result.buildIntent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        amount: 1,
        rocketDirectionUp: false,
        tile: 42,
        unit: UnitType.City,
      }),
    );
    expect(result.uiState.structurePlacementQueue).toMatchObject({
      confirmedTiles: [],
      remaining: 3,
      unitType: UnitType.City,
      pending: { stage: "awaiting_acceptance", spawnTile: 42 },
    });

    // A second click cannot validate or emit while the first x1 is pending.
    result.click(3, 4);
    await flushAsyncPlacement();
    expect(result.buildIntent).toHaveBeenCalledOnce();
    expect(result.uiState.structurePlacementQueue?.remaining).toBe(3);

    result.emitOutcome(
      (result.buildIntent.mock.calls[0][0] as BuildUnitIntentEvent)
        .structurePlacementTag!,
      "accepted",
      142,
    );
    result.tick();
    expect(result.uiState.structurePlacementQueue).toMatchObject({
      confirmedTiles: [142],
      remaining: 2,
      pending: undefined,
    });

    result.setBuildable({
      canBuild: 43,
      canUpgrade: false,
      cost: 250_000n,
      freshBuildCosts: [250_000n, 750_000n, 1_750_000n],
      ghostRailPaths: [],
      overlappingRailroads: [],
      type: UnitType.City,
    });
    result.click(3, 4);
    await flushAsyncPlacement();
    expect(result.buildIntent).toHaveBeenCalledTimes(2);
    expect(result.uiState.structurePlacementQueue?.remaining).toBe(2);
    result.emitOutcome(
      (result.buildIntent.mock.calls[1][0] as BuildUnitIntentEvent)
        .structurePlacementTag!,
      "accepted",
    );
    result.tick();
    expect(result.uiState.structurePlacementQueue?.remaining).toBe(1);

    result.setBuildable({
      canBuild: 44,
      canUpgrade: false,
      cost: 500_000n,
      freshBuildCosts: [500_000n, 1_500_000n, 2_500_000n],
      ghostRailPaths: [],
      overlappingRailroads: [],
      type: UnitType.City,
    });
    result.click(5, 6);
    await flushAsyncPlacement();
    expect(result.buildIntent).toHaveBeenCalledTimes(3);
    result.emitOutcome(
      (result.buildIntent.mock.calls[2][0] as BuildUnitIntentEvent)
        .structurePlacementTag!,
      "accepted",
    );
    result.tick();
    expect(result.uiState.structurePlacementQueue).toBeUndefined();
    expect(result.uiState.ghostStructure).toBeNull();
  });

  test("fresh revalidation rejects stale modal state without consuming x3", async () => {
    const result = queuedPlacementController({
      canBuild: 42,
      canUpgrade: false,
      cost: 125_000n,
      freshBuildCosts: [125_000n, 375_000n, 875_000n],
      ghostRailPaths: [],
      overlappingRailroads: [],
      type: UnitType.City,
    });
    result.click(1, 2);
    await flushAsyncPlacement();
    const chooser = result.quantityRequest()!;
    result.setBuildable({
      canBuild: false,
      canUpgrade: false,
      cost: 250_000n,
      freshBuildCosts: [250_000n, 750_000n, 1_750_000n],
      ghostRailPaths: [],
      overlappingRailroads: [],
      type: UnitType.City,
    });

    chooser.onConfirm(3);
    await flushAsyncPlacement();
    expect(result.buildIntent).not.toHaveBeenCalled();
    expect(result.uiState.structurePlacementQueue).toMatchObject({
      confirmedTiles: [],
      pending: undefined,
      remaining: 3,
    });
  });

  test("canceled validation cannot emit or consume a newer generation", async () => {
    const result = queuedPlacementController({
      canBuild: 42,
      canUpgrade: false,
      cost: 125_000n,
      freshBuildCosts: [125_000n, 375_000n, 875_000n],
      ghostRailPaths: [],
      overlappingRailroads: [],
      type: UnitType.Factory,
    });
    result.click(1, 2);
    await flushAsyncPlacement();
    const validation = result.deferNextBuildables();
    result.quantityRequest()!.onConfirm(3);
    const oldGeneration = result.uiState.structurePlacementQueue!.generation;
    const input = new InputHandler(
      {
        config: () => ({ depthProgressionEnabled: () => true }),
      } as unknown as GameView,
      result.uiState,
      document.createElement("canvas"),
      new EventBus(),
    );
    (
      input as unknown as {
        setGhostStructure(type: UnitType): void;
      }
    ).setGhostStructure(UnitType.Factory);
    expect(result.uiState.structurePlacementQueue).toBeDefined();
    (
      input as unknown as {
        setGhostStructure(type: UnitType): void;
      }
    ).setGhostStructure(UnitType.City);
    const canceledRevision = structurePlacementRevision(result.uiState);
    validation.resolve([
      {
        canBuild: 42,
        canUpgrade: false,
        cost: 125_000n,
        freshBuildCosts: [125_000n, 375_000n, 875_000n],
        ghostRailPaths: [],
        overlappingRailroads: [],
        type: UnitType.Factory,
      },
    ]);
    await flushAsyncPlacement();

    expect(canceledRevision).toBeGreaterThan(oldGeneration);
    expect(structurePlacementRevision(result.uiState)).toBe(canceledRevision);
    expect(result.buildIntent).not.toHaveBeenCalled();
    expect(result.uiState.structurePlacementQueue).toBeUndefined();
    expect(result.uiState.ghostStructure).toBe(UnitType.City);
  });

  test("applies an immediate paused transport rejection without a renderer tick", async () => {
    const result = queuedPlacementController({
      canBuild: 42,
      canUpgrade: false,
      cost: 125_000n,
      freshBuildCosts: [125_000n, 375_000n, 875_000n],
      ghostRailPaths: [],
      overlappingRailroads: [],
      type: UnitType.City,
    });
    const transport = new Transport({} as LobbyConfig, result.eventBus);
    Object.assign(transport, { sendIntent: vi.fn(() => false) });
    result.click(1, 2);
    await flushAsyncPlacement();

    result.quantityRequest()!.onConfirm(3);
    await flushAsyncPlacement();

    expect(result.buildIntent).toHaveBeenCalledOnce();
    expect(result.uiState.structurePlacementQueue).toMatchObject({
      pending: undefined,
      remaining: 3,
    });
  });

  test("waits through delay and retries only after a tagged authoritative rejection", async () => {
    const result = queuedPlacementController({
      canBuild: 42,
      canUpgrade: false,
      cost: 125_000n,
      freshBuildCosts: [125_000n, 375_000n, 875_000n],
      ghostRailPaths: [],
      overlappingRailroads: [],
      type: UnitType.City,
    });
    result.click(1, 2);
    await flushAsyncPlacement();
    result.quantityRequest()!.onConfirm(3);
    await flushAsyncPlacement();
    const firstIntent = result.buildIntent.mock
      .calls[0][0] as BuildUnitIntentEvent;
    const firstTag = firstIntent.structurePlacementTag!;
    expect(result.uiState.structurePlacementQueue?.remaining).toBe(3);

    // Arbitrarily many authoritative ticks are not a rejection receipt.
    result.setTick(10_000);
    result.tick();
    result.click(3, 4);
    await flushAsyncPlacement();
    expect(result.buildIntent).toHaveBeenCalledOnce();
    expect(result.uiState.structurePlacementQueue).toMatchObject({
      confirmedTiles: [],
      pending: { requestId: firstTag.requestId },
      remaining: 3,
    });

    // A positive rejection retains the copy and permits exactly one retry.
    result.emitOutcome(firstTag, "rejected");
    result.tick();
    expect(result.uiState.structurePlacementQueue).toMatchObject({
      pending: undefined,
      remaining: 3,
    });
    result.setBuildable({
      canBuild: 43,
      canUpgrade: false,
      cost: 125_000n,
      freshBuildCosts: [125_000n, 375_000n, 875_000n],
      ghostRailPaths: [],
      overlappingRailroads: [],
      type: UnitType.City,
    });
    result.click(3, 4);
    await flushAsyncPlacement();
    expect(result.buildIntent).toHaveBeenCalledTimes(2);
    const secondIntent = result.buildIntent.mock
      .calls[1][0] as BuildUnitIntentEvent;
    const secondTag = secondIntent.structurePlacementTag!;

    // A duplicate/stale result for #1 cannot consume #2.
    result.emitOutcome(firstTag, "accepted");
    result.tick();
    expect(result.uiState.structurePlacementQueue).toMatchObject({
      pending: { requestId: secondTag.requestId },
      remaining: 3,
    });
    result.emitOutcome(secondTag, "accepted");
    result.emitOutcome(secondTag, "accepted");
    result.tick();
    expect(result.uiState.structurePlacementQueue).toMatchObject({
      pending: undefined,
      remaining: 2,
    });

    const preview = (
      result.controller as unknown as {
        buildGhostPreviewData(
          tile: number,
          warning: boolean,
        ): { cost: number; remainingPlacements?: number };
      }
    ).buildGhostPreviewData(42, false);
    expect(preview).toMatchObject({
      cost: 125_000,
      remainingPlacements: 2,
    });
    expect(
      ghostCommandTopText({
        ...preview,
        canAfford: true,
        canBuild: true,
        canUpgrade: false,
        ghostRailPaths: [],
        ghostType: UnitType.City,
        multiplier: 1,
        overlappingRailroads: [],
        ownerID: 1,
        radiusTileX: 0,
        radiusTileY: 42,
        rangeRadius: 0,
        rangeWarning: false,
        showCost: true,
        tileX: 0,
        tileY: 42,
        upgradeTargetTile: null,
      }),
    ).toMatch(/2 left|placements_left/);
  });

  test("contains Enter and enters explicit Hydrogen target selection", async () => {
    const result = quantityController({
      canBuild: 42,
      canUpgrade: false,
      cost: 100n,
      ghostRailPaths: [],
      overlappingRailroads: [],
      type: UnitType.HydrogenBomb,
    });

    expect(result.buildIntent).not.toHaveBeenCalled();
    expect(result.quantityRequest()).toEqual(
      expect.objectContaining({ kind: "launch", initial: 5, max: 2 }),
    );
    const menu = new BuildMenu();
    const windowGhostHotkey = vi.fn(() => result.confirmGhost());
    window.addEventListener("keydown", windowGhostHotkey);
    document.body.append(menu);

    try {
      menu.requestQuantity(result.quantityRequest()!);
      await menu.updateComplete;
      menu.shadowRoot
        ?.querySelector<HTMLInputElement>(".quantity-input")
        ?.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            composed: true,
            key: "Enter",
          }),
        );

      expect(result.buildIntent).not.toHaveBeenCalled();
      expect(result.uiState.rocketTargetSelectionQueue).toMatchObject({
        remaining: 1,
        requestedTotal: 2,
        rocketDirectionUp: false,
        selectedTargets: [42],
        unitType: UnitType.HydrogenBomb,
      });
      expect(result.uiState.ghostStructure).toBe(UnitType.HydrogenBomb);
      expect(windowGhostHotkey).not.toHaveBeenCalled();
      expect(result.quantityEvents).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener("keydown", windowGhostHotkey);
      menu.remove();
    }
  });

  test.each([UnitType.AtomBomb, UnitType.HydrogenBomb] as const)(
    "collects three explicit %s targets and emits one ordered batch",
    async (type) => {
      const result = queuedPlacementController({
        canBuild: 42,
        canUpgrade: false,
        cost: 100n,
        ghostRailPaths: [],
        overlappingRailroads: [],
        type,
      });

      result.click(1, 2);
      await flushAsyncPlacement();
      expect(result.quantityRequest()).toEqual(
        expect.objectContaining({
          kind: "launch",
          separateTargets: true,
        }),
      );
      result.quantityRequest()!.onConfirm(3);

      expect(result.buildIntent).not.toHaveBeenCalled();
      expect(result.uiState.rocketTargetSelectionQueue).toMatchObject({
        remaining: 2,
        requestedTotal: 3,
        selectedTargets: [102],
        unitType: type,
      });

      result.click(3, 4);
      await flushAsyncPlacement();
      expect(result.buildIntent).not.toHaveBeenCalled();
      expect(result.uiState.rocketTargetSelectionQueue).toMatchObject({
        remaining: 1,
        selectedTargets: [102, 304],
      });

      result.click(5, 6);
      await flushAsyncPlacement();
      expect(result.buildIntent).toHaveBeenCalledOnce();
      expect(result.buildIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 3,
          rocketDirectionUp: true,
          targetTiles: [102, 304, 506],
          tile: 102,
          unit: type,
        }),
      );
      expect(result.uiState.rocketTargetSelectionQueue).toBeUndefined();
      expect(result.uiState.ghostStructure).toBeNull();
    },
  );

  test("uses the legal remaining upgrade maximum before emitting", () => {
    const result = quantityController({
      canBuild: false,
      canUpgrade: 77,
      cost: 100n,
      ghostRailPaths: [],
      overlappingRailroads: [],
      type: UnitType.City,
      upgradeCosts: [100n, 250n],
    });

    expect(result.upgradeIntent).not.toHaveBeenCalled();
    expect(result.quantityRequest()).toEqual(
      expect.objectContaining({ kind: "upgrade", initial: 1, max: 2 }),
    );
    result.quantityRequest()!.onConfirm(2);
    expect(result.upgradeIntent).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2, unitId: 77 }),
    );
  });
});

describe("samThreatensNukePreview (nuke trajectory threat set, #4226)", () => {
  const teammates = new Set([7, 8]);
  const allies = new Set([2, 3]);

  test("non-friendly SAM threatens the trajectory", () => {
    expect(samThreatensNukePreview(5, teammates, allies, new Set())).toBe(true);
  });

  test("allied SAM does not threaten when the strike breaks no alliance", () => {
    expect(samThreatensNukePreview(2, teammates, allies, new Set())).toBe(
      false,
    );
  });

  test("would-be-betrayed ally's SAM threatens (alliance breaks at launch)", () => {
    expect(samThreatensNukePreview(2, teammates, allies, new Set([2]))).toBe(
      true,
    );
  });

  test("other allies' SAMs still excluded when a different ally is betrayed", () => {
    expect(samThreatensNukePreview(3, teammates, allies, new Set([2]))).toBe(
      false,
    );
  });

  test("teammate SAM does not threaten the trajectory", () => {
    expect(samThreatensNukePreview(7, teammates, new Set(), new Set())).toBe(
      false,
    );
  });

  test("teammate SAM stays excluded even if listed as betrayed (a strike never breaks a team)", () => {
    expect(
      samThreatensNukePreview(7, teammates, new Set([7]), new Set([7])),
    ).toBe(false);
  });
});

describe("air-defense placements", () => {
  test("carries the chosen system on every queued SAM Launcher placement", async () => {
    const sam: BuildableUnit = {
      canBuild: 42,
      canUpgrade: false,
      cost: 3_000_000n,
      freshBuildCosts: [3_000_000n, 9_000_000n, 15_000_000n],
      ghostRailPaths: [],
      overlappingRailroads: [],
      type: UnitType.SAMLauncher,
    };
    const result = queuedPlacementController(sam);
    const revision = beginStructurePlacementRequest(result.uiState);
    const generation = startStructurePlacementQueue(
      result.uiState,
      UnitType.SAMLauncher,
      2,
      revision,
      AirDefenseSystem.S500,
    );
    expect(generation).not.toBe(false);
    expect(result.uiState.structurePlacementQueue).toMatchObject({
      airDefenseSystem: AirDefenseSystem.S500,
      remaining: 2,
      unitType: UnitType.SAMLauncher,
    });

    const eventBus = (result.controller as unknown as { eventBus: EventBus })
      .eventBus;
    eventBus.emit(
      new RequestStructurePlacementEvent(
        UnitType.SAMLauncher,
        42,
        generation as number,
      ),
    );
    await flushAsyncPlacement();

    expect(result.buildIntent).toHaveBeenCalledOnce();
    expect(result.buildIntent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        airDefenseSystem: AirDefenseSystem.S500,
        amount: 1,
        tile: 42,
        unit: UnitType.SAMLauncher,
      }),
    );
    result.emitOutcome(
      (result.buildIntent.mock.calls[0][0] as BuildUnitIntentEvent)
        .structurePlacementTag!,
      "accepted",
      42,
    );
    result.tick();
    // The system survives the consumed placement for the next copy.
    expect(result.uiState.structurePlacementQueue).toMatchObject({
      airDefenseSystem: AirDefenseSystem.S500,
      remaining: 1,
    });
  });
});
