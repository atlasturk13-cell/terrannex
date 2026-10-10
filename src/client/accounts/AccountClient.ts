/**
 * Client side of accounts: keeps the session token in local storage, talks
 * to the game server's /api/account routes and tells the page when the
 * signed-in player changes. Guests have no token and nothing here runs for
 * them beyond reading "no session".
 */
import { z } from "zod";

export const ACCOUNT_SESSION_KEY = "account-session";
export const ACCOUNT_CHANGED_EVENT = "event:account-changed";

export const AccountProfileSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  xp: z.number().int().nonnegative(),
  level: z.number().int().nonnegative(),
  matches: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  nextLevelXp: z.number().int().positive(),
  levelXp: z.number().int().nonnegative(),
  bonus: z.object({
    level: z.number().int(),
    troopsPerMille: z.number().int(),
    goldPerMille: z.number().int(),
    spawnRings: z.number().int(),
  }),
  // Older servers don't send it; treat that as "not chosen yet".
  country: z.string().nullable().default(null),
});
export type AccountProfile = z.infer<typeof AccountProfileSchema>;

const SessionResponseSchema = z.object({
  token: z.string(),
  profile: AccountProfileSchema,
});

export type AccountError =
  | "network"
  | "invalid_credentials"
  | "email_taken"
  | "weak_password"
  | "invalid_email"
  | "invalid_name"
  | "invalid_country"
  | "google_rejected"
  | "accounts_disabled"
  | "unknown";

export interface AccountConfig {
  enabled: boolean;
  googleClientId: string | null;
}

const AccountConfigSchema = z.object({
  enabled: z.boolean(),
  googleClientId: z.string().nullable(),
});

export type AccountResult =
  | { ok: true; profile: AccountProfile }
  | { ok: false; error: AccountError };

function readToken(): string | null {
  try {
    return localStorage.getItem(ACCOUNT_SESSION_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(ACCOUNT_SESSION_KEY);
    else localStorage.setItem(ACCOUNT_SESSION_KEY, token);
  } catch {
    // Private windows may refuse storage; the session then lasts the page.
  }
}

export class AccountClient {
  private profile: AccountProfile | null = null;
  private memoryToken: string | null = null;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch.bind(globalThis),
  ) {}

  private configPromise: Promise<AccountConfig> | null = null;

  /**
   * Whether this server offers accounts (and Google sign-in). Static hosts
   * and servers without SESSION_SECRET answer "off"; cached per page.
   */
  config(): Promise<AccountConfig> {
    this.configPromise ??= (async () => {
      try {
        const response = await this.fetchImpl("/api/account/config");
        if (!response.ok) return { enabled: false, googleClientId: null };
        return AccountConfigSchema.parse(await response.json());
      } catch {
        return { enabled: false, googleClientId: null };
      }
    })();
    return this.configPromise;
  }

  /** The session token to send with a join, or null for a guest. */
  token(): string | null {
    return this.memoryToken ?? readToken();
  }

  current(): AccountProfile | null {
    return this.profile;
  }

  /** Loads the profile for a stored token; a dead token is forgotten. */
  async restore(): Promise<AccountProfile | null> {
    const token = this.token();
    if (token === null) return null;
    try {
      const response = await this.fetchImpl("/api/account/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) {
        this.setSession(null, null);
        return null;
      }
      if (!response.ok) return this.profile;
      const profile = AccountProfileSchema.parse(await response.json());
      this.setSession(token, profile);
      return profile;
    } catch {
      return this.profile;
    }
  }

  async signInWithGoogle(idToken: string): Promise<AccountResult> {
    return this.post("/api/account/google", { idToken });
  }

  async signInWithPassword(
    email: string,
    password: string,
  ): Promise<AccountResult> {
    return this.post("/api/account/login", { email, password });
  }

  async register(
    email: string,
    password: string,
    displayName: string,
  ): Promise<AccountResult> {
    return this.post("/api/account/register", { email, password, displayName });
  }

  /** Changes the signed-in player's name and/or country on the server. */
  async updateProfile(update: {
    displayName?: string;
    country?: string | null;
  }): Promise<AccountResult> {
    const token = this.token();
    if (token === null) return { ok: false, error: "invalid_credentials" };
    try {
      const response = await this.fetchImpl("/api/account/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(update),
      });
      if (!response.ok) return { ok: false, error: await readError(response) };
      const profile = AccountProfileSchema.parse(await response.json());
      this.setSession(token, profile);
      return { ok: true, profile };
    } catch {
      return { ok: false, error: "network" };
    }
  }

  signOut(): void {
    this.setSession(null, null);
  }

  private async post(
    url: string,
    body: Record<string, string>,
  ): Promise<AccountResult> {
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) return { ok: false, error: await readError(response) };
      const { token, profile } = SessionResponseSchema.parse(
        await response.json(),
      );
      this.setSession(token, profile);
      return { ok: true, profile };
    } catch {
      return { ok: false, error: "network" };
    }
  }

  private setSession(token: string | null, profile: AccountProfile | null) {
    this.memoryToken = token;
    writeToken(token);
    this.profile = profile;
    globalThis.dispatchEvent(
      new CustomEvent<AccountProfile | null>(ACCOUNT_CHANGED_EVENT, {
        detail: profile,
      }),
    );
  }
}

async function readError(response: Response): Promise<AccountError> {
  const parsed = z
    .object({ error: z.string() })
    .safeParse(await response.json().catch(() => ({})));
  return toAccountError(parsed.success ? parsed.data.error : "");
}

const KNOWN_ERRORS: ReadonlySet<string> = new Set<AccountError>([
  "invalid_credentials",
  "email_taken",
  "weak_password",
  "invalid_email",
  "invalid_name",
  "invalid_country",
  "google_rejected",
  "accounts_disabled",
]);

function toAccountError(code: string): AccountError {
  return KNOWN_ERRORS.has(code) ? (code as AccountError) : "unknown";
}

export const accountClient = new AccountClient();
