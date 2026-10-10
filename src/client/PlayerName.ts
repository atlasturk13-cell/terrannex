import { ANON_WORDS } from "../core/AnonNames";
import { validateUsername } from "../core/validations/username";

/**
 * The name a player goes by in matches. It lives in localStorage under the
 * same key `<username-input>` has always used; this module adds whether the
 * player actually chose it (versus the generated "Anon…" placeholder) and a
 * change event so every name field and the join prompt stay in step.
 */
export const PLAYER_NAME_KEY = "username";
export const PLAYER_NAME_CHOSEN_KEY = "username-chosen";
export const PLAYER_NAME_CHANGED_EVENT = "event:player-name-changed";

const ANON_PLACEHOLDER = new RegExp(
  `^Anon(?:${ANON_WORDS.map((word) => word.replace(/[^\p{L}\p{N}]/gu, "")).join("|")})\\d*$`,
  "u",
);

/** A name `genAnonUsername()` could have produced. */
export function isAnonPlaceholder(name: string): boolean {
  return ANON_PLACEHOLDER.test(name.trim());
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows may refuse storage; the name then lasts the page.
  }
}

export function storedPlayerName(): string | null {
  return read(PLAYER_NAME_KEY);
}

/**
 * Whether the player has picked their own name: typed it somewhere, saved it
 * from the profile or the join prompt, or (from before this flag existed)
 * stored anything that is not the generated placeholder.
 */
export function hasChosenPlayerName(): boolean {
  const name = storedPlayerName();
  if (name === null || !validateUsername(name).isValid) return false;
  return read(PLAYER_NAME_CHOSEN_KEY) === "true" || !isAnonPlaceholder(name);
}

/** Remembers that the stored name is the player's own choice. */
export function markPlayerNameChosen(): void {
  write(PLAYER_NAME_CHOSEN_KEY, "true");
}

/**
 * Stores a chosen name and tells every `<username-input>` on the page.
 * Returns false (and stores nothing) when the name is not valid.
 */
export function setPlayerName(name: string): boolean {
  const trimmed = name.trim();
  if (!validateUsername(trimmed).isValid) return false;
  write(PLAYER_NAME_KEY, trimmed);
  markPlayerNameChosen();
  globalThis.dispatchEvent(
    new CustomEvent<string>(PLAYER_NAME_CHANGED_EVENT, { detail: trimmed }),
  );
  return true;
}
