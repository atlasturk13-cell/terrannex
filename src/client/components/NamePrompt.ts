import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { validateUsername } from "../../core/validations/username";
import {
  isAnonPlaceholder,
  setPlayerName,
  storedPlayerName,
} from "../PlayerName";
import { translateText } from "../Utils";

/**
 * "What should we call you?" — shown before joining a multiplayer lobby when
 * the player has not picked a name yet. Join stores the name (every name
 * field follows) and resolves true; Cancel, Escape or the backdrop resolve
 * false and the join does not happen.
 */
@customElement("name-prompt")
export class NamePrompt extends LitElement {
  @state() private draft = "";
  @state() private error: string | null = null;
  private resolve: ((joined: boolean) => void) | null = null;

  createRenderRoot() {
    return this;
  }

  ask(): Promise<boolean> {
    const stored = storedPlayerName();
    this.draft = stored !== null && !isAnonPlaceholder(stored) ? stored : "";
    this.error = null;
    return new Promise<boolean>((resolve) => {
      this.resolve = resolve;
    });
  }

  connectedCallback() {
    super.connectedCallback();
    globalThis.addEventListener("keydown", this.onKeyDown);
  }

  disconnectedCallback() {
    globalThis.removeEventListener("keydown", this.onKeyDown);
    super.disconnectedCallback();
  }

  protected firstUpdated() {
    this.querySelector<HTMLInputElement>("[data-name-prompt-input]")?.focus();
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") this.finish(false);
  };

  private finish(joined: boolean) {
    const resolve = this.resolve;
    this.resolve = null;
    this.remove();
    resolve?.(joined);
  }

  private submit() {
    const name = this.draft.trim();
    const check = validateUsername(name);
    if (!check.isValid) {
      this.error = check.error ?? translateText("username.invalid_chars");
      return;
    }
    if (setPlayerName(name)) this.finish(true);
  }

  render() {
    return html`
      <div
        class="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
        data-name-prompt
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this.finish(false);
        }}
      >
        <form
          role="dialog"
          aria-modal="true"
          aria-labelledby="name-prompt-title"
          class="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-6 text-white shadow-2xl"
          @submit=${(e: Event) => {
            e.preventDefault();
            this.submit();
          }}
        >
          <h2
            id="name-prompt-title"
            class="mb-2 text-lg font-black uppercase tracking-[0.14em]"
          >
            ${translateText("name_prompt.title")}
          </h2>
          <p class="mb-4 text-sm leading-6 text-white/65">
            ${translateText("name_prompt.body")}
          </p>
          <input
            data-name-prompt-input
            type="text"
            autocomplete="nickname"
            maxlength="27"
            .value=${this.draft}
            placeholder=${translateText("name_prompt.placeholder")}
            aria-label=${translateText("multiplayer.name_label")}
            class="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2.5 text-white outline-none focus:border-cyan-300/60"
            @input=${(e: Event) => {
              this.draft = (e.target as HTMLInputElement).value;
              this.error = null;
            }}
          />
          ${this.error
            ? html`<p class="mt-2 text-sm text-rose-300" role="alert">
                ${this.error}
              </p>`
            : nothing}
          <div class="mt-5 flex items-center gap-3">
            <button
              type="button"
              data-name-prompt-cancel
              class="text-sm text-white/60 underline-offset-4 hover:text-white hover:underline"
              @click=${() => this.finish(false)}
            >
              ${translateText("account.cancel")}
            </button>
            <button
              type="submit"
              data-name-prompt-join
              ?disabled=${this.draft.trim() === ""}
              class="ml-auto rounded-xl bg-amber-400 px-6 py-2.5 text-sm font-black uppercase tracking-[0.16em] text-slate-950 hover:bg-amber-300 disabled:opacity-40"
            >
              ${translateText("multiplayer.join_button")}
            </button>
          </div>
        </form>
      </div>
    `;
  }
}

/** Shows the prompt; true once the player saved a name, false if they backed out. */
export function askForPlayerName(): Promise<boolean> {
  const prompt = document.createElement("name-prompt") as NamePrompt;
  const answer = prompt.ask();
  document.body.append(prompt);
  return answer;
}
