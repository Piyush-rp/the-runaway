// Game-mode look: the neon city at night, quieter. Darker exposure and fog, dimmer glow and bloom, two thirds of the
// street lamps gone, and the floating building icons removed. Only touches the live scene, so the viewer (?view) keeps
// the original look. Tunables are at the top.
import * as THREE from 'three';

export const NIGHT = {
  exposure: 0.62,      // was 1.05
  lightScale: 0.4,     // hemisphere + directional light
  bloom: { strength: 0.3, radius: 0.3, threshold: 0.9 }, // was 0.55 / 0.3 / 0.85
  glowScale: 0.55,     // additive halos, light pools, sprites
  roadDim: 0.55,       // neon road ribbons and junction pads
  beamDim: 0.5,        // the light pulses running down the road centres
  lampKeep: 3,         // keep one lamp in this many
  bg: '#03060d',
  fogDensity: 0.0036,  // was 0.0026
};

export function applyNight(ctx) {
  const { scene, renderer, bloom } = ctx;
  const stats = { badges: 0, lampsKept: 0, lampsTotal: 0, glows: 0, roadsDimmed: 0 };

  renderer.toneMappingExposure = NIGHT.exposure;
  bloom.strength = NIGHT.bloom.strength; bloom.radius = NIGHT.bloom.radius; bloom.threshold = NIGHT.bloom.threshold;
  scene.background = new THREE.Color(NIGHT.bg);
  scene.fog.color.set(NIGHT.bg); scene.fog.density = NIGHT.fogDensity;

  const brain = scene.getObjectByName('core-brain'); // the dome stays, but only the captured child is inside it
  if (brain) brain.visible = false;

  const seen = new Set();
  const dimShader = (m) => { // the road shaders have no intensity uniform, so scale their output in the GLSL source
    const f = m.fragmentShader; if (!f) return;
    let n = f.replace('gl_FragColor = vec4(col, alpha);', `gl_FragColor = vec4(col * ${NIGHT.roadDim.toFixed(2)}, alpha);`)
      .replace('gl_FragColor = vec4(col, a);', `gl_FragColor = vec4(col * ${NIGHT.roadDim.toFixed(2)}, a);`)
      .replace('gl_FragColor = vec4(vBeam *', `gl_FragColor = vec4(${NIGHT.beamDim.toFixed(2)} * vBeam *`);
    if (n !== f) { m.fragmentShader = n; m.needsUpdate = true; stats.roadsDimmed++; }
  };
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  scene.traverse((o) => {
    if (o.isLight) o.intensity *= NIGHT.lightScale;

    // the floating building icons (badges) and their halos
    if (o.name === 'badge') { o.visible = false; stats.badges++; return; }

    // street lamps: poles are an instanced mesh with the '#1a2236' pole material; heads are a Points cloud with aSeed
    if (o.isInstancedMesh && o.material?.color?.getHexString?.() === '1a2236' && o.count > 200) {
      const m = new THREE.Matrix4();
      for (let i = 0; i < o.count; i++) { stats.lampsTotal++; if (i % NIGHT.lampKeep === 0) stats.lampsKept++; else { m.copy(zero); o.setMatrixAt(i, m); } }
      o.instanceMatrix.needsUpdate = true;
    }
    if (o.isPoints && o.geometry?.attributes?.aSeed) {
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) if (i % NIGHT.lampKeep !== 0) pos.setY(i, -100);
      pos.needsUpdate = true;
    }

    // everything that is pure glow: halos, light pools, sprites, point lights of lamps and sparkles
    for (const m of [].concat(o.material || [])) {
      if (seen.has(m)) continue;
      if (m.isShaderMaterial && !seen.has(m)) dimShader(m);
      const glow = m.blending === THREE.AdditiveBlending || o.isSprite || o.isPoints;
      if (!glow) continue;
      seen.add(m);
      if (m.uniforms?.uColor?.value?.multiplyScalar) m.uniforms.uColor.value.multiplyScalar(NIGHT.glowScale);
      else if ('opacity' in m) { m.opacity *= NIGHT.glowScale; if (m.opacity < 1) m.transparent = true; }
      stats.glows++;
    }
  });
  return stats;
}
