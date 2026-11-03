// Knowledge building (slot 'knowledge', deg 45). Reference dashboard.png ~ (865,252) -> (990,385), sheet sec 5.
// An asymmetric curved WEDGE, not a capsule: a squarish NW end (rounded outer corners), a nearly straight NE
// back edge, a gently convex SW front facing the core, and a broad square-cut SE end face (about as wide as
// the building is deep) that faces the camera.
//  - SW front: glass-dominant ribbon glazing (dark warm spandrels, vertical mullions, warm light pools that vary
//    along the length) over the hottest, tallest band: the lit lobby.
//  - SE end: a deep dark navy glass bay recessed inside a thick rounded lavender frame. Upper row: soft blue
//    screens. Lower row: blue screens mixed with warm orange panels, and a warm-lit door at the SW corner.
//  - Roof: a flat grey-lavender deck (bright at the NW, darker toward the SE) with panel seams, a thin crisp
//    parapet with a dark inner gutter line, a raised light strip on the NE rim near the NW corner, a dark
//    full-width inset band behind the end frame and a dark rooftop unit over the SW corner of the end.
//  - Floating solid blue document badge over the NW part of the roof (screen ~ (916,281)).
//  - Warm orange light on the paving at the end face and along the SW base.
// Road limits (roads.js): the one-way forecourt lane r 16.1..17.3 in front, and the 22.5 deg inner spoke beside
// the SE end. The reference end sits further SE / lower on screen than our spoke allows, so the end face is
// placed parallel to the spoke, as close as it can go.
import * as THREE from 'three';
import {
  sectorPoint, makeBlock, makeSeams, makeBaseGlow, makeBadge, makeLot, makeTrees, makePlanters, makeLamps,
  placeBuilding, offsetOutline, ribbon, glowMaterial, BADGE_SIZE, polyOutline, extrudeOutline, makeNeonLine,
  mergedMesh, makeGlowPoints, flatBand, curveOutline,
} from './kit.js';

const D2R = Math.PI / 180;
const R = 22; // slot radius: the core is at local (0, R)
// SE end line: parallel to the 22.5 deg spoke, END_D from its centre line (spoke half width 1.1 + overhang + frame)
const SPOKE = 22.5 * D2R, END_D = 2.1;
const endPt = (s) => [Math.sin(SPOKE) * s - Math.cos(SPOKE) * END_D, R - Math.cos(SPOKE) * s - Math.sin(SPOKE) * END_D];
// Camera 11-01 (elev 53.85, dist 279.6, fov 20): reference roof points unprojected to local coords give a fan-
// shaped wedge, ~8 units deep at the middle: the NE back bows out to z ~ -3.2 (screen top edge y ~ 251).
const A = [-6.5, -1.5];     // NW back corner (reference roof apex, screen ~ (890,252))
const B = [-4.1, 4.3];      // NW front corner (kept outside the forecourt lane r 16.1..17.3)
const C = endPt(17.9);      // SE front corner (bullnose)
const D = endPt(23.3);      // SE back corner
const BACK_BOW = 1.6, FRONT_BOW = 0.22;
const LOBBY_H = 0.95, FLOORS = 3, FLOOR_H = 0.92, WALL_TOP = LOBBY_H + FLOORS * FLOOR_H; // 3.71
const ROOF_THICK = 0.3, OVERHANG = 0.28, PARAPET_H = 0.2, PARAPET_W = 0.18;

// quadratic bow between two points (+bulge = to the left of p0 -> p1)
function bowed(p0, p1, bulge, n) {
  const dx = p1[0] - p0[0], dz = p1[1] - p0[1], L = Math.hypot(dx, dz), nx = dz / L, nz = -dx / L;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, b = bulge * 4 * t * (1 - t);
    return [p0[0] + dx * t + nx * b, p0[1] + dz * t + nz * b];
  });
}

