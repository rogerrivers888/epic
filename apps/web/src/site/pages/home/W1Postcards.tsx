/**
 * W1 · Postcards (Website & Registration › Homepage › W1). Twenty-four tiles in
 * an 8×3 grid with 3px cream gaps, and a lime band (184px below the header,
 * 368px tall) across them: the wordmark on the left, "Coming soon.", the line and
 * the form on the right (1.15fr / 1fr, gap 48). Tiles fly in, the band sweeps
 * across from the left, confetti bursts.
 *
 * Owner overrides on the design:
 *  - the page's one <h1> is the descriptive line under "Coming soon." (styled as
 *    that line); "Coming soon." keeps its size as a <p>;
 *  - nothing with words in it is animated, so the headline is there on first
 *    paint: only the tiles, the band's lime ground and the confetti move. The
 *    design's wordmark rise (1550ms) and copy fade (1950ms) are dropped;
 *  - no confetti on a phone or under reduced motion; reduced motion shows the
 *    final state.
 *
 * Photo tiles are flat brand tones until the owned pictures exist. Phone (<700):
 * MB rules — 4×6 tiles behind a band that stacks to one column, 20px sides.
 */
import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { CREAM, DEEP_GREEN, HAIRLINE, INK, LIME, MOSS, NEUTRAL, fonts } from '../../../theme';
import { SiteWordmark as Wordmark } from '../../SiteWordmark';
import { useViewport } from '../../../hooks/useViewport';
import { InterestForm } from '../../InterestForm';
import { SiteH1, SiteP } from '../../type';
import { EASE, animate, usePrefersReducedMotion } from '../../motion';
import { pick } from '../../i18n';
import type { SitePageProps } from '../../page';
import { W1_WORDS } from './W1Postcards.strings';

const TONES = [MOSS, INK, HAIRLINE, LIME, DEEP_GREEN, NEUTRAL];
const TILES = 24;
const PHONE = 700;
// The 1280 × 820 frame less the 84px header.
const BODY_HEIGHT = 736;
const BAND_TOP = 184;
const BAND_HEIGHT = 368;
const BAND_AT = 1250;
const CONFETTI_AT = 1900;
const web = Platform.OS === 'web' && typeof window !== 'undefined';

