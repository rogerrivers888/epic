/**
 * The pieces every hosting screen shares (Events & Hosts canvases, 12 Sep 2026).
 *
 * The brief's rules live here once so the cards, the profile, the wizard and
 * the dashboard cannot drift apart:
 *
 *   * A host's **type** is a chip of words — Practitioner lime/ink, Local lime
 *     tint/deep green, Guide ink/cream — and is never an icon, a sort order or
 *     a price band. It is a positioning axis, not a quality ladder.
 *   * **Trust** is a separate three-rung ladder drawn as a shield: Verified
 *     (grey), Checked (lime), Epic Trusted (ink ground, lime glyph). "New on
 *     Epic" is Verified with no reviews — never an empty star row.
 *   * The **shape** changes the meta line and nothing else about a card.
 *   * The **video** is the hero: full bleed, muted, tap to unmute, the play
 *     target dead centre. Never behind an avatar.
 *
 * Everything here reads its colour from the theme; there is no hex in a screen.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, Text, TextInput, View, ViewStyle } from 'react-native';
import { Press } from './press';
import { API_URL, Experience, HostType, LocalKind, OfferShape, OfferState, PublicHost, Standing, TrustLevel, OfferVenue } from '../api';
import { colors, fonts, spacing, TARGET, type, BORDER, INK, LIME, CREAM, LIME_TINT, MOSS } from '../theme';
import { Icon, IconName } from './Icon';

// ---------------------------------------------------------------------------
// words
// ---------------------------------------------------------------------------

export const money = (p?: number | null) => (p == null ? '—' : p === 0 ? 'Free' : `£${(p / 100).toLocaleString('en-GB', { minimumFractionDigits: p % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`);
export const dayShort = (iso?: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '');
export const dayLong = (iso?: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : '');
export const dateOnly = (iso?: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
export const weekdayName = (n: number) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][n] ?? '';
export const durationWords = (min?: number | null) => {
  if (!min) return null;
  const h = Math.floor(min / 60); const m = min % 60;
  return h ? (m ? `${h} h ${m}` : `${h} h`) : `${m} min`;
};
/** A stored media address becomes an absolute one: the API is on another origin. */
export const mediaUrl = (path?: string | null) => (path ? (path.startsWith('http') ? path : `${API_URL}${path}`) : null);

export const TYPE_LABEL: Record<HostType, string> = { practitioner: 'Practitioner', local: 'Local', guide: 'Guide' };
export const LOCAL_LABEL: Record<LocalKind, string> = { family: 'Family', something_you_do: 'Something you do', night_out: 'Night out', neighbourhood: 'Neighbourhood' };
export const SHAPE_LABEL: Record<OfferShape, string> = { oneoff: 'One-off', series: 'Series', anytime: 'Anytime' };
export const SHAPE_ICON: Record<OfferShape, IconName> = { oneoff: 'oneoff', series: 'series', anytime: 'anytime' };
export const STATE_LABEL: Record<OfferState, string> = { draft: 'Draft', in_review: 'In review', live: 'Live', paused: 'Paused', ended: 'Ended' };
export const VENUE_LABEL: Record<OfferVenue, string> = { their_place: 'Their place', your_place: 'Your place', out_about: 'Out and about', online: 'Online' };
export const VENUE_ICON: Record<OfferVenue, IconName> = { their_place: 'theirPlace', your_place: 'yourPlace', out_about: 'outAbout', online: 'online' };
export const TRUST_LABEL: Record<TrustLevel, string> = { verified: 'Verified', checked: 'Checked', trusted: 'Epic Trusted' };
export const REFUND_WORDS = { '24h': 'Full refund up to 24 hours before', '7d': 'Full refund up to 7 days before', none: 'No refunds' } as const;

/** "her studio" / "out and about" / "online" — the venue in a meta line, in the host's own area words where there are any. */
export function venueWords(o: Pick<Experience, 'venue' | 'venueArea' | 'venueLabel'>): string {
  if (o.venue === 'online') return 'online';
  if (o.venue === 'their_place') return o.venueArea ? `their place, ${o.venueArea}` : 'their place';
  if (o.venue === 'your_place') return 'at yours';
  return o.venueArea ?? o.venueLabel ?? 'out and about';
}

