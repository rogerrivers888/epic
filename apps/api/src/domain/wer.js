/**
 * Word error rate — how far one transcript is from another.
 *
 * The one number the voice experiment is judged on (brief, 8 Sep 2026: "word
 * error rate on real travel utterances with place names"). Both texts are
 * folded to words first — lower case, punctuation off, whitespace squashed —
 * so "Sintra," and "sintra" agree and "the 15th" is judged as words rather
 * than as characters. Then the ordinary edit distance over words: each
 * substitution, deletion or insertion is one error, divided by the reference's
 * length.
 *
 * Deliberately not clever about numbers or spellings: "fifteen" against "15"
 * is an error here, and it should be, because stage two has to read whichever
 * one it is given.
 */

export function words(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * `{ wer, errors, substitutions, deletions, insertions, words }`, where `words`
 * is the reference's length. An empty reference against an empty hypothesis is
 * 0; an empty reference against anything else is 1.
 */
export function wer(reference, hypothesis) {
  const r = words(reference);
  const h = words(hypothesis);
  if (!r.length) return { wer: h.length ? 1 : 0, errors: h.length, substitutions: 0, deletions: 0, insertions: h.length, words: 0 };

  // Edit distance with the three counts carried along, so the answer says what
  // kind of wrong it was and not only how much.
  const cols = h.length + 1;
  let prev = new Array(cols);
  for (let j = 0; j < cols; j += 1) prev[j] = { d: j, s: 0, del: 0, ins: j };
  for (let i = 1; i <= r.length; i += 1) {
    const cur = new Array(cols);
    cur[0] = { d: i, s: 0, del: i, ins: 0 };
    for (let j = 1; j < cols; j += 1) {
      if (r[i - 1] === h[j - 1]) { cur[j] = prev[j - 1]; continue; }
      const sub = prev[j - 1], del = prev[j], ins = cur[j - 1];
      if (sub.d <= del.d && sub.d <= ins.d) cur[j] = { d: sub.d + 1, s: sub.s + 1, del: sub.del, ins: sub.ins };
      else if (del.d <= ins.d) cur[j] = { d: del.d + 1, s: del.s, del: del.del + 1, ins: del.ins };
      else cur[j] = { d: ins.d + 1, s: ins.s, del: ins.del, ins: ins.ins + 1 };
    }
    prev = cur;
  }
  const end = prev[h.length];
  return {
    wer: Math.round((end.d / r.length) * 1000) / 1000,
    errors: end.d,
    substitutions: end.s,
    deletions: end.del,
    insertions: end.ins,
    words: r.length,
  };
}

/**
 * Whether two extracted plans say different things, and where.
 *
 * Flattens both to dotted paths and compares values as JSON, ignoring the
 * fields that are prose about the plan rather than the plan (`summary`), so a
 * differently worded sentence is not a changed plan.
 */
export function planDiff(a, b, { ignore = ['summary'] } = {}) {
  const flat = (o, prefix = '', out = {}) => {
    if (o === null || typeof o !== 'object' || Array.isArray(o)) { out[prefix || '$'] = JSON.stringify(o ?? null); return out; }
    for (const [k, v] of Object.entries(o)) flat(v, prefix ? `${prefix}.${k}` : k, out);
    return out;
  };
  const fa = flat(a ?? {}), fb = flat(b ?? {});
  const keys = new Set([...Object.keys(fa), ...Object.keys(fb)]);
  const changed = [];
  for (const k of keys) {
    if (ignore.some((i) => k === i || k.startsWith(`${i}.`))) continue;
    if (fa[k] !== fb[k]) changed.push({ field: k, a: fa[k] === undefined ? null : JSON.parse(fa[k]), b: fb[k] === undefined ? null : JSON.parse(fb[k]) });
  }
  return { changed: changed.length > 0, fields: changed };
}
