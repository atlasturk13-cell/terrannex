import { afterEach, describe, expect, it } from "vitest";
import { RequestStructurePlacementEvent } from "../../src/client/CommandQuantity";
import { BuildMenu } from "../../src/client/hud/layers/BuildMenu";
import { BuildUnitIntentEvent } from "../../src/client/Transport";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import {
  AirDefenseSystem,
  BuildableUnit,
  UnitType,
} from "../../src/core/game/Game";

function samBuildable(): BuildableUnit {
  return {
    canBuild: 0,
    canUpgrade: false,
    cost: 1_500_000n,
    freshBuildCosts: [1_500_000n, 4_500_000n, 7_500_000n],
    ghostRailPaths: [],
    overlappingRailroads: [],
    type: UnitType.SAMLauncher,
  };
}

function samMenu(gold: bigint, airportProfile = true) {
  const eventBus = new EventBus();
  const placements: RequestStructurePlacementEvent[] = [];
  const intents: BuildUnitIntentEvent[] = [];
  eventBus.on(RequestStructurePlacementEvent, (event) =>
    placements.push(event),
  );
  eventBus.on(BuildUnitIntentEvent, (event) => intents.push(event));
  const menu = new BuildMenu();
  menu.game = {
    config: () => ({
      airportOperationsV1Enabled: () => airportProfile,
      airSuperiorityV1Enabled: () => airportProfile,
      combinedArmsV2Enabled: () => true,
      depthProgressionEnabled: () => false,
      effectivePortLevels: () => 0,
    }),
    isSpawnImmunityActive: () => false,
    myPlayer: () => ({
      completedUnitCount: () => 0,
      gold: () => gold,
      totalUnitLevels: () => 0,
      units: () => [],
    }),
    ticks: () => 1,
  } as unknown as GameView;
  menu.eventBus = eventBus;
  menu.uiState = {
    ghostStructure: null,
    rocketDirectionUp: true,
    upgradeMultiplier: 1,
  } as never;
  menu.playerBuildables = [samBuildable()];
  Object.assign(menu, { _hidden: false, clickedTile: 0 });
  document.body.append(menu);
  return { menu, placements, intents };
}

function ids(menu: BuildMenu, selector: string, key: string): string[] {
  return [
    ...(menu.shadowRoot?.querySelectorAll<HTMLElement>(selector) ?? []),
  ].map((element) => element.dataset[key] ?? "");
}

afterEach(() => document.body.replaceChildren());

