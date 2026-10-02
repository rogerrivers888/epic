/**
 * The homepage (registered as W3 · "story"; the v3 design approved 2 Oct 2026) —
 * every word on the page, by locale. `PLAN` is the app's intro screen 1h-1
 * (Day out | Trip): chapter 01's two lists, shared with W4's phone.
 */
import type { Strings } from '../../i18n';

export type PlanRow = { t: string; name: string; meta: string };
export type PlanWords = {
  dayOut: string; trip: string;
  dayHead: string; tripHead: string;
  dayRows: PlanRow[]; tripRows: PlanRow[];
};

const PLAN_GB: PlanWords = {
  dayOut: 'Day out', trip: 'Trip',
  dayHead: 'Saturday · Richmond', tripHead: 'Cornwall · 3 days',
  dayRows: [
    { t: '10:00', name: 'Kew Gardens', meta: 'Treetop walkway · 2 hrs' },
    { t: '12:30', name: 'The Glasshouse', meta: 'Lunch · table for 5' },
    { t: '14:30', name: 'Richmond Park', meta: 'Deer spotting · 1.5 hrs' },
  ],
  tripRows: [
    { t: 'Fri', name: 'St Ives', meta: 'Beach, then fish & chips' },
    { t: 'Sat', name: 'Eden Project', meta: 'Biomes · whole day' },
    { t: 'Sun', name: 'Padstow', meta: 'Camel Trail by bike' },
  ],
};

export const PLAN: Strings<PlanWords> = { 'en-gb': PLAN_GB, 'en-us': PLAN_GB };

type Person = { name: string; likes: string[] };
type Expert = { name: string; place: string; guide: string; rating: string };
type HostKind = { tag: string; title: string; eg: string };

export type W3Words = {
  comingSoon: string;
  /** The three lines read as one sentence after the wordmark: "Epic days out. / trips away. / events." */
  lines: [string, string, string];
  /** The page's one <h1>. */
  h1: string;
  /** The button on both email forms (owner, 2 Oct 2026: "Join the list", not the handoff's "Remind me"). */
  remind: string;
  success: string;
  ch1: { n: string; one: string; ten: string; sub: string };
  ch2: { n: string; title: string; sub: string; head: string; likes: string; crew: Person[] };
  ch3: { n: string; title: string; sub: string; head: string; rated: string; experts: Expert[] };
  /** Card titles carry a "\n" where the design breaks the line. */
  ch4: { n: string; title: string; sub: string; kinds: HostKind[]; cta: string; small: string };
  close: string;
};

const GB: W3Words = {
  comingSoon: 'Coming soon',
  lines: ['days out.', 'trips away.', 'events.'],
  h1: 'Every place worth going, planned around your crew.',
  remind: 'Join the list',
  success: "You're on the list. We'll email you when the app's out.",
  ch1: { n: '01', one: 'One day.', ten: 'Or ten.', sub: 'Plan a Saturday out or a week away. Same app, same crew.' },
  ch2: {
    n: '02', title: 'Built around your crew.',
    sub: "Tell us who's coming and what they love. Everything we suggest works for all of you.",
    head: 'Your crew', likes: 'Likes',
    crew: [
      { name: 'Sam', likes: ['Galleries', 'Flat whites', 'Long walks'] },
      { name: 'Maya, 7', likes: ['Dinosaurs', 'Swimming', 'Slides'] },
      { name: 'Nan', likes: ['Gardens', 'Not too far'] },
    ],
  },
  ch3: {
    n: '03', title: 'Book an expert.',
    sub: 'Local specialists who make the day. You just turn up.',
    head: 'Near you', rated: 'rated',
    experts: [
      { name: 'Fossil hunting with a geologist', place: 'Lyme Regis · 3 hrs', guide: 'Priya', rating: '4.9' },
      { name: 'Stonehenge with an archaeologist', place: 'Wiltshire · 2 hrs', guide: 'Tom', rating: '4.8' },
    ],
  },
  ch4: {
    n: '04', title: 'Host it.',
    sub: "Epic isn't just for planning trips. It's where you run things: a wedding weekend, a fossil-hunting tour, a weekly club, a ten-week course.",
    kinds: [
      { tag: 'One-off', title: 'A private or\npublic event.', eg: 'Birthday party · Wedding · Quiz night' },
      { tag: 'Weekly', title: 'Same time,\nevery week.', eg: 'Book club · Five-a-side · Yoga class' },
      { tag: 'Course', title: 'A set number\nof weeks.', eg: 'Swimming lessons · Cooking classes' },
      { tag: 'On request', title: 'Your time, when\nthey want it.', eg: 'Walking tour · Cooking lesson' },
    ],
    cta: 'Become a host',
    small: 'Free events are free to host · Paid out through Stripe',
  },
  close: 'Be first in.',
};

export const W3_WORDS: Strings<W3Words> = {
  'en-gb': GB,
  'en-us': {
    ...GB,
    ch2: {
      ...GB.ch2,
      crew: [GB.ch2.crew[0], GB.ch2.crew[1], { name: 'Grandma', likes: ['Gardens', 'Not too far'] }],
    },
    ch4: {
      ...GB.ch4,
      kinds: [
        { ...GB.ch4.kinds[0], eg: 'Birthday party · Wedding · Trivia night' },
        { ...GB.ch4.kinds[1], eg: 'Book club · Pickup soccer · Yoga class' },
        GB.ch4.kinds[2],
        GB.ch4.kinds[3],
      ],
    },
  },
};
