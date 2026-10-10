#version 300 es
precision highp float;

flat in vec3 vStampBytes;

// RGBA8 color attachment: the 24-bit stamp lives in RGB, alpha is unused.
layout(location = 0) out vec4 fragColor;

void main() {
  fragColor = vec4(vStampBytes, 1.0);
}
