import './eventBus.css';

// Colours per event kind: tail/arrow, arrow line, ring, ring centre, glow.
const KINDS = {
  blue:   { c: '#22CEFC', line: '#2FC8FF', r: '#20B4FF', rc: '#0249E2', g: 'rgba(34,206,252,.55)' },
  purple: { c: '#B07CF8', line: '#E07DF4', r: '#EE72FA', rc: '#B23FE0', g: 'rgba(200,110,250,.55)' },
  orange: { c: '#FBC846', line: '#FFE070', r: '#FFB22A', rc: '#B4560F', g: 'rgba(255,170,40,.55)' },
  teal:   { c: '#1EFCE0', line: '#4AF1EE', r: '#0EF5D8', rc: '#007F78', g: 'rgba(14,245,216,.5)' },
  pink:   { c: '#FD53DD', line: '#FF78E4', r: '#FF4FD0', rc: '#B3086E', g: 'rgba(255,70,210,.55)' },
  violet: { c: '#BD80F8', line: '#E39CFF', r: '#4F86FF', rc: '#2440D8', g: 'rgba(120,130,255,.55)' },
};

const POOL = [
  ['Task Event', 'blue'], ['Data Sync', 'purple'], ['Agent Request', 'orange'], ['Storage Update', 'teal'],
  ['Automation Trigger', 'pink'], ['System Response', 'violet'], ['Memory Write', 'teal'], ['Model Inference', 'purple'],
  ['Agent Handoff', 'orange'], ['Webhook Received', 'pink'], ['Index Refresh', 'blue'], ['Schedule Tick', 'violet'],
  ['Cache Invalidate', 'teal'], ['Task Completed', 'blue'], ['Knowledge Ingest', 'purple'], ['Workflow Step', 'pink'],
  ['Email Parsed', 'orange'], ['Vector Upsert', 'teal'], ['Health Check', 'violet'],
];

const ROWS = 6;
// New live events arrive slowly: one every 8 to 12 seconds.
const PUSH_MIN = 8000, PUSH_MAX = 12000;

// Reference format only: an event shows its delivery latency ("12 ms") during its
// first minute, then its age in whole minutes ("1 min", "2 min"). Never seconds.
function fmtAge(ev, now) {
  const age = now - ev.t;
  if (age < 60000) return `${ev.latency} ms`;
  return `${Math.floor(age / 60000)} min`;
}

function arrowSvg(k) {
  return `<svg class="eb-arrow" viewBox="0 0 42 12" aria-hidden="true">
    <rect x="0" y="2" width="11.5" height="8" rx="3" fill="${k.c}"/>
    <line x1="11" y1="6" x2="38.6" y2="6" stroke="${k.line}" stroke-width="1.6" stroke-linecap="round"/>
    <polyline points="35,2.2 39,6 35,9.8" fill="none" stroke="${k.line}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    <g class="eb-pulse"><ellipse cx="11" cy="6" rx="6" ry="2" fill="${k.line}" opacity=".3"/><ellipse cx="11" cy="6" rx="3" ry="1.1" fill="#FFFFFF" opacity=".45"/></g>
  </svg>`;
}

export function mountEventBus(el) {
  if (!el) return;
  el.innerHTML = `
    <div class="eb-head"><span class="eb-title">Event Bus</span><span class="live">Live</span></div>
    <div class="eb-divider"></div>
    <div class="eb-list"></div>`;
  const list = el.querySelector('.eb-list');
  let seq = 0;

  const makeRow = (ev) => {
    const k = KINDS[ev.kind];
    const row = document.createElement('div');
    row.className = 'eb-row';
    const s = row.style;
    s.setProperty('--c', k.c); s.setProperty('--cg', k.g); s.setProperty('--r', k.r);
    s.setProperty('--rc', k.rc); s.setProperty('--rg', k.g);
    s.setProperty('--d', `${-((seq++ * 0.37) % 2.2).toFixed(2)}s`);
    row.innerHTML = `${arrowSvg(k)}<span class="eb-ring"></span><span class="eb-label">${ev.name}</span><span class="eb-time"></span>`;
    row._ev = ev;
    return row;
  };

  const now = performance.now();
  // Initial state matches the reference exactly (ages in ms are latencies of fresh events).
  const initial = [
    ['Task Event', 'blue', 12, 0], ['Data Sync', 'purple', 36, 0], ['Agent Request', 'orange', 52, 0],
    ['Storage Update', 'teal', 0, 61000], ['Automation Trigger', 'pink', 0, 121000], ['System Response', 'violet', 0, 124000],
  ];
  for (const [name, kind, latency, age] of initial) {
    list.appendChild(makeRow({ name, kind, latency, t: now - age }));
  }

  const refresh = () => {
    const t = performance.now();
    for (const row of list.children) row.lastChild.textContent = fmtAge(row._ev, t);
  };
  refresh();

  let lastName = list.firstChild._ev.name;
  const push = () => {
    let pick;
    do { pick = POOL[(Math.random() * POOL.length) | 0]; } while (pick[0] === lastName);
    lastName = pick[0];
    const latency = 8 + Math.round(Math.random() * 56);
    const row = makeRow({ name: pick[0], kind: pick[1], latency, t: performance.now() });
    row.classList.add('eb-enter', 'eb-flash');
    list.insertBefore(row, list.firstChild);
    refresh();
    void row.offsetHeight; // commit the start state so the slide-in transitions
    row.classList.remove('eb-enter');
    setTimeout(() => row.classList.remove('eb-flash'), 1400);
    const live = [...list.children].filter((r) => !r.classList.contains('eb-leave'));
    for (const old of live.slice(ROWS)) {
      old.classList.add('eb-leave');
      setTimeout(() => old.remove(), 600);
    }
  };

  // Pace pushes by rendered time (rAF with clamped dt) so the long main-thread stall while
  // the city builds does not count: the reference state stays on screen for 8-12 s after
  // the page becomes live. rAF also pauses in hidden tabs.
  const nextGap = () => PUSH_MIN + Math.random() * (PUSH_MAX - PUSH_MIN);
  let acc = 0, due = nextGap(), sinceRefresh = 0, last = performance.now();
  const loop = (t) => {
    const dt = Math.min(t - last, 100);
    last = t;
    acc += dt; sinceRefresh += dt;
    if (acc >= due) { acc = 0; due = nextGap(); push(); }
    if (sinceRefresh >= 1000) { sinceRefresh = 0; refresh(); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
