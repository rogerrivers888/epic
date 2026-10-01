/**
 * W4 · The phone — every word on the page, by locale. The phone's list (Day
 * out | Trip) is the shared 1h-1 table, `PLAN`, in W3Story.strings.
 */
import type { Strings } from '../../i18n';

export type W4Words = {
  tag: string;
  h1: string;
  headline: string;
  line: string;
  label: string;
  success: string;
  phoneTitle: string;
  phoneSub: string;
};

const GB: W4Words = {
  tag: 'Coming soon to iPhone and Android',
  h1: 'Every place worth going, planned around your crew',
  headline: 'Plans that work for everyone.',
  line: "Tell Epic who's coming and what they love. It plans the day, or the whole week.",
  label: 'Let me know',
  success: "You're on the list. We'll email you when it's out.",
  phoneTitle: 'One day. Or ten.',
  phoneSub: 'Plan a Saturday out or a week away. Same app, same crew.',
};

export const W4_WORDS: Strings<W4Words> = { 'en-gb': GB, 'en-us': GB };
