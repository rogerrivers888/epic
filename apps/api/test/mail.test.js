import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, suppressedBy, HARD_BOUNCES } from '../src/domain/mail.js';

const sent = { status: 'sent', delivered_at: null, opened_at: null, bounced_at: null };

test('a delivery moves a sent message to delivered, once', () => {
  const p = applyEvent(sent, { RecordType: 'Delivery', DeliveredAt: '2026-09-13T10:00:00Z' });
  assert.equal(p.status, 'delivered');
  assert.equal(p.delivered_at.toISOString(), '2026-09-13T10:00:00.000Z');
  assert.equal(applyEvent({ ...sent, status: 'delivered', delivered_at: p.delivered_at }, { RecordType: 'Delivery' }), null);
});

test('an open is the furthest a message goes, and a late delivery does not pull it back', () => {
  const opened = applyEvent(sent, { RecordType: 'Open', ReceivedAt: '2026-09-13T11:00:00Z' });
  assert.equal(opened.status, 'opened');
  assert.ok(opened.delivered_at, 'an open implies delivery');
  assert.equal(applyEvent({ ...sent, ...opened }, { RecordType: 'Delivery' }), null);
  assert.equal(applyEvent({ ...sent, ...opened }, { RecordType: 'Open' }), null, 'a second open says nothing new');
});

test('a hard bounce is bounced with the reason; a transient one is delayed', () => {
  const hard = applyEvent(sent, { RecordType: 'Bounce', Type: 'HardBounce', Description: 'The server was unable to deliver your message', BouncedAt: '2026-09-13T12:00:00Z' });
  assert.equal(hard.status, 'bounced');
  assert.match(hard.failure, /HardBounce — The server/);
  const soft = applyEvent(sent, { RecordType: 'Bounce', Type: 'Transient', Details: 'mailbox full' });
  assert.equal(soft.status, 'soft_bounced');
  assert.ok(HARD_BOUNCES.has('BadEmailAddress') && !HARD_BOUNCES.has('Transient'));
});

test('a soft bounce after delivery is noted, not a state change', () => {
  const p = applyEvent({ ...sent, status: 'delivered', delivered_at: new Date() }, { RecordType: 'Bounce', Type: 'Transient', Details: 'greylisted' });
  assert.equal(p.status, undefined);
  assert.equal(p.bounce_type, 'Transient');
});

test('a complaint outranks everything and an unknown record type says nothing', () => {
  assert.equal(applyEvent({ ...sent, status: 'opened' }, { RecordType: 'SpamComplaint' }).status, 'complained');
  assert.equal(applyEvent(sent, { RecordType: 'SubscriptionChange' }), null);
});

test('a hard bounce or a complaint in the last ninety days suppresses the address; older ones do not', () => {
  const now = new Date('2026-09-13T00:00:00Z');
  assert.ok(suppressedBy([{ status: 'bounced', bounced_at: '2026-08-01T00:00:00Z' }], now));
  assert.ok(suppressedBy([{ status: 'complained', bounced_at: '2026-09-12T00:00:00Z' }], now));
  assert.equal(suppressedBy([{ status: 'bounced', bounced_at: '2026-05-01T00:00:00Z' }], now), null);
  assert.equal(suppressedBy([{ status: 'soft_bounced', bounced_at: '2026-09-12T00:00:00Z' }], now), null);
});
