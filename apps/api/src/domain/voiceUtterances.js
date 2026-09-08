/**
 * Sentences to read aloud in the voice lab.
 *
 * The brief asks for word error rate "on real travel utterances with place
 * names" — so these have place names the recogniser has to get right (Sintra,
 * Alfama, Machynlleth, Cirencester), self-corrections that stage two has to
 * resolve, party sizes, budgets, exclusions, and a few not in English, because
 * nothing here may assume English. Each is a reference transcript: what was
 * said, faithfully, punctuation and all, so a transcript is judged against the
 * words and not against a tidier version of them.
 *
 * `expect` is the handful of fields a correct stage-two reading must hold, for
 * the lab to say whether a mode's transcript still produced the right plan.
 */
export const UTTERANCES = [
  {
    id: 'lisbon-correction', language: 'en',
    text: 'We want to go to Lisbon for four nights from the 14th — no, sorry, the 15th of October. Two adults and two kids, seven and ten. We want to see Sintra and eat in Alfama, and nothing with a long queue.',
    expect: { destination: 'Lisbon', 'dates.start': '2026-10-15', 'party.adults': 2, 'party.children': 2 },
  },
  {
    id: 'wales-day-out', language: 'en',
    text: 'A day out on Saturday from home to Machynlleth, or maybe Aberystwyth, by train, with the dog. Somewhere for a long walk and a decent pub lunch, no more than sixty quid all in.',
    expect: { trip_type: 'day_out', 'budget.amount': 60, 'budget.currency': 'GBP' },
  },
  {
    id: 'cotswolds-budget', language: 'en',
    text: 'Three nights in the Cotswolds, Cirencester or Bourton-on-the-Water, the weekend after next. Just the two of us, budget about three hundred a night for the room, and my wife is coeliac so gluten-free matters.',
    expect: { 'party.adults': 2, 'budget.per': 'night' },
  },
  {
    id: 'porto-week', language: 'en',
    text: 'A week in Porto in the first half of November with my mum, who uses a walking stick, so nothing too hilly and step-free where possible. She likes markets and fado. No seafood for me.',
    expect: { destination: 'Porto', 'dates.duration_days': 7 },
  },
  {
    id: 'edinburgh-kids', language: 'en',
    text: 'Edinburgh for two nights over half term, that is the last week of October. Me, Gina, Phoenix who is nine and the baby. We need a cot. Museums, the castle, somewhere child-friendly for dinner. Actually make it three nights.',
    expect: { destination: 'Edinburgh' },
  },
  {
    id: 'bath-spa', language: 'en',
    text: 'Bath, one night, a Saturday in the next month or so, a hotel with a spa near the centre. Somewhere really good for dinner, no chains. We will drive from Reading.',
    expect: { destination: 'Bath', origin: 'Reading' },
  },
  {
    id: 'ambiguous-newport', language: 'en',
    text: 'Take us to Newport for the day next Sunday, we fancy the coast and a proper Sunday roast.',
    expect: {},
    note: 'Newport is in Wales, on the Isle of Wight, in Shropshire and in Pembrokeshire: a correct reading asks which.',
  },
  {
    id: 'york-family', language: 'en',
    text: 'York, a long weekend in early December for the Christmas market. Six of us: four adults and two teenagers, fourteen and sixteen. One of the adults is vegan. Train from King\'s Cross.',
    expect: { 'party.adults': 4, 'party.children': 2 },
  },
  {
    id: 'french-bretagne', language: 'fr',
    text: 'On aimerait passer cinq jours en Bretagne fin août, vers Saint-Malo ou Dinard, avec nos deux enfants de six et neuf ans. Pas de fruits de mer pour le petit, il est allergique.',
    expect: { language: 'fr', 'party.children': 2, 'dates.duration_days': 5 },
  },
  {
    id: 'spanish-sevilla', language: 'es',
    text: 'Queremos ir a Sevilla tres noches en marzo, somos dos adultos, con un presupuesto de unos mil euros en total, y nos gusta el flamenco y la buena comida.',
    expect: { language: 'es', destination: 'Sevilla', 'budget.currency': 'EUR' },
  },
  {
    id: 'german-berlin', language: 'de',
    text: 'Wir möchten im Mai für vier Tage nach Berlin, zwei Erwachsene, ohne Kinder. Museen, gutes Essen, aber bitte keine Touristenfallen.',
    expect: { language: 'de', destination: 'Berlin', 'dates.duration_days': 4 },
  },
  {
    id: 'oxford-quick', language: 'en',
    text: 'Oxford tomorrow, just me, a couple of hours in the Ashmolean and a coffee. Bus from Bicester.',
    expect: { trip_type: 'day_out', destination: 'Oxford', 'party.adults': 1 },
  },
];

/** Whether an extracted intent holds what the utterance says it must. */
export function meetsExpectation(intent, expect = {}) {
  const misses = [];
  for (const [path, want] of Object.entries(expect)) {
    const got = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), intent);
    const same = typeof want === 'string' && typeof got === 'string'
      ? got.toLowerCase().includes(want.toLowerCase())
      : got === want;
    if (!same) misses.push({ path, want, got: got ?? null });
  }
  return { ok: misses.length === 0, misses };
}
