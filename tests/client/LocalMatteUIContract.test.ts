import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OModal } from "../../src/client/components/baseComponents/Modal";
import { DoomsdayClockPanel } from "../../src/client/components/DoomsdayClockPanel";
import type { GameConfigSettings } from "../../src/client/components/GameConfigSettings";
import { PlayerInfoOverlay } from "../../src/client/hud/layers/PlayerInfoOverlay";
import { SinglePlayerModal } from "../../src/client/SinglePlayerModal";

class DormantIntersectionObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];
}

function source(path: string): string {
  return readFileSync(path, "utf8");
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = hex
      .replace("#", "")
      .match(/.{2}/g)!
      .map((value) => parseInt(value, 16) / 255)
      .map((value) =>
        value <= 0.04045
          ? value / 12.92
          : Math.pow((value + 0.055) / 1.055, 2.4),
      );
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("LOCAL_ONLY matte UI contract", () => {
  beforeEach(() => {
    window.BOOTSTRAP_CONFIG = {
      gameEnv: "dev",
      numWorkers: 1,
      turnstileSiteKey: "unused",
      jwtAudience: "localhost",
      instanceId: "LOCAL_ONLY",
      gitCommit: "TEST",
      localOnly: true,
    };
    vi.stubGlobal("IntersectionObserver", DormantIntersectionObserver);
  });

  afterEach(() => {
    document.body.replaceChildren();
    window.BOOTSTRAP_CONFIG = undefined;
    vi.unstubAllGlobals();
  });

  it("marks setup controls and the modal shadow surface explicitly", async () => {
    const modal = new SinglePlayerModal();
    modal.inline = true;
    document.body.appendChild(modal);
    await modal.updateComplete;

    const shell = modal.querySelector("o-modal") as OModal;
    await shell.updateComplete;
    const settings = modal.querySelector(
      "game-config-settings",
    ) as GameConfigSettings;
    await settings.updateComplete;

    const shadowSurface = shell.shadowRoot?.querySelector(
      '[data-local-matte="setup"][data-ui-audit-root="setup"]',
    );
    expect(shadowSurface).not.toBeNull();

    const markers = [...modal.querySelectorAll("[data-local-matte]")];
    expect(markers.length).toBeGreaterThanOrEqual(40);
    expect(
      markers.every((element) =>
        ["setup", "subpanel", "hud"].includes(
          element.getAttribute("data-local-matte") ?? "",
        ),
      ),
    ).toBe(true);
    expect(
      modal.querySelectorAll("[data-ui-audit-root]").length,
    ).toBeGreaterThan(1);
    settings.settings = {
      ...settings.settings!,
      difficulty: { ...settings.settings!.difficulty, disabled: true },
    };
    await settings.updateComplete;
    expect(modal.querySelector("button:disabled[data-local-matte]")).toBeNull();
  });

  it("keeps the matte palette opaque and scoped without a blanket override", () => {
    const css = source("src/client/styles.css");
    for (const [marker, color] of [
      ["setup", "#09090b"],
      ["subpanel", "#18181b"],
      ["hud", "#1f2937"],
    ]) {
      const rule = css.match(
        new RegExp(`\\[data-local-matte="${marker}"\\] \\{([^}]*)\\}`),
      )?.[1];
      expect(rule).toContain(color);
      expect(rule).toContain("opacity: 1");
      expect(rule).toContain("backdrop-filter: none");
      expect(rule).not.toContain("!important");
    }
    expect(css).not.toMatch(/body\s+\*[^}]*opacity:\s*1/);
    expect(css).not.toMatch(/\*\s*\{[^}]*backdrop-filter:\s*none/);
  });

  it("keeps the local primary action above WCAG AA contrast", () => {
    const css = source("src/client/styles.css");
    const rule = css.match(
      /\[data-local-start-action="true"\] > button \{([^}]*)\}/,
    )?.[1];
    expect(rule).toContain("background-color: #f5a91b");
    expect(rule).toContain("color: #111e29");
    expect(contrastRatio("#111e29", "#f5a91b")).toBeGreaterThanOrEqual(4.5);
  });

  it("marks force-opened target and doomsday HUD cards without breaking hiding", async () => {
    const playerInfo = new PlayerInfoOverlay();
    Object.assign(playerInfo, { _isActive: true, _isInfoVisible: true });
    document.body.appendChild(playerInfo);
    await playerInfo.updateComplete;
    expect(
      playerInfo.querySelector(
        '[data-local-matte="hud"][data-ui-audit-root="hud"]',
      ),
    ).not.toBeNull();

    playerInfo.setVisible(false);
    await playerInfo.updateComplete;
    expect(playerInfo.querySelector("[data-local-matte]")).toBeNull();
    expect(playerInfo.querySelector(".opacity-0.invisible")).not.toBeNull();

    const doomsday = new DoomsdayClockPanel();
    doomsday.game = {
      config: () => ({
        doomsdayClockConfig: () => ({ enabled: true, speed: "normal" }),
      }),
      myPlayer: () => undefined,
      elapsedGameSeconds: () => 0,
      numLandTiles: () => 1_000,
      numTilesWithFallout: () => 0,
    } as unknown as DoomsdayClockPanel["game"];
    document.body.appendChild(doomsday);
    await doomsday.updateComplete;
    expect(
      doomsday.querySelector(
        '[data-local-matte="hud"][data-ui-audit-root="hud"]',
      ),
    ).not.toBeNull();
  });

  it("preserves excluded map/radial semantics and uses no local proprietary font", () => {
    expect(source("src/client/hud/layers/RadialMenu.ts")).not.toContain(
      "data-local-matte",
    );
    expect(source("src/client/hud/layers/PlayerPanel.ts")).not.toContain(
      "data-local-matte",
    );
    expect(source("src/client/render/gl/Renderer.ts")).not.toContain(
      "data-local-matte",
    );

    const main = source("src/client/Main.ts");
    expect(main).toContain("if (!localOnly)");
    expect(main).toContain('new FontFace(\n        "OpenFront"');
    const auditRule = source("src/client/styles.css").match(
      /\[data-ui-audit-root\] \{([^}]*)\}/,
    )?.[1];
    const uiFontToken = source("src/client/styles.css").match(
      /--font-ui:\s*([^;]+);/,
    )?.[1];
    expect(auditRule).toContain("var(--font-ui)");
    expect(uiFontToken).toContain("ui-sans-serif");
    expect(auditRule).not.toContain("OpenFront");
    expect(uiFontToken).not.toContain("OpenFront");
  });
});
