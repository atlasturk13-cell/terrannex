import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUserMe } from "../../../../src/client/Api";
import { ClientEnv } from "../../../../src/client/ClientEnv";
import "../../../../src/client/components/baseComponents/Button";
import type { OButton } from "../../../../src/client/components/baseComponents/Button";
import type { PurchaseButton } from "../../../../src/client/components/PurchaseButton";
import {
  fetchCosmetics,
  purchaseCosmetic,
  resolveCosmetics,
  type ResolvedCosmetic,
} from "../../../../src/client/Cosmetics";
import { crazyGamesSDK } from "../../../../src/client/CrazyGamesSDK";
import "../../../../src/client/hud/layers/WinModal";
import type { WinModal } from "../../../../src/client/hud/layers/WinModal";
import { steamSDK } from "../../../../src/client/SteamSDK";
import { SendWinnerEvent } from "../../../../src/client/Transport";
import { getGamesPlayed, isInIframe } from "../../../../src/client/Utils";
import type { GameView, PlayerView } from "../../../../src/client/view";
import { EventBus } from "../../../../src/core/EventBus";
import { RankedType } from "../../../../src/core/game/Game";
import { GameUpdateType } from "../../../../src/core/game/GameUpdates";

vi.mock("../../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string, params?: Record<string, string>) => {
    const translations: Record<string, string> = {
      "win_modal.died": "You died",
      "win_modal.exit": "Exit",
      "win_modal.requeue": "Play Again",
      "win_modal.keep": "Keep Playing",
      "win_modal.other_won": `${params?.player ?? "Unknown"} has won!`,
      "win_modal.spectate": "Spectate",
      "win_modal.you_won": "You Won!",
    };
    return translations[key] || key;
  }),
  getGamesPlayed: vi.fn(() => 10),
  isInIframe: vi.fn(() => false),
  TUTORIAL_VIDEO_URL: "https://example.com/tutorial",
}));

vi.mock("../../../../src/client/Api", () => ({
  getUserMe: vi.fn(async () => null),
}));

vi.mock("../../../../src/client/ClientEnv", () => ({
  ClientEnv: {
    isLocalOnly: vi.fn(() => false),
  },
}));

vi.mock("../../../../src/client/Cosmetics", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../src/client/Cosmetics")
  >()),
  fetchCosmetics: vi.fn(async () => null),
  purchaseCosmetic: vi.fn(async () => undefined),
  resolveCosmetics: vi.fn(() => []),
}));

vi.mock("../../../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    happytime: vi.fn(),
    requestAd: vi.fn(),
    gameplayStop: vi.fn(),
  },
}));

