// ActoMind – "Adjust pauses to my tempo": measure how long the actor takes to say sample lines.
import { h, btn, modal, field, selectEl, switchEl, toast } from './dom.js';
import { t } from '../core/i18n.js';
import { myLines, tempoProfiles, saveTempoProfiles, saveScriptSoon } from '../core/store.js';
import { spokenText, wordCount } from '../core/tokenize.js';
import { profileFromSamples } from '../core/timing.js';
import { shuffle, uid } from '../core/util.js';
import { micMeter, support } from '../core/speech.js';
import { ensureMicConsent } from './common.js';

const PRESETS = ['fast', 'natural', 'dramatic', 'slow', 'custom'];
const BUILTIN = {
  pl: ['Nie wiem, czy to dobry pomysł, ale spróbujmy jeszcze raz.', 'Proszę usiąść. Musimy spokojnie porozmawiać o tym, co się wczoraj wydarzyło.', 'Naprawdę? Nigdy bym nie przypuszczał!', 'Wszystko zaczęło się od jednego, zupełnie niewinnego pytania.', 'Dobrze. Zgoda. Ale tylko ten jeden raz.'],
  en: ['I am not sure it is a good idea, but let us try once more.', 'Please sit down. We need to talk calmly about what happened yesterday.', 'Really? I would never have guessed!', 'It all started with one completely innocent question.', 'All right. Agreed. But only this once.'],
};

export function openCalibration(script, onDone) {
  const lang = script.lang === 'en' ? 'en' : 'pl';
  let samples = shuffle(myLines(script).map((l) => spokenText(l.text)).filter((x) => { const n = wordCount(x); return n >= 5 && n <= 30; })).slice(0, 5);
  if (samples.length < 3) samples = [...samples, ...BUILTIN[lang]].slice(0, 5);
  let preset = 'natural';
  let customName = '';
  let useMic = false;
  let i = 0;
  const results = [];
  let startT = null;
  let stopMeter = null;
  const body = h('div');
  const m = modal({ title: t('calib.title'), body, onClose: () => { stopMeter?.(); document.removeEventListener('keydown', onKey); } });

  function onKey(e) { if (e.code === 'Space' && i < samples.length && !e.target.matches('input,textarea,select')) { e.preventDefault(); startT == null ? begin() : end(); } }
  document.addEventListener('keydown', onKey);

  function begin() { startT = performance.now(); render(); }
  function end() {
    if (startT == null) return;
    results[i] = { text: samples[i], seconds: (performance.now() - startT) / 1000 };
    startT = null;
    i++;
    render();
  }

  async function micAuto() {
    if (!(await ensureMicConsent())) return;
    // local voice-activity detection: start when level rises, end after 900 ms of quiet
    let speaking = false;
    let quietSince = 0;
    let begun = 0;
    try {
      stopMeter = await micMeter((lv) => {
        const now = performance.now();
        if (i >= samples.length) return;
        if (!speaking && lv > 0.12) { speaking = true; begun = now; startT = now; render(); }
        if (speaking) {
          if (lv < 0.06) { if (!quietSince) quietSince = now; if (now - quietSince > 900) { speaking = false; results[i] = { text: samples[i], seconds: (quietSince - begun) / 1000 }; startT = null; quietSince = 0; i++; render(); } }
          else quietSince = 0;
        }
      });
    } catch (e) { toast(t('rec.micError', { msg: e.message }), { type: 'error' }); useMic = false; render(); }
  }

  function render() {
    body.replaceChildren();
    if (i < samples.length) {
      body.append(
        h('p', { class: 'small text-2' }, t('calib.intro')),
        i === 0 && startT == null ? h('div', {},
          field(t('calib.profile'), selectEl(PRESETS.map((p) => ({ value: p, label: t('calib.presets.' + p) })), preset, (v) => { preset = v; render(); })),
          preset === 'custom' ? h('input', { type: 'text', value: customName, placeholder: t('calib.customName'), oninput: (e) => { customName = e.target.value; } }) : null,
          support.mic ? switchEl(t('calib.useMic'), useMic, (v) => { useMic = v; if (v) micAuto(); else { stopMeter?.(); stopMeter = null; } render(); }, t('calib.useMicHint')) : null) : null,
        h('div', { class: 'chip gold' }, t('calib.sample', { n: i + 1, total: samples.length })),
        h('div', { class: 'answer-card', style: { margin: '10px 0' } }, h('div', { class: 'text' }, samples[i])),
        useMic
          ? h('p', { class: 'center' }, startT == null ? t('calib.micWaiting') : h('span', { class: 'listening' }, t('calib.micSpeaking')))
          : h('div', { class: 'big-controls' },
            startT == null ? btn(t('calib.start'), begin, { cls: 'btn-primary btn-xl', icon: 'play' }) : btn(t('calib.stop'), end, { cls: 'btn-accent btn-xl', icon: 'stop' })),
        h('p', { class: 'hint center' }, t('calib.keys')));
      return;
    }
    stopMeter?.();
    const prof = profileFromSamples(results);
    body.append(
      h('p', {}, t('calib.done')),
      h('div', { class: 'grid grid-2' },
        h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, prof.wordsPerSecond.toFixed(2)), h('div', { class: 'stat-label' }, t('calib.wps'))),
        h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, prof.syllablesPerSecond.toFixed(2)), h('div', { class: 'stat-label' }, t('calib.sps')))),
      h('table', { class: 'table', style: { marginTop: '10px' } }, h('tbody', {}, results.map((r) => h('tr', {}, h('td', {}, r.text.slice(0, 50) + '…'), h('td', {}, r.seconds.toFixed(1) + ' s'))))),
      h('div', { class: 'modal-actions' },
        btn(t('calib.again'), () => { i = 0; results.length = 0; render(); }, { cls: 'btn-ghost' }),
        btn(t('calib.save'), async () => {
          const list = await tempoProfiles();
          const name = preset === 'custom' ? (customName.trim() || t('calib.presets.custom')) : t('calib.presets.' + preset);
          const existing = list.findIndex((p) => p.preset === preset && preset !== 'custom');
          const entry = { id: existing >= 0 ? list[existing].id : uid('tp_'), name, preset, ...prof, createdAt: Date.now() };
          if (existing >= 0) list[existing] = entry; else list.push(entry);
          await saveTempoProfiles(list);
          script.studio.profileId = entry.id;
          saveScriptSoon(script);
          toast(t('calib.saved', { name }), { type: 'success' });
          m.close();
          onDone?.(entry);
        }, { cls: 'btn-primary', icon: 'check' })));
  }
  render();
}
