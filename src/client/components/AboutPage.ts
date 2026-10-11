import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ClientEnv } from "../ClientEnv";
import { translateText } from "../Utils";

/**
 * About page: what the game is, version, licence and the link to the
 * complete corresponding source (the AGPL network offer of a hosted build).
 * Behaves like the other inline pages of the router (`open`/`close`/`isOpen`).
 */
@customElement("about-page")
export class AboutPage extends LitElement {
  @state() private opened = false;

  createRenderRoot() {
    return this;
  }

  public open() {
    this.opened = true;
    this.classList.remove("hidden");
    this.classList.add("block");
  }

  public close() {
    this.opened = false;
    this.classList.add("hidden");
    this.classList.remove("block");
  }

  public isOpen(): boolean {
    return this.opened;
  }

  render() {
    const sourceUrl = ClientEnv.sourceUrl();
    return html`
      <div
        data-ui-audit-root="about"
        data-local-matte="setup"
        class="flex h-full w-full items-start justify-center overflow-y-auto px-6 py-10"
      >
        <div class="w-full max-w-2xl">
          <local-brand size="hero"></local-brand>
          <h1
            class="mt-8 text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-300"
          >
            ${translateText("about.title")}
          </h1>
          <p class="mt-3 text-sm leading-6 text-white/75">
            ${translateText("about.body")}
          </p>
          <dl class="mt-6 grid gap-4 text-sm">
            <div
              data-local-matte="subpanel"
              class="rounded-xl border border-white/10 bg-white/5 px-4 py-3"
            >
              <dt
                class="text-[10px] font-bold uppercase tracking-widest text-white/45"
              >
                ${translateText("about.source")}
              </dt>
              <dd class="mt-1">
                <a
                  href=${sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-about-source
                  class="font-semibold text-cyan-300 hover:text-cyan-200 break-all"
                  >${sourceUrl}</a
                >
              </dd>
            </div>
          </dl>
          <p class="mt-6 text-xs leading-5 text-white/55">
            ${translateText("local.copyright")} —
            ${translateText("about.licence")}
          </p>
          <p class="mt-2 text-xs leading-5 text-white/55">
            ${translateText("about.credits")}
          </p>
          ${ClientEnv.hosted()
            ? html`<p class="mt-4 flex flex-wrap gap-4 text-xs">
                <a
                  href="/privacy"
                  data-legal-link="privacy"
                  class="font-semibold text-cyan-300 hover:text-cyan-200"
                  >${translateText("main.privacy_policy")}</a
                >
                <a
                  href="/terms"
                  data-legal-link="terms"
                  class="font-semibold text-cyan-300 hover:text-cyan-200"
                  >${translateText("main.terms_of_service")}</a
                >
              </p>`
            : nothing}
          <button
            type="button"
            class="nav-menu-item mt-8 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold uppercase tracking-wider text-white hover:border-cyan-300/40 hover:bg-white/10"
            data-page="page-main-menu"
          >
            ← ${translateText("about.back")}
          </button>
        </div>
      </div>
    `;
  }
}
