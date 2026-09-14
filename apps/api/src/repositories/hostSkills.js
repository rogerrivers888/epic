/**
 * The host-skills vocabularies, and the resolver over them.
 *
 * Brief: "Epic Host Skills — Claude Code" §5 and §7, 13 September 2026.
 *
 * **No external call sits in the host's typing path.** Suggestions come from
 * these tables and nothing else. Wikimedia carries no availability guarantee
 * and ESCO publishes no SLA; a host who hits a spinner mid-sentence abandons
 * the offer, and the wizard is already the riskiest screen in the module. A few
 * thousand rows fit in Postgres and change weekly at most, so the shape is:
 * seed and cache at build time, resolve locally at runtime, call outward only
 * in the back office. If a suggestion is ever slow the fix is an index, not a
 * cache of a remote call.
 *
 * **The resolver, in order** (§7): alias match on the normalised wording, then
 * trigram similarity ranked, then no match — which stores the wording, raises a
 * proposal and lets the offer publish.
 *
 * The brief writes the first pass as two — exact on the key, then alias — and
 * this is one, because every canonical row is given a self-alias at boot
 * (`ensureAliases`). That keeps a single normaliser, in JavaScript, rather than
 * a second one in SQL that would drift from it; and a canonical label, a
 * seeded alternative and a merge survivor then all resolve down the same path,
 * which is the path that gets exercised.
 *
 * Trigram matching is not assumed. `pg_trgm` needs rights an ordinary role may
 * not hold on a managed database, so this asks once and falls back to prefix
 * and substring matching, which is worse at typos and fine at everything else.
 */

import { query, withTransaction } from '../db.js';
import { FACET_KINDS, TAG_CAP, categoryForPassion, categoryFrom, keyFor, normalise, passionsForCategory } from '../domain/hostSkills.js';

const table = (vocab) => (vocab === 'facet' ? 'host_facets' : 'host_skill_tags');

/**
 * Run inside a transaction when one is handed in, and on its own when not.
 *
 * Approving a proposal is five writes — the row, two aliases, every offer
 * repointed, the decision — and a failure part-way through left the proposal
 * permanently not-open with nothing to show for it, which is the one state a
 * queue cannot recover from (Codex, 13 Sep 2026). The same functions serve both
 * callers; the transaction is the route's to open.
 */
const on = (client) => (client ? (t, p) => client.query(t, p) : query);
export { withTransaction };

// ---------------------------------------------------------------------------
// is trigram matching available?
// ---------------------------------------------------------------------------
let trigram = null;
export async function hasTrigram() {
  if (trigram !== null) return trigram;
  try {
    const { rows } = await query("select 1 from pg_extension where extname = 'pg_trgm'");
    trigram = rows.length > 0;
  } catch { trigram = false; }
  return trigram;
}

// ---------------------------------------------------------------------------
// the self-aliases
// ---------------------------------------------------------------------------
/**
 * Every canonical label resolves to itself.
 *
 * Run at boot and after any label change. Seeded keys were written by hand —
 * `ammonites`, `churches` — and do not all equal the normalisation of their own
 * label, which is exactly the drift this closes.
 */
export async function ensureAliases() {
  for (const vocab of ['tag', 'facet']) {
    const { rows } = await query(`select key, label from ${table(vocab)}`);
    const values = [];
    const params = [];
    for (const r of rows) {
      const norm = normalise(r.label);
      if (!norm) continue;
      params.push(vocab, norm, r.key, r.label);
      values.push(`($${params.length - 3}, $${params.length - 2}, $${params.length - 1}, $${params.length})`);
    }
    if (!values.length) continue;
    // `do nothing`, never `do update`: a merge may already have pointed this
    // wording somewhere else on purpose, and boot must not undo an
    // administrator's decision.
    await query(
      `insert into host_skill_aliases (vocab, norm, target_key, raw) values ${values.join(', ')}
       on conflict (vocab, norm) do nothing`, params,
    );
  }
}

// ---------------------------------------------------------------------------
// the curated lists
// ---------------------------------------------------------------------------
/**
 * The label a write should carry when the caller did not name one.
 *
 * Every one of these tables upserts, and Postgres checks NOT NULL on the insert
 * *before* it notices the conflict — so a partial save of an existing row ("set
 * this QID", "switch this off") failed on `label` even though the update branch
 * would never have touched it. The row's own label stands in; a genuinely new
 * row still has to be given one.
 */
/** One field under either spelling, or null when the caller named neither. */
const pick = (o, camel, snake = camel) => o?.[camel] ?? o?.[snake] ?? null;

async function labelFor(table_, key, given, client) {
  if (given != null) return given;
  const { rows } = await on(client)(`select label from ${table_} where key = $1`, [key]);
  return rows[0]?.label ?? null;
}

/**
 * The browse row.
 *
 * `counts` is off by default and on only where a number is drawn. The
 * type-ahead asks for these on every debounced keystroke — it is the one query
 * in the whole feature that has to stay under 50ms — and counting meant reading
 * every offer in the estate to label a suggestion (Codex, 14 Sep 2026).
 */
export async function categories({ all = false, counts = false } = {}) {
  const { rows } = await query(
    `select c.* from host_categories c ${all ? '' : 'where c.active'} order by c.position, c.key`,
  );
  return counts ? withCounts(rows, 'category_key') : rows;
}

export async function formats({ all = false, counts = false } = {}) {
  const { rows } = await query(
    `select f.* from host_formats f ${all ? '' : 'where f.active'} order by f.position, f.key`,
  );
  return counts ? withCounts(rows, 'format_key') : rows;
}

/**
 * Two counts against each row, because two screens mean different things by
 * "offers".
 *
 * The back office needs every one, drafts included, or "2 offers still carry
 * this" would be wrong and a value in use could be deleted. A guest may only be
 * told about listings they could actually open.
 *
 * And a category counts the offers filed under the **old single word** as well,
 * using the same map the filter uses — otherwise a bucket reads "0 people" and
 * then opens onto a list of them (Codex, 14 Sep 2026). Folded in JavaScript
 * rather than in SQL because the map is Epic's own and belongs in one place.
 */
async function withCounts(rows, column) {
  const { rows: offers } = await query(
    `select ${column} as key, category, state, visibility from host_offers`,
  );
  const all = new Map();
  const pub = new Map();
  const bump = (map, key) => { if (key) map.set(key, (map.get(key) ?? 0) + 1); };
  for (const o of offers) {
    const key = o.key ?? (column === 'category_key' ? categoryForPassion(o.category) : null);
    bump(all, key);
    if (['live', 'paused'].includes(o.state) && o.visibility === 'public') bump(pub, key);
  }
  return rows.map((r) => ({ ...r, offers: all.get(r.key) ?? 0, public_offers: pub.get(r.key) ?? 0 }));
}

