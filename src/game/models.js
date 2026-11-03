// Procedural models for the game: humanoids (hero, child, gang), the rideable hover bot, beacons and small effects.
// Everything is unlit (MeshBasicMaterial + baked vertex shading) so it matches the city's emissive neon look
// without adding real lights, and geometry / materials are shared between instances.
import * as THREE from 'three';

// ---------------------------------------------------------------- helpers
const geoCache = new Map();
const matCache = new Map();

// bake simple top-light shading into vertex colours (brighter up, darker down)
function shade(g) {
  const n = g.attributes.normal, c = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const ny = n.getY(i), nx = n.getX(i), nz = n.getZ(i);
    const k = (ny >= 0 ? 0.72 + 0.28 * ny : 0.72 + 0.34 * ny) * (0.94 + 0.06 * (nx * 0.6 + nz * 0.4));
    c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
function geo(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = shade(make()); geoCache.set(key, g); }
  return g;
}

// Raw primitives (new BoxGeometry ...) carry no vertex colours, which the solid() material multiplies by: they render black.
// Call this on a finished group to bake the same simple top-light shading into every such mesh.
function fixColors(group) {
  group.traverse((o) => {
    if (o.isMesh && o.material?.vertexColors && !o.geometry.attributes.color) shade(o.geometry);
  });
  return group;
}

export function solid(hex) {
  const key = 's' + hex;
  let m = matCache.get(key);
  if (!m) { m = new THREE.MeshBasicMaterial({ color: hex, vertexColors: true }); matCache.set(key, m); }
  return m;
}
export function glowMat(hex) {
  const key = 'g' + hex;
  let m = matCache.get(key);
  if (!m) { m = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(1.6), toneMapped: false }); matCache.set(key, m); }
  return m;
}
export const flashMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });

let glowTex;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c); glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}
let poolGeo;
export function addGlowPool(parent, hex, size, y = 0.03, opacity = 0.8) {
  poolGeo ||= new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(
    poolGeo,
    new THREE.MeshBasicMaterial({ map: glowTexture(), color: hex, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }),
  );
  m.scale.set(size, 1, size); m.position.y = y; m.renderOrder = 4;
  parent.add(m);
  return m;
}

// ---------------------------------------------------------------- humanoid
// +Z is forward. Height is about 1.15 units at scale 1. Poses are applied with setPose().
// people were about one storey tall next to the buildings; scale every humanoid down to a believable size
export const HUMAN_SCALE = 0.55;
export const LOOKS = {
  hero:     { skin: '#9a6a48', jacket: '#1b2a44', pants: '#141a2b', accent: '#22D3EE', hair: '#0b0b10', scale: 0.9 },
  child:    { skin: '#a8754f', jacket: '#d9a636', pants: '#2a3a63', accent: '#FFCC4D', hair: '#0b0b10', scale: 0.62 },
  thug:     { skin: '#8d6040', jacket: '#26212e', pants: '#17151f', accent: '#FF4B4B', hair: '#0b0b10', scale: 0.92 },
  enforcer: { skin: '#7d5438', jacket: '#33231f', pants: '#1c1514', accent: '#FF9F1C', hair: '#0b0b10', scale: 1.2, bulk: 1.35 },
  sprinter: { skin: '#9a6a48', jacket: '#2b1830', pants: '#17101c', accent: '#FF2D95', hair: '#0b0b10', scale: 0.88 },
  captain:  { skin: '#7d5438', jacket: '#2a1236', pants: '#1a0f22', accent: '#FF3ED1', hair: '#0b0b10', scale: 1.3, bulk: 1.3 },
};

