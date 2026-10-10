import { afterEach, describe, expect, it, vi } from "vitest";
import { BuildMenu } from "../../src/client/hud/layers/BuildMenu";
import { LaunchAirMissionIntentEvent } from "../../src/client/Transport";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import {
  AircraftType,
  AirMissionType,
  AIRPORT_FIGHTER_CAPACITY,
  type BuildableUnit,
  PATROL_AIRCRAFT_TYPES,
  PlayerType,
  UnitType,
} from "../../src/core/game/Game";

const fighterBuildable = (cost = 100n): BuildableUnit => ({
  canBuild: 1,
  canUpgrade: false,
  cost,
  ghostRailPaths: [],
  overlappingRailroads: [],
  type: UnitType.FighterJet,
});

const airportBuildable = (enabled = true): BuildableUnit => ({
  canBuild: enabled ? 1 : false,
  canUpgrade: false,
  cost: 500n,
  freshBuildCosts: enabled ? [500n] : undefined,
  ghostRailPaths: [],
  overlappingRailroads: [],
  type: UnitType.Airport,
});

function airport(
  id: number,
  options?: { building?: boolean; queue?: number[] },
) {
  return {
    id: () => id,
    isActive: () => true,
    isUnderConstruction: () => options?.building ?? false,
    markedForDeletion: () => false,
    missileTimerQueue: () => options?.queue ?? [],
    tile: () => id,
  };
}

function fighter(homeFactoryId: number) {
  return {
    aircraftState: () => ({ homeFactoryId }),
    isActive: () => true,
    markedForDeletion: () => false,
  };
}

