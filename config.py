import json
from coord import areaToTiles, tile2bbox

def build_config(tiles, zc, out_dir="chunks/"):
    extracts = []
    for (x, y) in tiles:
        w, s, e, n = tile2bbox(x, y, zc)
        extracts.append({
            "output": f"{zc}_{x}_{y}.osm.pbf",
            "bbox": [w, s, e, n],
        })
    return {"directory": out_dir, "extracts": extracts}

# tiles = areaToTiles(24.8, 121.27, 25.3, 122.004, 13)

# with open("config.json", "w") as f:
    json.dump(build_config(tiles, 13), f)

def build_extraction_script(lat0, lon0, lat1, lon1, zc, out_dir="chunks"):
    tiles = areaToTiles(lat0, lon0, lat1, lon1, zc)
    commands = []
    for (x, y) in tiles:
        commands.append(f"osmium extract -b {lon0},{lat0},{lon1},{lat1} -o {out_dir}/{zc}_{x}_{y}.osm.pbf input.osm.pbf\n")
    with open("extract.sh", "w") as f:
        f.writelines(commands)

build_extraction_script(24.8, 121.27, 25.3, 122.004, 13, "chunks")