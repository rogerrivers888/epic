/**
 * Message templates as records (K16; design handover §7): every message Epic
 * sends today seeded with today's words, the design's new templates beside
 * them, versions with Restore, a preview drawn from the trigger's own fields,
 * and edits written to Changes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const { testDatabase } = await import('./helpers/db.js');
const { query, pool } = await testDatabase();
const templates = await import('../src/repositories/templates.js');
const { SEED_TEMPLATES, DESIGN_NAMES } = await import('../src/domain/messageSeeds.js');
const { TRIGGERS, parse } = await import('../src/domain/messages.js');

test.after(async () => { await pool?.end?.(); });

const SRC = path.resolve(import.meta.dirname, '../src');

test('every seed is a template, under the design’s name where the design names it, automatic or a reply', async () => {
  const list = await templates.listTemplates();
  const byKey = new Map(list.map((t) => [t.key, t]));
  for (const s of SEED_TEMPLATES) assert.ok(byKey.has(s.key), `${s.key} is seeded`);
  for (const [key, name] of Object.entries(DESIGN_NAMES)) assert.equal(byKey.get(key).name, name);
  const replies = (await templates.listTemplates({ kind: 'reply' })).map((t) => t.name).sort();
  assert.deepEqual(replies, ['Complaint · declined', 'Complaint · refund given', 'Warning to the host']);
  // The design's automatic templates are all there by name.
  const names = new Set(list.map((t) => t.name));
  for (const n of ['Booking confirmed', 'Reminder, 24 h before', 'Date changed', 'Refund issued', 'Waiting-list place offered', 'Did it happen? Rate it',
    'Warning', 'Final warning', 'Suspension', 'Appeal outcome', 'Checked reminder', 'Renewal failed', 'Contact details hidden', 'Paused for a safety report',
    'Checked lapsed', 'Decides-by result', 'Tell me when', 'Late change counts', 'Your event is live', 'Referee request', 'Referee reminder (after 3 days)',
    'Rating dropped', 'Your request wasn’t accepted', 'Back to drafts', 'Something went wrong']) {
    assert.ok(names.has(n), `“${n}” is a template`);
  }
  // Every automation's templates exist.
  const { rows } = await query('select key, template_keys from automations');
  for (const a of rows) for (const k of a.template_keys) assert.ok(byKey.has(k), `${a.key} sends ${k}, which is a template`);
});

test('a record that mirrors a sender carries that sender’s words: every fixed piece of it is in the sender’s own source', () => {
  /** The fixed text of a template: everything that is not a {{…}} tag, in pieces long enough to mean something. */
  // A chat ping's text is prefixed "Epic: " by the sender at send time (sources/chatNotify.js), not in its words.
  const pieces = (src) => src.split(/\{\{[^}]*\}\}/).flatMap((p) => p.split('\n')).map((p) => p.trim().replace(/^Epic: /, '')).filter((p) => p.length >= 14);
  /** Source as the words read: escapes undone, and the three ways a quote is written folded together. */
  const words = (t) => t.replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\u2019/g, '’');
  let checked = 0;
  const unchecked = [];
  for (const s of SEED_TEMPLATES.filter((t) => t.state === 'mirrors_code')) {
    const file = s.sentBy?.match(/[\w./]+\.js/)?.[0];
    const full = file && [path.join(SRC, file), path.join(SRC, 'sources', file), path.join(SRC, 'routes', file)].find((p) => fs.existsSync(p));
    if (!full) { unchecked.push(s.key); continue; }
    const source = words(fs.readFileSync(full, 'utf8'));
    for (const ch of Object.values(s.channels)) {
      for (const part of Object.values(ch)) {
        for (const p of pieces(part)) {
          // A piece built from a shared constant (the invitation tail) is checked where the constant lives.
          if (!source.includes(p) && !fs.readdirSync(SRC, { recursive: true }).some((f) => f.endsWith('.js') && words(fs.readFileSync(path.join(SRC, f), 'utf8')).includes(p))) {
            assert.fail(`${s.key}: “${p}” is not in ${file} or anywhere in the code — the record and its sender have drifted apart`);
          }
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 60, `checked ${checked} pieces`);
  // Their sender, sources/safetyHolds.js, arrives with the hosting chat's child-safety batch; once it is on main they are checked like the rest.
  const PENDING_SENDER = fs.existsSync(path.join(SRC, 'sources/safetyHolds.js')) ? [] : ['children_paused', 'checks_lapsed'];
  assert.deepEqual(unchecked, PENDING_SENDER, 'every mirrored record names a sender file that exists');
});

test('saving is a new version, Restore saves an older one again, and both are in Changes', async () => {
  const t = await templates.getTemplate('rating_dropped');
  const v = t.version;
  await assert.rejects(templates.saveVersion('rating_dropped', { channels: { in_app: { title: 'Down to {{stars}}' } } }, { who: 'Roger' }), /isn’t a field/);
  const saved = await templates.saveVersion('rating_dropped', { channels: { ...t.channels, in_app: { title: 'Your average is {{average}}', body: t.channels.in_app.body } } }, { who: 'Roger' });
  assert.equal(saved.version, v + 1);
  assert.equal(saved.channels.in_app.title, 'Your average is {{average}}');
  const back = await templates.restoreVersion('rating_dropped', v, { who: 'Roger' });
  assert.equal(back.version, v + 2);
  assert.deepEqual(back.channels, t.channels);
  const all = await templates.versions('rating_dropped');
  assert.equal(all[0].restoredFrom, v);
  const { rows } = await query("select what from bo_changes where area = 'Messages' and subject_id = 'rating_dropped' order by at");
  assert.ok(rows.some((r) => /Edited the “Rating dropped” message/.test(r.what)));
  assert.ok(rows.some((r) => /Restored version/.test(r.what)));
});

test('a preview is drawn with the trigger’s own sample fields, and a draft is checked as a save would be', async () => {
  const p = await templates.preview('strike_warning');
  assert.match(p.channels.in_app.body, /Hosts turn up to every session they run\./);
  assert.match(p.channels.email.subject, /A warning about your hosting/);
  await assert.rejects(templates.preview('strike_warning', { channels: { in_app: { title: '{{password}}' } } }), /isn’t a field/);
  // Every template's fields are its trigger's.
  for (const t of await templates.listTemplates()) assert.ok(TRIGGERS[t.trigger], `${t.key} names a real trigger`);
  assert.ok(parse('{{#if a}}x{{/if}}'));
});

test('a marketing template says how to stop them before it can be sent', async () => {
  const t = await templates.getTemplate('tell_me_when');
  assert.equal(t.category, 'marketing');
  assert.match(t.channels.email.body, /\{\{unsubscribeUrl\}\}/);
  assert.equal(t.channelStatus.push.available, false);
});

test('an edited mirror says it is edited, not what the sender says (Codex, 3 Oct 2026)', async () => {
  const t = await templates.getTemplate('refund_issued');
  assert.equal(t.state, 'mirrors_code');
  const saved = await templates.saveVersion('refund_issued', { channels: t.channels }, { who: 'Roger' });
  assert.equal(saved.state, 'edited');
});

test('e-mail and SMS deliveries keep to their once-only key; a test is logged under the version it sent', async () => {
  const sent = [];
  const was = { ...templates.senders };
  templates.senders.mail = async (m) => { sent.push(m); return { sent: true }; };
  try {
    const a = await templates.deliver({ templateKey: 'renewal_failed', fields: { plan: 'Household', amount: '8.99', retryOn: 'Tuesday', updateUrl: 'https://epic.day/x' }, to: { email: 'm@example.com' }, dedupeKey: 'renewal:abc' });
    const b = await templates.deliver({ templateKey: 'renewal_failed', fields: { plan: 'Household', amount: '8.99', retryOn: 'Tuesday', updateUrl: 'https://epic.day/x' }, to: { email: 'm@example.com' }, dedupeKey: 'renewal:abc' });
    assert.equal(a.channels.email.sent, true);
    assert.deepEqual(b.channels.email, { sent: false, reason: 'already_sent' });
    assert.equal(sent.length, 1);

    const t = await templates.getTemplate('rating_dropped');
    const { rows: [acct] } = await query("insert into accounts (email, role, status, name) values ('roger-test@example.com', 'owner', 'active', 'Roger') returning id, email");
    await templates.sendTest('rating_dropped', { account: { id: acct.id, email: acct.email }, version: 1, channels: ['email'] });
    const { rows: [log] } = await query("select version from message_sends where template_key = 'rating_dropped' and purpose = 'test' order by at desc limit 1");
    assert.equal(log.version, 1);
    assert.ok(t.version >= 1);
  } finally { Object.assign(templates.senders, was); }
});

test('marketing consent is asked of the sign-up the message is for', async () => {
  const { rows: [pottery] } = await query(`insert into guide_alerts (email, subcategory, place_typed, place_key, within_miles, locale, consent_wording) values ('alert@example.com', 'pottery', 'Bath', 'bath', 10, 'en-GB', 'Yes') returning id`);
  const { rows: [climbing] } = await query(`insert into guide_alerts (email, subcategory, place_typed, place_key, within_miles, locale, consent_wording) values ('alert@example.com', 'climbing', 'Bath', 'bath', 10, 'en-GB', 'Yes') returning id`);
  assert.equal(await templates.hasMarketingConsent('alert@example.com', 'tell_me_when.match', { alertId: pottery.id }), true);
  assert.equal(await templates.hasMarketingConsent('alert@example.com', 'tell_me_when.match'), false, 'no alert named, no yes');
  assert.equal(await templates.hasMarketingConsent('alert@example.com', 'interest.signed_up'), false);
  // Unsubscribed from pottery, still on climbing: pottery stops, climbing does not.
  await query(`update guide_alerts set unsubscribed_at = now() where id = $1`, [pottery.id]);
  assert.equal(await templates.hasMarketingConsent('alert@example.com', 'tell_me_when.match', { alertId: pottery.id }), false);
  assert.equal(await templates.hasMarketingConsent('alert@example.com', 'tell_me_when.match', { alertId: climbing.id }), true);
  assert.equal(await templates.hasMarketingConsent('alert@example.com', 'booking.confirmed'), false);
});

test('every in-app template is written under a notification kind for its own audience, or waits to be registered', async () => {
  const { KINDS } = await import('../src/repositories/notifications.js');
  // Kinds the new templates need, registered in repositories/notifications.js (the hosting chat's) when their senders are wired.
  const PENDING = new Set(['checks_lapsed', 'children_paused', 'complaint', 'contact_details_hidden', 'standing', 'strike', 'host_guest_message', 'event_live']);
  const HOST = new Set(['host.strike', 'host.rating_dropped', 'host.appeal_decided', 'host.back_to_draft', 'host.late_change', 'complaint.opened', 'booking.guest_message', 'booking.host_question', 'event.live', 'complaint.reply_warn_host']);
  for (const t of SEED_TEMPLATES.filter((x) => x.channels.in_app && x.notificationKind)) {
    if (KINDS[t.notificationKind]) {
      if (HOST.has(t.trigger)) assert.equal(KINDS[t.notificationKind].audience, 'host', `${t.key} goes to a host`);
    } else assert.ok(PENDING.has(t.notificationKind), `${t.key}: “${t.notificationKind}” is neither registered nor waiting to be`);
  }
  await assert.rejects(templates.deliver({ templateKey: 'contact_details_hidden', to: { householdId: '00000000-0000-0000-0000-000000000000' } }), { code: 'kind_not_registered' });
});

test('a host’s message names its household or account, and a nonsense version is refused in words (Codex, 3 Oct 2026)', async () => {
  await assert.rejects(templates.deliver({ templateKey: 'new_tip', fields: { amount: '5.00', link: 'x' }, to: { email: 'host@example.com' } }), { code: 'no_recipient' });
  await assert.rejects(templates.preview('rating_dropped', { version: 'abc' }), { code: 'bad_request' });
});

test('a host template needs its household even before its notification kind is registered, and a draft test is logged as a draft', async () => {
  await assert.rejects(templates.deliver({ templateKey: 'event_live', channels: ['email'], fields: { title: 'x', link: 'y' }, to: { email: 'host@example.com' } }), { code: 'no_recipient' });
  const was = { ...templates.senders };
  templates.senders.mail = async () => ({ sent: true });
  try {
    const { rows: [acct] } = await query("insert into accounts (email, role, status, name) values ('draft-test@example.com', 'customer', 'active', 'Sam') returning id, email");
    const t = await templates.getTemplate('rating_dropped');
    await templates.sendTest('rating_dropped', { account: { id: acct.id, email: acct.email }, channels: ['email'], channelsDraft: { ...t.channels, email: { subject: 'Draft', body: 'Unsaved words' } } });
    const { rows: [log] } = await query("select draft from message_sends where template_key = 'rating_dropped' and purpose = 'test' and to_ref = 'draft-test@example.com'");
    assert.equal(log.draft, true);
  } finally { Object.assign(templates.senders, was); }
});
