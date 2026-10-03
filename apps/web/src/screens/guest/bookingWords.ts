/**
 * What the guest's booking rows and booking page say, worked out apart from the
 * screens so it can be tested (guest handoff G4, G14, G22, G28, G30 and
 * "Every booking page carries").
 */

/** "Ava", "Ava and Ravi", "Priya, Ava and Ravi"; past three, "Priya, Dev and 2 more". Nobody named: null. */
export function namesWords(names: string[] | null | undefined): string | null {
  const n = (names ?? []).map((x) => x.trim()).filter(Boolean);
  if (!n.length) return null;
  if (n.length === 1) return n[0];
  if (n.length <= 3) return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
  return `${n.slice(0, 2).join(', ')} and ${n.length - 2} more`;
}

type CardLike = {
  offered?: { expiresAt: string } | null; numbers?: { booked: number; min: number } | null; holdReleased?: boolean;
  chip: string; refunded?: boolean; who?: string[];
};

/**
 * A Plans row's deep-green extra (G14), by what matters most: a held place's hours left, "3 of 4" while it waits
 * on numbers, "Hold released", "Refunded" — and otherwise who it's for, by name.
 */
export function cardExtra(c: CardLike, now = Date.now()): string | null {
  if (c.offered) return `${Math.max(0, Math.round((new Date(c.offered.expiresAt).getTime() - now) / 3_600_000))} h left`;
  if (c.numbers) return `${c.numbers.booked} of ${c.numbers.min}`;
  if (c.holdReleased) return 'Hold released';
  if (c.chip === 'called_off' && c.refunded) return 'Refunded';
  return namesWords(c.who);
}

type Who = { heads: number; adults?: { name: string | null }[]; children: { name: string | null; age: number | null }[] };

/**
 * Who's going on the booking page: everybody by name, grown-ups first, a child with their age; the grown-ups an
 * older booking never named counted ("1 more adult"). The line under it is the head count.
 */
export function whoGoingWords(w: Who): { title: string; sub: string } {
  const people = (w.adults ?? []).map((a) => a.name).filter((x): x is string => Boolean(x && x.trim()));
  const kids = w.children.map((k) => `${k.name ?? 'A child'}${k.age != null ? ` · age ${k.age}` : ''}`);
  const unnamed = Math.max(0, w.heads - people.length - kids.length);
  const parts = [...people, ...kids, ...(unnamed && (people.length || kids.length) ? [`${unnamed}${people.length ? ' more' : ''} ${unnamed === 1 ? 'adult' : 'adults'}`] : [])];
  const count = `${w.heads} ${w.heads === 1 ? 'person' : 'people'}`;
  return parts.length ? { title: parts.join(', '), sub: count } : { title: count, sub: '' };
}

/**
 * Where this household stands on an event's waiting list (G4, G30): its place for the session it would join (a
 * Weekly's list is per session), or the event's own list. Null when it isn't waiting — then the button is Join.
 */
export function waitPosition(mine: { sessionId: string | null; position: number; state: string }[] | null | undefined, sessionId: string | null): number | null {
  const w = (mine ?? []).find((x) => x.sessionId === sessionId && x.state === 'waiting');
  return w ? w.position : null;
}

/** The month a day falls in, counted from this one (0 this month), for the On request calendar; null outside 0–2. */
export function monthOffset(now: Date, ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(ymd);
  if (!m) return null;
  const n = (Number(m[1]) - now.getUTCFullYear()) * 12 + (Number(m[2]) - 1 - now.getUTCMonth());
  return n >= 0 && n <= 2 ? n : null;
}

/**
 * "Other times with Kate" opens Book with that time picked (G28): the day and time from the address, only when
 * the host is still free then. Anything else picks nothing.
 */
export function presetSlot(slots: { date: string; times: string[] }[], date: string | null, time: string | null, now = new Date()): { month: number; day: string; time: string | null } | null {
  if (!date) return null;
  const s = slots.find((x) => x.date === date);
  const month = monthOffset(now, date);
  if (!s || month == null) return null;
  return { month, day: date, time: time && s.times.includes(time) ? time : null };
}

/** Settings › Payments narrowed to one booking (its Receipt), or every payment. */
export function paymentsFor<P extends { bookingId: string | null }>(rows: P[], bookingId: string | null): P[] {
  return bookingId ? rows.filter((p) => p.bookingId === bookingId) : rows;
}

const DIET: Record<string, string> = { vegetarian: 'Vegetarian', vegan: 'Vegan', gluten_free: 'Gluten free', nut_allergy: 'Nut allergy', dairy_free: 'Dairy free', halal: 'Halal' };

/** The dietary ticks the host offered, as words (the usual six when the host set none). */
export function dietChoices(asked: Record<string, any> | null | undefined): string[] {
  const ticks: string[] = asked?.diet?.ticks?.length ? asked.diet.ticks : Object.keys(DIET);
  return ticks.map((k) => DIET[k] ?? k);
}

export type AnswerForm = { diet: string[]; note: string; bring: string | null; stay: string | null; plusOne: boolean };

/** The edit sheet's starting point: what the booking says now. */
export function formOf(answers: Record<string, any>): AnswerForm {
  const d = answers.dietary;
  return {
    diet: Array.isArray(d) ? d.filter((x) => typeof x === 'string') : typeof d === 'string' && d ? [d] : [],
    note: typeof answers.note === 'string' ? answers.note : '',
    bring: typeof answers.bring === 'string' && answers.bring ? answers.bring : null,
    stay: typeof answers.stay === 'string' && answers.stay ? answers.stay : null,
    plusOne: answers.plusOne === true,
  };
}

/**
 * What the edit sends: only the questions the host asked (dietary, a plus-one, bring, stay), and a note; whatever
 * else the booking already carried is kept as it was. A question taken back is left out, never sent empty.
 */
export function answersOf(form: AnswerForm, asked: Record<string, any> | null | undefined, before: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...before };
  for (const k of ['dietary', 'note', 'bring', 'stay', 'plusOne']) delete out[k];
  const q = asked ?? {};
  // Dietary is asked unless the host turned it off having set questions; an older event with none set still has it.
  const dietAsked = q.diet ? Boolean(q.diet.on) : true;
  if (dietAsked && form.diet.length) out.dietary = form.diet;
  if (q.plusOne?.on && form.plusOne) out.plusOne = true;
  if (q.bring?.on && form.bring) out.bring = form.bring;
  if (q.stay?.on && form.stay) out.stay = form.stay;
  if (form.note.trim()) out.note = form.note.trim();
  return out;
}
