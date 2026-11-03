// AURA top bar: logo tab, search pill, notifications, avatars and live clock.
import './topbar.css';
import { iconSvg } from '../icons/icons.js';

const LOGO_SVG = `
<svg class="tb-logo" viewBox="0 0 44 40" width="44" height="40" aria-hidden="true">
  <defs>
    <linearGradient id="tbLogoGrad" gradientUnits="userSpaceOnUse" x1="0" y1="4" x2="0" y2="36">
      <stop offset="0" stop-color="#46D2FF"/>
      <stop offset="0.6" stop-color="#2BBEFA"/>
      <stop offset="1" stop-color="#22A8F4"/>
    </linearGradient>
    <filter id="tbLogoGlow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="1.5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <g filter="url(#tbLogoGlow)" stroke-linecap="round" fill="none">
    <path d="M22.4 7.8 37.4 34.4" stroke="url(#tbLogoGrad)" stroke-width="5.4"/>
    <path d="M17.4 19.2 7.6 34.4" stroke="url(#tbLogoGrad)" stroke-width="5.4"/>
    <path d="M21.4 27.6h5.2" stroke="#5FD8FF" stroke-width="3.8"/>
  </g>
</svg>`;

// Wordmark drawn as paths so the letterforms match the reference (wide geometric caps).
const WORDMARK_SVG = `
<svg class="tb-wordmark" viewBox="0 0 114 24" width="120.8" height="25.4" aria-label="AURA">
  <defs>
    <linearGradient id="tbWordGrad" gradientUnits="userSpaceOnUse" x1="0" y1="3" x2="0" y2="19">
      <stop offset="0" stop-color="#5CD6FF"/>
      <stop offset="0.5" stop-color="#3CC2FC"/>
      <stop offset="1" stop-color="#2AA4F4"/>
    </linearGradient>
    <filter id="tbWordGlow" x="-10%" y="-40%" width="120%" height="180%">
      <feGaussianBlur stdDeviation="1.3" result="b"/>
      <feColorMatrix in="b" type="matrix" values="0 0 0 0 0  0 0 0 0 .55  0 0 0 0 1  0 0 0 .75 0" result="g"/>
      <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <g filter="url(#tbWordGlow)" fill="none" stroke="url(#tbWordGrad)" stroke-width="3.45" stroke-linejoin="round">
    <path d="M8.6 19 15.4 4.6h2.6L24.8 19"/><path d="M13.2 15.6h7.2" stroke-width="2"/>
    <path d="M34.2 3v7.4a7.3 7.3 0 0 0 14.6 0V3"/>
    <path d="M62.8 19V4.6h10.4a3.8 3.8 0 0 1 0 7.6H62.8M71.2 12.2 78.2 19"/>
    <path d="M88.6 19 95.4 4.6h2.6L104.8 19"/><path d="M93.2 15.6h7.2" stroke-width="2"/>
  </g>
</svg>`;

const ORB_HTML = `
<div class="tb-orb" title="AURA Core">
  <div class="tb-orb-swirl"></div>
  <div class="tb-orb-swirl b"></div>
  <div class="tb-orb-fan"></div>
  <div class="tb-orb-beam"></div>
  <div class="tb-orb-beam h"></div>
  <span class="tb-orb-spark s1"></span><span class="tb-orb-spark s2"></span><span class="tb-orb-spark s3"></span>
  <div class="tb-orb-core"><svg viewBox="0 0 10 10" width="9" height="9"><path d="M2.8 8.2 5 2.2 7.2 8.2M3.9 6.4h2.2" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
  <div class="tb-orb-glass"></div>
</div>`;

