/**
 * The launch gate (siteGate.js), tested where getting it wrong is silent.
 *
 * A gate that reads "unset" as off, or admits everyone when it has no password,
 * does not break a screen — it just serves the unopened site to the internet. And
 * the deny-by-default model has its own silent failures: shutting out the signed-in
 * app (whose Bearer calls must pass), or leaking a route that is mounted before the
 * session door. So the things pinned hardest here are: on by default; the password
 * admits nobody when unset; a real Epic session passes; and everything else —
 * including a pre-session route like the image library — is refused.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { testDatabase } from './helpers/db.js';

const { pool } = await testDatabase();
const { siteGateOn, basicAuthOk, siteGate, sessionBlockedByGate, setCleanSlateEpoch, failClosedUntilCutoff } = await import('../src/siteGate.js');
const { insertSession, revokeSession } = await import('../src/repositories/sessions.js');
const { stampPhoto } = await import('../src/sources/photoLinks.js');

test.after(() => pool.end());

const basic = (user, pass) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
const bearer = (token) => `Bearer ${token}`;
const aToken = () => crypto.randomBytes(32).toString('base64url');

const withEnv = async (vars, fn) => {
  const before = {};
  for (const [k, v] of Object.entries(vars)) {
    before[k] = process.env[k];
    if (v === null) delete process.env[k]; else process.env[k] = v;
  }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
};

/** Just enough of an Express req/res to see which way the middleware went. */
const mockReq = (over = {}) => ({ path: '/api/household', method: 'GET', query: {}, headers: {}, ...over });
const mockRes = () => {
  const res = {
    headers: {}, statusCode: null, body: null,
    set(k, v) { res.headers[k.toLowerCase()] = v; return res; },
    status(n) { res.statusCode = n; return res; },
    json(b) { res.body = b; return res; },
  };
  return res;
};
const run = async (req) => {
  const res = mockRes();
  let nexted = false;
  await siteGate(req, res, () => { nexted = true; });
  return { res, nexted };
};

test('the gate is on unless it is explicitly switched off', () => {
  for (const on of [null, '', 'on', 'true', 'anything-else']) {
    assert.equal(withEnvSync({ SITE_GATE: on }, siteGateOn), true, `${on} is on`);
  }
  for (const off of ['off', 'OFF', 'false', '0', 'no']) {
    assert.equal(withEnvSync({ SITE_GATE: off }, siteGateOn), false, `${off} is off`);
  }
});

