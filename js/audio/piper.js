// ActoMind – Piper neural voices (free, local, offline after download, exportable).
// Voice models: official catalogue https://huggingface.co/rhasspy/piper-voices (downloaded on demand,
// kept in Cache Storage). Text never leaves the device – synthesis runs in a Web Worker.
import { db } from '../core/db.js';
import { sha256Hex, abortError } from '../core/util.js';
import { wavHeader, floatToInt16, applyGain } from './wav.js';

export const PIPER_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';
export const MODEL_CACHE = 'piper-models-v1';

/** Curated speaker gender (not part of the official catalogue) – used for automatic casting. */
export const PIPER_GENDER = {
  'pl_PL-bass': 'MALE', 'pl_PL-darkman': 'MALE', 'pl_PL-gosia': 'FEMALE', 'pl_PL-mc_speech': 'MALE',
  'en_GB-alan': 'MALE', 'en_GB-alba': 'FEMALE', 'en_GB-cori': 'FEMALE', 'en_GB-jenny_dioco': 'FEMALE', 'en_GB-northern_english_male': 'MALE',
  'en_GB-southern_english_female': 'FEMALE', 'en_US-amy': 'FEMALE', 'en_US-bryce': 'MALE', 'en_US-danny': 'MALE', 'en_US-hfc_female': 'FEMALE',
  'en_US-hfc_male': 'MALE', 'en_US-joe': 'MALE', 'en_US-john': 'MALE', 'en_US-kathleen': 'FEMALE', 'en_US-kristin': 'FEMALE', 'en_US-kusal': 'MALE',
  'en_US-lessac': 'FEMALE', 'en_US-ljspeech': 'FEMALE', 'en_US-mike': 'MALE', 'en_US-norman': 'MALE', 'en_US-reza_ibrahim': 'MALE',
  'en_US-ryan': 'MALE', 'en_US-sam': 'MALE',
};

// Fallback catalogue (used offline before the official list has been fetched once)
const FALLBACK = [
  ['pl_PL-gosia-medium', 'pl/pl_PL/gosia/medium/pl_PL-gosia-medium', 63, 1],
  ['pl_PL-darkman-medium', 'pl/pl_PL/darkman/medium/pl_PL-darkman-medium', 63, 1],
  ['pl_PL-mc_speech-medium', 'pl/pl_PL/mc_speech/medium/pl_PL-mc_speech-medium', 63, 1],
  ['pl_PL-mls_6892-low', 'pl/pl_PL/mls_6892/low/pl_PL-mls_6892-low', 63, 1],
  ['pl_PL-bass-high', 'pl/pl_PL/bass/high/pl_PL-bass-high', 114, 1],
  ['en_GB-alba-medium', 'en/en_GB/alba/medium/en_GB-alba-medium', 63, 1],
  ['en_GB-alan-medium', 'en/en_GB/alan/medium/en_GB-alan-medium', 63, 1],
  ['en_GB-vctk-medium', 'en/en_GB/vctk/medium/en_GB-vctk-medium', 77, 109],
  ['en_US-amy-medium', 'en/en_US/amy/medium/en_US-amy-medium', 63, 1],
  ['en_US-ryan-medium', 'en/en_US/ryan/medium/en_US-ryan-medium', 63, 1],
  ['en_US-libritts_r-medium', 'en/en_US/libritts_r/medium/en_US-libritts_r-medium', 79, 904],
].map(([key, path, mb, n]) => entry(key, { onnx: path + '.onnx', json: path + '.onnx.json', sizeBytes: mb * 1e6, speakers: n, speakerNames: [] }));

function entry(key, o) {
  const [lang, name, quality] = key.split('-');
  return {
    key, name, langCode: lang, family: lang.slice(0, 2), quality,
    gender: PIPER_GENDER[lang + '-' + name] || null,
    ...o,
  };
}

/** Parse the official voices.json into catalogue entries. */
export function parseCatalog(json) {
  return Object.entries(json).map(([key, v]) => {
    const onnx = Object.keys(v.files).find((f) => f.endsWith('.onnx'));
    const cfg = Object.keys(v.files).find((f) => f.endsWith('.onnx.json'));
    return entry(key, {
      onnx, json: cfg, sizeBytes: v.files[onnx]?.size_bytes || 0,
      speakers: v.num_speakers || 1,
      speakerNames: Object.entries(v.speaker_id_map || {}).sort((a, b) => a[1] - b[1]).map(([n]) => n),
    });
  }).sort((a, b) => a.key.localeCompare(b.key));
}

let catalogPromise = null;
export function piperCatalog() {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const url = PIPER_BASE + 'voices.json';
      const cache = await caches.open(MODEL_CACHE);
      try {
        if (!navigator.onLine) throw new Error('offline');
        const r = await fetch(url, { cache: 'no-cache' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        await cache.put(url, r.clone());
        return parseCatalog(await r.json());
      } catch {
        const hit = await cache.match(url);
        if (hit) return parseCatalog(await hit.json());
        return FALLBACK;
      }
    })().catch(() => { catalogPromise = null; return FALLBACK; });
  }
  return catalogPromise;
}