const MOON_HTML = `
<div class="tb-avatar" title="Profile">
  <div class="tb-moon">
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <defs>
        <radialGradient id="tbMoonG" cx="0.36" cy="0.3" r="0.8">
          <stop offset="0" stop-color="#D6E2F4"/><stop offset="0.55" stop-color="#8AA0C2"/><stop offset="1" stop-color="#3E5274"/>
        </radialGradient>
        <linearGradient id="tbMoonBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C9CFEA"/><stop offset="1" stop-color="#F2F4FB"/></linearGradient>
      </defs>
      <circle cx="10" cy="10" r="10" fill="url(#tbMoonG)"/>
      <circle cx="5" cy="12.5" r="1.4" fill="#7E90AE" opacity=".45"/>
      <circle cx="15.4" cy="6.6" r="1.1" fill="#7E90AE" opacity=".4"/>
      <path d="M6.8 9.6c-.6-3 1-5.6 3.3-5.6s3.8 2.6 3.2 5.6c-.4 1.6-1.7 2.4-3.2 2.4s-2.9-.8-3.3-2.4Z" fill="#F1EEFB" stroke="#8E88C0" stroke-width=".55"/>
      <ellipse cx="10.1" cy="8.7" rx="1.7" ry="1.9" fill="#4E4B6E"/><ellipse cx="10.1" cy="9" rx="1.25" ry="1.4" fill="#F3E2D2"/>
      <path d="M9.5 8.8h.01M10.7 8.8h.01" stroke="#4A4866" stroke-width=".6" stroke-linecap="round"/>
      <path d="M6 17.8 8.4 11.6h3.4l2.4 6.2Z" fill="url(#tbMoonBody)" stroke="#8C93B8" stroke-width=".45"/>
      <path d="M8.6 14.2h3M8 16.1h4.2" stroke="#9AA0C4" stroke-width=".45"/>
    </svg>
  </div>
</div>`;

const BELL_SVG = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 2.4v1.6M4.2 18.2c1.4-1.3 2.4-2.8 2.4-5.4v-1.9c0-3.4 2.4-6.1 5.4-6.1s5.4 2.7 5.4 6.1v1.9c0 2.6 1 4.1 2.4 5.4Z"/><path d="M10.1 20.4a1.95 1.95 0 0 0 3.8 0"/></svg>`;

// Edge colour along x (px): dim on flats, brighter on the swooping curves, fades into the open middle.
function edgeStops(W) {
  const r = (x) => W - x;
  return [
    [0, '#08305C', 1], [280, '#0A3766', 1], [330, '#165DAE', 1], [395, '#2470C0', 1], [430, '#1A58A4', 1],
    [462, '#123A6E', .8], [478, '#0E2C52', .3], [490, '#0E2C52', 0],
    [r(540), '#14305A', 0], [r(520), '#163868', .45], [r(480), '#1D4A8C', .85], [r(430), '#2C62B4', 1],
    [r(360), '#1E64B4', 1], [r(330), '#0C4F9C', 1], [r(220), '#093A72', 1], [W, '#093A70', 1],
  ].map(([x, c, o]) => `<stop offset="${(x / W).toFixed(4)}" stop-color="${c}" stop-opacity="${o}"/>`).join('');
}

function barPath(W) {
  // Two tabs: the logo tab (left) and the status tab (right); the middle is open.
  const r = (x) => W - x; // right-anchored x
  return [
    `M0 0 H476 C466 0 450 26 430 36 C415 46 405 52 385 54`,
    `H345 C325 55 315 68 290 69 H0 Z`,
    `M${r(536)} 0 H${W} V42 Q${W} 52 ${W - 10} 52`,
    `H${r(351)} C${r(376)} 52 ${r(386)} 44 ${r(406)} 41`,
    `C${r(426)} 38 ${r(446)} 35 ${r(471)} 24 C${r(491)} 14 ${r(506)} 4 ${r(536)} 0 Z`,
  ].join(' ');
}
function edgePath(W) {
  const r = (x) => W - x;
  return [
    `M476 0 C466 0 450 26 430 36 C415 46 405 52 385 54 H345 C325 55 315 68 290 69 H0`,
    `M${W} 0 V42 Q${W} 52 ${W - 10} 52 H${r(351)} C${r(376)} 52 ${r(386)} 44 ${r(406)} 41 C${r(426)} 38 ${r(446)} 35 ${r(471)} 24 C${r(491)} 14 ${r(506)} 4 ${r(536)} 0`,
  ].join(' ');
}

