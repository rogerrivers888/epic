/**
 * The template layer's own vocabulary (K16, Roger, 3 Oct 2026): the channels a
 * message can be said on, the moments (triggers) that say one and the fields
 * each provides, the host's own automatic words, and the small language a
 * template is written in. Pure: nothing here reads the database.
 *
 * The language is deliberately small, because the owner edits it and a
 * template is checked against its trigger before it is saved:
 *
 *   {{field}}                       the field's value ('' when it is empty)
 *   {{field or "words"}}            the field, or the words when it is empty
 *   {{plural field "day" "days"}}   the first word when the field is 1, else the second
 *   {{#if field}}…{{else}}…{{/if}}  a piece said only when the field is set (else optional)
 *   {{#if field == "value"}}…{{/if}} a piece said only when the field is exactly that value
 *   {{@subject}}                    in an e-mail body, the e-mail's own subject as rendered
 *
 * "Empty" is null, undefined, '' or false. Nothing else is special: there are
 * no loops and no expressions, so a list is joined by the caller and handed in
 * as one field, and every field is named in the trigger's catalogue entry
 * below — a template that names any other field is refused when it is saved.
 */

const bad = (message, extra = {}) => Object.assign(new Error(message), { status: 400, code: 'bad_template', ...extra });

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

/**
 * The channels a template can carry. Push is declared so a template can be
 * written for it, and shown as not available; nothing delivers it, and
 * deliver() refuses it (Roger, 3 Oct 2026). The group-reminder webhook is not
 * a template channel: it carries whatever text it is handed.
 */
export const CHANNELS = Object.freeze({
  in_app: { label: 'In-app', parts: ['title', 'body'], required: ['title'], available: true },
  email: { label: 'E-mail', parts: ['subject', 'body'], required: ['subject', 'body'], available: true },
  sms: { label: 'SMS', parts: ['body'], required: ['body'], available: true },
  push: { label: 'Push', parts: ['title', 'body'], required: ['title'], available: false, note: 'Not available yet' },
});
export const CHANNEL_KEYS = Object.freeze(Object.keys(CHANNELS));
export const CATEGORIES = Object.freeze(['transactional', 'marketing']);

/** The placeholder a marketing e-mail must carry, so it always says how to stop them (Roger, 3 Oct 2026). */
export const UNSUBSCRIBE_FIELD = 'unsubscribeUrl';

// The host's own words (E4) stay where they are kept today — AUTO_DEFAULTS in
// repositories/notifications.js and AUTO_MESSAGES in routes/hostDesk.js, the
// hosting chat's — and a template reads them through hostWords() at render
// time. The samples below are examples for Preview, not a copy to keep in step
// (Codex, 3 Oct 2026: a third copy would drift). Moving the two into one place
// is the hosting chat's change, agreed with them before it lands.


// ---------------------------------------------------------------------------
// Triggers: the system moments, and the fields each provides
// ---------------------------------------------------------------------------

const f = (sample, about = null) => ({ sample, about });
const LINK = f('https://epic.day/bookings/3f2a', 'The full address of the screen this is about');
const TITLE = f('Pottery for beginners', 'The event’s title (may be empty)');
const HOST_WORDS_FIELD = f('Thanks for booking. See you there.', 'The host’s own automatic words for this moment, or empty when they switched them off');

/**
 * Every moment a template can be sent at. `fields` are the only names its
 * templates may use; `sample` is what Preview and "Send me a test" fill them
 * with. `hostWords` names the host's automatic message the moment carries:
 * render() fetches it when it is handed a `hostId` and no `hostWords`.
 * Add, never rename: a template names its trigger by this key.
 */
