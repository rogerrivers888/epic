/**
 * What households have sent us, waiting to be looked at.
 *
 * One queue over everything a household made, filtered by kind and state rather
 * than split into a queue each — the act is the same every time: somebody looks
 * and decides. Forty beach photographs can be approved together; **a person's
 * review is never rejected in a batch.**
 *
 * The queue is a spine, not a copy. It holds a pointer at the thing itself, so
 * nothing a household wrote is duplicated here and an erasure that reaches the
 * original reaches this too.
 *
 * Two rules the architecture sets:
 *   · only household-made content and pictures we own ever appear. A provider's
 *     photograph must never be in here, and if one is, something is wrong
 *     upstream — so the photo sync reads `contributor_household_id`, not
 *     `image_assets` at large.
 *   · the reviewer's trail goes to `admin_audit`, not to a table of its own.
 */

import { query, withTransaction } from '../db.js';
import { mailConfigured, sendMail } from '../sources/mail.js';

/** The kinds, in the order the filter prints them. */
export const KINDS = [
  // `said` is the word a sentence uses — "Thanks for the photograph of Dinton
  // Pastures" — where `label` is the word a column header uses. The message used
  // to interpolate the key and read "Thanks for the photo" (17 Sep 2026, the
  // verification audit).
  { key: 'photo',   label: 'Photo',   said: 'photograph',    batch: true  },
  { key: 'review',  label: 'Review',  said: 'review',        batch: false },
  { key: 'rating',  label: 'Rating',  said: 'rating',        batch: false },
  { key: 'note',    label: 'Note',    said: 'note on a dish', batch: false },
  { key: 'offer',   label: 'Offer',   said: 'offer',         batch: false },
  { key: 'message', label: 'Message', said: 'message',       batch: false },
  // Flagged data quality: the hours three sources disagree about. Not made by a
  // household, but it is the same act — somebody looks and decides — so it is in
  // the same queue rather than in a screen of its own.
  { key: 'data',    label: 'Data',    said: 'flag',          batch: false },
];

export const STATES = ['waiting', 'approved', 'rejected', 'reported'];

/**
 * Why something was turned down — a **closed list**, so the common one can be
 * counted and designed out rather than argued about.
 *
 * `message` is what the household is told, and it is written next to the button
 * that sends it rather than composed afterwards.
 */
export const REASONS = {
  photo: [
    { key: 'unclear',   label: 'You cannot tell what the place is',
      message: 'We are not going to put this one up — it is hard to tell what it is a picture of.' },
    // BO5b's own message, all three sentences of it. Only the first was built,
    // and the two that were missing are the two that matter to the person
    // reading it: that nothing else of theirs has been touched, and that we
    // would like another (18 Sep 2026, the separate audit).
    { key: 'dark',      label: 'It is too dark or too blurred to use',
      message: 'We are not going to put this one up — it came out too dark to show the place properly. '
        + 'Your other photographs are all still there, and your credit is unaffected. '
        + 'If you are there again on a brighter day, we would love another.' },
    { key: 'faces',     label: 'Somebody’s face is in it',
      message: 'We are not going to put this one up — somebody’s face is in it, and we only publish pictures of the place itself.' },
    { key: 'elsewhere', label: 'It is of a different place',
      message: 'We are not going to put this one up — it looks like it was taken somewhere else.' },
    { key: 'not_theirs', label: 'It is not theirs to give us',
      message: 'We are not going to put this one up — we do not think this photograph is yours to give us.' },
  ],
  review: [
    { key: 'not_about', label: 'It is not about the place', message: 'We have not published this one — it is not really about the place itself.' },
    { key: 'personal',  label: 'It names somebody', message: 'We have not published this one — it names a member of staff, and we keep people out of reviews.' },
    { key: 'abusive',   label: 'It is abusive', message: 'We have not published this one.' },
    { key: 'not_been',  label: 'They have not been', message: 'We have not published this one — we only publish reviews from people who have been.' },
  ],
  rating: [
    { key: 'not_been',  label: 'They have not been', message: 'We have not published this one — we only publish ratings from people who have been.' },
    { key: 'duplicate', label: 'It is a duplicate', message: 'We have not published this one — you have already rated this place.' },
  ],
  note: [
    { key: 'not_about', label: 'It is not about the dish', message: 'We have not published this one — it is not really about the dish.' },
    { key: 'abusive',   label: 'It is abusive', message: 'We have not published this one.' },
  ],
  data: [
    { key: 'wrong',     label: 'Ours is the wrong one', message: null },
    { key: 'theirs',    label: 'Theirs is the wrong one', message: null },
  ],
};
REASONS.offer = REASONS.review;
REASONS.message = REASONS.review;

const kindReasons = (kind) => REASONS[kind] ?? REASONS.review;
export const reasonFor = (kind, key) => kindReasons(kind).find((r) => r.key === key) ?? null;

/**
 * Bring in everything a household has made that nobody has looked at.
 *
 * Idempotent on `(subject_type, subject_id)`, so it can run after every write
 * and on a timer without ever creating a second row for the same thing.
 */
