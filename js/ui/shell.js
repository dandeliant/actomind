// ActoMind – header / navigation helpers shared by views.
import { h, mount, iconBtn } from './dom.js';
import { t } from '../core/i18n.js';
import { planChip } from './plantimer.js';

export function setHeader(title, actions = []) {
  const ht = document.getElementById('header-title');
  if (ht) ht.textContent = title || '';
  const ha = document.getElementById('header-actions');
  if (ha) {
    mount(ha, planChip(), ...actions,
      navigator.onLine ? null : h('span', { class: 'offline-pill', title: t('app.offlineHint') }, t('app.offline')),
      iconBtn('settings', t('nav.settings'), () => { location.hash = '#/settings'; }, 'btn-ghost'));
  }
  document.title = (title ? title + ' · ' : '') + 'ActoMind';
}

export function navigate(hash) {
  if (location.hash === hash) window.dispatchEvent(new Event('actomind:reroute'));
  else location.hash = hash;
}

export function rerender() {
  window.dispatchEvent(new CustomEvent('actomind:reroute', { detail: { keepScroll: true } }));
}
