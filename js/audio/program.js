// ActoMind – builds the audio "program" (ordered timeline of speech / silence / signals) for a script.
// Shared by live Web Speech playback, the visual timeline and the WAV/MP3 renderer.
import { scenesOf } from '../core/parser.js';
import { spokenText } from '../core/tokenize.js';
import { estimateSpeech, silenceSeconds, prefixText, DEFAULT_FACTOR, DEFAULT_EXTRA } from '../core/timing.js';
import { beepsForTurn, beepSeconds } from './beeps.js';

export const PLAY_MODES = ['full', 'rehearsal', 'hints', 'mine', 'repeat', 'dress'];
export const ROLE_MODES = ['read', 'silent', 'first1', 'first3', 'start'];
export const DIR_VOICE = '__dir';

export function defaultStudio() {
  return {
    engine: 'web',
    factor: DEFAULT_FACTOR,
    extra: DEFAULT_EXTRA,
    roleModes: {},
    hintMode: 'first3',
    readDirections: false,
    readHeadings: false,
    beep: 'none',
    profileId: null,
    lineOverrides: {},
    exportQuality: 'standard',
    measureWithTts: true,
  };
}

export function defaultVoice(lang = 'pl-PL') {
  return {
    web: { voiceURI: '', lang, rate: 1, pitch: 1, volume: 1 },
    cloud: { name: '', languageCode: lang, speakingRate: 1, pitch: 0, volumeGainDb: 0 },
    pauseBefore: 0,
    pauseAfter: 0.6,
  };
}

export function voiceOf(script, key) {
  const v = script.voices?.[key];
  const d = defaultVoice(script.lang === 'en' ? 'en-US' : 'pl-PL');
  if (!v) return d;
  return { ...d, ...v, web: { ...d.web, ...(v.web || {}) }, cloud: { ...d.cloud, ...(v.cloud || {}) } };
}

/**
 * Voice settings for a given line, including per-line overrides from the timeline
 * (another character's voice, tempo multiplier).
 */
export function lineVoice(script, voiceKey, itemId) {
  const ov = (itemId && script.studio?.lineOverrides?.[itemId]) || {};
  const base = voiceOf(script, ov.voiceFrom || voiceKey);
  if (!ov.rate || ov.rate === 1) return base;
  return {
    ...base,
    web: { ...base.web, rate: Math.max(0.3, Math.min(3, base.web.rate * ov.rate)) },
    cloud: { ...base.cloud, speakingRate: Math.max(0.25, Math.min(4, base.cloud.speakingRate * ov.rate)) },
  };
}

/** Text actually spoken for an item (inline stage directions are never read as dialogue). */
export function speakableText(item) {
  if (item.type === 'line') return spokenText(item.text);
  return item.text.replace(/^[(\[]\s*|\s*[)\]]\.?$/g, '').trim();
}

/** Effective treatment of one of the actor's lines in a play mode. */
export function myLineTreatment(mode, roleMode, hintMode) {
  switch (mode) {
    case 'full':
    case 'mine':
      return 'read';
    case 'repeat':
      return 'readRepeat';
    case 'dress':
      return 'silent';
    case 'hints':
      return hintMode || 'first3';
    case 'rehearsal':
    default:
      return roleMode || 'silent';
  }
}

/**
 * Select item indices for a range.
 * @param {object} script
 * @param {{type:'all'}|{type:'scene', id:string}|{type:'act', id:string}|{type:'lines', from:string, to:string}|{type:'difficult', ids:string[]}} range
 * @returns {{indices:number[], breaks:Set<number>}} breaks = indices before which an excerpt gap is inserted
 */
