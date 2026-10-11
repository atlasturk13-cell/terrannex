import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { PublicGames } from "../../core/Schemas";
import { ClientEnv } from "../ClientEnv";
import { publicLobbyFeed, PublicLobbySnapshot } from "../PublicLobbyFeed";
import { translateText } from "../Utils";
import "./LiveLobbyCard";
import "./MenuAdSlot";
import { shellIcon, ShellIconName } from "./ui/ShellIcons";

/**
 * The landing page of the shell: brand, pitch and one big Play button, the
 * secondary entries (Multiplayer when the server schedules public games,
 * Settings, About), and — when multiplayer is on — the next public match as
 * a live card, as OpenFront's home page leads with its lobby. Navigation
 * goes through the shared `showPage` router like the nav bar items.
 */
@customElement("main-menu")
export class MainMenu extends LitElement {
  @state() private lobbies: PublicGames | null = null;
  @state() private serverTimeOffset = 0;
  private unsubscribe: (() => void) | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("showPage", this.onShowPage);
    if (!this.classList.contains("hidden")) this.activate();
  }

  disconnectedCallback() {
    window.removeEventListener("showPage", this.onShowPage);
    this.deactivate();
    super.disconnectedCallback();
  }

  private onShowPage = (event: Event) => {
    const pageId = (event as CustomEvent<unknown>).detail;
    if (pageId === "page-main-menu") this.activate();
    else this.deactivate();
    this.requestUpdate();
  };

  /** The featured lobby is live only while the menu is showing. */
  private activate() {
    if (this.unsubscribe !== null || !ClientEnv.multiplayerEnabled()) return;
    this.unsubscribe = publicLobbyFeed.subscribe(
      (snapshot: PublicLobbySnapshot) => {
        this.lobbies = snapshot.lobbies;
        this.serverTimeOffset = snapshot.serverTimeOffset;
      },
    );
  }

  private deactivate() {
    if (this.unsubscribe === null) return;
    this.unsubscribe();
    this.unsubscribe = null;
    this.lobbies = null;
  }

  private navigate(pageId: string) {
    window.showPage?.(pageId);
  }

  private secondary(
    pageId: string,
    icon: ShellIconName,
    labelKey: string,
    descriptionKey: string,
  ) {
    return html`<button
      type="button"
      class="main-menu-item group flex items-center gap-3 rounded-2xl border border-white/10 bg-zinc-950/75 px-4 py-3.5 text-left transition hover:-translate-y-0.5 hover:border-cyan-300/50 hover:bg-zinc-900/90 sm:flex-col sm:items-start"
      data-menu-item=${pageId}
      @click=${() => this.navigate(pageId)}
    >
      <span
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 text-cyan-200 ring-1 ring-white/10 transition group-hover:bg-cyan-400/15 group-hover:ring-cyan-300/40"
        >${shellIcon(icon)}</span
      >
      <span class="min-w-0">
        <span
          class="block text-sm font-black uppercase tracking-[0.14em] text-white"
          >${translateText(labelKey)}</span
        >
        <span class="mt-0.5 block text-xs leading-5 text-white/55"
          >${translateText(descriptionKey)}</span
        >
      </span>
    </button>`;
  }

  private feature(icon: ShellIconName, labelKey: string) {
    return html`<li
      class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/75"
    >
      <span class="text-cyan-300">${shellIcon(icon, "h-3.5 w-3.5")}</span>
      ${translateText(labelKey)}
    </li>`;
  }

  private renderLive() {
    if (!ClientEnv.multiplayerEnabled()) {
      return this.renderHowToPlay();
    }
    return html`<section
      data-main-menu-live
      class="flex flex-col gap-3"
      aria-label=${translateText("main_menu.live_title")}
    >
      <div class="flex items-center justify-between gap-3">
        <h2
          class="flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-white/80"
        >
          <span class="relative flex h-2 w-2">
            <span
              class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"
            ></span>
            <span
              class="relative inline-flex h-2 w-2 rounded-full bg-emerald-400"
            ></span>
          </span>
          ${translateText("main_menu.live_title")}
        </h2>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-cyan-200 hover:text-cyan-100"
          data-main-menu-all-lobbies
          @click=${() => this.navigate("page-multiplayer")}
        >
          ${translateText("main_menu.all_lobbies")}
          ${shellIcon("arrowRight", "h-3.5 w-3.5")}
        </button>
      </div>
      <live-lobby-card
        type="ffa"
        variant="hero"
        .lobby=${this.lobbies?.games?.ffa?.[0]}
        .serverTimeOffset=${this.serverTimeOffset}
        ?connecting=${this.lobbies === null}
      ></live-lobby-card>
      <p class="text-xs leading-5 text-white/50">
        ${translateText("main_menu.live_hint")}
      </p>
    </section>`;
  }

  private renderHowToPlay() {
    const steps = [
      ["map", "main_menu.step_spawn"],
      ["bolt", "main_menu.step_expand"],
      ["plane", "main_menu.step_build"],
    ] as const;
    return html`<section
      data-main-menu-howto
      class="rounded-2xl border border-white/10 bg-zinc-950/80 p-5"
    >
      <h2 class="text-xs font-black uppercase tracking-[0.22em] text-cyan-300">
        ${translateText("main_menu.howto_title")}
      </h2>
      <ol class="mt-4 grid gap-3">
        ${steps.map(
          ([icon, key], i) =>
            html`<li class="flex items-start gap-3">
              <span
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-200 ring-1 ring-cyan-300/25"
                >${shellIcon(icon)}</span
              >
              <span class="text-sm leading-6 text-white/75"
                ><span class="mr-1 font-black text-white">${i + 1}.</span
                >${translateText(key)}</span
              >
            </li>`,
        )}
      </ol>
    </section>`;
  }

  render() {
    const multiplayer = ClientEnv.multiplayerEnabled();
    return html`
      <div
        data-ui-audit-root="menu"
        class="main-menu-shell relative flex min-h-full w-full items-center justify-center overflow-y-auto px-4 py-8 sm:px-6 lg:py-12"
      >
        <div
          class="grid w-full max-w-6xl items-center gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]"
        >
          <div class="flex flex-col">
            <local-brand size="hero"></local-brand>
            <p class="mt-6 max-w-lg text-base leading-7 text-white/75">
              ${translateText("main_menu.tagline")}
            </p>
            <ul class="mt-5 flex flex-wrap gap-2">
              ${this.feature("map", "main_menu.feature_maps")}
              ${this.feature("plane", "main_menu.feature_air")}
              ${this.feature("cpu", "main_menu.feature_ai")}
            </ul>

            <nav
              aria-label=${translateText("main_menu.title")}
              class="mt-8 flex flex-col gap-3"
            >
              <button
                type="button"
                class="main-menu-item main-menu-play group relative flex items-center justify-between gap-4 overflow-hidden rounded-2xl bg-amber-400 px-6 py-5 text-left text-slate-950 shadow-[0_18px_50px_rgba(251,191,36,0.28)] transition hover:-translate-y-0.5 hover:bg-amber-300 active:translate-y-px"
                data-menu-item="page-single-player"
                @click=${() => this.navigate("page-single-player")}
              >
                <span class="relative z-10 flex items-center gap-4">
                  <span
                    class="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-950/90 text-amber-300"
                    >${shellIcon("play", "h-6 w-6")}</span
                  >
                  <span>
                    <span
                      class="block text-xl font-black uppercase tracking-[0.16em]"
                      >${translateText("main_menu.play")}</span
                    >
                    <span class="block text-xs font-semibold text-slate-900/75"
                      >${translateText("main_menu.play_desc")}</span
                    >
                  </span>
                </span>
                <span
                  class="relative z-10 transition-transform group-hover:translate-x-1"
                  >${shellIcon("arrowRight", "h-6 w-6")}</span
                >
                <span
                  aria-hidden="true"
                  class="main-menu-play-shine pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 skew-x-[-20deg] bg-white/35"
                ></span>
              </button>
              <div
                class="grid gap-3 ${multiplayer
                  ? "sm:grid-cols-3"
                  : "sm:grid-cols-2"}"
              >
                ${multiplayer
                  ? this.secondary(
                      "page-multiplayer",
                      "users",
                      "main_menu.multiplayer",
                      "main_menu.multiplayer_short",
                    )
                  : nothing}
                ${this.secondary(
                  "page-settings",
                  "cog",
                  "main_menu.settings",
                  "main_menu.settings_short",
                )}
                ${this.secondary(
                  "page-about",
                  "info",
                  "main_menu.about",
                  "main_menu.about_short",
                )}
              </div>
            </nav>
            <menu-ad-slot></menu-ad-slot>
          </div>
          ${this.renderLive()}
        </div>
      </div>
    `;
  }
}
