// ActoMind – application state: settings (localStorage), scripts, progress, sessions, gamification.
import { db } from './db.js';
import { parseScript, CHARACTER_COLORS, scenesOf } from './parser.js';
import { uid, dateKey, debounce, DAY, clamp } from './util.js';
import * as srs from './srs.js';
import { defaultStudio } from '../audio/program.js';

// ------------------------------------------------------------------ events
const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}
export function emit(evt, data) {
  for (const fn of listeners.get(evt) || []) { try { fn(data); } catch (e) { console.error(e); } }
}

// ------------------------------------------------------------------ settings
const SETTINGS_KEY = 'actomind.settings';
export const DEFAULT_SETTINGS = {
  lang: 'pl',
  theme: 'dark',
  scriptSize: 19,
  scriptLineHeight: 1.65,
  gamification: true,
  dailyGoal: 15,
  strictness: 'training',
  sttEnabled: true,
  voiceCommands: false,
  commandKeyword: false,
  eyesFree: false,
  autoSpeakCue: true,
  silenceTimeout: 1.8,
  backendUrl: '',
  accessCode: '',
  cloudConsent: false,
  micConsent: false,
  sttConsent: false,
  tutorialDone: false,
  activeScriptId: null,
  listenGapScale: 1,
  listenRate: 1,
  reader: { hideOthers: false, onlyMine: false, hideDirections: false, autoScroll: 0 },
  hintMode: 'first',
  vanishLevel: 50,
  newPerSession: 15,
};

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { ...DEFAULT_SETTINGS, ...raw, reader: { ...DEFAULT_SETTINGS.reader, ...(raw.reader || {}) } };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
export const settings = loadSettings();
export function setSetting(key, value) {
  settings[key] = value;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* quota */ }
  emit('settings', { key, value });
}
export function resetSettings() {
  localStorage.removeItem(SETTINGS_KEY);
  Object.assign(settings, DEFAULT_SETTINGS);
  emit('settings', {});
}

// ------------------------------------------------------------------ scripts
const scriptCache = new Map();

export function normalizeScript(s) {
  s.characters = s.characters || [];
  s.items = s.items || [];
  s.myRoles = s.myRoles || [];
  s.voices = s.voices || {};
  s.studio = { ...defaultStudio(), ...(s.studio || {}) };
  s.chunks = s.chunks || {};
  s.manualHints = s.manualHints || {};
  s.notes = s.notes || {};
  s.lang = s.lang || 'pl';
  return s;
}

export async function listScripts({ archived = false } = {}) {
  const all = await db.all('scripts');
  all.forEach((s) => scriptCache.set(s.id, normalizeScript(s)));
  return all.filter((s) => !!s.archived === archived).sort((a, b) => (b.lastPracticedAt || b.updatedAt || 0) - (a.lastPracticedAt || a.updatedAt || 0));
}

export async function getScript(id) {
  if (!id) return null;
  if (scriptCache.has(id)) return scriptCache.get(id);
  const s = await db.get('scripts', id);
  if (s) scriptCache.set(id, normalizeScript(s));
  return s || null;
}

const pendingSaves = new Map();
export async function saveScript(script, { silent = false } = {}) {
  script.updatedAt = Date.now();
  scriptCache.set(script.id, script);
  await db.put('scripts', script);
  if (!silent) emit('script', script);
  return script;
}
/** Debounced save for frequent edits (notes, editor typing). */
export function saveScriptSoon(script) {
  scriptCache.set(script.id, script);
  let d = pendingSaves.get(script.id);
  if (!d) {
    d = debounce(() => saveScript(scriptCache.get(script.id), { silent: true }), 600);
    pendingSaves.set(script.id, d);
  }
  d();
}
export function flushSaves() { for (const d of pendingSaves.values()) d.flush(); }

export async function createScriptFromText(text, { title = '', lang = settings.lang } = {}) {
  const parsed = parseScript(text);
  const script = normalizeScript({
    id: uid('s_'),
    title: title || parsed.title || (lang === 'en' ? 'Untitled script' : 'Scenariusz bez tytułu'),
    lang,
    rawText: text,
    characters: parsed.characters,
    items: parsed.items,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    archived: false,
    premiereAt: null,
  });
  await saveScript(script);
  await setActiveScript(script.id);
  await bumpTotal('scriptsImported');
  return script;
}

