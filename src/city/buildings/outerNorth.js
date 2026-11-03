// Outer ring, north half (r = 43, between ring1 and ring2): models-box (purple cube), cloud (orange),
// gear (orange), database (blue) and models (magenta flower). Larger, varied complexes built from kit.js:
// rounded multi-wing blocks, stadium/drum roof tiers, green roof terraces, lit facades and badges.
// Every building is designed in the kit's local frame (x = clockwise tangent, +z = toward the core).
import * as THREE from 'three';
import {
  MAT, makeBlock, makeRoofCourt, makeSeams, makeRoofDetails, makeBaseGlow, makeBadge, makeLot, makeLamps,
  makeTrees, makePlanters, makeNeonLine, mergedMesh, placeBuilding, roundedRectOutline, sectorOutline, polyOutline,
  sectorPoint, offsetOutline, extrudeOutline, ribbon, bandMaterial, curveOutline, BADGE_SIZE, D2R,
} from './kit.js';

// ------------------------------------------------------------------------------------------
// Local helpers
// ------------------------------------------------------------------------------------------
/** Tag for an outline segment from its outward normal (kit convention: back = -z, front = +z). */
function tagFor(nx, nz) {
  if (nz < -0.7) return 'back';
  if (nz > 0.7) return 'front';
  if (nx > 0.7) return 'right';
  if (nx < -0.7) return 'left';
  return (nz < 0 ? 'back-' : 'front-') + (nx > 0 ? 'right' : 'left');
}

/**
 * Kit polyOutline from vertices [[x, z, radius?], ...] listed clockwise on screen (back edge left -> right,
 * then down the right side ...), with each edge tagged back/right/front/left from its outward normal.
 */
function roundedPoly(verts) {
  const pts = verts.map((v) => [v[0], v[1]]), n = pts.length;
  const tags = pts.map((p, i) => {
    const q = pts[(i + 1) % n], L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    return tagFor((q[1] - p[1]) / L, -(q[0] - p[0]) / L);
  });
  return polyOutline(pts, verts.map((v) => v[2] || 0), { tags });
}

/** Tags every point by the outward normal of the segment that starts there. */
function withTags(pts) {
  const n = pts.length;
  const tags = pts.map((p, i) => {
    const q = pts[(i + 1) % n];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    return tagFor((q[1] - p[1]) / L, -(q[0] - p[0]) / L);
  });
  return { pts, tags };
}



const loop = (o) => [...o.pts, o.pts[0]];

/**
 * Roof tier / drum: a facade-clad volume from y0 to y0 + h with an optional window band, a trim rim and a deck.
 * deck: material for the top (defaults to the roof deck). Returns { group, top }.
 */
function makeTier(o, y0, h, { band = 'warm', seed = 5, bandFrom = 0.18, bandTo = 0.8, rim = 0.22, rimH = 0.28, deck = null, bayU = 8 } = {}) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(extrudeOutline(o, y0, y0 + h), shellMats().wall));
  if (band) g.add(new THREE.Mesh(ribbon(loop(offsetOutline(o, 0.02)), y0 + h * bandFrom, y0 + h * bandTo, { uScale: bayU }), glassMat(band, seed)));
  const top = y0 + h;
  const inner = offsetOutline(o, -rim);
  g.add(new THREE.Mesh(extrudeOutline(inner, top - 0.02, top + 0.02), deck || MAT.roof));
  g.add(new THREE.Mesh(extrudeOutline(offsetOutline(o, 0.06), top - 0.06, top + rimH, { holes: [inner], bevel: 0.04 }), shellMats().slab));
  return { group: g, top: top + 0.02 };
}

/** Green roof terrace: lawn pad inside a low trim rim, with small shrubs. */
function makeGreenRoof(o, y, shrubs = []) {
  const g = new THREE.Group();
  const inner = offsetOutline(o, -0.16);
  g.add(new THREE.Mesh(extrudeOutline(inner, y - 0.01, y + 0.07), MAT.lawn));
  g.add(new THREE.Mesh(extrudeOutline(o, y - 0.01, y + 0.2, { holes: [inner] }), MAT.trim));
  if (shrubs.length) g.add(makeTrees(shrubs.map((s) => ({ ...s, y: y + 0.05, s: s.s ?? 0.45 })), { seed: 13 }));
  return g;
}

/** Simple local lot: lawn plot around the building plus paved plaza ring. */
let _lotLawn, _walkMat;
function lotFor(main, lot, walk = 0.9) {
  _walkMat ||= new THREE.MeshLambertMaterial({ color: '#555872', emissive: '#0E0F1C', emissiveIntensity: 1 });
  const g = makeLot(main, { lot, walk, walkMaterial: _walkMat });
  // darker, less saturated lawn than the kit default (reference: dark grounds, green comes from trees)
  _lotLawn ||= new THREE.MeshLambertMaterial({ color: '#1F3A26', emissive: '#0A1A0E', emissiveIntensity: 1 });
  g.children[0].material = _lotLawn;
  // soft planted border instead of a hard lawn edge: a hedge of small shrubs just inside the lot outline
  const edge = offsetOutline(lot || offsetOutline(main, 1.6), -0.45), P = edge.pts, shrubs = [];
  let run = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (run <= L) {
      const t = run / L, k = shrubs.length, j = (((k * 53) % 11) / 11 - 0.5) * 0.5, nx = (b[1] - a[1]) / L, nz = -(b[0] - a[0]) / L;
      shrubs.push({ x: a[0] + (b[0] - a[0]) * t + nx * j, z: a[1] + (b[1] - a[1]) * t + nz * j, s: 0.42 + ((k * 37) % 10) / 40 });
      run += 1.1 + ((k * 29) % 7) / 10;
    }
    run -= L;
  }
  if (shrubs.length) g.add(makeTrees(shrubs, { seed: 17, colors: ['#2F6A2C', '#3A7A32', '#285E28'] }));
  return g;
}

let _deckMats;
function deckMats() {
  if (_deckMats) return _deckMats;
  _deckMats = {
    magenta: new THREE.MeshLambertMaterial({ color: '#B468F2', emissive: '#7E2CE0', emissiveIntensity: 1.25 }),
    greyCourt: new THREE.MeshLambertMaterial({ color: '#7A8292', map: MAT.roof.map, emissive: '#2C3242', emissiveIntensity: 1 }),
    darkCourt: new THREE.MeshLambertMaterial({ color: '#8286B4', emissive: '#2E3360', emissiveIntensity: 1 }),
    blueCourt: new THREE.MeshLambertMaterial({ color: '#33407A', emissive: '#18245C', emissiveIntensity: 1 }),
    pool: new THREE.MeshBasicMaterial({ color: '#2FB8E8', toneMapped: false }),
  };
  return _deckMats;
}

function addBadge(g, slot, x, z, roofY, BY, size, phase = 0, extra = {}) {
  const b = makeBadge(slot.icon, slot.color, { size: BADGE_SIZE, roofGlowY: roofY === null ? null : roofY + 0.06 - BY, phase, ...extra });
  b.position.set(x, BY, z);
  g.add(b);
}


// ------------------------------------------------------------------------------------------
// Sculpted futuristic shell (reference + sheet sec 5 tiles): white rounded corner piers, thick white
// slab ledges proud of the facade, deep recessed ribbon glazing with white fins between them, a tall
// recessed glass lobby on slender columns, a thick rounded roof lip with a glowing edge.
// ------------------------------------------------------------------------------------------
const lambertD = (o) => new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, ...o });
let _shell;
function shellMats() {
  if (_shell) return _shell;
  _shell = {
    wall: lambertD({ color: '#A6A4C8', emissive: '#121124', emissiveIntensity: 1 }),
    deck: new THREE.MeshLambertMaterial({ color: '#8E8AB8', map: MAT.roof.map, emissive: '#1E1C34', emissiveIntensity: 1 }),
    deckDark: new THREE.MeshLambertMaterial({ color: '#40446A', map: MAT.roof.map, emissive: '#101228', emissiveIntensity: 1 }),
    channel: new THREE.MeshLambertMaterial({ color: '#2C3050', emissive: '#0E1024', emissiveIntensity: 1 }),
    slab: lambertD({ color: '#BAB7D8', emissive: '#1E1C34', emissiveIntensity: 1 }),
    col: new THREE.MeshLambertMaterial({ color: '#C8C6E0', emissive: '#262440', emissiveIntensity: 1 }),
    porthole: new THREE.MeshBasicMaterial({ color: '#1A1D33' }),
  };
  return _shell;
}

/** Index-preserving outline offset (kit offsetOutline without the dedupe), so walls/glass/jambs line up. */
function offPts(pts, d) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n], c = pts[i], q = pts[(i + 1) % n];
    let n1x = c[1] - p[1], n1z = -(c[0] - p[0]); const l1 = Math.hypot(n1x, n1z) || 1; n1x /= l1; n1z /= l1;
    let n2x = q[1] - c[1], n2z = -(q[0] - c[0]); const l2 = Math.hypot(n2x, n2z) || 1; n2x /= l2; n2z /= l2;
    let mx = n1x + n2x, mz = n1z + n2z; const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const k = Math.min(2, 1 / Math.max(0.5, mx * n1x + mz * n1z));
    out.push([c[0] + mx * d * k, c[1] + mz * d * k]);
  }
  return out;
}

