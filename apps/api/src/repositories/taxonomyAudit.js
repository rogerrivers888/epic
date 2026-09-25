/**
 * Gathering the evidence the audit reasons over, and keeping its runs.
 *
 * Every number here comes from something Epic already holds — the index, the
 * search log, the owned records and the rules themselves. Nothing in a run
 * calls a provider, so the audit can be run as often as anybody likes.
 */

import { query, withTransaction } from '../db.js';
import { inheritBar } from './placeIndex.js';
import { auditAll } from '../domain/taxonomyAudit.js';
import { agreed, LANDMARK_SPLIT, signedOff } from '../domain/taxonomyCleanup.js';
import { forget as forgetTaxonomy } from './shelfTaxonomy.js';
import { forget as forgetAttributes } from './placeAttributes.js';

/** What the signals need, read in one pass. */
export async function evidence() {
  const [subs, rules, places, words, shown, opened, owned, types, pairs, labels, alsoIn, defaults] = await Promise.all([
    query('select key, label, category_key, active from shelf_subcategories'),
    query('select id, scope, subject, subject_label, subcategory, labels, weights from shelf_rules'),
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
    // Our own labels, each drawer's second cabinets and its defaults: what an
    // agreed set has to be able to see to know it has already been applied.
    query('select key, active from place_attributes'),
    query('select subcategory_key, category_key from shelf_subcategory_categories'),
    query('select subcategory_key, attribute_key, yesno, from_value, to_value, choice, level, settled from shelf_subcategory_attributes'),
  ]);
  const alsoBySub = new Map();
  for (const r of alsoIn.rows) alsoBySub.set(r.subcategory_key, [...(alsoBySub.get(r.subcategory_key) ?? []), r.category_key]);
  const defaultsBySub = new Map();
  for (const r of defaults.rows) {
    const m = defaultsBySub.get(r.subcategory_key) ?? new Map();
    m.set(r.attribute_key, { yesno: r.yesno, from: r.from_value, to: r.to_value, choice: r.choice, level: r.level, settled: r.settled });
    defaultsBySub.set(r.subcategory_key, m);
  }

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
  // Wikidata types by the name their rule carries, so a cleanup can go on
  // saying "arch bridge" instead of Q158438.
  const kindsByName = new Map();
  for (const r of rules.rows) {
    if (r.scope !== 'kind' || !r.subject_label) continue;
    kindsByName.set(String(r.subject_label).toLowerCase(), r.subject);
  }

  return {
    subs: subs.rows,
    // Every rule as held, so an agreed set can address one by its subject.
    rules: rules.rows,
    rulesBySub,
    placesBySub: new Map(places.rows.map((r) => [r.subcategory, Number(r.n)])),
    words: words.rows
      .filter((w) => w.active && !w.decision)
      .map((w) => ({ key: w.key, label: w.label, subcategoryLabel: w.sub_label })),
    // Every Google word with what has been decided about it, for the agreed
    // sets: `words` above is only the undecided ones, and a word already
    // said aside or already pointing somewhere is exactly what those need to see.
    allWords: words.rows.map((w) => ({ key: w.key, decision: w.decision, points_at: w.points_at, active: w.active })),
    labels: labels.rows,
    alsoBySub,
    defaultsBySub,
    unmapped: words.rows.filter((w) => w.active && !w.decision && !w.points_at),
    placesByWord: byWord,
    shownByRef: new Map(shown.rows.map((r) => [r.venue_ref, Number(r.n)])),
    openedByRef: new Map(opened.rows.map((r) => [r.venue_ref, Number(r.n)])),
    ownedByRef: new Map(owned.rows.map((r) => [r.venue_ref, r.visitable])),
    // The first type Google lists is the one it thinks the place mostly is.
    primaryByRef: new Map(types.rows.map((r) => [r.venue_ref, r.google_types[0]])),
    together: new Map([...together].map(([k, v]) => [k, [...v]])),
    kindsByName,
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

/**
 * What mapping a word somewhere would actually do, before it is committed.
 *
 * Both briefs call this the highest-value thing on the Mapping screen. The
 * design brief, §2.4: "Landmarks & monuments — brings in 1,240 places · 1,180
 * have never been opened. That one line would have prevented most of the
 * current mess."
 *
 * Read from the same evidence the audit uses and costs nothing, so the screen
 * may ask for every destination in a dropdown at once. Two numbers, and the
 * second is only offered where it means anything: with nine opens in the whole
 * system, "none have ever been opened" is true of everything and says nothing
 * about the word (see `nobodyGoes`). `openable` is false until the corpus has
 * enough opens to make the figure worth printing, and the screen should draw
 * the places count alone until it flips.
 */
export async function consequence(keys = []) {
  const wanted = [...new Set(keys.map((k) => String(k).split(':').pop()))].filter(Boolean);
  if (!wanted.length) return { openable: false, words: {} };
  const [pairs, shown, opened] = await Promise.all([
    query(`select found_by, venue_ref from place_subcategories where found_by = any($1)
            union
           select found_by, venue_ref from place_index where found_by = any($1)`, [wanted]),
    query("select venue_ref, count(*)::int n from search_events where kind = 'shown' and venue_ref is not null group by 1"),
    query(`select venue_ref, count(*)::int n from search_events
            where kind in ('open','save','add_to_trip') and venue_ref is not null group by 1`),
  ]);
  const shownBy = new Map(shown.rows.map((r) => [r.venue_ref, r.n]));
  const openBy = new Map(opened.rows.map((r) => [r.venue_ref, r.n]));
  const opensAll = [...openBy.values()].reduce((n, v) => n + v, 0);

  const refs = new Map();
  for (const r of pairs.rows) {
    const had = refs.get(r.found_by) ?? new Set();
    had.add(r.venue_ref);
    refs.set(r.found_by, had);
  }
  const words = {};
  for (const k of wanted) {
    const list = [...(refs.get(k) ?? [])];
    const everShown = list.filter((r) => shownBy.has(r)).length;
    const everOpened = list.filter((r) => openBy.has(r)).length;
    words[k] = {
      places: list.length,
      shown: everShown,
      opened: everOpened,
      neverOpened: everShown - everOpened,
    };
  }
  return { openable: opensAll >= 200, corpusOpens: opensAll, words };
}

/** Run every signal and keep what it found. Returns the run. */
/**
 * Whether a proposal from an agreed set describes the state the database is
 * already in. Only what can be read from the evidence is judged; a proposal
 * this cannot see through is kept, and apply decides.
 */
export function alreadyTrue(p, input) {
  const sub = input.subs.find((s) => s.key === p.subject);
  const ruleFor = (subject) => input.rules.find((r) => r.subject === subject);
  if (p.subject_kind === 'subcategory') {
    if (p.action === 'retire' || p.action === 'fold') return Boolean(sub) && sub.active === false;
    if (p.action === 'rename') return Boolean(sub) && sub.label === p.proposed;
    // A split is done when nothing but the drawer's own rule is left in it.
    if (p.action === 'split') {
      return Boolean(sub) && !input.rules.some((r) => r.subcategory === p.subject && !(r.scope === 'ours' && r.subject === p.subject));
    }
    // A settle is done when every second cabinet is listed and every default
    // reads as proposed — a null proposed means no row, not a row saying no.
    if (p.action === 'settle') {
      if (!sub) return false;
      const also = input.alsoBySub?.get(p.subject) ?? [];
      if ((p.numbers?.also_in ?? []).some((c) => !also.includes(c))) return false;
      const have = input.defaultsBySub?.get(p.subject) ?? new Map();
      return Object.entries(p.numbers?.defaults ?? {}).every(([attribute, value]) => {
        const now = have.get(attribute) ?? null;
        if (value == null) return now === null;
        if (now === null) return false;
        // A default the machine proposed and nobody agreed to is not done: the
        // settle would mark it settled, so it is still worth proposing.
        if (now.settled === false) return false;
        return ['yesno', 'from', 'to', 'choice', 'level'].every((k) => (value[k] ?? null) === (now[k] ?? null));
      });
    }
    return false;
  }
  if (p.subject_kind === 'kind') {
    const r = input.rules.find((x) => x.scope === 'kind' && x.subject === p.subject);
    if (!r) return true;
    if (p.action === 'repoint') return r.subcategory === p.proposed;
    return false;
  }
  // One of our own labels: retired once it is off.
  if (p.subject.startsWith('ours:')) {
    const l = input.labels?.find((x) => x.key === p.subject.slice('ours:'.length));
    return p.action === 'retire' ? Boolean(l) && l.active === false : false;
  }
  // A word: a Google type by bare key, or a rule subject of any namespace.
  const qualified = p.subject.includes(':');
  const w = qualified ? null : (input.allWords ?? input.words).find((x) => x.key === p.subject);
  const r = ruleFor(qualified ? p.subject : `google:${p.subject}`) ?? (qualified ? null : ruleFor(p.subject));
  if (p.action === 'exclude') return w ? w.decision === 'aside' || w.active === false : !r;
  if (p.action === 'repoint') {
    if (w) return w.points_at === p.proposed && (!r || r.subcategory === p.proposed);
    return Boolean(r) && r.subcategory === p.proposed;
  }
  return false;
}

export async function run({ by = null, extra = [], withAgreed = false } = {}) {
  const input = await evidence();
  // Section 4 of the brief, signed off already, proposed through the same flow
  // so the first use of accept-and-apply is on changes somebody trusts.
  const sets = withAgreed
    ? (() => {
      const args = {
        have: new Set(input.subs.map((s) => s.key)),
        words: new Set(input.allWords.map((w) => w.key)),
        kinds: input.kindsByName,
        rules: new Set(input.rules.map((r) => r.subject)),
      };
      return [...agreed(args), ...signedOff(args)];
    })()
    : [];
  // A signed-off change that is already true is not proposed again. The two
  // agreed sets are stable lists, so every run after the first would otherwise
  // offer the same retirements and renames a second time, and accepting them
  // would take a snapshot of the finished state over the one that can undo it.
  const first = sets.filter((p) => !alreadyTrue(p, input));
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
    settling: accepted.filter((p) => p.action === 'settle').length,
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
const DOES = new Set(['exclude', 'rename', 'retire', 'fold', 'create', 'carry', 'repoint', 'split', 'settle']);

/**
 * Where a word proposal's subject lives. A bare key is a Google type, the way
 * every proposal named one before 24 Sep 2026; `osm:sport=archery` is a rule on
 * a tag from the open map, addressed exactly as `shelf_rules` holds it.
 */
function subjectOf(subject) {
  const at = subject.indexOf(':');
  if (at < 0) return { namespace: 'google', key: subject, full: `google:${subject}`, bare: subject };
  return { namespace: subject.slice(0, at), key: subject.slice(at + 1), full: subject, bare: null };
}

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
    const keepWord = async (key, namespace = 'google') => {
      if (kept.has(`w:${namespace}:${key}`)) return;
      kept.add(`w:${namespace}:${key}`);
      const { rows } = await client.query(
        'select namespace, key, decision, points_at, active from taxonomy_labels where namespace = $2 and key = $1', [key, namespace]);
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
        if (kept.has(`w:${r.namespace}:${r.key}`)) continue;
        kept.add(`w:${r.namespace}:${r.key}`);
        snapshot.words.push(r);
      }
    };
    // A rule is kept once, before anything has moved it. A fold and a repoint
    // in the same set both touch the same rule, and a second capture after the
    // fold would have undo put the rule back where the fold left it.
    const keepRules = async (where, args) => {
      const { rows } = await client.query(`select * from shelf_rules where ${where}`, args);
      for (const r of rows) {
        if (kept.has(`r:${r.id}`)) continue;
        kept.add(`r:${r.id}`);
        snapshot.rules.push(r);
      }
    };
    /** One of our own labels, before it is switched off. */
    const keepLabel = async (key) => {
      if (kept.has(`l:${key}`)) return;
      kept.add(`l:${key}`);
      const { rows } = await client.query('select key, active from place_attributes where key = $1', [key]);
      if (rows[0]) snapshot.labels = [...(snapshot.labels ?? []), rows[0]];
    };
    /** A drawer's secondary categories and defaults, before a settle or a create changes them. */
    const keepSettled = async (key) => {
      if (kept.has(`d:${key}`)) return;
      kept.add(`d:${key}`);
      const [{ rows: also }, { rows: defaults }, { rows: [cols] }] = await Promise.all([
        client.query('select category_key, position from shelf_subcategory_categories where subcategory_key = $1', [key]),
        client.query('select attribute_key, yesno, from_value, to_value, choice, level, settled from shelf_subcategory_attributes where subcategory_key = $1', [key]),
        client.query('select indoor, for_kids from shelf_subcategories where key = $1', [key]),
      ]);
      snapshot.settled = [...(snapshot.settled ?? []), { key, also, defaults, columns: cols ?? null }];
    };
    /**
     * Set a drawer's secondary categories and defaults. Indoors and For kids
     * are still columns on the row as well as attributes, and the two must
     * not disagree (repositories/shelfTaxonomy.js, mirrorOldColumns).
     */
    const settle = async (key, numbers) => {
      for (const cat of numbers?.also_in ?? []) {
        await client.query(
          `insert into shelf_subcategory_categories (subcategory_key, category_key, position)
           values ($1, $2, coalesce((select max(position) + 1 from shelf_subcategory_categories where subcategory_key = $1), 1))
           on conflict (subcategory_key, category_key) do nothing`, [key, cat]);
      }
      const MIRROR = { indoor: 'indoor', 'kid-friendly': 'for_kids' };
      for (const [attribute, value] of Object.entries(numbers?.defaults ?? {})) {
        if (value == null) {
          await client.query('delete from shelf_subcategory_attributes where subcategory_key = $1 and attribute_key = $2', [key, attribute]);
        } else {
          await client.query(
            `insert into shelf_subcategory_attributes (subcategory_key, attribute_key, yesno, from_value, to_value, choice, level, settled)
             values ($1, $2, $3, $4, $5, $6, $7, true)
             on conflict (subcategory_key, attribute_key) do update
                set yesno = excluded.yesno, from_value = excluded.from_value, to_value = excluded.to_value,
                    choice = excluded.choice, level = excluded.level, settled = true, updated_at = now()`,
            [key, attribute, value.yesno ?? null, value.from ?? null, value.to ?? null, value.choice ?? null, value.level ?? null]);
        }
        if (MIRROR[attribute]) {
          await client.query(`update shelf_subcategories set ${MIRROR[attribute]} = $2, updated_at = now() where key = $1`,
            [key, value == null ? null : value.yesno ?? null]);
        }
      }
    };

    let applied = 0; let advisory = 0;
    for (const p of accepted) {
      if (!DOES.has(p.action) || (p.action === 'repoint' && !p.proposed)) { advisory += 1; continue; }

      if (p.subject_kind === 'kind') {
        await keepRules('scope = $1 and subject = $2', ['kind', p.subject]);
        if (p.action === 'exclude') {
          await client.query("delete from shelf_rules where scope = 'kind' and subject = $1", [p.subject]);
        } else if (p.action === 'repoint') {
          await client.query(
            `update shelf_rules set subcategory = $2, updated_at = now()
              where scope = 'kind' and subject = $1`, [p.subject, p.proposed]);
        } else { advisory += 1; continue; }
      } else if (p.subject_kind === 'word' && p.subject.startsWith('ours:')) {
        // One of our own labels (place_attributes), addressed the way the
        // rules address ours. Retiring one switches it off; its defaults and
        // answers keep their rows and nothing reads an inactive label.
        const key = p.subject.slice('ours:'.length);
        if (p.action !== 'retire') { advisory += 1; continue; }
        await keepLabel(key);
        await client.query('update place_attributes set active = false, updated_at = now() where key = $1', [key]);
      } else if (p.subject_kind === 'word') {
        const at = subjectOf(p.subject);
        await keepWord(at.key, at.namespace);
        await keepRules('subject = $1 or subject = $2', [at.full, at.bare ?? at.full]);
        if (p.action === 'exclude') {
          // The same shape 125 and 138 used: said aside, switched off, and its
          // rules taken with it or the drawer keeps filling from a word nobody
          // can see any more.
          await client.query(
            `update taxonomy_labels set decision = 'aside', points_at = null, active = false, updated_at = now()
              where namespace = $2 and key = $1`, [at.key, at.namespace]);
          await client.query('delete from shelf_rules where subject = $1 or subject = $2', [at.full, at.bare ?? at.full]);
        } else if (p.action === 'repoint') {
          // A word sent somewhere is in use again, whatever was decided before:
          // one set aside and later given a drawer must not stay switched off.
          await client.query(
            `update taxonomy_labels set points_at = $2, decision = null, active = true, updated_at = now()
              where namespace = $3 and key = $1`, [at.key, p.proposed, at.namespace]);
          await client.query(
            `update shelf_rules set subcategory = $2, updated_at = now() where subject = $1 or subject = $3`,
            [at.full, p.proposed, at.bare ?? at.full]);
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
          // its row and switching it back on is one tap. The drawer's own rule
          // goes, though (kept above, so undo brings it back): the rules are
          // loaded whether or not the drawer is, and a word still pointing at a
          // retired drawer would resolve through it to a cabinet that is not
          // there (Codex, 25 Sep 2026).
          await client.query("delete from shelf_rules where scope = 'ours' and subject = $1 and subcategory = $1", [p.subject]);
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
        } else if (p.action === 'split') {
          // A split only applies where somebody has said which words go to
          // which half. The owner named these two (20 Sep 2026); a split whose
          // halves nobody has named stays advisory, which is why this checks
          // rather than assumes.
          const plan = p.subject === LANDMARK_SPLIT.from ? LANDMARK_SPLIT : null;
          if (!plan) { advisory += 1; continue; }
          for (const half of plan.halves) {
            const { rows: [to] } = await client.query(
              'select key from shelf_subcategories where key = $1 and active', [half.key]);
            if (!to) continue;
            for (const w of half.words) {
              await keepWord(w);
              await keepRules('subject = $1 or subject = $2', [`google:${w}`, w]);
              await client.query(
                `update taxonomy_labels set points_at = $2, updated_at = now()
                  where namespace = 'google' and key = $1`, [w, half.key]);
              await client.query(
                `update shelf_rules set subcategory = $2, updated_at = now()
                  where subject = $1 or subject = $3`, [`google:${w}`, half.key, w]);
            }
            // And the Wikidata types, which is how most of these are filed.
            for (const name of half.kinds ?? []) {
              await keepRules('scope = $1 and lower(subject_label) = $2', ['kind', name.toLowerCase()]);
              await client.query(
                `update shelf_rules set subcategory = $2, updated_at = now()
                  where scope = 'kind' and lower(subject_label) = $1`, [name.toLowerCase(), half.key]);
            }
          }
          // The source keeps whatever nobody named. Retired only if it is
          // actually empty -- saying "split" and leaving twenty rules behind in
          // a drawer marked gone would lose them.
          const { rows: [left] } = await client.query(
            'select count(*)::int n from shelf_rules where subcategory = $1', [p.subject]);
          if (left.n === 0) {
            await client.query('update shelf_subcategories set active = false, updated_at = now() where key = $1', [p.subject]);
          }
        } else if (p.action === 'settle') {
          await keepSettled(p.subject);
          await settle(p.subject, p.numbers);
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
          // A drawer with no bar is invisible: every place in it reads "not
          // set" for ever. Thirteen made this way had that hole for weeks and
          // no test could see them (owner, 21 Sep 2026).
          await inheritBar(p.subject, client);
          // A second cabinet, where the proposal names one: Have a go is Sport
          // first and Adrenaline too (section 2, 24 Sep 2026). And its
          // defaults, where the document states them: a science centre is
          // indoors and two to three hours (the axes brief, 25 Sep 2026).
          await settle(p.subject, { also_in: p.numbers?.also_in ?? [], defaults: p.numbers?.defaults ?? {} });
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
    forgetTaxonomy(); forgetAttributes();
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
    for (const l of snap.labels ?? []) {
      await client.query('update place_attributes set active = $2, updated_at = now() where key = $1', [l.key, l.active]);
    }
    for (const d of snap.settled ?? []) {
      await client.query('delete from shelf_subcategory_categories where subcategory_key = $1', [d.key]);
      for (const a of d.also) {
        await client.query(
          'insert into shelf_subcategory_categories (subcategory_key, category_key, position) values ($1, $2, $3) on conflict do nothing',
          [d.key, a.category_key, a.position]);
      }
      await client.query('delete from shelf_subcategory_attributes where subcategory_key = $1', [d.key]);
      for (const v of d.defaults) {
        await client.query(
          `insert into shelf_subcategory_attributes (subcategory_key, attribute_key, yesno, from_value, to_value, choice, level, settled)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [d.key, v.attribute_key, v.yesno, v.from_value, v.to_value, v.choice, v.level, v.settled]);
      }
      if (d.columns) {
        await client.query('update shelf_subcategories set indoor = $2, for_kids = $3, updated_at = now() where key = $1',
          [d.key, d.columns.indoor, d.columns.for_kids]);
      }
    }
    for (const s of snap.subcategories) {
      await client.query(
        'update shelf_subcategories set label = $2, category_key = $3, active = $4, updated_at = now() where key = $1',
        [s.key, s.label, s.category_key, s.active]);
    }
    // The rules were deleted or repointed, so they go back by id — and before
    // a created drawer is judged, or the rules this audit moved into it read
    // as somebody filing there since and the drawer is only switched off
    // (Codex, 24 Sep 2026).
    for (const r of snap.rules) {
      await client.query(
        `insert into shelf_rules (id, scope, subject, subject_label, weights, reason, taught_by, seeded, subcategory, labels)
         values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)
         on conflict (id) do update set subcategory = excluded.subcategory, labels = excluded.labels, updated_at = now()`,
        [r.id, r.scope, r.subject, r.subject_label, JSON.stringify(r.weights ?? {}), r.reason,
          r.taught_by, r.seeded, r.subcategory, r.labels]);
    }
    for (const key of snap.created ?? []) {
      // A drawer this audit made goes away again. Anything filed into it since
      // would block the delete, so it is switched off instead and said so.
      // Rules, and places the index has filed there since: the index has no
      // foreign key to clear, so a deleted drawer would leave them pointing at
      // nothing (Codex, 24 Sep 2026).
      const { rows: [used] } = await client.query(
        `select (select count(*) from shelf_rules where subcategory = $1)
              + (select count(*) from place_index where subcategory = $1) as n`, [key]);
      if (Number(used.n) > 0) { await client.query('update shelf_subcategories set active = false where key = $1', [key]); continue; }
      // The bar it inherited and its second cabinets go with it; a bar left
      // behind would make the key read as a drawer that exists.
      await client.query('delete from ready_bars where subcategory_key = $1', [key]);
      await client.query('delete from shelf_subcategories where key = $1', [key]);
    }
    await client.query("update taxonomy_proposals set state = 'accepted' where audit_id = $1 and state = 'applied'", [auditId]);
    await client.query('update taxonomy_audits set undone_at = now() where id = $1', [auditId]);
    forgetTaxonomy(); forgetAttributes();
    return { words: snap.words.length, subcategories: snap.subcategories.length, rules: snap.rules.length,
      labels: (snap.labels ?? []).length, settled: (snap.settled ?? []).length };
  });
}
