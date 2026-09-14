/**
 * The two levels, as data.
 *
 * They used to be a list in `domain/moods.js`, which made "add a subcategory" a
 * deploy. The owner, 5 Sep 2026: "we probably need a settings page where we can
 * add the subcategories manually… a settings page where I can see those
 * categories and subcategories." So the vocabulary lives in two tables and the
 * code reads whatever is in them.
 *
 * Read on every home-screen answer, so it is cached in the process for a few
 * seconds and the cache is dropped the moment anything is written — a rename in
 * the back office shows up on the next refresh rather than in a minute's time.
 *
 * **The no-duplication rule lives in the schema, not here.**
 * `shelf_subcategories.key` is unique across the whole table, so a drawer
 * belongs to exactly one cabinet and the database refuses to be told otherwise.
 * Everything in this file can therefore assume it.
 */

import { query } from '../db.js';
import { vocabularyOf } from '../domain/moods.js';
import { forget as attributesForget } from './placeAttributes.js';

const TTL_MS = 5000;
let cache = null;
let cachedAt = 0;

export const forget = () => { cache = null; };

/** Everything, in one read, in the shapes the resolver and the screens want. */
export async function taxonomy() {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  const [cats, subs, extra] = await Promise.all([
    query('select * from shelf_categories order by position, label'),
    query('select * from shelf_subcategories order by position, label'),
    // The extra cabinets a drawer is listed in, beside its home (14 Sep 2026).
    query('select subcategory_key, category_key from shelf_subcategory_categories order by position, category_key'),
  ]);
  const categories = cats.rows;
  // Every listing, live or not. Switching a category off must not quietly
  // delete the listings that named it: the admin screen writes back whatever
  // it was given, so a filtered list here would wipe them on the next edit
  // (Codex, 14 Sep 2026). `vocabularyOf` builds its rank from the live
  // categories alone, so `shelvesOf` already refuses to draw a dead one.
  const alsoIn = new Map();
  for (const r of extra.rows) {
    const list = alsoIn.get(r.subcategory_key) ?? [];
    list.push(r.category_key);
    alsoIn.set(r.subcategory_key, list);
  }
  const subcategories = subs.rows.map((s) => ({
    ...s,
    also_in: (alsoIn.get(s.key) ?? []).filter((k) => k !== s.category_key),
  }));
  cache = {
    categories,
    subcategories,
    // Only the live ones reach a household; a category switched off in the back
    // office stops being a chip without anything being deleted.
    active: {
      categories: categories.filter((c) => c.active),
      subcategories: subcategories.filter((s) => s.active),
    },
    vocab: vocabularyOf(categories.filter((c) => c.active), subcategories.filter((s) => s.active)),
    byKey: new Map(categories.map((c) => [c.key, c])),
    subByKey: new Map(subcategories.map((s) => [s.key, s])),
  };
  cachedAt = Date.now();
  return cache;
}

/** true / false / 'unset' → a text the statement can tell apart from "not sent". */
const triState = (v) => (v === undefined ? null : v === null || v === 'unset' ? 'unset' : String(Boolean(v)));

const slug = (text) => String(text || '').toLowerCase().trim()
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_request' });

// ---------------------------------------------------------------------------
// categories
// ---------------------------------------------------------------------------

/**
 * Add or change a category.
 *
 * A new key is minted from the label, and the eight seeded keys are what
 * everything already taught is keyed by — so renaming one is a label change and
 * never a key change. Nothing that has been taught is orphaned by a rename.
 */
export async function saveCategory({ key, label, blurb, icon, position, isDoor, active, by }) {
  const k = key ? String(key) : slug(label);
  if (!k) throw bad('A category needs a name.');
  const { rows } = await query(
    `insert into shelf_categories (key, label, blurb, icon, position, is_door, active, seeded)
     values ($1, $2, $3, $4, coalesce($5, 100), coalesce($6,false), coalesce($7,true), false)
     on conflict (key) do update
        set label    = coalesce($2, shelf_categories.label),
            blurb    = coalesce($3, shelf_categories.blurb),
            icon     = coalesce($4, shelf_categories.icon),
            position = coalesce($5, shelf_categories.position),
            is_door  = coalesce($6, shelf_categories.is_door),
            active   = coalesce($7, shelf_categories.active),
            updated_at = now()
     returning *`,
    [k, label ?? null, blurb ?? null, icon ?? null, position ?? null,
     isDoor == null ? null : Boolean(isDoor), active == null ? null : Boolean(active)]);
  forget();
  return rows[0];
}

/**
 * Take a category away.
 *
 * Refused while anything is still filed under it, because deleting a cabinet
 * with drawers in it would silently drop every place they hold off the home
 * screen. Switch it off instead — that is what `active` is for, and it is
 * reversible.
 */