/** Glazing textures drawn here (one floor tall, 8 bays of 1 world unit): warm | dim | cyan | lobby. */
const _glz = new Map();
function glazingMaterial(style, seed = 1) {
  const key = style + ':' + seed;
  if (_glz.has(key)) return _glz.get(key);
  const bays = 8, bw = 64, W = bays * bw, H = 64;
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const alb = mk(), emi = mk(), a = alb.getContext('2d'), e = emi.getContext('2d');
  let r = seed * 9301 + 49297; const rng = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const mix = (c, k) => '#' + new THREE.Color('#000000').lerp(new THREE.Color(c), Math.max(0, Math.min(1, k))).getHexString();
  const base = { warm: '#2A1C14', dim: '#131A2E', cyan: '#0C2A46', lobby: '#4A3C28' }[style] || '#131A2E';
  a.fillStyle = base; a.fillRect(0, 0, W, H);
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  const warmHues = ['#FFB45A', '#FFC676', '#FFA347', '#FFD99A', '#FFBD66', '#FF9F45'];
  if (style === 'streak') {
    // deep recessed storey: dark glass with continuous, irregular warm interior light (no discrete cells)
    a.fillStyle = '#1A120C'; a.fillRect(0, 0, W, H);
    const ph = [rng() * 6, rng() * 6, rng() * 6];
    for (let x = 0; x < W; x += 2) {
      const u = x / W * Math.PI * 2;
      const k = Math.max(0.1, 0.5 + 0.26 * Math.sin(u * 3 + ph[0]) + 0.16 * Math.sin(u * 7 + ph[1]) + 0.1 * Math.sin(u * 13 + ph[2]));
      const hue = k > 0.75 ? '#FFB45A' : '#FF9636';
      const gr = e.createLinearGradient(0, 4, 0, H - 2);
      gr.addColorStop(0, mix('#FFC676', k)); gr.addColorStop(0.18, mix(hue, k * 0.95)); gr.addColorStop(0.7, mix(hue, k * 0.55)); gr.addColorStop(1, mix('#FF8A30', k * 0.75));
      e.fillStyle = gr; e.fillRect(x, 4, 2, H - 6);
    }
    e.fillStyle = 'rgba(0,0,0,0.75)';
    for (let x = 0; x < W; x += 64) e.fillRect(x + 30, 4, 3, H - 6);           // sparse slim mullions
    for (let i = 0; i < 7; i++) { e.fillStyle = 'rgba(0,0,0,0.5)'; e.fillRect(rng() * W, H * (0.45 + rng() * 0.15), 6 + rng() * 10, H * 0.5); } // furniture/people silhouettes
    a.fillStyle = '#3A2414'; a.fillRect(0, 4, W, H - 6);
  }
  for (let i = 0; i < (style === 'streak' ? 0 : bays); i++) {
    const x0 = i * bw;
    if (style === 'cyan' || style === 'violet' || style === 'blue') {
      const bl = style === 'blue', cy = style === 'cyan' || bl, k = cy ? 0.8 + rng() * 0.2 : 0.55 + rng() * 0.45;
      const g = e.createLinearGradient(0, 4, 0, H - 4);
      if (bl) { g.addColorStop(0, mix('#8FC4FF', k * 0.8)); g.addColorStop(0.5, mix('#3A7CF0', k * 0.7)); g.addColorStop(1, mix('#1E4CC0', k * 0.65)); }
      else if (cy) { g.addColorStop(0, mix('#9FF0FF', k)); g.addColorStop(0.5, mix('#2FD8FF', k)); g.addColorStop(1, mix('#1F9BFF', k * 0.9)); }
      else { g.addColorStop(0, mix('#D9B8FF', k)); g.addColorStop(0.55, mix('#A070F0', k * 0.8)); g.addColorStop(1, mix('#5A3AC0', k * 0.7)); }
      e.fillStyle = g; e.fillRect(x0 + 2, 4, bw - 4, H - 8);
      a.fillStyle = bl ? '#1A3A80' : cy ? '#1E7C9C' : '#3A2A6C'; a.fillRect(x0 + 2, 4, bw - 4, H - 8);
      e.fillStyle = 'rgba(225,248,255,0.85)';
      for (let l = 0; l < 3; l++) if (rng() < 0.7) e.fillRect(x0 + 8, 14 + l * 13, (bw - 16) * (0.4 + rng() * 0.6), 3);
      continue;
    }
    if (style === 'night') {
      // dark-tinted glazing: deep navy panes with only a few small warm lit rooms
      const g = e.createLinearGradient(0, 3, 0, H - 3);
      g.addColorStop(0, mix('#3A5AB0', 0.2)); g.addColorStop(1, mix('#0A1430', 0.3));
      e.fillStyle = g; e.fillRect(x0 + 2, 3, bw - 4, H - 6);
      a.fillStyle = '#0E1226'; a.fillRect(x0 + 2, 3, bw - 4, H - 6);
      if (rng() < 0.45) { e.fillStyle = mix(warmHues[Math.floor(rng() * 6)], 0.65 + rng() * 0.3); e.fillRect(x0 + 6 + rng() * 30, 14 + rng() * 14, 10 + rng() * 16, 16 + rng() * 10); }
      e.fillStyle = '#000'; e.fillRect(x0 + bw / 2 - 1, 3, 2, H - 6);
      continue;
    }
    if (style === 'lobby') {
      for (const [px, pw] of [[x0 + 2, bw / 2 - 4], [x0 + bw / 2 + 2, bw / 2 - 4]]) {
        const hue = ['#FFC070', '#FFB35C', '#FFD08A', '#FFA850'][Math.floor(rng() * 4)], k = 0.7 + rng() * 0.3;
        const g = e.createLinearGradient(0, 2, 0, H);
        g.addColorStop(0, mix(hue, k * 0.85)); g.addColorStop(1, mix(hue, k));
        e.fillStyle = g; e.fillRect(px, 2, pw, H - 2);
        a.fillStyle = '#5A4028'; a.fillRect(px, 2, pw, H - 2);
        if (rng() < 0.35) { e.fillStyle = 'rgba(0,0,0,0.55)'; e.fillRect(px + pw * (0.2 + rng() * 0.5), H * 0.45, 4, H * 0.55); }
      }
      e.fillStyle = 'rgba(0,0,0,0.6)'; e.fillRect(x0, 15, bw, 2);
      continue;
    }
    // warm / dim office ribbon glazing: panes between thin mullions, lit from inside
    const lit = style === 'warm' ? rng() > 0.1 : rng() < 0.42;
    const hue = warmHues[Math.floor(rng() * warmHues.length)];
    const k = lit ? (style === 'warm' ? 0.72 + rng() * 0.28 : 0.55 + rng() * 0.4) : 0.1 + rng() * 0.08;
    const g = e.createLinearGradient(0, 3, 0, H - 3);
    if (lit) { g.addColorStop(0, mix(hue, k)); g.addColorStop(0.6, mix(hue, k * 0.92)); g.addColorStop(1, mix(hue, k * 0.7)); }
    else { g.addColorStop(0, mix('#3A6AD0', 0.28)); g.addColorStop(1, mix('#0A1430', 0.4)); }
    e.fillStyle = g; e.fillRect(x0 + 2, 3, bw - 4, H - 6);
    a.fillStyle = lit ? mix(hue, 0.3) : '#1A2240'; a.fillRect(x0 + 2, 3, bw - 4, H - 6);
    if (lit && rng() < 0.45) { e.fillStyle = 'rgba(0,0,0,0.35)'; e.fillRect(x0 + 2, 3, bw - 4, (H - 6) * (0.15 + rng() * 0.25)); }
    if (lit && rng() < 0.3) { e.fillStyle = 'rgba(0,0,0,0.45)'; e.fillRect(x0 + 10 + rng() * 40, H * 0.5, 5, H * 0.45); }
    e.fillStyle = '#000'; e.fillRect(x0 + bw / 2 - 1, 3, 2, H - 6); // centre mullion
  }
  const tex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; };
  const m = new THREE.MeshLambertMaterial({
    map: tex(alb), emissiveMap: tex(emi), emissive: '#FFFFFF',
    emissiveIntensity: { blue: 2.2, night: 1.7, warm: 2.3, dim: 1.8, cyan: 3.0, violet: 1.9, lobby: 1.75, streak: 1.6 }[style] ?? 1.5,
  });
  _glz.set(key, m);
  return m;
}
const glassMat = (style, seed) => (style === 'screen' ? bandMaterial('screen', seed) : glazingMaterial(style, seed));