export async function saveCategory({ key, label, blurb, icon, position, active }) {
  const name = await labelFor('host_categories', key, label);
  const { rows } = await query(
    `insert into host_categories (key, label, blurb, icon, position, active)
     values ($1, $2, $3, $4, coalesce($5, 0), coalesce($6, true))
     on conflict (key) do update set
       label = coalesce($2, host_categories.label),
       blurb = coalesce($3, host_categories.blurb),
       icon = coalesce($4, host_categories.icon),
       position = coalesce($5, host_categories.position),
       active = coalesce($6, host_categories.active),
       updated_at = now()
     returning *`,
    [key, name, blurb ?? null, icon ?? null, position ?? null, active ?? null],
  );
  return rows[0];
}

export async function saveFormat({ key, label, blurb, icon, venueless, position, active }) {
  const name = await labelFor('host_formats', key, label);
  const { rows } = await query(
    `insert into host_formats (key, label, blurb, icon, venueless, position, active)
     values ($1, $2, $3, $4, coalesce($5, false), coalesce($6, 0), coalesce($7, true))
     on conflict (key) do update set
       label = coalesce($2, host_formats.label),
       blurb = coalesce($3, host_formats.blurb),
       icon = coalesce($4, host_formats.icon),
       venueless = coalesce($5, host_formats.venueless),
       position = coalesce($6, host_formats.position),
       active = coalesce($7, host_formats.active),
       updated_at = now()
     returning *`,
    [key, name, blurb ?? null, icon ?? null, venueless ?? null, position ?? null, active ?? null],
  );
  return rows[0];
}

/**
 * What would be orphaned by removing this value. Refusal reads better with a
 * number.
 *
 * A category is used by its tags as well as by its offers: `on delete set null`
 * would strip the bucket from every tag under it, and a tag with no bucket
 * cannot infer a category for the offers carrying it — so they could not be
 * published at all (Codex, 13 Sep 2026). Both counts come back, and the route
 * says which.
 */
export async function offersUsing(column, key) {
  const col = column === 'format' ? 'format_key' : 'category_key';
  const { rows } = await query(`select count(*)::int as n from host_offers where ${col} = $1`, [key]);
  if (column === 'format') return { offers: rows[0].n, tags: 0 };
  // …and the offers still filed under the old word that this bucket collects,
  // which discovery shows here and which would vanish from it (Codex,
  // 14 Sep 2026).
  const legacy = passionsForCategory(key);
  if (legacy.length) {
    const { rows: old_ } = await query(
      'select count(*)::int as n from host_offers where category_key is null and category = any($1)', [legacy],
    );
    rows[0].n += old_[0].n;
  }
  const { rows: t } = await query('select count(*)::int as n from host_skill_tags where category_key = $1', [key]);
  return { offers: rows[0].n, tags: t[0].n };
}

export async function removeCategory(key) { await query('delete from host_categories where key = $1', [key]); }
export async function removeFormat(key) { await query('delete from host_formats where key = $1', [key]); }

// ---------------------------------------------------------------------------
// tags and facets
// ---------------------------------------------------------------------------
/** Every tag or facet, for the back office. The screen filters; the query does not paginate a few thousand rows. */
export async function listVocabulary(vocab, { all = false, q = null, limit = 400, offset = 0 } = {}) {
  const t = table(vocab);
  const where = [];
  const params = [];
  if (!all) where.push('v.active');
  if (q) { params.push(`%${normalise(q)}%`); where.push(`(replace(v.key, '-', ' ') like $${params.length} or lower(v.label) like $${params.length})`); }
  params.push(limit, offset);
  const { rows } = await query(
    `select v.*, p.label as parent_label,
            (select count(*) from host_offer_skills s where s.vocab = $${params.length + 1} and s.target_key = v.key) as offers
       from ${t} v
       left join ${t} p on p.key = v.parent_key
      ${where.length ? `where ${where.join(' and ')}` : ''}
      order by v.label
      limit $${params.length - 1} offset $${params.length}`,
    [...params, vocab],
  );
  return rows;
}

export async function byKeys(vocab, keys, client) {
  if (!keys?.length) return [];
  const t = table(vocab);
  // The parent comes with it: every screen that draws one of these rows draws
  // its breadcrumb underneath, and a second query for one word is a waste.
  const { rows } = await on(client)(
    `select v.*, p.label as parent_label from ${t} v left join ${t} p on p.key = v.parent_key where v.key = any($1)`,
    [keys],
  );
  return rows;
}

export async function saveTag({ key, label, parentKey, categoryKey, source, externalId, note, active, seeded = false }, client) {
  const name = await labelFor('host_skill_tags', key, label, client);
  const { rows } = await on(client)(
    `insert into host_skill_tags (key, label, parent_key, category_key, source, external_id, note, active, seeded)
     values ($1, $2, $3, $4, $5, $6, $7, coalesce($8, true), $9)
     on conflict (key) do update set
       label = coalesce($2, host_skill_tags.label),
       parent_key = case when $10 then $3 else host_skill_tags.parent_key end,
       category_key = coalesce($4, host_skill_tags.category_key),
       -- coalesce cannot tell "left alone" from "cleared", and clearing is
       -- exactly what an administrator does when the QID turns out to be the
       -- occupation rather than the activity. So these follow the parent: a
       -- flag says whether the caller named the field at all (Codex, 13 Sep 2026).
       source = case when $11 then $5 else host_skill_tags.source end,
       external_id = case when $12 then $6 else host_skill_tags.external_id end,
       note = case when $13 then $7 else host_skill_tags.note end,
       active = coalesce($8, host_skill_tags.active),
       updated_at = now()
     returning *`,
    [key, name, parentKey ?? null, categoryKey ?? null, source ?? null, externalId ?? null, note ?? null,
     active ?? null, seeded, parentKey !== undefined, source !== undefined, externalId !== undefined, note !== undefined],
  );
  return rows[0];
}

