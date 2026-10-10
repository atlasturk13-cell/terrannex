// Writes neutral placeholder files for the Terrannex-owned artwork that is not
// part of this public repository (see TERRANNEX_ASSETS.md). The game builds and
// runs with them; replace them with your own art. Existing files are kept.
//
//   node scripts/placeholder-assets.mjs
import fs from "fs";
import path from "path";
import zlib from "zlib";

const root = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);

function svg(label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${label} placeholder">
  <rect x="4" y="4" width="56" height="56" rx="10" fill="#334155" stroke="#94a3b8" stroke-width="3" stroke-dasharray="6 4"/>
  <text x="32" y="40" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#e2e8f0">?</text>
</svg>
`;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** Solid-colour RGBA PNG. */
function png(width, height, [r, g, b, a]) {
  const row = Buffer.alloc(1 + width * 4);
  for (let x = 0; x < width; x++) row.set([r, g, b, a], 1 + x * 4);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const slate = [51, 65, 85, 255];
const files = {
  "resources/local/territory-lab-mark.svg": svg("Brand mark"),
  "resources/local/icon-192.png": png(192, 192, slate),
  "resources/local/icon-512.png": png(512, 512, slate),
  "resources/local/icon-maskable-512.png": png(512, 512, slate),
  "resources/local/apple-touch-icon.png": png(180, 180, slate),
  "resources/local/social-card.png": png(1200, 630, slate),
  "resources/images/LocalSetupSatelliteBackground.png": png(
    1672,
    941,
    [15, 23, 42, 255],
  ),
  "resources/sprites/fighterJet.png": png(13, 13, [226, 232, 240, 255]),
  "resources/images/AirportIconWhite.svg": svg("Airport"),
  "resources/images/BarracksIconWhite.svg": svg("Barracks"),
};
for (const name of [
  "airport",
  "barracks",
  "city",
  "defense-post",
  "factory",
  "missile-silo",
  "port",
  "sam-launcher",
]) {
  files[`resources/images/structures/${name}.svg`] = svg(name);
}
for (const name of [
  "a10",
  "b2",
  "b52",
  "f16",
  "f22",
  "f35",
  "kaan",
  "typhoon",
]) {
  files[`resources/images/aircraft/${name}.svg`] = svg(name);
}

let written = 0;
for (const [rel, content] of Object.entries(files)) {
  const file = path.join(root, rel);
  if (fs.existsSync(file)) continue;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  written++;
}
console.log(`placeholder assets written: ${written}`);
