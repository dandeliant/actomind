import { test, eq, ok, near } from './harness.mjs';
import { parseScript, scenesOf, cueFor, itemsToText } from '../js/core/parser.js';
import { pieces, spokenText, normTokens, firstSyllable, syllableCount, words } from '../js/core/tokenize.js';
import { compareText, overrideToken, coverage } from '../js/core/diff.js';
import { review, newRecord, mastery, status, qualityFromResult, qualityFromSelf, buildQueue } from '../js/core/srs.js';
import { autoBoundaries, fragments, cumulativeSteps, toggleBoundary } from '../js/core/chunker.js';
import { silenceSeconds, estimateSpeech, prefixText, profileFromSamples, analyse } from '../js/core/timing.js';
import { sessionPlan, premierePlan, SESSION_LENGTHS, splitDaily } from '../js/core/planner.js';
import { hintText } from '../js/core/hints.js';
import { DEMO_PL, DEMO_EN } from '../js/core/demo.js';
import { DAY } from '../js/core/util.js';

const SPEC_SAMPLE = `MATKA: Panie dyrektorze, musimy porozmawiać.
DYREKTOR: Oczywiście. Proszę usiąść.
MATKA:
Nie zamierzam siadać!
DYREKTOR (ze zdziwieniem):
A to dlaczego?`;

test('parser: spec example – characters, lines, parenthetical', () => {
  const s = parseScript(SPEC_SAMPLE);
  eq(s.characters.map((c) => c.name), ['MATKA', 'DYREKTOR']);
  const lines = s.items.filter((i) => i.type === 'line');
  eq(lines.length, 4);
  const name = (l) => s.characters.find((c) => c.id === l.charId).name;
  eq(lines.map(name), ['MATKA', 'DYREKTOR', 'MATKA', 'DYREKTOR']);
  eq(lines[0].text, 'Panie dyrektorze, musimy porozmawiać.');
  eq(lines[2].text, 'Nie zamierzam siadać!');
  eq(lines[3].parenthetical, 'ze zdziwieniem');
  eq(lines[3].text, 'A to dlaczego?');
});

test('parser: acts, scenes, standalone and inline directions, multiline speech', () => {
  const raw = `WYWIADÓWKA
Komedia w jednym akcie

OSOBY:
MATKA – pani Kowalska
DYREKTOR – dyrektor szkoły

AKT I

SCENA 1
Gabinet dyrektora. Na biurku stos papierów.

(Wchodzi Matka.)
MATKA: Dzień dobry. (rozgląda się) Czy to tu?
DYREKTOR: Tu, tu.
Proszę wejść.
(Matka siada.)

SCENA 2
MATKA. Ja w sprawie syna.
DYREKTOR. Rozumiem.`;
  const s = parseScript(raw);
  eq(s.title, 'WYWIADÓWKA');
  eq(s.characters.map((c) => c.name).sort(), ['DYREKTOR', 'MATKA']);
  const types = s.items.map((i) => i.type);
  ok(types.includes('act'), 'act detected');
  eq(types.filter((t) => t === 'scene').length, 2);
  const lines = s.items.filter((i) => i.type === 'line');
  eq(lines.length, 4);
  eq(lines[0].text, 'Dzień dobry. (rozgląda się) Czy to tu?');
  eq(spokenText(lines[0].text), 'Dzień dobry. Czy to tu?');
  eq(lines[1].text, 'Tu, tu.\nProszę wejść.');
  const dirs = s.items.filter((i) => i.type === 'direction').map((d) => d.text);
  ok(dirs.includes('(Wchodzi Matka.)'), 'standalone direction');
  ok(dirs.some((d) => d.startsWith('Gabinet dyrektora')), 'scene description as direction');
  // dot format in scene 2
  eq(lines[2].text, 'Ja w sprawie syna.');
  const sc = scenesOf(s.items);
  eq(sc.length, 2);
  const idx = s.items.indexOf(lines[1]);
  eq(cueFor(s.items, idx).item.id, lines[0].id);
});

