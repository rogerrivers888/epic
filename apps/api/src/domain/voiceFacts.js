/**
 * The fact set a spoken trip request is read into, and everything that is done
 * with it before a screen draws a chip (voice intake handoff, 8 Sep 2026,
 * "The mechanism": record → transcribe → extract facts → show facts as
 * editable chips → user confirms).
 *
 * Three things live here, in the order they run:
 *
 *   TRIP_FACTS_SCHEMA + TRIP_FACTS_SYSTEM   what stage two is allowed to say
 *   normaliseTripFacts()                     the model's answer, tidied
 *   resolveIntake()                          facts + the household's profile →
 *                                            chips, gap questions, the results
 *                                            address and a trip draft
 *
 * The handoff's slot table is the contract: every slot has a value the speaker
 * may have given, and a *default if unsaid* that comes from the profile — home,
 * the last travel mode, the whole household, the diets on file. A chip says
 * which it was (`source`: said / profile / default / gap) because the screens
 * draw them differently: lime for said, warm grey for the profile, dashed for a
 * gap. "Not mentioned" and "no preference" are kept apart on purpose: the first
 * is a gap, the second is an answer and is not asked again.
 *
 * Budget is never a slot. It is the Filters control on the results.
 */

import { estimateTravelMinutes } from './travel.js';

// ---------------------------------------------------------------------------
// the schema
// ---------------------------------------------------------------------------

const nullable = (type, extra = {}) => ({ type: [type, 'null'], ...extra });
const str = (description) => nullable('string', { description });
const int = (description) => nullable('integer', { description });
const bool = (description) => nullable('boolean', { description });
const strings = (description) => ({ type: 'array', items: { type: 'string' }, description });
const oneOf = (values, description) => nullable('string', { enum: [...values, null], description });

export const TRIP_TYPES = ['today', 'day_out', 'weekend', 'holiday', 'event'];
export const TRAVEL_MODES = ['car', 'public_transport', 'walk', 'cycle'];
export const WHO_KINDS = ['whole_household', 'named', 'guests', 'just_me'];
export const VIBES = ['fun', 'cultural', 'active', 'relaxed', 'mixed'];
export const AGE_BANDS = ['0-4', '5-8', '9-12', '13+'];
/** The kinds the trip's browse files things under (TripMapScreen THING_KINDS / FOOD_KINDS) — the same words, so a want leads the same lane. */
export const THING_KINDS = ['walk', 'park', 'castle', 'museum', 'beach', 'viewpoint', 'playground', 'farm', 'gallery'];
export const FOOD_KINDS = ['restaurant', 'pub', 'cafe', 'bar', 'bakery', 'ice cream'];
export const MINUTE_BANDS = [20, 30, 60, 120];

