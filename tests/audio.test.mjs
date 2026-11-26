import { test, eq, ok, near } from './harness.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { parseScript } from '../js/core/parser.js';
import { wavHeader, parseWav, resample, peak } from '../js/audio/wav.js';
import { buildProgram, speechRequests, segmentAt, selectRange } from '../js/audio/program.js';
import { renderProgramToWav, wavPcmChunks } from '../js/audio/render.js';
import { createZip, readZip, crc32Update } from '../js/core/zip.js';
import { OggOpusMuxer, oggCrc } from '../js/audio/ogg.js';
import { docxXmlToText, docxToText, decodeText } from '../js/core/importers.js';
import { mockSynthesize } from '../server/server.js';

const SCRIPT_TXT = `SCENA 1
ANNA: Dzień dobry.
PIOTR: Witaj, Anno. Jak się masz?
ANNA: Świetnie, dziękuję.
(Piotr siada.)
PIOTR: To dobrze.
SCENA 2
ANNA: Muszę już iść.
PIOTR: Szkoda.`;

function makeScript() {
  const s = parseScript(SCRIPT_TXT);
  const anna = s.characters.find((c) => c.name === 'ANNA');
  return { ...s, lang: 'pl', myRoles: [anna.id], voices: {}, studio: {} };
}

// fake "TTS": each text → tone with length proportional to characters (deterministic, measurable)
const SR = 24000;
function fakeSpeech(text) {
  const seconds = 0.05 * text.length;
  const n = Math.round(seconds * SR);
  const s = new Int16Array(n);
  for (let i = 0; i < n; i++) s[i] = Math.round(Math.sin(i / 5) * 8000);
  return { samples: s, sampleRate: SR, seconds: n / SR };
}

test('wav: header + parse roundtrip, resampling', () => {
  const pcm = new Int16Array(4800).map((_, i) => Math.round(Math.sin(i / 3) * 10000));
  const buf = new Uint8Array(44 + pcm.byteLength);
  buf.set(wavHeader(pcm.length, 24000), 0);
  buf.set(new Uint8Array(pcm.buffer), 44);
  const p = parseWav(buf.buffer);
  eq(p.sampleRate, 24000);
  eq(p.samples.length, 4800);
  near(p.duration, 0.2, 1e-9);
  eq(p.samples[123], pcm[123]);
  eq(resample(pcm, 24000, 48000).length, 9600);
  eq(resample(pcm, 24000, 16000).length, 3200);
});

test('program: rehearsal mode leaves silence = duration × 1.5 + 1 s for own lines', () => {
  const s = makeScript();
  const prog = buildProgram(s, { mode: 'rehearsal', durationOf: (item, text) => ({ seconds: 2, approx: false }) });
  const annaId = s.myRoles[0];
  const turns = prog.segments.filter((x) => x.role === 'turn');
  eq(turns.length, 3, 'three Anna lines become silent turns');
  turns.forEach((t) => { eq(t.seconds, 4); eq(t.approx, false); eq(t.charId, annaId); });
  const spoken = prog.segments.filter((x) => x.kind === 'speech');
  ok(spoken.every((x) => x.charId !== annaId), 'own lines are not spoken');
  eq(spoken.length, 3);
});

test('program: order of dialogue preserved; modes full / mine / hints / repeat / dress', () => {
  const s = makeScript();
  const est = (i, t) => ({ seconds: t.length * 0.05, approx: true });
  const full = buildProgram(s, { mode: 'full', durationOf: est });
  eq(full.segments.filter((x) => x.kind === 'speech').map((x) => x.text), ['Dzień dobry.', 'Witaj, Anno. Jak się masz?', 'Świetnie, dziękuję.', 'To dobrze.', 'Muszę już iść.', 'Szkoda.']);
  const mine = buildProgram(s, { mode: 'mine', durationOf: est });
  eq(mine.segments.filter((x) => x.kind === 'speech').map((x) => x.text), ['Dzień dobry.', 'Świetnie, dziękuję.', 'Muszę już iść.']);
  const hints = buildProgram(s, { mode: 'hints', studio: { hintMode: 'first1' }, durationOf: est });
  const hintSegs = hints.segments.filter((x) => x.role === 'hint');
  eq(hintSegs.map((x) => x.text), ['Dzień…', 'Świetnie…', 'Muszę…']);
  ok(hints.segments.filter((x) => x.role === 'turn').every((x) => x.seconds > 0.5));
  const rep = buildProgram(s, { mode: 'repeat', durationOf: est });
  ok(rep.segments.some((x) => x.role === 'repeat'));
  const dress = buildProgram(s, { mode: 'dress', studio: { beep: 'double' }, durationOf: est });
  ok(!dress.segments.some((x) => x.kind === 'beep'), 'no signals in dress rehearsal');
  const beeps = buildProgram(s, { mode: 'rehearsal', studio: { beep: 'startEnd' }, durationOf: est });
  eq(beeps.segments.filter((x) => x.kind === 'beep').length, 6);
});

