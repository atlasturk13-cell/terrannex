import {
  Duos,
  GameMode,
  HumansVsNations,
  Quads,
  Trios,
} from "../core/game/Game";
import { PublicGameInfo } from "../core/Schemas";
import { translateText } from "./Utils";

/** "Free for all", "4 teams of 5", "Humans vs nations"… for a public lobby. */
export function publicLobbyTitle(lobby: PublicGameInfo): string {
  const config = lobby.gameConfig!;
  if (config.gameMode === GameMode.FFA) {
    return translateText("game_mode.ffa");
  }

  if (config?.gameMode === GameMode.Team) {
    const totalPlayers = config.maxPlayers ?? lobby.numClients ?? undefined;
    const formatTeamsOf = (
      teamCount: number | undefined,
      playersPerTeam: number | undefined,
      label?: string,
    ) => {
      if (!teamCount)
        return label ?? translateText("mode_selector.teams_title");
      const baseTitle = playersPerTeam
        ? translateText("mode_selector.teams_of", {
            teamCount: String(teamCount),
            playersPerTeam: String(playersPerTeam),
          })
        : translateText("mode_selector.teams_count", {
            teamCount: String(teamCount),
          });
      return `${baseTitle}${label ? ` (${label})` : ""}`;
    };

    switch (config.playerTeams) {
      case Duos: {
        const teamCount = totalPlayers
          ? Math.floor(totalPlayers / 2)
          : undefined;
        return formatTeamsOf(teamCount, 2);
      }
      case Trios: {
        const teamCount = totalPlayers
          ? Math.floor(totalPlayers / 3)
          : undefined;
        return formatTeamsOf(teamCount, 3);
      }
      case Quads: {
        const teamCount = totalPlayers
          ? Math.floor(totalPlayers / 4)
          : undefined;
        return formatTeamsOf(teamCount, 4);
      }
      case HumansVsNations: {
        const humanSlots = config.maxPlayers ?? lobby.numClients;
        return humanSlots
          ? translateText("public_lobby.teams_hvn_detailed", {
              num: String(humanSlots),
            })
          : translateText("public_lobby.teams_hvn");
      }
      default:
        if (typeof config.playerTeams === "number") {
          const teamCount = config.playerTeams;
          const playersPerTeam =
            totalPlayers && teamCount > 0
              ? Math.floor(totalPlayers / teamCount)
              : undefined;
          return formatTeamsOf(teamCount, playersPerTeam);
        }
    }
  }

  return "";
}
