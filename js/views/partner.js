// ActoMind – Virtual stage partner & dress rehearsal.
// The app plays every other character; the actor says their own lines (checked by speech recognition or manually).
import { h, btn, iconBtn, segmented, switchEl, toast, banner, linkBtn, field, confirmDialog } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { setHeader, navigate } from '../ui/shell.js';
import { t, tn } from '../core/i18n.js';
import { settings, setSetting, getProgress, recordReview, SessionTracker, saveRehearsal, listRehearsals, gami, bumpTotal, charById } from '../core/store.js';
import { db } from '../core/db.js';
import { requireScript, scenePicker, analysisView, keys, charName, supportBanner } from '../ui/common.js';
import { scenesOf, sceneOfIndex } from '../core/parser.js';
import { pieces, spokenText, words, normalizeWord, wordCount } from '../core/tokenize.js';
import { compareText, coverage } from '../core/diff.js';
import { qualityFromResult } from '../core/srs.js';
import { wordHint } from '../core/hints.js';
import { Listener, support } from '../core/speech.js';
import { speakItem, stopAllSpeech } from '../audio/voice-engine.js';
import { voiceOf } from '../audio/program.js';
import { playBeep } from '../audio/beeps.js';
import { sleep, uid, avg } from '../core/util.js';
import { canListen, langCode, sttErrorKey } from '../ui/recall.js';

const COMMANDS = {
  pl: { hint: ['podpowiedź', 'podpowiedz', 'podpowiedzi'], repeat: ['powtórz', 'powtorz'], next: ['dalej', 'następna', 'następny'], restart: ['od początku'], pause: ['pauza', 'stop'], full: ['cała kwestia', 'pokaż całość'] },
  en: { hint: ['hint', 'prompt'], repeat: ['repeat', 'again'], next: ['next', 'skip'], restart: ['from the top', 'restart'], pause: ['pause', 'stop'], full: ['whole line', 'full line'] },
};

