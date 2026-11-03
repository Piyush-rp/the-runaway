// Outer ring, south half (r = 43, between ring1 and ring2): shield, search, storage, analytics, chart.
// Round 5 (11-01, camera 53.85 deg / 279.6 / fov 20): every roof outline is traced from ref/dashboard.png in
// screen pixels and unprojected to the roof height through the live camera (tools/_os_tr.sh), so roofs and
// badges land on the reference. Points are a screen-aligned "world offset" frame (dx = east / screen right,
// dz = south / screen down) from the slot centre, converted into the kit's building-local frame.
// Finish: pale white-lavender shells, thick white slab ledges and rim tubes, warm orange ribbon bands on
// every camera-facing slab edge, warm amber lobbies, light paved aprons with lamps, solid badges.
import * as THREE from 'three';
import {
  sectorOutline, sectorPoint, offsetOutline, polyOutline, mergedMesh, makeBlock, makeRoofCourt, makeSeams,
  makeRoofDetails, makeBaseGlow, makeBadge, makeLot, makeTrees, makePlanters, makeLamps, placeBuilding,
  extrudeOutline, ribbon, makeRng, makeNeonLine, MAT, D2R, BADGE_SIZE,
} from './kit.js';
import { RINGS, ROAD_WIDTH, SPOKES } from '../layout.js';

// ------------------------------------------------------------------------------------------
// materials
// ------------------------------------------------------------------------------------------
const _mats = new Map();
const mat = (key, make) => { if (!_mats.has(key)) _mats.set(key, make()); return _mats.get(key); };
const lam = (key, color, emissive) => mat(key, () => new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity: 1 }));
const M = {
  // pale white-lavender shell and near-white rim tubes / slab ledges (reference shells read #C8C4E6 .. #E8E6F6)
  get shell() { return lam('shell', '#C8C4E4', '#2E2C46'); },
  get rim() { return lam('rim', '#EEECFB', '#4A4870'); },
  // roof decks: slate blue-grey (reference decks #4E5C80 .. #6A789A)
  get deck() { return lam('deck', '#66749A', '#1A2240'); },
  get deckLav() { return lam('deckLav', '#8C88C2', '#222048'); },
  get deckPale() { return lam('deckPale', '#B8B6D8', '#2C2A48'); },
  get deckTeal() { return lam('deckTeal', '#2E5E6E', '#0E2630'); },
  court(color, k = 0.3) { return mat('court:' + color + k, () => new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(k), emissiveIntensity: 1 })); },
  get garden() { return lam('garden', '#2E6E30', '#0E2C12'); },
  get gardenDark() { return lam('gardenDark', '#21502A', '#0A1E10'); },
  get pave() { return lam('pave', '#7C7E9C', '#1E2036'); },
  get unit() { return lam('unit', '#C4C4DA', '#2E2E44'); },
  get mullion() { return lam('mullion', '#3A3E5C', '#0E1020'); },
  get column() { return lam('column', '#F4F4FF', '#8A8CB0'); },
  /** warm lit lobby interior (bright amber, not HDR white) */
  get amber() { return mat('amber', () => { const m = new THREE.MeshBasicMaterial({ color: '#FFB060', side: THREE.DoubleSide, toneMapped: false }); m.color.multiplyScalar(1.15); return m; }); },
  get amberSoft() { return mat('amberSoft', () => new THREE.MeshBasicMaterial({ color: '#E0954A', side: THREE.DoubleSide })); },
  get porthole() { return mat('porthole', () => { const m = new THREE.MeshBasicMaterial({ color: '#FFC27A', toneMapped: false }); m.color.multiplyScalar(1.3); return m; }); },
};
const SHELL = (roof = M.deck) => ({ facade: M.shell, trim: M.rim, roof });
const BG = { spread: 2.0, height: 1.4, intensity: 0.55 };
/** Futuristic light shell: thick proud slab ledges at every floor. */
const LIGHT = (mats = SHELL()) => ({ tone: 'light', effects: {}, ledge: 0.12, ledgeH: 0.16, materials: mats });
const ORANGE = '#FF8A2A';

