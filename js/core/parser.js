// ActoMind – script parser: recognises characters, dialogue, stage directions, acts and scenes.
// The original wording is preserved: lines are only trimmed, never rewritten.
import { uid } from './util.js';

export const CHARACTER_COLORS = [
  '#c9a45c', '#b0414f', '#5b8bd0', '#4fa37a', '#9b6fd0', '#d0864f', '#48a9b0', '#c25fa0',
  '#8fa34f', '#d06a6a', '#6f7fd0', '#b89a3e', '#5fb08c', '#a0705a', '#7d8a99', '#d0b04f',
];

const NARRATOR_NAMES = new Set(['NARRATOR', 'NARRATORKA', 'LEKTOR', 'LEKTORKA', 'NARRATION', 'NARRACJA', 'GŁOS', 'VOICE', 'VOICE OVER']);
const CONNECTORS = new Set(['i', 'z', 'ze', 'von', 'van', 'de', 'del', 'della', 'da', 'di', 'la', 'le', 'the', 'of', 'and', 'w', 'na', 'do', 'od', 'y', 'du', 'des', 'der']);
const CAST_HEADER = /^\s*(osoby(\s+dramatu)?|postacie|postaci|obsada|dramatis\s+personae|characters|cast(\s+of\s+characters)?)\s*[:.]?\s*$/i;
const ORDINALS = 'pierwszy|pierwsza|drugi|druga|trzeci|trzecia|czwarty|czwarta|piąty|piąta|szósty|szósta|siódmy|siódma|ósmy|ósma|dziewiąty|dziewiąta|dziesiąty|dziesiąta|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|one|two|three|four|five|six|seven|eight|nine|ten';
const ACT_RE = new RegExp(`^\\s*(akt|act|część|part)\\s+([ivxlcdm]+|\\d+|${ORDINALS})\\b\\.?(.*)$`, 'iu');
const SCENE_RE = new RegExp(`^\\s*(scena|scene|odsłona|obraz|sc\\.)\\s*([ivxlcdm]+|\\d+[a-z]?|${ORDINALS})\\b\\.?(.*)$`, 'iu');
const SLUG_RE = /^\s*(INT\.|EXT\.|INT\/EXT\.|WNĘTRZE|PLENER)\s+\S/u;
const UPPER = /\p{Lu}/u;
const LOWER = /\p{Ll}/u;

const isAllCaps = (s) => UPPER.test(s) && !LOWER.test(s);

export function nameKey(name) {
  return String(name).normalize('NFC').replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim().toUpperCase();
}

