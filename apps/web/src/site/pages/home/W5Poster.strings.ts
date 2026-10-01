/** W5 · Lime poster — the page's words (Website & Registration › W5). */
import type { Strings } from '../../i18n';

export type W5Words = {
  /** The page's one <h1> (owner, 1 Oct 2026). */
  h1: string;
  line: string;
  comingSoon: string;
  cta: string;
  success: string;
};

export const W5_WORDS: Strings<W5Words> = {
  'en-gb': {
    h1: 'Every place worth going, planned around your crew',
    line: 'Days out and trips away, built around your crew.',
    comingSoon: 'Coming soon.',
    cta: 'Count me in',
    success: "You're on the list. We'll email you when the app's out.",
  },
  'en-us': {
    h1: 'Every place worth going, planned around your crew',
    line: 'Day trips and getaways, built around your crew.',
    comingSoon: 'Coming soon.',
    cta: 'Count me in',
    success: "You're on the list. We'll email you when the app's out.",
  },
};
