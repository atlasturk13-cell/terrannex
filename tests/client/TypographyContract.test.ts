import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SYSTEM_UI_FONT_STACK,
  uiFontFamily,
} from "../../src/client/theme/Typography";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("safe local typography contract", () => {
  it("centralizes UI, display, and mono stacks on the licensed local font", () => {
    const css = source("src/client/styles.css");

    expect(css).toContain("--font-ui:");
    expect(css).toContain("@font-face {");
    expect(css).toContain('font-family: "Oxanium";');
    expect(css).toContain("Oxanium[wght].ttf");
    expect(css).toContain('--font-display: "Oxanium", var(--font-ui);');
    expect(css).toContain("--font-mono:");
    expect(css).not.toContain('--font-display: "OpenFront"');
    expect(uiFontFamily()).toBe(SYSTEM_UI_FONT_STACK);
  });

  it("uses the shared token on isolated HUD text surfaces", () => {
    const buildMenu = source("src/client/hud/layers/BuildMenu.ts");
    const textIndicator = source("src/client/hud/ui/TextIndicator.ts");
    const radialMenu = source("src/client/hud/layers/RadialMenu.ts");

    expect(buildMenu).toContain("--font-ui");
    expect(buildMenu).not.toMatch(/font-size:\s*(?:8|9|10)px/);
    expect(textIndicator).toContain("uiFontFamily()");
    expect(textIndicator).not.toContain("Overpass");
    expect(radialMenu).toContain("uiFontFamily()");
    expect(radialMenu).not.toContain('"Arial, sans-serif"');
  });
});
