// ActoMind – Audio Studio export: Google Cloud TTS per line (cached) → measured durations → silence → WAV/MP3/OGG → library/ZIP.
import { buildProgram, speechRequests, voiceOf, DIR_VOICE } from './program.js';
import { cloudRequest } from './voice-engine.js';
import { synthesizeCloud, cachedCloud, cloudKey } from './cloud.js';
import { renderProgramToWav } from './render.js';
import { parseWav } from './wav.js';
import { encodeMp3, encodeOpus, estimateSize } from './encoders.js';
import { createZip } from '../core/zip.js';
import { db } from '../core/db.js';
import { spokenText } from '../core/tokenize.js';
import { estimateSpeech } from '../core/timing.js';
import { uid, safeFileName, abortError } from '../core/util.js';
import { charById, bumpTotal } from '../core/store.js';

export const VARIANTS = ['full', 'rehearsal', 'hints', 'mine'];
export const SYNTH_RATE = 24000;
const VARIANT_SUFFIX = { full: 'Pelne_Sluchowisko', rehearsal: 'Proba', hints: 'Podpowiedzi', mine: 'Moje_Kwestie', repeat: 'Powtorz', dress: 'Proba_Generalna' };
const VARIANT_SUFFIX_EN = { full: 'Full_Audio_Drama', rehearsal: 'Rehearsal', hints: 'Prompts', mine: 'My_Lines', repeat: 'Listen_Repeat', dress: 'Dress_Rehearsal' };

const k3 = (voiceKey, itemId, text) => voiceKey + '\u0000' + (itemId || '') + '\u0000' + text;

export function fileNameFor(script, variant, ext) {
  const roles = script.myRoles.map((id) => charById(script, id)?.name).filter(Boolean).join('_');
  const suffix = (script.lang === 'en' ? VARIANT_SUFFIX_EN : VARIANT_SUFFIX)[variant] || variant;
  const base = safeFileName(script.title, 'Scenariusz');
  return variant === 'full' ? `${base}_${suffix}.${ext}` : `${base}_${safeFileName(roles, 'Rola')}_${suffix}.${ext}`;
}

/**
 * Collect every speech clip needed for the given variants (plus own lines for silence measurement).
 * @returns {{list:{voiceKey,text,itemId,req,key}[], missingVoices:string[]}}
 */
export async function collectRequests(script, variants, range, { measure = true } = {}) {
  const map = new Map();
  const missing = new Set();
  const add = (voiceKey, text, itemId, forMeasure = false) => {
    const id = k3(voiceKey, itemId, text);
    if (map.has(id)) return;
    if (!voiceOf(script, voiceKey).cloud.name && !(script.studio.lineOverrides?.[itemId]?.voiceFrom)) {
      if (!forMeasure) missing.add(voiceKey);
      return;
    }
    map.set(id, { voiceKey, text, itemId, req: cloudRequest(script, voiceKey, text, itemId, SYNTH_RATE), forMeasure });
  };
  for (const v of variants) {
    const prog = buildProgram(script, { mode: v, range });
    for (const s of speechRequests(prog)) add(s.voiceKey, s.text, s.itemId);
  }
  if (measure) {
    const mine = new Set(script.myRoles);
    const { selectRange } = await import('./program.js');
    for (const i of selectRange(script, range).indices) {
      const it = script.items[i];
      if (it.type === 'line' && mine.has(it.charId)) {
        const txt = spokenText(it.text);
        if (txt) add(it.charId, txt, it.id, true);
      }
    }
  }
  const list = [...map.values()];
  for (const x of list) x.key = await cloudKey(x.req);
  return { list, missingVoices: [...missing] };
}

/** Billable characters not yet cached locally. */
export async function costPreview(script, variants, range, opts = {}) {
  const { list, missingVoices } = await collectRequests(script, variants, range, opts);
  let cached = 0;
  let chars = 0;
  const byVoice = new Map();
  for (const x of list) {
    if (await db.get('tts', x.key)) { cached++; continue; }
    chars += x.text.length;
    byVoice.set(x.req.voice.name, (byVoice.get(x.req.voice.name) || 0) + x.text.length);
  }
  return { total: list.length, cached, chars, byVoice, missingVoices };
}

/** Duration map from the local cache (no network). */
export async function cachedDurations(script, variants, range) {
  const { list } = await collectRequests(script, variants, range, { measure: true });
  const m = new Map();
  for (const x of list) {
    const hit = await db.get('tts', x.key);
    if (hit) m.set(k3(x.voiceKey, x.itemId, x.text), hit.duration);
  }
  return m;
}

export function durationFn(script, durMap) {
  const lang = script.lang === 'en' ? 'en' : 'pl';
  return (item, text, voiceKey) => {
    const d = durMap.get(k3(voiceKey, item.id, text));
    if (d != null) return { seconds: d, approx: false };
    const v = voiceOf(script, voiceKey);
    return estimateSpeech(text, { lang, rate: script.studio.engine === 'cloud' ? v.cloud.speakingRate : v.web.rate });
  };
}

