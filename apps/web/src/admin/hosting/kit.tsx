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
import { AMBER_DARK, colors, desk, fonts, getAdminThemePref, INK, LIME } from '../../theme';
import { api, ApiError } from '../../api';
import { useRouter } from '../../router';

export const KIND_WORDS: Record<string, string> = { oneoff: 'One-off', weekly: 'Weekly', course: 'Course', onrequest: 'On request' };
export const KIND_OPTIONS = [{ key: 'all', label: 'All' }, { key: 'oneoff', label: 'One-off' }, { key: 'weekly', label: 'Weekly' }, { key: 'course', label: 'Course' }, { key: 'onrequest', label: 'On request' }];

const TAB_WORDS: Record<string, string> = { review: 'Review', hosts: 'Hosts', events: 'Events', money: 'Money', safety: 'Safety', settings: 'Settings', reports: 'Reports', changes: 'Changes', older: 'Older offers' };

/** The sub-tabs: words on one line, the chosen one lime-underlined. */
export function HostingTabs<K extends string>({ value, onPick, counts = null }: { value: K; onPick: (k: K) => void; counts?: Partial<Record<K, number>> | null }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 22, borderBottomWidth: 2, borderBottomColor: colors.line, marginBottom: 18 }}>
      {(Object.keys(TAB_WORDS) as K[]).map((k) => (
        <Press key={k} onPress={() => onPick(k)} accessibilityRole="tab" accessibilityState={{ selected: value === k }}
          style={{ paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: value === k ? colors.lime : 'transparent', marginBottom: -2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontFamily: fonts.body, fontSize: 14, fontWeight: value === k ? '800' : '600', color: value === k ? colors.ink : colors.inkMuted }}>{TAB_WORDS[k]}</Text>
            {counts?.[k] ? (
              <Text style={{ fontFamily: fonts.body, fontSize: 11, fontWeight: '800', color: INK, backgroundColor: LIME, paddingHorizontal: 5, lineHeight: 16, fontVariant: ['tabular-nums'] }}>
                {counts[k]!.toLocaleString()}
              </Text>
            ) : null}
          </View>
        </Press>
      ))}
    </View>
  );
}

/**
 * Every row opens its record, and every name in it that refers to something
 * else opens that (K15 §3, Roger, 3 Oct 2026: "every table is clickable").
 * The row's own press goes to `Ladder`'s `onRow`; a name inside it is pressed
 * as text, whose press stops the click before it reaches the row, so a host's
 * name in a payout's row opens the host and the rest of the row the payout.
 */
export function useOpen() {
  const { navigate } = useRouter();
  return useCallback((href: string) => navigate(href, { replace: false }), [navigate]);
}

/** A name that opens its own record; plain words when there is nothing to open. A dash for nothing at all. */
export function Opens({ to, children, strong }: { to: string | null | undefined; children: React.ReactNode; strong?: boolean }) {
  const open = useOpen();
  const style = { fontFamily: fonts.body, fontSize: 13.5, color: colors.ink, fontWeight: strong ? '700' as const : '400' as const };
  if (children == null || children === '') return <Text style={[style, { color: colors.inkMuted }]}>—</Text>;
  if (!to) return <Text style={style} numberOfLines={1}>{children}</Text>;
  return (
    <Text style={[style, { textDecorationLine: 'underline' }]} numberOfLines={1} accessibilityRole="link" onPress={() => open(to)}>{children}</Text>
  );
}

/** Amber, "attention" (handoff §6): the desk's own on the dark back office, the app's darker one on a light back office. */
export const amberTone = () => (getAdminThemePref() === 'light' ? AMBER_DARK : desk.amber);

/** Lime, "live" (handoff §1.10): flat lime on the dark back office; on a light one the moss, because lime type never sits on cream. */
export const liveTone = () => (getAdminThemePref() === 'light' ? colors.accent : LIME);

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

/**
 * An owner-only action (the key icon, handoff §7): run it, and if the server
 * says it needs the owner personally signed in, file it to Approvals with the
 * exact call and a plain-English brief instead. Says which happened.
 */
export async function ownerAct(method: 'POST' | 'PUT', path: string, body: Record<string, unknown>,
  brief: { change: string; why: string; affected: { count: number; unit: string } }): Promise<'done' | 'filed'> {
  try {
    if (method === 'PUT') await api.hostingAdminPut(path, body); else await api.hostingAdminPost(path, body);
    return 'done';
  } catch (e) {
    if (!(e instanceof ApiError) || e.code !== 'needs_personal_sign_in') throw e;
    await api.fileApproval({
      request: `${method} /api/admin/hosting${path}`, description: brief.change, payload: body,
      chat: 'Back office · Hosting', why: brief.why, change: brief.change, affected: brief.affected, costPence: 0,
    });
    return 'filed';
  }
}
