/**
 * Mapping: where each of Google's words sends its places (handover 4.10, 6.4).
 *
 * A word points at several subcategories, exactly one primary, always, and
 * may carry facts. Every decision on a word is made one at a time, keeps its
 * reason, who and when, is undoable, and appears in Changes. The decision log
 * (`word_decisions`) is stored apart from every other log.
 *
 * Three things are kept in step inside one transaction, because a word that
 * reads one way and files another is the one state nobody goes looking for:
 *
 *   - `taxonomy_labels` — the word's answer (decision) and its primary
 *     (`points_at`), which is what the classifier reads;
 *   - `shelf_rules` — the `labels` rule for `google:<word>`, which files the
 *     places into the primary;
 *   - `word_targets` — every subcategory it points at, primary first.
 *
 * Undo restores all three from the snapshot taken before, and reopens the
 * proposal the decision answered.
 */

import { query, withTransaction } from '../db.js';
import { logChange, markUndone } from './changes.js';
import { forget as forgetRules } from '../repositories/shelfRules.js';
import { forget as forgetTaxonomy } from '../repositories/shelfTaxonomy.js';
import { forget as forgetAttributes } from '../repositories/placeAttributes.js';
import { inheritBar } from '../repositories/placeIndex.js';

const NS = 'google';
const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_request' });
const missing = (message) => Object.assign(new Error(message), { status: 404, code: 'not_found' });

/** Why a word is out, in the words the Not in Epic view uses. */
export const WHY_OUT = {
  aside: 'Not a place people visit',
  travel: 'Getting there — held for reachability, never surfaced',
  nearby: 'Useful nearby — never a day out on its own',
};

/** The answer a word has, from its row and its targets. */
export function answerOf({ decision, targets = [] }) {
  if (decision && WHY_OUT[decision]) return 'notinepic';
  if (targets.length) return 'mapped';
  if (decision === 'generic') return 'secondary';
  return 'undecided';
}

// ---------------------------------------------------------------------------
// Reading

/** Every word's targets, primary first. */
async function targetsByWord(run = query) {
  const { rows } = await run(
    `select t.word, t.subcategory_key, t.is_primary, s.label, s.category_key, s.active
       from word_targets t join shelf_subcategories s on s.key = t.subcategory_key
      where t.namespace = $1
      order by t.word, t.is_primary desc, t.position, s.label`, [NS]);
  const out = new Map();
  for (const r of rows) {
    out.set(r.word, [...(out.get(r.word) ?? []), {
      key: r.subcategory_key, label: r.label, category: r.category_key, primary: r.is_primary, active: r.active,
    }]);
  }
  return out;
}

/**
 * How many places each word brings, and how many of them would actually
 * leave Epic if it went (handover: "Places affected counts only places that
 * would actually leave Epic or move. A place also carried by another in-Epic
 * word isn't lost").
 *
 * One pass over `place_index_labels`: a place is kept by another word when any
 * other Google word on it points somewhere (or is a fact only), so it stays in
 * Epic through that word.
 */
export async function bringsAndAffected(run = query) {
  const { rows } = await run(`
    with inepic as (
      select l.namespace || ':' || l.key as label
        from taxonomy_labels l
       where l.namespace = 'google' and l.active
         and (l.points_at is not null or l.decision = 'generic'
              or exists (select 1 from word_targets t where t.namespace = l.namespace and t.word = l.key))
    ),
    carried as (
      select pil.venue_ref, pil.label, (pil.label in (select label from inepic)) as in_epic
        from place_index_labels pil
       where pil.label like 'google:%'
    ),
    kept as (
      select venue_ref, count(*) filter (where in_epic) as inepic_words from carried group by venue_ref
    )
    select substr(c.label, 8) as word,
           count(distinct c.venue_ref)::int as brings,
           count(distinct c.venue_ref) filter (where k.inepic_words <= (case when c.in_epic then 1 else 0 end))::int as affected
      from carried c join kept k on k.venue_ref = c.venue_ref
     group by c.label`);
  return new Map(rows.map((r) => [r.word, { brings: r.brings, affected: r.affected }]));
}

