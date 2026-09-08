import React, { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { API_URL, InspireItem } from '../api';
import { colors, fonts, spacing, TARGET } from '../theme';
import { Icon, iconFor } from './Icon';
import { PHOTO_W } from './VenueThumb';

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
/**
 * How big a picture is.
 *
 * Owner, 8 Sep 2026: "I prefer to have bigger, sexier images… I think they
 * maybe need to be about 60% bigger", knowing that it costs him a shelf —
 * "that probably means we only fit 2 rows in view, but that's okay". So the
 * card is the old 160x110 at 1.6, and a phone shows one and a good look at the
 * next rather than two small ones. Past 200px wide `PlaceThumb` buys the 960
 * copy of our own photograph instead of the 500, so the picture is sharper as
 * well as larger.
 */
const CARD_W = 256;
const CARD_H = 176;
/** The same 60% on the list's square, so an opened category reads like the shelf. */
const ROW_THUMB = 134;
/** "3,241" is four glyphs a card cannot spare; "3.2k" is the handoff's own. */
const briefly = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));

/**
 * The star, the number and how many said so.
 *
 * The lifted green rather than a rating yellow: Epic has no yellow, and the
 * handoff draws this in the same green the selected category uses.
 */
export function Crowd({ rating, count, size = 13, empty }: {
  rating: number | null; count?: number | null; size?: number;
  /**
   * What to say when there is no number — and, by being passed at all, that
   * this caller wants the line held whatever the answer.
   *
   * The owner asked for the rating and the count "on every single square" (8
   * Sep 2026), which means a square Google has not answered for yet cannot
   * simply have a gap where the other squares have a star. `undefined` is the
   * old behaviour and draws nothing; a string is what to say instead; `null`
   * holds the line blank while the answer is still on its way, so the card
   * does not shuffle its own text when it lands.
   */
  empty?: string | null;
}) {
  const line = { fontSize: size, lineHeight: size + 5 };
  if (rating == null) {
    if (empty === undefined) return null;
    return <Text style={[styles.meta, line]} numberOfLines={1}>{empty ?? ' '}</Text>;
  }
  return (
    <View style={styles.crowd}>
      <Icon name="favourite" size={size + 1} color={colors.accent} fill />
      <Text style={[styles.crowdValue, line]}>{rating.toFixed(1)}</Text>
      {count ? <Text style={[styles.meta, line]}>{briefly(count)} review{count === 1 ? '' : 's'}</Text> : null}
    </View>
  );
}
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
    : photo?.url ?? (photo?.ref ? `${API_URL}/api/photos/google?name=${encodeURIComponent(photo.ref)}&w=${PHOTO_W}` : null);
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

/**
 * A shelf's title, with how many are in it opposite.
 *
 * One component so the browse view and an opened category cannot drift apart.
 * The count belongs on this line and nowhere else (owner, 8 Sep 2026): it sat
 * on the filter row for a while, beside Any budget, which put "2 places" next
 * to the controls that had just cut the list to two and read as part of the
 * filtering rather than as the answer to it.
 *
 * `onAll` is what makes it a door. Closed, the shelf is a glance and the title
 * opens the whole category; opened, there is nowhere further to go, so the
 * count is a plain statement with no chevron to promise otherwise.
 */
export function SectionHead({ title, count, onAll }: { title: string; count: number; onAll?: () => void }) {
  const right = (
    <View style={styles.allLink}>
      <Text style={styles.meta}>All {count}</Text>
      {onAll ? <Icon name="more" size={16} color={colors.inkMuted} /> : null}
    </View>
  );
  if (!onAll) {
    return <View style={styles.sectionHead}><Text style={styles.sectionTitle}>{title}</Text>{right}</View>;
  }
  return (
    <Pressable onPress={onAll} style={styles.sectionHead} accessibilityRole="button" accessibilityLabel={`${title}, all ${count}`}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {right}
    </Pressable>
  );
}

