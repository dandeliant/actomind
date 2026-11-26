// ActoMind – record button widget with timer + level meter (local recording only).
import { h, btn, toast } from './dom.js';
import { t } from '../core/i18n.js';
import { MicRecorder, saveRecording } from '../core/recorder.js';
import { micMeter, support } from '../core/speech.js';
import { ensureMicConsent } from './common.js';
import { formatClock } from '../core/util.js';

/**
 * @param {{scriptId:string, lineId?:string|null, intention?:()=>string, onSaved?:(rec)=>void, label?:string}} o
 */
export function recordWidget(o) {
  const wrap = h('div', { class: 'col' });
  if (!support.recorder) { wrap.appendChild(h('p', { class: 'small muted' }, t('rec.unsupported'))); return wrap; }
  let rec = null;
  let stopMeter = null;
  let timer = null;
  const level = h('div', { class: 'mic-level' }, h('span'));
  const time = h('span', { class: 'chip timer-chip' }, '0:00');
  const status = h('div', { class: 'row hidden' }, h('span', { class: 'listening' }, t('rec.recording')), time);
  const recBtn = btn(o.label || t('rec.record'), toggle, { cls: 'btn-lg btn-accent', icon: 'record' });
  wrap.append(recBtn, status, level);
  level.classList.add('hidden');

  async function toggle() {
    if (rec) return stop();
    if (!(await ensureMicConsent())) return;
    rec = new MicRecorder();
    try {
      const stream = await rec.start();
      stopMeter = await micMeter((v) => { level.firstChild.style.width = Math.round(v * 100) + '%'; }, stream);
    } catch (e) {
      rec = null;
      toast(t('rec.micError', { msg: e.name === 'NotAllowedError' ? t('stt.errNotAllowed') : e.message }), { type: 'error' });
      return;
    }
    status.classList.remove('hidden');
    level.classList.remove('hidden');
    recBtn.replaceChildren(h('span', {}, t('rec.stop')));
    timer = setInterval(() => { time.textContent = formatClock(rec?.elapsed || 0); }, 250);
  }

  async function stop() {
    clearInterval(timer);
    stopMeter?.();
    const r = await rec.stop();
    rec = null;
    status.classList.add('hidden');
    level.classList.add('hidden');
    recBtn.replaceChildren(h('span', {}, o.label || t('rec.record')));
    if (!r || r.duration < 0.4) { toast(t('rec.tooShort')); return; }
    const saved = await saveRecording({ scriptId: o.scriptId, lineId: o.lineId || null, blob: r.blob, mime: r.mime, duration: r.duration, intention: o.intention?.() || '', kind: 'mic' });
    toast(t('rec.saved'), { type: 'success' });
    o.onSaved?.(saved);
  }

  wrap.destroy = () => { clearInterval(timer); stopMeter?.(); rec?.cancel(); };
  return wrap;
}

/** Audio element for a stored blob (URL revoked on removal) */
export function blobAudio(blob) {
  const url = URL.createObjectURL(blob);
  const a = h('audio', { controls: true, preload: 'metadata', src: url, style: { width: '100%' } });
  const obs = new MutationObserver(() => { if (!a.isConnected) { URL.revokeObjectURL(url); obs.disconnect(); } });
  setTimeout(() => obs.observe(document.body, { childList: true, subtree: true }), 0);
  return a;
}
