/**
 * The subcategory guides (Epic Events on the web › Subcategory guides, 3 Oct
 * 2026): designed pages, not CMS content. Each guide's words are in
 * guides.json, which the web server reads too (guides.mjs), so the head and the
 * schema.org a crawler reads come from the same text a person sees.
 *
 * Shared section shapes, never shared paragraphs: a guide supplies its own copy
 * for every section it has.
 */
import type { GuideSlug } from '../../routes';

export type { GuideSlug };

export type GuideListItem = { t: string; d: string; chk?: boolean };
export type GuideBlock = {
  id: string;
  h2: string;
  /** The brief for the section's photo, drawn on the slot until one is licensed. */
  img?: string;
  /** The section's photo — or two, side by side in the same frame — once it has one; the brief in `img` until then. */
  photos?: GuideImage[];
  p?: string[];
  compare?: { t: string; line: string; pts: string[] }[];
  steps?: { t: string; d: string }[];
  list?: GuideListItem[];
  table?: { head: string[]; rows: string[][] };
  tiles?: { t: string; d: string; where: string; want: string; src?: string; alt?: string }[];
  p2?: string[];
  note?: { t: string; d: string };
};
/** A licensed photo: its JPEG under public/site/guides, with a WebP of the same name beside it. */
export type GuideImage = { src: string; alt: string };
/** A header photo, or the brief and its tag while it has none. */
export type GuidePhoto = { src?: string; alt?: string; want?: string; tag?: string };
export type GuidePlace = { n: string; where: string; what: string; src: string; confirm?: boolean };

export type Guide = {
  /** False keeps it noindex and out of the sitemap, and shows its "Check before publishing" tags. */
  published: boolean;
  category: { name: string; slug: string };
  name: string;
  title: string;
  description: string;
  h1a: string;
  h1b: string;
  intro: string;
  facts: [string, string][];
  photos: GuidePhoto[];
  blocks: GuideBlock[];
  placesH2: string;
  places: GuidePlace[];
  soonH2: string;
  soonLine: string;
  /** "pottery classes start": finishes "We'll email you when … near {place}". */
  short: string;
  hostH2: string;
  hostP: string;
  faqH2: string;
  faqs: [string, string][];
  /** ISO date: "Last reviewed", and Article's dateModified. */
  reviewed: string;
};

/**
 * What the consent tick says, and so what the person agreed to (UK PECR). The
 * API keeps the same sentence for each guide (apps/api/src/sources/
 * consentWordings.json › guide) and refuses any other; test/guides.test.ts
 * holds the two in step.
 */
export const consentFor = (g: Guide) => `Email me when ${g.short} near there. At most one email a week; unsubscribe in one tap.`;

/** "3 October 2026", as the page prints the review date. */
export function reviewedWords(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${d} ${months[m - 1]} ${y}`;
}
