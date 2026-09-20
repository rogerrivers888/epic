/**
 * One estate model, read once, shared by five screens — and the two switches
 * that are true across all of them.
 *
 * **The period and the data source are in the address.** "Every page of our
 * site needs a unique URL… 2 layers in, I should be able to share a URL with
 * someone, and they should be able to get to the exact point that I was on"
 * (owner, 5 Sep 2026). So `/admin/money?period=last-3-months&data=mock` is a
 * link that lands on what it says, and `useStickyQuery` under one shared name
 * carries both from screen to screen — the period you were reading Overview at
 * is still set when you open Suppliers.
 *
 * **Why the mock switch is a source and not a theme.** The owner, 20 Sep 2026:
 * "I would like to be able to have a little toggle for 'Show mock data' so that
 * we can see what this looks like until such time as we have real data coming
 * in, and then I can toggle back to real data when I wish." It is therefore a
 * property of the answer, chosen by the request — the fixtures live on the
 * server and cannot leak into a real reading — and it says so on every screen
 * while it is on, because a mock figure mistaken for a measurement is the one
 * failure this whole suite exists to prevent.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { api, ApiError } from '../../api';
import { asOneOf, useQueryState, useRouter, useStickyQuery } from '../../router';
import { paths } from '../../routes';
import type { Currency, HouseholdRecord, PeriodKey, Suite } from './model';
import { currencies, formatter } from './model';
import { PeriodPicker, Seg } from './pieces';

const PERIOD_KEYS: PeriodKey[] = ['last-30-days', 'this-month', 'last-month', 'last-3-months', 'last-12-months'];
const DEFAULT_PERIOD: PeriodKey = 'this-month';

export type DataSource = 'real' | 'mock';

/**
 * The two switches every suite screen carries.
 *
 * One sticky name for all five screens, so they share the period and the source
 * rather than each remembering its own — which would mean Money saying £9,244
 * while Overview said £0.
 */
export function useSuiteControls() {
  useStickyQuery('admin.suite', ['period', 'data']);
  const [period, setPeriod] = useQueryState<PeriodKey>('period', DEFAULT_PERIOD, asOneOf(PERIOD_KEYS, DEFAULT_PERIOD));
  const [source, setSource] = useQueryState<DataSource>('data', 'real', asOneOf(['real', 'mock'] as const, 'real'));
  return { period, setPeriod, source, setSource };
}

/** The whole model for one window, or the reason it could not be read. */
export function useSuite(period: PeriodKey, source: DataSource) {
  const [suite, setSuite] = useState<Suite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(true);

  const load = useCallback(async () => {
    setReading(true);
    try {
      setSuite(await api.adminSuite({ period, data: source }));
      setError(null);
    } catch (e: any) {
      // Plain words on the face of it; the provider's own sentence belongs in
      // the back office's logs, not on a screen (feedback, 8 Sep 2026).
      setError(e instanceof ApiError
        ? (e.status === 403 ? 'Reporting is not yours to see. Ask an administrator for view_reporting.' : e.message)
        : 'Could not reach Epic.');
    } finally {
      setReading(false);
    }
  }, [period, source]);

  useEffect(() => { void load(); }, [load]);

  return { suite, error, reading, reload: load };
}

/**
 * The household list, on its own.
 *
 * Customers is an accounts question, not a reporting one: the built-in support
 * role holds `view_accounts` and not `view_reporting`, so reading the whole
 * estate model here showed them a rail item that answered 403 (Codex, 20 Sep
 * 2026). This reads `/api/admin/suite/customers`, which is gated on accounts —
 * and withholds the money columns from anybody without `view_financials`.
 */
export function useCustomers(period: PeriodKey, source: DataSource) {
  const [customers, setCustomers] = useState<Suite['customers'] | null>(null);
  const [gaps, setGaps] = useState<Record<string, string>>({});
  const [withheld, setWithheld] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(true);

  const load = useCallback(async () => {
    setReading(true);
    try {
      const body = await api.adminSuiteCustomers({ period, data: source });
      setCustomers(body.customers);
      setGaps(body.gaps ?? {});
      setWithheld(body.withheld ?? []);
      setError(null);
    } catch (e: any) {
      setError(e instanceof ApiError
        ? (e.status === 403 ? 'Households are not yours to see. Ask an administrator for view_accounts.' : e.message)
        : 'Could not reach Epic.');
    } finally {
      setReading(false);
    }
  }, [period, source]);

  useEffect(() => { void load(); }, [load]);
  return { customers, gaps, withheld, error, reading, reload: load };
}