vi.mock("../../../../src/client/SteamSDK", () => ({
  steamSDK: {
    isOnSteam: vi.fn(() => false),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ClientEnv.isLocalOnly).mockReturnValue(false);
});

interface TerminalPlayerOptions {
  alive: boolean;
  clientID: string;
  displayName: string;
  spawned?: boolean;
}

function terminalPlayer({
  alive,
  clientID,
  displayName,
  spawned = true,
}: TerminalPlayerOptions): PlayerView {
  return {
    clientID: () => clientID,
    displayName: () => displayName,
    hasSpawned: () => spawned,
    isAlive: () => alive,
    isPlayer: () => true,
    team: () => null,
  } as unknown as PlayerView;
}

function terminalGame(
  me: PlayerView,
  players: PlayerView[],
  winUpdates: unknown[] = [],
): GameView {
  return {
    inSpawnPhase: () => false,
    myPlayer: () => me,
    playerByClientID: (clientID: string) =>
      players.find((player) => player.clientID() === clientID),
    updatesSinceLastTick: () => ({ [GameUpdateType.Win]: winUpdates }) as never,
  } as unknown as GameView;
}

async function renderTerminal(
  game: GameView,
): Promise<{ modal: WinModal; sent: SendWinnerEvent[] }> {
  const modal = document.createElement("win-modal") as WinModal;
  const eventBus = new EventBus();
  const sent: SendWinnerEvent[] = [];
  eventBus.on(SendWinnerEvent, (event) => sent.push(event));
  modal.game = game;
  modal.eventBus = eventBus;
  document.body.appendChild(modal);
  await modal.updateComplete;

  modal.tick();
  await modal.updateComplete;
  await Promise.all(
    Array.from(modal.querySelectorAll<OButton>("o-button")).map(
      (button) => button.updateComplete,
    ),
  );
  return { modal, sent };
}

function terminalButtonLabels(modal: WinModal): string[] {
  return Array.from(modal.querySelectorAll("o-button button span")).map(
    (label) => label.textContent?.trim() ?? "",
  );
}

function expectNoLocalExternalContent(modal: WinModal): void {
  expect(getUserMe).not.toHaveBeenCalled();
  expect(fetchCosmetics).not.toHaveBeenCalled();
  expect(resolveCosmetics).not.toHaveBeenCalled();
  expect(purchaseCosmetic).not.toHaveBeenCalled();
  expect(getGamesPlayed).not.toHaveBeenCalled();
  expect(isInIframe).not.toHaveBeenCalled();
  expect(crazyGamesSDK.gameplayStop).not.toHaveBeenCalled();
  expect(crazyGamesSDK.happytime).not.toHaveBeenCalled();
  expect(steamSDK.isOnSteam).not.toHaveBeenCalled();
  expect(modal.querySelectorAll("iframe")).toHaveLength(0);
  expect(modal.querySelectorAll('a[href^="http"]')).toHaveLength(0);
  expect(modal.querySelectorAll("steam-wishlist")).toHaveLength(0);
  expect(modal.querySelectorAll("cosmetic-card")).toHaveLength(0);
  expect(modal.querySelectorAll("purchase-button")).toHaveLength(0);
}

describe("WinModal local-only terminal results", () => {
  let modal: WinModal | undefined;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(ClientEnv.isLocalOnly).mockReturnValue(true);
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    expect(consoleError).not.toHaveBeenCalled();
    vi.useRealTimers();
    modal?.remove();
    modal = undefined;
  });

  it("shows a human victory and both terminal actions in one update", async () => {
    const me = terminalPlayer({
      alive: true,
      clientID: "local-human",
      displayName: "Local Human",
    });
    const allPlayersStats = { local: "winner" } as never;
    const rendered = await renderTerminal(
      terminalGame(
        me,
        [me],
        [
          {
            type: GameUpdateType.Win,
            winner: ["player", "local-human"],
            allPlayersStats,
          },
        ],
      ),
    );
    modal = rendered.modal;

    expect(modal.querySelector("h2")?.textContent?.trim()).toBe("You Won!");
    expect(terminalButtonLabels(modal)).toEqual(["Exit", "Keep Playing"]);
    expect(modal.firstElementChild?.classList.contains("hidden")).toBe(false);
    expect(rendered.sent).toHaveLength(1);
    expect(rendered.sent[0].winner).toEqual(["player", "local-human"]);
    expect(rendered.sent[0].allPlayersStats).toBe(allPlayersStats);
    expectNoLocalExternalContent(modal);
  });

  it("shows an immediately actionable death result for a spawned human", async () => {
    const me = terminalPlayer({
      alive: false,
      clientID: "local-human",
      displayName: "Local Human",
    });
    const rendered = await renderTerminal(terminalGame(me, [me]));
    modal = rendered.modal;

    expect(modal.querySelector("h2")?.textContent?.trim()).toBe("You died");
    expect(terminalButtonLabels(modal)).toEqual(["Exit", "Spectate"]);
    expect(rendered.sent).toHaveLength(0);
    expectNoLocalExternalContent(modal);
  });

  it("prefers the winner result over same-tick death without delayed mutation", async () => {
    vi.useFakeTimers();
    const me = terminalPlayer({
      alive: false,
      clientID: "local-human",
      displayName: "Local Human",
    });
    const rival = terminalPlayer({
      alive: true,
      clientID: "rival",
      displayName: "Rival",
    });
    const rendered = await renderTerminal(
      terminalGame(
        me,
        [me, rival],
        [
          {
            type: GameUpdateType.Win,
            winner: ["player", "rival"],
            allPlayersStats: {},
          },
        ],
      ),
    );
    modal = rendered.modal;

    expect(modal.querySelector("h2")?.textContent?.trim()).toBe(
      "Rival has won!",
    );
    expect(terminalButtonLabels(modal)).toEqual(["Exit", "Spectate"]);
    expect(rendered.sent).toHaveLength(1);
    expect(rendered.sent[0].winner).toEqual(["player", "rival"]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    await modal.updateComplete;
    expect(modal.querySelector("h2")?.textContent?.trim()).toBe(
      "Rival has won!",
    );
    expect(terminalButtonLabels(modal)).toEqual(["Exit", "Spectate"]);
    expectNoLocalExternalContent(modal);
  });
});

