import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { GameMapType } from "../../core/game/Game";
import { PublicGameInfo } from "../../core/Schemas";
import {
  AI_JOIN_WINDOW_MS,
  aiCommandersPresent,
  aiCommanderTotal,
  aiRoster,
  loadNationNames,
} from "../LobbyAiRoster";
import type { JoinLobbyEvent } from "../Main";
import { publicLobbyTitle } from "../PublicLobbyTitle";
import { terrainMapFileLoader } from "../TerrainMapFileLoader";
import {
  getMapName,
  getModifierLabels,
  getServerNow,
  renderDuration,
  translateText,
} from "../Utils";

export type LiveLobbyType = "ffa" | "team" | "special";

/** A stable hue per commander so the avatar stack reads as different people. */
function avatarHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => w.length > 0);
  const letters =
    words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * A public lobby as OpenFront shows it on its home page: the map art, a
 * live countdown to the start, who is in the lobby (players and the AI
 * commanders that join during the countdown) and one Join button. Without a
 * lobby it renders the "next lobby" placeholder for its slot.
 */
@customElement("live-lobby-card")
export class LiveLobbyCard extends LitElement {
  @property({ attribute: false }) lobby: PublicGameInfo | undefined;
  @property({ type: String }) type: LiveLobbyType = "ffa";
  @property({ type: String }) variant: "hero" | "compact" = "compact";
  /** Server clock minus client clock. */
  @property({ type: Number }) serverTimeOffset = 0;
  /** True until the first lobby list arrives. */
  @property({ type: Boolean }) connecting = false;
  @property({ type: Boolean }) disabled = false;

