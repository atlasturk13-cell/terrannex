#version 300 es
precision highp float;

// Top-down aircraft silhouettes built from signed-distance primitives, one
// per airframe model (the index rides in the flags byte, see
// aircraftModelIndex):
//   0 F-16      single engine, cropped-delta wing, one tail, bubble canopy
//   1 F-35      stubby wide body, trapezoid wing, twin canted tails
//   2 B-2       large dark flying wing with a W trailing edge
//   3 F-22      wide chined body, diamond wing, twin canted tails, twin nozzles
//   4 KAAN      long-nosed stealth multirole, trapezoid wing, twin tails
//   5 Typhoon   pure delta with canards, twin engines
//   6 A-10      straight wings, twin engine pods high on the aft fuselage,
//               twin fins on the tailplane tips, long gun nose
//   7 B-52      very long body, long swept wings with four engine pods a side
// Every airframe gets an afterburner or exhaust glow and a short contrail.
// Owner colour paints the wing tips, tail and a fuselage band so allegiance
// stays readable at strategic scale; the dark outline is one screen pixel
// wide at every zoom.

uniform sampler2D uPalette;      // RGBA32F — player colours
uniform sampler2D uAffiliation;  // 256×2 RGBA8 — row 1 = unit affiliation
uniform float uTime;             // seconds
uniform int   uAltView;

in vec2  vLocal;
flat in float vOwnerID;
flat in float vHash;
flat in float vModel;

out vec4 fragColor;

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

