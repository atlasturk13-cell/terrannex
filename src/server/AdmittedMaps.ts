import { GameMapType } from "../core/game/Game";
import { isLocalProvenanceSafeMap } from "../core/game/LocalProvenanceSafeMaps";
import { ServerEnv } from "./ServerEnv";

/**
 * Maps this server may host. The self-contained profile ships only the
 * provenance-safe registry (its images do not even contain the others), so
 * every server-side game source — public scheduling, private lobbies and
 * lobby config updates — fails closed on anything else.
 */
export function isAdmittedServerMap(map: GameMapType): boolean {
  return !ServerEnv.isLocalOnly() || isLocalProvenanceSafeMap(map);
}
