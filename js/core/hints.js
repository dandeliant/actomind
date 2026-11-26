// ActoMind – "first letters" style hints. Punctuation and word order are preserved.
import { pieces, firstSyllable } from './tokenize.js';

export const HINT_MODES = ['first', 'firstLast', 'syllable', 'two', 'blank'];

/**
 * Hint for one word.
 * @param {string} word
 * @param {'first'|'firstLast'|'syllable'|'two'|'blank'} mode
 * @param {string} [manual] manual syllable hint entered by the user
 */
export function wordHint(word, mode, manual) {
  const ch = Array.from(word);
  switch (mode) {
    case 'firstLast':
      return ch.length <= 2 ? word : ch[0] + ch[ch.length - 1];
    case 'syllable': {
      const s = manual || firstSyllable(word);
      return s.length >= word.length ? word : s + '·';
    }
    case 'two':
      return ch.slice(0, 2).join('');
    case 'blank':
      return '_'.repeat(ch.length);
    case 'first':
    default:
      return ch[0];
  }
}

/** Whole text as hints (used in tests, export and screen readers). */
export function hintText(text, mode = 'first', manual = {}) {
  return pieces(text)
    .filter((p) => p.type !== 'dir')
    .map((p) => (p.type === 'word' ? wordHint(p.text, mode, manual[p.index]).replace(/·$/, '') : p.text))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Deterministic hiding order for vanishing words: indexes sorted so that increasing the level
 * hides a superset of previously hidden words. Longer words tend to disappear first.
 */
export function vanishOrder(wordCount, seed = 1, lengths = []) {
  let a = seed >>> 0 || 1;
  const rand = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const keyed = Array.from({ length: wordCount }, (_, i) => ({ i, k: rand() + Math.min(0.6, (lengths[i] || 4) / 20) }));
  keyed.sort((x, y) => y.k - x.k);
  return keyed.map((x) => x.i);
}

/** Set of hidden word indexes for a level 0..100 */
export function hiddenSet(wordCount, level, seed = 1, lengths = []) {
  const n = Math.round((wordCount * Math.max(0, Math.min(100, level))) / 100);
  return new Set(vanishOrder(wordCount, seed, lengths).slice(0, n));
}