describe("Air Defense picker", () => {
  it("asks short or long range, then lists that class's systems with prices, and queues the choice", async () => {
    const { menu, placements, intents } = samMenu(2_500_000n);
    await menu.updateComplete;

    menu.sendBuildOrUpgrade(samBuildable(), 0);
    await menu.updateComplete;
    expect(menu.shadowRoot?.querySelector(".quantity-dialog")).toBeNull();
    expect(ids(menu, "[data-air-defense-range]", "airDefenseRange")).toEqual([
      "short",
      "long",
    ]);
    expect(menu.shadowRoot?.textContent).toContain(
      "build_menu.air_defense.range_hint",
    );

    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-air-defense-range="short"]')
      ?.click();
    await menu.updateComplete;
    expect(ids(menu, "[data-air-defense-system]", "airDefenseSystem")).toEqual([
      "pantsir_s1",
      "iron_dome",
      "hisar_o",
      "davids_sling",
    ]);
    expect(menu.shadowRoot?.textContent).toContain(
      "build_menu.air_defense.system.iron_dome.name",
    );
    expect(menu.shadowRoot?.textContent).toContain(
      "build_menu.air_defense.stats",
    );

    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>("[data-air-defense-back]")
      ?.click();
    await menu.updateComplete;
    expect(menu.shadowRoot?.querySelector("[data-air-defense-system]")).toBe(
      null,
    );
    expect(ids(menu, "[data-air-defense-range]", "airDefenseRange")).toEqual([
      "short",
      "long",
    ]);

    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-air-defense-range="long"]')
      ?.click();
    await menu.updateComplete;
    expect(ids(menu, "[data-air-defense-system]", "airDefenseSystem")).toEqual([
      "patriot",
      "siper",
      "s400",
      "s500",
    ]);
    const s500 = menu.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-air-defense-system="s500"]',
    );
    const s400 = menu.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-air-defense-system="s400"]',
    );
    // 2,500,000 gold: the S-400 (×1.5 = 2,250,000) is affordable, the S-500
    // (×2 = 3,000,000) is shown inert with a reason.
    expect(s500?.getAttribute("aria-disabled")).toBe("true");
    expect(s500?.title).toBe("build_menu.air_defense.unaffordable");
    expect(s500?.textContent).toContain("build_menu.air_defense.stealth");
    expect(s400?.getAttribute("aria-disabled")).toBe("false");
    expect(s400?.textContent).not.toContain("build_menu.air_defense.stealth");

    s500?.click();
    await menu.updateComplete;
    expect(menu.shadowRoot?.querySelector(".quantity-dialog")).toBeNull();
    expect(
      menu.shadowRoot?.querySelectorAll("[data-air-defense-system]"),
    ).toHaveLength(4);

    s400?.click();
    await menu.updateComplete;
    await Promise.resolve();
    const dialog = menu.shadowRoot?.querySelector<HTMLElement>(
      '[role="dialog"][data-quantity-kind="construction"]',
    );
    expect(dialog).not.toBeNull();
    // The dialog is titled with the system, not the generic launcher name.
    expect(
      (menu as unknown as { quantityRequest: { itemName: string } })
        .quantityRequest.itemName,
    ).toBe("build_menu.air_defense.system.s400.name");
    // Priced at ×1.5 the second copy would cost 6,750,000 in total: only one.
    expect(
      menu.shadowRoot?.querySelector<HTMLInputElement>(".quantity-input")?.max,
    ).toBe("1");

    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(".quantity-action.confirm")
      ?.click();
    expect(intents).toHaveLength(0);
    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({
      targetTile: 0,
      unitType: UnitType.SAMLauncher,
    });
    expect(menu.uiState.structurePlacementQueue).toMatchObject({
      airDefenseSystem: AirDefenseSystem.S400,
      remaining: 1,
      unitType: UnitType.SAMLauncher,
    });
    expect(menu.uiState.ghostStructure).toBe(UnitType.SAMLauncher);
  });

  it("skips the picker outside the Airport profile and queues a baseline launcher", async () => {
    const { menu, placements } = samMenu(10_000_000n, false);
    await menu.updateComplete;

    menu.sendBuildOrUpgrade(samBuildable(), 0);
    await menu.updateComplete;
    await Promise.resolve();
    expect(menu.shadowRoot?.querySelector("[data-air-defense-range]")).toBe(
      null,
    );
    expect(
      menu.shadowRoot?.querySelector(
        '[role="dialog"][data-quantity-kind="construction"]',
      ),
    ).not.toBeNull();
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(".quantity-action.confirm")
      ?.click();
    expect(placements).toHaveLength(1);
    expect(menu.uiState.structurePlacementQueue?.airDefenseSystem).toBe(
      undefined,
    );
  });

  it("leaves the picker on Back from the range step and on hideMenu", async () => {
    const { menu } = samMenu(10_000_000n);
    await menu.updateComplete;
    menu.sendBuildOrUpgrade(samBuildable(), 0);
    await menu.updateComplete;
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>("[data-air-defense-back]")
      ?.click();
    await menu.updateComplete;
    expect(menu.shadowRoot?.querySelector("[data-air-defense-range]")).toBe(
      null,
    );
    expect(menu.shadowRoot?.querySelector(".build-button")).not.toBeNull();

    menu.sendBuildOrUpgrade(samBuildable(), 0);
    await menu.updateComplete;
    expect(
      menu.shadowRoot?.querySelector("[data-air-defense-range]"),
    ).not.toBeNull();
    menu.hideMenu();
    await menu.updateComplete;
    Object.assign(menu, { _hidden: false });
    menu.requestUpdate();
    await menu.updateComplete;
    expect(menu.shadowRoot?.querySelector("[data-air-defense-range]")).toBe(
      null,
    );
  });
});

