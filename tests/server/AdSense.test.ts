import express from "express";
import http from "http";
import path from "path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  adSenseScriptSrc,
  adSenseSettings,
  adsTxt,
} from "../../src/server/AdSense";
import {
  clearLegalPageCache,
  registerHostedRoutes,
  renderLegalPage,
} from "../../src/server/HostedRoutes";
import { assertHostedProfile } from "../../src/server/LocalRuntimeBoundary";
import {
  clearAppShellContentCache,
  renderHtmlContent,
} from "../../src/server/RenderHtml";
import { clearRuntimeAssetManifestCache } from "../../src/server/RuntimeAssetManifest";
import {
  contentSecurityPolicy,
  setSecurityHeaders,
} from "../../src/server/SecurityHeaders";

const CLIENT = "ca-pub-1234567890123456";

const hostedEnv = {
  LOCAL_ONLY: "true",
  DOMAIN: "localhost",
  GAME_ENV: "dev",
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  PUBLIC_ORIGIN: "https://play.example.com",
  SOURCE_URL: "https://github.com/example/territory-lab",
  OPERATOR_NAME: "Example Studio",
  OPERATOR_CONTACT: "ops@example.com",
  WS_ALLOWED_ORIGINS: "same-origin",
  ENABLE_HSTS: "true",
  NUM_WORKERS: "1",
};

function stubEnv(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
  clearLegalPageCache();
  clearRuntimeAssetManifestCache();
  clearAppShellContentCache();
});

// The exact policy shipped before AdSense existed; with AdSense off it must
// not change by a single character.
const PRE_ADSENSE_POLICY =
  "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:";

describe("AdSense settings", () => {
  test("off unless the publisher id is set", () => {
    expect(adSenseSettings({})).toBeNull();
    expect(adSenseSettings({ ADSENSE_CLIENT: "  " })).toBeNull();
    expect(adSenseSettings({ ADSENSE_CLIENT: CLIENT })).toEqual({
      client: CLIENT,
      menuSlot: null,
    });
    expect(
      adSenseSettings({
        ADSENSE_CLIENT: CLIENT,
        ADSENSE_MENU_SLOT: "1234567890",
      }),
    ).toEqual({ client: CLIENT, menuSlot: "1234567890" });
  });

  test("rejects malformed values instead of serving a broken tag", () => {
    expect(() => adSenseSettings({ ADSENSE_CLIENT: "pub-123" })).toThrow(
      /Invalid ADSENSE_CLIENT/,
    );
    expect(() =>
      adSenseSettings({ ADSENSE_CLIENT: CLIENT, ADSENSE_MENU_SLOT: "abc" }),
    ).toThrow(/Invalid ADSENSE_MENU_SLOT/);
    expect(() => adSenseSettings({ ADSENSE_MENU_SLOT: "1234567890" })).toThrow(
      /requires ADSENSE_CLIENT/,
    );
  });

  test("ads.txt names only this publisher with Google's certification id", () => {
    expect(adsTxt(CLIENT)).toBe(
      "google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n",
    );
    expect(adSenseScriptSrc(CLIENT)).toBe(
      `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`,
    );
  });

  test("boot refuses AdSense outside the hosted profile", () => {
    expect(() => assertHostedProfile({ ADSENSE_CLIENT: CLIENT })).toThrow(
      /requires the hosted profile/,
    );
    expect(() =>
      assertHostedProfile({ ...hostedEnv, ADSENSE_CLIENT: CLIENT }),
    ).not.toThrow();
    expect(() =>
      assertHostedProfile({ ...hostedEnv, ADSENSE_CLIENT: "ca-pub-1" }),
    ).toThrow(/Invalid ADSENSE_CLIENT/);
  });
});

describe("content security policy", () => {
  test("is unchanged while AdSense is off", () => {
    expect(contentSecurityPolicy()).toBe(PRE_ADSENSE_POLICY);
    const headers = new Map<string, string>();
    setSecurityHeaders({
      setHeader: (name: string, value: string | number | readonly string[]) => {
        headers.set(name, String(value));
        return undefined as never;
      },
    });
    expect(headers.get("Content-Security-Policy")).toBe(PRE_ADSENSE_POLICY);
  });

  test("opens only the directives AdSense and its consent message need", () => {
    const policy = new Map(
      contentSecurityPolicy(true)
        .split("; ")
        .map((d) => {
          const [name, ...sources] = d.split(" ");
          return [name, sources] as const;
        }),
    );
    expect(policy.get("script-src")).toEqual(
      expect.arrayContaining([
        "'self'",
        "https://pagead2.googlesyndication.com",
        "https://fundingchoicesmessages.google.com",
      ]),
    );
    expect(policy.get("frame-src")).toEqual(
      expect.arrayContaining(["'self'", "https://googleads.g.doubleclick.net"]),
    );
    expect(policy.get("img-src")).toContain("https:");
    expect(policy.get("connect-src")).toContain("'self'");
    // The page itself still cannot be framed, and plugins stay off.
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("worker-src")).toEqual(["'self'", "blob:"]);
  });

  test("Google sign-in adds only the Identity Services origins", () => {
    const base = contentSecurityPolicy(false, false);
    expect(base).toBe(PRE_ADSENSE_POLICY);
    const policy = new Map(
      contentSecurityPolicy(false, true)
        .split("; ")
        .map((d) => {
          const [name, ...sources] = d.split(" ");
          return [name, sources] as const;
        }),
    );
    expect(policy.get("script-src")).toEqual([
      "'self'",
      "'unsafe-inline'",
      "https://accounts.google.com/gsi/client",
    ]);
    expect(policy.get("frame-src")).toEqual([
      "'self'",
      "https://accounts.google.com/gsi/",
    ]);
    expect(policy.get("connect-src")).toEqual([
      "'self'",
      "https://accounts.google.com/gsi/",
    ]);
    expect(policy.get("style-src")).toContain(
      "https://accounts.google.com/gsi/style",
    );
    expect(policy.get("img-src")).toEqual(["'self'", "data:", "blob:"]);
  });

  test("the middleware follows ADSENSE_CLIENT", () => {
    stubEnv({ ...hostedEnv, ADSENSE_CLIENT: CLIENT });
    const headers = new Map<string, string>();
    setSecurityHeaders(
      {
        setHeader: (
          name: string,
          value: string | number | readonly string[],
        ) => {
          headers.set(name, String(value));
          return undefined as never;
        },
      },
      { adsense: adSenseSettings() !== null },
    );
    expect(headers.get("Content-Security-Policy")).toBe(
      contentSecurityPolicy(true),
    );
  });
});

