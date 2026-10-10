/**
 * TerrainPass — renders the terrain map as a textured quad.
 *
 * Initial upload happens once; incremental updates flow through
 * applyTerrainRects() so water-nuke conversions (land → water) are reflected
 * live. Vertex shader transforms the map quad by the camera mat3; fragment
 * shader bilinearly samples the RGBA8 terrain texture and applies restrained
 * directional relief. Territory ownership and borders remain separate passes,
 * so their tactical edges stay crisp.
 */

import type { TerrainRect } from "../../types";
import {
  SATELLITE_DETAIL_SLOTS,
  satelliteDetailMix,
  type DetailTileSink,
  type SatelliteIndex,
} from "../SatelliteTerrain";
import terrainFragSrc from "../shaders/terrain/terrain.frag.glsl?raw";
import terrainVertSrc from "../shaders/terrain/terrain.vert.glsl?raw";
import {
  buildTerrainRGBA,
  encodeTerrainTile,
  TerrainColorOverrides,
} from "../utils/ColorUtils";
import {
  createMapQuad,
  createProgram,
  createTexture2D,
  shaderSrc,
} from "../utils/GlUtils";

/**
 * Pack the raw terrain byte into the otherwise-unused texture alpha channel.
 *
 * The colour channels stay linearly filtered for a smooth map, while the
 * shader reads alpha with texelFetch so land, coast, depth, and elevation keep
 * their exact categorical meaning. This avoids allocating a second map-sized
 * GPU texture solely for visual metadata.
 */
export function buildTerrainVisualRGBA(
  terrainBytes: Uint8Array,
  mapW: number,
  mapH: number,
  terrainColors?: TerrainColorOverrides,
): Uint8Array {
  const rgba = buildTerrainRGBA(terrainBytes, mapW, mapH, terrainColors);
  for (let i = 0; i < terrainBytes.length; i++) {
    rgba[i * 4 + 3] = terrainBytes[i];
  }
  return rgba;
}

function encodeTerrainVisualTile(
  terrainByte: number,
  out: Uint8Array,
  offset: number,
  terrainColors?: TerrainColorOverrides,
): void {
  encodeTerrainTile(terrainByte, out, offset, terrainColors);
  out[offset + 3] = terrainByte;
}

// ---------------------------------------------------------------------------
// TerrainPass
// ---------------------------------------------------------------------------

export class TerrainPass implements DetailTileSink {
  private program: WebGLProgram;
  private tex: WebGLTexture;
  private vao: WebGLVertexArrayObject;
  private uCamera: WebGLUniformLocation;
  private mapW: number;
  private mapH: number;
  // Base ocean (deep water) color; reused by applyTerrainRects and rebuilds.
  private terrainColors: TerrainColorOverrides | undefined;
  // Scratch RGBA buffer for rect sub-uploads; grown as needed and reused
  // across applyTerrainRects calls.
  private rgbaScratch = new Uint8Array(0);

  // --- Satellite imagery (optional; Natural Earth maps) ---
  private initialLandTex: WebGLTexture;
  private satOverviewTex: WebGLTexture | null = null;
  private satDetailTex: WebGLTexture | null = null;
  private satLookupTex: WebGLTexture | null = null;
  private satIndex: SatelliteIndex | null = null;
  private satEnabled = true;
  private uSatEnabled: WebGLUniformLocation | null;
  private uSatDetailMix: WebGLUniformLocation | null;
  private uSatGrid: WebGLUniformLocation | null;
  private uSatTileUV: WebGLUniformLocation | null;