export function selectRange(script, range = { type: 'all' }) {
  const items = script.items;
  const all = items.map((_, i) => i);
  const breaks = new Set();
  if (!range || range.type === 'all') return { indices: all, breaks };
  if (range.type === 'scene') {
    const sc = scenesOf(items).find((s) => s.id === range.id);
    if (!sc) return { indices: all, breaks };
    const start = items[sc.start - 1]?.id === sc.id ? sc.start - 1 : sc.start;
    return { indices: all.filter((i) => i >= start && i <= sc.end), breaks };
  }
  if (range.type === 'act') {
    const a = items.findIndex((x) => x.id === range.id);
    if (a < 0) return { indices: all, breaks };
    let b = items.findIndex((x, i) => i > a && x.type === 'act');
    if (b < 0) b = items.length;
    return { indices: all.slice(a, b), breaks };
  }
  if (range.type === 'lines') {
    let a = items.findIndex((x) => x.id === range.from);
    let b = items.findIndex((x) => x.id === range.to);
    if (a < 0) a = 0;
    if (b < 0) b = items.length - 1;
    if (a > b) [a, b] = [b, a];
    return { indices: all.slice(a, b + 1), breaks };
  }
  if (range.type === 'difficult') {
    const ids = new Set(range.ids || []);
    const picked = new Set();
    items.forEach((it, i) => {
      if (it.type !== 'line' || !ids.has(it.id)) return;
      // include the preceding partner line(s) as the cue
      let j = i - 1;
      while (j >= 0 && items[j].type === 'direction') j--;
      if (j >= 0 && items[j].type === 'line') picked.add(j);
      picked.add(i);
    });
    const indices = [...picked].sort((x, y) => x - y);
    indices.forEach((idx, k) => { if (k > 0 && indices[k - 1] !== idx - 1) breaks.add(idx); });
    return { indices, breaks };
  }
  return { indices: all, breaks };
}

/**
 * Build the program.
 * @param {object} script
 * @param {object} opts
 *  - mode: PLAY_MODES
 *  - range
 *  - durationOf(item, text, voiceKey, part) → {seconds, approx} (measured TTS duration or estimate)
 *  - profile: personal tempo profile or null (used for actor turns)
 *  - studio overrides (factor, extra, beep, readDirections, roleModes, hintMode)
 */
