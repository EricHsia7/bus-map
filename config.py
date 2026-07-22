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

tiles = areaToTiles(24.8, 121.27, 25.3, 122.004, 13)

with open("config.json", "w") as f:
    json.dump(build_config(tiles, 13), f)

# print(tile2bbox(6864, 3506, 13))

# print(deg2tile(25.0331668, 121.5646286, 13))