// ---- SE end bay texture (canvas x = 0 is the BACK / NE end, x = W the FRONT / SW corner) ------------------
// Rows (canvas y, top = high): upper screen row, transom (hidden behind the frame bar), lower row with door.
const BAY = { W: 768, H: 640, upper: [0, 262], lower: [346, 640] };
let _endTex = null;
function endTextures() {
  if (_endTex) return _endTex;
  const { W, H } = BAY;
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const ca = mk(), ce = mk(), a = ca.getContext('2d'), e = ce.getContext('2d');
  a.fillStyle = '#1E2A48'; a.fillRect(0, 0, W, H);
  // deep navy glass with a faint vertical sheen
  const bg = e.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0C1634'); bg.addColorStop(0.5, '#0A1430'); bg.addColorStop(1, '#0E1836');
  e.fillStyle = bg; e.fillRect(0, 0, W, H);
  const blue = (k) => `rgba(70,150,255,${k})`, ice = (k) => `rgba(150,215,255,${k})`;
  const soft = (x, y, w, h, col, k) => { // soft glowing rectangle (screen light)
    const g = e.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, `rgba(${col},${0.55 * k})`); g.addColorStop(0.5, `rgba(${col},${k})`); g.addColorStop(1, `rgba(${col},${0.6 * k})`);
    e.fillStyle = g; e.beginPath(); e.roundRect(x, y, w, h, 10); e.fill();
  };
  // soft bloom-friendly screen light (no text glyphs: at this distance the reference screens read as soft
  // glowing blue rectangles with a brighter core)
  const screenGlow = (x, y, w, h, k) => {
    const cx = x + w * (0.4 + 0.2 * ((k * 37) % 10) / 10), cy = y + h * 0.5;
    const rg = e.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.6);
    rg.addColorStop(0, ice(1)); rg.addColorStop(0.45, blue(0.85)); rg.addColorStop(1, blue(0.3));
    e.fillStyle = rg; e.beginPath(); e.roundRect(x + 6, y + 6, w - 12, h - 12, 8); e.fill();
  };
  // upper row: 4 soft blue screens on the navy band
  {
    const [y0, y1] = BAY.upper, m = 30, gap = 22, sw = (W - 2 * m - 3 * gap) / 4, sy = y0 + 46, sh = (y1 - y0) - 80;
    for (let i = 0; i < 4; i++) {
      const x = m + i * (sw + gap);
      a.fillStyle = '#16284E'; a.fillRect(x, sy, sw, sh);
      soft(x, sy, sw, sh, '50,130,255', 0.75);
      e.strokeStyle = blue(0.6); e.lineWidth = 3; e.strokeRect(x + 2, sy + 2, sw - 4, sh - 4);
      screenGlow(x, sy, sw, sh, i);
    }
    // soft cool glow at the head of the row
    const hg = e.createLinearGradient(0, y0, 0, y0 + 40); hg.addColorStop(0, blue(0.35)); hg.addColorStop(1, blue(0));
    e.fillStyle = hg; e.fillRect(0, y0, W, 40);
  }
  // lower row: blue screens + 3 warm orange lobby panels, warm door at the SW (x = W) corner, warm floor line
  {
    const [y0, y1] = BAY.lower, sy = y0 + 30, sh = 200;
    const cells = [[24, 150, 'b', 1], [190, 110, 'o'], [316, 120, 'b', 3], [452, 92, 'o'], [560, 70, 'b', 2]];
    for (const [x, w, kind, gk] of cells) {
      if (kind === 'b') {
        a.fillStyle = '#16284E'; a.fillRect(x, sy, w, sh);
        soft(x, sy, w, sh, '50,130,255', 0.7);
        e.strokeStyle = blue(0.55); e.lineWidth = 3; e.strokeRect(x + 2, sy + 2, w - 4, sh - 4);
        screenGlow(x, sy, w, sh, gk);
      } else {
        a.fillStyle = '#7A5030'; a.fillRect(x, sy + 40, w, sh - 20);
        const g = e.createLinearGradient(0, sy + 40, 0, sy + sh + 20);
        g.addColorStop(0, 'rgba(255,159,28,0.75)'); g.addColorStop(0.6, 'rgba(255,190,90,0.95)'); g.addColorStop(1, 'rgba(255,240,179,1)');
        e.fillStyle = g; e.beginPath(); e.roundRect(x, sy + 40, w, sh - 20, 8); e.fill();
      }
    }
    // the warm-lit doorway at the SW corner (screen-left on the end face)
    const dx = W - 120, dw = 104, dy = y0 + 60;
    a.fillStyle = '#8A6040'; a.fillRect(dx, dy, dw, y1 - dy);
    const dg = e.createLinearGradient(0, dy, 0, y1);
    dg.addColorStop(0, 'rgba(255,170,60,0.9)'); dg.addColorStop(0.5, 'rgba(255,214,140,1)'); dg.addColorStop(1, 'rgba(255,246,220,1)');
    e.fillStyle = dg; e.fillRect(dx, dy, dw, y1 - dy);
    e.fillStyle = 'rgba(60,24,6,0.8)'; e.fillRect(dx + dw / 2 - 2, dy, 4, y1 - dy); // door split
    // warm light rising from the floor along the whole bay
    const fg = e.createLinearGradient(0, y1 - 90, 0, y1);
    fg.addColorStop(0, 'rgba(255,150,40,0)'); fg.addColorStop(0.7, 'rgba(255,140,30,0.35)'); fg.addColorStop(1, 'rgba(255,170,70,0.7)');
    e.fillStyle = fg; e.fillRect(0, y1 - 90, W, 90);
  }
  const tex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  _endTex = { map: tex(ca), emissiveMap: tex(ce) };
  return _endTex;
}

