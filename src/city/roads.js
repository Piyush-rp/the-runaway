/*
 * Roads: rings, spokes, exits, side streets, roundabouts, junction nodes, street lamps.
 *
 * ---------------------------------------------------------------------------------------
 * export function getRoadPaths(layout) -> Road[]      (pure, builds no meshes, cached)
 *
 *   Road = {
 *     id:      string            e.g. 'ring1', 'ring2-arc-0', 'spoke-in-22.5', 'exit-90', 'rb-36', 'side-27'
 *     kind:    'ring' | 'spoke' | 'exit' | 'link' | 'roundabout' | 'side' | 'access' | 'street'
 *     (street = secondary roads between ring3 (r 84) and ring4 (r 150): 'street-ring-118' (full arc),
 *        'street-r-<deg>' connectors ring3 -> ring4, 'street-lane-<deg>' short dead-end parcel lanes)
 *     (access roads also carry: building (slot id), color (slot colour), part:
 *        'gate-in'  / 'gate-out'  every building: one-lane halves of a straight two-lane driveway from
 *                                 the host road to the entrance GATEWAY on the building's front wall
 *                                 (gate-in runs host -> wall, gate-out wall -> host; both carry `drive`
 *                                 and, after resolveDriveways(scene), `gate` = {x, z, nx, nz})
 *        'in' / 'out'             inner buildings only: forecourt arcs, clockwise spoke -> driveway and
 *                                 driveway -> counter-clockwise spoke)
 *     width:   number            asphalt width in world units
 *     closed:  boolean           true for full loops (ring0, ring1, roundabouts, side rings)
 *     length:  number            centre-line length in world units
 *     color:   string            main glow colour (hex)
 *     center:  THREE.Curve       centre line on the ground (y = 0), param t in [0,1]
 *     lanes:   Lane[]
 *   }
 *   Lane = {
 *     offset:  number            signed lateral offset from the centre line, + = right of the
 *                                road's own path direction (right-hand traffic)
 *     forward: boolean           true when the lane travels with the centre curve direction
 *     curve:   THREE.Curve       the lane itself, ALREADY oriented in its travel direction,
 *                                y = 0. Use curve.getPointAt(u) / getTangentAt(u), u in [0,1].
 *     length:  number
 *   }
 *   Vehicles should ride at y ~ 0.15 (roads are drawn between y 0.04 and 0.14).
 *
 * export function getJunctions(layout) -> [{ x, z, ring, deg, size, color }]
 * export function getLampPositions(layout) -> [{ x, z }]   (used by ground.js for light pools)
 * export function resolveDriveways(scene, layout) -> gate-in roads   (raycasts the real building walls
 *   once the buildings exist and trims every driveway to its wall; cached, call any time after)
 * ---------------------------------------------------------------------------------------
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const D2R = Math.PI / 180;

// Exact arc on the ground. deg is CCW from +X, polar(r,deg) = (cos*r, -sin*r).
class ArcCurve3 extends THREE.Curve {
  constructor(cx, cz, r, a0, a1, y = 0) {
    super();
    Object.assign(this, { cx, cz, r, a0, a1, y });
  }
  getPoint(t, target = new THREE.Vector3()) {
    const a = (this.a0 + (this.a1 - this.a0) * t) * D2R;
    return target.set(this.cx + Math.cos(a) * this.r, this.y, this.cz - Math.sin(a) * this.r);
  }
  // arc-length param == t for a circle
  getPointAt(u, target) { return this.getPoint(u, target); }
  getTangent(t, target = new THREE.Vector3()) {
    const a = (this.a0 + (this.a1 - this.a0) * t) * D2R;
    const s = Math.sign(this.a1 - this.a0) || 1;
    return target.set(-Math.sin(a) * s, 0, -Math.cos(a) * s).normalize();
  }
  getTangentAt(u, target) { return this.getTangent(u, target); }
  getLength() { return Math.abs(this.a1 - this.a0) * D2R * this.r; }
}

function lineCurve(x0, z0, x1, z1, y0 = 0, y1 = 0) {
  return new THREE.LineCurve3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
}

// lane offsets for a given width: 1 lane per direction for narrow roads, 2 for wide ones
function laneOffsets(width) {
  const h = width / 2;
  return width >= 2.7 ? [-h * 0.72, -h * 0.28, h * 0.28, h * 0.72] : [-h * 0.5, h * 0.5];
}

function makeLanes(road) {
  const c = road.center;
  return laneOffsets(road.width).map((offset) => {
    const forward = offset > 0;
    let curve;
    if (c instanceof ArcCurve3) {
      const sgn = Math.sign(c.a1 - c.a0) || 1; // CCW travel: right = outward
      const r = c.r + offset * sgn;
      curve = forward ? new ArcCurve3(c.cx, c.cz, r, c.a0, c.a1) : new ArcCurve3(c.cx, c.cz, r, c.a1, c.a0);
    } else {
      const a = c.v1, b = c.v2;
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
      const nx = -dz / L, nz = dx / L; // right normal
      const A = [a.x + nx * offset, a.z + nz * offset], B = [b.x + nx * offset, b.z + nz * offset];
      // y is carried through (all roads are currently flat at y = 0)
      curve = forward ? lineCurve(A[0], A[1], B[0], B[1], a.y, b.y) : lineCurve(B[0], B[1], A[0], A[1], b.y, a.y);
    }
    return { offset, forward, curve, length: curve.getLength() };
  });
}

// outer spokes that nearly coincide with an inner spoke share its ring1 junction
function snapInner(layout, d) {
  for (const di of layout.SPOKES.inner) {
    const x = Math.abs(((d - di) % 360 + 540) % 360 - 180);
    if (x < 7) return di;
  }
  return d;
}

// layout.ROUNDABOUTS[].size is the nominal radius; the reference roundabouts are a bit tighter
const RB_SCALE = 0.78;
const RB_WIDTH = 1.5;

// secondary street network of the outer zone (between ring3 r 84 and ring4 r 150)
export const STREET = {
  width: 2.2, laneWidth: 1.7,
  ring: 118,                                             // full secondary arc
  connectors: [18, 63, 117, 162, 198, 243, 297, 342],    // midway between the exits, ring3 -> ring4
  // short dead-end access lanes into the big parcels: [deg, end radius] from the r 118 arc
  lanes: [[49.5, 133], [130.5, 133], [229.5, 133], [310.5, 133], [76.5, 103], [103.5, 103], [256.5, 103], [283.5, 103]],
};

let _cache = null;
export function getRoadPaths(layout) {
  if (_cache && _cache.layout === layout) return _cache.roads;
  const { RINGS, ROAD_WIDTH: W, SPOKES, ROUNDABOUTS, ROAD_COLORS: C, WORLD_SIZE } = layout;
  const hasRing0 = layout.HAS_RING0_ROAD !== false;
  const PLAT = layout.CORE_PLATFORM || { radius: RINGS.ring0 + W.ring0 / 2, height: 0 };
  const roads = [];
  const add = (r) => { r.length = r.center.getLength(); r.lanes = makeLanes(r); roads.push(r); };
  const P = (r, d) => { const a = d * D2R; return [Math.cos(a) * r, -Math.sin(a) * r]; };
  const radial = (id, kind, deg, r0, r1, width, color, deg0 = deg) => {
    const [x0, z0] = P(r0, deg0), [x1, z1] = P(r1, deg);
    add({ id, kind, deg, width, color, closed: false, center: lineCurve(x0, z0, x1, z1) });
  };

  // main rings (ring0 only when the layout still has a road hugging the core)
  if (hasRing0) add({ id: 'ring0', kind: 'ring', width: W.ring0, color: C.ring0, closed: true, radius: RINGS.ring0, center: new ArcCurve3(0, 0, RINGS.ring0, 0, 360) });
  add({ id: 'ring1', kind: 'ring', width: W.ring1, color: C.ring1, closed: true, radius: RINGS.ring1, center: new ArcCurve3(0, 0, RINGS.ring1, 0, 360) });

  // ring2 is split into arcs between the roundabouts
  const R2 = RINGS.ring2;
  const rbDeg = ROUNDABOUTS.map((r) => r.deg).sort((a, b) => a - b);
  const rbSize = (ROUNDABOUTS[0]?.size ?? 3.6) * RB_SCALE; // outer asphalt radius
  const trim = ((rbSize + 0.3) / R2) / D2R;
  rbDeg.forEach((d, i) => {
    const next = i + 1 < rbDeg.length ? rbDeg[i + 1] : rbDeg[0] + 360;
    add({ id: `ring2-arc-${i}`, kind: 'ring', width: W.ring2, color: C.ring2, closed: false, radius: R2, center: new ArcCurve3(0, 0, R2, d + trim, next - trim) });
  });
  if (!rbDeg.length) add({ id: 'ring2', kind: 'ring', width: W.ring2, color: C.ring2, closed: true, radius: R2, center: new ArcCurve3(0, 0, R2, 0, 360) });

  // roundabouts
  for (const rb of ROUNDABOUTS) {
    const [x, z] = P(rb.r, rb.deg);
    const rr = rb.size * RB_SCALE - RB_WIDTH / 2;
    add({ id: `rb-${rb.deg}`, kind: 'roundabout', width: RB_WIDTH, color: C.ring1, closed: true, radius: rr, cx: x, cz: z, center: new ArcCurve3(x, z, rr, rb.deg - 180, rb.deg + 180) });
  }
  const isRb = (deg) => ROUNDABOUTS.some((rb) => Math.abs(((deg - rb.deg) % 360 + 540) % 360 - 180) < 0.5);

  if (hasRing0) {
    // short links core plaza -> ring0 (N/E/S/W)
    for (const d of [0, 90, 180, 270]) radial(`link-${d}`, 'link', d, RINGS.core - 0.2, RINGS.ring0 - W.ring0 / 2 + 0.15, 1.7, C.spoke);
    // inner spokes ring0 -> ring1
    for (const d of SPOKES.inner) radial(`spoke-in-${d}`, 'spoke', d, RINGS.ring0 + W.ring0 / 2 - 0.15, RINGS.ring1 - W.ring1 / 2 + 0.15, W.spoke, C.spoke);
  } else {
    // inner spokes run flat (y = 0) straight from ring1 inward to the core platform's side wall
    // (r = CORE_PLATFORM.radius), where the core module draws a glowing portal. The centre curve
    // points inward so the flowing light pulses run into the portal.
    for (const d of SPOKES.inner) radial(`spoke-in-${d}`, 'spoke', d, RINGS.ring1 - W.ring1 / 2 + 0.15, PLAT.radius, W.spoke, C.spoke);
  }
  // outer spokes ring1 -> ring2 (or roundabout)
  for (const d of SPOKES.outer) {
    const end = isRb(d) ? R2 - rbSize - 0.6 : R2 - W.ring2 / 2 + 0.15;
    radial(`spoke-out-${d}`, 'spoke', d, RINGS.ring1 + W.ring1 / 2 - 0.15, end, W.spoke, C.spoke, snapInner(layout, d));
  }
  // exits ring2 -> map edge; they cross the outer main ring (ring3) at junction nodes (user 10-30)
  const OR = layout.OUTER_RING;
  const edge = WORLD_SIZE / 2;
  for (const d of SPOKES.exits) {
    const start = isRb(d) ? R2 + rbSize + 0.6 : R2 + W.ring2 / 2 - 0.15;
    const a = d * D2R;
    // user 10-31: every exit ENDS at the edge ring (r 150, T-junction); nothing runs beyond it
    const far = layout.EDGE_RING ? layout.EDGE_RING.radius : edge / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
    radial(`exit-${d}`, 'exit', d, start, far, W.exit, C.exit);
  }
  // side streets (narrow, warm-lit service rings between the main rings)
  // (the ring0+3.4 service ring would cross the core platform and the ring1+3.9 one crowded the
  //  outer driveways, so both only exist in the old ring0 layout)
  const sides = hasRing0 ? [
    [RINGS.ring0 + 3.4, 1.15, C.cyan], [RINGS.ring1 - 3.6, 1.2, C.warm],
    [RINGS.ring1 + 3.9, 1.3, C.ring0], [RINGS.ring2 - 4.1, 1.35, C.warm],
  ] : [[RINGS.ring1 - 3.6, 1.2, C.warm], [RINGS.ring2 - 4.1, 1.35, C.warm]];
  for (const [r, w, col] of sides) add({ id: `side-${r.toFixed(1)}`, kind: 'side', width: w, color: col, closed: true, radius: r, center: new ArcCurve3(0, 0, r, 0, 360) });
  // outer MAIN ring (user 10-30): same look as ring2, the exits cross it
  if (OR) add({ id: 'ring3', kind: 'ring', width: OR.width, color: C.ring2, closed: true, radius: OR.radius, center: new ArcCurve3(0, 0, OR.radius, 0, 360) });
  else add({ id: 'ring3', kind: 'side', width: 2.4, color: C.ring1, closed: true, radius: 84, center: new ArcCurve3(0, 0, 84, 0, 360) });
  // edge MAIN ring (user 10-31): closes the structure at r 150 (layout.EDGE_RING), every building inside it.
  // Same look as ring2/ring3. All 8 exits END at it (T-junctions).
  const ER = layout.EDGE_RING;
  if (ER) add({ id: 'ring4', kind: 'ring', width: ER.width, color: C.ring2, closed: true, radius: ER.radius, center: new ArcCurve3(0, 0, ER.radius, 0, 360) });
  // secondary streets in the outer zone r 84 .. r 150 (user 10-31): narrower, same neon look as the
  // spokes. Nothing reaches beyond ring4's centre line.
  if (ER && OR) {
    const SW = STREET.width, SR = STREET.ring;
    add({ id: `street-ring-${SR}`, kind: 'street', width: SW, color: C.spoke, closed: true, radius: SR, center: new ArcCurve3(0, 0, SR, 0, 360) });
    for (const d of STREET.connectors) radial(`street-r-${d}`, 'street', d, OR.radius + OR.width / 2 - 0.15, ER.radius - ER.width / 2 + 0.15, SW, C.spoke);
    for (const [d, r1] of STREET.lanes) {
      const r0 = r1 > SR ? SR + SW / 2 - 0.15 : SR - SW / 2 + 0.15;
      radial(`street-lane-${d}`, 'street', d, r0, r1, STREET.laneWidth, C.spoke);
    }
  }

  // access roads (user 10-30: bots drive INTO each building through a gateway and later come out):
  //  every building: a short straight two-lane driveway on its axis (b.deg) from the host road to the
  //    building's front wall, split into two one-lane roads:
  //      'gate-in'  host -> wall (inbound lane, right-hand side), 'gate-out' wall -> host (outbound lane).
  //    They carry: drive {x0,z0,x1,z1,width} (the shared two-lane centre line) and, once
  //    resolveDriveways(scene) has raycast the real wall, gate {x,z,nx,nz} (gateway centre + outward normal).
  //    Until then the wall end is the nominal front (slot r - footprint/2).
  //  outer slots: host = ring1.
  //  inner slots (no ring0): host = the one-way forecourt lane across the building front that links the
  //    two neighbouring inner spokes; 'in' arc leaves the clockwise spoke and ends at the driveway,
  //    'out' arc starts at the driveway and joins the counter-clockwise spoke.
  const angN = (d) => ((d % 360) + 360) % 360;
  const DRIVE_W = 1.8;
  const gateRoads = (b, rHost) => {
    const front = b.r - b.footprint / 2;
    const [x0, z0] = P(rHost, b.deg), [x1, z1] = P(front, b.deg);
    const drive = { x0, z0, x1, z1, width: DRIVE_W };
    const L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L;
    const nx = -uz, nz = ux, o = DRIVE_W / 4; // right normal of the inbound direction
    for (const [part, sgn] of [['gate-in', 1], ['gate-out', -1]]) {
      const ax = x0 + nx * o * sgn, az = z0 + nz * o * sgn, bx = x1 + nx * o * sgn, bz = z1 + nz * o * sgn;
      const center = part === 'gate-in' ? lineCurve(ax, az, bx, bz) : lineCurve(bx, bz, ax, az);
      const r = { id: `access-${b.id}-${part}`, kind: 'access', part, building: b.id, deg: b.deg, width: DRIVE_W / 2, color: b.color, closed: false, drive, center };
      r.length = center.getLength();
      r.lanes = [{ offset: 0, forward: true, curve: center, length: r.length }];
      roads.push(r);
    }
  };
  for (const b of layout.BUILDINGS) {
    const inner = b.ring === 'inner';
    const col = b.color;
    const front = b.r - b.footprint / 2;
    if (inner && !hasRing0) {
      const wA = 1.2;
      const rA = Math.max(PLAT.radius + 1.6, front - wA / 2 - 1.2);
      const bd = angN(b.deg);
      let lo = -Infinity, hi = Infinity;
      for (const sd of SPOKES.inner) {
        let x = angN(sd) - bd; if (x > 180) x -= 360; if (x < -180) x += 360;
        if (x < 0 && x > lo) lo = x;
        if (x > 0 && x < hi) hi = x;
      }
      const sp = ((W.spoke / 2 - 0.1) / rA) / D2R;
      const a0 = b.deg + lo + sp, a3 = b.deg + hi - sp;
      const dG = ((DRIVE_W / 2) / rA) / D2R; // forecourt arcs stop at the driveway edges
      const arc = (part, x0, x1) => add({ id: `access-${b.id}-${part}`, kind: 'access', part, building: b.id, deg: b.deg, width: wA, color: col, closed: false, radius: rA, cx: 0, cz: 0, arcOnly: true, center: new ArcCurve3(0, 0, rA, x0, x1) });
      arc('in', a0, b.deg - dG);
      arc('out', b.deg + dG, a3);
      gateRoads(b, rA - wA / 2 + 0.05);
      continue;
    }
    const host = inner ? RINGS.ring0 + W.ring0 / 2 - 0.15 : RINGS.ring1 + W.ring1 / 2 - 0.15;
    gateRoads(b, host);
  }

  _cache = { layout, roads };
  return roads;
}

// junction nodes where spokes meet rings
export function getJunctions(layout) {
  const { RINGS, SPOKES, ROUNDABOUTS } = layout;
  const out = [];
  const seen = new Set();
  const push = (ring, deg, size, color, type = 'cross') => {
    const key = ring + ':' + (((deg % 360) + 360) % 360).toFixed(1);
    if (seen.has(key)) return;
    seen.add(key);
    const a = deg * D2R, r = ring === 'ring3' ? layout.OUTER_RING.radius : ring === 'ring4' ? layout.EDGE_RING.radius : RINGS[ring];
    out.push({ x: Math.cos(a) * r, z: -Math.sin(a) * r, ring, deg, size, color, type });
  };
  const rb = new Set(ROUNDABOUTS.map((r) => (((r.deg % 360) + 360) % 360).toFixed(1)));
  const hasRing0 = layout.HAS_RING0_ROAD !== false;
  if (hasRing0) for (const d of [0, 90, 180, 270]) push('ring0', d, 1.3, '#A855F7');
  for (const d of SPOKES.inner) { if (hasRing0) push('ring0', d, 1.3, '#00E5FF'); push('ring1', d, 1.9, '#00E5FF'); }
  for (const d of SPOKES.outer) {
    push('ring1', snapInner(layout, d), 1.9, '#00E5FF');
    if (!rb.has((((d % 360) + 360) % 360).toFixed(1))) push('ring2', d, 2.7, d > 150 && d < 260 ? '#A855F7' : '#00E5FF');
  }
  for (const d of SPOKES.exits) if (!rb.has((((d % 360) + 360) % 360).toFixed(1))) push('ring2', d, 2.7, '#00E5FF');
  // exits cross the outer main ring
  if (layout.OUTER_RING) for (const d of SPOKES.exits) push('ring3', d, 2.7, '#00E5FF');
  // edge ring (r 150): every exit ends at it (T-junctions)
  if (layout.EDGE_RING) for (const d of SPOKES.exits) push('ring4', d, 2.7, '#00E5FF', 'T');
  // secondary streets: connectors T into ring3 and ring4 and cross the r 118 arc; the arc crosses
  // every exit; parcel lanes T off the arc
  if (layout.EDGE_RING && layout.OUTER_RING) {
    const at = (r, d, size, type) => {
      const key = 'st' + r + ':' + (((d % 360) + 360) % 360).toFixed(1);
      if (seen.has(key)) return; seen.add(key);
      const a = d * D2R;
      out.push({ x: Math.cos(a) * r, z: -Math.sin(a) * r, ring: r === STREET.ring ? 'street' : r === layout.EDGE_RING.radius ? 'ring4' : 'ring3', deg: d, size, color: '#00E5FF', type });
    };
    for (const d of STREET.connectors) { at(layout.OUTER_RING.radius, d, 2.2, 'T'); at(STREET.ring, d, 1.9, 'cross'); at(layout.EDGE_RING.radius, d, 2.2, 'T'); }
    for (const d of SPOKES.exits) at(STREET.ring, d, 2.0, 'cross');
    for (const [d] of STREET.lanes) at(STREET.ring, d, 1.5, 'T');
  }
  return out;
}

export function getLampPositions(layout) {
  const out = [];
  for (const road of getRoadPaths(layout)) {
    if (road.kind === 'access' && road.part?.startsWith('gate')) continue; // short driveways: no lamps
    const spacing = road.kind === 'access' ? 2.2 : road.kind === 'side' ? 4.2 : road.kind === 'roundabout' ? 2.6 : road.kind === 'exit' || road.kind === 'street' ? 4.6 : 3.6;
    const n = Math.max(2, Math.round(road.length / spacing));
    const off = road.width / 2 + 0.45;
    const p = new THREE.Vector3(), t = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const u = road.closed ? i / n : (i + 0.5) / n;
      road.center.getPointAt(u, p);
      road.center.getTangentAt(u, t);
      const nx = -t.z, nz = t.x;
      // alternate sides on narrow roads, both sides on main roads
      if (road.kind === 'access') { if (i % 2) continue; }
      const sides = road.kind === 'side' || road.kind === 'roundabout' || road.kind === 'access' ? [i % 2 ? 1 : -1] : [1, -1];
      for (const s of sides) {
        const x = p.x + nx * off * s, z = p.z + nz * off * s;
        // nothing outside the last ring (user 10-31): ring4 keeps only its inner-side lamps
        if (road.id === 'ring4' && Math.hypot(x, z) > road.radius) continue;
        out.push({ x, z });
      }
    }
  }
  return out;
}

// Find each building's real front wall: raycast from the driveway start along its axis at y 0.5
// toward the building, take the first near-vertical face of that building's meshes, and trim the
// two driveway halves to it. Buildings with no hit keep the nominal front. Cached per layout.
const GATE_DEPTH = 0.9; // bots run this far past the wall, fading out inside the gateway
let _gates = null;
export function resolveDriveways(scene, layout) {
  if (_gates && _gates.layout === layout) return _gates.list;
  const roads = getRoadPaths(layout);
  const list = [];
  const ray = new THREE.Raycaster();
  const o = new THREE.Vector3(), d = new THREE.Vector3(), nW = new THREE.Vector3();
  let found = 0;
  for (const gin of roads.filter((r) => r.part === 'gate-in')) {
    const gout = roads.find((r) => r.part === 'gate-out' && r.building === gin.building);
    const dr = gin.drive;
    const b = layout.BUILDINGS.find((x) => x.id === gin.building);
    const grp = scene.getObjectByName('building:' + gin.building);
    const [cx, cz] = [Math.cos(b.deg * D2R) * b.r, -Math.sin(b.deg * D2R) * b.r];
    const L0 = Math.hypot(dr.x1 - dr.x0, dr.z1 - dr.z0);
    const ux = (dr.x1 - dr.x0) / L0, uz = (dr.z1 - dr.z0) / L0;
    let dist = L0, nx = -ux, nz = -uz, hit = false;
    if (grp) {
      grp.updateMatrixWorld(true);
      o.set(dr.x0, 0.5, dr.z0); d.set(ux, 0, uz);
      ray.set(o, d); ray.far = Math.hypot(cx - dr.x0, cz - dr.z0) + 2;
      const meshes = [];
      grp.traverse((m) => { if (m.isMesh && m.visible && !m.isInstancedMesh && m.material && !m.material.transparent) meshes.push(m); });
      for (const h of ray.intersectObjects(meshes, false)) {
        if (!h.face || h.distance < 1.2) continue;
        nW.copy(h.face.normal).transformDirection(h.object.matrixWorld);
        if (Math.abs(nW.y) > 0.5) continue;               // floors, lawns, roofs
        dist = h.distance;
        const hl = Math.hypot(nW.x, nW.z);
        if (nW.x * -ux + nW.z * -uz > 0.3 * hl) { nx = nW.x / hl; nz = nW.z / hl; }
        if (nx * -ux + nz * -uz < 0) { nx = -nx; nz = -nz; }
        found++; hit = true;
        break;
      }
    }
    dr.x1 = dr.x0 + ux * dist; dr.z1 = dr.z0 + uz * dist;
    // trim both halves (+ the lane curves, which are the same objects) to the wall
    const off = gin.width / 2, rx = -uz * off, rz = ux * off;
    gin.center.v1.set(dr.x0 + rx, 0, dr.z0 + rz); gin.center.v2.set(dr.x1 + rx, 0, dr.z1 + rz);
    gout.center.v1.set(dr.x1 - rx, 0, dr.z1 - rz); gout.center.v2.set(dr.x0 - rx, 0, dr.z0 - rz);
    for (const r of [gin, gout]) { r.length = r.center.getLength(); r.lanes[0].length = r.length; }
    const gate = { x: dr.x1, z: dr.z1, nx, nz, ux, uz, color: gin.color, building: gin.building, hit };
    gin.gate = gout.gate = gate;
    list.push(gin);
  }
  _gates = { layout, list, found };
  return list;
}
export { GATE_DEPTH };

// ---------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------
const Y = { drive: 0.12, side: 0.04, access: 0.05, street: 0.065, exit: 0.06, link: 0.07, spoke: 0.08, ring: 0.11, roundabout: 0.14 };
const MARGIN = 0.7; // glow spill beyond the asphalt edge

const roadVert = /* glsl */ `
attribute float aS;
attribute float aV;
attribute float aHalf;
attribute vec4 aParam; // x intensity, y mode (0 plain, 1 one lane/dir, 2 two lanes/dir), z flow speed, w seed
attribute vec3 aCol;   // main neon colour (lane dashes)
attribute vec3 aCol2;  // edge accent colour (+side) ; inner edge uses aCol
varying float vS; varying float vV; varying float vHalf; varying vec4 vParam; varying vec3 vColor; varying vec3 vColor2;
varying vec2 vWorld; varying float vFogDepth;
void main() {
  vS = aS; vV = aV; vHalf = aHalf; vParam = aParam; vColor = aCol; vColor2 = aCol2;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xz;
  vec4 mv = viewMatrix * wp;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const roadFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying float vS; varying float vV; varying float vHalf; varying vec4 vParam; varying vec3 vColor; varying vec3 vColor2;
varying vec2 vWorld; varying float vFogDepth;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float line(float d, float w, float aa) { return 1.0 - smoothstep(w, w + aa, d); }
float gauss(float d, float w) { return exp(-d * d / (w * w)); }
// soft clip on the brightest channel only: keeps hue and saturation instead of washing out to white
vec3 keepHue(vec3 c, float knee, float lim) {
  float m = max(c.r, max(c.g, c.b));
  if (m <= knee) return c;
  float m2 = knee + (lim - knee) * (1.0 - exp(-(m - knee) / (lim - knee)));
  return c * (m2 / m);
}
void main() {
  float h = vHalf;
  float as = abs(vS);
  float aa = max(fwidth(vS), 0.004) * 1.2;
  float inten = vParam.x;
  float mode = vParam.y;
  float neon = step(0.5, mode);
  float rbm = step(3.5, mode);
  float access = step(2.5, mode) * (1.0 - rbm);
  float twoLane = step(1.5, mode) * (1.0 - access) * (1.0 - rbm);
  float inside = 1.0 - smoothstep(h - aa, h + aa, as);
  float seed = vParam.w;

  // asphalt: dark navy with fine grain (reference roads read deep blue-black)
  float grain = (hash(floor(vWorld * 12.0)) - 0.5) * 0.004;
  vec3 asphalt = vec3(0.009, 0.011, 0.027) + grain;
  vec3 glowC = vColor;
  vec3 edgeC = vS > 0.0 ? vColor2 : vColor;

  // pale thin curb lines at the asphalt edge
  float curb = line(abs(as - (h - 0.05)), 0.03, aa);

  vec3 col = asphalt * inside;
  if (access > 0.5) {
    // building driveway: thin neon edges in the building colour, slow pulse toward the building
    float ePos = h - 0.12;
    float eCore = line(abs(as - ePos), 0.03, aa);
    float eHalo = gauss(as - ePos, 0.14);
    col += vColor2 * (eCore * 0.9 + eHalo * 0.15) * inten;
    float fx = vV - uTime * vParam.z + seed * 9.0;
    float ph = fract(fx / 5.0);
    float pulse = smoothstep(0.55, 0.9, ph) * (1.0 - smoothstep(0.9, 0.97, ph));
    col += vColor2 * gauss(as, 0.16) * (0.08 + 1.1 * pulse) * inten * inside;
    float f = fract(vV / 0.9 + seed);
    col += vColor2 * line(as, 0.03, aa) * step(0.5, f) * 0.25 * inten;
    col += vec3(0.06, 0.055, 0.085) * curb;
  } else if (neon > 0.5) {
    // flowing brightness wave that travels along the road (sheet "Flowing Light")
    float fx = vV - uTime * vParam.z + seed * 40.0;
    float wave = 0.65 + 0.35 * sin(fx * 0.35) ;
    float pulse = smoothstep(0.0, 0.7, fract(fx / 16.0)) * (1.0 - smoothstep(0.7, 0.78, fract(fx / 16.0)));

    // neon edge tube just inside each curb (solid, accent colour on the + side)
    float ePos = h - 0.17;
    float eCore = line(abs(as - ePos), 0.05, aa);
    float eHalo = gauss(as - ePos, mix(0.20, 0.13, rbm));
    float eSide = vS > 0.0 ? 1.0 : 0.92;
    col += edgeC * (eCore * 2.0 + eHalo * 0.42) * eSide * inten * (0.88 + 0.3 * wave) * (1.0 - rbm * 0.25);

    // main lane divider: long bright neon dashes on the centre line with white-hot core
    float f = fract(vV / 1.55 + seed);
    float dash = smoothstep(0.0, 0.05, f) * (1.0 - smoothstep(0.62, 0.68, f)) * (1.0 - rbm * 0.85);
    float cCore = line(as, 0.075, aa);
    float cHalo = gauss(as, 0.3);
    float boost = 1.0 + 1.6 * pulse;
    col += glowC * (cCore * 1.8 + cHalo * 0.3) * dash * inten * boost * wave;
    col += mix(glowC, vec3(1.0), 0.3) * line(as, 0.02, aa) * dash * 0.14 * inten * (0.5 + 0.5 * pulse);
    col += glowC * gauss(as, 0.6) * 0.045 * inten * inside;

    // two-lane roads: faint pale dashed lane lines
    float lf = step(0.55, fract(vV / 1.2 + 0.3));
    col += vec3(0.10, 0.10, 0.14) * line(abs(as - h * 0.5), 0.025, aa) * lf * twoLane;

    // (the short travelling light streaks were replaced by real floating drones in vehicles.js, user 11-01)

    col += vec3(0.07, 0.065, 0.10) * curb;

  } else {
    // plain service street: grey curbs, faint warm worn dashes
    col += vec3(0.05, 0.048, 0.07) * curb;
    col += vec3(0.07, 0.055, 0.035) * line(as, 0.03, aa) * step(0.5, fract(vV / 1.3)) * inten;
    col += glowC * gauss(as - (h - 0.12), 0.05) * 0.10 * inten;
  }

  // soft neon spill onto the sidewalk outside the asphalt
  float outside = max(as - h, 0.0);
  float spill = exp(-outside * 3.6) * (1.0 - inside) * neon;
  col += edgeC * spill * 0.34 * inten;
  float alpha = max(inside, spill * 0.5);

  col = keepHue(col, 0.8, 1.9);
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
  col = mix(col, uFogColor, fogF);
  gl_FragColor = vec4(col, alpha);
}`;