export async function saveFacet({ key, kind, label, parentKey, lat, lng, source, externalId, note, active, seeded = false }, client) {
  const name = await labelFor('host_facets', key, label, client);
  const { rows } = await on(client)(
    `insert into host_facets (key, kind, label, parent_key, lat, lng, source, external_id, note, active, seeded)
     values ($1, coalesce($2, 'subject'), $3, $4, $5, $6, $7, $8, $9, coalesce($10, true), $11)
     on conflict (key) do update set
       kind = coalesce($2, host_facets.kind),
       label = coalesce($3, host_facets.label),
       parent_key = case when $12 then $4 else host_facets.parent_key end,
       lat = coalesce($5, host_facets.lat),
       lng = coalesce($6, host_facets.lng),
       source = case when $13 then $7 else host_facets.source end,
       external_id = case when $14 then $8 else host_facets.external_id end,
       note = case when $15 then $9 else host_facets.note end,
       active = coalesce($10, host_facets.active),
       updated_at = now()
     returning *`,
    [key, kind ?? null, name, parentKey ?? null, lat ?? null, lng ?? null, source ?? null, externalId ?? null,
     note ?? null, active ?? null, seeded, parentKey !== undefined, source !== undefined, externalId !== undefined, note !== undefined],
  );
  return rows[0];
}

/**
 * How many hosts carry each key.
 *
 * Hosts, not offers: "34 hosts" is what the design says and what a host reads
 * as company. Only live offers count — a draft nobody can book is not company.
 */
export async function hostCounts(vocab, keys) {
  if (!keys?.length) return {};
  const { rows } = await query(
    // Public only. This number is drawn on a logged-out screen, so counting a
    // link-only or invitation-only offer would both inflate it and let a
    // stranger infer that private hosting of that kind exists (Codex,
    // 13 Sep 2026).
    `select s.target_key as key, count(distinct o.host_id)::int as n
       from host_offer_skills s
       join host_offers o on o.id = s.offer_id and o.state in ('live', 'paused') and o.visibility = 'public'
      where s.vocab = $1 and s.target_key = any($2)
      group by s.target_key`,
    [vocab, keys],
  );
  return Object.fromEntries(rows.map((r) => [r.key, r.n]));
}

// ---------------------------------------------------------------------------
// the resolver
// ---------------------------------------------------------------------------
/**
 * How close a wording has to be to be taken as the same word, and how far clear
 * of the next candidate.
 *
 * Both are far stricter than the type-ahead's, because a suggestion is offered
 * and this is *taken*: a wrong guess files somebody's offer under a word they
 * did not choose, with nothing on screen to say so. Below either, no match is
 * the honest answer and the queue is where it goes.
 */
const RESOLVE_FLOOR = 0.55;
const RESOLVE_CLEAR = 0.12;
/**
 * A tag is only offered while the bucket it reads under is.
 *
 * Switching a category off takes it out of the browse row, so a tag still
 * pointing at it would let a host publish into a bucket a guest cannot see
 * (Codex, 14 Sep 2026). A tag with no bucket at all is a different case and is
 * still offered; it is the back office's to file.
 */
/** Is this bucket still one a guest can browse? */
async function categoryLive(key) {
  const { rows } = await query('select 1 from host_categories where key = $1 and active', [key]);
  return rows.length > 0;
}

const liveIn = (vocab, alias = 'v') => (vocab === 'facet' ? `${alias}.active` : `${alias}.active and (${alias}.category_key is null
        or exists (select 1 from host_categories c where c.key = ${alias}.category_key and c.active))`);

/**
 * One wording in, at most one canonical row out.
 *
 * Pass one is the alias table, which holds every canonical label, every seeded
 * alternative and every merge survivor. Pass two is similarity, ranked, over a
 * threshold. Pass three is nothing, and nothing is a legitimate answer: the
 * caller stores the wording, raises a proposal and lets the offer publish.
 */
export async function resolveOne(vocab, raw) {
  const norm = normalise(raw);
  if (!norm) return null;
  // Pass one: the alias table, which holds every canonical label, every seeded
  // alternative and every merge survivor.
  const { rows } = await query(
    `select v.* from host_skill_aliases a
       join ${table(vocab)} v on v.key = a.target_key
      where a.vocab = $1 and a.norm = $2 and ${liveIn(vocab)}`,
    [vocab, norm],
  );
  if (rows[0]) return rows[0];

  /**
   * Pass two: similarity, and only when it is barely in doubt.
   *
   * A host typing "sourdogh" should meet *Sourdough* rather than start a
   * proposal nobody needs (Codex, 13 Sep 2026). The threshold is much higher
   * than the one the type-ahead uses, because a suggestion is offered and this
   * one is *taken*: a wrong guess here files somebody's offer under the wrong
   * word with nothing on screen to say so. Below it, no match is the honest
   * answer and the queue is where it goes.
   */
  if (!(await hasTrigram())) return null;
  const { rows: near } = await query(
    `select v.*, max(similarity(a.norm, $2)) as score
       from host_skill_aliases a
       join ${table(vocab)} v on v.key = a.target_key and ${liveIn(vocab)}
      where a.vocab = $1 and similarity(a.norm, $2) > $3
      group by v.key
      order by score desc, v.seen_count desc
      limit 2`,
    [vocab, norm, RESOLVE_FLOOR],
  );
  if (!near.length) return null;
  // Close *and* unambiguous. A bare threshold is not enough: "fossil hunting"
  // and "fossil casting" score 0.5 against each other, which is the same
  // neighbourhood a one-letter typo lives in. Requiring the winner to be clear
  // of the runner-up is what tells "they meant this and mistyped it" from "two
  // real words that look alike".
  const [best, second] = near;
  if (second && Number(best.score) - Number(second.score) < RESOLVE_CLEAR) return null;
  return best;
}

/**
 * What to show as the host types, from the second or third character.
 *
 * Ranked: what starts with what they typed, then what contains it, then what is
 * merely similar. `seen_count` breaks ties, so the words other hosts actually
 * use rise. Inactive rows are never suggested and existing offers keep theirs.
 *
 * The ranking is done in SQL and the cut after it. `distinct on` has to order
 * by the key it is distinct on, so ranking in JavaScript over a truncated list
 * would silently drop the best matches once the vocabulary passes a couple of
 * hundred rows — which is well inside where it is meant to end up (Codex,
 * 13 Sep 2026).
 */
