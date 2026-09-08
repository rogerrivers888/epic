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
      return { transcript: out.text, language: out.language ?? language ?? null, model: out.model, fellBack: out.fellBack, ms: out.ms, seconds, mode: stream ? 'stream' : 'batch' };
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
    res.json({ ...token, language, maxSeconds: VOICE_MAX_SECONDS });
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
    const seconds = Math.min(VOICE_MAX_SECONDS, Math.round(body.seconds));
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

export default router;
