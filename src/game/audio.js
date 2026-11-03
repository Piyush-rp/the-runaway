// Tiny WebAudio synth: no sound files, so the game is one small download. Call init() from a user gesture.
let ac = null, master = null, engine = null, music = null;

function env(node, t0, a, d, peak = 1) {
  node.gain.cancelScheduledValues(t0);
  node.gain.setValueAtTime(0.0001, t0);
  node.gain.exponentialRampToValueAtTime(peak, t0 + a);
  node.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
}
function noiseBuffer(sec = 0.4) {
  const b = ac.createBuffer(1, Math.floor(ac.sampleRate * sec), ac.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

export const sfx = {
  init() {
    if (ac) { ac.resume?.(); return; }
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination);
      // hover-bot hum (follows speed)
      const o1 = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain(), f = ac.createBiquadFilter();
      o1.type = 'sawtooth'; o2.type = 'triangle'; f.type = 'lowpass'; f.frequency.value = 420; g.gain.value = 0;
      o1.connect(f); o2.connect(f); f.connect(g); g.connect(master); o1.start(); o2.start();
      engine = { o1, o2, g, f };
      // low ambient pad
      const pad = ac.createGain(); pad.gain.value = 0.05; pad.connect(master);
      for (const fr of [55, 82.4, 110.5]) { const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = fr; o.connect(pad); o.start(); }
      music = pad;
    } catch { ac = null; }
  },
  engine(speed01, on) {
    if (!ac || !engine) return;
    const t = ac.currentTime;
    engine.g.gain.setTargetAtTime(on ? 0.035 + speed01 * 0.06 : 0, t, 0.08);
    engine.o1.frequency.setTargetAtTime(60 + speed01 * 150, t, 0.1);
    engine.o2.frequency.setTargetAtTime(90 + speed01 * 220, t, 0.1);
    engine.f.frequency.setTargetAtTime(300 + speed01 * 900, t, 0.1);
  },
  tone(f0, f1, dur, type = 'sine', vol = 0.3) {
    if (!ac) return;
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    o.connect(g); g.connect(master); env(g, t, 0.01, dur, vol); o.start(t); o.stop(t + dur + 0.05);
  },
  noise(dur, freq, vol = 0.3, q = 1) {
    if (!ac) return;
    const t = ac.currentTime, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuffer(dur + 0.1); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    s.connect(f); f.connect(g); g.connect(master); env(g, t, 0.005, dur, vol); s.start(t); s.stop(t + dur + 0.1);
  },
  teleport() { this.tone(180, 1500, 0.28, 'sawtooth', 0.22); this.tone(1400, 300, 0.35, 'sine', 0.2); this.noise(0.3, 2400, 0.18, 0.7); },
  tpReady() { this.tone(880, 1320, 0.12, 'sine', 0.12); },
  punch() { this.noise(0.1, 900, 0.35, 0.8); this.tone(150, 70, 0.12, 'square', 0.18); },
  radio() { this.noise(0.12, 2600, 0.12, 1.2); this.tone(1180, 1180, 0.05, 'square', 0.06); setTimeout(() => this.tone(880, 880, 0.06, 'square', 0.06), 70); },
  draw() { this.tone(300, 900, 0.1, 'square', 0.1); this.noise(0.06, 3000, 0.1, 0.8); },
  shoot() { this.tone(900, 260, 0.09, 'square', 0.12); this.noise(0.05, 3200, 0.1, 0.7); },
  zap() { this.tone(420, 160, 0.14, 'sawtooth', 0.12); },
  swing() { this.noise(0.08, 1800, 0.1, 0.6); },
  hit() { this.noise(0.16, 500, 0.45, 0.6); this.tone(110, 50, 0.2, 'square', 0.25); },
  hurt() { this.noise(0.22, 300, 0.5, 0.5); this.tone(90, 40, 0.3, 'sawtooth', 0.25); },
  pickup() { this.tone(520, 780, 0.1, 'triangle', 0.2); setTimeout(() => this.tone(780, 1170, 0.14, 'triangle', 0.2), 90); },
  alarm() { for (let i = 0; i < 4; i++) setTimeout(() => this.tone(520, 760, 0.22, 'square', 0.14), i * 260); },
  hijack() { this.tone(300, 900, 0.18, 'sawtooth', 0.2); setTimeout(() => this.tone(900, 450, 0.2, 'square', 0.14), 140); },
  win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, f * 1.01, 0.4, 'triangle', 0.22), i * 150)); },
  lose() { this.tone(300, 60, 0.9, 'sawtooth', 0.3); },
};
