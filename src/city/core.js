/*
 * Central core: the AURA brain dome (ref/crop_core.png).
 * Multi-tier platform with lit rim bands, warm-windowed drum, translucent glass dome holding a
 * procedural electric "brain" (no emblem), #8B5CF6 aura halo, pulsing base rings, rotating
 * dashed rings and connection beams along the inner spokes. Character name: Cobi (no letter on the core).
 * Unlit (Basic / Shader materials only), no real lights. Everything animates through ctx.onTick.
 */
const TAU = Math.PI * 2;

// dimensions (world units). RINGS.core = 9 is the plaza radius, links to ring0 start at 8.8.
const P0 = 9.2;        // reference radius for the platform service lane (lane starts at P0 + 1.2)
const BASE_R = 10.35;  // raised base tier, broadened so its edge meets the dotted service lane
const BASE_H = 0.55;
const DRUM_R = 8.1;    // drum under the dome
const DRUM_TOP = 2.3;
const DOME_R = 7.05;
const DOME_Y = DRUM_TOP + 0.12;

export default function build(ctx) {
  const { THREE, scene, onTick, camera, layout } = ctx;
  // Elevated platform (layout.CORE_PLATFORM) when there is no ring0 road hugging the core.
  const HAS_PLAT = layout.HAS_RING0_ROAD === false && !!layout.CORE_PLATFORM;
  const PLAT_R = HAS_PLAT ? layout.CORE_PLATFORM.radius : BASE_R;
  const PLAT_H = HAS_PLAT ? layout.CORE_PLATFORM.height : 0;
  // ground-level group (platform, spoke beams); everything else sits on top of the platform
  const groundG = new THREE.Group();
  groundG.name = 'core-platform';
  scene.add(groundG);
  const root = new THREE.Group();
  root.name = 'core';
  root.position.y = PLAT_H;
  scene.add(root);

  const lin = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);
  const ticks = [];

  // ---------------------------------------------------------------- canvas helpers
  function canvasTex(w, h, draw, opts = {}) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    if (opts.wrap) { t.wrapS = THREE.RepeatWrapping; }
    return t;
  }

  // ---------------------------------------------------------------- base tier
  // top-down texture of the base tier deck (planar UVs of CircleGeometry): grey service ring with
  // lane marks, posts and warm dots, dark inner apron.
  const deckTex = canvasTex(1024, 1024, (g, w) => {
    const c = w / 2, s = c / BASE_R; // px per unit
    const K = BASE_R / 9.2; // texture radii were laid out for a 9.2 tier
    g.fillStyle = '#0c111e'; g.fillRect(0, 0, w, w);
    // service ring (track)
    const ring = (r0, r1, col) => { g.beginPath(); g.arc(c, c, r1 * s, 0, TAU); g.arc(c, c, r0 * s, 0, TAU, true); g.fillStyle = col; g.fill(); };
    ring(7.6 * K, 9.2 * K, '#262c3f');
    ring(8.05 * K, 8.95 * K, '#323a52');
    // lane dashes
    g.strokeStyle = 'rgba(190,200,230,0.55)'; g.lineWidth = 2; g.setLineDash([10, 14]);
    g.beginPath(); g.arc(c, c, 8.5 * K * s, 0, TAU); g.stroke(); g.setLineDash([]);
    // inner / outer lines
    g.strokeStyle = '#6a5cc8'; g.lineWidth = 3; g.beginPath(); g.arc(c, c, 9.12 * K * s, 0, TAU); g.stroke();
    g.strokeStyle = '#3b4466'; g.lineWidth = 2; g.beginPath(); g.arc(c, c, 8.02 * K * s, 0, TAU); g.stroke();
    // warm light dots and small posts around the track
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * TAU;
      const r = (i % 2 ? 8.98 : 8.06) * K * s;
      const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
      const gr = g.createRadialGradient(x, y, 0, x, y, 7);
      gr.addColorStop(0, 'rgba(255,230,170,1)'); gr.addColorStop(0.4, 'rgba(255,170,70,0.6)'); gr.addColorStop(1, 'rgba(255,140,40,0)');
      g.fillStyle = gr; g.fillRect(x - 8, y - 8, 16, 16);
    }
  });
  const baseTop = new THREE.Mesh(new THREE.CircleGeometry(BASE_R, 96), new THREE.MeshBasicMaterial({ map: deckTex }));
  baseTop.rotation.x = -Math.PI / 2;
  baseTop.position.y = BASE_H;
  root.add(baseTop);

  // base side: dark metal with a row of warm windows
  const baseSideTex = canvasTex(2048, 64, (g, w, h) => {
    g.fillStyle = '#121828'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1d2438'; g.fillRect(0, 0, w, 10);
    for (let i = 0; i < 96; i++) {
      const x = (i / 96) * w;
      g.fillStyle = i % 8 === 0 ? '#3a4260' : '#0b0f1a'; g.fillRect(x, 10, 3, h - 10);
      if (i % 8 !== 0) {
        const gr = g.createLinearGradient(0, 22, 0, 50);
        gr.addColorStop(0, '#ffd27a'); gr.addColorStop(1, '#ff9f1c');
        g.fillStyle = gr; g.fillRect(x + 6, 24, w / 96 - 10, 22);
      }
    }
  }, { wrap: true });
  const baseSide = new THREE.Mesh(
    new THREE.CylinderGeometry(BASE_R, BASE_R + 0.15, BASE_H, 96, 1, true),
    new THREE.MeshBasicMaterial({ map: baseSideTex, color: lin('#ffffff', 1.25) }),
  );
  baseSide.position.y = BASE_H / 2;
  root.add(baseSide);

  // ---------------------------------------------------------------- shared additive glow tube shader
  // Soft tube / ring glow: brightness falls off toward the silhouette (view-facing), with optional
  // travelling pulses along uv.x.
  const glowVS = /* glsl */`
    varying vec3 vN; varying vec3 vV; varying vec2 vUv;
    void main(){
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position,1.0);
      vN = normalize(mat3(modelMatrix) * normal);
      vV = normalize(cameraPosition - wp.xyz);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const glowFS = /* glsl */`
    uniform vec3 uColor; uniform float uPow; uniform float uTime; uniform float uPulse; uniform float uOpacity;
    varying vec3 vN; varying vec3 vV; varying vec2 vUv;
    void main(){
      float f = pow(abs(dot(normalize(vN), normalize(vV))), uPow);
      float p = 1.0;
      if (uPulse > 0.0) {
        float d = abs(vUv.x - 0.5) * 2.0;           // 0 at dome apex, 1 at both ends
        float w = fract(d * uPulse - uTime * 0.55);
        p = 0.75 + 1.6 * smoothstep(0.82, 1.0, w) * smoothstep(1.0, 0.97, w);
      }
      gl_FragColor = vec4(uColor * f * p * uOpacity, 1.0);
    }`;
  function glowMat(hex, k, pow = 1.6, pulse = 0) {
    const m = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: lin(hex, k) }, uPow: { value: pow }, uTime: { value: 0 }, uPulse: { value: pulse }, uOpacity: { value: 1 } },
      vertexShader: glowVS, fragmentShader: glowFS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    ticks.push((t) => { m.uniforms.uTime.value = t; });
    return m;
  }
  const solid = (hex, k) => new THREE.MeshBasicMaterial({ color: lin(hex, k) });

  function torus(r, tube, y, mat, seg = 160) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, seg), mat);
    m.rotation.x = -Math.PI / 2; m.position.y = y;
    root.add(m); return m;
  }
  // ---------------------------------------------------------------- elevated core platform
  // Wide circular plinth the whole core stands on: tiled top with subtle concentric rings and a grey
  // service lane, dark metal side with a restrained warm window band, lit lavender top edge and a
  // cool foot line. The spoke ramps themselves (surface + side walls) are built by roads.js.
  if (HAS_PLAT) {
    const platTopTex = canvasTex(1024, 1024, (g, w) => {
      const c = w / 2, s = c / PLAT_R;
      g.fillStyle = '#1a2032'; g.fillRect(0, 0, w, w);
      const ring = (r0, r1, col) => { g.beginPath(); g.arc(c, c, r1 * s, 0, TAU); g.arc(c, c, r0 * s, 0, TAU, true); g.fillStyle = col; g.fill(); };
      ring(P0, PLAT_R, '#252b3e');
      ring(P0 + 1.2, P0 + 3.2, '#2c3348');                // grey service lane
      g.strokeStyle = 'rgba(210,220,250,0.45)'; g.lineWidth = 2.5; g.setLineDash([14, 18]);
      g.beginPath(); g.arc(c, c, (P0 + 2.2) * s, 0, TAU); g.stroke(); g.setLineDash([]);
      ring(PLAT_R - 1.1, PLAT_R - 0.35, '#1d2539');            // outer walkway band
      // tile rings
      g.strokeStyle = 'rgba(150,160,200,0.2)'; g.lineWidth = 1.5;
      for (let r = P0 + 3.45; r < PLAT_R - 1.1; r += 0.85) { g.beginPath(); g.arc(c, c, r * s, 0, TAU); g.stroke(); }
      // radial tile joints
      g.strokeStyle = 'rgba(120,135,190,0.14)'; g.lineWidth = 1;
      for (let i = 0; i < 96; i++) {
        const a = (i / 96) * TAU;
        g.beginPath(); g.moveTo(c + Math.cos(a) * (P0 + 3.3) * s, c + Math.sin(a) * (P0 + 3.3) * s);
        g.lineTo(c + Math.cos(a) * (PLAT_R - 1.1) * s, c + Math.sin(a) * (PLAT_R - 1.1) * s); g.stroke();
      }
      // inner lit seam and outer edge line
      g.strokeStyle = 'rgba(150,130,255,0.55)'; g.lineWidth = 2;
      g.beginPath(); g.arc(c, c, (PLAT_R - 1.1) * s, 0, TAU); g.stroke();
      g.strokeStyle = 'rgba(200,190,255,0.7)'; g.lineWidth = 3;
      g.beginPath(); g.arc(c, c, (PLAT_R - 0.12) * s, 0, TAU); g.stroke();
      // ---- rooftop garden band (lawn, flower beds, curved stone path, light pools) between the
      // terrace wall and the edge parapet. Paved only right above each tunnel portal.
      // Canvas angle: canvas y is down = world +Z, so canvas angle a = -deg (radians).
      const G0 = P0 + 3.36, G1 = PLAT_R - 0.2;
      const angD = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
      const spokeD = (deg) => Math.min(...layout.SPOKES.inner.map((s) => angD(deg, s)));
      let sd = 11; const rr = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
      const cx = (r, deg) => c + Math.cos((-deg * Math.PI) / 180) * r * s;
      const cy = (r, deg) => c + Math.sin((-deg * Math.PI) / 180) * r * s;
      const STEP = 0.5;
      for (let deg = 0; deg < 360; deg += STEP) {
        const sdg = spokeD(deg);
        const a0 = (-deg * Math.PI) / 180, a1 = (-(deg + STEP + 0.05) * Math.PI) / 180;
        g.beginPath(); g.arc(c, c, G1 * s, a0, a1, true); g.arc(c, c, G0 * s, a1, a0, false); g.closePath();
        if (sdg < 3) { g.fillStyle = '#262c40'; g.fill(); continue; }           // paved portal roof
        const k = 0.85 + 0.3 * rr();
        g.fillStyle = `rgb(${Math.round(30 * k)},${Math.round(74 * k)},${Math.round(46 * k)})`; g.fill();
      }
      // lawn mottling
      for (let i = 0; i < 9000; i++) {
        const deg = rr() * 360; if (spokeD(deg) < 3.2) continue;
        const r = G0 + 0.05 + rr() * (G1 - G0 - 0.1);
        g.fillStyle = rr() < 0.5 ? 'rgba(80,150,90,0.4)' : 'rgba(14,34,22,0.45)';
        g.fillRect(cx(r, deg), cy(r, deg), 2, 2);
      }
      // flower beds: soft dark soil ovals with coloured bloom speckles
      const bloomCols = ['#ff7eb6', '#ffd166', '#c39bff', '#ffffff', '#ff9e5e', '#7fd6ff'];
      for (let deg = 2; deg < 360; deg += 5.3) {
        if (spokeD(deg) < 3.5) continue;
        const r = spokeD(deg) < 7 ? 12.95 : (rr() < 0.5 ? 13.62 : 13.08);
        const x = cx(r, deg), y = cy(r, deg);
        g.save(); g.translate(x, y); g.rotate((-deg * Math.PI) / 180 + Math.PI / 2);
        g.fillStyle = '#1b1a20'; g.beginPath(); g.ellipse(0, 0, 13, 5, 0, 0, TAU); g.fill();
        const col = bloomCols[Math.floor(rr() * bloomCols.length)];
        for (let j = 0; j < 22; j++) {
          const u = (rr() - 0.5) * 22, v = (rr() - 0.5) * 7;
          g.fillStyle = rr() < 0.7 ? col : bloomCols[Math.floor(rr() * bloomCols.length)];
          g.fillRect(u, v, 2, 2);
        }
        g.restore();
      }
      // curved garden path meandering through the band, with warm light pools along it
      g.strokeStyle = '#5c5a66'; g.lineWidth = 0.26 * s; g.lineCap = 'round';
      const pathR = (deg) => 13.33 + 0.2 * Math.sin(deg * 0.9 * Math.PI / 180 * 8);
      let open = false;
      for (let deg = 0; deg <= 360; deg += 0.5) {
        const ok = spokeD(deg) > 3.4;
        if (ok && !open) { g.beginPath(); g.moveTo(cx(pathR(deg), deg), cy(pathR(deg), deg)); open = true; }
        else if (ok) g.lineTo(cx(pathR(deg), deg), cy(pathR(deg), deg));
        else if (open) { g.stroke(); open = false; }
      }
      if (open) g.stroke();
      g.strokeStyle = 'rgba(150,140,130,0.35)'; g.lineWidth = 1.2; g.setLineDash([4, 5]);
      open = false;
      for (let deg = 0; deg <= 360; deg += 0.5) {
        const ok = spokeD(deg) > 3.4;
        if (ok && !open) { g.beginPath(); g.moveTo(cx(pathR(deg), deg), cy(pathR(deg), deg)); open = true; }
        else if (ok) g.lineTo(cx(pathR(deg), deg), cy(pathR(deg), deg));
        else if (open) { g.stroke(); open = false; }
      }
      if (open) g.stroke();
      g.setLineDash([]);
      const pool = (x, y, rad, a) => {
        const gr = g.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, `rgba(255,214,150,${a})`); gr.addColorStop(0.5, `rgba(255,170,80,${a * 0.35})`); gr.addColorStop(1, 'rgba(255,150,60,0)');
        g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      };
      for (let deg = 1.2; deg < 360; deg += 2.4) if (spokeD(deg) > 3.6) pool(cx(pathR(deg), deg), cy(pathR(deg), deg), 11, 0.8);
      // a soft light pool on each paved portal roof
      for (const sp of layout.SPOKES.inner) pool(cx(13.3, sp), cy(13.3, sp), 16, 0.4);
    });
    const top = new THREE.Mesh(new THREE.RingGeometry(BASE_R - 0.3, PLAT_R, 128, 1), new THREE.MeshBasicMaterial({ map: platTopTex }));
    { const pos = top.geometry.attributes.position, uv = top.geometry.attributes.uv;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (2 * PLAT_R) + 0.5, pos.getY(i) / (2 * PLAT_R) + 0.5); }
    top.rotation.x = -Math.PI / 2; top.position.y = PLAT_H;
    groundG.add(top);

    const sideTex = canvasTex(2048, 64, (g, w, h) => {
      const bg = g.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#2a3150'); bg.addColorStop(0.15, '#151b2c'); bg.addColorStop(1, '#0b0f1a');
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      const N = 128;
      for (let i = 0; i < N; i++) {
        const x = (i / N) * w, cw = w / N;
        if (i % 8 === 0) { g.fillStyle = '#39415f'; g.fillRect(x, 8, 3, h - 8); continue; }
        const lit = (i * 29) % 7 > 1;
        g.fillStyle = lit ? 'rgba(255,190,110,0.85)' : 'rgba(110,80,50,0.6)';
        g.fillRect(x + 3, 26, cw - 6, 16);
      }
    }, { wrap: true });
    sideTex.repeat.x = 2;
    const side = new THREE.Mesh(
      new THREE.CylinderGeometry(PLAT_R, PLAT_R + 0.2, PLAT_H, 160, 1, true),
      new THREE.MeshBasicMaterial({ map: sideTex, color: lin('#ffffff', 0.95) }),
    );
    side.position.y = PLAT_H / 2;
    groundG.add(side);

    const gTorus = (r, tube, y, mat) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 200), mat);
      m.rotation.x = -Math.PI / 2; m.position.y = y; groundG.add(m); return m;
    };
    gTorus(PLAT_R + 0.01, 0.05, PLAT_H, solid('#c9bcff', 0.9));          // lit top edge
    gTorus(PLAT_R + 0.01, 0.2, PLAT_H, glowMat('#8B5CF6', 0.1, 1.6));
    gTorus(PLAT_R + 0.2, 0.04, 0.04, solid('#3A86FF', 0.6));             // cool foot line

    // ---------- tunnel portals: the flat inner spokes run into the platform at y = 0
    const SPOKE_W = (layout.ROAD_WIDTH && layout.ROAD_WIDTH.spoke) || 2.2;
    const PW = SPOKE_W + 0.5, PH = PLAT_H * 0.94;
    const portalTex = canvasTex(256, 128, (g, w, h) => {
      // dark recessed opening: converging tunnel walls, warm-violet glow deep inside, lane line
      g.fillStyle = '#05070f'; g.fillRect(0, 0, w, h);
      const vx = w / 2, vy = h * 0.5;
      const glow = g.createRadialGradient(vx, vy, 2, vx, vy, w * 0.42);
      glow.addColorStop(0, 'rgba(190,150,255,0.95)'); glow.addColorStop(0.25, 'rgba(120,90,240,0.45)');
      glow.addColorStop(1, 'rgba(40,30,90,0)');
      g.fillStyle = glow; g.fillRect(0, 0, w, h);
      // tunnel wall edges converging to the vanishing point
      g.strokeStyle = 'rgba(130,140,220,0.35)'; g.lineWidth = 2;
      for (const [x0, y0] of [[0, 0], [w, 0], [0, h], [w, h]]) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(vx + (x0 - vx) * 0.18, vy + (y0 - vy) * 0.18); g.stroke(); }
      // road floor and its glowing lane line running inside
      g.fillStyle = 'rgba(30,36,60,0.9)';
      g.beginPath(); g.moveTo(0, h); g.lineTo(w, h); g.lineTo(vx + w * 0.09, vy + h * 0.1); g.lineTo(vx - w * 0.09, vy + h * 0.1); g.fill();
      const ln = g.createLinearGradient(0, h, 0, vy);
      ln.addColorStop(0, 'rgba(200,170,255,0.95)'); ln.addColorStop(1, 'rgba(200,170,255,0.2)');
      g.fillStyle = ln;
      g.beginPath(); g.moveTo(vx - 4, h); g.lineTo(vx + 4, h); g.lineTo(vx + 1, vy + h * 0.1); g.lineTo(vx - 1, vy + h * 0.1); g.fill();
    });
    const portalMat = new THREE.MeshBasicMaterial({ map: portalTex, color: lin('#ffffff', 1.3), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const portalGeo = new THREE.PlaneGeometry(PW, PH);
    const flare = Math.atan2(0.2, PLAT_H);              // side wall leans out toward its foot
    const frameGeoV = new THREE.BoxGeometry(0.18, PH + 0.08, 0.14);
    const frameGeoH = new THREE.BoxGeometry(PW + 0.36, 0.16, 0.14);
    const haloGeo = new THREE.PlaneGeometry(PW + 1.4, PH + 0.9);
    const portalHaloTex = canvasTex(128, 128, (g, w) => {
      const r = g.createRadialGradient(w / 2, w * 0.7, 0, w / 2, w * 0.7, w * 0.6);
      r.addColorStop(0, 'rgba(160,120,255,0.8)'); r.addColorStop(1, 'rgba(120,80,240,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, w);
    });
    const portalColors = { 22.5: '#A855F7', 67.5: '#22D3EE', 112.5: '#3A86FF', 157.5: '#A855F7', 202.5: '#FF2D95', 247.5: '#3A86FF', 292.5: '#22D3EE', 337.5: '#FF2D95' };
    for (const deg of layout.SPOKES.inner) {
      const grp = new THREE.Group();
      grp.rotation.y = (deg * Math.PI) / 180;     // +X -> polar(deg)
      const face = new THREE.Group();             // local +Z = outward normal of the wall
      face.position.set(PLAT_R + 0.1 + 0.11, PH / 2, 0);
      face.rotation.set(0, Math.PI / 2, 0);
      face.rotateX(-flare);
      const op = new THREE.Mesh(portalGeo, portalMat);
      op.position.z = 0.02; face.add(op);
      const fm = solid(portalColors[deg] || '#A855F7', 1.0);
      for (const sx of [-1, 1]) { const p = new THREE.Mesh(frameGeoV, fm); p.position.set(sx * (PW / 2 + 0.06), 0.02, 0.06); face.add(p); }
      const lint = new THREE.Mesh(frameGeoH, fm); lint.position.set(0, PH / 2 + 0.04, 0.06); face.add(lint);
      const hal = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ map: portalHaloTex, color: lin(portalColors[deg] || '#A855F7', 0.35), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      hal.position.z = 0.1; hal.renderOrder = 4; face.add(hal);
      grp.add(face);
      groundG.add(grp);
    }

    // ---------- light greenery and low walls on the platform top
    // Free band: between the service lane (BASE_R+1.2..BASE_R+3.2) and the edge walkway. Keep clear of
    // the portal angles (the N-S beam was removed, so its path no longer needs to stay clear).
    const isClear = (deg, margin) => {
      const d = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
      for (const s of layout.SPOKES.inner) if (d(deg, s) < margin + 3) return false;
      return true;
    };
    const Y = PLAT_H;
    const R_IN = P0 + 3.3, R_OUT = PLAT_R - 1.2;      // planter / terrace band
    const R_PL = R_IN + 0.36;                              // planter centre radius
    const pol = (r, deg) => { const a = (deg * Math.PI) / 180; return [Math.cos(a) * r, -Math.sin(a) * r]; };
    const wallMat = new THREE.MeshLambertMaterial({ color: '#a3a6c8', emissive: '#2c2e48' });
    const dummy = new THREE.Object3D();

    // edge parapet: short segments, broken at the portal angles and the beam path
    {
      const segs = [];
      for (let deg = 0; deg < 360; deg += 2.5) if (isClear(deg, 4)) segs.push(deg);
      const geo = new THREE.BoxGeometry(0.62, 0.22, 0.1);
      const im = new THREE.InstancedMesh(geo, wallMat, segs.length);
      segs.forEach((deg, i) => {
        const [x, z] = pol(PLAT_R - 0.18, deg);
        dummy.position.set(x, Y + 0.11, z); dummy.rotation.set(0, (deg * Math.PI) / 180 + Math.PI / 2, 0); dummy.scale.set(1, 1, 1);
        dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
      });
      groundG.add(im);
    }
    // terrace walls along the inner side of the planter band, and planter boxes with trees
    const planters = [];
    {
      const tw = [];
      for (let deg = 4; deg < 360; deg += 7.5) {
        if (!isClear(deg, 7)) continue;
        tw.push(deg);
        planters.push(deg);
      }
      const geo = new THREE.BoxGeometry(1.25, 0.2, 0.14);
      const im = new THREE.InstancedMesh(geo, wallMat, tw.length);
      tw.forEach((deg, i) => {
        const [x, z] = pol(R_IN, deg);
        dummy.position.set(x, Y + 0.1, z); dummy.rotation.set(0, (deg * Math.PI) / 180 + Math.PI / 2, 0);
        dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
      });
      groundG.add(im);
      // warm light strip on top of the terrace walls (thin, restrained)
      const sg = new THREE.BoxGeometry(1.2, 0.025, 0.05);
      const sm = new THREE.InstancedMesh(sg, solid('#ffc477', 0.55), tw.length);
      tw.forEach((deg, i) => {
        const [x, z] = pol(R_IN, deg);
        dummy.position.set(x, Y + 0.21, z); dummy.rotation.set(0, (deg * Math.PI) / 180 + Math.PI / 2, 0);
        dummy.updateMatrix(); sm.setMatrixAt(i, dummy.matrix);
      });
      groundG.add(sm);
      // planter boxes
      const pg = new THREE.BoxGeometry(1.1, 0.24, 0.42);
      const pm = new THREE.InstancedMesh(pg, wallMat, planters.length);
      planters.forEach((deg, i) => {
        const [x, z] = pol(R_PL, deg);
        dummy.position.set(x, Y + 0.12, z); dummy.rotation.set(0, (deg * Math.PI) / 180 + Math.PI / 2, 0);
        dummy.updateMatrix(); pm.setMatrixAt(i, dummy.matrix);
      });
      groundG.add(pm);
    }
    // small low-poly trees: one per planter plus a few loose ones, a handful with warm uplights
    {
      let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const spots = [];
      planters.forEach((deg) => { spots.push([R_PL, deg - 1.3, 1, false]); spots.push([R_PL, deg + 1.4, 0.85, false]); });
      // border fill: a tree in every gap between neighbouring planters (portal approaches stay clear)
      planters.forEach((deg) => { if (planters.includes(deg + 7.5) || (deg + 7.5 >= 360 && planters.includes(deg + 7.5 - 360))) spots.push([R_PL + (rnd() - 0.5) * 0.12, deg + 3.75, 0.8, true]); });
      const crownGeo = new THREE.IcosahedronGeometry(0.46, 0);
      const trunkGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.3, 5);
      const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#0c2416' }), spots.length);
      const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: '#3a2c24' }), spots.length);
      const greens = ['#3f9a5c', '#4caa62', '#358a57', '#5ab86a'].map((h) => new THREE.Color(h));
      const ups = [];
      spots.forEach(([r, deg, k], i) => {
        const [x, z] = pol(r, deg);
        const sc = (0.8 + rnd() * 0.35) * k;
        const base = Y + (spots[i][3] ? 0 : 0.24);
        dummy.rotation.set(0, rnd() * TAU, 0);
        dummy.position.set(x, base + 0.15 * sc, z); dummy.scale.setScalar(sc); dummy.updateMatrix(); trunk.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x, base + 0.48 * sc, z); dummy.scale.set(sc, sc * 1.15, sc); dummy.updateMatrix(); crown.setMatrixAt(i, dummy.matrix);
        crown.setColorAt(i, greens[i % greens.length]);
        if (i % 5 === 0) ups.push([x, base, z]);
      });
      groundG.add(trunk, crown);
      // warm uplight pools under a few trees
      const upTex = canvasTex(64, 64, (g, w) => {
        const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
        r.addColorStop(0, 'rgba(255,200,120,0.9)'); r.addColorStop(1, 'rgba(255,150,60,0)');
        g.fillStyle = r; g.fillRect(0, 0, w, w);
      });
      const upGeo = new THREE.PlaneGeometry(0.9, 0.9); upGeo.rotateX(-Math.PI / 2);
      const upIm = new THREE.InstancedMesh(upGeo, new THREE.MeshBasicMaterial({ map: upTex, color: lin('#ffffff', 0.45), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), ups.length);
      ups.forEach(([x, y, z], i) => { dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.position.set(x, y + 0.02, z); dummy.updateMatrix(); upIm.setMatrixAt(i, dummy.matrix); });
      upIm.renderOrder = 3;
      groundG.add(upIm);
      // small warm lamps along the border band, in the gaps between trees
      const lamps = [];
      for (let deg = 1.875; deg < 360; deg += 3.75) if (isClear(deg, 7)) lamps.push(deg);
      // extra lamps flanking each portal roof garden
      for (const sp of layout.SPOKES.inner) for (const sx of [-1, 1]) lamps.push(sp + sx * 4.4, sp + sx * 8.4);
      const postGeo = new THREE.CylinderGeometry(0.025, 0.03, 0.42, 5);
      const headGeo = new THREE.SphereGeometry(0.07, 8, 6);
      const posts = new THREE.InstancedMesh(postGeo, new THREE.MeshLambertMaterial({ color: '#3a3f58' }), lamps.length);
      const heads = new THREE.InstancedMesh(headGeo, solid('#ffd08a', 1.1), lamps.length);
      lamps.forEach((deg, i) => {
        const [x, z] = pol(R_OUT + 0.08, deg);
        dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1);
        dummy.position.set(x, Y + 0.21, z); dummy.updateMatrix(); posts.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x, Y + 0.45, z); dummy.updateMatrix(); heads.setMatrixAt(i, dummy.matrix);
      });
      groundG.add(posts, heads);
    }

    // ---------- rooftop garden: outer tree row, cypresses, clipped hedges, shrubs, blooms, benches,
    // path bollards and uplights. All instanced. Tall items keep >= 8.5 deg off each portal axis,
    // low items >= 5.5 deg; nothing goes on the service lane or the base tier.
    {
      let seed = 1234;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const angD = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
      const spokeD = (deg) => Math.min(...layout.SPOKES.inner.map((s) => angD(deg, s)));
      const pathR = (deg) => 13.33 + 0.2 * Math.sin(deg * 0.9 * Math.PI / 180 * 8);
      const greens = ['#2f7d4a', '#3f9a5c', '#4fae66', '#5fbf6e', '#2a6e48', '#6cc070', '#3c8c63'].map((h) => new THREE.Color(h));
      const leafMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#0a2214' });
      const trunkMat = new THREE.MeshLambertMaterial({ color: '#3a2c24' });

      // round trees (outer row, offset from the planter trees) and slim cypresses
      const round = [], cyp = [];
      for (let deg = 0.9; deg < 360; deg += 1.85) {
        const d = spokeD(deg);
        if (d < 7.5) continue;
        const pr = pathR(deg);
        // keep off the path: inside or outside of it, whichever side has room
        const inner = pr > 13.38;
        const r = inner ? 13.04 + rnd() * 0.05 : 13.66 + rnd() * 0.08;
        if (rnd() < 0.28) cyp.push([r, deg + (rnd() - 0.5) * 0.6]);
        else if (rnd() < 0.8) round.push([r, deg + (rnd() - 0.5) * 0.6, inner ? 0.4 + rnd() * 0.2 : 0.45 + rnd() * 0.5]);
      }
      // small flanking trees beside each portal roof
      for (const sp of layout.SPOKES.inner) for (const sx of [-1, 1]) round.push([12.95, sp + sx * 7.6, 0.55]);
      {
        const crownGeo = new THREE.IcosahedronGeometry(0.42, 0);
        const trunkGeo = new THREE.CylinderGeometry(0.035, 0.045, 0.3, 5);
        const cr = new THREE.InstancedMesh(crownGeo, leafMat, round.length);
        const tr = new THREE.InstancedMesh(trunkGeo, trunkMat, round.length + cyp.length);
        round.forEach(([r, deg, sc], i) => {
          const [x, z] = pol(r, deg);
          dummy.rotation.set(0, rnd() * TAU, 0);
          dummy.position.set(x, Y + 0.15 * sc, z); dummy.scale.setScalar(sc); dummy.updateMatrix(); tr.setMatrixAt(i, dummy.matrix);
          dummy.position.set(x, Y + 0.5 * sc, z); dummy.scale.set(sc, sc * (0.95 + rnd() * 0.3), sc); dummy.updateMatrix(); cr.setMatrixAt(i, dummy.matrix);
          cr.setColorAt(i, greens[Math.floor(rnd() * greens.length)]);
        });
        const cypGeo = new THREE.ConeGeometry(0.17, 0.9, 6);
        const cy = new THREE.InstancedMesh(cypGeo, leafMat, cyp.length);
        cyp.forEach(([r, deg], i) => {
          const [x, z] = pol(r, deg);
          const sc = 0.75 + rnd() * 0.45;
          dummy.rotation.set(0, rnd() * TAU, 0);
          dummy.position.set(x, Y + 0.08 * sc, z); dummy.scale.set(sc, 0.5 * sc, sc); dummy.updateMatrix(); tr.setMatrixAt(round.length + i, dummy.matrix);
          dummy.position.set(x, Y + 0.12 + 0.45 * sc, z); dummy.scale.setScalar(sc); dummy.updateMatrix(); cy.setMatrixAt(i, dummy.matrix);
          cy.setColorAt(i, greens[(i * 3) % greens.length].clone().multiplyScalar(0.8));
        });
        groundG.add(tr, cr, cy);
      }

      // clipped hedges along the inside of the edge parapet, broken into short blocks
      {
        const hs = [];
        for (let deg = 0; deg < 360; deg += 2.6) if (spokeD(deg) > 6.5) hs.push(deg);
        const geo = new THREE.BoxGeometry(0.5, 0.2, 0.18);
        const im = new THREE.InstancedMesh(geo, leafMat, hs.length);
        const hc = new THREE.Color('#2c7046');
        hs.forEach((deg, i) => {
          const [x, z] = pol(PLAT_R - 0.42, deg);
          dummy.position.set(x, Y + 0.1, z); dummy.rotation.set(0, (deg * Math.PI) / 180 + Math.PI / 2, 0); dummy.scale.set(1, 0.8 + rnd() * 0.4, 1);
          dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); im.setColorAt(i, hc);
        });
        groundG.add(im);
      }

      // rounded shrubs scattered over the lawn
      {
        const sh = [];
        for (let i = 0; i < 260; i++) {
          const deg = rnd() * 360; const sdd = spokeD(deg); if (sdd < 3.6) continue;
          const pr = pathR(deg);
          let r = 12.7 + rnd() * 1.05; if (Math.abs(r - pr) < 0.2) r += r > pr ? 0.2 : -0.2;
          if (r > 13.75) r = 13.75;
          if (sdd < 6.5 && r > 13.45) r = 13.45;   // low and away from the edge above a portal
          sh.push([r, deg]);
        }
        const geo = new THREE.IcosahedronGeometry(0.16, 0);
        const im = new THREE.InstancedMesh(geo, leafMat, sh.length);
        sh.forEach(([r, deg], i) => {
          const [x, z] = pol(r, deg);
          const sc = 0.6 + rnd() * 0.8;
          dummy.position.set(x, Y + 0.08 * sc, z); dummy.rotation.set(0, rnd() * TAU, 0); dummy.scale.set(sc, sc * 0.7, sc);
          dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
          im.setColorAt(i, greens[Math.floor(rnd() * greens.length)].clone().multiplyScalar(0.85));
        });
        groundG.add(im);
      }

      // blooms: tiny coloured flower heads in clusters (beds and along the path edges)
      {
        const cols = ['#ff7eb6', '#ffd166', '#c39bff', '#f4f1ff', '#ff9e5e', '#7fd6ff', '#ff5f8f'].map((h) => new THREE.Color(h).multiplyScalar(0.8));
        const fl = [];
        for (let deg = 0.4; deg < 360; deg += 1.6) {
          if (spokeD(deg) < 3.4) continue;
          const col = cols[Math.floor(rnd() * cols.length)];
          let cr = 12.68 + rnd() * 1.1; const pr = pathR(deg);
          if (Math.abs(cr - pr) < 0.26) cr += cr > pr ? 0.26 : -0.26;
          for (let j = 0; j < 7; j++) fl.push([cr + (rnd() - 0.5) * 0.22, deg + (rnd() - 0.5) * 0.9, rnd() < 0.8 ? col : cols[Math.floor(rnd() * cols.length)]]);
        }
        const geo = new THREE.OctahedronGeometry(0.045, 0);
        const im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: '#ffffff' }), fl.length);
        fl.forEach(([r, deg, col], i) => {
          const [x, z] = pol(r, deg);
          dummy.position.set(x, Y + 0.06 + rnd() * 0.08, z); dummy.rotation.set(0, rnd() * TAU, 0); dummy.scale.setScalar(0.8 + rnd() * 0.6);
          dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); im.setColorAt(i, col);
        });
        groundG.add(im);
      }

      // benches on the portal-flank lawns, facing the path
      {
        const bs = [];
        for (const sp of layout.SPOKES.inner) for (const sx of [-1, 1]) bs.push(sp + sx * 5.4);
        for (let deg = 0; deg < 360; deg += 15) if (spokeD(deg) > 12) bs.push(deg + 2);
        const seatGeo = new THREE.BoxGeometry(0.42, 0.05, 0.14); seatGeo.translate(0, 0.12, 0);
        const backGeo = new THREE.BoxGeometry(0.42, 0.13, 0.03); backGeo.translate(0, 0.2, -0.07);
        const legGeo = new THREE.BoxGeometry(0.38, 0.1, 0.1); legGeo.translate(0, 0.05, 0);
        const wood = new THREE.MeshLambertMaterial({ color: '#9a7656', emissive: '#2a1c12' });
        const metal = new THREE.MeshLambertMaterial({ color: '#40465e' });
        const seat = new THREE.InstancedMesh(seatGeo, wood, bs.length), back = new THREE.InstancedMesh(backGeo, wood, bs.length), legs = new THREE.InstancedMesh(legGeo, metal, bs.length);
        bs.forEach((deg, i) => {
          const r = pathR(deg) + 0.3;
          const [x, z] = pol(r, deg);
          dummy.position.set(x, Y, z); dummy.rotation.set(0, (deg * Math.PI) / 180 + Math.PI / 2, 0); dummy.scale.setScalar(1);
          dummy.updateMatrix(); seat.setMatrixAt(i, dummy.matrix); back.setMatrixAt(i, dummy.matrix); legs.setMatrixAt(i, dummy.matrix);
        });
        groundG.add(seat, back, legs);
      }

      // path bollards (short warm posts) and tree uplights
      {
        const bl = [];
        for (let deg = 1.2; deg < 360; deg += 2.4) if (spokeD(deg) > 3.6) bl.push([pathR(deg) + ((Math.round(deg / 2.4) % 2) ? 0.2 : -0.2), deg]);
        // a pair of low bollards marking each portal roof
        for (const sp of layout.SPOKES.inner) for (const sx of [-1, 1]) bl.push([13.6, sp + sx * 3.2]);
        const postGeo = new THREE.CylinderGeometry(0.035, 0.04, 0.16, 6);
        const capGeo = new THREE.CylinderGeometry(0.055, 0.05, 0.06, 8);
        const posts = new THREE.InstancedMesh(postGeo, new THREE.MeshLambertMaterial({ color: '#3a3f58' }), bl.length);
        const caps = new THREE.InstancedMesh(capGeo, solid('#ffd08a', 1.7), bl.length);
        bl.forEach(([r, deg], i) => {
          const [x, z] = pol(r, deg);
          dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1);
          dummy.position.set(x, Y + 0.08, z); dummy.updateMatrix(); posts.setMatrixAt(i, dummy.matrix);
          dummy.position.set(x, Y + 0.18, z); dummy.updateMatrix(); caps.setMatrixAt(i, dummy.matrix);
        });
        groundG.add(posts, caps);
        // uplight pools under every third round tree
        const upTex = canvasTex(64, 64, (g, w) => {
          const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
          r.addColorStop(0, 'rgba(255,205,130,0.95)'); r.addColorStop(1, 'rgba(255,150,60,0)');
          g.fillStyle = r; g.fillRect(0, 0, w, w);
        });
        const ups = round.filter((_, i) => i % 2 === 0);
        const upGeo = new THREE.PlaneGeometry(0.85, 0.85); upGeo.rotateX(-Math.PI / 2);
        const upIm = new THREE.InstancedMesh(upGeo, new THREE.MeshBasicMaterial({ map: upTex, color: lin('#ffffff', 0.75), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), ups.length);
        ups.forEach(([r, deg], i) => { const [x, z] = pol(r, deg); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.position.set(x, Y + 0.025, z); dummy.updateMatrix(); upIm.setMatrixAt(i, dummy.matrix); });
        upIm.renderOrder = 3;
        groundG.add(upIm);
        // tiny warm spot at the foot of each uplit tree (the fixture itself)
        const fxGeo = new THREE.SphereGeometry(0.04, 6, 4);
        const fx = new THREE.InstancedMesh(fxGeo, solid('#ffe0a8', 1.3), ups.length);
        ups.forEach(([r, deg], i) => { const [x, z] = pol(r - 0.16, deg); dummy.position.set(x, Y + 0.03, z); dummy.updateMatrix(); fx.setMatrixAt(i, dummy.matrix); });
        groundG.add(fx);
      }
    }
  }

  // lit rim bands of the tiers
  torus(BASE_R + 0.02, 0.06, BASE_H, solid('#A855F7', 1.3));
  torus(BASE_R + 0.02, 0.22, BASE_H, glowMat('#8B5CF6', 0.18, 1.6));
  torus(BASE_R + 0.15, 0.05, 0.05, solid('#3A86FF', 1.0));

  // ---------------------------------------------------------------- drum
  const drumTex = canvasTex(2048, 256, (g, w, h) => {
    // dark glass facade, silver pillars, lower warm window band, upper cool band
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#2b3350'); bg.addColorStop(0.18, '#161c2e'); bg.addColorStop(1, '#0d1220');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    // cool lit band at the top
    g.fillStyle = '#5a6aa8'; g.fillRect(0, 0, w, 10);
    g.fillStyle = '#9fb4ff'; g.fillRect(0, 4, w, 3);
    const N = 48;
    for (let i = 0; i < N; i++) {
      const x = (i / N) * w, cw = w / N;
      // warm windows (two rows), some dimmer
      const lit = (i * 37) % 11 > 2;
      const gr = g.createLinearGradient(0, 120, 0, 220);
      gr.addColorStop(0, lit ? '#ffe2a0' : '#6a4a2a'); gr.addColorStop(1, lit ? '#ff9f1c' : '#3a2814');
      g.fillStyle = gr;
      g.fillRect(x + 8, 150, cw - 16, 58);
      g.fillStyle = lit ? 'rgba(255,200,120,0.55)' : 'rgba(120,90,60,0.4)';
      g.fillRect(x + 10, 60, cw - 20, 44);
      // pillar
      const pg = g.createLinearGradient(x, 0, x + 8, 0);
      pg.addColorStop(0, '#8a93b8'); pg.addColorStop(1, '#3a4262');
      g.fillStyle = pg; g.fillRect(x, 14, 7, h - 14);
    }
    // floor slab line
    g.fillStyle = '#4a5478'; g.fillRect(0, 128, w, 6);
    g.fillStyle = '#ffb347'; g.fillRect(0, h - 10, w, 4);
  }, { wrap: true });
  const drumH = DRUM_TOP - BASE_H;
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(DRUM_R, DRUM_R + 0.25, drumH, 128, 1, true),
    new THREE.MeshBasicMaterial({ map: drumTex, color: lin('#ffffff', 1.35) }),
  );
  drum.position.y = BASE_H + drumH / 2;
  root.add(drum);

  // drum top deck (annulus between dome and drum edge) with a rotating dashed light ring
  const drumDeck = new THREE.Mesh(new THREE.RingGeometry(DOME_R - 0.1, DRUM_R + 0.02, 128), new THREE.MeshBasicMaterial({ color: '#1a2036' }));
  drumDeck.rotation.x = -Math.PI / 2; drumDeck.position.y = DRUM_TOP;
  root.add(drumDeck);
  torus(DRUM_R + 0.01, 0.06, DRUM_TOP, solid('#9fb0f0', 1.0));          // silver-lavender rim
  torus(DRUM_R + 0.01, 0.22, DRUM_TOP, glowMat('#6d7cff', 0.12, 1.8));
  torus(DOME_R + 0.05, 0.1, DOME_Y, solid('#7fd0ff', 1.6));          // bright dome collar
  torus(DOME_R + 0.05, 0.25, DOME_Y, glowMat('#3A86FF', 0.18, 1.8));

  // dashed rotating rings (deck and base track)
  const dashTex = canvasTex(1024, 16, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 64; i++) {
      const x = (i / 64) * w;
      g.fillStyle = i % 8 === 0 ? 'rgba(255,255,255,1)' : 'rgba(170,200,255,0.85)';
      g.fillRect(x, 0, (w / 64) * (i % 8 === 0 ? 0.8 : 0.45), h);
    }
  }, { wrap: true });
  function dashRing(r0, r1, y, hex, k, speed) {
    const geo = new THREE.RingGeometry(r0, r1, 192, 1);
    // polar UVs: u = angle, v = radius
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), yy = pos.getY(i);
      uv.setXY(i, (Math.atan2(yy, x) / TAU + 1) % 1, (Math.hypot(x, yy) - r0) / (r1 - r0));
    }
    // fix seam: duplicate-free ring has a wrap at atan2 = pi; acceptable with high segment count
    const tex = dashTex.clone(); tex.needsUpdate = true; tex.wrapS = THREE.RepeatWrapping;
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, color: lin(hex, k), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = y;
    root.add(m);
    ticks.push((t, dt) => { m.rotation.z += speed * dt; });
    return m;
  }
  dashRing(BASE_R - 0.32, BASE_R - 0.22, BASE_H + 0.01, '#A855F7', 0.6, -0.22);

  // ---------------------------------------------------------------- brain
  const brainVS = /* glsl */`
    varying vec3 vP; varying vec3 vN; varying vec3 vV; varying vec3 vW;
    uniform float uTime;
    void main(){
      vec3 p = position;
      // two hemispheres: very soft dip along the centre (no visible groove), slight lobe bulges
      float fis = exp(-p.x * p.x * 60.0);
      p.y *= 1.0 - 0.06 * fis;
      p.x += sign(p.x) * 0.035 * (1.0 - fis);
      p *= 1.0 + 0.012 * sin(uTime * 1.6);
      vP = position;
      vec4 wp = modelMatrix * vec4(p, 1.0);
      vW = wp.xyz;
      vN = normalize(mat3(modelMatrix) * normal);
      vV = normalize(cameraPosition - wp.xyz);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const brainFS = /* glsl */`
    uniform float uTime;
    uniform vec3 cEdge, cHot, cCell, cCellB, cPurple, cMag; uniform vec3 uSU, uSV;
    varying vec3 vP; varying vec3 vN; varying vec3 vV; varying vec3 vW;
    vec3 hash3(vec3 p){
      p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6)));
      return fract(sin(p)*43758.5453);
    }
    // returns F1, F2 and the nearest cell id hash
    vec3 voro(vec3 x){
      vec3 i = floor(x), f = fract(x);
      float d1 = 8.0, d2 = 8.0; float id = 0.0;
      for (int k=-1;k<=1;k++) for (int j=-1;j<=1;j++) for (int l=-1;l<=1;l++){
        vec3 g = vec3(float(l),float(j),float(k));
        vec3 o = hash3(i+g);
        vec3 r = g + o - f;
        float d = dot(r,r);
        if (d < d1){ d2 = d1; d1 = d; id = o.x + o.y*7.0; } else if (d < d2) d2 = d;
      }
      return vec3(sqrt(d1), sqrt(d2), fract(id));
    }
    void main(){
      vec3 p = vP;

      // gyri: strongly domain-warped voronoi -> elongated, wiggly folds like the reference
      // top-down (xz) gyri pattern, like an illustrated brain seen from above; y only nudges it
      // screen-aligned plane (camera right / up) -> folds keep their shape like a flat illustration
      vec2 b = vec2(dot(vW, uSU), dot(vW, uSV)) * vec2(0.86, 0.92);
      b += 0.55 * vec2(sin(b.y * 1.3 + 0.7), sin(b.x * 1.5 + 2.1));
      b += 0.18 * vec2(sin(b.y * 4.3 + 0.3), sin(b.x * 4.9 + 1.1));
      vec3 q = vec3(b, p.y * 1.2);
      q += vec3(5.3, 1.7, 2.9);   // continuous across the middle: no centre seam
      vec3 v = voro(q);
      float e = v.y - v.x;
      float line = 1.0 - smoothstep(0.02, 0.1, e);   // crisp vein
      float glowE = exp(-e * 9.0);                      // soft light hugging the vein
      float inner = smoothstep(0.0, 0.6, e);            // 0 at vein, 1 deep in the fold
      // secondary fine filaments
      vec3 v2 = voro(q * 2.4 + 11.0);
      float fine = 1.0 - smoothstep(0.0, 0.05, v2.y - v2.x);

      float ax = abs(p.x);
      float centre = exp(-ax * 3.0);            // violet bias toward the middle (broad, no line)

      // flicker: global crackle + per-cell flashes + outward electric ripples
      float t = uTime;
      float glob = 0.88 + 0.12 * sin(t*21.0) * sin(t*7.3 + 1.3);
      float flash = pow(max(0.0, sin(t*(1.3 + v.z*2.7) + v.z*61.0)), 18.0);
      float rr = length(p.xz);
      float rq = fract(rr*1.4 - t*0.45) - 0.5;
      float ripple = exp(-rq * rq * 90.0);

      // fold body: mid blue near its vein, deep navy in the middle of the fold
      vec3 cell = mix(cCell, cCellB, clamp(centre * 1.1 + 0.2 * sin(v.z * 40.0), 0.0, 1.0));
      cell *= 0.25 + 1.2 * (1.0 - inner) + 0.15 * flash;
      vec3 edgeC = mix(cEdge, cPurple, centre * 0.8);
      edgeC = mix(edgeC, cHot, 0.35 * flash + 0.25 * ripple);
      vec3 col = cell;
      col += edgeC * line * (1.3 * glob + 0.6 * flash + 0.4 * ripple);
      col += edgeC * glowE * 0.08;
      col += edgeC * 0.1 * fine * inner * (0.6 + ripple + flash);
      // (no centre groove / seam: user decision)
      // rim shading: darker toward the bottom/silhouette, violet edge light
      float ndv = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
      col *= 0.55 + 0.45 * smoothstep(0.0, 0.5, ndv);
      col += cPurple * pow(1.0 - ndv, 3.0) * 0.25;
      gl_FragColor = vec4(col, 1.0);
    }`;
  const brainMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSU: { value: new THREE.Vector3(1, 0, 0) },
      uSV: { value: new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(camera.position, ctx.target || new THREE.Vector3()).normalize(), new THREE.Vector3(1, 0, 0)).normalize().negate() },
      cEdge: { value: lin('#2a92ff', 1.3) },
      cHot: { value: lin('#7fe0ff', 1.4) },
      cCell: { value: lin('#1c4cff', 0.38) },
      cCellB: { value: lin('#7028ff', 0.38) },
      cPurple: { value: lin('#9a50ff', 1.0) },
      cMag: { value: lin('#d850ff', 1.9) },
    },
    vertexShader: brainVS, fragmentShader: brainFS,
  });
  const brain = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64, 0, TAU, 0, Math.PI / 2), brainMat);
  brain.scale.set(DOME_R * 0.9, DOME_R * 0.8, DOME_R * 0.9);
  brain.position.y = DOME_Y - 0.05;
  root.add(brain); brain.name = 'core-brain';
  ticks.push((t) => { brainMat.uniforms.uTime.value = t; });
  // dark floor under the brain so nothing shows through the dome base
  const floor = new THREE.Mesh(new THREE.CircleGeometry(DOME_R, 96), new THREE.MeshBasicMaterial({ color: '#0d1030' }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = DOME_Y - 0.06;
  root.add(floor);

  // ---------------------------------------------------------------- glass dome
  const domeMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, cRim: { value: lin('#6a9cff', 0.75) }, cTint: { value: lin('#6a5cff', 0.015) }, cHi: { value: lin('#dfe8ff', 0.5) } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        vP = position;
        vec4 wp = modelMatrix * vec4(position,1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 cRim, cTint, cHi;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        vec3 n = normalize(vN), v = normalize(vV);
        float ndv = clamp(abs(dot(n, v)), 0.0, 1.0);
        float fr = pow(1.0 - ndv, 2.6) * 0.55 + pow(1.0 - ndv, 9.0) * 1.2;
        vec3 col = cTint + cRim * fr;
        // soft specular highlight (fake key light up-left) + thin reflection streak
        vec3 l = normalize(vec3(-0.5, 0.9, 0.35));
        vec3 h = normalize(l + v);
        col += cHi * pow(max(dot(n, h), 0.0), 90.0) * 1.2;
        float sq = (vP.x + vP.z*0.35)/${DOME_R.toFixed(2)} + 0.55;
        float streak = exp(-sq * sq * 300.0) * smoothstep(0.1, 0.6, vP.y/${DOME_R.toFixed(2)});
        col += cHi * streak * 0.35;
        // broad glossy band along the upper-left shoulder of the glass (reference highlight)
        vec3 dn = normalize(vP);
        float shoulder = smoothstep(0.55, 0.85, dot(dn, normalize(vec3(-0.55, 0.62, 0.55)))) * pow(1.0 - ndv, 1.5);
        col += cHi * shoulder * 0.25;
        // lower rim brightening near the collar
        col += cRim * 0.2 * exp(-vP.y * 2.5);
        // faint latitude shimmer
        col += cRim * 0.05 * (0.5 + 0.5 * sin(vP.y * 9.0 - uTime * 1.5));
        gl_FragColor = vec4(col, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_R, 128, 48, 0, TAU, 0, Math.PI / 2), domeMat);
  dome.position.y = DOME_Y;
  dome.renderOrder = 5; dome.name = 'core-dome';
  root.add(dome);
  ticks.push((t) => { domeMat.uniforms.uTime.value = t; });

  // (the N-S energy beam over the dome and its flares were removed on user request, 10-30)

  // ---------------------------------------------------------------- connection beams on the inner spokes
  const beamVS = /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
  const beamFS = /* glsl */`
    uniform vec3 uColor; uniform float uTime; uniform float uPhase;
    varying vec2 vUv;
    void main(){
      float x = (vUv.y - 0.5) * 2.0;
      float prof = exp(-x*x*60.0) * 1.6 + exp(-x*x*6.0) * 0.35;
      float along = vUv.x;
      float fade = smoothstep(0.0, 0.06, along) * (1.0 - smoothstep(0.75, 1.0, along));
      float w = fract(along * 3.0 - uTime * 0.7 + uPhase);
      float pulse = smoothstep(0.85, 1.0, w) * smoothstep(1.0, 0.97, w);
      float flick = 0.85 + 0.15 * sin(uTime * 13.0 + uPhase * 20.0);
      gl_FragColor = vec4(uColor * prof * fade * (0.55 * flick + 2.4 * pulse), 1.0);
    }`;
  const spokeColors = {
    22.5: '#c06cff', 67.5: '#22D3EE', 112.5: '#3A86FF', 157.5: '#c06cff',
    202.5: '#FF2D95', 247.5: '#3A86FF', 292.5: '#00E5FF', 337.5: '#FF2D95',
  };
  const r0 = HAS_PLAT ? PLAT_R + 0.25 : BASE_R + 0.1, r1 = layout.RINGS.ring1 - 1.2;
  for (const deg of layout.SPOKES.inner) {
    const m = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: lin(spokeColors[deg] || '#3A86FF', 1.5) }, uTime: { value: 0 }, uPhase: { value: Math.random() } },
      vertexShader: beamVS, fragmentShader: beamFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    ticks.push((t) => { m.uniforms.uTime.value = t; });
    const len = r1 - r0;
    const geo = new THREE.PlaneGeometry(len, 1.6);
    geo.rotateX(-Math.PI / 2);
    geo.translate(r0 + len / 2, 0, 0);
    const mesh = new THREE.Mesh(geo, m);
    mesh.rotation.y = (deg * Math.PI) / 180; // +X rotated CCW seen from above = polar(deg)
    mesh.position.y = 0.2;
    mesh.renderOrder = 4;
    groundG.add(mesh);
  }

  // ---------------------------------------------------------------- aura halo (#8B5CF6)
  const haloTex = canvasTex(512, 512, (g, w) => {
    const c = w / 2;
    const r = g.createRadialGradient(c, c, 0, c, c, c);
    r.addColorStop(0, 'rgba(139,92,246,1)'); r.addColorStop(0.45, 'rgba(139,92,246,0.55)');
    r.addColorStop(0.7, 'rgba(110,80,240,0.18)'); r.addColorStop(1, 'rgba(90,60,230,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  });
  const haloGround = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), new THREE.MeshBasicMaterial({ map: haloTex, color: lin('#ffffff', 0.05), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  haloGround.rotation.x = -Math.PI / 2; haloGround.position.y = 0.12; haloGround.renderOrder = 2;
  root.add(haloGround);
  // billboard halo behind the dome (occluded by the brain, visible around the silhouette)
  // ring-shaped: empty centre so the dome stays readable, peak just outside the dome silhouette
  const haloRingTex = canvasTex(512, 512, (g, w) => {
    const c = w / 2;
    const r = g.createRadialGradient(c, c, 0, c, c, c);
    r.addColorStop(0, 'rgba(139,92,246,0)'); r.addColorStop(0.6, 'rgba(139,92,246,0)');
    r.addColorStop(0.72, 'rgba(139,92,246,0.9)'); r.addColorStop(0.82, 'rgba(120,80,240,0.3)');
    r.addColorStop(1, 'rgba(90,60,230,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  });
  const haloSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloRingTex, color: lin('#ffffff', 0.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  const camDir = new THREE.Vector3().subVectors(camera.position, new THREE.Vector3(0, DOME_Y, 0)).normalize();
  haloSprite.position.set(0, DOME_Y + 0.6 * DOME_R * 0.55, 0).addScaledVector(camDir, -DOME_R * 1.05);
  haloSprite.scale.setScalar(DOME_R * 2.75);
  haloSprite.renderOrder = 1; haloSprite.name = 'core-halo';
  root.add(haloSprite);
  ticks.push((t) => {
    haloSprite.material.color.setScalar(0.2 + 0.04 * Math.sin(t * 1.7));
    haloGround.material.color.setScalar(0.05 + 0.012 * Math.sin(t * 1.7));
  });

  // ---------------------------------------------------------------- pulsing rings at the base
  const pulseTex = canvasTex(512, 512, (g, w) => {
    const c = w / 2;
    const r = g.createRadialGradient(c, c, c * 0.8, c, c, c);
    r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(0.75, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  });
  const pulses = [0, 0.5].map((ph) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: pulseTex, color: lin('#8B5CF6', 1), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.16; m.renderOrder = 3;
    root.add(m);
    return { m, ph };
  });
  ticks.push((t) => {
    for (const p of pulses) {
      const u = (t * 0.32 + p.ph) % 1;
      const r = BASE_R + 0.2 + u * 3.2;
      p.m.scale.setScalar(r);
      const a = Math.sin(u * Math.PI) * (1 - u) * 0.7;
      p.m.material.color.setRGB(0.25 * a, 0.15 * a, 0.7 * a);
    }
  });

  // (no emblem / letter on the core: user decision 10-31)

  // ---------------------------------------------------------------- sparkles on/in the dome
  {
    const N = 28, pos = new Float32Array(N * 3), ph = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * TAU, el = Math.acos(Math.random()) ;
      const r = DOME_R * (0.97 + Math.random() * 0.06);
      pos[i * 3] = Math.cos(a) * Math.sin(el) * r;
      pos[i * 3 + 1] = DOME_Y + Math.cos(el) * r;
      pos[i * 3 + 2] = Math.sin(a) * Math.sin(el) * r;
      ph[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: lin('#cfe0ff', 1.0) } },
      vertexShader: /* glsl */`
        attribute float aPh; uniform float uTime; varying float vA;
        void main(){
          vA = pow(0.5 + 0.5 * sin(uTime * (1.0 + fract(aPh) * 2.5) + aPh), 6.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (1.5 + 3.5 * vA) * (160.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; varying float vA;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = exp(-d * d * 30.0);
          gl_FragColor = vec4(uColor * a * (0.25 + vA), 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.renderOrder = 7; pts.name = 'core-sparkles';
    root.add(pts);
    ticks.push((t) => { mat.uniforms.uTime.value = t; });
  }

  onTick((t, dt) => { for (const f of ticks) f(t, dt); });
}
