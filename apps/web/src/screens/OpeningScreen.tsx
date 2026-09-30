/**
 * The opening (Welcome screens handoff, section 1h — the signed-off board).
 *
 * Shown once, after sign-up and before crew set-up: the 1c postcards opener,
 * then four intro screens — day or trip, your crew, book an expert, host it.
 * Which of the five is on is `?step=0..4`; Next moves on (a push, so Back steps
 * back), Skip and "Let's go" leave.
 *
 * The photos, portraits, names and prices are placeholders (the handoff says
 * so). The motion is the handoff's own, redone in React Native's `Animated`
 * because the bundle has no reanimated: ease-out curves, a small overshoot on
 * the pop-ins, and nothing that bounces. `prefers-reduced-motion` shows the
 * final state of every screen with no motion at all.
 *
 * Colours are the fixed brand set from `theme.ts` (LIME/INK/CREAM/MOSS and the
 * redesign's neutrals), not the palette — this is a brand moment and reads the
 * same in light and dark, the way the Trips redesign is drawn.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter, useQueryState, asNumber } from '../router';
import { paths } from '../routes';
import { useViewport } from '../hooks/useViewport';
import { Icon } from '../components/Icon';
import { Pin } from '../components/Wordmark';
import { Confetti, ConfettiHandle } from '../components/Confetti';
import { LIME, LIME_TINT, INK, CREAM, MOSS, HAIRLINE, INK_MUTED, NEUTRAL, fonts } from '../theme';

// The todo (not-yet-reached) progress bar and card rules are a soft warm grey.
const SOFT = HAIRLINE;

// ---------------------------------------------------------------------------
// placeholders (the handoff's own photos, names and prices)
// ---------------------------------------------------------------------------

const U = (id: string) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=320&q=60`;
const PHOTOS = ['1502602898657-3e91760cbb34', '1523906834658-6e24ef2386f9', '1513635269975-59663e0ac1ad', '1506905925346-21bda4d32df4', '1507525428034-b723cf961d3e', '1476514525535-07fb3b4ae5f1', '1501785888041-af3ef285b470', '1500530855697-b586d89ba3ee', '1469474968028-56623f02e42e', '1519681393784-d120267933ba', '1470071459604-3b5ec3a7fe05', '1441974231531-c6227db76b6e', '1493246507139-91e8fad9978e', '1499856871958-5b9627545d1a', '1488646953014-85cb44e25828'];
const TILE_BG = [INK, MOSS, LIME, HAIRLINE];

const PORTRAIT = {
  sam: 'https://randomuser.me/api/portraits/women/44.jpg',
  alex: 'https://randomuser.me/api/portraits/men/32.jpg',
  maya: 'https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?auto=format&fit=crop&w=200&h=200&q=60',
  leo: 'https://images.unsplash.com/photo-1471286174890-9c112ffca5b4?auto=format&fit=crop&w=200&h=200&q=60',
  biscuit: 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?auto=format&fit=crop&w=200&h=200&q=60',
  priya: 'https://randomuser.me/api/portraits/women/68.jpg',
  tom: 'https://randomuser.me/api/portraits/men/52.jpg',
};

const CREW = [
  { name: 'Sam', src: PORTRAIT.sam, bg: LIME, likes: ['Coffee', 'Gardens', 'Brunch'] },
  { name: 'Alex', src: PORTRAIT.alex, bg: INK, likes: ['Castles', 'Craft beer', 'Hikes'] },
  { name: 'Maya, 7', src: PORTRAIT.maya, bg: MOSS, likes: ['Dinos', 'Ice cream', 'Rock pools'] },
  { name: 'Leo, 4', src: PORTRAIT.leo, bg: HAIRLINE, likes: ['Slides', 'Steam trains', 'Sandpits'] },
  { name: 'Biscuit', src: PORTRAIT.biscuit, bg: NEUTRAL, likes: ['Walks', 'Off-lead', 'Pubs'] },
];

const CP = [
  { src: PORTRAIT.sam, bg: LIME }, { src: PORTRAIT.alex, bg: INK }, { src: PORTRAIT.maya, bg: MOSS },
  { src: PORTRAIT.leo, bg: HAIRLINE }, { src: PORTRAIT.biscuit, bg: NEUTRAL },
];
let laneCard = 0;
const cd = (rows: [string, string][]) => rows.map(([n, m]) => ({ n, m, src: U(PHOTOS[(laneCard++) % PHOTOS.length]), bg: [MOSS, INK, HAIRLINE][laneCard % 3] }));
const LANES = [
  { title: 'Curated for the family', sub: 'Works for all 5', who: CP, cards: cd([['Box Hill picnic walk', '40 min · Free'], ['Wisley gardens', '55 min · £18'], ['Whitstable beach day', '1h 20 · Free']]) },
  { title: 'For Maya & Leo', sub: 'Dinos, slides, steam trains', who: [CP[2], CP[3]], cards: cd([['Dinosaur trail', '30 min · £12'], ['Bluebell steam railway', '1h · £24'], ['Adventure playground', '15 min · Free']]) },
  { title: 'Adrenaline', sub: 'For Alex', who: [CP[1]], cards: cd([['Treetop zip wires', '35 min · £38'], ['Coasteering', '1h 40 · £45'], ['Indoor climbing', '20 min · £16']]) },
  { title: 'Your kind of food', sub: 'Brunch, pizza, pub gardens', who: [CP[0], CP[1]], cards: cd([['Riverside brunch', '10 min · ££'], ['Wood-fired pizza', '15 min · ££'], ['Dog-friendly pub garden', '25 min · ££']]) },
];

const DAY_ROWS = [
  { t: '10:00', name: 'Richmond Park', meta: 'Deer spotting · 2h', src: U('1441974231531-c6227db76b6e'), bg: MOSS },
  { t: '12:30', name: 'Lunch at Petersham', meta: 'High chairs · Garden', src: U('1414235077428-338989a2e8c0'), bg: INK },
  { t: '15:00', name: 'Kew Gardens', meta: 'Treetop walkway', src: U('1476514525535-07fb3b4ae5f1'), bg: MOSS },
];
const TRIP_ROWS = [
  { t: 'Fri', name: 'Arrive St Ives', meta: 'Beach · Fish & chips', src: U('1507525428034-b723cf961d3e'), bg: MOSS },
  { t: 'Sat', name: 'Eden Project', meta: 'Rainforest biome', src: U('1469474968028-56623f02e42e'), bg: INK },
  { t: 'Sun', name: 'Coast path to Zennor', meta: 'Easy 4 miles', src: U('1500530855697-b586d89ba3ee'), bg: MOSS },
];

// The star on an expert's line is the icon set's star, not a "★" character —
// Epic never draws a symbol glyph as an icon (brand pack). So the rating rides
// in its own field and the host row draws a filled star beside it.
const EXPERTS = [
  { tag: 'Expert-led', k: 'Fossils', t: 'Fossil hunting with a geologist', m: 'Charmouth beach · Sat 10:00 · 3h · £18', src: U('1507525428034-b723cf961d3e'), bg: MOSS, av: PORTRAIT.priya, who: 'Priya · Geologist', rating: 4.9 },
  { tag: 'Expert-led', k: 'History', t: 'Stonehenge with an archaeologist', m: 'Wiltshire · Sun 11:00 · 2h · £24', src: U('1500530855697-b586d89ba3ee'), bg: INK, av: PORTRAIT.tom, who: 'Tom · Archaeologist', rating: 4.8 },
];
const HOSTS = [
  { tag: 'Invite only', k: 'Friends and family', t: "Jo & Sam's wedding weekend", m: 'Cotswolds · 3 days · 42 guests', src: U('1469474968028-56623f02e42e'), bg: MOSS, av: PORTRAIT.sam, who: 'You · 38 coming', rating: undefined },
  { tag: 'Open to all', k: 'A proper event', t: 'Weekly pottery workshop', m: 'Tuesdays 19:00 · 8 places · £25', src: U('1470071459604-3b5ec3a7fe05'), bg: INK, av: PORTRAIT.sam, who: 'You · 6 of 8 booked', rating: undefined },
];

// ---------------------------------------------------------------------------
// reduced motion
// ---------------------------------------------------------------------------

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

// ---------------------------------------------------------------------------
// the screen
// ---------------------------------------------------------------------------

export function OpeningScreen() {
  const { navigate } = useRouter();
  const [step, setStep] = useQueryState<number>('step', 0, asNumber(0));
  const reduced = useReducedMotion();
  const view = useViewport();
  // The opener fills its own box exactly — the phone frame at 390, the content
  // column on a desktop, a real phone's screen — so it is measured rather than
  // read off the window (which on a desktop is wider than the column it sits in).
  const [box, setBox] = useState({ w: view.width, h: view.height });
  const s = Math.max(0, Math.min(4, Math.round(step)));

  const leave = () => navigate(paths.inspire(), { replace: true });
  // The opening is one once-through sequence, not a stack of pages: each step
  // replaces the last, so it lives in a single history entry and Back leaves the
  // whole sequence (to wherever it was opened from) rather than stepping back
  // into a screen already seen. `setStep` replaces by default.
  const next = () => setStep(s + 1);

  const common = { stepIndex: s, reduced, onSkip: leave };
  // A key per step: the two card screens are the same component, so without it
  // React reuses the instance from step 3 on step 4 and the Host cards never
  // run their slide-up (the animation values stay at their finished state).
  const inner = s === 0
    ? <Opener key="s0" width={box.w} height={box.h} reduced={reduced} onStart={() => setStep(1)} onHaveAccount={leave} />
    : s === 1 ? <DayOrTrip key="s1" {...common} onNext={next} />
    : s === 2 ? <YourCrew key="s2" {...common} onNext={next} />
    : s === 3 ? <CardScreen key="s3" {...common} title="Book an expert." sub="Local specialists who make the day. You just turn up." cards={EXPERTS} ctaLabel="Next" onNext={next} showSkip />
    : <CardScreen key="s4" {...common} title="Host it." sub="A weekend for friends and family, or a proper event: a craft fair, a 3-day course, a weekly workshop." cards={HOSTS} ctaLabel="Let's go" onNext={leave} showSkip={false} />;

  return (
    <View
      style={{ flex: 1, backgroundColor: CREAM }}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setBox((b) => (Math.abs(b.w - width) < 1 && Math.abs(b.h - height) < 1 ? b : { w: width, h: height }));
      }}
    >
      {inner}
    </View>
  );
}

// ---------------------------------------------------------------------------
// 1h-0 · the opener (postcards)
// ---------------------------------------------------------------------------

function Opener({ width, height, reduced, onStart, onHaveAccount }: {
  width: number; height: number; reduced: boolean; onStart: () => void; onHaveAccount: () => void;
}) {
  const confetti = useRef<ConfettiHandle | null>(null);
  const cols = 3, rows = 5;
  const tileW = width / cols;
  const tileH = height / rows;
  const bandTop = tileH * 2;
  const bandH = tileH;
  const letterFS = Math.round(tileH * 0.66); // ≈ the board's 112px at a 390×844 frame
  const rowH = Math.round(letterFS * 1.22);

  // One driver per tile, one each for the band, the letters, the tagline and the CTA.
  const tileP = useRef(PHOTOS.map(() => new Animated.Value(0))).current;
  const band = useRef(new Animated.Value(0)).current;         // 0 → 1 clip reveal
  const letters = useRef([0, 1, 2, 3].map(() => new Animated.Value(0))).current;
  const tag = useRef(new Animated.Value(0)).current;
  const cta = useRef(new Animated.Value(0)).current;

  // Where each tile starts, piles and jitters — fixed per mount so a re-render
  // does not reshuffle mid-flight.
  const geom = useMemo(() => PHOTOS.map((_, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const cx = width / 2, cy = height * 0.5;
    const tx = col * tileW + tileW / 2, ty = row * tileH + tileH / 2;
    const a = Math.random() * Math.PI * 2;
    const jx = (tileW / 130), jy = (tileH / 169);
    return {
      sx: Math.cos(a) * width * 1.7 + (cx - tx),
      sy: Math.sin(a) * height * 1.1 + (cy - ty),
      px: (cx - tx) + (Math.random() - 0.5) * 70 * jx,
      py: (cy * 0.976 - ty) + (Math.random() - 0.5) * 90 * jy,
      r1: (Math.random() - 0.5) * 120,
      r2: (Math.random() - 0.5) * 36,
    };
  }), [width, height, tileW, tileH]);

  useEffect(() => {
    confetti.current?.reset();
    if (reduced) {
      tileP.forEach((v) => v.setValue(1));
      band.setValue(1);
      letters.forEach((v) => v.setValue(1));
      tag.setValue(1);
      cta.setValue(1);
      return;
    }
    tileP.forEach((v) => v.setValue(0));
    band.setValue(0);
    letters.forEach((v) => v.setValue(0));
    tag.setValue(0);
    cta.setValue(0);

    const anims = tileP.map((v, i) => Animated.sequence([
      Animated.delay(i * 70),
      Animated.timing(v, { toValue: 0.5, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(1100),
      Animated.timing(v, { toValue: 1, duration: 500, easing: Easing.bezier(0.7, 0, 0.2, 1), useNativeDriver: true }),
    ]));
    Animated.parallel(anims).start();

    Animated.timing(band, { toValue: 1, duration: 380, delay: 2250, easing: Easing.bezier(0.7, 0, 0.2, 1), useNativeDriver: false }).start();
    letters.forEach((v, i) => Animated.timing(v, { toValue: 1, duration: 480, delay: 2480 + i * 70, easing: Easing.bezier(0.2, 0.9, 0.3, 1.25), useNativeDriver: true }).start());
    Animated.timing(tag, { toValue: 1, duration: 450, delay: 2800, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    Animated.timing(cta, { toValue: 1, duration: 500, delay: 2900, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();

    const burst = setTimeout(() => {
      confetti.current?.burst(380, 420, { n: 70, colors: [INK, MOSS, LIME, CREAM], shapes: ['rect', 'pin'], power: 900, angle: Math.PI * 1.1, spread: Math.PI * 0.9, size: 11 });
      confetti.current?.burst(10, 420, { n: 50, colors: [INK, MOSS, LIME], shapes: ['rect'], power: 800, angle: -Math.PI * 0.2, spread: Math.PI * 0.8, size: 10 });
    }, 2620);
    return () => clearTimeout(burst);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, width, height]);

  const glyphs = ['E', 'p', 'ı', 'c'];

  return (
    <View style={{ flex: 1, backgroundColor: CREAM, overflow: 'hidden' }}>
      {/* The photos, flying in and locking into the grid. */}
      {PHOTOS.map((id, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const g = geom[i];
        const p = tileP[i];
        const tx = p.interpolate({ inputRange: [0, 0.5, 1], outputRange: [g.sx, g.px, 0] });
        const ty = p.interpolate({ inputRange: [0, 0.5, 1], outputRange: [g.sy, g.py, 0] });
        const rot = p.interpolate({ inputRange: [0, 0.5, 1], outputRange: [`${g.r1}deg`, `${g.r2}deg`, '0deg'] });
        const sc = p.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.75, 0.75, 1] });
        return (
          <Animated.View
            key={id}
            style={{
              position: 'absolute', left: col * tileW, top: row * tileH, width: tileW, height: tileH,
              borderWidth: 3, borderColor: CREAM, backgroundColor: TILE_BG[i % TILE_BG.length], overflow: 'hidden',
              transform: [{ translateX: tx }, { translateY: ty }, { rotate: rot }, { scale: sc }],
            }}
          >
            <Image source={{ uri: id.startsWith('http') ? id : U(id) }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          </Animated.View>
        );
      })}

      {/* The lime band, slamming across, with the wordmark and tagline. */}
      <Animated.View style={{ position: 'absolute', left: 0, top: bandTop, height: bandH, overflow: 'hidden', width: band.interpolate({ inputRange: [0, 1], outputRange: [0, width] }) }}>
        <View style={{ width, height: bandH, backgroundColor: LIME, justifyContent: 'center', paddingHorizontal: 20, gap: 4 }}>
          <View style={{ flexDirection: 'row', height: rowH, overflow: 'hidden', alignItems: 'flex-end' }}>
            {glyphs.map((ch, i) => {
              const ty = letters[i].interpolate({ inputRange: [0, 1], outputRange: [rowH, 0] });
              if (ch === 'ı') {
                const pinH = Math.round(letterFS * 0.3);
                return (
                  <Animated.View key={i} style={{ transform: [{ translateY: ty }] }}>
                    <View style={{ position: 'relative' }}>
                      <Text style={[styles.glyph, { fontSize: letterFS, lineHeight: rowH }]}>ı</Text>
                      <View style={{ position: 'absolute', left: '50%', top: Math.round(letterFS * 0.06), transform: [{ translateX: -Math.round(pinH * 0.365) }] }}>
                        <Pin size={pinH} ink={INK} ground={LIME} />
                      </View>
                    </View>
                  </Animated.View>
                );
              }
              return (
                <Animated.View key={i} style={{ transform: [{ translateY: ty }] }}>
                  <Text style={[styles.glyph, { fontSize: letterFS, lineHeight: rowH }]}>{ch}</Text>
                </Animated.View>
              );
            })}
          </View>
          <Animated.Text style={[styles.openerTag, { opacity: tag, transform: [{ translateX: tag.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] }]}>Every place worth going.</Animated.Text>
        </View>
      </Animated.View>

      {/* The two doors. */}
      <Animated.View style={[styles.openerCta, { opacity: cta, transform: [{ translateY: cta.interpolate({ inputRange: [0, 1], outputRange: [160, 0] }) }] }]}>
        <Pressable onPress={onStart} accessibilityRole="button" style={styles.ctaBar}>
          <Text style={styles.ctaLabel}>Get started</Text>
          <Icon name="forward" size={20} color={CREAM} strokeWidth={2.4} />
        </Pressable>
        <Pressable onPress={onHaveAccount} accessibilityRole="button" style={{ paddingLeft: 20, paddingVertical: 4 }}>
          <Text style={styles.haveAccount}>I already have an account</Text>
        </Pressable>
      </Animated.View>

      {Platform.OS === 'web' ? <Confetti ref={confetti} width={width} height={height} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// shared chrome for 1h-1 … 1h-4
// ---------------------------------------------------------------------------

function IntroFrame({ stepIndex, showSkip, onSkip, title, sub, ctaLabel, onNext, scroll = true, children }: {
  stepIndex: number; showSkip: boolean; onSkip: () => void; title: string; sub: string; ctaLabel: string; onNext: () => void; scroll?: boolean; children: React.ReactNode;
}) {
  return (
    <View style={styles.introRoot}>
      <View style={styles.progressRow}>
        <View style={{ flex: 1, flexDirection: 'row', gap: 6 }}>
          {[0, 1, 2, 3].map((i) => <View key={i} style={{ flex: 1, height: 4, backgroundColor: i < stepIndex ? INK : NEUTRAL }} />)}
        </View>
        <Pressable onPress={onSkip} accessibilityRole="button" disabled={!showSkip} style={{ opacity: showSkip ? 1 : 0 }}>
          <Text style={styles.skip}>Skip</Text>
        </Pressable>
      </View>
      <View style={styles.heading}>
        <Text style={styles.headingTitle}>{title}</Text>
        <Text style={styles.headingSub}>{sub}</Text>
      </View>
      {/* The body centres on a tall phone and scrolls on a short one (e.g. an SE
          at 667), so its fixed-height content never overlaps the heading or CTA.
          The crew screen manages its own bounded, clipping zone, so it opts out. */}
      {scroll
        ? <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} showsVerticalScrollIndicator={false}>{children}</ScrollView>
        : <View style={{ flex: 1, minHeight: 0 }}>{children}</View>}
      <Pressable onPress={onNext} accessibilityRole="button" style={styles.ctaBar}>
        <Text style={styles.ctaLabel}>{ctaLabel}</Text>
        <Icon name="forward" size={20} color={CREAM} strokeWidth={2.4} />
      </Pressable>
    </View>
  );
}

type IntroProps = { stepIndex: number; reduced: boolean; onSkip: () => void; onNext: () => void };

// ---------------------------------------------------------------------------
// 1h-1 · day or trip
// ---------------------------------------------------------------------------

function DayOrTrip({ stepIndex, reduced, onSkip, onNext }: IntroProps) {
  const clock = useRef(new Animated.Value(0)).current;
  const [cellW, setCellW] = useState(0);

  useEffect(() => {
    if (reduced) { clock.setValue(0); return; }
    clock.setValue(0);
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(600),
      Animated.timing(clock, { toValue: 1, duration: 700, easing: Easing.bezier(0.7, 0, 0.2, 1), useNativeDriver: true }),
      Animated.delay(2600),
      Animated.timing(clock, { toValue: 0, duration: 700, easing: Easing.bezier(0.7, 0, 0.2, 1), useNativeDriver: true }),
      Animated.delay(2600),
    ]));
    loop.start();
    return () => loop.stop();
  }, [clock, reduced]);

  const indX = clock.interpolate({ inputRange: [0, 1], outputRange: [0, cellW] });
  const dayOp = clock.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const tripOp = clock.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  return (
    <IntroFrame stepIndex={stepIndex} showSkip onSkip={onSkip} onNext={onNext} ctaLabel="Next"
      title="One day. Or ten." sub="Plan a Saturday out or a week away. Same app, same crew.">
      <View style={{ flex: 1, justifyContent: 'center', gap: 18 }}>
        <View style={styles.switch} onLayout={(e) => setCellW(e.nativeEvent.layout.width / 2)}>
          <Animated.View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '50%', backgroundColor: LIME, transform: [{ translateX: indX }] }} />
          <View style={styles.switchCell}><Text style={styles.switchText}>Day out</Text></View>
          <View style={[styles.switchCell, { borderLeftWidth: 2, borderLeftColor: INK }]}><Text style={styles.switchText}>Trip</Text></View>
        </View>
        <View style={{ height: 300 }}>
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: reduced ? 1 : dayOp }]}>
            <ItineraryList head="Saturday · Richmond" rows={DAY_ROWS} />
          </Animated.View>
          {!reduced ? (
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: tripOp }]}>
              <ItineraryList head="Cornwall · 3 days" rows={TRIP_ROWS} />
            </Animated.View>
          ) : null}
        </View>
      </View>
    </IntroFrame>
  );
}

