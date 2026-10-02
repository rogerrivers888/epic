/**
 * What the Hosting tab's screens share (hosting v4, BO8a–BO8r). The rules in
 * the handoff's §1 are acceptance criteria: no prose on screens, every field
 * explains itself on hover (a column's `tip`, inherited by its cells — use
 * the back office's own `Ladder` and `Explain`), filters are dropdowns grouped
 * on the left (`FilterRow` + `Dropdown` from ../kit), every column sorts, one
 * line per cell, an empty cell is a dash, lines not boxes, lime / amber / red
 * for live / attention / refusal only.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Press } from '../../components/press';
import { colors, fonts } from '../../theme';

export const KIND_WORDS: Record<string, string> = { oneoff: 'One-off', weekly: 'Weekly', course: 'Course', onrequest: 'On request' };
export const KIND_OPTIONS = [{ key: 'all', label: 'All' }, { key: 'oneoff', label: 'One-off' }, { key: 'weekly', label: 'Weekly' }, { key: 'course', label: 'Course' }, { key: 'onrequest', label: 'On request' }];

const TAB_WORDS: Record<string, string> = { review: 'Review', hosts: 'Hosts', events: 'Events', money: 'Money', safety: 'Safety', settings: 'Settings', reports: 'Reports', changes: 'Changes', older: 'Older offers' };

/** The sub-tabs: words on one line, the chosen one lime-underlined. */
export function HostingTabs<K extends string>({ value, onPick }: { value: K; onPick: (k: K) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 22, borderBottomWidth: 2, borderBottomColor: colors.line, marginBottom: 18 }}>
      {(Object.keys(TAB_WORDS) as K[]).map((k) => (
        <Press key={k} onPress={() => onPick(k)} accessibilityRole="tab" accessibilityState={{ selected: value === k }}
          style={{ paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: value === k ? colors.lime : 'transparent', marginBottom: -2 }}>
          <Text style={{ fontFamily: fonts.body, fontSize: 14, fontWeight: value === k ? '800' : '600', color: value === k ? colors.ink : colors.inkMuted }}>{TAB_WORDS[k]}</Text>
        </Press>
      ))}
    </View>
  );
}

/** Load once, reload on demand; errors in plain words. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(() => { load().then((d) => { setData(d); setError(null); }).catch((e) => setError(e?.message ?? 'That didn’t load.')); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, [run]);
  return { data, error, reload: run };
}

/** Sort rows by a column key, either way, keeping nulls last; the sort lives in the query. */
export function useSorted<T>(rows: T[] | null | undefined, sort: string | null, desc: boolean, value: (row: T, key: string) => unknown) {
  return useMemo(() => {
    if (!rows) return [];
    if (!sort) return rows;
    const out = [...rows].sort((a, b) => {
      const x = value(a, sort); const y = value(b, sort);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return desc ? -c : c;
    });
    return out;
  }, [rows, sort, desc]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** £ from pence, or a dash. */
export const gbp = (p: number | null | undefined) => (p == null ? '—' : `£${(p / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
/** "3 Oct" / "3 Oct 14:20", or a dash. */
export const when = (iso: string | null | undefined, time = false) => {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
  return time && iso.length > 10 ? `${day} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}` : day;
};
