/**
 * Where a photograph was taken, read from the JPEG itself.
 *
 * A phone writes the fix into the picture's EXIF block — three rationals each
 * for latitude and longitude, and a letter for the hemisphere. This reads
 * exactly that and nothing else: no library, because the whole of what is
 * wanted is forty bytes in a known place, and because the bytes are read
 * *before* the picture is shrunk on a canvas, which throws every tag away.
 *
 * Not every photograph has it. A phone that strips location on the way out of
 * the camera roll, a screenshot, a picture sent on by somebody else — all of
 * those come back null, and the screen falls back to where the device is now.
 * Pure, so test/exifGps.test.ts can hand it a hand-built block.
 */

export type ExifGps = { lat: number; lng: number };

const APP1 = 0xffe1;
const GPS_IFD_POINTER = 0x8825;
const TAG_LAT_REF = 0x0001;
const TAG_LAT = 0x0002;
const TAG_LNG_REF = 0x0003;
const TAG_LNG = 0x0004;

export function exifGps(bytes: ArrayBuffer | Uint8Array): ExifGps | null {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length < 4 || dv.getUint16(0) !== 0xffd8) return null;
  // Walk the segments to APP1 "Exif\0\0".
  let at = 2;
  while (at + 4 <= u8.length) {
    const marker = dv.getUint16(at);
    if (marker === 0xffda) return null; // start of scan: no more headers
    const size = dv.getUint16(at + 2);
    if (marker === APP1 && at + 10 <= u8.length && ascii(u8, at + 4, 4) === 'Exif') {
      return fromTiff(dv, at + 10, at + 2 + size);
    }
    at += 2 + size;
  }
  return null;
}

function ascii(u8: Uint8Array, at: number, n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(u8[at + i]);
  return s;
}

function fromTiff(dv: DataView, tiff: number, end: number): ExifGps | null {
  if (tiff + 8 > end) return null;
  const order = dv.getUint16(tiff);
  const little = order === 0x4949;
  if (!little && order !== 0x4d4d) return null;
  const u16 = (o: number) => dv.getUint16(o, little);
  const u32 = (o: number) => dv.getUint32(o, little);
  if (u16(tiff + 2) !== 0x2a) return null;
  const ifd0 = tiff + u32(tiff + 4);
  const gpsAt = findTag(dv, tiff, ifd0, end, GPS_IFD_POINTER, little);
  if (gpsAt == null) return null;
  const gps = tiff + u32(gpsAt + 8);
  const latRefAt = findTag(dv, tiff, gps, end, TAG_LAT_REF, little);
  const latAt = findTag(dv, tiff, gps, end, TAG_LAT, little);
  const lngRefAt = findTag(dv, tiff, gps, end, TAG_LNG_REF, little);
  const lngAt = findTag(dv, tiff, gps, end, TAG_LNG, little);
  if (latAt == null || lngAt == null) return null;
  const lat = dms(dv, tiff, latAt, end, little);
  const lng = dms(dv, tiff, lngAt, end, little);
  if (lat == null || lng == null) return null;
  const latRef = latRefAt != null ? String.fromCharCode(dv.getUint8(latRefAt + 8)) : 'N';
  const lngRef = lngRefAt != null ? String.fromCharCode(dv.getUint8(lngRefAt + 8)) : 'E';
  const out = { lat: latRef === 'S' ? -lat : lat, lng: lngRef === 'W' ? -lng : lng };
  if (Math.abs(out.lat) > 90 || Math.abs(out.lng) > 180 || (out.lat === 0 && out.lng === 0)) return null;
  return out;
}

/** The offset of a tag's 12-byte entry in an IFD, or null. */
function findTag(dv: DataView, tiff: number, ifd: number, end: number, tag: number, little: boolean): number | null {
  if (ifd + 2 > end) return null;
  const n = dv.getUint16(ifd, little);
  for (let i = 0; i < n; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return null;
    if (dv.getUint16(entry, little) === tag) return entry;
  }
  return null;
}

/** Three RATIONALs — degrees, minutes, seconds — as decimal degrees. */
function dms(dv: DataView, tiff: number, entry: number, end: number, little: boolean): number | null {
  const type = dv.getUint16(entry + 2, little);
  const count = dv.getUint32(entry + 4, little);
  if (type !== 5 || count < 3) return null;
  const at = tiff + dv.getUint32(entry + 8, little);
  if (at + 24 > end) return null;
  const r = (o: number) => { const d = dv.getUint32(o + 4, little); return d ? dv.getUint32(o, little) / d : 0; };
  const v = r(at) + r(at + 8) / 60 + r(at + 16) / 3600;
  return Number.isFinite(v) ? v : null;
}
