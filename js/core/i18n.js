// ActoMind – internationalisation (Polish default, English)
import pl from '../i18n/pl.js';
import en from '../i18n/en.js';

export const DICTS = { pl, en };
let lang = 'pl';

export function setLang(l) {
  lang = DICTS[l] ? l : 'pl';
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}
export const getLang = () => lang;
export const locale = () => (lang === 'pl' ? 'pl-PL' : 'en-GB');

function lookup(dict, key) {
  let cur = dict;
  for (const part of key.split('.')) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Translate with {var} interpolation. Missing keys fall back to Polish, then the key. */
export function t(key, vars) {
  let s = lookup(DICTS[lang], key);
  if (s === undefined) s = lookup(DICTS.pl, key);
  if (s === undefined) return key;
  if (Array.isArray(s)) s = s[0];
  if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
  return s;
}

/** Plural forms: PL [one, few, many], EN [one, other]. Key must resolve to an array. */
export function tn(key, n, vars = {}) {
  let forms = lookup(DICTS[lang], key) ?? lookup(DICTS.pl, key);
  if (!Array.isArray(forms)) return t(key, { n, ...vars });
  let idx;
  if (lang === 'pl') {
    const n10 = n % 10;
    const n100 = n % 100;
    if (n === 1) idx = 0;
    else if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) idx = 1;
    else idx = 2;
  } else idx = n === 1 ? 0 : 1;
  const s = forms[Math.min(idx, forms.length - 1)];
  return s.replace(/\{(\w+)\}/g, (m, k) => (k === 'n' ? n : vars[k] != null ? vars[k] : m));
}

export function fmtDate(ts, opts = { day: 'numeric', month: 'long', year: 'numeric' }) {
  return new Date(ts).toLocaleDateString(locale(), opts);
}
export function fmtDateTime(ts) {
  return new Date(ts).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
}
export function fmtNum(n, d = 0) {
  return Number(n).toLocaleString(locale(), { maximumFractionDigits: d, minimumFractionDigits: d });
}
