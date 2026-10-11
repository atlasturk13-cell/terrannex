import { PseudoRandom } from "../PseudoRandom";
import { GameConfig } from "../Schemas";
import { simpleHash } from "../Util";
import { GameMode, GameType, HumansVsNations } from "./Game";

/**
 * Public lobbies fill up with AI commanders that go by player-style
 * nicknames instead of country names. Names come from their own PRNG stream
 * keyed by the game id, so every client — the lobby card included — derives
 * the same names without touching the match's main random sequence.
 */
export function usesPlayerStyleNames(config: GameConfig): boolean {
  return (
    config.gameType === GameType.Public &&
    !(
      config.gameMode === GameMode.Team &&
      config.playerTeams === HumansVsNations
    )
  );
}

const ADJECTIVES = [
  "Dark",
  "Silent",
  "Iron",
  "Red",
  "Swift",
  "Lone",
  "Wild",
  "Frost",
  "Shadow",
  "Golden",
  "Storm",
  "Night",
  "Brave",
  "Crazy",
  "Lucky",
  "Grim",
  "Royal",
  "Steel",
  "Rapid",
  "Ghost",
  "Blue",
  "Black",
  "Mad",
  "Sly",
];
const NOUNS = [
  "Wolf",
  "Raven",
  "Falcon",
  "Tiger",
  "Fox",
  "Bear",
  "Hawk",
  "Viper",
  "Knight",
  "Titan",
  "Lion",
  "Eagle",
  "Shark",
  "Cobra",
  "Panther",
  "Dragon",
  "Ranger",
  "Hunter",
  "Baron",
  "Pilot",
  "Sniper",
  "Rider",
  "Nomad",
  "Warden",
];
const FIRST_NAMES = [
  "kaan",
  "emre",
  "mert",
  "ahmet",
  "elif",
  "zeynep",
  "burak",
  "can",
  "deniz",
  "efe",
  "yusuf",
  "ali",
  "alex",
  "max",
  "leo",
  "noah",
  "liam",
  "lucas",
  "mateo",
  "hugo",
  "ivan",
  "nikita",
  "omar",
  "yuki",
  "jonas",
  "pablo",
  "marco",
  "tom",
  "sam",
  "ben",
];
const SUFFIXES = ["_tr", "_x", "_pro", "_yt", "_tv", "_gg", "x", "_"];

function pick<T>(random: PseudoRandom, list: readonly T[]): T {
  return list[random.nextInt(0, list.length)];
}

function digits(random: PseudoRandom): string {
  const style = random.nextInt(0, 4);
  if (style === 0) return String(random.nextInt(1, 100));
  if (style === 1) return String(random.nextInt(1950, 2013));
  if (style === 2) return String(random.nextInt(100, 1000));
  return String(random.nextInt(0, 10)).repeat(random.nextInt(2, 4));
}

function playerStyleName(random: PseudoRandom): string {
  switch (random.nextInt(0, 7)) {
    case 0:
      return `${pick(random, ADJECTIVES)}${pick(random, NOUNS)}`;
    case 1:
      return `${pick(random, NOUNS)}${digits(random)}`;
    case 2:
      return `${pick(random, FIRST_NAMES)}${digits(random)}`;
    case 3:
      return `${pick(random, FIRST_NAMES)}${pick(random, SUFFIXES)}`;
    case 4:
      return `${pick(random, ADJECTIVES).toLowerCase()}_${pick(random, NOUNS).toLowerCase()}`;
    case 5:
      return `${pick(random, NOUNS)}_${digits(random)}`;
    default: {
      const name = pick(random, FIRST_NAMES);
      return `${name[0].toUpperCase()}${name.slice(1)}${pick(random, NOUNS)}`;
    }
  }
}

/** `count` distinct nicknames for the AI commanders of `gameID`. */
export function playerStyleNames(gameID: string, count: number): string[] {
  const random = new PseudoRandom(simpleHash(`names:${gameID}`));
  const names: string[] = [];
  const used = new Set<string>();
  let guard = 0;
  while (names.length < count) {
    let name = playerStyleName(random);
    if (used.has(name) || name.length > 20) {
      if (++guard < 1000) continue;
      name = `${pick(random, NOUNS)}${names.length}`;
    }
    used.add(name);
    names.push(name);
  }
  return names;
}
