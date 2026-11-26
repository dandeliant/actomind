// ActoMind – WAV (PCM 16-bit) encoding/decoding and resampling. Pure functions, browser + Node.

export function wavHeader(numSamples, sampleRate, channels = 1, bits = 16) {
  const blockAlign = channels * (bits / 8);
  const dataSize = numSamples * blockAlign;
  const buf = new ArrayBuffer(44);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bits, true);
  str(36, 'data');
  v.setUint32(40, dataSize, true);
  return new Uint8Array(buf);
}

/**
 * Parse a WAV file (PCM 8/16/24/32-bit int or 32-bit float), mixing down to mono Int16.
 * @param {ArrayBuffer} ab
 */
export function parseWav(ab) {
  const v = new DataView(ab);
  const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (ab.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file');
  let off = 12;
  let fmt = null;
  let dataOff = -1;
  let dataLen = 0;
  while (off + 8 <= ab.byteLength) {
    const id = tag(off);
    let size = v.getUint32(off + 4, true);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = {
        format: v.getUint16(body, true),
        channels: v.getUint16(body + 2, true),
        sampleRate: v.getUint32(body + 4, true),
        bits: v.getUint16(body + 14, true),
      };
      if (fmt.format === 0xfffe && size >= 26) fmt.format = v.getUint16(body + 24, true);
    } else if (id === 'data') {
      dataOff = body;
      // streaming encoders may write 0 / 0xFFFFFFFF as size
      if (size === 0 || size === 0xffffffff || body + size > ab.byteLength) size = ab.byteLength - body;
      dataLen = size;
      break;
    }
    off = body + size + (size % 2);
  }
  if (!fmt || dataOff < 0) throw new Error('Invalid WAV structure');
  const { channels, bits, format, sampleRate } = fmt;
  const bps = bits / 8;
  const frames = Math.floor(dataLen / (bps * channels));
  const out = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) {
      const o = dataOff + (i * channels + c) * bps;
      let s;
      if (format === 3 && bits === 32) s = Math.max(-1, Math.min(1, v.getFloat32(o, true))) * 32767;
      else if (bits === 16) s = v.getInt16(o, true);
      else if (bits === 8) s = (v.getUint8(o) - 128) * 256;
      else if (bits === 24) s = ((v.getUint8(o + 2) << 24) | (v.getUint8(o + 1) << 16) | (v.getUint8(o) << 8)) >> 16;
      else if (bits === 32) s = v.getInt32(o, true) / 65536;
      else throw new Error('Unsupported WAV bit depth ' + bits);
      acc += s;
    }
    out[i] = Math.max(-32768, Math.min(32767, Math.round(acc / channels)));
  }
  return { sampleRate, channels, bits, samples: out, duration: frames / sampleRate };
}

/** Duration of a WAV without decoding samples. */
export function wavDuration(ab) {
  const v = new DataView(ab);
  let off = 12;
  let sr = 0;
  let blockAlign = 0;
  while (off + 8 <= ab.byteLength) {
    const id = String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3));
    let size = v.getUint32(off + 4, true);
    if (id === 'fmt ') { sr = v.getUint32(off + 12, true); blockAlign = v.getUint16(off + 20, true); }
    if (id === 'data') {
      if (size === 0 || off + 8 + size > ab.byteLength) size = ab.byteLength - off - 8;
      return sr && blockAlign ? size / blockAlign / sr : 0;
    }
    off += 8 + size + (size % 2);
  }
  return 0;
}

/** Linear-interpolation resampler (mono Int16). */
export function resample(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const outLen = Math.max(0, Math.round(samples.length / ratio));
  const out = new Int16Array(outLen);
  if (ratio > 1) {
    // downsampling: box-filter average to limit aliasing
    for (let i = 0; i < outLen; i++) {
      const a = Math.floor(i * ratio);
      const b = Math.min(samples.length, Math.floor((i + 1) * ratio));
      let s = 0;
      for (let k = a; k < b; k++) s += samples[k];
      out[i] = b > a ? Math.round(s / (b - a)) : samples[Math.min(a, samples.length - 1)];
    }
    return out;
  }
  for (let i = 0; i < outLen; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(samples.length - 1, i0 + 1);
    const f = x - i0;
    out[i] = Math.round(samples[i0] * (1 - f) + samples[i1] * f);
  }
  return out;
}

export function floatToInt16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return out;
}

export function int16ToFloat(i16) {
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) out[i] = i16[i] / 32768;
  return out;
}

/** Peak level 0..1 (used by tests and the timeline). */
export function peak(i16) {
  let p = 0;
  for (let i = 0; i < i16.length; i++) { const a = Math.abs(i16[i]); if (a > p) p = a; }
  return p / 32768;
}

/** Apply gain in dB in place (clipping protected). */
export function applyGain(i16, db) {
  if (!db) return i16;
  const g = 10 ** (db / 20);
  for (let i = 0; i < i16.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(i16[i] * g)));
  return i16;
}
