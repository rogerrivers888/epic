import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { API_URL, VenuePhotoRef } from '../api';
import { colors, type } from '../theme';
import { MEDIA_RADIUS, PHOTO_W } from './VenueThumb';

/**
 * A place's photo, fetched through the API so the provider key never reaches
 * the browser and each fetch is attributed (Technical Constraints §13.7).
 * Google's licence requires the photographer's credit to be shown with the
 * image, so it sits under the thumbnail rather than in a tooltip.
 * Renders nothing when the source has no photo (OpenStreetMap never does).
 */
export function VenuePhoto({ photos, size = 72, height, credit = true }: { photos?: VenuePhotoRef[] | null; size?: number; height?: number; credit?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const photo = photos?.[0];
  // A picture that has not arrived in a few seconds is not coming: show nothing
  // rather than an empty tile (owner, 4 Sep 2026).
  useEffect(() => {
    if (ready || failed) return;
    const t = setTimeout(() => setFailed(true), 6000);
    return () => clearTimeout(t);
  }, [ready, failed, photo?.ref, photo?.url]);
  if (!photo || failed) return null;
  const uri = photo.url ?? (photo.ref ? `${API_URL}/api/photos/google?name=${encodeURIComponent(photo.ref)}&w=${PHOTO_W}` : null);
  if (!uri) return null;
  return (
    <View style={{ width: size, gap: 2 }}>
      <Image source={{ uri }} style={[styles.img, { width: size, height: height ?? size }]} onError={() => setFailed(true)} onLoad={() => setReady(true)} accessibilityIgnoresInvertColors />
      {credit && photo.attribution ? <Text style={[type.tiny, styles.credit]} numberOfLines={1}>{photo.attribution}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The one radius every photograph wears (VenueThumb). `radius.md` is nought
  // in Epic, which is why these were square.
  img: { borderRadius: MEDIA_RADIUS, backgroundColor: colors.surfaceMuted },
  credit: { fontSize: 10, color: colors.inkMuted },
});