const nodeVert = /* glsl */ `
attribute vec3 aColor;
attribute vec2 aNode; // x kind (0 junction, 1 roundabout island), y phase
varying vec2 vUv; varying vec3 vColor; varying vec2 vNode;
void main() {
  vUv = uv; vColor = aColor; vNode = aNode;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const nodeFrag = /* glsl */ `
uniform float uTime;
varying vec2 vUv; varying vec3 vColor; varying vec2 vNode;
float ring(float r, float c, float w) { return exp(-pow((r - c) / w, 2.0)); }
void main() {
  float r = length(vUv - 0.5) * 2.0; // 0 centre, 1 quad edge
  if (r > 1.0) discard;
  float t = uTime + vNode.y * 6.0;
  vec3 c = vColor;
  vec3 col = vec3(0.0);
  float a = 0.0;
  if (vNode.x < 0.5) {
    // junction node (sheet "Junction Node"): bright cyan-white ring, dark navy disc,
    // glowing hot centre and a soft expanding pulse
    float pulse = fract(t * 0.45);
    float R = 0.7;
    col += mix(c, vec3(1.0), 0.2) * ring(r, R, 0.03) * 1.15;
    col += c * ring(r, R, 0.12) * 0.16;
    col += mix(c, vec3(1.0), 0.5) * exp(-r * r / 0.010) * 1.6 * (0.85 + 0.15 * sin(t * 3.0));
    col += c * exp(-r * r / 0.07) * 0.22;
    col += c * ring(r, R + pulse * 0.25, 0.025) * (1.0 - pulse) * 0.25;
    a = smoothstep(R + 0.06, R - 0.02, r) * 0.85;
  } else {
    // roundabout island (sheet "Roundabout"): dark disc, concentric bright blue rings,
    // white-blue centre light and a slow outward pulse
    float pulse = fract(t * 0.3);
    col += mix(c, vec3(1.0), 0.3) * ring(r, 0.94, 0.018) * 2.4;
    col += c * ring(r, 0.94, 0.07) * 0.12;
    col += mix(c, vec3(1.0), 0.2) * ring(r, 0.66, 0.018) * 1.2;
    col += c * ring(r, 0.42, 0.016) * 0.6;
    col += mix(c, vec3(1.0), 0.35) * exp(-r * r / 0.006) * 3.0 + c * exp(-r * r / 0.03) * 1.6;
    col += c * exp(-r * r / 0.05) * 1.3;
    col += c * ring(r, 0.15 + pulse * 0.8, 0.03) * (1.0 - pulse) * 0.6;
    a = smoothstep(0.99, 0.93, r) * 0.9;
  }
  // premultiplied: dark base under the glow
  gl_FragColor = vec4(col, a);
}`;

const lampVert = /* glsl */ `
uniform float uScale;
uniform float uTime;
attribute float aSeed;
varying float vFlick;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFlick = 0.85 + 0.15 * sin(uTime * (1.5 + aSeed * 2.0) + aSeed * 30.0);
  gl_PointSize = 0.5 * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const lampFrag = /* glsl */ `
uniform vec3 uColor;
varying float vFlick;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  float core = exp(-r * r * 10.0);
  float halo = exp(-r * 3.5) * 0.3;
  gl_FragColor = vec4(uColor * (core * 2.4 + halo) * vFlick, 1.0);
}`;

