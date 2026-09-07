import React, { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { API_URL, InspireItem } from '../api';
import { colors, fonts, spacing, TARGET } from '../theme';
import { Icon, iconFor } from './Icon';

/**
 * The bodies of the Inspire tab (Inspire rework, screens 8a, 8b, 8d, 8e).
 *
 * Four ways of drawing the same pool, and which one you get is a statement
 * about how much you have narrowed it: a carousel per category when nothing is
 * picked, a list with pictures when a category is, a bare list of cuisines in
 * Food, and a list without pictures once a cuisine is. The rows get denser as
 * the question gets narrower, which is the point.
 */

const GUTTER = 20;
const minutes = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`);
/** The sweep's own words for how a place stands, in the household's language. */
const STANDING: Record<string, string> = { top: 'Top rated', high: 'Well rated', good: 'Well liked', mixed: 'Mixed' };

export const priceBand = (p: number | null) => (p == null ? null : p === 0 ? 'Free' : '£'.repeat(Math.max(1, Math.min(4, p))));

/**
 * A place's picture, or its own icon on the lime tile.
 *
 * Ours first: an atlas image is harvested under a licence that lets us keep it
 * and is served from our own origin, so the second look costs nothing. The
 * `lqip` is a 20px JPEG inlined in the answer, which is what puts the
 * photograph's colours on screen before a single image request has been made. A
 * provider's photo is only ever fetched at display time and never stored
 * (Technical Constraints §4).
 */
export function PlaceThumb({ item, width, height }: { item: InspireItem; width: number; height: number }) {
  const owned = item.image;
  const photo = item.photos?.[0];
  const uri = owned
    ? `${API_URL}/api/images/${owned.id}/${width > 200 ? 960 : 500}`
    : photo?.url ?? (photo?.ref ? `${API_URL}/api/photos/google?name=${encodeURIComponent(photo.ref)}&w=480` : null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <View style={[styles.thumb, { width, height }]}>
      {owned?.lqip && !loaded && !failed ? (
        <Image source={{ uri: owned.lqip }} style={StyleSheet.absoluteFill as any} resizeMode="cover" blurRadius={2} accessibilityIgnoresInvertColors />
      ) : null}
      {uri && !failed ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill as any} resizeMode="cover" onError={() => setFailed(true)} onLoad={() => setLoaded(true)} accessibilityIgnoresInvertColors />
      ) : (
        <View style={styles.thumbEmpty}><Icon name={iconFor(item)} size={Math.round(Math.min(width, height) * 0.26)} color={colors.icon} /></View>
      )}
    </View>
  );
}

/** 8a: one category's worth, across. The title is a door into the whole of it. */
export function Carousel({ title, count, items, onAll, onOpen }: {
  title: string; count: number; items: InspireItem[];
  onAll: () => void; onOpen: (i: InspireItem) => void;
}) {
  if (!items.length) return null;
  return (
    <View style={styles.section}>
      <Pressable onPress={onAll} style={styles.sectionHead} accessibilityRole="button" accessibilityLabel={`${title}, all ${count}`}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.allLink}>
          <Text style={styles.meta}>All {count}</Text>
          <Icon name="more" size={16} color={colors.inkMuted} />
        </View>
      </Pressable>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
        {items.map((i) => (
          <Pressable key={i.venueRef} onPress={() => onOpen(i)} style={styles.card} accessibilityRole="button" accessibilityLabel={i.name}>
            <PlaceThumb item={i} width={160} height={110} />
            <Text style={styles.cardName} numberOfLines={2}>{i.name}</Text>
            <Text style={styles.meta} numberOfLines={1}>{minutes(i.travelMinutes)} · {minutes(i.dwellMinutes)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * 8b: a place, with its picture, once a category is open.
 *
 * `status` is drawn only when there is something true to put there. The design
 * shows "Open until 17:15", which needs opening hours the Inspire payload does
 * not carry yet — so the line is a slot, and an empty slot draws nothing rather
 * than a guess.
 */
export function PlaceRow({ item, kind, status, onOpen }: {
  item: InspireItem; kind: string | null; status?: { text: string; open: boolean } | null; onOpen: () => void;
}) {
  const bits = [kind, minutes(item.travelMinutes), `allow ${minutes(item.dwellMinutes)}`].filter(Boolean);
  return (
    <Pressable onPress={onOpen} style={styles.row} accessibilityRole="button" accessibilityLabel={item.name}>
      <PlaceThumb item={item} width={84} height={84} />
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={2}>{item.name}</Text>
        <Text style={styles.meta} numberOfLines={2}>{bits.join(' · ')}</Text>
        {status ? <Text style={[styles.status, { color: status.open ? colors.accent : colors.inkMuted }]}>{status.text}</Text> : null}
      </View>
    </Pressable>
  );
}

/** 8d: what kinds of food are near, and how many of each. */
export function CuisineRow({ label, count, onOpen }: { label: string; count: number; onOpen: () => void }) {
  return (
    <Pressable onPress={onOpen} style={styles.cuisine} accessibilityRole="button" accessibilityLabel={`${label}, ${count} places`}>
      <Text style={styles.cuisineName}>{label}</Text>
      <View style={styles.allLink}>
        <Text style={styles.meta}>{count}</Text>
        <Icon name="more" size={16} color={colors.inkMuted} />
      </View>
    </Pressable>
  );
}

/**
 * 8e: somewhere to eat. No picture — a cuisine list is read for the name, the
 * price and the rating, and eleven thumbnails of food we do not own would say
 * less than the two numbers on the right.
 */
export function FoodRow({ item, kind, where, status, standing, onOpen }: {
  item: InspireItem; kind: string | null; where: string | null;
  status?: { text: string; open: boolean } | null;
  /**
   * What the crowd makes of it, as a word: 'top' | 'high' | 'good' | 'mixed'.
   * A band, not a number — the figure it was worked out from is the provider's
   * and is never stored, so the row shows the judgement we are allowed to keep
   * instead of a rating we are not (§13.10).
   */
  standing?: string | null;
  onOpen: () => void;
}) {
  const bits = [kind, where, minutes(item.travelMinutes)].filter(Boolean);
  const price = priceBand(item.priceLevel);
  return (
    <Pressable onPress={onOpen} style={styles.foodRow} accessibilityRole="button" accessibilityLabel={item.name}>
      <View style={styles.rowBody}>
        <Text style={styles.foodName} numberOfLines={2}>{item.name}</Text>
        <Text style={styles.meta} numberOfLines={2}>{bits.join(' · ')}</Text>
        {status ? <Text style={[styles.status, { color: status.open ? colors.accent : colors.inkMuted }]}>{status.text}</Text> : null}
      </View>
      <View style={styles.foodSide}>
        {price ? <Text style={styles.price}>{price}</Text> : null}
        {item.rating != null
          ? <Text style={styles.meta}>{item.rating.toFixed(1)}</Text>
          : standing ? <Text style={styles.meta}>{STANDING[standing] ?? standing}</Text> : null}
      </View>
    </Pressable>
  );
}

/** The small capitalised label that opens a plain list — "CUISINE". */
export function Kicker({ children }: { children: React.ReactNode }) {
  return <Text style={styles.kicker}>{children}</Text>;
}

const styles = StyleSheet.create({
  thumb: { backgroundColor: colors.accentSoft, overflow: 'hidden' },
  thumbEmpty: { ...(StyleSheet.absoluteFill as object), alignItems: 'center', justifyContent: 'center' },

  section: { gap: spacing.md },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: GUTTER },
  sectionTitle: { fontFamily: fonts.heading, fontSize: 22, fontWeight: '800', letterSpacing: -0.44, color: colors.ink },
  allLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  carousel: { gap: 12, paddingHorizontal: GUTTER },
  card: { width: 160, gap: 6 },
  cardName: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: colors.ink },

  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted },
  status: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600' },

  row: {
    flexDirection: 'row', gap: 14, paddingVertical: 14, paddingHorizontal: GUTTER, minHeight: TARGET,
    borderBottomWidth: 1, borderBottomColor: colors.lineSoft, alignItems: 'flex-start',
  },
  rowBody: { flex: 1, gap: 4 },
  rowName: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: colors.ink },

  cuisine: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md,
    paddingVertical: 16, paddingHorizontal: GUTTER, minHeight: TARGET,
    borderBottomWidth: 1, borderBottomColor: colors.lineSoft,
  },
  cuisineName: { fontFamily: fonts.body, fontSize: 17, fontWeight: '600', color: colors.ink },

  foodRow: {
    flexDirection: 'row', gap: spacing.md, paddingVertical: 16, paddingHorizontal: GUTTER, minHeight: TARGET,
    borderBottomWidth: 1, borderBottomColor: colors.lineSoft, alignItems: 'flex-start',
  },
  foodName: { fontFamily: fonts.body, fontSize: 17, fontWeight: '600', color: colors.ink },
  foodSide: { alignItems: 'flex-end', gap: 2 },
  price: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.ink },

  kicker: {
    fontFamily: fonts.body, fontSize: 11, fontWeight: '600', letterSpacing: 0.88,
    textTransform: 'uppercase', color: colors.inkMuted,
    paddingHorizontal: GUTTER, paddingBottom: 10, marginTop: spacing.lg,
    borderBottomWidth: 1, borderBottomColor: colors.lineSoft,
  },
});
