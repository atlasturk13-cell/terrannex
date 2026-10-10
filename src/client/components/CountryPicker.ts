import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import {
  accountCountryFlagUrl,
  filterAccountCountries,
} from "../accounts/AccountCountries";
import { translateText } from "../Utils";

/**
 * Searchable list of countries with their flags. Clicking one fires
 * `country-picked` with the two-letter code; `selected` highlights it.
 */
@customElement("country-picker")
export class CountryPicker extends LitElement {
  @property({ type: String }) selected: string | null = null;
  @state() private query = "";

  createRenderRoot() {
    return this;
  }

  private pick(code: string) {
    this.dispatchEvent(
      new CustomEvent<string>("country-picked", {
        detail: code,
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    const matches = filterAccountCountries(this.query);
    return html`
      <input
        type="search"
        data-country-search
        autocomplete="off"
        .value=${this.query}
        placeholder=${translateText("account.country_search")}
        aria-label=${translateText("account.country_search")}
        class="mb-3 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-white outline-none focus:border-cyan-300/60"
        @input=${(e: Event) => {
          this.query = (e.target as HTMLInputElement).value;
        }}
      />
      <div
        role="listbox"
        aria-label=${translateText("account.country")}
        data-country-list
        class="grid h-64 auto-rows-min grid-cols-1 gap-1 overflow-y-auto pr-1 sm:grid-cols-2"
      >
        ${matches.length === 0
          ? html`<p
              class="col-span-full py-6 text-center text-sm text-white/50"
            >
              ${translateText("account.country_none")}
            </p>`
          : repeat(
              matches,
              (country) => country.code,
              (country) => {
                const active = country.code === this.selected;
                return html`<button
                  type="button"
                  role="option"
                  aria-selected=${active ? "true" : "false"}
                  data-country=${country.code}
                  class="flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors ${active
                    ? "border-cyan-300/70 bg-cyan-300/15 text-white"
                    : "border-transparent text-white/80 hover:bg-white/10"}"
                  @click=${() => this.pick(country.code)}
                >
                  <img
                    src=${accountCountryFlagUrl(country.code)}
                    alt=""
                    loading="lazy"
                    class="h-4 w-6 shrink-0 rounded-sm object-cover"
                  />
                  <span class="truncate">${country.name}</span>
                </button>`;
              },
            )}
      </div>
    `;
  }
}