export const TRIGGERS = Object.freeze({
  // — sign-in and accounts
  'account.login_link': { label: 'Somebody asks for a login link', audience: 'customer or staff', fields: { url: f('https://epic.day/in/abc123') } },
  'account.password_reset': { label: 'Somebody asks to reset their password', audience: 'customer', fields: { url: f('https://epic.day/reset/abc123') } },
  'account.invited': {
    label: 'The owner invites a customer, or sends them a link back in', audience: 'customer',
    fields: { name: f('Priya'), url: f('https://epic.day/in/abc123'), from: f('Roger', 'Who it is from (Roger when empty)'), days: f(7, 'Whole days the link lasts'), returning: f(false, 'Set when it is a link back in, not a first invitation') },
  },
  'staff.invited': {
    label: 'The owner adds a staff member, or resends their link', audience: 'staff',
    fields: { first: f('Sam', 'First name, or “there”'), roleLabel: f('Editor'), doors: f('Places, Hosting and Messages', 'The areas the role opens, joined with commas and “and”'), on: f('10 October'), url: f('https://epic.day/in/abc123') },
  },
  'group.join_code': { label: 'Somebody joins a trip group and is sent a code', audience: 'participant', fields: { groupName: f('Lake District weekend'), code: f('482913'), minutes: f(10) } },
  'trip.guest_code': { label: 'A guest enters a shared trip and is sent a code', audience: 'guest', fields: { tripTitle: f('Bath in May'), placeLabel: f('Bath'), code: f('482913'), minutes: f(15) } },
  'join_code.issued': { label: 'Any join code is sent (one wording for both)', audience: 'participant or guest', fields: { what: f('Lake District weekend'), code: f('482913') } },
  // — household
  'household.member_invited': {
    label: 'A household member is invited, or sent a link back in', audience: 'household member',
    fields: { name: f('Gina'), url: f('https://epic.day/in/abc123'), household: f('The Rivers'), from: f('Roger'), days: f(7), returning: f(false) },
  },
  // — trips, groups and chat
  'trip.shared': { label: 'An organiser shares a trip with a guest', audience: 'guest', fields: { from: f('The Rivers'), what: f('Bath in May'), url: f('https://epic.day/t/abc') } },
  'group.reminder': {
    label: 'A group reminder is due, or the organiser taps send', audience: 'participant',
    fields: { participantFirst: f('Gina'), organiser: f('Roger'), groupName: f('Lake District weekend'), wantedBy: f('Saturday 11 October', 'The wanted-by day in words, or empty'), joined: f(true), list: f('the deposit and the boat trip', 'The first two things still needed, and how many more'), shortMore: f(2), shortLabel: f('the boat trip', 'A cost still short of its minimum, or empty') },
  },
  'group.cost_reoffered': { label: 'An item’s price ceiling goes up', audience: 'participant', fields: { label: f('The boat trip'), now: f('18.00'), was: f('12.00') } },
  'group.item_settled': { label: 'An organiser settles a cost, or it settles itself', audience: 'participant', fields: { label: f('The boat trip'), owed: f('15.00'), shares: f(6), due: f('Saturday 11 October') } },
  'group.item_called_off': { label: 'An item closes below its minimum', audience: 'participant', fields: { label: f('The boat trip'), shares: f(3), minimum: f(6) } },
  'group.called_off': { label: 'A group trip’s date passes below its minimum', audience: 'participant', fields: { groupName: f('Lake District weekend'), heads: f(3), minimum: f(6), wantedBy: f('Saturday 11 October') } },
  'group.place_free': { label: 'A place comes up on a group’s waiting list', audience: 'waiting-list contact', fields: { groupName: f('Lake District weekend'), url: f('https://epic.day/g/abc') } },
  'chat.event': {
    label: 'Something happens in a chat a person follows', audience: 'chat member or guest',
    fields: { who: f('Priya', 'Who did it (Someone when empty)'), contextName: f('Bath in May'), title: f('What time is lunch?', 'The topic’s title, cut to 80 characters'), body: f('About one, at the café', 'The reply, cut to 80 characters'), emoji: f('👍') },
  },
  'chat.digest': { label: 'Held chat pings go out together', audience: 'chat member or guest', fields: { count: f(3), lines: f('· Priya replied to “Lunch?”: one\n· Sam asked on Bath: “Parking?”', 'One bulleted line a ping') } },
  'open_to.waiting': { label: 'An Open To introduction is waiting on somebody', audience: 'member', fields: {} },
  // — guest bookings
  'booking.confirmed': { label: 'A booking is confirmed', audience: 'guest and host', hostWords: 'confirmed', fields: { title: TITLE, hostWords: HOST_WORDS_FIELD, heads: f(2, 'People on the booking'), link: LINK } },
  'booking.request_accepted': { label: 'A host says yes to a request', audience: 'guest', fields: { hostName: f('Kate Morris'), title: TITLE, link: LINK } },
  'booking.request_declined': { label: 'A request is declined, or not answered in time', audience: 'guest', fields: { title: TITLE, lapsed: f(false, 'Set when nobody answered in time'), link: LINK } },
  'booking.requested': { label: 'A guest asks to book', audience: 'host', fields: { title: TITLE, date: f('2026-10-11', 'Requested day, or empty'), time: f('10:00', 'Requested time, or empty'), link: LINK } },
  'waitlist.place_offered': { label: 'A freed place is offered to the first on the waiting list', audience: 'guest', fields: { title: TITLE, hours: f(12), link: LINK } },
  'booking.reminder_24h': { label: 'An event starts within 24 hours', audience: 'guest', hostWords: 'reminder', fields: { title: TITLE, hostWords: f('See you tomorrow. Here is what to bring and where to meet.'), link: LINK } },
  'booking.morning_after': { label: 'From 08:00 the morning after an event', audience: 'guest', hostWords: 'thank_you', fields: { title: TITLE, hostWords: f('Thank you for coming. If you have a minute, a review helps other people find this.'), link: LINK } },
  'event.details_changed': { label: 'A host edits an event’s description', audience: 'guest', fields: { title: TITLE, link: LINK } },
  'offer.invited': { label: 'A host’s invitations go out', audience: 'invitee', fields: { hostName: f('Kate Morris'), title: TITLE, date: f('2026-10-11', 'The first day, or empty'), url: f('https://epic.day/i/abc') } },
  'host.broadcast': { label: 'A host posts a message to everyone booked', audience: 'guest', fields: { hostName: f('Kate Morris'), title: TITLE, message: f('Bring an apron!') } },
  'offer.called_off_by_host': { label: 'A host calls off an older offer', audience: 'guest', fields: { title: TITLE, note: f('', 'The host’s note, or empty'), hostName: f('Kate Morris') } },
  'host.stopped_hosting': { label: 'A host stops hosting', audience: 'guest', fields: { title: TITLE } },
  'booking.held_under_minimum': { label: 'An older held booking does not reach its minimum', audience: 'guest', fields: { title: TITLE, minimum: f(6) } },
  'booking.guest_message': { label: 'A guest sends the host a message', audience: 'host', fields: { guestName: f('Priya'), title: TITLE, message: f('Is there parking nearby?'), link: LINK } },
  'booking.host_question': { label: 'A guest asks the host a question', audience: 'host', fields: { guestName: f('Priya'), title: TITLE, question: f('Can my seven-year-old come?'), link: LINK } },
  // — host desk
  'tip.received': { label: 'A tip is paid', audience: 'host', fields: { amount: f('5.00'), link: LINK } },
  'review.visible': { label: 'A guest’s review becomes visible', audience: 'host', fields: { stars: f(5), link: LINK } },
  'event.changes_requested': { label: 'Staff ask for changes to an event', audience: 'host', fields: { title: TITLE, reasons: f('Add a photo · Say where to meet', 'The ticked reasons, joined with “ · ”'), note: f('', 'The reviewer’s note'), link: LINK } },
  'event.declined': { label: 'Staff decline an event', audience: 'host', fields: { title: TITLE, reason: f('We do not list events in private homes.'), link: LINK } },
  'event.live': { label: 'An event goes live after approval', audience: 'host', fields: { title: TITLE, link: LINK } },
  'host.cohost_invited': { label: 'A host adds a co-host', audience: 'invitee', fields: { hostName: f('Kate Morris'), appUrl: f('https://epic.day') } },
  'host.checked_expiring': { label: 'A host’s Checked is about to run out', audience: 'host', fields: { what: f('DBS check', 'What runs out: DBS check, or insurance'), on: f('2026-11-01'), link: LINK } },
  'host.referee_requested': { label: 'A host names a referee', audience: 'referee', fields: { hostName: f('Kate Morris'), url: f('https://epic.day/ref/abc') } },
  'host.referee_reminder': { label: 'A referee has not answered after 3 days', audience: 'referee', fields: { hostName: f('Kate Morris'), url: f('https://epic.day/ref/abc') } },
  // — money (sent by the Stripe chat's code; the records only, here)
  'booking.cancelled_by_host': { label: 'A host cancels sessions or an event', audience: 'guest', fields: { title: TITLE, refunded: f(true, 'Set when a refund is owed'), link: LINK } },
  'booking.date_changed': { label: 'A host moves a date', audience: 'guest', hostWords: 'date_changed', fields: { title: TITLE, date: f('2026-10-18'), time: f('10:00', 'The new time, or empty'), hostWords: f('I have had to move the date. If the new one doesn’t work, you can cancel for a full refund.'), link: LINK } },
  'session.called_off': { label: 'Decides-by comes and it is under the minimum', audience: 'guest and host', hostWords: 'called_off', fields: { title: TITLE, minimum: f(6), heads: f(3), refunded: f(true), hostWords: f('Sorry — this one isn’t going ahead. You get a full refund.'), link: LINK } },
  'session.going_ahead': { label: 'Decides-by comes and it is going ahead', audience: 'guest', fields: { title: TITLE, link: LINK } },
  'session.under_minimum': { label: '48 hours before decides-by, still under the minimum', audience: 'host', fields: { title: TITLE, heads: f(3), minimum: f(6), decidesOn: f('2026-10-09'), link: LINK } },
  'refund.issued': { label: 'A refund succeeds', audience: 'guest', fields: { amount: f('24.00'), title: TITLE, link: LINK } },
  'payout.held': { label: 'A payout is put on hold', audience: 'host', fields: { reason: f('complaint', 'complaint, tax_details, stripe_incomplete, not_set, dispute, not_manual, dispute_lost or no_end'), link: LINK } },
  'payout.sent': { label: 'A payout is paid', audience: 'host', fields: { amount: f('120.00'), link: LINK } },
  // — safety
  'security.signin_lockout': { label: 'Five failed sign-ins against one account or address', audience: 'Epic', fields: { n: f(5), who: f('IP 203.0.113.9'), minutes: f(15), subjectKind: f('IP', 'account or IP') } },
  'content.rejected': { label: 'Staff turn down a contribution and say so', audience: 'contributor', fields: { said: f('photograph'), place: f('Bath Abbey', 'The place, or empty'), message: f('We are not going to put this one up — it is hard to tell what it is a picture of.') } },
  'safety.children_paused': { label: 'A child-safety report pauses a host’s events with children', audience: 'host', fields: { count: f(2, 'How many events were paused'), events: f('Clay club, Teen climbing', 'Their titles, joined with commas'), link: LINK } },
  'safety.checks_lapsed': { label: 'Checked or insurance lapses and drop-off events pause', audience: 'host', fields: { renew: f('your insurance, which ended on 2026-09-30', 'What to renew, joined with “, and ”'), events: f('Clay club'), link: LINK } },
  // — owner alerts
  'spend.alarm_80': { label: 'Today’s spend reaches 80% of the ceiling', audience: 'owner', fields: { pct: f(80), spent: f('24.00'), ceiling: f('30.00') } },
  'spend.ceiling_reached': { label: 'Today’s spend reaches the ceiling', audience: 'owner', fields: { spent: f('30.00'), ceiling: f('30.00') } },
  'admin.mail_test': { label: 'Staff send a test from the Mail screen', audience: 'staff', fields: { at: f('2026-10-03T09:00:00.000Z') } },
  'census.stopped': { label: 'The census stops itself for spend', audience: 'owner', fields: { over: f('net', 'census, net or google'), amount: f('£1.20'), day: f('2026-10-02'), lines: f('day 1 · 70,000 calls') } },
  'census.finished_with_spend': { label: 'The census finished, with spend', audience: 'owner', fields: { over: f('net', 'census, net or google'), amount: f('£1.20'), day: f('2026-10-02'), lines: f('day 1 · 70,000 calls') } },
  'census.held': { label: 'The census is held for a bill', audience: 'owner', fields: { amount: f('1.20'), day: f('2026-10-02'), lines: f('day 1 · 70,000 calls') } },
  'census.tick_failed': { label: 'The census scheduler could not run', audience: 'owner', fields: { day: f('2026-10-02'), error: f('connection refused') } },
  'census.stalled_running': { label: 'A census day has stopped moving', audience: 'owner', fields: { dayNumber: f(4), since: f('2026-10-02 09:00'), minutes: f(60), lines: f('day 1 · 70,000 calls') } },
  'census.stalled_no_run': { label: 'A census day has not started', audience: 'owner', fields: { day: f('2026-10-02'), graceHours: f(3), action: f('waiting'), why: f('', 'The scheduler’s reason, or empty'), lines: f('day 1 · 70,000 calls') } },
  'census.day_failed': { label: 'A census day failed', audience: 'owner', fields: { dayNumber: f(4), penny: f(false, 'Set when it stopped on the first penny'), problem: f('stopped on the first penny'), refusal: f('quota exceeded'), lines: f('day 1 · 70,000 calls') } },
  'census.billing_empty': { label: 'The billing export is still empty', audience: 'owner', fields: {} },
  'census.weekly_summary': { label: 'Monday’s census summary', audience: 'owner', fields: { today: f('2026-10-05'), summary: f('Calls: 490,000 over 7 days\nNew places: 12,000'), dayLines: f('day 1 · 70,000 calls', 'One line a day, or empty') } },
  'census.complete': { label: 'The census is complete', audience: 'owner', fields: { lines: f('day 1 · 70,000 calls') } },
  // — standing, strikes and appeals (design handover §5, 3 Oct 2026; the rules engine sends these)
  'chat.contact_hidden': { label: 'Contact details in a message are hidden', audience: 'sender', fields: { title: f('Pottery for beginners', 'The event or trip the conversation is about'), link: LINK } },
  'host.strike': {
    label: 'A host is given a strike', audience: 'host',
    fields: {
      step: f('warning', 'warning, final warning or suspended'), strikes: f(1, 'Strikes in force, this one included'),
      what: f('A guest reported that you did not turn up to Clay club on 4 October.', 'What happened, in a sentence'),
      rule: f('Hosts turn up to every session they run.', 'The rule it breaks, in a sentence'),
      expires: f('2027-10-04', 'When this strike expires'), appealUrl: f('https://epic.day/host/standing/appeal/abc'), link: LINK,
    },
  },
  'host.rating_dropped': { label: 'A host’s average falls below the warning line', audience: 'host', fields: { average: f('3.7'), lastRated: f(10, 'How many rated events the average is over'), below: f('3.8'), link: LINK } },
  'host.appeal_decided': { label: 'A person decides a host’s appeal', audience: 'host', fields: { outcome: f('upheld', 'upheld (the strike stays) or overturned (it is removed)'), what: f('The warning of 4 October'), reason: f('The guest’s photos show the venue was closed.'), link: LINK } },
  'host.back_to_draft': { label: 'An event waiting on Checked goes back to draft', audience: 'host', fields: { title: TITLE, days: f(30), link: LINK } },
  'host.late_change': { label: 'A host cancels or moves a date inside the late window', audience: 'host', fields: { title: TITLE, withinHours: f(48), count: f(2, 'Late changes in the last 90 days, this one included'), link: LINK } },
  'complaint.opened': { label: 'A guest complains and the payout is held', audience: 'host', fields: { title: TITLE, respondBy: f('2026-10-06 18:00', 'When the host must answer by'), link: LINK } },
  'membership.renewal_failed': { label: 'A membership payment fails', audience: 'member', fields: { plan: f('Household'), amount: f('8.99'), retryOn: f('2026-10-06'), updateUrl: f('https://epic.day/settings/membership') } },
  'tell_me_when.match': {
    label: 'Something somebody asked to hear about is on', audience: 'sign-up',
    fields: { what: f('Pottery'), where: f('Bath'), title: TITLE, url: f('https://epic.day/en-gb/event/pottery-abc'), unsubscribeUrl: f('https://epic.day/unsubscribe/abc', 'Where to stop these e-mails') },
  },
  // — replies a person chooses (design handover §7): the same editor, sent by a person, never by a trigger
  'complaint.reply_refund': { label: 'A person refunds a complaint', audience: 'guest', fields: { guestName: f('Priya'), title: TITLE, amount: f('24.00'), link: LINK } },
  'complaint.reply_declined': { label: 'A person declines a complaint', audience: 'guest', fields: { guestName: f('Priya'), title: TITLE, reason: f('The session ran as described and the host has photos of it.'), link: LINK } },
  'complaint.reply_warn_host': { label: 'A person warns the host about a complaint', audience: 'host', fields: { hostName: f('Kate Morris'), title: TITLE, step: f('warning'), what: f('A guest said the session started 40 minutes late.'), appealUrl: f('https://epic.day/host/standing/appeal/abc'), link: LINK } },
  // — marketing
  'interest.signed_up': { label: 'Somebody registers interest on epic.day', audience: 'sign-up', fields: { host: f(false, 'Set for the hosts list'), unsubscribeUrl: f('https://epic.day/unsubscribe/abc', 'Where to stop these e-mails') } },
});

