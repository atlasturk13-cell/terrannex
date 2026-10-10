import { GameMapType } from "./Maps.gen.js";

/**
 * Maps whose source provenance and generated artifacts are admitted by the
 * local release profile. Keep every local feature gate on this registry.
 */
export const LOCAL_PROVENANCE_SAFE_MAPS = [
  GameMapType.NaturalEarthWorld,
  GameMapType.TheBox,
  GameMapType.EuropeMediterranean,
  GameMapType.NorthAmericaCaribbean,
  GameMapType.NaturalEarthSouthAmerica,
  GameMapType.AfricaMiddleEast,
  GameMapType.AsiaPacific,
] as const;

export const LOCAL_PROVENANCE_SAFE_MAP_ASSET_DIRECTORIES = [
  "naturalearthworld",
  "thebox",
  "europemediterranean",
  "northamericacaribbean",
  "naturalearthsouthamerica",
  "africamiddleeast",
  "asiapacific",
] as const;

const localProvenanceSafeMapSet = new Set<GameMapType>(
  LOCAL_PROVENANCE_SAFE_MAPS,
);

export function isLocalProvenanceSafeMap(map: GameMapType): boolean {
  return localProvenanceSafeMapSet.has(map);
}
