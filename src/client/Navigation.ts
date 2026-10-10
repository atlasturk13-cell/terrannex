import { ClientEnv } from "./ClientEnv";
import { translateText } from "./Utils";

// Some consumers (and older embedders) provide only the original ClientEnv
// surface. Treat a missing local-only probe as the normal hosted build.
function isLocalOnlyShell(): boolean {
  return (
    typeof (ClientEnv as { isLocalOnly?: () => boolean }).isLocalOnly ===
      "function" && ClientEnv.isLocalOnly()
  );
}

const PAGE_TITLE_KEYS: Record<string, string> = {
  "page-single-player": "local.match_setup",
  "page-multiplayer": "multiplayer.title",
  "page-settings": "user_setting.title",
  "page-about": "about.title",
};

/**
 * The browser tab title for a shell page: "Settings · Terrannex", or
 * the full site title on the home page. Local profile only; hosted builds
 * keep their own title.
 */
export function applyPageTitle(pageId: string | undefined) {
  if (!isLocalOnlyShell()) return;
  const site = translateText("local.title");
  const key = pageId === undefined ? undefined : PAGE_TITLE_KEYS[pageId];
  document.title =
    key === undefined
      ? site
      : `${translateText(key)} · ${translateText("local.brand")}`;
}

export function resolveNavigationPage(pageId: string): string {
  const localOnly = isLocalOnlyShell();
  const home = localOnly ? "page-main-menu" : "page-play";
  if (pageId === "page-play") return home;
  // A route to a page this build does not ship (e.g. an old #modal=store
  // link) lands on the home page instead of a blank screen.
  if (
    typeof document !== "undefined" &&
    document.getElementById(home) !== null &&
    document.getElementById(pageId) === null
  ) {
    return home;
  }
  return pageId;
}

export function restoreNavigationAfterLobbyLeave(localOnly: boolean): boolean {
  if (!localOnly) return false;
  // Leaving a lobby joined from the Multiplayer page goes back to its list.
  window.showPage?.(
    window.currentPageId === "page-multiplayer"
      ? "page-multiplayer"
      : "page-main-menu",
  );
  return true;
}

export function closeMobileSidebar() {
  const sidebar = document.getElementById("sidebar-menu");
  const backdrop = document.getElementById("mobile-menu-backdrop");
  if (sidebar?.classList.contains("open")) {
    sidebar.classList.remove("open");
    backdrop?.classList.remove("open");
    document.documentElement.classList.remove("overflow-hidden");
    sidebar.setAttribute("aria-hidden", "true");
    backdrop?.setAttribute("aria-hidden", "true");
    const hb = document.getElementById("hamburger-btn");
    if (hb) hb.setAttribute("aria-expanded", "false");
  }
}

/** True while a page change was triggered by browser back/forward. */
let navigatingFromHistory = false;

/** Shell pages get a browser-history entry so Back returns to the last page. */
function pushPageHistory(pageId: string) {
  if (navigatingFromHistory) return;
  if (document.body.classList.contains("in-game")) return;
  const state = history.state as { page?: unknown } | null;
  if (state?.page === pageId) return;
  try {
    if (state?.page === undefined) {
      // First page of the session: tag the current entry instead of adding one.
      history.replaceState({ ...(state ?? {}), page: pageId }, "");
    } else {
      history.pushState(
        { page: pageId },
        "",
        window.location.pathname + window.location.search,
      );
    }
  } catch {
    // History can be unavailable in sandboxed frames; navigation still works.
  }
}

/**
 * Browser back/forward to a shell page. Returns true when the history entry
 * belonged to the shell router (so other hash handlers can skip it).
 */
export function navigateFromHistory(state: unknown): boolean {
  const page = (state as { page?: unknown } | null)?.page;
  if (typeof page !== "string" || !window.showPage) return false;
  navigatingFromHistory = true;
  try {
    window.showPage(page);
  } finally {
    navigatingFromHistory = false;
  }
  return true;
}

function closePage(page: Element) {
  const modal = page as Element & {
    isOpen?: () => boolean;
    close?: (args?: Record<string, unknown>) => void;
  };
  if (
    typeof modal.isOpen === "function" &&
    modal.isOpen() &&
    typeof modal.close === "function"
  ) {
    // skipNavigation: the page being opened decides what shows next; letting
    // the closing page navigate "home" stacked the main menu under it.
    modal.close({ skipNavigation: true });
  }
  page.classList.add("hidden");
  page.classList.remove("block");
}

