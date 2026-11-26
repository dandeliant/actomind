// ActoMind – unified "speak this line": Web Speech (live), Piper (local neural) and Google Cloud TTS.
import { speakWeb, cancelSpeech, support } from '../core/speech.js';
import { lineVoice } from './program.js';
import { clipRequest, hasVoice, synthesizeClip } from './providers.js';
import { estimateSpeech } from '../core/timing.js';
import { sleep, abortError } from '../core/util.js';
import { emit } from '../core/store.js';

let currentAudio = null;

export function cloudRequest(script, voiceKey, text, itemId) {
  return clipRequest(script, 'cloud', voiceKey, text, itemId);
}

export function hasCloudVoice(script, voiceKey) {
  return hasVoice(script, 'cloud', voiceKey);
}

/** Play an audio blob through an HTMLAudioElement. */
export function playBlob(blob, { signal, rate = 1, volume = 1 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    currentAudio = a;
    a.playbackRate = rate;
    a.volume = Math.max(0, Math.min(1, volume));
    const cleanup = () => { URL.revokeObjectURL(url); signal?.removeEventListener('abort', onAbort); if (currentAudio === a) currentAudio = null; };
    const onAbort = () => { a.pause(); cleanup(); reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
    a.onended = () => { cleanup(); resolve(); };
    a.onerror = () => { cleanup(); reject(new Error('AUDIO_PLAYBACK')); };
    a.play().catch((e) => { cleanup(); reject(e); });
  });
}

const warned = new Set();
/**
 * Speak a line for a character / voice key.
 * @returns {Promise<{engine:'web'|'cloud'|'piper'|'none'}>}
 */
export async function speakItem(script, voiceKey, text, itemId, opts = {}) {
  const { signal, rateScale = 1, volumeScale = 1 } = opts;
  const engine = opts.engine || script.studio?.engine || 'web';
  const v = lineVoice(script, voiceKey, itemId);
  if ((engine === 'cloud' || engine === 'piper') && hasVoice(script, engine, voiceKey, itemId)) {
    try {
      const r = await synthesizeClip(engine, clipRequest(script, engine, voiceKey, text, itemId), { signal });
      await playBlob(r.blob, { signal, rate: rateScale, volume: volumeScale });
      return { engine };
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      if (!warned.has(engine)) { warned.add(engine); emit('engineFallback', { engine, code: e.code || e.message }); }
    }
  }
  if (support.tts) {
    await speakWeb(text, { ...v.web, rate: Math.max(0.3, Math.min(3, (v.web.rate || 1) * rateScale)), volume: Math.min(1, (v.web.volume ?? 1) * volumeScale) }, signal);
    return { engine: 'web' };
  }
  // no voice available: display-only mode, wait for the estimated time
  const est = estimateSpeech(text, { lang: script.lang, rate: rateScale });
  await sleep(est.seconds * 1000, signal);
  return { engine: 'none' };
}

/** Generate the clip of an upcoming line in the background (Piper/Cloud) so playback starts instantly. */
export function prefetchItem(script, voiceKey, text, itemId) {
  const engine = script.studio?.engine;
  if ((engine !== 'cloud' && engine !== 'piper') || !hasVoice(script, engine, voiceKey, itemId)) return;
  synthesizeClip(engine, clipRequest(script, engine, voiceKey, text, itemId)).catch(() => {});
}

export function stopAllSpeech() {
  cancelSpeech();
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
}
