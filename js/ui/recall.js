// ActoMind – "say it and check": speech recognition with end-of-utterance detection + text comparison.
import { Listener, support } from '../core/speech.js';
import { compareText, coverage } from '../core/diff.js';
import { settings } from '../core/store.js';
import { estimateSpeech } from '../core/timing.js';
import { ensureSttConsent } from './common.js';

export function langCode(script) {
  return script.lang === 'en' ? 'en-US' : 'pl-PL';
}

/**
 * Listen to the actor saying `reference`. Resolves with {transcript, latency} or null when cancelled.
 * onInterim(text) is called with the live transcript.
 */
export function listenFor(script, reference, { onInterim, onState, signal, maxSeconds, control } = {}) {
  return new Promise((resolve) => {
    if (!support.stt) return resolve({ transcript: '', latency: null, error: 'unsupported' });
    const est = estimateSpeech(reference, { lang: script.lang }).seconds;
    const limit = (maxSeconds || est * 3 + 10) * 1000;
    const silence = (settings.silenceTimeout || 1.8) * 1000;
    let done = false;
    let lastChange = performance.now();
    let lastText = '';
    const started = performance.now();
    const finish = (err) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      l.stop();
      onState?.('idle');
      resolve({ transcript: l.text, latency: l.latency, error: err || null });
    };
    const l = new Listener({
      lang: langCode(script),
      onInterim: (txt) => {
        if (txt !== lastText) { lastText = txt; lastChange = performance.now(); }
        onInterim?.(txt);
      },
      onError: (code) => { if (['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'unsupported', 'start-failed'].includes(code)) finish(code); },
    });
    const timer = setInterval(() => {
      const now = performance.now();
      if (now - started > limit) return finish();
      if (!l.text) { if (now - started > 12000) finish('no-speech'); return; }
      const cov = coverage(reference, l.text, script.lang);
      const quiet = now - lastChange;
      if (cov.ratio >= 0.999 && quiet > 650) return finish();
      if (quiet > silence) finish();
    }, 120);
    signal?.addEventListener('abort', () => { done = true; clearInterval(timer); l.abort(); onState?.('idle'); resolve(null); }, { once: true });
    if (control) control.finish = () => finish();
    onState?.('listening');
    if (!l.start()) finish('unsupported');
  });
}

export async function canListen() {
  if (!support.stt || !settings.sttEnabled) return false;
  if (!navigator.onLine) return false; // most engines need a network connection
  return ensureSttConsent();
}

export function check(script, reference, transcript, hinted = []) {
  return compareText(reference, transcript, { strictness: settings.strictness, lang: script.lang, hinted });
}

export function sttErrorKey(code) {
  return {
    'not-allowed': 'stt.errNotAllowed',
    'service-not-allowed': 'stt.errNotAllowed',
    'audio-capture': 'stt.errNoMic',
    network: 'stt.errNetwork',
    'no-speech': 'stt.errNoSpeech',
    unsupported: 'support.noStt',
    'start-failed': 'stt.errStart',
  }[code] || 'stt.errGeneric';
}
