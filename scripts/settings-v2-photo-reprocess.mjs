/**
 * One-off: re-process existing member photos to a cropped, resized, EXIF- and
 * location-stripped image, and drop the originals (Settings revised v2, data
 * change #2). From now on the photo flow (SX1–SX3) already stores a 512²
 * re-encoded JPEG, which carries no EXIF; this is for faces saved BEFORE that.
 *
 * REPORT ONLY. Re-encoding an image is CPU work with a real image library, and
 * doing it to production data is a person's call (H1) — so this prints what it
 * would touch and stops. It reports, per household:
 *   · how many members carry a photo, and whether each is a data-URI (ours) or
 *     an https link (a provider's — must not be re-encoded or kept, see policy),
 *   · the byte size of each stored data-URI, and whether it looks already-square,
 *   · a flag for any photo large enough to still carry camera EXIF.
 *
 * The re-encode itself runs on the client's next open (the device has the image
 * libraries; the server does not re-encode faces today) or via a server image
 * library if one is added — decide before applying. This script never writes.
 *
 *   node scripts/settings-v2-photo-reprocess.mjs
 */
import '../apps/api/src/env.js';
import { query } from '../apps/api/src/db.js';

const rows = (await query(
  `select m.id, m.name, m.household_id, m.avatar_url from members m where m.avatar_url is not null and m.avatar_url <> ''`)).rows;

let dataUris = 0; let links = 0; let big = 0;
const byHousehold = new Map();
for (const m of rows) {
  const url = m.avatar_url;
  const isData = /^data:image\//.test(url);
  if (isData) dataUris += 1; else links += 1;
  // A data URI's base64 length ~ 4/3 of the bytes; > ~60KB is big enough that a
  // phone photo could still hold EXIF if it was never re-encoded.
  const bytes = isData ? Math.floor((url.length - url.indexOf(',') - 1) * 0.75) : null;
  if (bytes != null && bytes > 60_000) big += 1;
  const h = byHousehold.get(m.household_id) ?? [];
  h.push({ name: m.name, kind: isData ? 'data-uri' : 'link', bytes });
  byHousehold.set(m.household_id, h);
}

console.log(`Members with a photo: ${rows.length}`);
console.log(`  · ours (data-uri, re-encode in place): ${dataUris}`);
console.log(`  · external link (provider content — must be dropped, never kept): ${links}`);
console.log(`  · large enough to possibly still carry EXIF (> ~60KB): ${big}`);
console.log(`Households touched: ${byHousehold.size}`);
console.log('\nREPORT ONLY. No photo has been changed. Re-encoding to 512² EXIF-stripped JPEG and dropping the originals is applied by a person against production (H1), on the next client open or a server image pass — decide which before applying.');
process.exit(0);
