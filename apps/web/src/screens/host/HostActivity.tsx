/**
 * SX13a / SX13b · One activity (Settings revised v2). Opened from a date on
 * Upcoming or an activity on Stats, on the tab you came from. A head with the
 * thumbnail, state and price; then Upcoming | Past.
 *
 *   Upcoming (SX13a): this offer's summary cells and date rows.
 *   Past (SX13b): the all-time grid, the money block (fee lines from the engine),
 *                 and the past dates.
 */

import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '../../components/press';
import { colors, fonts, BORDER, LIME, INK } from '../../theme';
import { Icon } from '../../components/Icon';
import { CompactBand } from '../../components/Band';
import { InkMenu } from '../../components/InkMenu';
import { useViewport } from '../../hooks/useViewport';
import { useQueryState, asOneOf } from '../../router';
import { api, HostMoney, OwnOffer } from '../../api';
import { mediaUrl, priceWords, STATE_LABEL, SHAPE_ICON } from '../../components/hosting';
import { t, k, Tag } from '../../components/hostKit';
import { SummaryCells, Grid2, DateCol, FillBar, MoneyLine, FeeLine, gbp, todayIso, offerDateGroups, DateGroup } from './hostTabKit';

type Group = DateGroup;

export function HostActivity({ offer, money, onBack }: { offer: OwnOffer; money: HostMoney | null; onBack: () => void }) {
  const { width } = useViewport();
  const wide = width >= 900;
  const [tab, setTab] = useQueryState<'upcoming' | 'past'>('when', 'upcoming', asOneOf(['upcoming', 'past'] as const, 'upcoming'));
  const groups = offerDateGroups(offer);
  const today = todayIso();
  const upcoming = groups.filter((g) => !g.on || g.on >= today);
  const past = groups.filter((g) => g.on && g.on < today);
  const tag = offer.tags?.[0]?.label ?? null;

  return (
    <View style={k.page}>
      <CompactBand title={offer.title ?? 'Your offer'} onBack={onBack} />
      <ScrollView contentContainerStyle={[styles.body, wide && k.wide]}>
        {/* Head. */}
        <View style={styles.head}>
          <View style={styles.thumb}>
            {mediaUrl(offer.photos[0]) ? <Image source={{ uri: mediaUrl(offer.photos[0])! }} style={styles.thumbImg} resizeMode="cover" /> : <Icon name={SHAPE_ICON[offer.shape]} size={18} color={colors.inkMuted} />}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <Tag tone={offer.state === 'live' ? 'lime' : 'warm'}>{STATE_LABEL[offer.state].toUpperCase()}</Tag>
              {tag ? <Tag>{tag.toUpperCase()}</Tag> : null}
            </View>
            <Text style={[t.body, { fontWeight: '700' }]}>{priceWords(offer)}</Text>
          </View>
        </View>

        <InkMenu<'upcoming' | 'past'>
          tabs={[{ key: 'upcoming', label: 'Upcoming' }, { key: 'past', label: 'Past' }]}
          selected={tab}
          onSelect={(key) => setTab(key, { replace: true })}
        />

        {tab === 'upcoming' ? (
          <View style={{ paddingHorizontal: 20, paddingTop: 16, gap: 14 }}>
            <SummaryCells cells={[
              { n: String(upcoming.length), label: upcoming.length === 1 ? 'date' : 'dates' },
              { n: String(upcoming.reduce((n, g) => n + g.heads, 0)), label: 'booked' },
              { n: gbp(upcoming.reduce((n, g) => n + g.pence, 0)), label: money?.paymentsReady ? 'collected' : 'recorded' },
            ]} />
            {upcoming.length === 0 ? (
              <Text style={[t.sub, { lineHeight: 20 }]}>{offer.state === 'paused' ? 'No dates booked. This offer is paused.' : 'No dates booked yet.'}</Text>
            ) : upcoming.map((g, i) => <DateRow key={i} offer={offer} g={g} />)}
          </View>
        ) : (
          <PastTab offer={offer} money={money} past={past} />
        )}
      </ScrollView>
    </View>
  );
}

