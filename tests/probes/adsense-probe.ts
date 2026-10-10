// Evidence probe: serves the real app shell, headers and hosted routes with
// and without ADSENSE_CLIENT, and prints what a browser would receive.
import express from "express";
import http from "http";
import path from "path";
import {
  clearLegalPageCache,
  registerHostedRoutes,
} from "../../src/server/HostedRoutes";
import {
  clearAppShellContentCache,
  renderHtmlContent,
} from "../../src/server/RenderHtml";
import { securityHeadersMiddleware } from "../../src/server/SecurityHeaders";

const base = {
  NUM_WORKERS: "1",
  DOMAIN: "localhost",
  GAME_ENV: "dev",
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  PUBLIC_ORIGIN: "https://play.example.com",
  SOURCE_URL: "https://github.com/example/fork",
  OPERATOR_NAME: "Example",
  OPERATOR_CONTACT: "ops@example.com",
  WS_ALLOWED_ORIGINS: "same-origin",
  ENABLE_HSTS: "true",
};

async function probe(label: string, env: Record<string, string>) {
  Object.assign(process.env, base, env);
  clearLegalPageCache();
  clearAppShellContentCache();
  const app = express();
  app.use(securityHeadersMiddleware);
  registerHostedRoutes(app);
  app.get("/", async (_q, r) =>
    r.send(await renderHtmlContent(path.resolve("index.html"))),
  );
  app.use((_q, r) => r.status(404).send("404"));
  const server = http.createServer(app);
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}`;
  const shell = await fetch(`${url}/`);
  const html = await shell.text();
  const ads = await fetch(`${url}/ads.txt`);
  const privacy = await (await fetch(`${url}/privacy`)).text();
  console.log(`== ${label}`);
  console.log("CSP:", shell.headers.get("content-security-policy"));
  console.log(
    "head tags:",
    html.match(
      /<meta name="google-adsense-account"[^>]*>|<script[^>]*adsbygoogle[^>]*>/g,
    ) ?? "none",
  );
  console.log("bootstrap:", html.match(/adsense: [^\n]*/)?.[0]);
  console.log(
    "ads.txt:",
    ads.status,
    ads.status === 200 ? JSON.stringify(await ads.text()) : "",
  );
  console.log(
    "privacy mentions AdSense:",
    privacy.includes("Google AdSense"),
    "| says no advertising identifiers:",
    privacy.includes("no advertising identifiers"),
  );
  server.close();
}

await probe("hosted, ADSENSE_CLIENT unset", {
  ADSENSE_CLIENT: "",
  ADSENSE_MENU_SLOT: "",
});
await probe("hosted, ADSENSE_CLIENT set", {
  ADSENSE_CLIENT: "ca-pub-1234567890123456",
  ADSENSE_MENU_SLOT: "1234567890",
});