export const TRIP_FACTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    language: str('ISO-639-1 code of the language spoken (en, fr, pt…)'),
    trip_type: oneOf(TRIP_TYPES, '"today" when they want something now; "day_out" for one day; "weekend" for two or three nights; "holiday" for longer; "event" when the day is built around a show, match or booking. null if nothing about this was said'),
    when: {
      type: 'object', additionalProperties: false,
      properties: {
        start: str('First day as YYYY-MM-DD, resolved from words like "Saturday" or "next weekend" against today\'s date; null if not said'),
        end: str('Last day as YYYY-MM-DD when a range or a number of nights was said; null otherwise'),
        as_said: str('Their words about when, verbatim; null if nothing was said'),
      },
      required: ['start', 'end', 'as_said'],
    },
    time_of_day: oneOf(['morning', 'afternoon', 'evening'], 'A part of the day they named ("this afternoon"); null otherwise'),
    destination: str('A place they want to go to, if they named one — a town, an area, an attraction — spelt as a map would spell it; null if none. Never the place they start from'),
    origin: {
      type: 'object', additionalProperties: false,
      properties: {
        kind: oneOf(['home', 'current', 'named'], '"home" for "from home"; "current" for "from here"/"where we are"; "named" for a named starting place; null if not said'),
        name: str('The named starting place, if kind is "named"; null otherwise'),
      },
      required: ['kind', 'name'],
    },
    travel_mode: oneOf(TRAVEL_MODES, 'How they will travel, if said: driving is "car", train/bus/tube are "public_transport"; null if not said'),
    max_minutes: int('The most they will travel each way, in minutes, if said ("an hour" is 60, "half an hour" is 30); null if not said'),
    who: {
      type: 'object', additionalProperties: false,
      properties: {
        kind: oneOf(WHO_KINDS, '"whole_household" for "all of us"/"the family"; "named" when only some people are named; "guests" when people outside the household come; "just_me"; null if nothing was said about who'),
        names: strings('Household people named as coming, exactly as said; empty if none'),
        adults: int('How many adults, if a number was said; null otherwise'),
        children: int('How many children, if a number was said or can be counted from the names given as children; null otherwise'),
        kids_mentioned: { type: 'boolean', description: 'True if children were mentioned at all ("the kids", "our daughter", a child\'s name and age)' },
      },
      required: ['kind', 'names', 'adults', 'children', 'kids_mentioned'],
    },
    kids_ages: {
      type: 'array',
      description: 'One entry per child whose age was said. Empty if none were',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          name: str('The child\'s name if said; null otherwise'),
          age: int('Age in years if said as a number; null otherwise'),
          band: oneOf(AGE_BANDS, 'The age band, from the age or from words like "toddler" (0-4), "little ones" (5-8), "teenagers" (13+); null if it cannot be told'),
        },
        required: ['name', 'age', 'band'],
      },
    },
    wants: {
      type: 'array',
      description: 'The specific things they want to do: a named place ("Windsor Castle", "the Ashmolean") or a kind of thing ("a playground", "a walk", "a castle", "a museum"). One entry each, in their words; empty if none',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'The place\'s name as a map would spell it, or the kind of thing in one or two words ("playground", "walk", "castle")' },
          kind: { type: 'string', enum: ['place', 'type'], description: '"place" for a named place; "type" for a kind of thing' },
          type: nullable('string', { enum: [...THING_KINDS, null], description: 'For a kind of thing, the nearest of these words; for a named place, what kind of place it is if obvious ("Windsor Castle" → castle); null if none fits' }),
        },
        required: ['name', 'kind', 'type'],
      },
    },
    vibe: oneOf(VIBES, 'The mood they asked for: "fun" (theme parks, play), "cultural" (museums, castles, galleries), "active" (walks, climbing, sport), "relaxed" (gardens, spas, a slow day), "mixed" when they asked for a bit of everything; null if not said. A specific thing they named goes in wants, not here'),
    vibe_no_preference: { type: 'boolean', description: 'True only if they said they do not mind what kind of thing it is' },
    several_things: bool('True if they want a few things in the day, false if one thing is enough; null if not said'),
    indoors: bool('True if they asked for somewhere indoors or mentioned rain; false if they asked to be outdoors; null otherwise'),
    food: {
      type: 'object', additionalProperties: false,
      properties: {
        diets: strings('Diets said as applying to the group or the speaker — vegetarian, vegan, pescatarian, halal, kosher, gluten-free; empty if none'),
        cuisines: strings('Kinds of food or cuisine they asked for ("Italian", "a curry", "sushi"); empty if none'),
        must_haves: strings('Things they want from the meal ("a pub lunch", "somewhere with a garden", "afternoon tea"); empty if none'),
        kinds: { type: 'array', items: { type: 'string', enum: FOOD_KINDS }, description: 'The kind of place to eat they asked for, from these words: "a pub lunch" → pub, "a café" → cafe, "a nice restaurant" → restaurant; empty if none' },
        avoids: strings('Food they do not want, including allergies ("no seafood", "nut allergy"); empty if none'),
        place: str('A named place to eat, if one was said; null otherwise'),
        no_preference: { type: 'boolean', description: 'True only if they said they do not mind about food' },
      },
      required: ['diets', 'cuisines', 'must_haves', 'kinds', 'avoids', 'place', 'no_preference'],
    },
    ambiguities: {
      type: 'array',
      description: 'Anything genuinely unclear whose answer changes the plan — the same place name in two counties, a date that could be two dates. Ask; never invent',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          slot: { type: 'string', description: 'Which slot: destination, origin, when, who, travel_mode…' },
          question: { type: 'string', description: 'One short question in the transcript\'s language' },
          options: strings('Two to four short answers they could tap; empty when the choice is open'),
        },
        required: ['slot', 'question', 'options'],
      },
    },
    corrections: {
      type: 'array',
      description: 'Each place the speaker changed their mind ("the 14th — no, the 15th"). The slots hold the final value',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          slot: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' },
        },
        required: ['slot', 'from', 'to'],
      },
    },
  },
  required: ['language', 'trip_type', 'when', 'time_of_day', 'destination', 'origin', 'travel_mode', 'max_minutes', 'who', 'kids_ages', 'wants', 'vibe', 'vibe_no_preference', 'several_things', 'indoors', 'food', 'ambiguities', 'corrections'],
};

export const TRIP_FACTS_SYSTEM = `You read a faithful transcript of somebody telling a family day-out and trip planner what they want, and you fill in a form of facts.

Rules:
1. Extract only what was actually said. A slot nothing was said about is null (or an empty list). Never fill a slot from what would be typical.
2. "Not mentioned" and "no preference" are different: "we don't mind about food" sets food.no_preference true; saying nothing about food leaves food empty.
3. When the speaker corrects themselves ("Saturday — no, Sunday", "two of us, actually three"), the slot holds the final value and the change is listed in corrections.
4. Resolve relative dates ("Saturday", "next weekend", "the week after next") against the date and time zone given in the input. If a date cannot be resolved with certainty, leave start/end null and keep the words in as_said.
5. Place names: spell them as a map would. If a spelling is clearly a mishearing of a real place you can name with confidence, use the real name. If a name could be two different places and the difference matters (Windsor in Berkshire or Windsor in Ontario), raise an ambiguity rather than choosing.
6. The people named in the input are the household. Match names said in the transcript to them; a name that is not one of them is a guest. Children's ages count only if they were said.
7. Hesitations, repeated words and false starts are not content.
8. Every question and option you write is in the language of the transcript.
9. A named attraction ("Windsor Castle", "Legoland") is a want, and the town it is in is the destination when no other place was named. A kind of thing ("a playground", "a good walk") is a want of kind "type".`;

// ---------------------------------------------------------------------------
// tidying the answer
// ---------------------------------------------------------------------------

const s = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const b = (v) => (typeof v === 'boolean' ? v : null);
const date = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const list = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean) : []);
const inSet = (v, set) => (set.includes(v) ? v : null);

