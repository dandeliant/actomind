// ActoMind – shared view components (script rendering, consent dialogs, analysis display, pickers).
import { h, modal, btn, emptyState, linkBtn, selectEl } from './dom.js';
import { icon } from './icons.js';
import { t, tn } from '../core/i18n.js';
import { settings, setSetting, activeScript, charById } from '../core/store.js';
import { pieces } from '../core/tokenize.js';
import { scenesOf } from '../core/parser.js';
import { support, recognitionProvider } from '../core/speech.js';
import { nextManualStatus, overrideToken, dropExtra } from '../core/diff.js';

/** Load the active script or render an empty state. */
export async function requireScript(root, { needRoles = true } = {}) {
  const s = await activeScript();
  if (!s) {
    root.appendChild(emptyState('script', t('empty.noScriptTitle'), t('empty.noScriptText'),
      linkBtn(t('scripts.import'), '#/import', { cls: 'btn-primary', icon: 'upload' })));
    return null;
  }
  if (needRoles && !s.myRoles.length) {
    root.appendChild(emptyState('users', t('empty.noRoleTitle'), t('empty.noRoleText', { title: s.title }),
      linkBtn(t('roles.choose'), `#/script/${s.id}/roles`, { cls: 'btn-primary', icon: 'user' })));
    return null;
  }
  return s;
}

export function charName(script, charId) {
  if (charId === '__dir') return t('studio.directionsVoice');
  return charById(script, charId)?.name || '?';
}
export function charColor(script, charId) {
  return charById(script, charId)?.color || 'var(--muted)';
}

export function whoLabel(script, item, { tagMine = true } = {}) {
  const c = charById(script, item.charId);
  const mine = script.myRoles.includes(item.charId);
  return h('div', { class: 'who', style: { color: c?.color || 'var(--text-2)' } },
    h('span', { class: 'dot', style: { background: c?.color || 'var(--muted)' } }),
    c?.name || '?',
    item.parenthetical ? h('span', { class: 'paren' }, '(' + item.parenthetical + ')') : null,
    mine && tagMine ? h('span', { class: 'tag-mine' }, t('common.myRole')) : null);
}

/** Render line text with inline directions styled; optional per-word decorator. */
export function lineTextEl(text, { wordClass, onWord, keywords } = {}) {
  const el = h('div', { class: 'text' });
  for (const p of pieces(text)) {
    if (p.type === 'dir') el.appendChild(h('span', { class: 'dir' }, p.text));
    else if (p.type === 'sep') el.appendChild(document.createTextNode(p.text));
    else {
      let cls = 'w';
      if (keywords?.has(p.index)) cls += ' kw';
      if (wordClass) cls += ' ' + (wordClass(p.index, p.text) || '');
      const span = h('span', { class: cls, dataset: { i: p.index } }, p.text);
      if (onWord) span.addEventListener('click', () => onWord(p.index, span));
      el.appendChild(span);
    }
  }
  return el;
}

export function sceneOptions(script, { all = true } = {}) {
  const sc = scenesOf(script.items);
  const opts = sc.map((s, i) => ({ value: s.id, label: (s.actTitle && !s.implicit ? s.actTitle + ' · ' : '') + (s.title || t('common.sceneN', { n: i + 1 })) }));
  return all ? [{ value: '', label: t('common.allScenes') }, ...opts] : opts;
}

export function scenePicker(script, value, onChange, { all = true } = {}) {
  return selectEl(sceneOptions(script, { all }), value || '', onChange, { 'aria-label': t('common.scene') });
}

/** Item ids within a scene (or all) */
export function itemsInScene(script, sceneId) {
  if (!sceneId) return script.items;
  const sc = scenesOf(script.items).find((s) => s.id === sceneId);
  return sc ? script.items.slice(sc.start, sc.end + 1) : script.items;
}

export function ratingButtons(onRate) {
  const mk = (val, cls, key, k) => btn(h('span', {}, t('rate.' + key), h('small', {}, k)), () => onRate(val), { cls: 'rate-' + cls });
  const el = h('div', { class: 'rate-grid', role: 'group', 'aria-label': t('rate.label') },
    mk('again', 'again', 'again', '1'), mk('hard', 'hard', 'hard', '2'), mk('good', 'good', 'good', '3'), mk('perfect', 'perfect', 'perfect', '4'));
  return el;
}

/** Keyboard shortcuts helper; returns remover. */
export function keys(map) {
  const fn = (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key === ' ' ? 'Space' : e.key;
    if (map[k]) { e.preventDefault(); map[k](e); }
  };
  document.addEventListener('keydown', fn);
  return () => document.removeEventListener('keydown', fn);
}

// ------------------------------------------------------------------ consent dialogs
export function ensureMicConsent() {
  if (settings.micConsent) return Promise.resolve(true);
  return new Promise((resolve) => {
    modal({
      title: t('privacy.micTitle'),
      body: h('div', {}, h('p', {}, t('privacy.micText1')), h('p', {}, t('privacy.micText2')), h('p', { class: 'muted small' }, t('privacy.micText3'))),
      onClose: (r) => resolve(r === true),
      actions: [
        { label: t('privacy.useManual'), value: false },
        { label: t('privacy.allowMic'), value: true, cls: 'btn-primary', onClick: () => { setSetting('micConsent', true); return true; } },
      ],
    });
  });
}

