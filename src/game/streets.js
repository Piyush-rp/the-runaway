// Extra side streets and alleys that make the road network denser and more tangled: shortcuts, cut-throughs and dead
// ends to lose a chase in. They are generated once at startup against the captured height map, so they only ever run
// over free ground (never through a building), and they join the existing roads as T-junctions or crossings.
// Deterministic (seeded), purely visual + gameplay routes; the original roads and traffic lanes are untouched.
import * as THREE from 'three';
import { getRoadPaths } from '../city/roads.js';

const CFG = {
  attempts: 3000, maxStreets: 90, minLen: 7, maxLen: 40, width: 1.7, clearTol: 0.22,
  rMin: 17, rMax: 146, deadEndChance: 0.25, seed: 20261103,
};

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

class Grid {
  constructor(cell = 5) { this.cell = cell; this.m = new Map(); }
  add(x, z, dx = 0, dz = 0) { const k = `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`; (this.m.get(k) || this.m.set(k, []).get(k)).push({ x, z, dx, dz }); }
  near(x, z, r, fn) {
    const c = this.cell, ix = Math.floor(x / c), iz = Math.floor(z / c), n = Math.ceil(r / c);
    for (let i = ix - n; i <= ix + n; i++) for (let j = iz - n; j <= iz + n; j++) { const a = this.m.get(`${i},${j}`); if (a) for (const p of a) fn(p, Math.hypot(p.x - x, p.z - z)); }
  }
  dist(x, z, r = 6) { let best = r; this.near(x, z, r, (p, d) => { if (d < best) best = d; }); return best; }
}

