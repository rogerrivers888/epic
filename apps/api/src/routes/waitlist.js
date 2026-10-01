/**
 * Back office › Waitlist (WL1): everyone who registered interest on epic.day,
 * before launch (Website & Registration v2).
 *
 * Mounted under `/api/admin` behind the admin door (server.js). Reading and
 * changing are a pair, as every area's are (access.js): `view_waitlist` reads
 * the list, and `manage_waitlist` exports it or deletes from it. The export is
 * the change of the two that matters most — it is the whole list leaving the
 * building — so it needs the manage half, and it is written to the audit trail
 * with the filter and the row count, never the addresses.
 *
 *   GET    /api/admin/waitlist?search=&source=&kind=&locale=&campaign=
 *   GET    /api/admin/waitlist.csv?…the same filters…
 *   DELETE /api/admin/waitlist/:id     an erasure request: the row is gone, the audit keeps no email
 */

import express from 'express';
import { requires } from '../access.js';
import { writeAuditStrict } from '../repositories/roles.js';
import { KINDS, deleteSignup, listSignups, waitlistSummary } from '../repositories/interest.js';
import { LOCALES, SOURCES } from './interest.js';

const router = express.Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND_KEYS = new Set(KINDS.map((k) => k.key));
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.key, k.label]));

const actor = (req) => ({ actorId: req.account?.id ?? null, actorLabel: req.account?.email ?? 'the owner (passcode)' });
const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_filter' });

/**
 * The filters from the query string. An unknown value is refused, not ignored:
 * a filter quietly dropped widens the table — and the export — to rows the
 * person did not ask for.
 */
function filtersOf(q) {
  const one = (v) => (typeof v === 'string' ? v.trim() : '');
  const search = one(q.search).slice(0, 300);
  const source = one(q.source).toLowerCase();
  const kind = one(q.kind).toLowerCase();
  const locale = one(q.locale).toLowerCase();
  const campaign = one(q.campaign).slice(0, 300);
  if (source && !SOURCES.has(source)) throw bad('That source is not one we know.');
  if (kind && !KIND_KEYS.has(kind)) throw bad('That host kind is not one we know.');
  if (locale && !LOCALES.has(locale)) throw bad('That locale is not one we know.');
  return {
    search: search || null, source: source || null, kind: kind || null,
    locale: locale || null, campaign: campaign || null,
  };
}

/** "Homepage" / "Host page" / "Landing · {page name}". */
export const sourceLabel = (row) => (row.landing_page
  ? `Landing · ${row.landing_page}`
  : row.source === 'host' ? 'Host page' : 'Homepage');

const rowView = (r) => ({
  id: r.id,
  email: r.email,
  source: r.source,
  sourceLabel: sourceLabel(r),
  hostKind: r.host_kind ?? null,
  hostKindLabel: r.host_kind ? KIND_LABEL[r.host_kind] : null,
  locale: r.locale,
  country: r.country ?? null,
  campaign: r.campaign,
  landingPage: r.landing_page ?? null,
  signedUp: r.created_at,
});

/**
 * A breakdown line's share of every sign-up. With nobody on the list there is no
 * share to speak of, so it is null — never a 0 that reads as "nobody chose this"
 * (CLAUDE.md: every diagnostic has a can't-speak state).
 */
const shareOf = (n, all) => (all > 0 ? Math.round((n / all) * 10000) / 10000 : null);

router.get('/waitlist', requires('view_waitlist'), async (req, res, next) => {
  try {
    const filters = filtersOf(req.query);
    const [rows, summary] = await Promise.all([listSignups(filters), waitlistSummary()]);
    const all = summary.totals.all;
    const counted = new Map(summary.kinds.map((k) => [k.key, k.signups]));
    res.json({
      rows: rows.map(rowView),
      totals: summary.totals,
      byKind: KINDS.map((k) => ({ key: k.key, label: k.label, signups: counted.get(k.key) ?? 0, share: shareOf(counted.get(k.key) ?? 0, all) })),
      byCampaign: summary.campaigns.map((c) => ({ key: c.key, signups: c.signups, share: shareOf(c.signups, all) })),
      count: rows.length,
    });
  } catch (err) { next(err); }
});

/**
 * One CSV cell. A cell a spreadsheet would read as a formula — starting with
 * `=`, `+`, `-`, `@`, or a tab or carriage return that some of them skip before
 * looking — is prefixed with a single quote, so an address somebody typed as
 * `=HYPERLINK(…)` arrives as text. Then RFC 4180 quoting where it is needed.
 */
export function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_COLUMNS = ['email', 'source', 'host_kind', 'locale', 'campaign', 'signed_up'];

router.get('/waitlist.csv', requires('manage_waitlist'), async (req, res, next) => {
  try {
    const filters = filtersOf(req.query);
    const rows = await listSignups(filters);
    // Written before the file leaves, and strictly: an export nobody can see in
    // the audit trail does not happen. The search text is not kept — it may be
    // an address — only that one was applied.
    await writeAuditStrict({
      ...actor(req),
      action: 'waitlist.export',
      subjectType: 'waitlist',
      after: { filters: { ...filters, search: filters.search ? '(applied)' : null }, rows: rows.length },
    });
    const lines = [CSV_COLUMNS.join(',')];
    for (const r of rows) {
      lines.push([
        r.email, sourceLabel(r), r.host_kind ?? '', r.locale, r.campaign,
        new Date(r.created_at).toISOString(),
      ].map(csvCell).join(','));
    }
    const day = new Date().toISOString().slice(0, 10);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="epic-waitlist-${day}.csv"`);
    res.set('Cache-Control', 'no-store');
    // A byte-order mark, so Excel reads "Landing · …" as UTF-8 rather than mojibake.
    res.send(`﻿${lines.join('\r\n')}\r\n`);
  } catch (err) { next(err); }
});

router.delete('/waitlist/:id', requires('manage_waitlist'), async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!UUID.test(id)) return res.status(404).json({ error: 'not_found', message: 'That sign-up is not on the waitlist.' });
    const gone = await deleteSignup(id, actor(req));
    if (!gone) return res.status(404).json({ error: 'not_found', message: 'That sign-up is not on the waitlist.' });
    return res.json({ ok: true, id: gone.id });
  } catch (err) { next(err); }
});

export default router;
