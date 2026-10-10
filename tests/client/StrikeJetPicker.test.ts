import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CommandQuantityRequest,
  StrikeJetChoice,
} from "../../src/client/CommandQuantity";
import { BuildMenu } from "../../src/client/hud/layers/BuildMenu";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import { AircraftType, StrikeTargetClass } from "../../src/core/game/Game";

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

const jets: StrikeJetChoice[] = [
  {
    id: 12,
    aircraftType: AircraftType.B2,
    distance: 8,
    health: 900,
    maxHealth: 900,
  },
  { id: 7, aircraftType: undefined, distance: 20, health: 150, maxHealth: 300 },
  {
    id: 31,
    aircraftType: AircraftType.F16,
    distance: 41,
    health: 300,
    maxHealth: 300,
  },
];

function openPicker(
  menu: BuildMenu,
  onConfirm: CommandQuantityRequest["onConfirm"],
) {
  menu.requestQuantity({
    kind: "fighter",
    itemName: "Jet Attack",
    max: jets.length,
    sharedTarget: true,
    strikeTargets: [
      { id: StrikeTargetClass.Tile, count: 1 },
      { id: StrikeTargetClass.Factories, count: 2 },
    ],
    jets,
    totalCost: () => 0n,
    onConfirm,
  });
}

afterEach(() => document.body.replaceChildren());

describe("Jet Attack jet picker", () => {
  it("lists every airborne jet nearest first, all chosen, and reports the chosen IDs", async () => {
    const menu = menuWithGame();
    const onConfirm = vi.fn();
    openPicker(menu, onConfirm);
    await menu.updateComplete;

    expect(menu.shadowRoot?.querySelector(".quantity-input")).toBeNull();
    expect(menu.shadowRoot?.querySelector("[data-quantity-preset]")).toBeNull();
    const rows = [
      ...(menu.shadowRoot?.querySelectorAll<HTMLButtonElement>(
        "[data-strike-jet]",
      ) ?? []),
    ];
    expect(rows.map((row) => row.dataset.strikeJet)).toEqual(["12", "7", "31"]);
    expect(rows.map((row) => row.getAttribute("aria-pressed"))).toEqual([
      "true",
      "true",
      "true",
    ]);
    expect(rows.map((row) => row.dataset.strikeJetAirframe)).toEqual([
      "b2",
      "f16",
      "f16",
    ]);
    expect(rows[0].textContent).toContain("build_menu.quantity.jet_name");
    expect(rows[0].textContent).toContain("build_menu.quantity.jet_distance");
    expect(rows[0].textContent).toContain("build_menu.quantity.jet_hull");
    expect(
      menu.shadowRoot?.querySelector<HTMLElement>("[data-strike-jets-selected]")
        ?.dataset.strikeJetsSelected,
    ).toBe("3");
    const confirm = menu.shadowRoot?.querySelector<HTMLButtonElement>(
      ".quantity-action.confirm",
    );
    expect(confirm?.disabled).toBe(false);
    expect(confirm?.textContent).toContain("build_menu.quantity.confirm_jets");

    rows[1].click();
    await menu.updateComplete;
    expect(rows[1].getAttribute("aria-pressed")).toBe("false");
    expect(
      menu.shadowRoot?.querySelector<HTMLElement>("[data-strike-jets-selected]")
        ?.dataset.strikeJetsSelected,
    ).toBe("2");

    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-strike-target="factories"]')
      ?.click();
    await menu.updateComplete;
    confirm?.click();
    expect(onConfirm).toHaveBeenCalledWith(
      2,
      [StrikeTargetClass.Factories],
      [12, 31],
    );
    expect(menu.isVisible).toBe(false);
  });

  it("offers All / None, refuses an empty selection and confirms with Enter", async () => {
    const menu = menuWithGame();
    const onConfirm = vi.fn();
    openPicker(menu, onConfirm);
    await menu.updateComplete;

    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-strike-jets="none"]')
      ?.click();
    await menu.updateComplete;
    const confirm = menu.shadowRoot?.querySelector<HTMLButtonElement>(
      ".quantity-action.confirm",
    );
    expect(confirm?.disabled).toBe(true);
    expect(menu.shadowRoot?.textContent).toContain(
      "build_menu.quantity.jets_none_selected",
    );
    confirm?.click();
    expect(onConfirm).not.toHaveBeenCalled();

    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-strike-jet="31"]')
      ?.click();
    await menu.updateComplete;
    expect(confirm?.disabled).toBe(false);
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-strike-jets="all"]')
      ?.click();
    await menu.updateComplete;
    expect(
      [
        ...(menu.shadowRoot?.querySelectorAll<HTMLElement>(
          "[data-strike-jet]",
        ) ?? []),
      ].map((row) => row.getAttribute("aria-pressed")),
    ).toEqual(["true", "true", "true"]);

    menu.shadowRoot
      ?.querySelector<HTMLElement>(".quantity-dialog")
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    expect(onConfirm).toHaveBeenCalledWith(
      3,
      [StrikeTargetClass.Tile],
      [12, 7, 31],
    );
  });

  it("keeps the numeric flow for requests without jets", async () => {
    const menu = menuWithGame();
    const onConfirm = vi.fn();
    menu.requestQuantity({
      kind: "fighter",
      itemName: "Attack",
      max: 2,
      sharedTarget: true,
      totalCost: () => 0n,
      onConfirm,
    });
    await menu.updateComplete;
    expect(menu.shadowRoot?.querySelector(".quantity-input")).not.toBeNull();
    expect(menu.shadowRoot?.querySelector("[data-strike-jet]")).toBeNull();
    menu.shadowRoot
      ?.querySelector<HTMLButtonElement>(".quantity-action.confirm")
      ?.click();
    expect(onConfirm).toHaveBeenCalledWith(1);
  });
});