export function buildProgram(script, opts = {}) {
  const studio = { ...defaultStudio(), ...(script.studio || {}), ...(opts.studio || {}) };
  const mode = opts.mode || 'rehearsal';
  const mine = new Set(script.myRoles || []);
  const lang = script.lang === 'en' ? 'en' : 'pl';
  const factor = studio.factor ?? DEFAULT_FACTOR;
  const extra = studio.extra ?? DEFAULT_EXTRA;
  const beepStyle = mode === 'dress' ? 'none' : studio.beep;
  const turnBeeps = beepsForTurn(beepStyle);
  const { indices, breaks } = selectRange(script, opts.range);
  const durationOf = opts.durationOf || ((item, text, voiceKey) => {
    const v = lineVoice(script, voiceKey, item.id);
    return estimateSpeech(text, { lang, rate: studio.engine === 'cloud' ? v.cloud.speakingRate : v.web.rate });
  });
  const segs = [];
  const push = (s) => { segs.push(s); };
  const gap = (itemId, seconds) => { if (seconds > 0.01) push({ kind: 'silence', role: 'gap', itemId, seconds, approx: false }); };

  // actor's own speaking time for a line (personal profile > measured TTS > estimate)
  const turnBase = (item, text) => {
    const ov = studio.lineOverrides?.[item.id] || {};
    if (opts.profile) {
      const e = estimateSpeech(item.text, { lang, profile: opts.profile, actorPause: ov.actorPause || 0 });
      return { seconds: e.seconds, approx: true, source: 'profile' };
    }
    const d = durationOf(item, text, item.charId, 'full');
    return { seconds: d.seconds + (ov.actorPause || 0), approx: !!d.approx, source: d.approx ? 'estimate' : 'tts' };
  };

  for (const idx of indices) {
    const item = script.items[idx];
    if (breaks.has(idx)) gap(item.id, 2);
    if (item.type === 'act' || item.type === 'scene') {
      if (studio.readHeadings || studio.readDirections) {
        const text = speakableText(item);
        const d = durationOf(item, text, DIR_VOICE, 'full');
        push({ kind: 'speech', role: 'heading', itemId: item.id, voiceKey: DIR_VOICE, text, seconds: d.seconds, approx: !!d.approx });
        gap(item.id, 1);
      } else {
        push({ kind: 'marker', role: 'heading', itemId: item.id, seconds: 0 });
      }
      continue;
    }
    if (item.type === 'direction') {
      if (studio.readDirections && mode !== 'mine') {
        const text = speakableText(item);
        if (!text) continue;
        const d = durationOf(item, text, DIR_VOICE, 'full');
        push({ kind: 'speech', role: 'direction', itemId: item.id, voiceKey: DIR_VOICE, text, seconds: d.seconds, approx: !!d.approx });
        gap(item.id, 0.6);
      }
      continue;
    }
    if (item.type !== 'line') continue;
    const text = spokenText(item.text);
    if (!text) continue;
    const isMine = mine.has(item.charId);
    const v = voiceOf(script, item.charId);
    const ov = studio.lineOverrides?.[item.id] || {};
    const pauseAfter = ov.pauseAfter ?? v.pauseAfter ?? 0.6;
    const pauseBefore = v.pauseBefore ?? 0;

    if (!isMine) {
      if (mode === 'mine') continue;
      gap(item.id, pauseBefore);
      const d = durationOf(item, text, item.charId, 'full');
      push({ kind: 'speech', role: 'partner', itemId: item.id, charId: item.charId, voiceKey: item.charId, text, seconds: d.seconds, approx: !!d.approx });
      gap(item.id, pauseAfter);
      continue;
    }

    const treat = myLineTreatment(mode, studio.roleModes?.[item.charId] || 'silent', studio.hintMode);
    if (treat === 'read' || treat === 'readRepeat') {
      gap(item.id, pauseBefore);
      const d = durationOf(item, text, item.charId, 'full');
      push({ kind: 'speech', role: 'mine', itemId: item.id, charId: item.charId, voiceKey: item.charId, text, seconds: d.seconds, approx: !!d.approx });
      if (treat === 'readRepeat') {
        gap(item.id, 0.4);
        const base = turnBase(item, text);
        const sec = ov.silence ?? silenceSeconds(base.seconds, factor, extra);
        if (turnBeeps.before) push({ kind: 'beep', role: 'signal', itemId: item.id, style: turnBeeps.before, seconds: beepSeconds(turnBeeps.before) });
        push({ kind: 'silence', role: 'repeat', itemId: item.id, charId: item.charId, seconds: sec, approx: ov.silence == null && base.approx, base: base.seconds, source: ov.silence != null ? 'manual' : base.source });
        if (turnBeeps.after) push({ kind: 'beep', role: 'signal', itemId: item.id, style: turnBeeps.after, seconds: beepSeconds(turnBeeps.after) });
      } else {
        gap(item.id, pauseAfter);
      }
      continue;
    }
    // silent or prefix hint
    const base = turnBase(item, text);
    let total = ov.silence ?? silenceSeconds(base.seconds, factor, extra);
    const approx = ov.silence == null && base.approx;
    if (turnBeeps.before) push({ kind: 'beep', role: 'signal', itemId: item.id, style: turnBeeps.before, seconds: beepSeconds(turnBeeps.before) });
    if (treat === 'first1' || treat === 'first3' || treat === 'start') {
      const pre = prefixText(item.text, treat);
      if (pre.prefix) {
        const d = durationOf(item, pre.prefix, item.charId, 'prefix');
        push({ kind: 'speech', role: 'hint', itemId: item.id, charId: item.charId, voiceKey: item.charId, text: pre.prefix, seconds: d.seconds, approx: !!d.approx, part: 'prefix' });
        total = pre.complete ? Math.max(0.8, extra) : Math.max(0.8, total - d.seconds);
      }
    }
    push({ kind: 'silence', role: 'turn', itemId: item.id, charId: item.charId, seconds: total, approx, base: base.seconds, source: ov.silence != null ? 'manual' : base.source });
    if (turnBeeps.after) push({ kind: 'beep', role: 'signal', itemId: item.id, style: turnBeeps.after, seconds: beepSeconds(turnBeeps.after) });
    gap(item.id, 0.3);
  }
  // timestamps
  let t = 0;
  for (const s of segs) { s.t = t; t += s.seconds; }
  return { segments: segs, total: t, mode, approx: segs.some((s) => s.approx) };
}

/** Index of the segment playing at time t. */
export function segmentAt(program, t) {
  const segs = program.segments;
  let lo = 0;
  let hi = segs.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Distinct speech requests (voiceKey + text) needed to render a program. */
export function speechRequests(program) {
  const seen = new Map();
  for (const s of program.segments) {
    if (s.kind !== 'speech') continue;
    const k = s.voiceKey + '\u0000' + s.text;
    if (!seen.has(k)) seen.set(k, { voiceKey: s.voiceKey, text: s.text, itemId: s.itemId, charId: s.charId });
  }
  return [...seen.values()];
}
