/*
 * Ground: dark night city floor painted once into canvas textures.
 *  - outer texture (whole WORLD_SIZE): dark navy floor, dim outer city blocks, fog fade.
 *  - city texture (radius ~ring2 + margin, higher resolution): lavender-grey sidewalks along every
 *    road, dark varied park land between the roads (textured grass, hedges, curved footpaths with
 *    warm walkway lights, small plazas, paved building forecourts, asphalt service lanes), the
 *    tiled core plaza and warm lamp light pools.
 * Beyond WORLD_SIZE a large underlay plane carries the floor into the fog.
 */
import * as THREE from 'three';
import { getRoadPaths, getLampPositions } from './roads.js';

const TEX = 4096; // city-detail ground layer; 4096 keeps it sharp when zoomed in (was 2048)

// small deterministic RNG so the painting is identical on every load
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const COL = {
  floor: '#0a0e1b',
  pave: '#2e2b3b',       // sidewalk / plaza paving (neutral violet grey in the reference)
  paveLit: '#3a384e',
  curb: 'rgba(170,160,210,0.35)',
  lawn: '#28321d',       // dark low-saturation olive night grass (ACES renders it ~ (22,34,14), like the reference)
  lawnLight: 'rgba(64,80,44,0.2)',
  lawnDark: 'rgba(8,10,6,0.35)',
  hedge: '#0b150c',
  path: '#3a384c',
  lane: '#14172a',
};

