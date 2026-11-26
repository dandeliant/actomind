// ActoMind – record browser (Web Speech) voices to audio clips.
// Browsers do not expose synthesized speech as data, so we capture what is played: the user shares
// the screen/tab with audio (getDisplayMedia), each line is spoken and recorded separately, then trimmed
// and normalised. Silences in the exported file are still generated as exact digital zeros.
import { speakWeb } from '../core/speech.js';
import { db } from '../core/db.js';
import { sha256Hex, sleep, abortError } from '../core/util.js';
import { wavHeader, floatToInt16 } from './wav.js';

export function captureSupported() {
  return !!navigator.mediaDevices?.getDisplayMedia && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && typeof AudioWorkletNode !== 'undefined';
}

const WORKLET = `class AmRec extends AudioWorkletProcessor {
  process(inputs) {
    const inp = inputs[0];
    if (inp && inp.length) {
      const n = inp[0].length, out = new Float32Array(n);
      for (let c = 0; c < inp.length; c++) { const ch = inp[c]; for (let i = 0; i < n; i++) out[i] += ch[i] / inp.length; }
      this.port.postMessage(out, [out.buffer]);
    }
    return true;
  }
}
registerProcessor('am-rec', AmRec);`;

/**
 * Trim leading/trailing silence and normalise peak.
 * @param {Float32Array} f32
 * @returns {Float32Array}
 */
export function trimAndNormalize(f32, sampleRate, { threshold = 0.008, padMs = 60, target = 0.89 } = {}) {
  let peak = 0;
  for (let i = 0; i < f32.length; i++) { const a = Math.abs(f32[i]); if (a > peak) peak = a; }
  if (peak < threshold) return new Float32Array(0);
  const thr = Math.max(threshold, peak * 0.02);
  let a = 0;
  while (a < f32.length && Math.abs(f32[a]) < thr) a++;
  let b = f32.length - 1;
  while (b > a && Math.abs(f32[b]) < thr) b--;
  const pad = Math.round((padMs / 1000) * sampleRate);
  a = Math.max(0, a - pad);
  b = Math.min(f32.length - 1, b + pad);
  const out = f32.slice(a, b + 1);
  const g = target / peak;
  for (let i = 0; i < out.length; i++) out[i] *= g;
  // 5 ms fades to avoid clicks
  const f = Math.min(out.length >> 1, Math.round(sampleRate * 0.005));
  for (let i = 0; i < f; i++) { out[i] *= i / f; out[out.length - 1 - i] *= i / f; }
  return out;
}

export class SpeechCapture {
  constructor() {
    this.stream = null;
    this.ctx = null;
    this.chunks = null;
    this.active = false;
    this.onEnded = null;
  }
  get sampleRate() { return this.ctx?.sampleRate || 48000; }

  /** Ask the user to share the screen/tab with audio. */
  async start() {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      systemAudio: 'include',
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude',
    });
    const track = stream.getAudioTracks()[0];
    if (!track) {
      stream.getTracks().forEach((tr) => tr.stop());
      throw Object.assign(new Error('CAPTURE_NO_AUDIO'), { code: 'CAPTURE_NO_AUDIO' });
    }
    this.stream = stream;
    this.ctx = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const src = this.ctx.createMediaStreamSource(new MediaStream([track]));
    const node = new AudioWorkletNode(this.ctx, 'am-rec');
    node.port.onmessage = (e) => { if (this.chunks) this.chunks.push(e.data); };
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    src.connect(node).connect(mute).connect(this.ctx.destination);
    this.active = true;
    stream.getTracks().forEach((tr) => tr.addEventListener('ended', () => { this.active = false; this.onEnded?.(); }));
    return this;
  }

  /** Record while fn() runs (+ a short tail). */
  async record(fn, tailMs = 450) {
    if (!this.active) throw Object.assign(new Error('CAPTURE_STOPPED'), { code: 'CAPTURE_STOPPED' });
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.chunks = [];
    await sleep(120);
    try { await fn(); } finally { await sleep(tailMs); }
    const parts = this.chunks;
    this.chunks = null;
    const n = parts.reduce((s, p) => s + p.length, 0);
    const out = new Float32Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  /** Speak a test phrase and report the captured peak level (0..1). */
  async test(voice, text) {
    const raw = await this.record(() => speakWeb(text, voice));
    let peak = 0;
    for (let i = 0; i < raw.length; i++) peak = Math.max(peak, Math.abs(raw[i]));
    return peak;
  }

  stop() {
    this.active = false;
    this.stream?.getTracks().forEach((tr) => tr.stop());
    this.ctx?.close().catch(() => {});
    this.stream = null;
    this.ctx = null;
  }
}

export function webRequestFrom(web, text) {
  return { engine: 'web', text, voiceURI: web.voiceURI || '', lang: web.lang || '', rate: web.rate ?? 1, pitch: web.pitch ?? 1, volume: web.volume ?? 1 };
}

export async function webKey(req) {
  return 'web:' + (await sha256Hex(JSON.stringify(req)));
}

/** Record one line spoken by a browser voice into the shared audio cache (or reuse it). */
export async function captureClip(capture, req, { signal } = {}) {
  const key = await webKey(req);
  const hit = await db.get('tts', key);
  if (hit) return { blob: hit.blob, duration: hit.duration, source: 'local', chars: 0, key };
  if (!capture || !capture.active) throw Object.assign(new Error('CAPTURE_STOPPED'), { code: 'CAPTURE_STOPPED' });
  if (signal?.aborted) throw abortError();
  const raw = await capture.record(() => speakWeb(req.text, { voiceURI: req.voiceURI, lang: req.lang, rate: req.rate, pitch: req.pitch, volume: req.volume }, signal));
  const clip = trimAndNormalize(raw, capture.sampleRate);
  if (!clip.length) throw Object.assign(new Error('CAPTURE_SILENT'), { code: 'CAPTURE_SILENT' });
  const pcm = floatToInt16(clip);
  const blob = new Blob([wavHeader(pcm.length, capture.sampleRate), pcm.buffer], { type: 'audio/wav' });
  const duration = pcm.length / capture.sampleRate;
  await db.put('tts', { key, blob, duration, chars: 0, createdAt: Date.now(), lastUsed: Date.now(), voice: req.voiceURI || 'web', preview: req.text.slice(0, 60) });
  return { blob, duration, source: 'capture', chars: 0, key };
}
