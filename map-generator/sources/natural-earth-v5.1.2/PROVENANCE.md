# NaturalEarthWorld source provenance

- Dataset: Natural Earth 1:50m Admin 0 Countries, GeoJSON
- Upstream repository: `nvkelso/natural-earth-vector`
- Release: `v5.1.2`
- Pinned commit: `f1890d9f152c896d250a77557a5751a93d494776`
- Upstream path: `geojson/ne_50m_admin_0_countries.geojson`
- Source URL: <https://raw.githubusercontent.com/nvkelso/natural-earth-vector/f1890d9f152c896d250a77557a5751a93d494776/geojson/ne_50m_admin_0_countries.geojson>
- Source SHA-256: `3e458fc036ad0a66411f2c1e6cac49c5d7bfb81cb1123bc513b22511a2b7fdeb`
- Terms: Natural Earth declares all versions of its raster and vector map data public domain. See the pinned repository [`LICENSE.md`](https://github.com/nvkelso/natural-earth-vector/blob/f1890d9f152c896d250a77557a5751a93d494776/LICENSE.md) and [Natural Earth Terms of Use](https://www.naturalearthdata.com/about/terms-of-use/).

`../../scripts/generate_natural_earth_world.py` uses only this GeoJSON to
produce `assets/maps/naturalearthworld/image.png` and `info.json`. It uses
Pillow 10.4.0 as pinned in `requirements-natural-earth.txt`. The terrain is a
2000×1000 equirectangular raster. Nation names and interior coordinates are
derived from the dataset's `ADMIN` properties and polygon geometry. Nation
entries intentionally contain no `flag` field, and no flag assets are fetched.
After polygon rasterization, project-owned generator logic applies a named,
bounded strategic-waterway generalization for the Bosphorus, Dardanelles,
Strait of Gibraltar, and English Channel. The corridors clear complete 4×4
source-raster cells so the same water topology and projected routes survive the
production Normal and Compact minimap transforms. A one-pixel corridor probe
kept the minimap connected but returned land tiles from the authoritative
Normal water route; complete 4×4 cells are therefore the tested scale-safe
minimum. The Bosphorus now uses three cells instead of the first accepted
four-cell carve; the retired north-west cell retains land while both banks stay
separated. Dardanelles remains at its four-cell minimum. Baseline terrain at
commit `39e427ff` leaves Gibraltar closed at full and Normal resolution, and
the English Channel closed at full resolution, so both require their bounded
two-cell generalizations rather than audit-only checks. This is explicit
first-party cartographic generalization; it adds no external hydrography or
shoreline dataset.

Run `pnpm gen-map:natural-earth` from the repository root to create/use the
ignored Pillow 10.4.0 virtual environment, rasterize the pinned GeoJSON, run the
Go terrain generator in targeted `--terrain-only` mode, and format the two JSON
outputs. The command does not rewrite shared language or map-registry files.

Generated checksums:

- `image.png`: `3933e6eaaa56c1d0039702b21f23b2b1a05a35c64c8dcc7cc3bece94b98a2eac`
- `info.json`: `fe80fcd744a7c1a3f07e3aab9b2667fda140355e488bad427a4c1b4274271533`
- `resources/maps/naturalearthworld/map.bin`: `7eb2acf3bda3bd187d01aef28af657c3aa04ea3d315f1091c8ccc314b75a1c18`
- `resources/maps/naturalearthworld/map4x.bin`: `507ee0a7cbc29439171100ff73767449eb52dfd750d5e1b8af656d1de431d0e5`
- `resources/maps/naturalearthworld/map16x.bin`: `077ee2eb3e728e5903c532fe2fc9089365e50fba675e6ffedf1209708f8d8675`
- `resources/maps/naturalearthworld/thumbnail.webp`: `fd8c5b66e241a4c0ada492d91fd43da30e11267b6b73c004d450c4aa5d8ccaf1`
- `resources/maps/naturalearthworld/manifest.json`: `fc0eff4ca0adf1492ec3c2c1b0587b08072eff99dec1761dca8e4dd660d71b15`

Generated land counts are `679332` (full), `164994` (Normal minimap),
and `39473` (Compact minimap).

## Regional derivatives

`../../scripts/generate_natural_earth_regions.py` separately produces the five
admitted regional derivatives from this same pinned GeoJSON and Pillow 10.4.0.
It never reads an inherited map or flag. The crop bounds, English descriptions,
water-edge and waterway modification notes, exact source terms, terrain counts,
and SHA-256 hashes for every source/runtime output are recorded in
[`REGIONAL_PROVENANCE.json`](./REGIONAL_PROVENANCE.json).

Run `pnpm gen-map:natural-earth-regions` from the repository root to regenerate
only those five families. The command uses the Go generator's targeted
`--terrain-only` mode, preserving the Natural Earth World files and shared
language/TypeScript registries byte-for-byte.
