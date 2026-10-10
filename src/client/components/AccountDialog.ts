import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { validateUsername } from "../../core/validations/username";
import {
  ACCOUNT_CHANGED_EVENT,
  accountClient,
  type AccountError,
  type AccountProfile,
} from "../accounts/AccountClient";
import {
  accountCountryFlagUrl,
  accountCountryName,
} from "../accounts/AccountCountries";
import { renderGoogleButton } from "../accounts/GoogleSignIn";
import {
  hasChosenPlayerName,
  setPlayerName,
  storedPlayerName,
} from "../PlayerName";
import { translateText } from "../Utils";
import "./CountryPicker";

type Mode = "login" | "register";

/** Longest name both the account and the in-game name accept. */
const PROFILE_NAME_MAX = 20;

/**
 * Sign-in / profile dialog. Guests see "Continue with Google" (when the
 * server has a Google client id) and an email + password form with a
 * sign-in / create-account switch; signed-in players see their name and
 * country (both editable), level, progress to the next level, the head start
 * it gives, and sign out. A signed-in account without a country is asked for
 * one first and cannot dismiss that step: the country is the player's flag in
 * every match.
 */
@customElement("account-dialog")
export class AccountDialog extends LitElement {
  @state() private visible = false;
  @state() private mode: Mode = "login";
  @state() private busy = false;
  @state() private error: AccountError | null = null;
  @state() private profile: AccountProfile | null = accountClient.current();
  @state() private googleClientId: string | null = null;
  @state() private googleUnavailable = false;
  @state() private editingCountry = false;
  @state() private pendingCountry: string | null = null;
  @state() private nameDraft = "";
  @state() private nameError: string | null = null;
  @state() private nameSaved = false;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    globalThis.addEventListener(ACCOUNT_CHANGED_EVENT, this.onAccountChanged);
    globalThis.addEventListener("keydown", this.onKeyDown);
    void accountClient.config().then((config) => {
      this.googleClientId = config.googleClientId;
    });
  }

  disconnectedCallback() {
    globalThis.removeEventListener(
      ACCOUNT_CHANGED_EVENT,
      this.onAccountChanged,
    );
    globalThis.removeEventListener("keydown", this.onKeyDown);
    super.disconnectedCallback();
  }

  private onAccountChanged = (event: Event) => {
    const profile = (event as CustomEvent<AccountProfile | null>).detail;
    this.profile = profile;
    if (profile === null) return;
    // A player who never picked a name of their own plays under the account
    // name (when it is also a valid in-game name).
    if (
      !hasChosenPlayerName() &&
      validateUsername(profile.displayName).isValid
    ) {
      setPlayerName(profile.displayName);
    }
    if (profile.country === null) this.open();
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && this.visible && !this.countryRequired()) {
      this.close();
    }
  };

  /** Signed in but no country yet: the country step can't be dismissed. */
  private countryRequired(): boolean {
    return this.profile !== null && this.profile.country === null;
  }

  open(): void {
    this.visible = true;
    this.error = null;
    this.profile = accountClient.current();
    this.editingCountry = false;
    this.pendingCountry = this.profile?.country ?? null;
    this.nameDraft = storedPlayerName() ?? this.profile?.displayName ?? "";
    this.nameError = null;
    this.nameSaved = false;
  }

  close(): void {
    if (this.countryRequired()) return;
    this.visible = false;
    this.editingCountry = false;
  }

  private async saveCountry(): Promise<void> {
    const country = this.pendingCountry;
    if (country === null || this.busy) return;
    this.busy = true;
    this.error = null;
    try {
      const result = await accountClient.updateProfile({ country });
      if (result.ok) {
        this.profile = result.profile;
        this.editingCountry = false;
      } else {
        this.error = result.error;
      }
    } finally {
      this.busy = false;
    }
  }

  private async saveName(): Promise<void> {
    const name = this.nameDraft.trim();
    const check = validateUsername(name);
    if (!check.isValid || name.length > PROFILE_NAME_MAX) {
      this.nameError = check.isValid
        ? translateText("username.too_long", { max: PROFILE_NAME_MAX })
        : (check.error ?? translateText("account.error.invalid_name"));
      return;
    }
    if (this.busy) return;
    this.busy = true;
    this.nameError = null;
    this.nameSaved = false;
    try {
      const result = await accountClient.updateProfile({ displayName: name });
      if (result.ok) {
        this.profile = result.profile;
        setPlayerName(name);
        this.nameDraft = name;
        this.nameSaved = true;
      } else {
        this.nameError = translateText(`account.error.${result.error}`);
      }
    } finally {
      this.busy = false;
    }
  }

  updated() {
    if (!this.visible || this.profile !== null) return;
    const slot = this.querySelector<HTMLElement>("[data-google-slot]");
    if (
      slot !== null &&
      this.googleClientId !== null &&
      !this.googleUnavailable &&
      slot.childElementCount === 0
    ) {
      void renderGoogleButton(slot, this.googleClientId, (idToken) =>
        this.submit(() => accountClient.signInWithGoogle(idToken)),
      ).then((rendered) => {
        if (!rendered) this.googleUnavailable = true;
      });
    }
  }

  private async submit(
    action: () => Promise<
      { ok: true; profile: AccountProfile } | { ok: false; error: AccountError }
    >,
  ): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    try {
      const result = await action();
      if (result.ok) {
        this.profile = result.profile;
        this.pendingCountry = result.profile.country;
        this.nameDraft = storedPlayerName() ?? result.profile.displayName;
      } else {
        this.error = result.error;
      }
    } finally {
      this.busy = false;
    }
  }

  private onSubmitForm = (event: Event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");
    const displayName = String(data.get("displayName") ?? "");
    void this.submit(() =>
      this.mode === "register"
        ? accountClient.register(email, password, displayName)
        : accountClient.signInWithPassword(email, password),
    );
  };

  private signOut() {
    accountClient.signOut();
    this.profile = null;
    this.editingCountry = false;
  }

  render() {
    if (!this.visible) return nothing;
    return html`
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
        data-account-dialog
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this.close();
        }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="account-dialog-title"
          class="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 text-white shadow-2xl"
        >
          <header class="mb-5 flex items-start justify-between gap-4">
            <h2
              id="account-dialog-title"
              class="text-lg font-black uppercase tracking-[0.14em]"
            >
              ${this.profile === null
                ? translateText("account.title_sign_in")
                : this.countryRequired() || this.editingCountry
                  ? translateText("account.country_pick_title")
                  : translateText("account.title_profile")}
            </h2>
            ${this.countryRequired()
              ? nothing
              : html`<button
                  type="button"
                  class="rounded-lg px-2 py-1 text-white/60 hover:bg-white/10 hover:text-white"
                  aria-label=${translateText("account.close")}
                  @click=${() => this.close()}
                >
                  ✕
                </button>`}
          </header>
          ${this.profile === null
            ? this.renderSignIn()
            : this.countryRequired() || this.editingCountry
              ? this.renderCountryStep(this.profile)
              : this.renderProfile(this.profile)}
        </section>
      </div>
    `;
  }

  private renderSignIn() {
    const register = this.mode === "register";
    return html`
      <p class="mb-4 text-sm leading-6 text-white/65">
        ${translateText("account.pitch")}
      </p>
      ${this.googleClientId !== null && !this.googleUnavailable
        ? html`<div class="mb-4 flex justify-center" data-google-slot></div>
            <div
              class="mb-4 flex items-center gap-3 text-[11px] uppercase tracking-widest text-white/35"
            >
              <span class="h-px flex-1 bg-white/10"></span>
              <span>${translateText("account.or_email")}</span>
              <span class="h-px flex-1 bg-white/10"></span>
            </div>`
        : nothing}
      <form class="grid gap-3" data-account-form @submit=${this.onSubmitForm}>
        ${register
          ? html`<label class="grid gap-1 text-sm">
              <span class="text-white/70"
                >${translateText("account.display_name")}</span
              >
              <input
                name="displayName"
                type="text"
                required
                minlength="3"
                maxlength="20"
                autocomplete="nickname"
                class="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-white outline-none focus:border-cyan-300/60"
              />
            </label>`
          : nothing}
        <label class="grid gap-1 text-sm">
          <span class="text-white/70">${translateText("account.email")}</span>
          <input
            name="email"
            type="email"
            required
            autocomplete="email"
            class="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-white outline-none focus:border-cyan-300/60"
          />
        </label>
        <label class="grid gap-1 text-sm">
          <span class="text-white/70"
            >${translateText("account.password")}</span
          >
          <input
            name="password"
            type="password"
            required
            minlength="8"
            autocomplete=${register ? "new-password" : "current-password"}
            class="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-white outline-none focus:border-cyan-300/60"
          />
        </label>
        ${this.error
          ? html`<p
              class="text-sm text-rose-300"
              role="alert"
              data-account-error
            >
              ${translateText(`account.error.${this.error}`)}
            </p>`
          : nothing}
        <button
          type="submit"
          ?disabled=${this.busy}
          class="mt-1 rounded-xl border border-cyan-300/50 bg-cyan-300/15 px-4 py-3 text-sm font-black uppercase tracking-[0.14em] text-cyan-100 hover:bg-cyan-300/25 disabled:opacity-50"
        >
          ${register
            ? translateText("account.create_account")
            : translateText("account.sign_in")}
        </button>
      </form>
      <button
        type="button"
        data-account-switch
        class="mt-4 text-sm text-white/60 underline-offset-4 hover:text-white hover:underline"
        @click=${() => {
          this.mode = register ? "login" : "register";
          this.error = null;
        }}
      >
        ${register
          ? translateText("account.have_account")
          : translateText("account.no_account")}
      </button>
      <p class="mt-4 text-xs leading-5 text-white/40">
        ${translateText("account.guest_note")}
      </p>
    `;
  }

  private renderCountryStep(profile: AccountProfile) {
    const required = profile.country === null;
    return html`
      <div data-country-step>
        <p class="mb-4 text-sm leading-6 text-white/65">
          ${translateText("account.country_pick_body")}
        </p>
        <country-picker
          .selected=${this.pendingCountry}
          @country-picked=${(e: CustomEvent<string>) => {
            this.pendingCountry = e.detail;
          }}
        ></country-picker>
        ${this.error
          ? html`<p class="mt-3 text-sm text-rose-300" role="alert">
              ${translateText(`account.error.${this.error}`)}
            </p>`
          : nothing}
        <div class="mt-4 flex items-center gap-3">
          ${required
            ? html`<button
                type="button"
                class="text-sm text-white/50 underline-offset-4 hover:text-white hover:underline"
                @click=${() => this.signOut()}
              >
                ${translateText("account.sign_out")}
              </button>`
            : html`<button
                type="button"
                class="text-sm text-white/60 underline-offset-4 hover:text-white hover:underline"
                @click=${() => {
                  this.editingCountry = false;
                  this.pendingCountry = profile.country;
                  this.error = null;
                }}
              >
                ${translateText("account.cancel")}
              </button>`}
          <button
            type="button"
            data-country-save
            ?disabled=${this.busy ||
            this.pendingCountry === null ||
            this.pendingCountry === profile.country}
            class="ml-auto rounded-xl border border-cyan-300/50 bg-cyan-300/15 px-5 py-2.5 text-sm font-black uppercase tracking-[0.14em] text-cyan-100 hover:bg-cyan-300/25 disabled:opacity-40"
            @click=${() => void this.saveCountry()}
          >
            ${this.pendingCountry === null
              ? translateText("account.country_continue")
              : translateText("account.country_play_for", {
                  country: accountCountryName(this.pendingCountry),
                })}
          </button>
        </div>
      </div>
    `;
  }

  private renderProfile(profile: AccountProfile) {
    const progress = Math.min(
      100,
      Math.round((profile.levelXp / profile.nextLevelXp) * 100),
    );
    const country = profile.country;
    return html`
      <div class="mb-4 flex items-center gap-4">
        ${country === null
          ? html`<span
              aria-hidden="true"
              class="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-300/20 text-lg font-black text-cyan-100"
              >${initials(profile.displayName)}</span
            >`
          : html`<img
              src=${accountCountryFlagUrl(country)}
              alt=""
              class="h-10 w-14 shrink-0 rounded-md object-cover ring-1 ring-white/15"
            />`}
        <div class="min-w-0">
          <p class="truncate text-base font-bold">${profile.displayName}</p>
          <p class="text-xs text-white/50">${profile.email ?? ""}</p>
        </div>
        <span
          class="ml-auto rounded-lg border border-cyan-300/40 px-3 py-1 text-sm font-black text-cyan-100"
          data-account-level
        >
          ${translateText("account.level", { level: profile.level })}
        </span>
      </div>
      <form
        class="mb-3"
        data-profile-name
        @submit=${(e: Event) => {
          e.preventDefault();
          void this.saveName();
        }}
      >
        <label
          class="mb-1 block text-xs uppercase tracking-widest text-white/50"
          for="profile-name"
          >${translateText("account.name")}</label
        >
        <div class="flex gap-2">
          <input
            id="profile-name"
            name="name"
            type="text"
            autocomplete="nickname"
            maxlength=${PROFILE_NAME_MAX}
            .value=${this.nameDraft}
            class="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-white outline-none focus:border-cyan-300/60"
            @input=${(e: Event) => {
              this.nameDraft = (e.target as HTMLInputElement).value;
              this.nameSaved = false;
              this.nameError = null;
            }}
          />
          <button
            type="submit"
            ?disabled=${this.busy}
            class="rounded-lg border border-white/15 bg-white/5 px-4 text-sm font-bold hover:bg-white/10 disabled:opacity-50"
          >
            ${this.nameSaved
              ? translateText("account.saved")
              : translateText("account.save")}
          </button>
        </div>
        ${this.nameError
          ? html`<p class="mt-1 text-xs text-rose-300" role="alert">
              ${this.nameError}
            </p>`
          : html`<p class="mt-1 text-xs text-white/40">
              ${translateText("account.name_help")}
            </p>`}
      </form>
      <div
        class="mb-4 flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3"
        data-profile-country
      >
        <span class="text-xs uppercase tracking-widest text-white/50"
          >${translateText("account.country")}</span
        >
        ${country === null
          ? nothing
          : html`<img
                src=${accountCountryFlagUrl(country)}
                alt=""
                class="h-4 w-6 rounded-sm object-cover"
              /><span class="truncate text-sm font-bold"
                >${accountCountryName(country)}</span
              >`}
        <button
          type="button"
          data-country-change
          class="ml-auto rounded-lg border border-white/15 px-3 py-1 text-xs font-bold hover:bg-white/10"
          @click=${() => {
            this.editingCountry = true;
            this.pendingCountry = country;
            this.error = null;
          }}
        >
          ${translateText("account.country_change")}
        </button>
      </div>
      <div class="mb-1 flex justify-between text-xs text-white/60">
        <span>${translateText("account.next_level")}</span>
        <span data-account-xp
          >${profile.levelXp} / ${profile.nextLevelXp} XP</span
        >
      </div>
      <div class="mb-4 h-2 overflow-hidden rounded-full bg-white/10">
        <div class="h-full bg-cyan-300/70" style="width: ${progress}%"></div>
      </div>
      <dl class="mb-4 grid grid-cols-2 gap-3 text-sm">
        <div class="rounded-xl border border-white/10 bg-white/5 p-3">
          <dt class="text-xs uppercase tracking-widest text-white/50">
            ${translateText("account.matches")}
          </dt>
          <dd class="text-lg font-bold">${profile.matches}</dd>
        </div>
        <div class="rounded-xl border border-white/10 bg-white/5 p-3">
          <dt class="text-xs uppercase tracking-widest text-white/50">
            ${translateText("account.wins")}
          </dt>
          <dd class="text-lg font-bold">${profile.wins}</dd>
        </div>
      </dl>
      <div
        class="mb-5 rounded-xl border border-white/10 bg-white/5 p-3 text-sm leading-6 text-white/80"
        data-account-bonus
      >
        <p class="mb-1 text-xs uppercase tracking-widest text-white/50">
          ${translateText("account.head_start")}
        </p>
        <p>
          ${translateText("account.head_start_values", {
            troops: (profile.bonus.troopsPerMille / 10).toFixed(1),
            gold: (profile.bonus.goldPerMille / 10).toFixed(0),
            rings: profile.bonus.spawnRings,
          })}
        </p>
        <p class="text-xs text-white/50">
          ${translateText("account.head_start_note")}
        </p>
      </div>
      <button
        type="button"
        data-account-sign-out
        class="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-black uppercase tracking-[0.14em] hover:bg-white/10"
        @click=${() => this.signOut()}
      >
        ${translateText("account.sign_out")}
      </button>
    `;
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}
