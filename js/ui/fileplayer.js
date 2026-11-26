// ActoMind – player for generated audio files (HTMLAudioElement + Media Session): seek ±5/10/15 s,
// previous/next line, scene loop, fragment loop, speed, volume, "Your turn!" countdown, position memory.
import { h, btn, iconBtn, rangeEl, selectEl, segmented } from './dom.js';
import { icon } from './icons.js';
import { t } from '../core/i18n.js';
import { formatClock } from '../core/util.js';
import { setupMediaSession, clearMediaSession, updatePosition } from '../audio/media-session.js';
import { scenesOf } from '../core/parser.js';
import { spokenText } from '../core/tokenize.js';
import { charById } from '../core/store.js';

/**
 * @param {object} entry audioExports record {blob, marks, name, duration}
 * @param {object|null} script for line texts / scenes
 */
export function filePlayer(entry, script) {
  const url = URL.createObjectURL(entry.blob);
  const audio = new Audio();
  audio.preload = 'metadata';
  audio.src = url;
  const posKey = 'actomind.pos.' + entry.id;
  const saved = Number(localStorage.getItem(posKey) || 0);
  audio.addEventListener('loadedmetadata', () => { if (saved && saved < audio.duration - 2) audio.currentTime = saved; });
  const marks = (entry.marks || []).map((m) => ({ t: m.t, d: m.d, kind: m.k, role: m.r, itemId: m.i, charId: m.c }));
  const lineStarts = marks.filter((m) => m.kind === 'speech' || (m.kind === 'silence' && m.role !== 'gap'));
  const items = script ? new Map(script.items.map((i) => [i.id, i])) : new Map();
  let loop = null; // {a, b}
  let skip = Number(localStorage.getItem('actomind.skip') || 10);

  const nowLine = h('div', { class: 'now-line' }, h('span', { class: 'muted' }, entry.name));
  const countdown = h('div', { class: 'countdown-wrap hidden' }, h('div', { class: 'your-turn' }, t('partner.yourTurn')), h('div', { class: 'countdown' }, '0'));
  const cur = h('span', {}, '0:00');
  const tot = h('span', {}, formatClock(entry.duration));
  const scrub = h('input', { type: 'range', class: 'scrub', min: 0, max: Math.round(entry.duration * 10), step: 1, value: 0, 'aria-label': t('player.position') });
  scrub.addEventListener('input', () => { audio.currentTime = Number(scrub.value) / 10; });
  const playBtn = h('button', { class: 'btn btn-primary play', type: 'button', 'aria-label': t('player.play'), onclick: () => (audio.paused ? audio.play() : audio.pause()) }, icon('play'));
  const markAt = (time) => { let m = null; for (const x of marks) { if (x.t <= time + 0.01) m = x; else break; } return m; };
  let lastItem = null;
  const onLine = h('div');

  audio.addEventListener('play', () => { playBtn.replaceChildren(icon('pause')); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; });
  audio.addEventListener('pause', () => { playBtn.replaceChildren(icon('play')); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; localStorage.setItem(posKey, String(audio.currentTime)); });
  audio.addEventListener('timeupdate', () => {
    const time = audio.currentTime;
    cur.textContent = formatClock(time);
    scrub.value = Math.round(time * 10);
    if (loop && time >= loop.b) audio.currentTime = loop.a;
    const m = markAt(time);
    if (m && m.kind === 'silence' && (m.role === 'turn' || m.role === 'repeat')) {
      countdown.classList.remove('hidden');
      countdown.firstChild.textContent = m.role === 'repeat' ? t('player.repeatNow') : t('partner.yourTurn');
      countdown.lastChild.textContent = Math.ceil(Math.max(0, m.t + m.d - time));
    } else countdown.classList.add('hidden');
    if (m && m.itemId !== lastItem) {
      lastItem = m.itemId;
      const it = items.get(m.itemId);
      if (it && it.type === 'line') {
        const c = charById(script, it.charId);
        nowLine.replaceChildren(h('strong', { style: { color: c?.color } }, (c?.name || '') + ': '), m.kind === 'silence' ? h('span', { class: 'muted' }, '(' + t('studio.silenceFor') + ') ' + spokenText(it.text)) : spokenText(it.text));
      } else if (it) nowLine.replaceChildren(h('em', { class: 'muted' }, it.text));
      onLine.dispatchEvent(new CustomEvent('line', { detail: m.itemId }));
    }
    if (Math.round(time) % 5 === 0) { localStorage.setItem(posKey, String(time)); updatePosition(audio); }
  });
  audio.addEventListener('ended', () => { localStorage.removeItem(posKey); countdown.classList.add('hidden'); });

  const jumpLine = (dir) => {
    const time = audio.currentTime;
    if (dir > 0) { const n = lineStarts.find((m) => m.t > time + 0.05); if (n) audio.currentTime = n.t; }
    else {
      const prev = [...lineStarts].reverse().find((m) => m.t < time - 1.2);
      audio.currentTime = prev ? prev.t : 0;
    }
  };
  const seek = (s) => { audio.currentTime = Math.max(0, Math.min(audio.duration || entry.duration, audio.currentTime + s)); };

  setupMediaSession({ title: entry.name.replace(/\.\w+$/, ''), artist: entry.roleNames || 'ActoMind', album: entry.scriptTitle }, {
    play: () => audio.play(), pause: () => audio.pause(), stop: () => { audio.pause(); audio.currentTime = 0; },
    previoustrack: () => jumpLine(-1), nexttrack: () => jumpLine(1),
    seekbackward: (d) => seek(-(d?.seekOffset || skip)), seekforward: (d) => seek(d?.seekOffset || skip),
    seekto: (d) => { audio.currentTime = d.seekTime; },
  });

  // scene loop & fragment loop
  const scenes = script ? scenesOf(script.items) : [];
  const sceneRange = (sc) => {
    const ids = new Set(script.items.slice(sc.start, sc.end + 1).map((i) => i.id));
    const ms = marks.filter((m) => ids.has(m.itemId));
    return ms.length ? { a: ms[0].t, b: ms[ms.length - 1].t + ms[ms.length - 1].d } : null;
  };
  const sceneSel = scenes.length > 1 ? selectEl([{ value: '', label: t('player.noLoop') }, ...scenes.map((s) => ({ value: s.id, label: t('player.loopOf', { s: s.title || '—' }) }))], '', (v) => {
    const sc = scenes.find((s) => s.id === v);
    loop = sc ? sceneRange(sc) : null;
    if (loop) audio.currentTime = loop.a;
  }, { style: { width: 'auto' }, 'aria-label': t('player.loopScene') }) : null;
  let abState = 0;
  const abBtn = btn(t('player.abLoop'), () => {
    if (abState === 0) { loop = { a: audio.currentTime, b: Infinity }; abState = 1; abBtn.lastChild.textContent = t('player.abSetB'); }
    else if (abState === 1) { loop.b = Math.max(loop.a + 1, audio.currentTime); abState = 2; abBtn.lastChild.textContent = t('player.abClear'); abBtn.setAttribute('aria-pressed', 'true'); }
    else { loop = null; abState = 0; abBtn.lastChild.textContent = t('player.abLoop'); abBtn.setAttribute('aria-pressed', 'false'); }
  }, { cls: 'btn-sm', icon: 'repeat', pressed: false });

  const el = h('div', { class: 'player' },
    nowLine, countdown,
    h('div', { style: { marginTop: '10px' } }, scrub),
    h('div', { class: 'player-time' }, cur, tot),
    h('div', { class: 'player-main' },
      iconBtn('stop', t('player.stop'), () => { audio.pause(); audio.currentTime = 0; }),
      iconBtn('back5', t('player.back', { s: skip }), () => seek(-skip)),
      iconBtn('prev', t('player.prev'), () => jumpLine(-1)),
      playBtn,
      iconBtn('next', t('player.next'), () => jumpLine(1)),
      iconBtn('fwd5', t('player.fwd', { s: skip }), () => seek(skip))),
    h('div', { class: 'row', style: { justifyContent: 'center' } },
      h('span', { class: 'small muted' }, t('player.skipBy')),
      segmented([5, 10, 15].map((s) => ({ value: s, label: s + ' s' })), skip, (v) => { skip = v; localStorage.setItem('actomind.skip', String(v)); }),
      sceneSel, abBtn),
    h('div', { class: 'grid grid-2 stack-sm', style: { marginTop: '10px' } },
      h('div', {}, h('div', { class: 'label' }, t('player.speed')), rangeEl({ min: 0.5, max: 2, step: 0.05, value: 1, format: (x) => x.toFixed(2) + '×', onInput: (x) => { audio.playbackRate = x; } })),
      h('div', {}, h('div', { class: 'label' }, t('player.volume')), rangeEl({ min: 0, max: 1, step: 0.05, value: 1, format: (x) => Math.round(x * 100) + '%', onInput: (x) => { audio.volume = x; } }))),
  );
  return {
    el, audio, onLine,
    seekTo(time) { audio.currentTime = time; audio.play(); },
    destroy() { localStorage.setItem(posKey, String(audio.currentTime)); audio.pause(); URL.revokeObjectURL(url); clearMediaSession(); },
  };
}
