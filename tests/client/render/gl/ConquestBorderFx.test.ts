import fs from "fs";
import path from "path";
import {
  conquestBurstMotionFrame,
  territoryClaimMotionFrame,
} from "../../../../src/client/render/gl/passes/fx-pass/FxShockwavePass";

const root = path.resolve(__dirname, "../../../..");

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("territory conquest border feedback", () => {
  it("uses a short ease-out pulse and a stationary reduced-motion fallback", () => {
    expect(territoryClaimMotionFrame(0, false)).toEqual({
      radiusScale: 0.22,
      alpha: 1,
    });
    expect(territoryClaimMotionFrame(1, false)).toEqual({
      radiusScale: 1,
      alpha: 0,
    });
    expect(territoryClaimMotionFrame(0, true)).toEqual({
      radiusScale: 0.58,
      alpha: 1,
    });
    expect(territoryClaimMotionFrame(0.5, true)).toEqual({
      radiusScale: 0.58,
      alpha: 0.5,
    });
  });

  it("grows a combustion burst almost instantly, holds, then fades it out", () => {
    const start = conquestBurstMotionFrame(0);
    const early = conquestBurstMotionFrame(0.2);
    const held = conquestBurstMotionFrame(0.5);
    const end = conquestBurstMotionFrame(1);
    expect(start).toEqual({ radiusScale: 0.3, alpha: 1 });
    expect(early.radiusScale).toBeGreaterThan(0.7);
    expect(early.alpha).toBe(1);
    expect(held.alpha).toBe(1);
    expect(held.radiusScale).toBeLessThan(1);
    expect(end).toEqual({ radiusScale: 1, alpha: 0 });
    // Out-of-range progress is clamped, never extrapolated.
    expect(conquestBurstMotionFrame(-3)).toEqual(start);
    expect(conquestBurstMotionFrame(9)).toEqual(end);
  });

  it("routes claim events through the existing frame upload and FX pass", () => {
    const upload = source("src/client/render/frame/Upload.ts");
    const fxPass = source("src/client/render/gl/passes/fx-pass/index.ts");
    const shader = source(
      "src/client/render/gl/shaders/fx/shockwave.frag.glsl",
    );

    expect(upload).toContain("applyTerritoryClaimEvents");
    expect(fxPass).toContain("pushTerritoryClaimBlast");
    expect(fxPass).toContain("(prefers-reduced-motion: reduce)");
    expect(shader).toContain("territoryClaimPulse");
    expect(shader).toContain("vStyle > 3.5");
    expect(shader).toContain("no flicker/strobe");
  });

  it("renders many small deterministic combustion bursts along a front", () => {
    const shader = source(
      "src/client/render/gl/shaders/fx/shockwave.frag.glsl",
    );
    const pass = source(
      "src/client/render/gl/passes/fx-pass/FxShockwavePass.ts",
    );
    expect(shader).toContain("combustionBurst");
    expect(shader).toContain("vStyle > 4.5");
    // Burst animation is lifetime-driven; the only wall-clock uniform stays
    // confined to the cosmetic nuke styles.
    const burstBody = shader.slice(
      shader.indexOf("void combustionBurst()"),
      shader.indexOf("void main()"),
    );
    expect(burstBody).not.toContain("uTime");
    expect(burstBody).toContain("smoke");
    expect(burstBody).toContain("spark");
    expect(pass).toContain('motion: "burst"');
    expect(pass).toContain("startMs: now + burst.delayMs");
  });

  it("keeps the feedback brief and materially shorter under reduced motion", () => {
    const settings = JSON.parse(
      source("src/client/render/gl/render-settings.json"),
    ) as {
      fx: {
        conquestBorderDurationMs: number;
        conquestBorderReducedDurationMs: number;
        conquestBorderRadius: number;
        conquestBurstDurationMs: number;
        conquestBurstRadius: number;
      };
    };

    expect(settings.fx.conquestBorderDurationMs).toBeLessThanOrEqual(700);
    expect(settings.fx.conquestBorderReducedDurationMs).toBeLessThanOrEqual(
      200,
    );
    expect(settings.fx.conquestBorderReducedDurationMs).toBeLessThan(
      settings.fx.conquestBorderDurationMs,
    );
    expect(settings.fx.conquestBorderRadius).toBeLessThanOrEqual(10);
    expect(settings.fx.conquestBurstDurationMs).toBeLessThanOrEqual(900);
    expect(settings.fx.conquestBurstRadius).toBeLessThanOrEqual(4);
  });
});
