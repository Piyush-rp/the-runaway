# The Runaway

A third-person rescue-and-escape game set in a night city. **Chapter 1.**

A gang is holding a child inside the dome at the heart of the city. Beat the guards, decrypt the dome, free the child, then
take them across the whole city: to a hospital, to something to eat, back to their parents, and out through the south gate,
with the gang hunting you the whole way.

Plays in the browser. No install.

## Controls

| Key | Action |
| --- | --- |
| WASD / Shift / Space | Move / sprint / jump and climb |
| Mouse | Look |
| Left mouse | Attack (fists, or the Punch Gun when drawn) |
| Mouse wheel (or 1 / 2) | Draw or holster the Punch Gun |
| V | Punch |
| Q or right mouse | Aim a teleport, press again to jump (lands on roofs and roads) |
| F | Ride or hijack a hoverboard, hold to interact |
| On a hoverboard | Look up or down to climb or dive |
| P | Save progress |
| Esc | Pause menu (resume, save, account) |

## Run it locally

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # static site in dist/
```

Useful URL options: `?hq` full resolution, `?debug` frame-rate readout, `?view` the original orbit-camera city viewer.

## Saving

Progress and the account are stored in the browser (localStorage) on the player's device. Passwords are never stored, only a
salted PBKDF2 hash. To sync accounts across devices, set `window.RUNAWAY_API` to an endpoint before the game loads and the
profile will also be posted there.

## Deployment

Pushing to `main` builds the site and publishes it with GitHub Pages (see `.github/workflows/pages.yml`).

## Layout

- `src/city/` the city: roads, ground, buildings, traffic
- `src/game/` the game: player, hoverboards, enemies, missions, HUD, save and account
- `vite.config.js` relative base path, so the build works on any static host