/** The samples a trigger's preview is drawn with. */
export function samplesFor(triggerKey) {
  const t = TRIGGERS[triggerKey];
  if (!t) return {};
  return Object.fromEntries(Object.entries(t.fields).map(([k, v]) => [k, v.sample]));
}

// ---------------------------------------------------------------------------
// The language
// ---------------------------------------------------------------------------

const NAME = '[A-Za-z_][A-Za-z0-9_]*';
const RE = {
  value: new RegExp(`^(@?${NAME})$`),
  or: new RegExp(`^(${NAME})\\s+or\\s+"([^"]*)"$`),
  plural: new RegExp(`^plural\\s+(${NAME})\\s+"([^"]*)"\\s+"([^"]*)"$`),
  if: new RegExp(`^#if\\s+(${NAME})(?:\\s*==\\s*"([^"]*)")?$`),
};

/** Parse a template into a tree, or throw a 400 that says what is wrong and where. */
export function parse(src) {
  const text = src == null ? '' : String(src);
  const root = { type: 'root', then: [] };
  const stack = [{ node: root, branch: 'then' }];
  const here = () => { const top = stack[stack.length - 1]; return top.node[top.branch]; };
  const tag = /\{\{([\s\S]*?)\}\}/g;
  let last = 0; let m;
  /** Plain text between tags may not hold half a tag: a typo is refused, not sent as it stands (Codex, 3 Oct 2026). */
  const plain = (t) => {
    if (t.includes('{{') || t.includes('}}')) throw bad(`“${t.trim().slice(0, 40)}” has a “{{” or “}}” that does not make a whole tag.`);
    return t;
  };
  while ((m = tag.exec(text))) {
    if (m.index > last) here().push({ type: 'text', value: plain(text.slice(last, m.index)) });
    last = m.index + m[0].length;
    const inner = m[1].trim();
    let x;
    if ((x = inner.match(RE.if))) {
      const node = { type: 'if', field: x[1], equals: x[2] ?? null, then: [], else: null };
      here().push(node);
      stack.push({ node, branch: 'then' });
    } else if (inner === 'else') {
      const top = stack[stack.length - 1];
      if (top.node.type !== 'if' || top.branch !== 'then') throw bad('“{{else}}” sits outside an “{{#if …}}”, or comes twice in one.');
      top.node.else = []; top.branch = 'else';
    } else if (inner === '/if') {
      if (stack.length === 1) throw bad('“{{/if}}” closes an “{{#if …}}” that was never opened.');
      stack.pop();
    } else if ((x = inner.match(RE.plural))) {
      here().push({ type: 'plural', field: x[1], one: x[2], many: x[3] });
    } else if ((x = inner.match(RE.or))) {
      here().push({ type: 'value', field: x[1], fallback: x[2] });
    } else if ((x = inner.match(RE.value))) {
      here().push({ type: 'value', field: x[1], fallback: null });
    } else {
      throw bad(`“{{${inner}}}” isn’t something a template can say. Use {{field}}, {{field or "words"}}, {{plural field "one" "many"}} or {{#if field}}…{{/if}}.`);
    }
  }
  if (stack.length > 1) throw bad('An “{{#if …}}” is never closed with “{{/if}}”.');
  if (last < text.length) here().push({ type: 'text', value: plain(text.slice(last)) });
  return root;
}