/**
 * How often places a word brings have been opened, or null where the corpus
 * cannot speak. Handover 4.10: "No behaviour-based recommendations ('ever
 * opened') while the only household is Roger's test account" — so with fewer
 * than two households that have ever opened anything, every figure is null
 * and the screen shows "—", never a number that happens to be nought.
 */
export async function everOpened(run = query) {
  const { rows: [h] } = await run(
    `select count(distinct s.household_id)::int n
       from search_events e join searches s on s.id = e.search_id
      where e.kind = 'open'`).catch(() => ({ rows: [{ n: 0 }] }));
  if ((h?.n ?? 0) < 2) return null;
  const { rows } = await run(`
    select substr(pil.label, 8) as word, count(*)::int n
      from search_events e join place_index_labels pil on pil.venue_ref = e.venue_ref
     where e.kind = 'open' and pil.label like 'google:%'
     group by pil.label`).catch(() => ({ rows: [] }));
  return new Map(rows.map((r) => [r.word, r.n]));
}

/** The facts each word carries. */
async function carriesByWord(run = query) {
  const { rows } = await run(
    `select c.key as word, a.key, a.label
       from taxonomy_label_carries c join place_attributes a on a.key = c.attribute_key
      where c.namespace = $1 and a.active order by a.label`, [NS]);
  const out = new Map();
  for (const r of rows) out.set(r.word, [...(out.get(r.word) ?? []), { key: r.key, label: r.label }]);
  return out;
}

/** The last decision on each word, for Not in Epic's "Decided by · When". */
async function lastDecisionByWord(run = query) {
  const { rows } = await run(
    `select distinct on (word) word, kind, why, who, at from word_decisions
      where namespace = $1 and undone_at is null order by word, at desc`, [NS]);
  return new Map(rows.map((r) => [r.word, r]));
}

/**
 * The whole table, as its four views draw it.
 *
 * A word appears in exactly one view. A word with an open proposal is in
 * Needs a decision until decided; so is a word nobody has answered, as "No
 * suggestion — choose where it goes".
 */
export async function mappingState() {
  const [{ rows: words }, targets, counts, opened, carries, last, { rows: proposals }] = await Promise.all([
    query(`select key as word, label, note, seen_count, decision, points_at, active
             from taxonomy_labels where namespace = $1`, [NS]),
    targetsByWord(),
    bringsAndAffected(),
    everOpened(),
    carriesByWord(),
    lastDecisionByWord(),
    query(`select * from word_proposals where namespace = $1 and state = 'open'`, [NS]),
  ]);
  const proposalByWord = new Map(proposals.map((p) => [p.word, p]));

  const inEpic = []; const needs = []; const notInEpic = [];
  for (const w of words) {
    const t = targets.get(w.word) ?? [];
    const answer = answerOf({ decision: w.decision, targets: t });
    const c = counts.get(w.word) ?? { brings: 0, affected: 0 };
    const row = {
      word: w.word,
      group: w.note ?? null,
      brings: c.brings,
      opened: opened ? (opened.get(w.word) ?? 0) : null,
      answer,
      targets: t,
      facts: carries.get(w.word) ?? [],
      decision: w.decision,
    };
    const p = proposalByWord.get(w.word);
    if (p) {
      needs.push({ ...row, proposal: proposalOut(p, t, c) });
    } else if (answer === 'undecided') {
      needs.push({ ...row, proposal: { id: null, group: 'no_suggestion', action: 'choose', changeTo: 'Choose where it goes', affected: c.affected } });
    } else if (answer === 'notinepic') {
      const d = last.get(w.word);
      notInEpic.push({ ...row, why: d?.why ?? WHY_OUT[w.decision], decidedBy: d?.who ?? null, decidedAt: d?.at ?? null });
    } else {
      inEpic.push(row);
    }
  }
  const { rows: [{ n: decided }] } = await query(
    'select count(*)::int n from word_decisions where namespace = $1 and undone_at is null', [NS]);
  return {
    counts: { inEpic: inEpic.length, needs: needs.length, notInEpic: notInEpic.length, decided },
    inEpic, needs, notInEpic,
    everOpenedSpeaks: opened !== null,
  };
}

