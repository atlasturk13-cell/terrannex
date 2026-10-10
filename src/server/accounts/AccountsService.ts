/**
 * Accounts on the game server, switched on by SESSION_SECRET. Every process
 * (master and each worker) opens the same SQLite file; WAL mode lets them
 * read and write it concurrently. Without the secret `accountsService()` is
 * null and every player is a guest, exactly as before.
 *
 * Environment:
 * - SESSION_SECRET   signs session tokens (≥ 32 characters); required.
 *                    "auto" makes the server generate one on first start and
 *                    keep it in `session-secret` next to the database, so
 *                    nobody has to copy a secret into a hosting dashboard.
 * - ACCOUNTS_DB      SQLite file (default data/accounts.sqlite)
 * - GOOGLE_CLIENT_ID OAuth client id for "Sign in with Google"; optional
 */
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import {
  levelForXp,
  matchOutcome,
  progressionBonus,
  xpAtLevel,
  xpForNextLevel,
  type ProgressionBonus,
} from "../../core/Progression";
import { AccountStore, type Account } from "./AccountStore";
import { GoogleIdentityVerifier } from "./GoogleIdentity";
import { SessionSigner } from "./Session";

export interface AccountProfile {
  id: string;
  displayName: string;
  email: string | null;
  xp: number;
  level: number;
  matches: number;
  wins: number;
  nextLevelXp: number;
  levelXp: number;
  bonus: ProgressionBonus;
  country: string | null;
}

/** What a verified session tells the game about the player. */
export interface SessionAccount {
  id: string;
  displayName: string;
  level: number;
  country: string | null;
}

/** Fields a signed-in player may change on their own profile. */
export interface ProfileUpdate {
  displayName?: string;
  country?: string | null;
}

export interface MatchResultPlayer {
  accountId: string;
  placement: number;
}

export function toProfile(account: Account): AccountProfile {
  const level = levelForXp(account.xp);
  return {
    id: account.id,
    displayName: account.displayName,
    email: account.email,
    xp: account.xp,
    level,
    matches: account.matches,
    wins: account.wins,
    nextLevelXp: xpForNextLevel(level),
    levelXp: account.xp - xpAtLevel(level),
    bonus: progressionBonus(level),
    country: account.country,
  };
}

export const DISPLAY_NAME_MIN = 3;
export const DISPLAY_NAME_MAX = 20;
export const PASSWORD_MIN = 8;
/** Matches shorter than this award nothing (no instant farming). */
export const MIN_AWARD_DURATION_MS = 3 * 60 * 1000;

export class AccountsService {
  readonly googleClientId: string | null;
  private readonly google: GoogleIdentityVerifier | null;

  constructor(
    readonly store: AccountStore,
    private readonly sessions: SessionSigner,
    googleClientId: string | null,
    google: GoogleIdentityVerifier | null = googleClientId
      ? new GoogleIdentityVerifier(googleClientId)
      : null,
  ) {
    this.googleClientId = googleClientId;
    this.google = google;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): AccountsService | null {
    const configured = env.SESSION_SECRET?.trim();
    if (configured === undefined || configured === "") return null;
    const configuredPath = env.ACCOUNTS_DB?.trim();
    const dbPath =
      configuredPath === undefined || configuredPath === ""
        ? path.resolve("data/accounts.sqlite")
        : configuredPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const secret =
      configured === AUTO_SESSION_SECRET
        ? persistedSessionSecret(path.dirname(dbPath))
        : configured;
    const configuredGoogle = env.GOOGLE_CLIENT_ID?.trim();
    const googleClientId =
      configuredGoogle === undefined || configuredGoogle === ""
        ? null
        : configuredGoogle;
    return new AccountsService(
      new AccountStore(dbPath),
      new SessionSigner(secret),
      googleClientId,
    );
  }

  async verifySession(token: string): Promise<SessionAccount | null> {
    const claims = await this.sessions.verify(token);
    if (claims === null) return null;
    const account = this.store.get(claims.accountId);
    if (account === null) return null;
    return {
      id: account.id,
      displayName: account.displayName,
      level: account.level,
      country: account.country,
    };
  }

  profile(accountId: string): AccountProfile | null {
    const account = this.store.get(accountId);
    return account === null ? null : toProfile(account);
  }

  /** Applies a profile edit; null when the account no longer exists. */
  updateProfile(
    accountId: string,
    update: ProfileUpdate,
  ): AccountProfile | null {
    if (this.store.get(accountId) === null) return null;
    if (update.displayName !== undefined) {
      this.store.setDisplayName(accountId, update.displayName);
    }
    if (update.country !== undefined) {
      this.store.setCountry(accountId, update.country);
    }
    return this.profile(accountId);
  }

  async issue(
    account: Account,
  ): Promise<{ token: string; profile: AccountProfile }> {
    return {
      token: await this.sessions.sign({
        accountId: account.id,
        displayName: account.displayName,
      }),
      profile: toProfile(account),
    };
  }

  async register(email: string, password: string, displayName: string) {
    return this.issue(
      this.store.createWithPassword(email, password, displayName),
    );
  }

  async login(email: string, password: string) {
    const account = this.store.authenticatePassword(email, password);
    return account === null ? null : this.issue(account);
  }

  async signInWithGoogle(idToken: string) {
    if (this.google === null) return null;
    const profile = await this.google.verify(idToken);
    if (profile === null) return null;
    return this.issue(
      this.store.upsertIdentity("google", profile.subject, {
        email: profile.email,
        displayName: profile.displayName.slice(0, DISPLAY_NAME_MAX),
      }),
    );
  }

  /**
   * Awards a finished multiplayer match to every signed-in player (guests are
   * simply absent from `players`): once per game per account, only for
   * matches that lasted long enough and had at least two human players.
   * Returns the xp granted per account.
   */
  awardMatch(
    gameId: string,
    durationMs: number,
    players: MatchResultPlayer[],
    humanPlayers = players.length,
  ): Map<string, number> {
    const granted = new Map<string, number>();
    if (durationMs < MIN_AWARD_DURATION_MS || humanPlayers < 2) return granted;
    for (const player of players) {
      const xp = this.store.awardMatch({
        accountId: player.accountId,
        gameId,
        outcome: matchOutcome(player.placement, humanPlayers),
        placement: player.placement,
        players: humanPlayers,
      });
      if (xp > 0) granted.set(player.accountId, xp);
    }
    return granted;
  }
}

export const AUTO_SESSION_SECRET = "auto";
export const SESSION_SECRET_FILE = "session-secret";

/**
 * The secret kept next to the database: created once (exclusively, so the
 * master and every worker starting together agree on one), read afterwards.
 * Losing the file signs everyone out, like changing SESSION_SECRET would.
 */
export function persistedSessionSecret(dir: string): string {
  const file = path.join(dir, SESSION_SECRET_FILE);
  try {
    fs.writeFileSync(file, randomBytes(32).toString("hex"), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const secret = fs.readFileSync(file, "utf8").trim();
  if (secret.length < 32) {
    throw new Error(`${file} must hold at least 32 characters`);
  }
  return secret;
}

let cached: AccountsService | null | undefined;

/** The process-wide service, or null when accounts are off. */
export function accountsService(): AccountsService | null {
  if (cached === undefined) cached = AccountsService.fromEnv();
  return cached;
}

/** Test-only: replace or clear the process-wide service. */
export function setAccountsServiceForTests(
  service: AccountsService | null | undefined,
) {
  cached = service;
}
