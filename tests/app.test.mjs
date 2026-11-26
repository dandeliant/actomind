import { test, eq, ok } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pl from '../js/i18n/pl.js';
import en from '../js/i18n/en.js';
import { STATIC_KEYS } from '../tools/i18n-keys.mjs';
import { ACHIEVEMENTS_IDS, collectFiles } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const get = (d, k) => k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), d);

const DYNAMIC = {
  'achievements.*.title': ACHIEVEMENTS_IDS, 'achievements.*.desc': ACHIEVEMENTS_IDS,
  'calib.presets.*': ['fast', 'natural', 'dramatic', 'slow', 'custom'],
  'editor.type.*': ['line', 'direction', 'scene', 'act'],
  'map.*': ['new', 'hard', 'partial', 'mastered'],
  'mentor.fields.*': ['goal', 'intention', 'emotion', 'subtext', 'keyword', 'gesture', 'movement', 'pause', 'intonation', 'relation'],
  'mentor.ph.*': ['goal', 'intention', 'emotion', 'subtext', 'keyword', 'gesture', 'movement', 'pause', 'intonation', 'relation'],
  'mentor.q.*': ['want', 'why', 'before', 'reaction', 'change'],
  'mentor.int.*': ['ironic', 'calm', 'firm', 'disbelief', 'irritated', 'tender', 'playful', 'desperate'],
  'mentor.tpl.*.name': ['objective', 'beats', 'subtext'], 'mentor.tpl.*.text': ['objective', 'beats', 'subtext'],
  'modes.*.title': ['understand', 'listen', 'vanishing', 'firstletters', 'chunks', 'review', 'cues', 'partner', 'dress', 'hardest', 'cards', 'exercises', 'mentor'],
  'modes.*.desc': ['understand', 'listen', 'vanishing', 'firstletters', 'chunks', 'review', 'cues', 'partner', 'dress', 'hardest', 'cards', 'exercises', 'mentor'],
  'partner.strict.*': ['free', 'training', 'professional'], 'partner.strictHint.*': ['free', 'training', 'professional'],
  'premiere.kind.*': ['main', 'morning', 'light', 'warmup'],
  'privacy.sttProvider.*': ['google', 'microsoft', 'apple', 'unknown'],
  'rate.*': ['again', 'hard', 'good', 'perfect', 'label'],
  'report.hintLevel.*': ['1', '2', '3'],
  'report.rec.*.title': ['weak', 'hinted', 'slow', 'missed', 'perfect', 'perfectDress', 'stricter'],
  'report.rec.*.text': ['weak', 'hinted', 'slow', 'missed', 'perfect', 'perfectDress', 'stricter'],
  'studio.beeps.*': ['none', 'single', 'double', 'bell', 'startEnd'],
  'studio.mode.*': ['full', 'rehearsal', 'hints', 'mine', 'repeat', 'dress'], 'studio.modeHint.*': ['full', 'rehearsal', 'hints', 'mine', 'repeat', 'dress'],
  'studio.q.*': ['economy', 'standard', 'high'],
  'studio.roleMode.*': ['read', 'silent', 'first1', 'first3', 'start'],
  'studio.source.*': ['profile', 'tts', 'estimate', 'manual'],
  'studio.tempo.*': ['fast', 'natural', 'calm', 'emotional', 'beginner', 'veryslow'],
  'studio.variant.*': ['full', 'rehearsal', 'hints', 'mine', 'repeat', 'dress'], 'studio.variantDesc.*': ['full', 'rehearsal', 'hints', 'mine'],
  'trainer.*.title': ['vanish', 'letters', 'cards', 'review', 'cues', 'hardest'], 'trainer.*.desc': ['vanish', 'letters', 'cards', 'review', 'cues', 'hardest'],
  'trainer.letters.mode.*': ['first', 'firstLast', 'syllable', 'two', 'blank'],
  'trainer.vanish.levelHint.*': ['0', '25', '50', '75', '90', '100'],
  'tutorial.*.title': ['welcome', 'import', 'role', 'learn', 'partner', 'studio', 'privacy'], 'tutorial.*.text': ['welcome', 'import', 'role', 'learn', 'partner', 'studio', 'privacy'],
  'voices.gender.*': ['FEMALE', 'MALE', 'NEUTRAL'],
  'studio.cast.*': ['web', 'piper', 'cloud'], 'studio.engineName.*': ['web', 'piper', 'cloud'],
  'studio.capture.*': ['s1', 's2', 's3', 's4', 'silent', 'stopped'],
  'voices.more.*': ['piper', 'edge', 'windows', 'android', 'apple', 'chrome'],
  'piper.quality.*': ['x_low', 'low', 'medium', 'high'],
  'stt.*': ['errNotAllowed', 'errNoMic', 'errNetwork', 'errNoSpeech', 'errStart', 'errGeneric'],
};