export async function createEmptyScript(title, lang = settings.lang) {
  const script = normalizeScript({
    id: uid('s_'), title, lang, rawText: '', characters: [], items: [], createdAt: Date.now(), updatedAt: Date.now(), archived: false, premiereAt: null,
  });
  await saveScript(script);
  await setActiveScript(script.id);
  return script;
}

export async function deleteScript(id) {
  await db.delete('scripts', id);
  await db.delete('progress', id);
  await db.deleteByIndex('sessions', 'scriptId', id);
  await db.deleteByIndex('rehearsals', 'scriptId', id);
  await db.deleteByIndex('recordings', 'scriptId', id);
  await db.deleteByIndex('audioExports', 'scriptId', id);
  await db.delete('meta', 'snap:' + id);
  await db.delete('meta', 'plan:' + id);
  scriptCache.delete(id);
  progressCache.delete(id);
  if (settings.activeScriptId === id) setSetting('activeScriptId', null);
  emit('scripts');
}

export async function setActiveScript(id) {
  setSetting('activeScriptId', id);
  emit('active', id);
}

export async function activeScript() {
  let s = settings.activeScriptId ? await getScript(settings.activeScriptId) : null;
  if (s && s.archived) s = null;
  if (!s) {
    const list = await listScripts();
    s = list[0] || null;
    if (s) setSetting('activeScriptId', s.id);
  }
  return s;
}

export function charById(script, id) {
  return script.characters.find((c) => c.id === id) || null;
}

export function addCharacter(script, name) {
  const c = { id: uid('c_'), name: name.trim(), color: CHARACTER_COLORS[script.characters.length % CHARACTER_COLORS.length] };
  script.characters.push(c);
  return c;
}

export function myLines(script) {
  const mine = new Set(script.myRoles);
  return script.items.filter((it) => it.type === 'line' && mine.has(it.charId));
}

export function isMine(script, item) {
  return item && item.type === 'line' && script.myRoles.includes(item.charId);
}

// ------------------------------------------------------------------ progress
const progressCache = new Map();
export async function getProgress(scriptId) {
  if (progressCache.has(scriptId)) return progressCache.get(scriptId);
  const p = (await db.get('progress', scriptId)) || { id: scriptId, records: {} };
  progressCache.set(scriptId, p);
  return p;
}
const saveProgressSoon = debounce((p) => db.put('progress', p).catch(console.error), 400);
export function saveProgress(p) {
  progressCache.set(p.id, p);
  saveProgressSoon(p);
}
export function flushProgress() { saveProgressSoon.flush(); }

/**
 * Register an active recall review for a card (lineId or lineId#chunk).
 * @param {object} script
 * @param {string} cardId
 * @param {{q:number, src?:string, score?:number, hints?:number, latencyMs?:number, weight?:number}} ev
 */
export async function recordReview(script, cardId, ev) {
  const p = await getProgress(script.id);
  const prev = p.records[cardId];
  p.records[cardId] = srs.review(prev, { ...ev, now: Date.now(), premiereAt: script.premiereAt || undefined });
  if (prev?.flagged) p.records[cardId].flagged = true;
  saveProgress(p);
  script.lastPracticedAt = Date.now();
  saveScriptSoon(script);
  await gami.onReview(ev);
  snapshotSoon(script);
  if ((ev.weight ?? 1) >= 1 && (ev.q ?? 0) >= 4) {
    const st = roleStats(script, p);
    if (st.total > 0 && st.mastered === st.total) await gami.unlock('role_mastered');
  }
  emit('progress', { scriptId: script.id, cardId });
  return p.records[cardId];
}

export async function setFlagged(script, lineId, flagged) {
  const p = await getProgress(script.id);
  const r = p.records[lineId] || srs.newRecord();
  r.flagged = flagged;
  p.records[lineId] = r;
  saveProgress(p);
  emit('progress', { scriptId: script.id, cardId: lineId });
}

