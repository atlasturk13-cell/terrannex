// @vitest-environment node
import fs from "fs";
import { DatabaseSync } from "node:sqlite";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  accountCountryFlag,
  isAccountCountry,
  withAccountFlag,
} from "../../src/server/accounts/AccountCountry";
import { AccountStore } from "../../src/server/accounts/AccountStore";

describe("account country", () => {
  it("accepts present-day ISO countries only", () => {
    expect(isAccountCountry("tr")).toBe(true);
    expect(isAccountCountry("de")).toBe(true);
    expect(isAccountCountry("xx")).toBe(false);
    expect(isAccountCountry("TR")).toBe(false);
    expect(isAccountCountry("Abbasid Caliphate")).toBe(false);
    expect(isAccountCountry("es-ct")).toBe(false);
    expect(isAccountCountry(null)).toBe(false);
  });

  it("puts the account's country flag on the player, over the client's", () => {
    const asked = { flag: "/flags/us.svg", verified: true };
    expect(withAccountFlag(asked, undefined)).toBe(asked);
    expect(withAccountFlag(asked, { country: null })).toBe(asked);
    expect(withAccountFlag(asked, { country: "Aceh" })).toBe(asked);
    expect(withAccountFlag(asked, { country: "tr" })).toEqual({
      flag: accountCountryFlag("tr"),
      verified: true,
    });
    expect(withAccountFlag({}, { country: "tr" })).toEqual({
      flag: "/flags/tr.svg",
    });
  });

  it("stores the country and adds the column to an older file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "accounts-"));
    const file = path.join(dir, "accounts.sqlite");
    try {
      const old = new DatabaseSync(file);
      old.exec(`
        CREATE TABLE accounts (
          id TEXT PRIMARY KEY, display_name TEXT NOT NULL, email TEXT UNIQUE,
          password_hash TEXT, created_at INTEGER NOT NULL,
          xp INTEGER NOT NULL DEFAULT 0, matches INTEGER NOT NULL DEFAULT 0,
          wins INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO accounts (id, display_name, created_at, xp)
          VALUES ('a1', 'Ada', 1, 120);
      `);
      old.close();

      const store = new AccountStore(file);
      const before = store.get("a1")!;
      expect(before.displayName).toBe("Ada");
      expect(before.xp).toBe(120);
      expect(before.country).toBeNull();

      store.setCountry("a1", "tr");
      expect(store.get("a1")!.country).toBe("tr");
      store.setCountry("a1", null);
      expect(store.get("a1")!.country).toBeNull();

      // Opening the migrated file again is a no-op.
      expect(new AccountStore(file).get("a1")!.xp).toBe(120);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("self-generated session secret", () => {
  it("creates one secret next to the database and reuses it", async () => {
    const { AccountsService, persistedSessionSecret, SESSION_SECRET_FILE } =
      await import("../../src/server/accounts/AccountsService");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "accounts-"));
    try {
      const env = {
        SESSION_SECRET: "auto",
        ACCOUNTS_DB: path.join(dir, "accounts.sqlite"),
      };
      const first = AccountsService.fromEnv(env)!;
      const file = path.join(dir, SESSION_SECRET_FILE);
      const secret = fs.readFileSync(file, "utf8");
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(persistedSessionSecret(dir)).toBe(secret);

      // A session signed by one process verifies in another started later.
      const account = first.store.createWithPassword(
        "ada@example.com",
        "long-enough-pass",
        "Ada",
      );
      const { token } = await first.issue(account);
      const second = AccountsService.fromEnv(env)!;
      expect(await second.verifySession(token)).toMatchObject({
        id: account.id,
      });

      expect(
        AccountsService.fromEnv({ ACCOUNTS_DB: env.ACCOUNTS_DB }),
      ).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
