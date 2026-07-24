#!/usr/bin/env python3
"""
compile-mml.py  --  compile an OpenStreetMap-Carto project.mml into a compact
JSON (mml.json) describing, per layer, the conditions and column expressions
that let you infer which layer/id a feature belongs to purely from its tags.

Pipeline (matches the three requested steps):
  1. Parse the YAML and pull out each Layer's Datasource SQL.
  2. Substitute the Mapnik render-time tokens (!bbox!, !pixel_width!,
     !pixel_height!, !scale_denominator!) -- plus a couple of Postgres-only
     spellings sqlglot doesn't accept -- with syntactically valid stand-ins.
  3. Parse the query with a real PostgreSQL parser (sqlglot), follow the FROM
     chain (the query "spine"), and extract the selection conditions (WHERE)
     and projected columns (feature, int_*, ...) as a small expression tree.

The query spine is followed so that sibling subqueries embedded inside SELECT
expressions (e.g. amenity-points' lateral shop/office lookups) are NOT mistaken
for pipeline filters. UNION ALL branches each become a `base` source.

Output shape (mml.json):
  [
    { "id": "water-lines", "geometry": "linestring", "minzoom": 12, "maxzoom": 22,
      "base": [                       # one per base-table SELECT (UNION branch)
        { "table": "planet_osm_line",
          "where": <tree|null>,       # predicate over RAW tag columns
          "columns": { "feature": <tree>, "int_bridge_tunnel": <tree>, ... } } ],
      "wrappers": [                    # outer SELECTs on the spine, innermost first
        { "where": <tree|null>,        # predicate over COMPUTED columns
          "columns": { "feature": <tree>, ... } } ] } , ... ]

Usage:  python compile-mml.py ./openstreetmap-carto-master/project.mml > mml.json
"""

import sys, re, json
import yaml
import sqlglot
from sqlglot import expressions as exp

# --------------------------------------------------------------------------
# Step 2: preprocessing (Mapnik tokens + Postgres spellings sqlglot dislikes)
# --------------------------------------------------------------------------

MAPNIK_TOKEN = re.compile(r'!([a-z_]+)!')
HSTORE_HAS = re.compile(r"""([\"\w]+)\s*\?\s*'([^']*)'""")  # tags ? 'k'

# Columns / identifiers that are render-time or spatial, never tag-based.
RENDER_TOKENS = {
    "__bbox__", "__pixel_width__", "__pixel_height__", "__scale_denominator__",
    "way", "way_area",
}


def preprocess(sql: str) -> str:
    sql = MAPNIK_TOKEN.sub(lambda m: '__' + m.group(1) + '__', sql)     # !token! -> __token__
    sql = HSTORE_HAS.sub(lambda m: "hstore_has(%s, '%s')" % (m.group(1), m.group(2)), sql)
    sql = sql.replace("U&'", "'")                                        # U&'\2212' -> '\2212'
    return sql


# --------------------------------------------------------------------------
# Step 3a: AST -> compact expression tree
# --------------------------------------------------------------------------

def lit_value(node: exp.Literal):
    return node.this  # keep numbers as strings; runtime coerces as needed


def json_key(node):
    """Extract the hstore/JSON key from  tags->\'k\'  /  tags->>\'k\'  (a JSONPath)."""
    e = node.args.get("expression")
    if e is None:
        return None
    if isinstance(e, exp.Literal):
        return lit_value(e)
    toks = re.findall(r"[\w:]+", e.sql(dialect="postgres"))
    return toks[-1] if toks else None


