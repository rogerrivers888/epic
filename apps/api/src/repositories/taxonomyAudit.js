/**
 * Gathering the evidence the audit reasons over, and keeping its runs.
 *
 * Every number here comes from something Epic already holds — the index, the
 * search log, the owned records and the rules themselves. Nothing in a run
 * calls a provider, so the audit can be run as often as anybody likes.
 */

import { query, withTransaction } from '../db.js';
import { auditAll } from '../domain/taxonomyAudit.js';
import { agreed } from '../domain/taxonomyCleanup.js';

/** What the signals need, read in one pass. */
export async function evidence() {
  const [subs, rules, places, words, shown, opened, owned, types, pairs] = await Promise.all([
    query('select key, label, category_key, active from shelf_subcategories'),
    query('select id, scope, subject, subject_label, subcategory, labels from shelf_rules'),
    query('select subcategory, count(*) n from place_index where subcategory is not null group by 1'),
    query(`select l.namespace, l.key, l.label, l.decision, l.points_at, l.active,
                  s.label as sub_label
             from taxonomy_labels l
             left join shelf_subcategories s on s.key = l.points_at
            where l.namespace = 'google'`),
    // Shown and opened, per place. `shown` is the denominator and the two are
    // never added together: a place shown forty times and opened once is a
    // different fact from one shown once.
    query(`select venue_ref, count(*) n from search_events where kind = 'shown' and venue_ref is not null group by 1`),
    query(`select venue_ref, count(*) n from search_events where kind in ('open','save','add_to_trip') and venue_ref is not null group by 1`),
    // What we have actually researched, and whether it amounts to somewhere you
    // could go. Nothing rented is read here.
    // Only records research has actually finished with. A row is created when a
    // place is claimed and sits empty until the enrichment runs, so counting a
    // pending one as "nothing says it is visitable" would let ten unresearched
    // places condemn the word that found them (Codex, 20 Sep 2026).
    query(`select venue_ref,
                  (website is not null or opening_hours is not null or booking_url is not null) as visitable
             from place_records
            where enrich_state in ('done', 'partial') and enriched_at is not null`),
    query(`select venue_ref, google_types from place_index
            where google_types is not null and cardinality(google_types) > 0`),
    // Every word that has ever surfaced a place, not the last one to do so.
    // `place_index.found_by` is overwritten by each census run, so a place
    // found by four words counted for one of them and the other three came out
    // thin enough to skip (Codex, 20 Sep 2026). `place_subcategories` is the
    // history and is what the thresholds have to be read from.
    query(`select venue_ref, found_by from place_subcategories where found_by is not null
            union
           select venue_ref, found_by from place_index where found_by is not null`),
  ]);

  const byWord = new Map();
  for (const r of pairs.rows) {
    const had = byWord.get(r.found_by) ?? new Set();
    had.add(r.venue_ref);
    byWord.set(r.found_by, had);
  }
  for (const [k, v] of byWord) byWord.set(k, [...v]);
  // Two words are together when the same place carries both.
  const onPlace = new Map();
  for (const r of types.rows) {
    for (const t of r.google_types) onPlace.set(r.venue_ref, [...(onPlace.get(r.venue_ref) ?? []), t]);
  }
  const together = new Map();
  for (const list of onPlace.values()) {
    for (const a of list) for (const b of list) {
      if (a === b) continue;
      together.set(a, new Set([...(together.get(a) ?? []), b]));
    }
  }

  const rulesBySub = new Map();
  for (const r of rules.rows) {
    if (!r.subcategory) continue;
    rulesBySub.set(r.subcategory, [...(rulesBySub.get(r.subcategory) ?? []), r]);
  }

  return {
    subs: subs.rows,
    rulesBySub,
    placesBySub: new Map(places.rows.map((r) => [r.subcategory, Number(r.n)])),
    words: words.rows
      .filter((w) => w.active && !w.decision)
      .map((w) => ({ key: w.key, label: w.label, subcategoryLabel: w.sub_label })),
    unmapped: words.rows.filter((w) => w.active && !w.decision && !w.points_at),
    placesByWord: byWord,
    shownByRef: new Map(shown.rows.map((r) => [r.venue_ref, Number(r.n)])),
    openedByRef: new Map(opened.rows.map((r) => [r.venue_ref, Number(r.n)])),
    ownedByRef: new Map(owned.rows.map((r) => [r.venue_ref, r.visitable])),
    // The first type Google lists is the one it thinks the place mostly is.
    primaryByRef: new Map(types.rows.map((r) => [r.venue_ref, r.google_types[0]])),
    together: new Map([...together].map(([k, v]) => [k, [...v]])),
    // A rule's words, for the junk-drawer detector.
    wordsOfRule: (r) => (r.labels ?? []).map((l) => String(l).split(':').pop()),
    // Which subcategories share words with which, for fold targets.
    near: nearest(rulesBySub, subs.rows, together),
  };
}

