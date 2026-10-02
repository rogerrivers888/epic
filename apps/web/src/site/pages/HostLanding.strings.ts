/**
 * Words for the host landing page (WH1), v6 "Four ways to host" (Website ›
 * "New hosting screen 021026", signed off 2 Oct 2026): the four kinds are how
 * often it runs — One-off · Weekly · Course · On request — and who can come
 * (Private / Public) is section 02. Every figure in a card's strip is an example,
 * which is why each strip says so.
 */
import type { HostKind } from '../InterestForm';
import type { Strings } from '../i18n';

export type RsvpStatus = 'coming' | 'maybe' | 'none';

/** Which of the four a card is; the animation in HostKindCards draws each its own way. */
export type KindKey = 'one-off' | 'weekly' | 'course' | 'on-request';

export type HostKindWords = {
  key: KindKey;
  tag: string;
  /** Two lines; `\n` forces the break the design asks for. */
  title: string;
  line: string;
  kicker: string;
  card: string;
  pills: string[];
  eg: string[];
  /** The booking that lands in the card's strip: who, and when. */
  who: string;
  when: string;
};

export type HostLandingStrings = {
  comingSoon: string;
  hostIt: string;
  h1: string;
  intro: string;
  sep: string;
  heroCta: string;
  success: string;
  sections: { n: string; title: string }[];
  kinds: HostKindWords[];
  running: string;
  /** The words inside a card's live strip, the example figures in them included. */
  strip: {
    example: string;
    money: (n: number) => string;
    oneOff: { status: (booked: number) => string; result: string };
    weekly: { status: (booked: number) => string; thisWeek: string; result: string };
    course: { status: (taken: number) => string; result: string };
    onRequest: { status: string; progress: (n: number) => string; result: string };
  };
  invite: {
    title: string; sub: string; body: string;
    guests: { name: string; status: RsvpStatus }[];
    status: Record<RsvpStatus, string>;
    /** The RSVP header: "37 coming · 4 to reply". */
    count: (coming: number, toReply: number) => string;
    /** The guest whose reply arrives in the beat. */
    replying: string;
  };
  open: { title: string; sub: string; body: string; sessions: { d: string; t: string; b: string; bShort: string; full?: boolean }[] };
  steps: { t: string; d: string }[];
  admin: {
    body: string; kicker: string; date: string;
    stats: { k: string; kShort: string; v: string }[];
    booked: { name: string; note: string; noteShort: string; wideOnly?: boolean }[];
    remind: string;
  };
  close: { title: string; question: string; cta: string; kinds: { value: HostKind; label: string }[] };
};

const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

