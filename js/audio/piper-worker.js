// ActoMind – Piper neural TTS worker (runs fully on the device).
// Phonemes: espeak-ng (piper_phonemize, WebAssembly). Inference: onnxruntime-web (WebAssembly, single thread).
import * as ort from '../../vendor/ort/ort.wasm.min.mjs';
import { createPiperPhonemize } from '../../vendor/piper/piper_phonemize.mjs';

const VENDOR = new URL('../../vendor/', import.meta.url);
ort.env.wasm.wasmPaths = new URL('ort/', VENDOR).href;
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

export const MODEL_CACHE = 'piper-models-v1';
let phonemeModule = null; // compiled WebAssembly.Module
let phonemeData = null; // espeak-ng data package
const sessions = new Map(); // voice key → {session, config}
const MAX_SESSIONS = 3;

async function loadPhonemizer() {
  if (phonemeModule) return;
  const [wasm, data] = await Promise.all([
    fetch(new URL('piper/piper_phonemize.wasm', VENDOR)).then((r) => { if (!r.ok) throw new Error('phonemizer wasm ' + r.status); return r.arrayBuffer(); }),
    fetch(new URL('piper/piper_phonemize.data', VENDOR)).then((r) => { if (!r.ok) throw new Error('phonemizer data ' + r.status); return r.arrayBuffer(); }),
  ]);
  phonemeModule = await WebAssembly.compile(wasm);
  phonemeData = data;
}

/** Text → phoneme ids with espeak-ng (one fresh module per call, as main() initialises espeak). */
async function phonemize(text, espeakVoice) {
  await loadPhonemizer();
  const lines = [];
  const errors = [];
  const mod = await createPiperPhonemize({
    print: (s) => lines.push(s),
    printErr: (s) => errors.push(s),
    locateFile: (u) => u,
    getPreloadedPackage: () => phonemeData,
    instantiateWasm: (imports, done) => {
      WebAssembly.instantiate(phonemeModule, imports).then((inst) => done(inst));
      return {};
    },
  });
  mod.callMain(['-l', espeakVoice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
  const ids = [];
  for (const l of lines) {
    try { const j = JSON.parse(l); if (Array.isArray(j.phoneme_ids)) ids.push(...j.phoneme_ids); } catch { /* not json */ }
  }
  if (!ids.length) throw new Error('Phonemizer produced no output' + (errors.length ? ': ' + errors.join(' ') : ''));
  return ids;
}

async function getSession(key, modelUrl, configUrl) {
  if (sessions.has(key)) {
    const s = sessions.get(key);
    sessions.delete(key);
    sessions.set(key, s); // LRU
    return s;
  }
  const cache = await caches.open(MODEL_CACHE);
  const [m, c] = await Promise.all([cache.match(modelUrl), cache.match(configUrl)]);
  if (!m || !c) throw Object.assign(new Error('PIPER_NOT_DOWNLOADED'), { code: 'PIPER_NOT_DOWNLOADED' });
  const config = await c.json();
  const session = await ort.InferenceSession.create(new Uint8Array(await m.arrayBuffer()), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  const entry = { session, config };
  sessions.set(key, entry);
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    sessions.get(oldest).session.release?.();
    sessions.delete(oldest);
  }
  return entry;
}

function splitText(text, max = 280) {
  const t = text.trim();
  if (t.length <= max) return [t];
  const parts = t.match(/[^.!?…;\n]+[.!?…;]*\s*/g) || [t];
  const out = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + p).length > max && cur) { out.push(cur.trim()); cur = ''; }
    cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function synth(msg) {
  const { session, config } = await getSession(msg.voice, msg.modelUrl, msg.configUrl);
  const inf = config.inference || {};
  const numSpeakers = config.num_speakers || 1;
  const sampleRate = config.audio?.sample_rate || 22050;
  const chunks = [];
  for (const piece of splitText(msg.text)) {
    const ids = await phonemize(piece, config.espeak?.voice || 'pl');
    const feeds = {
      input: new ort.Tensor('int64', BigInt64Array.from(ids, (x) => BigInt(x)), [1, ids.length]),
      input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new ort.Tensor('float32', Float32Array.from([
        msg.noiseScale ?? inf.noise_scale ?? 0.667,
        (inf.length_scale ?? 1) * (msg.lengthScale ?? 1),
        msg.noiseW ?? inf.noise_w ?? 0.8,
      ]), [3]),
    };
    if (numSpeakers > 1) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(Math.min(numSpeakers - 1, Math.max(0, msg.speaker || 0)))]), [1]);
    const out = await session.run(feeds);
    chunks.push(out.output.data);
  }
  // join chunks with a short natural pause
  const gap = Math.round(sampleRate * 0.18);
  const total = chunks.reduce((s, c) => s + c.length, 0) + gap * (chunks.length - 1);
  const pcm = new Float32Array(total);
  let o = 0;
  chunks.forEach((c, i) => { pcm.set(c, o); o += c.length + (i < chunks.length - 1 ? gap : 0); });
  return { pcm, sampleRate };
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'synth') {
      const r = await synth(msg);
      self.postMessage({ id: msg.id, ok: true, pcm: r.pcm, sampleRate: r.sampleRate }, [r.pcm.buffer]);
    } else if (msg.type === 'warmup') {
      await loadPhonemizer();
      self.postMessage({ id: msg.id, ok: true });
    } else if (msg.type === 'release') {
      for (const s of sessions.values()) s.session.release?.();
      sessions.clear();
      self.postMessage({ id: msg.id, ok: true });
    }
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String(err?.message || err), code: err?.code || null });
  }
};