/** A proposal as the Needs a decision row draws it. */
function proposalOut(p, targets, counts) {
  return {
    id: p.id,
    group: p.grp,
    action: p.action,
    changeTo: p.change_to?.text ?? null,
    target: p.change_to?.subcategory ?? null,
    fact: p.change_to?.fact ?? null,
    ruleText: p.rule_text ?? null,
    affected: p.places_affected ?? counts.affected,
    pointsAtNow: targets.length ? targets.map((t) => t.label).join(' · ') : null,
  };
}

/** The Decided view: every past decision, newest first, filterable by kind. */
export async function decisions({ kind = null } = {}) {
  const args = [NS];
  let where = 'namespace = $1';
  if (kind) { args.push(kind); where += ` and kind = $${args.length}`; }
  const { rows } = await query(
    `select id, word, kind, why, who, at, before, after, proposal_id, undone_at
       from word_decisions where ${where} order by at desc limit 500`, args);
  return rows;
}

// ---------------------------------------------------------------------------
// Writing

/** What a word is now: enough to put it back exactly. */
async function snapshot(c, word) {
  const { rows: [w] } = await c.query(
    `select decision, points_at, active from taxonomy_labels where namespace = $1 and key = $2 for update`, [NS, word]);
  if (!w) throw missing(`Google has no word ${word}.`);
  const { rows: t } = await c.query(
    `select subcategory_key as sub, is_primary as "primary", position, condition from word_targets
      where namespace = $1 and word = $2 order by is_primary desc, position`, [NS, word]);
  const { rows: [rule] } = await c.query(
    `select id, subcategory, reason, taught_by from shelf_rules where scope = 'labels' and subject = $1`, [`${NS}:${word}`]);
  return {
    decision: w.decision, pointsAt: w.points_at, active: w.active,
    targets: t, rule: rule ? { subcategory: rule.subcategory, reason: rule.reason, by: rule.taught_by } : null,
  };
}

/** Put a word into a state, all three tables at once. */
async function apply(c, word, state, who) {
  const { decision, targets, active = true } = state;
  const primary = targets.find((t) => t.primary)?.sub ?? null;
  await c.query(
    `update taxonomy_labels set decision = $3, points_at = $4, active = $5, updated_at = now()
      where namespace = $1 and key = $2`, [NS, word, decision, primary, active]);
  await c.query('delete from word_targets where namespace = $1 and word = $2', [NS, word]);
  for (const [i, t] of targets.entries()) {
    await c.query(
      `insert into word_targets (namespace, word, subcategory_key, is_primary, position, condition) values ($1, $2, $3, $4, $5, $6)`,
      [NS, word, t.sub, Boolean(t.primary), i, t.condition ?? null]);
  }
  const subject = `${NS}:${word}`;
  if (primary) {
    const rule = state.rule ?? {};
    await c.query(
      `insert into shelf_rules (scope, subject, subject_label, weights, subcategory, reason, taught_by, seeded, labels)
       values ('labels', $1, $2, '{}'::jsonb, $3, $4, $5, false, $6)
       on conflict (scope, subject) do update set subcategory = excluded.subcategory, reason = excluded.reason,
         taught_by = excluded.taught_by, weights = '{}'::jsonb, labels = excluded.labels, updated_at = now()`,
      [subject, word.replace(/_/g, ' '), primary, rule.reason ?? 'Pointed at from Mapping.', rule.by ?? who, [subject]]);
  } else if (state.rule?.subcategory) {
    // A rule with no primary behind it: only reachable when restoring a
    // snapshot that had one, which apply() never produces on its own.
    await c.query(
      `update shelf_rules set subcategory = $2, updated_at = now() where scope = 'labels' and subject = $1`,
      [subject, state.rule.subcategory]);
  } else {
    await c.query(`delete from shelf_rules where scope = 'labels' and subject = $1`, [subject]);
  }
}