function setup(options?: {
  airports?: readonly ReturnType<typeof airport>[];
  disabled?: readonly UnitType[];
  factories?: readonly unknown[];
  fighters?: readonly ReturnType<typeof fighter>[];
  gold?: bigint;
  spawnShield?: boolean;
}) {
  const airports = options?.airports ?? [airport(41)];
  const fighters = options?.fighters ?? [];
  const factories = options?.factories ?? [];
  const disabled = new Set(options?.disabled ?? []);
  const buildables = [airportBuildable(), fighterBuildable()];
  let hostileFriendly = false;
  const hostile = {
    borderTiles: async () => ({ borderTiles: new Set([345]) }),
    displayName: () => "Hostile command",
    id: () => "HOSTILE1",
    isDisconnected: () => false,
    isFriendly: () => hostileFriendly,
    isAlive: () => true,
    isPlayer: () => true,
    type: () => PlayerType.Human,
  };
  const player = {
    buildables: async () => buildables,
    completedUnitCount: () => 0,
    gold: () => options?.gold ?? 1_000_000n,
    isFriendly: () => false,
    totalUnitLevels: () => 0,
    units: (type: UnitType) => {
      if (type === UnitType.Airport) return airports;
      if (type === UnitType.FighterJet) return fighters;
      if (type === UnitType.Factory) return factories;
      return [];
    },
  };
  const config = {
    airportOperationsV1Enabled: () => true,
    airSuperiorityV1Enabled: () => true,
    combinedArmsV2Enabled: () => true,
    depthProgressionEnabled: () => false,
    effectivePortLevels: () => 0,
    fighterLaunchCooldown: () => 100,
    fighterMaxActive: () => 2,
    isUnitDisabled: (type: UnitType) => disabled.has(type),
  };
  const game = {
    config: () => config,
    isImpassable: () => false,
    isLand: () => true,
    isValidRef: () => true,
    isNationSpawnImmunityActive: () => false,
    isSpawnImmunityActive: () => options?.spawnShield ?? false,
    myPlayer: () => player,
    owner: () => hostile,
    players: () => [hostile],
    ticks: () => 200,
    units: (type: UnitType) => (type === UnitType.FighterJet ? fighters : []),
    x: (tile: number) => tile % 100,
    y: (tile: number) => Math.floor(tile / 100),
  } as unknown as GameView;
  const menu = new BuildMenu();
  menu.eventBus = new EventBus();
  menu.game = game;
  menu.uiState = {
    attackRatio: 0.5,
    ghostStructure: null,
    rocketDirectionUp: true,
    upgradeMultiplier: 1,
  };
  menu.playerBuildables = buildables;
  Object.assign(menu, { _hidden: false, clickedTile: 23 });
  return {
    buildables,
    menu,
    setHostileFriendly: (friendly: boolean) => {
      hostileFriendly = friendly;
    },
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("Airport Build Menu contract", () => {
  it("shows each physical Airport's occupancy, including prior-owner jets", async () => {
    const { menu } = setup({
      airports: [airport(41), airport(77)],
      fighters: [fighter(41), fighter(41), fighter(77)],
    });
    document.body.append(menu);
    await menu.updateComplete;

    expect(
      menu.shadowRoot
        ?.querySelector<HTMLElement>("[data-airport-capacity]")
        ?.getAttribute("data-airport-slots"),
    ).toBe("2/100 · 1/100");
  });

  it.each([
    ["airport_required", { airports: [], factories: [{}] }],
    ["airport_building", { airports: [airport(41, { building: true })] }],
    [
      "airport_full",
      {
        airports: [airport(41)],
        fighters: Array.from({ length: AIRPORT_FIGHTER_CAPACITY }, () =>
          fighter(41),
        ),
      },
    ],
    [
      "airport_cooldown",
      {
        airports: [
          airport(41, {
            queue: Array.from(
              { length: AIRPORT_FIGHTER_CAPACITY },
              (_, index) => 150 + index,
            ),
          }),
        ],
      },
    ],
    ["insufficient_gold", { gold: 0n }],
    ["spawn_immunity", { spawnShield: true }],
    ["unavailable", { disabled: [UnitType.FighterJet] }],
  ] as const)(
    "reports %s from current Airport state",
    async (state, options) => {
      const { menu } = setup(options);
      Object.assign(menu, { fighterMissionPicker: true });
      document.body.append(menu);
      await menu.updateComplete;

      expect(
        menu.shadowRoot?.querySelector<HTMLElement>("[data-fighter-status]")
          ?.dataset.fighterStatus,
      ).toBe(state);
    },
  );

  it("derives the full legal Airport amount without an arbitrary UI cap", async () => {
    const airports = Array.from({ length: 34 }, (_, index) =>
      airport(index + 1),
    );
    const { menu } = setup({ airports, gold: 1_000_000_000n });
    Object.assign(menu, { fighterMissionPicker: true });
    document.body.append(menu);
    await menu.updateComplete;

    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(".fighter-mission-button")
      ?.click();
    await menu.updateComplete;
    // The patrol role asks for the airframe before the quantity.
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-patrol-aircraft="f16"]')
      ?.click();
    await menu.updateComplete;

    expect(
      menu.shadowRoot
        ?.querySelector<HTMLElement>("[data-quantity-maximum]")
        ?.getAttribute("data-quantity-maximum"),
    ).toBe("100");
    const presets = [
      ...(menu.shadowRoot?.querySelectorAll<HTMLElement>(
        "[data-quantity-preset]",
      ) ?? []),
    ].map((button) => button.dataset.quantityPreset);
    expect(presets).toEqual(["1", "2", "3", "5", "10", "max"]);
  });

  it("uses one Airport flow for model, 1/2/3/X quantity, target, and launch", async () => {
    const { menu } = setup({
      airports: [airport(41), airport(77)],
      gold: 1_000_000_000n,
    });
    const emitted: LaunchAirMissionIntentEvent[] = [];
    menu.eventBus.on(LaunchAirMissionIntentEvent, (event) =>
      emitted.push(event),
    );
    document.body.append(menu);
    menu.showAirportLaunch(41, 41, fighterBuildable());
    await menu.updateComplete;

    expect(
      menu.shadowRoot
        ?.querySelector("[data-airport-launcher]")
        ?.getAttribute("aria-modal"),
    ).toBe("false");

    expect(
      [
        ...(menu.shadowRoot?.querySelectorAll<HTMLElement>(
          "[data-aircraft-type]",
        ) ?? []),
      ].map((button) => button.dataset.aircraftType),
    ).toEqual([...PATROL_AIRCRAFT_TYPES]);
    expect(
      [
        ...(menu.shadowRoot?.querySelectorAll<HTMLElement>(
          "[data-airport-quantity]",
        ) ?? []),
      ].map((button) => button.dataset.airportQuantity),
    ).toEqual(["1", "2", "3", "5", "10", "custom"]);
    expect(
      menu.shadowRoot?.querySelector("[data-airport-custom-quantity]"),
    ).toBeNull();

    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(
        `[data-aircraft-type="${AircraftType.F35}"]`,
      )
      ?.click();
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-airport-quantity="custom"]')
      ?.click();
    await menu.updateComplete;
    const input = menu.shadowRoot?.querySelector<HTMLInputElement>(
      "[data-airport-custom-quantity]",
    );
    expect(input).not.toBeNull();
    input!.value = "5";
    input!.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await menu.updateComplete;

    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>("[data-airport-target]")
      ?.click();
    expect(menu.isChoosingAirportTarget).toBe(true);
    expect(menu.uiState.airportTargetSelectionActive).toBe(true);
    expect(menu.chooseAirportTarget(345)).toBe(true);
    await menu.updateComplete;

    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>("[data-airport-launch]")
      ?.click();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].amount).toBe(5);
    expect(emitted[0].order).toEqual({
      mission: AirMissionType.PrecisionStrike,
      targetTile: 345,
      aircraftType: AircraftType.F35,
    });
    expect(menu.isVisible).toBe(false);
  });

  it("revalidates a selected target before emitting the launch intent", async () => {
    const { menu, setHostileFriendly } = setup({
      airports: [airport(41)],
      gold: 1_000_000_000n,
    });
    const emitted: LaunchAirMissionIntentEvent[] = [];
    menu.eventBus.on(LaunchAirMissionIntentEvent, (event) =>
      emitted.push(event),
    );
    document.body.append(menu);
    menu.showAirportLaunch(41, 41, fighterBuildable());
    await menu.updateComplete;

    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>("[data-airport-target]")
      ?.click();
    expect(menu.chooseAirportTarget(345)).toBe(true);
    setHostileFriendly(true);
    await menu.updateComplete;

    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>("[data-airport-launch]")
      ?.click();
    await menu.updateComplete;

    expect(emitted).toHaveLength(0);
    expect(menu.isVisible).toBe(true);
    expect(
      menu.shadowRoot?.querySelector(".airport-target-error"),
    ).not.toBeNull();
  });

  it("offers a focusable keyboard target path inside the non-modal drawer", async () => {
    const { menu } = setup({
      airports: [airport(41)],
      gold: 1_000_000_000n,
    });
    document.body.append(menu);
    menu.showAirportLaunch(41, 41, fighterBuildable());
    await menu.updateComplete;

    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>("[data-airport-target]")
      ?.click();
    await vi.waitFor(() => {
      expect(
        menu.shadowRoot?.querySelector("[data-airport-keyboard-target]"),
      ).not.toBeNull();
    });
    const keyboardTarget = menu.shadowRoot?.querySelector<HTMLButtonElement>(
      "[data-airport-keyboard-target]",
    );
    expect(keyboardTarget).not.toBeNull();
    keyboardTarget?.focus();
    keyboardTarget?.click();
    await menu.updateComplete;

    expect(menu.isChoosingAirportTarget).toBe(false);
    expect(
      menu.shadowRoot
        ?.querySelector("[data-airport-launch]")
        ?.hasAttribute("disabled"),
    ).toBe(false);
    expect(menu.shadowRoot?.activeElement).toBe(
      menu.shadowRoot?.querySelector("[data-airport-launch]"),
    );
  });

  it("rejects invalid custom quantities without rounding or clamping them", async () => {
    const { menu } = setup({
      airports: [airport(41)],
      gold: 1_000_000_000n,
    });
    document.body.append(menu);
    menu.showAirportLaunch(41, 41, fighterBuildable());
    await menu.updateComplete;
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-airport-quantity="custom"]')
      ?.click();
    await menu.updateComplete;

    for (const rawValue of ["1.5", "0", "101", "150", "1e2", ""]) {
      const input = menu.shadowRoot?.querySelector<HTMLInputElement>(
        "[data-airport-custom-quantity]",
      );
      expect(input).not.toBeNull();
      input!.value = rawValue;
      input!.dispatchEvent(new InputEvent("input", { bubbles: true }));
      await menu.updateComplete;

      const renderedInput = menu.shadowRoot?.querySelector<HTMLInputElement>(
        "[data-airport-custom-quantity]",
      );
      expect(renderedInput?.value).toBe(rawValue);
      expect(renderedInput?.getAttribute("aria-invalid")).toBe("true");
      expect(
        menu.shadowRoot?.querySelector("#airport-custom-quantity-error"),
      ).not.toBeNull();
    }

    const input = menu.shadowRoot?.querySelector<HTMLInputElement>(
      "[data-airport-custom-quantity]",
    );
    input!.value = "2";
    input!.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await menu.updateComplete;
    expect(input?.getAttribute("aria-invalid")).toBe("false");
    expect(
      menu.shadowRoot?.querySelector("#airport-custom-quantity-error"),
    ).toBeNull();
  });

  it("keeps disabled Airport and Fighter cards visible with a reason", async () => {
    const { menu } = setup({
      airports: [],
      disabled: [UnitType.Airport, UnitType.FighterJet],
    });
    menu.playerBuildables = [
      airportBuildable(false),
      {
        ...fighterBuildable(),
        canBuild: false,
      },
    ];
    Object.assign(menu, {
      filteredBuildTable: (
        menu as never as { getBuildableUnits(): unknown }
      ).getBuildableUnits(),
    });
    document.body.append(menu);
    await menu.updateComplete;

    const buttons = [
      ...(menu.shadowRoot?.querySelectorAll<HTMLButtonElement>(
        '.build-button[aria-disabled="true"]',
      ) ?? []),
    ];
    expect(buttons.map((button) => button.querySelector("img")?.alt)).toEqual(
      expect.arrayContaining([UnitType.Airport, UnitType.FighterJet]),
    );
    expect(
      buttons.every((button) => button.getAttribute("aria-describedby")),
    ).toBe(true);
  });
});
