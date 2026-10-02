/**
 * Every statement about a household, its people and what they will and will not
 * eat. The route file above this holds none.
 *
 * Rule 1 of the estate's engineering standard: all SQL lives in `repositories/`.
 * A route that needs data calls a function here.
 */

import { query, withTransaction } from '../db.js';
import { settleClaims, refreshStats } from './placeIndex.js';
import { primaryTravelMode } from '../domain/travel.js';

// ---------------------------------------------------------------------------
// the household
// ---------------------------------------------------------------------------

/**
 * The founding household — the owner's own.
 *
 * Before accounts this was *the* household and `currentHousehold()` was this
 * function. It is now the fallback for the two callers with no account behind
 * them: the owner's shared passcode, and work that runs outside any request.
 */
export async function firstHousehold() {
  const { rows } = await query('select * from households order by created_at limit 1');
  return rows[0] ?? null;
}

/** One named household: an account's own, or a group's, resolved rather than assumed. */
export async function householdById(id) {
  const { rows } = await query('select * from households where id = $1', [id]);
  return rows[0] ?? null;
}

/**
 * Change only what was sent.
 *
 * Home is the exception to "coalesce keeps the old value": a household that
 * moves country has to stop being in the old one, so the country columns follow
 * the coordinates rather than merging with what was there.
 */
export async function updateHousehold(id, f) {
  // A saved "Getting there" also moves the single mode the planner reads, so
  // the setting reaches generated trips (Codex, 2 Oct 2026).
  // Every mode unticked clears it too ('' is the clear), so a trip never
  // keeps travelling a way the screen no longer shows (Codex, 2 Oct 2026).
  if (Array.isArray(f.travelModes) && f.travelMode == null) {
    f = { ...f, travelMode: primaryTravelMode(f.travelModes) ?? '' };
  }
  const { rows } = await query(
    `update households
        set name                  = coalesce($2, name),
            default_visit_minutes = coalesce($3, default_visit_minutes),
            max_travel_minutes    = coalesce($4, max_travel_minutes),
            default_intensity     = coalesce($5, default_intensity),
            home_label            = coalesce($6, home_label),
            home_lat              = coalesce($7, home_lat),
            home_lng              = coalesce($8, home_lng),
            home_country_code     = case when $7::numeric is null then home_country_code else $12 end,
            home_country          = case when $7::numeric is null then home_country      else $13 end,
            -- The household's wording locale follows the market it makes its home
            -- in — seeded the FIRST time a home is set (old home_country_code was
            -- null), so a new US household reads American English rather than the
            -- en-GB default (register 1; the resolver reads this, never a place's
            -- market). Only the first time: a later move must not overwrite an
            -- established locale — a British family relocating to the US keeps
            -- British English (Codex). SET expressions read the pre-update row,
            -- so home_country_code is null here tests the old value. An unknown
            -- market keeps the current value.
            wording_locale        = case
                                      when $7::numeric is null then wording_locale
                                      when home_country_code is null
                                        then coalesce((select default_wording_locale from markets where code = upper($12)), wording_locale)
                                      else wording_locale end,
            pace                  = coalesce($9::jsonb, pace),
            timezone              = coalesce($10, timezone),
            home_radius_miles     = coalesce($11, home_radius_miles),
            -- '' is how the household takes the picture down: coalesce cannot
            -- say "set this to nothing", so an empty string means clear it.
            home_photo_url        = case when $14::text is null then home_photo_url
                                         when $14 = '' then null else $14 end,
            -- What the household always wants when it goes looking (domain/browse.js).
            browse_defaults       = coalesce($15::jsonb, browse_defaults),
            -- How the household usually travels on a day out (set-up step 2).
            travel_mode           = case when $16::text = '' then null else coalesce($16, travel_mode) end,
            -- "Access needs in our household" (the visit question, migration 274).
            access_needs          = coalesce($17, access_needs),
            -- How Epic plans (Settings revised v2, SE7–SE10). Close to home is a
            -- time now; 0 means "any distance" (stored NULL). Travel modes are a
            -- multi-select. The day window is start and finish hours.
            close_to_home_minutes = case when $18::int is null then close_to_home_minutes
                                         when $18 = 0 then null else $18 end,
            -- An explicit multi-select wins; otherwise a legacy single-mode
            -- write (the set-up flow still sends only travelMode) fills an
            -- EMPTY travel_modes with the same mapping the migration used, so
            -- a new household's Settings never reads "Not set" and close-to-
            -- home never silently assumes driving (Codex). A non-empty
            -- multi-select is never overwritten by the legacy word.
            travel_modes          = coalesce($19::jsonb,
                                      case when $16 is not null and travel_modes = '[]'::jsonb then
                                        case $16 when 'driving' then '["car"]'::jsonb
                                                 when 'transit' then '["train","bus"]'::jsonb
                                                 when 'walking' then '["walking"]'::jsonb
                                                 when 'cycling' then '["bike"]'::jsonb
                                                 else travel_modes end
                                      else travel_modes end),
            day_start             = coalesce($20, day_start),
            day_end               = coalesce($21, day_end)
      where id = $1 returning *`,
    [id, f.name ?? null, f.defaultVisitMinutes ?? null, f.maxTravelMinutes ?? null, f.defaultIntensity ?? null,
      f.homeLabel ?? null, f.homeLat ?? null, f.homeLng ?? null, f.pace ? JSON.stringify(f.pace) : null,
      f.timezone ?? null, f.homeRadiusMiles ?? null, f.homeCountryCode ?? null, f.homeCountry ?? null,
      f.homePhotoUrl ?? null, f.browseDefaults ? JSON.stringify(f.browseDefaults) : null, f.travelMode ?? null,
      typeof f.accessNeeds === 'boolean' ? f.accessNeeds : null,
      f.closeToHomeMinutes == null ? null : Number(f.closeToHomeMinutes),
      f.travelModes ? JSON.stringify(f.travelModes) : null,
      f.dayStart == null ? null : Number(f.dayStart), f.dayEnd == null ? null : Number(f.dayEnd)],
  );
  return rows[0] ?? null;
}

