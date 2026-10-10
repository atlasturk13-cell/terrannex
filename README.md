# Terrannex

Terrannex is a free, real-time territorial strategy game you play in the
browser: claim land, build an economy, raise ports, airports and defenses,
send fleets and jets, and hold the map against other players and nations.

**Play:** https://terrannex.com

Terrannex is based on [OpenFront](https://github.com/openfrontio/OpenFrontIO)
(© OpenFront and Contributors), which grew out of WarFront. It is an
independent game and not an official OpenFront product. Our thanks go to the
OpenFront team and contributors.

## What is in this repository

This is the source code of the game that runs on terrannex.com, published as
required by the GNU Affero General Public License v3.0.

- **Code** (client, server, simulation, tools) — AGPL-3.0, see [LICENSE](LICENSE).
  Code added for Terrannex is © 2026 Terrannex and also AGPL-3.0.
- **Inherited OpenFront assets** under `resources/` — CC BY-SA 4.0 and the
  credits listed in [CREDITS.md](CREDITS.md) and
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Terrannex artwork, music, logo and name are not included** and are not
  licensed to you. See [TERRANNEX_ASSETS.md](TERRANNEX_ASSETS.md). The
  repository ships neutral placeholders instead, so the game still builds and
  runs (`node scripts/placeholder-assets.mjs` recreates them).

## Running it locally

```bash
pnpm install
pnpm dev
```

Then open http://localhost:9000. See [DEPLOY.md](DEPLOY.md) for running your
own server.

## Forks

You may fork and run this code under the AGPL-3.0 (publish your changes when
you run it for others). You may **not** use the Terrannex name, logo,
artwork or music, and your fork must not present itself as Terrannex. Keep
the "© OpenFront and Contributors" notice visible, as OpenFront's license
requires.
