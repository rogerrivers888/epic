/**
 * Motion for the website (README › All motion; Technical Foundations › Performance).
 *
 *  - Animate with the Web Animations API, after first paint.
 *  - The largest headline (the LCP text) is never animated in from opacity 0: it
 *    is visible on first paint, and motion happens around it (decision 7).
 *  - `prefers-reduced-motion` shows the final state; loops stop while the tab is
 *    hidden, and a loop that runs past five seconds stops after three cycles or
 *    carries a pause control (WCAG).
 *
 * On React Native Web a View's ref is its DOM node, so `animate(ref.current, …)`
 * reaches `Element.animate`. On native these are no-ops.
 */
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

const web = Platform.OS === 'web' && typeof window !== 'undefined';

/** The easing the designs use throughout. */
export const EASE = 'cubic-bezier(.22,1,.36,1)';

export function usePrefersReducedMotion(): boolean {
  const query = () => (web && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null);
  const [reduced, setReduced] = useState(() => Boolean(query()?.matches));
  useEffect(() => {
    const q = query();
    if (!q) return;
    const on = () => setReduced(q.matches);
    q.addEventListener?.('change', on);
    return () => q.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/** False while the tab is hidden — a loop checks this and stops. */
export function useTabVisible(): boolean {
  const [visible, setVisible] = useState(() => !web || document.visibilityState !== 'hidden');
  useEffect(() => {
    if (!web) return;
    const on = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

/** Run a Web Animations API animation on a host node; null where it cannot run. */
export function animate(node: unknown, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  const el = node as HTMLElement | null;
  if (!web || !el || typeof (el as HTMLElement).animate !== 'function') return null;
  return el.animate(keyframes, options);
}

/** Fires once when the node first scrolls into view (for "rise in when scrolled into view"). */
export function onFirstView(node: unknown, run: () => void): () => void {
  const el = node as Element | null;
  if (!web || !el || typeof IntersectionObserver === 'undefined') { run(); return () => {}; }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); run(); }
  }, { threshold: 0.2 });
  io.observe(el);
  return () => io.disconnect();
}

/**
 * A storyboard clock for a short looping beat (the host page's live cards and
 * RSVP; v6, 2 Oct 2026). Runs only while `node` is at least 40% in view and the
 * tab is showing; stops after `loops` loops and holds the end state; with reduced
 * motion — or off the web — it is the end state from the start.
 *
 * Returns the time inside the current loop (ms; held at `end` once done), whether
 * a loop has already gone round (so the next one fades back in), and `replay`.
 * `delay` holds this beat back behind its neighbours (a stagger).
 */
export function useStoryboard(node: { current: unknown }, { loop, end, loops, delay = 0 }: { loop: number; end: number; loops: number; delay?: number }) {
  const reduced = usePrefersReducedMotion();
  const visible = useTabVisible();
  const still = !web || reduced;
  const [elapsed, setElapsed] = useState(0);
  const [inView, setInView] = useState(false);
  const [done, setDone] = useState(false);
  const total = loop * (loops - 1) + end + delay;

  useEffect(() => {
    const el = node.current as Element | null;
    if (still || !el) return;
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    // 40% in view, measured — isIntersecting is true for any overlap at all (Codex).
    const io = new IntersectionObserver((entries) => setInView(entries.some((e) => e.intersectionRatio >= 0.4)), { threshold: [0, 0.4] });
    io.observe(el);
    return () => io.disconnect();
  }, [node, still]);

  // Elapsed time lives in a ref so the frame loop reads and ends on it directly;
  // the state copy is only what draws.
  const clock = useRef(0);
  useEffect(() => {
    if (still || done || !inView || !visible) return;
    let last = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      clock.current = Math.min(total, clock.current + Math.min(64, now - last));
      last = now;
      setElapsed(clock.current);
      if (clock.current >= total) { setDone(true); return; }
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [still, done, inView, visible, total]);

  const replay = () => { if (still) return; clock.current = 0; setElapsed(0); setDone(false); };
  if (still || done) return { t: end, looped: false, replay };
  const local = elapsed - delay;
  return { t: local < 0 ? 0 : local % loop, looped: local >= loop, replay };
}
