import { test } from 'node:test';
import assert from 'node:assert/strict';
import { at, POP, RING, SINK } from '../src/components/pressMotion.ts';

test('sink rests at identity and pushes in, never out', () => {
  assert.equal(at(SINK.translateY, 0), 0);
  assert.equal(at(SINK.scale, 0), 1);
  assert.ok(at(SINK.translateY, 1) > 0, 'held: moves down into the page');
  assert.ok(at(SINK.scale, 1) < 1 && at(SINK.scale, 1) > 0.9, 'held: shrinks a touch, not a lot');
  assert.ok(SINK.downMs < SINK.upMs, 'the press is instant, the release is smooth');
});

test('pop squashes while held and springs back with overshoot', () => {
  assert.ok(POP.scaleDown < 1 && POP.scaleDown > 0.85);
  // Low friction against a strong tension is what makes the spring overshoot once.
  assert.ok(POP.spring.friction < 7 && POP.spring.tension > 100);
});

test('ring is born bright and small and dies faded and large', () => {
  assert.ok(at(RING.opacity, 0) > 0.8);
  assert.equal(at(RING.opacity, 1), 0);
  assert.ok(at(RING.scale, 0) < 1);
  assert.ok(at(RING.scale, 1) > 2);
  assert.equal(RING.stroke, 2, 'the 2px ink rule the rest of Epic is drawn with');
});

test('a curve clamps outside its range and interpolates inside it', () => {
  const c = { inputRange: [0, 0.5, 1], outputRange: [0, 10, 0] };
  assert.equal(at(c, -1), 0);
  assert.equal(at(c, 0.25), 5);
  assert.equal(at(c, 0.5), 10);
  assert.equal(at(c, 2), 0);
});
