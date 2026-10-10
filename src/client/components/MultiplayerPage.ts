import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { PublicGames } from "../../core/Schemas";
import { ClientEnv } from "../ClientEnv";
import type { HostLobbyModal } from "../HostLobbyModal";
import type { JoinLobbyModal } from "../JoinLobbyModal";
import { publicLobbyFeed, PublicLobbySnapshot } from "../PublicLobbyFeed";
import type { UsernameInput } from "../UsernameInput";
import { translateText } from "../Utils";
import "./LiveLobbyCard";
import type { LiveLobbyType } from "./LiveLobbyCard";
import { shellIcon } from "./ui/ShellIcons";

/**
 * Multiplayer without the closed API: the public lobbies this server
 * schedules (FFA, teams, special) with their countdowns, plus the private
 * lobby flow (create and share a link, or join with a code). Shown only when
 * the hosted profile enables multiplayer; otherwise it explains that it is
 * off.
 */
@customElement("multiplayer-page")
export class MultiplayerPage extends LitElement {
  @state() private lobbies: PublicGames | null = null;
  @state() private serverTimeOffset = 0;
  @state() private nameValid = true;
  private unsubscribe: (() => void) | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("showPage", this.onShowPage);
    window.addEventListener("username-validity-change", this.onNameValidity);
    // The page sits in the shell from the first load; the lobby list is only
    // fetched while it is actually showing.
    if (!this.classList.contains("hidden")) this.activate();
  }

  disconnectedCallback() {
    window.removeEventListener("showPage", this.onShowPage);
    window.removeEventListener("username-validity-change", this.onNameValidity);
    this.deactivate();
    super.disconnectedCallback();
  }

  private onShowPage = (event: Event) => {
    const pageId = (event as CustomEvent<unknown>).detail;
    if (pageId === "page-multiplayer") this.activate();
    else this.deactivate();
    this.requestUpdate();
  };

  private onNameValidity = (event: Event) => {
    this.nameValid =
      (event as CustomEvent<{ isValid?: boolean }>).detail?.isValid ?? true;
  };

  private activate() {
    if (this.unsubscribe !== null || !ClientEnv.multiplayerEnabled()) return;
    this.unsubscribe = publicLobbyFeed.subscribe((snapshot) =>
      this.onSnapshot(snapshot),
    );
  }

  private deactivate() {
    if (this.unsubscribe === null) return;
    this.unsubscribe();
    this.unsubscribe = null;
    this.lobbies = null;
  }

  private onSnapshot(snapshot: PublicLobbySnapshot) {
    this.lobbies = snapshot.lobbies;
    this.serverTimeOffset = snapshot.serverTimeOffset;
  }

  /** Test seam: feed a lobby list as if it came from the socket. */
  public onLobbies(lobbies: PublicGames) {
    publicLobbyFeed.publish(lobbies);
    if (this.unsubscribe === null) {
      this.onSnapshot({ lobbies, serverTimeOffset: 0 });
    }
  }

  private usernameInput(): UsernameInput | null {
    return this.querySelector<UsernameInput>("username-input");
  }

  private canPlay(): boolean {
    const input = this.usernameInput();
    return (
      input === null || typeof input.canPlay !== "function" || input.canPlay()
    );
  }

  private openHost() {
    if (!this.canPlay()) return;
    (
      document.querySelector("host-lobby-modal") as HostLobbyModal | null
    )?.open();
  }

  private openJoin() {
    if (!this.canPlay()) return;
    (
      document.querySelector("join-lobby-modal") as JoinLobbyModal | null
    )?.open();
  }

  private lobbyCard(type: LiveLobbyType, variant: "hero" | "compact") {
    return html`<live-lobby-card
      .type=${type}
      .variant=${variant}
      .lobby=${this.lobbies?.games?.[type]?.[0]}
      .serverTimeOffset=${this.serverTimeOffset}
      ?connecting=${this.lobbies === null}
      ?disabled=${!this.nameValid}
      @join-lobby=${(event: Event) => {
        if (!this.canPlay()) event.stopPropagation();
      }}
    ></live-lobby-card>`;
  }

  render() {
    const back = html`<button
      type="button"
      class="nav-menu-item inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-semibold uppercase tracking-wider text-white/70 hover:border-cyan-300/40 hover:text-cyan-200"
      data-page="page-main-menu"
    >
      ← ${translateText("multiplayer.back")}
    </button>`;
    if (!ClientEnv.multiplayerEnabled()) {
      return html`<div
        data-ui-audit-root="multiplayer"
        class="flex h-full w-full items-center justify-center px-6 py-10"
      >
        <div
          data-multiplayer-disabled
          data-local-matte="subpanel"
          class="max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 text-center"
        >
          <p class="text-sm text-white/70">
            ${translateText("multiplayer.disabled")}
          </p>
          <div class="mt-4 flex justify-center">${back}</div>
        </div>
      </div>`;
    }
    return html`
      <div
        data-ui-audit-root="multiplayer"
        class="flex h-full w-full justify-center overflow-y-auto px-4 py-6 sm:px-6 lg:py-8"
      >
        <div class="w-full max-w-5xl">
          <header class="flex flex-wrap items-center justify-between gap-4">
            <div class="flex items-center gap-4">
              ${back}
              <div>
                <div
                  class="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-300"
                >
                  ${translateText("multiplayer.public_title")}
                </div>
                <h1
                  class="text-2xl font-black uppercase tracking-wide text-white lg:text-3xl"
                >
                  ${translateText("multiplayer.title")}
                </h1>
              </div>
            </div>
            <label class="flex w-full flex-col gap-1 sm:w-72">
              <span
                class="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50"
                >${translateText("multiplayer.name_label")}</span
              >
              <username-input
                data-multiplayer-commander="true"
                class="block min-h-11"
              ></username-input>
            </label>
          </header>

          <p class="mt-3 max-w-2xl text-sm text-white/60">
            ${translateText("multiplayer.public_desc")}
          </p>

          <section
            class="mt-5 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
          >
            ${this.lobbyCard("ffa", "hero")}
            <div class="grid gap-4">
              ${this.lobbyCard("special", "compact")}
              ${this.lobbyCard("team", "compact")}
            </div>
          </section>

          <section class="mt-8">
            <h2
              class="text-xs font-bold uppercase tracking-[0.2em] text-white/70"
            >
              ${translateText("multiplayer.private_title")}
            </h2>
            <div class="mt-3 grid gap-3 sm:grid-cols-2">
              ${this.privateAction(
                "host",
                "multiplayer.host",
                "multiplayer.host_desc",
                () => this.openHost(),
              )}
              ${this.privateAction(
                "join",
                "multiplayer.join",
                "multiplayer.join_desc",
                () => this.openJoin(),
              )}
            </div>
          </section>
        </div>
      </div>
    `;
  }

  private privateAction(
    action: "host" | "join",
    labelKey: string,
    descriptionKey: string,
    onClick: () => void,
  ) {
    return html`<button
      type="button"
      data-multiplayer-action=${action}
      class="group flex items-center gap-4 rounded-2xl border border-white/10 bg-zinc-900/85 px-5 py-4 text-left transition hover:-translate-y-0.5 hover:border-cyan-300/50 hover:bg-zinc-900"
      @click=${onClick}
    >
      <span
        class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-200 ring-1 ring-cyan-300/30 transition group-hover:bg-cyan-400/20"
      >
        ${shellIcon(action === "host" ? "users" : "arrowRight")}
      </span>
      <span class="min-w-0">
        <span
          class="block text-sm font-black uppercase tracking-wider text-white"
          >${translateText(labelKey)}</span
        >
        <span class="mt-0.5 block text-xs text-white/60"
          >${translateText(descriptionKey)}</span
        >
      </span>
    </button>`;
  }
}
