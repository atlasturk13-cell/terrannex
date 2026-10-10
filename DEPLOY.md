# Deploying Territory Lab (self-hosted)

This document covers what the repository does for you and what only you, the
operator, can do. The code side is complete: one command builds and runs the
audited self-contained profile behind automatic TLS, and one variable turns it
into a public site with its discovery, install and legal surfaces. The legal
side is not something the code can decide; the operator gates are listed at
the end.

## What ships

| Piece                                                                                   | Status |
| --------------------------------------------------------------------------------------- | ------ |
| Rootless multi-stage image (`Dockerfile`), nginx front, supervisord                     | ready  |
| `docker-compose.yml` with Caddy TLS terminator (`deploy/Caddyfile`)                     | ready  |
| Health endpoint `/api/health` (503 until workers are ready)                             | ready  |
| Graceful shutdown on SIGTERM/SIGINT (drains sockets, stops workers, bounded)            | ready  |
| Security headers, CSP, cache policy, optional HSTS (`ENABLE_HSTS=true`)                 | ready  |
| WebSocket Origin allowlist (`WS_ALLOWED_ORIGINS=same-origin`)                           | ready  |
| Per-IP rate limits, proxy-hop trust (`TRUST_PROXY_HOPS`, 1-4)                           | ready  |
| Fail-closed asset allowlist (only audited maps, fonts, sprites, images)                 | ready  |
| Bare-host start (`pnpm start:prod`, `BIND_HOST` override)                               | ready  |
| Hosted profile: canonical + Open Graph metadata, `sitemap.xml`, `robots.txt`            | ready  |
| PWA manifest with 192/512/maskable PNG icons, Apple touch icon, social card             | ready  |
| `/privacy`, `/terms`, `/.well-known/security.txt` rendered with the operator's identity | ready  |
| AGPL source offer (`SOURCE_URL`) linked from the footer, About page and terms           | ready  |
| Main menu, About page, pause menu; no ad or analytics script unless `ADSENSE_CLIENT`    | ready  |

## Quick start (one VPS, Docker, your domain)

The step-by-step version for the day the domain exists is `DOMAIN_SWITCH.md`;
`sh scripts/set-domain.sh <domain> ...` writes the `.env` described below.

1. Point `A`/`AAAA` records for your hostname at the server.
2. Install Docker Engine + the compose plugin.
3. Clone the repository, then:

```bash
cp deploy/.env.example .env
```

4. Edit `.env`:
   - `SITE_ADDRESS` — your hostname (Caddy requests the certificate for it).
   - `PUBLIC_ORIGIN` — `https://` + the same hostname. This switches on the
     hosted profile.
   - `SOURCE_URL` — the public repository of **this** build (your fork).
   - `OPERATOR_NAME`, `OPERATOR_CONTACT` — who runs the site and how players
     reach you.
   - `GIT_COMMIT` — the SHA you are deploying; `NUM_WORKERS` — 1–64.
5. Build and start:

```bash
docker compose up -d --build
```

6. Verify:

```bash
curl -fsS https:// < your-host > /api/health
curl -fsS https:// < your-host > /sitemap.xml
curl -fsS https:// < your-host > /privacy | grep -c "<title>"
```

Caddy obtains the certificate on first request (ports 80 and 443 must be open).
Logs: `docker compose logs -f game caddy`. Update: pull, then
`docker compose up -d --build` again; the old container drains for up to 15 s.

