// ActoMind – choose own role(s); other characters become virtual partners with their own voices.
import { h, switchEl, linkBtn, banner, toast } from '../ui/dom.js';
import { setHeader, navigate } from '../ui/shell.js';
import { t, tn } from '../core/i18n.js';
import { getScript, saveScript, setActiveScript } from '../core/store.js';
import { voiceCard, loadWebVoices } from '../ui/voicecast.js';
import { onVoicesChanged, support } from '../core/speech.js';

export default async function rolesView(root, params) {
  const script = await getScript(params.id);
  if (!script) { navigate('#/scripts'); return; }
  await setActiveScript(script.id);
  setHeader(t('roles.title'));
  let webVoices = await loadWebVoices();
  const counts = new Map();
  script.items.forEach((i) => { if (i.type === 'line') counts.set(i.charId, (counts.get(i.charId) || 0) + 1); });
  const list = h('div');
  const nextBtn = linkBtn(t('roles.startLearning'), '#/learn', { cls: 'btn-primary btn-lg', icon: 'brain' });

  root.append(
    h('h1', {}, t('roles.title')),
    h('p', { class: 'text-2' }, t('roles.intro')),
    support.tts ? null : banner('warn', 'alert', t('support.noTts')),
    list,
    h('div', { class: 'card flat' }, h('h3', {}, t('roles.directionsTitle')), h('p', { class: 'small muted' }, t('roles.directionsText')), voiceCard(script, '__dir', { webVoices, title: t('studio.directionsVoice') })),
    h('div', { class: 'row', style: { justifyContent: 'space-between', marginTop: '16px' } },
      linkBtn(t('roles.studio'), '#/studio', { cls: '', icon: 'headphones' }),
      nextBtn),
  );

  function render() {
    list.replaceChildren();
    if (!script.characters.length) {
      list.appendChild(banner('warn', 'alert', t('roles.noCharacters'), ' ', h('a', { href: `#/script/${script.id}/edit` }, t('roles.openEditor'))));
    }
    const sorted = [...script.characters].sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0));
    for (const c of sorted) {
      const mine = script.myRoles.includes(c.id);
      const toggle = switchEl(h('span', {}, h('strong', {}, t('roles.thisIsMe')), ' ', h('span', { class: 'muted small' }, tn('common.linesN', counts.get(c.id) || 0))), mine, async (on) => {
        script.myRoles = on ? [...new Set([...script.myRoles, c.id])] : script.myRoles.filter((x) => x !== c.id);
        await saveScript(script);
        toast(on ? t('roles.added', { name: c.name }) : t('roles.removed', { name: c.name }));
        render();
      });
      list.appendChild(h('div', { class: 'card flat' + (mine ? ' accent' : ''), style: mine ? { background: 'var(--gold-soft)' } : null },
        h('div', { class: 'row' }, h('span', { class: 'dot', style: { background: c.color, width: '14px', height: '14px' } }), h('h3', { style: { margin: 0, flex: 1 } }, c.name),
          c.narrator ? h('span', { class: 'chip' }, t('roles.narrator')) : null,
          mine ? h('span', { class: 'chip gold' }, t('common.myRole')) : h('span', { class: 'chip' }, t('roles.partner'))),
        toggle,
        voiceCard(script, c.id, { webVoices, title: mine ? t('roles.myVoice') : t('roles.partnerVoice'), onColor: () => {} })));
    }
    nextBtn.classList.toggle('disabled', !script.myRoles.length);
  }
  render();
  const off = onVoicesChanged((v) => { webVoices = v; render(); });
  return off;
}