export function W1Postcards({ locale, landingPage }: SitePageProps) {
  const w = pick(W1_WORDS, locale);
  const { width } = useViewport();
  const phone = width < PHONE;
  const reduced = usePrefersReducedMotion();

  const tiles = useRef<(View | null)[]>([]);
  const band = useRef<View | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const box = useRef({ width: 0, height: 0 });
  const confetti = !phone && !reduced && web;

  // Layout effect, not effect: the tiles are hidden by `fill: backwards` before
  // the browser paints them, so they never flash in place first. Nothing here
  // carries text, so the headline still paints at once.
  useLayoutEffect(() => {
    if (reduced) return;
    const running: (Animation | null)[] = [];
    tiles.current.forEach((el, i) => {
      const r = (i * 37) % TILES;
      running.push(animate(el, [
        { opacity: 0, transform: `translate(${(r % 2 ? 1 : -1) * 60}px, ${-80 - r * 6}px) rotate(${(r % 5 - 2) * 6}deg) scale(1.2)` },
        { opacity: 1, transform: 'none' },
      ], { duration: 620, delay: r * 45, easing: EASE, fill: 'backwards' }));
    });
    running.push(animate(band.current, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 520, delay: BAND_AT, easing: EASE, fill: 'backwards' }));
    return () => running.forEach((a) => a?.cancel());
  }, [reduced]);

  useEffect(() => {
    if (!confetti) return;
    let frame = 0;
    const timer = setTimeout(() => { frame = burst(canvas.current, box.current); }, CONFETTI_AT);
    return () => { clearTimeout(timer); cancelAnimationFrame(frame); };
    // Once per page view: flipping to the phone frame and back does not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The wordmark is held to its column: 250px type at 1280, smaller below.
  const inner = Math.min(width, 1280) - 112;
  const wordmarkType = phone ? 96 : Math.min(250, Math.floor(((inner - 48) * 1.15) / 2.15 / 2.2));
  const columns = phone ? 4 : 8;
  const rows = Array.from({ length: TILES / columns }, (_, r) => r);

  return (
    <View
      style={[styles.page, phone ? styles.pagePhone : styles.pageWide]}
      onLayout={(e: LayoutChangeEvent) => { box.current = e.nativeEvent.layout; }}
    >
      <View style={styles.grid} aria-hidden>
        {rows.map((r) => (
          <View key={r} style={styles.row}>
            {Array.from({ length: columns }, (_, c) => {
              const i = r * columns + c;
              return <View key={c} ref={(el) => { tiles.current[i] = el; }} style={[styles.tile, { backgroundColor: TONES[i % TONES.length] }]} />;
            })}
          </View>
        ))}
      </View>

      <View style={phone ? styles.bandPhone : styles.bandWide}>
        {/* The lime ground sweeps in on its own layer, so the words above it never wait for it. */}
        <View ref={band} style={[StyleSheet.absoluteFill, styles.bandGround]} />
        <View style={[styles.bandInner, phone ? styles.bandInnerPhone : styles.bandInnerWide]}>
          <View style={phone ? null : styles.left}>
            <Wordmark height={Math.round(wordmarkType / 1.05)} ink={INK} ground={LIME} />
          </View>
          <View style={[styles.right, phone ? null : styles.rightWide]}>
            <SiteP style={[styles.soon, phone && styles.soonPhone]}>{w.comingSoon}</SiteP>
            <SiteH1 style={[styles.h1, phone && styles.h1Phone]}>{w.h1}</SiteH1>
            <View style={styles.form}>
              <InterestForm locale={locale} source="home" label={w.formLabel} successMessage={w.success} ground="lime" landingPage={landingPage} />
            </View>
          </View>
        </View>
      </View>

      {confetti ? (
        <View style={styles.fx} pointerEvents="none" aria-hidden>
          {React.createElement('canvas', { ref: canvas, style: { width: '100%', height: '100%', display: 'block' } })}
        </View>
      ) : null}
    </View>
  );
}

/** 140 pieces in ink, cream, moss and lime from the middle of the band, about 2s. Returns the frame to cancel. */
function burst(c: HTMLCanvasElement | null, size: { width: number; height: number }): number {
  const ctx = c?.getContext('2d');
  if (!c || !ctx || !size.width) return 0;
  // The backing store is the box × devicePixelRatio, drawn in CSS pixels.
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(size.width * dpr);
  c.height = Math.round(size.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cols = [INK, CREAM, MOSS, LIME];
  const ps = Array.from({ length: 140 }, () => ({
    x: size.width / 2 + (Math.random() - 0.5) * 200, y: BAND_TOP + BAND_HEIGHT / 2,
    vx: (Math.random() - 0.5) * 23, vy: -Math.random() * 17 - 5,
    s: 4 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
    c: cols[Math.floor(Math.random() * cols.length)],
  }));
  let f = 0;
  let id = 0;
  const tick = () => {
    ctx.clearRect(0, 0, size.width, size.height);
    ps.forEach((p) => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.55; p.vx *= 0.985; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
    });
    if (++f < 120) id = requestAnimationFrame(tick); else ctx.clearRect(0, 0, size.width, size.height);
  };
  id = requestAnimationFrame(tick);
  return id;
}

const styles = StyleSheet.create({
  page: { position: 'relative', overflow: 'hidden', backgroundColor: CREAM },
  pageWide: { height: BODY_HEIGHT },
  pagePhone: { paddingVertical: 120 },
  grid: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, gap: 3 },
  row: { flex: 1, flexDirection: 'row', gap: 3 },
  tile: { flex: 1 },
  bandWide: { position: 'absolute', left: 0, right: 0, top: BAND_TOP, height: BAND_HEIGHT, zIndex: 3, justifyContent: 'center' },
  bandPhone: { position: 'relative', zIndex: 3 },
  bandGround: { backgroundColor: LIME, ...(Platform.OS === 'web' ? ({ transformOrigin: '0 50%' } as object) : {}) },
  bandInner: { width: '100%', alignSelf: 'center' },
  bandInnerWide: { maxWidth: 1280, paddingHorizontal: 56, flexDirection: 'row', alignItems: 'center', gap: 48 },
  bandInnerPhone: { paddingHorizontal: 20, paddingVertical: 28, gap: 18 },
  left: { flex: 1.15, minWidth: 0, overflow: 'hidden' },
  right: { gap: 18 },
  rightWide: { flex: 1, minWidth: 0 },
  soon: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 56, letterSpacing: -2.24, lineHeight: 53, color: INK },
  soonPhone: { fontSize: 44, letterSpacing: -1.76, lineHeight: 42 },
  h1: { fontFamily: fonts.body, fontWeight: '600', fontSize: 20, lineHeight: 27, color: INK },
  h1Phone: { fontSize: 18, lineHeight: 24 },
  form: { marginTop: 4 },
  fx: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 4 },
});
