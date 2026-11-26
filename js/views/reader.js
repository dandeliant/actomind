// ActoMind – theatrical reading mode with notes, difficult marks, keywords, auto-scroll, print/export of the role.
import { h, btn, iconBtn, segmented, rangeEl, switchEl, toast, promptDialog, downloadBlob } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { setHeader } from '../ui/shell.js';
import { t } from '../core/i18n.js';
import { settings, setSetting, getProgress, setFlagged, saveScriptSoon, charById, SessionTracker, bumpTotal } from '../core/store.js';
import { requireScript, whoLabel, lineTextEl, scenePicker } from '../ui/common.js';
import { cueFor, scenesOf } from '../core/parser.js';
import { safeFileName } from '../core/util.js';
import { spokenText } from '../core/tokenize.js';

export function roleText(script) {
  const mine = new Set(script.myRoles);
  const names = script.myRoles.map((id) => charById(script, id)?.name).join(', ');
  const out = [script.title.toUpperCase(), (script.lang === 'en' ? 'Role: ' : 'Rola: ') + names, ''];
  script.items.forEach((it, idx) => {
    if (it.type === 'scene' || it.type === 'act') { out.push('', it.text, ''); return; }
    if (it.type !== 'line' || !mine.has(it.charId)) return;
    const cue = cueFor(script.items, idx);
    if (cue.kind === 'line' && !mine.has(cue.item.charId)) {
      const words = spokenText(cue.item.text).split(/\s+/);
      out.push(`   …${charById(script, cue.item.charId)?.name || ''}: ${words.length > 8 ? '… ' + words.slice(-8).join(' ') : words.join(' ')}`);
    }
    const c = charById(script, it.charId);
    out.push(`${c?.name.toUpperCase()}${it.parenthetical ? ' (' + it.parenthetical + ')' : ''}: ${it.text}`);
    const note = script.notes[it.id]?.note;
    if (note) out.push('   [' + note + ']');
    out.push('');
  });
  return out.join('\n');
}

