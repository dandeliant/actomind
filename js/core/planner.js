// ActoMind – study session plans and the "Premiere tomorrow" intensive plan.
import { DAY, clamp } from './util.js';

export const SESSION_LENGTHS = [5, 10, 15, 30, 45, 60, 90];

// Base templates (minutes). Modes map to app routes in the UI.
const TEMPLATES = {
  5: [['hardest', 2], ['cues', 3]],
  10: [['firstletters', 4], ['cues', 3], ['hardest', 3]],
  15: [['listen', 3], ['firstletters', 5], ['cues', 4], ['hardest', 3]],
  30: [['understand', 3], ['listen', 5], ['firstletters', 8], ['cues', 5], ['partner', 6], ['hardest', 3]],
  45: [['understand', 4], ['listen', 7], ['firstletters', 11], ['cues', 8], ['partner', 11], ['hardest', 4]],
  60: [['understand', 5], ['listen', 10], ['firstletters', 15], ['cues', 10], ['partner', 15], ['hardest', 5]],
  90: [['understand', 5], ['listen', 12], ['firstletters', 18], ['chunks', 10], ['cues', 12], ['partner', 25], ['hardest', 8]],
};

export const SELF_LEVELS = { none: 0, some: 0.3, most: 0.6, almost: 0.85 };

export function nearestLength(minutes) {
  let best = SESSION_LENGTHS[0];
  for (const l of SESSION_LENGTHS) if (l <= minutes) best = l;
  return best;
}

/**
 * Session plan adapted to the current state of knowledge.
 * @param {number} minutes one of SESSION_LENGTHS
 * @param {{mastery?:number, hardCount?:number, dueCount?:number, hasLongLines?:boolean, newCount?:number}} state
 * @returns {{mode:string, minutes:number}[]}
 */
export function sessionPlan(minutes, state = {}) {
  const len = SESSION_LENGTHS.includes(minutes) ? minutes : nearestLength(minutes);
  const m = clamp(state.mastery ?? 0, 0, 1);
  const blocks = new Map(TEMPLATES[len].map(([mode, min]) => [mode, min]));
  const move = (from, to, share) => {
    if (!blocks.has(from)) return;
    const amount = blocks.get(from) * share;
    blocks.set(from, blocks.get(from) - amount);
    blocks.set(to, (blocks.get(to) || 0) + amount);
  };
  if (m < 0.25) {
    // early stage: more exposure and scaffolded recall
    move('cues', 'firstletters', 0.5);
    move('partner', 'listen', 0.3);
    if (len >= 30) move('hardest', 'vanishing', 0.5);
  } else if (m > 0.7) {
    move('understand', 'partner', 1);
    move('listen', 'cues', 0.5);
    move('firstletters', 'partner', 0.4);
    if (m > 0.85 && len >= 30 && blocks.has('partner')) { blocks.set('dress', blocks.get('partner')); blocks.delete('partner'); }
  }
  if (!state.hardCount) {
    if (blocks.has('hardest')) { blocks.set('review', (blocks.get('review') || 0) + blocks.get('hardest')); blocks.delete('hardest'); }
  }
  if (!state.hasLongLines && blocks.has('chunks')) move('chunks', 'firstletters', 1);
  if ((state.newCount ?? 1) === 0 && blocks.has('listen') && m > 0.5) move('listen', 'cues', 1);

  // integer minutes, exact total
  let out = [...blocks.entries()].map(([mode, min]) => ({ mode, minutes: Math.round(min) })).filter((b) => b.minutes > 0);
  const diff = len - out.reduce((s, b) => s + b.minutes, 0);
  if (diff !== 0 && out.length) {
    const big = out.reduce((a, b) => (b.minutes > a.minutes ? b : a));
    big.minutes += diff;
  }
  out = out.filter((b) => b.minutes > 0);
  const order = ['understand', 'listen', 'vanishing', 'firstletters', 'chunks', 'review', 'cues', 'partner', 'dress', 'hardest'];
  out.sort((a, b) => order.indexOf(a.mode) - order.indexOf(b.mode));
  return out;
}

/** Split a daily budget into sessions of reasonable length (with breaks). */
export function splitDaily(minutes) {
  const out = [];
  let left = Math.max(5, Math.round(minutes));
  while (left >= 5) {
    let take;
    if (left > 90) take = 60;
    else if (left === 90) take = 45;
    else take = nearestLength(left);
    out.push(take);
    left -= take;
  }
  return out;
}

