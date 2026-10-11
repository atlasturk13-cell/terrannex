import ejs from "ejs";
import type { Response } from "express";
import fs from "fs/promises";
import { buildAssetUrl } from "../core/AssetUrls";
import { adSenseScriptSrc, adSenseSettings } from "./AdSense";
import { setNoStoreHeaders } from "./NoStoreHeaders";
import { getRuntimeAssetManifest } from "./RuntimeAssetManifest";
import { ServerEnv } from "./ServerEnv";
import {
  absoluteAssetUrl,
  APPLE_TOUCH_ICON,
  canonicalHref,
  FAVICON_48,
  FAVICON_96,
  HOSTED_DOCUMENT_TITLE,
  LOCAL_DOCUMENT_TITLE,
  SITE_DESCRIPTION,
  SITE_NAME,
  SOCIAL_CARD,
} from "./SiteMetadata";

const APP_SHELL_CACHE_CONTROL =
  "public, max-age=0, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400";

const appShellContentCache = new Map<string, Promise<string>>();

export async function renderHtmlContent(htmlPath: string): Promise<string> {
  const htmlContent = await fs.readFile(htmlPath, "utf-8");
  const assetManifest = await getRuntimeAssetManifest();
  const localOnly = process.env.LOCAL_ONLY !== "false";
  const configuredCdnBase = ServerEnv.cdnBase();
  if (localOnly && configuredCdnBase !== "") {
    throw new Error("CDN_BASE is not supported by the local asset profile");
  }
  const cdnBase = localOnly ? "" : configuredCdnBase;
  const publicOrigin = ServerEnv.publicOrigin();
  const hosted = publicOrigin !== null;
  // Boot validation guarantees AdSense only ever comes with the hosted profile.
  const adsense = hosted ? adSenseSettings() : null;
  return ejs.render(htmlContent, {
    hosted,
    adsenseClient: adsense?.client ?? "",
    adsenseScriptSrc: adsense ? adSenseScriptSrc(adsense.client) : "",
    adsense: JSON.stringify(adsense),
    publicOrigin: JSON.stringify(publicOrigin),
    siteName: SITE_NAME,
    metaDescription: SITE_DESCRIPTION,
    canonicalHref: canonicalHref(publicOrigin),
    ogImageUrl: absoluteAssetUrl(
      publicOrigin,
      SOCIAL_CARD,
      assetManifest,
      cdnBase,
    ),
    appleTouchIconHref: buildAssetUrl(APPLE_TOUCH_ICON, assetManifest, cdnBase),
    favicon48Href: buildAssetUrl(FAVICON_48, assetManifest, cdnBase),
    favicon96Href: buildAssetUrl(FAVICON_96, assetManifest, cdnBase),
    gitCommit: JSON.stringify(ServerEnv.gitCommit()),
    assetManifest: JSON.stringify(assetManifest),
    cdnBase: JSON.stringify(cdnBase),
    // Raw (unquoted) value for use as a URL prefix in the index.html template,
    // e.g. <script src="<%- cdnBaseRaw %>/assets/index-XXX.js">. The Vite
    // build plugin inject-cdn-base-template rewrites Vite's emitted /assets/
    // refs to use this placeholder.
    cdnBaseRaw: cdnBase,
    gameEnv: JSON.stringify(ServerEnv.gameEnvName()),
    numWorkers: JSON.stringify(ServerEnv.numWorkers()),
    turnstileSiteKey: JSON.stringify(ServerEnv.turnstileSiteKey()),
    jwtAudience: JSON.stringify(ServerEnv.jwtAudience()),
    instanceId: JSON.stringify(ServerEnv.instanceId()),
    localOnly,
    multiplayer: ServerEnv.multiplayerEnabled(),
    sourceUrl: JSON.stringify(ServerEnv.sourceUrl()),
    documentTitle: localOnly
      ? hosted
        ? HOSTED_DOCUMENT_TITLE
        : LOCAL_DOCUMENT_TITLE
      : "OpenFront (ALPHA)",
    // The manifest is rendered by the server so its icon URLs always match
    // the hashed assets of this build.
    manifestHref: "/manifest.webmanifest",
    faviconHref: buildAssetUrl(
      localOnly ? "local/territory-lab-mark.svg" : "images/Favicon.svg",
      assetManifest,
      cdnBase,
    ),
    gameplayScreenshotUrl: buildAssetUrl(
      "images/GameplayScreenshot.png",
      assetManifest,
      cdnBase,
    ),
    localSetupBackgroundImageUrl: localOnly
      ? buildAssetUrl(
          "images/LocalSetupSatelliteBackground.png",
          assetManifest,
          cdnBase,
        )
      : "",
    backgroundImageUrl: localOnly
      ? ""
      : buildAssetUrl("images/background.webp", assetManifest, cdnBase),
    desktopLogoImageUrl: buildAssetUrl(
      localOnly ? "local/territory-lab-mark.svg" : "images/OpenFront.png",
      assetManifest,
      cdnBase,
    ),
    mobileLogoImageUrl: buildAssetUrl(
      localOnly ? "local/territory-lab-mark.svg" : "images/OF.png",
      assetManifest,
      cdnBase,
    ),
  });
}

export async function getAppShellContent(htmlPath: string): Promise<string> {
  let cachedContent = appShellContentCache.get(htmlPath);
  if (!cachedContent) {
    cachedContent = renderHtmlContent(htmlPath).catch((error: unknown) => {
      appShellContentCache.delete(htmlPath);
      throw error;
    });
    appShellContentCache.set(htmlPath, cachedContent);
  }
  return cachedContent;
}

export function clearAppShellContentCache(): void {
  appShellContentCache.clear();
}

export function setAppShellCacheHeaders(res: Response): void {
  res.setHeader("Cache-Control", APP_SHELL_CACHE_CONTROL);
  res.setHeader("Content-Type", "text/html");
}

export function setHtmlNoCacheHeaders(res: Response): void {
  setNoStoreHeaders(res);
  res.setHeader("ETag", "");
  res.setHeader("Content-Type", "text/html");
}

export async function renderAppShell(
  res: Response,
  htmlPath: string,
): Promise<void> {
  const rendered = await getAppShellContent(htmlPath);
  setAppShellCacheHeaders(res);
  res.send(rendered);
}
