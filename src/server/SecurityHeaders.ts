import type { Response } from "express";
import { accountsService } from "./accounts/AccountsService";
import { ADSENSE_CSP_SOURCES, adSenseSettings } from "./AdSense";

/**
 * Origins Google Identity Services ("Sign in with Google") needs. Added only
 * when GOOGLE_CLIENT_ID is set; email + password sign-in needs nothing.
 */
export const GOOGLE_SIGN_IN_CSP_SOURCES = {
  "script-src": ["https://accounts.google.com/gsi/client"],
  "frame-src": ["https://accounts.google.com/gsi/"],
  "connect-src": ["https://accounts.google.com/gsi/"],
  "style-src": ["https://accounts.google.com/gsi/style"],
} as const;

const BASE_CSP: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["default-src", ["'self'"]],
  ["base-uri", ["'self'"]],
  ["connect-src", ["'self'"]],
  ["font-src", ["'self'", "data:"]],
  ["form-action", ["'self'"]],
  ["frame-ancestors", ["'none'"]],
  ["img-src", ["'self'", "data:", "blob:"]],
  ["media-src", ["'self'", "blob:"]],
  ["object-src", ["'none'"]],
  // The EJS app shell currently contains bootstrap and safe-area inline blocks.
  // Removing unsafe-inline requires a per-response nonce and is tracked as a
  // publication hardening follow-up rather than silently breaking startup.
  ["script-src", ["'self'", "'unsafe-inline'"]],
  ["style-src", ["'self'", "'unsafe-inline'"]],
  ["worker-src", ["'self'", "blob:"]],
];

/**
 * The page policy. With AdSense on, Google's ad and consent origins are added
 * to the directives they need (and frame-src appears, since ads render in
 * iframes); with Google sign-in on, the Identity Services origins; every
 * other directive stays self-only.
 */
export function contentSecurityPolicy(
  adsense = false,
  googleSignIn = false,
): string {
  const directives = new Map<string, string[]>(
    BASE_CSP.map(([name, sources]) => [name, [...sources]]),
  );
  if (adsense || googleSignIn) directives.set("frame-src", ["'self'"]);
  if (adsense) {
    for (const [name, sources] of Object.entries(ADSENSE_CSP_SOURCES)) {
      directives.get(name)!.push(...sources);
    }
  }
  if (googleSignIn) {
    for (const [name, sources] of Object.entries(GOOGLE_SIGN_IN_CSP_SOURCES)) {
      directives.get(name)!.push(...sources);
    }
  }
  return [...directives]
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

export interface SecurityHeaderOptions {
  /**
   * Add Strict-Transport-Security. Only correct behind a TLS terminator, so
   * it stays off unless the operator opts in (ENABLE_HSTS=true).
   */
  hsts?: boolean;
  /** Allow Google AdSense (only when the operator set ADSENSE_CLIENT). */
  adsense?: boolean;
  /** Allow Google Identity Services (only when GOOGLE_CLIENT_ID is set). */
  googleSignIn?: boolean;
}

const HSTS_POLICY = "max-age=31536000; includeSubDomains";

export function setSecurityHeaders(
  res: Pick<Response, "setHeader">,
  options: SecurityHeaderOptions = {},
): void {
  res.setHeader(
    "Content-Security-Policy",
    contentSecurityPolicy(
      options.adsense === true,
      options.googleSignIn === true,
    ),
  );
  if (options.hsts === true) {
    res.setHeader("Strict-Transport-Security", HSTS_POLICY);
  }
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
}

export function securityHeadersMiddleware(
  _req: unknown,
  res: Pick<Response, "setHeader">,
  next: () => void,
): void {
  setSecurityHeaders(res, {
    hsts: process.env.ENABLE_HSTS === "true",
    adsense: adSenseSettings() !== null,
    googleSignIn: (accountsService()?.googleClientId ?? null) !== null,
  });
  next();
}
