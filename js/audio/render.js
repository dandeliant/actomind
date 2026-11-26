// ActoMind – renders a program into a single PCM stream / WAV blob.
// Memory-friendly: audio is produced in chunks and periodically flushed into Blobs
// (browsers keep large Blobs out of the JS heap), silence reuses one zero buffer.
import { wavHeader, resample, floatToInt16 } from './wav.js';
import { beepSamples } from './beeps.js';
import { abortError } from '../core/util.js';

const FLUSH_BYTES = 8 * 1024 * 1024;

/**
 * Render a program.
 * @param {{segments:object[]}} program
 * @param {{
 *   sampleRate:number,
 *   getSpeech:(seg:object)=>Promise<{samples:Int16Array, sampleRate:number}>,
 *   onProgress?:(p:{index:number,total:number,seg:object})=>void,
 *   signal?:AbortSignal,
 *   volume?:number,
 * }} opts
 * @returns {Promise<{blob:Blob, duration:number, samples:number, marks:{t:number,d:number,kind:string,role:string,itemId:string}[]}>}
 */
export async function renderProgramToWav(program, opts) {
  const sr = opts.sampleRate;
  const zero = new Int16Array(sr); // one second of digital silence, reused
  let parts = [];
  let pendingBytes = 0;
  const flushed = [];
  let total = 0;
  const marks = [];
  const push = (arr) => {
    if (!arr.length) return;
    parts.push(arr);
    pendingBytes += arr.byteLength;
    total += arr.length;
    if (pendingBytes >= FLUSH_BYTES) flush();
  };
  const flush = () => {
    if (!parts.length) return;
    flushed.push(new Blob(parts.map((p) => (p.byteOffset === 0 && p.byteLength === p.buffer.byteLength ? p.buffer : p.slice().buffer))));
    parts = [];
    pendingBytes = 0;
  };
  const silence = (seconds) => {
    let n = Math.round(seconds * sr);
    while (n > 0) {
      const k = Math.min(n, zero.length);
      push(k === zero.length ? zero : zero.subarray(0, k));
      n -= k;
    }
  };

  const segs = program.segments;
  for (let i = 0; i < segs.length; i++) {
    if (opts.signal?.aborted) throw abortError();
    const seg = segs[i];
    const start = total;
    opts.onProgress?.({ index: i, total: segs.length, seg });
    if (seg.kind === 'speech') {
      const a = await opts.getSpeech(seg);
      let s = a.sampleRate === sr ? a.samples : resample(a.samples, a.sampleRate, sr);
      if (opts.volume != null && opts.volume !== 1) {
        s = Int16Array.from(s, (x) => Math.max(-32768, Math.min(32767, Math.round(x * opts.volume))));
      }
      push(s);
    } else if (seg.kind === 'silence') {
      silence(seg.seconds);
    } else if (seg.kind === 'beep') {
      push(floatToInt16(beepSamples(seg.style, sr)));
    }
    if (seg.kind !== 'marker') marks.push({ t: start / sr, d: (total - start) / sr, kind: seg.kind, role: seg.role, itemId: seg.itemId, charId: seg.charId || null });
    else marks.push({ t: start / sr, d: 0, kind: 'marker', role: seg.role, itemId: seg.itemId });
  }
  flush();
  const header = wavHeader(total, sr, 1, 16);
  const blob = new Blob([header, ...flushed], { type: 'audio/wav' });
  return { blob, duration: total / sr, samples: total, marks, sampleRate: sr };
}

/**
 * Iterate PCM Int16 frames of a 16-bit mono WAV blob in slices (for encoders).
 * @param {Blob} wavBlob produced by renderProgramToWav (44-byte header)
 */
export async function* wavPcmChunks(wavBlob, samplesPerChunk = 1152 * 64) {
  const bytes = samplesPerChunk * 2;
  for (let off = 44; off < wavBlob.size; off += bytes) {
    const ab = await wavBlob.slice(off, Math.min(wavBlob.size, off + bytes)).arrayBuffer();
    yield new Int16Array(ab, 0, ab.byteLength >> 1);
  }
}
