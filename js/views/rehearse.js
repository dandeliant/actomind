// ActoMind – rehearsal hub
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { setHeader } from '../ui/shell.js';
import { t, fmtDateTime } from '../core/i18n.js';
import { listRehearsals } from '../core/store.js';
import { requireScript, modeTile, supportBanner } from '../ui/common.js';

export default async function rehearseView(root) {
  setHeader(t('rehearse.title'));
  const script = await requireScript(root);
  if (!script) return;
  const reports = await listRehearsals(script.id);
  root.append(
    h('h1', {}, t('rehearse.title')),
    supportBanner(),
    h('div', { class: 'grid grid-auto' },
      modeTile('#/rehearse/partner', 'masks', t('rehearse.partner'), t('rehearse.partnerDesc')),
      modeTile('#/rehearse/dress', 'curtain', t('rehearse.dress'), t('rehearse.dressDesc'), true),
      modeTile('#/studio', 'headphones', t('rehearse.studio'), t('rehearse.studioDesc')),
      modeTile('#/library', 'wave', t('rehearse.library'), t('rehearse.libraryDesc')),
      modeTile('#/rehearse/recordings', 'record', t('rehearse.recordings'), t('rehearse.recordingsDesc'), true),
      modeTile('#/learn/listen', 'volume', t('modes.listen.title'), t('modes.listen.desc'))),
    h('div', { class: 'section-title' }, t('rehearse.history')),
    reports.length
      ? h('div', { class: 'list' }, reports.slice(0, 15).map((r) => h('a', { class: 'list-item', href: '#/rehearse/report/' + r.id },
        icon(r.kind === 'dress' ? 'curtain' : 'masks'),
        h('div', { class: 'grow' }, h('div', { class: 'title' }, (r.kind === 'dress' ? t('rehearse.dress') : t('rehearse.partner')) + ' · ' + Math.round(r.accuracy * 100) + '%'), h('div', { class: 'sub' }, fmtDateTime(r.date) + ' · ' + t('report.hints') + ': ' + r.hints)),
        icon('right'))))
      : h('p', { class: 'muted' }, t('rehearse.noHistory')),
  );
}
