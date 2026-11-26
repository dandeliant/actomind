// ActoMind – spaced repetition + active recall model (SM-2 derivative, premiere-aware).
// Only active recall events update the schedule. Passive reading never marks a line as mastered.
import { clamp, DAY } from './util.js';

export const SELF_RATINGS = {
  again: 1, // "Nie pamiętam"
  hard: 3, // "Z trudem"
  good: 4, // "Prawie idealnie"
  perfect: 5, // "Znam doskonale"
};

const MIN = 60000;

export function newRecord() {
  return {
    ef: 2.5,
    interval: 0, // days
    reps: 0, // consecutive successful recalls
    lapses: 0,
    due: 0,
    last: 0,
    attempts: 0,
    hints: 0,
    history: [], // {t, q, src, score?, hints?, latency?}
    lastQ: null,
    latencyAvg: null,
    flagged: false,
  };
}

/** Map an automatic result to quality 0..5. */
export function qualityFromResult({ score = 0, hintLevel = 0, revealed = 0, totalWords = 1, latencyMs = null, attempt = 1 } = {}) {
  let q;
  if (score >= 0.97) q = 5;
  else if (score >= 0.9) q = 4.3;
  else if (score >= 0.8) q = 3.6;
  else if (score >= 0.6) q = 2.6;
  else if (score >= 0.35) q = 1.6;
  else q = 0.8;
  // hints: 1 = first word, 2 = three words, 3 = whole line
  if (hintLevel >= 3) q = Math.min(q, 1.5);
  else if (hintLevel === 2) q -= 1;
  else if (hintLevel === 1) q -= 0.5;
  // individually revealed words (vanishing / first letters)
  if (revealed > 0 && totalWords > 0) q -= Math.min(2, (revealed / totalWords) * 3);
  // hesitation before starting (only when reliably measured)
  if (latencyMs != null) {
    if (latencyMs > 8000) q -= 1;
    else if (latencyMs > 4500) q -= 0.5;
  }
  if (attempt > 1) q -= 0.5 * Math.min(2, attempt - 1);
  return clamp(Math.round(q * 10) / 10, 0, 5);
}

export function qualityFromSelf(rating, { revealed = 0, totalWords = 1, hintLevel = 0 } = {}) {
  let q = SELF_RATINGS[rating] ?? 3;
  if (revealed > 0 && totalWords > 0) q -= Math.min(2, (revealed / totalWords) * 3);
  if (hintLevel >= 3) q = Math.min(q, 2);
  else if (hintLevel === 2) q -= 1;
  else if (hintLevel === 1) q -= 0.5;
  return clamp(q, 0, 5);
}

/**
 * Apply a review.
 * @param {object} rec record (not mutated)
 * @param {{q:number, now?:number, src?:string, score?:number, hints?:number, latencyMs?:number, premiereAt?:number, weight?:number}} ev
 * weight < 1 for recognition-type exercises (they never advance the schedule beyond learning).
 */
export function review(rec, ev) {
  const r = { ...(rec || newRecord()) };
  r.history = (r.history || []).slice(-29);
  const now = ev.now ?? Date.now();
  const q = clamp(ev.q, 0, 5);
  const weight = ev.weight ?? 1;
  r.attempts = (r.attempts || 0) + 1;
  r.hints = (r.hints || 0) + (ev.hints || 0);
  if (ev.latencyMs != null) r.latencyAvg = r.latencyAvg == null ? ev.latencyMs : Math.round(r.latencyAvg * 0.7 + ev.latencyMs * 0.3);
  r.history.push({ t: now, q, src: ev.src || 'recall', ...(ev.score != null ? { score: Math.round(ev.score * 100) / 100 } : {}), ...(ev.hints ? { hints: ev.hints } : {}), ...(ev.latencyMs != null ? { lat: ev.latencyMs } : {}), ...(weight < 1 ? { w: weight } : {}) });

  if (weight < 1) {
    // recognition exercise: a failure brings the line back sooner, a success only nudges
    if (q < 3) r.due = Math.min(r.due || Infinity, now + 10 * MIN);
    r.lastRecognition = now;
    return r;
  }

  r.last = now;
  r.lastQ = q;
  const sinceLastDays = rec && rec.last ? (now - rec.last) / DAY : 0;
  if (q < 3) {
    if (r.reps > 0) r.lapses = (r.lapses || 0) + 1;
    r.reps = 0;
    r.interval = 0;
    r.due = now + (q < 2 ? 1 : 10) * MIN; // relearn soon
  } else {
    r.reps = (r.reps || 0) + 1;
    let interval;
    if (r.reps === 1) interval = q >= 4.5 ? 1 : q >= 3.5 ? 0.5 : 0.15; // 1 day, 12 h, ~4 h
    else if (r.reps === 2) interval = q >= 4.5 ? 3 : q >= 3.5 ? 2 : 1;
    else interval = Math.max(1, (r.interval || 1) * r.ef * (q >= 4.5 ? 1.15 : q >= 3.5 ? 1 : 0.7));
    // reviews done much later than planned that still succeed deserve more credit
    if (r.reps > 2 && sinceLastDays > (rec.interval || 0) * 1.2) interval *= 1.1;
    r.interval = interval;
    r.due = now + interval * DAY;
  }
  r.ef = clamp(r.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)), 1.3, 2.8);

  // premiere-aware: never schedule past the performance; keep intervals short before it
  if (ev.premiereAt && ev.premiereAt > now) {
    const left = ev.premiereAt - now;
    const maxGap = Math.max(2 * 3600000, left / 3);
    if (r.due - now > maxGap) r.due = now + maxGap;
  }
  return r;
}

