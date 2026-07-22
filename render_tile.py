#!/usr/bin/env python3
"""
Render a vector tile to PNG using a compiled CartoCSS style.

Supports two input formats (auto-detected, or force with --format):

  * MVT  - a Mapbox Vector Tile .pbf (tiled, layered, tile-local coords)
  * OSM  - an OpenStreetMap .osm.pbf extract (raw nodes/ways + tags, lat/lon)

The compiled style is the JSON produced by compile-carto.js: an array of rules
    { "layer": "roads"|null, "filters": [...], "zoom": {min,max}, "paint": {...} }

Usage:
    python render_tile.py STYLE.json TILE.pbf Z X Y [options]
    python render_tile.py STYLE.json TILES_DIR   Z X Y      # TILES_DIR/Z/X/Y.pbf

Options:
    --format {auto,mvt,osm}   Input format (default auto)
    --out PATH                Output PNG (default tile_{z}_{x}_{y}.png)
    --size N                  Output size in px (default 512)
    --ss N                    Supersampling factor (default 2)
    --bg COLOR                Fallback background color
    --layer-map FILE.json     OSM tag->layer mapping overrides (OSM only)

No third-party MVT/OSM libraries are required; the protobufs are decoded by
hand. Only Pillow is needed for rasterization, and zlib (stdlib) for OSM blobs.
"""
import argparse
import gzip
import json
import math
import os
import re
import struct
import sys
import zlib

from PIL import Image, ImageChops, ImageColor, ImageDraw

GEOM_UNKNOWN, GEOM_POINT, GEOM_LINESTRING, GEOM_POLYGON = 0, 1, 2, 3
EXTENT = 4096          # coordinate space used by the unified renderer


# ==========================================================================
# Low-level protobuf primitives (shared by MVT and OSM decoders)
# ==========================================================================
def _read_varint(buf, pos):
    result = 0
    shift = 0
    while True:
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80):
            return result, pos
        shift += 7


def _skip_field(buf, pos, wire_type):
    if wire_type == 0:
        _, pos = _read_varint(buf, pos)
    elif wire_type == 1:
        pos += 8
    elif wire_type == 2:
        ln, pos = _read_varint(buf, pos)
        pos += ln
    elif wire_type == 5:
        pos += 4
    else:
        raise ValueError("Unsupported wire type %d" % wire_type)
    return pos


def _read_packed(chunk):
    vals = []
    pos = 0
    n = len(chunk)
    while pos < n:
        v, pos = _read_varint(chunk, pos)
        vals.append(v)
    return vals


def _zigzag(n):
    return (n >> 1) ^ -(n & 1)


def _to_int64(u):
    return u - (1 << 64) if u >= (1 << 63) else u


# ==========================================================================
# Mapbox Vector Tile decoder (spec v2)
# ==========================================================================
def _mvt_decode_value(chunk):
    pos, n, val = 0, len(chunk), None
    while pos < n:
        tag, pos = _read_varint(chunk, pos)
        field, wt = tag >> 3, tag & 7
        if field == 1 and wt == 2:
            ln, pos = _read_varint(chunk, pos)
            val = chunk[pos:pos + ln].decode("utf-8", "replace"); pos += ln
        elif field == 2 and wt == 5:
            val = struct.unpack("<f", chunk[pos:pos + 4])[0]; pos += 4
        elif field == 3 and wt == 1:
            val = struct.unpack("<d", chunk[pos:pos + 8])[0]; pos += 8
        elif field == 4 and wt == 0:
            val, pos = _read_varint(chunk, pos)
        elif field == 5 and wt == 0:
            val, pos = _read_varint(chunk, pos)
        elif field == 6 and wt == 0:
            raw, pos = _read_varint(chunk, pos); val = _zigzag(raw)
        elif field == 7 and wt == 0:
            raw, pos = _read_varint(chunk, pos); val = bool(raw)
        else:
            pos = _skip_field(chunk, pos, wt)
    return val


def _mvt_decode_feature(chunk):
    feat = {"type": GEOM_UNKNOWN, "tags": [], "geometry": []}
    pos, n = 0, len(chunk)
    while pos < n:
        tag, pos = _read_varint(chunk, pos)
        field, wt = tag >> 3, tag & 7
        if field == 2 and wt == 2:
            ln, pos = _read_varint(chunk, pos)
            feat["tags"] = _read_packed(chunk[pos:pos + ln]); pos += ln
        elif field == 3 and wt == 0:
            feat["type"], pos = _read_varint(chunk, pos)
        elif field == 4 and wt == 2:
            ln, pos = _read_varint(chunk, pos)
            feat["geometry"] = _read_packed(chunk[pos:pos + ln]); pos += ln
        else:
            pos = _skip_field(chunk, pos, wt)
    return feat


def _mvt_decode_layer(chunk):
    layer = {"name": "", "extent": 4096, "keys": [], "values": [], "features": []}
    pos, n = 0, len(chunk)
    while pos < n:
        tag, pos = _read_varint(chunk, pos)
        field, wt = tag >> 3, tag & 7
        if field == 1 and wt == 2:
            ln, pos = _read_varint(chunk, pos)
            layer["name"] = chunk[pos:pos + ln].decode("utf-8", "replace"); pos += ln
        elif field == 2 and wt == 2:
            ln, pos = _read_varint(chunk, pos)
            layer["features"].append(_mvt_decode_feature(chunk[pos:pos + ln])); pos += ln
        elif field == 3 and wt == 2:
            ln, pos = _read_varint(chunk, pos)
            layer["keys"].append(chunk[pos:pos + ln].decode("utf-8", "replace")); pos += ln
        elif field == 4 and wt == 2:
            ln, pos = _read_varint(chunk, pos)
            layer["values"].append(_mvt_decode_value(chunk[pos:pos + ln])); pos += ln
        elif field == 5 and wt == 0:
            layer["extent"], pos = _read_varint(chunk, pos)
        else:
            pos = _skip_field(chunk, pos, wt)
    return layer