  @state() private now = Date.now();
  @state() private nationNames: string[] = [];
  private namesForMap: GameMapType | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.ticker = setInterval(() => {
      this.now = Date.now();
    }, 1000);
  }

  disconnectedCallback() {
    if (this.ticker !== null) clearInterval(this.ticker);
    this.ticker = null;
    super.disconnectedCallback();
  }

  protected willUpdate() {
    const map = this.lobby?.gameConfig?.gameMap;
    if (map !== undefined && map !== this.namesForMap) {
      this.namesForMap = map;
      this.nationNames = [];
      void loadNationNames(map).then((names) => {
        if (this.namesForMap === map) this.nationNames = names;
      });
    }
  }

  private msUntilStart(): number | null {
    const startsAt = this.lobby?.startsAt;
    if (startsAt === undefined) return null;
    void this.now;
    return startsAt - getServerNow(this.serverTimeOffset);
  }

  private join() {
    if (this.lobby === undefined || this.disabled) return;
    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: this.lobby.gameID,
          source: "public",
          publicLobbyInfo: this.lobby,
        } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private renderPlaceholder() {
    const hero = this.variant === "hero";
    return html`<div
      data-public-lobby=${this.type}
      class="live-lobby-card relative flex ${hero
        ? "min-h-[18rem]"
        : "min-h-[10.5rem]"} flex-col justify-end overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/90 p-5"
    >
      <div
        class="absolute inset-0 animate-pulse bg-[radial-gradient(circle_at_30%_20%,rgba(34,211,238,0.12),transparent_60%)]"
      ></div>
      <div class="relative">
        <div
          class="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-300/80"
        >
          ${translateText(`multiplayer.${this.type}`)}
        </div>
        <div class="mt-1 text-sm text-white/55">
          ${this.connecting
            ? translateText("multiplayer.connecting")
            : translateText("multiplayer.waiting")}
        </div>
      </div>
    </div>`;
  }

  render() {
    const lobby = this.lobby;
    const config = lobby?.gameConfig;
    if (lobby === undefined || config === undefined) {
      return this.renderPlaceholder();
    }
    const hero = this.variant === "hero";
    const map = config.gameMap as GameMapType;
    const mapName = getMapName(map) ?? map;
    const mapImage = terrainMapFileLoader.getMapData(map).webpPath;
    const modifiers = getModifierLabels(
      config.publicGameModifiers,
      config.doomsdayClock?.speed,
    ).sort((a, b) => a.length - b.length);

    const ms = this.msUntilStart();
    const seconds = ms === null ? null : Math.max(0, Math.ceil(ms / 1000));
    const starting = seconds !== null && seconds <= 0;
    const countdown =
      seconds === null
        ? translateText("multiplayer.queued")
        : starting
          ? translateText("public_lobby.starting_game")
          : renderDuration(seconds);
    const drain =
      ms === null ? 1 : Math.min(1, Math.max(0, ms / AI_JOIN_WINDOW_MS));

    const total = aiCommanderTotal(
      config,
      this.nationNames.length,
      lobby.numClients,
    );
    const roster = aiRoster(lobby.gameID, this.nationNames, total);
    const present = aiCommandersPresent(roster, ms);
    const humans = lobby.numClients;
    const inLobby = humans + present.length;
    const latest = present.length > 0 ? present[present.length - 1] : null;
    const faces = present.slice(-(hero ? 6 : 4)).reverse();

    return html`<article
      data-public-lobby=${this.type}
      class="live-lobby-card group relative flex ${hero
        ? "min-h-[18rem]"
        : "min-h-[10.5rem]"} flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-[0_18px_50px_rgba(0,0,0,0.45)] transition duration-300 hover:-translate-y-0.5 hover:border-cyan-300/50 hover:shadow-[0_0_0_1px_rgba(103,232,249,0.35),0_22px_60px_rgba(8,145,178,0.25)]"
    >
      <img
        src=${mapImage}
        alt=""
        aria-hidden="true"
        draggable="false"
        class="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-85 transition-transform duration-[4000ms] ease-out group-hover:scale-110"
      />
      <div
        class="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/10"
      ></div>

      <div class="relative flex items-start justify-between gap-3 p-4">
        <div class="flex min-w-0 flex-wrap items-center gap-1.5">
          <span
            class="inline-flex items-center gap-1.5 rounded-full bg-rose-500/90 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-white"
          >
            <span class="relative flex h-1.5 w-1.5">
              <span
                class="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75"
              ></span>
              <span
                class="relative inline-flex h-1.5 w-1.5 rounded-full bg-white"
              ></span>
            </span>
            ${translateText("multiplayer.live")}
          </span>
          <span
            class="rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100"
            >${translateText(`multiplayer.${this.type}`)}</span
          >
          ${modifiers.map(
            (label) =>
              html`<span
                class="rounded-full bg-cyan-500/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-950"
                >${label}</span
              >`,
          )}
        </div>
        <span
          data-lobby-countdown
          class="shrink-0 rounded-lg bg-black/70 px-2.5 py-1 font-mono ${hero
            ? "text-lg"
            : "text-sm"} font-bold tabular-nums text-white"
          title=${seconds === null
            ? ""
            : translateText("multiplayer.starts_in", { time: countdown })}
          >${countdown}</span
        >
      </div>

      <div class="relative mt-auto flex flex-col gap-3 p-4 pt-0">
        <div>
          <h3
            class="${hero
              ? "text-3xl"
              : "text-lg"} font-black uppercase leading-none tracking-wide text-white drop-shadow"
          >
            ${mapName}
          </h3>
          <p
            class="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-white/65"
          >
            ${publicLobbyTitle(lobby)}
          </p>
        </div>

        <div class="flex items-end justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center">
              ${faces.map(
                (entry, i) =>
                  html`<span
                    title=${entry.name}
                    class="${i === 0
                      ? ""
                      : "-ml-2"} flex h-7 w-7 items-center justify-center rounded-full border-2 border-zinc-950 text-[10px] font-black text-white"
                    style="background: linear-gradient(135deg, hsl(${avatarHue(
                      entry.name,
                    )} 70% 50%), hsl(${(avatarHue(entry.name) + 40) %
                    360} 70% 32%))"
                    >${initials(entry.name)}</span
                  >`,
              )}
              <span
                class="${faces.length > 0
                  ? "ml-2"
                  : ""} text-sm font-black tabular-nums text-white"
                data-lobby-headcount
                >${translateText("multiplayer.in_lobby", {
                  count: inLobby,
                })}</span
              >
            </div>
            <div class="mt-1 truncate text-[11px] text-white/60">
              ${translateText("multiplayer.players_and_ai", {
                players: humans,
                max: config.maxPlayers ?? "?",
                ai: present.length,
              })}
            </div>
            ${latest !== null && hero
              ? html`<div
                  class="truncate text-[11px] text-cyan-200/90"
                  data-latest-join
                >
                  ${translateText("multiplayer.ai_joined", {
                    name: latest.name,
                  })}
                </div>`
              : nothing}
          </div>
          <button
            type="button"
            data-join-public=${this.type}
            ?disabled=${this.disabled || starting}
            class="shrink-0 rounded-xl bg-amber-400 ${hero
              ? "px-7 py-3 text-sm"
              : "px-4 py-2 text-xs"} font-black uppercase tracking-[0.16em] text-slate-950 shadow-[0_10px_30px_rgba(251,191,36,0.25)] transition hover:bg-amber-300 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
            @click=${() => this.join()}
          >
            ${translateText("multiplayer.join_button")}
          </button>
        </div>

        <div
          class="h-1 w-full overflow-hidden rounded-full bg-white/10"
          aria-hidden="true"
        >
          <div
            class="h-full rounded-full bg-gradient-to-r from-cyan-300 to-amber-300 transition-[width] duration-1000 ease-linear"
            style="width: ${(drain * 100).toFixed(1)}%"
          ></div>
        </div>
      </div>
    </article>`;
  }
}
