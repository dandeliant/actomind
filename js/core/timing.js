// ActoMind – speaking time estimation and silence length for the actor's own lines.
import { pieces, syllableCount, segmentsOf, spokenText } from './tokenize.js';

export const DEFAULT_FACTOR = 1.5; // współczynnik wydłużenia
export const DEFAULT_EXTRA = 1.0; // dodatkowa pauza na reakcję [s]

// syllables per second at rate 1.0 for calm stage speech
export const BASE_SYLLABLE_RATE = { pl: 5.0, en: 4.4, default: 4.7 };

export const PUNCT_PAUSES = {
  comma: 0.25, // ,
  semicolon: 0.4, // ;
  colon: 0.35, // :
  period: 0.5, // .
  ellipsis: 0.8, // … / ...
  question: 0.55, // ?
  exclamation: 0.55, // !
  dash: 0.3, // — –
  newline: 0.3,
  manualPause: 1.5, // (pauza) / (cisza) inside the line
};

export const TEMPO_PRESETS = [
  { id: 'fast', factor: 1.0 },
  { id: 'natural', factor: 1.2 },
  { id: 'calm', factor: 1.5 },
  { id: 'emotional', factor: 1.8 },
  { id: 'beginner', factor: 2.2 },
  { id: 'veryslow', factor: 3.0 },
];

const PAUSE_DIR_RE = /^\((pauza|pauza\.|cisza|chwila ciszy|milczy|milczenie|pause|beat|silence)\)$/i;

/**
 * Analyse punctuation pauses of a text.
 * @returns {{syllables:number, words:number, pauseSeconds:number, manualPauses:number, counts:object}}
 */
