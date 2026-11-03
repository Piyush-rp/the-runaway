// Shared AURA icon set (section 4 of the reference sheet). 24x24 viewBox, stroke icons.
// Used by the DOM panels (iconSvg) and by the 3D rooftop badges (iconTexture in city/badges).
export const ICONS = {
  home: '<path d="M3 11.2 12 4l9 7.2" /><path d="M5.5 9.5V20h4.5v-6h4v6h4.5V9.5" fill="currentColor" fill-opacity=".9"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.5L3 20.5l1.6-5A8.4 8.4 0 1 1 21 11.5Z"/><circle cx="8.5" cy="11.5" r=".6" fill="currentColor"/><circle cx="12.5" cy="11.5" r=".6" fill="currentColor"/><circle cx="16.5" cy="11.5" r=".6" fill="currentColor"/>',
  agents: '<circle cx="12" cy="5.5" r="2.5"/><circle cx="5.5" cy="17.5" r="2.5"/><circle cx="18.5" cy="17.5" r="2.5"/><path d="M10.8 7.7 6.8 15.3M13.2 7.7l4 7.6M8 17.5h8"/>',
  tasks: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/><path d="m9 15 2 2 4-4"/>',
  knowledge: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h6M9 9h2"/>',
  storage: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13"/><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  models: '<circle cx="12" cy="12" r="2.6"/><circle cx="12" cy="5" r="2.4"/><circle cx="12" cy="19" r="2.4"/><circle cx="5.9" cy="8.5" r="2.4"/><circle cx="18.1" cy="8.5" r="2.4"/><circle cx="5.9" cy="15.5" r="2.4"/><circle cx="18.1" cy="15.5" r="2.4"/>',
  database: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" fill="currentColor" fill-opacity=".35"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13"/><path d="M4.5 9.8c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8M4.5 14.2c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
  cloud: '<path d="M17.5 19H7a5 5 0 0 1-.6-9.96A6 6 0 0 1 18 8.5a4.25 4.25 0 0 1-.5 10.5Z"/>',
  code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  document: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h6M9 9h2"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v2.6M12 18.9v2.6M21.5 12h-2.6M5.1 12H2.5M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8M18.7 18.7l-1.8-1.8M7.1 7.1 5.3 5.3"/><circle cx="12" cy="12" r="6.6"/>',
  chart: '<path d="M4 20h16"/><rect x="5.5" y="12" width="3" height="6" rx=".6" fill="currentColor"/><rect x="10.5" y="8" width="3" height="10" rx=".6" fill="currentColor"/><rect x="15.5" y="4" width="3" height="14" rx=".6" fill="currentColor"/>',
  automation: '<circle cx="12" cy="5" r="2.4"/><circle cx="5" cy="18" r="2.4"/><circle cx="19" cy="18" r="2.4"/><path d="M11 7.2 6.2 15.8M13 7.2l4.8 8.6M7.4 18h9.2"/><circle cx="12" cy="13.3" r="1.6"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5M3.5 18l6.3-6M20.5 18l-6.3-6"/>',
  people: '<circle cx="9" cy="8" r="3.2" fill="currentColor"/><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0Z" fill="currentColor"/><circle cx="16.8" cy="8.6" r="2.6" fill="currentColor" fill-opacity=".85"/><path d="M15.6 13.7A5.2 5.2 0 0 1 21.6 19h-4.4" fill="currentColor" fill-opacity=".85"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.2"/><path d="M8 3v4M16 3v4M3.5 10h17"/><path d="M7.5 13.5h1M11.5 13.5h1M15.5 13.5h1M7.5 17h1M11.5 17h1M15.5 17h1"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6Z"/><circle cx="12" cy="11" r="2"/><path d="M12 13v3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
  analytics: '<rect x="3" y="3.5" width="18" height="17" rx="2.5"/><path d="m6.5 16 3.5-4.2 3 2.6 4.5-6.2"/><path d="M14.5 8.2h3v3"/>',
  cube: '<path d="m12 2.8 8 4.4v9.6l-8 4.4-8-4.4V7.2Z"/><path d="m4 7.2 8 4.4 8-4.4M12 11.6v9.6"/>',
  bell: '<path d="M18 16V11a6 6 0 0 0-12 0v5l-2 2.5h16Z"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  clipboard: '<rect x="5" y="4.5" width="14" height="17" rx="2"/><rect x="8.5" y="2.5" width="7" height="4" rx="1"/><path d="M8.5 11h7M8.5 14.5h7M8.5 18h4"/>',
  chevronsLeft: '<path d="m11 17-5-5 5-5M18 17l-5-5 5-5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
};

export function iconSvg(name, { size = 24, stroke = 1.8, color = 'currentColor' } = {}) {
  const body = ICONS[name];
  if (!body) throw new Error(`Unknown icon: ${name}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" style="color:${color}">${body}</svg>`;
}
