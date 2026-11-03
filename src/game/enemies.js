// Gang members. They walk on the same height map as the player, so they can't climb buildings: a teleport onto a roof
// breaks a chase. Kinds share one humanoid model and differ in size, colours, speed and attack timing.
import * as THREE from 'three';
import { makeHumanoid, setPose, flash } from './models.js';
import { moveXZ, stepVertical, angleLerp } from './physics.js';

export const KINDS = {
  thug:     { hp: 3,  speed: 3.0, range: 1.0, windup: 0.45, dmg: 4,  cd: 1.6, kb: 1.0 },
  enforcer: { hp: 7,  speed: 2.5, range: 1.3, windup: 0.62, dmg: 8,  cd: 2.4, kb: 0.45 },
  sprinter: { hp: 2,  speed: 4.3, range: 0.95, windup: 0.3,  dmg: 3,  cd: 1.2, kb: 1.2 },
  captain:  { hp: 16, speed: 3.3, range: 1.4, windup: 0.5,  dmg: 7,  cd: 1.6, kb: 0.3, lunge: true },
};
const SIDES = [0, 0.55, -0.55, 1.1, -1.1, 1.75, -1.75, 2.4, -2.4];

const bgMat = new THREE.SpriteMaterial({ color: '#05070d', transparent: true, opacity: 0.8, depthWrite: false, depthTest: false, fog: false });
const hpMats = {};

export class Enemy {
  constructor(game, kind, x, z, opts = {}) {
    this.game = game; this.kind = kind; this.cfg = KINDS[kind];
    this.x = x; this.z = z; this.y = game.hm.h(x, z); this.vy = 0; this.onGround = true;
    this.homeX = x; this.homeZ = z;
    this.hp = this.maxHp = this.cfg.hp;
    this.h = makeHumanoid(kind);
    this.r = 0.2 * (this.h.look.scale > 1.1 ? 1.25 : 1);
    this.hitH = this.h.height + 0.1; // bolts hit anywhere on the body
    this.face = Math.random() * Math.PI * 2;
    this.state = 'idle'; this.t = 0; this.cd = 0.5 + Math.random();
    this.alive = true; this.dead = false;
    this.kx = 0; this.kz = 0; this.stuck = 0; this.side = Math.random() < 0.5 ? 1 : -1; this.lostT = 0;
    this.guardCell = opts.guardCell || null; // faces the child's cell until the player shows up
    this.aggro = opts.aggro || 0;
    this.wTx = x; this.wTz = z; this.wT = 0;
    this.lungeT = 0;
    game.scene.add(this.h.root);
    // health bar (shown once hurt)
    const col = this.h.look.accent;
    hpMats[col] ||= new THREE.SpriteMaterial({ color: col, depthWrite: false, depthTest: false, fog: false, toneMapped: false });
    this.bg = new THREE.Sprite(bgMat); this.fg = new THREE.Sprite(hpMats[col]);
    for (const s of [this.bg, this.fg]) { s.renderOrder = 12; s.visible = false; game.scene.add(s); }
    this.sync();
  }

  get dist() { return Math.hypot(this.game.player.x - this.x, this.game.player.z - this.z); }

  hurt(dmg, fx, fz, kb = 4) {
    if (!this.alive) return;
    const g = this.game;
    this.hp -= dmg;
    this.state = this.hp <= 0 ? 'down' : 'stagger'; this.t = 0;
    this.flashT = 0.09; this.aggro = 1; this.guardCell = null;
    const d = Math.hypot(this.x - fx, this.z - fz) || 1;
    this.kx = ((this.x - fx) / d) * kb * this.cfg.kb; this.kz = ((this.z - fz) / d) * kb * this.cfg.kb;
    g.fx.spawn(this.x, this.y + this.h.height * 0.6, this.z, '#ffffff', 1.0, 0.2);
    if (this.hp <= 0) { this.alive = false; g.onTakedown(this); }
  }

