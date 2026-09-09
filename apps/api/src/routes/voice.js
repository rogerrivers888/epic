/**
 * Voice: the two stages, and the lab that compares the ways of doing the first.
 *
 * The owner's brief (8 Sep 2026) fixes what these routes are:
 *
 *   POST /api/voice/transcribe   audio in, a faithful transcript out
 *   POST /api/voice/plan         transcript in, structured intent out
 *
 * and how they are guarded: the provider key lives here and only here, every
 * call is attributed in `provider_calls`, and there is a per-household rate
 * limit and a spend cap from day one — the household's monthly minutes of
 * speech (`EPIC_VOICE_MINUTES_MONTHLY`), on top of the estate's call bounds
 * that every paid provider is already held to (`assertWithinBounds`).
 *
 * Two more, for the third way of hearing:
 *
 *   POST /api/voice/live-token   a one-session client secret for captions
 *   POST /api/voice/live-used    the seconds that session ran, for the ledger
 *
 * The audio is never written anywhere. It arrives as the request body, goes to
 * the provider from memory, and is gone when the response is sent. The
 * transcript is not stored either, except in the lab (`/api/admin/voice`),
 * where the household's own words are kept against the sentence they read so
 * the modes can be compared — see migration 074.
 */

import express from 'express';
import { z } from 'zod/v4';
import { query } from '../db.js';
import { requires } from '../access.js';
import { assertWithinBounds } from '../claude.js';
import { currentHousehold, loadMembers } from './household.js';
import * as providerCalls from '../repositories/providerCalls.js';
import { sourceOff } from '../sources/index.js';
import {
  LIVE_MODEL, PLAN_MODEL, TRANSCRIBE_MODEL, VOICE_MINUTES_MONTHLY, VoiceProviderError,
  extract, minuteCost, mintLiveToken, openaiEnabled, tokenCost, transcribe,
} from '../sources/openai.js';
import { VOICE_INTENT_SCHEMA, VOICE_INTENT_SYSTEM, normaliseVoiceIntent, voiceIntentInput } from '../domain/voiceIntent.js';
import { UTTERANCES, meetsExpectation } from '../domain/voiceUtterances.js';
import { planDiff, wer } from '../domain/wer.js';
import {
  TRIP_FACTS_SCHEMA, TRIP_FACTS_SYSTEM, TRIP_TO_MODE, harvestOffer, holdWeekday, mergeTripFacts, normaliseTripFacts,
  resolveIntake, resultsHref, tripDraft, tripFactsInput,
} from '../domain/voiceFacts.js';
import {
  FOOD_SCHEMA, FOOD_SYSTEM, LIKES_SCHEMA, LIKES_SYSTEM, WHO_SCHEMA, WHO_SYSTEM,
  applyFood, applyLikes, likesVocabularyText, normaliseFood, normaliseLikes, normaliseWho,
} from '../domain/voiceHousehold.js';
import { searchAreas } from '../sources/areas.js';
import { kmBetween } from '../domain/travel.js';
import { geocode } from '../sources/geocode.js';
import { taxonomy } from '../repositories/shelfTaxonomy.js';
import * as households from '../repositories/households.js';

export const router = express.Router();
export const adminRouter = express.Router();

// ---------------------------------------------------------------------------
// the purse
// ---------------------------------------------------------------------------

export { VOICE_MINUTES_MONTHLY };
/** Live sessions a household may open in a day: a token is a paid minute waiting to happen. */
export const VOICE_LIVE_SESSIONS_DAILY = Number(process.env.EPIC_VOICE_LIVE_SESSIONS_DAILY || 60);
/** The longest one recording may be. The research's soft cap is two minutes; this is the hard one. */
export const VOICE_MAX_SECONDS = Number(process.env.EPIC_VOICE_MAX_SECONDS || 300);
const MAX_BYTES = 25 * 1024 * 1024;
const PROVIDER = 'openai';
const UNIT = 'openai-minutes';

const audioMimes = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/aac', 'audio/x-m4a', 'audio/m4a', 'video/mp4', 'video/webm', 'application/octet-stream'];

const refuse = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });

/** The session id a call is attributed to: the planner's when there is one, else the sign-in session. */
const sessionOf = (req, given) => (typeof given === 'string' && given.trim() ? given.trim().slice(0, 80) : req.session?.id ?? null);

/** Is voice open for business at all: a key, and the owner's switch on. */
function assertVoiceOn() {
  if (!openaiEnabled()) throw new VoiceProviderError('voice_not_configured', 'Voice is not set up on this server yet.', 'OPENAI_API_KEY is not set', 503);
  if (sourceOff(PROVIDER)) throw new VoiceProviderError('voice_switched_off', 'Voice is switched off in Settings › Providers.', null, 503);
}

/** The month's minutes so far, and a refusal when another `seconds` would pass the cap. */
async function assertMinutes(householdId, seconds) {
  const used = await providerCalls.unitsOfPurpose(householdId, PROVIDER, 'speech.%', UNIT);
  if (used + seconds / 60 > VOICE_MINUTES_MONTHLY) {
    throw refuse(429, 'voice_minutes_reached', `This household has used its ${VOICE_MINUTES_MONTHLY} minutes of voice for the month. Typing still works.`, { used: Math.round(used * 10) / 10, bound: VOICE_MINUTES_MONTHLY });
  }
  return used;
}

/**
 * The words the recogniser is told to expect: the household's people, its home,
 * the places it has kept and the trips it has named. Accuracy only — never a
 * request for tidier output (the brief) — and only the household's own words,
 * never a provider's.
 */
