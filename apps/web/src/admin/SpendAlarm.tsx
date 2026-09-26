/**
 * The estate's day against its ceiling, over every back-office page.
 *
 * Owner, 26 Sep 2026 (G8): "Daily £ ceiling across the estate from
 * estimated_cost_usd: alarm at 80% (email and back-office banner), refuse at
 * 100%." Nothing is drawn under 80%. At 80% it says how close; at 100% it says
 * paid calls are refused until midnight. One line — the detail is the ledger.
 * Asked again every minute, so a page left open still says when it changes.
 */

import React, { useEffect, useState } from 'react';
import { api, SpendToday } from '../api';
import { Banner } from './kit';

export function SpendAlarm() {
  const [today, setToday] = useState<SpendToday | null>(null);
  useEffect(() => {
    let live = true;
    const ask = () => api.spendToday().then((t) => { if (live) setToday(t); }).catch(() => null);
    void ask();
    const timer = setInterval(ask, 60_000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  if (!today?.level) return null;
  const figure = `£${today.spentGbp.toFixed(2)} of £${today.ceilingGbp.toFixed(2)}`;
  const mail = today.mailTo ? '' : ' No alarm e-mail: EPIC_ALARM_EMAIL is not set.';
  return today.level === 'stop'
    ? <Banner tone="crit">{`Daily spend ceiling reached — ${figure}. Paid calls are refused until midnight.${mail}`}</Banner>
    : <Banner tone="warn">{`Today's spend is at ${Math.round(today.ratio * 100)}% of the daily ceiling — ${figure}.${mail}`}</Banner>;
}
