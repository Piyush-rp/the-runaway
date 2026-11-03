// Inner ring buildings (between ring0 and ring1): hq-north, docs, code, automation, calendar, people, mail.
// Each one is a ring-following wedge / block with its own silhouette (reference + sheet sec 5):
//   hq-north   plain courtyard wedge, open lawn court with a pool, no badge
//   docs       long curved slab, sweeping rounded end, low screen terrace on the core side
//   code       tall rounded block over a lower podium, purple-lit roof
//   mail       tall block with a bulging rounded end over a podium, pink-lit roof
//   automation chamfered pentagon wedge with a raised triangular roof wing
//   people     chamfered pentagon wedge (mirrored) with a sunken triangular roof court
//   calendar   wide trapezoid with a deep lobby band, magenta-lit roof with a raised inner rim
// Built from kit.js (style template: knowledge.js); a few local helpers live below.
import * as THREE from 'three';
import {
  sectorOutline, sectorPoint, makeBlock, makeRoofCourt, makeSeams, makeRoofDetails, makeBaseGlow,
  makeBadge, makeLot, makeTrees, makePlanters, makeLamps, BADGE_SIZE, placeBuilding, offsetOutline, ribbon,
  outlineShape, extrudeOutline, glowMaterial, MAT, PALETTE, makeRng, D2R, sideRuns, makeGlowPoints, roofTexture, makeNeonLine,
  mergedMesh, curveOutline, polyOutline as kitPoly,
} from './kit.js';

// ------------------------------------------------------------------------------------------
// Local helpers
// ------------------------------------------------------------------------------------------
/**
 * Closed polygon outline with rounded corners. verts: [[x, z, tag, radius]] in kit winding order
 * (back left->right, right side back->front, front right->left, left side front->back).
 * The edge leaving vertex i takes tag verts[i][2].
 */
function polyOutline(verts, step = 0.3) {
  const pts = [], tags = [], n = verts.length;
  const at = (A, B, t) => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
  for (let i = 0; i < n; i++) {
    const A = verts[i], B = verts[(i + 1) % n], C = verts[(i + 2) % n];
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]), L2 = Math.hypot(C[0] - B[0], C[1] - B[1]);
    const t0 = Math.min((A[3] || 0) / L, 0.49), t1 = 1 - Math.min((B[3] || 0) / L, 0.49);
    const segs = Math.max(1, Math.ceil((L * (t1 - t0)) / step));
    for (let k = 0; k < segs; k++) { pts.push(at(A, B, t0 + ((t1 - t0) * k) / segs)); tags.push(A[2]); }
    const rB = B[3] || 0, p0 = at(A, B, t1), pc = [B[0], B[1]], p2 = at(B, C, Math.min(rB / L2, 0.49));
    const cs = rB > 0 ? Math.max(3, Math.ceil(rB * 5)) : 1;
    for (let k = 0; k < cs; k++) {
      const t = k / cs, u = 1 - t;
      pts.push([u * u * p0[0] + 2 * u * t * pc[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * pc[1] + t * t * p2[1]]);
      tags.push(t < 0.5 ? A[2] : B[2]);
    }
  }
  return { pts, tags };
}

let _lightCourt, _courtLawn, _courtGlass;
const courtGlass = () => (_courtGlass ||= new THREE.MeshLambertMaterial({ color: '#3A4A7E', emissive: '#121A3C', emissiveIntensity: 1 }));
const courtLawn = () => (_courtLawn ||= new THREE.MeshLambertMaterial({ color: '#2F6E33', emissive: '#0D2612', emissiveIntensity: 1 }));
// automation: mid lavender-grey court; people: vivid blue lit glass court (reference)
const wingCourt = () => cachedL('mat:wingCourt', () => new THREE.MeshLambertMaterial({ color: '#615A78', emissive: '#18142A', emissiveIntensity: 1 }));
const peopleGlass = () => cachedL('mat:peopleGlass', () => new THREE.MeshLambertMaterial({ color: '#2F5FC8', emissive: '#1A3C9E', emissiveIntensity: 1 }));
const lightCourt = () => (_lightCourt ||= new THREE.MeshLambertMaterial({ color: '#9A9CCB', emissive: '#22233E', emissiveIntensity: 1 }));

// ---- local facade glass (reference: bright warm glass panes set into a visible pale wall, not evenly lit floors)
const _tex = new Map();
const cachedL = (k, f) => (_tex.has(k) ? _tex.get(k) : (_tex.set(k, f()), _tex.get(k)));
const mixHex = (a, b, k) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();
const canvasTex = (c, srgb = true) => {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
};
const BAYS = 16;
/**
 * Facade band textures. 'win' = pale wall with a punched row of glass (most panes bright warm, some dark blue),
 * 'lobby' = full-height bright warm-white glass row with dark mullions, 'dim' = wall with sparse small lights.
 */