LOOKS.mom = { skin: '#a8754f', jacket: '#2d6a4f', pants: '#1d2b3a', accent: '#00F5A0', hair: '#0b0b10', scale: 0.88 };
LOOKS.dad = { skin: '#9a6a48', jacket: '#3b4a7a', pants: '#1a1f33', accent: '#3A86FF', hair: '#0b0b10', scale: 0.95, bulk: 1.1 };
LOOKS.rider = { skin: '#8d6040', jacket: '#3a1426', pants: '#17101c', accent: '#FF3B5C', hair: '#0b0b10', scale: 0.88 };
const CIV_JACKETS = ['#6b4e9e', '#2f7f87', '#a05a3a', '#4a6b3a', '#8a3d63', '#3d5a8a', '#7d7d3a', '#5a5a6e'];
const CIV_ACCENT = ['#22D3EE', '#FFCC4D', '#00F5A0', '#FF9F1C', '#A855F7', '#FF6EB4'];
const CIV_SKIN = ['#8d6040', '#a8754f', '#9a6a48', '#b98563', '#7a5238'];
export const civilianLook = (i) => ({
  skin: CIV_SKIN[i % CIV_SKIN.length], jacket: CIV_JACKETS[(i * 3) % CIV_JACKETS.length], pants: ['#1d2230', '#2b2a38', '#1c2b2f'][i % 3],
  accent: CIV_ACCENT[(i * 5) % CIV_ACCENT.length], hair: ['#0b0b10', '#2a1a10', '#15151c'][i % 3], scale: 0.8 + ((i * 7) % 5) * 0.045, bulk: 0.95 + ((i * 3) % 4) * 0.06,
});

export function makeHumanoid(look) {
  const L = typeof look === 'string' ? LOOKS[look] : look;
  const bulk = L.bulk || 1;
  const root = new THREE.Group();
  const body = new THREE.Group(); body.scale.setScalar(L.scale * HUMAN_SCALE); root.add(body);

  const limb = (w, h, d, hex, key) => new THREE.Mesh(geo(key, () => new THREE.BoxGeometry(w, h, d)), solid(hex));
  const pivot = (x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); body.add(g); return g; };

  const legL = pivot(-0.085 * bulk, 0.46, 0), legR = pivot(0.085 * bulk, 0.46, 0);
  for (const p of [legL, legR]) { const m = limb(0.13 * bulk, 0.46, 0.14 * bulk, L.pants, 'leg' + bulk); m.position.y = -0.23; p.add(m); }
  const torso = pivot(0, 0.46, 0);
  const chest = limb(0.34 * bulk, 0.42, 0.2 * bulk, L.jacket, 'chest' + bulk); chest.position.y = 0.21; torso.add(chest);
  const stripe = new THREE.Mesh(geo('stripe', () => new THREE.BoxGeometry(0.36, 0.045, 0.215)), glowMat(L.accent));
  stripe.scale.set(bulk, 1, bulk); stripe.position.y = 0.3; torso.add(stripe);
  const head = pivot(0, 0.46 + 0.42 + 0.02, 0);
  const skull = new THREE.Mesh(geo('head', () => new THREE.SphereGeometry(0.125, 14, 10)), solid(L.skin)); skull.position.y = 0.12; head.add(skull);
  const hair = new THREE.Mesh(geo('hair', () => new THREE.SphereGeometry(0.13, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)), solid(L.hair)); hair.position.set(0, 0.135, -0.012); head.add(hair);
  const visor = new THREE.Mesh(geo('visor', () => new THREE.BoxGeometry(0.17, 0.035, 0.03)), glowMat(L.accent)); visor.position.set(0, 0.13, 0.115); head.add(visor);
  const armL = pivot(-0.22 * bulk, 0.46 + 0.38, 0), armR = pivot(0.22 * bulk, 0.46 + 0.38, 0);
  for (const p of [armL, armR]) { const m = limb(0.095 * bulk, 0.38, 0.1 * bulk, L.jacket, 'arm' + bulk); m.position.y = -0.19; p.add(m);
    const fist = new THREE.Mesh(geo('fist', () => new THREE.SphereGeometry(0.06, 8, 6)), solid(L.skin)); fist.position.y = -0.4; p.add(fist); }

  const h = {
    root, body, legL, legR, armL, armR, torso, head, look: L, phase: 0, atk: 0, flash: 0,
    parts: [], height: 1.15 * L.scale * HUMAN_SCALE,
  };
  root.traverse((o) => { if (o.isMesh) h.parts.push([o, o.material]); });
  return h;
}

