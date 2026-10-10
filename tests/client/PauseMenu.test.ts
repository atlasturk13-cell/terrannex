import { afterEach, describe, expect, it } from "vitest";
import {
  isAnotherOverlayOpen,
  PauseMenu,
} from "../../src/client/hud/layers/PauseMenu";
import {
  SettingsModal,
  ShowSettingsModalEvent,
} from "../../src/client/hud/layers/SettingsModal";
import { PauseGameIntentEvent } from "../../src/client/Transport";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import { GameType } from "../../src/core/game/Game";

function harness(gameType = GameType.Singleplayer) {
  const eventBus = new EventBus();
  const pauses: boolean[] = [];
  const settings: ShowSettingsModalEvent[] = [];
  eventBus.on(PauseGameIntentEvent, (e) => pauses.push(e.paused));
  eventBus.on(ShowSettingsModalEvent, (e) => settings.push(e));
  const menu = new PauseMenu();
  menu.game = {
    config: () => ({ gameConfig: () => ({ gameType }), isReplay: () => false }),
    myPlayer: () => ({ isAlive: () => true }),
    updatesSinceLastTick: () => ({}),
  } as unknown as GameView;
  menu.eventBus = eventBus;
  document.body.append(menu);
  menu.init();
  return { menu, pauses, settings };
}

const escapeEvent = () =>
  new KeyboardEvent("keydown", {
    key: "Escape",
    code: "Escape",
    cancelable: true,
  });
const escape = () => window.dispatchEvent(escapeEvent());

afterEach(() => document.body.replaceChildren());

describe("Pause menu", () => {
  it("stays closed when Escape closes the in-game settings first", async () => {
    // The settings modal registers its window listener before the pause
    // menu (index.html order), so it sees the key first.
    const eventBus = new EventBus();
    const settingsModal = new SettingsModal();
    settingsModal.eventBus = eventBus;
    document.body.append(settingsModal);
    settingsModal.init();
    const { menu, pauses } = harness();
    eventBus.emit(new ShowSettingsModalEvent(true, true, false));
    escape();
    await menu.updateComplete;
    expect(menu.isOpen()).toBe(false);
    expect(pauses).toEqual([]);
    // The next Escape, with nothing else open, opens the menu as usual.
    escape();
    await menu.updateComplete;
    expect(menu.isOpen()).toBe(true);
  });

  it("opens on Escape, pauses a single-player match, and resumes on Escape or Resume", async () => {
    const { menu, pauses } = harness();
    escape();
    await menu.updateComplete;
    expect(menu.isOpen()).toBe(true);
    expect(pauses).toEqual([true]);
    const actions = [
      ...menu.querySelectorAll<HTMLButtonElement>("[data-pause-action]"),
    ].map((button) => button.dataset.pauseAction);
    expect(actions).toEqual(["resume", "settings", "exit"]);
    expect(menu.textContent).toContain("pause_menu.title");

    escape();
    await menu.updateComplete;
    expect(menu.isOpen()).toBe(false);
    expect(pauses).toEqual([true, false]);

    escape();
    await menu.updateComplete;
    menu
      .querySelector<HTMLButtonElement>('[data-pause-action="resume"]')
      ?.click();
    await menu.updateComplete;
    expect(menu.isOpen()).toBe(false);
    expect(pauses).toEqual([true, false, true, false]);
    expect(menu.querySelector(".pause-menu-backdrop")).toBeNull();
  });

  it("hands over to the settings modal and never pauses a multiplayer match", async () => {
    const { menu, pauses, settings } = harness(GameType.Public);
    escape();
    await menu.updateComplete;
    expect(menu.isOpen()).toBe(true);
    expect(pauses).toEqual([]);
    menu
      .querySelector<HTMLButtonElement>('[data-pause-action="settings"]')
      ?.click();
    await menu.updateComplete;
    expect(menu.isOpen()).toBe(false);
    expect(settings).toHaveLength(1);
    expect(settings[0].isVisible).toBe(true);
    expect(settings[0].shouldPause).toBe(false);
  });

  it("leaves Escape to an overlay that is already open", async () => {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    const { menu, pauses } = harness();
    expect(isAnotherOverlayOpen()).toBe(true);
    escape();
    await menu.updateComplete;
    expect(menu.isOpen()).toBe(false);
    expect(pauses).toEqual([]);
    dialog.remove();

    const settingsModal = document.createElement(
      "settings-modal",
    ) as HTMLElement & {
      isVisible: boolean;
    };
    settingsModal.isVisible = true;
    document.body.append(settingsModal);
    expect(isAnotherOverlayOpen()).toBe(true);
    settingsModal.isVisible = false;
    expect(isAnotherOverlayOpen()).toBe(false);

    const radial = document.createElement("div");
    radial.className = "radial-menu-container";
    radial.style.display = "block";
    document.body.append(radial);
    expect(isAnotherOverlayOpen()).toBe(true);
    radial.style.display = "none";
    expect(isAnotherOverlayOpen()).toBe(false);

    const buildMenu = document.createElement("build-menu") as HTMLElement & {
      _hidden: boolean;
    };
    buildMenu._hidden = false;
    document.body.append(buildMenu);
    expect(isAnotherOverlayOpen()).toBe(true);
    buildMenu._hidden = true;
    expect(isAnotherOverlayOpen()).toBe(false);

    escape();
    await menu.updateComplete;
    expect(menu.isOpen()).toBe(true);
  });

  it("does not resume a match that was already paused before it opened", async () => {
    const { menu, pauses } = harness();
    (menu as unknown as { isPaused: boolean }).isPaused = true;
    escape();
    await menu.updateComplete;
    expect(menu.isOpen()).toBe(true);
    escape();
    await menu.updateComplete;
    expect(pauses).toEqual([]);
  });
});
