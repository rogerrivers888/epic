/**
 * Every message Epic sends today, as a template record with today's exact
 * words (K16 step 1, Roger, 3 Oct 2026), plus the new wordings the owner asked
 * for, which nothing sends yet. Read from the inventory of 3 Oct 2026; each
 * `sentBy` names where today's sender composes its own copy. No sender reads
 * these yet: moving a sender over is a later batch, and test/templates.test.js
 * proves each record renders byte-for-byte what its sender says today.
 *
 * `state`: 'mirrors_code' — today's words, still sent by the code that holds
 * its own copy; 'new_wording' — words the owner has not seen go live, sent by
 * nothing yet.
 *
 * A notification's e-mail is what the drain sends today (notifications.js
 * drainEmail): the subject is the title, and the text is the body and the
 * link, a blank line apart. Every notification today is written with a link,
 * so these e-mails always end with {{link}}.
 */

const T = 'transactional';

/** A notification today: in-app title and body, and the drain's e-mail of them. */
const notif = (title, body = null, emailBody = undefined) => ({
  in_app: { title, ...(body ? { body } : {}) },
  email: { subject: title, body: emailBody ?? (body ? `${body}\n\n{{link}}` : '{{link}}') },
});
/** In-app only: kinds the drain never e-mails (KINDS[kind].email is false). */
const inApp = (title, body = null) => ({ in_app: { title, ...(body ? { body } : {}) } });

const INVITE_TAIL = 'Open Epic:\n{{url}}\n\nThe link signs you in on the device you open it on and works once, within {{days}} {{plural days "day" "days"}}. After that the app stays signed in for ninety days.\n\nIf you were not expecting this, ignore it — nothing happens until the link is opened.';

const CHAT = (key, name, text, sentBy) => ({
  key, name, trigger: 'chat.event', sentBy,
  // A chat ping is one line: e-mailed under "On Epic", or texted with "Epic: " in front (sources/chatNotify.js deliver).
  channels: { email: { subject: 'On Epic', body: text }, sms: { body: `Epic: ${text}` } },
});

