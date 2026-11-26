import { test, eq, ok } from './harness.mjs';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createApp, configFromEnv, mockSynthesize } from '../server/server.js';
import { parseWav } from '../js/audio/wav.js';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

/** Fake Google TTS REST endpoint */
function fakeGoogle() {
  const calls = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push({ url: req.url, body: body ? JSON.parse(body) : null });
      if (!req.url.includes('key=TESTKEY')) { res.writeHead(403); return res.end('{"error":{"message":"bad key"}}'); }
      if (req.url.startsWith('/v1/voices')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ voices: [
          { name: 'pl-PL-Wavenet-A', languageCodes: ['pl-PL'], ssmlGender: 'FEMALE', naturalSampleRateHertz: 24000 },
          { name: 'pl-PL-Chirp3-HD-Charon', languageCodes: ['pl-PL'], ssmlGender: 'MALE', naturalSampleRateHertz: 24000 },
          { name: 'pl-PL-Future-X', languageCodes: ['pl-PL'], ssmlGender: 'MALE', naturalSampleRateHertz: 24000 },
        ] }));
      }
      if (req.url.startsWith('/v1/text:synthesize')) {
        const b = JSON.parse(body);
        // simulate a new model that rejects pitch
        if (b.voice.name === 'pl-PL-Future-X' && 'pitch' in b.audioConfig) {
          res.writeHead(400, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: { code: 400, message: 'This voice does not support pitch parameters.' } }));
        }
        const wav = mockSynthesize(b.input.text, b.voice.name, b.audioConfig.speakingRate || 1, b.audioConfig.sampleRateHertz);
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ audioContent: wav.toString('base64') }));
      }
      res.writeHead(404); res.end();
    });
  });
  return { srv, calls };
}

async function withServers(envOverrides, fn) {
  const g = fakeGoogle();
  const gPort = await listen(g.srv);
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actomind-cache-'));
  const cfg = { ...configFromEnv({}), apiKey: 'TESTKEY', endpoint: `http://127.0.0.1:${gPort}`, cacheDir, ...envOverrides };
  const app = createApp(cfg);
  const port = await listen(app);
  const base = `http://127.0.0.1:${port}`;
  try { await fn(base, g.calls); } finally {
    app.close(); g.srv.close();
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
}

const synth = (base, body, headers = {}) => fetch(base + '/api/tts/synthesize', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('server: status, voice list with model capabilities', async () => {
  await withServers({}, async (base) => {
    const st = await (await fetch(base + '/api/tts/status')).json();
    eq(st.configured, true);
    eq(st.mode, 'apiKey');
    const v = await (await fetch(base + '/api/tts/voices?languageCode=pl-PL')).json();
    eq(v.voices.length, 3);
    const chirp = v.voices.find((x) => x.name.includes('Chirp3'));
    eq(chirp.model, 'Chirp3-HD');
    eq(chirp.capabilities.pitch, false);
    eq(v.voices.find((x) => x.name.includes('Wavenet')).capabilities.pitch, true);
  });
});

test('server: synthesize returns WAV, caches (no second billable call)', async () => {
  await withServers({}, async (base, calls) => {
    const body = { text: 'Dzień dobry, panie dyrektorze.', voice: { name: 'pl-PL-Wavenet-A', languageCode: 'pl-PL' }, audioConfig: { speakingRate: 1.1, pitch: 2 } };
    const r1 = await synth(base, body);
    eq(r1.status, 200);
    eq(r1.headers.get('content-type'), 'audio/wav');
    eq(r1.headers.get('x-actomind-cache'), 'MISS');
    ok(Number(r1.headers.get('x-actomind-chars')) > 10);
    const wav = parseWav(await r1.arrayBuffer());
    ok(wav.duration > 0.5);
    const synthCalls = () => calls.filter((c) => c.url.startsWith('/v1/text:synthesize')).length;
    eq(synthCalls(), 1);
    const r2 = await synth(base, body);
    eq(r2.headers.get('x-actomind-cache'), 'HIT');
    eq(r2.headers.get('x-actomind-chars'), '0');
    eq(synthCalls(), 1, 'cached on server');
    // sent parameters
    const sent = calls.find((c) => c.url.startsWith('/v1/text:synthesize')).body;
    eq(sent.audioConfig.audioEncoding, 'LINEAR16');
    eq(sent.audioConfig.pitch, 2);
  });
});

test('server: unsupported parameters dropped per model (table + API retry)', async () => {
  await withServers({}, async (base, calls) => {
    const r = await synth(base, { text: 'Test.', voice: { name: 'pl-PL-Chirp3-HD-Charon', languageCode: 'pl-PL' }, audioConfig: { pitch: 3, speakingRate: 1.2 } });
    eq(r.status, 200);
    eq(r.headers.get('x-actomind-adjusted'), 'pitch');
    const sent = calls.filter((c) => c.url.startsWith('/v1/text:synthesize')).pop().body;
    ok(!('pitch' in sent.audioConfig));
    eq(sent.audioConfig.speakingRate, 1.2);
    const r2 = await synth(base, { text: 'Inny test.', voice: { name: 'pl-PL-Future-X', languageCode: 'pl-PL' }, audioConfig: { pitch: 3 } });
    eq(r2.status, 200);
    eq(r2.headers.get('x-actomind-adjusted'), 'pitch');
  });
});

test('server: access code, validation, not-configured, static file protection', async () => {
  await withServers({ accessCode: 'sekret' }, async (base) => {
    const st = await (await fetch(base + '/api/tts/status')).json();
    eq(st.accessCodeRequired, true);
    const body = { text: 'A', voice: { name: 'pl-PL-Wavenet-A', languageCode: 'pl-PL' } };
    eq((await synth(base, body)).status, 401);
    eq((await synth(base, body, { 'x-actomind-access': 'sekret' })).status, 200);
    eq((await synth(base, { text: '', voice: body.voice }, { 'x-actomind-access': 'sekret' })).status, 400);
    const idx = await fetch(base + '/');
    eq(idx.status, 200);
    ok((await idx.text()).includes('ActoMind'));
    eq((await fetch(base + '/server/server.js')).status, 404);
    eq((await fetch(base + '/package.json')).status, 404);
    eq((await fetch(base + '/js/core/util.js')).status, 200);
  });
  await withServers({ apiKey: '' }, async (base) => {
    const st = await (await fetch(base + '/api/tts/status')).json();
    eq(st.configured, false);
    eq((await synth(base, { text: 'A', voice: { name: 'x', languageCode: 'pl-PL' } })).status, 503);
  });
});

test('server: mock test engine (ACTOMIND_TTS_MOCK) works without credentials', async () => {
  await withServers({ apiKey: '', mock: true }, async (base) => {
    const st = await (await fetch(base + '/api/tts/status')).json();
    eq(st.mode, 'mock');
    const v = await (await fetch(base + '/api/tts/voices?languageCode=pl-PL')).json();
    ok(v.voices.every((x) => x.name.startsWith('TEST-')));
    const r = await synth(base, { text: 'Próba.', voice: { name: v.voices[0].name, languageCode: 'pl-PL' } });
    eq(r.status, 200);
  });
});
