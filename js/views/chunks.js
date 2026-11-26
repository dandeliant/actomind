// ActoMind – monologue fragments: cumulative learning (A, B, A+B, C, A+B+C…), editable boundaries, start from random places.
import { h, btn, segmented, toast, emptyState, linkBtn, selectEl } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { setHeader } from '../ui/shell.js';
import { t, tn } from '../core/i18n.js';
import { getProgress, recordReview, saveScriptSoon, SessionTracker, myLines } from '../core/store.js';
import { requireScript, ratingButtons, analysisView, charName } from '../ui/common.js';
import { cueFor } from '../core/parser.js';
import { pieces, wordCount, spokenText } from '../core/tokenize.js';
import { autoBoundaries, fragments, cumulativeSteps, toggleBoundary, fragmentLabel, LONG_LINE_WORDS } from '../core/chunker.js';
import { wordHint } from '../core/hints.js';
import { qualityFromSelf, qualityFromResult } from '../core/srs.js';
import { listenFor, canListen, check, sttErrorKey } from '../ui/recall.js';

export default async function chunksView(root, params, query) {
  setHeader(t('chunks.title'));
  const script = await requireScript(root);
  if (!script) return;
  const tracker = new SessionTracker(script.id, 'chunks');
  await getProgress(script.id);
  const lines = myLines(script).filter((l) => wordCount(l.text) >= 8).sort((a, b) => wordCount(b.text) - wordCount(a.text));
  if (!lines.length) { root.appendChild(emptyState('split', t('chunks.noneTitle'), t('chunks.noneText'), linkBtn(t('learn.title'), '#/learn'))); return; }
  let line = lines.find((l) => l.id === query.line) || lines[0];
  let tab = 'learn';
  let stepIdx = 0;
  let show = 'letters'; // letters | hidden
  let phase = 'recall';
  let result = null;
  let randomK = null;

  const body = h('div');
  root.append(
    h('div', { class: 'card hero' }, h('h1', {}, t('chunks.title')), h('p', { class: 'text-2' }, t('chunks.intro'))),
    h('div', { class: 'card' },
      selectEl(lines.map((l) => ({ value: l.id, label: `${wordCount(l.text)} ${t('chunks.words')} · ${spokenText(l.text).slice(0, 60)}…` })), line.id, (v) => { line = lines.find((l) => l.id === v); stepIdx = 0; phase = 'recall'; render(); }, { 'aria-label': t('chunks.chooseLine') }),
      h('div', { style: { height: '10px' } }),
      segmented([{ value: 'learn', label: t('chunks.tabLearn') }, { value: 'random', label: t('chunks.tabRandom') }, { value: 'edit', label: t('chunks.tabEdit') }], tab, (v) => { tab = v; phase = 'recall'; randomK = null; render(); })),
    body,
  );

  const bounds = () => script.chunks[line.id] || autoBoundaries(line.text);
  const frs = () => fragments(line.text, bounds());

  function fragText(parts, presentation) {
    const all = frs();
    const el = h('div', { class: 'text', style: { fontFamily: 'var(--font-script)', fontSize: 'calc(var(--script-size)*1.05)', lineHeight: 1.8 } });
    parts.forEach((k) => {
      const f = all[k];
      const ps = pieces(f.text);
      const span = h('div', { class: 'frag' + (parts.length > 1 ? '' : ' active') }, h('span', { class: 'chip gold', style: { marginRight: '8px' } }, fragmentLabel(k)));
      for (const p of ps) {
        if (p.type === 'dir') span.appendChild(h('span', { class: 'dir' }, p.text));
        else if (p.type === 'sep') span.appendChild(document.createTextNode(p.text));
        else if (presentation === 'full') span.appendChild(document.createTextNode(p.text));
        else if (presentation === 'letters') span.appendChild(h('span', { class: 'w w-hint' }, wordHint(p.text, 'first')));
        else span.appendChild(h('span', { class: 'w w-hidden' }, p.text));
      }
      el.appendChild(span);
    });
    return el;
  }

  function cueEl(firstPart) {
    const all = frs();
    if (firstPart > 0) return h('div', { class: 'cue-card' }, h('div', { class: 'who gold' }, t('chunks.prevFragment', { l: fragmentLabel(firstPart - 1) })), h('div', { class: 'text' }, '… ' + all[firstPart - 1].text));
    const cue = cueFor(script.items, script.items.indexOf(line));
    return h('div', { class: 'cue-card' }, h('div', { class: 'who' }, cue.kind === 'line' ? charName(script, cue.item.charId) : t('trainer.sceneStart')), h('div', { class: 'text' }, cue.item?.text || '—'));
  }

  async function rate(parts, q, isFull) {
    const all = frs();
    const newest = parts[parts.length - 1];
    if (isFull) await recordReview(script, line.id, { q, src: 'chunks' });
    else await recordReview(script, line.id + '#' + newest, { q, src: 'chunks' });
    tracker.reviews++;
    if (tab === 'learn') {
      if (q < 3) { toast(t('chunks.repeatStep')); }
      else stepIdx = Math.min(cumulativeSteps(all.length).length - 1, stepIdx + 1);
    } else randomK = null;
    phase = 'recall';
    result = null;
    render();
  }

  function recallBlock(parts, isFull) {
    const ref = parts.map((k) => spokenText(frs()[k].text)).join(' ');
    const box = h('div');
    if (phase === 'recall') {
      box.append(
        h('div', { class: 'row', style: { justifyContent: 'center', marginBottom: '8px' } }, segmented([{ value: 'letters', label: t('chunks.showLetters') }, { value: 'hidden', label: t('chunks.showHidden') }], show, (v) => { show = v; render(); })),
        fragText(parts, show),
        h('div', { class: 'big-controls', style: { marginTop: '12px' } },
          btn(t('trainer.sayIt'), async () => {
            if (!(await canListen())) { toast(t('trainer.noMicFallback'), { type: 'error' }); return; }
            phase = 'listening';
            render();
            const tr = body.querySelector('.transcript');
            const res = await listenFor(script, ref, { onInterim: (x) => { if (tr) tr.textContent = x; tracker.activity(); } });
            if (!res || (res.error && !res.transcript)) { if (res?.error) toast(t(sttErrorKey(res.error)), { type: 'error' }); phase = 'recall'; render(); return; }
            result = check(script, ref, res.transcript);
            phase = 'result';
            render();
          }, { cls: 'btn-lg', icon: 'mic' }),
          btn(t('trainer.showRate'), () => { phase = 'rate'; render(); }, { cls: 'btn-lg btn-primary', icon: 'eye' })));
    } else if (phase === 'listening') {
      box.append(fragText(parts, show), h('div', { class: 'center', style: { marginTop: '10px' } }, h('span', { class: 'listening' }, t('trainer.listening'))), h('div', { class: 'transcript center' }, '…'));
    } else if (phase === 'result') {
      box.append(analysisView(result, (nr) => { result = nr; }), h('div', { class: 'row end', style: { marginTop: '8px' } },
        btn(t('trainer.retry'), () => { phase = 'recall'; render(); }, { cls: 'btn-ghost', icon: 'repeat' }),
        btn(t('trainer.saveNext'), () => rate(parts, qualityFromResult({ score: result.score }), isFull), { cls: 'btn-primary', icon: 'check' })));
    } else {
      box.append(fragText(parts, 'full'), h('p', { class: 'center text-2', style: { marginTop: '10px' } }, t('trainer.howWell')), ratingButtons((r) => rate(parts, qualityFromSelf(r), isFull)));
    }
    return box;
  }

  function render() {
    body.replaceChildren();
    const all = frs();
    if (tab === 'edit') {
      const ps = pieces(line.text);
      const b = new Set(bounds());
      const n = wordCount(line.text);
      const ed = h('div', { class: 'card script', style: { lineHeight: 2.2 } });
      ps.forEach((p) => {
        if (p.type === 'word') {
          if (p.index > 0) ed.appendChild(h('span', { class: b.has(p.index) ? 'chunk-sep' : 'chunk-gap', role: 'button', tabindex: '0', title: t('chunks.toggleBoundary'), onclick: () => { script.chunks[line.id] = toggleBoundary(bounds(), p.index, n); saveScriptSoon(script); render(); } }, b.has(p.index) ? '' : '|'));
          ed.appendChild(h('span', { class: 'chunk-word' }, p.text));
        } else if (p.type === 'dir') ed.appendChild(h('span', { class: 'dir-inline' }, p.text));
        else ed.appendChild(document.createTextNode(p.text.replace(/\s+/g, ' ')));
      });
      body.append(
        h('p', { class: 'small text-2' }, t('chunks.editHint')), ed,
        h('div', { class: 'row' }, btn(t('chunks.auto'), () => { delete script.chunks[line.id]; saveScriptSoon(script); render(); }, { cls: 'btn-sm', icon: 'sparkles' }), h('span', { class: 'chip' }, tn('chunks.fragmentsN', all.length))),
        h('div', { class: 'section-title' }, t('chunks.preview')),
        ...all.map((f) => h('div', { class: 'frag' }, h('span', { class: 'chip gold', style: { marginRight: '8px' } }, fragmentLabel(f.index)), f.text)));
      return;
    }
    if (all.length < 2) {
      body.appendChild(h('div', { class: 'card' }, h('p', {}, t('chunks.single')), btn(t('chunks.tabEdit'), () => { tab = 'edit'; render(); }, { cls: 'btn-sm' })));
    }
    if (tab === 'learn') {
      const steps = cumulativeSteps(all.length);
      stepIdx = Math.min(stepIdx, steps.length - 1);
      const step = steps[stepIdx];
      body.append(
        h('div', { class: 'card flat' },
          h('div', { class: 'row' }, steps.map((s, i) => h('button', { type: 'button', class: 'chip' + (i === stepIdx ? ' gold' : ''), 'aria-pressed': String(i === stepIdx), onclick: () => { stepIdx = i; phase = 'recall'; render(); } }, s.label + (s.full ? ' ★' : '')))),
          h('p', { class: 'small muted', style: { marginTop: '8px' } }, t('chunks.stepInfo', { cur: stepIdx + 1, n: steps.length }))),
        h('div', { class: 'trainer' }, cueEl(step.parts[0]), recallBlock(step.parts, step.full)));
    } else {
      if (randomK == null) randomK = Math.floor(Math.random() * all.length);
      const parts = all.map((_, i) => i).filter((i) => i >= randomK);
      body.append(h('div', { class: 'card flat' }, h('p', { class: 'small' }, icon('shuffle'), ' ', t('chunks.randomInfo', { l: fragmentLabel(randomK) })), btn(t('chunks.drawAgain'), () => { randomK = null; phase = 'recall'; render(); }, { cls: 'btn-sm', icon: 'shuffle' })),
        h('div', { class: 'trainer' }, cueEl(randomK), recallBlock(parts, randomK === 0)));
    }
  }
  render();
  return () => tracker.stop();
}
