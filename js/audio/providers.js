// ActoMind – audio clip providers used for playback and export.
//   cloud  – Google Cloud TTS through the ActoMind backend
//   piper  – local neural voices (in-browser, free, offline after download)
//   web    – browser voices recorded via screen/tab audio capture (desktop)
import { lineVoice } from './program.js';
import { synthesizeCloud, cloudKey } from './cloud.js';
import { synthesizePiper, piperRequestFrom, piperKey } from './piper.js';
import { captureClip, webRequestFrom, webKey } from './capture.js';

export const SYNTH_RATE = 24000;

export function clipRequest(script, engine, voiceKey, text, itemId) {
  const v = lineVoice(script, voiceKey, itemId);
  if (engine === 'cloud') {
    return {
      text,
      voice: { name: v.cloud.name, languageCode: v.cloud.languageCode || (script.lang === 'en' ? 'en-US' : 'pl-PL') },
      audioConfig: { speakingRate: v.cloud.speakingRate ?? 1, pitch: v.cloud.pitch ?? 0, volumeGainDb: v.cloud.volumeGainDb ?? 0, sampleRateHertz: SYNTH_RATE },
    };
  }
  if (engine === 'piper') return piperRequestFrom(v.piper, text);
  return webRequestFrom(v.web, text);
}

/** Has this character a voice assigned for the engine? */
export function hasVoice(script, engine, voiceKey, itemId) {
  const v = lineVoice(script, voiceKey, itemId);
  if (engine === 'cloud') return !!v.cloud.name;
  if (engine === 'piper') return !!v.piper.voice;
  return true; // browser default voice always exists
}

export function clipKey(engine, req) {
  if (engine === 'cloud') return cloudKey(req);
  if (engine === 'piper') return piperKey(req);
  return webKey(req);
}

/**
 * Produce (or reuse) a clip.
 * @param {{signal?:AbortSignal, capture?:import('./capture.js').SpeechCapture}} o
 */
export function synthesizeClip(engine, req, o = {}) {
  if (engine === 'cloud') return synthesizeCloud(req, o);
  if (engine === 'piper') return synthesizePiper(req, o);
  return captureClip(o.capture, req, o);
}
