/*
 * Shared building kit. Every building module builds from these data-driven helpers.
 *
 * Coordinates: helpers work in a building-LOCAL frame. Origin = the layout slot centre on the
 * ground, +Y up, local -Z points radially OUTWARD (away from the core), local +Z points at the
 * core, local +X is the clockwise tangent of the ring. placeBuilding() maps this frame onto the
 * slot. An "outline" is a closed footprint polygon in local (x, z) with a side tag per point:
 *   'back' (outer side), 'right' (+X end), 'front' (core-facing side), 'left' (-X end)
 *   and corner tags 'back-right', 'front-right', 'front-left', 'back-left'.
 *
 * Typical use (see knowledge.js):
 *   const g = new THREE.Group();
 *   const o = sectorOutline({ r: slot.r, rIn: 18, rOut: 26, a0: -15, a1: 15, corners: [1, 2, 1, 1] });
 *   g.add(makeBlock(o, { floors: 3 }).group, makeBadge('document', '#3A86FF'), ...);
 *   placeBuilding(ctx, slot, g);
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { iconSvg } from '../../icons/icons.js';

const D2R = Math.PI / 180;
const _cache = new Map();
const cached = (key, make) => {
  if (!_cache.has(key)) _cache.set(key, make());
  return _cache.get(key);
};

// ------------------------------------------------------------------------------------------
// Palette + small utils
// ------------------------------------------------------------------------------------------
export const PALETTE = {
  facade: '#C9C5E6',   // light lavender concrete
  trim: '#E6E4F8',     // parapets, ledges, roof rims
  roof: '#B9B8D8',     // roof deck (lighter than walls under the light)
  court: '#5E6189',    // sunken roof court floor
  glass: '#1A2246',
  base: '#151827',     // dark plinth
  warm: '#FFF0B3',     // building base glow (sheet sec 3)
  lawn: '#2C6A2A',
  curb: '#4A4D68',
  paving: '#272A40',
};

/** Seeded PRNG (mulberry32). rng() -> [0,1). */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Local position on a ring-following building: rho = distance from the core, aDeg = tangential angle (+ = +X). */
export function sectorPoint(r, rho, aDeg) {
  const a = aDeg * D2R;
  return { x: rho * Math.sin(a), z: r - rho * Math.cos(a) };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function canvasTexture(c, { repeat = false, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
function hexMix(a, b, k) {
  return '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();
}

// ------------------------------------------------------------------------------------------
// Textures
// ------------------------------------------------------------------------------------------
/**
 * Window band texture: one floor tall, `bays` bays wide, tiles horizontally (u repeats).
 * style: 'warm' office windows | 'lobby' tall warm glass | 'screen' cool-blue lobby screens |
 *        'ribbon' continuous warm glass strip with thin dark mullions |
 *        'dark' recessed dark glass with a concentrated bright warm strip and white vertical fins.
 * Returns { map, emissiveMap, bays }.
 */
export function windowBandTexture({ style = 'warm', bays = 16, seed = 7 } = {}) {
  return cached(`band:${style}:${bays}:${seed}`, () => {
    const bw = 64, W = bays * bw, H = 128;
    const alb = canvas(W, H), emi = canvas(W, H);
    const a = alb.getContext('2d'), e = emi.getContext('2d');
    const rng = makeRng(seed);
    const screen = style === 'screen', lobby = style === 'lobby';
    // wall / frame
    a.fillStyle = screen ? '#20253F' : PALETTE.facade; a.fillRect(0, 0, W, H);
    e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
    const top = lobby ? 8 : screen ? 18 : 22, bot = lobby ? 120 : screen ? 108 : 100;
    if (style === 'streak') {
      // futuristic lit ribbon glazing (knowledge front, reference): dark warm glass split by thin dark
      // mullions, with TWO hot light rows per floor whose cores peak near-white (bloom) and fall off
      // through saturated orange into the dark glass. Gaps and mullions keep it reading as glass.
      a.fillStyle = '#E4E2F4'; a.fillRect(0, 0, W, H);
      const gt = 4, gb = 124;
      a.fillStyle = '#2A1A12'; a.fillRect(0, gt, W, gb - gt);
      const gl = e.createLinearGradient(0, gt, 0, gb);
      gl.addColorStop(0, '#1A0C05'); gl.addColorStop(1, '#3A1A08');
      e.fillStyle = gl; e.fillRect(0, gt, W, gb - gt);
      for (const [cy, hh] of [[36, 24], [92, 26]]) {
        let x = 0;
        while (x < W) {
          const len = bw * (0.7 + rng() * 2.2), k = rng() < 0.08 ? 0.35 : 0.8 + rng() * 0.2;
          const g = e.createLinearGradient(0, cy - hh, 0, cy + hh);
          g.addColorStop(0, 'rgba(255,120,30,0)');
          g.addColorStop(0.3, `rgba(255,150,55,${0.75 * k})`);
          g.addColorStop(0.5, `rgba(255,${200 + Math.round(40 * k)},${170 + Math.round(55 * k)},${k})`);
          g.addColorStop(0.7, `rgba(255,150,55,${0.75 * k})`);
          g.addColorStop(1, 'rgba(255,120,30,0)');
          e.fillStyle = g; e.fillRect(x, cy - hh, len, hh * 2);
          a.fillStyle = 'rgba(255,200,140,0.5)'; a.fillRect(x, cy - 3, len, 6);
          x += len + (rng() < 0.3 ? 3 + rng() * 6 : 0);
        }
      }
      // interior silhouettes: a few soft darker blobs between the rows
      for (let i = 0; i < bays; i++) if (rng() < 0.4) {
        e.fillStyle = 'rgba(0,0,0,0.35)'; e.fillRect(i * bw + rng() * bw * 0.6, 54 + rng() * 10, 6 + rng() * 10, 22);
      }
      // thin dark mullions (two per bay) and crisp bright head/sill edges
      for (let i = 0; i < bays * 2; i++) {
        const x = i * (bw / 2);
        a.fillStyle = '#1A1420'; a.fillRect(x - 1.5, gt, 3, gb - gt);
        e.fillStyle = '#000'; e.fillRect(x - 1.5, gt, 3, gb - gt);
      }
      e.fillStyle = 'rgba(255,214,170,0.9)'; e.fillRect(0, gt, W, 2); e.fillRect(0, gb - 2, W, 2);
      return { map: canvasTexture(alb, { repeat: true }), emissiveMap: canvasTexture(emi, { repeat: true }), bays };
    }
    if (style === 'knGlass') {
      // knowledge front (reference, round 7): glass-dominant ribbon glazing glowing deep warm orange. A slim
      // dark warm-grey spandrel at the head of each floor, then floor-to-ceiling glass: a deep amber base
      // glow, saturated orange light pools that vary along the length, sparse hot cream cores (they bloom)
      // and dark interior gaps, crisp dark mullions every bay (1.2 world units) with a half-bay fin, a hot
      // ceiling light line and a warm sill line. High contrast so it reads as lit glass, not a pale stripe.
      a.fillStyle = '#2E2420'; a.fillRect(0, 0, W, H);
      e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
      const sp = 16, gb = 124;
      a.fillStyle = '#3C302A'; a.fillRect(0, 0, W, sp);
      a.fillStyle = '#20120A'; a.fillRect(0, sp, W, gb - sp);
      const base = e.createLinearGradient(0, sp, 0, gb);
      base.addColorStop(0, '#6A2A06'); base.addColorStop(0.6, '#7A3408'); base.addColorStop(1, '#9A4A10');
      e.fillStyle = base; e.fillRect(0, sp, W, gb - sp);
      // light pools: saturated orange, varying strength along the length
      for (let i = 0; i < bays * 2; i++) {
        const cx = (i / 2) * bw + rng() * bw * 0.5, cy = sp + 30 + rng() * 50, rr = bw * (0.45 + rng() * 0.8);
        const k = rng() < 0.2 ? 0.25 : 0.55 + rng() * 0.45;
        const hg = e.createRadialGradient(cx, cy, 0, cx, cy, rr);
        hg.addColorStop(0, `rgba(255,170,60,${k})`); hg.addColorStop(0.5, `rgba(255,135,30,${k * 0.6})`); hg.addColorStop(1, 'rgba(255,100,20,0)');
        e.fillStyle = hg; e.fillRect(cx - rr, sp, rr * 2, gb - sp);
      }
      // sparse hot cream cores
      for (let i = 0; i < bays; i++) if (rng() < 0.75) {
        const cx = i * bw + bw * (0.2 + rng() * 0.6), cy = sp + 34 + rng() * 40, rr = bw * (0.3 + rng() * 0.35);
        const hg = e.createRadialGradient(cx, cy, 0, cx, cy, rr);
        hg.addColorStop(0, 'rgba(255,240,200,0.95)'); hg.addColorStop(0.5, 'rgba(255,200,120,0.6)'); hg.addColorStop(1, 'rgba(255,160,60,0)');
        e.fillStyle = hg; e.fillRect(cx - rr, sp, rr * 2, gb - sp);
      }
      // dark interior gaps (furniture / people silhouettes)
      for (let i = 0; i < bays * 2; i++) if (rng() < 0.4) {
        e.fillStyle = `rgba(20,6,0,${0.45 + rng() * 0.35})`; e.fillRect(rng() * W, sp + 50 + rng() * 30, 4 + rng() * 12, 30 + rng() * 20);
      }
      // hot ceiling light line right under the spandrel, warm sill line at the bottom
      const lg = e.createLinearGradient(0, sp, 0, sp + 14);
      lg.addColorStop(0, 'rgba(255,230,180,0.95)'); lg.addColorStop(1, 'rgba(255,160,60,0)');
      e.fillStyle = lg; e.fillRect(0, sp, W, 14);
      e.fillStyle = 'rgba(255,190,110,0.9)'; e.fillRect(0, gb - 3, W, 3);
      for (let i = 0; i < bays; i++) { // crisp mullions (one per bay) + a slim half-bay fin
        const mx = i * bw;
        a.fillStyle = '#18100E'; a.fillRect(mx - 2.5, sp, 5, gb - sp);
        e.fillStyle = 'rgba(0,0,0,0.92)'; e.fillRect(mx - 2.5, sp, 5, gb - sp);
        e.fillStyle = 'rgba(0,0,0,0.6)'; e.fillRect(mx + bw / 2 - 1, sp, 2, gb - sp);
      }
      return { map: canvasTexture(alb, { repeat: true }), emissiveMap: canvasTexture(emi, { repeat: true }), bays };
    }
    if (style === 'knLobby') {
      // knowledge lobby: the brightest, hottest band (reference): glowing orange-cream glass with a hot
      // ceiling line, warm interior columns and dark slim mullions
      const gt = 2, gb = 126;
      a.fillStyle = '#8A6040'; a.fillRect(0, 0, W, H);
      e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
      const gl = e.createLinearGradient(0, gt, 0, gb);
      gl.addColorStop(0, '#FFC070'); gl.addColorStop(0.35, '#FF9F1C'); gl.addColorStop(0.75, '#FFB860'); gl.addColorStop(1, '#FFF0B3');
      e.fillStyle = gl; e.fillRect(0, gt, W, gb - gt);
      e.fillStyle = 'rgba(255,246,220,1)'; e.fillRect(0, gt + 6, W, 6);
      for (let i = 0; i < bays * 3; i++) {
        const x = rng() * W, w = 3 + rng() * 6;
        e.fillStyle = rng() < 0.55 ? 'rgba(255,244,214,0.75)' : 'rgba(110,44,6,0.55)';
        e.fillRect(x, gt + 18, w, gb - gt - 34);
      }
      for (let i = 0; i < bays; i++) {
        const x = i * bw;
        a.fillStyle = '#2A2028'; a.fillRect(x - 2, gt, 4, gb - gt);
        e.fillStyle = 'rgba(30,12,4,0.95)'; e.fillRect(x - 2, gt, 4, gb - gt);
      }
      return { map: canvasTexture(alb, { repeat: true }), emissiveMap: canvasTexture(emi, { repeat: true }), bays };
    }
    if (style === 'hotRibbon') {
      // continuous futuristic ribbon glazing glowing HOT (knowledge front, reference): near-black warm glass
      // with ONE thick light row per floor whose core is near-white #FFF0B3 and whose flanks run through
      // saturated #FF9F1C orange into the dark glass, so each floor blooms as a solid warm ribbon. A crisp
      // warm sill line at the bottom, faint mullions and a few soft interior shadows keep it reading as glass.
      a.fillStyle = '#E8E6F6'; a.fillRect(0, 0, W, H);
      const gt = 3, gb = 125;
      a.fillStyle = '#1E120C'; a.fillRect(0, gt, W, gb - gt);
      e.fillStyle = '#120804'; e.fillRect(0, gt, W, gb - gt);
      const cy = 64, hh = 50;
      let x = 0;
      while (x < W) {
        const len = bw * (1.2 + rng() * 2.6), k = rng() < 0.06 ? 0.55 : 0.88 + rng() * 0.12;
        const g = e.createLinearGradient(0, cy - hh, 0, cy + hh);
        g.addColorStop(0, 'rgba(230,90,10,0)');
        g.addColorStop(0.18, `rgba(255,120,24,${0.6 * k})`);
        g.addColorStop(0.38, `rgba(255,159,28,${k})`);
        g.addColorStop(0.5, `rgba(255,${222 + Math.round(24 * k)},${160 + Math.round(40 * k)},${k})`);
        g.addColorStop(0.62, `rgba(255,159,28,${k})`);
        g.addColorStop(0.84, `rgba(255,120,24,${0.55 * k})`);
        g.addColorStop(1, 'rgba(230,90,10,0)');
        e.fillStyle = g; e.fillRect(x, cy - hh, len, hh * 2);
        a.fillStyle = 'rgba(255,190,120,0.55)'; a.fillRect(x, cy - 14, len, 28);
        x += len + (rng() < 0.25 ? 2 + rng() * 4 : 0);
      }
      for (let i = 0; i < bays; i++) if (rng() < 0.35) { // soft interior silhouettes
        e.fillStyle = 'rgba(40,14,0,0.35)'; e.fillRect(i * bw + rng() * bw * 0.6, cy - 18 + rng() * 10, 5 + rng() * 9, 30);
      }
      for (let i = 0; i < bays; i++) { // faint mullions
        const mx = i * bw;
        a.fillStyle = '#1A1218'; a.fillRect(mx - 1, gt, 2, gb - gt);
        e.fillStyle = 'rgba(0,0,0,0.55)'; e.fillRect(mx - 1, gt, 2, gb - gt);
      }
      e.fillStyle = 'rgba(255,214,160,0.95)'; e.fillRect(0, gb - 3, W, 3); // crisp warm sill line
      e.fillStyle = 'rgba(255,190,120,0.5)'; e.fillRect(0, gt, W, 2);
      return { map: canvasTexture(alb, { repeat: true }), emissiveMap: canvasTexture(emi, { repeat: true }), bays };
    }
    if (style === 'streakLobby') {
      // bright warm-cream lobby glass with interior streaks (light columns, ceiling line, warm floor)
      const gt = 4, gb = 126;
      a.fillStyle = '#7A6248'; a.fillRect(0, gt, W, gb - gt);
      const gl = e.createLinearGradient(0, gt, 0, gb);
      gl.addColorStop(0, '#E8A860'); gl.addColorStop(0.5, '#FFD49A'); gl.addColorStop(1, '#FFF0D2');
      e.fillStyle = gl; e.fillRect(0, gt, W, gb - gt);
      e.fillStyle = 'rgba(255,248,232,0.95)'; e.fillRect(0, gt + 8, W, 5); // ceiling light line
      for (let i = 0; i < bays * 3; i++) { // vertical interior streaks
        const x = rng() * W, w = 2 + rng() * 5;
        e.fillStyle = rng() < 0.5 ? 'rgba(255,250,236,0.7)' : 'rgba(120,60,20,0.45)';
        e.fillRect(x, gt + 16, w, gb - gt - 30);
      }
      for (let i = 0; i < bays; i++) {
        const x = i * bw;
        a.fillStyle = '#2A2028'; a.fillRect(x - 2, gt, 4, gb - gt);
        e.fillStyle = 'rgba(40,20,10,0.9)'; e.fillRect(x - 2, gt, 4, gb - gt);
      }
      return { map: canvasTexture(alb, { repeat: true }), emissiveMap: canvasTexture(emi, { repeat: true }), bays };
    }
    if (style === 'cream') {
      // continuous ribbon glazing glowing warm cream / peach / near-white (knowledge front, reference):
      // tall glass, few faint mullions, soft horizontal brightness variation and hot highlights.
      const gt = 6, gb = 122;
      a.fillStyle = '#E8E4F4'; a.fillRect(0, 0, W, H);
      a.fillStyle = '#6A5644'; a.fillRect(0, gt, W, gb - gt);
      // smooth brightness variation along the band (overlapping soft cells, no hard bay edges)
      const base = e.createLinearGradient(0, gt, 0, gb);
      base.addColorStop(0, '#7A4A22'); base.addColorStop(0.35, '#B87A44'); base.addColorStop(1, '#D9A06A');
      e.fillStyle = base; e.fillRect(0, gt, W, gb - gt);
      for (let i = 0; i < bays * 2; i++) {
        const cx = (i + 0.5) * (bw / 2) + (rng() - 0.5) * bw * 0.4, cy = gt + (gb - gt) * (0.45 + rng() * 0.35);
        const rr = bw * (0.45 + rng() * 0.6), hot = rng();
        const col = hot < 0.18 ? '255,236,205' : hot < 0.6 ? '255,212,160' : '248,190,128';
        const al = hot < 0.12 ? 0.25 : 0.5 + rng() * 0.45;
        const hg = e.createRadialGradient(cx, cy, 0, cx, cy, rr);
        hg.addColorStop(0, `rgba(${col},${al})`); hg.addColorStop(0.6, `rgba(${col},${al * 0.45})`); hg.addColorStop(1, `rgba(${col},0)`);
        e.fillStyle = hg; e.fillRect(cx - rr, gt, rr * 2, gb - gt);
      }
      // bright head line + softer sill glow
      e.fillStyle = 'rgba(255,226,180,0.55)'; e.fillRect(0, gt, W, 2);
      const sl = e.createLinearGradient(0, gb - 14, 0, gb);
      sl.addColorStop(0, 'rgba(255,230,190,0)'); sl.addColorStop(1, 'rgba(255,236,200,0.6)');
      e.fillStyle = sl; e.fillRect(0, gb - 14, W, 14);
      // few, faint mullions (one per bay)
      for (let i = 0; i < bays; i++) {
        const x = i * bw;
        a.fillStyle = '#4A3C34'; a.fillRect(x - 1, gt, 2, gb - gt);
        e.fillStyle = 'rgba(0,0,0,0.28)'; e.fillRect(x - 1, gt, 2, gb - gt);
      }
      return { map: canvasTexture(alb, { repeat: true }), emissiveMap: canvasTexture(emi, { repeat: true }), bays };
    }
    if (style === 'ribbon' || style === 'dark') {
      const dark = style === 'dark';
      const gt = dark ? 14 : 12, gb = dark ? 114 : 112; // glass extents (ribbon: tall, glass-dominated)
      a.fillStyle = dark ? '#151A2C' : '#3A2616'; a.fillRect(0, gt, W, gb - gt);
      for (let i = 0; i < bays; i++) {
        const x0 = i * bw, dim = rng() < (dark ? 0.1 : 0.07);
        // deep warm amber/orange (reference ribbon glass), not cream
        const hue = dark
          ? ['#FFB45A', '#FFC676', '#FFA347', '#FFD99A', '#FFBD66'][Math.floor(rng() * 5)]
          : rng() < 0.1 ? '#FFC468' // occasional hot, near-white bay (reference highlights)
            : ['#FF8A2A', '#FF902E', '#FF8424', '#FF9636', '#FF8C2C'][Math.floor(rng() * 5)];
        const k = dim ? 0.12 : 0.86 + rng() * 0.14;
        if (dark) {
          // bright strip in the middle of the dark glass, falling off above/below
          const mid = 64 + (rng() - 0.5) * 10, hh = 14 + rng() * 10;
          const gr = e.createLinearGradient(0, mid - hh * 1.8, 0, mid + hh * 1.8);
          gr.addColorStop(0, '#000'); gr.addColorStop(0.35, hexMix('#000000', hue, k)); gr.addColorStop(0.5, hexMix('#000000', hue, Math.min(1, k * 1.15)));
          gr.addColorStop(0.65, hexMix('#000000', hue, k)); gr.addColorStop(1, '#000');
          e.fillStyle = gr; e.fillRect(x0, mid - hh * 1.8, bw, hh * 3.6);
          e.fillStyle = hexMix('#000000', '#3A86FF', 0.12); e.fillRect(x0, gt, bw, 6); // faint cool reflection at the head
        } else {
          // deep amber glass: darker burnt orange at the head, glowing hottest toward the sill
          // (interior light pooling). Kept saturated so tone mapping does not wash it to cream.
          const deep = hexMix(hue, '#FF6A12', 0.45);
          const gr = e.createLinearGradient(0, gt, 0, gb);
          gr.addColorStop(0, hexMix('#000000', hexMix(deep, '#C2400A', 0.4), k * 0.62));
          gr.addColorStop(0.45, hexMix('#000000', deep, k * 0.86)); gr.addColorStop(1, hexMix('#000000', hue, k));
          e.fillStyle = gr; e.fillRect(x0, gt, bw, gb - gt);
          a.fillStyle = hexMix('#2A1608', hue, 0.12); a.fillRect(x0, gt, bw, gb - gt);
          // hot interior pools (ceiling lights / lit rooms seen through the glass)
          if (!dim && rng() < 0.42) {
            const cx = x0 + bw * (0.25 + rng() * 0.5), cy = gt + (gb - gt) * (0.55 + rng() * 0.25), rr = 10 + rng() * 12;
            const hg = e.createRadialGradient(cx, cy, 0, cx, cy, rr);
            hg.addColorStop(0, 'rgba(255,214,150,0.85)'); hg.addColorStop(0.5, 'rgba(255,170,80,0.35)'); hg.addColorStop(1, 'rgba(255,140,40,0)');
            e.fillStyle = hg; e.fillRect(x0, gt, bw, gb - gt);
          }
          // thin bright head/sill lines framing the ribbon (crisp futuristic glazing edge)
          e.fillStyle = hexMix('#000000', '#FFB868', 0.6); e.fillRect(x0, gt, bw, 2); e.fillRect(x0, gb - 3, bw, 3);
        }
      }
      // mullions / fins
      for (let i = 0; i < bays * 2; i++) {
        const x = i * (bw / 2);
        if (dark) {
          a.fillStyle = '#F2F2FF'; a.fillRect(x - 3, 0, 6, H); // white fin (full height)
          e.fillStyle = '#1C1C26'; e.fillRect(x - 3, 0, 6, H);
        } else {
          a.fillStyle = '#2A2230'; a.fillRect(x - 1.5, gt, 3, gb - gt);
          e.fillStyle = '#000'; e.fillRect(x - 1.5, gt, 3, gb - gt);
        }
      }
      return { map: canvasTexture(alb, { repeat: true }), emissiveMap: canvasTexture(emi, { repeat: true }), bays };
    }
    for (let i = 0; i < bays; i++) {
      const x0 = i * bw;
      if (screen) {
        // dark frame, glowing blue display with UI glyphs
        const x = x0 + 5, w = bw - 10, h = bot - top;
        a.fillStyle = '#0B1438'; a.fillRect(x, top, w, h);
        const g = e.createLinearGradient(0, top, 0, bot);
        const k = 0.65 + rng() * 0.35;
        g.addColorStop(0, hexMix('#000000', '#4FA8FF', k));
        g.addColorStop(1, hexMix('#000000', '#1F5BFF', k));
        e.fillStyle = g; e.fillRect(x, top, w, h);
        e.fillStyle = 'rgba(210,240,255,0.95)';
        const kind = Math.floor(rng() * 3);
        if (kind === 0) for (let b = 0; b < 4; b++) e.fillRect(x + 6 + b * 12, bot - 10 - rng() * (h - 26), 7, 1e3); // bars, clipped below
        if (kind === 1) { e.fillRect(x + 6, top + 12, w - 12, 5); e.fillRect(x + 6, top + 24, (w - 12) * 0.6, 4); e.fillRect(x + 6, top + 34, (w - 12) * 0.8, 4); }
        if (kind === 2) { e.beginPath(); e.arc(x + w / 2, top + h / 2, h * 0.28, 0, Math.PI * 2); e.lineWidth = 5; e.strokeStyle = 'rgba(200,235,255,0.95)'; e.stroke(); }
        e.fillStyle = '#000'; e.fillRect(x0, bot, bw, H - bot); e.fillRect(x0, 0, bw, top);
        e.fillRect(x0, 0, 5, H); e.fillRect(x0 + bw - 5, 0, 5, H);
        continue;
      }
      // warm glass panes split by a mullion
      const panes = lobby ? [[x0 + 2, bw / 2 - 3], [x0 + bw / 2 + 1, bw / 2 - 3]] : [[x0 + 6, bw / 2 - 8], [x0 + bw / 2 + 2, bw / 2 - 8]];
      for (const [px, pw] of panes) {
        const dim = rng() < (lobby ? 0.04 : 0.14);
        const k = dim ? 0.08 + rng() * 0.12 : 0.62 + rng() * 0.38;
        const hue = lobby
          ? ['#FFE7A8', '#FFD98A', '#FFF0B3', '#FFCF7A'][Math.floor(rng() * 4)]
          : ['#FFB45A', '#FFA347', '#FFC676', '#FFD99A', '#FF9A3C', '#FFBD66'][Math.floor(rng() * 6)];
        a.fillStyle = dim ? '#2A2742' : hexMix('#5A4A30', hue, 0.35); a.fillRect(px, top, pw, bot - top);
        const g = e.createLinearGradient(0, top, 0, bot);
        g.addColorStop(0, hexMix('#000000', hue, k * 0.8));
        g.addColorStop(1, hexMix('#000000', hue, k));
        e.fillStyle = g; e.fillRect(px, top, pw, bot - top);
        if (!dim && !lobby && rng() < 0.5) { // blinds / interior silhouettes
          e.fillStyle = 'rgba(0,0,0,0.25)';
          e.fillRect(px, top, pw, (bot - top) * (0.15 + rng() * 0.3));
        }
      }
      if (lobby) { e.fillStyle = 'rgba(0,0,0,0.5)'; e.fillRect(x0, top + 30, bw, 2); }
    }
    return { map: canvasTexture(alb, { repeat: true }), emissiveMap: canvasTexture(emi, { repeat: true }), bays };
  });
}

/** Subtle roof deck texture (tonal panels + faint seams). Tiles every `tile` world units via repeat. */
export function roofTexture(tile = 3) {
  return cached(`roof:${tile}`, () => {
    const S = 256, c = canvas(S, S), g = c.getContext('2d'), rng = makeRng(3);
    g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, S, S);
    const n = 2;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = 228 + Math.floor(rng() * 27);
      g.fillStyle = `rgb(${v},${v},${Math.min(255, v + 4)})`;
      g.fillRect(i * S / n + 2, j * S / n + 2, S / n - 4, S / n - 4);
    }
    g.strokeStyle = 'rgba(70,72,110,0.35)'; g.lineWidth = 2;
    for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * S / n, 0); g.lineTo(i * S / n, S); g.moveTo(0, i * S / n); g.lineTo(S, i * S / n); g.stroke(); }
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(80,80,120,${rng() * 0.06})`; g.fillRect(rng() * S, rng() * S, 2 + rng() * 6, 2 + rng() * 6); }
    const t = canvasTexture(c, { repeat: true });
    t.repeat.set(1 / tile, 1 / tile);
    return t;
  });
}

/** White glow textures used with additive tinted materials. kind: 'radial' | 'vertical' | 'ramp' (u: 1 -> 0). */
export function glowTexture(kind = 'radial') {
  return cached(`glow:${kind}`, () => {
    const S = 128, c = canvas(S, S), g = c.getContext('2d');
    let gr;
    if (kind === 'radial') {
      gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.55)');
      gr.addColorStop(0.7, 'rgba(255,255,255,0.15)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    } else {
      gr = g.createLinearGradient(0, S, 0, 0); // v=0 bright -> v=1 transparent
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.45)');
      gr.addColorStop(0.65, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    }
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    return canvasTexture(c, { srgb: false });
  });
}

// ------------------------------------------------------------------------------------------
// Materials (shared, cached)
// ------------------------------------------------------------------------------------------
const lambert = (key, opts) => cached('mat:' + key, () => new THREE.MeshLambertMaterial(opts));
export const MAT = {
  get facade() { return lambert('facade', { color: PALETTE.facade, emissive: '#2A2840', emissiveIntensity: 1 }); },
  get trim() { return lambert('trim', { color: PALETTE.trim, emissive: '#3A3856', emissiveIntensity: 1 }); },
  get roof() { return lambert('roof', { color: PALETTE.roof, map: roofTexture(), emissive: '#262640', emissiveIntensity: 1 }); },
  get court() { return lambert('court', { color: PALETTE.court, emissive: '#151832', emissiveIntensity: 1 }); },
  get glass() { return lambert('glass', { color: PALETTE.glass, emissive: '#0E1430', emissiveIntensity: 1 }); },
  get base() { return lambert('base', { color: PALETTE.base, emissive: '#07080F', emissiveIntensity: 1 }); },
  get warmGlow() { return cached('mat:warmGlow', () => new THREE.MeshBasicMaterial({ color: PALETTE.warm, toneMapped: false })); },
  get lawn() { return lambert('lawn', { color: PALETTE.lawn, emissive: '#16381A', emissiveIntensity: 1 }); },
  get curb() { return lambert('curb', { color: PALETTE.curb, emissive: '#101222', emissiveIntensity: 1 }); },
  get paving() { return lambert('paving', { color: PALETTE.paving, emissive: '#0C0D18', emissiveIntensity: 1 }); },
  get seam() { return cached('mat:seam', () => new THREE.MeshBasicMaterial({ color: '#5D5F86', side: THREE.DoubleSide })); },
  // --- additions (options; the defaults above are unchanged) ---
  /** light grey plaza paving around buildings (reference forecourts). */
  get plaza() { return lambert('plaza', { color: '#8A8DA6', emissive: '#1A1C2C', emissiveIntensity: 1 }); },
  /** darker walls for outer-ring buildings (selective glass, not uniformly lit). */
  get facadeDark() { return lambert('facadeDark', { color: '#7C7FA2', emissive: '#16172A', emissiveIntensity: 1 }); },
  get trimDark() { return lambert('trimDark', { color: '#A9AACB', emissive: '#22233A', emissiveIntensity: 1 }); },
  get roofDark() { return lambert('roofDark', { color: '#7F829F', map: roofTexture(), emissive: '#17182A', emissiveIntensity: 1 }); },
  /** lighter, lower-contrast roof seams. */
  get seamLight() { return cached('mat:seamLight', () => new THREE.MeshBasicMaterial({ color: '#7D80A8', side: THREE.DoubleSide })); },
};

/** Window/screen band material (cached per style+seed). */
export function bandMaterial(style = 'warm', seed = 7) {
  return cached(`mat:band:${style}:${seed}`, () => {
    const t = windowBandTexture({ style, seed });
    return new THREE.MeshLambertMaterial({
      map: t.map, emissiveMap: t.emissiveMap, emissive: '#FFFFFF',
      emissiveIntensity: { screen: 1.5, lobby: 1.6, ribbon: 2.1, dark: 1.7, cream: 1.6, streak: 3.3, streakLobby: 1.8, hotRibbon: 2.4, knGlass: 2.5, knLobby: 2.3 }[style] ?? 1.45,
    });
  });
}

/** Additive glow material tinted `color` using a white glow texture. */
export function glowMaterial(color, kind = 'radial', opacity = 1) {
  return cached(`mat:glow:${color}:${kind}:${opacity}`, () => new THREE.MeshBasicMaterial({
    color, map: glowTexture(kind), transparent: true, opacity, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  }));
}

// ------------------------------------------------------------------------------------------
// Outlines (footprints)
// ------------------------------------------------------------------------------------------
const lineEdge = (ax, az, bx, bz, tag) => ({ tag, L: Math.hypot(bx - ax, bz - az), f: (t) => [ax + (bx - ax) * t, az + (bz - az) * t] });
// Arc around (cx, cz) with local angle a (0 = toward -Z, + toward +X), from a0 to a1 degrees.
const arcEdge = (cx, cz, R, a0, a1, tag) => ({
  tag, L: Math.abs(a1 - a0) * D2R * R,
  f: (t) => { const a = (a0 + (a1 - a0) * t) * D2R; return [cx + R * Math.sin(a), cz - R * Math.cos(a)]; },
});
const CORNER_TAGS = ['back-right', 'front-right', 'front-left', 'back-left'];

/** Builds a closed outline from 4 edges (back, right, front, left) with rounded corners [br, fr, fl, bl]. */
function outlineFromEdges(edges, corners = [0, 0, 0, 0], step = 0.3) {
  const pts = [], tags = [], n = edges.length;
  for (let i = 0; i < n; i++) {
    const e = edges[i], cPrev = corners[(i + n - 1) % n] || 0, cNext = corners[i] || 0;
    const t0 = Math.min(cPrev / e.L, 0.49), t1 = 1 - Math.min(cNext / e.L, 0.49);
    const segs = Math.max(1, Math.ceil((e.L * (t1 - t0)) / step));
    for (let k = 0; k < segs; k++) { pts.push(e.f(t0 + ((t1 - t0) * k) / segs)); tags.push(e.tag); }
    // corner i: quadratic fillet from this edge's trimmed end, through the sharp corner, to the next edge
    const nx = edges[(i + 1) % n], p0 = e.f(t1), pc = e.f(1);
    const p2 = nx.f(Math.min(cNext / nx.L, 0.49));
    const cs = cNext > 0 ? Math.max(3, Math.ceil(cNext * 5)) : 1;
    for (let k = 0; k < cs; k++) {
      const t = k / cs, u = 1 - t;
      pts.push([u * u * p0[0] + 2 * u * t * pc[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * pc[1] + t * t * p2[1]]);
      tags.push(cNext > 0 ? CORNER_TAGS[i] : e.tag);
    }
  }
  return dedupeOutline({ pts, tags });
}

/** Removes consecutive (near-)duplicate points (they produce NaN normals in bevelled extrusions). */
export function dedupeOutline(o, eps = 1e-4) {
  const pts = [], tags = [];
  for (let i = 0; i < o.pts.length; i++) {
    const p = o.pts[i], q = pts[pts.length - 1];
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    if (q && Math.hypot(p[0] - q[0], p[1] - q[1]) < eps) continue;
    pts.push(p); tags.push(o.tags ? o.tags[i] : 'all');
  }
  while (pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < eps) { pts.pop(); tags.pop(); }
  return { pts, tags };
}

/**
 * Ring-following wedge (annular sector) with rounded corners.
 * r = slot radius (core is at local z = +r); rIn/rOut = distances from the core;
 * a0/a1 = tangential angles in degrees (a0 < a1, + = toward local +X); corners = [br, fr, fl, bl].
 */
export function sectorOutline({ r, rIn, rOut, a0, a1, corners = [0.8, 0.8, 0.8, 0.8], step }) {
  const c = typeof corners === 'number' ? [corners, corners, corners, corners] : corners;
  const P = (rho, a) => { const p = sectorPoint(r, rho, a); return [p.x, p.z]; };
  const edge = (A, B, tag) => lineEdge(A[0], A[1], B[0], B[1], tag);
  return outlineFromEdges([
    arcEdge(0, r, rOut, a0, a1, 'back'),
    edge(P(rOut, a1), P(rIn, a1), 'right'),
    arcEdge(0, r, rIn, a1, a0, 'front'),
    edge(P(rIn, a0), P(rOut, a0), 'left'),
  ], c, step);
}

/**
 * Free-form curved band footprint (e.g. a wedge whose outer edge curves more than the ring).
 * back / front: polylines [[x, z], ...] ordered from the -X (left) end to the +X (right) end; each is
 * smoothed with a centripetal Catmull-Rom spline. The ends are straight lines joining them.
 * corners = [br, fr, fl, bl] (number = all). Use sectorPoint() to author the points in polar terms.
 */
export function curveOutline({ back, front, corners = 0.8, step }) {
  const c = typeof corners === 'number' ? [corners, corners, corners, corners] : corners;
  const spline = (pts, tag) => {
    if (pts.length === 2) return lineEdge(pts[0][0], pts[0][1], pts[1][0], pts[1][1], tag);
    const cv = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
    return { tag, L: cv.getLength(), f: (t) => { const p = cv.getPointAt(Math.min(1, Math.max(0, t))); return [p.x, p.z]; } };
  };
  const fr = [...front].reverse();
  const b0 = back[0], b1 = back[back.length - 1], f0 = fr[0], f1 = fr[fr.length - 1];
  return outlineFromEdges([
    spline(back, 'back'),
    lineEdge(b1[0], b1[1], f0[0], f0[1], 'right'),
    spline(fr, 'front'),
    lineEdge(f1[0], f1[1], b0[0], b0[1], 'left'),
  ], c, step);
}

/**
 * General rounded polygon: points [[x, z], ...] in order (either winding; it is normalised so walls
 * face outward), radii = number or per-corner array (corner i at points[i]). tags: optional per-EDGE
 * side tags (edge i runs points[i] -> points[i+1]); default 'all'. Fillets are circular arcs.
 */
export function polyOutline(points, radii = 0.6, { tags = null, step = 0.3 } = {}) {
  let P = points.map((p) => [p[0], p[1]]), T = tags ? tags.slice() : P.map(() => 'all');
  let rad = typeof radii === 'number' ? P.map(() => radii) : radii.slice();
  // signed area in (x, -z) space: CCW there == the winding the other outlines use
  let A = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; A += p[0] * -q[1] - q[0] * -p[1]; }
  if (A > 0) {
    P = P.reverse(); rad = rad.reverse();
    const n = T.length; T = T.map((_, i) => T[(n - 2 - i + n) % n]); // edge i(new) = old edge n-2-i
  }
  const n = P.length, pts = [], out = [];
  for (let i = 0; i < n; i++) {
    const p = P[(i + n - 1) % n], c = P[i], q = P[(i + 1) % n];
    const d1x = c[0] - p[0], d1z = c[1] - p[1], l1 = Math.hypot(d1x, d1z) || 1;
    const d2x = q[0] - c[0], d2z = q[1] - c[1], l2 = Math.hypot(d2x, d2z) || 1;
    const ux = d1x / l1, uz = d1z / l1, vx = d2x / l2, vz = d2z / l2;
    const turn = Math.acos(Math.max(-1, Math.min(1, ux * vx + uz * vz)));
    const r = Math.min(rad[i] || 0, 0.45 * Math.min(l1, l2) / Math.max(1e-3, Math.tan(turn / 2)));
    const tt = r * Math.tan(turn / 2);
    if (r <= 1e-3 || turn < 1e-3) { pts.push([c[0], c[1]]); out.push(T[i]); continue; }
    const a = [c[0] - ux * tt, c[1] - uz * tt], b = [c[0] + vx * tt, c[1] + vz * tt];
    const segs = Math.max(3, Math.ceil((turn * r) / step) + 1);
    // quadratic Bezier through the corner approximates the fillet closely enough at these sizes
    for (let k = 0; k <= segs; k++) {
      const t = k / segs, w = 1 - t;
      pts.push([w * w * a[0] + 2 * w * t * c[0] + t * t * b[0], w * w * a[1] + 2 * w * t * c[1] + t * t * b[1]]);
      out.push(k === segs ? T[i] : T[(i + n - 1) % n]);
    }
  }
  return dedupeOutline({ pts, tags: out });
}

/** Rounded rectangle footprint centred on (cx, cz): w along X, d along Z, corner radius rad (number or [br,fr,fl,bl]). */
export function roundedRectOutline(w, d, rad = 0.8, { cx = 0, cz = 0, step } = {}) {
  const c = typeof rad === 'number' ? [rad, rad, rad, rad] : rad;
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  return outlineFromEdges([
    lineEdge(x0, z0, x1, z0, 'back'), lineEdge(x1, z0, x1, z1, 'right'),
    lineEdge(x1, z1, x0, z1, 'front'), lineEdge(x0, z1, x0, z0, 'left'),
  ], c, step);
}

/** Stadium / pill footprint: straight back+front, semicircular left/right ends (w > d). */
export function stadiumOutline(w, d, { cx = 0, cz = 0, step } = {}) {
  const R = d / 2, hx = Math.max(0, w / 2 - R);
  return outlineFromEdges([
    lineEdge(cx - hx, cz - R, cx + hx, cz - R, 'back'), arcEdge(cx + hx, cz, R, 0, 180, 'right'),
    lineEdge(cx + hx, cz + R, cx - hx, cz + R, 'front'), arcEdge(cx - hx, cz, R, 180, 360, 'left'),
  ], [0, 0, 0, 0], step);
}

/** Moves every outline point outward by d (negative = inward); keeps tags. */
export function offsetOutline(o, d) {
  const { pts } = o, n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n], c = pts[i], q = pts[(i + 1) % n];
    let n1x = c[1] - p[1], n1z = -(c[0] - p[0]); const l1 = Math.hypot(n1x, n1z) || 1; n1x /= l1; n1z /= l1;
    let n2x = q[1] - c[1], n2z = -(q[0] - c[0]); const l2 = Math.hypot(n2x, n2z) || 1; n2x /= l2; n2z /= l2;
    let mx = n1x + n2x, mz = n1z + n2z; const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const k = Math.min(2, 1 / Math.max(0.5, mx * n1x + mz * n1z));
    out.push([c[0] + mx * d * k, c[1] + mz * d * k]);
  }
  return dedupeOutline({ pts: out, tags: o.tags.slice() });
}

/** Contiguous runs of points whose tag passes `sides` (array of tags, 'all', or predicate). Returns open polylines. */
export function sideRuns(o, sides = 'all') {
  const n = o.pts.length;
  const ok = o.tags.map((t, i) => (sides === 'all' ? true : typeof sides === 'function' ? sides(t, i) : sides.includes(t)));
  if (ok.every(Boolean)) return [[...o.pts, o.pts[0]]];
  const start = ok.findIndex((v, i) => !v && ok[(i + 1) % n]);
  if (start < 0) return [];
  const runs = [];
  let cur = null;
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    if (ok[i]) { (cur ||= []).push(o.pts[i]); }
    else if (cur) { cur.push(o.pts[i]); runs.push(cur); cur = null; } // close the gap to the next run
  }
  if (cur) runs.push(cur);
  return runs;
}

// ------------------------------------------------------------------------------------------
// Geometry builders (all non-indexed with position/normal/uv so they can be merged)
// ------------------------------------------------------------------------------------------
/** Closed outline -> THREE.Shape (x, -z), optional hole outlines. */
export function outlineShape(o, holes = []) {
  o = dedupeOutline(o); holes = holes.map((h) => dedupeOutline(h));
  const s = new THREE.Shape(o.pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const h of holes) s.holes.push(new THREE.Path(h.pts.map(([x, z]) => new THREE.Vector2(x, -z))));
  return s;
}

/** Extrudes an outline from y0 to y1 (bevel = rounded top/bottom edge size). Cap UVs are local x/-z in world units. */
export function extrudeOutline(o, y0, y1, { bevel = 0, holes = [] } = {}) {
  const b = Math.min(bevel, (y1 - y0) / 2.2);
  const g = new THREE.ExtrudeGeometry(outlineShape(o, holes), {
    depth: Math.max(0.001, y1 - y0 - 2 * b), curveSegments: 1, steps: 1,
    bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0 + b, 0);
  return cleanGeometry(g.index ? g.toNonIndexed() : g);
}

/** Vertical wall strip along a polyline from y0 to y1, facing outward. u = length / uScale (+uOffset), v = 0..1. */
export function ribbon(points, y0, y1, { uScale = 1, uOffset = 0, vFlip = false } = {}) {
  const pos = [], nor = [], uv = [];
  let len = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i], [bx, bz] = points[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-5) continue;
    const nx = (bz - az) / L, nz = -(bx - ax) / L;
    const u0 = uOffset + len / uScale, u1 = uOffset + (len + L) / uScale;
    const va = vFlip ? 1 : 0, vb = vFlip ? 0 : 1;
    const A = [ax, y0, az, u0, va], B = [bx, y0, bz, u1, va], C = [bx, y1, bz, u1, vb], D = [ax, y1, az, u0, vb];
    for (const V of [A, C, B, A, D, C]) { pos.push(V[0], V[1], V[2]); nor.push(nx, 0, nz); uv.push(V[3], V[4]); }
    len += L;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** Flat horizontal band between two matching polylines (inner, outer) at height y. uv.v = 0 inner, 1 outer. */
export function flatBand(inner, outer, y = 0.02, { uScale = 1 } = {}) {
  const pos = [], nor = [], uv = [];
  let len = 0;
  for (let i = 0; i < inner.length - 1; i++) {
    const a = inner[i], b = inner[i + 1], c = outer[i + 1], d = outer[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u0 = len / uScale, u1 = (len + L) / uScale;
    const A = [a[0], a[1], u0, 0], B = [b[0], b[1], u1, 0], C = [c[0], c[1], u1, 1], D = [d[0], d[1], u0, 1];
    for (const T of [[A, B, C], [A, C, D]]) {
      if (Math.abs((T[1][0] - T[0][0]) * (T[2][1] - T[0][1]) - (T[2][0] - T[0][0]) * (T[1][1] - T[0][1])) < 1e-9) continue; // degenerate
      for (const V of T) { pos.push(V[0], y, V[1]); nor.push(0, 1, 0); uv.push(V[2], V[3]); }
    }
    len += L;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** Thin flat line strip along a polyline [[x,z],...] (roof seams, paint lines). */
export function flatStrip(points, width = 0.06, y = 0.01) {
  const L = [], R = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[Math.max(0, i - 1)], q = points[Math.min(points.length - 1, i + 1)];
    let dx = q[0] - p[0], dz = q[1] - p[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    L.push([points[i][0] - dz * width / 2, points[i][1] + dx * width / 2]);
    R.push([points[i][0] + dz * width / 2, points[i][1] - dx * width / 2]);
  }
  return flatBand(L, R, y);
}

/**
 * Makes a NON-INDEXED geometry safe to light: drops zero-area / non-finite triangles and replaces
 * zero-length or NaN normals with the triangle's face normal. Returns the same geometry (mutated).
 */
export function cleanGeometry(g) {
  if (!g || g.index) return g;
  const P = g.attributes.position, N = g.attributes.normal;
  if (!P) return g;
  const names = Object.keys(g.attributes), n = P.count - (P.count % 3);
  const keep = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3();
  let changed = P.count % 3 !== 0;
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(P, i); b.fromBufferAttribute(P, i + 1); c.fromBufferAttribute(P, i + 2);
    fn.subVectors(c, b).cross(b.clone().sub(a).negate());
    const ok = [a, b, c].every((v) => Number.isFinite(v.x + v.y + v.z)) && fn.lengthSq() > 1e-14;
    if (!ok) { changed = true; continue; }
    keep.push(i);
    if (N) {
      fn.normalize();
      for (let k = 0; k < 3; k++) {
        const x = N.getX(i + k), y = N.getY(i + k), z = N.getZ(i + k), L = x * x + y * y + z * z;
        if (!(L > 1e-10) || !Number.isFinite(L)) N.setXYZ(i + k, fn.x, fn.y, fn.z);
        else if (Math.abs(L - 1) > 1e-3) { const s = 1 / Math.sqrt(L); N.setXYZ(i + k, x * s, y * s, z * s); }
      }
    }
  }
  if (!changed) return g;
  for (const name of names) {
    const src = g.attributes[name], sz = src.itemSize, arr = new src.array.constructor(keep.length * 3 * sz);
    keep.forEach((i, t) => arr.set(src.array.subarray(i * sz, (i + 3) * sz), t * 3 * sz));
    g.setAttribute(name, new THREE.BufferAttribute(arr, sz, src.normalized));
  }
  // remap material groups (vertex ranges) onto the kept triangles
  const groups = g.groups.slice();
  g.clearGroups();
  for (const gr of groups) {
    let start = -1, count = 0;
    keep.forEach((i, t) => { if (i >= gr.start && i < gr.start + gr.count) { if (start < 0) start = t * 3; count += 3; } });
    if (count) g.addGroup(start, count, gr.materialIndex);
  }
  return g;
}

/** Merges geometries (disposes inputs) into one Mesh. */
export function mergedMesh(geos, material) {
  const list = geos.filter(Boolean).map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of list) g.clearGroups();
  const m = new THREE.Mesh(cleanGeometry(mergeGeometries(list, false)), material);
  list.forEach((g) => g.dispose());
  return m;
}

// ------------------------------------------------------------------------------------------
// Stacked building block
// ------------------------------------------------------------------------------------------
/**
 * One stacked volume on an outline: recessed lobby, floors with ledges and window bands, roof slab
 * with seamed deck and a parapet.
 * opts: y0, lobbyH, lobbyInset, floors, floorH, ledge (outward), ledgeH, setback (roof slab inset/outset),
 *       windows: {style, sides}, lobby: {style, sides}, bands: [{sides, style, floors:[0=lobby,1..]}] overrides,
 *       roof: {thick, overhang, parapetH, parapetW} | false, bayWidth, seed,
 *       materials: { facade, trim, roof, base } overrides (e.g. { facade: MAT.facadeDark, roof: MAT.roofDark, trim: MAT.trimDark }),
 *       tone: 'light' (default) | 'dark' shortcut for the dark material set,
 *       effects: { floorLines: false|true|color (lit warm line on every floor ledge),
 *                  roofEdge: false|true|color (glowing neon line along the parapet top),
 *                  intensity: 1 } (see makeNeonLine).
 * Returns { group, top (roof deck y), roofOutline (inside the parapet), outline }.
 */
export function makeBlock(outline, opts = {}) {
  const {
    y0 = 0, lobbyH = 1.25, lobbyInset = 0.32, floors = 3, floorH = 1.15, ledge = 0.1, ledgeH = 0.12,
    windows = { style: 'warm', sides: 'all' }, lobby = { style: 'lobby', sides: 'all' }, bands = [],
    roof = {}, bayWidth = 0.78, seed = 11, materials = {}, tone = 'light', effects = {},
  } = opts;
  const dk = tone === 'dark';
  const M = {
    facade: materials.facade || (dk ? MAT.facadeDark : MAT.facade), trim: materials.trim || (dk ? MAT.trimDark : MAT.trim),
    roof: materials.roof || (dk ? MAT.roofDark : MAT.roof), base: materials.base || MAT.base,
  };
  const { thick = 0.24, overhang = 0.14, parapetH = 0.34, parapetW = 0.24 } = roof || {};
  const group = new THREE.Group();
  const rng = makeRng(seed);
  const top = y0 + lobbyH + floors * floorH;

  // solid bodies: dark plinth + recessed lobby core + upper body
  const facadeGeos = [extrudeOutline(outline, y0 + lobbyH, top)];
  group.add(new THREE.Mesh(extrudeOutline(offsetOutline(outline, -lobbyInset), y0, y0 + lobbyH), M.base));

  // ledges at each floor line (slightly proud of the facade) + a lobby canopy
  const trimGeos = [extrudeOutline(offsetOutline(outline, ledge + 0.06), y0 + lobbyH - 0.05, y0 + lobbyH + ledgeH + 0.04, { bevel: 0.03 })];
  for (let f = 1; f < floors; f++) {
    const y = y0 + lobbyH + f * floorH;
    trimGeos.push(extrudeOutline(offsetOutline(outline, ledge), y - ledgeH / 2, y + ledgeH / 2));
  }

  // window / screen bands per floor, split into runs by style
  const bandGeos = new Map();
  const bandStyle = (f, tag) => {
    for (const b of bands) if ((!b.floors || b.floors.includes(f)) && (b.sides === 'all' || b.sides.includes(tag))) return b.style;
    const d = f === 0 ? lobby : windows;
    return d && (d.sides === 'all' || !d.sides || d.sides.includes(tag)) ? d.style : null;
  };
  const bayU = bayWidth * windowBandTexture({ style: 'warm' }).bays;
  for (let f = 0; f <= floors; f++) {
    const isLobby = f === 0;
    const off = isLobby ? offsetOutline(outline, -lobbyInset + 0.02) : offsetOutline(outline, 0.02);
    const ya = isLobby ? y0 + 0.02 : y0 + lobbyH + (f - 1) * floorH + ledgeH / 2;
    const yb = isLobby ? y0 + lobbyH - 0.05 : y0 + lobbyH + f * floorH - ledgeH / 2;
    const styles = new Set(outline.tags.map((t) => bandStyle(f, t)).filter(Boolean));
    for (const style of styles) {
      for (const run of sideRuns(off, (t) => bandStyle(f, t) === style)) {
        const k = style + ':' + f % 2;
        if (!bandGeos.has(k)) bandGeos.set(k, { style, alt: f % 2, geos: [] });
        bandGeos.get(k).geos.push(ribbon(run, ya, yb, { uScale: bayU, uOffset: rng() }));
      }
    }
  }
  for (const { style, alt, geos } of bandGeos.values()) group.add(mergedMesh(geos, bandMaterial(style, 7 + alt * 13)));

  let roofOutline = outline;
  if (roof !== false) {
    const slab = offsetOutline(outline, overhang);
    const roofMesh = new THREE.Mesh(extrudeOutline(slab, top, top + thick, { bevel: 0.05 }), [M.roof, M.trim]);
    group.add(roofMesh);
    roofOutline = offsetOutline(slab, -parapetW);
    trimGeos.push(extrudeOutline(slab, top + thick - 0.01, top + thick + parapetH, { holes: [roofOutline], bevel: 0.04 }));
  }
  group.add(mergedMesh(facadeGeos, M.facade));
  group.add(mergedMesh(trimGeos, M.trim));
  // opt-in light effects
  const fx = effects || {}, fxI = fx.intensity ?? 1;
  if (fx.floorLines) {
    const col = typeof fx.floorLines === 'string' ? fx.floorLines : '#FFD9A0';
    const ys = [y0 + lobbyH + ledgeH * 0.5];
    for (let f = 1; f < floors; f++) ys.push(y0 + lobbyH + f * floorH);
    group.add(makeNeonLine(offsetOutline(outline, ledge + 0.035), ys, { color: col, height: 0.09, glow: 0.22, intensity: 1.6 * fxI, glowOpacity: 0.32 }));
  }
  if (fx.roofEdge && roof !== false) {
    const col = typeof fx.roofEdge === 'string' ? fx.roofEdge : '#E8ECFF';
    const slab = offsetOutline(outline, overhang + 0.035); // clear of the parapet face (no z-fighting dashes)
    group.add(makeNeonLine(slab, [top + thick + parapetH - 0.07], { color: col, height: 0.12, glow: 0.35, intensity: 1.7 * fxI, glowOpacity: 0.4 }));
  }
  return { group, top: roof === false ? top : top + thick, roofOutline, outline };
}

// ------------------------------------------------------------------------------------------
// Roof features, lobby, glow, landscaping
// ------------------------------------------------------------------------------------------
/** Sunken roof court: darker floor inside a raised rim. outline = court footprint, y = roof deck. */
export function makeRoofCourt(outline, y, { rim = 0.18, rimH = 0.16, material = MAT.court } = {}) {
  const g = new THREE.Group();
  const inner = offsetOutline(outline, -rim);
  g.add(new THREE.Mesh(extrudeOutline(inner, y - 0.02, y + 0.012), material));
  g.add(new THREE.Mesh(extrudeOutline(outline, y, y + rimH, { holes: [inner] }), MAT.trim));
  // dark inner wall of the "pit" (reads as depth)
  g.add(new THREE.Mesh(ribbon([...inner.pts, inner.pts[0]].reverse(), y - 0.02, y + rimH - 0.01), MAT.base));
  return g;
}

/** Roof seams: polylines [[x,z],...] drawn as thin dark strips at height y. */
export function makeSeams(lines, y, width = 0.05, material = MAT.seam) {
  return mergedMesh(lines.map((l) => flatStrip(l, width, y + 0.012)), material);
}

const DETAIL_MATS = {
  get ac() { return lambert('ac', { color: '#9A9AB8', emissive: '#1A1A2C' }); },
  get dark() { return lambert('dark', { color: '#2A2C40', emissive: '#08090F' }); },
  get solar() { return lambert('solar', { color: '#1F3570', emissive: '#0C1A44' }); },
  get sky() { return cached('mat:skylight', () => new THREE.MeshBasicMaterial({ color: '#BFD8FF', toneMapped: false })); },
};
/**
 * Rooftop clutter. items: [{ type: 'ac'|'solar'|'skylight'|'vent', x, z, rot=0 (deg), w, d }], y = roof deck height.
 */
export function makeRoofDetails(items, y) {
  const by = { ac: [], dark: [], solar: [], sky: [] };
  const box = (w, h, d, x, yy, z, rot, tilt = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (tilt) g.rotateX(tilt * D2R);
    g.rotateY(rot * D2R); g.translate(x, yy, z);
    return g;
  };
  for (const it of items) {
    const { type, x, z, rot = 0 } = it;
    if (type === 'ac') {
      const w = it.w || 0.7, d = it.d || 0.5;
      by.ac.push(box(w, 0.32, d, x, y + 0.16, z, rot));
      const fan = new THREE.CylinderGeometry(Math.min(w, d) * 0.32, Math.min(w, d) * 0.32, 0.04, 10);
      fan.translate(x, y + 0.34, z); by.dark.push(fan);
    } else if (type === 'solar') {
      const w = it.w || 1.2, d = it.d || 0.7;
      by.dark.push(box(w * 0.9, 0.18, 0.08, x, y + 0.09, z, rot));
      by.solar.push(box(w, 0.05, d, x, y + 0.24, z, rot, -18));
    } else if (type === 'skylight') {
      const w = it.w || 0.9, d = it.d || 0.55;
      by.ac.push(box(w + 0.1, 0.08, d + 0.1, x, y + 0.04, z, rot));
      by.sky.push(box(w, 0.06, d, x, y + 0.1, z, rot));
    } else if (type === 'vent') {
      const c = new THREE.CylinderGeometry(0.12, 0.14, 0.4, 8);
      c.translate(x, y + 0.2, z); by.dark.push(c);
    }
  }
  const g = new THREE.Group();
  for (const [k, geos] of Object.entries(by)) if (geos.length) g.add(mergedMesh(geos, DETAIL_MATS[k]));
  return g;
}

/**
 * Neon line (sheet sec 3 "Neon Line"): a thin HDR-bright strip wrapped around an outline (closed) or
 * along a polyline [[x,z],...] (open) at one or more heights, plus a soft additive halo band above and
 * below it so bloom reads as a glowing edge. ys: number or array of heights.
 * opts: color, height (strip height 0.05), glow (halo half-height 0.3, 0 = none), intensity (HDR
 *       multiplier 1.6), glowOpacity (0.35), offset (push outward 0).
 */
export function makeNeonLine(path, ys, { color = PALETTE.warm, height = 0.05, glow = 0.3, intensity = 1.6, glowOpacity = 0.35, offset = 0 } = {}) {
  const closed = !Array.isArray(path);
  const o = closed && offset ? offsetOutline(path, offset) : path;
  const line = closed ? [...o.pts, o.pts[0]] : o;
  const H = [].concat(ys);
  const g = new THREE.Group();
  const coreMat = cached(`mat:neon:${color}:${intensity}`, () => {
    const m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false });
    m.color.multiplyScalar(intensity); return m;
  });
  g.add(mergedMesh(H.map((y) => ribbon(line, y - height / 2, y + height / 2)), coreMat));
  if (glow > 0) {
    const up = mergedMesh(H.map((y) => ribbon(line, y + height / 2, y + height / 2 + glow)), glowMaterial(color, 'vertical', glowOpacity));
    const dn = mergedMesh(H.map((y) => ribbon(line, y - height / 2, y - height / 2 - glow)), glowMaterial(color, 'vertical', glowOpacity));
    up.renderOrder = dn.renderOrder = 2;
    g.add(up, dn);
  }
  return g;
}

/**
 * Street / plot lamps: thin dark posts with a warm glowing head (sheet sec 6 "Road Light").
 * list: [[x, z], ...] or [{x, z}], opts: color ('#FFD98A'), height (0.9), size (glow sprite size 0.9).
 */
export function makeLamps(list, { color = '#FFD98A', height = 0.9, size = 0.9, opacity = 1, pool = 0.28 } = {}) {
  const P = list.map((p) => (Array.isArray(p) ? { x: p[0], z: p[1] } : p));
  const g = new THREE.Group();
  const posts = P.map(({ x, z }) => { const c = new THREE.CylinderGeometry(0.035, 0.05, height, 5); c.translate(x, height / 2, z); return c; });
  g.add(mergedMesh(posts, cached('mat:lampPost', () => new THREE.MeshLambertMaterial({ color: '#2A2C40', emissive: '#08090F' }))));
  const heads = P.map(({ x, z }) => { const s = new THREE.SphereGeometry(0.07, 6, 4); s.translate(x, height + 0.03, z); return s; });
  g.add(mergedMesh(heads, cached(`mat:lampHead:${color}`, () => { const m = new THREE.MeshBasicMaterial({ color }); m.color.multiplyScalar(2); return m; })));
  g.add(makeGlowPoints(P.map(({ x, z }) => [x, height + 0.03, z]), color, size, opacity));
  // tiny warm pool on the ground under each lamp
  const pools = P.map(({ x, z }) => { const pl = new THREE.PlaneGeometry(1.3, 1.3); pl.rotateX(-Math.PI / 2); pl.translate(x, 0.11, z); return pl; });
  const pm = mergedMesh(pools, glowMaterial(color, 'radial', pool)); pm.renderOrder = 2;
  pm.visible = pool > 0;
  g.add(pm);
  return g;
}

/** Expanding/fading ring texture (white) used by the badge pulse. */
function ringTexture() {
  return cached('tex:ring', () => {
    const S = 256, c = canvas(S, S), g = c.getContext('2d');
    g.lineWidth = S * 0.025; g.strokeStyle = '#FFFFFF'; g.shadowColor = '#FFFFFF'; g.shadowBlur = S * 0.04;
    g.beginPath(); g.arc(S / 2, S / 2, S * 0.42, 0, Math.PI * 2); g.stroke(); g.stroke();
    return canvasTexture(c, { srgb: false });
  });
}

/**
 * Warm #FFF0B3 base underglow (light washing up the facade) + soft ground light pool around the footprint.
 * opts: color, height (wall wash), spread (ground pool width), intensity.
 */
export function makeBaseGlow(outline, { color = PALETTE.warm, height = 1.6, spread = 2.6, intensity = 0.8, y = 0.1, wallOffset = 0.06 } = {}) {
  const g = new THREE.Group();
  const loop = (o) => [...o.pts, o.pts[0]];
  const wall = ribbon(loop(offsetOutline(outline, wallOffset)), 0, height);
  g.add(new THREE.Mesh(wall, glowMaterial(color, 'vertical', 0.55 * intensity)));
  const pool = flatBand(loop(offsetOutline(outline, 0)), loop(offsetOutline(outline, spread)), y);
  g.add(new THREE.Mesh(pool, glowMaterial(color, 'vertical', 0.5 * intensity)));
  g.children.forEach((m) => (m.renderOrder = 2));
  return g;
}

/** Additive glowing dots (lamps, bollards, fixtures). list: [[x,y,z],...]. */
export function makeGlowPoints(list, color = PALETTE.warm, size = 0.6, opacity = 1) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(list.flat(), 3));
  const m = new THREE.Points(geo, new THREE.PointsMaterial({
    color, size, map: glowTexture('radial'), transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false,
  }));
  m.renderOrder = 3;
  return m;
}

/**
 * Building lot: lawn plot (building outline offset by `pad`, or an explicit `lot` outline) with a curb,
 * plus a paved walkway ring `walk` wide hugging the building.
 */
export function makeLot(outline, { pad = 1.6, walk = 0.9, height = 0.08, lot = null, walkMaterial = MAT.paving } = {}) {
  const g = new THREE.Group();
  const outer = lot || offsetOutline(outline, pad);
  g.add(new THREE.Mesh(extrudeOutline(outer, 0, height, { bevel: 0.03 }), MAT.lawn));
  g.add(new THREE.Mesh(extrudeOutline(offsetOutline(outer, 0.12), 0, height - 0.01, { holes: [outer] }), MAT.curb));
  if (walk > 0) g.add(new THREE.Mesh(extrudeOutline(offsetOutline(outline, walk), height, height + 0.015), walkMaterial));
  return g;
}

let _treeGeo;
function treeGeos() {
  if (_treeGeo) return _treeGeo;
  const parts = [[0, 0.95, 0, 0.55], [0.22, 1.25, 0.1, 0.42], [-0.18, 1.3, -0.12, 0.38], [0.02, 1.55, 0.02, 0.32]];
  const crown = mergedMesh(parts.map(([x, y, z, s]) => {
    const g = new THREE.IcosahedronGeometry(s, 1); g.translate(x, y, z); return g;
  }), null).geometry;
  crown.computeVertexNormals();
  const trunk = new THREE.CylinderGeometry(0.06, 0.09, 0.8, 5); trunk.translate(0, 0.4, 0);
  _treeGeo = { crown, trunk };
  return _treeGeo;
}
/**
 * Low-poly trees as two InstancedMeshes. list: [{ x, z, s = 1 (scale), hue }] in local coords.
 */
export function makeTrees(list, { colors = ['#3E8A35', '#4A9A3A', '#2F7430', '#5AA640'], seed = 5 } = {}) {
  const { crown, trunk } = treeGeos();
  const rng = makeRng(seed);
  const crowns = new THREE.InstancedMesh(crown, cached('mat:treeCrown', () => new THREE.MeshLambertMaterial({ flatShading: true, emissive: '#1C4A1A', emissiveIntensity: 1 })), list.length);
  const trunks = new THREE.InstancedMesh(trunk, lambert('trunk', { color: '#4A3428', emissive: '#120A06' }), list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  list.forEach((t, i) => {
    const s = t.s ?? 0.8 + rng() * 0.4;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
    m.compose(new THREE.Vector3(t.x, t.y ?? 0.08, t.z), q, new THREE.Vector3(s, s * (0.9 + rng() * 0.25), s));
    crowns.setMatrixAt(i, m); trunks.setMatrixAt(i, m);
    crowns.setColorAt(i, c.set(t.color || colors[Math.floor(rng() * colors.length)]));
  });
  const g = new THREE.Group();
  g.add(trunks, crowns);
  return g;
}

/** Planters: low dark boxes with a green top and shrubs. list: [{ x, z, w = 1.4, d = 0.6, rot = 0 (deg) }]. */
export function makePlanters(list) {
  const rim = [], soil = [], shrubs = [];
  for (const p of list) {
    const { x, z, w = 1.4, d = 0.6, rot = 0 } = p;
    const b = new THREE.BoxGeometry(w, 0.28, d); b.rotateY(rot * D2R); b.translate(x, 0.14, z); rim.push(b);
    const s = new THREE.BoxGeometry(w - 0.12, 0.05, d - 0.12); s.rotateY(rot * D2R); s.translate(x, 0.29, z); soil.push(s);
    const n = Math.max(2, Math.round(w / 0.45));
    for (let i = 0; i < n; i++) {
      const lx = -w / 2 + (i + 0.5) * (w / n), a = rot * D2R;
      shrubs.push({ x: x + Math.cos(a) * lx, z: z - Math.sin(a) * lx, y: 0.1, s: 0.32 });
    }
  }
  const g = new THREE.Group();
  g.add(mergedMesh(rim, MAT.curb), mergedMesh(soil, MAT.lawn), makeTrees(shrubs, { seed: 9 }));
  return g;
}

// ------------------------------------------------------------------------------------------
// Rooftop icon badge
// ------------------------------------------------------------------------------------------
/**
 * Badge disc texture: solid saturated disc, neon rim and glow, crisp white icon (SVG drawn async).
 * opts.icon = false leaves the icon out (makeBadge draws it as a separate HDR sprite so it stays pure
 * white after the ACES tone mapping in OutputPass).
 */
export function badgeTexture(iconName, color, { px = 512, icon = true, style = 'solid' } = {}) {
  if (style === 'neon') return neonDiscTexture(color, { px });
  return cached(`badge:${iconName}:${color}:${px}:${icon}`, () => {
    const S = px, c = canvas(S, S), g = c.getContext('2d');
    const tex = canvasTexture(c);
    const R = S * 0.36, cx = S / 2, cy = S / 2;
    const col = new THREE.Color(color);
    // Reference badges are SOLID saturated discs (a touch deeper in the middle), a thin bright
    // neon rim and a tight outer glow, with a crisp white line icon.
    const hsl = col.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
    // Reference discs are DEEP: every hue ends near the same low luminance (blue ~#0333AA, mint
    // ~#0E594A, teal ~#00343A, pink ~#961846), so high-luminance colours (greens, teals) are darkened
    // much more than blue. lumK scales lightness until the body colour hits the target luminance.
    const lumOf = (l) => { const c = new THREE.Color().setHSL(hsl.h, hsl.s, l, THREE.SRGBColorSpace); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };
    let lumK = 0.56;
    while (lumK > 0.18 && lumOf(hsl.l * lumK) > 0.052) lumK *= 0.94;
    const shade = (lk, sk = 1) => '#' + new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * sk), Math.min(0.62, hsl.l * lk * (lumK / 0.56)), THREE.SRGBColorSpace).getHexString();
    const deep = shade(0.5), body0 = shade(0.56), edge = shade(0.8);
    const lite = hexMix(color, '#FFFFFF', 0.3);
    const srgb = col.clone().convertLinearToSRGB();
    const rgba = (a) => `rgba(${srgb.r * 255 | 0},${srgb.g * 255 | 0},${srgb.b * 255 | 0},${a})`;
    // outer neon glow (tight, then a faint wide falloff)
    const og = g.createRadialGradient(cx, cy, R * 0.96, cx, cy, S / 2);
    og.addColorStop(0, rgba(0.7)); og.addColorStop(0.12, rgba(0.38)); og.addColorStop(0.4, rgba(0.1)); og.addColorStop(1, rgba(0));
    g.fillStyle = og; g.fillRect(0, 0, S, S);
    // disc body: solid colour, slightly deeper towards the lower centre, brighter at the rim
    const body = g.createRadialGradient(cx, cy + R * 0.1, R * 0.05, cx, cy, R);
    body.addColorStop(0, deep); body.addColorStop(0.55, body0); body.addColorStop(0.88, shade(0.62)); body.addColorStop(1, edge);
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fillStyle = body; g.fill();
    // inner glow (sheet sec 3 "Inner Glow"): colour light bleeding inward from the rim
    const ig = g.createRadialGradient(cx, cy, R * 0.6, cx, cy, R);
    ig.addColorStop(0, rgba(0)); ig.addColorStop(0.8, rgba(0.1)); ig.addColorStop(1, rgba(0.45));
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fillStyle = ig; g.fill();
    // soft gloss on the upper half
    g.save(); g.beginPath(); g.arc(cx, cy, R * 0.97, 0, Math.PI * 2); g.clip();
    const gl = g.createLinearGradient(0, cy - R, 0, cy);
    gl.addColorStop(0, 'rgba(255,255,255,0.14)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gl; g.beginPath(); g.ellipse(cx, cy - R * 0.45, R * 0.85, R * 0.55, 0, 0, Math.PI * 2); g.fill();
    g.restore();
    // rim: a saturated colour edge with a soft glow (no white core line; reference discs have none)
    g.lineWidth = S * 0.014; g.strokeStyle = shade(1.15, 1.05); g.shadowColor = color; g.shadowBlur = S * 0.04;
    g.beginPath(); g.arc(cx, cy, R - S * 0.004, 0, Math.PI * 2); g.stroke();
    g.shadowBlur = 0; g.lineWidth = S * 0.006; g.strokeStyle = rgba(0.7);
    g.beginPath(); g.arc(cx, cy, R - S * 0.004, 0, Math.PI * 2); g.stroke();
    tex.needsUpdate = true;
    if (!icon) return tex;
    // icon
    const isz = R * 1.18;
    const img = new Image();
    img.onload = () => {
      g.save(); g.shadowColor = lite; g.shadowBlur = S * 0.02;
      g.drawImage(img, cx - isz / 2, cy - isz / 2, isz, isz); g.restore();
      g.drawImage(img, cx - isz / 2, cy - isz / 2, isz, isz);
      tex.needsUpdate = true;
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(iconSvg(iconName, { size: Math.round(isz), stroke: 2.3, color: '#FFFFFF' }));
    return tex;
  });
}

/**
 * DARK neon badge disc (default badge look, sheet sec 4 tiles): near-black navy body with only a faint
 * tint of `color`, a thin neon rim in `color` with a tight glow, and a soft inner glow at the rim.
 * Disc radius = 0.36 of the canvas (same geometry as the solid badge).
 */
export function neonDiscTexture(color, { px = 512, body = '#0B1220', tint = 0.06 } = {}) {
  return cached(`neondisc:${color}:${px}:${body}:${tint}`, () => {
    const S = px, c = canvas(S, S), g = c.getContext('2d'), tex = canvasTexture(c);
    const R = S * 0.36, cx = S / 2, cy = S / 2;
    const srgb = new THREE.Color(color).convertLinearToSRGB();
    const rgba = (a) => `rgba(${srgb.r * 255 | 0},${srgb.g * 255 | 0},${srgb.b * 255 | 0},${a})`;
    // tight outer neon glow
    const og = g.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.32);
    og.addColorStop(0, rgba(0.45)); og.addColorStop(0.3, rgba(0.14)); og.addColorStop(1, rgba(0));
    g.fillStyle = og; g.fillRect(0, 0, S, S);
    // dark body, faint colour tint, a bit lighter toward the rim
    const bd = g.createRadialGradient(cx, cy - R * 0.15, R * 0.1, cx, cy, R);
    bd.addColorStop(0, hexMix(body, color, tint * 0.6)); bd.addColorStop(0.75, hexMix(body, color, tint)); bd.addColorStop(1, hexMix(body, color, tint * 2.2));
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fillStyle = bd; g.fill();
    // inner glow from the rim
    const ig = g.createRadialGradient(cx, cy, R * 0.72, cx, cy, R);
    ig.addColorStop(0, rgba(0)); ig.addColorStop(0.8, rgba(0.05)); ig.addColorStop(1, rgba(0.3));
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fillStyle = ig; g.fill();
    // neon rim: colour stroke with glow + lighter core line
    g.lineWidth = S * 0.014; g.strokeStyle = color; g.shadowColor = color; g.shadowBlur = S * 0.035;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    g.shadowBlur = 0; g.lineWidth = S * 0.005; g.strokeStyle = hexMix(color, '#FFFFFF', 0.5);
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    tex.needsUpdate = true;
    return tex;
  });
}

function neonIconTexture(iconName, color, { px = 256, stroke = 2.3 } = {}) {
  return cached(`neonicon:${iconName}:${color}:${px}:${stroke}`, () => {
    const S = px, c = canvas(S, S), g = c.getContext('2d'), tex = canvasTexture(c);
    const isz = S * 0.84, o = (S - isz) / 2;
    const svg = (col, st) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(iconSvg(iconName, { size: Math.round(isz), stroke: st, color: col }));
    const main = new Image(), core = new Image();
    let n = 0;
    const done = () => {
      if (++n < 2) return;
      g.save(); g.shadowColor = color; g.shadowBlur = S * 0.05; g.globalAlpha = 0.85;
      g.drawImage(main, o, o, isz, isz); g.drawImage(main, o, o, isz, isz); g.restore(); // glow
      g.drawImage(main, o, o, isz, isz); // crisp colour stroke
      g.globalAlpha = 0.85; g.drawImage(core, o, o, isz, isz); g.globalAlpha = 1; // light core line
      tex.needsUpdate = true;
    };
    main.onload = done; core.onload = done;
    main.src = svg(color, stroke); core.src = svg(hexMix(color, '#FFFFFF', 0.6), stroke * 0.38);
    return tex;
  });
}

/**
 * Line-icon texture (transparent background), icon spans 0.84 of the canvas.
 * Default: white with a soft white glow. With opts.color: FLASHY neon icon (sheet sec 4): a coloured
 * glow around the strokes, a crisp coloured stroke and a thin lighter core line.
 */
export function iconTexture(iconName, { px = 256, stroke = 2.3, color = null } = {}) {
  if (color) return neonIconTexture(iconName, color, { px, stroke });
  return cached(`icon:${iconName}:${px}:${stroke}`, () => {
    const S = px, c = canvas(S, S), g = c.getContext('2d'), tex = canvasTexture(c);
    const isz = S * 0.84, o = (S - isz) / 2;
    const img = new Image();
    img.onload = () => {
      g.save(); g.shadowColor = 'rgba(200,225,255,0.6)'; g.shadowBlur = S * 0.015;
      g.drawImage(img, o, o, isz, isz); g.restore();
      g.drawImage(img, o, o, isz, isz);
      tex.needsUpdate = true;
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(iconSvg(iconName, { size: Math.round(isz), stroke, color: '#FFFFFF' }));
    return tex;
  });
}

/**
 * FILLED white glyph for solid badges (reference: a crisp, solid white document with a folded corner
 * and the text lines cut out so the disc colour shows through). Falls back to the line icon.
 */
export function solidIconTexture(iconName, { px = 256 } = {}) {
  if (iconName !== 'document') return iconTexture(iconName, { px, stroke: 2.5 });
  return cached(`solidicon:${iconName}:${px}`, () => {
    const S = px, c = canvas(S, S), g = c.getContext('2d'), tex = canvasTexture(c);
    const u = (S * 0.84) / 24, o = (S - S * 0.84) / 2; // same 24-unit frame as the SVG icons
    const X = (v) => o + v * u;
    g.fillStyle = '#FFFFFF';
    // page with a rounded outline and the top-right corner folded
    const r = 1.6;
    g.beginPath();
    g.moveTo(X(5 + r), X(2.5)); g.lineTo(X(14), X(2.5)); g.lineTo(X(19.5), X(8)); g.lineTo(X(19.5), X(21.5 - r));
    g.quadraticCurveTo(X(19.5), X(21.5), X(19.5 - r), X(21.5)); g.lineTo(X(5 + r), X(21.5));
    g.quadraticCurveTo(X(4.5), X(21.5), X(4.5), X(21.5 - r)); g.lineTo(X(4.5), X(2.5 + r));
    g.quadraticCurveTo(X(4.5), X(2.5), X(5 + r), X(2.5)); g.closePath(); g.fill();
    // cut-outs: fold crease and text lines
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.moveTo(X(13.2), X(2.5)); g.lineTo(X(13.2), X(9.3)); g.lineTo(X(19.5), X(9.3)); g.lineTo(X(19.5), X(8.4)); g.lineTo(X(14.1), X(8.4)); g.lineTo(X(14.1), X(2.5)); g.closePath(); g.fill();
    const bar = (x0, x1, y) => { g.beginPath(); g.roundRect(X(x0), X(y - 0.75), X(x1) - X(x0), 1.5 * u, 0.75 * u); g.fill(); };
    bar(7.5, 11.5, 9.5); bar(7.5, 16.5, 13.2); bar(7.5, 16.5, 16.8);
    g.globalCompositeOperation = 'source-over';
    tex.needsUpdate = true;
    return tex;
  });
}

/** Standard badge diameter (world units) for every building. */
export const BADGE_SIZE = 4.4;

/**
 * Floating circular rooftop badge (camera-facing). Returns a Group; position it at the badge centre.
 * opts: size (disc diameter in world units, default 4; use BADGE_SIZE = 4.4 everywhere), halo (halo scale),
 *       bob, pulse, phase, roofGlowY (y of a coloured light pool on the roof, relative to the badge; null = none),
 *       poolOpacity (0.35),
 *       style: 'solid' (DEFAULT: saturated colour disc, neon rim, white icon) |
 *              'neon' (option: dark navy disc, neon rim + flashy neon icon in `color`, sheet sec 4),
 *       iconColor (neon: icon colour, default `color`; solid: tint, default white),
 *       iconBoost (icon brightness multiplier; default 1.05 neon / 0.84 solid: keep solid icons below the 0.85 bloom threshold),
 *       haloOpacity (0.3; 0 disables the soft additive halo),
 *       pulseRing (true: neon ring expands from the rim and fades), pulsePeriod (2.6 s), ringOpacity (0.75).
 * Tagged for picking: group.name = 'badge', group/disc/icon userData.badge = { icon, color }.
 * Animation is exposed as group.userData.update(t) and auto-registered by placeBuilding().
 */
export function makeBadge(iconName, color, {
  size = 4, halo = 1.4, bob = 0.14, pulse = 0.15, phase = 0, roofGlowY = null, poolOpacity = 0.35,
  style = 'solid', iconBoost = null, haloOpacity = 0.24, iconColor = null, pulseRing = true, pulsePeriod = 2.6, ringOpacity = 0.75,
} = {}) {
  const neon = style === 'neon';
  // solid: the OutputPass applies ACES to every pixel (material toneMapped is ignored inside the composer),
  // and UnrealBloom passes WHOLE pixels above its 0.85 luminance threshold. 0.849 is the brightest white
  // that stays out of the bloom (tone-maps to ~#E1E1E1); 1.0+ blooms the icon into a pale wash over the
  // disc (tested 10-31). A pure #FFFFFF icon needs an engine change (badges drawn after the OutputPass).
  iconBoost ??= neon ? 1.05 : 0.849;
  const g = new THREE.Group();
  const holder = new THREE.Group();
  const haloMat = new THREE.SpriteMaterial({ map: glowTexture('radial'), color, transparent: true, opacity: haloOpacity, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false, toneMapped: false });
  const haloS = new THREE.Sprite(haloMat); haloS.scale.setScalar(size * halo); haloS.renderOrder = 20;
  haloS.visible = haloOpacity > 0;
  const disc = new THREE.Sprite(new THREE.SpriteMaterial({ map: badgeTexture(iconName, color, { icon: false, style: neon ? 'neon' : 'solid' }), transparent: true, depthWrite: false, depthTest: false, fog: false, toneMapped: false }));
  disc.scale.setScalar(size / 0.72); disc.renderOrder = 22; // texture disc radius = 0.36 of the canvas
  const iconMat = new THREE.SpriteMaterial({ map: neon ? iconTexture(iconName, { color: iconColor || color, stroke: 2.4 }) : solidIconTexture(iconName), transparent: true, depthWrite: false, depthTest: false, fog: false, toneMapped: false });
  iconMat.color.set(neon ? '#FFFFFF' : iconColor || '#FFFFFF').multiplyScalar(iconBoost);
  const iconS = new THREE.Sprite(iconMat);
  // solid badges: placeBuilding() moves this icon onto the post-OutputPass overlay (pure #FFFFFF, no bloom)
  if (!neon) iconS.userData.badgeIcon = { tint: iconColor || '#FFFFFF' };
  iconS.scale.setScalar((size * (neon ? 0.59 : 0.65)) / 0.84); iconS.renderOrder = 23; // icon = 0.65 of the disc diameter (solid)
  holder.add(haloS, disc, iconS);
  let ringS = null, ringMat = null;
  if (pulseRing) {
    ringMat = new THREE.SpriteMaterial({ map: ringTexture(), color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false, toneMapped: false });
    ringS = new THREE.Sprite(ringMat); ringS.renderOrder = 21; ringS.scale.setScalar(size / 0.84);
    holder.add(ringS);
  }
  g.name = 'badge';
  g.userData.badge = { icon: iconName, color };
  disc.userData.badge = g.userData.badge;
  iconS.userData.badge = g.userData.badge;
  g.add(holder);
  // soft coloured light pool on the roof under the badge
  if (roofGlowY !== null) {
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(size * 1.9, size * 1.9), glowMaterial(color, 'radial', poolOpacity));
    pool.rotation.x = -Math.PI / 2; pool.position.y = roofGlowY; pool.renderOrder = 2;
    g.add(pool);
  }
  g.userData.update = (t) => {
    holder.position.y = Math.sin(t * 1.3 + phase) * bob;
    const p = 0.5 + 0.5 * Math.sin(t * 2.1 + phase);
    haloMat.opacity = haloOpacity * (0.8 + 1.3 * pulse * p);
    haloS.scale.setScalar(size * halo * (1 + 0.05 * p));
    if (ringS) {
      const k = (((t + phase) / pulsePeriod) % 1 + 1) % 1; // 0..1
      ringS.scale.setScalar((size / 0.84) * (1 + 0.32 * k)); // tight: the reference glow stays near the disc edge
      ringMat.opacity = ringOpacity * (1 - k) * (1 - k);
    }
  };
  return g;
}

// ------------------------------------------------------------------------------------------
// Lights + placement
// ------------------------------------------------------------------------------------------
/** Adds the shared building lights once per scene (cool hemisphere + soft moonlight). */
export function ensureLights(ctx) {
  const { scene } = ctx;
  if (scene.userData.buildingLights) return;
  scene.userData.buildingLights = true;
  const hemi = new THREE.HemisphereLight('#B9C2FF', '#3A2A1C', 1.15);
  const moon = new THREE.DirectionalLight('#DCDDFF', 1.35);
  moon.position.set(-25, 80, 45);
  scene.add(hemi, moon);
}

/**
 * Positions `group` (built in the local frame) at a layout slot, rotated so local +Z faces the core,
 * adds it to the scene, registers any userData.update(t, dt) found in the tree via ctx.onTick,
 * and ensures the shared lights. Returns the group.
 */
// ---- crisp white badge icons -------------------------------------------------------------------
// The composer's OutputPass applies ACES to every pixel and the bloom catches anything above 0.85, so a
// white icon drawn in the main scene ends up a dull ~#E1E1E1 (or blooms into a pale wash). Solid-badge
// icons are therefore rendered on their own layer by a pass appended AFTER the OutputPass: it copies the
// finished frame, then draws only the icon sprites over it, unlit and un-tone-mapped (pure #FFFFFF).
// The icons sit on BADGE_ICON_LAYER only, so the main render, the bloom and the raycaster (layer 0) skip
// them; clicks still hit the badge disc, which stays on layer 0.
export const BADGE_ICON_LAYER = 7;
class BadgeIconPass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene; this.camera = camera; this.needsSwap = false;
    this.copy = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D(tDiffuse, vUv); }',
      depthTest: false, depthWrite: false,
    }));
  }
  render(renderer, writeBuffer, readBuffer) {
    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      this.copy.material.uniforms.tDiffuse.value = readBuffer.texture;
      this.copy.render(renderer);
    } else {
      renderer.setRenderTarget(readBuffer);
    }
    const { scene, camera } = this;
    const mask = camera.layers.mask, bg = scene.background, auto = renderer.autoClear;
    camera.layers.set(BADGE_ICON_LAYER); scene.background = null; renderer.autoClear = false;
    renderer.render(scene, camera);
    camera.layers.mask = mask; scene.background = bg; renderer.autoClear = auto;
  }
  dispose() { this.copy.dispose(); this.copy.material.dispose(); }
}
function ensureBadgeIconPass(ctx) {
  const { scene, camera, composer } = ctx;
  if (scene.userData.badgeIconPass) return true;
  if (!composer || !camera || typeof composer.addPass !== 'function') return false;
  scene.userData.badgeIconPass = new BadgeIconPass(scene, camera);
  composer.addPass(scene.userData.badgeIconPass);
  return true;
}

export function placeBuilding(ctx, slot, group) {
  const a = slot.deg * D2R;
  group.position.set(Math.cos(a) * slot.r, 0, -Math.sin(a) * slot.r);
  group.rotation.y = (slot.deg - 90) * D2R;
  group.name = `building:${slot.id}`;
  ctx.scene.add(group);
  ensureLights(ctx);
  if (ensureBadgeIconPass(ctx)) {
    group.traverse((o) => {
      if (!o.userData.badgeIcon) return;
      o.layers.set(BADGE_ICON_LAYER);
      o.material.color.set(o.userData.badgeIcon.tint); // full white: the overlay has no bloom or tone mapping
    });
  }
  const fns = [];
  group.traverse((o) => { if (typeof o.userData.update === 'function') fns.push(o.userData.update); });
  if (fns.length) ctx.onTick((t, dt) => { for (const f of fns) f(t, dt); });
  return group;
}

export { D2R };
