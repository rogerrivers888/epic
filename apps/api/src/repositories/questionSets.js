/**
 * Question sets, their questions, and the words waiting to become one.
 *
 * Brief: "Epic — Question sets and the vocabulary harvest", 20 September 2026,
 * and its companion design brief. The screens arrive after this, so the shape
 * here is the brief's and not a screen's.
 *
 * Three things this module refuses to do, each because the brief says so and
 * each easy to do by accident:
 *
 *  1. **It does not keep a second word list.** A question names a row in
 *     `place_attributes` — our own secondary labels, the vocabulary the
 *     taxonomy already writes rules in. Promoting a candidate that matches an
 *     existing label reuses it; promoting one that does not creates the label
 *     first and then asks about it.
 *  2. **It does not let Google answer.** `saveAnswer` refuses any source that
 *     is not one Epic owns or may freely read, before the database's own check
 *     constraint gets a chance to, so the refusal is a sentence rather than a
 *     constraint violation.
 *  3. **It does not keep the scaffolding.** A candidate's example places exist
 *     so a human can see what a word came from; they are cleared the moment it
 *     is promoted or ignored.
 */

import { query, withTransaction } from '../db.js';
import {
  ageWord, discriminates, gateWord, mayAnswer, normalise, plainKindOf, OWNED_SOURCES,
} from '../domain/questions.js';
import * as attrs from './placeAttributes.js';

const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_request' });
const slug = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const on = (client) => (client ? (t, p) => client.query(t, p) : query);

// ---------------------------------------------------------------------------
// the sets
// ---------------------------------------------------------------------------

/**
 * Every set, with the two numbers that say whether it is worth maintaining:
 * which subcategories use it, and how many places those cover in total.
 *
 * Both are counted here rather than stored, because a stored count is a count
 * that goes wrong the first time somebody moves a subcategory.
 */
export async function sets({ includeInactive = true } = {}) {
  const { rows } = await query(
    `select s.key, s.name, s.active, s.created_at, s.updated_at,
            coalesce(sub.keys, '{}') as subcategories,
            coalesce(sub.places, 0)  as places,
            (select count(*) from questions q where q.set_key = s.key and q.active) as questions
       from question_sets s
       left join (
         select ss.set_key,
                array_agg(ss.subcategory_key order by ss.subcategory_key) as keys,
                sum((select count(*) from place_index p where p.subcategory = ss.subcategory_key)) as places
           from question_set_subcategories ss
          group by ss.set_key
       ) sub on sub.set_key = s.key
      ${includeInactive ? '' : 'where s.active'}
      order by s.name`,
  );
  return rows;
}

export async function saveSet({ key, name, active = true }) {
  const k = key ? slug(key) : slug(name);
  if (!k) throw bad('A question set needs a name.');
  const { rows } = await query(
    `insert into question_sets (key, name, active) values ($1, $2, $3)
     on conflict (key) do update set name = coalesce(excluded.name, question_sets.name),
                                     active = excluded.active, updated_at = now()
     returning *`,
    [k, name ?? k, active],
  );
  return rows[0];
}

/**
 * Attach a subcategory to a set.
 *
 * One set per subcategory (brief §8, and the reversible half of that open
 * question): the primary key is the subcategory, so attaching it somewhere
 * else moves it rather than adding a second.
 */
export async function attach(setKey, subcategoryKey) {
  // A new subcategory brings vocabulary nobody has harvested, so the set is no
  // longer settled whatever it said a moment ago (brief §5.4).
  await query(
    `update question_sets set vocabulary_settled = false, settled_at = null, settled_on = '{}'::jsonb, updated_at = now()
      where key = $1 and vocabulary_settled`, [setKey],
  );
  const { rows } = await query(
    `insert into question_set_subcategories (subcategory_key, set_key) values ($1, $2)
     on conflict (subcategory_key) do update set set_key = excluded.set_key, attached_at = now()
     returning *`,
    [subcategoryKey, setKey],
  );
  return rows[0];
}

