/** W1 · Postcards — every word on the page, per locale (no copy in the component). */
import type { Strings } from '../../i18n';

export type W1Words = {
  /** Kept at the design's size, but a <p>: it is not what the page is. */
  comingSoon: string;
  /** The one <h1> (owner override): the design's descriptive line under "Coming soon.". */
  h1: string;
  formLabel: string;
  success: string;
};

export const W1_WORDS: Strings<W1Words> = {
  'en-gb': {
    comingSoon: 'Coming soon.',
    h1: 'Every place worth going, planned around your crew',
    formLabel: 'Remind me',
    success: "You're on the list. We'll email you when the app's out.",
  },
  'en-us': {
    comingSoon: 'Coming soon.',
    h1: 'Every place worth going, planned around your crew',
    formLabel: 'Remind me',
    success: "You're on the list. We'll email you when the app's out.",
  },
};
