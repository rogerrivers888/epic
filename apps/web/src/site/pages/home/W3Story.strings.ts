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
    sub: "Epic isn't just trips. Run a wedding weekend, a fossil-hunting tour, a weekly class or a term of home-school lessons, for friends or for anyone.",
    kinds: [
      { tag: 'One-off', title: 'A wedding weekend.', card: "Jo & Sam's wedding weekend", meta: 'Invite only · 38 coming' },
      { tag: 'Activity', title: 'A fossil hunt.', card: 'Fossil hunting with a geologist', meta: 'Once, or every Saturday' },
      { tag: 'Class', title: 'A weekly class.', card: 'Weekly pottery workshop', meta: 'Open to all · 6 of 8 booked' },
      { tag: 'Homeschool', title: 'A term of lessons.', card: 'Year 4 science co-op', meta: '5 families · 12 sessions' },
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
      sub: "Epic isn't just trips. Run a wedding weekend, a fossil-hunting tour, a weekly class or a semester of homeschool lessons, for friends or for anyone.",
      kinds: [
        GB.ch4.kinds[0], GB.ch4.kinds[1], GB.ch4.kinds[2],
        { tag: 'Homeschool', title: 'A semester of lessons.', card: '4th grade science co-op', meta: '5 families · 12 sessions' },
      ],
    },
  },
};