// ------------------------------------------------------------------------------------------
// frame + outline helpers
// ------------------------------------------------------------------------------------------
/** Converter between the screen-aligned world offset frame and the slot's local frame. */
function frame(slot) {
  const th = (slot.deg - 90) * D2R, c = Math.cos(th), s = Math.sin(th);
  const a0 = slot.deg * D2R, px = Math.cos(a0) * slot.r, pz = -Math.sin(a0) * slot.r;
  // local -> world and back (placeBuilding: position on the slot, rotation.y = th); off = extra local shift
  const W = (x, z, off = [0, 0]) => { x += off[0]; z += off[1]; return [px + x * c + z * s, pz - x * s + z * c]; };
  const Wi = (wx, wz, off = [0, 0]) => { const dx = wx - px, dz = wz - pz; return [dx * c - dz * s - off[0], dx * s + dz * c - off[1]]; };
  const L = (a, b) => [a * c - b * s, a * s + b * c];
  const P = (a, b) => { const [x, z] = L(a, b); return { x, z }; };
  const S = (x, z) => [x * c + z * s, -x * s + z * c];   // local -> screen frame
  return { L, P, S, W, Wi, th };
}
/** Kit polyOutline from screen-frame points. */
function poly(F, pts, radii = 1) {
  const lp = pts.map(([a, b]) => F.L(a, b));
  let A = 0; for (let i = 0; i < lp.length; i++) { const p = lp[i], q = lp[(i + 1) % lp.length]; A += p[0] * q[1] - q[0] * p[1]; }
  const sgn = A > 0 ? 1 : -1;
  const tags = lp.map((p, i) => {
    const q = lp[(i + 1) % lp.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const nx = sgn * (q[1] - p[1]) / L, nz = -sgn * (q[0] - p[0]) / L;
    return nz > 0.6 ? 'front' : nz < -0.6 ? 'back' : nx > 0 ? 'right' : 'left';
  });
  return polyOutline(lp, radii, { tags, step: 0.25 });
}
/** Nearest road edge to world (x, z): [clearance, unit vector pointing away from the road]. */
function roadClear(x, z, home = null) {
  let best = [1e9, 0, 0];
  const rr = Math.hypot(x, z) || 1, ux = x / rr, uz = z / rr;
  for (const [R, w] of [[RINGS.ring1, ROAD_WIDTH.ring1], [RINGS.ring2, ROAD_WIDTH.ring2]]) {
    const sg = home ? (Math.hypot(home[0], home[1]) > R ? 1 : -1) : rr > R ? 1 : -1, d = sg * (rr - R) - w / 2;
    if (d < best[0]) best = [d, ux * sg, uz * sg];
  }
  for (const deg of SPOKES.outer) {
    const a = deg * D2R, dx = Math.cos(a), dz = -Math.sin(a), t = x * dx + z * dz;
    if (t < RINGS.ring1 - 2 || t > RINGS.ring2 + 2) continue;
    const cr = x * dz - z * dx, sg = home ? (home[0] * dz - home[1] * dx > 0 ? 1 : -1) : cr > 0 ? 1 : -1, d = sg * cr - ROAD_WIDTH.spoke / 2;
    if (d < best[0]) best = [d, dz * sg, -dx * sg];
  }
  return best;
}
/** Pulls every point of a local outline off the roads so it keeps `margin` clearance (lots, aprons). */
function offRoads(F, o, margin = 0.3, off = [0, 0]) {
  const dense = [];
  o.pts.forEach((p, i) => {
    const q = o.pts[(i + 1) % o.pts.length], n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.4));
    for (let k = 0; k < n; k++) dense.push([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n]);
  });
  const home = F.W(0, 0);
  const pts = dense.map(([x, z]) => {
    let [wx, wz] = F.W(x, z, off);
    for (let k = 0; k < 3; k++) { const [d, nx, nz] = roadClear(wx, wz, home); if (d >= margin) break; wx += nx * (margin - d); wz += nz * (margin - d); }
    return F.Wi(wx, wz, off);
  });
  return { pts, tags: pts.map(() => 'front') };
}
/** Smooth open curve through screen-frame points (Catmull-Rom), returned in local coords. */
function curve(F, pts, n = 28) {
  const v = new THREE.CatmullRomCurve3(pts.map(([a, b]) => { const [x, z] = F.L(a, b); return new THREE.Vector3(x, 0, z); }), false, 'centripetal');
  return v.getPoints(n).map((p) => [p.x, p.z]);
}
/** Convex hull of local points, as a rounded kit outline (building lots). */
function hullOutline(pointLists, pad = 2.4, radius = 2.4) {
  const P = pointLists.flat().map(([x, z]) => [x, z]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of [...P].reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const hull = [...lo.slice(0, -1), ...up.slice(0, -1)];
  const H = hull.filter((p, i) => { const q = hull[(i + 1) % hull.length]; return Math.hypot(q[0] - p[0], q[1] - p[1]) > 1.2; });
  return offsetOutline(polyOutline(H, radius), pad);
}
/**
 * Runs of an outline (offset by `off`) whose outward normal in the screen frame (sx = right, sz = down /
 * toward the camera) passes pick(sx, sz), and whose midpoint (screen frame a, b) passes where(a, b).
 */
function faceRuns(F, o, off, pick, where = null) {
  const pts = offsetOutline(o, off).pts, n = pts.length, runs = [];
  let A = 0; for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; A += p[0] * q[1] - q[0] * p[1]; }
  const sg = A > 0 ? 1 : -1;
  const ok = (i) => {
    const p = pts[i % n], q = pts[(i + 1) % n], L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const [sx, sz] = F.S(sg * (q[1] - p[1]) / L, -sg * (q[0] - p[0]) / L);
    if (!pick(sx, sz)) return false;
    if (!where) return true;
    const [a, b] = F.S((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
    return where(a, b);
  };
  let start = -1;
  for (let i = 0; i < n; i++) if (!ok(i)) { start = i; break; }
  if (start < 0) return [[...pts, pts[0]]];
  let run = [];
  const flush = () => { if (run.length > 1) runs.push(run); run = []; };
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    if (ok(i)) { if (!run.length) run.push(pts[i]); run.push(pts[(i + 1) % n]); } else flush();
  }
  flush();
  return runs;
}
/** Ribbons on local runs between y0 and y1, split in `floors` (gap = half the slab ledge). */
function runRibbons(runs, y0, y1, material, { floors = 1, gap = 0.05, uScale = 0.78 * 16 } = {}) {
  const h = (y1 - y0) / floors, geos = [];
  for (const r of runs) for (let f = 0; f < floors; f++) geos.push(ribbon(r, y0 + f * h + gap, y0 + (f + 1) * h - gap, { uScale, uOffset: f * 0.31 }));
  return merged(geos, material);
}
/** Warm orange ribbon bands at heights ys along the camera-facing runs of outline o. */
function bands(F, o, ys, pick, { off = 0.2, where = null, height = 0.16, glow = 0.4, k = 2.5, color = ORANGE, glowOpacity = 0.75 } = {}) {
  const g = new THREE.Group();
  for (const r of faceRuns(F, o, off, pick, where)) g.add(makeNeonLine(r, ys, { color, height, glow, intensity: k, glowOpacity }));
  return g;
}
/** Neon strip along an open local polyline. */
const strip = (line, y, { color = ORANGE, height = 0.16, glow = 0.4, k = 2.5, glowOpacity = 0.75 } = {}) =>
  makeNeonLine(line, [y], { color, height, glow, intensity: k, glowOpacity });
/** Closed neon outline (court edges). */
const neonLoop = (o, y, color, { k = 1.8, height = 0.06, glow = 0.3 } = {}) =>
  makeNeonLine([...o.pts, o.pts[0]], [y], { color, height, glow, intensity: k, glowOpacity: 0.45 });
/** Flat slab on the roof (garden, court). */
const slab = (o, y0, y1, material) => new THREE.Mesh(extrudeOutline(o, y0, y1, { bevel: Math.min(0.04, (y1 - y0) / 3) }), material);
/** Raised rounded rim tube along a closed outline or open local polylines. */
function tube(lines, y, { r = 0.17, material = M.rim } = {}) {
  const geos = [];
  for (const l of lines) {
    const c = new THREE.CatmullRomCurve3(l.map(([x, z]) => new THREE.Vector3(x, y + r, z)), false);
    geos.push(new THREE.TubeGeometry(c, Math.max(8, l.length * 2), r, 8, false));
  }
  return merged(geos, material);
}
const merged = (geos, m) => (geos.length ? mergedMesh(geos, m) : new THREE.Group());
const loop = (o) => [...o.pts, o.pts[0]];
/** Trees list from screen-frame points [dx, dz, scale]. */
const trees = (F, list, y) => list.map(([a, b, s]) => ({ ...F.P(a, b), s, y }));
/** Light rooftop units (AC boxes / skylights) at screen-frame points. */
const units = (F, list, y) => makeRoofDetails(list.map(([type, a, b, rot = 0, w, d]) => ({ type, ...F.P(a, b), rot: rot - F.th / D2R, w, d })), y);
/** Small warm windows / portholes on a wall along local points (pushed 0.05 out by the caller's offset). */
function windowsOn(line, y, { h = 0.34, w = 0.5, step = 1.2, material = M.porthole, round = false } = {}) {
  const geos = [];
  let acc = step * 0.5;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1], L = Math.hypot(bx - ax, bz - az);
    let d = acc;
    for (; d < L; d += step) {
      const t = d / L;
      const b = round ? new THREE.CylinderGeometry(w / 2, w / 2, 0.06, 12) : new THREE.BoxGeometry(w, h, 0.06);
      if (round) b.rotateX(Math.PI / 2);
      b.rotateY(-Math.atan2(bz - az, bx - ax));
      b.translate(ax + (bx - ax) * t, y, az + (bz - az) * t);
      geos.push(b.index ? b.toNonIndexed() : b);
    }
    acc = d - L;
  }
  return merged(geos, material);
}
/** Vertical fins along local runs, about every `step`. */
function finsOn(runs, y0, y1, { step = 0.8, w = 0.12, d = 0.22, material = M.rim } = {}) {
  const geos = [];
  for (const r of runs) {
    for (let i = 0; i < r.length - 1; i++) {
      const [ax, az] = r[i], [bx, bz] = r[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / step));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n, b = new THREE.BoxGeometry(w, y1 - y0, d);
        b.rotateY(-Math.atan2(bz - az, bx - ax)); b.translate(ax + (bx - ax) * t, (y0 + y1) / 2, az + (bz - az) * t);
        geos.push(b.toNonIndexed());
      }
    }
  }
  return merged(geos, material);
}
/** Lamps spaced along an outline (local). */
function lampsAlong(o, spacing = 3.0, inset = 0.5, keep = null) {
  const pts = offsetOutline(o, -inset).pts, out = [];
  let acc = spacing * 0.5;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    acc += Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (acc >= spacing) { acc = 0; if (!keep || keep(p[0], p[1])) out.push(p); }
  }
  return makeLamps(out);
}
/** Trees scattered along the inside of a lot edge, filtered by keep(screen a, screen b). */
function edgeTrees(F, o, { inset = 0.8, spacing = 2.2, seed = 1, keep = null } = {}) {
  const rng = makeRng(seed), pts = offsetOutline(o, -inset).pts, list = [];
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    acc += Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (acc < spacing * (0.7 + rng() * 0.6)) continue;
    acc = 0;
    const t = { x: p[0] + (rng() - 0.5) * 0.4, z: p[1] + (rng() - 0.5) * 0.4, s: 0.8 + rng() * 0.45 };
    const [a, b] = F.S(t.x, t.z);
    if (!keep || keep(a, b)) list.push(t);
  }
  return makeTrees(list, { seed: seed + 3 });
}
/**
 * Lot: lawn plate, a wide light paved apron hugging the building, lamps round the apron edge and lot,
 * and trees on the lot edge (keep(a, b) in the screen frame filters them).
 */
