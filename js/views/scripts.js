// ActoMind – "Moje scenariusze" list
import { h, btn, linkBtn, confirmDialog, emptyState, statusBar, toast, segmented } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { setHeader, navigate } from '../ui/shell.js';
import { t, tn, fmtDate } from '../core/i18n.js';
import { listScripts, getProgress, roleStats, saveScript, deleteScript, setActiveScript, settings, charById } from '../core/store.js';

export default async function scriptsView(root, params, query) {
  setHeader(t('scripts.title'));
  let tab = query.tab === 'archived' ? 'archived' : 'active';
  const listWrap = h('div', { class: 'list' });
  root.append(
    h('div', { class: 'row between', style: { marginBottom: '14px' } },
      h('h1', { style: { margin: 0 } }, t('scripts.title')),
      h('div', { class: 'row' },
        linkBtn(t('scripts.import'), '#/import', { cls: 'btn-primary', icon: 'upload' }))),
    segmented([{ value: 'active', label: t('scripts.active') }, { value: 'archived', label: t('scripts.archived') }], tab, (v) => { tab = v; render(); }),
    h('div', { style: { height: '14px' } }),
    listWrap,
  );

  async function render() {
    const list = await listScripts({ archived: tab === 'archived' });
    listWrap.replaceChildren();
    if (!list.length) {
      listWrap.appendChild(tab === 'archived'
        ? emptyState('archive', t('scripts.noArchived'), '')
        : emptyState('script', t('empty.noScriptTitle'), t('empty.noScriptText'), linkBtn(t('scripts.import'), '#/import', { cls: 'btn-primary', icon: 'upload' })));
      return;
    }
    for (const s of list) {
      const p = await getProgress(s.id);
      const st = roleStats(s, p);
      const lines = s.items.filter((i) => i.type === 'line').length;
      const roles = s.myRoles.map((id) => charById(s, id)?.name).filter(Boolean).join(', ');
      const isActive = settings.activeScriptId === s.id;
      listWrap.appendChild(h('div', { class: 'card flat' + (isActive ? ' accent' : '') },
        h('div', { class: 'row nowrap' },
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('h3', { style: { margin: 0 } }, s.title, isActive ? h('span', { class: 'chip gold', style: { marginLeft: '8px', verticalAlign: 'middle' } }, t('scripts.current')) : null),
            h('div', { class: 'small muted' },
              tn('common.charactersN', s.characters.length), ' · ', tn('common.linesN', lines),
              roles ? [' · ', t('common.myRole') + ': ', h('span', { class: 'gold' }, roles)] : '',
              s.premiereAt ? [' · ', t('dash.premiere') + ': ' + fmtDate(s.premiereAt)] : '')),
          h('div', { class: 'stat-value', style: { fontSize: '1.4rem' } }, st.total ? st.masteryPct + '%' : '—')),
        st.total ? h('div', { style: { margin: '10px 0' } }, statusBar(st, st.total)) : null,
        h('div', { class: 'row', style: { marginTop: '10px' } },
          btn(t('scripts.open'), async () => { await setActiveScript(s.id); navigate('#/script/' + s.id); }, { cls: 'btn-sm btn-primary', icon: 'script' }),
          btn(t('scripts.learn'), async () => { await setActiveScript(s.id); navigate(s.myRoles.length ? '#/learn' : `#/script/${s.id}/roles`); }, { cls: 'btn-sm', icon: 'brain' }),
          h('span', { class: 'spacer' }),
          btn(s.archived ? t('scripts.unarchive') : t('scripts.archive'), async () => {
            s.archived = !s.archived;
            await saveScript(s);
            toast(s.archived ? t('scripts.archivedToast') : t('scripts.unarchivedToast'));
            render();
          }, { cls: 'btn-sm btn-ghost', icon: 'archive' }),
          btn(t('common.delete'), async () => {
            if (await confirmDialog(t('scripts.deleteConfirm', { title: s.title }), { danger: true, ok: t('common.delete') })) {
              await deleteScript(s.id);
              toast(t('scripts.deleted'));
              render();
            }
          }, { cls: 'btn-sm btn-ghost btn-danger', icon: 'trash' }))));
    }
  }
  await render();
}
