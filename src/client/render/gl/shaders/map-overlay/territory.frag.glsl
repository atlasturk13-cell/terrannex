#version 300 es
precision highp float;
precision highp usampler2D;
precision highp sampler2DArray;

uniform usampler2D uTileTex;      // R16UI — tile state per cell
uniform sampler2D  uPalette;      // RGBA32F — player colors
uniform sampler2D  uPatternMeta;  // RGBA32F — 1D buffer, 1 px per owner. R=hasPattern, G=width, B=height, A=scale
uniform usampler2D uPatternData;  // R8UI    — 2D buffer, row per owner, bytes for bitmask
uniform sampler2DArray uSkinAtlas; // RGBA8 — per-skin PNG layer, tiled via REPEAT wrap
uniform usampler2D uSkinLayer;    // R8UI — 1D buffer, 1 px per owner. 0=no skin, otherwise layer+1
uniform usampler2D uSkinAnchor;   // RG16UI — 1D buffer, anchor tile (cx, cy) per owner. (0,0) = world origin
uniform int uShowPatterns;
uniform int uIsTeamMode;          // 1 = teams (tint skin by team color), 0 = FFA (raw skin colors)
const float SKIN_DIM = 1024.0;    // atlas cell size in tiles — must match SkinAtlasArray.SKIN_DIM

uniform vec2 uMapSize;
uniform int uAltView;
uniform float uStaleNukeBase;
uniform float uStaleNukeVariation;
uniform float uStaleNukeAlpha;
uniform vec3 uStaleNukeColor;
uniform uint uHighlightOwner;      // 0 = no highlight; otherwise smallID of hovered owner
uniform float uHighlightBrighten;  // hover contrast boost strength; 0 = disabled
uniform sampler2D uDefenseCoverageTex; // R8 — 1.0 = tile defended by same-owner post
uniform float uDefenseDarken;      // multiplier applied to fill on defended tiles
uniform sampler2D uBorderTex;      // RGBA8 — border flags; R > 0.25 = border tile
uniform float uSaturation;         // 1 = full color, 0 = grayscale
uniform float uTerritoryAlpha;     // absolute fill opacity; 1 = fully opaque
uniform sampler2D uClaimTex;       // RGBA8 — 24-bit "captured at" stamp per tile (0 = never)
uniform float uClaimNow;           // current stamp (4 ms units)
uniform float uClaimFade;          // stamp units a fresh capture takes to settle; 0 disables
uniform float uClaimStrength;      // 0–1 peak brightening of a just-captured tile
uniform sampler2D uPrevOwnerTex;   // RGBA8 — owner before the last change, 24-bit packed
uniform float uCrossfade;          // stamp units the previous owner's colour takes to give way; 0 = off