export async function suggest(vocab, raw, { limit = 8, categoryFirst = null } = {}) {
  const norm = normalise(raw);
  if (norm.length < 2) return [];
  const t = table(vocab);
  const trig = await hasTrigram();
  const match = trig ? `(a.norm like $2 or similarity(a.norm, $1) > 0.42)` : `a.norm like $2`;
  const score = trig ? `similarity(a.norm, $1)` : `0`;
  // A facet has no browse category — `host_facets` has no such column — so the
  // preference is only written into the query for a tag. Postgres resolves an
  // ORDER BY expression whether or not its guard can ever be true, so a null
  // parameter would not have saved it (Codex, 14 Sep 2026).
  const prefer = vocab === 'tag' && categoryFirst
    ? `case when category_key = $5 then 0 else 1 end,`
    : '';
  const params = [norm, `%${norm}%`, `${norm}%`, vocab];
  if (prefer) params.push(categoryFirst);
  params.push(limit);
  const { rows } = await query(
    `with matched as (
       select distinct on (v.key) v.*, p.label as parent_label, a.norm as matched,
              case when a.norm = $1 then 0 when a.norm like $3 then 1 when a.norm like $2 then 2 else 3 end as rank,
              ${score} as score
         from host_skill_aliases a
         join ${t} v on v.key = a.target_key and ${liveIn(vocab)}
         left join ${t} p on p.key = v.parent_key
        where a.vocab = $4 and ${match}
        order by v.key, rank, ${score} desc
     )
     select * from matched
      order by rank, ${prefer} score desc, seen_count desc, label
      limit $${params.length}`,
    params,
  );
  return rows;
}

/**
 * The named place an offer happens inside, if there is one.
 *
 * "You are in Charmouth — add **Jurassic Coast**?" Inferred from where the
 * offer happens and offered as a suggestion with Add / Not now, never filled in
 * silently: every field the host does not have to think about is a field that
 * ends up correct, but a place facet is a claim about their expertise and the
 * claim is theirs to make.
 */
export async function placeNear(lat, lng, { km = 60 } = {}) {
  if (lat == null || lng == null) return null;
  const { rows } = await query(
    `select f.*, sqrt(power((f.lat - $1) * 111.32, 2) + power((f.lng - $2) * 111.32 * cos(radians($1)), 2)) as km
       from host_facets f
      where f.active and f.kind = 'place' and f.lat is not null
      order by km asc limit 1`,
    [lat, lng],
  );
  const found = rows[0];
  return found && Number(found.km) <= km ? found : null;
}

/** The three closest existing rows, for the queue's merge targets. */
export async function closest(vocab, raw, { limit = 3, exclude = [] } = {}) {
  const found = await suggest(vocab, raw, { limit: limit + exclude.length + 2 });
  return found.filter((r) => !exclude.includes(r.key)).slice(0, limit);
}

// ---------------------------------------------------------------------------
// what an offer carries
// ---------------------------------------------------------------------------
export async function offerSkills(offerId, client) {
  const { rows } = await on(client)(
    `select s.*, t.label as tag_label, t.parent_key, t.category_key, t.source, t.external_id,
            f.label as facet_label, f.kind as facet_kind
       from host_offer_skills s
       left join host_skill_tags t on s.vocab = 'tag' and t.key = s.target_key
       left join host_facets f on s.vocab = 'facet' and f.key = s.target_key
      where s.offer_id = $1
      order by s.vocab, s.position`,
    [offerId],
  );
  return rows;
}

/**
 * Replace what an offer carries in one vocabulary.
 *
 * Whole-list, not add-and-remove, because the order is the host's answer: the
 * first tag is what shows on the card, and a partial update cannot express a
 * drag. Unresolved wordings keep their place in the order beside resolved ones.
 */
export async function setOfferSkills(offerId, vocab, items) {
  const cap = vocab === 'facet' ? 2 : TAG_CAP;
  const seen = new Set();
  const rows = [];
  /**
   * What this offer carried a moment ago, by wording.
   *
   * It does two jobs. It decides what is *new*, so a whole-list save does not
   * count every tag again. And it keeps a **deactivated** value attached: a
   * switched-off tag is still offered to nobody but must stay on the offers
   * already carrying it, and without this the next save of that offer — a
   * reorder, a seventh word — would quietly turn it into unresolved wording
   * (Codex, 13 Sep 2026).
   *
   * Read twice: once here, to resolve the wordings, and again under the lock
   * below, because two identical saves overlapping would otherwise both read
   * the list before either had written and both count the same word as new
   * (Codex, 14 Sep 2026).
   */
  const { rows: before } = await query(
    'select norm, target_key from host_offer_skills where offer_id = $1 and vocab = $2', [offerId, vocab],
  );
  const had = new Map(before.map((r) => [r.norm, r.target_key]));

  for (const item of items ?? []) {
    const raw = String(item?.raw ?? item?.label ?? '').trim().slice(0, 80);
    if (!raw) continue;
    const norm = normalise(raw);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    // A key the caller already resolved is honoured only if it is real and
    // active; otherwise this resolves the wording itself. A client must not be
    // able to point an offer at a row by naming it.
    let target = null;
    if (item?.key) {
      const [found] = await byKeys(vocab, [item.key]);
      /**
       * Offered, or already this offer's.
       *
       * "Offered" is the same test the resolver applies — active, and under a
       * bucket that is still in the browse row — because a stale client holding
       * a key from before a category was switched off would otherwise file an
       * offer into a bucket no guest can see (Codex, 14 Sep 2026). A value
       * switched off *since they chose it* is a different case and stays.
       */
      const offered = found?.active && (vocab === 'facet' || !found.category_key || await categoryLive(found.category_key));
      if (found && (offered || had.get(norm) === found.key)) target = found.key;
    }
    /**
     * `asIs` is the host having tapped "Add “foss” as it is" with the
     * suggestions in front of them. Running the fuzzy pass over that would
     * attach their word to whichever tag it nearly matched and quietly overrule
     * the one thing the design insists on: never a nudge to pick something
     * broader (Codex, 14 Sep 2026).
     */
    /**
     * A wording this offer already carried *unresolved* stays unresolved.
     *
     * `asIs` only travels on the request that set it — reload the offer and the
     * pending chip comes back without it, so the next save (adding a second
     * tag, dragging one to the front) would run the fuzzy pass over a word the
     * host had explicitly declined to match (Codex, 14 Sep 2026). The row
     * itself is the record of that decision: it is here, and it has no key.
     */
    const declined = had.has(norm) && had.get(norm) == null;
    if (!target && !item?.asIs && !declined) target = (await resolveOne(vocab, raw))?.key ?? null;
    // The fallback that keeps a deactivated value attached must not undo that
    // either: a host who says "as it is" is answering, not omitting.
    if (!target && !item?.asIs && had.get(norm)) target = had.get(norm);
    rows.push({ raw, norm, target, position: rows.length });
    if (rows.length >= cap) break;
  }
  /**
   * The replacement is one act.
   *
   * The list is deleted and rebuilt, so two saves racing — two tabs, or a drag
   * firing while a removal is in flight — could interleave a delete between the
   * other's delete and its inserts and leave a list neither of them sent. The
   * row lock on the offer serialises them; the transaction means a failure
   * part-way leaves the old list standing rather than half a new one (Codex,
   * 14 Sep 2026).
   */
  await withTransaction(async (client) => {
    await client.query('select id from host_offers where id = $1 for update', [offerId]);
    // Now that nobody else can be mid-save: what was actually there, and so
    // what is actually new.
    const { rows: held } = await client.query(
      'select norm from host_offer_skills where offer_id = $1 and vocab = $2', [offerId, vocab],
    );
    const already = new Set(held.map((r) => r.norm));
    const fresh = rows.filter((r) => !already.has(r.norm));
    await client.query('delete from host_offer_skills where offer_id = $1 and vocab = $2', [offerId, vocab]);
    for (const r of rows) {
      await client.query(
        `insert into host_offer_skills (offer_id, vocab, norm, raw, target_key, position)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (offer_id, vocab, norm) do update set raw = $4, target_key = $5, position = $6`,
        [offerId, vocab, r.norm, r.raw, r.target, r.position],
      );
    }
    // Count the newly resolved ones, so the vocabulary is ordered by what is used.
    const used = fresh.map((r) => r.target).filter(Boolean);
    if (used.length) await client.query(`update ${table(vocab)} set seen_count = seen_count + 1 where key = any($1)`, [used]);
    // …and raise a proposal for each new one that resolved to nothing.
    for (const r of fresh.filter((x) => !x.target)) await raiseProposal({ vocab, norm: r.norm, raw: r.raw, offerId }, client);
  });
  return rows;
}

