// DOM HUD: objective + compass arrow, minimap, health / child bars, teleport cooldown ring, prompts, toasts and the
// title / pause / end screens. Built once; the game calls the small setters every frame.
import './game.css';
import { RINGS, OUTER_RING, EDGE_RING, SPOKES, polar } from '../city/layout.js';
import { formatCountdown } from './account.js';

const $ = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
const CIRC = 2 * Math.PI * 40;

export class Hud {
  constructor(parent) {
    this.root = $(`<div id="game-ui"></div>`);
    parent.appendChild(this.root);
    this.root.innerHTML = `
      <div class="g-hud hidden">
        <div class="g-vig"></div><div class="g-flash"></div>
        <div class="panel g-obj">
          <div class="g-arrow"><svg viewBox="0 0 24 24"><path d="M12 2 L20 20 L12 15 L4 20 Z" fill="#00E5FF"/></svg><i></i></div>
          <div><div class="lbl">OBJECTIVE</div><div class="txt"></div><div class="sub"></div></div>
        </div>
        <div class="panel g-mini"><canvas width="352" height="352"></canvas></div>
        <div class="panel g-bars">
          <div class="bar hp"><span>HEALTH</span><div class="track"><div class="fill"></div></div><span class="v">100</span></div>
          <div class="bar child"><span>CHILD</span><div class="track"><div class="fill"></div></div><span class="v">100</span></div>
        </div>
        <div class="panel g-weapon"><span class="wk">SCROLL</span><span class="wn">FISTS</span></div>
        <div class="panel g-tp ready">
          <svg viewBox="0 0 100 100"><circle class="ring-bg" cx="50" cy="50" r="40" fill="none" stroke-width="6"/><circle class="ring-fg" cx="50" cy="50" r="40" fill="none" stroke-width="6" stroke-linecap="round" stroke-dasharray="${CIRC}" stroke-dashoffset="0"/></svg>
          <div class="key">Q</div><div class="name">TELEPORT</div>
        </div>
        <div class="panel g-hints">
          <div><span class="kbd">WASD</span> move <span class="kbd">Shift</span> sprint <span class="kbd">Space</span> jump</div>
          <div><span class="kbd">LMB</span> attack <span class="kbd">Wheel</span> draw / holster Punch Gun <span class="kbd">V</span> punch</div>
          <div><span class="kbd">Q</span> aim teleport, <span class="kbd">Q</span> again to jump</div>
          <div><span class="kbd">F</span> ride / hijack a hoverboard, interact</div>
          <div>on a board: look up / down to climb / dive <span class="kbd">P</span> save</div>
        </div>
        <div class="g-cross"></div>
        <div class="panel g-prompt hidden"><span class="kbd">F</span><span class="t"></span><div class="g-hold hidden"></div></div>
        <div class="panel g-prog hidden"><div class="pl"></div><div class="pt"><div class="pf"></div></div></div>
        <div class="g-toast"></div>
        <div class="g-fps"></div>
      </div>
      <div class="g-screen g-title"><div class="g-card"><div class="g-acct" title="Account"></div>
        <h1>THE <span>RUNAWAY</span></h1>
        <div class="tag">ONE CHILD. NO WAY OUT BUT THROUGH.</div>
        <p>The gang is holding a child inside the Core's dome, guards all around it. Beat the guards, decrypt the dome, free the child, get them to a hospital, find them something to eat, return them to their parents and get them out of the city, with the gang on your tail the whole way. Blast the floating guards, hijack any hoverboard, teleport onto any roof.</p>
        <div class="g-keys">
          <span><span class="kbd">WASD</span></span><b>Move</b><span><span class="kbd">Shift</span></span><b>Sprint</b>
          <span><span class="kbd">Mouse</span></span><b>Look</b><span><span class="kbd">Space</span></span><b>Jump / climb</b>
          <span><span class="kbd">LMB</span></span><b>Attack</b><span><span class="kbd">Q</span> / <span class="kbd">RMB</span></span><b>Teleport: aim, then confirm</b>
          <span><span class="kbd">F</span></span><b>Hoverboard / interact</b><span><span class="kbd">Esc</span></span><b>Pause</b>
          <span><span class="kbd">Wheel</span></span><b>Draw Punch Gun</b><span><span class="kbd">P</span></span><b>Save progress</b>
        </div>
        <button class="g-btn" disabled>LOADING CITY…</button> <button class="g-btn alt g-continue hidden">CONTINUE</button>
        <div class="g-small">Click to start. Best with headphones. Aim at any roof or road and teleport.</div>
        <div class="g-welcome"></div>
      </div></div>
      <div class="g-dialog hidden"><div class="d-who"></div><div class="d-txt"></div><div class="d-ch"></div></div>
      <div class="g-screen g-pause hidden"><div class="g-card"><div class="g-acct" title="Account"></div><h1 style="font-size:28px">PAUSED</h1><p>Your progress is only kept if you save it.</p><div class="p-menu"><button class="g-btn">RESUME</button><button class="g-btn alt p-save">SAVE PROGRESS</button><button class="g-btn alt p-acct">ACCOUNT</button></div></div></div>
      <div class="g-screen g-modal hidden"></div>
      <div class="g-screen g-end hidden"><div class="g-card"></div></div>`;
    const q = (s) => this.root.querySelector(s);
    this.el = {
      hud: q('.g-hud'), obj: q('.g-obj'), lbl: q('.g-obj .lbl'), txt: q('.g-obj .txt'), sub: q('.g-obj .sub'), arrow: q('.g-arrow svg'), arrowD: q('.g-arrow i'),
      mini: q('.g-mini canvas'), hp: q('.bar.hp .fill'), hpV: q('.bar.hp .v'), ch: q('.bar.child .fill'), chV: q('.bar.child .v'), chBar: q('.bar.child'),
      tp: q('.g-tp'), tpFg: q('.ring-fg'), tpKey: q('.g-tp .key'), cross: q('.g-cross'), prompt: q('.g-prompt'), promptT: q('.g-prompt .t'), hold: q('.g-hold'),
      toast: q('.g-toast'), acct: q('.g-acct'), weapon: q('.g-weapon'), weaponN: q('.g-weapon .wn'), modal: q('.g-modal'), cont: q('.g-continue'), pSave: q('.g-pause .p-save'), pAcct: q('.g-pause .p-acct'), prog: q('.g-prog'), progL: q('.g-prog .pl'), progF: q('.g-prog .pf'), dlg: q('.g-dialog'), tpName: q('.g-tp .name'), vig: q('.g-vig'), flash: q('.g-flash'), fps: q('.g-fps'),
      title: q('.g-title'), titleBtn: q('.g-title .g-btn'), pause: q('.g-pause'), pauseBtn: q('.g-pause .g-btn'), end: q('.g-end'), endCard: q('.g-end .g-card'),
    };
    this.el.welcome = q('.g-welcome');
    this.mctx = this.el.mini.getContext('2d');
    this._last = {};
  }

