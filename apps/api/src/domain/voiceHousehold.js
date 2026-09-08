/**
 * The household, spoken (voice intake handoff, 8 Sep 2026 — Option D and the
 * two-minute set-up, row O).
 *
 * Three breaths, three schemas:
 *
 *   WHO_SCHEMA       O3 — "Say everyone in one go": names, grown-up or child,
 *                    an age if said, and which one is the speaker.
 *   FOOD_SCHEMA      O4 — diets, allergies, dislikes and favourites, each for
 *                    the whole household or for one named person.
 *   LIKES_SCHEMA     O4b / D3 — what people love doing and would rather not,
 *                    mapped onto our own shelves (Active · Walks, Culture ·
 *                    Castles) so it feeds the ranking rather than a free-text
 *                    list nobody reads.
 *
 * Nothing here writes anything: `applyFood` and `applyLikes` turn confirmed
 * chips into the household's constraint rows through the same repository the
 * Household tab uses, and only after the screen's "Looks right".
 */

import { resolveConcept } from './concepts.js';

const nullable = (type, extra = {}) => ({ type: [type, 'null'], ...extra });
const str = (d) => nullable('string', { description: d });
const int = (d) => nullable('integer', { description: d });
const strings = (d) => ({ type: 'array', items: { type: 'string' }, description: d });

export const WHO_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    people: {
      type: 'array',
      description: 'Everyone named, in the order said',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'Their name as said ("me" becomes the speaker\'s own name if given, else "Me")' },
          role: nullable('string', { enum: ['adult', 'child', null], description: '"adult" or "child"; null if it cannot be told' }),
          age: int('Age in years if said; null otherwise'),
          relationship: str('partner, son, daughter, mum, dad, friend… as said; null otherwise'),
          is_speaker: { type: 'boolean', description: 'True for the person speaking ("it\'s me, Sam")' },
        },
        required: ['name', 'role', 'age', 'relationship', 'is_speaker'],
      },
    },
  },
  required: ['people'],
};

export const WHO_SYSTEM = `You read a transcript of somebody naming the people in their household to a family planner, and list them.

Rules: only people actually named or counted ("the twins" without names are two entries called "Twin 1" and "Twin 2"). "Me"/"I" is the speaker: use their name if they give it, else "Me". Partners, parents and friends are adults; sons, daughters and anyone with an age under 18 are children. An age counts only if said. Never invent a person.`;

export const FOOD_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['diet', 'allergy', 'dislike', 'favourite'], description: 'diet (vegetarian, vegan, halal, gluten-free…), allergy (a food that must be excluded for health), dislike (would rather not), favourite (loves)' },
          value: { type: 'string', description: 'The food, diet or ingredient, in a word or two' },
          who: str('The named person it applies to; null when it applies to everyone ("we\'re all vegetarian")'),
        },
        required: ['kind', 'value', 'who'],
      },
    },
  },
  required: ['items'],
};

export const FOOD_SYSTEM = `You read a transcript about what a household eats and list each fact once.

Rules: "allergic" or "allergy" or "intolerant" is an allergy; "doesn't like", "won't touch", "hates" is a dislike; "loves", "favourite", "always wants" is a favourite; vegetarian/vegan/pescatarian/halal/kosher/gluten-free/dairy-free are diets. Attach each fact to the person named for it, or to nobody when it was said of everyone. Only what was said.`;

export const LIKES_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['love', 'avoid'], description: 'love (enjoys, is into, wants) or avoid (hates, won\'t, nobody wants)' },
          phrase: { type: 'string', description: 'The activity in the speaker\'s own words ("climbing", "a castle", "queuing")' },
          category: str('The best matching category key from the list given, or null if none fits'),
          subcategory: str('The best matching subcategory key from the list given, or null if none fits'),
          who: str('The named person it applies to; null when said of everyone'),
        },
        required: ['kind', 'phrase', 'category', 'subcategory', 'who'],
      },
    },
    mobility: str('Anything said about getting about — a pushchair, a walking stick, short walks only; null otherwise'),
  },
  required: ['items', 'mobility'],
};

export const LIKES_SYSTEM = `You read a transcript about what a household likes doing on a day out and list each like or avoid once, mapped onto the planner's own categories.

Rules: use only category and subcategory keys from the list given; when nothing fits, leave them null and keep the phrase. "The kids" means every child named in the household. Attach each item to the person named for it, or to nobody when it was said of everyone. "Nobody wants to queue" is an avoid for everyone. Only what was said.`;

const s = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Names in the transcript → members, by first name, so "Priya" finds Priya Sharma. */
export function matchMember(name, members) {
  if (!name) return null;
  const want = name.trim().toLowerCase();
  return members.find((m) => m.name.toLowerCase() === want)
    ?? members.find((m) => m.name.toLowerCase().split(/\s+/)[0] === want.split(/\s+/)[0])
    ?? members.find((m) => m.name.toLowerCase().startsWith(want))
    ?? null;
}

