/**
 * The homepage — registered as W3 · "story", drawn to the v3 design approved
 * 2 Oct 2026 (Website & Registration › Webstie & host v3 › EpicHome): a lime
 * hero between two photo strips, the giant wordmark beside three lines that read
 * on from it ("Epic days out. / trips away. / events."), three chapters, a lime
 * "Host it." with four photo cards, and an ink "Be first in." close. Below 700
 * wide it is the design's 390 layout: one column, 20px sides, four tiles a strip.
 *
 * Owner overrides of the handoff (2 Oct 2026):
 *  - both email buttons read "Join the list", not "Remind me";
 *  - no privacy link under either email box (InterestForm);
 *  - the header is SiteLayout's, not this page's.
 *
 * The page's one <h1> is "Every place worth going, planned around your crew." —
 * never "Coming soon" and never the wordmark (decision 6); the chapter titles,
 * "Host it." and "Be first in." are <h2>s in order.
 *
 * Motion (README › All motion): the highlight moves down the three lines every
 * 2.2s, and chapter 01's Day out | Trip switch flips every 3.4s — "Or ten."
 * sliding in on lime when it reaches Trip. Both pause while the tab is hidden and
 * stop after three full cycles (motion.ts: WCAG, a loop past five seconds stops),
 * resting where reduced motion starts: the first line lit, Day out, "Or ten."
 * shown. Chapter 01's loop starts when it is scrolled into view.
 *
 * Photos are Unsplash placeholders served from public/site/home (README there),
 * to be swapped before launch; the design's two randomuser.me portraits are
 * drawn as initials.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Image, Platform, Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { CREAM, DEEP_GREEN, HAIRLINE, INACTIVE, INK, INK_HOVER, INK_MUTED, LIME, LIME_TINT, ON_DEEP_GREEN, ON_INK_MUTED, fonts } from '../../../theme';
import { Icon } from '../../../components/Icon';
import { useViewport } from '../../../hooks/useViewport';
import { useRouter } from '../../../router';
import { paths } from '../../../routes';
import { InterestForm } from '../../InterestForm';
import { SiteWordmark } from '../../SiteWordmark';
import { pick } from '../../i18n';
import { EASE, onFirstView, usePrefersReducedMotion, useTabVisible } from '../../motion';
import type { SitePageProps } from '../../page';
import { SiteH1, SiteH2, SiteP } from '../../type';
import { PLAN, W3_WORDS } from './W3Story.strings';

const PHONE = 700;
const LINE_EVERY = 2200;
const FLIP_EVERY = 3400;
/** Three full cycles of each loop, ending where it began. */
const LINE_STEPS = 9;
const FLIP_STEPS = 6;

const web = Platform.OS === 'web';
/** The line-height every text the design gives none inherits from its page (body, 1.55). */
const LH = 1.55;
const DIR = '/site/home/';
const STRIP_TOP = ['00-paris-eiffel-tower', '01-venice-gondola', '02-london-thames-aerial', '03-mountains-above-cloud', '04-beach-sunrise', '05-lake-rowing-boat', '06-turquoise-lake-boat', '07-desert-road'];
const STRIP_BOTTOM = ['08-green-valley', '09-milky-way-mountains', '10-green-cliffs', '11-forest-path', '12-mountain-lake-reflection', '13-bridge-at-dusk', '14-map-and-camera', '15-dinner-table'];
const strip = (name: string) => `${DIR}strip-${name}-400.jpg`;
const DAY_PHOTOS = ['thumb-forest-path-160.jpg', 'thumb-dinner-table-160.jpg', 'thumb-green-cliffs-160.jpg'];
const TRIP_PHOTOS = ['thumb-beach-sunrise-160.jpg', 'thumb-desert-road-160.jpg', 'thumb-bridge-at-dusk-160.jpg'];
/** Sam and Nan are initials (no stock portraits of strangers); Maya keeps her photo. */
const CREW_FACES: (string | null)[] = [null, 'avatar-maya-160.jpg', null];
const CREW_TONES = [DEEP_GREEN, INK, INK];
const EXPERT_PHOTOS = ['thumb-durdle-door-160.jpg', 'thumb-mountains-above-cloud-160.jpg'];
const KIND_PHOTOS = ['host-one-off-dinner-table-600.jpg', 'host-weekly-yoga-600.jpg', 'host-course-swimming-600.jpg', 'host-on-request-kitchen-600.jpg'];

