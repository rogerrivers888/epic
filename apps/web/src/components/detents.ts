/**
 * How tall the sheet over the map is, at each of its three stops.
 *
 * Its own file, with nothing imported into it, so the arithmetic can be tested
 * without a React tree or react-native behind it — the same reason `routes.ts`
 * is separate from `router.tsx`.
 *
 * The numbers are the handoff's (6 Sep 2026): peek 112px is the header alone,
 * half is 470, and full stops 60px from the top of the screen. The two guards
 * are for the sizes a phone never has and a browser window often does — a short
 * window must not end up with a `half` taller than its `full`, and a very short
 * one must still leave something to take hold of.
 */

export type Detent = 'peek' | 'half' | 'full';
export const DETENTS: Detent[] = ['peek', 'half', 'full'];

export function detentHeights(screenHeight: number, insetBottom: number): Record<Detent, number> {
  /**
   * Said as how much map is left, which is what the handoff measures and what
   * you are actually choosing between (trips V2: 100 up, 310 default, 672
   * down). Working from the sheet's own height instead made the map an
   * afterthought, and the map is the screen.
   *
   * Each is clamped so a short window shrinks from the bottom up rather than
   * ending with a peek taller than its half.
   */
  const usable = Math.max(320, screenHeight - insetBottom);
  const full = Math.max(300, usable - 100);
  const half = Math.max(260, Math.min(full, usable - 310));
  const peek = Math.max(120, Math.min(half, usable - 672));
  return { peek, half, full };
}
