import React from 'react';
import { Linking, Text, View } from 'react-native';
import { Press } from './press';
import { OwnedRecord } from '../api';
import { colors, spacing, type, BORDER } from '../theme';
import { Chip, Wrap } from './ui';
import { IconText } from './Icon';

/**
 * What Epic knows about a place on its own account — the part that is still
 * there with no signal.
 *
 * It exists because of what the household did: shortlisting, saving or saying
 * they went sends Epic to research the place from OpenStreetMap, the venue's own
 * published details and Wikipedia, all of which we may keep for good
 * (api/src/sources/own.js). Everything the drawer shows above this comes from a
 * provider, is fetched fresh every time, and disappears when the signal does.
 *
 * Each row says where it came from, because the household should be able to
 * tell "the restaurant publishes this" from "a mapper wrote it down in 2019".
 */

const SOURCE_WORDS: Record<string, string> = {
  osm: 'OpenStreetMap',
  site: 'their own website',
  wikipedia: 'Wikipedia',
  wikidata: 'Wikidata',
};

const prettyUrl = (u: string) => u.replace(/^https?:\/\//i, '').replace(/\/$/, '').slice(0, 52);

function Fact({ icon, from, children }: { icon: any; from?: string | null; children: React.ReactNode }) {
  return (
    <View style={{ gap: 1 }}>
      <IconText name={icon}>{children}</IconText>
      {from ? <Text style={type.tiny}>from {SOURCE_WORDS[from] ?? from}</Text> : null}
    </View>
  );
}

export function OwnedFacts({ record, offline = false, onResearch }: {
  record: OwnedRecord | null | undefined;
  /** True when this is all there is, because there is no signal. */
  offline?: boolean;
  onResearch?: () => void;
}) {
  if (!record) {
    return offline ? (
      <View style={{ gap: 2 }}>
        <IconText name="offline" color={colors.inkMuted}>No signal, and Epic has not researched this one yet.</IconText>
        <Text style={type.tiny}>Shortlisting a place, or saying you have been, is what sends Epic to research it. Do that once with signal and it is yours from then on.</Text>
      </View>
    ) : null;
  }

  const p = record.provenance ?? {};
  const anything = record.address || record.phone || record.openingHours || record.menuUrl || record.bookingUrl || record.summary || record.cuisines?.length;

  return (
    <View style={{ gap: spacing.sm, borderTopWidth: BORDER, borderTopColor: colors.line, paddingTop: spacing.md }}>
      <View style={{ gap: 1 }}>
        <Text style={[type.body, { fontWeight: '700' }]}>Ours to keep</Text>
        <Text style={type.tiny}>
          {offline
            ? 'You are offline, so this is what is on your phone. It stays here whatever happens to the signal.'
            : 'Researched by Epic when you kept this place. Open data and their own published details — it works with no signal and it never expires.'}
        </Text>
      </View>

      {record.summary ? (
        <View style={{ gap: 1 }}>
          <Text style={type.body}>{record.summary}</Text>
          <Text style={type.tiny}>{record.summarySource ?? ''}</Text>
        </View>
      ) : null}

      {record.address ? <Fact icon="address" from={p.address}>{record.address}{record.postcode && !record.address.includes(record.postcode) ? ` · ${record.postcode}` : ''}</Fact> : null}

      {record.phone ? (
        <Press onPress={() => Linking.openURL(`tel:${record.phone!.replace(/\s/g, '')}`)} accessibilityRole="link" accessibilityLabel={`Call ${record.phone}`}>
          <Fact icon="phone" from={p.phone}><Text style={{ color: colors.accent, fontWeight: '700' }}>{record.phone}</Text></Fact>
        </Press>
      ) : null}

      {record.openingHours ? <Fact icon="hours" from={p.opening_hours}>{record.openingHours}</Fact> : null}

      {record.menuUrl ? (
        <Press onPress={() => Linking.openURL(record.menuUrl!)} accessibilityRole="link" accessibilityLabel="Open the menu">
          <Fact icon="restaurant" from={p.menu_url}>Menu · <Text style={{ color: colors.accent, fontWeight: '700' }}>{prettyUrl(record.menuUrl)}</Text></Fact>
        </Press>
      ) : null}

      {record.bookingUrl ? (
        <Press onPress={() => Linking.openURL(record.bookingUrl!)} accessibilityRole="link" accessibilityLabel="Book a table">
          <Fact icon="booked" from={p.booking_url}>Book · <Text style={{ color: colors.accent, fontWeight: '700' }}>{prettyUrl(record.bookingUrl)}</Text></Fact>
        </Press>
      ) : null}

      {record.website ? (
        <Press onPress={() => Linking.openURL(record.website!)} accessibilityRole="link" accessibilityLabel="Open their website">
          <Fact icon="external" from={p.website}><Text style={{ color: colors.accent, fontWeight: '700' }}>{prettyUrl(record.website)}</Text></Fact>
        </Press>
      ) : null}

      {record.cuisines?.length || record.experiences?.length ? (
        <Wrap>
          {[...record.cuisines, ...record.experiences].map((c) => <Chip key={c} label={c} tone="neutral" />)}
        </Wrap>
      ) : null}

      {record.dietaryOptions?.length ? <Text style={type.small}>Diets noted: {record.dietaryOptions.join(', ')}</Text> : null}
      {record.priceRange ? <Text style={type.small}>Price band: {record.priceRange}</Text> : null}
      {record.accessibility?.wheelchair ? <Fact icon="info" from="osm">Wheelchair access: {record.accessibility.wheelchair}</Fact> : null}

      {!anything ? (
        <Text style={type.small}>
          {record.state === 'pending' ? 'Epic is researching this one now — come back in a minute.'
            : record.state === 'failed' ? `Epic could not find this one in the open sources. ${record.why ?? ''}`
            : 'Nothing found in the open sources for this one, so there is no offline copy of its details.'}
        </Text>
      ) : null}

      {record.attribution?.length ? <Text style={type.tiny}>{record.attribution.join(' · ')}</Text> : null}

      {onResearch && !offline ? (
        <Press onPress={onResearch} accessibilityRole="button">
          <Text style={[type.tiny, { color: colors.accent, fontWeight: '700' }]}>Look again</Text>
        </Press>
      ) : null}
    </View>
  );
}