/** How a state reads in the Changes log's Before → After. */
async function pointsLabel(c, state) {
  if (state.decision && WHY_OUT[state.decision]) return 'Not in Epic';
  if (!state.targets?.length) return state.decision === 'generic' ? 'Fact only' : 'Not answered';
  const { rows } = await c.query('select key, label from shelf_subcategories where key = any($1)', [state.targets.map((t) => t.sub)]);
  const label = new Map(rows.map((r) => [r.key, r.label]));
  return state.targets.map((t) => (label.get(t.sub) ?? t.sub) + (t.primary && state.targets.length > 1 ? ' (primary)' : '')).join(' · ');
}

const forgetAll = () => { forgetRules(); forgetTaxonomy(); forgetAttributes(); };

/**
 * Decide something about a word. One transaction: snapshot, apply, write the
 * decision, write the change. Returns the decision, whose id is what Undo sends.
 */
async function decide({ word, kind, next, why, who, proposalId = null }) {
  if (!who) throw bad('A decision says who made it.');
  const out = await withTransaction(async (c) => {
    const before = await snapshot(c, word);
    const target = typeof next === 'function' ? await next(before, c) : next;
    await apply(c, word, target, who);
    const after = await snapshot(c, word);
    const { rows: [d] } = await c.query(
      `insert into word_decisions (namespace, word, kind, why, who, before, after, proposal_id)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8) returning *`,
      [NS, word, kind, why?.trim() || null, who, JSON.stringify(before), JSON.stringify(after), proposalId]);
    if (proposalId) {
      await c.query(`update word_proposals set state = 'decided', decided_at = now(), decided_by = $2 where id = $1`,
        [proposalId, who]);
    }
    const change = await logChange({
      client: c, who, area: 'Mapping', what: `Google word · ${word} · ${kind}`,
      before: await pointsLabel(c, before), after: await pointsLabel(c, after), why,
      subjectType: 'word', subjectId: word, undo: { kind: 'word_decision', id: d.id },
    });
    return { decision: d, change };
  });
  forgetAll();
  return out;
}

async function subExists(c, key) {
  const { rows: [s] } = await c.query('select key, active from shelf_subcategories where key = $1', [key]);
  if (!s) throw bad(`${key} is not one of our subcategories.`);
  if (!s.active) throw bad(`${key} is retired.`);
}

/**
 * The picker's edit: set the word's subcategories, exactly one primary. The
 * first in the list is the primary unless another is marked. A word cannot be
 * taken out of Epic this way — the primary cannot be unticked; that is
 * Exclude. Logged as Repointed.
 */
export async function setTargets({ word, subs, primary = null, why = null, who }) {
  const list = [...new Set((subs ?? []).map(String).filter(Boolean))];
  if (!list.length) throw bad('A word in Epic points at one subcategory at least. To take it out, exclude it.');
  const first = primary && list.includes(primary) ? primary : list[0];
  const ordered = [first, ...list.filter((s) => s !== first)];
  return decide({
    word, kind: 'Repointed', why, who,
    next: async (before, c) => {
      for (const s of ordered) await subExists(c, s);
      return { decision: null, active: true, targets: ordered.map((s, i) => ({ sub: s, primary: i === 0 })), rule: before.rule };
    },
  });
}

/** Exclude: the word's places leave Epic unless another word carries them. */
export async function exclude({ word, why, who, proposalId = null }) {
  return decide({ word, kind: 'Excluded', why: why || WHY_OUT.aside, who, proposalId, next: { decision: 'aside', active: false, targets: [] } });
}