def decode_mvt(buf):
    if buf[:2] == b"\x1f\x8b":
        buf = gzip.decompress(buf)
    layers = []
    pos, n = 0, len(buf)
    while pos < n:
        tag, pos = _read_varint(buf, pos)
        field, wt = tag >> 3, tag & 7
        if field == 3 and wt == 2:
            ln, pos = _read_varint(buf, pos)
            layers.append(_mvt_decode_layer(buf[pos:pos + ln])); pos += ln
        else:
            pos = _skip_field(buf, pos, wt)
    return layers


def _mvt_feature_props(layer, feat):
    props = {}
    tags = feat["tags"]
    for i in range(0, len(tags) - 1, 2):
        k, v = tags[i], tags[i + 1]
        if k < len(layer["keys"]) and v < len(layer["values"]):
            props[layer["keys"][k]] = layer["values"][v]
    return props


def _mvt_decode_geometry(geom):
    paths, cur = [], []
    x = y = i = 0
    n = len(geom)
    while i < n:
        cmd = geom[i]; i += 1
        cmd_id, count = cmd & 0x7, cmd >> 3
        if cmd_id == 1:                       # MoveTo
            for _ in range(count):
                x += _zigzag(geom[i]); y += _zigzag(geom[i + 1]); i += 2
                if cur:
                    paths.append(cur)
                cur = [(x, y)]
        elif cmd_id == 2:                     # LineTo
            for _ in range(count):
                x += _zigzag(geom[i]); y += _zigzag(geom[i + 1]); i += 2
                cur.append((x, y))
        elif cmd_id == 7:                     # ClosePath
            if cur:
                cur.append(cur[0]); paths.append(cur); cur = []
    if cur:
        paths.append(cur)
    return paths


def mvt_to_groups(layers):
    """Unified IR: {layer_name: {'extent': int, 'features': [feature,...]}}."""
    groups = {}
    for ly in layers:
        feats = []
        for f in ly["features"]:
            feats.append({
                "type": f["type"],
                "tags": _mvt_feature_props(ly, f),
                "paths": _mvt_decode_geometry(f["geometry"]),
            })
        groups[ly["name"]] = {"extent": ly.get("extent", 4096), "features": feats}
    return groups


# ==========================================================================
# OpenStreetMap PBF decoder (fileformat.proto + osmformat.proto)
# ==========================================================================
def _osm_parse_blob_header(buf):
    pos, n, btype, dsize = 0, len(buf), None, 0
    while pos < n:
        tag, pos = _read_varint(buf, pos)
        field, wt = tag >> 3, tag & 7
        if field == 1 and wt == 2:
            ln, pos = _read_varint(buf, pos)
            btype = buf[pos:pos + ln].decode("utf-8", "replace"); pos += ln
        elif field == 3 and wt == 0:
            dsize, pos = _read_varint(buf, pos)
        else:
            pos = _skip_field(buf, pos, wt)
    return btype, dsize


def _osm_parse_blob(buf):
    pos, n = 0, len(buf)
    raw = zlib_data = None
    while pos < n:
        tag, pos = _read_varint(buf, pos)
        field, wt = tag >> 3, tag & 7
        if field == 1 and wt == 2:
            ln, pos = _read_varint(buf, pos); raw = buf[pos:pos + ln]; pos += ln
        elif field == 3 and wt == 2:
            ln, pos = _read_varint(buf, pos); zlib_data = buf[pos:pos + ln]; pos += ln
        elif field in (4, 7, 8) and wt == 2:   # lzma / lz4 / zstd
            ln, pos = _read_varint(buf, pos)
            raise ValueError("Blob uses unsupported compression (field %d); "
                             "only raw and zlib are supported." % field)
        else:
            pos = _skip_field(buf, pos, wt)
    if raw is not None:
        return raw
    if zlib_data is not None:
        return zlib.decompress(zlib_data)
    raise ValueError("Empty OSM blob")


def _osm_iter_blobs(data):
    pos, n = 0, len(data)
    while pos + 4 <= n:
        hlen = struct.unpack(">i", data[pos:pos + 4])[0]; pos += 4
        header = data[pos:pos + hlen]; pos += hlen
        btype, dsize = _osm_parse_blob_header(header)
        blob = data[pos:pos + dsize]; pos += dsize
        yield btype, blob


def _osm_parse_stringtable(buf):
    s, pos, n = [], 0, len(buf)
    while pos < n:
        tag, pos = _read_varint(buf, pos)
        field, wt = tag >> 3, tag & 7
        if field == 1 and wt == 2:
            ln, pos = _read_varint(buf, pos)
            s.append(buf[pos:pos + ln].decode("utf-8", "replace")); pos += ln
        else:
            pos = _skip_field(buf, pos, wt)
    return s


def _osm_parse_primitive_block(buf):
    st, groups = [], []
    gran, lato, lono = 100, 0, 0
    pos, n = 0, len(buf)
    while pos < n:
        tag, pos = _read_varint(buf, pos)
        field, wt = tag >> 3, tag & 7
        if field == 1 and wt == 2:
            ln, pos = _read_varint(buf, pos)
            st = _osm_parse_stringtable(buf[pos:pos + ln]); pos += ln
        elif field == 2 and wt == 2:
            ln, pos = _read_varint(buf, pos)
            groups.append(buf[pos:pos + ln]); pos += ln
        elif field == 17 and wt == 0:
            gran, pos = _read_varint(buf, pos)
        elif field == 19 and wt == 0:
            v, pos = _read_varint(buf, pos); lato = _to_int64(v)
        elif field == 20 and wt == 0:
            v, pos = _read_varint(buf, pos); lono = _to_int64(v)
        else:
            pos = _skip_field(buf, pos, wt)
    return st, groups, gran, lato, lono


def _osm_parse_group(buf):
    nodes, dense, ways = [], None, []
    pos, n = 0, len(buf)
    while pos < n:
        tag, pos = _read_varint(buf, pos)
        field, wt = tag >> 3, tag & 7
        if field == 1 and wt == 2:
            ln, pos = _read_varint(buf, pos); nodes.append(buf[pos:pos + ln]); pos += ln
        elif field == 2 and wt == 2:
            ln, pos = _read_varint(buf, pos); dense = buf[pos:pos + ln]; pos += ln
        elif field == 3 and wt == 2:
            ln, pos = _read_varint(buf, pos); ways.append(buf[pos:pos + ln]); pos += ln
        else:
            pos = _skip_field(buf, pos, wt)     # relations / changesets skipped
    return nodes, dense, ways