## Bare host without Docker

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm build:local
GIT_COMMIT=$(git rev-parse HEAD) BIND_HOST=127.0.0.1 pnpm start:prod
```

Put a reverse proxy (Caddy, nginx) in front of `127.0.0.1:3000` and the worker
ports `3001..300N`, forwarding `/wN/` paths to worker N. `TRUST_PROXY_HOPS`
must equal the number of proxies in front of Express. Set `BIND_HOST=0.0.0.0`
only if the proxy runs on another machine and the ports are firewalled. Add
the hosted variables (`PUBLIC_ORIGIN` and its four companions) to the
environment of that command to get the public surfaces.

## Platforms that run a Dockerfile (no Compose)

Fly.io, Railway, Render and similar services build the `Dockerfile` directly
and terminate TLS themselves. Deploy the image with the same environment as
the compose file (`LOCAL_ONLY=true`, `GAME_ENV=dev`, `DOMAIN=localhost`,
`TURNSTILE_SITE_KEY=1x00000000000000000000AA`, `NUM_WORKERS`, `GIT_COMMIT`,
`ENABLE_HSTS=true`, `WS_ALLOWED_ORIGINS=same-origin`, the hosted variables)
and `TRUST_PROXY_HOPS=2` (platform proxy + the in-image nginx). The container
listens on 8080 and needs WebSocket pass-through and sticky routing by path
(`/wN/`), which the in-image nginx provides.

Railway specifics: point the public domain at port 8080, attach a volume at
`/usr/src/app/data` (accounts database and session secret) and set
`RAILWAY_RUN_UID=0` so the process can write to that root-owned volume.
`SESSION_SECRET=auto` lets the server create and keep its own secret on the
volume, so no secret is typed into the dashboard.

## Environment reference

| Variable             | Default                | Notes                                                                                                                                     |
| -------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `LOCAL_ONLY`         | `true`                 | The only supported value for this build.                                                                                                  |
| `GAME_ENV`           | `dev`                  | Required. `prod`/`staging` need the closed-source API.                                                                                    |
| `DOMAIN`             | `localhost`            | Required by the profile; the public hostname lives in Caddy and `PUBLIC_ORIGIN`.                                                          |
| `NUM_WORKERS`        | `1`                    | 1-64 game worker processes.                                                                                                               |
| `TRUST_PROXY_HOPS`   | `1`                    | Reverse proxies in front of Express: nginx alone = 1, Caddy + nginx = 2.                                                                  |
| `TURNSTILE_SITE_KEY` | test key               | Must stay the public Turnstile test key (no bot check in this profile).                                                                   |
| `ENABLE_HSTS`        | unset                  | `true` only behind TLS; mandatory when `PUBLIC_ORIGIN` is `https://…`.                                                                    |
| `WS_ALLOWED_ORIGINS` | unset                  | `same-origin` or comma list; unset disables the check (dev); mandatory when hosted.                                                       |
| `BIND_HOST`          | unset                  | Listener address override for bare hosts.                                                                                                 |
| `GIT_COMMIT`         | `unknown`              | Shown at `/commit.txt`.                                                                                                                   |
| `PUBLIC_ORIGIN`      | unset                  | `https://host` (no path). Set = hosted profile: metadata, sitemap, legal pages.                                                           |
| `SOURCE_URL`         | unset                  | Public repository of this build (AGPL §13). Required when hosted; linked in the UI.                                                       |
| `OPERATOR_NAME`      | unset                  | Person or organisation running the site. Required when hosted; printed on the pages.                                                      |
| `OPERATOR_CONTACT`   | unset                  | E-mail or URL. Required when hosted; printed on the pages and in `security.txt`.                                                          |
| `MULTIPLAYER`        | `false`                | `true` shows the multiplayer entry (public lobbies and private lobbies without an API).                                                   |
| `SUBDOMAIN`          | `prod`                 | Free-text label for this instance.                                                                                                        |
| `ADSENSE_CLIENT`     | unset                  | AdSense publisher id `ca-pub-…` (16 digits). Hosted profile only. See "Google AdSense".                                                   |
| `ADSENSE_MENU_SLOT`  | unset                  | Numeric id of a Display ad unit shown under the main menu. Needs `ADSENSE_CLIENT`.                                                        |
| `SESSION_SECRET`     | unset                  | ≥ 32 random characters, or `auto` (generated once, kept next to `ACCOUNTS_DB`): turns on player accounts and progression. See "Accounts". |
| `ACCOUNTS_DB`        | `data/accounts.sqlite` | SQLite file for accounts (Compose mounts the `game_data` volume there).                                                                   |
| `GOOGLE_CLIENT_ID`   | unset                  | OAuth client id (web) for "Sign in with Google". Needs `SESSION_SECRET`.                                                                  |