export function analyse(text = '') {
  const ps = pieces(text);
  let syll = 0;
  let wordsN = 0;
  const counts = { comma: 0, semicolon: 0, colon: 0, period: 0, ellipsis: 0, question: 0, exclamation: 0, dash: 0, newline: 0, manualPause: 0 };
  let seenWord = false;
  for (const p of ps) {
    if (p.type === 'word') { syll += syllableCount(p.text); wordsN++; seenWord = true; continue; }
    if (p.type === 'dir') { if (PAUSE_DIR_RE.test(p.text.trim())) counts.manualPause++; continue; }
    if (!seenWord) continue;
    const s = p.text;
    const ell = (s.match(/…|\.\.\./g) || []).length;
    counts.ellipsis += ell;
    const s2 = s.replace(/…|\.\.\./g, '');
    counts.comma += (s2.match(/,/g) || []).length;
    counts.semicolon += (s2.match(/;/g) || []).length;
    counts.colon += (s2.match(/:/g) || []).length;
    counts.period += (s2.match(/\./g) || []).length;
    counts.question += (s2.match(/\?/g) || []).length;
    counts.exclamation += (s2.match(/!/g) || []).length;
    counts.dash += (s2.match(/[—–]|\s-\s/g) || []).length;
    counts.newline += (s2.match(/\n/g) || []).length;
  }
  // trailing sentence-final punctuation does not add a pause inside the utterance
  const trimmed = text.replace(/\s*\([^()]*\)\s*$/, '').trim();
  if (/\.\.\.$|…$/.test(trimmed)) counts.ellipsis = Math.max(0, counts.ellipsis - 1);
  else if (/[.?!]["”»]?$/.test(trimmed)) {
    const last = trimmed.replace(/["”»]$/, '').slice(-1);
    const key = last === '.' ? 'period' : last === '?' ? 'question' : 'exclamation';
    counts[key] = Math.max(0, counts[key] - 1);
  }
  let pauseSeconds = 0;
  for (const k of Object.keys(counts)) pauseSeconds += counts[k] * PUNCT_PAUSES[k];
  return { syllables: syll, words: wordsN, pauseSeconds, manualPauses: counts.manualPause, counts };
}

/**
 * Estimated duration of speaking a line.
 * @param {string} text
 * @param {{lang?:string, rate?:number, profile?:{syllablesPerSecond:number,pauseScale?:number}|null, actorPause?:number}} opts
 */
export function estimateSpeech(text, opts = {}) {
  const lang = (opts.lang || 'pl').slice(0, 2);
  const a = analyse(text);
  const sps = opts.profile?.syllablesPerSecond || (BASE_SYLLABLE_RATE[lang] || BASE_SYLLABLE_RATE.default) * (opts.rate || 1);
  const pauseScale = opts.profile?.pauseScale ?? (1 / Math.max(0.5, opts.rate || 1));
  const seconds = a.syllables / sps + a.pauseSeconds * pauseScale + (opts.actorPause || 0);
  return { seconds: Math.max(a.words ? 0.6 : 0, seconds), approx: true, ...a, sps };
}

/** Czas ciszy = czas wypowiedzi × współczynnik + dodatkowa pauza */
export function silenceSeconds(speechSeconds, factor = DEFAULT_FACTOR, extra = DEFAULT_EXTRA) {
  return Math.max(0, speechSeconds * factor + extra);
}

/**
 * Personal speaking profile from calibration samples.
 * @param {{text:string, seconds:number}[]} samples
 */
export function profileFromSamples(samples) {
  const valid = samples.filter((s) => s.seconds > 0.3);
  if (!valid.length) return null;
  let syll = 0;
  let pause = 0;
  let time = 0;
  for (const s of valid) {
    const a = analyse(s.text);
    syll += a.syllables;
    pause += a.pauseSeconds;
    time += s.seconds;
  }
  // assume punctuation pauses scale with the same tempo; solve syll/sps + pause*k = time with k = BASE/sps
  // → time = (syll + pause*BASE_PL) / sps
  const base = BASE_SYLLABLE_RATE.pl;
  const sps = (syll + pause * base) / time;
  return {
    syllablesPerSecond: Math.round(sps * 100) / 100,
    pauseScale: Math.round((base / sps) * 100) / 100,
    wordsPerSecond: Math.round((valid.reduce((n, s) => n + analyse(s.text).words, 0) / time) * 100) / 100,
    samples: valid.length,
  };
}

/** Text spoken as a hint prefix for "read only beginning" modes. */
export function prefixText(text, mode) {
  const ps = pieces(text).filter((p) => p.type !== 'dir');
  const wordsP = ps.filter((p) => p.type === 'word');
  if (!wordsP.length) return { prefix: '', ratio: 0, words: 0 };
  let n;
  if (mode === 'first1') n = 1;
  else if (mode === 'first3') n = 3;
  else {
    // "beginning": up to the first phrase break (punctuation) within 2..7 words, else ~35%
    n = Math.min(wordsP.length, Math.max(2, Math.round(wordsP.length * 0.35)));
    const full = pieces(text);
    let wi = -1;
    for (const p of full) {
      if (p.type === 'word') { wi = p.index; continue; }
      if (wi >= 1 && wi <= 6 && /[,.;:!?…—–]/.test(p.text)) { n = wi + 1; break; }
    }
    n = Math.min(n, 7);
  }
  n = Math.min(n, wordsP.length);
  const lastWord = wordsP[n - 1];
  // speak only the spoken segments up to the last word
  let prefix = '';
  for (const seg of segmentsOf(text)) {
    if (seg.kind === 'dir') continue;
    if (seg.start >= lastWord.end) break;
    prefix += text.slice(seg.start, Math.min(seg.end, lastWord.end)) + ' ';
  }
  prefix = prefix.replace(/\s+/g, ' ').trim();
  if (n < wordsP.length) prefix += '…';
  else prefix = spokenText(text).replace(/\s+/g, ' ');
  const total = wordsP.reduce((s, p) => s + syllableCount(p.text), 0);
  const used = wordsP.slice(0, n).reduce((s, p) => s + syllableCount(p.text), 0);
  return { prefix, ratio: total ? used / total : 1, words: n, complete: n >= wordsP.length };
}
