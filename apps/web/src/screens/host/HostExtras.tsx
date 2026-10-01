/**
 * SX11 · Your skills and SX10 · Qualifications and evidence (Settings revised
 * v2). Skills stay on each offer (Host Skills S13), so SX11 lists every offer
 * and its tags, with "Edit tags" opening that offer's tag step. Evidence is
 * kept on the person and reused by every offer (C13), so SX10 lists it once;
 * adding or changing it reuses the offer wizard's evidence step rather than
 * duplicating that drawer here.
 */

import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '../../components/press';
import { colors, fonts, BORDER, LIME, INK } from '../../theme';
import { Icon } from '../../components/Icon';
import { CompactBand } from '../../components/Band';
import { showToast } from '../../components/Toast';
import { useViewport } from '../../hooks/useViewport';
import { useRouter } from '../../router';
import { paths } from '../../routes';
import { Evidence, HostHome, OwnOffer } from '../../api';
import { mediaUrl, SHAPE_ICON, STATE_LABEL } from '../../components/hosting';
import { t, k, Tag } from '../../components/hostKit';
import { Kicker } from './hostTabKit';

// --- SX11 · Your skills -----------------------------------------------------

export function HostSkills({ home, onBack }: { home: HostHome; onBack: () => void }) {
  const { width } = useViewport();
  const wide = width >= 900;
  const { navigate } = useRouter();
  const offers = home.offers;
  return (
    <View style={k.page}>
      <CompactBand title="Your skills" onBack={onBack} />
      <ScrollView contentContainerStyle={[styles.body, wide && k.wide]}>
        <Text style={[t.sub, { lineHeight: 20, marginBottom: 6 }]}>Each offer carries its own tags — the same host is not one category. Guests see the first tag on the card.</Text>
        {offers.map((o) => (
          <View key={o.id} style={[styles.offer, o.state === 'paused' && { opacity: 0.72 }]}>
            <View style={styles.thumb}>
              {mediaUrl(o.photos[0]) ? <Image source={{ uri: mediaUrl(o.photos[0])! }} style={styles.thumbImg} resizeMode="cover" /> : <Icon name={SHAPE_ICON[o.shape]} size={16} color={colors.inkMuted} />}
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
              <Text style={[t.body, { fontWeight: '600' }]} numberOfLines={1}>{o.title ?? 'Untitled'}</Text>
              <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
                {o.tags.map((tg, i) => <Tag key={`t${i}`} tone={i === 0 ? 'lime' : 'warm'}>{tg.label.toUpperCase()}</Tag>)}
                {o.facets.map((f, i) => <Tag key={`f${i}`} tone="plain">{f.label.toUpperCase()}</Tag>)}
                {!o.tags.length && !o.facets.length ? <Text style={t.small}>No tags yet</Text> : null}
              </View>
              <Press onPress={() => navigate(paths.hostOfferEdit(o.id, 'skills'))} accessibilityRole="button"><Text style={t.link}>Edit tags ›</Text></Press>
            </View>
          </View>
        ))}
        <Press onPress={() => navigate(paths.hostNewOffer())} accessibilityRole="button" style={styles.dashed}>
          <Icon name="add" size={18} color={colors.inkFaint} strokeWidth={2} />
          <Text style={[t.body, { color: colors.inkFaint }]}>Add an offer</Text>
        </Press>
      </ScrollView>
    </View>
  );
}

// --- SX10 · Qualifications and evidence --------------------------------------

const KIND_KICKER: Record<string, string> = { pub: 'Published work', qual: 'Qualification', years: 'Years of doing it', lic: 'Guiding badge' };
const evidenceTitle = (e: Evidence): string => {
  const f = e.fields ?? {};
  if (e.kind === 'pub') return [f.title, f.where].filter(Boolean).join(' · ') || 'Published work';
  if (e.kind === 'qual') return [f.what, f.awardedBy].filter(Boolean).join(' · ') || 'A qualification';
  if (e.kind === 'years') return [f.howLong && `${f.howLong}`, f.where].filter(Boolean).join(' · ') || 'Years of doing it';
  return [f.issuer, f.number].filter(Boolean).join(' · ') || 'A licence or badge';
};
const evidenceFoot = (e: Evidence): string | null => {
  const f = e.fields ?? {};
  const bits = [f.awardedBy || f.issuer, f.number, f.year || f.expires].filter(Boolean) as string[];
  return bits.length ? bits.join(' · ') : null;
};

export function HostEvidence({ home, onBack }: { home: HostHome; onBack: () => void }) {
  const { width } = useViewport();
  const wide = width >= 900;
  const { navigate } = useRouter();
  const evidence = home.host?.evidence ?? [];
  const offerTitle = (offerId: string | null) => (offerId ? home.offers.find((o) => o.id === offerId)?.title ?? null : null);
  const addVia = home.offers[0];
  return (
    <View style={k.page}>
      <CompactBand title="Qualifications and evidence" onBack={onBack} />
      <ScrollView contentContainerStyle={[styles.body, wide && k.wide]}>
        <Text style={[t.sub, { lineHeight: 20, marginBottom: 6 }]}>Given once, reused by every offer. Nothing here is shown to guests — Epic reads it to set your level.</Text>
        {evidence.map((e) => {
          const on = offerTitle(e.offerId);
          const foot = evidenceFoot(e);
          return (
            <View key={e.id} style={styles.evid}>
              <Kicker>{(KIND_KICKER[e.kind] ?? 'Evidence').toUpperCase()}</Kicker>
              <Text style={[t.body, { fontWeight: '700', marginTop: 2 }]}>{evidenceTitle(e)}</Text>
              {foot ? <Text style={t.small}>{foot}</Text> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <Icon name="check" size={13} color={colors.accent} strokeWidth={3} />
                <Text style={[t.small, { color: colors.accent, fontWeight: '700' }]}>{e.media ? 'Uploaded · with Epic to check' : 'Stated'}</Text>
              </View>
              {on ? <Text style={[t.tiny, { marginTop: 2 }]}>On {on}</Text> : null}
            </View>
          );
        })}
        {!evidence.length ? <Text style={[t.small, { lineHeight: 18 }]}>Nothing added yet.</Text> : null}
        <Press
          onPress={() => addVia ? navigate(paths.hostOfferEdit(addVia.id, 'checks')) : showToast('Add evidence when you set up an offer')}
          accessibilityRole="button" style={styles.dashed}
        >
          <Icon name="add" size={18} color={colors.inkFaint} strokeWidth={2} />
          <View style={{ flex: 1 }}>
            <Text style={[t.body, { color: colors.inkFaint }]}>Add evidence</Text>
            <Text style={t.tiny}>Published work · a qualification · years of doing it · a guiding badge</Text>
          </View>
        </Press>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 48, gap: 10 },
  offer: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 },
  thumbImg: { width: 56, height: 56, borderRadius: 8 },
  evid: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  dashed: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.ghost, marginTop: 8 },
});