/** Geometry accumulator for vertical quads (non-indexed, position/normal/uv). */
function quadSink() {
  const pos = [], nor = [], uv = [];
  return {
    quad(a, b, y0, y1, u0, u1) {
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      if (L < 1e-5 || y1 - y0 < 1e-4) return;
      const nx = dz / L, nz = -dx / L;
      const A = [a[0], y0, a[1], u0, 0], B = [b[0], y0, b[1], u1, 0], C = [b[0], y1, b[1], u1, 1], D = [a[0], y1, a[1], u0, 1];
      for (const V of [A, C, B, A, D, C]) { pos.push(V[0], V[1], V[2]); nor.push(nx, 0, nz); uv.push(V[3], V[4]); }
    },
    geo() {
      if (!pos.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      return g;
    },
  };
}

/**
 * Sculpted block. o = kit outline. opts:
 *  floors, floorH (slab-to-slab), lobbyH, lobbyInset, slabT, slabOut, glassIn, roofT, parapetH, parapetW,
 *  windows ('warm'|'dim'|'cyan'|'lobby'|'screen' default glazing), lobby {style, sides} (glass on those sides, 'dim' elsewhere),
 *  bands [{sides, style ('wall' = solid shell), floors:[1..]}] overrides, piers (true: tight rounded corners are solid
 *  white shell), pierR (max corner radius treated as a pier), fins (spacing, 0 = none), portholes
 *  ({ every, r, color, floors, sides }) on solid wall runs, seed, roofEdge (neon colour or false).
 */
function block(o, opts = {}) {
  const {
    y0 = 0, floors = 2, floorH = 1.4, lobbyH = 1.75, lobbyInset = 0.9, slabT = 0.36, slabOut = 0.22, glassIn = 0.28,
    roofT = 0.45, parapetH = 0.3, parapetW = 0.42, windows = 'dim', lobby = { style: 'lobby', sides: ['front'] }, bands = [],
    piers = true, pierR = 4.6, fins = 2.2, finW = 0.13, portholes = null, seed = 11, roofEdge = '#E8ECFF', roof = {}, floorLines = '#FFD49A',
    columns = true, lipOut = null, finSides = null,
  } = opts;
  const M = shellMats();
  const pts = o.pts, n = pts.length, tags = o.tags;
  const O0 = pts, Og = offPts(pts, -glassIn), Ol = offPts(pts, -lobbyInset);
  const group = new THREE.Group();
  // per-segment curvature radius (pier detection): turn between neighbouring segments
  const dir = pts.map((p, i) => { const q = pts[(i + 1) % n]; return Math.atan2(q[1] - p[1], q[0] - p[0]); });
  const segL = pts.map((p, i) => { const q = pts[(i + 1) % n]; return Math.hypot(q[0] - p[0], q[1] - p[1]); });
  const wrap = (a) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
  const isPier = pts.map((_, i) => {
    if (!piers) return false;
    const t = Math.max(wrap(dir[i] - dir[(i + n - 1) % n]), wrap(dir[(i + 1) % n] - dir[i]));
    return t > 0.02 && segL[i] / t < pierR && segL[i] < 1.2;
  });
  const styleAt = (f, i) => {
    for (const b of bands) if ((!b.floors || b.floors.includes(f)) && (b.sides === 'all' || b.sides.includes(tags[i]))) return b.style;
    return isPier[i] ? 'wall' : windows;
  };
  const top0 = y0 + lobbyH, glassTop = top0 + floors * floorH, top = glassTop + roofT;

  // lobby: deep recessed glass on slender white columns
  const lob = new Map();
  const lobStyle = (i) => (lobby && lobby.map && lobby.map[tags[i]]) || (lobby && (lobby.sides === 'all' || lobby.sides.includes(tags[i])) ? lobby.style : 'dim');
  let acc = 0;
  const lobWall = quadSink(), solid = (i) => !!(lobby && lobby.wall && lobby.wall.includes(tags[i]));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (solid(i)) { // solid shell down to the ground on these sides (no lobby recess)
      lobWall.quad(O0[i], O0[j], y0, top0, 0, 0);
      if (!solid((i + n - 1) % n)) lobWall.quad(Ol[i], O0[i], y0, top0, 0, 0);
      if (!solid(j)) lobWall.quad(O0[j], Ol[j], y0, top0, 0, 0);
      continue;
    }
    const a = Ol[i], b = Ol[j], L = Math.hypot(b[0] - a[0], b[1] - a[1]), st = lobStyle(i);
    if (!lob.has(st)) lob.set(st, quadSink());
    lob.get(st).quad(a, b, y0 + 0.02, top0, acc / 8, (acc + L) / 8); acc += L;
  }
  lob.forEach((sink, st) => { const gg = sink.geo(); if (gg) group.add(new THREE.Mesh(gg, glassMat(st, seed + 3))); });
  { const lw = lobWall.geo(); if (lw) group.add(new THREE.Mesh(lw, M.wall)); }
  const cols = [], Oc = offPts(pts, -lobbyInset * 0.42);
  let run = 0.9;
  for (let i = 0; columns && i < n; i++) {
    const a = Oc[i], b = Oc[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (run <= L) {
      const t = run / L, c = new THREE.CylinderGeometry(0.11, 0.11, lobbyH, 8);
      c.translate(a[0] + (b[0] - a[0]) * t, y0 + lobbyH / 2, a[1] + (b[1] - a[1]) * t); cols.push(c); run += 2.4;
    }
    run -= L;
  }
  if (cols.length && columns) group.add(mergedMesh(cols, M.col));

  // floors: recessed glass / white shell walls, jambs, fins
  const glassSinks = new Map(), wall = quadSink(), finGeos = [];
  for (let f = 1; f <= floors; f++) {
    const ya = top0 + (f - 1) * floorH + slabT, yb = top0 + f * floorH;
    let u = 0, finRun = fins * 0.5;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, st = styleAt(f, i), isWall = st === 'wall';
      const prevWall = styleAt(f, (i + n - 1) % n) === 'wall';
      if (isWall !== prevWall) wall.quad(isWall ? Og[i] : O0[i], isWall ? O0[i] : Og[i], ya, yb, 0, 0); // jamb
      if (isWall) { wall.quad(O0[i], O0[j], ya, yb, 0, 0); finRun = fins * 0.5; continue; }
      const a = Og[i], b = Og[j], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const key = st + ':' + (f % 2);
      if (!glassSinks.has(key)) glassSinks.set(key, { st, alt: f % 2, sink: quadSink() });
      glassSinks.get(key).sink.quad(a, b, ya, yb, u / 8, (u + L) / 8); u += L;
      if (fins > 0 && L > 1e-5 && (!finSides || finSides.includes(tags[i]))) {
        while (finRun <= L) {
          const t = finRun / L, px = a[0] + (b[0] - a[0]) * t, pz = a[1] + (b[1] - a[1]) * t;
          const nx = (b[1] - a[1]) / L, nz = -(b[0] - a[0]) / L, d = glassIn + 0.06;
          const box = new THREE.BoxGeometry(finW, yb - ya, d);
          box.rotateY(Math.atan2(nx, nz));
          box.translate(px + nx * d / 2, (ya + yb) / 2, pz + nz * d / 2);
          finGeos.push(box); finRun += fins;
        }
        finRun -= L;
      }
    }
  }
  glassSinks.forEach(({ st, alt, sink }) => group.add(new THREE.Mesh(sink.geo(), glassMat(st, seed + alt * 7))));
  const wg = wall.geo(); if (wg) group.add(new THREE.Mesh(wg, M.wall));
  if (finGeos.length) group.add(mergedMesh(finGeos, M.slab));

  // portholes on solid shell runs: dark frame + lit lens, one row per floor
  if (portholes) {
    const { every = 1.1, r = 0.2, color = '#FFC676', floors: pf = null, sides = 'all', stretch = 1, lens = true } = portholes;
    const frames = [], lenses = [];
    for (let f = 1; f <= floors; f++) {
      if (pf && !pf.includes(f)) continue;
      const y = top0 + (f - 1) * floorH + slabT + (floorH - slabT) / 2;
      let pr = every * 0.5;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (styleAt(f, i) !== 'wall' || !(sides === 'all' || sides.includes(tags[i]))) { pr = every * 0.5; continue; }
        const a = O0[i], b = O0[j], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 1e-5) continue;
        while (pr <= L) {
          const t = pr / L, nx = (b[1] - a[1]) / L, nz = -(b[0] - a[0]) / L, ang = Math.atan2(nx, nz);
          const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
          const fr = new THREE.CircleGeometry(r, 14); fr.scale(stretch, 1, 1); fr.rotateY(ang); fr.translate(x + nx * 0.02, y, z + nz * 0.02); frames.push(fr);
          const le = new THREE.CircleGeometry(r * 0.66, 14); le.scale(stretch, 1, 1); le.rotateY(ang); le.translate(x + nx * 0.035, y, z + nz * 0.035); lenses.push(le);
          pr += every;
        }
        pr -= L;
      }
    }
    if (frames.length && !lens) group.add(mergedMesh(frames, M.porthole));
    else if (frames.length) {
      group.add(mergedMesh(frames, M.porthole));
      const lm = new THREE.MeshBasicMaterial({ color, toneMapped: false }); lm.color.multiplyScalar(1.3);
      group.add(mergedMesh(lenses, lm));
    }
  }

  // thick white slab ledges (proud of the shell) at the lobby head and every floor line
  const slabGeos = [];
  const so = offsetOutline(o, slabOut);
  for (let f = 0; f < floors; f++) {
    const y = top0 + f * floorH;
    slabGeos.push(extrudeOutline(f === 0 ? offsetOutline(o, slabOut + 0.06) : so, y - (f === 0 ? 0.06 : 0), y + slabT, { bevel: 0.06 }));
  }
  group.add(mergedMesh(slabGeos, M.slab));
  // glowing warm floor lines along the slab noses (reference: lit edges at every floor)
  if (floorLines) {
    const ys = [];
    for (let f = 0; f < floors; f++) ys.push(top0 + f * floorH + slabT * 0.5);
    group.add(makeNeonLine(offsetOutline(o, slabOut + 0.015), ys, { color: floorLines, height: 0.085, glow: 0.2, intensity: 1.45, glowOpacity: 0.26 }));
  }
  // roof: thick rounded lip, deck, parapet, glowing edge
  const lip = offsetOutline(o, lipOut ?? slabOut + 0.08);
  group.add(new THREE.Mesh(extrudeOutline(lip, glassTop, top, { bevel: 0.08 }), [roof.deck || M.deck, M.slab]));
  const inner = offsetOutline(lip, -parapetW);
  group.add(new THREE.Mesh(extrudeOutline(lip, top - 0.02, top + parapetH, { holes: [inner], bevel: 0.07 }), M.slab));
  if (roofEdge) group.add(makeNeonLine(offsetOutline(lip, 0.012), [top + parapetH - 0.06], { color: roofEdge, height: 0.08, glow: 0.2, intensity: 1.3, glowOpacity: 0.26 }));
  // warm soffit glow right under the lobby head (reference: lobbies light the slab above them)
  group.add(makeNeonLine(offsetOutline(o, -lobbyInset + 0.03), [top0 - 0.06], { color: '#FFD9A0', height: 0.06, glow: 0.25, intensity: 1.5, glowOpacity: 0.3 }));
  return { group, top, roofOutline: inner, outline: o };
}
/** Warm base glow, tighter than the kit default (reference: light hugs the facade, small ground pool). */
function glow(o, { spread = 2, intensity = 1, ...rest } = {}) {
  return makeBaseGlow(o, { spread: spread * 0.55, intensity: intensity * 0.85, height: 1.4, ...rest });
}

// ------------------------------------------------------------------------------------------
// Reference-space design: outlines given as pixel coordinates of ref/dashboard.png (1536x1024) at a known
// height, unprojected through a fixed copy of the fitted camera (engine.js 11-01: fov 20, elevation 53.85,
// distance 279.6, target -0.85,0,8.15) into the slot's local frame. Keeps every silhouette where the
// reference draws it, whatever the slot rotation.
// ------------------------------------------------------------------------------------------
let _refCam;
function refCam() {
  if (_refCam) return _refCam;
  const c = new THREE.PerspectiveCamera(20, 1536 / 1024, 0.5, 1800);
  const t = new THREE.Vector3(-0.85, 0, 8.15), el = 53.85 * D2R, d = 279.6;
  c.position.set(t.x, Math.sin(el) * d, Math.cos(el) * d + t.z); c.lookAt(t);
  c.updateMatrixWorld(); c.updateProjectionMatrix();
  return (_refCam = c);
}
/** Reference pixel (sx, sy) seen at height h -> [x, z] in the slot frame. */
function refXZ(slot, sx, sy, h = 0) {
  const c = refCam();
  const v = new THREE.Vector3((sx / 1536) * 2 - 1, 1 - (sy / 1024) * 2, 0.5).unproject(c);
  const dir = v.sub(c.position).normalize();
  const w = c.position.clone().addScaledVector(dir, (h - c.position.y) / dir.y);
  const a = slot.deg * D2R, r = (slot.deg - 90) * D2R;
  const dx = w.x - Math.cos(a) * slot.r, dz = w.z + Math.sin(a) * slot.r;
  return [dx * Math.cos(r) - dz * Math.sin(r), dx * Math.sin(r) + dz * Math.cos(r)];
}
/** Rounded outline from reference pixels [[sx, sy, radius, tag], ...] (clockwise on screen) at height h. */
function refPoly(slot, verts, h) {
  const pts = verts.map((v) => refXZ(slot, v[0], v[1], h));
  return polyOutline(pts, verts.map((v) => v[2] || 0), { tags: verts.map((v) => v[3] || 'all') });
}
/** Screen-space ellipse (reference pixels: centre, semi-axes) at height h, as a tagged outline. */
function refEllipse(slot, cx, cy, ax, ay, h, n = 48) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push(refXZ(slot, cx + ax * Math.sin(a), cy - ay * Math.cos(a), h)); }
  return withTags(pts);
}
/**
 * Screen-space annular arc (reference pixels): centre (cx, cy), inner semi-axes (ax0, ay0), outer (ax1, ay1),
 * angles a0..a1 deg (0 = up on screen, + clockwise), at height h. tagFn(side, a) tags each segment
 * (side 'out' | 'in' | 'cap0' | 'cap1'). Returns a normalised kit outline.
 */
function refArc(slot, cx, cy, ax0, ay0, ax1, ay1, a0, a1, h, tagFn, n = 44) {
  const pts = [], tags = [];
  const P = (ax, ay, a) => refXZ(slot, cx + ax * Math.sin(a * D2R), cy - ay * Math.cos(a * D2R), h);
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push(P(ax1, ay1, a)); tags.push(i === n ? tagFn('cap1', a1) : tagFn('out', a + (a1 - a0) / n / 2)); }
  for (let i = 0; i <= n; i++) { const a = a1 - ((a1 - a0) * i) / n; pts.push(P(ax0, ay0, a)); tags.push(i === n ? tagFn('cap0', a0) : tagFn('in', a - (a1 - a0) / n / 2)); }
  return polyOutline(pts, 0, { tags, step: 1 });
}
/** Smooth closed outline: Catmull-Rom spline through reference pixels [[sx, sy, tag], ...] (clockwise on screen) at height h. */
function refSpline(slot, verts, h, sub = 8) {
  const n = verts.length, pts = [], tags = [];
  for (let i = 0; i < n; i++) {
    const p0 = verts[(i + n - 1) % n], p1 = verts[i], p2 = verts[(i + 1) % n], p3 = verts[(i + 2) % n];
    for (let k = 0; k < sub; k++) {
      const t = k / sub, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      pts.push(refXZ(slot, f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), h));
      tags.push(p1[2] || 'all');
    }
  }
  return polyOutline(pts, 0, { tags, step: 1 });
}
/** List of reference pixels -> [{x, z, ...extra}] at height h (trees, lamps, details). */
const refPts = (slot, list, h = 0) => list.map(([sx, sy, s]) => { const [x, z] = refXZ(slot, sx, sy, h); return { x, z, s }; });

