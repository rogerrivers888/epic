/**
 * Demand — what people asked for, and what we failed to give them.
 *
 * **Three numbers, never one conversion rate.** A single rate hides which of the
 * three faults it was, and the three have different owners:
 *
 *   · **shown nothing** → we hold no places here. Collect fixes it.
 *   · **clicked nothing** → we showed the wrong ones. The category rules fix it.
 *   · **clicked, never tripped** → the record is too thin to convince. The data
 *     score on that place fixes it.
 *
 * A search that returned nothing is logged as loudly as one that returned forty,
 * and none of it can be backfilled — every day it was not written is gone.
 *
 * (The name is the one thing the design would change: *Asked for* is the
 * alternative, and both are on the board so the owner can see them together.)
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Press } from '../../components/press';
import { Icon } from '../../components/Icon';
import { colors, spacing, type, BORDER } from '../../theme';
import { asNumber, asText, useQueryState, useRouter } from '../../router';
import { api, type DemandReport, type DemandRow, type SearchReplay } from '../../api';
import { AdminPage, ago, duration, plural, pounds, since as howLongAgo } from '../kit';
import { Explain, type Tip, type TipKey } from '../explain';
import { Ladder, Num, Word, Blank, Bar, Act, Footer, Kicker, Stat, type Col } from '../table';

export function Demand({ canManage }: { canManage: boolean }) {
  const [where, setWhere] = useQueryState<string>('where', '', asText);
  // `30d`, as the board spells it (BO4a: `?where=berkshire&since=30d`). A bare
  // number is still read, so an older link still opens.
  const [since, setSince] = useQueryState<number | null>('since', 30, {
    read: (raw) => { const n = Number(String(raw).replace(/d$/, '')); return Number.isFinite(n) && n > 0 ? n : 30; },
    write: (v) => (v == null || v === 30 ? null : `${v}d`),
  });
  const [search, setSearch] = useQueryState<string>('search', '', asText);

  if (search) return <Replay id={search} onClose={() => setSearch('')} canManage={canManage} />;
  return <Report where={where} since={since ?? 30} onSince={setSince} onWhere={setWhere} onSearch={setSearch} />;
}

// ---------------------------------------------------------------------------
// BO4a — three numbers
// ---------------------------------------------------------------------------

const WINDOWS = [7, 30, 90];

function Report({ where, since, onSince, onWhere, onSearch }: {
  where: string; since: number; onSince: (n: number) => void; onWhere: (s: string) => void; onSearch: (id: string) => void;
}) {
  const [data, setData] = useState<DemandReport | null>(null);
  const { navigate } = useRouter();
  useEffect(() => { setData(null); api.adminDemand({ where: where || undefined, since }).then(setData).catch(() => setData(null)); }, [where, since]);
  if (!data) return <AdminPage><Waiting /></AdminPage>;

  const share = (n: number, of: number) => (of > 0 ? n / of : 0);
  const columns: Col<DemandRow>[] = [
    { key: 'label', label: 'Asked for', tip: 'askedFor', grow: true,
      cell: (r) => (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <Text style={[styles.rowName, r.fault === 'empty-always' && styles.strong]}>{r.label}</Text>
          {r.noSubject ? <Text style={styles.rowNote}>no subject given</Text> : null}
        </View>
      ) },
    { key: 'searches', label: 'Searches', tip: 'searches', width: 110, align: 'right', cell: (r) => <Num n={r.searches || null} /> },
    { key: 'bar', label: 'Came back empty · clicked nothing · never tripped', tip: 'theThreeFaultsAsABar', width: 290, align: 'left',
      cell: (r) => (
        <Bar parts={[
          { key: 'empty', share: share(r.empty, r.searches), alpha: 1 },
          { key: 'noClick', share: share(r.noClick, r.searches), alpha: 0.52 },
          { key: 'noTrip', share: share(r.noTrip, r.searches), alpha: 0.22 },
        ]} />
      ) },
    { key: 'fault', label: 'Which fault', tip: 'whichFault', width: 180, align: 'left',
      cell: (r) => <Text style={[styles.fault, (r.fault === 'wrong-places' || r.fault === 'thin-places' || r.fault === 'empty-always') && styles.strong]}>{r.faultLabel}</Text>,
      cellTip: (r) => (r.fault === 'wrong-places' ? 'noClickShort' : r.fault === 'thin-places' ? 'neverTripped' : r.fault === 'no-places' || r.fault === 'empty-always' ? 'emptyTotal' : 'whichFault') },
    { key: 'owner', label: 'Who fixes it', tip: 'whoFixesIt', width: 180, align: 'left', stops: true,
      cell: (r) => (r.act === 'collect' && r.fault === 'empty-always'
        ? <Act label="Collect" small onPress={() => navigate(`/admin/places?where=${encodeURIComponent(where || 'gb')}&lens=collect`)} />
        : r.owner ? <Text style={[styles.owner, r.fault === 'wrong-places' || r.fault === 'thin-places' ? { color: colors.accent, fontWeight: '700' } : null]}>{r.owner}</Text>
        : <Blank />) },
  ];

  return (
    <AdminPage>
      <View style={styles.band}>
        <View style={{ flexGrow: 1, flexBasis: 280, minWidth: 0, gap: 5 }}>
          <Kicker tip="sectionOver">{`${data.area ? data.area.name : 'Everywhere'} · last ${plural(since, 'day')}`}</Kicker>
          <Text style={styles.title}>{`${data.totals.searches.toLocaleString()} searches`}</Text>
          {/* The second title: the name this screen would have if the owner
              prefers a thing you do to a report. Both are shown so he can see
              them together (BO7a). */}
          {/* The second name, and a hover that says it is a second name — the
              design offers it as the alternative and nobody has picked (17 Sep
              2026). */}
          <Explain tip="askedForName" cursor="help"><Text style={styles.alt}>Asked for</Text></Explain>
          {/* Whose figures these are, when they are not this town's. */}
          {data.figuresFrom ? (
            <Explain tip={['Figures from ' + data.figuresFrom.name, `We hold no cell for anywhere in ${data.area?.name ?? 'this town'} yet, and ${data.figuresFrom.why} — so these are ${data.figuresFrom.name}'s figures, not this town's.`]} cursor="help">
              <Text style={styles.alt}>{`Figures from ${data.figuresFrom.name}`}</Text>
            </Explain>
          ) : null}
        </View>
        <View style={styles.five}>
          <Stat label="Came back empty" value={data.totals.empty.toLocaleString()} tip="emptyTotal" big mark />
          <Stat label="Clicked nothing" value={data.totals.noClick.toLocaleString()} tip="noClick" big mark />
          <Stat label="Never tripped" value={data.totals.noTrip.toLocaleString()} tip="neverTripped" big mark />
        </View>
      </View>

      <View style={styles.subRow}>
        <Kicker tip="sectionOver">Over</Kicker>
        <View style={styles.segment}>
          {WINDOWS.map((w) => (
            <Press key={w} effect="none" onPress={() => onSince(w)} accessibilityRole="button"
                   accessibilityState={{ selected: since === w }} accessibilityLabel={`${w} days`}
                   style={[styles.segItem, since === w && styles.segItemOn]}>
              <Text style={[styles.segWord, since === w && styles.segWordOn]}>{`${w} days`}</Text>
            </Press>
          ))}
        </View>
        {where ? (
          <Press effect="none" onPress={() => onWhere('')} accessibilityRole="button" accessibilityLabel="Everywhere"
                 style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Text style={styles.chipOff}>{data.area?.name ?? where}</Text>
            <Icon name="close" size={12} strokeWidth={2.4} color={colors.accent} />
          </Press>
        ) : null}
      </View>

      <Ladder columns={columns} rows={data.rows} keyOf={(r) => r.subject ?? 'anything'}
              highlight={(r) => r.fault === 'empty-always'}
              empty={
                <Explain tip={['Nothing yet', 'The search log is written from the day it was built and none of it can be backfilled, so a new area reads empty until somebody searches it.']}>
                  <Word muted>Nothing searched for here yet</Word>
                </Explain>
              } />

      <View style={{ gap: 9 }}>
        <Kicker tip="sectionRecentSearches">Searches · most recent first</Kicker>
        <View>
          {data.log.map((s, i) => (
            <View key={s.id} style={[styles.logRow, i === data.log.length - 1 && { borderBottomWidth: 0 }]}>
              <Text style={[styles.rowNote, { width: 130 }]}>{howLongAgo(s.at)}</Text>
              <Text style={[styles.logWhat, { flex: 1 }]} numberOfLines={1}>
                {[s.label, s.where, s.minutes ? `within ${s.minutes} min` : null, askedWords(s.asked)].filter(Boolean).join(' · ')}
              </Text>
              <Text style={[styles.logOutcome, { width: 150 }]}>
                {s.empty ? 'came back empty' : `${s.shown} shown, ${s.tripped ? `${s.tripped} tripped` : `${s.opened} clicked`}`}
              </Text>
              <Explain tip={['Held against', s.identified ? 'This search is held against an account, so the same person’s searches can be read together.' : 'Nobody was signed in, so this search is held against the household only.']}
                       style={{ width: 140 }}>
                <Text style={[styles.rowNote, { textAlign: 'right' }]}>{s.identified ? 'signed in' : 'not signed in'}</Text>
              </Explain>
              <View style={{ width: 140, alignItems: 'flex-end' }}>
                <Act label={`Replay · ${pounds(data.replayPence)}`} small tone={s.empty ? 'secondary' : 'primary'} onPress={() => onSearch(s.id)} />
              </View>
            </View>
          ))}
          {data.log.length === 0 ? <Word muted>Nothing logged in this window.</Word> : null}
        </View>
      </View>
    </AdminPage>
  );
}