test('parser: does not treat colon inside dialogue as a character', () => {
  const s = parseScript(`ANNA: Powiem ci jedno: nie.\nPIOTR: Uwaga: to ważne.\nANNA: Godzina 12:30.`);
  eq(s.characters.map((c) => c.name), ['ANNA', 'PIOTR']);
  const lines = s.items.filter((i) => i.type === 'line');
  eq(lines[0].text, 'Powiem ci jedno: nie.');
  eq(lines[1].text, 'Uwaga: to ważne.');
  eq(lines[2].text, 'Godzina 12:30.');
});

test('parser: screenplay format (NAME alone, parenthetical line)', () => {
  const s = parseScript(`JAN\n(cicho)\nGdzie jesteś?\n\nEWA\nTutaj.\n\nJAN\nNie widzę cię.`);
  eq(s.characters.map((c) => c.name), ['JAN', 'EWA']);
  const lines = s.items.filter((i) => i.type === 'line');
  eq(lines.length, 3);
  eq(lines[0].parenthetical, 'cicho');
  eq(lines[0].text, 'Gdzie jesteś?');
});

test('parser: mixed-case names need repetition; original text preserved', () => {
  const s = parseScript(`Anna: Cześć!\nPiotr: Hej.\nAnna: Co słychać?\nPiotr: Nic.`);
  eq(s.characters.map((c) => c.name), ['Anna', 'Piotr']);
  const back = itemsToText(s);
  ok(back.includes('ANNA: Cześć!'));
});

test('parser: demo scripts parse into many lines', () => {
  for (const d of [DEMO_PL, DEMO_EN]) {
    const s = parseScript(d.text);
    const names = s.characters.map((c) => c.name);
    ok(names.length >= 2, 'characters');
    ok(s.items.filter((i) => i.type === 'line').length >= 20, 'lines ' + d.title);
    ok(s.items.some((i) => i.type === 'scene'), 'scenes');
    ok(!names.some((n) => n.length > 25), 'no bogus names: ' + names.join(','));
  }
});

test('tokenize: pieces keep punctuation and directions', () => {
  const p = pieces('Nie mam (cicho) pojęcia, o czym pani mówi.');
  eq(p.filter((x) => x.type === 'word').map((x) => x.text), ['Nie', 'mam', 'pojęcia', 'o', 'czym', 'pani', 'mówi']);
  ok(p.some((x) => x.type === 'dir' && x.text === '(cicho)'));
  eq(words("Jean-Luc don't"), ["Jean-Luc", "don't"]);
});

test('hints: first letters exactly as in specification', () => {
  eq(hintText('Nie mam najmniejszego pojęcia, o czym pani mówi.', 'first'), 'N m n p, o c p m.');
  eq(hintText('Nie mam pojęcia.', 'firstLast'), 'Ne mm pa.');
  eq(hintText('Nie mam pojęcia.', 'two'), 'Ni ma po.');
  eq(hintText('Ala ma kota.', 'blank'), '___ __ ____.');
  eq(firstSyllable('najmniejszego'), 'naj');
  eq(firstSyllable('dyrektorze'), 'dy');
  eq(syllableCount('najmniejszego'), 4);
});

test('diff: perfect, missing, extra, case and punctuation insensitive', () => {
  const ref = 'Nie mam najmniejszego pojęcia, o czym pani mówi.';
  let r = compareText(ref, 'nie mam najmniejszego pojęcia o czym pani mówi');
  eq(r.percent, 100);
  ok(r.passed);
  r = compareText(ref, 'nie mam pojęcia o czym pani mówi');
  eq(r.counts.missed, 1);
  eq(r.tokens[2].status, 'missed');
  eq(r.problemSpans[0].text, 'najmniejszego');
  r = compareText(ref, 'nie mam najmniejszego pojęcia o czym pani teraz mówi');
  eq(r.counts.extra, 1);
  eq(r.extras, ['teraz']);
  r = compareText(ref, 'nie mam najmniejszego pojecia o czym pani mowi'); // no diacritics
  eq(r.counts.ok, 8);
});

test('diff: near matches – lenient in training, strict in professional', () => {
  const ref = 'Proszę natychmiast wyjść z gabinetu.';
  const heard = 'proszę natychmiastowo wyjść z gabinetu';
  const tr = compareText(ref, heard, { strictness: 'training' });
  eq(tr.tokens[1].status, 'near');
  ok(tr.passed);
  const pro = compareText(ref, heard, { strictness: 'professional' });
  eq(pro.tokens[1].status, 'wrong');
  ok(!pro.passed);
});

