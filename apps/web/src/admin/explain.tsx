/**
 * Every figure on these screens explains itself.
 *
 * The design package's second law: "Every field explains itself on hover — every
 * column header, every stat label, and every data cell, which inherits its
 * column's explanation automatically. A new column cannot ship with unexplained
 * figures under it."
 *
 * So the explanation lives on the **column definition**, not on the cell, and
 * `Ladder` in table.tsx hands each cell its column's tip as it draws it. Wiring
 * a cell by hand is possible — a place that explains only itself, like a source
 * that says "not asked" — but it is the exception.
 *
 * The panel is positioned in the page's own coordinate space rather than the
 * window's. On the web that is the hovered element's box minus the page's box,
 * which is exact under the shell's phone frame as well: the frame moves the page
 * and both rectangles move with it. `position: fixed` would anchor to the
 * browser window and land somewhere else entirely inside the frame — the design
 * file's own note says the same thing about its canvas.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, type, BORDER } from '../theme';
import { TIPS, type Tip, type TipKey, tipOf } from './tips';

export { TIPS, tipOf };
export type { Tip, TipKey };

/** The width the design sets, and the width the clamp is measured against. */
const TIP_W = 330;
/**
 * The tallest a tip is assumed to be, for clamping.
 *
 * The panel sizes itself to its words, and measuring it before it is drawn
 * would mean drawing it twice. The longest body in `tips.ts` is a little over
 * three hundred characters, which wraps to about seven lines at this width —
 * so this is generous rather than exact, and being generous is the safe
 * direction: a tip nudged up too far is readable, one nudged too little is not.
 */
const TIP_H_MAX = 150;

type Shown = { tip: Tip; x: number; y: number } | null;

const Ctx = createContext<{
  show: (tip: Tip, box: { left: number; top: number; bottom: number }) => void;
  hide: () => void;
  on: boolean;
}>({ show: () => {}, hide: () => {}, on: false });

/**
 * The page the panel is drawn in.
 *
 * Wrap the back office's content once. Everything under it can explain itself;
 * anything outside it silently does not, which is why this sits at the top of
 * AdminApp rather than inside a screen.
 */
export function Explains({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = useState<Shown>(null);
  const ref = React.useRef<View | null>(null);

  const show = useCallback((tip: Tip, box: { left: number; top: number; bottom: number }) => {
    const root = (ref.current as unknown as HTMLElement | null);
    if (Platform.OS !== 'web' || !root || typeof (root as any).getBoundingClientRect !== 'function') {
      setShown({ tip, x: 0, y: 0 });
      return;
    }
    const rr = (root as any).getBoundingClientRect();
    let x = box.left - rr.left;
    let y = box.bottom - rr.top + 8;
    // Kept inside the page, so a tip on the last column is readable rather than
    // half off the edge.
    const maxX = Math.max(0, rr.width - TIP_W - 12);
    if (x > maxX) x = maxX;
    if (x < 0) x = 0;
    // And inside it downwards. The design says the panel is "clamped inside its
    // artboard"; only the sides were clamped, so a tip on the last row of a
    // long board hung below the page (17 Sep 2026, the verification audit).
    // Above the thing it explains rather than below it, which is what there is
    // room for.
    const bottom = y + TIP_H_MAX;
    if (bottom > rr.height - 8) {
      const above = box.top - rr.top - TIP_H_MAX - 8;
      y = above > 8 ? above : Math.max(8, rr.height - TIP_H_MAX - 8);
    }
    setShown({ tip, x, y });
  }, []);
  const hide = useCallback(() => setShown(null), []);
  const value = useMemo(() => ({ show, hide, on: true }), [show, hide]);

  return (
    <Ctx.Provider value={value}>
      <View ref={ref as any} style={{ flex: 1, position: 'relative' }}>
        {children}
        {shown ? (
          <View style={[styles.panel, { left: shown.x, top: shown.y }]} pointerEvents="none">
            <Text style={styles.title}>{shown.tip[0]}</Text>
            <Text style={styles.body}>{shown.tip[1]}</Text>
          </View>
        ) : null}
      </View>
    </Ctx.Provider>
  );
}

/**
 * One thing that explains itself.
 *
 * `tip` is a key from tips.ts, or a `[title, body]` pair where the sentence is
 * about this row in particular — "Google, Atlas and Tripadvisor have never
 * returned it" is a different fact for every place, and a generic version of it
 * would be worse than none.
 */
export function Explain({ tip, style, children, cursor = 'help' }: {
  tip: TipKey | Tip | null | undefined;
  style?: any;
  children: React.ReactNode;
  cursor?: 'help' | 'pointer' | 'default';
}) {
  const { show, hide } = useContext(Ctx);
  const resolved = tipOf(tip);
  /** Whether this one is the reason a panel is on the screen. */
  const mine = React.useRef(false);
  /**
   * A panel is taken down by the thing that put it up.
   *
   * The panel lives in the provider and is cleared on mouse-leave, so a wrapper
   * that stops being a wrapper — its `tip` set to null, or unmounted — left its
   * own panel on the screen for ever, with no element under the pointer to
   * leave. That is what covered the How far list: the control hands the tip
   * back while the list is open, and the panel it had already raised stayed
   * exactly where the list draws (owner, 20 Sep 2026: "this hover-over box
   * keeps overlaying the dropdown so that I can't actually interact with the
   * dropdown").
   *
   * Above the early return, because a hook below one is a different number of
   * hooks on the render that takes it.
   */
  useEffect(() => {
    if (!resolved && mine.current) { mine.current = false; hide(); }
  }, [resolved, hide]);
  useEffect(() => () => { if (mine.current) { mine.current = false; hide(); } }, [hide]);
  if (!resolved) return <View style={style}>{children}</View>;
  const enter = (e: any) => {
    mine.current = true;
    const el = e?.currentTarget;
    if (el && typeof el.getBoundingClientRect === 'function') {
      const r = el.getBoundingClientRect();
      show(resolved, { left: r.left, top: r.top, bottom: r.bottom });
    } else show(resolved, { left: 0, top: 0, bottom: 0 });
  };
  return (
    <View
      style={[style, Platform.OS === 'web' ? ({ cursor } as any) : null]}
      // RNW forwards these to the DOM; on a device there is no hover and the
      // screen simply does not explain itself, which is the honest behaviour
      // rather than a long-press that fights the scroll.
      {...(Platform.OS === 'web' ? { onMouseEnter: enter, onMouseLeave: () => { mine.current = false; hide(); } } as any : {})}
      accessibilityLabel={`${resolved[0]}. ${resolved[1]}`}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute', width: TIP_W, zIndex: 9999,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.ruleMuted,
    borderTopWidth: BORDER, borderTopColor: colors.selected,
    paddingHorizontal: 13, paddingTop: 11, paddingBottom: 12, gap: 6,
  },
  title: { ...type.tiny, fontSize: 10, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase', color: colors.accent },
  body: { ...type.small, fontSize: 12.5, lineHeight: 19, color: colors.ink },
});