export async function sync() {
  const before = (await query('select count(*)::int as n from content_queue')).rows[0].n;

  // Photographs a household sent us. `contributor_household_id` is the whole
  // filter: a provider's photograph is not household-made and cannot appear.
  await query(`
    insert into content_queue (kind, subject_type, subject_id, household_id, account_id, maker_label, venue_ref, made_at, state)
    select 'photo', 'image', ia.id::text, ia.contributor_household_id, ia.contributor_account_id,
           coalesce(h.name, 'A household'),
           (select li.subject_id from image_links li where li.image_id = ia.id and li.subject_type = 'place' limit 1),
           ia.fetched_at,
           case ia.moderation when 'approved' then 'approved' when 'rejected' then 'rejected' else 'waiting' end
      from image_assets ia
      left join households h on h.id = ia.contributor_household_id
     where ia.contributor_household_id is not null
    -- A decision made on the Library screen has to reach the queue row, or the
    -- queue goes on showing an approved photograph as waiting and lets
    -- somebody decide it a second time, the other way (Codex, 17 Sep 2026).
    -- image_assets.moderation is the truth about a photograph; the queue row
    -- is a view of it.
    -- Except where somebody has reported it and nobody has looked yet: the
    -- report sends the row back to waiting while the asset is still approved,
    -- and copying the asset's state over the top took the photograph straight
    -- out of the lane it had just been put in — leaving it public with the
    -- report filed nowhere (Codex, 18 Sep 2026).
    on conflict (subject_type, subject_id) do update
       set state = excluded.state
     where content_queue.state <> excluded.state
       and not (content_queue.reported and content_queue.state = 'waiting')`);

  // A household's own words about a place they went to.
  await query(`
    insert into content_queue (kind, subject_type, subject_id, household_id, account_id, maker_label, venue_ref, place_label, made_at)
    select 'review', 'visit', v.id::text, v.household_id, null, coalesce(h.name, 'A household'),
           v.venue_ref, v.venue_label, v.created_at
      from visits v left join households h on h.id = v.household_id
     where coalesce(v.note, '') <> ''
    on conflict (subject_type, subject_id) do nothing`);

  // A rating, and a note on a dish, which are the same row wearing two hats.
  //
  // A rating of the *place* comes in whether or not anybody wrote anything: its
  // two reasons — "they have not been" and "it is a duplicate" — are about the
  // score, so a wordless rating that could not be queued could never be taken
  // down either (Codex, 18 Sep 2026). A rating of one *dish* only comes in when
  // there are words to read, because both of its reasons are about the words;
  // and it comes in as BO5a's own kind, "Note on a dish", which was declared
  // and then never filled by anything.
  await query(`
    insert into content_queue (kind, subject_type, subject_id, household_id, maker_label, venue_ref, place_label, made_at)
    select case when coalesce(r.concept_key, r.concept_id::text) is not null then 'note' else 'rating' end,
           'rating', r.id::text, v.household_id, coalesce(m.name, h.name, 'A household'),
           v.venue_ref, v.venue_label, r.created_at
      from ratings r
      join visits v on v.id = r.visit_id
      left join members m on m.id = r.member_id
      left join households h on h.id = v.household_id
     where coalesce(r.concept_key, r.concept_id::text) is null
        or coalesce(r.comment, '') <> ''
    -- The kind is a view of the rating, not a decision somebody made, so a row
    -- filed under the old rule is moved rather than left saying the wrong word.
    on conflict (subject_type, subject_id) do update
       set kind = excluded.kind
     where content_queue.kind <> excluded.kind`);

  await query(`
    insert into content_queue (kind, subject_type, subject_id, household_id, maker_label, made_at)
    select 'review', 'host_review', hr.id::text, hr.household_id, coalesce(h.name, 'A household'), hr.created_at
      from host_reviews hr left join households h on h.id = hr.household_id
     where coalesce(hr.text, '') <> ''
    on conflict (subject_type, subject_id) do nothing`);

  await query(`
    insert into content_queue (kind, subject_type, subject_id, household_id, maker_label, made_at)
    select 'message', 'chat_topic', t.id::text, m.household_id, coalesce(m.name, 'Somebody'), t.created_at
      from chat_topics t left join members m on m.id = t.author_member_id
     where not t.hidden
    on conflict (subject_type, subject_id) do nothing`);

  // A reply is somebody's words in public exactly as a topic is, and abuse is
  // more often in a reply than in the opening question. Leaving them out meant a
  // reported reply could never be acted on (Codex, 17 Sep 2026).
  await query(`
    insert into content_queue (kind, subject_type, subject_id, household_id, maker_label, made_at)
    select 'message', 'chat_reply', rp.id::text, m.household_id, coalesce(m.name, 'Somebody'), rp.created_at
      from chat_replies rp
      join chat_topics t on t.id = rp.topic_id
      left join members m on m.id = rp.author_member_id
     where not rp.hidden and coalesce(rp.body, '') <> ''
    on conflict (subject_type, subject_id) do nothing`);

  await query(`
    insert into content_queue (kind, subject_type, subject_id, household_id, maker_label, made_at)
    select 'offer', 'open_entry', e.id::text, e.household_id, coalesce(h.name, 'A household'), e.created_at
      from open_entries e left join households h on h.id = e.household_id
     where e.state = 'active' and not e.hidden
    on conflict (subject_type, subject_id) do nothing`);

  // Where a picture or a review is about a place, say which area it is in, so
  // the queue can be filtered the way the rest of the back office is.
  await query(`
    update content_queue q
       set area_slug = (select l.slug from place_areas pa join localities l on l.slug = pa.area_slug
                         where pa.venue_ref = q.venue_ref and l.kind = 'county' limit 1)
     where q.venue_ref is not null and q.area_slug is null`);

  await syncFlagged();
  const after = (await query('select count(*)::int as n from content_queue')).rows[0].n;
  return { added: after - before, total: after };
}

/**
 * The data-quality flags: a fact three sources disagree about.
 *
 * Same act, same rhythm — somebody looks and decides — so it sits in the same
 * queue rather than in a screen of its own (BO7a).
 */
