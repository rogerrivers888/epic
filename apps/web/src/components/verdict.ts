/**
 * What this family made of a place, worked out from every star they gave it
 * (owner, 7 Sep 2026: "I feel like the review of the dishes should then blend
 * into an overall review from the family review stars").
 *
 * Kept apart from the component that draws it so the arithmetic can be tested
 * on its own — it is the number the household will argue with, and it has to be
 * one they can follow.
 *
 * The rules:
 *
 *  - **A star is a star, wherever it was given.** The one given to the place
 *    after a visit and the one given to a plate on the table are the same act.
 *  - **A person is the unit, not a plate.** Somebody who orders four courses
 *    does not outvote somebody who had one: each person's stars average into
 *    their own score, and the people average into the family's.
 *  - **Silence is not a number.** A plate nobody starred was fine and writes
 *    nothing (the rating rule, owner, 4 Sep 2026), so it is not averaged in as
 *    a middling score — and "not great" is not a number either. It is a thing
 *    somebody said, carried through by name rather than turned into a figure
 *    nobody chose.
 */

type Take = 'loved' | 'fine' | 'not_for_me';

export type VerdictTake = { memberId: string; member?: string; subject: string; take: Take; comment: string | null; score?: number | null };
export type VerdictVisit = { id: string; visitedOn: string; takes?: VerdictTake[] };
export type VerdictMember = { id: string; name: string };

export type Said = {
  memberId: string;
  first: string;
  scores: number[];
  /** How many of their stars were given to a plate, and how many to the place itself. */
  plates: number;
  visitScores: number;
  notGreat: string[];
};

export type Verdict = {
  /** Out of five, or null when nobody has starred anything here. */
  score: number | null;
  said: Said[];
  meals: { id: string; on: string; lines: { who: string; what: string; score: number | null; notGreat: boolean; comment: string | null }[] }[];
  starsGiven: number;
  notGreat: number;
};

export const firstName = (name?: string | null) => String(name ?? '').trim().split(/\s+/)[0] || 'Someone';
export const mean = (ns: number[]) => (ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null);

/** Every star this household has given here, gathered per person and per meal. */
export function verdictOf(visits: VerdictVisit[], members: VerdictMember[] = []): Verdict {
  const said = new Map<string, Said>();
  const meals: Verdict['meals'] = [];
  let starsGiven = 0;
  let notGreat = 0;

  for (const visit of [...visits].sort((a, b) => String(b.visitedOn).localeCompare(String(a.visitedOn)))) {
    const lines: Verdict['meals'][number]['lines'] = [];
    for (const t of visit.takes ?? []) {
      const name = firstName(t.member ?? members.find((m) => m.id === t.memberId)?.name);
      const at = said.get(t.memberId) ?? { memberId: t.memberId, first: name, scores: [], plates: 0, visitScores: 0, notGreat: [] };
      const what = t.subject === 'visit' ? 'the place itself' : t.subject;
      if (t.score != null) {
        at.scores.push(Number(t.score));
        starsGiven += 1;
        if (t.subject === 'visit') at.visitScores += 1; else at.plates += 1;
      } else if (t.take === 'not_for_me') {
        at.notGreat.push(what);
        notGreat += 1;
      }
      said.set(t.memberId, at);
      if (t.score != null || t.take === 'not_for_me') {
        lines.push({ who: name, what, score: t.score ?? null, notGreat: t.take === 'not_for_me', comment: t.comment ?? null });
      }
    }
    if (lines.length) meals.push({ id: visit.id, on: visit.visitedOn, lines });
  }

  const people = [...said.values()].filter((s) => s.scores.length);
  return { score: mean(people.map((s) => mean(s.scores) as number)), said: [...said.values()], meals, starsGiven, notGreat };
}
