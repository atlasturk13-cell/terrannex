import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const sourceRoot = path.join(
  root,
  "map-generator/sources/natural-earth-v5.1.2",
);
const assetRoot = path.join(root, "map-generator/assets/maps");
const runtimeRoot = path.join(root, "resources/maps");
const provenancePath = path.join(sourceRoot, "REGIONAL_PROVENANCE.json");

const SOURCE_SHA256 =
  "3e458fc036ad0a66411f2c1e6cac49c5d7bfb81cb1123bc513b22511a2b7fdeb";

const regions = [
  {
    folder: "europemediterranean",
    id: "EuropeMediterranean",
    label: "Europe–Mediterranean",
  },
  {
    folder: "northamericacaribbean",
    id: "NorthAmericaCaribbean",
    label: "North America–Caribbean",
  },
  {
    folder: "naturalearthsouthamerica",
    id: "NaturalEarthSouthAmerica",
    label: "South America",
  },
  {
    folder: "africamiddleeast",
    id: "AfricaMiddleEast",
    label: "Africa–Middle East",
  },
  { folder: "asiapacific", id: "AsiaPacific", label: "Asia–Pacific" },
] as const;

const runtimeFiles = [
  "map.bin",
  "map4x.bin",
  "map16x.bin",
  "thumbnail.webp",
  "manifest.json",
] as const;

type TerrainMetadata = {
  width: number;
  height: number;
  num_land_tiles: number;
};

type Nation = {
  coordinates: [number, number];
  flag?: string;
  name: string;
};

type RegionalManifest = {
  categories: string[];
  description: string;
  display_name: string;
  id: string;
  map: TerrainMetadata;
  map4x: TerrainMetadata;
  map16x: TerrainMetadata;
  modifications: string[];
  multiplayer_frequency: number;
  name: string;
  nations: Nation[];
  source: {
    commit: string;
    dataset: string;
    license: string;
    license_url: string;
    release: string;
    source_sha256: string;
    terms: string;
    terms_url: string;
    url: string;
  };
  translation_key: string;
};

type Provenance = {
  dataset: RegionalManifest["source"];
  generator: {
    edge_water_margin_pixels: number;
    pillow: string;
    regional_script: string;
    terrain_generator: string;
  };
  maps: Record<
    string,
    {
      bounds_wgs84: [number, number, number, number];
      description: string;
      display_name: string;
      id: string;
      modifications: string[];
      output_hashes: Record<string, string>;
      source_hashes: Record<string, string>;
      terrain: Record<"map" | "map4x" | "map16x", TerrainMetadata>;
    }
  >;
};

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function isLand(tile: number): boolean {
  return (tile & 0b1000_0000) !== 0;
}

function countOceanAndShore(
  terrain: Buffer,
  width: number,
  height: number,
): { ocean: number; shore: number; water: number } {
  const seen = new Uint8Array(terrain.length);
  const queue = new Int32Array(terrain.length);
  let read = 0;
  let write = 0;
  let water = 0;
  let shore = 0;

  for (let index = 0; index < terrain.length; index++) {
    if (!isLand(terrain[index])) water++;
  }

  const start = terrain.findIndex((tile) => !isLand(tile));
  expect(start).toBeGreaterThanOrEqual(0);
  queue[write++] = start;
  seen[start] = 1;

  while (read < write) {
    const index = queue[read++];
    const x = index % width;
    const y = Math.floor(index / width);
    const neighbors = [
      x > 0 ? index - 1 : -1,
      x + 1 < width ? index + 1 : -1,
      y > 0 ? index - width : -1,
      y + 1 < height ? index + width : -1,
    ];
    for (const neighbor of neighbors) {
      if (neighbor < 0) continue;
      if (isLand(terrain[neighbor])) {
        shore++;
      } else if (seen[neighbor] === 0) {
        seen[neighbor] = 1;
        queue[write++] = neighbor;
      }
    }
  }

  return { ocean: write, shore, water };
}