function withEnvSync(vars, fn) {
  const before = {};
  for (const [k, v] of Object.entries(vars)) { before[k] = process.env[k]; if (v === null) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test('with no credentials set, the password admits nobody', async () => {
  await withEnv({ GATE_USER: null, GATE_PASSWORD: null }, () => {
    assert.equal(basicAuthOk(basic('anyone', 'anything')), false);
    assert.equal(basicAuthOk(undefined), false);
  });
  await withEnv({ GATE_USER: 'u', GATE_PASSWORD: null }, () => {
    assert.equal(basicAuthOk(basic('u', '')), false);
  });
});

test('the right username and password open it, and nothing else does', async () => {
  await withEnv({ GATE_USER: 'letme', GATE_PASSWORD: 's3cr3t' }, () => {
    assert.equal(basicAuthOk(basic('letme', 's3cr3t')), true);
    assert.equal(basicAuthOk(basic('letme', 's3cr3t ')), false, 'a trailing space is a different password');
    assert.equal(basicAuthOk(basic('letme', 'wrong')), false);
    assert.equal(basicAuthOk(basic('nope', 's3cr3t')), false);
    assert.equal(basicAuthOk(basic('LETME', 's3cr3t')), false, 'case matters');
    assert.equal(basicAuthOk('Basic not-base64!!'), false);
    assert.equal(basicAuthOk('Bearer sometoken'), false, 'wrong scheme');
    assert.equal(basicAuthOk('letme:s3cr3t'), false, 'no scheme');
    assert.equal(basicAuthOk(''), false);
    assert.equal(basicAuthOk(`Basic ${Buffer.from('letme').toString('base64')}`), false);
  });
});

test('the middleware lets everything through when the gate is off', async () => {
  await withEnv({ SITE_GATE: 'off' }, async () => {
    const { res, nexted } = await run(mockReq());
    assert.equal(nexted, true);
    assert.equal(res.statusCode, null, 'no response written');
    assert.equal(res.headers['x-robots-tag'], undefined, 'and no noindex when open');
  });
});

test('deny by default: no password and no session is refused, whatever the path', async () => {
  await withEnv({ SITE_GATE: null, GATE_USER: 'u', GATE_PASSWORD: 'p' }, async () => {
    // A protected route, a world-open browse route, and a route mounted before
    // the session door (the image library) are all refused the same way.
    for (const req of [
      mockReq({ path: '/api/household' }),
      mockReq({ path: '/api/experiences/near', method: 'GET' }),
      mockReq({ path: '/api/trips', method: 'GET' }),
    ]) {
      const { res, nexted } = await run(req);
      assert.equal(nexted, false, `${req.path} must not fall through`);
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.error, 'coming_soon');
      assert.equal(res.headers['x-robots-tag'], 'noindex');
      // No fetch metadata and no HTML Accept: this is how the app's XHR looks, so
      // it must get a plain JSON 401 with no Basic challenge — otherwise the
      // browser pops its password dialog on every background request.
      assert.equal(res.headers['www-authenticate'], undefined, `${req.path} must not challenge a non-navigation`);
    }
  });
});

test('the Basic challenge is sent only for a real page navigation, never for XHR or an <img>', async () => {
  await withEnv({ SITE_GATE: null, GATE_USER: 'u', GATE_PASSWORD: 'p' }, async () => {
    // A top-level navigation — the owner or a tester typing the API's address in a
    // browser — gets the challenge, so the native sign-in dialog still appears.
    const nav = await run(mockReq({ headers: { 'sec-fetch-mode': 'navigate' } }));
    assert.equal(nav.res.statusCode, 401);
    assert.match(nav.res.headers['www-authenticate'], /^Basic/, 'a navigation is challenged');

    // Where a browser sends no fetch metadata, an HTML Accept is the fallback.
    const html = await run(mockReq({ headers: { accept: 'text/html,application/xhtml+xml' } }));
    assert.match(html.res.headers['www-authenticate'], /^Basic/, 'an HTML page load is challenged');

    // The app's own calls must never be challenged — no dialog on a background poll.
    const cases = {
      'an XHR (cors) with a JSON Accept': { 'sec-fetch-mode': 'cors', accept: 'application/json' },
      'an image load': { 'sec-fetch-mode': 'no-cors', accept: 'image/avif,image/webp,*/*' },
      'a same-origin fetch': { 'sec-fetch-mode': 'same-origin' },
      'a JSON Accept with no fetch metadata': { accept: 'application/json' },
      'a wildcard Accept with no fetch metadata': { accept: '*/*' },
    };
    for (const [label, headers] of Object.entries(cases)) {
      const { res, nexted } = await run(mockReq({ headers }));
      assert.equal(nexted, false, `${label} is still refused`);
      assert.equal(res.statusCode, 401, `${label} still gets a 401`);
      assert.equal(res.body.error, 'coming_soon');
      assert.equal(res.headers['www-authenticate'], undefined, `${label} is not challenged`);
    }
  });
});

test('the gate password is admitted, still marking the response noindex', async () => {
  await withEnv({ SITE_GATE: null, GATE_USER: 'u', GATE_PASSWORD: 'p' }, async () => {
    const { res, nexted } = await run(mockReq({ headers: { authorization: basic('u', 'p') } }));
    assert.equal(nexted, true);
    assert.equal(res.statusCode, null);
    assert.equal(res.headers['x-robots-tag'], 'noindex');
  });
});

test('a real Epic session is admitted; a revoked or unknown token is not', async () => {
  await withEnv({ SITE_GATE: null, GATE_USER: 'u', GATE_PASSWORD: 'p' }, async () => {
    const token = aToken();
    await insertSession(token, 'gate-test device');
    const ok = await run(mockReq({ path: '/api/household', headers: { authorization: bearer(token) } }));
    assert.equal(ok.nexted, true, 'a live session passes the gate on its Bearer token');
    assert.equal(ok.res.statusCode, null);

    const unknown = await run(mockReq({ headers: { authorization: bearer(aToken()) } }));
    assert.equal(unknown.nexted, false, 'an unknown token is the public');
    assert.equal(unknown.res.statusCode, 401);

    await revokeSession(token);
    const revoked = await run(mockReq({ headers: { authorization: bearer(token) } }));
    assert.equal(revoked.nexted, false, 'a revoked token no longer passes');
    assert.equal(revoked.res.statusCode, 401);
  });
});

test('a session minted before the gate cutoff is no longer honoured', async () => {
  await withEnv({ SITE_GATE: null, GATE_USER: 'u', GATE_PASSWORD: 'p' }, async () => {
    const token = aToken();
    await insertSession(token, 'pre-cutoff device');
    // A cutoff in the future makes the just-made session "before" it — the deploy
    // race Codex named, where the old process mints one last token after the revoke.
    await withEnv({ EPIC_GATE_SINCE: new Date(Date.now() + 3_600_000).toISOString() }, async () => {
      const r = await run(mockReq({ path: '/api/household', headers: { authorization: bearer(token) } }));
      assert.equal(r.nexted, false, 'a pre-cutoff session is refused');
      assert.equal(r.res.statusCode, 401);
    });
    // With no cutoff set, the same session passes — the default is unchanged.
    const ok = await run(mockReq({ path: '/api/household', headers: { authorization: bearer(token) } }));
    assert.equal(ok.nexted, true);
  });
});

test('sessionBlockedByGate: true only when the gate is up and the session predates the cutoff', async () => {
  const recent = { created_at: new Date().toISOString() };
  const future = () => new Date(Date.now() + 3_600_000).toISOString();
  await withEnv({ SITE_GATE: null, EPIC_GATE_SINCE: future() }, () => assert.equal(sessionBlockedByGate(recent), true));
  await withEnv({ SITE_GATE: 'off', EPIC_GATE_SINCE: future() }, () => assert.equal(sessionBlockedByGate(recent), false, 'gate off — not blocked'));
  await withEnv({ SITE_GATE: null, EPIC_GATE_SINCE: null }, () => assert.equal(sessionBlockedByGate(recent), false, 'no cutoff — not blocked'));
});

test('the cutoff falls back to the automatic clean-slate epoch when no env override is set', async () => {
  const recent = { created_at: new Date().toISOString() };
  await withEnv({ SITE_GATE: null, EPIC_GATE_SINCE: null }, () => {
    setCleanSlateEpoch(new Date(Date.now() + 3_600_000));
    assert.equal(sessionBlockedByGate(recent), true, 'an automatic epoch in the future retires a recent session');
    setCleanSlateEpoch(new Date(Date.now() - 3_600_000));
    assert.equal(sessionBlockedByGate(recent), false, 'an epoch in the past does not');
    setCleanSlateEpoch(null);
    assert.equal(sessionBlockedByGate(recent), false, 'no epoch and no override — nothing is blocked');
  });
});

test('the sign-in door is left open for native clients and the magic link', async () => {
  await withEnv({ SITE_GATE: null, GATE_USER: 'u', GATE_PASSWORD: 'p' }, async () => {
    for (const req of [
      mockReq({ path: '/api/session', method: 'GET' }),
      mockReq({ path: '/api/session', method: 'POST' }),
      mockReq({ path: '/api/session/link', method: 'POST' }),
      mockReq({ path: '/api/session/request-link', method: 'POST' }),
      // Log in with Google is a sign-in door too (routes/authGoogle.js): a
      // signed-out staff member must reach the handshake and the exchange.
      mockReq({ path: '/api/auth/google', method: 'GET' }),
      mockReq({ path: '/api/auth/google/callback', method: 'GET' }),
      mockReq({ path: '/api/auth/google/exchange', method: 'POST' }),
      // Email + password (routes/authPassword.js): log in, forgot, set credentials,
      // and L4's look at an invite or reset link before anybody has a session.
      mockReq({ path: '/api/auth/login', method: 'POST' }),
      mockReq({ path: '/api/auth/forgot', method: 'POST' }),
      mockReq({ path: '/api/auth/credentials', method: 'POST' }),
      mockReq({ path: '/api/auth/link/some-token', method: 'GET' }),
      mockReq({ path: '/api/auth/link/some-token/', method: 'GET' }),
      // Express treats a trailing slash as the same route; the gate must too.
      mockReq({ path: '/api/session/link/', method: 'POST' }),
      mockReq({ path: '/api/postmark/events/', method: 'POST' }),
    ]) {
      const { res, nexted } = await run(req);
      assert.equal(nexted, true, `${req.method} ${req.path} reaches its handler without the gate password`);
      assert.equal(res.statusCode, null);
    }
    // But DELETE /api/session is not a sign-in verb: it must pass through the gate's
    // session check (so a pre-cutoff token cannot sign other devices out).
    const del = await run(mockReq({ path: '/api/session', method: 'DELETE' }));
    assert.equal(del.nexted, false, 'DELETE /api/session is not exempt');
    assert.equal(del.res.statusCode, 401);
    // The link look-up is one token deep and GET only: nothing under it, and no
    // other verb, is let through on its say-so.
    for (const req of [
      mockReq({ path: '/api/auth/link/a/b', method: 'GET' }),
      mockReq({ path: '/api/auth/link/a', method: 'POST' }),
      mockReq({ path: '/api/auth/link', method: 'GET' }),
    ]) {
      const { nexted } = await run(req);
      assert.equal(nexted, false, `${req.method} ${req.path} is not a sign-in door`);
    }
  });
});

test('the image library is open; a signed photo is admitted, an unsigned one is not', async () => {
  await withEnv({ SITE_GATE: null, GATE_USER: 'u', GATE_PASSWORD: 'p' }, async () => {
    // The owned image library is byte content left open — an <img> carries no
    // header, and approved rows have no signature; the route keeps a pending one
    // behind its own link.
    const img = await run(mockReq({ path: '/api/images/img-123/480' }));
    assert.equal(img.nexted, true, 'the image library is reachable by the <img> tag');

    // A rented photo, though, needs its signed link — which also names the paid
    // spender — so the public cannot make Epic spend on a picture.
    const photo = stampPhoto({ ref: 'places/X/photos/Y' });
    const signed = await run(mockReq({ path: '/api/photos/google', query: { name: photo.ref, s: photo.sig, e: String(photo.exp) } }));
    assert.equal(signed.nexted, true, 'a valid signed photo link passes');
    assert.equal(signed.res.statusCode, null);

    const bare = await run(mockReq({ path: '/api/photos/google', query: { name: 'places/X/photos/Y' } }));
    assert.equal(bare.nexted, false, 'an unsigned photo request is the public');
    assert.equal(bare.res.statusCode, 401);
  });
});

test('the waitlist form is open — only POST /api/interest, nothing near it', async () => {
  await withEnv({ SITE_GATE: null, GATE_USER: 'u', GATE_PASSWORD: 'p' }, async () => {
    // "Register your interest" is for the people who cannot sign in yet.
    for (const req of [
      mockReq({ path: '/api/interest', method: 'POST' }),
      mockReq({ path: '/api/interest/', method: 'POST' }),
    ]) {
      const { res, nexted } = await run(req);
      assert.equal(nexted, true, `${req.method} ${req.path} reaches the form handler without a credential`);
      assert.equal(res.statusCode, null);
    }
    // Any other verb, anything beneath it, and the back office's reading of the
    // list are all still the public's to be refused.
    for (const req of [
      mockReq({ path: '/api/interest', method: 'GET' }),
      mockReq({ path: '/api/interest', method: 'DELETE' }),
      mockReq({ path: '/api/interest/anything', method: 'POST' }),
      mockReq({ path: '/api/interests', method: 'POST' }),
      mockReq({ path: '/api/admin/waitlist', method: 'GET' }),
      mockReq({ path: '/api/admin/waitlist.csv', method: 'GET' }),
    ]) {
      const { res, nexted } = await run(req);
      assert.equal(nexted, false, `${req.method} ${req.path} is not exempt`);
      assert.equal(res.statusCode, 401);
    }
  });
});

test('health, the Postmark webhook, and a CORS preflight answer without a credential', async () => {
  await withEnv({ SITE_GATE: null, GATE_USER: 'u', GATE_PASSWORD: 'p' }, async () => {
    const health = await run(mockReq({ path: '/health' }));
    assert.equal(health.nexted, true, 'health is always open');
    assert.equal(health.res.statusCode, null);

    const postmark = await run(mockReq({ path: '/api/postmark/events', method: 'POST' }));
    assert.equal(postmark.nexted, true, 'the webhook reaches its own token check');

    const preflight = await run(mockReq({ method: 'OPTIONS' }));
    assert.equal(preflight.nexted, true, 'a preflight is let through');

    // And only those: a near neighbour of health is still refused.
    const near = await run(mockReq({ path: '/health/secret' }));
    assert.equal(near.nexted, false);
    assert.equal(near.res.statusCode, 401);
  });
});

test('while the cutoff is unknown, a session this process minted passes and an older one waits — no clocks compared', async () => {
  // server.js calls failClosedUntilCutoff when it cannot read the real cutoff. It
  // used to set a cutoff a year ahead, so a passcode sign-in succeeded and every
  // read after it was 401 coming_soon (2 Oct 2026).
  const { openSession } = await import('../src/auth.js');
  await withEnv({ SITE_GATE: null, EPIC_GATE_SINCE: null, GATE_USER: null, GATE_PASSWORD: null }, async () => {
    const older = aToken();
    await insertSession(older, 'opened before this process could date anything');
    failClosedUntilCutoff();
    try {
      const { token: fresh } = await openSession('a fresh agent sign-in');
      const read = (t) => run(mockReq({ path: '/api/admin/narrowing/preview', headers: { authorization: bearer(t) } }));
      assert.equal((await read(fresh)).nexted, true, 'the fresh sign-in reads at once, with no gate password set');
      const stale = await read(older);
      assert.equal(stale.nexted, false, 'an older session waits for the real cutoff');
      assert.equal(stale.res.statusCode, 401);
      setCleanSlateEpoch(new Date(Date.now() - 3_600_000));
      assert.equal((await read(older)).nexted, true, 'once the cutoff loads, the older session is judged by it');
    } finally { setCleanSlateEpoch(null); }
  });
});

test('a malformed override does not lift the fail-closed state, and a reachable database restores the cutoff on the next request', async () => {
  await withEnv({ SITE_GATE: null, EPIC_GATE_SINCE: 'not a date', GATE_USER: null, GATE_PASSWORD: null }, async () => {
    const older = aToken();
    await insertSession(older, 'opened before the cutoff could be read');
    const read = () => run(mockReq({ path: '/api/admin/narrowing/preview', headers: { authorization: bearer(older) } }));
    let calls = 0;
    failClosedUntilCutoff(async () => { calls += 1; throw new Error('database still down'); });
    try {
      assert.equal((await read()).nexted, false, 'a non-date EPIC_GATE_SINCE is no override — still closed');
      assert.equal(calls, 1, 'it tried to load the cutoff on demand');
      await read();
      assert.equal(calls, 1, 'and does not retry more than every five seconds');
    } finally { setCleanSlateEpoch(null); }

    failClosedUntilCutoff(async () => new Date(Date.now() - 3_600_000));
    try {
      assert.equal((await read()).nexted, true, 'the database answering again restores the real cutoff at once');
    } finally { setCleanSlateEpoch(null); }
  });
});

test('a stalled cutoff retry never holds up health, the sign-in door, or a request without a session', async () => {
  await withEnv({ SITE_GATE: null, EPIC_GATE_SINCE: null, GATE_USER: 'u', GATE_PASSWORD: 'p' }, async () => {
    let calls = 0;
    failClosedUntilCutoff(() => { calls += 1; return new Promise(() => {}); }); // never answers
    try {
      for (const req of [mockReq({ path: '/health' }), mockReq({ path: '/api/session', method: 'POST' }),
        mockReq({ headers: { authorization: basic('u', 'p') } }), mockReq({ path: '/api/household' })]) {
        await run(req);
      }
      assert.equal(calls, 0, 'nothing before a successful session lookup asks for the cutoff');
      const token = aToken();
      await insertSession(token, 'an older session');
      const started = Date.now();
      const r = await run(mockReq({ headers: { authorization: bearer(token) } }));
      assert.equal(calls, 1, 'a session-bearing request tries once');
      assert.ok(Date.now() - started < 4_500, 'and waits no more than about three seconds');
      assert.equal(r.nexted, false, 'judged fail-closed meanwhile');
    } finally { setCleanSlateEpoch(null); }
  });
});
