// ActoMind – Web Speech API wrappers: speech synthesis (real browser voices only) and recognition.
import { sentences } from './tokenize.js';
import { abortError } from './util.js';

const g = globalThis;
export const support = {
  get tts() { return 'speechSynthesis' in g && 'SpeechSynthesisUtterance' in g; },
  get stt() { return !!(g.SpeechRecognition || g.webkitSpeechRecognition); },
  get recorder() { return 'MediaRecorder' in g && !!navigator.mediaDevices?.getUserMedia; },
  get mic() { return !!navigator.mediaDevices?.getUserMedia; },
};

// ------------------------------------------------------------------ voices
let voicesCache = [];
const voiceListeners = new Set();
if (support.tts) {
  const load = () => {
    const v = speechSynthesis.getVoices();
    if (v.length) {
      voicesCache = v;
      voiceListeners.forEach((fn) => fn(v));
    }
  };
  load();
  speechSynthesis.addEventListener?.('voiceschanged', load);
  if (!speechSynthesis.addEventListener) speechSynthesis.onvoiceschanged = load;
}

/** Real list of voices from speechSynthesis.getVoices(), waiting for "voiceschanged" if needed. */
export function getVoices(timeout = 2500) {
  if (!support.tts) return Promise.resolve([]);
  if (voicesCache.length) return Promise.resolve(voicesCache);
  return new Promise((resolve) => {
    const done = (v) => { voiceListeners.delete(done); clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => { voiceListeners.delete(done); resolve(speechSynthesis.getVoices()); }, timeout);
    voiceListeners.add(done);
  });
}
export function onVoicesChanged(fn) { voiceListeners.add(fn); return () => voiceListeners.delete(fn); }
export const isGoogleVoice = (v) => /google/i.test(v.name);
export function findVoice(uri, lang) {
  const list = voicesCache.length ? voicesCache : (support.tts ? speechSynthesis.getVoices() : []);
  let v = uri ? list.find((x) => x.voiceURI === uri || x.name === uri) : null;
  if (!v && lang) v = list.find((x) => x.lang === lang) || list.find((x) => x.lang?.slice(0, 2) === lang.slice(0, 2));
  return v || null;
}

/** Split long text – some engines stop after ~15 s of a single utterance. */
export function utteranceChunks(text, max = 180) {
  const out = [];
  for (const s of sentences(text.replace(/\n+/g, ' '))) {
    if (s.length <= max) { out.push(s); continue; }
    let cur = '';
    for (const part of s.split(/(?<=[,;:—–])\s+/)) {
      if ((cur + ' ' + part).length > max && cur) { out.push(cur); cur = part; } else cur = cur ? cur + ' ' + part : part;
    }
    if (cur) out.push(cur);
  }
  return out.length ? out : [text];
}

let keepAlive = null;
/**
 * Speak text with a real browser voice. Resolves when finished; rejects with AbortError when cancelled.
 * @param {string} text
 * @param {{voiceURI?:string, lang?:string, rate?:number, pitch?:number, volume?:number}} v
 * @param {AbortSignal} [signal]
 */