  sync() {
    const h = this.h;
    h.root.position.set(this.x, this.y, this.z);
    h.root.rotation.y = this.face;
    const top = this.y + h.height + 0.2;
    this.bg.position.set(this.x, top, this.z); this.fg.position.set(this.x, top, this.z);
  }

  update(dt) {
    const g = this.game, p = g.player, cfg = this.cfg;
    if (this.dead) return;
    const dxp = p.x - this.x, dzp = p.z - this.z, dp = Math.hypot(dxp, dzp);
    const far = dp > 95;
    this.h.root.visible = !far;
    if (far && this.state === 'idle') { stepVertical(g.hm, this, dt); return; } // far away and calm: skip

    // knockback (decays)
    if (Math.abs(this.kx) + Math.abs(this.kz) > 0.05) {
      moveXZ(g.hm, this, this.kx * dt, this.kz * dt, this.r, 0.3);
      const k = Math.exp(-7 * dt); this.kx *= k; this.kz *= k;
    }
    stepVertical(g.hm, this, dt);

    this.t += dt; this.cd -= dt;
    if (this.flashT > 0) { this.flashT -= dt; flash(this.h, this.flashT > 0); } else flash(this.h, false);

    const pose = { moving: 0, atk: 0, windup: 0, down: 0, stagger: false };
    const highAbove = p.y - this.y > 3.2; // player is on a roof / unreachable
    const near = g.alarm ? 70 : 15;
    const sees = dp < near && !highAbove && !g.player.invisible && g.hostile;

    switch (this.state) {
      case 'idle': {
        if (this.guardCell) { // execution squad: face the child, hold position
          const a = Math.atan2(this.guardCell.x - this.x, this.guardCell.z - this.z);
          this.face = angleLerp(this.face, a, dt * 6);
          if (dp < 17 && !highAbove && g.hostile) { this.guardCell = null; this.state = 'chase'; }
        } else {
          this.wT -= dt;
          if (this.wT <= 0) { const a = Math.random() * 6.28, r = Math.random() * 3; this.wTx = this.homeX + Math.cos(a) * r; this.wTz = this.homeZ + Math.sin(a) * r; this.wT = 2 + Math.random() * 3; }
          const d = Math.hypot(this.wTx - this.x, this.wTz - this.z);
          if (d > 0.5) { this.walk(this.wTx, this.wTz, cfg.speed * 0.3, dt); pose.moving = 0.4; }
          if (sees || (this.aggro > 0 && g.hostile)) this.state = 'chase';
        }
        break;
      }
      case 'chase': {
        if (!g.hostile) { this.state = 'idle'; this.aggro = 0; break; } // outside the hostile zone they leave you alone
        if (highAbove || g.player.invisible) {
          this.lostT += dt;
          if (this.lostT > 6) { this.state = 'idle'; this.lostT = 0; this.aggro = 0; break; }
          // stand under the player and look up
          const d = dp; if (d > 2.2) { this.walk(p.x, p.z, cfg.speed * 0.7, dt); pose.moving = 0.7; }
          pose.look = -0.5;
          break;
        }
        this.lostT = 0;
        if (dp > near * 2.3 && !g.alarm) { this.state = 'idle'; this.aggro = 0; break; }
        // lunge (captain)
        if (cfg.lunge && this.cd <= 0 && dp > 3.5 && dp < 9) { this.state = 'windup'; this.t = 0; this.lunge = true; this.face = Math.atan2(dxp, dzp); g.fx.spawn(this.x, this.y + 0.1, this.z, this.h.look.accent, 2.4, 0.7); break; }
        if (dp <= cfg.range * 0.95 && this.cd <= 0) { this.state = 'windup'; this.t = 0; this.lunge = false; g.fx.spawn(this.x, this.y + 0.1, this.z, this.h.look.accent, 1.6, cfg.windup); break; }
        if (dp > cfg.range * 0.8) { this.walk(p.x, p.z, cfg.speed, dt); pose.moving = cfg.speed / 6; }
        else this.face = angleLerp(this.face, Math.atan2(dxp, dzp), dt * 10);
        break;
      }
      case 'windup': {
        const w = this.lunge ? 0.7 : cfg.windup;
        this.face = angleLerp(this.face, Math.atan2(dxp, dzp), dt * 8);
        pose.windup = Math.min(1, this.t / w);
        if (this.t >= w) { this.state = 'strike'; this.t = 0; this.struck = false; this.lungeT = this.lunge ? 0.38 : 0; this.lx = Math.sin(this.face); this.lz = Math.cos(this.face); }
        break;
      }
      case 'strike': {
        pose.atk = Math.min(1, this.t / 0.22);
        if (this.lungeT > 0) { this.lungeT -= dt; moveXZ(g.hm, this, this.lx * 9 * dt, this.lz * 9 * dt, this.r, 0.3); pose.moving = 1; }
        if (!this.struck) {
          const reach = cfg.range + (this.lunge ? 0.7 : 0.3);
          if (Math.hypot(p.x - this.x, p.z - this.z) < reach && Math.abs(p.y - this.y) < 2) { this.struck = true; g.enemyHit(this, cfg.dmg); }
        }
        if (this.t >= (this.lunge ? 0.4 : 0.25)) { this.state = 'chase'; this.t = 0; this.cd = cfg.cd; this.lunge = false; }
        break;
      }
      case 'stagger': {
        pose.stagger = true;
        if (this.t > 0.38) { this.state = 'chase'; this.t = 0; this.cd = Math.max(this.cd, 0.35); }
        break;
      }
      case 'down': {
        pose.down = Math.min(1, this.t / 0.25);
        if (this.t > 2.6) { this.h.root.scale.setScalar(Math.max(0.001, 1 - (this.t - 2.6) * 2.5)); }
        if (this.t > 3.0) { this.destroy(); return; }
        break;
      }
    }

    // keep apart
    for (const o of g.enemies) {
      if (o === this || !o.alive) continue;
      const dx = this.x - o.x, dz = this.z - o.z, d2 = dx * dx + dz * dz;
      if (d2 < 0.25 && d2 > 1e-4) { const d = Math.sqrt(d2), push = (0.5 - d) * 2.2 * dt; moveXZ(g.hm, this, (dx / d) * push, (dz / d) * push, this.r, 0.3); }
    }

    setPose(this.h, pose, dt);
    this.sync();
    // hp bar
    const show = this.alive && this.hp < this.maxHp && dp < 40;
    this.bg.visible = this.fg.visible = show;
    if (show) {
      const w = 0.55 * this.h.look.scale + 0.15, f = Math.max(0.02, this.hp / this.maxHp);
      this.bg.scale.set(w, 0.09, 1); this.fg.scale.set(w * f - 0.02, 0.06, 1);
      const off = (w * (1 - f)) / 2; // left-align the bar: shift toward the camera's left (camera right = (-cos, sin))
      this.fg.position.x = this.x + off * Math.cos(g.camYaw); this.fg.position.z = this.z - off * Math.sin(g.camYaw);
    }
  }

  // steer around obstacles: try the straight line, then progressively wider angles (remembering the side that worked)
  walk(tx, tz, speed, dt) {
    const g = this.game;
    const a0 = Math.atan2(tx - this.x, tz - this.z);
    const step = speed * dt;
    let moved = false;
    const order = this.side > 0 ? SIDES : SIDES.map((s) => -s);
    for (const off of order) {
      const a = a0 + off, sx = Math.sin(a), sz = Math.cos(a);
      const px = this.x + sx * (step + 0.5), pz = this.z + sz * (step + 0.5);
      if (g.hm.maxUnder(px, pz, this.r) - this.y > 0.32) continue;
      moveXZ(g.hm, this, sx * step, sz * step, this.r, 0.32);
      this.face = angleLerp(this.face, a, dt * 12);
      if (off !== 0) this.side = Math.sign(off);
      moved = true; break;
    }
    if (!moved) this.face = angleLerp(this.face, a0, dt * 6);
  }

  destroy() {
    this.dead = true;
    this.game.scene.remove(this.h.root, this.bg, this.fg);
  }
}
