#version 300 es
precision highp float;
precision highp usampler2D;

uniform usampler2D uTileTex;
uniform sampler2D uPalette;
uniform sampler2D uBorderTex;     // RGBA8 — border flags from BorderComputePass
uniform sampler2D uDefenseCoverageTex; // R8 — 1.0 = defended by same-owner post
uniform sampler2D uAffiliation;   // 256×2 RGBA8 — affiliation colors (row 0 = border)
uniform vec2 uMapSize;
uniform int uAltView;
uniform float uHighlightBrighten;
uniform float uDefenseCheckerDarken;
uniform float uEmbargoTintRatio;
uniform float uFriendlyTintRatio;
uniform vec3 uEmbargoTint;
uniform vec3 uFriendlyTint;

in vec2 vWorldPos;
out vec4 fragColor;

uniform float uBorderWidthPx;     // smooth mode: line width per side in device pixels

// --- Smooth ownership edges ---------------------------------------------
// The four nearest tile centres vote with bilinear weights; the owner with
// the most weight is drawn here. `margin` is the winner's lead over the
// runner-up: 1 deep inside a territory, 0 exactly on an edge, so edges fall
// halfway between tile centres and corners round off. Tile-exact when off.
uniform int uSmoothEdges;
uniform float uZoom;              // device pixels per map tile

uint ownerAt(ivec2 c) {
  c = clamp(c, ivec2(0), ivec2(uMapSize) - ivec2(1));
  return texelFetch(uTileTex, c, 0).r & uint(OWNER_MASK);
}

void visualOwner(vec2 p, uint tileOwner, out uint owner, out float margin) {
  if (uSmoothEdges == 0) {
    owner = tileOwner;
    margin = 1.0;
    return;
  }
  vec2 s = p - 0.5;
  ivec2 c = ivec2(floor(s));
  vec2 f = fract(s);
  uint o0 = ownerAt(c);
  uint o1 = ownerAt(c + ivec2(1, 0));
  uint o2 = ownerAt(c + ivec2(0, 1));
  uint o3 = ownerAt(c + ivec2(1, 1));
  float w0 = (1.0 - f.x) * (1.0 - f.y);
  float w1 = f.x * (1.0 - f.y);
  float w2 = (1.0 - f.x) * f.y;
  float w3 = f.x * f.y;
  float s0 = w0 + (o1 == o0 ? w1 : 0.0) + (o2 == o0 ? w2 : 0.0) + (o3 == o0 ? w3 : 0.0);
  float s1 = w1 + (o0 == o1 ? w0 : 0.0) + (o2 == o1 ? w2 : 0.0) + (o3 == o1 ? w3 : 0.0);
  float s2 = w2 + (o0 == o2 ? w0 : 0.0) + (o1 == o2 ? w1 : 0.0) + (o3 == o2 ? w3 : 0.0);
  float s3 = w3 + (o0 == o3 ? w0 : 0.0) + (o1 == o3 ? w1 : 0.0) + (o2 == o3 ? w2 : 0.0);
  owner = o0;
  float best = s0;
  if (s1 > best) { best = s1; owner = o1; }
  if (s2 > best) { best = s2; owner = o2; }
  if (s3 > best) { best = s3; owner = o3; }
  float second = 0.0;
  if (o0 != owner) second = max(second, s0);
  if (o1 != owner) second = max(second, s1);
  if (o2 != owner) second = max(second, s2);
  if (o3 != owner) second = max(second, s3);
  margin = best - second;
}

void main() {
  ivec2 tc = ivec2(floor(vWorldPos));
  if (tc.x < 0 || tc.y < 0 || tc.x >= int(uMapSize.x) || tc.y >= int(uMapSize.y)) discard;

  uint raw = texelFetch(uTileTex, tc, 0).r;
  uint tileOwner = raw & uint(OWNER_MASK);
  uint owner;
  float margin;
  visualOwner(vWorldPos, tileOwner, owner, margin);

  // Read pre-computed border flags from BorderComputePass
  vec4 borderData = texelFetch(uBorderTex, tc, 0);
  float borderType = borderData.r;      // 0=interior, ~0.5=normal, ~1.0=highlight
  bool defense = texelFetch(uDefenseCoverageTex, tc, 0).r > 0.5; // same-owner defense post nearby
  float relation = borderData.a;        // 0.0=neutral, ~0.5=friendly, ~1.0=embargo

  bool isBorder = borderType > 0.25;
  bool isHighlightBorder = borderType > 0.75;

  // Smooth mode: a line of constant pixel width hugging the rounded edge.
  // `margin` grows 2 per tile away from an edge, so a line `w` tiles wide on
  // this side is margin < 2w; a hovered owner's line is thicker.
  float coverage = 1.0;
  if (uSmoothEdges == 1) {
    if (owner == 0u) discard;
    float sideTiles = clamp(uBorderWidthPx / max(uZoom, 0.05), 0.1, 0.5);
    if (isHighlightBorder) sideTiles = min(0.5, sideTiles * 2.5);
    float threshold = 2.0 * sideTiles;
    float aa = clamp(2.0 / max(uZoom, 0.05), 0.02, 0.3);
    coverage = 1.0 - smoothstep(threshold - aa, threshold + aa, margin);
    if (coverage <= 0.002) discard;
    isBorder = true;
  }

  // --- Border stamp: full-brightness border color ---
  if (isBorder && owner != 0u) {
    vec3 bc;
    if (uAltView != 0) {
      // Alt-view: pure affiliation color from palette row 0
      bc = texelFetch(uAffiliation, ivec2(int(owner), 0), 0).rgb;
    } else {
      float u = (float(owner) + 0.5) / float(PALETTE_SIZE);
      bc = texture(uPalette, vec2(u, 0.75)).rgb;
      if (isHighlightBorder) {
        bc = mix(bc, vec3(1.0), uHighlightBrighten);
      }
      // Relationship tint (applied BEFORE defense checkerboard, matching game)
      if (relation > 0.75) {
        bc = mix(bc, uEmbargoTint, uEmbargoTintRatio);
      } else if (relation > 0.25) {
        bc = mix(bc, uFriendlyTint, uFriendlyTintRatio);
      }
      // Defense bonus: checkerboard darken (applied AFTER tint, matching game)
      if (defense) {
        bool checker = ((tc.x + tc.y) & 1) == 1;
        if (checker) bc *= uDefenseCheckerDarken;
      }
    }
    fragColor = vec4(bc, coverage);
    return;
  }

  discard;
}
