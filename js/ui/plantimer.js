// ActoMind – study plan block timer (shown in the header while a planned block is running).
import { h, toast } from './dom.js';
import { t } from '../core/i18n.js';
import { db } from '../core/db.js';
import { dateKey } from '../core/util.js';

const KEY = 'actomind.planTimer';

export function planTimerState() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

export function startPlanTimer(o) {
  localStorage.setItem(KEY, JSON.stringify({ ...o, endsAt: Date.now() + o.minutes * 60000 }));
  refreshChip();
}

export function stopPlanTimer() {
  localStorage.removeItem(KEY);
  refreshChip();
}

export async function markBlockDone(scriptId, blockKey) {
  const key = 'plan:' + scriptId;
  const meta = (await db.get('meta', key)) || { key };
  meta.done = meta.done || {};
  const d = dateKey();
  meta.done[d] = [...new Set([...(meta.done[d] || []), blockKey])];
  await db.put('meta', meta);
}

export function planChip() {
  const st = planTimerState();
  if (!st) return null;
  const left = Math.max(0, st.endsAt - Date.now());
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return h('a', { class: 'chip gold timer-chip', href: '#/learn/premiere', title: t('premiere.timerTitle'), id: 'plan-chip' }, '⏱ ' + m + ':' + String(s).padStart(2, '0'));
}

function refreshChip() {
  const old = document.getElementById('plan-chip');
  const fresh = planChip();
  if (old && fresh) old.replaceWith(fresh);
  else if (old) old.remove();
  else if (fresh) document.getElementById('header-actions')?.prepend(fresh);
}

export function initPlanTimer() {
  setInterval(async () => {
    const st = planTimerState();
    if (!st) return;
    if (Date.now() >= st.endsAt) {
      localStorage.removeItem(KEY);
      await markBlockDone(st.scriptId, st.blockKey);
      toast(t('premiere.blockFinished', { label: st.label }), { type: 'success', action: { label: t('premiere.backToPlan'), onClick: () => { location.hash = '#/learn/premiere'; } } });
    }
    refreshChip();
  }, 1000);
}
