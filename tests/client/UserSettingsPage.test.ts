import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../../src/client/ClientEnv";
import { UserSettingModal } from "../../src/client/UserSettingModal";
import { UserSettings } from "../../src/core/game/UserSettings";

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

async function openSettings(tab?: string) {
  const page = new UserSettingModal();
  page.inline = true;
  document.body.append(page);
  await page.updateComplete;
  page.open(tab ? { tab } : undefined);
  await page.updateComplete;
  return page;
}

describe("Settings page", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", DormantIntersectionObserver);
    ClientEnv.reset();
    window.BOOTSTRAP_CONFIG = {
      gameEnv: "dev",
      numWorkers: 1,
      turnstileSiteKey: "unused",
      jwtAudience: "localhost",
      instanceId: "LOCAL_ONLY",
      gitCommit: "TEST",
      localOnly: true,
    };
    localStorage.clear();
  });

  afterEach(() => {
    document.body.replaceChildren();
    window.BOOTSTRAP_CONFIG = undefined;
    ClientEnv.reset();
    vi.unstubAllGlobals();
  });

  it("groups settings into General, Graphics, Audio and Keybinds", async () => {
    const page = await openSettings();
    const config = (
      page as unknown as { modalConfig(): { tabs: { key: string }[] } }
    ).modalConfig();
    expect(config.tabs.map((t) => t.key)).toEqual([
      "basic",
      "graphics",
      "audio",
      "keybinds",
    ]);
    // General opens first, with language and the grouped game settings.
    expect(page.querySelector('[data-setting="language"]')).not.toBeNull();
    expect(page.textContent).toContain("user_setting.section_gameplay");
    expect(page.querySelector("#left-click-toggle")).not.toBeNull();
    expect(page.querySelector("graphics-preset-selector")).toBeNull();

    page.setActiveTab("graphics");
    await page.updateComplete;
    expect(page.querySelector("graphics-preset-selector")).not.toBeNull();
    expect(page.querySelector("#satellite-terrain-toggle")).not.toBeNull();
  });

  it("stores the music volume and switches language through the selector", async () => {
    const page = await openSettings("audio");
    const music = page.querySelector('[data-setting="music-volume"]');
    expect(music).not.toBeNull();
    // The local build has no sound effects, so it explains instead.
    expect(page.querySelector('[data-setting="sfx-volume"]')).toBeNull();
    music?.dispatchEvent(
      new CustomEvent("change", { detail: { value: 35 }, bubbles: true }),
    );
    expect(new UserSettings().backgroundMusicVolume()).toBeCloseTo(0.35);

    page.setActiveTab("basic");
    await page.updateComplete;
    const languages: string[] = [];
    window.addEventListener("language-selected", (event) =>
      languages.push((event as CustomEvent<{ lang: string }>).detail.lang),
    );
    page
      .querySelector('[data-setting="language"]')
      ?.dispatchEvent(
        new CustomEvent("change", { detail: { value: "tr" }, bubbles: true }),
      );
    expect(languages).toEqual(["tr"]);
  });
});
