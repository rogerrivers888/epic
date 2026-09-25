/**
 * The taxonomy audits itself.
 *
 * The brief, 20 Sep 2026: "the machine examines every mapping against evidence
 * it already holds, proposes changes with reasons, groups them so like
 * decisions are made together, and a human signs off in bulk."
 *
 * **Every signal says how much evidence it had.** Two of the six the brief asks
 * for cannot fire honestly yet and must not pretend otherwise:
 *
 *   * *Nobody goes* needs opens. There are 637 search events against 2,001
 *     indexed places, so the denominator is real and the numerator is mostly
 *     zero for reasons that have nothing to do with the mapping. It fires only
 *     where a type has brought in enough places *and* enough of them have been
 *     shown, and it reports both numbers so a thin week reads as thin.
 *   * *Not a visitable place* needs hours, photos and reviews, and those are
 *     rented — Epic may read them live and may never store them (§13.10). So it
 *     is computed from what we own instead: whether anything we hold about the
 *     place amounts to somewhere you could go.
 *
 * *Mixed* is specified against embedding distance. There are no embeddings, and
 * adding a model call per subcategory to get them would make the audit cost
 * money every run. The stand-in is the evidence we already have and did not
 * have to buy: which provider words actually land on the same places. Two
 * clusters of words that never co-occur inside one subcategory is the same
 * finding by a cheaper road, and unlike a distance it can be read out loud.
 */

/** A proposal, in the shape the table stores. */
const say = (flag, o) => ({ flag, moves: 0, numbers: {}, ...o });

/**
 * Subcategories with one rule and few places.
 *
 * "Propose folding, with the nearest existing subcategories as the targets."
 * Nearest is by shared words: the subcategory whose rules mention words that
 * sit on the same places as this one's.
 */
export function singletons({ subs, rulesBySub, placesBySub, near }) {
  return subs
    .filter((s) => s.active)
    .filter((s) => (rulesBySub.get(s.key)?.length ?? 0) === 1)
    .map((s) => {
      const places = placesBySub.get(s.key) ?? 0;
      const targets = (near.get(s.key) ?? []).slice(0, 3);
      return say('singleton', {
        subject_kind: 'subcategory', subject: s.key, subject_label: s.label,
        action: 'fold',
        now_value: s.label,
        proposed: targets[0]?.label ?? null,
        because: `One rule and ${places} place${places === 1 ? '' : 's'}.`
          + (targets.length ? ` Closest by shared words: ${targets.map((t) => t.label).join(', ')}.` : ' Nothing close enough to fold into.'),
        numbers: { rules: 1, places, targets: targets.map((t) => ({ key: t.key, label: t.label, shared: t.shared })) },
        moves: places,
      });
    });
}

/**
 * Rules pointing at a drawer that is gone, or at nothing at all.
 *
 * A retirement is meant to move a drawer's rules first (the sign-off, 24 Sep
 * 2026); one that did not leaves a rule firing into a drawer nobody can see.
 * Advice, never applied: a repoint with nothing proposed is the flag the apply
 * already knows, and where the rule goes is a person's decision.
 */
export function orphanedRules({ subs = [], rules = [] }) {
  const off = new Map(subs.filter((s) => s.active === false).map((s) => [s.key, s.label]));
  return rules
    .filter((r) => (r.subcategory && off.has(r.subcategory))
      || (!r.subcategory && !Object.keys(r.weights ?? {}).length))
    .map((r) => say('orphaned_rule', {
      subject_kind: 'word', subject: `${r.scope}:${r.subject}`, subject_label: r.subject_label ?? r.subject,
      action: 'repoint', now_value: r.subcategory ?? null, proposed: null,
      because: r.subcategory
        ? `Points at ${off.get(r.subcategory)}, which is retired. Say where it goes, or delete it.`
        : 'Names no drawer and carries no weights, so it says nothing. Say where it goes, or delete it.',
      numbers: { id: r.id, scope: r.scope },
    }));
}

/** Subcategories with no rules and no places — a mapping gap, not an absence. */
export function orphans({ subs, rulesBySub, placesBySub, unmapped }) {
  return subs
    .filter((s) => s.active)
    .filter((s) => !(rulesBySub.get(s.key)?.length ?? 0) && !(placesBySub.get(s.key) ?? 0))
    .map((s) => {
      // The unanswered words whose name shares a word with this subcategory's.
      const want = new Set(String(s.label).toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3));
      const likely = unmapped
        .map((w) => ({
          key: w.key, label: w.label,
          hits: String(w.label ?? w.key).toLowerCase().split(/[^a-z]+/).filter((x) => want.has(x)).length,
        }))
        .filter((x) => x.hits > 0)
        .sort((a, b) => b.hits - a.hits)
        .slice(0, 6);
      return say('orphan', {
        subject_kind: 'subcategory', subject: s.key, subject_label: s.label,
        action: 'fill',
        now_value: 'nothing fills it',
        proposed: likely.map((x) => x.label ?? x.key).join(', ') || null,
        because: likely.length
          ? `No rules and no places. ${likely.length} unanswered word${likely.length === 1 ? '' : 's'} look like they belong here.`
          : 'No rules and no places, and nothing unanswered looks like it belongs. This needs a word nobody has seen yet.',
        numbers: { likely: likely.map((x) => x.key) },
      });
    });
}

