// Movement against the height map. A body can step up ledges of up to `step`, anything taller is a wall; it slides
// along walls by trying each axis on its own. Vertical motion is plain gravity against the surface under the centre.
export const GRAVITY = 24;
export const WORLD_R = 158; // the last ring road is at r 150; stay inside it

// Move `e` by (dx, dz). Returns { blocked, ledge, hit }: `hit` = the intended direction ran into something (even if the body
// then slid along it), `blocked` = it could not move at all, `ledge` = height of the obstacle above the feet.
export function moveXZ(hm, e, dx, dz, r, step) {
  let blocked = false, ledge = 0, hit = false;
  const tryMove = (mx, mz) => {
    const nx = e.x + mx, nz = e.z + mz;
    if (Math.hypot(nx, nz) > WORLD_R) return false;
    const top = hm.maxUnder(nx, nz, r);
    if (top - e.y > step) { ledge = Math.max(ledge, top - e.y); return false; }
    e.x = nx; e.z = nz;
    return true;
  };
  if (!tryMove(dx, dz)) {
    blocked = true; hit = true;
    const sx = dx !== 0 && tryMove(dx, 0);
    const sz = dz !== 0 && tryMove(0, dz);
    if (sx || sz) blocked = false;
  }
  return { blocked, ledge, hit };
}

// gravity + landing. Returns true on the frame the body lands.
export function stepVertical(hm, e, dt) {
  const ground = hm.h(e.x, e.z);
  let landed = false;
  if (e.y > ground + 0.001 || e.vy > 0) {
    e.vy -= GRAVITY * dt;
    e.y += e.vy * dt;
    e.onGround = false;
  }
  if (e.y <= ground) {
    if (e.vy < -6) landed = true;
    e.y = ground; e.vy = 0; e.onGround = true;
  }
  return landed;
}

export const angleLerp = (a, b, k) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * Math.min(1, k);
};
