import { GameMapSize, GameMode, HumansVsNations } from "../core/game/Game";
import { generateUniqueNationName } from "../core/game/NationCreation";
import {
  playerStyleNames,
  usesPlayerStyleNames,
} from "../core/game/PlayerStyleNames";
import { PseudoRandom } from "../core/PseudoRandom";
import type { GameConfig, GameID } from "../core/Schemas";
import { simpleHash } from "../core/Util";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";

/**
 * AI commanders shown in a public lobby. They are the nations that play the
 * match (`createNationsForGame`), revealed over the last
 * `AI_JOIN_WINDOW_MS` of the countdown so a fresh lobby fills up the way a
 * busy one does. Every client derives the same roster from the game id, so
 * two players looking at one lobby see the same names arrive.
 */
export const AI_JOIN_WINDOW_MS = 30_000;
/** Share of the roster already present when a lobby opens. */
export const AI_INITIAL_SHARE = 0.3;

export interface AiRosterEntry {
  name: string;
  /** Milliseconds before the start at which this commander joins. */
  joinsBeforeStartMs: number;
}

/**
 * How many nations the match will spawn — mirrors `createNationsForGame`.
 * HumansVsNations matches the human count, so it follows the lobby.
 */
export function aiCommanderTotal(
  config: GameConfig | undefined,
  manifestNationCount: number,
  humans: number,
): number {
  if (config === undefined) return 0;
  const nations = config.nations;
  if (nations === "disabled") return 0;
  if (typeof nations === "number") return nations;
  if (
    config.gameMode === GameMode.Team &&
    config.playerTeams === HumansVsNations
  ) {
    return Math.max(1, humans);
  }
  if (manifestNationCount === 0) return 0;
  if (config.gameMapSize === GameMapSize.Compact) {
    return Math.max(1, Math.floor(manifestNationCount * 0.25));
  }
  return manifestNationCount;
}

/**
 * The roster in joining order. Lobbies whose match uses player-style
 * nicknames (`usesPlayerStyleNames`) show exactly those names; otherwise the
 * map's nations, shuffled by the game id, then generated names.
 */
export function aiRoster(
  gameID: GameID,
  nationNames: readonly string[],
  total: number,
  config?: GameConfig,
): AiRosterEntry[] {
  if (total <= 0) return [];
  const random = new PseudoRandom(simpleHash(`ai-roster:${gameID}`));
  const names =
    config !== undefined && usesPlayerStyleNames(config)
      ? random.shuffleArray(playerStyleNames(gameID, total))
      : random.shuffleArray([...nationNames]).slice(0, total);
  // Beyond the map's nations the match generates names; so does the lobby.
  const used = new Set(names);
  while (names.length < total) {
    const name = generateUniqueNationName(random, used);
    used.add(name);
    names.push(name);
  }
  const initial = Math.ceil(total * AI_INITIAL_SHARE);
  const entries = names.map((name, i) => ({
    name,
    joinsBeforeStartMs:
      i < initial
        ? AI_JOIN_WINDOW_MS
        : // Arrivals spread over the window; the last few seconds stay
          // quiet so the full roster is visible before the match starts.
          Math.floor(random.nextFloat(0.08, 0.98) * AI_JOIN_WINDOW_MS),
  }));
  return entries.sort((a, b) => b.joinsBeforeStartMs - a.joinsBeforeStartMs);
}

/**
 * Commanders present `msUntilStart` before the start. A lobby without a
 * countdown yet (queued behind the current one) shows the initial share.
 */
export function aiCommandersPresent(
  roster: readonly AiRosterEntry[],
  msUntilStart: number | null,
): AiRosterEntry[] {
  const remaining =
    msUntilStart === null ? AI_JOIN_WINDOW_MS : Math.max(0, msUntilStart);
  return roster.filter((entry) => entry.joinsBeforeStartMs >= remaining);
}

const nationNamesByMap = new Map<string, Promise<string[]>>();

/** The map manifest's nation names (cached; empty when it cannot load). */
export function loadNationNames(map: GameConfig["gameMap"]): Promise<string[]> {
  let names = nationNamesByMap.get(map);
  if (names === undefined) {
    names = terrainMapFileLoader
      .getMapData(map)
      .manifest()
      .then((manifest) => manifest.nations.map((n) => n.name))
      .catch(() => {
        nationNamesByMap.delete(map);
        return [];
      });
    nationNamesByMap.set(map, names);
  }
  return names;
}
