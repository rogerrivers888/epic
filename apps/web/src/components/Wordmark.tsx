import React from 'react';
import { Platform, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors, fonts, INK, CREAM } from '../theme';

/**
 * The Epic wordmark (brand pack v1, §01), drawn live so it sits on any ground
 * the pack allows.
 *
 * One wordmark. The pin sits where the dot of the i would be — centred on the
 * stem, its point just clear of the letter, which is why the i is set with the
 * dotless ı. The pin is always the same colour as the letters; only the hole
 * takes the background. There is no separate symbol-plus-wordmark lockup and
 * the pin never sits beside the word: the word is the logo.
 *
 * Case: camel-case "Epic" is the primary, all-lowercase "epic" the approved
 * alternate for casual, in-app moments (`lowercase`).
 *
 * Minimum height is 24px. Below that the pack says switch to the pin, so this
 * component does it for you rather than drawing an illegible word.
 */
export function Wordmark({ height = 40, ink = colors.ink, ground = colors.headerBg, lowercase = false }: {
  height?: number;
  /** The colour of the letters and of the pin — they are always the same. */
  ink?: string;
  /** The colour behind the mark; the hole in the pin takes it. */
  ground?: string;
  lowercase?: boolean;
}) {
  const fs = Math.round(height * 1.05);
  if (fs < 24) return <PinMark size={Math.max(8, height)} ink={ink} ground={ground} />;

  // The pack's geometry, in ems of the type size: the pin is 0.3em wide and
  // sits 0.07em above the line box, nudged 0.03em right of the stem's centre.
  const pin = Math.round(fs * 0.3);
  const lineHeight = Math.round(fs * 1.15);
  // A 1.15 line box centres the 1.0 box the pack measures from, so the pack's
  // -0.07em from that top lands here: (1.15 - 1) / 2 - 0.07 ≈ 0.005em.
  const top = Math.round(fs * 0.005);
  const letter = {
    fontFamily: fonts.wordmark,
    fontWeight: '800' as const,
    fontSize: fs,
    lineHeight,
    letterSpacing: -fs * 0.06,
    color: ink,
    includeFontPadding: false,
  };
  const word = lowercase ? 'epic' : 'Epic';
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'flex-start' }}
      accessibilityRole="image"
      accessibilityLabel="Epic"
      {...((Platform.OS === 'web' ? { dataSet: { font: 'wordmark' } } : {}) as object)}
    >
      <Text style={letter}>{lowercase ? 'ep' : 'Ep'}</Text>
      <View style={{ position: 'relative' }}>
        {/* U+0131, the dotless i: the pin is the dot. */}
        <Text style={letter}>{'ı'}</Text>
        <View style={{ position: 'absolute', left: '50%', top, transform: [{ translateX: -pin / 2 + fs * 0.03 }] }}>
          <Pin size={pin} ink={ink} ground={ground} />
        </View>
      </View>
      <Text style={letter}>c</Text>
    </View>
  );
}

/**
 * The pin on its own — the app icon, the favicon, the social avatar, a map
 * marker. Geometry unchanged from the pack; below 24px the hole is dropped,
 * because at that size it closes up into a smudge.
 */
export function Pin({ size = 24, ink = INK, ground = CREAM }: { size?: number; ink?: string; ground?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path d="M50 0 C26 0 8 18 8 42 C8 68 50 100 50 100 C50 100 92 68 92 42 C92 18 74 0 50 0 Z" fill={ink} />
      {size >= 24 ? <Circle cx={50} cy={40} r={15} fill={ground} /> : null}
    </Svg>
  );
}

/** The pin with the clear space the pack asks for, for use as a standalone mark. */
export function PinMark({ size = 32, ink = colors.ink, ground = colors.headerBg }: { size?: number; ink?: string; ground?: string }) {
  return (
    <View accessibilityRole="image" accessibilityLabel="Epic">
      <Pin size={size} ink={ink} ground={ground} />
    </View>
  );
}

/** "Seize the day" — the one strapline locked to the logo (pack §06). */
export const STRAPLINE = 'Seize the day';

/**
 * The primary lockup: the wordmark, a 2px rule, the strapline. Used where the
 * brand introduces itself — the lock screen, an invite, a printed ticket.
 */
export function Lockup({ height = 56, ink = colors.ink, ground = colors.headerBg }: { height?: number; ink?: string; ground?: string }) {
  return (
    <View style={{ gap: Math.round(height * 0.22), alignSelf: 'flex-start' }}>
      <Wordmark height={height} ink={ink} ground={ground} />
      <View style={{ height: 2, backgroundColor: ink }} />
      <Text style={{ fontFamily: fonts.body, fontWeight: '600', fontSize: Math.max(13, Math.round(height * 0.36)), letterSpacing: -0.2, color: ink }}>
        {STRAPLINE}
      </Text>
    </View>
  );
}
