/*
 * Flowing traffic as MINI BOTS (sheet sec 6 "Flowing Vehicles", restyled on user request): small
 * pill-shaped robots with a light-grey shell, a neon accent band + crown stripe (blue / pink /
 * orange / cyan), a dark visor whose two glowing eyes are the headlights, a glowing antenna tip and
 * a red rear light, each leaving a soft light trail in its accent colour. A few longer "carrier
 * bots" (cargo pod with neon seams) run on ring2.
 *
 * Draw calls: 4 InstancedMeshes (bot bodies, carrier bodies, antennas, additive ground glow),
 * all animated in ctx.onTick.
 *
 * Lanes come from roads.js getRoadPaths() (exact lane centres); ring2 lanes are stitched into
 * closed loops that sweep CCW through the roundabouts on the roundabout's outer lane. If roads.js
 * fails, buildLanes(layout) rebuilds equivalent lanes from layout.js alone.
 * Lanes of one carriageway direction move in angular lock-step with staggered slots, so bots in
 * neighbouring lanes never overlap.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getRoadPaths, resolveDriveways, GATE_DEPTH } from './roads.js';

const D2R = Math.PI / 180;
const Y_BODY = 0.30;   // underside of the bodies: hovering (user 11-01: doubled from 0.15); glow pools stay on the road
const Y_GLOW = 0.165;  // ground glow quad (trail + headlight pool)

// ---------------------------------------------------------------------------------------------
// Paths: piecewise arcs / lines, evaluated analytically by arc length.
// ---------------------------------------------------------------------------------------------
const ang = (x, z) => Math.atan2(-z, x) / D2R; // polar-convention angle (deg, CCW from +X)

function arcSeg(cx, cz, r, a0, a1, y = 0) { return { arc: true, cx, cz, r, a0, a1, y, len: Math.abs(a1 - a0) * D2R * r }; }
function lineSeg(x0, z0, x1, z1, y0 = 0, y1 = 0) { return { arc: false, x0, z0, x1, z1, y0, y1, len: Math.hypot(x1 - x0, z1 - z0, y1 - y0) }; }

function makePath(segs, closed) {
  let total = 0;
  const starts = segs.map((s) => { const v = total; total += s.len; return v; });
  return { segs, starts, total, closed };
}

// writes {x, z} of the path point at arc length s into out
function evalPath(path, s, out) {
  const { segs, starts, total } = path;
  if (path.closed) s = ((s % total) + total) % total;
  else s = Math.min(Math.max(s, 0), total);
  let i = segs.length - 1;
  while (i > 0 && starts[i] > s) i--;
  const g = segs[i];
  const f = g.len > 0 ? (s - starts[i]) / g.len : 0;
  if (g.arc) {
    const a = (g.a0 + (g.a1 - g.a0) * f) * D2R;
    out.x = g.cx + Math.cos(a) * g.r;
    out.z = g.cz - Math.sin(a) * g.r;
    out.y = g.y || 0;
  } else {
    out.y = g.y0 + (g.y1 - g.y0) * f;
    out.x = g.x0 + (g.x1 - g.x0) * f;
    out.z = g.z0 + (g.z1 - g.z0) * f;
  }
  return out;
}

// lane offsets (signed, + = right of the centre direction) – same rule as the painted lane markings
function laneOffsets(width) {
  const h = width / 2;
  return width >= 2.7 ? [-h * 0.72, -h * 0.28, h * 0.28, h * 0.72] : [-h * 0.5, h * 0.5];
}

// a full ring lane; offset > 0 = outer lane = CCW travel
function ringLane(r, offset) {
  const R = r + offset;
  return offset > 0 ? makePath([arcSeg(0, 0, R, 0, 360)], true) : makePath([arcSeg(0, 0, R, 360, 0)], true);
}

// ring2 lane that detours CCW around each roundabout circle (radius rho, centred on the ring)
function ring2Lane(R2, offset, rbs, rho) {
  const R = R2 + offset;
  const ccw = offset > 0;
  const cosD = (R * R + R2 * R2 - rho * rho) / (2 * R * R2);
  const delta = Math.acos(Math.min(1, Math.max(-1, cosD))) / D2R;
  const degs = [...rbs].sort((a, b) => a - b);
  if (!ccw) degs.reverse();
  const dir = ccw ? 1 : -1;
  const segs = [];
  for (let i = 0; i < degs.length; i++) {
    const d = degs[i];
    let n = degs[(i + 1) % degs.length];
    // ring arc from the exit of roundabout d to the entry of roundabout n
    const a0 = d + dir * delta;
    let a1 = n - dir * delta;
    if (ccw) { while (a1 <= a0) a1 += 360; } else { while (a1 >= a0) a1 -= 360; }
    segs.push(arcSeg(0, 0, R, a0, a1));
    // roundabout arc around centre C of n, always CCW (increasing angle)
    const C = { x: Math.cos(n * D2R) * R2, z: -Math.sin(n * D2R) * R2 };
    const pin = { x: Math.cos(a1 * D2R) * R, z: -Math.sin(a1 * D2R) * R };
    const ex = n + dir * delta;
    const pout = { x: Math.cos(ex * D2R) * R, z: -Math.sin(ex * D2R) * R };
    const t0 = ang(pin.x - C.x, pin.z - C.z);
    let t1 = ang(pout.x - C.x, pout.z - C.z);
    while (t1 <= t0) t1 += 360;
    segs.push(arcSeg(C.x, C.z, rho, t0, t1));
  }
  return makePath(segs, true);
}

// straight radial road lane (r0 at deg0 -> r1 at deg)
function radialLanes(deg0, r0, deg, r1, width) {
  const a0 = deg0 * D2R, a1 = deg * D2R;
  const x0 = Math.cos(a0) * r0, z0 = -Math.sin(a0) * r0;
  const x1 = Math.cos(a1) * r1, z1 = -Math.sin(a1) * r1;
  const L = Math.hypot(x1 - x0, z1 - z0);
  const nx = -(z1 - z0) / L, nz = (x1 - x0) / L; // right normal
  return laneOffsets(width).map((o) => {
    const A = [x0 + nx * o, z0 + nz * o], B = [x1 + nx * o, z1 + nz * o];
    return o > 0 ? makePath([lineSeg(A[0], A[1], B[0], B[1])], false) : makePath([lineSeg(B[0], B[1], A[0], A[1])], false);
  });
}

function snapInner(SPOKES, d) {
  for (const di of SPOKES.inner) if (Math.abs((((d - di) % 360) + 540) % 360 - 180) < 7) return di;
  return d;
}

// all lanes with their traffic settings
export function buildLanes(layout) {
  const { RINGS, ROAD_WIDTH: W, SPOKES, ROUNDABOUTS = [], WORLD_SIZE = 220 } = layout;
  const lanes = [];
  const R2 = RINGS.ring2;
  const rbDegs = ROUNDABOUTS.map((r) => r.deg);
  const rbSize = ROUNDABOUTS[0]?.size ?? 3.6;
  const isRb = (d) => rbDegs.some((x) => Math.abs((((d - x) % 360) + 540) % 360 - 180) < 0.5);

  const ring0 = layout.HAS_RING0_ROAD !== false;
  if (ring0) for (const o of laneOffsets(W.ring0)) lanes.push({ path: ringLane(RINGS.ring0, o), count: 2, speed: 3.6 });
  for (const o of laneOffsets(W.ring1)) lanes.push({ path: ringLane(RINGS.ring1, o), count: 4, speed: Math.abs(o) > 1 ? 4.6 : 5.6 });
  for (const o of laneOffsets(W.ring2)) {
    const path = rbDegs.length ? ring2Lane(R2, o, rbDegs, rbSize + 0.5) : ringLane(R2, o);
    lanes.push({ path, count: 5, speed: Math.abs(o) > 1 ? 5.4 : 6.8, buses: Math.abs(o) > 1 ? 1 : 0 });
  }
  for (const d of SPOKES.inner) {
    // without ring0 the inner spokes run flat from the core platform portal (r 14.2) to ring1
    for (const path of radialLanes(d, ring0 ? RINGS.ring0 + W.ring0 / 2 - 0.15 : 14.2, d, RINGS.ring1 - W.ring1 / 2 + 0.15, W.spoke))
      lanes.push({ path, count: 1, speed: 3.4 });
  }
  for (const d of SPOKES.outer) {
    const end = isRb(d) ? R2 - rbSize - 0.6 : R2 - W.ring2 / 2 + 0.15;
    for (const path of radialLanes(snapInner(SPOKES, d), RINGS.ring1 + W.ring1 / 2 - 0.15, d, end, W.spoke))
      lanes.push({ path, count: 1, speed: 4.2 });
  }
  const edge = WORLD_SIZE / 2;
  for (const d of SPOKES.exits) {
    const start = isRb(d) ? R2 + rbSize + 0.6 : R2 + W.ring2 / 2 - 0.15;
    const a = d * D2R;
    const far = layout.EDGE_RING ? layout.EDGE_RING.radius : edge / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
    for (const path of radialLanes(d, start, d, far, W.exit ?? 2.6)) lanes.push({ path, count: 1, speed: 6 });
  }
  return lanes;
}

// Lanes taken from roads.js getRoadPaths() so every vehicle rides exactly on the painted lane
// centres. Ring2 is stitched back into closed loops that sweep CCW through the roundabouts on the
// roundabout's own outer lane. Falls back to buildLanes(layout) if roads.js is unavailable.
function curveSeg(c) {
  if (c && c.r !== undefined && c.a0 !== undefined) return arcSeg(c.cx, c.cz, c.r, c.a0, c.a1, c.y || 0);
  if (c && c.v1 && c.v2) return lineSeg(c.v1.x, c.v1.z, c.v2.x, c.v2.z, c.v1.y || 0, c.v2.y || 0);
  return null;
}

// lengthen a straight segment: d > 0 moves its end forward, d < 0 moves its start backward
const PORTAL = 0.9;
function extendLine(g, d) {
  const L = g.len || 1, ux = (g.x1 - g.x0) / L, uz = (g.z1 - g.z0) / L;
  if (d > 0) { g.x1 += ux * d; g.z1 += uz * d; } else { g.x0 += ux * d; g.z0 += uz * d; }
  g.len += Math.abs(d);
}

// segment start / end point {x, y, z}
function segEnd(g, end) {
  const o = { x: 0, y: 0, z: 0 };
  evalPath({ segs: [g], starts: [0], total: g.len, closed: false }, end ? g.len : 0, o);
  return o;
}
// chain THREE lane curves and/or raw segs into one path, bridging small gaps with straight pieces
function chainPath(parts, closed = false) {
  const segs = [];
  let prev = null;
  for (const c of parts) {
    const g = c && c.len !== undefined && c.arc !== undefined ? c : curveSeg(c);
    if (!g || g.len < 1e-4) continue;
    const a = segEnd(g, false);
    if (prev && Math.hypot(a.x - prev.x, a.z - prev.z, a.y - prev.y) > 0.02) segs.push(lineSeg(prev.x, prev.z, a.x, a.z, prev.y, a.y));
    segs.push(g);
    prev = segEnd(g, true);
  }
  return makePath(segs, closed);
}

// one full cycle of a lane in distance units (driveway visits add the out-path and the time inside)
function laneCycle(lane) {
  return lane.path.total + (lane.outPath ? lane.outPath.total + lane.hold : 0) + (lane.idle || 0);
}

// traffic plan per road kind: [cars per lane for inner lanes, outer lanes], speed
const PLAN = {
  // carrier bots (buses) on every main ring, more of them (user 11-01). count + buses must match
  // between the inner and outer lane of a direction (the lanes run in staggered lock-step).
  ring1: { count: [3, 3], speed: 5.0, buses: [1, 1] },
  ring2: { count: [4, 3], speed: 6.2, buses: [1, 2] },
  // outer main ring (r 84): ring2's density scaled by its longer circumference (84 / 55)
  ring3: { count: [6, 5], speed: 6.4, buses: [2, 3] },
  // edge main ring (r 150, user 10-31): ring3's density scaled by circumference (150 / 84)
  ring4: { count: [11, 9], speed: 6.4, buses: [3, 5] },
};

export function lanesFromRoads(layout, scene = null) {
  const roads = getRoadPaths(layout);
  if (!roads || !roads.length) throw new Error('no roads');
  const lanes = [];
  const byId = (id) => roads.find((r) => r.id === id);
  const outer = (o, w) => Math.abs(o) > w * 0.25;
  const pick = (v, o, w) => (Array.isArray(v) ? v[outer(o, w) ? 1 : 0] : v);

  // no ring0 road any more (layout.HAS_RING0_ROAD === false): the core sits on a raised platform
  for (const id of ['ring1']) {
    const road = byId(id);
    if (!road) continue;
    for (const ln of road.lanes) {
      const seg = curveSeg(ln.curve);
      if (!seg) continue;
      const pl = PLAN[id];
      lanes.push({ path: makePath([seg], true), count: pick(pl.count, ln.offset, road.width), speed: pick(pl.speed, ln.offset, road.width), buses: pick(pl.buses || 0, ln.offset, road.width), group: id + (ln.offset > 0 ? '+' : '-'), half: outer(ln.offset, road.width) ? 1 : 0 });
    }
  }

  // ring2: closed loops through the roundabouts
  const arcs = roads.filter((r) => r.id.startsWith('ring2'));
  const rbs = roads.filter((r) => r.kind === 'roundabout');
  if (arcs.length) {
    const R2 = arcs[0].radius;
    const rbDegs = (layout.ROUNDABOUTS || []).map((r) => r.deg);
    const rho = rbs.length ? rbs[0].radius + Math.max(...rbs[0].lanes.map((l) => Math.abs(l.offset))) : 2.4;
    for (const ln of arcs[0].lanes) {
      const path = rbDegs.length && arcs.length > 1 ? ring2Lane(R2, ln.offset, rbDegs, rho) : ringLane(R2, ln.offset);
      const pl = PLAN.ring2;
      lanes.push({ path, count: pick(pl.count, ln.offset, arcs[0].width), speed: pick(pl.speed, ln.offset, arcs[0].width), buses: pick(pl.buses, ln.offset, arcs[0].width), group: 'ring2' + (ln.offset > 0 ? '+' : '-'), half: outer(ln.offset, arcs[0].width) ? 1 : 0 });
    }
  }

  // spokes / exits: open lanes, bots fade in and out at the ends. Only every other lane carries
  // traffic (the reference shows the odd vehicle on the radial roads, not one on every lane).
  // Inner spokes are a ramp (core platform -> ground, curves carry y) + a flat part: chained.
  // all exits END at the edge ring (r 150): their bots turn onto it (outbound) or come off it
  // (inbound) instead of vanishing at the map edge. They ride ring4's lane nearest the exit for
  // EDGE_SPAN deg, away from (or toward) the exit axis, and fade in/out short of the next crossing.
  const r4 = byId('ring4');
  const EDGE_SPAN = 50;
  const wrap = (x) => ((x % 360) + 540) % 360 - 180;
  const edgeTurn = (road, curves) => {
    if (!r4 || road.kind !== 'exit' || curves.length !== 1) return curves;
    const g = curveSeg(curves[0]);
    if (!g || g.arc) return curves;
    const R = r4.radius;
    const rs = Math.hypot(g.x0, g.z0), re = Math.hypot(g.x1, g.z1);
    const out = re > rs;
    const P = out ? { x: g.x1, z: g.z1 } : { x: g.x0, z: g.z0 };
    if (Math.abs(Math.hypot(P.x, P.z) - R) > 1.2) return curves; // exit does not end at the ring: unchanged
    const th = Math.atan2(-P.z, P.x) / D2R;
    const side = Math.sign(wrap(th - road.deg)) || 1;     // which side of the exit axis this lane is on
    const ccw = out ? side > 0 : side < 0;                 // ring travel direction
    const offs = r4.lanes.map((l) => l.offset).filter((o) => (ccw ? o > 0 : o < 0));
    const rad = R + (ccw ? Math.min(...offs) : Math.max(...offs)); // lane nearest the centre line
    const fillet = (1.0 / R) / D2R;                        // short diagonal bridge = a softer turn
    // stop short of the next exit crossing on that side
    const gap = Math.min(...layout.SPOKES.exits.map((x) => wrap(x - road.deg) * side).filter((x) => x > 1));
    const span = Math.min(EDGE_SPAN, (isFinite(gap) ? gap : 60) - 5);
    const a0 = th + side * fillet, a1 = th + side * span;
    if (out) return [g, arcSeg(0, 0, rad, a0, a1)];
    return [arcSeg(0, 0, rad, a1, a0), g];
  };
  let k = 0;
  const innerDone = new Set();
  for (const road of roads) {
    // outer secondary streets: only the ring3 -> ring4 connectors (light traffic; parcel lanes are dead ends)
    if (!['spoke', 'exit'].includes(road.kind) && !road.id.startsWith('street-r-')) continue;
    let pieces; // per lane: its curves in travel order
    const m = /^spoke-in-([\d.]+)(-ramp)?$/.exec(road.id);
    if (m) {
      if (innerDone.has(m[1])) continue;
      innerDone.add(m[1]);
      const ramp = byId(`spoke-in-${m[1]}-ramp`), flat = byId(`spoke-in-${m[1]}`);
      const lanesOf = (r, fwd) => (r ? r.lanes.filter((l) => l.forward === fwd).map((l) => l.curve) : []);
      // forward = outward (platform -> ring1), backward = inward
      pieces = [[...lanesOf(ramp, true), ...lanesOf(flat, true)], [...lanesOf(flat, false), ...lanesOf(ramp, false)]];
    } else {
      pieces = road.lanes.map((l) => [l.curve]);
    }
    k++;
    pieces.forEach((curves, j) => {
      if ((k + j) % 2 || !curves.length) return;
      const path = chainPath(edgeTurn(road, curves));
      if (path.total <= 0.5) return;
      const lane = { path, count: 1, speed: road.kind === 'exit' ? 6 : road.kind === 'street' ? 4.4 : 4 };
      // every other trafficked exit lane carries a carrier bot instead of a mini bot (user 11-01)
      if (road.kind === 'exit' && (k >> 1) % 2 === 0) { lane.count = 0; lane.buses = 1; lane.speed = 5.4; }
      if (m && layout.HAS_RING0_ROAD === false) {
        // inner spokes end at the core platform's tunnel portal (r ~14.2): run PORTAL units on into
        // the tunnel and fade there, so bots vanish just inside / emerge from the portal
        const segs = path.segs;
        const first = segs[0], last = segs[segs.length - 1];
        const r0 = Math.hypot(first.x0, first.z0), r1 = Math.hypot(last.x1, last.z1);
        if (!first.arc && r0 < r1) { extendLine(first, -PORTAL); lane.fadeIn = PORTAL; }      // outbound
        else if (!last.arc && r1 < r0) { extendLine(last, PORTAL); lane.fadeOut = PORTAL; }    // inbound
        lane.path = makePath(segs, false);
      }
      lanes.push(lane);
    });
  }
  // building driveways (user 10-30): one bot per building drives up the inbound half of the driveway,
  // fades out as it passes into the entrance gateway, stays hidden "inside" for a while, then fades in
  // at the gateway and drives out on the outbound half back to its host road; then an idle gap
  // (hidden) so visits are staggered. Inner buildings: arrive inbound on the clockwise spoke, along the
  // forecourt arc, leave along the arc and outbound on the counter-clockwise spoke.
  if (scene) { try { resolveDriveways(scene, layout); } catch (e) { console.warn('vehicles: gateways unresolved', e); } }
  const parts = new Map();
  for (const road of roads) {
    if (road.kind !== 'access' || !road.building) continue;
    if (!parts.has(road.building)) parts.set(road.building, {});
    // forecourt arcs are one-way single-lane drives: ride their centre line (CCW = travel direction)
    parts.get(road.building)[road.part] = road.arcOnly ? road.center : road.lanes[0].curve;
  }
  const slot = (id) => (layout.BUILDINGS || []).find((x) => x.id === id);
  const spokeLane = Math.abs(byId(`spoke-in-${(layout.SPOKES.inner || [])[0]}`)?.lanes[0]?.offset ?? 0.55);
  const nearestInner = (deg) => {
    let best = null, bd = 1e9;
    for (const d of layout.SPOKES.inner || []) { const x = Math.abs((((deg - d) % 360) + 540) % 360 - 180); if (x < bd) { bd = x; best = d; } }
    return best;
  };
  // straight piece on an inner spoke lane between radii r0 -> r1 (inbound when r1 < r0)
  const spokePiece = (d, r0, r1) => {
    const a = d * D2R, c = Math.cos(a), sn = Math.sin(a);
    const dir = r1 < r0 ? -1 : 1;
    const nx = dir * sn, nz = dir * c; // right normal of the travel direction
    return lineSeg(c * r0 + nx * spokeLane, -sn * r0 + nz * spokeLane, c * r1 + nx * spokeLane, -sn * r1 + nz * spokeLane);
  };
  let bi = 0;
  for (const [id, pt] of parts) {
    if (!pt['gate-in'] || !pt['gate-out']) continue;
    const gin = curveSeg(pt['gate-in']), gout = curveSeg(pt['gate-out']);
    extendLine(gin, GATE_DEPTH);      // run on into the gateway ...
    extendLine(gout, -GATE_DEPTH);    // ... and emerge from it
    const inChain = [gin], outChain = [gout];
    const b = slot(id);
    if (b && b.ring === 'inner' && pt.in && pt.out && layout.HAS_RING0_ROAD === false) {
      const rL = pt.in.r;
      inChain.unshift(spokePiece(nearestInner(pt.in.a0), rL + 4.5, rL), pt.in);
      outChain.push(pt.out, spokePiece(nearestInner(pt.out.a1), rL, rL + 4.5));
    }
    const inPath = chainPath(inChain), outPath = chainPath(outChain);
    const drive = inPath.total + outPath.total;
    const hold = drive * (0.8 + ((bi * 0.37) % 1) * 0.6); // time "inside", in distance units
    bi++;
    lanes.push({ building: id, path: inPath, outPath, hold, count: 1, speed: 2.6, idle: drive * 1.6, access: true, scale: 0.85, gateFade: GATE_DEPTH });
  }
  // outer main rings: both directions, 2 lanes each, like ring2 (exit bots cross ring3 on the full exits;
  // ring4 (r 150) is where all exits end)
  // secondary r 118 street arc: light traffic, one lane each way
  for (const st of roads.filter((r) => r.kind === 'street' && r.closed)) {
    for (const ln of st.lanes) {
      const seg = curveSeg(ln.curve);
      if (seg) lanes.push({ path: makePath([seg], true), count: 3, speed: 4.6, scale: 0.9 });
    }
  }
  for (const rid of ['ring3', 'ring4']) {
    const r3 = byId(rid);
    if (!r3) continue;
    const main = r3.kind === 'ring', pl = PLAN[rid];
    for (const ln of r3.lanes) {
      const seg = curveSeg(ln.curve);
      if (!seg) continue;
      lanes.push(main
        ? { path: makePath([seg], true), count: pick(pl.count, ln.offset, r3.width), speed: pick(pl.speed, ln.offset, r3.width), buses: pick(pl.buses, ln.offset, r3.width), group: rid + (ln.offset > 0 ? '+' : '-'), half: outer(ln.offset, r3.width) ? 1 : 0 }
        : { path: makePath([seg], true), count: 4, speed: 6, scale: 0.9 });
    }
  }
  return lanes;
}

// ---------------------------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------------------------
const bodyVert = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vLN;
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vCol;
  #include <fog_pars_vertex>
  void main() {
    vLocal = position;
    vLN = normal;
    vCol = instanceColor;
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vec4 mvPosition = viewMatrix * wp;
    vN = mat3(viewMatrix) * mat3(modelMatrix) * mat3(instanceMatrix) * normal;
    vView = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const bodyFrag = /* glsl */ `
  uniform float uHalf;   // half length of the body along local +X (forward)
  uniform float uHalfW;  // half width
  uniform float uH;      // body height
  uniform float uBus;
  varying vec3 vLocal;
  varying vec3 vLN;
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vCol;     // neon accent colour
  #include <fog_pars_fragment>
  void main() {
    vec3 N = vN / max(length(vN), 1e-6);  // guard: faded-out instances have zero scale
    vec3 V = normalize(vView);
    float rim = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), 1.6);
    float fx = vLocal.x / uHalf;              // -1 rear .. +1 front
    float az = abs(vLocal.z);
    float fz = az / uHalfW;                   // 0 centre .. 1 side
    float t = vLocal.y / uH;                  // 0 bottom .. 1 top
    float top = smoothstep(0.35, 0.85, vLN.y);
    vec3 neon = vCol * 3.4 + vec3(0.03);

    // white / light-grey robot shell, lit from above, faint cool underside
    vec3 col = mix(vec3(0.22, 0.24, 0.32), vec3(0.66, 0.69, 0.76), 0.35 + 0.65 * smoothstep(-0.2, 0.9, vLN.y));
    // glowing accent band around the waist + a stripe along the crown (readable from above)
    float band = smoothstep(0.22, 0.27, t) * (1.0 - smoothstep(0.46, 0.51, t));
    float crownEnd = uBus > 0.5 ? -0.86 : -0.72;
    float stripe = (1.0 - smoothstep(0.2, 0.27, fz)) * smoothstep(crownEnd, crownEnd + 0.06, fx) * (1.0 - smoothstep(0.08, 0.14, fx)) * top;
    col = mix(col, vCol * 1.5 + vec3(0.02), stripe);
    col = mix(col, neon, band);
    // soft neon rim so the silhouette reads as a glowing outline at dashboard scale
    col = mix(col, neon * 0.6, smoothstep(0.5, 0.9, rim) * 0.4);

    if (uBus > 0.5) {
      // carrier bot: cargo pod on the back half (darker panel with neon seams)
      float podX = smoothstep(-0.84, -0.8, fx) * (1.0 - smoothstep(0.18, 0.22, fx));
      float podZ = 1.0 - smoothstep(0.66, 0.72, fz);
      float pod = podX * podZ * top;
      float seams = (1.0 - smoothstep(0.02, 0.05, abs(fract((fx + 0.82) / 0.25) - 0.5) * 0.25)) ;
      vec3 podCol = vec3(0.16, 0.18, 0.26);
      podCol = mix(podCol, neon * 0.8, (smoothstep(0.58, 0.66, fz) + seams * 0.6) * 0.9);
      col = mix(col, podCol, pod * (1.0 - stripe));
    }

    // dark visor face on the front with a thin neon rim
    float vx0 = uBus > 0.5 ? 0.6 : 0.3;
    float vd = length(vec2((fx - (vx0 + 1.0) * 0.5) / ((1.0 - vx0) * 0.5 + 0.06), fz / 0.86));
    float visor = (1.0 - smoothstep(0.92, 1.0, vd)) * smoothstep(0.3, 0.42, t);
    float visorRim = smoothstep(0.84, 0.94, vd) * (1.0 - smoothstep(0.98, 1.06, vd)) * smoothstep(0.3, 0.42, t);
    col = mix(col, vec3(0.008, 0.01, 0.03), visor);
    col += neon * 0.5 * visorRim;
    // two glowing eyes = headlights
    float ex = vLocal.x - (uHalf - (uBus > 0.5 ? 0.42 : 0.36));
    float eyeD = length(vec2(ex * 0.8, az - uHalfW * 0.36));
    float eye = 1.0 - smoothstep(0.05, 0.075, eyeD);
    float eyeHalo = exp(-eyeD * eyeD / 0.004) * 0.35;
    col = mix(col, vec3(3.6, 3.9, 4.2), eye * visor);
    col += vec3(0.7, 0.85, 1.0) * eyeHalo * visor;
    // soft red rear light
    float tail = (1.0 - smoothstep(-0.95, -0.86, fx)) * (1.0 - smoothstep(0.45, 0.7, fz)) * smoothstep(0.3, 0.4, t) * (1.0 - smoothstep(0.7, 0.8, t));
    col = mix(col, vec3(3.0, 0.1, 0.07), tail);

    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }
`;

