import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import {
  STRUCTURE_TYPES,
  UT_AIRPORT,
} from "../../../../src/client/render/types";

const root = path.resolve(__dirname, "../../../..");

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function sha256(relativePath: string): string {
  return createHash("sha256")
    .update(fs.readFileSync(path.join(root, relativePath)))
    .digest("hex");
}

describe("Airport rendering contract", () => {
  // Terrannex-owned art is not in the public repository (TERRANNEX_ASSETS.md).
  it.skip("registers Airport as a structure with an original accessible icon", () => {
    expect(STRUCTURE_TYPES.has(UT_AIRPORT)).toBe(true);
    const icon = source("resources/images/AirportIconWhite.svg");
    expect(icon).toContain('<title id="title">Airport</title>');
    expect(icon).toContain('aria-labelledby="title"');
    expect(icon).toContain('data-part="runway"');
    expect(icon).toContain('data-part="terminal"');
    expect(icon).toContain('data-part="control-tower"');
    expect(icon).toContain('viewBox="0 0 64 64"');
  });

  it("keeps the inherited six-column atlas fixed and renders Airport procedurally", () => {
    const pass = source("src/client/render/gl/passes/StructurePass.ts");
    const shader = source(
      "src/client/render/gl/shaders/structure/structure.frag.glsl",
    );
    expect(pass).toContain("const ATLAS_COLS = 6");
    expect(pass).toContain(
      "const STRUCTURE_TYPE_COUNT = STRUCTURE_ORDER.length",
    );
    expect(pass).toContain("UT_AIRPORT");
    expect(shader).toContain("Airport → diamond");
    expect(shader).toContain("vAtlasIdx > 5.5");
    expect(shader).toContain("float runwayGlyph");
    expect(shader).toContain("float terminalGlyph");
    expect(shader).toContain("float controlTowerGlyph");
    expect(shader).toContain("sdBox");

    const vertex = source(
      "src/client/render/gl/shaders/structure/structure.vert.glsl",
    );
    expect(vertex).toContain("uShapeScales[STRUCTURE_TYPE_COUNT]");
    expect(vertex).toContain("uIconFills[STRUCTURE_TYPE_COUNT]");
    expect(
      source("src/client/render/gl/passes/StructureLevelPass.ts"),
    ).toContain("UT_AIRPORT");
    expect(source("src/client/render/gl/passes/PointLightPass.ts")).toContain(
      "[UT_AIRPORT]",
    );
    expect(source("src/client/render/gl/render-settings.json")).toContain(
      '"Airport"',
    );

    const atlas = fs.readFileSync(
      path.join(root, "resources/atlases/icon-atlas.png"),
    );
    expect([atlas.readUInt32BE(16), atlas.readUInt32BE(20)]).toEqual([384, 64]);
    expect(sha256("resources/atlases/icon-atlas.png")).toBe(
      "97fbc9711e899509d53b57692b4648d9f144f44ca972191df06e004a3f2af297",
    );
  });
});