// state: { moving (0..1 speed factor), sit, atk (0..1 swing progress, 0 = none), windup (0..1), down (0..1), stagger }
export function setPose(h, s, dt) {
  h.armL.rotation.z = 0; h.armR.rotation.z = 0;
  h.phase += (s.moving || 0) * dt * 11;
  const sw = Math.sin(h.phase) * 0.9 * Math.min(1, s.moving || 0);
  if (s.stand) { // riding a hoverboard: knees bent, arms out for balance, leaning into the ride
    h.legL.rotation.x = 0.22; h.legR.rotation.x = -0.18; h.armL.rotation.x = -0.1; h.armR.rotation.x = -0.1; h.armL.rotation.z = 0.6; h.armR.rotation.z = -0.6;
  } else if (s.sit) { h.legL.rotation.x = h.legR.rotation.x = -1.35; h.armL.rotation.x = h.armR.rotation.x = -0.9; }
  else {
    h.legL.rotation.x = sw; h.legR.rotation.x = -sw;
    h.armL.rotation.x = -sw * 0.8; h.armR.rotation.x = sw * 0.8;
  }
  if (s.atk > 0) { // punch: right arm snaps forward, torso twists
    const k = Math.sin(Math.min(1, s.atk) * Math.PI);
    h.armR.rotation.x = -1.55 * k; h.armR.rotation.z = -0.1;
    h.torso.rotation.y = -0.35 * k;
  } else h.torso.rotation.y = 0;
  if (s.aim > 0) { h.armR.rotation.x = -1.5; h.armR.rotation.z = 0; h.torso.rotation.y = -0.18; }
  else if (s.armed && !(s.atk > 0)) h.armR.rotation.x = -0.55; // gun drawn, held low
  if (s.windup > 0) { h.armR.rotation.x = -2.5 * s.windup; h.torso.rotation.x = -0.18 * s.windup; }
  else if (s.stand) h.torso.rotation.x = s.lean ?? 0.12;
  else if (!s.sit && !s.stagger) h.torso.rotation.x = 0;
  if (s.stagger) h.torso.rotation.x = -0.45;
  const d = s.down || 0;
  h.root.rotation.x = -1.45 * d;
  h.body.position.y = -0.22 * d * HUMAN_SCALE;
  h.body.position.z = -0.06 * d;
  h.head.rotation.x = s.look || 0;
}

// white hit flash (swap every part to a shared bright material for a few frames)
export function flash(h, on) {
  if (on === h.flashed) return;
  h.flashed = on;
  for (const [m, orig] of h.parts) m.material = on ? flashMat : orig;
}

// ---------------------------------------------------------------- hoverboards (rideable)
// Three boards sized to their riders (people are ~0.6 units tall): a street board for one or two, a long board that
// carries two comfortably, and a winged sky board that flies. Forward is +Z; the rider stands at seatY on top.
const BOARD = {
  car:   { len: 1.5, wid: 0.5,  hover: 0.28 },
  bus:   { len: 2.5, wid: 0.62, hover: 0.28 },
  drone: { len: 1.5, wid: 0.5,  hover: 1.2 },
};
const DECK_TOP = 0.16;

