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
import { useEffect, useState } from 'react';
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
