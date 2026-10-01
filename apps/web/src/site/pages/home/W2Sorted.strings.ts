/** W2 · Sorted. — every word on the page, per locale (no copy in the component). */
import type { Strings } from '../../i18n';

export type W2Words = {
  /** The ink tag; drawn upper-case by style, so written here as a sentence. */
  comingSoon: string;
  /** The lime word, in order; the first is also the reduced-motion and final state. */
  rotating: string[];
  sorted: string;
  /** The one <h1> (owner override), first line of the bottom row's first column. */
  h1: string;
  planned: string;
  host: string;
  formLabel: string;
  success: string;
};

export const W2_WORDS: Strings<W2Words> = {
  'en-gb': {
    comingSoon: 'Coming soon',
    rotating: ['Saturday,', 'Half-term,', 'The birthday,', 'Cornwall,', 'Sunday lunch,'],
    sorted: 'sorted.',
    h1: 'Every place worth going, planned around your crew',
    planned: "Days out and trips away, planned around everyone who's coming.",
    host: 'Book a local expert. Or host something yourself.',
    formLabel: "Tell me when it's out",
    success: "You're on the list. We'll email you when the app's out.",
  },
  'en-us': {
    comingSoon: 'Coming soon',
    rotating: ['Saturday,', 'Spring break,', 'The birthday,', 'Cornwall,', 'Sunday lunch,'],
    sorted: 'sorted.',
    h1: 'Every place worth going, planned around your crew',
    planned: "Days out and trips away, planned around everyone who's coming.",
    host: 'Book a local expert. Or host something yourself.',
    formLabel: "Tell me when it's out",
    success: "You're on the list. We'll email you when the app's out.",
  },
};
