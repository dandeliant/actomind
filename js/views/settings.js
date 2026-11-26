// ActoMind – settings, data & privacy, backend configuration, installation.
import { h, btn, field, segmented, switchEl, rangeEl, toast, confirmDialog, banner, downloadBlob, pickFile, linkBtn, selectEl } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { setHeader, navigate } from '../ui/shell.js';
import { t, tn } from '../core/i18n.js';
import { settings, setSetting, exportBackup, importBackup, wipeAll } from '../core/store.js';
import { storageEstimate } from '../core/db.js';
import { cloudStatus, invalidateCloudStatus, ttsCacheStats, clearTtsCache } from '../audio/cloud.js';
import { support, recognitionProvider } from '../core/speech.js';
import { formatBytes, dateKey } from '../core/util.js';

export default async function settingsView(root) {
  setHeader(t('settings.title'));
  const backendBox = h('div');
  const storageBox = h('div', { class: 'small muted' });

  const sec = (title, ...children) => h('div', {}, h('div', { class: 'section-title' }, title), h('div', { class: 'card' }, ...children));

  root.append(
    h('h1', {}, t('settings.title')),
    sec(t('settings.appearance'),
      field(t('settings.language'), segmented([{ value: 'pl', label: 'Polski' }, { value: 'en', label: 'English' }], settings.lang, (v) => setSetting('lang', v))),
      field(t('settings.theme'), segmented([{ value: 'dark', label: t('settings.themeDark') }, { value: 'light', label: t('settings.themeLight') }, { value: 'auto', label: t('settings.themeAuto') }], settings.theme, (v) => setSetting('theme', v))),
      field(t('settings.fontSize'), rangeEl({ min: 14, max: 32, step: 1, value: settings.scriptSize, format: (x) => x + ' px', onChange: (x) => setSetting('scriptSize', x) })),
      field(t('reader.lineHeight'), rangeEl({ min: 1.2, max: 2.4, step: 0.05, value: settings.scriptLineHeight, format: (x) => x.toFixed(2), onChange: (x) => setSetting('scriptLineHeight', x) }))),
    sec(t('settings.learning'),
      field(t('partner.strictness'), segmented([{ value: 'free', label: t('partner.strict.free') }, { value: 'training', label: t('partner.strict.training') }, { value: 'professional', label: t('partner.strict.professional') }], settings.strictness, (v) => setSetting('strictness', v)), t('partner.strictHint.' + settings.strictness)),
      field(t('settings.dailyGoal'), rangeEl({ min: 5, max: 120, step: 5, value: settings.dailyGoal, format: (x) => x + ' min', onChange: (x) => setSetting('dailyGoal', x) })),
      field(t('settings.newPerSession'), rangeEl({ min: 3, max: 50, step: 1, value: settings.newPerSession, format: (x) => String(x), onChange: (x) => setSetting('newPerSession', x) })),
      switchEl(t('settings.autoSpeakCue'), settings.autoSpeakCue, (v) => setSetting('autoSpeakCue', v)),
      switchEl(t('settings.gamification'), settings.gamification, (v) => setSetting('gamification', v), t('settings.gamificationHint'))),
    sec(t('settings.speech'),
      h('p', { class: 'small' }, support.tts ? '✓ ' + t('settings.ttsOk') : '✗ ' + t('support.noTts')),
      h('p', { class: 'small' }, support.stt ? '✓ ' + t('settings.sttOk') : '✗ ' + t('support.noStt')),
      support.stt ? banner('warn', 'info', t('privacy.sttProvider.' + recognitionProvider())) : null,
      switchEl(t('partner.useStt'), settings.sttEnabled, (v) => setSetting('sttEnabled', v)),
      field(t('settings.silenceTimeout'), rangeEl({ min: 0.8, max: 5, step: 0.1, value: settings.silenceTimeout, format: (x) => x.toFixed(1) + ' s', onChange: (x) => setSetting('silenceTimeout', x) }), t('settings.silenceHint')),
      switchEl(t('partner.voiceCommands'), settings.voiceCommands, (v) => setSetting('voiceCommands', v)),
      switchEl(t('partner.eyesFree'), settings.eyesFree, (v) => setSetting('eyesFree', v), t('partner.eyesFreeHint'))),
    sec('Google Cloud Text-to-Speech', backendBox),
    sec(t('settings.privacy'),
      h('p', { class: 'small text-2' }, t('settings.privacyText')),
      h('div', { class: 'row' },
        btn(t('settings.revokeMic'), () => { setSetting('micConsent', false); setSetting('sttConsent', false); toast(t('settings.revoked')); }, { cls: 'btn-sm', icon: 'micOff' }),
        btn(t('settings.revokeCloud'), () => { setSetting('cloudConsent', false); toast(t('settings.revoked')); }, { cls: 'btn-sm', icon: 'lock' }))),
    sec(t('settings.data'),
      h('div', { class: 'row' },
        btn(t('settings.exportJson'), async () => downloadBlob(new Blob([JSON.stringify(await exportBackup(), null, 1)], { type: 'application/json' }), `ActoMind_backup_${dateKey()}.json`), { cls: 'btn-sm', icon: 'download' }),
        btn(t('settings.exportJsonAudio'), async () => downloadBlob(new Blob([JSON.stringify(await exportBackup({ includeAudio: true }))], { type: 'application/json' }), `ActoMind_backup_full_${dateKey()}.json`), { cls: 'btn-sm', icon: 'download' }),
        btn(t('settings.importJson'), async () => {
          const f = await pickFile('.json,application/json');
          if (!f) return;
          try {
            const data = JSON.parse(await f.text());
            const replace = await confirmDialog(t('settings.importMode'), { ok: t('settings.importReplace'), cancel: t('settings.importMerge') });
            const n = await importBackup(data, { replace });
            toast(tn('import.backupRestored', n), { type: 'success' });
          } catch (e) { toast(t('settings.importError', { msg: e.message }), { type: 'error' }); }
        }, { cls: 'btn-sm', icon: 'upload' }),
        linkBtn(t('settings.archived'), '#/scripts?tab=archived', { cls: 'btn-sm', icon: 'archive' })),
      h('p', { class: 'hint' }, t('settings.backupHint')),
      storageBox,
      h('div', { class: 'row', style: { marginTop: '10px' } },
        btn(t('settings.wipe'), async () => {
          if (!(await confirmDialog(t('settings.wipeConfirm'), { danger: true, ok: t('settings.wipe') }))) return;
          await wipeAll();
          toast(t('settings.wiped'));
          navigate('#/');
        }, { cls: 'btn-sm btn-danger', icon: 'trash' }))),
    sec(t('settings.install'),
      h('p', { class: 'small text-2' }, t('settings.installText')),
      h('div', { class: 'row' },
        btn(t('settings.installBtn'), async () => {
          const p = window.__actomindInstall;
          if (!p) { toast(t('settings.installManual')); return; }
          p.prompt();
          await p.userChoice;
          window.__actomindInstall = null;
        }, { cls: 'btn-sm btn-primary', icon: 'download' }),
        btn(t('tutorial.open'), async () => (await import('./tutorial.js')).showTutorial(), { cls: 'btn-sm', icon: 'help' }))),
    sec(t('settings.about'),
      h('p', {}, h('strong', { class: 'gold' }, 'ActoMind – Your Personal Acting Coach'), h('br'), 'Learn your lines. Live your role.'),
      h('p', { class: 'small muted' }, t('settings.licenses'))),
  );

  // ---- backend
  async function renderBackend(force = false) {
    backendBox.replaceChildren(h('p', { class: 'small muted' }, t('settings.checking')));
    const st = await cloudStatus(force);
    const cache = await ttsCacheStats();
    const urlIn = h('input', { type: 'url', value: settings.backendUrl, placeholder: t('settings.backendSame') });
    urlIn.addEventListener('change', () => { setSetting('backendUrl', urlIn.value.trim()); invalidateCloudStatus(); renderBackend(true); });
    const codeIn = h('input', { type: 'password', value: settings.accessCode, placeholder: t('settings.accessCodePh'), autocomplete: 'off' });
    codeIn.addEventListener('change', () => { setSetting('accessCode', codeIn.value); invalidateCloudStatus(); });
    let statusEl;
    if (!st.reachable) statusEl = banner('warn', 'offline', t(st.offline ? 'settings.backendOffline' : 'settings.backendUnreachable'));
    else if (!st.configured) statusEl = banner('warn', 'alert', t('settings.backendNotConfigured'), st.credentialsError ? h('div', { class: 'small' }, st.credentialsError) : null);
    else statusEl = banner('ok', 'check', t('settings.backendOk', { mode: st.mode }), st.mode === 'mock' ? h('div', { class: 'small' }, t('settings.mockMode')) : null, st.accessCodeRequired ? h('div', { class: 'small' }, t('settings.codeRequired')) : null);
    backendBox.replaceChildren(
      h('p', { class: 'small text-2' }, t('settings.backendIntro')),
      statusEl,
      field(t('settings.backendUrl'), urlIn, t('settings.backendUrlHint')),
      field(t('settings.accessCode'), codeIn, t('settings.accessCodeHint')),
      switchEl(t('settings.cloudConsent'), settings.cloudConsent, (v) => setSetting('cloudConsent', v), t('privacy.cloudText1')),
      h('div', { class: 'row' },
        btn(t('settings.testConnection'), () => renderBackend(true), { cls: 'btn-sm', icon: 'refresh' }),
        h('span', { class: 'small muted' }, t('settings.ttsCache', { n: cache.entries, size: formatBytes(cache.bytes) })),
        btn(t('settings.clearCache'), async () => { if (await confirmDialog(t('settings.clearCacheConfirm'))) { await clearTtsCache(); renderBackend(); } }, { cls: 'btn-sm btn-ghost', icon: 'trash' })));
  }
  renderBackend();
  storageEstimate().then((e) => { if (e) storageBox.textContent = t('settings.storage', { used: formatBytes(e.usage || 0), quota: formatBytes(e.quota || 0) }); });
}