export const bandOfAge = (age) => (age == null ? null : age <= 4 ? '0-4' : age <= 8 ? '5-8' : age <= 12 ? '9-12' : '13+');
/** The middle of a band, when an age was tapped rather than said. */
export const ageOfBand = (band) => ({ '0-4': 3, '5-8': 6, '9-12': 10, '13+': 15 }[band] ?? null);

export function normaliseTripFacts(raw) {
  const o = raw ?? {};
  const kids = (Array.isArray(o.kids_ages) ? o.kids_ages : []).map((k) => ({
    name: s(k?.name), age: n(k?.age), band: inSet(k?.band, AGE_BANDS) ?? bandOfAge(n(k?.age)),
  })).filter((k) => k.age != null || k.band || k.name);
  return {
    language: s(o.language)?.toLowerCase().slice(0, 5) ?? null,
    trip_type: inSet(o.trip_type, TRIP_TYPES),
    when: { start: date(o.when?.start), end: date(o.when?.end), as_said: s(o.when?.as_said) },
    time_of_day: inSet(o.time_of_day, ['morning', 'afternoon', 'evening']),
    destination: s(o.destination),
    origin: { kind: inSet(o.origin?.kind, ['home', 'current', 'named']), name: s(o.origin?.name) },
    travel_mode: inSet(o.travel_mode, TRAVEL_MODES),
    max_minutes: n(o.max_minutes),
    who: {
      kind: inSet(o.who?.kind, WHO_KINDS), names: list(o.who?.names), adults: n(o.who?.adults), children: n(o.who?.children),
      kids_mentioned: Boolean(o.who?.kids_mentioned) || kids.length > 0,
    },
    kids_ages: kids,
    wants: (Array.isArray(o.wants) ? o.wants : []).filter((w) => s(w?.name)).map((w) => ({ name: s(w.name), kind: w.kind === 'place' ? 'place' : 'type', type: inSet(w.type, THING_KINDS) })),
    vibe: inSet(o.vibe, VIBES),
    vibe_no_preference: Boolean(o.vibe_no_preference),
    several_things: b(o.several_things),
    indoors: b(o.indoors),
    food: {
      diets: list(o.food?.diets), cuisines: list(o.food?.cuisines), must_haves: list(o.food?.must_haves), kinds: list(o.food?.kinds).filter((k) => FOOD_KINDS.includes(k)), avoids: list(o.food?.avoids),
      place: s(o.food?.place), no_preference: Boolean(o.food?.no_preference),
    },
    ambiguities: (Array.isArray(o.ambiguities) ? o.ambiguities : []).filter((a) => s(a?.question)).map((a) => ({ slot: s(a.slot) ?? 'plan', question: s(a.question), options: list(a.options) })),
    corrections: (Array.isArray(o.corrections) ? o.corrections : []).filter((c) => c && typeof c === 'object').map((c) => ({ slot: s(c.slot) ?? '', from: s(c.from) ?? '', to: s(c.to) ?? '' })),
  };
}

/**
 * A later reading laid over an earlier one: the wizard's three pages, or "tap
 * the mic to add more". What the new reading says wins; what it leaves null
 * stays as it was; lists are joined without repeats.
 */
export function mergeTripFacts(base, next) {
  if (!base) return next;
  const out = structuredClone(base);
  // `false` is an answer for the tri-state slots ("one thing", "outdoors") and
  // silence for the flags (no_preference, kids_mentioned), which only ever
  // turn on (Codex review, 9 Sep 2026).
  const TRI_STATE = new Set(['several_things', 'indoors']);
  const take = (path) => {
    const v = path.reduce((o, k) => o?.[k], next);
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return;
    if (v === false && !TRI_STATE.has(path[path.length - 1])) return;
    let o = out;
    for (const k of path.slice(0, -1)) o = o[k];
    const last = path[path.length - 1];
    o[last] = Array.isArray(v) && Array.isArray(o[last]) ? [...new Set([...o[last].map(String), ...v.map(String)])].map((x) => x) : v;
  };
  ['language', 'trip_type', 'time_of_day', 'destination', 'travel_mode', 'max_minutes', 'vibe', 'vibe_no_preference', 'several_things', 'indoors'].forEach((k) => take([k]));
  ['start', 'end', 'as_said'].forEach((k) => take(['when', k]));
  ['kind', 'name'].forEach((k) => take(['origin', k]));
  ['kind', 'names', 'adults', 'children', 'kids_mentioned'].forEach((k) => take(['who', k]));
  ['diets', 'cuisines', 'must_haves', 'kinds', 'avoids', 'place', 'no_preference'].forEach((k) => take(['food', k]));
  if (next.wants?.length) { const seen = new Set((out.wants ?? []).map((w) => w.name.toLowerCase())); out.wants = [...(out.wants ?? []), ...next.wants.filter((w) => !seen.has(w.name.toLowerCase()))]; }
  // Kids' ages and questions are replaced, not joined: a second breath about
  // the children is a correction of the first.
  if (next.kids_ages?.length) out.kids_ages = next.kids_ages;
  if (next.ambiguities?.length) out.ambiguities = next.ambiguities;
  if (next.corrections?.length) out.corrections = [...(out.corrections ?? []), ...next.corrections];
  return out;
}

// ---------------------------------------------------------------------------
// the profile's answers, and the chips
// ---------------------------------------------------------------------------

