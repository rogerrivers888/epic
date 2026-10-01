/**
 * The launch gate on the web side (gate.mjs).
 *
 * The one thing that is silent when it breaks: the gate reading "unset" as off,
 * which would let the unopened site be indexed because a variable was forgotten.
 * So that is what is pinned here — on by default, off only on an explicit word.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// @ts-ignore -- a plain .mjs helper shared with server.mjs, no types
import { siteGateOn } from '../gate.mjs';

const withEnv = (vars: Record<string, string | null>, fn: () => void) => {
  const before: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    before[k] = process.env[k];
    if (v === null) delete process.env[k]; else process.env[k] = v;
  }
  try { fn(); } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
};

test('the gate is on unless explicitly switched off', () => {
  withEnv({ SITE_GATE: null }, () => assert.equal(siteGateOn(), true));
  withEnv({ SITE_GATE: '' }, () => assert.equal(siteGateOn(), true));
  withEnv({ SITE_GATE: 'on' }, () => assert.equal(siteGateOn(), true));
  withEnv({ SITE_GATE: 'anything-else' }, () => assert.equal(siteGateOn(), true));
  for (const off of ['off', 'OFF', 'false', '0', 'no']) {
    withEnv({ SITE_GATE: off }, () => assert.equal(siteGateOn(), false));
  }
});