export async function syncFlagged() {
  await query(`
    insert into content_queue (kind, subject_type, subject_id, maker_label, venue_ref, made_at)
    select 'data', 'place', f.venue_ref || '#' || f.field, 'flagged by us', f.venue_ref, max(f.fetched_at)
      from place_facts f
     where f.field in ('opening_hours', 'website', 'phone', 'address')
       -- Only facts we still hold the right to.
       --
       -- A licensed fact is kept until it expires and is then swept away, and
       -- between the expiry and the sweep this counted it as evidence — so the
       -- queue could raise a disagreement out of a value we are no longer
       -- entitled to show anybody, and go on showing it (Codex, 18 Sep 2026).
       -- An expired fact is not a weaker fact; it is one we do not have.
       and (f.expires_at is null or f.expires_at > now())
     group by f.venue_ref, f.field
    having count(distinct f.value::text) > 2
    on conflict (subject_type, subject_id) do nothing`);

  // And a disagreement that has gone away goes away.
  //
  // A flag is a view of the facts, not a decision somebody made: once the
  // sources agree — because one was corrected, or a stale value expired — there
  // is nothing left to look at. Only adding rows meant the queue went on
  // offering a discrepancy that no longer existed, and there was no way to clear
  // it except to decide a thing that was not there (Codex, 18 Sep 2026).
  // A row somebody has already decided is left alone; that is their record.
  await query(`
    delete from content_queue q
     where q.kind = 'data' and q.state = 'waiting' and not q.reported
       and not exists (
         select 1 from place_facts f
          where f.venue_ref = split_part(q.subject_id, '#', 1)
            and f.field = split_part(q.subject_id, '#', 2)
            -- The same rule as the insert, or a flag raised while a fact was
            -- live would never be cleared once it expired.
            and (f.expires_at is null or f.expires_at > now())
          group by f.venue_ref, f.field
         having count(distinct f.value::text) > 2)`);

  // Something rejected that has since been written again comes back.
  //
  // A decision is about the words that were in front of whoever made it.
  //
  // Anything a household can rewrite after it has been decided goes back to
  // waiting: a host review, a question, an offer's own sentence. Three rounds on
  // this one (Codex, 18 Sep 2026) — the first left corrected words unlookable
  // for ever, the second published a rejected review the moment it was edited,
  // and the third only caught the rejected ones, so an *approved* row went on
  // saying approved about text nobody had read. A rejection's `hidden` is not
  // lifted by any of this; only approving lifts it.
  for (const [type, table, column] of [
    ['host_review', 'host_reviews', 'rewritten_at'], ['chat_topic', 'chat_topics', 'rewritten_at'],
    ['open_entry', 'open_entries', 'rewritten_at'], ['visit', 'visits', 'note_rewritten_at'],
  ]) {
    await query(`
      update content_queue q
         set state = 'waiting', reason = null, message = null, told = false,
             decided_by = null, decided_at = null
        from ${table} src
       where q.subject_type = $1 and q.subject_id = src.id::text
         and q.state <> 'waiting' and src.${column} is not null
         and (q.decided_at is null or src.${column} > q.decided_at)`, [type]);
    // The row's age follows the words it is asking about, so the queue sorts
    // by when the thing in front of somebody was actually written.
    //
    // It is *not* a guard against approving unread words — it cannot be, because
    // this runs on every queue load and would forgive an edit made a second ago
    // (Codex, 18 Sep 2026). That guard is the version the screen was shown,
    // handed back with the decision.
    await query(`
      update content_queue q
         set made_at = src.${column}
        from ${table} src
       where q.subject_type = $1 and q.subject_id = src.id::text
         and src.${column} is not null and src.${column} > q.made_at`, [type]);
  }
  // And a note that has been cleared is not a thing to decide at all: the row
  // would sit in the queue for ever asking about words nobody can read (Codex,
  // 18 Sep 2026).
  await query(`
    delete from content_queue q
     using visits v
     where q.subject_type = 'visit' and q.subject_id = v.id::text
       and coalesce(v.note, '') = '' and not q.reported`);

  // Nor is a row whose subject has gone altogether.
  //
  // Re-rating a visit deletes its ratings and writes new ones with new ids, and
  // deleting a visit takes its note and its ratings with it — leaving queue rows
  // pointing at nothing, with no words to read and a decision still to make
  // (Codex, 18 Sep 2026). A reported row stays: somebody asked about it, and
  // that is a record of its own.
  for (const [type, table] of [['visit', 'visits'], ['rating', 'ratings'], ['host_review', 'host_reviews']]) {
    await query(`
      delete from content_queue q
       where q.subject_type = $1 and not q.reported
         and not exists (select 1 from ${table} src where src.id::text = q.subject_id)`, [type]);
  }

  // Somebody reported it, so it jumps the queue.
  //
  // A household reporting a topic or a reply writes `chat_reports` and nothing
  // else, and the queue row was inserted with `reported = false` — after which
  // `on conflict do nothing` meant no later pass ever promoted it, so genuinely
  // reported content sat in the ordinary waiting lane for ever (Codex, 17 Sep
  // 2026). The report is the truth; the queue row is a view of it.
  await query(`
    update content_queue q
       set reported = true,
           report_reason = coalesce(q.report_reason, r.reason),
           -- And back in front of somebody.
           --
           -- A report against something already approved left the row saying
           -- approved, and the reported lane is the ones still waiting — so the
           -- report was never shown to anybody and the content stayed up
           -- (Codex, 18 Sep 2026). A rejected one is left alone: it has already
           -- been dealt with, more firmly than a report asks for.
           state = case when q.state = 'approved' then 'waiting' else q.state end,
           reason = case when q.state = 'approved' then null else q.reason end,
           decided_at = case when q.state = 'approved' then null else q.decided_at end,
           decided_by = case when q.state = 'approved' then null else q.decided_by end,
           -- A report nobody has answered yet, whatever was answered before it
           -- (migration 170).
           reported_at = greatest(coalesce(q.reported_at, r.at), r.at),
           report_cleared_at = null
      from (
        -- A reply's report carries its topic's id too, because the column is
        -- mandatory. Reading it as a report of the topic promoted an otherwise
        -- unreported conversation every time one reply in it was flagged
        -- (Codex, 17 Sep 2026).
        -- The newest complaint, and when it was made: a report that has been
        -- answered is answered, and matching the row alone reopened it on every
        -- sync for ever (Codex, 18 Sep 2026).
        select 'chat_topic' as kind, topic_id::text as id, min(reason) as reason, max(created_at) as at
          from chat_reports where topic_id is not null and reply_id is null group by topic_id
        union all
        select 'chat_reply', reply_id::text, min(reason), max(created_at)
          from chat_reports where reply_id is not null group by reply_id
      ) r
     where q.subject_type = r.kind and q.subject_id = r.id
       and (not q.reported or q.report_cleared_at is null or r.at > q.report_cleared_at)`);
}

/**
 * The counts the filter prints, per kind and per state.
 *
 * The kind counts follow the state that is being looked at. They were always
 * the waiting counts, so selecting Approved left every kind chip showing its
 * waiting number beside a list of approved rows — two filters disagreeing about
 * the same rows (17 Sep 2026, the verification audit). The state counts are
 * always all of them, because that is what those chips are for.
 */
