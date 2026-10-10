// Builds the static single-player site for Vercel (Build Output API) from
// the already built `static/` directory. Writes files only; deploys nothing.
//
//   pnpm build:local && pnpm build:static
//
// Hosted profile (legal pages, sitemap, canonical URLs) when PUBLIC_ORIGIN —
// or, on Vercel, the project's production URL — is set; then SOURCE_URL,
// OPERATOR_NAME and OPERATOR_CONTACT are required. ADSENSE_CLIENT /
// ADSENSE_MENU_SLOT work as on the server.
import path from "path";
import { fileURLToPath } from "url";
import { staticSiteEnv } from "../server/StaticSiteEnv";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
Object.assign(process.env, staticSiteEnv(process.env));

const { writeStaticSite } = await import("../server/StaticSite");
const outputDir =
  process.env.STATIC_SITE_OUT ?? path.join(root, ".vercel", "output");
const result = await writeStaticSite(path.join(root, "static"), outputDir);
console.log(
  `static site: ${result.files} files in ${path.relative(root, result.outputDir)} ` +
    `(hosted profile: ${result.hosted ? "on" : "off"}, AdSense: ${result.adsense ? "on" : "off"}, multiplayer: off)`,
);