test('diff: hints are blue and not credited; manual override rescoring', () => {
  const r = compareText('Ala ma kota.', 'ala ma kota', { hinted: [0] });
  eq(r.tokens[0].status, 'hint');
  eq(r.counts.hints, 1);
  ok(r.score < 1);
  const r2 = compareText('Ala ma kota.', 'ala ma psa');
  eq(r2.tokens[2].status, 'wrong');
  const fixed = overrideToken(r2, 2, 'ok');
  eq(fixed.percent, 100);
});

test('diff: numbers match digit transcripts; coverage', () => {
  const r = compareText('Mam dwa koty.', 'mam 2 koty');
  eq(r.percent, 100);
  const c = coverage('Raz dwa trzy cztery pięć.', 'raz dwa trzy');
  eq(c.covered, 3);
  eq(normTokens('21 kotów'), ['dwadzieścia', 'jeden', 'kotów']);
});

test('srs: success grows interval, failure lapses, mastery needs repeated recall', () => {
  const now = Date.UTC(2026, 0, 1);
  let r = newRecord();
  eq(status(r, now), 'new');
  r = review(r, { q: 5, now });
  ok(r.interval >= 1 && r.reps === 1);
  ok(status(r, now) !== 'mastered', 'one recall is not mastery');
  r = review(r, { q: 5, now: now + DAY });
  ok(r.reps === 2 && r.interval >= 3);
  ok(['mastered', 'partial'].includes(status(r, now + DAY)));
  r = review(r, { q: 5, now: now + 4 * DAY });
  eq(status(r, now + 4 * DAY), 'mastered');
  ok(mastery(r, now + 4 * DAY) > 0.75);
  r = review(r, { q: 1, now: now + 10 * DAY });
  eq(r.reps, 0);
  eq(r.lapses, 1);
  eq(status(r, now + 10 * DAY), 'hard');
});

test('srs: recognition-only events never create mastery; quality factors', () => {
  let r = newRecord();
  for (let i = 0; i < 5; i++) r = review(r, { q: 5, weight: 0.3, now: i * 1000 });
  eq(status(r), 'new');
  ok(qualityFromResult({ score: 1 }) === 5);
  ok(qualityFromResult({ score: 1, hintLevel: 3 }) <= 1.5);
  ok(qualityFromResult({ score: 1, latencyMs: 9000 }) < 5);
  ok(qualityFromSelf('again') < 2 && qualityFromSelf('perfect') === 5);
  ok(qualityFromSelf('perfect', { revealed: 5, totalWords: 10 }) < 5);
});

test('srs: premiere caps intervals; queue prioritises due & difficult', () => {
  const now = Date.UTC(2026, 0, 1);
  let r = newRecord();
  r = review(r, { q: 5, now });
  r = review(r, { q: 5, now: now + DAY, premiereAt: now + 2 * DAY });
  ok(r.due <= now + DAY + DAY / 3 + 1, 'capped by premiere');
  const recs = { a: review(newRecord(), { q: 1, now }), b: review(newRecord(), { q: 5, now }) };
  const q = buildQueue(['a', 'b', 'c'], recs, { now: now + 60 * 60000 });
  eq(q.queue[0], 'a');
  ok(q.queue.includes('c'));
  ok(!q.queue.includes('b'));
});

test('chunker: boundaries, fragments, cumulative steps', () => {
  const mono = 'To nie jest zwykła wywiadówka, panie dyrektorze. Ja przyszłam tutaj w sprawie fundamentalnej, w sprawie przyszłości mojego syna, który od tygodnia nie śpi. Nie je. Nie gra nawet na konsoli, a to już jest sygnał alarmowy!';
  const b = autoBoundaries(mono);
  ok(b.length >= 3, 'several fragments');
  const fr = fragments(mono, b);
  eq(fr.map((f) => f.text).join(' ').replace(/\s+/g, ' '), mono.replace(/\s+/g, ' '));
  const steps = cumulativeSteps(3);
  eq(steps.map((s) => s.label), ['A', 'B', 'A + B', 'C', 'A + B + C']);
  ok(steps[steps.length - 1].full);
  eq(toggleBoundary([0, 5], 5, 20), [0]);
  eq(toggleBoundary([0], 7, 20), [0, 7]);
});

