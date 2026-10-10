#version 300 es
precision highp float;

// Top-down ship silhouettes built from signed-distance primitives, one per
// hull class:
//   warship    — a destroyer: fine bow, long superstructure with bridge, mast
//                and funnel, forward gun turret, aft hangar and helideck;
//   transport  — a landing ship: bluff bow with a ramp, an open well deck
//                carrying rows of vehicles, aft bridge and funnel;
//   trade ship — a container ship: stacked containers in mixed colours,
//                white accommodation block aft with a funnel.
// Every hull gets a one-screen-pixel dark outline, a bow foam and a V-wake
// while under way. Owner colour paints stripes, funnels, cargo and the deck
// edge, and tints the whole hull more the smaller it is on screen so
// allegiance stays readable at strategic zoom.

uniform sampler2D uPalette;      // RGBA32F — player colours
uniform sampler2D uAffiliation;  // 256×2 RGBA8 — row 1 = unit affiliation
uniform sampler2D uEffect;       // RGBA32F — shared effect palette; warship block at WARSHIP_EFFECT_ROW_BASE
uniform float uTime;             // seconds
uniform int   uAltView;
uniform vec3  uAngryColor;

in vec2  vLocal;
flat in float vOwnerID;
flat in float vHash;
flat in float vState;
flat in float vHull;
flat in float vUnderWay;

out vec4 fragColor;

const float FLAG_ANGRY          = 2.0;
const float FLAG_TRADE_FRIENDLY = 3.0;
const float FLAG_RETREATING     = 4.0;
const vec3 ALLY_COLOR = vec3(1.0, 1.0, 0.0);