  // ---- screens
  setWelcome(html) { this.el.welcome.innerHTML = html || ''; }
  // End-of-chapter card: teaser, stats, and the account form that saves the progress.
  //  opts: { stats, teaser, account, nextMs, onCreate(fields) -> Promise, onReplay }
  showChapter(opts) {
    const c = this.el.endCard;
    clearInterval(this._cd);
    this.el.end.className = 'g-screen g-end win chapter';
    const stats = opts.stats.map(([k, v]) => `<div class="g-stat"><b>${v}</b><span>${k}</span></div>`).join('');
    c.innerHTML = `<h2>CHAPTER 1 COMPLETE</h2><div class="ch-next">CHAPTER 2 &middot; THE NETWORK</div><p>${opts.teaser}</p>
      <div class="g-stats">${stats}</div><div class="ch-save"></div><button class="g-btn alt ch-replay">PLAY AGAIN</button>`;
    c.querySelector('.ch-replay').onclick = opts.onReplay;
    this.attachBadge(c);
    const box = c.querySelector('.ch-save');
    const renderSaved = (acc, ms) => {
      box.innerHTML = `<div class="ch-ok"><b>Progress saved for ${acc.name.replace(/[<>&]/g, '')}</b><br>Chapter 2 unlocks in <span class="ch-clock">${formatCountdown(ms)}</span>. Come back tomorrow.</div>`;
      const end = Date.now() + ms, clock = box.querySelector('.ch-clock');
      this._cd = setInterval(() => { const left = end - Date.now(); clock.textContent = left > 0 ? formatCountdown(left) : 'now, check back'; }, 1000);
    };
    if (opts.account) { renderSaved(opts.account, opts.nextMs); return; }
    box.innerHTML = `<div class="ch-title">Create an account to save your progress</div>
      <form class="ch-form" autocomplete="on">
        <input name="name" placeholder="Your name" autocomplete="nickname" maxlength="24">
        <input name="email" type="email" placeholder="Email" autocomplete="email">
        <input name="password" type="password" placeholder="Password (6+ characters)" autocomplete="new-password">
        <div class="ch-err"></div>
        <button class="g-btn" type="submit">SAVE MY PROGRESS</button>
      </form>
      <div class="g-small">Saved on this device. Your password is never stored, only a salted hash.</div>`;
    const form = box.querySelector('form'), err = box.querySelector('.ch-err'), btn = form.querySelector('button');
    form.addEventListener('keydown', (e) => e.stopPropagation()); // typing must not trigger game keys
    form.onsubmit = async (e) => {
      e.preventDefault(); err.textContent = ''; btn.disabled = true;
      try { const acc = await opts.onCreate({ name: form.name.value, email: form.email.value, password: form.password.value }); renderSaved(acc, Math.max(0, acc.progress.nextChapterAt - Date.now())); }
      catch (ex) { err.textContent = ex.message || 'Could not save.'; btn.disabled = false; }
    };
    this.el.end.classList.remove('hidden');
  }
  ready(onStart) { this.el.titleBtn.disabled = false; this.el.titleBtn.textContent = 'START'; this.el.titleBtn.onclick = onStart; }
  showHud(on) { this.el.hud.classList.toggle('hidden', !on); }
  showTitle(on) { this.el.title.classList.toggle('hidden', !on); }
  showPause(on, onResume) { this.el.pause.classList.toggle('hidden', !on); if (onResume) this.el.pauseBtn.onclick = onResume; this.el.pause.onclick = (e) => { if (e.target === this.el.pause) onResume?.(); }; }
  showEnd(win, title, line, stats, onRetry) {
    const c = this.el.endCard;
    this.el.end.className = `g-screen g-end ${win ? 'win' : 'lose'}`;
    c.innerHTML = `<h2>${title}</h2><p>${line}</p><div class="g-stats">${stats.map(([k, v]) => `<div class="g-stat"><b>${v}</b><span>${k}</span></div>`).join('')}</div><button class="g-btn">${win ? 'PLAY AGAIN' : 'TRY AGAIN'}</button>`;
    c.querySelector('.g-btn').onclick = onRetry;
    this.attachBadge(c);
  }