test('timing: silence formula matches specification examples', () => {
  eq(silenceSeconds(2), 4);
  eq(silenceSeconds(4), 7);
  eq(silenceSeconds(10), 16);
  eq(silenceSeconds(20), 31);
  eq(silenceSeconds(2, 2.2, 0), 4.4);
});

test('timing: estimates respect punctuation, rate and manual pauses', () => {
  const a = estimateSpeech('Tak, tak, tak.');
  const b = estimateSpeech('Tak tak tak');
  ok(a.seconds > b.seconds, 'commas add time');
  const slow = estimateSpeech('To jest dłuższe zdanie do sprawdzenia.', { rate: 0.5 });
  const fast = estimateSpeech('To jest dłuższe zdanie do sprawdzenia.', { rate: 2 });
  ok(slow.seconds > fast.seconds * 2.5);
  const p = estimateSpeech('Ja... (pauza) nie wiem.');
  ok(p.manualPauses === 1 && p.seconds > 2);
  const an = analyse('Co? Nie! Tak… dobrze.');
  eq(an.counts.question, 1);
  eq(an.counts.exclamation, 1);
  eq(an.counts.ellipsis, 1);
  eq(an.counts.period, 0, 'final period does not count');
});

test('timing: prefix hints and personal profile', () => {
  eq(prefixText('Nie zamierzam siadać!', 'first1').prefix, 'Nie…');
  eq(prefixText('Nie zamierzam siadać!', 'first3').prefix, 'Nie zamierzam siadać!');
  ok(prefixText('Nie zamierzam siadać!', 'first3').complete);
  eq(prefixText('Panie dyrektorze, musimy porozmawiać.', 'start').prefix, 'Panie dyrektorze…');
  const prof = profileFromSamples([{ text: 'To jest zdanie testowe.', seconds: 2 }, { text: 'Drugie, nieco dłuższe zdanie do pomiaru.', seconds: 3.4 }]);
  ok(prof.syllablesPerSecond > 2 && prof.syllablesPerSecond < 10);
  const e = estimateSpeech('To jest zdanie testowe.', { profile: prof });
  ok(Math.abs(e.seconds - 2) < 1);
});

test('planner: every session length sums exactly and adapts to mastery', () => {
  for (const len of SESSION_LENGTHS) {
    for (const m of [0, 0.5, 0.9]) {
      const p = sessionPlan(len, { mastery: m, hardCount: 3, hasLongLines: true });
      eq(p.reduce((s, b) => s + b.minutes, 0), len, `len ${len} m ${m}`);
      ok(p.every((b) => b.minutes > 0));
    }
  }
  const sixty = sessionPlan(60, { mastery: 0.5, hardCount: 2, hasLongLines: false });
  eq(sixty.map((b) => [b.mode, b.minutes]), [['understand', 5], ['listen', 10], ['firstletters', 15], ['cues', 10], ['partner', 15], ['hardest', 5]]);
  ok(sessionPlan(60, { mastery: 0.95, hardCount: 0 }).some((b) => b.mode === 'dress'));
  eq(splitDaily(120), [60, 60]);
  eq(splitDaily(90), [45, 45]);
});

test('planner: premiere tomorrow → evening session, sleep, morning review', () => {
  const now = new Date(2026, 10, 26, 17, 0).getTime();
  const premiere = new Date(2026, 10, 27, 19, 0).getTime();
  const plan = premierePlan({ now, premiereAt: premiere, minutesPerDay: 60, selfLevel: 'some', lineCount: 30 });
  eq(plan.days.length, 2);
  ok(plan.days[0].sessions.length >= 1, 'study today');
  ok(plan.days[0].sleep, 'sleep advice on the eve');
  ok(plan.days[1].sessions.some((s) => s.kind === 'morning'), 'morning review');
  ok(plan.days[1].sessions.some((s) => s.kind === 'warmup'), 'warm-up');
  ok(plan.warnings.includes('tomorrow'));
  ok(premierePlan({ now, premiereAt: now - 1000, minutesPerDay: 30 }).past);
});
