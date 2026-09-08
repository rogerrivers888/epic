/**
 * OpenAI, for the two halves of hearing somebody (owner's brief, 8 Sep 2026).
 *
 * Voice is Epic's primary input, and the brief fixes the shape: **two stages
 * that are never merged.** Stage one turns speech into a faithful transcript —
 * no tidying, no summarising — and stage two reads that transcript into a
 * structured intent. The split matters because stage two needs the mess: "the
 * 14th — no, sorry, the 15th" has to arrive with both dates in it so the
 * correction can be resolved on purpose rather than lost by a tidier.
 *
 * Three ways of doing stage one, all here so they can be compared on the same
 * words (the brief: "treat this as an experiment, not a single choice"):
 *
 *   transcribe()      the file endpoint — the whole recording, one answer;
 *   transcribe({stream}) the same endpoint streaming its answer back as it is
 *                     written — the upload still happens first;
 *   mintLiveToken()   a Realtime transcription session the browser connects to
 *                     directly, for word-by-word captions. The standing key
 *                     never leaves this process: the browser gets a client
 *                     secret that expires in a minute and can do one thing.
 *
 * And stage two, extract(): a structured answer against a strict JSON schema
 * (domain/voiceIntent.js says what).
 *
 * Nothing in here knows about households or caps; routes/voice.js holds the
 * purse and the ledger. This file only speaks to the provider and turns what
 * it says into something the rest of Epic can act on — including its failures,
 * which arrive as `VoiceProviderError` with a plain sentence for the screen and
 * the provider's own words kept for the back office (owner, 5 Sep 2026: a
 * household never sees a provider's error).
 */

const BASE = process.env.OPENAI_BASE_URL?.replace(/\/$/, '') || 'https://api.openai.com/v1';

export const openaiEnabled = () => Boolean(process.env.OPENAI_API_KEY?.trim());

/**
 * The models, and the order to fall back through them.
 *
 * The brief names `gpt-transcribe` for files and `gpt-live-transcribe` for
 * captions. A model name is the one thing here most likely to move under us,
 * so each is an environment variable, and a model the account cannot use
 * (a 404, or a 400 naming the model) steps down the ladder rather than
 * stopping voice altogether — the answer says which one actually spoke.
 */
export const TRANSCRIBE_MODEL = process.env.EPIC_TRANSCRIBE_MODEL || 'gpt-transcribe';
export const LIVE_MODEL = process.env.EPIC_LIVE_TRANSCRIBE_MODEL || 'gpt-live-transcribe';
export const PLAN_MODEL = process.env.EPIC_VOICE_PLAN_MODEL || 'gpt-5-mini';
export const LIVE_URL = process.env.EPIC_LIVE_TRANSCRIBE_URL || 'wss://api.openai.com/v1/realtime?intent=transcription';

/** Minutes of speech a household may send in a calendar month, all modes together (routes/voice.js holds the purse). */
export const VOICE_MINUTES_MONTHLY = Number(process.env.EPIC_VOICE_MINUTES_MONTHLY || 120);

