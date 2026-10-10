import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WinModal } from "../../src/client/hud/layers/WinModal";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import { GameType } from "../../src/core/game/Game";

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: (key: string) => key,
}));

const restart = vi.fn(() => true);
let canRestart = true;
vi.mock("../../src/client/SinglePlayerRestart", () => ({
  canRestartSinglePlayer: () => canRestart,
  restartSinglePlayer: () => restart(),
}));

function createModal(gameType: GameType, replay = false) {
  const modal = new WinModal();
  modal.game = {
    config: () => ({
      gameConfig: () => ({ gameType }),
      isReplay: () => replay,
    }),
    myPlayer: () => ({ isAlive: () => true }),
  } as unknown as GameView;
  modal.eventBus = new EventBus();
  modal.isVisible = true;
  modal.showButtons = true;
  document.body.appendChild(modal);
  return modal;
}

describe("WinModal restart with the same settings", () => {
  beforeEach(() => {
    canRestart = true;
    restart.mockClear();
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("offers Play Again (same settings) for a single-player game and restarts on click", async () => {
    const modal = createModal(GameType.Singleplayer);
    await modal.updateComplete;
    const button = modal.querySelector<HTMLElement>("[data-restart-same]");
    expect(button).not.toBeNull();
    expect(button?.getAttribute("translationKey")).toBe(
      "win_modal.restart_same",
    );
    button?.click();
    expect(restart).toHaveBeenCalledOnce();
    expect(modal.isVisible).toBe(false);
  });

  it("hides it for replays, multiplayer and when no start is remembered", async () => {
    const replay = createModal(GameType.Singleplayer, true);
    await replay.updateComplete;
    expect(replay.querySelector("[data-restart-same]")).toBeNull();
    document.body.innerHTML = "";

    const multiplayer = createModal(GameType.Public);
    await multiplayer.updateComplete;
    expect(multiplayer.querySelector("[data-restart-same]")).toBeNull();
    document.body.innerHTML = "";

    canRestart = false;
    const forgotten = createModal(GameType.Singleplayer);
    await forgotten.updateComplete;
    expect(forgotten.querySelector("[data-restart-same]")).toBeNull();
  });
});
