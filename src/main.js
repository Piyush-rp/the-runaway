import './styles/tokens.css';
import './styles/base.css';
import { startCity } from './city/index.js';

// The page is the game by default. `?view` opens the original 3D city viewer (orbit camera, clickable buildings),
// `?panels` additionally shows the dashboard panels (code kept in src/ui/).
const params = new URLSearchParams(location.search);
const viewer = params.has('view') || params.has('panels');
const canvas = document.getElementById('city');
const ctx = startCity(canvas, { interaction: viewer, game: !viewer });

const PANEL_IDS = ['topbar', 'sidebar', 'event-bus', 'system-status', 'stats-bar', 'resource-usage'];
const showPanels = params.has('panels');

if (!showPanels) {
  for (const id of PANEL_IDS) document.getElementById(id)?.remove();
} else {
  const panels = [
    ['topbar', () => import('./ui/topbar.js'), 'mountTopbar'],
    ['sidebar', () => import('./ui/sidebar.js'), 'mountSidebar'],
    ['event-bus', () => import('./ui/eventBus.js'), 'mountEventBus'],
    ['system-status', () => import('./ui/systemStatus.js'), 'mountSystemStatus'],
    ['stats-bar', () => import('./ui/statsBar.js'), 'mountStatsBar'],
    ['resource-usage', () => import('./ui/resourceUsage.js'), 'mountResourceUsage'],
  ];
  for (const [id, load, fn] of panels) {
    load().then((m) => m[fn](document.getElementById(id))).catch((err) => console.error(`[ui] ${id} failed`, err));
  }
}

if (!viewer) {
  import('./game/index.js').then((m) => m.startGame(ctx)).catch((err) => console.error('[game] failed to start', err));
}
