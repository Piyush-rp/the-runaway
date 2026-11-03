// Click handling for the city.
//  - Click a rooftop icon badge  -> an agent card pops up above it (which agent lives there).
//  - Click anywhere on a building -> the full-page floor view opens for that building.
// The floor view is only a shell for now. The real floor structure plugs in later through the
// 'aura:open-floor' / 'aura:close-floor' window events or by replacing renderFloorStage().
import * as THREE from 'three';
import './interaction.css';
import { BUILDINGS } from './layout.js';
import { AGENTS } from './agents.js';
import { iconSvg } from '../icons/icons.js';

const SLOT_BY_ID = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));
const CLICK_SLOP = 6; // px of pointer travel still counted as a click

export function setupInteraction(ctx) {
  const { scene, camera, renderer, onTick } = ctx;
  const canvas = renderer.domElement;
  const app = canvas.parentElement;
  const raycaster = new THREE.Raycaster();
  raycaster.camera = camera; // required for raycasting sprites (the badges)
  const ndc = new THREE.Vector2();

  // Find what is under the pointer: { id, badge } or null.
  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const roots = scene.children.filter((o) => o.name?.startsWith('building:') && o.visible);
    for (const hit of raycaster.intersectObjects(roots, true)) {
      const o = hit.object;
      // Glow halos and light pools are decoration: skip them so they don't steal clicks.
      const badge = findUp(o, (n) => n.userData?.badge) || (o.isSprite && o.renderOrder === 5 ? o : null);
      if (o.isSprite && !badge) continue;
      if (o.material?.blending === THREE.AdditiveBlending && !badge) continue;
      const root = findUp(o, (n) => n.name?.startsWith('building:'));
      if (!root) continue;
      return { id: root.name.slice('building:'.length), badge: badge ? findUp(badge, (n) => n.name === 'badge') || badge : null };
    }
    return null;
  }

  // ---------- hover feedback ----------
  let hovered = null;
  let hoverBadge = null;
  canvas.addEventListener('pointermove', (e) => {
    if (floor) return;
    const p = pick(e.clientX, e.clientY);
    hovered = p?.id || null;
    hoverBadge = p?.badge || null;
    canvas.style.cursor = p ? 'pointer' : '';
  });
  canvas.addEventListener('pointerleave', () => { hovered = null; hoverBadge = null; canvas.style.cursor = ''; });
  // Badges grow slightly while hovered. The badge list is cached and refreshed every 2 s,
  // so buildings added later (hot reload) are picked up without walking the scene every frame.
  let badges = [];
  let badgesAt = -Infinity;
  onTick((t, dt) => {
    if (t - badgesAt > 2) {
      badges = [];
      scene.traverse((o) => { if (o.name === 'badge') badges.push(o); });
      badgesAt = t;
    }
    for (const o of badges) {
      const target = o === hoverBadge ? 1.15 : 1;
      if (Math.abs(o.scale.x - target) < 1e-3) continue;
      o.scale.setScalar(THREE.MathUtils.damp(o.scale.x, target, 12, dt));
    }
  });

  // ---------- click ----------
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP) { down = null; return; }
    down = null;
    const p = pick(e.clientX, e.clientY);
    if (!p) { closeCard(); return; }
    if (p.badge) showCard(p.id, p.badge);
    else { closeCard(); openFloor(p.id); }
  });

  // ---------- agent card ----------
  let card = null;
  let cardAnchor = null;
  const tmp = new THREE.Vector3();

  function showCard(id, badgeObj) {
    closeCard();
    const slot = SLOT_BY_ID[id] || {};
    const info = AGENTS[id] || { agent: slot.name || id, role: '' };
    card = document.createElement('div');
    card.className = 'agent-card';
    card.style.setProperty('--accent', slot.color || '#3A86FF');
    card.innerHTML = `
      <div class="agent-card__head">
        <div class="agent-card__icon">${slot.icon ? iconSvg(slot.icon, { size: 20, stroke: 2, color: '#fff' }) : ''}</div>
        <div><div class="agent-card__name"></div><div class="agent-card__building"></div></div>
      </div>
      <div class="agent-card__role"></div>
      <div class="agent-card__foot"><span class="agent-card__status">Online</span><button class="agent-card__open" type="button">Open floor</button></div>`;
    card.querySelector('.agent-card__name').textContent = info.agent;
    card.querySelector('.agent-card__building').textContent = `${slot.name || id} building`;
    card.querySelector('.agent-card__role').textContent = info.role;
    card.querySelector('.agent-card__open').addEventListener('click', () => { closeCard(); openFloor(id); });
    app.appendChild(card);
    cardAnchor = badgeObj;
    positionCard();
  }
  function positionCard() {
    if (!card || !cardAnchor) return;
    cardAnchor.getWorldPosition(tmp).project(camera);
    const r = canvas.getBoundingClientRect();
    const x = (tmp.x * 0.5 + 0.5) * r.width;
    const y = (-tmp.y * 0.5 + 0.5) * r.height;
    // Keep the card on screen (it is drawn above the anchor and centred on it).
    card.style.left = `${Math.min(Math.max(x, 140), r.width - 140)}px`;
    card.style.top = `${Math.max(y, 200)}px`;
  }
  function closeCard() { card?.remove(); card = null; cardAnchor = null; }
  onTick(positionCard); // follows the bobbing badge and window resizes

  // ---------- floor view (shell only) ----------
  let floor = null;
  function openFloor(id) {
    if (floor) return;
    const slot = SLOT_BY_ID[id] || {};
    const info = AGENTS[id] || { agent: slot.name || id };
    floor = document.createElement('section');
    floor.className = 'floor-view';
    floor.dataset.building = id;
    floor.style.setProperty('--accent', slot.color || '#3A86FF');
    floor.innerHTML = `
      <div class="floor-view__bar">
        <button class="floor-view__back" type="button">${iconSvg('chevronsLeft', { size: 16 })} City</button>
        <div><div class="floor-view__title"></div><div class="floor-view__sub"></div></div>
      </div>
      <div class="floor-view__stage"></div>`;
    floor.querySelector('.floor-view__title').textContent = `${slot.name || id} building`;
    floor.querySelector('.floor-view__sub').textContent = info.agent;
    floor.querySelector('.floor-view__back').addEventListener('click', () => closeFloor());
    renderFloorStage(floor.querySelector('.floor-view__stage'), id);
    document.body.appendChild(floor);
    if (location.hash !== `#floor/${id}`) history.pushState({ floor: id }, '', `#floor/${id}`);
    window.dispatchEvent(new CustomEvent('aura:open-floor', { detail: { id, slot, agent: info } }));
  }
  function closeFloor({ fromHistory = false } = {}) {
    if (!floor) return;
    const el = floor; const id = el.dataset.building;
    floor = null;
    el.classList.add('closing');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    if (!fromHistory && location.hash.startsWith('#floor/')) history.back();
    window.dispatchEvent(new CustomEvent('aura:close-floor', { detail: { id } }));
  }
  // Placeholder stage. Replace with the real floor structure later.
  function renderFloorStage(stage) {
    stage.innerHTML = '<div class="floor-view__placeholder">Floor view coming soon</div>';
  }

  // Esc closes the card or the floor; browser Back closes the floor; a #floor/<id> link opens it.
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (floor) closeFloor(); else closeCard(); } });
  window.addEventListener('popstate', () => {
    const m = location.hash.match(/^#floor\/(.+)$/);
    if (m && !floor) openFloor(decodeURIComponent(m[1]));
    else if (!m && floor) closeFloor({ fromHistory: true });
  });
  const initial = location.hash.match(/^#floor\/(.+)$/);
  if (initial && SLOT_BY_ID[decodeURIComponent(initial[1])]) openFloor(decodeURIComponent(initial[1]));

  Object.assign(ctx, { openFloor, closeFloor, showAgentCard: (id) => {
    const root = scene.getObjectByName(`building:${id}`);
    const badge = root && (root.getObjectByName('badge') || root);
    if (badge) showCard(id, badge);
  } });
}

function findUp(o, test) {
  for (let n = o; n; n = n.parent) if (test(n)) return n;
  return null;
}