def _osm_parse_dense(buf):
    ids = lats = lons = kv = []
    pos, n = 0, len(buf)
    while pos < n:
        tag, pos = _read_varint(buf, pos)
        field, wt = tag >> 3, tag & 7
        if field == 1 and wt == 2:
            ln, pos = _read_varint(buf, pos); ids = _read_packed(buf[pos:pos + ln]); pos += ln
        elif field == 8 and wt == 2:
            ln, pos = _read_varint(buf, pos); lats = _read_packed(buf[pos:pos + ln]); pos += ln
        elif field == 9 and wt == 2:
            ln, pos = _read_varint(buf, pos); lons = _read_packed(buf[pos:pos + ln]); pos += ln
        elif field == 10 and wt == 2:
            ln, pos = _read_varint(buf, pos); kv = _read_packed(buf[pos:pos + ln]); pos += ln
        else:
            pos = _skip_field(buf, pos, wt)
    return ids, lats, lons, kv


def _osm_parse_node(buf):
    keys = vals = []
    nid = lat = lon = 0
    pos, n = 0, len(buf)
    while pos < n:
        tag, pos = _read_varint(buf, pos)
        field, wt = tag >> 3, tag & 7
        if field == 1 and wt == 0:
            v, pos = _read_varint(buf, pos); nid = _zigzag(v)
        elif field == 2 and wt == 2:
            ln, pos = _read_varint(buf, pos); keys = _read_packed(buf[pos:pos + ln]); pos += ln
        elif field == 3 and wt == 2:
            ln, pos = _read_varint(buf, pos); vals = _read_packed(buf[pos:pos + ln]); pos += ln
        elif field == 8 and wt == 0:
            v, pos = _read_varint(buf, pos); lat = _zigzag(v)
        elif field == 9 and wt == 0:
            v, pos = _read_varint(buf, pos); lon = _zigzag(v)
        else:
            pos = _skip_field(buf, pos, wt)
    return nid, keys, vals, lat, lon


def _osm_parse_way(buf):
    keys = vals = refs = []
    wid = 0
    pos, n = 0, len(buf)
    while pos < n:
        tag, pos = _read_varint(buf, pos)
        field, wt = tag >> 3, tag & 7
        if field == 1 and wt == 0:
            wid, pos = _read_varint(buf, pos)
        elif field == 2 and wt == 2:
            ln, pos = _read_varint(buf, pos); keys = _read_packed(buf[pos:pos + ln]); pos += ln
        elif field == 3 and wt == 2:
            ln, pos = _read_varint(buf, pos); vals = _read_packed(buf[pos:pos + ln]); pos += ln
        elif field == 8 and wt == 2:
            ln, pos = _read_varint(buf, pos); refs = _read_packed(buf[pos:pos + ln]); pos += ln
        else:
            pos = _skip_field(buf, pos, wt)
    return wid, keys, vals, refs


def _tags_from_kv(keys, vals, st):
    tags = {}
    for k, v in zip(keys, vals):
        if k < len(st) and v < len(st):
            tags[st[k]] = st[v]
    return tags


def project(lat, lon, z, x, y, extent=EXTENT):
    """Web-Mercator lat/lon -> tile-local coords (0..extent) for tile z/x/y."""
    lat = max(-85.05112878, min(85.05112878, lat))
    n = 2.0 ** z
    xt = (lon + 180.0) / 360.0 * n
    lat_r = math.radians(lat)
    yt = (1.0 - math.asinh(math.tan(lat_r)) / math.pi) / 2.0 * n
    return ((xt - x) * extent, (yt - y) * extent)


DEFAULT_LAYER_MAP = {
    "water":      [{"key": "natural", "value": "water"},
                   {"key": "waterway", "value": "riverbank"},
                   {"key": "landuse", "value": "reservoir"}],
    "waterway":   [{"key": "waterway"}],
    "roads":      [{"key": "highway"}],
    "highway":    [{"key": "highway"}],
    "railway":    [{"key": "railway"}],
    "buildings":  [{"key": "building"}],
    "building":   [{"key": "building"}],
    "landuse":    [{"key": "landuse"}, {"key": "leisure"}, {"key": "natural"}],
    "landcover":  [{"key": "natural"}, {"key": "landuse"}],
    "boundary":   [{"key": "boundary"}, {"key": "admin_level"}],
    "poi":        [{"key": "amenity"}, {"key": "shop"}, {"key": "tourism"}],
    "places":     [{"key": "place"}],
}

_AREA_KEYS = ("building", "landuse", "leisure", "amenity", "shop", "tourism")


def _osm_is_polygon(tags, closed):
    if not closed:
        return False
    if tags.get("area") == "no":
        return False
    if tags.get("area") == "yes":
        return True
    if any(k in tags for k in _AREA_KEYS):
        return True
    nat = tags.get("natural")
    if nat and nat != "coastline":
        return True
    if tags.get("waterway") == "riverbank":
        return True
    return False   # closed highways/barriers/etc. stay lines


def _classify(tags, layer_name, layer_map):
    conds = layer_map.get(layer_name)
    if conds is None:
        return layer_name in tags        # fallback: tag key == layer name
    for c in conds:
        k, v = c.get("key"), c.get("value")
        if k in tags and (v is None or str(tags[k]) == str(v)):
            return True
    return False


# --------------------------------------------------------------------------
# OSM tag -> Mapbox/CartoCSS "vector-tile schema" mapping.
#
# Real compiled styles (mapbox-streets / osm-bright lineage) filter on derived
# attributes that DO NOT exist in raw OSM tags: `type`, `stylegroup`, `render`
# (a 3-pass casing/inline system), `bridge`, `tunnel`, `admin_level`. We must
# synthesise those here and route each element into the style's named layers
# (roads_high, water_gen0, waterway_med, buildings, landuse_gen0, ...).
# --------------------------------------------------------------------------
_HW_MOTORWAY = {"motorway", "motorway_link"}
_HW_MAINROAD = {"trunk", "trunk_link", "primary", "primary_link",
                "secondary", "secondary_link"}
