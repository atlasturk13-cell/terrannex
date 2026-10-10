#version 300 es
precision highp float;

// Unit quad [0,1]
layout(location = 0) in vec2 aPos;
// Per-instance: x, y, radius, ownerID
layout(location = 1) in vec4 aInstance;

uniform mat3 uCamera;

out vec2 vWorld;          // world (tile) coordinates of this fragment
flat out vec2 vCenter;    // footprint centre in world coordinates
flat out float vRadius;   // footprint radius in tiles
flat out float vOwnerID;

void main() {
  vRadius = aInstance.z;
  vOwnerID = aInstance.w;
  vCenter = aInstance.xy + 0.5;

  // Cover the footprint disc plus a one-tile margin for the soft edge.
  vec2 local = aPos * 2.0 - 1.0;
  vWorld = vCenter + local * (vRadius + 1.0);

  vec3 clip = uCamera * vec3(vWorld, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