describe("hosted surfaces", () => {
  async function serve() {
    const app = express();
    registerHostedRoutes(app);
    app.use((_req, res) => res.status(404).send("fallback"));
    const server = http.createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    return {
      url: `http://127.0.0.1:${port}`,
      close: () =>
        new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  test("ads.txt exists only with a publisher id on a hosted site", async () => {
    stubEnv(hostedEnv);
    let { url, close } = await serve();
    try {
      expect((await fetch(`${url}/ads.txt`)).status).toBe(404);
    } finally {
      await close();
    }
    stubEnv({ ADSENSE_CLIENT: CLIENT });
    ({ url, close } = await serve());
    try {
      const res = await fetch(`${url}/ads.txt`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
      expect(await res.text()).toBe(adsTxt(CLIENT));
      const privacy = await (await fetch(`${url}/privacy`)).text();
      expect(privacy).toContain("Google AdSense");
    } finally {
      await close();
    }
  });

  test("the privacy notice describes ads only when they run", async () => {
    const values = {
      operatorName: "Example Studio",
      operatorContact: "ops@example.com",
      publicOrigin: "https://play.example.com",
      sourceUrl: "https://github.com/example/territory-lab",
      faviconHref: "/favicon.svg",
    };
    const without = await renderLegalPage("privacy", {
      ...values,
      adsense: false,
    });
    expect(without).toContain("no advertising identifiers");
    expect(without).not.toContain("AdSense");
    clearLegalPageCache();
    const withAds = await renderLegalPage("privacy", {
      ...values,
      adsense: true,
    });
    expect(withAds).toContain("Advertising (Google AdSense)");
    expect(withAds).toContain("never shown during a match");
    expect(withAds).toContain(
      "https://policies.google.com/technologies/partner-sites",
    );
    expect(withAds).toContain("consent");
    expect(withAds).not.toContain("no advertising identifiers");
    expect(withAds).not.toContain("<%");
    clearLegalPageCache();
    const withAccounts = await renderLegalPage("privacy", {
      ...values,
      adsense: false,
      accounts: true,
      googleSignIn: true,
    });
    expect(withAccounts).toContain("Optional player account");
    expect(withAccounts).toContain("salted hash of your password");
    expect(withAccounts).toContain("Sign in with Google");
    expect(withAccounts).not.toContain("no e-mail address or password either");
    expect(withAccounts).not.toContain("<%");
    expect(without).not.toContain("Optional player account");
  });
});

describe("app shell", () => {
  const indexHtml = path.join(__dirname, "../../index.html");

  test("carries no ad tag without a publisher id", async () => {
    stubEnv(hostedEnv);
    const html = await renderHtmlContent(indexHtml);
    expect(html).not.toContain("googlesyndication");
    expect(html).not.toContain("google-adsense-account");
    expect(html).toContain("adsense: null,");
  });

  test("verifies the site and loads AdSense on a hosted site", async () => {
    stubEnv({
      ...hostedEnv,
      ADSENSE_CLIENT: CLIENT,
      ADSENSE_MENU_SLOT: "1234567890",
    });
    const html = await renderHtmlContent(indexHtml);
    expect(html).toContain(
      `<meta name="google-adsense-account" content="${CLIENT}" />`,
    );
    expect(html).toContain(`src="${adSenseScriptSrc(CLIENT)}"`);
    expect(html).toContain('crossorigin="anonymous"');
    expect(html).toContain(
      `adsense: {"client":"${CLIENT}","menuSlot":"1234567890"},`,
    );
  });

  test("links favicon.ico and the 48px/96px PNG favicons", async () => {
    stubEnv(hostedEnv);
    const html = await renderHtmlContent(indexHtml);
    expect(html).toContain('<link rel="icon" href="/favicon.ico"');
    expect(html).toMatch(
      /rel="icon"\s+type="image\/png"\s+sizes="48x48"\s+href="[^"]*favicon-48[^"]*\.png"/,
    );
    expect(html).toMatch(
      /rel="icon"\s+type="image\/png"\s+sizes="96x96"\s+href="[^"]*favicon-96[^"]*\.png"/,
    );
  });

  test("a private local run never renders the tag", async () => {
    stubEnv({ ...hostedEnv, PUBLIC_ORIGIN: "", ADSENSE_CLIENT: CLIENT });
    const html = await renderHtmlContent(indexHtml);
    expect(html).not.toContain("googlesyndication");
  });
});
