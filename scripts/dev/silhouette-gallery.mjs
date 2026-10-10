#!/usr/bin/env node
// Writes a standalone WebGL2 page that draws the procedural unit shaders
// (ships and aircraft) on a grid of headings, states and zoom levels, so the
// silhouettes can be inspected in a browser without running a match.
//
//   node scripts/dev/silhouette-gallery.mjs [out.html]
//
// The page inlines the shader sources with the same #define injection the
// UnitPass uses, and feeds the same 16-byte instance layout.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const shaderDir = path.join(root, "src/client/render/gl/shaders/unit");
const out =
  process.argv[2] ??
  path.join(
    root,
    "evidence/gauntlet/fleet-menu-publish/silhouette-gallery.html",
  );

const passSrc = fs.readFileSync(
  path.join(root, "src/client/render/gl/passes/UnitPass.ts"),
  "utf8",
);
const constant = (name) =>
  Number(passSrc.match(new RegExp(`export const ${name} = ([0-9.]+);`))[1]);
const defines = (src, defs) =>
  src.replace(
    "#version 300 es",
    `#version 300 es\n${Object.entries(defs)
      .map(([k, v]) => `#define ${k} ${v}`)
      .join("\n")}`,
  );

const shipVert = defines(
  fs.readFileSync(path.join(shaderDir, "ship.vert.glsl"), "utf8"),
  { SHIP_SCALE: constant("SHIP_SILHOUETTE_SCALE") },
);
const shipFrag = defines(
  fs.readFileSync(path.join(shaderDir, "ship.frag.glsl"), "utf8"),
  { PALETTE_SIZE: 4096, WARSHIP_EFFECT_ROW_BASE: 24 },
);
const airVert = defines(
  fs.readFileSync(path.join(shaderDir, "aircraft.vert.glsl"), "utf8"),
  { AIRCRAFT_SCALE: constant("AIRCRAFT_SILHOUETTE_SCALE") },
);
const airFrag = defines(
  fs.readFileSync(path.join(shaderDir, "aircraft.frag.glsl"), "utf8"),
  { PALETTE_SIZE: 4096 },
);

const html = `<!doctype html>
<meta charset="utf-8">
<title>Silhouette gallery</title>
<style>
  body { margin: 0; background: #17324a; color: #dfe8f0; font: 12px system-ui, sans-serif; }
  canvas { display: block; }
  #log { position: fixed; left: 8px; bottom: 8px; white-space: pre; background: rgba(0,0,0,.5); padding: 4px 8px; }
</style>
<canvas id="c" width="1280" height="900"></canvas>
<div id="log"></div>
<script id="ship-vert" type="x-shader">${shipVert}</script>
<script id="ship-frag" type="x-shader">${shipFrag}</script>
<script id="air-vert" type="x-shader">${airVert}</script>
<script id="air-frag" type="x-shader">${airFrag}</script>
<script>
const log = (m) => (document.getElementById("log").textContent += m + "\\n");
const canvas = document.getElementById("c");
const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
if (!gl) log("no webgl2");
const src = (id) => document.getElementById(id).textContent;
function compile(type, s) {
  const sh = gl.createShader(type); gl.shaderSource(sh, s); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { log(gl.getShaderInfoLog(sh)); throw new Error("compile"); }
  return sh;
}
function program(v, f) {
  const p = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, v)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, f)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { log(gl.getProgramInfoLog(p)); throw new Error("link"); }
  return p;
}
const shipProg = program(src("ship-vert"), src("ship-frag"));
const airProg = program(src("air-vert"), src("air-frag"));
// Palette: row 0 territory colour, row 1 border colour, indexed by owner id.
const owners = [[0.2,0.55,0.95],[0.9,0.3,0.25],[0.25,0.75,0.35],[0.95,0.75,0.2],[0.7,0.35,0.85]];
const pal = new Uint8Array(4096 * 2 * 4);
owners.forEach((c, i) => {
  for (let k = 0; k < 3; k++) { pal[(i)*4+k] = c[k]*255; pal[(4096+i)*4+k] = c[k]*0.55*255; }
  pal[i*4+3] = 255; pal[(4096+i)*4+3] = 255;
});
function tex(unit, w, h, data, float) {
  const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, float ? gl.RGBA32F : gl.RGBA, w, h, 0, gl.RGBA, float ? gl.FLOAT : gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
tex(0, 4096, 2, pal, false);
const aff = new Uint8Array(256 * 2 * 4); for (let i = 0; i < 256; i++) { aff[(256+i)*4] = 255; aff[(256+i)*4+1] = 60; aff[(256+i)*4+3] = 255; }
tex(2, 256, 2, aff, false);
tex(3, 256, 32, new Float32Array(256 * 32 * 4), true);

const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0,1,0,0,1,1,0,1,1,0,1]), gl.STATIC_DRAW);
function vao(instBuf) {
  const v = gl.createVertexArray(); gl.bindVertexArray(v);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, false, 16, 12); gl.vertexAttribDivisor(2, 1);
  gl.bindVertexArray(null); return v;
}
// Instances: {x, y, owner, atlas, flags, hash, heading}
function pack(list) {
  const buf = new ArrayBuffer(16 * list.length); const f = new Float32Array(buf); const b = new Uint8Array(buf);
  list.forEach((it, i) => { f[i*4] = it.x; f[i*4+1] = it.y; f[i*4+2] = it.owner; b[i*16+12] = it.atlas ?? 0; b[i*16+13] = it.flags; b[i*16+14] = it.hash ?? (i * 37) & 255; b[i*16+15] = it.heading; });
  return buf;
}
const params = new URLSearchParams(location.search);
const mode = params.get("mode") ?? "ships";
const altView = params.get("alt") === "1";
const view = params.get("view") ?? "grid";
if (view === "closeup") { canvas.width = 800; canvas.height = 560; }
// Layout in world tiles. Each block is drawn at its own pixels-per-tile scale.
const blocks = [];
const ships = [];
if (mode === "ships" && view === "closeup") {
  // One hull per column at 14 px/tile: under way (top) and a second state (bottom).
  const top = [
    { x: 9, y: 9, owner: 0, flags: 0x40 | (2 << 4), heading: 40, hash: 11 },
    { x: 28, y: 9, owner: 1, flags: 0x40 | (1 << 4), heading: 220, hash: 23 },
    { x: 47, y: 9, owner: 2, flags: 0x40 | (0 << 4), heading: 100, hash: 35 },
  ];
  const bottom = [
    { x: 9, y: 29, owner: 3, flags: 2 | 0x40 | (2 << 4), heading: 128, hash: 41 }, // angry warship
    { x: 28, y: 29, owner: 4, flags: 0 | (1 << 4), heading: 0, hash: 53 },          // docked trade ship
    { x: 47, y: 29, owner: 0, flags: 4 | 0x40 | (0 << 4), heading: 300, hash: 67 }, // retreating transport
  ];
  ships.push(...top, ...bottom);
  blocks.push({ list: ships, scale: 14.0, ox: 0, oy: 0, prog: shipProg });
} else if (mode === "ships") {
  const hulls = [[2, "warship"], [1, "trade"], [0, "transport"]];
  const states = [[0x40, "under way"], [0, "docked"], [2 | 0x40, "angry"], [4 | 0x40, "retreating"]];
  let y = 14;
  for (const [hull, name] of hulls) {
    let x = 14;
    for (const [state, sname] of states) {
      for (let k = 0; k < 4; k++) {
        ships.push({ x, y, owner: k % owners.length, flags: state | (hull << 4), heading: k * 32 + 16, hash: (x * 7 + y * 3) & 255 });
        x += 26;
      }
      x += 8;
    }
    y += 30;
  }
  blocks.push({ list: ships, scale: 3.0, ox: 0, oy: 0, prog: shipProg });
  // Strategic zoom strip: the same fleet at 1 px/tile and 1.5 px/tile.
  blocks.push({ list: ships, scale: 1.0, ox: 0, oy: 300, prog: shipProg });
  blocks.push({ list: ships, scale: 1.6, ox: 0, oy: 420, prog: shipProg });
  // Close-up: warship, trade ship, transport at 9 px/tile.
  blocks.push({ list: [
    { x: 16, y: 16, owner: 0, flags: 0x40 | (2 << 4), heading: 40, hash: 11 },
    { x: 60, y: 16, owner: 1, flags: 0x40 | (1 << 4), heading: 220, hash: 23 },
    { x: 104, y: 16, owner: 2, flags: 0x40 | (0 << 4), heading: 100, hash: 35 },
  ], scale: 9.0, ox: 0, oy: 590, prog: shipProg });
} else {
  let y = 14;
  for (let model = 0; model < 8; model++) {
    let x = 14;
    for (let k = 0; k < 8; k++) { ships.push({ x, y, owner: k % owners.length, flags: (model << 4), heading: k * 32, atlas: 12 }); x += 34; }
    y += 30;
  }
  blocks.push({ list: ships, scale: 2.4, ox: 0, oy: 0, prog: airProg });
  blocks.push({ list: ships, scale: 1.0, ox: 700, oy: 0, prog: airProg });
  // Close-up row: every model at 6 px/tile, heading north-east.
  const closeups = [];
  for (let model = 0; model < 8; model++) {
    closeups.push({ x: 12 + model * 26, y: 12, owner: model % owners.length, flags: (model << 4), heading: 32, atlas: 12 });
  }
  blocks.push({ list: closeups, scale: 6.0, ox: 0, oy: 560, prog: airProg });
}
gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
gl.clearColor(0.09, 0.2, 0.29, 1); gl.clear(gl.COLOR_BUFFER_BIT);
const start = performance.now();
function draw() {
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT);
  for (const blk of blocks) {
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, pack(blk.list), gl.STATIC_DRAW);
    const v = vao(buf);
    const W = canvas.width, H = canvas.height, s = blk.scale;
    // world → clip: x_px = ox + x*s; clip = x_px/W*2-1; y flipped.
    const cam = new Float32Array([2*s/W, 0, 0,  0, -2*s/H, 0,  (2*blk.ox/W) - 1, 1 - (2*blk.oy/H), 1]);
    gl.useProgram(blk.prog);
    gl.uniformMatrix3fv(gl.getUniformLocation(blk.prog, "uCamera"), false, cam);
    gl.uniform1f(gl.getUniformLocation(blk.prog, "uUnitSize"), 13);
    gl.uniform1f(gl.getUniformLocation(blk.prog, "uTime"), (performance.now() - start) / 1000);
    gl.uniform1i(gl.getUniformLocation(blk.prog, "uAltView"), altView ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(blk.prog, "uPalette"), 0);
    gl.uniform1i(gl.getUniformLocation(blk.prog, "uAffiliation"), 2);
    const eff = gl.getUniformLocation(blk.prog, "uEffect"); if (eff) gl.uniform1i(eff, 3);
    const angry = gl.getUniformLocation(blk.prog, "uAngryColor"); if (angry) gl.uniform3f(angry, 0.784, 0, 0);
    gl.bindVertexArray(v);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, blk.list.length);
    gl.bindVertexArray(null); gl.deleteVertexArray(v); gl.deleteBuffer(buf);
  }
  requestAnimationFrame(draw);
}
draw();
log("mode=" + mode + " alt=" + altView + " instances=" + ships.length);
</script>
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`wrote ${path.relative(root, out)}`);