/** The one line under a title that changes by shape (H3). */
export function metaLine(o: Experience): string {
  const dur = durationWords(o.durationMin);
  if (o.shape === 'oneoff') return [o.startsOn ? dayShort(o.startsOn) : 'Date to come', o.startsAt, dur, venueWords(o)].filter(Boolean).join(' · ');
  if (o.shape === 'series') return [o.firstDate ? `From ${dateOnly(o.firstDate)}` : 'Dates to come', o.startsAt, o.sessions ? `${o.sessions} weeks` : null, venueWords(o)].filter(Boolean).join(' · ');
  return ['Book a slot', dur, venueWords(o)].filter(Boolean).join(' · ');
}

/** "£42 each" · "£150 the run" · "£80" · "Free". */
export function priceWords(o: Experience): string {
  if (o.priceMode === 'free' || o.price.pence === 0) return 'Free';
  if (o.shape === 'series') return `${money(o.pricePence)} the run`;
  if (o.priceMode === 'by_numbers') return `about ${money(o.price.each)} each`;
  return `${money(o.pricePence)}${o.per === 'household' ? ' a household' : ' each'}`;
}

/** "9 of 12 in" · "4 in · needs 5" · "Usually within a week". */
export function inWords(o: Experience): string {
  const st = o.standing;
  if (o.shape === 'anytime') return o.slots.length ? `${o.slots.reduce((n, d) => n + d.times.length, 0)} slots this fortnight` : 'Ask about a time';
  if (st.maximum) return `${st.heads} of ${st.maximum} in`;
  if (st.minimum && st.heads < st.minimum) return `${st.heads} in · needs ${st.minimum}`;
  return `${st.heads} in`;
}

// ---------------------------------------------------------------------------
// chips and badges
// ---------------------------------------------------------------------------

/** A host's type: words on a coloured square, never ranked. Ink on lime, deep green on tint, cream on ink. */
export function TypeChip({ type, localKind, small }: { type: HostType; localKind?: LocalKind | null; small?: boolean }) {
  const look = type === 'practitioner' ? { bg: LIME, fg: INK } : type === 'local' ? { bg: LIME_TINT, fg: MOSS } : { bg: INK, fg: CREAM };
  const label = type === 'local' && localKind ? `${TYPE_LABEL.local} · ${LOCAL_LABEL[localKind]}` : TYPE_LABEL[type];
  return (
    <View style={[styles.chip, { backgroundColor: look.bg }, small && styles.chipSmall]}>
      <Text style={[styles.chipText, { color: look.fg }, small && styles.chipTextSmall]}>{label.toUpperCase()}</Text>
    </View>
  );
}

/** The shape, in the same small caps, on a cream square with an ink rule. */
export function ShapeChip({ shape, small }: { shape: OfferShape; small?: boolean }) {
  return (
    <View style={[styles.chip, styles.chipOutline, small && styles.chipSmall]}>
      <Icon name={SHAPE_ICON[shape]} size={small ? 10 : 12} color={colors.ink} />
      <Text style={[styles.chipText, { color: colors.ink }, small && styles.chipTextSmall]}>{SHAPE_LABEL[shape].toUpperCase()}</Text>
    </View>
  );
}

