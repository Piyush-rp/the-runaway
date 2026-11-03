import * as layout from './layout.js';
import { createEngine } from './engine.js';
// Each element module default-exports build(ctx). Order = registration order.
import buildGround from './ground.js';
import buildRoads from './roads.js';
import buildCore from './core.js';
import buildBuildings from './buildings/index.js';
import buildVehicles from './vehicles.js';
import buildOutskirts from './outskirts.js';
import { setupInteraction } from './interaction.js';

// Repairs zero-length or invalid normals. Lit materials normalise them to NaN, and bloom then spreads
// those pixels into large black rectangles. Returns how many vertices were fixed.
function repairNormals(scene) {
  let fixed = 0;
  scene.traverse((o) => {
    const n = o.isMesh && o.geometry?.attributes?.normal;
    if (!n || n.userData?.repaired === n.version) return;
    let changed = false;
    for (let i = 0; i < n.count; i++) {
      const x = n.getX(i), y = n.getY(i), z = n.getZ(i);
      const len = x * x + y * y + z * z;
      if (!(len > 1e-12) || !Number.isFinite(len)) { n.setXYZ(i, 0, 1, 0); fixed++; changed = true; }
    }
    if (changed) n.needsUpdate = true;
    n.userData = { ...(n.userData || {}), repaired: n.version };
  });
  return fixed;
}

// Sharp texture filtering at the steep viewing angles of this camera, so textures don't smear when zoomed in.
function sharpenTextures(scene, renderer) {
  const max = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const keys = ['map', 'emissiveMap', 'alphaMap', 'roughnessMap', 'metalnessMap', 'normalMap', 'bumpMap'];
  scene.traverse((o) => {
    for (const m of [].concat(o.material || [])) {
      for (const k of keys) {
        const t = m[k];
        if (t && t.isTexture && t.anisotropy < max) { t.anisotropy = max; t.needsUpdate = true; }
      }
      for (const u of Object.values(m.uniforms || {})) {
        const t = u && u.value;
        if (t && t.isTexture && t.anisotropy < max) { t.anisotropy = max; t.needsUpdate = true; }
      }
    }
  });
}

export function startCity(canvas, { interaction = true, game = false } = {}) {
  const engine = createEngine(canvas);
  const ctx = { ...engine, layout, game }; // game: quiet night city (fewer, slower bots), see vehicles.js
  const modules = { buildGround, buildRoads, buildCore, buildBuildings, buildVehicles, buildOutskirts };
  for (const [name, build] of Object.entries(modules)) {
    try { const out = build(ctx); if (name === 'buildVehicles') ctx.traffic = out; } catch (err) { console.error(`[city] ${name} failed`, err); }
  }
  const fixed = repairNormals(engine.scene);
  if (fixed) console.info(`[city] repaired ${fixed} zero-length normals`);
  // Some modules finish building asynchronously (textures, fonts), so check once more shortly after.
  setTimeout(() => repairNormals(engine.scene), 3000);
  sharpenTextures(engine.scene, engine.renderer);
  setTimeout(() => sharpenTextures(engine.scene, engine.renderer), 3500); // textures created after the first frame
  if (interaction) { try { setupInteraction(ctx); } catch (err) { console.error('[city] interaction failed', err); } }
  engine.start();
  window.__aura = ctx; // debugging handle
  return ctx;
}
