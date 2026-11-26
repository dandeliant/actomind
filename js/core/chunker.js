// ActoMind – splitting long lines / monologues into logical fragments + cumulative learning steps.
import { pieces } from './tokenize.js';

export const LONG_LINE_WORDS = 28;

export function isLong(text) {
  const w = pieces(text).filter((p) => p.type === 'word').length;
  return w >= LONG_LINE_WORDS;
}

/**
 * Automatic fragment boundaries – spoken word indices where a fragment starts (always begins with 0).
 * Prefers sentence ends, then ; : — , as split points, aiming at `target` words per fragment.
 */
export function autoBoundaries(text, { target = 11, min = 4, max = 18 } = {}) {
  const ps = pieces(text);
  const wordsP = ps.filter((p) => p.type === 'word');
  const n = wordsP.length;
  if (n <= max) return [0];
  // strength of a break after word i (0..3)
  const strength = new Array(n).fill(0);
  let wi = -1;
  for (const p of ps) {
    if (p.type === 'word') { wi = p.index; continue; }
    if (wi < 0) continue;
    const s = p.text;
    let st = 0;
    if (/[.!?…]/.test(s)) st = 3;
    else if (/[;:—–]/.test(s) || /\n/.test(s)) st = 2;
    else if (/,/.test(s)) st = 1;
    if (p.type === 'dir') st = Math.max(st, 2);
    strength[wi] = Math.max(strength[wi], st);
  }
  const bounds = [0];
  let start = 0;
  while (n - start > max) {
    let best = -1;
    let bestScore = -Infinity;
    for (let i = start + min - 1; i < Math.min(n - min, start + max); i++) {
      const len = i - start + 1;
      const score = strength[i] * 10 - Math.abs(len - target);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) best = Math.min(n - 1, start + target - 1);
    bounds.push(best + 1);
    start = best + 1;
  }
  return bounds;
}

/** Fragments as substrings of the original text. */
export function fragments(text, boundaries) {
  const ps = pieces(text);
  const wordsP = ps.filter((p) => p.type === 'word');
  const n = wordsP.length;
  const b = normalizeBoundaries(boundaries, n);
  return b.map((from, k) => {
    const to = (b[k + 1] ?? n) - 1; // inclusive word index
    const startOff = k === 0 ? 0 : wordsP[from].start;
    const endOff = k === b.length - 1 ? text.length : wordsP[to + 1].start;
    return { index: k, from, to, text: text.slice(startOff, endOff).trim() };
  });
}

export function normalizeBoundaries(boundaries, n) {
  const set = new Set([0, ...(boundaries || [])].filter((x) => Number.isInteger(x) && x >= 0 && x < n));
  if (!n) return [0];
  return [...set].sort((a, b) => a - b);
}

/** Toggle a boundary before word index i (used by the editor). */
export function toggleBoundary(boundaries, i, n) {
  if (i <= 0 || i >= n) return normalizeBoundaries(boundaries, n);
  const set = new Set(normalizeBoundaries(boundaries, n));
  if (set.has(i)) set.delete(i); else set.add(i);
  return [...set].sort((a, b) => a - b);
}

/**
 * Cumulative steps: A, B, A+B, C, A+B+C, ..., full.
 * @returns {{parts:number[], label:string}[]}
 */
export function cumulativeSteps(count) {
  const L = (i) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : '');
  if (count <= 1) return [{ parts: [0], label: 'A', full: true }];
  const steps = [{ parts: [0], label: 'A' }];
  for (let k = 1; k < count; k++) {
    steps.push({ parts: [k], label: L(k) });
    const all = Array.from({ length: k + 1 }, (_, i) => i);
    steps.push({ parts: all, label: all.map(L).join(' + '), cumulative: true });
  }
  steps[steps.length - 1].full = true;
  return steps;
}

export const fragmentLabel = (i) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : '');
