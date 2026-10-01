/**
 * W4 · The phone (Website & Registration › Homepage W4). Copy and the form on
 * the left; on the right a 560px lime panel holding a phone (340 × 700, radius
 * 50, 10px ink bezel) that shows app screen 1h-1 switching Day out ↔ Trip.
 * Below 700 wide the MB rules apply: one column, 20px sides, the phone scaled to
 * fit 350 wide.
 *
 * Owner overrides on the design:
 *  - one <h1>, "Every place worth going, planned around your crew", at 21px/700
 *    directly under the "Coming soon to iPhone and Android" tag; the 92px
 *    "Plans that work for everyone." stays the visual headline as a styled <p>,
 *    visible on first paint and never animated;
 *  - the Day out ↔ Trip loop (every 3.2s) pauses while the tab is hidden, stops
 *    after three cycles on Day out, and does not run under reduced motion.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { CREAM, INK, LIME, fonts } from '../../../theme';
import { useViewport } from '../../../hooks/useViewport';
import { InterestForm } from '../../InterestForm';
import { pick } from '../../i18n';
import { EASE, animate, usePrefersReducedMotion } from '../../motion';
import type { SitePageProps } from '../../page';
import { SiteH1, SiteP } from '../../type';
import { PhoneScreen1h, settle, useFlipLoop } from './PhoneScreen1h';
import { PLAN } from './W3Story.strings';
import { W4_WORDS } from './W4Phone.strings';

const PHONE = 700;
/** Three cycles of Day out → Trip → Day out. */
const FLIPS = 6;
/** The phone with its bezel: 340 × 700 plus 10px all round. */
const PHONE_W = 360;
const PHONE_H = 720;
const web = Platform.OS === 'web';

export function W4Phone({ locale, landingPage }: SitePageProps) {
  const w = pick(W4_WORDS, locale);
  const plan = pick(PLAN, locale);
  const { width } = useViewport();
  const phone = width < PHONE;

  const reduced = usePrefersReducedMotion();
  const still = reduced || !web;
  const [trip, setTrip] = useState(false);
  const indRef = useRef<View>(null);
  useEffect(() => { if (still) { settle(indRef.current); setTrip(false); } }, [still]);

  useFlipLoop({
    enabled: !still, first: 3200, every: 3200, max: FLIPS,
    onFlip: (n) => {
      const toTrip = n % 2 === 1;
      setTrip(toTrip);
      // The inline style already holds the new end; this draws the slide to it.
      animate(indRef.current, [
        { transform: toTrip ? 'translateX(0)' : 'translateX(100%)' },
        { transform: toTrip ? 'translateX(100%)' : 'translateX(0)' },
      ], { duration: 450, easing: EASE });
    },
  });

  const headline = phone ? 56 : 92;
  // MB rules: the phone shrinks to fit the column (350 at 390 wide), never grows.
  const scale = phone ? Math.min(1, (width - 40) / PHONE_W) : 1;

  const device = (
    <View style={{ width: PHONE_W, height: PHONE_H, borderRadius: 60, padding: 10, backgroundColor: INK }}>
      <View style={{ flex: 1, borderRadius: 50, overflow: 'hidden', backgroundColor: CREAM }}>
        <PhoneScreen1h words={plan} title={w.phoneTitle} sub={w.phoneSub} onTrip={trip} indRef={indRef} />
      </View>
    </View>
  );

  return (
    <View style={[{ backgroundColor: CREAM }, !phone && { flexDirection: 'row', minHeight: 820 }]}>
      <View style={phone
        ? { paddingTop: 32, paddingHorizontal: 20, paddingBottom: 36, gap: 18 }
        : { flex: 1, minWidth: 0, justifyContent: 'center', gap: 26, paddingLeft: 56, paddingRight: 64, paddingVertical: 48 }}
      >
        <SiteP style={{
          alignSelf: 'flex-start', backgroundColor: LIME, color: INK, fontFamily: fonts.body, fontWeight: '700',
          fontSize: phone ? 13 : 14, letterSpacing: (phone ? 13 : 14) * 0.08, textTransform: 'uppercase', paddingVertical: 6, paddingHorizontal: 10,
        }}>
          {w.tag}
        </SiteP>
        <View style={{ gap: phone ? 10 : 12 }}>
          <SiteH1 style={{ fontFamily: fonts.heading, fontWeight: '700', fontSize: phone ? 18 : 21, lineHeight: (phone ? 18 : 21) * 1.3, color: INK }}>
            {w.h1}
          </SiteH1>
          <SiteP style={{ fontFamily: fonts.heading, fontWeight: '800', fontSize: headline, letterSpacing: -headline * 0.05, lineHeight: headline * 0.92, color: INK }}>
            {w.headline}
          </SiteP>
        </View>
        <SiteP style={{ fontFamily: fonts.body, fontSize: phone ? 18 : 21, lineHeight: (phone ? 18 : 21) * 1.4, maxWidth: 520, color: INK }}>
          {w.line}
        </SiteP>
        <InterestForm locale={locale} source="home" label={w.label} successMessage={w.success} ground="cream" landingPage={landingPage} maxWidth={560} />
      </View>

      <View style={phone
        ? { backgroundColor: LIME, borderTopWidth: 2, borderTopColor: INK, paddingTop: 28, paddingHorizontal: 20, paddingBottom: 32, alignItems: 'center' }
        // The header's links float over this column (SiteLayout, W4), so the phone
        // starts below them: the design's bezel tucks 10px into the 84px header.
        : { width: 560, backgroundColor: LIME, alignItems: 'center', paddingTop: 74, overflow: 'hidden' }}
      >
        {/* A scaled box keeps the layout size equal to what is drawn. */}
        <View style={{ width: PHONE_W * scale, height: PHONE_H * scale }}>
          <View style={{ position: 'absolute', left: (PHONE_W * scale - PHONE_W) / 2, top: (PHONE_H * scale - PHONE_H) / 2, transform: [{ scale }] }}>
            {device}
          </View>
        </View>
      </View>
    </View>
  );
}