export default async function readerView(root, params, query) {
  setHeader(t('reader.title'));
  const script = await requireScript(root, { needRoles: false });
  if (!script) return;
  const tracker = new SessionTracker(script.id, 'read');
  const progress = await getProgress(script.id);
  const opts = { ...settings.reader };
  if (query.print) opts.onlyMine = true;
  let kwMode = false;
  let scrollTimer = null;
  const mine = new Set(script.myRoles);
  const view = h('div', { class: 'script card', style: { padding: '18px 14px' } });

  const saveOpts = () => setSetting('reader', { ...opts });
  const toolbar = h('div', { class: 'card no-print' },
    h('div', { class: 'row', style: { marginBottom: '8px' } },
      scenePicker(script, '', (id) => {
        const el = id ? view.querySelector(`[data-id="${id}"]`) : view.firstChild;
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }),
      iconBtn('minus', t('reader.smaller'), () => { setSetting('scriptSize', Math.max(13, settings.scriptSize - 1)); }, 'btn-sm'),
      iconBtn('plus', t('reader.larger'), () => { setSetting('scriptSize', Math.min(34, settings.scriptSize + 1)); }, 'btn-sm'),
      btn(t('reader.keywords'), (e) => { kwMode = !kwMode; e.currentTarget.setAttribute('aria-pressed', String(kwMode)); view.classList.toggle('kw-mode', kwMode); toast(kwMode ? t('reader.kwOn') : t('reader.kwOff')); }, { cls: 'btn-sm', icon: 'edit', pressed: false }),
      btn(t('reader.export'), () => downloadBlob(new Blob([roleText(script)], { type: 'text/plain;charset=utf-8' }), safeFileName(script.title + '_rola') + '.txt'), { cls: 'btn-sm', icon: 'download', disabled: !mine.size }),
      btn(t('reader.print'), () => window.print(), { cls: 'btn-sm', icon: 'file' })),
    h('div', { class: 'grid grid-2 stack-sm' },
      h('div', {},
        switchEl(t('reader.hideOthers'), opts.hideOthers, (v) => { opts.hideOthers = v; saveOpts(); render(); }),
        switchEl(t('reader.onlyMine'), opts.onlyMine, (v) => { opts.onlyMine = v; saveOpts(); render(); }),
        switchEl(t('reader.hideDirections'), opts.hideDirections, (v) => { opts.hideDirections = v; saveOpts(); render(); })),
      h('div', {},
        h('div', { class: 'label' }, t('reader.lineHeight')),
        rangeEl({ min: 1.2, max: 2.4, step: 0.05, value: settings.scriptLineHeight, format: (x) => x.toFixed(2), onChange: (x) => setSetting('scriptLineHeight', x) }),
        h('div', { class: 'label', style: { marginTop: '6px' } }, t('reader.autoScroll')),
        segmented([{ value: 0, label: t('reader.off') }, { value: 1, label: '1×' }, { value: 2, label: '2×' }, { value: 3, label: '3×' }], opts.autoScroll || 0, (v) => { opts.autoScroll = v; saveOpts(); autoScroll(); }))),
    mine.size ? null : h('p', { class: 'small muted' }, t('reader.noRoleHint')),
  );
  root.append(toolbar, view);

  function render() {
    view.replaceChildren();
    const scenes = scenesOf(script.items);
    const sceneStarts = new Set(scenes.filter((s) => s.implicit).map((s) => s.start));
    script.items.forEach((it, idx) => {
      if (sceneStarts.has(idx) && scenes.length > 1) view.appendChild(h('span', { 'data-id': '__start_' + (scenes.find((s) => s.start === idx)?.actId || 'root') }));
      if (it.type === 'act' || it.type === 'scene') { view.appendChild(h('div', { class: 'heading ' + it.type, 'data-id': it.id }, it.text)); return; }
      if (it.type === 'direction') {
        if (opts.hideDirections || opts.onlyMine) return;
        view.appendChild(h('div', { class: 'direction', 'data-id': it.id }, it.text));
        return;
      }
      const isMine = mine.has(it.charId);
      if (opts.onlyMine && !isMine) return;
      const rec = progress.records[it.id];
      const note = script.notes[it.id] || {};
      const kw = new Set(note.keywords || []);
      const collapsed = opts.hideOthers && !isMine;
      const lineEl = h('div', {
        class: 'line' + (isMine ? ' mine' : '') + (rec?.flagged ? ' difficult' : '') + (collapsed ? ' collapsed' : ''),
        'data-id': it.id, id: 'line-' + it.id,
      });
      lineEl.appendChild(whoLabel(script, it));
      const text = opts.hideDirections ? spokenText(it.text) : it.text;
      if (collapsed) {
        lineEl.appendChild(h('div', { class: 'text', role: 'button', tabindex: '0', title: t('reader.tapToShow'), onclick: (e) => { e.currentTarget.replaceWith(lineTextEl(text)); } }, '…'));
      } else {
        lineEl.appendChild(lineTextEl(text, {
          keywords: kw,
          onWord: isMine ? (wi, span) => {
            if (!kwMode) return;
            note.keywords = kw.has(wi) ? [...kw].filter((x) => x !== wi) : [...kw, wi];
            if (kw.has(wi)) kw.delete(wi); else kw.add(wi);
            span.classList.toggle('kw', kw.has(wi));
            script.notes[it.id] = note;
            saveScriptSoon(script);
          } : null,
        }));
      }
      if (isMine && note.note) lineEl.appendChild(h('div', { class: 'note-box' }, icon('note'), ' ', note.note));
      if (isMine) {
        lineEl.appendChild(h('div', { class: 'line-tools no-print hide-eyes-free' },
          btn(rec?.flagged ? t('reader.unflag') : t('reader.flag'), async () => { await setFlagged(script, it.id, !rec?.flagged); render(); }, { cls: 'btn-sm btn-ghost', icon: 'flag' }),
          btn(t('reader.note'), async () => {
            const v = await promptDialog(t('reader.noteTitle'), { value: note.note || '', multiline: true });
            if (v == null) return;
            const first = !note.note && v.trim();
            note.note = v.trim();
            script.notes[it.id] = note;
            saveScriptSoon(script);
            if (first) bumpTotal('mentorNotes');
            render();
          }, { cls: 'btn-sm btn-ghost', icon: 'note' }),
          h('a', { class: 'btn btn-sm btn-ghost', href: `#/rehearse/partner?from=${it.id}` }, icon('masks'), h('span', {}, t('reader.rehearseFrom')))));
      }
      view.appendChild(lineEl);
    });
    if (!view.children.length) view.appendChild(h('p', { class: 'muted center' }, t('reader.nothing')));
  }

  function autoScroll() {
    clearInterval(scrollTimer);
    if (!opts.autoScroll) return;
    scrollTimer = setInterval(() => { window.scrollBy(0, opts.autoScroll); tracker.activity(); }, 50);
  }

  render();
  autoScroll();
  if (query.from) setTimeout(() => document.getElementById('line-' + query.from)?.scrollIntoView({ block: 'center' }), 80);
  if (query.print) setTimeout(() => window.print(), 400);
  return () => { clearInterval(scrollTimer); tracker.stop(); };
}
