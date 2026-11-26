// ActoMind – live playback of a program with Web Speech / cached cloud audio, silences and signals.
import { speakItem, stopAllSpeech, prefetchItem } from './voice-engine.js';
import { playBeep } from './beeps.js';
import { sleep } from '../core/util.js';

/**
 * Events (EventTarget): 'segment' {index, seg}, 'tick' {seg, remaining, total}, 'state' {state}, 'end', 'error' {error}
 */
export class LivePlayer extends EventTarget {
  /**
   * @param {object} script
   * @param {{segments:object[], total:number}} program
   * @param {{rate?:number, gapScale?:number, volume?:number}} opts
   */
  constructor(script, program, opts = {}) {
    super();
    this.script = script;
    this.program = program;
    this.index = 0;
    this.state = 'idle';
    this.rate = opts.rate ?? 1;
    this.gapScale = opts.gapScale ?? 1;
    this.volume = opts.volume ?? 1;
    this.loop = null; // {from, to} segment indices
    this.repeatOne = false;
    this.ctrl = null;
    this.elapsedInSeg = 0;
    this.runId = 0;
  }
  get segments() { return this.program.segments; }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  setState(s) { this.state = s; this.emit('state', { state: s }); }
  setProgram(program, keepItemId) {
    const itemId = keepItemId ?? this.segments[this.index]?.itemId;
    this.program = program;
    const i = program.segments.findIndex((s) => s.itemId === itemId);
    this.index = i >= 0 ? i : 0;
    this.loop = null;
  }

  /** Approximate current time on the program timeline. */
  get currentTime() {
    const s = this.segments[this.index];
    return s ? s.t + Math.min(s.seconds, this.elapsedInSeg) : this.program.total;
  }

  play(fromIndex) {
    if (fromIndex != null) this.index = Math.max(0, Math.min(this.segments.length - 1, fromIndex));
    if (this.state === 'playing' && fromIndex == null) return;
    this.abortCurrent();
    this.setState('playing');
    this.run(++this.runId);
  }
  pause() {
    if (this.state !== 'playing') return;
    this.abortCurrent();
    this.setState('paused');
  }
  toggle() { this.state === 'playing' ? this.pause() : this.play(); }
  stop() {
    this.abortCurrent();
    this.index = 0;
    this.elapsedInSeg = 0;
    this.setState('idle');
    this.emit('segment', { index: 0, seg: this.segments[0] });
  }
  abortCurrent() {
    this.runId++;
    this.ctrl?.abort();
    this.ctrl = null;
    stopAllSpeech();
  }
  /** Jump to the first segment of the next / previous line (item). */
  lineStarts() {
    const starts = [];
    let last = null;
    this.segments.forEach((s, i) => {
      if (s.kind === 'marker') return;
      if (s.itemId !== last && (s.kind === 'speech' || (s.kind === 'silence' && s.role !== 'gap') || s.kind === 'beep')) { starts.push(i); last = s.itemId; }
    });
    return starts;
  }
  next() {
    const starts = this.lineStarts();
    const n = starts.find((i) => i > this.index);
    this.jump(n ?? this.segments.length - 1);
  }
  prev() {
    const starts = this.lineStarts();
    const cur = [...starts].reverse().find((i) => i <= this.index) ?? 0;
    const p = this.elapsedInSeg > 1.5 && this.state === 'playing' ? cur : [...starts].reverse().find((i) => i < cur) ?? 0;
    this.jump(p);
  }
  jump(i) {
    const playing = this.state === 'playing';
    this.abortCurrent();
    this.index = Math.max(0, Math.min(this.segments.length - 1, i));
    this.elapsedInSeg = 0;
    this.emit('segment', { index: this.index, seg: this.segments[this.index] });
    if (playing) { this.setState('playing'); this.run(++this.runId); }
  }
  jumpToItem(itemId) {
    const i = this.segments.findIndex((s) => s.itemId === itemId && s.kind !== 'marker');
    if (i >= 0) this.jump(i);
  }
  seekBy(seconds) {
    const target = Math.max(0, this.currentTime + seconds);
    let i = this.segments.findIndex((s) => s.t + s.seconds > target);
    if (i < 0) i = this.segments.length - 1;
    // snap to the start of that line for speech (speech cannot start mid-way)
    this.jump(i);
  }
  /** Loop a range of item ids (scene or selected fragment) or clear with null. */
  setLoop(fromItemId, toItemId) {
    if (!fromItemId) { this.loop = null; return; }
    const from = this.segments.findIndex((s) => s.itemId === fromItemId);
    let to = -1;
    this.segments.forEach((s, i) => { if (s.itemId === toItemId) to = i; });
    this.loop = from >= 0 && to >= from ? { from, to } : null;
  }

  async run(id) {
    while (this.runId === id && this.state === 'playing') {
      if (this.index >= this.segments.length) {
        if (this.loop) { this.index = this.loop.from; continue; }
        this.setState('idle');
        this.index = 0;
        this.emit('end');
        return;
      }
      const seg = this.segments[this.index];
      this.emit('segment', { index: this.index, seg });
      this.ctrl = new AbortController();
      const signal = this.ctrl.signal;
      this.elapsedInSeg = 0;
      try {
        if (seg.kind === 'speech') {
          const nx = this.segments.slice(this.index + 1).find((x) => x.kind === 'speech');
          if (nx) prefetchItem(this.script, nx.voiceKey, nx.text, nx.itemId);
          await speakItem(this.script, seg.voiceKey, seg.text, seg.itemId, { signal, rateScale: this.rate, volumeScale: this.volume });
        } else if (seg.kind === 'silence') {
          const total = seg.role === 'gap' ? seg.seconds * this.gapScale : seg.seconds;
          const start = performance.now();
          while (true) {
            const el = (performance.now() - start) / 1000;
            this.elapsedInSeg = el;
            const remaining = total - el;
            if (seg.role !== 'gap') this.emit('tick', { seg, remaining, total });
            if (remaining <= 0) break;
            await sleep(Math.min(100, remaining * 1000), signal);
          }
        } else if (seg.kind === 'beep') {
          await playBeep(seg.style, this.volume);
        }
      } catch (e) {
        if (e.name === 'AbortError') return;
        this.emit('error', { error: e });
        await sleep(300).catch(() => {});
      }
      if (this.runId !== id) return;
      // repeat single line: go back to the start of this line when the line's last segment finished
      const nextSeg = this.segments[this.index + 1];
      if (this.repeatOne && (!nextSeg || nextSeg.itemId !== seg.itemId)) {
        const starts = this.lineStarts();
        const cur = [...starts].reverse().find((i) => i <= this.index) ?? 0;
        this.index = cur;
        await sleep(600).catch(() => {});
        continue;
      }
      this.index++;
      if (this.loop && this.index > this.loop.to) this.index = this.loop.from;
    }
  }
}
