import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Press, Zoom } from './press';
import { API_URL, OwnedImage, VenuePhotoRef } from '../api';
import { Icon, IconName, iconFor } from './Icon';
import { colors, spacing, type } from '../theme';

/**
 * The picture on a place's card.
 *
 * Owner, 5 Sep 2026, on the delivery apps having one food photo each: "We don't
 * even have logos or anything like that, so it would just be a text listing,
 * which is okay but not ideal. The only other option is to use generic images
 * (a huge bank) and just mix and match them for all the different restaurants,
 * but that's a bit misleading."
 *
 * He is right, so there is no bank of stock food here. There are four different
 * kinds of picture and a floor, and the whole point of this component is that
 * they are not drawn the same way:
 *
 *   a photograph   Commons, or a street-level frame of the shopfront. Fills the
 *                  tile, because that is what a photograph is for.
 *   a logo         The business's own mark. *Contained*, with room around it, on
 *                  the lime ground. Cropping a 180px square logo to fill a 240×180
 *                  tile turns a wordmark into an abstract smear, which is worse
 *                  than no picture at all.
 *   a rented photo A provider's, fetched at display time and never stored
 *                  (Technical Constraints §4). Fills the tile, credited.
 *   the floor      No picture. The category icon on the one lime ground, the
 *                  same as everywhere else in Epic.
 *
 * The floor is honest by construction: nobody reads an icon on a lime square as
 * a photograph of that restaurant's food. That is exactly what a bank of stock
 * food photography could not promise.
 *
 * A note on what was tried and dropped (5 Sep 2026). The first version varied
 * the empty tile's ground across four tones hashed from the venue_ref, so a
 * shelf of twelve would not read as twelve identical boxes. It does not survive
 * this palette: `surfaceMuted`, `accentSoft` and `well` are the same value in
 * light mode and again in dark, so "four tones" was in fact one tone and one
 * bright lime, and every fourth row lit up for no reason a household could
 * explain. The style guide has one lime and says there is no colour-coding of
 * rows; inventing a second step to get around that would be arguing with it.
 * So the distinguishing is left to the picture, and the answer to a shelf of
 * identical tiles is to find more pictures, not to tint the empties.
 *
 * `credit` is drawn whenever the licence requires it. That is a condition of
 * being allowed to show the picture, not a nicety, so it lives here rather than
 * in each caller.
 */

export type VenueThumbProps = {
  name?: string | null;
  /** Ours: stored, licensed, and served from our own origin. */
  image?: OwnedImage | null;
  /** Rented: a provider's, fetched now and never written down. */
  photos?: VenuePhotoRef[] | null;
  /** For the icon on the floor. */
  category?: string | null;
  experiences?: string[];
  atlasCategory?: string | null;
  width?: number;
  height?: number;
  /** As wide as its parent, at 3:2 — the full-width card and the drawer's hero. */
  fill?: boolean;
  /** Draw the credit line under the picture. Off inside a tile that has its own. */
  credit?: boolean;
  /** Only ever `MEDIA_RADIUS`; the prop exists so a test can see nobody passed anything else. */
  rounded?: number;
  onPress?: () => void;
  /** Anything that sits on top of the picture — a heart, a rank. */
  children?: React.ReactNode;
};

/**
 * One width for every rented photograph in the app.
 *
 * A different width is a different fetch: the proxy caches per size, so the
 * same picture asked for at 240, 480, 800 and 960 is four cold trips to
 * Google, and on a household's quota the later ones come back 429. Every place
 * that draws a rented photo asks for this and nothing else, so a picture is
 * fetched once and every other frame is a cache hit.
 */
export const PHOTO_W = 480;

/**
 * One shape for every photograph in the app (owner, 9 Sep 2026: "I would like
 * to use the same photo size and styling with rounded corners that we have in
 * Inspire. That should be there in Places, and it should also be there in
 * Trips when I click through to any given photo").
 *
 * These lived in InspireBody, which is why Inspire was the only tab that had
 * them. Every other caller handed this component its own width, height and
 * corner — Places a 64px square at 10, the trip list a 134px square at 0, the
 * map 6 here and 10 there — and `rounded` defaulted to `radius.md`, which in
 * Epic is nought. So a photo was square unless somebody remembered, and nobody
 * remembered the same number twice.
 *
 * The pack's rule is "zero radius except photo media (10–12px)": a picture is
 * not a card, and the frame round it is what stays square. 3:2 is the shape
 * Inspire's cards were designed at, and it is the shape the library's own
 * portraits are held in.
 */
export const MEDIA_RADIUS = 12;
export const MEDIA_RATIO = 3 / 2;
/** "Cards 208px wide, fixed 3:2 media" — Inspire's card, now everyone's. */
export const CARD_W = 208;
export const CARD_H = Math.round(CARD_W / MEDIA_RATIO);
/** The height a photograph takes at a given width. */
export const mediaHeight = (width: number) => Math.round(width / MEDIA_RATIO);