function glassTexture(style, seed) {
  return cachedL(`tex:${style}:${seed}`, () => {
    const bw = 64, W = BAYS * bw, H = 128;
    const ca = document.createElement('canvas'), ce = document.createElement('canvas');
    ca.width = ce.width = W; ca.height = ce.height = H;
    const a = ca.getContext('2d'), e = ce.getContext('2d');
    let s = seed * 9301 + 49297; const rng = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const wall = '#C8C4E4';
    a.fillStyle = style === 'lobby' ? '#2B2433' : wall; a.fillRect(0, 0, W, H);
    e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
    if (style === 'fins') {
      // sculpted end wall: pale vertical fins between tall dark slots with a warm glow at the foot
      a.fillStyle = wall; a.fillRect(0, 0, W, H);
      for (let i = 0; i < BAYS * 2; i++) {
        const x = i * (bw / 2) + 9, w = bw / 2 - 18, lit = rng() < 0.55;
        a.fillStyle = '#151A30'; a.fillRect(x, 14, w, 100);
        a.fillStyle = 'rgba(255,255,255,0.5)'; a.fillRect(x - 3, 14, 2, 100); // fin highlight
        if (lit) {
          const g = e.createLinearGradient(0, 14, 0, 114);
          g.addColorStop(0, '#000'); g.addColorStop(0.55, mixHex('#000', '#FFA040', 0.35)); g.addColorStop(1, mixHex('#000', '#FFB860', 0.9));
          e.fillStyle = g; e.fillRect(x, 14, w, 100);
        }
      }
      return { map: canvasTex(ca), emissiveMap: canvasTex(ce) };
    }
    if (style === 'blue') {
      // recessed dark blue curtain glass (setback floor under a hovering roof: mail / code)
      a.fillStyle = '#121C40'; a.fillRect(0, 0, W, H);
      for (let i = 0; i < BAYS * 2; i++) {
        const x = i * (bw / 2);
        a.fillStyle = '#0E1838'; a.fillRect(x, 0, 2, H);
        const g = e.createLinearGradient(0, 0, 0, H);
        const k = 0.2 + rng() * 0.2;
        g.addColorStop(0, mixHex('#000', '#3F6CFF', k)); g.addColorStop(0.5, mixHex('#000', '#1E3CC0', k * 0.55)); g.addColorStop(1, mixHex('#000', '#4C86FF', k));
        e.fillStyle = g; e.fillRect(x + 2, 0, bw / 2 - 2, H);
        if (rng() < 0.35) { e.fillStyle = mixHex('#000', rng() < 0.5 ? '#FFB860' : '#CFE0FF', 0.85); e.fillRect(x + 6 + rng() * 14, 60 + rng() * 40, 7, 12); }
      }
      return { map: canvasTex(ca), emissiveMap: canvasTex(ce) };
    }
    if (style === 'arch') {
      // code podium (reference): a classical colonnade. Pale piers between tall round-headed warm windows,
      // a brighter double-height entrance every 8th bay, a darker plinth line at the foot.
      a.fillStyle = wall; a.fillRect(0, 0, W, H);
      for (let i = 0; i < BAYS; i++) {
        const door = i % 8 === 3, x0 = i * bw, x = x0 + (door ? 8 : 14), w = bw - (door ? 16 : 28);
        const top = door ? 16 : 22, bot = 118, rr = w / 2;
        const path = (c) => { c.beginPath(); c.moveTo(x, bot); c.lineTo(x, top + rr); c.arc(x + rr, top + rr, rr, Math.PI, 0); c.lineTo(x + w, bot); c.closePath(); };
        const hue = ['#FFB050', '#FFA040', '#FFBE68', '#FF9C38'][Math.floor(rng() * 4)];
        a.fillStyle = mixHex('#3A2210', hue, 0.55); path(a); a.fill();
        const g = e.createLinearGradient(0, top, 0, bot), k = door ? 1 : 0.62 + rng() * 0.3;
        g.addColorStop(0, mixHex('#000', hue, k * 0.6)); g.addColorStop(0.5, mixHex('#000', hue, k)); g.addColorStop(1, mixHex('#000', door ? '#FFE6B0' : hue, k));
        e.fillStyle = g; path(e); e.fill();
        e.fillStyle = 'rgba(0,0,0,0.75)'; e.fillRect(x + rr - 1.5, top + 4, 3, bot - top - 4); e.fillRect(x, top + rr + 18, w, 3); // mullion + transom
        if (!door && rng() < 0.6) { e.fillStyle = 'rgba(0,0,0,0.55)'; e.fillRect(x + 4 + rng() * (w - 10), bot - 30, 4, 30); }
        a.fillStyle = 'rgba(255,255,255,0.5)'; a.fillRect(x0 + 2, 6, 3, 116); // pier highlight
      }
      a.fillStyle = mixHex(wall, '#7A7598', 0.5); a.fillRect(0, 118, W, 10); // plinth
      a.fillStyle = 'rgba(255,255,255,0.55)'; a.fillRect(0, 2, W, 3); // cornice highlight
      return { map: canvasTex(ca), emissiveMap: canvasTex(ce) };
    }
    if (style === 'bright') {
      // reference calendar / automation / people lobby: a blazing warm glass row. Amber panes with white-hot
      // pools of light, dark people and furniture against them, thin dark mullions, a darker head band.
      a.fillStyle = '#2A1A10'; a.fillRect(0, 0, W, H);
      for (let i = 0; i < BAYS * 2; i++) {
        const x = i * (bw / 2) + 2, w = bw / 2 - 4;
        const dark = rng() < 0.07;
        const hue = ['#FF9A30', '#FF8C24', '#FFA840', '#FF8018', '#FFB050'][Math.floor(rng() * 5)];
        a.fillStyle = mixHex('#3A2010', hue, dark ? 0.15 : 0.5); a.fillRect(x, 10, w, 114);
        const g = e.createLinearGradient(0, 10, 0, 124), k = dark ? 0.25 : 0.75 + rng() * 0.25;
        g.addColorStop(0, mixHex('#000', hue, k * 0.45)); g.addColorStop(0.45, mixHex('#000', hue, k)); g.addColorStop(1, mixHex('#000', hue, k * 0.85));
        e.fillStyle = g; e.fillRect(x, 10, w, 114);
      }
      // white-hot light pools (ceiling lights / screens) scattered along the row
      for (let i = 0; i < BAYS * 1.6; i++) {
        const x = rng() * W, w = 10 + rng() * 34, y = 40 + rng() * 40, h = 14 + rng() * 26;
        const g = e.createRadialGradient(x + w / 2, y + h / 2, 1, x + w / 2, y + h / 2, Math.max(w, h) * 0.7);
        g.addColorStop(0, 'rgba(255,240,205,0.95)'); g.addColorStop(0.5, 'rgba(255,200,120,0.5)'); g.addColorStop(1, 'rgba(255,160,60,0)');
        e.fillStyle = g; e.fillRect(x - w, y - h, w * 3, h * 3);
      }
      // people / desks / partitions in silhouette
      for (let i = 0; i < BAYS * 2.5; i++) {
        const x = rng() * W, w = 3 + rng() * 4, h = 22 + rng() * 36;
        e.fillStyle = 'rgba(0,0,0,0.72)'; e.fillRect(x, 124 - h, w, h); e.beginPath(); e.arc(x + w / 2, 124 - h - 3, w * 0.55, 0, 7); e.fill();
        a.fillStyle = 'rgba(20,10,4,0.7)'; a.fillRect(x, 124 - h, w, h);
      }
      e.fillStyle = 'rgba(0,0,0,0.35)'; e.fillRect(0, 110, W, 14); // counters
      for (let i = 0; i <= BAYS * 2; i++) { e.fillStyle = 'rgba(0,0,0,0.85)'; e.fillRect(i * (bw / 2) - 1, 10, 3, 114); } // mullions
      e.fillStyle = '#000'; e.fillRect(0, 0, W, 10); e.fillRect(0, 124, W, 4);
      a.fillStyle = '#1A1620'; a.fillRect(0, 0, W, 10); a.fillRect(0, 124, W, 4);
    } else if (style === 'lobby') {
      for (let i = 0; i < BAYS * 2; i++) {
        const x = i * (bw / 2) + 4, w = bw / 2 - 8, k = rng() < 0.08 ? 0.4 : 0.8 + rng() * 0.2;
        const hue = ['#FFB45C', '#FFA848', '#FFC070', '#FF9C40'][Math.floor(rng() * 4)];
        a.fillStyle = mixHex('#2A1A0C', hue, 0.6); a.fillRect(x, 8, w, 116);
        const g = e.createLinearGradient(0, 8, 0, 124);
        g.addColorStop(0, mixHex('#000', hue, k * 0.78)); g.addColorStop(0.35, mixHex('#000', hue, k)); g.addColorStop(1, mixHex('#000', hue, k));
        e.fillStyle = g; e.fillRect(x, 8, w, 116);
      }
      // people / reception desks / screens behind the lobby glass
      for (let i = 0; i < BAYS * 3; i++) {
        const x = rng() * W, w = 3 + rng() * 5, h = 34 + rng() * 30;
        e.fillStyle = 'rgba(0,0,0,0.6)'; e.fillRect(x, 124 - h, w, h); a.fillStyle = 'rgba(30,18,8,0.6)'; a.fillRect(x, 124 - h, w, h);
      }
      e.fillStyle = 'rgba(0,0,0,0.5)'; e.fillRect(0, 100, W, 24); // reception counters line
      e.fillStyle = 'rgba(0,0,0,0.75)'; e.fillRect(0, 36, W, 4); // transom bar
      a.fillStyle = '#1A1620'; a.fillRect(0, 0, W, 8); a.fillRect(0, 124, W, 4);
    } else {
      // 'ribbon': continuous glazing (full bay between thin mullions, deep warm orange) for the hero faces.
      // 'win': punched glass set into a visible pale wall (piers between panes, spandrel under the sill),
      //        a mix of bright warm rooms and dark panes, so floors do not read evenly lit.
      // 'dim': mostly wall with a few small lit windows.
      const dim = style === 'dim', rib = style === 'ribbon';
      const gt = dim ? 40 : rib ? 22 : 34, gb = dim ? 94 : rib ? 108 : 98; // glass head / sill (canvas y, 0 = top)
      a.fillStyle = mixHex(wall, '#8F8AB8', 0.25); a.fillRect(0, gb, W, H - gb); // spandrel under the glass
      const panes = (x0) => (rib
        ? [[x0 + 2, bw / 3 - 3], [x0 + bw / 3 + 1, bw / 3 - 3], [x0 + (2 * bw) / 3 + 1, bw / 3 - 3]]
        : [[x0 + 6, bw / 2 - 10], [x0 + bw / 2 + 4, bw / 2 - 10]]); // wide wall piers between panes
      for (let i = 0; i < BAYS; i++) {
        const x0 = i * bw;
        const roomLit = rng() < (dim ? 0.28 : rib ? 0.86 : 0.58);
        for (const [px, pw] of panes(x0)) {
          const lit = roomLit ? rng() < 0.93 : rng() < 0.15;
          const hue = rib ? ['#FF8A2A', '#FF9432', '#FF9E3C', '#FF7E22', '#FFA848'][Math.floor(rng() * 5)] : ['#FF9A38', '#FFA544', '#FFB052', '#FF8E30', '#FFBE66'][Math.floor(rng() * 5)];
          const k = lit ? 0.7 + rng() * 0.3 : 0;
          a.fillStyle = lit ? mixHex('#4A2A10', hue, 0.55) : '#1A2140'; a.fillRect(px, gt, pw, gb - gt);
          if (lit) {
            const g = e.createLinearGradient(0, gt, 0, gb);
            g.addColorStop(0, mixHex('#000', hue, k * 0.55)); g.addColorStop(0.4, mixHex('#000', hue, k)); g.addColorStop(1, mixHex('#000', hue, k * 0.9));
            e.fillStyle = g; e.fillRect(px, gt, pw, gb - gt);
            // interior silhouettes (desks, people, partitions)
            e.fillStyle = 'rgba(0,0,0,0.55)'; a.fillStyle = 'rgba(40,20,8,0.5)';
            if (rng() < 0.5) { const w = 3 + rng() * 6, x = px + rng() * (pw - w); e.fillRect(x, gt + (gb - gt) * 0.45, w, (gb - gt) * 0.55); a.fillRect(x, gt + (gb - gt) * 0.45, w, (gb - gt) * 0.55); }
            e.fillRect(px, gb - 10, pw, 10); // desk line
          } else {
            e.fillStyle = '#060A1A'; e.fillRect(px, gt, pw, gb - gt);
            e.fillStyle = 'rgba(80,120,210,0.4)'; e.fillRect(px, gt, pw, 4); // cool reflection at the head
          }
        }
        if (rib) { a.fillStyle = '#3A3550'; a.fillRect(x0, gt, 2, gb - gt); } // bay mullion
        else { a.fillStyle = 'rgba(255,255,255,0.35)'; a.fillRect(x0 + bw / 2 - 2, gt, 2, gb - gt); } // pier highlight
      }
      a.fillStyle = 'rgba(255,255,255,0.45)'; a.fillRect(0, gb, W, 3); // sill highlight
      a.fillStyle = 'rgba(30,26,50,0.6)'; a.fillRect(0, gt - 3, W, 3); // head shadow
    }
    return { map: canvasTex(ca), emissiveMap: canvasTex(ce) };
  });
}
function glassMat(style, seed = 1, ei = null) {
  return cachedL(`mat:${style}:${seed}:${ei}`, () => {
    const t = glassTexture(style, seed);
    if (style === 'blue') {
      // unlit: the recessed curtain glass must stay deep blue under the scene lights and the warm spill
      const c = document.createElement('canvas'), src = t.emissiveMap.image, base = t.map.image;
      c.width = src.width; c.height = src.height;
      const x = c.getContext('2d');
      x.drawImage(base, 0, 0); x.globalCompositeOperation = 'lighter'; x.drawImage(src, 0, 0);
      return new THREE.MeshBasicMaterial({ map: canvasTex(c), side: THREE.DoubleSide });
    }
    return new THREE.MeshLambertMaterial({
      map: t.map, emissiveMap: t.emissiveMap, emissive: '#FFFFFF', side: THREE.DoubleSide,
      emissiveIntensity: ei ?? { lobby: 1.3, bright: 1.3, ribbon: 1.9, win: 1.6, dim: 1.35, fins: 1.4, blue: 1.7, arch: 1.3 }[style] ?? 1.5,
    });
  });
}
const deckMat = () => cachedL('mat:deck', () => new THREE.MeshLambertMaterial({ color: '#A9A8CB', map: roofTexture(), emissive: '#201F36', emissiveIntensity: 1 }));
const paleWall = () => cachedL('mat:paleWall', () => new THREE.MeshLambertMaterial({ color: '#CFCBEA', emissive: '#2E2C48', emissiveIntensity: 1 }));

/**
 * makeBlock with the inner-ring look: pale visible wall, punched rows of bright glass, bright warm lobby,
 * glowing roof edge. opts.glass: [{ sides, floors, style }] overrides ('win' | 'lobby' | 'dim' | null);
 * kit bands (opts.bands, e.g. 'screen') still win on their sides / floors.
 */
function blk(outline, opts = {}) {
  const { glass = [], bands = [], lobbyH = 1.25, lobbyInset = 0.32, floors = 3, floorH = 1.15, y0 = 0, seed = 11 } = opts;
  const B = makeBlock(outline, {
    bayWidth: 0.74, ledge: 0.14, ledgeH: 0.18, ...opts,
    roof: opts.roof === false ? false : { thick: 0.38, ...(opts.roof || {}) },
    materials: { facade: paleWall(), trim: MAT.trim, roof: deckMat(), ...(opts.materials || {}) },
    windows: { style: null }, lobby: { style: null },
    effects: { floorLines: '#FFA54E', intensity: 0.26, roofEdge: '#DDE4FF', ...(opts.effects || {}) },
  });
  const ledgeH = opts.ledgeH ?? 0.18;
  const hit = (list, f, t) => list.find((b) => (!b.floors || b.floors.includes(f)) && (b.sides === 'all' || b.sides.includes(t)));
  const styleOf = (f, t) => {
    if (hit(bands, f, t)) return null;
    const g = hit(glass, f, t);
    return g ? g.style : f === 0 ? 'lobby' : 'win';
  };
  const uScale = 0.74 * BAYS;
  const geos = new Map();
  let r = seed;
  for (let f = 0; f <= floors; f++) {
    const lob = f === 0;
    const off = offsetOutline(outline, lob ? -lobbyInset + 0.02 : 0.025);
    const ya = lob ? y0 + 0.02 : y0 + lobbyH + (f - 1) * floorH + ledgeH / 2;
    const yb = lob ? y0 + lobbyH - 0.05 : y0 + lobbyH + f * floorH - ledgeH / 2;
    for (const st of new Set(outline.tags.map((t) => styleOf(f, t)).filter(Boolean))) {
      for (const run of sideRuns(off, (t) => styleOf(f, t) === st)) {
        const k = st + ':' + (f % 2);
        if (!geos.has(k)) geos.set(k, []);
        r = (r * 7 + 3) % 97;
        geos.get(k).push(ribbon(run, ya, yb, { uScale, uOffset: r / 97 }));
      }
    }
  }
  for (const [k, list] of geos) {
    const [st, alt] = k.split(':');
    const ei = glass.find((b) => b.style === st && b.ei != null)?.ei ?? null;
    for (const geo of list) B.group.add(new THREE.Mesh(geo, glassMat(st, 3 + Number(alt) * 5, ei)));
  }
  return B;
}

