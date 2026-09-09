import React, { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from './press';
import { API_URL, InspireItem } from '../api';
import { colors, fonts, spacing, TARGET } from '../theme';
import { Icon, IconName, iconFor } from './Icon';
import { PHOTO_W } from './VenueThumb';
import { briefly, priceMarks } from '../screens/inspireList';

/**
 * The bodies of the Inspire tab (handover v8, 8 Sep 2026, §2).
 *
 * Five ways of drawing the same pool, and which one you get is a statement
 * about how far you have drilled: shelves of cards when nothing is picked, a
 * list of drawers once a category is, full-width cards once a drawer is; and
 * in Food, text rows at the top and a list of cuisines under a kind of place.
 * The rows get denser as the question gets narrower, which is the point.
 */

const GUTTER = 20;
/** "Cards 208px wide, fixed 3:2 media, 12px radius." */
const CARD_W = 208;
const CARD_H = Math.round((CARD_W * 2) / 3);
/**
 * The one place a corner is rounded: "zero radius except photo media
 * (10–12px)". A picture is not a card — the frame round it is what the pack
 * keeps square.
 */
export const MEDIA_RADIUS = 12;

export type Crowd = { rating: number | null; ratingCount: number | null; known?: boolean };

/**
 * The star, the number and how many said so.
 *
 * Moss rather than a rating yellow: Epic has no yellow, and the handoff draws
 * this in the same green the selected category uses.
 */
export function Crowd({ rating, count, size = 13, empty, brief }: {
  rating: number | null; count?: number | null; size?: number;
  /**
   * What to say when there is no number — and, by being passed at all, that
   * this caller wants the line held whatever the answer. `undefined` draws
   * nothing; a string is what to say instead; `null` holds the line blank
   * while the answer is on its way, so the card does not shuffle its own text
   * when it lands.
   */
  empty?: string | null;
  /** "(890)" rather than "890 reviews" — the food row's own form. */
  brief?: boolean;
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
      {count ? <Text style={[styles.meta, line]}>{brief ? `(${briefly(count)})` : `${briefly(count)} review${count === 1 ? '' : 's'}`}</Text> : null}
    </View>
  );
}

const minutes = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`);
/** The sweep's own words for how a place stands, in the household's language. */
const STANDING: Record<string, string> = { top: 'Top rated', high: 'Well rated', good: 'Well liked', mixed: 'Mixed' };

export const priceBand = priceMarks;

/** How the journey is drawn: the glyph, and the word after the minutes. */
export type Travel = { icon: IconName; word: string };
export const TRAVEL: Record<'drive' | 'transit' | 'walk', Travel> = {
  drive: { icon: 'driving', word: 'drive' },
  transit: { icon: 'transit', word: 'by transport' },
  walk: { icon: 'walking', word: 'walk' },
};

/** "20 min drive", with the mode's own glyph in front of it. */
function Journey({ item, travel }: { item: InspireItem; travel?: Travel }) {
  const t = travel ?? TRAVEL.drive;
  return (
    <View style={styles.journey}>
      <Icon name={t.icon} size={14} color={colors.inkMuted} strokeWidth={2.2} />
      <Text style={styles.meta} numberOfLines={1}>{minutes(item.travelMinutes)} {t.word}</Text>
    </View>
  );
}

/**
 * A place's picture, or its own icon on the lime tile.
 *
 * Ours first: an atlas image is harvested under a licence that lets us keep it
 * and is served from our own origin, so the second look costs nothing. The
 * `lqip` is a 20px JPEG inlined in the answer, which is what puts the
 * photograph's colours on screen before a single image request has been made. A
 * provider's photo is only ever fetched at display time and never stored
 * (Technical Constraints §4).
 *
 * `fill` makes it as wide as its parent at 3:2 — the full-width card — instead
 * of a fixed size.
 */
export function PlaceThumb({ item, width, height, fill, rounded = MEDIA_RADIUS }: {
  item: InspireItem; width?: number; height?: number; fill?: boolean; rounded?: number;
}) {
  const owned = item.image;
  const photo = item.photos?.[0];
  const big = fill || (width ?? 0) > 200;
  const uri = owned
    ? `${API_URL}/api/images/${owned.id}/${big ? 960 : 500}`
    : photo?.url ?? (photo?.ref ? `${API_URL}/api/photos/google?name=${encodeURIComponent(photo.ref)}&w=${PHOTO_W}` : null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const box = fill ? { width: '100%' as const, aspectRatio: 3 / 2 } : { width, height };
  const glyph = fill ? 40 : Math.round(Math.min(width ?? 40, height ?? 40) * 0.26);
  return (
    <View style={[styles.thumb, { borderRadius: rounded }, box]}>
      {owned?.lqip && !loaded && !failed ? (
        <Image source={{ uri: owned.lqip }} style={StyleSheet.absoluteFill as any} resizeMode="cover" blurRadius={2} accessibilityIgnoresInvertColors />
      ) : null}
      {uri && !failed ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill as any} resizeMode="cover" onError={() => setFailed(true)} onLoad={() => setLoaded(true)} accessibilityIgnoresInvertColors />
      ) : (
        <View style={styles.thumbEmpty}><Icon name={iconFor(item)} size={glyph} color={colors.icon} /></View>
      )}
    </View>
  );
}

/**
 * A shelf's title, with "All N ›" opposite — the door into the whole of it.
 * One component so the shelves and the drill-down cannot drift apart.
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
    <Press onPress={onAll} style={styles.sectionHead} accessibilityRole="button" accessibilityLabel={`${title}, all ${count}`}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {right}
    </Press>
  );
}

/** All: one category's worth, across. The title is a door into the whole of it. */
export function Carousel({ title, count, items, onAll, onOpen, crowdOf, travel }: {
  title: string; count: number; items: InspireItem[];
  onAll: () => void; onOpen: (i: InspireItem) => void;
  /** What the crowd made of it, once Google has answered for this one. */
  crowdOf?: (i: InspireItem) => Crowd;
  travel?: Travel;
}) {
  if (!items.length) return null;
  return (
    <View style={styles.section}>
      <SectionHead title={title} count={count} onAll={onAll} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
        {items.map((i) => (
          <Card key={i.venueRef} item={i} crowd={crowdOf?.(i)} travel={travel} onOpen={() => onOpen(i)} />
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * One place on a shelf: "name → ★ rating + '3.2k reviews' → travel-mode glyph
 * + '20 min drive'". The rating line is held whether or not there is a number
 * yet: a square that says nothing reads as broken rather than as unknown.
 */
function Card({ item, crowd, travel, onOpen }: { item: InspireItem; crowd?: Crowd; travel?: Travel; onOpen: () => void }) {
  const price = priceMarks(item.priceLevel);
  return (
    <Press onPress={onOpen} style={styles.card} accessibilityRole="button" accessibilityLabel={item.name}>
      <PlaceThumb item={item} width={CARD_W} height={CARD_H} />
      <Text style={styles.cardName} numberOfLines={2}>{item.name}</Text>
      {crowd ? <Crowd rating={crowd.rating} count={crowd.ratingCount} empty={crowd.known ? 'No ratings yet' : null} /> : null}
      <View style={styles.cardFoot}>
        <Journey item={item} travel={travel} />
        {price ? <Text style={styles.price}>{price}</Text> : null}
      </View>
    </Press>
  );
}

/** Inside a drawer: the same card, the width of the screen, rule-separated. */
export function CardWide({ item, crowd, travel, onOpen }: { item: InspireItem; crowd?: Crowd; travel?: Travel; onOpen: () => void }) {
  const price = priceMarks(item.priceLevel);
  return (
    <Press onPress={onOpen} style={styles.cardWide} accessibilityRole="button" accessibilityLabel={item.name}>
      <PlaceThumb item={item} fill />
      <Text style={styles.cardWideName} numberOfLines={2}>{item.name}</Text>
      {crowd ? <Crowd rating={crowd.rating} count={crowd.ratingCount} empty={crowd.known ? 'No ratings yet' : null} /> : null}
      <View style={styles.cardFoot}>
        <Journey item={item} travel={travel} />
        {price ? <Text style={styles.price}>{price}</Text> : null}
      </View>
    </Press>
  );
}

/**
 * One drawer inside a category, or one cuisine inside a kind of place: "16px
 * rows with counts and chevrons (Theme parks · 2, Adventure · 1 …)".
 */
export function SubRow({ label, count, onPress }: { label: string; count: number; onPress: () => void }) {
  return (
    <Press onPress={onPress} style={styles.subRow} accessibilityRole="button" accessibilityLabel={`${label}, ${count} place${count === 1 ? '' : 's'}`}>
      <Text style={styles.subLabel} numberOfLines={1}>{label}</Text>
      <View style={styles.subRight}>
        <Text style={styles.subCount}>{count}</Text>
        <Icon name="more" size={16} color={colors.ink} strokeWidth={2.2} />
      </View>
    </Press>
  );
}

/**
 * Somewhere to eat: "text rows (no image slots): name, ★ rating (count),
 * 'Italian · ££ · 22 min drive', open status in moss".
 *
 * A cuisine list is read for the name, the price and the rating, and a column
 * of food photographs we do not own would say less than the two numbers.
 */
export function FoodRow({ item, kind, status, standing, crowd, travel, onOpen }: {
  item: InspireItem;
  /** "Italian", "Pub" — the one word for what it is. */
  kind: string | null;
  /** "Open until 22:00", when a source has said so; drawn in moss. */
  status?: { text: string; open: boolean } | null;
  /**
   * What the crowd makes of it, as a word: 'top' | 'high' | 'good' | 'mixed'.
   * A band, not a number — the figure it was worked out from is the provider's
   * and is never stored, so the row shows the judgement we are allowed to keep
   * instead of a rating we are not (§13.10).
   */
  standing?: string | null;
  crowd?: Crowd;
  travel?: Travel;
  onOpen: () => void;
}) {
  const t = travel ?? TRAVEL.drive;
  const bits = [kind, priceMarks(item.priceLevel), `${minutes(item.travelMinutes)} ${t.word}`].filter(Boolean);
  return (
    <Press onPress={onOpen} style={styles.foodRow} accessibilityRole="button" accessibilityLabel={item.name}>
      <View style={styles.foodTop}>
        <Text style={styles.foodName} numberOfLines={2}>{item.name}</Text>
        {/* Google's number where we have it, our own band where we do not — the
            band is a judgement of ours, and better than nothing at all. */}
        <View style={styles.foodSide}>
          {crowd?.rating != null
            ? <Crowd rating={crowd.rating} count={crowd.ratingCount} brief />
            : standing ? <Text style={styles.meta}>{STANDING[standing] ?? standing}</Text>
              : crowd?.known ? <Text style={styles.meta}>No ratings yet</Text> : null}
        </View>
      </View>
      <Text style={styles.meta} numberOfLines={1}>{bits.join(' · ')}</Text>
      {status ? <Text style={[styles.status, { color: status.open ? colors.accent : colors.inkMuted }]}>{status.text}</Text> : null}
    </Press>
  );
}

/** The small capitalised label that opens a plain list. */
export function Kicker({ children }: { children: React.ReactNode }) {
  return <Text style={styles.kicker}>{children}</Text>;
}

/**
 * "Nothing matches / No places within 1 hr · Sunningdale match these filters.
 * / Clear filters" — the same words in both modes.
 */
export function EmptyMatch({ title = 'Nothing matches', body, action, onAction }: {
  title?: string; body: string; action?: string | null; onAction?: () => void;
}) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {action && onAction ? (
        <Press onPress={onAction} accessibilityRole="button" style={styles.emptyAction}>
          <Text style={styles.emptyActionText}>{action}</Text>
        </Press>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  thumb: { backgroundColor: colors.switchOff, overflow: 'hidden' },
  thumbEmpty: { ...(StyleSheet.absoluteFill as object), alignItems: 'center', justifyContent: 'center' },

  section: { gap: spacing.md },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: GUTTER },
  sectionTitle: { fontFamily: fonts.heading, fontSize: 22, fontWeight: '800', letterSpacing: -0.44, color: colors.ink },
  allLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  carousel: { gap: 12, paddingHorizontal: GUTTER },
  card: { width: CARD_W, gap: 7 },
  cardName: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', lineHeight: 18, color: colors.ink },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  journey: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  price: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.ink },

  cardWide: { gap: 7, paddingBottom: 16, marginHorizontal: GUTTER, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  cardWideName: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', lineHeight: 19, color: colors.ink },

  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted },
  crowd: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  crowdValue: { fontFamily: fonts.body, fontWeight: '600', color: colors.ink },
  status: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600' },

  subRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md,
    paddingVertical: 15, marginHorizontal: GUTTER, minHeight: TARGET,
    borderBottomWidth: 1, borderBottomColor: colors.lineSoft,
  },
  subLabel: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: colors.ink, flexShrink: 1 },
  subRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  subCount: { fontFamily: fonts.body, fontSize: 13, fontWeight: '500', color: colors.inkMuted },

  foodRow: {
    gap: 4, paddingVertical: 14, marginHorizontal: GUTTER, minHeight: TARGET,
    borderBottomWidth: 1, borderBottomColor: colors.lineSoft,
  },
  foodTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  foodName: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: colors.ink, flexShrink: 1 },
  foodSide: { alignItems: 'flex-end', flexShrink: 0 },

  kicker: {
    fontFamily: fonts.body, fontSize: 11, fontWeight: '600', letterSpacing: 0.88,
    textTransform: 'uppercase', color: colors.inkMuted,
    paddingHorizontal: GUTTER, paddingBottom: 10, marginTop: spacing.lg,
    borderBottomWidth: 1, borderBottomColor: colors.lineSoft,
  },

  empty: { gap: 8, paddingTop: 16, paddingHorizontal: GUTTER },
  emptyTitle: { fontFamily: fonts.heading, fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  emptyBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.inkMuted },
  emptyAction: { paddingTop: 2, minHeight: TARGET - 8, justifyContent: 'center', alignSelf: 'flex-start' },
  emptyActionText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: colors.accent },
});
