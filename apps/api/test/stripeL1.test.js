/**
 * Register L, held in code (3 Oct 2026). The one rule that matters most:
 * booking money never touches Epic's Stripe balance (L1). These tests fail if
 * a guest's payment is ever built without the host's account as its
 * destination, if anything in the server can make a Stripe transfer again,
 * or if a host's account is made without manual payouts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';

const stripe = await import('../src/sources/stripe.js');
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

test('L1: a guest’s payment is a destination charge to the host’s own account, or it is not made at all', () => {
  const body = stripe.paymentIntentBody({ amountPence: 5000, destination: 'acct_host', applicationFeePence: 750, bookingId: 'b1', offerId: 'o1', householdId: 'h1' });
  assert.deepEqual(body.transfer_data, { destination: 'acct_host' });
  assert.equal(body.on_behalf_of, 'acct_host', 'the host is merchant of record (L2)');
  assert.equal(body.application_fee_amount, 750, 'Epic takes its fee and nothing else');
  assert.equal(body.transfer_group, undefined, 'nothing to pass on later');
  assert.equal(body.metadata.epic_charge_model, 'destination');

  for (const destination of [undefined, null, '', 'not-an-account', 'cus_123']) {
    assert.throws(() => stripe.paymentIntentBody({ amountPence: 5000, destination, applicationFeePence: 0, bookingId: 'b1' }), (e) => e.code === 'host_not_ready', `refused: ${String(destination)}`);
  }
  // A tip: all of it to the host, the guest-paid admin fee as Epic's application fee (K3b).
  const tip = stripe.paymentIntentBody({ amountPence: 530, destination: 'acct_host', applicationFeePence: 30, bookingId: 'b1', kind: 'tip', tipId: 't1' });
  assert.deepEqual([tip.transfer_data.destination, tip.on_behalf_of, tip.application_fee_amount, tip.metadata.epic_tip_id], ['acct_host', 'acct_host', 30, 't1']);
  // A fee is never more than the payment, never negative, never a fraction.
  for (const fee of [-1, 6000, Number.NaN]) assert.throws(() => stripe.paymentIntentBody({ amountPence: 5000, destination: 'acct_host', applicationFeePence: fee, bookingId: 'b1' }), (e) => e.code === 'bad_application_fee');
  // No fee (an intro booking at 0%): no application fee sent, still a destination charge.
  assert.equal(stripe.paymentIntentBody({ amountPence: 5000, destination: 'acct_host', applicationFeePence: 0, bookingId: 'b1' }).application_fee_amount, undefined);
});

test('L1: nothing in the server can make a Stripe transfer — no separate charges and transfers, ever', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) {
        const text = fs.readFileSync(p, 'utf8');
        if (/['"`]\/(v1\/)?transfers['"`/]/.test(text)) offenders.push(path.relative(SRC, p));
      }
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, [], 'a call to Stripe’s /transfers would pass guest money through Epic’s balance');
  assert.equal(typeof stripe.transfer, 'undefined', 'and stripe.js has no transfer to call');
});

test('L5 / K11: a refund comes back out of the host’s balance, and Epic’s fee in proportion', () => {
  const r = stripe.refundBody({ paymentIntentId: 'pi_1', amountPence: 2500, cause: 'guest_cancelled', bookingId: 'b1' });
  assert.deepEqual([r.reverse_transfer, r.refund_application_fee, r.amount], [true, true, 2500]);
  // A payment from before L1 was on Epic's own balance: nothing of the host's to reverse.
  const old = stripe.refundBody({ paymentIntentId: 'pi_1', amountPence: 2500, cause: 'x', bookingId: 'b1', destination: false });
  assert.deepEqual([old.reverse_transfer, old.refund_application_fee], [undefined, undefined]);
});

test('L2 / L6 / L11: a host’s account is made by Accounts v2, merchant of record, Express, EPIC on statements', () => {
  const body = stripe.connectAccountBody({ hostId: 'host1', email: 'kate@example.com', legalName: 'Kate Anne Morris', dateOfBirth: '1984-07-09', displayName: 'Kate' });
  assert.equal(body.dashboard, 'express');
  assert.deepEqual(body.defaults.responsibilities, { fees_collector: 'application', losses_collector: 'application' });
  assert.deepEqual(body.configuration.merchant.capabilities, { card_payments: { requested: true } });
  // A destination charge needs transfers on the host's account as well, which Accounts v2 keeps on the recipient
  // configuration — the sandbox refused a booking without it (3 Oct 2026). Never on a dormant account.
  assert.deepEqual(body.configuration.recipient, { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } });
  assert.equal(stripe.connectAccountBody({ hostId: 'h', dormant: true }).configuration.recipient, undefined);
  assert.equal(body.configuration.merchant.statement_descriptor.prefix, 'EPIC');
  assert.deepEqual([body.identity.country, body.identity.entity_type], ['gb', 'individual']);
  assert.deepEqual(body.identity.individual, { email: 'kate@example.com', given_name: 'Kate Anne', surname: 'Morris', date_of_birth: { day: 9, month: 7, year: 1984 } });
  // Only what Epic was given: no half a name, no invented date.
  assert.deepEqual(stripe.prefillIndividual({ legalName: 'Cher', dateOfBirth: 'not a date' }), {});
});

test('L3: an account counts as ready only with card payments and payouts on; manual payouts are read, not assumed', () => {
  assert.equal(stripe.accountReady({ details_submitted: true, payouts_enabled: true }), false, 'a destination charge needs card payments too');
  assert.equal(stripe.accountReady({ details_submitted: true, payouts_enabled: true, charges_enabled: true }), true);
  const patch = stripe.hostPatchFromAccount({ details_submitted: true, charges_enabled: true, payouts_enabled: true, settings: { payouts: { schedule: { interval: 'daily' } } }, requirements: { currently_due: ['external_account'] }, external_accounts: { data: [{ last4: '1234' }] } });
  assert.deepEqual([patch.payoutsState, patch.stripePayoutsManual, patch.stripeRequirements.currentlyDue], ['ready', false, ['external_account']]);
  assert.ok(!JSON.stringify(patch).includes('1234'), 'never a bank detail');
});

test('L7: passport and a selfie; a UK licence only while its setting is on; tied to the host’s Person when there is one', () => {
  const plain = stripe.identitySessionBody({ returnUrl: 'https://x', hostId: 'h1' });
  assert.deepEqual(plain.options.document, { allowed_types: ['passport'], require_matching_selfie: true });
  assert.equal(plain.related_person, undefined, 'a free-event host: no account to tie it to');
  const licence = stripe.identitySessionBody({ returnUrl: 'https://x', hostId: 'h1', allowDrivingLicence: true });
  assert.deepEqual(licence.options.document.allowed_types, ['passport', 'driving_license']);
  const tied = stripe.identitySessionBody({ returnUrl: 'https://x', hostId: 'h1', relatedPerson: { account: 'acct_1', person: 'person_1' } });
  assert.deepEqual(tied.related_person, { account: 'acct_1', person: 'person_1' });
});

test('webhooks: either endpoint’s secret admits an event; none set admits nothing', () => {
  const was = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET];
  try {
    delete process.env.STRIPE_WEBHOOK_SECRET; delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    assert.deepEqual(stripe.webhookSecrets(), []);
    assert.equal(stripe.verifyWebhook('{}', 't=1,v1=00'), false);
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_a'; process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_b';
    assert.deepEqual(stripe.webhookSecrets(), ['whsec_a', 'whsec_b']);
    const t = Math.floor(Date.now() / 1000);
    const sign = (secret) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.{}`).digest('hex')}`;
    assert.equal(stripe.verifyWebhook('{}', sign('whsec_b')), true, 'the Connect endpoint’s event (a host’s payout) is admitted');
    assert.equal(stripe.verifyWebhook('{}', sign('whsec_c')), false);
  } finally {
    if (was[0] === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = was[0];
    if (was[1] === undefined) delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET; else process.env.STRIPE_CONNECT_WEBHOOK_SECRET = was[1];
  }
});

test('L7: the verified day is Stripe’s — the report’s time, else the event’s — never when Epic heard of it', () => {
  const at = (x) => stripe.verifiedAt(...x)?.toISOString() ?? null;
  assert.equal(at([{ last_verification_report: { created: 1790000000 } }]), new Date(1790000000 * 1000).toISOString());
  assert.equal(at([{ last_verification_report: 'vr_123' }, 1790003600]), new Date(1790003600 * 1000).toISOString(), 'an unexpanded report: the event’s time');
  assert.equal(at([{}]), null, 'nothing to say: the caller decides');
});

test('L11: the guest’s statement reads "EPIC* <host>" — 16 characters at most, letters and numbers only', () => {
  assert.equal(stripe.statementSuffix('Kate Morris'), 'KATE MORRIS');
  assert.equal(stripe.statementSuffix('Zoë O’Brien-Smythe & Co.'), 'ZOE O BRIEN SMYT');
  assert.equal(stripe.statementSuffix('12345'), null, 'at least one letter, or none at all');
  assert.equal(stripe.statementSuffix(null), null);
  const body = stripe.paymentIntentBody({ amountPence: 1000, destination: 'acct_h', applicationFeePence: 100, bookingId: 'b', hostName: 'Kate Morris' });
  assert.equal(body.statement_descriptor_suffix, 'KATE MORRIS');
  assert.equal(stripe.paymentIntentBody({ amountPence: 1000, destination: 'acct_h', applicationFeePence: 100, bookingId: 'b' }).statement_descriptor_suffix, undefined);
});

test('L15: what counts as Stripe acting on a host’s account — never a dormant account or a host still in Stripe’s form', () => {
  const t = stripe.accountTrouble;
  assert.equal(t(null), null);
  assert.equal(t({ disabledReason: null, detailsSubmitted: false, capabilities: { card_payments: null, transfers: null } }), null, 'dormant');
  assert.equal(t({ disabledReason: 'requirements.past_due', detailsSubmitted: false, capabilities: { card_payments: 'inactive', transfers: 'inactive' } }), null, 'still filling in the form');
  assert.equal(t({ disabledReason: null, detailsSubmitted: true, capabilities: { card_payments: 'active', transfers: 'active' } }), null, 'all well');
  assert.equal(t({ disabledReason: 'rejected.fraud', detailsSubmitted: false }).reason, 'rejected.fraud', 'Stripe rejecting it counts whenever');
  for (const r of ['listed', 'under_review', 'platform_paused', 'account_closed']) assert.equal(t({ disabledReason: r }).reason, r);
  assert.equal(t({ disabledReason: 'requirements.past_due', detailsSubmitted: true }).reason, 'requirements.past_due', 'disabled after sign-up');
  const off = t({ disabledReason: null, detailsSubmitted: true, capabilities: { card_payments: 'inactive', transfers: 'active' } });
  assert.equal(off.reason, 'inactive:card_payments');
  assert.match(off.words, /card payments/);
});
