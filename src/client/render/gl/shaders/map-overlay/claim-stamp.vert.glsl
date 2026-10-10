#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;    // tile coord (integer in [0, mapW) × [0, mapH))
layout(location = 1) in float aStamp; // 24-bit capture stamp (exact in float32)

uniform vec2 uMapSize;

flat out vec3 vStampBytes;

void main() {
  // Position the point at the center of the target pixel so a 1×1 point
  // rasterizes into exactly that texel.
  vec2 ndc = ((aPos + 0.5) / uMapSize) * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);
  gl_PointSize = 1.0;
  float s = aStamp;
  float r = floor(s / 65536.0);
  float g = floor((s - r * 65536.0) / 256.0);
  float b = s - r * 65536.0 - g * 256.0;
  vStampBytes = vec3(r, g, b) / 255.0;
}