/** CSS transitions, on the web only (react-native-web passes them through). */
const transition = (property: string, duration: string) => (web ? ({ transitionProperty: property, transitionDuration: duration, transitionTimingFunction: EASE } as object) : {});

/**
 * A step counter that ticks every `every` ms while `running`, `steps` times, and
 * then holds at the end. Paused while the tab is hidden; the timer is cleared on
 * unmount and whenever it stops.
 */
function useSteps(running: boolean, every: number, steps: number): number {
  const visible = useTabVisible();
  const [n, setN] = useState(0);
  const done = n >= steps;
  useEffect(() => {
    if (!running || done || !visible) return;
    const id = setInterval(() => setN((x) => Math.min(steps, x + 1)), every);
    return () => clearInterval(id);
  }, [running, done, visible, every, steps]);
  return n;
}

function Photo({ src, style }: { src: string; style: object }) {
  return (
    <View style={[{ backgroundColor: HAIRLINE, overflow: 'hidden' }, style]} aria-hidden>
      <Image source={{ uri: src }} resizeMode="cover" accessible={false} style={{ width: '100%', height: '100%' }} />
    </View>
  );
}

function Arrow({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  );
}

export function W3Story({ locale, landingPage }: SitePageProps) {
  const w = pick(W3_WORDS, locale);
  const plan = pick(PLAN, locale);
  const { width } = useViewport();
  const { navigate } = useRouter();
  const phone = width < PHONE;
  const goHost = () => navigate(paths.siteHost(locale));

  // ---- sizes: the design's at 1280, stepping down between 700 and 1280 so nothing overflows ----
  const heroCols = width - 112 - 56;
  const markSize = phone ? Math.min(132, Math.floor((width - 40) / 2.12)) : Math.min(250, Math.floor((heroCols * 1.1) / 2.1 / 2.1));
  const lineSize = phone ? 42 : Math.max(42, Math.min(64, Math.floor(heroCols / 2.1 / 6)));
  const titleSize = phone ? 48 : Math.min(76, Math.round(width * 0.06));
  const hostSize = phone ? 72 : Math.min(120, Math.round(width * 0.094));
  const closeSize = phone ? 60 : Math.min(96, Math.round(width * 0.075));
  const cardCols = phone || width < 1000 ? 2 : 4;

  // ---- motion ----
  const reduced = usePrefersReducedMotion();
  const still = reduced || !web;
  const lineStep = useSteps(!still, LINE_EVERY, LINE_STEPS);
  const lit = still ? 0 : lineStep % 3;
  const chapterRef = useRef<View>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => onFirstView(chapterRef.current, () => setSeen(true)), []);
  const flipStep = useSteps(seen && !still, FLIP_EVERY, FLIP_STEPS);
  const resting = still || flipStep >= FLIP_STEPS;
  const trip = !resting && flipStep % 2 === 1;
  const tenShown = trip || resting;

  // ---- shared pieces ----
  const num = (n: string, color: string) => <Text style={[t.heading, { fontSize: phone ? 16 : 20, lineHeight: (phone ? 16 : 20) * LH, color }]}>{n}</Text>;
  const title = (text: string, color: string) => (
    <SiteH2 style={[t.heading, { color, fontSize: titleSize, letterSpacing: -titleSize * 0.045, lineHeight: titleSize * 0.95 }]}>{text}</SiteH2>
  );
  const sub = (text: string, color: string) => (
    <SiteP style={[t.body, { color, fontSize: phone ? 17 : 21, lineHeight: (phone ? 17 : 21) * 1.4, maxWidth: phone ? undefined : 460 }]}>{text}</SiteP>
  );
  const listHead = (text: string) => (
    <Text style={[t.listHead, phone ? { fontSize: 12, lineHeight: 12 * LH, letterSpacing: 12 * 0.06, paddingBottom: 8 } : { fontSize: 13, lineHeight: 13 * LH, letterSpacing: 13 * 0.06, paddingBottom: 10 }]}>{text}</Text>
  );
  const pill = (key: string, bg: string, children: React.ReactNode, label?: string) => (
    <View key={key} accessible={!!label} accessibilityLabel={label} style={[t.pill, { backgroundColor: bg, paddingHorizontal: phone ? 7 : 8 }]}>{children}</View>
  );
  const pillText = [t.pillText, { fontSize: phone ? 12.5 : 13, lineHeight: (phone ? 12.5 : 13) * LH }];
  const media = phone ? 52 : 64;

  /** A chapter: two equal columns on a wide page, stacked on a phone. */
  const chapter = (leftGround: string | null, left: React.ReactNode, rightGround: string | null, right: React.ReactNode, opts: { ref?: React.Ref<View>; rightGap?: number; ruleAbove?: boolean } = {}) => (
    <View ref={opts.ref} style={phone ? null : { flexDirection: 'row' }}>
      <View
        style={[
          { backgroundColor: leftGround ?? undefined, overflow: 'hidden' },
          phone
            ? { paddingTop: 36, paddingHorizontal: 20, paddingBottom: leftGround ? 32 : 24, gap: 12 }
            : { flex: 1, minWidth: 0, paddingTop: 56, paddingRight: 48, paddingBottom: 64, paddingLeft: 56, gap: 18 },
          phone && opts.ruleAbove && { borderTopWidth: 1, borderTopColor: HAIRLINE },
        ]}
      >
        {left}
      </View>
      <View
        style={[
          { backgroundColor: rightGround ?? undefined, justifyContent: 'center' },
          phone
            ? { paddingTop: 22, paddingHorizontal: 20, paddingBottom: rightGround ? 28 : 30 }
            : { flex: 1, minWidth: 0, paddingTop: 56, paddingRight: 56, paddingBottom: 64, paddingLeft: 48 },
          opts.rightGap ? { gap: opts.rightGap } : null,
        ]}
      >
        {right}
      </View>
    </View>
  );

  const photoStrip = (names: string[], bottom: boolean) => {
    const gap = phone ? 3 : 4;
    return (
      <View style={{ flexDirection: 'row', gap, paddingHorizontal: gap, paddingBottom: bottom ? gap : 0, backgroundColor: LIME }}>
        {names.slice(0, phone ? 4 : 8).map((n) => <Photo key={n} src={strip(n)} style={{ flex: 1, minWidth: 0, height: phone ? 96 : 150 }} />)}
      </View>
    );
  };

  return (
    <View style={{ backgroundColor: CREAM }}>
      {/* Hero */}
      {photoStrip(STRIP_TOP, false)}
      <View
        style={[
          { backgroundColor: LIME },
          phone
            ? { paddingTop: 26, paddingHorizontal: 20, paddingBottom: 28, gap: 14 }
            : { paddingTop: 44, paddingHorizontal: 56, paddingBottom: 48, flexDirection: 'row', alignItems: 'center', gap: 56 },
        ]}
      >
        {/* The design sets the mark as text on a 0.8 line plus 10px (6 on a phone); the outlined
            mark's own box is 1.114em, so it sits in the design's box, raised until its E's top
            is 0.044em below that box's top, as the design's is (measured). */}
        <View style={[{ height: Math.round(markSize * 0.8) + (phone ? 6 : 10) }, phone ? { alignSelf: 'flex-start' } : { flex: 1.1, minWidth: 0 }]}>
          <View style={{ marginTop: -Math.round(markSize * 0.173) }}>
            <SiteWordmark height={markSize / 1.05} ink={INK} ground={LIME} />
          </View>
        </View>
        <View style={phone ? { gap: 14 } : { flex: 1, minWidth: 0, gap: 16 }}>
          <SiteP style={[t.tag, phone ? { fontSize: 15, lineHeight: 15 * LH, paddingVertical: 5, paddingHorizontal: 10 } : { fontSize: 18, lineHeight: 18 * LH, paddingVertical: 6, paddingHorizontal: 12 }]}>
            {w.comingSoon}
          </SiteP>
          <View style={{ gap: phone ? 1 : 2 }}>
            {w.lines.map((line, i) => {
              const on = i === lit;
              return (
                <Text key={line} style={[t.heading, { fontSize: lineSize, letterSpacing: -lineSize * 0.045, lineHeight: lineSize * (phone ? 1 : 0.98) }]}>
                  <Text
                    style={[
                      { backgroundColor: on ? INK : 'transparent', color: on ? LIME : INK },
                      phone ? { paddingHorizontal: 8, paddingBottom: 3, marginLeft: -8 } : { paddingHorizontal: 10, paddingBottom: 4, marginLeft: -10 },
                      transition('background-color, color', '350ms'),
                    ]}
                  >
                    {line}
                  </Text>
                </Text>
              );
            })}
          </View>
          <SiteH1 style={[t.body, { fontWeight: '500', fontSize: phone ? 17 : 20, lineHeight: (phone ? 17 : 20) * 1.4 }]}>{w.h1}</SiteH1>
          <View style={{ marginTop: phone ? 4 : 6 }}>
            <InterestForm
              locale={locale} source="home" label={w.remind} successMessage={w.success} ground="lime"
              landingPage={landingPage} look="flat" gap={phone ? 14 : 16} maxWidth={9999}
            />
          </View>
        </View>
      </View>
      {photoStrip(STRIP_BOTTOM, true)}

      {/* 01 · One day. Or ten. */}
      {chapter(
        DEEP_GREEN,
        <>
          {num(w.ch1.n, LIME)}
          <SiteH2 style={[t.heading, { color: CREAM, fontSize: titleSize, letterSpacing: -titleSize * 0.045, lineHeight: titleSize * 0.95 }]}>
            <Text style={{ display: 'block' } as object}>{w.ch1.one}</Text>
            <Text
              style={[
                { display: 'block', opacity: tenShown ? 1 : 0, transform: [{ translateX: tenShown ? 0 : '60%' }] } as object,
                web && ({ transitionProperty: 'opacity, transform', transitionDuration: '500ms, 550ms', transitionTimingFunction: EASE } as object),
              ]}
            >
              <Text style={{ backgroundColor: LIME, color: INK, paddingHorizontal: phone ? 8 : 12, paddingBottom: phone ? 3 : 4, marginLeft: phone ? -8 : -12 }}>{w.ch1.ten}</Text>
            </Text>
          </SiteH2>
          {sub(w.ch1.sub, ON_DEEP_GREEN)}
        </>,
        null,
        <>
          <View style={{ flexDirection: 'row', gap: 2 }}>
            {[plan.dayOut, plan.trip].map((label, i) => (
              <View
                key={label}
                style={[
                  { flex: 1, justifyContent: 'center', backgroundColor: (i === 1) === trip ? LIME : INACTIVE },
                  phone ? { height: 42, paddingHorizontal: 12 } : { height: 46, paddingHorizontal: 14 },
                  transition('background-color', '350ms'),
                ]}
              >
                <Text style={[t.heading, { fontWeight: '700', fontSize: phone ? 15 : 16, lineHeight: (phone ? 15 : 16) * LH }]}>{label}</Text>
              </View>
            ))}
          </View>
          {listHead(trip ? plan.tripHead : plan.dayHead)}
          <View style={{ marginTop: phone ? -14 : -20 }}>
            {(trip ? plan.tripRows : plan.dayRows).map((r, i) => (
              <View key={r.name} style={[t.row, phone ? { gap: 12, paddingVertical: 11 } : { gap: 16, paddingVertical: 12 }]}>
                <Text style={[t.heading, { width: phone ? 44 : 56, fontWeight: '700', fontSize: phone ? 14 : 16, lineHeight: (phone ? 14 : 16) * LH }]}>{r.t}</Text>
                <View style={{ flex: 1, minWidth: 0, gap: phone ? 0 : 3 }}>
                  <Text style={[t.body, { fontWeight: '700', fontSize: phone ? 16 : 19, lineHeight: (phone ? 16 : 19) * LH }]}>{r.name}</Text>
                  <Text style={[t.body, { fontSize: phone ? 13 : 14, lineHeight: (phone ? 13 : 14) * LH, color: INK_MUTED }]}>{r.meta}</Text>
                </View>
                <Photo src={DIR + (trip ? TRIP_PHOTOS : DAY_PHOTOS)[i]} style={{ width: media, height: media, borderRadius: 8, flexShrink: 0 }} />
              </View>
            ))}
          </View>
        </>,
        { ref: chapterRef, rightGap: phone ? 14 : 20 },
      )}

      {/* 02 · Built around your crew. */}
      {chapter(
        null,
        <>
          {num(w.ch2.n, INK)}
          {title(w.ch2.title, INK)}
          {sub(w.ch2.sub, INK)}
        </>,
        INACTIVE,
        <>
          {listHead(w.ch2.head)}
          {w.ch2.crew.map((p, i) => {
            const face = CREW_FACES[i];
            return (
              <View key={p.name} style={[t.row, phone ? { gap: 12, paddingVertical: 12 } : { gap: 16, paddingVertical: 14 }]}>
                {face ? (
                  <Photo src={DIR + face} style={{ width: media, height: media, borderRadius: media / 2, flexShrink: 0 }} />
                ) : (
                  <View aria-hidden style={[t.initials, { width: media, height: media, borderRadius: media / 2, backgroundColor: CREW_TONES[i] }]}>
                    <Text style={[t.heading, { fontSize: Math.round(media * 0.4), color: CREAM }]}>{p.name.charAt(0)}</Text>
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0, gap: phone ? 6 : 7 }}>
                  <Text style={[t.heading, { fontWeight: '700', fontSize: phone ? 16 : 19, lineHeight: (phone ? 16 : 19) * LH }]}>{p.name}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: phone ? 5 : 6 }}>
                    <Text style={[t.likes, phone ? { fontSize: 11, lineHeight: 11 * LH, letterSpacing: 11 * 0.05 } : { fontSize: 12, lineHeight: 12 * LH, letterSpacing: 12 * 0.05, marginRight: 2 }]}>{w.ch2.likes}</Text>
                    {p.likes.map((like, j) => pill(like, j === 0 ? LIME : CREAM, <Text style={[pillText, web && ({ whiteSpace: 'nowrap' } as object)]}>{like}</Text>))}
                  </View>
                </View>
              </View>
            );
          })}
        </>,
        { ruleAbove: true },
      )}

      {/* 03 · Book an expert. */}
      {chapter(
        INK,
        <>
          {num(w.ch3.n, LIME)}
          {title(w.ch3.title, CREAM)}
          {sub(w.ch3.sub, ON_INK_MUTED)}
        </>,
        null,
        <>
          {listHead(w.ch3.head)}
          {w.ch3.experts.map((e, i) => (
            <View key={e.name} style={[t.row, phone ? { gap: 12, paddingVertical: 12 } : { gap: 16, paddingVertical: 14 }]}>
              <Photo src={DIR + EXPERT_PHOTOS[i]} style={{ width: media, height: media, borderRadius: 8, flexShrink: 0 }} />
              <View style={{ flex: 1, minWidth: 0, gap: phone ? 5 : 6 }}>
                <Text style={[t.heading, { fontWeight: '700', fontSize: phone ? 16 : 19, lineHeight: (phone ? 16 : 19) * LH }]}>{e.name}</Text>
                <View style={{ flexDirection: 'row', flexWrap: phone ? 'wrap' : 'nowrap', gap: phone ? 5 : 6 }}>
                  {pill('place', LIME_TINT, <Text style={pillText}>{e.place}</Text>)}
                  {pill('guide', LIME, (
                    <>
                      <Text style={pillText}>{e.guide}</Text>
                      <Icon name="favourite" size={phone ? 11 : 12} color={INK} fill />
                      <Text style={pillText}>{e.rating}</Text>
                    </>
                  ), `${e.guide}, ${w.ch3.rated} ${e.rating}`)}
                </View>
              </View>
            </View>
          ))}
        </>,
      )}

      {/* 04 · Host it. */}
      <View style={[{ backgroundColor: LIME }, phone ? { paddingTop: 36, paddingHorizontal: 20, paddingBottom: 34, gap: 16 } : { paddingTop: 56, paddingHorizontal: 56, paddingBottom: 60, gap: 30 }]}>
        <View style={phone ? { gap: 16 } : { flexDirection: 'row', gap: 48, alignItems: 'flex-end' }}>
          <View style={phone ? { gap: 16 } : { flex: 1, minWidth: 0, gap: 18 }}>
            {num(w.ch4.n, INK)}
            <SiteH2 style={[t.heading, { fontSize: hostSize, letterSpacing: -hostSize * 0.055, lineHeight: hostSize * 0.86 }]}>{w.ch4.title}</SiteH2>
          </View>
          <SiteP style={[t.body, { fontWeight: '600' }, phone ? { fontSize: 17, lineHeight: 17 * 1.4 } : { flex: 1, minWidth: 0, fontSize: 22, lineHeight: 22 * 1.4 }]}>{w.ch4.sub}</SiteP>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: phone ? 8 : 20 }}>
          {w.ch4.kinds.map((k, i) => (
            <Pressable
              key={k.tag}
              accessibilityRole="link"
              accessibilityLabel={`${k.tag}: ${k.title.replace('\n', ' ')}`}
              onPress={goHost}
              style={({ hovered }: any) => [
                t.card,
                { width: `calc((100% - ${(cardCols - 1) * (phone ? 8 : 20)}px) / ${cardCols})` as unknown as number },
                web && !phone && hovered ? { transform: [{ translateY: -4 }] } : null,
                transition('transform', '200ms'),
              ]}
            >
              <Photo src={DIR + KIND_PHOTOS[i]} style={{ height: phone ? 110 : 190 }} />
              <View style={phone ? { paddingTop: 10, paddingHorizontal: 10, paddingBottom: 12, gap: 6 } : { paddingTop: 14, paddingHorizontal: 16, paddingBottom: 16, gap: 8 }}>
                <Text style={[t.tag, phone ? { fontSize: 11.5, lineHeight: 11.5 * LH, paddingVertical: 2, paddingHorizontal: 6 } : { fontSize: 13, lineHeight: 13 * LH, paddingVertical: 3, paddingHorizontal: 8 }]}>{k.tag}</Text>
                <Text style={[t.heading, phone ? { fontSize: 16, letterSpacing: -16 * 0.025, lineHeight: 16 * 1.05 } : { fontSize: 23, letterSpacing: -23 * 0.03, lineHeight: 23 * 1.02 }]}>{k.title}</Text>
                {phone ? null : <Text style={[t.body, { fontSize: 13.5, lineHeight: 13.5 * LH, color: INK_MUTED, marginTop: 2 }]}>{k.eg}</Text>}
              </View>
            </Pressable>
          ))}
        </View>

        <View style={phone ? { gap: 16 } : { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
          <Pressable
            accessibilityRole="link"
            onPress={goHost}
            style={({ hovered }: any) => [
              t.hostButton,
              phone ? { height: 54, paddingHorizontal: 18 } : { height: 58, width: 360, paddingHorizontal: 20 },
              { backgroundColor: hovered ? INK_HOVER : INK },
            ]}
          >
            <Text style={[t.body, { fontWeight: '700', fontSize: phone ? 16 : 17, color: CREAM }]}>{w.ch4.cta}</Text>
            <Arrow color={CREAM} />
          </Pressable>
          <Text style={[t.body, { fontWeight: '600', fontSize: phone ? 13.5 : 15, lineHeight: (phone ? 13.5 : 15) * LH }]}>{w.ch4.small}</Text>
        </View>
      </View>

      {/* Close: Be first in. */}
      <View style={[{ backgroundColor: INK }, phone ? { paddingTop: 36, paddingHorizontal: 20, paddingBottom: 40, gap: 16 } : { padding: 56, flexDirection: 'row', gap: 48, alignItems: 'flex-end' }]}>
        <SiteH2 style={[t.heading, { color: LIME, fontSize: closeSize, letterSpacing: -closeSize * 0.05, lineHeight: closeSize * 0.9 }, !phone && { flex: 1, minWidth: 0 }]}>
          {w.close}
        </SiteH2>
        <View style={phone ? undefined : { flex: 1, minWidth: 0 }}>
          <InterestForm
            locale={locale} source="home" label={w.remind} successMessage={w.success} ground="ink"
            landingPage={landingPage} look="flat" gap={phone ? 16 : 10} maxWidth={9999}
          />
        </View>
      </View>
    </View>
  );
}

const t = {
  heading: { fontFamily: fonts.heading, fontWeight: '800' as const, color: INK },
  body: { fontFamily: fonts.body, color: INK },
  tag: { alignSelf: 'flex-start' as const, backgroundColor: INK, color: LIME, fontFamily: fonts.heading, fontWeight: '800' as const },
  listHead: {
    fontFamily: fonts.heading, fontWeight: '700' as const, textTransform: 'uppercase' as const, color: INK,
    borderBottomWidth: 1, borderBottomColor: HAIRLINE,
  },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  initials: { alignItems: 'center' as const, justifyContent: 'center' as const, flexShrink: 0 },
  likes: { fontFamily: fonts.body, fontWeight: '700' as const, textTransform: 'uppercase' as const, color: INK_MUTED },
  pill: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 3, paddingVertical: 3 },
  pillText: { fontFamily: fonts.body, fontWeight: '600' as const, color: INK },
  card: { backgroundColor: CREAM },
  hostButton: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
};
