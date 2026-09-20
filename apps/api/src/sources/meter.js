// A search's meter: how many billable units each provider consumed while it
// ran. `searchAllSources` hands one to every adapter through `params.meter`;
// the route writes the totals to provider_calls.units so Settings › Usage can
// show how much of each free allowance has gone (Technical Constraints §11,
// §14 "cost per source"). Adapters count what the provider bills for —
// requests for most, location IDs for Tripadvisor, elements for Routes.
export const bump = (meter, key, n = 1) => {
  if (!meter || !n) return;
  meter[key] = (meter[key] || 0) + n;
};

/**
 * How it went, alongside how much it cost.
 *
 * The owner, 20 Sep 2026: the supplier record "should show failures also". The
 * meter is the only thing already threaded through every adapter, so it is
 * where an outcome can be noted without touching thirty call sites.
 *
 * **Held on symbols, not keys.** `meter` goes straight into
 * `provider_calls.units`, which is priced by adding up its keys and is shown
 * on Settings › Usage as units of something. A `failed: 1` key would be
 * counted as a unit and might be priced; a symbol is skipped by `Object.keys`,
 * by `JSON.stringify` and by a spread, so the meter is exactly what it was.
 */
const FAULTS = Symbol('epic.meter.faults');
const MS = Symbol('epic.meter.ms');
const CALLS = Symbol('epic.meter.calls');

/**
 * One call that did not come back.
 *
 * `reason` is a short token in the provider's own terms — `http_429`,
 * `timeout`, `no_key` — and never the provider's message, because a raw body
 * can carry a query, a key or somebody's address.
 */
export const noteFault = (meter, reason) => {
  if (!meter) return;
  const faults = read(meter, FAULTS) ?? write(meter, FAULTS, []);
  faults.push(String(reason ?? 'error').slice(0, 40));
};

/** One call that did come back, and how long it took. */
export const noteCall = (meter, ms) => {
  if (!meter) return;
  write(meter, CALLS, (read(meter, CALLS) || 0) + 1);
  if (Number.isFinite(ms)) write(meter, MS, (read(meter, MS) || 0) + Math.max(0, Math.round(ms)));
};

/**
 * Written **non-enumerable**, not merely symbol-keyed.
 *
 * A symbol is skipped by `Object.keys` and by `JSON.stringify` — but a spread
 * copies own *enumerable* symbols, so `{ ...meter }` would have carried them
 * into whatever the call site built next. Non-enumerable closes that too, and
 * the meter is then exactly its units however it is copied.
 */
const read = (meter, key) => Object.getOwnPropertyDescriptor(meter, key)?.value;
const write = (meter, key, value) => {
  Object.defineProperty(meter, key, { value, enumerable: false, configurable: true, writable: true });
  return value;
};

/**
 * What the meter observed: how many calls, how many failed, how long in total,
 * and the first reason.
 *
 * `ok` is `null` where nothing was observed at all, so a row written by an
 * adapter nobody has instrumented reads as "not recorded" rather than as a
 * success nobody saw.
 */
export function healthOf(meter) {
  if (!meter || typeof meter !== 'object') return { ok: null, ms: null, failed: 0, fault: null, watched: null };
  const faults = read(meter, FAULTS) ?? [];
  const calls = read(meter, CALLS) ?? 0;
  if (!faults.length && !calls) return { ok: null, ms: null, failed: 0, fault: null, watched: null };
  return {
    ok: faults.length === 0,
    ms: read(meter, MS) ?? null,
    failed: faults.length,
    fault: faults[0] ?? null,
    /**
     * How many calls this meter actually watched — the denominator.
     *
     * One row is often several calls: a search hands one meter to every adapter
     * and writes a single row for the whole search. A rate computed over rows
     * read a search of eight requests with one failure as 100% failed (Codex,
     * 20 Sep 2026).
     */
    watched: calls + faults.length,
  };
}
