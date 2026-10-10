import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../../src/client/ClientEnv";
import type { LiveLobbyCard } from "../../src/client/components/LiveLobbyCard";
import { MultiplayerPage } from "../../src/client/components/MultiplayerPage";
import { PublicLobbySocket } from "../../src/client/LobbySocket";
import type { JoinLobbyEvent } from "../../src/client/Main";
import { GameMapType, GameType } from "../../src/core/game/Game";
import type { PublicGames } from "../../src/core/Schemas";

function bootstrap(multiplayer: boolean) {
  ClientEnv.reset();
  window.BOOTSTRAP_CONFIG = {
    gameEnv: "dev",
    numWorkers: 1,
    turnstileSiteKey: "unused",
    jwtAudience: "localhost",
    instanceId: "LOCAL_ONLY",
    gitCommit: "TEST",
    localOnly: true,
    multiplayer,
  };
}

function lobbies(startsAt: number | undefined): PublicGames {
  return {
    serverTime: Date.now(),
    games: {
      ffa: [
        {
          gameID: "FFAGAME1",
          numClients: 3,
          startsAt,
          publicGameType: "ffa",
          gameConfig: {
            gameMap: GameMapType.TheBox,
            maxPlayers: 50,
            gameType: GameType.Public,
          },
        },
      ],
      team: [],
      special: [],
      hosted: [],
    },
  } as unknown as PublicGames;
}

describe("Multiplayer page", () => {
  beforeEach(() => {
    vi.spyOn(PublicLobbySocket.prototype, "start").mockResolvedValue();
    vi.spyOn(PublicLobbySocket.prototype, "stop").mockImplementation(() => {});
  });

  afterEach(() => {
    document.body.replaceChildren();
    window.BOOTSTRAP_CONFIG = undefined;
    ClientEnv.reset();
    vi.restoreAllMocks();
  });

  it("lists the scheduled public lobbies and joins one through the join-lobby event", async () => {
    bootstrap(true);
    const page = new MultiplayerPage();
    document.body.append(page);
    await page.updateComplete;
    expect(PublicLobbySocket.prototype.start).toHaveBeenCalledOnce();
    expect(page.querySelector("username-input")).not.toBeNull();
    expect(page.textContent).toContain("multiplayer.connecting");

    page.onLobbies(lobbies(Date.now() + 42_000));
    await page.updateComplete;
    const card = page.querySelector<LiveLobbyCard>("live-lobby-card");
    await card?.updateComplete;
    const ffa = page.querySelector<HTMLElement>('[data-public-lobby="ffa"]');
    expect(ffa?.textContent).toContain("multiplayer.ffa");
    expect(ffa?.textContent).toContain("multiplayer.in_lobby");
    expect(ffa?.textContent).toContain("multiplayer.players_and_ai");
    expect(
      ffa?.querySelector("[data-lobby-countdown]")?.getAttribute("title"),
    ).toContain("multiplayer.starts_in");
    expect(
      page.querySelector('[data-public-lobby="team"]')?.textContent,
    ).toContain("multiplayer.waiting");

    const joins: JoinLobbyEvent[] = [];
    document.addEventListener("join-lobby", (event) =>
      joins.push((event as CustomEvent<JoinLobbyEvent>).detail),
    );
    page.querySelector<HTMLButtonElement>('[data-join-public="ffa"]')?.click();
    expect(joins).toHaveLength(1);
    expect(joins[0].gameID).toBe("FFAGAME1");
    expect(joins[0].source).toBe("public");
    expect(joins[0].publicLobbyInfo?.gameID).toBe("FFAGAME1");

    page.remove();
    expect(PublicLobbySocket.prototype.stop).toHaveBeenCalled();
  });

  it("opens the private host and join modals", async () => {
    bootstrap(true);
    const host = document.createElement("host-lobby-modal") as HTMLElement & {
      open: ReturnType<typeof vi.fn>;
    };
    host.open = vi.fn();
    const join = document.createElement("join-lobby-modal") as HTMLElement & {
      open: ReturnType<typeof vi.fn>;
    };
    join.open = vi.fn();
    const page = new MultiplayerPage();
    document.body.append(host, join, page);
    await page.updateComplete;
    page
      .querySelector<HTMLButtonElement>('[data-multiplayer-action="host"]')
      ?.click();
    page
      .querySelector<HTMLButtonElement>('[data-multiplayer-action="join"]')
      ?.click();
    expect(host.open).toHaveBeenCalledOnce();
    expect(join.open).toHaveBeenCalledOnce();
    expect(
      page.querySelector('.nav-menu-item[data-page="page-main-menu"]'),
    ).not.toBeNull();
  });

  it("talks to the lobby list only while the page is showing", async () => {
    bootstrap(true);
    const page = new MultiplayerPage();
    page.classList.add("hidden");
    document.body.append(page);
    await page.updateComplete;
    expect(PublicLobbySocket.prototype.start).not.toHaveBeenCalled();

    window.dispatchEvent(
      new CustomEvent("showPage", { detail: "page-multiplayer" }),
    );
    await page.updateComplete;
    expect(PublicLobbySocket.prototype.start).toHaveBeenCalledOnce();

    window.dispatchEvent(
      new CustomEvent("showPage", { detail: "page-main-menu" }),
    );
    await page.updateComplete;
    expect(PublicLobbySocket.prototype.stop).toHaveBeenCalled();
    // Showing it again reconnects once more; nothing runs while hidden.
    window.dispatchEvent(
      new CustomEvent("showPage", { detail: "page-multiplayer" }),
    );
    expect(PublicLobbySocket.prototype.start).toHaveBeenCalledTimes(2);
  });

  it("explains itself when the server has multiplayer switched off", async () => {
    bootstrap(false);
    const page = new MultiplayerPage();
    document.body.append(page);
    await page.updateComplete;
    expect(PublicLobbySocket.prototype.start).not.toHaveBeenCalled();
    expect(page.querySelector("[data-multiplayer-disabled]")).not.toBeNull();
    expect(page.querySelector("username-input")).toBeNull();
    expect(page.textContent).toContain("multiplayer.disabled");
  });
});