_HW_MINOR = {"tertiary", "tertiary_link", "residential", "living_street",
             "unclassified", "road"}
_RAIL_TYPES = {"rail", "subway", "light_rail", "tram", "narrow_gauge",
               "monorail", "funicular", "preserved"}
_BRIDGE_YES = {"yes", "1", "true", "viaduct", "aqueduct", "boardwalk",
               "cantilever", "covered", "movable", "trestle"}
_TUNNEL_YES = {"yes", "1", "true", "culvert", "building_passage"}


def _road_stylegroup(hw):
    if hw in _HW_MOTORWAY:
        return "motorway"
    if hw in _HW_MAINROAD:
        return "mainroad"
    if hw in _HW_MINOR:
        return "minorroad"
    if hw == "service":
        return "service"
    return "noauto"


def _landuse_type(tags):
    lu = tags.get("landuse"); le = tags.get("leisure")
    am = tags.get("amenity"); nat = tags.get("natural")
    lu_map = {
        "cemetery": "cemetery", "commercial": "commercial", "retail": "commercial",
        "industrial": "industrial", "residential": "residential",
        "forest": "forest", "grass": "grass", "meadow": "grass",
        "farmland": "grass", "farmyard": "grass", "allotments": "grass",
        "recreation_ground": "park", "village_green": "park",
        "religious": "commercial", "construction": "commercial",
        "brownfield": "commercial", "garages": "commercial",
    }
    if lu in lu_map:
        return lu_map[lu]
    le_map = {"park": "park", "pitch": "pitch", "sports_centre": "sports_center",
              "stadium": "stadium", "golf_course": "golf_course",
              "recreation_ground": "park", "garden": "park"}
    if le in le_map:
        return le_map[le]
    am_map = {"school": "school", "college": "college", "university": "university",
              "hospital": "hospital", "parking": "parking", "grave_yard": "cemetery"}
    if am in am_map:
        return am_map[am]
    if nat == "wood":
        return "wood"
    if tags.get("highway") == "pedestrian":
        return "pedestrian"
    return None


def osm_emit_mapbox(tags, gtype):
    """Map one OSM element to the mapbox-streets / osm-bright vector schema."""
    out = []
    hw = tags.get("highway")
    rw = tags.get("railway")
    ww = tags.get("waterway")

    # ---- roads & railways (lines) ----
    if gtype == GEOM_LINESTRING and (hw or rw in _RAIL_TYPES):
        if hw:
            typ, sg = hw, _road_stylegroup(hw)
        else:
            typ, sg = rw, "railway"
        attrs = {"type": typ, "stylegroup": sg}
        if tags.get("bridge") in _BRIDGE_YES:
            attrs["bridge"] = "1"
        if tags.get("tunnel") in _TUNNEL_YES or tags.get("covered") == "yes":
            attrs["tunnel"] = "1"
        for rp in ("1_outline", "3_inline"):
            a = dict(attrs); a["render"] = rp
            out.append(("roads_high", a, GEOM_LINESTRING))
        out.append(("roads_med", dict(attrs), GEOM_LINESTRING))
        out.append(("roads_low", dict(attrs), GEOM_LINESTRING))
        if attrs.get("tunnel") == "1":
            a = dict(attrs); a["render"] = "2_line"
            out.append(("tunnel", a, GEOM_LINESTRING))
        return out

    # ---- waterways (lines) ----
    if gtype == GEOM_LINESTRING and ww in ("river", "canal", "stream", "ditch",
                                           "drain", "weir", "waterfall"):
        for L in ("waterway_low", "waterway_med", "waterway_high"):
            out.append((L, {"type": ww}, GEOM_LINESTRING))
        return out

    # ---- admin boundaries (lines) ----
    if gtype == GEOM_LINESTRING and (tags.get("boundary") == "administrative"
                                     and tags.get("admin_level")):
        out.append(("admin", {"admin_level": str(tags["admin_level"])},
                    GEOM_LINESTRING))
        return out

    # ---- aeroway (lines) ----
    if gtype == GEOM_LINESTRING and tags.get("aeroway") in ("runway", "taxiway"):
        out.append(("aeroway", {"type": tags["aeroway"]}, GEOM_LINESTRING))
        return out

    # ---- barrier (lines) ----
    if gtype == GEOM_LINESTRING and tags.get("barrier"):
        b = tags["barrier"]
        out.append(("barrier_lines",
                    {"stylegroup": b if b in ("gate", "fence", "hedge") else "fence"},
                    GEOM_LINESTRING))
        return out

    # ---- polygons ----
    if gtype == GEOM_POLYGON:
        if (tags.get("natural") in ("water", "bay")
                or tags.get("waterway") in ("riverbank", "dock")
                or tags.get("landuse") in ("reservoir", "basin")
                or tags.get("water")):
            out.append(("water_gen0", {}, GEOM_POLYGON))
            return out
        if tags.get("building"):
            out.append(("buildings", {}, GEOM_POLYGON))
            return out
        if tags.get("leisure") == "nature_reserve":
            out.append(("landuse_overlays", {"type": "nature_reserve"}, GEOM_POLYGON))
        if tags.get("natural") == "wetland":
            out.append(("landuse_overlays", {"type": "wetland"}, GEOM_POLYGON))
        lu = _landuse_type(tags)
        if lu:
            out.append(("landuse_gen0", {"type": lu}, GEOM_POLYGON))
        return out

    # ---- points ----
    if gtype == GEOM_POINT and tags.get("barrier"):
        out.append(("barrier_points", {"stylegroup": tags["barrier"]}, GEOM_POINT))
    return out


# --------------------------------------------------------------------------
# OSM CartoCSS profile: OpenRailwayMap and similar OSM-Carto derived styles.
#
# These styles come from a Mapnik project.mml whose PostGIS SQL layers expose
# derived columns (gaugeint, construction_railway, length_pixels, ...) that we
# must synthesise from raw OSM tags. Railway lines are drawn as separate
# casing / fill / low layers (analogous to the road casing system).
# --------------------------------------------------------------------------
_ORM_RAIL = {"rail", "light_rail", "subway", "tram", "narrow_gauge",
             "monorail", "funicular", "miniature", "preserved"}


