import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from './press';
import { InspireItem, type EventNear } from '../api';
import { AMBER, CREAM, INACTIVE, INK, LIME, colors, fonts, spacing, TARGET } from '../theme';
import { mediaUrl } from './hosting';
import { Icon, IconName } from './Icon';
import { CARD_H, CARD_W, MEDIA_RADIUS, VenueThumb } from './VenueThumb';
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
/**
 * The card's geometry — 208 wide, 3:2 media, 12px corners — lives with the
 * component that draws every photograph (VenueThumb), not here. It was here,
 * and that is how Inspire came to be the only tab that had it (owner, 9 Sep
 * 2026). Re-exported so nothing that imported it from this file moves.
 */
export { MEDIA_RADIUS };

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
export function PlaceThumb({ item, width, height, fill }: {
  item: InspireItem; width?: number; height?: number; fill?: boolean;
}) {
  // The same component as every other photograph in the app. This used to be
  // its own renderer with its own copy of the lqip-then-photo dance, which is
  // exactly how two tabs came to draw the same picture two ways.
  return (
    <VenueThumb
      name={item.name} image={item.image} photos={item.photos}
      category={item.category} experiences={item.experiences} atlasCategory={item.atlasCategory}
      width={width} height={height} fill={fill} credit={false}
    />
  );
}

/**
 * The card itself — the picture, the name, and whatever the caller puts under
 * them. Exported because Places draws the same card with a different foot
 * (owner, 9 Sep 2026: "in Inspire, we have a lovely layout. When I click into
 * Places, it should be the same thing, same sort of layout, with the photo").
 * `wide` is the drill-down's full-width form, rule-separated.
 */
export function MediaCard({ thumb, name, muted, wide, selected, onPress, children }: {
  thumb: React.ReactNode; name: string; muted?: boolean; wide?: boolean; selected?: boolean;
  onPress: () => void; children?: React.ReactNode;
}) {
  return (
    <Press onPress={onPress} style={wide ? styles.cardWide : styles.card} accessibilityRole="button" accessibilityLabel={name} accessibilityState={{ selected }}>
      {thumb}
      <Text style={[wide ? styles.cardWideName : styles.cardName, muted && styles.cardNameMuted, selected && styles.cardNameOn]} numberOfLines={2}>{name}</Text>
      {children}
    </Press>
  );
}

/** The first letter raised and nothing else touched, so "Food & drink" stays as written. */
export const sentenceCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * A shelf's title, with "All N ›" opposite — the door into the whole of it.
 * One component so the shelves and the drill-down cannot drift apart.
 */
export function SectionHead({ title, count, floor, estimated, onAll }: { title: string; count: number; floor?: boolean; estimated?: boolean; onAll?: () => void }) {
  /**
   * The census count for the reach, read as the floor it is.
   *
   * This was the length of the list, under a rule the owner has since
   * rewritten (24 Sep 2026): "never show the length of a page as if it were a
   * count. Show the census count for the reach, then the five bought for
   * display." The trailing mark says the number is a floor — places straddle
   * the reach's edge, or an outcode has never been censused — because every
   * figure is one and should read as one.
   *
   * A leading `~` says the reach itself is an estimate: walking and public
   * transport have no journey-time matrix yet, so the count is taken over a
   * conservative straight-line circle rather than real routes (owner, 30 Sep
   * 2026). It must not read as a measured journey-time count when it is not.
   */
  const said = `${estimated ? '~' : ''}${count.toLocaleString('en-GB')}${floor ? '+' : ''}`;
  // Sentence case at render (4a: "Fun", "Culture"): a category's label arrives
  // as the taxonomy holds it, often lowercase ("culture"), and the data keeps
  // its own spelling — only the first letter is raised here.
  const heading = sentenceCase(title);
  // New navigation (owner, 30 Sep 2026, §6): title case, the count beside the
  // title in muted, and "See all ›" right-aligned in moss — not a count and a
  // chevron on the right.
  const left = (
    <View style={styles.sectionLeft}>
      <Text style={styles.sectionTitle}>{heading}</Text>
      <Text style={styles.sectionCount}>{said}</Text>
    </View>
  );
  if (!onAll) {
    return <View style={styles.sectionHead}>{left}</View>;
  }
  return (
    <Press onPress={onAll} style={styles.sectionHead} accessibilityRole="button" accessibilityLabel={`See all ${heading}, ${said}`}>
      {left}
      <Text style={styles.seeAll}>See all ›</Text>
    </Press>
  );
}

