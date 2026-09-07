import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Lockup } from './Wordmark';
import { colors, LIME, INK } from '../theme';

/**
 * The brand introducing itself: the primary lockup from the Epic pack §06 —
 * the wordmark, a 2px rule, "Seize the day" — on the lime field.
 *
 * This replaces Roam's animated heart-pulse mark, which is retired along with
 * the rest of the old guidelines (owner, 7 Sep 2026). Nothing here is an image
 * file: the mark is drawn live, so it is sharp at any size and takes the
 * palette rather than a baked-in colour. Square corners, no shadow (pack §07).
 */
export const BRAND_GROUND = LIME;

export function Brand({ height = 56, ground = BRAND_GROUND }: { height?: number; ground?: string }) {
  // The letters and the pin are always the ground's opposite: ink on lime and
  // on cream, lime on ink. Cream on lime is never allowed.
  const ink = ground === INK ? colors.lime : colors.ink;
  return (
    <View style={[styles.frame, { backgroundColor: ground, padding: Math.round(height * 0.3) }]}>
      <Lockup height={height} ink={ink} ground={ground} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignSelf: 'flex-start', borderRadius: 0 },
});
