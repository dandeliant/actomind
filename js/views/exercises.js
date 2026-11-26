// ActoMind – text assembly exercises generated automatically from the script.
import { h, btn, segmented, toast, emptyState, linkBtn } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { setHeader } from '../ui/shell.js';
import { t } from '../core/i18n.js';
import { getProgress, recordReview, SessionTracker, myLines, charById } from '../core/store.js';
import { requireScript, scenePicker, itemsInScene, analysisView, charName } from '../ui/common.js';
import { cueFor } from '../core/parser.js';
import { pieces, words, spokenText, normalizeWord, stripDiacritics, sentences } from '../core/tokenize.js';
import { autoBoundaries, fragments } from '../core/chunker.js';
import { shuffle, shuffleDifferent, pickRandom } from '../core/util.js';
import { qualityFromResult } from '../core/srs.js';
import { check } from '../ui/recall.js';

const TYPES = ['scramble', 'fragments', 'cloze', 'beginning', 'match', 'typeAll', 'order'];

export default async function exercisesView(root, params, query) {
  setHeader(t('ex.title'));
  const script = await requireScript(root);
  if (!script) return;
  await getProgress(script.id);
  const tracker = new SessionTracker(script.id, 'exercises');
  let type = TYPES.includes(query.type) ? query.type : 'scramble';
  let sceneId = '';
  let score = { ok: 0, all: 0 };
  const body = h('div', { class: 'trainer' });
  const scoreEl = h('span', { class: 'chip green' });

  root.append(
    h('div', { class: 'card hero' }, h('h1', {}, t('ex.title')), h('p', { class: 'text-2' }, t('ex.intro'))),
    h('div', { class: 'card' },
      h('div', { class: 'row', style: { marginBottom: '10px' } }, scenePicker(script, sceneId, (v) => { sceneId = v; next(); }), scoreEl),
      segmented(TYPES.map((x) => ({ value: x, label: t('ex.types.' + x) })), type, (v) => { type = v; next(); })),
    body,
  );

  const pool = () => {
    const inScene = new Set(itemsInScene(script, sceneId).map((x) => x.id));
    return myLines(script).filter((l) => inScene.has(l.id) && words(l.text).length >= 2);
  };
  const updScore = () => { scoreEl.textContent = t('ex.score', { ok: score.ok, all: score.all }); };
  const norm = (w) => stripDiacritics(normalizeWord(w));

  async function done(line, success, { q = null, weight = 0.3 } = {}) {
    score.all++;
    if (success) score.ok++;
    updScore();
    tracker.reviews++;
    if (line) await recordReview(script, line.id, { q: q ?? (success ? 4 : 1.5), src: 'ex-' + type, weight });
  }

  function cue(line) {
    const c = cueFor(script.items, script.items.indexOf(line));
    return h('div', { class: 'cue-card' }, h('div', { class: 'who', style: { color: c.kind === 'line' ? charById(script, c.item.charId)?.color : null } }, c.kind === 'line' ? charName(script, c.item.charId) : t('trainer.sceneStart')), h('div', { class: 'text' }, c.item?.text || '—'));
  }

  /** Tap-to-order component */
  function orderer(itemsCorrect, { display = (x) => x, onCheck }) {
    const shuffled = shuffleDifferent(itemsCorrect.map((x, i) => ({ x, i })));
    const chosen = [];
    const wrap = h('div');
    let checked = false;
    const render = () => {
      wrap.replaceChildren(
        h('div', { class: 'drop-zone', 'aria-label': t('ex.yourAnswer') }, chosen.length ? chosen.map((c, pos) => h('button', {
          type: 'button', class: 'word-chip' + (checked ? (c.i === pos ? ' ok' : ' bad') : ''),
          onclick: () => { if (checked) return; chosen.splice(pos, 1); render(); },
        }, display(c.x))) : h('span', { class: 'muted small' }, t('ex.tapHint'))),
        h('div', { style: { margin: '10px 0' } }, shuffled.map((c) => h('button', { type: 'button', class: 'word-chip' + (chosen.includes(c) ? ' used' : ''), onclick: () => { if (checked) return; chosen.push(c); render(); } }, display(c.x)))),
        h('div', { class: 'row end' },
          checked ? null : btn(t('ex.reset'), () => { chosen.length = 0; render(); }, { cls: 'btn-ghost btn-sm', icon: 'refresh' }),
          checked ? btn(t('ex.next'), next, { cls: 'btn-primary', icon: 'right' }) : btn(t('trainer.check'), () => {
            if (chosen.length < shuffled.length) { toast(t('ex.useAll')); return; }
            checked = true;
            const ok = chosen.every((c, pos) => c.i === pos);
            render();
            onCheck(ok, chosen.filter((c, pos) => c.i === pos).length / chosen.length);
          }, { cls: 'btn-primary', icon: 'check' })));
    };
    render();
    return wrap;
  }

  function resultBanner(ok, correctText) {
    return h('div', { class: 'banner ' + (ok ? 'ok' : 'bad') }, icon(ok ? 'check' : 'x'), h('div', {}, h('strong', {}, ok ? t('ex.correct') : t('ex.incorrect')), correctText ? h('div', { style: { fontFamily: 'var(--font-script)' } }, correctText) : null));
  }

  function next() {
    body.replaceChildren();
    const lines = pool();
    if (!lines.length) { body.appendChild(emptyState('puzzle', t('ex.noLines'), '', linkBtn(t('learn.title'), '#/learn'))); return; }
    const fb = h('div');
    if (type === 'scramble') {
      const cands = lines.filter((l) => words(l.text).length >= 3 && words(l.text).length <= 22);
      const line = pickRandom(cands.length ? cands : lines);
      const ws = words(spokenText(line.text));
      body.append(h('h3', {}, t('ex.types.scramble')), h('p', { class: 'small muted' }, t('ex.desc.scramble')), cue(line),
        orderer(ws, { onCheck: (ok) => { fb.replaceChildren(resultBanner(ok, spokenText(line.text))); done(line, ok); } }), fb);
    } else if (type === 'fragments') {
      const withParts = lines.map((l) => {
        let parts = fragments(l.text, autoBoundaries(l.text, { target: 6, min: 2, max: 9 })).map((f) => f.text);
        if (parts.length < 3) parts = sentences(spokenText(l.text));
        if (parts.length < 3) parts = spokenText(l.text).split(/(?<=[,;:—–])\s+/);
        return { l, parts };
      }).filter((x) => x.parts.length >= 3);
      if (!withParts.length) { body.appendChild(h('p', { class: 'muted' }, t('ex.noFragments'))); return; }
      const { l, parts } = pickRandom(withParts);
      body.append(h('h3', {}, t('ex.types.fragments')), h('p', { class: 'small muted' }, t('ex.desc.fragments')), cue(l),
        orderer(parts.slice(0, 8), { onCheck: (ok) => { fb.replaceChildren(resultBanner(ok, spokenText(l.text))); done(l, ok); } }), fb);
    } else if (type === 'cloze') {
      const line = pickRandom(lines.filter((l) => words(l.text).length >= 4).length ? lines.filter((l) => words(l.text).length >= 4) : lines);
      const ps = pieces(line.text);
      const ws = ps.filter((p) => p.type === 'word');
      const candidates = ws.filter((p) => p.text.length >= 4);
      const n = Math.max(1, Math.round((candidates.length || ws.length) * 0.35));
      const hidden = new Set(shuffle(candidates.length ? candidates : ws).slice(0, n).map((p) => p.index));
      const inputs = new Map();
      const text = h('div', { class: 'answer-card' }, h('div', { class: 'text', style: { lineHeight: 2.2 } }, ps.map((p) => {
        if (p.type === 'dir') return h('span', { class: 'dir' }, p.text);
        if (p.type === 'sep') return document.createTextNode(p.text);
        if (!hidden.has(p.index)) return document.createTextNode(p.text);
        const inp = h('input', { type: 'text', 'aria-label': t('ex.missingWord'), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', style: { width: Math.max(4, p.text.length + 1) + 'ch', minHeight: '36px', display: 'inline-block', padding: '4px 6px' } });
        inputs.set(p.index, { inp, word: p.text });
        return inp;
      })));
      const checkBtn = btn(t('trainer.check'), () => {
        let okN = 0;
        for (const { inp, word } of inputs.values()) {
          const good = norm(inp.value.trim()) === norm(word);
          if (good) okN++;
          inp.style.borderColor = good ? 'var(--ok)' : 'var(--bad)';
          if (!good) inp.value = inp.value + ' → ' + word;
          inp.disabled = true;
        }
        const ok = okN === inputs.size;
        fb.replaceChildren(resultBanner(ok, null), h('div', { class: 'row end' }, btn(t('ex.next'), next, { cls: 'btn-primary', icon: 'right' })));
        checkBtn.remove();
        done(line, ok, { q: Math.min(4, 1 + 3 * (okN / inputs.size)), weight: 1 });
      }, { cls: 'btn-primary', icon: 'check' });
      body.append(h('h3', {}, t('ex.types.cloze')), h('p', { class: 'small muted' }, t('ex.desc.cloze')), cue(line), text, h('div', { class: 'row end', style: { marginTop: '10px' } }, checkBtn), fb);
    } else if (type === 'beginning') {
      const withCue = lines.filter((l) => cueFor(script.items, script.items.indexOf(l)).kind === 'line');
      const line = pickRandom(withCue.length ? withCue : lines);
      const begin = (l) => words(spokenText(l.text)).slice(0, 5).join(' ') + '…';
      const others = shuffle(myLines(script).filter((l) => l.id !== line.id && begin(l) !== begin(line))).slice(0, 3);
      const opts = shuffle([line, ...others]);
      let answered = false;
      body.append(h('h3', {}, t('ex.types.beginning')), h('p', { class: 'small muted' }, t('ex.desc.beginning')), cue(line),
        h('div', { class: 'col' }, opts.map((o) => {
          const b = btn(begin(o), () => {
            if (answered) return;
            answered = true;
            const ok = o.id === line.id;
            b.classList.add(ok ? 'rate-perfect' : 'rate-again');
            b.style.background = ok ? 'var(--ok-soft)' : 'var(--bad-soft)';
            fb.replaceChildren(resultBanner(ok, spokenText(line.text)), h('div', { class: 'row end' }, btn(t('ex.next'), next, { cls: 'btn-primary', icon: 'right' })));
            done(line, ok);
          }, { cls: 'btn-lg btn-block' });
          b.style.justifyContent = 'flex-start';
          b.style.fontFamily = 'var(--font-script)';
          return b;
        })), fb);
    } else if (type === 'match') {
      const withCue = shuffle(lines.filter((l) => cueFor(script.items, script.items.indexOf(l)).kind === 'line')).slice(0, 4);
      if (withCue.length < 2) { body.appendChild(h('p', { class: 'muted' }, t('ex.needMore'))); return; }
      const cues = withCue.map((l) => ({ l, c: cueFor(script.items, script.items.indexOf(l)).item }));
      const answers = shuffle(withCue);
      const pairs = new Map(); // cue line id → answer line id
      let selCue = null;
      const short = (txt, n = 10) => { const w = words(spokenText(txt)); return w.slice(0, n).join(' ') + (w.length > n ? '…' : ''); };
      const render = (checked = false) => {
        body.replaceChildren(h('h3', {}, t('ex.types.match')), h('p', { class: 'small muted' }, t('ex.desc.match')),
          h('div', { class: 'grid grid-2 stack-sm' },
            h('div', { class: 'col' }, h('div', { class: 'label' }, t('ex.partnerCues')), cues.map((x, i) => btn(h('span', {}, h('strong', {}, (i + 1) + '. '), short(x.c.text)), () => { if (checked) return; selCue = x.l.id; render(); }, {
              cls: 'btn-block' + (selCue === x.l.id ? ' active' : '') + (checked ? (pairs.get(x.l.id) === x.l.id ? ' rate-perfect' : ' rate-again') : ''),
            }))),
            h('div', { class: 'col' }, h('div', { class: 'label' }, t('ex.myAnswers')), answers.map((a) => {
              const assigned = [...pairs.entries()].find(([, v]) => v === a.id);
              const num = assigned ? cues.findIndex((x) => x.l.id === assigned[0]) + 1 : null;
              return btn(h('span', {}, num ? h('strong', { class: 'gold' }, num + ' → ') : '', short(a.text)), () => {
                if (checked || !selCue) return;
                for (const [k, v] of pairs) if (v === a.id) pairs.delete(k);
                pairs.set(selCue, a.id);
                selCue = null;
                render();
              }, { cls: 'btn-block' });
            }))),
          fb,
          h('div', { class: 'row end', style: { marginTop: '10px' } }, checked ? btn(t('ex.next'), next, { cls: 'btn-primary', icon: 'right' }) : btn(t('trainer.check'), () => {
            if (pairs.size < cues.length) { toast(t('ex.useAll')); return; }
            const okN = cues.filter((x) => pairs.get(x.l.id) === x.l.id).length;
            fb.replaceChildren(resultBanner(okN === cues.length, null));
            cues.forEach((x) => recordReview(script, x.l.id, { q: pairs.get(x.l.id) === x.l.id ? 4 : 1.5, src: 'ex-match', weight: 0.3 }));
            score.all++; if (okN === cues.length) score.ok++; updScore();
            render(true);
          }, { cls: 'btn-primary', icon: 'check' })));
      };
      render();
      return;
    } else if (type === 'typeAll') {
      const line = pickRandom(lines);
      const ta = h('textarea', { placeholder: t('trainer.typePh'), style: { fontFamily: 'var(--font-script)' }, 'aria-label': t('ex.types.typeAll') });
      const checkBtn = btn(t('trainer.check'), () => {
        const r = check(script, spokenText(line.text), ta.value);
        fb.replaceChildren(analysisView(r), h('div', { class: 'row end', style: { marginTop: '8px' } }, btn(t('ex.next'), next, { cls: 'btn-primary', icon: 'right' })));
        checkBtn.remove();
        ta.disabled = true;
        done(line, r.passed, { q: qualityFromResult({ score: r.score }), weight: 1 });
      }, { cls: 'btn-primary', icon: 'check' });
      body.append(h('h3', {}, t('ex.types.typeAll')), h('p', { class: 'small muted' }, t('ex.desc.typeAll')), cue(line), ta, h('div', { class: 'row end', style: { marginTop: '8px' } }, checkBtn), fb);
    } else if (type === 'order') {
      const seq = lines;
      if (seq.length < 3) { body.appendChild(h('p', { class: 'muted' }, t('ex.needMore'))); return; }
      const start = Math.floor(Math.random() * Math.max(1, seq.length - 4));
      const chunk = seq.slice(start, start + Math.min(5, seq.length));
      const short = (l) => { const w = words(spokenText(l.text)); return w.slice(0, 8).join(' ') + (w.length > 8 ? '…' : ''); };
      body.append(h('h3', {}, t('ex.types.order')), h('p', { class: 'small muted' }, t('ex.desc.order')),
        orderer(chunk, { display: short, onCheck: (ok) => { fb.replaceChildren(resultBanner(ok, null)); score.all++; if (ok) score.ok++; updScore(); chunk.forEach((l) => recordReview(script, l.id, { q: ok ? 4 : 2, src: 'ex-order', weight: 0.3 })); } }), fb);
    }
  }
  updScore();
  next();
  return () => tracker.stop();
}