// ---------------------------------------------------------------------------
// BO4b — one search, replayed
// ---------------------------------------------------------------------------

/**
 * Exactly what that household was shown, in order, with what they did to each
 * row. The stored rows are identifiers; names are re-resolved at display, and a
 * `google:` ref we hold no name for costs a call — so this is a deliberate
 * action with its cost on the button, never something a list does on load.
 */
function Replay({ id, onClose, canManage }: { id: string; onClose: () => void; canManage: boolean }) {
  const [data, setData] = useState<SearchReplay | null>(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => { setData(null); api.adminDemandSearch(id).then(setData).catch(() => setData(null)); }, [id]);
  if (!data) return <AdminPage><Waiting /></AdminPage>;
  // Asking for the names we hold none of is a paid call each, so it is a button
  // with the price on it and never something the drawer does on open. The
  // count used to be printed as though it had happened (Codex, 17 Sep 2026).
  const askNames = () => {
    setAsking(true);
    api.adminDemandSearch(id, true).then(setData).catch(() => null).finally(() => setAsking(false));
  };

  const columns: Col<SearchReplay['rows'][number]>[] = [
    { key: 'no', label: 'No.', tip: 'position', width: 42, align: 'left',
      cell: (r) => <Text style={[styles.pos, r.strong && styles.strong]}>{r.position}</Text> },
    { key: 'name', label: 'What they were shown', tip: 'whatTheyWereShown', grow: true,
      cell: (r) => <Text style={[styles.rowName, r.strong && styles.strong, !r.name && styles.refName]} numberOfLines={1}>{r.name ?? r.ref}</Text> },
    { key: 'sub', label: 'Subcategory', tip: 'subcategory', width: 190, align: 'left',
      cell: (r) => (r.subcategory ? <Word>{r.subcategory}</Word> : <Blank />) },
    { key: 'score', label: 'Its score', tip: 'itsScore', width: 120, align: 'right',
      cell: (r) => <Num n={r.score} />,
      // The board's column is "that place's data score **at the time they were
      // shown it**"; where the log did not keep it, the row says so.
      cellTip: (r) => (r.scoreThen
        ? 'itsScore'
        : ['Its score · now', 'The log did not keep this place\'s score at the time, so this is what it scores today.'] as const) },
    { key: 'did', label: 'What they did', tip: 'whatTheyDid', width: 160, align: 'left',
      cell: (r) => <Text style={[styles.did, r.strong && styles.strong, !r.strong && { color: colors.inkMuted }]}>{r.did}</Text>,
      // "Not opened" is a fourth state and it means we cannot tell: they touched
      // nothing at all, so there is no evidence of how far down the list they got.
      cellTip: (r) => (r.did === 'Not opened'
        ? ['Not opened', 'They tapped nothing at all on this search, so there is no evidence of how far down the list they read. Scrolled past and Never reached can only be told apart by something they touched.'] as const
        : 'whatTheyDid') },
    { key: 'dwell', label: 'Dwell', tip: 'dwell', width: 130, align: 'right',
      cell: (r) => (r.dwellMs ? <Word>{duration(Math.round(r.dwellMs / 1000))}</Word> : <Blank />) },
  ];

  const when = new Date(data.at);
  return (
    <AdminPage>
      <View style={styles.trail}>
        <Press effect="none" onPress={onClose} accessibilityRole="button" accessibilityLabel="Back to Demand" style={styles.trailBack}>
          <Icon name="back" size={15} strokeWidth={2.2} color={colors.accent} />
          {/* Where you came from and how much of it there is, as BO4b spells
              it: "← Berkshire · 4,412 searches" (17 Sep 2026, the verification
              audit — it read "← Demand" wherever you had come from). */}
          <Text style={styles.trailWord}>{data.where ?? 'Demand'}</Text>
        </Press>
        <Text style={styles.trailNote}>{data.searchesHere == null ? '' : `· ${data.searchesHere.toLocaleString()} searches`}</Text>
      </View>
      <View style={styles.band}>
        <View style={{ flexGrow: 1, flexBasis: 280, minWidth: 0, gap: 5 }}>
          {/* Who was going, as counts — never a name, and never anything a
              provider owns. */}
          <Kicker tip="sectionLevel">{[
            when.toLocaleDateString([], { day: 'numeric', month: 'short' }),
            when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            data.surface,
            data.identified ? 'signed in' : 'not signed in',
            askedWords(data.asked),
          ].filter(Boolean).join(' · ')}</Kicker>
          {/* The day, too. BO4b's title is "Anything, Windsor, Saturday" and
              the day was never drawn — which is the part that makes a replay
              recognisable (17 Sep 2026, the verification audit). */}
          <Text style={styles.title}>{[
            data.subjectLabel ?? 'Anything',
            data.where,
            when.toLocaleDateString([], { weekday: 'long' }),
            data.minutes ? `within ${data.minutes} min` : null,
          ].filter(Boolean).join(', ')}</Text>
        </View>
        <View style={styles.five}>
          <Stat label="Shown" value={data.shown} tip="shown" />
          <Stat label="Opened" value={data.opened} tip="opened" />
          <Stat label="Saved" value={data.saved} tip="saved" />
          <Stat label="Tripped" value={data.tripped ? 'Yes' : 'No'} tip="tripped" />
        </View>
      </View>

      <Ladder columns={columns} rows={data.rows} keyOf={(r) => `${r.position}-${r.ref}`}
              highlight={(r) => r.strong}
              empty={<Word muted>Nothing was shown for this search — which is the finding.</Word>} />

      <View style={styles.facts}>
        <Fact tip="sourcesAsked" label="Sources asked" value={data.sourcesQueried.length ? data.sourcesQueried.join(', ') : '—'} />
        <Fact tip="anyDegraded" label="Any degraded" value={data.degraded.length ? data.degraded.join(', ') : 'no'} />
        <Fact tip="namesRefetched" label="Names re-fetched for this replay" value={data.refetched ? `${data.refetched} · ${pounds(Math.round(data.refetchedPence))}` : 'none'} />
        {/* A row we hold no name for stays an identifier, and the reason it
            does is said out loud rather than read as a bill (Codex, 17 Sep
            2026: the count used to price names nothing had fetched). */}
        {data.nameless ? <Fact tip="stillAnIdentifier" label="Still an identifier" value={`${data.nameless}${data.namelessWhy ? ` · ${data.namelessWhy}` : ''}`} /> : null}
        <Fact tip="heldAgainst" label="Held against" value={data.heldAgainst} />
      </View>
      {data.nameless && data.namelessWhy === 'not asked' ? (
        <Footer left={<Word muted>{`${data.nameless} of these are identifiers we hold no name for. Asking Google costs a call each.`}</Word>}>
          <Act label={asking ? 'Asking…' : `Ask for the ${data.nameless} missing names · ${pounds(Math.round(data.namelessPence))}`}
               icon="search" disabled={!canManage || asking} onPress={askNames} />
        </Footer>
      ) : null}
    </AdminPage>
  );
}

