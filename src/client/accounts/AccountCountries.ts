import countries from "resources/countries.json" with { type: "json" };
import { assetUrl } from "../../core/AssetUrls";

/**
 * Present-day countries a player can pick for their account (two-letter ISO
 * codes from resources/countries.json; the server accepts the same set).
 */
export interface AccountCountry {
  code: string;
  name: string;
  /** Lowercase, accent-free text the search box matches against. */
  search: string;
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("en");
}

function localName(code: string, locale: string): string | null {
  try {
    return (
      new Intl.DisplayNames([locale], { type: "region" }).of(
        code.toUpperCase(),
      ) ?? null
    );
  } catch {
    return null;
  }
}

let cached: AccountCountry[] | null = null;

export function accountCountries(): AccountCountry[] {
  if (cached !== null) return cached;
  const locale =
    typeof navigator !== "undefined" ? navigator.language || "en" : "en";
  cached = countries
    .filter(
      (country) =>
        /^[a-z]{2}$/.test(country.code) &&
        country.code !== "xx" &&
        !("restricted" in country && country.restricted),
    )
    .map((country) => {
      const names = [
        country.name,
        country.code,
        localName(country.code, "en"),
        localName(country.code, locale),
      ].filter((name): name is string => name !== null);
      return {
        code: country.code,
        name: country.name,
        search: fold(names.join(" ")),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  return cached;
}

export function filterAccountCountries(query: string): AccountCountry[] {
  const needle = fold(query.trim());
  const all = accountCountries();
  return needle === "" ? all : all.filter((c) => c.search.includes(needle));
}

export function accountCountryName(code: string): string {
  return accountCountries().find((c) => c.code === code)?.name ?? code;
}

export function accountCountryFlagUrl(code: string): string {
  return assetUrl(`flags/${code}.svg`);
}
