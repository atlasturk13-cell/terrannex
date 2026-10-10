#!/usr/bin/env python3
"""Generate five regional maps from the pinned Natural Earth v5.1.2 source."""

from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence

from PIL import Image, ImageChops, ImageDraw, ImageFilter, __version__ as PILLOW_VERSION

SOURCE_SHA256 = "3e458fc036ad0a66411f2c1e6cac49c5d7bfb81cb1123bc513b22511a2b7fdeb"
EXPECTED_PILLOW_VERSION = "10.4.0"
LAND_RGBA = (94, 111, 150, 255)
EDGE_WATER_MARGIN = 24

MAP_GENERATOR_DIR = Path(__file__).resolve().parents[1]
REPOSITORY_DIR = MAP_GENERATOR_DIR.parent
SOURCE_PATH = (
    MAP_GENERATOR_DIR
    / "sources"
    / "natural-earth-v5.1.2"
    / "ne_50m_admin_0_countries.geojson"
)
PROVENANCE_PATH = (
    MAP_GENERATOR_DIR
    / "sources"
    / "natural-earth-v5.1.2"
    / "REGIONAL_PROVENANCE.json"
)


@dataclass(frozen=True)
class Region:
    folder: str
    map_id: str
    name: str
    display_name: str
    description: str
    bounds: tuple[float, float, float, float]
    width: int
    height: int
    categories: tuple[str, ...]
    themes: tuple[str, ...]
    nations: tuple[str, ...]
    waterways: tuple[tuple[tuple[float, float], ...], ...] = ()


REGIONS = (
    Region(
        folder="europemediterranean",
        map_id="EuropeMediterranean",
        name="Europe–Mediterranean",
        display_name="Europe–Mediterranean",
        description="Europe and Mediterranean coasts.",
        bounds=(-16.0, 28.0, 48.0, 72.0),
        width=1600,
        height=1100,
        categories=("new", "continental", "europe"),
        themes=("europe",),
        nations=(
            "Portugal",
            "Spain",
            "France",
            "United Kingdom",
            "Ireland",
            "Germany",
            "Italy",
            "Poland",
            "Sweden",
            "Finland",
            "Romania",
            "Ukraine",
            "Greece",
            "Turkey",
            "Morocco",
            "Algeria",
            "Tunisia",
            "Egypt",
        ),
        waterways=(
            ((-6.2, 35.9), (-5.2, 35.9), (-4.4, 36.2)),
            ((-1.5, 50.4), (0.2, 50.8), (2.0, 51.1)),
            ((28.7, 41.3), (29.0, 41.0), (29.1, 40.7)),
            ((26.2, 40.5), (26.4, 40.2), (26.6, 39.9)),
        ),
    ),
    Region(
        folder="northamericacaribbean",
        map_id="NorthAmericaCaribbean",
        name="North America–Caribbean",
        display_name="North America–Caribbean",
        description="North America and Caribbean.",
        bounds=(-172.0, 4.0, -48.0, 79.0),
        width=1800,
        height=1100,
        categories=("new", "continental", "north_america"),
        themes=("north_america",),
        nations=(
            "Canada",
            "United States of America",
            "Mexico",
            "Cuba",
            "Haiti",
            "Dominican Republic",
            "Guatemala",
            "Honduras",
            "Nicaragua",
            "Costa Rica",
            "Panama",
            "Colombia",
        ),
    ),
    Region(
        folder="naturalearthsouthamerica",
        map_id="NaturalEarthSouthAmerica",
        name="Natural Earth South America",
        display_name="South America",
        description="South American coasts and rivers.",
        bounds=(-94.0, -58.0, -30.0, 16.0),
        width=1200,
        height=1400,
        categories=("new", "continental", "south_america"),
        themes=("south_america",),
        nations=(
            "Colombia",
            "Venezuela",
            "Guyana",
            "Suriname",
            "Ecuador",
            "Peru",
            "Brazil",
            "Bolivia",
            "Paraguay",
            "Chile",
            "Argentina",
            "Uruguay",
        ),
    ),
    Region(
        folder="africamiddleeast",
        map_id="AfricaMiddleEast",
        name="Africa–Middle East",
        display_name="Africa–Middle East",
        description="Africa and Middle East.",
        bounds=(-27.0, -40.0, 66.0, 40.0),
        width=1500,
        height=1280,
        categories=("new", "continental", "africa", "asia"),
        themes=("africa", "asia"),
        nations=(
            "Morocco",
            "Algeria",
            "Libya",
            "Egypt",
            "Sudan",
            "Ethiopia",
            "Kenya",
            "United Republic of Tanzania",
            "Senegal",
            "Ghana",
            "Nigeria",
            "Cameroon",
            "Angola",
            "Namibia",
            "Botswana",
            "South Africa",
            "Saudi Arabia",
            "Yemen",
            "Oman",
            "Iraq",
            "Iran",
            "Jordan",
            "Syria",
            "Turkey",
        ),
        waterways=(
            ((32.25, 31.3), (32.35, 30.3), (32.55, 29.9)),
            ((56.0, 26.5), (56.4, 26.2), (56.8, 25.9)),
        ),
    ),
    Region(
        folder="asiapacific",
        map_id="AsiaPacific",
        name="Asia–Pacific",
        display_name="Asia–Pacific",
        description="Asia and Pacific islands.",
        bounds=(54.0, -50.0, 180.0, 76.0),
        width=1520,
        height=1520,
        categories=("new", "continental", "asia", "oceania"),
        themes=("asia", "oceania"),
        nations=(
            "Russia",
            "Kazakhstan",
            "China",
            "Mongolia",
            "North Korea",
            "South Korea",
            "Japan",
            "India",
            "Pakistan",
            "Bangladesh",
            "Myanmar",
            "Thailand",
            "Vietnam",
            "Malaysia",
            "Indonesia",
            "Philippines",
            "Papua New Guinea",
            "Australia",
            "New Zealand",
        ),
        waterways=(
            ((102.0, 1.6), (103.0, 1.3), (104.0, 1.2)),
        ),
    ),
)