Rejected on purpose (the container exits 64): `CDN_BASE`, `API_KEY`,
`API_DOMAIN`, `ADMIN_BOT_API_KEY`, `STRIPE_PUBLISHABLE_KEY`, `OTEL_*`,
`TELEMETRY_*`, `LOCAL_ONLY=false`, `DOMAIN` other than `localhost`, and a
`PUBLIC_ORIGIN` without `SOURCE_URL`, `OPERATOR_NAME`, `OPERATOR_CONTACT` and
`WS_ALLOWED_ORIGINS` (or without `ENABLE_HSTS=true` over https).

## The hosted profile

Setting `PUBLIC_ORIGIN` changes nothing about the game and adds the surfaces
a public site needs:

- `<link rel="canonical">`, Open Graph and Twitter card tags on the app shell
  (title, description, social card image at `/local/social-card.png`).
- `/manifest.webmanifest` rendered by the server with the hashed icon URLs of
  the build (192/512 PNG, 512 maskable, SVG mark) plus the Apple touch icon
  link; the icons are rasterised from the original brand mark.
- `/robots.txt` with the sitemap line, `/sitemap.xml` listing `/`,
  `/privacy` and `/terms`, and `/.well-known/security.txt` with your contact.
- `/privacy` and `/terms`: self-contained pages rendered from the templates
  in `src/server/legal/` with your `OPERATOR_NAME`, `OPERATOR_CONTACT`,
  `PUBLIC_ORIGIN` and `SOURCE_URL`. They describe exactly what this software
  does (no accounts, a browser-local identifier, anonymised IP logs, no
  trackers) and carry a template version. **Read them before launch**; if
  your jurisdiction or hosting setup needs more, edit the templates — they
  are part of the source you publish.
- Footer and About page links to the two pages; the source link everywhere
  points at `SOURCE_URL`.

Without `PUBLIC_ORIGIN` (a private local run) none of these appear except
`robots.txt` and the manifest.

## Accounts and progression

Off by default: without `SESSION_SECRET` the main menu has no sign-in entry,
`/api/account/*` answers 503 and every player is a guest with the
browser-local identifier, exactly as before. Setting it:

- adds a sign-in entry at the top left of the main menu: email + password
  (scrypt-hashed) and, with `GOOGLE_CLIENT_ID`, "Sign in with Google";
- stores accounts in one SQLite file (`ACCOUNTS_DB`; Node's built-in
  `node:sqlite`, no extra service — Supabase or Postgres are not needed);
- awards experience for finished multiplayer matches (agreed result, ≥ 2
  human players, ≥ 2 distinct addresses, ≥ 3 minutes; once per game) and
  gives each level a small head start in the next match (+0.5 % troops,
  +1 % gold per level, one extra ring of starting land every ten levels,
  capped at level 30);
- adds an "Optional player account" section to `/privacy`;
- with `GOOGLE_CLIENT_ID`, allows accounts.google.com's sign-in script and
  iframe in the Content-Security-Policy.

Google Cloud Console steps for the client id: APIs & Services → Credentials
→ Create credentials → OAuth client ID → Web application; add your origin
(`https://your-host`, and `http://localhost:9000` for local play) to
"Authorised JavaScript origins"; no redirect URI is needed (popup mode);
configure the OAuth consent screen (app name, support email) and publish
it. Paste the client id into `GOOGLE_CLIENT_ID`.

Keep `SESSION_SECRET` stable: changing it signs everyone out. Back up the
`game_data` volume with the rest of the host.

## Google AdSense

Off by default: without `ADSENSE_CLIENT` the site serves no ad tag, no
`ads.txt`, the self-only CSP and a privacy notice that says there are no ads.
Setting it (hosted profile only; a private local run refuses to boot with it)
switches on, together:

- the site-ownership `<meta name="google-adsense-account">` tag and the
  AdSense loader in the app shell;