const MODE_LABEL = { car: 'Car', public_transport: 'Train & bus', walk: 'On foot', cycle: 'Bike' };
const MODE_ICON = { car: 'driving', public_transport: 'transit', walk: 'walking', cycle: 'cycle' };
/** Our four words → the trips table's four, and Inspire's three. */
export const MODE_TO_TRIP = { car: 'driving', public_transport: 'transit', walk: 'walking', cycle: 'cycling' };
export const MODE_TO_INSPIRE = { car: 'drive', public_transport: 'transit', walk: 'walk', cycle: 'walk' };
export const TRIP_TO_MODE = { driving: 'car', transit: 'public_transport', walking: 'walk', cycling: 'cycle' };
const VIBE_LABEL = { fun: 'Fun', cultural: 'Cultural', active: 'Active', relaxed: 'Relaxed', mixed: 'A bit of everything' };
const VIBE_ICON = { fun: 'fun', cultural: 'culture', active: 'activity', relaxed: 'relaxing', mixed: 'inspire' };
/** The Inspire category a mood opens: the address guard in routes.ts knows these words. */
/**
 * Only the shelves that are full enough to be a page of their own. Our atlas's
 * Active shelf is thin around most homes (nothing within an hour of Ascot on
 * the first deployed run, 9 Sep 2026), and an empty page is worse than every
 * shelf with the mood on the chip — the ranking still knows what was asked.
 */
export const VIBE_TO_CATEGORY = { fun: 'fun', cultural: 'culture', active: null, relaxed: 'relaxing', mixed: null };
const TYPE_LABEL = { today: 'Today', day_out: 'A day out', weekend: 'A weekend', holiday: 'A holiday', event: 'An event' };
const KIND_ICON = { walk: 'walk', park: 'park', castle: 'culture', museum: 'museum', beach: 'beach', viewpoint: 'viewpoint', playground: 'playground', farm: 'farm', gallery: 'culture' };

