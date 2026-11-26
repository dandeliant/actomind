// ActoMind – tiny DOM helpers and reusable UI controls.
import { icon } from './icons.js';
import { t } from '../core/i18n.js';

// Views build children with conditional expressions (`cond ? el : null`). Native append/replaceChildren
// would stringify null/false into text nodes, so skip empty values everywhere.
(function patchNodeInsertion() {
  if (typeof Element === 'undefined' || Element.prototype.__actomindPatched) return;
  const clean = (args) => args.flat(Infinity).filter((c) => c != null && c !== false && c !== true);
  for (const proto of [Element.prototype, DocumentFragment.prototype, Document.prototype]) {
    for (const m of ['append', 'prepend', 'replaceChildren']) {
      const orig = proto[m];
      if (!orig) continue;
      proto[m] = function (...args) { return orig.apply(this, clean(args)); };
    }
  }
  Element.prototype.__actomindPatched = true;
})();

/**
 * Create an element.
 * h('button', { class: 'btn', onclick: fn, 'aria-label': 'x' }, 'text', child)
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' && 'value' in el) el.value = v;
      else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'hidden' || k === 'multiple') el[k] = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function mount(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function btn(label, onClick, opts = {}) {
  const b = h('button', {
    type: 'button',
    class: 'btn ' + (opts.cls || ''),
    onclick: onClick,
    title: opts.title || (typeof label === 'string' && opts.iconOnly ? label : null),
    'aria-label': opts.iconOnly ? label : opts.ariaLabel || null,
    'aria-pressed': opts.pressed == null ? null : String(!!opts.pressed),
    disabled: opts.disabled,
  });
  if (opts.icon) b.appendChild(icon(opts.icon));
  if (!opts.iconOnly && label != null) b.appendChild(typeof label === 'string' ? h('span', {}, label) : label);
  return b;
}

export function iconBtn(name, label, onClick, cls = '') {
  return btn(label, onClick, { icon: name, iconOnly: true, cls: 'btn-icon ' + cls });
}

export function linkBtn(label, href, opts = {}) {
  const a = h('a', { class: 'btn ' + (opts.cls || ''), href });
  if (opts.icon) a.appendChild(icon(opts.icon));
  a.appendChild(h('span', {}, label));
  return a;
}

/** Segmented control */
export function segmented(options, value, onChange, label) {
  const wrap = h('div', { class: 'segmented', role: 'group', 'aria-label': label || null });
  const render = (val) => {
    wrap.replaceChildren(...options.map((o) => h('button', {
      type: 'button',
      'aria-pressed': String(o.value === val),
      onclick: () => { render(o.value); onChange(o.value); },
      title: o.title || null,
    }, o.label)));
  };
  render(value);
  wrap.setValue = render;
  return wrap;
}

export function switchEl(label, checked, onChange, hint) {
  const input = h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) });
  return h('label', { class: 'switch' }, input, h('span', { class: 'switch-text' }, label, hint ? h('div', { class: 'hint' }, hint) : null));
}

export function rangeEl({ min, max, step = 1, value, format = (v) => v, onInput, onChange, label }) {
  const out = h('span', { class: 'range-val' }, format(value));
  const input = h('input', {
    type: 'range', min, max, step, value, 'aria-label': label || null,
    oninput: (e) => { const v = Number(e.target.value); out.textContent = format(v); onInput?.(v); },
    onchange: (e) => onChange?.(Number(e.target.value)),
  });
  const wrap = h('div', { class: 'range-row' }, input, out);
  wrap.input = input;
  wrap.setValue = (v) => { input.value = v; out.textContent = format(v); };
  return wrap;
}

export function selectEl(options, value, onChange, attrs = {}) {
  const s = h('select', { ...attrs, onchange: (e) => onChange(e.target.value) },
    options.map((o) => (o.group
      ? h('optgroup', { label: o.group }, o.options.map((x) => h('option', { value: x.value, selected: x.value === value }, x.label)))
      : h('option', { value: o.value, selected: o.value === value, disabled: o.disabled }, o.label))));
  return s;
}

export function field(label, control, hint) {
  const id = control.id || ('f' + Math.random().toString(36).slice(2, 8));
  if (!control.id && /^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName)) control.id = id;
  return h('div', { class: 'field' }, h('label', { for: control.id || null }, label), control, hint ? h('div', { class: 'hint' }, hint) : null);
}

export function banner(kind, iconName, ...content) {
  return h('div', { class: 'banner ' + kind, role: kind === 'bad' ? 'alert' : 'status' }, icon(iconName), h('div', {}, ...content));
}

