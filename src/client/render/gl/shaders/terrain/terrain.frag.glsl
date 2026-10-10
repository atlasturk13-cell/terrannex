#version 300 es
precision highp float;

// Terrain. On the Natural Earth maps the colour is real satellite imagery
// (NASA Blue Marble, baked per map and conformed to the playable coastline;
// see SatelliteTerrain.ts): an always-resident overview plus streamed detail
// tiles once the camera is close. Everywhere else — other maps, the Classic
// style, and tiles whose land bit a water nuke has changed since the picture
// was made — the procedural look below is used: it derives every visual
// feature deterministically from the land/water, shoreline and 5-bit
// magnitude bits plus world-space value noise (no time uniform).
//
// Ownership fills and borders are separate passes drawn above this one; they
// stay tile-exact while the terrain itself uses bilinear alpha filtering to
// round the coastline and smooth bathymetry.

uniform sampler2D uTerrain;

uniform int uSatEnabled;
uniform sampler2D uSatOverview;
uniform mediump sampler2DArray uSatDetail;
// Detail slot + 1 per detail tile (0 = not resident).
uniform mediump usampler2D uSatLookup;
// Land bit (0/1) of the terrain the imagery was conformed to.
uniform mediump usampler2D uInitialLand;
uniform float uSatDetailMix;
uniform vec2 uSatGrid;
uniform vec2 uSatTileUV;

in vec2 vUV;
out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float terrainNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(cell), hash21(cell + vec2(1.0, 0.0)), f.x),
    mix(
      hash21(cell + vec2(0.0, 1.0)),
      hash21(cell + vec2(1.0, 1.0)),
      f.x
    ),
    f.y
  );
}

// Ridged multi-octave noise: the crumpled, eroded look of real relief.
float ridgedNoise(vec2 p) {
  float sum = 0.0;
  float amplitude = 0.5;
  float total = 0.0;
  for (int octave = 0; octave < 3; octave++) {
    float n = terrainNoise(p);
    sum += (1.0 - abs(n * 2.0 - 1.0)) * amplitude;
    total += amplitude;
    p = p * 2.03 + vec2(17.0, 31.0);
    amplitude *= 0.5;
  }
  return sum / total;
}

uint terrainByteAt(ivec2 cell) {
  ivec2 clampedCell = clamp(
    cell,
    ivec2(0),
    ivec2(MAP_W - 1, MAP_H - 1)
  );
  // Alpha carries an exact copy of the terrain byte. texelFetch bypasses the
  // texture's linear colour filtering so bit flags remain authoritative.
  return uint(floor(texelFetch(uTerrain, clampedCell, 0).a * 255.0 + 0.5));
}

float renderableLand(uint terrainByte) {
  bool land = (terrainByte & 0x80u) != 0u;
  bool impassable = land && (terrainByte & 0x1fu) == 0x1fu;
  return land && !impassable ? 1.0 : 0.0;
}

float terrainHeight(uint terrainByte) {
  return float(terrainByte & 0x1fu) / 30.0;
}

float compatibleLandHeight(uint terrainByte, float fallbackHeight) {
  return renderableLand(terrainByte) > 0.5
    ? terrainHeight(terrainByte)
    : fallbackHeight;
}

// Water magnitude is distance-to-land / 2, so the full 0..31 range is real
// bathymetry: 0 at the beach, 31 in the open ocean.
float compatibleWaterDepth(uint terrainByte, float fallbackDepth) {
  return renderableLand(terrainByte) < 0.5 &&
    !((terrainByte & 0x80u) != 0u && (terrainByte & 0x1fu) == 0x1fu)
    ? clamp(float(terrainByte & 0x1fu) / 30.0, 0.0, 1.0)
    : fallbackDepth;
}