/**
 * Bring a word back from Not in Epic. It returns undecided, which puts it in
 * Needs a decision until the picker says where it goes (README: "Bringing a
 * word back logs Brought back and opens its picker").
 */
export async function bringBack({ word, why, who }) {
  return decide({ word, kind: 'Brought back', why, who, next: { decision: null, active: true, targets: [] } });
}

/** Stop filing by a word and keep it as a fact only (tourist_attraction). */
export async function makeFact({ word, fact = null, why, who, proposalId = null }) {
  const out = await decide({ word, kind: 'Made a fact', why, who, proposalId, next: { decision: 'generic', active: true, targets: [] } });
  if (fact) {
    await query(
      `insert into taxonomy_label_carries (namespace, key, attribute_key, yesno) values ($1, $2, $3, true)
       on conflict (namespace, key, attribute_key) do nothing`, [NS, word, fact]);
    forgetAttributes();
  }
  return out;
}

/**
 * Decide an open proposal: carry out what it says, or Keep (decline it, and
 * never raise it again). Every proposal is decided on its own; there is no
 * accept-all.
 */
export async function decideProposal({ id, action, why = null, who }) {
  const { rows: [p] } = await query(`select * from word_proposals where id = $1`, [id]);
  if (!p) throw missing('No such proposal.');
  if (p.state !== 'open') throw bad('That proposal has been decided.');
  if (action === 'keep') {
    return withTransaction(async (c) => {
      const before = await snapshot(c, p.word);
      const { rows: [d] } = await c.query(
        `insert into word_decisions (namespace, word, kind, why, who, before, after, proposal_id)
         values ($1, $2, 'Kept', $3, $4, $5::jsonb, $5::jsonb, $6) returning *`,
        [NS, p.word, why?.trim() || 'Proposal declined', who, JSON.stringify(before), id]);
      await c.query(`update word_proposals set state = 'kept', decided_at = now(), decided_by = $2 where id = $1`, [id, who]);
      const change = await logChange({
        client: c, who, area: 'Mapping', what: `Google word · ${p.word} · Kept`,
        before: p.change_to?.text ?? null, after: 'Kept — proposal declined', why: why || 'Proposal declined',
        subjectType: 'word', subjectId: p.word, undo: { kind: 'word_decision', id: d.id },
      });
      return { decision: d, change };
    });
  }
  const why_ = why || p.change_to?.text || null;
  if (p.action === 'exclude') return exclude({ word: p.word, why: why_, who, proposalId: id });
  if (p.action === 'make_fact') return makeFact({ word: p.word, fact: p.change_to?.fact ?? null, why: why_, who, proposalId: id });
  if (p.action === 'repoint' || p.action === 'narrow') {
    const sub = p.change_to?.subcategory;
    if (!sub) throw bad('That proposal names no subcategory.');
    const kind = p.action === 'narrow' ? 'Narrowed' : 'Repointed';
    const condition = p.action === 'narrow' ? (p.change_to?.condition ?? null) : null;
    const out = await decide({
      word: p.word, kind, why: why_, who, proposalId: id,
      next: async (before, c) => {
        // A proposal may name a drawer or a fact that does not exist yet
        // (Science & learning centres; Has a planetarium). They are made here,
        // when a person accepts, and never before.
        if (p.change_to?.newSub) await createSubcategory(c, p.change_to.newSub, who);
        if (p.change_to?.newFact) await createFact(c, p.change_to.newFact, who);
        await subExists(c, sub);
        return { decision: null, active: true, targets: [{ sub, primary: true, condition }], rule: before.rule };
      },
    });
    if (p.change_to?.fact) {
      await query(`insert into taxonomy_label_carries (namespace, key, attribute_key, yesno) values ($1, $2, $3, true)
                   on conflict do nothing`, [NS, p.word, p.change_to.fact]);
      forgetAttributes();
    }
    return out;
  }
  throw bad(`${p.action} cannot be carried out from here; choose where it goes.`);
}