/** For each subcategory, the others whose words sit on the same places as its own. */
function nearest(rulesBySub, subs, together) {
  const wordsOf = (key) => new Set((rulesBySub.get(key) ?? [])
    .flatMap((r) => (r.labels ?? []).map((l) => String(l).split(':').pop())));
  const out = new Map();
  for (const s of subs) {
    const mine = wordsOf(s.key);
    if (!mine.size) continue;
    const scored = [];
    for (const other of subs) {
      if (other.key === s.key || !other.active) continue;
      const theirs = wordsOf(other.key);
      let shared = 0;
      for (const w of mine) for (const t of theirs) {
        if (w === t || (together.get(w)?.has(t))) shared += 1;
      }
      if (shared) scored.push({ key: other.key, label: other.label, shared });
    }
    out.set(s.key, scored.sort((a, b) => b.shared - a.shared));
  }
  return out;
}

/** Run every signal and keep what it found. Returns the run. */
export async function run({ by = null, extra = [], withAgreed = false } = {}) {
  const input = await evidence();
  // Section 4 of the brief, signed off already, proposed through the same flow
  // so the first use of accept-and-apply is on changes somebody trusts.
  const first = withAgreed
    ? agreed({
      have: new Set(input.subs.map((s) => s.key)),
      words: new Set(input.words.map((w) => w.key)),
    })
    : [];
  const { proposals, evidence: saw } = auditAll(input);
  // What somebody has already said no to does not come back.
  const { rows: refused } = await query('select flag, subject_kind, subject from taxonomy_refusals');
  const no = new Set(refused.map((r) => `${r.flag}|${r.subject_kind}|${r.subject}`));
  const keep = [...first, ...extra, ...proposals].filter((p) => !no.has(`${p.flag}|${p.subject_kind}|${p.subject}`));

  return withTransaction(async (client) => {
    const { rows: [audit] } = await client.query(
      'insert into taxonomy_audits (ran_by, evidence) values ($1, $2::jsonb) returning *',
      [by, JSON.stringify({ ...saw, refusedAlready: refused.length })]);
    for (const p of keep) {
      await client.query(
        `insert into taxonomy_proposals
           (audit_id, flag, subject_kind, subject, subject_label, action, now_value, proposed, because, numbers, moves)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
         on conflict (audit_id, flag, subject_kind, subject) do nothing`,
        [audit.id, p.flag, p.subject_kind, p.subject, p.subject_label ?? null, p.action,
          p.now_value ?? null, p.proposed ?? null, p.because, JSON.stringify(p.numbers ?? {}), p.moves ?? 0]);
    }
    return audit;
  });
}