def _gauge_int(tags):
    g = tags.get("gauge")
    if not g:
        return None
    first = re.split(r"[;,]", str(g))[0].strip()
    m = re.match(r"[0-9]+", first)
    return int(m.group(0)) if m else None


def _path_pixels(paths):
    """Approximate on-screen length (in 256px-tile pixels) of a geometry."""
    total = 0.0
    for p in paths:
        for i in range(1, len(p)):
            total += math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])
    return total * (256.0 / EXTENT)


def osm_emit_railway(tags, gtype):
    """Map one OSM element to the OpenRailwayMap CartoCSS schema."""
    out = []
    rw = tags.get("railway")

    # ---- railway lines (casing + fill + low, plus bridge / dual-gauge) ----
    if gtype == GEOM_LINESTRING and rw:
        railable = rw in _ORM_RAIL or rw in ("construction", "disused")
        if railable:
            attrs = {"railway": rw}
            if rw == "construction":
                attrs["construction_railway"] = (tags.get("construction:railway")
                                                 or tags.get("construction") or "")
            elif rw == "disused":
                attrs["disused_railway"] = (tags.get("disused:railway")
                                            or tags.get("disused") or "")
            for k in ("usage", "service", "voltage", "frequency", "maxspeed",
                      "electrified"):
                if tags.get(k) is not None:
                    attrs[k] = tags[k]
            gi = _gauge_int(tags)
            if gi is not None:
                attrs["gaugeint"] = gi
            dual = bool(tags.get("gauge") and re.search(r"[;,]", str(tags["gauge"])))

            for L in ("railway_line_casing", "railway_line_fill",
                      "railway_line_low"):
                out.append((L, dict(attrs), GEOM_LINESTRING))
            if dual:
                out.append(("railway_dual_gauge_line", dict(attrs), GEOM_LINESTRING))
            if tags.get("bridge") in _BRIDGE_YES:
                out.append(("railway_bridge", dict(attrs), GEOM_LINESTRING))
            if (tags.get("construction:electrified")
                    or tags.get("proposed:electrified")):
                out.append(("electrification_future", dict(attrs), GEOM_LINESTRING))
            return out

    # ---- railway points (signals, stations, switches, ...) ----
    if gtype == GEOM_POINT and rw:
        pattrs = {"railway": rw}
        for k in ("station", "service", "ref"):
            if tags.get(k) is not None:
                pattrs[k] = tags[k]
        if rw == "switch":
            out.append(("railway_switch_ref", pattrs, GEOM_POINT))
        elif rw == "turntable":
            out.append(("railway_turntables", pattrs, GEOM_POINT))
        elif rw in ("station", "halt", "tram_stop", "subway_entrance"):
            out.append(("railway_symbols", pattrs, GEOM_POINT))
        else:
            out.append(("railway_signals", pattrs, GEOM_POINT))
        return out

    if gtype == GEOM_POINT and tags.get("man_made") in ("mast", "tower", "antenna"):
        out.append(("electrification-signals",
                    {"man_made": tags["man_made"]}, GEOM_POINT))
        return out

    # ---- signal boxes (buildings/areas) ----
    if gtype == GEOM_POLYGON and rw in ("signal_box", "turntable"):
        out.append(("signal_boxes_polygon", {}, GEOM_POLYGON))
        return out
    return out


def _generic_emit(tags, gtype):
    """No schema mapping; rely on --layer-map / _classify passthrough only."""
    return []


EMITTERS = {
    "mapbox": osm_emit_mapbox,
    "railway": osm_emit_railway,
    "generic": _generic_emit,
}


def detect_profile(style_layers):
    """Pick an OSM->schema emitter by inspecting the compiled style's layers."""
    names = {str(x) for x in style_layers if x}
    if any(n.startswith(("railway", "electrification", "signal_box"))
           for n in names):
        return "railway"
    if names & {"roads_high", "roads_med", "water_gen0", "buildings",
                "landuse_gen0"}:
        return "mapbox"
    return "mapbox"