/** Does a string look like a character name? */
export function isNameLike(name) {
  const n = name.trim().replace(/\.$/, '');
  if (!n || n.length > 40) return false;
  if (/[!?,;"„”«»…]/.test(n)) return false;
  if (!/^\p{Lu}/u.test(n)) return false;
  const words = n.split(/\s+/);
  if (words.length > 4) return false;
  if (isAllCaps(n)) return true;
  return words.every((w, i) => (i > 0 && CONNECTORS.has(w.toLowerCase())) || /^[\p{Lu}\d]/u.test(w));
}

function matchHeading(line) {
  const t = line.trim();
  if (!t || t.length > 120) return null;
  let m = ACT_RE.exec(t);
  if (m && (isAllCaps(t.split(/[.:–—-]/)[0]) || /^\s*(akt|act)\b/i.test(t))) return { type: 'act', text: t };
  m = SCENE_RE.exec(t);
  if (m) {
    // "Scena 1" / "SCENA PIERWSZA" / "Scene II." – avoid prose such as "Scena się zmienia"
    return { type: 'scene', text: t };
  }
  if (SLUG_RE.test(t) && isAllCaps(t)) return { type: 'scene', text: t };
  return null;
}

/** Candidate cue on a line. strength: 'colon' | 'dot' | 'lone' | 'loneColon' */
function matchCue(line) {
  const t = line.replace(/\s+$/, '');
  // NAME (paren): text  |  NAME [paren]: text  |  NAME: text
  let m = /^\s*([^\s:(\[\]][^:(\[\]\n]{0,40}?)\s*(?:[(\[]([^)\]]{0,160})[)\]])?\s*[:：]\s*(.*)$/u.exec(t);
  if (m && isNameLike(m[1])) {
    return { name: m[1].trim(), paren: (m[2] || '').trim(), rest: (m[3] || '').trim(), strength: m[3] && m[3].trim() ? 'colon' : 'loneColon' };
  }
  // ALL CAPS NAME (paren). text   |  NAME — text
  m = /^\s*(\p{Lu}[\p{Lu}\d .'\-]{0,38}?\p{Lu}\.?)\s*(?:\(([^)]{0,160})\))?\s*(?:\.|—|–|\s-)\s+(.+)$/u.exec(t);
  if (m && isAllCaps(m[1]) && isNameLike(m[1])) {
    return { name: m[1].trim().replace(/\.$/, ''), paren: (m[2] || '').trim(), rest: m[3].trim(), strength: 'dot' };
  }
  // NAME   (alone, screenplay style) optionally with (paren)
  m = /^\s*(\p{Lu}[\p{Lu}\d .'\-]{0,38}?)\s*(?:\(([^)]{0,160})\))?\s*$/u.exec(t);
  if (m && isAllCaps(m[1]) && isNameLike(m[1]) && m[1].trim().length >= 2) {
    return { name: m[1].trim().replace(/\.$/, ''), paren: (m[2] || '').trim(), rest: '', strength: 'lone' };
  }
  return null;
}

function isParenLine(t) {
  const s = t.trim();
  return (/^\(.*\)\.?$/s.test(s) && balanced(s, '(', ')')) || (/^\[.*\]\.?$/s.test(s) && balanced(s, '[', ']'));
}
function balanced(s, o, c) {
  let d = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === o) d++;
    else if (s[i] === c) { d--; if (d === 0 && i < s.length - 2) return false; }
  }
  return d === 0;
}

function castNames(lines) {
  const names = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (!CAST_HEADER.test(lines[i])) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j].trim();
      if (!l) { if (names.size) break; continue; }
      const head = l.split(/\s+[–—-]\s+|[,:;(]/)[0].trim().replace(/\.$/, '');
      if (isNameLike(head)) names.add(nameKey(head));
      else break;
    }
  }
  return names;
}

/**
 * Parse raw script text.
 * @param {string} raw
 * @returns {{title:string, characters:{id:string,name:string,color:string,narrator?:boolean}[], items:object[]}}
 */
export function parseScript(raw = '') {
  const text = String(raw).replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/\t/g, '    ');
  const lines = text.split('\n');
  const declared = castNames(lines);

  // ---- pass 1: candidate statistics
  const counts = new Map();
  const cues = lines.map((l) => {
    if (!l.trim() || matchHeading(l) || isParenLine(l)) return null;
    const c = matchCue(l);
    if (c) {
      const k = nameKey(c.name);
      const e = counts.get(k) || { total: 0, colon: 0, caps: isAllCaps(c.name) };
      e.total++;
      if (c.strength === 'colon' || c.strength === 'loneColon') e.colon++;
      counts.set(k, e);
    }
    return c;
  });
  cues.forEach((c, i) => {
    if (!c || c.strength !== 'lone') return;
    const next = lines[i + 1] || '';
    c.followed = !!next.trim() && !matchHeading(next);
    c.isolated = i === 0 || !lines[i - 1].trim();
  });
  const screenplay = cues.some((c) => c && c.strength === 'lone' && c.followed && c.isolated && counts.get(nameKey(c.name)).total >= 2);
  const accepted = (c) => {
    if (!c) return false;
    const k = nameKey(c.name);
    const e = counts.get(k);
    if (declared.has(k)) return true;
    if (c.strength === 'colon' || c.strength === 'loneColon') {
      return e.caps || e.total >= 2;
    }
    // weak forms: dot/dash or lone name, all caps only; require repetition or a name already used with a colon
    if (e.caps && (e.total >= 2 || e.colon > 0)) return true;
    // screenplay layout: NAME on its own line after a blank line, dialogue right below
    return c.strength === 'lone' && e.caps && screenplay && c.followed && c.isolated;
  };

  // ---- pass 2: build items
  const usesParenDirections = lines.some((l) => isParenLine(l) && l.trim().length > 3);
  const characters = [];
  const charByKey = new Map();
  const getChar = (name) => {
    const k = nameKey(name);
    if (!charByKey.has(k)) {
      const c = { id: uid('c_'), name: name.trim().replace(/\.$/, ''), color: CHARACTER_COLORS[characters.length % CHARACTER_COLORS.length] };
      if (NARRATOR_NAMES.has(k)) c.narrator = true;
      characters.push(c);
      charByKey.set(k, c);
    }
    return charByKey.get(k);
  };

  const items = [];
  let current = null; // open speech item
  let openDir = null; // open multi-line direction paragraph
  let blankSince = true; // a blank line occurred since the last content line
  let lastSpeech = null;
  let inCast = false;
  let title = '';
  let resumeSpeaker = null; // speaker whose speech was interrupted by a standalone direction

  const pushDir = (t) => {
    if (openDir && !blankSince) { openDir.text += '\n' + t; return; }
    openDir = { id: uid('i_'), type: 'direction', text: t };
    items.push(openDir);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!t) {
      blankSince = true;
      if (current && current.text) current = null;
      openDir = null;
      inCast = false;
      resumeSpeaker = null;
      continue;
    }
    const heading = matchHeading(line);
    if (heading && !(current && !blankSince && !current.text)) {
      items.push({ id: uid('i_'), type: heading.type, text: heading.text });
      current = null; openDir = null; lastSpeech = null; blankSince = false; inCast = false; resumeSpeaker = null;
      continue;
    }
    if (CAST_HEADER.test(line)) {
      inCast = true; current = null;
      openDir = { id: uid('i_'), type: 'direction', text: t };
      items.push(openDir);
      blankSince = false;
      continue;
    }
    if (inCast) { openDir.text += '\n' + t; blankSince = false; continue; }

    const cue = cues[i];
    if (cue && accepted(cue)) {
      const ch = getChar(cue.name);
      current = { id: uid('i_'), type: 'line', charId: ch.id, parenthetical: cue.paren || '', text: cue.rest };
      items.push(current);
      lastSpeech = current;
      openDir = null; blankSince = false; resumeSpeaker = null;
      continue;
    }
    if (isParenLine(line)) {
      const inner = t.replace(/^[(\[]/, '').replace(/[)\]]\.?$/, '').trim();
      // "(siada)" lowercase inside a speech = inline direction; "(Matka siada.)" = standalone stage direction
      const standalone = /^\p{Lu}/u.test(inner);
      if (current && !current.text && !current.parenthetical) {
        current.parenthetical = inner;
      } else if (current && !blankSince && !standalone) {
        current.text += (current.text ? '\n' : '') + t;
      } else {
        const afterSpeech = !!current && !blankSince;
        current = null;
        openDir = null;
        pushDir(t);
        openDir = null;
        resumeSpeaker = afterSpeech ? lastSpeech : null;
      }
      blankSince = false;
      continue;
    }
    // plain text
    if (current && (!blankSince || !current.text)) {
      current.text += (current.text ? '\n' : '') + t;
    } else if (!current && resumeSpeaker && !blankSince) {
      // speech interrupted by a stage direction continues as a new line of the same character
      current = { id: uid('i_'), type: 'line', charId: resumeSpeaker.charId, parenthetical: '', text: t };
      items.push(current);
      lastSpeech = current;
    } else if (current === null && lastSpeech && blankSince && usesParenDirections && !openDir && items[items.length - 1] === lastSpeech) {
      // script marks directions with brackets → an unbracketed paragraph right after a speech continues it
      lastSpeech.text += '\n' + t;
      current = lastSpeech;
    } else {
      current = null;
      if (!title && !items.some((x) => x.type === 'line') && items.length === 0 && t.length <= 80) title = t;
      pushDir(t);
    }
    resumeSpeaker = null;
    blankSince = false;
  }

  // drop empty speech items that never received text (cue followed by nothing) – keep if they had a parenthetical
  const cleaned = items.filter((it) => !(it.type === 'line' && !it.text.trim() && !it.parenthetical));
  return { title, characters, items: cleaned };
}

