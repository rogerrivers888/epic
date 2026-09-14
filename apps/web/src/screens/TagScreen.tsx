/**
 * A tag's own page (Host Skills handoff, S14 and S15, 13 September 2026).
 *
 * Every tag gets one: the breadcrumb, the name, a line of plain English, the
 * count, and everybody on Epic listed for it. This is where the depth pays off
 * and, incidentally, where the search traffic arrives — "fossil hunting
 * Jurassic Coast" is a query people actually make, and the long tail of a
 * marketplace is built out of exactly these pages. It works logged-out for the
 * same reason an experience page does.
 *
 * **S15 is the sparse state, and it is designed on purpose.** One host becomes
 * a lime block — "the only person on Epic listed for it" — then the host, then
 * a line asking who else they know, then four neighbouring tags. No "no
 * results", no apology, no empty star row: *a rare tag is a reason to book.*
 *
 * The canvas says "in Britain", and this says "on Epic", because that is what
 * is counted: the answer is not narrowed by country and claiming otherwise
 * would be a sentence the query does not support (Codex, 13 Sep 2026). The
 * "Going to Dorset" row the canvas puts above the hosts is not built — the API
 * takes a country and the screen has nowhere yet to choose one.
 *
 * The hierarchy is not navigation here either. The breadcrumb gives the tag
 * context in one glance and is not a link; `Close to it` at the foot is the
 * only way sideways, and it goes to tags rather than up a tree.
 */

import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '../components/press';
import { api, TagPage } from '../api';
import { colors, INK, LIME, spacing, type as t } from '../theme';
import { Icon } from '../components/Icon';
import { HostFace, TypeChip, money } from '../components/hosting';
import { useViewport } from '../hooks/useViewport';
import { useRouter } from '../router';
import { paths } from '../routes';

const WIDE = 900;