function apron(g, F, body, lot, { seed = 1, walk = 1.6, keepTree = null, lampStep = 2.6 } = {}) {
  lot = offRoads(F, lot, 0.25);
  const ap = offRoads(F, offsetOutline(body, walk), 0.55);
  g.add(makeLot(body, { lot, walk: 0 }));
  g.add(new THREE.Mesh(extrudeOutline(ap, 0.08, 0.095), M.pave));
  g.add(edgeTrees(F, lot, { seed, keep: keepTree }));
  g.add(lampsAlong(ap, lampStep, 0.25));
  g.add(lampsAlong(lot, 3.4, 0.6));
}
/** Solid badge at screen-frame offset (dx, dz), floating at absolute height Y (thin rim, no wide halo). */
function addBadge(g, F, slot, dx, dz, Y, roofY, phase = 0) {
  const p = F.P(dx, dz);
  const b = makeBadge(slot.icon, slot.color, { size: BADGE_SIZE, halo: 1.22, haloOpacity: 0.12, roofGlowY: roofY + 0.06 - Y, poolOpacity: 0.12, phase });
  b.position.set(p.x, Y, p.z);
  g.add(b);
}
/** Warm curtain glass: dark blue-black glass with warm lit rooms (separate albedo / emissive canvases). */
function glassMaterial(seed = 1, { warm = 0.5, tint = '#22305A', hot = 0.25 } = {}) {
  return mat('glass:' + seed + ':' + warm + tint + hot, () => {
    const W = 1024, H = 128, bays = 16, bw = W / bays, rng = makeRng(seed);
    const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
    const A = mk(), E = mk(), a = A.getContext('2d'), e = E.getContext('2d');
    const gr = a.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#121A30'); gr.addColorStop(0.55, tint); gr.addColorStop(1, '#2E3C62');
    a.fillStyle = gr; a.fillRect(0, 0, W, H);
    e.fillStyle = '#05070E'; e.fillRect(0, 0, W, H);
    for (let i = 0; i < bays; i++) {
      const x = i * bw;
      if (rng() < warm) {
        const k = 0.6 + rng() * 0.4, h = rng() < hot;
        const col = h ? `rgba(255,220,160,${k})` : `rgba(255,${150 + Math.floor(rng() * 50)},70,${k})`;
        const g2 = e.createLinearGradient(0, 10, 0, H - 10);
        g2.addColorStop(0, col); g2.addColorStop(1, 'rgba(255,140,60,0.25)');
        e.fillStyle = g2; e.fillRect(x + 4, 12, bw - 8, H - 24);
        a.fillStyle = 'rgba(150,100,50,0.7)'; a.fillRect(x + 4, 12, bw - 8, H - 24);
      }
      a.fillStyle = '#8A90B0'; a.fillRect(x, 0, 4, H);
    }
    const tex = (c) => { const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace; return t; };
    return new THREE.MeshLambertMaterial({ map: tex(A), emissive: '#FFFFFF', emissiveMap: tex(E), emissiveIntensity: 1.3, side: THREE.DoubleSide });
  });
}
/** Smooth curved atrium glass: deep blue glass, soft vertical reflections and warm interior lights, no grid. */
function curtainMaterial(seed = 1) {
  return mat('curtain:' + seed, () => {
    const W = 1024, H = 256, rng = makeRng(seed);
    const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
    const A = mk(), E = mk(), a = A.getContext('2d'), e = E.getContext('2d');
    const gr = a.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#0C1634'); gr.addColorStop(0.5, '#1C3878'); gr.addColorStop(1, '#101C40');
    a.fillStyle = gr; a.fillRect(0, 0, W, H);
    for (let i = 0; i < 14; i++) { a.fillStyle = `rgba(150,185,255,${0.05 + rng() * 0.07})`; a.fillRect(rng() * W, 0, 20 + rng() * 70, H); }
    const ge = e.createLinearGradient(0, 0, 0, H);
    ge.addColorStop(0, '#08102A'); ge.addColorStop(0.5, '#122452'); ge.addColorStop(1, '#0A142E');
    e.fillStyle = ge; e.fillRect(0, 0, W, H);
    for (const v of [0.22, 0.47, 0.72, 0.94]) {
      const y = v * H;
      for (let i = 0; i < 5; i++) {
        const x = rng() * W, w = 30 + rng() * 80, rg = e.createRadialGradient(x, y - 12, 2, x, y - 12, w * 0.6);
        rg.addColorStop(0, 'rgba(255,200,130,0.5)'); rg.addColorStop(1, 'rgba(255,170,90,0)');
        e.fillStyle = rg; e.fillRect(x - w, y - 44, w * 2, 48);
      }
    }
    const tex = (c) => { const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace; return t; };
    return new THREE.MeshLambertMaterial({ map: tex(A), emissive: '#FFFFFF', emissiveMap: tex(E), emissiveIntensity: 0.95, side: THREE.DoubleSide });
  });
}
/** Standard futuristic floor stack on camera-facing runs: glass ribbons between ledges, orange band per slab. */
function floorStack(F, body, { y0 = 0, lobbyH, floorH, floors, pick, where = null, seed = 1, warm = 0.5, tint, k = 2.4, bandH = 0.15, glass = true } = {}) {
  const g = new THREE.Group();
  if (glass) g.add(runRibbons(faceRuns(F, body, 0.03, pick, where), y0 + lobbyH, y0 + lobbyH + floors * floorH, glassMaterial(seed, { warm, tint }), { floors, gap: 0.09 }));
  const ys = Array.from({ length: floors }, (_, f) => y0 + lobbyH + f * floorH);
  g.add(bands(F, body, ys, pick, { where, off: 0.2, height: bandH, k }));
  return g;
}

