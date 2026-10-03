/**
 * The rules behind Who's going and paying on the guest booking screen (guest
 * handoff G6–G10, G24, G26), kept apart from the screen so they can be tested.
 */

/** A child's age or date of birth, as typed: their choice which (README › Who's going). */
export type AgeAnswer = { byDob: boolean; age: string; dob: string };

/** The age or date of birth given, or null while it isn't one yet: 0 to 17 as a whole number, or YYYY-MM-DD. */
export function ageAnswer(a: AgeAnswer): { age: number; dob: null } | { age: null; dob: string } | null {
  if (a.byDob) return /^\d{4}-\d{2}-\d{2}$/.test(a.dob.trim()) ? { age: null, dob: a.dob.trim() } : null;
  const t = a.age.trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return n <= 17 ? { age: n, dob: null } : null;
}

/**
 * Whether one more person can be ticked: never more than the places left (or the
 * most from one household). Someone added with no room is still added, unticked —
 * the line under the list turns amber and a toast says so.
 */
export const roomForOneMore = (ticked: number, cap: number) => ticked < cap;

/** The toast when the cap stops a tick. */
export const capToast = (cap: number) => (cap === 1 ? 'Only 1 place left' : `Only ${cap} places left`);

/**
 * The payment sheet's title (G26): the first decline is "Your card was declined";
 * a retry that is declined again, or a failure on Epic's side, is "Payment didn't go through".
 */
export function payProblemTitle(kind: 'declined' | 'failed', declinesInARow: number): string {
  return kind === 'declined' && declinesInARow <= 1 ? 'Your card was declined' : 'Payment didn’t go through';
}

/** The latest of the refunds' dates (G17's "went back to your card on 21 Sep"), or null when none says. */
export function lastRefundAt(refunds: { at: string | null | undefined }[]): string | null {
  const at = refunds.map((r) => r.at).filter((x): x is string => Boolean(x)).sort();
  return at.length ? at[at.length - 1] : null;
}

// ---------------------------------------------------------------------------
// Who's going, shared by Book and Change how many are going (README › Who's going — rules)
// ---------------------------------------------------------------------------

/** One person who could be ticked: a household member, someone on the booking already, or someone added by hand. */
export type Who = {
  key: string; name: string; adult: boolean; age: number | null; dob: string | null; memberId: string | null; line: string;
  /** On a booking already: what it holds for them (a child's needs and emergency number), carried through a change. */
  needs?: string[]; emergencyContact?: string | null;
};

/** The event's rules on who can go (GuestOptions.who). */
export type WhoRules = { ageMin: number | null; ageMax: number | null; partyMax: number | null; dropOff: boolean; adultsOnly: boolean };

/** A person's age on the day, from their age or date of birth; null when nobody said. */
export function ageOn(w: { age: number | null; dob: string | null }, onDay: string | null, today = new Date()): number | null {
  if (w.age != null) return w.age;
  if (!w.dob) return null;
  const [y, m, d] = w.dob.split('-').map(Number);
  const [Y, M, D] = (onDay ?? today.toISOString().slice(0, 10)).split('-').map(Number);
  return Y - y - (M < m || (M === m && D < d) ? 1 : 0);
}

/** Why someone can't go, greyed under their name — or null when they can. */
export function cannotGo(p: Who, who: WhoRules, onDay: string | null): string | null {
  const age = ageOn(p, onDay);
  if (who.adultsOnly && !p.adult) return 'Adults only';
  if (who.dropOff && p.adult) return 'Drop off · children only';
  if (!p.adult && age != null && ((who.ageMin != null && age < who.ageMin) || (who.ageMax != null && age > who.ageMax))) {
    return `Age ${age} · this is for ages ${who.ageMin ?? 0}${who.ageMax != null ? `–${who.ageMax}` : ' and up'}`;
  }
  return null;
}

/** A household member as someone who could go. Grown up is 18, from the age or birthday the household gave. */
export function fromMember(m: { id: string; name: string; age?: number | null; birthDate?: string | null; isMinor?: boolean | null }, me: string | null): Who {
  // isMinor means under 13, so a 15-year-old is not an adult here (Codex, 3 Oct 2026). With neither, the household's own word stands.
  const w: Who = { key: m.id, name: m.name, adult: true, age: m.age ?? null, dob: m.birthDate ?? null, memberId: m.id, line: '' };
  const age = ageOn(w, null);
  const adult = age != null ? age >= 18 : !m.isMinor;
  return { ...w, adult, line: m.id === me ? 'You' : adult ? 'Adult' : age != null ? `Age ${age} · from your household` : 'Child · from your household' };
}

/** You first, then the other grown-ups, then the children — as the household reads. */
export const householdOrder = (w: Who) => (w.line === 'You' ? 0 : w.adult ? 1 : 2);

/** What a booking says of who is going (GuestBooking.who). */
export type BookedWho = {
  heads: number;
  adults?: { name: string | null }[];
  children: { name: string | null; age: number | null; dob: string | null; needs?: string[]; emergencyContact: string | null }[];
};

const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

/**
 * Change how many are going: everyone on the booking now (each to start ticked), then the household members who
 * aren't on it. A booked person is the household member of the same name; an unnamed grown-up on it is you. A
 * booking older than names carries only a head count: the grown-ups it can't name are "A grown-up".
 */
