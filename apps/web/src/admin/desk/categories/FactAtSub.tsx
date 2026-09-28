/**
 * One fact at one subcategory: the places that have it (README v2, the fact
 * page's drill-down, reached from a subcategory page; prototype `isFact`).
 * The same drill-down as the Facts tab's — Place · (Answer) · Area · How we
 * know · Edit, the filters in the address, "Looked for at 40 places · found
 * at 12", and the fact's VERIFICATION column — under the Categories trail.
 * Address: `?tab=categories&sub=<key>&fact=<key>` (+ `q`, `country`,
 * `county`, `pc`).
 */

import React from 'react';

import { useDeskGo } from '../Desk';
import { PlacesDrill } from '../facts/AllFacts';

export function FactAtSub({ sub, fact, canManage }: { sub: string; fact: string; canManage: boolean }) {
  const go = useDeskGo();
  return (
    <PlacesDrill
      fact={fact}
      sub={sub}
      canManage={canManage}
      crumbs={(d) => [
        { name: 'Categories', go: () => go('categories') },
        { name: d?.subLabel ?? '…', go: () => go('categories', { sub }) },
        { name: d?.label ?? '…' },
      ]}
    />
  );
}
