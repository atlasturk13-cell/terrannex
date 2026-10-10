import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { mapAssetFolder } from "../../../../src/client/controllers/SatelliteTerrainController";
import {
  SATELLITE_DETAIL_ZOOM_END,
  SATELLITE_DETAIL_ZOOM_START,
  SatelliteTileCache,
  satelliteDetailMix,
  type SatelliteIndex,
} from "../../../../src/client/render/gl/SatelliteTerrain";
import { GameMapType } from "../../../../src/core/game/Game";

const index: SatelliteIndex = {
  version: 1,
  source: "NASA",
  texelsPerTile: 8,
  width: 4096,
  height: 2048,
  tileSize: 512,
  cols: 8,
  rows: 4,
  overview: { file: "overview.webp", width: 1024, height: 512 },
};

function fakeBitmap(): ImageBitmap {
  return { close: vi.fn() } as unknown as ImageBitmap;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function setup(slots = 4) {
  const fetched: Array<[number, number]> = [];
  const uploads: Array<[number, ImageBitmap]> = [];
  let lookup = new Uint8Array(0);
  const cache = new SatelliteTileCache(
    {
      index,
      overview: fakeBitmap(),
      fetchTile: (col, row) => {
        fetched.push([col, row]);
        return col === 7 && row === 3
          ? Promise.reject(new Error("missing"))
          : Promise.resolve(fakeBitmap());
      },
    },
    {
      uploadDetailTile: (slot, bitmap) => uploads.push([slot, bitmap]),
      setDetailSlots: (slots) => {
        lookup = slots.slice();
      },
    },
    slots,
  );
  // The map is 512 x 256 tiles: one detail tile spans 64 x 64 map tiles.
  return { cache, fetched, uploads, lookup: () => lookup };
}

describe("satellite detail tiles", () => {
  it("fades detail in between the two zoom thresholds", () => {
    expect(satelliteDetailMix(SATELLITE_DETAIL_ZOOM_START)).toBe(0);
    expect(satelliteDetailMix(1)).toBe(0);
    expect(satelliteDetailMix(SATELLITE_DETAIL_ZOOM_END)).toBe(1);
    expect(satelliteDetailMix(20)).toBe(1);
    const middle = satelliteDetailMix(
      (SATELLITE_DETAIL_ZOOM_START + SATELLITE_DETAIL_ZOOM_END) / 2,
    );
    expect(middle).toBeCloseTo(0.5, 5);
  });

  it("fetches only the visible tiles, centre first, and publishes their slots", async () => {
    const { cache, fetched, lookup } = setup(8);
    cache.update({ x0: 70, y0: 70, x1: 190, y1: 120 }, 512, 256, true);
    // Columns 1-2, row 1: two tiles; the centre-most first.
    expect(fetched).toEqual([
      [1, 1],
      [2, 1],
    ]);
    await settle();
    cache.update({ x0: 70, y0: 70, x1: 190, y1: 120 }, 512, 256, true);
    const slots = lookup();
    expect(slots[1 * 8 + 1]).toBeGreaterThan(0);
    expect(slots[1 * 8 + 2]).toBeGreaterThan(0);
    expect([...slots].filter((slot) => slot > 0)).toHaveLength(2);
    // Resident tiles are not fetched again.
    expect(fetched).toHaveLength(2);
  });

  it("asks for nothing while zoomed out, and never retries a missing tile", async () => {
    const { cache, fetched } = setup();
    cache.update({ x0: 0, y0: 0, x1: 512, y1: 256 }, 512, 256, false);
    expect(fetched).toHaveLength(0);
    cache.update({ x0: 460, y0: 200, x1: 511, y1: 255 }, 512, 256, true);
    expect(fetched).toEqual([[7, 3]]);
    await settle();
    cache.update({ x0: 460, y0: 200, x1: 511, y1: 255 }, 512, 256, true);
    expect(fetched).toHaveLength(1);
  });

  it("recycles the least recently seen slot when the pool is full", async () => {
    const { cache, uploads, lookup } = setup(2);
    cache.update({ x0: 0, y0: 0, x1: 127, y1: 63 }, 512, 256, true); // tiles 0,1
    await settle();
    cache.update({ x0: 0, y0: 0, x1: 63, y1: 63 }, 512, 256, true); // keep tile 0 fresh
    cache.update({ x0: 128, y0: 0, x1: 191, y1: 63 }, 512, 256, true); // tile 2
    await settle();
    cache.update({ x0: 128, y0: 0, x1: 191, y1: 63 }, 512, 256, true);
    expect(uploads).toHaveLength(3);
    expect(cache.residentTiles().sort()).toEqual([0, 2]);
    expect(lookup()[1]).toBe(0);
  });

  it("finds each map's asset folder like the terrain loader", () => {
    expect(mapAssetFolder(GameMapType.NaturalEarthWorld)).toBe(
      "naturalearthworld",
    );
    expect(mapAssetFolder(GameMapType.EuropeMediterranean)).toBe(
      "europemediterranean",
    );
  });

  it("the terrain shader uses the imagery and falls back where the land changed", () => {
    const shader = fs.readFileSync(
      path.resolve("src/client/render/gl/shaders/terrain/terrain.frag.glsl"),
      "utf8",
    );
    for (const name of [
      "uSatEnabled",
      "uSatOverview",
      "uSatDetail",
      "uSatLookup",
      "uInitialLand",
      "uSatDetailMix",
    ]) {
      expect(shader).toContain(name);
    }
    expect(shader).toContain("pictureLand == isLand");
    expect(shader).not.toContain("uTime");
  });
});