/**
 * Generate audio files.
 * @param {object} script
 * @param {{variants:string[], range:object, format:'wav'|'mp3'|'ogg', sampleRate:number, kbps:number, zip:boolean,
 *          profile:object|null, rangeLabel:string, onProgress:(p:object)=>void, signal:AbortSignal}} o
 */
export async function exportAudio(script, o) {
  const p = (x) => o.onProgress?.(x);
  // 1. synthesis (each distinct clip once, cached locally and on the server)
  const { list, missingVoices } = await collectRequests(script, o.variants, o.range, { measure: script.studio.measureWithTts !== false });
  if (missingVoices.length) {
    const e = new Error('MISSING_VOICES');
    e.code = 'MISSING_VOICES';
    e.voices = missingVoices;
    throw e;
  }
  const durMap = new Map();
  let billed = 0;
  for (let i = 0; i < list.length; i++) {
    if (o.signal?.aborted) throw abortError();
    const x = list[i];
    p({ phase: 'synth', done: i, total: list.length, voiceKey: x.voiceKey, text: x.text });
    let r;
    for (let attempt = 0; ; attempt++) {
      try { r = await synthesizeCloud(x.req, { signal: o.signal }); break; } catch (e) {
        if (e.name === 'AbortError' || attempt >= 2 || (e.status && e.status < 500 && e.status !== 429)) throw e;
        await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
      }
    }
    billed += r.chars;
    durMap.set(k3(x.voiceKey, x.itemId, x.text), r.duration);
  }
  p({ phase: 'synth', done: list.length, total: list.length });
  const keyOf = new Map(list.map((x) => [k3(x.voiceKey, x.itemId, x.text), x.key]));

  // 2. render every variant from the same cached clips
  const durationOf = durationFn(script, durMap);
  const getSpeech = async (seg) => {
    const key = keyOf.get(k3(seg.voiceKey, seg.itemId, seg.text));
    const hit = key && (await db.get('tts', key));
    if (!hit) throw new Error('Missing audio for: ' + seg.text.slice(0, 40));
    const w = parseWav(await hit.blob.arrayBuffer());
    return { samples: w.samples, sampleRate: w.sampleRate };
  };
  const files = [];
  for (let vi = 0; vi < o.variants.length; vi++) {
    const variant = o.variants[vi];
    const program = buildProgram(script, { mode: variant, range: o.range, durationOf, profile: o.profile });
    p({ phase: 'join', variant, vi, vn: o.variants.length, ratio: 0 });
    const wav = await renderProgramToWav(program, {
      sampleRate: o.sampleRate,
      getSpeech,
      signal: o.signal,
      onProgress: ({ index, total }) => { if (index % 10 === 0) p({ phase: 'join', variant, vi, vn: o.variants.length, ratio: index / total }); },
    });
    let blob = wav.blob;
    let ext = 'wav';
    if (o.format === 'mp3') {
      p({ phase: 'encode', variant, vi, vn: o.variants.length, ratio: 0, format: 'MP3' });
      blob = await encodeMp3(wav.blob, { sampleRate: o.sampleRate, kbps: o.kbps, signal: o.signal, onProgress: (r) => p({ phase: 'encode', variant, vi, vn: o.variants.length, ratio: r, format: 'MP3' }) });
      ext = 'mp3';
    } else if (o.format === 'ogg') {
      p({ phase: 'encode', variant, vi, vn: o.variants.length, ratio: 0, format: 'OGG/Opus' });
      blob = await encodeOpus(wav.blob, { sampleRate: o.sampleRate, bitrate: (o.kbps || 48) * 1000, signal: o.signal, onProgress: (r) => p({ phase: 'encode', variant, vi, vn: o.variants.length, ratio: r, format: 'OGG/Opus' }) });
      ext = 'ogg';
    }
    const name = fileNameFor(script, variant, ext);
    const entry = {
      id: uid('ax_'), scriptId: script.id, scriptTitle: script.title,
      roleNames: script.myRoles.map((id) => charById(script, id)?.name).filter(Boolean).join(', '),
      kind: variant, format: ext, duration: wav.duration, size: blob.size, blob, name, createdAt: Date.now(),
      rangeLabel: o.rangeLabel || '', sampleRate: o.sampleRate,
      marks: wav.marks.filter((m) => m.kind !== 'silence' || m.role !== 'gap').map((m) => ({ t: Math.round(m.t * 100) / 100, d: Math.round(m.d * 100) / 100, k: m.kind, r: m.role, i: m.itemId, c: m.charId })),
    };
    await db.put('audioExports', entry);
    files.push(entry);
  }
  await bumpTotal('audioExports');
  let zipBlob = null;
  if (o.zip && files.length > 1) {
    p({ phase: 'zip' });
    zipBlob = await createZip(files.map((f) => ({ name: f.name, data: f.blob, date: new Date(f.createdAt) })));
  }
  p({ phase: 'done' });
  return { files, zipBlob, billedChars: billed, clips: list.length };
}

export function sizeEstimate(seconds, format, sampleRate, kbps) {
  return estimateSize(seconds, format, sampleRate, kbps);
}

export { DIR_VOICE };
