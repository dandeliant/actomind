// ActoMind – application bootstrap, router and navigation.
import { setLang, t } from './core/i18n.js';
import { settings, setSetting, on, flushSaves, flushProgress, activeScript } from './core/store.js';
import { openDb, requestPersistence } from './core/db.js';
import { h, mount, toast } from './ui/dom.js';
import { setHeader } from './ui/shell.js';
import { initPlanTimer } from './ui/plantimer.js';
import { icon } from './ui/icons.js';
import { stopAllSpeech } from './audio/voice-engine.js';

const ROUTES = [
  { re: /^\/?$/, view: () => import('./views/dashboard.js'), nav: 'home' },
  { re: /^\/scripts$/, view: () => import('./views/scripts.js'), nav: 'scripts' },
  { re: /^\/import$/, view: () => import('./views/import.js'), nav: 'scripts' },
  { re: /^\/script\/([^/]+)$/, view: () => import('./views/script.js'), nav: 'scripts', params: ['id'] },
  { re: /^\/script\/([^/]+)\/edit$/, view: () => import('./views/editor.js'), nav: 'scripts', params: ['id'] },
  { re: /^\/script\/([^/]+)\/roles$/, view: () => import('./views/roles.js'), nav: 'scripts', params: ['id'] },
  { re: /^\/learn$/, view: () => import('./views/learn.js'), nav: 'learn' },
  { re: /^\/learn\/read$/, view: () => import('./views/reader.js'), nav: 'learn' },
  { re: /^\/learn\/listen$/, view: () => import('./views/listen.js'), nav: 'learn' },
  { re: /^\/learn\/train\/([a-z]+)$/, view: () => import('./views/trainer.js'), nav: 'learn', params: ['mode'] },
  { re: /^\/learn\/chunks$/, view: () => import('./views/chunks.js'), nav: 'learn' },
  { re: /^\/learn\/exercises$/, view: () => import('./views/exercises.js'), nav: 'learn' },
  { re: /^\/learn\/mentor$/, view: () => import('./views/mentor.js'), nav: 'learn' },
  { re: /^\/learn\/premiere$/, view: () => import('./views/premiere.js'), nav: 'learn' },
  { re: /^\/rehearse$/, view: () => import('./views/rehearse.js'), nav: 'rehearse' },
  { re: /^\/rehearse\/partner$/, view: () => import('./views/partner.js'), nav: 'rehearse' },
  { re: /^\/rehearse\/dress$/, view: () => import('./views/partner.js'), nav: 'rehearse', extra: { dress: true } },
  { re: /^\/rehearse\/recordings$/, view: () => import('./views/recordings.js'), nav: 'rehearse' },
  { re: /^\/rehearse\/report\/([^/]+)$/, view: () => import('./views/report.js'), nav: 'rehearse', params: ['id'] },
  { re: /^\/studio$/, view: () => import('./views/studio.js'), nav: 'rehearse' },
  { re: /^\/library$/, view: () => import('./views/library.js'), nav: 'rehearse' },
  { re: /^\/progress$/, view: () => import('./views/progress.js'), nav: 'progress' },
  { re: /^\/settings$/, view: () => import('./views/settings.js'), nav: 'settings' },
];

const NAV = [
  { id: 'home', href: '#/', icon: 'home', key: 'nav.home' },
  { id: 'scripts', href: '#/scripts', icon: 'script', key: 'nav.scripts' },
  { id: 'learn', href: '#/learn', icon: 'brain', key: 'nav.learn' },
  { id: 'rehearse', href: '#/rehearse', icon: 'masks', key: 'nav.rehearse' },
  { id: 'progress', href: '#/progress', icon: 'chart', key: 'nav.progress' },
];

let cleanup = null;
let navToken = 0;
const viewEl = () => document.getElementById('view');

function renderNav(active) {
  const nav = document.getElementById('bottom-nav');
  nav.setAttribute('aria-label', t('nav.label'));
  mount(nav, NAV.map((n) => h('a', { href: n.href, class: n.id === active ? 'active' : '', 'aria-current': n.id === active ? 'page' : null }, icon(n.icon), h('span', {}, t(n.key)))));
}

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