/**
 * What a set of offers carry, in one query.
 *
 * The card, the grid, the profile and the tag page all draw chips, and a query
 * per offer would make the grid the slowest screen in the app for the sake of
 * two words on each card.
 */
export async function skillsForOffers(ids) {
  if (!ids?.length) return {};
  const { rows } = await query(
    `select s.offer_id, s.vocab, s.position, s.raw, s.target_key,
            coalesce(t.label, f.label) as label, f.kind as facet_kind, t.category_key
       from host_offer_skills s
       left join host_skill_tags t on s.vocab = 'tag' and t.key = s.target_key
       left join host_facets f on s.vocab = 'facet' and f.key = s.target_key
      where s.offer_id = any($1)
      order by s.position`,
    [ids],
  );
  const out = {};
  for (const r of rows) {
    const bucket = (out[r.offer_id] ??= { tags: [], facets: [] });
    const item = {
      key: r.target_key, raw: r.raw,
      // A pending word shows the host's own wording, because that is the only
      // honest thing we have. It is never presented to a guest as canonical.
      label: r.label ?? r.raw,
      pending: !r.target_key,
      kind: r.facet_kind ?? null,
      categoryKey: r.category_key ?? null,
    };
    (r.vocab === 'facet' ? bucket.facets : bucket.tags).push(item);
  }
  return out;
}

/**
 * The same tags and facets on a copy of an offer.
 *
 * "Add another date" clones a live listing, so without this the copy went up
 * public with no category, no format and no tags — invisible to the browse row
 * and every tag page, and never passing a publication check because a clone
 * does not go through one (Codex, 13 Sep 2026).
 */
export async function copyOfferSkills(fromOfferId, toOfferId, client) {
  await on(client)(
    `insert into host_offer_skills (offer_id, vocab, norm, raw, target_key, position)
     select $2, vocab, norm, raw, target_key, position from host_offer_skills where offer_id = $1
     on conflict (offer_id, vocab, norm) do nothing`,
    [fromOfferId, toOfferId],
  );
}

/**
 * Every tag a host's live offers carry, most-used first.
 *
 * Derived, never stored (owner, 13 Sep 2026). Tags belong to the offer, not the
 * person — the same host is *Fossils* on one offer and *Sourdough* on another —
 * so a profile shows the range rather than flattening it, and nobody can claim
 * an expertise no offer evidences.
 */
