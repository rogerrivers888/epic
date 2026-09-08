import React, { useState } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { hasFlag } from 'country-flag-icons';
import { colors, fonts, radius as r, BORDER } from '../theme';

/**
 * A country's flag.
 *
 * The artwork is `country-flag-icons` (MIT; the flags are public-domain
 * drawings from Wikimedia), which is the whole of ISO 3166-1 and is maintained
 * — no sprite sheet to license, and no emoji, which render as two letters on
 * Windows and are forbidden as icons anyway.
 *
 * The library is imported for one thing only: `hasFlag`, so a code we have no
 * drawing for shows the code rather than a broken picture. The SVGs themselves
 * are served as static files (`apps/web/scripts/flags.mjs` copies them into
 * `public/flags`), so a screen showing Italy fetches Italy, not 1.3 MB of every
 * country there is.
 *
 * If the copy has not run, or a fetch fails, or this is a native build with no
 * static origin to fetch from, the tile falls back to the two-letter code —
 * which is what every country row drew before the flags arrived.
 */
export function Flag({ code, width = 44, height = 32, rounded = r.sm, bare }: {
  code: string;
  width?: number;
  height?: number;
  rounded?: number;
  /**
   * The Places rows (handover v8, option F-B): "36×24 flat rectangular flag
   * artwork with a hairline edge, bare (no grey box)". No ink rule, no tint —
   * a hairline is the only thing that stops a white stripe vanishing into cream.
   */
  bare?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const cc = (code || '').trim().toUpperCase();
  // "UK" is what people type; ISO 3166-1 calls it GB, and so does the artwork.
  const iso = cc === 'UK' ? 'GB' : cc;
  const drawn = Platform.OS === 'web' && !failed && iso.length === 2 && hasFlag(iso);

  return (
    <View style={[styles.tile, bare && styles.bare, { width, height, borderRadius: rounded }]}>
      {drawn ? (
        <Image
          source={{ uri: `/flags/${iso}.svg` }}
          style={{ width, height }}
          resizeMode="cover"
          onError={() => setFailed(true)}
          accessibilityLabel={`Flag of ${iso}`}
        />
      ) : (
        <Text style={styles.code}>{cc}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderWidth: BORDER,
    borderColor: colors.line,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  bare: { borderWidth: 0, backgroundColor: 'transparent', boxShadow: '0 0 0 1px rgba(32,30,29,0.14)' },
  code: { fontFamily: fonts.heading, fontSize: 11, fontWeight: '700', letterSpacing: 0.66, color: colors.headerSub },
});