/** 8a: one category's worth, across. The title is a door into the whole of it. */
export function Carousel({ title, count, items, onAll, onOpen, crowdOf, travelWord }: {
  title: string; count: number; items: InspireItem[];
  onAll: () => void; onOpen: (i: InspireItem) => void;
  /** What the crowd made of it, once Google has answered for this one. */
  crowdOf?: (i: InspireItem) => { rating: number | null; ratingCount: number | null; known?: boolean };
  travelWord?: string;
}) {
  if (!items.length) return null;
  return (
    <View style={styles.section}>
      <SectionHead title={title} count={count} onAll={onAll} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
        {items.map((i) => (
          <Card key={i.venueRef} item={i} crowd={crowdOf?.(i)} travelWord={travelWord} onOpen={() => onOpen(i)} />
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * One place on a shelf.
 *
 * The rating has its own line under the name rather than sharing one with the
 * journey, and it is drawn whether or not there is a number yet: the owner
 * asked to see the rating and how many people gave it "on every single square"
 * (8 Sep 2026), and a square that says nothing at all reads as broken rather
 * than as unknown. A place Google has no number for says so in words.
 */
function Card({ item, crowd, travelWord, onOpen }: {
  item: InspireItem;
  crowd?: { rating: number | null; ratingCount: number | null; known?: boolean };
  travelWord?: string; onOpen: () => void;
}) {
  return (
    <Pressable onPress={onOpen} style={styles.card} accessibilityRole="button" accessibilityLabel={item.name}>
      <PlaceThumb item={item} width={CARD_W} height={CARD_H} />
      <Text style={styles.cardName} numberOfLines={2}>{item.name}</Text>
      {crowd ? <Crowd rating={crowd.rating} count={crowd.ratingCount} empty={crowd.known ? 'No ratings yet' : null} /> : null}
      {/* The dwell stays on the place itself, where the facts grid has room
          for it (9a, 9f); the card says only how far. */}
      <Text style={styles.meta} numberOfLines={1}>{minutes(item.travelMinutes)} {travelWord ?? 'drive'}</Text>
    </Pressable>
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
export function PlaceRow({ item, kind, status, crowd, onOpen }: {
  item: InspireItem; kind: string | null; status?: { text: string; open: boolean } | null;
  crowd?: { rating: number | null; ratingCount: number | null; known?: boolean };
  onOpen: () => void;
}) {
  const bits = [kind, minutes(item.travelMinutes), `allow ${minutes(item.dwellMinutes)}`].filter(Boolean);
  return (
    <Pressable onPress={onOpen} style={styles.row} accessibilityRole="button" accessibilityLabel={item.name}>
      <PlaceThumb item={item} width={ROW_THUMB} height={ROW_THUMB} />
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={2}>{item.name}</Text>
        <Text style={styles.meta} numberOfLines={2}>{bits.join(' · ')}</Text>
        <Crowd rating={crowd?.rating ?? null} count={crowd?.ratingCount} empty={crowd ? (crowd.known ? 'No ratings yet' : null) : undefined} />
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
export function FoodRow({ item, kind, where, status, standing, crowd, onOpen }: {
  crowd?: { rating: number | null; ratingCount: number | null; known?: boolean };
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
        {/* Google's number where we have it, our own band where we do not — the
            band is a judgement of ours, and better than nothing at all. */}
        {crowd?.rating != null
          ? <Crowd rating={crowd.rating} count={crowd.ratingCount} />
          : standing ? <Text style={styles.meta}>{STANDING[standing] ?? standing}</Text>
          : crowd?.known ? <Text style={styles.meta}>No ratings yet</Text> : null}
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
  card: { width: CARD_W, gap: 6 },
  cardName: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: colors.ink },

  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted },
  crowd: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  crowdValue: { fontFamily: fonts.body, fontWeight: '700', color: colors.accent },
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
