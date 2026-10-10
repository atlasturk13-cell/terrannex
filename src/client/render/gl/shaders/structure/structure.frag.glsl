#version 300 es
precision highp float;

uniform sampler2D uPalette;
uniform sampler2D uAtlas;
uniform sampler2D uAffiliation;   // 256×2 RGBA8 — row 1 = unit affiliation
uniform sampler2D uEffect;        // RGBA32F — shared effect palette, keyed by
                                  //   ownerID. The structures block starts at row
                                  //   STRUCT_EFFECT_ROW_BASE; same layout as
                                  //   trail.frag.glsl (row r = color r's rgb;
                                  //   row 0.a = count, 1.a = styleId,
                                  //   2.a = scalar0, 3.a = scalar1)
uniform float uTime;              // seconds, for animated effect styles
uniform float uHoverOwner;        // smallID of the hovered territory's owner
                                  //   (0 = none) — gates the structures effect
uniform float uDotsThreshold;
uniform float uGhostAlpha;       // 1.0 = normal, <1.0 = ghost transparency
uniform vec3  uOutlineColor;     // ghost outline color (vec3(0) = no outline)
uniform int   uAltView;
uniform int   uHighlightMask;   // bitmask of atlas columns to highlight (0 = off)
uniform float uHighlightOutlineW; // outline width for highlighted structures
uniform float uHighlightDimAlpha; // alpha multiplier for non-highlighted structures
uniform float uFillDarken;      // HSV value multiplier on icon fill
uniform float uBorderDarken;    // HSV value multiplier on icon border
uniform float uIconAlpha;       // global multiplier on final icon alpha
uniform vec3  uIconColor;       // color of the inner icon glyph (was white)
uniform float uIconDarken;      // >0: glyph = darkened player color instead of uIconColor
uniform float uLocalPlayerID;
uniform sampler2D uDetail;        // close-up art atlas, STRUCTURE_TYPE_COUNT columns
uniform float uDetailFadeStart;   // zoom where the icon starts fading into the art
uniform float uDetailFadeEnd;     // zoom where the art has fully taken over
uniform float uDetailReady;       // 1 once the art atlas has been rasterised

in vec2  vLocalPos;
in vec2  vAtlasUV;
flat in float vOwnerID;
flat in float vUnderConstruction;
flat in float vMarkedForDeletion;
flat in float vZoom;
flat in float vAtlasIdx;
flat in float vShapeScale;

out vec4 fragColor;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

vec3 darken(vec3 rgb, float vScale) {
  vec3 hsv = rgb2hsv(rgb);
  hsv.z *= vScale;
  return hsv2rgb(hsv);
}

// The owner's structures cosmetic color, if equipped. Reads the structures
// block of the shared effect palette; the gradient/transition math mirrors
// trail.frag.glsl so the same catalog attributes look identical on both.
// Returns false when the owner has no structures effect (count 0).
bool structuresEffectColor(int owner, out vec3 color) {
  const int rowBase = STRUCT_EFFECT_ROW_BASE;
  int count = int(texelFetch(uEffect, ivec2(owner, rowBase), 0).a + 0.5);
  if (count <= 0) return false;
  if (count == 1) {
    // Single color — flat recolor.
    color = texelFetch(uEffect, ivec2(owner, rowBase), 0).rgb;
  } else if (int(texelFetch(uEffect, ivec2(owner, rowBase + 1), 0).a + 0.5) == 1) {
    // transition — one color at a time, cross-fading through the list.
    // frequency = color changes per second.
    float frequency = texelFetch(uEffect, ivec2(owner, rowBase + 2), 0).a;
    float t = uTime * frequency;
    int i = int(t) % count;
    int j = (i + 1) % count;
    vec3 a = texelFetch(uEffect, ivec2(owner, rowBase + i), 0).rgb;
    vec3 b = texelFetch(uEffect, ivec2(owner, rowBase + j), 0).rgb;
    color = mix(a, b, fract(t));
  } else {
    // gradient — the palette spans the icon's diagonal once, so the whole
    // gradient is visible across the shape (world-space banding like the
    // trail's would put the entire icon inside one band and read as a flat
    // color). It scrolls along the diagonal at the trail-equivalent pace:
    // one full slide every colorSize · count / movementSpeed seconds,
    // so both knobs keep their trail timing semantics.
    float colorSize = max(texelFetch(uEffect, ivec2(owner, rowBase + 2), 0).a, 0.001);
    float movementSpeed = texelFetch(uEffect, ivec2(owner, rowBase + 3), 0).a;
    float dn = (vLocalPos.x + vLocalPos.y) * 0.5; // icon diagonal, -0.5..0.5
    float phase =
      fract(dn - uTime * movementSpeed / (colorSize * float(count)));
    float f = phase * float(count);
    int i = int(f) % count;
    int j = (i + 1) % count;
    vec3 a = texelFetch(uEffect, ivec2(owner, rowBase + i), 0).rgb;
    vec3 b = texelFetch(uEffect, ivec2(owner, rowBase + j), 0).rgb;
    color = mix(a, b, fract(f));
  }
  return true;
}

