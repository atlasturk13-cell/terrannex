import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  ACCOUNT_CHANGED_EVENT,
  accountClient,
  type AccountProfile,
} from "../accounts/AccountClient";
import { accountCountryFlagUrl } from "../accounts/AccountCountries";
import { translateText } from "../Utils";
import "./AccountDialog";
import type { AccountDialog } from "./AccountDialog";

/**
 * The account control in the top bar: "Sign in" for guests, or the
 * signed-in player's country flag, name and level. Hidden entirely when the server has no
 * accounts (no SESSION_SECRET, static hosting), so the bar looks as before.
 * On narrow screens only the avatar shows.
 */
@customElement("account-corner")
export class AccountCorner extends LitElement {
  @state() private enabled = false;
  @state() private profile: AccountProfile | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    globalThis.addEventListener(ACCOUNT_CHANGED_EVENT, this.onAccountChanged);
    void accountClient.config().then(async (config) => {
      this.enabled = config.enabled;
      if (config.enabled) this.profile = await accountClient.restore();
    });
  }

  disconnectedCallback() {
    globalThis.removeEventListener(
      ACCOUNT_CHANGED_EVENT,
      this.onAccountChanged,
    );
    super.disconnectedCallback();
  }

  private onAccountChanged = (event: Event) => {
    this.profile = (event as CustomEvent<AccountProfile | null>).detail;
  };

  private open() {
    const dialog = this.querySelector("account-dialog") as AccountDialog | null;
    dialog?.open();
  }

  render() {
    if (!this.enabled) return nothing;
    const profile = this.profile;
    return html`
      <button
        type="button"
        data-account-corner
        class="flex items-center gap-2.5 rounded-full border border-white/10 bg-white/5 py-1 pr-1 pl-1 text-white transition-colors sm:pr-4 hover:border-cyan-300/40 hover:bg-white/10"
        @click=${() => this.open()}
      >
        ${profile?.country
          ? html`<img
              src=${accountCountryFlagUrl(profile.country)}
              alt=""
              data-account-flag
              class="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-white/20"
            />`
          : html`<span
              aria-hidden="true"
              class="flex h-8 w-8 items-center justify-center rounded-full ${profile
                ? "bg-gradient-to-br from-cyan-400 to-indigo-500 text-white"
                : "bg-cyan-300/20 text-cyan-100"} text-xs font-black"
              >${profile ? initials(profile.displayName) : "?"}</span
            >`}
        <span class="sr-only min-w-0 sm:not-sr-only">
          <span
            class="block max-w-[10rem] truncate text-sm font-bold leading-4"
          >
            ${profile ? profile.displayName : translateText("account.sign_in")}
          </span>
          <span
            class="block text-[10px] uppercase leading-4 tracking-widest text-white/50"
          >
            ${profile
              ? translateText("account.level", { level: profile.level })
              : translateText("account.guest")}
          </span>
        </span>
      </button>
      <account-dialog></account-dialog>
    `;
  }
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}
