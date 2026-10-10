import { afterEach, describe, expect, it, vi } from "vitest";
import { BuildMenu } from "../../src/client/hud/layers/BuildMenu";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import { StrikeTargetClass } from "../../src/core/game/Game";

function menuWithGame() {
  const menu = new BuildMenu();
  menu.game = {
    config: () => ({
      airportOperationsV1Enabled: () => true,
      airSuperiorityV1Enabled: () => true,
      combinedArmsV2Enabled: () => true,
      depthProgressionEnabled: () => false,
      effectivePortLevels: () => 0,
    }),
    isSpawnImmunityActive: () => false,
    myPlayer: () => ({ gold: () => 0n }),
    ticks: () => 1,
  } as unknown as GameView;
  menu.eventBus = new EventBus();
  document.body.append(menu);
  return menu;
}

afterEach(() => document.body.replaceChildren());

describe("Jet Attack strike plan chips", () => {
  it("lists every plan with counts, keeps empty classes inert and reports the choice", async () => {
    const menu = menuWithGame();
    const onConfirm = vi.fn();
    menu.requestQuantity({
      kind: "fighter",
      itemName: "Jet Attack",
      max: 5,
      sharedTarget: true,
      strikeTargets: [
        { id: StrikeTargetClass.Tile, count: 1 },
        { id: StrikeTargetClass.Factories, count: 2 },
        { id: StrikeTargetClass.Ports, count: 0 },
      ],
      totalCost: () => 0n,
      onConfirm,
    });
    await menu.updateComplete;

    const chips = [
      ...(menu.shadowRoot?.querySelectorAll<HTMLButtonElement>(
        "[data-strike-target]",
      ) ?? []),
    ];
    expect(chips.map((chip) => chip.dataset.strikeTarget)).toEqual([
      "tile",
      "factories",
      "ports",
    ]);
    expect(chips.map((chip) => chip.getAttribute("aria-pressed"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    expect(chips.map((chip) => chip.disabled)).toEqual([false, false, true]);
    expect(chips[1].textContent).toContain("2");
    expect(chips[2].title).toBe("build_menu.quantity.strike_target_empty");
    expect(
      menu.shadowRoot?.querySelector(".quantity-placement-note")?.textContent,
    ).toContain("build_menu.quantity.shared_fighter_target");

    chips[2].click();
    await menu.updateComplete;
    expect(
      menu.shadowRoot?.querySelector<HTMLElement>(".strike-target-grid")
        ?.dataset.strikeTargetSelected,
    ).toBe("tile");

    chips[1].click();
    await menu.updateComplete;
    expect(
      menu.shadowRoot?.querySelector<HTMLElement>(".strike-target-grid")
        ?.dataset.strikeTargetSelected,
    ).toBe("factories");
    expect(
      menu.shadowRoot?.querySelector(".quantity-placement-note")?.textContent,
    ).toContain("build_menu.quantity.strike_plan_note");

    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-quantity-preset="3"]')
      ?.click();
    await menu.updateComplete;
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(".quantity-action.confirm")
      ?.click();
    expect(onConfirm).toHaveBeenCalledWith(3, [StrikeTargetClass.Factories]);
  });

  it("renders no chips and reports no plan for requests without strike targets", async () => {
    const menu = menuWithGame();
    const onConfirm = vi.fn();
    menu.requestQuantity({
      kind: "fighter",
      itemName: "Jet Attack",
      max: 2,
      sharedTarget: true,
      totalCost: () => 0n,
      onConfirm,
    });
    await menu.updateComplete;
    expect(menu.shadowRoot?.querySelector("[data-strike-target]")).toBeNull();
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(".quantity-action.confirm")
      ?.click();
    expect(onConfirm).toHaveBeenCalledWith(1);
    expect(onConfirm.mock.calls[0]).toHaveLength(1);
  });

  it("combines several plans, shows the equal split, and keeps the tile and All alone", async () => {
    const menu = menuWithGame();
    const onConfirm = vi.fn();
    menu.requestQuantity({
      kind: "fighter",
      itemName: "Jet Attack",
      max: 46,
      initial: 46,
      sharedTarget: true,
      strikeTargets: [
        { id: StrikeTargetClass.Tile, count: 1 },
        { id: StrikeTargetClass.AirDefense, count: 6 },
        { id: StrikeTargetClass.MissileSilos, count: 6 },
        { id: StrikeTargetClass.Cities, count: 3 },
        { id: StrikeTargetClass.AllStructures, count: 15 },
      ],
      totalCost: () => 0n,
      onConfirm,
    });
    await menu.updateComplete;
    const chip = (id: string) =>
      menu.shadowRoot!.querySelector<HTMLButtonElement>(
        `[data-strike-target="${id}"]`,
      )!;
    const selected = () =>
      menu.shadowRoot?.querySelector<HTMLElement>(".strike-target-grid")
        ?.dataset.strikeTargetSelected;
    const note = () =>
      menu.shadowRoot?.querySelector("[data-strike-plan-note]")?.textContent;

    // Clicking silos first, then air defense: canonical order either way.
    chip("missile_silos").click();
    await menu.updateComplete;
    chip("air_defense").click();
    await menu.updateComplete;
    expect(selected()).toBe("air_defense,missile_silos");
    expect(chip("tile").getAttribute("aria-pressed")).toBe("false");
    expect(chip("air_defense").getAttribute("aria-pressed")).toBe("true");
    expect(chip("missile_silos").getAttribute("aria-pressed")).toBe("true");
    expect(note()).toContain("build_menu.quantity.strike_plan_split");

    // Unselecting one class keeps the other; unselecting the last falls
    // back to the tile.
    chip("missile_silos").click();
    await menu.updateComplete;
    expect(selected()).toBe("air_defense");
    chip("air_defense").click();
    await menu.updateComplete;
    expect(selected()).toBe("tile");

    // All replaces the classes; a class replaces All.
    chip("cities").click();
    await menu.updateComplete;
    chip("all_structures").click();
    await menu.updateComplete;
    expect(selected()).toBe("all_structures");
    chip("air_defense").click();
    await menu.updateComplete;
    chip("missile_silos").click();
    await menu.updateComplete;
    expect(selected()).toBe("air_defense,missile_silos");

    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(".quantity-action.confirm")
      ?.click();
    expect(onConfirm).toHaveBeenCalledWith(46, [
      StrikeTargetClass.AirDefense,
      StrikeTargetClass.MissileSilos,
    ]);
  });

  it("resets the plan to the tile for every new request", async () => {
    const menu = menuWithGame();
    const first = vi.fn();
    const strikeTargets = [
      { id: StrikeTargetClass.Tile, count: 1 },
      { id: StrikeTargetClass.Cities, count: 4 },
    ];
    menu.requestQuantity({
      kind: "fighter",
      itemName: "Jet Attack",
      max: 4,
      sharedTarget: true,
      strikeTargets,
      totalCost: () => 0n,
      onConfirm: first,
    });
    await menu.updateComplete;
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-strike-target="cities"]')
      ?.click();
    await menu.updateComplete;
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(".quantity-action.confirm")
      ?.click();
    expect(first).toHaveBeenCalledWith(1, [StrikeTargetClass.Cities]);

    const second = vi.fn();
    menu.requestQuantity({
      kind: "fighter",
      itemName: "Jet Attack",
      max: 4,
      sharedTarget: true,
      strikeTargets,
      totalCost: () => 0n,
      onConfirm: second,
    });
    await menu.updateComplete;
    expect(
      menu.shadowRoot?.querySelector<HTMLElement>(".strike-target-grid")
        ?.dataset.strikeTargetSelected,
    ).toBe("tile");
  });
});