export async function detach(subcategoryKey) {
  await query('delete from question_set_subcategories where subcategory_key = $1', [subcategoryKey]);
}

/** Which set a subcategory uses, or null — a state the design brief asks to be shown. */
export async function setForSubcategory(subcategoryKey) {
  const { rows } = await query(
    `select s.* from question_set_subcategories ss join question_sets s on s.key = ss.set_key
      where ss.subcategory_key = $1`, [subcategoryKey],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// the questions
// ---------------------------------------------------------------------------

/**
 * The full interrogation a place in this set receives: the global questions,
 * which no set owns and none may edit, and the set's own.
 *
 * `yesShare` is the design brief's important column — "what share of places in
 * the set answer yes" — and it is read from the answers rather than kept,
 * because it changes every time a place is enriched.
 */
export async function questionsFor(setKey = null) {
  const { rows } = await query(
    `select q.*, a.label, a.kind, a.blurb, a.options, a.unit,
            (select count(*) from place_answers pa where pa.question_id = q.id and pa.state = 'answered') as answered,
            (select count(*) from place_answers pa where pa.question_id = q.id and pa.state = 'answered' and pa.yesno) as said_yes,
            (select count(*) from place_answers pa where pa.question_id = q.id and pa.state = 'asked_nothing_found') as nothing_found
       from questions q
       join place_attributes a on a.key = q.attribute_key
      where q.scope = 'global' or q.set_key = $1
      order by q.scope desc, q.position, a.label`,
    [setKey],
  );
  return rows.map((r) => ({
    ...r,
    yesShare: Number(r.answered) > 0 ? Number(r.said_yes) / Number(r.answered) : null,
  }));
}

/**
 * Ask something of a set.
 *
 * The answer shape is not a parameter: it is the label's own `kind`. A caller
 * naming a label that does not exist is a caller inventing a second
 * vocabulary, which is the thing this module exists to prevent.
 */
export async function addQuestion({ attributeKey, setKey = null, scope = 'set', gate = false, refreshDays = null, position = 100, fromCandidate = null }, client) {
  const run = on(client);
  if (scope === 'set' && !setKey) throw bad('A question has to belong to a set, or be asked everywhere.');
  const { rows: known } = await run('select key from place_attributes where key = $1', [attributeKey]);
  if (!known.length) throw bad(`${attributeKey} is not one of our labels. Name the label first, then ask about it.`);
  const { rows } = await run(
    `insert into questions (attribute_key, scope, set_key, gate, refresh_days, position, from_candidate)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict do nothing
     returning *`,
    [attributeKey, scope, scope === 'global' ? null : setKey, gate, refreshDays, position, fromCandidate],
  );
  if (rows[0]) return rows[0];
  // Already asked. Say which one, rather than a silent no-op.
  const { rows: existing } = await run(
    `select * from questions where attribute_key = $1 and scope = $2 and set_key is not distinct from $3`,
    [attributeKey, scope, scope === 'global' ? null : setKey],
  );
  return existing[0] ?? null;
}

/**
 * Change a question.
 *
 * `refreshDays` says three different things and they are all wanted: absent
 * leaves it alone, `null` clears it (this answer never goes stale), a number
 * sets it. `touches` is which of those was asked for, so "clear it" cannot be
 * read as "say nothing about it".
 */
export async function updateQuestion(id, changes = {}) {
  const { gate, refreshDays, position, active } = changes;
  const clears = Object.hasOwn(changes, 'refreshDays') && refreshDays == null;
  const { rows } = await query(
    `update questions
        set gate = coalesce($2, gate),
            refresh_days = case when $3 then null else coalesce($4, refresh_days) end,
            position = coalesce($5, position),
            active = coalesce($6, active),
            updated_at = now()
      where id = $1 returning *`,
    [id, gate ?? null, clears, refreshDays ?? null, position ?? null, active ?? null],
  );
  return rows[0] ?? null;
}

/**
 * Stop asking something.
 *
 * A global question is never removed here — the design brief shows them greyed
 * and not editable on a set's screen, and a set's administrator switching off
 * "step free" for everybody would be a surprise nobody asked for.
 */
export async function removeQuestion(id) {
  const { rows } = await query(
    "update questions set active = false, updated_at = now() where id = $1 and scope = 'set' returning *", [id],
  );
  if (!rows[0]) throw bad('That question is asked everywhere. It can only be changed where the global questions are.');
  return rows[0];
}

// ---------------------------------------------------------------------------
// the candidates
// ---------------------------------------------------------------------------

/**
 * What a harvest noticed, written down.
 *
 * Three rules from the brief live in this one function:
 *
 *  · **Ignored is permanent.** A norm this subcategory has already rejected is
 *    skipped, so the same wording never raises a second candidate.
 *  · **Nothing is filtered by frequency.** Everything that came back is
 *    written with its count beside it; sorting is the screen's problem.
 *  · **The raw forms are kept.** The key is normalised so the spellings
 *    collapse, and an administrator still sees the words as people wrote them.
 */
export async function recordCandidates(subcategory, entries = [], { placesTotal = 0, client = null } = {}) {
  if (!entries.length) return { written: 0, skipped: 0, held: 0 };
  const run = on(client);
  const { rows: ignored } = await run(
    "select norm from harvest_candidates where subcategory = $1 and status = 'ignored'", [subcategory],
  );
  const closed = new Set(ignored.map((r) => r.norm));
  const rows = [];
  let skipped = 0;
  let held = 0;
  for (const entry of entries) {
    const norm = normalise(entry.norm ?? entry.raw);
    if (!norm) continue;
    if (closed.has(norm)) { skipped += 1; continue; }
    const sources = entry.sources instanceof Set ? [...entry.sources] : (entry.sources ?? []);
    // The free half of the kind test (brief §5.1). A word code can call is
    // called here; everything else starts in the holding pen and the
    // classifier moves it out — never a guess, and never a human's time spent
    // on "rude staff".
    const plain = plainKindOf(norm);
    const kind = plain ?? 'unclear';
    if (kind === 'unclear') held += 1;
    rows.push([
      norm,
      entry.rawForms ?? [entry.raw ?? norm],
      subcategory,
      entry.placesSeen ?? 1,
      placesTotal,
      JSON.stringify(Object.fromEntries(sources.map((s) => [s, entry.placesSeen ?? 1]))),
      (entry.examples ?? []).slice(0, 5),
      kind,
      // `unresolved` is the holding pen: not pending, not ignored, not waiting
      // on a human. A condition or an opinion is resolved — it is simply not a
      // question — and sits as `unresolved` too rather than cluttering the
      // promotable list, with its kind saying which it is.
      kind === 'feature' ? 'new' : 'unresolved',
      entry.asserts ?? 0,
      entry.denies ?? 0,
      entry.asks ?? 0,
    ]);
  }
  // In batches, because a subcategory raises hundreds of words and a sweep of
  // fifty-two of them would otherwise be twenty-odd thousand round trips — long
  // enough for the request that started it to give up on itself.
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const params = [];
    const values = batch.map((r) => {
      params.push(...r);
      const n = params.length;
      return `($${n - 11}, $${n - 10}, $${n - 9}, $${n - 8}, $${n - 7}, $${n - 6}::jsonb, $${n - 5}, $${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n})`;
    });
    await run(
      `insert into harvest_candidates
         (norm, raw_forms, subcategory, places_seen, places_total, sources, examples, kind, status, asserts, denies, asks)
       values ${values.join(', ')}
       on conflict (subcategory, norm) do update set
         raw_forms    = (select array_agg(distinct f) from unnest(harvest_candidates.raw_forms || excluded.raw_forms) f),
         places_seen  = greatest(harvest_candidates.places_seen, excluded.places_seen),
         places_total = greatest(harvest_candidates.places_total, excluded.places_total),
         sources      = harvest_candidates.sources || excluded.sources,
         examples     = (select array_agg(distinct e) from unnest((harvest_candidates.examples || excluded.examples)[1:5]) e),
         asserts      = greatest(harvest_candidates.asserts, excluded.asserts),
         denies       = greatest(harvest_candidates.denies, excluded.denies),
         asks         = greatest(harvest_candidates.asks, excluded.asks),
         -- A kind already decided stands: the classifier's verdict, or a
         -- person's, is not overwritten by the code's first pass on a later
         -- run. Only the holding pen is open to being called.
         kind         = case when harvest_candidates.kind = 'unclear' then excluded.kind else harvest_candidates.kind end,
         status       = case when harvest_candidates.kind = 'unclear' and excluded.kind = 'feature' then 'new'
                             else harvest_candidates.status end,
         last_seen    = now()
       where harvest_candidates.status in ('new', 'unresolved')`,
      params,
    );
  }
  return { written: rows.length, skipped, held };
}

/**
 * The candidate list.
 *
 * `share` is the number the design brief wants the eye to land on — "something
 * at 4% should look like a find; something at 96% should look like noise" —
 * and `known` says whether the word is already one of our labels, so promoting
 * it reuses the label rather than making a second one.
 */
export async function candidates({ subcategory = null, subcategories = null, status = 'new', kind = null, limit = 500 } = {}) {
  // A set's screen asks for *its* subcategories, not for the first four hundred
  // words in the estate filtered afterwards — which returned an empty list for
  // a set whose words happened to sort below the limit.
  const { rows } = await query(
    `select c.*, a.key as known_key, a.label as known_label, a.kind as known_kind
       from harvest_candidates c
       left join attribute_aliases al on al.norm = c.norm
       left join place_attributes a on a.key = al.target_key
      where ($1::text is null or c.subcategory = $1)
        and ($2::text[] is null or c.subcategory = any($2))
        and ($3::text is null or c.status = $3)
        and ($4::text is null or c.kind = $4)
      order by c.places_seen::float / greatest(c.places_total, 1) asc, c.places_seen desc
      limit $5`,
    [subcategory, subcategories?.length ? subcategories : null, status, kind, limit],
  );
  return rows.map((r) => {
    // **Seen on**, which is how much of the harvest text mentioned it — not
    // the same number as "say yes", which is what places answered, and the
    // design comments are explicit that showing them identically teaches the
    // wrong thing.
    const seenOn = r.places_total ? r.places_seen / r.places_total : null;
    const mentions = r.asserts + r.denies + r.asks;
    return {
      ...r,
      seenOn,
      // Kept under the old name too, so nothing reading `share` breaks while
      // the screens are drawn.
      share: seenOn,
      gateWord: gateWord(r.norm),
      ageSignal: ageWord(r.norm),
      discriminates: discriminates(seenOn, { gate: gateWord(r.norm), ageSignal: ageWord(r.norm) }),
      // "Seen on 4%, but half of those say it hasn't got one" is a materially
      // different candidate from one asserted every time.
      polarity: mentions
        ? { asserts: r.asserts, denies: r.denies, asks: r.asks, mostlyAgainst: (r.denies + r.asks) > r.asserts }
        : null,
      known: r.known_key ? { key: r.known_key, label: r.known_label, kind: r.known_kind } : null,
    };
  });
}

/**
 * The verdict on what kind of word this is.
 *
 * Moves a word out of the holding pen, or confirms it belongs there. A feature
 * becomes promotable; a condition or an opinion stays `unresolved` with its
 * kind saying why, because "not a question" is a resolved state even though it
 * is not a decision anybody has to take.
 *
 * `by` is who said so — `plain` for the code's own pass, a model name, or a
 * person — so a verdict can be re-run when the classifier improves without
 * overwriting one somebody took by hand.
 */
export async function setKind(id, { kind, by = null } = {}) {
  const { rows } = await query(
    `update harvest_candidates
        set kind = $2, status = case when $2 = 'feature' then 'new' else 'unresolved' end,
            classified_at = now(), classified_by = $3
      where id = $1 and status in ('new', 'unresolved') returning *`,
    [id, kind, by],
  );
  return rows[0] ?? null;
}

/** The holding pen, oldest first: what a classifier has yet to call. */
export async function unclassified({ subcategory = null, limit = 200 } = {}) {
  const { rows } = await query(
    `select id, norm, raw_forms, subcategory, places_seen, places_total
       from harvest_candidates
      where kind = 'unclear' and status = 'unresolved'
        and ($1::text is null or subcategory = $1)
      order by places_seen desc, id
      limit $2`,
    [subcategory, limit],
  );
  return rows;
}

/**
 * Promote a candidate into a question.
 *
 * One transaction, because it is four writes — the label if it is new, its
 * alias, the question, and the candidate's decision — and a failure part-way
 * through would leave a word that is neither promoted nor available to promote
 * again.
 *
 * The examples go here. They were scaffolding for the review and the brief is
 * explicit that the association has no reason to outlive the decision.
 */
export async function promote(id, { gate = false, kind = 'yesno', label = null, attributeKey = null, refreshDays = null, actor = null } = {}) {
  return withTransaction(async (client) => {
    const { rows } = await client.query("select * from harvest_candidates where id = $1 and status = 'new' for update", [id]);
    const candidate = rows[0];
    if (!candidate) throw bad('That word has already been decided.');
    const set = await client.query(
      'select set_key from question_set_subcategories where subcategory_key = $1', [candidate.subcategory],
    );
    const setKey = set.rows[0]?.set_key ?? null;
    if (!setKey) throw bad(`${candidate.subcategory} does not use a question set yet. Attach it to one, then promote the word.`);

    // Reuse a label we already have before making one. The alias table is the
    // resolver, so "step free access" finds `step-free` rather than making
    // `step-free-access` beside it.
    const alias = await client.query('select target_key from attribute_aliases where norm = $1', [candidate.norm]);
    let key = attributeKey ?? alias.rows[0]?.target_key ?? null;
    if (!key) {
      const text = label ?? candidate.raw_forms?.[0] ?? candidate.norm;
      key = slug(text);
      try {
        await client.query(
          `insert into place_attributes (key, label, kind, position) values ($1, $2, $3, 200)
           on conflict (key) do nothing`, [key, sentence(text), kind],
        );
      } catch (err) {
        // Our labels are one vocabulary (migration 110): a secondary label may
        // not take a subcategory's name. The trigger says so in a sentence;
        // pass it on rather than letting it reach the screen as a 500.
        throw bad(`${key} is already one of our labels. Promote it onto the label we have, or give it another name.`);
      }
      await client.query(
        `insert into attribute_aliases (norm, target_key, raw) values ($1, $2, $3)
         on conflict (norm) do nothing`, [candidate.norm, key, candidate.raw_forms?.[0] ?? null],
      );
    }
    const question = await addQuestion(
      { attributeKey: key, setKey, scope: 'set', gate, refreshDays, fromCandidate: id }, client,
    );
    await client.query(
      `update harvest_candidates
          set status = 'promoted', question_id = $2, decided_by = $3, decided_at = now(), examples = '{}'
        where id = $1`, [id, question?.id ?? null, actor],
    );
    attrs.forget();
    return { candidate: candidate.norm, question, attributeKey: key, setKey };
  });
}

/** Never ask about this word here again. The examples go with the decision. */
export async function ignoreCandidate(id, { actor = null } = {}) {
  const { rows } = await query(
    `update harvest_candidates set status = 'ignored', decided_by = $2, decided_at = now(), examples = '{}'
      where id = $1 and status = 'new' returning *`, [id, actor],
  );
  if (!rows[0]) throw bad('That word has already been decided.');
  return rows[0];
}

/** Put an ignored word back in the queue — the way back the design brief asks for. */
export async function unignore(id) {
  const { rows } = await query(
    `update harvest_candidates set status = 'new', decided_by = null, decided_at = null
      where id = $1 and status = 'ignored' returning *`, [id],
  );
  return rows[0] ?? null;
}

const sentence = (s) => {
  const t = String(s ?? '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
};

// ---------------------------------------------------------------------------
// the answers
// ---------------------------------------------------------------------------

/**
 * Write one answer about one place.
 *
 * The refusal above the write is the provenance rule: **Google may raise a
 * candidate word; Google may never answer a question about a place.** A caller
 * handing over `google` is not a caller to be quietly ignored — it is a bug
 * worth a sentence, because the whole value of the stored fact is that it is
 * genuinely ours.
 *
 * Two owned sources that disagree are both kept and both marked unresolved,
 * per the brief: "Do not pick silently."
 */
export async function saveAnswer({ venueRef, questionId, source, state = 'answered', value = null, sourceUrl = null, confidence = null }) {
  if (!mayAnswer(source)) {
    throw bad(`${source} may raise a word for the harvest, but it may not answer a question about a place. Answers come from ${OWNED_SOURCES.join(', ')}.`);
  }
  const v = value ?? {};
  const { rows } = await query(
    `insert into place_answers (venue_ref, question_id, source, state, yesno, from_value, to_value, choice, number, source_url, confidence, checked_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
     on conflict (venue_ref, question_id, source) do update set
       state = excluded.state, yesno = excluded.yesno, from_value = excluded.from_value,
       to_value = excluded.to_value, choice = excluded.choice, number = excluded.number,
       source_url = excluded.source_url, confidence = excluded.confidence, checked_at = now()
     returning *`,
    [venueRef, questionId, source, state, v.yesno ?? null, v.from ?? null, v.to ?? null, v.choice ?? null, v.number ?? null, sourceUrl, confidence],
  );
  await markDisagreement(venueRef, questionId);
  return rows[0];
}

/**
 * Mark the pair, not the winner.
 *
 * Two owned sources answering differently is a fact about the place — the
 * venue's page says step free and the open map says otherwise — and the screen
 * shows both. This sets the flag on every row of a question that has more than
 * one distinct answer, and clears it again when they agree.
 */
export async function markDisagreement(venueRef, questionId) {
  await query(
    `with answers as (
        select count(distinct (yesno, from_value, to_value, choice, number)) as shapes
          from place_answers where venue_ref = $1 and question_id = $2 and state = 'answered'
     )
     update place_answers p set unresolved = (select shapes > 1 from answers)
      where p.venue_ref = $1 and p.question_id = $2`,
    [venueRef, questionId],
  );
}

/** Every answer a place has, with the question and the label beside it. */
export async function answersFor(venueRef) {
  const { rows } = await query(
    `select p.*, q.gate, q.scope, q.refresh_days, a.key as attribute_key, a.label, a.kind
       from place_answers p
       join questions q on q.id = p.question_id
       join place_attributes a on a.key = q.attribute_key
      where p.venue_ref = $1
      order by q.scope desc, q.position, a.label, p.source`,
    [venueRef],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// the runs
// ---------------------------------------------------------------------------

export async function startRun({ kind, subcategories = [], params = {} }) {
  const { rows } = await query(
    `insert into vocabulary_runs (kind, subcategories, params) values ($1, $2, $3::jsonb) returning *`,
    [kind, subcategories, JSON.stringify(params)],
  );
  return rows[0];
}

export async function finishRun(id, { status = 'done', places = 0, calls = 0, candidates: found = 0, costUsd = 0, saturation = {}, note = null } = {}) {
  const { rows } = await query(
    `update vocabulary_runs set status = $2, places = $3, calls = $4, candidates = $5, cost_usd = $6,
            saturation = $7::jsonb, note = $8, finished_at = now()
      where id = $1 returning *`,
    [id, status, places, calls, found, costUsd, JSON.stringify(saturation), note],
  );
  return rows[0] ?? null;
}

export async function runs({ limit = 20 } = {}) {
  const { rows } = await query('select * from vocabulary_runs order by started_at desc limit $1', [limit]);
  return rows;
}

// ---------------------------------------------------------------------------
// the resolver's aliases
// ---------------------------------------------------------------------------

/**
 * Every one of our labels resolves to itself.
 *
 * The same boot-time seeding as `host_skill_aliases`, and for the same reason:
 * one normaliser, in JavaScript, exercised by every path. `do nothing` rather
 * than `do update`, because a promotion may have pointed a wording somewhere
 * on purpose and boot must not undo a decision somebody took.
 */
export async function ensureAttributeAliases() {
  const { rows } = await query('select key, label from place_attributes');
  const values = [];
  const params = [];
  for (const r of rows) {
    for (const form of [r.label, r.key.replace(/-/g, ' ')]) {
      const norm = normalise(form);
      if (!norm) continue;
      params.push(norm, r.key, form);
      values.push(`($${params.length - 2}, $${params.length - 1}, $${params.length})`);
    }
  }
  if (!values.length) return 0;
  await query(
    `insert into attribute_aliases (norm, target_key, raw) values ${values.join(', ')}
     on conflict (norm) do nothing`, params,
  );
  return values.length;
}

/** Which of our labels a wording means, or null. */
export async function resolveAttribute(raw) {
  const norm = normalise(raw);
  if (!norm) return null;
  const { rows } = await query(
    `select a.* from attribute_aliases al join place_attributes a on a.key = al.target_key
      where al.norm = $1`, [norm],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// when a set stops costing money
// ---------------------------------------------------------------------------

/**
 * Settle a set's vocabulary, which is what takes Google out of the category.
 *
 * Brief §5.4: "When water parks have a saturated question set, Epic already
 * knows what to ask of every water park it ever sees. It does not need
 * Google's reviews to tell it again." So this is a switch the Google pass
 * reads, not a badge — and `settled_on` records what it was settled on,
 * because a set settled on nineteen places in one county is a weaker claim
 * than one settled on a hundred across five regions, and the difference has to
 * survive the decision.
 */
export async function settleSet(setKey, { on = {}, settled = true } = {}) {
  const { rows } = await query(
    `update question_sets
        set vocabulary_settled = $2,
            settled_at = case when $2 then now() else null end,
            settled_on = case when $2 then $3::jsonb else '{}'::jsonb end,
            updated_at = now()
      where key = $1 returning *`,
    [setKey, settled, JSON.stringify(on)],
  );
  return rows[0] ?? null;
}

/** Which subcategories still read reviews, and which have stopped. */
export async function settledSubcategories() {
  const { rows } = await query(
    `select ss.subcategory_key, s.key as set_key, s.vocabulary_settled
       from question_set_subcategories ss join question_sets s on s.key = ss.set_key`,
  );
  return new Map(rows.map((r) => [r.subcategory_key, r]));
}

/**
 * A subcategory joining a set unsettles it.
 *
 * Lidos attached to the water-parks set bring a vocabulary nobody has
 * harvested, and a set that says "settled" while holding an unharvested
 * subcategory would quietly stop Epic ever learning the word *lido*.
 */
export async function unsettleForSubcategory(subcategoryKey) {
  await query(
    `update question_sets set vocabulary_settled = false, settled_at = null, settled_on = '{}'::jsonb, updated_at = now()
      where key = (select set_key from question_set_subcategories where subcategory_key = $1)
        and vocabulary_settled`,
    [subcategoryKey],
  );
}
