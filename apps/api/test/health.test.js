import { test } from 'node:test';
import assert from 'node:assert/strict';

// The health check is imported here so that a function it calls but never
// imports fails the suite rather than production. On 24 Sep 2026 server.js —
// which no test boots — called drawersWithoutABar() without importing it;
// every test passed and /health answered 503 to the check Railway restarts on.
import { testDatabase } from './helpers/db.js';
const { pool } = await testDatabase();
const { health, healthReport } = await import('../src/health.js');

test.after(() => pool.end());

test('the health report answers with both invariants against a live database', async () => {
  const out = await healthReport();
  assert.equal(out.ok, true);
  assert.equal(out.db, 'up');
  assert.ok(Array.isArray(out.drawersWithoutABar), 'drawersWithoutABar is reported');
  assert.ok(Array.isArray(out.drawersUnjudged), 'drawersUnjudged is reported');
});

test('the handler answers 200 with the report, and never throws out of an invariant', async () => {
  let status = 200; let body = null;
  const res = { status(s) { status = s; return this; }, json(b) { body = b; } };
  await health({}, res);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.service, 'epic-api');
});