function lin(hex) { return new THREE.Color(hex); }
const HUE = {
  blue: lin('#2961FF'), purple: lin('#9A48FF'), pink: lin('#FF2D95'), cyan: lin('#22D3EE'),
  warm: lin('#FF9F1C'), violet: lin('#8350FF'),
};
const angDist = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
const bumpAt = (d, c, w) => { const x = angDist(d, c); return Math.exp(-(x * x) / (w * w)); };

// main neon colour along the rings: mostly blue with purple stretches like the reference
function ringColor(id, deg) {
  const d = ((deg % 360) + 360) % 360;
  if (id === 'ring0') return HUE.purple.clone().lerp(HUE.blue, 0.3 + 0.3 * Math.sin(d * D2R * 4));
  if (id === 'ring1') {
    return HUE.blue.clone()
      .lerp(HUE.purple, Math.min(1, 0.45 * bumpAt(d, 140, 14) + 0.4 * bumpAt(d, 215, 12)))
      .lerp(HUE.warm, 0.3 * bumpAt(d, 90, 6) + 0.25 * bumpAt(d, 270, 6));
  }
  // ring2: blue, purple on the west / north-west and south arcs
  const c = HUE.blue.clone().lerp(HUE.purple, Math.min(1, 0.85 * bumpAt(d, 185, 24) + 0.6 * bumpAt(d, 118, 12) + 0.7 * bumpAt(d, 290, 14)));
  return c.lerp(HUE.pink, 0.4 * bumpAt(d, 200, 10));
}
// edge accent colour (outer edge of the rings): purple / pink / orange segments
function ringEdge(id, deg) {
  const d = ((deg % 360) + 360) % 360;
  if (id === 'ring0') return HUE.purple.clone().lerp(HUE.warm, 0.45 * bumpAt(d, 270, 25) + 0.35 * bumpAt(d, 90, 20));
  if (id === 'ring1') return HUE.blue.clone().lerp(HUE.violet, 0.5 * bumpAt(d, 150, 25) + 0.4 * bumpAt(d, 220, 20)).lerp(HUE.pink, 0.4 * bumpAt(d, 200, 10)).lerp(HUE.warm, 0.4 * bumpAt(d, 250, 7));
  return HUE.blue.clone().lerp(HUE.purple, Math.min(1, 0.9 * bumpAt(d, 185, 32) + 0.7 * bumpAt(d, 120, 14) + 0.75 * bumpAt(d, 290, 18)))
    .lerp(HUE.pink, 0.5 * bumpAt(d, 160, 10) + 0.45 * bumpAt(d, 300, 10)).lerp(HUE.warm, 0.4 * bumpAt(d, 230, 8));
}