// ------------------------------------------------------------------------------------------
// SHIELD (deg -18): rounded trapezoid / crescent: wide top wing, right arm down to a rounded nose, the top-left
// corner cut on a long diagonal. Thick white rim tube round the whole roof; inside, a deep violet court
// (badge), a planted lobe down the right arm behind an inner rim tube and a small dark tree pocket at the top.
// Front: pale lobby block on the left, a tall curved glass front with warm floors and a hot orange band under
// the roof slab sweeping to the nose, portholes round the nose.
// ------------------------------------------------------------------------------------------
function buildShield(ctx, slot) {
  const F = frame(slot), g = new THREE.Group();
  const LOB = 1.3, FH = 1.1, NF = 4;
  const ROOF = { thick: 0.46, overhang: 0.42, parapetH: 0.4, parapetW: 0.62 };
  const rimO = poly(F, [[-5.2, -9.0], [1.5, -9.2], [2.6, -8.3], [2.5, -4.7], [2.3, 0.3], [2.2, 4.1], [1.7, 5.5], [0.8, 5.8], [-0.5, 4.5],
    [-2.5, 2.8], [-4.9, 1.9], [-9.0, 2.4], [-9.3, 1.8], [-8.8, -2.8], [-7.6, -6.1]],
  [1.2, 1.0, 1.0, 1.5, 1.5, 1.2, 0.8, 0.8, 1.2, 1.4, 1.0, 0.4, 0.4, 1.5, 1.6]);
  const body = offsetOutline(rimO, -ROOF.overhang);
  const A = makeBlock(body, { ...LIGHT(SHELL(M.deckLav)), floors: NF, floorH: FH, lobbyH: LOB, lobbyInset: 0.25, seed: 31,
    windows: { style: null }, lobby: { style: 'lobby', sides: 'all' }, roof: ROOF });
  g.add(A.group);
  const top = A.top, yR = top + ROOF.parapetH;
  // tall curved glass front (right of the lobby block) with warm floors, an orange band at every slab
  const front = (sx, sz) => sz > 0.25;
  g.add(floorStack(F, body, { lobbyH: LOB, floorH: FH, floors: NF, pick: front, where: (a) => a > -4.7 && a < 0.7, seed: 33, warm: 0.7 }));
  // lobby block: pale wall with a warm lobby strip and two rows of small warm windows; orange slab lines
  const blockFront = faceRuns(F, body, 0.05, front, (a) => a <= -4.7);
  for (const r of blockFront) {
    g.add(windowsOn(r, LOB + FH * 1.5, { w: 0.55, h: 0.3, step: 1.1 }));
    g.add(windowsOn(r, LOB + FH * 2.5, { w: 0.55, h: 0.3, step: 1.1, material: M.amberSoft }));
  }
  g.add(bands(F, body, [LOB], front, { where: (a) => a <= -4.7, height: 0.12, k: 2.0 }));
  // hot band under the roof slab: front sweep and round the nose
  g.add(bands(F, rimO, [top - ROOF.thick - 0.1], (sx, sz) => sz > 0.1 || sx > 0.6, { off: 0.04, height: 0.46, glow: 0.95, k: 3.3, glowOpacity: 0.95 }));
  // right arm facade: slim warm slots and portholes round the nose
  for (const r of faceRuns(F, body, 0.05, (sx, sz) => sx > 0.55 && sz > -0.6)) {
    g.add(windowsOn(r, LOB + FH * 0.55, { w: 0.34, step: 1.1, round: true }));
    g.add(windowsOn(r, LOB + FH * 2.5, { w: 0.34, step: 1.3, round: true }));
    g.add(windowsOn(r, LOB + FH * 1.5, { w: 0.7, h: 0.22, step: 1.6, material: M.mullion }));
  }
  // west face: pale wall with dark window slits
  for (const r of faceRuns(F, body, 0.05, (sx) => sx < -0.6)) {
    for (let f = 1; f < NF; f++) g.add(windowsOn(r, LOB + FH * (f + 0.5), { w: 0.6, h: 0.26, step: 1.0, material: f === 1 ? M.amberSoft : M.mullion }));
  }
  // roof: thick rim tube on the parapet, deep violet court, planted lobe behind an inner rim tube, tree pocket
  g.add(tube([loop(offsetOutline(rimO, -ROOF.parapetW / 2))], yR - 0.12, { r: 0.2 }));
  const court = poly(F, [[-6.8, -4.0], [-1.2, -5.1], [-0.9, -2.8], [-0.3, 2.4], [-3.3, 1.3], [-5.8, 0.8], [-7.7, 1.1], [-7.6, -1.2]], [1.0, 0.8, 1.0, 0.6, 1.2, 1.0, 0.6, 1.2]);
  g.add(makeRoofCourt(court, top, { material: M.court('#2E2486', 0.26), rim: 0.16, rimH: 0.12 }));
  g.add(tube([loop(court)], top, { r: 0.18 }));
  const lobe = poly(F, [[-0.75, -5.2], [0.8, -5.8], [1.7, -4.9], [1.75, -0.8], [1.45, 2.5], [0.4, 2.85], [-0.15, 2.2], [-0.5, -0.1]], [0.5, 0.6, 0.8, 1.0, 0.6, 0.5, 0.5, 1.0]);
  g.add(slab(lobe, top, top + 0.14, M.garden));
  g.add(tube([loop(lobe)], top, { r: 0.15 }));
  g.add(makeTrees(trees(F, [[0.5, -4.6, 0.62], [1.1, -3.3, 0.55], [0.3, -2.4, 0.6], [1.1, -1.5, 0.55], [0.4, -0.6, 0.6], [1.1, 0.4, 0.55], [0.4, 0.9, 0.5], [0.9, 1.8, 0.5], [0.45, 2.3, 0.4], [-0.1, -3.9, 0.42], [0.0, 0.2, 0.42]], top + 0.12), { seed: 41 }));
  const pocket = poly(F, [[-2.4, -7.6], [-0.9, -8.4], [0.7, -8.2], [0.8, -6.3], [-1.2, -5.7], [-2.2, -6.0]], 0.5);
  g.add(slab(pocket, top, top + 0.12, M.gardenDark));
  g.add(tube([loop(pocket)], top, { r: 0.14 }));
  g.add(makeTrees(trees(F, [[-0.4, -7.4, 0.62], [0.3, -6.8, 0.5], [-1.3, -6.6, 0.42]], top + 0.1), { seed: 47, colors: ['#1F5A2A', '#24683A', '#2A7038'] }));
  // diagonal inner rim tube along the cut corner, a few light rooftop units / skylights on the lavender deck
  g.add(tube([curve(F, [[-7.6, -2.8], [-6.6, -5.4], [-4.8, -7.6], [-3.0, -8.0]], 16)], top, { r: 0.13 }));
  g.add(units(F, [['ac', -4.2, -6.6, 0], ['skylight', -6.6, -3.3, 60], ['ac', -8.3, 1.6, 0, 0.6, 0.45], ['skylight', 1.9, 3.6, 90, 0.7, 0.45]], top));
  addBadge(g, F, slot, -3.7, -0.8, 7.8, top, 0.7);
  // lot: light apron and forecourt, lamps, trees on the far edges only
  const lot = hullOutline([rimO.pts], 1.9, 2.6);
  apron(g, F, body, lot, { seed: 201, walk: 1.5, keepTree: (a, b) => b < 3.0 || a > 3.0 });
  g.add(makeBaseGlow(body, BG));
  placeBuilding(ctx, slot, g);
}

