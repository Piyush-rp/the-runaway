// Civilians: people walking the pavements along the roads. They scatter from fast bots, fights and gang members, crouch
// for a moment, then go back to their stroll. Only the ones near the player are simulated or drawn.
import { makeHumanoid, setPose, civilianLook } from './models.js';
import { getRoadPaths } from '../city/roads.js';
import { moveXZ, stepVertical, angleLerp } from './physics.js';

const SIM_R = 75, VIS_R = 62;

export class Civilians {
  constructor(game, { count = 40, seed = 77 } = {}) {
    this.game = game; this.list = [];
    let a = seed; const rnd = () => ((a = (a * 16807) % 2147483647) / 2147483647);
    const roads = getRoadPaths(game.layout).filter((r) => ['ring', 'spoke', 'exit', 'street', 'side'].includes(r.kind) && r.length > 14);
    let guard = 0;
    while (this.list.length < count && guard++ < count * 40) {
      const road = roads[Math.floor(rnd() * roads.length)];
      const u = rnd(), side = rnd() < 0.5 ? 1 : -1;
      const c = { road, u, dir: rnd() < 0.5 ? 1 : -1, side, speed: 0.85 + rnd() * 0.5, state: 'walk', t: 0, i: this.list.length, panic: 0, down: 0 };
      this.place(c);
      if (Math.hypot(c.x, c.z) < 19 || Math.hypot(c.x, c.z) > 147 || game.hm.h(c.x, c.z) > 0.3) continue;
      c.h = makeHumanoid(civilianLook(this.list.length));
      c.y = game.hm.h(c.x, c.z); c.vy = 0; c.onGround = true; c.face = 0; c.r = 0.16;
      c.h.root.visible = false; game.scene.add(c.h.root);
      this.list.push(c);
    }
  }

  // position on the pavement for the civilian's current u
  place(c) {
    const p = c.road.center.getPointAt(c.u), t = c.road.center.getTangentAt(c.u);
    const off = c.road.width / 2 + 0.55;
    c.px = p.x + -t.z * off * c.side; c.pz = p.z + t.x * off * c.side;
    c.tx = t.x * c.dir; c.tz = t.z * c.dir;
    if (c.state === 'walk') { c.x = c.px; c.z = c.pz; }
    if (c.x === undefined) { c.x = c.px; c.z = c.pz; }
  }

  // someone near me is dangerous: a fast bot, a gang member in a fight, or the player brawling
  threat(c) {
    const g = this.game, P = g.player;
    const R = g.alarm ? 10 : 7;
    let best = null, bd = R;
    const consider = (x, z) => { const d = Math.hypot(x - c.x, z - c.z); if (d < bd) { bd = d; best = { x, z }; } };
    if (P.mode === 'bot' && Math.abs(P.bot.speed) > 6) consider(P.x, P.z);
    if (P.atkT > 0) consider(P.x, P.z);
    for (const e of g.enemies) if (e.alive && (e.state === 'chase' || e.state === 'strike' || e.state === 'windup') && Math.abs(e.y - c.y) < 3) consider(e.x, e.z);
    return best;
  }

  knock(c, fx, fz) { c.state = 'down'; c.t = 0; c.kx = (c.x - fx) * 1.2; c.kz = (c.z - fz) * 1.2; }

  update(dt) {
    const g = this.game, P = g.player, hm = g.hm;
    for (const c of this.list) {
      const dp = Math.hypot(P.x - c.x, P.z - c.z);
      c.h.root.visible = dp < VIS_R;
      if (dp > SIM_R) continue;
      const pose = { moving: 0, sit: false, down: 0 };
      if (c.state === 'walk') {
        const th = this.threat(c);
        if (th) { c.state = 'flee'; c.t = 0; c.fx = c.x - th.x; c.fz = c.z - th.z; const l = Math.hypot(c.fx, c.fz) || 1; c.fx /= l; c.fz /= l; }
        else {
          c.u += (c.dir * c.speed * dt) / c.road.length;
          if (c.road.closed) c.u = (c.u + 1) % 1;
          else if (c.u > 1 || c.u < 0) { c.dir *= -1; c.u = Math.min(1, Math.max(0, c.u)); }
          this.place(c);
          c.y = hm.h(c.x, c.z);
          c.face = angleLerp(c.face, Math.atan2(c.tx, c.tz), dt * 6);
          pose.moving = c.speed / 1.6;
        }
      } else if (c.state === 'flee') {
        c.t += dt;
        moveXZ(hm, c, c.fx * 3.4 * dt, c.fz * 3.4 * dt, c.r, 0.3);
        c.face = angleLerp(c.face, Math.atan2(c.fx, c.fz), dt * 12);
        pose.moving = 1.4; stepVertical(hm, c, dt);
        if (c.t > 2.2) { c.state = 'cower'; c.t = 0; }
      } else if (c.state === 'cower') {
        c.t += dt; pose.sit = true; stepVertical(hm, c, dt);
        if (c.t > 1.8 && !this.threat(c)) { c.state = 'return'; c.t = 0; }
      } else if (c.state === 'return') { // wander back to the pavement
        const p = c.road.center.getPointAt(c.u), t = c.road.center.getTangentAt(c.u), off = c.road.width / 2 + 0.65;
        const tx = p.x - t.z * off * c.side, tz = p.z + t.x * off * c.side;
        const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz);
        if (d < 0.7) { c.state = 'walk'; }
        else { moveXZ(hm, c, (dx / d) * 1.6 * dt, (dz / d) * 1.6 * dt, c.r, 0.3); c.face = angleLerp(c.face, Math.atan2(dx, dz), dt * 8); pose.moving = 0.9; stepVertical(hm, c, dt); }
        if (this.threat(c)) { c.state = 'flee'; c.t = 0; }
      } else if (c.state === 'down') { // knocked over by a bot, gets back up
        c.t += dt;
        moveXZ(hm, c, (c.kx || 0) * dt, (c.kz || 0) * dt, c.r, 0.3); c.kx *= 0.9; c.kz *= 0.9;
        pose.down = Math.min(1, c.t / 0.2); stepVertical(hm, c, dt);
        if (c.t > 2.4) { c.state = 'cower'; c.t = 0; }
      }
      setPose(c.h, pose, dt);
      c.h.root.position.set(c.x, c.y, c.z); c.h.root.rotation.y = c.face;
    }
  }
}