function ItineraryList({ head, rows }: { head: string; rows: { t: string; name: string; meta: string; src: string; bg: string }[] }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.listHead}>{head}</Text>
      {rows.map((r, i) => (
        <View key={i} style={styles.listRow}>
          <Text style={styles.listTime}>{r.t}</Text>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={styles.listName} numberOfLines={1}>{r.name}</Text>
            <Text style={styles.listMeta} numberOfLines={1}>{r.meta}</Text>
          </View>
          <Image source={{ uri: r.src }} style={{ width: 60, height: 60, borderRadius: 8, backgroundColor: r.bg }} resizeMode="cover" />
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// 1h-2 · your crew
// ---------------------------------------------------------------------------

function YourCrew({ stepIndex, reduced, onSkip, onNext }: IntroProps) {
  const D = 11000;
  const clock = useRef(new Animated.Value(0)).current;
  const [feedH, setFeedH] = useState(0);
  const [zoneH, setZoneH] = useState(0);
  const dist = Math.max(0, feedH - zoneH + 14);

  useEffect(() => {
    if (reduced) { clock.setValue(0.5); return; }
    clock.setValue(0);
    const loop = Animated.loop(Animated.timing(clock, { toValue: 1, duration: D, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [clock, reduced]);

  // The rows clear (opacity to 0 at .40, back at the loop's end); the feed then
  // rises in and auto-scrolls in two steps.
  const rowsOp = reduced ? 1 : clock.interpolate({ inputRange: [0, 0.34, 0.40, 0.95, 1], outputRange: [1, 1, 0, 0, 1] });
  const rowsY = reduced ? 0 : clock.interpolate({ inputRange: [0, 0.34, 0.40, 1], outputRange: [0, 0, -16, -16] });
  const resOp = reduced ? 0 : clock.interpolate({ inputRange: [0, 0.40, 0.48, 0.95, 0.99, 1], outputRange: [0, 0, 1, 1, 0, 0] });
  const resY = reduced ? 0 : clock.interpolate({ inputRange: [0, 0.40, 0.48, 1], outputRange: [40, 40, 0, 0] });
  const feedY = reduced ? 0 : clock.interpolate({ inputRange: [0, 0.56, 0.70, 0.76, 0.88, 1], outputRange: [0, 0, -dist * 0.5, -dist * 0.5, -dist, -dist] });

  const pills = CREW.flatMap((m) => m.likes.map((t, j) => ({ t, top: j === 0 })));

  return (
    <IntroFrame stepIndex={stepIndex} showSkip onSkip={onSkip} onNext={onNext} ctaLabel="Next" scroll={false}
      title="Built around your crew." sub="Tell us who's coming and what they love. Everything we suggest works for all of you.">
      <View style={{ flex: 1, overflow: 'hidden', marginTop: 4 }} onLayout={(e) => setZoneH(e.nativeEvent.layout.height)}>
        {/* Phase 1 — the crew, with pills popping in. */}
        <Animated.View style={{ opacity: rowsOp, transform: [{ translateY: rowsY }] }}>
          {CREW.map((m, mi) => (
            <View key={mi} style={styles.crewRow}>
              <Image source={{ uri: m.src }} style={[styles.avatar44, { backgroundColor: m.bg }]} />
              <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
                <Text style={styles.crewName}>{m.name}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {m.likes.map((t, j) => {
                    const idx = mi * 3 + j;
                    const top = j === 0;
                    const a = 0.03 + idx * (0.22 / pills.length);
                    const b = 0.32;
                    const op = reduced ? 1 : clock.interpolate({ inputRange: [0, a, a + 0.05, b, b + 0.07, 1], outputRange: [0, 0, 1, 1, 0, 0] });
                    const sc = reduced ? 1 : clock.interpolate({ inputRange: [0, a, a + 0.05, b + 0.07, 1], outputRange: [0.4, 0.4, 1, 1, 0.4] });
                    return (
                      <Animated.View key={j} style={{ opacity: op, transform: [{ scale: sc }] }}>
                        <View style={[styles.pill, { backgroundColor: top ? LIME : LIME_TINT }]}>
                          <Text style={styles.pillText}>{t}</Text>
                        </View>
                      </Animated.View>
                    );
                  })}
                </View>
              </View>
            </View>
          ))}
        </Animated.View>

        {/* Phase 2 — the swim lanes, on a clean cream ground. */}
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: CREAM, paddingTop: 14, opacity: resOp, transform: [{ translateY: resY }] }]}>
          <Animated.View style={{ transform: [{ translateY: feedY }] }} onLayout={(e) => setFeedH(e.nativeEvent.layout.height)}>
            <View style={{ gap: 22, paddingBottom: 20 }}>
              {LANES.map((l, li) => (
                <View key={li} style={{ gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <View style={{ minWidth: 0, gap: 1 }}>
                      <Text style={styles.laneTitle}>{l.title}</Text>
                      <Text style={styles.laneSub}>{l.sub}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', paddingLeft: 8 }}>
                      {l.who.map((w, wi) => (
                        <Image key={wi} source={{ uri: w.src }} style={[styles.faceStack, { backgroundColor: w.bg, marginLeft: wi === 0 ? 0 : -8 }]} />
                      ))}
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 10, marginRight: -20 }}>
                    {l.cards.map((c, ci) => (
                      <View key={ci} style={{ width: 148, gap: 6 }}>
                        <Image source={{ uri: c.src }} style={{ height: 98, borderRadius: 10, backgroundColor: c.bg }} resizeMode="cover" />
                        <Text style={styles.cardName} numberOfLines={2}>{c.n}</Text>
                        <Text style={styles.cardMeta}>{c.m}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          </Animated.View>
        </Animated.View>
      </View>
    </IntroFrame>
  );
}

// ---------------------------------------------------------------------------
// 1h-3 / 1h-4 · book an expert / host it (the same card pattern)
// ---------------------------------------------------------------------------

type Card = { tag: string; k: string; t: string; m: string; src: string; bg: string; av: string; who: string; rating?: number };

function CardScreen({ stepIndex, reduced, onSkip, onNext, title, sub, cards, ctaLabel, showSkip }: IntroProps & { title: string; sub: string; cards: Card[]; ctaLabel: string; showSkip: boolean }) {
  const vals = useRef(cards.map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (reduced) { vals.forEach((v) => v.setValue(1)); return; }
    vals.forEach((v) => v.setValue(0));
    Animated.parallel(vals.map((v, i) => Animated.timing(v, { toValue: 1, duration: 500, delay: 120 + i * 240, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: true }))).start();
  }, [vals, reduced]);

  return (
    <IntroFrame stepIndex={stepIndex} showSkip={showSkip} onSkip={onSkip} onNext={onNext} ctaLabel={ctaLabel} title={title} sub={sub}>
      <View style={{ flex: 1, justifyContent: 'center', gap: 14 }}>
        {cards.map((h, i) => (
          <Animated.View key={i} style={{ opacity: vals[i], transform: [{ translateY: vals[i].interpolate({ inputRange: [0, 1], outputRange: [30, 0] }) }] }}>
            <View style={styles.xcard}>
              <View style={{ width: 118, height: 150, borderRadius: 10, overflow: 'hidden', backgroundColor: h.bg }}>
                <Image source={{ uri: h.src }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                <View style={styles.xtag}><Text style={styles.xtagText}>{h.tag}</Text></View>
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 4, paddingVertical: 2 }}>
                <Text style={styles.xkicker}>{h.k}</Text>
                <Text style={styles.xtitle}>{h.t}</Text>
                <Text style={styles.xmeta}>{h.m}</Text>
                <View style={styles.xhost}>
                  <Image source={{ uri: h.av }} style={styles.avatar24} />
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 }}>
                    <Text style={styles.xwho} numberOfLines={1}>{h.who}</Text>
                    {h.rating != null ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 4 }}>
                        <Text style={styles.xwho}>·</Text>
                        <Icon name="favourite" size={12} color={INK} fill />
                        <Text style={styles.xwho}>{h.rating.toFixed(1)}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </View>
            </View>
          </Animated.View>
        ))}
      </View>
    </IntroFrame>
  );
}

// ---------------------------------------------------------------------------
// styles
// ---------------------------------------------------------------------------

// The opening is full-bleed (routes.ts `isFullBleed`), so the shell adds no
// safe-area insets — the screen takes the notch and the home indicator into its
// own top and bottom padding.
const introTop = Platform.OS === 'web' ? ('calc(64px + var(--epic-sat))' as unknown as number) : 64;
const bottomPad = Platform.OS === 'web' ? ('calc(40px + var(--epic-sab))' as unknown as number) : 40;

const styles = StyleSheet.create({
  glyph: { fontFamily: fonts.heading, fontWeight: '800', letterSpacing: -6, color: INK, includeFontPadding: false },
  openerTag: { fontSize: 17, fontWeight: '700', color: INK },
  openerCta: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 20, paddingBottom: bottomPad, backgroundColor: CREAM, borderTopWidth: 2, borderTopColor: INK, gap: 16, zIndex: 35 },
  ctaBar: { height: 56, backgroundColor: INK, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  ctaLabel: { color: CREAM, fontSize: 17, fontWeight: '700' },
  haveAccount: { fontSize: 16, fontWeight: '600', color: INK },

  introRoot: { flex: 1, backgroundColor: CREAM, paddingTop: introTop, paddingHorizontal: 20, paddingBottom: bottomPad },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  skip: { fontSize: 15, fontWeight: '600', color: INK },
  heading: { marginHorizontal: -20, marginTop: 24, paddingTop: 28, paddingHorizontal: 20, paddingBottom: 26, backgroundColor: LIME },
  headingTitle: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 42, letterSpacing: -1.47, lineHeight: 42, color: INK },
  headingSub: { fontSize: 17, color: INK, marginTop: 12, lineHeight: 23 },

  switch: { flexDirection: 'row', height: 48, borderWidth: 2, borderColor: INK },
  switchCell: { flex: 1, justifyContent: 'center', paddingHorizontal: 14 },
  switchText: { fontWeight: '700', fontSize: 16, color: INK },
  listHead: { fontSize: 13, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: INK, paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: INK },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: SOFT },
  listTime: { width: 48, fontSize: 14, fontWeight: '700', color: INK },
  listName: { fontWeight: '700', fontSize: 17, color: INK },
  listMeta: { fontSize: 13, color: INK_MUTED },

  crewRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: SOFT },
  avatar44: { width: 44, height: 44, borderRadius: 22 },
  crewName: { fontSize: 15, fontWeight: '700', color: INK },
  pill: { paddingVertical: 3, paddingHorizontal: 7 },
  pillText: { fontSize: 12, fontWeight: '600', color: INK },
  laneTitle: { fontWeight: '800', fontSize: 19, letterSpacing: -0.38, lineHeight: 21, color: INK },
  laneSub: { fontSize: 12, color: INK_MUTED },
  faceStack: { width: 26, height: 26, borderRadius: 13 },
  cardName: { fontSize: 14, fontWeight: '700', lineHeight: 17, color: INK },
  cardMeta: { fontSize: 12, color: INK_MUTED },

  xcard: { borderWidth: 2, borderColor: INK, backgroundColor: CREAM, flexDirection: 'row', gap: 12, padding: 10 },
  xtag: { position: 'absolute', left: 6, top: 6, backgroundColor: LIME, paddingVertical: 3, paddingHorizontal: 6 },
  xtagText: { fontSize: 11, fontWeight: '800', color: INK },
  xkicker: { fontSize: 11, fontWeight: '800', letterSpacing: 0.66, textTransform: 'uppercase', color: INK_MUTED },
  xtitle: { fontWeight: '800', fontSize: 19, letterSpacing: -0.19, lineHeight: 21, color: INK },
  xmeta: { fontSize: 13, color: INK_MUTED, lineHeight: 18 },
  xhost: { marginTop: 'auto', flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: SOFT },
  avatar24: { width: 24, height: 24, borderRadius: 12, backgroundColor: HAIRLINE },
  xwho: { fontSize: 12, fontWeight: '700', color: INK, minWidth: 0 },
});