export function makeBot(hex, kind = 'car') {
  const B = BOARD[kind] || BOARD.car;
  const root = new THREE.Group(), lift = new THREE.Group(); root.add(lift);
  const L = B.len, W = B.wid;
  // deck: a dark slab with a lighter top plate and a tapered nose
  const deck = new THREE.Mesh(geo(`deck${kind}`, () => new THREE.BoxGeometry(W, 0.08, L)), solid('#262c44')); deck.position.y = 0.11; lift.add(deck);
  const plate = new THREE.Mesh(geo(`plate${kind}`, () => new THREE.BoxGeometry(W * 0.82, 0.025, L * 0.78)), solid('#44507a')); plate.position.y = DECK_TOP - 0.012; lift.add(plate);
  for (const sz of [-1, 1]) { // rounded nose and tail
    const cap = new THREE.Mesh(geo(`cap${kind}`, () => new THREE.CylinderGeometry(W / 2, W / 2, 0.08, 16)), solid('#262c44'));
    cap.position.set(0, 0.11, sz * L / 2); lift.add(cap);
    const bar = new THREE.Mesh(geo(`bar${kind}`, () => new THREE.BoxGeometry(W * 0.7, 0.03, 0.04)), glowMat(sz > 0 ? '#ffffff' : '#FF2D2D')); bar.position.set(0, 0.125, sz * (L / 2 + W / 2 - 0.02)); lift.add(bar);
  }
  for (const sx of [-1, 1]) { // neon edge strips
    const strip = new THREE.Mesh(geo(`strip${kind}`, () => new THREE.BoxGeometry(0.035, 0.035, L * 0.98)), glowMat(hex)); strip.position.set(sx * (W / 2 - 0.01), 0.125, 0); lift.add(strip);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { // thruster pads underneath
    const pad = new THREE.Mesh(geo('pad', () => new THREE.CylinderGeometry(0.085, 0.06, 0.04, 14)), glowMat(hex)); pad.position.set(sx * W * 0.25, 0.055, sz * L * 0.3); lift.add(pad);
  }
  if (kind === 'bus') { // long board: a cargo rail along the back
    const rail = new THREE.Mesh(geo('rail', () => new THREE.BoxGeometry(W * 0.9, 0.12, 0.05)), solid('#8b90a3')); rail.position.set(0, 0.22, -L / 2 + 0.2); lift.add(rail);
  }
  if (kind === 'drone') { // sky board: swept wings and a glowing lift ring
    for (const sx of [-1, 1]) {
      const wing = new THREE.Mesh(geo('wing', () => new THREE.BoxGeometry(0.42, 0.02, 0.34)), solid('#44507a'));
      wing.position.set(sx * (W / 2 + 0.17), 0.12, -0.15); wing.rotation.y = sx * -0.5; wing.rotation.z = sx * 0.12; lift.add(wing);
      const tip = new THREE.Mesh(geo('wingtip', () => new THREE.BoxGeometry(0.05, 0.03, 0.3)), glowMat(hex)); tip.position.set(sx * (W / 2 + 0.34), 0.13, -0.2); tip.rotation.y = sx * -0.5; lift.add(tip);
    }
    const ring = new THREE.Mesh(geo('liftring', () => new THREE.TorusGeometry(0.34, 0.03, 8, 28).rotateX(Math.PI / 2)), glowMat(hex)); ring.position.y = 0.02; lift.add(ring);
  }
  const pool = addGlowPool(root, hex, 1.7 + L * 0.5, -B.hover + 0.03, kind === 'drone' ? 0.75 : 0.9); pool.scale.z = 1.4 + L; pool.scale.x = 1.6 + W;
  return { root, lift, kind, color: hex, scale: 1, halfLen: L / 2, seatY: DECK_TOP, seatZ: 0, hover: B.hover, len: L, wid: W };
}

// ---------------------------------------------------------------- beacons and rings
let beamTex;
function beamTexture() {
  if (beamTex) return beamTex;
  const c = document.createElement('canvas'); c.width = 4; c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 128);
  beamTex = new THREE.CanvasTexture(c);
  return beamTex;
}
export function makeBeacon(hex, { radius = 1.0, height = 70 } = {}) {
  const g = new THREE.Group();
  const cyl = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 20, 1, true),
    new THREE.MeshBasicMaterial({ map: beamTexture(), color: hex, transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false }),
  );
  cyl.position.y = height / 2; cyl.renderOrder = 6; g.add(cyl);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 2.4, 0.07, 8, 48).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(1.8), toneMapped: false, fog: false }));
  ring.position.y = 0.08; g.add(ring);
  g.userData = { cyl, ring };
  return g;
}

