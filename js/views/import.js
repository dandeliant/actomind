// ActoMind – import a script: paste, TXT/DOCX/PDF file, manual creation or demo.
import { h, btn, field, segmented, toast, banner, selectEl } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { setHeader, navigate } from '../ui/shell.js';
import { t, tn } from '../core/i18n.js';
import { parseScript } from '../core/parser.js';
import { fileToText } from '../core/importers.js';
import { createScriptFromText, createEmptyScript, settings, importBackup, saveScript } from '../core/store.js';
import { DEMO_PL, DEMO_EN } from '../core/demo.js';

export default async function importView(root) {
  setHeader(t('import.title'));
  let tab = 'paste';
  const body = h('div');
  root.append(
    h('h1', {}, t('import.title')),
    h('p', { class: 'text-2' }, t('import.intro')),
    segmented([
      { value: 'paste', label: t('import.tabPaste') },
      { value: 'file', label: t('import.tabFile') },
      { value: 'manual', label: t('import.tabManual') },
      { value: 'demo', label: t('import.tabDemo') },
    ], tab, (v) => { tab = v; render(); }, t('import.title')),
    h('div', { style: { height: '14px' } }),
    body,
  );

  const state = { text: '', title: '', lang: settings.lang };

  function preview(text) {
    const box = h('div');
    if (!text.trim()) return box;
    const p = parseScript(text);
    const lines = p.items.filter((i) => i.type === 'line');
    const counts = new Map();
    lines.forEach((l) => counts.set(l.charId, (counts.get(l.charId) || 0) + 1));
    box.append(
      h('div', { class: 'section-title' }, t('import.detected')),
      h('div', { class: 'row', style: { marginBottom: '8px' } },
        h('span', { class: 'chip gold' }, tn('common.charactersN', p.characters.length)),
        h('span', { class: 'chip' }, tn('common.linesN', lines.length)),
        h('span', { class: 'chip' }, tn('import.scenesN', p.items.filter((i) => i.type === 'scene').length)),
        h('span', { class: 'chip' }, tn('import.directionsN', p.items.filter((i) => i.type === 'direction').length))),
      h('div', { class: 'row' }, p.characters.map((c) => h('span', { class: 'chip' }, h('span', { class: 'dot', style: { background: c.color } }), c.name, ' · ', counts.get(c.id) || 0))),
      p.characters.length ? null : banner('warn', 'alert', t('import.noCharacters')),
    );
    if (!state.title && p.title) state.title = p.title;
    return box;
  }

  function langSelect() {
    return selectEl([{ value: 'pl', label: 'Polski' }, { value: 'en', label: 'English' }], state.lang, (v) => { state.lang = v; });
  }

  async function save() {
    if (!state.text.trim()) { toast(t('import.emptyText'), { type: 'error' }); return; }
    const s = await createScriptFromText(state.text, { title: state.title.trim(), lang: state.lang });
    toast(t('import.saved'), { type: 'success' });
    navigate(`#/script/${s.id}/edit?fresh=1`);
  }

  function render() {
    body.replaceChildren();
    if (tab === 'paste') {
      const prev = h('div');
      const ta = h('textarea', { class: 'script-input', placeholder: t('import.placeholder'), spellcheck: 'false' });
      ta.value = state.text;
      const upd = () => { prev.replaceChildren(preview(state.text)); titleIn.value = state.title; };
      let tmr = null;
      ta.addEventListener('input', () => { state.text = ta.value; clearTimeout(tmr); tmr = setTimeout(upd, 350); });
      const titleIn = h('input', { type: 'text', value: state.title, placeholder: t('import.titlePh'), oninput: (e) => { state.title = e.target.value; } });
      body.append(h('div', { class: 'card' },
        h('div', { class: 'grid grid-2 stack-sm' }, field(t('import.scriptTitle'), titleIn), field(t('import.language'), langSelect())),
        field(t('import.text'), ta, t('import.formatsHint')),
        prev,
        h('div', { class: 'row end', style: { marginTop: '12px' } }, btn(t('import.recognize'), save, { cls: 'btn-primary btn-lg', icon: 'sparkles' }))));
      upd();
    } else if (tab === 'file') {
      const status = h('div');
      const input = h('input', {
        type: 'file',
        accept: '.txt,.docx,.pdf,.json,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/json',
        class: 'sr-only', id: 'import-file',
      });
      const drop = h('label', { for: 'import-file', class: 'card flat', style: { display: 'block', textAlign: 'center', borderStyle: 'dashed', cursor: 'pointer', padding: '34px 16px' } },
        icon('upload'), h('h3', { style: { marginTop: '8px' } }, t('import.chooseFile')), h('p', { class: 'muted' }, t('import.fileTypes')));
      const handle = async (file) => {
        if (!file) return;
        status.replaceChildren(banner('info', 'clock', t('import.reading', { name: file.name })));
        try {
          if (/\.json$/i.test(file.name)) {
            const data = JSON.parse(await file.text());
            const n = await importBackup(data);
            toast(tn('import.backupRestored', n), { type: 'success' });
            navigate('#/scripts');
            return;
          }
          const text = await fileToText(file, (p) => status.replaceChildren(banner('info', 'clock', t('import.readingPdf', { p: Math.round(p * 100) }))));
          state.text = text;
          state.title = file.name.replace(/\.(txt|docx|pdf)$/i, '');
          tab = 'paste';
          render();
          toast(t('import.fileLoaded'), { type: 'success' });
        } catch (e) {
          console.error(e);
          status.replaceChildren(banner('bad', 'alert', e.code === 'PDF_NO_TEXT' ? t('import.pdfNoText') : t('import.fileError', { msg: e.message })));
        }
      };
      input.addEventListener('change', () => handle(input.files[0]));
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.style.borderColor = 'var(--gold)'; });
      drop.addEventListener('dragleave', () => { drop.style.borderColor = ''; });
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.style.borderColor = ''; handle(e.dataTransfer.files[0]); });
      body.append(input, drop, status, h('p', { class: 'hint' }, t('import.fileOffline')));
    } else if (tab === 'manual') {
      const titleIn = h('input', { type: 'text', placeholder: t('import.titlePh') });
      const charsIn = h('textarea', { placeholder: t('import.charactersPh'), style: { minHeight: '90px' } });
      body.append(h('div', { class: 'card' },
        field(t('import.scriptTitle'), titleIn),
        field(t('import.language'), langSelect()),
        field(t('import.characters'), charsIn, t('import.charactersHint')),
        h('div', { class: 'row end' }, btn(t('import.createEmpty'), async () => {
          const s = await createEmptyScript(titleIn.value.trim() || t('import.untitled'), state.lang);
          const names = charsIn.value.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
          const { addCharacter } = await import('../core/store.js');
          names.forEach((n) => addCharacter(s, n));
          await saveScript(s);
          navigate(`#/script/${s.id}/edit?fresh=1`);
        }, { cls: 'btn-primary', icon: 'plus' }))));
    } else {
      const demo = (d) => h('div', { class: 'card flat' },
        h('h3', {}, d.title),
        h('p', { class: 'muted' }, d.lang === 'pl' ? t('import.demoDescPl') : t('import.demoDescEn')),
        btn(t('import.loadDemo'), async () => {
          const s = await createScriptFromText(d.text, { title: d.title, lang: d.lang });
          toast(t('import.demoLoaded'), { type: 'success' });
          navigate(`#/script/${s.id}/edit?fresh=1`);
        }, { cls: 'btn-primary', icon: 'sparkles' }));
      body.append(demo(settings.lang === 'en' ? DEMO_EN : DEMO_PL), demo(settings.lang === 'en' ? DEMO_PL : DEMO_EN));
    }
  }
  render();
}
