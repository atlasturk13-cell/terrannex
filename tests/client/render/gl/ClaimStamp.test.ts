import fs from "fs";
import path from "path";
import {
  CLAIM_STAMP_MODULO,
  CLAIM_STAMP_UNIT_MS,
  claimStampAge,
  encodeClaimStamp,
} from "../../../../src/client/render/gl/passes/ClaimStampPass";

const root = path.resolve(__dirname, "../../../..");

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("fresh-capture claim stamps", () => {
  it("encodes elapsed time into a non-zero 24-bit stamp", () => {
    expect(encodeClaimStamp(0)).toBe(1);
    expect(encodeClaimStamp(CLAIM_STAMP_UNIT_MS * 10)).toBe(11);
    expect(encodeClaimStamp(Number.NaN)).toBe(1);
    expect(encodeClaimStamp(-5)).toBe(1);
    const huge = encodeClaimStamp(Number.MAX_SAFE_INTEGER / 8);
    expect(huge).toBeGreaterThan(0);
    expect(huge).toBeLessThan(CLAIM_STAMP_MODULO);
    expect(Number.isInteger(huge)).toBe(true);
  });

  it("measures age wrap-safely and never ages the reserved zero stamp", () => {
    expect(claimStampAge(100, 40)).toBe(60);
    expect(claimStampAge(5, CLAIM_STAMP_MODULO - 3)).toBe(8);
    expect(claimStampAge(100, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it("writes stamps from the territory drip drain and reads them in the fill shader", () => {
    const pass = source("src/client/render/gl/passes/TerritoryPass.ts");
    const shader = source(
      "src/client/render/gl/shaders/map-overlay/territory.frag.glsl",
    );
    const scatterVert = source(
      "src/client/render/gl/shaders/map-overlay/claim-stamp.vert.glsl",
    );

    expect(pass).toContain("this.claimStamps.push(x, y, stamp)");
    expect(pass).toContain("this.claimStamps.reset()");
    expect(pass).toContain("claimFlashReducedDurationMs");
    expect(shader).toContain("uClaimTex");
    expect(shader).toContain("age += 16777216.0");
    expect(shader).toContain("uClaimStrength");
    expect(scatterVert).toContain("65536.0");
  });

  it("keeps the flash brief and calmer under reduced motion", () => {
    const settings = JSON.parse(
      source("src/client/render/gl/render-settings.json"),
    ) as {
      mapOverlay: {
        claimFlashDurationMs: number;
        claimFlashReducedDurationMs: number;
        claimFlashStrength: number;
      };
    };
    expect(settings.mapOverlay.claimFlashDurationMs).toBeLessThanOrEqual(1500);
    expect(settings.mapOverlay.claimFlashReducedDurationMs).toBeLessThan(
      settings.mapOverlay.claimFlashDurationMs,
    );
    expect(settings.mapOverlay.claimFlashStrength).toBeGreaterThan(0);
    expect(settings.mapOverlay.claimFlashStrength).toBeLessThanOrEqual(1);
  });
});