export function ring(pct, size = 84, stroke = 8, label) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  const wrap = h('div', { class: 'ring', role: 'img', 'aria-label': `${Math.round(p)}%` });
  wrap.innerHTML = `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="var(--surface-3)" stroke-width="${stroke}" fill="none"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="url(#ringGrad)" stroke-width="${stroke}" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p / 100)}"/><defs><linearGradient id="ringGrad" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="var(--gold)"/><stop offset="1" stop-color="var(--burgundy-2)"/></linearGradient></defs></svg>`;
  wrap.appendChild(h('span', { class: 'ring-label', style: { fontSize: size / 4.6 + 'px' } }, label ?? Math.round(p) + '%'));
  return wrap;
}

export function statBox(value, label, color) {
  return h('div', { class: 'stat' }, h('div', { class: 'stat-value', style: color ? { color } : null }, value), h('div', { class: 'stat-label' }, label));
}

export function statusBar(counts, total) {
  const seg = (n, color) => (n ? h('span', { style: { width: (n / Math.max(1, total)) * 100 + '%', background: color } }) : null);
  return h('div', { class: 'bar', role: 'img', 'aria-label': `${counts.mastered}/${total}` },
    seg(counts.mastered, 'var(--ok)'), seg(counts.partial, 'var(--warn)'), seg(counts.hard, 'var(--bad)'), seg(counts.new, 'var(--gray)'));
}

// ------------------------------------------------------------------ toasts
let toastHost = null;
export function toast(message, opts = {}) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', 'aria-live': 'polite' });
    document.body.appendChild(toastHost);
  }
  const el = h('div', { class: 'toast ' + (opts.type || '') }, h('div', { class: 'grow' }, message));
  if (opts.action) el.appendChild(btn(opts.action.label, () => { opts.action.onClick(); el.remove(); }, { cls: 'btn-sm' }));
  toastHost.appendChild(el);
  setTimeout(() => el.remove(), opts.timeout || (opts.action ? 8000 : 3800));
  return el;
}

// ------------------------------------------------------------------ modals
export function modal({ title, body, actions = [], onClose, dismissible = true, wide = false }) {
  const prevFocus = document.activeElement;
  const backdrop = h('div', { class: 'modal-backdrop' });
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || null, style: wide ? { maxWidth: '860px' } : null });
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    prevFocus?.focus?.();
    onClose?.(result);
  };
  const onKey = (e) => { if (e.key === 'Escape' && dismissible) close(null); };
  if (title) box.appendChild(h('h2', {}, title));
  if (body) box.appendChild(body instanceof Node ? body : h('p', {}, body));
  if (actions.length) {
    box.appendChild(h('div', { class: 'modal-actions' }, actions.map((a) => btn(a.label, async () => {
      const r = a.onClick ? await a.onClick() : a.value;
      if (r !== false) close(a.value ?? r);
    }, { cls: a.cls || '', icon: a.icon }))));
  }
  backdrop.appendChild(box);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop && dismissible) close(null); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(backdrop);
  setTimeout(() => (box.querySelector('input,textarea,select,button.btn-primary,button') || box).focus(), 30);
  return { close, el: box };
}

export function confirmDialog(message, { title, ok, danger = false, cancel } = {}) {
  return new Promise((resolve) => {
    modal({
      title: title || t('common.confirm'),
      body: message,
      onClose: (r) => resolve(r === true),
      actions: [
        { label: cancel || t('common.cancel'), value: false },
        { label: ok || t('common.ok'), value: true, cls: danger ? 'btn-accent' : 'btn-primary' },
      ],
    });
  });
}

export function promptDialog(title, { value = '', label = '', placeholder = '', multiline = false } = {}) {
  return new Promise((resolve) => {
    const input = multiline ? h('textarea', { placeholder, value }) : h('input', { type: 'text', value, placeholder });
    input.value = value;
    const body = h('div', {}, label ? field(label, input) : input);
    const m = modal({
      title, body,
      onClose: (r) => resolve(r),
      actions: [
        { label: t('common.cancel'), value: null },
        { label: t('common.ok'), cls: 'btn-primary', onClick: () => input.value },
      ],
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multiline) { m.close(input.value); } });
  });
}

// ------------------------------------------------------------------ files
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
}

/** On phones prefer the share sheet ("Save to Files"), fall back to download. */
export async function shareOrDownload(blob, filename) {
  try {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    }
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled';
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}

export function emptyState(iconName, title, text, ...actions) {
  return h('div', { class: 'empty' }, icon(iconName), h('h3', {}, title), text ? h('p', {}, text) : null, actions.length ? h('div', { class: 'row', style: { justifyContent: 'center' } }, actions) : null);
}
