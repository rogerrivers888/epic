import { test } from 'node:test';
import assert from 'node:assert/strict';

// C57, the Google side (owner, 29 Sep 2026): a fetched place's business status
// is read in memory and handed to the one listener; only Epic's derived flag
// is stored. Here: the field rides a Pro-tier mask (so it never drops a call
// into the free column), and the listener registers and clears.
import { skuFor, onBusinessStatus } from '../src/sources/google.js';

test('businessStatus is a Pro field: a detail mask carrying it stays Pro, never Essentials', () => {
  // A place fetched by its id with businessStatus among Pro fields.
  assert.equal(skuFor('id,displayName,businessStatus', '/places/ChIJ123'), 'google-pro');
  // On a search path it is a search, still Pro-priced, never the free IDs-only tier.
  assert.equal(skuFor('id,businessStatus'), 'google-pro');
  // Ids only, without it, is still free — the field is what lifts the tier.
  assert.equal(skuFor('id'), 'google-essentials');
});

test('onBusinessStatus registers one listener and clears it, and a non-function is ignored', () => {
  let seen = null;
  onBusinessStatus((ref, status) => { seen = [ref, status]; });
  onBusinessStatus(null); // clears
  onBusinessStatus('not a function'); // ignored, no throw
  assert.equal(seen, null);
});
