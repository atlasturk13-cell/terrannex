import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FluentSlider } from "../../src/client/components/FluentSlider";
import type { GameConfigSettings } from "../../src/client/components/GameConfigSettings";
import type { MapPicker } from "../../src/client/components/map/MapPicker";
import type { ToggleInputCard } from "../../src/client/components/ToggleInputCard";
import { SinglePlayerModal } from "../../src/client/SinglePlayerModal";

class DormantIntersectionObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];
}

function referencedElement(
  control: Element,
  attribute: "aria-labelledby" | "aria-describedby",
): HTMLElement {
  const reference = control.getAttribute(attribute);
  expect(
    reference,
    `${attribute} missing on ${control.outerHTML}`,
  ).toBeTruthy();

  const ids = reference!.split(/\s+/).filter(Boolean);
  const elements = ids.map((id) => document.getElementById(id));
  expect(elements.every((element) => element !== null)).toBe(true);
  return elements[elements.length - 1]!;
}

function expectAccessibleDescription(control: Element): void {
  const label = referencedElement(control, "aria-labelledby");
  const description = referencedElement(control, "aria-describedby");
  expect(label.textContent?.trim()).not.toBe("");
  expect(description.textContent?.trim()).not.toBe("");
  expect(description.hidden).toBe(false);
}

async function renderLocalSetup(): Promise<{
  modal: SinglePlayerModal;
  settings: GameConfigSettings;
}> {
  const modal = new SinglePlayerModal();
  modal.inline = true;
  document.body.appendChild(modal);
  await modal.updateComplete;

  // The local setup renders the basics and the advanced rules as two
  // config blocks; the tests address them as one settings surface.
  const configs = [
    ...modal.querySelectorAll<GameConfigSettings>("game-config-settings"),
  ];
  const settings = {
    querySelector: (selector: string) => modal.querySelector(selector),
    querySelectorAll: (selector: string) => modal.querySelectorAll(selector),
    get updateComplete() {
      return Promise.all(configs.map((config) => config.updateComplete));
    },
  } as unknown as GameConfigSettings;
  await settings.updateComplete;
  const picker = settings.querySelector("map-picker") as MapPicker;
  await picker.updateComplete;
  await Promise.all(
    [...picker.querySelectorAll("map-display")].map(
      (map) =>
        (map as HTMLElement & { updateComplete: Promise<unknown> })
          .updateComplete,
    ),
  );
  return { modal, settings };
}

describe("local setup option descriptions", () => {
  beforeEach(() => {
    localStorage.clear();
    window.BOOTSTRAP_CONFIG = {
      gameEnv: "dev",
      numWorkers: 1,
      turnstileSiteKey: "unused",
      jwtAudience: "localhost",
      instanceId: "LOCAL_ONLY",
      gitCommit: "TEST",
      localOnly: true,
    };
    vi.stubGlobal("IntersectionObserver", DormantIntersectionObserver);
  });

  afterEach(() => {
    document.body.replaceChildren();
    window.BOOTSTRAP_CONFIG = undefined;
    vi.unstubAllGlobals();
  });

  it("describes all 41 FFA options and all 51 team options", async () => {
    const { modal, settings } = await renderLocalSetup();

    const ffaOptions = [...modal.querySelectorAll("[data-setting-option]")];
    expect(ffaOptions).toHaveLength(41);
    ffaOptions.forEach(expectAccessibleDescription);

    const modeButtons = settings.querySelectorAll<HTMLButtonElement>(
      '[data-setting-option="mode"]',
    );
    modeButtons[1].click();
    await modal.updateComplete;
    await settings.updateComplete;

    const teamOptions = [...modal.querySelectorAll("[data-setting-option]")];
    expect(teamOptions).toHaveLength(51);
    teamOptions.forEach(expectAccessibleDescription);

    const ids = [...modal.querySelectorAll<HTMLElement>("[id]")].map(
      (element) => element.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("shares descriptions with secondary values, inputs, and speed", async () => {
    const { modal, settings } = await renderLocalSetup();

    const sliders = settings.querySelectorAll<FluentSlider>("fluent-slider");
    expect(sliders).toHaveLength(2);
    for (const slider of sliders) {
      const range = slider.querySelector('input[type="range"]')!;
      const editableValue = slider.querySelector("[data-setting-value]")!;
      expectAccessibleDescription(range);
      expectAccessibleDescription(editableValue);

      (editableValue as HTMLElement).click();
      await slider.updateComplete;
      expectAccessibleDescription(
        slider.querySelector('input[type="number"]')!,
      );
    }

    const numericCards =
      modal.querySelectorAll<ToggleInputCard>("toggle-input-card");
    expect(numericCards).toHaveLength(3);
    for (const card of numericCards) {
      const toggle = card.querySelector("button")!;
      const input = card.querySelector("[data-setting-input]")!;
      expectAccessibleDescription(toggle);
      expectAccessibleDescription(input);
    }

    const ruleButtons = [
      ...settings.querySelectorAll<HTMLButtonElement>(
        '[data-setting-option="rule"]',
      ),
    ];
    const doomsday = ruleButtons[ruleButtons.length - 1]!;
    doomsday.click();
    await modal.updateComplete;
    await settings.updateComplete;

    const speed = settings.querySelector(
      '[data-setting-secondary="doomsday-speed"]',
    )!;
    expectAccessibleDescription(speed);
  });

  it("labels map search and its clear action", async () => {
    const { settings } = await renderLocalSetup();
    const input = settings.querySelector<HTMLInputElement>(
      'game-config-settings input[type="text"]',
    )!;
    expect(input.getAttribute("aria-label")).toBeTruthy();

    input.value = "world";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await settings.updateComplete;

    const clear = settings.querySelector<HTMLButtonElement>(
      'button[aria-label][class*="absolute right-2"]',
    );
    expect(clear?.getAttribute("aria-label")).toBeTruthy();
  });

  it("describes game speed, match rules, and player colors", async () => {
    const { modal } = await renderLocalSetup();

    const startingFunds = modal.querySelector("[data-starting-funds]")!;
    expectAccessibleDescription(
      startingFunds.querySelector('[role="switch"]')!,
    );
    expectAccessibleDescription(startingFunds.querySelector("input")!);

    for (const selector of [
      "[data-game-speed] [role=group]",
      "[data-match-tempo] [role=group]",
      "[data-victory-condition] [role=group]",
      "[data-player-color] [role=group]",
    ]) {
      const group = modal.querySelector(selector)!;
      expect(
        group.getAttribute("aria-label") ??
          group.getAttribute("aria-labelledby"),
      ).toBeTruthy();
      const description = referencedElement(group, "aria-describedby");
      expect(description.textContent?.trim()).not.toBe("");
      group.querySelectorAll("button").forEach((button) => {
        expect(button.getAttribute("aria-pressed")).toMatch(/^(true|false)$/);
        expect(
          button.getAttribute("aria-label") ?? button.textContent?.trim(),
        ).toBeTruthy();
      });
    }
  });
});