// ---------------------------------------------------------------- hit sparks / teleport flashes (pooled)
export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.pool = [];
  }
  _get() {
    let s = this.pool.pop();
    if (!s) {
      s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }));
      s.renderOrder = 8;
    }
    s.visible = true; this.scene.add(s);
    return s;
  }
  // expanding glow: kind 'spark' (small, fast) | 'burst' (large, teleport)
  spawn(x, y, z, hex, size = 1.2, life = 0.35, rise = 0) {
    const s = this._get();
    s.material.color.set(hex).multiplyScalar(1.8);
    s.position.set(x, y, z);
    this.items.push({ s, t: 0, life, size, rise });
  }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = it.t / it.life;
      if (k >= 1) { it.s.visible = false; this.scene.remove(it.s); this.pool.push(it.s); this.items.splice(i, 1); continue; }
      it.s.scale.setScalar(it.size * (0.4 + k * 1.3));
      it.s.material.opacity = (1 - k) * (1 - k);
      it.s.position.y += it.rise * dt;
    }
  }
}

// vertical flash column for teleports (re-used, scaled down to nothing over `life`)
export function makeFlashColumn(hex) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.6, 7, 16, 1, true),
    new THREE.MeshBasicMaterial({ map: beamTexture(), color: hex, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false }),
  );
  m.renderOrder = 7; m.visible = false;
  m.userData = { t: 1, life: 0.45 };
  return m;
}

// ---------------------------------------------------------------- mission set pieces
// Hospital: a lit pylon with a big red cross plate and a glowing white pad.
export function makeHospitalSign() {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 0.08, 36), new THREE.MeshBasicMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  pad.position.y = 0.06; g.add(pad);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.07, 8, 56).rotateX(Math.PI / 2), glowMat('#ffffff')); ring.position.y = 0.1; g.add(ring);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5.2, 0.35), solid('#8a97bd')); post.position.set(0, 2.6, -2.8); g.add(post);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 0.2), glowMat('#f4f7ff')); plate.position.set(0, 5.6, -2.8); g.add(plate);
  const cross = new THREE.Group(); cross.position.set(0, 5.6, -2.68);
  for (const [w, h] of [[1.7, 0.55], [0.55, 1.7]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), glowMat('#ff2d3d')); cross.add(b); }
  g.add(cross);
  // two stretcher beds
  for (const sx of [-1.2, 1.2]) {
    const bed = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 1.7), glowMat('#cfdcff')); bed.position.set(sx, 0.55, 0.2); g.add(bed);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 1.5), solid('#9aa6c8')); leg.position.set(sx, 0.28, 0.2); g.add(leg);
  }
  return fixColors(g);
}

// Food stall: counter, striped awning, glowing sign.
export function makeFoodStall() {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.08, 36), new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  pad.position.y = 0.06; g.add(pad);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.07, 8, 56).rotateX(Math.PI / 2), glowMat('#FF9F1C')); ring.position.y = 0.1; g.add(ring);
  const counter = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.0, 1.2), solid('#b9753f')); counter.position.set(0, 0.5, -2.6); g.add(counter);
  const top = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 1.4), solid('#f0c07a')); top.position.set(0, 1.05, -2.6); g.add(top);
  for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.1, 1.7), glowMat(i % 2 ? '#ffe9c2' : '#ff4a4a')); s.position.set(-1.45 + i * 0.58, 2.7, -2.6); s.rotation.x = 0.28; g.add(s); }
  for (const sx of [-1.6, 1.6]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 0.12), solid('#9a8a7a')); p.position.set(sx, 1.3, -3.1); g.add(p); }
  const sign = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.1), glowMat('#FF9F1C')); sign.position.set(0, 3.4, -3.15); g.add(sign);
  for (let i = 0; i < 3; i++) { // bowls on the counter
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.14, 0.16, 12), glowMat(['#ffcc4d', '#ff7a3d', '#9be564'][i])); bowl.position.set(-0.8 + i * 0.8, 1.18, -2.6); g.add(bowl);
  }
  return fixColors(g);
}

