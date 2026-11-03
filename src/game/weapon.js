// Energy bolts: the hero's blaster (cyan, fast) and the gang riders' shots (red, slower, dodgeable). One small pooled
// set of meshes. Bolts stop at buildings, hit the first enemy / the player / the child they touch.
import * as THREE from 'three';

const playerGeo = new THREE.BoxGeometry(0.08, 0.08, 0.6);
const enemyGeo = new THREE.SphereGeometry(0.13, 10, 8);
const mats = {
  player: new THREE.MeshBasicMaterial({ color: new THREE.Color('#22D3EE').multiplyScalar(2.2), toneMapped: false }),
  enemy: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3b5c').multiplyScalar(2.2), toneMapped: false }),
  buddy: new THREE.MeshBasicMaterial({ color: new THREE.Color('#00F5A0').multiplyScalar(2.2), toneMapped: false }),
};

export class Projectiles {
  constructor(game) { this.g = game; this.list = []; this.pool = { player: [], enemy: [], buddy: [] }; }

  // dir (dx, dy, dz) must be a unit vector
  fire(owner, x, y, z, dx, dy, dz, { speed = 48, dmg = 1, life = 1.5 } = {}) {
    const mesh = this.pool[owner].pop() || new THREE.Mesh(owner === 'enemy' ? enemyGeo : playerGeo, mats[owner]);
    mesh.frustumCulled = false; mesh.visible = true;
    mesh.position.set(x, y, z);
    if (owner !== 'enemy') mesh.lookAt(x + dx, y + dy, z + dz);
    this.g.scene.add(mesh);
    this.list.push({ owner, mesh, x, y, z, vx: dx * speed, vy: dy * speed, vz: dz * speed, dmg, life });
  }

  kill(i) {
    const p = this.list[i];
    p.mesh.visible = false; this.g.scene.remove(p.mesh); this.pool[p.owner].push(p.mesh);
    this.list.splice(i, 1);
  }

  update(dt) {
    const g = this.g, hm = g.hm, P = g.player;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) { this.kill(i); continue; }
      const steps = 3, sdt = dt / steps;
      let dead = false;
      for (let s = 0; s < steps && !dead; s++) {
        p.x += p.vx * sdt; p.y += p.vy * sdt; p.z += p.vz * sdt;
        if (p.y < hm.h(p.x, p.z)) { g.fx.spawn(p.x, p.y, p.z, p.owner === 'enemy' ? '#ff7a90' : '#9be8ff', 0.9, 0.18); dead = true; break; }
        if (p.owner !== 'enemy') {
          for (const e of g.enemies) {
            if (!e.alive) continue;
            const rad = (e.r || 0.25) + 0.18;
            if (Math.hypot(e.x - p.x, e.z - p.z) > rad) continue;
            if (p.y < e.y - 0.2 || p.y > e.y + (e.hitH || 1.0)) continue;
            e.hurt(p.dmg, p.x - p.vx * 0.05, p.z - p.vz * 0.05, p.owner === 'buddy' ? 1.5 : 6); // the Punch Gun shoves them back
            g.fx.spawn(p.x, p.y, p.z, '#ffffff', 1.1, 0.16);
            dead = true; break;
          }
        } else { // enemy bolt: the player (on foot or on a bot), then the child
          const py = P.mode === 'bot' ? P.bot.y + P.bot.mesh.seatY * 0.7 : P.y + 0.3;
          const pr = P.mode === 'bot' ? P.bot.cfg.r + 0.1 : 0.32;
          if (Math.hypot(P.x - p.x, P.z - p.z) < pr && Math.abs(py - p.y) < 0.55) { g.shotHit(p.dmg, p); dead = true; break; }
          const c = g.child;
          if ((c.state === 'follow' || c.state === 'station') && P.mode !== 'bot' && Math.hypot(c.x - p.x, c.z - p.z) < 0.28 && Math.abs(c.y + 0.2 - p.y) < 0.4) { g.shotHitChild(p.dmg * 0.9); dead = true; break; }
        }
      }
      if (dead) { this.kill(i); continue; }
      p.mesh.position.set(p.x, p.y, p.z);
    }
  }
}
