/**
 * Suppliers — who Epic pays, what for, and against what.
 *
 * The one column worth explaining is **expected**. It is the same length of
 * window immediately before this one, not a monthly average, because a
 * comparison against an average makes every three-month view look like a
 * threefold overspend. Variance is then computed from the two visible columns,
 * so the row reconciles on the face of it: `£70 (7%)` is `this period −
 * expected`, with no plus signs and a minus only where it applies.
 *
 * A row opens that supplier's spend chart — the same drill as everywhere else.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { asOneOf, useQueryState, useStickyQuery } from '../../router';
import { spacing, type } from '../../theme';
import {
  Cell, Chip, ChipGroup, FilterBar, Standing, SuiteHead, SuitePage, SuiteTable, TwoLine,
  Trouble, Waiting, type Col,
} from './pieces';
import { SuiteControls, suiteKicker, useFormatters, useSuite, useSuiteControls } from './useSuite';
import { SupplierRecord } from './SupplierRecord';
import { sortRows, type SupplierRow } from './model';

const DIRECTIONS = ['all', 'cost', 'revenue'] as const;
// Every header sorts (handoff §5: "sortable headers"). The chips are the
// four somebody reaches for; the headers are all eight.
const SORTS = ['name', 'unitName', 'unitCost', 'volume', 'spend', 'expected', 'variance', 'share'] as const;
type Direction = typeof DIRECTIONS[number];
type SortKey = typeof SORTS[number];

/**
 * A row with its derived columns worked out once, so the table and the sort
 * agree about what "sorted by variance" means.
 *
 * All three are nullable, because a supplier that is **invoiced rather than
 * metered** — Fly.io, Neon, Cloudflare R2, the app stores — has no spend in the
 * ledger at all. Nought there would read as free.
 */
type Priced = SupplierRow & { id: string; variance: number | null; variancePct: number | null };