/** Draft · In review · Live · Paused. Paused is not gone: the card greys, this says when it is back. */
export function StateChip({ state, pausedUntil }: { state: OfferState; pausedUntil?: string | null }) {
  const bg = state === 'live' ? colors.selected : state === 'in_review' ? colors.warm : colors.surface;
  const fg = state === 'live' ? colors.selectedFg : colors.inkMuted;
  const label = state === 'paused' && pausedUntil ? `Paused · back ${dateOnly(pausedUntil)}` : STATE_LABEL[state];
  return (
    <View style={[styles.chip, { backgroundColor: bg }, state !== 'live' && styles.chipOutlineSoft]}>
      <Text style={[styles.chipText, { color: fg }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

/**
 * The trust ladder as a badge. Verified: grey shield. Checked: lime shield.
 * Epic Trusted: an ink square with a lime glyph. A new host with checks still
 * running says so beside it — never an empty star row, never "untrusted".
 */
export function TrustBadge({ trust, checks = 'passed', onPress, wide }: { trust: TrustLevel; checks?: 'running' | 'passed'; onPress?: () => void; wide?: boolean }) {
  const running = checks === 'running';
  const look = running
    ? { bg: colors.warm, fg: colors.inkMuted, icon: 'verified' as IconName, label: 'Checks running' }
    : trust === 'trusted' ? { bg: INK, fg: LIME, icon: 'trusted' as IconName, label: TRUST_LABEL.trusted }
      : trust === 'checked' ? { bg: LIME_TINT, fg: MOSS, icon: 'checked' as IconName, label: TRUST_LABEL.checked }
        : { bg: colors.warm, fg: colors.inkMuted, icon: 'verified' as IconName, label: TRUST_LABEL.verified };
  const body = (
    <View style={[styles.chip, { backgroundColor: look.bg }, wide && { paddingHorizontal: 10 }]}>
      <Icon name={look.icon} size={12} color={look.fg} strokeWidth={2.2} />
      <Text style={[styles.chipText, { color: look.fg }]}>{look.label.toUpperCase()}</Text>
    </View>
  );
  if (!onPress) return body;
  return <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={`${look.label}: what it means`}>{body}</Press>;
}

export function NewOnEpic() {
  return (
    <View style={[styles.chip, styles.chipOutline]}>
      <Text style={[styles.chipText, { color: colors.ink }]}>NEW ON EPIC</Text>
    </View>
  );
}

/** The host's face: their photograph, or their initial on the lime tint. A person is a circle. */
export function HostFace({ host, size = 40, ring }: { host: Pick<PublicHost, 'name' | 'photo'>; size?: number; ring?: boolean }) {
  const url = mediaUrl(host.photo);
  const base = { width: size, height: size, borderRadius: size / 2 };
  if (url) return <Image source={{ uri: url }} style={[base, ring ? styles.faceRing : null]} accessibilityLabel={host.name} />;
  return (
    <View style={[base, styles.face, ring && styles.faceRing]} accessibilityLabel={host.name}>
      <Text style={{ fontFamily: fonts.heading, fontWeight: '800', fontSize: size * 0.4, color: colors.ink }}>{host.name.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

/** ★ 4.9 · 38 reviews, or the honest line for somebody new. */
export function RatingLine({ host, guests }: { host: Pick<PublicHost, 'rating' | 'reviewCount' | 'isNew' | 'since' | 'guests'>; guests?: boolean }) {
  if (host.isNew || host.rating == null) {
    const month = host.since ? new Date(host.since).toLocaleDateString('en-GB', { month: 'long' }) : null;
    return <Text style={type.small}>No reviews yet{month ? ` — joined in ${month}` : ''}. Be the first to go.</Text>;
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Icon name="favourite" size={13} color={colors.ink} fill />
      <Text style={[type.small, { color: colors.ink, fontWeight: '700' }]}>{host.rating.toFixed(1)}</Text>
      <Text style={type.small}>· {host.reviewCount} review{host.reviewCount === 1 ? '' : 's'}{guests && host.guests ? ` · ${host.guests} guests` : ''}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// video
// ---------------------------------------------------------------------------

/**
 * The hero. Full bleed, autoplay muted, tap to unmute; the play target sits
 * dead centre until it plays. On the web this is the browser's own `<video>`
 * — react-native-web has none — and elsewhere it is the poster with a play
 * badge, because a native player is not in this bundle.
 */
export function VideoHero({ src, poster, height = 260, label, badge, badgeInset = 0, madeByEpic, onEmpty }: {
  src: string | null; poster?: string | null; height?: number; label?: string | null;
  /** Something laid over the top-left corner — the type and trust chips. */
  badge?: React.ReactNode;
  /** How far in from the left the chips start, so a back button over the hero does not sit on them. */
  badgeInset?: number;
  madeByEpic?: boolean;
  /** Drawn when there is no video yet: the wizard's "record one" prompt. */
  onEmpty?: React.ReactNode;
}) {
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const ref = useRef<any>(null);
  const url = mediaUrl(src);
  const posterUrl = mediaUrl(poster ?? null);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (!playing) { v.muted = false; setMuted(false); void v.play?.(); setPlaying(true); return; }
    v.muted = !v.muted; setMuted(v.muted);
  };

  return (
    <View style={[styles.hero, { height }]}>
      {url && Platform.OS === 'web' ? (
        React.createElement('video', {
          ref, src: url, poster: posterUrl ?? undefined, muted: true, autoPlay: true, loop: true, playsInline: true, preload: 'metadata',
          onPlay: () => setPlaying(true), onPause: () => setPlaying(false),
          style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', background: INK },
        })
      ) : posterUrl ? (
        <Image source={{ uri: posterUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center' }]}>
          {onEmpty ?? <Icon name="video" size={28} color={colors.inkMuted} />}
        </View>
      )}
      {badge ? <View style={[styles.heroBadge, badgeInset ? { left: spacing.md + badgeInset, right: 56 } : null]}>{badge}</View> : null}
      {url ? (
        <Press onPress={toggle} style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel={muted ? 'Play with sound' : 'Mute'}>
          <View style={styles.playWrap}>
            <View style={[styles.play, !muted && playing && styles.playQuiet]}>
              <Icon name={muted ? 'resume' : 'mic'} size={22} color={INK} fill={muted} />
            </View>
          </View>
        </Press>
      ) : null}
      {url && label ? (
        <View style={styles.heroLabel}><Text style={styles.heroLabelText}>{label}{muted ? ' · tap for sound' : ''}</Text></View>
      ) : null}
      {madeByEpic ? <View style={styles.madeBy}><Text style={styles.madeByText}>Made with Epic</Text></View> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// the group set-up's numbers panel and price row, reused verbatim
// ---------------------------------------------------------------------------

/** A number is typed, never nudged (owner, 4 Sep 2026). The group set-up's box. */
export function NumberBox({ value, onChange, onCommit, onFocus, placeholder, width = 84, prefix }: {
  value: string; onChange: (v: string) => void; onCommit?: () => void; onFocus?: () => void; placeholder?: string; width?: number; prefix?: string;
}) {
  const [on, setOn] = useState(false);
  return (
    <View style={[styles.numberBox, { width }, on && styles.numberBoxOn]}>
      {prefix ? <Text style={[type.small, { color: colors.inkMuted }]}>{prefix}</Text> : null}
      <TextInput
        value={value} onChangeText={onChange}
        onFocus={() => { setOn(true); onFocus?.(); }} onBlur={() => { setOn(false); onCommit?.(); }} onSubmitEditing={onCommit}
        placeholder={placeholder} placeholderTextColor={colors.inkFaint} keyboardType="number-pad" returnKeyType="done" selectTextOnFocus
        style={styles.numberInput}
      />
    </View>
  );
}

/**
 * "Under 6 and it is called off — everybody is told and nothing is taken. At 12
 * it is full. You see £108 at 6, £180 at 10 — before Epic's fee." The three
 * facts under the three numbers, worked through with this offer's own price.
 */
export function SizePanel({ min, expected, max, priceMode, pricePence, totalPence, at }: {
  min: number | null; expected: number | null; max: number | null; priceMode: string; pricePence: number | null; totalPence: number | null; at?: string | null;
}) {
  const take = (n: number | null) => (!n ? null : priceMode === 'same_each' && pricePence ? pricePence * n : priceMode === 'by_numbers' && totalPence ? totalPence : null);
  const lines: { on: boolean; text: React.ReactNode }[] = [
    { on: at === 'minimum', text: min ? <><Text style={styles.strong}>Under {min}</Text> and it is called off — everybody is told and nothing is taken.</> : <><Text style={styles.strong}>No minimum:</Text> it runs whoever books.</> },
    { on: at === 'maximum', text: max ? <><Text style={styles.strong}>At {max}</Text> it is full: the page stops taking bookings.</> : <><Text style={styles.strong}>No maximum:</Text> the page keeps taking bookings.</> },
  ];
  if (priceMode !== 'free' && (take(min) || take(expected))) {
    lines.push({
      on: at === 'expecting',
      text: priceMode === 'by_numbers'
        ? <>Everyone splits <Text style={styles.strong}>{money(totalPence)}</Text>: <Text style={styles.strong}>{money(Math.ceil((totalPence ?? 0) / Math.max(1, expected ?? min ?? 1)))} each</Text> at {expected ?? min}, never more than {money(Math.ceil((totalPence ?? 0) / Math.max(1, min ?? 1)))}.</>
        : <>You see <Text style={styles.strong}>{money(take(min))} at {min}</Text>{expected ? <>, <Text style={styles.strong}>{money(take(expected))} at {expected}</Text></> : null} — before Epic's fee.</>,
    });
  }
  return (
    <View style={styles.panel}>
      {lines.map((l, i) => <Text key={i} style={[type.small, l.on && { color: colors.ink }]}>{l.text}</Text>)}
    </View>
  );
}

/** A grey 11px kicker above a group, as the canvases draw one. */
export function Kicker({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <Text style={[styles.kicker, style as any]}>{children}</Text>;
}

/** A row that is a link: label, value, chevron. */
export function LinkRow({ label, value, onPress, icon, tone }: { label: string; value?: string | null; onPress?: () => void; icon?: IconName; tone?: 'danger' }) {
  const body = (
    <View style={styles.linkRow}>
      {icon ? <Icon name={icon} size={16} color={tone === 'danger' ? colors.overrun : colors.ink} /> : null}
      <Text style={[type.body, { flex: 1 }, tone === 'danger' && { color: colors.overrun }]}>{label}</Text>
      {value ? <Text style={[type.small, { color: colors.ink }]} numberOfLines={1}>{value}</Text> : null}
      {onPress ? <Icon name="more" size={16} color={colors.inkMuted} /> : null}
    </View>
  );
  return onPress ? <Press onPress={onPress} accessibilityRole="button">{body}</Press> : body;
}

// ---------------------------------------------------------------------------
// the card (H3): shape chip and type chip top-left, face bottom-left, title,
// the meta line that changes by shape, price, how many are in.
// ---------------------------------------------------------------------------

export function ExperienceCard({ item, onOpen, width }: { item: Experience; onOpen: () => void; width?: number }) {
  const poster = item.photos[0] ?? item.host?.photo ?? null;
  const paused = item.state === 'paused';
  return (
    <Press onPress={onOpen} accessibilityRole="button" accessibilityLabel={item.title ?? 'An experience'} style={[styles.card, width ? { width } : null, paused && { opacity: 0.7 }]}>
      <View style={styles.cardMedia}>
        {mediaUrl(poster) ? <Image source={{ uri: mediaUrl(poster)! }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.warm }]} />}
        <View style={styles.cardChips}>
          <ShapeChip shape={item.shape} small />
          {item.host ? <TypeChip type={item.host.type} small /> : null}
        </View>
        {item.host ? <View style={styles.cardFace}><HostFace host={item.host} size={36} ring /></View> : null}
        {item.video ? <View style={styles.cardPlay}><Icon name="resume" size={14} color={INK} fill /></View> : null}
      </View>
      <View style={{ gap: 3, paddingTop: spacing.sm }}>
        <Text style={styles.cardTitle} numberOfLines={2}>{item.title ?? 'Untitled'}</Text>
        <Text style={type.small} numberOfLines={1}>{paused && item.pausedUntil ? `Paused · back ${dateOnly(item.pausedUntil)}` : metaLine(item)}</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text style={[type.h3, { fontWeight: '700' }]}>{priceWords(item)}</Text>
          <Text style={type.small}>{inWords(item)}</Text>
        </View>
      </View>
    </Press>
  );
}

/** A row in a host's offer menu (B1): the card as a line, with its own play badge and state. */
export function OfferRow({ item, onPress, own }: { item: Experience & { state: OfferState; pausedUntil: string | null }; onPress: () => void; own?: { booked?: number; inReview?: boolean } }) {
  const dim = item.state === 'paused';
  return (
    <Press onPress={onPress} accessibilityRole="button" style={[styles.offerRow, dim && { opacity: 0.7 }]}>
      <View style={styles.offerThumb}>
        {mediaUrl(item.photos[0]) ? <Image source={{ uri: mediaUrl(item.photos[0])! }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <Icon name={SHAPE_ICON[item.shape]} size={18} color={colors.inkMuted} />}
        {item.video ? <View style={styles.offerPlay}><Icon name="resume" size={10} color={INK} fill /></View> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <ShapeChip shape={item.shape} small />
          {own ? <StateChip state={item.state} pausedUntil={item.pausedUntil} /> : null}
        </View>
        <Text style={[type.h3, { fontWeight: '600' }]} numberOfLines={2}>{item.title ?? 'Untitled'}</Text>
        <Text style={type.small} numberOfLines={1}>{item.whyYou && !own ? item.whyYou : metaLine(item)}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 3 }}>
        <Text style={[type.h3, { fontWeight: '700' }]}>{priceWords(item) === 'Free' ? 'Free' : money(item.shape === 'series' ? item.pricePence : item.price.each)}</Text>
        <Text style={type.tiny}>{own ? (item.state === 'in_review' ? 'Reading your pitch' : item.state === 'paused' && item.pausedUntil ? `Back ${dateOnly(item.pausedUntil)}` : own.booked != null ? `${own.booked} booked` : '') : inWords(item)}</Text>
      </View>
    </Press>
  );
}

/** How far along the minimum is: a two-tone bar, min · expecting · max marked (D1). */
export function StandingBar({ standing }: { standing: Standing }) {
  const max = standing.maximum ?? Math.max(standing.expected ?? 0, standing.heads, standing.minimum ?? 0, 1);
  const pct = (n: number) => `${Math.min(100, Math.round((n / max) * 100))}%`;
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: pct(standing.heads) as any }]} />
        {standing.minimum ? <View style={[styles.mark, { left: pct(standing.minimum) as any }]} /> : null}
        {standing.expected ? <View style={[styles.mark, styles.markSoft, { left: pct(standing.expected) as any }]} /> : null}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={type.tiny}>min {standing.minimum ?? '—'}{standing.minimumMet && standing.minimum ? ' ✓' : ''}</Text>
        <Text style={type.tiny}>expecting {standing.expected ?? '—'}</Text>
        <Text style={type.tiny}>max {standing.maximum ?? '—'}</Text>
      </View>
    </View>
  );
}

/** The consequence line under a booking count: "Needs 6 · 9 are in, 3 places left". */
export function needsLine(o: Experience): string | null {
  const st = o.standing;
  if (o.shape === 'anytime') return null;
  const bits: string[] = [];
  if (st.minimum) bits.push(`Needs ${st.minimum}`);
  bits.push(`${st.heads} ${st.heads === 1 ? 'is' : 'are'} in`);
  if (st.placesLeft != null) bits.push(st.full ? 'full' : `${st.placesLeft} place${st.placesLeft === 1 ? '' : 's'} left`);
  return bits.join(' · ');
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, height: 20, alignSelf: 'flex-start' },
  chipSmall: { height: 18, paddingHorizontal: 6 },
  chipOutline: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.ink },
  chipOutlineSoft: { borderWidth: 1, borderColor: colors.ruleSoft },
  chipText: { fontFamily: fonts.body, fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
  chipTextSmall: { fontSize: 9 },
  face: { backgroundColor: LIME_TINT, alignItems: 'center', justifyContent: 'center' },
  faceRing: { borderWidth: 2, borderColor: colors.surface },
  hero: { width: '100%', backgroundColor: INK, overflow: 'hidden', position: 'relative' },
  heroBadge: { position: 'absolute', top: spacing.md, left: spacing.md, flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  playWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  play: { width: 56, height: 56, borderRadius: 28, backgroundColor: LIME, alignItems: 'center', justifyContent: 'center' },
  playQuiet: { opacity: 0.35 },
  heroLabel: { position: 'absolute', left: spacing.md, bottom: spacing.md, backgroundColor: 'rgba(32,30,29,0.72)', paddingHorizontal: 8, paddingVertical: 4 },
  heroLabelText: { fontFamily: fonts.body, fontSize: 11, fontWeight: '600', color: CREAM },
  madeBy: { position: 'absolute', right: spacing.md, bottom: spacing.md, backgroundColor: 'rgba(32,30,29,0.72)', paddingHorizontal: 8, paddingVertical: 4 },
  madeByText: { fontFamily: fonts.body, fontSize: 10, fontWeight: '600', color: CREAM, letterSpacing: 0.4 },
  numberBox: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: TARGET, paddingHorizontal: spacing.sm, borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface },
  numberBoxOn: { borderColor: colors.accent },
  numberInput: { flex: 1, minWidth: 0, fontFamily: fonts.heading, fontSize: 20, fontWeight: '800', color: colors.ink, textAlign: 'center', outlineStyle: 'none' as any },
  panel: { backgroundColor: colors.surfaceMuted, padding: spacing.md, gap: 6 },
  strong: { fontWeight: '700', color: colors.ink },
  kicker: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.66, textTransform: 'uppercase', color: colors.inkMuted },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: TARGET, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  card: { width: '100%' },
  cardMedia: { width: '100%', aspectRatio: 3 / 2, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.warm, position: 'relative' },
  cardChips: { position: 'absolute', top: 8, left: 8, flexDirection: 'row', gap: 4 },
  cardFace: { position: 'absolute', left: 8, bottom: 8 },
  cardPlay: { position: 'absolute', right: 8, bottom: 8, width: 26, height: 26, borderRadius: 13, backgroundColor: LIME, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: colors.ink, lineHeight: 20 },
  offerRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  offerThumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' },
  offerPlay: { position: 'absolute', right: 4, bottom: 4, width: 18, height: 18, borderRadius: 9, backgroundColor: LIME, alignItems: 'center', justifyContent: 'center' },
  track: { height: 10, backgroundColor: colors.lineSoft, position: 'relative', overflow: 'visible' },
  fill: { height: 10, backgroundColor: LIME },
  mark: { position: 'absolute', top: -3, width: 2, height: 16, backgroundColor: colors.ink },
  markSoft: { backgroundColor: colors.decor },
});
