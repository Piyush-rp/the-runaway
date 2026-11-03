// Takes the trees off the roads. The city places trees (a canopy mesh + a trunk mesh, instanced in matching order) with
// no regard for the road network in places; this finds every tree standing on a road or one of the extra streets and
// shrinks that instance to nothing. Nothing else is touched.
import * as THREE from 'three';
import { getRoadPaths } from '../city/roads.js';

export function removeTreesOnRoads(ctx, extraStreets = [], margin = 0.3) {
  const { scene, layout } = ctx;
  const cell = 4, grid = new Map();
  const add = (x, z, half) => { const k = Math.floor(x / cell) + ',' + Math.floor(z / cell); (grid.get(k) || grid.set(k, []).get(k)).push([x, z, half]); };
  for (const r of getRoadPaths(layout)) {
    if (r.kind === 'access') continue;
    const n = Math.ceil(r.length / 1.1);
    for (let i = 0; i <= n; i++) { const p = r.center.getPointAt(i / n); add(p.x, p.z, r.width / 2); }
  }
  for (const s of extraStreets) { const n = Math.ceil(s.len / 1.0); for (let i = 0; i <= n; i++) add(s.ax + s.dx * (s.len * i / n), s.az + s.dz * (s.len * i / n), 0.85); }
  const onRoad = (x, z) => {
    const ix = Math.floor(x / cell), iz = Math.floor(z / cell);
    for (let i = ix - 1; i <= ix + 1; i++) for (let j = iz - 1; j <= iz + 1; j++) for (const p of grid.get(i + ',' + j) || []) if (Math.hypot(p[0] - x, p[1] - z) < p[2] + margin) return true;
    return false;
  };

  scene.updateMatrixWorld(true);
  const canopies = [], trunks = [];
  scene.traverse((o) => {
    if (!o.isInstancedMesh || o.name === 'drones' || o.name === 'extra-streets') return;
    if (o.parent?.name === 'roads' || o.parent?.name === 'core-platform') return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox, h = bb.max.y - bb.min.y, w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
    if (w >= 0.8 && h >= 1.0) canopies.push(o);
    else if (w <= 0.3 && h >= 0.5 && h <= 1.1) trunks.push(o);
  });

  const mat = new THREE.Matrix4(), v = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  let removed = 0;
  for (const c of canopies) {
    const mates = trunks.filter((t) => t.parent === c.parent && t.count === c.count); // the trunk mesh of the same trees
    let changed = false;
    for (let i = 0; i < c.count; i++) {
      c.getMatrixAt(i, mat); v.setFromMatrixPosition(mat).applyMatrix4(c.matrixWorld);
      if (!onRoad(v.x, v.z)) continue;
      c.setMatrixAt(i, zero); for (const t of mates) t.setMatrixAt(i, zero);
      removed++; changed = true;
    }
    if (changed) { c.instanceMatrix.needsUpdate = true; for (const t of mates) t.instanceMatrix.needsUpdate = true; }
  }
  return { removed, canopyMeshes: canopies.length, trunkMeshes: trunks.length };
}
