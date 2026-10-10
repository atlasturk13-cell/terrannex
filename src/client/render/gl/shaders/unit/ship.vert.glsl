#version 300 es
precision highp float;

// Procedural ship silhouette — shares the unit-pass instance layout (same
// buffers and VAO shape as the sprite and aircraft paths) but draws a
// resolution-independent hull with a continuous heading, a per-hull-class
// size and a wake, instead of a 13-pixel atlas cell.

layout(location = 0) in vec2 aPos;
layout(location = 1) in vec3 aInstPos;   // x, y, ownerID
layout(location = 2) in vec4 aInstFlags; // atlasIdx, flags (bits 0–3 state, 4–5 hull class, 6 under way), hash, heading byte (0..255 → 0..2π)

uniform mat3  uCamera;
uniform float uUnitSize;

out vec2  vLocal;         // ship-local coords in [-1,1]; the bow points -Y
flat out float vOwnerID;
flat out float vHash;
flat out float vState;    // low nibble of the flags byte (FLAG_* values)
flat out float vHull;     // 0 = transport, 1 = trade ship, 2 = warship
flat out float vUnderWay; // 1 while the ship moved this tick (draws the wake)

void main() {
  vOwnerID = aInstPos.z;
  vHash = aInstFlags.z * (1.0 / 255.0);
  float flags = aInstFlags.y;
  float upper = floor(flags / 16.0);
  vState = flags - upper * 16.0;
  vHull = mod(upper, 4.0);
  vUnderWay = mod(floor(upper / 4.0), 2.0);

  // Heading is clockwise from north on screen (world +Y is down), the same
  // 256-step convention as the aircraft layer.
  float heading = aInstFlags.w * (6.2831853 / 256.0);
  float c = cos(heading);
  float s = sin(heading);
  mat2 rotation = mat2(c, s, -s, c);

  vec2 local = (aPos - 0.5) * 2.0;
  vLocal = local;

  // The three hull classes share one quad shape; the smaller hulls scale the
  // quad down so their outline width and wake stay proportional.
  float hullScale = vHull > 1.5 ? 1.0 : (vHull > 0.5 ? 0.85 : 0.75);
  float halfSize = uUnitSize * 0.5 * SHIP_SCALE * hullScale;
  vec2 center = vec2(aInstPos.x + 0.5, aInstPos.y + 0.5);
  vec2 worldPos = center + (rotation * local) * halfSize;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
