/**
 * The website's words live in locale tables, never in a template (Technical
 * Foundations › Translation-ready content). Each page keeps its own table beside
 * it — `{ 'en-gb': {...}, 'en-us': {...} }` — so pages never fight over one file,
 * and `en-us` is a real variant (spelling, dates, $), built though switched off.
 */
import type { SiteLocale } from '../routes';

export type Strings<T> = Record<SiteLocale, T>;

/** This locale's table, falling back to the source locale (en-gb). */
export const pick = <T,>(table: Strings<T>, locale: SiteLocale): T => table[locale] ?? table['en-gb'];

/** `<html lang>` for a locale (Technical Foundations › SEO). */
export const HTML_LANG: Record<SiteLocale, string> = { 'en-gb': 'en-GB', 'en-us': 'en-US' };

/** How the footer's switcher names a locale. */
export const LOCALE_LABEL: Record<SiteLocale, string> = {
  'en-gb': 'United Kingdom · English',
  'en-us': 'United States · English',
};
