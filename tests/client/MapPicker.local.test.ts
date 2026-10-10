import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MapPicker } from "../../src/client/components/map/MapPicker";
import { GameMapType } from "../../src/core/game/Game";

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
}));

class DormantIntersectionObserver {
  constructor(private callback: IntersectionObserverCallback) {}

  observe(target: Element) {
    this.callback(
      [{ isIntersecting: false, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }

  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];
}

function renderedMapKeys(picker: MapPicker): string[] {
  return [...picker.querySelectorAll("map-display")].map(
    (display) => (display as HTMLElement & { mapKey: string }).mapKey,
  );
}

describe("MapPicker local provenance allowlist", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", DormantIntersectionObserver);
    localStorage.clear();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("renders each admitted map once and hides Random", async () => {
    const picker = new MapPicker();
    picker.selectedMap = GameMapType.NaturalEarthWorld;
    picker.allowedMaps = [GameMapType.NaturalEarthWorld, GameMapType.TheBox];
    picker.descriptionKeys = {
      [GameMapType.NaturalEarthWorld]: "game_settings.map_natural_earth_desc",
      [GameMapType.TheBox]: "game_settings.map_the_box_desc",
    };
    picker.hideRandomMap = true;
    document.body.appendChild(picker);
    await picker.updateComplete;

    expect(renderedMapKeys(picker)).toEqual(["NaturalEarthWorld", "TheBox"]);
    expect(new Set(renderedMapKeys(picker)).size).toBe(2);
    expect(picker.textContent).not.toContain("map.random");
    expect(picker.querySelector('img[src*="RandomMap"]')).toBeNull();
    for (const map of picker.querySelectorAll("map-display")) {
      await (map as HTMLElement & { updateComplete: Promise<unknown> })
        .updateComplete;
      const button = map.querySelector('[role="button"]')!;
      const descriptionId = button.getAttribute("aria-describedby")!;
      expect(descriptionId).toBeTruthy();
      expect(document.getElementById(descriptionId)?.textContent?.trim()).toBe(
        (map as HTMLElement & { description: string }).description,
      );
    }
  });

  it("never exposes disallowed maps through search or stored favorites", async () => {
    localStorage.setItem("map-favorites", JSON.stringify([GameMapType.World]));
    const picker = new MapPicker();
    picker.allowedMaps = [GameMapType.NaturalEarthWorld, GameMapType.TheBox];
    picker.searchQuery = "world";
    document.body.appendChild(picker);
    await picker.updateComplete;

    expect(renderedMapKeys(picker)).toEqual(["NaturalEarthWorld"]);

    picker.searchQuery = "";
    (picker as unknown as { activeTab: string }).activeTab = "favorites";
    picker.requestUpdate();
    await picker.updateComplete;

    expect(renderedMapKeys(picker)).toEqual([]);
    expect(picker.textContent).toContain("map_component.favorites_empty");
  });
});