export async function counts({ areaSlug = null, state: forState = 'waiting' } = {}) {
  const { rows } = await query(
    `select kind, state,
            (reported and (report_cleared_at is null or reported_at > report_cleared_at)) as reported,
            count(*)::int as n from content_queue
      where ($1::text is null or area_slug = $1) group by 1,2,3`, [areaSlug]);
  const kind = Object.fromEntries(KINDS.map((k) => [k.key, 0]));
  const state = Object.fromEntries(STATES.map((s) => [s, 0]));
  let reported = 0;
  const counting = STATES.includes(forState) ? forState : 'waiting';
  for (const r of rows) {
    if (counting === 'reported' ? (r.reported && r.state === 'waiting') : r.state === counting) kind[r.kind] = (kind[r.kind] ?? 0) + r.n;
    state[r.state] = (state[r.state] ?? 0) + r.n;
    // The headline figure is work to do, so it is the ones nobody has decided.
    if (r.reported && r.state === 'waiting') reported += r.n;
  }
  state.reported = reported;
  const { rows: [oldest] } = await query(
    `select min(made_at) as at from content_queue where state = 'waiting' and ($1::text is null or area_slug = $1)`, [areaSlug]);
  return { kind, state, reported, oldest: oldest?.at ?? null };
}

/** The queue itself. Reported first, because it is on a different clock. */
export async function list({ kind = null, state = 'waiting', areaSlug = null } = {}) {
  const { rows } = await query(
    `select q.*,
            -- The first words of the thing, so the row and the "next" block can
            -- show what is being decided rather than only that something is.
            -- BO5a prints the review; the list used to print a name and a date
            -- (17 Sep 2026, the verification audit).
            case q.subject_type
              when 'visit'       then (select left(v.note, 240)   from visits v        where v.id = q.subject_id::uuid)
              when 'rating'      then (select left(r.comment, 240) from ratings r      where r.id = q.subject_id::uuid)
              when 'host_review' then (select left(hr.text, 240)  from host_reviews hr where hr.id = q.subject_id::uuid)
              when 'chat_topic'  then (select left(coalesce(t.body, t.title), 240) from chat_topics t where t.id = q.subject_id::uuid)
              when 'chat_reply'  then (select left(rp.body, 240)  from chat_replies rp where rp.id = q.subject_id::uuid)
              when 'open_entry'  then (select left(e.transcript, 240) from open_entries e where e.id = q.subject_id::uuid)
              else null
            end as preview,
            -- Which fact three sources disagree about, so a flagged row says so
            -- rather than saying "Data".
            case when q.kind = 'data' then split_part(q.subject_id, '#', 2) else null end as field
       from content_queue q
      where ($1::text is null or q.kind = $1)
        -- Reported *and* still waiting. A report is a reason to look now, not a
        -- mark that never comes off: once somebody has decided, the row belongs
        -- in Approved or Rejected like any other, and leaving it here kept
        -- finished work in the urgent lane for ever — where approving it again
        -- changed nothing at all (Codex, 18 Sep 2026).
        and ($2::text = 'reported'
               and q.reported and q.state = 'waiting'
               -- Not one that has already been answered: a report is dealt with
               -- once, and a later edit sends the *words* back to be read
               -- without dragging the old complaint into the urgent lane with
               -- them (Codex, 18 Sep 2026).
               and (q.report_cleared_at is null or q.reported_at > q.report_cleared_at)
             or $2::text <> 'reported' and q.state = $2)
        and ($3::text is null or q.area_slug = $3)
      -- Reported first, because it is on a different clock; then what
      -- households sent us, oldest first; then the facts we flagged ourselves,
      -- which BO5a puts in their own section at the end. They were interleaved
      -- by age, so a run of flags sat in the middle of a queue of people's
      -- words (18 Sep 2026, the separate audit).
      -- Urgent means a complaint nobody has answered — the same pair the lane
      -- and the figure above it read. The flag alone put an edited-after-being-
      -- decided row ahead of everything, about a report that had already been
      -- dealt with (Codex, 18 Sep 2026).
      order by (q.reported and (q.report_cleared_at is null or q.reported_at > q.report_cleared_at)) desc,
               (q.kind = 'data'), q.made_at asc`, [kind, state, areaSlug]);
  return rows;
}

/**
 * Forty beach photographs are one decision, so they are one row.
 *
 * BO5a draws them that way — "Photo · Coral Beach, 12 of them" over "4
 * households · 3 days ago" — and it is the whole point of batch approval: the
 * list used to be forty rows of the same place, which is forty decisions to
 * skim past (17 Sep 2026, the verification audit).
 *
 * Only photographs group, and only by place. A person's review is never folded
 * into a count of reviews, because it is theirs and it is read on its own.
 */
export function group(rows = [], { limit = 120 } = {}) {
  const out = [];
  const batchesAt = new Map();
  for (const r of rows) {
    const batchable = KINDS.find((k) => k.key === r.kind)?.batch ?? false;
    // A photograph with no place is nobody's batch: it is one thing on its own.
    if (!batchable || !r.venue_ref || r.reported) { out.push(r); continue; }
    const key = `${r.kind}:${r.venue_ref}`;
    const at = batchesAt.get(key);
    if (at == null) {
      batchesAt.set(key, out.length);
      out.push({ ...r, batch: [r.id], makers: new Set([r.maker_label].filter(Boolean)) });
      continue;
    }
    const head = out[at];
    head.batch.push(r.id);
    if (r.maker_label) head.makers.add(r.maker_label);
    // The oldest is what the row's age means, and the list is oldest first.
    if (new Date(r.made_at) < new Date(head.made_at)) head.made_at = r.made_at;
  }
  // The limit is in *decisions*, applied after the grouping.
  //
  // Cutting the rows first meant a place with more than a hundred and twenty
  // waiting photographs showed a partial batch — approving it left the rest to
  // come back as another decision — and pushed every review and message off the
  // end (Codex, 17 Sep 2026). A batch is one decision however many photographs
  // are in it, so that is what the limit counts.
  return out.slice(0, limit).map((r) => (r.batch
    ? { ...r, batch: r.batch, of: r.batch.length, makers: [...r.makers] }
    : { ...r, batch: [r.id], of: 1, makers: [r.maker_label].filter(Boolean) }));
}