void main() {
  vec2 mapSize = vec2(float(MAP_W), float(MAP_H));
  vec2 worldPos = clamp(vUV * mapSize, vec2(0.0), mapSize - vec2(0.001));
  ivec2 cell = ivec2(floor(worldPos));
  vec2 localPos = fract(worldPos);
  float pixelFootprint = max(
    length(dFdx(worldPos)),
    length(dFdy(worldPos))
  );

  vec4 filteredTerrain = texture(uTerrain, vUV);
  vec3 nearestTerrain = texelFetch(uTerrain, cell, 0).rgb;

  uint centerByte = terrainByteAt(cell);
  uint westByte = terrainByteAt(cell + ivec2(-1, 0));
  uint eastByte = terrainByteAt(cell + ivec2(1, 0));
  uint northByte = terrainByteAt(cell + ivec2(0, -1));
  uint southByte = terrainByteAt(cell + ivec2(0, 1));

  bool isLand = (centerByte & 0x80u) != 0u;
  bool isShoreline = (centerByte & 0x40u) != 0u;
  uint magnitude = centerByte & 0x1fu;
  bool isImpassable = isLand && magnitude == 0x1fu;

  // The impassable mask must remain identical to the clear colour. Skipping
  // every procedural treatment here preserves the non-rectangular map edge.
  if (isImpassable) {
    fragColor = vec4(nearestTerrain, 1.0);
    return;
  }

  if (uSatEnabled == 1) {
    bool pictureLand = texelFetch(uInitialLand, cell, 0).r != 0u;
    if (pictureLand == isLand) {
      vec2 satUV = worldPos / mapSize;
      vec3 satellite = texture(uSatOverview, satUV).rgb;
      if (uSatDetailMix > 0.0) {
        vec2 tilePos = satUV / uSatTileUV;
        ivec2 tile = clamp(
          ivec2(floor(tilePos)),
          ivec2(0),
          ivec2(uSatGrid) - ivec2(1)
        );
        uint slot = texelFetch(uSatLookup, tile, 0).r;
        if (slot > 0u) {
          vec3 detail = texture(
            uSatDetail,
            vec3(fract(tilePos), float(slot - 1u))
          ).rgb;
          satellite = mix(satellite, detail, uSatDetailMix);
        }
      }
      // A faint world-anchored grain only at the closest zooms, so a single
      // texel never reads as a flat smear.
      float closeGrain = terrainNoise(worldPos * 2.3 + vec2(53.0, 211.0));
      float closeVisibility = 1.0 - smoothstep(0.05, 0.35, pixelFootprint);
      satellite *= 1.0 + (closeGrain - 0.5) * 0.06 * closeVisibility;
      fragColor = vec4(clamp(satellite, 0.0, 1.0), 1.0);
      return;
    }
  }

  float landMask = isLand ? 1.0 : 0.0;
  float waterMask = 1.0 - landMask;
  float shorelineMask = isShoreline ? 1.0 : 0.0;
  float elevation = landMask * terrainHeight(centerByte);
  float centerDepth = clamp(float(magnitude) / 30.0, 0.0, 1.0);
  float neighbourDepth = (
    centerDepth * 2.0
    + compatibleWaterDepth(westByte, centerDepth)
    + compatibleWaterDepth(eastByte, centerDepth)
    + compatibleWaterDepth(northByte, centerDepth)
    + compatibleWaterDepth(southByte, centerDepth)
  ) / 6.0;
  // Bilinear bathymetry between the four nearest texel centres turns the
  // integer distance rings into a continuous slope; a little regional noise
  // breaks the remaining diamond contours of the Manhattan distance field.
  vec2 sampleBase = worldPos - 0.5;
  ivec2 c00 = ivec2(floor(sampleBase));
  vec2 sampleWeight = fract(sampleBase);
  float d00 = compatibleWaterDepth(terrainByteAt(c00), centerDepth);
  float d10 = compatibleWaterDepth(terrainByteAt(c00 + ivec2(1, 0)), centerDepth);
  float d01 = compatibleWaterDepth(terrainByteAt(c00 + ivec2(0, 1)), centerDepth);
  float d11 = compatibleWaterDepth(terrainByteAt(c00 + ivec2(1, 1)), centerDepth);
  float bilinearDepth = mix(
    mix(d00, d10, sampleWeight.x),
    mix(d01, d11, sampleWeight.x),
    sampleWeight.y
  );

  float westLand = renderableLand(westByte);
  float eastLand = renderableLand(eastByte);
  float northLand = renderableLand(northByte);
  float southLand = renderableLand(southByte);
  float categoryEdge = max(
    max(abs(landMask - westLand), abs(landMask - eastLand)),
    max(abs(landMask - northLand), abs(landMask - southLand))
  );

  // Smooth coastline. Shoreline land bytes sit at >= 192/255 and shoreline
  // water bytes at 64..95/255, so the bilinear alpha crosses 0.5 halfway
  // between the two texels: a rounded, anti-aliased shore instead of a tile
  // stair, without moving the authoritative land/water boundary.
  float coastAAWidth = clamp(pixelFootprint * 0.08, 0.02, 0.12);
  float landField = smoothstep(
    0.5 - coastAAWidth,
    0.5 + coastAAWidth,
    filteredTerrain.a
  );

  // Quantized map elevation becomes a softly lit relief surface. Neighbours
  // from another category fall back to the centre height, eliminating coast
  // halos while retaining stronger mountain and plateau definition inland.
  float westHeight = compatibleLandHeight(westByte, elevation);
  float eastHeight = compatibleLandHeight(eastByte, elevation);
  float northHeight = compatibleLandHeight(northByte, elevation);
  float southHeight = compatibleLandHeight(southByte, elevation);
  vec2 heightGradient = vec2(
    westHeight - eastHeight,
    northHeight - southHeight
  );
  vec3 reliefNormal = normalize(vec3(heightGradient * 1.8, 0.42));
  vec3 sunDirection = normalize(vec3(-0.48, -0.68, 0.62));
  float flatLight = sunDirection.z;
  float reliefGuard = 1.0 - smoothstep(0.0, 1.0, categoryEdge);
  float relief = clamp(
    (dot(reliefNormal, sunDirection) - flatLight) * 0.34,
    -0.11,
    0.12
  ) * reliefGuard * landMask;

  // Stable world-space detail across four scales. Derivative-based fades turn
  // off frequencies smaller than a screen pixel, keeping distant views calm
  // and avoiding shimmer during pan/zoom without any time-driven noise.
  float regional = terrainNoise(worldPos * 0.0065 + vec2(19.0, 43.0));
  float macroDetail = terrainNoise(worldPos * 0.021 + vec2(71.0, 13.0));
  float mesoDetail = terrainNoise(worldPos * 0.073 + vec2(7.0, 97.0));
  float fineDetail = terrainNoise(worldPos * 0.14 + vec2(131.0, 29.0));
  float grain = terrainNoise(worldPos * 0.31 + vec2(53.0, 211.0));
  float mesoVisibility = 1.0 - smoothstep(1.4, 4.2, pixelFootprint);
  float fineVisibility = 1.0 - smoothstep(0.7, 2.8, pixelFootprint);
  float grainVisibility = 1.0 - smoothstep(0.3, 1.2, pixelFootprint);
  float depth = waterMask * clamp(
    mix(neighbourDepth, bilinearDepth, 0.65)
      + (macroDetail - 0.5) * 0.06
      + (regional - 0.5) * 0.04,
    0.0,
    1.0
  );
  float surfaceDetail = (regional - 0.5) * 0.07
                      + (macroDetail - 0.5) * 0.1
                      + (mesoDetail - 0.5) * 0.14 * mesoVisibility
                      + (fineDetail - 0.5) * 0.09 * fineVisibility
                      + (grain - 0.5) * 0.06 * grainVisibility;

  // Climate and elevation bands. The generated maps carry flat land heights,
  // so ruggedness comes from ridged noise weighted toward dry subtropics and
  // the polar margins where real relief is most visible from orbit.
  float moisture = regional * 0.68 + macroDetail * 0.32;
  float absoluteLatitude = abs(worldPos.y / mapSize.y - 0.5) * 2.0;
  float subtropicalBand = smoothstep(0.15, 0.27, absoluteLatitude)
                        * (1.0 - smoothstep(0.46, 0.6, absoluteLatitude));
  float aridity = subtropicalBand * (1.0 - moisture * 0.68);
  float tropicalMoisture = (1.0 - smoothstep(0.17, 0.34, absoluteLatitude))
                         * smoothstep(0.38, 0.72, moisture);
  float polarClimate = smoothstep(0.68, 0.94, absoluteLatitude);
  float lowland = 1.0 - smoothstep(0.25, 0.58, elevation);
  float highland = smoothstep(0.28, 0.72, elevation);
  float alpine = smoothstep(0.7, 0.96, elevation);
  float proceduralRuggedness = smoothstep(0.5, 0.86, regional)
                              * (0.5 + subtropicalBand * 0.5);
  float reliefEast = ridgedNoise(
    (worldPos + vec2(2.0, 0.0)) * 0.03 + vec2(71.0, 13.0)
  );
  float reliefSouth = ridgedNoise(
    (worldPos + vec2(0.0, 2.0)) * 0.03 + vec2(71.0, 13.0)
  );
  float reliefHere = ridgedNoise(worldPos * 0.03 + vec2(71.0, 13.0));
  vec2 proceduralGradient = vec2(
    reliefHere - reliefEast,
    reliefHere - reliefSouth
  );
  vec3 proceduralNormal = normalize(vec3(proceduralGradient * 6.5, 0.5));
  float proceduralRelief = clamp(
    (dot(proceduralNormal, sunDirection) - sunDirection.z) * 0.26,
    -0.1,
    0.12
  ) * (0.35 + proceduralRuggedness * 0.65) * mesoVisibility;
  float ridge = reliefHere * max(highland, proceduralRuggedness * 0.6);
  float fieldPatches = (smoothstep(0.3, 0.7, mesoDetail) - 0.5)
                     * lowland * mesoVisibility;
  float settlementFlecks = smoothstep(0.84, 0.95, fineDetail)
                          * (1.0 - aridity * 0.7)
                          * (1.0 - polarClimate)
                          * fineVisibility;

  // Land palette from orbit: sand and ochre where it is dry, olive steppe,
  // green farmland and dark forest where it is wet, bare rock on ridges and
  // snow above the tree line or near the poles.
  float wetness = clamp(
    moisture * 0.8 + tropicalMoisture * 0.45 - aridity * 0.6,
    0.0,
    1.0
  );
  vec3 aridColor = vec3(0.62, 0.55, 0.39);
  vec3 steppeColor = vec3(0.5, 0.48, 0.31);
  vec3 grassColor = vec3(0.37, 0.45, 0.24);
  vec3 forestColor = vec3(0.2, 0.31, 0.16);
  vec3 rockColor = vec3(0.46, 0.43, 0.38);
  vec3 tundraColor = vec3(0.5, 0.49, 0.43);
  vec3 snowColor = vec3(0.86, 0.87, 0.88);
  vec3 sandColor = vec3(0.76, 0.7, 0.53);
  vec3 landColor = mix(aridColor, steppeColor, smoothstep(0.12, 0.4, wetness));
  landColor = mix(landColor, grassColor, smoothstep(0.36, 0.66, wetness));
  landColor = mix(
    landColor,
    forestColor,
    smoothstep(0.6, 0.95, wetness) * (1.0 - polarClimate)
  );
  landColor = mix(landColor, tundraColor, polarClimate * 0.75);
  landColor = mix(landColor, rockColor, max(highland * 0.5, ridge * 0.35));
  landColor = mix(
    landColor,
    snowColor,
    clamp(alpine * 0.85 + polarClimate * polarClimate * 0.7, 0.0, 1.0)
  );
  // Keep a trace of the configurable palette so graphics overrides still tint.
  landColor = mix(landColor, filteredTerrain.rgb, 0.12);
  landColor *= 0.92 + surfaceDetail + relief + proceduralRelief;
  landColor += fieldPatches * vec3(0.03, 0.028, 0.012);
  landColor += settlementFlecks * vec3(0.05, 0.045, 0.04);
  // Beaches: a pale sandy rim on the land side of the shoreline.
  landColor = mix(landColor, sandColor, shorelineMask * lowland * 0.5);

  // Water: navy open ocean, a lighter continental shelf, turquoise shallows
  // over the beach, broad mottling and a bright foam line only where water
  // touches renderable land.
  float waterTexture = (regional - 0.5) * 0.05
                     + (macroDetail - 0.5) * 0.035 * mesoVisibility
                     + (mesoDetail - 0.5) * 0.02 * fineVisibility;
  vec3 shallowColor = vec3(0.2, 0.62, 0.64);
  vec3 shelfColor = vec3(0.08, 0.36, 0.5);
  vec3 deepColor = vec3(0.03, 0.1, 0.23);
  float blendDepth = isLand ? 0.0 : depth;
  vec3 waterColor = mix(shallowColor, shelfColor, smoothstep(0.0, 0.1, blendDepth));
  waterColor = mix(waterColor, deepColor, smoothstep(0.07, 0.45, blendDepth));
  waterColor = mix(waterColor, filteredTerrain.rgb, 0.1 * waterMask);
  waterColor *= 0.96 + waterTexture;
  float caustic = smoothstep(0.5, 0.8, fineDetail)
                * (1.0 - smoothstep(0.0, 0.12, blendDepth)) * fineVisibility;
  waterColor += caustic * vec3(0.03, 0.06, 0.06);

  float coastDistance = 2.0;
  if (westLand > 0.5) coastDistance = min(coastDistance, localPos.x);
  if (eastLand > 0.5) coastDistance = min(coastDistance, 1.0 - localPos.x);
  if (northLand > 0.5) coastDistance = min(coastDistance, localPos.y);
  if (southLand > 0.5) coastDistance = min(coastDistance, 1.0 - localPos.y);
  float coastWidth = 0.06 + min(pixelFootprint * 0.06, 0.1);
  float coastAA = max(0.02, min(pixelFootprint * 0.2, 0.24));
  float coastFoam = (1.0 - smoothstep(
    coastWidth,
    coastWidth + coastAA,
    coastDistance
  )) * waterMask;
  waterColor = mix(waterColor, vec3(0.78, 0.88, 0.86), coastFoam * 0.3);

  vec3 terrainColor = mix(waterColor, landColor, landField);
  fragColor = vec4(clamp(terrainColor, 0.0, 1.0), 1.0);
}
