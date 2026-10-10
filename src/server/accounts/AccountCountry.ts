/**
 * The country a signed-in player picks for their account: a present-day
 * country with an ISO 3166-1 alpha-2 code from resources/countries.json. The
 * server turns it into the player's flag in every match, so a client cannot
 * wear another account's country.
 */
import countries from "resources/countries.json";
import type { PlayerCosmetics } from "../../core/Schemas";

const ACCOUNT_COUNTRY_CODES = new Set(
  countries
    .filter(
      (country) =>
        /^[a-z]{2}$/.test(country.code) &&
        country.code !== "xx" &&
        !("restricted" in country && country.restricted),
    )
    .map((country) => country.code),
);

export function isAccountCountry(code: unknown): code is string {
  return typeof code === "string" && ACCOUNT_COUNTRY_CODES.has(code);
}

/** The match flag for an account country, as the server resolves flags. */
export function accountCountryFlag(code: string): string {
  return `/flags/${code}.svg`;
}

/**
 * Cosmetics for a joining player: a signed-in player with a country always
 * plays under that country's flag, whatever the client asked for.
 */
export function withAccountFlag(
  cosmetics: PlayerCosmetics,
  account: { country: string | null } | undefined,
): PlayerCosmetics {
  if (account === undefined || !isAccountCountry(account.country)) {
    return cosmetics;
  }
  return { ...cosmetics, flag: accountCountryFlag(account.country) };
}
