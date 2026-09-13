/**
 * What a Postmark event does to a message — pure, so it can be tested without
 * a database (mirrors Parcelvision's tracking rules, docs/agent/EMAIL-MESSAGING-ARCHITECTURE.md §5).
 *
 *   Delivery       the recipient's server accepted it        → delivered
 *   Open           somebody opened it (first open only)      → opened
 *   Bounce, hard   the address is bad and will stay bad      → bounced   + suppressed
 *   Bounce, soft   mailbox full, greylisted, timed out       → soft_bounced
 *   SpamComplaint  they marked it as spam                    → complained + suppressed
 *
 * Postmark says which kind a bounce is in `Type`; the hard ones are the set
 * below and everything else is transient. An event that arrives out of order
 * — an Open after a Bounce is possible with some mailboxes — never moves a
 * message backwards from opened, and never un-bounces one.
 */

export const HARD_BOUNCES = new Set(['HardBounce', 'BadEmailAddress', 'ManuallyDeactivated', 'SpamNotification', 'Unsubscribe', 'DMARCPolicy']);

/** How long a hard bounce or a complaint keeps an address off the list. */
export const SUPPRESS_DAYS = 90;

const RANK = { failed: 0, sent: 1, soft_bounced: 2, delivered: 3, opened: 4, bounced: 5, complained: 6 };

/**
 * The next state of a message after one event.
 *
 * `row` is `{ status, delivered_at, opened_at, bounced_at }`; the answer is a
 * patch to write, or null when the event says nothing new. Times are the
 * event's own where it carries one, so a delayed webhook still records when
 * the thing happened rather than when we heard.
 */
export function applyEvent(row, event) {
  const type = String(event?.RecordType ?? '');
  const when = (k) => (event?.[k] ? new Date(event[k]) : new Date());
  const rank = RANK[row.status] ?? 0;
  if (type === 'Delivery') {
    if (rank >= RANK.delivered) return null;
    return { status: 'delivered', delivered_at: row.delivered_at ?? when('DeliveredAt') };
  }
  if (type === 'Open') {
    if (rank >= RANK.opened) return row.opened_at ? null : { opened_at: when('ReceivedAt') };
    return { status: 'opened', opened_at: row.opened_at ?? when('ReceivedAt'), delivered_at: row.delivered_at ?? when('ReceivedAt') };
  }
  if (type === 'Bounce') {
    const hard = HARD_BOUNCES.has(String(event.Type ?? ''));
    const failure = [event.Type, event.Description ?? event.Details].filter(Boolean).join(' — ').slice(0, 400) || null;
    if (hard) return rank >= RANK.bounced ? null : { status: 'bounced', bounce_type: event.Type ?? null, failure, bounced_at: row.bounced_at ?? when('BouncedAt') };
    // A soft bounce on something already delivered is a second attempt at a full mailbox: noted, not a state change.
    if (rank >= RANK.delivered) return { bounce_type: event.Type ?? null, failure };
    return { status: 'soft_bounced', bounce_type: event.Type ?? null, failure, bounced_at: row.bounced_at ?? when('BouncedAt') };
  }
  if (type === 'SpamComplaint') {
    return rank >= RANK.complained ? null : { status: 'complained', bounce_type: 'SpamComplaint', failure: 'Marked as spam by the recipient', bounced_at: row.bounced_at ?? when('BouncedAt') };
  }
  return null;
}

/** Whether a past outcome for this address means we should not send again yet. */
export function suppressedBy(past, now = new Date()) {
  const since = now.getTime() - SUPPRESS_DAYS * 86400000;
  return past.find((m) => (m.status === 'bounced' || m.status === 'complained') && m.bounced_at && new Date(m.bounced_at).getTime() >= since) ?? null;
}

/** The status as a word for a screen, and its tone. Never colour alone. */
export const STATUS_WORDS = {
  sent: 'Sent', delivered: 'Delivered', opened: 'Opened', bounced: 'Bounced', soft_bounced: 'Delayed', complained: 'Marked as spam', failed: 'Not sent',
};
