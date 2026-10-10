import { html, LitElement, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { ClientEnv } from "../ClientEnv";
import { translateText } from "../Utils";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/**
 * The one display ad of a hosted deployment, under the main menu entries.
 * Renders nothing unless the operator configured AdSense with a menu ad unit
 * (ADSENSE_CLIENT + ADSENSE_MENU_SLOT); the menu is never shown during a
 * match, so no ad appears in play.
 */
@customElement("menu-ad-slot")
export class MenuAdSlot extends LitElement {
  private requested = false;

  createRenderRoot() {
    return this;
  }

  render() {
    const adsense = ClientEnv.adsense();
    if (adsense === null || adsense.menuSlot === null) return nothing;
    return html`<aside
      class="mt-8 rounded-xl border border-white/10 bg-black/20 p-3"
      aria-label=${translateText("main_menu.advertisement")}
    >
      <p class="mb-2 text-[10px] uppercase tracking-widest text-white/35">
        ${translateText("main_menu.advertisement")}
      </p>
      <ins
        class="adsbygoogle block min-h-[90px] w-full"
        data-ad-client=${adsense.client}
        data-ad-slot=${adsense.menuSlot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      ></ins>
    </aside>`;
  }

  updated() {
    if (this.requested || this.querySelector("ins.adsbygoogle") === null) {
      return;
    }
    this.requested = true;
    try {
      (window.adsbygoogle = window.adsbygoogle ?? []).push({});
    } catch (error) {
      console.warn("AdSense menu slot failed to load", error);
    }
  }
}