test('program: per-role read modes, manual silence override, ranges', () => {
  const s = makeScript();
  const annaId = s.myRoles[0];
  s.studio = { roleModes: { [annaId]: 'read' } };
  let p = buildProgram(s, { mode: 'rehearsal' });
  ok(p.segments.some((x) => x.role === 'mine'), 'read option speaks own lines');
  s.studio = { roleModes: { [annaId]: 'first3' } };
  p = buildProgram(s, { mode: 'rehearsal' });
  eq(p.segments.filter((x) => x.role === 'hint').length, 3);
  const firstAnna = s.items.find((x) => x.type === 'line' && x.charId === annaId);
  s.studio = { lineOverrides: { [firstAnna.id]: { silence: 9.5 } } };
  p = buildProgram(s, { mode: 'rehearsal' });
  const t = p.segments.find((x) => x.role === 'turn' && x.itemId === firstAnna.id);
  eq(t.seconds, 9.5);
  eq(t.source, 'manual');
  ok(p.approx, 'web estimate is marked approximate');
  // scene 2 only
  const sc2 = s.items.filter((x) => x.type === 'scene')[1];
  const r = selectRange(s, { type: 'scene', id: sc2.id });
  eq(r.indices.map((i) => s.items[i].text), ['SCENA 2', 'Muszę już iść.', 'Szkoda.']);
  // difficult only → with preceding partner line, excerpt break inserted
  const annaLines = s.items.filter((x) => x.type === 'line' && x.charId === annaId);
  const d = selectRange(s, { type: 'difficult', ids: [annaLines[1].id] });
  eq(d.indices.map((i) => s.items[i].text), ['Witaj, Anno. Jak się masz?', 'Świetnie, dziękuję.']);
});

test('render: concatenation order, exact digital silence, marks and duration', async () => {
  const s = makeScript();
  const measured = new Map();
  const durationOf = (item, text) => {
    const f = fakeSpeech(text);
    measured.set(text, f.seconds);
    return { seconds: f.seconds, approx: false };
  };
  const prog = buildProgram(s, { mode: 'rehearsal', durationOf });
  const reqs = speechRequests(prog);
  eq(reqs.length, 3);
  const out = await renderProgramToWav(prog, { sampleRate: SR, getSpeech: async (seg) => fakeSpeech(seg.text) });
  near(out.duration, prog.total, 0.01);
  const wav = parseWav(await out.blob.arrayBuffer());
  eq(wav.samples.length, out.samples);
  // every silent turn must be exactly zero samples, every speech non-silent
  for (const m of out.marks) {
    const a = Math.round(m.t * SR);
    const b = Math.round((m.t + m.d) * SR);
    const slice = wav.samples.subarray(a, b);
    if (m.kind === 'silence') eq(peak(slice), 0, 'silence is digital zero');
    if (m.kind === 'speech') ok(peak(slice) > 0.1, 'speech has audio');
  }
  // own line silence = measured × 1.5 + 1
  const turn = out.marks.find((m) => m.role === 'turn');
  const firstAnnaText = 'Dzień dobry.';
  near(turn.d, measured.get(firstAnnaText) * 1.5 + 1, 0.001);
  // speech marks are in script order
  const spokenIds = out.marks.filter((m) => m.kind === 'speech').map((m) => m.itemId);
  const expected = prog.segments.filter((x) => x.kind === 'speech').map((x) => x.itemId);
  eq(spokenIds, expected);
  eq(segmentAt(prog, prog.segments[3].t + 0.001), 3);
  // PCM chunk reader returns everything
  let n = 0;
  for await (const c of wavPcmChunks(out.blob, 5000)) n += c.length;
  eq(n, out.samples);
});

test('render: resamples to export rate; reuses same speech for two variants', async () => {
  const s = makeScript();
  let calls = 0;
  const cache = new Map();
  const getSpeech = async (seg) => {
    const k = seg.voiceKey + seg.text;
    if (!cache.has(k)) { calls++; cache.set(k, fakeSpeech(seg.text)); }
    return cache.get(k);
  };
  const durationOf = (item, text) => ({ seconds: fakeSpeech(text).seconds, approx: false });
  const full = await renderProgramToWav(buildProgram(s, { mode: 'full', durationOf }), { sampleRate: 44100, getSpeech });
  const callsAfterFull = calls;
  const train = await renderProgramToWav(buildProgram(s, { mode: 'rehearsal', durationOf }), { sampleRate: 44100, getSpeech });
  eq(calls, callsAfterFull, 'training variant reuses cached partner lines');
  ok(train.duration > full.duration, 'training version longer (silence factor)');
  eq(parseWav(await full.blob.arrayBuffer()).sampleRate, 44100);
});