/**
 * Delete means delete (Epic 1 C10).
 *
 * `provider_calls` first because it is the one table that outlives the
 * household by design — it is the spend ledger, and it has no cascade. Both in
 * one transaction so a household is never half gone.
 */
export async function deleteHouseholdAndCalls(householdId) {
  let demoted = 0;
  await withTransaction(async (client) => {
    demoted = await wipeHousehold(householdId, client);
  });
  // Outside the transaction, because it takes its own lock and the boards
  // should not wait an hour for the hourly settle to notice (Codex, 18 Sep).
  if (demoted) await refreshStats().catch(() => null);
}

/**
 * The delete itself, inside the caller's transaction — so the route can hold
 * the host's offers locked across the outstanding-bookings check and the
 * delete in one piece (Codex, 1 Oct 2026). Returns how many claims were
 * demoted; the caller refreshes the boards after its commit.
 */
export async function wipeHousehold(householdId, client) {
  // What this household had claimed, read before the cascade takes it. The
  // index row is derived and does not cascade, so a deleted household's
  // claims went on counting in coverage and in Collect's claimed lane for
  // good (Codex, 18 Sep 2026).
  const { rows } = await client.query(
    `select venue_ref from household_places where household_id = $1 and venue_ref is not null
     union
     select venue_ref from place_claims where household_id = $1`, [householdId]);
  await client.query('delete from provider_calls where household_id = $1', [householdId]);
  await client.query('delete from households where id = $1', [householdId]);
  // After the delete: another household may still be claiming the same place,
  // and settleClaims asks that rather than assuming.
  return rows.length ? settleClaims(rows.map((r) => r.venue_ref), client) : 0;
}

// ---------------------------------------------------------------------------
// the people in it
// ---------------------------------------------------------------------------

/** Everybody, each with their own constraints already gathered. */
export async function membersWithConstraints(householdId) {
  const { rows } = await query(
    `select m.*,
            coalesce(json_agg(json_build_object('id', c.id, 'kind', c.kind, 'value', c.value,
                                                'conceptKey', c.concept_key, 'conceptKind', c.concept_kind, 'maxMinutes', c.max_minutes, 'favourite', c.favourite))
                     filter (where c.id is not null), '[]') as constraints
       from members m
       left join member_constraints c on c.member_id = m.id
      where m.household_id = $1
      group by m.id
      order by m.is_minor, m.created_at`,
    [householdId],
  );
  return rows;
}

/** Just the people, in the order every screen lists them: adults first, then by when they joined. */
export async function membersOf(householdId) {
  const { rows } = await query(
    'select * from members where household_id = $1 order by is_minor, created_at',
    [householdId],
  );
  return rows;
}

/** The Household plan covers six people, counted here where every door can see it. */
export const HOUSEHOLD_PLAN_CAP = Number(process.env.EPIC_HOUSEHOLD_PLAN_CAP || 6);

