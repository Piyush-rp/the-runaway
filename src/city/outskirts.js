/*
 * Outskirts: vegetation everywhere (instanced low-poly trees, uplights, park lamps), the dim outer
 * city beyond ring2 (office blocks, low-rise blocks, parking lots, side streets) and the monument
 * plaza with the waving Indian tricolour.
 *
 * Everything is MeshBasicMaterial with baked shading (the scene has no lights) + canvas textures.
 * Placement avoids roads (sampled from roads.js getRoadPaths), junction nodes and building slots.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getRoadPaths, getJunctions } from './roads.js';
import * as KIT from './buildings/kit.js';

// ---------------------------------------------------------------- deterministic random
let _seed = 1337;
const rnd = () => {
  _seed = (_seed + 0x6d2b79f5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const range = (a, b) => a + (b - a) * rnd();
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
// smooth value noise for organic tree density
function hash2(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function noise2(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Reference screen point (1536x1024 ref/dashboard.png) -> world, by casting a ray through a virtual
// copy of the camera at the reference aspect. `h` = height of the plane hit (roof centres use h).
// The mapper rebuilds the engine's reference camera from constants (engine.js: fov 20, 53.85 deg elevation,
// distance 279.6, target (-0.85,0,8.15)) so it never depends on build order or on the live window size.
// Keep these in sync with engine.js.
function makeScreenMapper() {
  const cam = new THREE.PerspectiveCamera(20, 1536 / 1024, 0.5, 1800);
  const el = THREE.MathUtils.degToRad(53.85), dist = 279.6, tx = -0.85, tz = 8.15;
  cam.position.set(tx, Math.sin(el) * dist, Math.cos(el) * dist + tz);
  cam.lookAt(tx, 0, tz);
  cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(), v = new THREE.Vector2(), p = new THREE.Vector3();
  const toWorld = (sx, sy, h = 0) => {
    v.set((sx / 1536) * 2 - 1, -((sy / 1024) * 2 - 1));
    ray.setFromCamera(v, cam);
    const o = ray.ray.origin, d = ray.ray.direction, t = (h - o.y) / d.y;
    return { x: o.x + d.x * t, z: o.z + d.z * t };
  };
  // world -> ref screen px
  const toScreen = (x, z, y = 0) => { p.set(x, y, z).project(cam); return { sx: (p.x + 1) * 768, sy: (1 - p.y) * 512, ok: p.z < 1 }; };
  return { toWorld, toScreen };
}
const SCR = makeScreenMapper();
function refToWorld(sx, sy, _R2, h = 0) { return SCR.toWorld(sx, sy, h); }

// Occupancy mask rasterised from whatever buildings already exist in the scene (other agents' modules
// are built before this one), so trees never grow through a building whatever its final shape.
class Mask {
  constructor(size = 240, cell = 0.5) { this.c = cell; this.h = size / 2; this.n = Math.ceil(size / cell); this.a = new Uint8Array(this.n * this.n); }
  idx(x, z) {
    const i = Math.floor((x + this.h) / this.c), j = Math.floor((z + this.h) / this.c);
    return i < 0 || j < 0 || i >= this.n || j >= this.n ? -1 : j * this.n + i;
  }
  set(x, z) { const k = this.idx(x, z); if (k >= 0) this.a[k] = 1; }
  disc(x, z, r) { for (let dx = -r; dx <= r; dx += this.c * 0.7) for (let dz = -r; dz <= r; dz += this.c * 0.7) if (dx * dx + dz * dz <= r * r) this.set(x + dx, z + dz); }
  get(x, z) { const k = this.idx(x, z); return k >= 0 && this.a[k] === 1; }
  any(x, z, r) {
    if (this.get(x, z)) return true;
    const st = this.c;
    for (let dx = -r; dx <= r + 1e-6; dx += st) for (let dz = -r; dz <= r + 1e-6; dz += st) {
      if (dx * dx + dz * dz <= r * r && this.get(x + dx, z + dz)) return true;
    }
    return false;
  }
}
function rasteriseBuildings(scene, mask, lawnMask) {
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), m = new THREE.Matrix4(), P = new THREE.Vector3();
  let groups = 0;
  const edge = (a, b) => {
    const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / (mask.c * 0.5)));
    for (let i = 0; i <= n; i++) mask.set(a.x + ((b.x - a.x) * i) / n, a.z + ((b.z - a.z) * i) / n);
  };
  for (const g of scene.children) {
    if (!g.name || !g.name.startsWith('building:')) continue;
    groups++;
    g.updateMatrixWorld(true);
    g.traverse((o) => {
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); m.premultiply(o.matrixWorld); P.setFromMatrixPosition(m); mask.disc(P.x, P.z, 0.7); }
        return;
      }
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      const pos = o.geometry.attributes.position, idx = o.geometry.index, mw = o.matrixWorld;
      const mc = (Array.isArray(o.material) ? o.material[0] : o.material)?.color;
      const green = !!mc && mc.g > mc.r * 1.2 && mc.g > mc.b * 1.1; // building lawn lots (kit MAT.lawn)
      const tri = idx ? idx.count / 3 : pos.count / 3;
      for (let t = 0; t < tri; t++) {
        const ia = idx ? idx.getX(t * 3) : t * 3, ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        A.fromBufferAttribute(pos, ia).applyMatrix4(mw); B.fromBufferAttribute(pos, ib).applyMatrix4(mw); C.fromBufferAttribute(pos, ic).applyMatrix4(mw);
        const maxY = Math.max(A.y, B.y, C.y), minY = Math.min(A.y, B.y, C.y);
        const target = maxY < 0.22 ? (green && lawnMask ? lawnMask : null) : minY > 2.5 ? null : mask;
        if (!target) continue; // floating badges are not obstacles; lawn lots feed the lawn mask
        const tset = (x, z) => target.set(x, z);
        if (target === mask) { edge(A, B); edge(B, C); edge(C, A); }
        const x0 = Math.min(A.x, B.x, C.x), x1 = Math.max(A.x, B.x, C.x), z0 = Math.min(A.z, B.z, C.z), z1 = Math.max(A.z, B.z, C.z);
        const den = (B.z - C.z) * (A.x - C.x) + (C.x - B.x) * (A.z - C.z);
        if (Math.abs(den) < 1e-6) continue;
        const st = mask.c * 0.5;
        for (let x = x0; x <= x1; x += st) for (let z = z0; z <= z1; z += st) {
          const l1 = ((B.z - C.z) * (x - C.x) + (C.x - B.x) * (z - C.z)) / den;
          const l2 = ((C.z - A.z) * (x - C.x) + (A.x - C.x) * (z - C.z)) / den;
          if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) tset(x, z);
        }
      }
    });
  }
  return groups;
}
// Green-lawn sampler: reads the painted ground canvas (ground.js) so trees grow on lawns, not paving.
function makeLawnSampler(scene, worldSize) {
  // ground.js paints two canvases: 'ground-city' (detailed, transparent outside the city) over 'ground'.
  const layer = (name, fallbackSize) => {
    try {
      const m = scene.getObjectByName(name);
      const img = m?.material?.map?.image;
      if (!img || !img.getContext) return null;
      const size = m.geometry?.parameters?.width || fallbackSize;
      const W = img.width, H = img.height, data = img.getContext('2d').getImageData(0, 0, W, H).data, k = W / size;
      return (x, z) => {
        const px = Math.floor(W / 2 + (x - m.position.x) * k), py = Math.floor(H / 2 + (z - m.position.z) * k);
        if (px < 0 || py < 0 || px >= W || py >= H) return -1;
        const o = (py * W + px) * 4, r = data[o], g = data[o + 1], b = data[o + 2], a = data[o + 3];
        if (a < 128) return -1;
        return g > 22 && g > r * 1.22 && g > b * 1.1 ? 1 : 0;
      };
    } catch (e) { return null; }
  };
  const city = layer('ground-city', worldSize), outer = layer('ground', worldSize);
  if (!city && !outer) return null;
  return (x, z) => {
    const c = city ? city(x, z) : -1;
    if (c >= 0) return c === 1;
    return outer ? outer(x, z) === 1 : false;
  };
}


// ---------------------------------------------------------------- canvas helpers
function canvasTex(w, h, draw, { repeat = false, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}

function glowTexture() {
  return canvasTex(128, 128, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    r.addColorStop(0.6, 'rgba(255,255,255,0.14)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });
}

// facade texture: 6 bays x 4 floors, warm lit windows clustered in runs (lit rooms next to each other),
// slate walls with light floor slabs. warm=true: low-rise variant with denser, warmer light.
function facadeTexture(seed, litRatio, warm = false) {
  return canvasTex(256, 256, (g, w, h) => {
    const s0 = _seed; _seed = seed;
    g.fillStyle = '#2b3047'; g.fillRect(0, 0, w, h);
    for (let f = 0; f < 4; f++) {
      const y = f * 64;
      g.fillStyle = '#4c5370'; g.fillRect(0, y, w, 8);
      g.fillStyle = '#0c111d'; g.fillRect(0, y + 8, w, 2);
      let run = rnd() < litRatio;
      for (let c = 0; c < 6; c++) {
        if (rnd() < 0.38) run = rnd() < litRatio; // lit rooms come in runs
        const x = c * (w / 6) + 6, ww = w / 6 - 12, wy = y + 17, wh = 38;
        if (run) {
          const col = warm ? pick(['#ffc163', '#ffb54d', '#ffd48a', '#ffcf7a']) : pick(['#ffcf7a', '#ffb54d', '#ffe3a6', '#ffc163', '#fff0c4']);
          const gr = g.createLinearGradient(0, wy, 0, wy + wh);
          gr.addColorStop(0, col); gr.addColorStop(1, warm ? '#d0782a' : '#c97a26');
          g.fillStyle = gr; g.fillRect(x, wy, ww, wh);
        } else {
          g.fillStyle = rnd() < 0.5 ? '#0a1020' : '#141f36'; g.fillRect(x, wy, ww, wh);
          g.fillStyle = 'rgba(90,120,170,0.16)'; g.fillRect(x, wy, ww, 6);
        }
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + ww / 2 - 1, wy, 2, wh);
      }
    }
    _seed = s0;
  }, { repeat: true });
}

// navy roof (reference roofs are deep blue with a thin light rim); panel=true: the lighter raised inset
function roofTexture(panel = false) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = panel ? '#22355f' : '#18284a'; g.fillRect(0, 0, w, h);
    const gr = g.createRadialGradient(w * 0.35, h * 0.3, 10, w / 2, h / 2, w * 0.75);
    gr.addColorStop(0, 'rgba(90,110,160,0.22)'); gr.addColorStop(1, 'rgba(0,0,0,0.3)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    // speckle (roof gravel, vents)
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${150 + 80 * hash2(i, 1)},${160 + 70 * hash2(i, 2)},200,${0.08 + 0.1 * hash2(i, 3)})`; g.fillRect(hash2(i, 4) * w, hash2(i, 5) * h, 3, 3); }
    // parapet rim: light edge line + dark inner shadow
    g.strokeStyle = panel ? '#6f82b8' : '#7f92c6'; g.lineWidth = panel ? 5 : 8; g.strokeRect(3, 3, w - 6, h - 6);
    g.strokeStyle = '#0d1630'; g.lineWidth = 4; g.strokeRect(10, 10, w - 20, h - 20);
  });
}

function parkingTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#161c2a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#2c3548'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
    g.strokeStyle = 'rgba(200,210,230,0.55)'; g.lineWidth = 2;
    for (const row of [[16, 100], [156, 240]]) {
      for (let x = 16; x <= w - 16; x += 22) { g.beginPath(); g.moveTo(x, row[0]); g.lineTo(x, row[1]); g.stroke(); }
    }
    g.fillStyle = 'rgba(255,190,90,0.12)'; g.fillRect(0, 118, w, 20);
  });
}

function streetTexture() {
  // runs along U. dark asphalt, faint edges, warm centre dashes
  return canvasTex(128, 32, (g, w, h) => {
    g.fillStyle = '#121725'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2b3347'; g.fillRect(0, 0, w, 2); g.fillRect(0, h - 2, w, 2);
    g.fillStyle = 'rgba(255,200,120,0.55)'; g.fillRect(8, h / 2 - 1, 40, 2); g.fillRect(72, h / 2 - 1, 40, 2);
  }, { repeat: true });
}

function plazaTexture() {
  return canvasTex(1024, 1024, (g, w) => {
    const c = w / 2, R = 512; // texture radius == PLAZA_R
    g.fillStyle = '#2b2a3b'; g.fillRect(0, 0, w, w);
    const disc = (r, col) => { g.fillStyle = col; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill(); };
    const ring = (r, col, lw) => { g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke(); };
    disc(R, '#3e3c51');            // outer promenade (lighter, lamp-lit)
    disc(R * 0.86, '#353347');
    disc(R * 0.74, '#2e2c3f');     // under the first tier
    // warm washes near the lit rings
    const wash = (r0, r1, a) => {
      const gr = g.createRadialGradient(c, c, r0, c, c, r1);
      gr.addColorStop(0, `rgba(255,180,95,${a})`); gr.addColorStop(1, 'rgba(255,180,95,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(c, c, r1, 0, Math.PI * 2); g.arc(c, c, r0, 0, Math.PI * 2, true); g.fill();
    };
    wash(R * 0.74, R * 0.9, 0.22); wash(R * 0.93, R, 0.18);
    ring(R * 0.995, '#ffd59a', 5); ring(R * 0.86, 'rgba(255,214,160,0.45)', 3);
    ring(R * 0.93, 'rgba(255,255,255,0.06)', 2); ring(R * 0.8, 'rgba(255,255,255,0.05)', 2);
    // paving joints
    g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 2;
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      g.beginPath(); g.moveTo(c + Math.cos(a) * R * 0.74, c + Math.sin(a) * R * 0.74); g.lineTo(c + Math.cos(a) * R * 0.99, c + Math.sin(a) * R * 0.99); g.stroke();
    }
  });
}
function flagTexture() {
  return canvasTex(300, 200, (g, w, h) => {
    g.fillStyle = '#FF9933'; g.fillRect(0, 0, w, h / 3);
    g.fillStyle = '#FFFFFF'; g.fillRect(0, h / 3, w, h / 3);
    g.fillStyle = '#138808'; g.fillRect(0, (2 * h) / 3, w, h / 3 + 1);
    const cx = w / 2, cy = h / 2, r = h / 6 - 3;
    g.strokeStyle = '#000080'; g.fillStyle = '#000080'; g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1.2;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.stroke();
    }
    g.beginPath(); g.arc(cx, cy, 3.5, 0, Math.PI * 2); g.fill();
  });
}

// ---------------------------------------------------------------- geometry helpers
// paint every triangle of a non-indexed geometry with a colour from fn(faceNormal, centroid)
function paintFaces(geo, fn) {
  const pos = geo.attributes.position, n = pos.count;
  const col = new Float32Array(n * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3(), cen = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    nrm.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
    cen.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    const color = fn(nrm, cen);
    for (let k = 0; k < 3; k++) col.set([color.r, color.g, color.b], (i + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// paint per-vertex by height (for smooth vertical gradients)
function paintVertical(geo, fn) {
  const pos = geo.attributes.position, n = pos.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const c = fn(pos.getY(i), pos.getX(i), pos.getZ(i)); col.set([c.r, c.g, c.b], i * 3); }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

const LIGHT_DIR = new THREE.Vector3(-0.45, 0.8, -0.4).normalize();

/// one low-poly tree: tapered trunk + a cluster of rounded, faceted canopy blobs (icosahedron detail 1,
// jittered). Vertex colours carry baked light (neutral grey * warm top highlight); the per-instance
// colour supplies the green tone. uplit=true adds the warm under-glow of a ground uplight.
const _treeGeoCache = new Map();
function treeGeometry(variant, uplit) {
  const key = `${variant}-${uplit}`;
  if (_treeGeoCache.has(key)) return _treeGeoCache.get(key);
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.07, 0.12, 0.8, 5, 1, true).toNonIndexed();
  trunk.translate(0, 0.4, 0);
  paintFaces(trunk, () => new THREE.Color(uplit ? '#8a6a3c' : '#3a2c22'));
  parts.push(trunk);
  const BLOBS = [
    [[0, 1.15, 0, 0.66], [0.32, 1.38, 0.16, 0.46], [-0.3, 1.34, -0.12, 0.46], [0.04, 1.7, -0.04, 0.42]], // round
    [[0, 1.0, 0, 0.58], [-0.42, 1.06, 0.2, 0.46], [0.42, 1.1, -0.16, 0.48], [0.06, 1.42, 0.06, 0.46]],    // wide clump
    [[0, 1.12, 0, 0.52], [0.02, 1.55, 0, 0.45], [0.04, 1.92, 0.02, 0.32]],                                  // tall
    [[0, 0.95, 0, 0.6], [0.1, 1.3, 0.05, 0.44]],                                                            // small round
  ][variant];
  let js = variant * 977 + 13;
  const jr = () => { js = (js * 16807) % 2147483647; return js / 2147483647 - 0.5; };
  BLOBS.forEach(([x, y, z, r], bi) => {
    const g = new THREE.IcosahedronGeometry(r, bi === 0 ? 1 : 0); // main crown rounded, side lobes cheap
    // organic jitter (shared corners stay welded: offsets are keyed by position)
    const pos = g.attributes.position, off = new Map();
    for (let i = 0; i < pos.count; i++) {
      const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
      if (!off.has(k)) off.set(k, 1 + jr() * 0.22);
      const f = off.get(k);
      pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f * 0.9, pos.getZ(i) * f);
    }
    g.translate(x, y, z);
    paintFaces(g, (n, c) => {
      const lam = Math.max(0, n.dot(LIGHT_DIR));
      const top = n.y * 0.5 + 0.5;
      // strong light/shadow contrast: dark leafy shadow side, warm lit crown edges (reference look)
      const k = 0.2 + 0.72 * lam + 0.16 * top;
      const col = new THREE.Color(k, k, k * 0.95);
      const hl = Math.pow(lam, 2.2) * 0.6 * top; // warm-lit crown tops
      col.r += hl * 1.25; col.g += hl * 1.0; col.b -= hl * 0.15;
      if (uplit) {
        const under = THREE.MathUtils.clamp(1.0 - (c.y - 0.7) / 1.1, 0, 1) * (0.5 + 0.5 * (1 - top));
        col.r += 1.6 * under; col.g += 1.25 * under; col.b += 0.15 * under;
      }
      return col;
    });
    parts.push(g);
  });
  const geo = mergeGeometries(parts);
  _treeGeoCache.set(key, geo);
  return geo;
}

// box with separate side + top geometry, world-scaled UVs for repeating facade textures
function pushBox(sides, tops, x, z, w, d, h, rot, shade = 1) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const P = (lx, lz) => [x + lx * c - lz * s, z + lx * s + lz * c];
  const corners = [P(-w / 2, -d / 2), P(w / 2, -d / 2), P(w / 2, d / 2), P(-w / 2, d / 2)];
  const lens = [w, d, w, d];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
    const L = lens[i], u1 = L / 3.6, v1 = h / 3.2;
    // face normal (outward) for shading
    const nx = bz - az, nz = -(bx - ax), nl = Math.hypot(nx, nz);
    const lam = Math.max(0, (nx / nl) * -0.5 + (nz / nl) * 0.35);
    const k = (0.62 + 0.45 * lam) * shade;
    // wind so that the face points outward (CCW seen from outside)
    const v = [[ax, 0, az, 0, 0], [bx, 0, bz, u1, 0], [bx, h, bz, u1, v1], [ax, 0, az, 0, 0], [bx, h, bz, u1, v1], [ax, h, az, 0, v1]];
    for (const p of v) { sides.pos.push(p[0], p[1], p[2]); sides.uv.push(p[3], p[4]); sides.col.push(k, k, k * 1.04); }
  }
  const tv = [[corners[0], 0, 0], [corners[2], 1, 1], [corners[1], 1, 0], [corners[0], 0, 0], [corners[3], 0, 1], [corners[2], 1, 1]];
  for (const [p, u, vv] of tv) { tops.pos.push(p[0], h, p[1]); tops.uv.push(u, vv); tops.col.push(shade, shade, shade); }
}
function bufferFrom(b) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  return g;
}

// Bakes every mesh under `group` into world space and merges them into one mesh per (material,
// renderOrder). Multi-material meshes are split by their geometry groups first.
function mergeByMaterial(group) {
  group.updateMatrixWorld(true);
  const buckets = new Map();
  const add = (geo, mat, ro) => {
    const key = mat.uuid + ':' + ro;
    if (!buckets.has(key)) buckets.set(key, { mat, ro, geos: [] });
    buckets.get(key).geos.push(geo);
  };
  const norm = (g) => {
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', g.attributes.position);
    out.setAttribute('normal', g.attributes.normal || g.attributes.position);
    out.setAttribute('uv', g.attributes.uv || new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    return out;
  };
  const passthrough = [];
  group.traverse((o) => {
    if (!o.isMesh) return;
    if (o.isInstancedMesh) { passthrough.push(o); return; }
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(o.matrixWorld);
    if (Array.isArray(o.material)) {
      const groups = g.groups.length ? g.groups : [{ start: 0, count: g.attributes.position.count, materialIndex: 0 }];
      for (const gr of groups) {
        const sub = new THREE.BufferGeometry();
        for (const name of ['position', 'normal', 'uv']) {
          const at = g.attributes[name]; if (!at) continue;
          sub.setAttribute(name, new THREE.BufferAttribute(at.array.slice(gr.start * at.itemSize, (gr.start + gr.count) * at.itemSize), at.itemSize));
        }
        add(norm(sub), o.material[gr.materialIndex], o.renderOrder);
      }
    } else add(norm(g), o.material, o.renderOrder);
  });
  const out = new THREE.Group(); out.name = group.name;
  for (const { mat, ro, geos } of buckets.values()) {
    const m = new THREE.Mesh(mergeGeometries(geos, false), mat);
    m.renderOrder = ro; out.add(m);
  }
  for (const o of passthrough) { const mw = o.matrixWorld.clone(); o.removeFromParent(); mw.decompose(o.position, o.quaternion, o.scale); out.add(o); }
  return out;
}

// ---------------------------------------------------------------- occupancy (what trees must avoid)
class Occupancy {
  constructor() { this.cell = 4; this.grid = new Map(); this.discs = []; this.rects = []; this.mask = null; }
  _key(i, j) { return i * 100003 + j; }
  addSegment(ax, az, bx, bz, hw) {
    // register the segment in every cell within hw + PAD, so roadDist() is exact for clearances up to PAD
    // (before, a point just outside the asphalt in a neighbouring cell saw no road at all)
    const s = { ax, az, bx, bz, hw }, c = this.cell, pd = hw + 4;
    const i0 = Math.floor((Math.min(ax, bx) - pd) / c), i1 = Math.floor((Math.max(ax, bx) + pd) / c);
    const j0 = Math.floor((Math.min(az, bz) - pd) / c), j1 = Math.floor((Math.max(az, bz) + pd) / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = this._key(i, j);
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(s);
    }
  }
  addDisc(x, z, r) { this.discs.push({ x, z, r }); }
  addRect(x, z, w, d, rot, pad = 0) { this.rects.push({ x, z, hw: w / 2 + pad, hd: d / 2 + pad, c: Math.cos(rot), s: Math.sin(rot) }); }
  roadDist(x, z) {
    const c = this.cell, list = this.grid.get(this._key(Math.floor(x / c), Math.floor(z / c)));
    let best = Infinity;
    if (!list) return best;
    for (const s of list) {
      const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1e-6;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2));
      const d = Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t)) - s.hw;
      if (d < best) best = d;
    }
    return best;
  }
  // clear: distance kept from roads, the main buildings and the edge; rclear (default clear): from placed rects/discs
  blocked(x, z, clear, rclear = clear) {
    if (this.rMax && Math.hypot(x, z) > this.rMax - clear * 0.5) return true;
    if (this.roadDist(x, z) < clear) return true;
    if (this.mask && this.mask.any(x, z, Math.max(0, clear - 0.25))) return true;
    for (const d of this.discs) if (Math.hypot(x - d.x, z - d.z) < d.r + rclear) return true;
    for (const r of this.rects) {
      const dx = x - r.x, dz = z - r.z;
      const lx = dx * r.c + dz * r.s, lz = -dx * r.s + dz * r.c;
      if (Math.abs(lx) < r.hw + rclear && Math.abs(lz) < r.hd + rclear) return true;
    }
    return false;
  }
}

// simple point hash to keep trees apart
class PointHash {
  constructor(cell) { this.cell = cell; this.m = new Map(); }
  _k(i, j) { return i * 100003 + j; }
  add(x, z, r) { const k = this._k(Math.floor(x / this.cell), Math.floor(z / this.cell)); if (!this.m.has(k)) this.m.set(k, []); this.m.get(k).push([x, z, r]); }
  near(x, z, r) {
    const i = Math.floor(x / this.cell), j = Math.floor(z / this.cell);
    for (let a = i - 1; a <= i + 1; a++) for (let b = j - 1; b <= j + 1; b++) {
      const l = this.m.get(this._k(a, b)); if (!l) continue;
      for (const p of l) if (Math.hypot(p[0] - x, p[1] - z) < r + p[2]) return true;
    }
    return false;
  }
}

// =================================================================================================
export default function build(ctx) {
  if (typeof location !== "undefined" && location.search.includes("no-outskirts")) return;
  const { scene, camera, onTick, layout } = ctx;
  const { RINGS, BUILDINGS, MONUMENT, polar } = layout;
  const R2 = RINGS.ring2;
  _seed = 1337;

  const root = new THREE.Group();
  root.name = 'outskirts';
  scene.add(root);

  // ------------------------------------------------------------ reference-space mapping + visibility
  const onScreen = (x, z, m = 1.12) => { const p = SCR.toScreen(x, z); const nx = p.sx / 768 - 1, ny = p.sy / 512 - 1; return p.ok && Math.abs(nx) < m && Math.abs(ny) < m; };

  // ------------------------------------------------------------ occupancy from roads + buildings
  const occ = new Occupancy();
  let roads = [];
  try { roads = getRoadPaths(layout); } catch (e) { console.warn('[outskirts] no road paths', e); }
  for (const road of roads) {
    const n = Math.max(2, Math.ceil(road.length / 1.2));
    let prev = road.center.getPoint(0);
    for (let i = 1; i <= n; i++) {
      const p = road.center.getPoint(i / n);
      occ.addSegment(prev.x, prev.z, p.x, p.z, road.width / 2 + (road.kind === 'access' ? 0.5 : 0));
      prev = p;
    }
    if (road.kind === 'roundabout' && road.cx !== undefined) occ.addDisc(road.cx, road.cz, road.radius + road.width / 2);
  }
  try { for (const j of getJunctions(layout)) occ.addDisc(j.x, j.z, (j.size || 1.5) * 0.9); } catch (e) { /* optional */ }
  // the last ring (layout.EDGE_RING) is kept clear even before roads.js draws it
  const ER = layout.EDGE_RING || { radius: 150, width: 3.4 };
  if (!roads.some((r) => r.id === 'ring4')) {
    for (let i = 0; i < 360; i++) { const a0 = (i * Math.PI) / 180, a1 = ((i + 1) * Math.PI) / 180; occ.addSegment(Math.cos(a0) * ER.radius, Math.sin(a0) * ER.radius, Math.cos(a1) * ER.radius, Math.sin(a1) * ER.radius, ER.width / 2); }
  }
  // nothing is built on or outside the last ring
  const R_MAX = ER.radius - ER.width / 2 - 1.4;
  occ.rMax = R_MAX;
  occ.addDisc(0, 0, RINGS.ring0 + 0.6); // core plaza + ring0 interior
  // real building geometry (rasterised) + the layout slots as a fallback for buildings not yet built
  occ.mask = new Mask(240, 0.5);
  const lotLawn = new Mask(240, 0.5);
  const built = rasteriseBuildings(scene, occ.mask, lotLawn);
  const builtIds = new Set(scene.children.filter((c) => c.name?.startsWith('building:')).map((c) => c.name.slice(9)));
  for (const b of BUILDINGS) {
    const p = polar(b.r, b.deg);
    occ.addDisc(p.x, p.z, b.footprint * (builtIds.has(b.id) ? 0.3 : b.ring === 'outer' ? 0.62 : 0.6));
  }
  // monument: placed where the reference shows it (plaza centre at ref px ~ (1470, 446))
  // The east exit road (deg 0) runs right under that point now that the exits end on the outer ring,
  // so the plaza slides south (towards the camera) just far enough to clear every road.
  const MON = SCR.toWorld(1470, 446);
  void MONUMENT;
  // plaza a little smaller than the original 6.6 so it can sit next to the full-length east exit (exit-0)
  // with its sidewalk clear, while staying as close as possible to the reference spot
  const PLAZA_R = 5.7;
  const discClear = (cx, cz, R) => {
    for (let rr = 0; rr <= R + 1e-6; rr += 1) for (let i = 0, n = Math.max(1, Math.round(rr * 2)); i < n; i++) {
      const a = (i / n) * Math.PI * 2; if (occ.roadDist(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr) < 1.1) return false;
    }
    return true;
  };
  const z0 = MON.z;
  for (let dz = 0; dz < 16; dz += 0.2) { if (discClear(MON.x, z0 + dz, PLAZA_R)) { MON.z = z0 + dz; break; } }
  occ.addDisc(MON.x, MON.z, PLAZA_R + 0.3);

  const shared = { glow: glowTexture(), footprints: [], R_MAX, OR: layout.OUTER_RING || { radius: 84, width: 3.4 } };

  // ------------------------------------------------------------ outer city
  buildOuterCity(root, occ, onScreen, R2, shared);

  // ------------------------------------------------------------ large developments (r 84 ring -> last ring)
  buildDevelopments(root, occ, shared, layout, roads);

  // ------------------------------------------------------------ road audit (user 10-31: prove nothing sits on a road)
  // Every outer building footprint (+0.35 for roof overhang / parapet) against every road from getRoadPaths():
  // a violation is any footprint point closer to a road centre line than half its width plus a 0.8 sidewalk.
  {
    const segs = [];
    for (const road of roads) {
      const n = Math.max(2, Math.ceil(road.length / 0.8));
      let prev = road.center.getPoint(0);
      for (let i = 1; i <= n; i++) { const q = road.center.getPoint(i / n); segs.push([prev.x, prev.z, q.x, q.z, road.width / 2, road.id]); prev = q; }
    }
    const segDist = (x, z, sg) => {
      const dx = sg[2] - sg[0], dz = sg[3] - sg[1], L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - sg[0]) * dx + (z - sg[1]) * dz) / L2));
      return Math.hypot(x - sg[0] - dx * t, z - sg[1] - dz * t);
    };
    const bad = [];
    for (const f of shared.footprints) {
      const c = Math.cos(f.rot), sn = Math.sin(f.rot), hw = f.w / 2 + 0.35, hd = f.d / 2 + 0.35, R = Math.hypot(hw, hd);
      const near = segs.filter((sg) => segDist(f.x, f.z, sg) < R + sg[4] + 1.5);
      if (!near.length) continue;
      const pts = [];
      const nx = Math.ceil((2 * hw) / 0.25), nz = Math.ceil((2 * hd) / 0.25);
      for (let i = 0; i <= nx; i++) { const lx = -hw + (2 * hw * i) / nx; pts.push([lx, -hd], [lx, hd]); }
      for (let j = 0; j <= nz; j++) { const lz = -hd + (2 * hd * j) / nz; pts.push([-hw, lz], [hw, lz]); }
      pts.push([0, 0]);
      let hit = null;
      for (const [lx, lz] of pts) {
        const x = f.x + lx * c - lz * sn, z = f.z + lx * sn + lz * c;
        for (const sg of near) if (segDist(x, z, sg) - sg[4] - 0.8 < 0) { hit = sg[5]; break; }
        if (hit) break;
      }
      if (hit) bad.push(`${f.name}@${hit}`);
    }
    root.userData.roadAudit = { buildings: shared.footprints.length, violations: bad.length, list: bad };
    console.info(`[outskirts] road audit: ${shared.footprints.length} outer buildings, ${bad.length} on or within 0.8 of a road`);
  }

  // ------------------------------------------------------------ monument
  buildMonument(root, MON, PLAZA_R, onTick, shared, occ);

  // ------------------------------------------------------------ vegetation
  const groundLawn = makeLawnSampler(scene, layout.WORLD_SIZE || 220);
  const lawn = (x, z) => lotLawn.get(x, z) || (groundLawn ? groundLawn(x, z) : false);
  root.userData.debug = { lawn, occ };
  buildVegetation(root, occ, onScreen, RINGS, R2, roads, shared, onTick, lawn);
  root.userData.stats = { ...root.userData.stats, buildingsRasterised: built };
}