/**
 * What was asked for beside the subject — counts and our own words only.
 *
 * The board's rows read "Soft play · within 30 min of RG1 · **under 5s**", and
 * that last part is what makes a row legible. Never free text somebody typed,
 * and never a provider's label.
 */
function askedWords(asked: Record<string, unknown> | null | undefined): string | null {
  if (!asked) return null;
  const out: string[] = [];
  const party = Number(asked.party ?? 0);
  if (party) out.push(`${party} ${party === 1 ? 'person' : 'people'}`);
  if (Array.isArray(asked.moods) && asked.moods.length) out.push(asked.moods.join(', '));
  if (asked.budget && asked.budget !== 'any') out.push(String(asked.budget));
  if (asked.typed) out.push('they typed something');
  if (asked.events) out.push('with events');
  return out.length ? out.join(' · ') : null;
}

/**
 * One fact under a replay — and it explains itself, like every other figure on
 * these screens. The design's own markup leaves these four bare, and the law
 * above it says every stat label hovers (18 Sep 2026, the separate audit).
 */
const Fact = ({ label, value, tip }: { label: string; value: string; tip?: TipKey | Tip }) => (
  <Explain tip={tip ?? null} style={{ gap: 2 }}>
    <Text style={styles.factLabel}>{label}</Text>
    <Text style={styles.factValue}>{value}</Text>
  </Explain>
);