export function buildStreets(ctx, hm) {
  const { scene, layout } = ctx;
  const rnd = rng(CFG.seed);
  const roads = getRoadPaths(layout);

  // sample the existing road network: a hash for distance queries + anchor points (with tangents) to branch from
  const existing = new Grid(), anchors = [];
  const p = new THREE.Vector3(), t = new THREE.Vector3();
  for (const r of roads) {
    const n = Math.max(2, Math.ceil(r.length / 2.5));
    for (let i = 0; i <= n; i++) {
      const u = i / n; r.center.getPointAt(u, p); r.center.getTangentAt(u, t);
      existing.add(p.x, p.z, t.x, t.z);
      const rad = Math.hypot(p.x, p.z);
      if (r.kind !== 'access' && r.kind !== 'roundabout' && rad > CFG.rMin + 2 && rad < CFG.rMax - 2 && i % 2 === 0) anchors.push({ x: p.x, z: p.z, tx: t.x, tz: t.z });
    }
  }

  const made = new Grid(3), streets = [];
  const clear = (x, z, nx, nz) => {
    const w = CFG.width * 0.5 + 0.35, tol = CFG.clearTol;
    return hm.h(x, z) < tol && hm.h(x + nx * w, z + nz * w) < tol && hm.h(x - nx * w, z - nz * w) < tol;
  };

  for (let a = 0; a < CFG.attempts && streets.length < CFG.maxStreets; a++) {
    const A = anchors[Math.floor(rnd() * anchors.length)];
    const side = rnd() < 0.5 ? 1 : -1, ang = (rnd() - 0.5) * 1.0; // perpendicular +/- ~30 degrees
    const bx = -A.tz * side, bz = A.tx * side;
    const dx = bx * Math.cos(ang) - bz * Math.sin(ang), dz = bx * Math.sin(ang) + bz * Math.cos(ang);
    const nx = -dz, nz = dx;
    const maxL = CFG.minLen + rnd() * (CFG.maxLen - CFG.minLen);
    let len = 0, end = 'limit', nearSince = -1, bad = false;
    for (let s = 1.4; s <= maxL; s += 0.7) {
      const x = A.x + dx * s, z = A.z + dz * s, rad = Math.hypot(x, z);
      if (rad > CFG.rMax || rad < CFG.rMin || !clear(x, z, nx, nz)) { len = s - 0.7; end = 'blocked'; break; }
      const de = existing.dist(x, z, 3);
      if (s > 3) {
        if (de < 1.1) { len = s; end = 'road'; break; }
        if (de < 2.7) { if (nearSince < 0) nearSince = s; else if (s - nearSince > 3.2) { bad = true; break; } } else nearSince = -1;
      }
      // never run alongside another new street
      let par = false; made.near(x, z, 1.7, (q) => { if (s > 2 && Math.abs(q.dx * dx + q.dz * dz) > 0.8) par = true; });
      if (par) { bad = true; break; }
      len = s;
    }
    if (bad || len < CFG.minLen) continue;
    if (end !== 'road' && !(end === 'blocked' && rnd() < CFG.deadEndChance) && end !== 'limit') continue; // blocked stubs only sometimes
    if (end === 'limit' && rnd() > CFG.deadEndChance) continue; // a free-standing end is a dead end: keep few
    const ex = A.x + dx * len, ez = A.z + dz * len;
    for (let s = 0; s <= len; s += 1.5) made.add(A.x + dx * s, A.z + dz * s, dx, dz);
    streets.push({ ax: A.x, az: A.z, bx: ex, bz: ez, dx, dz, len, end });
  }

  // ---- geometry: asphalt + two edge lines + dashed centre line, merged per kind, one draw call each
  const asphalt = [], lines = [], pads = [];
  const quad = (arr, x0, z0, x1, z1, w, y) => {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz) || 1, nx = (-dz / L) * w * 0.5, nz = (dx / L) * w * 0.5;
    arr.push(x0 + nx, y, z0 + nz, x0 - nx, y, z0 - nz, x1 + nx, y, z1 + nz, x1 - nx, y, z1 - nz);
  };
  const cols = { asphalt: [], line: [], lineCol: [] };
  streets.forEach((s, i) => {
    quad(asphalt, s.ax, s.az, s.bx, s.bz, CFG.width, 0.045);
    const nx = -s.dz, nz = s.dx, e = CFG.width * 0.5 - 0.06;
    const blue = i % 2 === 0;
    for (const sg of [-1, 1]) {
      quad(lines, s.ax + nx * e * sg, s.az + nz * e * sg, s.bx + nx * e * sg, s.bz + nz * e * sg, 0.15, 0.055);
      cols.lineCol.push(blue ? '#4f86ff' : '#a070ff');
    }
    for (let d = 1.2; d < s.len - 1.2; d += 1.6) { quad(lines, s.ax + s.dx * d, s.az + s.dz * d, s.ax + s.dx * (d + 0.7), s.az + s.dz * (d + 0.7), 0.12, 0.056); cols.lineCol.push('#e0a03a'); }
    if (s.end !== 'road') pads.push([s.bx, s.bz]); // turning pad on dead ends
  });
  const build = (verts, colorList, perQuad) => {
    const n = verts.length / 12, pos = new Float32Array(n * 4 * 3), col = new Float32Array(n * 4 * 3), idx = [];
    const c = new THREE.Color();
    for (let q = 0; q < n; q++) {
      pos.set(verts.slice(q * 12, q * 12 + 12), q * 12);
      c.set(colorList[perQuad ? q : 0]);
      for (let k = 0; k < 4; k++) col.set([c.r, c.g, c.b], q * 12 + k * 3);
      idx.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 2, q * 4 + 1, q * 4 + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx);
    return g;
  };
  const group = new THREE.Group(); group.name = 'extra-streets';
  const mat = (o) => new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...o });
  if (asphalt.length) {
    const m = new THREE.Mesh(build(asphalt, ['#0b1226'], false), mat({})); m.renderOrder = 1; group.add(m);
    const l = new THREE.Mesh(build(lines, cols.lineCol, true), mat({ toneMapped: false })); l.renderOrder = 2; group.add(l);
  }
  for (const [x, z] of pads) {
    const d = new THREE.Mesh(new THREE.CircleGeometry(1.15, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#0b1226', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    d.position.set(x, 0.046, z); d.renderOrder = 1; group.add(d);
  }
  group.frustumCulled = false;
  scene.add(group);
  const length = streets.reduce((a, s) => a + s.len, 0);
  return { streets, length, group, count: streets.length };
}