/** Extra warm spill washing up the facade on the given sides (entrance / lobby glow, sheet sec 3). */
function entrySpill(outline, sides, { height = 2.2, opacity = 0.45 } = {}) {
  const g = new THREE.Group();
  for (const run of sideRuns(offsetOutline(outline, 0.05), sides)) {
    const m = new THREE.Mesh(ribbon(run, 0, height), glowMaterial('#FFB060', 'vertical', opacity * 0.5));
    m.renderOrder = 2; g.add(m);
  }
  return g;
}

const loop = (o) => [...o.pts, o.pts[0]];

/** Additive coloured wash over a roof deck (the neon-lit rooftops of code / mail / calendar). */
function deckTint(outline, y, color, opacity = 0.4) {
  const geo = new THREE.ShapeGeometry(outlineShape(outline));
  geo.rotateX(-Math.PI / 2); geo.translate(0, y, 0);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  }));
  m.renderOrder = 2;
  return m;
}

/** Opaque neon-tinted roof deck (reference: saturated violet / pink decks inside a pale rim), plus a soft additive wash. */
function tintDeck(outline, y, color, { deck = mixHex('#A9A8CB', color, 0.5), glow = 0.16 } = {}) {
  const g = new THREE.Group();
  const geo = new THREE.ShapeGeometry(outlineShape(outline));
  geo.rotateX(-Math.PI / 2); geo.translate(0, y, 0);
  const mat = cachedL(`mat:tintDeck:${deck}`, () => new THREE.MeshLambertMaterial({
    color: deck, emissive: mixHex('#000000', deck, 0.38), emissiveIntensity: 1, side: THREE.DoubleSide,
  }));
  g.add(new THREE.Mesh(geo, mat));
  if (glow) g.add(deckTint(outline, y + 0.01, color, glow));
  return g;
}

/** Thin warm light line tucked under a roof slab / ledge (the glowing eaves in the reference). */
function eaveGlow(outline, y, { h = 0.2, off = 0.16, color = '#FFA24A', opacity = 0.9 } = {}) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(ribbon(loop(offsetOutline(outline, off)), y - h, y), eaveMat()));
  const halo = new THREE.Mesh(ribbon(loop(offsetOutline(outline, off + 0.03)), y - h - 0.9, y + 0.02, { vFlip: true }), glowMaterial(color, 'vertical', 0.35 * opacity));
  halo.renderOrder = 2;
  g.add(halo);
  return g;
}
let _eave;
const eaveMat = () => (_eave ||= new THREE.MeshBasicMaterial({ color: new THREE.Color('#FFB050').multiplyScalar(1.7), toneMapped: false }));

/** Bold orange neon line under the roof slab (code / mail in the reference), with a strong halo down the wall. */
function boldEave(outline, y, { h = 0.62, off = 0.3, spill = 0.3 } = {}) {
  const g = new THREE.Group();
  // two-tone neon: a hot near-white core line over a deep orange band, so it blooms as one thick orange stroke
  // keep green < 1 after scaling so the line stays a saturated amber-orange instead of clipping to cream-white
  const mat = cachedL('mat:boldEave', () => new THREE.MeshBasicMaterial({ color: new THREE.Color('#FF7418').multiplyScalar(1.45), toneMapped: false }));
  const core = cachedL('mat:boldEaveCore', () => new THREE.MeshBasicMaterial({ color: new THREE.Color('#FF9A3C').multiplyScalar(1.4), toneMapped: false }));
  g.add(new THREE.Mesh(ribbon(loop(offsetOutline(outline, off)), y - h, y), mat));
  g.add(new THREE.Mesh(ribbon(loop(offsetOutline(outline, off + 0.012)), y - h * 0.62, y - h * 0.38), core));
  // underside of the overhang lit orange (flat band between the wall and the line)
  const under = new THREE.Mesh(flatBandLoop(offsetOutline(outline, 0.02), offsetOutline(outline, off), y - 0.005), mat);
  const dn = new THREE.Mesh(ribbon(loop(offsetOutline(outline, off - 0.02)), y - h - 0.32, y - h + 0.01, { vFlip: true }), glowMaterial('#FF6A14', 'vertical', spill));
  const up = new THREE.Mesh(ribbon(loop(offsetOutline(outline, off + 0.04)), y - 0.01, y + 0.3), glowMaterial('#FF7A20', 'vertical', 0.45));
  dn.renderOrder = up.renderOrder = 2;
  g.add(under, up);
  if (spill > 0) g.add(dn);
  return g;
}
/** Horizontal closed band between two offsets of the same outline (faces down: the lit soffit). */
function flatBandLoop(inner, outer, y) {
  const a = inner.pts, b = outer.pts, n = Math.min(a.length, b.length), pos = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pos.push(a[i][0], y, a[i][1], b[i][0], y, b[i][1], b[j][0], y, b[j][1], a[i][0], y, a[i][1], b[j][0], y, b[j][1], a[j][0], y, a[j][1]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Glowing sign strip: bright warm-white letters on a dark plate. */
function signTexture() {
  return cachedL('tex:sign', () => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 52;
    const x = c.getContext('2d');
    x.fillStyle = '#3A3348'; x.fillRect(0, 0, 512, 52);
    x.fillStyle = '#FFF1D6'; x.fillRect(6, 8, 500, 36);
    x.fillStyle = '#C89A5C'; let px = 30; let sd = 3;
    const rng = () => ((sd = (sd * 9301 + 49297) % 233280) / 233280);
    while (px < 480) { const w = 10 + rng() * 22; x.fillRect(px, 14, w, 24); px += w + 6 + (rng() < 0.2 ? 14 : 0); }
    const t = canvasTex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** Big glowing warm letters on a transparent strip (the lit name signs over the automation / people lobbies). */
function letterSignTexture(seed = 5) {
  return cachedL(`tex:letters:${seed}`, () => {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 96;
    const x = c.getContext('2d');
    let sd = seed; const rng = () => ((sd = (sd * 9301 + 49297) % 233280) / 233280);
    x.lineCap = 'round'; x.lineJoin = 'round';
    x.translate(1024, 0); x.scale(-1, 1); // the back-face runs go right-to-left as seen from outside
    let px = 40;
    while (px < 980) {
      const word = 4 + Math.floor(rng() * 4);
      for (let i = 0; i < word && px < 980; i++) {
        const w = 26 + rng() * 22, k = Math.floor(rng() * 4);
        x.shadowColor = '#FF7A14'; x.shadowBlur = 18; x.strokeStyle = '#FFD890'; x.lineWidth = 13;
        x.beginPath();
        if (k === 0) { x.moveTo(px, 76); x.lineTo(px, 22); x.lineTo(px + w, 22); x.moveTo(px, 48); x.lineTo(px + w * 0.8, 48); }
        else if (k === 1) { x.ellipse(px + w / 2, 49, w / 2, 27, 0, 0, 7); }
        else if (k === 2) { x.moveTo(px, 22); x.lineTo(px, 76); x.lineTo(px + w, 76); x.lineTo(px + w, 22); }
        else { x.moveTo(px, 76); x.lineTo(px + w / 2, 22); x.lineTo(px + w, 76); }
        x.stroke(); x.stroke();
        px += w + 16;
      }
      px += 60;
    }
    const t = canvasTex(c); t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}
/** Warm letter sign mounted on the fascia of the given sides. */
function letterSign(outline, sides, y0, y1, seed = 5) {
  const g = new THREE.Group();
  const mat = cachedL(`mat:letters:${seed}`, () => {
    const m = new THREE.MeshBasicMaterial({ map: letterSignTexture(seed), transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    m.color.setScalar(2.0); return m;
  });
  for (const run of sideRuns(offsetOutline(outline, 0.07), sides)) {
    const m = new THREE.Mesh(ribbon(run, y0, y1, { uScale: 9 }), mat);
    m.renderOrder = 3; g.add(m);
  }
  return g;
}

/** Lit pool texture: deep blue rim, bright cyan centre, ripple highlights. */
function poolTexture() {
  return cachedL('tex:pool', () => {
    const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    // reference: mid-blue water lit from below, a soft lighter centre (not a white hotspot), darker at the walls
    const gr = x.createRadialGradient(S * 0.55, S * 0.5, 4, S / 2, S / 2, S * 0.66);
    gr.addColorStop(0, '#8FD8FF'); gr.addColorStop(0.3, '#4CA6F0'); gr.addColorStop(0.65, '#2466C8'); gr.addColorStop(1, '#123A8A');
    x.fillStyle = gr; x.fillRect(0, 0, S, S);
    x.strokeStyle = 'rgba(220,250,255,0.35)'; x.lineWidth = 2;
    let s = 7; const rng = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 40; i++) { const px = rng() * S, py = rng() * S, w = 10 + rng() * 26; x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + w / 2, py - 3, px + w, py); x.stroke(); }
    // dark border inside the coping
    x.strokeStyle = 'rgba(8,24,70,0.9)'; x.lineWidth = 10; x.strokeRect(0, 0, S, S);
    return canvasTex(c);
  });
}

/** Glowing water pool in a court: stone coping, lit water (UV-mapped over its bounds), fountain sparkle. */
function pool(outline, y, { fountain = null, fountains = fountain ? [fountain] : [], dim = false } = {}) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(extrudeOutline(outline, y - 0.02, y + 0.09, { holes: [offsetOutline(outline, -0.14)] }), MAT.trim));
  const inner = offsetOutline(outline, -0.14);
  const geo = new THREE.ShapeGeometry(outlineShape(inner));
  geo.rotateX(-Math.PI / 2); geo.translate(0, y + 0.03, 0);
  geo.computeBoundingBox();
  const bb = geo.boundingBox, pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - bb.min.x) / (bb.max.x - bb.min.x), (pos.getZ(i) - bb.min.z) / (bb.max.z - bb.min.z));
  const water = new THREE.Mesh(geo, cachedL(dim ? 'mat:poolDim' : 'mat:pool', () => {
    const m = new THREE.MeshBasicMaterial({ map: poolTexture(), toneMapped: false });
    if (dim) m.color.set('#5E7CB4'); else m.color.setScalar(0.85); // dim: a desaturated, darker blue court pool
    return m;
  }));
  g.add(water);
  g.add(deckTint(inner, y + 0.05, '#3FB8FF', dim ? 0.05 : 0.12));
  for (const [i, ft] of fountains.entries()) {
    const k = i ? 0.7 : 1; // the reference shows one tall jet and smaller sprays beside it
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * k + 0.06, 0.22 * k + 0.08, 0.14, 12), MAT.trim);
    f.position.set(ft.x, y + 0.1, ft.z); g.add(f);
    const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.07 * k, 0.75 * k, 8), cachedL('mat:jet', () => new THREE.MeshBasicMaterial({ color: new THREE.Color('#E6F8FF').multiplyScalar(2), toneMapped: false })));
    jet.position.set(ft.x, y + 0.1 + 0.375 * k, ft.z); g.add(jet);
    g.add(makeGlowPoints([[ft.x, y + 0.15 + 0.7 * k, ft.z], [ft.x, y + 0.15, ft.z]], '#CFF2FF', 1.6 * k, 0.85));
  }
  return g;
}