const antVert = /* glsl */ `
  varying float vY;
  varying vec3 vCol;
  #include <fog_pars_vertex>
  void main() {
    vY = position.y;
    vCol = instanceColor;
    vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const antFrag = /* glsl */ `
  uniform float uTipY;
  varying float vY;
  varying vec3 vCol;
  #include <fog_pars_fragment>
  void main() {
    vec3 col = vY > uTipY ? vCol * 4.0 + vec3(0.6) : vec3(0.55, 0.58, 0.66);
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }
`;

const glowVert = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vCol;
  varying float vScale;
  #include <fog_pars_vertex>
  void main() {
    vLocal = position;
    vCol = instanceColor;
    vScale = length(instanceMatrix[0].xyz);
    vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
// local quad: x in [-TRAIL, FRONT] (forward = +X), z in [-0.7, 0.7]
const glowFrag = /* glsl */ `
  uniform float uTrail;
  uniform float uFront;
  uniform float uCarHalf;
  varying vec3 vLocal;
  varying vec3 vCol;
  varying float vScale;
  #include <fog_pars_fragment>
  float sq(float a) { return a * a; }
  void main() {
    float x = vLocal.x, z = vLocal.z;
    // coloured light trail behind the car, narrowing and fading with distance
    float tb = clamp((-x - uCarHalf * 0.6) / (uTrail - uCarHalf * 0.6), 0.0, 1.0);
    float tw = mix(0.3, 0.08, tb);
    float trail = exp(-sq(z / tw)) * pow(max(1.0 - tb, 0.0), 1.6) * step(x, -uCarHalf * 0.6);
    // two faint red tail streaks right behind the car
    float tails = (exp(-sq((abs(z) - 0.28) / 0.08))) * exp(-sq((x + uCarHalf) / 0.35)) * step(x, -uCarHalf * 0.8);
    // soft halo under the car
    float halo = exp(-sq(x / (uCarHalf * 1.1)) - sq(z / 0.62));
    // headlight pool on the road ahead
    float fd = x - uCarHalf * 0.85;
    float fw = 0.3 + max(fd, 0.0) * 0.35;
    float head = exp(-sq(z / fw)) * smoothstep(0.0, 0.15, fd) * (1.0 - smoothstep(0.1, uFront - uCarHalf, fd));
    vec3 col = vCol * (trail * 1.6 + halo * 0.45) + vec3(1.0, 0.92, 0.75) * head * 0.28 + vec3(1.0, 0.08, 0.06) * tails * 1.2;
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        col *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        col *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
      #endif
    #endif
    gl_FragColor = vec4(col, 1.0);
  }
