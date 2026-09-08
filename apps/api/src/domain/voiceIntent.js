/**
 * Stage two: what a transcript is read into (owner's brief, 8 Sep 2026).
 *
 * The schema is the brief's starting point — destination, origin, dates or
 * duration, party, budget, interests, exclusions, accessibility, trip type,
 * ambiguities — plus two things the experiment needs: which language the words
 * were in (it drives the language the plan is answered in), and the
 * corrections the model resolved, so a lab run can show that "the 14th — no,
 * the 15th" became the 15th on purpose.
 *
 * Written as plain JSON Schema rather than zod because it is sent to OpenAI's
 * strict mode, whose rules are its own: every property required, no additional
 * properties, and "not said" spelt as a `["…", "null"]` union. `schemaIsStrict`
 * checks those rules, and the test runs it, because a schema that breaks them
 * fails at the provider with a 400 and not before.
 */

const nullable = (type, extra = {}) => ({ type: [type, 'null'], ...extra });
const str = (description) => nullable('string', { description });
const int = (description) => nullable('integer', { description });
const num = (description) => nullable('number', { description });
const strings = (description) => ({ type: 'array', items: { type: 'string' }, description });

export const VOICE_INTENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    language: str('ISO-639-1 code of the language the transcript is in (en, fr, pt…); null only if it truly cannot be told'),
    trip_type: nullable('string', { enum: ['multi_day', 'day_out', null], description: '"multi_day" when they will sleep away from home; "day_out" for a single day; null if not said' }),
    destination: str('Where they are going, as they said it — a city, region, country or named place; null if not said'),
    origin: str('Where they are starting from, if they said; null otherwise'),
    dates: {
      type: 'object', additionalProperties: false,
      properties: {
        start: str('First day as YYYY-MM-DD when a date was said or can be resolved from words like "next Saturday" against today\'s date; null otherwise'),
        end: str('Last day as YYYY-MM-DD, same rule; null otherwise'),
        duration_days: int('How many days, when they said a length rather than dates ("a long weekend" is 3, "a week" is 7); null otherwise'),
        as_said: str('The words they used about when, verbatim, including any correction; null if nothing was said about when'),
      },
      required: ['start', 'end', 'duration_days', 'as_said'],
    },
    party: {
      type: 'object', additionalProperties: false,
      properties: {
        adults: int('How many adults, if said; null otherwise'),
        children: int('How many children, if said; null otherwise'),
        ages: { type: 'array', items: { type: 'integer' }, description: 'Children\'s ages that were said, in years; empty if none' },
        as_said: str('Who is coming, in their words ("me, Gina and the two kids"); null if not said'),
      },
      required: ['adults', 'children', 'ages', 'as_said'],
    },
    budget: {
      type: 'object', additionalProperties: false,
      properties: {
        amount: num('A number they said, in the currency they said it in; null if none'),
        currency: str('ISO-4217 code when a currency was said or is unambiguous from the words ("quid", "£" → GBP; "euros" → EUR); null otherwise'),
        per: nullable('string', { enum: ['trip', 'day', 'person', 'night', null], description: 'What the amount is for, if said; null otherwise' }),
        level: nullable('string', { enum: ['cheap', 'mid', 'treat', null], description: 'A level said in words rather than numbers ("on a budget", "not silly", "push the boat out"); null otherwise' }),
      },
      required: ['amount', 'currency', 'per', 'level'],
    },
    interests: strings('Things they want — activities, food, kinds of place — each in their own words; empty if none'),
    exclusions: strings('Things they said they do not want or must avoid, including allergies and dislikes, each in their own words; empty if none'),
    accessibility: strings('Access needs they said — step-free, a wheelchair, a buggy, short walks; empty if none'),
    ambiguities: {
      type: 'array',
      description: 'Anything genuinely unclear whose answer changes the plan. Ask; never invent a plausible answer',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          about: { type: 'string', description: 'Which field it concerns (destination, dates, party, budget…)' },
          question: { type: 'string', description: 'One short question in the transcript\'s language, as the app would ask it' },
          options: strings('Two to four short answers they could tap, when the choice is between named things; empty when it is open'),
        },
        required: ['about', 'question', 'options'],
      },
    },
    corrections: {
      type: 'array',
      description: 'Every place the speaker changed their mind mid-sentence ("the 14th — no, sorry, the 15th"). The final value is what the fields hold; this records that it was a correction',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          field: { type: 'string', description: 'Which field it changed' },
          from: { type: 'string', description: 'What they said first' },
          to: { type: 'string', description: 'What they settled on' },
        },
        required: ['field', 'from', 'to'],
      },
    },
    summary: { type: 'string', description: 'One short sentence in the transcript\'s language saying what was understood — only what was said, nothing added' },
  },
  required: ['language', 'trip_type', 'destination', 'origin', 'dates', 'party', 'budget', 'interests', 'exclusions', 'accessibility', 'ambiguities', 'corrections', 'summary'],
};

