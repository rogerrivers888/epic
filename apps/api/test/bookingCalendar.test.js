/**
 * The emailed calendar invite (3 Oct 2026): "You're booked" and "has moved" carry the booking's sessions as a
 * calendar file — one entry a booked session still to come, the area until the booking is confirmed, the same
 * UID each time so a calendar updates rather than doubles — and an email whose file cannot be made still goes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const { aHousehold, testDatabase } = await import('./helpers/db.js');
const { query, pool } = await testDatabase();
const notifications = await import('../src/repositories/notifications.js');
const { bookingCalendar, bookingOfLink } = await import('../src/sources/bookingCalendar.js');
const { plusDays, localDay } = await import('../src/domain/lanes.js');

test.after(() => pool.end());

const today = () => localDay(new Date(), 'Europe/London');

async function aBooking({ state = 'confirmed', addressHidden = true, title = 'Swim, splash; and float' } = {}) {
  const { household: h } = await aHousehold(query);
  const { household: guest, member } = await aHousehold(query);
  const { rows: [account] } = await query(
    "insert into accounts (household_id, member_id, email, role, status, name) values ($1,$2,$3,'customer','active','Maya') returning *",
    [guest.id, member.id, `m-${crypto.randomUUID().slice(0, 8)}@example.com`],
  );
  const { rows: [host] } = await query(`insert into hosts (household_id, name) values ($1, 'Tom') returning *`, [h.id]);
  const { rows: [offer] } = await query(
    `insert into host_offers (host_id, shape, lane, state, title, venue_label, venue_area, address_hidden, time_zone)
     values ($1, 'series', 'course', 'live', $2, '12 Pool Lane, Windsor', 'central Windsor', $3, 'Europe/London') returning *`,
    [host.id, title, addressHidden],
  );
  const s = async (n, days, state = 'scheduled', start = '10:00', end = '12:00') => (await query(
    `insert into offer_sessions (offer_id, n, on_date, starts_at, ends_at, state) values ($1, $2, $3, $4, $5, $6) returning *`,
    [offer.id, n, plusDays(today(), days), start, end, state],
  )).rows[0];
  const sessions = [await s(1, -7), await s(2, 7), await s(3, 14, 'called_off'), await s(4, 21, 'scheduled', null, null), await s(5, 28)];
  const { rows: [b] } = await query(
    `insert into experience_bookings (offer_id, host_id, household_id, state) values ($1, $2, $3, $4) returning *`,
    [offer.id, host.id, guest.id, state],
  );
  for (const [i, x] of sessions.entries()) {
    await query(`insert into booking_sessions (booking_id, session_id, state) values ($1, $2, $3)`, [b.id, x.id, i === 4 ? 'cancelled' : 'booked']);
  }
  return { b, guest, account, sessions };
}

const unfold = (ics) => ics.replace(/\r\n /g, '');

test('one entry for each booked session still to come, with a UID that stays the same', async () => {
  const { b, sessions } = await aBooking();
  const file = await bookingCalendar(b.id, { appUrl: 'https://epic.day' });
  assert.ok(file.name.endsWith('.ics'));
  assert.match(file.contentType, /^text\/calendar/);
  const ics = unfold(file.content);
  assert.ok(file.content.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'lines folded at 75 octets');
  // Past, called off and given up are left out: sessions 2 and 4.
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 2);
  assert.ok(ics.includes(`UID:${b.id}-${sessions[1].id}@epic.day`));
  assert.ok(ics.includes(`UID:${b.id}-${sessions[3].id}@epic.day`));
  assert.ok(!ics.includes(sessions[0].id) && !ics.includes(sessions[2].id) && !ics.includes(sessions[4].id));
  const day = plusDays(today(), 7).replace(/-/g, '');
  assert.ok(ics.includes(`DTSTART;TZID=Europe/London:${day}T100000`));
  assert.ok(ics.includes(`DTEND;TZID=Europe/London:${day}T120000`));
  // No start time: a whole-day entry.
  assert.ok(ics.includes(`DTSTART;VALUE=DATE:${plusDays(today(), 21).replace(/-/g, '')}`));
  assert.ok(ics.includes('SUMMARY:Swim\\, splash\\; and float'));
  assert.ok(ics.includes('LOCATION:12 Pool Lane\\, Windsor'), 'confirmed: the exact place');
  assert.ok(ics.includes(`URL:https://epic.day/bookings/${b.id}`));
});

test('the area until the booking is confirmed, and nothing for a cancelled booking or a stranger id', async () => {
  const pending = await aBooking({ state: 'pending' });
  const ics = unfold((await bookingCalendar(pending.b.id)).content);
  assert.ok(ics.includes('LOCATION:central Windsor') && !ics.includes('Pool Lane'));
  const shown = await aBooking({ state: 'pending', addressHidden: false });
  assert.ok(unfold((await bookingCalendar(shown.b.id)).content).includes('Pool Lane'), 'a host who never hid it');
  const gone = await aBooking({ state: 'cancelled' });
  assert.equal(await bookingCalendar(gone.b.id), null);
  assert.equal(await bookingCalendar(crypto.randomUUID()), null);
  assert.equal(await bookingCalendar('not-a-uuid'), null);
});

test('the booking is read from the notification link', () => {
  const id = crypto.randomUUID();
  assert.equal(bookingOfLink(`/bookings/${id}`), id);
  assert.equal(bookingOfLink(`/bookings/${id}?tab=chat`), id);
  assert.equal(bookingOfLink('/trips'), null);
  assert.equal(bookingOfLink(null), null);
});

test('the email queue attaches the file to "booked" and "moved", and sends anyway when it cannot be made', async () => {
  const { b, guest } = await aBooking();
  const tag = crypto.randomUUID().slice(0, 8);
  await notifications.notify({ householdId: guest.id, kind: 'booking_confirmed', title: `booked ${tag}`, link: `/bookings/${b.id}`, dedupeKey: `c:${tag}` });
  await notifications.notify({ householdId: guest.id, kind: 'date_changed', title: `moved ${tag}`, link: `/bookings/${b.id}`, dedupeKey: `d:${tag}` });
  await notifications.notify({ householdId: guest.id, kind: 'reminder_24h', title: `tip ${tag}`, link: `/bookings/${b.id}`, dedupeKey: `t:${tag}` });
  const sent = [];
  const send = async (m) => { sent.push(m); return { sent: true }; };
  await notifications.drainEmail({ send, configured: () => true, batch: 500 });
  const mine = (w) => sent.find((m) => m.subject === `${w} ${tag}`);
  assert.equal(mine('booked').attachments?.length, 1);
  assert.ok(mine('booked').attachments[0].content.includes(`UID:${b.id}-`));
  assert.equal(mine('moved').attachments?.length, 1);
  assert.equal(mine('tip').attachments, undefined, 'only booked and moved carry it');

  const tag2 = crypto.randomUUID().slice(0, 8);
  await notifications.notify({ householdId: guest.id, kind: 'booking_confirmed', title: `again ${tag2}`, link: `/bookings/${b.id}`, dedupeKey: `c2:${tag2}` });
  const broken = async () => { throw new Error('no database'); };
  await notifications.drainEmail({ send, configured: () => true, batch: 500, calendar: broken });
  const again = sent.find((m) => m.subject === `again ${tag2}`);
  assert.ok(again, 'the email still goes');
  assert.equal(again.attachments, undefined);
});
