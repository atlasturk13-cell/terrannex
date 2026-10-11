import express from "express";
import fs from "fs/promises";
import http from "http";
import os from "os";
import path from "path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  clearLegalPageCache,
  LEGAL_TEMPLATE_VERSION,
  registerHostedRoutes,
  renderLegalPage,
} from "../../src/server/HostedRoutes";
import {
  assertHostedProfile,
  assertLocalRuntimeBoundary,
  HOSTED_REQUIRED_ENV,
} from "../../src/server/LocalRuntimeBoundary";
import {
  clearAppShellContentCache,
  getAppShellContent,
} from "../../src/server/RenderHtml";
import { clearRuntimeAssetManifestCache } from "../../src/server/RuntimeAssetManifest";
import { ServerEnv } from "../../src/server/ServerEnv";
import {
  absoluteAssetUrl,
  canonicalHref,
  HOSTED_DOCUMENT_TITLE,
  LOCAL_DOCUMENT_TITLE,
  robotsTxt,
  securityTxt,
  sitemapXml,
  webManifest,
} from "../../src/server/SiteMetadata";

const localEnv = {
  LOCAL_ONLY: "true",
  DOMAIN: "localhost",
  GAME_ENV: "dev",
  TRUST_PROXY_HOPS: "2",
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
};

const hostedEnv = {
  ...localEnv,
  PUBLIC_ORIGIN: "https://play.example.com",
  SOURCE_URL: "https://github.com/example/territory-lab",
  OPERATOR_NAME: "Example Studio",
  OPERATOR_CONTACT: "ops@example.com",
  WS_ALLOWED_ORIGINS: "same-origin",
  ENABLE_HSTS: "true",
};

function stubHosted(overrides: Record<string, string> = {}) {
  for (const [name, value] of Object.entries({ ...hostedEnv, ...overrides })) {
    vi.stubEnv(name, value);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  clearLegalPageCache();
  clearRuntimeAssetManifestCache();
  clearAppShellContentCache();
});

describe("ServerEnv hosted values", () => {
  test("parses the public origin and rejects paths", () => {
    vi.stubEnv("PUBLIC_ORIGIN", "https://play.example.com/");
    expect(ServerEnv.publicOrigin()).toBe("https://play.example.com");
    expect(ServerEnv.hostedProfileEnabled()).toBe(true);
    vi.stubEnv("PUBLIC_ORIGIN", "http://127.0.0.1:18081");
    expect(ServerEnv.publicOrigin()).toBe("http://127.0.0.1:18081");
    vi.stubEnv("PUBLIC_ORIGIN", "https://play.example.com/game");
    expect(() => ServerEnv.publicOrigin()).toThrow(/Invalid PUBLIC_ORIGIN/);
    vi.stubEnv("PUBLIC_ORIGIN", "play.example.com");
    expect(() => ServerEnv.publicOrigin()).toThrow(/Invalid PUBLIC_ORIGIN/);
    vi.stubEnv("PUBLIC_ORIGIN", "");
    expect(ServerEnv.publicOrigin()).toBeNull();
    expect(ServerEnv.hostedProfileEnabled()).toBe(false);
  });

  test("reads operator values, the source URL and a commit fallback", () => {
    vi.stubEnv("OPERATOR_NAME", "  Example Studio ");
    vi.stubEnv("OPERATOR_CONTACT", "ops@example.com");
    vi.stubEnv("SOURCE_URL", "https://github.com/example/territory-lab");
    expect(ServerEnv.operatorName()).toBe("Example Studio");
    expect(ServerEnv.operatorContact()).toBe("ops@example.com");
    expect(ServerEnv.sourceUrl()).toBe(
      "https://github.com/example/territory-lab",
    );
    vi.stubEnv("SOURCE_URL", "ftp://nope");
    expect(() => ServerEnv.sourceUrl()).toThrow(/Invalid SOURCE_URL/);
    vi.stubEnv("OPERATOR_NAME", "");
    expect(ServerEnv.operatorName()).toBeNull();
    vi.stubEnv("GIT_COMMIT", "");
    expect(ServerEnv.gitCommit()).toBe("unknown");
    vi.stubEnv("GIT_COMMIT", "abc123");
    expect(ServerEnv.gitCommit()).toBe("abc123");
    vi.stubEnv("MULTIPLAYER", "true");
    expect(ServerEnv.multiplayerEnabled()).toBe(true);
  });
});

