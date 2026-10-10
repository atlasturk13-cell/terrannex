import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { STRUCTURE_ORDER } from "../../../../src/client/render/gl/passes/StructurePass";
import {
  ALL_UNIT_TYPES,
  STRUCTURE_TYPES,
  UT_BARRACKS,
} from "../../../../src/client/render/types";
import { UnitType } from "../../../../src/core/game/Game";

const root = path.resolve(__dirname, "../../../..");

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("Barracks rendering contract", () => {
  it("registers Barracks as a structure matching the core unit type", () => {
    expect(UT_BARRACKS).toBe(UnitType.Barracks);
    expect(STRUCTURE_TYPES.has(UT_BARRACKS)).toBe(true);
    expect(ALL_UNIT_TYPES).toContain(UT_BARRACKS);
  });

  it("takes procedural slot 7, after Airport, without touching the six-column atlas", () => {
    expect(STRUCTURE_ORDER.indexOf(UT_BARRACKS)).toBe(7);
    expect(STRUCTURE_ORDER.indexOf("Airport")).toBe(6);
    expect(STRUCTURE_ORDER).toHaveLength(8);

    const pass = source("src/client/render/gl/passes/StructurePass.ts");
    expect(pass).toContain("const ATLAS_COLS = 6");
    // Close-up art is listed in STRUCTURE_ORDER order: Barracks is last.
    const detailUrls = [
      ...pass.matchAll(/assetUrl\("images\/structures\/([a-z-]+)\.svg"\)/g),
    ].map((match) => match[1]);
    expect(detailUrls).toHaveLength(STRUCTURE_ORDER.length);
    expect(detailUrls[detailUrls.length - 1]).toBe("barracks");

    const shader = source(
      "src/client/render/gl/shaders/structure/structure.frag.glsl",
    );
    expect(shader).toContain("vAtlasIdx > 6.5");
    expect(shader).toContain("Barracks → badge");
    expect(shader).toContain("float sdShield");
    expect(shader).toContain("float roofGlyph");
    expect(shader).toContain("float blockGlyph");
    // The Barracks branch comes first so the Airport branch (> 5.5) never
    // swallows slot 7.
    expect(shader.indexOf("vAtlasIdx > 6.5")).toBeLessThan(
      shader.indexOf("vAtlasIdx > 5.5"),
    );

    expect(
      source("src/client/render/gl/passes/StructureLevelPass.ts"),
    ).toContain("UT_BARRACKS,\n] as const;");
    expect(source("src/client/render/gl/passes/PointLightPass.ts")).toContain(
      "[UT_BARRACKS]",
    );
    const settings = JSON.parse(
      source("src/client/render/gl/render-settings.json"),
    ) as {
      structure: { shapes: Record<string, unknown> };
      lightConfigs: Record<string, unknown>;
    };
    expect(settings.structure.shapes[UT_BARRACKS]).toBeDefined();
    expect(settings.lightConfigs[UT_BARRACKS]).toBeDefined();
  });

  // Terrannex-owned art is not in the public repository (TERRANNEX_ASSETS.md).
  it.skip("ships original close-up and icon art in the house style", () => {
    const art = source("resources/images/structures/barracks.svg");
    expect(art).toContain('viewBox="0 0 256 256"');
    expect(art).toContain(
      '<clipPath id="c"><circle cx="128" cy="128" r="126"/>',
    );
    expect(art).not.toMatch(/<image|href=/);

    const icon = source("resources/images/BarracksIconWhite.svg");
    expect(icon).toContain('<title id="title">Barracks</title>');
    expect(icon).toContain('aria-labelledby="title"');
    expect(icon).toContain('viewBox="0 0 64 64"');
    expect(icon).toContain('data-part="roof"');
    expect(icon).toContain('data-part="block"');

    expect(source("THIRD_PARTY_NOTICES.md")).toContain(
      "`resources/images/structures/barracks.svg`",
    );
  });

  it("leaves the inherited bitmap atlas untouched", () => {
    const atlas = fs.readFileSync(
      path.join(root, "resources/atlases/icon-atlas.png"),
    );
    expect(createHash("sha256").update(atlas).digest("hex")).toBe(
      "97fbc9711e899509d53b57692b4648d9f144f44ca972191df06e004a3f2af297",
    );
  });
});