export async function vocabularyFor(household) {
  const [members, trips, places] = await Promise.all([
    loadMembers(household.id).catch(() => []),
    query('select title, destination_label, base_label, locality from trips where household_id = $1 order by created_at desc limit 12', [household.id]).then((r) => r.rows).catch(() => []),
    query('select label from household_places where household_id = $1 order by last_seen desc nulls last limit 30', [household.id]).then((r) => r.rows).catch(() => []),
  ]);
  const seen = new Set();
  const keep = (v) => { const t = String(v ?? '').trim(); if (t && t.length <= 60 && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); return t; } return null; };
  const names = members.map((m) => keep(m.name)).filter(Boolean);
  const placeWords = [household.home_label, ...trips.flatMap((t) => [t.destination_label, t.base_label, t.locality, t.title]), ...places.map((p) => p.label)].map(keep).filter(Boolean);
  const keywords = [...names, ...placeWords].slice(0, 40);
  const hint = [
    'Somebody planning a trip or a day out: places, dates, who is coming, budget, food.',
    names.length ? `People: ${names.join(', ')}.` : '',
    placeWords.length ? `Places: ${placeWords.slice(0, 25).join(', ')}.` : '',
  ].filter(Boolean).join(' ');
  return { hint, keywords };
}

// ---------------------------------------------------------------------------
// what the app needs to know before it records
// ---------------------------------------------------------------------------

/**
 * GET /config — the limits, from the one place they are set.
 *
 * The app taps Done for the household at the recording limit rather than lose
 * five minutes of talking to a 413, and that number has to be this server's
 * number, not a copy of its default (Codex review, 8 Sep 2026).
 */
router.get('/config', (req, res) => {
  res.json({ configured: openaiEnabled() && !sourceOff(PROVIDER), maxSeconds: VOICE_MAX_SECONDS, minutesMonthly: VOICE_MINUTES_MONTHLY, liveSessionsDaily: VOICE_LIVE_SESSIONS_DAILY });
});

// ---------------------------------------------------------------------------
// stage one
// ---------------------------------------------------------------------------

/**
 * POST /transcribe — the recording as the request body (`content-type:
 * audio/webm` or whatever the browser produced), the settings as the query:
 *
 *   ?language=pt     ISO-639-1 when known; left out, the provider detects it
 *   ?seconds=12.4    the recording's length, from the device's own clock
 *   ?stream=1        answer as server-sent events while the provider writes
 *   ?sessionId=…     the planner session this speech belongs to
 *
 * Answers `{ transcript, language, model, ms, seconds, mode }`. With `stream`,
 * `event: delta` lines carry pieces and `event: done` carries the same object.
 */
router.post('/transcribe', express.raw({ type: audioMimes, limit: '25mb' }), async (req, res, next) => {
  try {
    assertVoiceOn();
    const household = await currentHousehold();
    const audio = Buffer.isBuffer(req.body) ? req.body : null;
    if (!audio?.length) throw refuse(400, 'voice_empty', 'Nothing was recorded. Try again, or type it.');
    if (audio.length > MAX_BYTES) throw refuse(413, 'voice_too_long', 'That recording is too long to send. Try a shorter one.');
    const mime = String(req.headers['content-type'] || 'audio/webm').split(';')[0].trim();
    const seconds = Math.min(VOICE_MAX_SECONDS, Math.max(1, Number(req.query.seconds) || Math.ceil(audio.length / 4000)));
    if (Number(req.query.seconds) > VOICE_MAX_SECONDS) throw refuse(413, 'voice_too_long', `A recording can be up to ${Math.round(VOICE_MAX_SECONDS / 60)} minutes. Try a shorter one.`);
    const language = languageParam(req.query.language);
    const sessionId = sessionOf(req, req.query.sessionId);
    const stream = req.query.stream === '1' || req.query.stream === 'true';

    await assertWithinBounds({ householdId: household.id, sessionId });
    await assertMinutes(household.id, seconds);
    const { hint, keywords } = await vocabularyFor(household);

    const finish = async (out) => {
      await providerCalls.recordMetered({
        householdId: household.id, sessionId, provider: PROVIDER,
        purpose: stream ? 'speech.transcribe.stream' : 'speech.transcribe',
        units: { [UNIT]: Math.round((seconds / 60) * 1000) / 1000 },
        costUsd: minuteCost(out.model, seconds),
      });
      return { transcript: out.text, language: out.language ?? language ?? null, model: out.model, fellBack: out.fellBack, dropped: out.dropped, events: out.events, ms: out.ms, seconds, mode: stream ? 'stream' : 'batch' };
    };

    if (!stream) {
      const out = await transcribe({ audio, mime, language, hint, keywords });
      return res.json(await finish(out));
    }

    // Server-sent events: the pieces as they come, then the whole thing.
    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('x-accel-buffering', 'no');
    res.flushHeaders?.();
    const send = (event, data) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    const abort = new AbortController();
    req.on('close', () => { if (!res.writableEnded) abort.abort(); });
    try {
      const out = await transcribe({ audio, mime, language, hint, keywords, stream: true, signal: abort.signal, onDelta: (delta) => send('delta', { text: delta }) });
      send('done', await finish(out));
    } catch (err) {
      if (err?.code !== 'voice_cancelled') send('error', { error: err.code || 'voice_unavailable', message: err.message });
    }
    res.end();
  } catch (err) { next(err); }
});

/**
 * POST /live-token — `{ language?, sessionId? }` → a client secret for one
 * Realtime transcription session, and where to connect with it.
 *
 * Counted as a session opened, against the day's allowance; the minutes it
 * runs are reported afterwards by `/live-used`, because the browser talks to
 * the provider directly and this process never sees the audio.
 */
