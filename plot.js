const { getOrientation, projectCoordinate, tileToBoundingbox, getTileViewbox } = require('./coordinate');

function windPath(path, transformX, transformY, drawingOrientation) {
  const projectedPath = path.map((coordinate) => projectCoordinate(coordinate[0], coordinate[1]));
  const orientation = getOrientation(projectedPath);
  const outerPathLength = projectedPath.length;
  let pathCommand = '';
  if (drawingOrientation === orientation) {
    pathCommand += `M${transformX(projectedPath[0][0])} ${transformY(projectedPath[0][1])}`;
    for (let i = 1; i < outerPathLength; i++) {
      pathCommand += `L${transformX(projectedPath[i][0])} ${transformY(projectedPath[i][1])}`;
    }
  } else {
    pathCommand += `M${transformX(projectedPath[outerPathLength - 1][0])} ${transformY(projectedPath[outerPathLength - 1][1])}`;
    for (let i = outerPathLength - 2; i >= 0; i--) {
      pathCommand += `L${transformX(projectedPath[i][0])} ${transformY(projectedPath[i][1])}`;
    }
  }
  return pathCommand;
}

// type: Polygon
function plotPolygon(polygon, x0, y0, x1, y1, size = 512, precision = 2048) {
  const dX = x1 - x0;
  const dY = y1 - y0;
  const scaleX = size / dX;
  const scaleY = size / dY;
  const transformX = (x) => Math.floor((x - x0) * scaleX * precision) / precision;
  const transformY = (y) => Math.floor((dY - (y - y0)) * scaleY * precision) / precision;
  const polygonPaths = polygon.coordinates;
  const polygonPathsLength = polygonPaths.length;
  let pathCommand = '';
  if (polygonPathsLength === 0) {
    return '';
  } else if (polygonPathsLength === 1) {
    pathCommand += windPath(polygonPaths[0], transformX, transformY, 'clockwise');
    pathCommand += 'Z';
  } else {
    pathCommand += windPath(polygonPaths[0], transformX, transformY, 'clockwise');
    console.log(1);
    for (let i = 1; i < polygonPathsLength; i++) {
      pathCommand += windPath(polygonPaths[i], transformX, transformY, 'counterclockwise');
    }
    pathCommand += 'Z';
  }
  return pathCommand;
}

function plotLineString(lineString, x0, y0, x1, y1, size = 512, precision = 2048) {
  const dX = x1 - x0;
  const dY = y1 - y0;
  const scaleX = size / dX;
  const scaleY = size / dY;
  const transformX = (x) => (x - x0) * scaleX;
  const transformY = (y) => (dY - (y - y0)) * scaleY;
  let pathCommand = windPath(lineString.coordinates, transformX, transformY, 'clockwise');
  pathCommand += 'Z';
  return pathCommand;
}

module.exports = {
  plotPolygon,
  plotLineString
};
