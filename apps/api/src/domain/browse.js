/**
 * What a household always wants when it goes looking.
 *
 * The owner, 6 Sep 2026: *"I'd like to be able to set that as a default,
 * because personally I never search for pubs or bakeries. I just want to find
 * restaurants."*
 *
 * A browse filter is a question about this trip; a browse *default* is a
 * standing answer to it. Keeping them apart matters: the default is what the
 * screen opens on, and changing the filter for one afternoon must not quietly
 * rewrite what every afternoon opens on. So the screen sets a filter, and there
 * is a separate act — "always start here" — that makes it the default.
 *
 * Held on the household rather than the device, because the same family looking
 * on two phones is looking for the same thing.
 */

/** The two things a food search can be narrowed by, and the one a things search can. */
const SHAPE = { food: ['type', 'cuisine'], things: ['type'] };

const clean = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  // Long enough to be a word, short enough not to be somebody's essay.
  return s && s.length <= 40 ? s : null;
};

/** The household's standing answers, with anything unrecognised dropped. */
export function browseOf(household) {
  const stored = household?.browse_defaults || {};
  const out = {};
  for (const [kind, fields] of Object.entries(SHAPE)) {
    const from = stored[kind] || {};
    const kept = {};
    for (const f of fields) {
      const v = clean(from[f]);
      if (v) kept[f] = v;
    }
    out[kind] = kept;
  }
  return out;
}

/**
 * A patch, merged over what is already there — and a field sent as null or an
 * empty string clears it, because "I no longer always want Italian" has to be
 * sayable.
 */
export function mergeBrowse(household, patch) {
  const now = browseOf(household);
  if (!patch || typeof patch !== 'object') return now;
  for (const [kind, fields] of Object.entries(SHAPE)) {
    if (!(kind in patch)) continue;
    const from = patch[kind] || {};
    for (const f of fields) {
      if (!(f in from)) continue;
      const v = clean(from[f]);
      if (v) now[kind][f] = v; else delete now[kind][f];
    }
  }
  return now;
}
