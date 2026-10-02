// Constraint application and ranking — Requirements §5, "Constraint application".
//
//   1. An allergen recorded against an ATTENDING member EXCLUDES a candidate.
//   2. A dislike recorded against an attending member LOWERS its ranking and is
//      surfaced as a reason.
//   3. Constraints belonging to members not attending are ignored entirely.
//
// Plus two things that rank without excluding:
//   - A diet (vegetarian, halal…) marks venues with no known suitable option.
//   - Learned preferences from ratings, applied only once confirmed
//     (Requirements §5 "Preference confidence").
//
// Allergens are safety and everything else is preference; they never share a
// code path here.

import { conceptByKey, resolveConcept, venueHasConcept, norm, allergenKeys } from './concepts.js';

/** A stated preference hits a venue through its concept, or through text when it never resolved. */
function preferenceHits(venue, pref) {
  const concept = pref.conceptKey ? conceptByKey(pref.conceptKey) : resolveConcept(pref.value);
  if (concept) return venueHasConcept(venue, concept);
  const needle = norm(pref.value);
  const singular = needle.replace(/s$/, '');
  const hay = [
    ...(venue.cuisines || []),
    venue.category,
    ...(venue.dishes || []).flatMap((d) => [d.name, d.concept]),
    ...(venue.experiences || []),
  ].map(norm);
  return hay.some(
    (h) => h === needle || h === singular || h.includes(needle) ||
      (singular.length >= 4 && h.includes(singular)) || h.split(/[^a-z0-9]+/).includes(singular),
  );
}

const FOOD = new Set(['restaurant', 'cafe', 'pub', 'bar', 'takeaway']);

/** Does the venue have something for this diet? null = unknown, true/false when known. */
function dietSupport(venue, dietSlug) {
  if (!FOOD.has(venue.category)) return null;
  const options = venue.dietaryOptions;
  if (options == null) return null;
  if (options.includes(dietSlug)) return true;
  if (['vegetarian', 'vegan', 'pescatarian'].includes(dietSlug)) {
    const vegDishes = (venue.dishes || []).some((d) => d.veg);
    if (dietSlug === 'pescatarian' && (venue.cuisines || []).includes('seafood')) return true;
    return vegDishes;
  }
  return false;
}

const ACCESS_WORD = { 'step-free': 'Step-free access', 'accessible-toilet': 'An accessible toilet', lift: 'A lift', quiet: 'A quiet space' };

/**
 * What a venue is KNOWN to say about an access need: true, false, or null for
 * no fact at all. Reads the owned record's accessibility block — OSM-style
 * 'yes'/'no'/'designated' strings or booleans. 'limited' and anything else
 * unrecognised is null: not clearly either, so it neither boosts nor hides.
 */
function accessSignal(venue, need) {
  const a = venue.accessibility || {};
  const read = (v) => {
    if (v === true || v === false) return v;
    const w = typeof v === 'string' ? v.trim().toLowerCase() : null;
    return w === 'yes' || w === 'designated' ? true : w === 'no' ? false : null;
  };
  // The first source that is definite wins, not the first that is present: a
  // descriptive step-free note beside OSM's wheelchair=no must not hide the
  // no, and so leave a known-stepped place in a step-free search (Codex,
  // 2 Oct 2026).
  const first = (...vals) => { for (const v of vals) { const r = read(v); if (r !== null) return r; } return null; };
  // Google's own structured answer comes after ours, read in memory from the
  // search result and never stored: a wheelchairAccessibleEntrance of false is
  // a known no, and was being missed (Codex, 2 Oct 2026).
  const g = venue.accessibilityOptions || {};
  if (need === 'step-free') return first(a.stepFree, a.wheelchair, venue.stepFree, g.wheelchairAccessibleEntrance);
  if (need === 'accessible-toilet') return first(a.wheelchairToilet, a.accessibleToilet, g.wheelchairAccessibleRestroom);
  if (need === 'lift') return first(a.lift);
  if (need === 'quiet') return first(a.quiet, venue.quiet);
  return null;
}

