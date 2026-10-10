/**
 * Satellite terrain: NASA Blue Marble imagery baked per map by
 * map-generator/cmd/satellite (resources/maps/<map>/satellite/). One
 * overview texture (two texels per map tile, mipmapped) is always resident;
 * 512-px detail tiles (eight texels per map tile) stream in for the visible
 * area once the camera is close enough, into a fixed pool of texture-array
 * slots recycled least-recently-used.
 */

export interface SatelliteIndex {
  version: number;
  source: string;
  texelsPerTile: number;
  width: number;
  height: number;
  tileSize: number;
  cols: number;
  rows: number;
  overview: { file: string; width: number; height: number };
}

export interface SatelliteSource {
  index: SatelliteIndex;
  overview: ImageBitmap;
  /** Loads one detail tile; rejects when it is unavailable. */
  fetchTile(col: number, row: number): Promise<ImageBitmap>;
}

/** Zoom (screen pixels per map tile) where detail tiles start / finish fading in. */
export const SATELLITE_DETAIL_ZOOM_START = 3.5;
export const SATELLITE_DETAIL_ZOOM_END = 5.5;
/** Detail tiles resident on the GPU at once (512² RGBA8 each ≈ 1 MB). */
export const SATELLITE_DETAIL_SLOTS = 48;
/** Detail tile fetches in flight at once. */
const MAX_PENDING_FETCHES = 6;

export function satelliteDetailMix(zoom: number): number {
  const t =
    (zoom - SATELLITE_DETAIL_ZOOM_START) /
    (SATELLITE_DETAIL_ZOOM_END - SATELLITE_DETAIL_ZOOM_START);
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

export interface DetailTileSink {
  uploadDetailTile(slot: number, bitmap: ImageBitmap): void;
  setDetailSlots(slotByTile: Uint8Array): void;
}

/**
 * CPU side of the detail-tile pool: decides which tiles the view needs,
 * fetches them, and tells the GPU sink which slot holds which tile. Pure
 * bookkeeping — testable without WebGL.
 */
export class SatelliteTileCache {
  /** slot + 1 per tile (0 = not resident), uploaded as the lookup texture. */
  private readonly slotByTile: Uint8Array;
  private readonly tileBySlot: Int32Array;
  private readonly lastUsed: Float64Array;
  private readonly pending = new Set<number>();
  private readonly failed = new Set<number>();
  private frame = 0;
  private dirty = false;
  private disposed = false;

  constructor(
    private readonly source: SatelliteSource,
    private readonly sink: DetailTileSink,
    private readonly slots = SATELLITE_DETAIL_SLOTS,
  ) {
    const { cols, rows } = source.index;
    this.slotByTile = new Uint8Array(cols * rows);
    this.tileBySlot = new Int32Array(slots).fill(-1);
    this.lastUsed = new Float64Array(slots);
  }

  /**
   * Called every frame with the visible map rectangle in map-tile units
   * (the map spans mapW × mapH). Requests the missing visible tiles, nearest
   * to the centre first, and refreshes the lookup texture when it changed.
   */
  update(
    visible: { x0: number; y0: number; x1: number; y1: number },
    mapW: number,
    mapH: number,
    wantDetail: boolean,
  ): void {
    this.frame++;
    if (!wantDetail || this.disposed) {
      this.flush();
      return;
    }
    const { cols, rows, tileSize, width, height } = this.source.index;
    // One detail tile spans tileSize texels of a width-texel image.
    const tileW = (tileSize / width) * mapW;
    const tileH = (tileSize / height) * mapH;
    const c0 = Math.max(0, Math.floor(visible.x0 / tileW));
    const c1 = Math.min(cols - 1, Math.floor(visible.x1 / tileW));
    const r0 = Math.max(0, Math.floor(visible.y0 / tileH));
    const r1 = Math.min(rows - 1, Math.floor(visible.y1 / tileH));
    const cx = (c0 + c1) / 2;
    const cy = (r0 + r1) / 2;
    const wanted: number[] = [];
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const tile = r * cols + c;
        const slot = this.slotByTile[tile];
        if (slot > 0) {
          this.lastUsed[slot - 1] = this.frame;
        } else if (!this.pending.has(tile) && !this.failed.has(tile)) {
          wanted.push(tile);
        }
      }
    }
    // Never ask for more tiles than the pool can hold at once.
    wanted.sort(
      (a, b) =>
        Math.hypot((a % cols) - cx, Math.floor(a / cols) - cy) -
        Math.hypot((b % cols) - cx, Math.floor(b / cols) - cy),
    );
    for (const tile of wanted) {
      if (this.pending.size >= MAX_PENDING_FETCHES) break;
      this.request(tile);
    }
    this.flush();
  }

  private request(tile: number): void {
    const { cols } = this.source.index;
    this.pending.add(tile);
    this.source
      .fetchTile(tile % cols, Math.floor(tile / cols))
      .then((bitmap) => {
        this.pending.delete(tile);
        if (this.disposed) {
          bitmap.close();
          return;
        }
        const slot = this.freeSlot();
        const previous = this.tileBySlot[slot];
        if (previous >= 0) this.slotByTile[previous] = 0;
        this.sink.uploadDetailTile(slot, bitmap);
        bitmap.close();
        this.tileBySlot[slot] = tile;
        this.slotByTile[tile] = slot + 1;
        this.lastUsed[slot] = this.frame;
        this.dirty = true;
      })
      .catch(() => {
        this.pending.delete(tile);
        this.failed.add(tile);
      });
  }

  private freeSlot(): number {
    let best = 0;
    for (let slot = 0; slot < this.slots; slot++) {
      if (this.tileBySlot[slot] < 0) return slot;
      if (this.lastUsed[slot] < this.lastUsed[best]) best = slot;
    }
    return best;
  }

  private flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.sink.setDetailSlots(this.slotByTile);
  }

  /** Tiles currently resident (for tests and diagnostics). */
  residentTiles(): number[] {
    return [...this.tileBySlot].filter((tile) => tile >= 0);
  }

  dispose(): void {
    this.disposed = true;
  }
}
