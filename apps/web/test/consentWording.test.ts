/**
 * Every waitlist form's consent wording is one the API knows (Codex, 1 Oct 2026).
 *
 * The API refuses a sign-up whose `consentWording` is not on its own list
 * (apps/api/src/sources/consentWordings.json), so a direct request cannot
 * write a consent nobody was shown. This collects what each form actually
 * sends — `${label} — ${success}`, InterestForm — for every design and locale,
 * and fails the moment a label or success line changes without the list.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SITE_LOCALES } from '../src/routes.ts';
import { W1_WORDS } from '../src/site/pages/home/W1Postcards.strings.ts';
import { W2_WORDS } from '../src/site/pages/home/W2Sorted.strings.ts';
import { W3_WORDS } from '../src/site/pages/home/W3Story.strings.ts';
import { W4_WORDS } from '../src/site/pages/home/W4Phone.strings.ts';
import { W5_WORDS } from '../src/site/pages/home/W5Poster.strings.ts';
import { W6_WORDS } from '../src/site/pages/home/W6Crew.strings.ts';
import { STRINGS as HOST } from '../src/site/pages/HostLanding.strings.ts';

const wording = (label: string, success: string) => `${label} — ${success}`;

/** What every form on the site can send, by source. */
export function siteConsentWordings(): { home: string[]; host: string[] } {
  const home = new Set<string>(); const host = new Set<string>();
  for (const l of SITE_LOCALES) {
    home.add(wording(W1_WORDS[l].formLabel, W1_WORDS[l].success));
    home.add(wording(W2_WORDS[l].formLabel, W2_WORDS[l].success));
    home.add(wording(W3_WORDS[l].remind, W3_WORDS[l].success));
    home.add(wording(W4_WORDS[l].label, W4_WORDS[l].success));
    home.add(wording(W5_WORDS[l].cta, W5_WORDS[l].success));
    home.add(wording(W6_WORDS[l].cta, W6_WORDS[l].success));
    host.add(wording(HOST[l].heroCta, HOST[l].success));
    host.add(wording(HOST[l].close.cta, HOST[l].success));
  }
  return { home: [...home].sort(), host: [...host].sort() };
}

test('the API knows exactly the consent wordings the site sends', () => {
  const api = JSON.parse(readFileSync(new URL('../../api/src/sources/consentWordings.json', import.meta.url), 'utf8'));
  const site = siteConsentWordings();
  assert.deepEqual([...api.home].sort(), site.home, 'home: update apps/api/src/sources/consentWordings.json');
  assert.deepEqual([...api.host].sort(), site.host, 'host: update apps/api/src/sources/consentWordings.json');
});