/** One item, with everything the reviewer needs to decide without leaving. */
/**
 * Which version of the words this row is about.
 *
 * A household can rewrite a review, a question, an entry or a note while it
 * sits in the queue, and approving lifts the decision onto whatever the text is
 * *then* — so a moderator who read one thing would publish another. The row's
 * own age cannot answer this: `sync()` runs on every queue load and moves it,
 * and two moderators reading at different moments need different answers. The
 * only thing that can is the version the screen was actually shown, handed back
 * when the decision is made (Codex, 18 Sep 2026, twice — the second time
 * because my first answer moved the row's clock and closed nothing).
 *
 * Null for a photograph: there is no rewriting one, only deciding about it.
 */
const VERSIONED = {
  host_review: ['host_reviews', 'rewritten_at'],
  chat_topic: ['chat_topics', 'rewritten_at'],
  open_entry: ['open_entries', 'rewritten_at'],
  visit: ['visits', 'note_rewritten_at'],
};

export async function versionOf(subjectType, subjectId, run = query) {
  const pair = VERSIONED[subjectType];
  if (!pair) return null;
  const [table, column] = pair;
  const { rows: [r] } = await run(
    `select ${column} as v from ${table} where id = $1::uuid`, [subjectId]).catch(() => ({ rows: [] }));
  return r?.v ? new Date(r.v).toISOString() : null;
}

export async function one(id) {
  const { rows: [q] } = await query('select * from content_queue where id = $1', [id]);
  if (!q) return null;
  const out = { ...q, detail: null, maker: null, picture: null };
  // What the screen is about to be shown, so the decision can name it.
  out.version = await versionOf(q.subject_type, q.subject_id);
  if (q.kind === 'photo') {
    const { rows: [img] } = await query(
      `select ia.id, ia.title, ia.caption, ia.licence, ia.credit_line, ia.width, ia.height, ia.bytes,
              ia.fetched_at, ia.moderation, ia.reward_points, ia.creator
         from image_assets ia where ia.id = $1::uuid`, [q.subject_id]);
    out.picture = img ?? null;
  }
  if (q.subject_type === 'visit') {
    const { rows: [v] } = await query('select note, venue_label, visited_on from visits where id = $1::uuid', [q.subject_id]);
    out.detail = v ? { text: v.note, place: v.venue_label, on: v.visited_on } : null;
  }
  if (q.subject_type === 'rating') {
    const { rows: [r] } = await query(
      'select comment, take, score, subject, concept_key from ratings where id = $1::uuid', [q.subject_id]);
    // Which dish, where it is a dish: "Note on a dish" without the dish is a
    // decision made on half the thing.
    out.detail = r ? { text: r.comment, take: r.take, score: r.score, subject: r.subject, dish: r.concept_key ?? null } : null;
  }
  if (q.subject_type === 'host_review') {
    const { rows: [r] } = await query('select text, stars, chips from host_reviews where id = $1::uuid', [q.subject_id]);
    out.detail = r ? { text: r.text, stars: r.stars, chips: r.chips } : null;
  }
  if (q.subject_type === 'chat_topic') {
    const { rows: [t] } = await query('select title, body from chat_topics where id = $1::uuid', [q.subject_id]);
    out.detail = t ? { text: t.body, title: t.title } : null;
  }
  if (q.subject_type === 'chat_reply') {
    const { rows: [r] } = await query(
      `select rp.body, t.title from chat_replies rp join chat_topics t on t.id = rp.topic_id
        where rp.id = $1::uuid`, [q.subject_id]);
    out.detail = r ? { text: r.body, title: r.title } : null;
  }
  if (q.subject_type === 'open_entry') {
    // What was actually submitted, so the decision is made on the offer rather
    // than on its existence (Codex, 17 Sep 2026).
    const { rows: [e] } = await query(
      `select kind, scope, interests, level, when_chips, where_label, languages, transcript, state
         from open_entries where id = $1::uuid`, [q.subject_id]);
    out.detail = e
      ? {
        // The transcript is the household's own words, which is the part a
        // moderator is actually deciding about.
        text: e.transcript, kind: e.kind, scope: e.scope, interests: e.interests,
        level: e.level, when: e.when_chips, where: e.where_label, languages: e.languages,
      }
      : null;
  }
  if (q.kind === 'data') {
    const [ref, field] = String(q.subject_id).split('#');
    const { rows } = await query('select source, value, fetched_at from place_facts where venue_ref = $1 and field = $2', [ref, field]);
    out.detail = { field, disagree: rows };
  }
  if (q.household_id) {
    const { rows: [h] } = await query(
      `select h.name,
              (select count(*)::int from content_queue c where c.household_id = h.id and c.state = 'approved') as kept,
              (select coalesce(sum(points), 0)::int from image_rewards r where r.household_id = h.id) as points
         from households h where h.id = $1`, [q.household_id]);
    out.maker = h ?? null;
  }
  return out;
}