function allKeys() {
  const keys = new Set(STATIC_KEYS);
  for (const [pattern, vals] of Object.entries(DYNAMIC)) for (const v of vals) keys.add(pattern.replace('*', v));
  return [...keys];
}

test('i18n: every used key exists in Polish and English', () => {
  const missing = [];
  for (const k of allKeys()) {
    for (const [name, d] of [['pl', pl], ['en', en]]) {
      const v = get(d, k);
      if (v === undefined || (typeof v === 'object' && !Array.isArray(v))) missing.push(name + ':' + k);
    }
  }
  eq(missing, [], 'missing translation keys');
});

test('i18n: PL and EN dictionaries have identical structure', () => {
  const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? flat(v, p + k + '.') : [p + k]));
  const a = new Set(flat(pl));
  const b = new Set(flat(en));
  eq([...a].filter((k) => !b.has(k)), [], 'in PL only');
  eq([...b].filter((k) => !a.has(k)), [], 'in EN only');
  // placeholders must match
  const bad = [...a].filter((k) => {
    const ph = (s) => JSON.stringify([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
    return ph(get(pl, k)) !== ph(get(en, k)) && !Array.isArray(get(pl, k));
  });
  eq(bad, [], 'placeholder mismatch');
});

test('modules: every relative import resolves to an existing file', () => {
  const problems = [];
  for (const f of collectFiles(path.join(ROOT, 'js'), '.js')) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const spec = m[1] || m[2];
      const target = path.resolve(path.dirname(f), spec);
      if (!fs.existsSync(target)) problems.push(path.relative(ROOT, f) + ' → ' + spec);
    }
  }
  eq(problems, []);
});

test('modules: named imports exist in the imported module', async () => {
  const problems = [];
  for (const f of collectFiles(path.join(ROOT, 'js'), '.js')) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s+['"](\.[^'"]+)['"]/g)) {
      const target = path.resolve(path.dirname(f), m[2]);
      if (!fs.existsSync(target)) continue;
      const tsrc = fs.readFileSync(target, 'utf8');
      for (const raw of m[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0].trim();
        if (!name) continue;
        const re = new RegExp(`export\\s+(?:async\\s+)?(?:function\\*?|const|let|class|var)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`);
        if (!re.test(tsrc)) problems.push(`${path.relative(ROOT, f)}: ${name} ← ${m[2]}`);
      }
    }
  }
  eq(problems, []);
});

test('pwa: manifest, icons and service worker precache list are complete', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  ok(manifest.name.includes('ActoMind'));
  for (const ic of manifest.icons) ok(fs.existsSync(path.join(ROOT, ic.src)), 'icon ' + ic.src);
  const { FILES } = await import('../tools/gen-sw-manifest.mjs');
  const swm = fs.readFileSync(path.join(ROOT, 'sw-manifest.js'), 'utf8');
  for (const f of FILES) ok(swm.includes(`"${f}"`), 'precache missing ' + f + ' – run npm run build:sw');
  ok(FILES.includes('vendor/pdfjs/pdf.worker.min.mjs') && FILES.includes('vendor/lamejs/lame.min.js'), 'vendor libs cached for offline');
});
