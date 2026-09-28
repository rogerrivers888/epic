/**
 * The Facts tab (README v2 "Facts"): All facts · Verification · Accuracy ·
 * Excluded facts, with How it works behind the (i) at the end of the strip.
 *
 * Everything is an address. `ftab` names the sub-tab (All facts is the
 * default and not written); on All facts, `fact` opens a fact's page and
 * `places=1` (with an optional `sub`) its drill-down of the places that have
 * it; `q`, `cat`, `sub` and `state` set the list. Verification reads `period`
 * (24h, or 7d unwritten) and `view` (a drill-down, with `src` for one of the
 * Sources table's rows). Accuracy reads `src`, `by` (category, or fact
 * unwritten) and `chart` (daily, or monthly unwritten), and `kind` + `key`
 * for a row's health view.
 *
 * Standard facts is not a tab: they sit in All facts with Subcategories "All".
 */

import React from 'react';

import { useDeskParam } from './Desk';
import { AllFacts, FactPage, FactPlaces } from './facts/AllFacts';
import { Accuracy } from './facts/Accuracy';
import { Excluded } from './facts/Excluded';
import { ftabOf } from './facts/shared';
import { Verification } from './facts/Verification';

export function Facts({ canManage = false }: { canManage?: boolean }) {
  const [ftabRaw] = useDeskParam('ftab');
  const [fact] = useDeskParam('fact');
  const [places] = useDeskParam('places');
  const tab = ftabOf(ftabRaw);

  if (tab === 'verification') return <Verification />;
  if (tab === 'accuracy') return <Accuracy />;
  if (tab === 'excluded') return <Excluded canManage={canManage} />;
  if (fact && places === '1') return <FactPlaces key={fact} fact={fact} canManage={canManage} />;
  if (fact) return <FactPage key={fact} fact={fact} canManage={canManage} />;
  return <AllFacts />;
}
