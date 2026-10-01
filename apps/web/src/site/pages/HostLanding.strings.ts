/**
 * Words for the host landing page (WH1). The phone drawing (MB, `screen` = host)
 * shortens a few labels to fit 390; those carry a `…Short` twin.
 */
import type { HostKind } from '../InterestForm';
import type { Strings } from '../i18n';

export type RsvpStatus = 'coming' | 'maybe' | 'none';

type Pill = { t: string; rating?: string; label?: string };

export type HostLandingStrings = {
  comingSoon: string;
  hostIt: string;
  h1: string;
  intro: string;
  sep: string;
  heroCta: string;
  success: string;
  sections: { n: string; title: string }[];
  kinds: {
    tag: string; freq: string; title: string; sub: string;
    kicker: string; kickerShort: string; card: string; pills: Pill[]; eg: string[];
  }[];
  running: string;
  invite: { title: string; body: string; guests: { name: string; status: RsvpStatus }[]; status: Record<RsvpStatus, string> };
  open: { title: string; body: string; sessions: { d: string; t: string; b: string; bShort: string; full?: boolean }[] };
  steps: { t: string; d: string }[];
  admin: {
    body: string; kicker: string; date: string;
    stats: { k: string; kShort: string; v: string }[];
    booked: { name: string; note: string; noteShort: string; wideOnly?: boolean }[];
    remind: string;
  };
  close: { title: string; question: string; cta: string; kinds: { value: HostKind; label: string }[] };
};

const GB: HostLandingStrings = {
  comingSoon: 'Coming soon',
  hostIt: 'Host it.',
  h1: 'Host it on Epic: one-off events, activities, weekly classes and homeschool',
  intro: "Epic isn't just for planning trips. It's where you run things: a wedding weekend, a fossil-hunting tour, a weekly class, a term of home-school lessons.",
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
      tag: 'One-off', freq: 'Once', title: 'One big day, done properly.',
      sub: 'A wedding weekend, a 40th, a craft fair. One page holds the plan, the guests and the RSVPs.',
      kicker: 'Invite only · 14–16 Aug', kickerShort: 'Invite only · 14–16 Aug', card: "Jo & Sam's wedding weekend",
      pills: [{ t: '38 coming' }, { t: '4 to reply' }],
      eg: ['Wedding weekends', 'Big birthdays', 'Craft fairs and open days'],
    },
    {
      tag: 'Activity', freq: 'Once or weekly', title: 'Share what you know.',
      sub: 'A fossil hunt, a guided walk, a foraging morning. Run it once, or every Saturday, and people book a place.',
      kicker: 'Open to all · Saturdays 10am', kickerShort: 'Open to all · Saturdays 10am', card: 'Fossil hunting with a geologist',
      pills: [{ t: 'Lyme Regis · 3 hrs' }, { t: 'Priya', rating: '4.9', label: 'Priya, rated 4.9' }],
      eg: ['Fossil hunts and guided walks', 'Foraging and wild swimming', 'Tours with a local expert'],
    },
    {
      tag: 'Class', freq: 'Every week', title: 'The same slot, every week.',
      sub: 'A class, a club or a course. Set the dates once and people book week by week, or the whole block.',
      kicker: 'Open to all · Thursdays 7pm', kickerShort: 'Open to all · Thursdays 7pm', card: 'Weekly pottery workshop',
      pills: [{ t: '6 of 8 booked' }, { t: '£18 a session' }],
      eg: ['Pottery and art classes', 'Running clubs', '3-day courses'],
    },
    {
      tag: 'Homeschool', freq: 'By the term', title: 'A term of learning, shared.',
      sub: 'Run lessons and trips for home-educated kids. Families sign up for the term, and you plan each session.',
      kicker: '5 families · Term 1 · 12 sessions', kickerShort: '5 families · 12 sessions', card: 'Year 4 science co-op',
      pills: [{ t: 'Next: Tue 10am' }, { t: 'Forest school' }],
      eg: ['Science and maths co-ops', 'Forest school', 'Museum and field trips'],
    },
  ],
  running: 'Hosts are running',
  invite: {
    title: 'Invite only',
    body: "For a wedding, a birthday or a family weekend. Your guests get one page with the plan, the RSVP and who's bringing what.",
    guests: [
      { name: 'Priya & Dev', status: 'coming' },
      { name: 'Auntie Carol', status: 'coming' },
      { name: 'Marcus', status: 'maybe' },
      { name: 'The Okafors', status: 'none' },
    ],
    status: { coming: 'Coming', maybe: 'Maybe', none: 'Not replied' },
  },
  open: {
    title: 'Open to all',
    body: "For a class, a course or a club. You're listed on Epic, so families nearby can find you, book a space and pay.",
    sessions: [
      { d: 'Thu 9 Oct', t: '7–9pm', b: '6 of 8 booked', bShort: '6 of 8' },
      { d: 'Thu 16 Oct', t: '7–9pm', b: 'Full', bShort: 'Full', full: true },
      { d: 'Thu 23 Oct', t: '7–9pm', b: '3 of 8 booked', bShort: '3 of 8' },
      { d: 'Thu 30 Oct', t: '7–9pm', b: '1 of 8 booked', bShort: '1 of 8' },
    ],
  },
  steps: [
    { t: 'Say what it is', d: 'An event, an activity, a weekly class or a term. Add a title, a photo and where it happens.' },
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
      { value: 'activity', label: 'Activity' },
      { value: 'class', label: 'Class' },
      { value: 'homeschool', label: 'Homeschool' },
    ],
  },
};

// US spelling, dates and $; the structure is GB's.
const US: HostLandingStrings = {
  ...GB,
  intro: "Epic isn't just for planning trips. It's where you run things: a wedding weekend, a fossil-hunting tour, a weekly class, a semester of homeschool lessons.",
  kinds: [
    { ...GB.kinds[0], kicker: 'Invite only · Aug 14–16', kickerShort: 'Invite only · Aug 14–16' },
    { ...GB.kinds[1], kicker: 'Open to all · Saturdays 10 am', kickerShort: 'Open to all · Saturdays 10 am', pills: [{ t: 'Lyme Regis · 3 hrs' }, { t: 'Priya', rating: '4.9', label: 'Priya, rated 4.9' }] },
    { ...GB.kinds[2], kicker: 'Open to all · Thursdays 7 pm', kickerShort: 'Open to all · Thursdays 7 pm', pills: [{ t: '6 of 8 booked' }, { t: '$18 a session' }] },
    {
      ...GB.kinds[3], freq: 'By the semester', title: 'A semester of learning, shared.',
      sub: 'Run lessons and field trips for homeschooled kids. Families sign up for the semester, and you plan each session.',
      kicker: '5 families · Semester 1 · 12 sessions', card: '4th grade science co-op',
      pills: [{ t: 'Next: Tue 10 am' }, { t: 'Forest school' }],
      eg: ['Science and math co-ops', 'Forest school', 'Museum and field trips'],
    },
  ],
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
  steps: [
    { t: 'Say what it is', d: 'An event, an activity, a weekly class or a semester. Add a title, a photo and where it happens.' },
    ...GB.steps.slice(1),
  ],
  admin: { ...GB.admin, date: 'Thursday, October 9' },
};

export const STRINGS: Strings<HostLandingStrings> = { 'en-gb': GB, 'en-us': US };