export default async function partnerView(root, params, query) {
  const dress = !!params.dress;
  setHeader(dress ? t('dress.title') : t('partner.title'));
  const script = await requireScript(root);
  if (!script) return;
  const items = script.items;
  const mine = new Set(script.myRoles);
  const lang = script.lang === 'en' ? 'en' : 'pl';
  const resumeKey = 'resume:' + script.id + ':' + (dress ? 'dress' : 'partner');
  const resume = await db.get('meta', resumeKey);

  // ---------------------------------------------------------------- configuration
  const cfg = {
    sceneId: query.scene || '',
    strictness: settings.strictness,
    showMine: dress ? 'hidden' : (query.show || 'hidden'), // hidden | letters | full
    showPartner: !settings.eyesFree,
    stt: support.stt && settings.sttEnabled,
    voiceCommands: settings.voiceCommands,
    eyesFree: settings.eyesFree,
    beep: !dress,
    from: query.from || null,
  };

  let tracker = null;
  let run = null;

  const setup = h('div');
  const live = h('div', { class: 'stage hidden' });
  root.append(setup, live);

  function renderSetup() {
    setup.replaceChildren(
      h('div', { class: 'card hero' },
        h('h1', {}, dress ? t('dress.title') : t('partner.title')),
        h('p', { class: 'text-2' }, dress ? t('dress.intro') : t('partner.intro'))),
      supportBanner(),
      resume && resume.itemId && items.some((x) => x.id === resume.itemId)
        ? banner('info', 'repeat', h('strong', {}, t('partner.resumeTitle')), h('div', {}, t('partner.resumeText', { text: spokenText(items.find((x) => x.id === resume.itemId).text).slice(0, 70) })),
          h('div', { class: 'row', style: { marginTop: '6px' } }, btn(t('partner.resume'), () => { cfg.sceneId = resume.sceneId || ''; cfg.from = resume.itemId; start(); }, { cls: 'btn-sm btn-primary', icon: 'play' })))
        : null,
      h('div', { class: 'card' },
        field(t('partner.range'), scenePicker(script, cfg.sceneId, (v) => { cfg.sceneId = v; cfg.from = null; })),
        cfg.from ? h('p', { class: 'small gold' }, t('partner.startsFrom', { text: spokenText(items.find((x) => x.id === cfg.from)?.text || '').slice(0, 60) })) : null,
        field(t('partner.strictness'), segmented([
          { value: 'free', label: t('partner.strict.free') }, { value: 'training', label: t('partner.strict.training') }, { value: 'professional', label: t('partner.strict.professional') },
        ], cfg.strictness, (v) => { cfg.strictness = v; setSetting('strictness', v); renderSetup(); }), t('partner.strictHint.' + cfg.strictness)),
        dress ? h('p', { class: 'small muted' }, t('dress.hiddenNote')) : field(t('partner.showMine'), segmented([
          { value: 'hidden', label: t('partner.show.hidden') }, { value: 'letters', label: t('partner.show.letters') }, { value: 'full', label: t('partner.show.full') },
        ], cfg.showMine, (v) => { cfg.showMine = v; })),
        switchEl(t('partner.showPartner'), cfg.showPartner, (v) => { cfg.showPartner = v; }),
        support.stt
          ? switchEl(t('partner.useStt'), cfg.stt, (v) => { cfg.stt = v; setSetting('sttEnabled', v); renderSetup(); }, t('partner.useSttHint'))
          : h('p', { class: 'small muted' }, t('partner.manualOnly')),
        cfg.stt ? switchEl(t('partner.voiceCommands'), cfg.voiceCommands, (v) => { cfg.voiceCommands = v; setSetting('voiceCommands', v); renderSetup(); }, t('partner.voiceCommandsHint', { list: COMMANDS[lang].hint[0] + ', ' + COMMANDS[lang].repeat[0] + ', ' + COMMANDS[lang].next[0] + ', ' + COMMANDS[lang].restart[0] })) : null,
        cfg.stt && cfg.voiceCommands ? switchEl(t('partner.commandKeyword'), settings.commandKeyword, (v) => setSetting('commandKeyword', v), t('partner.commandKeywordHint', { kw: lang === 'pl' ? 'komenda' : 'command' })) : null,
        switchEl(t('partner.eyesFree'), cfg.eyesFree, (v) => { cfg.eyesFree = v; setSetting('eyesFree', v); if (v) cfg.showPartner = false; renderSetup(); }, t('partner.eyesFreeHint')),
        dress ? null : switchEl(t('partner.beep'), cfg.beep, (v) => { cfg.beep = v; })),
      h('div', { class: 'row end' }, btn(dress ? t('dress.start') : t('partner.start'), start, { cls: 'btn-primary btn-xl', icon: 'play' })),
    );
  }

  async function start() {
    if (cfg.stt && !(await canListen())) {
      cfg.stt = false;
      toast(navigator.onLine ? t('partner.sttDeclined') : t('trainer.offlineStt'));
    }
    setup.classList.add('hidden');
    live.classList.remove('hidden');
    tracker = new SessionTracker(script.id, dress ? 'dress' : 'partner');
    run = new Rehearsal(script, cfg, dress, live, tracker, resumeKey);
    run.begin();
  }

  renderSetup();
  if (query.autostart) start();
  const offKeys = keys({
    Space: () => run?.primaryAction(),
    h: () => run?.hint(1),
    n: () => run?.skip(),
    r: () => run?.repeatPartner(),
  });
  return () => { offKeys(); run?.destroy(); tracker?.stop(); stopAllSpeech(); };
}

