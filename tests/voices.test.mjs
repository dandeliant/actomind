import { test, eq, ok, near } from './harness.mjs';
import { guessGender, guessVoiceGender, autoCast, VARIANTS, variantOf } from '../js/core/autocast.js';
import { trimAndNormalize, webRequestFrom } from '../js/audio/capture.js';
import { parseCatalog, piperRequestFrom, normalizeFloat, PIPER_GENDER } from '../js/audio/piper.js';
import { clipRequest, hasVoice } from '../js/audio/providers.js';
import { collectRequests } from '../js/audio/exporter.js';
import { buildProgram, engineRate, defaultStudio } from '../js/audio/program.js';
import { parseScript } from '../js/core/parser.js';
import { DEMO_PL } from '../js/core/demo.js';

test('autocast: gender guessed from Polish and English role names', () => {
  eq(guessGender('MATKA', 'pl'), 'FEMALE');
  eq(guessGender('SEKRETARKA', 'pl'), 'FEMALE');
  eq(guessGender('DYREKTOR', 'pl'), 'MALE');
  eq(guessGender('PANI KOWALSKA', 'pl'), 'FEMALE');
  eq(guessGender('KUBA', 'pl'), 'MALE');
  eq(guessGender('TATA', 'pl'), 'MALE');
  eq(guessGender('MOTHER', 'en'), 'FEMALE');
  eq(guessGender('HEADMASTER', 'en'), 'MALE');
  eq(guessGender('SECRETARY', 'en'), null);
  eq(guessVoiceGender('Microsoft Paulina - Polish (Poland)'), 'FEMALE');
  eq(guessVoiceGender('Microsoft Adam - Polish (Poland)'), 'MALE');
  eq(guessVoiceGender('Microsoft Zofia Online (Natural) - Polish (Poland)'), 'FEMALE');
  eq(guessVoiceGender('Google polski'), null);
});

test('autocast: distinct voices matched by gender, variants when voices run out', () => {
  const chars = [
    { id: 'm', name: 'MATKA', lines: 18 }, { id: 'd', name: 'DYREKTOR', lines: 18 }, { id: 's', name: 'SEKRETARKA', lines: 3 },
    { id: 'n', name: 'NARRATOR', lines: 2 },
  ];
  const pool = [{ id: 'paulina', gender: 'FEMALE' }, { id: 'adam', gender: 'MALE' }];
  const c = autoCast(chars, pool, 'pl');
  eq(c.m.voice, 'paulina');
  eq(c.d.voice, 'adam');
  eq(c.s.voice, 'paulina');
  ok(c.s.variant > 0, 'second female character gets a variant');
  eq(c.n.voice, 'adam');
  ok(variantOf(VARIANTS.webPitch, c.s.variant) !== 1, 'variant changes pitch');
  // one voice per character when enough voices
  const big = autoCast(chars, [{ id: 'a', gender: 'FEMALE' }, { id: 'b', gender: 'FEMALE' }, { id: 'c', gender: 'MALE' }, { id: 'd', gender: 'MALE' }], 'pl');
  eq(new Set(Object.values(big).map((x) => x.voice)).size, 4);
});

test('capture: trimming and normalisation of recorded speech', () => {
  const sr = 48000;
  const raw = new Float32Array(sr * 2); // 2 s, speech between 0.5 and 1.2 s
  for (let i = Math.round(0.5 * sr); i < Math.round(1.2 * sr); i++) raw[i] = Math.sin(i / 7) * 0.2;
  for (let i = 0; i < raw.length; i += 97) raw[i] += 0.0005; // noise floor
  const out = trimAndNormalize(raw, sr);
  near(out.length / sr, 0.7 + 0.12, 0.02);
  let peak = 0;
  for (const x of out) peak = Math.max(peak, Math.abs(x));
  near(peak, 0.89, 0.02);
  eq(trimAndNormalize(new Float32Array(1000), sr).length, 0, 'silence → empty clip');
  eq(webRequestFrom({ voiceURI: 'x', rate: 1.2 }, 'Tak').rate, 1.2);
});

test('piper: catalogue parsing, requests and normalisation', () => {
  const cat = parseCatalog({
    'pl_PL-gosia-medium': { language: { family: 'pl' }, quality: 'medium', num_speakers: 1, speaker_id_map: {}, files: { 'pl/pl_PL/gosia/medium/pl_PL-gosia-medium.onnx': { size_bytes: 63000000 }, 'pl/pl_PL/gosia/medium/pl_PL-gosia-medium.onnx.json': { size_bytes: 5000 }, 'pl/pl_PL/gosia/medium/MODEL_CARD': {} } },
    'en_GB-vctk-medium': { language: { family: 'en' }, quality: 'medium', num_speakers: 3, speaker_id_map: { p239: 1, p236: 0, p264: 2 }, files: { 'a.onnx': { size_bytes: 1 }, 'a.onnx.json': { size_bytes: 1 } } },
  });
  const g = cat.find((v) => v.key === 'pl_PL-gosia-medium');
  eq(g.family, 'pl');
  eq(g.gender, 'FEMALE');
  eq(g.onnx, 'pl/pl_PL/gosia/medium/pl_PL-gosia-medium.onnx');
  eq(cat.find((v) => v.family === 'en').speakerNames, ['p236', 'p239', 'p264']);
  const r = piperRequestFrom({ voice: 'pl_PL-gosia-medium', rate: 1.25, speaker: 0, gain: 2 }, 'Dzień dobry.');
  eq(r.lengthScale, 0.8);
  eq(r.engine, 'piper');
  const n = normalizeFloat(Float32Array.from([0, 0.5, -0.25]));
  near(Math.max(...n.map(Math.abs)), 0.89, 1e-6);
  ok(PIPER_GENDER['pl_PL-darkman'] === 'MALE');
});

test('providers: requests per engine and missing voices for export', async () => {
  const p = parseScript(DEMO_PL.text);
  const script = { ...p, lang: 'pl', myRoles: [p.characters[0].id], voices: {}, studio: { ...defaultStudio(), engine: 'piper' } };
  const matka = p.characters[0].id;
  eq(hasVoice(script, 'piper', matka), false);
  eq(hasVoice(script, 'web', matka), true);
  let res = await collectRequests(script, ['full'], { type: 'all' }, { engine: 'piper' });
  eq(res.list.length, 0);
  eq(res.missingVoices.length, 3);
  for (const c of p.characters) script.voices[c.id] = { piper: { voice: 'pl_PL-gosia-medium', rate: 1, speaker: 0 } };
  res = await collectRequests(script, ['full', 'rehearsal'], { type: 'all' }, { engine: 'piper' });
  eq(res.missingVoices, []);
  ok(res.list.length >= 39, 'every spoken line once');
  ok(res.list.every((x) => x.key.startsWith('piper:')));
  eq(new Set(res.list.map((x) => x.key)).size, res.list.length, 'unique cache keys');
  const req = clipRequest(script, 'web', matka, 'Tak.', null);
  eq(req.engine, 'web');
  // engine-aware time estimate
  script.voices[matka].piper.rate = 2;
  eq(engineRate(script, matka, null, 'piper'), 2);
  const fast = buildProgram(script, { mode: 'full' }).total;
  script.voices[matka].piper.rate = 1;
  ok(buildProgram(script, { mode: 'full' }).total > fast, 'slower Piper rate → longer estimate');
});
