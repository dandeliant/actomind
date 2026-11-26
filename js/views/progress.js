// ActoMind – progress: visual script map (timeline), progress chart, hardest fragments, stats, achievements.
import { h, btn, modal, statBox, linkBtn } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { setHeader, navigate } from '../ui/shell.js';
import { t, fmtDate } from '../core/i18n.js';
import { settings, getProgress, lineStatuses, roleStats, getSnapshots, gami, ACHIEVEMENTS, charById, listRehearsals, scriptTime } from '../core/store.js';
import { db } from '../core/db.js';
import { requireScript, charName } from '../ui/common.js';
import { scenesOf } from '../core/parser.js';
import { spokenText } from '../core/tokenize.js';
import { dateKey, DAY, formatDuration } from '../core/util.js';
import { priority } from '../core/srs.js';

const STATUS_COLOR = { new: 'var(--gray)', hard: 'var(--bad)', partial: 'var(--warn)', mastered: 'var(--ok)' };

export default async function progressView(root) {
  setHeader(t('progress.title'));
  const script = await requireScript(root);
  if (!script) return;
  const progress = await getProgress(script.id);
  const statuses = lineStatuses(script, progress);
  const st = roleStats(script, progress);
  const snaps = await getSnapshots(script.id);
  const g = await gami.get();
  const rehearsals = await listRehearsals(script.id);
  const time = await scriptTime(script.id);
  const sessions = await db.byIndex('sessions', 'scriptId', script.id);
  const mine = new Set(script.myRoles);

  // ---------------- map
  const tip = h('div', { class: 'small muted', style: { minHeight: '1.5em', marginTop: '6px' }, 'aria-live': 'polite' }, t('map.hover'));
  const mapBox = h('div');
  for (const sc of scenesOf(script.items)) {
    const cells = [];
    for (let i = sc.start; i <= sc.end; i++) {
      const it = script.items[i];
      if (it.type !== 'line') continue;
      if (!mine.has(it.charId)) {
        cells.push(h('button', { type: 'button', class: 'map-cell partner', title: charName(script, it.charId), 'aria-label': charName(script, it.charId) + ': ' + spokenText(it.text).slice(0, 60), onclick: () => openLine(it) }));
        continue;
      }
      const s = statuses[it.id];
      const label = `${t('map.' + s.status)} · ${Math.round(s.mastery * 100)}% · ${spokenText(it.text).slice(0, 70)}`;
      const cell = h('button', { type: 'button', class: 'map-cell s-' + s.status, 'aria-label': label, onclick: () => openLine(it), onmouseenter: () => { tip.textContent = label; }, onfocus: () => { tip.textContent = label; } });
      cells.push(cell);
    }
    mapBox.appendChild(h('div', { class: 'map-scene' }, h('h4', {}, sc.title || t('common.allScenes')), h('div', { class: 'map', role: 'group', 'aria-label': sc.title }, cells)));
  }

  function openLine(it) {
    const isMine = mine.has(it.charId);
    const m = modal({
      title: charName(script, it.charId),
      body: h('div', {}, h('p', { style: { fontFamily: 'var(--font-script)' } }, it.text), isMine ? h('p', { class: 'small muted' }, t('map.' + statuses[it.id].status) + ' · ' + Math.round(statuses[it.id].mastery * 100) + '%') : null),
      actions: [
        { label: t('map.partnerFrom'), cls: 'btn-primary', icon: 'masks', onClick: () => { navigate('#/rehearse/partner?from=' + it.id); } },
        ...(isMine ? [{ label: t('map.lettersFrom'), icon: 'letters', onClick: () => { navigate('#/learn/train/letters?from=' + it.id); } }, { label: t('map.mentor'), icon: 'feather', onClick: () => { navigate('#/learn/mentor?line=' + it.id); } }] : []),
        { label: t('map.readHere'), icon: 'book', onClick: () => { navigate('#/learn/read?from=' + it.id); } },
      ],
    });
    return m;
  }

  // ---------------- progress chart (mastery % per day)
  const days = Object.entries(snaps.days || {}).sort((a, b) => a[0].localeCompare(b[0]));
  const chartBox = h('div');
  if (days.length < 2) chartBox.appendChild(h('p', { class: 'muted small' }, t('progress.chartEmpty')));
  else chartBox.appendChild(lineChart(days.map(([d, v]) => ({ x: d, y: v.mastery, extra: v }))));

  // ---------------- minutes per day (last 14 days)
  const minutesByDay = new Map();
  sessions.forEach((s) => { const k = dateKey(s.start); minutesByDay.set(k, (minutesByDay.get(k) || 0) + s.ms / 60000); });
  const last14 = Array.from({ length: 14 }, (_, i) => dateKey(Date.now() - (13 - i) * DAY)).map((d) => ({ x: d, y: Math.round(minutesByDay.get(d) || 0) }));

  // ---------------- hardest fragments
  const sceneHeat = scenesOf(script.items).map((sc) => {
    const ls = script.items.slice(sc.start, sc.end + 1).filter((it) => it.type === 'line' && mine.has(it.charId));
    if (!ls.length) return null;
    const diff = ls.reduce((s, l) => s + (1 - statuses[l.id].mastery), 0) / ls.length;
    const hard = ls.filter((l) => statuses[l.id].status === 'hard').length;
    return { sc, diff, hard, n: ls.length };
  }).filter(Boolean);
  const hardest = Object.entries(statuses).filter(([, s]) => s.rec && s.rec.history?.length)
    .sort((a, b) => priority(b[1].rec) - priority(a[1].rec)).slice(0, 6)
    .map(([id]) => script.items.find((x) => x.id === id)).filter(Boolean);

  root.append(
    h('h1', {}, t('progress.title')),
    h('div', { class: 'grid grid-4' },
      statBox(st.masteryPct + '%', t('dash.mastery')),
      statBox(st.mastered + '/' + st.total, t('dash.mastered'), 'var(--ok)'),
      statBox(formatDuration(time), t('dash.time')),
      statBox(rehearsals.length, t('dash.rehearsals'))),
    h('div', { class: 'section-title' }, t('map.title')),
    h('div', { class: 'card' },
      h('div', { class: 'legend', style: { marginBottom: '10px' } },
        ...['new', 'hard', 'partial', 'mastered'].map((s) => h('span', {}, h('i', { class: 'dot', style: { background: STATUS_COLOR[s] } }), t('map.' + s) + ' (' + st[s] + ')')),
        h('span', {}, h('i', { class: 'dot', style: { background: 'var(--surface-3)', borderRadius: '2px' } }), t('map.partnerLine'))),
      mapBox, tip,
      h('p', { class: 'hint' }, t('map.clickHint'))),
    h('div', { class: 'section-title' }, t('progress.chartTitle')),
    h('div', { class: 'card' }, chartBox),
    h('div', { class: 'section-title' }, t('progress.minutesTitle')),
    h('div', { class: 'card' }, barChart(last14)),
    h('div', { class: 'section-title' }, t('progress.heatTitle')),
    h('div', { class: 'card' },
      sceneHeat.length ? sceneHeat.map((x) => h('div', { class: 'heat-row' },
        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, x.sc.title || '—'),
        h('div', { class: 'bar', role: 'img', 'aria-label': Math.round(x.diff * 100) + '%' }, h('span', { style: { width: Math.round(x.diff * 100) + '%', background: x.diff > 0.6 ? 'var(--bad)' : x.diff > 0.3 ? 'var(--warn)' : 'var(--ok)' } })),
        h('span', { class: 'small' }, Math.round(x.diff * 100) + '%'))) : h('p', { class: 'muted' }, '—'),
      h('p', { class: 'hint' }, t('progress.heatHint')),
      hardest.length ? h('div', {}, h('div', { class: 'label', style: { margin: '10px 0 6px' } }, t('progress.hardestLines')),
        h('div', { class: 'list' }, hardest.map((it) => h('a', { class: 'list-item', href: '#/learn/train/hardest' }, h('span', { class: 'dot', style: { background: STATUS_COLOR[statuses[it.id].status] } }), h('div', { class: 'grow' }, h('div', { class: 'title' }, spokenText(it.text).slice(0, 80)), h('div', { class: 'sub' }, t('map.' + statuses[it.id].status) + ' · ' + Math.round(statuses[it.id].mastery * 100) + '% · ' + t('progress.lapses', { n: statuses[it.id].rec.lapses || 0 }))))))) : null),
    settings.gamification ? h('div', {},
      h('div', { class: 'section-title' }, t('progress.motivation')),
      h('div', { class: 'grid grid-4' },
        statBox((g.xp || 0) + ' XP', t('dash.level', { n: gami.level(g.xp || 0).level })),
        statBox(g.streak || 0, t('dash.streak')),
        statBox(g.bestStreak || 0, t('progress.bestStreak')),
        statBox(g.noHintRecord || 0, t('progress.noHintRecord'))),
      h('div', { class: 'section-title' }, t('progress.achievements')),
      h('div', { class: 'grid grid-2 stack-sm' }, ACHIEVEMENTS.map((a) => h('div', { class: 'achv' + (g.achievements?.[a.id] ? '' : ' locked') },
        h('div', { class: 'medal' }, icon(a.icon)),
        h('div', {}, h('strong', {}, t('achievements.' + a.id + '.title')), h('div', { class: 'small muted' }, t('achievements.' + a.id + '.desc') + (g.achievements?.[a.id] ? ' · ' + fmtDate(g.achievements[a.id]) : '')))))),
      h('p', { class: 'hint' }, t('progress.gamiOff'), ' ', h('a', { href: '#/settings' }, t('nav.settings')))) : null,
  );
}

