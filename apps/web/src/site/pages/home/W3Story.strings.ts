/**
 * W3 · The story in four — every word on the page, by locale. `PLAN` is the
 * app's intro screen 1h-1 (Day out | Trip), shared with W4's phone.
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

type Person = { name: string; likes: [string, string] };
type Expert = { name: string; place: string; guide: string; rating: string };
type HostKind = { tag: string; title: string; card: string; meta: string };

export type W3Words = {
  comingSoon: string;
  h1: string;
  line: string;
  remind: string;
  success: string;
  ch1: { n: string; one: string; ten: string; sub: string };
  ch2: { n: string; title: string; sub: string; head: string; crew: Person[] };
  ch3: { n: string; title: string; sub: string; head: string; rated: string; experts: Expert[] };
  ch4: { n: string; title: string; sub: string; kinds: HostKind[]; cta: string };
  close: string;
};

const GB: W3Words = {
  comingSoon: 'Coming soon.',
  h1: 'Every place worth going, planned around your crew',
  line: "An app for days out and trips away. Here's what it does.",
  remind: 'Remind me',
  success: "You're on the list. We'll email you when the app's out.",
  ch1: { n: '01', one: 'One day.', ten: 'Or ten.', sub: 'Plan a Saturday out or a week away. Same app, same crew.' },
  ch2: {
    n: '02', title: 'Built around your crew.',
    sub: "Tell us who's coming and what they love. Everything we suggest works for all of you.",
    head: 'Your crew',
    crew: [
      { name: 'Sam', likes: ['Galleries', 'Flat whites'] },
      { name: 'Maya, 7', likes: ['Dinosaurs', 'Swimming'] },
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
    // The four ways to host as the host page now has them — how often it runs
    // (host page v6, owner, 2 Oct 2026), with the hero line it uses.
    sub: "Epic isn't just for planning trips. It's where you run things: a wedding weekend, a fossil-hunting tour, a weekly club, a ten-week course.",
    kinds: [
      { tag: 'One-off', title: 'A private or public event.', card: 'Fossil hunting with a geologist', meta: 'Public · Sat 14 Nov, 10am' },
      { tag: 'Weekly', title: 'Same time, every week.', card: 'Weekly pottery workshop', meta: 'Public · Thursdays 7pm' },
      { tag: 'Course', title: 'A set number of weeks.', card: 'Junior tennis camp', meta: '10 Saturdays · 9 Jan – 13 Mar' },
      { tag: 'On request', title: 'Your time, when they want it.', card: 'An hour on getting started with AI', meta: 'On request · 1–2 hours' },
    ],
    cta: 'Become a host',
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
        { ...GB.ch4.kinds[0], meta: 'Public · Sat, Nov 14, 10 am' },
        { ...GB.ch4.kinds[1], meta: 'Public · Thursdays 7 pm' },
        { ...GB.ch4.kinds[2], meta: '10 Saturdays · Jan 9 – Mar 13' },
        GB.ch4.kinds[3],
      ],
    },
  },
};