/** Retention-weighted mastery 0..1 (only from active recall). */
export function mastery(rec, now = Date.now()) {
  if (!rec || !rec.history) return 0;
  const recalls = rec.history.filter((h) => !h.w);
  if (!recalls.length) return 0;
  const recent = recalls.slice(-5);
  let wsum = 0;
  let acc = 0;
  recent.forEach((h, i) => {
    const w = i + 1;
    wsum += w;
    acc += w * (h.q / 5);
  });
  const perf = acc / wsum;
  // stability grows with successful spaced recalls
  const stability = clamp(Math.log(1 + (rec.reps || 0) * Math.max(rec.interval || 0.15, 0.15) * 2) / Math.log(1 + 14), 0, 1);
  let m = perf * (0.55 + 0.45 * stability);
  // forgetting: overdue lines lose some mastery
  if (rec.due && now > rec.due && rec.interval > 0) {
    const overdueDays = (now - rec.due) / DAY;
    m *= Math.exp(-overdueDays / (rec.interval * 4 + 1));
  }
  if (rec.lastQ != null && rec.lastQ < 3) m = Math.min(m, 0.45);
  return clamp(m, 0, 1);
}

/** 'new' | 'hard' | 'partial' | 'mastered' */
export function status(rec, now = Date.now()) {
  if (!rec || !rec.history || !rec.history.some((h) => !h.w)) return rec && rec.flagged ? 'hard' : 'new';
  const m = mastery(rec, now);
  if (rec.flagged) return 'hard';
  if ((rec.lastQ != null && rec.lastQ < 3) || (rec.lapses >= 2 && m < 0.6)) return 'hard';
  if (m >= 0.75 && rec.reps >= 2 && rec.lastQ >= 4) return 'mastered';
  return 'partial';
}

export function isDue(rec, now = Date.now()) {
  if (!rec || !rec.history || !rec.history.length) return false;
  return (rec.due || 0) <= now;
}

/** Higher = more urgent */
export function priority(rec, now = Date.now()) {
  if (!rec || !rec.history || !rec.history.length) return 1; // new
  const overdue = Math.max(0, now - (rec.due || 0)) / DAY;
  const m = mastery(rec, now);
  return (1 - m) * 3 + Math.min(3, overdue) + (rec.flagged ? 2 : 0) + (rec.lapses || 0) * 0.5 + ((rec.lastQ ?? 5) < 3 ? 2 : 0);
}

/**
 * Build a review queue from ids.
 * @param {string[]} ids candidate card ids in script order
 * @param {Record<string,object>} records
 * @param {{now?:number, newLimit?:number, includeNotDue?:boolean}} opts
 */
export function buildQueue(ids, records, opts = {}) {
  const now = opts.now ?? Date.now();
  const due = [];
  const fresh = [];
  const later = [];
  for (const id of ids) {
    const r = records[id];
    if (!r || !r.history || !r.history.some((h) => !h.w)) fresh.push(id);
    else if ((r.due || 0) <= now || r.flagged) due.push(id);
    else later.push(id);
  }
  due.sort((a, b) => priority(records[b], now) - priority(records[a], now));
  const queue = [...due, ...fresh.slice(0, opts.newLimit ?? 15)];
  if (opts.includeNotDue && queue.length < (opts.minSize ?? 10)) {
    later.sort((a, b) => (records[a].due || 0) - (records[b].due || 0));
    queue.push(...later.slice(0, (opts.minSize ?? 10) - queue.length));
  }
  return { queue, dueCount: due.length, newCount: fresh.length, laterCount: later.length };
}