export const urlsOf = (v) => ({ model: PIPER_BASE + v.onnx, config: PIPER_BASE + v.json });

export async function isDownloaded(v) {
  const cache = await caches.open(MODEL_CACHE);
  const u = urlsOf(v);
  return !!((await cache.match(u.model)) && (await cache.match(u.config)));
}

export async function downloadedKeys(catalog) {
  const cache = await caches.open(MODEL_CACHE);
  const keys = new Set((await cache.keys()).map((r) => r.url));
  return new Set(catalog.filter((v) => keys.has(urlsOf(v).model) && keys.has(urlsOf(v).config)).map((v) => v.key));
}

/** Download a voice model with progress (0..1). */
export async function downloadVoice(v, onProgress, signal) {
  const cache = await caches.open(MODEL_CACHE);
  const u = urlsOf(v);
  const cfg = await fetch(u.config, { signal });
  if (!cfg.ok) throw new Error('HTTP ' + cfg.status);
  const cfgBlob = await cfg.blob();
  const res = await fetch(u.model, { signal });
  if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
  const total = Number(res.headers.get('content-length')) || v.sizeBytes || 0;
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onProgress?.(total ? got / total : 0, got, total);
  }
  await cache.put(u.model, new Response(new Blob(parts), { headers: { 'content-type': 'application/octet-stream' } }));
  await cache.put(u.config, new Response(cfgBlob, { headers: { 'content-type': 'application/json' } }));
  return true;
}

export async function deleteVoice(v) {
  const cache = await caches.open(MODEL_CACHE);
  const u = urlsOf(v);
  await cache.delete(u.model);
  await cache.delete(u.config);
  releaseWorker();
}

// ------------------------------------------------------------------ worker
let worker = null;
let seq = 0;
const pending = new Map();
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./piper-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data);
      else p.reject(Object.assign(new Error(e.data.error), { code: e.data.code }));
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'Piper worker error'));
      pending.clear();
      worker = null;
    };
  }
  return worker;
}
function call(msg, transfer) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...msg, id }, transfer || []);
  });
}
export function releaseWorker() {
  if (worker) { worker.terminate(); worker = null; }
}

/** Synthesis request from character voice settings. */
export function piperRequestFrom(p, text) {
  return {
    engine: 'piper', text, voice: p.voice,
    speaker: p.speaker || 0,
    lengthScale: Math.round((1 / Math.max(0.5, Math.min(2, p.rate || 1))) * 1000) / 1000,
    noiseScale: p.expressive ?? null,
    gain: p.gain || 0,
  };
}

export async function piperKey(req) {
  return 'piper:' + (await sha256Hex(JSON.stringify(req)));
}

/** Synthesize (or reuse) a clip → WAV blob in the shared audio cache. */
export async function synthesizePiper(req, { signal } = {}) {
  const key = await piperKey(req);
  const hit = await db.get('tts', key);
  if (hit) return { blob: hit.blob, duration: hit.duration, source: 'local', chars: 0, key };
  if (!req.voice) throw Object.assign(new Error('PIPER_NO_VOICE'), { code: 'PIPER_NO_VOICE' });
  const catalog = await piperCatalog();
  const v = catalog.find((x) => x.key === req.voice);
  if (!v) throw Object.assign(new Error('PIPER_UNKNOWN_VOICE'), { code: 'PIPER_UNKNOWN_VOICE' });
  if (signal?.aborted) throw abortError();
  const u = urlsOf(v);
  const r = await call({ type: 'synth', voice: v.key, modelUrl: u.model, configUrl: u.config, text: req.text, speaker: req.speaker, lengthScale: req.lengthScale, noiseScale: req.noiseScale ?? undefined });
  if (signal?.aborted) throw abortError();
  const pcm = applyGain(floatToInt16(normalizeFloat(r.pcm)), req.gain || 0);
  const blob = new Blob([wavHeader(pcm.length, r.sampleRate), pcm.buffer], { type: 'audio/wav' });
  const duration = pcm.length / r.sampleRate;
  await db.put('tts', { key, blob, duration, chars: req.text.length, createdAt: Date.now(), lastUsed: Date.now(), voice: req.voice, preview: req.text.slice(0, 60) });
  return { blob, duration, source: 'piper', chars: 0, key };
}

/** Piper output can be quiet or clip slightly – normalise peak to −1 dBFS. */
export function normalizeFloat(f32, target = 0.89) {
  let peak = 0;
  for (let i = 0; i < f32.length; i++) { const a = Math.abs(f32[i]); if (a > peak) peak = a; }
  if (!peak) return f32;
  const g = target / peak;
  const out = new Float32Array(f32.length);
  for (let i = 0; i < f32.length; i++) out[i] = f32[i] * g;
  return out;
}
