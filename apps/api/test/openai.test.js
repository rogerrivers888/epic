/**
 * The OpenAI adapter (sources/openai.js), driven against a stand-in provider.
 *
 * What is being checked is the part that is ours: the key never leaves this
 * process (it goes in a header, never a body or a URL), a model the account
 * cannot use steps down the ladder rather than stopping voice, a parameter a
 * model does not take is dropped once and not for ever, the streamed answer is
 * read into the same shape as the plain one, and a refusal is a 422 with the
 * provider's sentence kept out of the household's message.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.OPENAI_API_KEY = 'sk-test-not-real';
const { extract, mintLiveToken, readTranscriptStream, transcribe } = await import('../src/sources/openai.js');

/** A provider that answers from a script, and remembers what it was asked. */
function fakeFetch(script) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = init.body instanceof FormData ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, v instanceof Blob ? `<blob ${v.type} ${v.size}b>` : v])) : JSON.parse(init.body || 'null');
    // FormData keeps repeated keys; fold `languages[]`/`keywords[]` into lists.
    if (init.body instanceof FormData) for (const k of ['languages[]', 'keywords[]']) { const all = init.body.getAll(k); if (all.length) body[k] = all; }
    calls.push({ url: String(url), headers: init.headers, body });
    const step = script.shift();
    if (!step) throw new Error('unexpected extra call');
    if (step.throw) throw step.throw;
    return new Response(typeof step.body === 'string' ? step.body : JSON.stringify(step.body), {
      status: step.status ?? 200,
      headers: { 'content-type': step.contentType ?? 'application/json' },
    });
  };
  return calls;
}

const audio = Buffer.from('not really audio');

test('the key travels in a header, the hint and the language in the form, and the transcript comes back untouched', async () => {
  const calls = fakeFetch([{ body: { text: '  the 14th — no, sorry, the 15th  ', languages: [{ code: 'en' }] } }]);
  const out = await transcribe({ audio, mime: 'audio/webm', language: 'en', hint: 'People: Roger, Gina.', keywords: ['Sintra', 'Alfama'] });
  assert.equal(out.text, 'the 14th — no, sorry, the 15th');
  assert.equal(out.language, 'en');
  assert.equal(out.model, 'gpt-transcribe');
  assert.equal(calls[0].headers.authorization, 'Bearer sk-test-not-real');
  assert.ok(!calls[0].url.includes('sk-test'), 'never in the URL');
  assert.equal(calls[0].body.model, 'gpt-transcribe');
  assert.equal(calls[0].body.temperature, '0');
  assert.equal(calls[0].body.prompt, 'People: Roger, Gina.');
  assert.deepEqual(calls[0].body['languages[]'], ['en']);
  assert.deepEqual(calls[0].body['keywords[]'], ['Sintra', 'Alfama']);
  assert.ok(!('language' in calls[0].body), 'gpt-transcribe takes languages, not language');
});

test('no language known: none is sent, so the provider detects it', async () => {
  const calls = fakeFetch([{ body: { text: 'Queremos ir a Sevilla', languages: [{ code: 'es' }] } }]);
  const out = await transcribe({ audio, mime: 'audio/mp4' });
  assert.equal(out.language, 'es');
  assert.ok(!('language' in calls[0].body) && !('languages[]' in calls[0].body));
});

test('a model the account cannot use steps down the ladder, and the answer says so', async () => {
  const calls = fakeFetch([
    { status: 404, body: { error: { message: 'The model `gpt-transcribe` does not exist', code: 'model_not_found' } } },
    { body: { text: 'hello' } },
  ]);
  const out = await transcribe({ audio, mime: 'audio/webm', language: 'en' });
  assert.equal(out.model, 'gpt-4o-transcribe');
  assert.equal(out.fellBack, true);
  assert.equal(calls[1].body.language, 'en', 'the 4o family takes a single language');
});

test('a parameter the model refuses is dropped once, on the same model', async () => {
  const calls = fakeFetch([
    { status: 400, body: { error: { message: 'Unknown parameter: keywords', code: 'unknown_parameter', param: 'keywords' } } },
    { body: { text: 'hello' } },
  ]);
  const out = await transcribe({ audio, mime: 'audio/webm', keywords: ['Sintra'] });
  assert.equal(out.model, 'gpt-transcribe');
  assert.equal(calls.length, 2);
  assert.ok(!('keywords[]' in calls[1].body));
});

