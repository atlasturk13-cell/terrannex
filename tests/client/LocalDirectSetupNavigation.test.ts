import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initNavigation,
  navigateFromHistory,
  resolveNavigationPage,
  restoreNavigationAfterLobbyLeave,
} from "../../src/client/Navigation";
import { MobileNavBar } from "../../src/client/components/MobileNavBar";
import { PlayPage } from "../../src/client/components/PlayPage";

function setLocalOnly(localOnly: boolean) {
  window.BOOTSTRAP_CONFIG = {
    gameEnv: "dev",
    numWorkers: 1,
    turnstileSiteKey: "unused",
    jwtAudience: "localhost",
    instanceId: localOnly ? "LOCAL_ONLY" : "web",
    gitCommit: "TEST",
    localOnly,
  };
}

afterEach(() => {
  document.body.replaceChildren();
  window.BOOTSTRAP_CONFIG = undefined;
  window.currentPageId = undefined;
  window.showPage = undefined;
  history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

describe("LOCAL_ONLY main menu navigation", () => {
  it("resolves the old play route to the main menu and opens it on initialization", () => {
    setLocalOnly(true);
    const play = document.createElement("div");
    play.id = "page-play";
    const menu = document.createElement("div");
    menu.id = "page-main-menu";
    menu.className = "hidden page-content";
    const setup = document.createElement("div") as unknown as HTMLElement & {
      open: ReturnType<typeof vi.fn>;
    };
    setup.id = "page-single-player";
    setup.className = "hidden page-content";
    setup.setAttribute("inline", "");
    setup.open = vi.fn();
    document.body.append(play, menu, setup);

    expect(resolveNavigationPage("page-play")).toBe("page-main-menu");
    initNavigation();

    expect(window.currentPageId).toBe("page-main-menu");
    expect(play.classList.contains("hidden")).toBe(true);
    expect(menu.classList.contains("hidden")).toBe(false);
    expect(menu.classList.contains("block")).toBe(true);
    expect(setup.classList.contains("hidden")).toBe(true);
    expect(setup.open).not.toHaveBeenCalled();

    // Play from the menu opens the setup page; the old route returns home.
    window.showPage?.("page-single-player");
    expect(window.currentPageId).toBe("page-single-player");
    expect(setup.open).toHaveBeenCalledOnce();
    expect(menu.classList.contains("hidden")).toBe(true);
    window.showPage?.("page-play");
    expect(window.currentPageId).toBe("page-main-menu");
  });

  it("preserves the hosted play route", () => {
    setLocalOnly(false);
    const play = document.createElement("div");
    play.id = "page-play";
    document.body.append(play);

    expect(resolveNavigationPage("page-play")).toBe("page-play");
    initNavigation();
    expect(window.currentPageId).toBe("page-play");
    expect(play.classList.contains("hidden")).toBe(false);
  });

  it("returns local lobby exits to the main menu without rerouting hosted exits", () => {
    const showPage = vi.fn();
    window.showPage = showPage;

    expect(restoreNavigationAfterLobbyLeave(true)).toBe(true);
    expect(showPage).toHaveBeenCalledExactlyOnceWith("page-main-menu");

    showPage.mockClear();
    window.currentPageId = "page-multiplayer";
    expect(restoreNavigationAfterLobbyLeave(true)).toBe(true);
    expect(showPage).toHaveBeenCalledExactlyOnceWith("page-multiplayer");

    showPage.mockClear();
    expect(restoreNavigationAfterLobbyLeave(false)).toBe(false);
    expect(showPage).not.toHaveBeenCalled();
  });

  it("leaves no local landing controls and gives mobile both Menu and Play", async () => {
    setLocalOnly(true);
    const play = new PlayPage();
    const mobile = new MobileNavBar();
    document.body.append(play, mobile);
    await Promise.all([play.updateComplete, mobile.updateComplete]);

    expect(play.querySelector("username-input")).toBeNull();
    expect(play.querySelector("button")).toBeNull();
    expect(play.querySelector("#page-play")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(
      mobile.querySelector('.nav-menu-item[data-page="page-single-player"]'),
    ).not.toBeNull();
    expect(
      mobile.querySelector('.nav-menu-item[data-page="page-main-menu"]'),
    ).not.toBeNull();
  });
});

describe("shell pages", () => {
  function inlinePage(id: string) {
    let open = false;
    const page = document.createElement("div") as unknown as HTMLElement & {
      open: () => void;
      close: (args?: Record<string, unknown>) => void;
      isOpen: () => boolean;
    };
    page.id = id;
    page.className = "hidden page-content";
    page.setAttribute("inline", "");
    page.open = () => {
      open = true;
    };
    page.isOpen = () => open;
    // Mirrors BaseModal.close(): without skipNavigation it routes home.
    page.close = (args) => {
      open = false;
      if (args?.skipNavigation !== true) window.showPage?.("page-play");
      else page.classList.add("hidden");
    };
    return page;
  }

  function visiblePages() {
    return [...document.querySelectorAll(".page-content")]
      .filter((p) => !p.classList.contains("hidden"))
      .map((p) => p.id);
  }

  it("shows exactly one page however the user moves between them", () => {
    setLocalOnly(true);
    const menu = document.createElement("div");
    menu.id = "page-main-menu";
    menu.className = "hidden page-content";
    const multiplayer = document.createElement("div");
    multiplayer.id = "page-multiplayer";
    multiplayer.className = "hidden page-content";
    const setup = inlinePage("page-single-player");
    const settings = inlinePage("page-settings");
    document.body.append(menu, multiplayer, setup, settings);
    initNavigation();

    for (const page of [
      "page-single-player",
      "page-multiplayer",
      "page-settings",
      "page-single-player",
      "page-main-menu",
      "page-settings",
    ]) {
      window.showPage?.(page);
      expect(visiblePages()).toEqual([page]);
    }
    expect(setup.isOpen()).toBe(false);
    expect(settings.isOpen()).toBe(true);
  });

  it("gives each page a history entry that Back returns to", () => {
    setLocalOnly(true);
    const menu = document.createElement("div");
    menu.id = "page-main-menu";
    menu.className = "hidden page-content";
    const settings = inlinePage("page-settings");
    document.body.append(menu, settings);
    initNavigation();
    expect(history.state).toMatchObject({ page: "page-main-menu" });

    window.showPage?.("page-settings");
    expect(history.state).toMatchObject({ page: "page-settings" });

    // popstate hands the earlier entry's state back to the router.
    expect(navigateFromHistory({ page: "page-main-menu" })).toBe(true);
    expect(visiblePages()).toEqual(["page-main-menu"]);
    // A history move never creates a new entry of its own.
    expect(history.state).toMatchObject({ page: "page-settings" });
    expect(navigateFromHistory(null)).toBe(false);
  });

  it("names the browser tab after the page", () => {
    setLocalOnly(true);
    const menu = document.createElement("div");
    menu.id = "page-main-menu";
    menu.className = "hidden page-content";
    const settings = inlinePage("page-settings");
    document.body.append(menu, settings);
    initNavigation();
    expect(document.title).toBe("local.title");
    window.showPage?.("page-settings");
    expect(document.title).toBe("user_setting.title · local.brand");
  });
});
