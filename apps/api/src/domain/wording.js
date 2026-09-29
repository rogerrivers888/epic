/**
 * Wording: choosing en-GB or en-US for a household.
 *
 * The rule that matters, and is easy to get wrong (register entry 1): wording
 * follows the HOUSEHOLD, never the market of the place being displayed. A
 * British family browsing Florida reads "car park"; an American browsing
 * Cornwall reads "parking lot". So every function here takes a *locale* — the
 * household's own — and NOTHING here takes a place, a market or a country. If a
 * future caller ever wants to vary wording by where the place is, it has to add
 * that parameter in the open, past this comment and the test that guards it
 * (`test/wording.test.js`).
 *
 * This is not translation: there is no second language, only en-GB and en-US,
 * and everything falls back to en-GB.
 */

export const NAMESPACES = Object.freeze(['interface', 'places', 'collection']);
export const DEFAULT_LOCALE = 'en-GB';

/**
 * Pick the string for a locale from a wording row, and say whether it was a
 * miss — en-US asked for, only en-GB held. A miss still renders en-GB: it never
 * renders a key and never renders blank (register 6).
 */
export function pickWording(row, locale = DEFAULT_LOCALE) {
  // The real "missing wording": no row, so no en-GB to fall back to either. This
  // is the case register 6 guards against — it would otherwise render the key
  // or blank — and the only case worth logging. A key referenced in code but
  // never added to the vocabulary lands here, in any locale.
  // Null OR empty en-GB is nothing to render — treat both as missing so an
  // empty string never renders blank (Codex).
  if (!row || !row.en_gb) {
    return { text: null, miss: true, rendered: DEFAULT_LOCALE };
  }
  if (locale === 'en-US' && row.en_us != null && row.en_us !== '') {
    return { text: row.en_us, miss: false, rendered: 'en-US' };
  }
  // en-GB, or en-US with no separate American form. A blank en-US is "same" —
  // the normal and intentional state for most keys (the design: an American
  // household sees the British line until someone writes theirs) — NOT a miss.
  // Logging it would fill the miss log with every shared string on every view.
  return { text: row.en_gb, miss: false, rendered: DEFAULT_LOCALE };
}

/**
 * Whether an en-US row has drifted from the English it was written against —
 * the "Needs review · English changed" state. Computed wherever the back office
 * needs it, never stored.
 */
export function hasDrifted(row) {
  // An empty en-US is "not written yet" (the same as null), so it never drifts —
  // consistent with pickWording treating only a non-empty en-US as written.
  return Boolean(row && row.en_us != null && row.en_us !== ''
    && row.en_gb_version_when_us_written != null
    && row.en_gb_version !== row.en_gb_version_when_us_written);
}
