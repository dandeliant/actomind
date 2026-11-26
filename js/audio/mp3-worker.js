/* ActoMind – MP3 encoding worker (lamejs, LGPL – https://github.com/zhuker/lamejs, LAME project: lame.sourceforge.net) */
/* global lamejs */
importScripts('../../vendor/lamejs/lame.min.js');

let encoder = null;
let chunks = [];
let bytes = 0;

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      encoder = new lamejs.Mp3Encoder(1, m.sampleRate, m.kbps);
      chunks = [];
      bytes = 0;
      self.postMessage({ type: 'ready' });
    } else if (m.type === 'data') {
      const out = encoder.encodeBuffer(m.samples);
      if (out.length) { chunks.push(new Uint8Array(out)); bytes += out.length; }
      self.postMessage({ type: 'progress', done: m.done, bytes });
    } else if (m.type === 'end') {
      const out = encoder.flush();
      if (out.length) chunks.push(new Uint8Array(out));
      const blob = new Blob(chunks, { type: 'audio/mpeg' });
      chunks = [];
      self.postMessage({ type: 'done', blob });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