/** One run, its proposals grouped by flag, and what accepting them all would do. */
export async function read(id = null) {
  const { rows: [audit] } = id
    ? await query('select * from taxonomy_audits where id = $1', [id])
    : await query('select * from taxonomy_audits order by ran_at desc limit 1');
  if (!audit) return null;
  const { rows } = await query(
    'select * from taxonomy_proposals where audit_id = $1 order by flag, moves desc, subject', [audit.id]);
  const groups = new Map();
  for (const p of rows) groups.set(p.flag, [...(groups.get(p.flag) ?? []), p]);
  return {
    audit,
    groups: [...groups].map(([flag, list]) => ({
      flag,
      open: list.filter((p) => p.state === 'open').length,
      accepted: list.filter((p) => p.state === 'accepted').length,
      moves: list.filter((p) => p.state === 'accepted').reduce((n, p) => n + p.moves, 0),
      proposals: list,
    })),
    effect: effectOf(rows.filter((p) => p.state === 'accepted')),
  };
}

/**
 * What the accepted set would do, computed before it is applied.
 *
 * "Compute the effect of the whole set before it is applied — places moving per
 * category, subcategories retired, subcategories created."
 */
export function effectOf(accepted) {
  return {
    proposals: accepted.length,
    placesMoving: accepted.reduce((n, p) => n + (p.moves ?? 0), 0),
    excluding: accepted.filter((p) => p.action === 'exclude').length,
    retiring: accepted.filter((p) => p.action === 'retire' || p.action === 'fold').length,
    creating: accepted.filter((p) => p.action === 'create' || p.action === 'split').length,
    renaming: accepted.filter((p) => p.action === 'rename').length,
  };
}

/** Accept or reject one. A rejection is remembered so the signal stays quiet. */
export async function decide({ id, state, by = null }) {
  const { rows: [p] } = await query(
    `update taxonomy_proposals set state = $2, decided_at = now(), decided_by = $3
      where id = $1 and state in ('open','accepted','rejected') returning *`, [id, state, by]);
  if (!p) return null;
  if (state === 'rejected') {
    await query(
      `insert into taxonomy_refusals (flag, subject_kind, subject, proposed, refused_by)
       values ($1,$2,$3,$4,$5)
       on conflict (flag, subject_kind, subject) do update set refused_at = now(), refused_by = excluded.refused_by`,
      [p.flag, p.subject_kind, p.subject, p.proposed, by]);
  } else {
    await query('delete from taxonomy_refusals where flag = $1 and subject_kind = $2 and subject = $3',
      [p.flag, p.subject_kind, p.subject]);
  }
  return p;
}

/** Every open proposal in one group, decided at once. */
export async function decideGroup({ auditId, flag, state, by = null }) {
  const { rows } = await query(
    `update taxonomy_proposals set state = $3, decided_at = now(), decided_by = $4
      where audit_id = $1 and flag = $2 and state = 'open' returning *`, [auditId, flag, state, by]);
  if (state === 'rejected') {
    for (const p of rows) {
      await query(
        `insert into taxonomy_refusals (flag, subject_kind, subject, proposed, refused_by)
         values ($1,$2,$3,$4,$5)
         on conflict (flag, subject_kind, subject) do update set refused_at = now()`,
        [p.flag, p.subject_kind, p.subject, p.proposed, by]);
    }
  }
  return rows;
}

/**
 * Apply the accepted set, as one transaction, keeping enough to put it back.
 *
 * "Apply as one reversible transaction. A whole applied audit must be undoable
 * as a single action for at least seven days. Nobody will press Accept all
 * without that."
 *
 * Three of the actions are **advice, not instructions**, and the apply says so
 * rather than pretending: `fill` names the unanswered words that look like they
 * belong in an empty drawer, `split` names the clusters inside a junk drawer,
 * and a `repoint` with nothing proposed is a flag that the mapping is catching
 * places incidentally. Each needs somebody to choose, so each is left open and
 * counted in `advisory`.
 */
const DOES = new Set(['exclude', 'rename', 'retire', 'fold', 'create', 'carry', 'repoint']);

