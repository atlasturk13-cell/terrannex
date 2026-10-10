// Kept free of server imports: ServerEnv reads GAME_ENV when it is first
// imported, so the static build must set the environment before loading
// StaticSite.

/** Env defaults for a static build; the operator values stay mandatory. */
export function staticSiteEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const vercelOrigin =
    env.VERCEL_PROJECT_PRODUCTION_URL !== undefined &&
    env.VERCEL_PROJECT_PRODUCTION_URL !== ""
      ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined;
  return {
    ...env,
    LOCAL_ONLY: "true",
    GAME_ENV: "dev",
    DOMAIN: "localhost",
    NUM_WORKERS: env.NUM_WORKERS ?? "1",
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    // No game server behind a static host.
    MULTIPLAYER: "false",
    // Omitted (not "undefined") when neither is known: a private build.
    ...((env.PUBLIC_ORIGIN ?? vercelOrigin) === undefined
      ? {}
      : { PUBLIC_ORIGIN: env.PUBLIC_ORIGIN ?? vercelOrigin }),
    WS_ALLOWED_ORIGINS: env.WS_ALLOWED_ORIGINS ?? "same-origin",
    ENABLE_HSTS: env.ENABLE_HSTS ?? "true",
  };
}
