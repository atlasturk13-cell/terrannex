import { afterEach, describe, expect, it } from "vitest";
import { ClientEnv } from "../../src/client/ClientEnv";
import { MainMenu } from "../../src/client/components/MainMenu";
import { MenuAdSlot } from "../../src/client/components/MenuAdSlot";

function bootstrap(adsense: unknown) {
  ClientEnv.reset();
  window.BOOTSTRAP_CONFIG = {
    gameEnv: "dev",
    numWorkers: 1,
    turnstileSiteKey: "unused",
    jwtAudience: "localhost",
    instanceId: "LOCAL_ONLY",
    gitCommit: "TEST",
    localOnly: true,
    adsense: adsense as never,
  };
}

afterEach(() => {
  document.body.replaceChildren();
  window.BOOTSTRAP_CONFIG = undefined;
  window.adsbygoogle = undefined;
  ClientEnv.reset();
});

describe("Menu ad slot", () => {
  it("renders nothing in a local run or without a menu ad unit", async () => {
    for (const adsense of [
      undefined,
      null,
      { client: "ca-pub-1234567890123456", menuSlot: null },
    ]) {
      bootstrap(adsense);
      const slot = new MenuAdSlot();
      document.body.append(slot);
      await slot.updateComplete;
      expect(slot.querySelector("ins")).toBeNull();
      expect(slot.textContent?.trim()).toBe("");
      expect(window.adsbygoogle).toBeUndefined();
      slot.remove();
    }
  });

  it("requests exactly one labelled responsive ad for the configured unit", async () => {
    bootstrap({ client: "ca-pub-1234567890123456", menuSlot: "1234567890" });
    const menu = new MainMenu();
    document.body.append(menu);
    await menu.updateComplete;
    const slot = menu.querySelector("menu-ad-slot") as MenuAdSlot;
    await slot.updateComplete;

    const ins = slot.querySelector<HTMLElement>("ins.adsbygoogle");
    expect(ins?.dataset.adClient).toBe("ca-pub-1234567890123456");
    expect(ins?.dataset.adSlot).toBe("1234567890");
    expect(ins?.dataset.adFormat).toBe("auto");
    expect(slot.textContent).toContain("main_menu.advertisement");
    expect(window.adsbygoogle).toEqual([{}]);

    // Menu re-renders (page switches) must not request a second ad.
    slot.requestUpdate();
    await slot.updateComplete;
    expect(window.adsbygoogle).toEqual([{}]);
  });
});