/** Dark recessed strip in a roof (docs roof front): sunk dark channel with a lit inner lip. */
function recessStrip(outline, y) {
  const g = new THREE.Group();
  const inner = offsetOutline(outline, -0.1);
  g.add(new THREE.Mesh(extrudeOutline(inner, y - 0.05, y + 0.02), cachedL('mat:recess', () => new THREE.MeshLambertMaterial({ color: '#262A44', emissive: '#0A0C1A', emissiveIntensity: 1 }))));
  // raised pale lip around the channel, dark inner wall reading as depth
  g.add(new THREE.Mesh(extrudeOutline(outline, y, y + 0.12, { holes: [inner] }), MAT.trim));
  g.add(new THREE.Mesh(ribbon([...inner.pts, inner.pts[0]].reverse(), y - 0.05, y + 0.11), MAT.base));
  // faint cool glass glints along the channel floor (skylights in the reference)
  const c = inner.pts.reduce((m, p) => [m[0] + p[0] / inner.pts.length, m[1] + p[1] / inner.pts.length], [0, 0]);
  const far = inner.pts.reduce((b, p) => (Math.hypot(p[0] - c[0], p[1] - c[1]) > Math.hypot(b[0] - c[0], b[1] - c[1]) ? p : b), inner.pts[0]);
  const pts = [];
  for (let k = -3; k <= 3; k++) pts.push([c[0] + ((far[0] - c[0]) * k) / 4.2, y + 0.04, c[1] + ((far[1] - c[1]) * k) / 4.2]);
  g.add(makeGlowPoints(pts, '#6E9BFF', 0.35, 0.55));
  return g;
}

/** Shared ground dressing for an inner-ring wedge: lawn lot, base glow, ring of trees, lamps. */
function dressGround(g, P, outlines, { a = 17.5, seed = 1, skipTrees = [], lotIn = 17.25, lotOut = 27.4 } = {}) {
  const R = P.R;
  g.add(makeLot(outlines[0], { lot: sectorOutline({ r: R, rIn: lotIn, rOut: lotOut, a0: -a, a1: a, corners: 1.4 }), walk: 0.85, walkMaterial: MAT.plaza }));
  outlines.forEach((o, i) => g.add(makeBaseGlow(o, { spread: i ? 1.5 : 1.3, height: 1.2, intensity: i ? 0.55 : 0.45 })));
  const rng = makeRng(seed), trees = [];
  for (let k = -a + 2.5; k <= a - 2.5; k += 5.5) {
    if (!skipTrees.includes('front')) trees.push({ ...P(lotIn + 0.85, k + (rng() - 0.5) * 2), s: 0.85 + rng() * 0.3 });
    if (!skipTrees.includes('back') && rng() < 0.7) trees.push({ ...P(lotOut - 0.5, k + (rng() - 0.5) * 2), s: 0.6 + rng() * 0.2 });
  }
  for (const side of [-1, 1]) for (const rho of [lotIn + 2.5, lotIn + 5.5, lotOut - 2]) {
    if (rng() < 0.75) trees.push({ ...P(rho + (rng() - 0.5), side * (a - 1.1)), s: 0.7 + rng() * 0.3 });
  }
  // keep trees and lamps off the walls, the podiums and the driveway (local x = 0 on the core side)
  const clear = (p, pad) => !outlines.some((o) => insideOutline(offsetOutline(o, pad), p.x, p.z)) && !(Math.abs(p.x) < 1.6 && p.z > 0);
  g.add(makeTrees(trees.filter((t) => clear(t, 0.75)), { seed }));
  const lamps = [];
  for (let k = -a + 2; k <= a - 2; k += 6) lamps.push(P(lotIn + 0.4, k));
  for (let k = -a + 5; k <= a - 5; k += 8) lamps.push(P(lotOut - 0.3, k));
  g.add(makeLamps(lamps.filter((p) => clear(p, 0.35)), { size: 0.9, opacity: 1 }));
}
/** Point-in-polygon test on an outline (local x, z). */
function insideOutline(o, x, z) {
  let c = false;
  const P = o.pts;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, zi] = P[i], [xj, zj] = P[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function frame(ctx, id) {
  const slot = ctx.layout.BUILDINGS.find((b) => b.id === id);
  const R = slot.r;
  const P = (rho, a) => sectorPoint(R, rho, a);
  P.R = R;
  const XZ = (rho, a) => { const p = P(rho, a); return [p.x, p.z]; };
  const arc = (rho, a0, a1, n = 16) => Array.from({ length: n + 1 }, (_, i) => XZ(rho, a0 + ((a1 - a0) * i) / n));
  return { slot, R, P, XZ, arc, g: new THREE.Group() };
}

function addBadge(g, slot, P, rho, a, top, { BY = top + 2.7, phase = 0, pool = 0.22 } = {}) {
  const bp = P(rho, a);
  // tight rim glow only (reference: crisp solid disc, no wide colour fog round it)
  const badge = makeBadge(slot.icon, slot.color, { size: BADGE_SIZE, halo: 1.12, haloOpacity: 0.2, roofGlowY: top + 0.06 - BY, poolOpacity: pool, phase });
  badge.position.set(bp.x, BY, bp.z);
  g.add(badge);
}

// ------------------------------------------------------------------------------------------
// Futuristic finish helpers
// ------------------------------------------------------------------------------------------
/** Glazing ribbon on the given sides of an outline between ya and yb. */
function glassBand(outline, sides, ya, yb, style, { seed = 3, inset = 0.02, ei = null } = {}) {
  const g = new THREE.Group();
  let r = seed;
  for (const run of sideRuns(offsetOutline(outline, inset), sides)) {
    r = (r * 7 + 3) % 97;
    g.add(new THREE.Mesh(ribbon(run, ya, yb, { uScale: 0.74 * BAYS, uOffset: r / 97 }), glassMat(style, seed, ei)));
  }
  return g;
}

/** Bright pale highlight catching the top edge of a slab (the sleek rounded ledges of the reference). */
function edgeHighlight(outline, y, { off = 0.03, color = '#F2F0FF', intensity = 1.15, height = 0.055 } = {}) {
  return makeNeonLine(offsetOutline(outline, off), [y], { color, height, glow: 0.12, intensity, glowOpacity: 0.22 });
}

/**
 * Upper volume crowned by a thick white roof slab and parapet. body y0..y1 (pale wall), slab y1..y1+thick.
 * Returns { group, top (deck y), roofOutline (inside the parapet), slab (slab outline) }.
 */
function capBlock(outline, y0, y1, { overhang = 0.28, thick = 0.5, parapetH = 0.42, parapetW = 0.55, wall = paleWall(), deck = deckMat() } = {}) {
  const g = new THREE.Group();
  if (y1 > y0 + 0.01) g.add(new THREE.Mesh(extrudeOutline(outline, y0, y1), wall));
  const slab = offsetOutline(outline, overhang);
  const top = y1 + thick, roofOutline = offsetOutline(slab, -parapetW);
  g.add(new THREE.Mesh(extrudeOutline(slab, y1, top, { bevel: 0.08 }), [deck, MAT.trim]));
  g.add(new THREE.Mesh(extrudeOutline(slab, top - 0.01, top + parapetH, { holes: [roofOutline], bevel: 0.07 }), MAT.trim));
  g.add(edgeHighlight(slab, top + parapetH - 0.05, { off: 0.0 }));
  g.add(edgeHighlight(slab, y1 + 0.06, { off: 0.0, intensity: 0.9, color: '#E4E2FA' }));
  return { group: g, top, roofOutline, slab };
}

/** Vertical white rib fins standing proud of the wall along the given sides. */
function ribFins(outline, sides, y0, y1, { spacing = 0.62, depth = 0.22, width = 0.13 } = {}) {
  const geos = [];
  for (const run of sideRuns(outline, sides)) {
    let acc = spacing / 2;
    for (let i = 0; i + 1 < run.length; i++) {
      const [px, pz] = run[i], [qx, qz] = run[i + 1];
      const L = Math.hypot(qx - px, qz - pz); if (L < 1e-4) continue;
      const tx = (qx - px) / L, tz = (qz - pz) / L, nx = tz, nz = -tx;
      while (acc < L) {
        const x = px + tx * acc + nx * depth * 0.5, z = pz + tz * acc + nz * depth * 0.5;
        const b = new THREE.BoxGeometry(width, y1 - y0, depth);
        b.rotateY(Math.atan2(-tz, tx)); b.translate(x, (y0 + y1) / 2, z);
        geos.push(b);
        acc += spacing;
      }
      acc -= L;
    }
  }
  return geos.length ? mergedMesh(geos, MAT.trim) : new THREE.Group();
}

/** Glowing vertical pilasters / lit end posts (reference: lit corner posts framing the lobby). */
function pilasters(list, y0, y1, { w = 0.3, color = '#FFB866' } = {}) {
  const g = new THREE.Group();
  const geos = [], lit = [];
  for (const p of list) {
    const b = new THREE.BoxGeometry(w, y1 - y0, w); b.translate(p.x, (y0 + y1) / 2, p.z); geos.push(b);
    const s = new THREE.BoxGeometry(w * 0.45, (y1 - y0) * 0.86, w * 1.08); s.translate(p.x, (y0 + y1) / 2, p.z); lit.push(s);
  }
  g.add(mergedMesh(geos, MAT.trim));
  g.add(mergedMesh(lit, cachedL('mat:pilaster:' + color, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.5), toneMapped: false }))));
  const pts = [];
  for (const p of list) for (let k = 0; k <= 3; k++) pts.push([p.x, y0 + ((y1 - y0) * k) / 3, p.z]);
  g.add(makeGlowPoints(pts, color, 0.9, 0.5));
  return g;
}