async function route(opts = {}) {
  const token = ++navToken;
  const { path, query } = parseHash();
  if (opts.keepScroll) query.keepScroll = '1';
  const r = ROUTES.find((x) => x.re.test(path)) || ROUTES[0];
  const m = path.match(r.re) || [];
  const params = { ...(r.extra || {}) };
  (r.params || []).forEach((p, i) => { params[p] = decodeURIComponent(m[i + 1]); });
  try { cleanup?.(); } catch (e) { console.error(e); }
  cleanup = null;
  stopAllSpeech();
  flushSaves();
  flushProgress();
  renderNav(r.nav);
  const root = viewEl();
  root.style.animation = 'none';
  void root.offsetWidth;
  root.style.animation = '';
  try {
    const mod = await r.view();
    if (token !== navToken) return;
    mount(root);
    setHeader('');
    const c = await mod.default(root, params, query);
    if (token !== navToken) { try { c?.(); } catch { /* ignore */ } return; }
    cleanup = typeof c === 'function' ? c : null;
    if (!query.keepScroll) window.scrollTo(0, 0);
    root.focus({ preventScroll: true });
  } catch (e) {
    console.error(e);
    mount(root, h('div', { class: 'card' }, h('h2', {}, t('app.errorTitle')), h('p', { class: 'muted' }, String(e.message || e)), h('a', { class: 'btn', href: '#/' }, t('nav.home'))));
  }
}

function applyTheme() {
  let th = settings.theme;
  if (th === 'auto') th = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', th);
  document.documentElement.style.setProperty('--script-size', settings.scriptSize + 'px');
  document.documentElement.style.setProperty('--script-lh', String(settings.scriptLineHeight));
  document.body.classList.toggle('eyes-free', !!settings.eyesFree);
}

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast(t('app.updateReady'), { action: { label: t('app.reload'), onClick: () => { nw.postMessage('skipWaiting'); } }, timeout: 15000 });
        }
      });
    });
  }).catch((e) => console.warn('SW registration failed', e));
  // reload only when an existing version is replaced (update), not when the first SW takes control
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
}

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__actomindInstall = e; });

async function boot() {
  setLang(settings.lang);
  applyTheme();
  on('settings', ({ key }) => {
    if (key === 'lang') { setLang(settings.lang); route(); }
    if (['theme', 'scriptSize', 'scriptLineHeight', 'eyesFree'].includes(key)) applyTheme();
    if (key === 'gamification') route();
  });
  on('achievement', async (id) => {
    if (!settings.gamification) return;
    toast(h('span', {}, h('strong', { class: 'gold' }, t('achievements.unlocked') + ' '), t('achievements.' + id + '.title')), { type: 'success' });
  });
  on('engineFallback', (d) => toast(t(d?.engine === 'piper' ? 'studio.piperFallback' : 'studio.cloudFallback'), { type: 'error' }));
  window.addEventListener('online', () => setHeaderRefresh());
  window.addEventListener('offline', () => setHeaderRefresh());
  window.addEventListener('hashchange', () => route());
  window.addEventListener('actomind:reroute', (e) => route(e.detail || {}));
  window.addEventListener('pagehide', () => { flushSaves(); flushProgress(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { flushSaves(); flushProgress(); } });
  try {
    await openDb();
    requestPersistence();
  } catch (e) {
    mount(viewEl(), h('div', { class: 'card' }, h('h2', {}, t('app.storageError')), h('p', {}, String(e.message))));
    return;
  }
  registerSW();
  initPlanTimer();
  await route();
  if (!settings.tutorialDone) {
    const { showTutorial } = await import('./views/tutorial.js');
    showTutorial();
  }
  // keep active script fresh
  activeScript();
}

function setHeaderRefresh() {
  const ha = document.getElementById('header-actions');
  const pill = ha?.querySelector('.offline-pill');
  if (!navigator.onLine && !pill) ha?.prepend(h('span', { class: 'offline-pill', title: t('app.offlineHint') }, t('app.offline')));
  if (navigator.onLine && pill) pill.remove();
}

boot();
