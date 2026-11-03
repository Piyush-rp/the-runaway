import './systemStatus.css';

const ITEMS = [
  ['Agents', '22/22', '#00F9CF', 'rgba(0,249,207,.55)'],
  ['Event Bus', 'Running', '#09C6FC', 'rgba(9,198,252,.55)'],
  ['Storage', 'Healthy', '#7E6EF9', 'rgba(126,110,249,.55)'],
  ['Models', 'Online', '#F534F9', 'rgba(245,52,249,.55)'],
  ['Automations', 'Running', '#F89A1F', 'rgba(248,154,31,.55)'],
];

// Gauge geometry (viewBox units = CSS px). Angles in degrees, clockwise from 12 o'clock.
const C = 57, R = 43.6, SW = 7.8, GAP = 44; // GAP: half-opening at the bottom
const pt = (deg) => {
  const a = (deg * Math.PI) / 180;
  return [C + R * Math.sin(a), C - R * Math.cos(a)];
};
const arc = (from, to) => {
  const [x0, y0] = pt(from), [x1, y1] = pt(to);
  const large = ((to - from + 360) % 360) > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

function gaugeSvg() {
  const start = 180 + GAP, end = 180 - GAP, seam = 0.7;
  const [sx, sy] = pt(start), [ex, ey] = pt(end);
  return `<svg class="ss-gauge" viewBox="0 0 114 114" aria-hidden="true">
    <defs>
      <linearGradient id="ss-g-left" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="#03C3F7"/><stop offset="1" stop-color="#08CBFA"/>
      </linearGradient>
      <linearGradient id="ss-g-right" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#00ECC2"/><stop offset="1" stop-color="#01F8CF"/>
      </linearGradient>
    </defs>
    <g class="ss-arc" fill="none" stroke-width="${SW}">
      <path d="${arc(start, 360 - seam)}" stroke="url(#ss-g-left)"/>
      <path d="${arc(seam, end)}" stroke="url(#ss-g-right)"/>
      <circle cx="${sx.toFixed(2)}" cy="${sy.toFixed(2)}" r="${SW / 2}" fill="#03C3F7" stroke="none"/>
      <circle cx="${ex.toFixed(2)}" cy="${ey.toFixed(2)}" r="${SW / 2}" fill="#01F8CF" stroke="none"/>
    </g>
  </svg>`;
}

export function mountSystemStatus(el) {
  if (!el) return;
  el.innerHTML = `
    <div class="ss-title">System Status</div>
    ${gaugeSvg()}
    <div class="ss-pct">99.9%</div>
    <div class="ss-online">Online</div>
    <div class="ss-list">${ITEMS.map(([label, val, c, g]) => `
      <div class="ss-row" style="--c:${c};--cg:${g}"><span class="ss-dot"></span><span class="ss-label">${label}</span><span class="ss-val">${val}</span></div>`).join('')}
    </div>`;
}