export async function resetRoleProgress(script, charId) {
  const p = await getProgress(script.id);
  const ids = new Set(script.items.filter((i) => i.type === 'line' && i.charId === charId).map((i) => i.id));
  for (const k of Object.keys(p.records)) if (ids.has(k.split('#')[0])) delete p.records[k];
  saveProgress(p);
  flushProgress();
  await db.delete('meta', 'snap:' + script.id);
  emit('progress', { scriptId: script.id });
}

function chunkIndex(records) {
  const m = new Map();
  for (const [k, r] of Object.entries(records)) {
    const i = k.indexOf('#');
    if (i < 0) continue;
    const line = k.slice(0, i);
    if (!m.has(line)) m.set(line, []);
    m.get(line).push(r);
  }
  return m;
}

/** State of one line: {status, mastery, rec} */
export function lineState(records, lineId, idx = null, now = Date.now()) {
  const rec = records[lineId];
  const chunks = (idx || chunkIndex(records)).get(lineId) || [];
  const hasRecall = rec && rec.history && rec.history.some((h) => !h.w);
  if (hasRecall) return { status: srs.status(rec, now), mastery: srs.mastery(rec, now), rec };
  if (chunks.length) {
    const m = chunks.reduce((s, r) => s + srs.mastery(r, now), 0) / chunks.length;
    const anyHard = chunks.some((r) => srs.status(r, now) === 'hard');
    return { status: rec?.flagged || anyHard ? 'hard' : 'partial', mastery: m * 0.8, rec };
  }
  return { status: rec?.flagged ? 'hard' : 'new', mastery: 0, rec };
}

/** Aggregated statistics of the user's role(s). */
export function roleStats(script, progress, now = Date.now()) {
  const lines = myLines(script);
  const idx = chunkIndex(progress.records);
  const counts = { new: 0, hard: 0, partial: 0, mastered: 0 };
  let msum = 0;
  let due = 0;
  for (const l of lines) {
    const st = lineState(progress.records, l.id, idx, now);
    counts[st.status]++;
    msum += st.mastery;
    if (st.rec && srs.isDue(st.rec, now)) due++;
  }
  const total = lines.length;
  return {
    total, ...counts, due,
    difficult: counts.hard,
    masteryPct: total ? Math.round((msum / total) * 100) : 0,
    mastery: total ? msum / total : 0,
  };
}

export function lineStatuses(script, progress, now = Date.now()) {
  const idx = chunkIndex(progress.records);
  const out = {};
  for (const l of myLines(script)) out[l.id] = lineState(progress.records, l.id, idx, now);
  return out;
}

// ------------------------------------------------------------------ snapshots (progress chart)
const snapshotSoon = debounce(async (script) => {
  const p = await getProgress(script.id);
  const st = roleStats(script, p);
  const key = 'snap:' + script.id;
  const snap = (await db.get('meta', key)) || { key, days: {} };
  snap.days[dateKey()] = { mastery: st.masteryPct, mastered: st.mastered, hard: st.hard, total: st.total };
  await db.put('meta', snap);
}, 1500);
export async function getSnapshots(scriptId) {
  return (await db.get('meta', 'snap:' + scriptId)) || { days: {} };
}

// ------------------------------------------------------------------ sessions & time
export class SessionTracker {
  constructor(scriptId, mode) {
    this.scriptId = scriptId;
    this.mode = mode;
    this.ms = 0;
    this.lastTick = Date.now();
    this.lastActivity = Date.now();
    this.reviews = 0;
    this.hints = 0;
    this.timer = setInterval(() => this.tick(), 5000);
    this.onAct = () => { this.lastActivity = Date.now(); };
    ['pointerdown', 'keydown', 'touchstart'].forEach((e) => window.addEventListener(e, this.onAct, { passive: true }));
  }
  activity() { this.lastActivity = Date.now(); }
  tick() {
    const now = Date.now();
    const visible = document.visibilityState === 'visible';
    // count time while visible and active within the last 2 minutes (audio playback calls activity())
    if (visible && now - this.lastActivity < 120000) this.ms += now - this.lastTick;
    this.lastTick = now;
  }
  async stop() {
    clearInterval(this.timer);
    ['pointerdown', 'keydown', 'touchstart'].forEach((e) => window.removeEventListener(e, this.onAct));
    this.tick();
    if (this.ms < 5000 && !this.reviews) return;
    await db.put('sessions', { id: uid('ss_'), scriptId: this.scriptId, mode: this.mode, start: Date.now() - this.ms, ms: this.ms, reviews: this.reviews, hints: this.hints });
    await gami.onMinutes(this.ms / 60000);
    emit('sessions', this.scriptId);
  }
}

