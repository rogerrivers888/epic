/**
 * SX14 · Your level — the existing trust ladder (Verified / Checked / Epic
 * Trusted), with Epic's fee following the level (Settings revised v2, owner
 * 1 Oct 2026). Every rate here is the fee engine's: 20 / 15 / 10% by level, 0%
 * intro, 5% on the host's own links, a £1.50 minimum never on intro. The
 * guarantee pool is funded from the fee and is never a line of its own.
 *
 * The thresholds in "To reach Epic Trusted" are placeholders the business sets.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, BORDER, LIME, INK, CREAM } from '../../theme';
import { Icon, IconName } from '../../components/Icon';
import { CompactBand } from '../../components/Band';
import { useViewport } from '../../hooks/useViewport';
import { t, k } from '../../components/hostKit';
import { Kicker } from './hostTabKit';
import type { HostMoney, OwnHost, TrustLevel } from '../../api';

const SHIELD: Record<TrustLevel, IconName> = { verified: 'verified', checked: 'checked', trusted: 'trusted' };

export function HostLevel({ money, host, onBack }: { money: HostMoney; host: OwnHost; onBack: () => void }) {
  const { width } = useViewport();
  const wide = width >= 900;
  const here = money.ladder.find((l) => l.here);
  const trustedKeep = money.ladder.find((l) => l.level === 'trusted')?.keep ?? 90;
  const left = Math.max(0, money.trusted.completedNeeded - money.trusted.completed);
  const ratingOk = host.rating != null && host.rating >= money.trusted.ratingAtLeast;
  return (
    <View style={k.page}>
      <CompactBand title="Your level" onBack={onBack} />
      <ScrollView contentContainerStyle={[styles.body, wide && k.wide]}>
        <Text style={[t.sub, { lineHeight: 20 }]}>Epic's fee follows your level. The guarantee pool is funded from it — never a separate charge. Guests see your level on your profile and on every card.</Text>

        {money.ladder.map((l) => {
          const ink = l.level === 'trusted';
          return (
            <View key={l.level} style={[styles.card, l.here && styles.cardHere]}>
              <View style={[styles.tile, l.level === 'checked' ? styles.tileLime : ink ? styles.tileInk : styles.tileWarm]}>
                <Icon name={SHIELD[l.level]} size={20} color={l.level === "trusted" ? LIME : l.level === "checked" ? INK : colors.ink} strokeWidth={2.2} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={t.h18}>{l.label}</Text>
                  {l.here ? <View style={styles.hereChip}><Text style={styles.hereText}>YOU ARE HERE</Text></View> : null}
                </View>
                <Text style={[t.small, { marginTop: 2 }]}>Epic's fee {l.feeRate}% · you keep {l.keep}%</Text>
              </View>
            </View>
          );
        })}
        <Text style={[t.small, { lineHeight: 18, marginTop: 2 }]}>At Epic Trusted you keep {trustedKeep}% of every booking, up from {here?.keep ?? 85}% now.</Text>

        {/* On top of the level rate. */}
        <View style={styles.rule} />
        <Kicker>On top of your level</Kicker>
        <OnTop on={money.intro.active} title="0% intro"
          line={money.intro.active ? `Your first 90 days or first 10 bookings — ${money.intro.bookingsLeft} ${money.intro.bookingsLeft === 1 ? 'booking' : 'bookings'} left.` : 'Your first 90 days or first 10 bookings, whichever ends first. Over now.'} />
        <OnTop on title={`${money.linkRate}% on your own links`} line="Bookings that come through a link you shared yourself, at any level." />
        <OnTop on title={`${gbpWhole(money.minFeePence)} minimum fee per booking`} line="Never applied to a 0% intro booking." />

        {/* The checklist to Epic Trusted. */}
        <View style={styles.rule} />
        <Kicker>To reach Epic Trusted</Kicker>
        <Check on={money.trusted.completed >= money.trusted.completedNeeded}
          label={`${money.trusted.completedNeeded} completed experiences`} note={left ? `${money.trusted.completed} so far` : 'done'} />
        <Check on={ratingOk} label={`Rated ${money.trusted.ratingAtLeast} or above over your last ${money.trusted.ratingWindow}`} note={host.rating != null ? host.rating.toFixed(1) : 'no reviews yet'} />
        <Check on label="No unresolved reports" />
        <Text style={[t.tiny, { marginTop: 10 }]}>The thresholds are being set by the business and may change.</Text>
      </ScrollView>
    </View>
  );
}

const gbpWhole = (p: number) => `£${(p / 100).toLocaleString('en-GB', { minimumFractionDigits: p % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;

function OnTop({ on, title, line }: { on: boolean; title: string; line: string }) {
  return (
    <View style={styles.onTop}>
      <View style={[styles.dot, on && styles.dotOn]}>{on ? <Icon name="check" size={11} color={INK} strokeWidth={3} /> : null}</View>
      <View style={{ flex: 1 }}>
        <Text style={[t.body, { fontWeight: '700', lineHeight: 18 }]}>{title}</Text>
        <Text style={[t.small, { lineHeight: 17 }]}>{line}</Text>
      </View>
    </View>
  );
}

function Check({ on, label, note }: { on: boolean; label: string; note?: string }) {
  return (
    <View style={styles.onTop}>
      <View style={[styles.dot, on && styles.dotOn]}>{on ? <Icon name="check" size={11} color={INK} strokeWidth={3} /> : null}</View>
      <Text style={[t.body, { flex: 1, lineHeight: 18 }]}>{label}</Text>
      {note ? <Text style={[t.small, on && { color: colors.accent, fontWeight: '700' }]}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 48, gap: 10 },
  card: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 13, borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface },
  cardHere: { padding: 12, borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surfaceMuted },
  tile: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  tileWarm: { backgroundColor: colors.warm },
  tileLime: { backgroundColor: LIME },
  tileInk: { backgroundColor: INK },
  hereChip: { backgroundColor: LIME, paddingHorizontal: 7, paddingVertical: 2 },
  hereText: { fontFamily: fonts.body, fontSize: 10, fontWeight: '800', letterSpacing: 0.5, color: colors.ink },
  rule: { height: 1, backgroundColor: colors.ruleSoft, marginTop: 14, marginBottom: 4 },
  onTop: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 7 },
  dot: { width: 20, height: 20, borderWidth: BORDER, borderColor: colors.ruleSoft, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  dotOn: { backgroundColor: LIME, borderColor: LIME },
});