/** Single-series line chart (mastery %), 0–100 y axis, hover tooltip, data table. */
function lineChart(points) {
  const W = 640; const H = 220; const P = { l: 34, r: 12, t: 12, b: 26 };
  const n = points.length;
  const x = (i) => P.l + (n === 1 ? 0 : (i / (n - 1)) * (W - P.l - P.r));
  const y = (v) => P.t + (1 - v / 100) * (H - P.t - P.b);
  const grid = [0, 25, 50, 75, 100].map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${P.l - 6}" y="${y(v) + 3}" text-anchor="end">${v}%</text>`).join('');
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
  const area = `${path}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const labels = points.map((p, i) => (i === 0 || i === n - 1 || (n > 6 && i === Math.floor(n / 2))) ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${p.x.slice(5)}</text>` : '').join('');
  const wrap = h('div', { style: { position: 'relative' } });
  wrap.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('progress.chartTitle')}">${grid}<path d="${area}" fill="var(--gold-soft)"/><path d="${path}" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${labels}<line class="xh" y1="${P.t}" y2="${H - P.b}" stroke="var(--muted)" stroke-width="1" opacity="0"/><circle class="dotp" r="5" fill="var(--gold)" stroke="var(--surface)" stroke-width="2" opacity="0"/></svg>`;
  const svg = wrap.firstChild;
  const tipEl = h('div', { class: 'chip', style: { position: 'absolute', top: '0', left: '0', pointerEvents: 'none', opacity: 0, background: 'var(--surface-3)', color: 'var(--text)' } });
  wrap.appendChild(tipEl);
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let i = Math.round(((px - P.l) / (W - P.l - P.r)) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    const p = points[i];
    svg.querySelector('.xh').setAttribute('x1', x(i)); svg.querySelector('.xh').setAttribute('x2', x(i)); svg.querySelector('.xh').setAttribute('opacity', 0.5);
    const d = svg.querySelector('.dotp'); d.setAttribute('cx', x(i)); d.setAttribute('cy', y(p.y)); d.setAttribute('opacity', 1);
    tipEl.textContent = `${fmtDate(p.x, { day: 'numeric', month: 'short' })}: ${p.y}% · ${t('map.mastered')} ${p.extra.mastered}/${p.extra.total}`;
    tipEl.style.opacity = 1;
    tipEl.style.transform = `translate(${Math.min(r.width - 200, Math.max(0, (x(i) / W) * r.width - 60))}px, -6px)`;
  });
  svg.addEventListener('pointerleave', () => { tipEl.style.opacity = 0; svg.querySelector('.xh').setAttribute('opacity', 0); svg.querySelector('.dotp').setAttribute('opacity', 0); });
  wrap.appendChild(h('details', { class: 'more' }, h('summary', {}, t('progress.table')), h('table', { class: 'table' },
    h('thead', {}, h('tr', {}, h('th', {}, t('progress.date')), h('th', {}, t('dash.mastery')), h('th', {}, t('dash.mastered')), h('th', {}, t('dash.hard')))),
    h('tbody', {}, points.map((p) => h('tr', {}, h('td', {}, p.x), h('td', {}, p.y + '%'), h('td', {}, p.extra.mastered + '/' + p.extra.total), h('td', {}, p.extra.hard)))))));
  return wrap;
}