// ------------------------------------------------------------------------------------------
// SEARCH (deg -54): smooth rounded podium (three warm-banded glass floors wrapping the front curve) carrying a
// tall pale teardrop upper tier that points to the lower left. Tier deck: dark teal with a cyan-edged court
// (badge) and a garden pocket top right; slate podium deck round the left and top with light units.
// ------------------------------------------------------------------------------------------
function buildSearch(ctx, slot) {
  const F = frame(slot), g = new THREE.Group();
  const LOB = 1.3, FH = 1.0, NF = 3;
  const PR = { thick: 0.32, overhang: 0.36, parapetH: 0.34, parapetW: 0.5 };
  const podRim = poly(F, [[1.9, -11.3], [7.4, -9.2], [8.0, -6.6], [7.3, -3.0], [5.7, 0.2], [2.9, 2.3], [-0.7, 3.1], [-4.0, 2.4], [-6.0, 0.5], [-6.7, -2.0], [-6.3, -3.8], [-2.5, -8.1]],
    [1.6, 1.6, 2.0, 2.4, 2.4, 2.4, 2.4, 2.4, 2.0, 1.6, 1.6, 2.0]);
  const pod = offsetOutline(podRim, -PR.overhang);
  const A = makeBlock(pod, { ...LIGHT(SHELL(M.deck)), floors: NF, floorH: FH, lobbyH: LOB, lobbyInset: 0.3, seed: 51,
    windows: { style: null }, lobby: { style: 'lobby', sides: 'all' }, roof: PR });
  g.add(A.group);
  const yb = A.top;
  const front = (sx, sz) => sz > 0.05 || sx < -0.55;
  g.add(floorStack(F, pod, { lobbyH: LOB, floorH: FH, floors: NF, pick: front, seed: 51, warm: 0.65, k: 2.6, bandH: 0.17 }));
  // the strong band under the podium slab (where the pale tier wall rises)
  g.add(bands(F, podRim, [yb - PR.thick - 0.08], front, { off: 0.04, height: 0.4, glow: 0.65, k: 3.0 }));
  g.add(tube([loop(offsetOutline(podRim, -PR.parapetW / 2))], yb + PR.parapetH - 0.12, { r: 0.17 }));
  // pale teardrop tier
  const tierRim = poly(F, [[0.3, -9.0], [6.3, -8.3], [7.5, -6.5], [7.0, -3.0], [5.5, 0.0], [2.8, 2.0], [-0.6, 2.8], [-2.3, 2.0], [-3.3, -0.9], [-3.6, -3.4], [-2.6, -6.6]],
    [1.6, 1.4, 1.8, 2.4, 2.4, 2.4, 1.6, 1.4, 2.0, 1.8, 2.0]);
  const TR = { thick: 0.42, overhang: 0.3, parapetH: 0.42, parapetW: 0.6 };
  const tier = offsetOutline(tierRim, -TR.overhang);
  const TH = 7.3 - TR.thick - yb;
  const T = makeBlock(tier, { ...LIGHT(SHELL(M.deckTeal)), y0: yb, floors: 1, floorH: TH - 0.15, lobbyH: 0.15, lobbyInset: 0, seed: 52,
    windows: { style: null }, lobby: { style: null }, roof: TR });
  g.add(T.group);
  const top = T.top;
  g.add(tube([loop(offsetOutline(tierRim, -TR.parapetW / 2))], top + TR.parapetH - 0.12, { r: 0.19 }));
  // tier wall: a row of small dark windows and a soft warm line under its slab on the front
  for (const r of faceRuns(F, tier, 0.05, front)) g.add(windowsOn(r, yb + TH * 0.55, { w: 0.42, h: 0.22, step: 1.5, material: M.mullion }));
  g.add(bands(F, tierRim, [top - TR.thick - 0.06], front, { off: 0.04, height: 0.1, glow: 0.3, k: 1.8, glowOpacity: 0.5 }));
  // tier deck: cyan-edged court under the badge, garden pocket top right
  const court = poly(F, [[-0.9, -2.7], [4.2, -2.7], [4.2, -1.1], [-0.2, 0.8], [-0.9, 0.1]], [0.6, 0.8, 0.8, 0.6, 0.5]);
  g.add(makeRoofCourt(court, top, { material: M.court('#0C4656', 0.34), rim: 0.14, rimH: 0.12 }));
  g.add(neonLoop(offsetOutline(court, -0.2), top + 0.05, '#2FE6D8', { k: 1.8, height: 0.07, glow: 0.26 }));
  g.add(makeNeonLine(curve(F, [[1.4, -2.6], [0.8, -4.6], [0.4, -6.6]], 10), [top + 0.05], { color: '#2FE6D8', height: 0.06, glow: 0.2, intensity: 1.5, glowOpacity: 0.4 }));
  const garden = poly(F, [[2.8, -6.5], [5.6, -6.1], [5.7, -4.1], [4.5, -3.1], [2.7, -3.4], [2.4, -4.8]], 0.7);
  g.add(slab(garden, top, top + 0.14, M.garden));
  g.add(tube([loop(garden)], top, { r: 0.13 }));
  g.add(makeTrees(trees(F, [[3.6, -5.4, 0.85], [4.8, -4.6, 0.6], [3.3, -4.1, 0.5], [4.9, -5.7, 0.45]], top + 0.12), { seed: 53 }));
  g.add(units(F, [['ac', -2.0, -3.8, 0], ['skylight', 5.6, -1.6, 30, 0.7, 0.45]], top));
  // podium deck round the left and top
  g.add(units(F, [['ac', -5.0, -2.6, 0], ['skylight', -4.6, 0.6, 50], ['ac', 3.4, -9.4, 0], ['skylight', 6.2, -8.0, 20, 0.7, 0.45], ['ac', -0.5, -8.0, 0, 0.6, 0.45]], yb));
  addBadge(g, F, slot, 0.1, -3.1, 8.7, top, 1.9);
  const lot = hullOutline([podRim.pts], 1.9, 3.0);
  apron(g, F, pod, lot, { seed: 202, walk: 1.5, keepTree: (a, b) => b < 1.0 || a > 6.5 || a < -6.5 });
  g.add(makeBaseGlow(pod, BG));
  placeBuilding(ctx, slot, g);
}

