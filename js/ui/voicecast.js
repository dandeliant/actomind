// ActoMind – per-character voice settings for three engines:
// Web Speech (browser), Piper (local neural, free, exportable) and Google Cloud TTS (backend).
// Shared by Roles and Audio Studio.
import { h, btn, field, rangeEl, selectEl, toast, switchEl } from './dom.js';
import { icon } from './icons.js';
import { t } from '../core/i18n.js';
import { saveScriptSoon, charById } from '../core/store.js';
import { getVoices, isGoogleVoice, support } from '../core/speech.js';
import { voiceOf, DIR_VOICE } from '../audio/program.js';
import { speakItem, stopAllSpeech } from '../audio/voice-engine.js';
import { spokenText } from '../core/tokenize.js';
import { ensureCloudConsent } from './common.js';
import { CHARACTER_COLORS } from '../core/parser.js';
import { downloadVoice, deleteVoice, PIPER_GENDER } from '../audio/piper.js';
import { autoCast, guessVoiceGender, VARIANTS, variantOf } from '../core/autocast.js';
import { formatBytes } from '../core/util.js';

export function sampleTextFor(script, key) {
  const line = script.items.find((i) => i.type === 'line' && i.charId === key && spokenText(i.text).length > 12);
  if (line) return spokenText(line.text).slice(0, 220);
  return script.lang === 'en' ? 'Hello. This is how I will sound in your rehearsal.' : 'Dzień dobry. Tak będę brzmieć podczas Twojej próby.';
}

function setVoice(script, key, path, value) {
  const v = voiceOf(script, key);
  const cur = script.voices[key] || {};
  if (path.length === 1) cur[path[0]] = value;
  else cur[path[0]] = { ...(cur[path[0]] || v[path[0]]), [path[1]]: value };
  script.voices[key] = { ...v, ...cur };
  saveScriptSoon(script);
}

const GENDER_SIGN = { FEMALE: '♀', MALE: '♂' };
const langFamily = (script) => (script.lang === 'en' ? 'en' : 'pl');

/** Downloads in progress (shared between cards). */
const downloads = new Map();

/**
 * Voice card.
 * @param {object} script
 * @param {string} key character id or '__dir'
 * @param {{engine?:'web'|'cloud'|'piper', webVoices:SpeechSynthesisVoice[], cloudVoices?:object[]|null,
 *          piper?:{catalog:object[], downloaded:Set<string>, refresh:()=>void}|null, open?:boolean, title?:Node|string, extra?:Node, onColor?:Function}} o
 */