/** Flat tinted deck fill (no rim) at y. */
function deckFill(outline, y, mat) {
  const geo = new THREE.ShapeGeometry(outlineShape(outline));
  geo.rotateX(-Math.PI / 2); geo.translate(0, y, 0);
  return new THREE.Mesh(geo, mat);
}
const lavDeck = (c) => cachedL('mat:lav:' + c, () => new THREE.MeshLambertMaterial({ color: c, map: roofTexture(), emissive: mixHex('#000000', c, 0.22), emissiveIntensity: 1 }));
const navyMat = () => cachedL('mat:navyCourt', () => new THREE.MeshLambertMaterial({ color: '#27305E', emissive: '#0E1534', emissiveIntensity: 1 }));
const navyGrey = () => cachedL('mat:navyGrey', () => new THREE.MeshLambertMaterial({ color: '#2A2E4E', emissive: '#0B0D1E', emissiveIntensity: 1 }));

// ------------------------------------------------------------------------------------------
// Buildings
// Every footprint below is written in the slot's local frame (x along the ring, + = counter-clockwise
// neighbour side; z toward the core, + = core side), fitted from the reference roof corners through the
// live camera (ref/in4g_*.png).
// ------------------------------------------------------------------------------------------
/** Outline from local [x, z, tag, radius] in kit winding; mirror -1 reflects x (fixes winding and left/right tags). */
function lpoly(list, mirror = 1) {
  if (mirror > 0) return polyOutline(list);
  const sw = { right: 'left', left: 'right' };
  const n = list.length, rev = list.slice().reverse();
  return polyOutline(rev.map(([x, z, , rad], i) => { const t = list[(2 * n - 2 - i) % n][2]; return [-x, z, sw[t] ?? t, rad]; }));
}
/** Plain polygon (no tags) from local points; any winding. */
const kpoly = (pts, radii = 0.4, mirror = 1) => kitPoly(pts.map(([x, z]) => [x * mirror, z]), radii);

function badgeAt(g, slot, x, z, top, { BY = top + 2.4, phase = 0, pool = 0.22 } = {}) {
  const badge = makeBadge(slot.icon, slot.color, { size: BADGE_SIZE, halo: 1.12, haloOpacity: 0.2, roofGlowY: top + 0.06 - BY, poolOpacity: pool, phase });
  badge.position.set(x, BY, z);
  g.add(badge);
}

/** Warm orange light spilling over the driveway (local x = 0, from the forecourt lane to the wall at local z = zWall). */
function driveSpill(g, R, zWall, { width = 3.2, opacity = 0.5 } = {}) {
  const z0 = R - 16.2, L = Math.max(1, z0 - zWall);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, L + 1.6), glowMaterial('#FF9238', 'radial', opacity));
  m.rotation.x = -Math.PI / 2; m.position.set(0, 0.11, (z0 + zWall) / 2); m.renderOrder = 2;
  const wash = new THREE.Mesh(new THREE.PlaneGeometry(width * 2.2, 2.4), glowMaterial('#FFB060', 'radial', opacity * 0.9));
  wash.rotation.x = -Math.PI / 2; wash.position.set(0, 0.12, zWall + 0.9); wash.renderOrder = 2;
  g.add(m, wash);
}

/** Hot orange line on the lower edge of a slab + lit soffit + halo down the wall (code / docs eaves). */
function underGlow(inner, outer, y, { h = 0.22, halo = 0.5, opacity = 0.4 } = {}) {
  const g = new THREE.Group();
  const hot = cachedL('mat:underHot', () => new THREE.MeshBasicMaterial({ color: new THREE.Color('#FF7A1C').multiplyScalar(1.5), toneMapped: false, side: THREE.DoubleSide }));
  const core = cachedL('mat:underCore', () => new THREE.MeshBasicMaterial({ color: new THREE.Color('#FFA448').multiplyScalar(1.45), toneMapped: false, side: THREE.DoubleSide }));
  g.add(new THREE.Mesh(ribbon(loop(offsetOutline(outer, 0.035)), y + 0.01, y + h), hot));
  g.add(new THREE.Mesh(ribbon(loop(offsetOutline(outer, 0.045)), y + h * 0.35, y + h * 0.7), core));
  g.add(new THREE.Mesh(extrudeOutline(outer, y - 0.012, y - 0.002, { holes: [offsetOutline(inner, 0.02)] }), hot));
  const dn = new THREE.Mesh(ribbon(loop(offsetOutline(outer, 0.03)), y - halo, y + 0.01, { vFlip: true }), glowMaterial('#FF7A20', 'vertical', opacity));
  const up = new THREE.Mesh(ribbon(loop(offsetOutline(outer, 0.06)), y + h, y + h + 0.28), glowMaterial('#FF8A2C', 'vertical', opacity * 0.8));
  dn.renderOrder = up.renderOrder = 2;
  g.add(dn, up);
  return g;
}

/** Warm floor lines only on the given sides (open runs). */
function sideLines(outline, sides, ys, { off = 0.05, color = '#FFA54E', intensity = 1.5, glowOpacity = 0.3 } = {}) {
  const g = new THREE.Group();
  for (const run of sideRuns(offsetOutline(outline, off), sides)) g.add(makeNeonLine(run, ys, { color, height: 0.07, glow: 0.18, intensity, glowOpacity }));
  return g;
}

/** One thick rounded white slab (solid, deck on top) with a single bright highlight on its top edge. */
function slab(outline, y0, y1, { deck = plainDeck(), bevel = 0.12, highlight = true } = {}) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(extrudeOutline(outline, y0, y1, { bevel }), [deck, MAT.trim]));
  if (highlight) g.add(edgeHighlight(outline, y1 - bevel * 0.6, { off: 0.0 }));
  return g;
}
/** Parapet ring on a slab: outer outline -> inward by w, h tall. */
function parapet(outline, y, { w = 0.5, h = 0.4, highlight = true } = {}) {
  const g = new THREE.Group();
  const inner = offsetOutline(outline, -w);
  g.add(new THREE.Mesh(extrudeOutline(outline, y - 0.01, y + h, { holes: [inner], bevel: 0.07 }), MAT.trim));
  // dark inner wall face (shadowed) so the rim reads thick
  g.add(new THREE.Mesh(ribbon(loop(inner).reverse(), y, y + h - 0.04), cachedL('mat:parapetIn', () => new THREE.MeshLambertMaterial({ color: '#8C89B0', emissive: '#1E1C33', emissiveIntensity: 1 }))));
  if (highlight) g.add(edgeHighlight(outline, y + h - 0.05, { off: 0.0 }));
  return { group: g, inner };
}

const plainDeck = () => cachedL('mat:plainDeck', () => new THREE.MeshLambertMaterial({ color: '#A7A6C9', emissive: '#1F1E35', emissiveIntensity: 1 }));
const plainMat = (c, e) => cachedL(`mat:plain:${c}:${e}`, () => new THREE.MeshLambertMaterial({ color: c, emissive: e, emissiveIntensity: 1 }));

/** Small dark rooftop units (boxes and vents). list: [[x, z, w, d]] */
function darkUnits(list, y) {
  const geos = [];
  for (const [x, z, w = 0.38, d = 0.3, h = 0.22] of list) { const b = new THREE.BoxGeometry(w, h, d); b.translate(x, y + h / 2, z); geos.push(b); }
  return mergedMesh(geos, plainMat('#2A2C44', '#08090F'));
}

// ------------------------------------------------------------------------------------------
// Camera 11-01 (elevation 53.85, distance 279.6, target (-0.85, 0, 8.15), fov 20). Every outline below was fitted
// by unprojecting the reference roof corners (ref/dashboard.png) at the building's roof height, then clamped to
// the roads (forecourt lane r 16.1..17.3, inner spokes +-22.5 deg with 2 units clearance, ring1 inner edge).
// Badges are sprites (no depth test), so each one is placed so its disc centre lands on the reference badge.
// ------------------------------------------------------------------------------------------
const recessMat = () => cachedL('mat:darkBand', () => new THREE.MeshLambertMaterial({ color: '#1C2240', emissive: '#0A0E22', emissiveIntensity: 1 }));
/** Dark recessed window band on the given sides (a slot of glass set back into a pale wall). */
function darkBand(outline, sides, ya, yb, { off = 0.015 } = {}) {
  const g = new THREE.Group();
  for (const run of sideRuns(offsetOutline(outline, off), sides)) {
    g.add(new THREE.Mesh(ribbon(run, ya, yb), recessMat()));
    g.add(makeNeonLine(run, [yb + 0.01], { color: '#F2F0FF', height: 0.04, glow: 0.06, intensity: 0.9, glowOpacity: 0.12 }));
  }
  return g;
}
/** Warm glow over a glazed ribbon (vertical fade) on the given sides. */
function ribbonBloom(outline, sides, ya, yb, opacity = 0.42) {
  const g = new THREE.Group();
  for (const run of sideRuns(offsetOutline(outline, 0.06), sides)) {
    const m = new THREE.Mesh(ribbon(run, ya, yb, { vFlip: true }), glowMaterial('#FF9A3C', 'vertical', opacity));
    m.renderOrder = 2; g.add(m);
  }
  return g;
}

