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

function getParentTile(x, y, z, baseZ) {
  const shift = z - baseZ;
  return [x >> shift, y >> shift];
}

function getSubTiles(x, y, baseZ, maxZ) {
  if (maxZ < baseZ) {
    return [];
  }

  const subTiles = [];
  for (let targetZ = baseZ; targetZ < maxZ + 1; targetZ++) {
    const shift = targetZ - baseZ;
    const numTilesAxis = 1 << shift;

    const startX = x << shift;
    const startY = y << shift;

    for (let dx = 0; dx < numTilesAxis; dx++) {
      for (let dy = 0; dy < numTilesAxis; dy++) {
        subTiles.push([startX + dx, startY + dy, targetZ]);
      }
    }
  }
  return subTiles;
}

function getTileViewbox(x, y, z) {
  const R = 6378137;
  const degToRad = Math.PI / 180;
  const n = 2 ** z;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const north = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const south = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));
  const x0 = R * west * degToRad;
  const x1 = R * east * degToRad;
  const y0 = R * Math.log(Math.tan(Math.PI / 4 + south / 2));
  const y1 = R * Math.log(Math.tan(Math.PI / 4 + north / 2));
  return [x0, y0, x1, y1];
}

/**
 * project coordinate to x-y plane using web mercator
 * @param {number} lon longitude
 * @param {number} lat latitude
 * @returns [x, y]
 */
function projectCoordinate(lon, lat) {
  const R = 6378137;
  const degToRad = Math.PI / 180;
  return [R * lon * degToRad, R * Math.log(Math.tan(Math.PI / 4 + (lat * degToRad) / 2))];
}

/**
 * Determines the orientation of a polygon path.
 *
 * @param {Array<[number, number]>} coordinates
 * @returns {"clockwise" | "counterclockwise" | "degenerate"}
 */
function getOrientation(coordinates) {
  if (coordinates.length < 3) {
    return 'degenerate';
  }

  let area = 0;

  for (let i = 0, n = coordinates.length; i < n; i++) {
    const [x1, y1] = coordinates[i];
    const [x2, y2] = coordinates[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }

  if (area > 0) return 'counterclockwise';
  if (area < 0) return 'clockwise';
  return 'degenerate';
}

module.exports = {
  degToTile,
  tileToBoundingbox,
  areaToTiles,
  getParentTile,
  getSubTiles,
  getTileViewbox,
  projectCoordinate,
  getOrientation
};
