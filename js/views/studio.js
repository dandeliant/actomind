// ActoMind – Audio Studio: voice casting, own-role options, silence timing, timeline, live player, audio export.
import { h, btn, iconBtn, field, segmented, switchEl, rangeEl, selectEl, toast, banner, modal, promptDialog, downloadBlob, shareOrDownload, linkBtn } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { setHeader, navigate } from '../ui/shell.js';
import { t, tn, getLang } from '../core/i18n.js';
import { settings, saveScript, saveScriptSoon, getProgress, lineStatuses, setFlagged, tempoProfiles, SessionTracker, charById, myLines } from '../core/store.js';
import { requireScript, charName, charColor, sceneOptions, ensureCloudConsent } from '../ui/common.js';
import { voiceCard, loadWebVoices, applyAutoCast, moreVoicesTips } from '../ui/voicecast.js';
import { piperCatalog, downloadedKeys, downloadVoice } from '../audio/piper.js';
import { SpeechCapture, captureSupported } from '../audio/capture.js';
import { hasVoice } from '../audio/providers.js';
import { livePlayerUI } from '../ui/player.js';
import { openCalibration } from '../ui/calibrate.js';
import { buildProgram, ROLE_MODES, DIR_VOICE, voiceOf } from '../audio/program.js';
import { cloudStatus, listCloudVoices, costEstimate } from '../audio/cloud.js';
import { exportAudio, costPreview, cachedDurations, durationFn, VARIANTS, sizeEstimate } from '../audio/exporter.js';
import { opusSupported } from '../audio/encoders.js';
import { speakItem, stopAllSpeech } from '../audio/voice-engine.js';
import { TEMPO_PRESETS, silenceSeconds, estimateSpeech } from '../core/timing.js';
import { scenesOf, actsOf } from '../core/parser.js';
import { spokenText } from '../core/tokenize.js';
import { formatClock, formatBytes, debounce, safeFileName } from '../core/util.js';
import { onVoicesChanged } from '../core/speech.js';
import { filePlayer } from '../ui/fileplayer.js';

const QUALITY = {
  economy: { sampleRate: 16000, kbps: 48 },
  standard: { sampleRate: 24000, kbps: 96 },
  high: { sampleRate: 44100, kbps: 160 },
};

