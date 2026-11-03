// Bottom Stats Panel (sheet sec 7): six neon stats with count-up and small live changes.
import './statsBar.css';

// Neon icons drawn in a 48x48 box measured from the reference (1 unit = 1 screen px).
function gearPath(cx, cy, rOut, rIn, teeth) {
  const pts = [];
  const step = (Math.PI * 2) / teeth;
  const p = (r, ang) => `${(cx + r * Math.cos(ang)).toFixed(2)} ${(cy + r * Math.sin(ang)).toFixed(2)}`;
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    const tw = step * 0.21; // half tooth width at the tip
    const bw = step * 0.31; // half tooth width at the root
    pts.push(p(rIn, a - bw), p(rOut, a - tw), p(rOut, a + tw), p(rIn, a + bw));
  }
  return 'M' + pts.join(' L') + ' Z';
}

// Shapes measured pixel by pixel against ref/dashboard.png (svg origin = icon box top-left).
// .sb-body elements carry the tinted interior fill seen in the reference.
const ICON_BODY = {
  clipboard: `<rect x="13.2" y="12.8" width="22.6" height="25.8" rx="3.2" class="sb-body"/>
    <path d="M20.6 12.8v-1.6a1.8 1.8 0 0 1 1.8-1.8h3.2a1.8 1.8 0 0 1 1.8 1.8v1.6"/>
    <path d="M19.2 23.4h10.8M19.2 29.6h8.4"/>`,
  chat: `<path d="M17.3 32.4A12 11.4 0 1 0 12.8 28.2L10.9 36.4Z" class="sb-body"/>
    <circle cx="18.6" cy="22.4" r=".6" class="sb-dot"/><circle cx="23.1" cy="22.4" r=".6" class="sb-dot"/><circle cx="27.6" cy="22.4" r=".6" class="sb-dot"/>`,
  gear: `<path d="${gearPath(23.6, 23.6, 13.8, 11.4, 8)}" class="sb-body"/>
    <circle cx="23.6" cy="23.6" r="2.6" class="sb-gearcore"/>`,
  database: `<path d="M12.6 15v19.2c0 2.5 4.8 4.6 10.8 4.6s10.8-2.1 10.8-4.6V15" class="sb-body"/>
    <ellipse cx="23.4" cy="15" rx="10.8" ry="4.6"/>
    <path d="M12.6 21.2c0 2.5 4.8 4.6 10.8 4.6s10.8-2.1 10.8-4.6M12.6 27.2c0 2.5 4.8 4.6 10.8 4.6s10.8-2.1 10.8-4.6"/>`,
  people: `<ellipse cx="31.6" cy="17.6" rx="3.8" ry="4.7" class="sb-solid sb-back"/>
    <path d="M29.6 25.4c5.4-.4 9.4 2.8 9.4 7.6v1.4c0 .6-.5 1.1-1.1 1.1h-6.4Z" class="sb-solid sb-back"/>
    <circle cx="20.5" cy="16.3" r="6.2" class="sb-solid sb-front"/>
    <path d="M9.6 36.6c0-6.6 4.4-11 10.4-11h1.6c6 0 10.4 4.4 10.4 11 0 .9-.7 1.6-1.6 1.6H11.2c-.9 0-1.6-.7-1.6-1.6Z" class="sb-solid sb-front"/>`,
  bell: `<circle cx="24" cy="10.6" r="1.8"/>
    <path d="M15.8 30V21.6a8.2 8.4 0 0 1 16.4 0V30c0 2.4 2.5 4.2 5 6.2H10.8c2.5-2 5-3.8 5-6.2Z" class="sb-body"/>
    <path d="M20.2 37.8a3.8 3.8 0 0 0 7.6 0"/>`,
};

