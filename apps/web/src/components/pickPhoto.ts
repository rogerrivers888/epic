/**
 * A photograph from this device, as bytes.
 *
 * The household screen shrinks a face to a data URI because a face is small
 * and is stored on the member row. A host's photograph and a guest's review
 * picture are bigger and go to `POST /api/host/media` as a body, so this
 * hands back a Blob instead. On the web it is the browser's own file picker
 * — the same thing `expo-image-picker` wraps — with the photo resized on a
 * canvas so a 12-megapixel upload does not leave the phone.
 */

import { Platform } from 'react-native';
import { exifGps, type ExifGps } from './exifGps';

const MAX_EDGE = 1600;

export async function pickPhotoBlob(): Promise<Blob | null> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
  const file = await new Promise<File | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    // Some browsers never fire `change` on cancel; a focus back to the window
    // after the dialog closes with nothing chosen is treated as a cancel.
    const onFocus = () => { setTimeout(() => { if (!input.files?.length) resolve(null); }, 400); window.removeEventListener('focus', onFocus); };
    window.addEventListener('focus', onFocus);
    input.click();
  });
  if (!file) return null;
  return shrink(file);
}

/** Bytes → smaller bytes. Anything the canvas cannot read goes up as it is. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    return blob ?? file;
  } catch {
    return file;
  }
}

/** The picture a household takes of a place, with where it was taken if the phone wrote it in. */
export type PlacePhoto = {
  blob: Blob; width: number; height: number;
  /** A 20px JPEG as a data URI: the picture's own colours before its bytes arrive. */
  lqip: string | null;
  /** From the picture's EXIF, before the canvas threw it away. Null when the phone kept it to itself. */
  gps: ExifGps | null;
};

/**
 * A photograph of a place, from the camera where there is one.
 *
 * `capture` asks a phone to open the camera rather than the roll — "just take
 * a photograph of somewhere that looks cool and just add it" (owner, 12 Sep
 * 2026) — and a desktop browser ignores it and offers a file. The EXIF is read
 * off the original bytes first, because the shrink that follows is a canvas
 * and a canvas keeps nothing but pixels.
 */
export async function pickPlacePhoto({ camera = true }: { camera?: boolean } = {}): Promise<PlacePhoto | null> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
  const file = await new Promise<File | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (camera) input.setAttribute('capture', 'environment');
    input.onchange = () => resolve(input.files?.[0] ?? null);
    const onFocus = () => { setTimeout(() => { if (!input.files?.length) resolve(null); }, 400); window.removeEventListener('focus', onFocus); };
    window.addEventListener('focus', onFocus);
    input.click();
  });
  if (!file) return null;
  let gps: ExifGps | null = null;
  try { gps = exifGps(await file.slice(0, 256 * 1024).arrayBuffer()); } catch { gps = null; }
  const blob = await shrink(file);
  const { width, height, lqip } = await measure(blob);
  return { blob, width, height, lqip, gps };
}

/** The picture's size, and its 20px self. Anything the canvas cannot read gets neither. */
async function measure(blob: Blob): Promise<{ width: number; height: number; lqip: string | null }> {
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    const w = 20;
    const h = Math.max(1, Math.round((bitmap.height / bitmap.width) * w));
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
    return { width: bitmap.width, height: bitmap.height, lqip: canvas.toDataURL('image/jpeg', 0.5) };
  } catch {
    return { width: 0, height: 0, lqip: null };
  }
}

/** Bytes as base64, for a JSON body. */
export async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 0x8000)));
  return btoa(s);
}
