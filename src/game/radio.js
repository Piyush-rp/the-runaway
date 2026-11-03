// One radio channel shared by the gang boss (taunts) and the buddy (guidance, help, banter). Messages queue up and play one
// at a time, a couple of seconds apart, so the two voices never pile up on screen.
export class Radio {
  constructor(hud, sfx) { this.hud = hud; this.sfx = sfx; this.q = []; this.gap = 0; }

  // prio: higher plays first when the queue is crowded (guidance > banter)
  push(speaker, text, kind, prio = 1) {
    this.q.push({ speaker, text, kind, prio, t: 0 });
    if (this.q.length > 5) { // too many waiting: drop the lowest-priority, oldest message
      let idx = 0;
      for (let i = 1; i < this.q.length; i++) if (this.q[i].prio < this.q[idx].prio) idx = i;
      this.q.splice(idx, 1);
    }
  }

  update(dt) {
    this.gap -= dt;
    for (const m of this.q) m.t += dt;
    this.q = this.q.filter((m) => m.t < 12); // stale chatter is dropped
    if (this.gap > 0 || !this.q.length) return;
    let best = 0;
    for (let i = 1; i < this.q.length; i++) if (this.q[i].prio > this.q[best].prio) best = i;
    const m = this.q.splice(best, 1)[0];
    this.hud.toast(m.text, m.kind, m.speaker);
    this.sfx.radio?.();
    this.gap = 2.8;
  }
}