export function VenueThumb({
  name, image, photos, category, experiences, atlasCategory,
  width, height, fill = false, credit = true, rounded = MEDIA_RADIUS, onPress, children,
}: VenueThumbProps) {
  const w = width ?? 0;
  const h = height ?? 0;
  const least = fill ? 200 : Math.min(w, h);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Ours first, always. A provider's photo is only reached when we have nothing
  // of our own, and it is never stored.
  const photo = photos?.[0];
  /**
   * The provider's photograph, with the key that lets it through the door.
   *
   * `sig`/`exp` come stamped on the reference (api/sources/photoLinks.js). They
   * are what makes the picture load at all in a browser that blocks third-party
   * cookies — which is Safari, and soon Chrome — where the session cookie the
   * route used to rely on never arrives and every tile fell back to its icon.
   */
  const rented = !image && (photo?.url ?? (photo?.ref
    ? `${API_URL}/api/photos/google?name=${encodeURIComponent(photo.ref)}&w=${PHOTO_W}`
      + (photo.sig && photo.exp ? `&s=${encodeURIComponent(photo.sig)}&e=${photo.exp}` : '')
    : null));
  // A mark is small by nature; asking for 960 of a 180px PNG just serves the
  // same bytes back under a different name.
  // 960 for a card or a hero, 500 for a row thumb — the same line Inspire drew
  // at 200px, kept so the bytes a card fetches do not change with this move.
  const ourWidth = image?.source === 'logo' ? 500 : fill || w > 200 ? 960 : 500;
  const uri = image ? `${API_URL}/api/images/${image.id}/${ourWidth}` : rented || null;

  /**
   * A new picture gets a fresh chance.
   *
   * `failed` was set once and never cleared, so a tile that asked for the
   * wrong thing on its first render — a card measuring itself, a list
   * re-ordering — showed its category icon for good, even after the source
   * changed to one that would have loaded. That is how a browse full of
   * photographs came to be a browse full of grey glyphs.
   */
  useEffect(() => { setFailed(false); setLoaded(false); }, [uri]);

  const isMark = image?.source === 'logo';
  const line = image?.creditRequired ? image.credit : photo?.attribution ?? null;
  const icon: IconName = iconFor({ category, experiences, atlasCategory });

  const tile = (
    <View style={[styles.tile, fill ? styles.fill : { width, height }, { borderRadius: rounded, backgroundColor: isMark || !uri || failed ? colors.well : colors.surfaceMuted }]}>
      {/* The photograph's own colours, half a kilobyte, before the network is
          touched. A mark does not get one: blurring a logo up from 20px is a
          smudge, and it is on its ground already. */}
      {/* Held, the photograph grows a few percent inside this frame, which
          clips (owner, 12 Sep 2026). A mark does not: a logo is a shape on
          its ground, not a view into somewhere. */}
      <Zoom>
      {image?.lqip && !isMark && !loaded && !failed ? (
        <Image source={{ uri: image.lqip }} style={StyleSheet.absoluteFill as any} resizeMode="cover" blurRadius={2} accessibilityIgnoresInvertColors />
      ) : null}
      {uri && !failed && !isMark ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill as any}
          resizeMode="cover"
          onError={() => setFailed(true)}
          onLoad={() => setLoaded(true)}
          accessibilityIgnoresInvertColors
          accessibilityLabel={name ?? undefined}
        />
      ) : null}
      </Zoom>
      {uri && !failed && isMark ? (
        <Image
          source={{ uri }}
          style={[styles.mark, { padding: Math.round(least * 0.16) }]}
          resizeMode="contain"
          onError={() => setFailed(true)}
          onLoad={() => setLoaded(true)}
          accessibilityIgnoresInvertColors
          accessibilityLabel={name ? `${name} logo` : undefined}
        />
      ) : uri && !failed ? null : (
        <View style={styles.empty}>
          <Icon name={icon} size={fill ? 40 : Math.max(18, Math.round(least * 0.28))} color={colors.icon} />
        </View>
      )}
      {children}
    </View>
  );

  return (
    <View style={fill ? { width: '100%', gap: 2 } : { width, gap: 2 }}>
      {onPress ? (
        <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={name ?? undefined}>{tile}</Press>
      ) : tile}
      {/* Not decoration. For every licence but CC0 and public domain, the
          picture without the line is the licence broken. */}
      {credit && line && !failed && uri ? (
        <Text style={[type.tiny, styles.credit]} numberOfLines={1}>{line}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  fill: { width: '100%', aspectRatio: MEDIA_RATIO },
  mark: { width: '100%', height: '100%' },
  empty: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  credit: { fontSize: 10, color: colors.inkMuted, paddingHorizontal: 2 },
});

/** The gap the credit line needs under a tile, so a grid can leave room for it. */
export const CREDIT_HEIGHT = 14;
