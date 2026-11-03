// NOVA, the buddy. A small floating companion drone that rides your shoulder and does three jobs:
//  - guides: points at the objective, and radios directions, tips and what to do next;
//  - helps: fires small assist bolts at nearby gang members, and now and then bails you out (a pulse that shoves enemies
//    away and shields you for a moment, or a recharged teleporter). It never heals you;
//  - teases: friendly sarcasm, and a quick comeback whenever the gang boss taunts you.
import * as THREE from 'three';

const NAME = 'NOVA';
const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const compass = (dx, dz) => DIRS[(Math.round((Math.atan2(dx, -dz) / (Math.PI * 2)) * 8) + 8) % 8]; // north = -z

const LINES = {
  start: [
    "Nova here. I'm riding your shoulder. The kid is locked inside the Core dome, dead centre of the city. Follow the arrow.",
    'Scroll your mouse wheel to draw your Punch Gun. You are going to want it.',
  ],
  reach: ['That ring road ahead is gang territory. Cross it and they wake up. Not before.'],
  rescue: [
    'Three terminals on the platform ring, outside the dome. Hold F on each one. Do not get hit mid-hack.',
    'They keep coming. Decrypt first, brawl later.',
  ],
  decrypt1: ['One down, two to go. Keep your head down.'],
  decrypt2: ['Two! One more terminal and the shield drops.'],
  decrypt3: ['Shield is down! Up the ramp, the kid is in the centre.'],
  free: ['The kid is out! Now they know, and they will hunt you everywhere. Keep moving and shoot the riders first.'],
  hospital: ['Hospital is across town. Follow the red arrow. I will keep the chatter down. Ha, no I will not.'],
  hospitalDone: ['She is stable. Next stop: food. The orange arrow. Heroes march on a full stomach.'],
  foodDone: ['Fed and happy. Now take her home: the parents are out west. Green arrow.'],
  parents: ['Say the right thing. Or the funny thing. I will judge you either way.'],
  exit: ['Last leg: the south gate. Everything they have is coming for you. Make it count.'],
  tipBoard: ['Hoverboards climb when you look up and dive when you look down. Roof-hop like a pro.'],
  tipTeleport: ['Press Q to aim a teleport, Q again to jump. Land on a roof and the foot soldiers cannot follow.'],
  tipGun: ['Scroll the mouse wheel to draw the Punch Gun. Scroll again to holster it and use your fists.'],
  enter: ['You are inside gang territory now. Eyes up.'],
  knockout: ['Ouch. Checkpoint reloaded. Try not to die again, it is embarrassing for both of us.', 'You okay? Do not answer, I can see the health bar.'],
  hijack: ['Nice board! Illegal, but nice.', 'Borrowing is just stealing with better PR.'],
  riders: ['Riders on sky boards. Look up, aim, pop them. They can follow you onto roofs.'],
  kills: ['That is a streak! Do not let it go to your head. Too late, I can see it.', 'Show-off. Keep going.'],
  help: ['Hang on, pulse incoming!', 'Pulse out! Move move move!'],
  tp: ["Teleporter is hot again. You are welcome."],
  reply: ['Ignore him. He is all talk.', 'He just hates that you are winning.', 'Do not let him in your head. Though that last dodge was rough.', 'Is he still talking? Mute him. Oh wait, I cannot.'],
  tease: [
    'Nice dodge. Was that on purpose?',
    "I've seen turtles with better footwork.",
    'You do know the trigger does the shooting, right?',
    'Great teleport. Greater landing. Almost.',
    'Careful, you are being outrun by a child.',
  ],
  miss: ['The gun works better when you aim it at them. Just saying.'],
};

