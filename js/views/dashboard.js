// ActoMind – dashboard ("Start")
import { h, btn, linkBtn, ring, statBox, statusBar, emptyState } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { setHeader, navigate } from '../ui/shell.js';
import { t, tn, fmtDate, fmtTime } from '../core/i18n.js';
import { settings, activeScript, listScripts, getProgress, roleStats, scriptTime, listRehearsals, gami, charById, setActiveScript } from '../core/store.js';
import { db } from '../core/db.js';
import { sessionPlan, premierePlan, nearestLength } from '../core/planner.js';
import { formatDuration, dateKey, DAY } from '../core/util.js';
import { isLong } from '../core/chunker.js';
import { modeHref, modeIcon } from '../ui/modes.js';

export default async function dashboardView(root) {
  setHeader('');
  const script = await activeScript();
  const scripts = await listScripts();
  const g = await gami.get();

  if (!script) {
    root.append(
      h('div', { class: 'card hero center', style: { padding: '34px 20px' } },
        h('div', { class: 'gold', style: { letterSpacing: '.2em', textTransform: 'uppercase', fontSize: '.8rem' } }, 'ActoMind'),
        h('h1', { style: { fontSize: '2.2rem', margin: '8px 0' } }, 'Learn your lines.', h('br'), h('span', { class: 'gold' }, 'Live your role.')),
        h('p', { class: 'text-2' }, t('dash.welcome')),
        h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '16px' } },
          linkBtn(t('scripts.import'), '#/import', { cls: 'btn-primary btn-lg', icon: 'upload' }),
          btn(t('dash.loadDemo'), async () => {
            const { DEMO_PL, DEMO_EN } = await import('../core/demo.js');
            const { createScriptFromText } = await import('../core/store.js');
            const d = settings.lang === 'en' ? DEMO_EN : DEMO_PL;
            const s = await createScriptFromText(d.text, { title: d.title, lang: d.lang });
            navigate(`#/script/${s.id}/edit?fresh=1`);
          }, { cls: 'btn-lg', icon: 'sparkles' }),
          btn(t('tutorial.open'), async () => { (await import('./tutorial.js')).showTutorial(); }, { cls: 'btn-lg btn-ghost', icon: 'help' }))),
    );
    return;
  }

  const progress = await getProgress(script.id);
  const st = roleStats(script, progress);
  const time = await scriptTime(script.id);
  const rehearsals = await listRehearsals(script.id);
  const roles = script.myRoles.map((id) => charById(script, id)).filter(Boolean);
  const today = g.days?.[dateKey()] || { minutes: 0, reviews: 0 };
  const lvl = gami.level(g.xp || 0);
  const resumeP = await db.get('meta', 'resume:' + script.id + ':partner');

  // "continue learning" target
  let cont = '#/learn';
  let contLabel = t('dash.continue');
  if (!roles.length) { cont = `#/script/${script.id}/roles`; contLabel = t('roles.choose'); }
  else if (st.due > 0) cont = '#/learn/train/review';
  else if (st.new > 0) cont = '#/learn/train/letters';
  else if (resumeP) cont = '#/rehearse/partner';
  else cont = '#/learn/train/cues';

  // premiere countdown
  let premiereBox = h('div', { class: 'small muted' }, t('dash.noPremiere'), ' ', h('a', { href: `#/script/${script.id}` }, t('dash.setPremiere')));
  if (script.premiereAt) {
    const left = script.premiereAt - Date.now();
    const days = Math.ceil(left / DAY);
    premiereBox = left > 0
      ? h('div', {}, h('div', { class: 'stat-value gold' }, days <= 1 ? (left < DAY && new Date(script.premiereAt).getDate() === new Date().getDate() ? t('dash.today') : t('dash.tomorrow')) : tn('dash.inDays', days)), h('div', { class: 'small muted' }, fmtDate(script.premiereAt) + ', ' + fmtTime(script.premiereAt)))
      : h('div', { class: 'small muted' }, t('dash.premierePassed', { date: fmtDate(script.premiereAt) }));
  }

  // next study plan
  const hasLong = script.items.some((i) => i.type === 'line' && script.myRoles.includes(i.charId) && isLong(i.text));
  const planState = { mastery: st.mastery, hardCount: st.hard, dueCount: st.due, hasLongLines: hasLong, newCount: st.new };
  let planBlocks;
  let planTitle;
  if (script.premiereAt && script.premiereAt > Date.now()) {
    const meta = (await db.get('meta', 'plan:' + script.id)) || {};
    const pp = premierePlan({ premiereAt: script.premiereAt, minutesPerDay: meta.minutesPerDay || 45, selfLevel: meta.selfLevel || 'some', mastery: st.mastery || null, hardCount: st.hard, lineCount: st.total, hasLongLines: hasLong, newCount: st.new });
    const nextSession = pp.days.flatMap((d) => d.sessions).find((s) => s.at + s.minutes * 60000 > Date.now());
    planBlocks = nextSession ? nextSession.blocks : sessionPlan(nearestLength(settings.dailyGoal), planState);
    planTitle = nextSession ? t('dash.nextSession', { time: fmtTime(Math.max(nextSession.at, Date.now())), min: nextSession.minutes }) : t('dash.todayPlan');
  } else {
    planBlocks = sessionPlan(nearestLength(settings.dailyGoal || 15), planState);
    planTitle = t('dash.sessionPlan', { min: nearestLength(settings.dailyGoal || 15) });
  }

  root.append(
    h('div', { class: 'card hero' },
      h('div', { class: 'row nowrap', style: { alignItems: 'flex-start' } },
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { class: 'small gold', style: { letterSpacing: '.16em', textTransform: 'uppercase' } }, t('dash.lastRole')),
          h('h1', { style: { margin: '4px 0' } }, script.title),
          roles.length ? h('div', { class: 'row' }, roles.map((c) => h('span', { class: 'chip gold' }, h('span', { class: 'dot', style: { background: c.color } }), c.name))) : h('p', { class: 'muted' }, t('empty.noRoleTitle'))),
        ring(st.masteryPct, 96, 9)),
      h('div', { class: 'row', style: { marginTop: '16px' } },
        linkBtn(contLabel, cont, { cls: 'btn-primary btn-lg', icon: 'play' }),
        linkBtn(t('rehearse.partner'), '#/rehearse/partner', { cls: 'btn-lg', icon: 'masks' }))),

    roles.length ? h('div', { class: 'grid grid-4' },
      statBox(st.total, t('dash.totalLines')),
      statBox(st.mastered, t('dash.mastered'), 'var(--ok)'),
      statBox(st.hard, t('dash.hard'), 'var(--bad)'),
      statBox(st.due, t('dash.due'), 'var(--info)'),
      statBox(formatDuration(time), t('dash.time')),
      statBox(rehearsals.length, t('dash.rehearsals')),
      h('div', { class: 'stat', style: { gridColumn: 'span 2' } }, h('div', { class: 'stat-label', style: { marginTop: 0, marginBottom: '4px' } }, t('dash.premiere')), premiereBox)) : null,
    roles.length ? h('div', { class: 'card flat', style: { marginTop: '12px' } }, statusBar(st, st.total), h('div', { class: 'legend', style: { marginTop: '8px' } },
      h('span', {}, h('i', { class: 'dot', style: { background: 'var(--ok)' } }), t('map.mastered') + ' ' + st.mastered),
      h('span', {}, h('i', { class: 'dot', style: { background: 'var(--warn)' } }), t('map.partial') + ' ' + st.partial),
      h('span', {}, h('i', { class: 'dot', style: { background: 'var(--bad)' } }), t('map.hard') + ' ' + st.hard),
      h('span', {}, h('i', { class: 'dot', style: { background: 'var(--gray)' } }), t('map.new') + ' ' + st.new))) : null,

    roles.length ? h('div', {},
      h('div', { class: 'section-title' }, t('dash.plan')),
      h('div', { class: 'card' },
        h('div', { class: 'card-title' }, h('h3', {}, planTitle), linkBtn(t('premiere.open'), '#/learn/premiere', { cls: 'btn-sm btn-ghost', icon: 'rocket' })),
        planBlocks.map((b) => h('a', { class: 'plan-block', href: modeHref(b.mode), style: { textDecoration: 'none', color: 'inherit' } },
          h('div', { class: 'min' }, b.minutes, h('div', { class: 'small muted', style: { fontSize: '.65rem' } }, 'min')),
          h('div', {}, h('strong', {}, t('modes.' + b.mode + '.title')), h('div', { class: 'small muted' }, t('modes.' + b.mode + '.desc'))),
          icon(modeIcon(b.mode)))),
        h('p', { class: 'hint' }, t('premiere.noPromise')))) : null,

    settings.gamification ? h('div', {},
      h('div', { class: 'section-title' }, t('dash.motivation')),
      h('div', { class: 'grid grid-3' },
        h('div', { class: 'stat' }, h('div', { class: 'row nowrap' }, icon('flame'), h('div', { class: 'stat-value' }, g.streak || 0)), h('div', { class: 'stat-label' }, t('dash.streak'))),
        h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, t('dash.level', { n: lvl.level })), h('div', { class: 'bar', style: { marginTop: '6px' } }, h('span', { style: { width: lvl.progress * 100 + '%', background: 'var(--gold)' } })), h('div', { class: 'stat-label' }, (g.xp || 0) + ' XP')),
        h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, Math.round(today.minutes) + '/' + settings.dailyGoal), h('div', { class: 'bar', style: { marginTop: '6px' } }, h('span', { style: { width: Math.min(100, (today.minutes / settings.dailyGoal) * 100) + '%', background: 'var(--ok)' } })), h('div', { class: 'stat-label' }, t('dash.dailyGoal'))))) : null,

    h('div', { class: 'section-title' }, t('dash.myScripts')),
    h('div', { class: 'list' },
      scripts.slice(0, 4).map((s) => h('button', { class: 'list-item', type: 'button', onclick: async () => { await setActiveScript(s.id); navigate('#/script/' + s.id); } },
        icon('script'), h('div', { class: 'grow' }, h('div', { class: 'title' }, s.title), h('div', { class: 'sub' }, tn('common.linesN', s.items.filter((i) => i.type === 'line').length) + (s.id === script.id ? ' · ' + t('scripts.current') : ''))), icon('right'))),
      linkBtn(t('dash.allScripts'), '#/scripts', { cls: 'btn-ghost', icon: 'list' })),
  );
}
