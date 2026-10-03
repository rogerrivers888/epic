/**
 * A photo on a subcategory guide (src/site/guides/guides.json): fills the frame
 * it is put in, cropped to cover it, as the design's `object-fit: cover`.
 *
 * On the web it is a real <picture>: the WebP beside the JPEG (same name,
 * public/site/guides) for browsers that take it, the JPEG for the rest, and
 * `loading="lazy"` below the first screen (brief › Photos: "Serve responsive
 * WebP/AVIF and lazy-load everything below the first screen"). The header strip
 * passes `eager`. Its alt text is the description in guides.json.
 */
import React from 'react';
import { Image, Platform, StyleSheet } from 'react-native';

export function GuidePicture({ src, alt, eager = false }: { src: string; alt: string; eager?: boolean }) {
  if (Platform.OS !== 'web') {
    return <Image source={{ uri: src }} accessibilityLabel={alt} style={StyleSheet.absoluteFill} resizeMode="cover" />;
  }
  return (
    <picture style={{ position: 'absolute', inset: 0, display: 'block' }}>
      <source type="image/webp" srcSet={src.replace(/\.jpg$/, '.webp')} />
      <img
        src={src}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    </picture>
  );
}