/** Approve — one, or forty photographs together. */
export async function approve(ids, who, { seen = null } = {}) {
  // The decision and its effect commit together.
  //
  // Marking the queue row approved and then restoring the thing were two
  // writes, so a failure in between left the queue saying "approved" over
  // something still hidden — and nobody would look at it again, because it is
  // no longer waiting (Codex, 17 Sep 2026).
  const { rows, touched, stale } = await withTransaction(async (client) => {
    const run = (text, params) => client.query(text, params);
    const touched = new Set();

    // Words written after this row was raised have not been read by anybody.
    //
    // A household can edit a review, a question or a note while it is sitting
    // in the queue, and approving lifts `hidden` from whatever the text is
    // *now* — so a moderator who read one thing could publish another (Codex,
    // 18 Sep 2026). The rewrite requeues the row a minute later, by which time
    // it is public. These are left waiting instead, and the answer names them.
    // Against the version the screen was shown, not against the row's own clock.
    //
    // The row's clock is no guard at all: `sync()` runs on every queue load and
    // moves it, so an edit made while somebody was reading would be forgiven by
    // the very next list request (Codex, 18 Sep 2026, correcting my own first
    // answer). Where the caller says nothing about the version, nothing is held
    // back — a batch of photographs has no version to speak of.
    const stale = new Set();
    if (seen) {
      const { rows: subjects } = await run(
        'select id, subject_type, subject_id from content_queue where id = any($1::uuid[])', [ids]);
      for (const r of subjects) {
        const asked = seen[r.id];
        if (asked === undefined) continue;
        const now = await versionOf(r.subject_type, r.subject_id, run);
        if ((asked ?? null) !== now) stale.add(r.id);
      }
    }
    const decide = ids.filter((id) => !stale.has(id));

    const { rows } = decide.length ? await run(
      `update content_queue
          set state = 'approved', reason = null, decided_by = $2, decided_at = now(),
              -- The report has been answered. It is kept — who raised it, why
              -- and when — and it stops being urgent (migration 170).
              report_cleared_at = case when reported then now() else report_cleared_at end
        where id = any($1::uuid[]) and state <> 'approved' returning id, kind, subject_type, subject_id`,
      [decide, who ?? null]) : { rows: [] };
    // Approving is the undo of rejecting, so it has to reach as far: a thing
    // suppressed by mistake comes back, rather than staying invisible for ever
    // because the queue row now says "approved".
    for (const r of rows) {
      if (r.subject_type === 'image') {
        await decideImage(r.subject_id, 'approved', { who, run });
        // Noted, not rescored here: the score is worked out from what is
        // committed, and this is not yet (Codex, 17 Sep 2026).
        const { rows: [q] } = await run('select venue_ref from content_queue where id = $1', [r.id]);
        if (q?.venue_ref) touched.add(q.venue_ref);
        continue;
      }
      if (r.subject_type === 'open_entry') {
        // Live again — unless the household has already written the replacement
        // this rejection made room for, in which case bringing this one back
        // would break the unique index. Then it stays ended, which is the truth.
        await run(`
          update open_entries e set state = 'active', updated_at = now()
           where e.id = $1::uuid and e.hidden and e.state = 'ended'
             and not exists (
               select 1 from open_entries o
                where o.id <> e.id and o.state = 'active' and not o.hidden
                  and ((e.scope = 'standing' and o.scope = 'standing' and o.household_id = e.household_id)
                    or (e.trip_id is not null and o.trip_id = e.trip_id)))`, [r.subject_id]);
        await run(`update open_entries set hidden = false where id = $1::uuid`, [r.subject_id]);
        continue;
      }
      const table = { host_review: 'host_reviews', chat_topic: 'chat_topics', chat_reply: 'chat_replies' }[r.subject_type];
      if (table) await run(`update ${table} set hidden = false where id = $1::uuid`, [r.subject_id]);
      // And the copy the rejection withdrew. Approving from the Rejected lane is
      // undoing a decision, and undoing half of it left the queue saying
      // approved while the offer's FAQ stayed blank (Codex, 18 Sep 2026).
      //
      // Only moderation's own withdrawals. A host can take a question off their
      // own offer, and putting that back would be overruling them with no trace
      // (migration 175).
      if (r.subject_type === 'chat_topic' || r.subject_type === 'chat_reply') {
        const column = r.subject_type === 'chat_topic' ? 'source_topic_id' : 'source_reply_id';
        await run(
          `update chat_faq_entries set withdrawn_at = null, withdrawn_by = null
            where ${column} = $1::uuid and withdrawn_by = 'moderation'`, [r.subject_id]);
      }
    }
    return { rows, touched: [...touched], stale: [...stale] };
  });

  // After the commit, so the score is worked out from what is actually there.
  // A picture is one of the six facts the ready bar is judged on, and the
  // boards read `area_stats` — so a decision that changes a place's readiness
  // has to reach the totals too (Codex, 17 Sep 2026).
  for (const ref of touched) await rescorePlace(ref);
  if (touched.length) await refreshAreaStats();
  // The ones held back travel with the answer rather than silently not
  // happening: the screen has to be able to say "these were rewritten while you
  // were reading them, look again" (Codex, 18 Sep 2026).
  return stale.length ? Object.assign(rows, { stale }) : rows;
}

/**
 * Reject — never in a batch for anything a person wrote.
 *
 * The reason is from the closed list and the message is stored beside it, so
 * what was actually sent can be read back rather than reconstructed.
 */
