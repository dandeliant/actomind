// ActoMind – listening mode: the whole script read by character voices; only-mine; partner-then-mine with time to repeat.
import { h, segmented, switchEl, linkBtn, banner } from '../ui/dom.js';
import { setHeader } from '../ui/shell.js';
import { t } from '../core/i18n.js';
import { settings, setSetting, SessionTracker } from '../core/store.js';
import { requireScript, whoLabel, lineTextEl } from '../ui/common.js';
import { buildProgram } from '../audio/program.js';
import { livePlayerUI } from '../ui/player.js';
import { support } from '../core/speech.js';

export default async function listenView(root, params, query) {
  setHeader(t('listen.title'));
  const script = await requireScript(root, { needRoles: false });
  if (!script) return;
  const tracker = new SessionTracker(script.id, 'listen');
  let mode = ['full', 'mine', 'repeat', 'rehearsal'].includes(query.mode) ? query.mode : 'full';
  if (!script.myRoles.length) mode = 'full';
  let readDirections = !!script.studio.readDirections;
  const textBox = h('div', { class: 'script card', style: { maxHeight: '48vh', overflow: 'auto' } });

  const getProgram = () => buildProgram(script, { mode, studio: { readDirections, beep: script.studio.beep } });
  const ui = livePlayerUI(script, getProgram, {
    rate: settings.listenRate, gapScale: settings.listenGapScale,
    onRate: (v) => setSetting('listenRate', v), onGap: (v) => setSetting('listenGapScale', v),
    tracker, posKey: 'actomind.listenPos.' + script.id,
    onSegment: (seg) => {
      textBox.querySelectorAll('.line.current').forEach((x) => x.classList.remove('current'));
      const el = textBox.querySelector(`[data-id="${seg.itemId}"]`);
      if (el) { el.classList.add('current'); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    },
  });

  function renderText() {
    textBox.replaceChildren();
    const mine = new Set(script.myRoles);
    for (const it of script.items) {
      if (it.type === 'scene' || it.type === 'act') { textBox.appendChild(h('div', { class: 'heading ' + it.type, 'data-id': it.id }, it.text)); continue; }
      if (it.type === 'direction') { textBox.appendChild(h('div', { class: 'direction', 'data-id': it.id }, it.text)); continue; }
      if (it.type !== 'line') continue;
      textBox.appendChild(h('div', { class: 'line' + (mine.has(it.charId) ? ' mine' : ''), 'data-id': it.id, role: 'button', tabindex: '0', title: t('listen.playFromHere'), onclick: () => ui.playFromItem(it.id) }, whoLabel(script, it), lineTextEl(it.text)));
    }
  }

  root.append(
    h('h1', {}, t('listen.title')),
    support.tts ? null : banner('warn', 'alert', t('listen.noTts')),
    h('div', { class: 'card' },
      segmented([
        { value: 'full', label: t('listen.mode.full') },
        ...(script.myRoles.length ? [
          { value: 'mine', label: t('listen.mode.mine') },
          { value: 'repeat', label: t('listen.mode.repeat') },
          { value: 'rehearsal', label: t('listen.mode.rehearsal') },
        ] : []),
      ], mode, (v) => { mode = v; ui.refresh(); }),
      h('p', { class: 'small muted', style: { marginTop: '8px' } }, t('listen.modeHint')),
      switchEl(t('listen.readDirections'), readDirections, (v) => { readDirections = v; ui.refresh(); }),
      h('div', { class: 'row' }, linkBtn(t('listen.voices'), `#/script/${script.id}/roles`, { cls: 'btn-sm', icon: 'users' }), linkBtn(t('rehearse.studio'), '#/studio', { cls: 'btn-sm', icon: 'headphones' }))),
    ui.el,
    h('div', { class: 'section-title' }, t('listen.text')),
    textBox,
  );
  renderText();
  const last = localStorage.getItem('actomind.listenPos.' + script.id);
  if (last) ui.player.jumpToItem(last);
  return () => { ui.destroy(); tracker.stop(); };
}
