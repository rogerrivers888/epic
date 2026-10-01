/**
 * WH1 — the host landing page (/{locale}/host). Built from `EpicHostLanding.dc.html`
 * (1280) and `EpicMobile.dc.html` `screen` = host (390, used below 700 wide).
 * SiteLayout draws the "For hosts" header; this page starts at the hero.
 *
 * The card photos and guest faces of the drawing are flat brand blocks and
 * initials here: the site carries no stock photography.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type TextStyle } from 'react-native';
import {
  CREAM, DEEP_GREEN, HAIRLINE, INK, INK_MUTED, INK_RULE, LIME, LIME_TINT, MOSS, NEUTRAL, fonts,
} from '../../theme';
import { Icon } from '../../components/Icon';
import { useViewport } from '../../hooks/useViewport';
import { InterestForm, type HostKind } from '../InterestForm';
import { pick } from '../i18n';
import { EASE, animate, onFirstView, usePrefersReducedMotion } from '../motion';
import type { SitePageProps } from '../page';
import { SiteH1, SiteH2, SiteP } from '../type';
import { STRINGS, type RsvpStatus } from './HostLanding.strings';

const web = Platform.OS === 'web';
const PHOTO = [MOSS, DEEP_GREEN, HAIRLINE, INK];
const GUEST_FACE = [LIME, HAIRLINE, MOSS, INK];
const BOOKED_FACE = [LIME, INK, MOSS, HAIRLINE];
const RSVP: Record<RsvpStatus, string> = { coming: LIME, maybe: LIME_TINT, none: NEUTRAL };
const ls = (size: number, em: number) => size * em;

export function HostLanding({ locale, landingPage }: SitePageProps) {
  const s = pick(STRINGS, locale);
  const { width } = useViewport();
  const phone = width < 700;
  const wide = width >= 1000;
  const pad = phone ? 20 : 56;
  const heroSize = phone ? 96 : Math.min(232, Math.max(120, Math.floor((width - 2 * pad) / 3.1)));
  const [kind, setKind] = useState<HostKind>('activity');

  // The four steps rise in once, when scrolled into view; reduced motion leaves them at rest.
  const reduced = usePrefersReducedMotion();
  const stepRefs = useRef<(View | null)[]>([]);
  const [stepsWaiting, setStepsWaiting] = useState(() => web && !reduced);
  useEffect(() => {
    if (!stepsWaiting) return;
    if (reduced) { setStepsWaiting(false); return; }
    return onFirstView(stepRefs.current[0], () => {
      stepRefs.current.forEach((node, i) => animate(node,
        [{ opacity: 0, transform: 'translateY(28px)' }, { opacity: 1, transform: 'none' }],
        { duration: 560, delay: i * 140, easing: EASE, fill: 'backwards' }));
      setStepsWaiting(false);
    });
  }, [reduced, stepsWaiting]);

  const heading = (i: number) => {
    const sec = s.sections[i];
    return (
      <>
        <Text aria-hidden style={[styles.num, { fontSize: phone ? 17 : 20 }]}>{sec.n}</Text>
        <SiteH2 style={[styles.chapter, phone ? styles.chapterPhone : null, i === 3 ? (phone ? styles.chapter04Phone : styles.chapter04) : null]}>
          <Text style={styles.srOnly}>{sec.n + s.sep}</Text>
          {sec.title}
        </SiteH2>
      </>
    );
  };

  // A grid of four that goes 4 across when wide, 2×2 between 700 and 1000; returns a cell's borders and gutters.
  const cell = (i: number, gutter: number) => {
    const cols = wide ? 4 : 2;
    const col = i % cols;
    return {
      width: wide ? '25%' : '50%',
      paddingLeft: col === 0 ? 0 : gutter,
      paddingRight: col === cols - 1 ? 0 : gutter,
      borderRightWidth: col < cols - 1 ? 2 : 0,
      borderTopWidth: i >= cols ? 2 : 0,
      borderColor: INK,
    } as const;
  };

  return (
    <View style={styles.page}>
      {/* Hero */}
      <View style={[styles.hero, phone ? styles.heroPhone : { paddingHorizontal: pad }]}>
        <SiteP style={[styles.tag, phone && styles.tagPhone]}>{s.comingSoon}</SiteP>
        <SiteP style={[styles.hostIt, { fontSize: heroSize, letterSpacing: ls(heroSize, -0.06), lineHeight: heroSize * 0.82 }]}>{s.hostIt}</SiteP>
        <View style={[styles.heroRow, wide ? styles.heroRowWide : { gap: 18 }, phone && { paddingTop: 14 }]}>
          <View style={[{ gap: 10 }, wide && styles.half]}>
            <SiteH1 style={[styles.intro, phone && styles.introPhone]}>{s.h1}</SiteH1>
            <SiteP style={[styles.intro, phone && styles.introPhone]}>{s.intro}</SiteP>
          </View>
          <View style={wide ? styles.half : null}>
            <InterestForm
              locale={locale} landingPage={landingPage} source="host" ground="lime" hostKind={null}
              label={s.heroCta} successMessage={s.success} maxWidth={wide ? 640 : 9999}
            />
          </View>
        </View>
      </View>

      {/* 01 · Four ways to host */}
      <View style={[styles.head, phone ? styles.headPhone : { paddingTop: 56, paddingHorizontal: pad }]}>{heading(0)}</View>
      <View style={phone ? { paddingHorizontal: pad } : [styles.grid, { marginHorizontal: pad, marginTop: 36 }]}>
        {s.kinds.map((k, i) => (
          <View key={k.tag} style={phone ? styles.kindPhone : [styles.kind, cell(i, 22)]}>
            <View style={styles.kindTop}>
              <Text style={[styles.kindTag, phone && styles.kindTagPhone]}>{k.tag}</Text>
              <Text style={[styles.freq, phone && { fontSize: 13 }]}>{k.freq}</Text>
            </View>
            <Text style={phone ? styles.kindTitlePhone : styles.kindTitle}>{k.title}</Text>
            <Text style={phone ? styles.kindSubPhone : styles.kindSub}>{k.sub}</Text>
            <View style={[styles.card, phone && { flexDirection: 'row' }]}>
              <View style={[phone ? styles.photoPhone : styles.photo, { backgroundColor: PHOTO[i % PHOTO.length] }]} />
              <View style={phone ? styles.cardBodyPhone : styles.cardBody}>
                <Text style={[styles.kicker, phone && { fontSize: 11, letterSpacing: ls(11, 0.06) }]}>{phone ? k.kickerShort : k.kicker}</Text>
                <Text style={phone ? styles.cardTitlePhone : styles.cardTitle}>{k.card}</Text>
                <View style={styles.pills}>
                  {k.pills.map((p, j) => (
                    <View key={p.t} accessibilityLabel={p.label} style={[styles.pill, phone && styles.pillPhone, { backgroundColor: j === 0 ? LIME : LIME_TINT }]}>
                      <Text style={[styles.pillText, phone && { fontSize: 12 }]}>{p.t}</Text>
                      {p.rating ? (
                        <>
                          <Icon name="favourite" size={phone ? 11 : 12} color={INK} fill />
                          <Text style={[styles.pillText, phone && { fontSize: 12 }]}>{p.rating}</Text>
                        </>
                      ) : null}
                    </View>
                  ))}
                </View>
              </View>
            </View>
            {!phone ? (
              <View>
                <Text style={styles.running}>{s.running}</Text>
                {k.eg.map((e) => <Text key={e} style={styles.eg}>{e}</Text>)}
              </View>
            ) : null}
          </View>
        ))}
      </View>

      {/* 02 · Friends only, or everyone */}
      <View style={[styles.head, phone ? styles.headPhone : [styles.ruleTop, { paddingTop: 72, paddingHorizontal: pad, marginTop: 8 }], phone && { paddingBottom: 0 }]}>{heading(1)}</View>
      <View style={[styles.panels, wide && { flexDirection: 'row' }, phone ? { margin: pad, marginTop: 24, marginBottom: 36 } : { marginHorizontal: pad, marginTop: 36, marginBottom: 72 }]}>
        <View style={[styles.panel, phone && styles.panelPhone, wide ? styles.ruleRight : styles.ruleBottom, wide && styles.half]}>
          <Text style={[styles.panelTitle, phone && styles.panelTitlePhone]}>{s.invite.title}</Text>
          <Text style={[styles.panelBody, phone && styles.panelBodyPhone]}>{s.invite.body}</Text>
          <View style={[styles.ruleTop, !phone && { marginTop: 6 }]}>
            {s.invite.guests.map((g, i) => (
              <View key={g.name} style={[styles.guest, phone && { gap: 10, paddingVertical: 9 }]}>
                <Face name={g.name} size={phone ? 32 : 36} color={GUEST_FACE[i % GUEST_FACE.length]} />
                <Text style={[styles.guestName, phone && { fontSize: 15 }]}>{g.name}</Text>
                <Text style={[styles.rsvp, phone && styles.rsvpPhone, { backgroundColor: RSVP[g.status] }]}>{s.invite.status[g.status]}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={[styles.panel, phone && styles.panelPhone, { backgroundColor: INK }, wide && styles.half]}>
          <Text style={[styles.panelTitle, phone && styles.panelTitlePhone, { color: LIME }]}>{s.open.title}</Text>
          <Text style={[styles.panelBody, phone && styles.panelBodyPhone, { color: CREAM }]}>{s.open.body}</Text>
          <View style={[styles.ruleTop, { borderTopColor: CREAM }, !phone && { marginTop: 6 }]}>
            {s.open.sessions.map((x) => (
              <View key={x.d} style={[styles.session, phone && { gap: 12, paddingVertical: 11 }]}>
                <Text style={[styles.sessionCell, styles.bold, { fontSize: phone ? 14 : 16 }]}>{x.d}</Text>
                <Text style={[styles.sessionCell, { fontSize: phone ? 14 : 15 }]}>{x.t}</Text>
                <Text style={[styles.sessionCell, styles.bold, { fontSize: phone ? 14 : 15, color: x.full ? LIME : CREAM }]}>{phone ? x.bShort : x.b}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* 03 · Up and running in four steps */}
      <View style={[styles.steps, styles.ruleTop, phone ? styles.stepsPhone : [styles.ruleBottom, { paddingHorizontal: pad }]]}>
        <View style={{ gap: phone ? 10 : 12 }}>{heading(2)}</View>
        <View style={phone ? { marginTop: 4 } : [styles.grid]}>
          {s.steps.map((st, i) => (
            <View
              key={st.t}
              ref={(n) => { stepRefs.current[i] = n; }}
              style={[
                phone ? styles.stepPhone : [styles.step, cell(i, 24), { paddingLeft: 24, paddingRight: 24 }],
                stepsWaiting && { opacity: 0 },
              ]}
            >
              <View style={[styles.stepNum, phone && { width: 44, height: 44 }]}>
                <Text style={[styles.stepNumText, phone && { fontSize: 18 }]}>{i + 1}</Text>
              </View>
              <View style={[{ gap: phone ? 6 : 14 }, phone && styles.shrink]}>
                <Text style={phone ? styles.stepTitlePhone : styles.stepTitle}>{st.t}</Text>
                <Text style={[styles.stepText, phone && { fontSize: 15 }]}>{st.d}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* 04 · You run it. Epic does the admin */}
      <View style={[wide ? styles.adminWide : null, !phone && styles.ruleBottom, phone && styles.ruleTop]}>
        <View style={[
          { gap: phone ? 14 : 18 },
          phone ? { paddingTop: 32, paddingHorizontal: pad } : { paddingTop: 72, paddingBottom: wide ? 72 : 36, paddingLeft: pad, paddingRight: wide ? 48 : pad },
          wide && [styles.ruleRight, styles.half],
        ]}>
          {heading(3)}
          <Text style={[styles.adminBody, phone && styles.adminBodyPhone]}>{s.admin.body}</Text>
        </View>
        <View style={[
          { justifyContent: 'center' },
          phone ? { paddingHorizontal: pad, paddingTop: 22, paddingBottom: 36 } : wide ? { padding: 56, paddingLeft: 48 } : { paddingHorizontal: pad, paddingBottom: 72 },
          wide && styles.half,
        ]}>
          <View style={styles.card}>
            <View style={[styles.dashHead, phone && { paddingVertical: 14, paddingHorizontal: 16, gap: 0 }]}>
              <Text style={[styles.dashKicker, phone && { fontSize: 11, letterSpacing: ls(11, 0.06) }]}>{s.admin.kicker}</Text>
              <Text style={[styles.dashDate, phone && { fontSize: 22, letterSpacing: ls(22, -0.02) }]}>{s.admin.date}</Text>
            </View>
            <View style={[styles.statsRow, styles.ruleBottom]}>
              {s.admin.stats.map((t, i) => (
                <View key={t.k} style={[styles.stat, phone && { paddingVertical: 10, paddingHorizontal: 12, gap: 0 }, i < 2 && styles.ruleRight]}>
                  <Text style={[styles.statKey, phone && { fontSize: 12 }]}>{phone ? t.kShort : t.k}</Text>
                  <Text style={[styles.statValue, phone && { fontSize: 19 }]}>{t.v}</Text>
                </View>
              ))}
            </View>
            {s.admin.booked.map((b, i) => (phone && b.wideOnly ? null : (
              <View key={b.name} style={[styles.booked, phone && { gap: 10, paddingVertical: 10, paddingHorizontal: 16 }]}>
                <Face name={b.name} size={phone ? 28 : 32} color={BOOKED_FACE[i % BOOKED_FACE.length]} />
                <Text style={[styles.bookedName, phone && { fontSize: 14 }]}>{b.name}</Text>
                <Text style={[styles.bookedNote, phone && { fontSize: 12 }]}>{phone ? b.noteShort : b.note}</Text>
              </View>
            )))}
            <View style={[styles.remind, phone && { height: 50, paddingHorizontal: 16 }]}>
              <Text style={[styles.remindText, phone && { fontSize: 15 }]}>{s.admin.remind}</Text>
              <Icon name="forward" size={18} color={CREAM} strokeWidth={2.4} />
            </View>
          </View>
        </View>
      </View>

      {/* Close */}
      <View style={[styles.close, wide ? styles.closeWide : null, phone ? styles.closePhone : { paddingHorizontal: pad }]}>
        <SiteH2 style={[styles.closeTitle, phone && styles.closeTitlePhone, wide && styles.half]}>{s.close.title}</SiteH2>
        <View style={[{ gap: phone ? 16 : 14 }, wide && styles.half]}>
          <Text nativeID="host-kind-question" style={styles.question}>{s.close.question}</Text>
          <View
            accessibilityRole="radiogroup"
            aria-labelledby="host-kind-question"
            style={[styles.picker, phone && styles.pickerPhone]}
          >
            {s.close.kinds.map((o, i) => {
              const on = o.value === kind;
              return (
                <Pressable
                  key={o.value}
                  onPress={() => setKind(o.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  style={[
                    styles.option,
                    phone ? styles.optionPhone : { flex: 1, borderRightWidth: i < 3 ? 2 : 0 },
                    { backgroundColor: on ? LIME : phone ? INK : 'transparent' },
                  ]}
                >
                  <Text style={[styles.optionText, { color: on ? INK : CREAM }]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <InterestForm
            locale={locale} landingPage={landingPage} source="host" ground="ink" hostKind={kind}
            label={s.close.cta} successMessage={s.success} maxWidth={9999}
          />
        </View>
      </View>
    </View>
  );
}

/** A guest's face, drawn as their initial on a brand-tone circle. */
function Face({ name, size, color }: { name: string; size: number; color: string }) {
  const initial = name.replace(/^The\s+/i, '').charAt(0).toUpperCase();
  const dark = color === INK || color === MOSS;
  return (
    <View aria-hidden style={[styles.face, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
      <Text style={[styles.faceText, { fontSize: Math.round(size * 0.42), color: dark ? CREAM : INK }]}>{initial}</Text>
    </View>
  );
}

const H = fonts.heading;
const B = fonts.body;
const t = (size: number, weight: TextStyle['fontWeight'], extra?: TextStyle): TextStyle => ({ fontFamily: B, fontSize: size, fontWeight: weight, color: INK, ...extra });

const styles = StyleSheet.create({
  page: { backgroundColor: CREAM },
  half: { flex: 1, minWidth: 0 },
  shrink: { flex: 1, minWidth: 0 },
  bold: { fontWeight: '700' },
  ruleTop: { borderTopWidth: 2, borderTopColor: INK },
  ruleBottom: { borderBottomWidth: 2, borderBottomColor: INK },
  ruleRight: { borderRightWidth: 2, borderRightColor: INK },
  srOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },

  hero: { backgroundColor: LIME, paddingTop: 32, paddingBottom: 56, gap: 26 },
  heroPhone: { paddingTop: 16, paddingBottom: 32, paddingHorizontal: 20, gap: 18 },
  tag: t(14, '700', { alignSelf: 'flex-start', backgroundColor: INK, color: CREAM, letterSpacing: ls(14, 0.08), textTransform: 'uppercase', paddingVertical: 6, paddingHorizontal: 10 }),
  tagPhone: { fontSize: 13, letterSpacing: ls(13, 0.08), paddingVertical: 5, paddingHorizontal: 9 },
  hostIt: { fontFamily: H, fontWeight: '800', color: INK },
  heroRow: { borderTopWidth: 2, borderTopColor: INK, paddingTop: 22 },
  heroRowWide: { flexDirection: 'row', gap: 48, alignItems: 'flex-end' },
  intro: t(26, '600', { lineHeight: 26 * 1.3 }),
  introPhone: { fontSize: 19, lineHeight: 19 * 1.35 },

  head: { gap: 12 },
  headPhone: { gap: 10, paddingTop: 32, paddingBottom: 8, paddingHorizontal: 20, borderTopWidth: 2, borderTopColor: INK },
  num: { fontFamily: H, fontWeight: '800', color: INK },
  chapter: { fontFamily: H, fontWeight: '800', color: INK, fontSize: 96, letterSpacing: ls(96, -0.05), lineHeight: 96 * 0.92 },
  chapter04: { fontSize: 76, letterSpacing: ls(76, -0.045), lineHeight: 76 * 0.95 },
  chapterPhone: { fontSize: 48, letterSpacing: ls(48, -0.045), lineHeight: 48 * 0.95 },
  chapter04Phone: { fontSize: 44, letterSpacing: ls(44, -0.045), lineHeight: 44 * 0.95 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 2, borderTopColor: INK },
  kind: { gap: 18, paddingTop: 28, paddingBottom: 48 },
  kindPhone: { gap: 12, paddingTop: 22, paddingBottom: 26, borderTopWidth: 2, borderTopColor: INK },
  kindTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  kindTag: t(14, '800', { backgroundColor: LIME, paddingVertical: 4, paddingHorizontal: 8 }),
  kindTagPhone: { fontSize: 13, paddingVertical: 3, paddingHorizontal: 7 },
  freq: t(14, '700', { color: INK_MUTED }),
  kindTitle: { fontFamily: H, fontWeight: '800', color: INK, fontSize: 36, letterSpacing: ls(36, -0.035), lineHeight: 36, minHeight: 108 },
  kindTitlePhone: { fontFamily: H, fontWeight: '800', color: INK, fontSize: 30, letterSpacing: ls(30, -0.035), lineHeight: 30 },
  kindSub: t(17, '400', { lineHeight: 17 * 1.45, minHeight: 100 }),
  kindSubPhone: t(16, '400', { lineHeight: 16 * 1.45 }),
  card: { borderWidth: 2, borderColor: INK },
  photo: { height: 170 },
  photoPhone: { width: 110 },
  cardBody: { paddingTop: 16, paddingHorizontal: 16, paddingBottom: 18, gap: 8 },
  cardBodyPhone: { padding: 12, gap: 6, flex: 1, minWidth: 0 },
  kicker: t(12, '700', { letterSpacing: ls(12, 0.06), textTransform: 'uppercase', color: INK_MUTED }),
  cardTitle: { fontFamily: H, fontWeight: '800', color: INK, fontSize: 21, letterSpacing: ls(21, -0.02), lineHeight: 21 * 1.15 },
  cardTitlePhone: { fontFamily: H, fontWeight: '800', color: INK, fontSize: 17, lineHeight: 17 * 1.15 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 3, paddingHorizontal: 8 },
  pillPhone: { paddingHorizontal: 7 },
  pillText: t(13, '600'),
  running: t(13, '700', { letterSpacing: ls(13, 0.06), textTransform: 'uppercase', paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: INK }),
  eg: t(17, '600', { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HAIRLINE }),

  panels: { borderWidth: 2, borderColor: INK },
  panel: { padding: 32, gap: 16 },
  panelPhone: { padding: 20, gap: 12 },
  panelTitle: { fontFamily: H, fontWeight: '800', color: INK, fontSize: 40, letterSpacing: ls(40, -0.035), lineHeight: 40 },
  panelTitlePhone: { fontSize: 30, letterSpacing: ls(30, -0.03), lineHeight: 34 },
  panelBody: t(18, '400', { lineHeight: 18 * 1.45 }),
  panelBodyPhone: { fontSize: 16, lineHeight: 16 * 1.45 },
  guest: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  guestName: t(16, '700', { flex: 1 }),
  rsvp: t(13, '700', { paddingVertical: 3, paddingHorizontal: 8 }),
  rsvpPhone: { fontSize: 12, paddingHorizontal: 7 },
  session: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: INK_RULE },
  sessionCell: { flex: 1, minWidth: 0, fontFamily: B, color: CREAM },

  steps: { backgroundColor: LIME_TINT, paddingVertical: 72, gap: 36 },
  stepsPhone: { paddingTop: 32, paddingBottom: 12, paddingHorizontal: 20, gap: 10 },
  step: { paddingTop: 24, paddingBottom: 32, gap: 14 },
  stepPhone: { flexDirection: 'row', gap: 14, paddingTop: 16, paddingBottom: 20, borderTopWidth: 2, borderTopColor: INK },
  stepNum: { width: 48, height: 48, backgroundColor: INK, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { fontFamily: H, fontWeight: '800', fontSize: 20, color: LIME },
  stepTitle: { fontFamily: H, fontWeight: '800', color: INK, fontSize: 30, letterSpacing: ls(30, -0.03), lineHeight: 30 * 1.05 },
  stepTitlePhone: { fontFamily: H, fontWeight: '800', color: INK, fontSize: 22, letterSpacing: ls(22, -0.02) },
  stepText: t(17, '400', { lineHeight: 17 * 1.45 }),

  adminWide: { flexDirection: 'row' },
  adminBody: t(21, '400', { lineHeight: 21 * 1.4, maxWidth: 500 }),
  adminBodyPhone: { fontSize: 17, lineHeight: 17 * 1.4 },
  dashHead: { backgroundColor: LIME, paddingVertical: 18, paddingHorizontal: 20, gap: 4, borderBottomWidth: 2, borderBottomColor: INK },
  dashKicker: t(12, '700', { letterSpacing: ls(12, 0.06), textTransform: 'uppercase' }),
  dashDate: { fontFamily: H, fontWeight: '800', color: INK, fontSize: 28, letterSpacing: ls(28, -0.03) },
  statsRow: { flexDirection: 'row' },
  stat: { flex: 1, minWidth: 0, paddingVertical: 14, paddingHorizontal: 20, gap: 2 },
  statKey: t(13, '400', { color: INK_MUTED }),
  statValue: t(24, '800'),
  booked: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  bookedName: t(15, '700', { flex: 1 }),
  bookedNote: t(13, '400', { color: INK_MUTED }),
  remind: { height: 52, backgroundColor: INK, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  remindText: t(16, '700', { color: CREAM }),

  face: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  faceText: { fontFamily: B, fontWeight: '800' },

  close: { backgroundColor: INK, paddingVertical: 72, gap: 36 },
  closeWide: { flexDirection: 'row', gap: 48, alignItems: 'flex-end' },
  closePhone: { paddingTop: 36, paddingBottom: 40, paddingHorizontal: 20, gap: 16 },
  closeTitle: { fontFamily: H, fontWeight: '800', color: LIME, fontSize: 112, letterSpacing: ls(112, -0.055), lineHeight: 112 * 0.88 },
  closeTitlePhone: { fontSize: 60, letterSpacing: ls(60, -0.05), lineHeight: 60 * 0.9 },
  question: t(15, '700', { color: CREAM }),
  picker: { flexDirection: 'row', borderWidth: 2, borderColor: CREAM },
  pickerPhone: { flexWrap: 'wrap', gap: 2, backgroundColor: CREAM },
  option: { height: 48, justifyContent: 'center', paddingHorizontal: 14, borderColor: CREAM },
  // Two to a row with the 2px gap between them.
  optionPhone: { width: '49%', flexGrow: 1 },
  optionText: { fontFamily: B, fontWeight: '700', fontSize: 16 },
});