const GB: HostLandingStrings = {
  comingSoon: 'Coming soon',
  hostIt: 'Host it.',
  h1: 'Host it on Epic: one-off events, activities, weekly classes and homeschool',
  intro: "Epic isn't just for planning trips. It's where you run things: a wedding weekend, a fossil-hunting tour, a weekly club, a ten-week course.",
  sep: ' · ',
  heroCta: 'Become a host',
  success: "You're on the hosts list. We'll be in touch before launch.",
  sections: [
    { n: '01', title: 'Four ways to host.' },
    { n: '02', title: 'Friends only, or everyone.' },
    { n: '03', title: 'Up and running in four steps.' },
    { n: '04', title: 'You run it. Epic does the admin.' },
  ],
  kinds: [
    {
      key: 'one-off', tag: 'One-off', title: 'A private or\npublic event.',
      line: 'A wedding for your guests, or a class open to all. Set the date; people RSVP or book.',
      kicker: 'Public · Sat 14 Nov, 10am', card: 'Fossil hunting with a geologist', pills: ['Lyme Regis · 3 hrs'],
      eg: ['Birthday parties and weddings', 'Taster classes and workshops', 'Guided walks and tours'],
      who: 'Hannah', when: 'just now',
    },
    {
      key: 'weekly', tag: 'Weekly', title: 'Same time, every week.',
      line: 'A club or class that keeps going. People come every week or drop in when they can.',
      kicker: 'Public · Thursdays 7pm', card: 'Weekly pottery workshop', pills: ['£18 a session'],
      eg: ['Running and walking clubs', 'Art and pottery classes', 'Scouts and youth groups'],
      who: 'Tom', when: 'just now',
    },
    {
      key: 'course', tag: 'Course', title: 'A set number of weeks.',
      line: 'Six weeks or a whole term. People sign up for the full run; you plan each session.',
      kicker: '10 Saturdays · 9 Jan – 13 Mar', card: 'Junior tennis camp', pills: ['£120 per child'],
      eg: ['Sports camps and coaching', 'Masterclasses and courses', 'Homeschool terms and co-ops'],
      who: 'Ana', when: 'just now',
    },
    {
      key: 'on-request', tag: 'On request', title: 'Your time, when they want it.',
      line: "No fixed date. Say when you're free and people book you: a tour, a lesson, a day out.",
      kicker: 'On request · 1–2 hours', card: 'An hour on getting started with AI', pills: ['Online or in person'],
      eg: ['Tours with a local guide', 'Private lessons and coaching', 'Days out with a local'],
      who: 'Sam', when: 'Thu 2pm',
    },
  ],
  running: 'Hosts are running',
  strip: {
    example: 'Example',
    money: gbp,
    oneOff: { status: (n) => `Min 5 · ${n} booked`, result: "It's on ✓" },
    weekly: { status: (n) => `${n} of 8 booked`, thisWeek: 'this week', result: '↑ 17% on last week' },
    course: { status: (n) => `${n} of 16`, result: '1 place left' },
    onRequest: { status: '★ 4.9 · 9 bookings this month', progress: (n) => `${n} of 25 to Epic Trusted`, result: 'Fee 15% → 10%' },
  },
  invite: {
    title: 'Private',
    sub: 'Invite only',
    body: "For a wedding, a birthday or a family weekend. Your guests get one page with the plan, the RSVP and who's bringing what.",
    guests: [
      { name: 'Priya & Dev', status: 'coming' },
      { name: 'Auntie Carol', status: 'coming' },
      { name: 'Marcus', status: 'maybe' },
      { name: 'The Okafors', status: 'none' },
    ],
    status: { coming: 'Coming', maybe: 'Maybe', none: 'Not replied' },
    count: (coming, toReply) => `${coming} coming · ${toReply} to reply`,
    replying: 'The Okafors',
  },
  open: {
    title: 'Public',
    sub: 'Open to all',
    body: "For a class, a course or a club. You're listed on Epic, so families nearby can find you, book a space and pay.",
    sessions: [
      { d: 'Thu 9 Oct', t: '7–9pm', b: '6 of 8 booked', bShort: '6 of 8' },
      { d: 'Thu 16 Oct', t: '7–9pm', b: 'Full', bShort: 'Full', full: true },
      { d: 'Thu 23 Oct', t: '7–9pm', b: '3 of 8 booked', bShort: '3 of 8' },
      { d: 'Thu 30 Oct', t: '7–9pm', b: '1 of 8 booked', bShort: '1 of 8' },
    ],
  },
  steps: [
    { t: 'Say what it is', d: 'A one-off, something weekly, a course, or time people book. Add a title, a photo and where it happens.' },
    { t: 'Choose who can come', d: 'Invite people by name, or open it up so anyone nearby can find it.' },
    { t: 'Free or paid', d: 'Keep it free, or set a price per person, per session or for the block.' },
    { t: 'Run it', d: 'See who’s coming, send reminders, message everyone and change plans in one place.' },
  ],
  admin: {
    body: "Who's coming, who's paid, who needs a reminder. Message everyone at once. Swap a date and everyone knows.",
    kicker: 'Weekly pottery workshop',
    date: 'Thursday 9 October',
    stats: [
      { k: 'Booked', kShort: 'Booked', v: '6 of 8' },
      { k: 'Paid', kShort: 'Paid', v: '5' },
      { k: 'Waiting list', kShort: 'Waiting', v: '2' },
    ],
    booked: [
      { name: 'Hannah Lee', note: 'Paid · 4th week', noteShort: 'Paid' },
      { name: 'Tom Okafor', note: 'Paid · first time', noteShort: 'Paid' },
      { name: 'Ana Ribeiro', note: 'Paid', noteShort: 'Paid', wideOnly: true },
      { name: 'Sid Patel', note: 'Not paid yet', noteShort: 'Not paid yet' },
    ],
    remind: 'Send a reminder to all 6',
  },
  close: {
    title: 'Become a host.',
    question: 'What would you host?',
    cta: 'Count me in',
    kinds: [
      { value: 'one-off', label: 'One-off' },
      { value: 'weekly', label: 'Weekly' },
      { value: 'course', label: 'Course' },
      { value: 'on-request', label: 'On request' },
    ],
  },
};

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

// US spelling, dates and $; the structure is GB's.
const US: HostLandingStrings = {
  ...GB,
  kinds: [
    { ...GB.kinds[0], kicker: 'Public · Sat, Nov 14, 10 am' },
    { ...GB.kinds[1], kicker: 'Public · Thursdays 7 pm', pills: ['$18 a session'] },
    { ...GB.kinds[2], kicker: '10 Saturdays · Jan 9 – Mar 13', line: 'Six weeks or a whole semester. People sign up for the full run; you plan each session.', pills: ['$120 per child'], eg: ['Sports camps and coaching', 'Masterclasses and courses', 'Homeschool semesters and co-ops'] },
    { ...GB.kinds[3], when: 'Thu 2 pm' },
  ],
  strip: { ...GB.strip, money: usd },
  invite: { ...GB.invite, guests: [{ name: 'Priya & Dev', status: 'coming' }, { name: 'Aunt Carol', status: 'coming' }, { name: 'Marcus', status: 'maybe' }, { name: 'The Okafors', status: 'none' }] },
  open: {
    ...GB.open,
    sessions: [
      { d: 'Thu, Oct 9', t: '7–9 pm', b: '6 of 8 booked', bShort: '6 of 8' },
      { d: 'Thu, Oct 16', t: '7–9 pm', b: 'Full', bShort: 'Full', full: true },
      { d: 'Thu, Oct 23', t: '7–9 pm', b: '3 of 8 booked', bShort: '3 of 8' },
      { d: 'Thu, Oct 30', t: '7–9 pm', b: '1 of 8 booked', bShort: '1 of 8' },
    ],
  },
  admin: { ...GB.admin, date: 'Thursday, October 9' },
};

export const STRINGS: Strings<HostLandingStrings> = { 'en-gb': GB, 'en-us': US };