export default function build(ctx) {
  const { scene, layout, renderer } = ctx;
  const { RINGS, WORLD_SIZE, BUILDINGS } = layout;
  const roads = getRoadPaths(layout);
  const lamps = getLampPositions(layout);
  const R2 = RINGS.ring2;
  // clean paved apron under the elevated core platform (no road painting there)
  const PLAT_R = layout.HAS_RING0_ROAD === false && layout.CORE_PLATFORM ? layout.CORE_PLATFORM.radius : 0;

  // ------------------------------------------------------------------ outer floor
  const outer = paint(WORLD_SIZE, 2048, (g, P) => {
    const { k, C, X, Z, rand } = P;
    const S = WORLD_SIZE;
    g.fillStyle = COL.floor;
    g.fillRect(0, 0, P.N, P.N);
    const disc = g.createRadialGradient(C, C, 0, C, C, (S / 2) * k);
    disc.addColorStop(0, '#2a293d');
    disc.addColorStop(0.55, '#242336');
    disc.addColorStop(0.75, '#171a2b');
    disc.addColorStop(1, '#090d1a');
    g.fillStyle = disc;
    g.fillRect(0, 0, P.N, P.N);
    grain(g, rand, P.N, 20000);

    // dim outer city blocks (outside ring2): lots, parking, small parks
    const cell = 12;
    for (let gx = -S / 2; gx < S / 2; gx += cell) {
      for (let gz = -S / 2; gz < S / 2; gz += cell) {
        const cx = gx + cell / 2, cz = gz + cell / 2;
        if (Math.hypot(cx, cz) < R2 + 6) continue;
        const pad = 0.9 + rand() * 0.4;
        const x0 = X(gx + pad), z0 = Z(gz + pad), w = (cell - pad * 2) * k;
        const kind = rand();
        roundRect(g, x0, z0, w, w, 0.8 * k);
        g.fillStyle = COL.pave;
        g.fill();
        g.strokeStyle = 'rgba(150,140,190,0.18)';
        g.lineWidth = 0.15 * k;
        g.stroke();
        if (kind < 0.45) {
          roundRect(g, x0 + 0.6 * k, z0 + 0.6 * k, w - 1.2 * k, w - 1.2 * k, 0.7 * k);
          g.fillStyle = COL.lawn;
          g.fill();
          blotches(g, rand, x0 + 0.6 * k, z0 + 0.6 * k, w - 1.2 * k, w - 1.2 * k, 30);
          // diagonal footpath
          g.strokeStyle = COL.path;
          g.lineWidth = 0.35 * k;
          g.beginPath(); g.moveTo(x0 + 0.6 * k, z0 + w * 0.3); g.quadraticCurveTo(x0 + w * 0.5, z0 + w * 0.5, x0 + w * 0.7, z0 + w - 0.6 * k); g.stroke();
        } else if (kind < 0.7) {
          g.fillStyle = '#1b1c2b';
          g.fillRect(x0 + 0.6 * k, z0 + 0.6 * k, w - 1.2 * k, w - 1.2 * k);
          g.strokeStyle = 'rgba(160,165,200,0.10)';
          g.lineWidth = 1;
          for (let s = 0.9 * k; s < w - 0.6 * k; s += 0.55 * k) {
            g.beginPath(); g.moveTo(x0 + s, z0 + 0.9 * k); g.lineTo(x0 + s, z0 + w * 0.42); g.stroke();
            g.beginPath(); g.moveTo(x0 + s, z0 + w * 0.58); g.lineTo(x0 + s, z0 + w - 0.9 * k); g.stroke();
          }
        } else {
          g.fillStyle = '#171927';
          g.fillRect(x0 + 1 * k, z0 + 1 * k, w - 2 * k, w - 2 * k);
          g.fillStyle = COL.lawn;
          g.fillRect(x0 + 0.4 * k, z0 + w - 1.0 * k, w - 0.8 * k, 0.6 * k);
        }
      }
    }
    // road beds for everything (outer texture shows exits / ring3 at low res)
    roadBeds(g, P, roads);
    lampPools(g, P, lamps, 0.22);
    // beyond the last ring road (layout.EDGE_RING): no streets, blocks or road lines, only dark
    // ground (user 10-31). Repaint the plain floor outside the ring's outer curb.
    if (layout.EDGE_RING) {
      const RE = layout.EDGE_RING.radius + layout.EDGE_RING.width / 2 + 0.6;
      g.save();
      g.beginPath();
      g.rect(0, 0, P.N, P.N);
      g.arc(C, C, RE * k, 0, Math.PI * 2, true);
      g.clip('evenodd');
      g.fillStyle = COL.floor;
      g.fillRect(0, 0, P.N, P.N);
      g.fillStyle = disc;
      g.fillRect(0, 0, P.N, P.N);
      grain(g, rand, P.N, 6000);
      g.restore();
    }
    // fade the far ground into the night/fog
    const fade = g.createRadialGradient(C, C, (S * 0.34) * k, C, C, (S / 2) * k);
    fade.addColorStop(0, 'rgba(9,13,26,0)');
    fade.addColorStop(1, 'rgba(9,13,26,1)');
    g.fillStyle = fade;
    g.fillRect(0, 0, P.N, P.N);
  });

  // ------------------------------------------------------------------ city detail
  const CITY = (R2 + 7) * 2;
  const city = paint(CITY, TEX, (g, P) => {
    const { k, C, X, Z, rand } = P;
    const A = (deg) => -deg * Math.PI / 180; // world deg -> canvas angle
    const pt = (r, deg) => [C + Math.cos(deg * Math.PI / 180) * r * k, C - Math.sin(deg * Math.PI / 180) * r * k];

    // paving everywhere, fading out at the texture edge (alpha) so it blends into the outer floor
    g.clearRect(0, 0, P.N, P.N);
    g.save();
    g.beginPath(); g.arc(C, C, (R2 + 6.6) * k, 0, Math.PI * 2); g.clip();
    g.fillStyle = COL.pave;
    g.fillRect(0, 0, P.N, P.N);
    grain(g, rand, P.N, 30000);

    // ---- sectors between ring-like roads, split by radial roads -> park land
    const ringsAll = roads.filter((r) => r.radius && r.cx === undefined && (r.kind === 'ring' || r.kind === 'side'))
      .map((r) => ({ r: r.radius, w: r.width }));
    const uniq = [];
    for (const r of ringsAll.sort((a, b) => a.r - b.r)) if (!uniq.some((u) => Math.abs(u.r - r.r) < 0.01)) uniq.push(r);
    uniq.push({ r: R2 + 7.5, w: 0 }); // band just outside ring2
    // no ring0 road: the park band starts at the elevated core platform edge
    if (layout.HAS_RING0_ROAD === false) uniq.unshift({ r: PLAT_R - 0.8, w: 0 });
    const radialInfo = roads.filter((r) => r.kind === 'spoke' || r.kind === 'link' || r.kind === 'exit').map((r) => {
      const a = r.center.getPoint(0), b = r.center.getPoint(1);
      return [Math.hypot(a.x, a.z), Math.hypot(b.x, b.z), r.deg, r.width];
    });
    const rbs = roads.filter((r) => r.kind === 'roundabout');
    const SW = 1.0; // sidewalk width

    for (let i = 0; i + 1 < uniq.length; i++) {
      const inner = uniq[i].r + uniq[i].w / 2 + SW;
      const outerR = uniq[i + 1].r - uniq[i + 1].w / 2 - SW;
      if (outerR - inner < 0.5) continue;
      const mid = (inner + outerR) / 2;
      const cuts = radialInfo.filter(([r0, r1]) => Math.min(r0, r1) < mid && Math.max(r0, r1) > mid)
        .map(([, , deg, w]) => ({ deg: ((deg % 360) + 360) % 360, w })).sort((a, b) => a.deg - b.deg);
      const segs = cuts.length ? cuts : [{ deg: 0, w: 0 }];
      const depth = outerR - inner;
      for (let j = 0; j < segs.length; j++) {
        const a = segs[j], b = j + 1 < segs.length ? segs[j + 1] : { deg: segs[0].deg + 360, w: segs[0].w };
        const pa = ((a.w / 2 + SW) / mid) * (180 / Math.PI);
        const pb = ((b.w / 2 + SW) / mid) * (180 / Math.PI);
        const d0 = cuts.length ? a.deg + pa : 0, d1 = cuts.length ? b.deg - pb : 360;
        if (d1 - d0 < 1) continue;
        const span = d1 - d0;
        g.save();
        sectorPath(g, C, k, inner, outerR, d0, d1, Math.min(0.9, depth * 0.3));
        g.clip();
        if (depth < 2.2) {
          // narrow verge: grass strip with a hedge line and a few lit bollards
          sectorPath(g, C, k, inner + 0.25, outerR - 0.25, d0, d1, 0.3);
          g.fillStyle = COL.lawn; g.fill();
          blotchesSector(g, rand, P, inner, outerR, d0, d1, 0.25);
          g.strokeStyle = COL.hedge; g.lineWidth = 0.35 * k;
          g.beginPath(); g.arc(C, C, mid * k, A(d1), A(d0)); g.stroke();
          g.restore();
          continue;
        }
        // grass base
        sectorPath(g, C, k, inner + 0.15, outerR - 0.15, d0, d1, Math.min(0.9, depth * 0.3));
        g.fillStyle = COL.lawn; g.fill();
        blotchesSector(g, rand, P, inner, outerR, d0, d1, 0.55);
        // mown stripes (very faint)
        g.strokeStyle = 'rgba(66,82,48,0.05)';
        g.lineWidth = 0.5 * k;
        for (let rr = inner + 0.5; rr < outerR; rr += 1.0) { g.beginPath(); g.arc(C, C, rr * k, A(d1), A(d0)); g.stroke(); }

        // hedge rows along the lawn border (dark clipped bushes, dashed)
        g.strokeStyle = COL.hedge;
        g.lineWidth = 0.5 * k;
        g.setLineDash([1.6 * k, 0.5 * k]);
        g.beginPath(); g.arc(C, C, (inner + 0.55) * k, A(d1 - 0.5), A(d0 + 0.5)); g.stroke();
        g.beginPath(); g.arc(C, C, (outerR - 0.55) * k, A(d1 - 0.5), A(d0 + 0.5)); g.stroke();
        g.setLineDash([]);

        // asphalt service lane (wide bands only): an inner arc that swings into the sector
        if (depth > 7) {
          const rl = inner + depth * 0.2;
          lane(g, P, () => { g.beginPath(); g.arc(C, C, rl * k, A(d1 - 2), A(d0 + 2)); }, 1.1);
          // parking bays along it
          g.strokeStyle = 'rgba(170,165,210,0.16)';
          g.lineWidth = 0.06 * k;
          const step = (0.6 / rl) * 180 / Math.PI;
          for (let d = d0 + 6; d < d1 - 6; d += step) {
            if (((d - d0) / span) > 0.3 && ((d - d0) / span) < 0.7) continue;
            const [x0, y0] = pt(rl + 0.55, d), [x1, y1] = pt(rl + 1.4, d);
            g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
          }
        }

        // paved building forecourts under any building slot in this sector
        for (const bd of BUILDINGS) {
          const dd = ((bd.deg - d0) % 360 + 360) % 360;
          if (dd > span || bd.r < inner - 1 || bd.r > outerR + 1) continue;
          const [bx, by] = pt(bd.r, bd.deg);
          const R = Math.min(bd.footprint * 0.72, depth * 0.48);
          const pg = g.createRadialGradient(bx, by, 0, bx, by, R * k);
          pg.addColorStop(0, COL.paveLit); pg.addColorStop(0.75, COL.pave); pg.addColorStop(1, COL.pave);
          g.fillStyle = pg;
          g.beginPath(); ellipseSector(g, C, k, bd.r, bd.deg, R * 1.15, R * 0.95); g.fill();
          g.strokeStyle = 'rgba(255,214,150,0.18)'; g.lineWidth = 0.1 * k; g.stroke();
          // tile grid
          g.save(); g.clip();
          g.strokeStyle = 'rgba(190,185,230,0.06)'; g.lineWidth = 1;
          for (let s = -R * 1.2; s < R * 1.2; s += 0.7) {
            g.beginPath(); g.moveTo(bx + s * k, by - R * 1.3 * k); g.lineTo(bx + s * k, by + R * 1.3 * k); g.stroke();
            g.beginPath(); g.moveTo(bx - R * 1.3 * k, by + s * k); g.lineTo(bx + R * 1.3 * k, by + s * k); g.stroke();
          }
          g.restore();
        }

        // curved footpaths with warm walkway lights + small plazas
        const nPaths = Math.max(1, Math.round(span / 20));
        for (let p = 0; p < nPaths; p++) {
          const da = d0 + span * (p + 0.15 + rand() * 0.2) / nPaths;
          const db = d0 + span * (p + 0.65 + rand() * 0.2) / nPaths;
          const ra = inner + depth * (0.25 + rand() * 0.5), rb = inner + depth * (0.25 + rand() * 0.5);
          const [x0, y0] = pt(inner + 0.2, da), [x3, y3] = pt(outerR - 0.2, db);
          const [x1, y1] = pt(ra, da + (db - da) * 0.2), [x2, y2] = pt(rb, db - (db - da) * 0.2);
          g.strokeStyle = COL.path; g.lineWidth = 0.42 * k; g.lineCap = 'round';
          g.beginPath(); g.moveTo(x0, y0); g.bezierCurveTo(x1, y1, x2, y2, x3, y3); g.stroke();
          g.strokeStyle = 'rgba(200,190,240,0.10)'; g.lineWidth = 0.06 * k; g.stroke();
          const pts = [];
          for (let s = 0; s <= 24; s++) {
            const t = s / 24, u = 1 - t;
            pts.push([u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
              u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]);
          }
          walkLights(g, P, pts, 1.7, 0.5);
          // small circular plaza where the path bends
          const [qx, qy] = pts[12];
          const pr = (0.8 + rand() * 0.5) * k;
          g.fillStyle = COL.path; g.beginPath(); g.arc(qx, qy, pr, 0, Math.PI * 2); g.fill();
          g.strokeStyle = 'rgba(200,190,240,0.18)'; g.lineWidth = 0.08 * k; g.stroke();
          g.fillStyle = COL.hedge; g.beginPath(); g.arc(qx, qy, pr * 0.42, 0, Math.PI * 2); g.fill();
        }
        g.restore();
      }
    }

    // ---- sidewalks + road beds (drawn after the parks so curbs stay crisp)
    roadBeds(g, P, roads, SW);
    // roundabout islands keep a small lawn
    for (const r of rbs) {
      g.fillStyle = COL.lawn;
      g.beginPath(); g.arc(X(r.cx), Z(r.cz), (r.radius - r.width / 2 - 0.1) * k, 0, Math.PI * 2); g.fill();
    }

    // ---- clean paving under the core platform, then the core plaza with subtle tile rings
    if (PLAT_R) {
      g.fillStyle = '#2a293d';
      g.beginPath(); g.arc(C, C, (PLAT_R + 0.25) * k, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(170,160,215,0.28)';
      g.lineWidth = 0.12 * k;
      g.beginPath(); g.arc(C, C, (PLAT_R + 0.25) * k, 0, Math.PI * 2); g.stroke();
    }
    const core = RINGS.core;
    const pg = g.createRadialGradient(C, C, 0, C, C, (core + 0.8) * k);
    pg.addColorStop(0, '#4a4862');
    pg.addColorStop(0.8, '#3c3a52');
    pg.addColorStop(1, '#2e2c42');
    g.fillStyle = pg;
    g.beginPath(); g.arc(C, C, (core + 0.8) * k, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(190,190,230,0.09)';
    g.lineWidth = 1;
    for (let r = 1.2; r < core + 0.8; r += 0.75) { g.beginPath(); g.arc(C, C, r * k, 0, Math.PI * 2); g.stroke(); }
    for (let a = 0; a < 360; a += 7.5) {
      const ar = a * Math.PI / 180;
      g.beginPath();
      g.moveTo(C + Math.cos(ar) * 2.5 * k, C + Math.sin(ar) * 2.5 * k);
      g.lineTo(C + Math.cos(ar) * (core + 0.8) * k, C + Math.sin(ar) * (core + 0.8) * k);
      g.stroke();
    }
    g.strokeStyle = 'rgba(255,214,150,0.25)';
    g.lineWidth = 0.15 * k;
    g.beginPath(); g.arc(C, C, (core + 0.75) * k, 0, Math.PI * 2); g.stroke();

    lampPools(g, P, lamps, 0.16);
    g.restore();

    // soft alpha edge so the detail texture melts into the outer floor
    g.globalCompositeOperation = 'destination-in';
    const edge = g.createRadialGradient(C, C, (R2 + 3) * k, C, C, (R2 + 6.6) * k);
    edge.addColorStop(0, 'rgba(0,0,0,1)');
    edge.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = edge;
    g.fillRect(0, 0, P.N, P.N);
    g.globalCompositeOperation = 'source-over';
  });

  const mkTex = (cv) => {
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
  };

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: mkTex(outer), color: '#ffffff' })
  );
  ground.name = 'ground';
  ground.renderOrder = -3;
  scene.add(ground);

  const detail = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY, CITY).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: mkTex(city), transparent: true, depthWrite: false })
  );
  detail.name = 'ground-city';
  detail.position.y = 0.01;
  detail.renderOrder = -2;
  scene.add(detail);

  const under = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_SIZE * 5, WORLD_SIZE * 5).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: COL.floor })
  );
  under.position.y = -0.05;
  under.renderOrder = -4;
  scene.add(under);

  return { ground, detail, under };
}