const FILE_LADDER = [TRANSCRIBE_MODEL, 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'];
const LIVE_LADDER = [LIVE_MODEL, 'gpt-realtime-whisper', 'gpt-4o-transcribe'];

/** List price, US dollars a minute of audio (pricing page, 8 Sep 2026). An estimate, never an invoice. */
export const MINUTE_RATES = {
  'gpt-transcribe': 0.0045,
  'gpt-4o-transcribe': 0.006,
  'gpt-4o-mini-transcribe': 0.003,
  'whisper-1': 0.006,
  'gpt-live-transcribe': 0.017,
  'gpt-realtime-whisper': 0.017,
};
/** US dollars a million tokens, in and out, for the stage-two models. */
export const TOKEN_RATES = {
  'gpt-5-nano': { input: 0.05, output: 0.40 },
  'gpt-5-mini': { input: 0.25, output: 2.00 },
  'gpt-5': { input: 1.25, output: 10.00 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
};
export const minuteCost = (model, seconds) => (MINUTE_RATES[model] ?? 0.006) * (Math.max(0, seconds) / 60);
export const tokenCost = (model, usage) => {
  const r = TOKEN_RATES[model] ?? TOKEN_RATES['gpt-5-mini'];
  return ((usage?.input_tokens || 0) * r.input + (usage?.output_tokens || 0) * r.output) / 1e6;
};

/**
 * What the provider could not do, in two registers.
 *
 * `message` is the sentence a phone may show. `detail` is what OpenAI said,
 * verbatim and trimmed, for the back office and the logs. `code` is what the
 * app branches on: `voice_not_configured` (no key — the owner's to add, in
 * Doppler), `voice_switched_off` (the owner's switch in Settings › Providers),
 * `voice_unavailable` (the provider refused or could not be reached).
 */
export class VoiceProviderError extends Error {
  constructor(code, message, detail = null, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

const notConfigured = () => new VoiceProviderError('voice_not_configured', 'Voice is not set up on this server yet.', 'OPENAI_API_KEY is not set', 503);

const headers = (extra = {}) => ({ authorization: `Bearer ${process.env.OPENAI_API_KEY.trim()}`, ...extra });

/** Read the provider's error body, whatever shape it took. */
async function failure(res) {
  const text = await res.text().catch(() => '');
  let message = text;
  let code = null;
  let param = null;
  try {
    const j = JSON.parse(text);
    message = j?.error?.message ?? text;
    code = j?.error?.code ?? j?.error?.type ?? null;
    param = j?.error?.param ?? null;
  } catch { /* not json */ }
  return { status: res.status, message: String(message).slice(0, 400), code, param };
}

/** A 404, or a 400 that names the model: the account cannot use this one. */
const isModelRefusal = (f) => f.status === 404 || (f.status === 400 && (f.code === 'model_not_found' || /model/i.test(f.message) && !/param/i.test(f.message)));
/** A 400 naming one of our optional parameters: this model does not take it. */
const isParamRefusal = (f) => f.status === 400 && (f.code === 'unknown_parameter' || f.code === 'unsupported_parameter' || f.code === 'unsupported_value' || f.code === 'invalid_value' || /unrecognized|unknown parameter|unsupported|not supported|does not support|invalid value|invalid type|not a valid/i.test(f.message));

/**
 * Which of our optional fields a refusal is about, from `param` ("session.audio.
 * input.noise_reduction", "keywords") or, failing that, from the sentence. Only
 * the fields we can do without are named here; anything else is a real error.
 */
const OPTIONAL = ['keywords', 'languages', 'language', 'prompt', 'noise_reduction', 'turn_detection', 'expires_after', 'reasoning', 'store', 'text.verbosity', 'temperature', 'response_format'];
function refusedField(f) {
  const hay = `${f.param ?? ''} ${f.message ?? ''}`;
  for (const name of OPTIONAL) {
    const leaf = name.split('.').pop();
    if (new RegExp(`(^|[^a-z_])${leaf.replace('.', '\\.')}(\\[\\])?([^a-z_]|$)`, 'i').test(hay)) return name;
  }
  return null;
}
/** Remove a named field from a JSON body (any depth, by its leaf name) or a form. */
function dropField(body, name) {
  const leaf = name.split('.').pop();
  if (body instanceof FormData) { body.delete(leaf); body.delete(`${leaf}[]`); return; }
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    for (const k of Object.keys(o)) { if (k === leaf) delete o[k]; else walk(o[k]); }
  };
  walk(body);
}

const plain = (f) => {
  if (f.status === 401 || f.status === 403) return new VoiceProviderError('voice_unavailable', 'Voice is not set up correctly on this server.', `${f.status}: ${f.message}`, 503);
  if (f.status === 429) return new VoiceProviderError('voice_unavailable', 'Voice is busy right now. Try again in a moment, or type it.', `429: ${f.message}`, 503);
  if (f.status === 413) return new VoiceProviderError('voice_unavailable', 'That recording is too long to send. Try a shorter one.', `413: ${f.message}`, 413);
  return new VoiceProviderError('voice_unavailable', "Epic couldn't hear that just now. Try again, or type it.", `${f.status}: ${f.message}`, 502);
};

// ---------------------------------------------------------------------------
// stage one — the file endpoint
// ---------------------------------------------------------------------------

/** The vocabulary hint, kept to what the provider will take. Never an instruction about style (the brief). */
const trimHint = (hint) => (hint ? String(hint).replace(/\s+/g, ' ').trim().slice(0, 900) : '');

/**
 * Transcribe one recording.
 *
 * `hint` and `keywords` are for accuracy only — place names and the household's
 * own words, so "Sintra" arrives as Sintra. The prompt is never used to ask for
 * tidier output; the transcript is the evidence stage two works from.
 * `language` is passed when known (it improves accuracy and latency) and left
 * out when not, so the provider detects it: nothing here assumes English.
 *
 * `stream` asks for the answer as it is written. The whole file still uploads
 * first, so this is not captions — it is the same answer arriving sooner for a
 * long recording. `onDelta(text)` is called with each piece; the resolved value
 * is the same either way.
 */
export async function transcribe({ audio, mime, filename, language = null, hint = '', keywords = [], stream = false, onDelta = null, signal = null, model = null } = {}) {
  if (!openaiEnabled()) throw notConfigured();
  if (!audio?.length) throw new VoiceProviderError('voice_empty', 'Nothing was recorded.', null, 400);
  const ladder = model ? [model] : FILE_LADDER;
  const started = Date.now();
  const dropped = new Set(); // optional fields a model refused: sent without them from then on
  const refusals = [];       // and what it said about each, for the probe
  for (let i = 0; i < ladder.length; i += 1) {
    const m = ladder[i];
    const form = new FormData();
    form.append('file', new Blob([audio], { type: mime || 'application/octet-stream' }), filename || fileNameFor(mime));
    form.append('model', m);
    form.append('temperature', '0');
    form.append('response_format', 'json');
    const h = trimHint(hint);
    if (h) form.append('prompt', h);
    if (language) {
      // gpt-transcribe takes a list; the 4o family and whisper take one code.
      if (m.startsWith('gpt-transcribe') && !dropped.has('languages')) form.append('languages[]', language);
      else form.append('language', language);
    }
    if (keywords?.length && m.startsWith('gpt-transcribe')) for (const k of keywords.slice(0, 40)) form.append('keywords[]', String(k));
    if (stream) form.append('stream', 'true');
    for (const d of dropped) dropField(form, d);

    let res;
    try {
      res = await fetch(`${BASE}/audio/transcriptions`, { method: 'POST', headers: headers(), body: form, signal });
    } catch (err) {
      if (signal?.aborted) throw new VoiceProviderError('voice_cancelled', 'Cancelled.', null, 499);
      throw new VoiceProviderError('voice_unavailable', "Epic couldn't reach its voice service. Check the signal and try again.", err.message, 503);
    }
    if (!res.ok) {
      const f = await failure(res);
      const field = isParamRefusal(f) ? refusedField(f) : null;
      if (field && !dropped.has(field) && dropped.size < 4) { dropped.add(field); refusals.push({ field, said: f.message }); i -= 1; continue; }
      if (isModelRefusal(f) && i < ladder.length - 1) continue;
      throw plain(f);
    }
    const out = await readTranscript(res, stream ? onDelta : null);
    return { ...out, model: m, ms: Date.now() - started, fellBack: m !== ladder[0], dropped: [...dropped], refusals };
  }
  throw new VoiceProviderError('voice_unavailable', "Epic couldn't hear that just now. Try again, or type it.", 'no transcription model answered');
}

const fileNameFor = (mime = '') => {
  if (/webm/.test(mime)) return 'speech.webm';
  if (/mp4|m4a|aac/.test(mime)) return 'speech.m4a';
  if (/ogg|opus/.test(mime)) return 'speech.ogg';
  if (/wav/.test(mime)) return 'speech.wav';
  if (/mpeg|mp3/.test(mime)) return 'speech.mp3';
  return 'speech.webm';
};

/**
 * The answer, by what it is rather than by what was asked for: a JSON object
 * with `text`, or a stream of events. Judged on the content type and then on
 * the body itself, because a provider that answers a streamed request with a
 * plain object (or the reverse) should still be read.
 */
async function readTranscript(res, onDelta) {
  const type = res.headers.get('content-type') || '';
  if (/text\/event-stream/i.test(type)) return readTranscriptStream(res, onDelta);
  const text = await res.text();
  const trimmed = text.trimStart();
  if (trimmed.startsWith('data:') || trimmed.startsWith('event:')) return readTranscriptStream(new Response(text), onDelta);
  let j = {};
  try { j = JSON.parse(text); } catch { /* not json */ }
  return { text: String(j.text ?? '').trim(), language: languageOf(j), usage: j.usage ?? null };
}

/** `gpt-transcribe` says which languages it heard; whisper's verbose form says one. */
const languageOf = (j) => j?.languages?.[0]?.code ?? j?.language ?? null;

/**
 * The streamed form: `transcript.text.delta` pieces, then `transcript.text.done`
 * with the whole text. The pieces are handed on as they arrive; the done event
 * is what is returned, and if it never comes the pieces are joined instead.
 */
export async function readTranscriptStream(res, onDelta) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let pieces = '';
  let segments = '';
  let done = null;
  const seen = new Set();
  // One event per `data:` line. The standard allows an event's data to span
  // several lines, but the provider writes one JSON object per line — and
  // joining lines that are each whole objects makes something nothing can
  // parse (the first deployed run read 13 s of speech into "", 8 Sep 2026).
  const handle = (raw) => {
    for (const line of raw.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let ev;
      try { ev = JSON.parse(data); } catch { continue; }
      event(ev);
    }
  };
  const event = (ev) => {
    const type = String(ev.type ?? '');
    seen.add(type);
    // Judged by shape as much as by name: a `.delta` with a delta is a piece,
    // a `.done`/`.completed` with text is the whole, a `.segment` is a part of
    // a transcript that never streams pieces (the diarising models).
    if (typeof ev.delta === 'string' && /delta$/.test(type)) { pieces += ev.delta; onDelta?.(ev.delta); }
    else if (typeof ev.text === 'string' && /(done|completed)$/.test(type)) done = ev;
    else if (typeof ev.text === 'string' && /segment$/.test(type)) { segments = [segments, ev.text].filter(Boolean).join(' '); onDelta?.(`${segments ? ' ' : ''}${ev.text}`); }
    else if (type === 'error') throw plain({ status: 502, message: ev.error?.message ?? 'stream error', code: ev.error?.code ?? null });
  };
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    // Normalised over the whole buffer, not the chunk: a \r\n split across two
    // reads would otherwise hide the blank line between events (Codex review).
    buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
    let at;
    while ((at = buffer.indexOf('\n\n')) >= 0) { handle(buffer.slice(0, at)); buffer = buffer.slice(at + 2); }
  }
  if (buffer.trim()) handle(buffer);
  return { text: String(done?.text ?? pieces ?? segments).trim() || segments.trim(), language: languageOf(done), usage: done?.usage ?? null, events: [...seen] };
}

// ---------------------------------------------------------------------------
// stage one — the live session
// ---------------------------------------------------------------------------

/**
 * A client secret for one Realtime transcription session.
 *
 * The browser connects to OpenAI itself with this — that is the only way to
 * get words as they are spoken without routing every audio frame through our
 * own server — and the secret is all it gets: ten minutes to connect, one
 * session, nothing else the key can do. The standing key stays here.
 *
 * Server-side voice activity detection is on so the provider decides where a
 * phrase ends; the app keeps listening regardless, until Done (CLAUDE.md: never
 * send on the first pause). `expires_after` is the connect window, not the
 * session's length.
 */
export async function mintLiveToken({ language = null, hint = '', keywords = [], seconds = 120, model = null } = {}) {
  if (!openaiEnabled()) throw notConfigured();
  const ladder = model ? [model] : LIVE_LADDER;
  const dropped = new Set();
  const refusals = [];
  for (let i = 0; i < ladder.length; i += 1) {
    const m = ladder[i];
    const transcription = { model: m };
    const h = trimHint(hint);
    if (h) transcription.prompt = h;
    if (language) { if ((m.startsWith('gpt-live') || m.startsWith('gpt-transcribe')) && !dropped.has('languages')) transcription.languages = [language]; else transcription.language = language; }
    if (keywords?.length && (m.startsWith('gpt-live') || m.startsWith('gpt-transcribe'))) transcription.keywords = keywords.slice(0, 40).map(String);
    const input = {
      format: { type: 'audio/pcm', rate: 24000 },
      transcription,
      noise_reduction: { type: 'near_field' },
    };
    // `gpt-live-transcribe` finds the turns itself and refuses to be told
    // ("Turn detection is not supported for this transcription model", seen on
    // the deployed probe, 8 Sep 2026); asking cost a refused round trip on
    // every tap of the mic. The older models still want to be told.
    if (!m.startsWith('gpt-live')) input.turn_detection = { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500 };
    const body = {
      expires_after: { anchor: 'created_at', seconds: Math.min(600, Math.max(10, seconds)) },
      session: { type: 'transcription', audio: { input } },
    };
    for (const d of dropped) dropField(body, d);
    let res;
    try {
      res = await fetch(`${BASE}/realtime/client_secrets`, { method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify(body) });
    } catch (err) {
      throw new VoiceProviderError('voice_unavailable', "Epic couldn't reach its voice service. Check the signal and try again.", err.message, 503);
    }
    if (!res.ok) {
      const f = await failure(res);
      const field = isParamRefusal(f) ? refusedField(f) : null;
      if (field && !dropped.has(field) && dropped.size < 4) { dropped.add(field); refusals.push({ field, said: f.message }); i -= 1; continue; }
      if (isModelRefusal(f) && i < ladder.length - 1) continue;
      throw plain(f);
    }
    const j = await res.json();
    return {
      refusals,
      token: j.value,
      expiresAt: j.expires_at ? new Date(j.expires_at * 1000).toISOString() : null,
      model: m,
      url: LIVE_URL,
      sampleRate: 24000,
      fellBack: m !== ladder[0],
      dropped: [...dropped],
    };
  }
  throw new VoiceProviderError('voice_unavailable', "Epic couldn't start listening just now. Try again, or type it.", 'no live model answered');
}

// ---------------------------------------------------------------------------
// stage two — structured extraction
// ---------------------------------------------------------------------------

/**
 * One transcript in, one object out, against a strict schema.
 *
 * The Responses API with `text.format = json_schema, strict: true`: every field
 * required, `additionalProperties: false`, "not said" as a `null` union. A
 * refusal is a 422 with the provider's sentence kept for the back office; an
 * answer that does not parse is a 502, because a plan built from half an
 * object is worse than no plan.
 */
export async function extract({ system, input, schema, name = 'answer', model = PLAN_MODEL, signal = null } = {}) {
  if (!openaiEnabled()) throw notConfigured();
  const started = Date.now();
  // Reading a form out of a sentence is not a reasoning problem: with the
  // default effort gpt-5-mini took eighteen seconds on the first deployed run
  // (8 Sep 2026), which is the whole "time from stopping speaking to plan
  // appearing" budget and more. Minimal effort and short prose; a model that
  // does not take either has the field dropped and is asked again.
  const body = {
    model,
    instructions: system,
    input,
    text: { format: { type: 'json_schema', name, schema, strict: true }, verbosity: 'low' },
    reasoning: { effort: 'minimal' },
    store: false,
  };
  let res;
  let j;
  for (let attempt = 0; ; attempt += 1) {
    try {
      res = await fetch(`${BASE}/responses`, { method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify(body), signal });
    } catch (err) {
      if (signal?.aborted) throw new VoiceProviderError('voice_cancelled', 'Cancelled.', null, 499);
      throw new VoiceProviderError('voice_unavailable', "Epic couldn't reach its planning service. Check the signal and try again.", err.message, 503);
    }
    if (res.ok) { j = await res.json(); break; }
    const f = await failure(res);
    const field = isParamRefusal(f) ? refusedField(f) : null;
    if (field && attempt < 3) { dropField(body, field); continue; }
    throw plain(f);
  }
  const message = (j.output || []).find((o) => o.type === 'message');
  const content = message?.content || [];
  const refusal = content.find((c) => c.type === 'refusal');
  if (refusal) throw new VoiceProviderError('voice_refused', "Epic couldn't make a plan from that.", refusal.refusal, 422);
  const text = j.output_text ?? content.find((c) => c.type === 'output_text')?.text ?? '';
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    throw new VoiceProviderError('voice_unavailable', "Epic couldn't make sense of that just now. Try again.", `unparseable: ${String(text).slice(0, 200)}`, 502);
  }
  return { parsed, usage: j.usage ?? null, model: j.model ?? model, ms: Date.now() - started };
}