// =================================================================== rehearsal engine
class Rehearsal {
  constructor(script, cfg, dress, el, tracker, resumeKey) {
    this.script = script;
    this.cfg = cfg;
    this.dress = dress;
    this.el = el;
    this.tracker = tracker;
    this.resumeKey = resumeKey;
    this.items = script.items;
    this.mine = new Set(script.myRoles);
    this.lang = script.lang === 'en' ? 'en' : 'pl';
    // range
    const sc = cfg.sceneId ? scenesOf(this.items).find((s) => s.id === cfg.sceneId) : null;
    this.indices = this.items.map((_, i) => i).filter((i) => !sc || (i >= sc.start && i <= sc.end));
    let k0 = 0;
    if (cfg.from) {
      const target = this.indices.indexOf(this.items.findIndex((x) => x.id === cfg.from));
      if (target >= 0) {
        k0 = target;
        // start at the cue (previous line) so the actor hears their entrance
        if (this.mine.has(this.items[this.indices[target]].charId)) {
          for (let j = target - 1; j >= 0; j--) { const it = this.items[this.indices[j]]; if (it.type === 'line') { k0 = j; break; } if (it.type === 'scene') { k0 = j; break; } }
        }
      }
    }
    if (!cfg.from) {
      // skip front matter (title page, cast list) – start at the first act/scene heading or line
      const first = this.indices.findIndex((i) => ['act', 'scene', 'line'].includes(this.items[i].type));
      if (first > 0) k0 = first;
    }
    this.k = k0;
    this.startK = k0;
    this.results = [];
    this.history = [];
    this.loopId = 0;
    this.ctrl = null;
    this.paused = false;
    this.turn = null;
    this.noHintRun = 0;
    this.bestNoHintRun = 0;
    this.startedAt = Date.now();
    this.myTotal = this.indices.filter((i) => this.items[i].type === 'line' && this.mine.has(this.items[i].charId)).length;
    this.build();
  }

  // ------------------------------------------------------------- UI skeleton
  build() {
    this.top = h('div', { class: 'row between' });
    this.now = h('div', { class: 'stage-now' });
    this.turnBox = h('div');
    this.hist = h('div', { class: 'history hide-eyes-free' });
    this.el.replaceChildren(this.top, this.now, this.turnBox, h('details', { class: 'more hide-eyes-free' }, h('summary', {}, t('partner.history')), this.hist));
    this.renderTop();
  }
  renderTop() {
    const done = this.results.length;
    this.top.replaceChildren(
      h('div', { class: 'row' }, h('span', { class: 'chip gold' }, tn('partner.myLinesProgress', this.myTotal, { done })), this.cfg.stt ? h('span', { class: 'chip' }, icon('mic'), ' ' + t('partner.strict.' + this.cfg.strictness)) : h('span', { class: 'chip' }, t('partner.manual'))),
      h('div', { class: 'row' },
        btn(this.paused ? t('partner.resumeBtn') : t('partner.pause'), () => (this.paused ? this.resume() : this.pause()), { cls: 'btn-sm', icon: this.paused ? 'play' : 'pause' }),
        btn(t('partner.restartScene'), () => this.restartScene(), { cls: 'btn-sm', icon: 'refresh' }),
        btn(t('partner.finish'), () => this.finish(true), { cls: 'btn-sm btn-accent', icon: 'stop' })));
  }
  showItem(item, kind) {
    const c = charById(this.script, item.charId);
    this.now.className = 'stage-now';
    if (kind === 'heading') { this.now.replaceChildren(h('div', { class: 'center gold', style: { fontFamily: 'var(--font-display)', letterSpacing: '.14em', textTransform: 'uppercase', fontSize: '1.2rem', padding: '30px 0' } }, item.text)); return; }
    if (kind === 'direction') { this.now.replaceChildren(h('div', { class: 'direction center muted', style: { fontStyle: 'italic', padding: '20px 0', whiteSpace: 'pre-line' } }, item.text)); return; }
    this.now.replaceChildren(
      h('div', { class: 'who', style: { color: c?.color } }, h('span', { class: 'dot', style: { background: c?.color } }), c?.name, item.parenthetical ? h('span', { class: 'paren' }, '(' + item.parenthetical + ')') : null, h('span', { class: 'spacer' }), icon('volume')),
      this.cfg.showPartner && !this.cfg.eyesFree ? h('div', { class: 'text' }, item.text) : h('div', { class: 'text muted' }, t('partner.listen')));
  }
  addHistory(text, cls = '') { this.hist.prepend(h('div', { class: 'h-item ' + cls }, text)); }

  // ------------------------------------------------------------- flow
  begin() { this.loop(++this.loopId); }
  destroy() { this.loopId++; this.ctrl?.abort(); this.stopListening(); stopAllSpeech(); }

  restartLoop() {
    this.loopId++;
    this.ctrl?.abort();
    this.stopListening();
    stopAllSpeech();
    this.turn?.resolve?.('restart');
    this.turn = null;
    this.turnBox.replaceChildren();
    setTimeout(() => this.loop(++this.loopId), 50);
  }