export async function tagsForHost(hostId) {
  const { rows } = await query(
    // `visibility = 'public'` for the same reason the profile's offer list has
    // it: an invitation-only offer is not shown, and neither is the fact that
    // it exists. Without this a private booking's subject would appear on a
    // public page as something this host does (Codex, 13 Sep 2026).
    `select t.*, count(*)::int as offers
       from host_offer_skills s
       join host_offers o on o.id = s.offer_id and o.host_id = $1
        and o.state in ('live', 'paused') and o.visibility = 'public'
       join host_skill_tags t on t.key = s.target_key
      where s.vocab = 'tag'
      group by t.key
      order by count(*) desc, min(s.position), t.label`,
    [hostId],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// the review queue
// ---------------------------------------------------------------------------
/**
 * Identical wording increments rather than repeating — "this is the whole
 * ballgame" (§3). A wording already decided never raises a new proposal, which
 * is why a rejected row is kept rather than deleted.
 */
export async function raiseProposal({ vocab, norm, raw, offerId }, client) {
  const { rows } = await on(client)(
    `insert into host_skill_proposals (vocab, norm, raw, first_offer)
     values ($1, $2, $3, $4)
     on conflict (vocab, norm) do update set
       count = host_skill_proposals.count + 1,
       updated_at = now()
     returning *`,
    [vocab, norm, raw, offerId ?? null],
  );
  return rows[0];
}

export async function proposals({ state = 'open', limit = 100 } = {}) {
  const { rows } = await query(
    `select p.*,
            (select count(*)::int from host_offer_skills s
              where s.vocab = p.vocab and s.norm = p.norm) as offers
       from host_skill_proposals p
      where ($1::text is null or p.state = $1)
      order by (p.state = 'open') desc, p.count desc, p.created_at
      limit $2`,
    [state === 'all' ? null : state, limit],
  );
  return rows;
}

/** The offers that produced a proposal, reachable from the row. */
export async function proposalOffers(vocab, norm) {
  const { rows } = await query(
    `select o.id, o.title, o.state, h.id as host_id, h.name as host_name, s.raw, s.created_at
       from host_offer_skills s
       join host_offers o on o.id = s.offer_id
       join hosts h on h.id = o.host_id
      where s.vocab = $1 and s.norm = $2
      order by s.created_at desc
      limit 50`,
    [vocab, norm],
  );
  return rows;
}

export async function proposalById(id) {
  const { rows } = await query('select * from host_skill_proposals where id = $1', [id]);
  return rows[0] ?? null;
}

/**
 * Decide one, and only while it is still open.
 *
 * `state = 'open'` in the where clause is the guard. Approving already writes
 * an alias and repoints every offer carrying the wording; a retry, or a second
 * administrator on a screen that has gone stale, would otherwise turn that into
 * a merge or a rejection afterwards and leave the recorded decision and the
 * canonical mapping disagreeing (Codex, 13 Sep 2026). Nothing comes back when
 * it has already been decided, and the route says so.
 */
export async function decideProposal(id, { state, targetKey, note, by }, client) {
  const { rows } = await on(client)(
    `update host_skill_proposals
        set state = $2, target_key = $3, note = coalesce($4, note), decided_by = $5, decided_at = now(), updated_at = now()
      where id = $1 and state = 'open' returning *`,
    [id, state, targetKey ?? null, note ?? null, by ?? null],
  );
  return rows[0] ?? null;
}

/** Every offer carrying this wording now points at the row it became. */
/**
 * Every offer carrying this wording now points at the row it became — and that
 * row is now a word in use.
 *
 * `seen_count` is only bumped when a wording resolves as it is typed, so a tag
 * the queue created would sit at zero however many offers carried it, and the
 * suggestions and the starters would rank it last: precisely the words the
 * queue has just promoted (Codex, 14 Sep 2026).
 */
export async function repoint(vocab, norm, targetKey, client) {
  const { rows: touched } = await on(client)(
    'update host_offer_skills set target_key = $3 where vocab = $1 and norm = $2 returning offer_id', [vocab, norm, targetKey],
  );
  /**
   * One offer, one row per canonical word.
   *
   * Uniqueness here is on the wording, not on what it resolves to, so an offer
   * that carried both *Fossil hunting* and a near-miss added "as it is" ends a
   * merge carrying the same tag twice: two chips, two of the six slots, and
   * that category counted twice when the bucket is derived (Codex, 14 Sep
   * 2026). The one the host put first is the one that stays.
   */
  if (touched.length) {
    await on(client)(
      `delete from host_offer_skills s
        where s.vocab = $1 and s.target_key = $2 and s.offer_id = any($3)
          and exists (select 1 from host_offer_skills k
                       where k.offer_id = s.offer_id and k.vocab = s.vocab and k.target_key = s.target_key
                         and (k.position < s.position or (k.position = s.position and k.norm < s.norm)))`,
      [vocab, targetKey, touched.map((r) => r.offer_id)],
    );
  }
  if (!touched.length) return [];
  await on(client)(`update ${table(vocab)} set seen_count = seen_count + $2 where key = $1`, [targetKey, touched.length]);
  // A facet moves nothing: the browse category is derived from tags alone, so
  // there is nothing to re-file and nothing to report (Codex, 14 Sep 2026).
  if (vocab !== 'tag') return [];
  return recomputeCategories(touched.map((r) => r.offer_id), targetKey, client);
}

/**
 * Re-file the offers a tag's own change affects.
 *
 * Two things call this. A word the queue resolves changes what its offers are
 * about; and so does an administrator moving an existing tag into a different
 * bucket — without which browse kept listing those offers where they used to
 * be, and a later save could mistake that stale value for a choice the host had
 * made (Codex, 14 Sep 2026).
 *
 * Only an **inferred** category is moved. One the host chose with Change is
 * theirs and is left where they put it, which is what comparing against the
 * derivation-without-this-tag says.
 */
export async function recomputeCategories(offerIds, tagKey, client, { wasCategory = null } = {}) {
  const moved = [];
  /**
   * A word the queue just resolved changes what its offers are about.
   *
   * An offer whose only tag was pending now has a browse category, and one that
   * already had a category may now derive a different one — the tie is broken
   * by the first tag, and that tag may be the one that has only just become
   * real. Without this both stay wrong until the host happens to edit their
   * tags again (Codex, 14 Sep 2026).
   *
   * Only an **inferred** category is moved. One the host chose with Change is
   * theirs, and is left exactly where they put it — which is what the
   * `category_key is distinct from` comparison against the old derivation says.
   */
  for (const offerId of offerIds ?? []) {
    const carried = await offerSkills(offerId, client);
    const tags = carried.filter((r) => r.vocab === 'tag' && r.target_key);
    const derived = categoryFrom(tags.map((r) => ({ categoryKey: r.category_key })));
    /**
     * What the tags would have derived a moment ago: this tag counting for what
     * it counted for then — nothing at all when it had only just stopped being
     * a pending word, or its old bucket when it has just been moved.
     *
     * Comparing against *that* is what tells an inferred category from one the
     * host chose. Dropping the tag out of the comparison instead looked like a
     * choice whenever it was the only tag, and the offer never moved (found by
     * testing, 14 Sep 2026).
     */
    const beforeThis = categoryFrom(tags.map((r) => ({
      categoryKey: r.target_key === tagKey ? wasCategory : r.category_key,
    })));
    const { rows: [offer] } = await on(client)('select category_key from host_offers where id = $1', [offerId]);
    const chosen = offer?.category_key && offer.category_key !== beforeThis;
    if (!chosen && derived && derived !== offer?.category_key) {
      await on(client)('update host_offers set category_key = $2, updated_at = now() where id = $1', [offerId, derived]);
      moved.push(offerId);
    }
  }
  // The caller re-checks the live ones: a category is what decides which
  // credentials are a condition, so a word moved into a gated bucket can take a
  // live listing somewhere its host does not qualify for. Policy belongs to the
  // route, not here.
  return moved;
}

/**
 * Every live public offer in these buckets, whoever hosts it.
 *
 * For the moment a credential stops being a badge and becomes a condition: the
 * offers already out there in that bucket are the ones the rule now applies to.
 */
export async function liveOffersIn(categoryKeys) {
  if (!categoryKeys?.length) return [];
  const { rows } = await query(
    `select * from host_offers
      where state = 'live' and visibility = 'public' and category_key = any($1)`,
    [categoryKeys],
  );
  return rows;
}

/** Every offer carrying a tag — for when the tag itself is re-filed. */
export async function offersWithTag(tagKey, client) {
  const { rows } = await on(client)(
    "select distinct offer_id from host_offer_skills where vocab = 'tag' and target_key = $1", [tagKey],
  );
  return rows.map((r) => r.offer_id);
}

/**
 * One wording resolving to one row.
 *
 * `steal` is the difference between a merge and a rename, and it matters.
 * **Merging** is somebody deciding on purpose that this wording now means the
 * survivor, so it takes the alias over. **Renaming** a tag must not: calling
 * another tag "Palaeontology" would quietly take that word off the row that has
 * it, and every search for it would land on the wrong one while the original
 * sat there unchanged (Codex, 14 Sep 2026). So a rename that collides does
 * nothing, and says so.
 *
 * Returns the row it landed on, or null when it stood aside.
 */
export async function addAlias(vocab, norm, targetKey, raw, client, { steal = false } = {}) {
  const { rows } = await on(client)(
    `insert into host_skill_aliases (vocab, norm, target_key, raw) values ($1, $2, $3, $4)
     on conflict (vocab, norm) do update set
       target_key = case when $5 or host_skill_aliases.target_key = $3 then $3 else host_skill_aliases.target_key end,
       raw = coalesce($4, host_skill_aliases.raw)
     returning *`,
    [vocab, norm, targetKey, raw ?? null, steal],
  );
  return rows[0]?.target_key === targetKey ? rows[0] : null;
}

export async function aliasesFor(vocab, targetKey) {
  const { rows } = await query(
    'select * from host_skill_aliases where vocab = $1 and target_key = $2 order by norm', [vocab, targetKey],
  );
  return rows;
}

export async function openCount() {
  const { rows } = await query(
    `select count(*)::int as n, min(created_at) as oldest from host_skill_proposals where state = 'open'`,
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// credentials
// ---------------------------------------------------------------------------
export async function credentialTypes({ all = false } = {}) {
  const { rows } = await query(
    `select * from host_credential_types ${all ? '' : 'where active'} order by position, key`,
  );
  return rows;
}

export async function saveCredentialType(t) {
  const name = await labelFor('host_credential_types', t.key, t.label);
  const { rows: [was] } = await query('select expires_months from host_credential_types where key = $1', [t.key]);
  const { rows } = await query(
    `insert into host_credential_types (key, label, note, host_types, evidence_required, gates_categories, expires_months, position, active)
     values ($1, $2, $3, coalesce($4, '{skill,meetups,expert}'::text[]), coalesce($5, true), coalesce($6, '{}'::text[]), $7, coalesce($8, 0), coalesce($9, true))
     on conflict (key) do update set
       label = coalesce($2, host_credential_types.label),
       note = coalesce($3, host_credential_types.note),
       host_types = coalesce($4, host_credential_types.host_types),
       evidence_required = coalesce($5, host_credential_types.evidence_required),
       gates_categories = coalesce($6, host_credential_types.gates_categories),
       -- Named or left alone, never blanked by a save that did not mention it:
       -- the admin screen toggles the active flag on its own, and that must not
       -- turn a three-year credential into one that never expires (Codex).
       expires_months = case when $10 then $7 else host_credential_types.expires_months end,
       position = coalesce($8, host_credential_types.position),
       active = coalesce($9, host_credential_types.active),
       updated_at = now()
     returning *`,
    // Both spellings, because the screen edits the row the API gave it — which
    // is snake_case, straight from Postgres — while the older callers write
    // camelCase. Reading only one meant every rule change was accepted and
    // silently dropped (Codex, 14 Sep 2026).
    [t.key, name, pick(t, 'note'), pick(t, 'hostTypes', 'host_types'), pick(t, 'evidenceRequired', 'evidence_required'),
     pick(t, 'gatesCategories', 'gates_categories'), pick(t, 'expiresMonths', 'expires_months'), pick(t, 'position'), pick(t, 'active'),
     t.expiresMonths !== undefined || t.expires_months !== undefined],
  );
  /**
   * A confirmation's date was worked out under the rule of the day, and every
   * check reads that stored date. So changing the rule has to change them:
   * turning a type from never-expires into twelve months otherwise left every
   * confirmation good for ever, and shortening one did nothing at all (Codex,
   * 14 Sep 2026). Measured from when it was confirmed, not from today, so
   * nobody is given back time they had already used.
   */
  const months = rows[0].expires_months ?? null;
  if (months !== (was?.expires_months ?? null)) {
    await query(
      months == null
        ? `update host_credentials set expires_on = null, updated_at = now() where type_key = $1 and state = 'confirmed'`
        : `update host_credentials
              set expires_on = (coalesce(confirmed_at, created_at) + ($2 || ' months')::interval)::date, updated_at = now()
            where type_key = $1 and state = 'confirmed'`,
      months == null ? [t.key] : [t.key, String(months)],
    );
  }
  return rows[0];
}

export async function credentialsFor(hostId) {
  const { rows } = await query(
    `select c.*, t.label, t.note, t.evidence_required, t.gates_categories
       from host_credentials c join host_credential_types t on t.key = c.type_key
      where c.host_id = $1 order by t.position, t.key`,
    [hostId],
  );
  return rows;
}

export async function claimCredential({ hostId, typeKey, reference, detail, state }) {
  const { rows } = await query(
    `insert into host_credentials (host_id, type_key, reference, detail, state)
     values ($1, $2, $3, $4, $5)
     on conflict (host_id, type_key) do update set
       reference = $3, detail = $4,
       -- Re-claiming a confirmed credential puts it back in the queue: the
       -- number changed, so what was checked is no longer what is claimed.
       state = $5, confirmed_at = null, decided_note = null, updated_at = now()
     returning *`,
    [hostId, typeKey, reference ?? null, detail ?? null, state],
  );
  return rows[0];
}

export async function removeCredential(hostId, typeKey) {
  await query('delete from host_credentials where host_id = $1 and type_key = $2', [hostId, typeKey]);
}

/**
 * Decide one, and only while it is still waiting.
 *
 * `state = 'pending'` in the where clause is the guard: a retry, or a second
 * tap from an admin screen that has gone stale, would otherwise re-run against
 * a row already confirmed — with no type loaded, so a null expiry — and quietly
 * turn a three-year credential into a permanent one (Codex, 13 Sep 2026).
 * Nothing comes back when it has already been decided, and the route says so.
 */
export async function decideCredential(id, { state, expiresOn, note, by }) {
  const { rows } = await query(
    `update host_credentials
        set state = $2,
            confirmed_at = case when $2 = 'confirmed' then now() else null end,
            expires_on = $3, decided_note = $4, decided_by = $5, updated_at = now()
      where id = $1 and state = 'pending' returning *`,
    [id, state, expiresOn ?? null, note ?? null, by ?? null],
  );
  return rows[0] ?? null;
}

/**
 * What a guest may be shown, for one host or many.
 *
 * A required-evidence credential appears only once the back office has
 * confirmed it and only while that confirmation is in date; one that needs no
 * evidence appears as the host's own claim. The shaping — "seen" against
 * "stated" — is `domain/hostSkills.js credentialDisplay`, and the caller does
 * it; this only refuses to hand over the rows a guest may never see.
 */
export async function shownCredentialsFor(hostIds) {
  if (!hostIds?.length) return {};
  const { rows } = await query(
    `select c.*, t.label, t.evidence_required
       from host_credentials c join host_credential_types t on t.key = c.type_key
      where c.host_id = any($1)
        and t.active
        and (c.state = 'confirmed' or (c.state = 'stated' and not t.evidence_required))
        and (c.expires_on is null or c.expires_on >= current_date)
      order by t.position, t.key`,
    [hostIds],
  );
  const out = {};
  for (const r of rows) (out[r.host_id] ??= []).push(r);
  return out;
}

export async function credentialsWaiting() {
  const { rows } = await query(
    `select c.*, t.label, t.evidence_required, h.name as host_name, h.type as host_type, h.id as host_id
       from host_credentials c
       join host_credential_types t on t.key = c.type_key
       join hosts h on h.id = c.host_id
      where c.state = 'pending'
      order by c.created_at`,
  );
  return rows;
}

// ---------------------------------------------------------------------------
// the source register
// ---------------------------------------------------------------------------
export async function sources({ all = false } = {}) {
  const { rows } = await query(
    `select s.*,
            (select count(*)::int from host_skill_tags t where t.source = s.key) as tags,
            (select count(*)::int from host_facets f where f.source = s.key) as facets
       from vocabulary_sources s ${all ? '' : 'where s.active'} order by s.position, s.key`,
  );
  return rows;
}

export async function saveSource(s) {
  const name = await labelFor('vocabulary_sources', s.key, s.label);
  const { rows } = await query(
    `insert into vocabulary_sources (key, label, what_we_take, licence, attribution, may_retain, resolves, url, note, last_refreshed, active, position)
     values ($1, $2, coalesce($3, ''), coalesce($4, ''), $5, coalesce($6, false), $7, $8, $9, $10, coalesce($11, true), coalesce($12, 0))
     on conflict (key) do update set
       label = coalesce($2, vocabulary_sources.label),
       what_we_take = coalesce($3, vocabulary_sources.what_we_take),
       licence = coalesce($4, vocabulary_sources.licence),
       attribution = coalesce($5, vocabulary_sources.attribution),
       may_retain = coalesce($6, vocabulary_sources.may_retain),
       resolves = coalesce($7, vocabulary_sources.resolves),
       url = coalesce($8, vocabulary_sources.url),
       note = coalesce($9, vocabulary_sources.note),
       last_refreshed = coalesce($10, vocabulary_sources.last_refreshed),
       active = coalesce($11, vocabulary_sources.active),
       position = coalesce($12, vocabulary_sources.position),
       updated_at = now()
     returning *`,
    [s.key, name, s.whatWeTake ?? null, s.licence ?? null, s.attribution ?? null, s.mayRetain ?? null,
     s.resolves ?? null, s.url ?? null, s.note ?? null, s.lastRefreshed ?? null, s.active ?? null, s.position ?? null],
  );
  return rows[0];
}

/**
 * What a guest is owed on screen: only the CC BY and ODC-By sources trigger
 * attribution, and never Wikidata, which is CC0. Since we take labels as
 * inspiration and identifiers as pointers rather than redistributing anybody's
 * dataset, the obligation is one credits line on a static page linked from tag
 * pages, not a byline under every chip.
 */
export async function attributionOwed() {
  const { rows } = await query(
    // The brackets are the point: without them `active` bound only to the tag
    // branch, and a source switched off went on being credited to a guest
    // because a facet still pointed at it (Codex, 13 Sep 2026).
    `select key, label, attribution, url from vocabulary_sources
      where active and attribution is not null
        and (exists (select 1 from host_skill_tags t where t.source = vocabulary_sources.key)
             or exists (select 1 from host_facets f where f.source = vocabulary_sources.key))
      order by position`,
  );
  return rows;
}

// ---------------------------------------------------------------------------
// the tag landing page
// ---------------------------------------------------------------------------
/**
 * Every host in Britain carrying this tag, and their offer.
 *
 * A sparse answer is not an empty shelf: one host is the rarest thing on Epic
 * this week, and the screen says so. That copy is the screen's job; this just
 * answers honestly and lets it.
 */
export async function hostsForTag(vocab, key, { limit = 40, country = null } = {}) {
  const { rows } = await query(
    /**
     * One row per host, ranked across all of them, then a page of it.
     *
     * `distinct on` has to order by the key it is distinct on, so doing the
     * limit in the same statement would take an arbitrary forty host ids and
     * only then rank those — a relevant host with a late UUID could never
     * appear (Codex, 13 Sep 2026). So the inner query picks each host's best
     * offer, and the outer one ranks and cuts.
     */
    `with best as (
       select distinct on (h.id)
              o.id as offer_id, o.title, o.state, o.venue_area, o.venue_country, o.price_mode, o.price_pence, o.total_pence, o.per,
              o.shape, o.category_key, o.format_key, o.published_at,
              h.id as host_id, h.name as host_name, h.type as host_type, h.trust, h.location_label, h.photo_id,
              s.position
         from host_offer_skills s
         join host_offers o on o.id = s.offer_id and o.state in ('live', 'paused') and o.visibility = 'public'
         join hosts h on h.id = o.host_id
        where s.vocab = $1 and s.target_key = $2
          and ($3::text is null or o.venue_country = $3)
        order by h.id, (o.state = 'live') desc, o.published_at desc nulls last, s.position
     )
     select * from best
      order by (state = 'live') desc, position, published_at desc nulls last
      limit $4`,
    [vocab, key, country, limit],
  );
  return rows;
}

/**
 * How many hosts carry it in all — which is not the length of a page of them.
 *
 * The page says "34 hosts" and picks its sparse state from this, so a tag with
 * forty-one would otherwise read as exactly forty for ever (Codex, 13 Sep 2026).
 */
export async function hostCountForTag(vocab, key, { country = null } = {}) {
  const { rows } = await query(
    `select count(distinct o.host_id)::int as n
       from host_offer_skills s
       join host_offers o on o.id = s.offer_id and o.state in ('live', 'paused') and o.visibility = 'public'
      where s.vocab = $1 and s.target_key = $2
        and ($3::text is null or o.venue_country = $3)`,
    [vocab, key, country],
  );
  return rows[0].n;
}

/** What sits next to a tag when there is not much of it: siblings, then the parent's other children. */
export async function neighbours(vocab, key, { limit = 4 } = {}) {
  const t = table(vocab);
  const { rows } = await query(
    `select v.* from ${t} v
      where ${liveIn(vocab)} and v.key <> $1
        and (v.parent_key = (select parent_key from ${t} where key = $1)
             or v.parent_key = $1
             or v.key = (select parent_key from ${t} where key = $1))
      order by v.seen_count desc, v.label
      limit $2`,
    [key, limit],
  );
  return rows;
}

export { FACET_KINDS, keyFor, normalise };
