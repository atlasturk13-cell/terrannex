import { afterEach, describe, expect, it } from "vitest";
import { MATCH_XP } from "../../src/core/Progression";
import {
  AccountStore,
  hashPassword,
  verifyPassword,
} from "../../src/server/accounts/AccountStore";

let store: AccountStore;
afterEach(() => store?.close());

describe("account store", () => {
  it("hashes passwords with a per-account salt", () => {
    const a = hashPassword("correct horse");
    const b = hashPassword("correct horse");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("correct horse", a)).toBe(true);
    expect(verifyPassword("wrong", a)).toBe(false);
    expect(verifyPassword("x", "garbage")).toBe(false);
  });

  it("creates and authenticates email accounts, case-insensitively", () => {
    store = new AccountStore();
    const account = store.createWithPassword(
      " Player@Example.COM ",
      "secret-pass",
      "Player",
    );
    expect(account.email).toBe("player@example.com");
    expect(account.level).toBe(0);
    expect(
      store.authenticatePassword("player@example.com", "secret-pass")?.id,
    ).toBe(account.id);
    expect(store.authenticatePassword("player@example.com", "nope")).toBeNull();
    expect(
      store.authenticatePassword("other@example.com", "secret-pass"),
    ).toBeNull();
    expect(() =>
      store.createWithPassword("PLAYER@example.com", "x", "Dup"),
    ).toThrow("email_taken");
  });

  it("creates one account per external identity and links by email", () => {
    store = new AccountStore();
    const first = store.upsertIdentity("google", "sub-1", {
      email: "g@example.com",
      displayName: "G",
    });
    const again = store.upsertIdentity("google", "sub-1", {
      email: "changed@example.com",
      displayName: "Renamed",
    });
    expect(again.id).toBe(first.id);
    expect(again.displayName).toBe("G");

    const password = store.createWithPassword("p@example.com", "pw123456", "P");
    const linked = store.upsertIdentity("google", "sub-2", {
      email: "P@example.com",
      displayName: "Google P",
    });
    expect(linked.id).toBe(password.id);
    const noEmail = store.upsertIdentity("google", "sub-3", {
      email: null,
      displayName: "Anon",
    });
    expect(noEmail.email).toBeNull();
    expect(noEmail.id).not.toBe(first.id);
  });

  it("awards each match once and levels up slowly", () => {
    store = new AccountStore();
    const account = store.createWithPassword("w@example.com", "pw123456", "W");
    const award = {
      accountId: account.id,
      gameId: "game-1",
      outcome: "win" as const,
      placement: 1,
      players: 6,
    };
    expect(store.awardMatch(award)).toBe(MATCH_XP.win);
    expect(store.awardMatch(award)).toBe(0);
    expect(
      store.awardMatch({
        ...award,
        gameId: "game-2",
        outcome: "played",
        placement: 5,
      }),
    ).toBe(MATCH_XP.played);
    const after = store.get(account.id)!;
    expect(after.xp).toBe(80);
    expect(after.matches).toBe(2);
    expect(after.wins).toBe(1);
    expect(after.level).toBe(0);
    store.awardMatch({ ...award, gameId: "game-3" });
    expect(store.get(account.id)!.level).toBe(1);
    expect(store.recentAwards(account.id).map((a) => a.gameId)).toEqual([
      "game-3",
      "game-2",
      "game-1",
    ]);
  });
});
