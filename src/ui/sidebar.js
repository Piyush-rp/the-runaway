// AURA left navigation rail.
import './sidebar.css';

// Icons drawn to match the reference rail (24x24 viewBox).
const SB_ICONS = {
  home: `<defs><linearGradient id="sbHomeG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5AD2FF"/><stop offset="1" stop-color="#1E6BFF"/></linearGradient></defs>
    <path d="M12 2.6 1.6 11.6c-.5.45-.2 1.3.5 1.3H4v8.1c0 .55.45 1 1 1h4.6v-6.2h4.8V22H19c.55 0 1-.45 1-1v-8.1h1.9c.7 0 1-.85.5-1.3Z" fill="url(#sbHomeG)" stroke="none"/>`,
  chat: '<path d="M12 3.6c4.9 0 8.6 3.5 8.6 7.9s-3.7 7.9-8.6 7.9c-1.3 0-2.6-.25-3.7-.75L3.6 20.4l1.3-4.2C4 14.8 3.4 13.2 3.4 11.5c0-4.4 3.7-7.9 8.6-7.9Z"/><path d="M8.6 11.6h.01M12 11.6h.01M15.4 11.6h.01" stroke-width="2"/>',
  agents: '<path d="M11.8 2.8c1.6 0 2.9 1.3 2.9 2.8s-1.3 3-2.9 3-2.9-1.4-2.9-3 1.3-2.8 2.9-2.8Z"/><path d="M9.1 6.6c-1.8-.4-3.6.5-3.6 2.1 0 1.4 1.6 2.4 4.4 2.5M14.5 6.6c1.8-.4 3.6.5 3.6 2.1 0 1.4-1.6 2.4-4.4 2.5"/><path d="M11.8 9.4v2.8l-2.9 2.7M11.8 12.2l2.9 2.7"/><circle cx="6.6" cy="17.4" r="3.1"/><circle cx="17" cy="17.4" r="3.1"/>',
  tasks: '<rect x="3.8" y="4.8" width="16.4" height="16" rx="2.4"/><path d="M8.2 2.8v3.6M15.8 2.8v3.6"/><path d="M8.4 11.6h2.6M13.4 11.4l2.2-.5M12 11.6l-2.4 4M12 11.6l2.1 3.8" stroke-width="1.35"/>',
  storage: '<ellipse cx="12" cy="5.8" rx="7.6" ry="2.9"/><path d="M4.4 5.8v12.4c0 1.6 3.4 2.9 7.6 2.9s7.6-1.3 7.6-2.9V5.8"/><path d="M4.6 12.4c.9 1 2.5 1.6 4.4 2M19.4 12.4c-.9 1-2.5 1.6-4.4 2" stroke-width="1.4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M10.3 2.8h3.4l.5 2.5 1.7.9 2.4-.9 1.7 2.9-1.9 1.7v2l1.9 1.7-1.7 2.9-2.4-.9-1.7.9-.5 2.5h-3.4l-.5-2.5-1.7-.9-2.4.9-1.7-2.9 1.9-1.7v-2L3.9 8.2l1.7-2.9 2.4.9 1.7-.9Z"/>',
  collapse: '<path d="m11.2 19-6.6-7 6.6-7M19.4 19l-6.6-7 6.6-7"/>',
};
const svg = (name, size, stroke = 1.6) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SB_ICONS[name]}</svg>`;

const ITEMS = [
  ['home', 'Home'], ['chat', 'Chat'], ['agents', 'Agents'],
  ['tasks', 'Tasks'], ['storage', 'Storage'], ['settings', 'Settings'],
];

export function mountSidebar(el) {
  el.classList.add('sb');
  el.innerHTML = `
    <div class="sb-rail">
      <ul class="sb-list">
        ${ITEMS.map(([id, name], i) => `
          <li><button type="button" class="sb-item${i === 0 ? ' active' : ''}" data-id="${id}" aria-label="${name}">
            <span class="sb-ico sb-ico-${id}">${svg(id, id === 'home' ? 28 : 25, id === 'home' ? 1.6 : 1.55)}</span>
            <span class="sb-tip">${name}</span>
          </button></li>`).join('')}
      </ul>
      <button type="button" class="sb-collapse" aria-label="Collapse">${svg('collapse', 25, 1.55)}<span class="sb-tip">Collapse</span></button>
    </div>`;

  const items = [...el.querySelectorAll('.sb-item')];
  items.forEach((btn) => btn.addEventListener('click', () => {
    items.forEach((b) => b.classList.toggle('active', b === btn));
    el.dispatchEvent(new CustomEvent('aura:navigate', { bubbles: true, detail: { id: btn.dataset.id } }));
  }));
  el.querySelector('.sb-collapse').addEventListener('click', () => el.classList.toggle('collapsed'));
}