/**
 * The opens the whole corpus needs before any of it can be read as engagement.
 *
 * Exported because two signals depend on it and they must not drift: the
 * audit's *nobody goes*, and the filing desk's "share of what a household was
 * shown that came through a mapping nobody engages with". Both measured how
 * young the product is rather than what they claim to measure, on the same
 * day, for the same reason (20 Sep 2026). One number, one place.
 */
export const CORPUS_OPENS = 200;

/**
 * Words whose places nobody has ever opened.
 *
 * Only where there is enough of both to mean anything: a word has to have
 * brought in `floor` places and those places have to have been *shown* at
 * least `seen` times between them. Otherwise the answer is "we do not know
 * yet", and the run records that rather than a proposal.
 */
export function nobodyGoes({
  words, placesByWord, shownByRef, openedByRef,
  floor = 25, seen = 20, corpusOpens = CORPUS_OPENS, worseThan = 0.25,
}) {
  const out = []; const thin = [];

  // **Zero opens only means something where opening happens.**
  //
  // Run against production on 20 Sep 2026 this proposed excluding `restaurant`,
  // `cafe`, `park`, `playground` and `indian_restaurant` — the heart of the
  // product — because the whole system held four opens and "opened: 0" was
  // therefore true of everything. The signal was measuring how young the
  // product is, not whether anybody goes. Accepting that group in bulk, which
  // is exactly what the screen invites, would have emptied the taxonomy.
  //
  // So it stays silent until the corpus shows that opening happens at all, and
  // then judges a word against the rate the rest of the corpus actually
  // achieves rather than against nought.
  const opensAll = [...openedByRef.values()].reduce((n, v) => n + v, 0);
  const shownAll = [...shownByRef.values()].reduce((n, v) => n + v, 0);
  if (opensAll < corpusOpens) {
    return { proposals: [], thin: [], blind: { opens: opensAll, needs: corpusOpens } };
  }
  const rate = shownAll ? opensAll / shownAll : 0;

  for (const w of words) {
    const refs = placesByWord.get(w.key) ?? [];
    if (refs.length < floor) continue;
    const shown = refs.reduce((n, r) => n + (shownByRef.get(r) ?? 0), 0);
    const opened = refs.reduce((n, r) => n + (openedByRef.get(r) ?? 0), 0);
    if (shown < seen) { thin.push({ key: w.key, places: refs.length, shown }); continue; }
    const mine = shown ? opened / shown : 0;
    if (mine > rate * worseThan) continue;
    out.push(say('nobody_goes', {
      subject_kind: 'word', subject: w.key, subject_label: w.label,
      action: 'exclude',
      now_value: w.subcategoryLabel ?? null,
      proposed: 'Not in Epic',
      because: `Brings in ${refs.length} places. Shown ${shown} times and opened ${opened}`
        + ` — ${(mine * 100).toFixed(1)}% against ${(rate * 100).toFixed(1)}% across everything else.`,
      numbers: { places: refs.length, shown, opened, rate: Number(mine.toFixed(4)), corpusRate: Number(rate.toFixed(4)) },
      moves: refs.length,
    }));
  }
  return { proposals: out, thin };
}

/**
 * Words whose places are not somewhere you could go, judged from what we own.
 *
 * A place we own nothing about but an identifier is not evidence of anything —
 * it is evidence that nobody has looked. So this asks only about places we have
 * actually researched, and says how many that was.
 */
export function notVisitable({ words, placesByWord, ownedByRef, floor = 10 }) {
  const out = [];
  for (const w of words) {
    const refs = placesByWord.get(w.key) ?? [];
    const looked = refs.filter((r) => ownedByRef.has(r));
    if (looked.length < floor) continue;
    const visitable = looked.filter((r) => ownedByRef.get(r));
    const share = visitable.length / looked.length;
    if (share > 0.2) continue;
    out.push(say('not_visitable', {
      subject_kind: 'word', subject: w.key, subject_label: w.label,
      action: 'exclude',
      now_value: w.subcategoryLabel ?? null,
      proposed: 'Not in Epic',
      because: `Of ${looked.length} of its places we have researched, ${visitable.length} look like somewhere you could go.`,
      numbers: { places: refs.length, looked: looked.length, visitable: visitable.length },
      moves: refs.length,
    }));
  }
  return out;
}

