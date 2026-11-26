// ActoMind – "Premiera już jutro": intensive, adaptive study plan.
import { h, btn, field, segmented, banner, toast, linkBtn } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { setHeader, navigate } from '../ui/shell.js';
import { t, tn, fmtDate, fmtTime } from '../core/i18n.js';
import { getProgress, roleStats, saveScript } from '../core/store.js';
import { db } from '../core/db.js';
import { requireScript } from '../ui/common.js';
import { sessionPlan, premierePlan, SESSION_LENGTHS } from '../core/planner.js';
import { isLong } from '../core/chunker.js';
import { dateKey } from '../core/util.js';
import { modeHref, modeIcon } from '../ui/modes.js';
import { startPlanTimer, stopPlanTimer, planTimerState, markBlockDone } from '../ui/plantimer.js';
import { toLocalInput } from './script.js';

export default async function premiereView(root) {
  setHeader(t('premiere.title'));
  const script = await requireScript(root);
  if (!script) return;
  const progress = await getProgress(script.id);
  const st = roleStats(script, progress);
  const metaKey = 'plan:' + script.id;
  const meta = (await db.get('meta', metaKey)) || { key: metaKey };
  meta.minutesPerDay = meta.minutesPerDay || 60;
  meta.selfLevel = meta.selfLevel || (st.mastery > 0 ? 'auto' : 'some');
  meta.sessionLen = meta.sessionLen || 30;
  const saveMeta = () => db.put('meta', meta);
  const hasLong = script.items.some((i) => i.type === 'line' && script.myRoles.includes(i.charId) && isLong(i.text));
  const reviewed = Object.values(progress.records).some((r) => r.history?.length);

  const out = h('div');
  const premIn = h('input', { type: 'datetime-local', value: script.premiereAt ? toLocalInput(script.premiereAt) : '' });
  premIn.addEventListener('change', async () => { script.premiereAt = premIn.value ? new Date(premIn.value).getTime() : null; await saveScript(script); render(); });
  const minIn = h('input', { type: 'number', min: 5, max: 600, step: 5, value: meta.minutesPerDay });
  minIn.addEventListener('change', () => { meta.minutesPerDay = Math.max(5, Math.min(600, Number(minIn.value) || 30)); saveMeta(); render(); });

  root.append(
    h('div', { class: 'card hero' }, h('h1', {}, t('premiere.title')), h('p', { class: 'text-2' }, t('premiere.intro'))),
    h('div', { class: 'card' },
      h('div', { class: 'grid grid-2 stack-sm' },
        field(t('premiere.when'), premIn),
        field(t('premiere.minutesPerDay'), minIn, t('premiere.minutesHint'))),
      field(t('premiere.level'), segmented([
        ...(reviewed ? [{ value: 'auto', label: t('premiere.levelAuto', { p: st.masteryPct }) }] : []),
        { value: 'none', label: t('premiere.levels.none') }, { value: 'some', label: t('premiere.levels.some') },
        { value: 'most', label: t('premiere.levels.most') }, { value: 'almost', label: t('premiere.levels.almost') },
      ], meta.selfLevel, (v) => { meta.selfLevel = v; saveMeta(); render(); }))),
    out,
  );

  function blockKey(prefix, i, b) { return `${prefix}:${i}:${b.mode}`; }

  function blockRow(b, key, label) {
    const done = (meta.done?.[dateKey()] || []).includes(key);
    const running = planTimerState()?.blockKey === key;
    return h('div', { class: 'plan-block' + (done ? ' done' : '') },
      h('div', { class: 'min' }, b.minutes, h('div', { class: 'small muted', style: { fontSize: '.65rem' } }, 'min')),
      h('div', {}, h('strong', {}, icon(modeIcon(b.mode)), ' ', t('modes.' + b.mode + '.title')), h('div', { class: 'small muted' }, t('modes.' + b.mode + '.desc'))),
      h('div', { class: 'row nowrap' },
        done ? h('span', { class: 'chip green' }, icon('check')) : running
          ? btn(t('premiere.stopBlock'), () => { stopPlanTimer(); render(); }, { cls: 'btn-sm' })
          : btn(t('premiere.startBlock'), () => {
            startPlanTimer({ scriptId: script.id, blockKey: key, minutes: b.minutes, label });
            navigate(modeHref(b.mode));
          }, { cls: 'btn-sm btn-primary', icon: 'play' }),
        done ? null : btn(t('premiere.markDone'), async () => { await markBlockDone(script.id, key); Object.assign(meta, await db.get('meta', metaKey)); render(); }, { cls: 'btn-sm btn-ghost', icon: 'check', iconOnly: true })));
  }

  function render() {
    out.replaceChildren();
    const mastery = meta.selfLevel === 'auto' ? st.mastery : null;
    const state = { mastery: mastery ?? { none: 0, some: 0.3, most: 0.6, almost: 0.85 }[meta.selfLevel] ?? 0.3, hardCount: st.hard, dueCount: st.due, hasLongLines: hasLong, newCount: st.new };

    // ---- a session right now
    const sessionBox = h('div', { class: 'card' },
      h('div', { class: 'card-title' }, h('h3', {}, t('premiere.sessionNow'))),
      segmented(SESSION_LENGTHS.map((m) => ({ value: m, label: m + ' min' })), meta.sessionLen, (v) => { meta.sessionLen = v; saveMeta(); render(); }),
      h('div', { style: { height: '10px' } }),
      ...sessionPlan(meta.sessionLen, state).map((b, i) => blockRow(b, blockKey('now' + meta.sessionLen, i, b), t('modes.' + b.mode + '.title'))),
      h('p', { class: 'hint' }, t('premiere.adaptive', { p: Math.round(state.mastery * 100) })));
    out.appendChild(sessionBox);

    // ---- multi-day plan
    if (!script.premiereAt) {
      out.appendChild(banner('info', 'calendar', t('premiere.setDate')));
    } else {
      const plan = premierePlan({ premiereAt: script.premiereAt, minutesPerDay: meta.minutesPerDay, selfLevel: meta.selfLevel === 'auto' ? 'some' : meta.selfLevel, mastery, hardCount: st.hard, lineCount: st.total, hasLongLines: hasLong, newCount: st.new });
      if (plan.past) { out.appendChild(banner('warn', 'alert', t('premiere.past'))); }
      else {
        if (plan.warnings.includes('tight')) out.appendChild(banner('warn', 'alert', t('premiere.tight', { need: plan.neededMinutes, have: plan.availableMinutes })));
        if (plan.warnings.includes('lateToday')) out.appendChild(banner('info', 'moon', t('premiere.lateToday')));
        out.appendChild(h('div', { class: 'section-title' }, t('premiere.planUntil', { date: fmtDate(script.premiereAt) })));
        plan.days.forEach((d, di) => {
          const card = h('div', { class: 'card' + (d.isPremiereDay ? ' accent' : '') },
            h('div', { class: 'card-title' }, h('h3', {}, d.isPremiereDay ? t('premiere.premiereDay') : di === 0 ? t('premiere.today') : fmtDate(d.date, { weekday: 'long', day: 'numeric', month: 'long' })), d.isPremiereDay ? h('span', { class: 'chip gold' }, icon('curtain'), ' ' + fmtTime(script.premiereAt)) : null));
          if (!d.sessions.length) card.appendChild(h('p', { class: 'muted small' }, t('premiere.rest')));
          d.sessions.forEach((s, si) => {
            card.appendChild(h('div', { class: 'row', style: { margin: '8px 0 6px' } }, h('strong', {}, t('premiere.kind.' + s.kind)), h('span', { class: 'chip' }, fmtTime(Math.max(s.at, Date.now())) + ' · ' + s.minutes + ' min')));
            s.blocks.forEach((b, bi) => card.appendChild(di === 0 || d.isPremiereDay ? blockRow(b, blockKey(dateKey(d.date) + ':' + si, bi, b), t('modes.' + b.mode + '.title')) : h('div', { class: 'small text-2', style: { marginLeft: '6px' } }, `• ${b.minutes} min – ${t('modes.' + b.mode + '.title')}`)));
          });
          if (d.sleep) {
            card.appendChild(banner('info', 'bed', h('strong', {}, t('premiere.sleepTitle')), h('div', {}, t('premiere.sleepText', { last: fmtTime(d.sleep.lastStudy), bed: fmtTime(d.sleep.bedtime), wake: fmtTime(d.sleep.wake) }))));
          }
          if (d.isPremiereDay) card.appendChild(h('p', { class: 'small text-2' }, t('premiere.dayTips')));
          out.appendChild(card);
        });
      }
    }
    out.appendChild(h('p', { class: 'hint' }, t('premiere.noPromise')));
  }
  render();
}