export function applyConstraints({ venues, attendees, learned = [] }) {
  const kept = [];
  const excluded = [];
  const attendingIds = new Set(attendees.map((a) => a.id));
  const learnedForAttending = learned.filter((l) => attendingIds.has(l.memberId));

  for (const venue of venues) {
    // --- Allergens: exclude, and attribute the exclusion to the named member.
    // Both sides are read through the one canonical UK-14 mapping, so a member
    // whose profile says 'gluten' still excludes a venue whose data says
    // 'wheat', and 'shellfish' on either side means crustaceans AND molluscs
    // (Codex, 1 Oct 2026 — the vocabulary migration must not open a gap in the
    // one filter that is a safety rule). A word the mapping doesn't know falls
    // back to exact normalised equality, as before.
    const keysOf = (val) => { const k = allergenKeys(val); return k.length ? k : [norm(val)]; };
    const allergenConflicts = [];
    for (const member of attendees) {
      for (const allergen of member.allergens) {
        const mine = keysOf(allergen);
        if ((venue.allergens || []).some((a) => keysOf(a).some((k) => mine.includes(k)))) {
          allergenConflicts.push({ member: member.name, memberId: member.id, allergen });
        }
      }
    }
    if (allergenConflicts.length > 0) {
      excluded.push({
        ...venue,
        excluded: true,
        exclusionReasons: allergenConflicts.map((c) => `Excluded: ${c.allergen} is an allergen for ${c.member}`),
        allergenConflicts,
      });
      continue;
    }

    // --- Step-free access: the one access need that EXCLUDES (SX4) — but only
    // on a KNOWN negative. A place with no step-free fact stays in the list:
    // hiding on absence would hide nearly everything (the can't-speak rule).
    // The other three needs, and a known step-free yes, rank below.
    const accessConflicts = [];
    for (const member of attendees) {
      if ((member.access || []).includes('step-free') && accessSignal(venue, 'step-free') === false) {
        accessConflicts.push({ member: member.name, memberId: member.id });
      }
    }
    if (accessConflicts.length > 0) {
      excluded.push({
        ...venue,
        excluded: true,
        exclusionReasons: accessConflicts.map((c) => `Excluded: no step-free access for ${c.member}`),
        accessConflicts,
      });
      continue;
    }

    const reasons = [];
    // Rating first, and how many people stand behind it (owner, 3 Sep 2026:
    // "strong weighting towards the reviews... an exceptional restaurant makes
    // up for not being an exact match"). Confidence grows with the review
    // count and is full at ~1,000; an unrated place sits at the neutral 30.
    const confidence = venue.ratingCount ? Math.min(1, Math.log10(venue.ratingCount + 1) / 3) : venue.rating != null ? 0.4 : 0;
    let score = 30 + (venue.rating != null ? (venue.rating - 3.5) * 25 * confidence : 0) + (venue.ratingCount ? Math.min(10, Math.log10(venue.ratingCount + 1) * 2.5) : 0);
    if (venue.rating != null && venue.rating >= 4.5 && (venue.ratingCount ?? 0) >= 500) reasons.push({ kind: 'rating', text: `Rated ${venue.rating.toFixed(1)} by ${venue.ratingCount.toLocaleString()} people` });

    for (const member of attendees) {
      // --- Dislikes and likes: rank, never exclude, always say why.
      for (const pref of member.dislikes) {
        if (preferenceHits(venue, pref)) {
          score -= 12;
          reasons.push({ kind: 'dislike', member: member.name, memberId: member.id, value: pref.value, text: `${member.name} dislikes ${pref.value}` });
        }
      }
      for (const pref of member.likes) {
        if (preferenceHits(venue, pref)) {
          // A favourite is the one this person would generally pick over the
          // other things they like — it ranks higher, it still never excludes.
          score += pref.favourite ? 14 : 8;
          reasons.push({ kind: pref.favourite ? 'favourite' : 'like', member: member.name, memberId: member.id, value: pref.value,
            text: pref.favourite ? `${pref.value} is a favourite of ${member.name}'s` : `${member.name} likes ${pref.value}` });
        }
      }
      // --- Diet: mark, don't hide. Unknown stays unknown.
      for (const diet of member.diets || []) {
        const slug = (diet.conceptKey || `diet:${norm(diet.value)}`).split(':')[1];
        const support = dietSupport(venue, slug);
        if (support === false) {
          score -= 10;
          reasons.push({ kind: 'diet', member: member.name, memberId: member.id, value: diet.value, text: `No ${diet.value} options known for ${member.name}` });
        } else if (support === true) {
          score += 3;
          reasons.push({ kind: 'diet-ok', member: member.name, memberId: member.id, value: diet.value, text: `${diet.value} options for ${member.name}` });
        }
      }
      // --- Access needs (SX4): step-free excluded above on a known no; a known
      // yes on any need ranks the place up, a known no on the ranking three
      // ranks it down. Unknown stays unknown, exactly as diet does.
      for (const need of member.access || []) {
        const signal = accessSignal(venue, need);
        if (signal === true) {
          score += 6;
          reasons.push({ kind: 'access', member: member.name, memberId: member.id, value: need, text: `${ACCESS_WORD[need] ?? need} for ${member.name}` });
        } else if (signal === false && need !== 'step-free') {
          score -= 8;
          reasons.push({ kind: 'access-missing', member: member.name, memberId: member.id, value: need, text: `No ${(ACCESS_WORD[need] ?? need).toLowerCase()} known for ${member.name}` });
        }
      }
    }

    // --- Learned from visits (Requirements §5 "Preference confidence").
    for (const l of learnedForAttending) {
      const concept = conceptByKey(l.conceptKey);
      if (!concept || !venueHasConcept(venue, concept)) continue;
      const sign = l.kind === 'like' ? 1 : -1;
      if (l.confirmed) {
        score += sign * (l.kind === 'like' ? 6 : 8);
        reasons.push({ kind: `learned-${l.kind}`, member: l.name, memberId: l.memberId, value: concept.label,
          text: `${l.name} ${l.kind === 'like' ? 'loved' : "didn't enjoy"} ${concept.label.toLowerCase()} (${l.count} visits)` });
      } else {
        // Held, shown, but not allowed to move the ranking meaningfully.
        score += sign;
        reasons.push({ kind: 'learning', member: l.name, memberId: l.memberId, value: concept.label,
          text: `${l.name} ${l.kind === 'like' ? 'liked' : "didn't like"} ${concept.label.toLowerCase()} once — still learning (${l.count} of ${l.threshold})` });
      }
    }

    // Epic 1 C6 — where two attending members disagree, both are surfaced.
    const contested = new Set();
    for (const a of reasons) for (const b of reasons) {
      if (a.kind !== b.kind && a.value && b.value && norm(a.value) === norm(b.value) && a.memberId !== b.memberId) contested.add(norm(a.value));
    }

    // Needs a booking and a showtime — only worth proposing as the thing you've booked.
    if (venue.ticketed && !venue.fixed) {
      score -= 40;
      reasons.push({ kind: 'note', text: 'Needs a booking — tell Epic if you have one' });
    }

    // A child is coming: places known not to suit children fall well down the list;
    // places known to welcome them say so.
    const childComing = attendees.some((m) => m.isMinor);
    if (childComing && (venue.goodForChildren === false || venue.category === 'bar')) {
      score -= 25;
      reasons.push({ kind: 'note', text: 'Not really for children' });
    }
    if (childComing && venue.goodForChildren === true) {
      score += 6;
      reasons.push({ kind: 'kids', text: 'Good for children' });
    }
    if (childComing && venue.menuForChildren === true) {
      score += 3;
      reasons.push({ kind: 'kids', text: "Children's menu" });
    }

    // Independents edge ahead of chains on ties; whether chains are offered at
    // all is the household's call (options.js), so this is a nudge, not a bar.
    if (venue.chain) {
      score -= 4;
      reasons.push({ kind: 'chain', text: venue.brand ? `Chain (${venue.brand})` : 'Chain' });
    }

    // Closer is better, but only as a tie-breaker — never enough to outrank taste.
    if (typeof venue.travelMinutes === 'number') score -= venue.travelMinutes * 0.15;
    if (typeof venue.detourMinutes === 'number') score -= venue.detourMinutes * 0.4;

    kept.push({
      ...venue,
      excluded: false,
      score: Number(score.toFixed(2)),
      reasons,
      contestedPreferences: [...contested],
      hasChildAttending: attendees.some((m) => m.isMinor),
    });
  }

  kept.sort((a, b) => b.score - a.score);
  return { candidates: kept, excluded };
}
