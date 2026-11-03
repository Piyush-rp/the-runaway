// Gang members on floating bots. They fly: they glide over anything lower than they can climb to, so a rooftop is NOT
// safe from them (the foot soldiers can't follow you up there, these can). They are slower than your own bots but
// faster than you on foot. Break a chase by outrunning them on a bot, ramming them, or punching them off.
// They plug into the same enemy list as the foot soldiers (same hurt() / alive / update API).
import * as THREE from 'three';
import { makeBot, makeHumanoid, setPose, flash } from './models.js';
import { WORLD_R } from './physics.js';
import { sfx } from './audio.js';

// ring: the standoff distance they keep from you; lift: how far above your head height they hover (a shallow angle, never overhead)
const CFG = { hp: 5, max: 6.5, acc: 8, turn: 3.0, r: 0.7, ring: 4.5, lift: 1.3, hover: 1.2, climb: 9, fall: 6, shotDmg: 3.5, shotSpeed: 20, shotRange: 28 };
const LOOK_AHEAD = [3, 6, 10, 15];
const LOOK_NEAR = [2, 4];

export class Chaser {
  constructor(game, x, z, heading = 0) {
    this.game = game; this.kind = 'rider'; this.cfg = { range: 1.4, kb: 0.6 };
    this.x = x; this.z = z; this.y = game.hm.h(x, z) + CFG.hover; this.heading = heading; this.speed = 3;
    this.hp = this.maxHp = CFG.hp; this.alive = true; this.dead = false; this.r = CFG.r; this.hitH = 1.4; this.shotCd = 2.5 + Math.random() * 1.5; this.orbit = Math.random() < 0.5 ? 1 : -1; this.orbitT = 5 + Math.random() * 5;
    this.state = 'chase'; this.t = 0; this.cd = 1.2; this.homeX = x; this.homeZ = z; this.aggro = 1; this.guardCell = null;
    this.bot = makeBot('#FF2D55', 'drone');
    this.h = makeHumanoid('rider');
    game.scene.add(this.bot.root, this.h.root);
    this.fall = 0; this.vy = 0; this.bank = 0; this.phase = Math.random() * 6;
    this.sync();
  }

  hurt(dmg, fx, fz, kb = 4) {
    if (!this.alive) return;
    const g = this.game;
    this.hp -= dmg; this.flashT = 0.1; this.speed *= 0.5;
    g.fx.spawn(this.x, this.y + 1.2, this.z, '#ffffff', 1.8, 0.22);
    const d = Math.hypot(this.x - fx, this.z - fz) || 1;
    if (this.hp <= 0) {
      this.alive = false; this.state = 'down'; this.t = 0; this.vy = 2; this.riderVy = 3;
      this.kx = ((this.x - fx) / d) * 5; this.kz = ((this.z - fz) / d) * 5;
      g.onTakedown(this);
    } else { this.x += ((this.x - fx) / d) * kb * 0.12; this.z += ((this.z - fz) / d) * kb * 0.12; }
  }

  sync() {
    const s = Math.sin(this.heading), c = Math.cos(this.heading);
    this.bot.root.position.set(this.x, this.y, this.z); this.bot.root.rotation.y = this.heading;
    if (this.alive) { this.h.root.position.set(this.x + s * 0.05, this.y + this.bot.seatY, this.z + c * 0.05); this.h.root.rotation.y = this.heading; }
  }

