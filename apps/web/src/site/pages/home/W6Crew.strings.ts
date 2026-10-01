/** W6 · Your crew, on ink — the page's words (Website & Registration › W6). */
import type { Strings } from '../../i18n';

export type W6Person = { name: string; likes: [string, string, string] };

export type W6Words = {
  tag: string;
  headline: string;
  /** The page's one <h1> (owner, 1 Oct 2026). */
  h1: string;
  line: string;
  cta: string;
  success: string;
  crew: W6Person[];
};

export const W6_WORDS: Strings<W6Words> = {
  'en-gb': {
    tag: 'Coming soon',
    headline: 'Something for everyone. At last.',
    h1: 'Every place worth going, planned around your crew',
    line: "Tell Epic who's coming and what they love. Every plan works for all of you.",
    cta: 'Remind me',
    success: "You're on the list. We'll email you when the app's out.",
    crew: [
      { name: 'Sam', likes: ['Galleries', 'Flat whites', 'Long walks'] },
      { name: 'Alex', likes: ['Mountain biking', 'Pubs with gardens', 'Football'] },
      { name: 'Maya, 7', likes: ['Dinosaurs', 'Swimming', 'Slides'] },
      { name: 'Leo, 4', likes: ['Trains', 'Sandpits', 'Ducks'] },
      { name: 'Nan', likes: ['Gardens', 'Afternoon tea', 'Not too far'] },
    ],
  },
  'en-us': {
    tag: 'Coming soon',
    headline: 'Something for everyone. At last.',
    h1: 'Every place worth going, planned around your crew',
    line: "Tell Epic who's coming and what they love. Every plan works for all of you.",
    cta: 'Remind me',
    success: "You're on the list. We'll email you when the app's out.",
    crew: [
      { name: 'Sam', likes: ['Galleries', 'Flat whites', 'Long walks'] },
      { name: 'Alex', likes: ['Mountain biking', 'Bars with patios', 'Soccer'] },
      { name: 'Maya, 7', likes: ['Dinosaurs', 'Swimming', 'Slides'] },
      { name: 'Leo, 4', likes: ['Trains', 'Sandboxes', 'Ducks'] },
      { name: 'Grandma', likes: ['Gardens', 'Afternoon tea', 'Not too far'] },
    ],
  },
};
