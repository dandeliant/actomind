// ActoMind – unified "speak this line" for Web Speech (live) and Google Cloud TTS (generated audio).
import { speakWeb, cancelSpeech, support } from '../core/speech.js';
import { synthesizeCloud } from './cloud.js';
import { lineVoice } from './program.js';
import { estimateSpeech } from '../core/timing.js';
import { sleep, abortError } from '../core/util.js';
import { emit } from '../core/store.js';

let currentAudio = null;

export function cloudRequest(script, voiceKey, text, itemId, sampleRate = 24000) {
  const v = lineVoice(script, voiceKey, itemId);
  return {
    text,
    voice: { name: v.cloud.name, languageCode: v.cloud.languageCode || (script.lang === 'en' ? 'en-US' : 'pl-PL') },
    audioConfig: { speakingRate: v.cloud.speakingRate ?? 1, pitch: v.cloud.pitch ?? 0, volumeGainDb: v.cloud.volumeGainDb ?? 0, sampleRateHertz: sampleRate },
  };
}

export function hasCloudVoice(script, voiceKey) {
  const v = lineVoice(script, voiceKey);
  return !!v.cloud.name;
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

let warnedFallback = false;
/**
 * Speak a line for a character / voice key.
 * @returns {Promise<{engine:'web'|'cloud'|'none'}>}
 */
export async function speakItem(script, voiceKey, text, itemId, opts = {}) {
  const { signal, rateScale = 1, volumeScale = 1 } = opts;
  const engine = opts.engine || script.studio?.engine || 'web';
  const v = lineVoice(script, voiceKey, itemId);
  if (engine === 'cloud' && v.cloud.name) {
    try {
      const r = await synthesizeCloud(cloudRequest(script, voiceKey, text, itemId), { signal });
      await playBlob(r.blob, { signal, rate: rateScale, volume: volumeScale });
      return { engine: 'cloud' };
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      if (!warnedFallback) { warnedFallback = true; emit('engineFallback', e.code || e.message); }
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

export function stopAllSpeech() {
  cancelSpeech();
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
}
