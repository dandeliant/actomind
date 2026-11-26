// ActoMind – Media Session API (lock screen / Bluetooth headset controls).
export function setupMediaSession(meta, handlers) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: meta.title || 'ActoMind',
      artist: meta.artist || 'ActoMind',
      album: meta.album || 'ActoMind – Learn your lines',
      artwork: [
        { src: new URL('icons/icon-192.png', location.href).href, sizes: '192x192', type: 'image/png' },
        { src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' },
      ],
    });
  } catch { /* ignore */ }
  const map = { play: 'play', pause: 'pause', stop: 'stop', previoustrack: 'previoustrack', nexttrack: 'nexttrack', seekbackward: 'seekbackward', seekforward: 'seekforward', seekto: 'seekto' };
  for (const [action, key] of Object.entries(map)) {
    try { navigator.mediaSession.setActionHandler(action, handlers[key] ? (d) => handlers[key](d) : null); } catch { /* unsupported action */ }
  }
}

export function clearMediaSession() {
  if (!('mediaSession' in navigator)) return;
  for (const a of ['play', 'pause', 'stop', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward', 'seekto']) {
    try { navigator.mediaSession.setActionHandler(a, null); } catch { /* ignore */ }
  }
  navigator.mediaSession.metadata = null;
}

export function updatePosition(audio) {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  try {
    if (isFinite(audio.duration)) navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate, position: Math.min(audio.currentTime, audio.duration) });
  } catch { /* ignore */ }
}
