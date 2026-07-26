// assemble.js
// Build filled area geometry from OSM `type=multipolygon` / `type=boundary`
// relations. In OSM, wide water (natural=water / water=river / waterway=riverbank),
// forests, landuse, etc. are frequently mapped as multipolygon relations whose
// tags live on the RELATION while the member ways are untagged fragments. The
// per-way render loop therefore never draws them -> visible blanks. This module
// stitches member ways into closed rings, groups inner rings (holes) under the
// outer ring that contains them, and propagates the styling tags.

// Signed area of a ring (shoelace); sign encodes winding, magnitude used for
// choosing the smallest containing outer ring.
function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
}

// Ray-casting point-in-polygon on [lon,lat] rings.
function pointInRing(pt, ring) {
  let inside = false;
  const x = pt[0];
  const y = pt[1];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Stitch a set of node-id fragments (way.refs) end-to-end into rings. Member
// ways of a relation are unordered and may be reversed, so we join by matching
// shared endpoints until each ring closes (first === last) or runs out.
function stitchRings(fragments) {
  const rings = [];
  const frags = fragments.filter((f) => Array.isArray(f) && f.length >= 2).map((f) => f.slice());
  while (frags.length) {
    let ring = frags.shift().slice();
    let changed = true;
    while (ring[0] !== ring[ring.length - 1] && changed) {
      changed = false;
      const head = ring[0];
      const tail = ring[ring.length - 1];
      for (let i = 0; i < frags.length; i++) {
        const f = frags[i];
        const fh = f[0];
        const ft = f[f.length - 1];
        if (fh === tail) {
          ring = ring.concat(f.slice(1));
        } else if (ft === tail) {
          ring = ring.concat(f.slice(0, -1).reverse());
        } else if (ft === head) {
          ring = f.slice(0, -1).concat(ring);
        } else if (fh === head) {
          ring = f.slice(1).reverse().concat(ring);
        } else {
          continue;
        }
        frags.splice(i, 1);
        changed = true;
        break;
      }
    }
    rings.push(ring);
  }
  return rings;
}

// Resolve a node-id ring to [lon,lat] coords. Returns null if any node is
// missing (ring crosses the chunk boundary) so the caller can drop it.
function ringToCoords(ring, nodeMap) {
  const coords = [];
  for (const id of ring) {
    const p = nodeMap.get(id);
    if (!p) return null;
    coords.push(p);
  }
  return coords;
}

/**
 * @param relations parsed relations: { id, members:[{type,ref,role}], tags }
 * @param ways Array<{ id, refs, tags }>
 * @param wayMap    Map<wayId, wayIdx>
 * @param nodeMap   Map<nodeId, [lon,lat]>
 * @returns { features: [{ tags, polygons:[[outer, ...holes], ...] }], memberWayIds:Set }
 *   `polygons` coordinates are in [lon,lat]; each entry is one outer ring
 *   followed by its hole rings, ready to pass to plotPolygon.
 */
function assembleAreas(relations, ways, wayMap, nodeMap) {
  const features = [];
  const memberWayIds = new Set();

  for (const rel of relations) {
    const type = rel.tags && rel.tags.type;
    if (type !== 'multipolygon' && type !== 'boundary') continue;

    const outerFrags = [];
    const innerFrags = [];
    let fallbackTags = null;

    for (const m of rel.members) {
      if (m.type !== 'way') continue;
      memberWayIds.add(m.ref);
      const idx = wayMap.get(m.ref);
      if (!idx) continue; // member way not present in this chunk
      const w = ways[idx];
      if (m.role === 'inner') {
        innerFrags.push(w.refs);
      } else {
        // default / empty / 'outer' role -> outer
        outerFrags.push(w.refs);
        if (!fallbackTags && w.tags && Object.keys(w.tags).length) fallbackTags = w.tags;
      }
    }
    if (!outerFrags.length) continue;

    // Prefer relation tags (minus `type`); fall back to tagged outer way
    // (old-style multipolygons put tags on the outer way).
    let tags = {};
    for (const k in rel.tags) if (k !== 'type') tags[k] = rel.tags[k];
    if (Object.keys(tags).length === 0 && fallbackTags) tags = { ...fallbackTags };
    if (Object.keys(tags).length === 0) continue;

    const outerRings = stitchRings(outerFrags)
      .map((r) => ringToCoords(r, nodeMap))
      .filter((r) => r && r.length >= 4);
    if (!outerRings.length) continue;

    const innerRings = stitchRings(innerFrags)
      .map((r) => ringToCoords(r, nodeMap))
      .filter((r) => r && r.length >= 4);

    // Each outer ring starts its own polygon; assign holes to the smallest
    // outer ring that contains them (nonzero fill then punches them out).
    const polygons = outerRings.map((o) => [o]);
    for (const inner of innerRings) {
      const probe = inner[0];
      let best = -1;
      let bestArea = Infinity;
      for (let i = 0; i < outerRings.length; i++) {
        if (pointInRing(probe, outerRings[i])) {
          const a = Math.abs(ringArea(outerRings[i]));
          if (a < bestArea) {
            bestArea = a;
            best = i;
          }
        }
      }
      if (best >= 0) polygons[best].push(inner);
    }

    features.push({ tags, polygons });
  }

  return { features, memberWayIds };
}

module.exports = {
  assembleAreas,
  stitchRings,
  pointInRing,
  ringArea
};
