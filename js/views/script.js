// ActoMind – script overview: structure, roles, premiere date, exports, reset, archive.
import { h, btn, linkBtn, field, toast, confirmDialog, statusBar, statBox, modal, selectEl, downloadBlob } from '../ui/dom.js';
import { setHeader, navigate } from '../ui/shell.js';
import { t, tn, fmtDateTime } from '../core/i18n.js';
import { getScript, saveScript, setActiveScript, getProgress, roleStats, resetRoleProgress, deleteScript, charById, scriptTime, listRehearsals } from '../core/store.js';
import { scenesOf, itemsToText } from '../core/parser.js';
import { formatDuration, safeFileName } from '../core/util.js';
import { roleText } from './reader.js';

export default async function scriptView(root, params) {
  const script = await getScript(params.id);
  if (!script) { navigate('#/scripts'); return; }
  await setActiveScript(script.id);
  setHeader(script.title);
  const p = await getProgress(script.id);
  const st = roleStats(script, p);
  const lines = script.items.filter((i) => i.type === 'line');
  const scenes = scenesOf(script.items);
  const time = await scriptTime(script.id);
  const rehearsals = await listRehearsals(script.id);
  const counts = new Map();
  lines.forEach((l) => counts.set(l.charId, (counts.get(l.charId) || 0) + 1));

  const titleIn = h('input', { type: 'text', value: script.title, 'aria-label': t('import.scriptTitle') });
  titleIn.addEventListener('change', async () => { script.title = titleIn.value.trim() || script.title; await saveScript(script); setHeader(script.title); toast(t('common.saved')); });
  const premIn = h('input', { type: 'datetime-local', value: script.premiereAt ? toLocalInput(script.premiereAt) : '' });
  premIn.addEventListener('change', async () => { script.premiereAt = premIn.value ? new Date(premIn.value).getTime() : null; await saveScript(script); toast(t('common.saved')); });

  root.append(
    h('div', { class: 'card hero' },
      field(t('import.scriptTitle'), titleIn),
      h('div', { class: 'row' },
        h('span', { class: 'chip' }, tn('common.charactersN', script.characters.length)),
        h('span', { class: 'chip' }, tn('common.linesN', lines.length)),
        h('span', { class: 'chip' }, tn('import.scenesN', scenes.length)),
        h('span', { class: 'chip' }, script.lang === 'en' ? 'English' : 'Polski')),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        linkBtn(t('script.editStructure'), `#/script/${script.id}/edit`, { cls: 'btn-sm', icon: 'edit' }),
        linkBtn(t('script.rolesVoices'), `#/script/${script.id}/roles`, { cls: 'btn-sm', icon: 'users' }),
        linkBtn(t('script.read'), '#/learn/read', { cls: 'btn-sm', icon: 'book' }),
        linkBtn(t('nav.learn'), script.myRoles.length ? '#/learn' : `#/script/${script.id}/roles`, { cls: 'btn-sm btn-primary', icon: 'brain' }))),
    h('div', { class: 'section-title' }, t('script.myRole')),
    script.myRoles.length
      ? h('div', { class: 'card' },
        h('div', { class: 'row', style: { marginBottom: '10px' } }, script.myRoles.map((id) => h('span', { class: 'chip gold' }, h('span', { class: 'dot', style: { background: charById(script, id)?.color } }), charById(script, id)?.name))),
        h('div', { class: 'grid grid-4' },
          statBox(st.masteryPct + '%', t('dash.mastery')),
          statBox(st.mastered + '/' + st.total, t('dash.mastered'), 'var(--ok)'),
          statBox(st.hard, t('dash.hard'), 'var(--bad)'),
          statBox(formatDuration(time), t('dash.time'))),
        h('div', { style: { marginTop: '12px' } }, statusBar(st, st.total)),
        h('div', { class: 'small muted', style: { marginTop: '8px' } }, tn('script.rehearsalsN', rehearsals.length)))
      : h('div', { class: 'card flat' }, h('p', {}, t('empty.noRoleText', { title: script.title })), linkBtn(t('roles.choose'), `#/script/${script.id}/roles`, { cls: 'btn-primary', icon: 'user' })),
    h('div', { class: 'section-title' }, t('script.premiere')),
    h('div', { class: 'card' }, field(t('script.premiereDate'), premIn, t('script.premiereHint')), linkBtn(t('premiere.open'), '#/learn/premiere', { cls: 'btn-sm', icon: 'rocket' })),
    h('div', { class: 'section-title' }, t('script.characters')),
    h('div', { class: 'card' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, t('editor.charName')), h('th', {}, t('common.lines')), h('th', {}, ''))),
      h('tbody', {}, script.characters.map((c) => h('tr', {},
        h('td', {}, h('span', { class: 'dot', style: { background: c.color, marginRight: '8px' } }), c.name, script.myRoles.includes(c.id) ? h('span', { class: 'tag-mine', style: { marginLeft: '8px' } }, t('common.myRole')) : null),
        h('td', {}, counts.get(c.id) || 0),
        h('td', {}, script.myRoles.includes(c.id) ? btn(t('script.resetRole'), async () => {
          if (await confirmDialog(t('script.resetConfirm', { name: c.name }), { danger: true })) {
            await resetRoleProgress(script, c.id);
            toast(t('script.resetDone'));
            navigate('#/script/' + script.id);
          }
        }, { cls: 'btn-sm btn-ghost btn-danger', icon: 'refresh' }) : null)))))),
    h('div', { class: 'section-title' }, t('script.exportTitle')),
    h('div', { class: 'card row' },
      btn(t('script.exportRole'), () => exportRole(script), { cls: 'btn-sm', icon: 'download', disabled: !script.myRoles.length }),
      btn(t('script.printRole'), () => navigate('#/learn/read?print=1'), { cls: 'btn-sm', icon: 'file', disabled: !script.myRoles.length }),
      btn(t('script.exportText'), () => downloadBlob(new Blob([itemsToText(script)], { type: 'text/plain;charset=utf-8' }), safeFileName(script.title) + '.txt'), { cls: 'btn-sm', icon: 'download' }),
      btn(t('script.exportJson'), () => downloadBlob(new Blob([JSON.stringify({ app: 'ActoMind', version: 1, scripts: [script], progress: [p] }, null, 2)], { type: 'application/json' }), safeFileName(script.title) + '.actomind.json'), { cls: 'btn-sm', icon: 'download' }),
      linkBtn(t('rehearse.studio'), '#/studio', { cls: 'btn-sm', icon: 'headphones' })),
    h('div', { class: 'section-title' }, t('script.manage')),
    h('div', { class: 'card row' },
      btn(script.archived ? t('scripts.unarchive') : t('scripts.archive'), async () => { script.archived = !script.archived; await saveScript(script); toast(script.archived ? t('scripts.archivedToast') : t('scripts.unarchivedToast')); navigate('#/scripts'); }, { cls: 'btn-sm', icon: 'archive' }),
      btn(t('common.delete'), async () => {
        if (await confirmDialog(t('scripts.deleteConfirm', { title: script.title }), { danger: true, ok: t('common.delete') })) {
          await deleteScript(script.id);
          navigate('#/scripts');
        }
      }, { cls: 'btn-sm btn-danger', icon: 'trash' }),
      h('span', { class: 'small muted' }, t('script.updated') + ': ' + fmtDateTime(script.updatedAt))),
  );
}

function exportRole(script) {
  const txt = roleText(script);
  downloadBlob(new Blob([txt], { type: 'text/plain;charset=utf-8' }), safeFileName(script.title + '_' + script.myRoles.map((id) => charById(script, id)?.name).join('_')) + '.txt');
}

function toLocalInput(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export { toLocalInput };
