// ActoMind – audio encoders: MP3 (lamejs in a Web Worker) and Ogg/Opus (WebCodecs + own Ogg muxer).
import { wavPcmChunks } from './render.js';
import { resample, int16ToFloat } from './wav.js';
import { OggOpusMuxer } from './ogg.js';
import { abortError } from '../core/util.js';

export const MP3_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

/**
 * Encode a 16-bit mono WAV blob to MP3.
 * @param {Blob} wavBlob
 * @param {{sampleRate:number, kbps?:number, onProgress?:(ratio:number)=>void, signal?:AbortSignal}} o
 */
export function encodeMp3(wavBlob, o) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./mp3-worker.js', import.meta.url));
    const totalSamples = Math.max(1, (wavBlob.size - 44) / 2);
    let sent = 0;
    let inFlight = 0;
    let wake = null;
    const kbps = o.sampleRate <= 24000 ? Math.min(o.kbps || 96, 160) : (o.kbps || 128);
    const abort = () => { worker.terminate(); wake?.(); reject(abortError()); };
    o.signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'MP3 worker error')); };
    worker.onmessage = async (e) => {
      const m = e.data;
      if (m.type === 'ready') {
        try {
          for await (const pcm of wavPcmChunks(wavBlob)) {
            if (o.signal?.aborted) return;
            // back-pressure: keep at most 3 chunks queued in the worker
            while (inFlight >= 3) await new Promise((r) => { wake = r; });
            if (o.signal?.aborted) return;
            sent += pcm.length;
            inFlight++;
            worker.postMessage({ type: 'data', samples: pcm, done: sent / totalSamples }, [pcm.buffer]);
          }
          worker.postMessage({ type: 'end' });
        } catch (err) { worker.terminate(); reject(err); }
      } else if (m.type === 'progress') {
        inFlight--;
        const w = wake; wake = null; w?.();
        o.onProgress?.(m.done);
      } else if (m.type === 'done') {
        o.signal?.removeEventListener('abort', abort);
        worker.terminate();
        resolve(m.blob);
      } else if (m.type === 'error') {
        worker.terminate();
        reject(new Error(m.message));
      }
    };
    worker.postMessage({ type: 'init', sampleRate: o.sampleRate, kbps });
  });
}

export async function opusSupported() {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return false;
  try {
    const r = await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1, bitrate: 48000 });
    return !!r.supported;
  } catch {
    return false;
  }
}

/**
 * Encode a WAV blob to Ogg/Opus using WebCodecs.
 * @param {Blob} wavBlob
 * @param {{sampleRate:number, bitrate?:number, onProgress?:(ratio:number)=>void, signal?:AbortSignal}} o
 */
export async function encodeOpus(wavBlob, o) {
  const mux = new OggOpusMuxer({ channels: 1, inputSampleRate: o.sampleRate });
  let failure = null;
  const encoder = new AudioEncoder({
    output: (chunk) => {
      const buf = new Uint8Array(chunk.byteLength);
      chunk.copyTo(buf);
      const dur = chunk.duration ? Math.round((chunk.duration * 48000) / 1e6) : 960;
      mux.addPacket(buf, dur);
    },
    error: (e) => { failure = e; },
  });
  encoder.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1, bitrate: o.bitrate || 48000 });
  const totalSamples = Math.max(1, (wavBlob.size - 44) / 2);
  let done = 0;
  let ts = 0;
  let total48 = 0;
  for await (const pcm of wavPcmChunks(wavBlob, 48000)) {
    if (o.signal?.aborted) { encoder.close(); throw abortError(); }
    if (failure) throw failure;
    const s48 = resample(pcm, o.sampleRate, 48000);
    const f32 = int16ToFloat(s48);
    const ad = new AudioData({ format: 'f32', sampleRate: 48000, numberOfFrames: f32.length, numberOfChannels: 1, timestamp: ts, data: f32 });
    encoder.encode(ad);
    ad.close();
    ts += (f32.length / 48000) * 1e6;
    total48 += f32.length;
    done += pcm.length;
    o.onProgress?.(done / totalSamples);
    while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  return mux.finish(total48);
}

export function estimateSize(seconds, format, sampleRate, kbps) {
  if (format === 'wav') return 44 + seconds * sampleRate * 2;
  if (format === 'mp3') return (seconds * (kbps || 96) * 1000) / 8;
  if (format === 'ogg') return (seconds * 48000) / 8 + 4000;
  return 0;
}