  constructor(
    private gl: WebGL2RenderingContext,
    // Regenerates current per-tile terrain bytes (reflecting water-nuke
    // conversions) for the rare full re-bake in setTerrainColors. A provider
    // instead of a retained buffer: terrain bytes are map-sized (8 MB on the
    // giant map).
    private terrainSource: () => Uint8Array,
    terrainBytes: Uint8Array,
    mapW: number,
    mapH: number,
    terrainColors?: TerrainColorOverrides,
  ) {
    this.mapW = mapW;
    this.mapH = mapH;
    this.terrainColors = terrainColors;
    this.program = createProgram(
      gl,
      shaderSrc(terrainVertSrc, { MAP_W: mapW, MAP_H: mapH }),
      shaderSrc(terrainFragSrc, { MAP_W: mapW, MAP_H: mapH }),
    );
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;

    this.tex = createTexture2D(gl, {
      width: mapW,
      height: mapH,
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      data: buildTerrainVisualRGBA(terrainBytes, mapW, mapH, terrainColors),
      // Terrain is visual context rather than authoritative hit geometry.
      // Bilinear sampling removes the checkerboard/pixel-art presentation;
      // ownership borders are still drawn sharply by BorderStampPass.
      filter: gl.LINEAR,
    });

    // Land bit of the terrain the satellite pictures were conformed to. A
    // tile whose land bit later changes (a water nuke) falls back to the
    // procedural look so the picture never contradicts the map.
    const initialLand = new Uint8Array(terrainBytes.length);
    for (let i = 0; i < terrainBytes.length; i++) {
      initialLand[i] = terrainBytes[i] & 0x80 ? 1 : 0;
    }
    this.initialLandTex = createTexture2D(gl, {
      width: mapW,
      height: mapH,
      internalFormat: gl.R8UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_BYTE,
      data: initialLand,
      filter: gl.NEAREST,
    });

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTerrain"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uSatOverview"), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "uSatDetail"), 2);
    gl.uniform1i(gl.getUniformLocation(this.program, "uSatLookup"), 3);
    gl.uniform1i(gl.getUniformLocation(this.program, "uInitialLand"), 4);
    this.uSatEnabled = gl.getUniformLocation(this.program, "uSatEnabled");
    this.uSatDetailMix = gl.getUniformLocation(this.program, "uSatDetailMix");
    this.uSatGrid = gl.getUniformLocation(this.program, "uSatGrid");
    this.uSatTileUV = gl.getUniformLocation(this.program, "uSatTileUV");

    this.vao = createMapQuad(gl, mapW, mapH);
  }

  /**
   * Install a map's satellite imagery: the overview (mipmapped, always
   * resident), an empty detail-tile array and its per-tile slot lookup.
   */
  setSatellite(index: SatelliteIndex, overview: ImageBitmap): void {
    this.disposeSatellite();
    const gl = this.gl;
    this.satIndex = index;

    this.satOverviewTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.satOverviewTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      overview,
    );
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Detail tiles are only shown magnified (never minified), so they need
    // no mipmaps: one level per slot.
    this.satDetailTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.satDetailTex);
    gl.texStorage3D(
      gl.TEXTURE_2D_ARRAY,
      1,
      gl.RGBA8,
      index.tileSize,
      index.tileSize,
      SATELLITE_DETAIL_SLOTS,
    );
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.satLookupTex = createTexture2D(gl, {
      width: index.cols,
      height: index.rows,
      internalFormat: gl.R8UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_BYTE,
      data: new Uint8Array(index.cols * index.rows),
      filter: gl.NEAREST,
    });
  }

  uploadDetailTile(slot: number, bitmap: ImageBitmap): void {
    if (this.satDetailTex === null || this.satIndex === null) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.satDetailTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      slot,
      this.satIndex.tileSize,
      this.satIndex.tileSize,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      bitmap,
    );
  }

  setDetailSlots(slotByTile: Uint8Array): void {
    if (this.satLookupTex === null || this.satIndex === null) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.satLookupTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.satIndex.cols,
      this.satIndex.rows,
      gl.RED_INTEGER,
      gl.UNSIGNED_BYTE,
      slotByTile,
    );
  }

  /** The Satellite / Classic map style switch. */
  setSatelliteEnabled(enabled: boolean): void {
    this.satEnabled = enabled;
  }

  hasSatellite(): boolean {
    return this.satIndex !== null;
  }

  satelliteActive(): boolean {
    return this.satEnabled && this.satIndex !== null;
  }

  private disposeSatellite(): void {
    const gl = this.gl;
    if (this.satOverviewTex) gl.deleteTexture(this.satOverviewTex);
    if (this.satDetailTex) gl.deleteTexture(this.satDetailTex);
    if (this.satLookupTex) gl.deleteTexture(this.satLookupTex);
    this.satOverviewTex = this.satDetailTex = this.satLookupTex = null;
    this.satIndex = null;
  }

  /**
   * Replace the base terrain colors and re-upload the whole terrain texture.
   * Called when the user changes the terrain colors in graphics settings.
   */
  setTerrainColors(terrainColors?: TerrainColorOverrides): void {
    this.terrainColors = terrainColors;
    const gl = this.gl;
    const terrainBytes = this.terrainSource();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.mapW,
      this.mapH,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      buildTerrainVisualRGBA(terrainBytes, this.mapW, this.mapH, terrainColors),
    );
  }

  /**
   * Update terrain regions in-place (e.g. land→water from a water nuke).
   * Each rect's terrain bytes are stored row-major, concatenated in `bytes`
   * in rect order. One texSubImage2D per rect — a massive bomb changes tens
   * of thousands of tiles, so per-tile 1×1 uploads are too slow. A later full
   * re-upload (setTerrainColors) regenerates from terrainSource, whose
   * backing game map already reflects these conversions.
   */
  applyTerrainRects(rects: readonly TerrainRect[], bytes: Uint8Array): void {
    if (rects.length === 0) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    let offset = 0;
    for (const r of rects) {
      const count = r.w * r.h;
      if (this.rgbaScratch.length < count * 4) {
        this.rgbaScratch = new Uint8Array(count * 4);
      }
      for (let i = 0; i < count; i++) {
        encodeTerrainVisualTile(
          bytes[offset + i],
          this.rgbaScratch,
          i * 4,
          this.terrainColors,
        );
      }
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        r.x,
        r.y,
        r.w,
        r.h,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.rgbaScratch,
        0,
      );
      offset += count;
    }
  }

  /** Render the terrain. Call with depth test disabled, no blending. */
  draw(cameraMatrix: Float32Array, zoom = 1): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);

    const satellite = this.satelliteActive();
    gl.uniform1i(this.uSatEnabled, satellite ? 1 : 0);
    if (satellite && this.satIndex !== null) {
      const index = this.satIndex;
      gl.uniform1f(this.uSatDetailMix, satelliteDetailMix(zoom));
      gl.uniform2f(this.uSatGrid, index.cols, index.rows);
      gl.uniform2f(
        this.uSatTileUV,
        index.tileSize / index.width,
        index.tileSize / index.height,
      );
    }
    // Bind every sampler unit on every draw (null when absent) so another
    // pass's texture of a different type can never sit under our samplers.
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.satOverviewTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.satDetailTex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.satLookupTex);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.initialLandTex);
    gl.activeTexture(gl.TEXTURE0);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteTexture(this.tex);
    gl.deleteTexture(this.initialLandTex);
    this.disposeSatellite();
    // VAO + buffer leak is acceptable on dispose (context is being destroyed)
  }
}
