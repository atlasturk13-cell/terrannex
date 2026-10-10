import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameConfigSettings } from "../../src/client/components/GameConfigSettings";
import type { MapPicker } from "../../src/client/components/map/MapPicker";
import { crazyGamesSDK } from "../../src/client/CrazyGamesSDK";
import { SinglePlayerModal } from "../../src/client/SinglePlayerModal";
import type { UsernameInput } from "../../src/client/UsernameInput";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  MatchTempo,
  UnitType,
  VictoryCondition,
} from "../../src/core/game/Game";
import { LOCAL_PROVENANCE_SAFE_MAPS } from "../../src/core/game/LocalProvenanceSafeMaps";
import {
  CAMERA_PAN_SENSITIVITY_KEY,
  CAMERA_ZOOM_SENSITIVITY_KEY,
  LOCAL_GAME_SPEED_KEY,
  UserSettings,
} from "../../src/core/game/UserSettings";

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

describe("SinglePlayerModal local configuration", () => {
  beforeEach(() => {
    localStorage.clear();
    const statics = UserSettings as unknown as {
      cache: Map<string, string | null>;
      playerId: string | null;
    };
    statics.cache.clear();
    statics.playerId = null;
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders full settings with local defaults and the map boundary", async () => {
    const modal = new SinglePlayerModal();
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(
      (modal as unknown as { renderBody(): unknown }).renderBody() as never,
      host,
    );
    await Promise.resolve();

    const settings = host.querySelector(
      "game-config-settings",
    ) as GameConfigSettings;
    await settings.updateComplete;
    const picker = settings.querySelector("map-picker") as MapPicker;
    await picker.updateComplete;

    expect(settings.settings).toMatchObject({
      map: {
        selected: GameMapType.NaturalEarthWorld,
        useRandom: false,
        allowedMaps: LOCAL_PROVENANCE_SAFE_MAPS,
        hideRandomMap: true,
      },
      difficulty: { selected: Difficulty.Medium, disabled: false },
      gameMode: { selected: GameMode.FFA },
      options: {
        bots: { value: 4 },
        nations: { value: 8 },
      },
      unitTypes: { disabledUnits: [] },
    });
    expect(picker.hideRandomMap).toBe(true);
    expect(picker.allowedMaps).toEqual(LOCAL_PROVENANCE_SAFE_MAPS);
    expect(host.querySelectorAll("username-input")).toHaveLength(1);
    expect(host.querySelector("[data-camera-follow]")).not.toBeNull();
    expect(host.querySelectorAll("[data-camera-pan] button")).toHaveLength(4);
    expect(host.querySelectorAll("[data-camera-zoom] button")).toHaveLength(4);
    expect(host.querySelectorAll("[data-game-speed] button")).toHaveLength(3);
    expect(host.querySelectorAll("[data-match-tempo] button")).toHaveLength(3);
    expect(
      host.querySelectorAll("[data-victory-condition] button"),
    ).toHaveLength(2);
    expect(host.querySelectorAll("[data-player-color-choice]")).toHaveLength(5);
  });

  it("leads with the basics and keeps the other rules behind Advanced options", async () => {
    const modal = new SinglePlayerModal();
    modal.inline = true;
    document.body.appendChild(modal);
    await modal.updateComplete;

    const configs = [
      ...modal.querySelectorAll<HTMLElement>("game-config-settings"),
    ].map((config) => config.dataset.configSections);
    expect(configs).toEqual(["core", "advanced"]);
    const panel = modal.querySelector<HTMLElement>("#setup-advanced-panel")!;
    const toggle = modal.querySelector<HTMLButtonElement>(
      "[data-setup-advanced-toggle]",
    )!;
    // Up front: name, colour, map, difficulty, mode. The rest is collapsed.
    expect(
      modal.querySelector("[data-local-command-setup] username-input"),
    ).not.toBeNull();
    expect(
      modal.querySelector("[data-local-command-setup] [data-player-color]"),
    ).not.toBeNull();
    expect(panel.classList.contains("hidden")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(panel.querySelector("[data-game-speed]")).not.toBeNull();
    expect(panel.querySelector("[data-camera-follow]")).not.toBeNull();

    toggle.click();
    await modal.updateComplete;
    expect(panel.classList.contains("hidden")).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps the new setup controls off the hosted surface", async () => {
    window.BOOTSTRAP_CONFIG = {
      ...window.BOOTSTRAP_CONFIG!,
      localOnly: false,
    };
    const modal = new SinglePlayerModal();
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(
      (modal as unknown as { renderBody(): unknown }).renderBody() as never,
      host,
    );
    await Promise.resolve();

    expect(host.querySelector("[data-local-command-setup]")).toBeNull();
    expect(host.querySelector("[data-match-tempo]")).toBeNull();
    expect(host.querySelector("[data-victory-condition]")).toBeNull();
    expect(host.querySelector("[data-player-color]")).toBeNull();
  });

  it("persists camera and game speed controls from the setup screen", async () => {
    const modal = new SinglePlayerModal();
    modal.inline = true;
    document.body.appendChild(modal);
    await modal.updateComplete;

    const follow = modal.querySelector<HTMLButtonElement>(
      "[data-camera-follow]",
    )!;
    const pan = modal.querySelectorAll<HTMLButtonElement>(
      "[data-camera-pan] button",
    );
    const zoom = modal.querySelectorAll<HTMLButtonElement>(
      "[data-camera-zoom] button",
    );
    const speed = modal.querySelectorAll<HTMLButtonElement>(
      "[data-game-speed] button",
    );

    follow.click();
    pan[2].click();
    zoom[0].click();
    speed[2].click();
    await modal.updateComplete;

    expect(new UserSettings().goToPlayer()).toBe(false);
    expect(localStorage.getItem(CAMERA_PAN_SENSITIVITY_KEY)).toBe("1.5");
    expect(localStorage.getItem(CAMERA_ZOOM_SENSITIVITY_KEY)).toBe("0.5");
    expect(localStorage.getItem(LOCAL_GAME_SPEED_KEY)).toBe("0.5");
    expect(follow.getAttribute("aria-checked")).toBe("false");
  });

  it("emits the exact default local config without external ad work", async () => {
    const modal = new SinglePlayerModal();
    modal.inline = true;
    document.body.appendChild(modal);
    await modal.updateComplete;
    const requestAd = vi.spyOn(crazyGamesSDK, "requestMidgameAd");
    const commander = modal.querySelector<UsernameInput>(
      'username-input[data-local-commander="true"]',
    )!;
    vi.spyOn(commander, "whenSeeded").mockResolvedValue();
    vi.spyOn(commander, "getUsername").mockReturnValue("Local Commander");
    vi.spyOn(commander, "getClanTag").mockReturnValue(null);
    let detail: any;
    modal.addEventListener("join-lobby", (event) => {
      detail = (event as CustomEvent).detail;
    });

    await (modal as unknown as { startGame(): Promise<void> }).startGame();

    expect(requestAd).not.toHaveBeenCalled();
    expect(modal.classList.contains("hidden")).toBe(true);
    expect(modal.style.pointerEvents).toBe("none");
    expect(detail.gameID).toBe("LocalNE1");
    expect(detail.gameStartInfo.config).toEqual({
      gameMap: GameMapType.NaturalEarthWorld,
      gameMapSize: GameMapSize.Normal,
      gameType: "Singleplayer",
      gameMode: GameMode.FFA,
      playerTeams: 2,
      difficulty: Difficulty.Medium,
      maxTimerValue: undefined,
      bots: 4,
      infiniteGold: false,
      donateGold: false,
      donateTroops: false,
      infiniteTroops: false,
      instantBuild: false,
      randomSpawn: false,
      disabledUnits: [],
      nations: 8,
      combinedArmsV1: true,
      combinedArmsV2: true,
      airSuperiorityV1: true,
      airportOperationsV1: true,
      depthProgression: true,
      matchTempo: MatchTempo.Medium,
      victoryCondition: VictoryCondition.Territory,
    });
    expect(detail.gameStartInfo.players[0].cosmetics).toEqual({
      color: { color: "#38bdf8" },
    });
    expect(detail.gameStartInfo.config.localSkirmishProfile).toBeUndefined();
    expect(detail.gameStartInfo.config.disabledUnits).not.toContain(
      UnitType.Port,
    );
    expect(detail.gameStartInfo.config.disabledUnits).not.toContain(
      UnitType.TransportShip,
    );
    expect(detail.gameStartInfo.config.disabledUnits).not.toContain(
      UnitType.Warship,
    );
  });

  it("emits tempo, victory, starting funds, and player color choices", async () => {
    const modal = new SinglePlayerModal();
    modal.inline = true;
    document.body.appendChild(modal);
    await modal.updateComplete;
    const settings = modal.querySelector(
      "game-config-settings",
    ) as GameConfigSettings;
    await settings.updateComplete;

    const tempo = modal.querySelectorAll<HTMLButtonElement>(
      "[data-match-tempo] button",
    );
    const victory = modal.querySelectorAll<HTMLButtonElement>(
      "[data-victory-condition] button",
    );
    tempo[2].click();
    victory[1].click();
    modal
      .querySelector<HTMLButtonElement>('[data-player-color-choice="#22c55e"]')!
      .click();

    const startingFunds = modal.querySelector("[data-starting-funds]")!;
    startingFunds.querySelector<HTMLButtonElement>('[role="switch"]')!.click();
    await modal.updateComplete;
    const input = modal.querySelector<HTMLInputElement>(
      "#starting-gold-value",
    )!;
    input.value = "7.5";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const commander = modal.querySelector<UsernameInput>(
      'username-input[data-local-commander="true"]',
    )!;
    vi.spyOn(commander, "whenSeeded").mockResolvedValue();
    vi.spyOn(commander, "getUsername").mockReturnValue("Local Commander");
    vi.spyOn(commander, "getClanTag").mockReturnValue(null);
    let detail: any;
    modal.addEventListener("join-lobby", (event) => {
      detail = (event as CustomEvent).detail;
    });

    await (modal as unknown as { startGame(): Promise<void> }).startGame();

    expect(detail.gameStartInfo.config).toMatchObject({
      matchTempo: MatchTempo.Fast,
      victoryCondition: VictoryCondition.Elimination,
      startingGold: 7_500_000,
    });
    expect(detail.gameStartInfo.players[0].cosmetics).toEqual({
      color: { color: "#22c55e" },
    });
  });

  it("sends an explicit legacy choice when the local depth switch is disabled", async () => {
    const modal = new SinglePlayerModal();
    modal.inline = true;
    document.body.appendChild(modal);
    await modal.updateComplete;
    const commander = modal.querySelector<UsernameInput>(
      'username-input[data-local-commander="true"]',
    )!;
    vi.spyOn(commander, "whenSeeded").mockResolvedValue();
    vi.spyOn(commander, "getUsername").mockReturnValue("Local Commander");
    vi.spyOn(commander, "getClanTag").mockReturnValue(null);
    const depthSwitch = modal.querySelector<HTMLButtonElement>(
      "[data-depth-progression]",
    )!;
    expect(depthSwitch.getAttribute("aria-checked")).toBe("true");
    depthSwitch.click();
    await modal.updateComplete;
    expect(depthSwitch.getAttribute("aria-checked")).toBe("false");

    let detail: any;
    modal.addEventListener("join-lobby", (event) => {
      detail = (event as CustomEvent).detail;
    });
    await (modal as unknown as { startGame(): Promise<void> }).startGame();

    expect(detail.gameStartInfo.config.depthProgression).toBe(false);
  });

  it("keeps setup open and emits nothing for an invalid commander", async () => {
    const modal = new SinglePlayerModal();
    modal.inline = true;
    document.body.appendChild(modal);
    await modal.updateComplete;
    const commander = modal.querySelector<UsernameInput>(
      'username-input[data-local-commander="true"]',
    )!;
    const input = commander.querySelector("input")!;
    input.value = "x";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await commander.updateComplete;
    const join = vi.fn();
    modal.addEventListener("join-lobby", join);

    modal.querySelector<HTMLElement>("o-button")!.click();
    await vi.waitFor(() => expect(document.activeElement).toBe(input));

    expect(join).not.toHaveBeenCalled();
    expect(modal.classList.contains("hidden")).toBe(false);
    expect(modal.style.pointerEvents).not.toBe("none");
  });

  it("emits edited controls unchanged and applies The Box profile only", async () => {
    const modal = new SinglePlayerModal();
    modal.inline = true;
    document.body.appendChild(modal);
    await modal.updateComplete;
    const settings = modal.querySelector(
      "game-config-settings",
    ) as GameConfigSettings;

    settings.dispatchEvent(
      new CustomEvent("map-selected", {
        detail: { map: GameMapType.TheBox },
        bubbles: true,
      }),
    );
    settings.dispatchEvent(
      new CustomEvent("difficulty-selected", {
        detail: { difficulty: Difficulty.Hard },
        bubbles: true,
      }),
    );
    settings.dispatchEvent(
      new CustomEvent("bots-changed", {
        detail: { value: 6 },
        bubbles: true,
      }),
    );
    settings.dispatchEvent(
      new CustomEvent("nations-changed", {
        detail: { value: 3 },
        bubbles: true,
      }),
    );
    settings.dispatchEvent(
      new CustomEvent("unit-toggle-changed", {
        detail: { unit: UnitType.Port, checked: true },
        bubbles: true,
      }),
    );

    const commander = modal.querySelector<UsernameInput>(
      'username-input[data-local-commander="true"]',
    )!;
    vi.spyOn(commander, "whenSeeded").mockResolvedValue();
    vi.spyOn(commander, "getUsername").mockReturnValue("Local Commander");
    vi.spyOn(commander, "getClanTag").mockReturnValue(null);
    let detail: any;
    modal.addEventListener("join-lobby", (event) => {
      detail = (event as CustomEvent).detail;
    });

    await (modal as unknown as { startGame(): Promise<void> }).startGame();

    expect(detail.gameID).toBe("LocalBox");
    expect(detail.gameStartInfo.config).toMatchObject({
      gameMap: GameMapType.TheBox,
      difficulty: Difficulty.Hard,
      bots: 6,
      nations: 3,
      disabledUnits: [UnitType.Port],
      localSkirmishProfile: "the-box",
    });
  });
});
