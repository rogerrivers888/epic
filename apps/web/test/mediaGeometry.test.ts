import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Every photograph in the app is the same shape.
 *
 * Owner, 9 Sep 2026: "I notice that the photo sizes are different in each of
 * the tabs and styling. I would like to use the same photo size and styling
 * with rounded corners that we have in Inspire." They were different because
 * the shape lived in one file and every other caller hand-typed its own: a 64px
 * square at 10 on Places, a 134px square at 0 on the trip list, 6 and 10 on the
 * map. This reads the source and refuses the next hand-typed number, which is
 * the only way a rule like this survives a week of other people's commits.
 */

const SRC = new URL('../src/', import.meta.url).pathname;
const THUMB = readFileSync(path.join(SRC, 'components/VenueThumb.tsx'), 'utf8');

/**
 * Files allowed to disagree, each with the reason. A file on this list is not
 * exempt from the rule — it is a place the rule is known to be broken, waiting
 * for the person whose change it is.
 */
const KNOWN = new Map<string, string>([
  // Empty on the day it was written. TripMapScreen was on it for an hour —
  // another session had uncommitted work there — until that landed and the
  // file could be brought into line like the rest.
]);
/** A business's mark is not a photograph: contained on its ground, and square. */
const SQUARE_OK = new Set(['components/VenueDrawer.tsx:140x140']);

function* tsx(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* tsx(p);
    else if (p.endsWith('.tsx')) yield p;
  }
}
const files = [...tsx(SRC)].map((p) => [path.relative(SRC, p), readFileSync(p, 'utf8')] as const);

test('the shape is declared once, where every photograph is drawn', () => {
  assert.match(THUMB, /export const MEDIA_RADIUS = 12;/);
  assert.match(THUMB, /export const MEDIA_RATIO = 3 \/ 2;/);
  assert.match(THUMB, /rounded = MEDIA_RADIUS/, 'the default corner is the corner, not radius.md (which is nought)');
});

test('nobody hand-types a corner radius on a photograph', () => {
  const offenders: string[] = [];
  for (const [rel, src] of files) {
    if (rel === 'components/VenueThumb.tsx' || KNOWN.has(rel)) continue;
    for (const m of src.matchAll(/rounded=\{([^}]*)\}/g)) {
      if (m[1].trim() !== 'MEDIA_RADIUS') offenders.push(`${rel}: rounded={${m[1]}}`);
    }
  }
  assert.deepEqual(offenders, [], 'a photograph\'s corner is MEDIA_RADIUS or nothing');
});

test('every photograph drawn at a fixed size is 3:2', () => {
  const offenders: string[] = [];
  for (const [rel, src] of files) {
    if (rel === 'components/VenueThumb.tsx' || KNOWN.has(rel)) continue;
    for (const tag of src.matchAll(/<VenueThumb\b[\s\S]*?(?:\/>|>)/g)) {
      const w = /\bwidth=\{(\d+)\}/.exec(tag[0]);
      const h = /\bheight=\{(\d+)\}/.exec(tag[0]);
      if (!w || !h) continue;                                   // fill, or a computed size
      const width = Number(w[1]); const height = Number(h[1]);
      if (SQUARE_OK.has(`${rel}:${width}x${height}`)) continue;
      if (Math.abs(height - Math.round(width / 1.5)) > 1) offenders.push(`${rel}: ${width}×${height}`);
    }
  }
  assert.deepEqual(offenders, [], 'a fixed-size photograph is width × 2/3');
});

test('the known exceptions are still exceptions, not habit', () => {
  // When a file on the list stops needing it, this fails, and the entry goes.
  for (const [rel] of KNOWN) {
    const src = readFileSync(path.join(SRC, rel), 'utf8');
    const stray = [...src.matchAll(/rounded=\{([^}]*)\}/g)].some((m) => m[1].trim() !== 'MEDIA_RADIUS');
    assert.ok(stray, `${rel} no longer disagrees — remove it from KNOWN`);
  }
});
