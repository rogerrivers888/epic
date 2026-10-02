/**
 * W3 · The story in four (Website & Registration › Homepage W3; Mobile MB1).
 * A lime hero, four numbered chapters and an ink close, one scrolling page. Below
 * 700 wide it is EpicMobile's `home` screen, drawn at 390: one column, 20px sides.
 *
 * Owner overrides on the design:
 *  - one <h1>, "Every place worth going, planned around your crew", sits in the
 *    hero just above "An app for days out…", in that line's 24px/600 style;
 *    "Coming soon." is a styled <p>; the five chapter titles are <h2>s in order;
 *  - "Coming soon." (the LCP text) is never animated;
 *  - chapter 01's "Or ten." / Day↔Trip loop starts when the chapter is scrolled
 *    into view, pauses while the tab is hidden, runs three full cycles and then
 *    rests on "Or ten." + Trip — the state reduced motion shows from the start;
 *  - "Become a host" navigates in-app to the host page.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { CREAM, DEEP_GREEN, HAIRLINE, INK, INK_HOVER, INK_MUTED, LIME, LIME_TINT, MOSS, NEUTRAL, fonts } from '../../../theme';
import { Icon } from '../../../components/Icon';
import { useViewport } from '../../../hooks/useViewport';
import { useRouter } from '../../../router';
import { paths } from '../../../routes';
import { InterestForm } from '../../InterestForm';
import { pick } from '../../i18n';
import { EASE, animate, onFirstView, usePrefersReducedMotion } from '../../motion';
import type { SitePageProps } from '../../page';
import { SiteH1, SiteH2, SiteP } from '../../type';
import { Avatar, ModeSwitch, PlanList, Thumb, settle, useFlipLoop } from './PhoneScreen1h';
import { PLAN, W3_WORDS } from './W3Story.strings';

const PHONE = 700;
/** Three out-and-back cycles, then one more flip to rest on "Or ten." + Trip. */
const FLIPS = 7;

const CREW_TONES = [LIME, HAIRLINE, NEUTRAL];
const EXPERT_TONES = [MOSS, INK];
const KIND_TONES = [MOSS, INK, HAIRLINE, DEEP_GREEN];

const NOWRAP = (Platform.OS === 'web' ? { whiteSpace: 'nowrap' } : {}) as object;

