/**
 * A ceiling two runs cannot walk through at once.
 *
 * "Nothing spends past it" is printed on the Runs board. It used to be enforced
 * by reading what `provider_calls` already held, so two collections starting
 * together both read the same total, both found room, and between them went
 * past it — a limit only one caller at a time can be held to is not a limit
 * (Codex, 17 Sep 2026).
 *
 * The property held here is the one that matters: a second ask, made before the
 * first one's calls have landed anywhere, sees the first one's claim.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const { roomToSpend, releaseSpend } = await import('../src/routes/placeIndex.js');

test.after(() => pool.end());

const ceiling = (pence) => query(
  `insert into app_settings (key, value) values ('collect.ceiling_pence', $1::text::jsonb)
   on conflict (key) do update set value = excluded.value`, [String(pence)]);

test('the second caller sees what the first one claimed', async () => {
  await query('delete from spend_reservations');
  await ceiling(1000);

  const first = await roomToSpend(700, { holder: 'one' });
  assert.equal(first.ok, true);
  assert.ok(first.reservation, 'the claim is written down, not just decided');

  // Nothing has been billed yet — `provider_calls` is untouched. Under the old
  // rule this would have said yes as well, and the two together would have
  // spent 1,400 of a 1,000 ceiling.
  const second = await roomToSpend(700, { holder: 'two' });
  assert.equal(second.ok, false);
  assert.equal(second.reservation, null, 'a refusal claims nothing');
  assert.equal(second.claimedPence, 700);

  // What does fit, fits.
  const third = await roomToSpend(300, { holder: 'three' });
  assert.equal(third.ok, true);

  await releaseSpend(first.reservation);
  await releaseSpend(third.reservation);
  assert.equal((await roomToSpend(1000, { reserve: false })).ok, true, 'giving it back gives it back');
});

test('a claim nobody released expires rather than locking the month', async () => {
  await query('delete from spend_reservations');
  await ceiling(1000);
  const held = await roomToSpend(900, { holder: 'a process that died' });
  assert.equal(held.ok, true);
  assert.equal((await roomToSpend(900, { reserve: false })).ok, false);

  // By the time it expires the calls it covered are in `provider_calls`, which
  // is what the next reading counts. Holding both would refuse money that is
  // genuinely there.
  await query(`update spend_reservations set expires_at = now() - interval '1 minute' where id = $1`, [held.reservation]);
  assert.equal((await roomToSpend(900, { reserve: false })).ok, true);
});

test('free work is never measured against a ceiling', async () => {
  await ceiling(0);
  const free = await roomToSpend(0);
  assert.equal(free.ok, true, 'researching a place from its own page costs nothing');
  assert.equal(free.reservation, null);
});

test('Tripadvisor is capped in calls, and a claim is what makes it a cap', async () => {
  await query('delete from spend_reservations');
  await query("delete from provider_calls where provider = 'tripadvisor'");
  const { tripadvisorRoom } = await import('../src/routes/placeIndex.js');
  const cap = Number(process.env.EPIC_LOOKUP_TRIPADVISOR_CAP ?? process.env.ROAM_LOOKUP_TRIPADVISOR_CAP ?? 120);

  // Asking without claiming, for a screen that only wants the number.
  const look = await tripadvisorRoom(0);
  assert.equal(look.left, cap);
  assert.equal(look.reservation, null);

  // A run claims what it is about to ask for, and the next one sees it — which
  // is the whole difference between a cap and a hope (Codex, 17 Sep 2026).
  const first = await tripadvisorRoom(cap - 2);
  assert.equal(first.granted, cap - 2);
  assert.ok(first.reservation);
  const second = await tripadvisorRoom(10);
  assert.equal(second.granted, 2, 'whatever fits, and never more');

  await releaseSpend(first.reservation);
  await releaseSpend(second.reservation);
  assert.equal((await tripadvisorRoom(0)).left, cap, 'giving it back gives it back');

  // A claim on calls is never also a claim on money.
  const held = await tripadvisorRoom(5);
  assert.equal((await roomToSpend(1, { reserve: false })).claimedPence, 0);
  await releaseSpend(held.reservation);
});
