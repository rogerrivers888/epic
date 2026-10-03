/**
 * Hosting › Changes (hosting v4; the design's "Audit", renamed by the
 * handover §3.8). Every change to a setting, an event, a session, a host, a
 * booking, a payout, a review or a complaint: who, when, before → after, why.
 *
 * Newest first. The server returns at most its limit, and a capped list says
 * "first N" — it can say what it found, never what is absent.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../../api';
import { asOneOf, asText, useQueryState } from '../../router';
import { BORDER, colors, fonts, spacing, type } from '../../theme';
import { Icon } from '../../components/Icon';
import { Press } from '../../components/press';
import { Banner, Dropdown, FilterRow, PageHead, TextAction } from '../kit';
import { useSession } from '../../hooks/useSession';
import { Blank, Ladder, Stat, Word, type Col } from '../table';
import { useLoad, useSorted, when } from './kit';

type Change = {
  id: string;
  subjectKind: string;
  subjectId: string;
  field: string | null;
  before: unknown;
  after: unknown;
  why: string | null;
  by: string | null;
  byLabel: string | null;
  approvalId: string | null;
  at: string;
};

type Changes = { changes: Change[]; limit: number; capped: boolean };

const KINDS = ['all', 'setting', 'event', 'session', 'host', 'booking', 'payout', 'review', 'complaint'] as const;
type Kind = typeof KINDS[number];
const KIND_WORDS: Record<Kind, string> = {
  all: 'All', setting: 'Setting', event: 'Event', session: 'Session', host: 'Host', booking: 'Booking', payout: 'Payout', review: 'Review', complaint: 'Complaint',
};
const SORTS = ['at', 'what', 'change', 'why', 'who'] as const;

/** A value on one line: words as they are, objects as `key: value` pairs, nothing as a dash. */
export function compact(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map(compact).join(', ')}]`;
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    // `{ value: … }` alone is the value; say the value.
    if (entries.length === 1 && entries[0][0] === 'value') return compact(entries[0][1]);
    return entries.map(([k, x]) => `${k}: ${compact(x)}`).join(' · ');
  }
  return String(v);
}

const whatOf = (c: Change) => [KIND_WORDS[c.subjectKind as Kind] ?? c.subjectKind, c.field].filter(Boolean).join(' · ');
const changeOf = (c: Change) => (c.before == null ? compact(c.after) : `${compact(c.before)} → ${compact(c.after)}`);

export function ChangesTab() {
  const [kind, setKind] = useQueryState<Kind>('what', 'all', asOneOf(KINDS, 'all'));
  const [subject, setSubject] = useQueryState<string>('subject', '', asText);
  const [sort, setSort] = useQueryState<typeof SORTS[number]>('sort', 'at', asOneOf(SORTS, 'at'));
  // Newest first unless somebody turns it round.
  const [asc, setAsc] = useQueryState<boolean>('asc', false, { read: (r) => r === '1', write: (v) => (v ? '1' : null) });
  const [typed, setTyped] = useState(subject);
  useEffect(() => { setTyped(subject); }, [subject]);
  // The search is written to the address a moment after typing stops.
  useEffect(() => {
    if (typed.trim() === subject) return undefined;
    const t = setTimeout(() => setSubject(typed.trim()), 400);
    return () => clearTimeout(t);
  }, [typed, subject, setSubject]);

  const { data, error, reload } = useLoad<Changes>(
    () => api.hostingAdmin<Changes>('/changes', { kind: kind === 'all' ? null : kind, subject: subject || null }),
    [kind, subject],
  );

  // Undo (Roger, 3 Oct 2026): a setting's newest change, for the owner signed in personally — an older one would
  // overwrite whatever came after it, so it is never offered.
  const { access } = useSession();
  const direct = Boolean(access?.elevated);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [undoSaid, setUndoSaid] = useState<string | null>(null);
  const latest = new Set<string>();
  {
    const seen = new Set<string>();
    for (const c of [...(data?.changes ?? [])].sort((a, b) => String(b.at).localeCompare(String(a.at)))) {
      if (c.subjectKind !== 'setting' || seen.has(c.subjectId)) continue;
      seen.add(c.subjectId); latest.add(c.id);
    }
  }
  const undo = async (c: Change) => {
    setUndoing(c.id); setUndoSaid(null);
    try { await api.hostingAdminPost(`/changes/${encodeURIComponent(c.id)}/undo`, {}); setUndoSaid('Undone, and logged here.'); reload(); }
    catch (e: any) { setUndoSaid(e?.message ?? 'That didn’t undo.'); }
    finally { setUndoing(null); }
  };

  // Text columns read A→Z on the first press; When reads newest first.
  const desc = sort === 'at' ? !asc : asc;
  const rows = useSorted(data?.changes, sort, desc, (c, k) => {
    switch (k) {
      case 'at': return c.at;
      case 'what': return whatOf(c).toLowerCase();
      case 'change': return changeOf(c).toLowerCase();
      case 'why': return c.why?.toLowerCase() ?? null;
      case 'who': return c.by?.toLowerCase() ?? null;
      default: return null;
    }
  });

  const columns: Col<Change>[] = [
    { key: 'at', label: 'When', width: 120, sort: 'at',
      note: data?.capped ? `first ${data.changes.length}` : undefined,
      tip: ['When', 'When the change was made. Newest first.'],
      cell: (c) => <Word>{when(c.at, true)}</Word> },
    { key: 'what', label: 'What', width: 200, sort: 'what',
      tip: ['What', 'What kind of thing changed, and which part of it. Press a row to see every change to that one thing.'],
      cellTip: (c) => [whatOf(c), c.subjectId],
      cell: (c) => <Word strong>{whatOf(c)}</Word> },
    { key: 'change', label: 'Before → After', grow: true, sort: 'change',
      tip: ['Before → After', 'What it was, and what it became. Only the after when there was nothing before.'],
      cellTip: (c) => ['Before → After', changeOf(c)],
      cell: (c) => <Text style={s.mono} numberOfLines={1}>{changeOf(c)}</Text> },
    { key: 'why', label: 'Why', width: 260, sort: 'why', tip: ['Why', 'The reason given with the change.'],
      cellTip: (c) => (c.why ? ['Why', c.why] : null),
      cell: (c) => (c.why ? <Text style={s.word} numberOfLines={1}>{c.why}</Text> : <Blank />) },
    { key: 'who', label: 'Who', width: 190, sort: 'who',
      tip: ['Who', 'The person who made it, or Epic when a rule made it on its own.'],
      cellTip: (c) => (c.approvalId ? ['Who', `${c.by ?? '—'}, under approval ${c.approvalId}.`] : null),
      cell: (c) => (c.by ? <Word>{c.by === 'epic' ? 'Epic' : c.by}</Word> : <Blank />) },
    ...(direct ? [{ key: 'undo', label: '', width: 70,
      tip: ['Undo', 'Puts a setting back as it was before its latest change, and logs that here too.'] as [string, string],
      cell: (c: Change) => (latest.has(c.id) ? <TextAction label={undoing === c.id ? '…' : 'Undo'} onPress={() => { void undo(c); }} disabled={Boolean(undoing)} /> : <Blank />) }] : []),
  ];

  return (
    <View style={{ gap: spacing.lg }}>
      <PageHead kicker="Hosting · Changes" title="Changes"
        right={(
          <View style={s.stats}>
            <Stat label="Changes" value={data ? (data.capped ? `first ${data.changes.length}` : data.changes.length) : '—'}
              tip={['Changes', 'Matching the filters. A capped list is the newest only, not all of them.']} />
          </View>
        )} />

      {undoSaid ? <Banner tone="accent">{undoSaid}</Banner> : null}
      <FilterRow>
        <Dropdown label="Kind" value={KIND_WORDS[kind]} width={200}
          options={([...KINDS.slice(1), 'all'] as Kind[]).map((k) => ({ key: k, label: KIND_WORDS[k], on: kind === k }))}
          onPick={(k) => setKind(k as Kind)} />
        <View style={s.search}>
          <Icon name="search" size={13} color={colors.inkMuted} strokeWidth={2.2} />
          <TextInput value={typed} onChangeText={setTyped} placeholder="Subject id" placeholderTextColor={colors.inkMuted}
            onSubmitEditing={() => setSubject(typed.trim())} style={s.searchInput} accessibilityLabel="Subject id" />
          {typed ? (
            <Press onPress={() => { setTyped(''); setSubject(''); }} accessibilityRole="button" accessibilityLabel="Clear the subject" hitSlop={6}>
              <Icon name="close" size={12} color={colors.inkMuted} strokeWidth={2.4} />
            </Press>
          ) : null}
        </View>
      </FilterRow>

      {error ? <Banner tone="crit">{error}</Banner> : null}

      {data ? (
        <Ladder columns={columns} rows={rows} keyOf={(c) => c.id}
          sort={sort} desc={desc}
          onSort={(k) => { if (k === sort) setAsc(!asc); else { setSort(k as typeof SORTS[number]); setAsc(false); } }}
          onRow={(c) => { setKind(c.subjectKind as Kind); setSubject(c.subjectId); }}
          label={(c) => `Every change to ${whatOf(c)} ${c.subjectId}`}
          empty={<Blank />}
          phoneRow={(c) => ({
            name: whatOf(c),
            note: when(c.at, true),
            chips: [
              { key: 'change', word: changeOf(c), tip: columns[2].tip, lead: true },
              ...(c.why ? [{ key: 'why', word: c.why, tip: columns[3].tip }] : []),
              ...(c.by ? [{ key: 'who', word: c.by, tip: columns[4].tip }] : []),
            ],
          })} />
      ) : error ? null : <Text style={type.small}>…</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 34, alignItems: 'flex-end' },
  word: { ...type.body, fontSize: 13.5, color: colors.ink },
  mono: { fontFamily: fonts.body, fontSize: 13, color: colors.ink, fontVariant: ['tabular-nums'] },
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted, paddingHorizontal: 4, minWidth: 220 },
  searchInput: { fontFamily: fonts.body, fontSize: 13.5, color: colors.ink, paddingVertical: 6, flex: 1, backgroundColor: 'transparent' },
});