/** placeBuilding with a local (x, z) nudge of the whole complex inside its slot. */
function place(ctx, slot, g, dx = 0, dz = 0) {
  const w = new THREE.Group();
  g.position.set(dx, 0, dz);
  w.add(g);
  return placeBuilding(ctx, slot, w);
}

// ------------------------------------------------------------------------------------------
// models-box (deg 90). Drawn in reference space: a wide stadium-shaped hall with round ends, bright cyan
// glass ribbons wrapping the left end, a centre bay (one continuous warm ribbon, a dark band, a full-width
// warm lobby under a dark canopy) between two white pilasters, a smooth deep-blue roof court in a raised rim
// with a thin lit edge, and a lower curved annex tucked behind on the right with warm ribbon glazing.
// ------------------------------------------------------------------------------------------
let _boxCourt, _boxFrame, _boxDeck;
const boxDeck = () => (_boxDeck ||= new THREE.MeshLambertMaterial({ color: '#3C5AB4', map: MAT.roof.map, emissive: '#10204E', emissiveIntensity: 1 }));
let _annexDeck;
const annexDeck = () => (_annexDeck ||= new THREE.MeshLambertMaterial({ color: '#6C6E8C', map: MAT.roof.map, emissive: '#16182A', emissiveIntensity: 1 }));
/** Box on the local axes: centre (x, z), size w (x) x d (z), from y0 to y1, optional y-rotation (rad). */
function boxGeo(x, z, w, d, y0, y1, rot = 0) {
  const b = new THREE.BoxGeometry(w, y1 - y0, d);
  if (rot) b.rotateY(rot);
  b.translate(x, (y0 + y1) / 2, z);
  return b;
}
function buildModelsBox(ctx, slot) {
  const g = new THREE.Group();
  const M = shellMats();
  const lobbyH = 2.5, floorH = 1.9, H = lobbyH + 2 * floorH + 0.75;
  // asymmetric stadium: a fully round, larger left end, a tighter right end (reference)
  const main = offsetOutline(refPoly(slot, [[704, 102, 3.4, 'back'], [834, 102, 2.5, 'right'], [837, 141, 2.5, 'front'], [701, 141, 3.4, 'left']], H + 0.3), -0.3);
  // retag by position: cyan glass wraps the left end, warm/violet lit glazing on the right end, centre recess
  const xL = refXZ(slot, 741, 141, H)[0], xR = refXZ(slot, 802, 141, H)[0], zMid = refXZ(slot, 770, 122, H)[1];
  main.tags = main.pts.map((p, i) => {
    const q = main.pts[(i + 1) % main.pts.length], mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
    if (mx < xL && mz > zMid - 1.6) return 'cyan';
    if (mx > xR && mz > zMid - 1.6) return 'east';
    return mz > zMid ? 'front' : 'back';
  });
  const A = block(main, {
    seed: 31, lobbyH, floorH, roofT: 0.75, piers: false, windows: 'dim', fins: 1.3, finSides: ['cyan', 'east'], slabT: 0.3, slabOut: 0.14, glassIn: 0.14,
    roofEdge: '#D2B0FF', roof: { deck: boxDeck() }, columns: false, lobbyInset: 0.55, parapetW: 0.5, parapetH: 0.36,
    lobby: { style: 'lobby', sides: ['front', 'east', 'cyan'], map: { cyan: 'cyan' }, wall: ['back'] },
    bands: [
      { sides: ['cyan'], style: 'cyan' },
      { sides: ['east'], style: 'violet', floors: [2] }, { sides: ['east'], style: 'warm', floors: [1] },
      { sides: ['front'], style: 'warm', floors: [2] }, { sides: ['front'], style: 'night', floors: [1] },
    ],
  });
  g.add(A.group);

  // thick white frame round the recessed centre bay: two rounded pilasters + a deep lintel at the roof line,
  // a lower canopy over the lobby (warm underside line), all proud of the facade
  const zF = refXZ(slot, 770, 141, H)[1] - 0.3;
  _boxFrame ||= M.slab;
  const fr = [];
  for (const x of [xL, xR]) fr.push(boxGeo(x, zF + 0.2, 0.75, 1.0, lobbyH - 0.05, H + 0.25));
  fr.push(boxGeo((xL + xR) / 2, zF + 0.2, xR - xL + 0.75, 1.0, H - 0.6, H + 0.32));
  g.add(mergedMesh(fr, _boxFrame));
  // dark canopy over the full-width warm lobby
  g.add(new THREE.Mesh(boxGeo((xL + xR) / 2, zF + 0.55, xR - xL - 0.3, 1.5, lobbyH - 0.05, lobbyH + 0.28), M.channel));
  g.add(makeNeonLine([[xL + 0.4, zF + 1.31], [xR - 0.4, zF + 1.31]], [lobbyH + 0.1], { color: '#FFD9A0', height: 0.08, glow: 0.25, intensity: 1.7, glowOpacity: 0.4 }));
  g.add(makeNeonLine([[xL - 0.38, zF + 0.71], [xR + 0.38, zF + 0.71]], [H + 0.22], { color: '#D2B0FF', height: 0.07, glow: 0.25, intensity: 1.6, glowOpacity: 0.35 }));
  // warm interior strips glowing through the deep lobby glass
  g.add(makeNeonLine([[xL + 0.6, zF - 0.4], [xR - 0.6, zF - 0.4]], [0.55, 1.3], { color: '#FFB060', height: 0.06, glow: 0.2, intensity: 1.7, glowOpacity: 0.35 }));

  // low curved annex tucked behind the right end: a rounded quarter-drum wrapping the end, about three quarters
  // of the main height, continuous warm ribbon glazing between white slabs on its curved face, a mid-grey deck
  // with small equipment and a lit roof edge
  const annex = refSpline(slot, [
    [816, 112, 'hid'], [846, 113, 'out'], [864, 119, 'out'], [874, 128, 'out'], [876, 139, 'out'], [868, 147, 'out'], [853, 148, 'out'], [840, 142, 'hid'], [826, 134, 'hid'], [816, 130, 'hid'],
  ], 4.4, 6);
  const AN = block(annex, {
    seed: 35, lobbyH: 1.45, floors: 2, floorH: 1.12, roofT: 0.45, windows: 'warm', piers: false, fins: 1.4, finSides: ['out'], columns: false,
    slabT: 0.34, slabOut: 0.18, glassIn: 0.24, lobbyInset: 0.5, roof: { deck: annexDeck() }, parapetW: 0.36, roofEdge: '#FFD49A',
    lobby: { style: 'lobby', sides: ['out'], wall: ['hid'] }, bands: [{ sides: ['hid'], style: 'wall' }],
  });
  g.add(AN.group);
  g.add(makeRoofDetails(refPts(slot, [[850, 118], [862, 126], [868, 137], [856, 142], [842, 126]], AN.top).map((p, i) => ({ type: ['vent', 'ac', 'skylight'][i % 3], w: 0.45, d: 0.35, ...p })), AN.top));
  g.add(makeTrees(refPts(slot, [[852, 124, 0.42], [862, 136, 0.38], [870, 130, 0.32], [846, 136, 0.34], [858, 117, 0.3]], AN.top).map((t) => ({ ...t, y: AN.top + 0.05 })), { seed: 41 }));
  // roof: dished stadium: a thick raised rim stepping down inward (sloped lip), a smooth deep-blue dish, and
  // two thin white fins arcing across the roof from the front rim to the back rim near each end
  _boxCourt ||= new THREE.MeshLambertMaterial({ color: '#22387E', emissive: '#0A1638', emissiveIntensity: 1 });
  const rim1 = offsetOutline(main, -0.55), rim2 = offsetOutline(main, -1.0);
  g.add(new THREE.Mesh(extrudeOutline(rim1, A.top - 0.02, A.top + 0.22, { holes: [rim2], bevel: 0.05 }), M.slab));
  g.add(new THREE.Mesh(extrudeOutline(rim2, A.top - 0.03, A.top + 0.0), _boxCourt));
  g.add(makeNeonLine(offsetOutline(rim2, 0.02), [A.top + 0.19], { color: '#D9C2FF', height: 0.04, glow: 0.14, intensity: 1.3, glowOpacity: 0.25 }));
  {
    const fins = [];
    for (const [x0, y0, xm, ym, x1, y1] of [[716, 135, 712, 118, 722, 104], [822, 135, 826, 118, 818, 104]]) {
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16, sx = (1 - t) ** 2 * x0 + 2 * t * (1 - t) * xm + t * t * x1, sy = (1 - t) ** 2 * y0 + 2 * t * (1 - t) * ym + t * t * y1;
        const lift = Math.sin(t * Math.PI) * 0.9;
        const [x, z] = refXZ(slot, sx, sy, A.top + lift);
        pts.push(new THREE.Vector3(x, A.top + 0.15 + lift, z));
      }
      fins.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.08, 6, false));
    }
    g.add(mergedMesh(fins, M.col));
  }
  g.add(makeRoofDetails([
    ...refPts(slot, [[712, 120], [826, 118], [716, 132], [822, 134], [770, 136], [745, 108], [796, 108]], A.top).map((p, i) => ({ type: i % 3 === 2 ? 'ac' : 'vent', w: 0.5, d: 0.4, ...p })),
  ], A.top));
  const [bx, bz] = refXZ(slot, 767, 106, A.top + 2.6);
  addBadge(g, slot, bx, bz, A.top, A.top + 2.6, 4.4, 0.3, { halo: 1.7, haloOpacity: 0.24 });

  const lot = refPoly(slot, [[684, 92, 2.0], [872, 92, 2.0], [874, 190, 2.0], [682, 190, 2.0]], 0);
  g.add(lotFor(main, lot, 0.6));
  g.add(glow(main, { spread: 1.8, intensity: 1.3, color: '#FFB060' }), glow(annex, { spread: 1.8, intensity: 1.4, color: '#FFB060' }));
  g.add(makeNeonLine(offsetOutline(main, 0.05), [0.2], { color: '#FFB060', height: 0.1, glow: 0.3, intensity: 1.7, glowOpacity: 0.4 }));
  // dense tree clusters on both sides, warm path lamps, a warm lit forecourt spilling from the lobby
  g.add(makeTrees(refPts(slot, [
    [690, 100, 0.85], [686, 114, 0.8], [688, 128, 0.9], [684, 142, 0.8], [692, 156, 0.85], [688, 170, 0.8], [700, 178, 0.85], [705, 188, 0.8],
    [714, 182, 0.7], [726, 188, 0.85], [698, 92, 0.7], [720, 92, 0.75], [815, 92, 0.75], [845, 96, 0.7], [858, 100, 0.7], [872, 104, 0.75],
    [878, 120, 0.8], [880, 138, 0.8], [876, 152, 0.85], [872, 168, 0.8], [864, 180, 0.85], [850, 186, 0.75], [836, 182, 0.7], [814, 188, 0.8],
  ]), { seed: 21 }));
  g.add(makePlanters(refPts(slot, [[748, 188], [792, 188]]).map((p) => ({ ...p, w: 1.6, d: 0.45 }))));
  const fore = refPoly(slot, [[738, 143, 1.2], [802, 143, 1.2], [808, 168, 1.2], [732, 168, 1.2]], 0);
  _walkMat ||= new THREE.MeshLambertMaterial({ color: '#555872', emissive: '#0E0F1C', emissiveIntensity: 1 });
  g.add(new THREE.Mesh(extrudeOutline(fore, 0.0, 0.05), new THREE.MeshLambertMaterial({ color: '#8A7A6A', emissive: '#4A3018', emissiveIntensity: 1 })));
  g.add(glow(fore, { spread: 2.2, intensity: 1.6, color: '#FFB060' }));
  g.add(makeLamps(refPts(slot, [
    [740, 190], [760, 191], [782, 191], [802, 190], [690, 175], [870, 175], [770, 90], [736, 166], [806, 166], [736, 150], [806, 150],
    [696, 108], [696, 140], [874, 112], [878, 146], [720, 186], [822, 186],
  ]).map((p) => [p.x, p.z])));
  place(ctx, slot, g, 0, 0);
}

