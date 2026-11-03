// Top-down height capture of the real city. One orthographic render of every solid mesh into a render target that
// stores each pixel's world-space height, read back once into a Float32Array. After that the whole game queries
// "how high is the ground / roof at (x, z)?" in O(1): buildings become solid walls, rooftops become walkable and
// valid teleport targets, with no hand-made colliders and nothing to keep in sync with the city modules.
import * as THREE from 'three';

const MAX_H = 80;

const VERT = /* glsl */ `
  varying float vH;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vH = w.y;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
// 16-bit height packed into two 8-bit channels (works on every WebGL2 GPU, no float render targets needed)
const FRAG = /* glsl */ `
  varying float vH;
  void main() {
    float v = clamp(vH / ${MAX_H.toFixed(1)}, 0.0, 1.0) * 65535.0;
    float hi = floor(v / 256.0);
    float lo = floor(v - hi * 256.0);
    gl_FragColor = vec4(hi / 255.0, lo / 255.0, 0.0, 1.0);
  }`;

export class HeightMap {
  constructor(data, size, res) {
    this.data = data; this.size = size; this.res = res;
    this.half = size / 2; this.cell = size / res;
  }
  // height of the topmost solid surface at world (x, z); 0 outside the captured area
  h(x, z) {
    const ix = Math.floor((x + this.half) / this.cell), iz = Math.floor((z + this.half) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.res || iz >= this.res) return 0;
    return this.data[iz * this.res + ix];
  }
  // highest surface under a disc of radius r (centre + 8 points on its rim): what a body of that width collides with
  maxUnder(x, z, r) {
    let m = this.h(x, z);
    const d = r * 0.7071;
    m = Math.max(m, this.h(x + r, z), this.h(x - r, z), this.h(x, z + r), this.h(x, z - r),
      this.h(x + d, z + d), this.h(x - d, z + d), this.h(x + d, z - d), this.h(x - d, z - d));
    return m;
  }
  // flat enough to stand on: every sample within `tol` of the centre
  isFlat(x, z, r, tol = 0.35) {
    const c = this.h(x, z), d = r * 0.7071;
    for (const [ox, oz] of [[r, 0], [-r, 0], [0, r], [0, -r], [d, d], [-d, d], [d, -d], [-d, -d]]) {
      if (Math.abs(this.h(x + ox, z + oz) - c) > tol) return false;
    }
    return true;
  }
  // nearest spot to (x, z) that is flat, walkable ground (spiral search); returns {x, z} or null
  findOpen(x, z, r = 0.8, { maxH = 1.4, maxR = 25 } = {}) {
    for (let ring = 0; ring <= maxR; ring += 0.6) {
      const n = Math.max(1, Math.round((ring * Math.PI * 2) / 0.6));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const px = x + Math.cos(a) * ring, pz = z + Math.sin(a) * ring;
        if (this.h(px, pz) <= maxH && this.isFlat(px, pz, r, 0.2)) return { x: px, z: pz };
      }
    }
    return null;
  }
}

export function captureHeightmap({ renderer, scene }, { size = 340, res = 1024 } = {}) {
  const cam = new THREE.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0.1, 400);
  cam.position.set(0, 200, 0);
  cam.up.set(0, 0, -1); // top of the image = north = -Z, right = +X
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);

  const rt = new THREE.WebGLRenderTarget(res, res, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true, samples: 0 });
  rt.texture.minFilter = rt.texture.magFilter = THREE.NearestFilter;
  const override = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, toneMapped: false, fog: false });

  // Not solid: instanced props (bots, drones, lamps), sprites, points, lines and every additive glow / halo.
  const hidden = [];
  scene.traverse((o) => {
    if (!o.visible) return;
    const mats = [].concat(o.material || []);
    const glow = mats.some((m) => m.blending === THREE.AdditiveBlending || m.depthWrite === false);
    if (o.isInstancedMesh || o.isSprite || o.isPoints || o.isLine || (o.isMesh && glow)) { hidden.push(o); o.visible = false; }
  });

  const prev = { bg: scene.background, fog: scene.fog, ov: scene.overrideMaterial, rt: renderer.getRenderTarget() };
  const prevClear = new THREE.Color(); renderer.getClearColor(prevClear);
  const prevAlpha = renderer.getClearAlpha();
  scene.background = null; scene.fog = null; scene.overrideMaterial = override;
  renderer.setClearColor(0x000000, 1);
  renderer.setRenderTarget(rt);
  renderer.clear();
  renderer.render(scene, cam);
  const px = new Uint8Array(res * res * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, res, res, px);
  renderer.setRenderTarget(prev.rt);
  renderer.setClearColor(prevClear, prevAlpha);
  scene.background = prev.bg; scene.fog = prev.fog; scene.overrideMaterial = prev.ov;
  for (const o of hidden) o.visible = true;
  rt.dispose(); override.dispose();

  const data = new Float32Array(res * res);
  for (let rowBottom = 0; rowBottom < res; rowBottom++) {
    const iz = res - 1 - rowBottom; // readback rows run bottom-up; iz = 0 is the northern (-Z) edge
    for (let ix = 0; ix < res; ix++) {
      const o = (rowBottom * res + ix) * 4;
      data[iz * res + ix] = ((px[o] * 256 + px[o + 1]) / 65535) * MAX_H;
    }
  }
  return new HeightMap(data, size, res);
}
