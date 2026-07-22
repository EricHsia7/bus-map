import math

def deg2tile(lat, lon, z):
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat)
    y = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return x, y

def tile2bbox(x, y, z):
    n = 2 ** z
    west  = x / n * 360.0 - 180.0
    east  = (x + 1) / n * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return west, south, east, north

def areaToTiles(lat0, lon0, lat1, lon1, zc):
    x0, y0 = deg2tile(lat0, lon0, zc)
    x1, y1 = deg2tile(lat1, lon1, zc)
    horizCount = abs(x1 - x0) + 1
    vertiCount = abs(y0 - y1) + 1
    count = horizCount * vertiCount
    print(count)
    tiles = []
    for x in range(x0, x1 + 1):
        for y in range(y1, y0 + 1):
            tiles.append((x, y))
    if count > 500:
        print("This may exceeds the limit (extract count > 500)")
    return tiles

def areaToTilesAtScales(lat0, lon0, lat1, lon1, z0, z1):
    for z in range(z0, z1 + 1):
        x0, y0 = deg2tile(lat0, lon0, z)
        x1, y1 = deg2tile(lat1, lon1, z)
        horizCount = abs(x1 - x0) + 1
        vertiCount = abs(y0 - y1) + 1
        count = horizCount * vertiCount
        print(z, count)
        tiles = []
        for x in range(x0, x1 + 1):
            for y in range(y1, y0 + 1):
                tiles.append((x, y))
    return tiles