export async function reject({ id, reason, message = null, tell = false, who, seen = undefined }) {
  const { rows: [q] } = await query(
    `select kind, state, reason, told, message, household_id, account_id, place_label,
            subject_type, subject_id
       from content_queue where id = $1`, [id]);
  if (!q) return null;
  const r = reasonFor(q.kind, reason);
  if (!r) return null;
  // The words this decision is about.
  //
  // A rejection is a decision about words as much as an approval is: turned
  // down after a rewrite it suppresses text nobody read, and tells the
  // household a reason chosen for something they no longer wrote (Codex, 18 Sep
  // 2026). Where the caller says nothing about the version, nothing is held
  // back — a photograph has no version to speak of.
  if (seen !== undefined) {
    const now = await versionOf(q.subject_type, q.subject_id);
    if ((seen ?? null) !== now) {
      const { rows: [row] } = await query('select * from content_queue where id = $1', [id]);
      return row ? { ...row, decided: false, stale: true, why: 'it was rewritten while you were reading it, so it is still waiting' } : null;
    }
  }
  // Already decided, and decided this way: nothing to do.
  //
  // A retried request — a double tap, a client that resends — rejected it
  // again, counted the reason again and e-mailed the household the same
  // rejection a second time (Codex, 18 Sep 2026). The decision is the same
  // decision; saying so is the whole answer.
  //
  // Unless the household was never told. Mail can be unavailable — no sender
  // key, the service down — and the decision stands either way, with `told`
  // false. Returning here on the retry meant the message could never be sent
  // once mail came back: the one thing that had failed was the one thing that
  // could not be tried again (Codex, 18 Sep 2026). The decision is still not
  // re-made; only the telling is.
  const onlyTheTelling = q.state === 'rejected' && q.reason === reason && tell && !q.told;
  if (q.state === 'rejected' && q.reason === reason && !onlyTheTelling) {
    const { rows: [already] } = await query('select * from content_queue where id = $1', [id]);
    // `decided` is false: nothing happened, and the audit must not say one did
    // (Codex, 18 Sep 2026).
    return already ? { ...already, decided: false, why: 'it was already rejected for that reason' } : null;
  }
  const body = tell ? (message ?? r.message) : null;
  // A retry of the telling alone does not count the reason again, does not
  // decide anything again, and does not touch the content: all of that is
  // already true. It goes straight to the message.
  if (onlyTheTelling) {
    const sent = await tellThem(id, q, body);
    const { rows: [row] } = await query('select * from content_queue where id = $1', [id]);
    // The decision is still the same decision, and the answer says so first —
    // what changed, if anything, is that the message has now gone.
    const why = ['it was already rejected for that reason',
      sent.told ? 'the message has now been sent' : sent.why].filter(Boolean).join('; ');
    // The decision was made before; this was the message alone.
    return { ...row, decided: false, told: sent.told, why };
  }

  /**
   * The decision, the suppression and the count, in one transaction.
   *
   * Three things have to be true together. The queue row says rejected; the
   * review or the conversation or the offer stops being anybody's; the reason
   * is counted so the common one can be designed out. Written separately, a
   * failure between them left the queue saying "rejected" over a review that
   * was still public — and nobody would ever look at it again, because it is no
   * longer waiting. Worst of all on reported content, which is the case that
   * lane exists for (Codex, 17 Sep 2026).
   *
   * The message is sent afterwards, outside this, because an e-mail cannot be
   * rolled back — so it is the last thing, and `told` is a second write once
   * something has actually gone out.
   */
  const out = await withTransaction(async (client) => {
    const run = (text, params) => client.query(text, params);
    const { rows: [row] } = await run(
      `update content_queue
          set state = 'rejected', reason = $2, message = $3, told = false, decided_by = $4, decided_at = now(),
              -- Answered, and kept (migration 170).
              report_cleared_at = case when reported then now() else report_cleared_at end
        where id = $1 and not (state = 'rejected' and reason = $2)
        returning *`,
      [id, reason, body, who ?? null]);
    // Marking the queue row and stopping there left an abusive review public
    // the moment its hold expired, because nothing that reads it knows the
    // queue exists. Each kind is suppressed where it lives, in the way that
    // table already understands.
    // Only the write that actually won counts.
    //
    // Two identical requests can both pass the check above; the guarded update
    // then gives one of them no row, and counting anyway inflated the reason
    // report — the one number the closed list exists to produce (Codex, 18 Sep
    // 2026).
    if (!row) return null;
    await suppress(row.subject_type, row.subject_id, { reason, who, run });
    await run(
      `insert into rejection_counts (kind, reason, used, last_at) values ($1,$2,1, now())
       on conflict (kind, reason) do update set used = rejection_counts.used + 1, last_at = now()`,
      [q.kind, reason]);
    return row;
  });
  if (!out) {
    // The other request won. The decision stands, and that is the answer.
    const { rows: [already] } = await query('select * from content_queue where id = $1', [id]);
    return already ? { ...already, why: 'it was already rejected for that reason' } : null;
  }

  // A picture is one of the six facts the ready bar is judged on, and only an
  // approved one counts — so a decision about a photograph changes the place's
  // score. Derived, so outside the transaction that made the decision.
  if (out.subject_type === 'image' && out.venue_ref) {
    await rescorePlace(out.venue_ref);
    await refreshAreaStats();
  }

  // "Reject and send this" has to send it.
  //
  // `told` is a claim about what a household received, so it is only ever set
  // once something actually went out. Where there is no address, or no sender
  // key — which is the owner's to add in Doppler — the rejection still stands
  // and the screen is told plainly that the message did not go.
  const sent = tell && body ? await tellThem(id, q, body) : { told: false, why: null };
  out.decided = true;
  out.told = sent.told;
  out.why = sent.why;
  return out;
}

/**
 * Tell the household, and say plainly when it did not go.
 *
 * `told` is a claim about what somebody received, so it is only ever set once
 * something actually went out. Where there is no address, or no sender key —
 * which is the owner's to add in Doppler — the rejection still stands and the
 * screen says the message did not go.
 *
 * Its own function because a rejection whose message failed can be asked again
 * for the message alone, once mail is back (Codex, 18 Sep 2026).
 */
async function tellThem(id, q, body) {
  let told = false;
  let why = null;
  const { rows: [to] } = await query(
    `select a.email from accounts a
      where (a.id = $1 or a.household_id = $2) and a.email is not null
      order by (a.id = $1) desc, a.created_at limit 1`,
    [q.account_id, q.household_id]);
  if (!mailConfigured()) why = 'no sender is configured, so nothing was sent';
  else if (!to?.email) why = 'this household has no e-mail address on it, so nothing was sent';
  else {
    try {
      await sendMail({
        to: to.email,
        // The word, not the key: "photograph", not "photo".
        subject: `Thanks for the ${KINDS.find((k) => k.key === q.kind)?.said ?? q.kind}${q.place_label ? ` of ${q.place_label}` : ''}`,
        text: body,
        purpose: 'content.rejected',
      });
      told = true;
    } catch (err) { why = `the message could not be sent: ${err.message}`; }
  }
  if (told) await query('update content_queue set told = true where id = $1', [id]);
  return { told, why };
}


/**
 * A photograph decided in the queue, points and all.
 *
 * The Library screen's own moderation endpoint awards the contributor their
 * points and reverses them when a decision is reversed. Moving ordinary
 * moderation into the queue quietly stopped that happening, so a household got
 * the thank-you e-mail and none of the points they were promised (Codex,
 * 17 Sep 2026). Same rules, same figures, one path.
 */