export const minutesLabel = (m) => (m == null ? '' : m < 60 ? `${m} min` : m % 60 === 0 ? `${m / 60} hr` : `${Math.floor(m / 60)} hr ${m % 60}`);
const snapMinutes = (m) => (m == null ? null : MINUTE_BANDS.find((band) => m <= band) ?? (m <= 180 ? 180 : 240));
const town = (label) => {
  if (!label) return null;
  const parts = String(label).split(',').map((p) => p.trim()).filter((p) => p && !/\d/.test(p));
  return parts[parts.length - 1] ?? String(label).split(',')[0].trim();
};
const dayLabel = (iso, timezone) => {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(+d)) return iso;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: timezone || 'UTC' });
};
const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const joinNames = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} & ${xs[xs.length - 1]}`);
const nextSaturday = (today) => {
  const d = new Date(`${today}T12:00:00Z`);
  const add = (6 - d.getUTCDay() + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
};

/**
 * Facts + profile + the taps made since → what every screen draws.
 *
 * `flow` is which door they came in by: `first` (Option C/B — gaps are asked,
 * up to two) or `returning` (Option R — nothing is asked; the profile answers)
 * or `inspire` (the ask row — like returning, and the results address carries
 * what was understood).
 */
export function resolveIntake({ facts, overrides = {}, answers = {}, flow = 'first', household, members = [], profile = {}, today, timezone = 'Europe/London' }) {
  const f = applyOverrides(facts, { ...answers, ...overrides });
  const home = household?.home_lat != null ? { label: household.home_label, lat: household.home_lat, lng: household.home_lng } : null;
  const children = members.filter((m) => m.isMinor || (m.age != null && m.age < 18));
  const adults = members.filter((m) => !children.includes(m));
  const asking = flow === 'first';
  const slots = [];
  const said = (key, label, icon, value, extra = {}) => slots.push({ key, label, icon, value, source: 'said', ...extra });
  const fromProfile = (key, label, icon, value, extra = {}) => slots.push({ key, label, icon, value, source: 'profile', ...extra });
  const byDefault = (key, label, icon, value, extra = {}) => slots.push({ key, label, icon, value, source: 'default', ...extra });
  const gap = (key, label, extra = {}) => slots.push({ key, label, icon: null, value: null, source: 'gap', ...extra });

  // --- when & what kind of day ------------------------------------------------
  let tripType = f.trip_type;
  if (!tripType && f.when.start) {
    const nights = f.when.end ? Math.round((Date.parse(f.when.end) - Date.parse(f.when.start)) / 86_400_000) : 0;
    tripType = nights >= 4 ? 'holiday' : nights >= 1 ? 'weekend' : f.when.start === today ? 'today' : 'day_out';
  }
  if (f.trip_type) said('trip_type', TYPE_LABEL[f.trip_type], 'calendar', f.trip_type);
  else if (tripType) byDefault('trip_type', TYPE_LABEL[tripType], 'calendar', tripType);
  else if (asking) gap('trip_type', 'What kind of day?');
  else { tripType = 'day_out'; }

  let start = f.when.start;
  let end = f.when.end;
  if (start) said('when', end && end !== start ? `${dayLabel(start, timezone)} – ${dayLabel(end, timezone)}` : dayLabel(start, timezone), 'calendar', { start, end });
  else if (f.when.as_said) said('when', cap(f.when.as_said), 'calendar', { start: null, end: null, as_said: f.when.as_said });
  else if (tripType === 'weekend') { start = nextSaturday(today); end = addDays(start, 1); byDefault('when', `Next weekend · ${dayLabel(start, timezone)}`, 'calendar', { start, end }); }
  else { start = today; byDefault('when', 'Today', 'calendar', { start: today, end: null }); }
  if (f.time_of_day) said('time_of_day', `This ${f.time_of_day}`, 'hours', f.time_of_day);

  // --- where -------------------------------------------------------------------
  if (f.destination) said('destination', f.destination, 'address', f.destination);
  const homeTown = town(home?.label);
  if (f.origin.kind === 'home' || (f.origin.kind === 'named' && homeTown && f.origin.name && f.origin.name.toLowerCase() === homeTown.toLowerCase())) {
    said('origin', homeTown ? `From home · ${homeTown}` : 'From home', 'home', { kind: 'home' });
  } else if (f.origin.kind === 'current') said('origin', 'From where you are', 'here', { kind: 'current' });
  else if (f.origin.kind === 'named' && f.origin.name) said('origin', `From ${f.origin.name}`, 'address', { kind: 'named', name: f.origin.name });
  else if (home) fromProfile('origin', `From home · ${homeTown}`, 'home', { kind: 'home' });
  else gap('origin', 'Where from?');

  // --- getting there ------------------------------------------------------------
  const lastMode = profile.travelMode ?? null;
  const mode = f.travel_mode ?? lastMode ?? 'car';
  if (f.travel_mode) said('travel_mode', MODE_LABEL[f.travel_mode], MODE_ICON[f.travel_mode], f.travel_mode);
  else if (lastMode) fromProfile('travel_mode', MODE_LABEL[lastMode], MODE_ICON[lastMode], lastMode);
  else byDefault('travel_mode', MODE_LABEL.car, MODE_ICON.car, 'car');

  const maxMinutes = f.max_minutes != null ? snapMinutes(f.max_minutes) : (profile.maxMinutes ?? null);
  if (f.max_minutes != null) said('max_minutes', `Up to ${minutesLabel(maxMinutes)} each way`, 'hours', maxMinutes);
  else if (profile.maxMinutes) fromProfile('max_minutes', `Up to ${minutesLabel(profile.maxMinutes)} each way`, 'hours', profile.maxMinutes);
  else if (asking && (tripType === 'today' || tripType === 'day_out' || !tripType)) gap('max_minutes', 'How far?');
  else byDefault('max_minutes', 'Up to 1 hr each way', 'hours', 60);

  // The journey, once the destination is a point on the map (R3: "Car · 24 min").
  const dest = profile.destinationPoint ?? null;
  if (dest && home) {
    const minutes = estimateTravelMinutes(home, dest, MODE_TO_TRIP[mode] ?? 'driving');
    slots.push({ key: 'journey', label: `${MODE_LABEL[mode]} · ${minutesLabel(minutes)}`, icon: MODE_ICON[mode], value: { mode, minutes }, source: f.travel_mode ? 'said' : 'profile' });
  }

  // --- who --------------------------------------------------------------------
  const count = members.length;
  if (f.who.kind === 'just_me') said('who', 'Just me', 'person', { kind: 'just_me' });
  else if (f.who.kind === 'named' && f.who.names.length && members.length && members.every((m) => f.who.names.some((nm) => m.name.toLowerCase().startsWith(nm.toLowerCase())))) {
    // Everyone, by name: "Roger, Gina and Phoenix" is the whole family.
    said('who', `Whole family · ${members.length}`, 'household', { kind: 'whole_household' });
  } else if (f.who.kind === 'named' && f.who.names.length) {
    const known = f.who.names.filter((nm) => members.some((m) => m.name.toLowerCase().startsWith(nm.toLowerCase())));
    // First names on the chip: "Roger, Gina & Phoenix", however the model spelt them out.
    const first = f.who.names.map((nm) => nm.trim().split(/\s+/)[0]);
    said('who', joinNames(first), 'household', { kind: 'named', names: f.who.names, memberIds: members.filter((m) => known.some((nm) => m.name.toLowerCase().startsWith(nm.toLowerCase()))).map((m) => m.id) });
  } else if (f.who.kind === 'guests') said('who', count ? `All ${count} of you + guests` : 'With guests', 'household', { kind: 'guests' });
  else if (f.who.kind === 'whole_household' || (f.who.adults != null && f.who.children != null)) {
    const total = f.who.adults != null && f.who.children != null ? f.who.adults + f.who.children : count;
    said('who', total ? `Whole family · ${total}` : 'Whole family', 'household', { kind: 'whole_household', adults: f.who.adults, children: f.who.children });
  } else if (count) fromProfile('who', count === 1 ? 'Just you' : `All ${count} of you`, 'household', { kind: 'whole_household' });
  else byDefault('who', 'Whole family', 'household', { kind: 'whole_household' });

  // --- kids' ages ----------------------------------------------------------------
  // The household already knows its own children, so "whole family" says it
  // all (owner, 9 Sep 2026: "it now knows the whole family"). A kids chip is
  // drawn only for what the profile cannot know: ages said this time, or more
  // children than the household has — "2 other kids", tappable for their ages.
  const saidAges = f.kids_ages.filter((k) => k.age != null || k.band);
  const saidCount = f.who.children ?? (f.who.kids_mentioned && !children.length ? 1 : 0);
  const extra = Math.max(0, saidCount - children.length);
  if (saidAges.length) {
    said('kids_ages', `Kids ${joinNames(saidAges.map((k) => (k.age != null ? String(k.age) : k.band)))}`, 'children', saidAges);
  } else if (extra > 0 && children.length) {
    said('kids_ages', `${extra} other ${extra === 1 ? 'kid' : 'kids'}`, 'children', [], { count: extra });
  } else if ((f.who.kids_mentioned || saidCount > 0) && !children.length) {
    if (asking) gap('kids_ages', 'Kids’ ages?', { count: Math.max(saidCount, 1) });
    else said('kids_ages', `${Math.max(saidCount, 1)} ${saidCount === 1 ? 'kid' : 'kids'}`, 'children', [], { count: Math.max(saidCount, 1) });
  } else if (asking && f.who.kids_mentioned && children.length && children.every((c) => c.age == null)) {
    // First time, and the household's children are on file without ages: the
    // one question that changes the plan (handoff C4).
    gap('kids_ages', 'Kids’ ages?', { count: children.length });
  }

  // --- what -------------------------------------------------------------------
  // Only what was said (owner, 9 Sep 2026: "it should just leave that blank
  // unless I've specified"): the places and kinds of thing they named first,
  // then a mood if they gave one. No default here.
  for (const w of f.wants) said('want', w.kind === 'type' ? cap(w.name) : w.name, w.type ? (KIND_ICON[w.type] ?? 'address') : w.kind === 'place' ? 'address' : 'inspire', w);
  if (f.vibe) said('vibe', VIBE_LABEL[f.vibe], VIBE_ICON[f.vibe], f.vibe);
  else if (f.vibe_no_preference) said('vibe', 'Anything', 'inspire', 'any');
  else if (asking && !f.wants.length) gap('vibe', 'Mood?');
  if (f.several_things === true) said('several_things', 'A few things', 'list', true);
  else if (f.several_things === false) said('several_things', 'One thing', 'list', false);
  if (f.indoors === true) said('indoors', 'Indoors', 'home', true);
  else if (f.indoors === false) said('indoors', 'Outdoors', 'outdoors', false);

  // --- food ------------------------------------------------------------------------
  // Whether food is on the table at all. Until they say something about eating,
  // the card says nothing about it — the household's diets are applied to every
  // list regardless, and a chip saying "Vegetarian" before a meal has been
  // mentioned answers a question nobody asked (owner, 9 Sep 2026).
  const foodSaid = f.food.diets.length || f.food.cuisines.length || f.food.must_haves.length || f.food.kinds.length || f.food.avoids.length || f.food.place || f.food.no_preference;
  const profileDiets = uniq((profile.diets ?? []).map(cap));
  const profileAllergies = uniq((profile.allergens ?? []).map((a) => `No ${a}`));
  for (const d of uniq(f.food.diets.map(cap))) said('food_diet', d, 'restaurant', d);
  if (foodSaid) {
    for (const d of profileDiets.filter((d) => !f.food.diets.some((x) => x.toLowerCase() === d.toLowerCase()))) fromProfile('food_diet', d, 'restaurant', d);
    for (const a of profileAllergies) fromProfile('food_allergy', a, 'allergen', a);
  }
  for (const c of uniq(f.food.cuisines.map(cap))) said('food_cuisine', c, 'restaurant', c);
  for (const k of uniq(f.food.kinds)) said('food_kind', k === 'pub' ? 'Pub' : cap(k), 'restaurant', k);
  for (const m of uniq(f.food.must_haves.map(cap)).filter((m) => !f.food.kinds.some((k) => m.toLowerCase().includes(k)))) said('food_must', m, 'restaurant', m);
  for (const a of uniq(f.food.avoids.map(cap))) said('food_avoid', a, 'allergen', a);
  if (f.food.place) said('food_place', f.food.place, 'restaurant', f.food.place);
  if (f.food.no_preference) said('food_pref', 'No preference', 'restaurant', 'none');

  // --- the questions (first-time only, at most two) ------------------------------------
  const questions = asking ? gapQuestions(slots, f, answers, children) : [];

  return {
    facts: f,
    tripType,
    slots,
    questions,
    ambiguities: f.ambiguities,
    // What the plan is judged by, for the results address and the trip.
    resolved: {
      tripType, start, end, timeOfDay: f.time_of_day, destination: f.destination, origin: slotValue(slots, 'origin'),
      travelMode: mode, maxMinutes: maxMinutes ?? 60, who: slotValue(slots, 'who'), vibe: f.vibe ?? (f.vibe_no_preference ? 'any' : null),
      kidsAges: slotValue(slots, 'kids_ages'), indoors: f.indoors, food: f.food,
      /** What the trip's browse leads with: the kinds of thing named, and the named places to put on the shortlist. */
      wants: f.wants,
      leadKinds: uniq(f.wants.map((w) => w.type).filter(Boolean)),
      leadFoodKinds: uniq(f.food.kinds),
    },
  };
}

const uniq = (xs) => [...new Set(xs.map((x) => String(x).trim()).filter(Boolean))];
const slotValue = (slots, key) => slots.find((x) => x.key === key && x.source !== 'gap')?.value ?? null;
const addDays = (iso, days) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

/** A tap on a chip, or an answer to a gap, written over the facts. */
export function applyOverrides(facts, overrides) {
  const f = structuredClone(facts);
  for (const [slot, v] of Object.entries(overrides || {})) {
    if (v === undefined || v === null) continue;
    switch (slot) {
      case 'trip_type': if (TRIP_TYPES.includes(v)) f.trip_type = v; break;
      case 'when': if (v && typeof v === 'object') { f.when = { start: date(v.start), end: date(v.end), as_said: null }; } break;
      case 'time_of_day': f.time_of_day = inSet(v, ['morning', 'afternoon', 'evening']); break;
      case 'destination': f.destination = s(v); break;
      case 'origin': if (v && typeof v === 'object') f.origin = { kind: inSet(v.kind, ['home', 'current', 'named']), name: s(v.name) }; break;
      case 'travel_mode': if (TRAVEL_MODES.includes(v)) f.travel_mode = v; break;
      case 'max_minutes': if (n(v) != null) f.max_minutes = v; break;
      case 'who': if (v && typeof v === 'object') f.who = { ...f.who, kind: inSet(v.kind, WHO_KINDS), names: list(v.names), adults: n(v.adults), children: n(v.children) }; break;
      case 'kids_ages': if (Array.isArray(v)) { f.kids_ages = v.map((k) => ({ name: s(k?.name), age: n(k?.age), band: inSet(k?.band, AGE_BANDS) ?? bandOfAge(n(k?.age)) })).filter((k) => k.age != null || k.band); f.who.kids_mentioned = true; } break;
      case 'want': if (Array.isArray(v)) f.wants = v.filter((w) => s(w?.name)).map((w) => ({ name: s(w.name), kind: w.kind === 'place' ? 'place' : 'type', type: inSet(w.type, THING_KINDS) })); break;
      case 'vibe': if (VIBES.includes(v)) { f.vibe = v; f.vibe_no_preference = false; } else if (v === 'any') { f.vibe = null; f.vibe_no_preference = true; } break;
      case 'several_things': f.several_things = b(v); break;
      case 'indoors': f.indoors = b(v); break;
      case 'food': if (v && typeof v === 'object') f.food = { ...f.food, diets: list(v.diets ?? f.food.diets), cuisines: list(v.cuisines ?? f.food.cuisines), must_haves: list(v.must_haves ?? f.food.must_haves), avoids: list(v.avoids ?? f.food.avoids), place: 'place' in v ? s(v.place) : f.food.place, no_preference: 'no_preference' in v ? Boolean(v.no_preference) : f.food.no_preference }; break;
      default: break;
    }
  }
  return f;
}

/**
 * Which gaps are worth a screen (handoff C4: "only when a gap changes the plan"),
 * in the order they are asked, capped at two. Kids' ages only when "kids" was
 * said without them; the kind of day first when nothing about when was said.
 */
function gapQuestions(slots, f, answers, children) {
  const gaps = new Set(slots.filter((x) => x.source === 'gap').map((x) => x.key));
  const skipped = new Set(Object.keys(answers || {}).filter((k) => answers[k] === null));
  const out = [];
  if (gaps.has('trip_type') && !skipped.has('trip_type')) {
    out.push({ slot: 'trip_type', title: 'What kind of day is it?', why: 'A day out and a weekend away are planned differently.', options: TRIP_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] })), skip: 'Skip · a day out' });
  }
  if (gaps.has('kids_ages') && !skipped.has('kids_ages')) {
    const count = f.who.children ?? Math.max(children.length, 1);
    out.push({ slot: 'kids_ages', title: 'How old are the kids?', why: '“Active” means very different things at 4 and at 12 — this picks the right kind of active.', children: Array.from({ length: Math.min(6, Math.max(1, count)) }, (_, i) => ({ index: i + 1, name: children[i]?.name ?? null })), bands: AGE_BANDS, skip: 'Skip · plan for all ages', remember: 'Remember them' });
  }
  if (gaps.has('max_minutes') && !skipped.has('max_minutes')) {
    out.push({ slot: 'max_minutes', title: 'How far would you go?', why: 'Each way. It decides how wide Epic looks.', options: MINUTE_BANDS.map((m) => ({ value: m, label: minutesLabel(m) })), skip: 'Skip · about an hour' });
  }
  if (gaps.has('vibe') && !skipped.has('vibe')) {
    out.push({ slot: 'vibe', title: 'What’s the mood?', why: 'Fun, culture, active or relaxed — or a bit of everything.', options: [...VIBES.map((v) => ({ value: v, label: VIBE_LABEL[v] })), { value: 'any', label: 'Don’t mind' }], skip: 'Skip · anything' });
  }
  return out.slice(0, 2);
}

// ---------------------------------------------------------------------------
// where it leads
// ---------------------------------------------------------------------------

/**
 * The Inspire address that shows the plan (C5, R5b): the same list as always,
 * set by what was said. Only what differs from Inspire's own defaults is
 * written (routes.ts's rule), plus the intake so the chip row can be drawn.
 */
export function resultsHref({ resolved, intakeId, originPoint = null, destinationPoint = null, memberCount = 0 }) {
  const category = resolved.vibe ? VIBE_TO_CATEGORY[resolved.vibe] : null;
  const foodOnly = !resolved.vibe && !resolved.indoors && (resolved.food.cuisines.length || resolved.food.must_haves.length || resolved.food.place) && !resolved.destination;
  const path = foodOnly ? '/inspire/food' : category ? `/inspire/${category}` : '/inspire';
  const q = new URLSearchParams();
  const at = destinationPoint ?? (resolved.origin?.kind === 'named' || resolved.origin?.kind === 'current' ? originPoint : null);
  if (at?.lat != null) { q.set('at', `${at.lat.toFixed(5)},${at.lng.toFixed(5)}`); if (at.label) q.set('where', at.label); if (at.locality && at.locality !== at.label) q.set('locality', at.locality); }
  if (resolved.maxMinutes && resolved.maxMinutes !== 60) q.set('travel', String(resolved.maxMinutes));
  const by = MODE_TO_INSPIRE[resolved.travelMode] ?? 'drive';
  if (by !== 'drive') q.set('by', by);
  // Who is coming travels only when it is some of the household: Inspire ranks
  // for whoever is named, and treats an absent `who` as everybody. Everybody
  // by name is not written (the first deployed run wrote all three and the
  // list came back empty, 9 Sep 2026).
  if (resolved.who?.kind === 'named' && resolved.who.memberIds?.length && resolved.who.memberIds.length < memberCount) q.set('who', resolved.who.memberIds.join(','));
  if (intakeId) q.set('intake', intakeId);
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * The trip the fact card creates (R3 "Create trip"), in the shape
 * `POST /api/trips` already takes — so the trip is made by the same code that
 * makes every other one.
 */
export function tripDraft({ resolved, destinationPoint = null, members = [] }) {
  const holiday = resolved.tripType === 'holiday' || resolved.tripType === 'weekend' || (resolved.end && resolved.end !== resolved.start);
  const attending = resolved.who?.kind === 'named' && resolved.who.memberIds?.length ? resolved.who.memberIds
    : resolved.who?.kind === 'just_me' ? members.filter((m) => !m.isMinor).slice(0, 1).map((m) => m.id)
      : undefined;
  const arriveAt = resolved.timeOfDay === 'afternoon' ? '13:30' : resolved.timeOfDay === 'evening' ? '18:00' : '10:00';
  const base = {
    travelMode: MODE_TO_TRIP[resolved.travelMode] ?? 'driving',
    attendingMemberIds: attending,
    title: resolved.destination ? `${resolved.destination} · ${resolved.tripType === 'today' ? 'today' : holiday ? 'away' : 'day out'}` : undefined,
  };
  if (holiday) {
    return { ...base, kind: 'holiday', startDate: resolved.start, endDate: resolved.end ?? addDays(resolved.start, 2), placeText: resolved.destination ?? undefined, place: destinationPoint ?? undefined };
  }
  return {
    ...base, kind: 'day', date: resolved.start, arriveAt, allowMinutes: resolved.timeOfDay ? 240 : 360,
    destinationText: resolved.destination ?? undefined, destination: destinationPoint ?? undefined,
    originText: resolved.origin?.kind === 'named' ? resolved.origin.name : undefined,
  };
}

/**
 * What a first request taught us that the profile does not hold yet (D1: "Remember
 * that you're vegetarian and the kids are 6 and 9?").
 */
export function harvestOffer({ facts, members = [], profile = {} }) {
  const items = [];
  const diets = facts.food.diets.filter((d) => !(profile.diets ?? []).some((p) => p.toLowerCase() === d.toLowerCase()));
  if (diets.length) items.push({ kind: 'diet', values: diets });
  // A band answered by tap is kept as the middle of the band; the Household
  // tab can sharpen it to a birthday later (Codex review, 9 Sep 2026).
  const ages = facts.kids_ages.map((k) => ({ ...k, age: k.age ?? ageOfBand(k.band), approx: k.age == null && !!k.band })).filter((k) => k.age != null);
  const children = members.filter((m) => m.isMinor || (m.age != null && m.age < 18));
  // Each household child can account for one said child, not all of them:
  // one ten-year-old on file and two "9-12" answers is one new child.
  // Exact ages claim their child first; the bands take what is left, so the
  // order the children were said in cannot cost one of them a match.
  const spare = [...children];
  const claimed = new Set();
  for (const k of ages.filter((k) => !k.approx)) {
    const at = spare.findIndex((c) => c.age === k.age);
    if (at >= 0) { spare.splice(at, 1); claimed.add(k); }
  }
  for (const k of ages.filter((k) => k.approx)) {
    const at = spare.findIndex((c) => c.age != null && bandOfAge(c.age) === k.band);
    if (at >= 0) { spare.splice(at, 1); claimed.add(k); }
  }
  const unknownAges = ages.filter((k) => !claimed.has(k));
  if (unknownAges.length) items.push({ kind: 'kids', ages: unknownAges.map((k) => ({ name: k.name, age: k.age, band: k.band, approx: k.approx })) });
  if (!items.length) return null;
  const parts = [];
  if (diets.length) parts.push(`you're ${diets.join(' and ')}`);
  if (unknownAges.length) parts.push(`the kids are ${joinNames(unknownAges.map((k) => (k.approx ? k.band : String(k.age))))}`);
  return { text: `Remember that ${parts.join(' and ')}?`, items };
}

/** The input stage two reads for a trip request. */
export function tripFactsInput({ transcript, today, timezone, home, members, page = null, previous = null }) {
  const people = members.map((m) => `${m.name}${m.age != null ? ` (${m.age})` : m.isMinor ? ' (child)' : ''}`);
  const lines = [
    `Today is ${today} (${timezone}).`,
    home ? `The household's home is ${home}.` : 'No home address is set.',
    people.length ? `The household: ${people.join(', ')}.` : 'Nobody in the household is named yet.',
    page ? `This is page ${page.n} of 3 of a short wizard; the question asked was "${page.question}". Fill only what was said; other slots stay null.` : null,
    previous ? `Facts already gathered (fill only what this transcript adds or changes): ${JSON.stringify(previous).slice(0, 1500)}` : null,
    '',
    'Transcript:',
    transcript,
  ].filter((l) => l !== null);
  return lines.join('\n');
}