export function speakWeb(text, v = {}, signal) {
  if (!support.tts) return Promise.reject(new Error('TTS_UNSUPPORTED'));
  if (signal?.aborted) return Promise.reject(abortError());
  const chunks = utteranceChunks(text);
  const voice = findVoice(v.voiceURI, v.lang);
  return new Promise((resolve, reject) => {
    let i = 0;
    let finished = false;
    const finish = (err) => {
      if (finished) return;
      finished = true;
      clearInterval(keepAlive);
      signal?.removeEventListener('abort', onAbort);
      err ? reject(err) : resolve();
    };
    const onAbort = () => { speechSynthesis.cancel(); finish(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
    const next = () => {
      if (finished) return;
      if (i >= chunks.length) return finish();
      const u = new SpeechSynthesisUtterance(chunks[i++]);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else if (v.lang) u.lang = v.lang;
      u.rate = v.rate ?? 1;
      u.pitch = v.pitch ?? 1;
      u.volume = v.volume ?? 1;
      u.onend = () => next();
      u.onerror = (e) => {
        if (e.error === 'interrupted' || e.error === 'canceled') return finish(abortError());
        finish(new Error('TTS_' + (e.error || 'error')));
      };
      speechSynthesis.speak(u);
    };
    speechSynthesis.cancel();
    // Chrome desktop: pause/resume keeps long utterances alive
    clearInterval(keepAlive);
    keepAlive = setInterval(() => {
      if (speechSynthesis.speaking && !speechSynthesis.paused && !/Android|iPhone|iPad/i.test(navigator.userAgent)) { speechSynthesis.pause(); speechSynthesis.resume(); }
    }, 10000);
    setTimeout(next, 30);
  });
}

export function cancelSpeech() {
  if (support.tts) speechSynthesis.cancel();
  clearInterval(keepAlive);
}

// ------------------------------------------------------------------ recognition
/**
 * Continuous speech recognition with automatic restarts (Chrome ends sessions after silence).
 * Callbacks: onInterim(fullText), onFinal(segmentText, fullText), onSpeechStart(), onError(code), onEnd()
 */
export class Listener {
  constructor(opts = {}) {
    this.opts = opts;
    this.active = false;
    this.finalText = '';
    this.interim = '';
    this.rec = null;
    this.startedAt = 0;
    this.firstResultAt = null;
  }
  get text() { return (this.finalText + ' ' + this.interim).replace(/\s+/g, ' ').trim(); }
  start() {
    if (!support.stt) { this.opts.onError?.('unsupported'); return false; }
    if (this.active) return true;
    this.active = true;
    this.finalText = '';
    this.interim = '';
    this.startedAt = performance.now();
    this.firstResultAt = null;
    this.spawn();
    return true;
  }
  spawn() {
    const SR = g.SpeechRecognition || g.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = this.opts.lang || 'pl-PL';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const txt = r[0].transcript;
        if (r.isFinal) {
          this.finalText = (this.finalText + ' ' + txt).trim();
          this.opts.onFinal?.(txt.trim(), this.text);
        } else interim += txt;
      }
      this.interim = interim;
      if (this.firstResultAt == null && this.text) {
        this.firstResultAt = performance.now();
        this.opts.onSpeechStart?.();
      }
      this.lastResultAt = performance.now();
      this.opts.onInterim?.(this.text);
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture' || e.error === 'network') {
        this.active = false;
      }
      this.opts.onError?.(e.error);
    };
    rec.onend = () => {
      if (this.active) {
        // keep listening: Chrome stops after a pause
        try { this.spawn(); } catch { this.active = false; this.opts.onEnd?.(); }
      } else this.opts.onEnd?.();
    };
    this.rec = rec;
    try { rec.start(); } catch (err) { this.active = false; this.opts.onError?.('start-failed'); }
  }
  /** Latency from start() to the first recognised word (ms) */
  get latency() { return this.firstResultAt == null ? null : Math.round(this.firstResultAt - this.startedAt); }
  stop() {
    this.active = false;
    try { this.rec?.stop(); } catch { /* ignore */ }
  }
  abort() {
    this.active = false;
    try { this.rec?.abort(); } catch { /* ignore */ }
  }
}

/** Does this browser send recognition audio to an external service? (best effort, for the privacy notice) */
export function recognitionProvider() {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'microsoft';
  if (/Chrome\//.test(ua) && !/OPR\//.test(ua)) return 'google';
  if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return 'apple';
  return 'unknown';
}

/** Microphone level meter (Web Audio, local only). Returns stop(). */
export async function micMeter(onLevel, stream) {
  const AC = g.AudioContext || g.webkitAudioContext;
  const own = !stream;
  const s = stream || await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AC();
  const src = ctx.createMediaStreamSource(s);
  const an = ctx.createAnalyser();
  an.fftSize = 1024;
  src.connect(an);
  const buf = new Float32Array(an.fftSize);
  let raf = 0;
  const loop = () => {
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6));
    raf = requestAnimationFrame(loop);
  };
  loop();
  return () => {
    cancelAnimationFrame(raf);
    ctx.close();
    if (own) s.getTracks().forEach((tr) => tr.stop());
  };
}