function ribbonGeometry(road, opts) {
  const { width, center } = road;
  const h = width / 2, half = h + MARGIN;
  const segLen = center instanceof ArcCurve3 ? 0.7 : 4;
  const n = Math.max(1, Math.ceil(road.length / segLen));
  const pos = [], aS = [], aV = [], aHalf = [], col = [], col2 = [], par = [], idx = [];
  const p = new THREE.Vector3(), t = new THREE.Vector3();
  const y = Y[road.kind] ?? 0.05;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    center.getPointAt(u, p); center.getTangentAt(u, t);
    const nx = -t.z, nz = t.x;
    let c = opts.color, c2 = opts.edge || opts.color;
    if (road.kind === 'ring') {
      const deg = Math.atan2(-p.z, p.x) / D2R;
      const id = road.id.startsWith('ring2') ? 'ring2' : road.id;
      c = ringColor(id, deg);
      c2 = ringEdge(id, deg);
    }
    for (const s of [-half, half]) {
      pos.push(p.x + nx * s, y + p.y, p.z + nz * s);
      aS.push(s); aV.push(u * road.length); aHalf.push(h);
      col.push(c.r, c.g, c.b);
      col2.push(c2.r, c2.g, c2.b);
      par.push(opts.intensity, opts.rb ? 4 : opts.access ? 3 : opts.plain ? 0 : width >= 2.7 ? 2 : 1, opts.speed, opts.seed);
    }
    if (i < n) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 1));
  g.setAttribute('aV', new THREE.Float32BufferAttribute(aV, 1));
  g.setAttribute('aHalf', new THREE.Float32BufferAttribute(aHalf, 1));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aCol2', new THREE.Float32BufferAttribute(col2, 3));
  g.setAttribute('aParam', new THREE.Float32BufferAttribute(par, 4));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------------------------------