// ---------------------------------------------------------------------------- helpers
function paint(size, N, fn) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const k = N / size, C = N / 2;
  fn(g, { k, C, N, X: (x) => C + x * k, Z: (z) => C + z * k, rand: rng(7) });
  return cv;
}

function grain(g, rand, N, n) {
  for (let i = 0; i < n; i++) {
    const x = rand() * N, y = rand() * N, v = rand();
    g.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(150,150,190,0.03)';
    g.fillRect(x, y, 1 + rand() * 2, 1 + rand() * 2);
  }
}

// sidewalk band + dark bed under every road (the road shader paints the asphalt itself)
function roadBeds(g, P, roads, sw = 1.0) {
  const { k, X, Z } = P;
  const p = new THREE.Vector3();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const trace = (r) => {
    const n = Math.max(2, Math.ceil(r.length / 1.2));
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      r.center.getPointAt(i / n, p);
      if (i === 0) g.moveTo(X(p.x), Z(p.z)); else g.lineTo(X(p.x), Z(p.z));
    }
  };
  // pass 1: sidewalks (lavender paving with a pale outer curb)
  for (const r of roads) {
    trace(r);
    const w = r.kind === 'access' ? 0.35 : r.kind === 'side' ? sw * 0.8 : sw;
    g.strokeStyle = 'rgba(150,140,190,0.30)';
    g.lineWidth = (r.width + w * 2 + 0.12) * k;
    g.stroke();
    g.strokeStyle = r.kind === 'side' ? '#2a2a3a' : '#2f2d42';
    g.lineWidth = (r.width + w * 2) * k;
    g.stroke();
  }
  // pass 2: curb line + bed
  for (const r of roads) {
    trace(r);
    g.strokeStyle = 'rgba(170,160,215,0.32)';
    g.lineWidth = (r.width + 0.2) * k;
    g.stroke();
    g.strokeStyle = '#0d1020';
    g.lineWidth = (r.width - 0.02) * k;
    g.stroke();
  }
}