test('a refusal the ladder cannot help with is a plain sentence with the detail kept aside', async () => {
  fakeFetch([{ status: 429, body: { error: { message: 'Rate limit reached for org-123 on requests per min' } } }]);
  await assert.rejects(transcribe({ audio, mime: 'audio/webm' }), (err) => {
    assert.equal(err.code, 'voice_unavailable');
    assert.equal(err.status, 503);
    assert.ok(!/org-123/.test(err.message), 'the household never sees the provider\'s words');
    assert.ok(/org-123/.test(err.detail), 'the back office does');
    return true;
  });
});

test('the streamed answer is read into the same shape', async () => {
  const sse = [
    'event: transcript.text.delta\ndata: {"type":"transcript.text.delta","delta":"Four nights "}\n\n',
    'data: {"type":"transcript.text.delta","delta":"in Lisbon."}\n\n',
    'data: {"type":"transcript.text.done","text":"Four nights in Lisbon.","languages":[{"code":"en"}],"usage":{"type":"tokens","input_tokens":10,"output_tokens":5}}\n\n',
  ].join('');
  const pieces = [];
  const out = await readTranscriptStream(new Response(sse, { headers: { 'content-type': 'text/event-stream' } }), (d) => pieces.push(d));
  assert.deepEqual(pieces, ['Four nights ', 'in Lisbon.']);
  assert.equal(out.text, 'Four nights in Lisbon.');
  assert.equal(out.language, 'en');
  assert.equal(out.usage.input_tokens, 10);
});

test('a stream that never says done still returns the pieces joined', async () => {
  const out = await readTranscriptStream(new Response('data: {"type":"transcript.text.delta","delta":"a"}\n\ndata: {"type":"transcript.text.delta","delta":"b"}\n\n'), null);
  assert.equal(out.text, 'ab');
});

test('the live token asks for a transcription session and hands back only the client secret', async () => {
  const calls = fakeFetch([{ body: { value: 'ek_abc', expires_at: 1_800_000_000 } }]);
  const out = await mintLiveToken({ language: 'pt', hint: 'Places: Sintra.', keywords: ['Alfama'] });
  assert.equal(out.token, 'ek_abc');
  assert.equal(out.model, 'gpt-live-transcribe');
  assert.equal(out.sampleRate, 24000);
  assert.ok(out.url.startsWith('wss://'));
  const session = calls[0].body.session;
  assert.equal(session.type, 'transcription');
  assert.equal(session.audio.input.format.rate, 24000);
  assert.equal(session.audio.input.transcription.model, 'gpt-live-transcribe');
  assert.deepEqual(session.audio.input.transcription.languages, ['pt']);
  assert.ok(!('turn_detection' in session.audio.input), 'the live model finds its own turns and refuses to be told');
  assert.equal(calls[0].body.expires_after.anchor, 'created_at');
});

test('extract sends a strict schema and reads the object back', async () => {
  const calls = fakeFetch([{ body: { model: 'gpt-5-mini', output_text: '{"destination":"Lisbon"}', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"destination":"Lisbon"}' }] }], usage: { input_tokens: 100, output_tokens: 20 } } }]);
  const schema = { type: 'object', additionalProperties: false, properties: { destination: { type: ['string', 'null'] } }, required: ['destination'] };
  const out = await extract({ system: 'rules', input: 'Transcript:\nLisbon', schema, name: 'voice_intent' });
  assert.deepEqual(out.parsed, { destination: 'Lisbon' });
  assert.equal(calls[0].body.text.format.type, 'json_schema');
  assert.equal(calls[0].body.text.format.strict, true);
  assert.equal(calls[0].body.text.format.name, 'voice_intent');
  assert.equal(calls[0].body.instructions, 'rules');
  assert.equal(calls[0].body.store, false, 'nothing kept on the provider\'s side');
});

test('a refusal is a 422 and the provider\'s sentence stays out of the message', async () => {
  fakeFetch([{ body: { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'I cannot help with that request.' }] }] } }]);
  await assert.rejects(extract({ system: 's', input: 'i', schema: { type: 'object', additionalProperties: false, properties: {}, required: [] } }), (err) => {
    assert.equal(err.status, 422);
    assert.equal(err.code, 'voice_refused');
    assert.ok(!/cannot help/.test(err.message));
    assert.equal(err.detail, 'I cannot help with that request.');
    return true;
  });
});

