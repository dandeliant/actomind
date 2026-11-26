// ActoMind – active recall trainer: vanishing words, first letters, flashcards, smart review, random entrances, hardest lines.
import { h, btn, iconBtn, segmented, rangeEl, toast, banner, linkBtn, selectEl, emptyState, promptDialog } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { setHeader, navigate } from '../ui/shell.js';
import { t, tn } from '../core/i18n.js';
import { settings, setSetting, getProgress, recordReview, setFlagged, lineState, SessionTracker, saveScriptSoon, charById } from '../core/store.js';
import { requireScript, whoLabel, scenePicker, itemsInScene, ratingButtons, keys, analysisView, charName } from '../ui/common.js';
import { cueFor, scenesOf, sceneOfIndex } from '../core/parser.js';
import { pieces, wordCount, spokenText } from '../core/tokenize.js';
import { hiddenSet, wordHint, HINT_MODES } from '../core/hints.js';
import { autoBoundaries, fragments, isLong } from '../core/chunker.js';
import { buildQueue, qualityFromResult, qualityFromSelf, priority } from '../core/srs.js';
import { shuffle, hash32, avg } from '../core/util.js';
import { listenFor, canListen, check, sttErrorKey } from '../ui/recall.js';
import { speakItem, stopAllSpeech } from '../audio/voice-engine.js';

const MODES = ['vanish', 'letters', 'cards', 'review', 'cues', 'hardest'];