// ---------------------------------------------------------------- weapon, terminals, ramps
// A compact energy blaster held in the right hand: the barrel lies along the arm, so when the arm is raised to aim
// (setPose aim) it points straight ahead.
export function addBlaster(h) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(geo('gun', () => new THREE.BoxGeometry(0.075, 0.36, 0.11)), solid('#3a4668')); body.position.y = -0.5; g.add(body);
  const top = new THREE.Mesh(geo('guntop', () => new THREE.BoxGeometry(0.03, 0.3, 0.03)), glowMat('#22D3EE')); top.position.set(0, -0.5, 0.065); g.add(top);
  const tip = new THREE.Mesh(geo('guntip', () => new THREE.BoxGeometry(0.06, 0.06, 0.08)), glowMat('#9be8ff')); tip.position.y = -0.7; g.add(tip);
  h.armR.add(g);
  h.gun = g;
  return g;
}

// Decryption terminal: a small console with a screen that is amber while locked and green once decrypted.
export function makeTerminal() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.42), solid('#8494c4')); base.position.y = 0.35; g.add(base);
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.32, 0.04), glowMat('#FF9F1C')); screen.position.set(0, 0.84, 0.16); screen.rotation.x = -0.35; g.add(screen);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.035, 8, 40).rotateX(Math.PI / 2), glowMat('#FF9F1C')); ring.position.y = 0.04; g.add(ring);
  const ant = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.04), solid('#8b90a3')); ant.position.set(0.18, 1.0, -0.1); g.add(ant);
  g.userData = { screen, ring, state: 'locked' };
  return fixColors(g);
}
export function setTerminalState(t, state) {
  const hex = state === 'done' ? '#00F5A0' : state === 'hacking' ? '#22D3EE' : '#FF9F1C';
  t.userData.screen.material = glowMat(hex); t.userData.ring.material = glowMat(hex); t.userData.state = state;
}

// A walkable access ramp: a thick slab tilted from (outer radius, y0) up to (inner radius, y1) along a radial direction.
export function makeRamp(angleRad, rOuter, y0, rInner, y1, width = 2.6, thick = 0.5) {
  const ux = Math.cos(angleRad), uz = -Math.sin(angleRad); // outward unit vector (layout polar convention)
  const ox = ux * rOuter, oz = uz * rOuter, ix = ux * rInner, iz = uz * rInner;
  const run = Math.hypot(ox - ix, oz - iz), rise = y1 - y0, len = Math.hypot(run, rise), pitch = Math.atan2(rise, run);
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  g.rotation.set(pitch, Math.atan2(ux, uz), 0); // +z runs outward and downward
  const mx = (ox + ix) / 2 - ux * Math.sin(pitch) * thick / 2, mz = (oz + iz) / 2 - uz * Math.sin(pitch) * thick / 2, my = (y0 + y1) / 2 - Math.cos(pitch) * thick / 2;
  g.position.set(mx, my, mz);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(width, thick, len), solid('#5b6aa0')); g.add(slab);
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, len), glowMat('#22D3EE')); e.position.set(sx * (width / 2 - 0.05), thick / 2 + 0.02, 0); g.add(e); }
  for (let i = 0; i < 5; i++) { const c = new THREE.Mesh(new THREE.BoxGeometry(width * 0.7, 0.05, 0.12), glowMat('#3A86FF')); c.position.set(0, thick / 2 + 0.02, -len / 2 + (i + 0.5) * (len / 5)); g.add(c); }
  return fixColors(g);
}

// A bobbing arrow that points down at an objective (replaces the old light columns). Drawn on top of the scene so it can
// be followed through buildings; the game scales it with distance so it stays readable from across the city.
export function makeArrow(hex) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(1.8), toneMapped: false, fog: false, depthTest: false, transparent: true, opacity: 0.95 });
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.9, 4).rotateX(Math.PI), mat); head.position.y = 0.45;
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.75, 0.26), mat); shaft.position.y = 1.27;
  head.renderOrder = shaft.renderOrder = 9;
  g.add(head, shaft);
  g.userData = { mat };
  return g;
}
export function setArrowColor(a, hex) { a.userData.mat.color.set(hex).multiplyScalar(1.8); }