// Positions (px from panel left) measured from ref/dashboard.png.
const STATS = [
  { key: 'tasks', icon: 'clipboard', color: '#1A9BFF', core: '#5FD8FF', fill: '#02246A', ix: 36, tx: 66.5, value: 12, caption: ['Tasks', 'Active'] },
  { key: 'messages', icon: 'chat', color: '#C452F2', core: '#F590FA', fill: '#2E0A60', ix: 163.5, tx: 191, value: 48, caption: ['Messages', 'Today'] },
  { key: 'automations', icon: 'gear', color: '#FF9C1E', core: '#FFF2A0', fill: '#62290B', ix: 297.5, tx: 326.5, value: 7, caption: ['Automations', 'Running'] },
  { key: 'storage', icon: 'database', color: '#00E3C8', core: '#30FFF0', fill: '#003C30', ix: 442.5, tx: 471, value: 2.4, decimals: 1, unit: ' TB', caption: ['Storage', 'Used'] },
  { key: 'agents', icon: 'people', color: '#33B5FB', core: '#5CC6FF', fill: '#33B5FB', ix: 583.5, tx: 611, value: 22, caption: ['Agents', 'Online'] },
  { key: 'alerts', icon: 'bell', color: '#FFA82A', core: '#FFEA70', fill: '#3A200C', ix: 710, tx: 738, value: 0, caption: ['Alerts', 'Critical'] },
];
const DIVIDERS = [128, 262, 408, 547, 676];

function iconMarkup(s) {
  const body = ICON_BODY[s.icon];
  // Two passes: coloured tube + bright thin core for the neon look.
  return `<svg class="sb-icon sb-icon-${s.icon}" viewBox="0 0 48 48" width="48" height="48" style="left:${s.ix - 24}px;--c:${s.color};--core:${s.core};--fill:${s.fill}" aria-hidden="true">
    <g class="sb-tube">${body}</g><g class="sb-core">${body}</g></svg>`;
}

const fmt = (s, v) => (s.decimals ? v.toFixed(s.decimals) : String(Math.round(v))) + (s.unit || '');
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

export function mountStatsBar(el) {
  if (!el) return;
  el.classList.add('sb');
  el.innerHTML =
    DIVIDERS.map((x) => `<i class="sb-div" style="left:${x}px"></i>`).join('') +
    STATS.map((s) => `
      <div class="sb-stat" data-key="${s.key}">
        ${iconMarkup(s)}
        <div class="sb-text" style="left:${s.tx}px">
          <div class="sb-num">${fmt(s, s.value)}</div>
          <div class="sb-cap">${s.caption[0]}<br>${s.caption[1]}</div>
        </div>
      </div>`).join('');

  const state = STATS.map((s) => ({
    s, el: el.querySelector(`[data-key="${s.key}"] .sb-num`), shown: s.value, from: s.value, to: s.value, t0: 0, dur: 600,
  }));

  function frame(now) {
    for (const st of state) {
      const t = Math.min(1, Math.max(0, (now - st.t0) / st.dur));
      const v = st.from + (st.to - st.from) * easeOut(t);
      if (v !== st.shown) {
        st.shown = v;
        const txt = fmt(st.s, v);
        if (st.el.textContent !== txt) st.el.textContent = txt;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Occasional small live changes around the reference values.
  const RULES = {
    tasks: { min: 11, max: 13 },
    messages: { min: 47, max: 50 },
    automations: { min: 6, max: 8 },
    agents: { min: 21, max: 23 },
  };
  function tick() {
    const keys = Object.keys(RULES);
    const key = keys[Math.floor(Math.random() * keys.length)];
    const st = state.find((x) => x.s.key === key);
    const r = RULES[key];
    // Mostly hold the reference value: drift by one and usually come back.
    let next = st.to !== st.s.value && Math.random() < 0.6 ? st.s.value : st.to + (r.upOnly || Math.random() < 0.5 ? 1 : -1);
    if (next > r.max || next < r.min) next = 2 * st.to - next;
    if (next !== st.to) {
      st.from = st.shown; st.to = next; st.t0 = performance.now(); st.dur = 600;
      st.el.classList.remove('sb-bump'); void st.el.offsetWidth; st.el.classList.add('sb-bump');
    }
    setTimeout(tick, 6000 + Math.random() * 6000);
  }
  setTimeout(tick, 15000);
}
