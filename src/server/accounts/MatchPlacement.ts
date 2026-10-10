import type { AllPlayersStats, Winner } from "../../core/Schemas";
import type { MatchResultPlayer } from "./AccountsService";

/**
 * Placements of the signed-in players for an agreed result: the winner (or
 * every member of the winning team) places first, everyone else by the
 * position they were eliminated at, and survivors who did not win second.
 * Guests (no account) are left out.
 */
export function placementsForResult(
  players: ReadonlyArray<{ clientID: string; accountId: string | null }>,
  winner: Winner,
  stats: AllPlayersStats,
): MatchResultPlayer[] {
  const winningClientIDs = new Set<string>(
    winner === undefined
      ? []
      : winner[0] === "player"
        ? [winner[1]]
        : winner.slice(2),
  );
  const result: MatchResultPlayer[] = [];
  for (const player of players) {
    if (player.accountId === null) continue;
    const deathPosition = stats[player.clientID]?.deathPosition;
    result.push({
      accountId: player.accountId,
      placement: winningClientIDs.has(player.clientID)
        ? 1
        : (deathPosition ?? 2),
    });
  }
  return result;
}
