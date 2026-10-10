import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToggleInputCard } from "../../../src/client/components/ToggleInputCard";

vi.mock("../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
}));

describe("ToggleInputCard descriptions", () => {
  let card: ToggleInputCard;

  beforeEach(async () => {
    card = new ToggleInputCard();
    card.labelKey = "game_settings.max_timer";
    card.descriptionKey = "game_settings.max_timer_desc";
    card.inputId = "test-max-timer";
    card.inputValue = 30;
    document.body.appendChild(card);
    await card.updateComplete;
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("links the toggle and mounted input to visible copy", () => {
    const toggle = card.querySelector("button")!;
    const input = card.querySelector("input")!;
    const labelId = toggle.getAttribute("aria-labelledby")!;
    const descriptionId = toggle.getAttribute("aria-describedby")!;

    expect(document.getElementById(labelId)?.textContent?.trim()).toBe(
      "game_settings.max_timer",
    );
    expect(document.getElementById(descriptionId)?.textContent?.trim()).toBe(
      "game_settings.max_timer_desc",
    );
    expect(input.getAttribute("aria-labelledby")).toBe(labelId);
    expect(input.getAttribute("aria-describedby")).toBe(descriptionId);
    expect(input.closest("div")?.className).not.toContain("absolute");
  });

  it("keeps the same described input when enabled", async () => {
    const input = card.querySelector("input")!;
    card.querySelector("button")!.click();
    card.checked = true;
    await card.updateComplete;

    expect(card.querySelector("input")).toBe(input);
    expect(input.getAttribute("aria-describedby")).toBeTruthy();
    expect(input.closest("div")?.className).not.toContain("hidden");
  });
});