- `/ads.txt` with the single line
  `google.com, pub-…, DIRECT, f08c47fec0942fa0`;
- the Content-Security-Policy additions AdSense and Google's consent message
  need (`script-src`, `frame-src`, `connect-src`, `img-src https:`); the
  policy comes from Express only, nginx no longer sends its own copy;
- an "Advertising (Google AdSense)" section in `/privacy` (cookies,
  personalised ads, consent, opt-out links).

`ADSENSE_MENU_SLOT` adds one labelled responsive Display ad under the main
menu entries. The menu is never visible during a match, so ads never cover
the game.

Operator steps in the AdSense dashboard:

1. Sign up at adsense.google.com with the site's root domain, then set
   `ADSENSE_CLIENT` to the `ca-pub-…` id it shows and restart; choose the
   "AdSense code snippet" or "Meta tag" verification — both are already on the
   page.
2. Privacy & messaging → create and publish the **European regulations**
   message (Google's certified consent platform, required for EEA/UK/CH
   visitors). The loader shows it by itself; no code change.
3. Request review. After approval turn **Auto ads off** for the site (Auto ads
   could place ads over the game canvas), create one Display ad unit and set
   its id as `ADSENSE_MENU_SLOT`.
4. Never click your own ads or ask players to.

## Go-live checklist

- [ ] `pnpm test`, `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build` green.
- [ ] `.env` complete: `SITE_ADDRESS`, `PUBLIC_ORIGIN`, `SOURCE_URL`,
      `OPERATOR_NAME`, `OPERATOR_CONTACT`, `GIT_COMMIT`, `NUM_WORKERS`;
      optional `SESSION_SECRET` (+ `GOOGLE_CLIENT_ID`) for accounts.
- [ ] Your fork is public at `SOURCE_URL` and contains this exact build.
- [ ] `/privacy` and `/terms` read and accepted by you (edit the templates if
      needed).
- [ ] Licensing decision recorded in `BLOCKERS.md` (see below).
- [ ] `docker compose up -d --build` healthy; `/api/health` returns `ok`;
      `/sitemap.xml`, `/privacy`, `/manifest.webmanifest` answer 200 over
      https; the certificate is valid.
- [ ] Optional: `MULTIPLAYER=true` after a two-browser test on your host.

## What this profile is

A public **single-player** game with an optional multiplayer entry
(`MULTIPLAYER=true`): public lobbies scheduled by this server on the admitted
maps and link-share private lobbies, without accounts, cosmetics, stats or a
Turnstile bot check, because all of those live in a closed-source API that is
not part of this repository. Players are identified by a persistent browser
ID only.

## What only you can do

1. **Licensing (blocking).** `BLOCKERS.md` records that inherited HUD icon and
   sprite-atlas families still lack file-level provenance. Either establish
   that chain, replace them with original art, or accept the risk. The repo
   cannot make this call. (The ships, jets, airframe pictures, icons and the
   social card added in September 2026 are original.)
2. **AGPL-3.0 network source offer.** Publish your fork and set `SOURCE_URL`
   to it; the footer, the About page and the terms page link it.
3. **Privacy notice and terms.** The generated pages state what the software
   does and name you as the operator. Review them; adapt the templates for
   anything specific to your jurisdiction or hosting provider.
4. **Domain, DNS, hosting account, TLS.** Any VPS with Docker works. Caddy
   handles certificates; nothing in the repository terminates TLS itself.
5. **Reverse-proxy topology.** Decide how many proxies sit in front of Express
   and set `TRUST_PROXY_HOPS` accordingly, or rate limiting will treat every
   player as one IP.
6. **Accounts, anti-bot verification, cosmetics.** These require the
   closed-source API (`api.<domain>`), its JWKS and `/join_verify`; you would
   have to build or license it and then run with `LOCAL_ONLY=false`, which
   also switches assets and branding. This is a separate project, not a
   configuration flag.
7. **Trademark.** Keep the fork identity ("Territory Lab"); do not enable the
   upstream branding path.
