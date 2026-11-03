// Resource Usage panel: title + Live pill + three glowing ring gauges that drift slightly.
import './resourceUsage.css';

// Ring geometry measured from the reference: the rings are slightly taller than wide.
const RX = 30.4, RY = 32.3;
// The drawn arcs in the reference are a little longer/shorter than the printed value
// (CPU ~33%, RAM ~44%, GPU ~37% of the ring), so each gauge carries a visual bias.
const GAUGES = [
  { key: 'cpu', label: 'CPU', value: 28, arcBias: 5, color: '#0CB8FF', track: '#0D3F7A', cx: 49.75 },
  { key: 'ram', label: 'RAM', value: 46, arcBias: -2, color: '#05F4C8', track: '#15334F', cx: 126.5 },
  { key: 'gpu', label: 'GPU', value: 32, arcBias: 5, color: '#9A66FA', track: '#15334F', cx: 202.25 },
];
// Full ellipse starting at 12 o'clock going clockwise; pathLength=100 makes dash units = percent.
const RING = `M40 ${40 - RY}A${RX} ${RY} 0 1 1 40 ${40 + RY}A${RX} ${RY} 0 1 1 40 ${40 - RY}`;
const dash = (g, v) => `${Math.max(0, Math.min(100, v + g.arcBias)).toFixed(2)} 100`;

function gaugeMarkup(g) {
  return `<div class="ru-gauge" data-key="${g.key}" style="left:${g.cx - 40}px;--c:${g.color}">
    <svg viewBox="0 0 80 80" width="80" height="80" aria-hidden="true">
      <path class="ru-track" d="${RING}" style="stroke:${g.track}"/>
      <path class="ru-arc" d="${RING}" pathLength="100" stroke-dasharray="${dash(g, g.value)}"/>
    </svg>
    <div class="ru-label">${g.label}</div>
    <div class="ru-val">${g.value}%</div>
  </div>`;
}

export function mountResourceUsage(el) {
  if (!el) return;
  el.classList.add('ru');
  el.innerHTML = `
    <div class="ru-head"><span class="ru-title">Resource Usage</span><span class="live ru-live">Live</span></div>
    ${GAUGES.map(gaugeMarkup).join('')}`;

  const state = GAUGES.map((g) => {
    const root = el.querySelector(`[data-key="${g.key}"]`);
    return { g, arc: root.querySelector('.ru-arc'), val: root.querySelector('.ru-val'), shown: g.value, target: g.value, shownInt: g.value };
  });

  // Gentle drift: every few seconds each gauge picks a new target near its reference value.
  function retarget() {
    for (const st of state) {
      // Mostly hold the reference value, otherwise wander at most 3 points away, one step at a time.
      const base = st.g.value;
      let next = st.target + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.7 ? 1 : 2);
      if (Math.random() < 0.5) next = base;
      st.target = Math.max(base - 3, Math.min(base + 3, next));
    }
  }
  setTimeout(function loop() { retarget(); setTimeout(loop, 3500 + Math.random() * 2500); }, 12000);

  let last = performance.now();
  const startAt = last + 250;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (now >= startAt) {
      for (const st of state) {
        st.shown += (st.target - st.shown) * Math.min(1, dt * 1.6);
        st.arc.setAttribute('stroke-dasharray', dash(st.g, st.shown));
        const n = Math.round(st.shown);
        if (n !== st.shownInt) { st.shownInt = n; st.val.textContent = `${n}%`; }
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