float sdBox(vec2 p, vec2 c, vec2 b) {
  vec2 d = abs(p - c) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

float hash11(float n) {
  return fract(sin(n * 127.1 + 311.7) * 43758.5453);
}

// Exact signed distance to a closed 14-vertex polygon (Inigo Quilez):
// negative inside. Every hull is a mirrored plan-view outline — bow tip on
// the axis, six starboard points, stern on the axis, six port points.
#define HULL_POINTS 14
float sdPolygon(vec2 p, vec2 v[HULL_POINTS]) {
  float d = dot(p - v[0], p - v[0]);
  float s = 1.0;
  for (int i = 0, j = HULL_POINTS - 1; i < HULL_POINTS; j = i, i++) {
    vec2 e = v[j] - v[i];
    vec2 w = p - v[i];
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= v[i].y, p.y < v[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s *= -1.0;
  }
  return s * sqrt(d);
}

// Mirror six starboard points around the axis between a bow and a stern point.
void hullOutline(vec2 bow, vec2 s1, vec2 s2, vec2 s3, vec2 s4, vec2 s5, vec2 s6,
                 vec2 stern, out vec2 v[HULL_POINTS]) {
  v[0] = bow;
  v[1] = s1; v[2] = s2; v[3] = s3; v[4] = s4; v[5] = s5; v[6] = s6;
  v[7] = stern;
  v[8] = vec2(-s6.x, s6.y); v[9] = vec2(-s5.x, s5.y); v[10] = vec2(-s4.x, s4.y);
  v[11] = vec2(-s3.x, s3.y); v[12] = vec2(-s2.x, s2.y); v[13] = vec2(-s1.x, s1.y);
}

// The owner's warship cosmetic colour, if equipped — the same catalogue
// semantics as the sprite path (flat / transition / gradient).
bool warshipEffectColor(int owner, vec2 uv, out vec3 color) {
  const int rowBase = WARSHIP_EFFECT_ROW_BASE;
  int count = int(texelFetch(uEffect, ivec2(owner, rowBase), 0).a + 0.5);
  if (count <= 0) return false;
  if (count == 1) {
    color = texelFetch(uEffect, ivec2(owner, rowBase), 0).rgb;
  } else if (int(texelFetch(uEffect, ivec2(owner, rowBase + 1), 0).a + 0.5) == 1) {
    float frequency = texelFetch(uEffect, ivec2(owner, rowBase + 2), 0).a;
    float t = uTime * frequency;
    int i = int(t) % count;
    int j = (i + 1) % count;
    vec3 a = texelFetch(uEffect, ivec2(owner, rowBase + i), 0).rgb;
    vec3 b = texelFetch(uEffect, ivec2(owner, rowBase + j), 0).rgb;
    color = mix(a, b, fract(t));
  } else {
    float colorSize = max(texelFetch(uEffect, ivec2(owner, rowBase + 2), 0).a, 0.001);
    float movementSpeed = texelFetch(uEffect, ivec2(owner, rowBase + 3), 0).a;
    float dn = (uv.x + uv.y) * 0.5;
    float phase = fract(dn - uTime * movementSpeed / (colorSize * float(count)));
    float f = phase * float(count);
    int i = int(f) % count;
    int j = (i + 1) % count;
    vec3 a = texelFetch(uEffect, ivec2(owner, rowBase + i), 0).rgb;
    vec3 b = texelFetch(uEffect, ivec2(owner, rowBase + j), 0).rgb;
    color = mix(a, b, fract(f));
  }
  return true;
}

void main() {
  vec2 p = vLocal;
  vec2 m = vec2(abs(p.x), p.y); // every hull is mirror-symmetric
  bool warship = vHull > 1.5;
  bool tradeShip = !warship && vHull > 0.5;

  // --- Hull and deck distance fields ----------------------------------------
  float hull;        // outer hull
  float structure;   // superstructure blocks (darker / lighter decks)
  float bridge;      // bridge top (lighter)
  float funnel;      // funnel / exhaust (dark, owner cap)
  float cargo = 1.0; // vehicles / containers
  float detail = 1.0;// small dark fittings (gun, hatches, windows)
  float paintBand;   // owner stripes on the hull
  float ring = 1.0;  // helideck ring (warship)
  float halfWidth;
  float bowY;
  float sternY;
  vec3 deckColor;
  vec3 structureColor;
  vec3 bridgeColor;

  if (warship) {
    halfWidth = 0.127;
    bowY = -0.72;
    sternY = 0.61;
    // Destroyer plan: a long fine entry, maximum beam just aft of midships,
    // a gentle run aft to a narrow transom.
    vec2 v[HULL_POINTS];
    hullOutline(vec2(0.0, bowY), vec2(0.045, -0.6), vec2(0.09, -0.45),
                vec2(0.118, -0.25), vec2(0.127, 0.1), vec2(0.12, 0.4),
                vec2(0.09, 0.585), vec2(0.0, sternY), v);
    hull = sdPolygon(p, v);
    float superstructure = sdBox(p, vec2(0.0, -0.02), vec2(0.075, 0.17));
    float hangar = sdBox(p, vec2(0.0, 0.3), vec2(0.07, 0.08));
    float vls = sdBox(p, vec2(0.0, -0.29), vec2(0.05, 0.045));
    structure = min(superstructure, hangar);
    bridge = sdBox(p, vec2(0.0, -0.12), vec2(0.05, 0.05));
    funnel = length(p - vec2(0.0, 0.06)) - 0.028;
    float turret = length(p - vec2(0.0, -0.4)) - 0.045;
    float barrel = sdSegment(p, vec2(0.0, -0.4), vec2(0.0, -0.56)) - 0.012;
    float mast = length(p - vec2(0.0, -0.04)) - 0.018;
    detail = min(min(turret, barrel), min(vls, mast));
    ring = abs(length(p - vec2(0.0, 0.5)) - 0.07) - 0.008;
    paintBand = min(sdBox(p, vec2(0.0, -0.45), vec2(halfWidth, 0.02)),
                    sdBox(p, vec2(0.0, 0.43), vec2(halfWidth, 0.02)));
    deckColor = vec3(0.6, 0.63, 0.66);
    structureColor = vec3(0.45, 0.48, 0.52);
    bridgeColor = vec3(0.7, 0.73, 0.76);
  } else if (tradeShip) {
    halfWidth = 0.15;
    bowY = -0.68;
    sternY = 0.63;
    // Container ship plan: a fuller bow with a short entry, a long parallel
    // midbody and a nearly flat transom.
    vec2 v[HULL_POINTS];
    hullOutline(vec2(0.0, bowY), vec2(0.07, -0.6), vec2(0.125, -0.47),
                vec2(0.15, -0.25), vec2(0.15, 0.38), vec2(0.14, 0.55),
                vec2(0.112, 0.62), vec2(0.0, sternY), v);
    hull = sdPolygon(p, v);
    // Container bay: three columns, seven rows, thin gaps between boxes.
    float boxes = 1.0;
    for (int row = 0; row < 7; row++) {
      float cy = -0.42 + float(row) * 0.11;
      boxes = min(boxes, sdBox(p, vec2(0.0, cy), vec2(0.035, 0.045)));
      boxes = min(boxes, sdBox(m, vec2(0.09, cy), vec2(0.035, 0.045)));
    }
    cargo = boxes;
    structure = sdBox(p, vec2(0.0, 0.43), vec2(0.12, 0.09));
    bridge = sdBox(p, vec2(0.0, 0.365), vec2(0.11, 0.012));
    funnel = sdBox(p, vec2(0.0, 0.5), vec2(0.035, 0.03));
    detail = sdBox(p, vec2(0.0, -0.56), vec2(0.04, 0.02)); // forecastle hatch
    paintBand = sdBox(p, vec2(0.0, -0.5), vec2(halfWidth, 0.015));
    deckColor = vec3(0.34, 0.37, 0.42);
    structureColor = vec3(0.9, 0.91, 0.93);
    bridgeColor = vec3(0.2, 0.26, 0.34);
  } else {
    // Transport: a landing ship with a bluff, chamfered bow and a ramp.
    halfWidth = 0.17;
    bowY = -0.6;
    sternY = 0.56;
    // Landing ship plan: a flat bow with a ramp, chamfered shoulders, a
    // broad box hull and a lightly rounded stern.
    vec2 v[HULL_POINTS];
    hullOutline(vec2(0.0, bowY), vec2(0.1, -0.6), vec2(0.17, -0.5),
                vec2(0.17, 0.0), vec2(0.17, 0.4), vec2(0.162, 0.51),
                vec2(0.13, 0.555), vec2(0.0, sternY), v);
    hull = sdPolygon(p, v);
    float well = sdBox(p, vec2(0.0, -0.06), vec2(0.125, 0.36));
    float rows = 1.0;
    for (int row = 0; row < 4; row++) {
      float cy = -0.3 + float(row) * 0.16;
      rows = min(rows, sdBox(m, vec2(0.065, cy), vec2(0.035, 0.05)));
    }
    cargo = rows;
    structure = min(well, sdBox(p, vec2(0.0, 0.42), vec2(0.15, 0.1)));
    bridge = sdBox(p, vec2(0.0, 0.38), vec2(0.11, 0.035));
    funnel = length(p - vec2(0.0, 0.47)) - 0.028;
    detail = sdBox(p, vec2(0.0, -0.51), vec2(0.1, 0.006)); // ramp hinge line
    paintBand = sdBox(p, vec2(0.0, -0.565), vec2(0.09, 0.03)); // the ramp door
    deckColor = vec3(0.5, 0.54, 0.52);
    structureColor = vec3(0.36, 0.4, 0.4);
    bridgeColor = vec3(0.62, 0.66, 0.65);
  }

  float aa = max(fwidth(hull), 0.004);
  float hullMask = 1.0 - smoothstep(0.0, aa, hull);
  float outlineWidth = aa * 1.6;
  float outline = 1.0 - smoothstep(outlineWidth, outlineWidth + aa, hull);
  // Small on screen: fittings would alias into noise, so they fade out while
  // the owner tint of the whole hull grows.
  float strategic = smoothstep(0.03, 0.1, aa);
  float fine = 1.0 - strategic;

  // --- Owner colour --------------------------------------------------------
  vec3 ownerColor;
  vec3 borderColor;
  if (uAltView != 0) {
    ownerColor = abs(vState - FLAG_TRADE_FRIENDLY) < 0.1
      ? ALLY_COLOR
      : texelFetch(uAffiliation, ivec2(int(vOwnerID), 1), 0).rgb;
    if (hullMask < 0.01 && outline < 0.01) discard;
    fragColor = vec4(ownerColor, max(hullMask, outline * 0.9));
    return;
  }
  float u = (vOwnerID + 0.5) / float(PALETTE_SIZE);
  ownerColor = texture(uPalette, vec2(u, 0.25)).rgb;
  borderColor = texture(uPalette, vec2(u, 0.75)).rgb;
  vec3 paintColor = ownerColor;
  if (warship) {
    vec3 effectRGB;
    if (warshipEffectColor(int(vOwnerID + 0.5), p * 0.5 + 0.5, effectRGB)) {
      paintColor = effectRGB;
    }
  }
  bool angry = abs(vState - FLAG_ANGRY) < 0.1;
  bool retreating = abs(vState - FLAG_RETREATING) < 0.1;
  if (angry) paintColor = uAngryColor;

  // --- Deck shading ---------------------------------------------------------
  // Lit from the bow-left with a faint sheer line along the centre.
  float lighting = 0.86 + 0.14 * clamp(-p.y * 0.6 - p.x * 0.5, -1.0, 1.0);
  vec3 color = deckColor * lighting;
  float structureMask = (1.0 - smoothstep(0.0, aa, structure));
  float blink = retreating ? step(0.5, fract(uTime * 1.4)) : 0.0;
  color = mix(color, mix(structureColor, vec3(0.05, 0.05, 0.06), blink), structureMask);
  color = mix(color, bridgeColor, (1.0 - smoothstep(0.0, aa, bridge)) * fine);

  // Cargo: vehicles in the owner's colour on the transport; mixed container
  // colours with owner-coloured corners on the trade ship.
  float cargoMask = (1.0 - smoothstep(0.0, aa, cargo)) * fine;
  if (cargoMask > 0.0) {
    vec3 cargoColor = mix(paintColor, vec3(1.0), 0.15);
    if (tradeShip) {
      float col = floor((p.x + 0.135) / 0.09);
      float row = floor((p.y + 0.465) / 0.11);
      float h = hash11(col * 7.0 + row * 13.0 + vHash * 97.0);
      vec3 palette[6] = vec3[6](
        vec3(0.72, 0.2, 0.18), vec3(0.16, 0.32, 0.6), vec3(0.14, 0.5, 0.5),
        vec3(0.85, 0.5, 0.15), vec3(0.8, 0.75, 0.6), vec3(0.25, 0.5, 0.3));
      cargoColor = h < 0.3 ? cargoColor : palette[int(fract(h * 7.31) * 6.0)];
    }
    color = mix(color, cargoColor, cargoMask);
  }

  // Owner paint: hull stripes, funnel, helideck ring and the deck edge.
  float band = 1.0 - smoothstep(0.0, aa, paintBand);
  float funnelMask = 1.0 - smoothstep(0.0, aa, funnel);
  float ringMask = (1.0 - smoothstep(0.0, aa, ring)) * fine;
  float edge = smoothstep(-aa * 3.2, -aa * 1.8, hull) * hullMask;
  color = mix(color, mix(paintColor, vec3(1.0), 0.1), clamp(band + ringMask, 0.0, 1.0) * 0.92);
  color = mix(color, mix(paintColor, vec3(0.0), 0.25), funnelMask);
  color = mix(color, borderColor, edge * 0.85);
  // Dark fittings.
  float detailMask = (1.0 - smoothstep(0.0, aa, detail)) * fine;
  color = mix(color, vec3(0.14, 0.15, 0.17), detailMask);
  // Strategic tint: the whole hull leans to the owner colour when tiny.
  color = mix(color, paintColor, strategic * 0.6);

  if (warship && angry) {
    // Muzzle flash at the gun barrel while the ship is engaging.
    float flashPhase = step(0.72, fract(uTime * 2.6 + vHash));
    float flash = exp(-dot((p - vec2(0.0, -0.6)) * 22.0, (p - vec2(0.0, -0.6)) * 22.0)) * flashPhase;
    color = mix(color, vec3(1.0, 0.85, 0.5), flash);
  }

  // --- Water effects behind and around the hull --------------------------
  float wakeT = clamp((p.y - sternY) / (1.0 - sternY), 0.0, 1.0);
  float spread = halfWidth * 0.7 + 0.32 * wakeT;
  float armWidth = 0.018 + 0.03 * wakeT;
  float arms = 1.0 - smoothstep(0.0, armWidth, abs(m.x - spread));
  float wash = 1.0 - smoothstep(0.0, halfWidth * 0.8 + 0.12 * wakeT, m.x);
  float ripple = 0.5 + 0.5 * sin(p.y * 38.0 - uTime * 7.0 + vHash * 6.2831853);
  float wake = (arms * 0.6 + wash * 0.35 * (0.6 + 0.4 * ripple))
             * (1.0 - wakeT) * step(sternY, p.y) * vUnderWay;
  // Bow foam: the outline whitens along the forward hull while under way.
  float foam = (1.0 - smoothstep(0.0, aa * 2.5, abs(hull) - aa))
             * smoothstep(-0.2, bowY, p.y) * 0.85 * vUnderWay;

  vec3 outlineColor = vec3(0.06, 0.08, 0.1);
  float alpha = max(hullMask, outline);
  vec3 rgb = mix(outlineColor, color, hullMask);
  rgb = mix(rgb, vec3(0.94, 0.97, 1.0), foam * (1.0 - hullMask));
  vec3 fxColor = vec3(0.92, 0.96, 1.0);
  rgb = mix(fxColor, rgb, alpha);
  alpha = max(alpha, wake * 0.75);
  if (alpha < 0.01) discard;
  fragColor = vec4(rgb, alpha);
}