`;

function bodyMaterial(half, halfW, h, bus) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uHalf: { value: half }, uHalfW: { value: halfW }, uH: { value: h }, uBus: { value: bus ? 1 : 0 } }]),
    vertexShader: bodyVert,
    fragmentShader: bodyFrag,
    fog: true,
  });
}

// capsule lying along +X, flattened to a low car body sitting on y = 0
function capsuleBody(radius, length, height) {
  const g = new THREE.CapsuleGeometry(radius, length, 6, 14);
  g.rotateZ(-Math.PI / 2);
  const sy = height / (2 * radius);
  g.scale(1, sy, 1);
  g.translate(0, height / 2, 0);
  return g;
}

// ---------------------------------------------------------------------------------------------
// Game mode (ctx.game) runs a quiet night city: far fewer bots and drones, moving more slowly. The viewer is unchanged.
const TUNE_GAME = { density: 0.2, speed: 0.5, droneDensity: 0.1, droneSpeed: 0.3 };
const TUNE_VIEW = { density: 1, speed: 1, droneDensity: 1, droneSpeed: 1 };

// Game mode: the city's bots become hoverboards. Length runs along local +X (the heading axis of the instance matrices),
// the deck is dark and tinted by the per-instance accent colour, the neon strips and thrusters glow in it.
function boardGeometry(len, wid, wings = false) {
  const parts = [];
  const add = (g, col, x = 0, y = 0, z = 0, ry = 0) => {
    g = g.toNonIndexed(); if (ry) g.rotateY(ry); g.translate(x, y, z); g.deleteAttribute('uv');
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < c.length; i += 3) { c[i] = col[0]; c[i + 1] = col[1]; c[i + 2] = col[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(g);
  };
  const dark = [0.16, 0.18, 0.3], plate = [0.3, 0.35, 0.55], neon = [2.2, 2.2, 2.2];
  add(new THREE.BoxGeometry(len, 0.08, wid), dark, 0, 0.11, 0);
  add(new THREE.CylinderGeometry(wid / 2, wid / 2, 0.08, 14), dark, len / 2, 0.11, 0);
  add(new THREE.CylinderGeometry(wid / 2, wid / 2, 0.08, 14), dark, -len / 2, 0.11, 0);
  add(new THREE.BoxGeometry(len * 0.78, 0.025, wid * 0.82), plate, 0, 0.148, 0);
  for (const sz of [-1, 1]) add(new THREE.BoxGeometry(len * 0.98, 0.035, 0.035), neon, 0, 0.125, sz * (wid / 2 - 0.01));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.CylinderGeometry(0.085, 0.06, 0.04, 10), neon, sx * len * 0.3, 0.055, sz * wid * 0.25);
  if (wings) for (const sz of [-1, 1]) { add(new THREE.BoxGeometry(0.34, 0.02, 0.42), plate, -0.15, 0.12, sz * (wid / 2 + 0.17), sz * 0.5); add(new THREE.BoxGeometry(0.3, 0.03, 0.05), neon, -0.2, 0.13, sz * (wid / 2 + 0.34), sz * 0.5); }
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return g;
}
const boardMaterial = () => new THREE.MeshBasicMaterial({ vertexColors: true });

export default function build(ctx) {
  const { scene, onTick, layout } = ctx;
  const TUNE = ctx.game ? TUNE_GAME : TUNE_VIEW;
  let lanes;
  try { lanes = lanesFromRoads(layout, ctx.scene); } catch (e) { console.warn('vehicles: roads.js lanes unavailable, using fallback', e); lanes = buildLanes(layout); }
  if (TUNE.density < 1) {
    lanes.forEach((lane, i) => {
      if (lane.access) return; // building driveways keep their single visitor
      const pick = (n) => Math.floor(n * TUNE.density + ((i * 0.6180339) % 1)); // deterministic thinning, never all-or-nothing
      lane.count = pick(lane.count || 0);
      lane.buses = pick(lane.buses || 0);
    });
  }

  // vehicle dimensions
  // mini bots (pill-shaped robots rolling along the lanes) and longer carrier bots on ring2
  const CAR = { r: 0.42, len: 1.0, h: 0.58 };    // total length 1.84, width 0.84 (fits a lane)
  const BUS = { r: 0.46, len: 2.9, h: 0.66 };    // total length 3.82, width 0.92
  const carHalf = CAR.len / 2 + CAR.r, busHalf = BUS.len / 2 + BUS.r;

  const palette = [
    ['#3A86FF', 0.3], ['#FF2D95', 0.25], ['#FF9F1C', 0.25], ['#22D3EE', 0.2],
  ];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pickColor = () => {
    let x = rnd();
    for (const [c, w] of palette) { if ((x -= w) <= 0) return c; }
    return palette[0][0];
  };

  // vehicles: { lane, s, speed, bus, color }
  const vehicles = [];
  const groups = new Map();
  for (const lane of lanes) {
    const total = lane.path.total;
    const n = lane.count + (lane.buses || 0);
    if (n <= 0) continue;
    const busSlots = new Set();
    for (let b = 0; b < (lane.buses || 0); b++) busSlots.add(Math.floor(((b + 0.5) * n) / lane.buses) % n); // evenly spread, never the same slot
    // lanes of one carriageway direction move in angular lock-step with their slots staggered by
    // half a spacing, so cars in neighbouring lanes never drive side by side and overlap
    let off, v, jit = 0.45;
    if (lane.group) {
      let g = groups.get(lane.group);
      if (!g) groups.set(lane.group, (g = { off: rnd(), v: lane.speed * (0.94 + rnd() * 0.12), ref: total }));
      off = g.off + (lane.half ? 0.5 : 0);
      v = g.v * (total / g.ref);
      jit = 0.12;
    } else {
      off = rnd();
      v = lane.speed * (0.94 + rnd() * 0.12);
    }
    for (let i = 0; i < n; i++) {
      const s = ((((i + off + (rnd() - 0.5) * jit) / n) % 1 + 1) % 1) * laneCycle(lane);
      const bus = busSlots.has(i);
      vehicles.push({ lane, s, speed: v * TUNE.speed, bus, color: bus ? (rnd() < 0.5 ? '#22D3EE' : '#3A86FF') : pickColor() });
    }
  }
  const cars = vehicles.filter((v) => !v.bus);
  const buses = vehicles.filter((v) => v.bus);

  const carMesh = new THREE.InstancedMesh(capsuleBody(CAR.r, CAR.len, CAR.h), bodyMaterial(carHalf, CAR.r, CAR.h, false), cars.length);
  const busMesh = new THREE.InstancedMesh(capsuleBody(BUS.r, BUS.len, BUS.h), bodyMaterial(busHalf, BUS.r, BUS.h, true), Math.max(1, buses.length));
  busMesh.count = buses.length;
  if (ctx.game) { // hoverboards instead of capsule bots
    const bm = boardMaterial();
    carMesh.geometry.dispose(); carMesh.geometry = boardGeometry(1.5, 0.5); carMesh.material = bm;
    busMesh.geometry.dispose(); busMesh.geometry = boardGeometry(2.5, 0.62); busMesh.material = bm;
  }

  const TRAIL = 5.5, FRONT = 2.6;
  const glowGeo = new THREE.PlaneGeometry(TRAIL + FRONT, 1.8);
  glowGeo.rotateX(-Math.PI / 2);
  glowGeo.translate((FRONT - TRAIL) / 2, 0, 0);
  const glowMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTrail: { value: TRAIL }, uFront: { value: FRONT }, uCarHalf: { value: carHalf } }]),
    vertexShader: glowVert,
    fragmentShader: glowFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
  const glowMesh = new THREE.InstancedMesh(glowGeo, glowMat, vehicles.length);

  const col = new THREE.Color();
  cars.forEach((v, i) => { v.mesh = carMesh; v.idx = i; carMesh.setColorAt(i, col.set(v.color)); });
  buses.forEach((v, i) => { v.mesh = busMesh; v.idx = i; busMesh.setColorAt(i, col.set(v.color)); });
  // light trail in the bot's accent colour
  vehicles.forEach((v, i) => { v.gidx = i; glowMesh.setColorAt(i, col.set(v.color)); });

  // antennas: thin stalk + glowing tip, one InstancedMesh for every bot
  const ANT_H = 0.34, TIP_R = 0.095;
  const stalk = new THREE.CylinderGeometry(0.022, 0.03, ANT_H, 5, 1).translate(0, ANT_H / 2 - 0.04, 0);
  const tip = new THREE.SphereGeometry(TIP_R, 8, 6).translate(0, ANT_H - 0.04 + TIP_R * 0.6, 0);
  const antGeo = mergeGeometries([stalk.toNonIndexed(), tip.toNonIndexed()].map((g) => { g.deleteAttribute('uv'); return g; }));
  const antMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTipY: { value: ANT_H - 0.04 - TIP_R * 0.2 } }]),
    vertexShader: antVert, fragmentShader: antFrag, fog: true,
  });
  const antMesh = new THREE.InstancedMesh(antGeo, antMat, vehicles.length);
  if (ctx.game) antMesh.visible = false;
  vehicles.forEach((v, i) => antMesh.setColorAt(i, col.set(v.color)));

  for (const m of [carMesh, busMesh, glowMesh, antMesh]) {
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(m);
  }
  glowMesh.renderOrder = 4;
  carMesh.renderOrder = 5;
  busMesh.renderOrder = 5;
  antMesh.renderOrder = 5;

  const pA = { x: 0, y: 0, z: 0 }, pB = { x: 0, y: 0, z: 0 }, p = { x: 0, y: 0, z: 0 };
  const FADE = 1.2;
  function writeMatrix(arr, o, x, y, z, cx, sx, scale, stretch, cp = 1, sp = 0) {
    // heading (cx, sx) in XZ (sx = dz component) plus pitch (cos cp, sin sp) about the local Z axis
    const k = scale * stretch;
    arr[o + 0] = cx * cp * k; arr[o + 1] = sp * k; arr[o + 2] = sx * cp * k; arr[o + 3] = 0;
    arr[o + 4] = -cx * sp * scale; arr[o + 5] = cp * scale; arr[o + 6] = -sx * sp * scale; arr[o + 7] = 0;
    arr[o + 8] = -sx * scale; arr[o + 9] = 0; arr[o + 10] = cx * scale; arr[o + 11] = 0;
    arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
  }

  function update(dt) {
    const aArr = antMesh.instanceMatrix.array, carArr = carMesh.instanceMatrix.array, busArr = busMesh.instanceMatrix.array, gArr = glowMesh.instanceMatrix.array;
    for (const v of vehicles) {
      v.s += v.speed * dt;
      const cycle = laneCycle(v.lane);
      if (v.s > cycle) v.s -= cycle;
      if (v.taken) { // stolen by the player: collapse the instance out of sight until the game gives it back
        writeMatrix(v.bus ? busArr : carArr, v.idx * 16, 0, -50, 0, 1, 0, 0.0001, 1);
        writeMatrix(aArr, v.gidx * 16, 0, -50, 0, 1, 0, 0.0001, 1);
        writeMatrix(gArr, v.gidx * 16, 0, -50, 0, 1, 0, 0.0001, 1);
        v.vis = false;
        continue;
      }
      // driveway visits: in-path -> hidden inside the building (hold) -> out-path -> hidden idle
      let path = v.lane.path, s = v.s, fIn = v.lane.fadeIn || FADE, fOut = v.lane.fadeOut || FADE, hidden = false;
      if (v.lane.outPath) {
        const a = v.lane.path.total, h = v.lane.hold, o = v.lane.outPath.total;
        if (s <= a) fOut = v.lane.gateFade;
        else if (s < a + h) { s = a; hidden = true; }
        else if (s <= a + h + o) { path = v.lane.outPath; s -= a + h; fIn = v.lane.gateFade; }
        else { path = v.lane.outPath; s = o; hidden = true; }
      }
      const look = v.bus ? 0.9 : 0.45;
      evalPath(path, s, p);
      evalPath(path, s + look, pA);
      evalPath(path, s - look, pB);
      let dx = pA.x - pB.x, dz = pA.z - pB.z;
      const L = Math.hypot(dx, dz) || 1;
      dx /= L; dz /= L;
      // pitch on the platform ramps (the path carries y)
      const pitch = Math.atan2((pA.y || 0) - (pB.y || 0), L);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const yb = p.y || 0;
      v.px = p.x; v.py = yb; v.pz = p.z; v.dx = dx; v.dz = dz; v.vis = !hidden; // world pose, read by the game (hijacking)
      let scale = v.lane.scale || 1;
      if (!path.closed) {
        const e = hidden ? 0 : Math.min(s / fIn, (path.total - s) / fOut);
        let f = Math.max(0, Math.min(1, e));
        scale *= Math.max(0.002, f * f * (3 - 2 * f));
      }
      writeMatrix(v.bus ? busArr : carArr, v.idx * 16, p.x, yb + Y_BODY, p.z, dx, dz, scale, 1, cp, sp);
      // antenna on the crown, behind the visor (carrier: on the cargo pod's front edge)
      const ao = (v.bus ? 0.15 : -0.32) * scale, ah = (v.bus ? BUS.h : CAR.h) * scale;
      writeMatrix(aArr, v.gidx * 16, p.x + dx * (ao * cp - ah * sp), yb + Y_BODY + ah * cp + ao * sp, p.z + dz * (ao * cp - ah * sp), dx, dz, scale, 1, cp, sp);
      writeMatrix(gArr, v.gidx * 16, p.x, yb + Y_GLOW, p.z, dx, dz, scale, v.bus ? 1.35 : 1, cp, sp);
    }
    carMesh.instanceMatrix.needsUpdate = true;
    busMesh.instanceMatrix.needsUpdate = true;
    glowMesh.instanceMatrix.needsUpdate = true;
    antMesh.instanceMatrix.needsUpdate = true;
  }
  update(0);
  onTick((t, dt) => update(dt));
  try { buildDrones(ctx, TUNE); } catch (e) { console.error('[vehicles] drones failed', e); }

  if (typeof window !== 'undefined') window.__auraVehicles = { lanes, vehicles }; // debugging handle
  return { lanes, vehicles };
}

// ---------------------------------------------------------------------------------------------
// Floating drones (user 11-01): the small soft light streaks that drifted along the lanes (old
// roads.js shader) are now tiny ROUND hovering robots: a pearl-white sphere body with a neon
// equator band, a dark visor with a glowing eye on the front, a thruster glow underneath, a soft
// light pool on the road below and a short light trail. They hover above the bots, bob gently and
// fly about 2.5x faster than the old streaks. 2 InstancedMeshes (bodies, additive glow+trail).
// ---------------------------------------------------------------------------------------------
const DRONE = { r: 0.36, hover: 1.6, bob: 0.09, spacing: 26, trail: 2.6 };
const STREAK_SPEED = { ring: 7.5, spoke: 6.5, exit: 8, street: 6.5, link: 5 }; // old road flow speeds (streaks ran x1.3)
const droneVert = /* glsl */ `
  varying vec3 vLocal; varying vec3 vN; varying vec3 vView; varying vec3 vCol;
  #include <fog_pars_vertex>
  void main() {
    vLocal = position; vCol = instanceColor;
    vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
    vN = mat3(viewMatrix) * mat3(modelMatrix) * mat3(instanceMatrix) * normal;
    vView = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const droneFrag = /* glsl */ `
  uniform float uR;
  varying vec3 vLocal; varying vec3 vN; varying vec3 vView; varying vec3 vCol;
  #include <fog_pars_fragment>
  void main() {
    vec3 p = vLocal / uR;                         // unit sphere, +X forward
    vec3 N = vN / max(length(vN), 1e-6);
    float rim = pow(clamp(1.0 - abs(dot(N, normalize(vView))), 0.0, 1.0), 1.5);
    vec3 neon = vCol * 2.2 + vec3(0.02);
    // satin graphite-pearl shell tinted by the accent, lit from above (kept below bloom threshold)
    vec3 col = mix(vec3(0.07, 0.08, 0.13), vec3(0.42, 0.44, 0.52), smoothstep(-0.7, 0.95, p.y)) + vCol * 0.08;
    // two neon rings: equator band and a thin crown ring
    col = mix(col, neon, 1.0 - smoothstep(0.08, 0.13, abs(p.y + 0.02)));
    col = mix(col, neon * 0.8, (1.0 - smoothstep(0.03, 0.06, abs(p.y - 0.78))));
    // dark glossy visor across the front with one big glowing eye (+ halo)
    float visor = smoothstep(0.3, 0.42, p.x) * (1.0 - smoothstep(0.26, 0.34, abs(p.y - 0.4))) * (1.0 - smoothstep(0.62, 0.72, abs(p.z)));
    col = mix(col, vec3(0.005, 0.008, 0.025), visor);
    float ed = length(vec2(p.y - 0.4, p.z * 0.8));
    float eye = (1.0 - smoothstep(0.13, 0.19, ed)) * step(0.3, p.x);
    col += mix(neon, vec3(2.2, 2.6, 3.0), 0.55) * eye + neon * 0.3 * exp(-ed * ed / 0.05) * visor;
    // thruster glow on the underside
    col = mix(col, neon * 1.4 + vec3(0.3), smoothstep(-0.72, -0.9, p.y));
    col = mix(col, neon * 0.6, smoothstep(0.6, 0.95, rim) * 0.4);
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }`;
const dGlowVert = /* glsl */ `
  attribute float aKind;
  varying vec3 vLocal; varying vec3 vCol; varying float vKind;
  #include <fog_pars_vertex>
  void main() {
    vLocal = position; vCol = instanceColor; vKind = aKind;
    vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const dGlowFrag = /* glsl */ `
  uniform float uTrail; uniform float uR;
  varying vec3 vLocal; varying vec3 vCol; varying float vKind;
  #include <fog_pars_fragment>
  float sq(float a) { return a * a; }
  void main() {
    float x = vLocal.x, z = vLocal.z;
    vec3 col;
    if (vKind < 0.5) {
      // soft round light pool on the road under the drone
      float r2 = (x * x + z * z) / 0.55;
      col = vCol * exp(-r2 * 1.6) * 0.75 + vCol * exp(-r2 * 6.0) * 0.5;
    } else {
      // short light trail streaming from the back of the body, at body height
      float tb = clamp((-x - uR * 0.5) / uTrail, 0.0, 1.0);
      float w = mix(0.13, 0.03, tb);
      col = (vCol * 2.2 + vec3(0.12)) * exp(-sq(z / w)) * pow(1.0 - tb, 1.4) * step(x, -uR * 0.5);
    }
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        col *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        col *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
      #endif
    #endif
    gl_FragColor = vec4(col, 1.0);
  }`;

function buildDrones(ctx, TUNE = TUNE_VIEW) {
  const { scene, onTick, layout } = ctx;
  const roads = getRoadPaths(layout);
  const palette = ['#C06CFF', '#C06CFF', '#22D3EE', '#FF2D95', '#3A86FF', '#8B5CF6'];
  let seed = 4242;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const drones = [];
  for (const road of roads) {
    const base = STREAK_SPEED[road.kind];
    if (!base) continue;
    for (const lane of road.lanes) {
      const L = lane.length;
      if (L < 8) continue;
      const n = TUNE.droneDensity < 1 ? Math.floor((L / DRONE.spacing) * TUNE.droneDensity + rnd()) : Math.max(1, Math.round(L / DRONE.spacing));
      if (n <= 0) continue;
      const v = base * 1.3 * 2.5 * (0.92 + rnd() * 0.16) * TUNE.droneSpeed; // ~2.5x the old streaks
      const off = rnd();
      for (let i = 0; i < n; i++) {
        drones.push({ curve: lane.curve, L, closed: !!road.closed, u: (((i + off + (rnd() - 0.5) * 0.4) / n) % 1 + 1) % 1, v: v / L, ph: rnd() * 6.28, h: road.closed ? 0 : 0.4, color: palette[Math.floor(rnd() * palette.length)] });
      }
    }
  }
  const N = drones.length;
  const bodyGeo = new THREE.SphereGeometry(DRONE.r, 16, 12);
  bodyGeo.scale(1.05, 0.88, 1); // slightly squashed pebble
  const bodyMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uR: { value: DRONE.r } }]),
    vertexShader: droneVert, fragmentShader: droneFrag, fog: true,
  });
  const bodies = new THREE.InstancedMesh(ctx.game ? boardGeometry(1.3, 0.45, true) : bodyGeo, ctx.game ? boardMaterial() : bodyMat, N);
  // glow: ground pool (kind 0, just above the road) + trail (kind 1, at body height)
  const pool = new THREE.PlaneGeometry(1.8, 1.8).rotateX(-Math.PI / 2).translate(0, -DRONE.hover + 0.22, 0);
  const trail = new THREE.PlaneGeometry(DRONE.trail + 0.4, 0.5).rotateX(-Math.PI / 2).translate(-(DRONE.trail + 0.4) / 2, -0.03, 0);
  const tag = (g, k) => { g.setAttribute('aKind', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill(k), 1)); return g; };
  const glowGeo = mergeGeometries([tag(pool, 0), tag(trail, 1)]);
  const glowMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTrail: { value: DRONE.trail }, uR: { value: DRONE.r } }]),
    vertexShader: dGlowVert, fragmentShader: dGlowFrag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
  });
  const glows = new THREE.InstancedMesh(glowGeo, glowMat, N);
  const c = new THREE.Color();
  drones.forEach((d, i) => { c.set(d.color); bodies.setColorAt(i, c); glows.setColorAt(i, c); });
  for (const m of [bodies, glows]) {
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.name = 'drones';
    scene.add(m);
  }
  bodies.renderOrder = 5; glows.renderOrder = 4;

  const p = new THREE.Vector3(), tg = new THREE.Vector3();
  let time = 0;
  const step = (dt) => {
    time += dt;
    const bA = bodies.instanceMatrix.array, gA = glows.instanceMatrix.array;
    for (let i = 0; i < N; i++) {
      const d = drones[i];
      d.u = (d.u + d.v * dt) % 1;
      d.curve.getPointAt(d.u, p); d.curve.getTangentAt(d.u, tg);
      let s = 1;
      if (!d.closed) { const f = Math.min(1, Math.min(d.u, 1 - d.u) * d.L / 1.5); s = Math.max(0.002, f * f * (3 - 2 * f)); }
      const cx = tg.x, sx = tg.z, o = i * 16;
      const y = DRONE.hover + d.h + DRONE.bob * Math.sin(time * 3.1 + d.ph) + (p.y || 0);
      d.px = p.x; d.py = y; d.pz = p.z; d.dx = cx; d.dz = sx; d.vis = s > 0.6; // world pose, read by the game (hijacking)
      if (d.taken) { s = 0.0001; d.vis = false; } // stolen by the player: collapse out of sight until it is handed back
      for (const arr of [bA, gA]) {
        arr[o] = cx * s; arr[o + 1] = 0; arr[o + 2] = sx * s; arr[o + 3] = 0;
        // glow: stretch y so the pool (local y = -hover + 0.22) always lands on the road under higher fliers
        arr[o + 4] = 0; arr[o + 5] = arr === gA ? s * (y - 0.22) / (DRONE.hover - 0.22) : s; arr[o + 6] = 0; arr[o + 7] = 0;
        arr[o + 8] = -sx * s; arr[o + 9] = 0; arr[o + 10] = cx * s; arr[o + 11] = 0;
        arr[o + 12] = p.x; arr[o + 13] = y; arr[o + 14] = p.z; arr[o + 15] = 1;
      }
    }
    bodies.instanceMatrix.needsUpdate = true;
    glows.instanceMatrix.needsUpdate = true;
  };
  step(0);
  onTick((t, dt) => step(Math.min(dt, 0.1)));
  ctx.drones = drones; // the game hijacks these (floating bots)
  if (typeof window !== 'undefined') window.__auraDrones = { count: N };
}