// Centre light beam on every road (user 11-01): the same glowing strip with travelling pulses that
// core.js draws on the inner spokes ("connection beams"), copied shader-for-shader and laid down each
// road's centre line. One merged ribbon mesh (plus one for the driveways), one shared material.
// Per vertex: aCyc = distance along / pulse spacing (cycles, seamless on closed loops), aAcross -1..1,
// aEnds = (distance along, road length or -1 when closed) for the end fades, aBeam = colour, aSeed.
// ---------------------------------------------------------------------------------------
const BEAM = { spacing: 5.1, width: 1.6, k: 1.5, lift: 0.06 }; // core: 3 pulses over a 15.3 spoke, 1.6 wide, colour x1.5
const beamVert = /* glsl */ `
attribute float aCyc; attribute float aAcross; attribute vec2 aEnds; attribute vec3 aBeam; attribute float aSeed;
varying float vCyc; varying float vAcross; varying vec2 vEnds; varying vec3 vBeam; varying float vSeed; varying float vFogDepth;
void main() {
  vCyc = aCyc; vAcross = aAcross; vEnds = aEnds; vBeam = aBeam; vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const beamFrag = /* glsl */ `
uniform float uTime; uniform float uFogDensity;
varying float vCyc; varying float vAcross; varying vec2 vEnds; varying vec3 vBeam; varying float vSeed; varying float vFogDepth;
void main() {
  float x = vAcross;
  float prof = exp(-x*x*60.0) * 1.6 + exp(-x*x*6.0) * 0.35;
  float fade = 1.0;
  if (vEnds.y > 0.0) fade = smoothstep(0.0, 0.9, vEnds.x) * smoothstep(0.0, 0.9, vEnds.y - vEnds.x);
  float w = fract(vCyc - uTime * 0.7 + vSeed);
  float pulse = smoothstep(0.85, 1.0, w) * smoothstep(1.0, 0.97, w);
  float flick = 0.85 + 0.15 * sin(uTime * 13.0 + vSeed * 20.0);
  float fog = exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
  gl_FragColor = vec4(vBeam * prof * fade * fog * (0.55 * flick + 2.4 * pulse), 1.0);
}`;
const BEAM_BLUE = new THREE.Color('#6A5CFF'), BEAM_MAGENTA = new THREE.Color('#C06CFF');
// blue roads -> blue-violet beam, violet / purple roads -> magenta-violet (core's #c06cff)
function beamColor(c) {
  const p = THREE.MathUtils.smoothstep(c.r / Math.max(c.b, 0.05), 0.08, 0.32);
  return BEAM_BLUE.clone().lerp(BEAM_MAGENTA, p).multiplyScalar(BEAM.k);
}
function beamGeometry(road, color, seed) {
  const { center } = road;
  const hw = Math.min(BEAM.width, road.width * 0.73) / 2;
  const segLen = center instanceof ArcCurve3 ? 0.8 : 1.0;
  const n = Math.max(2, Math.ceil(road.length / segLen));
  const L = road.length;
  const nCyc = road.closed ? Math.max(1, Math.round(L / BEAM.spacing)) : L / BEAM.spacing;
  const pos = [], cyc = [], acr = [], ends = [], bc = [], sd = [], idx = [];
  const p = new THREE.Vector3(), t = new THREE.Vector3();
  const y = (Y[road.kind] ?? 0.05) + BEAM.lift;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    center.getPointAt(u, p); center.getTangentAt(u, t);
    const nx = -t.z, nz = t.x;
    let c = color;
    if (road.kind === 'ring') {
      const deg = Math.atan2(-p.z, p.x) / D2R;
      c = beamColor(ringColor(road.id.startsWith('ring2') ? 'ring2' : road.id, deg));
    }
    for (const s of [-1, 1]) {
      pos.push(p.x + nx * hw * s, y + p.y, p.z + nz * hw * s);
      cyc.push(u * nCyc); acr.push(s); ends.push(u * L, road.closed ? -1 : L);
      bc.push(c.r, c.g, c.b); sd.push(seed);
    }
    if (i < n) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCyc', new THREE.Float32BufferAttribute(cyc, 1));
  g.setAttribute('aAcross', new THREE.Float32BufferAttribute(acr, 1));
  g.setAttribute('aEnds', new THREE.Float32BufferAttribute(ends, 2));
  g.setAttribute('aBeam', new THREE.Float32BufferAttribute(bc, 3));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(sd, 1));
  g.setIndex(idx);
  return g;
}

export default function build(ctx) {
  const { scene, layout, onTick, renderer, camera } = ctx;
  const roads = getRoadPaths(layout);
  const group = new THREE.Group();
  group.name = 'roads';
  scene.add(group);

  const uTime = { value: 0 };
  const fog = scene.fog;
  const fogColor = fog ? fog.color.clone() : new THREE.Color('#070B16');
  const fogDensity = fog && fog.density ? fog.density : 0.0042;

  // ---- road ribbons, one merged mesh
  const styleFor = (road, i) => {
    const seed = ((i * 0.6180339) % 1);
    const d = ((road.deg ?? 0) % 360 + 360) % 360;
    switch (road.kind) {
      case 'ring': return { color: lin(road.color), intensity: road.id === 'ring0' ? 1.3 : 1.75, speed: 7.5, seed };
      case 'spoke': {
        // spokes: blue or purple neon like the reference (purple on the N/S axis and west)
        let c = HUE.blue, e = HUE.blue;
        if (angDist(d, 90) < 30 || angDist(d, 270) < 30) { c = HUE.blue; e = HUE.violet; }
        else if (angDist(d, 180) < 40) { c = HUE.purple; e = HUE.blue; }
        else if (angDist(d, 0) < 30) { c = HUE.blue; e = HUE.purple; }
        return { color: c, edge: e, intensity: 1.6, speed: 6.5, seed };
      }
      case 'link': return { color: (d === 90 || d === 270) ? HUE.warm : HUE.purple, edge: HUE.purple, intensity: 1.2, speed: 5, seed };
      // exits + outer streets: same neon level as the spokes near the core (user 10-31: not dimmer)
      case 'exit': return { color: [0, 180].includes(d) ? HUE.purple : HUE.blue, edge: angDist(d, 180) < 60 ? HUE.purple : HUE.violet, intensity: 1.6, speed: 8, seed };
      case 'street': {
        if (road.closed) return { color: HUE.blue, edge: HUE.purple, intensity: 1.6, speed: 6.5, seed };
        const c = (Math.round(d) % 2) ? HUE.blue : HUE.purple;
        return { color: c, edge: c === HUE.blue ? HUE.violet : HUE.blue, intensity: 1.6, speed: 6.5, seed };
      }
      case 'roundabout': return { color: HUE.blue, edge: lin('#4A8CFF'), intensity: 1.55, speed: 5, seed, rb: true };
      case 'access': return { color: lin(road.color), edge: lin(road.color), intensity: 1.0, speed: 1.6, seed, access: true };
      case 'side': return road.id === 'ring3'
        ? { color: HUE.blue, edge: HUE.purple, intensity: 0.85, speed: 6, seed }
        : { color: lin(road.color), intensity: 1, speed: 4, seed, plain: true };
      default: return { color: HUE.blue, intensity: 1, speed: 6, seed };
    }
  };
  const isGate = (r) => r.kind === 'access' && r.part?.startsWith('gate');
  const geos = roads.map((r, i) => (isGate(r) ? null : ribbonGeometry(r, styleFor(r, i)))).filter(Boolean);
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  const roadMat = new THREE.ShaderMaterial({
    uniforms: { uTime, uFogColor: { value: fogColor }, uFogDensity: { value: fogDensity } },
    vertexShader: roadVert,
    fragmentShader: roadFrag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const roadMesh = new THREE.Mesh(merged, roadMat);
  roadMesh.renderOrder = 1;
  roadMesh.frustumCulled = false;
  group.add(roadMesh);

  // ---- centre light beam on every road (the inner spokes already carry core.js's own beam)
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uTime, uFogDensity: roadMat.uniforms.uFogDensity },
    vertexShader: beamVert, fragmentShader: beamFrag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const beamCol = (road, st) => (road.kind === 'access' ? lin(road.color).multiplyScalar(BEAM.k) : beamColor(st.color));
  const bgeos = roads.map((r, i) => (isGate(r) || r.id.startsWith('spoke-in-') ? null : beamGeometry(r, beamCol(r, styleFor(r, i)), (i * 0.754877) % 1))).filter(Boolean);
  const beamMesh = new THREE.Mesh(mergeGeometries(bgeos, false), beamMat);
  bgeos.forEach((g) => g.dispose());
  beamMesh.renderOrder = 4; beamMesh.frustumCulled = false; beamMesh.name = 'road-beams';
  group.add(beamMesh);

  // ---- junction nodes + roundabout islands (one instanced draw)
  const junctions = getJunctions(layout);
  const islands = layout.ROUNDABOUTS.map((rb) => {
    const a = rb.deg * D2R;
    return { x: Math.cos(a) * rb.r, z: -Math.sin(a) * rb.r, size: rb.size * RB_SCALE - RB_WIDTH - 0.05, color: '#3A86FF', kind: 1 };
  });
  const nodes = [...junctions.map((j) => ({ ...j, kind: 0 })), ...islands];
  const nodeGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const nodeMat = new THREE.ShaderMaterial({
    uniforms: { uTime },
    vertexShader: nodeVert,
    fragmentShader: nodeFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const nodeMesh = new THREE.InstancedMesh(nodeGeo, nodeMat, nodes.length);
  const aColor = new Float32Array(nodes.length * 3), aNode = new Float32Array(nodes.length * 2);
  const m = new THREE.Matrix4();
  nodes.forEach((n, i) => {
    const s = n.size;
    m.makeScale(s, 1, s).setPosition(n.x, n.kind ? 0.16 : 0.18, n.z);
    nodeMesh.setMatrixAt(i, m);
    const c = lin(n.color);
    aColor.set([c.r, c.g, c.b], i * 3);
    aNode.set([n.kind, (i * 0.37) % 1], i * 2);
  });
  nodeGeo.setAttribute('aColor', new THREE.InstancedBufferAttribute(aColor, 3));
  nodeGeo.setAttribute('aNode', new THREE.InstancedBufferAttribute(aNode, 2));
  nodeMesh.renderOrder = 2;
  nodeMesh.frustumCulled = false;
  group.add(nodeMesh);

  // ---- street lamps: thin poles (instanced) + glowing heads (points)
  const lamps = getLampPositions(layout);
  const poleGeo = new THREE.CylinderGeometry(0.035, 0.05, 0.8, 5, 1, true).translate(0, 0.4, 0);
  const poleMat = new THREE.MeshBasicMaterial({ color: '#1a2236' });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, lamps.length);
  const headPos = new Float32Array(lamps.length * 3), seeds = new Float32Array(lamps.length);
  const lr = rngLocal(11);
  lamps.forEach((l, i) => {
    m.makeTranslation(l.x, 0, l.z);
    poles.setMatrixAt(i, m);
    headPos.set([l.x, 0.85, l.z], i * 3);
    seeds[i] = lr();
  });
  group.add(poles);
  const lampGeo = new THREE.BufferGeometry();
  lampGeo.setAttribute('position', new THREE.BufferAttribute(headPos, 3));
  lampGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const uScale = { value: 500 };
  const lampMat = new THREE.ShaderMaterial({
    uniforms: { uTime, uScale, uColor: { value: lin('#FFB547') } },
    vertexShader: lampVert,
    fragmentShader: lampFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lampPts = new THREE.Points(lampGeo, lampMat);
  lampPts.frustumCulled = false;
  lampPts.renderOrder = 3;
  group.add(lampPts);

  // ---- driveways + entrance gateways: built on the first frame, once the buildings exist and
  //      resolveDriveways() has found their real walls
  let gatesBuilt = false;
  const buildGates = () => {
    gatesBuilt = true;
    const gates = resolveDriveways(scene, layout);
    const dg = gates.map((gin, i) => {
      const d = gin.drive;
      const road = { kind: 'drive', width: d.width, center: lineCurve(d.x0, d.z0, d.x1, d.z1) };
      road.length = road.center.getLength();
      return ribbonGeometry(road, { color: lin(gin.color), edge: lin(gin.color), intensity: 1.0, speed: 1.6, seed: (i * 0.618) % 1, access: true });
    });
    if (dg.length) {
      const mesh = new THREE.Mesh(mergeGeometries(dg, false), roadMat);
      dg.forEach((g) => g.dispose());
      mesh.renderOrder = 1; mesh.frustumCulled = false; mesh.name = 'driveways';
      group.add(mesh);
      // centre beam down each driveway, pulses flowing toward the gateway
      const db = gates.map((gin, i) => {
        const d = gin.drive;
        const road = { kind: 'drive', width: d.width, closed: false, center: lineCurve(d.x0, d.z0, d.x1, d.z1) };
        road.length = road.center.getLength();
        return beamGeometry(road, lin(gin.color).multiplyScalar(BEAM.k), (i * 0.618) % 1);
      });
      const bm = new THREE.Mesh(mergeGeometries(db, false), beamMat);
      db.forEach((g) => g.dispose());
      bm.renderOrder = 4; bm.frustumCulled = false; bm.name = 'driveway-beams';
      group.add(bm);
    }
    group.add(buildGateways(gates.map((g) => g.gate), uTime));
  };
  const size = new THREE.Vector2();
  onTick((t) => {
    if (!gatesBuilt) { try { buildGates(); } catch (e) { console.error('[roads] gateways failed', e); } }
    uTime.value = t;
    // follow the engine's zoom-scaled fog (it was frozen at the build-time density, which over-fogged
    // the outer roads when zoomed out)
    if (scene.fog && scene.fog.density) roadMat.uniforms.uFogDensity.value = scene.fog.density;
    renderer.getDrawingBufferSize(size);
    uScale.value = (size.y * 0.5) / Math.tan((camera.fov * D2R) / 2);
  });

  return { group, roads };
}

// Entrance gateway on a building wall (like the core's tunnel portals): dark recessed opening 1.9 x 1.0
// with a converging tunnel and soft inner glow, a lit frame in the building colour and an additive halo.
const GATE_W = 1.9, GATE_H = 1.0;
let _gateTex = null;
function gateTextures() {
  if (_gateTex) return _gateTex;
  const tex = (w, h, draw) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  const inner = tex(256, 136, (g, w, h) => {
    g.fillStyle = '#04060d'; g.fillRect(0, 0, w, h);
    const vx = w / 2, vy = h * 0.52;
    const glow = g.createRadialGradient(vx, vy, 2, vx, vy, w * 0.45);
    glow.addColorStop(0, 'rgba(255,255,255,0.9)'); glow.addColorStop(0.3, 'rgba(255,255,255,0.35)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glow; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 2;
    for (const [x0, y0] of [[0, 0], [w, 0], [0, h], [w, h]]) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(vx + (x0 - vx) * 0.2, vy + (y0 - vy) * 0.2); g.stroke(); }
    g.fillStyle = 'rgba(20,24,40,0.85)';
    g.beginPath(); g.moveTo(0, h); g.lineTo(w, h); g.lineTo(vx + w * 0.1, vy + h * 0.1); g.lineTo(vx - w * 0.1, vy + h * 0.1); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.beginPath(); g.moveTo(vx - 3, h); g.lineTo(vx + 3, h); g.lineTo(vx + 1, vy + h * 0.1); g.lineTo(vx - 1, vy + h * 0.1); g.fill();
  });
  const halo = tex(128, 128, (g, w) => {
    const r = g.createRadialGradient(w / 2, w * 0.72, 0, w / 2, w * 0.72, w * 0.6);
    r.addColorStop(0, 'rgba(255,255,255,0.85)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  });
  _gateTex = { inner, halo };
  return _gateTex;
}
function buildGateways(gates, uTime) {
  const grp = new THREE.Group();
  grp.name = 'gateways';
  const { inner, halo } = gateTextures();
  const openGeo = new THREE.PlaneGeometry(GATE_W, GATE_H);
  const postGeo = new THREE.BoxGeometry(0.12, GATE_H + 0.1, 0.1);
  const lintGeo = new THREE.BoxGeometry(GATE_W + 0.24, 0.12, 0.1);
  const haloGeo = new THREE.PlaneGeometry(GATE_W + 1.6, GATE_H + 1.0);
  const sillGeo = new THREE.PlaneGeometry(GATE_W + 0.4, 0.9).rotateX(-Math.PI / 2);
  for (const g of gates) {
    const c = lin(g.color);
    const face = new THREE.Group();
    face.position.set(g.x + g.nx * 0.06, 0, g.z + g.nz * 0.06);
    face.rotation.y = Math.atan2(g.nx, g.nz); // local +Z = outward wall normal
    const op = new THREE.Mesh(openGeo, new THREE.MeshBasicMaterial({ map: inner, color: c.clone().lerp(new THREE.Color('#ffffff'), 0.35).multiplyScalar(1.15), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    op.position.set(0, GATE_H / 2, 0.01);
    face.add(op);
    const fm = new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(1.6) });
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(postGeo, fm); p.position.set(sx * (GATE_W / 2 + 0.06), (GATE_H + 0.1) / 2, 0.05); face.add(p); }
    const lint = new THREE.Mesh(lintGeo, fm); lint.position.set(0, GATE_H + 0.06, 0.05); face.add(lint);
    const hal = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ map: halo, color: c.clone().multiplyScalar(0.45), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    hal.position.set(0, GATE_H / 2, 0.12); hal.renderOrder = 4; face.add(hal);
    // light spilling out of the gateway onto the driveway
    const sill = new THREE.Mesh(sillGeo, new THREE.MeshBasicMaterial({ map: halo, color: c.clone().multiplyScalar(0.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    sill.position.set(0, 0.16, 0.5); sill.renderOrder = 4; face.add(sill);
    grp.add(face);
  }
  return grp;
}

function rngLocal(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