/**
 * Subcategories holding words that never appear on the same place.
 *
 * The junk-drawer detector. Words are the nodes, "seen on the same place" is
 * the edge, and a subcategory whose words fall into two or more components with
 * nothing between them is holding two or more different things.
 */
export function mixed({ subs, rulesBySub, wordsOfRule, together, floor = 4, cover = 0.5 }) {
  const out = []; const thin = [];
  for (const s of subs) {
    if (!s.active) continue;
    const rules = rulesBySub.get(s.key) ?? [];
    const words = [...new Set(rules.flatMap(wordsOfRule))];
    if (words.length < floor) continue;
    // **No evidence is not evidence of separateness.** Where the index has
    // never seen most of these words sitting on a place at all, every word is
    // its own island and every drawer looks like a junk drawer. On the first
    // run that flagged seventeen of fifty-one, which is the signal saying "I
    // cannot see" in the voice of "they are all wrong". It has to know enough
    // of the words before it may speak about the drawer.
    const seen = words.filter((w) => together.has(w)).length;
    if (seen / words.length < cover) { thin.push({ key: s.key, words: words.length, seen }); continue; }
    // Union-find over "these two words sit on a place together".
    const parent = new Map(words.map((w) => [w, w]));
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const join = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb); };
    for (const a of words) for (const b of together.get(a) ?? []) if (parent.has(b)) join(a, b);
    const groups = new Map();
    for (const w of words) { const r = find(w); groups.set(r, [...(groups.get(r) ?? []), w]); }
    const clusters = [...groups.values()].filter((g) => g.length).sort((a, b) => b.length - a.length);
    if (clusters.length < 2) continue;
    out.push(say('mixed', {
      subject_kind: 'subcategory', subject: s.key, subject_label: s.label,
      action: 'split',
      now_value: s.label,
      proposed: clusters.map((c) => c.slice(0, 3).join(' + ')).join('  \u00b7  '),
      because: `Its ${words.length} words fall into ${clusters.length} groups that never appear on the same place.`
        + ` ${seen} of the ${words.length} have been seen on a place.`,
      numbers: { clusters: clusters.map((c) => c.slice(0, 8)), seen, words: words.length },
    }));
  }
  return { proposals: out, thin };
}

/**
 * Words that bring places in without being what those places mostly are.
 *
 * Needs the place's own primary type, which the census does not buy — it asks
 * for identifiers only, so `google_types` is present on a small share of the
 * index. It therefore reports its own coverage and skips any word it cannot see
 * enough of.
 */
export function primaryMismatch({ words, placesByWord, primaryByRef, floor = 10 }) {
  const out = [];
  for (const w of words) {
    const refs = placesByWord.get(w.key) ?? [];
    const known = refs.filter((r) => primaryByRef.has(r));
    if (known.length < floor) continue;
    const same = known.filter((r) => primaryByRef.get(r) === w.key);
    const share = same.length / known.length;
    if (share > 0.3) continue;
    out.push(say('primary_mismatch', {
      subject_kind: 'word', subject: w.key, subject_label: w.label,
      action: 'repoint',
      now_value: w.subcategoryLabel ?? null,
      proposed: null,
      because: `Of ${known.length} of its places whose primary type we know, ${same.length} are actually this. It is catching the rest incidentally.`,
      numbers: { places: refs.length, known: known.length, same: same.length },
    }));
  }
  return out;
}

/** Every signal, with what each one could see. */
export function auditAll(input) {
  const goes = nobodyGoes(input);
  const mix = mixed(input);
  const proposals = [
    ...singletons(input),
    ...orphans(input),
    ...orphanedRules(input),
    ...goes.proposals,
    ...notVisitable(input),
    ...mix.proposals,
    ...primaryMismatch(input),
  ];
  const evidence = {
    words: input.words.length,
    subcategories: input.subs.filter((s) => s.active).length,
    opensKnownFor: input.openedByRef.size,
    shownKnownFor: input.shownByRef.size,
    primaryKnownFor: input.primaryByRef.size,
    researched: input.ownedByRef.size,
    tooThinToJudge: goes.thin.length,
    drawersTooThinToJudge: mix.thin.length,
    // Named rather than implied: a run that could not judge demand at all must
    // say so, or a clean audit reads as a clean taxonomy.
    demandBlind: goes.blind ?? null,
  };
  return { proposals, evidence };
}