def decode_osm(data, style_layers, z, x, y, layer_map, emit_fn=None):
    """Decode an OSM PBF and return unified render groups for tile z/x/y."""
    node_xy = {}     # id -> (px, py) in extent coords
    node_tags = {}   # id -> tags dict (only for tagged nodes)
    ways = []        # (tags, refs)

    for btype, blob in _osm_iter_blobs(data):
        if btype != "OSMData":
            continue
        raw = _osm_parse_blob(blob)
        st, groups, gran, lato, lono = _osm_parse_primitive_block(raw)
        scale_ll = 1e-9
        for gbuf in groups:
            nodes, dense, waybufs = _osm_parse_group(gbuf)

            if dense is not None:
                ids, lats, lons, kv = _osm_parse_dense(dense)
                cid = clat = clon = 0
                kvi = 0
                for j in range(len(ids)):
                    cid += _zigzag(ids[j])
                    clat += _zigzag(lats[j])
                    clon += _zigzag(lons[j])
                    lat = scale_ll * (lato + gran * clat)
                    lon = scale_ll * (lono + gran * clon)
                    node_xy[cid] = project(lat, lon, z, x, y)
                    if kv:                       # 0-terminated tag pairs per node
                        tags = {}
                        while kvi < len(kv) and kv[kvi] != 0:
                            k, v = kv[kvi], kv[kvi + 1]; kvi += 2
                            if k < len(st) and v < len(st):
                                tags[st[k]] = st[v]
                        kvi += 1                 # skip terminator
                        if tags:
                            node_tags[cid] = tags

            for nb in nodes:
                nid, keys, vals, lat_i, lon_i = _osm_parse_node(nb)
                lat = scale_ll * (lato + gran * lat_i)
                lon = scale_ll * (lono + gran * lon_i)
                node_xy[nid] = project(lat, lon, z, x, y)
                tags = _tags_from_kv(keys, vals, st)
                if tags:
                    node_tags[nid] = tags

            for wb in waybufs:
                wid, keys, vals, refs = _osm_parse_way(wb)
                tags = _tags_from_kv(keys, vals, st)
                # refs are delta-encoded, zigzag
                resolved, acc = [], 0
                for d in refs:
                    acc += _zigzag(d)
                    resolved.append(acc)
                ways.append((tags, resolved))

    margin = EXTENT * 0.05
    lo, hi = -margin, EXTENT + margin

    def in_tile(pts):
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        return max(xs) >= lo and min(xs) <= hi and max(ys) >= lo and min(ys) <= hi

    out = {}

    def add(layer, feat):
        out.setdefault(layer, {"extent": EXTENT, "features": []})["features"].append(feat)

    emit = emit_fn or osm_emit_mapbox

    def route(tags, gtype, paths):
        seen = set()
        lp = _path_pixels(paths) if gtype == GEOM_LINESTRING else None
        for L, attrs, gt in emit(tags, gtype):
            if L in style_layers:
                merged = dict(tags); merged.update(attrs)
                if lp is not None and "length_pixels" not in merged:
                    merged["length_pixels"] = lp
                add(L, {"type": gt, "tags": merged, "paths": paths})
                seen.add(L)
        # honour any user-supplied --layer-map overrides too
        if layer_map:
            for L in style_layers:
                if L in layer_map and L not in seen and _classify(tags, L, layer_map):
                    add(L, {"type": gtype, "tags": tags, "paths": paths})

    for nid, tags in node_tags.items():
        xy = node_xy.get(nid)
        if xy is None or not (lo <= xy[0] <= hi and lo <= xy[1] <= hi):
            continue
        route(tags, GEOM_POINT, [[xy]])

    for tags, refs in ways:
        pts = [node_xy[r] for r in refs if r in node_xy]
        if len(pts) < 2 or not in_tile(pts):
            continue
        closed = len(refs) > 3 and refs[0] == refs[-1]
        gtype = GEOM_POLYGON if _osm_is_polygon(tags, closed) else GEOM_LINESTRING
        route(tags, gtype, [pts])

    return out


# ==========================================================================
# Style helpers
# ==========================================================================
def parse_color(value):
    if value is None:
        return None
    s = str(value).strip()
    # CartoCSS colour math the compiler left unresolved, e.g.
    #   "rgba(252,251,231,1) * 0.9 * 0.8"  ->  darken the RGB by each factor.
    factors = [float(x) for x in re.findall(r"\*\s*([0-9]*\.?[0-9]+)", s)]

    def _apply(rgba):
        if rgba is None:
            return None
        r, g, b, a = rgba
        for f in factors:
            r = max(0.0, min(255.0, r * f))
            g = max(0.0, min(255.0, g * f))
            b = max(0.0, min(255.0, b * f))
        return (int(round(r)), int(round(g)), int(round(b)), a)

    m = re.match(r"rgba?\(([^)]+)\)", s, re.I)
    if m:
        parts = [p.strip() for p in m.group(1).replace("/", ",").split(",") if p.strip()]
        try:
            r = int(round(float(parts[0]))); g = int(round(float(parts[1])))
            b = int(round(float(parts[2])))
            a = float(parts[3]) if len(parts) > 3 else 1.0
            return _apply((r, g, b, max(0.0, min(1.0, a))))
        except (ValueError, IndexError):
            return None
    try:
        rgb = ImageColor.getrgb(s)
        base = (rgb[0], rgb[1], rgb[2], rgb[3] / 255.0) if len(rgb) == 4 else (rgb[0], rgb[1], rgb[2], 1.0)
        return _apply(base)
    except ValueError:
        return None


def parse_number(value, default=0.0):
    if value is None:
        return default
    m = re.match(r"[-+]?[0-9]*\.?[0-9]+", str(value).strip())
    return float(m.group(0)) if m else default


def eval_number(value, default=0.0):
    """Evaluate simple width arithmetic like '14 / 4 + 6' or '1.6 + 2'."""
    if value is None:
        return default
    s = str(value).strip()
    if re.fullmatch(r"[0-9eE+\-*/.() \t]+", s):
        try:
            return float(eval(compile(s, "<width>", "eval"), {"__builtins__": {}}, {}))
        except Exception:
            pass
    return parse_number(value, default)


def _coerce(a, b):
    try:
        return float(a), float(b)
    except (TypeError, ValueError):
        return str(a), str(b)


def _cmp_one(have, op, want):
    # The compiler sometimes keeps quotes in filter values, e.g. '"rail"'.
    if isinstance(want, str):
        w = want.strip()
        if len(w) >= 2 and w[0] == w[-1] and w[0] in "\"'":
            w = w[1:-1]
        want = w
    # CartoCSS uses [key=null] / [key!=null] to test tag presence.
    if isinstance(want, str) and want.lower() == "null":
        present = have is not None and have != ""
        if op == "=":
            return not present
        if op == "!=":
            return present
    if have is None:
        return op == "!="
    lv, rv = _coerce(have, want)
    if op == "=":
        return lv == rv
    if op == "!=":
        return lv != rv
    if op == ">":
        return lv > rv
    if op == "<":
        return lv < rv
    if op == ">=":
        return lv >= rv
    if op == "<=":
        return lv <= rv
    return False


def matches_filters(props, filters):
    # The CartoCSS compiler flattens comma-separated selectors into one rule
    # with several filters that share a key (e.g. type=river, type=canal).
    # Those must be OR-ed together; filters on *different* keys are AND-ed.
    by_key = {}
    for f in filters:
        by_key.setdefault(f.get("key"), []).append(f)
    for key, fs in by_key.items():
        have = props.get(key)
        eqs = [f for f in fs if f.get("op") == "="]
        others = [f for f in fs if f.get("op") != "="]
        ok = True
        if eqs:
            ok = any(_cmp_one(have, "=", f.get("value")) for f in eqs)
        for f in others:
            ok = ok and _cmp_one(have, f.get("op"), f.get("value"))
        if not ok:
            return False
    return True


