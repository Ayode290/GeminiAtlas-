#!/usr/bin/env python3
"""
Offline (author/build-time) map texture generator for the Interactive Globe lens.

Reads Assets/Scripts/Globe/cityBounds.json (the SINGLE SOURCE OF TRUTH) and, for
every city LOD entry, computes the Web-Mercator slippy-tile range covering the
declared bounding box at a zoom that meets the requested output size, fetches the
tiles, stitches them, crops to the EXACT bounds, resizes to a power-of-two
texture, and writes Assets/Textures/Globe/<city>_L<n>.png.

Because the same cityBounds.json drives BOTH this capture AND the in-lens UV math
(via Assets/Scripts/Globe/cityBounds.ts), the generated framing and the in-lens
alignment can never drift. To guarantee that, this tool also REGENERATES
cityBounds.ts from the JSON at the end of a run.

Design notes
  - "spanDeg" is the LONGITUDE span (width) of a square crop in degrees; latitude
    is treated with the same span (mercator distortion is negligible at city
    scale). The crop bbox is [centerLng +/- span/2, centerLat +/- span/2].
  - Provider URL is a config (TILE_PROVIDER in the JSON). OSM road tiles by
    default; swap for a keyed/satellite provider with NO code change.
  - Respect the OSM tile usage policy: a descriptive User-Agent is sent, the
    batch is tiny (one-time, ~9 images), and the lens shows OSM attribution.
  - Static output: runs once at author time. The shipped lens bundles the PNGs
    and needs no network / no Internet Access capability.

Usage
    pip install requests pillow
    python tools/generate_map_textures.py
    # options:
    #   --only Tokyo            limit to one city
    #   --dry-run               print the tile plan without fetching
    #   --no-regen-ts           skip rewriting cityBounds.ts
    #   --res-scale 1.5         multiply every entry's outSize (capture AND the
    #                           regenerated cityBounds.ts) by this factor. The
    #                           crop is unchanged (same angle/bounds), only the
    #                           pixel resolution scales. Default 1.0 = use the
    #                           outSize values exactly as written in the JSON.
"""

import argparse
import hashlib
import json
import math
import os
import random
import sys
import time
from io import BytesIO

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOUNDS_JSON = os.path.join(REPO_ROOT, "Assets", "Scripts", "Globe", "cityBounds.json")
BOUNDS_TS = os.path.join(REPO_ROOT, "Assets", "Scripts", "Globe", "cityBounds.ts")
OUT_DIR = os.path.join(REPO_ROOT, "Assets", "Textures", "Globe")
TILE_CACHE_DIR = os.path.join(REPO_ROOT, "tools", ".tile_cache")

TILE_SIZE = 256  # OSM/standard slippy tiles are 256x256.
MAX_ZOOM = 19    # OSM max road zoom.

# Polite, "natural" pacing for the volunteer OSM servers (educational /
# non-commercial hackathon use). Each *network* request waits a RANDOM delay in
# [MIN_DELAY_SEC, MAX_DELAY_SEC] so the access pattern isn't a robotic fixed-rate
# scrape; cached tiles never hit the network and never wait. On HTTP 429/503 we
# back off exponentially. These are overridable via CLI flags.
MIN_DELAY_SEC = 1.5
MAX_DELAY_SEC = 4.0
MAX_RETRIES = 5
USE_CACHE = True

# Optional uniform multiplier on every entry's outSize. The crop bounds (angle
# covered) are untouched; only the baked pixel resolution scales. Applied to BOTH
# the capture AND the outSize mirrored into cityBounds.ts, so the two never drift.
RES_SCALE = 1.0


def effective_out_size(raw):
    """The actual baked pixel size for a declared outSize, after RES_SCALE."""
    return max(1, int(round(int(raw) * RES_SCALE)))


# --- Web-Mercator slippy-tile math (offline only) ---------------------------

def lng_to_tile_x(lng, z):
    return (lng + 180.0) / 360.0 * (2 ** z)