export async function apply({ auditId, by = null }) {
  // Applied once, and once only. A run that left advisory proposals sitting in
  // `accepted` would otherwise be applied a second time, build an empty
  // snapshot over the real one and take the undo with it (Codex, 20 Sep 2026).
  const { rows: [already] } = await query('select applied_at, undone_at from taxonomy_audits where id = $1', [auditId]);
  if (!already) throw Object.assign(new Error('No such audit.'), { status: 404 });
  if (already.applied_at && !already.undone_at) {
    throw Object.assign(new Error('That audit has already been applied. Put it back first.'), { status: 400 });
  }
  const { rows: accepted } = await query(
    `select * from taxonomy_proposals where audit_id = $1 and state = 'accepted' order by action`, [auditId]);
  if (!accepted.length) return { applied: 0, advisory: 0, snapshot: null };

  return withTransaction(async (client) => {
    const snapshot = { words: [], subcategories: [], rules: [] };
    // One snapshot per thing, taken before anything has touched it. Two
    // accepted proposals can name the same word under different flags, and
    // capturing it again after the first had already changed it made undo
    // restore the mutated state (Codex, 20 Sep 2026).
    const kept = new Set();
    const keepWord = async (key) => {
      if (kept.has(`w:${key}`)) return;
      kept.add(`w:${key}`);
      const { rows } = await client.query(
        "select namespace, key, decision, points_at, active from taxonomy_labels where namespace = 'google' and key = $1", [key]);
      if (rows[0]) snapshot.words.push(rows[0]);
    };
    const keepSub = async (key) => {
      if (kept.has(`s:${key}`)) return;
      kept.add(`s:${key}`);
      const { rows } = await client.query(
        'select key, label, category_key, active from shelf_subcategories where key = $1', [key]);
      if (rows[0]) snapshot.subcategories.push(rows[0]);
    };
    /** Every word pointing at a drawer, before a fold moves them all. */
    const keepPointers = async (subKey) => {
      const { rows } = await client.query(
        "select namespace, key, decision, points_at, active from taxonomy_labels where points_at = $1", [subKey]);
      for (const r of rows) {
        if (kept.has(`w:${r.key}`)) continue;
        kept.add(`w:${r.key}`);
        snapshot.words.push(r);
      }
    };
    const keepRules = async (where, args) => {
      const { rows } = await client.query(`select * from shelf_rules where ${where}`, args);
      snapshot.rules.push(...rows);
    };

    let applied = 0; let advisory = 0;
    for (const p of accepted) {
      if (!DOES.has(p.action) || (p.action === 'repoint' && !p.proposed)) { advisory += 1; continue; }

      if (p.subject_kind === 'word') {
        await keepWord(p.subject);
        await keepRules('subject = $1 or subject = $2', [`google:${p.subject}`, p.subject]);
        if (p.action === 'exclude') {
          // The same shape 125 and 138 used: said aside, switched off, and its
          // rules taken with it or the drawer keeps filling from a word nobody
          // can see any more.
          await client.query(
            `update taxonomy_labels set decision = 'aside', points_at = null, active = false, updated_at = now()
              where namespace = 'google' and key = $1`, [p.subject]);
          await client.query('delete from shelf_rules where subject = $1 or subject = $2',
            [`google:${p.subject}`, p.subject]);
        } else if (p.action === 'repoint') {
          await client.query(
            `update taxonomy_labels set points_at = $2, decision = null, updated_at = now()
              where namespace = 'google' and key = $1`, [p.subject, p.proposed]);
          await client.query(
            `update shelf_rules set subcategory = $2, updated_at = now() where subject = $1`,
            [`google:${p.subject}`, p.proposed]);
        } else if (p.action === 'carry') {
          advisory += 1; continue;
        }
      } else {
        await keepSub(p.subject);
        await keepRules('subcategory = $1', [p.subject]);
        if (p.action === 'rename') {
          await client.query('update shelf_subcategories set label = $2, updated_at = now() where key = $1',
            [p.subject, p.proposed]);
        } else if (p.action === 'retire') {
          // Switched off rather than deleted: a place already filed there keeps
          // its row and switching it back on is one tap.
          await client.query('update shelf_subcategories set active = false, updated_at = now() where key = $1', [p.subject]);
        } else if (p.action === 'fold') {
          const { rows: [target] } = await client.query(
            'select key from shelf_subcategories where label = $1 or key = $1', [p.proposed]);
          if (!target) { advisory += 1; continue; }
          // The words pointing here move too, so they are kept before they do.
          await keepPointers(p.subject);
          await client.query('update shelf_rules set subcategory = $2, updated_at = now() where subcategory = $1',
            [p.subject, target.key]);
          await client.query(
            `update taxonomy_labels set points_at = $2, updated_at = now() where points_at = $1`, [p.subject, target.key]);
          await client.query('update shelf_subcategories set active = false, updated_at = now() where key = $1', [p.subject]);
        } else if (p.action === 'create') {
          // The category comes with the proposal, because a drawer without a
          // cabinet is not a drawer. Made switched on and empty; what fills it
          // is a mapping decision, not this one.
          const cat = p.numbers?.category ?? null;
          if (!cat) { advisory += 1; continue; }
          await client.query(
            `insert into shelf_subcategories (key, label, category_key, active)
             values ($1, $2, $3, true)
             on conflict (key) do update set label = excluded.label, category_key = excluded.category_key,
                                             active = true, updated_at = now()`,
            [p.subject, p.proposed, cat]);
          // Undoing a create means removing it, which the snapshot cannot say
          // by holding a row that did not exist. It is recorded as a birth.
          snapshot.created = [...(snapshot.created ?? []), p.subject];
        }
      }
      await client.query("update taxonomy_proposals set state = 'applied' where id = $1", [p.id]);
      applied += 1;
    }

    await client.query(
      'update taxonomy_audits set applied_at = now(), applied_by = $2, snapshot = $3::jsonb where id = $1',
      [auditId, by, JSON.stringify(snapshot)]);
    return { applied, advisory, snapshot };
  });
}