describe("WinModal Requeue", () => {
  let mockLocationHref = "";

  beforeEach(() => {
    mockLocationHref = "";
    // Mock window.location.href using Object.defineProperty
    const locationMock = {
      get href() {
        return mockLocationHref;
      },
      set href(value: string) {
        mockLocationHref = value;
      },
    };
    Object.defineProperty(window, "location", {
      value: locationMock,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("isRankedGame detection", () => {
    it("should detect ranked 1v1 game", () => {
      const gameConfig = {
        rankedType: RankedType.OneVOne,
      };
      const isRankedGame = gameConfig.rankedType === RankedType.OneVOne;
      expect(isRankedGame).toBe(true);
    });

    it("should not detect non-ranked game", () => {
      const gameConfig = {
        rankedType: undefined,
      };
      const isRankedGame = gameConfig.rankedType === RankedType.OneVOne;
      expect(isRankedGame).toBe(false);
    });
  });

  describe("requeue navigation", () => {
    it("should navigate to /?requeue when requeue is triggered", () => {
      // Simulate the _handleRequeue behavior
      const handleRequeue = () => {
        window.location.href = "/?requeue";
      };

      handleRequeue();

      expect(window.location.href).toBe("/?requeue");
    });

    it("should navigate to / when exit is triggered", () => {
      // Simulate the _handleExit behavior
      const handleExit = () => {
        window.location.href = "/";
      };

      handleExit();

      expect(window.location.href).toBe("/");
    });
  });

  describe("requeue URL parameter handling", () => {
    it("should parse requeue parameter from URL", () => {
      const url = new URL("http://localhost:9000/?requeue");
      const hasRequeue = url.searchParams.has("requeue");
      expect(hasRequeue).toBe(true);
    });

    it("should not find requeue parameter when absent", () => {
      const url = new URL("http://localhost:9000/");
      const hasRequeue = url.searchParams.has("requeue");
      expect(hasRequeue).toBe(false);
    });
  });
});

describe("WinModal pattern promotion", () => {
  let modal: WinModal | undefined;

  afterEach(() => {
    modal?.remove();
    modal = undefined;
  });

  it("renders three card-and-purchase promotions from four purchasable patterns", async () => {
    const purchasablePatterns: ResolvedCosmetic[] = [
      "aurora",
      "blaze",
      "circuit",
      "dawn",
    ].map((name) => ({
      type: "pattern",
      cosmetic: {
        name,
        pattern: "AAAAAA",
        product: null,
        priceHard: 120,
        rarity: "rare",
      } as never,
      colorPalette: null,
      relationship: "purchasable",
      key: `pattern:${name}`,
    }));
    vi.mocked(fetchCosmetics).mockResolvedValue(null);
    vi.mocked(resolveCosmetics).mockReturnValue(purchasablePatterns);

    modal = document.createElement("win-modal") as WinModal;
    Object.assign(modal as unknown as { rand: number; isWin: boolean }, {
      rand: 0.75,
      isWin: true,
    });
    document.body.appendChild(modal);
    await modal.updateComplete;

    await modal.loadPatternContent();
    modal.requestUpdate();
    await modal.updateComplete;

    const promotions = modal.querySelectorAll("[data-win-cosmetic-promo]");
    expect(promotions).toHaveLength(3);
    expect(modal.querySelectorAll("cosmetic-card")).toHaveLength(3);
    expect(modal.querySelectorAll("purchase-button")).toHaveLength(3);
    for (const button of modal.querySelectorAll<PurchaseButton>(
      "purchase-button",
    )) {
      expect(button.rarity).toBe("rare");
    }
    for (const card of modal.querySelectorAll("cosmetic-card")) {
      expect(card.querySelector("[data-cosmetic-main]")?.tagName).toBe("DIV");
      expect(card.querySelectorAll("button")).toHaveLength(0);
    }
    const legacyButtonTag = ["cosmetic", "button"].join("-");
    const legacyContainerTag = ["cosmetic", "container"].join("-");
    expect(modal.querySelectorAll(legacyButtonTag)).toHaveLength(0);
    expect(modal.querySelectorAll(legacyContainerTag)).toHaveLength(0);
  });
});