/**
 * The rules stage two works to (the brief, verbatim in spirit): extract only
 * what was said, null over a guess, resolve corrections to the final value,
 * put the unclear in ambiguities rather than inventing an answer. Stable text,
 * so it caches; everything that changes goes in the input.
 */
export const VOICE_INTENT_SYSTEM = `You read a faithful transcript of somebody speaking to a travel planner and fill in a form about what they said.

Rules:
1. Extract only what was actually said. If something was not said, the field is null (or an empty list). Never fill a field from what would be typical or likely.
2. When the speaker corrects themselves mid-sentence ("the 14th — no, sorry, the 15th", "two nights, actually three"), the field holds the final stated value, and the change is recorded in corrections.
3. When something is genuinely unclear and the plan would differ depending on the answer — two places with the same name, a date that could be this year or next, "we" with no number — put a question in ambiguities rather than choosing. Do not raise an ambiguity for things that were simply not mentioned.
4. Relative dates ("next Saturday", "the week after Easter") are resolved against the date given in the input, in the speaker's time zone; if they cannot be resolved with certainty, leave start and end null and keep the words in as_said.
5. Do not tidy, translate or reinterpret names: a place is written as the speaker named it. If the transcript's spelling of a place is clearly a mishearing of a real place you can name with confidence, use the real name and keep nothing else.
6. Reply in the language of the transcript: the summary and every question are in that language.
7. The transcript may contain hesitations, repeated words and false starts. They are not content. Do not report them.`;

/**
 * Whether a schema keeps to strict mode's rules, and why not if not.
 *
 * Walks every object: `additionalProperties: false`, every property named in
 * `required`, and every "optional" field spelt as a null union rather than
 * left out of `required`.
 */
export function schemaIsStrict(schema, path = '$') {
  const problems = [];
  const walk = (node, at) => {
    if (!node || typeof node !== 'object') return;
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (types.includes('object')) {
      if (node.additionalProperties !== false) problems.push(`${at}: additionalProperties must be false`);
      const props = Object.keys(node.properties || {});
      const required = new Set(node.required || []);
      for (const p of props) if (!required.has(p)) problems.push(`${at}.${p}: every property must be required (use a null union for "not said")`);
      for (const p of props) walk(node.properties[p], `${at}.${p}`);
    }
    if (types.includes('array') && node.items) walk(node.items, `${at}[]`);
  };
  walk(schema, path);
  return { ok: problems.length === 0, problems };
}

/**
 * After the provider: the object it returned, tidied to Epic's own
 * conventions. Empty strings become null (the model sometimes writes "" for
 * nothing), lists lose blanks, and a date that is not a date is dropped.
 */
export function normaliseVoiceIntent(raw) {
  const s = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const date = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const list = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x.trim() : x)).filter((x) => x !== '' && x != null) : []);
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const o = raw ?? {};
  return {
    language: s(o.language)?.toLowerCase().slice(0, 5) ?? null,
    trip_type: o.trip_type === 'multi_day' || o.trip_type === 'day_out' ? o.trip_type : null,
    destination: s(o.destination),
    origin: s(o.origin),
    dates: { start: date(o.dates?.start), end: date(o.dates?.end), duration_days: n(o.dates?.duration_days), as_said: s(o.dates?.as_said) },
    party: { adults: n(o.party?.adults), children: n(o.party?.children), ages: list(o.party?.ages).filter((x) => typeof x === 'number'), as_said: s(o.party?.as_said) },
    budget: { amount: n(o.budget?.amount), currency: s(o.budget?.currency)?.toUpperCase() ?? null, per: s(o.budget?.per), level: s(o.budget?.level) },
    interests: list(o.interests),
    exclusions: list(o.exclusions),
    accessibility: list(o.accessibility),
    ambiguities: list(o.ambiguities).filter((a) => a && typeof a === 'object' && s(a.question)).map((a) => ({ about: s(a.about) ?? 'plan', question: s(a.question), options: list(a.options) })),
    corrections: list(o.corrections).filter((c) => c && typeof c === 'object').map((c) => ({ field: s(c.field) ?? '', from: s(c.from) ?? '', to: s(c.to) ?? '' })),
    summary: s(o.summary) ?? '',
  };
}

/** The input stage two reads: the transcript, and the facts it needs to resolve dates and who "we" might be. */
export function voiceIntentInput({ transcript, language = null, today, timezone = 'Europe/London', home = null, members = [], context = null }) {
  const lines = [
    `Today is ${today} (${timezone}).`,
    home ? `The household's home is ${home}.` : null,
    members.length ? `The household's people are: ${members.join(', ')}. Use these names only to understand who "we" might be when named; never add anyone who was not mentioned.` : null,
    language ? `The transcript's language is believed to be "${language}".` : null,
    context ? `Context from the app: ${JSON.stringify(context).slice(0, 1500)}` : null,
    '',
    'Transcript:',
    transcript,
  ].filter((l) => l !== null);
  return lines.join('\n');
}