def lat_to_tile_y(lat, z):
    lat_rad = math.radians(lat)
    return (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * (2 ** z)


def tile_x_to_lng(x, z):
    return x / (2 ** z) * 360.0 - 180.0


def tile_y_to_lat(y, z):
    n = math.pi - 2.0 * math.pi * y / (2 ** z)
    return math.degrees(math.atan(math.sinh(n)))


def bbox_from_entry(entry):
    """Returns (min_lng, min_lat, max_lng, max_lat) for a LOD entry."""
    c = entry["centerLatLng"]
    half = entry["spanDeg"] / 2.0
    return (c["lng"] - half, c["lat"] - half, c["lng"] + half, c["lat"] + half)


def transition_entry(city, tcfg):
    """
    The derived 'L-1' wide capture for a city, or None if no transition config.

    Its span is spanMultiple x the city's L0 spanDeg (the SINGLE SOURCE OF TRUTH
    for the factor lives in cityBounds.json's `transition` block), centered on L0,
    captured at the configured outSize. Level is -1 so it never collides with the
    navigable L0..Ln chain. Returns a level-shaped dict the capture code reuses.
    """
    if not tcfg or not city.get("levels"):
        return None
    l0 = city["levels"][0]
    suffix = tcfg.get("labelSuffix", "region")
    return {
        "level": -1,
        "centerLatLng": {"lat": l0["centerLatLng"]["lat"], "lng": l0["centerLatLng"]["lng"]},
        "spanDeg": tcfg["spanMultiple"] * l0["spanDeg"],
        "outSize": int(tcfg.get("outSize", 2048)),
        "label": f'{city["name"]} {suffix}',
    }


def choose_zoom(bbox, out_size):
    """Smallest zoom whose stitched crop pixel width >= out_size (capped)."""
    min_lng, _, max_lng, _ = bbox
    for z in range(1, MAX_ZOOM + 1):
        px_width = (lng_to_tile_x(max_lng, z) - lng_to_tile_x(min_lng, z)) * TILE_SIZE
        if px_width >= out_size:
            return z
    return MAX_ZOOM


def tile_range(bbox, z):
    """Inclusive tile (x0, y0, x1, y1) covering the bbox at zoom z."""
    min_lng, min_lat, max_lng, max_lat = bbox
    x0 = int(math.floor(lng_to_tile_x(min_lng, z)))
    x1 = int(math.floor(lng_to_tile_x(max_lng, z)))
    # y grows southward, so max_lat -> smaller y.
    y0 = int(math.floor(lat_to_tile_y(max_lat, z)))
    y1 = int(math.floor(lat_to_tile_y(min_lat, z)))
    max_index = 2 ** z - 1
    x0 = max(0, min(max_index, x0))
    x1 = max(0, min(max_index, x1))
    y0 = max(0, min(max_index, y0))
    y1 = max(0, min(max_index, y1))
    return x0, y0, x1, y1


# --- fetch + stitch + crop --------------------------------------------------

def _cache_file_for(url):
    return os.path.join(TILE_CACHE_DIR, hashlib.sha1(url.encode("utf-8")).hexdigest() + ".tile")


def fetch_tile(session, provider, z, x, y):
    """
    Returns the bytes for one tile, reading from the on-disk cache first so
    re-runs never re-hit the server. On a cache miss it waits a randomized
    "natural" delay, sends polite identifying headers, and retries with
    exponential backoff on rate-limit responses (429/503).
    """
    url = (provider["urlTemplate"]
           .replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y)))

    cache_file = _cache_file_for(url)
    if USE_CACHE and os.path.exists(cache_file):
        with open(cache_file, "rb") as f:
            return f.read()

    headers = {
        "User-Agent": provider.get("userAgent", "SNAPCrop-Globe-MapBaker/1.0"),
        "Accept": "image/png,image/*;q=0.9,*/*;q=0.5",
    }
    referer = provider.get("referer")
    if referer:
        headers["Referer"] = referer

    last_err = None
    for attempt in range(MAX_RETRIES):
        # Natural pacing BEFORE every network request; back off harder on retries.
        base = random.uniform(MIN_DELAY_SEC, MAX_DELAY_SEC)
        time.sleep(base if attempt == 0 else min(90.0, base * (2 ** attempt)))
        try:
            resp = session.get(url, headers=headers, timeout=30)
            if resp.status_code in (429, 503):
                last_err = f"HTTP {resp.status_code} (rate limited)"
                print(f"    {last_err}; backing off (attempt {attempt + 1}/{MAX_RETRIES})")
                continue
            if resp.status_code in (403,):
                # A hard block won't clear by retrying — surface it immediately.
                raise RuntimeError(
                    f"HTTP 403 for {url} — the server is blocking this client "
                    f"(see osm.wiki/Blocked). Slow down further, fix the User-Agent/"
                    f"contact, or switch provider in cityBounds.json."
                )
            resp.raise_for_status()
            data = resp.content
            if USE_CACHE:
                os.makedirs(TILE_CACHE_DIR, exist_ok=True)
                with open(cache_file, "wb") as f:
                    f.write(data)
            return data
        except RuntimeError:
            raise
        except Exception as e:  # noqa: BLE001 - report-and-retry transient errors
            last_err = str(e)
            print(f"    request error: {last_err}; retry {attempt + 1}/{MAX_RETRIES}")
            continue
    raise RuntimeError(f"Failed to fetch {url} after {MAX_RETRIES} attempts: {last_err}")


