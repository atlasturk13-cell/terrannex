/**
 * Static single-player site: everything the Express server would answer,
 * rendered once at build time, so the game can sit on a static host (Vercel,
 * via the Build Output API). Single-player runs entirely in the browser
 * (LocalServer), so nothing is lost except multiplayer, which needs the
 * WebSocket game server and is therefore always switched off here.
 *
 * Nothing is deployed by this module; it only writes files.
 */
import fs from "fs";
import path from "path";
import { buildAssetUrl } from "../core/AssetUrls";
import { adSenseSettings, adsTxt } from "./AdSense";
import { renderLegalPage } from "./HostedRoutes";
import { assertHostedProfile } from "./LocalRuntimeBoundary";
import { renderHtmlContent } from "./RenderHtml";
import { getRuntimeAssetManifest } from "./RuntimeAssetManifest";
import { contentSecurityPolicy } from "./SecurityHeaders";
import { ServerEnv } from "./ServerEnv";
import {
  BRAND_MARK,
  robotsTxt,
  securityTxt,
  sitemapXml,
  webManifest,
} from "./SiteMetadata";

type Header = { key: string; value: string };

function securityHeaders(adsense: boolean, hsts: boolean): Header[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(adsense) },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    ...(hsts
      ? [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ]
      : []),
  ];
}

const asObject = (headers: Header[]): Record<string, string> =>
  Object.fromEntries(headers.map(({ key, value }) => [key, value]));

/**
 * Vercel Build Output API v3 routing: security headers everywhere, immutable
 * caching for hashed assets, the clean legal URLs, then an app-shell
 * fallback for client routes (paths without a file extension only, so a
 * missing asset stays a 404 instead of turning into HTML).
 */
export function vercelOutputConfig(adsense: boolean, hsts: boolean) {
  return {
    version: 3,
    routes: [
      {
        src: "/(.*)",
        headers: asObject(securityHeaders(adsense, hsts)),
        continue: true,
      },
      {
        src: "/(_assets|assets)/(.*)",
        headers: { "Cache-Control": "public, max-age=31536000, immutable" },
        continue: true,
      },
      {
        src: "/(index\\.html)?",
        headers: { "Cache-Control": "public, max-age=0, must-revalidate" },
        continue: true,
      },
      { handle: "filesystem" },
      { src: "/privacy", dest: "/privacy.html" },
      { src: "/terms", dest: "/terms.html" },
      { src: "/[^.]*", dest: "/index.html" },
    ],
  };
}

function copyDir(from: string, to: string, skip: Set<string>): number {
  let count = 0;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      count += copyDir(source, target, new Set());
    } else {
      fs.copyFileSync(source, target);
      count++;
    }
  }
  return count;
}

export interface StaticSiteResult {
  outputDir: string;
  files: number;
  hosted: boolean;
  adsense: boolean;
}

/**
 * Writes `<outputDir>/static/**` and `<outputDir>/config.json` from the
 * built `static/` directory (run `pnpm build:local` first).
 */
export async function writeStaticSite(
  staticDir: string,
  outputDir: string,
): Promise<StaticSiteResult> {
  assertHostedProfile(process.env);
  const templatePath = path.join(staticDir, "index.html");
  if (!fs.existsSync(path.join(staticDir, "asset-manifest.json"))) {
    throw new Error("static/ is not built: run `pnpm build:local` first");
  }
  const publicOrigin = ServerEnv.publicOrigin();
  const hosted = publicOrigin !== null;
  const adsense = hosted && adSenseSettings() !== null;
  const out = path.join(outputDir, "static");
  fs.rmSync(outputDir, { recursive: true, force: true });

  let files = copyDir(staticDir, out, new Set(["index.html"]));
  const write = (name: string, body: string) => {
    fs.mkdirSync(path.dirname(path.join(out, name)), { recursive: true });
    fs.writeFileSync(path.join(out, name), body);
    files++;
  };

  write("index.html", await renderHtmlContent(templatePath));
  const assetManifest = await getRuntimeAssetManifest();
  write(
    "manifest.webmanifest",
    JSON.stringify(webManifest(assetManifest, ServerEnv.cdnBase())),
  );
  write("robots.txt", robotsTxt(publicOrigin));

  if (hosted) {
    const operatorName = process.env.OPERATOR_NAME!.trim();
    const operatorContact = process.env.OPERATOR_CONTACT!.trim();
    const sourceUrl = ServerEnv.sourceUrl()!;
    write("sitemap.xml", sitemapXml(publicOrigin));
    write(
      ".well-known/security.txt",
      securityTxt(publicOrigin, operatorContact),
    );
    for (const kind of ["privacy", "terms"] as const) {
      write(
        `${kind}.html`,
        await renderLegalPage(kind, {
          publicOrigin,
          operatorName,
          operatorContact,
          sourceUrl,
          adsense,
          faviconHref: buildAssetUrl(BRAND_MARK, assetManifest, ""),
        }),
      );
    }
    const adsenseSettings = adSenseSettings();
    if (adsenseSettings !== null)
      write("ads.txt", adsTxt(adsenseSettings.client));
  }

  fs.writeFileSync(
    path.join(outputDir, "config.json"),
    JSON.stringify(
      vercelOutputConfig(adsense, process.env.ENABLE_HSTS === "true"),
      null,
      2,
    ) + "\n",
  );
  return { outputDir, files, hosted, adsense };
}