export function ensureSttConsent() {
  if (!support.stt) return Promise.resolve(false);
  if (settings.sttConsent) return Promise.resolve(true);
  const prov = recognitionProvider();
  return new Promise((resolve) => {
    modal({
      title: t('privacy.sttTitle'),
      body: h('div', {},
        h('p', {}, t('privacy.sttText1')),
        h('div', { class: 'banner warn' }, icon('alert'), h('div', {}, t('privacy.sttProvider.' + prov))),
        h('p', {}, t('privacy.sttText2')),
        h('p', { class: 'muted small' }, t('privacy.micText1'))),
      onClose: (r) => resolve(r === true),
      actions: [
        { label: t('privacy.useManual'), value: false },
        { label: t('privacy.allowStt'), value: true, cls: 'btn-primary', onClick: () => { setSetting('sttConsent', true); setSetting('micConsent', true); return true; } },
      ],
    });
  });
}

export function ensureCloudConsent() {
  if (settings.cloudConsent) return Promise.resolve(true);
  return new Promise((resolve) => {
    modal({
      title: t('privacy.cloudTitle'),
      body: h('div', {}, h('p', {}, t('privacy.cloudText1')), h('p', {}, t('privacy.cloudText2')), h('div', { class: 'banner warn' }, icon('alert'), h('div', {}, t('privacy.cloudCost')))),
      onClose: (r) => resolve(r === true),
      actions: [
        { label: t('common.cancel'), value: false },
        { label: t('privacy.allowCloud'), value: true, cls: 'btn-primary', onClick: () => { setSetting('cloudConsent', true); return true; } },
      ],
    });
  });
}

// ------------------------------------------------------------------ analysis (diff) display
/**
 * Word-level analysis with manual correction. onChange(result) after the user taps a word.
 */
export function analysisView(result, onChange) {
  const wrap = h('div', { class: 'analysis' });
  const render = (r) => {
    wrap.replaceChildren();
    const c = r.counts;
    wrap.appendChild(h('div', { class: 'row between', style: { marginBottom: '8px' } },
      h('div', { class: 'row' },
        h('span', { class: 'chip ' + (r.passed ? 'green' : r.percent >= 60 ? 'orange' : 'red') }, t('analysis.match', { p: r.percent })),
        c.missed ? h('span', { class: 'chip red' }, tn('analysis.missedN', c.missed)) : null,
        c.wrong ? h('span', { class: 'chip red' }, tn('analysis.wrongN', c.wrong)) : null,
        c.extra ? h('span', { class: 'chip orange' }, tn('analysis.extraN', c.extra)) : null,
        c.hints ? h('span', { class: 'chip blue' }, tn('analysis.hintsN', c.hints)) : null)));
    const line = h('div', { class: 'answer-card', style: { background: 'var(--surface-2)' } });
    const text = h('div', { class: 'text' });
    let extraIdx = -1;
    for (const s of r.sequence) {
      if (s.kind === 'extra') {
        extraIdx++;
        const ei = extraIdx;
        text.appendChild(h('span', { class: 'w w-extra', title: t('analysis.tapExtra'), onclick: () => { const nr = dropExtra(r, ei); render(nr); onChange?.(nr); } }, s.text));
        text.appendChild(document.createTextNode(' '));
        continue;
      }
      const tok = r.tokens[s.index];
      const cls = { ok: 'w-ok', near: 'w-near', wrong: 'w-wrong', missed: 'w-missed', hint: 'w-hinted' }[tok.status];
      text.appendChild(h('span', {
        class: 'w ' + cls,
        title: tok.heard ? t('analysis.heard', { w: tok.heard }) : t('analysis.tapToFix'),
        role: 'button', tabindex: '0',
        onclick: () => { const nr = overrideToken(r, tok.index, nextManualStatus(tok.status)); render(nr); onChange?.(nr); },
      }, tok.text));
      text.appendChild(document.createTextNode(' '));
    }
    line.appendChild(text);
    wrap.appendChild(line);
    if (r.problemSpans.length) {
      wrap.appendChild(h('div', { class: 'small', style: { marginTop: '8px' } }, h('strong', {}, t('analysis.repeat') + ': '), r.problemSpans.map((p) => '„' + p.text + '”').join(', ')));
    }
    if (r.transcript) wrap.appendChild(h('div', { class: 'small muted', style: { marginTop: '6px' } }, t(r.source === 'typed' ? 'analysis.typedAll' : 'analysis.heardAll') + ': „' + r.transcript + '”'));
    wrap.appendChild(h('div', { class: 'legend', style: { marginTop: '8px' } },
      h('span', {}, h('i', { class: 'dot', style: { background: 'var(--ok)' } }), t('analysis.legendOk')),
      h('span', {}, h('i', { class: 'dot', style: { background: 'var(--bad)' } }), t('analysis.legendBad')),
      h('span', {}, h('i', { class: 'dot', style: { background: 'var(--warn)' } }), t('analysis.legendExtra')),
      h('span', {}, h('i', { class: 'dot', style: { background: 'var(--info)' } }), t('analysis.legendHint'))));
    wrap.appendChild(h('p', { class: 'hint', style: { marginTop: '6px' } }, t('analysis.disclaimer')));
  };
  render(result);
  return wrap;
}

export function pageIntro(title, text, ...actions) {
  return h('div', { class: 'card hero' }, h('h1', {}, title), text ? h('p', { class: 'text-2' }, text) : null, actions.length ? h('div', { class: 'row' }, actions) : null);
}

export function modeTile(href, iconName, title, desc, burgundy = false) {
  return h('a', { class: 'mode-tile', href }, h('div', { class: 'icon-wrap' + (burgundy ? ' burgundy' : '') }, icon(iconName)), h('strong', {}, title), h('span', {}, desc));
}

export function supportBanner() {
  const issues = [];
  if (!support.tts) issues.push(t('support.noTts'));
  if (!support.stt) issues.push(t('support.noStt'));
  if (!navigator.onLine) issues.push(t('support.offline'));
  return issues.length ? h('div', { class: 'banner info' }, icon('info'), h('div', {}, issues.map((x) => h('div', {}, x)))) : null;
}