const pad = (n) => String(n).padStart(2, '0');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function mountTopbar(el) {
  el.classList.add('tb');
  el.innerHTML = `
    <svg class="tb-shape" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="tbFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#020F21" stop-opacity=".98"/>
          <stop offset="1" stop-color="#031127" stop-opacity=".96"/>
        </linearGradient>
        <linearGradient id="tbEdge" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1536" y2="0"></linearGradient>
        <filter id="tbSoft" x="-5%" y="-50%" width="110%" height="300%"><feGaussianBlur stdDeviation="5"/></filter>
        <filter id="tbEdgeGlow" x="-5%" y="-50%" width="110%" height="300%"><feGaussianBlur stdDeviation="1.6"/></filter>
      </defs>
      <path class="tb-shade" filter="url(#tbSoft)"/>
      <path class="tb-fill" fill="url(#tbFill)"/>
      <path class="tb-edge-glow" fill="none" stroke="url(#tbEdge)" stroke-width="2.4" filter="url(#tbEdgeGlow)"/>
      <path class="tb-edge" fill="none" stroke="url(#tbEdge)" stroke-width="1.5"/>
    </svg>
    <div class="tb-brand">
      ${LOGO_SVG}
      <span class="tb-div tb-div-brand"></span>
      <div class="tb-words">
        ${WORDMARK_SVG}
        <div class="tb-tagline">YOUR PERSONAL AI UNIVERSE</div>
      </div>
    </div>
    <label class="tb-search">
      <span class="tb-search-icon">${iconSvg('search', { size: 21, stroke: 2.4 })}</span>
      <input type="text" placeholder="Ask AURA anything..." spellcheck="false" aria-label="Ask AURA anything"/>
      <button type="button" class="tb-round r1" title="Voice"><svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-linecap="round"><circle cx="5.6" cy="2.6" r=".9" fill="currentColor" stroke="none"/><path d="M5.4 5c1 .7 1.4 1.5 1.1 2.6-.2.8-.8 1.4-1.5 1.8" stroke-width="1.5"/></svg></button>
      <button type="button" class="tb-round r2" title="Info"><svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-linecap="round"><circle cx="6" cy="2.7" r="1" fill="currentColor" stroke="none"/><path d="M5 5.4h1v4.2M4.8 9.6h2.4" stroke-width="1.3"/></svg></button>
    </label>
    <div class="tb-right">
      <button type="button" class="tb-bell" title="Notifications">${BELL_SVG}</button>
      <span class="tb-div d1"></span>
      ${ORB_HTML}
      <span class="tb-div d2"></span>
      ${MOON_HTML}
      <div class="tb-clock"><div class="tb-date"></div><div class="tb-time"></div></div>
    </div>`;

  const svg = el.querySelector('.tb-shape');
  const grad = el.querySelector('#tbEdge');
  const shapes = ['.tb-shade', '.tb-fill'].map((s) => el.querySelector(s));
  const edges = ['.tb-edge-glow', '.tb-edge'].map((s) => el.querySelector(s));
  const layout = () => {
    const W = Math.max(el.clientWidth, 900);
    svg.setAttribute('viewBox', `0 0 ${W} 80`);
    svg.setAttribute('width', W);
    grad.setAttribute('x2', W);
    grad.innerHTML = edgeStops(W);
    const d = barPath(W), e = edgePath(W);
    shapes.forEach((p) => p.setAttribute('d', d));
    edges.forEach((p) => p.setAttribute('d', e));
  };
  layout();
  window.addEventListener('resize', layout);

  const dateEl = el.querySelector('.tb-date');
  const timeEl = el.querySelector('.tb-time');
  const tick = () => {
    const d = new Date();
    dateEl.textContent = `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    const h = d.getHours();
    timeEl.textContent = `${pad(h % 12 || 12)}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
  };
  tick();
  setInterval(tick, 1000);
}