/**
 * Plan until the premiere.
 * @param {{now?:number, premiereAt:number, minutesPerDay:number, selfLevel?:string, mastery?:number|null, hardCount?:number, lineCount?:number, hasLongLines?:boolean, newCount?:number}} p
 */
export function premierePlan(p) {
  const now = p.now ?? Date.now();
  const premiere = p.premiereAt;
  const warnings = [];
  if (!premiere || premiere <= now) return { past: true, days: [], warnings, level: 0 };
  const level = p.mastery != null && p.mastery > 0 ? p.mastery : SELF_LEVELS[p.selfLevel || 'some'] ?? 0.3;
  const hoursLeft = (premiere - now) / 3600000;
  const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const atHour = (dayStart, h, m = 0) => { const d = new Date(dayStart); d.setHours(h, m, 0, 0); return d.getTime(); };
  const premiereDay = startOfDay(premiere);
  const today = startOfDay(now);
  const nDays = Math.round((premiereDay - today) / DAY);
  const days = [];
  const state = { mastery: level, hardCount: p.hardCount ?? 0, hasLongLines: p.hasLongLines, newCount: p.newCount };
  const premHour = new Date(premiere).getHours();
  const bedtime = 23;

  for (let d = 0; d <= nDays; d++) {
    const dayStart = today + d * DAY;
    const sessions = [];
    const isPremiereDay = d === nDays;
    const isEve = d === nDays - 1;
    if (isPremiereDay) {
      // morning refresh (only active recall, short) and warm-up before the performance
      const morningAt = premHour >= 12 ? atHour(dayStart, 9) : Math.max(now, premiere - 2.5 * 3600000);
      if (morningAt > now && morningAt < premiere - 3600000) {
        sessions.push({ kind: 'morning', at: morningAt, minutes: 15, blocks: [{ mode: 'cues', minutes: 7 }, { mode: 'hardest', minutes: 5 }, { mode: 'review', minutes: 3 }] });
      }
      if (premHour >= 15) {
        const middayAt = atHour(dayStart, 13);
        if (middayAt > now) sessions.push({ kind: 'light', at: middayAt, minutes: 15, blocks: [{ mode: 'partner', minutes: 15 }] });
      }
      const warmAt = premiere - 2 * 3600000;
      if (warmAt > now) sessions.push({ kind: 'warmup', at: warmAt, minutes: 10, blocks: [{ mode: 'cues', minutes: 5 }, { mode: 'listen', minutes: 5 }] });
    } else {
      let budget = p.minutesPerDay;
      if (d === 0) {
        const untilBed = (atHour(dayStart, bedtime) - 3600000 - now) / 60000; // stop 1 h before sleep
        budget = Math.min(budget, Math.max(0, untilBed));
      }
      if (budget >= 5) {
        const parts = splitDaily(budget);
        let at = d === 0 ? now : atHour(dayStart, 17);
        const lastTwo = nDays - d <= 2;
        parts.forEach((len, i) => {
          const sessionState = { ...state, mastery: clamp(level + (d / Math.max(1, nDays)) * (1 - level) * 0.6, 0, 1) };
          let blocks = sessionPlan(len, sessionState);
          if (lastTwo && len >= 30 && i === parts.length - 1) {
            blocks = blocks.map((b) => (b.mode === 'partner' ? { ...b, mode: 'dress' } : b));
          }
          sessions.push({ kind: 'main', at, minutes: len, blocks });
          at += (len + 15) * 60000; // break between sessions
        });
      } else if (d === 0) {
        warnings.push('lateToday');
      }
    }
    const day = { date: dayStart, sessions, isPremiereDay, isEve };
    if (isEve) day.sleep = { lastStudy: atHour(dayStart, bedtime - 1), bedtime: atHour(dayStart, bedtime), wake: atHour(dayStart + DAY, premHour >= 12 ? 8 : Math.max(5, premHour - 3)) };
    days.push(day);
  }

  // rough workload check (honest, never a promise)
  const lines = p.lineCount || 0;
  const needed = lines * (1 - level) * 4; // ~4 min of practice for each unknown line
  const available = days.reduce((s, d) => s + d.sessions.reduce((a, x) => a + x.minutes, 0), 0);
  if (needed > available) warnings.push('tight');
  if (hoursLeft < 30) warnings.push('tomorrow');
  return { past: false, days, warnings, level, hoursLeft, neededMinutes: Math.round(needed), availableMinutes: available };
}