describe("hosted runtime boundary", () => {
  test("accepts the complete hosted profile and the plain local one", () => {
    expect(() => assertLocalRuntimeBoundary(hostedEnv)).not.toThrow();
    expect(() => assertLocalRuntimeBoundary(localEnv)).not.toThrow();
    expect(HOSTED_REQUIRED_ENV).toEqual([
      "SOURCE_URL",
      "OPERATOR_NAME",
      "OPERATOR_CONTACT",
      "WS_ALLOWED_ORIGINS",
    ]);
  });

  test.each(HOSTED_REQUIRED_ENV)(
    "refuses a public origin without %s",
    (name) => {
      const env = { ...hostedEnv, [name]: "" };
      expect(() => assertHostedProfile(env)).toThrow(new RegExp(name));
      expect(() => assertLocalRuntimeBoundary(env)).toThrow(new RegExp(name));
    },
  );

  test("requires HSTS over https, not over a local http probe", () => {
    expect(() =>
      assertHostedProfile({ ...hostedEnv, ENABLE_HSTS: "" }),
    ).toThrow(/ENABLE_HSTS=true/);
    expect(() =>
      assertHostedProfile({
        ...hostedEnv,
        PUBLIC_ORIGIN: "http://127.0.0.1:18081",
        ENABLE_HSTS: "",
      }),
    ).not.toThrow();
    expect(() =>
      assertHostedProfile({
        ...hostedEnv,
        PUBLIC_ORIGIN: "https://play.example.com/path",
      }),
    ).toThrow(/no path/);
  });
});

describe("site metadata", () => {
  const assets = {
    "local/icon-192.png": "/_assets/local/icon-192.aaaa.png",
    "local/icon-512.png": "/_assets/local/icon-512.bbbb.png",
    "local/icon-maskable-512.png": "/_assets/local/icon-maskable-512.cccc.png",
    "local/territory-lab-mark.svg":
      "/_assets/local/territory-lab-mark.dddd.svg",
    "local/social-card.png": "/_assets/local/social-card.eeee.png",
  };

  test("robots, sitemap and security.txt follow the public origin", () => {
    expect(robotsTxt(null)).toBe("User-agent: *\nAllow: /\n");
    expect(robotsTxt("https://play.example.com")).toContain(
      "Sitemap: https://play.example.com/sitemap.xml",
    );
    const sitemap = sitemapXml("https://play.example.com");
    expect(sitemap).toContain("<loc>https://play.example.com/</loc>");
    expect(sitemap).toContain("<loc>https://play.example.com/privacy</loc>");
    expect(sitemap).toContain("<loc>https://play.example.com/terms</loc>");
    const security = securityTxt(
      "https://play.example.com",
      "ops@example.com",
      new Date("2026-09-11T00:00:00Z"),
    );
    expect(security).toContain("Contact: mailto:ops@example.com");
    expect(security).toContain("Expires: 2027-09-11T00:00:00.000Z");
    expect(
      securityTxt("https://play.example.com", "https://example.com/contact"),
    ).toContain("Contact: https://example.com/contact");
  });

  test("the web manifest resolves hashed icons and declares a maskable one", () => {
    const manifest = webManifest(assets);
    expect(manifest.name).toBe("Terrannex");
    expect(manifest.start_url).toBe("/");
    expect(manifest.icons.map((icon) => icon.src)).toEqual([
      "/_assets/local/icon-192.aaaa.png",
      "/_assets/local/icon-512.bbbb.png",
      "/_assets/local/icon-maskable-512.cccc.png",
      "/_assets/local/territory-lab-mark.dddd.svg",
    ]);
    expect(manifest.icons[2].purpose).toBe("maskable");
    expect(canonicalHref(null)).toBe("/");
    expect(canonicalHref("https://play.example.com")).toBe(
      "https://play.example.com/",
    );
    expect(
      absoluteAssetUrl(
        "https://play.example.com",
        "local/social-card.png",
        assets,
      ),
    ).toBe("https://play.example.com/_assets/local/social-card.eeee.png");
    expect(absoluteAssetUrl(null, "local/social-card.png", assets)).toBe(
      "/_assets/local/social-card.eeee.png",
    );
  });

  // Terrannex-owned art is not in the public repository (TERRANNEX_ASSETS.md).
  test.skip("the icon files exist in the repository", async () => {
    for (const file of [
      "icon-192.png",
      "icon-512.png",
      "icon-maskable-512.png",
      "apple-touch-icon.png",
      "social-card.png",
      "favicon-48.png",
      "favicon-96.png",
    ]) {
      const stat = await fs.stat(
        path.join(process.cwd(), "resources/local", file),
      );
      expect(stat.size).toBeGreaterThan(1000);
    }
  });

  test("favicon.ico is a real icon with 16, 32 and 48px images", async () => {
    const ico = await fs.readFile(
      path.join(process.cwd(), "resources/favicon.ico"),
    );
    // ICONDIR: reserved 0, type 1 (icon), then the image count.
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    const widths = Array.from({ length: count }, (_, i) =>
      ico.readUInt8(6 + 16 * i),
    );
    expect(widths).toEqual([16, 32, 48]);
  });
});

