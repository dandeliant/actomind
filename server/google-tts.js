// ActoMind server – Google Cloud Text-to-Speech client (REST v1), API key or service-account auth.
// Zero dependencies (Node >= 18). Credentials never leave the server.
import crypto from 'node:crypto';
import fs from 'node:fs';

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

export function voiceModel(name = '') {
  const n = name.toLowerCase();
  if (n.includes('chirp3-hd')) return 'Chirp3-HD';
  if (n.includes('chirp-hd')) return 'Chirp-HD';
  if (n.includes('journey')) return 'Journey';
  if (n.includes('studio')) return 'Studio';
  if (n.includes('neural2')) return 'Neural2';
  if (n.includes('wavenet')) return 'WaveNet';
  if (n.includes('polyglot')) return 'Polyglot';
  if (n.includes('news')) return 'News';
  if (n.includes('casual')) return 'Casual';
  if (n.includes('standard')) return 'Standard';
  return 'Other';
}

/** Known parameter support per model family (verified again at runtime by retrying without the parameter). */
export function modelCapabilities(model) {
  switch (model) {
    case 'Journey':
      return { pitch: false, speakingRate: false, ssml: false };
    case 'Chirp-HD':
    case 'Chirp3-HD':
      return { pitch: false, speakingRate: true, ssml: false };
    case 'Studio':
      return { pitch: false, speakingRate: true, ssml: true };
    default:
      return { pitch: true, speakingRate: true, ssml: true };
  }
}

/** Approximate USD price per 1M characters (informational only – check the official pricing page). */
export const PRICE_HINTS = { Standard: 4, WaveNet: 4, Neural2: 16, Polyglot: 16, News: 16, Casual: 16, Studio: 160, Journey: 30, 'Chirp-HD': 30, 'Chirp3-HD': 30, Other: 16 };

export class GoogleTts {
  /**
   * @param {{apiKey?:string, credentialsFile?:string, credentialsJson?:string, endpoint?:string, fetchImpl?:typeof fetch}} cfg
   */
  constructor(cfg = {}) {
    this.apiKey = cfg.apiKey || '';
    this.endpoint = (cfg.endpoint || 'https://texttospeech.googleapis.com').replace(/\/$/, '');
    this.fetch = cfg.fetchImpl || fetch;
    this.sa = null;
    this.token = null;
    this.unsupported = new Map(); // voice name → Set of params rejected by the API
    let json = cfg.credentialsJson || '';
    if (!json && cfg.credentialsFile) {
      try { json = fs.readFileSync(cfg.credentialsFile, 'utf8'); } catch (e) { this.credError = 'Cannot read credentials file: ' + e.message; }
    }
    if (json) {
      try {
        const o = JSON.parse(json);
        if (o.type === 'service_account' && o.private_key && o.client_email) this.sa = o;
        else this.credError = 'Credentials JSON is not a service account key';
      } catch (e) { this.credError = 'Invalid credentials JSON: ' + e.message; }
    }
  }

  get mode() { return this.sa ? 'serviceAccount' : this.apiKey ? 'apiKey' : null; }
  get configured() { return !!this.mode; }

  async accessToken() {
    if (this.token && this.token.exp > Date.now() + 60000) return this.token.value;
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const aud = this.sa.token_uri || 'https://oauth2.googleapis.com/token';
    const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: this.sa.client_email, scope: SCOPE, aud, iat: now, exp: now + 3600 });
    const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(this.sa.private_key).toString('base64url');
    const res = await this.fetch(aud, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) throw httpError(502, 'OAuth token error: ' + (j.error_description || j.error || res.status));
    this.token = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
    return this.token.value;
  }

  async request(path, init = {}) {
    const headers = { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) };
    let url = this.endpoint + path;
    if (this.sa) headers.authorization = 'Bearer ' + (await this.accessToken());
    else url += (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(this.apiKey);
    const res = await this.fetch(url, { ...init, headers });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    if (!res.ok) {
      const msg = json?.error?.message || text.slice(0, 300) || res.statusText;
      throw httpError(res.status === 400 ? 400 : 502, 'Google TTS: ' + msg, res.status);
    }
    return json;
  }

  async listVoices(languageCode) {
    const q = languageCode ? '?languageCode=' + encodeURIComponent(languageCode) : '';
    const j = await this.request('/v1/voices' + q, { method: 'GET' });
    return (j.voices || []).map((v) => {
      const model = voiceModel(v.name);
      return {
        name: v.name,
        languageCodes: v.languageCodes,
        ssmlGender: v.ssmlGender,
        naturalSampleRateHertz: v.naturalSampleRateHertz,
        model,
        capabilities: modelCapabilities(model),
        priceHintPerMillion: PRICE_HINTS[model] ?? PRICE_HINTS.Other,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Synthesize text to LINEAR16 WAV. Parameters not supported by the voice model are dropped
   * (first from the known table, then by retrying when the API rejects them).
   * @returns {Promise<{wav:Buffer, adjusted:string[]}>}
   */
  async synthesize({ text, voice, audioConfig = {} }) {
    const model = voiceModel(voice.name);
    const caps = modelCapabilities(model);
    const known = this.unsupported.get(voice.name) || new Set();
    const cfg = { audioEncoding: 'LINEAR16', sampleRateHertz: audioConfig.sampleRateHertz || 24000 };
    const adjusted = [];
    const want = (k) => audioConfig[k] != null && !(k === 'speakingRate' && audioConfig[k] === 1) && !(k === 'pitch' && audioConfig[k] === 0);
    if (want('speakingRate')) { if (caps.speakingRate && !known.has('speakingRate')) cfg.speakingRate = audioConfig.speakingRate; else adjusted.push('speakingRate'); }
    if (want('pitch')) { if (caps.pitch && !known.has('pitch')) cfg.pitch = audioConfig.pitch; else adjusted.push('pitch'); }
    if (audioConfig.volumeGainDb) cfg.volumeGainDb = audioConfig.volumeGainDb;
    const body = (c) => JSON.stringify({ input: { text }, voice: { languageCode: voice.languageCode, name: voice.name }, audioConfig: c });
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const j = await this.request('/v1/text:synthesize', { method: 'POST', body: body(cfg) });
        if (!j?.audioContent) throw httpError(502, 'Google TTS returned no audio');
        return { wav: Buffer.from(j.audioContent, 'base64'), adjusted };
      } catch (e) {
        if (e.status !== 400) throw e;
        const m = String(e.message).toLowerCase();
        const drop = ['pitch', 'speakingRate', 'volumeGainDb'].find((k) => k in cfg && (m.includes(k.toLowerCase()) || m.includes(k === 'speakingRate' ? 'speaking rate' : k)));
        const fallback = !drop && ('pitch' in cfg ? 'pitch' : 'speakingRate' in cfg ? 'speakingRate' : null);
        const k = drop || (m.includes('not supported') || m.includes('does not support') ? fallback : null);
        if (!k) throw e;
        delete cfg[k];
        adjusted.push(k);
        known.add(k);
        this.unsupported.set(voice.name, known);
      }
    }
    throw httpError(400, 'Google TTS rejected the request');
  }
}

export function httpError(status, message, upstream) {
  const e = new Error(message);
  e.status = status;
  if (upstream) e.upstream = upstream;
  return e;
}