/** Every field a tree names, specials (@subject) included. */
export function fieldsOf(tree, out = new Set()) {
  for (const n of [...(tree.then ?? []), ...(tree.else ?? [])]) {
    if (n.field) out.add(n.field);
    if (n.type === 'if') fieldsOf(n, out);
  }
  return out;
}

const empty = (v) => v == null || v === '' || v === false;
const str = (v) => (empty(v) ? '' : String(v));

function walk(nodes, values, out) {
  for (const n of nodes ?? []) {
    if (n.type === 'text') out.push(n.value);
    else if (n.type === 'value') out.push(empty(values[n.field]) && n.fallback != null ? n.fallback : str(values[n.field]));
    else if (n.type === 'plural') out.push(Number(values[n.field]) === 1 ? n.one : n.many);
    else if (n.type === 'if') {
      const v = values[n.field];
      const yes = n.equals == null ? !empty(v) : (!empty(v) && String(v) === n.equals);
      walk(yes ? n.then : n.else, values, out);
    }
  }
  return out;
}

/** Render one piece of text against the values. */
export const renderText = (src, values = {}) => walk(parse(src).then, values ?? {}, []).join('');

/**
 * Check a template's channels against its trigger before it is saved. Throws a
 * 400 naming every unknown field and what the moment does provide; returns the
 * channels tidied (only known channels and parts, strings).
 */
