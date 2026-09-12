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
