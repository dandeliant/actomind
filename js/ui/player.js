// ActoMind – live script player UI (Web Speech / cached cloud audio), shared by Listening mode and Audio Studio.
import { h, btn, iconBtn, rangeEl, selectEl, segmented } from './dom.js';
import { icon } from './icons.js';
import { t } from '../core/i18n.js';
import { LivePlayer } from '../audio/live-player.js';
import { charName, charColor, sceneOptions } from './common.js';
import { formatClock } from '../core/util.js';
import { scenesOf } from '../core/parser.js';
import { setupMediaSession, clearMediaSession } from '../audio/media-session.js';

/**
 * @param {object} script
 * @param {()=>object} getProgram builds the program for current settings
 * @param {{onSegment?:(seg)=>void, rate?:number, gapScale?:number, onRate?:(v)=>void, onGap?:(v)=>void, tracker?:object, posKey?:string}} o
 */
export function livePlayerUI(script, getProgram, o = {}) {
  let program = getProgram();
  const player = new LivePlayer(script, program, { rate: o.rate ?? 1, gapScale: o.gapScale ?? 1 });
  const nowLine = h('div', { class: 'now-line' }, h('span', { class: 'muted' }, t('player.ready')));
  const countdown = h('div', { class: 'countdown-wrap hidden' }, h('div', { class: 'your-turn' }, t('partner.yourTurn')), h('div', { class: 'countdown' }, '0'));
  const timeCur = h('span', {}, '0:00');
  const timeTot = h('span', {}, '~' + formatClock(program.total));
  const scrub = h('input', { type: 'range', class: 'scrub', min: 0, max: Math.max(1, Math.round(program.total)), step: 1, value: 0, 'aria-label': t('player.position') });
  scrub.addEventListener('change', () => player.seekBy(Number(scrub.value) - player.currentTime));
  const playBtn = h('button', { class: 'btn btn-primary play', type: 'button', 'aria-label': t('player.play'), onclick: () => { player.toggle(); } }, icon('play'));
  let loopScene = false;
  const loopBtn = btn(t('player.loopScene'), () => { loopScene = !loopScene; loopBtn.setAttribute('aria-pressed', String(loopScene)); applyLoop(); }, { cls: 'btn-sm', icon: 'repeat', pressed: false });
  const repBtn = btn(t('player.repeatLine'), () => { player.repeatOne = !player.repeatOne; repBtn.setAttribute('aria-pressed', String(player.repeatOne)); }, { cls: 'btn-sm', icon: 'repeatOne', pressed: false });
  let sceneSel = '';
  const fragment = { from: null, to: null };

  function applyLoop() {
    if (fragment.from && fragment.to) { player.setLoop(fragment.from, fragment.to); return; }
    if (!loopScene) { player.setLoop(null); return; }
    const seg = player.segments[player.index];
    const idx = script.items.findIndex((x) => x.id === seg?.itemId);
    const sc = scenesOf(script.items).find((s) => idx >= s.start && idx <= s.end);
    if (sc) player.setLoop(script.items[sc.start].id, script.items[sc.end].id);
  }

  player.addEventListener('state', (e) => {
    playBtn.replaceChildren(icon(e.detail.state === 'playing' ? 'pause' : 'play'));
    playBtn.setAttribute('aria-label', e.detail.state === 'playing' ? t('player.pause') : t('player.play'));
    if (e.detail.state !== 'playing') countdown.classList.add('hidden');
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = e.detail.state === 'playing' ? 'playing' : 'paused';
  });
  player.addEventListener('segment', (e) => {
    const seg = e.detail.seg;
    if (!seg) return;
    o.tracker?.activity();
    timeCur.textContent = formatClock(seg.t);
    scrub.value = Math.round(seg.t);
    if (seg.kind === 'speech') {
      countdown.classList.add('hidden');
      nowLine.replaceChildren(h('strong', { style: { color: charColor(script, seg.voiceKey) } }, charName(script, seg.voiceKey) + ': '), seg.text);
    } else if (seg.kind === 'silence' && seg.role !== 'gap') {
      nowLine.replaceChildren(h('strong', { class: 'gold' }, charName(script, seg.charId) + ' – ' + (seg.role === 'repeat' ? t('player.repeatNow') : t('partner.yourTurn'))));
    }
    if (o.posKey) localStorage.setItem(o.posKey, seg.itemId || '');
    o.onSegment?.(seg);
  });
  player.addEventListener('tick', (e) => {
    const { remaining, seg } = e.detail;
    countdown.classList.remove('hidden');
    countdown.firstChild.textContent = seg.role === 'repeat' ? t('player.repeatNow') : t('partner.yourTurn');
    countdown.lastChild.textContent = Math.ceil(Math.max(0, remaining));
    timeCur.textContent = formatClock(player.currentTime);
  });
  player.addEventListener('end', () => { countdown.classList.add('hidden'); nowLine.replaceChildren(h('span', { class: 'muted' }, t('player.ended'))); });

  setupMediaSession({ title: script.title, artist: 'ActoMind' }, {
    play: () => player.play(), pause: () => player.pause(), stop: () => player.stop(),
    previoustrack: () => player.prev(), nexttrack: () => player.next(),
    seekbackward: () => player.seekBy(-10), seekforward: () => player.seekBy(10),
  });

  const el = h('div', { class: 'player' },
    nowLine,
    countdown,
    h('div', { style: { marginTop: '10px' } }, scrub),
    h('div', { class: 'player-time' }, timeCur, h('span', { class: 'small' }, program.approx ? t('player.approxTime') : ''), timeTot),
    h('div', { class: 'player-main' },
      iconBtn('stop', t('player.stop'), () => player.stop()),
      iconBtn('back5', t('player.back', { s: 10 }), () => player.seekBy(-10)),
      iconBtn('prev', t('player.prev'), () => player.prev()),
      playBtn,
      iconBtn('next', t('player.next'), () => player.next()),
      iconBtn('fwd5', t('player.fwd', { s: 10 }), () => player.seekBy(10))),
    h('div', { class: 'row', style: { justifyContent: 'center' } },
      selectEl(sceneOptions(script), '', (v) => {
        sceneSel = v;
        const sc = scenesOf(script.items).find((s) => s.id === v);
        if (sc) player.jumpToItem(script.items[sc.start].id); else player.jump(0);
        applyLoop();
      }, { 'aria-label': t('common.scene'), style: { width: 'auto' } }),
      loopBtn, repBtn),
    h('div', { class: 'grid grid-2 stack-sm', style: { marginTop: '10px' } },
      h('div', {}, h('div', { class: 'label' }, t('player.tempo')), rangeEl({ min: 0.6, max: 1.6, step: 0.05, value: player.rate, format: (x) => x.toFixed(2) + '×', onChange: (x) => { player.rate = x; o.onRate?.(x); } })),
      h('div', {}, h('div', { class: 'label' }, t('player.gaps')), rangeEl({ min: 0, max: 3, step: 0.1, value: player.gapScale, format: (x) => x.toFixed(1) + '×', onChange: (x) => { player.gapScale = x; o.onGap?.(x); } }))),
  );

  return {
    el,
    player,
    /** rebuild program (settings changed) and keep position */
    refresh() {
      const wasPlaying = player.state === 'playing';
      if (wasPlaying) player.pause();
      program = getProgram();
      player.setProgram(program);
      scrub.max = Math.max(1, Math.round(program.total));
      timeTot.textContent = '~' + formatClock(program.total);
      applyLoop();
      if (wasPlaying) player.play();
    },
    setFragment(from, to) { fragment.from = from; fragment.to = to; applyLoop(); },
    playFromItem(itemId) { player.jumpToItem(itemId); player.play(); },
    destroy() { player.abortCurrent(); clearMediaSession(); },
  };
}