export function TagScreen({ tagKey, vocab }: { tagKey: string; vocab: 'tag' | 'facet' }) {
  const { width } = useViewport();
  const wide = width >= WIDE;
  const { navigate, back } = useRouter();
  const [data, setData] = useState<TagPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null); setError(null);
    api.tagPage(tagKey, { vocab }).then((r) => { if (live) setData(r); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [tagKey, vocab]);

  // `hosts` is a page of people, one row each; `hostCount` is how many there
  // are in all. The sparse state is about the total, not about the page.
  const hosts = data?.hosts ?? [];
  const total = data?.tag.hostCount ?? 0;
  const sparse = Boolean(data) && total <= 1;

  return (
    <ScrollView style={s.page} contentContainerStyle={[{ paddingBottom: 40 }, wide && s.wide]}>
      <View style={s.head}>
        <Press onPress={() => back(paths.people())} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="previous" size={22} color={colors.ink} strokeWidth={2} />
        </Press>
      </View>

      <View style={[s.gutter, { gap: 8, paddingTop: 6 }]}>
        {/* Context in one glance. Not a link — there is no tree to walk. */}
        {data?.tag.breadcrumb ? <Text style={s.crumb}>{data.tag.breadcrumb}</Text> : null}
        <Text style={s.title}>{data?.tag.label ?? (error ? 'Not a tag we know' : '…')}</Text>
        {data?.tag.note ? <Text style={s.line}>{data.tag.note}</Text> : null}
        {data && total >= 2 ? <Text style={s.count}>{total} hosts on Epic</Text> : null}
        {error ? <Text style={t.small}>{error}</Text> : null}
      </View>

      {/* One host is the rarest thing on Epic this week, and the page says so. */}
      {sparse && hosts.length === 1 ? (
        <View style={[s.gutter, { paddingTop: 18 }]}>
          <View style={s.limeBlock}>
            <Text style={s.limeHead}>One host, and {hosts[0].name} is the only person on Epic listed for it</Text>
            <Text style={s.limeSub}>Which makes this the rarest thing on Epic this week.</Text>
          </View>
        </View>
      ) : null}
      {sparse && !hosts.length ? (
        <View style={[s.gutter, { paddingTop: 18 }]}>
          <View style={s.limeBlock}>
            <Text style={s.limeHead}>Nobody is listed for this yet</Text>
            <Text style={s.limeSub}>Which means the first person to host it has the whole thing to themselves.</Text>
          </View>
        </View>
      ) : null}

      {hosts.length ? (
        <View style={[s.gutter, { paddingTop: 18, gap: 0 }]}>
          {total >= 2 ? <Text style={s.kicker}>Who does it</Text> : null}
          {hosts.map((h) => (
            <Press
              key={h.offerId}
              onPress={() => navigate(paths.experience(h.offerId))}
              accessibilityRole="button"
              style={[s.hostRow, h.state === 'paused' && { opacity: 0.72 }]}
            >
              <HostFace host={{ id: h.hostId, name: h.name, photo: h.photoId ? `/api/media/${h.photoId}` : null, type: h.type ?? 'skill' } as any} size={52} />
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <Text style={s.hostName} numberOfLines={1}>{h.name}</Text>
                <View style={s.chips}>
                  {h.type ? <TypeChip type={h.type} small /> : null}
                  {h.area ? <View style={s.placeChip}><Text style={s.placeChipText} numberOfLines={1}>{h.area}</Text></View> : null}
                </View>
                <Text style={t.small} numberOfLines={1}>
                  {[h.title, h.location].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {/* A whole-group offer keeps its figure in the total, not the each. */}
              <Text style={s.price}>
                {h.priceMode === 'free' ? 'Free'
                  : h.priceMode === 'by_numbers' ? `${money(h.totalPence)} in all`
                    : money(h.pricePence)}
              </Text>
            </Press>
          ))}
        </View>
      ) : null}

      {/* Who else could host it — a rare tag is a reason to tell somebody. */}
      {sparse ? (
        <View style={[s.gutter, { paddingTop: 16 }]}>
          <View style={s.tintLine}>
            <Text style={s.tintText}>
              Know somebody who could host this? <Text style={{ fontWeight: '700' }}>Tell them Epic exists.</Text>
            </Text>
          </View>
        </View>
      ) : null}

      {data?.near.length ? (
        <View style={[s.gutter, { paddingTop: 22, gap: 10 }]}>
          <Text style={s.kicker}>Close to it</Text>
          <View style={s.wrap}>
            {data.near.map((n) => (
              <Press key={n.key} onPress={() => navigate(paths.tag(n.key, vocab))} accessibilityRole="button" style={s.nearChip}>
                <Text style={s.nearChipText}>{n.label}</Text>
              </Press>
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  wide: { maxWidth: 720, alignSelf: 'center', width: '100%' },
  gutter: { paddingHorizontal: 20 },
  head: { paddingHorizontal: 20, paddingTop: 12 },
  crumb: { fontSize: 11.5, color: colors.inkMuted },
  title: { fontSize: 29, fontWeight: '800', letterSpacing: -0.87, lineHeight: 32, color: colors.ink },
  line: { fontSize: 14, lineHeight: 20, color: colors.ink },
  count: { fontSize: 12.5, fontWeight: '700', color: colors.accent },
  kicker: { fontSize: 11, fontWeight: '700', letterSpacing: 0.66, textTransform: 'uppercase', color: colors.inkMuted, paddingBottom: 8 },
  limeBlock: { backgroundColor: LIME, padding: 16, gap: 7 },
  limeHead: { fontSize: 19, fontWeight: '800', letterSpacing: -0.38, lineHeight: 23, color: INK },
  limeSub: { fontSize: 13, lineHeight: 18, color: colors.onLime },
  hostRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  hostName: { fontSize: 15.5, fontWeight: '700', color: colors.ink },
  chips: { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  placeChip: { borderWidth: 1, borderColor: colors.ruleSoft, paddingHorizontal: 7, height: 20, justifyContent: 'center' },
  placeChipText: { fontSize: 10, fontWeight: '600', letterSpacing: 0.6, color: colors.inkMuted },
  price: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  tintLine: { backgroundColor: colors.surfaceMuted, paddingHorizontal: 13, paddingVertical: 12 },
  tintText: { fontSize: 13, lineHeight: 18, color: colors.ink },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  nearChip: { backgroundColor: colors.warm, paddingHorizontal: 11, paddingVertical: 8 },
  nearChipText: { fontSize: 13.5, fontWeight: '600', color: colors.ink },
});
