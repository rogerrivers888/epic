import React from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { Press } from './press';
import { Icon } from './Icon';
import { Wordmark } from './Wordmark';
import { LIME, INK, CREAM, MIC_TILE, DEEP_GREEN, fonts } from '../theme';
import { TOP_INSET } from './InspireHeader';

/**
 * The lime band (New navigation, owner 30 Sep 2026, §2–§4). One of two shapes
 * sits at the top of almost every screen, and lime is the header and nothing
 * else — nothing below the band is ever lime again.
 *
 * The band takes the status bar into itself: the lime runs from the very top of
 * the screen, so its ground is padded by the safe-area inset (`TOP_INSET`, the
 * same one every own-header screen already uses) and the OS draws its ink
 * glyphs over the lime. The mockup's painted "9:41" is that real status bar.
 */

/**
 * The band's right-hand control (§4): a 44×44 tile one step darker than the
 * band, no border and no radius, with the mic glyph in ink. Never a solid ink
 * box — that competed with the wordmark. Tapping it opens the voice screen
 * scoped to wherever it was tapped.
 */
export function MicTile({ onPress, accessibilityLabel = 'Speak' }: { onPress: () => void; accessibilityLabel?: string }) {
  return (
    <Press onPress={onPress} style={styles.mic} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
      <Icon name="mic" size={22} color={INK} strokeWidth={2.2} />
    </Press>
  );
}

/**
 * Plans' messages tile (guest handoff G14, 4c): the mic tile's twin, beside it,
 * with the unread count as a small ink square in its top-right corner — none
 * when nothing is unread. It opens Messages.
 */
export function MessagesTile({ unread, onPress }: { unread: number; onPress: () => void }) {
  return (
    <Press onPress={onPress} style={styles.mic} accessibilityRole="button" accessibilityLabel={unread ? `Messages, ${unread} unread` : 'Messages'}>
      <Icon name="message" size={22} color={INK} strokeWidth={2.2} />
      {unread > 0 ? (
        <View style={styles.count}><Text style={styles.countText}>{unread > 99 ? '99+' : String(unread)}</Text></View>
      ) : null}
    </Press>
  );
}

/**
 * Host's right-hand slot is the host's photo, not the mic (§4): a 44px circle
 * with a 2px ink ring, opening their host profile. There is no ellipsis.
 */
export function HostPhoto({ uri, onPress }: { uri?: string; onPress: () => void }) {
  return (
    <Press onPress={onPress} style={styles.photo} accessibilityRole="button" accessibilityLabel="Your host profile">
      {uri ? (
        <Image source={{ uri }} style={styles.photoImg} accessibilityIgnoresInvertColors />
      ) : (
        <View style={styles.photoImg}><Icon name="host" size={22} color={INK} strokeWidth={2} /></View>
      )}
    </Press>
  );
}

/**
 * The tall band (§2): the home of a tab. The 40px wordmark on the left and the
 * one action for that tab on the right, aligned to the wordmark's centre. No
 * title and no subtitle — the tab bar says where you are. The pin's hole is
 * filled with lime, not cream, so it reads as a hole in the band.
 */
export function TallBand({ right }: { right?: React.ReactNode }) {
  return (
    <View style={styles.tallTop}>
      <View style={styles.tallRow}>
        {/* Ink on lime in both modes (owner, 2 Oct 2026: white "Epic" was unreadable on
            Inspire, Places and Trips): the theme's ink turns cream in dark mode.
            4a–4d set the word at 40px with line-height 1, a 40px box. `Wordmark`
            sizes its type at 1.05× the height it is given and sets a 1.15 line,
            so 38 gives the design's 40px type in a 46px line; the -3 above and
            below hands back the 6px of leading so the row lays out on the
            design's 40px box and the glyphs sit where 4a draws them. */}
        <View style={styles.tallMark}>
          <Wordmark height={38} ink={INK} ground={LIME} />
        </View>
        {right ?? null}
      </View>
    </View>
  );
}

/**
 * A title band: the lime band with a 34px screen title on the left and one
 * optional action on the right (Settings revised v2 — SE1 "Settings", the Host
 * tab's "Host" + New offer). A home that names itself rather than wearing the
 * wordmark; the tab bar still sits under it. 22 above the title, 24 below.
 */
export function TitleBand({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View style={styles.tallTop}>
      <View style={styles.titleRow}>
        <Text numberOfLines={1} style={styles.bigTitle}>{title}</Text>
        {right ?? null}
      </View>
    </View>
  );
}

