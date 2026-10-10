#version 300 es
precision highp float;

// Procedural aircraft silhouette — shares the unit-pass instance layout so the
// air layer keeps its smoothing and ordering, but draws a resolution-independent
// jet with a continuous heading instead of an 8-octant sprite.

layout(location = 0) in vec2 aPos;
layout(location = 1) in vec3 aInstPos;   // x, y, ownerID
layout(location = 2) in vec4 aInstFlags; // atlasIdx, flags (bits 4–6 = airframe), hash, heading byte (0..255 → 0..2π)

uniform mat3  uCamera;
uniform float uUnitSize;

out vec2  vLocal;        // aircraft-local coords in [-1,1]; nose points -Y
flat out float vOwnerID;
flat out float vHash;
flat out float vModel;   // airframe index 0–7, see aircraftModelIndex

void main() {
  vOwnerID = aInstPos.z;
  vHash = aInstFlags.z * (1.0 / 255.0);
  vModel = floor(aInstFlags.y / 16.0);

  // Heading is clockwise from north on screen (world +Y is down), matching
  // the sprite octant convention but with 256 steps.
  float heading = aInstFlags.w * (6.2831853 / 256.0);
  float c = cos(heading);
  float s = sin(heading);
  mat2 rotation = mat2(c, s, -s, c);

  vec2 local = (aPos - 0.5) * 2.0;
  vLocal = local;

  float halfSize = uUnitSize * 0.5 * AIRCRAFT_SCALE;
  vec2 center = vec2(aInstPos.x + 0.5, aInstPos.y + 0.5);
  vec2 worldPos = center + (rotation * local) * halfSize;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
