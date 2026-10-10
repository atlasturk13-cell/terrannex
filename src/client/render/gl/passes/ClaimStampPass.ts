/**
 * ClaimStampPass — GPU scatter writes of "captured at" stamps into an RGBA8
 * map-sized texture.
 *
 * The territory shader compares each tile's stamp with the current stamp and
 * fades a fresh capture from a hot flash into the settled owner colour, so a
 * conquest front reads as a living wave instead of a hard pixel flip. Only
 * changed tiles are written (one POINTS draw per frame); there is never a
 * per-frame full-map upload. The 24-bit stamp counts 4 ms units, so it wraps
 * after ~18.6 hours — far beyond any match — and stamp 0 is reserved for
 * "never captured" so a freshly created texture cannot flash.
 */

import { createProgram, createTexture2D } from "../utils/GlUtils";

import fragSrc from "../shaders/map-overlay/claim-stamp.frag.glsl?raw";
import vertSrc from "../shaders/map-overlay/claim-stamp.vert.glsl?raw";

export const CLAIM_STAMP_UNIT_MS = 4;
export const CLAIM_STAMP_MODULO = 1 << 24;

const FLOATS_PER_PATCH = 3;
const INITIAL_CAPACITY = 2048;

/** Encode elapsed renderer time into a non-zero 24-bit stamp. */
export function encodeClaimStamp(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 1;
  const units = Math.floor(elapsedMs / CLAIM_STAMP_UNIT_MS);
  return 1 + (units % (CLAIM_STAMP_MODULO - 1));
}

/**
 * Age of a tile stamp in stamp units relative to `nowStamp`, wrap-safe.
 * Returns Infinity for the reserved "never captured" stamp.
 */
export function claimStampAge(nowStamp: number, tileStamp: number): number {
  if (tileStamp <= 0) return Number.POSITIVE_INFINITY;
  const age = nowStamp - tileStamp;
  return age < 0 ? age + CLAIM_STAMP_MODULO : age;
}

export class ClaimStampPass {
  private gl: WebGL2RenderingContext;
  private mapW: number;
  private mapH: number;

  private program: WebGLProgram;
  private uMapSize: WebGLUniformLocation;

  readonly texture: WebGLTexture;
  private fbo: WebGLFramebuffer;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;

  private patchData: Float32Array;
  private patchCount = 0;
  private patchCapacity = INITIAL_CAPACITY;
  private gpuCapacityBytes = 0;

  constructor(gl: WebGL2RenderingContext, mapW: number, mapH: number) {
    this.gl = gl;
    this.mapW = mapW;
    this.mapH = mapH;

    this.texture = createTexture2D(gl, {
      width: mapW,
      height: mapH,
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      data: null,
      filter: gl.NEAREST,
    });

    this.program = createProgram(gl, vertSrc, fragSrc);
    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;

    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.texture,
      0,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.vbo = gl.createBuffer()!;
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const stride = FLOATS_PER_PATCH * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 8);
    gl.bindVertexArray(null);

    this.patchData = new Float32Array(INITIAL_CAPACITY * FLOATS_PER_PATCH);
  }

  /** Queue one capture stamp write. */
  push(x: number, y: number, stamp: number): void {
    if (this.patchCount >= this.patchCapacity) this.grow();
    const p = this.patchCount * FLOATS_PER_PATCH;
    this.patchData[p] = x;
    this.patchData[p + 1] = y;
    this.patchData[p + 2] = stamp;
    this.patchCount++;
  }

  get count(): number {
    return this.patchCount;
  }

  /** Drop pending writes without applying them. */
  clear(): void {
    this.patchCount = 0;
  }

  /** Forget every stamp (seek / full state replacement) — nothing may flash. */
  reset(): void {
    this.patchCount = 0;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Upload pending stamps and scatter them into the texture. */
  flush(): void {
    if (this.patchCount === 0) return;
    const gl = this.gl;

    const floats = this.patchCount * FLOATS_PER_PATCH;
    const byteCount = floats * 4;
    const view = this.patchData.subarray(0, floats);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    if (byteCount > this.gpuCapacityBytes) {
      gl.bufferData(gl.ARRAY_BUFFER, view, gl.STREAM_DRAW);
      this.gpuCapacityBytes = byteCount;
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, view);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.mapW, this.mapH);
    gl.disable(gl.BLEND);

    gl.useProgram(this.program);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.patchCount);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.patchCount = 0;
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteFramebuffer(this.fbo);
    gl.deleteBuffer(this.vbo);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.texture);
  }

  private grow(): void {
    const newCapacity = this.patchCapacity * 2;
    const newBuf = new Float32Array(newCapacity * FLOATS_PER_PATCH);
    newBuf.set(this.patchData);
    this.patchData = newBuf;
    this.patchCapacity = newCapacity;
  }
}
