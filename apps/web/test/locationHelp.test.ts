import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceFrom, howToAllow } from '../src/hooks/locationHelp.ts';

test('the device is read from the browser, not guessed', () => {
  assert.equal(deviceFrom('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15'), 'iphone');
  assert.equal(deviceFrom('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/128'), 'android');
  assert.equal(deviceFrom('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Safari/605.1.15'), 'desktop');
  assert.equal(deviceFrom(''), 'desktop');
});

test('every refusal says permission is missing, where to go, and what to do', () => {
  for (const d of ['iphone', 'android', 'desktop'] as const) {
    const s = howToAllow(d);
    assert.match(s, /haven't given Epic permission/);
    assert.match(s, /address bar/);
    assert.match(s, /Try again/);
  }
});

test('an iPhone with Epic on the home screen is sent to the app\'s own setting, not Safari\'s', () => {
  assert.match(howToAllow('iphone', true), /Settings, find Epic/);
  assert.match(howToAllow('iphone', false), /Safari Websites/);
});