/** Put a whole applied audit back, exactly as it was. */
export async function undo({ auditId, by = null }) {
  const { rows: [audit] } = await query('select * from taxonomy_audits where id = $1', [auditId]);
  if (!audit?.applied_at) throw Object.assign(new Error('That audit was never applied.'), { status: 400 });
  if (audit.undone_at) throw Object.assign(new Error('That audit has already been put back.'), { status: 400 });
  const snap = audit.snapshot ?? { words: [], subcategories: [], rules: [] };

  return withTransaction(async (client) => {
    for (const w of snap.words) {
      await client.query(
        `update taxonomy_labels set decision = $3, points_at = $4, active = $5, updated_at = now()
          where namespace = $1 and key = $2`, [w.namespace, w.key, w.decision, w.points_at, w.active]);
    }
    for (const key of snap.created ?? []) {
      // A drawer this audit made goes away again. Anything filed into it since
      // would block the delete, so it is switched off instead and said so.
      const { rows: [used] } = await client.query(
        'select count(*)::int n from shelf_rules where subcategory = $1', [key]);
      if (used.n > 0) await client.query('update shelf_subcategories set active = false where key = $1', [key]);
      else await client.query('delete from shelf_subcategories where key = $1', [key]);
    }
    for (const s of snap.subcategories) {
      await client.query(
        'update shelf_subcategories set label = $2, category_key = $3, active = $4, updated_at = now() where key = $1',
        [s.key, s.label, s.category_key, s.active]);
    }
    // The rules were deleted or repointed, so they go back by id.
    for (const r of snap.rules) {
      await client.query(
        `insert into shelf_rules (id, scope, subject, subject_label, weights, reason, taught_by, seeded, subcategory, labels)
         values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)
         on conflict (id) do update set subcategory = excluded.subcategory, labels = excluded.labels, updated_at = now()`,
        [r.id, r.scope, r.subject, r.subject_label, JSON.stringify(r.weights ?? {}), r.reason,
          r.taught_by, r.seeded, r.subcategory, r.labels]);
    }
    await client.query("update taxonomy_proposals set state = 'accepted' where audit_id = $1 and state = 'applied'", [auditId]);
    await client.query('update taxonomy_audits set undone_at = now() where id = $1', [auditId]);
    return { words: snap.words.length, subcategories: snap.subcategories.length, rules: snap.rules.length };
  });
}