/**
 * The compact band (§3): everything below a home. Back, a one-line title, an
 * optional context line, and the mic. On a flow you finish (`close`) the back
 * chevron becomes a ✕ and the mic is dropped, because that screen is the mic.
 * This is the one back treatment in the app — the old "‹ Trips" link is now
 * just this band's arrow.
 */
export function CompactBand({ title, titleLines = 1, context, onBack, onClose, right }: {
  title: string;
  /** How many lines the title may take. A trip name wraps to two and is never
   *  cut off (CANONICAL, 30 Sep 2026); every other screen keeps one. */
  titleLines?: number;
  /** e.g. "Sat 20 Sep · 4 people · 3 stops". */
  context?: string;
  onBack?: () => void;
  /** A finish-flow: draws ✕ instead of back and omits the mic. */
  onClose?: () => void;
  /** The mic (or nothing). Ignored on a finish-flow. */
  right?: React.ReactNode;
}) {
  const finishing = !!onClose;
  return (
    <View style={styles.limeTop}>
      <View style={[styles.compactRow, titleLines > 1 && { alignItems: 'flex-start' }]}>
        <Press
          onPress={onClose ?? onBack ?? (() => {})}
          style={styles.lead}
          accessibilityRole="button"
          accessibilityLabel={finishing ? 'Close' : 'Back'}
        >
          <Icon name={finishing ? 'close' : 'previous'} size={26} color={INK} strokeWidth={2.4} />
        </Press>
        <View style={styles.titleWrap}>
          <Text numberOfLines={titleLines} style={styles.title}>{title}</Text>
          {context ? <Text numberOfLines={1} style={styles.context}>{context}</Text> : null}
        </View>
        {finishing ? null : right ?? null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  limeTop: { backgroundColor: LIME, paddingTop: TOP_INSET },
  // The tall band takes the status bar and nothing more: 4a–4d paint their
  // status bar into the lime and start the 22px row directly beneath it, so on
  // a phone the inset alone stands in for that painted bar. `TOP_INSET`'s extra
  // 10px put the band 10px deeper than the design (owner, 2 Oct 2026). The 16px
  // floor is unchanged, for a window that reports no inset at all.
  tallTop: { backgroundColor: LIME, paddingTop: (Platform.OS === 'web' ? 'max(16px, var(--epic-sat))' : 16) as any },
  // §2: the wordmark row, 22 above and 26 below, the control centred on it —
  // 22 + 44 (the mic, taller than the 40px word) + 26 = 92 under the status
  // bar. The floor holds that on a home with no mic (Places), so every tab's
  // band is the same depth.
  tallRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 22, paddingBottom: 26, minHeight: 92 },
  tallMark: { marginVertical: -3 },
  // Settings v2: the 34px screen title, 22 above, action on the right. Trimmed by
  // the same 14px as the tall band (owner, 2 Oct 2026): the inset without
  // TOP_INSET's extra 10 (tallTop), and 20 below instead of 24.
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 22, paddingBottom: 20 },
  bigTitle: { flex: 1, fontFamily: fonts.heading, fontWeight: '800', fontSize: 34, letterSpacing: 34 * -0.04, lineHeight: 36, color: INK },
  // §3: back · title+line · mic, 14 above and 16 below, 12 between.
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 16 },
  // A 32×44 hit area pulled 6px left so the chevron optically aligns to the gutter.
  lead: { width: 32, height: 44, alignItems: 'flex-start', justifyContent: 'center', marginLeft: -6 },
  titleWrap: { flex: 1, minWidth: 0 },
  title: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 22, letterSpacing: -22 * 0.03, lineHeight: 24, color: INK },
  context: { fontSize: 12.5, color: DEEP_GREEN, marginTop: 2 },
  mic: { width: 44, height: 44, backgroundColor: MIC_TILE, alignItems: 'center', justifyContent: 'center' },
  count: { position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, paddingHorizontal: 4, backgroundColor: INK, alignItems: 'center', justifyContent: 'center' },
  countText: { fontFamily: fonts.body, fontSize: 10, fontWeight: '800', color: CREAM, lineHeight: 12 },
  photo: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: INK, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  photoImg: { width: 40, height: 40, borderRadius: 20, backgroundColor: LIME, alignItems: 'center', justifyContent: 'center' },
});