export function validateChannels(triggerKey, channels, { category = 'transactional' } = {}) {
  const t = TRIGGERS[triggerKey];
  if (!t) throw bad(`“${triggerKey}” is not a moment Epic sends messages at.`);
  if (!CATEGORIES.includes(category)) throw bad('A template is transactional or marketing.');
  if (!channels || typeof channels !== 'object' || Array.isArray(channels)) throw bad('Say what the template says, channel by channel.');
  const known = new Set(Object.keys(t.fields));
  const tidy = {};
  const unknown = new Set();
  for (const [ch, parts] of Object.entries(channels)) {
    if (parts == null) continue;
    const spec = CHANNELS[ch];
    if (!spec) throw bad(`“${ch}” is not a channel. The channels are ${CHANNEL_KEYS.join(', ')}.`);
    if (typeof parts !== 'object') throw bad(`The ${spec.label} part is not in the right shape.`);
    const kept = {};
    for (const p of spec.parts) {
      if (parts[p] == null || parts[p] === '') continue;
      if (typeof parts[p] !== 'string') throw bad(`The ${spec.label} ${p} is not text.`);
      const tree = parse(parts[p]);
      for (const name of fieldsOf(tree)) {
        if (name === '@subject') { if (!(ch === 'email' && p === 'body')) throw bad('{{@subject}} can only be used in an e-mail’s body.'); continue; }
        if (!known.has(name)) unknown.add(name);
      }
      kept[p] = parts[p];
    }
    for (const p of spec.required) if (!kept[p]) throw bad(`The ${spec.label} message needs a ${p}.`);
    for (const p of Object.keys(parts)) if (!spec.parts.includes(p)) throw bad(`A ${spec.label} message has no “${p}”; it has ${spec.parts.join(' and ')}.`);
    tidy[ch] = kept;
  }
  if (unknown.size) {
    const names = [...unknown].map((n) => `{{${n}}}`).join(', ');
    throw bad(`${names} ${unknown.size === 1 ? 'isn’t a field' : 'aren’t fields'} “${t.label}” provides. It can use: ${[...known].map((n) => `{{${n}}}`).join(', ') || 'no fields'}.`, { code: 'unknown_field', unknown: [...unknown] });
  }
  if (!Object.keys(tidy).length) throw bad('A template says something on at least one channel.');
  // A marketing e-mail always says how to stop them (Roger, 3 Oct 2026).
  if (category === 'marketing' && tidy.email && !fieldsOf(parse(tidy.email.body)).has(UNSUBSCRIBE_FIELD)) {
    throw bad(`A marketing e-mail must carry an unsubscribe link: put {{${UNSUBSCRIBE_FIELD}}} in its body.`, { code: 'needs_unsubscribe' });
  }
  return tidy;
}

/**
 * Render a version's channels with these values: `{ in_app: { title, body },
 * email: { subject, body }, … }`, each piece null when it renders empty. The
 * e-mail subject is rendered first so the body can say {{@subject}}.
 */
export function renderChannels(channels, values = {}, only = null) {
  const out = {};
  for (const [ch, parts] of Object.entries(channels ?? {})) {
    if (only && !only.includes(ch)) continue;
    const r = {};
    const v = { ...values };
    for (const p of ['subject', 'title', 'body']) {
      if (parts[p] == null) continue;
      const s = renderText(parts[p], v);
      r[p] = s === '' ? null : s;
      if (p === 'subject') v['@subject'] = s;
    }
    out[ch] = r;
  }
  return out;
}
