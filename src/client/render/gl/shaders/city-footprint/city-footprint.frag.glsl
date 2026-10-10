#version 300 es
precision highp float;
precision highp usampler2D;

// Paints a city's urban footprint: a disc of building blocks and streets on
// the land tiles around the city structure. Density thins out toward the
// edge so the outskirts read as suburbs, and destroyed (fallout / water)
// tiles show nothing — a bombed district is visibly gone.

uniform sampler2D  uPalette;       // player colours, row 0.25 = territory fill
uniform usampler2D uTerrainBytes;  // R8UI, bit 7 = land
uniform usampler2D uTileTex;       // R16UI, bit FALLOUT_BIT = fallout
uniform float uZoom;
uniform float uAlpha;
uniform float uBlockSize;          // tiles per block (street to street)
uniform float uPatternZoomStart;   // below: flat urban blob
uniform float uPatternZoomEnd;     // above: full block pattern
uniform float uOwnerTint;          // how much the owner colour tints roofs

in vec2 vWorld;
flat in vec2 vCenter;
flat in float vRadius;
flat in float vOwnerID;

out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  ivec2 tc = ivec2(floor(vWorld));
  ivec2 size = textureSize(uTerrainBytes, 0);
  if (tc.x < 0 || tc.y < 0 || tc.x >= size.x || tc.y >= size.y) discard;

  uint terrain = texelFetch(uTerrainBytes, tc, 0).r;
  if ((terrain & 0x80u) == 0u) discard;                // water: no city here
  uint tile = texelFetch(uTileTex, tc, 0).r;
  if ((tile & (1u << FALLOUT_BIT)) != 0u) discard;     // bombed out

  float dist = length(vWorld - vCenter);
  if (dist > vRadius) discard;

  // Dense core, thinning suburbs. The jitter keeps the edge from being a
  // perfect circle.
  float edgeJitter = (hash21(floor(vWorld / uBlockSize)) - 0.5) * 0.35;
  float density = 1.0 - smoothstep(vRadius * 0.45, vRadius, dist + edgeJitter * vRadius);
  if (density <= 0.0) discard;

  float u = (vOwnerID + 0.5) / float(PALETTE_SIZE);
  vec3 ownerColor = texture(uPalette, vec2(u, 0.25)).rgb;

  // --- Block pattern ---
  vec2 cell = floor(vWorld / uBlockSize);
  vec2 inCell = fract(vWorld / uBlockSize);
  float h = hash21(cell);
  float h2 = hash21(cell + 17.0);

  // Streets along the low edges of every block; wider avenues every 4th.
  float streetW = 0.16;
  bool avenueX = mod(cell.x, 4.0) == 0.0;
  bool avenueY = mod(cell.y, 4.0) == 0.0;
  float sx = avenueX ? streetW * 1.7 : streetW;
  float sy = avenueY ? streetW * 1.7 : streetW;
  bool street = inCell.x < sx || inCell.y < sy;

  // A block only carries buildings where the local density allows; empty
  // lots show the ground through.
  bool builtLot = h < density * 0.97;

  vec3 asphalt = vec3(0.16, 0.17, 0.18);
  // Roof palette: concrete greys, warm terracotta, a little pale render.
  vec3 roofA = vec3(0.62, 0.60, 0.57);
  vec3 roofB = vec3(0.52, 0.50, 0.49);
  vec3 roofC = vec3(0.71, 0.48, 0.38);
  vec3 roofD = vec3(0.78, 0.76, 0.70);
  vec3 roof = h2 < 0.35 ? roofA : (h2 < 0.65 ? roofB : (h2 < 0.82 ? roofC : roofD));
  // Taller blocks in the core: darker rooftop plant / shadow side.
  float shade = 1.0 - 0.18 * step(0.8, inCell.x) - 0.18 * step(0.8, inCell.y);
  roof *= shade;
  roof = mix(roof, ownerColor, uOwnerTint);

  vec3 patternColor;
  float patternAlpha;
  if (street) {
    patternColor = asphalt;
    patternAlpha = 0.9;
  } else if (builtLot) {
    patternColor = roof;
    patternAlpha = 1.0;
  } else {
    patternColor = asphalt;
    patternAlpha = 0.0;
  }

  // --- Zoomed-out blob (the pattern would alias into noise) ---
  vec3 blobColor = mix(vec3(0.5, 0.49, 0.47), ownerColor, uOwnerTint);
  float blobAlpha = density * 0.8;

  float patternMix = smoothstep(uPatternZoomStart, uPatternZoomEnd, uZoom);
  vec3 color = mix(blobColor, patternColor, patternMix);
  float alpha = mix(blobAlpha, patternAlpha, patternMix) * uAlpha;
  if (alpha <= 0.002) discard;
  fragColor = vec4(color, alpha);
}