/** One household's record, for the drill off Customers. */
export function useHouseholdRecord(id: string | null, period: PeriodKey, source: DataSource) {
  const [record, setRecord] = useState<HouseholdRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) { setRecord(null); return; }
    let live = true;
    (async () => {
      try {
        const body = await api.adminSuiteHousehold(id, { period, data: source });
        // The record is a wide, screen-shaped object rather than a narrow type:
        // it is one household's whole file, and every panel reads a different
        // corner of it. The cast is the one place that is admitted.
        if (live) { setRecord(body.household as HouseholdRecord); setError(null); }
      } catch (e: any) {
        if (live) setError(e instanceof ApiError && e.status === 404 ? 'No such household.' : 'Could not reach Epic.');
      }
    })();
    return () => { live = false; };
  }, [id, period, source]);

  return { record, error };
}

/**
 * The formatters a screen needs: one for revenue, one for cost.
 *
 * Two rather than one because in a real reading they are measured in different
 * currencies — revenue is contracted in pence and provider cost is what
 * `provider_calls` recorded, which is dollars. Converting would mean inventing
 * an exchange rate, so the screens say which unit each figure is in.
 *
 * `perSub` is the per-subscriber context: given, every money figure the screen
 * draws divides by it, once, here.
 */
export function useFormatters(suite: Suite | null, perSub: number | null) {
  return useMemo(() => {
    const c = currencies(suite);
    return {
      revenue: formatter({ currency: c.revenue, perSub }),
      cost: formatter({ currency: c.cost, perSub }),
      plain: formatter({ currency: c.revenue, perSub: null }),
      currency: c as { revenue: Currency; cost: Currency },
      mixed: c.revenue !== c.cost,
    };
  }, [suite, perSub]);
}

/**
 * The controls on the right of every suite header: whatever the screen adds,
 * then the source switch, then the period.
 *
 * The source switch is last-but-one rather than hidden in a menu on purpose. It
 * changes the meaning of every figure on the screen, and a control that does
 * that belongs where the figures are.
 */
export function SuiteControls({ period, setPeriod, source, setSource, children }: {
  period: PeriodKey;
  setPeriod: (p: PeriodKey) => void;
  source: DataSource;
  setSource: (s: DataSource) => void;
  children?: React.ReactNode;
}) {
  return (
    <>
      {children}
      <Seg
        label="Where the figures come from"
        value={source}
        options={[{ value: 'real', label: 'Real' }, { value: 'mock', label: 'Mock data' }]}
        onChange={setSource}
      />
      <PeriodPicker
        value={period}
        options={PERIOD_KEYS.map((key) => ({ key, label: LABELS[key] }))}
        onChange={(k) => setPeriod(k as PeriodKey)}
      />
    </>
  );
}

const LABELS: Record<PeriodKey, string> = {
  'last-30-days': 'Last 30 days',
  'this-month': 'This month',
  'last-month': 'Last month',
  'last-3-months': 'Last 3 months',
  'last-12-months': 'Last 12 months',
};

/**
 * What the kicker over a screen's name says.
 *
 * When the fixtures are on it reads "MOCK DATA · <period>", in lime, on every
 * screen of the suite. Four words rather than a banner, because a banner is a
 * paragraph and the owner has asked repeatedly for the screen to tell the story
 * rather than explain it.
 */
export const suiteKicker = (source: DataSource, period: PeriodKey) =>
  `${source === 'mock' ? 'Mock data · ' : ''}${LABELS[period]}`;

/**
 * Where a suite screen sends you, spelled through `routes.ts`.
 *
 * Nothing in the suite touches `window.location`; a move is `navigate`, and a
 * filter is a query write that replaces rather than pushes, so the back button
 * walks the pages somebody visited and not every chip they tried.
 */
export function useSuiteNav() {
  const { navigate } = useRouter();
  return useMemo(() => ({
    go: (screen: Parameters<typeof paths.admin>[0], query?: Record<string, string | null>) => {
      const href = paths.admin(screen);
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(query ?? {})) if (v) q.set(k, v);
      navigate(q.toString() ? `${href}?${q}` : href);
    },
    navigate,
  }), [navigate]);
}

/** A spacer that keeps the header's controls off the page's own left edge. */
export const Spacer = () => <View style={{ flex: 1 }} />;