def to_tree(node):
    if node is None:
        return None
    if isinstance(node, exp.Paren):
        return to_tree(node.this)

    if isinstance(node, exp.And):
        return {"t": "and", "x": [to_tree(node.left), to_tree(node.right)]}
    if isinstance(node, exp.Or):
        return {"t": "or", "x": [to_tree(node.left), to_tree(node.right)]}
    if isinstance(node, exp.Not):
        return {"t": "not", "x": to_tree(node.this)}

    if isinstance(node, exp.Is):
        if isinstance(node.expression, exp.Null):
            return {"t": "isnull", "x": to_tree(node.this)}
        return {"t": "cmp", "op": "=", "l": to_tree(node.this), "r": to_tree(node.expression)}

    cmp_ops = {exp.EQ: "=", exp.NEQ: "!=", exp.GT: ">", exp.GTE: ">=", exp.LT: "<", exp.LTE: "<="}
    for cls, op in cmp_ops.items():
        if isinstance(node, cls):
            return {"t": "cmp", "op": op, "l": to_tree(node.left), "r": to_tree(node.right)}

    if isinstance(node, exp.In):
        return {"t": "in", "l": to_tree(node.this),
                "vals": [to_tree(e) for e in (node.args.get("expressions") or [])]}

    if isinstance(node, exp.RegexpLike):
        return {"t": "regex", "l": to_tree(node.this), "pat": to_tree(node.expression)}

    if isinstance(node, exp.Column):
        return {"t": "col", "name": node.name}
    if isinstance(node, exp.Literal):
        return {"t": "lit", "v": lit_value(node), "s": bool(node.is_string)}
    if isinstance(node, exp.Null):
        return {"t": "lit", "v": None, "s": False}
    if isinstance(node, exp.Boolean):
        return {"t": "lit", "v": bool(node.this), "s": False}

    if isinstance(node, (exp.JSONExtract, exp.JSONExtractScalar)):
        key = json_key(node)
        if key is not None:
            return {"t": "tag", "key": key}
        return {"t": "raw", "sql": node.sql(dialect="postgres")}

    if isinstance(node, exp.Coalesce):
        args = [to_tree(node.this)] + [to_tree(e) for e in (node.args.get("expressions") or [])]
        return {"t": "coalesce", "args": args}
    if isinstance(node, exp.Case):
        whens = [{"cond": to_tree(w.this), "then": to_tree(w.args.get("true"))}
                 for w in (node.args.get("ifs") or [])]
        return {"t": "case", "whens": whens, "else": to_tree(node.args.get("default"))}
    if isinstance(node, exp.DPipe):
        return {"t": "concat", "args": [to_tree(node.left), to_tree(node.right)]}
    if isinstance(node, exp.Cast):
        return {"t": "cast", "x": to_tree(node.this)}

    if isinstance(node, exp.Anonymous) and (node.name or "").lower() == "hstore_has":
        args = node.args.get("expressions") or []
        if len(args) > 1 and isinstance(args[1], exp.Literal):
            return {"t": "has", "key": lit_value(args[1])}

    if isinstance(node, exp.Func):
        name = node.name if isinstance(node, exp.Anonymous) else node.__class__.__name__.upper()
        raw_args = node.args.get("expressions")
        if not raw_args:
            raw_args = [v for v in node.args.values() if isinstance(v, exp.Expression)]
        return {"t": "func", "name": name, "args": [to_tree(a) for a in raw_args]}

    arith = {exp.Add: "+", exp.Sub: "-", exp.Mul: "*", exp.Div: "/"}
    for cls, op in arith.items():
        if isinstance(node, cls):
            return {"t": "arith", "op": op, "l": to_tree(node.left), "r": to_tree(node.right)}

    return {"t": "raw", "sql": node.sql(dialect="postgres")}


# --------------------------------------------------------------------------
# Step 3b: follow the FROM chain (spine) and pull base sources + wrappers
# --------------------------------------------------------------------------

BASE_TABLE = re.compile(r'^planet_osm_(point|line|polygon|roads)$')


def unwrap(node):
    """Strip Alias / Subquery / Paren wrappers to reach a Select or Union or Table."""
    while isinstance(node, (exp.Alias, exp.Subquery, exp.Paren)):
        node = node.this
    return node


def get_from(select: exp.Select):
    frm = select.args.get("from") or select.args.get("from_")
    return frm.this if frm else None


def from_table_name(select: exp.Select):
    t = get_from(select)
    return t.name if isinstance(t, exp.Table) else None


def columns_of(select: exp.Select):
    cols = {}
    for proj in select.expressions:
        if isinstance(proj, exp.Star):
            continue
        if isinstance(proj, exp.Alias):
            cols[proj.output_name] = to_tree(proj.this)
        elif isinstance(proj, exp.Column):
            cols[proj.name] = {"t": "col", "name": proj.name}
        else:
            cols[proj.output_name or proj.sql(dialect="postgres")] = to_tree(proj)
    return cols


def where_of(select: exp.Select):
    w = select.args.get("where")
    return to_tree(w.this) if w else None


def flatten_union(node):
    node = unwrap(node)
    if isinstance(node, exp.Union):
        return flatten_union(node.left) + flatten_union(node.right)
    return [node]


def follow(node):
    """Return (base_sources, wrappers_outer_to_inner) by following the FROM chain."""
    node = unwrap(node)

    if isinstance(node, exp.Union):
        base, wrap = [], []
        for part in flatten_union(node):
            b, w = follow(part)
            base += b
            wrap += w
        return base, wrap

    if isinstance(node, exp.Select):
        tname = from_table_name(node)
        if tname and BASE_TABLE.match(tname):
            return [{"table": tname, "where": where_of(node), "columns": columns_of(node)}], []
        nxt = get_from(node)
        if nxt is None:
            return [], [{"where": where_of(node), "columns": columns_of(node)}]
        sub_base, sub_wrap = follow(nxt)
        return sub_base, [{"where": where_of(node), "columns": columns_of(node)}] + sub_wrap

    return [], []


def compile_layer(layer, defaults):
    lid = layer.get("id")
    ds = layer.get("Datasource", {}) or {}
    sql = ds.get("table")
    props = layer.get("properties", {}) or {}

    out = {
        "id": lid,
        "geometry": layer.get("geometry"),
        "minzoom": props.get("minzoom", defaults.get("minzoom", 0)),
        "maxzoom": props.get("maxzoom", defaults.get("maxzoom", 22)),
        "base": [],
        "wrappers": [],
    }
    if not sql:
        return out

    tree = sqlglot.parse_one(preprocess(sql), dialect="postgres")
    base, wrappers_outer_to_inner = follow(tree)
    out["base"] = base
    out["wrappers"] = list(reversed(wrappers_outer_to_inner))  # innermost first
    return out


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "project.mml"
    doc = yaml.safe_load(open(path).read())
    defaults = {"minzoom": doc.get("minzoom", 0), "maxzoom": doc.get("maxzoom", 22)}
    compiled = [compile_layer(L, defaults) for L in doc.get("Layer", [])]
    sys.stdout.write(json.dumps(compiled, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