in vec2 vWorldPos;
out vec4 fragColor;

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
  if (tc.x < 0 || tc.y < 0 || tc.x >= int(uMapSize.x) || tc.y >= int(uMapSize.y))
    discard;

  uint raw = texelFetch(uTileTex, tc, 0).r;
  uint tileOwner = raw & uint(OWNER_MASK);
  bool fallout = (raw & (1u << FALLOUT_BIT)) != 0u;

  uint owner;
  float margin;
  visualOwner(vWorldPos, tileOwner, owner, margin);

  // Age of this tile's last change of hands (stamp units) and who held it
  // before; `crossfadeT` runs 0 → 1 while the new colour flows in.
  float age = 1.0e9;
  uint previousOwner = 0u;
  float crossfadeT = 1.0;
  if (uClaimFade > 0.0 || uCrossfade > 0.0) {
    vec3 stampBytes = texelFetch(uClaimTex, tc, 0).rgb * 255.0;
    float stamp = stampBytes.r * 65536.0 + stampBytes.g * 256.0 + stampBytes.b;
    if (stamp > 0.5) {
      age = uClaimNow - stamp;
      if (age < 0.0) age += 16777216.0;
      vec3 prevBytes = texelFetch(uPrevOwnerTex, tc, 0).rgb * 255.0;
      previousOwner = uint(prevBytes.r * 65536.0 + prevBytes.g * 256.0 + prevBytes.b + 0.5);
      if (uCrossfade > 0.0 && age < uCrossfade) {
        float t = age / uCrossfade;
        crossfadeT = t * t * (3.0 - 2.0 * t);
      }
    }
  }

  // Land just lost to nobody: the old colour drains away instead of popping.
  if (owner == 0u && !fallout) {
    if (crossfadeT >= 1.0 || previousOwner == 0u || uAltView != 0) discard;
    float pu = (float(previousOwner) + 0.5) / float(PALETTE_SIZE);
    vec4 fading = texture(uPalette, vec2(pu, 0.25));
    fading.a = uTerritoryAlpha * (1.0 - crossfadeT);
    fragColor = fading;
    return;
  }

  // --- Stale-nuke ground (any fallout tile, owned or not) ---
  // Renders for owned tiles too so the player's territory color can't bleed
  // through dim/transparent spots in the fallout bloom above.
  if (fallout) {
    float h = fract(sin(float(tc.x) * 12.9898 + float(tc.y) * 78.233) * 43758.5453);
    float noise = uStaleNukeBase + h * uStaleNukeVariation;
    fragColor = vec4(uStaleNukeColor + vec3(noise), uStaleNukeAlpha);
    return;
  }

  // Alt-view: hide owned non-fallout tiles
  if (uAltView != 0) discard;

  // --- Territory fill (owned, not fallout) ---
  float u = (float(owner) + 0.5) / float(PALETTE_SIZE);
  vec4 color = texture(uPalette, vec2(u, 0.25));

  // uShowPatterns gates both skins and patterns — they're the same
  // "decorate the territory fill" feature from the user's perspective.
  uint skinLayerPlus1 =
    uShowPatterns == 1
      ? texelFetch(uSkinLayer, ivec2(int(owner), 0), 0).r
      : 0u;
  if (skinLayerPlus1 > 0u) {
    // Skin overrides pattern entirely (mutually exclusive). The image is a
    // single stamp centered at the player's spawn tile — UVs outside [0,1]
    // are treated as transparent so tiles beyond the image bounds fall back
    // to the regular palette color. (0,0) anchor sentinel = world origin.
    uvec2 anchor = texelFetch(uSkinAnchor, ivec2(int(owner), 0), 0).rg;
    vec2 anchorOffset = (anchor == uvec2(0u)) ? vec2(0.0) : vec2(anchor);

    vec2 skinUV = (vec2(tc) - anchorOffset) / vec2(SKIN_DIM) + vec2(0.5);
    vec4 skin = texture(uSkinAtlas, vec3(skinUV, float(skinLayerPlus1) - 1.0));
    bool inBounds =
      skinUV.x >= 0.0 && skinUV.x <= 1.0 &&
      skinUV.y >= 0.0 && skinUV.y <= 1.0;
    float skinAlpha = inBounds ? skin.a : 0.0;
    // Transparent (or out-of-bounds) pixels fall through to the player color;
    // opaque pixels show the skin (tinted by team color in team games).
    vec3 skinColor = (uIsTeamMode == 1) ? color.rgb * skin.rgb : skin.rgb;
    color.rgb = mix(color.rgb, skinColor, skinAlpha);
  } else if (uShowPatterns == 1) {
    vec4 meta = texelFetch(uPatternMeta, ivec2(int(owner), 0), 0);
    if (meta.r > 0.0) {
      int pWidth = int(meta.g);
      int pHeight = int(meta.b);
      int pScale = int(meta.a);

      int px = tc.x >> pScale;
      int py = tc.y >> pScale;
      int mx = ((px % pWidth) + pWidth) % pWidth;
      int my = ((py % pHeight) + pHeight) % pHeight;
      int bitIndex = my * pWidth + mx;
      int byteIndex = bitIndex >> 3;

      uint patternByte = texelFetch(uPatternData, ivec2(byteIndex, int(owner)), 0).r;
      bool isPrimary = (patternByte & (1u << uint(bitIndex & 7))) == 0u;

      if (!isPrimary) {
        color = texture(uPalette, vec2(u, 0.75));
      }
    }
  }

  // Hover highlight: boost contrast on the hovered player's tiles, pushing
  // channels away from mid-gray. uHighlightBrighten is the strength; 0 disables.
  if (uHighlightOwner != 0u && owner == uHighlightOwner && uHighlightBrighten > 0.0) {
    float contrast = 1.0 + uHighlightBrighten;
    color.rgb = clamp((color.rgb - 0.5) * contrast + 0.5, 0.0, 1.0);
  }

  // Defense bonus: darken the fill on interior tiles defended by a same-owner
  // post. Border tiles are skipped — they get the checkerboard overlay from
  // BorderStampPass instead. Coverage is tested first so the (rarer) defended
  // tiles are the only ones that pay for the extra border fetch (&& short-
  // circuits in GLSL ES 3.00; texelFetch is derivative-free so this is safe).
  if (texelFetch(uDefenseCoverageTex, tc, 0).r > 0.5 &&
      texelFetch(uBorderTex, tc, 0).r <= 0.25) {
    color.rgb *= uDefenseDarken;
  }

  // Adjust how saturated the fill is by blending toward its luminance.
  if (uSaturation != 1.0) {
    float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(vec3(luma), color.rgb, uSaturation);
  }

  // --- Fresh-capture flash ---
  // A tile that just changed hands starts hot and cools into the settled
  // owner colour. Neighbouring tiles carry slightly different stamps (the drip
  // stagger), so an advancing front reads as a living wave, not a pixel flip.
  float alpha = uTerritoryAlpha;
  // Where the territory meets unowned land the fill fades over about one
  // device pixel instead of ending on a tile stair.
  if (uSmoothEdges == 1) {
    float aa = clamp(2.0 / max(uZoom, 0.05), 0.02, 0.5);
    alpha *= smoothstep(0.0, aa, margin);
  }
  if (uClaimFade > 0.0 && age < uClaimFade) {
    float cool = 1.0 - age / uClaimFade;
    // The flash rides in with the new colour rather than flipping on.
    float fresh = cool * cool * uClaimStrength * crossfadeT;
    vec3 hot = mix(color.rgb, vec3(1.0, 0.97, 0.9), 0.7);
    color.rgb = mix(color.rgb, hot, fresh);
    alpha = mix(alpha, min(1.0, alpha + 0.5), fresh);
  }
  // Crossfade: the previous owner's colour (or bare ground) gives way to the
  // new owner's over uCrossfade, so a front flows instead of flipping tiles.
  if (crossfadeT < 1.0 && previousOwner != owner) {
    if (previousOwner == 0u) {
      alpha *= crossfadeT;
    } else {
      float pu = (float(previousOwner) + 0.5) / float(PALETTE_SIZE);
      vec3 prevColor = texture(uPalette, vec2(pu, 0.25)).rgb;
      color.rgb = mix(prevColor, color.rgb, crossfadeT);
    }
  }
  color.a = alpha;

  fragColor = color;
}
