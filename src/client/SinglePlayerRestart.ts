import type { GameStartInfo } from "../core/Schemas";

/** sessionStorage slot that carries one restart across the page reload. */
export const SINGLE_PLAYER_RESTART_KEY = "openfront.singleplayer.restart";

export interface SinglePlayerStart {
  gameID: string;
  gameStartInfo: GameStartInfo;
  source: "singleplayer";
}

type LobbyStartLike = {
  gameID: string;
  gameStartInfo?: GameStartInfo;
  gameRecord?: unknown;
  source?: string;
};

type RestartStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

let remembered: SinglePlayerStart | null = null;

function defaultStorage(): RestartStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Remembers the exact start of a fresh single-player game (never a replay
 * or a multiplayer lobby) so "play again with the same settings" can repeat
 * it. Joining anything else forgets the previous start.
 */
export function rememberSinglePlayerStart(lobby: LobbyStartLike): void {
  if (
    lobby.source !== "singleplayer" ||
    lobby.gameStartInfo === undefined ||
    lobby.gameRecord !== undefined
  ) {
    remembered = null;
    return;
  }
  remembered = {
    gameID: lobby.gameID,
    gameStartInfo: lobby.gameStartInfo,
    source: "singleplayer",
  };
}

export function canRestartSinglePlayer(): boolean {
  return remembered !== null;
}

/** Test seam. */
export function forgetSinglePlayerStart(): void {
  remembered = null;
}

/**
 * Stashes the remembered start and reloads the home page, which consumes the
 * stash and joins a brand-new match with the identical start payload.
 */
export function restartSinglePlayer(
  storage: RestartStorage | null = defaultStorage(),
  navigate: (url: string) => void = (url) => {
    window.location.href = url;
  },
): boolean {
  if (remembered === null || storage === null) return false;
  storage.setItem(SINGLE_PLAYER_RESTART_KEY, JSON.stringify(remembered));
  navigate("/");
  return true;
}

function isStart(value: unknown): value is SinglePlayerStart {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SinglePlayerStart>;
  const info = candidate.gameStartInfo as
    | { config?: unknown; players?: unknown }
    | undefined;
  return (
    typeof candidate.gameID === "string" &&
    candidate.source === "singleplayer" &&
    typeof info === "object" &&
    info !== null &&
    typeof info.config === "object" &&
    info.config !== null &&
    Array.isArray(info.players)
  );
}

/** Reads and clears a stashed restart; null when absent or malformed. */
export function consumeSinglePlayerRestart(
  storage: RestartStorage | null = defaultStorage(),
): SinglePlayerStart | null {
  if (storage === null) return null;
  const raw = storage.getItem(SINGLE_PLAYER_RESTART_KEY);
  if (raw === null) return null;
  storage.removeItem(SINGLE_PLAYER_RESTART_KEY);
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStart(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