export default async function studioView(root, params, query) {
  setHeader(t('studio.title'));
  const script = await requireScript(root, { needRoles: false });
  if (!script) return;
  const S = script.studio;
  const tracker = new SessionTracker(script.id, 'studio');
  const progress = await getProgress(script.id);
  let tab = query.tab || 'cast';
  let webVoices = await loadWebVoices();
  let cloudVoices = null;
  let piper = null; // {catalog, downloaded:Set, refresh}
  let capture = null; // SpeechCapture while recording browser voices
  let status = await cloudStatus();
  let profiles = await tempoProfiles();
  let durMap = new Map();
  let playMode = script.myRoles.length ? 'rehearsal' : 'full';
  let range = { type: 'all' };
  let zoom = 10; // px per second
  let selectedItem = null;
  let exportState = { variants: new Set(['full', 'rehearsal']), format: 'mp3', quality: S.exportQuality || 'standard', zip: true, running: null, result: null };
  let opusOk = false;
  opusSupported().then((v) => { opusOk = v; });

  const profile = () => profiles.find((p) => p.id === S.profileId) || null;
  const save = () => saveScriptSoon(script);
  const durFn = () => durationFn(script, durMap);
  const program = (mode = playMode) => buildProgram(script, { mode, range, durationOf: durFn(), profile: profile() });

  const head = h('div');
  const body = h('div');
  root.append(head, body);

  async function loadCloud() {
    if (!status.configured) { cloudVoices = null; return; }
    try {
      const lang = script.lang === 'en' ? 'en' : 'pl-PL';
      cloudVoices = await listCloudVoices(lang);
    } catch (e) {
      cloudVoices = null;
      toast(t('studio.voicesError', { msg: e.message }), { type: 'error' });
    }
  }
  async function loadPiper() {
    const catalog = await piperCatalog();
    const downloaded = await downloadedKeys(catalog);
    piper = { catalog, downloaded, refresh: () => { if (tab === 'export') renderBody(); } };
  }
  const refreshDurations = debounce(async () => {
    durMap = await cachedDurations(script, [...new Set([playMode, ...VARIANTS])], range).catch(() => new Map());
    if (tab === 'player') renderBody(true);
    else onDurations?.();
  }, 300);
  let onDurations = null;

  function renderHead() {
    const engineSeg = segmented([
      { value: 'web', label: t('studio.engineWeb') },
      { value: 'piper', label: t('studio.enginePiper') },
      { value: 'cloud', label: 'Google Cloud TTS' },
    ], S.engine, async (v) => {
      if (v === 'cloud' && !(await ensureCloudConsent())) { engineSeg.setValue(S.engine); return; }
      S.engine = v;
      save();
      if (v === 'cloud' && !cloudVoices) await loadCloud();
      if (v === 'piper' && !piper) await loadPiper();
      renderHead();
      renderBody();
      refreshDurations();
    });
    let st;
    if (S.engine === 'web') st = banner('info', 'info', t('studio.webInfo'), captureSupported() ? h('div', { class: 'small', style: { marginTop: '4px' } }, t('studio.webCaptureInfo')) : null);
    else if (S.engine === 'piper') st = banner('ok', 'sparkles', t('studio.piperInfo'));
    else if (!status.reachable) st = banner('warn', 'offline', t('studio.backendUnreachable'), ' ', h('a', { href: '#/settings' }, t('nav.settings')));
    else if (!status.configured) st = banner('warn', 'alert', t('studio.backendNotConfigured'), ' ', h('a', { href: '#/settings' }, t('nav.settings')));
    else st = banner('ok', 'check', t('studio.cloudReady', { mode: status.mode }), status.mode === 'mock' ? h('div', { class: 'small' }, t('settings.mockMode')) : null);
    head.replaceChildren(
      h('div', { class: 'card hero' },
        h('div', { class: 'row between' }, h('h1', { style: { margin: 0 } }, t('studio.title')), linkBtn(t('rehearse.library'), '#/library', { cls: 'btn-sm', icon: 'wave' })),
        h('p', { class: 'text-2' }, t('studio.intro')),
        field(t('studio.engine'), engineSeg), st),
      segmented([
        { value: 'cast', label: t('studio.tabCast') }, { value: 'role', label: t('studio.tabRole') },
        { value: 'player', label: t('studio.tabPlayer') }, { value: 'export', label: t('studio.tabExport') },
      ], tab, (v) => { tab = v; renderBody(); }),
      h('div', { style: { height: '12px' } }));
  }

  // ------------------------------------------------------------------ range picker
  function rangePicker(onChange) {
    const wrap = h('div', { class: 'grid grid-2 stack-sm' });
    const scenes = scenesOf(script.items);
    const acts = actsOf(script.items);
    const lines = script.items.filter((i) => i.type === 'line');
    const lineOpts = lines.map((l, i) => ({ value: l.id, label: `${i + 1}. ${charName(script, l.charId)}: ${spokenText(l.text).slice(0, 40)}` }));
    const render = () => {
      wrap.replaceChildren(
        field(t('studio.range'), selectEl([
          { value: 'all', label: t('studio.rangeAll') },
          ...(scenes.length ? [{ value: 'scene', label: t('studio.rangeScene') }] : []),
          ...(acts.length ? [{ value: 'act', label: t('studio.rangeAct') }] : []),
          { value: 'lines', label: t('studio.rangeLines') },
          ...(script.myRoles.length ? [{ value: 'difficult', label: t('studio.rangeDifficult') }] : []),
        ], range.type, (v) => {
          if (v === 'all') range = { type: 'all' };
          if (v === 'scene') range = { type: 'scene', id: scenes[0].id };
          if (v === 'act') range = { type: 'act', id: acts[0].id };
          if (v === 'lines') range = { type: 'lines', from: lines[0]?.id, to: lines[Math.min(lines.length - 1, 9)]?.id };
          if (v === 'difficult') {
            const stt = lineStatuses(script, progress);
            range = { type: 'difficult', ids: Object.keys(stt).filter((id) => stt[id].status === 'hard' || stt[id].rec?.flagged) };
            if (!range.ids.length) toast(t('studio.noDifficult'));
          }
          render(); onChange();
        })),
        range.type === 'scene' ? field(t('common.scene'), selectEl(sceneOptions(script, { all: false }), range.id, (v) => { range = { type: 'scene', id: v }; onChange(); })) : null,
        range.type === 'act' ? field(t('studio.rangeAct'), selectEl(acts.map((a) => ({ value: a.id, label: a.title })), range.id, (v) => { range = { type: 'act', id: v }; onChange(); })) : null,
        range.type === 'lines' ? h('div', { class: 'grid grid-2' },
          field(t('studio.from'), selectEl(lineOpts, range.from, (v) => { range.from = v; onChange(); })),
          field(t('studio.to'), selectEl(lineOpts, range.to, (v) => { range.to = v; onChange(); }))) : null,
        range.type === 'difficult' ? h('p', { class: 'small muted' }, tn('studio.difficultN', range.ids.length)) : null);
    };
    render();
    return wrap;
  }
  const rangeLabel = () => {
    if (range.type === 'scene') return scenesOf(script.items).find((s) => s.id === range.id)?.title || '';
    if (range.type === 'act') return actsOf(script.items).find((a) => a.id === range.id)?.title || '';
    if (range.type === 'lines') return t('studio.rangeLines');
    if (range.type === 'difficult') return t('studio.rangeDifficult');
    return t('studio.rangeAll');
  };

  // ------------------------------------------------------------------ tabs
  let playerUI = null;
  function renderBody(keep = false) {
    if (!keep) onDurations = null;
    if (!keep || tab !== 'player') { playerUI?.destroy(); playerUI = null; }
    if (keep && tab === 'player' && playerUI) { playerUI.refresh(); drawTimeline(); return; }
    body.replaceChildren();
    if (tab === 'cast') renderCast();
    else if (tab === 'role') renderRole();
    else if (tab === 'player') renderPlayer();
    else renderExport();
  }

  function renderCast() {
    const engine = S.engine;
    const showCloud = engine === 'cloud';
    body.append(
      showCloud && status.configured && !cloudVoices ? h('p', { class: 'small muted' }, t('studio.loadingVoices')) : null,
      h('div', { class: 'row between', style: { marginBottom: '8px' } },
        h('p', { class: 'small text-2', style: { margin: 0, flex: 1 } }, t('studio.cast.' + engine)),
        btn(t('studio.autoCast'), () => {
          const n = applyAutoCast(script, engine, { webVoices, cloudVoices, piper });
          toast(n ? t('studio.autoCastDone', { n }) : t('studio.autoCastNone'), { type: n ? 'success' : 'error' });
          renderBody();
        }, { cls: 'btn-sm btn-primary', icon: 'sparkles' })),
      engine === 'web' ? moreVoicesTips() : null,
      ...script.characters.map((c) => voiceCard(script, c.id, { engine, webVoices, cloudVoices, piper, title: h('span', {}, c.name, script.myRoles.includes(c.id) ? h('span', { class: 'tag-mine', style: { marginLeft: '8px' } }, t('common.myRole')) : null) })),
      h('div', { class: 'card flat' },
        switchEl(t('studio.readDirections'), S.readDirections, (v) => { S.readDirections = v; save(); refreshDurations(); }, t('studio.readDirectionsHint')),
        switchEl(t('studio.readHeadings'), S.readHeadings, (v) => { S.readHeadings = v; save(); refreshDurations(); }),
        voiceCard(script, DIR_VOICE, { engine, webVoices, cloudVoices, piper, title: t('studio.directionsVoice') })),
    );
  }

  function renderRole() {
    if (!script.myRoles.length) {
      body.append(banner('info', 'user', t('studio.noRole'), ' ', h('a', { href: `#/script/${script.id}/roles` }, t('roles.choose'))));
      return;
    }
    const predicted = h('div');
    const formulaEl = h('p', { class: 'small text-2' });
    const updatePrediction = () => {
      formulaEl.textContent = t('studio.formula', { f: S.factor.toFixed(2), e: S.extra.toFixed(1) });
      const full = program('full');
      const train = program('rehearsal');
      predicted.replaceChildren(h('div', { class: 'grid grid-2' },
        h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, (full.approx ? '~' : '') + formatClock(full.total)), h('div', { class: 'stat-label' }, t('studio.variant.full'))),
        h('div', { class: 'stat' }, h('div', { class: 'stat-value gold' }, (train.approx ? '~' : '') + formatClock(train.total)), h('div', { class: 'stat-label' }, t('studio.variant.rehearsal')))),
      train.approx ? h('p', { class: 'hint' }, t('studio.approxNote')) : h('p', { class: 'hint' }, t('studio.exactNote')));
      renderSilenceList();
    };
    const presetSeg = segmented(TEMPO_PRESETS.map((p) => ({ value: p.factor, label: t('studio.tempo.' + p.id) + ' ' + Math.round(p.factor * 100) + '%' })), S.factor, (v) => { S.factor = v; factorRange.setValue(Math.round(v * 100)); save(); updatePrediction(); });
    const factorRange = rangeEl({ min: 100, max: 300, step: 5, value: Math.round(S.factor * 100), format: (x) => x + '%', onInput: (x) => { S.factor = x / 100; presetSeg.setValue(S.factor); updatePrediction(); }, onChange: () => save() });
    const extraRange = rangeEl({ min: 0, max: 10, step: 0.5, value: S.extra, format: (x) => x.toFixed(1) + ' s', onInput: (x) => { S.extra = x; updatePrediction(); }, onChange: () => save() });
    const profSel = selectEl([{ value: '', label: t('studio.noProfile') }, ...profiles.map((p) => ({ value: p.id, label: `${p.name} · ${p.wordsPerSecond.toFixed(2)} ${t('calib.wpsShort')}` }))], S.profileId || '', (v) => { S.profileId = v || null; save(); updatePrediction(); });
    const silenceList = h('div');
    function renderSilenceList() {
      const prog = program('rehearsal');
      const turns = prog.segments.filter((s) => s.role === 'turn');
      silenceList.replaceChildren(h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', {}, t('studio.line')), h('th', {}, t('studio.speech')), h('th', {}, t('studio.silence')), h('th', {}, ''))),
        h('tbody', {}, turns.map((s) => {
          const it = script.items.find((x) => x.id === s.itemId);
          const ov = S.lineOverrides[s.itemId] || {};
          const inp = h('input', { type: 'number', min: 0, max: 120, step: 0.5, value: ov.silence ?? '', placeholder: s.seconds.toFixed(1), style: { width: '90px', minHeight: '36px' }, 'aria-label': t('studio.manualSilence') });
          inp.addEventListener('change', () => {
            const v = inp.value === '' ? null : Math.max(0, Number(inp.value));
            S.lineOverrides[s.itemId] = { ...(S.lineOverrides[s.itemId] || {}) };
            if (v == null) delete S.lineOverrides[s.itemId].silence; else S.lineOverrides[s.itemId].silence = v;
            save(); updatePrediction();
          });
          return h('tr', {},
            h('td', { style: { fontFamily: 'var(--font-script)' } }, spokenText(it.text).slice(0, 60)),
            h('td', {}, (s.approx ? '~' : '') + (s.base ?? 0).toFixed(1) + ' s', h('div', { class: 'small muted' }, t('studio.source.' + s.source))),
            h('td', {}, inp),
            h('td', {}, h('strong', { class: 'gold' }, s.seconds.toFixed(1) + ' s')));
        }))));
    }
    onDurations = updatePrediction;
    body.append(
      h('div', { class: 'card' },
        h('h3', {}, t('studio.myRoleOptions')),
        ...script.myRoles.map((id) => field(charById(script, id)?.name || '?', segmented(ROLE_MODES.map((m) => ({ value: m, label: t('studio.roleMode.' + m) })), S.roleModes[id] || 'silent', (v) => { S.roleModes[id] = v; save(); refreshDurations(); updatePrediction(); }), t('studio.roleModeHint'))),
        field(t('studio.hintMode'), segmented(['first1', 'first3', 'start'].map((m) => ({ value: m, label: t('studio.roleMode.' + m) })), S.hintMode, (v) => { S.hintMode = v; save(); refreshDurations(); }), t('studio.hintModeHint'))),
      h('div', { class: 'card' },
        h('h3', {}, t('studio.silenceTitle')),
        formulaEl,
        field(t('studio.tempoLabel'), h('div', {}, presetSeg, h('div', { style: { height: '8px' } }), factorRange)),
        field(t('studio.extraLabel'), extraRange),
        field(t('studio.profile'), h('div', { class: 'row nowrap' }, profSel, btn(t('studio.calibrate'), () => openCalibration(script, async () => { profiles = await tempoProfiles(); renderBody(); }), { cls: 'btn-sm', icon: 'gauge' })), t('studio.profileHint')),
        S.engine !== 'web' ? switchEl(t('studio.measure'), S.measureWithTts !== false, (v) => { S.measureWithTts = v; save(); }, t('studio.measureHint')) : null,
        field(t('studio.beep'), selectEl(['none', 'single', 'double', 'bell', 'startEnd'].map((b) => ({ value: b, label: t('studio.beeps.' + b) })), S.beep, (v) => { S.beep = v; save(); updatePrediction(); }), t('studio.beepHint')),
        h('div', { class: 'section-title' }, t('studio.predicted')), predicted),
      h('div', { class: 'card' }, h('h3', {}, t('studio.perLine')), h('p', { class: 'small muted' }, t('studio.perLineHint')), silenceList),
    );
    updatePrediction();
  }

  // ------------------------------------------------------------------ player + timeline
  let tlWrap = null;
  let playhead = null;
  let panel = null;
  function renderPlayer() {
    playerUI = livePlayerUI(script, () => program(), {
      tracker,
      onSegment: (seg) => {
        if (!tlWrap) return;
        tlWrap.querySelectorAll('.tl-seg.sel').forEach((x) => x.classList.remove('sel'));
        tlWrap.querySelectorAll(`[data-item="${seg.itemId}"]`).forEach((x) => x.classList.add('sel'));
        if (playhead) { playhead.style.left = seg.t * zoom + 'px'; const sx = seg.t * zoom - tlWrap.clientWidth / 3; if (Math.abs(tlWrap.scrollLeft - sx) > tlWrap.clientWidth / 2) tlWrap.scrollLeft = sx; }
      },
    });
    tlWrap = h('div', { class: 'tl-wrap' });
    panel = h('div');
    body.append(
      h('div', { class: 'card' },
        field(t('studio.playMode'), segmented(['full', 'rehearsal', 'hints', 'mine', 'repeat', 'dress'].filter((m) => script.myRoles.length || m === 'full').map((m) => ({ value: m, label: t('studio.mode.' + m) })), playMode, (v) => { playMode = v; playerUI.refresh(); drawTimeline(); }), t('studio.modeHint.' + playMode)),
        rangePicker(() => { playerUI.refresh(); drawTimeline(); refreshDurations(); })),
      playerUI.el,
      h('div', { class: 'row between', style: { margin: '14px 0 6px' } }, h('div', { class: 'section-title', style: { margin: 0 } }, t('studio.timeline')),
        h('div', { class: 'row' }, iconBtn('zoomOut', t('studio.zoomOut'), () => { zoom = Math.max(1.5, zoom / 1.5); drawTimeline(); }, 'btn-sm'), iconBtn('zoomIn', t('studio.zoomIn'), () => { zoom = Math.min(80, zoom * 1.5); drawTimeline(); }, 'btn-sm'))),
      tlWrap,
      h('div', { class: 'legend', style: { marginTop: '6px' } },
        h('span', {}, h('i', { class: 'dot', style: { background: 'repeating-linear-gradient(45deg,var(--surface-3),var(--surface-3) 2px,var(--gray) 2px,var(--gray) 4px)' } }), t('studio.legendSilence')),
        h('span', {}, h('i', { class: 'dot', style: { background: 'var(--info)' } }), t('studio.legendBeep')),
        h('span', {}, t('studio.legendTap'))),
      panel);
    drawTimeline();
  }

  function drawTimeline() {
    if (!tlWrap) return;
    const prog = program();
    const keysOrder = [...script.characters.map((c) => c.id), DIR_VOICE, '__sig'];
    const used = new Set(prog.segments.map((s) => (s.kind === 'beep' ? '__sig' : s.kind === 'silence' ? s.charId : s.voiceKey)).filter(Boolean));
    const tracks = keysOrder.filter((k) => used.has(k));
    const width = Math.max(tlWrap.clientWidth || 600, prog.total * zoom + 40);
    const tl = h('div', { class: 'tl', style: { width: width + 'px' } });
    const ruler = h('div', { class: 'tl-ruler' });
    const step = zoom >= 30 ? 5 : zoom >= 10 ? 15 : zoom >= 4 ? 30 : 60;
    for (let s = 0; s <= prog.total + step; s += step) ruler.append(h('i', { style: { left: s * zoom + 'px' } }), h('span', { style: { left: s * zoom + 'px' } }, formatClock(s)));
    tl.appendChild(ruler);
    const stt = lineStatuses(script, progress);
    for (const k of tracks) {
      const track = h('div', { class: 'tl-track' }, h('span', { class: 'tl-track-label' }, k === '__sig' ? t('studio.signals') : charName(script, k)));
      for (const s of prog.segments) {
        const key = s.kind === 'beep' ? '__sig' : s.kind === 'silence' ? s.charId : s.voiceKey;
        if (key !== k || s.kind === 'marker' || (s.kind === 'silence' && s.role === 'gap')) continue;
        const cls = 'tl-seg' + (s.kind === 'silence' ? ' silence' : '') + (s.kind === 'beep' ? ' beep' : '') + (stt[s.itemId]?.status === 'hard' || stt[s.itemId]?.rec?.flagged ? ' difficult' : '') + (selectedItem === s.itemId ? ' sel' : '');
        track.appendChild(h('div', {
          class: cls, 'data-item': s.itemId, role: 'button', tabindex: '0',
          title: (s.kind === 'silence' ? t('studio.silenceFor') + ' ' : '') + (s.text || '') + ` (${s.approx ? '~' : ''}${s.seconds.toFixed(1)} s)`,
          style: { left: s.t * zoom + 'px', width: Math.max(3, s.seconds * zoom - 1) + 'px', background: s.kind === 'speech' ? charColor(script, s.voiceKey === DIR_VOICE ? null : s.voiceKey) : undefined },
          onclick: () => { selectedItem = s.itemId; drawTimeline(); renderPanel(s); },
          onkeydown: (e) => { if (e.key === 'Enter') { selectedItem = s.itemId; drawTimeline(); renderPanel(s); } },
        }, s.kind === 'silence' ? '…' : (s.text || '').slice(0, Math.floor(s.seconds * zoom / 6))));
      }
      tl.appendChild(track);
    }
    playhead = h('div', { class: 'tl-playhead', style: { left: (playerUI?.player.currentTime || 0) * zoom + 'px' } });
    tl.appendChild(playhead);
    const sl = tlWrap.scrollLeft;
    tlWrap.replaceChildren(tl);
    tlWrap.scrollLeft = sl;
  }

  function renderPanel(seg) {
    const it = script.items.find((x) => x.id === seg.itemId);
    if (!it || !panel) return;
    const ov = S.lineOverrides[it.id] || {};
    const setOv = (k, v) => {
      S.lineOverrides[it.id] = { ...(S.lineOverrides[it.id] || {}) };
      if (v == null || v === '') delete S.lineOverrides[it.id][k]; else S.lineOverrides[it.id][k] = v;
      save(); playerUI?.refresh(); drawTimeline(); refreshDurations();
    };
    const isLine = it.type === 'line';
    const isMine = isLine && script.myRoles.includes(it.charId);
    const flagged = lineStatuses(script, progress)[it.id]?.rec?.flagged;
    panel.replaceChildren(h('div', { class: 'card accent' },
      h('div', { class: 'card-title' }, h('h3', {}, isLine ? charName(script, it.charId) : t('editor.type.' + it.type)), iconBtn('x', t('common.close'), () => { selectedItem = null; panel.replaceChildren(); drawTimeline(); }, 'btn-sm btn-ghost')),
      h('p', { style: { fontFamily: 'var(--font-script)' } }, it.text),
      h('div', { class: 'row' },
        btn(t('studio.playLine'), () => speakItem(script, isLine ? it.charId : DIR_VOICE, isLine ? spokenText(it.text) : it.text, it.id).catch(() => {}), { cls: 'btn-sm', icon: 'play' }),
        btn(t('studio.playFromHere'), () => playerUI?.playFromItem(it.id), { cls: 'btn-sm btn-primary', icon: 'play' }),
        btn(t('studio.editText'), async () => {
          const v = await promptDialog(t('studio.editText'), { value: it.text, multiline: true });
          if (v == null || !v.trim()) return;
          it.text = v.trim();
          await saveScript(script);
          playerUI?.refresh(); drawTimeline(); renderPanel(seg);
          toast(t('studio.textChanged'));
        }, { cls: 'btn-sm', icon: 'edit' }),
        isLine && script.myRoles.length ? btn(flagged ? t('reader.unflag') : t('reader.flag'), async () => { await setFlagged(script, it.id, !flagged); drawTimeline(); renderPanel(seg); }, { cls: 'btn-sm', icon: 'flag' }) : null),
      isLine ? h('div', { class: 'grid grid-2 stack-sm', style: { marginTop: '10px' } },
        field(t('studio.voiceOverride'), selectEl([{ value: '', label: t('studio.ownVoice') }, ...script.characters.filter((c) => c.id !== it.charId).map((c) => ({ value: c.id, label: t('studio.voiceOf', { name: c.name }) }))], ov.voiceFrom || '', (v) => setOv('voiceFrom', v || null))),
        field(t('studio.lineTempo'), rangeEl({ min: 0.7, max: 1.4, step: 0.05, value: ov.rate || 1, format: (x) => Math.round(x * 100) + '%', onChange: (x) => setOv('rate', x === 1 ? null : x) })),
        field(t('studio.pauseAfter'), rangeEl({ min: 0, max: 5, step: 0.1, value: ov.pauseAfter ?? voiceOf(script, it.charId).pauseAfter, format: (x) => x.toFixed(1) + ' s', onChange: (x) => setOv('pauseAfter', x) })),
        isMine ? field(t('studio.manualSilence'), rangeEl({ min: 0, max: 60, step: 0.5, value: ov.silence ?? Math.round(seg.seconds * 2) / 2, format: (x) => x.toFixed(1) + ' s', onChange: (x) => setOv('silence', x) }), h('a', { href: 'javascript:void 0', onclick: () => setOv('silence', null) }, t('studio.autoSilence'))) : null,
        isMine ? field(t('studio.actorPause'), rangeEl({ min: 0, max: 10, step: 0.5, value: ov.actorPause || 0, format: (x) => x.toFixed(1) + ' s', onChange: (x) => setOv('actorPause', x || null) }), t('studio.actorPauseHint')) : null) : null));
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ------------------------------------------------------------------ export
  async function renderExport() {
    const engine = S.engine;
    const capOk = captureSupported();
    const ready = engine === 'cloud' ? !!status.configured : engine === 'piper' ? true : capOk && !!capture?.active;
    const q = QUALITY[exportState.quality];
    const est = h('div', { class: 'small text-2' }, t('studio.estimating'));
    const prog = h('div');
    const results = h('div');
    const variantsBox = h('div', { class: 'col' }, VARIANTS.filter((v) => script.myRoles.length || v === 'full').map((v) => h('label', { class: 'switch' },
      h('input', { type: 'checkbox', checked: exportState.variants.has(v), onchange: (e) => { if (e.target.checked) exportState.variants.add(v); else exportState.variants.delete(v); updEstimate(); } }),
      h('span', { class: 'switch-text' }, h('strong', {}, t('studio.variant.' + v)), h('div', { class: 'hint' }, t('studio.variantDesc.' + v))))));
    const fmtOpts = [{ value: 'mp3', label: 'MP3' }, { value: 'wav', label: 'WAV' }, ...(opusOk ? [{ value: 'ogg', label: 'OGG/Opus' }] : [])];

    async function updEstimate() {
      const vs = [...exportState.variants];
      if (!vs.length) { est.replaceChildren(t('studio.chooseVariant')); return; }
      const qq = QUALITY[exportState.quality];
      const lines = vs.map((v) => {
        const p = program(v);
        const size = sizeEstimate(p.total, exportState.format, qq.sampleRate, qq.kbps);
        return h('div', {}, `${t('studio.variant.' + v)}: ${p.approx ? '~' : ''}${formatClock(p.total)} · ~${formatBytes(size)}`);
      });
      let costLine = null;
      if (engine !== 'cloud' || ready) {
        try {
          const cp = await costPreview(script, vs, range, { measure: S.measureWithTts !== false, engine });
          const missing = cp.missingVoices.length ? h('div', { class: 'banner bad', style: { marginTop: '6px' } }, icon('alert'), h('div', {}, t(engine === 'piper' ? 'studio.missingPiper' : 'studio.missingVoices', { list: cp.missingVoices.map((k) => charName(script, k)).join(', ') }))) : null;
          if (engine === 'cloud') {
            const priceOf = (name) => cloudVoices?.find((v) => v.name === name)?.priceHintPerMillion ?? 16;
            let usd = 0;
            for (const [name, chars] of cp.byVoice) usd += costEstimate(chars, priceOf(name));
            costLine = h('div', { style: { marginTop: '6px' } },
              tn('studio.clipsN', cp.total, { cached: cp.cached }), ' · ', t('studio.charsToBill', { n: cp.chars.toLocaleString() }), status.mode === 'mock' ? '' : ' · ' + t('studio.approxCost', { usd: usd < 0.01 && usd > 0 ? '<0.01' : usd.toFixed(2) }), missing);
          } else {
            const toMake = cp.total - cp.cached;
            const secs = cp.chars / 14 + toMake * 0.8;
            const models = engine === 'piper' ? piperModelsNeeded().filter((v) => !piper?.downloaded.has(v.key)) : [];
            costLine = h('div', { style: { marginTop: '6px' } },
              tn('studio.clipsN', cp.total, { cached: cp.cached }), ' · ',
              engine === 'piper' ? t('studio.piperFree') : t('studio.captureTime', { time: formatClock(secs) }),
              models.length ? h('div', { class: 'small', style: { marginTop: '4px' } }, t('studio.piperModelsToGet', { list: models.map((m) => m.name + ' (' + formatBytes(m.sizeBytes) + ')').join(', ') })) : null,
              missing);
          }
        } catch (e) { costLine = h('div', { class: 'muted' }, e.message); }
      }
      est.replaceChildren(...lines, costLine, engine === 'cloud' ? h('div', { class: 'hint' }, t('studio.costNote')) : null);
    }

    async function run(all = false) {
      if (!ready) return;
      if (engine === 'cloud' && !(await ensureCloudConsent())) return;
      if (all) { exportState.variants = new Set(VARIANTS.filter((v) => script.myRoles.length || v === 'full')); renderExport(); return run(); }
      const vs = VARIANTS.filter((v) => exportState.variants.has(v));
      if (!vs.length) { toast(t('studio.chooseVariant')); return; }
      const ctrl = new AbortController();
      exportState.running = ctrl;
      const bar = h('span', { style: { width: '0%', background: 'var(--gold)' } });
      const label = h('div', { class: 'small' }, t('studio.starting'));
      prog.replaceChildren(h('div', { class: 'card accent' }, h('h3', {}, t('studio.generating')), label, h('div', { class: 'bar', style: { margin: '8px 0' } }, bar), btn(t('studio.cancel'), () => ctrl.abort(), { cls: 'btn-sm btn-danger', icon: 'x' })));
      try {
        const q2 = QUALITY[exportState.quality];
        if (engine === 'piper') {
          // download any voice models that are still missing
          for (const m of piperModelsNeeded().filter((v) => !piper.downloaded.has(v.key))) {
            if (ctrl.signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
            await downloadVoice(m, (r) => { label.textContent = t('studio.phaseDownload', { name: m.name, p: Math.round(r * 100) }); bar.style.width = Math.round(r * 100) + '%'; }, ctrl.signal);
            piper.downloaded.add(m.key);
          }
        }
        const out = await exportAudio(script, {
          variants: vs, range, format: exportState.format, sampleRate: q2.sampleRate, kbps: q2.kbps, zip: exportState.zip, profile: profile(), rangeLabel: rangeLabel(), signal: ctrl.signal,
          engine, capture,
          onProgress: (p) => {
            tracker.activity();
            if (p.phase === 'synth') { label.textContent = p.total ? t(engine === 'web' ? 'studio.phaseRecord' : 'studio.phaseSynth', { done: p.done, total: p.total, who: p.voiceKey ? charName(script, p.voiceKey) : '' }) : ''; bar.style.width = (p.total ? (p.done / p.total) * 60 : 0) + '%'; }
            if (p.phase === 'join') { label.textContent = t('studio.phaseJoin', { v: t('studio.variant.' + p.variant), i: p.vi + 1, n: p.vn }); bar.style.width = 60 + ((p.vi + p.ratio) / p.vn) * 25 + '%'; }
            if (p.phase === 'encode') { label.textContent = t('studio.phaseEncode', { f: p.format, v: t('studio.variant.' + p.variant), p: Math.round(p.ratio * 100) }); bar.style.width = 85 + ((p.vi + p.ratio) / p.vn) * 14 + '%'; }
            if (p.phase === 'zip') label.textContent = t('studio.phaseZip');
          },
        });
        exportState.result = out;
        prog.replaceChildren(banner('ok', 'check', t('studio.done', { n: out.files.length }), engine === 'cloud' ? h('div', { class: 'small' }, t('studio.billed', { n: out.billedChars.toLocaleString() })) : null));
        renderResults(results, out);
      } catch (e) {
        if (e.name === 'AbortError') prog.replaceChildren(banner('info', 'info', t('studio.cancelled')));
        else if (e.code === 'MISSING_VOICES') prog.replaceChildren(banner('bad', 'alert', t('studio.missingVoices', { list: e.voices.map((k) => charName(script, k)).join(', ') }), ' ', h('a', { href: 'javascript:void 0', onclick: () => { tab = 'cast'; renderHead(); renderBody(); } }, t('studio.tabCast'))));
        else if (e.code === 'CLOUD_CONSENT') prog.replaceChildren(banner('warn', 'lock', t('privacy.cloudTitle')));
        else if (e.code === 'CAPTURE_STOPPED' || e.code === 'CAPTURE_SILENT') prog.replaceChildren(banner('bad', 'alert', t('studio.capture.' + (e.code === 'CAPTURE_SILENT' ? 'silent' : 'stopped'))));
        else if (e.code === 'PIPER_NOT_DOWNLOADED') prog.replaceChildren(banner('bad', 'alert', t('piper.downloadFirst')));
        else { console.error(e); prog.replaceChildren(banner('bad', 'alert', t('studio.failed', { msg: e.message }))); }
      } finally {
        exportState.running = null;
        updEstimate();
      }
    }

    body.append(
      engine === 'cloud' && !ready ? banner('warn', 'lock', h('strong', {}, t('studio.exportNeedsBackend')), h('div', {}, t('studio.exportNeedsBackendText')), h('div', { class: 'small', style: { marginTop: '4px' } }, t('studio.orPiper'))) : null,
      engine === 'web' ? capturePanel(capOk) : null,
      engine === 'piper' ? banner('ok', 'lock', t('studio.piperExportInfo')) : null,
      h('div', { class: 'card' },
        h('h3', {}, t('studio.exportTitle')),
        variantsBox,
        rangePicker(() => updEstimate()),
        h('div', { class: 'grid grid-2 stack-sm' },
          field(t('studio.format'), segmented(fmtOpts, exportState.format, (v) => { exportState.format = v; updEstimate(); }), opusOk ? null : t('studio.oggUnsupported')),
          field(t('studio.quality'), segmented(Object.keys(QUALITY).map((k) => ({ value: k, label: t('studio.q.' + k) })), exportState.quality, (v) => { exportState.quality = v; S.exportQuality = v; save(); updEstimate(); }), `${q.sampleRate / 1000} kHz · ${exportState.format === 'mp3' ? q.kbps + ' kbps' : exportState.format === 'wav' ? '16-bit PCM' : 'Opus'}`)),
        switchEl(t('studio.zip'), exportState.zip, (v) => { exportState.zip = v; }),
        est,
        h('div', { class: 'row', style: { marginTop: '12px' } },
          btn(t('studio.generate'), () => run(false), { cls: 'btn-primary btn-lg', icon: 'wave', disabled: !ready }),
          script.myRoles.length ? btn(t('studio.downloadSet'), () => run(true), { cls: 'btn-accent btn-lg', icon: 'download', disabled: !ready }) : null),
        h('p', { class: 'hint' }, t('studio.resumeNote'))),
      prog, results);
    onDurations = updEstimate;
    updEstimate();
    if (exportState.result) renderResults(results, exportState.result);
  }

  function piperModelsNeeded() {
    if (!piper) return [];
    const keys = new Set();
    for (const c of script.characters) { const pv = voiceOf(script, c.id).piper.voice; if (pv) keys.add(pv); }
    if (S.readDirections || S.readHeadings) { const pv = voiceOf(script, DIR_VOICE).piper.voice; if (pv) keys.add(pv); }
    return piper.catalog.filter((v) => keys.has(v.key));
  }

  /** Recording browser voices: share screen/tab audio, test, then generate. */
  function capturePanel(capOk) {
    if (!capOk) return banner('warn', 'alert', h('strong', {}, t('studio.capture.unsupportedTitle')), h('div', {}, t('studio.capture.unsupported')));
    const statusBox = h('div');
    const box = h('div', { class: 'card accent' },
      h('h3', {}, t('studio.capture.title')),
      h('ol', { class: 'small text-2', style: { paddingLeft: '18px', margin: '0 0 10px' } }, ['s1', 's2', 's3', 's4'].map((k) => h('li', { style: { marginBottom: '4px' } }, t('studio.capture.' + k)))),
      statusBox);
    const render = (msg) => {
      statusBox.replaceChildren(
        capture?.active
          ? h('div', { class: 'row' }, h('span', { class: 'listening' }, t('studio.capture.active')), btn(t('studio.capture.test'), test, { cls: 'btn-sm', icon: 'volume' }), btn(t('studio.capture.stop'), () => { capture.stop(); capture = null; renderBody(); }, { cls: 'btn-sm btn-ghost', icon: 'stop' }))
          : btn(t('studio.capture.start'), start, { cls: 'btn-primary', icon: 'record' }),
        msg || null);
    };
    async function start() {
      try {
        capture = new SpeechCapture();
        await capture.start();
        capture.onEnded = () => { capture = null; renderBody(); };
        renderBody();
      } catch (e) {
        capture = null;
        render(banner('bad', 'alert', e.code === 'CAPTURE_NO_AUDIO' ? t('studio.capture.noAudio') : e.name === 'NotAllowedError' ? t('studio.capture.denied') : t('studio.capture.error', { msg: e.message })));
      }
    }
    async function test() {
      if (!capture?.active) return;
      render(h('p', { class: 'small' }, t('studio.capture.testing')));
      const v = voiceOf(script, script.characters[0]?.id || DIR_VOICE).web;
      const peak = await capture.test(v, script.lang === 'en' ? 'Testing, one, two, three.' : 'Próba dźwięku, raz, dwa, trzy.').catch(() => 0);
      render(peak > 0.01
        ? banner('ok', 'check', t('studio.capture.ok', { p: Math.round(Math.min(1, peak) * 100) }))
        : banner('bad', 'alert', t('studio.capture.silent')));
    }
    render();
    return box;
  }

  function renderResults(box, out) {
    box.replaceChildren(h('div', { class: 'section-title' }, t('studio.files')),
      out.zipBlob ? h('div', { class: 'card flat row between' }, h('div', {}, h('strong', {}, safeFileName(script.title) + '_komplet.zip'), h('div', { class: 'small muted' }, formatBytes(out.zipBlob.size))),
        btn(t('common.download'), () => shareOrDownload(out.zipBlob, safeFileName(script.title) + '_komplet.zip'), { cls: 'btn-primary btn-sm', icon: 'download' })) : null,
      ...out.files.map((f) => h('div', { class: 'card flat' },
        h('div', { class: 'row between' }, h('div', {}, h('strong', {}, f.name), h('div', { class: 'small muted' }, formatClock(f.duration) + ' · ' + formatBytes(f.size) + ' · ' + t('studio.variant.' + f.kind))),
          h('div', { class: 'row' },
            btn(t('library.play'), () => { const fp = filePlayer(f, script); modal({ title: f.name, body: fp.el, onClose: () => fp.destroy(), actions: [{ label: t('common.close') }] }); fp.audio.play(); }, { cls: 'btn-sm', icon: 'play' }),
            btn(t('common.download'), () => shareOrDownload(f.blob, f.name), { cls: 'btn-sm btn-primary', icon: 'download' }))))),
      h('p', { class: 'hint' }, t('studio.savedToLibrary'), ' ', h('a', { href: '#/library' }, t('rehearse.library'))));
  }

  renderHead();
  if (S.engine === 'cloud') await loadCloud();
  if (S.engine === 'piper') await loadPiper();
  renderBody();
  refreshDurations();
  const off = onVoicesChanged((v) => { webVoices = v; if (tab === 'cast') renderBody(); });
  return () => { off(); playerUI?.destroy(); stopAllSpeech(); tracker.stop(); exportState.running?.abort(); capture?.stop(); };
}
