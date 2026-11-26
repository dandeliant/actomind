#!/usr/bin/env node
// ActoMind server: serves the PWA and proxies Google Cloud Text-to-Speech (credentials stay here).
// Zero dependencies. Usage: node server/server.js [--port 8080] [--host 0.0.0.0]
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GoogleTts, httpError, voiceModel, modelCapabilities, PRICE_HINTS } from './google-tts.js';
import { parseWav, wavHeader } from '../js/audio/wav.js';
import { estimateSpeech } from '../js/core/timing.js';
import { pieces, sentences } from '../js/core/tokenize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.data': 'application/octet-stream',
};
const PUBLIC_FILES = new Set(['index.html', 'manifest.webmanifest', 'sw.js', 'sw-manifest.js', 'favicon.ico']);
const PUBLIC_DIRS = new Set(['css', 'js', 'vendor', 'icons']);
const MAX_TEXT_BYTES = 4800; // Google limit is 5000 bytes per request

/** Minimal .env loader (KEY=VALUE, # comments, optional quotes). Existing env vars win. */
export function loadEnv(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
      if (!m || line.trim().startsWith('#')) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  } catch { /* no .env */ }
}

export function configFromEnv(env = process.env) {
  const credFile = env.GOOGLE_APPLICATION_CREDENTIALS ? path.resolve(ROOT, env.GOOGLE_APPLICATION_CREDENTIALS) : '';
  return {
    port: parseInt(env.PORT || '8080', 10),
    host: env.HOST || '0.0.0.0',
    apiKey: env.GOOGLE_TTS_API_KEY || env.GOOGLE_API_KEY || '',
    credentialsFile: credFile,
    credentialsJson: env.GOOGLE_CREDENTIALS_JSON || '',
    endpoint: env.GOOGLE_TTS_ENDPOINT || '',
    accessCode: env.ACTOMIND_ACCESS_CODE || '',
    allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    cacheDir: path.resolve(ROOT, env.TTS_CACHE_DIR || 'server/.cache'),
    cacheMaxBytes: parseInt(env.TTS_CACHE_MAX_MB || '500', 10) * 1024 * 1024,
    mock: env.ACTOMIND_TTS_MOCK === '1',
    rateLimit: parseInt(env.TTS_RATE_LIMIT || '600', 10), // synth requests per 10 min per IP
  };
}

// ---------------------------------------------------------------- disk cache (LRU by mtime)
class DiskCache {
  constructor(dir, maxBytes) {
    this.dir = dir;
    this.max = maxBytes;
    this.index = new Map();
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.wav')) continue;
      const st = fs.statSync(path.join(dir, f));
      this.index.set(f.slice(0, -4), { size: st.size, t: st.mtimeMs });
    }
  }
  get bytes() { let s = 0; for (const v of this.index.values()) s += v.size; return s; }
  async get(key) {
    if (!this.index.has(key)) return null;
    const file = path.join(this.dir, key + '.wav');
    try {
      const buf = await fsp.readFile(file);
      const now = new Date();
      fsp.utimes(file, now, now).catch(() => {});
      this.index.get(key).t = now.getTime();
      return buf;
    } catch { this.index.delete(key); return null; }
  }
  async set(key, buf) {
    await fsp.writeFile(path.join(this.dir, key + '.wav'), buf);
    this.index.set(key, { size: buf.length, t: Date.now() });
    let total = this.bytes;
    if (total <= this.max) return;
    const entries = [...this.index.entries()].sort((a, b) => a[1].t - b[1].t);
    for (const [k, v] of entries) {
      if (total <= this.max * 0.9) break;
      await fsp.unlink(path.join(this.dir, k + '.wav')).catch(() => {});
      this.index.delete(k);
      total -= v.size;
    }
  }
}

// ---------------------------------------------------------------- development test engine (not a voice!)
/** Deterministic test signal: one tone burst per word, timed like speech. Only when ACTOMIND_TTS_MOCK=1. */
export function mockSynthesize(text, voiceName = 'TEST', rate = 1, sampleRate = 24000) {
  const est = estimateSpeech(text, { rate });
  const words = pieces(text).filter((p) => p.type === 'word');
  const total = Math.max(0.3, est.seconds);
  const n = Math.round(total * sampleRate);
  const pcm = new Int16Array(n);
  const hash = [...voiceName].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const freq = 160 + (hash % 220);
  const per = words.length ? total / words.length : total;
  words.forEach((w, i) => {
    const start = Math.round(i * per * sampleRate);
    const len = Math.round(per * 0.75 * sampleRate);
    for (let k = 0; k < len && start + k < n; k++) {
      const t = k / sampleRate;
      const env = Math.sin((Math.PI * k) / len);
      pcm[start + k] = Math.round(Math.sin(2 * Math.PI * (freq + 15 * Math.sin(t * 9)) * t) * env * 9000);
    }
  });
  return Buffer.concat([Buffer.from(wavHeader(n, sampleRate)), Buffer.from(pcm.buffer)]);
}

