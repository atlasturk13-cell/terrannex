import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";
import { ClientEnv } from "../ClientEnv";
import { translateText } from "../Utils";
import "./AccountCorner";
import "./LocalBrand";
import "./NavAccountMenu";
import { NavNotificationsController } from "./NavNotificationsController";
import "./NavUtilityIcons";
import { shellIcon } from "./ui/ShellIcons";

@customElement("desktop-nav-bar")
export class DesktopNavBar extends LitElement {
  private _notifications = new NavNotificationsController(this);

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("showPage", this._onShowPage);

    const current = window.currentPageId;
    if (current) {
      // Wait for render
      this.updateComplete.then(() => {
        this._updateActiveState(current);
      });
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("showPage", this._onShowPage);
  }

  private _onShowPage = (e: Event) => {
    const pageId = (e as CustomEvent).detail;
    this._updateActiveState(pageId);
  };

  private _updateActiveState(pageId: string) {
    this.querySelectorAll(".nav-menu-item").forEach((el) => {
      if ((el as HTMLElement).dataset.page === pageId) {
        el.classList.add("active");
      } else {
        el.classList.remove("active");
      }
    });
  }

  private localItem(pageId: string, labelKey: string, currentPage: string) {
    return html`<button
      class="nav-menu-item ${currentPage === pageId
        ? "active"
        : ""} relative px-1 py-2 text-[13px] font-semibold uppercase tracking-[0.14em] text-white/65 transition-colors hover:text-white [&.active]:text-white after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:rounded-full after:bg-cyan-300 after:opacity-0 after:transition-opacity [&.active]:after:opacity-100"
      data-page=${pageId}
    >
      ${translateText(labelKey)}
    </button>`;
  }

  private renderLocal(currentPage: string) {
    const multiplayer = ClientEnv.multiplayerEnabled();
    return html`
      <header
        data-local-matte="setup"
        data-ui-audit-root="setup"
        class="relative z-[60] w-full shrink-0 border-b border-white/10 bg-zinc-950/95"
      >
        <div
          class="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-4 px-3 sm:px-6 lg:h-16 lg:px-8"
        >
          <div class="flex min-w-0 items-center gap-2">
            <button
              id="hamburger-btn"
              type="button"
              class="flex h-10 w-10 items-center justify-center rounded-lg text-white/85 hover:bg-white/10 lg:hidden"
              aria-label=${translateText("main.menu")}
              aria-controls="sidebar-menu"
              aria-haspopup="dialog"
              aria-expanded="false"
            >
              ${shellIcon("menu", "h-6 w-6")}
            </button>
            <button
              type="button"
              class="flex min-w-0 items-center gap-3 rounded-lg text-left"
              data-brand-home
              aria-label=${translateText("main_menu.title")}
              @click=${() => window.showPage?.("page-main-menu")}
            >
              <local-brand></local-brand>
            </button>
            <div
              id="game-version"
              class="hidden text-[10px] uppercase tracking-widest text-white/35 xl:block"
            ></div>
          </div>
          <nav
            class="hidden items-center gap-6 lg:flex"
            aria-label=${translateText("main_menu.title")}
          >
            ${this.localItem("page-main-menu", "main_menu.home", currentPage)}
            ${this.localItem(
              "page-single-player",
              "main_menu.play",
              currentPage,
            )}
            ${multiplayer
              ? this.localItem(
                  "page-multiplayer",
                  "main_menu.multiplayer",
                  currentPage,
                )
              : ""}
            ${this.localItem("page-settings", "local.settings", currentPage)}
            ${this.localItem("page-about", "main_menu.about", currentPage)}
          </nav>
          <div class="flex items-center gap-3">
            <span
              data-server-status
              class="hidden items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest sm:inline-flex ${multiplayer
                ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                : "border-white/15 bg-white/5 text-white/60"}"
            >
              <span
                class="h-1.5 w-1.5 rounded-full ${multiplayer
                  ? "bg-emerald-300"
                  : "bg-white/50"}"
              ></span>
              ${multiplayer
                ? translateText("local.online_badge")
                : translateText("local.offline_badge")}
            </span>
            <account-corner></account-corner>
          </div>
        </div>
      </header>
    `;
  }

  render() {
    window.currentPageId ??= "page-play";
    const currentPage = window.currentPageId;

    if (ClientEnv.isLocalOnly()) {
      return this.renderLocal(currentPage);
    }

    return html`
      <nav
        class="hidden lg:flex w-full bg-zinc-900/90 backdrop-blur-md items-center justify-center gap-8 py-4 shrink-0 z-50 relative"
      >
        <div class="flex flex-col items-center justify-center">
          <div class="h-8">
            <img
              class="block h-full aspect-[1364/259]"
              src=${assetUrl("images/OpenFrontLogo.svg")}
              alt="OpenFront"
            />
          </div>
          <div
            id="game-version"
            class="l-header__highlightText text-center"
          ></div>
        </div>
        <button
          class="nav-menu-item ${currentPage === "page-play"
            ? "active"
            : ""} text-white/70 hover:text-malibu-blue  font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-malibu-blue "
          data-page="page-play"
          data-i18n="main.play"
        ></button>
        <!-- Desktop Navigation Menu Items -->
        <div class="relative no-crazygames">
          <button
            class="nav-menu-item ${currentPage === "page-item-store"
              ? "active"
              : ""} text-white/70 hover:text-malibu-blue  font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-malibu-blue "
            data-page="page-item-store"
            data-i18n="main.store"
            @click=${this._notifications.onStoreClick}
          ></button>
          ${this._notifications.showStoreDot()
            ? html`
                <span
                  class="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-ping"
                ></span>
                <span
                  class="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full"
                ></span>
              `
            : ""}
        </div>
        <button
          class="nav-menu-item ${currentPage === "page-inventory"
            ? "active"
            : ""} text-white/70 hover:text-malibu-blue font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-malibu-blue"
          data-page="page-inventory"
          data-i18n="main.inventory"
        ></button>
        <button
          class="nav-menu-item text-white/70 hover:text-malibu-blue  font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-malibu-blue "
          data-page="page-leaderboard"
          data-i18n="main.leaderboard"
        ></button>
        <button
          class="no-crazygames nav-menu-item text-white/70 hover:text-blue-500 font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-blue-500"
          data-page="page-clan"
          data-i18n="main.clans"
        ></button>
        <!-- Utility cluster: bell, help and the profile control are account
             /notification affordances, not page links, so they sit tight
             together behind a divider instead of in the nav item list. -->
        <div class="flex items-center gap-1 pl-5 ml-1 border-l border-white/10">
          <nav-utility-icons size="desktop"></nav-utility-icons>
          <nav-account-menu variant="desktop"></nav-account-menu>
        </div>
      </nav>
    `;
  }
}