function buildHQ(ctx) {
  const { slot, R, P, g } = frame(ctx, 'hq-north');
  // Reference: a sector block, wider at the back (north); a trapezoid court, wider at the back, with trees at
  // the front and left and the water centre-right. Front: two thick blazing warm ribbons (lobby row and the
  // floor under the slab) below a heavy white rounded roof rim.
  const main = lpoly([[-6.9, -3.0, 'back', 1.8], [6.9, -3.0, 'right', 1.8], [5.6, 2.9, 'front', 2.2], [-5.6, 2.9, 'left', 2.2]]);
  const front = ['front'];
  const LH = 1.6, F1 = 0.36, RIB = 1.5;
  const A = blk(main, {
    floors: 1, floorH: F1, lobbyH: LH, lobbyInset: 0.4, seed: 31, roof: false,
    effects: { roofEdge: false, floorLines: false },
    glass: [{ sides: 'all', style: null, floors: [1] }, { sides: front, style: 'bright', floors: [0], ei: 1.75 }, { sides: ['left', 'right'], style: 'lobby', floors: [0] }, { sides: ['back'], style: 'dim', floors: [0] }],
  });
  g.add(A.group);
  const yR = A.top;
  const courtO = lpoly([[-5.5, -2.55, 'back', 0.7], [5.5, -2.55, 'right', 0.7], [3.5, 2.2, 'front', 0.6], [-3.5, 2.2, 'left', 0.6]]);
  // ribbon floor: blazing warm glass on the front and both sides, under the slab
  const ribbonO = offsetOutline(main, -0.06);
  g.add(new THREE.Mesh(extrudeOutline(ribbonO, yR, yR + RIB, { holes: [offsetOutline(courtO, 0.3)] }), MAT.base));
  g.add(glassBand(ribbonO, ['front', 'left', 'right'], yR + 0.04, yR + RIB - 0.02, 'ribbon', { seed: 13, inset: 0.01, ei: 2.5 }));
  g.add(glassBand(ribbonO, ['back'], yR + 0.06, yR + RIB - 0.04, 'dim', { seed: 9, inset: 0.01 }));
  g.add(ribbonBloom(main, ['front', 'left', 'right'], yR, yR + RIB + 0.1, 0.8));
  g.add(ribbonBloom(main, front, 0.1, LH, 0.5));
  // white band between the two ribbons, bright top edge
  g.add(edgeHighlight(main, LH + F1 - 0.03, { off: 0.03, intensity: 1.0 }));
  const slabO = offsetOutline(main, 0.3), TH = 0.62, top = yR + RIB + TH;
  g.add(new THREE.Mesh(extrudeOutline(slabO, yR + RIB, top, { holes: [courtO], bevel: 0.12 }), [plainMat('#C9C8E6', '#2A2944'), MAT.trim]));
  g.add(underGlow(main, slabO, yR + RIB, { h: 0.16, halo: 0.35, opacity: 0.35 }));
  // thick white outer lip with its highlight, low inner lip round the court
  g.add(new THREE.Mesh(extrudeOutline(slabO, top - 0.02, top + 0.26, { holes: [offsetOutline(slabO, -0.55)], bevel: 0.08 }), MAT.trim));
  g.add(new THREE.Mesh(extrudeOutline(offsetOutline(courtO, 0.26), top - 0.02, top + 0.12, { holes: [courtO] }), MAT.trim));
  g.add(edgeHighlight(slabO, top + 0.22, { off: 0.0, intensity: 1.3 }));
  g.add(edgeHighlight(offsetOutline(courtO, 0.26), top + 0.1, { off: 0.0, intensity: 0.8 }));
  // inner court walls: plain pale stone (no windows), darker toward the floor
  const well = loop(offsetOutline(courtO, -0.02)).reverse();
  g.add(new THREE.Mesh(ribbon(well, yR - 0.02, top + 0.02), plainMat('#8F8DB4', '#1E1D34')));
  // court floor: dark blue-grey paving; lawn beds at the front and left; the water centre-right
  const fy = yR + 0.02;
  g.add(new THREE.Mesh(extrudeOutline(offsetOutline(courtO, -0.01), fy - 0.06, fy), plainMat('#4A5276', '#151A34')));
  g.add(new THREE.Mesh(extrudeOutline(kpoly([[-2.7, 0.7], [0.4, 0.7], [0.3, 1.95], [-2.6, 1.95]], 0.4), fy, fy + 0.04), courtLawnDark()));
  g.add(new THREE.Mesh(extrudeOutline(kpoly([[-4.7, -2.15], [-2.0, -2.15], [-1.9, 0.3], [-3.3, 0.3]], 0.35), fy, fy + 0.04), courtLawnDark()));
  g.add(new THREE.Mesh(extrudeOutline(kpoly([[1.3, 1.0], [2.7, 1.0], [2.6, 1.95], [1.2, 1.95]], 0.3), fy, fy + 0.04), courtLawnDark()));
  g.add(pool(kpoly([[-1.4, -2.2], [4.9, -2.2], [3.7, 0.6], [-1.0, 0.6]], 0.5), fy, { fountains: [{ x: 1.7, z: -0.9 }] }));
  g.add(makeTrees([
    { x: -2.2, z: 1.3, s: 1.2 }, { x: -1.0, z: 1.45, s: 0.85 }, { x: 0.0, z: 1.3, s: 0.65 }, { x: -3.6, z: -1.2, s: 1.05 }, { x: -3.0, z: -0.1, s: 0.9 },
    { x: -4.0, z: -1.9, s: 0.75 }, { x: -2.5, z: -1.6, s: 0.7 }, { x: 2.0, z: 1.45, s: 0.75 },
  ].map((t) => ({ ...t, y: fy })), { seed: 33 }));
  g.add(makeLamps([{ x: 0.9, z: 1.2 }, { x: -1.6, z: 0.4 }], { height: 0.3, size: 0.55, opacity: 0.8, pool: 0 }).translateY(fy));
  // lit pilasters at both front corners
  g.add(pilasters([{ x: -4.5, z: 3.1 }, { x: 4.5, z: 3.1 }], 0, top, { w: 0.34 }));
  g.add(makeRoofDetails([
    { type: 'vent', x: -6.4, z: -2.75 }, { type: 'vent', x: 6.4, z: -2.75 }, { type: 'vent', x: -5.0, z: 2.6 }, { type: 'vent', x: 5.0, z: 2.6 },
  ], top));
  dressGround(g, P, [main], { seed: 3, skipTrees: ['front'] });
  g.add(makeTrees([-5.6, -3.8, 3.8, 5.6].map((x, i) => ({ x, z: 4.25, s: 0.7 + (i % 2) * 0.12 })), { seed: 35 }));
  g.add(entrySpill(main, front, { opacity: 0.45, height: 2.0 }));
  driveSpill(g, R, 2.9, { opacity: 0.22, width: 2.4 });
  placeBuilding(ctx, slot, g);
}
const courtLawnDark = () => cachedL('mat:courtLawnDark', () => new THREE.MeshLambertMaterial({ color: '#2B4F33', emissive: '#0A1A10', emissiveIntensity: 1 }));

function buildDocs(ctx) {
  const { slot, R, P, g } = frame(ctx, 'docs');
  // Local: +x = NE (screen up-right), -x = SW, +z = SE (core), -z = NW.
  // Reference: a long tapered wedge on a NE-SW axis: a straight NW back, a narrow well-rounded NE far end,
  // a long convex SE front of warm ribbon glazing, and a pale SW end wall (one dark recessed band, a small
  // warm lobby at the foot). Thick white roof slab; a dark trench runs the full SW edge of the roof.
  const main = lpoly([
    [-7.05, -1.7, 'back', 1.0], [4.6, -3.0, 'right', 2.5], [2.9, 3.55, 'front', 2.0], [-1.0, 3.95, 'front', 4.5], [-4.3, 3.95, 'left', 0.9],
  ]);
  const LH = 1.35, FH = 1.05, TH = 0.6, OV = 0.34;
  const A = blk(main, {
    floors: 2, floorH: FH, lobbyH: LH, lobbyInset: 0.26, seed: 41, ledge: -0.03, ledgeH: 0.08,
    roof: { overhang: OV, thick: TH, parapetH: 0.3, parapetW: 0.5 },
    materials: { roof: plainDeck() },
    effects: { roofEdge: '#E4E8FF', floorLines: false, intensity: 0.22 },
    glass: [
      { sides: ['front', 'right'], style: 'ribbon', floors: [1, 2], ei: 2.1 },
      { sides: ['front', 'right'], style: 'lobby', floors: [0], ei: 1.5 },
      { sides: ['left'], style: null, floors: [1, 2] },
      { sides: ['left'], style: 'lobby', floors: [0], ei: 1.4 },
      { sides: ['back'], style: 'dim', floors: [0, 1] },
      { sides: ['back'], style: null, floors: [2] },
    ],
  });
  g.add(A.group);
  // the SW end: pale wall with one long dark recessed band under the slab
  g.add(darkBand(main, ['left'], LH + FH + 0.12, LH + 2 * FH - 0.12));
  g.add(sideLines(main, ['front', 'right'], [LH + 0.02, LH + FH], { intensity: 1.8, glowOpacity: 0.38 }));
  const slabY = A.top - TH;
  g.add(underGlow(main, offsetOutline(main, OV), slabY, { h: 0.16, halo: 0.5, opacity: 0.36 }));
  for (let f = 1; f <= 2; f++) { const y = LH + (f - 1) * FH; g.add(ribbonBloom(main, ['front', 'right'], y + 0.1, y + FH - 0.08, 0.46)); }
  // dark trench along the whole SW roof edge, under the thick parapet
  g.add(recessStrip(kpoly([[-6.5, -1.4], [-5.65, -1.72], [-3.57, 2.98], [-4.4, 3.31]], 0.3), A.top));
  // raised pale panel following the curve, with a seam round it and a groove parallel to the front
  const panel = kpoly([[-4.75, -1.6], [3.7, -2.55], [2.6, 2.6], [-0.9, 3.2], [-2.8, 2.9]], [0.6, 1.8, 1.6, 3.0, 0.6]);
  g.add(new THREE.Mesh(extrudeOutline(panel, A.top - 0.02, A.top + 0.09, { bevel: 0.03 }), plainMat('#B4B3D4', '#232239')));
  g.add(makeSeams([loop(offsetOutline(panel, 0.05)), loop(offsetOutline(panel, -0.75))], A.top + 0.0, 0.05, MAT.seamLight));
  g.add(darkUnits([[-1.5, -1.5, 0.42, 0.3], [3.9, -2.65, 0.32, 0.32], [3.0, 2.7, 0.3, 0.3], [-3.2, 3.3, 0.3, 0.3]], A.top + 0.09));
  g.add(makeRoofDetails([{ type: 'vent', x: -5.9, z: -1.6 }, { type: 'vent', x: 1.4, z: 3.5 }, { type: 'vent', x: 4.6, z: -0.6 }], A.top));
  badgeAt(g, slot, 0.25, -0.46, A.top, { BY: 5.4, phase: 1.1 });
  dressGround(g, P, [main], { seed: 5, lotIn: 17.25, lotOut: 28.6 });
  g.add(entrySpill(main, ['left'], { opacity: 0.45, height: 1.4 }));
  g.add(entrySpill(main, ['front'], { opacity: 0.35, height: 1.8 }));
  driveSpill(g, R, 3.95);
  placeBuilding(ctx, slot, g);
}

