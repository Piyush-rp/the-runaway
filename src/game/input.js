// Keyboard + mouse. Mouse look uses pointer lock (click the game); arrow keys also look around, so the game stays
// playable if the browser refuses the lock. `pressed(code)` is true once per key press, `down(code)` while held.
export function createInput(canvas) {
  const held = new Set();
  const edge = new Set();
  const state = { locked: false, hadLock: false, dx: 0, dy: 0, lmb: false, rmb: false, lmbEdge: false, rmbEdge: false, wheel: 0, enabled: true };

  const BLOCK = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);
  window.addEventListener('keydown', (e) => {
    if (!state.enabled) return;
    if (BLOCK.has(e.code)) e.preventDefault();
    if (!e.repeat) edge.add(e.code);
    held.add(e.code);
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => { held.clear(); state.lmb = state.rmb = false; });

  document.addEventListener('mousemove', (e) => {
    if (!state.locked) return;
    state.dx += e.movementX; state.dy += e.movementY;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (!state.enabled) return;
    if (e.button === 0) { state.lmb = true; state.lmbEdge = true; }
    if (e.button === 2) { state.rmb = true; state.rmbEdge = true; }
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) state.lmb = false; if (e.button === 2) state.rmb = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (state.enabled) state.wheel += Math.sign(e.deltaY) || 0; }, { passive: false }); // scroll: draw / holster the Punch Gun

  document.addEventListener('pointerlockchange', () => {
    const was = state.locked;
    state.locked = document.pointerLockElement === canvas;
    if (state.locked) state.hadLock = true;
    state.onLockChange?.(state.locked, was);
  });

  return {
    state,
    down: (c) => held.has(c),
    pressed: (c) => edge.has(c),
    axis: (neg, pos) => (held.has(pos) ? 1 : 0) - (held.has(neg) ? 1 : 0),
    // call at the end of every frame
    endFrame() { edge.clear(); state.dx = state.dy = 0; state.wheel = 0; state.lmbEdge = state.rmbEdge = false; },
    lock() { try { const p = canvas.requestPointerLock?.(); p?.catch?.(() => {}); } catch { /* ignored: arrow keys still work */ } },
    unlock() { document.exitPointerLock?.(); },
    reset() { held.clear(); edge.clear(); },
  };
}
