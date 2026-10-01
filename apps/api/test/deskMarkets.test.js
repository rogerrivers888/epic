/**
 * The Markets tab API (desk/markets.js; Markets design brief, step 4).
 *
 * Reads for the list and the market page, and the wording store the wording
 * screen edits — including the drift maintenance the step-3 review deferred to
 * here: writing an en-US snapshots the English version it was written against,
 * and editing the English bumps it, so a stale en-US shows as drift.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
test.after(() => pool.end());

const m = await import('../src/desk/markets.js');

const seedWord = (namespace, key, en_gb, en_us = null, extra = {}) => query(
  `insert into market_wording (namespace, key, en_gb, en_us, suggestion, machine_allowed, en_gb_version, en_gb_version_when_us_written, looked_at)
   values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
   on conflict (namespace, key) do update set en_gb = excluded.en_gb, en_us = excluded.en_us,
     suggestion = excluded.suggestion, en_gb_version = excluded.en_gb_version,
     en_gb_version_when_us_written = excluded.en_gb_version_when_us_written, looked_at = excluded.looked_at`,
  [namespace, key, en_gb, en_us, extra.suggestion ?? null, extra.machine ?? true,
    extra.version ?? 1, extra.writtenAgainst ?? null, extra.looked ? new Date() : null]);

test('the markets list carries a places count and a go-live checklist', async () => {
  const list = await m.listMarkets();
  const gb = list.find((x) => x.code === 'GB');
  assert.equal(gb.status, 'soft');
  assert.equal(gb.currency, 'GBP');
  assert.equal(typeof gb.places, 'number');
  assert.equal(gb.checklist.costBands, true, 'GB has seeded cost bands');
  // Portugal has null cost bands → checklist not ready there.
  const pt = list.find((x) => x.code === 'PT');
  assert.equal(pt.checklist.costBands, false, 'Portugal needs its own bands');
  assert.equal(pt.ready, false);
});

test('sources: connected out of the ones that can exist here — Portugal reads 3 of 4', async () => {
  const list = await m.listMarkets();
  const pt = list.find((x) => x.code === 'PT');
  // osm not loaded (notConnected), wikidata/wikipedia/site connected, fsa/ons absent.
  assert.equal(pt.sourcesConnected, 3, 'three connected');
  assert.equal(pt.sourcesCanExist, 4, 'out of the four that can exist (absent ones excluded)');
  assert.equal(pt.checklist.sources, false, 'a not-connected source fails the go-live check');
  // GB is live with everything connected.
  const gb = list.find((x) => x.code === 'GB');
  assert.equal(gb.sourcesConnected, gb.sourcesCanExist, 'GB has everything connected');
  assert.equal(gb.checklist.sources, true);
});

test('Connect wires up a not-connected source, and it is undoable', async () => {
  const before = (await m.getMarket('PT')).sourcesConnected;
  const res = await m.connectSource('PT', 'osm', 'sarah@epic.day');
  assert.ok(res.change, 'the change id comes back');
  const after = await m.getMarket('PT');
  assert.equal(after.sourcesConnected, before + 1, 'one more connected');
  assert.equal(after.checklist.sources, true, 'nothing left unconnected');
  // Absent sources cannot be connected.
  await assert.rejects(() => m.connectSource('PT', 'fsa', 'sarah@epic.day'), /cannot exist/);
  // Undo restores the not-connected state.
  const { rows: [chg] } = await query(`select * from bo_changes where subject_id='PT/source/osm' order by at desc limit 1`);
  await m.undoMarketSource({ change: chg, who: 'sarah@epic.day' });
  assert.equal((await m.getMarket('PT')).sourcesConnected, before, 'undo puts it back');
});

test('cost bands carry who set them and when', async () => {
  const gb = await m.getMarket('GB');
  assert.ok(gb.costBandsSetBy, 'the bands say who set them');
  assert.ok(gb.costBandsAt, 'and when');
});

test('setting a null-band market\'s cost bands fills four half-open bands, and is undoable', async () => {
  const before = await m.getMarket('PT'); // Portugal is seeded with no bands
  assert.equal(before.checklist.costBands, false, 'Portugal starts with no bands');
  const res = await m.setCostBands('PT', { t1: 1200, t2: 3000 }, 'sarah@epic.day');
  assert.ok(res.change, 'the change id comes back');
  assert.deepEqual(res.bands.map((b) => [b.symbol, b.min, b.max]), [
    ['Free', 0, 0], ['€', 1, 1200], ['€€', 1200, 3000], ['€€€', 3000, null],
  ], 'four contiguous half-open bands in the market currency');
  const after = await m.getMarket('PT');
  assert.equal(after.checklist.costBands, true, 'now it has bands');
  assert.equal(after.costBandsSetBy, 'sarah@epic.day', 'and says who set them');
  // The two thresholds must be whole minor units, ascending, with a real first band.
  await assert.rejects(() => m.setCostBands('PT', { t1: 3000, t2: 1200 }, 'sarah@epic.day'), /1 < first < second/, 'descending');
  await assert.rejects(() => m.setCostBands('PT', { t1: 0, t2: 100 }, 'sarah@epic.day'), /1 < first < second/, 'zero first');
  await assert.rejects(() => m.setCostBands('PT', { t1: 1, t2: 100 }, 'sarah@epic.day'), /1 < first < second/, 't1 = 1 is an empty [1,1) band');
  await assert.rejects(() => m.setCostBands('PT', { t1: 1200.4, t2: 3000 }, 'sarah@epic.day'), /whole minor units/, 'fractional minor units, checked before rounding');
  await assert.rejects(() => m.setCostBands('PT', { t1: 1200, t2: 3000, basis: 'made up' }, 'sarah@epic.day'), /judgement.*prices/, 'basis is an enum');
  await assert.rejects(() => m.setCostBands('PT', { t1: 1200, t2: 3000 }, null), /says who made it/);
  // Undo restores "not known yet".
  const { rows: [chg] } = await query(`select * from bo_changes where subject_id='PT/cost-bands' order by at desc limit 1`);
  await m.undoCostBands({ change: chg, who: 'sarah@epic.day' });
  assert.equal((await m.getMarket('PT')).checklist.costBands, false, 'undo puts it back to not known yet');
});

test('the blocked list is the code constant, Vietnam included — never rows', async () => {
  const blocked = m.blockedMarkets();
  assert.ok(blocked.some((b) => b.name === 'Vietnam'));
  assert.equal(blocked.length, 9);
  // And no blocked market is in the list.
  const list = await m.listMarkets();
  assert.ok(!list.some((x) => x.code === 'VN'));
});

test('a market page carries its not-applicable subcategories', async () => {
  await query(`insert into market_subcategories (market_code, subcategory, applicable) values ('US','soft-play', false)
               on conflict (market_code, subcategory) do update set applicable = excluded.applicable`);
  const us = await m.getMarket('US');
  assert.equal(us.midLevelName, 'State');
  assert.ok(us.notApplicable.includes('soft-play'), 'a not-applicable subcategory is listed');
});

test('wording status: not-looked-at, same, changed, needs-review, drift', async () => {
  await seedWord('interface', 'w.notlooked', 'Trips', null);                                   // untouched
  await seedWord('interface', 'w.same', 'Places', null, { looked: true });                     // looked, judged same
  await seedWord('places', 'w.changed', 'Car park', 'Parking lot', { version: 2, writtenAgainst: 2, looked: true });
  await seedWord('interface', 'w.suggested', 'Nappy change', null, { suggestion: 'Diaper changing' });
  await seedWord('places', 'w.drifted', 'Football pitch', 'Soccer field', { version: 3, writtenAgainst: 2, looked: true });
  const byKey = Object.fromEntries((await m.listWording('interface')).concat(await m.listWording('places')).map((w) => [w.key, w.status]));
  assert.equal(byKey['w.notlooked'], 'not-looked-at', 'an untouched key is not blank');
  assert.equal(byKey['w.same'], 'same');
  assert.equal(byKey['w.changed'], 'changed');
  assert.equal(byKey['w.suggested'], 'needs-review');
  assert.equal(byKey['w.drifted'], 'drift');
});

test('"Same in both" marks a key looked at, undoably; typing also counts as looking', async () => {
  await seedWord('interface', 'w.mark', 'Toilets', null);
  assert.equal((await m.listWording('interface')).find((w) => w.key === 'w.mark').status, 'not-looked-at');
  const res = await m.markSame('interface', 'w.mark', 'sarah@epic.day');
  assert.ok(res.change);
  assert.equal((await m.listWording('interface')).find((w) => w.key === 'w.mark').status, 'same');
  // Undo → back to not looked at.
  const { rows: [chg] } = await query(`select * from bo_changes where subject_id='interface/w.mark' order by at desc limit 1`);
  await m.undoWordingLooked({ change: chg, who: 'sarah@epic.day' });
  assert.equal((await m.listWording('interface')).find((w) => w.key === 'w.mark').status, 'not-looked-at');
});

test('changing the English un-looks a key judged "same" — it must be looked at again', async () => {
  await seedWord('interface', 'w.wassame', 'Lift', null, { looked: true });
  assert.equal((await m.listWording('interface')).find((w) => w.key === 'w.wassame').status, 'same');
  const res = await m.setEnGb('interface', 'w.wassame', 'Lift (goods)', 'sarah@epic.day');
  assert.equal((await m.listWording('interface')).find((w) => w.key === 'w.wassame').status, 'not-looked-at',
    'the "same" judgement was against the old English');
  // Undo restores both the English and the looked-at state it cleared.
  const { rows: [chg] } = await query('select * from bo_changes where id = $1', [res.change]);
  await m.undoWording({ change: chg, who: 'sarah@epic.day' });
  const back = (await m.listWording('interface')).find((w) => w.key === 'w.wassame');
  assert.equal(back.enGB, 'Lift');
  assert.equal(back.status, 'same', 'looked-at comes back on undo');
});

test('"Same in both" clears an existing American form, undoably', async () => {
  await seedWord('places', 'w.wasch', 'Car park', 'Parking lot', { version: 1, writtenAgainst: 1, looked: true });
  assert.equal((await m.listWording('places')).find((w) => w.key === 'w.wasch').status, 'changed');
  const res = await m.markSame('places', 'w.wasch', 'sarah@epic.day');
  const row = (await m.listWording('places')).find((w) => w.key === 'w.wasch');
  assert.equal(row.status, 'same');
  assert.equal(row.enUS, null, 'the American form is gone');
  const { rows: [chg] } = await query('select * from bo_changes where id = $1', [res.change]);
  await m.undoWordingLooked({ change: chg, who: 'sarah@epic.day' });
  assert.equal((await m.listWording('places')).find((w) => w.key === 'w.wasch').enUS, 'Parking lot', 'undo restores it');
});

test('"Same in both" dismisses a machine suggestion — the reject path', async () => {
  await seedWord('interface', 'w.reject', 'Nappy change', null, { suggestion: 'Diaper changing' });
  assert.equal((await m.listWording('interface')).find((w) => w.key === 'w.reject').status, 'needs-review');
  const res = await m.markSame('interface', 'w.reject', 'sarah@epic.day');
  const row = (await m.listWording('interface')).find((w) => w.key === 'w.reject');
  assert.equal(row.status, 'same', 'looked at and the British line kept');
  assert.equal(row.suggestion, null, 'the suggestion is gone');
  // Undo restores the dismissed suggestion.
  const { rows: [chg] } = await query('select * from bo_changes where id = $1', [res.change]);
  await m.undoWordingLooked({ change: chg, who: 'sarah@epic.day' });
  const back = (await m.listWording('interface')).find((w) => w.key === 'w.reject');
  assert.equal(back.suggestion, 'Diaper changing', 'the suggestion comes back on undo');
  assert.equal(back.status, 'needs-review');
});

test('a subcategory key carries a US count and a "not applicable here" state', async () => {
  await seedWord('places', 'sub.softplay', 'Soft play', null);
  // No US places → an amber real zero, and status not-looked-at (not blank).
  let row = (await m.listWording('places')).find((w) => w.key === 'sub.softplay');
  assert.equal(row.subcategory, 'softplay');
  assert.equal(row.usCount, 0, 'a real zero, distinct from not applicable');
  // Mark it not applicable in the US → status flips, undoable.
  const res = await m.markNotApplicable('softplay', 'sarah@epic.day');
  assert.ok(res.change);
  row = (await m.listWording('places')).find((w) => w.key === 'sub.softplay');
  assert.equal(row.status, 'not-applicable');
  const { rows: [chg] } = await query(`select * from bo_changes where subject_id='US/softplay' order by at desc limit 1`);
  await m.undoNotApplicable({ change: chg, who: 'sarah@epic.day' });
  assert.equal((await m.listWording('places')).find((w) => w.key === 'sub.softplay').status, 'not-looked-at');
});

test('setEnUs writes the American form, snapshots the version, clears the suggestion, logs it', async () => {
  await seedWord('interface', 'w.edit', 'Nappy change', null, { suggestion: 'Diaper changing', version: 4 });
  const res = await m.setEnUs('interface', 'w.edit', 'Diaper changing', 'sarah@epic.day');
  assert.ok(res.change, 'the change id comes back for an Undo toast');
  const { rows } = await query(`select en_us, suggestion, en_gb_version_when_us_written, set_by from market_wording where namespace='interface' and key='w.edit'`);
  assert.equal(rows[0].en_us, 'Diaper changing');
  assert.equal(rows[0].suggestion, null, 'the suggestion is consumed');
  assert.equal(rows[0].en_gb_version_when_us_written, 4, 'the English version is snapshotted');
  assert.equal(rows[0].set_by, 'sarah@epic.day');
  const { rows: chg } = await query(`select before, after from bo_changes where area='Markets' and subject_id='interface/w.edit'`);
  assert.equal(chg.length, 1, 'the edit is logged in Changes');
  assert.equal(chg[0].after, 'Diaper changing', 'the log keeps the new value');
});

test('re-saving the same English does not bump the version, so a matching en-US stays put', async () => {
  await seedWord('places', 'w.nochange', 'Car park', 'Parking lot', { version: 2, writtenAgainst: 2 });
  const res = await m.setEnGb('places', 'w.nochange', 'Car park', 'sarah@epic.day');
  assert.equal(res.unchanged, true);
  const row = (await m.listWording('places')).find((w) => w.key === 'w.nochange');
  assert.equal(row.status, 'changed', 'unchanged English does not fabricate drift');
  const { rows } = await query(`select en_gb_version from market_wording where namespace='places' and key='w.nochange'`);
  assert.equal(rows[0].en_gb_version, 2, 'the version is untouched');
});

test('editing the English bumps the version, so a written en-US drifts', async () => {
  await seedWord('places', 'w.src', 'Car park', 'Parking lot', { version: 1, writtenAgainst: 1 });
  // Not drifted yet.
  let row = (await m.listWording('places')).find((w) => w.key === 'w.src');
  assert.equal(row.status, 'changed');
  await m.setEnGb('places', 'w.src', 'Car park (covered)', 'sarah@epic.day');
  row = (await m.listWording('places')).find((w) => w.key === 'w.src');
  assert.equal(row.status, 'drift', 'the en-US now trails the English');
  assert.equal(row.enGB, 'Car park (covered)');
});

test('whitespace is not wording: en-GB rejects it, en-US clears back to "same"', async () => {
  await seedWord('interface', 'w.ws', 'Toilets', 'Restrooms', { version: 2, writtenAgainst: 2 });
  await assert.rejects(() => m.setEnGb('interface', 'w.ws', '   ', 'sarah@epic.day'), /cannot be blank/);
  await m.setEnUs('interface', 'w.ws', '   ', 'sarah@epic.day');
  const { rows } = await query(`select en_us, en_gb_version_when_us_written from market_wording where namespace='interface' and key='w.ws'`);
  assert.equal(rows[0].en_us, null, 'a whitespace en-US clears to null');
  assert.equal(rows[0].en_gb_version_when_us_written, null, 'and its drift snapshot is cleared');
  const row = (await m.listWording('interface')).find((w) => w.key === 'w.ws');
  assert.equal(row.status, 'same');
});

test('setEnGb creates a wording row when the key is new, and can make a collection key', async () => {
  const res = await m.setEnGb('interface', 'brand.new.key', 'A new line', 'sarah@epic.day');
  assert.equal(res.created, true);
  const row = (await m.listWording('interface')).find((w) => w.key === 'brand.new.key');
  assert.equal(row.enGB, 'A new line');
  // A collection key is created handwritten-only (the constraint would reject
  // otherwise), so the create must not set it machine-allowed.
  await m.setEnGb('collection', 'coll.line', 'It is raining again', 'sarah@epic.day');
  const { rows } = await query(`select machine_allowed from market_wording where namespace='collection' and key='coll.line'`);
  assert.equal(rows[0].machine_allowed, false, 'collection copy is handwritten only');
});

test('re-accepting a drifted en-US is "Still right" — it refreshes the snapshot, not a no-op', async () => {
  await seedWord('places', 'w.still', 'Football pitch', 'Soccer field', { version: 3, writtenAgainst: 2 });
  assert.equal((await m.listWording('places')).find((w) => w.key === 'w.still').status, 'drift');
  const res = await m.setEnUs('places', 'w.still', 'Soccer field', 'sarah@epic.day');
  assert.notEqual(res.unchanged, true, 'confirming a drifted key is a real action');
  const row = (await m.listWording('places')).find((w) => w.key === 'w.still');
  assert.equal(row.status, 'changed', 'the drift is resolved');
  const { rows } = await query(`select en_gb_version_when_us_written from market_wording where namespace='places' and key='w.still'`);
  assert.equal(rows[0].en_gb_version_when_us_written, 3, 'the snapshot catches up to the current English');
});

test('an unchanged en-US writes nothing and logs nothing', async () => {
  await seedWord('interface', 'w.noop', 'Toilets', 'Restrooms', { version: 2, writtenAgainst: 2 });
  await query(`delete from bo_changes where subject_id = 'interface/w.noop'`);
  const res = await m.setEnUs('interface', 'w.noop', 'Restrooms', 'sarah@epic.day');
  assert.equal(res.unchanged, true);
  const { rows } = await query(`select 1 from bo_changes where subject_id='interface/w.noop'`);
  assert.equal(rows.length, 0, 'no audit row for a no-op');
});

test('wording edits are undoable — the desk Undo flow restores them', async () => {
  // en-US edit, then undo → back to the previous American form.
  await seedWord('places', 'w.undo1', 'Car park', 'Car park', { version: 1, writtenAgainst: 1 });
  await m.setEnUs('places', 'w.undo1', 'Parking lot', 'sarah@epic.day');
  const { rows: [chg] } = await query(`select * from bo_changes where subject_id='places/w.undo1' order by at desc limit 1`);
  await m.undoWording({ change: chg, who: 'sarah@epic.day' });
  const back = (await query(`select en_us from market_wording where namespace='places' and key='w.undo1'`)).rows[0];
  assert.equal(back.en_us, 'Car park', 'the previous en-US is restored');
  assert.ok((await query(`select undone_at from bo_changes where id=$1`, [chg.id])).rows[0].undone_at, 'the change is marked undone');

  // Undoing an English edit restores the version too, so a matching en-US that
  // the edit had drifted reads as current again.
  await seedWord('places', 'w.undo3', 'Football pitch', 'Soccer field', { version: 1, writtenAgainst: 1 });
  await m.setEnGb('places', 'w.undo3', 'Football pitch (5-a-side)', 'sarah@epic.day');
  assert.equal((await m.listWording('places')).find((w) => w.key === 'w.undo3').status, 'drift');
  const { rows: [ed] } = await query(`select * from bo_changes where subject_id='places/w.undo3' order by at desc limit 1`);
  await m.undoWording({ change: ed, who: 'sarah@epic.day' });
  const r = (await m.listWording('places')).find((w) => w.key === 'w.undo3');
  assert.equal(r.enGB, 'Football pitch', 'the English is restored');
  assert.equal(r.status, 'changed', 'and the en-US no longer reads as drifted');

  // Creating a key then undoing removes the row.
  await m.setEnGb('interface', 'w.undo2', 'Fresh key', 'sarah@epic.day');
  const { rows: [made] } = await query(`select * from bo_changes where subject_id='interface/w.undo2' order by at desc limit 1`);
  await m.undoWording({ change: made, who: 'sarah@epic.day' });
  const gone = await query(`select 1 from market_wording where namespace='interface' and key='w.undo2'`);
  assert.equal(gone.rows.length, 0, 'undoing a create removes the row');
});

test('outstanding misses only: once the key is registered (en-GB exists), its miss drops out', async () => {
  // An absent key that was hit — no row at all — is still outstanding.
  await query(`insert into wording_misses (namespace, key, locale, seen) values ('interface','gap.open','en-US', 5)
               on conflict (namespace, key, locale) do update set seen = excluded.seen`);
  // A key that has since been registered (has an en-GB source) is resolved,
  // even with en-US still blank — the fallback now renders, so it is not a miss.
  await seedWord('interface', 'gap.registered', 'Lift', null);
  await query(`insert into wording_misses (namespace, key, locale, seen) values ('interface','gap.registered','en-US', 3)
               on conflict (namespace, key, locale) do update set seen = excluded.seen`);
  const misses = await m.wordingMisses();
  assert.ok(misses.some((x) => x.key === 'gap.open'), 'an unregistered key is listed');
  assert.ok(!misses.some((x) => x.key === 'gap.registered'), 'a registered key is not');
});
