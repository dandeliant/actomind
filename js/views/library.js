// ActoMind – "Moje nagrania": generated audio files stored locally, playable offline.
import { h, btn, iconBtn, confirmDialog, emptyState, linkBtn, shareOrDownload, toast } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { setHeader } from '../ui/shell.js';
import { t, fmtDateTime } from '../core/i18n.js';
import { db } from '../core/db.js';
import { getScript, settings } from '../core/store.js';
import { filePlayer } from '../ui/fileplayer.js';
import { formatClock, formatBytes } from '../core/util.js';
import { createZip } from '../core/zip.js';

export default async function libraryView(root) {
  setHeader(t('library.title'));
  let player = null;
  const playerHost = h('div');
  const listBox = h('div');
  let filter = 'active';

  root.append(
    h('div', { class: 'row between' }, h('h1', { style: { margin: 0 } }, t('library.title')), linkBtn(t('rehearse.studio'), '#/studio', { cls: 'btn-sm', icon: 'headphones' })),
    h('p', { class: 'text-2' }, t('library.intro')),
    playerHost,
    listBox,
  );

  async function render() {
    const all = (await db.all('audioExports')).sort((a, b) => b.createdAt - a.createdAt);
    const list = filter === 'active' && settings.activeScriptId ? all.filter((x) => x.scriptId === settings.activeScriptId) : all;
    listBox.replaceChildren(
      h('div', { class: 'row', style: { margin: '10px 0' } },
        h('button', { type: 'button', class: 'chip', 'aria-pressed': String(filter === 'active'), onclick: () => { filter = 'active'; render(); } }, t('library.thisScript')),
        h('button', { type: 'button', class: 'chip', 'aria-pressed': String(filter === 'all'), onclick: () => { filter = 'all'; render(); } }, t('library.all')),
        list.length > 1 ? btn(t('library.zipAll'), async () => { const z = await createZip(list.map((f) => ({ name: f.name, data: f.blob, date: new Date(f.createdAt) }))); shareOrDownload(z, 'ActoMind_nagrania.zip'); }, { cls: 'btn-sm', icon: 'download' }) : null));
    if (!list.length) { listBox.appendChild(emptyState('wave', t('library.empty'), t('library.emptyText'), linkBtn(t('rehearse.studio'), '#/studio', { cls: 'btn-primary', icon: 'headphones' }))); return; }
    for (const f of list) {
      listBox.appendChild(h('div', { class: 'card flat' },
        h('div', { class: 'row nowrap' },
          h('div', { class: 'icon-wrap', style: { width: '42px', height: '42px', borderRadius: '12px', display: 'grid', placeItems: 'center', background: 'var(--gold-soft)', color: 'var(--gold)', flex: 'none' } }, icon('wave')),
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { style: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, f.name),
            h('div', { class: 'small muted' }, [f.scriptTitle, f.roleNames, t('studio.variant.' + f.kind), f.rangeLabel].filter(Boolean).join(' · ')),
            h('div', { class: 'small muted' }, fmtDateTime(f.createdAt) + ' · ' + formatClock(f.duration) + ' · ' + f.format.toUpperCase() + ' · ' + formatBytes(f.size)))),
        h('div', { class: 'row', style: { marginTop: '10px' } },
          btn(t('library.play'), async () => {
            player?.destroy();
            const script = await getScript(f.scriptId);
            player = filePlayer(f, script);
            playerHost.replaceChildren(h('div', { class: 'card accent' }, h('div', { class: 'card-title' }, h('h3', {}, f.name), iconBtn('x', t('common.close'), () => { player.destroy(); player = null; playerHost.replaceChildren(); }, 'btn-sm btn-ghost')), player.el));
            playerHost.scrollIntoView({ behavior: 'smooth' });
            player.audio.play().catch(() => {});
          }, { cls: 'btn-sm btn-primary', icon: 'play' }),
          btn(t('common.download'), () => shareOrDownload(f.blob, f.name), { cls: 'btn-sm', icon: 'download' }),
          iconBtn('trash', t('common.delete'), async () => {
            if (!(await confirmDialog(t('library.deleteConfirm', { name: f.name }), { danger: true }))) return;
            await db.delete('audioExports', f.id);
            toast(t('library.deleted'));
            render();
          }, 'btn-sm btn-ghost btn-danger'))));
    }
  }
  await render();
  return () => player?.destroy();
}
