// ActoMind – per-character voice settings (Web Speech + Google Cloud TTS), shared by Roles and Audio Studio.
import { h, btn, field, rangeEl, selectEl, toast } from './dom.js';
import { icon } from './icons.js';
import { t } from '../core/i18n.js';
import { saveScriptSoon, charById } from '../core/store.js';
import { getVoices, isGoogleVoice, support } from '../core/speech.js';
import { voiceOf } from '../audio/program.js';
import { speakItem, stopAllSpeech } from '../audio/voice-engine.js';
import { spokenText } from '../core/tokenize.js';
import { ensureCloudConsent } from './common.js';
import { CHARACTER_COLORS } from '../core/parser.js';

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

/**
 * Voice card.
 * @param {object} script
 * @param {string} key character id or '__dir'
 * @param {{webVoices:SpeechSynthesisVoice[], cloudVoices?:object[]|null, showCloud?:boolean, open?:boolean, title?:Node|string, extra?:Node}} o
 */
export function voiceCard(script, key, o) {
  const c = charById(script, key);
  const v = voiceOf(script, key);
  const lang2 = script.lang === 'en' ? 'en' : 'pl';
  const details = h('details', { class: 'voice-card', open: !!o.open, style: { borderLeftColor: c?.color || 'var(--gray)' } });
  const summary = h('summary', {},
    h('span', { class: 'dot', style: { background: c?.color || 'var(--gray)' } }),
    h('strong', { style: { flex: 1 } }, o.title || c?.name || t('studio.directionsVoice')),
    h('span', { class: 'small muted' }, describe()),
    icon('down'));
  details.appendChild(summary);
  if (o.extra) details.appendChild(o.extra);
  const body = h('div', { style: { marginTop: '12px' } });
  details.appendChild(body);

  function describe() {
    const vv = voiceOf(script, key);
    if (o.showCloud && script.studio.engine === 'cloud' && vv.cloud.name) return vv.cloud.name;
    const wv = o.webVoices.find((x) => x.voiceURI === vv.web.voiceURI);
    return wv ? wv.name : t('voices.default');
  }
  const refreshSummary = () => { summary.children[2].textContent = describe(); };

  // ---------- colour
  if (c) {
    const sw = h('div', { class: 'row' }, CHARACTER_COLORS.slice(0, 12).map((col) => h('button', {
      type: 'button', class: 'color-dot-btn', style: { background: col, outline: c.color === col ? '2px solid var(--text)' : 'none' }, 'aria-label': col,
      onclick: () => { c.color = col; saveScriptSoon(script); details.style.borderLeftColor = col; summary.firstChild.style.background = col; o.onColor?.(col); [...sw.children].forEach((b) => { b.style.outline = b.getAttribute('aria-label') === col ? '2px solid var(--text)' : 'none'; }); },
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
    if (!all.length) { webBox.appendChild(h('p', { class: 'muted small' }, t('voices.noneFound'))); }
    const langs = [...new Set(all.map((x) => x.lang.slice(0, 2)))].sort();
    const filtered = all.filter((x) => !langFilter || x.lang.toLowerCase().startsWith(langFilter));
    const cur = voiceOf(script, key).web;
    const opts = [{ value: '', label: t('voices.default') }, ...filtered.map((x) => ({ value: x.voiceURI, label: `${x.name} (${x.lang})${isGoogleVoice(x) ? ' ★ Google' : ''}${x.localService ? '' : ' · ' + t('voices.online')}` }))];
    webBox.append(
      h('div', { class: 'grid grid-2 stack-sm' },
        field(t('voices.language'), selectEl([{ value: '', label: t('voices.allLanguages') }, ...langs.map((l) => ({ value: l, label: l.toUpperCase() }))], langFilter, (val) => { langFilter = val; renderWeb(); })),
        field(t('voices.voice'), selectEl(opts, cur.voiceURI, (val) => {
          const vo = all.find((x) => x.voiceURI === val);
          setVoice(script, key, ['web', 'voiceURI'], val);
          if (vo) setVoice(script, key, ['web', 'lang'], vo.lang);
          refreshSummary();
        }), filtered.some(isGoogleVoice) ? h('span', {}, h('span', { class: 'badge-google' }, 'Google'), ' ', t('voices.googleHint')) : null)),
      field(t('voices.rate'), rangeEl({ min: 0.5, max: 2, step: 0.05, value: cur.rate, format: (x) => x.toFixed(2) + '×', onChange: (x) => setVoice(script, key, ['web', 'rate'], x) })),
      field(t('voices.pitch'), rangeEl({ min: 0, max: 2, step: 0.05, value: cur.pitch, format: (x) => x.toFixed(2), onChange: (x) => setVoice(script, key, ['web', 'pitch'], x) })),
      field(t('voices.volume'), rangeEl({ min: 0, max: 1, step: 0.05, value: cur.volume, format: (x) => Math.round(x * 100) + '%', onChange: (x) => setVoice(script, key, ['web', 'volume'], x) })),
    );
  };

  // ---------- Google Cloud
  const cloudBox = h('div');
  let gender = '';
  const renderCloud = () => {
    cloudBox.replaceChildren();
    if (!o.showCloud) return;
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
          refreshSummary();
          renderCloud();
        }), sel ? `${t('voices.model')}: ${sel.model} · ~$${sel.priceHintPerMillion}/1M ${t('voices.chars')}` : null)),
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
    if (script.studio.engine === 'cloud' && o.showCloud && voiceOf(script, key).cloud.name && !(await ensureCloudConsent())) return;
    playing = true;
    sampleBtn.classList.add('active');
    try {
      await speakItem(script, key, sampleTextFor(script, key), null, { engine: o.showCloud ? script.studio.engine : 'web' });
    } catch (e) {
      if (e.name !== 'AbortError') toast(t('voices.sampleError', { msg: e.code || e.message }), { type: 'error' });
    } finally { playing = false; sampleBtn.classList.remove('active'); }
  }, { cls: 'btn-sm', icon: 'play' });

  body.append(
    o.showCloud ? h('div', { class: 'section-title' }, t('voices.webEngine')) : null,
    webBox,
    o.showCloud ? h('div', { class: 'section-title' }, 'Google Cloud TTS') : null,
    cloudBox,
    h('div', { class: 'section-title' }, t('voices.pauses')),
    pauses,
    h('div', { class: 'row' }, sampleBtn),
  );
  renderWeb();
  renderCloud();
  details.update = (opts) => { Object.assign(o, opts); renderWeb(); renderCloud(); refreshSummary(); };
  return details;
}

export async function loadWebVoices() {
  return getVoices();
}