  update(dt) {
    if (this.dead) return;
    const g = this.game, P = g.player, hm = g.hm;
    const dx = P.x - this.x, dz = P.z - this.z, dp = Math.hypot(dx, dz);
    this.h.root.visible = this.bot.root.visible = dp < 120;
    this.t += dt; this.cd -= dt;
    if (this.flashT > 0) { this.flashT -= dt; flash(this.h, true); } else flash(this.h, false);

    if (!this.alive) { // shot down: the bot drops and fades, the rider tumbles off
      const gy = hm.h(this.x, this.z);
      this.vy -= 22 * dt; this.y = Math.max(gy + 0.4, this.y + this.vy * dt);
      this.speed *= Math.exp(-2 * dt);
      this.x += Math.sin(this.heading) * this.speed * dt + (this.kx || 0) * dt; this.z += Math.cos(this.heading) * this.speed * dt + (this.kz || 0) * dt;
      this.kx *= 0.95; this.kz *= 0.95;
      this.fall = Math.min(1, this.fall + dt * 4);
      this.riderVy = (this.riderVy ?? 0) - 24 * dt;
      const hr = this.h.root; hr.position.x += (this.kx || 0) * dt; hr.position.z += (this.kz || 0) * dt;
      hr.position.y = Math.max(hm.h(hr.position.x, hr.position.z), hr.position.y + this.riderVy * dt);
      setPose(this.h, { down: this.fall }, dt);
      this.bot.root.position.set(this.x, this.y, this.z);
      if (this.t > 2.8) { const k = Math.max(0.001, 1 - (this.t - 2.8) * 2); this.bot.root.scale.setScalar(this.bot.scale * k); this.h.root.scale.setScalar(k); }
      if (this.t > 3.3) this.destroy();
      return;
    }

    if (dp > 150) { this.destroy(); return; } // left far behind: it will be replaced by a fresh pursuer
    // head straight for the player; right above them, hover and circle
    if (!g.hostile) { this.calm = (this.calm || 0) + dt; if (this.calm > 5) { this.destroy(); return; } } else this.calm = 0; // they give up outside the hostile zone
    // keep a standoff: close in to the ring, then circle you at that distance, a little above head height and at an angle.
    // They never get directly overhead and they do not ram, so they are easy to shoot.
    const R = CFG.ring;
    let want = this.heading;
    if (g.hostile) {
      const radial = Math.atan2(dx, dz); // toward the player
      if (dp > R + 1.2) want = radial;
      else {
        this.orbitT -= dt; if (this.orbitT <= 0) { this.orbit *= -1; this.orbitT = 5 + Math.random() * 5; }
        let tang = radial + this.orbit * Math.PI / 2;
        // circle toward open ground: if a tall building is ahead on this side, go the other way (keeps the angle shallow)
        if (hm.maxUnder(this.x + Math.sin(tang) * 3.5, this.z + Math.cos(tang) * 3.5, this.r) > P.y + 2.5) { this.orbit *= -1; tang = radial + this.orbit * Math.PI / 2; this.orbitT = 5 + Math.random() * 5; }
        const err = THREE.MathUtils.clamp((dp - R) / 2, -1, 1); // err > 0: too far, < 0: too close
        want = Math.atan2(Math.sin(tang) + Math.sin(radial) * err * 1.3, Math.cos(tang) + Math.cos(radial) * err * 1.3);
      }
    }
    let da = ((want - this.heading + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.heading += Math.max(-CFG.turn * dt, Math.min(CFG.turn * dt, da));
    this.bank += (Math.max(-1, Math.min(1, da)) * 0.35 - this.bank) * Math.min(1, dt * 6);
    const targetSp = !g.hostile ? 1.5 : dp > R + 1.2 ? CFG.max : 3.2;
    this.speed += (targetSp - this.speed) * Math.min(1, dt * (this.speed < targetSp ? CFG.acc / CFG.max : 3));
    const s = Math.sin(this.heading), c = Math.cos(this.heading);
    const nx = this.x + s * this.speed * dt, nz = this.z + c * this.speed * dt;
    if (Math.hypot(nx, nz) < WORLD_R) { this.x = nx; this.z = nz; }

    // fly over whatever is ahead: look along the heading, climb early enough to clear it
    let top = hm.maxUnder(this.x, this.z, this.r);
    for (const d of (g.hostile && dp < CFG.ring + 3 ? LOOK_NEAR : LOOK_AHEAD)) top = Math.max(top, hm.maxUnder(this.x + s * d, this.z + c * d, this.r)); // circling: only look a little ahead, so they stay low
    const ty = Math.max(top + CFG.hover, P.y + CFG.lift) + Math.sin(g.time * 2.4 + this.phase) * 0.12; // a shallow angle above you, not straight overhead
    this.y += Math.max(-CFG.fall * dt, Math.min(CFG.climb * dt, ty - this.y));

    // never closer than a minimum distance: shove back out so they can't hang right over your head
    if (g.hostile && dp < 3.4) { const k = (3.4 - dp) * 2.5 * dt, nx2 = this.x - (dx / (dp || 1)) * k, nz2 = this.z - (dz / (dp || 1)) * k; if (Math.hypot(nx2, nz2) < WORLD_R) { this.x = nx2; this.z = nz2; } }

    // keep apart from other riders
    for (const o of g.enemies) {
      if (o === this || o.kind !== 'rider' || !o.alive) continue;
      const ox = this.x - o.x, oz = this.z - o.z, d2 = ox * ox + oz * oz;
      if (d2 < 2.5 && d2 > 1e-4) { const d = Math.sqrt(d2), p = (1.6 - d) * 3 * dt; this.x += (ox / d) * p; this.z += (oz / d) * p; }
    }

    // ranged attack: a slow red bolt at the player (dodge it, or take it); needs a clear line over the rooftops
    this.shotCd -= dt;
    if (g.hostile && this.shotCd <= 0 && dp > 2.5 && dp < CFG.shotRange && this.clearShot(P)) {
      this.shotCd = 2.4 + Math.random() * 1.2;
      const ox = this.x, oy = this.y + this.bot.seatY + 0.35, oz = this.z;
      const tx = P.x + (Math.random() - 0.5) * 0.25, ty = (P.mode === 'bot' ? P.bot.y + P.bot.mesh.seatY * 0.7 : P.y + 0.3), tz = P.z + (Math.random() - 0.5) * 0.25;
      let ex = tx - ox, ey = ty - oy, ez = tz - oz; const L = Math.hypot(ex, ey, ez) || 1; ex /= L; ey /= L; ez /= L;
      g.proj.fire('enemy', ox + ex * 0.5, oy + ey * 0.5, oz + ez * 0.5, ex, ey, ez, { speed: CFG.shotSpeed, dmg: CFG.shotDmg, life: 2.2 });
      g.fx.spawn(ox + ex * 0.5, oy, oz + ez * 0.5, '#ff7a90', 0.9, 0.15); sfx.zap();
    }
    setPose(this.h, { stand: true, lean: 0.2, aim: this.shotCd > 2.0 ? 1 : 0 }, dt);
    this.sync();
    this.bot.lift.rotation.z = THREE.MathUtils.lerp(this.bot.lift.rotation.z, -this.bank, Math.min(1, dt * 8));
  }

  // is there open air between me and the player? (sample the straight line against the height map)
  clearShot(P) {
    const hm = this.game.hm, y0 = this.y + this.bot.seatY + 0.35, y1 = P.y + 0.3;
    for (let i = 1; i < 8; i++) {
      const t = i / 8, x = this.x + (P.x - this.x) * t, z = this.z + (P.z - this.z) * t, y = y0 + (y1 - y0) * t;
      if (hm.h(x, z) > y) return false;
    }
    return true;
  }

  destroy() {
    this.dead = true; this.alive = false;
    this.game.scene.remove(this.bot.root, this.h.root);
  }
}
