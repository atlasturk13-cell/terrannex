import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const sourceDir = path.join(root, "map-generator/sources/natural-earth-v5.1.2");
const assetDir = path.join(root, "map-generator/assets/maps/naturalearthworld");
const runtimeDir = path.join(root, "resources/maps/naturalearthworld");
const FULL_WIDTH = 2000;
const FULL_HEIGHT = 1000;

type TerrainFixture = {
  name: string;
  file: string;
  width: number;
  height: number;
  scale: number;
};

const terrainFixtures: TerrainFixture[] = [
  {
    name: "full resolution",
    file: "map.bin",
    width: 2000,
    height: 1000,
    scale: 1,
  },
  {
    name: "Normal minimap",
    file: "map4x.bin",
    width: 1000,
    height: 500,
    scale: 2,
  },
  {
    name: "Compact minimap",
    file: "map16x.bin",
    width: 500,
    height: 250,
    scale: 4,
  },
];

// Baseline commit 39e427ff leaves Gibraltar closed at full/Normal resolution
// and the English Channel closed at full resolution. They therefore remain
// generator-backed passages rather than audit-only naturally open topology.
const requiredWaterwayFixtures = [
  {
    name: "Strait of Gibraltar",
    from: [-7, 36],
    to: [-4, 36],
    bounds: [-8, 34.5, -3, 37.5],
  },
  {
    name: "English Channel",
    from: [-1, 50.5],
    to: [2, 51.2],
    bounds: [-2, 49.5, 3, 52],
  },
] as const;

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function projectWgs84(
  fixture: TerrainFixture,
  longitude: number,
  latitude: number,
): [number, number] {
  const fullX = Math.round(((longitude + 180) * (FULL_WIDTH - 1)) / 360);
  const fullY = Math.round(((90 - latitude) * (FULL_HEIGHT - 1)) / 180);
  return [Math.floor(fullX / fixture.scale), Math.floor(fullY / fixture.scale)];
}

function isLand(terrain: Buffer, width: number, [x, y]: [number, number]) {
  return (terrain[y * width + x] & 0b1000_0000) !== 0;
}

function hasTerrainPath(
  terrain: Buffer,
  fixture: TerrainFixture,
  from: [number, number],
  to: [number, number],
  passable: (tile: number) => boolean,
  bounds: { minX: number; minY: number; maxX: number; maxY: number } = {
    minX: 0,
    minY: 0,
    maxX: fixture.width - 1,
    maxY: fixture.height - 1,
  },
): boolean {
  const queue = new Int32Array(
    (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1),
  );
  const seen = new Uint8Array(fixture.width * fixture.height);
  const start = from[1] * fixture.width + from[0];
  const target = to[1] * fixture.width + to[0];
  let read = 0;
  let write = 0;
  queue[write++] = start;
  seen[start] = 1;

  while (read < write) {
    const current = queue[read++];
    if (current === target) return true;
    const x = current % fixture.width;
    const y = Math.floor(current / fixture.width);
    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ] as const;
    for (const [nextX, nextY] of neighbors) {
      if (
        nextX < bounds.minX ||
        nextX > bounds.maxX ||
        nextY < bounds.minY ||
        nextY > bounds.maxY
      ) {
        continue;
      }
      const next = nextY * fixture.width + nextX;
      if (seen[next] !== 0 || !passable(terrain[next])) continue;
      seen[next] = 1;
      queue[write++] = next;
    }
  }
  return false;
}