export default function build(ctx) {
  const slot = ctx.layout.BUILDINGS.find((b) => b.id === 'knowledge');
  const P = (rho, a) => sectorPoint(R, rho, a);
  const XZ = (rho, a) => { const p = P(rho, a); return [p.x, p.z]; };
  const g = new THREE.Group();

  // ---- footprint: wedge A (NW back) -> D (SE back) -> C (SE front) -> B (NW front) ------------------------
  const backPts = bowed(A, D, BACK_BOW, 14);     // strongly convex NE back (arc around the core)
  const frontPts = bowed(C, B, FRONT_BOW, 10);    // gently convex SW front (stays clear of the forecourt lane)
  const pts = [...backPts, ...frontPts];
  const radii = pts.map(() => 0);
  radii[0] = 1.25;                                // A: NW back corner: the one rounded outer corner
  radii[backPts.length - 1] = 0.45;               // D: SE back corner (square-cut end)
  radii[backPts.length] = 1.0;                   // C: SE front bullnose
  radii[pts.length - 1] = 0.8;                   // B: NW front corner (rounded, reference)
  const tags = pts.map((_, i) => (i < backPts.length - 1 ? 'back' : i === backPts.length - 1 ? 'right' : i < pts.length - 1 ? 'front' : 'left'));
  const main = polyOutline(pts, radii, { tags, step: 0.14 });

  const glazed = ['back', 'front', 'left'];
  const trimMat = new THREE.MeshLambertMaterial({ color: '#F0EEFF', emissive: '#56547E' });
  const facadeMat = new THREE.MeshLambertMaterial({ color: '#C4C0E0', emissive: '#2A2840' });
  const Bk = makeBlock(main, {
    floors: FLOORS, floorH: FLOOR_H, lobbyH: LOBBY_H, lobbyInset: 0.22, seed: 11, bayWidth: 1.2, ledge: 0.06, ledgeH: 0.09,
    windows: { style: 'knGlass', sides: glazed }, lobby: { style: 'knLobby', sides: glazed },
    roof: { thick: ROOF_THICK, overhang: OVERHANG, parapetH: PARAPET_H, parapetW: PARAPET_W },
    materials: { trim: trimMat, facade: facadeMat },
  });
  g.add(Bk.group);
  const deck = Bk.top;                   // roof deck
  const rimTop = deck + PARAPET_H;       // parapet top
  const slab = offsetOutline(main, OVERHANG);
  // thin warm floor lines at each ledge (front glazing reads as stacked lit floors)
  g.add(makeNeonLine(offsetOutline(main, 0.06), [LOBBY_H + FLOOR_H, LOBBY_H + 2 * FLOOR_H], { color: '#FFD9A8', height: 0.025, glow: 0.08, intensity: 1.2, glowOpacity: 0.18 }));

  // ---- SE end frame: E(m, d) = along the end face from D (m = 0) to C (m = L), d = outward ---------------
  const ex = C[0] - D[0], ez = C[1] - D[1], L = Math.hypot(ex, ez);
  const tx = ex / L, tz = ez / L;
  let nx = -tz, nz = tx;
  { const c = [(C[0] + D[0]) / 2, (C[1] + D[1]) / 2]; if (nx * (-c[0]) + nz * (2 - c[1]) > 0) { nx = -nx; nz = -nz; } } // away from the body
  const E = (m, d) => [D[0] + tx * m + nx * d, D[1] + tz * m + nz * d];
  const rect = (m0, m1, d0, d1) => [E(m0, d0), E(m1, d0), E(m1, d1), E(m0, d1)];
  const G0 = 0.45, G1 = L - 0.78;               // glass bay span (between the frame posts)
  const GD = 0.24;                              // glass plane: in front of the block's floor ledges (0.15)
  const FOUT = 0.66;                            // frame face: the bay sits ~0.56 deep inside it
  const GB = 0.2, GT = WALL_TOP - 0.46, TR0 = 1.6, TR1 = 2.0; // glass bottom/top, transom
  {
    const frameMat = new THREE.MeshLambertMaterial({ color: '#E2E0F8', emissive: '#4C4A7A' });
    const fr = [], tb = [];
    // head beam: thick lip continuous with the roof slab
    fr.push(extrudeOutline(polyOutline(rect(0.12, L - 0.25, -0.3, FOUT), [0.2, 0.3, 0.3, 0.2]), GT, deck + 0.02, { bevel: 0.06 }));
    // back post (NE) and the thick rounded front post (SW corner)
    fr.push(extrudeOutline(polyOutline(rect(0.1, G0, -0.3, FOUT), [0.18, 0.12, 0.12, 0.18]), 0, GT + 0.05, { bevel: 0.03 }));
    fr.push(extrudeOutline(polyOutline(rect(G1, L - 0.1, -0.45, FOUT), [0.12, 0.35, 0.35, 0.12]), 0, GT + 0.05, { bevel: 0.03 }));
    // transom bar between the rows, and the sill
    tb.push(extrudeOutline(polyOutline(rect(G0 - 0.02, G1 + 0.02, -0.1, GD + 0.1), 0.06), TR0, TR1, { bevel: 0.02 }));
    tb.push(extrudeOutline(polyOutline(rect(G0, G1, -0.2, GD + 0.14), 0.05), 0, GB, { bevel: 0.02 })); // slim dark sill
    g.add(mergedMesh(fr, frameMat));
    g.add(mergedMesh(tb, new THREE.MeshLambertMaterial({ color: '#9C9CC6', emissive: '#2A2A50' })));
    // the recessed glass bay
    const { map, emissiveMap } = endTextures();
    const glass = new THREE.MeshLambertMaterial({ map, emissiveMap, emissive: '#FFFFFF', emissiveIntensity: 1.4 });
    g.add(new THREE.Mesh(ribbon([E(G0, GD), E(G1, GD)], GB, GT, { uScale: G1 - G0 }), glass));
    // dark navy reveal walls inside the frame (depth)
    const reveal = new THREE.MeshLambertMaterial({ color: '#1E2A48', emissive: '#0A1028', side: THREE.DoubleSide });
    g.add(mergedMesh([
      ribbon([E(G0, GD - 0.01), E(G0, FOUT - 0.02)], GB, GT),
      ribbon([E(G1, FOUT - 0.02), E(G1, GD - 0.01)], GB, GT),
    ], reveal));
  }
  // soft cool line under the head beam, hot warm line along the sill, warm fixtures at the foot
  g.add(makeNeonLine([E(G0, GD + 0.08), E(G1, GD + 0.08)], [GT - 0.05], { color: '#9CC8FF', height: 0.03, glow: 0.14, intensity: 1.2, glowOpacity: 0.25 }));
  g.add(makeNeonLine([E(0.2, FOUT + 0.06), E(L - 0.2, FOUT + 0.06)], [0.07], { color: '#FF9F1C', height: 0.06, glow: 0.35, intensity: 2.0, glowOpacity: 0.55 }));
  {
    const pts2 = [];
    for (let i = 0; i <= 4; i++) { const p = E(0.5 + ((L - 1.0) * i) / 4, FOUT + 0.35); pts2.push([p[0], 0.18, p[1]]); }
    const dp = E(L - 1.3, FOUT + 0.3); pts2.push([dp[0], 0.35, dp[1]]); // door spill
    g.add(makeGlowPoints(pts2, '#FFB060', 0.9, 0.95));
  }

  // ---- roof: flat grey-lavender deck (bright NW -> darker SE), thin crisp parapet, dark gutter, seams ------
  const court = Bk.roofOutline;
  {
    const geo = extrudeOutline(court, deck - 0.01, deck + 0.015);
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
    const ax = D[0] - A[0], az = D[1] - A[1], al = ax * ax + az * az;
    const c0 = new THREE.Color('#D0D1EA'), c1 = new THREE.Color('#9C9EC0'), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, Math.max(0, ((pos.getX(i) - A[0]) * ax + (pos.getZ(i) - A[1]) * az) / al));
      c.copy(c0).lerp(c1, t); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#2E3050' })));
  }
  // parapet inner wall (darker) + a dark gutter line right inside it
  g.add(new THREE.Mesh(ribbon([...court.pts, court.pts[0]].reverse(), deck, rimTop - 0.01), new THREE.MeshLambertMaterial({ color: '#7E82AA', emissive: '#22244A' })));
  {
    const loop = (o) => [...o.pts, o.pts[0]];
    g.add(new THREE.Mesh(flatBand(loop(court), loop(offsetOutline(court, -0.13)), deck + 0.02), new THREE.MeshBasicMaterial({ color: '#3A3D60' })));
  }
  // crisp light top edge of the parapet
  g.add(makeNeonLine(offsetOutline(slab, 0.02), [rimTop - 0.04], { color: '#E8ECFF', height: 0.035, glow: 0.12, intensity: 1.05, glowOpacity: 0.2 }));
  // raised inner deck panel (reference: a second, inner rim line follows the back and front edges about
  // 0.9 inside the parapet): a thin lighter plate with a soft dark step line around it
  {
    const panel = offsetOutline(court, -0.85);
    const pg = extrudeOutline(panel, deck, deck + 0.05, { bevel: 0.02 });
    g.add(new THREE.Mesh(pg, new THREE.MeshLambertMaterial({ color: '#C8C9E4', emissive: '#30324E', transparent: true, opacity: 0.55 })));
    const loop = (o) => [...o.pts, o.pts[0]];
    g.add(new THREE.Mesh(flatBand(loop(offsetOutline(panel, 0.04)), loop(offsetOutline(panel, 0.1)), deck + 0.03), new THREE.MeshBasicMaterial({ color: '#6A6D94' })));
  }
  // panel seams: one long seam through the deck + cross joints
  {
    const lerp2 = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const back = (t) => backPts[Math.round(t * (backPts.length - 1))];
    const front = (t) => frontPts[Math.round((1 - t) * (frontPts.length - 1))];
    const seams = [];
    const long = []; for (let i = 1; i <= 15; i++) { const t = 0.04 + (0.86 * i) / 15; long.push(lerp2(back(t), front(t), 0.55)); }
    seams.push(long);
    for (const t of [0.24, 0.44, 0.62, 0.8]) seams.push([lerp2(back(t), front(t), 0.12), lerp2(back(t), front(t), 0.88)]);
    g.add(makeSeams(seams, deck + 0.012, 0.045, new THREE.MeshBasicMaterial({ color: '#5E6188' })));
  }
  // raised light strip along the NE rim near the NW corner (reference screen ~ 900..935, 252..262): follows
  // the curved back, just inside the parapet
  {
    const bp = (t, off) => { // point on the back bow at t, pushed `off` inward (toward the front)
      const dx = D[0] - A[0], dz = D[1] - A[1], Lb = Math.hypot(dx, dz), nx = dz / Lb, nz = -dx / Lb;
      const b = BACK_BOW * 4 * t * (1 - t), db = BACK_BOW * 4 * (1 - 2 * t);
      const px = A[0] + dx * t + nx * b, pz = A[1] + dz * t + nz * b;
      let tx2 = dx + nx * db, tz2 = dz + nz * db; const l = Math.hypot(tx2, tz2); tx2 /= l; tz2 /= l;
      return [px + tz2 * off, pz - tx2 * off];
    };
    const run = [], inner = [];
    for (let i = 0; i <= 14; i++) { const t = 0.1 + 0.26 * i / 14; run.push(bp(t, PARAPET_W + OVERHANG * 0 + 0.12)); inner.push(bp(t, PARAPET_W + 0.4)); }
    const body = extrudeOutline(polyOutline([...run, ...inner.slice().reverse()], 0.1), deck, deck + 0.08);
    g.add(mergedMesh([body], new THREE.MeshLambertMaterial({ color: '#D6D6F0', emissive: '#4A4A78' })));
    g.add(new THREE.Mesh(flatBand(run, inner, deck + 0.09), new THREE.MeshBasicMaterial({ color: '#E6E8FA' })));
  }
  // smooth dark recessed band across the full width just inside the end parapet: a soft-edged texture,
  // no hard geometry edges (they stair-stepped into a jagged black bar)
  {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const x = c.getContext('2d');
    const gy = x.createLinearGradient(0, 0, 0, 64);
    gy.addColorStop(0, 'rgba(42,47,69,0)'); gy.addColorStop(0.3, 'rgba(42,47,69,0.92)'); gy.addColorStop(0.7, 'rgba(36,40,60,0.95)'); gy.addColorStop(1, 'rgba(42,47,69,0)');
    x.fillStyle = gy; x.fillRect(0, 0, 256, 64);
    x.globalCompositeOperation = 'destination-in';
    const gx = x.createLinearGradient(0, 0, 256, 0);
    gx.addColorStop(0, 'rgba(0,0,0,0)'); gx.addColorStop(0.06, 'rgba(0,0,0,1)'); gx.addColorStop(0.94, 'rgba(0,0,0,1)'); gx.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gx; x.fillRect(0, 0, 256, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const w0 = 0.45, w1 = L - 0.6, d0 = -0.2, d1 = -0.85;
    const geo = new THREE.BufferGeometry();
    const q = [E(w0, d0), E(w1, d0), E(w1, d1), E(w0, d1)];
    geo.setAttribute('position', new THREE.Float32BufferAttribute(q.flatMap(([px, pz]) => [px, deck + 0.035, pz]), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 2, 1, 0, 3, 2]); geo.computeVertexNormals();
    const band = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    band.renderOrder = 1; g.add(band);
  }
  // one rounded dark equipment unit over the SW corner of the end (reference screen ~ (945,350))
  {
    const uc = E(L - 0.95, -0.75);
    const ang = Math.atan2(tx, tz);
    const R2 = (lx, lz) => [uc[0] + Math.sin(ang) * lx + Math.cos(ang) * lz, uc[1] + Math.cos(ang) * lx - Math.sin(ang) * lz];
    const unit = extrudeOutline(polyOutline([R2(-0.45, -0.32), R2(0.45, -0.32), R2(0.45, 0.32), R2(-0.45, 0.32)], 0.22), deck, deck + 0.3, { bevel: 0.06 });
    const cap = new THREE.CylinderGeometry(0.2, 0.22, 0.06, 18); cap.translate(uc[0], deck + 0.33, uc[1]);
    g.add(mergedMesh([unit], new THREE.MeshLambertMaterial({ color: '#3A3D56', emissive: '#0C0D1A' })));
    g.add(mergedMesh([cap], new THREE.MeshLambertMaterial({ color: '#23253A', emissive: '#07080F' })));
  }

  // ---- floating document badge (screen ~ (916,281): over the NW part of the roof) ----------------------
  const badge = makeBadge(slot.icon, slot.color, { size: BADGE_SIZE, halo: 1.25, haloOpacity: 0.18, ringOpacity: 0.4, roofGlowY: null });
  badge.position.set(-0.95, 6.2, 1.03); // unprojected from the reference disc centre (919,283)
  g.add(badge);
  {
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(BADGE_SIZE * 1.1, BADGE_SIZE * 1.1), glowMaterial(slot.color, 'radial', 0.08));
    pool.rotation.x = -Math.PI / 2; pool.position.set(-1.6, deck + 0.04, 0.4); pool.renderOrder = 2;
    g.add(pool);
  }

  // ---- ground ----------------------------------------------------------------------------------------
  const lot = curveOutline({
    back: [[-19.4, 29.4], [-12, 29.6], [-4, 29.5], [4, 29.3], [12, 28.9], [18.4, 28.2]].map(([a, r]) => XZ(r, a)),
    front: [[-20.2, 16.4], [-8, 16.2], [4, 16.2], [18.6, 16.4]].map(([a, r]) => XZ(r, a)),
    corners: [2.2, 1.6, 1.6, 1.6],
  });
  g.add(makeLot(main, { lot, walk: 0.45 }));
  g.add(makeBaseGlow(main, { color: '#FFB04A', spread: 1.6, height: 0.8, intensity: 0.95 }));
  // warm orange pool along the SW base (on the walkway, not the lawn)
  {
    const fr = bowed(C, B, FRONT_BOW, 16);
    const out = fr.map((p, i) => { // push toward the core (+z side of the front)
      const q = fr[Math.min(i + 1, fr.length - 1)], o = fr[Math.max(i - 1, 0)], dx = q[0] - o[0], dz = q[1] - o[1], l = Math.hypot(dx, dz) || 1;
      let ox = -dz / l, oz = dx / l; if (oz < 0) { ox = -ox; oz = -oz; }
      return [p[0] + ox * 1.1, p[1] + oz * 1.1];
    });
    const spill = new THREE.Mesh(flatBand(fr, out, 0.115), glowMaterial('#FF9F1C', 'vertical', 0.42));
    spill.renderOrder = 2; g.add(spill);
  }
  // strong warm orange pool on the paving at the end face
  {
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(L * 1.1, 3.0), glowMaterial('#FF9F1C', 'radial', 0.8));
    pool.rotation.x = -Math.PI / 2; pool.rotation.z = Math.atan2(-tz, tx);
    const c = E(L / 2, FOUT + 0.9); pool.position.set(c[0], 0.12, c[1]); pool.renderOrder = 2;
    g.add(pool);
    const hot = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.4), glowMaterial('#FFB347', 'radial', 0.55));
    hot.rotation.x = -Math.PI / 2; hot.rotation.z = Math.atan2(-tz, tx);
    const h = E(L - 1.3, FOUT + 0.6); hot.position.set(h[0], 0.13, h[1]); hot.renderOrder = 2;
    g.add(hot);
  }
  // warm uplights along the front and the driveway apron
  {
    const pts2 = [];
    const fr = bowed(C, B, FRONT_BOW, 12);
    for (let i = 1; i < fr.length - 1; i++) { const p = fr[i]; pts2.push([p[0] + 0.1, 0.18, p[1] + 0.55]); }
    for (const a of [-1.4, 1.4]) { const p = XZ(17.0, a); pts2.push([p[0], 0.15, p[1]]); }
    g.add(makeGlowPoints(pts2, '#FFB060', 0.7, 0.9));
  }

  // large round trees along the curved SW front (reference: they stand right in front of the lobby and partly
  // cover the lower facade), just core-side of the forecourt lane; the NE lawn is kept sparse
  g.add(makeTrees([
    { ...P(15.35, -12.0), s: 1.55 }, { ...P(15.3, -5.2), s: 1.7 }, { ...P(15.35, 4.6), s: 1.6 }, { ...P(15.4, 11.4), s: 1.45 },
    { ...P(17.0, -19.6), s: 1.2 }, { ...P(17.4, -23.2), s: 0.9 },
    { ...P(28.4, 15.6), s: 0.75 }, { ...P(28.6, -18.0), s: 0.7 }, { ...P(28.8, -2.0), s: 0.6 },
  ]));
  g.add(makePlanters([
    { ...P(19.4, -20.0), w: 1.1, d: 0.36, rot: 20.0 },
  ]));
  g.add(makeLamps([
    ...[-21.6, -18.4].map((a) => XZ(17.5, a)),
    ...[-15, -8, -1, 6, 13].map((a) => XZ(29.0, a)),
    XZ(25.6, 17.8), XZ(27.0, 17.0), XZ(22.8, -21.6),
  ]));

  placeBuilding(ctx, slot, g);
}