  async loop(id) {
    while (id === this.loopId && this.k < this.indices.length) {
      if (this.paused) return;
      const idx = this.indices[this.k];
      const item = this.items[idx];
      this.ctrl = new AbortController();
      const signal = this.ctrl.signal;
      db.put('meta', { key: this.resumeKey, itemId: item.id, sceneId: this.cfg.sceneId, at: Date.now() }).catch(() => {});
      this.tracker.activity();
      try {
        if (item.type === 'act' || item.type === 'scene') {
          this.showItem(item, 'heading');
          await sleep(900, signal);
        } else if (item.type === 'direction') {
          if (!this.cfg.eyesFree) { this.showItem(item, 'direction'); await sleep(Math.min(2600, 700 + item.text.length * 18), signal); }
        } else if (item.type === 'line' && !this.mine.has(item.charId)) {
          this.showItem(item, 'partner');
          const text = spokenText(item.text);
          if (text) await speakItem(this.script, item.charId, text, item.id, { signal });
          this.addHistory(h('span', {}, h('strong', { style: { color: charById(this.script, item.charId)?.color } }, charName(this.script, item.charId) + ': '), text));
          await sleep((voiceOf(this.script, item.charId).pauseAfter ?? 0.6) * 1000, signal);
        } else if (item.type === 'line') {
          const outcome = await this.myTurn(item, signal);
          if (id !== this.loopId) return;
          if (outcome === 'back') { this.goBack(); continue; }
          if (outcome === 'restart') return;
        }
      } catch (e) {
        if (e.name === 'AbortError') { if (id !== this.loopId) return; continue; }
        console.error(e);
        toast(t('partner.voiceError', { msg: e.message }), { type: 'error' });
      }
      if (id !== this.loopId) return;
      this.k++;
    }
    if (id === this.loopId && this.k >= this.indices.length) this.finish(false);
  }

  pause() { this.paused = true; this.loopId++; this.ctrl?.abort(); this.stopListening(); stopAllSpeech(); if (this.turn) { this.turn.resolve('restart'); this.turn = null; } this.renderTop(); this.now.appendChild(h('div', { class: 'center', style: { marginTop: '10px' } }, h('span', { class: 'chip orange' }, t('partner.paused')))); }
  resume() { this.paused = false; this.renderTop(); this.loop(++this.loopId); }
  restartScene() {
    let k = this.k;
    while (k > 0 && !['scene', 'act'].includes(this.items[this.indices[k]].type)) k--;
    this.k = k;
    this.paused = false;
    this.renderTop();
    toast(t('partner.restarted'));
    this.restartLoop();
  }
  repeatPartner() {
    // go back to the previous partner line and replay it
    let k = this.k;
    if (this.turn) k--;
    while (k > 0 && !(this.items[this.indices[k]].type === 'line' && !this.mine.has(this.items[this.indices[k]].charId))) k--;
    this.k = Math.max(0, k);
    this.restartLoop();
  }
  goBack() {
    // undo: return to previous own line, drop its result
    const last = this.results.pop();
    let k = this.k - 1;
    while (k > 0 && !(this.items[this.indices[k]].type === 'line' && this.mine.has(this.items[this.indices[k]].charId))) k--;
    if (last && this.items[this.indices[k]]?.id !== last.lineId) this.results.push(last);
    // start at its cue
    let c = k - 1;
    while (c > 0 && this.items[this.indices[c]].type !== 'line') c--;
    this.k = Math.max(0, c);
    this.renderTop();
  }
  undoAttempt() {
    if (this.turn) { const tu = this.turn; this.stopListening(tu); this.turn = null; this.turnBox.replaceChildren(); tu.resolve('back'); }
    else { this.goBack(); this.restartLoop(); }
  }
  skip() { if (this.turn) this.accept(this.turn, { skipped: true }); }
  primaryAction() {
    const tu = this.turn;
    if (!tu) return;
    if (tu.phase === 'manual') this.toManualRate(tu);
    else if (tu.phase === 'speaking' && this.cfg.stt) this.evaluate(tu);
    else if (tu.phase === 'confirm' || tu.phase === 'failed') this.accept(tu, {});
  }