/**
 * Make a subcategory a proposal or the picker names, if it is not already
 * there. Every drawer has a bar the moment it exists (owner, 21 Sep 2026), so
 * it inherits one in the same transaction, and the addition is a change.
 */
export async function createSubcategory(c, { key, label, category }, who) {
  const { rows: [had] } = await c.query('select key, active from shelf_subcategories where key = $1', [key]);
  if (had?.active) return false;
  const { rows: [cat] } = await c.query('select key from shelf_categories where key = $1 and active', [category]);
  if (!cat) throw bad(`${category} is not one of our categories.`);
  await c.query(
    `insert into shelf_subcategories (category_key, key, label, position, seeded, active)
     values ($1, $2, $3, 100, false, true)
     on conflict (key) do update set active = true, label = excluded.label, category_key = excluded.category_key, updated_at = now()`,
    [category, key, label]);
  await c.query(
    `insert into shelf_rules (scope, subject, subject_label, weights, subcategory, reason, taught_by, seeded, labels)
     values ('ours', $1, $2, '{}'::jsonb, $1, $3, $4, false, $5) on conflict (scope, subject) do nothing`,
    [key, label, `Said in our words: every provider word pointing at ${label} reaches this.`, who, [key]]);
  await inheritBar(key, c);
  await logChange({ client: c, who, area: 'Categories', what: `Subcategory added · ${label}`, before: '—', after: `Active › ${label}`, subjectType: 'subcategory', subjectId: key });
  return true;
}

/** Make a yes/no fact a proposal names, if it is not already one of ours. */
export async function createFact(c, { key, label }, who) {
  const { rows: [had] } = await c.query('select key from place_attributes where key = $1', [key]);
  if (had) return false;
  await c.query(
    `insert into place_attributes (key, label, kind, position, active) values ($1, $2, 'yesno', 200, true)`, [key, label]);
  await logChange({ client: c, who, area: 'Facts', what: `Fact added · ${label}`, before: '—', after: 'Yes or no', subjectType: 'fact', subjectId: key });
  return true;
}

/**
 * Undo a decision: the word goes back to exactly what it was, the proposal it
 * answered reopens, and the change is marked undone. Only the latest live
 * decision on a word can be undone — undoing an older one would put back a
 * state the newer decision was made against.
 */
export async function undo({ id, who }) {
  const out = await withTransaction(async (c) => {
    const { rows: [d] } = await c.query('select * from word_decisions where id = $1 for update', [id]);
    if (!d) throw missing('No such decision.');
    if (d.undone_at) throw bad('That decision has already been undone.');
    const { rows: [newer] } = await c.query(
      // Compared in SQL: a timestamp read into JavaScript loses its
      // microseconds, and the decision would then find itself "later".
      `select id from word_decisions where namespace = $1 and word = $2 and undone_at is null and id <> $3
          and at > (select at from word_decisions where id = $3) limit 1`,
      [d.namespace, d.word, d.id]);
    if (newer) throw bad(`A later decision on ${d.word} stands; undo that one first.`);
    if (d.kind !== 'Kept') {
      await snapshot(c, d.word);
      await apply(c, d.word, {
        decision: d.before.decision, active: d.before.active,
        targets: d.before.targets ?? [], rule: d.before.rule,
      }, who);
    }
    await c.query('update word_decisions set undone_at = now(), undone_by = $2 where id = $1', [id, who]);
    if (d.proposal_id) {
      await c.query(`update word_proposals set state = 'open', decided_at = null, decided_by = null where id = $1`, [d.proposal_id]);
    }
    const { rows: [ch] } = await c.query(
      `select id from bo_changes where area = 'Mapping' and undo->>'id' = $1 and undone_at is null`, [id]);
    if (ch) await markUndone({ client: c, id: ch.id, who });
    return { undone: id, word: d.word };
  });
  forgetAll();
  return out;
}
