const { getOrientation, projectCoordinate, tileToBoundingbox, getTileViewbox } = require('./coordinate');

// type: Polygon
function plotShape(polygon, x, y, z, size = 512) {
  const [x0, y0, x1, y1] = getTileViewbox(x, y, z);
  const dX = x1 - x0;
  const dY = y1 - y0;
  const scaleX = size / dX;
  const scaleY = size / dY;
  const transformX = (x) => (x - x0) * scaleX;
  const transformY = (y) => (dY - (y - y0)) * scaleY;
  const polygonPaths = polygon.coordinates;
  const polygonPathsLength = polygonPaths.length;
  if (polygonPathsLength === 0) {
    return '';
  } else if (polygonPathsLength === 1) {
    const outerPath = polygonPaths[0].map((coordinate) => projectCoordinate(coordinate[0], coordinate[1]));
    const orientation = getOrientation(outerPath);
    const outerPathLength = outerPath.length;
    let pathCommand = '';
    if (orientation === 'counterclockwise') {
      pathCommand += `M${transformX(outerPath[outerPathLength - 1][0])} ${transformY(outerPath[outerPathLength - 1][1])}`;
      for (let i = outerPathLength - 2; i >= 0; i--) {
        pathCommand += `L${transformX(outerPath[i][0])} ${transformY(outerPath[i][1])}`;
      }
      pathCommand += 'Z';
    } else if (orientation === 'clockwise') {
      pathCommand += `M${transformX(outerPath[0][0])} ${transformY(outerPath[0][1])}`;
      for (let i = 1; i < outerPathLength; i++) {
        pathCommand += `L${transformX(outerPath[i][0])} ${transformY(outerPath[i][1])}`;
      }
      pathCommand += 'Z';
    }
    console.log(pathCommand);
  } else {
    console.log(1);
    for (let i = 1; i < polygonPathsLength; i++) {}
  }
}

module.exports = {
  plotShape
};

function test() {
  const bbox = tileToBoundingbox(6863, 3502, 13);
  const [x0, y0] = projectCoordinate(bbox[0], bbox[1]);
  const [x1, y1] = projectCoordinate(bbox[2], bbox[3]);
  const dX = x1 - x0;
  const dY = y1 - y0;

  console.log(x1 - x0, y1 - y0);
  console.log(getTileViewbox(6863, 3502, 13));
}

test();
