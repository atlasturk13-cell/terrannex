#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;

// Per-instance attributes
layout(location = 1) in vec3 aInstPos;   // x, y, ownerID
layout(location = 2) in vec4 aInstFlags; // atlasIdx, flags, flickerHash, headingOctant (uint8→float)

uniform mat3  uCamera;

uniform float uUnitSize;
uniform float uHBombGlowScale; // quad enlargement for the hydrogen bomb glow halo

out vec2  vQuadPos;     // quad coords [0,1] — drives the radial glow falloff
out vec2  vCellUV;      // sprite cell coords; the central 1/scale region is the sprite
flat out float vAtlasCol;
flat out float vOwnerID;
flat out float vFlags;  // 0.0 = normal, 1.0 = flicker, 2.0 = angry
flat out float vHash;   // per-instance hash for flicker phase offset
flat out float vGlow;   // 1.0 if this instance is a hydrogen bomb (draw glow), else 0.0

void main() {
  float worldX = aInstPos.x;
  float worldY = aInstPos.y;
  vOwnerID = aInstPos.z;

  float atlasCol = aInstFlags.x;
  vFlags = aInstFlags.y;
  vAtlasCol = atlasCol;

  // Per-instance hash so each unit flickers independently. Computed CPU-side
  // from the tick position — hashing worldX/Y here would re-roll the phase
  // every frame for nukes whose position is smoothed per frame.
  vHash = aInstFlags.z * (1.0 / 255.0);

  // Hydrogen bombs enlarge only their glow quad. Fighters enlarge their actual
  // silhouette so the rare air unit stays readable at strategic-map scale.
  float isHBomb = step(abs(atlasCol - float(HYDROGEN_BOMB_COL)), 0.5);
  float isFighter = step(abs(atlasCol - float(FIGHTER_JET_COL)), 0.5);
  vGlow = isHBomb;
  float hBombQuadScale = mix(1.0, uHBombGlowScale, isHBomb);
  float fighterScale = mix(1.0, FIGHTER_JET_SCALE, isFighter);
  float worldScale = hBombQuadScale * fighterScale;

  // UNIT_SIZE is in world-space tiles — no zoom division needed.
  // Units scale with the map like territory tiles do.
  float halfSize = uUnitSize * 0.5 * worldScale;

  vec2 center = vec2(worldX + 0.5, worldY + 0.5);
  vec2 localPos = aPos - 0.5;
  float heading = aInstFlags.w * 0.7853981633974483; // octant × pi/4
  float headingSin = sin(heading);
  float headingCos = cos(heading);
  mat2 headingRotation = mat2(
    headingCos,
    headingSin,
    -headingSin,
    headingCos
  );
  localPos = mix(localPos, headingRotation * localPos, isFighter);
  vec2 worldPos = center + localPos * halfSize * 2.0;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);

  vQuadPos = aPos;

  // Only the hydrogen-bomb quad needs glow-only margin. Fighter scaling keeps
  // the full texture cell so the aircraft itself becomes 1.3× larger.
  vCellUV = (aPos - 0.5) * hBombQuadScale + 0.5;
}