test('a live-session field the provider refuses is dropped by name and the rest kept', async () => {
  const calls = fakeFetch([
    { status: 400, body: { error: { message: "Unknown parameter: 'session.audio.input.noise_reduction'.", code: 'unknown_parameter', param: 'session.audio.input.noise_reduction' } } },
    { status: 400, body: { error: { message: "Invalid value: 'server_vad' for turn_detection", code: 'invalid_value', param: 'session.audio.input.turn_detection.type' } } },
    { body: { value: 'ek_after', expires_at: 1_800_000_000 } },
  ]);
  const out = await mintLiveToken({ language: 'en', keywords: ['Sintra'], model: 'gpt-4o-transcribe' });
  assert.equal(out.token, 'ek_after');
  assert.equal(out.model, 'gpt-4o-transcribe', 'the same model, not the next rung');
  assert.deepEqual(out.dropped, ['noise_reduction', 'turn_detection']);
  assert.equal(out.refusals[1].said, "Invalid value: 'server_vad' for turn_detection", 'what it said is kept for the probe');
  const last = calls[2].body.session.audio.input;
  assert.ok(!('noise_reduction' in last) && !('turn_detection' in last));
  assert.equal(last.transcription.language, 'en', 'what was not refused stays');
});

test('a refusal that names nothing optional is a real error, not a loop', async () => {
  fakeFetch([{ status: 400, body: { error: { message: 'Invalid value for session.type', code: 'invalid_value', param: 'session.type' } } }]);
  await assert.rejects(mintLiveToken({ language: 'en' }), (err) => err.code === 'voice_unavailable');
});

test('extract asks for little reasoning, and drops it for a model that has none', async () => {
  const calls = fakeFetch([
    { status: 400, body: { error: { message: "Unsupported parameter: 'reasoning' is not supported with this model.", code: 'unsupported_parameter', param: 'reasoning' } } },
    { body: { output_text: '{"a":1}', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"a":1}' }] }] } },
  ]);
  const out = await extract({ system: 's', input: 'i', schema: { type: 'object', additionalProperties: false, properties: { a: { type: 'integer' } }, required: ['a'] } });
  assert.deepEqual(out.parsed, { a: 1 });
  assert.equal(calls[0].body.reasoning.effort, 'minimal');
  assert.ok(!('reasoning' in calls[1].body));
  assert.equal(calls[1].body.store, false, 'only the refused field goes');
});

test('a stream with Windows line ends and one object per line is still read', async () => {
  const sse = 'data: {"type":"transcript.text.delta","delta":"Four "}\r\ndata: {"type":"transcript.text.delta","delta":"nights."}\r\n\r\ndata: {"type":"transcript.text.done","text":"Four nights."}\r\n\r\n';
  const pieces = [];
  const out = await readTranscriptStream(new Response(sse), (d) => pieces.push(d));
  assert.deepEqual(pieces, ['Four ', 'nights.']);
  assert.equal(out.text, 'Four nights.');
  assert.deepEqual(out.events.sort(), ['transcript.text.delta', 'transcript.text.done']);
});

test('a \\r\\n split across two network chunks still separates the events', async () => {
  const enc = new TextEncoder();
  const a = 'data: {"type":"transcript.text.delta","delta":"Four "}\r';
  const b = '\n\r\ndata: {"type":"transcript.text.done","text":"Four nights."}\r\n\r\n';
  const body = new ReadableStream({ start(c) { c.enqueue(enc.encode(a)); c.enqueue(enc.encode(b)); c.close(); } });
  const pieces = [];
  const out = await readTranscriptStream(new Response(body), (d) => pieces.push(d));
  assert.deepEqual(pieces, ['Four ']);
  assert.equal(out.text, 'Four nights.');
});