router.post('/live-token', async (req, res, next) => {
  try {
    assertVoiceOn();
    const household = await currentHousehold();
    const body = z.object({ language: z.string().max(8).nullish(), sessionId: z.string().max(80).nullish() }).parse(req.body ?? {});
    const language = languageParam(body.language);
    const sessionId = sessionOf(req, body.sessionId);
    await assertWithinBounds({ householdId: household.id, sessionId });
    await assertMinutes(household.id, 30);
    const opened = await providerCalls.countOfPurpose(household.id, PROVIDER, 'speech.live.start', 'day');
    if (opened >= VOICE_LIVE_SESSIONS_DAILY) throw refuse(429, 'voice_sessions_reached', 'That is a lot of listening for one day. Recording still works: Epic writes it down when you tap Done.', { used: opened, bound: VOICE_LIVE_SESSIONS_DAILY });
    const { hint, keywords } = await vocabularyFor(household);
    const token = await mintLiveToken({ language, hint, keywords, seconds: 120 });
    await providerCalls.recordMetered({ householdId: household.id, sessionId, provider: PROVIDER, purpose: 'speech.live.start', units: { 'openai-live-sessions': 1 }, costUsd: 0 });
    const { refusals: _refusals, ...safe } = token;
    res.json({ ...safe, language, maxSeconds: VOICE_MAX_SECONDS });
  } catch (err) { next(err); }
});

/**
 * POST /live-used — `{ seconds, sessionId?, model? }` when a live session ends.
 *
 * The browser's own count of how long it streamed; not to be trusted for
 * billing (the provider's console is the invoice) but enough for the purse and
 * the Settings spend table. Capped per report so a wrong clock cannot spend a
 * month in one line.
 */