export class Buddy {
  // env: { g, scene, P, hm, proj, fx, radio, sfx, getGoal(), getPhase() }
  constructor(env) {
    Object.assign(this, env);
    this.cool = 4;            // seconds until the next line
    this.hintT = 45;          // seconds until the next "what now?" hint
    this.assistT = 2;
    this.helpCd = 0;          // pulse / recharge cooldown
    this.streakKills = 0; this.seen = new Set(); this.recent = [];
    this.lastProgress = ''; this.stuckT = 0;
    // the drone itself: a pearl orb with a glowing ring and an eye, plus a little arrow that points at the goal
    const g = new THREE.Group();
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), new THREE.MeshBasicMaterial({ color: '#dfe6ff' }));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.015, 8, 28).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color('#00F5A0').multiplyScalar(2), toneMapped: false }));
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#9bffe0').multiplyScalar(2.2), toneMapped: false })); eye.position.set(0, 0.01, 0.09);
    const pointer = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.14, 8).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color('#00F5A0').multiplyScalar(2.2), toneMapped: false })); cone.position.set(0, 0, 0.26);
    pointer.add(cone);
    g.add(orb, ring, eye, pointer);
    // (the orb is no longer added to the scene: Nova is a voice on the radio. Assist bolts still start at her tracked position.)
    this.mesh = g; this.pointer = pointer; this.ring = ring;
    this.x = this.P.x; this.y = this.P.y + 0.9; this.z = this.P.z;
  }

  pick(cat) {
    const list = LINES[cat]; if (!list) return null;
    const fresh = list.filter((l) => !this.recent.includes(l));
    const line = (fresh.length ? fresh : list)[Math.floor(Math.random() * (fresh.length || list.length))];
    this.recent.push(line); if (this.recent.length > 8) this.recent.shift();
    return line;
  }
  say(cat, { prio = 2, chance = 1, force = false } = {}) {
    if (!force && this.cool > 0) return false;
    if (Math.random() > chance) return false;
    const line = this.pick(cat); if (!line) return false;
    this.radio.push(NAME, line, 'buddy', prio);
    this.cool = force ? this.cool : 6 + Math.random() * 4;
    return true;
  }
  once(cat, opts) { if (this.seen.has(cat)) return false; this.seen.add(cat); return this.say(cat, { prio: 3, force: true, ...opts }); }

  // game events (called from index.js)
  on(ev) {
    switch (ev) {
      case 'start': for (const l of LINES.start) this.radio.push(NAME, l, 'buddy', 3); this.cool = 8; break; // intro first, then the weapon tip
      case 'reach': this.once('reach'); break;
      case 'rescue': this.once('rescue'); break;
      case 'decrypt': { const n = this.g.decrypted ?? 0; this.say(n >= 3 ? 'decrypt3' : n === 2 ? 'decrypt2' : 'decrypt1', { prio: 3, force: true }); break; }
      case 'free': this.say('free', { prio: 3, force: true }); break;
      case 'hospital': this.say('hospital', { prio: 3, force: true }); break;
      case 'hospitalDone': this.say('hospitalDone', { prio: 3, force: true }); break;
      case 'foodDone': this.say('foodDone', { prio: 3, force: true }); break;
      case 'parents': this.say('parents', { prio: 3, force: true }); break;
      case 'exit': this.say('exit', { prio: 3, force: true }); break;
      case 'enter': this.once('enter'); break;
      case 'knockout': this.say('knockout', { prio: 3, force: true }); this.streakKills = 0; break;
      case 'hijack': this.say('hijack', { chance: 0.5 }); this.once('tipBoard'); break;
      case 'riders': this.say('riders', { prio: 3, force: true }); break;
      case 'teleport': this.once('tipTeleport'); break;
      case 'draw': this.seen.add('tipGun'); break;
      case 'miss': this.say('miss', { chance: 0.7 }); break;
      case 'kill': this.streakKills++; if (this.streakKills >= 4) { this.streakKills = 0; this.say('kills', { chance: 0.8 }); } break;
      default: break;
    }
  }
  // the gang boss just spoke: quite often, shoot back
  replyTo() { if (Math.random() < 0.45) setTimeout(() => this.radio.push(NAME, this.pick(Math.random() < 0.7 ? 'reply' : 'tease'), 'buddy', 1), 1800); }

  directionHint() { // where to go next, in words
    const gp = this.getGoal(), P = this.P, d = Math.round(Math.hypot(gp.x - P.x, gp.z - P.z));
    const ph = this.getPhase(), what = { reach: 'the Core dome', rescue: 'the dome terminals', hospital: 'the hospital', food: 'the food stall', parents: "the child's parents", exit: 'the south gate' }[ph] || 'your objective';
    return `${what[0].toUpperCase() + what.slice(1)} is about ${d} m ${compass(gp.x - P.x, gp.z - P.z)}. Follow the arrow.`;
  }

  update(dt, info) { // info: { armed, hostile, hunters, riding }
    const { P, g } = this;
    this.cool -= dt; this.helpCd -= dt; this.assistT -= dt;
    const t = performance.now() / 1000;
    // follow the hero's shoulder
    const top = info.riding && P.bot ? P.bot.y + P.bot.mesh.seatY + 0.95 : P.y + 0.95;
    const side = Math.cos(g.camYaw), sideZ = -Math.sin(g.camYaw); // the camera's right
    const tx = P.x + side * 0.5, ty = top + Math.sin(t * 2.2) * 0.05, tz = P.z + sideZ * 0.5;
    const k = Math.min(1, dt * 6);
    this.x += (tx - this.x) * k; this.y += (ty - this.y) * k; this.z += (tz - this.z) * k;
    this.mesh.position.set(this.x, this.y, this.z);
    const gp = this.getGoal();
    this.pointer.rotation.y = Math.atan2(gp.x - this.x, gp.z - this.z);
    this.ring.rotation.y += dt * 2;

    // help 1: assist bolts at the nearest gang member in range (small damage: it helps, it does not take over)
    if (info.hostile && this.assistT <= 0) {
      let best = null, bd = 15;
      for (const e of g.enemies) {
        if (!e.alive) continue;
        const d = Math.hypot(e.x - this.x, e.z - this.z);
        if (d < bd && Math.abs(e.y - P.y) < 6 && this.clear(e)) { best = e; bd = d; }
      }
      if (best) {
        this.assistT = 2.2;
        const ex = best.x - this.x, ey = best.y + (best.hitH || 1) * 0.5 - this.y, ez = best.z - this.z, L = Math.hypot(ex, ey, ez) || 1;
        this.proj.fire('buddy', this.x, this.y, this.z, ex / L, ey / L, ez / L, { speed: 32, dmg: 0.8, life: 1 });
        this.sfx.zap?.();
      } else this.assistT = 0.6;
    }

    // help 2: a pulse when you are about to go down (shoves them back, shields you for a moment; no healing), and a recharged teleporter
    if (this.helpCd <= 0 && info.hostile) {
      if (P.hp < P.maxHp * 0.25 && P.invuln <= 0) { this.pulse(); this.helpCd = 70; }
      else if (P.cd > 3 && info.hunters >= 3) { P.cd = 0; this.say('tp', { prio: 3, force: true }); this.helpCd = 50; }
    }

    // guidance: if nothing has progressed for a while, say where to go; otherwise a tip or a tease now and then
    const progress = `${this.getPhase()}|${g.decrypted ?? 0}`;
    if (progress !== this.lastProgress) { this.lastProgress = progress; this.stuckT = 0; } else this.stuckT += dt;
    this.hintT -= dt;
    if (this.hintT <= 0) {
      this.hintT = 40 + Math.random() * 25;
      if (this.stuckT > 35) { this.radio.push(NAME, this.directionHint(), 'buddy', 3); this.stuckT = 0; }
      else if (!this.seen.has('tipGun') && !info.armed) { this.seen.add('tipGun'); this.radio.push(NAME, this.pick('tipGun'), 'buddy', 2); }
      else this.say('tease', { prio: 1, force: true });
    }
  }

  clear(e) { // open air between me and the target
    const hm = this.hm;
    for (let i = 1; i < 6; i++) { const f = i / 6, x = this.x + (e.x - this.x) * f, z = this.z + (e.z - this.z) * f, y = this.y + ((e.y + 0.5) - this.y) * f; if (hm.h(x, z) > y) return false; }
    return true;
  }

  pulse() {
    const { P, g } = this;
    this.say('help', { prio: 3, force: true });
    for (const e of g.enemies) if (e.alive && Math.hypot(e.x - P.x, e.z - P.z) < 9) e.hurt(0.3, P.x, P.z, 9);
    P.invuln = Math.max(P.invuln, 2.5); // a moment of shield: a breather, not extra health
    this.fx.spawn(P.x, P.y + 0.5, P.z, '#00F5A0', 5, 0.5);
  }
}