float sdBox(vec2 p, vec2 c, vec2 b) {
  vec2 d = abs(p - c) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// Inigo Quilez — exact signed distance to a triangle.
float sdTriangle(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
  vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                   vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                   vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}

// A quadrilateral wing (root leading, tip leading, tip trailing, root
// trailing) as two triangles; the shared edge cancels inside the union.
float sdQuad(vec2 p, vec2 a, vec2 b, vec2 c, vec2 d) {
  return min(sdTriangle(p, a, b, c), sdTriangle(p, a, c, d));
}

// Tapered fuselage: a capsule from nose to tail whose radius grows from the
// nose over `grow` of the length and shrinks again over the last `taper`.
float sdFuselage(vec2 p, float noseY, float tailY, float noseR, float bodyR,
                 float grow, float taper) {
  float along = clamp((p.y - noseY) / (tailY - noseY), 0.0, 1.0);
  float r = mix(noseR, bodyR, smoothstep(0.0, grow, along))
          * mix(1.0, 0.8, smoothstep(1.0 - taper, 1.0, along));
  return sdSegment(p, vec2(0.0, noseY), vec2(0.0, tailY)) - r;
}

void main() {
  int model = int(vModel + 0.5);
  bool flyingWing = model == 2;
  // Bombers are visibly larger airframes inside the same quad.
  float airframeScale = model == 2 ? 1.15 : (model == 7 ? 1.3 : (model == 6 ? 1.05 : 1.0));
  vec2 p = vLocal / airframeScale;
  vec2 m = vec2(abs(p.x), p.y); // every airframe is mirror-symmetric

  // --- Airframe distance field ---------------------------------------------
  float fuselage;
  float wing;
  float tailPlane = 1.0;
  float fins = 1.0;        // canted twin tails / A-10 fins, drawn as strokes
  float engines = 1.0;     // nacelles / pods
  float canards = 1.0;
  float canopy;
  vec2 nozzleAt;           // right-hand nozzle centre (mirrored)
  float nozzleCount = 2.0; // 1 for single-engine jets (nozzle on the axis)
  float trailStart;
  vec2 tipPaint;           // wing-tip paint fade (start, end) along |x|
  vec2 bandY;              // fuselage band (start, end) along y
  vec3 skin;

  if (model == 0) {
    // F-16: slender single-engine fighter, cropped delta, one fin.
    fuselage = sdFuselage(p, -0.58, 0.44, 0.025, 0.07, 0.35, 0.3);
    wing = sdQuad(m, vec2(0.04, -0.04), vec2(0.42, 0.24), vec2(0.42, 0.3), vec2(0.04, 0.27));
    tailPlane = sdQuad(m, vec2(0.04, 0.3), vec2(0.22, 0.42), vec2(0.22, 0.46), vec2(0.04, 0.45));
    fins = sdSegment(p, vec2(0.0, 0.22), vec2(0.0, 0.42)) - 0.012;
    canopy = sdSegment(p, vec2(0.0, -0.4), vec2(0.0, -0.22)) - 0.038;
    nozzleAt = vec2(0.0, 0.46);
    nozzleCount = 1.0;
    trailStart = 0.46;
    tipPaint = vec2(0.26, 0.4);
    bandY = vec2(0.06, 0.16);
    skin = vec3(0.74, 0.77, 0.8);
  } else if (model == 1) {
    // F-35: wide stubby body, trapezoid wing, canted twin tails.
    fuselage = sdFuselage(p, -0.52, 0.4, 0.035, 0.105, 0.4, 0.25);
    wing = sdQuad(m, vec2(0.08, -0.08), vec2(0.4, 0.14), vec2(0.4, 0.2), vec2(0.08, 0.22));
    tailPlane = sdQuad(m, vec2(0.08, 0.26), vec2(0.26, 0.38), vec2(0.26, 0.43), vec2(0.08, 0.42));
    fins = sdSegment(m, vec2(0.08, 0.22), vec2(0.15, 0.4)) - 0.016;
    canopy = sdSegment(p, vec2(0.0, -0.38), vec2(0.0, -0.16)) - 0.05;
    nozzleAt = vec2(0.0, 0.42);
    nozzleCount = 1.0;
    trailStart = 0.42;
    tipPaint = vec2(0.26, 0.38);
    bandY = vec2(0.02, 0.12);
    skin = vec3(0.5, 0.53, 0.57);
  } else if (model == 2) {
    // B-2: a low hump from nose to centre, one broad delta from the nose to
    // the wing tips with a W trailing edge, no tail planes, buried nozzles.
    float along = clamp((p.y + 0.5) / 0.7, 0.0, 1.0);
    float humpRadius = mix(0.035, 0.07, smoothstep(0.0, 0.5, along))
                     * mix(1.0, 0.75, smoothstep(0.75, 1.0, along));
    fuselage = sdSegment(p, vec2(0.0, -0.5), vec2(0.0, 0.2)) - humpRadius;
    wing = min(sdTriangle(m, vec2(0.0, -0.5), vec2(0.66, 0.3), vec2(0.36, 0.1)),
               sdTriangle(m, vec2(0.0, -0.5), vec2(0.36, 0.1), vec2(0.0, 0.3)));
    engines = sdSegment(m, vec2(0.15, 0.02), vec2(0.15, 0.2)) - 0.045;
    canopy = sdSegment(p, vec2(0.0, -0.36), vec2(0.0, -0.24)) - 0.035;
    nozzleAt = vec2(0.15, 0.24);
    trailStart = 0.32;
    tipPaint = vec2(0.44, 0.62);
    bandY = vec2(0.0, 0.1);
    skin = vec3(0.36, 0.38, 0.42);
  } else if (model == 3) {
    // F-22: wide chined body, diamond wing, twin canted tails, two nozzles.
    fuselage = sdFuselage(p, -0.56, 0.4, 0.03, 0.11, 0.45, 0.2);
    wing = sdQuad(m, vec2(0.09, -0.1), vec2(0.46, 0.16), vec2(0.4, 0.26), vec2(0.09, 0.3));
    tailPlane = sdQuad(m, vec2(0.08, 0.3), vec2(0.28, 0.4), vec2(0.24, 0.46), vec2(0.08, 0.44));
    fins = sdSegment(m, vec2(0.1, 0.2), vec2(0.19, 0.4)) - 0.016;
    canopy = sdSegment(p, vec2(0.0, -0.4), vec2(0.0, -0.18)) - 0.045;
    nozzleAt = vec2(0.055, 0.43);
    trailStart = 0.44;
    tipPaint = vec2(0.3, 0.44);
    bandY = vec2(0.0, 0.1);
    skin = vec3(0.6, 0.63, 0.67);
  } else if (model == 4) {
    // KAAN: long nose, broad stealth body, trapezoid wing, twin canted tails.
    fuselage = sdFuselage(p, -0.6, 0.38, 0.025, 0.1, 0.5, 0.2);
    wing = sdQuad(m, vec2(0.09, -0.02), vec2(0.48, 0.2), vec2(0.42, 0.28), vec2(0.09, 0.3));
    tailPlane = sdQuad(m, vec2(0.08, 0.3), vec2(0.26, 0.42), vec2(0.22, 0.46), vec2(0.08, 0.44));
    fins = sdSegment(m, vec2(0.09, 0.18), vec2(0.17, 0.38)) - 0.016;
    canopy = sdSegment(p, vec2(0.0, -0.44), vec2(0.0, -0.22)) - 0.042;
    nozzleAt = vec2(0.05, 0.41);
    trailStart = 0.42;
    tipPaint = vec2(0.32, 0.46);
    bandY = vec2(-0.08, 0.02);
    skin = vec3(0.48, 0.53, 0.55);
  } else if (model == 5) {
    // Typhoon: slender body, pure delta wing, canards, twin close nozzles.
    fuselage = sdFuselage(p, -0.58, 0.42, 0.025, 0.075, 0.35, 0.2);
    wing = sdQuad(m, vec2(0.04, -0.02), vec2(0.44, 0.34), vec2(0.44, 0.38), vec2(0.04, 0.38));
    canards = sdTriangle(m, vec2(0.05, -0.32), vec2(0.18, -0.26), vec2(0.05, -0.22));
    fins = sdSegment(p, vec2(0.0, 0.14), vec2(0.0, 0.4)) - 0.012;
    canopy = sdSegment(p, vec2(0.0, -0.42), vec2(0.0, -0.24)) - 0.036;
    nozzleAt = vec2(0.04, 0.44);
    trailStart = 0.45;
    tipPaint = vec2(0.28, 0.42);
    bandY = vec2(0.02, 0.12);
    skin = vec3(0.72, 0.74, 0.78);
  } else if (model == 6) {
    // A-10: long gun nose, straight wings, engine pods high on the aft body,
    // rectangular tailplane with fins at its tips.
    fuselage = sdFuselage(p, -0.54, 0.46, 0.035, 0.075, 0.2, 0.25);
    wing = sdQuad(m, vec2(0.05, -0.08), vec2(0.5, -0.06), vec2(0.5, 0.06), vec2(0.05, 0.1));
    tailPlane = sdBox(m, vec2(0.14, 0.42), vec2(0.14, 0.03));
    fins = sdSegment(m, vec2(0.27, 0.36), vec2(0.27, 0.47)) - 0.02;
    engines = sdSegment(m, vec2(0.11, 0.16), vec2(0.11, 0.3)) - 0.05;
    canopy = sdSegment(p, vec2(0.0, -0.34), vec2(0.0, -0.18)) - 0.04;
    nozzleAt = vec2(0.11, 0.33);
    trailStart = 0.48;
    tipPaint = vec2(0.36, 0.5);
    bandY = vec2(0.18, 0.28);
    skin = vec3(0.5, 0.55, 0.5);
  } else {
    // B-52: very long body, long swept wings with four pods a side, swept
    // tailplane and a tall fin.
    fuselage = sdFuselage(p, -0.66, 0.6, 0.04, 0.07, 0.15, 0.2);
    wing = sdQuad(m, vec2(0.05, -0.22), vec2(0.62, 0.22), vec2(0.62, 0.28), vec2(0.05, 0.0));
    tailPlane = sdQuad(m, vec2(0.04, 0.44), vec2(0.28, 0.56), vec2(0.28, 0.6), vec2(0.04, 0.58));
    fins = sdSegment(p, vec2(0.0, 0.34), vec2(0.0, 0.58)) - 0.012;
    float pods = 1.0;
    for (int i = 0; i < 4; i++) {
      float t = 0.2 + float(i) * 0.19;
      vec2 c = vec2(mix(0.08, 0.56, t), mix(-0.16, 0.2, t));
      pods = min(pods, sdBox(m, c, vec2(0.03, 0.06)));
    }
    engines = pods;
    canopy = sdSegment(p, vec2(0.0, -0.56), vec2(0.0, -0.46)) - 0.035;
    nozzleAt = vec2(0.32, 0.12);
    trailStart = 0.62;
    tipPaint = vec2(0.46, 0.62);
    bandY = vec2(-0.1, 0.0);
    skin = vec3(0.42, 0.45, 0.5);
  }
  float body = min(min(fuselage, wing), min(min(tailPlane, engines), min(fins, canards)));

  float aa = max(fwidth(body), 0.004);
  float bodyMask = 1.0 - smoothstep(0.0, aa, body);
  float outlineWidth = aa * 1.6;
  float outline = 1.0 - smoothstep(outlineWidth, outlineWidth + aa, body);

  // --- Effects behind the aircraft ------------------------------------------
  // Afterburner / exhaust: hot cones just behind the nozzles, pulsing slightly.
  float pulse = 0.85 + 0.15 * sin(uTime * 23.0 + vHash * 6.2831853);
  vec2 nozzle = vec2(nozzleCount > 1.5 ? m.x - nozzleAt.x : p.x, p.y - nozzleAt.y);
  float burner = exp(-dot(nozzle * vec2(14.0, 6.0), nozzle * vec2(14.0, 6.0))) * pulse;
  // Contrail: a soft ribbon that widens and thins behind the tail.
  float trailT = clamp((p.y - trailStart - 0.04) / 0.5, 0.0, 1.0);
  float trailWidth = 0.05 + 0.12 * trailT;
  float trailWobble = 0.02 * sin(p.y * 18.0 + uTime * 6.0 + vHash * 9.0);
  float trail = (1.0 - smoothstep(0.0, trailWidth, abs(p.x - trailWobble)))
              * smoothstep(0.0, 0.12, p.y - trailStart)
              * (1.0 - trailT) * 0.42;

  // --- Colour ---------------------------------------------------------------
  vec3 ownerColor;
  if (uAltView != 0) {
    ownerColor = texelFetch(uAffiliation, ivec2(int(vOwnerID), 1), 0).rgb;
    if (bodyMask < 0.01 && outline < 0.01) discard;
    fragColor = vec4(ownerColor, max(bodyMask, outline * 0.9));
    return;
  }
  float u = (vOwnerID + 0.5) / float(PALETTE_SIZE);
  ownerColor = texture(uPalette, vec2(u, 0.25)).rgb;

  // Airframe lit from the nose-left, with a bright spine.
  float lighting = 0.82 + 0.18 * clamp(-p.y * 0.8 - p.x * 0.4, -1.0, 1.0);
  vec3 airframe = skin * lighting;
  float spine = (1.0 - smoothstep(0.0, 0.03, abs(p.x))) * step(-0.5, p.y) * step(p.y, 0.3);
  airframe += spine * 0.12;
  // Canopy: a darker teardrop a third of the way back.
  airframe = mix(airframe, vec3(0.16, 0.22, 0.3), 1.0 - smoothstep(0.0, aa, canopy));
  // Engine pods and fins read slightly darker than the skin.
  airframe = mix(airframe, skin * 0.78, (1.0 - smoothstep(0.0, aa, engines)) * (flyingWing ? 0.0 : 1.0));
  airframe = mix(airframe, skin * 0.7, 1.0 - smoothstep(0.0, aa, fins));
  // Owner paint: wing tips, tail planes and a fuselage band.
  float wingTip = smoothstep(tipPaint.x, tipPaint.y, m.x) * (1.0 - smoothstep(0.0, aa, wing));
  float tailPaint = 1.0 - smoothstep(0.0, aa, min(tailPlane, canards));
  float band = (1.0 - smoothstep(0.0, aa, fuselage)) * step(bandY.x, p.y) * step(p.y, bandY.y);
  float paint = clamp(wingTip + tailPaint + band, 0.0, 1.0);
  vec3 color = mix(airframe, mix(ownerColor, vec3(1.0), 0.12), paint * 0.9);
  // Dark nozzles.
  vec2 nozzleP = nozzleCount > 1.5 ? m : p;
  float nozzleDark = 1.0 - smoothstep(0.0, aa,
      sdSegment(nozzleP, vec2(nozzleAt.x, nozzleAt.y - 0.05), vec2(nozzleAt.x, nozzleAt.y - 0.01)) - 0.03);
  color = mix(color, vec3(0.12, 0.12, 0.13), nozzleDark);

  vec3 outlineColor = vec3(0.07, 0.09, 0.11);
  vec3 burnerColor = vec3(1.0, 0.7, 0.3);

  float alpha = max(bodyMask, outline);
  vec3 rgb = mix(outlineColor, color, bodyMask);
  // Composite effects underneath the airframe.
  float fxAlpha = max(burner * 0.9, trail);
  vec3 fxColor = mix(vec3(0.92, 0.95, 1.0), burnerColor, clamp(burner * 2.0, 0.0, 1.0));
  rgb = mix(fxColor, rgb, alpha);
  alpha = max(alpha, fxAlpha);
  if (alpha < 0.01) discard;
  fragColor = vec4(rgb, alpha);
}
