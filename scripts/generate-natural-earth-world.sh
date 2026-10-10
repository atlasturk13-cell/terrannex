#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
venv_dir=${NATURAL_EARTH_VENV:-"$repo_root/map-generator/.venv-natural-earth"}
python_command=${NATURAL_EARTH_PYTHON:-python3}

if [ ! -x "$venv_dir/bin/python" ]; then
    "$python_command" -m venv "$venv_dir"
fi

"$venv_dir/bin/python" -m pip install \
    --disable-pip-version-check \
    --only-binary=:all: \
    --no-deps \
    --quiet \
    --requirement "$repo_root/map-generator/requirements-natural-earth.txt"

"$venv_dir/bin/python" \
    "$repo_root/map-generator/scripts/generate_natural_earth_world.py"

# Real elevation (NASA / GEBCO) into the land pixels' blue channel; needs the
# rasters in map-generator/.cache/nasa (see sources/nasa-blue-marble).
(
    cd "$repo_root/map-generator"
    go run ./cmd/satellite -mode relief -maps=naturalearthworld
)

(
    cd "$repo_root/map-generator"
    go run . --maps=naturalearthworld --workers=1 --terrain-only
)

cd "$repo_root"
pnpm exec prettier --write \
    map-generator/assets/maps/naturalearthworld/info.json \
    resources/maps/naturalearthworld/manifest.json

# Satellite imagery tiles conformed to the regenerated land mask.
(
    cd "$repo_root/map-generator"
    go run ./cmd/satellite -mode imagery -maps=naturalearthworld
)