// =================================================================================================
// OUTER CITY
// Hand-placed from the reference corners (screen points of ref/dashboard.png, mapped through SCR):
// a few large varied blocks (navy roofs with lit rims, warm window facades), the curved glass office
// complex top-left, the round fountain plaza bottom-left, parking lots with rows of lit cars and
// low-rise courtyard blocks bottom-left / bottom-right. Every footprint is checked against all roads
// (getRoadPaths, incl. the outer ring at r 84) and nudged or shrunk until it is clear, else skipped.
function buildOuterCity(root, occ, onScreen, R2, shared) {
  const W = (sx, sy, h = 0) => SCR.toWorld(sx, sy, h);
  const baseGlows = [];
  const stats = { blocks: 0, skipped: [] };

  // world angle of a reference-screen edge (both points at height h)
  const local = (x, z, rot) => { const c = Math.cos(rot), s = Math.sin(rot); return (lx, lz) => [x + lx * c - lz * s, z + lx * s + lz * c]; };
  // a footprint is clear when its centre, corners and edge midpoints are all off roads/buildings
  const fits = (x, z, w, d, rot, clear = 0.7) => {
    const L = local(x, z, rot);
    if (occ.blocked(x, z, Math.min(w, d) * 0.3)) return false;
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [0, 1], [-1, 0], [-0.5, -1], [0.5, -1], [0.5, 1], [-0.5, 1], [-1, -0.5], [1, -0.5], [-1, 0.5], [1, 0.5]]) {
      const [px, pz] = L((u * w) / 2, (v * d) / 2);
      if (occ.blocked(px, pz, clear)) return false;
    }
    return true;
  };
  // search outward from the wanted spot (and shrink a little) for a clear footprint
  const settle = (name, x, z, w, d, rot, clear = 0.7, reach = 6) => {
    for (const k of [1, 0.9, 0.8, 0.7]) {
      const ww = w * k, dd = d * k;
      for (let rr = 0; rr <= reach; rr += 0.75) {
        const n = rr === 0 ? 1 : Math.max(10, Math.round(rr * 5));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2, px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
          if (fits(px, pz, ww, dd, rot, clear)) return { x: px, z: pz, w: ww, d: dd, k };
        }
      }
    }
    stats.skipped.push(name);
    return null;
  };

  // ---- buildings (shared kit, so they read like the 18 main buildings, a little smaller/dimmer) ------
  // Landmarks are hand-placed from the reference corners; the rest of the outer zone (both sides of the
  // r 84 ring, out to the screen edges) is filled with varied kit buildings, trees in the gaps.
  // spec: { at:[sx,sy] roof centre on screen, type, w, d, floors, rot (rad) | edge:[[sx,sy],[sx,sy]] | face:true }
  const outerGroup = new THREE.Group(); outerGroup.name = 'outer-city-buildings';
  const placedB = [];

  // fountain plaza spot is reserved before the fill too
  const FOUNTAIN_R = 3.4;
  const fountainFit = (() => { const p = W(240, 818); const f = settle('fountain', p.x, p.z, 2 * FOUNTAIN_R, 2 * FOUNTAIN_R, 0, 0.5); if (f) occ.addDisc(f.x, f.z, FOUNTAIN_R + 0.3); return f; })();
  // parking lots are reserved before the fill so the fill leaves them room
  const parkTex = parkingTexture();
  const lots = [];
  const LOTS = [[112, 404, 9, 4.6, 0.1], [1442, 560, 7.5, 4.4, -0.05], [1240, 880, 7, 4.4, -0.45], [300, 868, 7, 4.2, 0.5], [560, 52, 7, 4.2, -0.1], [1330, 250, 6.5, 4.2, 0.5]];
  for (const [sx, sy, w, d, rot] of LOTS) {
    const p = W(sx, sy);
    const fit = settle(`lot@${sx},${sy}`, p.x, p.z, w, d, rot, 0.4);
    if (!fit) continue;
    occ.addRect(fit.x, fit.z, fit.w, fit.d, rot, 0.4);
    lots.push({ x: fit.x, z: fit.z, w: fit.w, d: fit.d, rot, rect: occ.rects[occ.rects.length - 1] });
  }
  // reference parking lots that fell outside the r 84 ring belong to the development zone now
  {
    const ORr = shared.OR.radius, drop = new Set();
    for (let i = lots.length - 1; i >= 0; i--) if (Math.hypot(lots[i].x, lots[i].z) > ORr - 2) { drop.add(lots[i].rect); lots.splice(i, 1); }
    occ.rects = occ.rects.filter((r) => !drop.has(r));
  }
  // User 10-31: the ring2 -> r 84 band (all the way round) is filled with broad buildings of the main
  // family (makeFamily), 9 to 14 units across, facing the core. Largest-first blue-noise placement.
  {
    const rr = KIT.makeRng(5150), rg = (a, b) => a + (b - a) * rr();
    const rIn = R2 + 1.7 + 1.2, rOut = shared.OR.radius - shared.OR.width / 2 - 1.2;
    const cand = [];
    for (let i = 0; i < 5000; i++) { const a = rr() * Math.PI * 2, r = rg(rIn + 4, rOut - 4); cand.push([Math.cos(a) * r, Math.sin(a) * r, rg(10, 14.5), rg(7.5, 10.5)]); }
    cand.sort((p, q) => q[2] * q[3] - p[2] * p[3] + (rr() - 0.5) * 30);
    let n = 0;
    for (const [x, z, w0, d0] of cand) {
      if (n >= 46) break;
      const rot = Math.atan2(x, -z);
      let w = w0, d = d0, ok = false;
      for (const k of [1, 0.88, 0.76]) { w = w0 * k; d = d0 * k; if (fits(x, z, w + 0.8, d + 0.8, rot, 1.1)) { ok = true; break; } }
      if (!ok) continue;
      occ.addRect(x, z, w, d, rot, 1.1);
      placedB.push({ name: `fam-${n}`, x, z, rot, w, d, kind: FAM_KINDS[(n * 5 + Math.floor(rr() * 3)) % FAM_KINDS.length] }); n++;
    }
    stats.fill = n;
  }

  // build every placed building as a variation of the main buildings (local +Z = front, faces the core)
  const lampPts = [];
  placedB.forEach((b, i) => {
    const g = makeFamily(b.kind, b.w, b.d, 500 + i * 17, { maxFloors: 5 });
    g.position.set(b.x, 0, b.z); g.rotation.y = -b.rot;
    outerGroup.add(g);
    shared.footprints.push({ x: b.x, z: b.z, rot: b.rot, w: b.w, d: b.d, name: b.name + '-' + b.kind });
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    for (const sx of [-1, 1]) {
      const lx = sx * (b.w / 2 + 0.7), lz = b.d / 2 + 0.7;
      const px = b.x + lx * c - lz * s, pz = b.z + lx * s + lz * c;
      if (occ.roadDist(px, pz) > 0.5) lampPts.push([px, pz]);
    }
    stats.blocks++;
  });
  if (lampPts.length) root.add(KIT.makeLamps(lampPts, { height: 0.85, size: 0.8, pool: 0.22 }));
  // collapse the whole outer city into one mesh per material (keeps draw calls low on the weak GPU)
  root.add(mergeByMaterial(outerGroup));

  // warm light pools around the block bases (instanced additive quads)
  const poolMat = new THREE.MeshBasicMaterial({ map: shared.glow, color: '#ffb35c', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
  const poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, Math.max(1, baseGlows.length));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  baseGlows.forEach((g, i) => {
    q.setFromAxisAngle(up, -g.rot);
    m4.compose(new THREE.Vector3(g.x, 0.03, g.z), q, new THREE.Vector3(g.w * 1.3, 1, g.d * 1.3));
    pools.setMatrixAt(i, m4);
    pools.setColorAt(i, new THREE.Color(g.a, g.a, g.a));
  });
  pools.count = baseGlows.length;
  pools.renderOrder = 1;
  root.add(pools);

  // ---- fountain plaza (bottom-left, reference centre ~ (240, 818)) ----------------------------------
  {
    const R = FOUNTAIN_R, fit = fountainFit;
    if (fit) {
      const g = new THREE.Group(); g.position.set(fit.x, 0, fit.z); root.add(g);
      const flat = (geo, color, y) => { const m = new THREE.Mesh(geo.rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); m.position.y = y; g.add(m); return m; };
      flat(new THREE.CircleGeometry(R, 64), '#34364c', 0.03);                 // asphalt carriage ring
      flat(new THREE.RingGeometry(R * 0.66, R * 0.7, 64), '#4a4a60', 0.035);  // kerb
      flat(new THREE.CircleGeometry(R * 0.66, 64), '#1d3324', 0.04);          // dark lawn
      flat(new THREE.RingGeometry(R - 0.1, R, 64), '#5a5670', 0.035);         // outer kerb
      // warm edge lights (outer kerb) and inner ring lights
      const dotGeo = new THREE.SphereGeometry(0.07, 6, 4), dots = [];
      for (const [rr, n] of [[R - 0.05, 30], [R * 0.68, 18]]) for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; dots.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
      const dm = new THREE.InstancedMesh(dotGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd28a').multiplyScalar(1.5) }), dots.length);
      dots.forEach(([x, z], i) => dm.setMatrixAt(i, m4.makeTranslation(x, 0.1, z))); g.add(dm);
      const wash = new THREE.Mesh(new THREE.RingGeometry(R * 0.7, R * 1.25, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff9f45', transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false }));
      wash.position.y = 0.05; g.add(wash);
      // stone basin with water and a small upper tier
      const basin = new THREE.CylinderGeometry(R * 0.32, R * 0.34, 0.35, 32).toNonIndexed(); basin.translate(0, 0.175, 0);
      paintFaces(basin, (n) => new THREE.Color(n.y > 0.5 ? '#6a6f88' : '#8a8fa6'));
      g.add(new THREE.Mesh(basin, new THREE.MeshBasicMaterial({ vertexColors: true })));
      const water = new THREE.Mesh(new THREE.CircleGeometry(R * 0.28, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color('#5b8fd0').multiplyScalar(1.05) }));
      water.position.y = 0.36; g.add(water);
      const tier = new THREE.CylinderGeometry(R * 0.12, R * 0.15, 0.4, 20).toNonIndexed(); tier.translate(0, 0.55, 0);
      paintFaces(tier, (n) => new THREE.Color(n.y > 0.5 ? '#b9bdd0' : '#8a8fa6'));
      g.add(new THREE.Mesh(tier, new THREE.MeshBasicMaterial({ vertexColors: true })));
      const jet = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: shared.glow, color: '#9cc8ff', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      jet.position.y = 0.4; g.add(jet);
      occ.addDisc(fit.x, fit.z, R + 0.3);
      stats.fountain = true;
    }
  }

  // ---- parking lots with rows of lit cars -------------------------------------------------------------
  const lotMat = new THREE.MeshBasicMaterial({ map: parkTex, color: '#c4cbe0', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const carGeo = new THREE.BoxGeometry(0.95, 0.3, 0.52);
  const cabGeo = new THREE.BoxGeometry(0.5, 0.18, 0.44);
  const headGeo = new THREE.BoxGeometry(0.06, 0.08, 0.4);
  const carList = [], lotGeos = [];
  for (const L of lots) {
    const g = new THREE.PlaneGeometry(L.w, L.d).rotateX(-Math.PI / 2);
    g.rotateY(-L.rot); g.translate(L.x, 0.025, L.z);
    lotGeos.push(g);
    const c = Math.cos(L.rot), s = Math.sin(L.rot);
    // two rows of stalls, cars nose-in towards the centre aisle
    for (const [row, face] of [[-0.27, 1], [0.27, -1]]) for (let k = -L.w / 2 + 0.45; k < L.w / 2 - 0.3; k += 0.66) {
      if (rnd() < 0.28) continue;
      const lx = k, lz = row * L.d;
      carList.push({ x: L.x + lx * c - lz * s, z: L.z + lx * s + lz * c, rot: L.rot + Math.PI / 2, face });
    }
  }
  if (lotGeos.length) root.add(new THREE.Mesh(mergeGeometries(lotGeos), lotMat));
  // lot lighting: soft warm pool over every lot
  const lotGlowMat = new THREE.MeshBasicMaterial({ map: shared.glow, color: '#ffb35c', transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const L of lots) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(L.w * 1.5, L.d * 1.7).rotateX(-Math.PI / 2), lotGlowMat);
    g.rotation.y = -L.rot; g.position.set(L.x, 0.035, L.z); g.renderOrder = 1; root.add(g);
  }
  if (carList.length) {
    const n = carList.length;
    const cars = new THREE.InstancedMesh(carGeo, new THREE.MeshBasicMaterial({ color: '#ffffff' }), n);
    const cabs = new THREE.InstancedMesh(cabGeo, new THREE.MeshBasicMaterial({ color: '#ffffff' }), n);
    const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: '#ffffff' }), n * 2);
    const tones = ['#8e96aa', '#5d6680', '#7a3a44', '#34508a', '#a9afbf', '#2a3348', '#6e6a78', '#45506a'];
    const T = new THREE.Vector3(), V = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const headCol = new THREE.Color('#ffe6a8').multiplyScalar(1.6), tailCol = new THREE.Color('#ff3b3b').multiplyScalar(1.3);
    let hi = 0;
    carList.forEach((cc, i) => {
      q.setFromAxisAngle(up, -cc.rot);
      const col = new THREE.Color(pick(tones));
      cars.setMatrixAt(i, m4.compose(T.set(cc.x, 0.17, cc.z), q, one)); cars.setColorAt(i, col);
      cabs.setMatrixAt(i, m4.compose(T.set(cc.x, 0.4, cc.z), q, one)); cabs.setColorAt(i, col.clone().multiplyScalar(0.45).add(new THREE.Color(0.05, 0.08, 0.14)));
      // local +x = car length; headlights at the nose (towards the aisle), tail lights at the back
      const c = Math.cos(cc.rot), s = Math.sin(cc.rot);
      for (const [end, hc] of [[cc.face, headCol], [-cc.face, tailCol]]) {
        V.set(cc.x + 0.49 * end * c, 0.2, cc.z + 0.49 * end * s);
        heads.setMatrixAt(hi, m4.compose(V, q, one)); heads.setColorAt(hi++, hc);
      }
    });
    heads.count = hi;
    root.add(cars, cabs, heads);
  }

  // ---- side streets: narrow dark streets with faint warm dashes, linking the outer blocks ---------------
  const streetTex = streetTexture();
  const streetMat = new THREE.MeshBasicMaterial({ map: streetTex, color: '#c9cfdc', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const STREETS = [
    [[70, 300], [190, 330], [235, 420]],
    [[70, 455], [140, 445], [200, 440]],
    [[70, 655], [150, 640], [215, 610]],
    [[1536, 735], [1420, 720], [1330, 700]],
    [[1210, 880], [1250, 810], [1290, 760]],
    [[1300, 60], [1300, 160], [1260, 240]],
    [[330, 120], [300, 190]],
  ];
  const streetGeos = [], streetLamps = [];
  for (const poly of STREETS) {
    const pts = poly.map(([sx, sy]) => W(sx, sy));
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      // split into short pieces, drop the ones that would lie on a real road or a placed block
      const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 1.0)), ang = Math.atan2(b.z - a.z, b.x - a.x);
      for (let j = 0; j < n; j++) {
        const t0 = j / n, t1 = (j + 1) / n, tm = (t0 + t1) / 2;
        const mx = a.x + (b.x - a.x) * tm, mz = a.z + (b.z - a.z) * tm;
        if (occ.roadDist(mx, mz) < 0.55 || occ.blocked(mx, mz, 0.2) || Math.hypot(mx, mz) > shared.OR.radius - 2.4) continue;
        const seg = L / n;
        const g = new THREE.PlaneGeometry(seg + 0.05, 1.5).rotateX(-Math.PI / 2);
        const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setX(k, (uv.getX(k) + j) * (seg / 4));
        g.rotateY(-ang); g.translate(mx, 0.022, mz);
        streetGeos.push(g);
        if (j % 3 === 0) { const sd = j % 2 ? 1 : -1; streetLamps.push({ x: mx - Math.sin(ang) * 1.0 * sd, z: mz + Math.cos(ang) * 1.0 * sd }); }
      }
      for (let k = 0; k <= Math.ceil(L / 1.2); k++) {
        const t = k / Math.ceil(L / 1.2);
        if (Math.hypot(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) > shared.OR.radius - 2.4) continue;
        occ.addSegment(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 0.75);
      }
    }
  }
  if (streetGeos.length) root.add(new THREE.Mesh(mergeGeometries(streetGeos), streetMat));
  root.userData.streetLamps = streetLamps;
  root.userData.outerCity = { ...stats, lots: lots.length, cars: carList.length };
  if (stats.skipped.length) console.debug('[outskirts] outer city skipped', stats.skipped.join(', '));
}