// ------------------------------------------------------------------------------------------
// STORAGE (deg -90): long arc slab following the ring. Roof: thick white rim, two white ribs dividing the deck
// into three long curved slate troughs, pale end pavilions with light units. Front: a deep slab overhang
// over a dark glass strip with warm rooms, then a full-width bright amber colonnade lobby with a mezzanine,
// warm glass end pavilions, a lit paved forecourt with lamp rows.
// ------------------------------------------------------------------------------------------
function buildStorage(ctx, slot) {
  const R = slot.r, F = frame(slot);
  const P = (rho, a) => sectorPoint(R, rho, a), XZ = (rho, a) => { const p = P(rho, a); return [p.x, p.z]; };
  const arc = (rho, a0, a1, n = 40) => Array.from({ length: n + 1 }, (_, i) => XZ(rho, a0 + ((a1 - a0) * i) / n));
  const g = new THREE.Group();
  const RI = 36.4, RO = 43.0, AA = 14.0, AE = 10.7, OV = 0.3;   // roof radii / half angle / pavilion edge / front overhang
  const LOBBY = 3.4, FH = 1.6;
  // the body is its own sector (an inward offset of a rounded sector folds its corners and breaks the parapet
  // hole); the slab overhangs it by 0.3 all round and a thick white canopy lip carries it out to RO at the front
  const SR = { thick: 0.46, overhang: 0.3, parapetH: 0.4, parapetW: 0.6 };
  const main = sectorOutline({ r: R, rIn: RI + 0.3, rOut: RO - OV, a0: -AA + 0.3, a1: AA - 0.3, corners: [1.3, 0.6, 0.6, 1.3] });
  const roofO = offsetOutline(main, SR.overhang);
  const A = makeBlock(main, { ...LIGHT(SHELL(M.deckPale)), floors: 1, floorH: FH, lobbyH: LOBBY, lobbyInset: 0.5, seed: 71,
    windows: { style: null }, lobby: { style: null }, roof: SR });
  g.add(A.group);
  const top = A.top;
  const fr = RO - OV;   // facade radius at the front
  g.add(new THREE.Mesh(extrudeOutline(sectorOutline({ r: R, rIn: fr, rOut: RO, a0: -AA + 0.6, a1: AA - 0.6, corners: [0.6, 0.6, 0.05, 0.05] }), top - SR.thick, top + 0.02, { bevel: 0.04 }), M.rim));
  // upper floor: dark glass strip with warm rooms across the front, orange line under the slab
  g.add(new THREE.Mesh(ribbon(arc(fr + 0.03, AA - 1.0, -AA + 1.0), LOBBY + 0.1, LOBBY + FH - 0.08, { uScale: 0.78 * 16 * 2.2 }), glassMaterial(75, { warm: 0.45 })));
  g.add(strip(arc(RO + 0.04, AA - 0.9, -AA + 0.9), top - SR.thick - 0.08, { height: 0.32, glow: 0.55, k: 2.6 }));
  g.add(strip(arc(fr + 0.18, AA - 1.0, -AA + 1.0), LOBBY, { height: 0.14, glow: 0.4, k: 2.3 }));
  // deep colonnade lobby: bright amber interior on two levels split by a pale mezzanine, white columns
  const li = fr - 0.5 + 0.04, MZ = LOBBY * 0.48;
  g.add(new THREE.Mesh(ribbon(arc(li, AE, -AE), 0.1, MZ - 0.06, { uScale: 0.78 * 16 * 1.6 }), glassMaterial(76, { warm: 0.92, tint: '#3A2C24', hot: 0.5 })));
  g.add(new THREE.Mesh(ribbon(arc(li, AE, -AE), MZ + 0.16, LOBBY - 0.08, { uScale: 0.78 * 16 * 1.6, uOffset: 0.37 }), glassMaterial(77, { warm: 0.8, tint: '#33283A' })));
  g.add(new THREE.Mesh(extrudeOutline(sectorOutline({ r: R, rIn: li - 0.04, rOut: li + 0.14, a0: -AE, a1: AE, corners: 0.05 }), MZ - 0.06, MZ + 0.16), M.rim));
  g.add(strip(arc(li + 0.16, AE, -AE), MZ + 0.05, { height: 0.08, glow: 0.3, k: 2.0, color: '#FFC27A' }));
  const cols = [];
  for (let a = -AE + 0.6; a <= AE - 0.59; a += 1.5) { const p = P(fr - 0.12, a), c = new THREE.CylinderGeometry(0.09, 0.09, LOBBY, 8); c.translate(p.x, LOBBY / 2, p.z); cols.push(c.toNonIndexed()); }
  g.add(mergedMesh(cols, M.column));
  // warm soffit glow under the overhang
    // end pavilions: warm glass full height on the front and outer faces
  for (const s of [-1, 1]) {
    const a0 = s * AE, a1 = s * (AA - 0.9);
    g.add(new THREE.Mesh(ribbon(arc(fr + 0.04, Math.max(a0, a1), Math.min(a0, a1), 10), 0.1, LOBBY - 0.06, { uScale: 4 }), glassMaterial(78 + s, { warm: 0.85, tint: '#3A2A22', hot: 0.4 })));
    const fins = [];
    for (let k = 0; k <= 3; k++) { const p = P(fr + 0.1, a0 + (a1 - a0) * (k / 3)), b = new THREE.BoxGeometry(0.12, LOBBY, 0.2); b.rotateY(-(a0 + (a1 - a0) * (k / 3)) * D2R); b.translate(p.x, LOBBY / 2, p.z); fins.push(b.toNonIndexed()); }
    g.add(mergedMesh(fins, M.rim));
  }
  // roof: white ribs, three curved slate troughs, pale end caps with light units
  const ribR = [38.55, 41.25];
  const troughs = [[RI + 0.55, ribR[0] - 0.12], [ribR[0] + 0.12, ribR[1] - 0.12], [ribR[1] + 0.12, RO - 0.62]];
  for (const [r0, r1] of troughs) g.add(makeRoofCourt(sectorOutline({ r: R, rIn: r0, rOut: r1, a0: -AE + 0.2, a1: AE - 0.2, corners: 0.3 }), top, { material: M.court('#3E5478', 0.26), rimH: 0.08, rim: 0.06 }));
  g.add(tube([...ribR.map((r) => arc(r, -AA + 0.6, AA - 0.6)), arc(RI + 0.3, -AE, AE), [XZ(RI + 0.5, -AE), XZ(RO - 0.6, -AE)], [XZ(RI + 0.5, AE), XZ(RO - 0.6, AE)]], top, { r: 0.14 }));
  g.add(tube([loop(offsetOutline(roofO, -SR.parapetW / 2))], top + SR.parapetH - 0.12, { r: 0.2 }));
  g.add(makeSeams([-5.4, 0.0, 5.4].map((a) => [XZ(RI + 0.7, a), XZ(RO - 0.8, a)]), top + 0.03, 0.05, MAT.seamLight));
  for (const s of [-1, 1]) {
    const m = s * (AE + AA) / 2;
    const cap = sectorOutline({ r: R, rIn: RI + 0.75, rOut: RO - 0.75, a0: s > 0 ? AE + 0.25 : -AA + 1.0, a1: s > 0 ? AA - 1.0 : -AE - 0.25, corners: [0.7, 0.5, 0.5, 0.7] });
    g.add(slab(cap, top, top + 0.3, M.deckPale));
    g.add(tube([loop(cap)], top + 0.18, { r: 0.1 }));
    g.add(makeRoofDetails([{ type: 'ac', ...P(38.4, m), rot: m }, { type: 'skylight', ...P(40.6, m), rot: m }, { type: 'ac', ...P(42.0, m - s * 0.7), rot: m, w: 0.5, d: 0.4 }], top + 0.3));
  }
  addBadge(g, F, slot, -0.35, -2.0, 7.3, top, 2.6);
  // lot: light forecourt with lamp rows, trees on the back and sides
  const SH = F.L(0.75, 0), clamp = (o, m = 0.3) => offRoads(F, o, m, SH);
  const lot = clamp(sectorOutline({ r: R, rIn: 34.0, rOut: 50.6, a0: -17.6, a1: 17.6, corners: 1.8 }), 0.25);
  g.add(makeLot(main, { lot, walk: 0 }));
  g.add(new THREE.Mesh(extrudeOutline(clamp(offsetOutline(main, 1.4), 0.55), 0.08, 0.095), M.pave));
  g.add(new THREE.Mesh(extrudeOutline(clamp(sectorOutline({ r: R, rIn: 46.4, rOut: 48.6, a0: -AA - 2.6, a1: AA + 2.6, corners: 0.8 }), 0.55), 0.08, 0.1), M.pave));
  for (const s of [-1, 1]) g.add(new THREE.Mesh(extrudeOutline(clamp(sectorOutline({ r: R, rIn: RI - 1.0, rOut: 48.6, a0: s > 0 ? AA + 0.6 : -AA - 2.6, a1: s > 0 ? AA + 2.6 : -AA - 0.6, corners: 0.6 }), 0.55), 0.08, 0.1), M.pave));
  g.add(makeTrees([-12.5, -9.6, -6.4, -2.2, 2.2, 6.4, 9.6, 12.5].map((a, i) => ({ ...P(45.0, a), s: 0.36 + (i % 3) * 0.06 })), { seed: 209 }));
  g.add(makeTrees([
    ...Array.from({ length: 15 }, (_, i) => ({ ...P(35.0, -16.4 + i * 2.35), s: 0.75 + (i % 3) * 0.12 })),
    ...[37.0, 39.6, 42.2, 44.8, 47.4].flatMap((r, i) => [{ ...P(r, -16.6), s: 0.8 + (i % 2) * 0.15 }, { ...P(r, 16.6), s: 0.8 + (i % 2) * 0.15 }]),
    ...[-15.0, -10.5, 10.5, 15.0].map((a) => ({ ...P(49.6, a), s: 0.9 })),
  ], { seed: 203 }));
  g.add(makeLamps([
    ...Array.from({ length: 15 }, (_, i) => XZ(46.3, -15.4 + i * 2.2)),
    ...Array.from({ length: 15 }, (_, i) => XZ(48.7, -15.4 + i * 2.2)),
    ...Array.from({ length: 11 }, (_, i) => XZ(43.9, -12.5 + i * 2.5)),
    ...[-12, -6, 6, 12].map((a) => XZ(35.6, a)),
  ]));
  g.add(makeBaseGlow(main, BG));
  // the reference hall is centred 0.75 east of the slot
  const h = new THREE.Group();
  while (g.children.length) h.add(g.children[0]);
  const [sx, sz] = F.L(0.75, 0);
  h.position.set(sx, 0, sz);
  g.add(h);
  placeBuilding(ctx, slot, g);
}