describe("legal pages", () => {
  test("render the operator's values into both templates", async () => {
    const values = {
      operatorName: "Example Studio",
      operatorContact: "ops@example.com",
      publicOrigin: "https://play.example.com",
      sourceUrl: "https://github.com/example/territory-lab",
      faviconHref: "/_assets/local/territory-lab-mark.dddd.svg",
      adsense: false,
    };
    const privacy = await renderLegalPage("privacy", values);
    expect(privacy).toContain("<title>Privacy notice — Terrannex</title>");
    expect(privacy).toContain("Example Studio");
    expect(privacy).toContain("ops@example.com");
    expect(privacy).toContain("local storage");
    expect(privacy).toContain("anonymised");
    expect(privacy).toContain(`Document version ${LEGAL_TEMPLATE_VERSION}`);
    const terms = await renderLegalPage("terms", values);
    expect(terms).toContain("<title>Terms of use — Terrannex</title>");
    expect(terms).toContain("https://github.com/example/territory-lab");
    expect(terms).toContain("GNU Affero General Public License");
    expect(terms).not.toContain("<%");
  });
});

describe("hosted routes", () => {
  async function serve(): Promise<{
    url: string;
    close: () => Promise<void>;
  }> {
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
      close: () => new Promise((resolve) => server.close(() => resolve())),
    };
  }

  test("serve discovery, install and legal surfaces in the hosted profile", async () => {
    stubHosted();
    const { url, close } = await serve();
    try {
      const robots = await (await fetch(`${url}/robots.txt`)).text();
      expect(robots).toContain("Sitemap: https://play.example.com/sitemap.xml");
      const sitemap = await fetch(`${url}/sitemap.xml`);
      expect(sitemap.status).toBe(200);
      expect(sitemap.headers.get("content-type")).toContain("application/xml");
      expect(await sitemap.text()).toContain("https://play.example.com/terms");
      const security = await (
        await fetch(`${url}/.well-known/security.txt`)
      ).text();
      expect(security).toContain("Contact: mailto:ops@example.com");
      const manifest = await fetch(`${url}/manifest.webmanifest`);
      expect(manifest.headers.get("content-type")).toContain(
        "application/manifest+json",
      );
      const body = (await manifest.json()) as {
        name: string;
        icons: unknown[];
      };
      expect(body.name).toBe("Terrannex");
      expect(body.icons).toHaveLength(4);
      const privacy = await fetch(`${url}/privacy`);
      expect(privacy.status).toBe(200);
      expect(privacy.headers.get("content-type")).toContain("text/html");
      const privacyHtml = await privacy.text();
      expect(privacyHtml).toContain("Example Studio");
      expect(privacyHtml).toContain("ops@example.com");
      const terms = await fetch(`${url}/terms`);
      expect(terms.status).toBe(200);
      expect(await terms.text()).toContain("Terms of use");
    } finally {
      await close();
    }
  });

  test("keep only robots and the manifest in the private local profile", async () => {
    for (const name of Object.keys(hostedEnv)) {
      if (!(name in localEnv)) vi.stubEnv(name, "");
    }
    const { url, close } = await serve();
    try {
      const robots = await (await fetch(`${url}/robots.txt`)).text();
      expect(robots).toBe("User-agent: *\nAllow: /\n");
      expect((await fetch(`${url}/sitemap.xml`)).status).toBe(404);
      expect((await fetch(`${url}/privacy`)).status).toBe(404);
      expect((await fetch(`${url}/terms`)).status).toBe(404);
      expect((await fetch(`${url}/.well-known/security.txt`)).status).toBe(404);
      expect((await fetch(`${url}/manifest.webmanifest`)).status).toBe(200);
    } finally {
      await close();
    }
  });
});

