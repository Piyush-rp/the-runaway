import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// Creates renderer, camera, bloom composer and a tick registry shared by every city module.
export function createEngine(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  // Render at the screen's real pixel density. Browser zoom (Ctrl +/-) changes devicePixelRatio, so this is
  // re-read on every resize; the device-pixel count stays the same as the screen, so zooming costs no extra GPU.
  // Game hooks: `controls.enabled = false` hands the camera over to the game (no orbit/zoom/pan), `controls.fov`
  // overrides the camera fov, `controls.renderScale` trades sharpness for speed on weak GPUs.
  const controls = { enabled: true, fov: null, renderScale: 1 };
  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 3) * controls.renderScale;
  renderer.setPixelRatio(pixelRatio());
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#070B16');
  scene.fog = new THREE.FogExp2('#070B16', 0.0026); // was 0.0042, which halved the glow of roads 200 units away

  // Tilted bird's-eye camera fitted to ring AND rooftop-badge landmarks in ref/dashboard.png (shots/fit-camera2.mjs),
  // chosen 11-01 by side-by-side comparison (shots/cam-compare.png): 53.85 deg, distance 279.6, fov 20.
  // outskirts.js keeps a copy of these numbers in makeScreenMapper(); change both together.
  // Test-only override: ?cam=elevationDeg,distance,targetX,targetZ,fov (used to compare camera fits).
  const camQ = (new URLSearchParams(location.search).get('cam') || '').split(',').map(Number);
  const camO = camQ.length === 5 && camQ.every(Number.isFinite) ? camQ : null;
  const BASE_FOV = camO ? camO[4] : 20;
  const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.5, 1800);
  const target = camO ? new THREE.Vector3(camO[2], 0, camO[3]) : new THREE.Vector3(-0.85, 0, 8.15);
  const elevation = THREE.MathUtils.degToRad(camO ? camO[0] : 53.85);
  const distance = camO ? camO[1] : 279.6;
  camera.position.set(target.x, Math.sin(elevation) * distance, Math.cos(elevation) * distance + target.z);
  camera.lookAt(target);

  // The composer renders into its own offscreen targets, which ignore the canvas's `antialias`. Give them real
  // 4x MSAA (WebGL2), otherwise edges look pixelated, most visibly when zoomed in.
  const bufferSize = renderer.getDrawingBufferSize(new THREE.Vector2());
  const msaaTarget = new THREE.WebGLRenderTarget(Math.max(1, bufferSize.x), Math.max(1, bufferSize.y), {
    type: THREE.HalfFloatType,
    samples: renderer.capabilities.isWebGL2 ? 4 : 0,
  });
  const composer = new EffectComposer(renderer, msaaTarget);
  composer.addPass(new RenderPass(scene, camera));
  // Guard: a single NaN/Infinity pixel (e.g. from a degenerate normal) gets smeared by the bloom blur into a
  // large black rectangle. Replace invalid or negative values before bloom ever sees them.
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        // Bit-level test: exponent bits all ones means NaN or Infinity. D3D cannot optimise this away (it can drop isnan).
        uvec4 bits = floatBitsToUint(c);
        bvec4 bad = equal(bits & uvec4(0x7f800000u), uvec4(0x7f800000u));
        if (any(bad) || any(greaterThan(c.rgb, vec3(65000.0)))) c = vec4(0.0, 0.0, 0.0, 1.0);
        gl_FragColor = max(c, vec4(0.0));
      }`,
  }));
  // strength, radius, threshold. Lowered from 0.95/0.55/0.72, which washed the city in a lavender haze.
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.3, 0.85);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const tickers = [];
  const onTick = (fn) => tickers.push(fn);

  // ---------------------------------------------------------------- 360 orbit, zoom and pan
  // Left-drag orbits all the way round the city and tilts; right-drag (or Shift + left-drag) pans; the mouse wheel
  // zooms toward the cursor; R toggles a slow automatic 360 spin; Home resets to the reference view.
  // The default view (above) frames the city up to the second ring road, matching the reference.
  const DEFAULT_DIST = distance;
  const DEFAULT_TARGET = target.clone();
  const DEFAULT_PITCH = elevation;
  const MIN_DIST = 90;     // about 3x closer than default
  const MAX_DIST = 820;    // widest view: the whole last ring road (layout EDGE_RING, r 150) enclosing the city
  const MIN_PITCH = THREE.MathUtils.degToRad(15), MAX_PITCH = THREE.MathUtils.degToRad(88);
  const AUTO_SPIN = THREE.MathUtils.degToRad(6); // radians per second while auto-rotating
  const FOG_DENSITY = scene.fog.density;
  const view = { dist: distance, target: target.clone(), yaw: 0, pitch: elevation };   // current (smoothed)
  const goal = { dist: distance, target: target.clone(), yaw: 0, pitch: elevation };   // where we are heading
  let autoSpin = false;
  const offset = new THREE.Vector3();
  const ndc = new THREE.Vector2();
  const ray = new THREE.Raycaster();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();

  // unit vector from the target to the camera for a yaw (0 = camera south of the city, looking north) and pitch
  function offsetFor(yaw, pitch, out = offset) {
    return out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  }
  function placeCamera(dist, t, yaw, pitch) {
    camera.position.copy(offsetFor(yaw, pitch)).multiplyScalar(dist).add(t);
    camera.lookAt(t);
    camera.updateMatrixWorld();
  }
  function groundPointAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(ground, hit) ? hit.clone() : null;
  }
  // When zoomed out past the default view, ease the target toward the city centre (nudged away from the camera so
  // the tilted view fits the near edge) so the whole city stays framed from any direction.
  function clampTarget(t, dist, yaw) {
    const outward = THREE.MathUtils.clamp((dist - DEFAULT_DIST) / (MAX_DIST - DEFAULT_DIST), 0, 1);
    if (outward > 0) {
      const centre = new THREE.Vector3(-Math.sin(yaw) * 4, 0, -Math.cos(yaw) * 4);
      t.lerp(centre, outward);
    }
    const flat = Math.hypot(t.x, t.z), maxR = 95;
    if (flat > maxR) { t.x *= maxR / flat; t.z *= maxR / flat; }
    t.y = 0;
    return t;
  }
  canvas.addEventListener('wheel', (e) => {
    if (!controls.enabled) return;
    e.preventDefault();
    const factor = Math.exp(THREE.MathUtils.clamp(e.deltaY, -200, 200) * 0.0015);
    const newDist = THREE.MathUtils.clamp(goal.dist * factor, MIN_DIST, MAX_DIST);
    const p = groundPointAt(e.clientX, e.clientY);
    if (p) goal.target.sub(p).multiplyScalar(newDist / goal.dist).add(p); // keep the point under the cursor fixed
    goal.dist = newDist;
    clampTarget(goal.target, goal.dist, goal.yaw);
  }, { passive: false });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!controls.enabled) return;
    const pan = e.button === 2 || (e.button === 0 && e.shiftKey);
    if (pan) {
      const p = groundPointAt(e.clientX, e.clientY);
      if (p) drag = { mode: 'pan', start: p, target0: goal.target.clone(), id: e.pointerId };
    } else if (e.button === 0) {
      drag = { mode: 'orbit', x: e.clientX, y: e.clientY, yaw0: goal.yaw, pitch0: goal.pitch, id: e.pointerId };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id || !e.buttons) return;
    if (drag.mode === 'orbit') {
      goal.yaw = drag.yaw0 - (e.clientX - drag.x) * 0.006;
      goal.pitch = THREE.MathUtils.clamp(drag.pitch0 + (e.clientY - drag.y) * 0.004, MIN_PITCH, MAX_PITCH);
      return;
    }
    // Pan: move the target so the grabbed ground point follows the cursor, measured against the camera as it was
    // when the drag started, so the pan doesn't feed back on itself.
    const saved = camera.position.clone(), savedQ = camera.quaternion.clone();
    placeCamera(goal.dist, drag.target0, goal.yaw, goal.pitch);
    const p = groundPointAt(e.clientX, e.clientY);
    camera.position.copy(saved); camera.quaternion.copy(savedQ); camera.updateMatrixWorld();
    if (!p) return;
    goal.target.copy(drag.target0).add(drag.start).sub(p);
    clampTarget(goal.target, goal.dist, goal.yaw);
  });
  window.addEventListener('pointerup', () => { drag = null; });
  const resetView = () => {
    goal.dist = DEFAULT_DIST; goal.target.copy(DEFAULT_TARGET); goal.pitch = DEFAULT_PITCH;
    goal.yaw = Math.round(goal.yaw / (Math.PI * 2)) * Math.PI * 2; // nearest full turn, so it doesn't spin back
    autoSpin = false;
  };
  window.addEventListener('keydown', (e) => {
    if (!controls.enabled) return;
    if (e.key === 'Home') resetView();
    if (e.key === 'r' || e.key === 'R') autoSpin = !autoSpin;
  });

  onTick((t, dt) => {
    if (!controls.enabled) return;
    if (autoSpin && !drag) goal.yaw += AUTO_SPIN * dt;
    const k = 1 - Math.exp(-10 * dt);
    view.dist += (goal.dist - view.dist) * k;
    view.yaw += (goal.yaw - view.yaw) * k;
    view.pitch += (goal.pitch - view.pitch) * k;
    view.target.lerp(goal.target, k);
    placeCamera(view.dist, view.target, view.yaw, view.pitch);
    target.copy(view.target);
    // keep the haze the same when the camera moves away, so the far view doesn't wash out
    scene.fog.density = FOG_DENSITY * (DEFAULT_DIST / view.dist);
  });

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const pr = pixelRatio();
    if (renderer.getPixelRatio() !== pr) { renderer.setPixelRatio(pr); composer.setPixelRatio(pr); }
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.setSize(w, h);
    camera.aspect = w / h;
    // Keep the outer ring framed on narrow screens.
    camera.fov = controls.fov ?? (w / h < 1.4 ? BASE_FOV * (1.4 / (w / h)) ** 0.85 : BASE_FOV);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  // Some browsers change devicePixelRatio on zoom without a resize event; watch it directly too.
  const watchDpr = () => {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', () => { resize(); watchDpr(); }, { once: true });
  };
  watchDpr();
  resize();

  const clock = new THREE.Clock();
  function loop() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    for (const fn of tickers) fn(t, dt);
    composer.render();
    requestAnimationFrame(loop);
  }

  return { THREE, renderer, scene, camera, composer, bloom, onTick, target, controls, resize, resetView, toggleSpin: () => { autoSpin = !autoSpin; }, start: () => requestAnimationFrame(loop) };
}
