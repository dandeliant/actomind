// ActoMind – rehearsal recordings (microphone), stored locally: record, listen, compare, notes, delete, export.
import { h, btn, iconBtn, toast, confirmDialog, promptDialog, emptyState, selectEl, banner, downloadBlob } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { setHeader } from '../ui/shell.js';
import { t, fmtDateTime } from '../core/i18n.js';
import { myLines } from '../core/store.js';
import { requireScript } from '../ui/common.js';
import { spokenText } from '../core/tokenize.js';
import { listRecordings, updateRecording, deleteRecording, extFor } from '../core/recorder.js';
import { recordWidget, blobAudio } from '../ui/recwidget.js';
import { createZip } from '../core/zip.js';
import { safeFileName, formatClock, formatBytes } from '../core/util.js';

export default async function recordingsView(root) {
  setHeader(t('rec.title'));
  const script = await requireScript(root, { needRoles: false });
  if (!script) return;
  const lines = myLines(script);
  let lineId = lines[0]?.id || '';
  const compare = new Set();
  const listBox = h('div');
  let recW = null;

  const lineSel = selectEl([{ value: '', label: t('rec.free') }, ...lines.map((l, i) => ({ value: l.id, label: `${i + 1}. ${spokenText(l.text).slice(0, 60)}` }))], lineId, (v) => { lineId = v; mountRec(); });
  const recHost = h('div');
  const mountRec = () => {
    recW?.destroy?.();
    recW = recordWidget({ scriptId: script.id, lineId: lineId || null, onSaved: render });
    const line = lines.find((l) => l.id === lineId);
    recHost.replaceChildren(line ? h('div', { class: 'answer-card', style: { marginBottom: '10px' } }, h('div', { class: 'text' }, line.text)) : null, recW);
  };

  root.append(
    h('h1', {}, t('rec.title')),
    banner('ok', 'lock', t('rec.privacy')),
    h('div', { class: 'card' }, h('div', { class: 'label' }, t('rec.forLine')), lineSel, h('div', { style: { height: '10px' } }), recHost),
    h('div', { class: 'row between' },
      h('div', { class: 'section-title' }, t('rec.list')),
      h('div', { class: 'row' },
        btn(t('rec.compare'), playCompare, { cls: 'btn-sm', icon: 'play' }),
        btn(t('rec.exportAll'), exportAll, { cls: 'btn-sm', icon: 'download' }))),
    listBox,
  );

  async function playCompare() {
    const recs = (await listRecordings(script.id)).filter((r) => compare.has(r.id)).sort((a, b) => a.createdAt - b.createdAt);
    if (recs.length < 2) { toast(t('rec.selectTwo')); return; }
    for (const r of recs) {
      const url = URL.createObjectURL(r.blob);
      const a = new Audio(url);
      toast(t('rec.playing', { date: fmtDateTime(r.createdAt) }));
      await new Promise((res) => { a.onended = res; a.onerror = res; a.play().catch(res); });
      URL.revokeObjectURL(url);
      await new Promise((res) => setTimeout(res, 700));
    }
  }

  async function exportAll() {
    const recs = await listRecordings(script.id);
    if (!recs.length) return;
    const files = recs.map((r, i) => ({ name: `${String(i + 1).padStart(3, '0')}_${safeFileName(r.intention || 'nagranie')}_${new Date(r.createdAt).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${extFor(r.mime)}`, data: r.blob, date: new Date(r.createdAt) }));
    files.push({ name: 'notatki.txt', data: recs.map((r, i) => `${i + 1}. ${fmtDateTime(r.createdAt)} ${r.intention ? '[' + r.intention + '] ' : ''}${r.note || ''}\n   ${r.lineId ? spokenText(script.items.find((x) => x.id === r.lineId)?.text || '') : ''}`).join('\n') });
    downloadBlob(await createZip(files), safeFileName(script.title + '_nagrania') + '.zip');
  }

  async function render() {
    const recs = await listRecordings(script.id);
    listBox.replaceChildren();
    if (!recs.length) { listBox.appendChild(emptyState('record', t('rec.none'), t('rec.noneText'))); return; }
    const byLine = new Map();
    recs.forEach((r) => { const k = r.lineId || ''; if (!byLine.has(k)) byLine.set(k, []); byLine.get(k).push(r); });
    for (const [lid, group] of byLine) {
      const line = script.items.find((x) => x.id === lid);
      listBox.appendChild(h('div', { class: 'card' },
        h('h3', { style: { fontFamily: 'var(--font-script)', fontWeight: 400 } }, line ? spokenText(line.text).slice(0, 120) : t('rec.free')),
        h('div', { class: 'list' }, group.map((r, i) => h('div', { class: 'list-item', style: { flexDirection: 'column', alignItems: 'stretch' } },
          h('div', { class: 'row between' },
            h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: compare.has(r.id), onchange: (e) => { if (e.target.checked) compare.add(r.id); else compare.delete(r.id); } }), h('strong', {}, t('rec.take', { n: group.length - i })), r.intention ? h('span', { class: 'chip gold' }, r.intention) : null),
            h('span', { class: 'small muted' }, fmtDateTime(r.createdAt) + ' · ' + formatClock(r.duration) + ' · ' + formatBytes(r.blob.size))),
          blobAudio(r.blob),
          r.note ? h('div', { class: 'small text-2' }, icon('note'), ' ', r.note) : null,
          h('div', { class: 'row' },
            btn(t('rec.note'), async () => { const v = await promptDialog(t('rec.note'), { value: r.note || '', multiline: true }); if (v == null) return; r.note = v; await updateRecording(r); render(); }, { cls: 'btn-sm btn-ghost', icon: 'note' }),
            btn(t('common.download'), () => downloadBlob(r.blob, `${safeFileName(script.title)}_${r.id}.${extFor(r.mime)}`), { cls: 'btn-sm btn-ghost', icon: 'download' }),
            iconBtn('trash', t('common.delete'), async () => { if (await confirmDialog(t('rec.deleteConfirm'), { danger: true })) { await deleteRecording(r.id); render(); } }, 'btn-sm btn-ghost btn-danger')))))));
    }
  }
  mountRec();
  render();
  return () => recW?.destroy?.();
}
