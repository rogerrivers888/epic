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
 * - **pulse** (his "ring") — not a transform of the control at all: a heart
 *   outline drawn from the heart's centre that grows and fades, the way a
 *   like bursts. It was a circle first; he asked for the heart (12 Sep 2026).
 */
export type PressEffect = 'sink' | 'pop' | 'none';

/** A linear map from the driver to one style value, in Animated's own shape. */
export type Curve = { inputRange: number[]; outputRange: number[] };

/**
 * A tap lasts about a tenth of a second. The first cut of these (2px, 3%,
 * 70ms, released the instant the finger lifted) measured correctly in a
 * headless browser and was invisible on a phone (owner, 12 Sep 2026: "I
 * don't see any of the effects live"). So two rules now:
 *
 * 1. **Every press plays through.** The way down always runs to the end
 *    before the way up begins, however brief the tap — `holdMs` is the least
 *    a press is seen for.
 * 2. **Big enough to see, no more.** 2px and 3% for the sink (the owner, 12 Sep
 *    2026: "the animation is a bit too accentuated… tone it down a bit"), a 12%
 *    squash for the pop, and a ring that grows to three times the heart.
 */
export const SINK = {
  /** How far the finger presses it in, in px. */
  translateY: { inputRange: [0, 1], outputRange: [0, 2] } as Curve,
  scale: { inputRange: [0, 1], outputRange: [1, 0.97] } as Curve,
  /** Down fast, up slower: the press should feel instant, the release should be seen. */
  downMs: 90,
  upMs: 220,
  /** The least a press is shown for before the release plays. */
  holdMs: 110,
};

export const POP = {
  /** The squash while held. */
  scaleDown: 0.88,
  downMs: 90,
  holdMs: 110,
  /** The spring home: low friction so it overshoots (~1.08) once and settles. */
  spring: { friction: 3.5, tension: 180 },
};

/**
 * A photograph held under the finger grows a few percent inside its own frame
 * (owner, 12 Sep 2026): the picture answers, the frame stays where it is.
 */
export const ZOOM = {
  scale: { inputRange: [0, 1], outputRange: [1, 1.05] } as Curve,
};

export const RING = {
  /** Grows from half the heart's box to three times it. */
  scale: { inputRange: [0, 1], outputRange: [0.5, 3] } as Curve,
  /** Bright at birth, gone by the end — front-loaded so the ring is seen leaving, not arriving. */
  opacity: { inputRange: [0, 0.2, 1], outputRange: [1, 0.9, 0] } as Curve,
  ms: 600,
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
