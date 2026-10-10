import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { Controller } from "../../Controller";
import { showInGameConfirm } from "../../InGameModal";
import {
  canRestartSinglePlayer,
  restartSinglePlayer,
} from "../../SinglePlayerRestart";
import { PauseGameIntentEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { GameView } from "../../view";
import { ShowSettingsModalEvent } from "./SettingsModal";

/**
 * Overlays that handle Escape themselves. While one of them is open, Escape
 * belongs to it and must not also open the pause menu.
 */
const OVERLAY_FLAGS: ReadonlyArray<readonly [string, string]> = [
  ["settings-modal", "isVisible"],
  ["graphics-settings-modal", "isVisible"],
  ["player-panel", "isVisible"],
  ["emoji-table", "isVisible"],
  ["win-modal", "isVisible"],
  ["send-resource-modal", "isVisible"],
];

export function isAnotherOverlayOpen(root: Document = document): boolean {
  if (root.querySelector("dialog[open]") !== null) return true;
  const buildMenu = root.querySelector("build-menu") as
    | ({ _hidden?: boolean } & Element)
    | null;
  if (buildMenu !== null && buildMenu._hidden === false) return true;
  const radial = root.querySelector<HTMLElement>(".radial-menu-container");
  if (radial !== null && radial.style.display !== "none") return true;
  const chat = root.querySelector("chat-modal") as
    | ({ hidden?: boolean } & Element)
    | null;
  if (chat !== null && chat.hidden === false && chat.hasAttribute("open")) {
    return true;
  }
  for (const [selector, flag] of OVERLAY_FLAGS) {
    const element = root.querySelector(selector) as
      | (Record<string, unknown> & Element)
      | null;
    if (element !== null && element[flag] === true) return true;
  }
  return false;
}

/**
 * Escape opens a pause menu over the match: Resume, Settings, Restart (a
 * fresh single-player game) and Exit to the main menu. A single-player match
 * is paused while the menu is open and resumed when it closes, unless it was
 * already paused before.
 */
@customElement("pause-menu")
export class PauseMenu extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  @state() private opened = false;
  private isPaused = false;
  private pausedByMenu = false;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.onKeyDown);
    super.disconnectedCallback();
  }

  init() {}

  tick() {
    const pauses =
      this.game.updatesSinceLastTick()?.[GameUpdateType.GamePaused];
    if (pauses !== undefined && pauses.length > 0) {
      this.isPaused = pauses[pauses.length - 1].paused;
    }
  }

  public isOpen(): boolean {
    return this.opened;
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" && event.code !== "Escape") return;
    if (this.opened) {
      event.preventDefault();
      this.close();
      return;
    }
    // Another overlay already used this Escape to close itself.
    if (event.defaultPrevented) return;
    if (this.game === undefined || this.eventBus === undefined) return;
    if (isAnotherOverlayOpen()) return;
    this.open();
  };

  private ownsPause(): boolean {
    return (
      this.game.config().gameConfig().gameType === GameType.Singleplayer &&
      this.game.config().isReplay() !== true
    );
  }

  public open() {
    if (this.opened) return;
    this.opened = true;
    if (this.ownsPause() && !this.isPaused) {
      this.pausedByMenu = true;
      this.isPaused = true;
      this.eventBus.emit(new PauseGameIntentEvent(true));
    }
  }

  public close() {
    if (!this.opened) return;
    this.opened = false;
    if (this.pausedByMenu) {
      this.pausedByMenu = false;
      this.isPaused = false;
      this.eventBus.emit(new PauseGameIntentEvent(false));
    }
  }

  private onSettings() {
    const pausedBefore = this.isPaused && !this.pausedByMenu;
    this.close();
    this.eventBus.emit(
      new ShowSettingsModalEvent(true, this.ownsPause(), pausedBefore),
    );
  }

  private canRestart(): boolean {
    return this.ownsPause() && canRestartSinglePlayer();
  }

  private async onRestart() {
    if (this.game.myPlayer()?.isAlive()) {
      const confirmed = await showInGameConfirm(
        translateText("restart_prompt.confirm"),
        { variant: "warning" },
      );
      if (!confirmed) return;
    }
    restartSinglePlayer();
  }

  private async onExit() {
    if (this.game.myPlayer()?.isAlive()) {
      const confirmed = await showInGameConfirm(
        translateText("help_modal.exit_confirmation"),
      );
      if (!confirmed) return;
    }
    window.location.href = "/";
  }

  private button(
    action: string,
    labelKey: string,
    onClick: () => void,
    primary = false,
  ) {
    return html`<button
      type="button"
      class="flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm font-bold uppercase tracking-wider transition-colors ${primary
        ? "border-cyan-300/50 bg-cyan-300/15 text-cyan-100 hover:bg-cyan-300/25"
        : "border-white/10 bg-white/5 text-white hover:border-cyan-300/40 hover:bg-white/10"}"
      data-pause-action=${action}
      @click=${onClick}
    >
      ${translateText(labelKey)}
    </button>`;
  }

  render() {
    if (!this.opened) return nothing;
    return html`
      <div
        class="pause-menu-backdrop fixed inset-0 z-[1100] flex items-center justify-center bg-black/55 backdrop-blur-sm"
        @click=${(event: MouseEvent) => {
          if (event.target === event.currentTarget) this.close();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label=${translateText("pause_menu.title")}
          class="w-[min(92vw,360px)] rounded-2xl border border-white/10 bg-[#0f1c27]/95 p-5 shadow-2xl"
        >
          <div
            class="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-300"
          >
            ${translateText("local.brand")}
          </div>
          <h2
            class="mt-1 text-2xl font-black uppercase tracking-wider text-white"
          >
            ${translateText("pause_menu.title")}
          </h2>
          <p class="mt-1 text-xs text-white/55">
            ${translateText("pause_menu.hint")}
          </p>
          <div class="mt-5 grid gap-2">
            ${this.button(
              "resume",
              "pause_menu.resume",
              () => this.close(),
              true,
            )}
            ${this.button("settings", "pause_menu.settings", () =>
              this.onSettings(),
            )}
            ${this.canRestart()
              ? this.button(
                  "restart",
                  "pause_menu.restart",
                  () => void this.onRestart(),
                )
              : nothing}
            ${this.button("exit", "pause_menu.exit", () => void this.onExit())}
          </div>
        </div>
      </div>
    `;
  }
}