def build_entry_texture(session, provider, entry, out_path, dry_run):
    bbox = bbox_from_entry(entry)
    out_size = effective_out_size(entry.get("outSize", 1024))
    z = choose_zoom(bbox, out_size)
    x0, y0, x1, y1 = tile_range(bbox, z)
    n_tiles = (x1 - x0 + 1) * (y1 - y0 + 1)

    print(f"  bbox={tuple(round(v, 5) for v in bbox)} zoom={z} "
          f"tiles=[{x0}..{x1}]x[{y0}..{y1}] ({n_tiles} tiles) -> {os.path.basename(out_path)}")

    if dry_run:
        return

    from PIL import Image

    if n_tiles > 256:
        print(f"  WARNING: {n_tiles} tiles is large; consider a smaller span/outSize.")

    stitched = Image.new("RGB", ((x1 - x0 + 1) * TILE_SIZE, (y1 - y0 + 1) * TILE_SIZE))

    # Fetch in a shuffled order so the access pattern isn't a perfect raster
    # scan; pacing/caching live in fetch_tile. Then paste into the grid.
    coords = [(tx, ty) for tx in range(x0, x1 + 1) for ty in range(y0, y1 + 1)]
    random.shuffle(coords)
    fetched = {}
    for i, (tx, ty) in enumerate(coords):
        fetched[(tx, ty)] = fetch_tile(session, provider, z, tx, ty)
        if (i + 1) % 10 == 0 or (i + 1) == len(coords):
            print(f"    fetched {i + 1}/{len(coords)} tiles")

    for (tx, ty), data in fetched.items():
        tile_img = Image.open(BytesIO(data)).convert("RGB")
        stitched.paste(tile_img, ((tx - x0) * TILE_SIZE, (ty - y0) * TILE_SIZE))

    # Crop a SQUARE in Web-Mercator PIXEL space centered on the coordinate.
    #
    # Tiles are Web-Mercator: longitude->pixels is linear, but latitude->pixels
    # (lat_to_tile_y) is stretched by 1/cos(lat). Cropping a square in *degrees*
    # and resizing to a square in *pixels* therefore squashes everything
    # vertically by cos(lat) (text/icons included). Cropping a square in pixels,
    # centered on the center pixel, is conformal (no distortion) and lands the
    # declared centerLatLng exactly at the image center. The half-size is derived
    # from the longitude span (the linear axis); the equal vertical half spans a
    # smaller latitude range, which the degrees-bbox tile fetch already covers.
    c = entry["centerLatLng"]
    half_deg = entry["spanDeg"] / 2.0
    cx = (lng_to_tile_x(c["lng"], z) - x0) * TILE_SIZE
    cy = (lat_to_tile_y(c["lat"], z) - y0) * TILE_SIZE
    half_px = (lng_to_tile_x(c["lng"] + half_deg, z) - lng_to_tile_x(c["lng"], z)) * TILE_SIZE
    cropped = stitched.crop((
        int(round(cx - half_px)), int(round(cy - half_px)),
        int(round(cx + half_px)), int(round(cy + half_px)),
    ))

    resized = cropped.resize((out_size, out_size), Image.LANCZOS)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    resized.save(out_path, "PNG")
    print(f"  wrote {out_path} ({out_size}x{out_size})")


# --- cityBounds.ts regeneration (keeps in-lens math in sync) -----------------

def texture_path_for(city_name, level):
    return f"Assets/Textures/Globe/{city_name}_L{level}.png"