export function W3Story({ locale, landingPage }: SitePageProps) {
  const w = pick(W3_WORDS, locale);
  const plan = pick(PLAN, locale);
  const { width } = useViewport();
  const { navigate } = useRouter();
  const phone = width < PHONE;
  const twoByTwo = !phone && width < 1000;

  // Big type steps down between 700 and 1280 so nothing overflows; at 1280+ it is the design's.
  // "Coming soon." on one line at any width (owner, 2 Oct 2026, on his iPhone: "far
  // too large at 390"): about 48px at 390, growing with the width to 200.
  const heroSize = phone ? Math.max(40, Math.min(76, Math.floor((width - 40) / 7.2))) : Math.min(200, Math.floor((width - 112) / 5.9));
  const titleSize = phone ? 48 : Math.min(76, Math.round(width * 0.06));
  const hostSize = phone ? 72 : Math.min(120, Math.round(width * 0.094));
  const closeSize = phone ? 60 : Math.min(96, Math.round(width * 0.075));
  const bodySize = phone ? 17 : 21;

  // ---- chapter 01's loop ----
  const reduced = usePrefersReducedMotion();
  const still = reduced || Platform.OS !== 'web';
  const chapterRef = useRef<View>(null);
  const tenRef = useRef<Text>(null);
  const indRef = useRef<View>(null);
  const dayRef = useRef<View>(null);
  const tripRef = useRef<View>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => onFirstView(chapterRef.current, () => setSeen(true)), []);
  useEffect(() => { if (still) settle(tenRef.current, indRef.current, dayRef.current, tripRef.current); }, [still]);

  useFlipLoop({
    enabled: seen && !still, first: 600, every: 3600, max: FLIPS,
    onFlip: (n) => {
      const o = { easing: EASE, fill: 'forwards' as const };
      const ten = tenRef.current, ind = indRef.current, day = dayRef.current, trip = tripRef.current;
      if (n % 2 === 1) {
        animate(ten, [{ opacity: 0, transform: 'translateX(110%)' }, { opacity: 1, transform: 'none' }], { ...o, duration: 560 });
        animate(ind, [{ transform: 'none' }, { transform: 'translateX(100%)' }], { ...o, duration: 450, delay: 420 });
        animate(day, [{ opacity: 1 }, { opacity: 0 }], { ...o, duration: 350, delay: 420 });
        animate(trip, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { ...o, duration: 450, delay: 560 });
      } else {
        animate(ind, [{ transform: 'translateX(100%)' }, { transform: 'none' }], { ...o, duration: 450 });
        animate(trip, [{ opacity: 1 }, { opacity: 0 }], { ...o, duration: 350 });
        animate(day, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { ...o, duration: 450, delay: 140 });
        animate(ten, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-110%)' }], { ...o, duration: 420, delay: 140 });
      }
    },
  });

  // ---- shared pieces ----
  const num = (n: string) => <Text style={[t.num, { fontSize: phone ? 17 : 20 }]}>{n}</Text>;
  const sub = (text: string) => (
    <SiteP style={[t.body, { fontSize: bodySize, lineHeight: bodySize * 1.4, maxWidth: phone ? undefined : 460 }]}>{text}</SiteP>
  );
  const titleStyle = [t.title, { fontSize: titleSize, letterSpacing: -titleSize * 0.045, lineHeight: titleSize * 0.95 }];
  /** One chapter: two columns with a 2px rule between (wide), one column (phone). */
  const chapter = phone ? t.chapterPhone : t.chapterWide;
  const left = phone ? t.leftPhone : t.leftWide;
  const right = phone ? t.rightPhone : t.rightWide;
  const head = (text: string) => <Text style={t.listHead}>{text}</Text>;
  const pill = (key: string, bg: string, children: React.ReactNode, label?: string) => (
    <View key={key} accessible={!!label} accessibilityLabel={label} style={[t.pill, { backgroundColor: bg, paddingHorizontal: phone ? 7 : 8 }]}>{children}</View>
  );
  const pillText = { fontFamily: fonts.body, fontWeight: '600' as const, fontSize: phone ? 12 : 13, color: INK };
  const listRow = (key: string, media: React.ReactNode, name: string, pills: React.ReactNode) => (
    <View key={key} style={[t.listRow, { gap: phone ? 12 : 16, paddingVertical: phone ? 12 : 14 }]}>
      {media}
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <Text style={[t.rowName, { fontSize: phone ? 16 : 19 }]}>{name}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{pills}</View>
      </View>
    </View>
  );
  const media = phone ? 52 : 64;

  return (
    <View style={{ backgroundColor: CREAM }}>
      {/* Hero */}
      <View style={[t.hero, phone ? t.heroPhone : t.heroWide]}>
        <SiteP style={[t.coming, NOWRAP, { fontSize: heroSize, letterSpacing: -heroSize * (phone ? 0.055 : 0.06), lineHeight: heroSize * (phone ? 0.86 : 0.84) }]}>
          {w.comingSoon}
        </SiteP>
        <View style={[t.heroRow, phone ? t.heroRowPhone : t.heroRowWide]}>
          <View style={phone ? { gap: 6 } : { flex: 1, minWidth: 0, gap: 6 }}>
            <SiteH1 style={[t.heroLine, { fontSize: phone ? 19 : 24, lineHeight: phone ? 19 * 1.35 : 24 * 1.3 }]}>{w.h1}</SiteH1>
            {/* One line on a phone: the heading says it; the second sentence repeated it. */}
            {phone ? null : <SiteP style={[t.heroLine, { fontSize: 24, lineHeight: 24 * 1.3 }]}>{w.line}</SiteP>}
          </View>
          <View style={phone ? undefined : { flex: 1, minWidth: 0 }}>
            <InterestForm locale={locale} source="home" label={w.remind} successMessage={w.success} ground="lime" landingPage={landingPage} maxWidth={phone ? 9999 : 640} />
          </View>
        </View>
      </View>

      {/* 01 · One day. Or ten. */}
      <View ref={chapterRef} style={chapter}>
        <View style={left}>
          {num(w.ch1.n)}
          {/* The heading is one <h2>; "Or ten." is a block inside it so it can slide. */}
          <SiteH2 style={[...titleStyle, { overflow: 'hidden', paddingLeft: phone ? 10 : 12, marginLeft: phone ? -10 : -12 }]}>
            {w.ch1.one}{' '}
            <Text
              ref={tenRef}
              style={{ display: 'flex', flexDirection: 'row', opacity: still ? 1 : 0, transform: [{ translateX: still ? 0 : '110%' }] }}
            >
              <Text style={{ backgroundColor: LIME, paddingHorizontal: phone ? 10 : 12, paddingBottom: phone ? 3 : 4, marginLeft: phone ? -10 : -12 }}>{w.ch1.ten}</Text>
            </Text>
          </SiteH2>
          {sub(w.ch1.sub)}
        </View>
        <View style={[right, phone ? { gap: 14 } : { gap: 20 }]}>
          <ModeSwitch size={phone ? 'md' : 'lg'} words={plan} onTrip={still} indRef={indRef} />
          <View style={{ height: phone ? 290 : 300 }}>
            <View ref={dayRef} style={[t.fill, { opacity: still ? 0 : 1 }]}>
              <PlanList size={phone ? 'md' : 'lg'} head={plan.dayHead} rows={plan.dayRows} toneFrom={0} />
            </View>
            <View ref={tripRef} style={[t.fill, { opacity: still ? 1 : 0 }]}>
              <PlanList size={phone ? 'md' : 'lg'} head={plan.tripHead} rows={plan.tripRows} toneFrom={3} />
            </View>
          </View>
        </View>
      </View>

      {/* 02 · Built around your crew. */}
      <View style={chapter}>
        <View style={left}>
          {num(w.ch2.n)}
          <SiteH2 style={titleStyle}>{w.ch2.title}</SiteH2>
          {sub(w.ch2.sub)}
        </View>
        <View style={right}>
          {head(w.ch2.head)}
          {w.ch2.crew.map((p, i) => listRow(
            p.name,
            <Avatar size={media} tone={CREW_TONES[i % CREW_TONES.length]} name={p.name} />,
            p.name,
            p.likes.map((like, j) => pill(like, j === 0 ? LIME : LIME_TINT, <Text style={pillText}>{like}</Text>)),
          ))}
        </View>
      </View>

      {/* 03 · Book an expert. */}
      <View style={chapter}>
        <View style={left}>
          {num(w.ch3.n)}
          <SiteH2 style={titleStyle}>{w.ch3.title}</SiteH2>
          {sub(w.ch3.sub)}
        </View>
        <View style={right}>
          {head(w.ch3.head)}
          {w.ch3.experts.map((e, i) => listRow(
            e.name,
            <Thumb size={media} tone={EXPERT_TONES[i % EXPERT_TONES.length]} />,
            e.name,
            [
              pill('place', LIME_TINT, <Text style={pillText}>{e.place}</Text>),
              pill('guide', LIME, (
                <>
                  <Text style={pillText}>{e.guide}</Text>
                  <Icon name="favourite" size={phone ? 11 : 12} color={INK} fill />
                  <Text style={pillText}>{e.rating}</Text>
                </>
              ), `${e.guide}, ${w.ch3.rated} ${e.rating}`),
            ],
          ))}
        </View>
      </View>

      {/* 04 · Host it. */}
      <View style={[t.host, phone ? t.hostPhone : t.hostWide]}>
        <View style={phone ? { gap: 16 } : { flexDirection: 'row', gap: 48, alignItems: 'flex-end' }}>
          <View style={phone ? { gap: 16 } : { flex: 1, minWidth: 0, gap: 18 }}>
            {num(w.ch4.n)}
            <SiteH2 style={[t.title, { fontSize: hostSize, letterSpacing: -hostSize * 0.055, lineHeight: hostSize * 0.86 }]}>{w.ch4.title}</SiteH2>
          </View>
          <SiteP style={[t.hostSub, phone ? { fontSize: 18, lineHeight: 18 * 1.35 } : { flex: 1, minWidth: 0, fontSize: 23, lineHeight: 23 * 1.35 }]}>{w.ch4.sub}</SiteP>
        </View>

        <View style={[{ borderTopWidth: 2, borderTopColor: INK }, !phone && { flexDirection: 'row', flexWrap: 'wrap' }]}>
          {w.ch4.kinds.map((k, i) => {
            const tone = KIND_TONES[i % KIND_TONES.length];
            if (phone) {
              return (
                <View key={k.tag} style={t.kindRow}>
                  <Thumb size={56} tone={tone} />
                  <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                    <Text style={[t.kindTag, { fontSize: 12, paddingVertical: 2, paddingHorizontal: 6 }]}>{k.tag}</Text>
                    <Text style={t.kindTitlePhone}>{k.title}</Text>
                  </View>
                </View>
              );
            }
            const cols = twoByTwo ? 2 : 4;
            const col = i % cols;
            const lastCol = col === cols - 1;
            return (
              <View
                key={k.tag}
                style={{
                  width: `${100 / cols}%`, gap: 14,
                  paddingTop: 22, paddingBottom: twoByTwo ? 22 : 0,
                  paddingLeft: col === 0 ? 0 : 20, paddingRight: lastCol ? 0 : 20,
                  borderRightWidth: lastCol ? 0 : 2, borderRightColor: INK,
                  borderTopWidth: twoByTwo && i >= cols ? 2 : 0, borderTopColor: INK,
                }}
              >
                <Text style={[t.kindTag, { fontSize: 14, paddingVertical: 4, paddingHorizontal: 8 }]}>{k.tag}</Text>
                <Text style={t.kindTitle}>{k.title}</Text>
                <View style={t.kindCard}>
                  <Thumb size={64} tone={tone} />
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <Text style={t.kindCardName}>{k.card}</Text>
                    <Text style={t.kindCardMeta}>{k.meta}</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>

        <Pressable
          accessibilityRole="link"
          onPress={() => navigate(paths.siteHost(locale))}
          style={({ hovered }: any) => [
            t.hostButton,
            phone ? { height: 56, paddingHorizontal: 16, marginTop: 4 } : { height: 58, width: 360, paddingHorizontal: 20, alignSelf: 'flex-start' },
            { backgroundColor: hovered ? INK_HOVER : INK },
          ]}
        >
          <Text style={t.hostButtonText}>{w.ch4.cta}</Text>
          <Icon name="forward" size={20} color={CREAM} strokeWidth={2.4} />
        </Pressable>
      </View>

      {/* Close: Be first in. */}
      <View style={phone ? t.closePhone : t.closeWide}>
        <SiteH2 style={[t.closeTitle, { fontSize: closeSize, letterSpacing: -closeSize * 0.05, lineHeight: closeSize * 0.9 }, !phone && { flex: 1, minWidth: 0 }]}>
          {w.close}
        </SiteH2>
        <View style={phone ? undefined : { flex: 1, minWidth: 0 }}>
          <InterestForm locale={locale} source="home" label={w.remind} successMessage={w.success} ground="ink" landingPage={landingPage} maxWidth={phone ? 9999 : 640} />
        </View>
      </View>
    </View>
  );
}

const rule = { borderTopWidth: 2, borderTopColor: INK };

const t = {
  hero: { backgroundColor: LIME },
  heroWide: { paddingTop: 40, paddingHorizontal: 56, paddingBottom: 56, gap: 26 },
  heroPhone: { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 32, gap: 18 },
  coming: { fontFamily: fonts.heading, fontWeight: '800' as const, color: INK },
  heroRow: { ...rule },
  heroRowWide: { flexDirection: 'row' as const, gap: 48, alignItems: 'flex-end' as const, paddingTop: 22 },
  heroRowPhone: { gap: 18, paddingTop: 14 },
  heroLine: { fontFamily: fonts.body, fontWeight: '600' as const, color: INK },

  chapterWide: { flexDirection: 'row' as const, ...rule },
  chapterPhone: { ...rule, paddingTop: 32, paddingHorizontal: 20, paddingBottom: 36, gap: 14 },
  leftWide: { flex: 1, minWidth: 0, paddingTop: 48, paddingRight: 48, paddingBottom: 56, paddingLeft: 56, gap: 18, borderRightWidth: 2, borderRightColor: INK },
  leftPhone: { gap: 14 },
  rightWide: { flex: 1, minWidth: 0, paddingTop: 48, paddingRight: 56, paddingBottom: 56, paddingLeft: 48, justifyContent: 'center' as const },
  rightPhone: { marginTop: 8 },

  num: { fontFamily: fonts.heading, fontWeight: '800' as const, color: INK },
  title: { fontFamily: fonts.heading, fontWeight: '800' as const, color: INK },
  body: { fontFamily: fonts.body, color: INK },
  fill: { position: 'absolute' as const, left: 0, right: 0, top: 0, bottom: 0 },

  listHead: {
    fontFamily: fonts.body, fontWeight: '700' as const, fontSize: 13, letterSpacing: 13 * 0.06, textTransform: 'uppercase' as const, color: INK,
    paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: INK,
  },
  listRow: { flexDirection: 'row' as const, alignItems: 'center' as const, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  rowName: { fontFamily: fonts.body, fontWeight: '700' as const, color: INK },
  pill: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 3, paddingVertical: 3 },

  host: { ...rule, backgroundColor: LIME },
  hostWide: { paddingTop: 48, paddingHorizontal: 56, paddingBottom: 56, gap: 32 },
  hostPhone: { paddingTop: 32, paddingHorizontal: 20, paddingBottom: 36, gap: 16 },
  hostSub: { fontFamily: fonts.body, fontWeight: '600' as const, color: INK },
  kindTag: { alignSelf: 'flex-start' as const, backgroundColor: INK, color: LIME, fontFamily: fonts.body, fontWeight: '800' as const },
  kindTitle: { fontFamily: fonts.heading, fontWeight: '800' as const, fontSize: 30, letterSpacing: -30 * 0.035, lineHeight: 30, minHeight: 60, color: INK },
  kindTitlePhone: { fontFamily: fonts.heading, fontWeight: '800' as const, fontSize: 18, letterSpacing: -18 * 0.02, color: INK },
  kindRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: INK },
  kindCard: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 14, backgroundColor: CREAM, borderWidth: 2, borderColor: INK, padding: 10 },
  kindCardName: { fontFamily: fonts.body, fontWeight: '700' as const, fontSize: 16, color: INK },
  kindCardMeta: { fontFamily: fonts.body, fontSize: 13, color: INK_MUTED },
  hostButton: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  hostButtonText: { fontFamily: fonts.body, fontWeight: '700' as const, fontSize: 17, color: CREAM },

  closeWide: { backgroundColor: INK, padding: 56, flexDirection: 'row' as const, gap: 48, alignItems: 'flex-end' as const },
  closePhone: { backgroundColor: INK, paddingTop: 36, paddingHorizontal: 20, paddingBottom: 40, gap: 18 },
  closeTitle: { fontFamily: fonts.heading, fontWeight: '800' as const, color: LIME },
};