function buildCode(ctx) {
  const { slot, R, P, g } = frame(ctx, 'code');
  // Local: +x = north (screen up), -x = south (camera side), +z = east (core), -z = west (screen left).
  // Reference: a wide podium with rounded corners and warm arched windows (south and west); a set-back middle
  // level of warm windows; a heavy rounded roof slab with a thick hot orange line under it all the way round;
  // a vivid violet deck inside a thick white parapet with an inner step, a notch and small dark units.
  const podium = lpoly([[-6.8, -3.5, 'back', 1.9], [4.9, -3.8, 'right', 1.6], [3.9, 3.4, 'front', 1.6], [-5.2, 3.4, 'left', 1.9]]);
  const PH = 1.6;
  const Pd = blk(podium, {
    floors: 0, lobbyH: PH, lobbyInset: 0.0, seed: 53, ledgeH: 0.1, roof: { overhang: 0.16, thick: 0.3, parapetH: 0.12, parapetW: 0.18 },
    materials: { roof: plainDeck() },
    effects: { roofEdge: false, floorLines: false },
    glass: [{ sides: 'all', style: null, floors: [0] }],
  });
  g.add(Pd.group);
  g.add(glassBand(podium, ['left', 'back'], 0.08, PH - 0.06, 'arch', { seed: 7, inset: 0.025, ei: 1.55 }));
  g.add(glassBand(podium, ['front', 'right'], 0.08, PH - 0.06, 'win', { seed: 5, inset: 0.025, ei: 1.4 }));
  g.add(ribbonBloom(podium, ['left', 'back'], 0.1, PH, 0.4));
  g.add(edgeHighlight(offsetOutline(podium, 0.16), Pd.top + 0.08, { off: 0 }));
  // set-back middle level: warm windows all round (south + west brightest)
  const midO = lpoly([[-4.2, -2.7, 'back', 1.0], [4.2, -3.0, 'right', 1.2], [3.1, 2.7, 'front', 1.5], [-3.4, 2.9, 'left', 1.3]]);
  const y1 = Pd.top + 0.12, y2 = y1 + 1.15;
  g.add(new THREE.Mesh(extrudeOutline(midO, y1 - 0.14, y2), MAT.base));
  g.add(glassBand(midO, ['left', 'back'], y1, y2 - 0.04, 'ribbon', { seed: 12, ei: 2.0 }));
  g.add(glassBand(midO, ['front', 'right'], y1, y2 - 0.04, 'win', { seed: 11, ei: 1.5 }));
  g.add(ribbonBloom(midO, ['left', 'back'], y1, y2, 0.4));
  // terrace on the podium deck round the setback: planters and lamps
  g.add(makeLamps([{ x: -5.4, z: -2.2 }, { x: -5.5, z: 0.0 }, { x: -4.9, z: 2.3 }, { x: 0.0, z: -3.35 }, { x: 3.2, z: -3.4 }], { height: 0.35, size: 0.55, opacity: 0.85, pool: 0 }).translateY(Pd.top));
  g.add(makeTrees([{ x: -5.6, z: -1.1, s: 0.45 }, { x: -5.4, z: 1.2, s: 0.45 }, { x: 1.6, z: -3.45, s: 0.42 }].map((t) => ({ ...t, y: Pd.top })), { seed: 57 }));
  // heavy roof slab (lobed: bulging south and east) with the hot orange line under it, all the way round
  const slabO = lpoly([[-5.0, -3.75, 'back', 1.4], [5.0, -3.6, 'right', 1.6], [3.9, 3.5, 'front', 1.8], [-0.4, 4.1, 'front', 3.5], [-4.6, 3.8, 'left', 1.6], [-5.75, -0.2, 'left', 3.0]]);
  const y3 = y2 + 0.48;
  g.add(underGlow(midO, slabO, y2, { h: 0.42, halo: 0.9, opacity: 0.55 }));
  g.add(slab(slabO, y2, y3, { deck: plainDeck(), bevel: 0.12, highlight: false }));
  const Pp = parapet(slabO, y3, { w: 0.6, h: 0.34 });
  g.add(Pp.group);
  // vivid violet deck, inner step, NW notch block
  g.add(tintDeck(offsetOutline(Pp.inner, 0.02), y3 + 0.012, slot.color, { deck: '#7C3CD2', glow: 0.14 }));
  const step = offsetOutline(Pp.inner, -0.32);
  g.add(new THREE.Mesh(extrudeOutline(Pp.inner, y3, y3 + 0.16, { holes: [step] }), plainMat('#B8A6DA', '#2A2048')));
  g.add(edgeHighlight(Pp.inner, y3 + 0.14, { off: -0.02, intensity: 0.8, color: '#E8E0FA' }));
  g.add(new THREE.Mesh(extrudeOutline(kpoly([[2.6, -2.75], [4.2, -2.85], [4.0, -1.3], [2.7, -1.2]], 0.25), y3, y3 + 0.3, { bevel: 0.05 }), MAT.trim));
  g.add(darkUnits([
    [3.4, -2.0, 0.45, 0.35], [-3.9, -2.4], [-3.7, 2.6], [2.6, 2.5], [0.2, -2.6, 0.3, 0.3], [-1.8, 3.0, 0.3, 0.3],
    [3.6, 0.8, 0.3, 0.42], [-4.4, 0.3, 0.3, 0.4], [1.2, 3.0, 0.28, 0.28], [-1.0, -2.75, 0.34, 0.26],
  ], y3 + 0.16));
  g.add(makeRoofDetails([{ type: 'vent', x: -4.3, z: -3.0 }, { type: 'vent', x: 4.4, z: -3.0 }, { type: 'vent', x: -3.4, z: 3.2 }, { type: 'vent', x: 3.2, z: 2.9 }], y3 + 0.34));
  g.add(entrySpill(podium, ['left'], { opacity: 0.6, height: 2.0 }));
  g.add(entrySpill(podium, ['front', 'back'], { opacity: 0.3, height: 1.5 }));
  badgeAt(g, slot, 0.16, -0.39, y3, { BY: 5.0, phase: 15.3 });
  dressGround(g, P, [podium], { seed: 51 });
  driveSpill(g, R, 3.4);
  placeBuilding(ctx, slot, g);
}

function buildMail(ctx) {
  const { slot, R, P, g } = frame(ctx, 'mail');
  // Local: +x = south (camera side), -x = north, +z = west (core, screen left), -z = east.
  // Reference: a lobed upper block set toward the east (big rounded NE corner, a notch in the east face) under
  // one thick rounded white slab; a thin recessed navy glass band below it; the podium deck a narrow slate
  // ledge; a tall warm mullioned lobby on the south and west faces of the podium.
  const pod = lpoly([[-4.85, -4.85, 'back', 2.8], [5.3, -4.4, 'right', 1.5], [5.4, 2.6, 'front', 1.2], [-3.5, 2.65, 'left', 1.2]]);
  const PH = 1.9;
  const Pd = blk(pod, {
    floors: 0, lobbyH: PH, lobbyInset: 0.14, seed: 57, ledgeH: 0.1, roof: { overhang: 0.14, thick: 0.3, parapetH: 0.1, parapetW: 0.16 },
    materials: { roof: plainMat('#8A90B4', '#1E2240') },
    effects: { roofEdge: false, floorLines: false },
    glass: [{ sides: ['front', 'right'], style: 'lobby', floors: [0], ei: 1.6 }, { sides: ['left', 'back'], style: 'win', floors: [0], ei: 1.25 }],
  });
  g.add(Pd.group);
  g.add(ribbonBloom(pod, ['front', 'right'], 0.08, PH, 0.45));
  g.add(edgeHighlight(offsetOutline(pod, 0.14), Pd.top + 0.06, { off: 0 }));
  const up = lpoly([
    [-4.4, -4.1, 'back', 2.6], [0.2, -4.45, 'back', 0.3], [0.7, -3.85, 'back', 0.25], [1.4, -4.0, 'back', 0.4],
    [4.3, -3.85, 'right', 1.3], [4.75, 2.3, 'front', 1.0], [-3.0, 2.4, 'left', 1.0],
  ]);
  const y1 = Pd.top + 0.1, y2 = y1 + 1.2;
  const band = offsetOutline(up, -0.4);
  g.add(new THREE.Mesh(extrudeOutline(band, y1 - 0.12, y2), MAT.base));
  g.add(glassBand(band, 'all', y1, y2 - 0.02, 'blue', { seed: 4, inset: 0.01 }));
  // one thick rounded slab with a low flush parapet (reads as a single rim), one highlight
  const y3 = y2 + 0.62;
  g.add(slab(up, y2, y3, { deck: plainDeck(), bevel: 0.2, highlight: false }));
  const Pp = parapet(up, y3, { w: 0.55, h: 0.3 });
  g.add(Pp.group);
  g.add(eaveGlow(band, y2 + 0.01, { off: 0.04, h: 0.06, opacity: 0.45 }));
  // lilac deck lit pink under the badge
  g.add(tintDeck(offsetOutline(Pp.inner, 0.02), y3 + 0.012, slot.color, { deck: '#A96CCB', glow: 0.1 }));
  g.add(darkUnits([[-3.4, -2.9, 0.36, 0.3], [3.6, -3.2], [3.9, 1.6, 0.3, 0.3], [-2.4, 1.6, 0.3, 0.3], [0.6, -3.6, 0.3, 0.3]], y3));
  g.add(makeRoofDetails([{ type: 'vent', x: -2.0, z: -3.4 }, { type: 'vent', x: 3.0, z: 1.5 }], y3));
  g.add(makeRoofDetails([{ type: 'vent', x: 5.0, z: -3.6 }, { type: 'vent', x: 5.05, z: 1.6 }], Pd.top));
  {
    const badge = makeBadge(slot.icon, slot.color, { size: BADGE_SIZE, halo: 1.1, haloOpacity: 0.16, roofGlowY: y3 + 0.06 - 5.3, poolOpacity: 0.27, phase: 16.5 });
    badge.position.set(0.08, 5.3, -1.46);
    g.add(badge);
  }
  dressGround(g, P, [pod], { seed: 55 });
  g.add(entrySpill(pod, ['front', 'right'], { opacity: 0.6, height: 2.0 }));
  driveSpill(g, R, 2.6);
  placeBuilding(ctx, slot, g);
}

/**
 * Automation / people: chamfered wedges, fitted separately (the reference pair is not an exact mirror).
 * Edge tags: 'back' = the lettered lobby face toward the camera, 'end' / 'end2' = the far end (ribbed and round
 * on automation), 'front' = the long side toward the core, 'side' = the glazed side, 'chamfer' = a cut corner.
 * Roof: a dark navy court under the badge, pale deck elsewhere.
 */
