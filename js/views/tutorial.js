// ActoMind – first-run tutorial
import { h, btn, modal } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../core/i18n.js';
import { settings, setSetting, createScriptFromText } from '../core/store.js';
import { navigate } from '../ui/shell.js';

const STEPS = [
  { icon: 'masks', key: 'welcome' },
  { icon: 'upload', key: 'import' },
  { icon: 'users', key: 'role' },
  { icon: 'brain', key: 'learn' },
  { icon: 'curtain', key: 'partner' },
  { icon: 'headphones', key: 'studio' },
  { icon: 'lock', key: 'privacy' },
];

export function showTutorial() {
  let i = 0;
  const body = h('div');
  const m = modal({ title: '', body, onClose: () => setSetting('tutorialDone', true) });
  const render = () => {
    const s = STEPS[i];
    const big = icon(s.icon, 'big');
    body.replaceChildren(
      h('div', { class: 'tutorial-step' },
        big,
        h('h2', {}, t('tutorial.' + s.key + '.title')),
        h('p', { class: 'text-2' }, t('tutorial.' + s.key + '.text'))),
      h('div', { class: 'dots' }, STEPS.map((_, k) => h('i', { class: k === i ? 'on' : '' }))),
      h('div', { class: 'modal-actions' },
        i === 0 ? btn(t('tutorial.skip'), () => m.close(), { cls: 'btn-ghost' }) : btn(t('tutorial.back'), () => { i--; render(); }, { cls: 'btn-ghost', icon: 'left' }),
        i < STEPS.length - 1
          ? btn(t('tutorial.next'), () => { i++; render(); }, { cls: 'btn-primary', icon: 'right' })
          : h('div', { class: 'row' },
            btn(t('tutorial.demo'), async () => {
              m.close();
              const { DEMO_PL, DEMO_EN } = await import('../core/demo.js');
              const d = settings.lang === 'en' ? DEMO_EN : DEMO_PL;
              const s2 = await createScriptFromText(d.text, { title: d.title, lang: d.lang });
              navigate(`#/script/${s2.id}/edit?fresh=1`);
            }, { cls: 'btn-primary', icon: 'sparkles' }),
            btn(t('tutorial.finish'), () => m.close(), {}))));
    const svg = body.querySelector('svg.big');
    if (svg) svg.classList.add('big');
  };
  render();
}