export async function scriptTime(scriptId) {
  const s = await db.byIndex('sessions', 'scriptId', scriptId);
  return s.reduce((a, x) => a + (x.ms || 0), 0);
}

// ------------------------------------------------------------------ rehearsals
export async function saveRehearsal(report) {
  report.id = report.id || uid('r_');
  await db.put('rehearsals', report);
  emit('rehearsals', report.scriptId);
  return report;
}
export async function listRehearsals(scriptId) {
  const r = await db.byIndex('rehearsals', 'scriptId', scriptId);
  return r.sort((a, b) => b.date - a.date);
}

// ------------------------------------------------------------------ tempo profiles
export async function tempoProfiles() {
  return (await db.get('meta', 'tempoProfiles'))?.list || [];
}
export async function saveTempoProfiles(list) {
  await db.put('meta', { key: 'tempoProfiles', list });
}

// ------------------------------------------------------------------ gamification
export const ACHIEVEMENTS = [
  { id: 'first_script', icon: 'script' },
  { id: 'first_review', icon: 'brain' },
  { id: 'reviews_100', icon: 'layers' },
  { id: 'reviews_500', icon: 'layers' },
  { id: 'streak_3', icon: 'flame' },
  { id: 'streak_7', icon: 'flame' },
  { id: 'streak_30', icon: 'flame' },
  { id: 'first_partner', icon: 'masks' },
  { id: 'first_dress', icon: 'curtain' },
  { id: 'no_hint_10', icon: 'star' },
  { id: 'no_hint_30', icon: 'star' },
  { id: 'clean_scene', icon: 'award' },
  { id: 'role_mastered', icon: 'trophy' },
  { id: 'marathon', icon: 'clock' },
  { id: 'audio_export', icon: 'headphones' },
  { id: 'mentor_10', icon: 'feather' },
];

async function getGami() {
  return (await db.get('meta', 'gamification')) || { key: 'gamification', xp: 0, streak: 0, bestStreak: 0, lastDay: null, days: {}, achievements: {}, totals: {}, noHintRecord: 0 };
}
async function putGami(g) { await db.put('meta', g); emit('gamification', g); }

