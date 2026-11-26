// ActoMind – word-level comparison of a spoken/typed answer with the reference text.
// Uses Levenshtein distance on tokens with a traceback, case- and punctuation-insensitive.
import { pieces, normTokens, normalizeWord, stripDiacritics } from './tokenize.js';

export const STRICTNESS = {
  free: { near: true, pass: 0.0, extraPenalty: 0.25 },
  training: { near: true, pass: 0.8, extraPenalty: 0.25 },
  professional: { near: false, pass: 0.95, extraPenalty: 0.5 },
};

/** Character-level Levenshtein similarity 0..1 */
export function similarity(a, b) {
  if (a === b) return 1;
  const al = a.length;
  const bl = b.length;
  if (!al || !bl) return 0;
  let prev = new Array(bl + 1);
  let cur = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    cur[0] = i;
    for (let j = 1; j <= bl; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return 1 - prev[bl] / Math.max(al, bl);
}

/** How well a heard token matches a reference token: 'exact' | 'near' | 'none' */
export function tokenMatch(ref, hyp) {
  if (ref === hyp) return 'exact';
  if (stripDiacritics(ref) === stripDiacritics(hyp)) return 'exact'; // recognizers & keyboards drop diacritics
  const r = stripDiacritics(ref);
  const h = stripDiacritics(hyp);
  const sim = similarity(r, h);
  const minLen = Math.min(r.length, h.length);
  if (minLen >= 4 && sim >= 0.75) return 'near';
  if (minLen >= 2 && minLen < 4 && sim >= 0.66 && r[0] === h[0]) return 'near';
  return 'none';
}

/**
 * Align reference and hypothesis token arrays.
 * @returns {{op:'match'|'near'|'sub'|'del'|'ins', r?:number, h?:number}[]}
 */
export function alignTokens(ref, hyp) {
  const n = ref.length;
  const m = hyp.length;
  const cost = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    cost[i] = new Float64Array(m + 1);
    cost[i][0] = i;
  }
  for (let j = 0; j <= m; j++) cost[0][j] = j;
  const kind = [];
  for (let i = 1; i <= n; i++) {
    kind[i] = [];
    for (let j = 1; j <= m; j++) {
      const k = tokenMatch(ref[i - 1], hyp[j - 1]);
      kind[i][j] = k;
      const subCost = k === 'exact' ? 0 : k === 'near' ? 0.4 : 1;
      cost[i][j] = Math.min(cost[i - 1][j - 1] + subCost, cost[i - 1][j] + 1, cost[i][j - 1] + 1);
    }
  }
  const ops = [];
  let i = n;
  let j = m;
  const eps = 1e-9;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const k = kind[i][j];
      const subCost = k === 'exact' ? 0 : k === 'near' ? 0.4 : 1;
      if (Math.abs(cost[i][j] - (cost[i - 1][j - 1] + subCost)) < eps) {
        ops.push({ op: k === 'exact' ? 'match' : k === 'near' ? 'near' : 'sub', r: i - 1, h: j - 1 });
        i--; j--;
        continue;
      }
    }
    if (i > 0 && Math.abs(cost[i][j] - (cost[i - 1][j] + 1)) < eps) {
      ops.push({ op: 'del', r: i - 1 });
      i--;
      continue;
    }
    ops.push({ op: 'ins', h: j - 1 });
    j--;
  }
  return ops.reverse();
}

/**
 * Compare a reference line with a transcript.
 * @param {string} reference original line text (may contain inline directions)
 * @param {string} transcript what the actor said / typed
 * @param {{strictness?:string, lang?:string, hinted?:Iterable<number>}} opts hinted = spoken-word indices revealed as hints
 */