// =================================================================================================
// MONUMENT
function buildMonument(root, MON, PLAZA_R, onTick, shared, occ) {
  const grp = new THREE.Group();
  grp.position.set(MON.x, 0, MON.z);
  root.add(grp);
  // the plaza rings/tiers were designed for radius 6.6: draw them in a horizontally scaled group
  const S = PLAZA_R / 6.6, pg = new THREE.Group(); pg.scale.set(S, 1, S); grp.add(pg);
  const R0 = 6.6;
  const basic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, ...extra });
  const WARM = new THREE.Color('#ffc472').multiplyScalar(1.7); // blooms
  const warmMat = basic(WARM);

  // ---- plaza floor: dark paving with joints and soft warm washes (canvas), slightly raised
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(R0, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: plazaTexture(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  plaza.position.y = 0.04;
  pg.add(plaza);
  // warm light pool around/under the whole plaza
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(R0 * 3.0, R0 * 3.0).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: shared.glow, color: '#ffae55', transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }));
  pool.position.y = 0.02;
  pg.add(pool);

  // ---- outer curb (thin lit rim) + low kerb wall
  const kerb = new THREE.CylinderGeometry(R0, R0, 0.16, 96, 1, true); kerb.translate(0, 0.08, 0);
  paintVertical(kerb, (y) => new THREE.Color('#d9a76a').lerp(new THREE.Color('#5a5670'), THREE.MathUtils.clamp(y / 0.16, 0, 1)));
  pg.add(new THREE.Mesh(kerb, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R0, 0.045, 4, 120).rotateX(Math.PI / 2), basic(new THREE.Color('#ffd9a0').multiplyScalar(1.2)));
  rim.position.y = 0.17; pg.add(rim);

  // ---- tiers: raised platforms whose vertical faces are washed by warm uplights
  const tierGeos = [], topGeos = [];
  const TIERS = [ // [radius, y0, y1, lit segments]
    [4.9, 0.0, 0.6, 16],
    [3.3, 0.6, 1.15, 12],
    [2.15, 1.15, 1.4, 0],
  ];
  const wallTex = (n) => canvasTex(1024, 64, (g, w, h) => {
    g.fillStyle = '#4a4458'; g.fillRect(0, 0, w, h);
    if (!n) { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#6d6478'); gr.addColorStop(1, '#c79a64'); g.fillStyle = gr; g.fillRect(0, 0, w, h); return; }
    for (let i = 0; i < n; i++) {
      const x0 = (i / n) * w + 6, ww = w / n - 22;
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#ffd99a'); gr.addColorStop(0.5, '#ffbf66'); gr.addColorStop(1, '#ff9a3c');
      g.fillStyle = gr; g.fillRect(x0, 8, ww, h - 14);
    }
    g.fillStyle = '#8a8098'; g.fillRect(0, 0, w, 6);
  });
  for (const [r, y0, y1, nSeg] of TIERS) {
    const side = new THREE.CylinderGeometry(r, r + 0.05, y1 - y0, 96, 1, true); side.translate(0, (y0 + y1) / 2, 0);
    const tm = new THREE.MeshBasicMaterial({ map: wallTex(nSeg), side: THREE.DoubleSide, color: new THREE.Color(1, 1, 1).multiplyScalar(nSeg ? 1.35 : 1) });
    pg.add(new THREE.Mesh(side, tm));
    const top = new THREE.RingGeometry(0, r, 96, 1).rotateX(-Math.PI / 2); top.translate(0, y1, 0);
    paintVertical(top, (y, x, z) => {
      const d = Math.hypot(x, z) / r;
      return new THREE.Color('#3b394d').lerp(new THREE.Color('#57536b'), THREE.MathUtils.smoothstep(d, 0.55, 1.0));
    });
    topGeos.push(top);
  }
  pg.add(new THREE.Mesh(mergeGeometries(topGeos), new THREE.MeshBasicMaterial({ vertexColors: true })));
  // bright lip rings on each tier edge
  for (const [r, , y1] of TIERS) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r + 0.01, 0.035, 4, 96).rotateX(Math.PI / 2), basic(new THREE.Color('#ffe2b0').multiplyScalar(1.1)));
    m.position.y = y1 + 0.01; pg.add(m);
  }

  // ---- segmented rings of warm light (lit niches / benches) on the plaza and the first tier
  const segGeos = [];
  const segRing = (rIn, rOut, y, n, fill) => {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, len = ((Math.PI * 2) / n) * fill;
      const g = new THREE.RingGeometry(rIn, rOut, 6, 1, a0, len).rotateX(-Math.PI / 2);
      g.translate(0, y, 0); segGeos.push(g);
    }
  };
  segRing(5.55, 5.7, 0.06, 28, 0.5); // faint ring of floor lights on the promenade
  pg.add(new THREE.Mesh(mergeGeometries(segGeos), new THREE.MeshBasicMaterial({ color: WARM, side: THREE.DoubleSide })));
  // their glow on the floor
  const segGlow = new THREE.Mesh(new THREE.RingGeometry(4.9, 6.2, 96, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff9f45', transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
  segGlow.position.y = 0.06; pg.add(segGlow);

  // lamp dots around the outer edge
  const dotGeo = new THREE.SphereGeometry(0.085, 6, 4);
  const dotPos = [];
  for (const [r, n, y] of [[R0 - 0.3, 40, 0.12], [4.6, 24, 0.64], [3.05, 16, 1.19]]) for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2; dotPos.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  const dots = new THREE.InstancedMesh(dotGeo, basic(new THREE.Color('#ffe0a0').multiplyScalar(1.4)), dotPos.length);
  const m4 = new THREE.Matrix4();
  dotPos.forEach((p, i) => dots.setMatrixAt(i, m4.makeTranslation(p[0], p[1], p[2])));
  pg.add(dots);

  // ---- tower. The reference (ref px) shows the base at (1473,440), the tower top at (1476,397) and
  // the flag-pole top at (1483,347). Axes are aimed at those points so it reads the same on screen.
  const BASE_Y = 1.4, TOWER_H = 7.0, POLE_H = 14.6;
  // (shifted by the plaza's screen offset when the plaza had to move off the east exit road)
  const mS = SCR.toScreen(MON.x, MON.z), dsx = mS.sx - 1470, dsy = mS.sy - 446;
  const towerTopW = SCR.toWorld(1476 + dsx, 397 + dsy, TOWER_H);
  const poleTopW = SCR.toWorld(1483 + dsx, 348 + dsy, POLE_H);
  const toLocal = (p, y) => new THREE.Vector3(p.x - MON.x, y, p.z - MON.z);
  const baseL = new THREE.Vector3(0, BASE_Y, 0);
  const topL = toLocal(towerTopW, TOWER_H);
  const poleTopL = toLocal(poleTopW, POLE_H);
  // keep the lean subtle (never more than ~10 deg in world)
  const clampLean = (from, to, maxDeg) => {
    const d = to.clone().sub(from), h = Math.hypot(d.x, d.z), lim = Math.tan((maxDeg * Math.PI) / 180) * d.y;
    if (h > lim) { d.x *= lim / h; d.z *= lim / h; }
    return from.clone().add(d);
  };
  const topC = clampLean(baseL, topL, 0);     // tower stands perfectly vertical (user: no slant)
  const poleTopC = clampLean(topC, poleTopL, 0); // flagpole stands perfectly vertical (user: no slant)
  const axisGroup = (from, to) => {
    const g = new THREE.Group(); g.position.copy(from);
    const dir = to.clone().sub(from); const len = dir.length();
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    grp.add(g); return { g, len };
  };

  // octagonal pedestal with warm-lit faces and bright corner fins
  {
    const { g, len } = axisGroup(baseL, topC);
    const H = len; // tower group height
    const parts = [];
    // faceted stone: flat-shaded by a light from the upper left, warm uplight towards the foot
    const L = new THREE.Vector3(-0.6, 0.55, 0.6).normalize();
    const stoneShade = (top, bottom, y0, y1) => (n, c) => {
      const lam = Math.max(0, n.dot(L)), t = THREE.MathUtils.clamp((c.y - y0) / (y1 - y0), 0, 1);
      const col = new THREE.Color(bottom).lerp(new THREE.Color(top), t);
      return col.multiplyScalar(0.55 + 0.55 * lam + (n.y > 0.5 ? 0.15 : 0));
    };
    const add = (geo, shade) => { const g2 = geo.toNonIndexed(); paintFaces(g2, shade); parts.push(g2); };
    const ped = new THREE.CylinderGeometry(1.25, 1.5, 0.95, 8, 1, false); ped.rotateY(Math.PI / 8); ped.translate(0, 0.47, 0);
    add(ped, stoneShade('#9a90a8', '#e0a865', 0, 0.95));
    const cap = new THREE.CylinderGeometry(1.0, 1.32, 0.2, 8); cap.rotateY(Math.PI / 8); cap.translate(0, 1.05, 0);
    add(cap, stoneShade('#c9c2d6', '#c9c2d6', 0, 1));
    const drum = new THREE.CylinderGeometry(0.72, 0.9, 0.9, 8); drum.rotateY(Math.PI / 8); drum.translate(0, 1.6, 0);
    add(drum, stoneShade('#cfc8da', '#e6b882', 1.15, 2.05));
    // tapered faceted shaft
    const shaft = new THREE.CylinderGeometry(0.26, 0.55, H - 2.05, 4, 1, false); shaft.rotateY(Math.PI / 4); shaft.translate(0, 2.05 + (H - 2.05) / 2, 0);
    add(shaft, stoneShade('#f2f2f8', '#e8dccb', 2.05, H));
    // collar at the shaft foot and a small one higher up
    for (const [y, r] of [[2.1, 0.62], [3.7, 0.44]]) {
      const c = new THREE.CylinderGeometry(r, r + 0.05, 0.14, 8); c.translate(0, y, 0);
      add(c, stoneShade('#ffffff', '#f0e2cc', y - 0.1, y + 0.1));
    }
    const tip = new THREE.CylinderGeometry(0.05, 0.26, 0.55, 4); tip.rotateY(Math.PI / 4); tip.translate(0, H + 0.27, 0);
    add(tip, stoneShade('#ffffff', '#ffffff', 0, 1));
    g.add(new THREE.Mesh(mergeGeometries(parts), new THREE.MeshBasicMaterial({ vertexColors: true })));
    // lit corner fins on the pedestal
    const fins = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const f = new THREE.BoxGeometry(0.08, 0.8, 0.08); f.translate(Math.cos(a) * 1.4, 0.45, Math.sin(a) * 1.4); fins.push(f);
    }
    g.add(new THREE.Mesh(mergeGeometries(fins), warmMat));
    // warm band at the pedestal foot
    const band = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.05, 4, 32).rotateX(Math.PI / 2), warmMat);
    band.position.y = 0.05; g.add(band);
  }

  // flag pole rises from the shaft top
  const { g: poleG, len: poleLen } = axisGroup(topC.clone().add(new THREE.Vector3(0, 0.3, 0)), poleTopC);
  poleG.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, poleLen, 6).translate(0, poleLen / 2, 0), basic('#eef0f8')));
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), basic(new THREE.Color('#ffe7b0').multiplyScalar(1.3)));
  finial.position.y = poleLen + 0.08; poleG.add(finial);

  // the tricolour, waving (in world orientation, attached to the pole top)
  const FW = 2.1, FH = 2.5, SX = 24, SY = 12;
  const flagGeo = new THREE.PlaneGeometry(FW, FH, SX, SY);
  flagGeo.translate(FW / 2, 0, 0);
  const base = flagGeo.attributes.position.array.slice();
  const fcol = new Float32Array(flagGeo.attributes.position.count * 3).fill(1);
  flagGeo.setAttribute('color', new THREE.BufferAttribute(fcol, 3));
  const flag = new THREE.Mesh(flagGeo, new THREE.MeshBasicMaterial({ map: flagTexture(), vertexColors: true, side: THREE.DoubleSide }));
  flag.position.copy(poleTopC).add(new THREE.Vector3(0.03, -FH / 2 - 0.12, 0));
  flag.rotation.y = -0.72; // flies east and towards the camera: on screen it hangs down-right like the reference
  grp.add(flag);
  const pos = flagGeo.attributes.position;
  onTick((t) => {
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1];
      const k = x / FW; // 0 at pole, 1 at fly end
      const ph = x * 2.4 - t * 5.0 + y * 0.6;
      const wz = Math.sin(ph) * 0.24 * k + Math.sin(ph * 0.53 + 1.3) * 0.08 * k;
      pos.setXYZ(i, x - k * k * 0.1, y - k * k * 0.22 + Math.sin(ph + 0.8) * 0.04 * k, wz);
      const sh = 0.86 + 0.18 * Math.cos(ph);
      fcol[i * 3] = sh; fcol[i * 3 + 1] = sh; fcol[i * 3 + 2] = sh;
    }
    pos.needsUpdate = true;
    flagGeo.attributes.color.needsUpdate = true;
  });

  // paved approach paths from the plaza (west towards ring2, plus north and south)
  const pathMat = new THREE.MeshBasicMaterial({ color: '#34324a', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const paths = [];
  const toCentre = Math.atan2(-MON.z, -MON.x);
  for (const [ang, len0] of [[toCentre, 8], [toCentre + Math.PI / 2, 5], [toCentre - Math.PI / 2, 5]]) {
    // stop each path short of any road (exit-0 runs right past the plaza)
    let len = 0;
    while (len < len0 && occ.roadDist(MON.x + Math.cos(ang) * (PLAZA_R + len + 0.5), MON.z + Math.sin(ang) * (PLAZA_R + len + 0.5)) > 0.9) len += 0.5;
    if (len < 1.5) continue;
    const g = new THREE.PlaneGeometry(len, 1.4).rotateX(-Math.PI / 2);
    g.translate(PLAZA_R + len / 2 - 0.3, 0.018, 0); g.rotateY(-ang);
    paths.push(g);
    for (let d = PLAZA_R; d < PLAZA_R + len; d += 1.0) occ.addSegment(MON.x + Math.cos(ang) * d, MON.z + Math.sin(ang) * d, MON.x + Math.cos(ang) * d, MON.z + Math.sin(ang) * d, 0.75);
  }
  if (paths.length) grp.add(new THREE.Mesh(mergeGeometries(paths), pathMat));
}

// =================================================================================================
// MAIN-BUILDING FAMILY (user 10-31): every outer building is a variation of the 18 main buildings:
// broad curved / rounded light shells (kit outlines + makeBlock, light walls, thick lavender parapet rims,
// navy / violet roof decks), ribbon glazing, warm floor lines, glowing roof edges, set-back upper tiers,
// drums, wings and roof courts, warm base glow. No badges. Local frame: centred on the footprint,
// +Z = front (faces the core), everything stays inside [-w/2, w/2] x [-d/2, d/2].
const _famMats = {};
function famMats() {
  if (_famMats.shell) return _famMats;
  const L = (color, emissive) => new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity: 1 });
  _famMats.shell = L('#B6B8C8', '#20222E');
  _famMats.rim = L('#C4C2E2', '#34324E');
  // roof decks: the kit's light lavender deck (same as the main buildings) and a violet variant
  const violet = new THREE.MeshLambertMaterial({ color: '#A79CD6', map: KIT.MAT.roof.map, emissive: '#2A2050', emissiveIntensity: 1 });
  _famMats.decks = [KIT.MAT.roof, KIT.MAT.roof, violet];
  _famMats.glass = new THREE.MeshLambertMaterial({ color: '#5aa8ff', emissive: '#2a6fd6', emissiveIntensity: 0.9, transparent: true, opacity: 0.88 });
  return _famMats;
}
const FAM_KINDS = ['wedge', 'stadium', 'dshape', 'crescent', 'pentagon', 'multi', 'podium'];
const FAM_EDGES = ['#E8ECFF', '#D9C2FF', '#9FD0FF', '#FFD9A0', '#BFD8FF', '#7FE8FF'];
const FAM_RIM = { thick: 0.4, overhang: 0.28, parapetH: 0.34, parapetW: 0.4 };
const FAM_RIM_S = { thick: 0.26, overhang: 0.16, parapetH: 0.26, parapetW: 0.26 };
function makeFamily(kind, w, d, seed, { maxFloors = 6, boost = 0 } = {}) {
  const r = KIT.makeRng(seed), rg = (a, b) => a + (b - a) * r(), pk = (a) => a[Math.floor(r() * a.length)];
  const M = famMats(), deck = pk(M.decks), ST = { step: 2.2 };
  const edge = pk(FAM_EDGES), win = pk(['ribbon', 'ribbon', 'dark', 'warm']);
  const g = new THREE.Group();
  const F = (n) => Math.max(1, Math.min(maxFloors, n + boost));
  const blk = (o, opts, ground = false) => {
    // selective glazing like the main buildings: mostly dark glass, lit ribbons only now and then
    if (opts.windows?.style === 'warm') opts.windows = { ...opts.windows, style: 'dark' };
    else if (opts.windows?.style === 'ribbon' && r() < 0.55) opts.windows = { ...opts.windows, style: 'dark' };
    const b = KIT.makeBlock(o, { tone: 'light', materials: { facade: M.shell, trim: M.rim, roof: deck }, ledge: 0.08, ledgeH: 0.12, floorH: 1.15, lobbyH: 1.3, seed: seed % 97, bayWidth: 0.85, roof: FAM_RIM, ...opts });
    g.add(b.group);
    if (ground) g.add(KIT.makeBaseGlow(o, { height: 1.3, spread: 1.8, intensity: 0.42 }));
    return b;
  };
  const fx = (extra = {}) => ({ roofEdge: edge, floorLines: r() < 0.35 ? '#FFD9A0' : false, intensity: 0.8, ...extra });
  const upper = (o, y0, floors, extra = {}) => blk(o, { y0, floors, lobbyH: 0.3, lobby: false, windows: { style: pk(['dark', 'ribbon']), sides: 'all' }, roof: FAM_RIM_S, effects: { roofEdge: edge, intensity: 0.8 }, ...extra });
  const details = (items, y) => g.add(KIT.makeRoofDetails(items, y));
  // inner tiers / courts: the outline scaled about its centre (an inward offset of these filleted
  // outlines self-intersects and produced spiky roofs; a scaled copy is always a simple polygon)
  const scaleO = (o, ix, iz) => {
    const kx = Math.max(0.3, 1 - (2 * ix) / w), kz = Math.max(0.3, 1 - (2 * iz) / d);
    return { pts: o.pts.map(([x, z]) => [x * kx, z * kz]), tags: o.tags.slice() };
  };
  const court = (o, y, lawn = false) => g.add(KIT.makeRoofCourt(o, y, lawn ? { material: KIT.MAT.lawn } : {}));
  const circle = (rad, cx = 0, cz = 0) => { const pts = []; for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; pts.push([cx + Math.cos(a) * rad, cz + Math.sin(a) * rad]); } return KIT.polyOutline(pts, 0, { step: 2 }); };
  if (kind === 'wedge') {
    // curved wedge (sector of a ring): wide bowed back, narrower bowed front, set-back upper tier
    const b = Math.min(1.4, d * 0.12), dd = d - 2 * b;
    // sampled polygon (a spline outline produced self-intersecting roof offsets at the corners)
    const pts = [], n = 8;
    for (let k = 0; k <= n; k++) { const t = k / n, x = -w / 2 + w * t; pts.push([x, -dd / 2 - b * (1 - (2 * t - 1) ** 2)]); }
    for (let k = n; k >= 0; k--) { const t = k / n, x = -w * 0.4 + w * 0.8 * t; pts.push([x, dd / 2 + b * (1 - (2 * t - 1) ** 2)]); }
    const foot = KIT.polyOutline(pts, pts.map((_, k) => (k === 0 || k === n || k === n + 1 || k === 2 * n + 1 ? 1.0 : 0)), { step: 2.2 });
    const A = blk(foot, { floors: F(3 + Math.floor(r() * 2)), windows: { style: win, sides: 'all' }, effects: fx() }, true);
    const up = scaleO(foot, 1.6, 1.6);
    const U = upper(up, A.top, F(1 + Math.floor(r() * 2)));
    court(scaleO(foot, 2.8, 2.8), U.top);
    details([{ type: 'skylight', x: -w * 0.18, z: -dd * 0.1, w: 1.4, d: 0.6 }, { type: 'skylight', x: w * 0.18, z: -dd * 0.1, w: 1.4, d: 0.6 }, { type: 'ac', x: w * 0.36, z: dd * 0.3 }, { type: 'ac', x: -w * 0.36, z: dd * 0.3 }], A.top);
  } else if (kind === 'stadium') {
    // stadium hall with a glazed drum rising from the roof
    const foot = KIT.stadiumOutline(w, Math.min(d, w * 0.75), ST);
    const A = blk(foot, { floors: F(2 + Math.floor(r() * 2)), windows: { style: 'ribbon', sides: 'all' }, effects: fx({ floorLines: '#FFD9A0' }) }, true);
    const dr = Math.min(w, d) * 0.26;
    const D = upper(circle(dr, -w * 0.12, 0), A.top, F(1 + Math.floor(r() * 2)), { windows: { style: 'dark', sides: 'all' }, effects: { roofEdge: '#7FE8FF', intensity: 0.9 } });
    court(circle(dr * 0.62, -w * 0.12, 0), D.top);
    const items = [];
    for (let k = 0; k < 3; k++) items.push({ type: 'skylight', x: w * 0.12 + k * 1.35, z: 0, w: 1.0, d: 0.55 });
    items.push({ type: 'ac', x: -w * 0.36, z: d * 0.18 }, { type: 'vent', x: w * 0.38, z: -d * 0.2 });
    details(items, A.top);
  } else if (kind === 'dshape') {
    // D-shaped block: straight back, elliptic front towards the core, inner roof court
    const cz0 = -d / 2 + d * 0.28, rz = d / 2 - cz0, pts = [[-w / 2, -d / 2], [w / 2, -d / 2]];
    for (let k = 0; k <= 10; k++) { const t = (k / 10) * Math.PI; pts.push([(w / 2) * Math.cos(t), cz0 + rz * Math.sin(t)]); }
    const foot = KIT.polyOutline(pts, pts.map((_, k) => (k < 2 ? 1.0 : 0)), { step: 2.2 });
    const A = blk(foot, { floors: F(3 + Math.floor(r() * 2)), windows: { style: win, sides: 'all' }, effects: fx() }, true);
    court(scaleO(foot, 1.7, 1.7), A.top);
    details([{ type: 'ac', x: -w * 0.3, z: -d * 0.38 }, { type: 'ac', x: w * 0.3, z: -d * 0.38 }, { type: 'vent', x: 0, z: -d * 0.4 }], A.top);
  } else if (kind === 'crescent') {
    // crescent wing hugging a forecourt, with a glazed rotunda in front of its middle
    const t = Math.max(3.6, d * 0.5), sag = (d - t) * 0.85, n = 10, back = [], front = [];
    for (let k = 0; k <= n; k++) {
      const x = -w / 2 + (w * k) / n, zm = -d / 2 + t / 2 + sag * ((2 * x) / w) ** 2;
      back.push([x, zm - t / 2]); front.push([x, zm + t / 2]);
    }
    const pts = [...back, ...front.reverse()];
    const foot = KIT.polyOutline(pts, pts.map((_, k) => (k === 0 || k === n || k === n + 1 || k === 2 * n + 1 ? 1.0 : 0)), { step: 2.2 });
    const A = blk(foot, { floors: F(3 + Math.floor(r() * 3)), windows: { style: 'ribbon', sides: 'all' }, effects: fx() }, true);
    const rr = Math.min(2.4, (d - t) * 0.55, w * 0.16);
    if (rr > 1.2) {
      const ro = circle(rr, 0, -d / 2 + t + rr * 0.75);
      const R = blk(ro, { floors: 1, floorH: 0.5, lobbyH: 1.3, lobby: { style: 'lobby', sides: 'all' }, roof: FAM_RIM_S, effects: { roofEdge: edge, intensity: 0.9 } }, true);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(rr * 0.7, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.glass);
      dome.position.set(0, R.top, -d / 2 + t + rr * 0.75); g.add(dome);
    }
    const items = [];
    for (let k = 1; k < 5; k++) { const x = -w / 2 + (w * k) / 5; items.push({ type: k % 2 ? 'skylight' : 'solar', x, z: -d / 2 + t / 2 + sag * ((2 * x) / w) ** 2, w: 1.3, d: 0.6 }); }
    details(items, A.top);
  } else if (kind === 'pentagon') {
    // chamfered pentagon with a drum on top
    const pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d * 0.12], [0, d / 2], [-w / 2, d * 0.12]];
    const foot = KIT.polyOutline(pts, [1.2, 1.2, 1.4, 1.6, 1.4], { step: 2.2 });
    const A = blk(foot, { floors: F(3 + Math.floor(r() * 2)), windows: { style: win, sides: 'all' }, effects: fx() }, true);
    const dr = Math.min(w, d) * 0.25;
    const D = upper(circle(dr, 0, -d * 0.08), A.top, F(2), { effects: { roofEdge: edge, floorLines: '#FFD9A0', intensity: 0.85 } });
    court(circle(dr * 0.6, 0, -d * 0.08), D.top);
    details([{ type: 'ac', x: -w * 0.34, z: -d * 0.34 }, { type: 'solar', x: w * 0.3, z: -d * 0.32 }, { type: 'vent', x: w * 0.3, z: d * 0.08 }], A.top);
  } else if (kind === 'multi') {
    // multi-wing complex: tall rounded core, two lower wings with green roofs
    const core = KIT.roundedRectOutline(w * 0.46, d, 1.0, ST);
    const C = blk(core, { floors: F(4 + Math.floor(r() * 2)), windows: { style: 'ribbon', sides: 'all' }, effects: fx({ floorLines: '#FFD9A0' }) }, true);
    for (const sx of [-1, 1]) {
      const wo = KIT.roundedRectOutline(w * 0.3, d * 0.72, 1.0, { cx: sx * (w / 2 - w * 0.15), cz: -d * 0.14, ...ST });
      const Wb = blk(wo, { floors: F(2 + Math.floor(r() * 2)), windows: { style: pk(['warm', 'dark']), sides: 'all' }, roof: FAM_RIM_S, effects: fx() }, true);
      court(KIT.roundedRectOutline(w * 0.3 - 1.2, d * 0.72 - 1.4, 0.4, { cx: sx * (w / 2 - w * 0.15), cz: -d * 0.14, ...ST }), Wb.top, true);
    }
    court(KIT.roundedRectOutline(w * 0.46 - 1.6, d * 0.5, 0.5, { cz: -d * 0.12, ...ST }), C.top);
    details([{ type: 'ac', x: 0, z: d * 0.3 }, { type: 'vent', x: w * 0.12, z: d * 0.32 }], C.top);
  } else if (kind === 'podium3') {
    // broad podium carrying three towers of different heights
    const P = blk(KIT.roundedRectOutline(w, d, 1.0, ST), { floors: 1, windows: { style: 'warm', sides: 'all' }, effects: fx({ floorLines: false }) }, true);
    const tw = Math.min(w * 0.24, d * 0.5), hs = [0, 2, 1].map((k) => F(4 + k + Math.floor(r() * 2)));
    [-1, 0, 1].forEach((k, i) => {
      const cx = k * w * 0.31, cz = -d * 0.12 + (k === 0 ? -d * 0.06 : 0);
      const T = upper(KIT.roundedRectOutline(tw, tw * 1.15, Math.min(1.2, tw * 0.36), { cx, cz, ...ST }), P.top, hs[i], { windows: { style: i === 1 ? 'ribbon' : pk(['ribbon', 'dark']), sides: 'all' }, roof: FAM_RIM, effects: { roofEdge: edge, floorLines: '#FFD9A0', intensity: 0.85 } });
      details([{ type: 'ac', x: cx, z: cz }, { type: 'vent', x: cx + tw * 0.2, z: cz - tw * 0.2 }], T.top);
    });
    court(KIT.roundedRectOutline(w * 0.8, d * 0.18, 0.3, { cz: d * 0.34, ...ST }), P.top, true);
  } else {
    // rounded tower on a broad podium with a green terrace
    const P = blk(KIT.roundedRectOutline(w, d, 1.0, ST), { floors: 1, windows: { style: 'warm', sides: 'all' }, effects: fx({ floorLines: false }) }, true);
    const tw = w * 0.5, td = d * 0.56, tz = -d * 0.14;
    const T = upper(KIT.roundedRectOutline(tw, td, Math.min(1.2, Math.min(tw, td) * 0.3), { cz: tz, ...ST }), P.top, F(4 + Math.floor(r() * 3)), { windows: { style: 'ribbon', sides: 'all' }, roof: FAM_RIM, effects: { roofEdge: edge, floorLines: '#FFD9A0', intensity: 0.85 } });
    const cr = upper(KIT.roundedRectOutline(tw * 0.55, td * 0.55, Math.min(0.8, Math.min(tw, td) * 0.2), { cz: tz, ...ST }), T.top, 1, { windows: { style: 'dark', sides: 'all' } });
    details([{ type: 'ac', x: 0, z: tz }, { type: 'vent', x: tw * 0.15, z: tz - td * 0.12 }], cr.top);
    court(KIT.roundedRectOutline(w * 0.78, d * 0.2, 0.3, { cz: d * 0.33, ...ST }), P.top, true);
    details([{ type: 'ac', x: -w * 0.38, z: tz }, { type: 'ac', x: w * 0.38, z: tz }], P.top);
  }
  return g;
}

