// ActoMind – microphone recordings (MediaRecorder). Stored only locally in IndexedDB.
import { db } from './db.js';
import { uid } from './util.js';

export function pickMime() {
  const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/aac'];
  for (const m of cands) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* ignore */ } }
  return '';
}

export function extFor(mime) {
  if (/webm/.test(mime)) return 'webm';
  if (/mp4|aac/.test(mime)) return 'm4a';
  if (/ogg/.test(mime)) return 'ogg';
  if (/wav/.test(mime)) return 'wav';
  return 'audio';
}

export class MicRecorder {
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mime = pickMime();
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.startedAt = performance.now();
    this.rec.start(250);
    return this.stream;
  }
  get elapsed() { return this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0; }
  stop() {
    return new Promise((resolve) => {
      if (!this.rec || this.rec.state === 'inactive') return resolve(null);
      this.rec.onstop = () => {
        const mime = this.rec.mimeType || 'audio/webm';
        const blob = new Blob(this.chunks, { type: mime });
        const duration = this.elapsed;
        this.release();
        resolve({ blob, mime, duration });
      };
      this.rec.stop();
    });
  }
  cancel() { try { this.rec?.stop(); } catch { /* ignore */ } this.release(); }
  release() { this.stream?.getTracks().forEach((tr) => tr.stop()); this.stream = null; this.startedAt = 0; }
}

export async function saveRecording(r) {
  const rec = { id: uid('rec_'), createdAt: Date.now(), note: '', intention: '', ...r };
  await db.put('recordings', rec);
  return rec;
}
export async function listRecordings(scriptId) {
  const all = await db.byIndex('recordings', 'scriptId', scriptId);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
export async function updateRecording(rec) { await db.put('recordings', rec); }
export async function deleteRecording(id) { await db.delete('recordings', id); }