export function Suppliers({ canSeeMoney, canManage }: {
  canSeeMoney: boolean;
  /**
   * Whether the record's four actions are drawn. Reading who Epic pays and
   * correcting what they charge are different privileges: `manage_settings`
   * carries the second (access.js — "Providers, sources and estate-wide
   * configuration").
   */
  canManage: boolean;
}) {
  const { period, setPeriod, source, setSource } = useSuiteControls();
  useStickyQuery('admin.suite.suppliers', ['who', 'sort', 'dir']);
  const [who, setWho] = useQueryState<Direction>('who', 'all', asOneOf(DIRECTIONS, 'all'));
  const [sort, setSort] = useQueryState<SortKey>('sort', 'spend', asOneOf(SORTS, 'spend'));
  const [dir, setDir] = useQueryState<'up' | 'down'>('dir', 'down', asOneOf(['up', 'down'] as const, 'down'));
  const [supplier, setSupplier] = useQueryState<string>('supplier', '', { read: (r) => r, write: (v) => v || null });

  const { suite, error, reading, reload } = useSuite(period, source);
  const fmt = useFormatters(suite, null);

  const controls = <SuiteControls period={period} setPeriod={setPeriod} source={source} setSource={setSource} />;

  if (!canSeeMoney) {
    return (
      <SuitePage>
        <SuiteHead title="Suppliers" right={controls} />
        <Trouble says="Supplier spend is not yours to see. Ask an administrator for view_financials." />
      </SuitePage>
    );
  }
  if (error) {
    return <SuitePage><SuiteHead title="Suppliers" right={controls} /><Trouble says={error} onRetry={reload} /></SuitePage>;
  }
  if (!suite) {
    return <SuitePage><SuiteHead title="Suppliers" right={controls} /><Waiting says={reading ? 'Reading the ledger…' : undefined} /></SuitePage>;
  }

  const total = suite.suppliers.total || 1;
  const priced: Priced[] = suite.suppliers.rows.map((r) => ({
    ...r,
    id: r.key,
    variance: r.spend == null || r.expected == null ? null : Math.round((r.spend - r.expected) * 100) / 100,
    variancePct: r.spend == null || !r.expected ? null : Math.round(((r.spend - r.expected) / r.expected) * 100),
    share: r.spend == null ? null : Math.round((r.spend / total) * 1000) / 10,
  }));

  if (supplier) {
    return (
      <SupplierRecord
        suiteKey={supplier}
        period={period}
        source={source}
        canManage={canManage}
        crumb="Suppliers"
        onBack={() => setSupplier('')}
        controls={controls}
        kicker={suiteKicker(source, period)}
        history={suite.history}
      />
    );
  }

  let rows = who === 'all' ? priced : priced.filter((r) => r.direction === who);
  rows = sortRows(rows, sort === 'name' ? 'name' : sort, dir === 'down' ? -1 : 1);

  const onSort = (key: string) => {
    if (key === sort) { setDir(dir === 'down' ? 'up' : 'down', { replace: true }); return; }
    setSort(key as SortKey, { replace: true });
    setDir(key === 'name' ? 'up' : 'down', { replace: true });
  };

  // `£70 (7%)`, and `−£16 (−26%)` — the design's exact shape. No plus signs,
  // and both parts derived from the two visible columns so the row adds up.
  /**
   * `£70 (7%)` — derived from the two columns beside it so the row reconciles.
   *
   * Nothing at all where there is no window to compare with: the ledger began
   * in September, so "expected" is nought for every supplier and a variance of
   * "$376.01 (0%)" is a percentage of nothing dressed up as a measurement. The
   * handoff's own rule — a change prints only where a full prior window exists
   * and sums above zero — applies to this column too (20 Sep 2026, live).
   */
  const variance = (r: Priced) => {
    if (r.variance == null || !r.expected) return null;
    const money = fmt.cost.money(Math.abs(r.variance));
    if (money == null) return null;
    const pct = r.variancePct == null ? '' : `  (${r.variancePct < 0 ? '−' : ''}${Math.abs(r.variancePct)}%)`;
    return `${r.variance < 0 ? '−' : ''}${money}${pct}`;
  };

  const columns: Col<Priced>[] = [
    {
      key: 'name', label: 'Supplier', grow: true, align: 'left', sort: 'name',
      cell: (r) => <TwoLine top={r.name} bottom={r.direction === 'revenue' ? 'they pay us' : null} />,
    },
    { key: 'unitName', label: 'What a unit is', width: 150, align: 'left', sort: 'unitName', cell: (r) => <Cell muted left>{r.unitName}</Cell> },
    { key: 'unitCost', label: 'Unit cost', width: 98, sort: 'unitCost', cell: (r) => <Cell muted>{r.unitCost}</Cell> },
        {
      key: 'volume', label: 'Volume', width: 86, sort: 'volume',
      /**
       * A dash rather than a reason.
       *
       * Fly.io, Neon and Cloudflare R2 are billed monthly: there is no unit to
       * count, and the UNIT COST column already says "monthly". A gap sentence
       * is for a figure that ought to exist and does not — printing one here
       * read as "we failed to measure this" rather than "there is nothing to
       * measure" (20 Sep 2026, opening the screen).
       */
      cell: (r) => <Cell muted>{r.volume == null ? '—' : fmt.plain.count(r.volume)}</Cell>,
    },
    /**
     * The reason is given **once** on a row, and the rest of the row is dashes.
     *
     * A gap says what it is — but "Invoiced, not metered" printed in the spend,
     * expected, variance and share columns of the same row is one sentence four
     * times, which reads as a broken table rather than an honest one (20 Sep
     * 2026, on the live estate). The first money column carries it; the others
     * are em dashes, which is what "there is nothing here to compare" looks
     * like once the reason has already been said.
     */
    { key: 'spend', label: 'This period', width: 98, sort: 'spend', cell: (r) => <Cell strong gap={r.gap}>{fmt.cost.money(r.spend)}</Cell> },
    { key: 'expected', label: 'Expected', width: 88, sort: 'expected', cell: (r) => <Cell muted>{r.expected == null ? '—' : fmt.cost.money(r.expected)}</Cell> },
    {
      key: 'variance', label: 'Variance', width: 112, sort: 'variance',
      // Lime at fifteen per cent or more over: the one figure on this screen
      // somebody is looking for, and below that it is noise.
      cell: (r) => <Cell strong lime={(r.variancePct ?? 0) >= 15}>{variance(r) ?? '—'}</Cell>,
    },
    { key: 'share', label: 'Share', width: 74, sort: 'share', cell: (r) => <Cell muted>{r.share == null ? '—' : `${r.share}%`}</Cell> },
  ];

  const largest = [...priced].filter((r) => r.spend != null).sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))[0];

  return (
    <SuitePage>
      <SuiteHead title="Suppliers" kicker={suiteKicker(source, period)} right={controls} />

      <FilterBar right={<Text style={type.small}>{`${rows.length} of ${priced.length} · sorted by ${sort}`}</Text>}>
        <ChipGroup label="Direction">
          <Chip label="We pay them" on={who === 'cost'} onPress={() => setWho('cost', { replace: true })} />
          <Chip label="They pay us" on={who === 'revenue'} onPress={() => setWho('revenue', { replace: true })} />
          <Chip label="All" on={who === 'all'} onPress={() => setWho('all', { replace: true })} />
        </ChipGroup>
        <ChipGroup label="Sort">
          {(['spend', 'variance', 'share', 'name'] as SortKey[]).map((k) => (
            <Chip
              key={k}
              label={k === 'name' ? 'A–Z' : k[0].toUpperCase() + k.slice(1)}
              on={sort === k}
              onPress={() => onSort(k)}
            />
          ))}
        </ChipGroup>
      </FilterBar>

      <View style={{ gap: spacing.sm }}>
        <SuiteTable
          columns={columns}
          rows={rows}
          sort={sort}
          dir={dir === 'down' ? -1 : 1}
          onSort={onSort}
          onRow={(r) => setSupplier(r.key)}
          foot={{
            name: <Text style={[type.h2, { fontSize: 15 }]}>{`${priced.length} ${priced.length === 1 ? 'supplier' : 'suppliers'}`}</Text>,
            spend: <Cell strong>{fmt.cost.money(suite.suppliers.total)}</Cell>,
            expected: <Cell muted>{fmt.cost.money(suite.suppliers.expected)}</Cell>,
            variance: (
              <Cell strong lime>
                {(() => {
                  const d = Math.round((suite.suppliers.total - suite.suppliers.expected) * 100) / 100;
                  const p = suite.suppliers.expected ? Math.round((d / suite.suppliers.expected) * 100) : 0;
                  const money = fmt.cost.money(Math.abs(d));
                  return money == null ? null : `${d < 0 ? '−' : ''}${money}  (${p < 0 ? '−' : ''}${Math.abs(p)}%)`;
                })()}
              </Cell>
            ),
            share: <Cell muted>100%</Cell>,
          }}
          empty={who === 'revenue' ? 'Nobody pays Epic yet — there is no payment provider.' : 'Nothing has been bought in this window.'}
        />
      </View>

      <Standing
        items={[
          {
            label: 'Spend this period',
            value: fmt.cost.money(suite.suppliers.total),
            delta: (() => {
              const d = suite.suppliers.expected ? ((suite.suppliers.total / suite.suppliers.expected) - 1) * 100 : null;
              return d == null ? undefined : fmt.cost.delta(d) ?? undefined;
            })(),
          },
          {
            label: largest ? `Largest supplier · ${largest.name}` : 'Largest supplier',
            value: fmt.cost.money(largest?.spend),
            delta: largest?.variancePct ? `${largest.variancePct < 0 ? '−' : '+'}${Math.abs(largest.variancePct)}%` : undefined,
          },
          {
            label: 'Expected next month',
            value: fmt.cost.money(suite.suppliers.expectedNextMonth),
            // The register *is* built (migration 201). What is missing is a
            // trend to forecast from: the ledger began in September, and a run
            // rate through a single point is not one.
            gap: suite.suppliers.expectedNextMonthGap ?? 'Not forecast',
            delta: suite.suppliers.expectedNextMonthDeltaPct == null
              ? undefined
              : fmt.cost.delta(suite.suppliers.expectedNextMonthDeltaPct) ?? undefined,
          },
        ]}
      />

      {suite.money.costToServe.classDerived ? (
        // Said plainly rather than left to be assumed: the class is worked out
        // when the ledger is read, because `provider_calls.class` is not a
        // column yet, so a rule change would restate an old period.
        <Text style={type.tiny}>
          Cost class is worked out at read time from the purpose and who made the call.
          It is not stored on the call, so changing the rule would restate a closed period.
        </Text>
      ) : null}
    </SuitePage>
  );
}
