import cairo
from style import StyleSheet

BACKGROUND_GEOMS = {"polygon", "line"}   # markers/text/points are NOT drawn here

def _rgba(hex_color, opacity=1.0):
    h = hex_color.lstrip("#")
    if len(h) == 3: h = "".join(c * 2 for c in h)
    r, g, b = (int(h[i:i+2], 16) / 255 for i in (0, 2, 4))
    return r, g, b, float(opacity)

def _trace(ctx, pts, close=False):
    if not pts: return
    ctx.move_to(*pts[0])
    for p in pts[1:]: ctx.line_to(*p)
    if close: ctx.close_path()

def _stroke(ctx, paint):
    ctx.set_line_width(float(paint.get("line-width", 1)))
    ctx.set_source_rgba(*_rgba(paint.get("line-color", "#000"),
                               float(paint.get("line-opacity", 1))))
    ctx.set_line_cap({"round": cairo.LINE_CAP_ROUND, "square": cairo.LINE_CAP_SQUARE,
                      "butt": cairo.LINE_CAP_BUTT}.get(paint.get("line-cap", "butt"),
                      cairo.LINE_CAP_BUTT))
    ctx.set_line_join({"round": cairo.LINE_JOIN_ROUND, "bevel": cairo.LINE_JOIN_BEVEL,
                       "miter": cairo.LINE_JOIN_MITER}.get(paint.get("line-join", "miter"),
                       cairo.LINE_JOIN_MITER))
    da = paint.get("line-dasharray")
    if da: ctx.set_dash([float(x) for x in str(da).replace(",", " ").split()])
    ctx.stroke(); ctx.set_dash([])

def render_tile(features, sheet, env, size=4096):
    """features: [{geom:'polygon'|'line', rings|coords:[(x,y),...], tags:{}, layer, z}]
       coords are tile-local pixels (0..size), e.g. from your pyosmium chunk reader."""
    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, size, size)
    ctx = cairo.Context(surface)

    bg = sheet.style_for({}, {**env, "layer": "background"})
    if "background-color" in bg:
        ctx.set_source_rgba(*_rgba(bg["background-color"])); ctx.paint()

    order = {"polygon": 0, "line": 1}          # polygons under lines by default
    for f in sorted(features, key=lambda f: (f.get("z", order.get(f["geom"], 0)))):
        if f["geom"] not in BACKGROUND_GEOMS:  # <-- skip markers/labels
            continue
        paint = sheet.style_for(f["tags"], {**env, "layer": f.get("layer")})
        if not paint:
            continue

        if f["geom"] == "polygon":
            for ring in f["rings"]: _trace(ctx, ring, close=True)
            if "polygon-fill" in paint:
                ctx.set_source_rgba(*_rgba(paint["polygon-fill"],
                                           float(paint.get("polygon-opacity", 1))))
                ctx.fill_preserve()
            if "line-color" in paint: _stroke(ctx, paint)   # outline
            ctx.new_path()

        elif f["geom"] == "line":
            if "casing-width" in paint:        # draw wider casing under the line
                ctx.new_path(); _trace(ctx, f["coords"])
                ctx.set_line_width(float(paint["casing-width"]))
                ctx.set_source_rgba(*_rgba(paint.get("casing-color", "#000")))
                ctx.set_line_cap(cairo.LINE_CAP_ROUND)
                ctx.set_line_join(cairo.LINE_JOIN_ROUND); ctx.stroke()
            ctx.new_path(); _trace(ctx, f["coords"]); _stroke(ctx, paint)

    return surface