function DateRow({ offer, g }: { offer: OwnOffer; g: Group }) {
  const below = offer.minCount != null && g.heads < offer.minCount;
  return (
    <View style={styles.dateRow}>
      {g.on ? <DateCol iso={g.on} /> : <View style={{ width: 46 }}><Text style={t.small}>TBC</Text></View>}
      <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <Text style={[t.body, { fontWeight: '600', flex: 1 }]} numberOfLines={1}>{offer.title ?? 'Untitled'}</Text>
          <Text style={[t.body, { fontWeight: '800' }]}>{gbp(g.pence)}</Text>
        </View>
        <Text style={t.small}>{[offer.startsAt, priceWords(offer)].filter(Boolean).join(' · ')}</Text>
        <FillBar value={g.heads} max={offer.maxCount} min={offer.minCount} below={below} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text style={t.tiny}>{[`${g.bookings} booked`, offer.minCount ? `min ${offer.minCount}` : null, offer.maxCount ? `max ${offer.maxCount}` : null].filter(Boolean).join(' · ')}</Text>
          {below && offer.minCount ? <View style={styles.needs}><Text style={styles.needsText}>NEEDS {offer.minCount - g.heads} MORE</Text></View> : null}
        </View>
      </View>
    </View>
  );
}

function PastTab({ offer, money, past }: { offer: OwnOffer; money: HostMoney | null; past: Group[] }) {
  const period = money?.byOffer?.[offer.id] ?? null;
  const guests = past.reduce((n, g) => n + g.heads, 0);
  const collected = past.reduce((n, g) => n + g.pence, 0);
  const shown = past.slice(0, 3);
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 16, gap: 16 }}>
      <Grid2 cells={[
        { n: String(past.length), label: 'times hosted' },
        { n: String(guests), label: 'guests' },
        { n: offer.host?.rating != null ? offer.host.rating.toFixed(1) : '—', label: 'rating' },
        { n: '—', label: 'page views' },
      ]} />

      <View>
        <Text style={styles.sub}>Money</Text>
        <MoneyLine label={money?.paymentsReady ? 'Collected' : 'Recorded'} value={gbp(period ? period.grossPence : collected)} />
        {period && period.lines.length ? period.lines.map((l, i) => (
          <View key={i} style={{ paddingVertical: 2 }}><FeeLine line={l} /></View>
        )) : <View style={{ paddingVertical: 2 }}><FeeLine line={{ label: `Epic's fee ${money?.feeRate ?? ''}% · ${money?.levelLabel ?? ''}` }} /></View>}
        <MoneyLine label="Paid to you" value={gbp(period ? period.netPence : collected)} strong />
        {!money?.paymentsReady ? <Text style={[t.tiny, { marginTop: 4 }]}>{money?.note ?? 'Nothing has left anybody’s account yet.'}</Text> : null}
      </View>

      {past.length ? (
        <View>
          <Text style={styles.sub}>Past dates</Text>
          <View style={styles.pastHead}>
            <Text style={[styles.pastH, { flex: 1 }]}>Date</Text>
            <Text style={[styles.pastH, { flex: 1, textAlign: 'center' }]}>Guests</Text>
            <Text style={[styles.pastH, { flex: 1, textAlign: 'right' }]}>Collected</Text>
          </View>
          {shown.map((g, i) => (
            <View key={i} style={styles.pastRow}>
              <Text style={[styles.pastCell, { flex: 1 }]}>{g.on ? new Date(`${g.on}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'TBC'}</Text>
              <Text style={[styles.pastCell, { flex: 1, textAlign: 'center' }]}>{g.heads}</Text>
              <Text style={[styles.pastCell, { flex: 1, textAlign: 'right' }]}>{gbp(g.pence)}</Text>
            </View>
          ))}
          {past.length > 3 ? <Text style={[t.link, { marginTop: 8 }]}>See all {past.length} dates ›</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: 48 },
  head: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 16 },
  thumb: { width: 70, height: 54, borderRadius: 8, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 },
  thumbImg: { width: 70, height: 54, borderRadius: 8 },
  dateRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.ruleSoft },
  needs: { backgroundColor: colors.surfaceMuted, paddingHorizontal: 7, paddingVertical: 2 },
  needsText: { fontFamily: fonts.body, fontSize: 10, fontWeight: '800', letterSpacing: 0.4, color: colors.accent },
  sub: { fontFamily: fonts.heading, fontSize: 15, fontWeight: '800', letterSpacing: -0.3, color: colors.ink, marginBottom: 6 },
  pastHead: { flexDirection: 'row', gap: 8, paddingBottom: 6, borderBottomWidth: BORDER, borderBottomColor: colors.line },
  pastH: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colors.inkMuted },
  pastRow: { flexDirection: 'row', gap: 8, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  pastCell: { fontFamily: fonts.body, fontSize: 13.5, color: colors.ink },
});