// ------------------------------------------------------------------------------------------
// ANALYTICS (deg -126): one continuous S / P mass: a long pale left wing (open C round a dark slot court, a drum
// skylight at the top) flowing into a big rounded front volume. Front volume: planted roof (badge) and a navy
// court, a large curved dark-glass atrium on the lower right wrapped by stacked orange ribbon bands.
// ------------------------------------------------------------------------------------------
function buildAnalytics(ctx, slot) {
  const F = frame(slot), g = new THREE.Group();
  const LOB = 1.4, FH = 1.1, NF = 7;
  const MR = { thick: 0.46, overhang: 0.42, parapetH: 0.42, parapetW: 0.62 };
  const mainRim = poly(F, [[-2.9, -5.1], [-1.0, -5.7], [2.9, -4.6], [6.2, -3.0], [8.4, -1.3], [9.0, 0.5], [8.8, 2.5], [7.7, 3.6], [5.3, 3.2], [2.7, 2.2], [0.9, 1.5], [-1.0, -0.2], [-2.3, -2.3]],
    [1.2, 1.4, 1.6, 1.8, 1.6, 1.6, 1.4, 1.2, 1.6, 1.6, 1.4, 1.4, 1.4]);
  const main = offsetOutline(mainRim, -MR.overhang);
  const A = makeBlock(main, { ...LIGHT(SHELL(M.deck)), ledge: -0.25, ledgeH: 0.08, floors: NF, floorH: FH, lobbyH: LOB, lobbyInset: 0.3, seed: 91,
    windows: { style: null }, lobby: { style: 'lobby', sides: 'all' }, roof: MR });
  g.add(A.group);
  const top = A.top;
  // curved dark-glass atrium on the lower right, stacked orange ribbons at every slab, hot band under the roof
  const atrium = (sx, sz) => sz > 0.2 || (sx > 0.5 && sz > -0.45);
  g.add(runRibbons(faceRuns(F, main, 0.04, atrium, (a) => a > 0.2), LOB + 0.04, LOB + NF * FH - 0.04, curtainMaterial(94), { floors: 1, gap: 0, uScale: 2.5 }));
  g.add(floorStack(F, main, { lobbyH: LOB, floorH: FH, floors: NF, pick: atrium, where: (a) => a <= 0.2, seed: 96, warm: 0.6 }));
  g.add(bands(F, main, Array.from({ length: NF - 1 }, (_, f) => LOB + (f + 1) * FH), atrium, { where: (a) => a > 0.2, off: 0.08, height: 0.07, k: 1.7, glow: 0.18, glowOpacity: 0.5 }));
  g.add(bands(F, main, [LOB], atrium, { off: 0.1, height: 0.3, k: 3.0, glow: 0.7, glowOpacity: 0.9 }));
  g.add(bands(F, mainRim, [top - MR.thick - 0.1], atrium, { off: 0.04, height: 0.46, glow: 0.95, k: 3.3, glowOpacity: 0.95 }));
  g.add(tube([loop(offsetOutline(mainRim, -MR.parapetW / 2))], top + MR.parapetH - 0.12, { r: 0.2 }));
  // left wing: long pale shell, an open C round a dark slot court; flows under the front volume
  const WR = { thick: 0.42, overhang: 0.38, parapetH: 0.4, parapetW: 0.6 };
  const wingRim = poly(F, [[-2.9, -11.6], [-0.6, -11.2], [1.2, -9.5], [2.2, -7.2], [-1.4, -6.4], [-2.4, -4.6], [-2.0, -1.4], [-1.4, 0.3], [-3.0, 1.2], [-4.5, 0.3], [-6.4, -1.8], [-7.6, -4.3], [-7.8, -6.8], [-6.6, -8.8], [-4.6, -10.6]],
    [1.0, 1.2, 1.2, 0.8, 1.0, 1.2, 1.2, 0.6, 1.0, 1.4, 2.0, 2.0, 1.8, 1.6, 1.4]);
  const wing = offsetOutline(wingRim, -WR.overhang);
  const WLOB = 1.3, WFH = 1.08, WNF = 4;
  const W = makeBlock(wing, { ...LIGHT(SHELL(M.deckLav)), floors: WNF, floorH: WFH, lobbyH: WLOB, lobbyInset: 0.3, seed: 92,
    windows: { style: null }, lobby: { style: 'lobby', sides: 'all' }, roof: WR });
  g.add(W.group);
  const wTop = W.top;
  const wFront = (sx, sz) => sx < -0.45 || sz > 0.35;
  g.add(floorStack(F, wing, { lobbyH: WLOB, floorH: WFH, floors: WNF, pick: wFront, seed: 92, warm: 0.5 }));
  g.add(bands(F, wingRim, [wTop - WR.thick - 0.08], wFront, { off: 0.04, height: 0.32, glow: 0.6, k: 2.8 }));
  g.add(tube([loop(offsetOutline(wingRim, -WR.parapetW / 2))], wTop + WR.parapetH - 0.12, { r: 0.18 }));
  const slotC = poly(F, [[-6.0, -6.4], [-4.4, -6.8], [-3.3, -4.6], [-2.8, -0.6], [-3.5, -0.3], [-5.2, -3.5]], [0.6, 0.6, 0.6, 0.4, 0.4, 0.8]);
  g.add(makeRoofCourt(slotC, wTop, { material: M.court('#16264A', 0.3), rim: 0.14, rimH: 0.12 }));
  g.add(slab(offsetOutline(slotC, -0.45), wTop, wTop + 0.1, M.gardenDark));
  g.add(tube([loop(slotC)], wTop, { r: 0.15 }));
  g.add(makeTrees(trees(F, [[-4.7, -5.4, 0.45], [-4.0, -3.4, 0.4], [-3.5, -1.6, 0.36]], wTop + 0.08), { seed: 98 }));
  const dp = F.P(-2.7, -9.7);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.2, 0.7, 40), M.rim);
  drum.position.set(dp.x, wTop + 0.35, dp.z); g.add(drum);
  const drumTop = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 0.06, 40), M.court('#2A4C8A', 0.4));
  drumTop.position.set(dp.x, wTop + 0.71, dp.z); g.add(drumTop);
  g.add(makeTrees(trees(F, [[-1.6, -9.0, 0.5]], wTop + 0.05), { seed: 97 }));
  g.add(units(F, [['ac', -6.6, -8.2, 0], ['skylight', -5.6, -9.7, 40], ['ac', -6.8, -2.6, 0, 0.6, 0.45]], wTop));
  // main roof: planted lawn with trees round the badge, navy court with rib lines toward the nose
  const lawn = poly(F, [[-2.4, -4.6], [-0.7, -5.3], [2.3, -4.5], [4.5, -2.7], [4.8, -1.3], [3.2, 0.5], [0.5, 0.5], [-1.3, -0.9], [-2.3, -2.7]], [0.8, 1.0, 1.2, 1.0, 0.8, 1.0, 1.0, 1.0, 0.8]);
  g.add(slab(lawn, top, top + 0.14, M.garden));
  g.add(tube([loop(lawn)], top, { r: 0.12 }));
  g.add(makeTrees(trees(F, [[-1.3, -4.0, 0.75], [-0.1, -4.7, 0.6], [-1.6, -2.4, 0.55], [3.2, -3.3, 0.45]], top + 0.12), { seed: 93 }));
  const court = poly(F, [[4.8, -2.3], [7.5, -1.3], [8.3, 0.5], [7.9, 2.5], [5.9, 2.9], [3.2, 1.5], [4.0, -0.2]], [0.8, 1.0, 0.8, 0.8, 1.0, 0.8, 0.8]);
  g.add(makeRoofCourt(court, top, { material: M.court('#1C3C6A', 0.32), rim: 0.16, rimH: 0.12 }));
  g.add(tube([curve(F, [[4.4, 2.3], [5.6, 0.6], [6.3, -1.6]], 10), curve(F, [[5.6, 0.6], [8.0, 1.2]], 6)], top, { r: 0.07 }));
  g.add(units(F, [['ac', 7.4, 2.4, 0], ['skylight', 1.6, 0.9, 30, 0.7, 0.45], ['ac', -1.8, -1.2, 0, 0.6, 0.45]], top));
  addBadge(g, F, slot, 2.2, -1.7, 10.9, top, 3.3);
  const lot = hullOutline([mainRim.pts, wingRim.pts], 1.7, 2.6);
  apron(g, F, main, lot, { seed: 204, walk: 1.5, keepTree: (a, b) => b < -2 || a < -6.5 });
  g.add(new THREE.Mesh(extrudeOutline(offRoads(F, offsetOutline(wing, 1.3), 0.55), 0.08, 0.095), M.pave));
  g.add(makeBaseGlow(main, BG), makeBaseGlow(wing, BG));
  placeBuilding(ctx, slot, g);
}

