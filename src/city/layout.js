// Shared city plan. World units, XZ ground plane, +Y up.
// Angles are degrees, counter-clockwise from +X (east). North (top of screen) = 90 deg = -Z.
export const RINGS = {
  core: 9,      // radius of the central brain-dome plaza
  ring0: 13,    // road hugging the core
  ring1: 31,    // middle ring (junction nodes left/right of core in the reference)
  ring2: 55,    // outer ring (big roundabouts on the diagonals)
};
export const ROAD_WIDTH = { ring0: 2.2, ring1: 2.8, ring2: 3.4, spoke: 2.2, exit: 2.6 };

// User decision (2026-10-28, confirmed after the afternoon revert): there is NO ring road hugging the core.
// RINGS.ring0 is kept only so old code still runs; do not draw a road there. The core sits on an elevated
// circular platform out to CORE_PLATFORM.radius, and inner spokes ramp up to its edge.
export const HAS_RING0_ROAD = false;

// User request 2026-10-30: one more MAIN ring road at r 84 that the outgoing exit roads connect to. It replaces
// the thin service ring (roads.js 'ring3'). The exit roads are KEPT at full length: they cross this ring at
// junctions and continue to the map edge (user correction). The outer city beyond it stays.
export const OUTER_RING = { radius: 84, width: 3.4 };
export const CORE_PLATFORM = { radius: 14.2, height: 1.2 };

// Polar helper: angle in degrees -> world {x, z}
export function polar(r, deg) {
  const a = (deg * Math.PI) / 180;
  return { x: Math.cos(a) * r, z: -Math.sin(a) * r };
}

// Radial spokes. inner: ring0 -> ring1 (between inner buildings). outer: ring1 -> ring2 (between outer buildings).
export const SPOKES = {
  inner: [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5],
  outer: [0, 36, 72, 108, 144, 180, 216, 252, 288, 324],
  // ring2 -> beyond the map edge
  exits: [0, 36, 90, 144, 180, 216, 270, 324],
};
// Large decorative roundabouts sitting on ring2 (reference: four glowing circles at the diagonals).
export const ROUNDABOUTS = [36, 144, 216, 324].map((deg) => ({ deg, r: RINGS.ring2, size: 3.6 }));

// Road glow colours per ring (sheet section 3 "Road Glow ...").
export const ROAD_COLORS = {
  ring0: '#A855F7', ring1: '#3A86FF', ring2: '#3A86FF', spoke: '#A855F7', exit: '#3A86FF',
  accent: '#FF2D95', warm: '#FF9F1C', cyan: '#22D3EE',
};

// Building slots (sheet section 5). `icon` keys come from src/icons/icons.js.
// footprint: rough width/depth in world units; the building module decides its exact shape.
export const BUILDINGS = [
  // inner ring (between ring0 and ring1)
  { id: 'knowledge',  name: 'Knowledge',  icon: 'document',   color: '#3A86FF', ring: 'inner', deg: 45,   r: 22, footprint: 7 },
  { id: 'hq-north',   name: 'Core Annex', icon: null,         color: '#FFF0B3', ring: 'inner', deg: 90,   r: 22, footprint: 7 },
  { id: 'docs',       name: 'Documents',  icon: 'document',   color: '#3A86FF', ring: 'inner', deg: 135,  r: 22, footprint: 7 },
  { id: 'code',       name: 'Code',       icon: 'code',       color: '#A855F7', ring: 'inner', deg: 180,  r: 22, footprint: 6.5 },
  { id: 'automation', name: 'Automation', icon: 'automation', color: '#FF9F1C', ring: 'inner', deg: 225,  r: 22, footprint: 6.5 },
  { id: 'calendar',   name: 'Calendar',   icon: 'calendar',   color: '#FF3ED1', ring: 'inner', deg: 270,  r: 22, footprint: 7 },
  { id: 'people',     name: 'People',     icon: 'people',     color: '#3A86FF', ring: 'inner', deg: 315,  r: 22, footprint: 6.5 },
  { id: 'mail',       name: 'Mail',       icon: 'mail',       color: '#FF2D95', ring: 'inner', deg: 0,    r: 22, footprint: 6.5 },
  // outer ring (between ring1 and ring2)
  { id: 'models-box', name: 'Models',     icon: 'cube',       color: '#A855F7', ring: 'outer', deg: 90,   r: 43, footprint: 10 },
  { id: 'cloud',      name: 'Cloud',      icon: 'cloud',      color: '#FF9F1C', ring: 'outer', deg: 54,   r: 43, footprint: 10 },
  { id: 'gear',       name: 'Settings',   icon: 'gear',       color: '#FF9F1C', ring: 'outer', deg: 18,   r: 43, footprint: 9 },
  { id: 'shield',     name: 'Security',   icon: 'shield',     color: '#3A86FF', ring: 'outer', deg: -18,  r: 43, footprint: 9 },
  { id: 'search',     name: 'Search',     icon: 'search',     color: '#00D4A8', ring: 'outer', deg: -54,  r: 43, footprint: 10 },
  { id: 'storage',    name: 'Storage',    icon: 'database',   color: '#00F5A0', ring: 'outer', deg: -90,  r: 43, footprint: 12 },
  { id: 'analytics',  name: 'Analytics',  icon: 'analytics',  color: '#00F5A0', ring: 'outer', deg: -126, r: 43, footprint: 10 },
  { id: 'chart',      name: 'Chart',      icon: 'chart',      color: '#00F5A0', ring: 'outer', deg: -162, r: 43, footprint: 10 },
  { id: 'models',     name: 'Models Lab', icon: 'models',     color: '#FF3ED1', ring: 'outer', deg: 162,  r: 43, footprint: 9 },
  { id: 'database',   name: 'Database',   icon: 'database',   color: '#3A86FF', ring: 'outer', deg: 126,  r: 43, footprint: 10 },
];

// Landmark outside the ring (reference: lit monument with a flag, far right).
export const MONUMENT = { deg: 8, r: 72 };
export const WORLD_SIZE = 340; // ground edge length: covers the r 150 last ring with margin (user 10-31)

// User decision 2026-10-31: the LAST ring road at r 150 encloses ALL buildings. Every exit road runs from ring2
// out to this ring and ENDS there (T-junctions); no road continues beyond it and nothing is built outside it.
export const EDGE_RING = { radius: 150, width: 3.4 };
