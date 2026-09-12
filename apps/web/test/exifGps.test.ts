/**
 * The EXIF reader, held to a block built by hand: a JPEG header, one APP1
 * segment, a TIFF with an IFD0 that points at a GPS IFD holding a fix in
 * degrees, minutes and seconds. Painshill Park is at 51.3236, -0.4267.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { exifGps } from '../src/components/exifGps.ts';

function build(little: boolean, lat: [number, number, number], latRef: string, lng: [number, number, number], lngRef: string): Uint8Array {
  const tiff: number[] = [];
  const u16 = (v: number) => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number) => (little ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff] : [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(0x2a), ...u32(8));
  // IFD0 at 8: one entry, the GPS pointer, then next-IFD 0.
  const gpsIfd = 8 + 2 + 12 + 4;
  tiff.push(...u16(1), ...u16(0x8825), ...u16(4), ...u32(1), ...u32(gpsIfd), ...u32(0));
  // GPS IFD: four entries; the rationals live after it.
  const rationalsAt = gpsIfd + 2 + 4 * 12 + 4;
  const entry = (tag: number, type: number, count: number, value: number[]) => { tiff.push(...u16(tag), ...u16(type), ...u32(count), ...value); };
  tiff.push(...u16(4));
  entry(1, 2, 2, [latRef.charCodeAt(0), 0, 0, 0]);
  entry(2, 5, 3, u32(rationalsAt));
  entry(3, 2, 2, [lngRef.charCodeAt(0), 0, 0, 0]);
  entry(4, 5, 3, u32(rationalsAt + 24));
  tiff.push(...u32(0));
  for (const v of [...lat, ...lng]) tiff.push(...u32(Math.round(v * 1000)), ...u32(1000));
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const size = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, size >> 8, size & 0xff, ...app1, 0xff, 0xda, 0, 2]);
}

test('reads a fix from a big-endian block, south and west going negative', () => {
  const fix = exifGps(build(false, [51, 19, 25], 'N', [0, 25, 36.1], 'W'));
  assert.ok(fix);
  assert.ok(Math.abs(fix!.lat - 51.3236) < 0.001, String(fix!.lat));
  assert.ok(Math.abs(fix!.lng - -0.4267) < 0.001, String(fix!.lng));
});

test('reads a little-endian block the same way', () => {
  const fix = exifGps(build(true, [41, 54, 10], 'N', [12, 29, 47], 'E'));
  assert.ok(fix);
  assert.ok(Math.abs(fix!.lat - 41.9028) < 0.001);
  assert.ok(Math.abs(fix!.lng - 12.4964) < 0.001);
});

test('a JPEG with no EXIF, and a file that is not a JPEG, are both null', () => {
  assert.equal(exifGps(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2])), null);
  assert.equal(exifGps(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
});

test('a fix at 0,0 is a phone that wrote nothing, not the Gulf of Guinea', () => {
  assert.equal(exifGps(build(false, [0, 0, 0], 'N', [0, 0, 0], 'E')), null);
});
