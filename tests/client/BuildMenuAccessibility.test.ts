import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RequestStructurePlacementEvent,
  type CommandQuantityRequest,
} from "../../src/client/CommandQuantity";
import { BuildMenu } from "../../src/client/hud/layers/BuildMenu";
import {
  BuildUnitIntentEvent,
  LaunchAirMissionIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../../src/client/Transport";
import type { UIState } from "../../src/client/UIState";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import {
  AircraftType,
  AirMissionType,
  BuildableUnit,
  PlayerType,
  UnitType,
} from "../../src/core/game/Game";

function fighterBuildable(cost = 100n, tile = 1): BuildableUnit {
  return {
    canBuild: tile,
    canUpgrade: false,
    cost,
    ghostRailPaths: [],
    overlappingRailroads: [],
    type: UnitType.FighterJet,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

describe("BuildMenu accessibility", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("keeps quantity and fighter role surfaces inside the mobile menu", () => {
    const cssText = (
      BuildMenu.styles as unknown as {
        cssText: string;
      }
    ).cssText;
    const declarationsFor = (selector: string): string => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return (
        cssText.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "s"))?.[1] ?? ""
      );
    };

    for (const selector of [
      ".build-menu",
      ".fighter-mission-header",
      ".fighter-mission-grid",
      ".fighter-mission-button",
      ".quantity-dialog",
      ".quantity-controls",
      ".quantity-input",
    ]) {
      expect(declarationsFor(selector)).toMatch(/box-sizing:\s*border-box/);
    }
    expect(declarationsFor(".fighter-mission-header")).toMatch(
      /width:\s*min\(660px,\s*100%\)/,
    );
    expect(declarationsFor(".fighter-mission-grid")).toMatch(
      /width:\s*min\(660px,\s*100%\)/,
    );
    expect(declarationsFor(".quantity-dialog")).toMatch(
      /width:\s*min\(430px,\s*100%\)/,
    );
    expect(cssText).not.toContain("calc(100vw - 32px)");
    expect(cssText).toMatch(
      /@media \(max-width: 480px\)[\s\S]*\.fighter-mission-grid\[data-role-count="3"\][\s\S]*grid-template-columns:\s*1fr/,
    );
  });

  it("keeps an unavailable action focusable, described, and inert", async () => {
    const menu = new BuildMenu();
    menu.game = {
      config: () => ({ depthProgressionEnabled: () => false }),
      myPlayer: () => null,
    } as unknown as GameView;
    menu.playerBuildables = [
      {
        canBuild: false,
        canUpgrade: false,
        cost: 100n,
        ghostRailPaths: [],
        overlappingRailroads: [],
        type: UnitType.AtomBomb,
      },
    ];
    const sendBuildOrUpgrade = vi.spyOn(menu, "sendBuildOrUpgrade");

    document.body.append(menu);
    await menu.updateComplete;

    const button =
      menu.shadowRoot?.querySelector<HTMLButtonElement>(".build-button");
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(false);
    expect(button?.getAttribute("aria-disabled")).toBe("true");

    const reasonId = button?.getAttribute("aria-describedby");
    expect(reasonId).toBeTruthy();
    expect(reasonId).not.toMatch(/\s/);
    expect(menu.shadowRoot?.getElementById(reasonId!)).not.toBeNull();

    button?.focus();
    expect(menu.shadowRoot?.activeElement).toBe(button);
    button?.click();
    expect(sendBuildOrUpgrade).not.toHaveBeenCalled();
  });

  it("explains the Factory requirement instead of misreporting a gold shortage", async () => {
    const menu = new BuildMenu();
    menu.game = {
      config: () => ({
        depthProgressionEnabled: () => false,
        effectivePortLevels: () => 0,
        fighterLaunchCooldown: () => 100,
        fighterMaxActive: () => 8,
        fighterRange: () => 500,
      }),
      euclideanDistSquared: () => 0,
      isSpawnImmunityActive: () => false,
      myPlayer: () => ({
        completedUnitCount: () => 0,
        gold: () => 10_000n,
        totalUnitLevels: () => 0,
        units: () => [],
      }),
      ticks: () => 200,
    } as unknown as GameView;
    menu.playerBuildables = [
      {
        canBuild: false,
        canUpgrade: false,
        cost: 100n,
        ghostRailPaths: [],
        overlappingRailroads: [],
        type: UnitType.FighterJet,
      },
    ];
    Object.assign(menu, { clickedTile: 7 });

    document.body.append(menu);
    await menu.updateComplete;

    const reason = menu.shadowRoot?.querySelector(
      ".build-disabled-reason",
    )?.textContent;
    expect(reason).toContain("fighter.factory_required");
    expect(reason).not.toContain("not_enough_money");
  });

  it("keeps the two fighter roles focusable and explains an invalid tactical target", async () => {
    const readyFactory = {
      isActive: () => true,
      isUnderConstruction: () => false,
      markedForDeletion: () => false,
      missileTimerQueue: () => [],
      tile: () => 3,
    };
    const menu = new BuildMenu();
    menu.game = {
      config: () => ({
        depthProgressionEnabled: () => false,
        fighterLaunchCooldown: () => 100,
        fighterMaxActive: () => 2,
        fighterRange: () => 500,
      }),
      euclideanDistSquared: () => 0,
      isImpassable: () => false,
      isLand: () => false,
      isNationSpawnImmunityActive: () => false,
      isSpawnImmunityActive: () => false,
      myPlayer: () => ({
        gold: () => 1_000n,
        units: (type: UnitType) =>
          type === UnitType.Factory ? [readyFactory] : [],
      }),
      owner: () => ({ isPlayer: () => false }),
      units: () => [],
      ticks: () => 200,
    } as unknown as GameView;
    menu.playerBuildables = [fighterBuildable()];
    Object.assign(menu, {
      _hidden: false,
      clickedTile: 7,
      fighterMissionPicker: true,
    });

    document.body.append(menu);
    await menu.updateComplete;

    const buttons = [
      ...(menu.shadowRoot?.querySelectorAll<HTMLButtonElement>(
        ".fighter-mission-button",
      ) ?? []),
    ];
    expect(buttons).toHaveLength(2);
    const status = menu.shadowRoot?.querySelector<HTMLElement>(
      "[data-fighter-status]",
    );
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.dataset.fighterStatus).toBe("ready");
    expect(status?.dataset.activeSorties).toBe("0");
    expect(status?.dataset.sortieCap).toBe("2");
    expect(status?.textContent).toContain("status_sorties");
    const unavailable = buttons.filter(
      (button) => button.getAttribute("aria-disabled") === "true",
    );
    expect(unavailable).toHaveLength(1);
    for (const button of unavailable) {
      expect(button.disabled).toBe(false);
      const reasonId = button.getAttribute("aria-describedby");
      expect(reasonId).toBeTruthy();
      const reason = menu.shadowRoot?.getElementById(reasonId!);
      expect(reason?.textContent?.trim().length).toBeGreaterThan(0);
      expect(
        reason?.classList.contains("fighter-mission-disabled-reason"),
      ).toBe(true);
      button.focus();
      expect(menu.shadowRoot?.activeElement).toBe(button);
    }
  });

  it("offers global defense but never a tactical strike against the player's own ship", async () => {
    const readyFactory = {
      isActive: () => true,
      isUnderConstruction: () => false,
      markedForDeletion: () => false,
      missileTimerQueue: () => [],
      tile: () => 3,
    };
    const player = {
      gold: () => 1_000n,
      isPlayer: () => true,
      isFriendly: () => false,
      units: (type: UnitType) =>
        type === UnitType.Factory ? [readyFactory] : [],
    };
    const ownShip = {
      id: () => 99,
      isActive: () => true,
      owner: () => player,
      targetable: () => true,
      tile: () => 7,
    };
    const menu = new BuildMenu();
    menu.game = {
      config: () => ({
        depthProgressionEnabled: () => false,
        fighterLaunchCooldown: () => 100,
        fighterMaxActive: () => 8,
        fighterRange: () => 500,
      }),
      euclideanDistSquared: () => 0,
      isImpassable: () => false,
      isLand: () => false,
      isNationSpawnImmunityActive: () => false,
      isSpawnImmunityActive: () => false,
      myPlayer: () => player,
      owner: () => ({ isPlayer: () => false }),
      units: () => [ownShip],
      ticks: () => 200,
    } as unknown as GameView;
    menu.playerBuildables = [fighterBuildable()];
    Object.assign(menu, {
      _hidden: false,
      clickedTile: 7,
      fighterMissionPicker: true,
    });

    document.body.append(menu);
    await menu.updateComplete;

    const buttons = [
      ...(menu.shadowRoot?.querySelectorAll<HTMLButtonElement>(
        ".fighter-mission-button",
      ) ?? []),
    ];
    expect(buttons).toHaveLength(2);
    expect(buttons[0].dataset.fighterRole).toBe("air_defense");
    expect(buttons[0].getAttribute("aria-disabled")).toBe("false");
    expect(buttons[1].dataset.fighterRole).toBe("tactical_strike");
    expect(buttons[1].getAttribute("aria-disabled")).toBe("true");
  });

  it("keeps every mission inert until a Factory is ready", async () => {
    const menu = new BuildMenu();
    menu.game = {
      config: () => ({
        depthProgressionEnabled: () => false,
        fighterLaunchCooldown: () => 100,
        fighterMaxActive: () => 8,
        fighterRange: () => 500,
      }),
      euclideanDistSquared: () => 0,
      isImpassable: () => false,
      isLand: () => true,
      isNationSpawnImmunityActive: () => false,
      isSpawnImmunityActive: () => false,
      myPlayer: () => ({ gold: () => 1_000n, units: () => [] }),
      owner: () => ({ isPlayer: () => false }),
      units: () => [],
      ticks: () => 200,
    } as unknown as GameView;
    menu.playerBuildables = [fighterBuildable()];
    Object.assign(menu, {
      _hidden: false,
      clickedTile: 7,
      fighterMissionPicker: true,
    });

    document.body.append(menu);
    await menu.updateComplete;

    const buttons = [
      ...(menu.shadowRoot?.querySelectorAll<HTMLButtonElement>(
        ".fighter-mission-button",
      ) ?? []),
    ];
    expect(buttons).toHaveLength(2);
    expect(
      buttons.every(
        (button) => button.getAttribute("aria-disabled") === "true",
      ),
    ).toBe(true);
    expect(buttons[0].textContent).toContain("status.factory_required");
  });

  it("allows precision targeting of a disconnected former ally like the server", async () => {
    const readyFactory = {
      isActive: () => true,
      isUnderConstruction: () => false,
      markedForDeletion: () => false,
      missileTimerQueue: () => [],
      tile: () => 3,
    };
    const player = {
      gold: () => 1_000n,
      isFriendly: () => true,
      units: (type: UnitType) =>
        type === UnitType.Factory ? [readyFactory] : [],
    };
    const disconnectedAlly = {
      isDisconnected: () => true,
      isFriendly: () => true,
      isPlayer: () => true,
      type: () => PlayerType.Human,
    };
    const menu = new BuildMenu();
    menu.game = {
      config: () => ({
        depthProgressionEnabled: () => false,
        fighterLaunchCooldown: () => 100,
        fighterMaxActive: () => 8,
        fighterRange: () => 500,
      }),
      euclideanDistSquared: () => 0,
      isImpassable: () => false,
      isLand: () => true,
      isNationSpawnImmunityActive: () => false,
      isSpawnImmunityActive: () => false,
      myPlayer: () => player,
      owner: () => disconnectedAlly,
      units: () => [],
      ticks: () => 200,
    } as unknown as GameView;
    menu.playerBuildables = [fighterBuildable()];
    Object.assign(menu, {
      _hidden: false,
      clickedTile: 7,
      fighterMissionPicker: true,
    });

    document.body.append(menu);
    await menu.updateComplete;

    const tacticalStrikeButton =
      menu.shadowRoot?.querySelectorAll<HTMLButtonElement>(
        ".fighter-mission-button",
      )[1];
    expect(tacticalStrikeButton?.getAttribute("aria-disabled")).toBe("false");
  });

  it("grounds every mission if gold changes while the picker is open", async () => {
    const readyFactory = {
      isActive: () => true,
      isUnderConstruction: () => false,
      markedForDeletion: () => false,
      missileTimerQueue: () => [],
      tile: () => 3,
    };
    const player = {
      gold: () => 50n,
      units: (type: UnitType) =>
        type === UnitType.Factory ? [readyFactory] : [],
    };
    const menu = new BuildMenu();
    menu.game = {
      config: () => ({
        depthProgressionEnabled: () => false,
        fighterLaunchCooldown: () => 100,
        fighterMaxActive: () => 8,
        fighterRange: () => 500,
      }),
      euclideanDistSquared: () => 0,
      isImpassable: () => false,
      isLand: () => true,
      isNationSpawnImmunityActive: () => false,
      isSpawnImmunityActive: () => false,
      myPlayer: () => player,
      owner: () => ({ isPlayer: () => false }),
      units: () => [],
      ticks: () => 200,
    } as unknown as GameView;
    menu.playerBuildables = [
      {
        canBuild: 3,
        canUpgrade: false,
        cost: 100n,
        ghostRailPaths: [],
        overlappingRailroads: [],
        type: UnitType.FighterJet,
      },
    ];
    Object.assign(menu, {
      _hidden: false,
      clickedTile: 7,
      fighterMissionPicker: true,
    });

    document.body.append(menu);
    await menu.updateComplete;

    const status = menu.shadowRoot?.querySelector<HTMLElement>(
      "[data-fighter-status]",
    );
    const buttons = [
      ...(menu.shadowRoot?.querySelectorAll<HTMLButtonElement>(
        ".fighter-mission-button",
      ) ?? []),
    ];
    expect(status?.dataset.fighterStatus).toBe("insufficient_gold");
    expect(status?.textContent).toContain("status.insufficient_gold");
    expect(
      buttons.every(
        (button) => button.getAttribute("aria-disabled") === "true",
      ),
    ).toBe(true);
  });

  it("fails closed until the authoritative fighter cost arrives across delayed ticks", async () => {
    const pending = deferred<BuildableUnit[]>();
    const readyFactory = {
      isActive: () => true,
      isUnderConstruction: () => false,
      markedForDeletion: () => false,
      missileTimerQueue: () => [],
      tile: () => 3,
    };
    const player = {
      buildables: vi.fn(() => pending.promise),
      gold: () => 1_000_000n,
      units: (type: UnitType) =>
        type === UnitType.Factory ? [readyFactory] : [],
    };
    const eventBus = new EventBus();
    const emitted = vi.fn();
    eventBus.on(LaunchAirMissionIntentEvent, emitted);
    const menu = new BuildMenu();
    menu.game = {
      config: () => ({
        combinedArmsV2Enabled: () => true,
        fighterLaunchCooldown: () => 100,
        fighterMaxActive: () => 2,
        isUnitDisabled: () => false,
      }),
      isImpassable: () => false,
      isLand: () => true,
      isNationSpawnImmunityActive: () => false,
      isSpawnImmunityActive: () => false,
      myPlayer: () => player,
      owner: () => ({ isPlayer: () => false }),
      ticks: () => 200,
      units: () => [],
    } as unknown as GameView;
    menu.eventBus = eventBus;
    document.body.append(menu);

    menu.showFighterMissions(23);
    menu.tick();
    menu.tick();
    await menu.updateComplete;

    let status = menu.shadowRoot?.querySelector<HTMLElement>(
      "[data-fighter-status]",
    );
    let roles = [
      ...(menu.shadowRoot?.querySelectorAll<HTMLButtonElement>(
        ".fighter-mission-button",
      ) ?? []),
    ];
    expect(status?.dataset.fighterStatus).toBe("unavailable");
    expect(
      roles.every((role) => role.getAttribute("aria-disabled") === "true"),
    ).toBe(true);
    roles[2].click();
    expect(menu.shadowRoot?.querySelector('[role="dialog"]')).toBeNull();
    expect(emitted).not.toHaveBeenCalled();

    pending.resolve([fighterBuildable(750_000n, 3)]);
    await pending.promise;
    await menu.updateComplete;

    status = menu.shadowRoot?.querySelector<HTMLElement>(
      "[data-fighter-status]",
    );
    roles = [
      ...(menu.shadowRoot?.querySelectorAll<HTMLButtonElement>(
        ".fighter-mission-button",
      ) ?? []),
    ];
    expect(player.buildables).toHaveBeenCalledTimes(3);
    expect(status?.dataset.fighterStatus).toBe("ready");
    roles[2].click();
    await menu.updateComplete;

    const quantityRequest = (
      menu as unknown as {
        quantityRequest: {
          totalCost?: (amount: number) => bigint;
        } | null;
      }
    ).quantityRequest;
    expect(quantityRequest?.totalCost?.(1)).toBe(750_000n);
    expect(emitted).not.toHaveBeenCalled();
  });

  it("ignores a delayed buildables response from an older fighter tile", async () => {
    const first = deferred<BuildableUnit[]>();
    const second = deferred<BuildableUnit[]>();
    const player = {
      buildables: vi.fn((tile: number) =>
        tile === 11 ? first.promise : second.promise,
      ),
      gold: () => 1_000n,
      units: () => [],
    };
    const menu = new BuildMenu();
    menu.game = {
      config: () => ({
        combinedArmsV2Enabled: () => true,
        fighterLaunchCooldown: () => 100,
        fighterMaxActive: () => 2,
        isUnitDisabled: () => false,
      }),
      isSpawnImmunityActive: () => false,
      myPlayer: () => player,
      ticks: () => 200,
    } as unknown as GameView;
    document.body.append(menu);

    menu.showFighterMissions(11, fighterBuildable(111n, 1));
    menu.showFighterMissions(22, fighterBuildable(222n, 2));
    second.resolve([fighterBuildable(222n, 2)]);
    await second.promise;
    first.resolve([fighterBuildable(111n, 1)]);
    await first.promise;
    await menu.updateComplete;

    expect(
      menu.playerBuildables?.find(
        (buildable) => buildable.type === UnitType.FighterJet,
      )?.cost,
    ).toBe(222n);
  });

  it.each([
    ["construction", 3, ["1", "2", "3", "5", "10"]],
    ["upgrade", 6, ["1", "2", "3", "5", "10", "max"]],
    ["launch", 6, ["1", "2", "3", "5", "10", "max"]],
    ["fighter", 2, ["1", "2", "5", "max"]],
  ] as const)(
    "renders request-specific %s quantity presets",
    async (kind, max, expected) => {
      const menu = new BuildMenu();
      document.body.append(menu);
      menu.requestQuantity({
        itemName: "Item",
        kind,
        max,
        onConfirm: vi.fn(),
      });
      await menu.updateComplete;

      expect(
        [
          ...(menu.shadowRoot?.querySelectorAll<HTMLElement>(
            "[data-quantity-preset]",
          ) ?? []),
        ].map((button) => button.dataset.quantityPreset),
      ).toEqual(expected);
    },
  );

  it("routes direct-menu x3 through the shared exact-placement queue", async () => {
    const eventBus = new EventBus();
    const emitted = vi.fn();
    const placementRequests = vi.fn();
    eventBus.on(BuildUnitIntentEvent, emitted);
    eventBus.on(RequestStructurePlacementEvent, placementRequests);
    const menu = new BuildMenu();
    menu.game = {
      myPlayer: () => ({ gold: () => 10_000n }),
    } as unknown as GameView;
    menu.eventBus = eventBus;
    menu.uiState = {
      ghostStructure: null,
      rocketDirectionUp: true,
      upgradeMultiplier: 1,
    } as never;
    const city: BuildableUnit = {
      canBuild: 0,
      canUpgrade: false,
      cost: 100n,
      freshBuildCosts: [100n, 200n, 300n],
      ghostRailPaths: [],
      overlappingRailroads: [],
      type: UnitType.City,
    };
    document.body.append(menu);
    await menu.updateComplete;

    menu.sendBuildOrUpgrade(city, 0);
    expect(emitted).not.toHaveBeenCalled();
    await menu.updateComplete;
    await Promise.resolve();

    const dialog = menu.shadowRoot?.querySelector<HTMLElement>(
      '[role="dialog"][data-quantity-kind="construction"]',
    );
    const input =
      menu.shadowRoot?.querySelector<HTMLInputElement>(".quantity-input");
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("quantity.separate_tiles");
    expect(input?.max).toBe("3");
    expect(menu.shadowRoot?.activeElement).toBe(input);
    expect(
      menu.shadowRoot?.querySelector<HTMLButtonElement>(
        '[data-quantity-preset="2"]',
      )?.disabled,
    ).toBe(false);
    expect(
      menu.shadowRoot?.querySelector<HTMLButtonElement>(
        '[data-quantity-preset="3"]',
      )?.disabled,
    ).toBe(false);
    // Choices above the current affordable maximum stay visible but disabled,
    // so the ceiling is honest instead of hidden.
    expect(
      menu.shadowRoot?.querySelector<HTMLButtonElement>(
        '[data-quantity-preset="5"]',
      )?.disabled,
    ).toBe(true);
    expect(
      [
        ...(menu.shadowRoot?.querySelectorAll<HTMLElement>(
          "[data-quantity-preset]",
        ) ?? []),
      ].map((button) => button.dataset.quantityPreset),
    ).toEqual(["1", "2", "3", "5", "10"]);
    expect(menu.shadowRoot?.querySelector(".quantity-summary")).toBeNull();

    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-quantity-preset="3"]')
      ?.click();
    await menu.updateComplete;

    const confirm = menu.shadowRoot?.querySelector<HTMLButtonElement>(
      ".quantity-action.confirm",
    );
    expect(confirm?.type).toBe("button");
    confirm?.click();
    expect(emitted).not.toHaveBeenCalled();
    expect(placementRequests).toHaveBeenCalledOnce();
    expect(placementRequests).toHaveBeenCalledWith(
      expect.objectContaining({ targetTile: 0, unitType: UnitType.City }),
    );
    expect(menu.uiState.structurePlacementQueue).toMatchObject({
      confirmedTiles: [],
      unitType: UnitType.City,
      remaining: 3,
    });
    expect(menu.uiState.ghostStructure).toBe(UnitType.City);
  });

  it("arms a direct queue without hiding a nearby resolved first tile", () => {
    const eventBus = new EventBus();
    const placementRequests = vi.fn();
    eventBus.on(RequestStructurePlacementEvent, placementRequests);
    const menu = new BuildMenu();
    menu.game = {
      myPlayer: () => ({ gold: () => 10_000n }),
    } as unknown as GameView;
    menu.eventBus = eventBus;
    menu.uiState = {
      attackRatio: 20,
      ghostStructure: null,
      rocketDirectionUp: true,
      upgradeMultiplier: 1,
    };
    menu.sendBuildOrUpgrade(
      {
        canBuild: 35,
        canUpgrade: false,
        cost: 100n,
        freshBuildCosts: [100n, 200n, 300n],
        ghostRailPaths: [],
        overlappingRailroads: [],
        type: UnitType.City,
      },
      30,
    );
    const request = (
      menu as unknown as { quantityRequest: CommandQuantityRequest }
    ).quantityRequest;

    request.onConfirm(3);

    expect(placementRequests).not.toHaveBeenCalled();
    expect(menu.uiState.structurePlacementQueue).toMatchObject({
      confirmedTiles: [],
      remaining: 3,
      unitType: UnitType.City,
    });
    expect(menu.uiState.ghostStructure).toBe(UnitType.City);
  });

  it("ignores a stale structure chooser callback after Escape", async () => {
    const eventBus = new EventBus();
    const placementRequests = vi.fn();
    eventBus.on(RequestStructurePlacementEvent, placementRequests);
    const menu = new BuildMenu();
    menu.game = {
      myPlayer: () => ({ gold: () => 1_000n }),
    } as unknown as GameView;
    menu.eventBus = eventBus;
    menu.uiState = {
      attackRatio: 20,
      ghostStructure: null,
      rocketDirectionUp: true,
      upgradeMultiplier: 1,
    };
    document.body.append(menu);
    menu.sendBuildOrUpgrade(
      {
        canBuild: 7,
        canUpgrade: false,
        cost: 100n,
        freshBuildCosts: [100n, 200n, 300n],
        ghostRailPaths: [],
        overlappingRailroads: [],
        type: UnitType.Factory,
      },
      7,
    );
    await menu.updateComplete;
    const staleRequest = (
      menu as unknown as { quantityRequest: CommandQuantityRequest }
    ).quantityRequest;
    menu.shadowRoot
      ?.querySelector<HTMLInputElement>(".quantity-input")
      ?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          composed: true,
          key: "Escape",
        }),
      );

    staleRequest.onConfirm(3);
    expect(placementRequests).not.toHaveBeenCalled();
    expect(menu.uiState.structurePlacementQueue).toBeUndefined();
  });

  it("keeps stale direct callbacks bound to their original UIState", () => {
    const eventBus = new EventBus();
    const placementRequests = vi.fn();
    eventBus.on(RequestStructurePlacementEvent, placementRequests);
    const menu = new BuildMenu();
    menu.game = {
      myPlayer: () => ({ gold: () => 1_000n }),
    } as unknown as GameView;
    menu.eventBus = eventBus;
    const oldState: UIState = {
      attackRatio: 20,
      ghostStructure: null,
      rocketDirectionUp: true,
      upgradeMultiplier: 1,
    };
    const newState: UIState = { ...oldState };
    menu.uiState = oldState;
    menu.sendBuildOrUpgrade(
      {
        canBuild: 7,
        canUpgrade: false,
        cost: 100n,
        freshBuildCosts: [100n, 200n, 300n],
        ghostRailPaths: [],
        overlappingRailroads: [],
        type: UnitType.City,
      },
      7,
    );
    const staleRequest = (
      menu as unknown as { quantityRequest: CommandQuantityRequest }
    ).quantityRequest;

    menu.uiState = newState;
    menu.sendBuildOrUpgrade(
      {
        canBuild: 8,
        canUpgrade: false,
        cost: 100n,
        freshBuildCosts: [100n, 200n, 300n],
        ghostRailPaths: [],
        overlappingRailroads: [],
        type: UnitType.Factory,
      },
      8,
    );
    const currentRequest = (
      menu as unknown as { quantityRequest: CommandQuantityRequest }
    ).quantityRequest;
    staleRequest.onConfirm(3);
    currentRequest.onConfirm(3);

    expect(oldState.structurePlacementQueue).toBeUndefined();
    expect(newState.structurePlacementQueue).toMatchObject({
      remaining: 3,
      unitType: UnitType.Factory,
    });
    expect(placementRequests).toHaveBeenCalledOnce();
    expect(placementRequests).toHaveBeenCalledWith(
      expect.objectContaining({ unitType: UnitType.Factory }),
    );
  });

  it.each(["quantity", "menu", "fighter"] as const)(
    "invalidates a structure chooser replaced by a non-structure %s",
    async (replacement) => {
      const eventBus = new EventBus();
      const placementRequests = vi.fn();
      eventBus.on(RequestStructurePlacementEvent, placementRequests);
      const menu = new BuildMenu();
      menu.game = {
        config: () => ({ isUnitDisabled: () => false }),
        myPlayer: () => ({ buildables: async () => [], gold: () => 1_000n }),
      } as unknown as GameView;
      menu.eventBus = eventBus;
      menu.uiState = {
        attackRatio: 20,
        ghostStructure: null,
        rocketDirectionUp: true,
        upgradeMultiplier: 1,
      };
      menu.sendBuildOrUpgrade(
        {
          canBuild: 7,
          canUpgrade: false,
          cost: 100n,
          freshBuildCosts: [100n, 200n, 300n],
          ghostRailPaths: [],
          overlappingRailroads: [],
          type: UnitType.Factory,
        },
        7,
      );
      const staleRequest = (
        menu as unknown as { quantityRequest: CommandQuantityRequest }
      ).quantityRequest;

      if (replacement === "quantity") {
        menu.requestQuantity({
          itemName: "Warship",
          kind: "launch",
          max: 1,
          onConfirm: vi.fn(),
        });
      } else if (replacement === "menu") {
        menu.showMenu(8);
      } else {
        menu.showFighterMissions(8);
      }
      staleRequest.onConfirm(3);

      expect(placementRequests).not.toHaveBeenCalled();
      expect(menu.uiState.structurePlacementQueue).toBeUndefined();
    },
  );

  it.each(["structure", "quantity", "menu", "fighter", "hide"] as const)(
    "cancels a replaced structure chooser exactly once via %s",
    (replacement) => {
      const menu = new BuildMenu();
      menu.game = {
        config: () => ({ isUnitDisabled: () => false }),
        myPlayer: () => ({ buildables: async () => [], gold: () => 1_000n }),
      } as unknown as GameView;
      menu.eventBus = new EventBus();
      menu.uiState = {
        attackRatio: 20,
        ghostStructure: null,
        rocketDirectionUp: true,
        upgradeMultiplier: 1,
      };
      const structure = (
        type: UnitType.City | UnitType.Factory,
        tile: number,
      ): BuildableUnit => ({
        canBuild: tile,
        canUpgrade: false,
        cost: 100n,
        freshBuildCosts: [100n, 200n, 300n],
        ghostRailPaths: [],
        overlappingRailroads: [],
        type,
      });
      menu.sendBuildOrUpgrade(structure(UnitType.City, 7), 7);
      const request = (
        menu as unknown as { quantityRequest: CommandQuantityRequest }
      ).quantityRequest;
      const originalCancel = request.onCancel;
      const onCancel = vi.fn(() => originalCancel?.());
      request.onCancel = onCancel;

      if (replacement === "structure") {
        menu.sendBuildOrUpgrade(structure(UnitType.Factory, 8), 8);
      } else if (replacement === "quantity") {
        menu.requestQuantity({
          itemName: "Warship",
          kind: "launch",
          max: 1,
          onConfirm: vi.fn(),
        });
      } else if (replacement === "menu") {
        menu.showMenu(8);
      } else if (replacement === "fighter") {
        menu.showFighterMissions(8);
      } else {
        menu.hideMenu();
      }
      menu.hideMenu();

      expect(onCancel).toHaveBeenCalledOnce();
    },
  );

  it.each([UnitType.AtomBomb, UnitType.HydrogenBomb] as const)(
    "caps %s batches by both gold and ready missile tubes",
    async (type) => {
      const eventBus = new EventBus();
      const emitted = vi.fn();
      eventBus.on(BuildUnitIntentEvent, emitted);
      const menu = new BuildMenu();
      menu.game = {
        myPlayer: () => ({
          gold: () => 1_000n,
          readyMissileCount: () => 2,
        }),
      } as unknown as GameView;
      menu.eventBus = eventBus;
      menu.uiState = { rocketDirectionUp: false } as never;
      const bomb: BuildableUnit = {
        canBuild: 7,
        canUpgrade: false,
        cost: 100n,
        ghostRailPaths: [],
        overlappingRailroads: [],
        type,
      };
      document.body.append(menu);
      await menu.updateComplete;

      menu.sendBuildOrUpgrade(bomb, 7);
      await menu.updateComplete;
      expect(emitted).not.toHaveBeenCalled();
      expect(
        menu.shadowRoot
          ?.querySelector<HTMLElement>("[data-quantity-maximum]")
          ?.getAttribute("data-quantity-maximum"),
      ).toBe("2");
      expect(menu.shadowRoot?.textContent).toContain(
        "quantity.separate_rocket_targets",
      );
      menu.shadowRoot
        ?.querySelector<HTMLButtonElement>('[data-quantity-preset="2"]')
        ?.click();
      await menu.updateComplete;
      menu.shadowRoot
        ?.querySelector<HTMLButtonElement>(".quantity-action.confirm")
        ?.click();
      expect(emitted).not.toHaveBeenCalled();
      expect(menu.uiState.rocketTargetSelectionQueue).toMatchObject({
        remaining: 1,
        requestedTotal: 2,
        rocketDirectionUp: false,
        selectedTargets: [7],
        unitType: type,
      });
      expect(menu.uiState.ghostStructure).toBe(type);
    },
  );

  it.each([
    [UnitType.Warship, "10"],
    [UnitType.MIRV, "4"],
  ] as const)(
    "asks before %s and derives its real gold/readiness maximum",
    async (type, expectedMaximum) => {
      const eventBus = new EventBus();
      const emitted = vi.fn();
      eventBus.on(BuildUnitIntentEvent, emitted);
      const menu = new BuildMenu();
      menu.game = {
        myPlayer: () => ({ gold: () => 1_000n, readyMissileCount: () => 4 }),
      } as unknown as GameView;
      menu.eventBus = eventBus;
      menu.uiState = { rocketDirectionUp: true } as never;
      const buildable: BuildableUnit = {
        canBuild: 7,
        canUpgrade: false,
        cost: 100n,
        ghostRailPaths: [],
        overlappingRailroads: [],
        type,
      };
      document.body.append(menu);
      await menu.updateComplete;

      menu.sendBuildOrUpgrade(buildable, 7);
      await menu.updateComplete;
      expect(emitted).not.toHaveBeenCalled();
      expect(
        menu.shadowRoot
          ?.querySelector<HTMLElement>("[data-quantity-maximum]")
          ?.getAttribute("data-quantity-maximum"),
      ).toBe(expectedMaximum);
      expect(
        menu.shadowRoot?.querySelector("[data-quantity-maximum]")?.textContent,
      ).toContain("quantity.max_label");
      menu.shadowRoot
        ?.querySelector<HTMLButtonElement>(".quantity-action.confirm")
        ?.click();
      expect(emitted).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 1, unit: type }),
      );
    },
  );

  it("keeps atomic upgrades and offers the x3 quick choice", async () => {
    const eventBus = new EventBus();
    const emitted = vi.fn();
    eventBus.on(SendUpgradeStructureIntentEvent, emitted);
    const menu = new BuildMenu();
    menu.game = {
      myPlayer: () => ({ gold: () => 500n }),
    } as unknown as GameView;
    menu.eventBus = eventBus;
    const city: BuildableUnit = {
      canBuild: false,
      canUpgrade: 77,
      cost: 100n,
      ghostRailPaths: [],
      overlappingRailroads: [],
      type: UnitType.City,
      upgradeCosts: [100n, 250n, 450n],
    };
    document.body.append(menu);
    await menu.updateComplete;

    menu.sendBuildOrUpgrade(city, 7);
    await menu.updateComplete;
    expect(emitted).not.toHaveBeenCalled();
    expect(
      menu.shadowRoot
        ?.querySelector<HTMLElement>("[data-quantity-maximum]")
        ?.getAttribute("data-quantity-maximum"),
    ).toBe("3");
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-quantity-preset="3"]')
      ?.click();
    await menu.updateComplete;
    expect(
      menu.shadowRoot?.querySelector(".quantity-summary")?.textContent,
    ).toContain("450");
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(".quantity-action.confirm")
      ?.click();
    expect(emitted).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 3,
        unitId: 77,
        unitType: UnitType.City,
      }),
    );
  });

  it("asks fighter quantity after one of two roles and emits a two-sortie defense order", async () => {
    const factories = [1, 2].map((id) => ({
      id: () => id,
      isActive: () => true,
      isUnderConstruction: () => false,
      markedForDeletion: () => false,
      missileTimerQueue: () => [],
      tile: () => id,
    }));
    const player = {
      completedUnitCount: () => 0,
      gold: () => 1_000n,
      isFriendly: () => false,
      totalUnitLevels: () => 0,
      units: (type: UnitType) => (type === UnitType.Factory ? factories : []),
    };
    const eventBus = new EventBus();
    const emitted = vi.fn();
    eventBus.on(LaunchAirMissionIntentEvent, emitted);
    const menu = new BuildMenu();
    menu.game = {
      config: () => ({
        fighterLaunchCooldown: () => 100,
        fighterMaxActive: () => 2,
      }),
      isImpassable: () => false,
      isLand: () => true,
      isNationSpawnImmunityActive: () => false,
      isSpawnImmunityActive: () => false,
      myPlayer: () => player,
      owner: () => ({ isPlayer: () => false }),
      ticks: () => 200,
      units: () => [],
    } as unknown as GameView;
    menu.eventBus = eventBus;
    menu.playerBuildables = [
      {
        canBuild: 1,
        canUpgrade: false,
        cost: 100n,
        ghostRailPaths: [],
        overlappingRailroads: [],
        type: UnitType.FighterJet,
      },
    ];
    Object.assign(menu, {
      _hidden: false,
      clickedTile: 7,
      fighterMissionPicker: true,
    });
    document.body.append(menu);
    await menu.updateComplete;

    const roles = [
      ...(menu.shadowRoot?.querySelectorAll<HTMLButtonElement>(
        ".fighter-mission-button",
      ) ?? []),
    ];
    expect(roles.map((button) => button.dataset.fighterRole)).toEqual([
      "air_defense",
      "tactical_strike",
    ]);
    roles[0].click();
    await menu.updateComplete;
    expect(emitted).not.toHaveBeenCalled();
    expect(
      menu.shadowRoot
        ?.querySelector<HTMLElement>("[data-quantity-maximum]")
        ?.getAttribute("data-quantity-maximum"),
    ).toBe("2");
    expect(menu.shadowRoot?.textContent).toContain(
      "quantity.shared_fighter_target",
    );
    expect(
      [
        ...(menu.shadowRoot?.querySelectorAll<HTMLElement>(
          "[data-quantity-preset]",
        ) ?? []),
      ].map((button) => button.dataset.quantityPreset),
    ).toEqual(["1", "2", "5", "max"]);
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-quantity-preset="2"]')
      ?.click();
    await menu.updateComplete;
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(".quantity-action.confirm")
      ?.click();
    expect(emitted).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2,
        order: { mission: AirMissionType.Intercept, targetTile: 7 },
      }),
    );
  });

  it("offers V2 Combat Air Patrol as a third localized role and reuses launch quantity", async () => {
    const factories = [1, 2].map((id) => ({
      id: () => id,
      isActive: () => true,
      isUnderConstruction: () => false,
      markedForDeletion: () => false,
      missileTimerQueue: () => [],
      tile: () => id,
    }));
    const player = {
      completedUnitCount: () => 0,
      gold: () => 1_000n,
      isFriendly: () => false,
      totalUnitLevels: () => 0,
      units: (type: UnitType) => (type === UnitType.Factory ? factories : []),
    };
    const eventBus = new EventBus();
    const emitted = vi.fn();
    eventBus.on(LaunchAirMissionIntentEvent, emitted);
    const menu = new BuildMenu();
    menu.game = {
      config: () => ({
        combinedArmsV2Enabled: () => true,
        fighterLaunchCooldown: () => 100,
        fighterMaxActive: () => 2,
      }),
      isImpassable: () => false,
      isLand: () => true,
      isNationSpawnImmunityActive: () => false,
      isSpawnImmunityActive: () => false,
      myPlayer: () => player,
      owner: () => ({ isPlayer: () => false }),
      ticks: () => 200,
      units: () => [],
    } as unknown as GameView;
    menu.eventBus = eventBus;
    menu.playerBuildables = [
      {
        canBuild: 1,
        canUpgrade: false,
        cost: 100n,
        ghostRailPaths: [],
        overlappingRailroads: [],
        type: UnitType.FighterJet,
      },
    ];
    Object.assign(menu, {
      _hidden: false,
      clickedTile: 23,
      fighterMissionPicker: true,
    });
    document.body.append(menu);
    await menu.updateComplete;

    const roles = [
      ...(menu.shadowRoot?.querySelectorAll<HTMLButtonElement>(
        ".fighter-mission-button",
      ) ?? []),
    ];
    expect(roles.map((button) => button.dataset.fighterRole)).toEqual([
      "air_defense",
      "tactical_strike",
      "combat_air_patrol",
    ]);
    expect(roles[2].textContent).toContain("combat_air_patrol");

    roles[2].click();
    await menu.updateComplete;
    expect(emitted).not.toHaveBeenCalled();
    expect(
      menu.shadowRoot
        ?.querySelector<HTMLElement>("[data-quantity-maximum]")
        ?.getAttribute("data-quantity-maximum"),
    ).toBe("2");
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-quantity-preset="2"]')
      ?.click();
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(".quantity-action.confirm")
      ?.click();

    expect(emitted).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2,
        order: {
          mission: AirMissionType.CombatAirPatrol,
          targetTile: 23,
        },
      }),
    );
  });

  it("offers exactly one Air Superiority Patrol role in the local profile", async () => {
    const factory = {
      isActive: () => true,
      isUnderConstruction: () => false,
      markedForDeletion: () => false,
      missileTimerQueue: () => [],
      tile: () => 1,
    };
    const player = {
      completedUnitCount: () => 0,
      gold: () => 1_000n,
      isFriendly: () => false,
      totalUnitLevels: () => 0,
      units: (type: UnitType) => (type === UnitType.Factory ? [factory] : []),
    };
    const eventBus = new EventBus();
    const emitted = vi.fn();
    eventBus.on(LaunchAirMissionIntentEvent, emitted);
    const menu = new BuildMenu();
    menu.game = {
      config: () => ({
        airSuperiorityV1Enabled: () => true,
        combinedArmsV2Enabled: () => true,
        depthProgressionEnabled: () => false,
        effectivePortLevels: () => 0,
        fighterLaunchCooldown: () => 100,
        fighterMaxActive: () => 2,
      }),
      isSpawnImmunityActive: () => false,
      myPlayer: () => player,
      ticks: () => 200,
    } as unknown as GameView;
    menu.eventBus = eventBus;
    menu.playerBuildables = [fighterBuildable()];
    Object.assign(menu, {
      _hidden: false,
      clickedTile: 23,
      fighterMissionPicker: true,
    });
    document.body.append(menu);
    await menu.updateComplete;

    const roles = [
      ...(menu.shadowRoot?.querySelectorAll<HTMLButtonElement>(
        ".fighter-mission-button",
      ) ?? []),
    ];
    expect(roles).toHaveLength(1);
    expect(roles[0].dataset.fighterRole).toBe("air_superiority_patrol");
    expect(roles[0].textContent).toContain("air_superiority_patrol");
    expect(menu.shadowRoot?.textContent).toContain(
      "air_superiority_instructions",
    );

    roles[0].click();
    await menu.updateComplete;
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(".quantity-action.confirm")
      ?.click();
    expect(emitted).toHaveBeenCalledWith(
      expect.objectContaining({
        order: {
          mission: AirMissionType.CombatAirPatrol,
          targetTile: 23,
        },
      }),
    );
  });

  it("launches patrol jets from one ready Airport", async () => {
    const airport = {
      id: () => 41,
      isActive: () => true,
      isUnderConstruction: () => false,
      markedForDeletion: () => false,
      missileTimerQueue: () => [],
      tile: () => 1,
    };
    const player = {
      completedUnitCount: () => 0,
      gold: () => 10_000n,
      isFriendly: () => false,
      totalUnitLevels: () => 0,
      units: (type: UnitType) => (type === UnitType.Airport ? [airport] : []),
    };
    const eventBus = new EventBus();
    const emitted = vi.fn();
    eventBus.on(LaunchAirMissionIntentEvent, emitted);
    const menu = new BuildMenu();
    menu.game = {
      config: () => ({
        airportOperationsV1Enabled: () => true,
        airSuperiorityV1Enabled: () => true,
        combinedArmsV2Enabled: () => true,
        depthProgressionEnabled: () => false,
        effectivePortLevels: () => 0,
        fighterLaunchCooldown: () => 100,
        fighterMaxActive: () => 2,
      }),
      isSpawnImmunityActive: () => false,
      myPlayer: () => player,
      ticks: () => 200,
      units: () => [],
    } as unknown as GameView;
    menu.eventBus = eventBus;
    menu.playerBuildables = [fighterBuildable()];
    Object.assign(menu, {
      _hidden: false,
      clickedTile: 23,
      fighterMissionPicker: true,
    });
    document.body.append(menu);
    await menu.updateComplete;

    const status = menu.shadowRoot?.querySelector<HTMLElement>(
      "[data-fighter-status]",
    );
    expect(status?.dataset.fighterStatus).toBe("ready");
    expect(status?.dataset.sortieCap).toBe("100");
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(".fighter-mission-button")
      ?.click();
    await menu.updateComplete;
    // The Airport profile asks for the airframe before the quantity.
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-patrol-aircraft="f16"]')
      ?.click();
    await menu.updateComplete;
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-quantity-preset="3"]')
      ?.click();
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(".quantity-action.confirm")
      ?.click();

    expect(emitted).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 3,
        order: {
          mission: AirMissionType.CombatAirPatrol,
          targetTile: 23,
          aircraftType: AircraftType.F16,
        },
      }),
    );
  });

  it("shows a simple Airport requirement below a grounded jet option", async () => {
    const menu = new BuildMenu();
    menu.game = {
      config: () => ({
        airportOperationsV1Enabled: () => true,
        airSuperiorityV1Enabled: () => true,
        combinedArmsV2Enabled: () => true,
        depthProgressionEnabled: () => false,
        effectivePortLevels: () => 0,
        fighterLaunchCooldown: () => 100,
        fighterMaxActive: () => 2,
      }),
      isSpawnImmunityActive: () => false,
      myPlayer: () => ({
        completedUnitCount: () => 0,
        gold: () => 1_000n,
        totalUnitLevels: () => 0,
        units: () => [],
      }),
      ticks: () => 200,
      units: () => [],
    } as unknown as GameView;
    menu.playerBuildables = [
      { ...fighterBuildable(), canBuild: false, canUpgrade: false },
    ];
    Object.assign(menu, { _hidden: false, clickedTile: 7 });
    document.body.append(menu);
    await menu.updateComplete;

    const button =
      menu.shadowRoot?.querySelector<HTMLButtonElement>(".build-button");
    expect(button?.getAttribute("aria-disabled")).toBe("true");
    expect(
      menu.shadowRoot
        ?.querySelector(".build-disabled-reason")
        ?.textContent?.trim(),
    ).toContain("status.airport_required");
  });

  it("uses concise single-purpose copy on the main Fighter card only when enabled", async () => {
    const renderDescription = async (airSuperiority: boolean) => {
      const menu = new BuildMenu();
      menu.game = {
        config: () => ({
          airSuperiorityV1Enabled: () => airSuperiority,
          depthProgressionEnabled: () => false,
          effectivePortLevels: () => 0,
        }),
        myPlayer: () => ({
          completedUnitCount: () => 0,
          gold: () => 1_000n,
          totalUnitLevels: () => 0,
          units: () => [],
        }),
      } as unknown as GameView;
      menu.playerBuildables = [fighterBuildable()];
      Object.assign(menu, { _hidden: false, clickedTile: 7 });
      document.body.append(menu);
      await menu.updateComplete;
      return menu.shadowRoot
        ?.querySelector(".build-description")
        ?.textContent?.trim();
    };

    expect(await renderDescription(true)).toContain(
      "fighter_jet_air_superiority",
    );
    document.body.replaceChildren();
    expect(await renderDescription(false)).toContain(
      "build_menu.desc.fighter_jet",
    );
  });

  it("clears an externally hidden chooser and invokes cancellation only once", async () => {
    const menu = new BuildMenu();
    const onCancel = vi.fn();
    document.body.append(menu);
    menu.requestQuantity({
      kind: "construction",
      itemName: "City",
      max: 1,
      onCancel,
      onConfirm: vi.fn(),
    });
    await menu.updateComplete;
    expect(menu.shadowRoot?.querySelector('[role="dialog"]')).not.toBeNull();

    menu.hideMenu();
    menu.hideMenu();
    await menu.updateComplete;
    expect(onCancel).toHaveBeenCalledOnce();
    expect(menu.shadowRoot?.querySelector('[role="dialog"]')).toBeNull();
  });

  it("contains keydown and keyup while supporting Escape and Enter", async () => {
    const menu = new BuildMenu();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const windowKeyDown = vi.fn();
    const windowKeyUp = vi.fn();
    window.addEventListener("keydown", windowKeyDown);
    window.addEventListener("keyup", windowKeyUp);
    document.body.append(menu);

    try {
      menu.requestQuantity({
        kind: "launch",
        itemName: "Warship",
        max: 1,
        onCancel,
        onConfirm,
      });
      await menu.updateComplete;
      const firstInput =
        menu.shadowRoot?.querySelector<HTMLInputElement>(".quantity-input");
      firstInput?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          composed: true,
          key: "ArrowUp",
        }),
      );
      firstInput?.dispatchEvent(
        new KeyboardEvent("keyup", {
          bubbles: true,
          composed: true,
          key: "ArrowUp",
        }),
      );
      firstInput?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          composed: true,
          key: "Escape",
        }),
      );
      expect(onCancel).toHaveBeenCalledOnce();
      expect(onConfirm).not.toHaveBeenCalled();

      menu.requestQuantity({
        kind: "launch",
        itemName: "Warship",
        max: 1,
        onConfirm,
      });
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
      expect(onConfirm).toHaveBeenCalledWith(1);
      expect(windowKeyDown).not.toHaveBeenCalled();
      expect(windowKeyUp).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", windowKeyDown);
      window.removeEventListener("keyup", windowKeyUp);
    }
  });
});
