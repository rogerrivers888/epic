/**
 * The pre-launch waitlist (migration 320): who registered interest on
 * epic.day, and the back office's reading of it (WL1).
 *
 * Rule 1 of the estate's engineering standard: all SQL lives in `repositories/`.
 * Every filter is a parameter — the search box is somebody's typing and the
 * campaign is whatever a link carried in its `utm_campaign`.
 */

import { query, withTransaction } from '../db.js';

/**
 * The campaign a row is filed under: `utm_campaign`, else `utm_source`, else
 * "Direct" (README › Registration: "campaign (from utm_source / utm_campaign, or
 * 'Direct')"). One expression, so the breakdown, the filter and the export can
 * never disagree about which campaign a row belongs to.
 */
const CAMPAIGN = `coalesce(nullif(utm_campaign, ''), nullif(utm_source, ''), 'Direct')`;

/** The host kinds in the order WL1 lists them, with "Not given" last. */
export const KINDS = [
  { key: 'one-off', label: 'One-off' },
  { key: 'activity', label: 'Activity' },
  { key: 'class', label: 'Class' },
  { key: 'homeschool', label: 'Homeschool' },
  { key: 'none', label: 'Not given' },
];

/**
 * Add one person to one list. Returns the new row, or null when they were
 * already on it — which the route answers exactly as it answers a first
 * sign-up, and uses only to decide whether to send a confirmation.
 */
export async function addSignup(s) {
  const { rows } = await query(
    `insert into interest_signups
       (email, source, host_kind, locale, country, landing_page, referrer,
        utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid, consent_wording)
     values (lower($1), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     on conflict (lower(email), source) do nothing
     returning id, email, source, host_kind, locale, created_at`,
    [s.email, s.source, s.hostKind ?? null, s.locale, s.country ?? null, s.landingPage ?? null, s.referrer ?? null,
      s.utmSource ?? null, s.utmMedium ?? null, s.utmCampaign ?? null, s.utmTerm ?? null, s.utmContent ?? null,
      s.gclid ?? null, s.fbclid ?? null, s.consentWording],
  );
  return rows[0] ?? null;
}

/** `%` and `_` typed into the search box are letters, not wildcards. */
const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * The WHERE clause for WL1's filters. Each is optional and they combine with
 * AND. `kind = 'none'` is "Not given" — no host kind at all.
 */
function whereFor({ search, source, kind, locale, campaign } = {}) {
  const parts = [];
  const params = [];
  const add = (sql, value) => { params.push(value); parts.push(sql.replace('?', `$${params.length}`)); };
  if (search) add(`email ilike '%' || ? || '%'`, likeEscape(search));
  if (source) add('source = ?', source);
  if (kind === 'none') parts.push('host_kind is null');
  else if (kind) add('host_kind = ?', kind);
  if (locale) add('locale = ?', locale);
  if (campaign) add(`${CAMPAIGN} = ?`, campaign);
  return { where: parts.length ? `where ${parts.join(' and ')}` : '', params };
}

/** The filtered rows, newest first — every one, uncapped: the export is "the currently filtered rows". */
export async function listSignups(filters) {
  const { where, params } = whereFor(filters);
  const { rows } = await query(
    `select id, email, source, host_kind, locale, country, landing_page, ${CAMPAIGN} as campaign, created_at
       from interest_signups ${where}
      order by created_at desc, id`,
    params,
  );
  return rows;
}

/**
 * WL1's totals and both breakdowns, over every row — never the filter, so
 * clicking a row in a breakdown narrows the table without changing the figures
 * that were clicked.
 */
export async function waitlistSummary() {
  const [totals, kinds, campaigns] = await Promise.all([
    query(
      `select count(*)::int as all,
              count(*) filter (where source = 'home')::int as home,
              count(*) filter (where source = 'host')::int as host,
              count(*) filter (where created_at > now() - interval '7 days')::int as last7
         from interest_signups`,
    ),
    query(
      `select coalesce(host_kind, 'none') as key, count(*)::int as signups
         from interest_signups group by 1`,
    ),
    query(
      `select ${CAMPAIGN} as key, count(*)::int as signups
         from interest_signups group by 1 order by 2 desc, 1`,
    ),
  ]);
  return { totals: totals.rows[0], kinds: kinds.rows, campaigns: campaigns.rows };
}

/**
 * Hard-delete one row (an erasure request) and write its audit entry in the same
 * transaction: a delete with no record of it, or a record of a delete that did
 * not happen, are both worse than neither. The audit carries what kind of row it
 * was and never the address — the point of the delete is that the address is
 * gone from everywhere, the audit trail included.
 */
export async function deleteSignup(id, { actorId = null, actorLabel = null } = {}) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `delete from interest_signups where id = $1
       returning id, source, host_kind, locale, ${CAMPAIGN} as campaign, created_at`,
      [id],
    );
    const gone = rows[0];
    if (!gone) return null;
    await client.query(
      `insert into admin_audit (actor_id, actor_label, action, subject_type, subject_id, subject_label, before, after)
       values ($1, $2, 'waitlist.delete', 'interest_signup', $3, null, $4, null)`,
      [actorId, actorLabel, gone.id, JSON.stringify({
        source: gone.source, hostKind: gone.host_kind, locale: gone.locale,
        campaign: gone.campaign, signedUp: gone.created_at,
      })],
    );
    return gone;
  });
}