def zoom_ok(rule, z):
    zoom = rule.get("zoom") or {}
    mn = zoom.get("min")
    mx = zoom.get("max")
    mn = 0 if mn is None else mn
    mx = 24 if mx is None else mx
    # Compiler quirk: generalized low-zoom layers (land-low, *_gen0) come out
    # with min > max. Treat those as "min and up" so they still render.
    if mn > mx:
        return z >= mn
    return mn <= z <= mx


# ==========================================================================
# Rasterization (source-agnostic: consumes unified groups)
# ==========================================================================
def _fill_polygon(base, rings_px, rgba, size):
    r, g, b, a = rgba
    mask = Image.new("L", size, 0)
    for ring in rings_px:
        if len(ring) < 3:
            continue
        ring_mask = Image.new("L", size, 0)
        ImageDraw.Draw(ring_mask).polygon(ring, fill=255)
        mask = ImageChops.difference(mask, ring_mask)   # XOR -> even-odd holes
    if a < 1.0:
        mask = mask.point(lambda v: int(v * a))
    color_img = Image.new("RGBA", size, (r, g, b, 255))
    color_img.putalpha(mask)
    return Image.alpha_composite(base, color_img)


def _stroke_paths(base, paths_px, rgba, width, size):
    r, g, b, a = rgba
    overlay = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    col = (r, g, b, int(round(255 * a)))
    w = max(1, int(round(width)))
    for path in paths_px:
        if len(path) < 2:
            continue
        d.line(path, fill=col, width=w, joint="curve")
        if w > 2:
            for (px, py) in (path[0], path[-1]):
                d.ellipse([px - w / 2, py - w / 2, px + w / 2, py + w / 2], fill=col)
    return Image.alpha_composite(base, overlay)


def _draw_markers(base, points_px, rgba, radius, size):
    r, g, b, a = rgba
    overlay = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    col = (r, g, b, int(round(255 * a)))
    rad = max(1, radius)
    for (px, py) in points_px:
        d.ellipse([px - rad, py - rad, px + rad, py + rad], fill=col)
    return Image.alpha_composite(base, overlay)


def render(groups, style, z, size=512, ss=2, fallback_bg=None):
    canvas = (size * ss, size * ss)

    bg = parse_color(fallback_bg) if fallback_bg else None
    for rule in style:
        if rule.get("layer") is None and zoom_ok(rule, z):
            c = parse_color(rule.get("paint", {}).get("background-color"))
            if c:
                bg = c
    if bg:
        r, g, b, a = bg
        base = Image.new("RGBA", canvas, (r, g, b, int(round(255 * a))))
    else:
        base = Image.new("RGBA", canvas, (0, 0, 0, 0))

    px_scale = (size / 256.0) * ss
    draw = ImageDraw.Draw(base)

    def _pass_rank(feat):
        # roads_high mixes casing (1_outline) and fill (3_inline) in one layer.
        return {"1_outline": 0, "2_line": 1, "3_inline": 2}.get(
            feat["tags"].get("render"), 0)

    def _blend(overlay, alpha):
        nonlocal base, draw
        if alpha < 1.0:
            ov_a = overlay.getchannel("A").point(lambda v: int(v * alpha))
            overlay.putalpha(ov_a)
        base = Image.alpha_composite(base, overlay)
        draw = ImageDraw.Draw(base)

    def _parse_dash(value):
        if value is None:
            return None
        if isinstance(value, (list, tuple)):
            nums = [float(v) for v in value]
        else:
            nums = [float(x) for x in re.findall(r"[0-9]*\.?[0-9]+", str(value))]
        nums = [n * px_scale for n in nums if n > 0]
        return nums or None

    def _dash(path, pattern):
        segs, cur = [], [path[0]]
        idx, rem, drawing = 0, pattern[0], True
        for i in range(1, len(path)):
            x0, y0 = path[i - 1]; x1, y1 = path[i]
            seglen = math.hypot(x1 - x0, y1 - y0)
            pos = 0.0
            while seglen - pos > 1e-9:
                step = min(rem, seglen - pos)
                t1 = (pos + step) / seglen
                bx, by = x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1
                if drawing:
                    if not cur:
                        t0 = pos / seglen
                        cur = [(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0)]
                    cur.append((bx, by))
                pos += step; rem -= step
                if rem <= 1e-9:
                    if drawing and len(cur) >= 2:
                        segs.append(cur)
                    cur = []
                    idx = (idx + 1) % len(pattern)
                    rem = pattern[idx]
                    drawing = not drawing
        if drawing and len(cur) >= 2:
            segs.append(cur)
        return segs

    def _do_fill(paths_px, rgba):
        r, g, b, a = rgba
        if a >= 0.996 and len(paths_px) == 1:
            if len(paths_px[0]) >= 3:
                draw.polygon(paths_px[0], fill=(r, g, b, 255))
            return
        mask = Image.new("L", canvas, 0)
        for ring in paths_px:
            if len(ring) < 3:
                continue
            rm = Image.new("L", canvas, 0)
            ImageDraw.Draw(rm).polygon(ring, fill=255)
            mask = ImageChops.difference(mask, rm)   # even-odd holes
        col = Image.new("RGBA", canvas, (r, g, b, 255))
        col.putalpha(mask)
        _blend(col, a)

    def _do_stroke(paths_px, rgba, width, dash=None):
        if width <= 0:
            return
        r, g, b, a = rgba
        w = max(1, int(round(width)))
        segments = []
        for p in paths_px:
            if len(p) < 2:
                continue
            segments.extend(_dash(p, dash) if dash else [p])
        if a >= 0.996:
            col = (r, g, b, 255)
            for p in segments:
                if len(p) >= 2:
                    draw.line(p, fill=col, width=w, joint="curve")
            return
        ov = Image.new("RGBA", canvas, (0, 0, 0, 0))
        od = ImageDraw.Draw(ov)
        col = (r, g, b, 255)
        for p in segments:
            if len(p) >= 2:
                od.line(p, fill=col, width=w, joint="curve")
        _blend(ov, a)

    def _do_markers(points_px, rgba, radius):
        r, g, b, a = rgba
        rad = max(1, radius)
        if a >= 0.996:
            for (px, py) in points_px:
                draw.ellipse([px - rad, py - rad, px + rad, py + rad], fill=(r, g, b, 255))
            return
        ov = Image.new("RGBA", canvas, (0, 0, 0, 0))
        od = ImageDraw.Draw(ov)
        for (px, py) in points_px:
            od.ellipse([px - rad, py - rad, px + rad, py + rad], fill=(r, g, b, 255))
        _blend(ov, a)

    # Group rules by layer, preserving first-seen (paint) order.
    layer_order, rules_by_layer = [], {}
    for rule in style:
        name = rule.get("layer")
        if name is None:
            continue
        if name not in rules_by_layer:
            rules_by_layer[name] = []
            layer_order.append(name)
        rules_by_layer[name].append(rule)

    for name in layer_order:
        grp = groups.get(name)
        if not grp:
            continue
        active = [r for r in rules_by_layer[name] if zoom_ok(r, z)]
        if not active:
            continue
        scale = canvas[0] / float(grp.get("extent", EXTENT))
        for feat in sorted(grp["features"], key=_pass_rank):
            props = feat["tags"]
            # cascade: merge the paint of every matching rule (later wins), so
            # the compiler's split color/width declarations combine into one.
            paint = {}
            for rule in active:
                if matches_filters(props, rule.get("filters", [])):
                    paint.update(rule.get("paint", {}))
            if not paint:
                continue
            paths_px = [[(px * scale, py * scale) for (px, py) in p]
                        for p in feat["paths"]]
            gt = feat["type"]
            if gt == GEOM_POLYGON:
                fill = parse_color(paint.get("polygon-fill"))
                if fill:
                    r, g, b, a = fill
                    _do_fill(paths_px, (r, g, b, a * parse_number(
                        paint.get("polygon-opacity"), 1.0)))
            if gt in (GEOM_POLYGON, GEOM_LINESTRING):
                stroke = parse_color(paint.get("line-color"))
                if stroke:
                    r, g, b, a = stroke
                    _do_stroke(paths_px, (r, g, b, a * parse_number(
                        paint.get("line-opacity"), 1.0)),
                        eval_number(paint.get("line-width"), 1.0) * px_scale,
                        _parse_dash(paint.get("line-dasharray")))
            elif gt == GEOM_POINT:
                marker = parse_color(paint.get("marker-fill")
                                     or paint.get("marker-line-color"))
                if marker:
                    r, g, b, a = marker
                    mw = eval_number(paint.get("marker-width"), 6.0) * px_scale
                    pts = [pt for p in paths_px for pt in p]
                    _do_markers(pts, (r, g, b, a * parse_number(
                        paint.get("marker-opacity"), 1.0)), mw / 2.0)

    if ss != 1:
        base = base.resize((size, size), Image.LANCZOS)
    return base


