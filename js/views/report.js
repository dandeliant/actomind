// ActoMind – rehearsal report (partner / dress rehearsal).
import { h, linkBtn, statBox, emptyState, btn } from '../ui/dom.js';
import { setHeader } from '../ui/shell.js';
import { t, tn, fmtDateTime } from '../core/i18n.js';
import { db } from '../core/db.js';
import { getScript, charById } from '../core/store.js';
import { spokenText } from '../core/tokenize.js';
import { formatDuration } from '../core/util.js';
import { scenesOf } from '../core/parser.js';

export function recommendations(report) {
  const rec = [];
  const lines = report.lines;
  const weak = lines.filter((l) => l.skipped || l.score < 0.8);
  const hinted = lines.filter((l) => l.hintLevel > 0 || l.revealed > 0);
  const slow = lines.filter((l) => l.latency != null && l.latency > 4500);
  const missedWords = lines.reduce((s, l) => s + (l.missed || 0), 0);
  if (weak.length) rec.push({ key: 'weak', href: '#/learn/train/hardest', n: weak.length });
  if (hinted.length) rec.push({ key: 'hinted', href: '#/learn/train/letters', n: hinted.length });
  if (slow.length) rec.push({ key: 'slow', href: '#/learn/train/cues', n: slow.length });
  if (missedWords >= 3) rec.push({ key: 'missed', href: '#/learn/chunks', n: missedWords });
  if (!weak.length && !hinted.length) rec.push({ key: report.kind === 'dress' ? 'perfectDress' : 'perfect', href: report.kind === 'dress' ? '#/rehearse/dress' : '#/rehearse/dress', n: 0 });
  if (report.strictness !== 'professional' && report.accuracy >= 0.9) rec.push({ key: 'stricter', href: '#/rehearse/partner', n: 0 });
  return rec;
}

export default async function reportView(root, params) {
  setHeader(t('report.title'));
  const r = await db.get('rehearsals', params.id);
  if (!r) { root.appendChild(emptyState('alert', t('report.notFound'), '', linkBtn(t('nav.rehearse'), '#/rehearse'))); return; }
  const script = await getScript(r.scriptId);
  if (!script) { root.appendChild(emptyState('alert', t('report.notFound'), '')); return; }
  const byId = new Map(script.items.map((i) => [i.id, i]));
  const scene = r.sceneId ? scenesOf(script.items).find((s) => s.id === r.sceneId) : null;
  const acc = Math.round(r.accuracy * 100);
  const delta = r.prev ? Math.round((r.accuracy - r.prev.accuracy) * 100) : null;
  const hintDelta = r.prev ? r.hints - r.prev.hints : null;
  const problems = r.lines.filter((l) => l.skipped || l.score < 0.8 || l.hintLevel > 0 || l.revealed > 0);
  const recs = recommendations(r);

  root.append(
    h('div', { class: 'card hero' },
      h('div', { class: 'small muted' }, (r.kind === 'dress' ? t('dress.title') : t('partner.title')) + ' · ' + fmtDateTime(r.date) + ' · ' + formatDuration(r.durationMs)),
      h('h1', {}, script.title),
      h('div', { class: 'small text-2' }, (scene ? scene.title : t('common.allScenes')) + ' · ' + t('partner.strict.' + r.strictness) + ' · ' + (r.stt ? t('report.sttMode') : t('report.manualMode')) + (r.complete ? '' : ' · ' + t('report.incomplete'))),
      h('div', { class: 'grid grid-4', style: { marginTop: '14px' } },
        statBox(acc + '%', t('report.accuracy'), acc >= 90 ? 'var(--ok)' : acc >= 70 ? 'var(--warn)' : 'var(--bad)'),
        statBox(r.hints, t('report.hints'), 'var(--info)'),
        statBox(problems.length, t('report.problemLines'), 'var(--bad)'),
        statBox(r.lines.filter((l) => l.skipped).length, t('report.skipped'))),
      r.prev
        ? h('p', { style: { marginTop: '12px' } }, t('report.vsPrev', { date: fmtDateTime(r.prev.date) }), ' ',
          h('span', { class: 'chip ' + (delta >= 0 ? 'green' : 'red') }, (delta >= 0 ? '+' : '') + delta + ' pp'), ' ',
          h('span', { class: 'chip ' + (hintDelta <= 0 ? 'green' : 'orange') }, t('report.hintsDelta', { d: (hintDelta > 0 ? '+' : '') + hintDelta })))
        : h('p', { class: 'small muted', style: { marginTop: '12px' } }, t('report.firstOne')),
      h('p', { class: 'hint' }, t('analysis.disclaimer'))),
    h('div', { class: 'section-title' }, t('report.recommendations')),
    h('div', { class: 'list' }, recs.map((x) => h('a', { class: 'list-item', href: x.href }, h('div', { class: 'grow' }, h('div', { class: 'title' }, t('report.rec.' + x.key + '.title', { n: x.n })), h('div', { class: 'sub' }, t('report.rec.' + x.key + '.text'))), h('span', { class: 'gold' }, '→')))),
    h('div', { class: 'section-title' }, t('report.problemLines')),
    problems.length
      ? h('div', { class: 'list' }, problems.map((l) => {
        const it = byId.get(l.lineId);
        return h('div', { class: 'card flat', style: { marginBottom: '0' } },
          h('div', { class: 'row between' },
            h('strong', { style: { color: charById(script, it?.charId)?.color } }, charById(script, it?.charId)?.name || ''),
            h('div', { class: 'row' },
              l.skipped ? h('span', { class: 'chip red' }, t('partner.skipped')) : h('span', { class: 'chip ' + (l.score >= 0.8 ? 'green' : 'orange') }, l.percent + '%'),
              l.hintLevel ? h('span', { class: 'chip blue' }, t('report.hintLevel.' + l.hintLevel)) : null,
              l.attempts > 1 ? h('span', { class: 'chip' }, tn('report.attemptsN', l.attempts)) : null,
              l.latency != null ? h('span', { class: 'chip' }, (l.latency / 1000).toFixed(1) + ' s') : null)),
          h('div', { style: { fontFamily: 'var(--font-script)', margin: '6px 0' } }, it ? spokenText(it.text) : '—'),
          l.problemSpans?.length ? h('div', { class: 'small' }, h('strong', {}, t('report.missedFragments') + ': '), l.problemSpans.map((p) => '„' + p.text + '”').join(', ')) : null,
          l.transcript ? h('div', { class: 'small muted' }, t('analysis.heardAll') + ': „' + l.transcript + '”') : null,
          h('div', { class: 'row', style: { marginTop: '6px' } }, h('a', { class: 'btn btn-sm', href: `#/rehearse/partner?from=${l.lineId}` }, t('report.practiceHere'))));
      }))
      : h('p', { class: 'text-2' }, t('report.noProblems')),
    h('div', { class: 'row', style: { marginTop: '16px' } },
      linkBtn(t('report.again'), r.kind === 'dress' ? '#/rehearse/dress' : '#/rehearse/partner', { cls: 'btn-primary', icon: 'repeat' }),
      linkBtn(t('nav.progress'), '#/progress', { icon: 'chart' }),
      linkBtn(t('nav.rehearse'), '#/rehearse', { icon: 'masks' })),
  );
}
