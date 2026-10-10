#!/usr/bin/env python3
"""Generate the NaturalEarthWorld source map from pinned Natural Earth data."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Iterable, NamedTuple, Sequence

from PIL import Image, ImageDraw, ImageFilter, __version__ as PILLOW_VERSION

WIDTH = 2000
HEIGHT = 1000
LAND_RGBA = (94, 111, 150, 255)
SOURCE_SHA256 = "3e458fc036ad0a66411f2c1e6cac49c5d7bfb81cb1123bc513b22511a2b7fdeb"
EXPECTED_PILLOW_VERSION = "10.4.0"

# The production pathfinder searches half- and quarter-resolution terrain, then
# projects its route into the active map. Clearing complete 4x4 source cells is
# the minimum representation that guarantees both projected routes contain only
# water. A one-pixel trial kept minimap topology connected but returned land
# tiles from the authoritative Normal route, so it is intentionally rejected.
WATERWAY_GRID_SIZE = 4


class StrategicWaterway(NamedTuple):
    name: str
    grid_cell_route: tuple[tuple[int, int], ...]
    max_grid_cells: int


# Natural Earth's country boundaries preserve these waterways as narrow vector
# gaps, but the gaps collapse in the gameplay-scale 2000x1000 raster. These
# fixed 4x4-cell routes are deliberate first-party generalizations of the
# pinned raster: axis-aligned and exact-cell bounded. The Bosphorus uses the
# three-cell minimum that keeps projected routes in water, one cell less than
# the first accepted generalization.
# Baseline terrain audits show Gibraltar closed at full/Normal resolution and
# the English Channel closed at full resolution, so their minimal bridges must
# remain explicit rather than being mislabeled audit-only passages.
STRATEGIC_WATERWAYS = (
    StrategicWaterway(
        name="Bosphorus",
        grid_cell_route=((290, 67), (290, 68), (289, 68)),
        max_grid_cells=3,
    ),
    StrategicWaterway(
        name="Dardanelles",
        grid_cell_route=((286, 69), (288, 69), (288, 68)),
        max_grid_cells=4,
    ),
    StrategicWaterway(
        name="Strait of Gibraltar",
        grid_cell_route=((241, 75), (242, 75)),
        max_grid_cells=2,
    ),
    StrategicWaterway(
        name="English Channel",
        grid_cell_route=((250, 54), (251, 54)),
        max_grid_cells=2,
    ),
)

MAP_GENERATOR_DIR = Path(__file__).resolve().parents[1]
SOURCE_PATH = (
    MAP_GENERATOR_DIR
    / "sources"
    / "natural-earth-v5.1.2"
    / "ne_50m_admin_0_countries.geojson"
)
OUTPUT_DIR = MAP_GENERATOR_DIR / "assets" / "maps" / "naturalearthworld"

# Large, geographically distributed countries keep fixed Nation starts useful
# after the production map generator removes tiny islands and lakes.
NATION_NAMES = (
    "United States of America",
    "Canada",
    "Mexico",
    "Brazil",
    "Argentina",
    "United Kingdom",
    "France",
    "Spain",
    "Germany",
    "Turkey",
    "Russia",
    "Egypt",
    "Nigeria",
    "Ethiopia",
    "Kenya",
    "South Africa",
    "Saudi Arabia",
    "Iran",
    "Kazakhstan",
    "Pakistan",
    "India",
    "China",
    "Japan",
    "Thailand",
    "Vietnam",
    "Indonesia",
    "Australia",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def project(position: Sequence[float]) -> tuple[int, int]:
    longitude, latitude = position[:2]
    x = round((longitude + 180.0) * (WIDTH - 1) / 360.0)
    y = round((90.0 - latitude) * (HEIGHT - 1) / 180.0)
    return max(0, min(WIDTH - 1, x)), max(0, min(HEIGHT - 1, y))


def polygons(geometry: dict[str, Any]) -> Iterable[list[list[Sequence[float]]]]:
    geometry_type = geometry["type"]
    coordinates = geometry["coordinates"]
    if geometry_type == "Polygon":
        yield coordinates
    elif geometry_type == "MultiPolygon":
        yield from coordinates
    else:
        raise ValueError(f"unsupported geometry type: {geometry_type}")


def draw_geometry(mask: Image.Image, geometry: dict[str, Any]) -> None:
    draw = ImageDraw.Draw(mask)
    for polygon in polygons(geometry):
        if not polygon:
            continue
        draw.polygon([project(position) for position in polygon[0]], fill=255)
        for hole in polygon[1:]:
            draw.polygon([project(position) for position in hole], fill=0)


def strategic_waterway_cells(
    waterway: StrategicWaterway,
) -> set[tuple[int, int]]:
    if len(waterway.grid_cell_route) < 2:
        raise ValueError(f"strategic waterway has no route: {waterway.name}")

    cells: set[tuple[int, int]] = set()
    for (start_x, start_y), (end_x, end_y) in zip(
        waterway.grid_cell_route, waterway.grid_cell_route[1:]
    ):
        for x, y in ((start_x, start_y), (end_x, end_y)):
            if not (
                0 <= x < WIDTH // WATERWAY_GRID_SIZE
                and 0 <= y < HEIGHT // WATERWAY_GRID_SIZE
            ):
                raise ValueError(
                    f"strategic waterway cell is out of bounds: "
                    f"{waterway.name} ({x}, {y})"
                )
        if start_x != end_x and start_y != end_y:
            raise ValueError(
                f"strategic waterway segment must be axis-aligned: {waterway.name}"
            )
        if start_x == end_x:
            low, high = sorted((start_y, end_y))
            cells.update((start_x, y) for y in range(low, high + 1))
        else:
            low, high = sorted((start_x, end_x))
            cells.update((x, start_y) for x in range(low, high + 1))

    if len(cells) > waterway.max_grid_cells:
        raise ValueError(
            f"strategic waterway exceeds its {waterway.max_grid_cells}-cell bound: "
            f"{waterway.name} uses {len(cells)}"
        )
    return cells


def carve_strategic_waterways(mask: Image.Image) -> None:
    names: set[str] = set()
    draw = ImageDraw.Draw(mask)
    for waterway in STRATEGIC_WATERWAYS:
        if waterway.name in names:
            raise ValueError(f"duplicate strategic waterway: {waterway.name}")
        names.add(waterway.name)
        for cell_x, cell_y in sorted(strategic_waterway_cells(waterway)):
            left = cell_x * WATERWAY_GRID_SIZE
            top = cell_y * WATERWAY_GRID_SIZE
            right = min(WIDTH - 1, left + WATERWAY_GRID_SIZE - 1)
            bottom = min(HEIGHT - 1, top + WATERWAY_GRID_SIZE - 1)
            draw.rectangle((left, top, right, bottom), fill=0)


def nearest_filled_pixel(
    mask: Image.Image, target: tuple[int, int]
) -> tuple[int, int] | None:
    bbox = mask.getbbox()
    if bbox is None:
        return None
    left, top, right, bottom = bbox
    target_x, target_y = target
    pixels = mask.load()
    best: tuple[int, int] | None = None
    best_distance: int | None = None
    for y in range(top, bottom):
        for x in range(left, right):
            if pixels[x, y] == 0:
                continue
            distance = (x - target_x) ** 2 + (y - target_y) ** 2
            if best_distance is None or distance < best_distance:
                best = (x, y)
                best_distance = distance
    return best


def nation_coordinate(geometry: dict[str, Any]) -> tuple[int, int]:
    country = Image.new("L", (WIDTH, HEIGHT), 0)
    draw_geometry(country, geometry)
    bbox = country.getbbox()
    if bbox is None:
        raise ValueError("country geometry has no rasterized pixels")
    target = ((bbox[0] + bbox[2] - 1) // 2, (bbox[1] + bbox[3] - 1) // 2)

    # Prefer a point at least ten pixels inside the country. The fallbacks keep
    # compact or archipelagic countries reproducible without external geometry
    # libraries while still requiring an actual land pixel.
    for filter_size in (21, 9, 3):
        eroded = country.filter(ImageFilter.MinFilter(filter_size))
        point = nearest_filled_pixel(eroded, target)
        if point is not None:
            return point
    point = nearest_filled_pixel(country, target)
    if point is None:
        raise ValueError("country geometry has no usable land pixel")
    return point


def serialize_info(nations: list[dict[str, Any]]) -> str:
    """Serialize in the repository's stable Prettier-compatible JSON style."""
    lines = [
        "{",
        '  "categories": ["world"],',
        '  "display_name": "World (Natural Earth)",',
        '  "id": "NaturalEarthWorld",',
        '  "multiplayer_frequency": 0,',
        '  "name": "Natural Earth World",',
        '  "nations": [',
    ]
    for index, nation in enumerate(nations):
        comma = "," if index < len(nations) - 1 else ""
        x, y = nation["coordinates"]
        lines.extend(
            [
                "    {",
                f'      "coordinates": [{x}, {y}],',
                f'      "name": {json.dumps(nation["name"], ensure_ascii=False)}',
                f"    }}{comma}",
            ]
        )
    lines.extend(
        [
            "  ],",
            '  "translation_key": "map.naturalearthworld"',
            "}",
        ]
    )
    return "\n".join(lines) + "\n"


