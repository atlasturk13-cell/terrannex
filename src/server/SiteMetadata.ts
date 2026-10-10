import { AssetManifest, buildAssetUrl } from "../core/AssetUrls";

/**
 * Public identity of the site, shared by the app shell renderer, the hosted
 * routes (robots, sitemap, web manifest, security.txt) and the Vite dev
 * shell. Pure: no Express, no environment reads.
 */
export const SITE_NAME = "Terrannex";
export const SITE_TAGLINE = "Real-time territorial strategy";
export const SITE_DESCRIPTION =
  "Terrannex is a free real-time territorial strategy game based on OpenFront: claim land, build ports, airports and defenses, send fleets and jets, and hold the map against nations and tribes.";
export const SITE_THEME_COLOR = "#0a1628";
export const SITE_BACKGROUND_COLOR = "#101828";

export const HOSTED_DOCUMENT_TITLE = `Terrannex — ${SITE_TAGLINE}`;
// One title for every profile: the private build is the same game.
export const LOCAL_DOCUMENT_TITLE = HOSTED_DOCUMENT_TITLE;

/** Icon files under resources/local, rasterised from the brand mark. */
export const ICON_192 = "local/icon-192.png";
export const ICON_512 = "local/icon-512.png";
export const ICON_MASKABLE_512 = "local/icon-maskable-512.png";
export const APPLE_TOUCH_ICON = "local/apple-touch-icon.png";
export const SOCIAL_CARD = "local/social-card.png";
export const BRAND_MARK = "local/territory-lab-mark.svg";

/** Pages a hosted deployment publishes besides the game itself. */
export const LEGAL_PATHS = ["/privacy", "/terms"] as const;

export function robotsTxt(publicOrigin: string | null): string {
  const lines = ["User-agent: *", "Allow: /"];
  if (publicOrigin !== null) lines.push(`Sitemap: ${publicOrigin}/sitemap.xml`);
  return lines.join("\n") + "\n";
}

export function sitemapXml(publicOrigin: string): string {
  const urls = ["/", ...LEGAL_PATHS].map(
    (route) => `  <url><loc>${publicOrigin}${route}</loc></url>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

/** RFC 9116 security.txt; the expiry is one year after the given date. */
export function securityTxt(
  publicOrigin: string,
  contact: string,
  now: Date = new Date(),
): string {
  const expires = new Date(now.getTime());
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  const contactLine = /^https?:\/\//.test(contact)
    ? contact
    : `mailto:${contact}`;
  return [
    `Contact: ${contactLine}`,
    `Expires: ${expires.toISOString()}`,
    `Canonical: ${publicOrigin}/.well-known/security.txt`,
    "Preferred-Languages: en, tr",
    "",
  ].join("\n");
}

export type WebManifest = {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: string;
  display_override: string[];
  orientation: string;
  lang: string;
  dir: string;
  categories: string[];
  theme_color: string;
  background_color: string;
  icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
};

/** The PWA manifest with icon URLs resolved through the hashed asset manifest. */
export function webManifest(
  assetManifest: AssetManifest,
  cdnBase = "",
): WebManifest {
  const url = (assetPath: string) =>
    buildAssetUrl(assetPath, assetManifest, cdnBase);
  return {
    id: "/",
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["fullscreen", "minimal-ui"],
    orientation: "any",
    lang: "en",
    dir: "auto",
    categories: ["games", "strategy"],
    theme_color: SITE_THEME_COLOR,
    background_color: SITE_BACKGROUND_COLOR,
    icons: [
      {
        src: url(ICON_192),
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: url(ICON_512),
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: url(ICON_MASKABLE_512),
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      { src: url(BRAND_MARK), sizes: "any", type: "image/svg+xml" },
    ],
  };
}

/**
 * The canonical URL of the site: the public origin's root once it is known,
 * otherwise the self-referential root of a private run. Always rendered
 * inside an attribute so the shell stays valid HTML for the bundler.
 */
export function canonicalHref(publicOrigin: string | null): string {
  return publicOrigin === null ? "/" : `${publicOrigin}/`;
}

/** Absolute URL for social previews when the origin is known. */
export function absoluteAssetUrl(
  publicOrigin: string | null,
  assetPath: string,
  assetManifest: AssetManifest,
  cdnBase = "",
): string {
  const relative = buildAssetUrl(assetPath, assetManifest, cdnBase);
  if (publicOrigin === null || /^https?:\/\//.test(relative)) return relative;
  return `${publicOrigin}${relative.startsWith("/") ? "" : "/"}${relative}`;
}