describe("NaturalEarthWorld generated map provenance", () => {
  it("pins the public-domain vector source and deterministic outputs", () => {
    expect(
      sha256(path.join(sourceDir, "ne_50m_admin_0_countries.geojson")),
    ).toBe("3e458fc036ad0a66411f2c1e6cac49c5d7bfb81cb1123bc513b22511a2b7fdeb");
    expect(sha256(path.join(assetDir, "image.png"))).toBe(
      "978440db97e3d79709afdabe28d2a41d4a028cb4771eee52f1ff1b86e70eec71",
    );
    expect(sha256(path.join(assetDir, "info.json"))).toBe(
      "fe80fcd744a7c1a3f07e3aab9b2667fda140355e488bad427a4c1b4274271533",
    );
    expect(sha256(path.join(runtimeDir, "map.bin"))).toBe(
      "15ba6399b0a1cbcfb9a58b6dcb5db8531198207b03709b35194d18275b672264",
    );
    expect(sha256(path.join(runtimeDir, "map4x.bin"))).toBe(
      "baa1b69e6d43fa92a8ebf947b35ebfcddc84b082db0dbdcd477a1d2a257a8538",
    );
    expect(sha256(path.join(runtimeDir, "map16x.bin"))).toBe(
      "ee7c0a24aae94742e47c6200f7a30f19fe4e9bf986dbe8d448f645ffd1071492",
    );
    expect(sha256(path.join(runtimeDir, "thumbnail.webp"))).toBe(
      "102189b9ce63809e5245ad7d0343e041f1a1bc3b3d76ff0ef9a663f7477ec0da",
    );
    expect(sha256(path.join(runtimeDir, "manifest.json"))).toBe(
      "fc0eff4ca0adf1492ec3c2c1b0587b08072eff99dec1761dca8e4dd660d71b15",
    );
  });

  it("is a 2:1 land-and-ocean map with shoreline and valid no-flag Nations", () => {
    const image = fs.readFileSync(path.join(assetDir, "image.png"));
    expect(image.readUInt32BE(16)).toBe(2000);
    expect(image.readUInt32BE(20)).toBe(1000);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(runtimeDir, "manifest.json"), "utf8"),
    );
    const terrain = fs.readFileSync(path.join(runtimeDir, "map.bin"));
    expect(manifest.name).toBe("Natural Earth World");
    expect(manifest.map).toEqual({
      width: 2000,
      height: 1000,
      num_land_tiles: 679332,
    });
    expect(manifest.map4x).toEqual({
      width: 1000,
      height: 500,
      num_land_tiles: 164994,
    });
    expect(manifest.map16x).toEqual({
      width: 500,
      height: 250,
      num_land_tiles: 39473,
    });
    expect(terrain.length).toBe(2_000_000);

    let land = 0;
    let ocean = 0;
    let shore = 0;
    for (const tile of terrain) {
      if ((tile & 0b1000_0000) !== 0 && tile !== 0b1001_1111) land++;
      if ((tile & 0b0010_0000) !== 0) ocean++;
      if ((tile & 0b0100_0000) !== 0) shore++;
    }
    expect(land).toBe(manifest.map.num_land_tiles);
    expect(ocean).toBeGreaterThan(1_000_000);
    expect(shore).toBeGreaterThan(10_000);

    expect(manifest.nations.length).toBeGreaterThanOrEqual(16);
    for (const nation of manifest.nations) {
      expect(nation).not.toHaveProperty("flag");
      const [x, y] = nation.coordinates;
      const tile = terrain[y * manifest.map.width + x];
      expect(tile & 0b1000_0000, nation.name).toBe(0b1000_0000);
      expect(tile, nation.name).not.toBe(0b1001_1111);
    }
  });

  it("keeps the Bosphorus on its three-cell 4x lattice minimum", () => {
    const terrain = fs.readFileSync(path.join(runtimeDir, "map.bin"));
    const carvedCells = [
      [290, 67],
      [290, 68],
      [289, 68],
    ] as const;
    for (const [cellX, cellY] of carvedCells) {
      for (let y = cellY * 4; y < cellY * 4 + 4; y++) {
        for (let x = cellX * 4; x < cellX * 4 + 4; x++) {
          expect(isLand(terrain, FULL_WIDTH, [x, y])).toBe(false);
        }
      }
    }

    // The retired fourth cell still contains land. This proves the narrower
    // corridor is intentional rather than the former 2x2-cell carve.
    let retainedLand = 0;
    for (let y = 67 * 4; y < 67 * 4 + 4; y++) {
      for (let x = 289 * 4; x < 289 * 4 + 4; x++) {
        if (isLand(terrain, FULL_WIDTH, [x, y])) retainedLand++;
      }
    }
    expect(retainedLand).toBeGreaterThan(0);
  });

  it.each(terrainFixtures)(
    "keeps the Black Sea, Marmara, and Aegean connected while separating the Bosphorus banks on $name",
    (fixture) => {
      const terrain = fs.readFileSync(path.join(runtimeDir, fixture.file));
      const blackSea = projectWgs84(fixture, 34, 43);
      const marmara = projectWgs84(fixture, 28.5, 40.65);
      // A point in open Aegean water, rather than the Gallipoli shoreline.
      const aegean = projectWgs84(fixture, 25, 39.5);
      for (const point of [blackSea, marmara, aegean]) {
        expect(isLand(terrain, fixture.width, point)).toBe(false);
      }

      const water = (tile: number) => (tile & 0b1000_0000) === 0;
      expect(hasTerrainPath(terrain, fixture, blackSea, marmara, water)).toBe(
        true,
      );
      expect(hasTerrainPath(terrain, fixture, marmara, aegean, water)).toBe(
        true,
      );

      const europe = projectWgs84(fixture, 27.2, 41);
      const asia = projectWgs84(fixture, 29.7, 41);
      expect(isLand(terrain, fixture.width, europe)).toBe(true);
      expect(isLand(terrain, fixture.width, asia)).toBe(true);
      const [minX, maxY] = projectWgs84(fixture, 26.5, 40.5);
      const [maxX, minY] = projectWgs84(fixture, 30.5, 41.7);
      expect(
        hasTerrainPath(
          terrain,
          fixture,
          europe,
          asia,
          (tile) => (tile & 0b1000_0000) !== 0,
          { minX, minY, maxX, maxY },
        ),
      ).toBe(false);
    },
  );

  it.each(terrainFixtures)(
    "keeps the other named, bounded strategic passages open on $name",
    (fixture) => {
      const terrain = fs.readFileSync(path.join(runtimeDir, fixture.file));
      const water = (tile: number) => (tile & 0b1000_0000) === 0;
      for (const passage of requiredWaterwayFixtures) {
        const from = projectWgs84(fixture, passage.from[0], passage.from[1]);
        const to = projectWgs84(fixture, passage.to[0], passage.to[1]);
        expect(isLand(terrain, fixture.width, from), passage.name).toBe(false);
        expect(isLand(terrain, fixture.width, to), passage.name).toBe(false);
        const [west, south, east, north] = passage.bounds;
        const [minX, maxY] = projectWgs84(fixture, west, south);
        const [maxX, minY] = projectWgs84(fixture, east, north);
        expect(
          hasTerrainPath(terrain, fixture, from, to, water, {
            minX,
            minY,
            maxX,
            maxY,
          }),
          passage.name,
        ).toBe(true);
      }
    },
  );
});
