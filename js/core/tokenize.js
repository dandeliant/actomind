// ActoMind – tokenization of script text into spoken words, separators and inline stage directions.
// The original text is never modified: every piece keeps offsets into the source string.

export const WORD_RE = /[\p{L}\p{N}]+(?:['’ʼ\-‐][\p{L}\p{N}]+)*/gu;
const DIR_RE = /\([^()]*\)|\[[^\[\]]*\]/g;

/**
 * Split text into speech / direction segments. Parenthesised or bracketed fragments are stage directions.
 * @returns {{kind:'speech'|'dir', text:string, start:number, end:number}[]}
 */
export function segmentsOf(text = '') {
  const out = [];
  let last = 0;
  DIR_RE.lastIndex = 0;
  let m;
  while ((m = DIR_RE.exec(text))) {
    if (m.index > last) out.push({ kind: 'speech', text: text.slice(last, m.index), start: last, end: m.index });
    out.push({ kind: 'dir', text: m[0], start: m.index, end: m.index + m[0].length });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'speech', text: text.slice(last), start: last, end: text.length });
  return out;
}

/** Spoken text of a line (inline directions removed, whitespace collapsed). */
export function spokenText(text = '') {
  return segmentsOf(text)
    .filter((s) => s.kind === 'speech')
    .map((s) => s.text)
    .join(' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\s+([,.;:!?…])/g, '$1')
    .trim();
}

/** Inline direction texts (without brackets). */
export function inlineDirections(text = '') {
  return segmentsOf(text).filter((s) => s.kind === 'dir').map((s) => s.text.slice(1, -1).trim());
}

/**
 * Render model for a line: words (spoken), separators (whitespace / punctuation) and directions.
 * Each word has `index` = position among spoken words.
 * @returns {{type:'word'|'sep'|'dir', text:string, start:number, end:number, index?:number}[]}
 */
export function pieces(text = '') {
  const out = [];
  let wi = 0;
  for (const seg of segmentsOf(text)) {
    if (seg.kind === 'dir') {
      out.push({ type: 'dir', text: seg.text, start: seg.start, end: seg.end });
      continue;
    }
    let last = 0;
    WORD_RE.lastIndex = 0;
    let m;
    while ((m = WORD_RE.exec(seg.text))) {
      if (m.index > last) out.push({ type: 'sep', text: seg.text.slice(last, m.index), start: seg.start + last, end: seg.start + m.index });
      out.push({ type: 'word', text: m[0], start: seg.start + m.index, end: seg.start + m.index + m[0].length, index: wi++ });
      last = m.index + m[0].length;
    }
    if (last < seg.text.length) out.push({ type: 'sep', text: seg.text.slice(last), start: seg.start + last, end: seg.end });
  }
  return out;
}

/** Spoken words (original spelling) of a text. */
export function words(text = '') {
  return pieces(text).filter((p) => p.type === 'word').map((p) => p.text);
}

export function wordCount(text = '') {
  return words(text).length;
}

export function stripDiacritics(s) {
  return s
    .replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function normalizeWord(w) {
  return String(w).normalize('NFC').toLowerCase().replace(/[’ʼ‐]/g, (c) => (c === '‐' ? '-' : "'"));
}

// --- numbers → words (so that "2" from speech recognition matches "dwa") ---
const PL_UNITS = ['zero', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć', 'dziesięć',
  'jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście', 'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście'];
const PL_TENS = ['', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt', 'sześćdziesiąt', 'siedemdziesiąt', 'osiemdziesiąt', 'dziewięćdziesiąt'];
const PL_HUND = ['', 'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset', 'siedemset', 'osiemset', 'dziewięćset'];
const EN_UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

export function numberToWords(n, lang = 'pl') {
  if (!Number.isInteger(n) || n < 0 || n > 999) return null;
  if (lang.startsWith('pl')) {
    const parts = [];
    const h = Math.floor(n / 100);
    const r = n % 100;
    if (h) parts.push(PL_HUND[h]);
    if (r < 20) { if (r || !h) parts.push(PL_UNITS[r]); }
    else { parts.push(PL_TENS[Math.floor(r / 10)]); if (r % 10) parts.push(PL_UNITS[r % 10]); }
    return parts.join(' ');
  }
  const parts = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) parts.push(EN_UNITS[h], 'hundred');
  if (r < 20) { if (r || !h) parts.push(EN_UNITS[r]); }
  else { parts.push(EN_TENS[Math.floor(r / 10)]); if (r % 10) parts.push(EN_UNITS[r % 10]); }
  return parts.join(' ');
}

/**
 * Normalized tokens for comparison. Numbers are expanded to words.
 * @returns {string[]}
 */
export function normTokens(text = '', lang = 'pl') {
  const out = [];
  for (const w of words(text)) {
    const n = normalizeWord(w);
    if (/^\d+$/.test(n)) {
      const asWords = numberToWords(parseInt(n, 10), lang);
      if (asWords) { out.push(...asWords.split(' ')); continue; }
    }
    // split hyphenated compounds only when recognizers commonly separate them? keep whole
    out.push(n);
  }
  return out;
}

/** Approximate syllable count (vowel groups) – used for speaking-time estimates and first-syllable hints. */
const VOWELS = 'aeiouyąęóéáíúàèìòùäöüâêîôûœæ';
export function syllableCount(word) {
  const w = normalizeWord(word);
  let count = 0;
  let inV = false;
  for (const ch of w) {
    const v = VOWELS.includes(ch);
    if (v && !inV) count++;
    inV = v;
  }
  if (/^\d+$/.test(w)) return Math.max(1, w.length * 1.5);
  // English silent final "e"
  if (count > 1 && /[^aeiouy]e$/.test(w) && /^[a-z]+$/.test(w)) count--;
  return Math.max(1, count);
}

/** First syllable approximation: consonants + first vowel group (+ one consonant if followed by two consonants). */
export function firstSyllable(word) {
  const chars = Array.from(word);
  const isV = (c) => VOWELS.includes(c.toLowerCase());
  let i = 0;
  while (i < chars.length && !isV(chars[i])) i++;
  if (i >= chars.length) return word;
  while (i < chars.length && isV(chars[i])) i++;
  // take one consonant if the rest starts with two consonants (e.g. "naj|mniej")
  if (i + 1 < chars.length && !isV(chars[i]) && !isV(chars[i + 1]) && i + 2 <= chars.length) i++;
  return chars.slice(0, Math.min(i, chars.length)).join('');
}

/** Sentence split on . ! ? … keeping punctuation. Returns substrings of original text. */
export function sentences(text = '') {
  const out = [];
  const re = /[^.!?…]+(?:[.!?…]+["”»)]*|$)/g;
  let m;
  while ((m = re.exec(text))) {
    if (!m[0]) { re.lastIndex++; continue; }
    if (m[0].trim()) out.push(m[0].trim());
  }
  return out;
}