const MOCK_VOICES = ['pl-PL', 'en-US', 'en-GB'].flatMap((lang) => ['A', 'B'].map((s, i) => ({
  name: `TEST-${lang}-Signal-${s}`, languageCodes: [lang], ssmlGender: i ? 'MALE' : 'FEMALE', naturalSampleRateHertz: 24000,
  model: 'TEST', capabilities: { pitch: true, speakingRate: true, ssml: false }, priceHintPerMillion: 0,
})));

// ---------------------------------------------------------------- helpers
function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const payload = isBuf ? body : typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(httpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function splitForTts(text) {
  if (Buffer.byteLength(text) <= MAX_TEXT_BYTES) return [text];
  const out = [];
  let cur = '';
  for (const s of sentences(text)) {
    if (Buffer.byteLength(cur + ' ' + s) > MAX_TEXT_BYTES && cur) { out.push(cur); cur = s; } else cur = cur ? cur + ' ' + s : s;
  }
  if (cur) out.push(cur);
  return out.flatMap((p) => (Buffer.byteLength(p) > MAX_TEXT_BYTES ? p.match(/.{1,1500}(\s|$)/gs) : [p]));
}

function joinWavs(bufs) {
  if (bufs.length === 1) return bufs[0];
  const parsed = bufs.map((b) => parseWav(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  const sr = parsed[0].sampleRate;
  const gap = new Int16Array(Math.round(sr * 0.25));
  const parts = [];
  parsed.forEach((p, i) => { if (i) parts.push(gap); parts.push(p.samples); });
  const n = parts.reduce((s, p) => s + p.length, 0);
  return Buffer.concat([Buffer.from(wavHeader(n, sr)), ...parts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.byteLength))]);
}

// ---------------------------------------------------------------- app
export function createApp(cfg = configFromEnv()) {
  const tts = new GoogleTts({ apiKey: cfg.apiKey, credentialsFile: cfg.credentialsFile, credentialsJson: cfg.credentialsJson, endpoint: cfg.endpoint, fetchImpl: cfg.fetchImpl });
  const cache = new DiskCache(cfg.cacheDir, cfg.cacheMaxBytes);
  const voicesCache = new Map();
  const hits = new Map();
  const mode = cfg.mock ? 'mock' : tts.mode;

  const rateOk = (ip) => {
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < 600000);
    arr.push(now);
    hits.set(ip, arr);
    return arr.length <= cfg.rateLimit;
  };

  const cors = (req) => {
    const origin = req.headers.origin;
    if (!origin || !cfg.allowedOrigins.length) return {};
    if (cfg.allowedOrigins.includes('*') || cfg.allowedOrigins.includes(origin)) {
      return { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-headers': 'content-type, x-actomind-access', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-expose-headers': 'x-actomind-cache, x-actomind-chars, x-actomind-duration, x-actomind-adjusted, x-actomind-model' };
    }
    return {};
  };

  async function api(req, res, url) {
    const h = cors(req);
    if (req.method === 'OPTIONS') return send(res, 204, '', h);
    if (url.pathname === '/api/health') return send(res, 200, { ok: true, name: 'ActoMind', time: new Date().toISOString() }, h);
    if (url.pathname === '/api/tts/status') {
      return send(res, 200, {
        configured: !!mode, mode, accessCodeRequired: !!cfg.accessCode,
        credentialsError: mode ? null : tts.credError || null,
        cache: { entries: cache.index.size, bytes: cache.bytes },
        priceHints: PRICE_HINTS,
      }, h);
    }
    if (!url.pathname.startsWith('/api/tts/')) return send(res, 404, { error: 'Not found' }, h);
    if (cfg.accessCode && !safeEqual(req.headers['x-actomind-access'] || '', cfg.accessCode)) {
      return send(res, 401, { error: 'ACCESS_CODE', message: 'Access code required' }, h);
    }
    if (!mode) return send(res, 503, { error: 'NOT_CONFIGURED', message: 'Google Cloud TTS is not configured on this server' }, h);

    if (url.pathname === '/api/tts/voices' && req.method === 'GET') {
      const lang = url.searchParams.get('languageCode') || '';
      if (mode === 'mock') return send(res, 200, { voices: MOCK_VOICES.filter((v) => !lang || v.languageCodes.some((l) => l.startsWith(lang))), mode }, h);
      const cached = voicesCache.get(lang);
      if (cached && Date.now() - cached.t < 6 * 3600000) return send(res, 200, { voices: cached.voices, mode }, h);
      const voices = await tts.listVoices(lang);
      voicesCache.set(lang, { t: Date.now(), voices });
      return send(res, 200, { voices, mode }, h);
    }

    if (url.pathname === '/api/tts/synthesize' && req.method === 'POST') {
      const ip = req.socket.remoteAddress || 'local';
      if (!rateOk(ip)) return send(res, 429, { error: 'RATE_LIMIT', message: 'Too many requests' }, h);
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, e.status || 400, { error: 'BAD_JSON', message: e.message }, h); }
      const text = String(body.text || '').trim();
      const voice = body.voice || {};
      const ac = body.audioConfig || {};
      if (!text) return send(res, 400, { error: 'EMPTY_TEXT' }, h);
      if (text.length > 20000) return send(res, 413, { error: 'TEXT_TOO_LONG' }, h);
      if (!voice.name || !voice.languageCode) return send(res, 400, { error: 'VOICE_REQUIRED' }, h);
      const audioConfig = {
        speakingRate: clampNum(ac.speakingRate, 0.25, 4, 1),
        pitch: clampNum(ac.pitch, -20, 20, 0),
        volumeGainDb: clampNum(ac.volumeGainDb, -96, 16, 0),
        sampleRateHertz: [16000, 22050, 24000, 44100, 48000].includes(ac.sampleRateHertz) ? ac.sampleRateHertz : 24000,
      };
      const key = crypto.createHash('sha256').update(JSON.stringify({ v: 1, mode, text, name: voice.name, lang: voice.languageCode, audioConfig })).digest('hex');
      let wav = await cache.get(key);
      let status = 'HIT';
      let adjusted = [];
      if (!wav) {
        status = 'MISS';
        if (mode === 'mock') {
          wav = mockSynthesize(text, voice.name, audioConfig.speakingRate, audioConfig.sampleRateHertz);
        } else {
          const parts = [];
          for (const piece of splitForTts(text)) {
            const r = await tts.synthesize({ text: piece, voice, audioConfig });
            parts.push(r.wav);
            adjusted = [...new Set([...adjusted, ...r.adjusted])];
          }
          wav = joinWavs(parts);
        }
        await cache.set(key, wav);
      }
      const dur = (() => { try { return parseWav(wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength)).duration; } catch { return 0; } })();
      return send(res, 200, wav, {
        ...h,
        'content-type': 'audio/wav',
        'cache-control': 'no-store',
        'x-actomind-cache': status,
        'x-actomind-chars': String(status === 'MISS' && mode !== 'mock' ? text.length : 0),
        'x-actomind-duration': dur.toFixed(3),
        'x-actomind-adjusted': adjusted.join(','),
        'x-actomind-model': mode === 'mock' ? 'TEST' : voiceModel(voice.name),
      });
    }
    return send(res, 404, { error: 'Not found' }, h);
  }

  async function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (!rel) rel = 'index.html';
    const top = rel.split('/')[0];
    if (!(PUBLIC_FILES.has(rel) || PUBLIC_DIRS.has(top)) || rel.includes('..') || rel.includes('\0')) {
      // SPA fallback for unknown routes without extension
      if (!path.extname(rel)) rel = 'index.html';
      else return send(res, 404, 'Not found');
    }
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden');
    try {
      const st = await fsp.stat(file);
      if (!st.isFile()) return send(res, 404, 'Not found');
      const ext = path.extname(file).toLowerCase();
      // always revalidate (offline caching is done by the service worker); 304 when unchanged
      const lastMod = st.mtime.toUTCString();
      const ims = req.headers['if-modified-since'];
      if (ims && Math.floor(st.mtimeMs / 1000) <= Math.floor(Date.parse(ims) / 1000)) {
        res.writeHead(304, { 'last-modified': lastMod, 'cache-control': 'no-cache' });
        return res.end();
      }
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'content-length': st.size,
        'cache-control': 'no-cache',
        'last-modified': lastMod,
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        ...(rel === 'index.html' ? { 'permissions-policy': 'camera=(), geolocation=(), microphone=(self)' } : {}),
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    } catch {
      send(res, 404, 'Not found');
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else if (req.method === 'GET' || req.method === 'HEAD') await serveStatic(req, res, url);
      else send(res, 405, 'Method not allowed');
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error('[ActoMind]', e.message);
      if (!res.headersSent) send(res, status, { error: status === 400 ? 'BAD_REQUEST' : 'UPSTREAM', message: e.message }, cors(req));
      else res.end();
    }
  });
  server.ttsMode = mode;
  return server;
}

