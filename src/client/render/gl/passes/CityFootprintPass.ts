/**
 * CityFootprintPass — paints each city's urban footprint on the map.
 *
 * A city is not a single tile (see core/game/CityFootprint): its built-up
 * area is a disc around the structure whose radius grows with the city's
 * level. This pass draws that disc as a procedural pattern of building
 * blocks and streets, restricted to land tiles and skipping fallout, so a
 * partially bombed city visibly loses the districts that were hit.
 *
 * One instanced draw call: a quad per city, pattern generated in the
 * fragment shader from world coordinates (so it is stable under pan/zoom
 * and needs no texture).
 */

import { cityFootprintRadius } from "../../../../core/game/CityFootprint";
import type { UnitState } from "../../types";
import { UT_CITY } from "../../types";
import { DynamicInstanceBuffer } from "../DynamicBuffer";
import type { RenderSettings } from "../RenderSettings";
import { getPaletteSize } from "../utils/ColorUtils";
import { createProgram, shaderSrc } from "../utils/GlUtils";
import { TILE_DEFINES } from "../utils/TileCodec";

import fragSrc from "../shaders/city-footprint/city-footprint.frag.glsl?raw";
import vertSrc from "../shaders/city-footprint/city-footprint.vert.glsl?raw";

// Per-instance: x, y, radius, ownerID
const FLOATS_PER_INSTANCE = 4;
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;

export class CityFootprintPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private instanceBuf: DynamicInstanceBuffer;
  private instanceCount = 0;
  private mapW: number;

  private paletteTex: WebGLTexture;
  private terrainBytesTex: WebGLTexture;
  private tileTex: WebGLTexture;

  private uCamera: WebGLUniformLocation;
  private uZoom: WebGLUniformLocation;
  private uAlpha: WebGLUniformLocation;
  private uBlockSize: WebGLUniformLocation;
  private uPatternZoomStart: WebGLUniformLocation;
  private uPatternZoomEnd: WebGLUniformLocation;
  private uOwnerTint: WebGLUniformLocation;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    paletteTex: WebGLTexture,
    terrainBytesTex: WebGLTexture,
    tileTex: WebGLTexture,
    settings: RenderSettings,
  ) {
    this.gl = gl;
    this.mapW = mapW;
    this.settings = settings;
    this.paletteTex = paletteTex;
    this.terrainBytesTex = terrainBytesTex;
    this.tileTex = tileTex;

    this.program = createProgram(
      gl,
      vertSrc,
      shaderSrc(fragSrc, {
        PALETTE_SIZE: getPaletteSize(),
        FALLOUT_BIT: TILE_DEFINES.FALLOUT_BIT,
      }),
    );
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uZoom = gl.getUniformLocation(this.program, "uZoom")!;
    this.uAlpha = gl.getUniformLocation(this.program, "uAlpha")!;
    this.uBlockSize = gl.getUniformLocation(this.program, "uBlockSize")!;
    this.uPatternZoomStart = gl.getUniformLocation(
      this.program,
      "uPatternZoomStart",
    )!;
    this.uPatternZoomEnd = gl.getUniformLocation(
      this.program,
      "uPatternZoomEnd",
    )!;
    this.uOwnerTint = gl.getUniformLocation(this.program, "uOwnerTint")!;

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPalette"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTerrainBytes"), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTileTex"), 2);

    // --- VAO ---
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const instanceGlBuf = gl.createBuffer()!;
    this.instanceBuf = new DynamicInstanceBuffer(
      gl,
      instanceGlBuf,
      256,
      FLOATS_PER_INSTANCE,
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.bindVertexArray(null);
  }

  /** Rebuild the instance list from the current structure set. */
  updateCities(units: Map<number, UnitState>): void {
    let count = 0;
    for (const unit of units.values()) {
      if (!unit.isActive || unit.unitType !== UT_CITY) continue;
      if (unit.underConstruction) continue;
      this.instanceBuf.ensureCapacity(count + 1);
      const off = count * FLOATS_PER_INSTANCE;
      const x = unit.pos % this.mapW;
      const y = (unit.pos - x) / this.mapW;
      this.instanceBuf.float32[off + 0] = x;
      this.instanceBuf.float32[off + 1] = y;
      this.instanceBuf.float32[off + 2] = cityFootprintRadius(unit.level);
      this.instanceBuf.float32[off + 3] = unit.ownerID;
      count++;
    }
    this.instanceCount = count;
    if (count > 0) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.instanceBuf.float32,
        0,
        count * FLOATS_PER_INSTANCE,
      );
    }
  }

  draw(cameraMatrix: Float32Array, zoom: number): void {
    if (this.instanceCount === 0) return;
    const gl = this.gl;
    const s = this.settings.cityFootprint;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uZoom, zoom);
    gl.uniform1f(this.uAlpha, s.alpha);
    gl.uniform1f(this.uBlockSize, s.blockSize);
    gl.uniform1f(this.uPatternZoomStart, s.patternZoomStart);
    gl.uniform1f(this.uPatternZoomEnd, s.patternZoomEnd);
    gl.uniform1f(this.uOwnerTint, s.ownerTint);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.terrainBytesTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.tileTex);

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.instanceCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    this.instanceBuf.dispose();
    gl.deleteVertexArray(this.vao);
  }
}
