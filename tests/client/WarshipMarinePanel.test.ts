import { afterEach, describe, expect, it, vi } from "vitest";
import { WarshipMarinePanel } from "../../src/client/hud/layers/WarshipMarinePanel";
import type { GameView, UnitView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import { UnitType } from "../../src/core/game/Game";

describe("WarshipMarinePanel lifecycle", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("renders safely before the game controller dependency is injected", async () => {
    const panel = new WarshipMarinePanel();

    document.body.append(panel);

    await expect(panel.updateComplete).resolves.toBe(true);
    expect(panel.querySelector("[data-warship-marine-panel]")).toBeNull();
  });

  it("keeps unavailable cargo choices focusable, described, and inert", async () => {
    const warship = {
      id: () => 7,
      isActive: () => true,
      troops: () => 0,
      type: () => UnitType.Warship,
      veterancy: () => 0,
    } as unknown as UnitView;
    const game = {
      config: () => ({ depthProgressionEnabled: () => true }),
      myPlayer: () => null,
      unit: () => warship,
    } as unknown as GameView;
    const eventBus = new EventBus();
    const emit = vi.spyOn(eventBus, "emit");
    const panel = new WarshipMarinePanel();
    Object.assign(panel, { eventBus, game, selectedUnitId: 7 });

    document.body.append(panel);
    await panel.updateComplete;

    const button = panel.querySelector<HTMLButtonElement>(
      '[data-cargo-target="0"]',
    );
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(false);
    expect(button?.getAttribute("aria-disabled")).toBe("true");
    expect(
      document.getElementById(button?.getAttribute("aria-describedby") ?? ""),
    ).not.toBeNull();

    button?.focus();
    expect(document.activeElement).toBe(button);
    button?.click();
    expect(emit).not.toHaveBeenCalled();
  });
});