function wingBlock(ctx, id, { outline, seed, lobbyH, floorH, thick, ribs, court, courtMat, panel, badge, units, vents }) {
  const { slot, R, P, g } = frame(ctx, id);
  const main = lpoly(outline);
  const tags = new Set(main.tags);
  const others = ['front', 'chamfer', 'side', 'end2'].filter((t) => tags.has(t));
  const OV = 0.32;
  const A = blk(main, {
    floors: 1, lobbyH, lobbyInset: 0.16, floorH, seed, ledge: -0.03, ledgeH: 0.1,
    roof: { overhang: OV, thick, parapetH: 0.32, parapetW: 0.5 },
    materials: { roof: plainDeck() },
    effects: { roofEdge: '#E4E8FF', floorLines: false, intensity: 0.2 },
    glass: [
      { sides: ['back'], style: 'bright', floors: [0], ei: 1.7 },
      { sides: ['back'], style: 'ribbon', floors: [1], ei: 1.8 },
      { sides: ['end'], style: ribs ? 'fins' : 'win', floors: [0, 1] },
      { sides: others, style: 'ribbon', floors: [1], ei: 1.6 },
      { sides: others, style: 'win', floors: [0] },
    ],
  });
  g.add(A.group);
  if (ribs) g.add(ribFins(offsetOutline(main, 0.02), ['end'], 0.05, A.top - thick, { spacing: 0.46, depth: 0.3, width: 0.15 }));
  g.add(sideLines(main, ['back'], [lobbyH + 0.02], { intensity: 1.7 }));
  g.add(ribbonBloom(main, ['back'], 0.1, lobbyH, 0.5));
  g.add(ribbonBloom(main, ['back', ...others], lobbyH + 0.08, lobbyH + floorH - 0.05, 0.36));
  g.add(underGlow(main, offsetOutline(main, OV), A.top - thick, { h: 0.12, halo: 0.45, opacity: 0.34 }));
  // big glowing letters across the lobby glass, with mullions behind them
  g.add(letterSign(offsetOutline(main, 0.0), ['back'], lobbyH * 0.2, lobbyH - 0.1, seed));
  // dark navy court with pale lips under the badge
  g.add(makeRoofCourt(court, A.top, { rim: 0.22, rimH: 0.16, material: courtMat }));
  g.add(edgeHighlight(court, A.top + 0.14, { off: 0.0, intensity: 0.9 }));
  if (panel) {
    g.add(new THREE.Mesh(extrudeOutline(panel, A.top - 0.02, A.top + 0.22, { bevel: 0.05 }), MAT.trim));
    g.add(deckFill(offsetOutline(panel, -0.22), A.top + 0.222, plainMat('#BDBADF', '#26243E')));
    g.add(edgeHighlight(panel, A.top + 0.19, { off: 0.0, intensity: 0.95 }));
  }
  g.add(darkUnits(units, A.top));
  g.add(makeRoofDetails(vents.map(([x, z]) => ({ type: 'vent', x, z })), A.top));
  badgeAt(g, slot, badge[0], badge[1], A.top, { BY: badge[2], phase: seed * 0.13 });
  dressGround(g, P, [main], { seed: seed % 13 });
  g.add(entrySpill(main, ['back'], { opacity: 0.6, height: 2.0 }));
  driveSpill(g, R, Math.max(...main.pts.filter((p) => Math.abs(p[0]) < 0.4).map((p) => p[1]), 1));
  placeBuilding(ctx, slot, g);
}
// automation, local: +x = NW (screen up-left), -x = SE, +z = NE (core), -z = SW (camera-left).
// Reference: a round ribbed end at the screen-left, the lettered warm lobby face turned to the SW, a glazed
// side down to the spoke, the badge over a dark navy-grey court on the roof.
const buildAutomation = (ctx) => wingBlock(ctx, 'automation', {
  outline: [[-7.15, -1.95, 'back', 0.6], [-1.05, -3.7, 'end', 1.1], [2.8, -2.3, 'end', 1.4], [1.95, 0.55, 'front', 0.7], [-4.85, 2.85, 'side', 0.5]],
  seed: 61, lobbyH: 1.85, floorH: 1.15, thick: 0.55, ribs: true, courtMat: navyGrey(),
  court: kpoly([[-0.6, -2.2], [0.4, 0.3], [-4.0, 1.95], [-5.5, -0.8]], [0.6, 0.5, 0.6, 0.7]),
  panel: null,
  badge: [-3.15, -0.23, 4.9],
  units: [[-6.0, -1.4, 0.3, 0.3], [1.4, -2.0, 0.34, 0.28], [-4.3, 2.3, 0.28, 0.28], [1.0, 0.3, 0.28, 0.28], [-2.6, -2.9, 0.3, 0.26]],
  vents: [[-6.4, -1.5], [1.6, -0.3], [-1.4, -3.1]],
});
// people, local: +x = SW (screen down-left), -x = NE, +z = NW (core), -z = SE (camera-right).
// Reference: a chamfered hexagon (cut front-left corner), the lettered warm lobby face turned to the SE under
// a thick slab, a dark navy recess on the back roof holding the badge, a pale raised panel at the front.
const buildPeople = (ctx) => wingBlock(ctx, 'people', {
  outline: [[7.95, -3.55, 'side', 0.7], [5.7, 1.6, 'chamfer', 0.25], [4.5, 2.85, 'front', 0.3], [-0.2, 2.0, 'end', 0.9], [-2.5, -3.3, 'end2', 0.8], [-0.25, -5.95, 'back', 0.8]],
  seed: 71, lobbyH: 1.8, floorH: 1.1, thick: 0.68, ribs: false, courtMat: navyMat(),
  court: kpoly([[3.4, 1.5], [0.3, 1.5], [-1.4, -2.5], [1.3, -2.6]], [0.5, 0.6, 0.5, 0.5]),
  panel: kpoly([[6.6, -2.9], [4.9, 0.9], [2.9, -0.7], [1.0, -4.8]], [0.5, 0.45, 0.45, 0.5]),
  badge: [2.48, -1.22, 4.9],
  units: [[7.0, -3.2, 0.3, 0.3], [-1.6, -3.0, 0.34, 0.28], [4.1, 2.2, 0.28, 0.28], [-0.2, -5.2, 0.28, 0.28], [0.3, 1.6, 0.3, 0.26]],
  vents: [[7.3, -2.8], [-1.9, -1.8], [0.8, -5.4]],
});

const CAL = [[-5.55, -5.05], [4.95, -5.05], [3.45, 1.5], [-3.85, 1.5]];
/** Sharp convex polygon moved inward by d (negative d grows it), same winding as the kit outlines. */
function insetPoly(pts, d) {
  const n = pts.length, lines = [];
  for (let i = 0; i < n; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % n], L = Math.hypot(bx - ax, bz - az);
    const nx = (bz - az) / L, nz = -(bx - ax) / L; // outward (offsetOutline convention)
    lines.push([ax - nx * d, az - nz * d, (bx - ax) / L, (bz - az) / L]);
  }
  return lines.map((l, i) => {
    const [px, pz, ux, uz] = lines[(i + n - 1) % n], [qx, qz, vx, vz] = l;
    const den = ux * vz - uz * vx, t = ((qx - px) * vz - (qz - pz) * vx) / den;
    return [px + ux * t, pz + uz * t];
  });
}

function buildCalendar(ctx) {
  const { slot, R, P, g } = frame(ctx, 'calendar');
  // Local: back (-z) = south, toward the camera; +x = screen left. Reference: a trapezoid flaring wide toward
  // the camera. The camera face: pale corner blocks with dark windows; between them an upper row of small warm
  // windows over a bright lobby row with dark mullions, under a thin white slab. A violet-magenta deck inside a
  // thick white parapet, with a low inner white rim; dark units at the corners.
  const main = lpoly(CAL.map(([x, z], i) => [x, z, ['back', 'right', 'front', 'left'][i], i < 2 ? 0.6 : 0.7]));
  const LH = 2.45, TH = 0.32, OV = 0.4;
  const A = blk(main, {
    floors: 0, lobbyH: LH, lobbyInset: 0.36, seed: 81, roof: { overhang: OV, thick: TH, parapetH: 0.4, parapetW: 0.62 },
    materials: { roof: plainDeck() },
    effects: { roofEdge: '#E4E8FF', floorLines: false },
    glass: [{ sides: 'all', style: null, floors: [0] }],
  });
  g.add(A.group);
  const lobbyO = offsetOutline(main, -0.36);
  const LB = 1.62; // lobby row height; small warm windows above it up to the slab
  g.add(glassBand(lobbyO, ['back'], 0.05, LB, 'bright', { seed: 83, inset: 0.02, ei: 1.6 }));
  g.add(glassBand(lobbyO, ['back'], LB + 0.1, LH - 0.32, 'win', { seed: 84, inset: 0.02, ei: 1.9 }));
  g.add(ribbonBloom(lobbyO, ['back'], 0.05, LB, 0.55));
  g.add(sideLines(lobbyO, ['back'], [LB + 0.06], { off: 0.04, intensity: 1.4 }));
  g.add(glassBand(lobbyO, ['left', 'right', 'front'], 0.06, LH - 0.08, 'win', { seed: 85, inset: 0.02, ei: 1.15 }));
  // pale corner blocks at both camera-side corners, with dark windows
  const endGeos = [], winGeos = [];
  for (const [cx, w] of [[-4.55, 1.6], [3.95, 1.6]]) {
    const b = new THREE.BoxGeometry(w, LH, 1.4); b.translate(cx, LH / 2, -4.4); endGeos.push(b);
    for (const wy of [0.65, 1.6]) { const pl = new THREE.PlaneGeometry(w * 0.6, 0.5); pl.rotateY(Math.PI); pl.translate(cx, wy, -5.105); winGeos.push(pl); }
  }
  g.add(mergedMesh(endGeos, paleWall()));
  g.add(mergedMesh(winGeos, plainMat('#1A2140', '#0A1030')));
  g.add(edgeHighlight(offsetOutline(main, OV), LH + 0.05, { off: 0, intensity: 1.0 }));
  g.add(eaveGlow(main, LH + 0.01, { off: -0.33, h: 0.1, opacity: 0.8 }));
  // violet-magenta deck inside the white parapet, a low inner white rim, then the deck again
  // (offsetting the rounded outline this far inward folds its corners, so the inner rings come from the sharp
  // corner polygon instead)
  const sharp = insetPoly(CAL, -OV);
  const deckO = kpoly(insetPoly(sharp, 0.6), 0.5), rimO = kpoly(insetPoly(sharp, 1.02), 0.4), rimI = kpoly(insetPoly(sharp, 1.24), 0.3);
  g.add(tintDeck(deckO, A.top + 0.012, slot.color, { deck: '#B24CCB', glow: 0.18 }));
  g.add(new THREE.Mesh(extrudeOutline(rimO, A.top, A.top + 0.15, { holes: [rimI], bevel: 0.03 }), MAT.trim));
  g.add(edgeHighlight(rimO, A.top + 0.13, { off: 0, intensity: 0.85, color: '#F0E8FF' }));
  g.add(tintDeck(rimI, A.top + 0.02, slot.color, { deck: '#B24CCB', glow: 0.1 }));
  g.add(darkUnits([[-4.95, -4.5, 0.42, 0.42, 0.3], [4.35, -4.5, 0.42, 0.42, 0.3], [-3.5, 1.0, 0.34, 0.34], [2.9, 1.0, 0.34, 0.34]], A.top));
  g.add(makeRoofDetails([{ type: 'vent', x: -4.3, z: -1.0 }, { type: 'vent', x: 3.7, z: -1.0 }], A.top));
  badgeAt(g, slot, -0.07, -2.78, A.top, { BY: 4.1, phase: 1.7, pool: 0.75 });
  dressGround(g, P, [main], { seed: 11, lotOut: 28.6 });
  g.add(entrySpill(offsetOutline(lobbyO, -0.02), ['back'], { height: 1.4, opacity: 0.35 }));
  driveSpill(g, R, 1.5);
  // warm spill on the camera-side forecourt (the reference lobby light pours onto the road)
  const sp = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.4), glowMaterial('#FFA040', 'radial', 0.5));
  sp.rotation.x = -Math.PI / 2; sp.position.set(-0.3, 0.11, -6.1); sp.renderOrder = 2; g.add(sp);
  placeBuilding(ctx, slot, g);
}

export default function build(ctx) {
  const parts = {
    hq: buildHQ, docs: buildDocs, code: buildCode, mail: buildMail,
    automation: buildAutomation, people: buildPeople, calendar: buildCalendar,
  };
  for (const [name, fn] of Object.entries(parts)) {
    try { fn(ctx); } catch (err) { console.error(`[inner] ${name} failed`, err); }
  }
}