export const gami = {
  get: getGami,
  async touchDay(g) {
    const today = dateKey();
    if (g.lastDay !== today) {
      const yesterday = dateKey(Date.now() - DAY);
      g.streak = g.lastDay === yesterday ? (g.streak || 0) + 1 : 1;
      g.bestStreak = Math.max(g.bestStreak || 0, g.streak);
      g.lastDay = today;
    }
    g.days[today] = g.days[today] || { minutes: 0, reviews: 0, xp: 0 };
    return g.days[today];
  },
  async addXp(n, extra = {}) {
    const g = await getGami();
    const d = await gami.touchDay(g);
    g.xp = (g.xp || 0) + n;
    d.xp += n;
    Object.assign(g, extra);
    await putGami(g);
    await gami.check(g);
    return g;
  },
  async onReview(ev) {
    const g = await getGami();
    const d = await gami.touchDay(g);
    const gain = 2 + Math.round(ev.q || 0);
    g.xp = (g.xp || 0) + gain;
    d.xp += gain;
    d.reviews += 1;
    g.totals.reviews = (g.totals.reviews || 0) + 1;
    await putGami(g);
    await gami.check(g);
  },
  async onMinutes(min) {
    const g = await getGami();
    const d = await gami.touchDay(g);
    d.minutes += min;
    g.xp = (g.xp || 0) + Math.round(min);
    await putGami(g);
    await gami.check(g);
  },
  async unlock(id) {
    const g = await getGami();
    if (g.achievements[id]) return false;
    g.achievements[id] = Date.now();
    await putGami(g);
    emit('achievement', id);
    return true;
  },
  async total(name, inc = 1) {
    const g = await getGami();
    g.totals[name] = (g.totals[name] || 0) + inc;
    await putGami(g);
    await gami.check(g);
    return g.totals[name];
  },
  async noHintRun(n) {
    const g = await getGami();
    if (n > (g.noHintRecord || 0)) { g.noHintRecord = n; await putGami(g); }
    if (n >= 10) await gami.unlock('no_hint_10');
    if (n >= 30) await gami.unlock('no_hint_30');
  },
  async check(g) {
    const t = g.totals || {};
    const conds = {
      first_script: (t.scriptsImported || 0) >= 1,
      first_review: (t.reviews || 0) >= 1,
      reviews_100: (t.reviews || 0) >= 100,
      reviews_500: (t.reviews || 0) >= 500,
      streak_3: g.streak >= 3,
      streak_7: g.streak >= 7,
      streak_30: g.streak >= 30,
      first_partner: (t.partner || 0) >= 1,
      first_dress: (t.dress || 0) >= 1,
      marathon: (g.days[dateKey()]?.minutes || 0) >= 60,
      audio_export: (t.audioExports || 0) >= 1,
      mentor_10: (t.mentorNotes || 0) >= 10,
    };
    for (const [id, okk] of Object.entries(conds)) {
      if (okk && !g.achievements[id]) {
        g.achievements[id] = Date.now();
        await db.put('meta', g);
        emit('achievement', id);
      }
    }
  },
  level(xp) {
    // gentle curve: level n needs 120 * n^1.5 xp in total
    let lvl = 1;
    while (120 * Math.pow(lvl, 1.5) <= xp) lvl++;
    const prev = lvl === 1 ? 0 : 120 * Math.pow(lvl - 1, 1.5);
    const next = 120 * Math.pow(lvl, 1.5);
    return { level: lvl, progress: clamp((xp - prev) / (next - prev), 0, 1), next: Math.round(next) };
  },
};

export async function bumpTotal(name, inc = 1) { return gami.total(name, inc); }

// ------------------------------------------------------------------ backup / privacy
export async function exportBackup({ includeAudio = false } = {}) {
  const [scripts, progress, sessions, rehearsals, meta] = await Promise.all(['scripts', 'progress', 'sessions', 'rehearsals', 'meta'].map((s) => db.all(s)));
  const data = { app: 'ActoMind', version: 1, exportedAt: new Date().toISOString(), settings: { ...settings, accessCode: '' }, scripts, progress, sessions, rehearsals, meta };
  if (includeAudio) {
    const recs = await db.all('recordings');
    data.recordings = await Promise.all(recs.map(async (r) => ({ ...r, blob: undefined, data: await blobToDataUrl(r.blob) })));
  }
  return data;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

export async function importBackup(data, { replace = false } = {}) {
  if (!data || data.app !== 'ActoMind' || !Array.isArray(data.scripts)) throw new Error('INVALID_BACKUP');
  if (replace) {
    for (const s of ['scripts', 'progress', 'sessions', 'rehearsals', 'meta']) await db.clear(s);
  }
  await db.putMany('scripts', data.scripts);
  await db.putMany('progress', data.progress || []);
  await db.putMany('sessions', data.sessions || []);
  await db.putMany('rehearsals', data.rehearsals || []);
  await db.putMany('meta', (data.meta || []).filter((m) => m.key !== 'gamification' || replace));
  if (Array.isArray(data.recordings)) {
    for (const r of data.recordings) {
      const blob = await (await fetch(r.data)).blob();
      const { data: _d, ...rest } = r;
      await db.put('recordings', { ...rest, blob });
    }
  }
  scriptCache.clear();
  progressCache.clear();
  emit('scripts');
  return data.scripts.length;
}

export async function wipeAll() {
  for (const s of ['scripts', 'progress', 'sessions', 'rehearsals', 'recordings', 'audioExports', 'tts', 'meta']) await db.clear(s);
  scriptCache.clear();
  progressCache.clear();
  localStorage.removeItem(SETTINGS_KEY);
  Object.assign(settings, DEFAULT_SETTINGS, { tutorialDone: true });
  emit('scripts');
}

export { scenesOf };