export function initNavigation() {
  const showPage = (requestedPageId: string) => {
    const pageId = resolveNavigationPage(requestedPageId);
    const previousPageId = window.currentPageId;
    window.currentPageId = pageId;
    pushPageHistory(pageId);

    // Close mobile sidebar if a nav item was clicked
    closeMobileSidebar();

    // Exactly one shell page is visible: close every other open page.
    document.querySelectorAll(".page-content").forEach((page) => {
      if (page.id !== pageId) closePage(page);
    });

    // Handle page-play separately (it's not a page-content element)
    const pagePlayEl = document.getElementById("page-play");
    if (pageId === "page-play") {
      pagePlayEl?.classList.remove("hidden");
    } else {
      pagePlayEl?.classList.add("hidden");
    }

    // Show the target page if it's a modal
    if (pageId !== "page-play") {
      const target = document.getElementById(pageId);
      if (target) {
        target.classList.remove("hidden");
        // Modals need block display explicitly
        if (target.classList.contains("page-content")) {
          target.classList.add("block");
        }

        // If the target itself is a modal component with inline attribute, open it
        if (
          target.hasAttribute("inline") &&
          typeof (target as any).open === "function"
        ) {
          (target as any).open();
        }
      }
    }

    // Update active state on menu items
    document.querySelectorAll(".nav-menu-item").forEach((item) => {
      if ((item as HTMLElement).dataset.page === pageId) {
        item.classList.add("active");
      } else {
        item.classList.remove("active");
      }
    });

    if (previousPageId !== pageId) {
      document
        .querySelector<HTMLElement>("main-layout main > div")
        ?.scrollTo?.({
          top: 0,
        });
    }

    applyPageTitle(pageId);

    // Dispatch CustomEvent to notify listeners of page change
    window.dispatchEvent(new CustomEvent("showPage", { detail: pageId }));
  };

  window.showPage = showPage;

  // Use event delegation for navigation items (they may be inside Lit components)
  document.addEventListener("click", async (e) => {
    const target = (e.target as HTMLElement).closest(
      ".nav-menu-item[data-page]",
    );
    if (target) {
      const pageId = (target as HTMLElement).dataset.page;
      if (!pageId) return;

      // showPage() closes the currently visible modal, so respect its
      // close-confirmation guard first (e.g. the leave-lobby prompt).
      const visibleModal = document.querySelector(
        ".page-content:not(.hidden)",
      ) as any;
      if (
        visibleModal &&
        typeof visibleModal.isOpen === "function" &&
        visibleModal.isOpen() &&
        typeof visibleModal.confirmBeforeClose === "function" &&
        !(await visibleModal.confirmBeforeClose())
      ) {
        return;
      }

      showPage(pageId);
    }
  });

  // Wait for main-layout component to render before setting up click handler
  customElements.whenDefined("main-layout").then(() => {
    // Handle clicks on main container to close open modals (navigate back)
    const mainEl = document.querySelector("main");

    if (mainEl) {
      mainEl.addEventListener("click", async (e: Event) => {
        const target = e.target as HTMLElement;
        const isPlayPageHidden = document
          .getElementById("page-play")
          ?.classList.contains("hidden");

        // Only proceed if we are NOT on the play page (meaning a modal page is open)
        if (isPlayPageHidden) {
          // Close modal if clicking on main element itself, or directly on a page-content element
          const isOnMain = target === mainEl;
          const isOnPageContent = target.classList.contains("page-content");

          if (isOnMain || isOnPageContent) {
            // Find the open modal and call its close() method instead of showPage directly
            // This ensures proper cleanup (like websocket disconnection)
            const openModal = document.querySelector(
              ".page-content:not(.hidden)",
            ) as any;

            if (openModal && typeof openModal.close === "function") {
              // Check confirmation guard before closing
              if (
                typeof openModal.confirmBeforeClose === "function" &&
                !(await openModal.confirmBeforeClose())
              ) {
                return;
              }
              // Call leaveLobby or closeAndLeave first if it exists (for lobby modals)
              if (typeof openModal.leaveLobby === "function") {
                openModal.leaveLobby();
              } else if (typeof openModal.closeAndLeave === "function") {
                openModal.closeAndLeave();
                return; // closeAndLeave already calls close()
              }
              openModal.close();
            } else {
              showPage("page-play");
            }
          }
        }
      });
    }
  });

  // The local shell opens on its main menu (hosted builds keep the play page).
  showPage(resolveNavigationPage("page-play"));
}
