// Player account + saved progress. There is no server behind this build, so the account lives in this browser's
// localStorage (the password is never stored: only a salted PBKDF2 hash). To sync across devices, define
// window.RUNAWAY_API = 'https://your.server/endpoint' before the game loads: createAccount() will also POST the profile
// (name, email, progress, password HASH) there, and nothing else in the game needs to change.
const KEY = 'runaway.account.v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const ITER = 120000;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function hashPassword(password, saltBytes) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations: ITER, hash: 'SHA-256' }, key, 256));
}

export function getAccount() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}

export function validate({ name, email, password }) {
  if (!name || name.trim().length < 2) return 'Pick a name (2+ characters).';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '')) return 'Enter a valid email address.';
  if (!password || password.length < 6) return 'Password must be at least 6 characters.';
  return null;
}

// progress: { chapter, completedAt, stats, choice }
export async function createAccount({ name, email, password }, progress) {
  const err = validate({ name, email, password });
  if (err) throw new Error(err);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const profile = {
    name: name.trim(), email: email.trim().toLowerCase(), salt: b64(salt), hash: await hashPassword(password, salt), iter: ITER,
    createdAt: Date.now(), progress: { ...progress, ...(progress.completedAt ? { nextChapterAt: progress.completedAt + DAY_MS } : {}) },
  };
  localStorage.setItem(KEY, JSON.stringify(profile));
  const api = typeof window !== 'undefined' && window.RUNAWAY_API;
  if (api) { try { await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) }); } catch { /* offline: the local save still stands */ } }
  return profile;
}

export async function signIn(email, password) {
  const acc = getAccount();
  if (!acc || acc.email !== (email || '').trim().toLowerCase()) return false;
  return (await hashPassword(password, unb64(acc.salt))) === acc.hash;
}

// null until the chapter has been completed (the 24 h wait starts then)
export function msUntilNextChapter(acc = getAccount()) {
  return acc?.progress?.nextChapterAt ? Math.max(0, acc.progress.nextChapterAt - Date.now()) : null;
}

export function formatCountdown(ms) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ---- mid-game save slot (one per device)
const SAVE_KEY = 'runaway.save.v1';
export function saveGame(data) { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ ...data, savedAt: Date.now() })); return true; } catch { return false; } }
export function loadGame() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; } }
export function completeChapter(progress) { // record the finished chapter on the account and start the 24 h wait
  const acc = getAccount(); if (!acc) return null;
  acc.progress = { ...acc.progress, ...progress, nextChapterAt: progress.completedAt + DAY_MS };
  localStorage.setItem(KEY, JSON.stringify(acc));
  return acc;
}
export function signOut() { try { localStorage.removeItem(KEY); localStorage.removeItem(SAVE_KEY); } catch { /* ignored */ } }
export function clearSave() { try { localStorage.removeItem('runaway.save.v1'); } catch { /* ignored */ } }