#define PI 3.14159265

// Signed distance to regular polygon edge.
// R = circumradius (center-to-vertex), n = sides, rot = rotation in radians.
// Returns negative inside, positive outside.
float sdPolygon(vec2 p, float R, float n, float rot) {
  float an = PI / n;
  float a = atan(p.y, p.x) - rot;
  a = mod(a + an, 2.0 * an) - an;
  return length(p) * cos(a) - R * cos(an);
}

float sdBox(vec2 p, vec2 halfSize) {
  vec2 q = abs(p) - halfSize;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// Barracks frame: a military badge — flat top, straight sides, and a point
// at the bottom. Intersection of a box and two slanted half-planes.
float sdShield(vec2 p, float R) {
  float body = sdBox(p - vec2(0.0, 0.015 * R), vec2(0.86 * R, 0.935 * R));
  vec2 n = normalize(vec2(0.65, 0.86));
  float tip = dot(vec2(abs(p.x), p.y) - vec2(0.0, 0.95 * R), n);
  return max(body, tip);
}

// Per-structure-type shape SDF.
// Structure indices: 0=City, 1=Port, 2=Factory, 3=DefensePost, 4=SAM,
// 5=Silo, 6=Airport, 7=Barracks. Airport (runway) and Barracks (roofed
// block) have procedural glyphs and do not sample the inherited six-column
// bitmap atlas.
float shapeSDF(vec2 p, float R) {
  if (vAtlasIdx < 0.5)
    return length(p) - R;                     // City → circle
  if (vAtlasIdx < 1.5)
    return sdPolygon(p, R, 5.0, PI * 0.5);    // Port → pentagon (vertex up)
  if (vAtlasIdx < 2.5)
    return sdPolygon(p, R, 6.0, PI / 6.0);    // Factory → hexagon (flat top)
  if (vAtlasIdx < 3.5)
    return sdPolygon(p, R, 8.0, 0.0);         // Defense Post → octagon (flat top)
  if (vAtlasIdx < 4.5)
    return sdPolygon(p, R, 4.0, 0.0);         // SAM Launcher → square (flat sides)
  if (vAtlasIdx < 5.5)
    return sdPolygon(p, R, 3.0, PI * 0.5);    // Missile Silo → triangle (vertex up)
  if (vAtlasIdx < 6.5)
    return sdPolygon(p, R, 4.0, PI * 0.25);   // Airport → diamond
  return sdShield(p, R);                      // Barracks → badge (point down)
}

void main() {
  float dist = length(vLocalPos);
  float radius = 0.45;
  float borderWidth = 0.06 / vShapeScale;

  // Close-up level of detail: past uDetailFadeStart the type glyph gives way
  // to the rasterised art and the shape rounds into a plot with a player
  // colour ring. Ghost previews and construction sites keep the icon.
  float detailMix = 0.0;
  if (uDetailReady > 0.5 && uGhostAlpha > 0.999 && vUnderConstruction < 0.5) {
    detailMix = smoothstep(uDetailFadeStart, uDetailFadeEnd, vZoom);
  }

  float sdf = mix(shapeSDF(vLocalPos, radius), dist - radius, detailMix);
  float fw = fwidth(dist);

  // When highlight is active, expand the region to include the outer outline band.
  float highlightOutlineW = uHighlightMask != 0 ? uHighlightOutlineW / vShapeScale : 0.0;
  float outerAlpha = 1.0 - smoothstep(-fw, fw, sdf - highlightOutlineW);

  if (outerAlpha <= 0.0) discard;

  float borderMask = 1.0 - smoothstep(-fw, fw, sdf + borderWidth);

  // Player color
  vec4 fillColor;
  vec4 borderColor;

  if (uAltView != 0 && vUnderConstruction < 0.5) {
    vec3 ac = texelFetch(uAffiliation, ivec2(int(vOwnerID), 1), 0).rgb;
    fillColor = vec4(darken(ac, uFillDarken), 1.0);
    borderColor = vec4(darken(ac, uBorderDarken), 1.0);
  } else if (vUnderConstruction > 0.5) {
    fillColor = vec4(198.0/255.0, 198.0/255.0, 198.0/255.0, 1.0);
    borderColor = vec4(127.0/255.0, 127.0/255.0, 127.0/255.0, 1.0);
  } else {
    int owner = int(vOwnerID + 0.5);
    int local = int(uLocalPlayerID);
    float u = (vOwnerID + 0.5) / float(PALETTE_SIZE);
    fillColor = texture(uPalette, vec2(u, 0.25));
    // if local player, use territory color because the border color is grey
    borderColor = texture(uPalette, vec2(u, owner == local ? 0.25 : 0.75));
    // Darken via HSV value so hue/saturation stay intact
    // vScale < 1.0 = darker, > 1.0 = brighter
    fillColor.rgb = darken(fillColor.rgb, uFillDarken);
    borderColor.rgb = darken(borderColor.rgb, uBorderDarken);
    fillColor.a = 1.0;
    borderColor.a = 1.0;
  }

  // structures cosmetic: recolor the fill with the owner's effect (raw catalog
  // colors, like trails — no darken) while their territory is hovered. The
  // local player's own effect always shows — touch devices never hover, and
  // buyers should see what they paid for. The border keeps the player color
  // so ownership stays readable. Skipped for alt view and construction gray.
  bool effectActive = false;
  if (uAltView == 0 && vUnderConstruction < 0.5) {
    int effOwner = int(vOwnerID + 0.5);
    if ((effOwner == int(uHoverOwner + 0.5) ||
         effOwner == int(uLocalPlayerID)) && effOwner > 0) {
      vec3 effectRGB;
      if (structuresEffectColor(effOwner, effectRGB)) {
        fillColor.rgb = effectRGB;
        effectActive = true;
      }
    }
  }

  vec4 bgColor = mix(borderColor, fillColor, borderMask);

  // Sample icon from atlas (white on transparent)
  // Only show icon detail when zoomed in enough
  float iconAlpha = 0.0;
  if (vZoom > uDotsThreshold) {
    if (vAtlasIdx > 6.5) {
      // Barracks mark: a broad chevron roof over a low barracks block with a
      // doorway and two windows cut out. The chevron echoes a rank stripe;
      // the solid block keeps it readable at the smallest icon LOD and its
      // silhouette differs from City's skyline and Airport's runway.
      float glyphAA = max(fwidth(vLocalPos.x), fwidth(vLocalPos.y));

      float roofLeft = sdSegment(vLocalPos, vec2(-0.26, -0.06), vec2(0.0, -0.22)) - 0.03;
      float roofRight = sdSegment(vLocalPos, vec2(0.0, -0.22), vec2(0.26, -0.06)) - 0.03;
      float roofGlyph = 1.0 - smoothstep(-glyphAA, glyphAA, min(roofLeft, roofRight));

      float block = sdBox(vLocalPos - vec2(0.0, 0.075), vec2(0.18, 0.115));
      float doorway = sdBox(vLocalPos - vec2(0.0, 0.13), vec2(0.042, 0.065));
      float windows = sdBox(vec2(abs(vLocalPos.x), vLocalPos.y) - vec2(0.105, 0.045),
        vec2(0.035, 0.03));
      float barracksBlock = max(block, -min(doorway, windows));
      float blockGlyph = 1.0 - smoothstep(-glyphAA, glyphAA, barracksBlock);

      iconAlpha = max(roofGlyph, blockGlyph) * borderMask;
    } else if (vAtlasIdx > 5.5) {
      // Airport mark: a runway on the left, a low terminal and a compact
      // control tower on the right. Broad, code-native strokes survive the
      // smallest icon LOD while the asymmetric silhouette remains distinct
      // from Port and Missile Silo.
      float glyphAA = max(fwidth(vLocalPos.x), fwidth(vLocalPos.y));

      float runwayLeft = 1.0 - smoothstep(-glyphAA, glyphAA,
        sdBox(vLocalPos - vec2(-0.205, 0.0), vec2(0.018, 0.285)));
      float runwayRight = 1.0 - smoothstep(-glyphAA, glyphAA,
        sdBox(vLocalPos - vec2(-0.075, 0.0), vec2(0.018, 0.285)));
      float runwayThresholdTop = 1.0 - smoothstep(-glyphAA, glyphAA,
        sdBox(vLocalPos - vec2(-0.14, -0.265), vec2(0.083, 0.018)));
      float runwayThresholdBottom = 1.0 - smoothstep(-glyphAA, glyphAA,
        sdBox(vLocalPos - vec2(-0.14, 0.265), vec2(0.083, 0.018)));
      float runwayCenterDash = max(
        1.0 - smoothstep(-glyphAA, glyphAA,
          sdBox(vLocalPos - vec2(-0.14, -0.13), vec2(0.016, 0.045))),
        max(
          1.0 - smoothstep(-glyphAA, glyphAA,
            sdBox(vLocalPos - vec2(-0.14, 0.0), vec2(0.016, 0.045))),
          1.0 - smoothstep(-glyphAA, glyphAA,
            sdBox(vLocalPos - vec2(-0.14, 0.13), vec2(0.016, 0.045)))
        )
      );
      float runwayGlyph = max(
        max(runwayLeft, runwayRight),
        max(max(runwayThresholdTop, runwayThresholdBottom), runwayCenterDash)
      );

      float terminalRoof = 1.0 - smoothstep(-glyphAA, glyphAA,
        sdBox(vLocalPos - vec2(0.135, 0.145), vec2(0.125, 0.022)));
      float terminalBase = 1.0 - smoothstep(-glyphAA, glyphAA,
        sdBox(vLocalPos - vec2(0.135, 0.225), vec2(0.125, 0.022)));
      float terminalSides = max(
        1.0 - smoothstep(-glyphAA, glyphAA,
          sdBox(vLocalPos - vec2(0.032, 0.185), vec2(0.022, 0.062))),
        1.0 - smoothstep(-glyphAA, glyphAA,
          sdBox(vLocalPos - vec2(0.238, 0.185), vec2(0.022, 0.062)))
      );
      float terminalGlyph = max(max(terminalRoof, terminalBase), terminalSides);

      float towerStem = 1.0 - smoothstep(-glyphAA, glyphAA,
        sdBox(vLocalPos - vec2(0.135, 0.02), vec2(0.025, 0.125)));
      float towerCab = 1.0 - smoothstep(-glyphAA, glyphAA,
        sdBox(vLocalPos - vec2(0.135, -0.105), vec2(0.09, 0.042)));
      float towerBeacon = 1.0 - smoothstep(-glyphAA, glyphAA,
        sdBox(vLocalPos - vec2(0.135, -0.185), vec2(0.014, 0.04)));
      float controlTowerGlyph = max(towerStem, max(towerCab, towerBeacon));

      iconAlpha = max(runwayGlyph, max(terminalGlyph, controlTowerGlyph)) * borderMask;
    } else {
      // Clamp UV to this atlas column to prevent bleeding into neighbours
      // when uIconFill shrinks the icon (expanding UV range beyond column).
      float colStart = vAtlasIdx / float(ATLAS_COLS);
      float colEnd = (vAtlasIdx + 1.0) / float(ATLAS_COLS);
      vec2 safeUV = vec2(clamp(vAtlasUV.x, colStart, colEnd), clamp(vAtlasUV.y, 0.0, 1.0));
      vec4 iconSample = texture(uAtlas, safeUV);
      // Zero out icon outside the valid UV region (clamped pixels would repeat the edge)
      float inBounds = step(colStart, vAtlasUV.x) * step(vAtlasUV.x, colEnd)
                     * step(0.0, vAtlasUV.y) * step(vAtlasUV.y, 1.0);
      // Clip to fill area so icon doesn't bleed into the border ring.
      iconAlpha = iconSample.a * borderMask * inBounds;
    }
  }

  // The glyph fades out as the close-up art fades in.
  iconAlpha *= 1.0 - detailMix;

  // Composite: tinted icon over player-colored shape.
  // Classic icons (uIconDarken > 0) tint the glyph with a darkened player
  // color. When the shape itself is already dark, that darkened glyph blends
  // into the shape (and the dark territory behind it) and becomes unreadable —
  // so flip the glyph to the light icon color when the fill is too dark.
  // While the structures effect is animating the fill, the flip becomes a
  // smooth luminance fade so the glyph cross-fades instead of snapping;
  // without the effect this is the classic hard threshold, pixel-identical
  // to having no cosmetic equipped.
  vec3 glyphColor = uIconColor;
  if (uIconDarken > 0.0) {
    float fillLum = dot(fillColor.rgb, vec3(0.299, 0.587, 0.114));
    if (effectActive) {
      float t = smoothstep(0.25, 0.45, fillLum); // 0 = dark fill → light glyph
      glyphColor = mix(uIconColor, darken(fillColor.rgb, uIconDarken), t);
    } else {
      glyphColor =
        fillLum < 0.25 ? uIconColor : darken(fillColor.rgb, uIconDarken);
    }
  }
  vec3 finalRGB = mix(bgColor.rgb, glyphColor, iconAlpha);

  // Close-up art fills the plot inside the colour ring.
  if (detailMix > 0.0) {
    float innerR = radius - borderWidth;
    vec2 dUV = 0.5 + vLocalPos * (0.5 / innerR);
    float inArt = step(0.0, dUV.x) * step(dUV.x, 1.0) * step(0.0, dUV.y) * step(dUV.y, 1.0);
    float colStart = vAtlasIdx / float(STRUCTURE_TYPE_COUNT);
    float colEnd = (vAtlasIdx + 1.0) / float(STRUCTURE_TYPE_COUNT);
    vec2 artUV = vec2(
      clamp((vAtlasIdx + clamp(dUV.x, 0.0, 1.0)) / float(STRUCTURE_TYPE_COUNT), colStart, colEnd),
      clamp(dUV.y, 0.0, 1.0));
    vec4 art = texture(uDetail, artUV);
    finalRGB = mix(finalRGB, art.rgb, detailMix * art.a * inArt * borderMask);
  }

  // Red X overlay for units marked for deletion
  if (vMarkedForDeletion > 0.5) {
    float lineW = max(0.025, fw * 1.5);
    float d1 = abs(vLocalPos.x - vLocalPos.y) * 0.7071; // dist to y=x diagonal
    float d2 = abs(vLocalPos.x + vLocalPos.y) * 0.7071; // dist to y=-x diagonal
    float dMin = min(d1, d2);
    // Extend arms close to the circle edge
    float maskR = max(radius * 1.55, fw * 6.0);
    float mask = 1.0 - smoothstep(maskR - fw, maskR, dist);
    float xLine = (1.0 - smoothstep(lineW - fw, lineW + fw, dMin)) * mask;
    finalRGB = mix(finalRGB, vec3(1.0, 0.25, 0.25), xLine * 0.95);
  }

  // Ghost tint — blend entire surface toward uOutlineColor when non-zero
  float tintActive = step(0.01, dot(uOutlineColor, uOutlineColor));
  finalRGB = mix(finalRGB, uOutlineColor, tintActive * 0.5);

  float finalAlpha = bgColor.a * outerAlpha * uGhostAlpha * uIconAlpha;

  // Build-button hover highlight: white outline on matching types, dim the rest
  if (uHighlightMask != 0) {
    int bit = 1 << int(vAtlasIdx + 0.5);
    if ((uHighlightMask & bit) != 0) {
      // White outline band outside the shape edge (matches game's OutlineFilter)
      float shapeEdge = 1.0 - smoothstep(-fw, fw, sdf);           // 1 inside shape, 0 outside
      float expandedEdge = 1.0 - smoothstep(-fw, fw, sdf - highlightOutlineW); // includes outline band
      float outlineBand = expandedEdge - shapeEdge;                // 1 in outline region only
      finalRGB = mix(finalRGB, vec3(1.0), outlineBand);
      finalAlpha = max(finalAlpha, outlineBand);
    } else {
      finalAlpha *= uHighlightDimAlpha;
    }
  }

  fragColor = vec4(finalRGB, finalAlpha);
}
