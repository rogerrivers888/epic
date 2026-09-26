/**
 * The postcode directory is checked monthly and loaded when the ONS has a
 * newer one (owner, 26 Sep 2026: "Monthly check, quarterly load").
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const refresh = await import('../src/sources/postcodeRefresh.js');

test.after(() => pool.end());

test('a release is read off the ONS title, and a user guide is not a release', () => {
  assert.equal(refresh.releaseOf('ONS Postcode Directory (August 2026)'), '2026-08');
  assert.equal(refresh.releaseOf('ONS Postcode Directory (February 2026) for the UK'), '2026-02');
  assert.equal(refresh.releaseOf('ONS Postcode Directory (August 2026) User Guide'), null);
  assert.equal(refresh.releaseOf('NHS Postcode Directory (August 2026)'), null);
  const newest = refresh.newestOf([
    { id: 'a', type: 'CSV Collection', title: 'ONS Postcode Directory (May 2026)' },
    { id: 'b', type: 'CSV Collection', title: 'ONS Postcode Directory (November 2026)' },
    { id: 'c', type: 'CSV Collection', title: 'ONS Postcode Directory (November 2026) User Guide' },
    { id: 'd', type: 'Feature Service', title: 'ONS Postcode Directory (December 2026)' },
  ]);
  assert.deepEqual(newest, { release: '2026-11', item: 'b' }, 'the newest archive, not a guide and not a service');
});

test('a check is owed monthly, and a load only for a newer release', async (t) => {
  t.after(() => query('update postcode_releases set checked_at = null, latest_release = null, latest_item = null, loaded_release = null, loaded_at = null, loading_since = null, last_error = null where one'));
  await query('update postcode_releases set checked_at = null, loaded_release = $1, loading_since = null where one', ['2026-08']);
  assert.equal(refresh.isDue({ checked_at: null }), true);
  assert.equal(refresh.isDue({ checked_at: new Date(Date.now() - 10 * 86_400_000) }), false, 'ten days ago is inside the month');
  assert.equal(refresh.isDue({ checked_at: new Date(Date.now() - 31 * 86_400_000) }), true);

  const listing = (title) => ({ ok: true, json: async () => ({ results: [{ id: 'item-1', type: 'CSV Collection', title }] }) });
  const loads = [];
  const load = async (file, { source }) => { loads.push(source); return { loaded: 1 }; };

  // The same release the table holds: checked, nothing loaded.
  let out = await refresh.refreshIfDue({ fetchImpl: async () => listing('ONS Postcode Directory (August 2026)'), load });
  assert.equal(out.checked, true); assert.equal(out.loaded, false); assert.equal(out.why, 'already loaded');
  assert.deepEqual(loads, []);
  const after = await refresh.state();
  assert.ok(after.checked_at, 'and the check is written down');
  assert.equal(after.latest_release, '2026-08');

  // Checked this month: not asked again.
  out = await refresh.refreshIfDue({ fetchImpl: async () => { throw new Error('should not be called'); }, load });
  assert.equal(out.checked, false);

  // A newer release, forced past the month: downloaded and loaded, and the
  // table says which release is in.
  const fetchImpl = async (url) => (url.includes('/content/items/') ? { ok: true, body: (await import('node:stream')).Readable.from(['zip']) } : listing('ONS Postcode Directory (November 2026)'));
  out = await refresh.refreshIfDue({ force: true, fetchImpl, load });
  assert.equal(out.loaded, true); assert.equal(out.release, '2026-11');
  assert.deepEqual(loads, ['onspd-2026-11']);
  const loaded = await refresh.state();
  assert.equal(loaded.loaded_release, '2026-11'); assert.equal(loaded.loading_since, null);

  // A check that fails says so, and is not silent.
  out = await refresh.refreshIfDue({ force: true, fetchImpl: async () => ({ ok: false, status: 503 }), load });
  assert.equal(out.loaded, false); assert.match((await refresh.state()).last_error, /503/);
});
