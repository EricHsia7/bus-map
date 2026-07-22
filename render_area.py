#!/usr/bin/env python3
"""Batch-render slippy-map tiles for a lat/lon area using render_tile.

Data model
----------
The raw OSM data is pre-extracted and split into per-tile chunks at a single
BASE zoom (z=13) stored as:

    ./chunks/<BASE_Z>_<x>_<y>.osm.pbf     e.g. ./chunks/13_6862_3507.osm.pbf

Because `rt.decode_osm` re-projects every node to whatever z/x/y you ask for
and clips to that tile, we can render any tile at z >= BASE_Z by feeding it the
*parent* z13 chunk that geographically contains it. Zooming out below BASE_Z is
NOT supported (a single chunk does not contain its neighbours' data).

Usage
-----
    python render_area.py --style ./osm-style.json \
        --lat-min 25.015 --lat-max 25.050 \
        --lon-min 121.555 --lon-max 121.593 \
        --zoom 13 --size 1024 --ss 2

Output is written in standard slippy layout: <out-dir>/<z>/<x>/<y>.png
"""
import argparse
import json
import math
import os
import sys

import render_tile as rt


# --------------------------------------------------------------------------
# Slippy-map tile math (Web Mercator / EPSG:3857), matching rt.project.
# --------------------------------------------------------------------------
def deg2tile(lat, lon, z):
    """lat/lon degrees -> fractional tile (x, y) at zoom z."""
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    lat = max(-85.05112878, min(85.05112878, lat))
    y = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def tile_range(lat_min, lat_max, lon_min, lon_max, z):
    """Inclusive (x0, y0, x1, y1) tile index range covering the bbox at zoom z."""
    n = 2 ** z
    x_lo, _ = deg2tile(lat_max, lon_min, z)      # west edge
    x_hi, _ = deg2tile(lat_min, lon_max, z)      # east edge
    _, y_lo = deg2tile(lat_max, lon_min, z)      # north edge -> smaller y
    _, y_hi = deg2tile(lat_min, lon_max, z)      # south edge -> larger y
    x0, x1 = int(math.floor(x_lo)), int(math.floor(x_hi))
    y0, y1 = int(math.floor(y_lo)), int(math.floor(y_hi))
    # clamp to valid range and order
    x0, x1 = sorted((max(0, x0), min(n - 1, x1)))
    y0, y1 = sorted((max(0, y0), min(n - 1, y1)))
    return x0, y0, x1, y1


def parent_tile(x, y, z, base_z):
    """z13 chunk tile that contains target tile (x, y) at zoom z."""
    shift = z - base_z
    return x >> shift, y >> shift


# --------------------------------------------------------------------------
# Rendering pipeline
# --------------------------------------------------------------------------
def build_style_context(style, profile_arg):
    """Precompute the OSM decode context (layers, emitter) once for all tiles."""
    style_layers = {r.get("layer") for r in style if r.get("layer")}
    profile = (rt.detect_profile(style_layers)
               if profile_arg == "auto" else profile_arg)
    emit_fn = rt.EMITTERS.get(profile, rt.osm_emit_mapbox)
    layer_map = dict(rt.DEFAULT_LAYER_MAP)
    return style_layers, profile, emit_fn, layer_map


def render_area(style, lat_min, lat_max, lon_min, lon_max, z, base_z,
                chunks_dir, out_dir, size, ss, bg, profile_arg):
    if z < base_z:
        raise SystemExit("Zoom %d < base zoom %d: cannot zoom out below the "
                         "chunk zoom (no neighbour data in a chunk)."
                         % (z, base_z))

    style_layers, profile, emit_fn, layer_map = build_style_context(
        style, profile_arg)

    x0, y0, x1, y1 = tile_range(lat_min, lat_max, lon_min, lon_max, z)
    total = (x1 - x0 + 1) * (y1 - y0 + 1)
    print("Area z=%d: x %d..%d, y %d..%d  (%d tiles)  profile=%s"
          % (z, x0, x1, y0, y1, total, profile))

    raw_cache = {}           # (px, py) -> raw pbf bytes (or None if missing)
    written, skipped = 0, 0

    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            px, py = parent_tile(x, y, z, base_z)
            key = (px, py)
            chunk = os.path.join(chunks_dir, "%d_%d_%d.osm.pbf" % (base_z, px, py))

            # Read+cache each parent chunk once (many target tiles share one).
            if key not in raw_cache:
                if os.path.exists(chunk):
                    with open(chunk, "rb") as fh:
                        raw_cache[key] = fh.read()
                else:
                    raw_cache[key] = None
            raw = raw_cache[key]

            if raw is None:
                print("  ! missing chunk %s -> skip tile %d/%d/%d"
                      % (chunk, z, x, y))
                skipped += 1
                continue

            fmt = rt.sniff_format(raw)
            if fmt == "osm":
                groups = rt.decode_osm(raw, style_layers, z, x, y,
                                       layer_map, emit_fn)
            else:
                groups = rt.mvt_to_groups(rt.decode_mvt(raw))

            img = rt.render(groups, style, z, size=size, ss=ss, fallback_bg=bg)

            tile_dir = os.path.join(out_dir, str(z), str(x))
            os.makedirs(tile_dir, exist_ok=True)
            out_path = os.path.join(tile_dir, "%d.png" % y)
            img.save(out_path)
            feat = sum(len(g["features"]) for g in groups.values())
            print("  wrote %s  (chunk 13/%d/%d, %d features)"
                  % (out_path, px, py, feat))
            written += 1

    print("Done: %d written, %d skipped (missing chunks)." % (written, skipped))
    return written


# python render_area.py --lat-min 24.8 --lon-min 121.27 --lat-max 25.3 --lon-max 122.004 --base-zoom 13 --zoom 13
# python render_area.py --lat-min 24.8 --lon-min 121.27 --lat-max 25.3 --lon-max 122.004 --base-zoom 13 --zoom 14
# python render_area.py --lat-min 24.8 --lon-min 121.27 --lat-max 25.3 --lon-max 122.004 --base-zoom 13 --zoom 15
# python render_area.py --lat-min 24.8 --lon-min 121.27 --lat-max 25.3 --lon-max 122.004 --base-zoom 13 --zoom 16

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--style", default="./style.json")
    # Default bbox sits inside the sample chunk 13/6862/3507 (Taipei).
    ap.add_argument("--lat-min", type=float, default=25.015)
    ap.add_argument("--lat-max", type=float, default=25.050)
    ap.add_argument("--lon-min", type=float, default=121.555)
    ap.add_argument("--lon-max", type=float, default=121.593)
    ap.add_argument("--zoom", type=int, default=13, help="target zoom, >= base")
    ap.add_argument("--base-zoom", type=int, default=13,
                    help="zoom at which chunks are stored")
    ap.add_argument("--chunks-dir", default="./chunks")
    ap.add_argument("--out-dir", default="./tiles")
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--ss", type=int, default=2)
    ap.add_argument("--bg", default=None, help="fallback background, e.g. "
                    "'rgba(245,244,240,1)' for overlay styles")
    ap.add_argument("--profile", choices=["auto", "mapbox", "railway", "generic"],
                    default="auto")
    args = ap.parse_args(argv)

    with open(args.style, "r", encoding="utf-8") as fh:
        style = json.load(fh)

    render_area(style, args.lat_min, args.lat_max, args.lon_min, args.lon_max,
                args.zoom, args.base_zoom, args.chunks_dir, args.out_dir,
                args.size, args.ss, args.bg, args.profile)
    return 0


if __name__ == "__main__":
    sys.exit(main())