export function compareText(reference, transcript, opts = {}) {
  const lang = opts.lang || 'pl';
  const refPieces = pieces(reference).filter((p) => p.type === 'word');
  // map normalized reference tokens back to word pieces (numbers can expand to several tokens)
  const refTokens = [];
  const refOwner = [];
  refPieces.forEach((p, idx) => {
    const toks = normTokens(p.text, lang);
    for (const t of toks) { refTokens.push(t); refOwner.push(idx); }
  });
  const hypWords = pieces(transcript || '').filter((p) => p.type === 'word');
  const hypTokens = [];
  const hypText = [];
  for (const p of hypWords) {
    for (const t of normTokens(p.text, lang)) { hypTokens.push(t); hypText.push(t === normalizeWord(p.text) ? p.text : t); }
  }
  const ops = alignTokens(refTokens, hypTokens);
  // per reference word status
  const wordStatus = refPieces.map(() => ({ hits: 0, near: 0, total: 0, heard: [] }));
  const extras = [];
  const sequence = []; // ordered output for display
  for (const o of ops) {
    if (o.op === 'ins') {
      extras.push(hypText[o.h]);
      sequence.push({ kind: 'extra', text: hypText[o.h] });
      continue;
    }
    const owner = refOwner[o.r];
    const ws = wordStatus[owner];
    ws.total++;
    if (o.op === 'match') ws.hits++;
    else if (o.op === 'near') { ws.near++; ws.heard.push(hypText[o.h]); }
    else if (o.op === 'sub') ws.heard.push(hypText[o.h]);
    const lastSeq = sequence[sequence.length - 1];
    if (!lastSeq || lastSeq.kind !== 'ref' || lastSeq.index !== owner) sequence.push({ kind: 'ref', index: owner });
  }
  const hinted = new Set(opts.hinted || []);
  const strict = STRICTNESS[opts.strictness || 'training'] || STRICTNESS.training;
  const tokens = refPieces.map((p, idx) => {
    const ws = wordStatus[idx];
    let status;
    if (hinted.has(idx)) status = 'hint';
    else if (ws.total && ws.hits === ws.total) status = 'ok';
    else if (ws.total && ws.hits + ws.near === ws.total) status = strict.near ? 'near' : 'wrong';
    else if (ws.heard.length) status = 'wrong';
    else status = 'missed';
    return { index: idx, text: p.text, status, heard: ws.heard.join(' ') };
  });
  const result = { tokens, extras, sequence, strictness: opts.strictness || 'training', transcript: transcript || '' };
  return scoreResult(result, reference);
}

/** (Re)compute counters and score – also used after manual correction. */
export function scoreResult(result, reference) {
  const strict = STRICTNESS[result.strictness] || STRICTNESS.training;
  const t = result.tokens;
  const count = (s) => t.filter((x) => x.status === s).length;
  const ok = count('ok');
  const near = count('near');
  const wrong = count('wrong');
  const missed = count('missed');
  const hints = count('hint');
  const extra = result.extras.length;
  const total = t.length;
  const credited = ok + near;
  const denom = total + strict.extraPenalty * extra;
  const score = total === 0 ? (extra ? 0 : 1) : Math.max(0, Math.min(1, credited / denom));
  const problemSpans = [];
  let cur = null;
  for (const tok of t) {
    const bad = tok.status === 'wrong' || tok.status === 'missed' || tok.status === 'hint';
    if (bad) {
      if (!cur) { cur = { from: tok.index, to: tok.index, words: [] }; problemSpans.push(cur); }
      cur.to = tok.index;
      cur.words.push(tok.text);
    } else cur = null;
  }
  problemSpans.forEach((s) => { s.text = s.words.join(' '); delete s.words; });
  return Object.assign(result, {
    reference: reference ?? result.reference,
    counts: { ok, near, wrong, missed, hints, extra, total },
    score,
    percent: Math.round(score * 100),
    passed: score >= strict.pass,
    problemSpans,
  });
}

/** Manual correction: set status of a reference token, returns rescored result. */
export function overrideToken(result, index, status) {
  const tokens = result.tokens.map((t) => (t.index === index ? { ...t, status, manual: true } : t));
  return scoreResult({ ...result, tokens }, result.reference);
}

/** Cycle used by the UI when the user taps a word to correct recognition errors. */
export function nextManualStatus(status) {
  return { ok: 'wrong', near: 'wrong', wrong: 'missed', missed: 'ok', hint: 'ok' }[status] || 'ok';
}

/** Remove an extra (inserted) word from result (manual correction). */
export function dropExtra(result, extraIndex) {
  const extras = result.extras.filter((_, i) => i !== extraIndex);
  let seen = -1;
  const sequence = result.sequence.filter((s) => {
    if (s.kind !== 'extra') return true;
    seen++;
    return seen !== extraIndex;
  });
  return scoreResult({ ...result, extras, sequence }, result.reference);
}

/**
 * Incremental progress of a live transcript against a reference: how many reference words
 * have been covered so far (used to detect end of utterance / follow the actor).
 */
export function coverage(reference, transcript, lang = 'pl') {
  const ref = normTokens(reference, lang);
  const hyp = normTokens(transcript, lang);
  if (!ref.length) return { covered: 0, total: 0, ratio: 1 };
  const ops = alignTokens(ref, hyp);
  // trailing deletions are "not yet said", count last matched reference index
  let lastMatched = -1;
  for (const o of ops) if ((o.op === 'match' || o.op === 'near') && o.r > lastMatched) lastMatched = o.r;
  return { covered: lastMatched + 1, total: ref.length, ratio: (lastMatched + 1) / ref.length };
}