/**
 * How many people this household's plan covers: Solo is just you (one), and
 * adding anybody means the Household plan (owner, 2 Oct 2026). The plan is the
 * lead's — the account the household was set up on, in the order the spend
 * ceiling and the lead checks use.
 */
export async function planCapFor(householdId, client) {
  const run = client ? (t, p) => client.query(t, p) : query;
  const { rows } = await run(
    `select plan from accounts where household_id = $1 order by (role = 'owner') desc, created_at, id limit 1`,
    [householdId],
  );
  return rows[0]?.plan === 'solo' ? { cap: 1, plan: 'solo' } : { cap: HOUSEHOLD_PLAN_CAP, plan: 'household' };
}

/** The one refusal every door gives at the cap — on Solo it says to upgrade. */
export function planCapRefusal({ cap, plan }) {
  const err = new Error(plan === 'solo'
    ? 'Solo is just you. Adding people needs the Household plan.'
    : `Your Household plan covers up to ${cap} people.`);
  err.status = 403;
  err.code = 'plan_cap';
  err.details = { plan, cap, upgrade: plan === 'solo' };
  return err;
}

export async function insertMember(householdId, m) {
  // The cap is enforced here, under the household's row lock, so every door
  // that adds a person — Settings, voice, a group invite — shares one check
  // and two concurrent adds cannot both squeeze under it (Codex, 1 Oct 2026).
  const [member] = await insertMembers(householdId, [m]);
  return member;
}

/**
 * Several people at once, all or none: one transaction holding the household
 * lock across the cap check and every insert, so a list that does not fit —
 * even because another add landed a moment earlier — writes nobody (Codex,
 * 2 Oct 2026).
 */