export function voiceCard(script, key, o) {
  const engine = o.engine || (o.showCloud ? 'cloud' : 'web');
  const c = charById(script, key);
  const v = voiceOf(script, key);
  const lang2 = langFamily(script);
  const details = h('details', { class: 'voice-card', open: !!o.open, style: { borderLeftColor: c?.color || 'var(--gray)' } });
  const descEl = h('span', { class: 'small muted', style: { textAlign: 'right' } });
  const summary = h('summary', {},
    h('span', { class: 'dot', style: { background: c?.color || 'var(--gray)' } }),
    h('strong', { style: { flex: 1 } }, o.title || c?.name || t('studio.directionsVoice')),
    descEl,
    icon('down'));
  details.appendChild(summary);
  if (o.extra) details.appendChild(o.extra);
  const body = h('div', { style: { marginTop: '12px' } });
  details.appendChild(body);

  function describe() {
    const vv = voiceOf(script, key);
    if (engine === 'cloud' && vv.cloud.name) return vv.cloud.name;
    if (engine === 'piper' && vv.piper.voice) return 'Piper · ' + vv.piper.voice.split('-')[1] + (vv.piper.speaker ? ' #' + vv.piper.speaker : '');
    const wv = o.webVoices.find((x) => x.voiceURI === vv.web.voiceURI);
    return wv ? wv.name : t('voices.default');
  }
  const refreshSummary = () => { descEl.textContent = describe(); };
  refreshSummary();

  // ---------- colour
  if (c) {
    const sw = h('div', { class: 'row' }, CHARACTER_COLORS.slice(0, 12).map((col) => h('button', {
      type: 'button', class: 'color-dot-btn', style: { background: col, outline: c.color === col ? '2px solid var(--text)' : 'none' }, 'aria-label': col,
      onclick: () => {
        c.color = col; saveScriptSoon(script);
        details.style.borderLeftColor = col; summary.firstChild.style.background = col; o.onColor?.(col);
        [...sw.children].forEach((b) => { b.style.outline = b.getAttribute('aria-label') === col ? '2px solid var(--text)' : 'none'; });
      },
    })));
    body.appendChild(field(t('voices.color'), sw));
  }

  // ---------- Web Speech
  const webBox = h('div');
  let langFilter = lang2;
  const renderWeb = () => {
    webBox.replaceChildren();
    if (!support.tts) { webBox.appendChild(h('p', { class: 'muted small' }, t('support.noTts'))); return; }
    const all = o.webVoices;
    if (!all.length) webBox.appendChild(h('p', { class: 'muted small' }, t('voices.noneFound')));
    const langs = [...new Set(all.map((x) => x.lang.slice(0, 2)))].sort();
    const filtered = all.filter((x) => !langFilter || x.lang.toLowerCase().startsWith(langFilter));
    const cur = voiceOf(script, key).web;
    const opts = [{ value: '', label: t('voices.default') }, ...filtered.map((x) => {
      const g = guessVoiceGender(x.name);
      return { value: x.voiceURI, label: `${x.name} (${x.lang})${g ? ' ' + GENDER_SIGN[g] : ''}${isGoogleVoice(x) ? ' ★ Google' : ''}${/natural|online/i.test(x.name) ? ' ★' : ''}${x.localService ? '' : ' · ' + t('voices.online')}` };
    })];
    webBox.append(
      h('div', { class: 'grid grid-2 stack-sm' },
        field(t('voices.language'), selectEl([{ value: '', label: t('voices.allLanguages') }, ...langs.map((l) => ({ value: l, label: l.toUpperCase() }))], langFilter, (val) => { langFilter = val; renderWeb(); })),
        field(t('voices.voice'), selectEl(opts, cur.voiceURI, (val) => {
          const vo = all.find((x) => x.voiceURI === val);
          setVoice(script, key, ['web', 'voiceURI'], val);
          if (vo) setVoice(script, key, ['web', 'lang'], vo.lang);
          refreshSummary();
        }), t('voices.countFor', { n: filtered.length, lang: (langFilter || '*').toUpperCase() }))),
      field(t('voices.rate'), rangeEl({ min: 0.5, max: 2, step: 0.05, value: cur.rate, format: (x) => x.toFixed(2) + '×', onChange: (x) => setVoice(script, key, ['web', 'rate'], x) })),
      field(t('voices.pitch'), rangeEl({ min: 0, max: 2, step: 0.05, value: cur.pitch, format: (x) => x.toFixed(2), onChange: (x) => setVoice(script, key, ['web', 'pitch'], x) })),
      field(t('voices.volume'), rangeEl({ min: 0, max: 1, step: 0.05, value: cur.volume, format: (x) => Math.round(x * 100) + '%', onChange: (x) => setVoice(script, key, ['web', 'volume'], x) })),
      filtered.length < 4 ? moreVoicesTips() : null,
    );
  };

  // ---------- Piper (local neural voices)
  const piperBox = h('div');
  let piperAll = false;
  const renderPiper = () => {
    piperBox.replaceChildren();
    if (engine !== 'piper') return;
    const P = o.piper;
    if (!P) { piperBox.appendChild(h('p', { class: 'muted small' }, t('piper.loading'))); return; }
    const cur = voiceOf(script, key).piper;
    const list = P.catalog.filter((x) => piperAll || x.family === lang2);
    const opt = (x) => ({ value: x.key, label: `${x.name} (${x.langCode}) ${GENDER_SIGN[x.gender] || ''} · ${t('piper.quality.' + x.quality)}${x.speakers > 1 ? ' · ' + t('piper.speakersN', { n: x.speakers }) : ''} · ${P.downloaded.has(x.key) ? '✓ ' + t('piper.downloaded') : formatBytes(x.sizeBytes)}` });
    const sel = P.catalog.find((x) => x.key === cur.voice);
    const dl = downloads.get(cur.voice);
    piperBox.append(
      h('div', { class: 'grid grid-2 stack-sm' },
        field(t('piper.voice'), selectEl([{ value: '', label: t('voices.noneSelected') }, ...list.map(opt)], cur.voice, (val) => {
          setVoice(script, key, ['piper', 'voice'], val);
          setVoice(script, key, ['piper', 'speaker'], 0);
          refreshSummary(); renderPiper();
        }), t('piper.countFor', { n: list.length })),
        h('div', { style: { alignSelf: 'end' } }, switchEl(t('piper.allLanguages'), piperAll, (val) => { piperAll = val; renderPiper(); }))),
      sel && !P.downloaded.has(sel.key)
        ? h('div', { class: 'banner info' }, icon('download'), h('div', { style: { flex: 1 } },
          h('div', {}, t('piper.needDownload', { size: formatBytes(sel.sizeBytes) })),
          dl ? h('div', { class: 'bar', style: { marginTop: '6px' } }, h('span', { style: { width: Math.round(dl.p * 100) + '%', background: 'var(--gold)' } })) : null,
          h('div', { class: 'row', style: { marginTop: '6px' } }, dl ? h('span', { class: 'small' }, Math.round(dl.p * 100) + '%') : btn(t('piper.download'), () => startDownload(sel), { cls: 'btn-sm btn-primary', icon: 'download' }))))
        : null,
      sel && sel.speakers > 1 ? field(t('piper.speaker'), selectEl(Array.from({ length: sel.speakers }, (_, i) => ({ value: String(i), label: (sel.speakerNames[i] ? sel.speakerNames[i] + ' · ' : '') + t('piper.speakerN', { n: i + 1 }) })), String(cur.speaker || 0), (val) => { setVoice(script, key, ['piper', 'speaker'], Number(val)); refreshSummary(); }), t('piper.speakerHint')) : null,
      field(t('voices.rate'), rangeEl({ min: 0.6, max: 1.6, step: 0.05, value: cur.rate || 1, format: (x) => x.toFixed(2) + '×', onChange: (x) => setVoice(script, key, ['piper', 'rate'], x) })),
      field(t('piper.expressive'), rangeEl({ min: 0.2, max: 1.1, step: 0.05, value: cur.expressive ?? 0.667, format: (x) => x.toFixed(2), onChange: (x) => setVoice(script, key, ['piper', 'expressive'], x) }), t('piper.expressiveHint')),
      field(t('voices.gainDb'), rangeEl({ min: -10, max: 6, step: 1, value: cur.gain || 0, format: (x) => (x > 0 ? '+' : '') + x + ' dB', onChange: (x) => setVoice(script, key, ['piper', 'gain'], x) })),
      sel && P.downloaded.has(sel.key) ? h('div', { class: 'row' }, btn(t('piper.delete'), async () => { await deleteVoice(sel); P.downloaded.delete(sel.key); P.refresh?.(); renderPiper(); }, { cls: 'btn-sm btn-ghost', icon: 'trash' }), h('span', { class: 'hint' }, t('piper.license'))) : null,
    );
  };
  async function startDownload(sel) {
    if (!navigator.onLine) { toast(t('piper.offline'), { type: 'error' }); return; }
    downloads.set(sel.key, { p: 0 });
    renderPiper();
    let last = 0;
    try {
      await downloadVoice(sel, (p) => {
        downloads.get(sel.key).p = p;
        if (p - last > 0.02) { last = p; renderPiper(); }
      });
      o.piper.downloaded.add(sel.key);
      toast(t('piper.ready', { name: sel.name }), { type: 'success' });
      o.piper.refresh?.();
    } catch (e) {
      toast(t('piper.downloadError', { msg: e.message }), { type: 'error' });
    } finally {
      downloads.delete(sel.key);
      renderPiper();
    }
  }

  // ---------- Google Cloud
  const cloudBox = h('div');
  let gender = '';
  const renderCloud = () => {
    cloudBox.replaceChildren();
    if (engine !== 'cloud') return;
    const voices = o.cloudVoices;
    if (!voices) { cloudBox.appendChild(h('p', { class: 'muted small' }, t('voices.cloudUnavailable'))); return; }
    const cur = voiceOf(script, key).cloud;
    const list = voices.filter((x) => !gender || x.ssmlGender === gender);
    const byModel = new Map();
    list.forEach((x) => { if (!byModel.has(x.model)) byModel.set(x.model, []); byModel.get(x.model).push(x); });
    const opts = [{ value: '', label: t('voices.noneSelected') }, ...[...byModel.entries()].map(([model, vs]) => ({ group: model, options: vs.map((x) => ({ value: x.name, label: `${x.name} · ${t('voices.gender.' + (x.ssmlGender || 'NEUTRAL'))}` })) }))];
    const sel = voices.find((x) => x.name === cur.name);
    const caps = sel?.capabilities || { pitch: true, speakingRate: true };
    cloudBox.append(
      h('div', { class: 'grid grid-2 stack-sm' },
        field(t('voices.genderFilter'), selectEl([{ value: '', label: t('voices.any') }, { value: 'FEMALE', label: t('voices.gender.FEMALE') }, { value: 'MALE', label: t('voices.gender.MALE') }], gender, (val) => { gender = val; renderCloud(); })),
        field(t('voices.cloudVoice'), selectEl(opts, cur.name, (val) => {
          const vo = voices.find((x) => x.name === val);
          setVoice(script, key, ['cloud', 'name'], val);
          if (vo) setVoice(script, key, ['cloud', 'languageCode'], vo.languageCodes[0]);
          refreshSummary(); renderCloud();
        }), sel ? `${t('voices.model')}: ${sel.model} · ~$${sel.priceHintPerMillion}/1M ${t('voices.chars')}` : t('voices.countFor', { n: voices.length, lang: lang2.toUpperCase() }))),
      field(t('voices.rate'), rangeEl({ min: 0.5, max: 2, step: 0.05, value: cur.speakingRate, format: (x) => x.toFixed(2) + '×', onChange: (x) => setVoice(script, key, ['cloud', 'speakingRate'], x) }), caps.speakingRate ? null : t('voices.notSupported')),
      field(t('voices.pitchSemitones'), rangeEl({ min: -10, max: 10, step: 0.5, value: cur.pitch, format: (x) => (x > 0 ? '+' : '') + x, onChange: (x) => setVoice(script, key, ['cloud', 'pitch'], x) }), caps.pitch ? null : t('voices.notSupported')),
      field(t('voices.gainDb'), rangeEl({ min: -10, max: 10, step: 1, value: cur.volumeGainDb, format: (x) => (x > 0 ? '+' : '') + x + ' dB', onChange: (x) => setVoice(script, key, ['cloud', 'volumeGainDb'], x) })),
    );
  };

  const pauses = h('div', { class: 'grid grid-2 stack-sm' },
    field(t('voices.pauseBefore'), rangeEl({ min: 0, max: 5, step: 0.1, value: v.pauseBefore, format: (x) => x.toFixed(1) + ' s', onChange: (x) => setVoice(script, key, ['pauseBefore'], x) })),
    field(t('voices.pauseAfter'), rangeEl({ min: 0, max: 5, step: 0.1, value: v.pauseAfter, format: (x) => x.toFixed(1) + ' s', onChange: (x) => setVoice(script, key, ['pauseAfter'], x) })));

  let playing = false;
  const sampleBtn = btn(t('voices.sample'), async () => {
    if (playing) { stopAllSpeech(); return; }
    if (engine === 'cloud' && voiceOf(script, key).cloud.name && !(await ensureCloudConsent())) return;
    const pv = voiceOf(script, key).piper.voice;
    if (engine === 'piper' && pv && o.piper && !o.piper.downloaded.has(pv)) { toast(t('piper.downloadFirst')); return; }
    playing = true;
    sampleBtn.classList.add('active');
    try {
      await speakItem(script, key, sampleTextFor(script, key), null, { engine });
    } catch (e) {
      if (e.name !== 'AbortError') toast(t('voices.sampleError', { msg: e.code || e.message }), { type: 'error' });
    } finally { playing = false; sampleBtn.classList.remove('active'); }
  }, { cls: 'btn-sm', icon: 'play' });

  body.append(
    engine === 'piper' ? h('div', { class: 'section-title' }, t('piper.title')) : null,
    piperBox,
    engine === 'cloud' ? h('div', { class: 'section-title' }, 'Google Cloud TTS') : null,
    cloudBox,
    engine !== 'web' ? h('details', { class: 'more' }, h('summary', {}, t('voices.webFallback')), webBox) : webBox,
    h('div', { class: 'section-title' }, t('voices.pauses')),
    pauses,
    h('div', { class: 'row' }, sampleBtn),
  );
  renderWeb();
  renderPiper();
  renderCloud();
  details.update = (opts) => { Object.assign(o, opts); renderWeb(); renderPiper(); renderCloud(); refreshSummary(); };
  return details;
}