  // ---- account badge, save menu, continue
  // account badges: one in the top-right corner of each card (title, pause, end-of-game), all kept in sync
  _paintBadge(el) {
    const acc = this._acct?.acc, savedAt = this._acct?.savedAt;
    el.classList.toggle('in', !!acc); el.classList.toggle('saved', !!acc && !!savedAt);
    el.innerHTML = acc ? `<span>${(acc.name || '?').trim().charAt(0).toUpperCase().replace(/[<>&]/g, '')}</span>` : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></svg>';
    el.title = acc ? `${acc.name}${savedAt ? ' · progress saved' : ' · not saved yet'}` : 'Account: create one to save your progress';
    el.onclick = this._onAcct || null;
  }
  attachBadge(card) { // add a badge to a card that was just (re)built
    const el = document.createElement('div'); el.className = 'g-acct'; card.appendChild(el);
    (this.badges ||= new Set()).add(el); this._paintBadge(el);
    return el;
  }
  setAccount(acc, savedAt) {
    this._acct = { acc, savedAt };
    this.badges ||= new Set(this.root.querySelectorAll('.g-acct'));
    for (const el of [...this.badges]) { if (!el.isConnected) { this.badges.delete(el); continue; } this._paintBadge(el); }
  }
  onAccount(fn) { this._onAcct = fn; this.setAccount(this._acct?.acc, this._acct?.savedAt); }
  setContinue(fn) { this.el.cont.classList.toggle('hidden', !fn); this.el.cont.onclick = fn || null; }
  setPauseActions({ save, account }) { this.el.pSave.onclick = save; this.el.pAcct.onclick = account; }
  // account / save modal. o: { account, savedAt, onCreate(fields) -> Promise, onSave(), onSignOut(), onClose() }
  showAccountModal(o) {
    const m = this.el.modal; m.classList.remove('hidden');
    const close = () => { m.classList.add('hidden'); m.innerHTML = ''; o.onClose?.(); };
    if (!o.account) {
      m.innerHTML = `<div class="g-card"><h2 class="am-title">CREATE YOUR ACCOUNT</h2><p>Save your progress and pick it up again whenever you like on this device.</p>
        <form class="ch-form" autocomplete="on"><input name="name" placeholder="Your name" autocomplete="nickname" maxlength="24"><input name="email" type="email" placeholder="Email" autocomplete="email"><input name="password" type="password" placeholder="Password (6+ characters)" autocomplete="new-password"><div class="ch-err"></div>
        <button class="g-btn" type="submit">CREATE ACCOUNT &amp; SAVE</button></form><button class="g-btn alt am-close" type="button">CANCEL</button>
        <div class="g-small">Saved on this device. Your password is never stored, only a salted hash.</div></div>`;
      const form = m.querySelector('form'), err = m.querySelector('.ch-err'), btn = form.querySelector('button');
      form.addEventListener('keydown', (e) => e.stopPropagation());
      form.onsubmit = async (e) => { e.preventDefault(); err.textContent = ''; btn.disabled = true; try { await o.onCreate({ name: form.name.value, email: form.email.value, password: form.password.value }); close(); } catch (ex) { err.textContent = ex.message || 'Could not save.'; btn.disabled = false; } };
    } else {
      const when = o.savedAt ? new Date(o.savedAt).toLocaleString() : null;
      m.innerHTML = `<div class="g-card"><div class="am-avatar">${(o.account.name || '?').trim().charAt(0).toUpperCase().replace(/[<>&]/g, '')}</div><h2 class="am-title">${String(o.account.name).replace(/[<>&]/g, '')}</h2><p>${String(o.account.email).replace(/[<>&]/g, '')}</p>
        <p class="am-saved">${when ? 'Last saved ' + when : 'Not saved yet'}</p><button class="g-btn am-save" type="button">SAVE PROGRESS NOW</button>
        <button class="g-btn alt am-out" type="button">SIGN OUT &amp; ERASE SAVE</button><button class="g-btn alt am-close" type="button">CLOSE</button></div>`;
      m.querySelector('.am-save').onclick = () => { o.onSave?.(); close(); };
      m.querySelector('.am-out').onclick = () => { if (confirm('Sign out and erase the saved progress on this device?')) { o.onSignOut?.(); close(); } };
    }
    m.querySelector('.am-close').onclick = close;
  }