def main() -> None:
    if PILLOW_VERSION != EXPECTED_PILLOW_VERSION:
        raise RuntimeError(
            f"Pillow version mismatch: expected {EXPECTED_PILLOW_VERSION}, "
            f"got {PILLOW_VERSION}"
        )
    actual_source_sha = sha256(SOURCE_PATH)
    if actual_source_sha != SOURCE_SHA256:
        raise RuntimeError(
            f"source checksum mismatch: expected {SOURCE_SHA256}, got {actual_source_sha}"
        )

    source = json.loads(SOURCE_PATH.read_text(encoding="utf-8"))
    features = source["features"]
    features_by_name = {
        feature["properties"]["ADMIN"]: feature for feature in features
    }
    missing = sorted(set(NATION_NAMES) - set(features_by_name))
    if missing:
        raise RuntimeError(f"Natural Earth countries not found: {', '.join(missing)}")

    land_mask = Image.new("L", (WIDTH, HEIGHT), 0)
    for feature in features:
        draw_geometry(land_mask, feature["geometry"])
    carve_strategic_waterways(land_mask)

    image = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    image.paste(LAND_RGBA, mask=land_mask)

    nations = []
    for name in NATION_NAMES:
        coordinate = nation_coordinate(features_by_name[name]["geometry"])
        if land_mask.getpixel(coordinate) == 0:
            raise RuntimeError(f"generated Nation coordinate is not land: {name}")
        nations.append({"coordinates": list(coordinate), "name": name})

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    image.save(OUTPUT_DIR / "image.png", format="PNG", compress_level=9, optimize=False)
    (OUTPUT_DIR / "info.json").write_text(
        serialize_info(nations),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
