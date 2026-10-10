import ejs from "ejs";
import type { Express, Request, Response } from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { buildAssetUrl } from "../core/AssetUrls";
import { accountsService } from "./accounts/AccountsService";
import { adSenseSettings, adsTxt } from "./AdSense";
import { getRuntimeAssetManifest } from "./RuntimeAssetManifest";
import { ServerEnv } from "./ServerEnv";
import {
  BRAND_MARK,
  robotsTxt,
  securityTxt,
  SITE_NAME,
  sitemapXml,
  webManifest,
} from "./SiteMetadata";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const legalDir = path.join(__dirname, "legal");

/** Bumped whenever the legal templates change in substance. */
export const LEGAL_TEMPLATE_VERSION = "2026-10-02";

export type LegalKind = "privacy" | "terms";

export type LegalValues = {
  brand: string;
  title: string;
  operatorName: string;
  operatorContact: string;
  publicOrigin: string;
  sourceUrl: string;
  version: string;
  faviconHref: string;
  /** Google AdSense serves ads on the site (ADSENSE_CLIENT is set). */
  adsense: boolean;
  /** Player accounts exist on this server (SESSION_SECRET is set). */
  accounts?: boolean;
  /** "Sign in with Google" is offered (GOOGLE_CLIENT_ID is set). */
  googleSignIn?: boolean;
};

const LEGAL_TITLES: Record<LegalKind, string> = {
  privacy: "Privacy notice",
  terms: "Terms of use",
};

const renderedLegal = new Map<LegalKind, Promise<string>>();

export async function renderLegalPage(
  kind: LegalKind,
  values: Omit<LegalValues, "title" | "brand" | "version">,
): Promise<string> {
  const [pageTemplate, bodyTemplate] = await Promise.all([
    fs.readFile(path.join(legalDir, "page.ejs"), "utf8"),
    fs.readFile(path.join(legalDir, `${kind}.ejs`), "utf8"),
  ]);
  const full: LegalValues = {
    accounts: false,
    googleSignIn: false,
    ...values,
    brand: SITE_NAME,
    title: LEGAL_TITLES[kind],
    version: LEGAL_TEMPLATE_VERSION,
  };
  const body = ejs.render(bodyTemplate, full);
  return ejs.render(pageTemplate, { ...full, body });
}

export function clearLegalPageCache(): void {
  renderedLegal.clear();
}

/** The operator values a hosted deployment must provide (validated at boot). */
function hostedValues(): {
  publicOrigin: string;
  operatorName: string;
  operatorContact: string;
  sourceUrl: string;
  adsense: boolean;
  accounts: boolean;
  googleSignIn: boolean;
} | null {
  const publicOrigin = ServerEnv.publicOrigin();
  const operatorName = ServerEnv.operatorName();
  const operatorContact = ServerEnv.operatorContact();
  const sourceUrl = ServerEnv.sourceUrl();
  if (
    publicOrigin === null ||
    operatorName === null ||
    operatorContact === null ||
    sourceUrl === null
  ) {
    return null;
  }
  return {
    publicOrigin,
    operatorName,
    operatorContact,
    sourceUrl,
    adsense: adSenseSettings() !== null,
    accounts: accountsService() !== null,
    googleSignIn: (accountsService()?.googleClientId ?? null) !== null,
  };
}

function sendText(res: Response, type: string, body: string): void {
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(body);
}

/**
 * Discovery, install and legal surfaces of a deployment. The manifest and
 * robots.txt exist in every profile; the sitemap, security.txt, ads.txt and the legal
 * pages appear only once the operator values of the hosted profile are set.
 */
export function registerHostedRoutes(app: Express): void {
  app.get("/robots.txt", (_req: Request, res: Response) => {
    sendText(
      res,
      "text/plain; charset=utf-8",
      robotsTxt(ServerEnv.publicOrigin()),
    );
  });

  app.get("/manifest.webmanifest", async (_req: Request, res: Response) => {
    const assetManifest = await getRuntimeAssetManifest();
    res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(JSON.stringify(webManifest(assetManifest, ServerEnv.cdnBase())));
  });

  app.get("/sitemap.xml", (_req: Request, res: Response, next) => {
    const publicOrigin = ServerEnv.publicOrigin();
    if (publicOrigin === null) return next();
    sendText(res, "application/xml; charset=utf-8", sitemapXml(publicOrigin));
  });

  // Generated from ADSENSE_CLIENT; without it there is no ads.txt at all
  // (the upstream file naming another publisher is not shipped).
  app.get("/ads.txt", (_req: Request, res: Response, next) => {
    const adsense =
      ServerEnv.publicOrigin() === null ? null : adSenseSettings();
    if (adsense === null) return next();
    sendText(res, "text/plain; charset=utf-8", adsTxt(adsense.client));
  });

  app.get("/.well-known/security.txt", (_req: Request, res: Response, next) => {
    const values = hostedValues();
    if (values === null) return next();
    sendText(
      res,
      "text/plain; charset=utf-8",
      securityTxt(values.publicOrigin, values.operatorContact),
    );
  });

  for (const kind of ["privacy", "terms"] as const) {
    app.get(`/${kind}`, async (_req: Request, res: Response, next) => {
      const values = hostedValues();
      if (values === null) return next();
      try {
        let rendered = renderedLegal.get(kind);
        if (rendered === undefined) {
          const assetManifest = await getRuntimeAssetManifest();
          rendered = renderLegalPage(kind, {
            ...values,
            faviconHref: buildAssetUrl(
              BRAND_MARK,
              assetManifest,
              ServerEnv.cdnBase(),
            ),
          }).catch((error: unknown) => {
            renderedLegal.delete(kind);
            throw error;
          });
          renderedLegal.set(kind, rendered);
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=300");
        res.send(await rendered);
      } catch (error) {
        next(error);
      }
    });
  }
}