def regenerate_ts(data):
    def latlng(c):
        return f'{{ lat: {c["lat"]}, lng: {c["lng"]} }}'

    lines = []
    lines.append("/**")
    lines.append(" * Specs Inc. 2026")
    lines.append(" * cityBounds.ts \u2013 the in-lens mirror of cityBounds.json.")
    lines.append(" *")
    lines.append(" * !!! GENERATED / KEPT IN SYNC BY tools/generate_map_textures.py !!!")
    lines.append(" * cityBounds.json is the SINGLE SOURCE OF TRUTH. Running the generator rewrites")
    lines.append(" * this file from the JSON so the framing used to capture the PNGs can never")
    lines.append(" * drift from the bounds used to align them in-lens. You may hand-edit the JSON")
    lines.append(" * and re-run the tool; avoid hand-editing this file directly.")
    lines.append(" *")
    lines.append(" * Lens Studio's TypeScript (isolatedModules, no resolveJsonModule) cannot")
    lines.append(" * `import` a .json directly, so the data is materialized here as a typed module.")
    lines.append(" */")
    lines.append('import { LatLng } from "./GeoMath";')
    lines.append("")
    lines.append("/** One baked level-of-detail entry for a city. */")
    lines.append("export interface LodBoundsEntry {")
    lines.append("  level: number;")
    lines.append("  centerLatLng: LatLng;")
    lines.append("  spanDeg: number;")
    lines.append("  outSize: number;")
    lines.append("  /** Human-readable label shown in the UI for this level. */")
    lines.append("  label: string;")
    lines.append("  /** Repo-relative path of the PNG the generator writes for this level. */")
    lines.append("  texturePath: string;")
    lines.append("}")
    lines.append("")
    lines.append("/** One city: an overview coordinate plus its ordered LOD list (L0 first). */")
    lines.append("export interface CityBoundsEntry {")
    lines.append("  name: string;")
    lines.append("  centerLatLng: LatLng;")
    lines.append("  levels: LodBoundsEntry[];")
    lines.append("  /** Wide 'L-1' capture for the globe<->table handoff (not a navigable level). */")
    lines.append("  transition?: LodBoundsEntry;")
    lines.append("}")
    lines.append("")
    globe = data["globe"]
    lines.append("/** The globe base (hand-imported equirectangular Earth texture). */")
    lines.append("export const GLOBE_BOUNDS = {")
    lines.append(f'  baseTexture: "{globe["baseTexture"]}",')
    lines.append(f'  centerLatLng: {latlng(globe["centerLatLng"])} as LatLng,')
    lines.append(f'  spanDeg: {globe["spanDeg"]},')
    lines.append("};")
    lines.append("")
    provider = data["provider"]
    lines.append("/** Tile provider + attribution used by the offline generator (not at runtime). */")
    lines.append("export const TILE_PROVIDER = {")
    lines.append(f'  urlTemplate: "{provider["urlTemplate"]}",')
    lines.append(f'  attribution: "{provider["attribution"]}",')
    lines.append("};")
    lines.append("")
    tcfg = data.get("transition")
    lines.append("/** All cities and their LOD bounds, mirrored from cityBounds.json. */")
    lines.append("export const CITY_BOUNDS: CityBoundsEntry[] = [")
    for city in data["cities"]:
        lines.append("  {")
        lines.append(f'    name: "{city["name"]}",')
        lines.append(f'    centerLatLng: {latlng(city["centerLatLng"])},')
        lines.append("    levels: [")
        for lv in city["levels"]:
            tp = texture_path_for(city["name"], lv["level"])
            lines.append(
                f'      {{ level: {lv["level"]}, centerLatLng: {latlng(lv["centerLatLng"])}, '
                f'spanDeg: {lv["spanDeg"]}, outSize: {effective_out_size(lv["outSize"])}, '
                f'label: "{lv["label"]}", texturePath: "{tp}" }},'
            )
        lines.append("    ],")
        tlv = transition_entry(city, tcfg)
        if tlv:
            tp = texture_path_for(city["name"], tlv["level"])
            lines.append(
                f'    transition: {{ level: {tlv["level"]}, centerLatLng: {latlng(tlv["centerLatLng"])}, '
                f'spanDeg: {tlv["spanDeg"]}, outSize: {effective_out_size(tlv["outSize"])}, '
                f'label: "{tlv["label"]}", texturePath: "{tp}" }},'
            )
        lines.append("  },")
    lines.append("];")
    lines.append("")

    with open(BOUNDS_TS, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"Regenerated {BOUNDS_TS}")


