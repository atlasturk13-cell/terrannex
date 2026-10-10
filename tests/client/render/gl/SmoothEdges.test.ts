import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lerpHeadingByte } from "../../../../src/client/render/gl/passes/UnitPass";
import settings from "../../../../src/client/render/gl/render-settings.json";

const read = (p: string) =>
  fs.readFileSync(path.resolve("src/client/render/gl", p), "utf8");

describe("smooth territory edges (Plan A)", () => {
  const territory = read("shaders/map-overlay/territory.frag.glsl");
  const border = read("shaders/day-night/border-stamp.frag.glsl");

  it("both ownership shaders vote with the four nearest tiles and stay tile-exact when off", () => {
    for (const src of [territory, border]) {
      expect(src).toContain("uniform int uSmoothEdges");
      expect(src).toContain("uniform float uZoom");
      expect(src).toContain("void visualOwner(");
      // Off: the fragment's own tile decides, margin 1 (no band, no fade).
      expect(src).toContain("if (uSmoothEdges == 0) {");
      // Bilinear weights of the 2×2 neighbourhood.
      expect(src).toContain("float w0 = (1.0 - f.x) * (1.0 - f.y);");
      expect(src).toContain("margin = best - second;");
      // Integer textures must stay texelFetch-only.
      expect(src).not.toMatch(/texture\(uTileTex/);
    }
  });

  it("the border line has a constant pixel width per side, clamped in tiles", () => {
    expect(border).toContain("uniform float uBorderWidthPx");
    expect(border).toContain(
      "clamp(uBorderWidthPx / max(uZoom, 0.05), 0.1, 0.5)",
    );
    // Hovered owner reads thicker; coverage is anti-aliased, not stepped.
    expect(border).toContain("sideTiles * 2.5");
    expect(border).toContain("coverage = 1.0 - smoothstep(");
    expect(border).toContain("fragColor = vec4(bc, coverage);");
  });

  it("the fill fades out at unowned land over about a pixel", () => {
    expect(territory).toContain("alpha *= smoothstep(0.0, aa, margin);");
  });

  it("ships on by default with a 1.5 px line", () => {
    expect(settings.mapOverlay.smoothEdges).toBe(true);
    expect(settings.mapOverlay.borderWidthPx).toBe(1.5);
  });

  it("the renderer passes the zoom to both passes", () => {
    const renderer = read("Renderer.ts");
    expect(renderer).toContain(
      "this.territoryPass.draw(cam, this.camera.zoom)",
    );
    expect(renderer).toContain("this.borderStampPass.draw(cam, zoom)");
  });

  it("crossfades a changed tile from its previous owner over claimCrossfadeMs", () => {
    expect(settings.mapOverlay.claimCrossfadeMs).toBe(400);
    expect(territory).toContain("uniform sampler2D uPrevOwnerTex");
    expect(territory).toContain("uniform float uCrossfade");
    // Land lost to nobody drains instead of popping; captures mix from the
    // previous colour (or fade in from bare ground).
    expect(territory).toContain(
      "fading.a = uTerritoryAlpha * (1.0 - crossfadeT);",
    );
    expect(territory).toContain(
      "color.rgb = mix(prevColor, color.rgb, crossfadeT);",
    );
    expect(territory).toContain("alpha *= crossfadeT;");
    const pass = read("passes/TerritoryPass.ts");
    // Every change of hands is stamped, with the previous owner alongside.
    expect(pass).toContain("if (newOwner !== prevOwner) {");
    expect(pass).toContain("this.prevOwners.push(x, y, prevOwner);");
    expect(pass).toContain("this.reducedMotion ? 0 : mo.claimCrossfadeMs");
  });

  it("turns jet headings along the short arc between ticks", () => {
    expect(lerpHeadingByte(10, 30, 0)).toBe(10);
    expect(lerpHeadingByte(10, 30, 1)).toBe(30);
    expect(lerpHeadingByte(10, 30, 0.5)).toBe(20);
    // 250 → 6 goes forward through 0, not backwards around the circle.
    expect(lerpHeadingByte(250, 6, 0.5)).toBe(0);
    expect(lerpHeadingByte(6, 250, 0.5)).toBe(0);
    expect(lerpHeadingByte(0, 128, 0.25)).toBe(32);
    expect(lerpHeadingByte(100, 100, 0.7)).toBe(100);
    const unitPass = read("passes/UnitPass.ts");
    expect(unitPass).toContain("lerpHeadingByte(");
    expect(unitPass).toContain("* BYTES_PER_INSTANCE + 15] = lerpHeadingByte(");
  });
});