function lampPools(g, P, lamps, a) {
  const { k, X, Z } = P;
  g.globalCompositeOperation = 'lighter';
  for (const l of lamps) {
    const x = X(l.x), y = Z(l.z), R = 1.7 * k;
    const lg = g.createRadialGradient(x, y, 0, x, y, R);
    lg.addColorStop(0, `rgba(255,170,80,${a})`);
    lg.addColorStop(0.35, `rgba(255,140,60,${a * 0.25})`);
    lg.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = lg;
    g.fillRect(x - R, y - R, R * 2, R * 2);
  }
  g.globalCompositeOperation = 'source-over';
}

// warm bollard lights along a polyline (canvas px)
function walkLights(g, P, pts, spacing, a) {
  const { k } = P;
  let acc = spacing * k * 0.5;
  g.globalCompositeOperation = 'lighter';
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const L = Math.hypot(x1 - x0, y1 - y0);
    while (acc <= L) {
      const t = acc / L, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      const R = 0.9 * k;
      const lg = g.createRadialGradient(x, y, 0, x, y, R);
      lg.addColorStop(0, `rgba(255,200,120,${a})`);
      lg.addColorStop(0.12, `rgba(255,170,80,${a * 0.5})`);
      lg.addColorStop(0.5, `rgba(255,140,60,${a * 0.08})`);
      lg.addColorStop(1, 'rgba(255,120,40,0)');
      g.fillStyle = lg;
      g.fillRect(x - R, y - R, R * 2, R * 2);
      acc += spacing * k;
    }
    acc -= L;
  }
  g.globalCompositeOperation = 'source-over';
}