/** All: one category's worth, across. The title is a door into the whole of it. */
export function Carousel({ title, count, floor, estimated, items, onAll, onOpen, crowdOf, travel, events, onOpenEvent }: {
  title: string; count: number; floor?: boolean; estimated?: boolean; items: InspireItem[];
  /** This category's events, mixed in after the first place (guest handoff G1b). */
  events?: EventNear[]; onOpenEvent?: (e: EventNear) => void;
  onAll: () => void; onOpen: (i: InspireItem) => void;
  /** What the crowd made of it, once Google has answered for this one. */
  crowdOf?: (i: InspireItem) => Crowd;
  travel?: Travel;
}) {
  if (!items.length) return null;
  return (
    <View style={styles.section}>
      <SectionHead title={title} count={count} floor={floor} estimated={estimated} onAll={onAll} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
        {items.flatMap((i, n) => [
          <Card key={i.venueRef} item={i} crowd={crowdOf?.(i)} travel={travel} onOpen={() => onOpen(i)} />,
          ...(n === 0 ? (events ?? []).slice(0, 3).map((e) => <EventCard key={`ev-${e.id}`} e={e} mixed onOpen={() => onOpenEvent?.(e)} />) : []),
        ])}
      </ScrollView>
    </View>
  );
}

/**
 * One place on a shelf: the name, then one line with the journey on the left
 * ("20 min drive", its mode glyph in front) and the crowd's verdict on the
 * right ("★ 4.5 · 3.2k reviews"); a price, when there is one, on its own row
 * underneath. The rating is held whether or not there is a number yet: a square
 * that says nothing reads as broken rather than as unknown.
 */
function Card({ item, crowd, travel, onOpen }: { item: InspireItem; crowd?: Crowd; travel?: Travel; onOpen: () => void }) {
  const price = priceMarks(item.priceLevel);
  return (
    <MediaCard name={item.name} onPress={onOpen} thumb={<PlaceThumb item={item} width={CARD_W} height={CARD_H} />}>
      {/* One line: the drive on the left, the crowd's verdict on the right
          (owner, 1 Oct 2026 — the wider card has the room, and these were a line
          each before). The rating is still held blank while its answer is on the
          way, so the card does not shuffle when it lands. A price is rare and
          takes its own row underneath when it is there. */}
      <View style={styles.cardFoot}>
        <Journey item={item} travel={travel} />
        {crowd ? <Crowd rating={crowd.rating} count={crowd.ratingCount} empty={crowd.known ? 'No ratings yet' : null} /> : null}
      </View>
      {item.closed?.status === 'temporarily_closed' ? <Text style={styles.tempClosed}>Temporarily closed</Text> : null}
      {price ? <Text style={styles.price}>{price}</Text> : null}
    </MediaCard>
  );
}

// ---------------------------------------------------------------------------
// Events near you (guest handoff G1, G1b, G1c)
// ---------------------------------------------------------------------------

