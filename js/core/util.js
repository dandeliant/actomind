// ActoMind – general utilities (pure, usable in browser and Node)

export function uid(prefix = '') {
  const rnd = (typeof crypto !== 'undefined' && crypto.getRandomValues)
    ? Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('')
    : Math.random().toString(16).slice(2, 18);
  return prefix + Date.now().toString(36) + rnd.slice(0, 10);
}

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const sum = (arr, f = (x) => x) => arr.reduce((a, b) => a + f(b), 0);
export const avg = (arr, f = (x) => x) => (arr.length ? sum(arr, f) / arr.length : 0);
export const round = (v, d = 0) => { const p = 10 ** d; return Math.round(v * p) / p; };

export function debounce(fn, ms) {
  let t = null;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...args); }, ms); };
  d.flush = (...args) => { if (t) { clearTimeout(t); t = null; fn(...args); } };
  d.cancel = () => { clearTimeout(t); t = null; };
  return d;
}

export const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(abortError());
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(abortError()); }, { once: true });
});

export function abortError() {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

/** mm:ss or h:mm:ss */
export function formatClock(seconds) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
}

/** Human readable duration, e.g. "1 h 05 min" / "12 min" / "45 s" */
export function formatDuration(ms) {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return totalSec + ' s';
  const totalMin = Math.round(totalSec / 60);
  if (totalMin < 60) return totalMin + ' min';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h + ' h ' + String(m).padStart(2, '0') + ' min';
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(v < 10 ? 1 : 0)) + ' ' + u[i];
}

/** Local date key YYYY-MM-DD */
export function dateKey(d = new Date()) {
  const x = new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}

export const DAY = 86400000;

/** Deterministic 32-bit hash (FNV-1a) */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seeded PRNG */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Shuffle guaranteeing a different order than the input when possible */
export function shuffleDifferent(arr, rand = Math.random) {
  if (arr.length < 2) return arr.slice();
  for (let i = 0; i < 10; i++) {
    const s = shuffle(arr, rand);
    if (s.some((x, k) => x !== arr[k])) return s;
  }
  const s = arr.slice();
  [s[0], s[1]] = [s[1], s[0]];
  return s;
}

export function pickRandom(arr, rand = Math.random) {
  return arr.length ? arr[Math.floor(rand() * arr.length)] : undefined;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** SHA-256 hex (browser + Node 18+) */
export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Safe file name (ASCII, no Polish diacritics) */
export function safeFileName(name, fallback = 'ActoMind') {
  const map = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z', Ą: 'A', Ć: 'C', Ę: 'E', Ł: 'L', Ń: 'N', Ó: 'O', Ś: 'S', Ź: 'Z', Ż: 'Z' };
  const s = String(name || '')
    .replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (c) => map[c])
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '_');
  return s || fallback;
}

export function deepClone(o) {
  return o == null ? o : JSON.parse(JSON.stringify(o));
}

export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}