# ==========================================================================
# CLI
# ==========================================================================
def sniff_format(raw):
    if raw[:2] == b"\x1f\x8b":
        return "mvt"                       # gzipped MVT tile
    if len(raw) > 4:
        hlen = struct.unpack(">i", raw[:4])[0]
        if 0 < hlen < 64 * 1024 and 4 + hlen <= len(raw):
            try:
                btype, _ = _osm_parse_blob_header(raw[4:4 + hlen])
                if btype and btype.startswith("OSM"):
                    return "osm"
            except Exception:
                pass
    return "mvt"


def load_tile_bytes(pbf_arg, z, x, y):
    path = pbf_arg
    if os.path.isdir(pbf_arg):
        path = os.path.join(pbf_arg, str(z), str(x), "%s.pbf" % y)
    with open(path, "rb") as fh:
        return fh.read(), path


def main(argv=None):
    ap = argparse.ArgumentParser(description="Render an MVT or OSM .pbf with a compiled CartoCSS style.")
    ap.add_argument("style")
    ap.add_argument("pbf", help="A .pbf file, or a tiles dir (TILES/Z/X/Y.pbf)")
    ap.add_argument("z", type=int)
    ap.add_argument("x", type=int)
    ap.add_argument("y", type=int)
    ap.add_argument("--format", choices=["auto", "mvt", "osm"], default="auto")
    ap.add_argument("--out", default=None)
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--ss", type=int, default=2)
    ap.add_argument("--bg", default=None)
    ap.add_argument("--layer-map", default=None, help="OSM tag->layer JSON overrides")
    ap.add_argument("--profile", choices=["auto", "mapbox", "railway", "generic"],
                    default="auto",
                    help="OSM->schema mapping profile (auto-detected from style)")
    args = ap.parse_args(argv)

    with open(args.style, "r", encoding="utf-8") as fh:
        style = json.load(fh)

    raw, tile_path = load_tile_bytes(args.pbf, args.z, args.x, args.y)
    fmt = sniff_format(raw) if args.format == "auto" else args.format

    profile = "-"
    if fmt == "osm":
        layer_map = dict(DEFAULT_LAYER_MAP)
        if args.layer_map:
            with open(args.layer_map, "r", encoding="utf-8") as fh:
                layer_map.update(json.load(fh))
        style_layers = {r.get("layer") for r in style if r.get("layer")}
        profile = detect_profile(style_layers) if args.profile == "auto" else args.profile
        emit_fn = EMITTERS.get(profile, osm_emit_mapbox)
        groups = decode_osm(raw, style_layers, args.z, args.x, args.y, layer_map, emit_fn)
    else:
        groups = mvt_to_groups(decode_mvt(raw))

    out = args.out or "tile_%d_%d_%d.png" % (args.z, args.x, args.y)
    img = render(groups, style, args.z, size=args.size, ss=args.ss, fallback_bg=args.bg)
    img.save(out)

    summary = ", ".join("%s(%d)" % (k, len(v["features"])) for k, v in groups.items()) or "(none)"
    print("Tile:   %s" % tile_path)
    print("Format: %s" % fmt)
    if fmt == "osm":
        print("Profile: %s" % profile)
    print("Groups: %s" % summary)
    print("Zoom:   %d" % args.z)
    print("Wrote:  %s (%dx%d)" % (out, args.size, args.size))
    return 0


if __name__ == "__main__":
    sys.exit(main())