export async function insertMembers(householdId, list) {
  if (!list.length) return [];
  const made = [];
  await withTransaction(async (client) => {
    await client.query('select id from households where id = $1 for update', [householdId]);
    const { rows: counted } = await client.query('select count(*)::int n from members where household_id = $1', [householdId]);
    const limit = await planCapFor(householdId, client);
    if (counted[0].n + list.length > limit.cap) throw planCapRefusal(limit);
    for (const m of list) {
      const { rows } = await client.query(
        `insert into members (household_id, name, is_minor, relationship, birth_year, birth_date, avatar_url, typical_visit_minutes, max_travel_minutes, email, mobile)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
        [householdId, m.name, m.isMinor, m.relationship ?? null, m.birthYear ?? null, m.birthDate ?? null,
          m.avatarUrl ?? null, m.typicalVisitMinutes ?? null, m.maxTravelMinutes ?? null,
          m.email ?? null, m.mobile ?? null],
      );
      made.push(rows[0]);
    }
  });
  return made;
}

/**
 * Change only what was sent — and work out whether they are still a minor from
 * whichever of birth date or birth year the change leaves behind, so the answer
 * cannot disagree with the dates it was derived from.
 */
/**
 * A member is only ever edited by the household they belong to.
 *
 * These were keyed on the member's UUID alone, so any signed-in household that
 * came by another's member id could rename them, take their contact details or
 * delete them outright — and deleting a member takes their allergens and their
 * whole rating history with them by cascade (Codex, 8 Sep 2026). The check is
 * in the SQL rather than the route so that the next route to call this cannot
 * forget it; the household is a required argument for the same reason.
 */
export async function updateMember(id, m, householdId) {
  const { rows } = await query(
    `update members
        set name                  = coalesce($2, name),
            relationship          = coalesce($3, relationship),
            birth_year            = (case when $8::text = '' then $4 else coalesce($4, birth_year) end),
            avatar_url            = case when $5::text = '' then null else coalesce($5, avatar_url) end,
            typical_visit_minutes = coalesce($6, typical_visit_minutes),
            max_travel_minutes    = coalesce($7, max_travel_minutes),
            birth_date            = (case when $8::text = '' then null else coalesce(nullif($8::text, '')::date, birth_date) end),
            -- How to reach them, so they can be invited (migration 056). '' is
            -- how the Household tab takes a contact detail back off somebody,
            -- the way it already takes a face off them.
            email                 = case when $9::text = '' then null else coalesce($9, email) end,
            mobile                = case when $10::text = '' then null else coalesce($10, mobile) end,
            is_minor              = case when (case when $8::text = '' then null else coalesce(nullif($8::text, '')::date, birth_date) end) is not null
                                         then age((case when $8::text = '' then null else coalesce(nullif($8::text, '')::date, birth_date) end)) < interval '13 years'
                                         when (case when $8::text = '' then $4 else coalesce($4, birth_year) end) is not null
                                         then (extract(year from now())::int - (case when $8::text = '' then $4 else coalesce($4, birth_year) end)) < 13
                                         else is_minor end,
            -- The person's own tastes, carried on the person now (Settings
            -- revised v2): one main diet, the two faith flags, the access
            -- needs, the words Epic must never learn, and whose ratings a
            -- Places row shows for them. '' clears the private allergen note.
            diet                  = coalesce($12, diet),
            halal                 = coalesce($13::boolean, halal),
            kosher                = coalesce($14::boolean, kosher),
            access                = coalesce($15::jsonb, access),
            allergen_note         = case when $16::text = '' then null else coalesce($16, allergen_note) end,
            -- Forgetting is permanent: a save adds to the list and never
            -- takes from it, so a stale tab cannot un-forget (Codex, 2 Oct 2026).
            never_learn           = case when $17::jsonb is null then never_learn else (
                                      select coalesce(jsonb_agg(distinct v order by v), '[]'::jsonb)
                                        from (select jsonb_array_elements_text(never_learn) v
                                              union select jsonb_array_elements_text($17::jsonb)) x) end,
            ratings_view          = coalesce($18::jsonb, ratings_view)
      where id = $1 and household_id = $11 returning *`,
    [id, m.name ?? null, m.relationship ?? null, m.birthYear ?? null, m.avatarUrl ?? null,
      m.typicalVisitMinutes ?? null, m.maxTravelMinutes ?? null, m.birthDate ?? null,
      m.email ?? null, m.mobile ?? null, householdId,
      m.diet ?? null, typeof m.halal === 'boolean' ? m.halal : null, typeof m.kosher === 'boolean' ? m.kosher : null,
      m.access ? JSON.stringify(m.access) : null, m.allergenNote ?? null,
      m.neverLearn ? JSON.stringify(m.neverLearn) : null, m.ratingsView ? JSON.stringify(m.ratingsView) : null],
  );
  return rows[0] ?? null;
}

/** How many people are in a household — the plan cap (≤ 6) is checked against this. */
export async function memberCount(householdId) {
  const { rows } = await query('select count(*)::int n from members where household_id = $1', [householdId]);
  return rows[0].n;
}

/** One person, on their own — the invite routes check who they are before acting. */
export async function memberById(id) {
  const { rows } = await query('select * from members where id = $1', [id]);
  return rows[0] ?? null;
}

/** Epic 1 M3 — this takes their rating history with them, by cascade. */
export async function deleteMember(id, householdId) {
  const { rowCount } = await query(
    'delete from members where id = $1 and household_id = $2', [id, householdId]);
  return rowCount;
}

// ---------------------------------------------------------------------------
// allergens, diets, likes and dislikes
// ---------------------------------------------------------------------------

/** The person a constraint belongs to, scoped to the household, for the edit guard. */
export async function memberByConstraint(constraintId, householdId) {
  const { rows } = await query(
    `select m.* from member_constraints c join members m on m.id = c.member_id
      where c.id = $1 and m.household_id = $2`, [constraintId, householdId]);
  return rows[0] ?? null;
}

export async function constraintsOfKind(memberId, kind) {
  const { rows } = await query('select * from member_constraints where member_id = $1 and kind = $2', [memberId, kind]);
  return rows;
}

export async function capConstraint(id, maxMinutes) {
  const { rows } = await query('update member_constraints set max_minutes = $2 where id = $1 returning *', [id, maxMinutes]);
  return rows[0] ?? null;
}

/**
 * Add one, or fold it into the one already there.
 *
 * A favourite already set is never unset by adding the same thing again, and a
 * limit already set survives an add that carries none: the row only ever gains.
 */
export async function upsertConstraint(memberId, c) {
  const { rows } = await query(
    `insert into member_constraints (member_id, kind, value, concept_key, concept_kind, max_minutes, favourite)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (member_id, kind, value) do update
        set concept_key  = excluded.concept_key,
            concept_kind = excluded.concept_kind,
            max_minutes  = coalesce(excluded.max_minutes, member_constraints.max_minutes),
            favourite    = excluded.favourite or member_constraints.favourite
     returning *`,
    [memberId, c.kind, c.value, c.conceptKey ?? null, c.conceptKind ?? null, c.maxMinutes ?? null, Boolean(c.favourite)],
  );
  return rows[0];
}

/**
 * "Walks — up to 40 minutes", and "the one this person will generally pick".
 *
 * Only the fields present in `fields` are touched, which is why the statement is
 * assembled rather than written out — and why it is assembled here, where the
 * column names live, rather than in a route.
 */
/**
 * A constraint is reached through the member, and the member through the
 * household — so somebody else's allergen cannot be edited or removed by id
 * (Codex, 8 Sep 2026). An allergen excludes; quietly deleting one is the most
 * dangerous write in this file.
 */
export async function patchConstraint(id, fields, householdId) {
  const sets = [];
  const params = [id];
  if ('maxMinutes' in fields) {
    params.push(fields.maxMinutes ? Number(fields.maxMinutes) : null);
    sets.push(`max_minutes = $${params.length}`);
  }
  if ('favourite' in fields) {
    params.push(Boolean(fields.favourite));
    sets.push(`favourite = $${params.length} and kind = 'like'`);
  }
  if (!sets.length) return { nothingToDo: true, constraint: null };
  params.push(householdId);
  const { rows } = await query(
    `update member_constraints set ${sets.join(', ')}
      where id = $1 and member_id in (select id from members where household_id = $${params.length})
      returning *`, params);
  return { nothingToDo: false, constraint: rows[0] ?? null };
}

export async function deleteConstraint(id, householdId) {
  const { rowCount } = await query(
    `delete from member_constraints
      where id = $1 and member_id in (select id from members where household_id = $2)`,
    [id, householdId]);
  return rowCount;
}

// ---------------------------------------------------------------------------
// what the ratings have taught us, and what has been spent
// ---------------------------------------------------------------------------

/** Every rating that names a concept, with the date it was given. */
export async function conceptRatings(householdId) {
  const { rows } = await query(
    `select r.member_id, m.name, r.concept_key, r.take, v.visited_on
       from ratings r
       join visits v on v.id = r.visit_id
       join members m on m.id = r.member_id
      where v.household_id = $1 and r.concept_key is not null`,
    [householdId],
  );
  return rows;
}

/** The last few hundred provider calls, for the spend drawer. */
export async function recentProviderCalls(householdId, limit = 300) {
  const { rows } = await query(
    `select id, created_at as at, provider, purpose, coalesce(estimated_cost_usd, 0)::float as cost_usd, units
       from provider_calls where household_id = $1
      order by created_at desc limit $2`,
    [householdId, limit],
  );
  return rows;
}

/**
 * Everything the household has generated, for the export.
 *
 * Licensed place content is never in here: these are identifiers, dates and
 * what the household wrote (Technical Constraints §4).
 */
export async function everythingFor(householdId) {
  const [trips, stops, visits, ratings, ledger] = await Promise.all([
    query('select * from trips where household_id = $1 order by depart_at', [householdId]),
    query('select s.* from trip_stops s join trips t on t.id = s.trip_id where t.household_id = $1 order by s.trip_id, s.position', [householdId]),
    query('select * from visits where household_id = $1 order by visited_on', [householdId]),
    query('select r.* from ratings r join visits v on v.id = r.visit_id where v.household_id = $1 order by r.created_at', [householdId]),
    query('select * from place_ledger where household_id = $1 order by created_at', [householdId]),
  ]);
  return { trips: trips.rows, stops: stops.rows, visits: visits.rows, ratings: ratings.rows, ledger: ledger.rows };
}

// ---------------------------------------------------------------------------
// setting one up
// ---------------------------------------------------------------------------

export async function anyHouseholdExists() {
  const { rows } = await query('select id from households limit 1');
  return rows.length > 0;
}

/** Only ever from `npm run seed --force`, which says so before it runs. */
export async function deleteAllHouseholds(client) {
  await client.query('delete from households');
}

export async function createHousehold(client, h) {
  const { rows } = await client.query(
    `insert into households (name, default_visit_minutes, max_travel_minutes, default_intensity, origin)
     values ($1, $2, $3, $4, $5) returning id`,
    [h.name, h.defaultVisitMinutes, h.maxTravelMinutes, h.defaultIntensity, h.origin ?? 'founding'],
  );
  return rows[0].id;
}

export async function createMember(client, householdId, m) {
  const { rows } = await client.query(
    `insert into members (household_id, name, is_minor, relationship, birth_year, typical_visit_minutes)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [householdId, m.name, m.isMinor, m.relationship ?? null, m.birthYear ?? null, m.typicalVisitMinutes],
  );
  return rows[0].id;
}

export async function createConstraint(client, memberId, kind, value) {
  await client.query('insert into member_constraints (member_id, kind, value) values ($1, $2, $3)', [memberId, kind, value]);
}
