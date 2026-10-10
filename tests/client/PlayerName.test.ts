import { afterEach, describe, expect, it } from "vitest";
import {
  accountCountryName,
  filterAccountCountries,
} from "../../src/client/accounts/AccountCountries";
import {
  hasChosenPlayerName,
  isAnonPlaceholder,
  PLAYER_NAME_CHANGED_EVENT,
  setPlayerName,
  storedPlayerName,
} from "../../src/client/PlayerName";
import { genAnonUsername } from "../../src/client/UsernameInput";

afterEach(() => localStorage.clear());

describe("player name", () => {
  it("recognises the generated placeholder", () => {
    for (let i = 0; i < 50; i++) {
      expect(isAnonPlaceholder(genAnonUsername())).toBe(true);
    }
    expect(isAnonPlaceholder("Kaan 1923")).toBe(false);
    expect(isAnonPlaceholder("Anonymous")).toBe(false);
  });

  it("treats a stored own name as chosen and the placeholder as not", () => {
    expect(hasChosenPlayerName()).toBe(false);
    localStorage.setItem("username", "AnonAnchor");
    expect(hasChosenPlayerName()).toBe(false);
    localStorage.setItem("username", "Ada");
    expect(hasChosenPlayerName()).toBe(true);
    localStorage.setItem("username", "x");
    expect(hasChosenPlayerName()).toBe(false);
  });

  it("stores a valid name, marks it chosen and announces it", () => {
    const heard: string[] = [];
    const listener = (e: Event) => heard.push((e as CustomEvent).detail);
    globalThis.addEventListener(PLAYER_NAME_CHANGED_EVENT, listener);
    try {
      expect(setPlayerName("no")).toBe(false);
      expect(setPlayerName("Bad$Name")).toBe(false);
      expect(storedPlayerName()).toBeNull();
      expect(setPlayerName("  AnonAnchor ")).toBe(true);
      expect(storedPlayerName()).toBe("AnonAnchor");
      // Picked deliberately, so it counts as chosen even though it looks generated.
      expect(hasChosenPlayerName()).toBe(true);
      expect(heard).toEqual(["AnonAnchor"]);
    } finally {
      globalThis.removeEventListener(PLAYER_NAME_CHANGED_EVENT, listener);
    }
  });
});

describe("account countries", () => {
  it("lists present-day countries and finds them accent-insensitively", () => {
    const turk = filterAccountCountries("turk").map((c) => c.code);
    expect(turk).toContain("tr");
    expect(filterAccountCountries("TÜRK").map((c) => c.code)).toContain("tr");
    expect(filterAccountCountries("de").some((c) => c.code === "de")).toBe(
      true,
    );
    const all = filterAccountCountries("");
    expect(all.length).toBeGreaterThan(200);
    expect(all.every((c) => /^[a-z]{2}$/.test(c.code) && c.code !== "xx")).toBe(
      true,
    );
    expect(accountCountryName("tr")).toBe("Türkiye");
  });
});
