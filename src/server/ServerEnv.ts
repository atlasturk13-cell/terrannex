import { JWK } from "jose";
import { z } from "zod";
import { GameEnv, parseGameEnv } from "../core/configuration/Config";
import { GameID } from "../core/Schemas";
import { generateID, simpleHash } from "../core/Util";

const JwksSchema = z.object({
  keys: z
    .object({
      alg: z.literal("EdDSA"),
      crv: z.literal("Ed25519"),
      kty: z.literal("OKP"),
      x: z.string(),
    })
    .array()
    .min(1),
});

export class ServerEnv {
  private static readonly gameEnv: GameEnv = parseGameEnv(process.env.GAME_ENV);
  private static publicKey: JWK | null = null;

  // Values that also flow to the client via index.html, but on the server
  // are read from process.env directly. Server code never reaches into
  // ClientEnv — that's reserved for the browser/worker hydrated path.
  //
  // TODO: the following methods are duplicated on ClientEnv. The two classes
  // read from different sources (process.env vs window.BOOTSTRAP_CONFIG) but
  // the derived logic is identical. Consolidate into a shared helper that
  // takes a source so we don't have to keep them in sync by hand.
  static env(): GameEnv {
    return ServerEnv.gameEnv;
  }
  static gameEnvName(): string {
    switch (ServerEnv.gameEnv) {
      case GameEnv.Dev:
        return "dev";
      case GameEnv.Preprod:
        return "staging";
      case GameEnv.Prod:
        return "prod";
    }
  }
  static numWorkers(): number {
    const raw = process.env.NUM_WORKERS;
    if (!raw) {
      throw new Error("NUM_WORKERS not set");
    }
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`Invalid NUM_WORKERS: ${raw}`);
    }
    return n;
  }
  static turnstileSiteKey(): string {
    const v = process.env.TURNSTILE_SITE_KEY;
    if (!v) {
      throw new Error("TURNSTILE_SITE_KEY not set");
    }
    return v;
  }
  static jwtAudience(): string {
    const v = process.env.DOMAIN;
    if (!v) {
      throw new Error("DOMAIN not set");
    }
    return v;
  }
  static instanceId(): string {
    return process.env.INSTANCE_ID ?? "";
  }
  static workerId(): number | undefined {
    const raw = process.env.WORKER_ID;
    if (raw === undefined) return undefined;
    return parseInt(raw, 10);
  }
  static hostname(): string {
    return process.env.HOSTNAME ?? "";
  }
  static host(): string {
    return process.env.HOST ?? "";
  }
  static cdnBase(): string {
    return process.env.CDN_BASE ?? "";
  }
  static isLocalOnly(): boolean {
    return process.env.LOCAL_ONLY !== "false";
  }
  /** MULTIPLAYER=true shows the lobby flow and schedules public lobbies. */
  static multiplayerEnabled(): boolean {
    return process.env.MULTIPLAYER === "true";
  }
  /**
   * SOURCE_URL: where the complete corresponding source of this build is
   * published (the AGPL network offer). Optional locally; the hosted profile
   * requires it. Must be an http(s) URL.
   */
  static sourceUrl(): string | null {
    const raw = process.env.SOURCE_URL?.trim();
    if (raw === undefined || raw === "") return null;
    if (!/^https?:\/\/[^\s]+$/.test(raw)) {
      throw new Error(`Invalid SOURCE_URL: ${raw}`);
    }
    return raw;
  }
  /**
   * Optional explicit listener address (for example `0.0.0.0` on a bare host
   * whose reverse proxy runs elsewhere). Unset keeps the profile default:
   * loopback only for the local profile, all interfaces otherwise.
   */
  static bindHostOverride(): string | null {
    const raw = process.env.BIND_HOST?.trim();
    if (raw === undefined || raw === "") return null;
    if (!/^[0-9A-Za-z.:-]+$/.test(raw)) {
      throw new Error(`Invalid BIND_HOST: ${raw}`);
    }
    return raw;
  }
  /** Emit Strict-Transport-Security. Only correct behind a TLS terminator. */
  static hstsEnabled(): boolean {
    return process.env.ENABLE_HSTS === "true";
  }
  /**
   * WebSocket Origin allowlist: a comma-separated list of origins and/or the
   * word `same-origin`. Unset disables the check (the Vite dev server proxies
   * from a different origin).
   */
  static wsAllowedOrigins(): string[] | null {
    const raw = process.env.WS_ALLOWED_ORIGINS?.trim();
    if (raw === undefined || raw === "") return null;
    const entries = raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return entries.length > 0 ? entries : null;
  }
  static trustProxy(): false | number {
    const raw = process.env.TRUST_PROXY_HOPS;
    if (raw === undefined || raw === "" || raw === "0") {
      return false;
    }
    if (!/^\d+$/.test(raw)) {
      throw new Error(`Invalid TRUST_PROXY_HOPS: ${raw}`);
    }
    const hops = Number(raw);
    if (!Number.isSafeInteger(hops) || hops < 1 || hops > 10) {
      throw new Error(`Invalid TRUST_PROXY_HOPS: ${raw}`);
    }
    return hops;
  }
  static jwtIssuer(): string {
    const audience = ServerEnv.jwtAudience();
    return audience === "localhost"
      ? "http://localhost:8787"
      : `https://api.${audience}`;
  }
  static async jwkPublicKey(): Promise<JWK> {
    if (ServerEnv.publicKey) return ServerEnv.publicKey;
    const jwksUrl = ServerEnv.jwtIssuer() + "/.well-known/jwks.json";
    console.log(`Fetching JWKS from ${jwksUrl}`);
    const response = await fetch(jwksUrl);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`JWKS fetch failed: ${response.status} ${body}`);
    }
    const result = JwksSchema.safeParse(await response.json());
    if (!result.success) {
      const error = z.prettifyError(result.error);
      console.error("Error parsing JWKS", error);
      throw new Error("Invalid JWKS");
    }
    ServerEnv.publicKey = result.data.keys[0];
    return ServerEnv.publicKey;
  }
  static turnIntervalMs(): number {
    return 100;
  }
  /**
   * Milliseconds between a public lobby's creation and its start.
   * PUBLIC_LOBBY_INTERVAL_SECONDS (15–3600) overrides the default: 30
   * seconds on a hosted deployment and for a local multiplayer run,
   * and the historical five seconds / two minutes otherwise.
   */
  static gameCreationRate(): number {
    const raw = process.env.PUBLIC_LOBBY_INTERVAL_SECONDS?.trim();
    if (raw !== undefined && raw !== "") {
      if (!/^\d+$/.test(raw)) {
        throw new Error(`Invalid PUBLIC_LOBBY_INTERVAL_SECONDS: ${raw}`);
      }
      const seconds = Number(raw);
      if (seconds < 15 || seconds > 3600) {
        throw new Error(
          `Invalid PUBLIC_LOBBY_INTERVAL_SECONDS: ${raw} (expected 15-3600)`,
        );
      }
      return seconds * 1000;
    }
    // Public lobbies open every 30 s, as on OpenFront.
    if (ServerEnv.hostedProfileEnabled() || ServerEnv.multiplayerEnabled()) {
      return 30 * 1000;
    }
    return ServerEnv.gameEnv === GameEnv.Dev ? 5 * 1000 : 2 * 60 * 1000;
  }
  static workerIndex(gameID: GameID): number {
    return simpleHash(gameID) % ServerEnv.numWorkers();
  }
  static workerPath(gameID: GameID): string {
    return `w${ServerEnv.workerIndex(gameID)}`;
  }
  static workerPort(gameID: GameID): number {
    return ServerEnv.workerPortByIndex(ServerEnv.workerIndex(gameID));
  }
  static workerPortByIndex(index: number): number {
    return 3001 + index;
  }
  // Generate a game id that hashes to `workerId`, so requests for the game route
  // back to this worker. Rejection sampling: each id lands on a uniformly-random
  // worker, so the expected number of tries is numWorkers; the cap scales with
  // the worker count to keep the failure chance negligible (~e^-100). Returns
  // null if none was found (effectively never).
  static generateGameIdForWorker(workerId: number): GameID | null {
    const maxAttempts = ServerEnv.numWorkers() * 100;
    for (let i = 0; i < maxAttempts; i++) {
      const id = generateID();
      if (ServerEnv.workerIndex(id) === workerId) return id;
    }
    return null;
  }

  // Server-only env values
  static domain(): string {
    return process.env.DOMAIN ?? "";
  }
  static subdomain(): string {
    return process.env.SUBDOMAIN ?? "";
  }
  static otelEnabled(): boolean {
    return (
      ServerEnv.gameEnv !== GameEnv.Dev &&
      Boolean(ServerEnv.otelEndpoint()) &&
      Boolean(ServerEnv.otelAuthHeader())
    );
  }
  static otelEndpoint(): string {
    return process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "";
  }
  static otelAuthHeader(): string {
    return process.env.OTEL_AUTH_HEADER ?? "";
  }
  /** Shown at /commit.txt and in the shell; "unknown" when a bare host omits it. */
  static gitCommit(): string {
    const v = process.env.GIT_COMMIT?.trim();
    return v === undefined || v === "" ? "unknown" : v;
  }
  /**
   * PUBLIC_ORIGIN: the canonical origin of a hosted deployment, for example
   * https://play.example.com (scheme and host only, no path). Unset means a
   * private local run; set, it switches on the hosted surfaces (canonical and
   * social metadata, sitemap, security.txt, legal pages) and requires the
   * operator values checked by the runtime boundary.
   */
  static publicOrigin(): string | null {
    const raw = process.env.PUBLIC_ORIGIN?.trim().replace(/\/+$/, "");
    if (raw === undefined || raw === "") return null;
    if (
      !/^https?:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i.test(
        raw,
      )
    ) {
      throw new Error(
        `Invalid PUBLIC_ORIGIN: ${raw} (expected https://host[:port] without a path)`,
      );
    }
    return raw;
  }
  static hostedProfileEnabled(): boolean {
    return ServerEnv.publicOrigin() !== null;
  }
  /** OPERATOR_NAME: the person or organisation running a hosted deployment. */
  static operatorName(): string | null {
    const v = process.env.OPERATOR_NAME?.trim();
    return v === undefined || v === "" ? null : v;
  }
  /** OPERATOR_CONTACT: an e-mail address or URL players can reach the operator at. */
  static operatorContact(): string | null {
    const v = process.env.OPERATOR_CONTACT?.trim();
    return v === undefined || v === "" ? null : v;
  }
  static apiKey(): string {
    return process.env.API_KEY ?? "";
  }
  // Long-lived shared secret for the trusted admin bot HTTP API.
  // Undefined when unset, which disables the admin bot API entirely.
  static adminBotKey(): string | undefined {
    const v = process.env.ADMIN_BOT_API_KEY;
    return v && v.length > 0 ? v : undefined;
  }
  static adminBotHeader(): string {
    return "x-admin-bot-key";
  }
  static allowedFlares(): string[] | undefined {
    const raw = process.env.ALLOWED_FLARES;
    if (!raw) return undefined;
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
}