describe("Air Defense picker from the radial menu (hidden panel)", () => {
  function hiddenMenu(gold = 10_000_000n) {
    const built = samMenu(gold);
    Object.assign(built.menu, { _hidden: true });
    built.menu.requestUpdate();
    return built;
  }
  const isHidden = (menu: BuildMenu) =>
    menu.shadowRoot
      ?.querySelector(".build-menu")
      ?.classList.contains("hidden") === true;

  it("shows the picker on a hidden panel and Back returns to the map", async () => {
    const { menu } = hiddenMenu();
    await menu.updateComplete;
    expect(isHidden(menu)).toBe(true);

    menu.sendBuildOrUpgrade(samBuildable(), 0);
    await menu.updateComplete;
    expect(isHidden(menu)).toBe(false);
    expect(ids(menu, "[data-air-defense-range]", "airDefenseRange")).toEqual([
      "short",
      "long",
    ]);

    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-air-defense-range="short"]')
      ?.click();
    await menu.updateComplete;
    expect(
      menu.shadowRoot?.querySelectorAll("[data-air-defense-system]"),
    ).toHaveLength(4);
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>("[data-air-defense-back]")
      ?.click();
    await menu.updateComplete;
    expect(isHidden(menu)).toBe(false);
    expect(ids(menu, "[data-air-defense-range]", "airDefenseRange")).toEqual([
      "short",
      "long",
    ]);
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>("[data-air-defense-back]")
      ?.click();
    await menu.updateComplete;
    expect(isHidden(menu)).toBe(true);
    expect(menu.shadowRoot?.querySelector("[data-air-defense-range]")).toBe(
      null,
    );
    expect(menu.uiState.structurePlacementQueue).toBeUndefined();
  });

  it("returns to the map when the quantity dialog it opened is cancelled, and arms the queue on confirm", async () => {
    const { menu, placements } = hiddenMenu();
    await menu.updateComplete;
    menu.sendBuildOrUpgrade(samBuildable(), 0);
    await menu.updateComplete;
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-air-defense-range="short"]')
      ?.click();
    await menu.updateComplete;
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(
        '[data-air-defense-system="pantsir_s1"]',
      )
      ?.click();
    await menu.updateComplete;
    await Promise.resolve();
    expect(isHidden(menu)).toBe(false);
    expect(
      menu.shadowRoot?.querySelector(
        '[role="dialog"][data-quantity-kind="construction"]',
      ),
    ).not.toBeNull();

    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(".quantity-action.cancel")
      ?.click();
    await menu.updateComplete;
    expect(isHidden(menu)).toBe(true);
    expect(menu.shadowRoot?.querySelector("[data-air-defense-range]")).toBe(
      null,
    );
    expect(menu.uiState.structurePlacementQueue).toBeUndefined();
    expect(placements).toHaveLength(0);

    menu.sendBuildOrUpgrade(samBuildable(), 0);
    await menu.updateComplete;
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-air-defense-range="short"]')
      ?.click();
    await menu.updateComplete;
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(
        '[data-air-defense-system="pantsir_s1"]',
      )
      ?.click();
    await menu.updateComplete;
    await Promise.resolve();
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(".quantity-action.confirm")
      ?.click();
    await menu.updateComplete;
    expect(placements).toHaveLength(1);
    expect(menu.uiState.structurePlacementQueue).toMatchObject({
      airDefenseSystem: AirDefenseSystem.PantsirS1,
      remaining: 1,
      unitType: UnitType.SAMLauncher,
    });
    expect(isHidden(menu)).toBe(true);
  });

  it("keeps the build table as the return screen when opened from the panel", async () => {
    const { menu } = samMenu(10_000_000n);
    await menu.updateComplete;
    menu.sendBuildOrUpgrade(samBuildable(), 0);
    await menu.updateComplete;
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-air-defense-range="long"]')
      ?.click();
    await menu.updateComplete;
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-air-defense-system="patriot"]')
      ?.click();
    await menu.updateComplete;
    await Promise.resolve();
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(".quantity-action.cancel")
      ?.click();
    await menu.updateComplete;
    expect(isHidden(menu)).toBe(false);
    expect(menu.shadowRoot?.querySelector(".build-button")).not.toBeNull();
    expect(menu.shadowRoot?.querySelector("[data-air-defense-range]")).toBe(
      null,
    );
  });
});