export default async function trainerView(root, params, query) {
  const mode = MODES.includes(params.mode) ? params.mode : 'review';
  setHeader(t('trainer.' + mode + '.title'));
  const script = await requireScript(root);
  if (!script) return;
  const progress = await getProgress(script.id);
  const tracker = new SessionTracker(script.id, mode);
  const items = script.items;
  const mine = new Set(script.myRoles);
  let sceneId = query.scene || '';
  let pool = query.pool || (mode === 'cues' ? 'all' : '');
  let vanishLevel = settings.vanishLevel ?? 50;
  let hintMode = settings.hintMode || 'first';
  let editSyllables = false;

  // -------------------------------------------------------- cards
  function lineCards() {
    const inScene = new Set(itemsInScene(script, sceneId).map((x) => x.id));
    const out = [];
    items.forEach((it, idx) => {
      if (it.type !== 'line' || !mine.has(it.charId) || !inScene.has(it.id) || !spokenText(it.text)) return;
      out.push({ id: it.id, lineId: it.id, item: it, idx, text: it.text, cue: cueFor(items, idx) });
    });
    return out;
  }
  function withChunks(cards) {
    const out = [];
    for (const c of cards) {
      if (isLong(c.text)) {
        const fr = fragments(c.text, script.chunks[c.lineId] || autoBoundaries(c.text));
        if (fr.length > 1) {
          fr.forEach((f, k) => out.push({ ...c, id: c.lineId + '#' + k, text: f.text, cue: k === 0 ? c.cue : { kind: 'fragment', text: fr[k - 1].text, item: c.item }, fragment: { k, n: fr.length } }));
        }
      }
      out.push(c);
    }
    return out;
  }

  function buildDeck() {
    const base = lineCards();
    if (mode === 'vanish' || mode === 'letters') {
      let start = 0;
      if (query.from) start = Math.max(0, base.findIndex((c) => c.lineId === query.from));
      return base.slice(start).concat(base.slice(0, start));
    }
    if (mode === 'cards' || mode === 'review') {
      const deck = mode === 'cards' ? withChunks(base) : base;
      const byId = new Map(deck.map((c) => [c.id, c]));
      const q = buildQueue(deck.map((c) => c.id), progress.records, { newLimit: settings.newPerSession, includeNotDue: mode === 'cards', minSize: 12 });
      return q.queue.map((id) => byId.get(id)).filter(Boolean);
    }
    if (mode === 'hardest') {
      return base.filter((c) => { const st = lineState(progress.records, c.lineId); return st.status === 'hard' || st.rec?.flagged; })
        .sort((a, b) => priority(progress.records[b.lineId]) - priority(progress.records[a.lineId]));
    }
    // cues: random entrances – lines preceded by a partner line
    let cands = base.filter((c) => c.cue.kind === 'line' && !mine.has(c.cue.item.charId));
    if (pool === 'hard') cands = cands.filter((c) => { const st = lineState(progress.records, c.lineId); return st.status === 'hard' || st.rec?.flagged; });
    if (pool === 'new') cands = cands.filter((c) => lineState(progress.records, c.lineId).status !== 'mastered');
    return shuffle(cands).slice(0, 20);
  }

  // -------------------------------------------------------- state
  let deck = [];
  let pos = 0;
  let results = [];
  let card = null;
  let st = null; // per-card state
  const requeued = new Map();
  let listenCtrl = null;

  const head = h('div', { class: 'card flat no-print' });
  const stage = h('div', { class: 'trainer' });
  root.append(head, stage);

  function renderHead() {
    head.replaceChildren(
      h('div', { class: 'row between' },
        h('div', {}, h('h2', { style: { margin: 0 } }, t('trainer.' + mode + '.title')), h('div', { class: 'small muted' }, t('trainer.' + mode + '.desc'))),
        h('div', { class: 'row' },
          mode === 'cues' ? selectEl([
            { value: 'all', label: t('trainer.poolAll') }, { value: 'scene', label: t('trainer.poolScene') },
            { value: 'hard', label: t('trainer.poolHard') }, { value: 'new', label: t('trainer.poolNew') },
          ], pool, (v) => { pool = v; if (v !== 'scene') sceneId = ''; renderHead(); restart(); }, { 'aria-label': t('trainer.pool') }) : null,
          (mode !== 'cues' || pool === 'scene') ? scenePicker(script, sceneId, (v) => { sceneId = v; restart(); }) : null)),
      mode === 'vanish' ? h('div', { style: { marginTop: '10px' } },
        h('div', { class: 'label' }, t('trainer.vanish.level')),
        segmented([0, 25, 50, 75, 90, 100].map((v) => ({ value: v, label: v + '%' })), [0, 25, 50, 75, 90, 100].includes(vanishLevel) ? vanishLevel : -1, (v) => { vanishLevel = v; setSetting('vanishLevel', v); slider.setValue(v); renderCard(); }),
        (slider = rangeEl({ min: 0, max: 100, step: 5, value: vanishLevel, format: (x) => x + '%', onInput: (x) => { vanishLevel = x; renderCard(); }, onChange: (x) => setSetting('vanishLevel', x), label: t('trainer.vanish.level') })),
        h('div', { class: 'hint' }, t('trainer.vanish.levelHint.' + levelName(vanishLevel)))) : null,
      mode === 'letters' ? h('div', { style: { marginTop: '10px' } },
        segmented(HINT_MODES.map((m) => ({ value: m, label: t('trainer.letters.mode.' + m) })), hintMode, (v) => { hintMode = v; setSetting('hintMode', v); renderHead(); renderCard(); }),
        hintMode === 'syllable' ? h('div', { class: 'row', style: { marginTop: '6px' } }, btn(editSyllables ? t('trainer.letters.editDone') : t('trainer.letters.editSyl'), () => { editSyllables = !editSyllables; renderHead(); renderCard(); }, { cls: 'btn-sm', icon: 'edit', pressed: editSyllables }), h('span', { class: 'hint' }, t('trainer.letters.sylHint'))) : null) : null,
    );
  }
  let slider = null;
  const levelName = (v) => (v === 0 ? '0' : v <= 25 ? '25' : v <= 50 ? '50' : v <= 75 ? '75' : v < 100 ? '90' : '100');

  function restart() {
    deck = buildDeck();
    pos = 0;
    results = [];
    requeued.clear();
    next(true);
  }

  function presentation(c) {
    if (mode === 'vanish') return 'vanish';
    if (mode === 'letters') return 'letters';
    if (mode === 'cards') return 'flash';
    if (mode === 'review') {
      const m = lineState(progress.records, c.lineId).mastery;
      if (m < 0.3) return 'letters';
      if (m < 0.6) return 'vanish75';
      return 'hidden';
    }
    return 'hidden';
  }

  function next(first = false) {
    listenCtrl?.abort();
    stopAllSpeech();
    if (!first) pos++;
    if (pos >= deck.length) return renderSummary();
    card = deck[pos];
    st = { revealed: new Set(), hintLevel: 0, shown: false, flipped: false, phase: 'recall', result: null, typed: '', start: performance.now(), pres: presentation(card), attempt: (st && st.cardId === card.id) ? st.attempt + 1 : 1, cardId: card.id };
    renderCard();
    if (mode === 'cues' && settings.autoSpeakCue && card.cue.kind === 'line') speakCue();
  }

  async function speakCue() {
    if (card.cue.kind !== 'line') return;
    try { await speakItem(script, card.cue.item.charId, spokenText(card.cue.item.text), card.cue.item.id); } catch { /* cancelled */ }
  }

  // -------------------------------------------------------- render
  function cueBox() {
    const c = card.cue;
    if (c.kind === 'line') {
      const ch = charById(script, c.item.charId);
      return h('div', { class: 'cue-card', style: { borderLeftColor: ch?.color } },
        h('div', { class: 'row between' }, h('div', { class: 'who', style: { color: ch?.color } }, ch?.name, mine.has(c.item.charId) ? ' · ' + t('common.myRole') : ''), iconBtn('volume', t('trainer.playCue'), speakCue, 'btn-sm btn-ghost')),
        h('div', { class: 'text' }, c.item.text));
    }
    if (c.kind === 'fragment') {
      return h('div', { class: 'cue-card' }, h('div', { class: 'who gold' }, t('trainer.prevFragment', { k: card.fragment.k, n: card.fragment.n })), h('div', { class: 'text' }, '… ' + c.text));
    }
    return h('div', { class: 'cue-card' }, h('div', { class: 'who muted' }, t('trainer.sceneStart')), h('div', { class: 'text' }, c.item ? c.item.text : '—'));
  }

  function answerText() {
    const pres = st.pres;
    const total = wordCount(card.text);
    const wrap = h('div', { class: 'text' });
    if (st.shown) { pieces(card.text).forEach((p) => wrap.appendChild(p.type === 'dir' ? h('span', { class: 'dir' }, p.text) : p.type === 'word' && st.revealed.has(p.index) ? h('span', { class: 'w w-revealed' }, p.text) : document.createTextNode(p.text))); return wrap; }
    const level = pres === 'vanish75' ? 75 : vanishLevel;
    const hidden = pres.startsWith('vanish') ? hiddenSet(total, level, hash32(card.id), pieces(card.text).filter((p) => p.type === 'word').map((p) => p.text.length)) : null;
    const manual = script.manualHints?.[card.lineId] || {};
    for (const p of pieces(card.text)) {
      if (p.type === 'dir') { wrap.appendChild(h('span', { class: 'dir' }, p.text)); continue; }
      if (p.type === 'sep') {
        if (pres === 'hidden' || pres === 'flash') { if (/[\n]/.test(p.text)) wrap.appendChild(document.createTextNode('\n')); else wrap.appendChild(document.createTextNode(' ')); }
        else wrap.appendChild(document.createTextNode(p.text));
        continue;
      }
      const rev = st.revealed.has(p.index);
      if (rev) { wrap.appendChild(h('span', { class: 'w w-revealed' }, p.text)); continue; }
      if (pres === 'hidden' || pres === 'flash') { wrap.appendChild(h('span', { class: 'w w-hidden', onclick: () => reveal(p.index) }, ' '.repeat(Math.min(6, Math.max(2, Math.ceil(p.text.length / 2)))))); continue; }
      if (hidden && hidden.has(p.index)) { wrap.appendChild(h('span', { class: 'w w-hidden', title: t('trainer.tapReveal'), role: 'button', tabindex: '0', onclick: () => reveal(p.index) }, p.text)); continue; }
      if (pres === 'letters') {
        if (editSyllables && hintMode === 'syllable') {
          wrap.appendChild(h('span', { class: 'w w-hint', onclick: async () => {
            const v = await promptDialog(t('trainer.letters.sylFor', { w: p.text }), { value: manual[p.index] || '' });
            if (v == null) return;
            script.manualHints[card.lineId] = { ...(script.manualHints[card.lineId] || {}), [p.index]: v.trim() };
            if (!v.trim()) delete script.manualHints[card.lineId][p.index];
            saveScriptSoon(script);
            renderCard();
          } }, wordHint(p.text, 'syllable', manual[p.index])));
        } else {
          wrap.appendChild(h('span', { class: 'w w-hint', title: t('trainer.tapReveal'), role: 'button', tabindex: '0', onclick: () => reveal(p.index) }, wordHint(p.text, hintMode, manual[p.index])));
        }
        continue;
      }
      wrap.appendChild(h('span', { class: 'w' }, p.text));
    }
    return wrap;
  }

  function reveal(i) {
    if (st.phase !== 'recall') return;
    st.revealed.add(i);
    tracker.hints++;
    renderCard();
  }
  function revealFirst(n) {
    for (let i = 0; i < n; i++) st.revealed.add(i);
    st.hintLevel = Math.max(st.hintLevel, n >= 3 ? 2 : 1);
    tracker.hints++;
    renderCard();
  }

  function renderCard() {
    if (!card) return;
    stage.replaceChildren();
    const done = results.length;
    const okCount = results.filter((r) => r.q >= 3).length;
    stage.appendChild(h('div', { class: 'progress-top' }, h('span', {}, `${Math.min(pos + 1, deck.length)} / ${deck.length}`), h('div', { class: 'bar' }, h('span', { style: { width: (deck.length ? (pos / deck.length) * 100 : 0) + '%', background: 'var(--gold)' } })), h('span', { class: 'chip green' }, okCount + '/' + done)));
    if (card.fragment) stage.appendChild(h('div', { class: 'chip gold', style: { marginBottom: '8px' } }, t('trainer.fragmentOf', { k: card.fragment.k + 1, n: card.fragment.n })));
    stage.appendChild(cueBox());

    const flash = st.pres === 'flash' && !st.flipped;
    const answer = h('div', { class: 'answer-card', style: flash ? { background: 'var(--surface-2)', borderStyle: 'dashed' } : { animation: st.flipped && st.pres === 'flash' ? 'flipIn .45s ease' : '' } },
      h('div', { class: 'who' }, charName(script, card.item.charId), card.item.parenthetical ? h('span', { class: 'paren' }, '(' + card.item.parenthetical + ')') : null,
        h('span', { class: 'spacer' }),
        iconBtn('flag', lineState(progress.records, card.lineId).rec?.flagged ? t('reader.unflag') : t('reader.flag'), async () => { await setFlagged(script, card.lineId, !lineState(progress.records, card.lineId).rec?.flagged); toast(t('trainer.flagged')); }, 'btn-sm btn-ghost')),
      flash ? h('div', { class: 'center muted', style: { padding: '18px 0' } }, icon('cards'), h('p', {}, t('trainer.cards.front'))) : answerText());
    stage.appendChild(answer);

    if (mode === 'cues' && st.phase !== 'recall') {
      const sc = sceneOfIndex(items, card.idx);
      stage.appendChild(h('p', { class: 'small muted', style: { marginTop: '8px' } }, t('trainer.context', { scene: sc?.title || t('common.sceneN', { n: scenesOf(items).indexOf(sc) + 1 }) })));
    }
    stage.appendChild(h('div', { style: { height: '14px' } }));
    stage.appendChild(actions());
  }

  function actions() {
    const box = h('div', { class: 'col' });
    if (st.phase === 'recall') {
      if (st.pres === 'flash' && !st.flipped) {
        box.append(
          h('div', { class: 'big-controls' },
            btn(t('trainer.cards.flip'), () => { st.flipped = true; st.shown = true; st.phase = 'rate'; renderCard(); }, { cls: 'btn-primary btn-lg', icon: 'refresh' }),
            micButton()),
          h('p', { class: 'hint center' }, t('trainer.keysFlip')));
        return box;
      }
      box.append(
        h('div', { class: 'row', style: { justifyContent: 'center' } },
          btn(t('partner.hintFirst'), () => revealFirst(1), { cls: 'btn-sm', icon: 'bulb' }),
          btn(t('partner.hintThree'), () => revealFirst(3), { cls: 'btn-sm', icon: 'bulb' })),
        h('div', { class: 'big-controls' },
          micButton(),
          btn(t('trainer.type'), () => { st.phase = 'typing'; renderCard(); }, { cls: 'btn-lg', icon: 'keyboard' }),
          btn(t('trainer.showRate'), () => { st.shown = true; st.hintLevel = Math.max(st.hintLevel, st.revealed.size ? st.hintLevel : 0); st.phase = 'rate'; renderCard(); }, { cls: 'btn-lg btn-primary', icon: 'eye' })),
        h('p', { class: 'hint center' }, t('trainer.keys')));
      return box;
    }
    if (st.phase === 'listening') {
      const tr = h('div', { class: 'transcript center' }, '…');
      box.append(h('div', { class: 'center' }, h('span', { class: 'listening' }, t('trainer.listening'))), tr,
        h('div', { class: 'row', style: { justifyContent: 'center' } }, btn(t('trainer.stopListening'), () => listenCtrl?.finishNow?.(), { cls: 'btn-sm' }), btn(t('common.cancel'), () => { listenCtrl?.abort(); st.phase = 'recall'; renderCard(); }, { cls: 'btn-sm btn-ghost' })));
      st.transcriptEl = tr;
      return box;
    }
    if (st.phase === 'typing') {
      const ta = h('textarea', { placeholder: t('trainer.typePh'), style: { minHeight: '110px', fontFamily: 'var(--font-script)' }, 'aria-label': t('trainer.type') });
      ta.value = st.typed;
      ta.addEventListener('input', () => { st.typed = ta.value; });
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doCheck(); });
      const doCheck = () => {
        st.result = check(script, spokenText(card.text), ta.value, [...st.revealed]);
        st.result.source = 'typed';
        st.shown = true;
        st.phase = 'result';
        renderCard();
      };
      box.append(ta, h('div', { class: 'row end' }, btn(t('common.cancel'), () => { st.phase = 'recall'; renderCard(); }, { cls: 'btn-ghost' }), btn(t('trainer.check'), doCheck, { cls: 'btn-primary', icon: 'check' })));
      setTimeout(() => ta.focus(), 30);
      return box;
    }
    if (st.phase === 'result') {
      box.append(analysisView(st.result, (nr) => { st.result = nr; }),
        h('div', { class: 'row end' },
          btn(t('trainer.retry'), () => { st.phase = 'recall'; st.shown = false; st.result = null; st.attempt++; renderCard(); }, { cls: 'btn-ghost', icon: 'repeat' }),
          btn(t('trainer.saveNext'), () => finishCard(autoQ()), { cls: 'btn-primary', icon: 'check' })),
        h('details', { class: 'more' }, h('summary', {}, t('trainer.rateManually')), ratingButtons((r) => finishCard(selfQ(r), r))));
      return box;
    }
    // rate
    box.append(h('p', { class: 'center text-2' }, t('trainer.howWell')), ratingButtons((r) => finishCard(selfQ(r), r)));
    return box;
  }

  function micButton() {
    return btn(t('trainer.sayIt'), async () => {
      if (!(await canListen())) { toast(navigator.onLine ? t('trainer.noMicFallback') : t('trainer.offlineStt'), { type: 'error' }); return; }
      st.phase = 'listening';
      renderCard();
      const ctrl = new AbortController();
      const control = {};
      listenCtrl = { abort: () => ctrl.abort(), finishNow: () => control.finish?.() };
      const startT = performance.now();
      const res = await listenFor(script, spokenText(card.text), {
        signal: ctrl.signal,
        control,
        onInterim: (txt) => { if (st.transcriptEl) st.transcriptEl.textContent = txt || '…'; tracker.activity(); },
      });
      listenCtrl = null;
      if (!res) return;
      if (res.error && !res.transcript) { toast(t(sttErrorKey(res.error)), { type: 'error' }); st.phase = 'recall'; renderCard(); return; }
      st.result = check(script, spokenText(card.text), res.transcript, [...st.revealed]);
      st.result.source = 'speech';
      st.latency = res.latency;
      st.recallMs = performance.now() - startT;
      st.shown = true;
      st.phase = 'result';
      renderCard();
    }, { cls: 'btn-lg', icon: 'mic' });
  }

  function hintLevel() {
    const total = wordCount(card.text);
    if (st.revealed.size >= total && total > 0) return 3;
    return st.hintLevel;
  }
  function weightAndCap() {
    if (st.pres === 'vanish' && vanishLevel < 50) return { weight: 0.3, cap: 3 };
    if (st.pres === 'vanish') return { weight: 1, cap: vanishLevel >= 90 ? 5 : 4 };
    if (st.pres === 'vanish75') return { weight: 1, cap: 4 };
    if (st.pres === 'letters') return { weight: 1, cap: hintMode === 'blank' ? 4.6 : 4.3 };
    return { weight: 1, cap: 5 };
  }
  function autoQ() {
    const { cap } = weightAndCap();
    return Math.min(cap, qualityFromResult({ score: st.result.score, hintLevel: hintLevel(), revealed: st.revealed.size, totalWords: wordCount(card.text), latencyMs: st.latency ?? null, attempt: st.attempt }));
  }
  function selfQ(r) {
    const { cap } = weightAndCap();
    return Math.min(cap, qualityFromSelf(r, { revealed: st.revealed.size, totalWords: wordCount(card.text), hintLevel: hintLevel() }));
  }

  async function finishCard(q, selfRating) {
    const { weight } = weightAndCap();
    await recordReview(script, card.id, { q, src: mode, score: st.result?.score, hints: st.revealed.size, latencyMs: st.result?.source === 'speech' ? st.latency : null, weight });
    tracker.reviews++;
    results.push({ card, q, score: st.result?.score ?? null, revealed: st.revealed.size, self: selfRating || null });
    if (q < 3 && ['cards', 'review', 'hardest', 'cues'].includes(mode) && (requeued.get(card.id) || 0) < 2) {
      requeued.set(card.id, (requeued.get(card.id) || 0) + 1);
      deck.splice(Math.min(deck.length, pos + 4), 0, card);
    }
    next();
  }

  function renderSummary() {
    stopAllSpeech();
    card = null;
    stage.replaceChildren();
    if (!deck.length) {
      const msg = mode === 'hardest' ? t('trainer.noHard') : mode === 'cues' ? t('trainer.noCues') : t('trainer.nothingDue');
      stage.appendChild(emptyState('sparkles', msg, '', linkBtn(t('learn.title'), '#/learn', { cls: 'btn-primary' }), mode !== 'cards' ? linkBtn(t('trainer.cards.title'), '#/learn/train/cards', {}) : null));
      return;
    }
    const good = results.filter((r) => r.q >= 3.5);
    const weak = results.filter((r) => r.q < 3);
    const scores = results.filter((r) => r.score != null);
    stage.appendChild(h('div', { class: 'card hero center' },
      h('h2', {}, t('trainer.summaryTitle')),
      h('div', { class: 'grid grid-3', style: { margin: '14px 0' } },
        h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, results.length), h('div', { class: 'stat-label' }, t('trainer.reviewed'))),
        h('div', { class: 'stat' }, h('div', { class: 'stat-value', style: { color: 'var(--ok)' } }, good.length), h('div', { class: 'stat-label' }, t('trainer.wellKnown'))),
        h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, scores.length ? Math.round(avg(scores, (r) => r.score) * 100) + '%' : '—'), h('div', { class: 'stat-label' }, t('trainer.avgMatch')))),
      weak.length ? h('div', { style: { textAlign: 'left' } }, h('div', { class: 'section-title' }, t('trainer.toRepeat')), h('div', { class: 'list' }, [...new Map(weak.map((w) => [w.card.lineId, w])).values()].map((w) => h('div', { class: 'list-item' }, h('div', { class: 'grow' }, h('div', { class: 'title' }, spokenText(w.card.item.text).slice(0, 90)))))) ) : h('p', { class: 'text-2' }, t('trainer.allGood')),
      h('p', { class: 'small muted' }, t('trainer.srsNote')),
      h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '10px' } },
        btn(t('trainer.again'), restart, { cls: 'btn-primary', icon: 'repeat' }),
        linkBtn(t('learn.title'), '#/learn', { icon: 'left' }),
        linkBtn(t('rehearse.partner'), '#/rehearse/partner', { icon: 'masks' }))));
  }

  const offKeys = keys({
    Space: () => {
      if (!card) return;
      if (st.phase === 'recall') {
        if (st.pres === 'flash') { st.flipped = true; }
        st.shown = true; st.phase = 'rate'; renderCard();
      }
    },
    1: () => st?.phase === 'rate' && finishCard(selfQ('again'), 'again'),
    2: () => st?.phase === 'rate' && finishCard(selfQ('hard'), 'hard'),
    3: () => st?.phase === 'rate' && finishCard(selfQ('good'), 'good'),
    4: () => st?.phase === 'rate' && finishCard(selfQ('perfect'), 'perfect'),
    m: () => { if (st?.phase === 'recall') stage.querySelector('.big-controls .btn')?.click(); },
  });

  renderHead();
  restart();
  return () => { offKeys(); listenCtrl?.abort(); stopAllSpeech(); tracker.stop(); };
}
