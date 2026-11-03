// THE RUNAWAY, Chapter 1: a third-person rescue-and-escape game played inside the neon city at night.
//
// A gang is holding a child inside the Core's dome, ringed by guards. Beat the guards, decrypt the dome, free the child,
// then take them across the whole city: hospital, something to eat, their parents, and finally out through the south
// gate, with gang riders on floating hoverboards hunting you (and shooting) all the way.
// Tools: a hoverboard (hijack any board or sky board from traffic), an energy blaster, your fists, and a rooftop / road
// teleport (press to aim, press again to jump).
import * as THREE from 'three';
import { captureHeightmap } from './heightmap.js';
import { moveXZ, stepVertical, angleLerp, GRAVITY } from './physics.js';
import { makeHumanoid, setPose, flash, makeBot, makeBeacon, Fx, makeFlashColumn, addGlowPool, glowMat, makeHospitalSign, makeFoodStall, addBlaster, makeTerminal, setTerminalState, makeRamp, makeArrow, setArrowColor } from './models.js';
import { createInput } from './input.js';
import { sfx } from './audio.js';
import { Hud } from './hud.js';
import { Enemy } from './enemies.js';
import { Chaser } from './chasers.js';
import { Civilians } from './civilians.js';
import { Projectiles } from './weapon.js';
import { applyNight } from './night.js';
import { buildStreets } from './streets.js';
import { removeTreesOnRoads } from './cleanup.js';
import { Taunter } from './taunts.js';
import { addSharpen } from './sharpen.js';
import { Radio } from './radio.js';
import { Buddy } from './buddy.js';
import { getAccount, createAccount, msUntilNextChapter, formatCountdown, saveGame, loadGame, completeChapter, signOut, clearSave } from './account.js';
import { getRoadPaths } from '../city/roads.js';
import { polar } from '../city/layout.js';

// ---------------------------------------------------------------- tuning (people are ~0.6 units tall)
const TP = { range: 70, cooldown: 5, iframes: 0.6, refundKill: 0.7, aimTimeout: 6, slowmo: 0.4 };
const FOOT = { walk: 3.4, sprint: 5.0, accel: 12, jump: 6.0, r: 0.2, step: 0.32, vault: 1.25 };
const BOARDS = { // hoverboards: a street board, a long board for two, and a winged sky board that flies
  car: { max: 9, acc: 10, rev: 4, turn: 2.6, r: 0.55, step: 0.3 },
  bus: { max: 7, acc: 7, rev: 3, turn: 2.0, r: 0.75, step: 0.3 },
  drone: { max: 8.5, acc: 11, rev: 4, turn: 3.0, r: 0.5, step: 1.2 },
};
const PUNCH = { cd: 0.3, range: 1.5, cone: 0.35 };
const GUN = { cd: 0.18, speed: 50, dmg: 1.4, cone: 0.15 };
const DRAIN_PER_GUARD = 0.18; // child hp per second per guard still "executing" (guards that have not turned on you yet)
const HOSTILE_R = 55; // the gang only turns on you inside the second inner road (ring2, r 55)
const CLIMB = { max: 30, deadzone: 0.06 }; // boards climb / dive with the camera pitch, up to this height
const TERM_HOLD = 5, FREE_HOLD = 2; // seconds to hold F (pace knobs: with the speeds above they set the length of the run)
const TAU = Math.PI * 2;

const MISSIONS = {
  reach:    { label: 'MISSION 1', title: 'Reach the Core', sub: 'The child is locked inside the dome' },
  rescue:   { label: 'MISSION 2', title: 'Free the child', sub: '' },
  hospital: { label: 'MISSION 3', title: 'Take the child to the hospital', sub: 'Follow the red beacon' },
  food:     { label: 'MISSION 4', title: 'Get the child something to eat', sub: 'Follow the orange beacon' },
  parents:  { label: 'MISSION 5', title: 'Take the child to their parents', sub: 'Follow the green beacon' },
  exit:     { label: 'MISSION 6', title: 'Get the child out of the city', sub: 'Reach the south gate' },
};
const CHASER_CAP = { hospital: 2, food: 2, parents: 3, exit: 3 };