const Waiting = () => <View style={{ paddingVertical: spacing.xl }}><ActivityIndicator color={colors.accent} /></View>;

const styles = StyleSheet.create({
  band: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    gap: spacing.xl, flexWrap: 'wrap',
    borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted, paddingBottom: 17,
  },
  title: { ...type.title, fontSize: 31, letterSpacing: -1.08, lineHeight: 33 },
  alt: { ...type.tiny, fontSize: 11, fontWeight: '700', letterSpacing: 0.44, textTransform: 'uppercase', color: colors.accent },
  five: { flexDirection: 'row', alignItems: 'flex-end', gap: 30, flexWrap: 'wrap' },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, flexWrap: 'wrap' },

  trail: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  trailBack: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  trailNote: { ...type.small, color: colors.inkMuted },
  trailWord: { ...type.small, fontSize: 13, fontWeight: '700', color: colors.accent },

  segment: { flexDirection: 'row', borderWidth: 1, borderColor: colors.ruleMuted },
  segItem: { paddingHorizontal: 14, paddingVertical: 8 },
  segItemOn: { backgroundColor: colors.selected },
  segWord: { ...type.small, fontSize: 12.5, fontWeight: '600', color: colors.inkMuted },
  segWordOn: { fontWeight: '700', color: colors.selectedFg },
  chipOff: { ...type.tiny, fontSize: 11.5, fontWeight: '700', color: colors.accent },

  rowName: { ...type.body, fontSize: 13.5, fontWeight: '600', color: colors.ink },
  rowNote: { ...type.tiny, fontSize: 12, color: colors.inkMuted },
  refName: { fontWeight: '400', color: colors.inkMuted },
  strong: { fontWeight: '700' },
  fault: { ...type.small, fontSize: 13, color: colors.ink },
  owner: { ...type.small, fontSize: 13, color: colors.inkMuted },
  pos: { ...type.body, fontSize: 14, color: colors.inkMuted },
  did: { ...type.small, fontSize: 13, color: colors.ink },

  logRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  logWhat: { ...type.small, fontSize: 13, color: colors.ink },
  logOutcome: { ...type.small, fontSize: 13, color: colors.ink },

  facts: { flexDirection: 'row', gap: 34, flexWrap: 'wrap', borderTopWidth: BORDER, borderTopColor: colors.ruleMuted, paddingTop: 14 },
  factLabel: { ...type.tiny, fontSize: 12, color: colors.inkMuted },
  factValue: { ...type.small, fontSize: 13, fontWeight: '600', color: colors.ink },
});