export function normaliseWho(raw) {
  const people = (Array.isArray(raw?.people) ? raw.people : []).map((p) => {
    const age = n(p?.age);
    const role = p?.role === 'adult' || p?.role === 'child' ? p.role : age != null ? (age < 18 ? 'child' : 'adult') : null;
    return { name: s(p?.name) ?? 'Someone', role, age, relationship: s(p?.relationship), isSpeaker: Boolean(p?.is_speaker) };
  });
  // One speaker at most, and the first if the model marked several.
  let seen = false;
  for (const p of people) { if (p.isSpeaker) { if (seen) p.isSpeaker = false; seen = true; } }
  return people;
}

export function normaliseFood(raw, members = []) {
  return (Array.isArray(raw?.items) ? raw.items : [])
    .filter((i) => ['diet', 'allergy', 'dislike', 'favourite'].includes(i?.kind) && s(i?.value))
    .map((i) => {
      const member = matchMember(s(i.who), members);
      return { kind: i.kind, value: s(i.value).toLowerCase(), who: s(i.who), memberId: member?.id ?? null, memberName: member?.name ?? s(i.who) };
    });
}

export function normaliseLikes(raw, members = [], vocab = { categories: [], subcategories: [] }) {
  const cats = new Set(vocab.categories.map((c) => c.key));
  const subs = new Map(vocab.subcategories.map((x) => [x.key, x]));
  const children = members.filter((m) => m.isMinor || (m.age != null && m.age < 18));
  const items = [];
  for (const i of (Array.isArray(raw?.items) ? raw.items : [])) {
    if (!['love', 'avoid'].includes(i?.kind) || !s(i?.phrase)) continue;
    const category = cats.has(i.category) ? i.category : (subs.get(i.subcategory)?.category_key ?? null);
    const subcategory = subs.has(i.subcategory) ? i.subcategory : null;
    const who = s(i.who);
    // "The kids" is every child, one chip each.
    const targets = who && /^(the )?(kids|children|little ones)$/i.test(who) ? children : who ? [matchMember(who, members)].filter(Boolean) : [null];
    if (!targets.length) targets.push(null);
    for (const m of targets) {
      items.push({
        kind: i.kind, phrase: s(i.phrase).toLowerCase(), category, subcategory,
        label: subcategory ? subs.get(subcategory).label : vocab.categories.find((c) => c.key === category)?.label ?? cap(s(i.phrase)),
        who, memberId: m?.id ?? null, memberName: m?.name ?? (who && !/^(the )?(kids|children)$/i.test(who) ? who : null),
      });
    }
  }
  return { items, mobility: s(raw?.mobility) };
}

const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/** The list stage two chooses from, as text — our shelves, keyed. */
export function likesVocabularyText(vocab) {
  return vocab.categories.map((c) => `${c.key} (${c.label}): ${vocab.subcategories.filter((x) => x.category_key === c.key).map((x) => `${x.key}=${x.label}`).join(', ')}`).join('\n');
}

/**
 * Food chips → constraint rows. `scopeTo(memberIds)` decides who "everyone" is
 * (every member for a household breath; the one person for D3). Returns what was
 * written, so the screen can say so.
 */
export async function applyFood(items, { members, households, everyone }) {
  const written = [];
  for (const it of items) {
    const kind = it.kind === 'allergy' ? 'allergen' : it.kind === 'favourite' ? 'like' : it.kind; // diet | dislike | like | allergen
    const targets = it.memberId ? members.filter((m) => m.id === it.memberId) : everyone;
    for (const m of targets) {
      const concept = kind === 'allergen' ? null : resolveConcept(it.value, { kinds: kind === 'diet' ? ['diet'] : ['dish', 'cuisine', 'ingredient', 'style'] });
      await households.upsertConstraint(m.id, { kind, value: (concept?.label ?? it.value).toLowerCase(), conceptKey: concept?.key ?? null, conceptKind: concept?.kind ?? null, favourite: it.kind === 'favourite' });
      written.push({ memberId: m.id, kind, value: concept?.label ?? it.value });
    }
  }
  return written;
}

/** Likes and avoids → like/dislike rows on the experience side, by our shelf's label. */
export async function applyLikes(items, { members, households, everyone }) {
  const written = [];
  for (const it of items) {
    const kind = it.kind === 'love' ? 'like' : 'dislike';
    const targets = it.memberId ? members.filter((m) => m.id === it.memberId) : everyone;
    const value = (it.label ?? it.phrase).toLowerCase();
    const concept = resolveConcept(it.phrase, { kinds: ['experience'] }) ?? resolveConcept(value, { kinds: ['experience'] });
    for (const m of targets) {
      await households.upsertConstraint(m.id, {
        kind, value: (concept?.label ?? value).toLowerCase(), conceptKey: concept?.key ?? null, conceptKind: concept?.kind ?? 'experience', favourite: false,
      });
      written.push({ memberId: m.id, kind, value: concept?.label ?? value });
    }
  }
  return written;
}
