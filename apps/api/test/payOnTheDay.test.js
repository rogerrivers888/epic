/**
 * Pay on the day (register L10; sources/payOnTheDay.js, migration 378). Stripe is handed in; nothing leaves the
 * machine. Epic's fee goes on the organiser's card, on Epic's own account — never a destination charge, never a
 * Connect account — up front on who said they're coming, topped up when more came, never refunded when fewer did.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
const { aHousehold, testDatabase } = await import('./helpers/db.js');
const { query, pool } = await testDatabase();
const pod = await import('../src/sources/payOnTheDay.js');
const stripe = await import('../src/sources/stripe.js');
const settings = await import('../src/repositories/hostingSettings.js');
const { checklist } = await import('../src/domain/lanes.js');

test.after(async () => { settings.forget(); await pool?.end?.(); });
const ready = () => ({ ready: true });

/** A private event paid on the day, its session starting `startsInHours` from now, two guests of £20 each said yes. */
async function anEvent({ startsInHours = 20, card = true } = {}) {
  const { household: hh } = await aHousehold(query);
  await query('update households set stripe_customer_id = $2 where id = $1', [hh.id, `cus_${crypto.randomUUID().slice(0, 10)}`]);
  const { rows: [host] } = await query(`insert into hosts (household_id, name, fee_payment_method) values ($1, 'Org', $2) returning *`, [hh.id, card ? 'pm_org' : null]);
  const start = new Date(Date.now() + startsInHours * 3_600_000);
  const on = start.toISOString().slice(0, 10);
  const at = start.toISOString().slice(11, 16);
  const { rows: [offer] } = await query(
    `insert into host_offers (host_id, shape, lane, state, title, visibility, money, price_mode, price_pence, time_zone) values ($1, 'oneoff', 'oneoff', 'live', 'Supper club', 'private', 'direct', 'same_each', 2000, 'UTC') returning *`, [host.id]);
  const end = new Date(start.getTime() + 2 * 3_600_000);
  const { rows: [s] } = await query(`insert into offer_sessions (offer_id, n, on_date, starts_at, ends_at, ends_on) values ($1, 1, $2, $3, $4, $5) returning *`,
    [offer.id, on, at, end.toISOString().slice(11, 16), end.toISOString().slice(0, 10)]);
  for (let i = 0; i < 2; i += 1) {
    const { household: gh } = await aHousehold(query);
    const { rows: [b] } = await query(`insert into experience_bookings (offer_id, host_id, household_id, heads, state, value_pence) values ($1, $2, $3, 1, 'confirmed', 2000) returning *`, [offer.id, host.id, gh.id]);
    await query(`insert into booking_sessions (booking_id, session_id) values ($1, $2)`, [b.id, s.id]);
  }
  return { host, offer, session: s };
}

test('the fee is Epic’s own: no destination, no Connect account — off-session on the organiser’s card', () => {
  const body = stripe.organiserFeeBody({ customerId: 'cus_1', paymentMethod: 'pm_1', amountPence: 120, feeId: 'f1', offerId: 'o1', sessionId: 's1', kind: 'upfront', householdId: 'h1' });
  assert.equal(body.transfer_data, undefined);
  assert.equal(body.on_behalf_of, undefined);
  assert.equal(body.application_fee_amount, undefined);
  assert.deepEqual([body.customer, body.payment_method, body.off_session, body.confirm, body.metadata.epic_kind], ['cus_1', 'pm_1', true, true, 'organiser_fee']);
});

test('up front, 24 hours before: 3% of the ticket price × those who said they’re coming, once', async () => {
  settings.forget();
  const { session, host } = await anEvent({ startsInHours: 20 });
  const far = await anEvent({ startsInHours: 60 });
  const charged = [];
  const charge = async (a) => { charged.push(a); return { id: `pi_fee_${charged.length}`, status: 'succeeded' }; };
  await pod.chargeUpfrontFees({ status: ready, charge });
  await pod.chargeUpfrontFees({ status: ready, charge });
  const mine = charged.filter((c) => c.sessionId === session.id);
  assert.equal(mine.length, 1, 'once');
  assert.deepEqual([mine[0].amountPence, mine[0].paymentMethod, mine[0].kind], [120, 'pm_org', 'upfront']);
  assert.equal(charged.some((c) => c.sessionId === far.session.id), false, 'not two and a half days out');
  const { rows: [f] } = await query(`select heads, base_pence, fee_pence, state from organiser_fees where session_id = $1`, [session.id]);
  assert.deepEqual([f.heads, f.base_pence, f.fee_pence, f.state], [2, 4000, 120, 'paid']);
  assert.ok(host);
});

test('no card, or a card refused: the organiser is told, the problem is logged, nothing is called off', async () => {
  settings.forget();
  const { session, host, offer } = await anEvent({ startsInHours: 10, card: false });
  await pod.chargeUpfrontFees({ status: ready, charge: async () => { throw new Error('not reached'); } });
  const { rows: [f] } = await query(`select state, failure from organiser_fees where session_id = $1`, [session.id]);
  assert.deepEqual([f.state, f.failure], ['failed', 'no_card']);
  assert.equal((await query(`select kind, status from payment_problems where host_id = $1`, [host.id])).rows[0].status, 'open');
  assert.equal((await query(`select count(*)::int as n from notifications where household_id = $1 and kind = 'organiser_fee_failed'`, [host.household_id])).rows[0].n, 1);
  assert.equal((await query('select state from host_offers where id = $1', [offer.id])).rows[0].state, 'live');
  // A card saved later: the refused fee is taken then, and the problem put right.
  await query(`update hosts set fee_payment_method = 'pm_new', fee_card_saved_at = now() + interval '1 second' where id = $1`, [host.id]);
  assert.equal(await pod.retryOrganiserFees({ status: ready, charge: async () => ({ id: 'pi_late', status: 'succeeded' }) }), 1);
  assert.equal((await query(`select status from payment_problems where host_id = $1`, [host.id])).rows[0].status, 'resolved');
});