const rnd = (a, b) => a + Math.random() * (b - a);
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = (s) => String(s).replace(/[<>&"]/g, '');

export function startGame(ctx) {
  const { scene, camera, renderer, composer, bloom, controls, onTick } = ctx;
  const canvas = renderer.domElement;
  const params = new URLSearchParams(location.search);

  // hand the camera to the game, and make it night
  controls.enabled = false; controls.fov = 60; controls.renderScale = 1; // full resolution; the adaptive scaler below only steps down when the frame rate really needs it
  camera.near = 0.12; camera.far = 1800; ctx.resize();
  const night = applyNight(ctx); // (also removes the brain from the dome: only the child is inside)
  const sharpen = addSharpen(ctx); // keeps the picture crisp, most of all when the scaler has to lower the resolution

  const input = createInput(canvas);
  const hud = new Hud(canvas.parentElement);
  const fx = new Fx(scene);
  const flashCols = [makeFlashColumn('#00E5FF'), makeFlashColumn('#9be8ff')];
  scene.add(...flashCols);

  // two ramps up to the dome rim: added BEFORE the height capture so they are walkable
  for (const deg of [190, 350]) scene.add(makeRamp((deg * Math.PI) / 180, 13.4, 1.2, 8.7, 3.56, 2.6, 0.5));

  // ---------------------------------------------------------------- world knowledge (height map + level layout)
  const hm = captureHeightmap(ctx, { size: 340, res: 1024 });
  const extra = buildStreets(ctx, hm);              // denser, more tangled road network
  const treeFix = removeTreesOnRoads(ctx, extra.streets); // no trees standing on roads
  const open = (x, z, r = 0.8, o) => hm.findOpen(x, z, r, o) || { x, z };
  const at = (r, deg, rr, o) => { const p = polar(r, deg); return open(p.x, p.z, rr, o); };

  const domePos = { x: 0, z: 0 };
  const cellPos = { x: 0, z: 0 }; // the child sits in the very centre of the dome
  const termPos = (() => { // three decryption terminals OUTSIDE the dome, on the platform ring
    const out = [];
    for (const deg of [70, 130, 250]) {
      let p = null;
      for (const r of [12.6, 12.0, 13.0, 11.6]) { const q = polar(r, deg); if (Math.abs(hm.h(q.x, q.z) - 1.2) < 0.25 && hm.isFlat(q.x, q.z, 0.4, 0.15)) { p = q; break; } }
      out.push(p || polar(12.4, deg));
    }
    return out;
  })();

  // the missions are spread across the whole city: east edge -> centre -> north-east -> north-west -> west -> south gate
  const startPos = at(136, 330, 0.5);
  const hospitalPos = at(124, 62, 2.6, { maxH: 0.4, maxR: 30 });
  const foodPos = at(122, 128, 2.4, { maxH: 0.4, maxR: 30 });
  const parentsPos = at(118, 200, 2.0, { maxH: 0.4, maxR: 30 });
  const exitPos = { x: 0, z: 144 };
  const goalOf = (ph) => (ph === 'hospital' ? hospitalPos : ph === 'food' ? foodPos : ph === 'parents' ? parentsPos : ph === 'exit' ? exitPos : cellPos);

  // pavement-level road samples, used to drop riders onto the streets
  const roadPts = [];
  for (const r of getRoadPaths(ctx.layout)) {
    if (!['ring', 'spoke', 'exit', 'street', 'side'].includes(r.kind)) continue;
    for (let u = 0; u < 1; u += 6 / r.length) { const p = r.center.getPointAt(u); const rad = Math.hypot(p.x, p.z); if (rad > 20 && rad < 146 && hm.h(p.x, p.z) < 0.3) roadPts.push({ x: p.x, z: p.z }); }
  }

  // ---------------------------------------------------------------- state
  const g = {
    hm, scene, fx, layout: ctx.layout, enemies: [], alarm: false, hostile: false, camYaw: 0, time: 0, cam: null, proj: null,
    player: null, child: null,
    onTakedown(e) {
      buddy.on('kill'); stats.takedowns++; sfx.hit(); P.cd = Math.max(0, P.cd - TP.refundKill);
      if (e.kind === 'captain') hud.toast('Gang captain down', 'good');
    },
    enemyHit(e, dmg) { // a melee / ram strike that connected
      const c = child;
      const nearChild = (c.state === 'follow' || c.state === 'station') && Math.hypot(c.x - e.x, c.z - e.z) < (e.cfg.range || 1.0) + 0.5;
      if (nearChild && Math.random() < 0.5) hurtChild(dmg * 0.9); else hurtPlayer(dmg, e);
    },
    shotHit(dmg, p) { hurtPlayer(dmg, p); },
    shotHitChild(dmg) { hurtChild(dmg); },
  };
  const P = {
    x: startPos.x, z: startPos.z, y: hm.h(startPos.x, startPos.z), vy: 0, onGround: true, face: 0,
    hp: 100, maxHp: 100, mode: 'foot', bot: null, invuln: 0, atkT: 0, atkCd: 0, gunCd: 0, aimT: 0, combo: 0, comboT: 0, vx: 0, vz: 0, invisible: false,
    cd: 0, sinceHit: 99, moving: 0,
  };
  g.player = P;
  const proj = new Projectiles(g); g.proj = proj;
  const radio = new Radio(hud, sfx);
  const taunt = new Taunter(radio, sfx); // the gang boss, needling you over the radio
  const stats = { takedowns: 0, teleports: 0, hijacks: 0, deaths: 0, rams: 0, civHits: 0, shots: 0 };
  let state = 'loading'; // loading | title | playing | paused | dialogue | won | lost | chapter
  let phase = 'reach';
  let checkpoint = { x: P.x, z: P.z };
  let elapsed = 0, choice = null;
  let armed = false; // the Punch Gun stays holstered until you scroll the mouse wheel

  // ---------------------------------------------------------------- entities
  const hero = makeHumanoid('hero'); scene.add(hero.root); addBlaster(hero);
  const heroPool = addGlowPool(hero.root, '#22D3EE', 0.9, 0.04, 0.5);
  hero.gun.visible = false; // the Punch Gun is holstered until you scroll
  const buddy = new Buddy({ g, scene, P, hm, proj, fx, radio, sfx, getGoal: () => goalOf(phase), getPhase: () => phase }); // NOVA: guides, helps, teases
  taunt.onSay = () => buddy.replyTo();
  const child = { x: cellPos.x, z: cellPos.z, y: hm.h(cellPos.x, cellPos.z), vy: 0, onGround: true, face: 0, hp: 100, state: 'caged', h: makeHumanoid('child'), vx: 0, vz: 0, eating: false, fed: false };
  g.child = child;
  scene.add(child.h.root);
  child.h.root.position.set(child.x, child.y, child.z);

  // the encrypted shield around the child, and the three decryption terminals around the dome floor
  const floorY = hm.h(cellPos.x, cellPos.z);
  const cell = new THREE.Group(); cell.position.set(cellPos.x, floorY, cellPos.z);
  const cellMat = new THREE.MeshBasicMaterial({ color: '#FF9F1C', transparent: true, opacity: 0.26, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
  const cellGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.1, 24, 1, true), cellMat); cellGlass.position.y = 0.55; cell.add(cellGlass);
  const cellRing = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.03, 8, 40).rotateX(Math.PI / 2), glowMat('#FF9F1C')); cellRing.position.y = 0.03; cell.add(cellRing);
  scene.add(cell);
  const terminals = termPos.map((p) => {
    const t = makeTerminal(); t.position.set(p.x, hm.h(p.x, p.z), p.z); t.rotation.y = Math.atan2(-p.x, -p.z); scene.add(t);
    const arrow = makeArrow('#FF9F1C'); scene.add(arrow);
    return { obj: t, x: p.x, z: p.z, hold: 0, done: false, arrow };
  });
  let decrypted = 0, domeAmbush = false;

  // set pieces for the later missions
  const faceCore = (p) => Math.atan2(-p.x, -p.z);
  const hospital = makeHospitalSign(); hospital.position.set(hospitalPos.x, hm.h(hospitalPos.x, hospitalPos.z), hospitalPos.z); hospital.rotation.y = faceCore(hospitalPos); hospital.scale.setScalar(0.7); scene.add(hospital);
  const stall = makeFoodStall(); stall.position.set(foodPos.x, hm.h(foodPos.x, foodPos.z), foodPos.z); stall.rotation.y = faceCore(foodPos); stall.scale.setScalar(0.7); scene.add(stall);
  const mom = makeHumanoid('mom'), dad = makeHumanoid('dad');
  const pf = faceCore(parentsPos), side = { x: Math.cos(pf) * 0.5, z: -Math.sin(pf) * 0.5 };
  mom.root.position.set(parentsPos.x - side.x, hm.h(parentsPos.x, parentsPos.z), parentsPos.z - side.z); dad.root.position.set(parentsPos.x + side.x, hm.h(parentsPos.x, parentsPos.z), parentsPos.z + side.z);
  mom.root.rotation.y = dad.root.rotation.y = pf; scene.add(mom.root, dad.root);
  setPose(mom, {}, 0); setPose(dad, {}, 0);
  const parentsGlow = addGlowPool(scene, '#00F5A0', 3.5, 0.05, 0.6); parentsGlow.position.set(parentsPos.x, 0.05, parentsPos.z);

  // the south exit gate
  const gate = new THREE.Group(); gate.position.set(exitPos.x, 0, exitPos.z); gate.rotation.y = Math.PI / 2; scene.add(gate);
  for (const sz of [-3.7, 3.7]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.7, 9, 0.7), glowMat('#00F5A0')); p.position.set(0, 4.5, sz); gate.add(p); }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 8.6), glowMat('#00F5A0')); lintel.position.set(0, 9.2, 0); gate.add(lintel);

  // the goal marker: a floating arrow (no light columns). It follows the current mission.
  const goalArrow = makeArrow('#00E5FF'); scene.add(goalArrow);
  const BEACON_COL = { reach: '#00E5FF', rescue: '#00E5FF', hospital: '#ff5a6a', food: '#FF9F1C', parents: '#00F5A0', exit: '#00F5A0' };
  function placeBeacon() { setArrowColor(goalArrow, BEACON_COL[phase]); }
  placeBeacon();
  const arrowTmp = new THREE.Vector3();
  function placeArrow(a, x, z, lift, k) { // scaled with distance so it stays readable from across the city
    const gy = hm.h(x, z), d = camera.position.distanceTo(arrowTmp.set(x, gy, z));
    const sc = THREE.MathUtils.clamp(d * k, 0.6, 9);
    a.scale.setScalar(sc); a.position.set(x, gy + lift + Math.sin(elapsed * 3) * 0.1 * sc, z); a.rotation.y = elapsed * 1.2; a.visible = true;
  }
  function updateArrows() {
    const on = state === 'playing';
    for (const t of terminals) { t.arrow.visible = false; if (on && !t.done && phase === 'rescue') placeArrow(t.arrow, t.x, t.z, 1.4, 0.02); }
    goalArrow.visible = false;
    if (!on || (phase === 'rescue' && decrypted < 3)) return; // while decrypting, the terminals are the markers
    const gp = goalOf(phase);
    placeArrow(goalArrow, gp.x, gp.z, phase === 'reach' || phase === 'rescue' ? 10.5 : 3.2, 0.03);
  }
  const aimMarker = makeBeacon('#00E5FF', { radius: 0.5, height: 16 }); aimMarker.visible = false; scene.add(aimMarker); // teleport pipe: only while aiming

  // ---------------------------------------------------------------- gang, civilians
  function spawnSquad(x, z, kinds) {
    kinds.forEach((k, i) => {
      const a = (i / kinds.length) * TAU + 0.5, p = open(x + Math.cos(a) * 1.4, z + Math.sin(a) * 1.4, 0.5);
      g.enemies.push(new Enemy(g, k, p.x, p.z));
    });
  }
  (() => { // squads spread over every ring of the city, plus a few waiting near each mission site
    let a = 987654; const r = () => ((a = (a * 16807) % 2147483647) / 2147483647);
    const kinds = () => (r() < 0.3 ? ['enforcer', 'thug'] : r() < 0.5 ? ['thug', 'thug', 'thug'] : ['thug', 'thug']);
    for (const [rad, n] of [[31, 1], [55, 2], [84, 4], [102, 5], [118, 5], [132, 5]]) {
      for (let i = 0; i < n; i++) {
        const deg = (i / n) * 360 + r() * (360 / n) * 0.7, p = polar(rad, deg);
        if (Math.hypot(p.x - startPos.x, p.z - startPos.z) < 30) continue;
        spawnSquad(p.x, p.z, kinds());
      }
    }
    const near = (pos, d, ks) => { const ang = Math.atan2(pos.z, pos.x) + 0.4; spawnSquad(pos.x * (1 - d / Math.hypot(pos.x, pos.z)), pos.z * (1 - d / Math.hypot(pos.x, pos.z)), ks); void ang; };
    near(hospitalPos, 12, ['thug', 'thug', 'enforcer']); near(foodPos, 12, ['thug', 'thug']);
    near(parentsPos, 14, ['captain', 'thug', 'thug']); near(exitPos, 14, ['captain', 'thug', 'thug', 'enforcer']);
  })();
  ['thug', 'thug', 'enforcer', 'thug', 'thug'].forEach((k, i, arr) => { // the execution squad, ringed around the dome
    const a = (i / arr.length) * TAU + 0.2, p = open(Math.cos(a) * 10.8, Math.sin(a) * 10.8, 0.4, { maxH: 1.5 });
    g.enemies.push(new Enemy(g, k, p.x, p.z, { guardCell: domePos }));
  });
  const civs = new Civilians(g, { count: 42 });

  // ---------------------------------------------------------------- hoverboards
  const bots = [];
  g.bots = bots;
  function addBot(x, z, y, heading, hex, kind, speed = 0) {
    const mesh = makeBot(hex, kind);
    scene.add(mesh.root);
    const b = { x, z, y, heading, speed, kind, color: hex, mesh, rider: false, bob: Math.random() * 6, cfg: BOARDS[kind], vy: 0 };
    mesh.root.position.set(x, y, z);
    bots.push(b);
    return b;
  }
  const toCore = Math.atan2(cellPos.x - startPos.x, cellPos.z - startPos.z);
  const botAt = open(startPos.x + Math.sin(toCore) * 1.8 - Math.cos(toCore) * 0.9, startPos.z + Math.cos(toCore) * 1.8 + Math.sin(toCore) * 0.9, 0.6);
  addBot(botAt.x, botAt.z, hm.h(botAt.x, botAt.z) + 0.28, toCore, '#22D3EE', 'car');
  P.face = toCore;

  // ---------------------------------------------------------------- camera (scaled to a human-sized hero)
  const cam = { yaw: P.face, pitch: 0.28, dist: 2.9, shoulder: 0.4, idle: 0, fovKick: 0, pos: new THREE.Vector3(), shake: 0 };
  g.cam = cam;
  const camDir = new THREE.Vector3(), camRight = new THREE.Vector3();
  function updateCamera(dt, instant = false) {
    const riding = P.mode === 'bot', bot = P.bot;
    const wantDist = riding ? (bot.kind === 'bus' ? 4.4 : bot.kind === 'drone' ? 3.8 : 3.5) : 2.9;
    cam.dist += (wantDist - cam.dist) * Math.min(1, dt * 5);
    if (riding) { // gentle recentre behind the board after a moment without mouse input
      if (cam.idle > 1.2 && Math.abs(bot.speed) > 3) cam.yaw = angleLerp(cam.yaw, bot.heading, dt * 2.2);
    }
    const sh = riding ? 0.12 : cam.shoulder;
    const ty = riding ? bot.y + bot.mesh.seatY + 0.55 : P.y + 0.75;
    const tx = riding ? bot.x : P.x, tz = riding ? bot.z : P.z;
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    camDir.set(Math.sin(cam.yaw) * cp, -sp, Math.cos(cam.yaw) * cp);
    camRight.set(-Math.cos(cam.yaw), 0, Math.sin(cam.yaw));
    let d = cam.dist;
    const ox = tx + camRight.x * sh, oy = ty, oz = tz + camRight.z * sh;
    for (let t = 0.4; t <= d; t += 0.2) { // pull the camera in when a building is in the way
      const x = ox - camDir.x * t, y = oy - camDir.y * t, z = oz - camDir.z
* t;
      if (hm.h(x, z) + 0.12 > y) { d = Math.max(0.5, t - 0.3); break; }
    }
    let cx = ox - camDir.x * d, cy = oy - camDir.y * d, cz = oz - camDir.z * d;
    cy = Math.max(cy, hm.h(cx, cz) + 0.25);
    if (cam.shake > 0) { cx += rnd(-1, 1) * cam.shake * 0.06; cy += rnd(-1, 1) * cam.shake * 0.06; cam.shake = Math.max(0, cam.shake - dt * 2.5); }
    if (instant) cam.pos.set(cx, cy, cz); else cam.pos.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 22));
    camera.position.copy(cam.pos);
    camera.lookAt(cam.pos.x + camDir.x * 20, cam.pos.y + camDir.y * 20, cam.pos.z + camDir.z * 20);
    cam.fovKick *= Math.exp(-6 * dt);
    const fov = 60 + cam.fovKick + (riding ? Math.max(0, Math.abs(bot.speed)) * 0.3 : 0) + (aimMode ? 6 : 0);
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
    g.camYaw = cam.yaw;
    if (g.debugCam) { camera.position.set(...g.debugCam.pos); camera.lookAt(...g.debugCam.look); } // test hook: free camera
  }

  // ---------------------------------------------------------------- combat helpers
  function hurtPlayer(dmg, from) {
    if (P.invuln > 0 || state !== 'playing') return;
    P.hp -= dmg; P.invuln = 0.9; P.sinceHit = 0; cam.shake = 0.8; hud.damageFlash(); sfx.hurt();
    if (from && P.mode === 'foot') { const d = Math.hypot(P.x - from.x, P.z - from.z) || 1; P.vx += ((P.x - from.x) / d) * 3; P.vz += ((P.z - from.z) / d) * 3; }
    if (P.hp <= 0) knockedOut();
    else if (P.hp < P.maxHp * 0.3) taunt.say('lowHp', { chance: 0.5 });
  }
  function hurtChild(dmg) {
    if (child.state === 'caged' || state !== 'playing') return;
    child.hp = Math.max(0, child.hp - dmg); child.hurt = 0.25; hud.damageFlash(); sfx.hurt(); cam.shake = 0.6; taunt.say('childHurt', { chance: 0.6 });
    if (child.hp <= 0) endGame('THE CHILD IS GONE', 'They got to the child. Next time keep them out of reach: teleport onto a roof, and shoot the riders before they close in.');
  }
  function knockedOut() {
    stats.deaths++;
    hud.toast('Overpowered. Back to the last checkpoint.', 'warn'); taunt.say('knockout', { force: true }); buddy.on('knockout');
    cancelAim();
    if (P.mode === 'bot') dismount(true);
    P.hp = P.maxHp * 0.5; P.invuln = 3; P.x = checkpoint.x; P.z = checkpoint.z; P.y = hm.h(P.x, P.z); P.vy = 0; P.vx = P.vz = 0;
    if (child.state === 'follow') { child.x = P.x + 0.6; child.z = P.z + 0.6; child.y = hm.h(child.x, child.z); }
    for (const e of g.enemies) if (e.alive && Math.hypot(e.x - P.x, e.z - P.z) < 16) { if (e.kind === 'rider') { e.alive = false; e.destroy(); } else { e.x = e.homeX; e.z = e.homeZ; e.y = hm.h(e.x, e.z); e.state = 'idle'; e.aggro = 0; } }
    cam.fovKick = 10;
  }

  const foeInReach = () => { // a foot soldier close enough in front of you to punch
    for (const e of g.enemies) {
      if (!e.alive || e.kind === 'rider') continue;
      const dx = e.x - P.x, dz = e.z - P.z, d = Math.hypot(dx, dz);
      if (d < PUNCH.range + 0.3 && Math.abs(e.y - P.y) < 1.2 && (dx * Math.sin(P.face) + dz * Math.cos(P.face)) / (d || 1) > 0) return true;
    }
    return false;
  };
  function punch() {
    if (P.atkCd > 0) return;
    P.combo = P.comboT > 0 ? (P.combo + 1) % 3 : 0; P.comboT = 0.85;
    P.atkCd = PUNCH.cd; P.atkT = 0.001;
    let best = null, bd = 2.4; // auto-aim at the nearest foot soldier in front of the camera
    for (const e of g.enemies) {
      if (!e.alive || e.kind === 'rider') continue;
      const dx = e.x - P.x, dz = e.z - P.z, d = Math.hypot(dx, dz);
      if (d > bd || Math.abs(e.y - P.y) > 1.4) continue;
      if ((dx * Math.sin(cam.yaw) + dz * Math.cos(cam.yaw)) / (d || 1) < -0.2) continue;
      best = e; bd = d;
    }
    P.face = best ? Math.atan2(best.x - P.x, best.z - P.z) : cam.yaw;
    sfx.swing();
    if (best && bd > 1.0) moveXZ(hm, P, Math.sin(P.face) * 0.3, Math.cos(P.face) * 0.3, FOOT.r, FOOT.step);
    const heavy = P.combo === 2, fx_ = Math.sin(P.face), fz_ = Math.cos(P.face);
    let hits = 0;
    for (const e of g.enemies) {
      if (!e.alive) continue;
      const dx = e.x - P.x, dz = e.z - P.z, d = Math.hypot(dx, dz);
      if (d > PUNCH.range + (e.r || 0.2) || Math.abs(e.y - P.y) > (e.kind === 'rider' ? 1.8 : 1.2)) continue;
      if ((dx * fx_ + dz * fz_) / (d || 1) < PUNCH.cone) continue;
      e.hurt(heavy ? 2 : 1, P.x, P.z, heavy ? 6 : 3);
      if (hits++ === 0) { sfx.punch(); cam.shake = Math.max(cam.shake, heavy ? 0.5 : 0.22); }
      if (hits >= 2) break;
    }
  }

  // ---------------------------------------------------------------- blaster
  const ray = new THREE.Vector3(), rdir = new THREE.Vector3();
  function aimPoint() { // where the crosshair is pointing (snapping to an enemy near it)
    camera.getWorldDirection(rdir);
    ray.copy(camera.position);
    let best = null, ba = GUN.cone;
    for (const e of g.enemies) {
      if (!e.alive) continue;
      const ex = e.x - ray.x, ey = e.y + (e.hitH || 1) * 0.5 - ray.y, ez = e.z - ray.z, d = Math.hypot(ex, ey, ez);
      if (d < 0.6 || d > 70) continue;
      const w = Math.acos(Math.min(1, (ex * rdir.x + ey * rdir.y + ez * rdir.z) / d)) * (e.kind === 'rider' ? 0.8 : 1);
      if (w < ba) { ba = w; best = e; }
    }
    if (best) return { x: best.x, y: best.y + (best.hitH || 1) * 0.5, z: best.z, locked: true };
    for (let t = 2; t < 90; t += 1) {
      const x = ray.x + rdir.x * t, y = ray.y + rdir.y * t, z = ray.z + rdir.z * t;
      if (y < hm.h(x, z)) return { x: x - rdir.x * 0.3, y: y - rdir.y * 0.3, z: z - rdir.z * 0.3 };
    }
    return { x: ray.x + rdir.x * 60, y: ray.y + rdir.y * 60, z: ray.z + rdir.z * 60 };
  }
  function fireBlaster() {
    if (P.gunCd > 0) return;
    P.gunCd = GUN.cd; P.aimT = 0.4; stats.shots++;
    const riding = P.mode === 'bot';
    if (!riding) P.face = cam.yaw; // turn to face where you shoot
    const bx = riding ? P.bot.x : P.x, bz = riding ? P.bot.z : P.z, by = (riding ? P.bot.y + P.bot.mesh.seatY : P.y) + 0.36;
    const sx = Math.sin(riding ? P.bot.heading : P.face), sz = Math.cos(riding ? P.bot.heading : P.face);
    const ox = bx + sx * 0.25, oy = by, oz = bz + sz * 0.25;
    const a = aimPoint();
    let dx = a.x - ox, dy = a.y - oy, dz = a.z - oz, L = Math.hypot(dx, dy, dz);
    if (L < 0.4 || (!a.locked && L < 2)) { dx = rdir.x; dy = rdir.y; dz = rdir.z; L = 1; } // too close to aim at: fire along the view
    dx /= L; dy /= L; dz /= L;
    proj.fire('player', ox + dx * 0.4, oy + dy * 0.4, oz + dz * 0.4, dx, dy, dz, { speed: GUN.speed, dmg: GUN.dmg, life: 1.6 });
    fx.spawn(ox + dx * 0.45, oy + dy * 0.45, oz + dz * 0.45, '#9be8ff', 0.5, 0.1);
    sfx.shoot();
  }

  // ---------------------------------------------------------------- hoverboards
  const stolenCars = [], stolenDrones = [];
  function nearestOwnBot(maxD = 2.4) {
    let best = null, bd = maxD;
    for (const b of bots) { if (b.rider) continue; const d = Math.hypot(b.x - P.x, b.z - P.z); if (d < bd && Math.abs(b.y - P.y) < 3) { best = b; bd = d; } }
    return best;
  }
  function nearestHijack(maxD = 2.6) { // a board gliding along the roads, or a sky board above them
    let best = null, bd = maxD;
    for (const v of ctx.traffic?.vehicles || []) {
      if (v.taken || !v.vis || v.px === undefined) continue;
      const d = Math.hypot(v.px - P.x, v.pz - P.z) - (v.bus ? 0.5 : 0);
      if (d < bd && Math.abs((v.py || 0) - P.y) < 1.4) { best = { kind: v.bus ? 'bus' : 'car', ref: v }; bd = d; }
    }
    for (const d of ctx.drones || []) {
      if (d.taken || !d.vis || d.px === undefined) continue;
      const dist = Math.hypot(d.px - P.x, d.pz - P.z);
      if (dist < bd + 0.8 && Math.abs(d.py - (P.y + 0.6)) < 2.2) { best = { kind: 'drone', ref: d }; bd = dist; }
    }
    return best;
  }
  function mount(b) { cancelAim(); P.mode = 'bot'; P.bot = b; b.rider = true; P.vx = P.vz = 0; cam.idle = 0; }
  function dismount(silent = false) {
    const b = P.bot; if (!b) return;
    b.rider = false; b.speed *= 0.4;
    const rx = Math.cos(b.heading), rz = -Math.sin(b.heading);
    const p = open(b.x + rx * 0.9, b.z + rz * 0.9, 0.25, { maxH: 99, maxR: 3 });
    P.x = p.x; P.z = p.z; P.y = Math.max(hm.h(p.x, p.z), b.y - b.mesh.hover); P.vy = 0; P.face = b.heading; // stepping off in mid-air: you fall
    P.mode = 'foot'; P.bot = null;
    if (!silent) sfx.tpReady();
  }
  function hijack(h) {
    const v = h.ref; v.taken = true; v.respawnAt = elapsed + 50;
    const hex = v.color || '#3A86FF';
    const b = addBot(v.px, v.pz, (v.py || 0) + (h.kind === 'drone' ? 0 : 0.28), Math.atan2(v.dx, v.dz), hex, h.kind, Math.min(v.speed || 4, 6));
    (h.kind === 'drone' ? stolenDrones : stolenCars).push(v);
    P.x = v.px; P.z = v.pz; P.y = hm.h(v.px, v.pz);
    mount(b); stats.hijacks++; sfx.hijack(); fx.spawn(v.px, (v.py || 0) + 0.4, v.pz, hex, 2, 0.4);
    taunt.say('hijack', { chance: 0.5 }); buddy.on('hijack');
    P.cd = 0; hud.toast(h.kind === 'drone' ? 'Sky board hijacked. Teleport recharged' : h.kind === 'bus' ? 'Long board hijacked. Teleport recharged' : 'Hoverboard hijacked. Teleport recharged', 'good');
  }

  let civToast = 0;
  function updateBot(b, dt) {
    const c = b.cfg;
    if (b.rider) {
      const thr = input.axis('KeyS', 'KeyW'), steer = input.axis('KeyD', 'KeyA'); // +1 = left
      if (thr > 0) b.speed += c.acc * dt * (b.speed < 0 ? 2 : 1);
      else if (thr < 0) b.speed -= c.acc * dt * (b.speed > 0 ? 1.8 : 0.7);
      else b.speed -= Math.sign(b.speed) * Math.min(Math.abs(b.speed), 5 * dt);
      if (input.down('Space')) b.speed -= Math.sign(b.speed) * Math.min(Math.abs(b.speed), 24 * dt);
      b.speed = THREE.MathUtils.clamp(b.speed, -c.rev, c.max * (input.down('ShiftLeft') ? 1.18 : 1));
      b.heading += steer * c.turn * THREE.MathUtils.clamp(Math.abs(b.speed) / 4, 0, 1) * (1 - 0.3 * Math.abs(b.speed) / c.max) * (b.speed < 0 ? -1 : 1) * dt;
    } else b.speed *= Math.exp(-1.8 * dt);
    const sx = Math.sin(b.heading), sz = Math.cos(b.heading);
    const r = moveXZ(hm, b, sx * b.speed * dt, sz * b.speed * dt, c.r, c.step);
    if (r.blocked && Math.abs(b.speed) > 2) {
      if (Math.abs(b.speed) > 7 && b.rider) { cam.shake = 0.7; sfx.hit(); fx.spawn(b.x + sx * 0.8, b.y + 0.3, b.z + sz * 0.8, '#ffffff', 1.2, 0.25); }
      b.speed *= -0.25;
    }
    const ground = hm.h(b.x, b.z), floor = ground + b.mesh.hover;
    if (b.rider) { // look up / down to climb / dive: the board follows the camera pitch
      const look = 0.24 - cam.pitch; // positive = looking up
      if (Math.abs(look) > CLIMB.deadzone) b.y += THREE.MathUtils.clamp(look * 2, -1, 1) * (2.5 + Math.abs(b.speed) * 0.8) * dt;
      b.y = THREE.MathUtils.clamp(b.y, floor, ground + CLIMB.max);
    } else b.y += (floor + Math.sin(elapsed * 3 + b.bob) * 0.03 - b.y) * Math.min(1, dt * 3);
    const m = b.mesh.root;
    m.position.set(b.x, b.y, b.z); m.rotation.y = b.heading;
    b.mesh.lift.rotation.z = THREE.MathUtils.lerp(b.mesh.lift.rotation.z, -(b.rider ? input.axis('KeyD', 'KeyA') : 0) * Math.min(1, Math.abs(b.speed) / 10) * 0.3, Math.min(1, dt * 8));
    if (b.rider && b.speed > 5) {
      for (const e of g.enemies) { // run people over
        if (!e.alive) continue;
        const dx = e.x - b.x, dz = e.z - b.z, along = dx * sx + dz * sz;
        if (along < -0.2 || along > b.mesh.halfLen + 0.5 || Math.abs(dx * sz - dz * sx) > c.r + (e.r || 0.2) || Math.abs(e.y - b.y) > 1.8) continue;
        e.hurt(b.kind === 'bus' ? 3 : 2, b.x - sx * 2, b.z - sz * 2, 7);
        b.speed *= 0.85; stats.rams++; cam.shake = 0.5; sfx.hit();
      }
      for (const cv of civs.list) { // ...but not civilians: they jump aside, and you hear about it
        if (cv.state === 'down') continue;
        const dx = cv.x - b.x, dz = cv.z - b.z, along = dx * sx + dz * sz;
        if (along > -0.2 && along < b.mesh.halfLen + 0.4 && Math.abs(dx * sz - dz * sx) < c.r + 0.15 && Math.abs(cv.y - b.y) < 1.8) {
          civs.knock(cv, b.x, b.z); stats.civHits++; b.speed *= 0.9;
          if (elapsed - civToast > 3) { civToast = elapsed; hud.toast('Watch the civilians!', 'warn'); }
        }
      }
    }
  }

  // ---------------------------------------------------------------- teleport: press to aim (the pipe appears), press again to jump
  const aim = { state: 'none', x: 0, y: 0, z: 0 };
  let aimMode = false, aimT = 0, qHeld = 0, qWas = false;
  const tray = new THREE.Vector3(), tdir = new THREE.Vector3();
  function snapFlat(x, z, y) { // nearest flat, similar-height spot within a few units of where the crosshair lands
    for (let rr = 0.4; rr <= 2.4; rr += 0.4) {
      const n = Math.max(6, Math.round(rr * 10));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU, px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr, ph = hm.h(px, pz);
        if (Math.abs(ph - y) < 0.5 && hm.isFlat(px, pz, 0.25, 0.4)) return { x: px, z: pz, y: ph };
      }
    }
    return null;
  }
  function computeAim() {
    camera.getWorldDirection(tdir);
    tray.copy(camera.position);
    let prevT = 0, hit = -1;
    for (let t = 0.8; t < 170; t += 0.4) {
      const x = tray.x + tdir.x * t, y = tray.y + tdir.y * t, z = tray.z + tdir.z * t;
      if (y < hm.h(x, z)) { hit = t; break; }
      prevT = t;
    }
    if (hit < 0) { aim.state = 'none'; return; }
    let lo = prevT, hi = hit;
    for (let i = 0; i < 6; i++) { const mid = (lo + hi) / 2; (tray.y + tdir.y * mid < hm.h(tray.x + tdir.x * mid, tray.z + tdir.z * mid)) ? (hi = mid) : (lo = mid); }
    let x = tray.x + tdir.x * hi, z = tray.z + tdir.z * hi;
    const hy = tray.y + tdir.y * hi;
    if (hm.h(x, z) - hy > 0.3) { const hl = Math.hypot(tdir.x, tdir.z) || 1; x += (tdir.x / hl) * 0.6; z += (tdir.z / hl) * 0.6; } // a wall: land just inside, on top
    let y = hm.h(x, z);
    if (!hm.isFlat(x, z, 0.25, 0.4)) { const s = snapFlat(x, z, y); if (s) { x = s.x; z = s.z; y = s.y; } }
    aim.x = x; aim.y = y; aim.z = z;
    const d = Math.hypot(x - P.x, z - P.z, (y - P.y) * 0.5);
    aim.state = d <= TP.range && hm.isFlat(x, z, 0.25, 0.4) && Math.hypot(x, z) < 152 ? 'ok' : 'bad';
  }
  function beginAim() {
    if (P.cd > 0) { hud.toast(`Teleport recharging (${Math.ceil(P.cd)}s)`); return; }
    aimMode = true; aimT = 0; sfx.tpReady();
  }
  function cancelAim() { aimMode = false; aimMarker.visible = false; }
  function confirmTeleport() {
    if (aim.state !== 'ok') { hud.toast(aim.state === 'bad' ? 'No landing there. Aim at a roof or road' : 'Aim at a roof or road', 'warn'); return; }
    teleport();
  }
  function teleport() {
    const riding = P.mode === 'bot', b = P.bot;
    const fx0 = riding ? b.x : P.x, fz0 = riding ? b.z : P.z, fy0 = riding ? b.y : P.y;
    aimMode = false; aimMarker.visible = false;
    const bringBot = riding && hm.isFlat(aim.x, aim.z, b.cfg.r + 0.2, 0.4); // your board comes along when there is room
    if (riding && !bringBot) dismount(true);
    flashAt(flashCols[0], fx0, fy0, fz0); flashAt(flashCols[1], aim.x, aim.y, aim.z);
    fx.spawn(fx0, fy0 + 0.5, fz0, '#00E5FF', 2.4, 0.45); fx.spawn(aim.x, aim.y + 0.5, aim.z, '#9be8ff', 2.8, 0.5, 1);
    if (bringBot) { b.x = aim.x; b.z = aim.z; b.y = aim.y + b.mesh.hover; P.x = b.x; P.z = b.z; P.y = b.y; }
    else { P.x = aim.x; P.z = aim.z; P.y = aim.y + 0.02; P.vy = 0; P.vx = P.vz = 0; P.onGround = true; }
    P.cd = TP.cooldown; P.invuln = TP.iframes; stats.teleports++;
    if (child.state === 'follow') {
      const a = cam.yaw + 2.4; child.x = P.x + Math.sin(a) * 0.7; child.z = P.z + Math.cos(a) * 0.7; child.y = Math.max(hm.h(child.x, child.z), P.y);
      if (hm.h(child.x, child.z) < P.y - 0.5) { child.x = P.x - 0.5; child.z = P.z; child.y = P.y; }
    }
    sfx.teleport(); hud.tpFlash(); cam.fovKick = 16; cam.shake = 0.3; taunt.say('teleport', { chance: 0.35 }); buddy.on('teleport');
    updateCamera(0.05, true); // cut with the hero so the hop reads as instant
  }
  function flashAt(col, x, y, z) { col.position.set(x, y + 3.5, z); col.userData.t = 0; col.visible = true; }

  // ---------------------------------------------------------------- on-foot control
  function updateFoot(dt) {
    const ix = input.axis('KeyA', 'KeyD'), iz = input.axis('KeyS', 'KeyW');
    const f = { x: Math.sin(cam.yaw), z: Math.cos(cam.yaw) }, r = { x: -Math.cos(cam.yaw), z: Math.sin(cam.yaw) };
    let mx = f.x * iz + r.x * ix, mz = f.z * iz + r.z * ix;
    const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
    const sp = (input.down('ShiftLeft') || input.down('ShiftRight') ? FOOT.sprint : FOOT.walk) * (P.atkT > 0 ? 0.45 : 1);
    const ctl = P.onGround ? 1 : 0.55;
    P.vx += (mx * sp - P.vx) * Math.min(1, FOOT.accel * dt * ctl);
    P.vz += (mz * sp - P.vz) * Math.min(1, FOOT.accel * dt * ctl);
    const res = moveXZ(hm, P, P.vx * dt, P.vz * dt, FOOT.r, FOOT.step);
    if (res.hit && P.onGround && ml > 0.3 && res.ledge > FOOT.step && res.ledge <= FOOT.vault) P.vy = Math.sqrt(2 * GRAVITY * (res.ledge + 0.25)); // hop up a ledge
    if (input.pressed('Space') && P.onGround) { P.vy = FOOT.jump; P.onGround = false; }
    stepVertical(hm, P, dt);
    const spd = Math.hypot(P.vx, P.vz);
    if (spd > 0.6 && P.atkT <= 0 && P.aimT <= 0) P.face = angleLerp(P.face, Math.atan2(P.vx, P.vz), dt * 14);
    P.moving = spd / FOOT.sprint;
  }

  // ---------------------------------------------------------------- child
  function updateChild(dt) {
    const c = child, h = c.h;
    if (c.state === 'caged') {
      c.y = hm.h(c.x, c.z);
      setPose(h, { sit: true, moving: 0, look: -0.15 + Math.sin(elapsed * 2) * 0.05 }, dt);
      h.root.position.set(c.x, c.y, c.z); h.root.rotation.y = Math.atan2(-c.x, -c.z) + 0.6;
      return;
    }
    if (c.state === 'station' || c.state === 'parents') { // sits at the hospital bed / food stall, or stands with the parents
      const sit = c.state === 'station';
      setPose(h, { sit, moving: 0, look: -0.1 }, dt);
      if (c.eating) { h.armR.rotation.x = -1.6 + Math.sin(elapsed * 7) * 0.35; h.armL.rotation.x = -1.2; }
      h.root.position.set(c.x, c.y, c.z); h.root.rotation.y = c.face;
      if (c.hurt > 0) { c.hurt -= dt; flash(h, c.hurt > 0.12); } else flash(h, false);
      return;
    }
    let moving = 0, stand = false;
    if (P.mode === 'bot') { // rides behind the hero, standing on the same board
      const b = P.bot, sx = Math.sin(b.heading), sz = Math.cos(b.heading);
      c.x = b.x - sx * 0.32; c.z = b.z - sz * 0.32; c.y = b.y + b.mesh.seatY; c.face = b.heading; stand = true;
    } else {
      const back = { x: P.x - Math.sin(P.face) * 0.75 + Math.cos(P.face) * 0.3, z: P.z - Math.cos(P.face) * 0.75 - Math.sin(P.face) * 0.3 };
      const dx = back.x - c.x, dz = back.z - c.z, d = Math.hypot(dx, dz);
      if (d > 9) { c.x = P.x; c.z = P.z; c.y = P.y; }
      else if (d > 0.22) {
        const sp = Math.min(c.fed ? 5.8 : 5.4, 1.2 + d * 3.5);
        moveXZ(hm, c, (dx / d) * sp * dt, (dz / d) * sp * dt, 0.14, 0.32);
        c.face = angleLerp(c.face, Math.atan2(dx, dz), dt * 12); moving = Math.min(1, sp / 5);
      } else c.face = angleLerp(c.face, P.face, dt * 4);
      stepVertical(hm, c, dt);
      if (c.y < hm.h(c.x, c.z) - 0.01) c.y = hm.h(c.x, c.z);
    }
    if (c.hurt > 0) { c.hurt -= dt; flash(h, c.hurt > 0.12); } else flash(h, false);
    setPose(h, { stand, moving, stagger: c.hurt > 0 }, dt);
    h.root.position.set(c.x, c.y, c.z); h.root.rotation.y = c.face;
  }

  // ---------------------------------------------------------------- missions
  let holdT = 0, chaseTimer = 8, riderNote = 0;
  const station = { on: false, kind: null, t: 0, dur: 0, label: '' };
  const alive = () => g.enemies.filter((e) => e.alive);
  const near = (e, p, r) => Math.hypot(e.x - p.x, e.z - p.z) < r;
  const guardsNear = (p, r = 10) => g.enemies.filter((e) => e.alive && e.kind !== 'rider' && near(e, p, r));
  const activeRiders = () => g.enemies.filter((e) => e.alive && e.kind === 'rider').length;

  function spawnChaser(minD = 38, maxD = 68) {
    const cands = roadPts.filter((p) => { const d = Math.hypot(p.x - P.x, p.z - P.z); return d > minD && d < maxD; });
    const p = cands.length ? cands[Math.floor(Math.random() * cands.length)] : open(P.x + 40, P.z, 1);
    g.enemies.push(new Chaser(g, p.x, p.z, Math.atan2(P.x - p.x, P.z - p.z)));
  }
  function spawnAmbush(center, thugs, riders) {
    for (let i = 0; i < thugs; i++) {
      const a = Math.random() * TAU, d = rnd(12, 18), p = open(center.x + Math.cos(a) * d, center.z + Math.sin(a) * d, 0.5);
      g.enemies.push(new Enemy(g, 'thug', p.x, p.z, { aggro: 1 }));
    }
    for (let i = 0; i < riders; i++) spawnChaser(26, 50);
    sfx.alarm(); hud.toast('Ambush! Protect the child', 'warn');
  }

  function startStation(kind, pos, dur, label) {
    station.on = true; station.kind = kind; station.t = 0; station.dur = dur; station.label = label; holdT = 0;
    const c = child;
    c.state = 'station'; c.eating = kind === 'food';
    const a = faceCore(pos), s = kind === 'hospital' ? 0.85 : 0;
    c.x = pos.x + Math.sin(a + 1.5708) * s; c.z = pos.z + Math.cos(a + 1.5708) * s;
    c.y = hm.h(c.x, c.z) + (kind === 'hospital' ? 0.45 : 0); c.face = a;
    spawnAmbush(pos, kind === 'hospital' ? 2 : 3, 1);
  }
  function finishStation() {
    const kind = station.kind; station.on = false; child.eating = false;
    child.state = 'follow'; child.y = hm.h(child.x, child.z); child.hurt = 0;
    checkpoint = { x: P.x, z: P.z };
    sfx.pickup();
    if (kind === 'hospital') { child.hp = 100; phase = 'food'; hud.toast('Doctor: "She is stable. She needs to eat something."', 'good'); taunt.say('hospital', { force: true }); buddy.on('hospitalDone'); }
    else { child.hp = Math.min(100, child.hp + 25); child.fed = true; phase = 'parents'; hud.toast('"Thank you... can we go home now?"', 'good'); taunt.say('food', { force: true }); buddy.on('foodDone'); }
    placeBeacon(); autoSave();
  }

  function nearestTerminal(r = 1.7) {
    let best = null, bd = r;
    for (const t of terminals) { if (t.done) continue; const d = Math.hypot(P.x - t.x, P.z - t.z); if (d < bd && Math.abs(P.y - hm.h(t.x, t.z)) < 1.5) { best = t; bd = d; } }
    return best;
  }
  function decryptTerminal(t) {
    t.done = true; t.hold = 0; decrypted++; g.decrypted = decrypted; setTerminalState(t.obj, 'done'); buddy.on('decrypt');
    fx.spawn(t.x, hm.h(t.x, t.z) + 0.8, t.z, '#00F5A0', 2.2, 0.5); sfx.pickup();
    if (decrypted >= 3) {
      cellMat.color.set('#00F5A0'); cellRing.material = glowMat('#00F5A0');
      fx.spawn(cellPos.x, floorY + 0.6, cellPos.z, '#00F5A0', 4, 0.7); sfx.pickup();
      hud.toast('Dome decrypted. Go in and release the child', 'good');
    } else { hud.toast(`Terminal decrypted (${decrypted}/3)`, 'good'); taunt.say('decrypt', { chance: 0.7 }); }
  }
  const interactBusy = () => {
    if (child.state === 'caged' && Math.hypot(P.x - cellPos.x, P.z - cellPos.z) < 9) return true;
    if ((phase === 'hospital' || phase === 'food') && child.state === 'follow' && Math.hypot(P.x - goalOf(phase).x, P.z - goalOf(phase).z) < 6) return true;
    if (phase === 'parents' && Math.hypot(P.x - parentsPos.x, P.z - parentsPos.z) < 6) return true;
    return false;
  };

  let waveT = 3, riderT = 25, lastShotTaunt = 0, lastKills = 0, huntT = 10;
  function spawnHunters(n) { // gang foot soldiers close in from the streets around you
    const cands = roadPts.filter((p) => { const d = Math.hypot(p.x - P.x, p.z - P.z); return d > 26 && d < 42; });
    for (let i = 0; i < n; i++) {
      const p = cands.length ? cands[Math.floor(Math.random() * cands.length)] : open(P.x + 30, P.z, 0.5);
      g.enemies.push(new Enemy(g, Math.random() < 0.25 ? 'sprinter' : 'thug', p.x + rnd(-1.5, 1.5), p.z + rnd(-1.5, 1.5), { aggro: 1 }));
    }
  }
  function domeWaves(dt) { // the gang never stops arriving while the child is held: keep a ring of guards around the dome
    if (!g.hostile) return;
    waveT -= dt;
    const ring = g.enemies.filter((e) => e.alive && e.kind !== 'rider' && Math.hypot(e.x, e.z) < 20).length;
    if (waveT <= 0 && ring < 6) {
      waveT = 5;
      for (let tries = 0; tries < 8; tries++) {
        const a = Math.random() * TAU, p = open(Math.cos(a) * 11.2, Math.sin(a) * 11.2, 0.4, { maxH: 1.5 });
        if (Math.hypot(p.x - P.x, p.z - P.z) < 6) continue;
        g.enemies.push(new Enemy(g, Math.random() < 0.2 ? 'enforcer' : 'thug', p.x, p.z, { guardCell: domePos })); break;
      }
    }
    riderT -= dt;
    if (riderT <= 0) { riderT = 30; if (activeRiders() < 2) spawnChaser(26, 46); }
  }

  function updateMission(dt) {
    const dcell = Math.hypot(P.x - cellPos.x, P.z - cellPos.z), ddome = Math.hypot(P.x, P.z);
    let prompt = null, hold = 0;

    if (child.state === 'caged') {
      if (g.hostile) { // the clock on the child: every guard still "executing" drains their health
        const n = g.enemies.filter((e) => e.alive && e.guardCell).length;
        if (n) { child.hp = Math.max(0, child.hp - n * DRAIN_PER_GUARD * dt); if (child.hp <= 0) endGame('TOO LATE', 'The gang finished what they started. Move faster: hijack a hoverboard or teleport across the rooftops.'); }
      }
      if (phase === 'reach' && ddome < 75) buddy.on('reach');
      if (phase === 'reach' && ddome < 34) { phase = 'rescue'; hud.toast('Gang guards surround the dome. Find the 3 terminals outside it', 'warn'); buddy.on('rescue'); }
      if (P.mode === 'foot' && ddome < 22) {
        const term = decrypted < 3 ? nearestTerminal() : null;
        if (term) {
          prompt = `Hold to decrypt the dome (${decrypted + 1}/3)`;
          if (input.down('KeyF') && P.sinceHit > 0.6) { // taking a hit breaks the connection
            term.hold += dt; setTerminalState(term.obj, 'hacking');
            if (term.hold >= TERM_HOLD) decryptTerminal(term);
          } else { term.hold = 0; if (!term.done) setTerminalState(term.obj, 'locked'); }
          hold = term.hold / TERM_HOLD;
        } else if (decrypted >= 3 && dcell < 1.8) {
          prompt = 'Hold to release the child';
          if (input.down('KeyF')) { holdT += dt; if (holdT >= FREE_HOLD) freeChild(); } else holdT = Math.max(0, holdT - dt * 2);
          hold = holdT / FREE_HOLD;
        } else if (decrypted < 3 && ddome < 16) prompt = 'Find the terminals outside the dome';
        else if (decrypted >= 3 && ddome < 16) prompt = 'Enter the dome: the child is in the centre';
      }
      domeWaves(dt);
    }

    // hospital and food stall: hold F to hand the child over, then keep them safe while it happens
    if (station.on) {
      const pos = station.kind === 'hospital' ? hospitalPos : foodPos;
      const there = Math.hypot(P.x - pos.x, P.z - pos.z) < 12;
      if (there) station.t += dt;
      hud.progress(there ? station.label : 'Stay close to the child', station.t / station.dur);
      if (station.t >= station.dur) { hud.progress(null); finishStation(); }
      holdT = 0;
    } else {
      hud.progress(null);
      if ((phase === 'hospital' || phase === 'food') && child.state === 'follow') {
        const pos = goalOf(phase);
        if (Math.hypot(P.x - pos.x, P.z - pos.z) < 5 && Math.hypot(child.x - pos.x, child.z - pos.z) < 6) {
          prompt = phase === 'hospital' ? 'Hold to hand the child to the medics' : 'Hold to buy food for the child';
          if (input.down('KeyF')) { holdT += dt; if (holdT >= 1.1) { if (phase === 'hospital') startStation('hospital', pos, 25, 'Treating the child…'); else startStation('food', pos, 30, 'The child is eating…'); } } else holdT = Math.max(0, holdT - dt * 2);
          hold = holdT / 1.1;
        } else holdT = 0;
      }
      if (phase === 'parents' && child.state === 'follow' && Math.hypot(P.x - parentsPos.x, P.z - parentsPos.z) < 6) {
        prompt = 'Talk to the parents'; if (input.pressed('KeyF')) { startParentsScene(); prompt = null; }
      }
    }

    // board prompts
    if (!prompt && state === 'playing') {
      if (P.mode === 'bot') prompt = 'Step off the board';
      else { const ob = nearestOwnBot(); const h = !ob && nearestHijack(); if (ob) prompt = 'Ride your hoverboard'; else if (h) prompt = h.kind === 'drone' ? 'Hijack sky board' : h.kind === 'bus' ? 'Hijack long board' : 'Hijack hoverboard'; }
    }
    hud.prompt(aimMode ? null : prompt, hold);

    // pursuit: gang riders keep coming once the child is free
    if (g.alarm && g.hostile && state === 'playing') {
      chaseTimer -= dt; huntT -= dt;
      const cap = CHASER_CAP[phase] || 2;
      if (huntT <= 0) { huntT = 16 + Math.random() * 10; if (g.enemies.filter((e) => e.alive && e.kind !== 'rider' && e.state !== 'idle').length < 9) spawnHunters(2 + (Math.random() < 0.4 ? 1 : 0)); }
      if (chaseTimer <= 0) { chaseTimer = 11 + Math.random() * 6; if (activeRiders() < cap) { spawnChaser(); if (!riderNote) { riderNote = 1; hud.toast('Gang riders on floating hoverboards! They shoot, and they can follow you over rooftops', 'warn'); taunt.say('riders', { force: true }); buddy.on('riders'); } } }
    }
    return prompt;
  }

  function freeChild() {
    child.state = 'follow'; holdT = 0; phase = 'hospital'; g.alarm = true;
    cell.visible = false; checkpoint = { x: P.x, z: P.z }; placeBeacon();
    fx.spawn(cellPos.x, child.y + 0.6, cellPos.z, '#00F5A0', 4, 0.6);
    sfx.pickup(); setTimeout(() => sfx.alarm(), 400);
    hud.toast('Child freed. The gang is after you!', 'good'); taunt.say('release', { force: true }); buddy.on('free'); setTimeout(() => buddy.on('hospital'), 7000);
    for (let i = 0; i < 4; i++) { // fast followers spill out around the dome
      const a = (i / 4) * TAU + 0.8, p = open(Math.cos(a) * 11.5, Math.sin(a) * 11.5, 0.4, { maxH: 1.5 });
      g.enemies.push(new Enemy(g, 'sprinter', p.x, p.z, { aggro: 1 }));
    }
    spawnChaser(30, 55);
    for (const e of g.enemies) if (e.alive && Math.hypot(e.x - P.x, e.z - P.z) < 45) e.aggro = 1;
    chaseTimer = 14; autoSave();
  }

  // ---------------------------------------------------------------- the parents, then the exit
  function startParentsScene() {
    state = 'dialogue'; cancelAim(); input.unlock(); sfx.pickup(); hud.prompt(null, 0); hud.progress(null); taunt.say('parents', { force: true }); buddy.on('parents');
    child.state = 'parents'; child.x = parentsPos.x - Math.sin(pf) * 0.9; child.z = parentsPos.z - Math.cos(pf) * 0.9; child.y = hm.h(child.x, child.z); child.face = pf + Math.PI;
    if (P.mode === 'bot') dismount(true);
    const say = (who, text, next) => hud.dialogue(who, text, [], next);
    say('MOTHER', '"Tara! Oh... oh, thank God. Come here. Come here."', () =>
      say('FATHER', '"They told us the Core had gone dark. That nobody was coming out."', () =>
        say('MOTHER', '"You brought her all the way across the city? Who are you?"', () =>
          hud.dialogue('YOU', 'What do you say?', [
            { label: '"She is safe now. That is all that matters."', onPick: () => afterParents('safe') },
            { label: '"The people who took her are still inside the city."', onPick: () => afterParents('more') },
          ]))));
  }
  function afterParents(kind) {
    choice = kind;
    const line = kind === 'safe'
      ? '"Then we owe you everything. But they know her face now. Get her out through the south gate. We will be right behind you."'
      : '"Then this is not over. Get her out through the south gate first. Please. We will find you on the other side."';
    hud.dialogue('FATHER', line, [], () => {
      hud.closeDialogue();
      state = 'playing'; input.lock();
      child.state = 'follow'; child.y = hm.h(child.x, child.z);
      phase = 'exit'; checkpoint = { x: P.x, z: P.z }; placeBeacon();
      hud.toast('Get the child out through the south gate', 'good'); taunt.say('exit', { force: true }); buddy.on('exit');
      chaseTimer = 6; autoSave();
    });
  }

  function endGame(title, line) { // failure only; success goes through chapterComplete()
    if (state === 'won' || state === 'lost' || state === 'chapter') return;
    state = 'lost';
    cancelAim(); input.unlock(); sfx.engine(0, false); sfx.lose();
    hud.prompt(null, 0); hud.progress(null); hud.closeDialogue();
    hud.showEnd(false, title, line, [['Time', fmtTime(elapsed)], ['Takedowns', stats.takedowns], ['Teleports', stats.teleports], ['Knockouts', stats.deaths]], () => location.reload());
    hud.el.end.classList.remove('hidden');
  }

  // ---------------------------------------------------------------- saving
  const snapshot = () => ({ v: 1, phase, decrypted, hp: P.hp, childHp: child.hp, fed: child.fed, x: P.x, z: P.z, elapsed, stats: { ...stats }, choice });
  const refreshAccountUi = () => hud.setAccount(getAccount(), !!loadGame());
  function doSave(quiet = false) {
    if (state !== 'playing' && state !== 'paused') return false;
    const ok = saveGame(snapshot());
    refreshAccountUi();
    if (!quiet) hud.toast(ok ? 'Progress saved' : 'Could not save on this device', ok ? 'good' : 'warn');
    return ok;
  }
  const autoSave = () => { if (getAccount()) doSave(true); };
  function openAccountModal() {
    const was = state; // the game freezes while the account form is open
    if (state === 'playing') { state = 'paused'; cancelAim(); sfx.engine(0, false); input.reset(); input.unlock(); }
    hud.showAccountModal({
      onClose: () => { if (was === 'playing' && state === 'paused') { input.reset(); state = 'playing'; input.lock(); } },
      account: getAccount(), savedAt: loadGame()?.savedAt,
      onCreate: async (f) => { await createAccount(f, { chapter: 0 }); refreshAccountUi(); doSave(); },
      onSave: () => { if (!doSave()) hud.toast('Start playing, then save'); },
      onSignOut: () => { signOut(); refreshAccountUi(); hud.setContinue(null); hud.setWelcome(''); },
    });
  }
  function saveFlow() { if (getAccount()) doSave(); else openAccountModal(); } // no account yet: create one, then save
  function applySave(sv) {
    elapsed = sv.elapsed || 0; Object.assign(stats, sv.stats || {}); choice = sv.choice || null;
    phase = sv.phase; decrypted = sv.decrypted || 0; g.decrypted = decrypted;
    terminals.forEach((t, i) => { if (i < decrypted) { t.done = true; setTerminalState(t.obj, 'done'); } });
    if (decrypted >= 3) { cellMat.color.set('#00F5A0'); cellRing.material = glowMat('#00F5A0'); }
    const p = open(sv.x, sv.z, 0.3, { maxH: 99, maxR: 6 });
    P.x = p.x; P.z = p.z; P.y = hm.h(p.x, p.z); P.hp = sv.hp ?? P.hp; checkpoint = { x: P.x, z: P.z };
    child.hp = sv.childHp ?? 100; child.fed = !!sv.fed;
    if (phase !== 'reach' && phase !== 'rescue') { // the child was already freed
      child.state = 'follow'; child.x = P.x + 0.6; child.z = P.z; child.y = P.y; cell.visible = false; g.alarm = true;
      for (const e of g.enemies) if (e.guardCell) { e.alive = false; e.destroy(); }
    }
    placeBeacon();
  }

  function chapterComplete() {
    if (state === 'chapter') return;
    state = 'chapter';
    cancelAim(); input.unlock(); sfx.engine(0, false); sfx.win();
    hud.prompt(null, 0); hud.progress(null); hud.closeDialogue();
    const completedAt = Date.now();
    const progress = { chapter: 1, completedAt, choice, stats: { ...stats, time: Math.round(elapsed), childHp: Math.round(child.hp) } };
    clearSave(); // the chapter is done: no mid-game save to continue
    if (getAccount()) completeChapter(progress);
    const acc = getAccount();
    hud.showChapter({
      stats: [['Time', fmtTime(elapsed)], ['Child health', `${Math.round(child.hp)}%`], ['Takedowns', stats.takedowns], ['Shots fired', stats.shots], ['Teleports', stats.teleports], ['Boards hijacked', stats.hijacks]],
      teaser: 'The gate closes behind you, but the child said a name on the way out: the one the gang kept calling the boss. Whoever ordered all of this is still somewhere inside the city.<br><br><b>Come back tomorrow for Chapter 2: The Network.</b> Create an account below so your progress is waiting for you.',
      account: acc, nextMs: msUntilNextChapter(acc) ?? 0,
      onCreate: async (f) => { const a = await createAccount(f, progress); refreshAccountUi(); return a; },
      onReplay: () => location.reload(),
    });
  }

  // ---------------------------------------------------------------- loop
  // Dynamic resolution: start at full resolution and only step down when the frame rate stays low for a few seconds (the first
  // seconds are ignored: shaders are still compiling). It climbs back up when there is headroom, so a brief hitch never leaves
  // the picture soft for good.
  let fpsEma = 60, fpsAcc = 0, hudFrame = 0, dyn = 1, lowT = 0, highT = 0, msaaOff = false;
  function applyScale(v) { dyn = v; controls.renderScale = v; ctx.resize(); }
  function adapt(dt) {
    if (params.has('hq')) return;
    fpsEma += ((1 / Math.max(dt, 1e-3)) - fpsEma) * 0.04;
    if (elapsed < 10) return;
    if (fpsEma < 26) { lowT += dt; highT = 0; } else if (fpsEma > 52) { highT += dt; lowT = 0; } else { lowT = highT = 0; }
    if (lowT > 4 && dyn > 0.6) { applyScale(Math.max(0.6, +(dyn - 0.1).toFixed(2))); lowT = 0; fpsEma = 38; }
    else if (highT > 10 && dyn < 1) { applyScale(Math.min(1, +(dyn + 0.1).toFixed(2))); highT = 0; fpsEma = 45; }
    if (dyn <= 0.7 && !msaaOff) { msaaOff = true; composer.renderTarget1.samples = composer.renderTarget2.samples = 0; composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); }
    if (dyn <= 0.6 && fpsEma < 22 && bloom.enabled) bloom.enabled = false;
  }
  function titleCamera(t) {
    const a = t * 0.07 + 0.6, r = 74;
    camera.position.set(Math.cos(a) * r, 40 + Math.sin(t * 0.2) * 4, Math.sin(a) * r);
    camera.lookAt(0, 7, 0);
  }

  function setArmed(on) { // scroll the mouse wheel (or press 1 / 2) to draw or holster the Punch Gun
    if (on === armed) return;
    armed = on; hero.gun.visible = on; hud.setWeapon(on ? 'PUNCH GUN' : 'FISTS', on);
    sfx.draw?.(); fx.spawn(P.x, P.y + 0.5, P.z, on ? '#9be8ff' : '#ffffff', 1.2, 0.2);
    if (on) { buddy.on('draw'); hud.toast('Punch Gun drawn. Scroll again to holster'); }
  }

  function frame(t, dt) {
    g.time = t;
    if (state === 'loading' || state === 'title' || state === 'won' || state === 'lost' || state === 'chapter') {
      titleCamera(t);
      hero.root.visible = !(state === 'title' || state === 'loading');
      input.endFrame();
      return;
    }
    if (state === 'paused') { input.endFrame(); return; }
    if (state === 'dialogue') { // the world holds its breath; pick with 1 / 2 / Enter
      if (hud.dialogueOpen) {
        const single = (hud._dlgItems?.length || 0) === 1;
        if (input.pressed('Digit1') || (single && (input.pressed('Enter') || input.pressed('Space') || input.pressed('KeyF')))) hud.dialoguePick(0);
        else if (input.pressed('Digit2')) hud.dialoguePick(1);
      }
      updateChild(dt); updateCamera(dt); fx.update(dt); input.endFrame();
      return;
    }

    elapsed += dt;
    const wdt = aimMode ? dt * TP.slowmo : dt; // time slows while you aim a teleport
    const ls = 0.0023;
    cam.yaw -= input.state.dx * ls + input.axis('ArrowLeft', 'ArrowRight') * 2.2 * dt; // right arrow / mouse right turns right
    cam.pitch = THREE.MathUtils.clamp(cam.pitch + input.state.dy * ls + input.axis('ArrowUp', 'ArrowDown') * 1.4 * dt, -0.7, 1.15);
    if (input.state.dx || input.state.dy || input.axis('ArrowLeft', 'ArrowRight')) cam.idle = 0; else cam.idle += dt;

    // timers
    P.cd = Math.max(0, P.cd - dt); P.invuln = Math.max(0, P.invuln - dt); P.atkCd = Math.max(0, P.atkCd - dt); P.gunCd = Math.max(0, P.gunCd - dt); P.aimT = Math.max(0, P.aimT - dt);
    P.sinceHit += dt;
    if (P.atkT > 0) { P.atkT += dt; if (P.atkT > 0.28) P.atkT = 0; }
    if (P.comboT > 0) P.comboT -= dt;
    if (P.cd <= 0 && P._wasCd) sfx.tpReady();
    P._wasCd = P.cd > 0;

    // teleport input: tap Q (or right mouse) to aim, tap again (or left click) to jump; hold and release also jumps
    const qDown = input.down('KeyQ') || input.state.rmb;
    if (input.pressed('KeyQ') || input.state.rmbEdge) { if (!aimMode) beginAim(); else confirmTeleport(); qHeld = 0; }
    else if (qDown) qHeld += dt;
    else { if (qWas && aimMode && qHeld > 0.3) confirmTeleport(); qHeld = 0; }
    qWas = qDown;
    if (aimMode) {
      aimT += dt;
      if (aimT > TP.aimTimeout || input.pressed('KeyE')) cancelAim();
      else if (input.state.lmbEdge) confirmTeleport();
    }

    // actions
    if (input.pressed('KeyF') && state === 'playing') {
      if (P.mode === 'bot') dismount();
      else if (!interactBusy()) {
        const ob = nearestOwnBot();
        if (ob) { mount(ob); sfx.pickup(); } else { const h = nearestHijack(); if (h) hijack(h); }
      }
    }
    if (input.pressed('KeyP') && state === 'playing') saveFlow();
    if (state === 'playing') { if (input.state.wheel !== 0) setArmed(!armed); if (input.pressed('Digit1')) setArmed(false); if (input.pressed('Digit2')) setArmed(true); }
    const aimed = input.state.locked || !input.state.hadLock;
    if (!aimMode && aimed) {
      if (input.pressed('KeyV') && P.mode === 'foot') punch();
      else if (input.state.lmb || input.state.lmbEdge) { if (armed) fireBlaster(); else if (P.mode === 'foot') punch(); else if (input.state.lmbEdge) hud.toast('Scroll the mouse wheel to draw your Punch Gun'); }
    }

    // movement
    if (P.mode === 'foot') updateFoot(dt);
    for (const b of bots) updateBot(b, dt);
    if (P.mode === 'bot') { P.x = P.bot.x; P.z = P.bot.z; P.y = P.bot.y; P.face = P.bot.heading; }
    sfx.engine(P.mode === 'bot' ? Math.abs(P.bot.speed) / P.bot.cfg.max : 0, P.mode === 'bot');

    if (aimMode) computeAim(); else aim.state = 'none';
    updateChild(wdt);

    // hero model
    const riding = P.mode === 'bot';
    hero.root.visible = true;
    if (riding) {
      const b = P.bot, sx = Math.sin(b.heading), sz = Math.cos(b.heading);
      hero.root.position.set(b.x + sx * 0.2, b.y + b.mesh.seatY, b.z + sz * 0.2);
      hero.root.rotation.y = P.aimT > 0 ? angleLerp(hero.root.rotation.y, cam.yaw, 0.5) : b.heading;
      setPose(hero, { stand: true, lean: 0.1 + Math.min(0.2, Math.abs(b.speed) * 0.015), aim: P.aimT > 0 ? 1 : 0, armed: armed ? 1 : 0 }, dt);
      heroPool.visible = false;
    } else {
      hero.root.position.set(P.x, P.y, P.z); hero.root.rotation.y = P.face;
      setPose(hero, { moving: P.onGround ? P.moving : 0.2, atk: P.atkT > 0 ? P.atkT / 0.28 : 0, aim: P.aimT > 0 ? 1 : 0, armed: armed ? 1 : 0, look: 0 }, dt);
      heroPool.visible = true;
    }
    flash(hero, P.invuln > 0 && Math.floor(P.invuln * 18) % 2 === 0 && P.invuln < 3);

    // the world. The gang only turns on you inside the second inner road (r 55); outside it they leave you alone.
    const wasHostile = g.hostile; g.hostile = g.alarm || Math.hypot(P.x, P.z) < HOSTILE_R; // after the rescue the whole city hunts you
    if (g.hostile && !wasHostile) { hud.toast('Gang territory. They will attack you in here', 'warn'); taunt.say('enter', { chance: 0.7 }); buddy.on('enter'); }
    else if (!g.hostile && wasHostile) { hud.toast('You are outside gang territory. They lose interest'); taunt.say('leave', { chance: 0.7 }); }
    for (const e of g.enemies) e.update(wdt);
    if (g.enemies.length > 110) g.enemies = g.enemies.filter((e) => !e.dead);
    proj.update(wdt);
    civs.update(wdt);
    updateMission(dt);
    taunt.update(dt, { x: P.x, z: P.z, hostile: g.hostile });
    radio.update(dt);
    buddy.update(dt, { armed, hostile: g.hostile, riding: P.mode === 'bot', hunters: g.enemies.filter((e) => e.alive && (e.state === 'chase' || e.state === 'windup' || e.state === 'strike')).length });
    if (stats.shots - lastShotTaunt >= 24 && stats.takedowns === lastKills) { lastShotTaunt = stats.shots; taunt.say('miss', { chance: 0.8 }); buddy.on('miss'); } else if (stats.takedowns !== lastKills) { lastKills = stats.takedowns; lastShotTaunt = stats.shots; }
    for (let i = stolenCars.length - 1; i >= 0; i--) if (elapsed > stolenCars[i].respawnAt) { stolenCars[i].taken = false; stolenCars.splice(i, 1); }
    for (let i = stolenDrones.length - 1; i >= 0; i--) if (elapsed > stolenDrones[i].respawnAt) { stolenDrones[i].taken = false; stolenDrones.splice(i, 1); }

    // the way out
    if (phase === 'exit' && child.state === 'follow' && state === 'playing') {
      const dg = Math.hypot(P.x - exitPos.x, P.z - exitPos.z), dc = Math.hypot(child.x - exitPos.x, child.z - exitPos.z);
      if (dg < 8 && dc < 10) chapterComplete();
    }

    // effects
    fx.update(dt);
    for (const c of flashCols) if (c.visible) { c.userData.t += dt; const k = c.userData.t / c.userData.life; if (k >= 1) c.visible = false; else { c.scale.set(1 + k * 2, 1 - k * 0.2, 1 + k * 2); c.material.opacity = 1 - k; } }
    cell.visible = child.state === 'caged';
    cellMat.opacity = 0.2 + Math.sin(elapsed * 4) * 0.06;
    updateArrows();
    aimMarker.visible = aimMode && aim.state !== 'none'; // the teleport pipe: only while aiming
    if (aimMarker.visible) {
      aimMarker.position.set(aim.x, aim.y, aim.z);
      const col = aim.state === 'ok' ? '#00E5FF' : '#FF4B4B';
      aimMarker.userData.cyl.material.color.set(col); aimMarker.userData.ring.material.color.set(col).multiplyScalar(1.8);
      aimMarker.userData.ring.scale.setScalar(1 + Math.sin(elapsed * 8) * 0.06);
    }

    updateCamera(dt);
    adapt(dt);

    // HUD
    const goal = goalOf(phase);
    const dgoal = Math.hypot(goal.x - P.x, goal.z - P.z);
    const hunters = alive().filter((e) => e.state === 'chase' || e.state === 'windup' || e.state === 'strike').length;
    const M = MISSIONS[phase];
    let sub = M.sub;
    if (phase === 'rescue') sub = decrypted < 3 ? `Decrypt the 3 terminals outside the dome (${decrypted}/3)` : 'Enter the dome and release the child';
    else if (hunters && phase !== 'reach') sub = `${hunters} gang members on your trail`;
    hud.setObjective(M.label, M.title, sub);
    hud.setCompass(Math.atan2(goal.x - P.x, goal.z - P.z) - cam.yaw, dgoal);
    hud.setBars(P.hp, P.maxHp, child.hp, child.state !== 'caged', child.state === 'caged' && g.hostile && g.enemies.some((e) => e.alive && e.guardCell));
    hud.setTeleport(P.cd / TP.cooldown, P.cd <= 0, aimMode ? aim.state : 'none', aimMode);
    if ((fpsAcc += dt) > 0.5) { fpsAcc = 0; if (params.has('debug')) hud.setFps(`${Math.round(fpsEma)} fps  x${controls.renderScale}`); }
    if ((hudFrame = (hudFrame + 1) % 3) === 0) hud.drawMinimap({ camYaw: cam.yaw, px: P.x, pz: P.z, face: P.face, enemies: g.enemies, child, goal, parked: bots.filter((b) => !b.rider), t: elapsed, streets: extra.streets });
    input.endFrame();
  }
  onTick(frame);
  onTick(() => sharpen.update(controls.renderScale)); // runs in every state, title screen included

  // ---------------------------------------------------------------- flow
  function begin() {
    sfx.init();
    hud.showTitle(false); hud.showHud(true);
    state = 'playing'; input.lock();
    cam.yaw = P.face; cam.pos.set(P.x, P.y + 1.5, P.z); updateCamera(0.05, true);
    hud.toast('A child is locked inside the Core dome. Reach it. Go!', 'warn');
    setTimeout(() => hud.toast('Scroll the mouse wheel to draw your Punch Gun. Q aims a teleport'), 3000);
    buddy.on('start');
  }
  function pause() { if (state !== 'playing') return; state = 'paused'; cancelAim(); sfx.engine(0, false); input.reset(); hud.showPause(true, resume); }
  function resume() { hud.showPause(false); input.reset(); state = 'playing'; input.lock(); }
  input.state.onLockChange = (locked, was) => { if (!locked && was && state === 'playing') pause(); };
  window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && state === 'playing' && !input.state.hadLock) pause(); else if (e.code === 'Escape' && state === 'paused') resume(); });

  state = 'title';
  hud.ready(begin);
  hud.setWeapon('FISTS', false);
  const acc = getAccount(), sv = loadGame();
  hud.onAccount(openAccountModal);
  hud.setPauseActions({ save: () => { if (getAccount()) doSave(); else openAccountModal(); }, account: openAccountModal });
  refreshAccountUi();
  if (acc) {
    const n = msUntilNextChapter(acc);
    hud.setWelcome(`Welcome back, ${esc(acc.name)}. ${n === null ? 'Chapter 1 is in progress.' : n > 0 ? `Chapter 2 unlocks in ${formatCountdown(n)}.` : 'Chapter 2 is ready for the next update.'}`);
    if (sv) hud.setContinue(() => { applySave(sv); begin(); });
  }

  // debugging / test handle
  window.__game = {
    g, P, child, hm, input, cam, bots, stats, aim, hud, ctx, civs, extra, night, treeFix, terminals, proj,
    begin, pause, resume, taunt, buddy, radio, setArmed, teleport, freeChild, doSave, saveFlow, applySave, openAccountModal, snapshot, hijack, startStation, finishStation, startParentsScene, decryptTerminal, fireBlaster, chapterComplete, endGame,
    cellPos, startPos, hospitalPos, foodPos, parentsPos, exitPos, spawnChaser,
    get state() { return state; }, get phase() { return phase; }, set phase(v) { phase = v; placeBeacon(); }, get decrypted() { return decrypted; },
    get aimMode() { return aimMode; }, beginAim, cancelAim, get station() { return station; },
  };
  return window.__game;
}