export async function removeCategory(key) {
  const { rows: subs } = await query('select count(*)::int as n from shelf_subcategories where category_key = $1', [key]);
  if (subs[0].n) throw bad(`${key} still has ${subs[0].n} subcategor${subs[0].n === 1 ? 'y' : 'ies'} in it. Move or delete those first, or switch the category off instead.`);
  const { rows } = await query('delete from shelf_categories where key = $1 returning *', [key]);
  forget();
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// subcategories
// ---------------------------------------------------------------------------

/**
 * Add or change a subcategory.
 *
 * Moving one to another category is allowed and is a single update — the key
 * does not change, so every rule already pointing at it follows it across, and
 * every place filed in that drawer moves shelf with it. That is the intended
 * way to reorganise: move the drawer, not the hundred places inside it.
 */
/**
 * Rewrite which extra cabinets a drawer is listed in.
 *
 * Left out entirely (`undefined`), the listing keeps; an empty array clears it.
 * The home category is never written here — it lives on the row — so a listing
 * that names it is dropped rather than stored twice.
 */
async function setAlsoIn(subcategoryKey, homeKey, alsoIn) {
  if (alsoIn === undefined || alsoIn === null) return;
  const wanted = [...new Set((alsoIn ?? []).map(String).filter((k) => k && k !== homeKey))];
  await query('delete from shelf_subcategory_categories where subcategory_key = $1', [subcategoryKey]);
  if (!wanted.length) return;
  await query(
    `insert into shelf_subcategory_categories (subcategory_key, category_key, position)
     select $1, u.key, u.i
       from unnest($2::text[]) with ordinality as u(key, i)
     on conflict (subcategory_key, category_key) do nothing`,
    [subcategoryKey, wanted]);
}

export async function saveSubcategory({ id, key, categoryKey, label, blurb, position, active, indoor, forKids, alsoIn, by }) {
  if (!categoryKey && !id) throw bad('A subcategory has to belong to a category.');
  const k = key ? slug(key) : slug(label);
  if (!k && !id) throw bad('A subcategory needs a name.');

  if (id) {
    const { rows } = await query(
      `update shelf_subcategories
          set category_key = coalesce($2, category_key),
              label        = coalesce($3, label),
              blurb        = coalesce($4, blurb),
              position     = coalesce($5, position),
              active       = coalesce($6, active),
              -- Indoors and for-children are three-valued: a field sent as the
              -- string 'unset' clears back to "it depends"; left out, it keeps.
              indoor       = case when $7::text is null then indoor when $7 = 'unset' then null else ($7 = 'true') end,
              for_kids     = case when $8::text is null then for_kids when $8 = 'unset' then null else ($8 = 'true') end,
              updated_at   = now()
        where id = $1 returning *`,
      [id, categoryKey ?? null, label ?? null, blurb ?? null, position ?? null,
       active == null ? null : Boolean(active), triState(indoor), triState(forKids)]);
    const saved = rows[0] ?? null;
    if (saved) await setAlsoIn(saved.key, saved.category_key, alsoIn);
    if (saved) await mirrorOldColumns(saved);
    forget();
    return saved ? { ...saved, also_in: await alsoInOf(saved.key, saved.category_key) } : null;
  }

  const { rows } = await query(
    `insert into shelf_subcategories (category_key, key, label, blurb, position, seeded, indoor, for_kids)
     values ($1, $2, $3, $4, coalesce($5, 100), false,
             case when $6::text is null or $6 = 'unset' then null else ($6 = 'true') end,
             case when $7::text is null or $7 = 'unset' then null else ($7 = 'true') end)
     on conflict (key) do update
        set category_key = excluded.category_key,
            label        = excluded.label,
            blurb        = coalesce(excluded.blurb, shelf_subcategories.blurb),
            position     = coalesce($5, shelf_subcategories.position),
            indoor       = case when $6::text is null then shelf_subcategories.indoor when $6 = 'unset' then null else ($6 = 'true') end,
            for_kids     = case when $7::text is null then shelf_subcategories.for_kids when $7 = 'unset' then null else ($7 = 'true') end,
            updated_at   = now()
     returning *`,
    [categoryKey, k, label ?? k, blurb ?? null, position ?? null, triState(indoor), triState(forKids)]);
  const saved = rows[0];
  await setAlsoIn(saved.key, saved.category_key, alsoIn);
  await mirrorOldColumns(saved);
  forget();
  return { ...saved, also_in: await alsoInOf(saved.key, saved.category_key) };
}

/**
 * Indoors and For kids are attributes now (migration 105), but they are still
 * columns on this row and the old screen still writes them. Until that screen
 * is folded into Categories, a write to either has to land in both places or
 * the two disagree the moment he edits one (Codex, 14 Sep 2026). Rainy day
 * follows Indoors only where nobody has parted them.
 */
async function mirrorOldColumns(sub) {
  const pairs = [['indoor', sub.indoor], ['kid-friendly', sub.for_kids]];
  for (const [attribute, value] of pairs) {
    if (value == null) {
      await query('delete from shelf_subcategory_attributes where subcategory_key = $1 and attribute_key = $2',
        [sub.key, attribute]);
      continue;
    }
    await query(
      `insert into shelf_subcategory_attributes (subcategory_key, attribute_key, yesno)
       values ($1, $2, $3)
       on conflict (subcategory_key, attribute_key) do update set yesno = excluded.yesno, updated_at = now()`,
      [sub.key, attribute, value]);
  }
  attributesForget();
}

/** What a drawer is listed under now, for the answer a save sends back. */
async function alsoInOf(subcategoryKey, homeKey) {
  const { rows } = await query(
    `select category_key from shelf_subcategory_categories
      where subcategory_key = $1 order by position, category_key`, [subcategoryKey]);
  return rows.map((r) => r.category_key).filter((k) => k !== homeKey);
}

/**
 * Take a subcategory away.
 *
 * The rules pointing at it are not deleted with it: the foreign key is `on
 * delete set null`, so they keep their weights and simply stop naming a drawer.
 * A place filed there falls back to whichever category its weights earn, which
 * is the same place it would have been before anybody made the drawer.
 */
export async function removeSubcategory(id) {
  const { rows } = await query('delete from shelf_subcategories where id = $1 returning *', [id]);
  forget();
  return rows[0] ?? null;
}

/** How many places each drawer is holding, so the settings page is not a guess. */
export async function subcategoryUse() {
  const { rows } = await query(
    `select subcategory, count(*)::int as rules
       from shelf_rules where subcategory is not null group by subcategory`);
  return new Map(rows.map((r) => [r.subcategory, r.rules]));
}
