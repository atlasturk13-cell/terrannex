import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientEnv, UPSTREAM_SOURCE_URL } from "../../src/client/ClientEnv";
import { AboutPage } from "../../src/client/components/AboutPage";
import { DesktopNavBar } from "../../src/client/components/DesktopNavBar";
import { Footer } from "../../src/client/components/Footer";
import { MainMenu } from "../../src/client/components/MainMenu";
import { PublicLobbySocket } from "../../src/client/LobbySocket";
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

function bootstrap(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

afterEach(() => {
  document.body.replaceChildren();
  window.BOOTSTRAP_CONFIG = undefined;
  window.showPage = undefined;
  window.currentPageId = undefined;
  ClientEnv.reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Main menu", () => {
  it("offers Play, Settings and About and routes through the page router", async () => {
    bootstrap();
    const showPage = vi.fn();
    window.showPage = showPage;
    const menu = new MainMenu();
    document.body.append(menu);
    await menu.updateComplete;

    const items = [
      ...menu.querySelectorAll<HTMLButtonElement>("[data-menu-item]"),
    ];
    expect(items.map((item) => item.dataset.menuItem)).toEqual([
      "page-single-player",
      "page-settings",
      "page-about",
    ]);
    expect(items[0].textContent).toContain("main_menu.play");
    expect(items[0].textContent).toContain("main_menu.play_desc");
    expect(menu.querySelector("local-brand")?.getAttribute("size")).toBe(
      "hero",
    );
    expect(menu.textContent).toContain("main_menu.tagline");
    expect(menu.textContent).not.toContain("local.based_on");

    items[0].click();
    expect(showPage).toHaveBeenCalledExactlyOnceWith("page-single-player");
    items[2].click();
    expect(showPage).toHaveBeenLastCalledWith("page-about");
  });

  it("adds Multiplayer only when the hosted profile enables it", async () => {
    bootstrap({ multiplayer: true });
    vi.spyOn(PublicLobbySocket.prototype, "start").mockResolvedValue();
    vi.spyOn(PublicLobbySocket.prototype, "stop").mockImplementation(() => {});
    const nav = new DesktopNavBar();
    document.body.append(nav);
    await nav.updateComplete;
    expect(
      [...nav.querySelectorAll<HTMLElement>(".nav-menu-item[data-page]")].map(
        (item) => item.dataset.page,
      ),
    ).toContain("page-multiplayer");
    expect(nav.querySelector("[data-server-status]")?.textContent).toContain(
      "local.online_badge",
    );
    const menu = new MainMenu();
    document.body.append(menu);
    await menu.updateComplete;
    expect(
      [...menu.querySelectorAll<HTMLButtonElement>("[data-menu-item]")].map(
        (item) => item.dataset.menuItem,
      ),
    ).toEqual([
      "page-single-player",
      "page-multiplayer",
      "page-settings",
      "page-about",
    ]);
    // The next public match is featured live; "All lobbies" opens the list.
    expect(PublicLobbySocket.prototype.start).toHaveBeenCalledOnce();
    expect(menu.querySelector('live-lobby-card[type="ffa"]')).not.toBeNull();
    const showPage = vi.fn();
    window.showPage = showPage;
    menu
      .querySelector<HTMLButtonElement>("[data-main-menu-all-lobbies]")
      ?.click();
    expect(showPage).toHaveBeenCalledWith("page-multiplayer");
    menu.remove();
    expect(PublicLobbySocket.prototype.stop).toHaveBeenCalled();
  });

  it("explains how to play when there are no public lobbies", async () => {
    bootstrap();
    const menu = new MainMenu();
    document.body.append(menu);
    await menu.updateComplete;
    expect(menu.querySelector("[data-main-menu-howto]")).not.toBeNull();
    expect(menu.querySelector("live-lobby-card")).toBeNull();
  });

  it("links the About page and the footer to the configured source", async () => {
    bootstrap({ sourceUrl: "https://example.org/territory-lab" });
    const about = new AboutPage();
    const footer = new Footer();
    document.body.append(about, footer);
    await Promise.all([about.updateComplete, footer.updateComplete]);
    expect(
      about.querySelector("[data-about-source]")?.getAttribute("href"),
    ).toBe("https://example.org/territory-lab");
    expect(
      footer.querySelector('a[href="https://example.org/territory-lab"]'),
    ).not.toBeNull();
    expect(about.textContent).toContain("about.licence");
    expect(about.textContent).toContain("local.copyright");
    expect(about.querySelector(".game-version-display")).toBeNull();
    expect(
      about.querySelector('.nav-menu-item[data-page="page-main-menu"]'),
    ).not.toBeNull();

    about.classList.add("hidden");
    expect(about.isOpen()).toBe(false);
    about.open();
    expect(about.isOpen()).toBe(true);
    expect(about.classList.contains("hidden")).toBe(false);
    about.close();
    expect(about.isOpen()).toBe(false);
    expect(about.classList.contains("hidden")).toBe(true);

    // Without a configured URL the upstream project is linked.
    bootstrap();
    const plain = new AboutPage();
    document.body.append(plain);
    await plain.updateComplete;
    expect(
      plain.querySelector("[data-about-source]")?.getAttribute("href"),
    ).toBe(UPSTREAM_SOURCE_URL);
  });

  it("shows the legal pages only in a hosted deployment", async () => {
    bootstrap({ hosted: true });
    const footer = new Footer();
    const about = new AboutPage();
    document.body.append(footer, about);
    await Promise.all([footer.updateComplete, about.updateComplete]);
    expect(
      footer.querySelector('[data-legal-link="privacy"]')?.getAttribute("href"),
    ).toBe("/privacy");
    expect(
      footer.querySelector('[data-legal-link="terms"]')?.getAttribute("href"),
    ).toBe("/terms");
    expect(about.querySelector('[data-legal-link="terms"]')).not.toBeNull();
    expect(footer.textContent).not.toContain("local.local_only_notice");

    bootstrap();
    const local = new Footer();
    document.body.append(local);
    await local.updateComplete;
    expect(local.querySelector("[data-legal-link]")).toBeNull();
    expect(local.textContent).toContain("local.local_only_notice");
  });

  it("gives the desktop nav bar and the setup page a way back to the menu", async () => {
    bootstrap();
    const nav = new DesktopNavBar();
    document.body.append(nav);
    await nav.updateComplete;
    const pages = [
      ...nav.querySelectorAll<HTMLElement>(".nav-menu-item[data-page]"),
    ].map((item) => item.dataset.page);
    expect(pages).toEqual([
      "page-main-menu",
      "page-single-player",
      "page-settings",
      "page-about",
    ]);
    expect(nav.querySelector("[data-server-status]")?.textContent).toContain(
      "local.offline_badge",
    );
    expect(nav.querySelector("#hamburger-btn")).not.toBeNull();

    const setup = new SinglePlayerModal();
    document.body.append(setup);
    await setup.updateComplete;
    expect(
      setup.querySelector('[data-setup-back][data-page="page-main-menu"]'),
    ).not.toBeNull();
  });
});
