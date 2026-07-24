function degToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.asinh(Math.tan((lat / 180) * Math.PI)) / Math.PI) / 2) * n);
  return [x, y];
}

function tileToBoundingbox(x, y, z) {
  const n = 2 ** z;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const north = (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const south = (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));
  return [west, south, east, north];
}

function areaToTiles(lon0, lat0, lon1, lat1, bazeZ) {
  const [x0, y0] = degToTile(lon0, lat0, bazeZ);
  const [x1, y1] = degToTile(lon1, lat1, bazeZ);
  const horizCount = Math.abs(x1 - x0) + 1;
  const vertiCount = Math.abs(y0 - y1) + 1;
  const count = horizCount * vertiCount;
  const tiles = [];
  for (let x = x0; x < x1 + 1; x++) {
    for (let y = y1; y < y0 + 1; y++) {
      tiles.push([x, y]);
    }
  }
  return tiles;
}

module.exports = {
  degToTile,
  tileToBoundingbox,
  areaToTiles
};
