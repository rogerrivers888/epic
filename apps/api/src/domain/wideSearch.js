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

/** The categories that mean "things to do" to the display search. */
const THINGS = new Set(['attraction', 'event', 'things']);

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
  const wantsThings = cats.length === 0 || cats.some((c) => THINGS.has(c));
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
export function mergeWide(near = [], wide = []) {
  const ids = new Set(near.map((v) => v?.sourceIds?.google).filter(Boolean));
  const out = [...near];
  for (const v of wide) {
    const id = v?.sourceIds?.google;
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
