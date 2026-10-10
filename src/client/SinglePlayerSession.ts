import { GameMapType, GameType } from "../core/game/Game";
import {
  isLocalProvenanceSafeMap,
  LOCAL_PROVENANCE_SAFE_MAPS,
} from "../core/game/LocalProvenanceSafeMaps";
import {
  ClientID,
  GameConfig,
  GameID,
  LocalSkirmishProfile,
} from "../core/Schemas";
import { generateID } from "../core/Util";

export const LOCAL_SKIRMISH_GAME_ID: GameID = "LocalBox";
export const LOCAL_NATURAL_EARTH_GAME_ID: GameID = "LocalNE1";
export const LOCAL_SKIRMISH_CLIENT_ID: ClientID = "LocalP01";
export const LOCAL_ALLOWED_MAPS = LOCAL_PROVENANCE_SAFE_MAPS;

export interface SinglePlayerSession {
  gameID: GameID;
  clientID: ClientID;
  config: GameConfig;
}

/**
 * Resolves the identity and settings for one single-player session. Localhost
 * games deliberately reuse a map-specific seed and one player identity so
 * identical ordered inputs can be replayed exactly. Normal single-player games
 * retain their existing fresh-ID behavior.
 */
export function createSinglePlayerSession(
  config: GameConfig,
  localOnly: boolean,
  generateId: () => GameID = generateID,
): SinglePlayerSession {
  const depthProgressionAllowed =
    localOnly &&
    config.gameType === GameType.Singleplayer &&
    isLocalProvenanceSafeMap(config.gameMap);
  const airSuperiorityAllowed =
    localOnly &&
    config.gameType === GameType.Singleplayer &&
    isLocalProvenanceSafeMap(config.gameMap);
  const airportOperationsAllowed =
    airSuperiorityAllowed &&
    config.combinedArmsV1 === true &&
    config.combinedArmsV2 === true &&
    config.airSuperiorityV1 === true;

  if (localOnly) {
    if (!isLocalProvenanceSafeMap(config.gameMap)) {
      throw new Error(
        `Map ${config.gameMap} is not available in local-only mode`,
      );
    }

    const localConfig = { ...config };
    if (!depthProgressionAllowed) delete localConfig.depthProgression;
    if (!airSuperiorityAllowed) delete localConfig.airSuperiorityV1;
    if (!airportOperationsAllowed) delete localConfig.airportOperationsV1;

    if (config.gameMap === GameMapType.TheBox) {
      return {
        gameID: LOCAL_SKIRMISH_GAME_ID,
        clientID: LOCAL_SKIRMISH_CLIENT_ID,
        config: {
          ...localConfig,
          localSkirmishProfile: LocalSkirmishProfile.TheBox,
        },
      };
    }

    // A caller may reuse a config object after selecting The Box. The private
    // wilderness profile is map-specific and must never leak into the World map.
    const worldConfig = localConfig;
    delete worldConfig.localSkirmishProfile;
    return {
      gameID: LOCAL_NATURAL_EARTH_GAME_ID,
      clientID: LOCAL_SKIRMISH_CLIENT_ID,
      config: worldConfig,
    };
  }

  // Preserve the historical generation order from SinglePlayerModal.
  const clientID = generateId();
  const gameID = generateId();
  // Preserve the historical object/value behavior for missing and false. A
  // config object may have been reused from a local setup, so clone only when
  // the enabled local-only flag must be removed.
  if (
    config.depthProgression === true ||
    config.airSuperiorityV1 === true ||
    config.airportOperationsV1 === true
  ) {
    const remoteConfig = { ...config };
    delete remoteConfig.depthProgression;
    delete remoteConfig.airSuperiorityV1;
    delete remoteConfig.airportOperationsV1;
    return { gameID, clientID, config: remoteConfig };
  }
  return { gameID, clientID, config };
}