// =================================================================================================
// LARGE DEVELOPMENTS (user 10-31)
// The zone between the r 84 ring (layout.OUTER_RING) and the last ring (layout.EDGE_RING, r 150) is laid
// out as big parcels between the roads (exits, the r 84 / r 150 rings and the secondary 'street' network
// from getRoadPaths, or its planned position while roads.js does not have it yet). Every parcel holds one
// large project facing the inner road: venture/tech campuses (massive curved slabs, wide rounded towers,
// terraced blocks, sky bridges, glass atrium, helipads, a landscaped plaza with water, parking deck) or
// gated residential societies (towers or mid-rise blocks, wall + entrance gate, internal lanes, pool,
// tennis / basketball courts, play area, jogging track, clubhouse, gardens, parking).
// All buildings are kit-built (KIT.makeBlock). Everything is merged per material (flat ground pieces use
// one canvas atlas), lamps / glow dots / cars / roof trees are instanced or single Points.

// 4 x 4 atlas of ground surfaces (512 px tiles)
const DEV_TILES = { plaza: 0, pond: 1, pool: 2, tennis: 3, basket: 4, track: 5, play: 6, lane: 7, park: 8, lawn: 9, heli: 10, garden: 11, walk: 12, deck: 13, court: 14 };
function devAtlas() {
  const S = 512, N = 4;
  const tex = canvasTex(S * N, S * N, (g) => {
    const tile = (i, fn) => {
      const cx = (i % N) * S, cy = Math.floor(i / N) * S;
      g.save(); g.beginPath(); g.rect(cx, cy, S, S); g.clip(); g.translate(cx, cy); fn(g, S); g.restore();
    };
    const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    const lawnBase = (s) => {
      g.fillStyle = '#1f3020'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? 'rgba(60,90,50,0.18)' : 'rgba(0,0,0,0.08)'; g.fillRect(0, (i * s) / 8, s, s / 8); }
      for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${40 + 40 * hash2(i, 7)},${70 + 50 * hash2(i, 8)},${36 + 20 * hash2(i, 9)},0.25)`; g.fillRect(hash2(i, 1) * s, hash2(i, 2) * s, 6, 6); }
    };
    tile(DEV_TILES.plaza, (g, s) => {
      g.fillStyle = '#3b3b52'; g.fillRect(0, 0, s, s);
      g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 2;
      for (let x = 0; x <= s; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, s); g.stroke(); g.beginPath(); g.moveTo(0, x); g.lineTo(s, x); g.stroke(); }
      g.fillStyle = 'rgba(160,165,200,0.12)';
      for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) if ((i + j) % 3 === 0) g.fillRect(i * 32 + 2, j * 32 + 2, 28, 28);
      const w = g.createRadialGradient(s / 2, s / 2, 20, s / 2, s / 2, s * 0.7); w.addColorStop(0, 'rgba(255,190,110,0.22)'); w.addColorStop(1, 'rgba(255,190,110,0)');
      g.fillStyle = w; g.fillRect(0, 0, s, s);
      g.strokeStyle = '#a9adc8'; g.lineWidth = 10; g.strokeRect(5, 5, s - 10, s - 10);
      g.strokeStyle = 'rgba(255,214,150,0.6)'; g.lineWidth = 3; g.strokeRect(22, 22, s - 44, s - 44);
    });
    tile(DEV_TILES.pond, (g, s) => {
      g.fillStyle = '#5d6078'; g.fillRect(0, 0, s, s);
      rr(18, 18, s - 36, s - 36, 60); const w = g.createLinearGradient(0, 0, s, s); w.addColorStop(0, '#0f4c86'); w.addColorStop(0.5, '#1d7fc4'); w.addColorStop(1, '#0d3f74'); g.fillStyle = w; g.fill();
      g.strokeStyle = '#8fe0ff'; g.lineWidth = 6; rr(22, 22, s - 44, s - 44, 56); g.stroke();
      g.strokeStyle = 'rgba(170,225,255,0.28)'; g.lineWidth = 3;
      for (const r of [40, 80, 120, 160]) { g.beginPath(); g.ellipse(s / 2, s / 2, r * 1.3, r * 0.8, 0, 0, Math.PI * 2); g.stroke(); }
      const c = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, 70); c.addColorStop(0, 'rgba(230,248,255,0.9)'); c.addColorStop(1, 'rgba(230,248,255,0)'); g.fillStyle = c; g.fillRect(0, 0, s, s);
    });
    tile(DEV_TILES.pool, (g, s) => {
      g.fillStyle = '#9b9db5'; g.fillRect(0, 0, s, s);
      g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 2; for (let x = 0; x <= s; x += 24) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, s); g.stroke(); g.beginPath(); g.moveTo(0, x); g.lineTo(s, x); g.stroke(); }
      const x0 = 70, y0 = 90, w0 = s - 140, h0 = s - 180;
      const w = g.createLinearGradient(0, y0, 0, y0 + h0); w.addColorStop(0, '#2ee0ff'); w.addColorStop(1, '#0fa7d6'); g.fillStyle = w; g.fillRect(x0, y0, w0, h0);
      g.fillStyle = 'rgba(10,90,140,0.7)'; for (let i = 1; i < 6; i++) g.fillRect(x0 + (i * w0) / 6 - 3, y0 + 20, 6, h0 - 40);
      g.strokeStyle = '#e8f6ff'; g.lineWidth = 8; g.strokeRect(x0, y0, w0, h0);
      g.fillStyle = '#e6e2d0'; for (let i = 0; i < 5; i++) g.fillRect(x0 + 20 + i * 70, 24, 40, 50); // loungers
    });
    tile(DEV_TILES.tennis, (g, s) => {
      g.fillStyle = '#2f5d48'; g.fillRect(0, 0, s, s);
      g.fillStyle = '#2d58a0'; g.fillRect(80, 40, s - 160, s - 80);
      g.strokeStyle = '#f2f4ff'; g.lineWidth = 5; g.strokeRect(80, 40, s - 160, s - 80); g.strokeRect(120, 40, s - 240, s - 80);
      g.beginPath(); g.moveTo(120, s / 2 - 110); g.lineTo(s - 120, s / 2 - 110); g.moveTo(120, s / 2 + 110); g.lineTo(s - 120, s / 2 + 110); g.moveTo(s / 2, s / 2 - 110); g.lineTo(s / 2, s / 2 + 110); g.stroke();
      g.strokeStyle = '#1a1a22'; g.lineWidth = 8; g.beginPath(); g.moveTo(60, s / 2); g.lineTo(s - 60, s / 2); g.stroke();
    });
    tile(DEV_TILES.basket, (g, s) => {
      g.fillStyle = '#3a3e58'; g.fillRect(0, 0, s, s);
      g.fillStyle = '#b5552d'; g.fillRect(70, 30, s - 140, s - 60);
      g.fillStyle = '#d57a3e'; g.fillRect(s / 2 - 60, 30, 120, 120); g.fillRect(s / 2 - 60, s - 150, 120, 120);
      g.strokeStyle = '#f5efe6'; g.lineWidth = 5; g.strokeRect(70, 30, s - 140, s - 60);
      g.beginPath(); g.moveTo(70, s / 2); g.lineTo(s - 70, s / 2); g.stroke();
      g.beginPath(); g.arc(s / 2, s / 2, 50, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(s / 2, 60, 150, 0.1, Math.PI - 0.1); g.stroke(); g.beginPath(); g.arc(s / 2, s - 60, 150, Math.PI + 0.1, -0.1); g.stroke();
    });
    tile(DEV_TILES.track, (g, s) => {
      lawnBase(s);
      g.lineWidth = 70; g.strokeStyle = '#a3432f'; rr(55, 55, s - 110, s - 110, 170); g.stroke();
      g.lineWidth = 3; g.strokeStyle = 'rgba(255,235,220,0.75)';
      for (const o of [22, 55, 88]) { rr(o, o, s - 2 * o, s - 2 * o, 200 - o * 0.9); g.stroke(); }
      g.fillStyle = '#2d4a2a'; rr(95, 95, s - 190, s - 190, 130); g.fill();
      for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? 'rgba(80,120,60,0.25)' : 'rgba(0,0,0,0.1)'; g.fillRect(95, 95 + (i * (s - 190)) / 6, s - 190, (s - 190) / 6); }
    });
    tile(DEV_TILES.play, (g, s) => {
      g.fillStyle = '#34385a'; g.fillRect(0, 0, s, s);
      g.fillStyle = '#c9a96e'; g.beginPath(); g.ellipse(s * 0.32, s * 0.36, 120, 90, 0.3, 0, Math.PI * 2); g.fill();
      const cols = ['#e85d75', '#f2b134', '#4fb3bf', '#7b6cf6', '#58c26a'];
      for (let i = 0; i < 9; i++) { g.fillStyle = cols[i % 5]; g.beginPath(); g.arc(80 + hash2(i, 3) * (s - 160), 80 + hash2(i, 4) * (s - 160), 30 + 40 * hash2(i, 5), 0, Math.PI * 2); g.fill(); }
      g.strokeStyle = '#f2b134'; g.lineWidth = 10; g.strokeRect(10, 10, s - 20, s - 20);
    });
    tile(DEV_TILES.lane, (g, s) => {
      g.fillStyle = '#161b29'; g.fillRect(0, 0, s, s);
      g.fillStyle = '#3c4560'; g.fillRect(0, 0, s, 40); g.fillRect(0, s - 40, s, 40);
      g.fillStyle = 'rgba(255,205,130,0.7)'; for (let x = 20; x < s; x += 128) g.fillRect(x, s / 2 - 5, 64, 10);
    });
    tile(DEV_TILES.park, (g, s) => {
      g.fillStyle = '#1a2030'; g.fillRect(0, 0, s, s);
      g.strokeStyle = '#2f3850'; g.lineWidth = 12; g.strokeRect(6, 6, s - 12, s - 12);
      g.strokeStyle = 'rgba(210,218,236,0.6)'; g.lineWidth = 3;
      for (const [a, b] of [[24, 200], [312, 488]]) for (let x = 24; x <= s - 24; x += 42) { g.beginPath(); g.moveTo(x, a); g.lineTo(x, b); g.stroke(); }
      g.fillStyle = 'rgba(255,190,90,0.14)'; g.fillRect(0, 236, s, 40);
    });
    tile(DEV_TILES.lawn, (g, s) => lawnBase(s));
    tile(DEV_TILES.heli, (g, s) => {
      g.fillStyle = '#262a40'; g.fillRect(0, 0, s, s);
      g.strokeStyle = '#e4e7f2'; g.lineWidth = 16; g.beginPath(); g.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = '#ffcf6a'; g.lineWidth = 6; g.beginPath(); g.arc(s / 2, s / 2, s * 0.46, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#f4f6ff'; g.fillRect(s * 0.36, s * 0.3, 34, s * 0.4); g.fillRect(s * 0.64 - 34, s * 0.3, 34, s * 0.4); g.fillRect(s * 0.36, s / 2 - 17, s * 0.28, 34);
    });
    tile(DEV_TILES.garden, (g, s) => {
      lawnBase(s);
      g.strokeStyle = '#7f7c92'; g.lineWidth = 22; g.beginPath(); g.moveTo(0, s * 0.7); g.bezierCurveTo(s * 0.3, s * 0.2, s * 0.6, s * 0.9, s, s * 0.3); g.stroke();
      g.beginPath(); g.arc(s / 2, s / 2, 70, 0, Math.PI * 2); g.stroke();
      const fl = ['#c85a8a', '#e0b04a', '#8a6ad0', '#d86a4a'];
      for (let i = 0; i < 14; i++) { g.fillStyle = fl[i % 4]; g.beginPath(); g.ellipse(hash2(i, 11) * s, hash2(i, 12) * s, 26, 14, hash2(i, 13) * 3, 0, Math.PI * 2); g.fill(); }
    });
    tile(DEV_TILES.walk, (g, s) => {
      g.fillStyle = '#80829c'; g.fillRect(0, 0, s, s);
      g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 2; for (let x = 0; x <= s; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, s); g.stroke(); g.beginPath(); g.moveTo(0, x); g.lineTo(s, x); g.stroke(); }
      g.fillStyle = 'rgba(255,214,150,0.55)'; g.fillRect(0, s / 2 - 5, s, 10); g.fillRect(s / 2 - 5, 0, 10, s);
      g.fillStyle = '#a7a9c2'; g.fillRect(0, 0, s, 14); g.fillRect(0, s - 14, s, 14); g.fillRect(0, 0, 14, s); g.fillRect(s - 14, 0, 14, s);
    });
    tile(DEV_TILES.deck, (g, s) => {
      g.fillStyle = '#2a2e42'; g.fillRect(0, 0, s, s);
      g.strokeStyle = 'rgba(220,226,240,0.55)'; g.lineWidth = 3;
      for (const [a, b] of [[20, 180], [332, 492]]) for (let x = 20; x <= s - 20; x += 40) { g.beginPath(); g.moveTo(x, a); g.lineTo(x, b); g.stroke(); }
      g.fillStyle = '#ffcf6a'; g.beginPath(); g.moveTo(s / 2 - 40, s / 2 + 20); g.lineTo(s / 2 + 40, s / 2 + 20); g.lineTo(s / 2, s / 2 - 30); g.fill();
      g.strokeStyle = '#4a5270'; g.lineWidth = 14; g.strokeRect(7, 7, s - 14, s - 14);
    });
    tile(DEV_TILES.court, (g, s) => {
      g.fillStyle = '#50536e'; g.fillRect(0, 0, s, s);
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2; for (let x = 0; x <= s; x += 48) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, s); g.stroke(); g.beginPath(); g.moveTo(0, x); g.lineTo(s, x); g.stroke(); }
      g.strokeStyle = '#a9adc8'; g.lineWidth = 8; g.strokeRect(4, 4, s - 8, s - 8);
    });
  });
  tex.anisotropy = 8;
  const e = 6 / (S * N);
  const uv = (i) => { const c = i % N, r = Math.floor(i / N); return [c / N + e, 1 - (r + 1) / N + e, (c + 1) / N - e, 1 - r / N - e]; };
  return { tex, uv };
}

function buildDevelopments(root, occ, shared, layout, roads) {
  const OR = shared.OR, R_MAX = shared.R_MAX;
  const rng = KIT.makeRng(7311), rg = (a, b) => a + (b - a) * rng(), pk = (a) => a[Math.floor(rng() * a.length)];
  const D2R = Math.PI / 180;
  const angOf = (x, z) => ((Math.atan2(-z, x) / D2R) + 360) % 360; // layout degrees (north = -Z = 90)
  const stats = { parcels: 0, buildings: 0, skipped: 0, kinds: {}, comps: [], skips: [] };

  // ---- the road frame of the zone: radial dividers + the secondary arc --------------------------------
  const div = [], arcs = [];
  for (const r of roads) {
    if (r.kind !== 'exit' && r.kind !== 'street') continue;
    const p0 = r.center.getPoint(0), p1 = r.center.getPoint(1), pm = r.center.getPoint(0.5);
    const r0 = Math.hypot(p0.x, p0.z), r1 = Math.hypot(p1.x, p1.z), rm = Math.hypot(pm.x, pm.z);
    const a0 = angOf(p0.x, p0.z), a1 = angOf(p1.x, p1.z), dA = Math.abs(((a1 - a0 + 540) % 360) - 180);
    if (Math.abs(r1 - r0) > 10 && dA < 4) {
      const po = r1 > r0 ? p1 : p0;
      div.push({ deg: angOf(po.x, po.z), hw: r.width / 2, rIn: Math.min(r0, r1), rOut: Math.max(r0, r1), kind: r.kind });
    } else if (r.kind === 'street' && Math.abs(r1 - r0) < 3 && Math.abs(rm - r0) < 3 && rm > OR.radius + 15 && rm < R_MAX - 12) arcs.push({ r: rm, hw: r.width / 2 });
  }
  // planned secondary network (coordinator 10-31) while roads.js does not export it yet:
  // radial avenues midway between the exits and an arc around r 118
  if (!div.some((d) => d.kind === 'street')) {
    const ex = div.filter((d) => d.kind === 'exit').map((d) => d.deg).sort((a, b) => a - b);
    for (let i = 0; i < ex.length; i++) {
      const a = ex[i], b = ex[(i + 1) % ex.length] + (i === ex.length - 1 ? 360 : 0);
      div.push({ deg: ((a + b) / 2) % 360, hw: 1.15, rIn: OR.radius, rOut: R_MAX + 2, kind: 'planned' });
    }
  }
  arcs.sort((a, b) => a.r - b.r);
  const arc = arcs.length ? arcs[Math.floor(arcs.length / 2)] : { r: 118.5, hw: 1.2 };
  const CLR = 1.7;
  const bands = [
    [OR.radius + OR.width / 2 + CLR, arc.r - arc.hw - CLR],
    [arc.r + arc.hw + CLR, R_MAX - 1.2],
  ];

  // ---- parcels ---------------------------------------------------------------------------------------
  const parcels = [];
  bands.forEach(([rIn, rOut], bi) => {
    const mid = (rIn + rOut) / 2;
    const ds = div.filter((d) => d.rIn < mid && d.rOut > mid).sort((a, b) => a.deg - b.deg);
    for (let i = 0; i < ds.length; i++) {
      const A = ds[i], B = ds[(i + 1) % ds.length];
      const a0 = A.deg + Math.asin(Math.min(1, (A.hw + CLR) / rIn)) / D2R;
      let a1 = B.deg - Math.asin(Math.min(1, (B.hw + CLR) / rIn)) / D2R;
      if (a1 <= a0) a1 += 360;
      const half = (a1 - a0) / 2, am = a0 + half;
      const W = 2 * rIn * Math.tan(Math.min(half, 40) * D2R);
      const rBack = Math.sqrt(Math.max(0, rOut * rOut - (W / 2) ** 2));
      const D = rBack - rIn;
      if (W < 14 || D < 12) continue;
      const rc = (rIn + rBack) / 2, a = am * D2R;
      // dead-end access lanes (radial streets that stop inside this band) entering the parcel
      let lane = null;
      for (const l of div) {
        if (l.kind !== 'street' || (l.rIn < mid && l.rOut > mid) || l.rOut < rIn || l.rIn > rOut) continue;
        const dl = ((l.deg - am + 540) % 360) - 180;
        if (Math.abs(dl) > half) continue;
        const za = rc - Math.min(l.rOut, rOut + 3), zb = rc - Math.max(l.rIn, rIn - 3);
        lane = { lx: -rc * Math.sin(dl * D2R), z0: Math.max(-D / 2, za), z1: Math.min(D / 2, zb), hw: l.hw, back: za <= -D / 2 + 1 };
      }
      parcels.push({ band: bi, deg: am % 360, W, D, lane, C: { x: Math.cos(a) * rc, z: -Math.sin(a) * rc }, th: Math.atan2(-Math.cos(a), Math.sin(a)) });
    }
  });
  parcels.sort((p, q) => p.deg - q.deg);

  // ---- shared output collections -----------------------------------------------------------------------
  const devRoot = new THREE.Group(); devRoot.name = 'developments';
  const atlas = devAtlas();
  const flatMat = new THREE.MeshBasicMaterial({ map: atlas.tex, color: '#a9aec4', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const lamps = [], cars = [], roofTrees = [], devTrees = [], footprints = shared.footprints;
  const glow = new Map(); // colour -> [[x,y,z]]
  const addGlow = (col, p) => { if (!glow.has(col)) glow.set(col, []); glow.get(col).push(p); };
  let bIdx = 0;

  // ---- one deliberate composition per parcel; neighbours (same band, and the parcel radially next to
  //      it) never share one ------------------------------------------------------------------------
  const COMPS = ['landmark', 'satellites', 'twins', 'cluster6', 'duoStack', 'trio', 'mega', 'podium3', 'crescentPav', 'staggered', 'campusL'];
  const LANE_COMPS = ['uCourt', 'twinsLane', 'flank5'];
  const MINW = { cluster6: 30, podium3: 26, satellites: 28, staggered: 26, twins: 20, trio: 24, mega: 26, campusL: 24, landmark: 0, duoStack: 0, crescentPav: 0, uCourt: 0, twinsLane: 0, flank5: 0 };
  const angD = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  const byBand = [[], []]; parcels.forEach((p) => byBand[p.band].push(p));
  byBand.forEach((list, bi) => {
    let k = bi * 4;
    list.forEach((p, i) => {
      const prev = i ? list[i - 1].comp : null, first = list[0].comp, last = i === list.length - 1;
      let inner = null;
      if (bi === 1 && byBand[0].length) inner = byBand[0].reduce((best, q) => (angD(q.deg, p.deg) < angD(best.deg, p.deg) ? q : best)).comp;
      const menu = p.lane ? LANE_COMPS : COMPS;
      for (let t = 0; t < menu.length; t++) {
        const c = menu[(k + t) % menu.length];
        if (MINW[c] > p.W || c === prev || c === inner || (last && c === first)) continue;
        p.comp = c; k += t + 1; break;
      }
      p.comp ||= 'landmark';
    });
  });

  const chunks = [0, 1, 2, 3].map((q) => { const c = new THREE.Group(); c.name = 'developments-' + q; devRoot.add(c); return c; });
  const fitsW = (x, z, w, d, rot, clear, rclear = 0.6) => {
    const c = Math.cos(rot), s = Math.sin(rot), nx = Math.max(2, Math.ceil(w / 1.1)), nz = Math.max(2, Math.ceil(d / 1.1));
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
      const lx = -w / 2 + (w * i) / nx, lz = -d / 2 + (d * j) / nz;
      if (occ.blocked(x + lx * c - lz * s, z + lx * s + lz * c, clear, Math.min(clear, rclear))) return false;
    }
    return true;
  };
  parcels.forEach((P, pi) => {
    const { W, D, C, th } = P;
    const chunk = chunks[Math.floor(((P.deg + 45) % 360) / 90)];
    const g = new THREE.Group(); g.position.set(C.x, 0, C.z); g.rotation.y = th; chunk.add(g);
    const c = Math.cos(th), s = Math.sin(th);
    const toW = (lx, lz) => [C.x + lx * c + lz * s, C.z - lx * s + lz * c];
    const flat = (tile, cx, cz, w, d, y = 0.03) => {
      const [x, z] = toW(cx, cz);
      if (!fitsW(x, z, w, d, -th, 0.3)) return;
      const q = new THREE.PlaneGeometry(w, d); q.rotateX(-Math.PI / 2);
      const [u0, v0, u1, v1] = atlas.uv(tile), uv = q.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0));
      q.translate(cx, y, cz);
      g.add(new THREE.Mesh(q, flatMat));
      occ.addRect(x, z, w, d, -th, 0.1);
    };
    const lampAt = (lx, lz) => { const [x, z] = toW(lx, lz); if (occ.roadDist(x, z) > 0.6 && !occ.blocked(x, z, 0.2)) lamps.push([x, z]); };
    const treeAt = (lx, lz, sc = 1) => { const [x, z] = toW(lx, lz); devTrees.push({ x, z, s: sc }); };
    // a building squared to the city: centred on its parcel spot, its front facing the core exactly
    const put = (lx0, lz0, w, d, kind, o = {}) => {
      // try the planned spot first, then shrink a little and pull toward the parcel centre
      let x, z, rot, ww, dd, lx, lz, ok = false;
      for (const k of [1, 0.92, 0.84, 0.76]) {
        for (const pull of [0, 1.2, 2.4]) {
          lx = lx0 - Math.sign(lx0) * Math.min(Math.abs(lx0), pull); lz = lz0 - Math.sign(lz0) * Math.min(Math.abs(lz0), pull * 0.6);
          [x, z] = toW(lx, lz); rot = Math.atan2(x, -z); ww = w * k; dd = d * k;
          if (ww >= 5.5 && fitsW(x, z, ww, dd, rot, 1.3)) { ok = true; break; }
        }
        if (ok) break;
      }
      {
        if (!ok) {
          // why: the first blocked sample of the planned footprint (debug aid in userData)
          const [x0, z0] = toW(lx0, lz0), r0 = Math.atan2(x0, -z0), c0 = Math.cos(r0), s0 = Math.sin(r0);
          let why = '?';
          for (let i = 0; i <= 8 && why === '?'; i++) for (let j = 0; j <= 8; j++) {
            const qx = -w / 2 + (w * i) / 8, qz = -d / 2 + (d * j) / 8, px = x0 + qx * c0 - qz * s0, pz = z0 + qx * s0 + qz * c0;
            if (!occ.blocked(px, pz, 1.3, 0.6)) continue;
            why = Math.hypot(px, pz) > occ.rMax - 0.65 ? `rmax(${qx.toFixed(1)},${qz.toFixed(1)})` : occ.roadDist(px, pz) < 1.3 ? `road(${qx.toFixed(1)},${qz.toFixed(1)})` : `occ(${qx.toFixed(1)},${qz.toFixed(1)})`; break;
          }
          stats.skipped++; stats.skips.push(`${P.comp}@${P.deg.toFixed(0)}:${kind} ${w.toFixed(1)}x${d.toFixed(1)} at ${lx0.toFixed(1)},${lz0.toFixed(1)} W${W.toFixed(0)} D${D.toFixed(0)} ${why}`); return null;
        }
        occ.addRect(x, z, ww, dd, rot, 0.35);
        const bg = makeFamily(kind, ww, dd, o.seed ?? 900 + bIdx * 13, { maxFloors: o.max ?? 6, boost: o.boost ?? 0 });
        bg.position.set(x, 0, z); bg.rotation.y = -rot; chunk.add(bg);
        footprints.push({ x, z, rot, w: ww, d: dd, name: `${P.comp}-${pi}-${kind}` });
        stats.buildings++; bIdx++; stats.kinds[kind] = (stats.kinds[kind] || 0) + 1;
        const cc = Math.cos(rot), ss = Math.sin(rot);
        for (const sx of [-1, 1]) { const ax = sx * (ww / 2 + 0.7), az = dd / 2 + 0.7; const px = x + ax * cc - az * ss, pz = z + ax * ss + az * cc; if (occ.roadDist(px, pz) > 0.6) lamps.push([px, pz]); }
        return { lx, lz, w: ww, d: dd };
      }
    };
    const pick4 = (arr, k) => arr[(pi + k) % arr.length];
    const comp = P.comp, L = P.lane;
    // lane parcels: the lane half (both sides of the lane) and the solid half beyond the lane's end
    const laneSide = L ? (L.back ? [-D / 2, L.z1 + 1.6] : [L.z0 - 1.6, D / 2]) : null;
    const solid = L ? (L.back ? [L.z1 + 1.6, D / 2] : [-D / 2, L.z0 - 1.6]) : null;
    const wingW = L ? W / 2 - (L.hw + 1.6) - 0.6 : 0, wingX = L ? L.hw + 1.6 + wingW / 2 : 0;
    const mid = (r) => (r[0] + r[1]) / 2, len = (r) => r[1] - r[0];
    if (comp === 'uCourt') {
      // U around the lane's end: two wings along the lane, one broad crescent closing it
      for (const sx of [-1, 1]) put(L.lx + sx * wingX, mid(laneSide), wingW, len(laneSide) - 1.2, sx < 0 ? 'wedge' : 'multi', { boost: 1, max: 6 });
      put(0, mid(solid), W - 1.6, len(solid) - 1.2, 'crescent', { boost: 1, max: 7 });
    } else if (comp === 'twinsLane') {
      // matched towers flanking the lane like a gateway, a long low hall across the far half
      const seed = 5100 + pi, tw = Math.min(13, wingW), td = Math.min(13, len(laneSide) - 1.2);
      for (const sx of [-1, 1]) put(L.lx + sx * wingX, mid(laneSide), tw, td, 'podium', { seed, boost: 3, max: 10 });
      put(0, mid(solid), W * 0.82, Math.min(10, len(solid) - 1.2), 'stadium', { max: 2 });
    } else if (comp === 'flank5') {
      // one huge block beyond the lane's end, two small pavilions on each side of the lane
      put(0, mid(solid), W - 1.6, len(solid) - 1.2, pick4(['multi', 'dshape'], 0), { boost: 2, max: 8 });
      const pd = (len(laneSide) - 1.6 - 2.0) / 2;
      for (const sx of [-1, 1]) for (const k of [0, 1]) put(L.lx + sx * wingX, laneSide[0] + 1.0 + pd / 2 + k * (pd + 2.0), wingW - 0.6, pd, k ? 'pentagon' : 'stadium', { max: 3 });
    } else if (comp === 'duoStack') {
      // a tall tower on a podium behind, a low glazed hall in front of it
      put(0, -D / 2 + 0.6 + D * 0.27, W - 2, D * 0.54, 'podium', { boost: 3, max: 10 });
      put(0, D / 2 - 0.6 - D * 0.15, W * 0.8, D * 0.3, 'stadium', { max: 2 });
    } else if (comp === 'crescentPav') {
      // a crescent across the back, one low pentagon pavilion off-centre in front
      put(0, -D / 2 + 0.6 + D * 0.3, W - 1.6, D * 0.6, 'crescent', { boost: 2, max: 8 });
      put(-W * 0.22, D / 2 - 0.6 - D * 0.14, W * 0.42, D * 0.28, 'pentagon', { max: 2 });
      treeAt(W * 0.22, D * 0.3, 1.2); treeAt(W * 0.3, D * 0.36, 1.0);
    } else if (comp === 'landmark') {
      // one huge landmark on the whole parcel
      put(0, -0.4, Math.min(W - 1.5, 38), D - 2.6, pick4(['crescent', 'wedge', 'multi', 'dshape'], 0), { boost: 1, max: 7 });
      flat(DEV_TILES.plaza, 0, D / 2 - 0.9, Math.min(W * 0.5, 16), 1.4);
    } else if (comp === 'twins') {
      // a pair of matched towers with a plaza between them
      const tw = Math.min(14, (W - 6) / 2), td = Math.min(14, D * 0.58), seed = 4400 + pi;
      for (const sx of [-1, 1]) put(sx * (tw / 2 + 2.0), -D * 0.12, tw, td, 'podium', { seed, boost: 3, max: 10 });
      flat(DEV_TILES.plaza, 0, D / 2 - 2.6, Math.min(W * 0.55, 18), 3.6);
      treeAt(0, -D * 0.12, 1.2); treeAt(0, -D * 0.12 + 2.2, 1.1);
    } else if (comp === 'trio') {
      // three buildings around a paved court: a broad D-block behind, two pavilions in front
      const bw = Math.min(W * 0.52, 22), bd = D * 0.42;
      put(0, -D / 2 + 0.6 + bd / 2, bw, bd, 'dshape', { boost: 1 });
      const ws = Math.min(11, W * 0.28), ds = D * 0.4;
      put(-(W / 2 - ws / 2 - 0.6), D / 2 - 0.6 - ds / 2, ws, ds, 'pentagon', { max: 4 });
      put(W / 2 - ws / 2 - 0.6, D / 2 - 0.6 - ds / 2, ws, ds, 'stadium', { max: 4 });
      flat(DEV_TILES.plaza, 0, D * 0.12, Math.max(4, W - 2 * ws - 4), D * 0.32);
    } else if (comp === 'satellites') {
      // one huge centrepiece and four small satellites at the corners
      const hw = W * 0.48, hd = D * 0.6;
      put(0, -D * 0.06, hw, hd, pick4(['multi', 'wedge', 'podium3'], 1), { boost: 1, max: 8 });
      const sw = Math.min(8.5, (W - hw) / 2 - 1.6), sd = Math.min(7.5, D * 0.3);
      ['stadium', 'pentagon', 'dshape', 'podium'].forEach((kind, k) => {
        const sx = k % 2 ? 1 : -1, sz = k < 2 ? 1 : -1;
        put(sx * (W / 2 - sw / 2 - 0.6), sz * (D / 2 - sd / 2 - 0.6), sw, sd, kind, { max: kind === 'podium' ? 6 : 3 });
      });
    } else if (comp === 'cluster6') {
      // six buildings stepping up from a low front row to a tall back row (terraced cluster)
      const dF = D * 0.36, dB = D * 0.46, gap = 2.2;
      const fw = (W - 1.2 - 2 * gap) / 3, kindsF = ['stadium', 'dshape', 'pentagon'], kindsB = ['podium', 'multi', 'podium'];
      const props = [0.8, 1.25, 0.95], sum = props.reduce((a, b) => a + b, 0), net = W - 1.2 - 2 * gap;
      let x = -(W - 1.2) / 2;
      props.forEach((f, k) => { const w = (f / sum) * net; put(x + w / 2, -D / 2 + 0.6 + dB / 2, w, dB, kindsB[k], { boost: k === 1 ? 1 : 3, max: 9 }); x += w + gap; });
      for (let k = 0; k < 3; k++) put(-(W - 1.2) / 2 + fw / 2 + k * (fw + gap), D / 2 - 0.6 - dF / 2, fw * 0.86, dF, kindsF[k], { max: 2 });
    } else if (comp === 'mega') {
      // long curved megastructure, joined by a sky bridge to a tower in front of it
      const mw = W - 2, md = D * 0.5, mz = -D / 2 + 0.6 + md / 2;
      const Mg = put(0, mz, mw, md, 'crescent', { boost: 1, max: 7 });
      const tw = Math.min(10, W * 0.3), td = Math.min(10, D - md - 3.0), tx = W / 2 - tw / 2 - 1.0, tz = D / 2 - td / 2 - 0.6;
      const T = put(tx, tz, tw, td, 'podium', { boost: 3, max: 10 });
      if (Mg && T) {
        const t = Math.max(3.6, Mg.d * 0.5), sag = (Mg.d - t) * 0.85, front = mz - Mg.d / 2 + t + sag * ((2 * tx) / Mg.w) ** 2;
        const z0 = front - 0.4, z1 = tz - T.d * 0.28 + 0.3;
        if (z1 - z0 > 1) {
          const fm = famMats(), o = KIT.roundedRectOutline(1.6, z1 - z0, 0.2, { cx: tx, cz: (z0 + z1) / 2, step: 2 });
          const b = KIT.makeBlock(o, { tone: 'light', materials: { facade: fm.shell, trim: fm.rim, roof: fm.decks[1] }, y0: 1.3 + 1.15 * 3, floors: 1, floorH: 1.0, lobbyH: 0.05, lobby: false, windows: { style: 'ribbon', sides: 'all' }, roof: { thick: 0.18, overhang: 0.1, parapetH: 0.16, parapetW: 0.12 }, effects: { roofEdge: '#7FE8FF', intensity: 0.9 } });
          g.add(b.group);
        }
      }
      flat(DEV_TILES.plaza, -W * 0.18, D / 2 - 2.4, Math.min(W * 0.45, 16), 3.2);
    } else if (comp === 'podium3') {
      // one broad podium carrying three towers, two low pavilions at the front corners
      put(0, -D * 0.14, Math.min(W - 2, 34), D * 0.62, 'podium3', { max: 9, boost: 1 });
      const pw = Math.min(9, W * 0.26), pd = D * 0.24;
      put(-(W / 2 - pw / 2 - 0.8), D / 2 - pd / 2 - 0.6, pw, pd, 'stadium', { max: 2 });
      put(W / 2 - pw / 2 - 0.8, D / 2 - pd / 2 - 0.6, pw, pd, 'stadium', { max: 2 });
    } else if (comp === 'staggered') {
      // four buildings in a staggered checkerboard, strongly different heights
      put(-W * 0.26, -D * 0.2, W * 0.4, D * 0.5, 'wedge', { boost: 1 });
      put(W * 0.24, -D * 0.28, W * 0.36, D * 0.38, 'podium', { boost: 3, max: 10 });
      put(W * 0.28, D * 0.26, W * 0.3, D * 0.36, 'dshape', { max: 3 });
      put(-W * 0.3, D * 0.3, W * 0.26, D * 0.3, 'pentagon', { max: 3 });
    } else {
      // campusL: long hall across the back, a wing down one side, a drum pavilion in the court corner
      const bw = W * 0.6, bd = D * 0.36;
      put(-W * 0.18, -D / 2 + 0.6 + bd / 2, bw, bd, 'stadium', { boost: 1 });
      const ww = W * 0.3, wd = D * 0.72;
      put(W / 2 - ww / 2 - 0.6, D / 2 - 0.6 - wd / 2, ww, wd, pick4(['multi', 'wedge'], 2), { boost: 2, max: 8 });
      put(-W * 0.26, D * 0.26, Math.min(9, W * 0.3), D * 0.34, 'pentagon', { max: 3 });
      flat(DEV_TILES.plaza, -W * 0.02, D * 0.1, W * 0.22, D * 0.3);
    }
    // thin planting: a few trees along the parcel's sides and front
    for (let k = 0; k < 3; k++) treeAt(-W / 2 + 0.6, -D / 2 + 2 + (k * (D - 4)) / 2, rg(0.9, 1.15));
    for (let k = 0; k < 3; k++) treeAt(W / 2 - 0.6, -D / 2 + 2 + (k * (D - 4)) / 2, rg(0.9, 1.15));
    for (let x = -W / 2 + 2; x < W / 2 - 1; x += 4.5) { treeAt(x, D / 2 - 0.5, rg(0.85, 1.05)); lampAt(x + 2.2, D / 2 - 0.4); }
    stats.parcels++;
    stats.comps.push(`${P.band ? 'outer' : 'inner'}@${P.deg.toFixed(0)}:${comp}`);
  });

  // ---- merge everything per material ------------------------------------------------------------------
  for (const ch of [...devRoot.children]) root.add(mergeByMaterial(ch));
  if (lamps.length) root.add(KIT.makeLamps(lamps, { height: 0.95, size: 0.85, pool: 0.24 }));
  for (const [col, list] of glow) root.add(KIT.makeGlowPoints(list, col, col === '#F4F6FF' ? 0.9 : 0.7, 0.9));
  if (roofTrees.length) root.add(KIT.makeTrees(roofTrees, { colors: ['#3E6A32', '#4A7A3A', '#355E2E'], seed: 21 }));
  if (cars.length) {
    const n = cars.length, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), T = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(0.95, 0.3, 0.52), new THREE.MeshBasicMaterial({ color: '#ffffff' }), n);
    const cab = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.18, 0.44), new THREE.MeshBasicMaterial({ color: '#ffffff' }), n);
    const tones = ['#8e96aa', '#5d6680', '#7a3a44', '#34508a', '#a9afbf', '#2a3348', '#6e6a78', '#45506a'].map((h) => new THREE.Color(h));
    cars.forEach((cc, i) => {
      q.setFromAxisAngle(up, cc.rot);
      const col = tones[Math.floor(cc.col * tones.length)];
      body.setMatrixAt(i, m4.compose(T.set(cc.x, cc.y + 0.15, cc.z), q, one)); body.setColorAt(i, col);
      cab.setMatrixAt(i, m4.compose(T.set(cc.x, cc.y + 0.38, cc.z), q, one)); cab.setColorAt(i, col.clone().multiplyScalar(0.45).add(new THREE.Color(0.05, 0.08, 0.14)));
    });
    root.add(body, cab);
  }
  root.userData.devTrees = devTrees;
  root.userData.developments = { ...stats, arc: arc.r, dividers: div.length, lamps: lamps.length, cars: cars.length };
}

// =================================================================================================
// VEGETATION
function buildVegetation(root, occ, onScreen, RINGS, R2, roads, shared, onTick, lawn) {
  const trees = []; // {x,z,s,rot,variant,uplit,r}
  const lamps = [];
  const hash = new PointHash(3);
  const isLawn = (x, z) => (lawn ? lawn(x, z) : true);
  const tryTree = (x, z, s, { needLawn = true, uplitP = null } = {}) => {
    const rad = 0.7 * s;
    if (needLawn && !isLawn(x, z)) return false;
    if (occ.blocked(x, z, rad * 0.85 + 0.2)) return false;
    if (hash.near(x, z, rad * 0.78)) return false;
    const r = Math.hypot(x, z);
    const vr = rnd();
    const variant = vr < 0.42 ? 0 : vr < 0.68 ? 1 : vr < 0.85 ? 2 : 3;
    trees.push({ x, z, s, rot: rnd() * Math.PI * 2, variant, uplit: rnd() < (uplitP ?? (r < R2 + 2 ? 0.58 : 0.48)), r });
    hash.add(x, z, rad * 0.78);
    return true;
  };

  // trees planned by the large developments (wall rows, plaza edges, gardens) go in first
  for (const t of root.userData.devTrees || []) tryTree(t.x, t.z, t.s, { needLawn: false });

  // The reference vegetation is clumps of individual dark leafy trees with clear gaps between them
  // (about 5% green pixels), not a continuous canopy. Clump noise gates every placement.
  const clump = (x, z) => noise2(x * 0.16 + 3.1, z * 0.16 - 7.7) * 0.7 + noise2(x * 0.45, z * 0.45 + 11) * 0.3;

  // 1) loose rows along the roads: every ~3.4 units, only where a clump is (plus a few strays)
  const P = new THREE.Vector3(), T = new THREE.Vector3();
  for (const road of roads) {
    if (road.kind === 'roundabout' || road.kind === 'access') continue;
    const off = road.width / 2 + 1.2;
    const n = Math.max(2, Math.floor(road.length / 2.4));
    for (let i = 0; i <= n; i++) {
      const u = Math.min(1, (i + 0.5) / (n + 1));
      road.center.getPointAt(u, P);
      road.center.getTangentAt(u, T);
      const nl = Math.hypot(T.x, T.z) || 1, nx = -T.z / nl, nz = T.x / nl;
      for (const sd of [1, -1]) {
        const o = off + range(0, 0.4);
        const x = P.x + nx * o * sd, z = P.z + nz * o * sd;
        if (clump(x, z) < 0.4 && rnd() > 0.15) continue;
        if (Math.hypot(x, z) > 86 && clump(x, z) < 0.62) continue; // outer zone: road rows only in clumps
        tryTree(x, z, range(0.9, 1.2), { needLawn: false });
      }
    }
  }

  // 2) clumps on the lawns and in the outer city, with open gaps between them
  const STEP = 1.3;
  const RT = occ.rMax || 147;
  for (let gx = -RT; gx <= RT; gx += STEP) {
    for (let gz = -RT; gz <= RT; gz += STEP) {
      if (gx * gx + gz * gz > RT * RT) continue;
      const x = gx + range(-0.6, 0.6), z = gz + range(-0.6, 0.6);
      const r = Math.hypot(x, z);
      const n = clump(x, z);
      const green = isLawn(x, z);
      let density;
      if (r < RINGS.ring0 + 2) density = 0;
      else if (r < R2 + 2) density = green ? 0.12 + THREE.MathUtils.smoothstep(n, 0.36, 0.66) * 0.75 : THREE.MathUtils.smoothstep(n, 0.55, 0.8) * 0.3;
      else density = green ? 0.1 + THREE.MathUtils.smoothstep(n, 0.4, 0.7) * 0.6 : THREE.MathUtils.smoothstep(n, 0.48, 0.75) * 0.42;
      if (r > 86) density *= 0.2; // the development parcels bring their own planting
      if (rnd() < 0.006 && !occ.blocked(x, z, 0.4) && !hash.near(x, z, 0.5)) { lamps.push({ x, z }); hash.add(x, z, 0.3); continue; }
      if (rnd() > density) continue;
      const s = range(0.85, 1.3) * (r < R2 ? 1 : 1.05);
      tryTree(x, z, s, { needLawn: false });
    }
  }

  // 3) park lamps: along lawn edges next to roads, between trees
  for (let i = 0; i < 16000 && lamps.length < 420; i++) {
    const x = range(-RT, RT), z = range(-RT, RT);
    if (Math.hypot(x, z) > RT) continue;
    const d = occ.roadDist(x, z);
    if (d < 0.55 || d > 1.3) continue;
    if (occ.blocked(x, z, 0.3) || hash.near(x, z, 0.45)) continue;
    lamps.push({ x, z }); hash.add(x, z, 0.4);
  }
  for (const p of root.userData.streetLamps || []) if (!occ.blocked(p.x, p.z, 0.15)) lamps.push(p);

  // ---------------------------------------------------------------- tree meshes
  const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  // deep leafy greens with a slight teal cast; the warm lit crown tops come from the baked vertex light
  // dark leafy olive greens (reference tree pixels: shade ~ (22,37,19), lit ~ (40,62,27), edges ~ (55,95,44))
  // olive, low-saturation: most leaf pixels stay below the 'clearly green' threshold like the reference
  const tones = ['#4e6236', '#475c34', '#56693c', '#3e5236', '#5a6b3a', '#4a5e38', '#42583e', '#5e6c3a', '#44593f', '#526634', '#3a4c34']
    .map((c) => new THREE.Color(c));
  const treeMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const groups = {};
  for (const t of trees) { const k = `${t.variant}-${t.uplit ? 1 : 0}`; (groups[k] ||= []).push(t); }
  for (const [key, list] of Object.entries(groups)) {
    const [variant, uplit] = key.split('-').map(Number);
    const geo = treeGeometry(variant, !!uplit);
    const mesh = new THREE.InstancedMesh(geo, treeMat, list.length);
    const col = new THREE.Color();
    list.forEach((t, i) => {
      q.setFromAxisAngle(up, t.rot);
      const sy = t.s * range(0.9, 1.12);
      matrix.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(t.s, sy, t.s));
      mesh.setMatrixAt(i, matrix);
      const fade = t.r > R2 + 6 ? THREE.MathUtils.clamp(1.05 - (t.r - R2) / 80, 0.5, 1) : 1;
      col.copy(pick(tones)).multiplyScalar(0.62 * fade * range(0.8, 1.08));
      mesh.setColorAt(i, col);
    });
    mesh.frustumCulled = false;
    root.add(mesh);
  }

  // ---------------------------------------------------------------- uplight + lamp glow pools
  const pools = trees.filter((t) => t.uplit);
  const glowMat = new THREE.MeshBasicMaterial({ map: shared.glow, color: '#ffb257', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const glowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const glows = new THREE.InstancedMesh(glowGeo, glowMat, Math.max(1, pools.length + lamps.length));
  let gi = 0;
  const gc = new THREE.Color();
  for (const t of pools) {
    matrix.compose(new THREE.Vector3(t.x, 0.045, t.z), q.identity(), new THREE.Vector3(2.6 * t.s, 1, 2.6 * t.s));
    glows.setMatrixAt(gi, matrix); glows.setColorAt(gi++, gc.setRGB(0.75, 0.75, 0.75));
  }
  for (const l of lamps) {
    matrix.compose(new THREE.Vector3(l.x, 0.045, l.z), q.identity(), new THREE.Vector3(1.9, 1, 1.9));
    glows.setMatrixAt(gi, matrix); glows.setColorAt(gi++, gc.setRGB(0.7, 0.7, 0.7));
  }
  glows.count = gi;
  glows.renderOrder = 2;
  glows.frustumCulled = false;
  root.add(glows);

  // uplight fixtures: tiny bright dots at the trunk base
  const fixGeo = new THREE.SphereGeometry(0.08, 5, 3);
  const fix = new THREE.InstancedMesh(fixGeo, new THREE.MeshBasicMaterial({ color: '#ffd07a' }), Math.max(1, pools.length));
  pools.forEach((t, i) => fix.setMatrixAt(i, matrix.makeTranslation(t.x + 0.3 * t.s, 0.08, t.z + 0.3 * t.s)));
  fix.count = pools.length;
  root.add(fix);

  // lamp posts: thin dark post + warm bulb (bulbs bloom)
  const post = new THREE.CylinderGeometry(0.03, 0.045, 0.95, 4); post.translate(0, 0.475, 0);
  const posts = new THREE.InstancedMesh(post, new THREE.MeshBasicMaterial({ color: '#3a4256' }), Math.max(1, lamps.length));
  const bulbGeo = new THREE.SphereGeometry(0.11, 6, 4);
  const bulbs = new THREE.InstancedMesh(bulbGeo, new THREE.MeshBasicMaterial({ color: '#ffffff' }), Math.max(1, lamps.length));
  const warm = new THREE.Color('#ffc66e').multiplyScalar(1.6);
  lamps.forEach((l, i) => {
    posts.setMatrixAt(i, matrix.makeTranslation(l.x, 0, l.z));
    bulbs.setMatrixAt(i, matrix.makeTranslation(l.x, 0.98, l.z));
    bulbs.setColorAt(i, warm);
  });
  posts.count = bulbs.count = lamps.length;
  root.add(posts, bulbs);
  onTick((t) => { glowMat.opacity = 0.5 + Math.sin(t * 0.8) * 0.04; });

  root.userData.stats = { trees: trees.length, lamps: lamps.length, uplit: pools.length, lawnSampler: !!lawn };
}