// ------------------------------------------------------------------------------------------
// cloud (deg 54). Drawn in reference space as one smooth spline mass: continuous dark-tinted warm ribbon
// glazing between thick slabs on the front and the fully round right end, a solid white curved corner volume
// with one dark slot window, a left wing one storey lower with a planted roof terrace, and a raised oval roof
// ring set toward the back (white rim round a dark green-grey court) with the badge in it. Slate deck, fixtures.
// ------------------------------------------------------------------------------------------
let _cloudCourt, _cloudDeck;
function buildCloud(ctx, slot) {
  const g = new THREE.Group();
  const M = shellMats();
  _cloudDeck ||= new THREE.MeshLambertMaterial({ color: '#8A88AC', map: MAT.roof.map, emissive: '#1A1A2E', emissiveIntensity: 1 });
  const lobbyH = 1.9, floorH = 1.6, H = lobbyH + 2 * floorH + 0.45;
  // main body: an elongated rounded rectangle seen corner-on (reference roof line): straight back edge, a long
  // straight front-left face along the road, one rounded front corner at the bottom (white pier), a straight
  // right face rising to a rounded right end
  const main = refSpline(slot, [
    [972, 152, 'back'], [1000, 150, 'back'], [1030, 152, 'back'], [1056, 156, 'right'], [1068, 165, 'right'], [1073, 180, 'right'],
    [1071, 197, 'fr'], [1060, 209, 'fr'], [1042, 218, 'fr'], [1026, 223, 'corner'], [1013, 225, 'corner'], [1001, 221, 'front'],
    [989, 214, 'front'], [976, 208, 'front'], [968, 203, 'hidden'], [966, 196, 'hidden'], [966, 160, 'hidden'], [967, 154, 'back'],
  ], H + 0.35, 6);
  const A = block(main, {
    seed: 51, lobbyH, floorH, windows: 'night', piers: false, slabT: 0.34, slabOut: 0.14, glassIn: 0.18, fins: 3.0, finW: 0.14, columns: false,
    lobbyInset: 0.55, roof: { deck: _cloudDeck }, parapetW: 0.7, lipOut: 0.3,
    lobby: { style: 'lobby', sides: ['front', 'fr', 'right'], wall: ['corner', 'back', 'hidden'] },
    bands: [{ sides: ['corner'], style: 'wall' }, { sides: ['front', 'fr'], style: 'streak' }, { sides: ['right'], style: 'night' }],
  });
  g.add(A.group);
  // bold white pier at the rounded front corner: full height, proud of both faces, slot window, warm base strip
  {
    const [px, pz] = refXZ(slot, 1015, 224, H);
    const cx = main.pts.reduce((s, p) => s + p[0], 0) / main.pts.length, cz = main.pts.reduce((s, p) => s + p[1], 0) / main.pts.length;
    let nx = px - cx, nz = pz - cz; const L = Math.hypot(nx, nz); nx /= L; nz /= L;
    const c = new THREE.CylinderGeometry(1.05, 1.05, H - 0.1, 28); c.translate(px - nx * 0.4, (H - 0.1) / 2, pz - nz * 0.4);
    g.add(new THREE.Mesh(c, M.slab));
    const ang = Math.atan2(nx, nz), win = new THREE.BoxGeometry(0.34, 1.2, 0.2); win.rotateY(ang);
    win.translate(px + nx * 0.6, lobbyH + floorH * 1.35, pz + nz * 0.6);
    g.add(new THREE.Mesh(win, M.porthole));
    const arc = []; for (let k = 0; k <= 24; k++) { const t = ang + (k / 24 - 0.5) * 2.4; arc.push([px - nx * 0.4 + Math.sin(t) * 1.08, pz - nz * 0.4 + Math.cos(t) * 1.08]); }
    g.add(makeNeonLine(arc, [0.3], { color: '#FFC070', height: 0.2, glow: 0.45, intensity: 1.9, glowOpacity: 0.5 }));
  }
  // warm interior light deep behind the dark recessed glass (sparse spots of warm rooms)
  g.add(makeNeonLine(offsetOutline(main, -0.7).pts.filter((_, i, arr) => i % 3 === 0), [lobbyH + 0.55], { color: '#FFB060', height: 0.05, glow: 0.15, intensity: 1.2, glowOpacity: 0.2 }));
  // lower left wing (same depth as the main body, no waist), a planted roof terrace
  const wing = refSpline(slot, [
    [938, 161, 'back'], [958, 159, 'back'], [975, 159, 'hidden'], [975, 201, 'front'], [956, 197, 'front'], [940, 191, 'left'], [935, 186, 'left'], [934, 168, 'left'], [935, 163, 'back'],
  ], 4.75, 6);
  const B = block(wing, {
    seed: 53, lobbyH: 1.5, floors: 2, floorH: 1.25, windows: 'streak', piers: false, slabT: 0.3, slabOut: 0.12, glassIn: 0.16, fins: 1.5, roofT: 0.45,
    columns: false, lobbyInset: 0.45, roof: { deck: _cloudDeck }, lipOut: 0.26, parapetW: 0.5,
    lobby: { style: 'lobby', sides: ['front', 'left'] }, bands: [{ sides: ['back', 'hidden'], style: 'night' }, { sides: ['left'], style: 'night' }],
  });
  g.add(B.group);
  // terrace deck: a few small planters and units (no open lawn)
  g.add(makePlanters(refPts(slot, [[946, 172], [958, 184]], B.top).map((p) => ({ ...p, w: 1.0, d: 0.4, rot: 54 }))).translateY(B.top));
  g.add(makeTrees(refPts(slot, [[946, 170, 0.32], [958, 183, 0.3], [950, 190, 0.28]], B.top).map((t) => ({ ...t, y: B.top + 0.08 })), { seed: 33 }));
  g.add(makeRoofDetails(refPts(slot, [[944, 182], [956, 166], [962, 192], [940, 168]], B.top).map((p, i) => ({ type: ['vent', 'ac', 'skylight', 'vent'][i], w: 0.45, d: 0.35, rot: 54, ...p })), B.top));
  g.add(makeRoofDetails(refPts(slot, [[970, 176], [972, 190]], B.top).map((p, i) => ({ type: i ? 'vent' : 'ac', w: 0.5, d: 0.4, rot: 54, ...p })), B.top));
  // raised oval roof ring toward the back: white rim round a dark slate-green court, badge in it
  const ring = refEllipse(slot, 1011, 177, 40, 22, A.top + 0.9);
  _cloudCourt ||= new THREE.MeshLambertMaterial({ color: '#2A3432', emissive: '#0A1210', emissiveIntensity: 1 });
  const T = makeTier(ring, A.top, 0.85, { band: null, deck: _cloudCourt, rim: 0.75, rimH: 0.16 });
  g.add(T.group);
  g.add(makeNeonLine(offsetOutline(ring, 0.07), [T.top + 0.12], { color: '#FFD49A', height: 0.06, glow: 0.18, intensity: 1.3, glowOpacity: 0.24 }));
  g.add(makeNeonLine(offsetOutline(ring, -0.78), [T.top + 0.12], { color: '#FFD49A', height: 0.04, glow: 0.12, intensity: 1.1, glowOpacity: 0.18 }));
  g.add(makeTrees(refPts(slot, [[1032, 166, 0.3], [1036, 180, 0.28], [988, 182, 0.26], [1024, 188, 0.24]], T.top).map((t) => ({ ...t, y: T.top - 0.1 })), { seed: 31 }));
  const fx = (list, y) => refPts(slot, list, y);
  g.add(makeRoofDetails(fx([[1054, 170], [1058, 184], [1060, 194], [1046, 202], [1030, 210], [1014, 212], [994, 205], [1058, 162], [978, 196]], A.top)
    .map((p, i) => ({ type: i % 3 === 0 ? 'ac' : 'vent', w: 0.5, d: 0.4, rot: 54, ...p })), A.top));
  // lit seams across the open deck (front and right of the ring)
  g.add(makeSeams([fx([[985, 205], [1020, 212], [1055, 205]], A.top).map((p) => [p.x, p.z]), fx([[1050, 152], [1066, 175], [1064, 198]], A.top).map((p) => [p.x, p.z])], A.top + 0.01, 0.05, MAT.seamLight));
  const [bx, bz] = refXZ(slot, 1006, 171, A.top + 2.9);
  addBadge(g, slot, bx, bz, T.top, A.top + 2.9, 4.4, 1.1);

  const lot = refPoly(slot, [[922, 150, 2.0], [1082, 140, 2.0], [1090, 248, 2.0], [1030, 272, 2.0], [920, 252, 2.0]], 0);
  g.add(lotFor(main, lot, 0.45));
  g.add(glow(main, { spread: 1.4, intensity: 1.1, color: '#FFB060' }), glow(wing, { spread: 1.4, intensity: 1.0, color: '#FFB060' }));
  g.add(makeNeonLine(offsetOutline(main, 0.05), [0.2], { color: '#FFB060', height: 0.1, glow: 0.3, intensity: 1.7, glowOpacity: 0.38 }));
  g.add(makeNeonLine(offsetOutline(wing, 0.05), [0.2], { color: '#FFB060', height: 0.1, glow: 0.3, intensity: 1.7, glowOpacity: 0.38 }));
  g.add(makeTrees(refPts(slot, [
    [928, 150, 0.9], [948, 142, 0.8], [1078, 152, 0.85], [1084, 205, 0.9], [1078, 232, 0.85], [1062, 252, 0.8],
    [926, 232, 0.85], [950, 252, 0.8], [1000, 140, 0.75], [1052, 138, 0.8],
  ]), { seed: 22 }));
  g.add(makeLamps(refPts(slot, [[940, 258], [985, 265], [1045, 266], [1086, 240], [1088, 180], [922, 200]]).map((p) => [p.x, p.z])));
  place(ctx, slot, g, 0, 0);
}

// ------------------------------------------------------------------------------------------
// gear (deg 18). Drawn in reference space: a crescent wing (concave toward the court, cut far end at the upper
// left, dark-glazed rows between white fins on its outer face, porthole row at the top, white spine on the roof),
// a low horseshoe ring round an open court with continuous warm glazing on its curved right face, and at the
// front two plain white piers with warm base strips flanking a deep dark recessed entrance under a white canopy.
// ------------------------------------------------------------------------------------------

