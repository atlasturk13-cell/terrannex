# Moving the game to your domain

Everything the code needs to run under a domain is one environment file.
This runbook is the exact procedure for the moment the domain exists; the
technical part takes a few minutes, DNS propagation may take longer.

## What you need before starting

- A server with Docker Engine and the compose plugin (any small VPS works).
- The repository cloned on that server at the commit you want to run.
- The domain (for example `play.example.com`) and access to its DNS.
- The public URL of your fork of this repository (`SOURCE_URL`), your name
  or organisation and a contact e-mail (`OPERATOR_NAME`, `OPERATOR_CONTACT`).
  These are printed on the privacy and terms pages and are mandatory: the
  container refuses to start a public origin without them.

## The procedure

1. On the server, in the repository, write the environment file:

```bash
sh scripts/set-domain.sh play.example.com \
  --source-url https://github.com/you/your-fork \
  --operator-name "Your Studio" \
  --operator-contact you@example.com
```

The script validates the hostname, keeps any values you set earlier,
writes `.env` (backing up the previous one to `.env.bak`), sets
`PUBLIC_ORIGIN=https://play.example.com`, `WS_ALLOWED_ORIGINS=same-origin`,
`MULTIPLAYER=true` (pass `--multiplayer false` for single-player only) and
the current commit, and prints the remaining steps.

2. DNS: create an `A` record (and `AAAA` if the server has IPv6) for the
   hostname pointing at the server's public IP. Open TCP 80/443 (and UDP 443)
   in the firewall.

3. Start the stack:

```bash
docker compose up -d --build
```

Caddy obtains the TLS certificate on the first request once DNS resolves.

4. Verify:

```bash
sh scripts/set-domain.sh play.example.com --check
```

The check prints the DNS answers and the HTTP status of `/api/health`,
`/sitemap.xml`, `/privacy` and `/manifest.webmanifest`. Health must be 200.

5. Open `https://play.example.com`: the main menu, About page (with the
   source link), footer legal links, and the multiplayer page (if enabled)
   should all be there. `curl -I https://play.example.com/` shows the
   canonical link and security headers.

## Changing the domain later

Run step 1 with the new hostname; the operator values are kept from the
existing `.env`. Update DNS, then `docker compose up -d`. Caddy requests a
certificate for the new name; the old one is simply no longer served.

## A staging run first

Point a second hostname (for example `staging.example.com`) at the same or
another server, run the script with `--env-file .env.staging`, and start it
with `docker compose --env-file .env.staging up -d --build` on that machine.
The hosted checks are identical; only the operator values differ if you want
them to.

## Platforms without Compose

On Fly.io, Railway, Render and similar services, deploy the `Dockerfile` and
set the same variables in the platform's environment (see `DEPLOY.md`,
"Platforms that run a Dockerfile"), with `TRUST_PROXY_HOPS=2`. The platform
gives you the hostname; run `scripts/set-domain.sh <hostname> --dry-run` to
print the variable block and paste it into the platform settings.

## Rollback

`.env.bak` holds the previous environment; restore it and `docker compose up
-d`. The game code itself is unaffected by the domain switch; a code rollback
is a `git checkout` of the previous commit followed by `docker compose up -d
--build`.
