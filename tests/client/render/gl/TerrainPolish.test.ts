import fs from "fs";
import path from "path";
import { buildTerrainVisualRGBA } from "../../../../src/client/render/gl/passes/TerrainPass";
import { encodeTerrainTile } from "../../../../src/client/render/gl/utils/ColorUtils";

const root = path.resolve(__dirname, "../../../..");

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("modern terrain rendering contract", () => {
  it("softens the contextual terrain while preserving crisp ownership masks", () => {
    const terrainPass = source("src/client/render/gl/passes/TerrainPass.ts");
    const borderPass = source(
      "src/client/render/gl/passes/BorderComputePass.ts",
    );

    expect(terrainPass).toContain("filter: gl.LINEAR");
    expect(terrainPass).toContain("ownership borders are still drawn sharply");
    expect(borderPass).toContain("filter: gl.NEAREST");
  });

  it("packs exact terrain metadata without allocating a second terrain map", () => {
    const bytes = new Uint8Array([0x00, 0x40, 0x80, 0x9e, 0x9f]);
    const rgba = buildTerrainVisualRGBA(bytes, bytes.length, 1);

    expect([...rgba.filter((_, index) => index % 4 === 3)]).toEqual([
      0x00, 0x40, 0x80, 0x9e, 0x9f,
    ]);
  });

  it("uses deterministic multi-scale relief with categorical-edge guarding", () => {
    const shader = source(
      "src/client/render/gl/shaders/terrain/terrain.frag.glsl",
    );

    expect(shader).toContain("float reliefGuard");
    expect(shader).toContain("float terrainNoise");
    expect(shader).toContain("float surfaceDetail");
    expect(shader).toContain("float pixelFootprint");
    expect(shader).toContain("dFdx(worldPos)");
    expect(shader).toContain("compatibleLandHeight");
    expect(shader).toContain("float proceduralRelief");
    expect(shader).toContain("-0.11");
    expect(shader).toContain("0.12");
    expect(shader).not.toContain("uTime");
  });

  it("differentiates flat source land with restrained climate detail", () => {
    const shader = source(
      "src/client/render/gl/shaders/terrain/terrain.frag.glsl",
    );

    expect(shader).toContain("float absoluteLatitude");
    expect(shader).toContain("float subtropicalBand");
    expect(shader).toContain("float tropicalMoisture");
    expect(shader).toContain("float polarClimate");
    expect(shader).toContain("float settlementFlecks");
  });

  it("renders magnitude-backed water depth and anti-aliased coast treatment", () => {
    const shader = source(
      "src/client/render/gl/shaders/terrain/terrain.frag.glsl",
    );

    expect(shader).toContain("float depth");
    expect(shader).toContain("float coastDistance");
    expect(shader).toContain("float coastAA");
    expect(shader).toContain("float coastFoam");
    expect(shader).toContain("shorelineMask");
  });

  it("keeps direct terrain encoding aligned with the modern default palette", () => {
    const plainLand = 0x80;
    const out = new Uint8Array(4);

    encodeTerrainTile(plainLand, out, 0);

    expect([...out]).toEqual([0x59, 0x69, 0x4b, 0xff]);
  });
});