let _gearCourt, _paleDeck;
const paleDeck = () => (_paleDeck ||= new THREE.MeshLambertMaterial({ color: '#B4B4D8', map: MAT.roof.map, emissive: '#262640', emissiveIntensity: 1 }));
/** Rounded outline from reference pixels with a height per vertex: [[sx, sy, radius, tag, h], ...]. */
function refPolyH(slot, verts) {
  return polyOutline(verts.map((v) => refXZ(slot, v[0], v[1], v[4])), verts.map((v) => v[2] || 0), { tags: verts.map((v) => v[3] || 'all') });
}
/** Band outline (open curve with a width w -> w1) from centre-line reference pixels at height h; tags A/B sides, cap0/cap1. */
function refBand(slot, line, h, w, w1 = w) {
  const C = line.map(([sx, sy]) => refXZ(slot, sx, sy, h));
  const n = C.length, L = [], R = [];
  for (let i = 0; i < n; i++) {
    const p = C[Math.max(0, i - 1)], q = C[Math.min(n - 1, i + 1)];
    let tx = q[0] - p[0], tz = q[1] - p[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const half = (w + (w1 - w) * (i / (n - 1))) / 2;
    L.push([C[i][0] - tz * half, C[i][1] + tx * half]); R.push([C[i][0] + tz * half, C[i][1] - tx * half]);
  }
  const pts = [...L, ...R.reverse()], tags = [];
  for (let i = 0; i < n - 1; i++) tags.push('A');
  tags.push('cap1');
  for (let i = 0; i < n - 1; i++) tags.push('B');
  tags.push('cap0');
  return polyOutline(pts, 0, { tags, step: 1 });
}
function buildGear(ctx, slot) {
  const g = new THREE.Group();
  const M = shellMats();
  // ---- broad crescent wing (reference pixels at roof height): a tall outer half (lit left facade, porthole
  // row, raised white spine fin on its roof) and a lower inner terrace half one storey down toward the court.
  // Squared, rounded cut at the far (upper) end; the near end meets the glazed lobby.
  const lobW = 1.45, flW = 1.0, HW = lobW + 3 * flW + 0.45, HI = lobW + 2 * flW + 0.4;
  const hw = HW + 0.3, hi = HI + 0.3;
  const outer = refPolyH(slot, [
    [1103, 253, 0.5, 'end', hw], [1118, 251, 0, 'in', hw], [1125, 268, 0, 'in', hw], [1133, 292, 0, 'in', hw], [1142, 318, 0, 'in', hw],
    [1150, 341, 0, 'in', hw], [1155, 362, 0.2, 'front', hw], [1150, 376, 0.6, 'front', hw], [1146, 377, 0, 'front', hw], [1137, 376, 0, 'out', hw], [1123, 361, 0, 'out', hw],
    [1111, 342, 0, 'out', hw], [1104, 318, 0, 'out', hw], [1100, 292, 0, 'out', hw], [1100, 268, 0.4, 'out', hw],
  ]);
  const A = block(outer, {
    seed: 61, lobbyH: lobW, floors: 3, floorH: flW, slabT: 0.24, slabOut: 0.1, glassIn: 0.18, roofT: 0.45, parapetW: 0.34, windows: 'warm',
    fins: 0.9, finW: 0.15, finSides: ['out'], columns: false, lobbyInset: 0.45, piers: false, floorLines: '#FFD49A', roofEdge: '#FFD49A',
    roof: { deck: paleDeck() },
    lobby: { style: 'lobby', sides: ['out', 'front'], wall: ['end', 'in'] },
    bands: [{ sides: ['end'], style: 'wall' }, { sides: ['in'], style: 'dim' }, { sides: ['front'], style: 'night' }, { sides: ['out'], style: 'warm', floors: [1, 2] }, { sides: ['out'], style: 'wall', floors: [3] }],
    portholes: { every: 0.85, r: 0.17, color: '#FFC676', sides: ['out', 'end'], floors: [3] },
  });
  g.add(A.group);
  // inner terrace half: shares the split line with the tall half (pixels taken at the tall roof height so the
  // two walls coincide), dark-glazed toward the court
  const inner = refPolyH(slot, [
    [1118, 251, 0, 'end', hw], [1128, 253, 0.6, 'court', hi], [1138, 268, 0, 'court', hi], [1147, 291, 0, 'court', hi],
    [1155, 316, 0, 'court', hi], [1161, 340, 0, 'court', hi], [1167, 359, 0.6, 'front', hi], [1163, 371, 0.3, 'front', hi],
    [1155, 362, 0, 'hid', hw], [1150, 341, 0, 'hid', hw], [1142, 318, 0, 'hid', hw], [1133, 292, 0, 'hid', hw], [1125, 268, 0, 'hid', hw],
  ]);
  const I = block(inner, {
    seed: 62, lobbyH: lobW, floors: 2, floorH: flW, slabT: 0.24, slabOut: 0.08, glassIn: 0.16, roofT: 0.4, parapetW: 0.3, windows: 'night',
    fins: 1.1, finSides: ['court'], columns: false, lobbyInset: 0.4, piers: false, floorLines: '#FFD49A', roofEdge: '#E8ECFF',
    roof: { deck: M.deckDark },
    lobby: { style: 'night', sides: ['court', 'front'], wall: ['hid', 'end'] },
    bands: [{ sides: ['hid', 'end'], style: 'wall' }, { sides: ['front'], style: 'warm' }],
  });
  g.add(I.group);

  // ---- open horseshoe: a curved low wing sweeping from the wing's far end down round the right of the court to
  // the lobby, warm continuous glazing on its outer face, dark court side. The badge floats over the court.
  const lobR = 1.35, flR = 1.05, HR = lobR + 2 * flR + 0.4;
  const ring = refBand(slot, [[1182, 297], [1198, 302], [1210, 313], [1217, 330], [1214, 348], [1204, 364], [1192, 374]], HR + 0.3, 1.7, 2.1);
  {
    // which band side faces the court: the one whose midpoints sit nearer the court centre
    const [cx, cz] = refXZ(slot, 1180, 322, HR);
    const P = ring.pts, d = { A: [0, 0], B: [0, 0] };
    ring.tags.forEach((t, i) => { if (d[t]) { const q = P[(i + 1) % P.length]; d[t][0] += Math.hypot((P[i][0] + q[0]) / 2 - cx, (P[i][1] + q[1]) / 2 - cz); d[t][1]++; } });
    const courtSide = d.A[0] / d.A[1] < d.B[0] / d.B[1] ? 'A' : 'B';
    ring.tags = ring.tags.map((t) => (t === courtSide ? 'court' : t === 'A' || t === 'B' ? 'front' : 'cap'));
  }
  const B = block(ring, {
    seed: 63, lobbyH: lobR, floors: 2, floorH: flR, piers: false, windows: 'dim', fins: 1.6, finSides: ['front'], parapetW: 0.32,
    slabT: 0.22, slabOut: 0.1, glassIn: 0.14, columns: false, lobbyInset: 0.4, roof: { deck: M.deck }, roofEdge: '#FFC27A',
    lobby: { style: 'lobby', sides: ['front'], map: { court: 'night' }, wall: ['cap'] },
    bands: [{ sides: ['cap'], style: 'wall' }, { sides: ['front'], style: 'streak' }, { sides: ['court'], style: 'night' }],
  });
  g.add(B.group);

  // low curved strip sweeping from the wing's far end down to the horseshoe (reference: pale curved ledge
  // above the court), lit edge
  const ramp = refBand(slot, [[1138, 264], [1152, 272], [1166, 281], [1180, 291], [1190, 298]], 1.25, 1.5, 1.6);
  const RT = makeTier(ramp, 0, 1.15, { band: 'night', seed: 64, deck: M.deck, rim: 0.22, rimH: 0.2, bandFrom: 0.25, bandTo: 0.75 });
  g.add(RT.group);
  g.add(makeNeonLine(offsetOutline(ramp, 0.06), [RT.top + 0.12], { color: '#E8ECFF', height: 0.05, glow: 0.16, intensity: 1.3, glowOpacity: 0.26 }));

  // ---- glazed lobby joining the wing's near end to the horseshoe: flat dark roof with a radial seam, deep
  // dark recessed glass with warm interior light, lit roof edge
  const ent = refPoly(slot, [[1158, 349, 0.3, 'side'], [1196, 352, 0.3, 'side'], [1194, 366, 0.2, 'front'], [1162, 368, 0.2, 'front']], 3.0);
  const E = block(ent, {
    seed: 69, floors: 1, floorH: 0.9, lobbyH: 1.75, lobbyInset: 0.5, windows: 'night', piers: false, fins: 0.9, columns: true, roofT: 0.35,
    lobby: { style: 'lobby', sides: ['front'], map: { side: 'night' } }, roofEdge: '#FFD49A', floorLines: '#FFD49A', roof: { deck: M.deckDark },
  });
  g.add(E.group);
  g.add(makeSeams([refPts(slot, [[1180, 351], [1179, 366]], E.top).map((p) => [p.x, p.z])], E.top + 0.32, 0.06, MAT.seamLight));
  g.add(makeNeonLine(offsetOutline(ent, -0.6), [0.5, 1.2], { color: '#FFB060', height: 0.06, glow: 0.18, intensity: 1.7, glowOpacity: 0.35 }));

  // ---- open court: low dark podium deck between the wing and the horseshoe, lit curved seam, shrubs, planters
  _gearCourt ||= new THREE.MeshLambertMaterial({ color: '#363A58', map: MAT.roof.map, emissive: '#0E1028', emissiveIntensity: 1 });
  const court = refPoly(slot, [[1128, 258, 2], [1150, 270, 2], [1188, 296, 3], [1206, 318, 3], [1204, 344, 2], [1184, 350, 2], [1160, 346, 2], [1148, 318, 2], [1139, 292, 2]], 0.7);
  g.add(new THREE.Mesh(extrudeOutline(court, 0, 0.7), [_gearCourt, M.wall]));
  g.add(makeNeonLine(refEllipse(slot, 1182, 322, 15, 11, 0.72, 32), [0.74], { color: '#FFD49A', height: 0.05, glow: 0.15, intensity: 1.3, glowOpacity: 0.25 }));
  g.add(makeTrees(refPts(slot, [[1150, 262, 0.55], [1158, 258, 0.5], [1146, 296, 0.4], [1155, 322, 0.38], [1196, 336, 0.36]], 0.7).map((t) => ({ ...t, y: 0.72 })), { seed: 29 }));
  const pl = makePlanters(refPts(slot, [[1168, 338], [1196, 314]], 0.7).map((p) => ({ ...p, w: 1.2, d: 0.4, rot: 18 })));
  pl.position.y = 0.7; g.add(pl);

  // ---- roofs: raised curved white spine fin along the tall half (glowing edge), skylights, vents and units
  const cl = [[1115, 255], [1120, 272], [1127, 294], [1136, 318], [1144, 340], [1150, 358]].map(([x, y]) => refXZ(slot, x, y, A.top));
  const spineO = curveOutline({ back: cl.map(([x, z]) => [x, z - 0.32]), front: cl.map(([x, z]) => [x, z + 0.32]), corners: 0.3 });
  g.add(new THREE.Mesh(extrudeOutline(spineO, A.top, A.top + 0.42, { bevel: 0.06 }), M.slab));
  g.add(makeNeonLine(offsetOutline(spineO, 0.01), [A.top + 0.4], { color: '#E8ECFF', height: 0.04, glow: 0.16, intensity: 1.3, glowOpacity: 0.26 }));
  g.add(makeRoofDetails(refPts(slot, [[1106, 262], [1104, 282], [1106, 300], [1111, 318], [1118, 334], [1128, 350], [1112, 272], [1120, 306], [1126, 326], [1114, 290]], A.top).map((p, i) => ({ type: ['vent', 'skylight', 'ac'][i % 3], rot: 18, w: 0.5, d: 0.36, ...p })), A.top));
  g.add(makeRoofDetails(refPts(slot, [[1129, 262], [1139, 284], [1147, 306], [1154, 328], [1160, 350]], I.top).map((p, i) => ({ type: i % 2 ? 'ac' : 'vent', rot: 18, w: 0.5, d: 0.4, ...p })), I.top));
  g.add(makeRoofDetails(refPts(slot, [[1196, 302], [1210, 318], [1213, 336], [1208, 352], [1198, 366]], B.top).map((p, i) => ({ type: i % 2 ? 'ac' : 'vent', w: 0.45, d: 0.35, rot: 18, ...p })), B.top));
  const [bx, bz] = refXZ(slot, 1184, 316, HR + 3.2);
  addBadge(g, slot, bx, bz, null, HR + 3.2, 4.4, 2.2);

  // ---- grounds
  const lot = refPoly(slot, [[1084, 242, 2.2], [1150, 244, 2.2], [1226, 296, 2.2], [1230, 386, 2.2], [1086, 392, 2.2]], 0);
  g.add(lotFor(outer, lot, 0.4));
  g.add(glow(outer, { spread: 1.2, intensity: 0.9, color: '#FFB060' }), glow(ring, { spread: 1.4, intensity: 1.0, color: '#FFB060' }));
  g.add(glow(ent, { spread: 1.4, intensity: 1.3, color: '#FFB060' }));
  g.add(makeNeonLine(offsetOutline(ring, 0.05), [0.2], { color: '#FFB060', height: 0.1, glow: 0.35, intensity: 1.8, glowOpacity: 0.42 }));
  g.add(makeNeonLine(offsetOutline(outer, 0.05), [0.2], { color: '#FFB060', height: 0.1, glow: 0.3, intensity: 1.6, glowOpacity: 0.38 }));
  g.add(makeTrees(refPts(slot, [
    [1086, 300, 0.85], [1088, 330, 0.8], [1092, 360, 0.85], [1100, 385, 0.8], [1124, 388, 0.75], [1088, 266, 0.8], [1122, 244, 0.7],
    [1222, 300, 0.75], [1226, 330, 0.7], [1224, 360, 0.75], [1214, 384, 0.7], [1200, 280, 0.7], [1176, 262, 0.65],
  ]), { seed: 23 }));
  g.add(makeLamps(refPts(slot, [[1090, 314], [1094, 372], [1140, 390], [1180, 388], [1224, 346], [1208, 284], [1110, 246]]).map((p) => [p.x, p.z])));
  place(ctx, slot, g, 0, 0);
}

// ------------------------------------------------------------------------------------------
// database (deg 126). Drawn in reference space: a softly rounded block of about 3 storeys (spline) with a
// dark framed-glazing left face, a white rounded near-corner pier over a glass lobby, warm ribbons on the right
// face under a deep overhanging roof slab, a single low drum ring on the flat deck under the badge, a flat
// ledge with an angled cut at the right, and a small, low, pale rear wing behind to the left.
// ------------------------------------------------------------------------------------------
let _dbDrum, _dbDisc, _dbBack, _dbLedge, _dbDeck;
const dbDeck = () => (_dbDeck ||= new THREE.MeshLambertMaterial({ color: '#3C4270', map: MAT.roof.map, emissive: '#0E1230', emissiveIntensity: 1 }));
const dbBackDeck = () => (_dbBack ||= new THREE.MeshLambertMaterial({ color: '#8C8EAC', map: MAT.roof.map, emissive: '#1C1E30', emissiveIntensity: 1 }));
function buildDatabase(ctx, slot) {
  const g = new THREE.Group();
  const M = shellMats();
  const lobbyH = 1.55, floorH = 1.2, H = lobbyH + 2 * floorH + 0.62;
  // compact block seen corner-on (4x reference roof line at roof height): the white pier faces the viewer at
  // about x 511, the dark-glazed left face runs up-left from it, the warm right face runs up-right
  const main = refSpline(slot, [
    [466, 175, 'back'], [490, 166, 'back'], [545, 161, 'back'], [563, 160, 'back'], [586, 163, 'right'], [593, 172, 'right'], [594, 189, 'right'],
    [589, 200, 'fr'], [556, 211, 'fr'], [527, 220, 'pier'], [513, 224, 'pier'], [499, 222, 'fl'], [478, 216, 'left'], [460, 209, 'left'],
    [455, 199, 'left'], [456, 185, 'left'],
  ], H + 0.3);
  const A = block(main, {
    seed: 71, lobbyH, floors: 2, floorH, windows: 'dim', piers: false, fins: 1.25, finW: 0.18, finSides: ['fl', 'left'], slabT: 0.3, slabOut: 0.2, glassIn: 0.32,
    roofT: 0.62, lipOut: 0.62, columns: false, lobbyInset: 0.6, roof: { deck: dbDeck() }, parapetW: 0.95, parapetH: 0.3,
    lobby: { style: 'lobby', sides: ['fr', 'right', 'fl'], map: { left: 'night' }, wall: ['back', 'pier'] },
    bands: [{ sides: ['pier'], style: 'wall' }, { sides: ['fr', 'right'], style: 'warm' }, { sides: ['fl', 'left'], style: 'night' }],
  });
  g.add(A.group);
  // white rounded corner pier where the two faces meet: full height, proud of both faces, framed windows,
  // warm glow at its base and a recessed lit glass entrance at its foot
  {
    const [px, pz] = refXZ(slot, 512, 226, H);
    const cx = main.pts.reduce((s, p) => s + p[0], 0) / main.pts.length, cz = main.pts.reduce((s, p) => s + p[1], 0) / main.pts.length;
    let nx = px - cx, nz = pz - cz; const L = Math.hypot(nx, nz); nx /= L; nz /= L;
    const R = 1.45, ox = px - nx * (R - 0.5), oz = pz - nz * (R - 0.5);
    const cg = new THREE.CylinderGeometry(R, R, H - 0.15 - lobbyH * 0.55, 36); cg.translate(ox, lobbyH * 0.55 + (H - 0.15 - lobbyH * 0.55) / 2, oz);
    g.add(new THREE.Mesh(cg, M.slab));
    // glass lobby drum under the pier
    const lg = new THREE.CylinderGeometry(R - 0.25, R - 0.25, lobbyH * 0.55, 36, 1, true); lg.translate(ox, lobbyH * 0.275, oz);
    g.add(new THREE.Mesh(lg, glassMat('lobby', 79)));
    const ang = Math.atan2(nx, nz), wins = [], dark = [];
    for (let f = 0; f < 2; f++) for (const da of [-0.6, 0, 0.6]) {
      const t = ang + da, b = new THREE.BoxGeometry(0.46, floorH * 0.55, 0.12); b.rotateY(t);
      b.translate(ox + Math.sin(t) * (R + 0.01), lobbyH + f * floorH + floorH * 0.55, oz + Math.cos(t) * (R + 0.01));
      ((f + (da > 0 ? 1 : 0)) % 2 ? dark : wins).push(b);
    }
    g.add(mergedMesh(wins, glassMat('lobby', 78)), mergedMesh(dark, M.porthole));
    const ring = []; for (let k = 0; k <= 32; k++) { const t = ang + (k / 32 - 0.5) * 2.6; ring.push([ox + Math.sin(t) * (R + 0.03), oz + Math.cos(t) * (R + 0.03)]); }
    g.add(makeNeonLine(ring, [lobbyH * 0.55 + 0.05], { color: '#FFC070', height: 0.12, glow: 0.4, intensity: 1.9, glowOpacity: 0.45 }));
      }
  // small, low, pale rear wing behind to the left: sparse warm windows, light deck, a few units
  const back = refSpline(slot, [
    [447, 149, 'back'], [478, 141, 'back'], [503, 138, 'right'], [507, 146, 'right'], [500, 158, 'front'], [472, 165, 'front'], [449, 169, 'left'], [444, 160, 'left'],
  ], 2.9);
  const B = block(back, {
    floors: 1, seed: 73, floorH: 1.0, lobbyH: 1.3, lobbyInset: 0.35, roofT: 0.4, parapetH: 0.22, parapetW: 0.28, windows: 'dim', fins: 1.3,
    slabOut: 0.12, glassIn: 0.14, columns: false, piers: false, roof: { deck: dbBackDeck() }, roofEdge: '#FFD49A', lobby: { style: 'lobby', sides: ['left', 'front'] },
  });
  g.add(B.group);
  g.add(makeRoofDetails(refPts(slot, [[456, 154], [472, 150], [488, 146], [498, 150], [462, 162]], B.top).map((p, i) => ({ type: i % 2 ? 'ac' : 'vent', rot: 36, ...p })), B.top));
  // single low drum ring on the flat deck: pale lavender wall with a lit rim, a dark blue court inside with a
  // thin inner ring line
  _dbDrum ||= new THREE.MeshLambertMaterial({ color: '#8E94C8', map: MAT.roof.map, emissive: '#222850', emissiveIntensity: 1 });
  _dbDisc ||= new THREE.MeshLambertMaterial({ color: '#1E3A9C', emissive: '#0E2470', emissiveIntensity: 1 });
  const e = refEllipse(slot, 520, 182, 38, 20, A.top + 0.95);
  const D = makeTier(e, A.top, 0.9, { band: null, deck: _dbDisc, rim: 0.4, rimH: 0.22 });
  g.add(D.group);
  g.add(makeNeonLine(offsetOutline(e, 0.07), [D.top + 0.16], { color: '#BFD8FF', height: 0.06, glow: 0.22, intensity: 1.6, glowOpacity: 0.34 }));
  g.add(makeNeonLine(refEllipse(slot, 519, 181, 29, 14, D.top), [D.top + 0.04], { color: '#9FC4FF', height: 0.04, glow: 0.14, intensity: 1.4, glowOpacity: 0.24 }));
  g.add(makeSeams([refPts(slot, [[498, 186], [512, 192], [530, 190]], D.top).map((p) => [p.x, p.z])], D.top + 0.01, 0.04, MAT.seamLight));
  // flat ledge on the right of the deck with an angled cut at the back-right corner (slightly raised plate)
  _dbLedge ||= new THREE.MeshLambertMaterial({ color: '#A8B0E0', map: MAT.roof.map, emissive: '#262C50', emissiveIntensity: 1 });
  const ledge = refPoly(slot, [[556, 166, 0.2], [574, 165, 0], [586, 174, 0.2], [586, 194, 0.4], [560, 202, 0.4], [554, 186, 0.3]], A.top + 0.2);
  g.add(new THREE.Mesh(extrudeOutline(ledge, A.top, A.top + 0.2, { bevel: 0.04 }), [_dbLedge, M.slab]));
  g.add(makeNeonLine(offsetOutline(ledge, 0.03), [A.top + 0.18], { color: '#E8ECFF', height: 0.04, glow: 0.14, intensity: 1.2, glowOpacity: 0.22 }));
  g.add(makeRoofDetails(refPts(slot, [[564, 172], [576, 172], [570, 186], [580, 186], [566, 196]], A.top + 0.2).map((p, i) => ({ type: ['vent', 'ac', 'skylight'][i % 3], w: 0.45, d: 0.35, rot: 36, ...p })), A.top + 0.2));
  g.add(makeRoofDetails(refPts(slot, [[468, 196], [470, 184], [480, 206], [540, 210], [488, 172], [548, 168], [536, 206]], A.top).map((p, i) => ({ type: i % 2 ? 'ac' : 'vent', w: 0.5, d: 0.4, rot: 36, ...p })), A.top));
  const [bx, bz] = refXZ(slot, 520, 160, D.top + 2.4);
  addBadge(g, slot, bx, bz, D.top, D.top + 2.4, 4.4, 3.3);

  const lot = refPoly(slot, [[438, 128, 2.4], [560, 118, 2.4], [612, 190, 2.4], [604, 236, 2.4], [512, 268, 2.4], [446, 240, 2.4]], 0);
  g.add(lotFor(main, lot, 0.6));
  g.add(glow(main, { spread: 1.6, intensity: 1.15, color: '#FFB060' }), glow(back, { spread: 1.1, intensity: 0.8, color: '#FFB060' }));
  g.add(makeNeonLine(offsetOutline(main, 0.05), [0.2], { color: '#FFB060', height: 0.1, glow: 0.3, intensity: 1.7, glowOpacity: 0.38 }));
  g.add(makeTrees(refPts(slot, [
    [444, 220, 0.9], [452, 240, 0.85], [470, 254, 0.8], [600, 226, 0.85], [606, 204, 0.8], [578, 242, 0.8],
    [440, 186, 0.85], [530, 134, 0.75], [560, 130, 0.8], [600, 168, 0.75], [520, 128, 0.7], [440, 150, 0.7],
  ]), { seed: 24 }));
  g.add(makePlanters(refPts(slot, [[540, 240]]).map((p) => ({ ...p, w: 2.0, d: 0.5, rot: 36 }))));
  g.add(makeLamps(refPts(slot, [[460, 248], [500, 264], [545, 254], [590, 236], [610, 184], [440, 204]]).map((p) => [p.x, p.z])));
  place(ctx, slot, g, 0, 0);
}

// ------------------------------------------------------------------------------------------
// models (deg 162). Drawn in reference space: an asymmetric teardrop plan (spline) tapering to a rounded nose
// at the lower left. Front: warm ribbon storeys between thick slabs over a dark lobby; a white corner pier with
// portholes; continuous blue glazing ribbons on the right face. Dark slate roof with an inner white rail, a
// smaller magenta pod (badge) toward the upper right in front of a dark framed court, a dark green planter in the nose.
// ------------------------------------------------------------------------------------------
let _mdDeck, _mdFrame, _mdPlant;
function buildModels(ctx, slot) {
  const g = new THREE.Group();
  const M = shellMats();
  const lobbyH = 2.35, floorH = 1.5, H = lobbyH + 2 * floorH + 0.7;
  // asymmetric teardrop / shield plan (spline through the 4x reference roof line): a short top edge, a long
  // diagonal left side tapering to a rounded nose at the lower left, a broad front, a receding right face
  const main = refSpline(slot, [
    [367, 254, 'back'], [392, 254, 'back'], [405, 259, 'back'], [435, 275, 'fr'], [446, 287, 'fr'], [445, 302, 'fr'], [431, 331, 'fr'],
    [418, 349, 'pier'], [404, 354, 'front'], [380, 355, 'front'], [330, 352, 'front'], [310, 346, 'left'], [308, 336, 'left'],
    [317, 318, 'left'], [342, 282, 'left'], [358, 261, 'left'],
  ], H + 0.3);
  _mdDeck ||= new THREE.MeshLambertMaterial({ color: '#4C5376', map: MAT.roof.map, emissive: '#11152A', emissiveIntensity: 1 });
  const A = block(main, {
    seed: 81, lobbyH, floorH, windows: 'night', columns: false, lobbyInset: 0.7, piers: false, fins: 0, roofT: 0.7,
    slabT: 0.56, glassIn: 0.2, slabOut: 0.2, roof: { deck: _mdDeck }, parapetW: 0.5, parapetH: 0.34, roofEdge: '#E2C8FF',
    lobby: { style: 'dim', sides: ['front', 'fr'], map: { fr: 'blue' }, wall: ['back', 'pier'] },
    bands: [{ sides: ['pier'], style: 'wall' }, { sides: ['fr'], style: 'blue' }, { sides: ['front', 'left'], style: 'streak' }],
    portholes: { every: 0.9, r: 0.22, color: '#7FC8FF', sides: ['pier'] },
  });
  g.add(A.group);
  // warm interior strips glowing through the dark lobby glass
  g.add(makeNeonLine(refPoly(slot, [[318, 389, 0], [408, 391, 0]], 0.6).pts, [0.55], { color: '#FFB060', height: 0.06, glow: 0.2, intensity: 1.5, glowOpacity: 0.3 }));

  // inner white rail following the roof contour inside the thick lip, dark track outside it
  const chO = offsetOutline(main, -0.8), chI = offsetOutline(main, -1.5);
  g.add(new THREE.Mesh(extrudeOutline(chO, A.top - 0.01, A.top + 0.03, { holes: [chI] }), M.deckDark));
  g.add(new THREE.Mesh(extrudeOutline(chI, A.top - 0.01, A.top + 0.16, { holes: [offsetOutline(chI, -0.22)], bevel: 0.03 }), M.slab));

  // dark frame behind the pod (upper right): raised white rim round a dark court
  _mdFrame ||= new THREE.MeshLambertMaterial({ color: '#2A2F58', emissive: '#0E1128', emissiveIntensity: 1 });
  const frame = refSpline(slot, [[362, 256, 'a'], [420, 264, 'a'], [434, 276, 'a'], [436, 290, 'a'], [372, 290, 'a']], A.top + 0.5);
  const F = makeTier(frame, A.top, 0.45, { band: null, deck: _mdFrame, rim: 0.4, rimH: 0.18 });
  g.add(F.group);
  // raised magenta pod (badge deck), smaller and set to the upper right; dark band, glowing violet rim
  const pod = refSpline(slot, [[341, 286, 'a'], [370, 281, 'a'], [404, 284, 'a'], [412, 293, 'a'], [412, 316, 'a'], [404, 322, 'a'], [357, 324, 'a'], [342, 320, 'a'], [338, 305, 'a']], A.top + 1.25);
  const T = makeTier(pod, A.top, 1.2, { band: 'night', seed: 85, deck: deckMats().magenta, rim: 0.28, rimH: 0.2, bandFrom: 0.22, bandTo: 0.72 });
  g.add(T.group);
  g.add(makeNeonLine(offsetOutline(pod, 0.08), [T.top + 0.14], { color: '#C890FF', height: 0.07, glow: 0.24, intensity: 1.6, glowOpacity: 0.36 }));
  // dark green planter tucked into the left nose (no water)
  _mdPlant ||= new THREE.MeshLambertMaterial({ color: '#4A8A3A', emissive: '#16381A', emissiveIntensity: 1 });
  const terr = refSpline(slot, [[320, 318, 'a'], [333, 315, 'a'], [343, 324, 'a'], [354, 333, 'a'], [353, 341, 'a'], [330, 344, 'a'], [316, 337, 'a']], A.top);
  g.add(new THREE.Mesh(extrudeOutline(offsetOutline(terr, -0.16), A.top - 0.01, A.top + 0.1), _mdPlant));
  g.add(new THREE.Mesh(extrudeOutline(terr, A.top - 0.01, A.top + 0.22, { holes: [offsetOutline(terr, -0.16)] }), M.slab));
  g.add(makeTrees(refPts(slot, [[324, 324, 0.4], [348, 336, 0.36], [322, 338, 0.3], [338, 322, 0.32]], A.top).map((t) => ({ ...t, y: A.top + 0.08 })), { seed: 13, colors: ['#2F6A2C', '#3A7A32', '#285E28'] }));
  g.add(makeRoofDetails(refPts(slot, [[420, 300], [430, 318], [425, 336], [380, 343], [404, 341], [358, 342], [318, 343]], A.top).map((p, i) => ({ type: i % 3 === 1 ? 'ac' : 'vent', w: 0.5, d: 0.4, ...p })), A.top));
  g.add(makeSeams([refPts(slot, [[322, 345], [380, 347], [432, 340]], A.top).map((p) => [p.x, p.z])], A.top + 0.01, 0.05, MAT.seamLight));
  // small round dark-teal reflecting disc set in the planter (reference: blue circle inside the green nose)
  {
    const [cx, cz] = refXZ(slot, 333, 334, A.top);
    const disc = new THREE.CylinderGeometry(0.5, 0.5, 0.08, 28); disc.translate(cx, A.top + 0.12, cz);
    const rim = new THREE.TorusGeometry(0.55, 0.07, 6, 28); rim.rotateX(Math.PI / 2); rim.translate(cx, A.top + 0.16, cz);
    g.add(new THREE.Mesh(disc, new THREE.MeshLambertMaterial({ color: '#1C4A6A', emissive: '#0E3A5C', emissiveIntensity: 1.2 })), new THREE.Mesh(rim, M.slab));
  }
  // extra rooftop units along the right edge and behind the pod (reference: dense small equipment)
  g.add(makeRoofDetails(refPts(slot, [[372, 262], [392, 262], [440, 296], [436, 312], [318, 338], [366, 345], [392, 347], [412, 340]], A.top).map((p, i) => ({ type: ['vent', 'ac', 'skylight'][i % 3], w: 0.45, d: 0.35, ...p })), A.top));
  const [bx, bz] = refXZ(slot, 377, 286, A.top + 3.0);
  addBadge(g, slot, bx, bz, T.top, A.top + 3.0, 4.4, 4.4);

  const lot = refPoly(slot, [[300, 244, 2.4], [455, 250, 2.4], [462, 395, 2.4], [298, 395, 2.4]], 0);
  g.add(lotFor(main, lot, 0.9));
  g.add(glow(main, { spread: 1.6, intensity: 1.05, color: '#FFB060' }));
  g.add(makeNeonLine(offsetOutline(main, 0.05), [0.2], { color: '#FFB060', height: 0.1, glow: 0.3, intensity: 1.7, glowOpacity: 0.38 }));
  g.add(makeTrees(refPts(slot, [
    [304, 300, 0.85], [306, 262, 0.8], [330, 250, 0.8], [450, 260, 0.75], [458, 330, 0.85], [455, 370, 0.85],
    [440, 392, 0.8], [400, 395, 0.8], [350, 395, 0.85], [305, 392, 0.8], [302, 340, 0.8],
  ]), { seed: 25 }));
  g.add(makeLamps(refPts(slot, [[300, 320], [320, 396], [375, 397], [430, 396], [460, 350], [458, 280]]).map((p) => [p.x, p.z])));
  place(ctx, slot, g, 0, 0);
}

const BUILDERS = { 'models-box': buildModelsBox, cloud: buildCloud, gear: buildGear, database: buildDatabase, models: buildModels };

export default function build(ctx) {
  for (const [id, fn] of Object.entries(BUILDERS)) {
    const slot = ctx.layout.BUILDINGS.find((b) => b.id === id);
    if (!slot) continue;
    try { fn(ctx, slot); } catch (err) { console.error(`[outerNorth] ${id} failed`, err); }
  }
}