/** How to get more (and better) free voices on this device. */
export function moreVoicesTips() {
  return h('details', { class: 'more' }, h('summary', {}, icon('sparkles'), ' ', t('voices.moreTitle')),
    h('ul', { class: 'small text-2', style: { margin: '4px 0 8px', paddingLeft: '18px' } },
      ['piper', 'edge', 'windows', 'android', 'apple', 'chrome'].map((k) => h('li', { style: { marginBottom: '4px' } }, t('voices.more.' + k)))));
}

export async function loadWebVoices() {
  return getVoices();
}

/**
 * Automatic casting for the active engine. Returns number of characters changed.
 */
export function applyAutoCast(script, engine, { webVoices = [], cloudVoices = null, piper = null } = {}) {
  const counts = new Map();
  script.items.forEach((i) => { if (i.type === 'line') counts.set(i.charId, (counts.get(i.charId) || 0) + 1); });
  const chars = script.characters.map((c) => ({ id: c.id, name: c.name, lines: counts.get(c.id) || 0 }));
  const lang2 = langFamily(script);
  let pool = [];
  if (engine === 'cloud' && cloudVoices) {
    // prefer natural-sounding models
    const rank = (m) => ['Chirp3-HD', 'Chirp-HD', 'Neural2', 'WaveNet', 'Studio', 'Standard'].indexOf(m);
    pool = cloudVoices.filter((x) => x.languageCodes.some((l) => l.startsWith(lang2)))
      .sort((a, b) => (rank(a.model) < 0 ? 99 : rank(a.model)) - (rank(b.model) < 0 ? 99 : rank(b.model)))
      .slice(0, 24).map((x) => ({ id: x.name, gender: x.ssmlGender === 'NEUTRAL' ? null : x.ssmlGender }));
  } else if (engine === 'piper' && piper) {
    // good-quality voices of the script language; already downloaded ones first (no extra download)
    const usable = piper.catalog.filter((x) => x.family === lang2 && (x.quality === 'medium' || piper.downloaded.has(x.key)));
    usable.sort((a, b) => (piper.downloaded.has(b.key) ? 1 : 0) - (piper.downloaded.has(a.key) ? 1 : 0));
    pool = usable.map((x) => ({ id: x.key, gender: x.gender }));
  } else {
    pool = webVoices.filter((x) => x.lang.toLowerCase().startsWith(lang2)).map((x) => ({ id: x.voiceURI, gender: guessVoiceGender(x.name) }));
  }
  if (!pool.length) return 0;
  const cast = autoCast(chars, pool, lang2);
  for (const [charId, a] of Object.entries(cast)) {
    const v = voiceOf(script, charId);
    if (engine === 'cloud') {
      const vo = cloudVoices.find((x) => x.name === a.voice);
      v.cloud = { ...v.cloud, name: a.voice, languageCode: vo?.languageCodes[0] || v.cloud.languageCode, pitch: variantOf(VARIANTS.cloudPitch, a.variant) };
    } else if (engine === 'piper') {
      const meta = piper.catalog.find((x) => x.key === a.voice);
      const multi = meta && meta.speakers > 1;
      v.piper = { ...v.piper, voice: a.voice, speaker: multi ? (a.variant * 7) % meta.speakers : 0, rate: multi ? 1 : variantOf(VARIANTS.piperRate, a.variant) };
    } else {
      const vo = webVoices.find((x) => x.voiceURI === a.voice);
      v.web = { ...v.web, voiceURI: a.voice, lang: vo?.lang || v.web.lang, pitch: variantOf(VARIANTS.webPitch, a.variant), rate: variantOf(VARIANTS.webRate, a.variant) };
    }
    script.voices[charId] = v;
  }
  // stage directions: a calm, different voice if possible
  if (!script.voices[DIR_VOICE]) script.voices[DIR_VOICE] = voiceOf(script, DIR_VOICE);
  saveScriptSoon(script);
  return Object.keys(cast).length;
}
