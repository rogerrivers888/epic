import { test } from 'node:test';
import assert from 'node:assert/strict';

import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const labels = await import('../src/repositories/taxonomyLabels.js');

test.after(() => pool.end());

test('a Wikidata type answered Travel is closed to the atlas, like one set aside', async (t) => {
  await query(`insert into place_kinds (qid, label, admit) values ('Q999000001', 'railway station (test)', true)
               on conflict (qid) do update set admit = true`);
  t.after(() => query(`delete from place_kinds where qid = 'Q999000001'`));
  const travel = await labels.save({ namespace: 'wikidata', key: 'Q999000001', decision: 'travel' });
  assert.equal(travel.active, false, 'infrastructure is never harvested, so the fence has nothing to catch');
  const nearby = await labels.save({ namespace: 'wikidata', key: 'Q999000001', decision: 'nearby' });
  assert.equal(nearby.active, true);
  const aside = await labels.save({ namespace: 'wikidata', key: 'Q999000001', decision: 'aside' });
  assert.equal(aside.active, false);
});