export function partyPeople(booked: BookedWho, members: Parameters<typeof fromMember>[0][], me: string | null): { people: Who[]; onBooking: string[] } {
  const household = members.map((m) => fromMember(m, me)).sort((x, y) => householdOrder(x) - householdOrder(y));
  const used = new Set<string>();
  const people: Who[] = [];
  const onBooking: string[] = [];
  const take = (pred: (w: Who) => boolean) => {
    const hit = household.find((w) => !used.has(w.key) && pred(w));
    if (hit) used.add(hit.key);
    return hit ?? null;
  };
  const adults = booked.adults ?? [];
  // Older bookings: a head count with no list. Everyone it holds beyond the children is a grown-up.
  const adultCount = Math.max(adults.length, booked.heads - booked.children.length, 0);
  const named = adults.filter((a) => a.name);
  for (const a of named) {
    const m = take((w) => w.adult && same(w.name, a.name));
    const w: Who = m ?? { key: `b-a-${people.length}`, name: a.name!, adult: true, age: null, dob: null, memberId: null, line: 'On this booking' };
    people.push(w); onBooking.push(w.key);
  }
  for (let i = named.length; i < adultCount; i++) {
    const m = take((w) => w.line === 'You');
    const w: Who = m ?? { key: `b-a-${people.length}`, name: 'A grown-up', adult: true, age: null, dob: null, memberId: null, line: 'On this booking' };
    people.push(w); onBooking.push(w.key);
  }
  booked.children.forEach((k, i) => {
    const m = take((w) => !w.adult && same(w.name, k.name));
    const age = k.age ?? null;
    const base: Who = m ?? { key: `b-c-${i}`, name: k.name ?? 'A child', adult: false, age: null, dob: null, memberId: null, line: '' };
    // What the booking holds for a child stands: their age as booked, their needs and their emergency number.
    const w: Who = { ...base, adult: false, age: age ?? base.age, dob: age == null ? k.dob ?? base.dob : null, needs: k.needs ?? [], emergencyContact: k.emergencyContact ?? null };
    if (!m) w.line = w.age != null ? `Age ${w.age} · on this booking` : 'Child · on this booking';
    people.push(w); onBooking.push(w.key);
  });
  return { people: [...people, ...household.filter((w) => !used.has(w.key))], onBooking };
}

/**
 * How many can be on a booking after a change: never past the most from one household, and never more than it
 * holds now plus the places left on every session it still covers. Unknown places left leave it to the server.
 */
export function partyCap(heads: number, placesLeft: (number | null)[], partyMax: number | null): number {
  const known = placesLeft.filter((n): n is number => n != null);
  const room = known.length ? heads + Math.max(0, Math.min(...known)) : Infinity;
  return Math.min(room, partyMax ?? Infinity);
}

/** The party as the API takes it (`POST /api/booked/:id/party`, `GET …/party-quote`). */
export function partyBody(chosen: Who[], o: { dropOff: boolean; contacts: Record<string, string>; adultConfirmed: boolean }) {
  return {
    adults: chosen.filter((p) => p.adult).length,
    // The grown-ups by name; one the booking never named stays unnamed.
    adultNames: chosen.filter((p) => p.adult).map((a) => (a.key.startsWith('b-a-') && a.name === 'A grown-up' ? null : a.name)),
    children: chosen.filter((p) => !p.adult).map((k) => ({
      name: k.name, age: k.age ?? undefined, dob: k.age == null ? k.dob ?? undefined : undefined, needs: k.needs ?? [],
      emergencyContact: o.dropOff ? (o.contacts[k.key] ?? k.emergencyContact ?? '').trim() : k.emergencyContact ?? undefined,
    })),
    adultConfirmed: o.adultConfirmed,
  };
}

const POLICY_WORDS: Record<string, string> = { flexible: 'Flexible', moderate: 'Moderate', strict: 'Strict' };

/**
 * The lime line under Who's going, before confirming: what the change costs or gives back, from the server's
 * quote — never worked out on the phone.
 */
export function partyQuoteWords(
  q: { fromHeads: number; toHeads: number; chargePence: number; refundPence: number; feeKeptPence: number; later: boolean },
  policy: string | null, gbp: (p: number) => string, chargeOn?: string | null,
): string {
  const pol = policy ? ` · ${POLICY_WORDS[policy] ?? policy} policy` : '';
  if (q.chargePence > 0) return q.later ? `You’ll pay ${gbp(q.chargePence)} more${chargeOn ? ` · taken on ${chargeOn}` : ' when your card is charged'}` : `You’ll pay ${gbp(q.chargePence)} more`;
  if (q.refundPence > 0) return `You’ll get ${gbp(q.refundPence)} back${pol}${q.feeKeptPence ? ` · ${gbp(q.feeKeptPence)} cancellation fee kept` : ''}`;
  // Fewer going and nothing back: the policy says why, rather than a line that reads as "no change".
  if (q.toHeads < q.fromHeads && q.feeKeptPence + q.refundPence === 0 && policy) return `Nothing comes back${pol}`;
  return 'No change to what you pay';
}

/** The toast when the cap stops a tick on a change: the places left beyond the booking's own, or the most it can hold. */
export function partyCapToast(heads: number, left: number | null, cap: number): string {
  if (left != null && cap === heads + left) return left === 0 ? 'No places left' : left === 1 ? 'Only 1 more place left' : `Only ${left} more places left`;
  return `Up to ${cap} on one booking`;
}