  setWeapon(name, armed) { this.el.weaponN.textContent = name; this.el.weapon.classList.toggle('armed', !!armed); }

  // ---- HUD pieces (cheap: only touch the DOM when the value changed)
  _set(key, val, fn) { if (this._last[key] !== val) { this._last[key] = val; fn(val); } }
  setObjective(label, text, sub) {
    this._set('lbl', label, (v) => { this.el.lbl.textContent = v; });
    this._set('txt', text, (v) => { this.el.txt.textContent = v; });
    this._set('sub', sub || '', (v) => { this.el.sub.textContent = v; });
  }
  setCompass(angleRad, meters) {
    this.el.arrow.style.transform = `rotate(${angleRad}rad)`;
    this._set('ad', Math.round(meters / 5) * 5, (v) => { this.el.arrowD.textContent = `${v} m`; });
  }
  setBars(hp, maxHp, childHp, childActive, childDanger) {
    this._set('hp', Math.round(hp), (v) => { this.el.hp.style.width = `${(v / maxHp) * 100}%`; this.el.hpV.textContent = v; });
    this._set('ch', Math.round(childHp), (v) => { this.el.ch.style.width = `${v}%`; this.el.chV.textContent = v; });
    this._set('chd', !!childDanger, (v) => this.el.chBar.classList.toggle('danger', v));
  }
  setTeleport(frac, ready, state, aiming = false) { // frac: 0..1 of cooldown remaining
    this._set('tpn', aiming, (v) => { this.el.tpName.textContent = v ? 'CONFIRM' : 'TELEPORT'; });
    this.el.tpFg.style.strokeDashoffset = String(CIRC * frac);
    this._set('tpr', ready, (v) => { this.el.tp.classList.toggle('cool', !v); if (v) { this.el.tp.classList.remove('ready'); void this.el.tp.offsetWidth; this.el.tp.classList.add('ready'); } });
    this._set('tps', state, (v) => { this.el.cross.className = 'g-cross' + (v === 'ok' ? ' tp' : v === 'bad' ? ' bad' : ''); });
  }
  prompt(text, hold) {
    this._set('pr', text || '', (v) => { this.el.prompt.classList.toggle('hidden', !v); this.el.promptT.textContent = v; });
    if (hold != null) { this.el.hold.classList.toggle('hidden', hold <= 0); this.el.hold.style.width = `${Math.min(1, hold) * 100}%`; }
  }
  toast(msg, kind = '', speaker = '') {
    const d = document.createElement('div'); if (kind) d.className = kind;
    if (speaker) { const b = document.createElement('b'); b.textContent = speaker; d.appendChild(b); }
    d.appendChild(document.createTextNode(msg));
    this.el.toast.appendChild(d);
    setTimeout(() => d.remove(), kind === 'taunt' || kind === 'buddy' ? 5200 : 3300);
    while (this.el.toast.children.length > 3) this.el.toast.firstChild.remove();
  }
  progress(label, frac) { // frac null hides it
    this.el.prog.classList.toggle('hidden', frac == null);
    if (frac == null) return;
    this._set('pl', label, (v) => { this.el.progL.textContent = v; });
    this.el.progF.style.width = `${Math.min(1, Math.max(0, frac)) * 100}%`;
  }
  // a short conversation: lines = [{who, text}], then optional choices [{label, onPick}]
  dialogue(who, text, choices = [], onContinue = null) {
    const d = this.el.dlg; d.classList.remove('hidden');
    d.querySelector('.d-who').textContent = who; d.querySelector('.d-txt').textContent = text;
    const box = d.querySelector('.d-ch'); box.innerHTML = '';
    const items = choices.length ? choices : [{ label: 'Continue', onPick: onContinue }];
    items.forEach((c, i) => {
      const b = document.createElement('button'); b.className = 'g-btn alt d-btn'; b.innerHTML = `<span class="kbd">${i + 1}</span> ${c.label}`;
      b.onclick = () => c.onPick?.(); box.appendChild(b);
    });
    this._dlgItems = items;
  }
  dialoguePick(i) { const c = this._dlgItems?.[i]; if (c && !this.el.dlg.classList.contains('hidden')) c.onPick?.(); }
  closeDialogue() { this.el.dlg.classList.add('hidden'); this._dlgItems = null; }
  get dialogueOpen() { return !this.el.dlg.classList.contains('hidden'); }
  damageFlash() { this.el.vig.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => this.el.vig.classList.remove('on'))); }
  tpFlash() { this.el.flash.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => this.el.flash.classList.remove('on'))); }
  setFps(v) { this._set('fps', v, (x) => { this.el.fps.textContent = x; }); }

  // ---- minimap (rotates with the camera, heading up)
  drawMinimap(s) {
    const c = this.mctx, W = 352, R = W / 2, VIS = 72, k = R / VIS; // VIS = world units from the centre to the edge
    c.save();
    c.clearRect(0, 0, W, W);
    c.beginPath(); c.arc(R, R, R - 2, 0, 6.2832); c.clip();
    c.fillStyle = 'rgba(7,11,22,0.92)'; c.fillRect(0, 0, W, W);
    c.translate(R, R);
    c.rotate(-Math.PI / 2 - Math.atan2(Math.cos(s.camYaw), Math.sin(s.camYaw)));
    c.scale(k, k);
    c.translate(-s.px, -s.pz);
    c.lineWidth = 1.4 / k * 1.4;
    c.strokeStyle = 'rgba(58,134,255,0.55)';
    for (const r of [RINGS.ring1, RINGS.ring2, OUTER_RING.radius, EDGE_RING.radius]) { c.beginPath(); c.arc(0, 0, r, 0, 6.2832); c.stroke(); }
    c.strokeStyle = 'rgba(168,85,247,0.5)';
    c.beginPath();
    for (const d of new Set([...SPOKES.inner, ...SPOKES.outer, ...SPOKES.exits])) {
      const a = polar(RINGS.ring0, d), b = polar(EDGE_RING.radius, d);
      c.moveTo(a.x, a.z); c.lineTo(b.x, b.z);
    }
    c.stroke();
    if (s.streets) { c.strokeStyle = 'rgba(120,150,255,0.38)'; c.lineWidth = 0.9; c.beginPath(); for (const t of s.streets) { c.moveTo(t.ax, t.az); c.lineTo(t.bx, t.bz); } c.stroke(); }
    c.fillStyle = 'rgba(255,240,179,0.35)'; c.beginPath(); c.arc(0, 0, 9, 0, 6.2832); c.fill();
    // buildings (coarse blobs from the height map would be heavy; the static plan is enough)
    for (const b of s.parked) { c.fillStyle = '#22D3EE'; c.fillRect(b.x - 1.1, b.z - 1.1, 2.2, 2.2); }
    for (const e of s.enemies) { if (!e.alive) continue; c.fillStyle = '#FF4B4B'; c.beginPath(); c.arc(e.x, e.z, 1.5, 0, 6.2832); c.fill(); }
    if (s.child) { c.fillStyle = '#FFCC4D'; c.beginPath(); c.arc(s.child.x, s.child.z, 1.9, 0, 6.2832); c.fill(); }
    if (s.goal) { // pulsing objective ring; clamped to the edge of the map when it is further than the view
      let gx = s.goal.x, gz = s.goal.z; const dx = gx - s.px, dz = gz - s.pz, d = Math.hypot(dx, dz), lim = VIS - 5;
      if (d > lim) { gx = s.px + (dx / d) * lim; gz = s.pz + (dz / d) * lim; }
      const pulse = 3 + Math.sin(s.t * 5) * 0.8;
      c.strokeStyle = '#00F5A0'; c.lineWidth = 0.9; c.beginPath(); c.arc(gx, gz, pulse, 0, 6.2832); c.stroke();
      c.fillStyle = '#00F5A0'; c.beginPath(); c.arc(gx, gz, 1.2, 0, 6.2832); c.fill();
    }
    // player: arrow pointing the way the hero faces (relative to the rotated map)
    c.translate(s.px, s.pz); c.rotate(-s.face + Math.PI); // face = 0 is +Z, which is "down" in unrotated map space
    c.fillStyle = '#00E5FF'; c.beginPath(); c.moveTo(0, -3.6); c.lineTo(2.6, 2.4); c.lineTo(0, 1); c.lineTo(-2.6, 2.4); c.closePath(); c.fill();
    c.restore();
  }
}