// ------------------------------------------------------------------------------------------
// CHART (deg -162): lens / teardrop leaning to the lower right with a squared front. Long west facade: white
// fins over dark glass with a curved orange band. Roof: thick glowing rim, planted garden on the left
// round a raised drum skylight, teal court on the right (badge). Front: a tall warm glass lobby block.
// ------------------------------------------------------------------------------------------
function buildChart(ctx, slot) {
  const F = frame(slot), g = new THREE.Group();
  const LOB = 1.3, FH = 1.18, NF = 4;
  const CR = { thick: 0.46, overhang: 0.45, parapetH: 0.42, parapetW: 0.62 };
  const rimO = poly(F, [[-2.9, -9.0], [-0.8, -9.7], [5.0, -9.4], [7.0, -8.1], [8.7, -5.7], [10.4, -1.8], [11.2, 0.9], [11.1, 2.3], [10.4, 3.0], [4.0, 2.6], [1.8, 1.9], [-1.0, -0.8], [-2.8, -3.7], [-3.3, -6.7]],
    [1.6, 1.4, 1.6, 1.8, 2.0, 1.6, 1.0, 0.6, 0.5, 1.0, 1.8, 2.0, 1.8, 1.6]);
  const main = offsetOutline(rimO, -CR.overhang);
  const A = makeBlock(main, { ...LIGHT(SHELL(M.deckTeal)), floors: NF, floorH: FH, lobbyH: LOB, lobbyInset: 0.3, seed: 111,
    windows: { style: null }, lobby: { style: 'lobby', sides: 'all' }, roof: CR });
  g.add(A.group);
  const top = A.top;
  // west facade: fins over dark glass, orange band per slab, hot band under the roof
  const west = (sx, sz) => sx < -0.3 && sz > -0.8;
  g.add(floorStack(F, main, { lobbyH: LOB, floorH: FH, floors: NF, pick: west, where: (a) => a < 3.4, seed: 112, warm: 0.45, k: 3.1, bandH: 0.22 }));
  g.add(finsOn(faceRuns(F, main, 0.17, west, (a) => a < 3.4), LOB + 0.1, LOB + NF * FH, { step: 0.75 }));
  g.add(bands(F, rimO, [top - CR.thick - 0.1], (sx, sz) => sx < -0.3 || sz > 0.3, { off: 0.04, height: 0.46, glow: 0.95, k: 3.3, glowOpacity: 0.95 }));
  // front: tall warm glass lobby block (two storeys, recessed), warm windows to its right, orange slab lines
  const fwd = (sx, sz) => sz > 0.45;
  const lobbyRuns = faceRuns(F, main, 0.04, fwd, (a) => a > 3.6 && a < 7.2);
  g.add(runRibbons(lobbyRuns, 0.1, LOB + 2 * FH - 0.06, glassMaterial(118, { warm: 0.95, tint: '#3A3024', hot: 0.5 }), { floors: 3, gap: 0.05, uScale: 6 }));
  g.add(finsOn(faceRuns(F, main, 0.16, fwd, (a) => a > 3.6 && a < 7.2), 0.1, LOB + 2 * FH, { step: 1.0, w: 0.14, d: 0.24 }));
  g.add(floorStack(F, main, { lobbyH: LOB, floorH: FH, floors: NF, pick: fwd, where: (a) => a >= 7.2, seed: 119, warm: 0.7 }));
  g.add(bands(F, main, [LOB + 2 * FH, LOB + 3 * FH], fwd, { where: (a) => a > 3.6 && a < 7.2, height: 0.16, k: 2.5 }));
  for (const r of faceRuns(F, main, 0.05, fwd, (a) => a > 3.6 && a < 7.2)) g.add(windowsOn(r, LOB + FH * 2.5, { w: 0.6, h: 0.3, step: 0.9, material: M.amberSoft }));
  // east face: pale wall with a few warm slits
  for (const r of faceRuns(F, main, 0.05, (sx, sz) => sx > 0.4 && sz > -0.2)) g.add(windowsOn(r, LOB + FH * 1.5, { w: 0.5, h: 0.28, step: 1.3 }));
  g.add(tube([loop(offsetOutline(rimO, -CR.parapetW / 2))], top + CR.parapetH - 0.12, { r: 0.2 }));
  // a soft warm glow line on the parapet top along the west edge (the reference's glowing rim)
  g.add(bands(F, rimO, [top + CR.parapetH + 0.04], (sx) => sx < -0.4, { off: -0.12, height: 0.08, glow: 0.3, k: 2.2, glowOpacity: 0.6 }));
  // roof: garden of trees on the left round the drum, teal court on the right
  const garden = poly(F, [[-2.3, -8.3], [0.9, -8.5], [4.2, -6.9], [1.9, -4.5], [3.7, -1.8], [3.9, 1.3], [2.3, 0.9], [0.2, -1.8], [-1.6, -4.5]], [0.8, 1.0, 0.6, 0.8, 0.8, 0.5, 0.8, 1.0, 1.0]);
  g.add(slab(garden, top, top + 0.15, M.garden));
  g.add(tube([loop(garden)], top, { r: 0.12 }));
  g.add(makeTrees(trees(F, [[-1.4, -7.6, 0.8], [0.0, -7.9, 0.7], [-0.9, -6.2, 0.62], [-0.2, -4.6, 0.6], [0.6, -3.2, 0.55], [1.6, -2.4, 0.62], [2.6, -1.6, 0.55],
    [2.9, -0.2, 0.5], [3.3, 0.8, 0.42], [-1.6, -5.0, 0.45], [1.4, -7.4, 0.5]], top + 0.12), { seed: 113 }));
  const court = poly(F, [[4.4, -6.7], [7.0, -6.9], [8.8, -4.5], [10.3, -0.6], [10.5, 1.5], [4.3, 1.4], [4.0, -1.8], [4.7, -4.1]], [0.6, 1.0, 1.2, 1.0, 0.5, 0.5, 0.8, 0.8]);
  g.add(makeRoofCourt(court, top, { material: M.court('#0E4E4A', 0.3), rim: 0.16, rimH: 0.12 }));
  g.add(tube([loop(court)], top, { r: 0.12 }));
  g.add(neonLoop(offsetOutline(court, -0.25), top + 0.05, '#2FE6A8', { k: 1.0, height: 0.05, glow: 0.16 }));
  // raised ringed drum skylight
  const dp = F.P(2.8, -5.9), DH = 1.0;
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.38, DH, 40), M.rim);
  drum.position.set(dp.x, top + DH / 2, dp.z); g.add(drum);
  const rings = [0.32, 0.64].map((y) => { const c = new THREE.CylinderGeometry(1.37, 1.37, 0.08, 40, 1, true); c.translate(dp.x, top + y, dp.z); return c.toNonIndexed(); });
  g.add(mergedMesh(rings, M.mullion));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.06, 1.06, 0.08, 40), M.court('#2C4E80', 0.38));
  cap.position.set(dp.x, top + DH + 0.02, dp.z); g.add(cap);
  const ring = Array.from({ length: 49 }, (_, i) => [dp.x + Math.cos((i / 48) * Math.PI * 2) * 1.14, dp.z + Math.sin((i / 48) * Math.PI * 2) * 1.14]);
  g.add(makeNeonLine(ring, [top + DH + 0.06], { color: '#9FD0FF', height: 0.04, glow: 0.12, intensity: 1.2, glowOpacity: 0.35 }));
  g.add(units(F, [['ac', 9.6, 1.9, 0], ['skylight', 6.6, -7.4, 20, 0.7, 0.45], ['ac', -2.4, -2.6, 0, 0.6, 0.45]], top));
  addBadge(g, F, slot, 6.2, -1.1, 7.9, top, 4.1);
  const lot = hullOutline([rimO.pts], 1.9, 2.6);
  apron(g, F, main, lot, { seed: 205, walk: 1.5, keepTree: (a, b) => b < -3 || a < -4.5 });
  g.add(makeBaseGlow(main, BG));
  placeBuilding(ctx, slot, g);
}

export default function build(ctx) {
  const B = Object.fromEntries(ctx.layout.BUILDINGS.map((b) => [b.id, b]));
  const jobs = { shield: buildShield, search: buildSearch, storage: buildStorage, analytics: buildAnalytics, chart: buildChart };
  for (const [id, fn] of Object.entries(jobs)) {
    if (!B[id]) continue;
    try { fn(ctx, B[id]); } catch (err) { console.error(`[outerSouth] ${id} failed`, err); }
  }
}