async function decideImage(imageId, moderation, { note = null, who = null, run = query } = {}) {
  const { rows: [before] } = await run(
    `select id, moderation, reward_points, contributor_account_id, contributor_household_id
       from image_assets where id = $1::uuid`, [imageId]);
  if (!before) return null;
  await run(
    `update image_assets set moderation = $2, moderation_note = coalesce($3, moderation_note),
            moderated_by = $4, moderated_at = now(), updated_at = now()
      where id = $1::uuid`, [imageId, moderation, note, who ?? null]);
  if (!before.contributor_account_id || moderation === before.moderation) return before;
  // The same ten points, and the same reversal, as the Library path.
  if (moderation === 'approved') {
    await run(
      `insert into image_rewards (account_id, household_id, image_id, points, reason, awarded_by)
       values ($1,$2,$3,$4,'accepted',$5)`,
      [before.contributor_account_id, before.contributor_household_id, imageId, before.reward_points || 10, who ?? null]);
  } else if (before.moderation === 'approved') {
    await run(
      `insert into image_rewards (account_id, household_id, image_id, points, reason, note, awarded_by)
       values ($1,$2,$3,$4,'reversed',$5,$6)`,
      [before.contributor_account_id, before.contributor_household_id, imageId,
        -(before.reward_points || 10), note, who ?? null]);
  }
  return before;
}

/**
 * The place's score again, because a picture is one of the facts it is judged on.
 *
 * Imported lazily: the index reads the queue's tables and the queue now reads
 * the index's, and a cycle at module load is a worse problem than a promise.
 */
async function rescorePlace(venueRef) {
  const index = await import('./placeIndex.js');
  await index.rescore({ refs: [venueRef] }).catch(() => null);
}

/**
 * And the totals, because the boards read them rather than the places.
 *
 * A photograph decided one way or the other can change whether a place is
 * ready, and every readiness figure on every board comes from `area_stats`. The
 * row was rescored and the totals were not, so a county went on reporting the
 * old number until somebody pressed Refresh (Codex, 17 Sep 2026).
 */
async function refreshAreaStats() {
  const index = await import('./placeIndex.js');
  await index.refreshStats().catch(() => null);
}

/**
 * Take one rejected thing out of circulation, wherever it lives.
 *
 * Nothing a household wrote is deleted — this is a moderation decision, not an
 * erasure, and the words stay where they are so the decision can be looked at
 * again. What changes is whether anybody else is shown them.
 */
async function suppress(subjectType, subjectId, { reason, who, run = query }) {
  if (subjectType === 'image') {
    await decideImage(subjectId, 'rejected', { note: reason, who, run });
    // The link is left alone on purpose. Every read that puts a picture in
    // front of anybody already joins `moderation = 'approved'`, so the flag is
    // what suppresses it — and deleting the links as well would make the
    // approval path a lie, because nothing restores which place it was of
    // (Codex, 17 Sep 2026).
    return;
  }
  // One flag, one meaning, three tables: `hidden` (migration 147). Not a state
  // flip and not a date pushed out of reach, because both of those lose what
  // the row used to say and cannot be undone honestly.
  const table = { host_review: 'host_reviews', chat_topic: 'chat_topics', chat_reply: 'chat_replies', open_entry: 'open_entries' }[subjectType];
  if (table) {
    // Not swallowed. A rejection that failed to reach the content but told the
    // screen it had is the exact shape of the bug this fixes.
    await run(`update ${table} set hidden = true where id = $1::uuid`, [subjectId]);
    // And the copies of it that were published elsewhere.
    //
    // A topic or a reply can be lifted into an offer's FAQ, and that table is
    // read on its own — the public list joins nothing back to the source and
    // asks only `withdrawn_at is null`. So hiding the source left the same
    // words in front of everybody who opens the offer, which is precisely what
    // a rejection is for (Codex, 18 Sep 2026). Withdrawn in the same
    // transaction, because half a rejection is worse than none.
    if (subjectType === 'chat_topic' || subjectType === 'chat_reply') {
      const column = subjectType === 'chat_topic' ? 'source_topic_id' : 'source_reply_id';
      await run(
        `update chat_faq_entries set withdrawn_at = now(), withdrawn_by = 'moderation'
          where ${column} = $1::uuid and withdrawn_at is null`, [subjectId]);
    }
    // An open entry is ended as well as hidden. There is a unique index over
    // *active* standing and per-trip entries, so a hidden-but-active row would
    // block the household from ever submitting a corrected one (Codex, 17 Sep
    // 2026). Ending it is what makes "write it again" possible.
    if (subjectType === 'open_entry') {
      await run(`update open_entries set state = 'ended', updated_at = now() where id = $1::uuid`, [subjectId]);
      // And the introductions it is already part of.
      //
      // Hiding the entry took it out of the pool and left the matches alone, so
      // a moderator could reject an abusive or over-personal offer while the
      // people already introduced to it went on seeing it, swapping videos and
      // talking (Codex, 17 Sep 2026). The match ends; nothing is deleted, so
      // the counterpart's own entry and words are untouched.
      await run(
        `update open_matches set stage = 'ended', updated_at = now()
          where (host_entry_id = $1::uuid or guest_entry_id = $1::uuid)
            and stage not in ('ended', 'lapsed')`, [subjectId]);
    }
    return;
  }
  // A visit's note, a rating's comment and a flagged fact are not published to
  // anybody outside the household that made them — every read of them is scoped
  // to that household. So for those a rejection is the queue row and the
  // message, and there is nothing to take down.
}

/** Reported content jumps the queue. */
export async function report({ id, reason, by }) {
  const { rows: [out] } = await query(
    `update content_queue
        set reported = true, reported_at = now(), reported_by = $2, report_reason = $3,
            -- Something already approved goes back in front of somebody, or the
            -- report is filed where nobody is looking (Codex, 18 Sep 2026).
            state = case when state = 'approved' then 'waiting' else state end,
            reason = case when state = 'approved' then null else reason end,
            decided_at = case when state = 'approved' then null else decided_at end,
            decided_by = case when state = 'approved' then null else decided_by end,
            -- A new report is a new thing to answer, whatever was answered
            -- before (migration 170).
            report_cleared_at = null
      where id = $1 returning *`, [id, by ?? null, reason ?? null]);
  return out ?? null;
}

/** Which reasons get used, so the common one can be designed out. */
export const reasonCounts = async () =>
  (await query('select kind, reason, used, last_at from rejection_counts order by used desc')).rows;