test('zip: create → read back (own reader + Python zipfile)', async () => {
  const a = new Uint8Array(1000).map((_, i) => i % 251);
  const zip = await createZip([{ name: 'Scenariusz_Pełne_Słuchowisko.wav', data: a }, { name: 'info.txt', data: 'zażółć gęślą jaźń' }]);
  const ab = await zip.arrayBuffer();
  const entries = await readZip(ab);
  eq([...entries.keys()], ['Scenariusz_Pełne_Słuchowisko.wav', 'info.txt']);
  eq(Array.from(await entries.get('Scenariusz_Pełne_Słuchowisko.wav')()), Array.from(a));
  eq(new TextDecoder().decode(await entries.get('info.txt')()), 'zażółć gęślą jaźń');
  const tmp = new URL('./.tmp-test.zip', import.meta.url);
  fs.writeFileSync(tmp, Buffer.from(ab));
  try {
    const outp = execFileSync('python', ['-I', '-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip()); print(len(z.read("info.txt")))', tmp.pathname.replace(/^\/([A-Z]:)/, '$1')]).toString().trim().split(/\r?\n/);
    eq(outp[0], 'None', 'python zip CRC check');
    eq(outp[1], String(Buffer.byteLength('zażółć gęślą jaźń')));
  } finally { fs.unlinkSync(tmp); }
  eq(crc32Update(0, new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('docx: XML extraction and deflated archive via injected inflater', async () => {
  const xml = '<w:document><w:body><w:p><w:r><w:t>MATKA: Dzień dobry &amp; witam.</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">DYREKTOR: </w:t></w:r><w:r><w:t>Witam.</w:t></w:r><w:del><w:r><w:delText>usunięte</w:delText></w:r></w:del></w:p></w:body></w:document>';
  eq(docxXmlToText(xml), 'MATKA: Dzień dobry & witam.\nDYREKTOR: Witam.');
  // build a real deflated zip with python, read it with our reader + zlib inflater
  const tmp = new URL('./.tmp-test.docx', import.meta.url);
  const p = tmp.pathname.replace(/^\/([A-Z]:)/, '$1');
  execFileSync('python', ['-I', '-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED); z.writestr("word/document.xml", sys.argv[2]); z.close()', p, xml]);
  try {
    const buf = fs.readFileSync(tmp);
    const text = await docxToText(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), { inflater: (u8) => new Uint8Array(zlib.inflateRawSync(u8)) });
    ok(text.startsWith('MATKA: Dzień dobry & witam.'));
  } finally { fs.unlinkSync(tmp); }
});

test('txt decoding: UTF-8, BOM, Windows-1250 fallback', () => {
  eq(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x41])), 'A');
  // "żółw" in windows-1250: bf f3 b3 77
  eq(decodeText(new Uint8Array([0xbf, 0xf3, 0xb3, 0x77])), 'żółw');
});

test('ogg: CRC and page structure', () => {
  eq(oggCrc(new Uint8Array([0x4f, 0x67, 0x67, 0x53])) > 0, true);
  const mux = new OggOpusMuxer({ channels: 1, inputSampleRate: 24000, serial: 1 });
  for (let i = 0; i < 105; i++) mux.addPacket(new Uint8Array(60).fill(i), 960); // encoder output covers pre-skip + padding
  const pages = mux.pages.length;
  ok(pages >= 3);
  const blob = mux.finish(96000);
  ok(blob.size > 6000);
  // first page must carry OpusHead with BOS flag
  const first = mux.pages[0];
  eq(String.fromCharCode(...first.slice(0, 4)), 'OggS');
  eq(first[5], 2);
  eq(String.fromCharCode(...first.slice(28, 36)), 'OpusHead');
  // last page EOS + trimmed granule = preSkip + samples
  const last = mux.pages[mux.pages.length - 1];
  eq(last[5], 4);
  const g = new DataView(last.buffer).getUint32(6, true);
  eq(g, 312 + 96000);
  // CRC check on a page
  const copy = first.slice();
  const stored = new DataView(copy.buffer).getUint32(22, true);
  new DataView(copy.buffer).setUint32(22, 0, true);
  eq(oggCrc(copy), stored);
});

test('mp3: lamejs encodes PCM into valid MPEG frames', () => {
  const code = fs.readFileSync(new URL('../vendor/lamejs/lame.min.js', import.meta.url), 'utf8');
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const lame = ctx.lamejs;
  ok(lame && lame.Mp3Encoder, 'lamejs global');
  const enc = new lame.Mp3Encoder(1, 24000, 64);
  const pcm = new Int16Array(24000).map((_, i) => Math.round(Math.sin(i / 4) * 8000));
  const a = enc.encodeBuffer(pcm);
  const b = enc.flush();
  const mp3 = new Uint8Array(a.length + b.length);
  mp3.set(a, 0);
  mp3.set(b, a.length);
  ok(mp3.length > 1000);
  eq(mp3[0], 0xff, 'MPEG frame sync');
  eq(mp3[1] & 0xe0, 0xe0);
});

test('server mock engine produces measurable test signal', () => {
  const wav = mockSynthesize('Panie dyrektorze, musimy porozmawiać.', 'TEST-pl-PL-Signal-A', 1, 24000);
  const p = parseWav(wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength));
  ok(p.duration > 1 && p.duration < 5);
  ok(peak(p.samples) > 0.1);
});
