// ActoMind – synthesized cue signals (identical for live playback and exported audio).

export const BEEP_STYLES = ['none', 'single', 'double', 'bell', 'startEnd'];

function tone(sampleRate, seconds, partials, decay = null, attack = 0.008, release = 0.03, amp = 0.32) {
  const n = Math.round(sampleRate * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let s = 0;
    for (const [f, a] of partials) s += a * Math.sin(2 * Math.PI * f * t);
    let env = 1;
    if (t < attack) env = t / attack;
    if (decay) env *= Math.exp(-t / decay);
    const tr = seconds - t;
    if (tr < release) env *= Math.max(0, tr / release);
    out[i] = s * env * amp;
  }
  return out;
}

/**
 * Float samples for a signal kind.
 * @param {'single'|'double'|'bell'|'end'} kind
 */
export function beepSamples(kind, sampleRate) {
  if (kind === 'single') return tone(sampleRate, 0.14, [[880, 1]]);
  if (kind === 'end') return tone(sampleRate, 0.12, [[660, 1]]);
  if (kind === 'double') {
    const a = tone(sampleRate, 0.09, [[880, 1]]);
    const gap = Math.round(sampleRate * 0.08);
    const out = new Float32Array(a.length * 2 + gap);
    out.set(a, 0);
    out.set(a, a.length + gap);
    return out;
  }
  if (kind === 'bell') return tone(sampleRate, 0.9, [[1318.5, 1], [2637, 0.35], [3955.5, 0.12], [1975.5, 0.18]], 0.28, 0.004, 0.05, 0.22);
  return new Float32Array(0);
}

export function beepSeconds(kind) {
  return { single: 0.14, end: 0.12, double: 0.26, bell: 0.9 }[kind] || 0;
}

/** Which beeps surround an actor's silent turn for a style. */
export function beepsForTurn(style) {
  switch (style) {
    case 'single': return { before: 'single', after: null };
    case 'double': return { before: 'double', after: null };
    case 'bell': return { before: 'bell', after: null };
    case 'startEnd': return { before: 'single', after: 'end' };
    default: return { before: null, after: null };
  }
}

let ctx = null;
/** Play a beep live through Web Audio. Resolves when finished. */
export function playBeep(kind, volume = 1) {
  return new Promise((resolve) => {
    try {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return resolve();
      ctx = ctx || new AC();
      if (ctx.state === 'suspended') ctx.resume();
      const data = beepSamples(kind, ctx.sampleRate);
      const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
      buf.copyToChannel(data, 0);
      const src = ctx.createBufferSource();
      const g = ctx.createGain();
      g.gain.value = volume;
      src.buffer = buf;
      src.connect(g).connect(ctx.destination);
      src.onended = () => resolve();
      src.start();
    } catch {
      resolve();
    }
  });
}