  // ------------------------------------------------------------- the actor's turn
  myTurn(item, signal) {
    return new Promise((resolve) => {
      const tu = { item, ref: spokenText(item.text), revealed: new Set(), hintLevel: 0, attempts: 1, start: performance.now(), phase: this.cfg.stt ? 'speaking' : 'manual', resolve, transcript: '', latency: null };
      this.turn = tu;
      signal.addEventListener('abort', () => { this.stopListening(); if (this.turn === tu) { this.turn = null; resolve('restart'); } }, { once: true });
      this.now.className = 'stage-now my-turn';
      this.now.replaceChildren(h('div', { class: 'your-turn' }, t('partner.yourTurn')), h('div', { class: 'center muted small' }, charName(this.script, item.charId) + (item.parenthetical ? ' (' + item.parenthetical + ')' : '')));
      this.renderTurn(tu);
      const go = async () => {
        if (this.cfg.beep || this.cfg.eyesFree) await playBeep('single', 0.8);
        if (this.turn !== tu) return;
        if (this.cfg.stt) this.listen(tu);
      };
      go();
    });
  }

  renderTurn(tu) {
    const box = this.turnBox;
    box.replaceChildren();
    const show = this.dress ? 'hidden' : this.cfg.showMine;
    const textEl = h('div', { class: 'text', style: { fontFamily: 'var(--font-script)', fontSize: 'calc(var(--script-size)*1.1)', lineHeight: '1.8' } });
    const full = tu.hintLevel >= 3 || ['confirm', 'failed', 'manualRate', 'accepted'].includes(tu.phase) && !this.dress;
    for (const p of pieces(tu.item.text)) {
      if (p.type === 'dir') { textEl.appendChild(h('span', { class: 'dir' }, p.text)); continue; }
      if (p.type === 'sep') { textEl.appendChild(document.createTextNode(show === 'hidden' && !full ? ' ' : p.text)); continue; }
      if (full || show === 'full' || tu.revealed.has(p.index)) textEl.appendChild(h('span', { class: 'w' + (tu.revealed.has(p.index) ? ' w-revealed' : '') }, p.text));
      else if (show === 'letters') textEl.appendChild(h('span', { class: 'w w-hint', onclick: () => { tu.revealed.add(p.index); this.renderTurn(tu); } }, wordHint(p.text, settings.hintMode || 'first')));
      else textEl.appendChild(h('span', { class: 'w w-hidden', onclick: () => { if (!this.dress) { tu.revealed.add(p.index); this.renderTurn(tu); } } }, ' '.repeat(Math.min(5, Math.max(2, Math.ceil(p.text.length / 2))))));
    }
    const answer = h('div', { class: 'answer-card hide-eyes-free' }, textEl);
    const hintBar = h('div', { class: 'control-bar' },
      btn(t('partner.hintFirst'), () => this.hint(1), { cls: 'btn-sm', icon: 'bulb' }),
      btn(t('partner.hintThree'), () => this.hint(3), { cls: 'btn-sm', icon: 'bulb' }),
      btn(t('partner.hintFull'), () => this.hint(99), { cls: 'btn-sm', icon: 'eye' }),
      btn(t('partner.repeatPartner'), () => this.repeatPartner(), { cls: 'btn-sm', icon: 'repeat' }),
      btn(t('partner.undo'), () => this.undoAttempt(), { cls: 'btn-sm', icon: 'left' }),
      btn(t('partner.skip'), () => this.skip(), { cls: 'btn-sm', icon: 'next' }));

    if (tu.phase === 'speaking') {
      tu.transcriptEl = h('div', { class: 'transcript center' }, tu.transcript || '');
      box.append(answer,
        h('div', { class: 'center', style: { margin: '10px 0' } }, h('span', { class: 'listening' }, t('partner.listening'))),
        tu.transcriptEl,
        h('div', { class: 'big-controls', style: { margin: '10px 0' } }, btn(t('partner.done'), () => this.evaluate(tu), { cls: 'btn-primary btn-lg', icon: 'check' })),
        hintBar);
    } else if (tu.phase === 'manual') {
      box.append(answer,
        h('p', { class: 'center text-2' }, t('partner.manualPrompt')),
        h('div', { class: 'big-controls', style: { margin: '10px 0' } }, btn(t('partner.doneSaying'), () => this.toManualRate(tu), { cls: 'btn-primary btn-xl', icon: 'check' })),
        hintBar);
    } else if (tu.phase === 'manualRate') {
      box.append(answer,
        h('p', { class: 'center text-2' }, t('partner.manualRateQ')),
        h('div', { class: 'big-controls' },
          btn(t('partner.rate.ok'), () => this.accept(tu, { manual: 'ok' }), { cls: 'btn-lg rate-perfect', icon: 'check' }),
          btn(t('partner.rate.minor'), () => this.accept(tu, { manual: 'minor' }), { cls: 'btn-lg rate-good' }),
          btn(t('partner.rate.forgot'), () => this.accept(tu, { manual: 'forgot' }), { cls: 'btn-lg rate-again', icon: 'x' })),
        h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '8px' } }, btn(t('partner.retry'), () => this.retry(tu), { cls: 'btn-sm btn-ghost', icon: 'repeat' })));
    } else if (tu.phase === 'confirm' || tu.phase === 'failed') {
      box.append(
        tu.phase === 'failed' ? banner('warn', 'alert', t('partner.notQuite', { p: tu.result.percent })) : null,
        analysisView(tu.result, (nr) => { tu.result = nr; }),
        h('div', { class: 'big-controls', style: { marginTop: '10px' } },
          btn(t('partner.retry'), () => this.retry(tu), { cls: 'btn-lg', icon: 'repeat' }),
          btn(t('partner.continue'), () => this.accept(tu, {}), { cls: 'btn-lg btn-primary', icon: 'right' })),
        hintBar);
    } else if (tu.phase === 'accepted') {
      box.append(h('div', { class: 'center' }, h('span', { class: 'chip green', style: { fontSize: '1rem', padding: '8px 14px' } }, icon('check'), ' ' + t('partner.good', { p: tu.result?.percent ?? 100 }))));
    }
  }

  async hint(n) {
    const tu = this.turn;
    if (!tu || !['speaking', 'manual', 'failed', 'confirm'].includes(tu.phase)) return;
    const total = wordCount(tu.item.text);
    const count = Math.min(total, n);
    for (let i = 0; i < count; i++) tu.revealed.add(i);
    tu.hintLevel = Math.max(tu.hintLevel, n >= 99 ? 3 : n >= 3 ? 2 : 1);
    this.tracker.hints++;
    this.noHintRun = 0;
    this.renderTurn(tu);
    if (this.cfg.eyesFree || tu.viaVoice) {
      // speak the hint (pause recognition so the app does not hear itself)
      const wasListening = !!tu.listener;
      this.stopListening(tu);
      const hintText = n >= 99 ? tu.ref : words(tu.ref).slice(0, count).join(' ');
      try { await speakItem(this.script, tu.item.charId, hintText, tu.item.id, { engine: 'web' }); } catch { /* ignore */ }
      if (wasListening && this.turn === tu && tu.phase === 'speaking') this.listen(tu, true);
    }
    tu.viaVoice = false;
  }

  listen(tu, keepTranscript = false) {
    this.stopListening(tu);
    const ref = tu.ref;
    let lastText = '';
    let lastChange = performance.now();
    const startedAt = performance.now();
    const prefix = keepTranscript ? tu.transcript : '';
    const l = new Listener({
      lang: langCode(this.script),
      onInterim: (txt) => {
        const full = (prefix + ' ' + txt).trim();
        if (full !== lastText) { lastText = full; lastChange = performance.now(); }
        tu.transcript = full;
        if (tu.transcriptEl) tu.transcriptEl.textContent = full;
        this.tracker.activity();
      },
      onFinal: (seg) => { if (this.cfg.voiceCommands) this.command(tu, seg, l); },
      onSpeechStart: () => { if (tu.latency == null) tu.latency = Math.round(performance.now() - tu.start); },
      onError: (code) => {
        if (['not-allowed', 'service-not-allowed', 'audio-capture', 'network'].includes(code)) {
          toast(t(sttErrorKey(code)), { type: 'error' });
          this.cfg.stt = false;
          this.stopListening(tu);
          tu.phase = 'manual';
          this.renderTurn(tu);
        }
      },
    });
    tu.listener = l;
    l.start();
    const est = Math.max(3, ref.length / 12);
    tu.timer = setInterval(() => {
      if (tu.phase !== 'speaking' || this.turn !== tu) return this.stopListening(tu);
      const now = performance.now();
      const txt = tu.transcript;
      if (!txt) {
        if (now - startedAt > 15000 && this.cfg.eyesFree && tu.hintLevel === 0) this.hint(3);
        return;
      }
      const cov = coverage(ref, txt, this.lang);
      const quiet = now - lastChange;
      if ((cov.ratio >= 0.999 && quiet > 700) || quiet > (settings.silenceTimeout || 1.8) * 1000 + Math.min(1500, est * 30) || now - startedAt > est * 4000 + 15000) this.evaluate(tu);
    }, 150);
  }

  stopListening(tu = this.turn) {
    if (!tu) return;
    clearInterval(tu.timer);
    tu.listener?.stop();
    tu.listener = null;
  }

  command(tu, seg, listener) {
    let s = normalizeWord(seg).replace(/[.,!?]/g, '').trim();
    const kw = this.lang === 'pl' ? 'komenda' : 'command';
    if (settings.commandKeyword) {
      if (!s.startsWith(kw)) return;
      s = s.slice(kw.length).trim();
    }
    const cmds = COMMANDS[this.lang];
    const refStart = normalizeWord(tu.ref).replace(/[.,!?]/g, '');
    const match = Object.keys(cmds).find((k) => cmds[k].some((c) => s === c));
    if (!match) return;
    // do not treat words of the actual line as commands
    if (refStart.startsWith(s)) return;
    tu.transcript = tu.transcript.replace(new RegExp(seg.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i'), '').trim();
    toast(t('partner.commandHeard', { c: s }));
    if (match === 'hint') { tu.viaVoice = true; this.hint(tu.hintLevel >= 1 ? 3 : 1); }
    else if (match === 'full') { tu.viaVoice = true; this.hint(99); }
    else if (match === 'repeat') this.repeatPartner();
    else if (match === 'next') this.accept(tu, { skipped: !tu.transcript });
    else if (match === 'restart') this.restartScene();
    else if (match === 'pause') this.pause();
  }

  evaluate(tu) {
    if (tu.phase !== 'speaking') return;
    this.stopListening(tu);
    const r = compareText(tu.ref, tu.transcript, { strictness: this.cfg.strictness, lang: this.lang, hinted: [...tu.revealed] });
    tu.result = r;
    if (this.cfg.strictness === 'free') { tu.phase = 'confirm'; this.renderTurn(tu); return; }
    if (r.passed) { this.accept(tu, {}); return; }
    tu.phase = 'failed';
    this.renderTurn(tu);
    if (this.cfg.eyesFree) {
      // without looking: give a spoken hint and try again, then move on
      (async () => {
        if (tu.attempts < 3) {
          tu.attempts++;
          tu.phase = 'speaking';
          tu.transcript = '';
          tu.viaVoice = true;
          await this.hint(tu.attempts === 2 ? 3 : 99);
          if (this.turn === tu) { this.renderTurn(tu); this.listen(tu); }
        } else this.accept(tu, {});
      })();
    }
  }

  retry(tu) {
    tu.attempts++;
    tu.transcript = '';
    tu.result = null;
    tu.start = performance.now();
    tu.latency = null;
    tu.phase = this.cfg.stt ? 'speaking' : 'manual';
    this.renderTurn(tu);
    if (this.cfg.stt) this.listen(tu);
  }

  toManualRate(tu) {
    tu.phase = 'manualRate';
    this.renderTurn(tu);
  }

  async accept(tu, { skipped = false, manual = null }) {
    if (this.turn !== tu) return;
    this.stopListening(tu);
    const total = wordCount(tu.item.text);
    let score;
    let q;
    if (skipped) { score = 0; q = 0.5; }
    else if (manual) {
      score = { ok: 1, minor: 0.8, forgot: 0.2 }[manual];
      q = { ok: 4.6, minor: 3.4, forgot: 1 }[manual];
      if (tu.hintLevel >= 3) q = Math.min(q, 1.5); else if (tu.hintLevel === 2) q -= 1; else if (tu.hintLevel === 1) q -= 0.5;
    } else {
      score = tu.result ? tu.result.score : 0;
      q = qualityFromResult({ score, hintLevel: tu.hintLevel, revealed: tu.revealed.size, totalWords: total, latencyMs: tu.latency, attempt: tu.attempts });
    }
    const usedHints = tu.hintLevel > 0 || tu.revealed.size > 0;
    if (!usedHints && score >= 0.8) { this.noHintRun++; this.bestNoHintRun = Math.max(this.bestNoHintRun, this.noHintRun); } else this.noHintRun = 0;
    const rec = {
      lineId: tu.item.id, score, percent: Math.round(score * 100), hintLevel: tu.hintLevel, revealed: tu.revealed.size, attempts: tu.attempts,
      skipped, manual, latency: tu.latency, transcript: tu.transcript || '', problemSpans: tu.result?.problemSpans || [], missed: tu.result?.counts.missed || 0,
      sceneId: sceneOfIndex(this.items, this.items.indexOf(tu.item))?.id || null,
    };
    this.results = this.results.filter((x) => x.lineId !== rec.lineId);
    this.results.push(rec);
    await recordReview(this.script, tu.item.id, { q, src: this.dress ? 'dress' : 'partner', score, hints: tu.revealed.size, latencyMs: this.cfg.stt ? tu.latency : null });
    this.tracker.reviews++;
    this.addHistory(h('span', {}, h('strong', { class: 'gold' }, t('common.me') + ': '), spokenText(tu.item.text).slice(0, 80), ' ', h('span', { class: 'chip ' + (skipped ? 'red' : score >= 0.8 ? 'green' : 'orange') }, skipped ? t('partner.skipped') : rec.percent + '%')));
    tu.phase = 'accepted';
    this.renderTurn(tu);
    this.renderTop();
    if (this.cfg.eyesFree && !skipped && score >= 0.8) await playBeep('end', 0.5);
    await sleep(skipped ? 200 : 650).catch(() => {});
    if (this.turn !== tu) return;
    this.turn = null;
    this.turnBox.replaceChildren();
    tu.resolve('next');
  }

  // ------------------------------------------------------------- end & report
  async finish(early) {
    this.loopId++;
    this.ctrl?.abort();
    this.stopListening();
    stopAllSpeech();
    if (this.turn) { this.turn.resolve('restart'); this.turn = null; }
    if (!this.results.length) {
      if (early) navigate('#/rehearse');
      return;
    }
    if (!early) await db.delete('meta', this.resumeKey).catch(() => {});
    const kind = this.dress ? 'dress' : 'partner';
    const prev = (await listRehearsals(this.script.id)).find((r) => r.kind === kind && (r.sceneId || '') === (this.cfg.sceneId || ''));
    const scoreOf = (r) => (r.skipped ? 0 : r.score);
    const accuracy = avg(this.results, scoreOf);
    const hints = this.results.reduce((s, r) => s + (r.hintLevel ? 1 : 0) + (r.revealed && !r.hintLevel ? 1 : 0), 0);
    const report = {
      id: uid('r_'), scriptId: this.script.id, kind, date: Date.now(), durationMs: Date.now() - this.startedAt,
      sceneId: this.cfg.sceneId || '', strictness: this.cfg.strictness, stt: this.cfg.stt, complete: !early,
      accuracy, hints, lines: this.results, myTotal: this.myTotal, bestNoHintRun: this.bestNoHintRun,
      prev: prev ? { id: prev.id, accuracy: prev.accuracy, hints: prev.hints, date: prev.date } : null,
    };
    await saveRehearsal(report);
    await bumpTotal(kind);
    await gami.addXp(this.dress ? 50 : 25);
    await gami.noHintRun(this.bestNoHintRun);
    if (!early && this.results.length >= 3 && this.results.every((r) => !r.hintLevel && !r.revealed && !r.skipped && r.score >= 0.8)) await gami.unlock('clean_scene');
    navigate('#/rehearse/report/' + report.id);
  }
}