# --- main -------------------------------------------------------------------

def main():
    global MIN_DELAY_SEC, MAX_DELAY_SEC, USE_CACHE, RES_SCALE

    parser = argparse.ArgumentParser(description="Generate baked map LOD textures from cityBounds.json")
    parser.add_argument("--only", help="Limit to a single city name (e.g. Tokyo)")
    parser.add_argument("--transition-only", action="store_true",
                        help="Capture ONLY the wide L-1 handoff texture(s), skipping L0..Ln")
    parser.add_argument("--dry-run", action="store_true", help="Print the tile plan without fetching")
    parser.add_argument("--no-regen-ts", action="store_true", help="Skip rewriting cityBounds.ts")
    parser.add_argument("--res-scale", type=float, default=RES_SCALE,
                        help="Multiply every entry's outSize (capture AND the regenerated "
                             "cityBounds.ts) by this factor; same angle/bounds, higher pixel "
                             f"resolution (default {RES_SCALE})")
    parser.add_argument("--min-delay", type=float, default=MIN_DELAY_SEC,
                        help=f"Min seconds between network requests (default {MIN_DELAY_SEC})")
    parser.add_argument("--max-delay", type=float, default=MAX_DELAY_SEC,
                        help=f"Max seconds between network requests (default {MAX_DELAY_SEC})")
    parser.add_argument("--no-cache", action="store_true",
                        help="Ignore the on-disk tile cache (re-fetch everything)")
    args = parser.parse_args()

    MIN_DELAY_SEC = max(0.0, args.min_delay)
    MAX_DELAY_SEC = max(MIN_DELAY_SEC, args.max_delay)
    USE_CACHE = not args.no_cache
    RES_SCALE = max(0.01, args.res_scale)
    if abs(RES_SCALE - 1.0) > 1e-9:
        print(f"Resolution scale: x{RES_SCALE:g} (outSize multiplied for capture and cityBounds.ts)")

    with open(BOUNDS_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)

    provider = data["provider"]
    cities = data["cities"]
    if args.only:
        cities = [c for c in cities if c["name"].lower() == args.only.lower()]
        if not cities:
            print(f"No city named {args.only!r} in cityBounds.json", file=sys.stderr)
            return 1

    session = None
    if not args.dry_run:
        try:
            import requests  # noqa: F401
        except ImportError:
            print("Missing dependency. Run: pip install requests pillow", file=sys.stderr)
            return 1
        try:
            from PIL import Image  # noqa: F401
        except ImportError:
            print("Missing dependency. Run: pip install requests pillow", file=sys.stderr)
            return 1
        import requests
        session = requests.Session()
        session.headers.update({"User-Agent": provider.get("userAgent", "SNAPCrop-Globe-MapBaker/1.0")})
        avg = (MIN_DELAY_SEC + MAX_DELAY_SEC) / 2.0
        print(f"Polite mode: {MIN_DELAY_SEC:.1f}-{MAX_DELAY_SEC:.1f}s between uncached requests "
              f"(~{avg:.1f}s avg), cache={'on' if USE_CACHE else 'off'} at {TILE_CACHE_DIR}")
        print("Cached tiles are reused with no network call, so re-runs are fast.")

    tcfg = data.get("transition")
    for city in cities:
        print(f"City: {city['name']}")
        # The wide L-1 handoff capture first (largest area), then the L0..Ln chain.
        tlv = transition_entry(city, tcfg)
        if tlv:
            out_path = os.path.join(OUT_DIR, f"{city['name']}_L{tlv['level']}.png")
            build_entry_texture(session, provider, tlv, out_path, args.dry_run)
        elif args.transition_only:
            print(f"  no transition config for {city['name']}; nothing to capture.")
        if args.transition_only:
            continue
        for lv in city["levels"]:
            out_path = os.path.join(OUT_DIR, f"{city['name']}_L{lv['level']}.png")
            build_entry_texture(session, provider, lv, out_path, args.dry_run)

    if not args.no_regen_ts:
        regenerate_ts(data)

    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