/** Structure helpers -------------------------------------------------------------------------- */

/** Scenes with their item ranges. Items before the first scene heading form an implicit scene. */
export function scenesOf(items) {
  const scenes = [];
  let cur = null;
  let act = null;
  items.forEach((it, idx) => {
    if (it.type === 'act') { act = it; cur = null; return; }
    if (it.type === 'scene') {
      cur = { id: it.id, title: it.text, actId: act?.id || null, actTitle: act?.text || '', start: idx, end: idx, implicit: false };
      scenes.push(cur);
      return;
    }
    if (!cur) {
      cur = { id: '__start_' + (act?.id || 'root'), title: act ? act.text : '', actId: act?.id || null, actTitle: act?.text || '', start: idx, end: idx, implicit: true };
      scenes.push(cur);
    }
    cur.end = idx;
  });
  return scenes.filter((s) => items.slice(s.start, s.end + 1).some((x) => x.type === 'line'));
}

export function actsOf(items) {
  return items.filter((it) => it.type === 'act').map((a) => ({ id: a.id, title: a.text }));
}

export function sceneOfIndex(items, index) {
  return scenesOf(items).find((s) => index >= s.start && index <= s.end) || null;
}

/** Previous spoken line (any character) before index, or null. */
export function previousLine(items, index) {
  for (let i = index - 1; i >= 0; i--) {
    if (items[i].type === 'line') return items[i];
    if (items[i].type === 'scene' || items[i].type === 'act') return null;
  }
  return null;
}

/** Context shown as the "cue" before a line: previous line, or the nearest direction/heading. */
export function cueFor(items, index) {
  for (let i = index - 1; i >= 0; i--) {
    const it = items[i];
    if (it.type === 'line') return { kind: 'line', item: it };
    if (it.type === 'scene' || it.type === 'act') return { kind: 'start', item: it };
  }
  return { kind: 'start', item: null };
}

export function lineIndex(items, lineId) {
  return items.findIndex((x) => x.id === lineId);
}

/** Build plain text back from structured items (for export / re-parse). */
export function itemsToText(script) {
  const byId = new Map(script.characters.map((c) => [c.id, c]));
  const out = [];
  for (const it of script.items) {
    if (it.type === 'line') {
      const c = byId.get(it.charId);
      const head = (c ? c.name.toUpperCase() : '???') + (it.parenthetical ? ` (${it.parenthetical})` : '') + ':';
      out.push(head + (it.text.includes('\n') ? '\n' + it.text : ' ' + it.text));
    } else if (it.type === 'act' || it.type === 'scene') {
      out.push('', it.text, '');
    } else {
      out.push(it.text.startsWith('(') ? it.text : `(${it.text})`);
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
