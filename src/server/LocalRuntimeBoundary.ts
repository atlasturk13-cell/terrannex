import { adSenseSettings } from "./AdSense";
const LOCAL_TURNSTILE_TEST_KEY = "1x00000000000000000000AA";

const BLOCKED_EXACT_ENV = new Set([
  "ADMIN_BOT_API_KEY",
  "API_DOMAIN",
  "API_KEY",
  "CDN_BASE",
  "STRIPE_PUBLISHABLE_KEY",
]);

/**
 * Validate the self-contained server profile before importing modules that can
 * construct telemetry exporters or start integration polling loops.
 */
export function assertLocalRuntimeBoundary(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.LOCAL_ONLY === "false") return;

  if (env.DOMAIN !== "localhost") {
    throw new Error("Local runtime requires DOMAIN=localhost");
  }
  if (env.GAME_ENV !== "dev") {
    throw new Error("Local runtime requires GAME_ENV=dev");
  }
  // One hop per trusted reverse proxy in front of Express: 1 for the
  // in-container nginx alone, 2 with a TLS terminator such as Caddy in front
  // of it. Anything beyond four is not a topology this profile documents.
  if (!/^[1-4]$/.test(env.TRUST_PROXY_HOPS ?? "")) {
    throw new Error(
      "Local runtime requires TRUST_PROXY_HOPS=1..4 (one per trusted reverse proxy)",
    );
  }
  if (env.TURNSTILE_SITE_KEY !== LOCAL_TURNSTILE_TEST_KEY) {
    throw new Error("Local runtime requires the public Turnstile test key");
  }

  const blocked = Object.entries(env)
    .filter(
      ([name, value]) =>
        value !== undefined &&
        value !== "" &&
        (BLOCKED_EXACT_ENV.has(name) ||
          name.startsWith("OTEL_") ||
          name.startsWith("TELEMETRY_")),
    )
    .map(([name]) => name)
    .sort();
  if (blocked.length > 0) {
    throw new Error(
      `Local runtime rejects external integration settings: ${blocked.join(", ")}`,
    );
  }

  assertHostedProfile(env);
}

/** Operator values a public deployment must declare before it boots. */
export const HOSTED_REQUIRED_ENV = [
  "SOURCE_URL",
  "OPERATOR_NAME",
  "OPERATOR_CONTACT",
  "WS_ALLOWED_ORIGINS",
] as const;

/**
 * PUBLIC_ORIGIN turns the self-contained profile into a hosted one. The AGPL
 * source offer, an accountable operator, a contact and the WebSocket origin
 * allowlist are then mandatory, and an https origin must send HSTS. Nothing
 * here weakens the local checks above; it only adds requirements.
 */
export function assertHostedProfile(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const publicOrigin = env.PUBLIC_ORIGIN?.trim();
  // AdSense only verifies a public domain; it is never part of a local run.
  const adsense = adSenseSettings(env);
  if (publicOrigin === undefined || publicOrigin === "") {
    if (adsense !== null) {
      throw new Error(
        "ADSENSE_CLIENT requires the hosted profile (PUBLIC_ORIGIN)",
      );
    }
    return;
  }
  if (!/^https?:\/\/[^/\s]+$/.test(publicOrigin.replace(/\/+$/, ""))) {
    throw new Error(
      "PUBLIC_ORIGIN must be an origin such as https://play.example.com (no path)",
    );
  }
  const missing = HOSTED_REQUIRED_ENV.filter((name) => {
    const value = env[name];
    return value === undefined || value.trim() === "";
  });
  if (missing.length > 0) {
    throw new Error(
      `Hosted profile (PUBLIC_ORIGIN) requires ${missing.join(", ")}`,
    );
  }
  if (publicOrigin.startsWith("https://") && env.ENABLE_HSTS !== "true") {
    throw new Error("Hosted profile over https requires ENABLE_HSTS=true");
  }
}
