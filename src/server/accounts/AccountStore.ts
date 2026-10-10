/**
 * Account storage on the game server: one SQLite file (Node's built-in
 * `node:sqlite`, no native dependency) holding accounts, their sign-in
 * methods and their progression. Everything is synchronous and small; the
 * store is opened once per process.
 *
 * Guests never touch this store — only players who chose to sign in.
 */
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "crypto";
import { DatabaseSync } from "node:sqlite";
import {
  levelForXp,
  MATCH_XP,
  type MatchOutcome,
} from "../../core/Progression";

export interface Account {
  id: string;
  displayName: string;
  email: string | null;
  createdAt: number;
  xp: number;
  level: number;
  matches: number;
  wins: number;
  /** ISO 3166-1 alpha-2 code (lowercase) the player picked, or null. */
  country: string | null;
}

export interface MatchAward {
  accountId: string;
  gameId: string;
  outcome: MatchOutcome;
  placement: number;
  players: number;
}

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

export function hashPassword(password: string, salt = randomBytes(16)): string {
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(
    password,
    Buffer.from(saltHex, "hex"),
    expected.length,
    SCRYPT_OPTIONS,
  );
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

type AccountRow = {
  id: string;
  display_name: string;
  email: string | null;
  created_at: number;
  xp: number;
  matches: number;
  wins: number;
  country: string | null;
};

export class AccountStore {
  private readonly db: DatabaseSync;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        email TEXT UNIQUE,
        password_hash TEXT,
        created_at INTEGER NOT NULL,
        xp INTEGER NOT NULL DEFAULT 0,
        matches INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS identities (
        provider TEXT NOT NULL,
        subject TEXT NOT NULL,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        PRIMARY KEY (provider, subject)
      );
      CREATE TABLE IF NOT EXISTS match_awards (
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        game_id TEXT NOT NULL,
        outcome TEXT NOT NULL,
        placement INTEGER NOT NULL,
        players INTEGER NOT NULL,
        xp INTEGER NOT NULL,
        awarded_at INTEGER NOT NULL,
        PRIMARY KEY (account_id, game_id)
      );
    `);
    this.migrate();
  }

  /** Additive columns for files created by an older build. */
  private migrate(): void {
    const columns = (
      this.db.prepare("PRAGMA table_info(accounts)").all() as {
        name: string;
      }[]
    ).map((column) => column.name);
    if (!columns.includes("country")) {
      this.db.exec("ALTER TABLE accounts ADD COLUMN country TEXT");
    }
  }

  private toAccount(row: AccountRow): Account {
    return {
      id: row.id,
      displayName: row.display_name,
      email: row.email,
      createdAt: row.created_at,
      xp: row.xp,
      level: levelForXp(row.xp),
      matches: row.matches,
      wins: row.wins,
      country: row.country ?? null,
    };
  }

  get(id: string): Account | null {
    const row = this.db
      .prepare("SELECT * FROM accounts WHERE id = ?")
      .get(id) as AccountRow | undefined;
    return row ? this.toAccount(row) : null;
  }

  byEmail(email: string): Account | null {
    const row = this.db
      .prepare("SELECT * FROM accounts WHERE email = ?")
      .get(normalizeEmail(email)) as AccountRow | undefined;
    return row ? this.toAccount(row) : null;
  }

  /** Email + password account. Throws "email_taken" when the address exists. */
  createWithPassword(
    email: string,
    password: string,
    displayName: string,
    now = Date.now(),
  ): Account {
    const normalized = normalizeEmail(email);
    if (this.byEmail(normalized) !== null) throw new Error("email_taken");
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO accounts (id, display_name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, displayName, normalized, hashPassword(password), now);
    return this.get(id)!;
  }

  /** Returns the account when the email/password pair is right, else null. */
  authenticatePassword(email: string, password: string): Account | null {
    const row = this.db
      .prepare("SELECT id, password_hash FROM accounts WHERE email = ?")
      .get(normalizeEmail(email)) as
      | { id: string; password_hash: string | null }
      | undefined;
    if (!row?.password_hash || !verifyPassword(password, row.password_hash)) {
      return null;
    }
    return this.get(row.id);
  }

  /**
   * Account for an external identity (e.g. Google `sub`), created on first
   * sign-in. An existing password account with the same verified email is
   * linked instead of duplicated.
   */
  upsertIdentity(
    provider: string,
    subject: string,
    profile: { email: string | null; displayName: string },
    now = Date.now(),
  ): Account {
    const linked = this.db
      .prepare(
        "SELECT account_id FROM identities WHERE provider = ? AND subject = ?",
      )
      .get(provider, subject) as { account_id: string } | undefined;
    if (linked) return this.get(linked.account_id)!;

    const email = profile.email === null ? null : normalizeEmail(profile.email);
    let id = email === null ? null : (this.byEmail(email)?.id ?? null);
    if (id === null) {
      id = randomUUID();
      this.db
        .prepare(
          "INSERT INTO accounts (id, display_name, email, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(id, profile.displayName, email, now);
    }
    this.db
      .prepare(
        "INSERT INTO identities (provider, subject, account_id) VALUES (?, ?, ?)",
      )
      .run(provider, subject, id);
    return this.get(id)!;
  }

  setDisplayName(id: string, displayName: string): void {
    this.db
      .prepare("UPDATE accounts SET display_name = ? WHERE id = ?")
      .run(displayName, id);
  }

  setCountry(id: string, country: string | null): void {
    this.db
      .prepare("UPDATE accounts SET country = ? WHERE id = ?")
      .run(country, id);
  }

  /**
   * Records one finished match. A game awards an account at most once, so a
   * replayed or duplicated result changes nothing; returns the xp granted.
   */
  awardMatch(award: MatchAward, now = Date.now()): number {
    const xp = MATCH_XP[award.outcome];
    const inserted = this.db
      .prepare(
        "INSERT OR IGNORE INTO match_awards (account_id, game_id, outcome, placement, players, xp, awarded_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        award.accountId,
        award.gameId,
        award.outcome,
        award.placement,
        award.players,
        xp,
        now,
      );
    if (inserted.changes === 0) return 0;
    this.db
      .prepare(
        "UPDATE accounts SET xp = xp + ?, matches = matches + 1, wins = wins + ? WHERE id = ?",
      )
      .run(xp, award.outcome === "win" ? 1 : 0, award.accountId);
    return xp;
  }

  recentAwards(accountId: string, limit = 20): MatchAward[] {
    return (
      this.db
        .prepare(
          "SELECT game_id, outcome, placement, players FROM match_awards WHERE account_id = ? ORDER BY awarded_at DESC, rowid DESC LIMIT ?",
        )
        .all(accountId, limit) as Array<{
        game_id: string;
        outcome: MatchOutcome;
        placement: number;
        players: number;
      }>
    ).map((row) => ({
      accountId,
      gameId: row.game_id,
      outcome: row.outcome,
      placement: row.placement,
      players: row.players,
    }));
  }

  close(): void {
    this.db.close();
  }
}