function clampNum(v, min, max, def) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

// ---------------------------------------------------------------- CLI
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  loadEnv(path.join(ROOT, '.env'));
  loadEnv(path.join(__dirname, '.env'));
  const cfg = configFromEnv();
  const args = process.argv.slice(2);
  const ai = args.indexOf('--port');
  if (ai >= 0) cfg.port = parseInt(args[ai + 1], 10);
  const hi = args.indexOf('--host');
  if (hi >= 0) cfg.host = args[hi + 1];
  if (args.includes('--mock')) cfg.mock = true; // development test engine (tone bursts instead of a voice)
  // keep the service-worker precache list in sync with the files on disk (new version → update prompt in the app)
  try {
    const { build } = await import('../tools/gen-sw-manifest.mjs');
    const r = build();
    console.log(`Offline cache manifest: ${r.count} files (version ${r.version})`);
  } catch (e) { console.warn('Could not regenerate sw-manifest.js:', e.message); }
  const server = createApp(cfg);
  server.listen(cfg.port, cfg.host, () => {
    console.log(`ActoMind running at http://localhost:${cfg.port}`);
    console.log(`Google Cloud TTS: ${server.ttsMode ? server.ttsMode.toUpperCase() : 'not configured (Web Speech only – see README)'}${cfg.accessCode ? ' – access code required' : ''}`);
  });
}

export { voiceModel, modelCapabilities };
