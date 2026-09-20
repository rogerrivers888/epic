/**
 * Customers — who they are, and one household's whole record.
 *
 * A search box, two sets of chips, and a table where every header sorts. The
 * filters are in the address and *replace* rather than push, so the back button
 * walks the pages somebody visited rather than every chip they tried; opening a
 * household pushes, because that is a move.
 *
 * At risk is the one alarm-red thing on the screen, and the handoff allows at
 * most one per screen. It is derived from the state of the row — paying, and
 * nothing opened in thirty days — rather than instrumented, which is the ninth
 * rule: instrument entry, derive exit.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { asOneOf, asText, useQueryState, useStickyQuery } from '../../router';
import { spacing, type } from '../../theme';
import {
  Cell, Chip, ChipGroup, FilterBar, SearchBox, Standing, SuiteHead, SuitePage, SuiteTable, TwoLine,
  Trouble, Waiting, type Col,
} from './pieces';
import { SuiteControls, suiteKicker, useFormatters, useHouseholdRecord, useSuite, useSuiteControls } from './useSuite';
import { HouseholdRecordView } from './HouseholdRecord';
import { joinedDay, lastSeen, share, sortRows, statusWord, type HouseholdRow } from './model';

const PLANS = ['All', 'Household', 'Solo', 'Annual', 'Trial', 'Standard'] as const;
const STATUSES = ['All', 'Live', 'Trial', 'At risk', 'Cancelled'] as const;
type Plan = typeof PLANS[number];
type Status = typeof STATUSES[number];
const SORTS = ['name', 'plan', 'monthPence', 'joined', 'lastSeenDays', 'places', 'daysOut', 'bookings', 'ratings', 'status'] as const;
type SortKey = typeof SORTS[number];

export function Customers({ canSeeMoney }: { canSeeMoney: boolean }) {
  const { period, setPeriod, source, setSource } = useSuiteControls();
  useStickyQuery('admin.suite.customers', ['q', 'plan', 'status', 'sort', 'dir']);
  const [q, setQ] = useQueryState<string>('q', '', asText);
  const [plan, setPlan] = useQueryState<Plan>('plan', 'All', asOneOf(PLANS, 'All'));
  const [status, setStatus] = useQueryState<Status>('status', 'All', asOneOf(STATUSES, 'All'));
  const [sort, setSort] = useQueryState<SortKey>('sort', 'places', asOneOf(SORTS, 'places'));
  const [dir, setDir] = useQueryState<'up' | 'down'>('dir', 'down', asOneOf(['up', 'down'] as const, 'down'));
  const [householdId, setHouseholdId] = useQueryState<string>('household', '', asText);

  const { suite, error, reading, reload } = useSuite(period, source);
  const fmt = useFormatters(suite, null);
  const { record, error: recordError } = useHouseholdRecord(householdId || null, period, source);

  const controls = <SuiteControls period={period} setPeriod={setPeriod} source={source} setSource={setSource} />;

  if (error) {
    return <SuitePage><SuiteHead title="Customers" right={controls} /><Trouble says={error} onRetry={reload} /></SuitePage>;
  }
  if (!suite) {
    return <SuitePage><SuiteHead title="Customers" right={controls} /><Waiting says={reading ? 'Reading the households…' : undefined} /></SuitePage>;
  }

  // The record is a layer inside this screen — its own address, its own crumb.
  if (householdId) {
    return (
      <HouseholdRecordView
        record={record}
        error={recordError}
        suite={suite}
        onBack={() => setHouseholdId('')}
        onFilterToFamily={() => setHouseholdId('')}
        controls={controls}
        kicker={suiteKicker(source, period)}
      />
    );
  }

  const all = suite.customers.households;
  const needle = q.trim().toLowerCase();
  let rows = all.filter((h) => (needle
    ? `${h.name} ${h.area ?? ''}`.toLowerCase().includes(needle)
    : true));
  if (plan !== 'All') rows = rows.filter((h) => h.plan === plan);
  if (status !== 'All') rows = rows.filter((h) => statusWord(h).startsWith(status));
  rows = sortRows(rows, sort, dir === 'down' ? -1 : 1);

  const onSort = (key: string) => {
    if (key === sort) { setDir(dir === 'down' ? 'up' : 'down', { replace: true }); return; }
    setSort(key as SortKey, { replace: true });
    setDir('down', { replace: true });
  };

  const columns: Col<HouseholdRow>[] = [
    {
      key: 'name', label: 'Household', grow: true, align: 'left', sort: 'name',
      cell: (h) => <TwoLine top={h.name} bottom={[h.area, h.people ? `${h.people} ${h.people === 1 ? 'person' : 'people'}` : null].filter(Boolean).join(' · ') || null} />,
    },
    { key: 'plan', label: 'Plan', width: 92, align: 'left', sort: 'plan', cell: (h) => <Cell muted left>{h.plan}</Cell> },
    {
      key: 'mo', label: '£ / mo', width: 66, sort: 'monthPence',
      cell: (h) => (canSeeMoney
        ? <Cell strong>{h.monthPence ? fmt.revenue.money(h.monthPence, { pence: true }) : '—'}</Cell>
        : <Cell muted gap="view_financials">{null}</Cell>),
    },
    { key: 'joined', label: 'Joined', width: 86, sort: 'joined', cell: (h) => <Cell muted>{joinedDay(h.joined)}</Cell> },
    { key: 'seen', label: 'Last seen', width: 86, sort: 'lastSeenDays', cell: (h) => <Cell muted>{lastSeen(h.lastSeenDays)}</Cell> },
    { key: 'places', label: 'Places', width: 64, sort: 'places', cell: (h) => <Cell>{String(h.places)}</Cell> },
    { key: 'out', label: 'Days out', width: 74, sort: 'daysOut', cell: (h) => <Cell>{String(h.daysOut)}</Cell> },
    { key: 'bookings', label: 'Bookings', width: 78, sort: 'bookings', cell: (h) => <Cell>{String(h.bookings)}</Cell> },
    { key: 'ratings', label: 'Ratings', width: 68, sort: 'ratings', cell: (h) => <Cell>{String(h.ratings)}</Cell> },
    {
      // The last figure column is right-aligned and this one is left-aligned,
      // so without a gap of its own "9" and "Live" read as one string. The
      // table's 10px row gap is not enough where two alignments meet.
      key: 'status', label: 'Status', width: 140, align: 'left', sort: 'status', pad: 14,
      cell: (h) => <Cell left alarm={h.status === 'at_risk'} muted={h.status === 'cancelled'}>{statusWord(h)}</Cell>,
    },
  ];

  return (
    <SuitePage>
      <SuiteHead title="Customers" kicker={suiteKicker(source, period)} right={controls} />

      <FilterBar right={(
        <Text style={type.small}>
          {`${rows.length} of ${all.length} shown · ${suite.customers.total.toLocaleString()} households`}
        </Text>
      )}>
        <SearchBox value={q} onChange={(v) => setQ(v, { replace: true })} placeholder="Search a name or an area" />
        <ChipGroup label="Plan">
          {PLANS.map((p) => <Chip key={p} label={p} on={plan === p} onPress={() => setPlan(p, { replace: true })} />)}
        </ChipGroup>
        <ChipGroup label="Status">
          {STATUSES.map((s) => <Chip key={s} label={s} on={status === s} onPress={() => setStatus(s, { replace: true })} />)}
        </ChipGroup>
      </FilterBar>

      <View style={{ gap: spacing.sm }}>
        <SuiteTable
          columns={columns}
          rows={rows}
          sort={sort}
          dir={dir === 'down' ? -1 : 1}
          onSort={onSort}
          onRow={(h) => setHouseholdId(h.id)}
          empty={needle || plan !== 'All' || status !== 'All'
            ? 'No household matches that.'
            : 'No households yet.'}
        />
      </View>

      <Standing
        items={[
          {
            label: 'Paying',
            value: fmt.plain.count(suite.customers.paying),
            sub: canSeeMoney ? `${fmt.revenue.money(suite.customers.payingMrr)} a month` : undefined,
          },
          {
            label: 'On trial',
            value: fmt.plain.count(suite.customers.trial),
            sub: suite.customers.trialConvertPct == null
              ? undefined
              : `${suite.customers.trialConvertPct}% convert · ${suite.customers.trialGranted} granted by hand`,
          },
          {
            label: 'At risk',
            value: fmt.plain.count(suite.customers.atRisk),
            sub: 'paying, nothing opened in 30 days',
          },
        ]}
      />

      {/* Small-n honesty, said once where it applies: a share of a dozen
          households is a count, not a percentage. */}
      {suite.customers.total < 30 ? (
        <Text style={type.tiny}>
          {`Shares on the other screens read as counts while the estate is this small — ${share(suite.customers.paying, suite.customers.total)} paying.`}
        </Text>
      ) : null}
    </SuitePage>
  );
}
