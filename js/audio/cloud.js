// ActoMind – client for the ActoMind backend (Google Cloud Text-to-Speech proxy) + local audio cache.
import { settings } from '../core/store.js';
import { db } from '../core/db.js';
import { sha256Hex, abortError } from '../core/util.js';
import { wavDuration } from './wav.js';

const base = () => (settings.backendUrl || '').trim().replace(/\/$/, '');
function headers() {
  const h = { 'content-type': 'application/json' };
  if (settings.accessCode) h['x-actomind-access'] = settings.accessCode;
  return h;
}

let statusCache = null;
/** {reachable, configured, mode, accessCodeRequired, error} */
export async function cloudStatus(force = false) {
  if (!force && statusCache && Date.now() - statusCache.t < 60000) return statusCache.v;
  let v;
  if (!navigator.onLine) v = { reachable: false, configured: false, offline: true };
  else {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(base() + '/api/tts/status', { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      v = { reachable: true, ...j };
    } catch (e) {
      v = { reachable: false, configured: false, error: e.message };
    }
  }
  statusCache = { t: Date.now(), v };
  return v;
}
export function invalidateCloudStatus() { statusCache = null; }

const voiceCache = new Map();
export async function listCloudVoices(languageCode = '') {
  const k = 'actomind.cloudVoices.' + languageCode;
  if (voiceCache.has(languageCode)) return voiceCache.get(languageCode);
  try {
    const r = await fetch(base() + '/api/tts/voices?languageCode=' + encodeURIComponent(languageCode), { headers: headers() });
    const j = await r.json();
    if (!r.ok) throw cloudError(r.status, j);
    voiceCache.set(languageCode, j.voices);
    try { localStorage.setItem(k, JSON.stringify(j.voices)); } catch { /* ignore */ }
    return j.voices;
  } catch (e) {
    const stored = localStorage.getItem(k);
    if (stored) return JSON.parse(stored);
    throw e;
  }
}

function cloudError(status, j) {
  const e = new Error(j?.message || j?.error || 'HTTP ' + status);
  e.code = j?.error || 'HTTP_' + status;
  e.status = status;
  return e;
}

export async function cloudKey(req) {
  return sha256Hex(JSON.stringify({ v: 1, text: req.text, voice: req.voice, audioConfig: req.audioConfig }));
}

/** Is this exact request already in the local cache? */
export async function cachedCloud(req) {
  const key = await cloudKey(req);
  return (await db.get('tts', key)) || null;
}

/**
 * Synthesize (or reuse) one line. Never sends anything without the user's consent.
 * @returns {Promise<{blob:Blob, duration:number, source:'local'|'server'|'google', chars:number, key:string}>}
 */
export async function synthesizeCloud(req, { signal } = {}) {
  const key = await cloudKey(req);
  const hit = await db.get('tts', key);
  if (hit) {
    hit.lastUsed = Date.now();
    db.put('tts', hit).catch(() => {});
    return { blob: hit.blob, duration: hit.duration, source: 'local', chars: 0, key };
  }
  if (!settings.cloudConsent) { const e = new Error('CLOUD_CONSENT'); e.code = 'CLOUD_CONSENT'; throw e; }
  if (!navigator.onLine) { const e = new Error('OFFLINE'); e.code = 'OFFLINE'; throw e; }
  if (signal?.aborted) throw abortError();
  const r = await fetch(base() + '/api/tts/synthesize', { method: 'POST', headers: headers(), body: JSON.stringify(req), signal });
  if (!r.ok) {
    let j = null;
    try { j = await r.json(); } catch { /* ignore */ }
    throw cloudError(r.status, j);
  }
  const ab = await r.arrayBuffer();
  const blob = new Blob([ab], { type: 'audio/wav' });
  const duration = wavDuration(ab) || Number(r.headers.get('x-actomind-duration')) || 0;
  const chars = Number(r.headers.get('x-actomind-chars') || 0);
  const source = r.headers.get('x-actomind-cache') === 'HIT' ? 'server' : 'google';
  await db.put('tts', { key, blob, duration, chars: req.text.length, createdAt: Date.now(), lastUsed: Date.now(), voice: req.voice.name, preview: req.text.slice(0, 60) });
  return { blob, duration, source, chars, key };
}

export async function ttsCacheStats() {
  const all = await db.all('tts');
  return { entries: all.length, bytes: all.reduce((s, x) => s + (x.blob?.size || 0), 0) };
}
export async function clearTtsCache() { await db.clear('tts'); }

/** Approximate cost (USD) for a number of billable characters. */
export function costEstimate(chars, pricePerMillion) {
  return (chars / 1e6) * (pricePerMillion || 16);
}
