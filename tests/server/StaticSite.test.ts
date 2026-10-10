import fs from "fs";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "../../src/server/SecurityHeaders";
import { vercelOutputConfig } from "../../src/server/StaticSite";
import { staticSiteEnv } from "../../src/server/StaticSiteEnv";

type Route = {
  src?: string;
  dest?: string;
  handle?: string;
  headers?: Record<string, string>;
};

/** Resolves a path the way Vercel walks the routes (after filesystem). */
function destination(routes: Route[], path: string, exists: boolean): string {
  let afterFilesystem = false;
  for (const route of routes) {
    if (route.handle === "filesystem") {
      if (exists) return path;
      afterFilesystem = true;
      continue;
    }
    if (
      afterFilesystem &&
      route.src &&
      new RegExp(`^${route.src}$`).test(path)
    ) {
      return route.dest ?? path;
    }
  }
  return "404";
}

describe("static single-player site", () => {
  it("forces the single-player profile and derives the Vercel origin", () => {
    const env = staticSiteEnv({
      MULTIPLAYER: "true",
      VERCEL_PROJECT_PRODUCTION_URL: "front-wars-2.vercel.app",
    });
    expect(env.MULTIPLAYER).toBe("false");
    expect(env.LOCAL_ONLY).toBe("true");
    expect(env.PUBLIC_ORIGIN).toBe("https://front-wars-2.vercel.app");
    expect(
      staticSiteEnv({ PUBLIC_ORIGIN: "https://play.example.com" })
        .PUBLIC_ORIGIN,
    ).toBe("https://play.example.com");
    // A private build has no origin at all (never the string "undefined").
    expect("PUBLIC_ORIGIN" in staticSiteEnv({})).toBe(false);
  });

  it("routes client paths to the shell and keeps missing files 404", () => {
    const { version, routes } = vercelOutputConfig(false, true);
    expect(version).toBe(3);
    expect(destination(routes, "/w0/game/LocalNE1", false)).toBe("/index.html");
    expect(destination(routes, "/privacy", false)).toBe("/privacy.html");
    expect(destination(routes, "/terms", false)).toBe("/terms.html");
    expect(destination(routes, "/missing.js", false)).toBe("404");
    expect(destination(routes, "/robots.txt", true)).toBe("/robots.txt");
  });

  it("sends the server's security headers, with AdSense only when on", () => {
    const off = vercelOutputConfig(false, true).routes[0].headers!;
    expect(off["Content-Security-Policy"]).toBe(contentSecurityPolicy(false));
    expect(off["X-Frame-Options"]).toBe("DENY");
    expect(off["Strict-Transport-Security"]).toContain("max-age=");
    const on = vercelOutputConfig(true, false).routes[0].headers!;
    expect(on["Content-Security-Policy"]).toBe(contentSecurityPolicy(true));
    expect(on).not.toHaveProperty("Strict-Transport-Security");
  });

  it("the repo's vercel.json builds this site and does not auto-deploy main", () => {
    const config = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
    expect(config.buildCommand).toBe("pnpm build:vercel");
    expect(config.git.deploymentEnabled.main).toBe(false);
  });
});
