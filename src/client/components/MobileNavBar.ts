import { html, LitElement, TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";
import { ClientEnv } from "../ClientEnv";
import { translateText } from "../Utils";
import "./LocalBrand";
import { NavNotificationsController } from "./NavNotificationsController";
import { shellIcon, ShellIconName } from "./ui/ShellIcons";

const MOBILE_ITEM =
  "nav-menu-item block w-full text-left font-bold uppercase tracking-[0.05em] " +
  "text-white/70 transition-all duration-200 cursor-pointer " +
  "hover:text-blue-600 hover:translate-x-2.5 " +
  "hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] " +
  "[&.active]:text-blue-600 [&.active]:translate-x-2.5 " +
  "[&.active]:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] " +
  "text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]";

@customElement("mobile-nav-bar")
export class MobileNavBar extends LitElement {
  private _notifications = new NavNotificationsController(this);

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("showPage", this._onShowPage);

    const current = window.currentPageId;
    if (current) {
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
      const inner = el.querySelector("button");
      if ((el as HTMLElement).dataset.page === pageId) {
        el.classList.add("active");
        inner?.classList.add("active");
      } else {
        el.classList.remove("active");
        inner?.classList.remove("active");
      }
    });
  }

  private _renderDot(color: string): TemplateResult {
    return html`<span class="relative ml-2 shrink-0 -mt-2 w-2 h-2">
      <span class="absolute inset-0 ${color} rounded-full animate-ping"></span>
      <span class="absolute inset-0 ${color} rounded-full"></span>
    </span>`;
  }

  render() {
    window.currentPageId ??= ClientEnv.isLocalOnly()
      ? "page-main-menu"
      : "page-play";
    const currentPage = window.currentPageId;

    if (ClientEnv.isLocalOnly()) {
      const multiplayer = ClientEnv.multiplayerEnabled();
      const item = (pageId: string, icon: ShellIconName, labelKey: string) =>
        html`<button
          class="nav-menu-item ${currentPage === pageId
            ? "active"
            : ""} flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-base font-bold uppercase tracking-[0.12em] text-white/75 transition-colors hover:bg-white/5 hover:text-white [&.active]:bg-cyan-400/10 [&.active]:text-cyan-100"
          data-page=${pageId}
        >
          <span class="text-cyan-300">${shellIcon(icon)}</span>
          ${translateText(labelKey)}
        </button>`;
      return html`
        <div data-ui-audit-root="setup" class="flex h-full flex-col gap-2 p-5">
          <local-brand></local-brand>
          <div
            id="game-version"
            class="mb-4 mt-1 text-[10px] uppercase tracking-widest text-white/35"
          ></div>
          ${item("page-main-menu", "home", "main_menu.home")}
          ${item("page-single-player", "play", "main_menu.play")}
          ${multiplayer
            ? item("page-multiplayer", "users", "main_menu.multiplayer")
            : ""}
          ${item("page-settings", "cog", "local.settings")}
          ${item("page-about", "info", "main_menu.about")}
          <div
            data-local-matte="subpanel"
            class="mt-auto inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold uppercase tracking-widest ${multiplayer
              ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
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
          </div>
        </div>
      `;
    }

    return html`
      <!-- Border Segments (Custom right border with gap for button) -->
      <div
        class="absolute right-0 top-0 w-px bg-transparent"
        style="height: calc(50% - 64px)"
      ></div>
      <div
        class="absolute right-0 bottom-0 w-px bg-transparent"
        style="height: calc(50% - 64px)"
      ></div>

      <div
        class="flex-1 w-full flex flex-col justify-start overflow-y-auto lg:pt-[clamp(1rem,3vh,4rem)] lg:pb-[clamp(0.5rem,2vh,2rem)] lg:px-[clamp(1rem,1.5vw,2rem)] pt-4 pb-4 px-5 gap-4 lg:gap-[clamp(1rem,3vh,3rem)]"
      >
        <!-- Logo + Menu -->
        <div
          class="flex flex-col text-malibu-blue mb-4 ml-[clamp(0.2rem,0.4vw,0.4vh)]"
        >
          <div class="flex flex-col items-center gap-1">
            <img
              src=${assetUrl("images/OpenFrontLogo.svg")}
              alt="OpenFront"
              class="w-auto h-auto max-w-[220px] max-h-[4.5rem]"
            />
            <div
              id="game-version"
              class="l-header__highlightText text-center"
            ></div>
          </div>
        </div>
        <!-- Mobile Navigation Menu Items (same order as the desktop bar) -->
        <button
          class="${MOBILE_ITEM} ${currentPage === "page-play" ? "active" : ""}"
          data-page="page-play"
          data-i18n="main.play"
        ></button>
        <div
          class="no-crazygames nav-menu-item flex items-center w-full cursor-pointer"
          data-page="page-item-store"
          @click=${this._notifications.onStoreClick}
        >
          <button class="${MOBILE_ITEM}" data-i18n="main.store"></button>
          ${this._notifications.showStoreDot()
            ? this._renderDot("bg-red-500")
            : ""}
        </div>
        <button
          class="${MOBILE_ITEM} ${currentPage === "page-inventory"
            ? "active"
            : ""}"
          data-page="page-inventory"
          data-i18n="main.inventory"
        ></button>
        <button
          class="${MOBILE_ITEM}"
          data-page="page-leaderboard"
          data-i18n="main.leaderboard"
        ></button>
        <button
          class="no-crazygames ${MOBILE_ITEM}"
          data-page="page-clan"
          data-i18n="main.clans"
        ></button>
        <div
          class="flex flex-col w-full mt-auto [.in-game_&]:hidden items-end justify-end pt-4 border-t border-white/10"
        ></div>
      </div>
    `;
  }
}