const KIND_TAG: Record<string, string> = { oneoff: 'One-off', weekly: 'Weekly', course: 'Course', onrequest: 'On request' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_FULL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const eventDay = (ymd: string) => { const d = new Date(`${ymd}T12:00:00Z`); return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const pounds = (p: number) => `£${(p / 100).toFixed(p % 100 ? 2 : 0)}`;

/** "£12 a child", "£84", "Free". */
export function eventPrice(e: EventNear): string {
  const p = e.price;
  if (p.mode === 'free') return 'Free';
  if (p.mode === 'by_numbers' && p.nowEach != null) return pounds(p.nowEach);
  // Children only: the child rate is what is charged, so it is what is shown (Codex, 3 Oct 2026).
  const kidsOnly = e.who.dropOff || (e.who.ageMax != null && e.who.ageMax < 18);
  if (kidsOnly && (p.childPence || p.pence)) return `${pounds((p.childPence || p.pence) ?? 0)} a child`;
  if (p.pence) return pounds(p.pence);
  // A weekly class priced by how it is booked: its lower price, as from.
  const kinds = [p.dropInPence, p.bookAheadPence].filter((n): n is number => typeof n === 'number' && n > 0);
  return kinds.length ? `from ${pounds(Math.min(...kinds))}` : 'Free';
}

/** The badge on the photo (G1b): places left in lime, Needs N more in amber, Full in warm grey; none when there's room. */
export function eventBadge(e: EventNear): { words: string; bg: string } | null {
  if (e.full) return { words: 'Full', bg: INACTIVE };
  if (e.needs) return { words: `Needs ${e.needs} more`, bg: AMBER };
  if (e.placesLeft != null && e.placesLeft <= 3) return { words: `${e.placesLeft} ${e.placesLeft === 1 ? 'place' : 'places'} left`, bg: LIME };
  return null;
}

/** "Sat 3 Oct · 8 min · £12 a child"; in a category lane it starts "Event ·" and leaves out the drive (G1b). */
export function eventMeta(e: EventNear, mixed: boolean): string {
  const when = e.date ? (e.lane === 'weekly' && (e.sessionsAhead ?? 0) > 1 ? DOW_FULL[new Date(`${e.date}T12:00:00Z`).getUTCDay()] : eventDay(e.date)) : 'On request';
  return mixed ? `Event · ${when} · ${eventPrice(e)}` : [when, e.minutesAway != null ? `${e.minutesAway} min` : null, eventPrice(e)].filter(Boolean).join(' · ');
}

/** The event's photo at the place card's size, with the kind tag top-left and the badge bottom-left. */
function EventThumb({ e, width, height, fill }: { e: EventNear; width?: number; height?: number; fill?: boolean }) {
  const badge = eventBadge(e);
  const uri = mediaUrl(e.photo);
  return (
    <View style={[{ borderRadius: MEDIA_RADIUS, overflow: 'hidden', backgroundColor: INACTIVE }, fill ? { width: '100%', aspectRatio: CARD_W / CARD_H } : { width, height }]}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
      <Text style={styles.kindTag}>{KIND_TAG[e.lane] ?? 'Event'}</Text>
      {badge ? <Text style={[styles.eventBadge, { backgroundColor: badge.bg }]}>{badge.words}</Text> : null}
    </View>
  );
}

/** An event as the Inspire card — not a second kind of card (README): the same name, rating and meta line. */
export function EventCard({ e, mixed = false, wide = false, onOpen }: { e: EventNear; mixed?: boolean; wide?: boolean; onOpen: () => void }) {
  return (
    <MediaCard wide={wide} name={e.title ?? 'An event'} onPress={onOpen} thumb={<EventThumb e={e} width={CARD_W} height={CARD_H} fill={wide} />}>
      <View style={styles.cardFoot}>
        <Text style={styles.eventMeta} numberOfLines={1}>{eventMeta(e, mixed)}</Text>
        {e.reviews ? <Crowd rating={e.rating} count={e.reviews} /> : null}
      </View>
    </MediaCard>
  );
}

/** The Events near you lane (G1): first under Activities, and absent when nothing is near. */
export function EventLane({ title = 'Events near you', events, onAll, onOpen }: { title?: string; events: EventNear[]; onAll: () => void; onOpen: (e: EventNear) => void }) {
  if (!events.length) return null;
  return (
    <View style={styles.section}>
      <SectionHead title={title} count={events.length} onAll={onAll} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
        {events.slice(0, 8).map((e) => <EventCard key={e.id} e={e} onOpen={() => onOpen(e)} />)}
      </ScrollView>
    </View>
  );
}

/** Inside a drawer: the same card, the width of the screen, rule-separated. */
export function CardWide({ item, crowd, travel, onOpen }: { item: InspireItem; crowd?: Crowd; travel?: Travel; onOpen: () => void }) {
  const price = priceMarks(item.priceLevel);
  return (
    <MediaCard wide name={item.name} onPress={onOpen} thumb={<PlaceThumb item={item} fill />}>
      {/* Drive left, crowd right, on one line; a price takes its own row below
          when there is one (owner, 1 Oct 2026). */}
      <View style={styles.cardFoot}>
        <Journey item={item} travel={travel} />
        {crowd ? <Crowd rating={crowd.rating} count={crowd.ratingCount} empty={crowd.known ? 'No ratings yet' : null} /> : null}
      </View>
      {item.closed?.status === 'temporarily_closed' ? <Text style={styles.tempClosed}>Temporarily closed</Text> : null}
      {price ? <Text style={styles.price}>{price}</Text> : null}
    </MediaCard>
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
      {item.closed?.status === 'temporarily_closed'
        ? <Text style={styles.tempClosed}>Temporarily closed</Text>
        : status ? <Text style={[styles.status, { color: status.open ? colors.accent : colors.inkMuted }]}>{status.text}</Text> : null}
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
  // A temporarily closed place stays in the list, said in ink (owner, 29 Sep 2026).
  kindTag: { position: 'absolute', left: 10, top: 10, backgroundColor: CREAM, color: INK, fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.33, paddingVertical: 4, paddingHorizontal: 8 },
  eventBadge: { position: 'absolute', left: 10, bottom: 10, color: INK, fontFamily: fonts.body, fontSize: 11.5, fontWeight: '800', paddingVertical: 4, paddingHorizontal: 8 },
  eventMeta: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 12.5, color: colors.inkMuted },
  tempClosed: { fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: colors.ink },
  section: { gap: spacing.md },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: GUTTER },
  sectionLeft: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexShrink: 1 },
  sectionTitle: { fontFamily: fonts.heading, fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  sectionCount: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.inkMuted },
  seeAll: { fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600', color: colors.accent },
  allLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  carousel: { gap: 12, paddingHorizontal: GUTTER },
  card: { width: CARD_W, gap: 7 },
  cardName: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', lineHeight: 18, color: colors.ink },
  cardNameMuted: { fontStyle: 'italic', color: colors.inkMuted },
  // The one whose drawer is open: moss, the same green a selected category uses.
  cardNameOn: { color: colors.accent },
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
