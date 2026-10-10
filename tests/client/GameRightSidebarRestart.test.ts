import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameRightSidebar } from "../../src/client/hud/layers/GameRightSidebar";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import { GameType } from "../../src/core/game/Game";

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: (key: string) => key,
}));

const confirm = vi.fn(async (_message: string, _options?: unknown) => true);
vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(async () => undefined),
  showInGameConfirm: (message: string, options?: unknown) =>
    confirm(message, options),
}));

const restart = vi.fn(() => true);
let canRestart = true;
vi.mock("../../src/client/SinglePlayerRestart", () => ({
  canRestartSinglePlayer: () => canRestart,
  restartSinglePlayer: () => restart(),
}));

function createSidebar(
  gameType: GameType,
  { alive = true, replay = false }: { alive?: boolean; replay?: boolean } = {},
) {
  const game = {
    config: () => ({
      doomsdayClockConfig: () => undefined,
      gameConfig: () => ({ gameType, maxTimerValue: null }),
      isReplay: () => replay,
      listed: false,
      numSpawnPhaseTurns: () => 400,
    }),
    elapsedGameSeconds: () => 0,
    inSpawnPhase: () => false,
    myPlayer: () => ({ isAlive: () => alive }),
    ticks: () => 0,
  } as unknown as GameView;
  const sidebar = new GameRightSidebar();
  sidebar.game = game;
  sidebar.eventBus = new EventBus();
  document.body.appendChild(sidebar);
  sidebar.init();
  return sidebar;
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("GameRightSidebar restart with the same settings", () => {
  beforeEach(() => {
    canRestart = true;
    confirm.mockClear();
    confirm.mockResolvedValue(true);
    restart.mockClear();
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the control only for a fresh single-player game", async () => {
    const single = createSidebar(GameType.Singleplayer);
    await single.updateComplete;
    expect(single.querySelector("[data-restart-same]")).not.toBeNull();
    expect(
      single.querySelector("[data-restart-same]")?.getAttribute("title"),
    ).toBe("restart_prompt.label");
    document.body.innerHTML = "";

    const replay = createSidebar(GameType.Singleplayer, { replay: true });
    await replay.updateComplete;
    expect(replay.querySelector("[data-restart-same]")).toBeNull();
    document.body.innerHTML = "";

    const multiplayer = createSidebar(GameType.Public);
    await multiplayer.updateComplete;
    expect(multiplayer.querySelector("[data-restart-same]")).toBeNull();
    document.body.innerHTML = "";

    canRestart = false;
    const forgotten = createSidebar(GameType.Singleplayer);
    await forgotten.updateComplete;
    expect(forgotten.querySelector("[data-restart-same]")).toBeNull();
  });

  it("asks a living player first and restarts on yes, not on no", async () => {
    const sidebar = createSidebar(GameType.Singleplayer);
    await sidebar.updateComplete;
    const control = sidebar.querySelector<HTMLElement>("[data-restart-same]")!;

    confirm.mockResolvedValueOnce(false);
    control.click();
    await flush();
    expect(confirm).toHaveBeenCalledWith("restart_prompt.confirm", {
      variant: "warning",
    });
    expect(restart).not.toHaveBeenCalled();

    control.click();
    await flush();
    expect(restart).toHaveBeenCalledOnce();
  });

  it("restarts a dead player's game without asking", async () => {
    const sidebar = createSidebar(GameType.Singleplayer, { alive: false });
    await sidebar.updateComplete;
    sidebar.querySelector<HTMLElement>("[data-restart-same]")!.click();
    await flush();
    expect(confirm).not.toHaveBeenCalled();
    expect(restart).toHaveBeenCalledOnce();
  });
});