OUTPUT_FILES = (
    "map.bin",
    "map4x.bin",
    "map16x.bin",
    "thumbnail.webp",
    "manifest.json",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def project(region: Region, position: Sequence[float]) -> tuple[int, int]:
    longitude, latitude = position[:2]
    west, south, east, north = region.bounds
    usable_width = region.width - EDGE_WATER_MARGIN * 2 - 1
    usable_height = region.height - EDGE_WATER_MARGIN * 2 - 1
    x = EDGE_WATER_MARGIN + round((longitude - west) * usable_width / (east - west))
    y = EDGE_WATER_MARGIN + round((north - latitude) * usable_height / (north - south))
    return x, y


def polygons(geometry: dict[str, Any]) -> Iterable[list[list[Sequence[float]]]]:
    geometry_type = geometry["type"]
    coordinates = geometry["coordinates"]
    if geometry_type == "Polygon":
        yield coordinates
    elif geometry_type == "MultiPolygon":
        yield from coordinates
    else:
        raise ValueError(f"unsupported geometry type: {geometry_type}")


def draw_geometry(mask: Image.Image, region: Region, geometry: dict[str, Any]) -> None:
    draw = ImageDraw.Draw(mask)
    for polygon in polygons(geometry):
        if not polygon:
            continue
        draw.polygon([project(region, position) for position in polygon[0]], fill=255)
        for hole in polygon[1:]:
            draw.polygon([project(region, position) for position in hole], fill=0)


def nearest_filled_pixel(mask: Image.Image) -> tuple[int, int] | None:
    bbox = mask.getbbox()
    if bbox is None:
        return None
    target_x = (bbox[0] + bbox[2] - 1) // 2
    target_y = (bbox[1] + bbox[3] - 1) // 2
    pixels = mask.load()
    best: tuple[int, int] | None = None
    best_distance: int | None = None
    for y in range(bbox[1], bbox[3]):
        for x in range(bbox[0], bbox[2]):
            if pixels[x, y] == 0:
                continue
            distance = (x - target_x) ** 2 + (y - target_y) ** 2
            if best_distance is None or distance < best_distance:
                best = (x, y)
                best_distance = distance
    return best


def nation_coordinate(
    region: Region, geometry: dict[str, Any], land_mask: Image.Image
) -> tuple[int, int]:
    country = Image.new("L", (region.width, region.height), 0)
    draw_geometry(country, region, geometry)
    country = ImageChops.multiply(country, land_mask)
    for filter_size in (21, 9, 3):
        point = nearest_filled_pixel(country.filter(ImageFilter.MinFilter(filter_size)))
        if point is not None:
            return point
    point = nearest_filled_pixel(country)
    if point is None:
        raise ValueError(f"{region.display_name} has no usable nation land")
    return point


def carve_waterways(mask: Image.Image, region: Region) -> None:
    draw = ImageDraw.Draw(mask)
    for route in region.waterways:
        draw.line(
            [project(region, position) for position in route],
            fill=0,
            width=12,
            joint="curve",
        )


def source_metadata(region: Region) -> dict[str, Any]:
    return {
        "commit": "f1890d9f152c896d250a77557a5751a93d494776",
        "dataset": "Natural Earth 1:50m Admin 0 Countries, GeoJSON",
        "license": "Public domain",
        "license_url": "https://github.com/nvkelso/natural-earth-vector/blob/f1890d9f152c896d250a77557a5751a93d494776/LICENSE.md",
        "release": "v5.1.2",
        "source_sha256": SOURCE_SHA256,
        "terms": "Natural Earth raster and vector map data is public domain.",
        "terms_url": "https://www.naturalearthdata.com/about/terms-of-use/",
        "url": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/f1890d9f152c896d250a77557a5751a93d494776/geojson/ne_50m_admin_0_countries.geojson",
    }


def info_payload(region: Region, nations: list[dict[str, Any]]) -> dict[str, Any]:
    west, south, east, north = region.bounds
    modifications = [
        f"Clipped to {west:g},{south:g},{east:g},{north:g}.",
        f"Rasterized to {region.width}x{region.height} with a water edge.",
        "Removed small terrain with the pinned local Go generator.",
    ]
    if region.waterways:
        modifications.append(
            f"Carved {len(region.waterways)} twelve-pixel waterway corridors."
        )
    return {
        "categories": list(region.categories),
        "description": region.description,
        "display_name": region.display_name,
        "id": region.map_id,
        "modifications": modifications,
        "multiplayer_frequency": 0,
        "name": region.name,
        "nations": nations,
        "source": source_metadata(region),
        "themes": list(region.themes),
        "translation_key": f"map.{region.folder}",
    }


def validate_environment() -> dict[str, Any]:
    if PILLOW_VERSION != EXPECTED_PILLOW_VERSION:
        raise RuntimeError(
            f"Pillow version mismatch: expected {EXPECTED_PILLOW_VERSION}, got {PILLOW_VERSION}"
        )
    actual_source_sha = sha256(SOURCE_PATH)
    if actual_source_sha != SOURCE_SHA256:
        raise RuntimeError(
            f"source checksum mismatch: expected {SOURCE_SHA256}, got {actual_source_sha}"
        )
    return json.loads(SOURCE_PATH.read_text(encoding="utf-8"))


def generate_sources() -> None:
    source = validate_environment()
    features = source["features"]
    features_by_name = {
        feature["properties"]["ADMIN"]: feature for feature in features
    }

    for region in REGIONS:
        missing = sorted(set(region.nations) - set(features_by_name))
        if missing:
            raise RuntimeError(
                f"{region.display_name}: countries not found: {', '.join(missing)}"
            )

        land_mask = Image.new("L", (region.width, region.height), 0)
        for feature in features:
            draw_geometry(land_mask, region, feature["geometry"])
        carve_waterways(land_mask, region)

        # Keep every regional edge water so horizontally wrapped game routes do
        # not create a false land bridge between opposite crop boundaries.
        draw = ImageDraw.Draw(land_mask)
        draw.rectangle((0, 0, region.width - 1, EDGE_WATER_MARGIN - 1), fill=0)
        draw.rectangle(
            (0, region.height - EDGE_WATER_MARGIN, region.width - 1, region.height - 1),
            fill=0,
        )
        draw.rectangle((0, 0, EDGE_WATER_MARGIN - 1, region.height - 1), fill=0)
        draw.rectangle(
            (region.width - EDGE_WATER_MARGIN, 0, region.width - 1, region.height - 1),
            fill=0,
        )

        image = Image.new("RGBA", (region.width, region.height), (0, 0, 0, 0))
        image.paste(LAND_RGBA, mask=land_mask)

        nations = []
        for name in region.nations:
            coordinate = nation_coordinate(
                region, features_by_name[name]["geometry"], land_mask
            )
            if land_mask.getpixel(coordinate) == 0:
                raise RuntimeError(
                    f"{region.display_name}: generated coordinate is water: {name}"
                )
            nations.append({"coordinates": list(coordinate), "name": name})

        output_dir = MAP_GENERATOR_DIR / "assets" / "maps" / region.folder
        output_dir.mkdir(parents=True, exist_ok=True)
        image.save(
            output_dir / "image.png", format="PNG", compress_level=9, optimize=False
        )
        (output_dir / "info.json").write_text(
            json.dumps(info_payload(region, nations), ensure_ascii=False, indent=2)
            + "\n",
            encoding="utf-8",
        )


def record_output_hashes() -> None:
    validate_environment()
    records: dict[str, Any] = {}
    for region in REGIONS:
        asset_dir = MAP_GENERATOR_DIR / "assets" / "maps" / region.folder
        runtime_dir = REPOSITORY_DIR / "resources" / "maps" / region.folder
        source_files = (asset_dir / "image.png", asset_dir / "info.json")
        runtime_files = tuple(runtime_dir / name for name in OUTPUT_FILES)
        missing = [str(path) for path in (*source_files, *runtime_files) if not path.is_file()]
        if missing:
            raise RuntimeError(f"missing generated files: {', '.join(missing)}")
        manifest = json.loads((runtime_dir / "manifest.json").read_text(encoding="utf-8"))
        records[region.folder] = {
            "bounds_wgs84": list(region.bounds),
            "description": region.description,
            "display_name": region.display_name,
            "id": region.map_id,
            "modifications": info_payload(region, [])["modifications"],
            "output_hashes": {
                path.name: sha256(path) for path in runtime_files
            },
            "source_hashes": {path.name: sha256(path) for path in source_files},
            "terrain": {
                key: manifest[key] for key in ("map", "map4x", "map16x")
            },
        }

    payload = {
        "dataset": source_metadata(REGIONS[0]),
        "generator": {
            "edge_water_margin_pixels": EDGE_WATER_MARGIN,
            "pillow": EXPECTED_PILLOW_VERSION,
            "regional_script": "map-generator/scripts/generate_natural_earth_regions.py",
            "terrain_generator": "map-generator (pinned repository source)",
        },
        "maps": records,
    }
    PROVENANCE_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--record-output-hashes",
        action="store_true",
        help="record hashes after the Go terrain generator has run",
    )
    args = parser.parse_args()
    if args.record_output_hashes:
        record_output_hashes()
    else:
        generate_sources()


if __name__ == "__main__":
    main()
