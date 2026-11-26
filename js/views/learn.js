// ActoMind – learning hub
import { h, linkBtn } from '../ui/dom.js';
import { setHeader } from '../ui/shell.js';
import { t, tn } from '../core/i18n.js';
import { getProgress, roleStats, charById } from '../core/store.js';
import { requireScript, modeTile, supportBanner } from '../ui/common.js';

export default async function learnView(root) {
  setHeader(t('learn.title'));
  const script = await requireScript(root);
  if (!script) return;
  const st = roleStats(script, await getProgress(script.id));
  const roles = script.myRoles.map((id) => charById(script, id)?.name).join(', ');
  root.append(
    h('div', { class: 'row between', style: { marginBottom: '12px' } },
      h('div', {}, h('h1', { style: { margin: 0 } }, t('learn.title')), h('div', { class: 'small muted' }, script.title + ' · ' + roles)),
      linkBtn(t('learn.premiereBtn'), '#/learn/premiere', { cls: 'btn-accent', icon: 'rocket' })),
    supportBanner(),
    h('div', { class: 'section-title' }, t('learn.recall')),
    h('div', { class: 'grid grid-auto' },
      modeTile('#/learn/train/review', 'brain', t('modes.review.title') + (st.due ? ` (${st.due})` : ''), t('modes.review.desc')),
      modeTile('#/learn/train/letters', 'letters', t('modes.firstletters.title'), t('modes.firstletters.desc')),
      modeTile('#/learn/train/vanish', 'vanish', t('modes.vanishing.title'), t('modes.vanishing.desc')),
      modeTile('#/learn/train/cards', 'cards', t('modes.cards.title'), t('modes.cards.desc')),
      modeTile('#/learn/train/cues', 'shuffle', t('modes.cues.title'), t('modes.cues.desc')),
      modeTile('#/learn/train/hardest', 'flame', t('modes.hardest.title') + (st.hard ? ` (${st.hard})` : ''), t('modes.hardest.desc'), true)),
    h('div', { class: 'section-title' }, t('learn.understand')),
    h('div', { class: 'grid grid-auto' },
      modeTile('#/learn/read', 'book', t('modes.understand.title'), t('modes.understand.desc')),
      modeTile('#/learn/listen', 'headphones', t('modes.listen.title'), t('modes.listen.desc')),
      modeTile('#/learn/chunks', 'split', t('modes.chunks.title'), t('modes.chunks.desc')),
      modeTile('#/learn/exercises', 'puzzle', t('modes.exercises.title'), t('modes.exercises.desc')),
      modeTile('#/learn/mentor', 'feather', t('modes.mentor.title'), t('modes.mentor.desc'), true)),
    h('p', { class: 'hint', style: { marginTop: '14px' } }, tn('learn.statusLine', st.total, { mastered: st.mastered, hard: st.hard })),
  );
}