// asphalt service lane along an arbitrary path built by `trace`
function lane(g, P, trace, w) {
  const { k } = P;
  g.lineCap = 'round';
  trace(); g.strokeStyle = 'rgba(170,160,210,0.30)'; g.lineWidth = (w + 0.25) * k; g.stroke();
  trace(); g.strokeStyle = COL.lane; g.lineWidth = w * k; g.stroke();
  g.setLineDash([0.5 * k, 0.6 * k]);
  trace(); g.strokeStyle = 'rgba(230,220,200,0.18)'; g.lineWidth = 0.06 * k; g.stroke();
  g.setLineDash([]);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// ellipse centred at polar (r,deg) with radial half-axis rr and tangential half-axis rt
function ellipseSector(g, C, k, r, deg, rt, rr) {
  const a = deg * Math.PI / 180;
  g.ellipse(C + Math.cos(a) * r * k, C - Math.sin(a) * r * k, rr * k, rt * k, -a, 0, Math.PI * 2);
}

// annular sector path; world angles in degrees CCW from +X (canvas angle = -deg)
function sectorPath(g, C, k, r0, r1, d0, d1, round) {
  const rr = round;
  const a0 = -d0 * Math.PI / 180, a1 = -d1 * Math.PI / 180;
  const ia0 = a0 - rr / r0, ia1 = a1 + rr / r0, oa0 = a0 - rr / r1, oa1 = a1 + rr / r1;
  g.beginPath();
  g.arc(C, C, r1 * k, oa0, oa1, true);
  g.arcTo(C + Math.cos(a1) * r1 * k, C + Math.sin(a1) * r1 * k, C + Math.cos(a1) * r0 * k, C + Math.sin(a1) * r0 * k, rr * k);
  g.arc(C, C, r0 * k, ia1, ia0, false);
  g.arcTo(C + Math.cos(a0) * r0 * k, C + Math.sin(a0) * r0 * k, C + Math.cos(a0) * r1 * k, C + Math.sin(a0) * r1 * k, rr * k);
  g.closePath();
}

// grass texture inside a sector: soft dark (tree shade) and light (lit lawn) blotches + tufts
function blotchesSector(g, rand, P, r0, r1, d0, d1, density) {
  const { C, k } = P;
  const mid = (r0 + r1) / 2;
  const area = (r1 - r0) * mid * (d1 - d0) * Math.PI / 180;
  for (let q = 0; q < area * density; q++) {
    const rr = r0 + rand() * (r1 - r0), dd = (d0 + rand() * (d1 - d0)) * Math.PI / 180;
    blotch(g, rand, C + Math.cos(dd) * rr * k, C - Math.sin(dd) * rr * k, k);
  }
  for (let q = 0; q < area * 3; q++) {
    const rr = r0 + rand() * (r1 - r0), dd = (d0 + rand() * (d1 - d0)) * Math.PI / 180;
    g.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.18)' : 'rgba(70,88,48,0.08)';
    g.fillRect(C + Math.cos(dd) * rr * k, C - Math.sin(dd) * rr * k, 2, 2);
  }
}
function blotches(g, rand, x, y, w, h, n) {
  for (let i = 0; i < n; i++) blotch(g, rand, x + rand() * w, y + rand() * h, 9);
}
function blotch(g, rand, px, py, k) {
  const R = (0.5 + rand() * 1.4) * k;
  const dark = rand() < 0.6;
  const gr = g.createRadialGradient(px, py, 0, px, py, R);
  gr.addColorStop(0, dark ? COL.lawnDark : COL.lawnLight);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(px - R, py - R, R * 2, R * 2);
}