describe("app shell metadata", () => {
  let tempDir: string | null = null;
  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  async function shell(): Promise<string> {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hosted-shell-"));
    const htmlPath = path.join(tempDir, "index.html");
    await fs.writeFile(
      htmlPath,
      [
        "<title><%- documentTitle %></title>",
        '<meta name="description" content="<%- metaDescription %>" />',
        '<link rel="canonical" href="<%- canonicalHref %>" />',
        '<meta property="og:url" content="<%- canonicalHref %>" />',
        '<meta property="og:image" content="<%- ogImageUrl %>" />',
        '<link rel="manifest" href="<%- manifestHref %>" />',
        "<script>hosted=<%- hosted %>;origin=<%- publicOrigin %>;source=<%- sourceUrl %>;</script>",
      ].join("\n"),
      "utf8",
    );
    return getAppShellContent(htmlPath);
  }

  test("renders canonical and social tags once the origin is known", async () => {
    vi.stubEnv("NUM_WORKERS", "1");
    stubHosted();
    const html = await shell();
    expect(html).toContain(`<title>${HOSTED_DOCUMENT_TITLE}</title>`);
    expect(html).toContain(
      '<link rel="canonical" href="https://play.example.com/" />',
    );
    expect(html).toContain(
      '<meta property="og:url" content="https://play.example.com/" />',
    );
    expect(html).toMatch(/og:image" content="https:\/\/play\.example\.com\//);
    expect(html).toContain('href="/manifest.webmanifest"');
    expect(html).toContain('hosted=true;origin="https://play.example.com"');
    expect(html).toContain('source="https://github.com/example/territory-lab"');
  });

  test("stays private without a public origin", async () => {
    vi.stubEnv("NUM_WORKERS", "1");
    vi.stubEnv("DOMAIN", "localhost");
    vi.stubEnv("TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
    vi.stubEnv("PUBLIC_ORIGIN", "");
    vi.stubEnv("SOURCE_URL", "");
    const html = await shell();
    expect(html).toContain(`<title>${LOCAL_DOCUMENT_TITLE}</title>`);
    expect(html).toContain('<link rel="canonical" href="/" />');
    expect(html).toContain('<meta property="og:url" content="/" />');
    expect(html).toContain("hosted=false;origin=null;source=null");
  });
});