router.post('/live-used', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const body = z.object({ seconds: z.number().min(0), sessionId: z.string().max(80).nullish(), model: z.string().max(60).nullish() }).parse(req.body ?? {});
    // Not capped at the recording limit: a session that ran long was billed in
    // full and the ledger must say so (Codex review, 8 Sep 2026). The browser
    // ends a session at the limit itself (voice/live.ts); this is the sanity
    // bound on a wrong clock — one hour, the longest a Realtime session lives.
    const seconds = Math.min(3600, Math.round(body.seconds));
    if (seconds < 1) return res.json({ recorded: false });
    const model = body.model && /^[a-z0-9.-]+$/i.test(body.model) ? body.model : LIVE_MODEL;
    await providerCalls.recordMetered({
      householdId: household.id, sessionId: sessionOf(req, body.sessionId), provider: PROVIDER, purpose: 'speech.live',
      units: { [UNIT]: Math.round((seconds / 60) * 1000) / 1000 }, costUsd: minuteCost(model, seconds),
    });
    res.json({ recorded: true, seconds });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// stage two
// ---------------------------------------------------------------------------

/**
 * POST /plan — `{ transcript, language?, sessionId?, context? }` → `{ intent }`.
 *
 * Stage two, kept apart from stage one on purpose (the brief): the transcript
 * arrives as it was heard, and this is the one place a correction is resolved
 * or a doubt is raised. `context` is whatever the app knows that helps read
 * the words — the trip already open, a question that was asked — and is
 * passed through as it is.
 */
router.post('/plan', async (req, res, next) => {
  try {
    assertVoiceOn();
    const household = await currentHousehold();
    const body = z.object({
      transcript: z.string().min(1).max(8000),
      language: z.string().max(8).nullish(),
      sessionId: z.string().max(80).nullish(),
      context: z.record(z.string(), z.unknown()).nullish(),
    }).parse(req.body ?? {});
    const sessionId = sessionOf(req, body.sessionId);
    await assertWithinBounds({ householdId: household.id, sessionId });
    const out = await readIntent({ household, transcript: body.transcript, language: languageParam(body.language), context: body.context ?? null, sessionId });
    res.json(out);
  } catch (err) { next(err); }
});

async function readIntent({ household, transcript, language, context, sessionId, purpose = 'speech.plan' }) {
  const members = await loadMembers(household.id).catch(() => []);
  const timezone = household.timezone || 'Europe/London';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  const input = voiceIntentInput({ transcript, language, today, timezone, home: household.home_label, members: members.map((m) => m.name), context });
  const out = await extract({ system: VOICE_INTENT_SYSTEM, input, schema: VOICE_INTENT_SCHEMA, name: 'voice_intent', model: PLAN_MODEL });
  await providerCalls.recordTokens({
    householdId: household.id, sessionId, provider: PROVIDER, purpose,
    inputTokens: out.usage?.input_tokens ?? null, outputTokens: out.usage?.output_tokens ?? null,
    costUsd: tokenCost(PLAN_MODEL, out.usage),
  });
  return { intent: normaliseVoiceIntent(out.parsed), model: out.model, ms: out.ms };
}

const languageParam = (v) => {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return /^[a-z]{2}(-[a-z]{2})?$/.test(s) && s !== 'auto' ? s : null;
};

// ---------------------------------------------------------------------------
// the lab (back office)
// ---------------------------------------------------------------------------

/** GET /utterances — the sentences to read, and what the app is set to. */
adminRouter.get('/utterances', requires('manage_settings'), (req, res) => {
  res.json({
    utterances: UTTERANCES,
    models: { transcribe: TRANSCRIBE_MODEL, live: LIVE_MODEL, plan: PLAN_MODEL },
    configured: openaiEnabled(),
    switchedOff: sourceOff(PROVIDER),
    caps: { minutesMonthly: VOICE_MINUTES_MONTHLY, liveSessionsDaily: VOICE_LIVE_SESSIONS_DAILY, maxSeconds: VOICE_MAX_SECONDS },
  });
});

/**
 * GET /probe — can the live session be opened at all, and if not, why.
 *
 * The household's screens say "Epic couldn't hear that just now" and nothing
 * more (owner, 5 Sep 2026); this is where the provider's own sentence belongs.
 * Mints one client secret and discards it, and tries the file endpoint on a
 * fifth of a second of silence, so a wrong model name, a refused parameter or
 * a key on the wrong project reads as a sentence here rather than a guess.
 */
adminRouter.get('/probe', requires('manage_settings'), async (req, res, next) => {
  const out = { configured: openaiEnabled(), switchedOff: sourceOff(PROVIDER), live: null, transcribe: null };
  if (!out.configured || out.switchedOff) return res.json(out);
  try {
    // A check spends like a call, and is bounded and written down like one.
    const household = await currentHousehold();
    const sessionId = sessionOf(req, null);
    await assertWithinBounds({ householdId: household.id, sessionId });
    await assertMinutes(household.id, 1);
    try {
      const t = await mintLiveToken({ language: 'en', seconds: 10 });
      await providerCalls.recordMetered({ householdId: household.id, sessionId, provider: PROVIDER, purpose: 'speech.live.start.probe', units: { 'openai-live-sessions': 1 }, costUsd: 0 });
      out.live = { ok: true, model: t.model, url: t.url, fellBack: t.fellBack, dropped: t.dropped, refusals: t.refusals };
    } catch (err) { out.live = { ok: false, code: err.code, message: err.message, detail: err.detail ?? null }; }
    try {
      const o = await transcribe({ audio: silentWav(0.2), mime: 'audio/wav', language: 'en' });
      await providerCalls.recordMetered({ householdId: household.id, sessionId, provider: PROVIDER, purpose: 'speech.transcribe.probe', units: { [UNIT]: 0.004 }, costUsd: minuteCost(o.model, 0.2) });
      out.transcribe = { ok: true, model: o.model, fellBack: o.fellBack, dropped: o.dropped, refusals: o.refusals, ms: o.ms };
    } catch (err) { out.transcribe = { ok: false, code: err.code, message: err.message, detail: err.detail ?? null }; }
    res.json(out);
  } catch (err) { next(err); }
});

/** A WAV of nothing, for the probe: 16 kHz, mono, 16-bit. */
function silentWav(seconds) {
  const rate = 16000;
  const n = Math.round(rate * seconds);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  return buf;
}

/**
 * POST /runs — one utterance, heard every way, judged and kept.
 *
 * The browser did the hearing (it has the microphone); this does the judging:
 * word error rate of each transcript against the reference, live against
 * batch for the disagreement, stage two on each transcript, and whether the
 * plans differ. Stage two runs here rather than in the browser so the lab
 * spends through the same purse as the app.
 */
adminRouter.post('/runs', requires('manage_settings'), async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const Result = z.object({ transcript: z.string().max(8000).nullish(), ms: z.number().nullish(), model: z.string().max(60).nullish(), error: z.string().max(400).nullish() });
    const body = z.object({
      utteranceId: z.string().max(60).nullish(),
      reference: z.string().max(4000).nullish(),
      language: z.string().max(8).nullish(),
      mode: z.string().max(20).nullish(),
      results: z.object({ live: Result.nullish(), batch: Result.nullish(), stream: Result.nullish() }),
      edited: z.string().max(8000).nullish(),
      device: z.string().max(200).nullish(),
      sessionId: z.string().max(80).nullish(),
      plan: z.boolean().default(true),
    }).parse(req.body ?? {});
    const sessionId = sessionOf(req, body.sessionId);
    const utterance = body.utteranceId ? UTTERANCES.find((u) => u.id === body.utteranceId) : null;
    const reference = body.reference ?? utterance?.text ?? null;
    const language = languageParam(body.language) ?? utterance?.language ?? null;

    const modes = ['live', 'batch', 'stream'];
    const results = {};
    for (const m of modes) {
      const r = body.results[m];
      if (r) results[m] = { transcript: r.transcript?.trim() || null, ms: r.ms ?? null, model: r.model ?? null, error: r.error ?? null };
    }
    const accuracy = {};
    if (reference) for (const m of modes) if (results[m]?.transcript) accuracy[m] = wer(reference, results[m].transcript);
    const liveVsBatch = results.live?.transcript && results.batch?.transcript ? wer(results.batch.transcript, results.live.transcript).wer : null;

    // Stage two on every transcript that exists, one after another (the purse).
    const plans = {};
    if (body.plan && openaiEnabled() && !sourceOff(PROVIDER)) {
      for (const m of modes) {
        if (!results[m]?.transcript) continue;
        try {
          const out = await readIntent({ household, transcript: results[m].transcript, language, context: null, sessionId, purpose: 'speech.plan.lab' });
          plans[m] = { intent: out.intent, ms: out.ms, model: out.model, expectation: utterance ? meetsExpectation(out.intent, utterance.expect) : null };
        } catch (err) {
          plans[m] = { error: err.message, detail: err.detail ?? null };
        }
      }
    }
    const diff = plans.live?.intent && plans.batch?.intent ? planDiff(plans.live.intent, plans.batch.intent) : null;

    const { rows } = await query(
      `insert into voice_runs (household_id, session_id, utterance_id, reference, language, mode, results, accuracy, live_vs_batch, plans, plan_changed, plan_diff, edited, device, ran_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
      [household.id, sessionId, body.utteranceId ?? null, reference, language, body.mode ?? null, JSON.stringify(results), JSON.stringify(accuracy),
        liveVsBatch, JSON.stringify(plans), diff ? diff.changed : null, JSON.stringify(diff?.fields ?? []), body.edited ?? null, body.device ?? null,
        req.account?.email ?? 'the owner (passcode)'],
    );
    res.status(201).json({ run: rows[0] });
  } catch (err) { next(err); }
});

/**
 * GET /runs — the last runs and the tally the brief asks for: per mode, how
 * wrong and how slow; how often the captions and the recording disagreed; and
 * how often that disagreement changed the plan.
 */
adminRouter.get('/runs', requires('manage_settings'), async (req, res, next) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const { rows } = await query('select * from voice_runs order by created_at desc limit $1', [limit]);
    const modes = ['live', 'batch', 'stream'];
    const tally = {};
    for (const m of modes) {
      const wers = rows.map((r) => r.accuracy?.[m]?.wer).filter((v) => typeof v === 'number');
      const mss = rows.map((r) => r.results?.[m]?.ms).filter((v) => typeof v === 'number');
      const errors = rows.filter((r) => r.results?.[m]?.error).length;
      const heard = rows.filter((r) => r.results?.[m]?.transcript).length;
      const expected = rows.map((r) => r.plans?.[m]?.expectation?.ok).filter((v) => typeof v === 'boolean');
      tally[m] = {
        runs: heard, errors,
        meanWer: wers.length ? round(wers.reduce((a, b) => a + b, 0) / wers.length) : null,
        medianMs: mss.length ? median(mss) : null,
        planRight: expected.length ? round(expected.filter(Boolean).length / expected.length) : null,
      };
    }
    const both = rows.filter((r) => typeof r.live_vs_batch === 'number');
    const disagreed = both.filter((r) => r.live_vs_batch > 0);
    const judged = rows.filter((r) => typeof r.plan_changed === 'boolean');
    res.json({
      runs: rows,
      tally,
      agreement: {
        compared: both.length,
        disagreed: disagreed.length,
        disagreementRate: both.length ? round(disagreed.length / both.length) : null,
        meanLiveVsBatch: both.length ? round(both.reduce((a, r) => a + r.live_vs_batch, 0) / both.length) : null,
        planJudged: judged.length,
        planChanged: judged.filter((r) => r.plan_changed).length,
        planChangedRate: judged.length ? round(judged.filter((r) => r.plan_changed).length / judged.length) : null,
      },
    });
  } catch (err) { next(err); }
});

adminRouter.delete('/runs/:id', requires('manage_settings'), async (req, res, next) => {
  try {
    const { rowCount } = await query('delete from voice_runs where id = $1', [req.params.id]);
    res.json({ removed: rowCount > 0 });
  } catch (err) { next(err); }
});

const round = (n) => Math.round(n * 1000) / 1000;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const mid = Math.floor(s.length / 2); return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2); };

// ---------------------------------------------------------------------------
// the intake: a spoken request read into facts (handoff, 8 Sep 2026)
// ---------------------------------------------------------------------------

const FLOWS = ['first', 'returning', 'inspire'];
const MODES = ['said', 'steps', 'typed'];
const WIZARD = {
  1: 'Where from, and how far?', 2: 'Who’s going, and what’s the mood?', 3: 'Anything on food?',
};

/** The household's standing answers, for the slots that were not said. */
async function profileFor(household, members) {
  // `loadMembers` already gathers each person's rows as allergens / diets / dislikes / likes.
  const diets = [...new Set(members.flatMap((m) => (m.diets ?? []).map((c) => c.value)))];
  const allergens = [...new Set(members.flatMap((m) => (m.allergens ?? []).map((c) => c.value)))];
  let travelMode = household.travel_mode ? TRIP_TO_MODE[household.travel_mode] ?? null : null;
  if (!travelMode) {
    const last = await query('select travel_mode from trips where household_id = $1 order by created_at desc limit 1', [household.id]).then((r) => r.rows[0]?.travel_mode).catch(() => null);
    if (last) travelMode = TRIP_TO_MODE[last] ?? null;
  }
  return { diets, allergens, travelMode, maxMinutes: household.max_travel_minutes ?? null };
}

/** The profile is complete enough to do the talking: home, people, a range. */
const profileComplete = (household, members) => Boolean(household.home_lat != null && members.length && (household.travel_mode || household.max_travel_minutes));

/** A named place → a point, through the area search (a town, never a street). */
async function pointFor(text, home, { attraction = false } = {}) {
  if (!text) return null;
  const shape = (p) => ({ lat: p.lat, lng: p.lng, label: p.label ?? text, locality: p.locality ?? null, countryCode: p.countryCode ?? null });
  // A town is an area; a castle is a place. Asking the area search for
  // "Windsor Castle" answered with somewhere 122 hours' drive away (9 Sep 2026).
  const tries = attraction ? [() => geocode(text, { limit: 1, near: home }), () => searchAreas(text, { limit: 1, near: home })] : [() => searchAreas(text, { limit: 1, near: home }), () => geocode(text, { limit: 1, near: home })];
  let best = null;
  for (const t of tries) {
    const [hit] = await t().catch(() => []);
    if (hit?.lat == null) continue;
    // The first answer is taken unless it is a long way off and the other
    // lookup knows somewhere nearer by the same name — a holiday to New York
    // stays New York; "Windsor Castle" stops being a farm in another country.
    if (!best) { best = hit; if (!home || kmBetween(home, hit) < 500) break; continue; }
    if (home && kmBetween(home, hit) < kmBetween(home, best)) best = hit;
  }
  return best ? shape(best) : null;
}

/** Everything a screen draws for one intake row. */
async function intakePayload(row, household, members) {
  const timezone = household.timezone || 'Europe/London';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  const profile = await profileFor(household, members);
  const home = household.home_lat != null ? { label: household.home_label, lat: household.home_lat, lng: household.home_lng } : null;
  const facts = row.facts;
  const first = resolveIntake({ facts, overrides: row.overrides, answers: row.answers, flow: row.flow, household, members, profile, today, timezone });
  // The destination as a point, once, so the journey and the results can use it.
  const namedPlace = first.resolved.wants.some((w) => w.kind === 'place' && w.name.toLowerCase() === String(first.resolved.destination ?? '').toLowerCase());
  const destinationPoint = first.resolved.destination ? await pointFor(first.resolved.destination, home, { attraction: namedPlace }) : null;
  const originPoint = first.resolved.origin?.kind === 'named' ? await pointFor(first.resolved.origin.name, home) : null;
  const out = destinationPoint ? resolveIntake({ facts, overrides: row.overrides, answers: row.answers, flow: row.flow, household, members, profile: { ...profile, destinationPoint }, today, timezone }) : first;
  const draft = tripDraft({ resolved: out.resolved, destinationPoint, members });
  return {
    id: row.id, flow: row.flow, mode: row.mode, language: row.language, asked: row.asked, tripId: row.trip_id,
    facts: out.facts, slots: out.slots, questions: out.questions, ambiguities: out.ambiguities,
    resolved: out.resolved, tripType: out.tripType,
    resultsHref: resultsHref({ resolved: out.resolved, intakeId: row.id, originPoint, destinationPoint, memberCount: members.length, flow: row.flow }),
    tripDraft: draft, destinationPoint,
    harvest: row.harvested_at ? null : harvestOffer({ facts: out.facts, members, profile }),
    profileComplete: profileComplete(household, members),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function readTripFacts({ household, members, transcript, language, sessionId, page = null, previous = null, purpose = 'speech.intake' }) {
  const timezone = household.timezone || 'Europe/London';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  const input = tripFactsInput({ transcript, today, timezone, home: household.home_label, members, page, previous });
  const out = await extract({ system: TRIP_FACTS_SYSTEM, input, schema: TRIP_FACTS_SCHEMA, name: 'trip_facts', model: PLAN_MODEL });
  await providerCalls.recordTokens({
    householdId: household.id, sessionId, provider: PROVIDER, purpose,
    inputTokens: out.usage?.input_tokens ?? null, outputTokens: out.usage?.output_tokens ?? null, costUsd: tokenCost(PLAN_MODEL, out.usage),
  });
  const facts = normaliseTripFacts(out.parsed);
  // "On Saturday" is held to the Saturday after the day it was said, once,
  // here — what is stored is what was meant, whenever it is read back.
  facts.when = holdWeekday(facts.when, today);
  return { facts, language: language ?? out.parsed?.language ?? null };
}

async function loadIntake(id, household) {
  const { rows } = await query('select * from voice_intakes where id = $1 and household_id = $2', [id, household.id]);
  return rows[0] ?? null;
}

/**
 * POST /intake — words in, an intake out.
 *
 *   { transcript, flow, mode, page?, intakeId?, language?, sessionId? }
 *
 * `flow` is the door (first / returning / inspire); `mode` how the words came
 * (said / steps / typed). With `intakeId` the reading is laid over an existing
 * intake — the wizard's next page, or "tap the mic to add more".
 */
router.post('/intake', async (req, res, next) => {
  try {
    assertVoiceOn();
    const household = await currentHousehold();
    const body = z.object({
      transcript: z.string().min(1).max(8000),
      flow: z.enum(FLOWS).default('first'),
      mode: z.enum(MODES).default('said'),
      page: z.number().int().min(1).max(3).nullish(),
      intakeId: z.string().uuid().nullish(),
      language: z.string().max(8).nullish(),
      sessionId: z.string().max(80).nullish(),
    }).parse(req.body ?? {});
    const sessionId = sessionOf(req, body.sessionId);
    await assertWithinBounds({ householdId: household.id, sessionId });
    const members = await loadMembers(household.id).catch(() => []);
    const existing = body.intakeId ? await loadIntake(body.intakeId, household) : null;
    const page = body.page ? { n: body.page, question: WIZARD[body.page] } : null;
    const { facts, language } = await readTripFacts({ household, members, transcript: body.transcript, language: languageParam(body.language), sessionId, page, previous: existing?.facts ?? null });
    const merged = existing ? mergeTripFacts(existing.facts, facts) : facts;
    const asked = body.flow === 'inspire' ? body.transcript.trim().replace(/\s+/g, ' ').slice(0, 140) : (existing?.asked ?? null);
    const row = existing
      ? (await query('update voice_intakes set facts = $2, language = coalesce($3, language), mode = $4, asked = coalesce($5, asked), updated_at = now() where id = $1 returning *', [existing.id, JSON.stringify(merged), language, body.mode, asked])).rows[0]
      : (await query('insert into voice_intakes (household_id, session_id, flow, mode, language, facts, asked) values ($1,$2,$3,$4,$5,$6,$7) returning *', [household.id, sessionId, body.flow, body.mode, language, JSON.stringify(merged), asked])).rows[0];
    res.status(existing ? 200 : 201).json({ intake: await intakePayload(row, household, members) });
  } catch (err) { next(err); }
});

/** GET /intake/for-trip/:tripId — the reading a trip was made from, for its ideas card (R4). */
router.get('/intake/for-trip/:tripId', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const { rows } = await query('select * from voice_intakes where trip_id = $1 and household_id = $2 order by created_at desc limit 1', [req.params.tripId, household.id]);
    if (!rows[0]) return res.json({ intake: null });
    res.json({ intake: await intakePayload(rows[0], household, await loadMembers(household.id).catch(() => [])) });
  } catch (err) { next(err); }
});

router.get('/intake/:id', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const row = await loadIntake(req.params.id, household);
    if (!row) return res.status(404).json({ error: 'not_found', message: 'That request is not here any more.' });
    res.json({ intake: await intakePayload(row, household, await loadMembers(household.id).catch(() => [])) });
  } catch (err) { next(err); }
});

/**
 * PATCH /intake/:id — a tap: `{ set: { slot: value } }` writes a chip's new value
 * over the facts; `{ answer: { slot: value|null } }` answers (or skips, with
 * null) a gap question; `{ tripId }` records the trip the card created.
 */
router.patch('/intake/:id', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const row = await loadIntake(req.params.id, household);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const body = z.object({
      set: z.record(z.string(), z.unknown()).nullish(),
      answer: z.record(z.string(), z.unknown()).nullish(),
      tripId: z.string().uuid().nullish(),
      harvested: z.boolean().nullish(),
    }).parse(req.body ?? {});
    const overrides = { ...row.overrides, ...(body.set ?? {}) };
    const answers = { ...row.answers, ...(body.answer ?? {}) };
    const { rows } = await query(
      `update voice_intakes set overrides = $2, answers = $3, trip_id = coalesce($4, trip_id), harvested_at = case when $5 then now() else harvested_at end, updated_at = now() where id = $1 returning *`,
      [row.id, JSON.stringify(overrides), JSON.stringify(answers), body.tripId ?? null, Boolean(body.harvested)],
    );
    res.json({ intake: await intakePayload(rows[0], household, await loadMembers(household.id).catch(() => [])) });
  } catch (err) { next(err); }
});

/**
 * POST /intake/:id/remember — the D1 card's "Yes, remember" and C4's "Remember
 * them": what a request taught us, written to the profile. Diets go on every
 * adult (they were said of "us"); children's ages go on children who lack one,
 * and children who do not exist yet are made, to be named on the Household tab.
 */
router.post('/intake/:id/remember', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const row = await loadIntake(req.params.id, household);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const members = await loadMembers(household.id).catch(() => []);
    const payload = await intakePayload(row, household, members);
    const offer = payload.harvest;
    const written = [];
    const adults = members.filter((m) => !m.isMinor);
    const children = members.filter((m) => m.isMinor);
    const year = new Date().getFullYear();
    for (const item of offer?.items ?? []) {
      if (item.kind === 'diet') {
        for (const d of item.values) for (const m of (adults.length ? adults : members)) {
          await households.upsertConstraint(m.id, { kind: 'diet', value: d.toLowerCase(), conceptKey: null, conceptKind: 'diet', favourite: false });
          written.push({ memberId: m.id, kind: 'diet', value: d });
        }
      }
      if (item.kind === 'kids') {
        const unaged = children.filter((c) => c.age == null);
        for (const k of item.ages) {
          const target = unaged.shift();
          if (target) { await households.updateMember(target.id, { birthYear: year - k.age }, household.id); written.push({ memberId: target.id, kind: 'age', value: k.age }); }
          else {
            const made = await households.insertMember(household.id, { name: k.name ?? `Child · ${k.age}`, isMinor: k.age < 13, relationship: 'child', birthYear: year - k.age });
            written.push({ memberId: made.id, kind: 'member', value: made.name });
          }
        }
      }
    }
    await query('update voice_intakes set harvested_at = now(), updated_at = now() where id = $1', [row.id]);
    res.json({ written, intake: await intakePayload({ ...row, harvested_at: new Date() }, household, await loadMembers(household.id).catch(() => [])) });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// the household, spoken (set-up row O; Option D)
// ---------------------------------------------------------------------------

async function readStructured({ household, sessionId, system, input, schema, name, purpose }) {
  const out = await extract({ system, input, schema, name, model: PLAN_MODEL });
  await providerCalls.recordTokens({
    householdId: household.id, sessionId, provider: PROVIDER, purpose,
    inputTokens: out.usage?.input_tokens ?? null, outputTokens: out.usage?.output_tokens ?? null, costUsd: tokenCost(PLAN_MODEL, out.usage),
  });
  return out.parsed;
}

/** POST /household/who — O3: "say everyone in one go" → people, not yet saved. */
router.post('/household/who', async (req, res, next) => {
  try {
    assertVoiceOn();
    const household = await currentHousehold();
    const body = z.object({ transcript: z.string().min(1).max(4000), sessionId: z.string().max(80).nullish() }).parse(req.body ?? {});
    const sessionId = sessionOf(req, body.sessionId);
    await assertWithinBounds({ householdId: household.id, sessionId });
    const members = await loadMembers(household.id).catch(() => []);
    const parsed = await readStructured({ household, sessionId, system: WHO_SYSTEM, input: `${members.length ? `Already in the household: ${members.map((m) => m.name).join(', ')}.\n` : ''}Transcript:\n${body.transcript}`, schema: WHO_SCHEMA, name: 'household_people', purpose: 'speech.household.who' });
    const people = normaliseWho(parsed).map((p) => ({ ...p, existingId: members.find((m) => m.name.toLowerCase() === p.name.toLowerCase())?.id ?? null }));
    res.json({ people });
  } catch (err) { next(err); }
});

/**
 * POST /household/who/apply — O3b's "Next": the reviewed people become members.
 * `{ people: [{ name, role, age?, band?, relationship?, isSpeaker, existingId? }] }`.
 */
router.post('/household/who/apply', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const body = z.object({ people: z.array(z.object({
      name: z.string().min(1).max(60), role: z.enum(['adult', 'child']).nullish(), age: z.number().int().min(0).max(120).nullish(),
      band: z.enum(['0-4', '5-8', '9-12', '13+']).nullish(), relationship: z.string().max(40).nullish(), isSpeaker: z.boolean().nullish(), existingId: z.string().uuid().nullish(),
    })).max(20) }).parse(req.body ?? {});
    const year = new Date().getFullYear();
    const bandAge = { '0-4': 3, '5-8': 6, '9-12': 10, '13+': 15 };
    const written = [];
    for (const p of body.people) {
      const age = p.age ?? (p.band ? bandAge[p.band] : null);
      const isChild = p.role === 'child' || (age != null && age < 18);
      const relationship = p.relationship && ['partner', 'child', 'parent', 'friend', 'other', 'self'].includes(p.relationship) ? p.relationship : isChild ? 'child' : p.isSpeaker ? 'self' : null;
      if (p.existingId) {
        const m = await households.updateMember(p.existingId, { name: p.name, birthYear: age != null ? year - age : null, relationship }, household.id);
        if (m) written.push({ id: m.id, name: m.name, updated: true });
      } else {
        const m = await households.insertMember(household.id, { name: p.name, isMinor: isChild && (age == null || age < 13), relationship, birthYear: age != null ? year - age : null });
        written.push({ id: m.id, name: m.name, updated: false });
      }
    }
    res.json({ members: await loadMembers(household.id), written });
  } catch (err) { next(err); }
});

/** POST /household/food — O4: diets, allergies, dislikes, favourites, scoped. Not yet saved. */
router.post('/household/food', async (req, res, next) => {
  try {
    assertVoiceOn();
    const household = await currentHousehold();
    const body = z.object({ transcript: z.string().min(1).max(4000), memberId: z.string().uuid().nullish(), sessionId: z.string().max(80).nullish() }).parse(req.body ?? {});
    const sessionId = sessionOf(req, body.sessionId);
    await assertWithinBounds({ householdId: household.id, sessionId });
    const members = await loadMembers(household.id).catch(() => []);
    const about = body.memberId ? members.find((m) => m.id === body.memberId) : null;
    const parsed = await readStructured({ household, sessionId, system: FOOD_SYSTEM, input: `The household: ${members.map((m) => m.name).join(', ') || 'unnamed'}.${about ? ` This is about ${about.name} unless somebody else is named.` : ''}\nTranscript:\n${body.transcript}`, schema: FOOD_SCHEMA, name: 'household_food', purpose: 'speech.household.food' });
    const items = normaliseFood(parsed, members).map((i) => (about && !i.memberId ? { ...i, memberId: about.id, memberName: about.name } : i));
    res.json({ items });
  } catch (err) { next(err); }
});

/** POST /household/likes — O4b / D3: what people love doing and avoid, on our shelves. Not yet saved. */
router.post('/household/likes', async (req, res, next) => {
  try {
    assertVoiceOn();
    const household = await currentHousehold();
    const body = z.object({ transcript: z.string().min(1).max(4000), memberId: z.string().uuid().nullish(), sessionId: z.string().max(80).nullish() }).parse(req.body ?? {});
    const sessionId = sessionOf(req, body.sessionId);
    await assertWithinBounds({ householdId: household.id, sessionId });
    const members = await loadMembers(household.id).catch(() => []);
    const about = body.memberId ? members.find((m) => m.id === body.memberId) : null;
    const tax = await taxonomy();
    const vocab = { categories: tax.active.categories.filter((c) => c.key !== 'food'), subcategories: tax.active.subcategories.filter((x) => x.category_key !== 'food') };
    const parsed = await readStructured({
      household, sessionId, system: LIKES_SYSTEM, schema: LIKES_SCHEMA, name: 'household_likes', purpose: 'speech.household.likes',
      input: `Categories and subcategories (key=label):\n${likesVocabularyText(vocab)}\n\nThe household: ${members.map((m) => `${m.name}${m.isMinor ? ' (child)' : ''}`).join(', ') || 'unnamed'}.${about ? ` This is about ${about.name} unless somebody else is named.` : ''}\nTranscript:\n${body.transcript}`,
    });
    const out = normaliseLikes(parsed, members, vocab);
    const items = out.items.map((i) => (about && !i.memberId ? { ...i, memberId: about.id, memberName: about.name } : i));
    res.json({ items, mobility: out.mobility });
  } catch (err) { next(err); }
});

/**
 * POST /household/apply — the confirmed chips, written. `{ food: [...], likes: [...], memberId? }`.
 * "Everyone" is every member, or the one person when `memberId` is given (D4).
 */
router.post('/household/apply', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const body = z.object({
      memberId: z.string().uuid().nullish(),
      food: z.array(z.object({ kind: z.enum(['diet', 'allergy', 'dislike', 'favourite']), value: z.string().min(1).max(60), memberId: z.string().uuid().nullish() })).max(60).default([]),
      likes: z.array(z.object({ kind: z.enum(['love', 'avoid']), phrase: z.string().min(1).max(80), label: z.string().max(80).nullish(), category: z.string().max(40).nullish(), subcategory: z.string().max(60).nullish(), memberId: z.string().uuid().nullish() })).max(60).default([]),
    }).parse(req.body ?? {});
    const members = await loadMembers(household.id).catch(() => []);
    const everyone = body.memberId ? members.filter((m) => m.id === body.memberId) : members;
    const written = [
      ...await applyFood(body.food, { members, households, everyone }),
      ...await applyLikes(body.likes, { members, households, everyone }),
    ];
    res.json({ written, members: await loadMembers(household.id) });
  } catch (err) { next(err); }
});

export default router;
