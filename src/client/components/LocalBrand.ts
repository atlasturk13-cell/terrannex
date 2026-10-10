import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";
import { translateText } from "../Utils";

@customElement("local-brand")
export class LocalBrand extends LitElement {
  @property({ type: String }) size: "compact" | "hero" = "compact";

  createRenderRoot() {
    return this;
  }

  render() {
    const hero = this.size === "hero";
    return html`
      <div class="flex items-center ${hero ? "gap-4" : "gap-2.5"}">
        <img
          src=${assetUrl("local/territory-lab-mark.svg")}
          alt=""
          aria-hidden="true"
          class="${hero
            ? "w-14 h-14"
            : "w-9 h-9"} rounded-xl shadow-[0_0_28px_rgba(98,217,255,0.22)]"
        />
        <div class="min-w-0">
          <div
            class="${hero
              ? "text-3xl"
              : "text-lg"} font-black tracking-[0.08em] uppercase text-white leading-none"
          >
            ${translateText("local.brand")}
          </div>
          <div
            class="${hero
              ? "text-xs sm:text-sm mt-2"
              : "text-[10px] mt-1"} font-semibold uppercase tracking-[0.18em] text-cyan-300/80"
          >
            ${translateText("local.based_on")}
          </div>
        </div>
      </div>
    `;
  }
}