/** Simple bar chart: minutes per day. */
function barChart(points) {
  const W = 640; const H = 170; const P = { l: 34, r: 8, t: 10, b: 24 };
  const max = Math.max(10, ...points.map((p) => p.y));
  const top = Math.ceil(max / 10) * 10;
  const bw = (W - P.l - P.r) / points.length;
  const y = (v) => P.t + (1 - v / top) * (H - P.t - P.b);
  const grid = [0, top / 2, top].map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${P.l - 6}" y="${y(v) + 3}" text-anchor="end">${Math.round(v)}</text>`).join('');
  const bars = points.map((p, i) => {
    const x0 = P.l + i * bw + 2;
    const w = Math.max(2, bw - 4);
    const hgt = Math.max(0, y(0) - y(p.y));
    const r = Math.min(4, w / 2, hgt);
    const yt = y(p.y);
    const d = hgt <= 0 ? '' : `M${x0},${y(0)}V${yt + r}Q${x0},${yt} ${x0 + r},${yt}H${x0 + w - r}Q${x0 + w},${yt} ${x0 + w},${yt + r}V${y(0)}Z`;
    return `<g><rect x="${P.l + i * bw}" y="${P.t}" width="${bw}" height="${H - P.t - P.b}" fill="transparent"><title>${p.x}: ${p.y} min</title></rect>${d ? `<path d="${d}" fill="var(--gold)" opacity="0.85" pointer-events="none"/>` : ''}${i % 2 === 1 || i === points.length - 1 ? `<text x="${P.l + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle">${p.x.slice(8)}</text>` : ''}</g>`;
  }).join('');
  const wrap = h('div');
  wrap.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('progress.minutesTitle')}">${grid}${bars}</svg>`;
  wrap.appendChild(h('div', { class: 'small muted' }, t('progress.minutesNote')));
  return wrap;
}
