/**
 * The mail log's row is retried before a send; a retry of an insert that did
 * land must find it, not write a second row (Codex, 30 Sep 2026).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const { recordSend } = await import('../src/repositories/mail.js');

test.after(() => pool.end());

test('a retried log row with the same id is one row', async () => {
  const id = randomUUID();
  const a = await recordSend({ id, to: 'roger@epic.day', subject: 'Twice', purpose: 'test', status: 'sending' });
  const b = await recordSend({ id, to: 'roger@epic.day', subject: 'Twice', purpose: 'test', status: 'sending' });
  assert.equal(a.id, id);
  assert.equal(b.id, id);
  const { rows: [{ n }] } = await query('select count(*)::int n from mail_messages where id = $1', [id]);
  assert.equal(n, 1);
});

test('without an id, every send is its own row', async () => {
  const a = await recordSend({ to: 'roger@epic.day', subject: 'Once', status: 'sent' });
  const b = await recordSend({ to: 'roger@epic.day', subject: 'Once', status: 'sent' });
  assert.notEqual(a.id, b.id);
});
