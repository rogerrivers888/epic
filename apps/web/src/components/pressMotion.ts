/**
 * The numbers behind the three press effects (owner, 9 Sep 2026: "All buttons
 * to have the sync effect, the heart to have the ring effect, the Add to Trip
 * to have the pop effect"). Kept apart from the components so they can be
 * read and tested without a renderer.
 *
 * Each effect is a curve from a single driver `v` in [0, 1]:
 *
 * - **sink** — the button is pushed into the page: it moves down and shrinks
 *   a touch while the finger is on it, and eases straight back when it lifts.
 *   No overshoot; a button is not a toy.
 * - **pop** — a squash on the way down and a spring on the way up that
 *   overshoots before it settles, so adding something reads as a small
 *   celebration rather than a click.
 * - **ring** — not a transform of the control at all: a 2px ring drawn from
 *   the heart's centre that grows and fades, the way a like bursts.
 */
export type PressEffect = 'sink' | 'pop' | 'none';

/** A linear map from the driver to one style value, in Animated's own shape. */
export type Curve = { inputRange: number[]; outputRange: number[] };

export const SINK = {
  /** How far the finger presses it in, in px. */
  translateY: { inputRange: [0, 1], outputRange: [0, 2] } as Curve,
  scale: { inputRange: [0, 1], outputRange: [1, 0.97] } as Curve,
  /** Down fast, up a little slower: the press should feel instant, the release should feel smooth. */
  downMs: 70,
  upMs: 160,
};

export const POP = {
  /** The squash while held. */
  scaleDown: 0.94,
  downMs: 70,
  /** The spring home: low friction so it overshoots (~1.06) once and settles. */
  spring: { friction: 4, tension: 160 },
};

export const RING = {
  /** Grows from half the heart's box to just over twice it. */
  scale: { inputRange: [0, 1], outputRange: [0.5, 2.2] } as Curve,
  /** Bright at birth, gone by the end — front-loaded so the ring is seen leaving, not arriving. */
  opacity: { inputRange: [0, 0.15, 1], outputRange: [0.9, 0.9, 0] } as Curve,
  ms: 480,
  /** The rule weight everything else in Epic is drawn with. */
  stroke: 2,
};

/** Evaluate a curve at `v` (piecewise linear, clamped) — for tests and for anything not driven by Animated. */
export const at = (c: Curve, v: number): number => {
  const { inputRange: xs, outputRange: ys } = c;
  if (v <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (v <= xs[i]) {
      const t = (v - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] + (ys[i] - ys[i - 1]) * t;
    }
  }
  return ys[ys.length - 1];
};
