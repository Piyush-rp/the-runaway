// A light sharpening pass that runs last (after tone mapping), so the image stays crisp even when the game has to render below
// full resolution on a slow GPU. Clamped to the local min / max so it never rings or brightens the neon edges.
import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const SharpenShader = {
  uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) }, uK: { value: 0.25 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uK; varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb;
      vec3 s = texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;
      vec3 e = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb;
      vec3 w = texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb;
      vec3 lo = min(c, min(min(n, s), min(e, w))), hi = max(c, max(max(n, s), max(e, w)));
      vec3 o = c + uK * (4.0 * c - n - s - e - w);
      gl_FragColor = vec4(clamp(o, lo, hi), 1.0);
    }`,
};

export function addSharpen(ctx) {
  const pass = new ShaderPass(SharpenShader);
  ctx.composer.addPass(pass);
  const size = new THREE.Vector2();
  return {
    pass,
    // renderScale 1 = full resolution (a touch of sharpening); lower scales get more
    update(renderScale = 1) {
      ctx.renderer.getDrawingBufferSize(size);
      pass.uniforms.uTexel.value.set(1 / Math.max(1, size.x), 1 / Math.max(1, size.y));
      pass.uniforms.uK.value = THREE.MathUtils.clamp(0.22 + (1 - renderScale) * 1.1, 0.22, 0.7);
    },
  };
}