describe("Natural Earth regional map families", () => {
  const provenance = JSON.parse(
    fs.readFileSync(provenancePath, "utf8"),
  ) as Provenance;

  it("admits exactly five honest regional families", () => {
    expect(Object.keys(provenance.maps).sort()).toEqual(
      regions.map(({ folder }) => folder).sort(),
    );
    expect(regions.map(({ label }) => label)).toEqual([
      "Europe–Mediterranean",
      "North America–Caribbean",
      "South America",
      "Africa–Middle East",
      "Asia–Pacific",
    ]);
  });

  it("uses only the pinned public-domain source and toolchain", () => {
    expect(
      sha256(path.join(sourceRoot, "ne_50m_admin_0_countries.geojson")),
    ).toBe(SOURCE_SHA256);
    expect(provenance.dataset).toMatchObject({
      commit: "f1890d9f152c896d250a77557a5751a93d494776",
      license: "Public domain",
      license_url:
        "https://github.com/nvkelso/natural-earth-vector/blob/f1890d9f152c896d250a77557a5751a93d494776/LICENSE.md",
      release: "v5.1.2",
      source_sha256: SOURCE_SHA256,
      terms: "Natural Earth raster and vector map data is public domain.",
      terms_url: "https://www.naturalearthdata.com/about/terms-of-use/",
    });
    expect(provenance.generator).toEqual({
      edge_water_margin_pixels: 24,
      pillow: "10.4.0",
      regional_script:
        "map-generator/scripts/generate_natural_earth_regions.py",
      terrain_generator: "map-generator (pinned repository source)",
    });
  });

  it.each(regions)(
    "$label has complete, hash-locked source and runtime outputs",
    ({ folder, id, label }) => {
      const assetDir = path.join(assetRoot, folder);
      const runtimeDir = path.join(runtimeRoot, folder);
      const info = JSON.parse(
        fs.readFileSync(path.join(assetDir, "info.json"), "utf8"),
      ) as RegionalManifest;
      const manifest = JSON.parse(
        fs.readFileSync(path.join(runtimeDir, "manifest.json"), "utf8"),
      ) as RegionalManifest;
      const record = provenance.maps[folder];

      expect(fs.readdirSync(assetDir).sort()).toEqual([
        "image.png",
        "info.json",
      ]);
      expect(
        runtimeFiles.every((file) =>
          fs.existsSync(path.join(runtimeDir, file)),
        ),
      ).toBe(true);
      expect(info).toEqual(
        expect.objectContaining({
          description: record.description,
          display_name: label,
          id,
          modifications: record.modifications,
          multiplayer_frequency: 0,
          source: provenance.dataset,
          translation_key: `map.${folder}`,
        }),
      );
      expect(manifest).toEqual(expect.objectContaining(info));
      expect(record).toMatchObject({ display_name: label, id });

      expect(record.source_hashes).toEqual({
        "image.png": sha256(path.join(assetDir, "image.png")),
        "info.json": sha256(path.join(assetDir, "info.json")),
      });
      for (const file of runtimeFiles) {
        expect(record.output_hashes[file]).toBe(
          sha256(path.join(runtimeDir, file)),
        );
      }

      const words = info.description.replace(/[.!?]+$/u, "").split(/\s+/u);
      expect(words.length).toBeGreaterThanOrEqual(2);
      expect(words.length).toBeLessThanOrEqual(6);
      expect(info.description).not.toMatch(/[çğıöşüÇĞİÖŞÜ]/u);
      expect(info.modifications.length).toBeGreaterThanOrEqual(3);
    },
  );

  it.each(regions)(
    "$label has valid land starts, shore, ports, and connected ocean",
    ({ folder }) => {
      const runtimeDir = path.join(runtimeRoot, folder);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(runtimeDir, "manifest.json"), "utf8"),
      ) as RegionalManifest;
      const fullTerrain = fs.readFileSync(path.join(runtimeDir, "map.bin"));

      expect(fullTerrain.length).toBe(manifest.map.width * manifest.map.height);
      expect(manifest.map.width % 4).toBe(0);
      expect(manifest.map.height % 4).toBe(0);
      expect(manifest.nations.length).toBeGreaterThanOrEqual(10);
      expect(new Set(manifest.nations.map(({ name }) => name)).size).toBe(
        manifest.nations.length,
      );
      for (const nation of manifest.nations) {
        const [x, y] = nation.coordinates;
        expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(manifest.map.width);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(manifest.map.height);
        expect(isLand(fullTerrain[y * manifest.map.width + x])).toBe(true);
        expect(nation.flag).toBeUndefined();
      }

      const compactTerrain = fs.readFileSync(
        path.join(runtimeDir, "map16x.bin"),
      );
      const topology = countOceanAndShore(
        compactTerrain,
        manifest.map16x.width,
        manifest.map16x.height,
      );
      expect(topology.water).toBeGreaterThan(1_000);
      expect(topology.ocean / topology.water).toBeGreaterThan(0.9);
      expect(topology.shore).toBeGreaterThan(100);

      const { width, height } = manifest.map16x;
      for (let x = 0; x < width; x++) {
        expect(isLand(compactTerrain[x])).toBe(false);
        expect(isLand(compactTerrain[(height - 1) * width + x])).toBe(false);
      }
      for (let y = 0; y < height; y++) {
        expect(isLand(compactTerrain[y * width])).toBe(false);
        expect(isLand(compactTerrain[y * width + width - 1])).toBe(false);
      }
    },
  );

  it("preserves the Natural Earth World outputs byte-for-byte", () => {
    const worldAssetDir = path.join(assetRoot, "naturalearthworld");
    const worldRuntimeDir = path.join(runtimeRoot, "naturalearthworld");
    expect(sha256(path.join(worldAssetDir, "image.png"))).toBe(
      "978440db97e3d79709afdabe28d2a41d4a028cb4771eee52f1ff1b86e70eec71",
    );
    expect(sha256(path.join(worldAssetDir, "info.json"))).toBe(
      "fe80fcd744a7c1a3f07e3aab9b2667fda140355e488bad427a4c1b4274271533",
    );
    expect(sha256(path.join(worldRuntimeDir, "map.bin"))).toBe(
      "15ba6399b0a1cbcfb9a58b6dcb5db8531198207b03709b35194d18275b672264",
    );
    expect(sha256(path.join(worldRuntimeDir, "map4x.bin"))).toBe(
      "baa1b69e6d43fa92a8ebf947b35ebfcddc84b082db0dbdcd477a1d2a257a8538",
    );
    expect(sha256(path.join(worldRuntimeDir, "map16x.bin"))).toBe(
      "ee7c0a24aae94742e47c6200f7a30f19fe4e9bf986dbe8d448f645ffd1071492",
    );
    expect(sha256(path.join(worldRuntimeDir, "thumbnail.webp"))).toBe(
      "102189b9ce63809e5245ad7d0343e041f1a1bc3b3d76ff0ef9a663f7477ec0da",
    );
    expect(sha256(path.join(worldRuntimeDir, "manifest.json"))).toBe(
      "fc0eff4ca0adf1492ec3c2c1b0587b08072eff99dec1761dca8e4dd660d71b15",
    );
  });
});