test('how many came: more, topped up on the saved card; fewer, no refund; once, and only within 48 hours after', async () => {
  settings.forget();
  const { session, host } = await anEvent({ startsInHours: -3 });
  // The up-front charge, as if made the day before.
  await query(`insert into organiser_fees (offer_id, session_id, host_id, kind, heads, base_pence, rate_pct, fee_pence, state) values ($1, $2, $3, 'upfront', 2, 4000, 3, 120, 'paid')`, [session.offer_id, session.id, host.id]);
  const charged = [];
  const charge = async (a) => { charged.push(a); return { id: `pi_top_${charged.length}`, status: 'succeeded' }; };
  await assert.rejects(() => pod.confirmHeadcount({ sessionId: session.id, hostId: crypto.randomUUID(), heads: 3, charge }), /isn’t yours/);
  const r = await pod.confirmHeadcount({ sessionId: session.id, hostId: host.id, heads: 4, charge });
  assert.equal(r.topUpPence, 120, 'two more at £20: 3% of £40');
  assert.deepEqual([charged[0].amountPence, charged[0].kind], [120, 'topup']);
  await assert.rejects(() => pod.confirmHeadcount({ sessionId: session.id, hostId: host.id, heads: 5, charge }), /already/);

  const fewer = await anEvent({ startsInHours: -3 });
  await query(`insert into organiser_fees (offer_id, session_id, host_id, kind, heads, base_pence, rate_pct, fee_pence, state) values ($1, $2, $3, 'upfront', 2, 4000, 3, 120, 'paid')`, [fewer.session.offer_id, fewer.session.id, fewer.host.id]);
  assert.equal((await pod.confirmHeadcount({ sessionId: fewer.session.id, hostId: fewer.host.id, heads: 1, charge })).topUpPence, 0, 'fewer came: Epic’s fee is not refunded');

  const late = await anEvent({ startsInHours: -60 });
  await assert.rejects(() => pod.confirmHeadcount({ sessionId: late.session.id, hostId: late.host.id, heads: 9, charge }), /within 48 hours/);
  const early = await anEvent({ startsInHours: 5 });
  await assert.rejects(() => pod.confirmHeadcount({ sessionId: early.session.id, hostId: early.host.id, heads: 2, charge }), /once it’s happened/);
});

test('a private event paid on the day can’t be sent without a card for Epic’s fee', () => {
  const offer = { visibility: 'private', money: 'direct', price_mode: 'same_each' };
  const items = checklist(offer, { host: { fee_payment_method: null }, account: {} });
  const fee = items.find((i) => i.key === 'fee_card');
  assert.deepEqual([fee.blocks, fee.done], ['send', false]);
  assert.equal(checklist(offer, { host: { fee_payment_method: 'pm_1' }, account: {} }).find((i) => i.key === 'fee_card').done, true);
  assert.equal(checklist({ ...offer, money: 'epic' }, { host: {}, account: {} }).some((i) => i.key === 'fee_card'), false);
  assert.equal(checklist({ ...offer, price_mode: 'free' }, { host: {}, account: {} }).some((i) => i.key === 'fee_card'), false);
});

test('walk-ins only: nobody had said they were coming, so the top-up is at the event’s own price per person', async () => {
  settings.forget();
  const { session, host } = await anEvent({ startsInHours: -3 });
  await query(`insert into organiser_fees (offer_id, session_id, host_id, kind, heads, base_pence, rate_pct, fee_pence, state) values ($1, $2, $3, 'upfront', 0, 0, 3, 0, 'paid')`, [session.offer_id, session.id, host.id]);
  const r = await pod.confirmHeadcount({ sessionId: session.id, hostId: host.id, heads: 5, charge: async () => ({ id: 'pi_walk', status: 'succeeded' }) });
  assert.equal(r.topUpPence, 300, '5 × £20 = £100, 3%');
});

test('a fee the card refused is tried on a new card under a new key, and the checklist asks for a card until then', async () => {
  settings.forget();
  const { session, host } = await anEvent({ startsInHours: 10 });
  const keys = [];
  const declined = async (a) => { if (a.sessionId === session.id) keys.push(a.attempt); throw Object.assign(new Error('no'), { code: 'stripe_refused', detail: 'card_declined' }); };
  await pod.chargeUpfrontFees({ status: ready, charge: declined });
  const { rows: [h] } = await query('select * from hosts where id = $1', [host.id]);
  assert.ok(h.fee_card_failed_at);
  assert.equal(checklist({ visibility: 'private', money: 'direct', price_mode: 'same_each' }, { host: h, account: {} }).find((i) => i.key === 'fee_card').done, false);
  await query(`update hosts set fee_payment_method = 'pm_new2', fee_card_saved_at = now() + interval '1 second', fee_card_failed_at = null where id = $1`, [host.id]);
  await pod.retryOrganiserFees({ status: ready, charge: async (a) => { if (a.sessionId === session.id) keys.push(a.attempt); return { id: `pi_ok_${a.feeId}`, status: 'succeeded' }; } });
  assert.deepEqual(keys, [0, 1], 'a new attempt, so a new key');
  assert.equal((await query(`select state from organiser_fees where session_id = $1`, [session.id])).rows[0].state, 'paid');
});
