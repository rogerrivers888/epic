/**
 * Things to do: a near search and a wide one, merged (owner, 26 Sep 2026, E13).
 *
 * Google's Nearby Search returns twenty places ranked by popularity, whatever
 * the radius. Asked at fifty kilometres instead of twenty-two, the twenty for
 * things to do moved outward — median 15.5km → 30.3km from Bristol, 17.7km →
 * 31.5km from Winchester — and only nine and five of the nearer twenty
 * survived. Every place the wide search brought in was inside the hour, so the
 * fence was never breached; the nearer ones were crowded out by more famous
 * distant ones. Food did not move (median 1.4km → 1.7km in Bristol), because
 * popular restaurants cluster in the centre anyway.
 *
 * So: one search as far as `NEAR_KM`, and a second, Google-only and things
 * only, out to where the fence reaches — run **only** when the fence reaches
 * past the near search. A short trip costs exactly what it did.
 *
 * **Not wired to anything yet.** It was first put into `POST /api/discover`,
 * which no screen calls — zero searches from it in the fortnight to
 * 26 Sep 2026 — so it moved out again (F17: fix the path the screen actually
 * calls). Its place is Inspire's `/around` (`sources/ringSearch.js`), where
 * Winchester's things to do within the hour came back with a median of
 * 31.5km and Marwell Zoo, 7.9km away, eighth.
 */
import { kmBetween } from './travel.js';
import { nameKey, SAME_PLACE_KM } from './lookup.js';

/**
 * Where the near search stops. 22km is `reachRadiusKm` at an hour by car — the
 * radius every hour-long search already used — and the one the displacement
 * above was measured against.
 */
export const NEAR_KM = 22;

/**
 * The categories that mean food. Everything else — `attraction` on the
 * sources' side, `culture`, `fun`, `outdoors` and the rest on Inspire's — is a
 * thing to do, and a thing to do is what gets the second search.
 */
const FOOD = new Set(['food', 'restaurant', 'cafe', 'pub', 'bar', 'takeaway']);

/**
 * Which searches to run.
 *
 * `searchKm` is how far the fence reaches (`searchRadiusKm`); `todayKm` is the
 * radius the single search used before (`reachRadiusKm`). Within the near
 * radius one search covers the whole fence. Past it the first search stays near and
 * a second goes wide — but only for things to do, only without typed words
 * (a Text Search is biased, not ranked into a twenty), and only when there is
 * somewhere further for it to look.
 */
export function searchPlan({ searchKm, categories = [], query = '', todayKm = 0 }) {
  // Never narrower than the one search this replaces: at ninety minutes that
  // already reached 33.7km, and cutting it back to twenty-two would have taken
  // food further away from a household asking to go further (caught before
  // it shipped, 26 Sep 2026).
  const nearKm = Math.min(searchKm, Math.max(NEAR_KM, todayKm));
  const cats = Array.isArray(categories) ? categories : [];
  const wantsThings = cats.length === 0 || cats.some((c) => !FOOD.has(c));
  const wide = searchKm > nearKm && wantsThings && !String(query || '').trim();
  return { nearKm, wideKm: wide ? searchKm : null };
}

/**
 * The wide search's places that the near one did not already have.
 *
 * Matched on Google's own id first, then — for a place that reached the near
 * list only through another source — on the name within a kilometre, the rule
 * the Lookup screen folds by. The near list keeps its order and comes first:
 * it is the list the nearer places were being pushed out of.
 */
/** Google's id for a place, resolved (`sourceIds`) or straight from a display search. */
export const googleId = (v) => v?.sourceIds?.google ?? (v?.source === 'google' ? v?.sourcePlaceId ?? null : null);

export function mergeWide(near = [], wide = []) {
  const ids = new Set(near.map(googleId).filter(Boolean));
  const out = [...near];
  for (const v of wide) {
    const id = googleId(v);
    if (id && ids.has(id)) continue;
    const key = nameKey(v?.name);
    const same = key && v?.lat != null && out.some((n) => n?.lat != null
      && nameKey(n.name) === key && kmBetween(n, v) < SAME_PLACE_KM);
    if (same) continue;
    if (id) ids.add(id);
    out.push(v);
  }
  return out;
}

/**
 * Both searches are billed through **one meter**, passed to each
 * `searchAllSources` call — never two meters added together afterwards. The
 * meter carries its health (faults, latency, calls observed) on Symbol keys
 * that copying the numbers leaves behind, so a merged meter recorded every
 * near-and-wide call as unobserved, including a failure in either search
 * (Codex, 26 Sep 2026). There is deliberately no helper here for combining
 * them.
 */

/**
 * The shown list, near and far in turn.
 *
 * Two searches put the nearer places back in the pool, but the page is then
 * ranked by Epic score and cut, and for a place we own nothing about that score
 * is mostly Google's own rating and review count — popularity again, by
 * another road. Sorted as one list, the famous places an hour away would crowd
 * the near ones out a second time. So the page alternates: the best near place,
 * then the best further one, each side keeping its own order, and whichever
 * side runs out first leaves the rest to the other. Half of what a household
 * sees is what is near; the other half is what the hour genuinely reaches.
 *
 * `isNear` decides the side from each place's own point, not from which search
 * happened to return it, so a nearby place the wide search found is still near.
 */
export function alternate(items = [], isNear) {
  const near = items.filter((v) => isNear(v));
  const far = items.filter((v) => !isNear(v));
  const out = [];
  for (let i = 0; i < Math.max(near.length, far.length); i += 1) {
    if (i < near.length) out.push(near[i]);
    if (i < far.length) out.push(far[i]);
  }
  return out;
}