/** Everything but the census and spend alarms, which are the owner's own, and are below. */
const SEEDS = [
  // ---- A. Sign-in and accounts -------------------------------------------------
  {
    key: 'login_link', name: 'Login link', trigger: 'account.login_link',
    sentBy: 'sources/mail.js loginLinkEmail (sent at routes/session.js:242); SMS at routes/session.js:251',
    channels: {
      email: { subject: 'Your login link', body: 'Tap below to log in to Epic. The link works once, for 15 minutes.\n\nLog in to Epic:\n{{url}}\n\nDidn\'t ask for this? Ignore it and nothing happens.' },
      sms: { body: 'Log in to Epic — this link works once, for 15 minutes: {{url}}' },
    },
  },
  {
    key: 'password_reset', name: 'Password reset', trigger: 'account.password_reset',
    sentBy: 'sources/mail.js resetPasswordEmail (sent at routes/authPassword.js:160)',
    channels: { email: { subject: 'Reset your Epic password', body: 'Tap below to choose a new password. The link works once, for 30 minutes.\n\nSet a new password:\n{{url}}\n\nDidn\'t ask for this? Ignore it and your password stays the same.' } },
  },
  {
    key: 'account_invitation', name: 'Account invitation, or link back in', trigger: 'account.invited',
    sentBy: 'sources/mail.js invitationEmail (sent at repositories/accounts.js:166)',
    channels: {
      email: {
        subject: '{{#if returning}}Your link back in to Epic{{else}}Your invitation to Epic{{/if}}',
        body: `{{#if name}}Hi {{name}},{{else}}Hi,{{/if}}\n\n{{#if returning}}Here is a fresh link to sign back in to Epic.{{else}}{{from or "Roger"}} has set you up with Epic — it remembers every place you love, and plans days out around what everybody in your household will actually eat.{{/if}}\n\n${INVITE_TAIL}`,
      },
    },
  },
  {
    key: 'staff_invitation', name: 'Staff invitation', trigger: 'staff.invited',
    sentBy: 'sources/mail.js staffInviteEmail (sent at routes/staff.js:140)',
    channels: {
      email: {
        subject: 'You\'ve been added to the Epic back office',
        body: 'You\'re on the team, {{first}}.\n\nYou\'ve got a back-office login as {{roleLabel}}{{#if doors}}, so you can open {{doors}}{{/if}}.\n\nLog in to the back office:\n{{url}}\n\nThe link works once and expires on {{on}}. After that, log in at epic.day with this email.',
      },
    },
  },
  {
    key: 'group_join_code', name: 'Trip-group join code', trigger: 'group.join_code',
    sentBy: 'routes/groups.js:1299-1304 (e-mail, SMS or the reminder webhook)',
    channels: {
      email: { subject: 'Your code for {{groupName or "your trip"}}', body: 'Epic: your code for {{groupName or "your trip"}} is {{code}}. It lasts {{minutes}} minutes.' },
      sms: { body: 'Epic: your code for {{groupName or "your trip"}} is {{code}}. It lasts {{minutes}} minutes.' },
    },
  },
  {
    key: 'shared_trip_code', name: 'Shared-trip guest code', trigger: 'trip.guest_code',
    sentBy: 'routes/shared.js:164-167',
    channels: {
      email: { subject: 'Your code for {{#if tripTitle}}{{tripTitle}}{{else}}{{placeLabel or "the trip"}}{{/if}}', body: 'Your code is {{code}}. It works for {{minutes}} minutes.' },
      sms: { body: 'Epic: your code for {{#if tripTitle}}{{tripTitle}}{{else}}{{placeLabel or "the trip"}}{{/if}} is {{code}}. It works for {{minutes}} minutes.' },
    },
  },
  // ---- B. Household ------------------------------------------------------------
  {
    key: 'household_invitation', name: 'Household invitation', trigger: 'household.member_invited',
    sentBy: 'sources/mail.js householdInvitationEmail and sources/sms.js invitationText (sent at routes/household.js:669, 677-678)',
    channels: {
      email: {
        subject: '{{#if returning}}Your link back in to Epic{{else}}You\'re in {{household or "the household"}} on Epic{{/if}}',
        body: `{{#if name}}Hi {{name}},{{else}}Hi,{{/if}}\n\n{{#if returning}}Here is a fresh link to sign back in to {{household or "your household"}} on Epic.{{else}}{{#if from}}{{from}} has{{else}}You have been{{/if}} added you to {{household or "the household"}} on Epic. It is the same Epic they use — the same trips, the same saved places, and the tastes and allergies already written down for everybody at home.{{/if}}\n\n${INVITE_TAIL}`,
      },
      sms: { body: '{{#if name}}Hi {{name}}. {{/if}}{{#if returning}}Here is a fresh link to sign back in to Epic:{{else}}{{#if from}}{{from}} has{{else}}You have been{{/if}} added you to their household on Epic — where the family\'s places, tastes and trips live. Open it here:{{/if}}\n{{url}}\nThe link works once, on the phone you open it on.' },
    },
  },
  // ---- C. Trips, groups and chat -----------------------------------------------
  {
    key: 'trip_shared', name: 'Trip shared', trigger: 'trip.shared', sentBy: 'routes/tripChat.js:240-254',
    channels: {
      email: { subject: '{{from or "someone"}} has shared {{what or "a trip"}} with you', body: '{{from or "someone"}} has shared {{what or "a trip"}} with you on Epic.\n\nThe plan, who is coming and the chat are here — no account needed:\n{{url}}\n' },
      sms: { body: '{{from or "someone"}} shared {{what or "a trip"}} with you on Epic. The plan and the chat: {{url}}' },
    },
  },
  {
    key: 'group_reminder', name: 'Group reminder', trigger: 'group.reminder',
    sentBy: 'domain/reminders.js reminderBody (sent through the reminder webhook, routes/groups.js:882-883)',
    channels: { sms: { body: '{{#if participantFirst}}{{participantFirst}} — {{/if}}{{organiser}} {{#if joined}}still needs {{list or "a couple of things"}} from you for {{groupName}}{{#if wantedBy}} by {{wantedBy}}{{/if}}.{{#if shortLabel}} {{shortMore}} more and {{shortLabel}} runs.{{/if}} Your list is in Epic.{{else}}has asked you to {{groupName}}. Open the link they sent to say you are coming and see what is needed{{#if wantedBy}} by {{wantedBy}}{{/if}}.{{/if}}' } },
  },
  { key: 'group_cost_reoffered', name: 'Group cost re-offered', trigger: 'group.cost_reoffered', sentBy: 'routes/groups.js:685 (reminder webhook)', channels: { sms: { body: '{{label}} could now cost up to £{{now}} each, not £{{was}}. Say again whether you want it.' } } },
  { key: 'group_item_settled', name: 'Group item settled', trigger: 'group.item_settled', sentBy: 'routes/groups.js:840 and :999 (reminder webhook)', channels: { sms: { body: '{{label}} is settled: £{{owed}} — {{shares}} of us, by {{due}}.' } } },
  { key: 'group_item_called_off', name: 'Group item called off', trigger: 'group.item_called_off', sentBy: 'routes/groups.js:990-992 (reminder webhook)', channels: { sms: { body: '{{label}} is off — {{shares}} of the {{minimum}} it needed. Nothing to pay.' } } },
  { key: 'group_called_off', name: 'Group trip called off', trigger: 'group.called_off', sentBy: 'routes/groups.js:968-970 (reminder webhook)', channels: { sms: { body: '{{groupName or "The trip"}} is off — {{heads}} of the {{minimum}} needed by {{wantedBy}}. Nothing has been taken from you.' } } },
  {
    key: 'group_place_free', name: 'Group waiting list: a place came up', trigger: 'group.place_free', sentBy: 'routes/groups.js:1367-1379',
    channels: {
      email: { subject: 'A place has come up on {{groupName or "the trip"}}', body: 'Epic: a place has come up on {{groupName or "the trip"}}. {{url}}' },
      sms: { body: 'Epic: a place has come up on {{groupName or "the trip"}}. {{url}}' },
    },
  },
  CHAT('chat_topic', 'Chat: a new question', '{{who or "Someone"}} asked on {{contextName}}: “{{title}}”', 'domain/chat.js notificationText (topic), queued at routes/chat.js:581'),
  CHAT('chat_notice', 'Chat: a notice', '{{who or "Someone"}}, about {{contextName}}: {{title}}', 'domain/chat.js notificationText (notice)'),
  CHAT('chat_reply', 'Chat: a reply', '{{who or "Someone"}} replied to “{{title}}”: {{body}}', 'domain/chat.js notificationText (reply), queued at routes/chat.js:641'),
  CHAT('chat_answer', 'Chat: an answer', '{{who or "Someone"}} answered “{{title}}”: {{body}}', 'domain/chat.js notificationText (answer), queued at routes/chat.js:688'),
  CHAT('chat_reaction', 'Chat: a reaction', '{{who or "Someone"}} reacted {{emoji}} to what you said on {{contextName}}', 'domain/chat.js notificationText (reaction), queued at routes/chat.js:719'),
  CHAT('chat_mention', 'Chat: a mention', '{{who or "Someone"}} mentioned you on {{contextName}}: {{body}}', 'domain/chat.js notificationText (mention)'),
  CHAT('chat_publish_request', 'Chat: asked to publish', '{{who or "Someone"}} has asked you something about “{{title}}” on {{contextName}}', 'domain/chat.js notificationText (publish_request), queued at routes/chat.js:645-647'),
  CHAT('chat_published', 'Chat: published to the FAQ', 'Your answer to “{{title}}” is now in the FAQ for {{contextName}}', 'domain/chat.js notificationText (published), queued at routes/chat.js:772-773'),
  {
    key: 'chat_digest', name: 'Chat digest', trigger: 'chat.digest', sentBy: 'sources/chatNotify.js:106-108',
    channels: { email: { subject: 'Your Epic digest', body: '{{count}} things on Epic today:\n\n{{lines}}' }, sms: { body: 'Epic: {{count}} things on Epic today:\n\n{{lines}}' } },
  },
  {
    key: 'open_to_nudge', name: 'Open To: somebody is waiting', trigger: 'open_to.waiting', sentBy: 'routes/openTo.js:787-790 (a chat ping, kind notice)',
    channels: { email: { subject: 'On Epic', body: 'Somebody on Epic is waiting on you. Open Epic to answer — it goes after a week either way.' }, sms: { body: 'Epic: Somebody on Epic is waiting on you. Open Epic to answer — it goes after a week either way.' } },
  },
  // ---- D. Guest bookings -------------------------------------------------------
  { key: 'booking_confirmed', name: 'Booking confirmed', trigger: 'booking.confirmed', notificationKind: 'booking_confirmed', sentBy: 'routes/guestBookings.js:472-473', channels: notif('You’re booked: {{title or "your event"}}', 'It’s in your Trips.{{#if hostWords}}\n\n{{hostWords}}{{/if}}') },
  { key: 'ask_to_book_accepted', name: 'Request accepted', trigger: 'booking.request_accepted', notificationKind: 'ask_to_book_accepted', sentBy: 'routes/guestBookings.js:1374', channels: notif('{{hostName}} said yes: {{title or "your request"}}') },
  { key: 'ask_to_book_declined', name: 'Request declined or not answered', trigger: 'booking.request_declined', notificationKind: 'ask_to_book_declined', sentBy: 'routes/guestBookings.js:1397', channels: notif('{{#if lapsed}}No answer in time{{else}}Not this time{{/if}}: {{title or "your request"}}', 'Your card hold is released.') },
  { key: 'waitlist_offered', name: 'Waiting list: your place is ready', trigger: 'waitlist.place_offered', notificationKind: 'waitlist_offered', sentBy: 'routes/guestBookings.js:723', channels: notif('Your place is ready: {{title or "an event"}}', 'Book within {{hours}} hours') },
  { key: 'reminder_24h', name: 'Reminder 24 hours before', trigger: 'booking.reminder_24h', notificationKind: 'reminder_24h', sentBy: 'routes/guestBookings.js:1452', channels: notif('Tomorrow: {{title or "your event"}}', '{{hostWords}}', '{{#if hostWords}}{{hostWords}}\n\n{{/if}}{{link}}') },
  { key: 'after_event', name: 'The morning after', trigger: 'booking.morning_after', notificationKind: 'after_event', sentBy: 'routes/guestBookings.js:1458', channels: notif('How was {{title or "it"}}?', 'Did it happen, a rating, and a tip if you like.{{#if hostWords}}\n\n{{hostWords}}{{/if}}') },
  { key: 'event_changed', name: 'The host updated the details', trigger: 'event.details_changed', notificationKind: 'event_changed', sentBy: 'routes/hostDesk.js:710 (in-app only)', channels: inApp('{{title or "Your booking"}}: the host updated the details') },
  {
    key: 'offer_invitation', name: 'Offer invitation', trigger: 'offer.invited', sentBy: 'routes/hosting.js:1152-1156 sendInvites',
    channels: {
      email: { subject: '{{hostName}} has invited you', body: '{{hostName}} has invited you to {{title or "something"}}{{#if date}} on {{date}}{{/if}}. Say yes or no here: {{url}}' },
      sms: { body: '{{hostName}} has invited you to {{title or "something"}}{{#if date}} on {{date}}{{/if}}. Say yes or no here: {{url}}' },
    },
  },
  {
    key: 'host_broadcast', name: 'Host broadcast', trigger: 'host.broadcast', sentBy: 'routes/hosting.js:982 through tellBooked (1327)',
    channels: { email: { subject: 'From your Epic host', body: '{{hostName}}, about {{title or "your booking"}}: {{message}}' }, sms: { body: 'Epic: {{hostName}}, about {{title or "your booking"}}: {{message}}' } },
  },
  {
    key: 'offer_called_off', name: 'Older offer called off', trigger: 'offer.called_off_by_host', sentBy: 'routes/hosting.js:968-970 through tellBooked',
    channels: {
      email: { subject: 'From your Epic host', body: '{{title or "Your booking"}} has been called off. {{#if note}}{{note}}{{else}}{{hostName}} called this off.{{/if}} Anything paid is refunded to the card it was paid with.' },
      sms: { body: 'Epic: {{title or "Your booking"}} has been called off. {{#if note}}{{note}}{{else}}{{hostName}} called this off.{{/if}} Anything paid is refunded to the card it was paid with.' },
    },
  },
  {
    key: 'host_stopped_call_off', name: 'Host stopped hosting', trigger: 'host.stopped_hosting', sentBy: 'routes/hosting.js:480 through tellBooked',
    channels: {
      email: { subject: 'From your Epic host', body: '{{title or "Your booking"}} has been called off by the host. Anything paid is refunded to the card it was paid with.' },
      sms: { body: 'Epic: {{title or "Your booking"}} has been called off by the host. Anything paid is refunded to the card it was paid with.' },
    },
  },
  {
    key: 'held_booking_not_running', name: 'Older held booking under its minimum', trigger: 'booking.held_under_minimum', sentBy: 'routes/hosting.js:1876 through tellBooked',
    channels: {
      email: { subject: 'From your Epic host', body: '{{title or "Your booking"}} did not reach the {{minimum}} it needed, so it is not running. Nothing has been taken from you.' },
      sms: { body: 'Epic: {{title or "Your booking"}} did not reach the {{minimum}} it needed, so it is not running. Nothing has been taken from you.' },
    },
  },
  // ---- E. Host desk ------------------------------------------------------------
  { key: 'new_booking', name: 'New booking (to the host)', trigger: 'booking.confirmed', notificationKind: 'new_booking', sentBy: 'routes/guestBookings.js:474', channels: notif('New booking: {{title or "your event"}}', '{{heads}} {{plural heads "person" "people"}}') },
  {
    key: 'ask_to_book_request', name: 'Ask to book (to the host)', trigger: 'booking.requested', notificationKind: 'ask_to_book_request', sentBy: 'routes/guestBookings.js:422 (no body) and :529 (with the day and time)',
    channels: notif('Ask to book: {{title or "your offer"}}', '{{date}}{{#if date}}{{#if time}} {{/if}}{{/if}}{{time}}', '{{#if date}}{{date}}{{#if time}} {{time}}{{/if}}\n\n{{else}}{{#if time}}{{time}}\n\n{{/if}}{{/if}}{{link}}'),
  },
  { key: 'new_tip', name: 'A tip', trigger: 'tip.received', notificationKind: 'new_tip', sentBy: 'routes/guestBookings.js:565 (in-app only)', channels: inApp('A £{{amount}} tip') },
  { key: 'new_review', name: 'A review', trigger: 'review.visible', notificationKind: 'new_review', sentBy: 'routes/guestBookings.js:1443 (in-app only)', channels: inApp('A {{stars}}-star review') },
  { key: 'review_changes_requested', name: 'Changes requested', trigger: 'event.changes_requested', notificationKind: 'review_changes_requested', sentBy: 'routes/hostingAdmin.js:167', channels: notif('Changes requested: {{title or "your event"}}', '{{#if reasons}}{{reasons}}{{else}}{{note}}{{/if}}') },
  { key: 'event_not_approved', name: 'Not approved', trigger: 'event.declined', notificationKind: 'review_changes_requested', sentBy: 'routes/hostingAdmin.js:180', channels: notif('Not approved: {{title or "your event"}}', '{{reason}}') },
  {
    key: 'cohost_invite', name: 'Co-host invitation', trigger: 'host.cohost_invited', sentBy: 'routes/hostDesk.js:1183',
    channels: { email: { subject: '{{hostName}} asked you to co-host on Epic', body: '{{hostName}} asked you to co-host. Sign in to Epic with this address and accept it on the Host tab:\n\n{{appUrl}}/host' } },
  },
  // ---- F. Money — sent by the Stripe chat's code; records only -----------------
  { key: 'cancelled', name: 'Cancelled by the host', trigger: 'booking.cancelled_by_host', notificationKind: 'cancelled', sentBy: 'sources/bookingMoney.js:167 (the Stripe chat’s)', channels: notif('{{title or "Your booking"}}: cancelled by the host', '{{#if refunded}}You get a full refund.{{/if}}', '{{#if refunded}}You get a full refund.\n\n{{/if}}{{link}}') },
  { key: 'date_changed', name: 'Date moved', trigger: 'booking.date_changed', notificationKind: 'date_changed', sentBy: 'sources/bookingMoney.js:261-268 (the Stripe chat’s)', channels: notif('{{title or "Your booking"}} has moved', 'New date: {{date}}{{#if time}} at {{time}}{{/if}}. If it no longer works, cancel for a full refund.{{#if hostWords}}\n\n{{hostWords}}{{/if}}') },
  { key: 'called_off', name: 'Not going ahead (to the guest)', trigger: 'session.called_off', notificationKind: 'called_off', sentBy: 'sources/bookingMoney.js:331-340 (the Stripe chat’s)', channels: notif('{{title or "Your booking"}} isn’t going ahead', 'It needed {{minimum}} and had {{heads}}.{{#if refunded}} You get a full refund.{{/if}}{{#if hostWords}}\n\n{{hostWords}}{{/if}}') },
  { key: 'event_called_off', name: 'Called off (to the host)', trigger: 'session.called_off', notificationKind: 'event_called_off', sentBy: 'sources/bookingMoney.js:345 (the Stripe chat’s)', channels: notif('{{title or "Your event"}} was called off', '{{heads}} of {{minimum}} booked by the decides-by day. Everyone booked gets a full refund.') },
  { key: 'decides_by_result', name: 'Going ahead', trigger: 'session.going_ahead', notificationKind: 'decides_by_result', sentBy: 'sources/bookingMoney.js:360 (the Stripe chat’s)', channels: notif('{{title or "Your booking"}} is going ahead') },
  { key: 'under_minimum', name: 'Under its minimum (to the host)', trigger: 'session.under_minimum', notificationKind: 'under_minimum', sentBy: 'sources/bookingMoney.js:384 (the Stripe chat’s)', channels: notif('{{title or "An event"}} is under its minimum', '{{heads}} of {{minimum}} booked. It decides on {{decidesOn}}.') },
  { key: 'refund_issued', name: 'Refund on its way', trigger: 'refund.issued', notificationKind: 'refund_issued', sentBy: 'sources/bookingMoney.js:438 (the Stripe chat’s)', channels: notif('£{{amount}} is on its way back to you', '{{title}}', '{{#if title}}{{title}}\n\n{{/if}}{{link}}') },
  {
    key: 'payout_held', name: 'Payout on hold', trigger: 'payout.held', notificationKind: 'payout_held', sentBy: 'sources/hostingMoney.js:29-38, 96-98 (the Stripe chat’s)',
    channels: (() => {
      const words = [
        ['complaint', 'A guest raised a problem with this session. The payout waits until it is sorted.'],
        ['tax_details', 'Add your NI number or UTR to be paid.'],
        ['stripe_incomplete', 'Finish setting up payouts with Stripe to be paid.'],
        ['not_set', 'Payouts are waiting on a setting Epic has not set yet.'],
        ['dispute', 'A guest’s bank is looking at a payment for this session. The payout waits until it decides.'],
        ['not_manual', 'Epic is checking your Stripe payout settings. The payout waits until that is done.'],
        ['dispute_lost', 'A guest’s bank took back a payment for this session. Epic will be in touch about this payout.'],
        ['no_end', 'This session has no end time, so its payout waits for a person to check it.'],
      ];
      const body = words.map(([k, w]) => `{{#if reason == "${k}"}}${w}{{/if}}`).join('');
      const email = words.map(([k, w]) => `{{#if reason == "${k}"}}${w}\n\n{{/if}}`).join('') + '{{link}}';
      return notif('A payout is on hold', body, email);
    })(),
  },
  { key: 'payout_sent', name: 'Payout on its way', trigger: 'payout.sent', notificationKind: 'payout_sent', sentBy: 'sources/hostingMoney.js:148-150 (the Stripe chat’s)', channels: notif('£{{amount}} is on its way') },
  // ---- G. Safety ---------------------------------------------------------------
  {
    key: 'signin_lockout', name: 'Sign-in lockout alert', trigger: 'security.signin_lockout', sentBy: 'signInGuard.js:96-103',
    channels: { email: { subject: 'Epic — sign-in lockout', body: '{{n}} failed sign-in attempt(s) against {{who}} in the last {{minutes}} minutes.\nThat {{subjectKind}} is now locked out of the sign-in door for {{minutes}} minutes.\n\nIf this was not you, the passcode and accounts are unchanged — the attempts never got in.' } },
  },
  {
    key: 'content_rejected', name: 'Contribution turned down', trigger: 'content.rejected', sentBy: 'repositories/contentQueue.js:885-890 (the words: REASONS at :51-88, or what staff typed)',
    channels: { email: { subject: 'Thanks for the {{said}}{{#if place}} of {{place}}{{/if}}', body: '{{message}}' } },
  },
  {
    key: 'children_paused', name: 'Events with children paused', trigger: 'safety.children_paused', notificationKind: 'children_paused', sentBy: 'sources/safetyHolds.js childSafetyReported',
    channels: notif('{{#if count == "1"}}Your event with children is paused{{else}}Your events with children are paused{{/if}}', 'Epic has paused {{events}} while we look at a report. Bookings already made are kept, and new ones are closed for now. We will be in touch; you do not need to do anything yet.'),
  },
  {
    key: 'checks_lapsed', name: 'Drop-off events paused for lapsed checks', trigger: 'safety.checks_lapsed', notificationKind: 'checks_lapsed', sentBy: 'sources/safetyHolds.js pauseForLapsedChecks',
    channels: notif('Your drop-off events are paused', 'Renew {{renew}}. Upload it under Checks, then resume {{events}}. Bookings already made are kept.'),
  },
  // ---- H. Back office and owner alerts -----------------------------------------
  {
    key: 'spend_alarm_80', name: 'Spend alarm, 80%', trigger: 'spend.alarm_80', sentBy: 'sources/dailyCeiling.js:111-116',
    channels: { email: { subject: 'Epic: today\'s spend is at {{pct}}% of the daily ceiling (£{{spent}} of £{{ceiling}})', body: 'Paid calls go on until the ceiling, then stop until midnight London time. The ledger is in the back office.' } },
  },
  {
    key: 'spend_ceiling_reached', name: 'Spend ceiling reached', trigger: 'spend.ceiling_reached', sentBy: 'sources/dailyCeiling.js:111-116',
    channels: { email: { subject: 'Epic: daily spend ceiling reached — paid calls refused (£{{spent}} of £{{ceiling}})', body: 'Every paid Google, Routes and Claude call is refused until midnight London time. The ledger is in the back office; EPIC_DAILY_SPEND_CEILING_GBP moves the ceiling.' } },
  },
  { key: 'mail_test', name: 'Mail test', trigger: 'admin.mail_test', sentBy: 'routes/admin.js:344-347', channels: { email: { subject: 'A test from Epic', body: 'This is a test message from Epic, sent from the back office at {{at}}.' } } },
  {
    key: 'census_stopped', name: 'Census stopped', trigger: 'census.stopped', sentBy: 'sources/ukCensus.js:446-450 (mailed by watch, :763)',
    channels: { email: { subject: '{{#if over == "census"}}Census stopped: the free Text Search (IDs Only) monthly allowance is used up — the census spent {{amount}} of promotional credit or cash on {{day}}{{else}}{{#if over == "net"}}Census stopped: Places cost {{amount}} after credits on {{day}}{{else}}Census stopped: Google billed {{amount}} on {{day}}{{/if}}{{/if}}', body: '{{@subject}}.\n\n{{lines}}' } },
  },
  {
    key: 'census_finished_with_spend', name: 'Census finished, with spend', trigger: 'census.finished_with_spend', sentBy: 'sources/ukCensus.js:453-457 (mailed by watch, :763)',
    channels: { email: { subject: '{{#if over == "census"}}Census (finished): the free Text Search (IDs Only) allowance was used up — {{amount}} of promotional credit or cash on {{day}}{{else}}{{#if over == "net"}}Census (finished): Places cost {{amount}} after credits on {{day}}{{else}}Census (finished) was billed {{amount}} of Google on {{day}}{{/if}}{{/if}}', body: '{{@subject}}.\n\n{{lines}}' } },
  },
  { key: 'census_held', name: 'Census held', trigger: 'census.held', sentBy: 'sources/ukCensus.js:459 (mailed by watch, :763)', channels: { email: { subject: 'Census held: the census was billed £{{amount}} on {{day}}', body: '{{@subject}}.\n\n{{lines}}' } } },
  { key: 'census_tick_failed', name: 'Census tick failed', trigger: 'census.tick_failed', sentBy: 'sources/ukCensus.js:803', channels: { email: { subject: 'Census failed on {{day}}', body: 'The census scheduler could not run:\n\n{{error}}' } } },
  { key: 'census_stalled_running', name: 'Census stalled (not moving)', trigger: 'census.stalled_running', sentBy: 'sources/ukCensus.js:835-836', channels: { email: { subject: 'Census stalled: day {{dayNumber}} has not moved since {{since}} UTC', body: 'The day\'s run is marked running but has not advanced for over {{minutes}} minutes.\n\n{{lines}}' } } },
  { key: 'census_stalled_no_run', name: 'Census stalled (no run)', trigger: 'census.stalled_no_run', sentBy: 'sources/ukCensus.js:853-854', channels: { email: { subject: 'Census stalled: no run for {{day}}', body: 'Google\'s day {{day}} began {{graceHours}}+ hours ago and the census has not started it. The scheduler says: {{action}}{{#if why}} — {{why}}{{/if}}.\n\n{{lines}}' } } },
  { key: 'census_day_failed', name: 'Census failed on a day', trigger: 'census.day_failed', sentBy: 'sources/ukCensus.js:867-868', channels: { email: { subject: 'Census failed: day {{dayNumber}}', body: '{{#if penny}}{{problem}}{{else}}Google refused the census: {{refusal or "no words given"}}{{/if}}\n\n{{lines}}' } } },
  { key: 'census_billing_empty', name: 'Billing export still empty', trigger: 'census.billing_empty', sentBy: 'sources/ukCensus.js:873-874', channels: { email: { subject: 'Census: the billing export is still empty after Friday 2 October', body: 'Google has not delivered any billing rows, so the census cannot check what it has cost. It carries on under the current rule until you say otherwise.' } } },
  { key: 'census_weekly_summary', name: 'Census weekly summary', trigger: 'census.weekly_summary', sentBy: 'sources/ukCensus.js weeklySummary (:754-788), mailed at :887', channels: { email: { subject: 'Census — weekly summary, week to {{today}}', body: '{{summary}}\n\n{{dayLines or "No census days this week."}}' } } },
  { key: 'census_complete', name: 'Census complete', trigger: 'census.complete', sentBy: 'sources/ukCensus.js:889', channels: { email: { subject: 'Census — the rest of the UK is complete', body: '{{lines}}' } } },
  // ---- I. Marketing ------------------------------------------------------------
  {
    key: 'interest_confirmation', name: 'You’re on the Epic list', trigger: 'interest.signed_up', category: 'marketing', sentBy: 'sources/mail.js interestEmail (sent at routes/interest.js:122-127)',
    // Today's words, exactly. They carry no unsubscribe line, so deliver() refuses this one until the owner adds
    // {{unsubscribeUrl}} — a marketing e-mail always says how to stop them (Roger, 3 Oct 2026). Today's sender is unchanged.
    channels: { email: { subject: '{{#if host}}You\'re on the Epic hosts list{{else}}You\'re on the Epic list{{/if}}', body: '{{#if host}}You\'re on the hosts list. We\'ll be in touch before launch.{{else}}You\'re on the list. We\'ll email you when the app\'s out.{{/if}}\n\nDidn\'t sign up? Just ignore this.' } },
  },
  // ---- New wordings: nothing sends these yet; the owner sees them first ---------
  { key: 'guest_message', name: 'A guest sent you a message', trigger: 'booking.guest_message', notificationKind: 'host_guest_message', state: 'new_wording', channels: notif('{{guestName}} sent you a message about {{title or "your event"}}', '“{{message}}”') },
  { key: 'host_question', name: 'A guest asked a question', trigger: 'booking.host_question', notificationKind: 'host_question', state: 'new_wording', channels: notif('A question about {{title or "your event"}}', '{{guestName}} asked: “{{question}}”') },
  { key: 'check_expiring', name: 'Checked is running out', trigger: 'host.checked_expiring', notificationKind: 'check_expiring', state: 'new_wording', channels: notif('Your {{what}} runs out on {{on}}', 'Upload the new one under Checks before then, or your drop-off events pause on that day. Bookings already made are kept.') },
  { key: 'event_live', name: 'Your event is live', trigger: 'event.live', notificationKind: 'event_live', state: 'new_wording', channels: notif('Your event is live: {{title or "your event"}}', 'It has been approved and is taking bookings now.') },
  {
    key: 'referee_request', name: 'Referee request', trigger: 'host.referee_requested', state: 'new_wording',
    channels: { email: { subject: '{{hostName}} has named you as a referee on Epic', body: '{{hostName}} wants to host events on Epic and has named you as a referee.\n\nPlease tell us how you know them, and whether you have any concern about them looking after children:\n{{url}}\n\nIt takes about two minutes. If you don\'t know {{hostName}}, ignore this.' } },
  },
  {
    key: 'referee_reminder', name: 'Referee reminder (after 3 days)', trigger: 'host.referee_reminder', state: 'new_wording',
    channels: { email: { subject: 'A reminder: a reference for {{hostName}}', body: 'Three days ago {{hostName}} named you as a referee on Epic. If you can, please answer here:\n{{url}}\n\nIf you don\'t know {{hostName}}, ignore this.' } },
  },
  { key: 'content_not_used', name: 'We couldn’t use your contribution', trigger: 'content.rejected', state: 'new_wording', channels: { email: { subject: 'We couldn\'t use your contribution', body: '{{message}}' } } },
  {
    key: 'join_code', name: 'Join code (one wording for both)', trigger: 'join_code.issued', state: 'new_wording',
    channels: { email: { subject: 'Your code for {{what}}', body: 'Epic: your code for {{what}} is {{code}}. It works for 10 minutes.' }, sms: { body: 'Epic: your code for {{what}} is {{code}}. It works for 10 minutes.' } },
  },
  // ---- The design's templates nothing has sent before (design handover §7, 3 Oct 2026) ----
  // The rules engine and the Payments chat send these when they are wired; until then they are the owner's to read.
  { key: 'contact_details_hidden', name: 'Contact details hidden', trigger: 'chat.contact_hidden', notificationKind: 'contact_details_hidden', state: 'new_wording', channels: inApp('We hid a phone number or e-mail address in your message', 'Keep talking here on Epic until the booking is made — it’s how we look after both of you.') },
  {
    key: 'strike_warning', name: 'Warning', trigger: 'host.strike', notificationKind: 'strike', state: 'new_wording',
    channels: notif('A warning about your hosting', '{{what}}\n\nThe rule: {{rule}}\n\nThis is a warning. It expires on {{expires}}. If you think it’s wrong, you can appeal once: {{appealUrl}}'),
  },
  {
    key: 'strike_final_warning', name: 'Final warning', trigger: 'host.strike', notificationKind: 'strike', state: 'new_wording',
    channels: notif('A final warning about your hosting', '{{what}}\n\nThe rule: {{rule}}\n\nThis is your final warning: one more and your hosting is suspended. It expires on {{expires}}. You can appeal once: {{appealUrl}}'),
  },
  {
    key: 'strike_suspension', name: 'Suspension', trigger: 'host.strike', notificationKind: 'strike', state: 'new_wording',
    channels: notif('Your hosting is suspended', '{{what}}\n\nThe rule: {{rule}}\n\nYour events are hidden from new bookings. Bookings already made go ahead and you are paid for them as usual. You can appeal once: {{appealUrl}}'),
  },
  {
    key: 'appeal_outcome', name: 'Appeal outcome', trigger: 'host.appeal_decided', notificationKind: 'strike', state: 'new_wording',
    channels: notif('{{#if outcome == "overturned"}}Your appeal was upheld{{else}}Your appeal was looked at{{/if}}', '{{what}}: {{#if outcome == "overturned"}}we have removed it.{{else}}it stays.{{/if}}\n\n{{reason}}'),
  },
  { key: 'rating_dropped', name: 'Rating dropped', trigger: 'host.rating_dropped', notificationKind: 'standing', state: 'new_wording', channels: notif('Your rating has dropped to {{average}}', 'Across your last {{lastRated}} rated events your average is {{average}}, below {{below}}. Your events now show lower in search. Ratings that go back up lift them again.') },
  { key: 'back_to_drafts', name: 'Back to drafts', trigger: 'host.back_to_draft', notificationKind: 'standing', state: 'new_wording', channels: notif('{{title or "Your event"}} is back in your drafts', 'It waited {{days}} days for your checks to be done. Finish them and send it again whenever you’re ready.') },
  { key: 'late_change_counts', name: 'Late change counts', trigger: 'host.late_change', notificationKind: 'standing', state: 'new_wording', channels: notif('A late change on {{title or "your event"}}', 'Changes within {{withinHours}} hours count against your hosting. That’s {{count}} in the last 90 days; a third counts as a strike.') },
  { key: 'something_went_wrong', name: 'Something went wrong', trigger: 'complaint.opened', notificationKind: 'complaint', state: 'new_wording', channels: notif('A guest says something went wrong at {{title or "your event"}}', 'Your payout for it is on hold while we look. Please tell us your side by {{respondBy}}.') },
  {
    key: 'renewal_failed', name: 'Renewal failed', trigger: 'membership.renewal_failed', state: 'new_wording',
    channels: { email: { subject: 'Your Epic membership payment didn’t go through', body: 'We couldn’t take £{{amount}} for your {{plan}} membership. We’ll try again on {{retryOn}}. To use a different card:\n{{updateUrl}}' } },
  },
  {
    key: 'tell_me_when', name: 'Tell me when', trigger: 'tell_me_when.match', category: 'marketing', state: 'new_wording',
    channels: { email: { subject: '{{what}} in {{where}} is on', body: 'You asked us to tell you when there was {{what}} in {{where}}.\n\n{{title}}\n{{url}}\n\nStop these e-mails: {{unsubscribeUrl}}' } },
  },
  // ---- Replies a person chooses (design handover §7) ----
  { key: 'reply_complaint_refund', name: 'Complaint · refund given', kind: 'reply', trigger: 'complaint.reply_refund', state: 'new_wording', channels: { email: { subject: 'About {{title or "your booking"}}', body: 'Hi {{guestName}},\n\nThank you for telling us. We’ve refunded £{{amount}}; it reaches your card in five to ten working days.' } } },
  { key: 'reply_complaint_declined', name: 'Complaint · declined', kind: 'reply', trigger: 'complaint.reply_declined', state: 'new_wording', channels: { email: { subject: 'About {{title or "your booking"}}', body: 'Hi {{guestName}},\n\nThank you for telling us. We’ve looked carefully and won’t be refunding this one: {{reason}}' } } },
  { key: 'reply_warning_to_host', name: 'Warning to the host', kind: 'reply', trigger: 'complaint.reply_warn_host', notificationKind: 'strike', state: 'new_wording', channels: notif('A {{step}} about {{title or "your event"}}', 'A guest complained: {{what}}\n\nThis counts as a {{step}}. You can appeal once: {{appealUrl}}') },
];
/**
 * The design's names, where an inventory record is the same message (Roger,
 * 3 Oct 2026: "use the design's names where they match"). Applied to the seed
 * name only: a record the owner has renamed keeps his name.
 */
export const DESIGN_NAMES = Object.freeze({
  reminder_24h: 'Reminder, 24 h before',
  date_changed: 'Date changed',
  cancelled: 'Cancelled or called off · by the host',
  called_off: 'Cancelled or called off · under the minimum',
  refund_issued: 'Refund issued',
  waitlist_offered: 'Waiting-list place offered',
  after_event: 'Did it happen? Rate it',
  children_paused: 'Paused for a safety report',
  checks_lapsed: 'Checked lapsed',
  check_expiring: 'Checked reminder',
  decides_by_result: 'Decides-by result',
  ask_to_book_declined: 'Your request wasn’t accepted',
});

export const SEED_TEMPLATES = Object.freeze(SEEDS.map((t) => ({
  category: T, kind: 'automatic', state: 'mirrors_code', notificationKind: null, sentBy: null, ...t, name: DESIGN_NAMES[t.key] ?? t.name,
})));
