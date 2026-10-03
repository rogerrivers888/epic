/**
 * The parts every guest screen is built from (guest handoff, 3 Oct 2026,
 * G1–G31). Each one is a block the prototype draws — a kicker, the title, the
 * lane tags, the host row, facts, "Going ahead?", ruled rows, chips, a segment,
 * people to tick, a field, a notice, cards, booking rows, the calendar, stars,
 * the price lines, buttons, the footer, a sheet and a toast — at the
 * prototype's own measurements. Headers are never drawn here: in-app pages use
 * the signed-off bands (components/Band.tsx — the 6c compact band) and the photo
 * head below; web pages put the epic.day wordmark where the back button was.
 *
 * Tokens (README): Archivo · ink · cream · warm grey cells · 1px rules · grey
 * text · lime for live, selected and good news · lime tint · deep green ·
 * moss links · amber for needs-you · red for cancel only. Radius 0 except
 * photos and avatars. No commentary captions.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View, type TextStyle, type ViewStyle } from 'react-native';
import { Press } from '../../components/press';
import { Icon } from '../../components/Icon';
import { useViewport } from '../../hooks/useViewport';
import {
  AMBER, AMBER_DARK, CREAM, DEEP_GREEN, GUEST_DAY_OFF, GUEST_PHOTO_BTN, GUEST_PLACEHOLDER, GUEST_RED, GUEST_SCRIM, GUEST_WARM,
  HAIRLINE, INACTIVE, INK, INK_MUTED, LIME, LIME_TINT, MOSS, TARGET, fonts,
} from '../../theme';

export { AMBER, AMBER_DARK, CREAM, DEEP_GREEN, GUEST_RED, HAIRLINE, INACTIVE, INK, INK_MUTED, LIME, LIME_TINT, MOSS };

const H = fonts.heading;
const B = fonts.body;
export const tx = (size: number, weight: TextStyle['fontWeight'] = '400', color = INK, extra: TextStyle = {}): TextStyle => ({ fontFamily: B, fontSize: size, fontWeight: weight, color, ...extra });
export const hx = (size: number, color = INK, extra: TextStyle = {}): TextStyle => ({ fontFamily: H, fontSize: size, fontWeight: '800', color, letterSpacing: Math.round(size * -0.03 * 100) / 100, lineHeight: Math.round(size * 1.08), ...extra });
const web = Platform.OS === 'web';
const nowrap = (web ? { whiteSpace: 'nowrap' } : {}) as TextStyle;

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

/**
 * A guest page: its head (a band or the photo), the scrolling column at 16/20/22
 * with 14 between blocks, then the footer. On a wide window the column is the
 * phone's 390 so it reads as drawn; the tab bar is the shell's, never ours.
 */
export function GuestPage({ head, foot, children, overlay }: { head: React.ReactNode; foot?: React.ReactNode; children: React.ReactNode; overlay?: React.ReactNode }) {
  const { width } = useViewport();
  const col: ViewStyle | null = width >= 900 ? { width: 430, alignSelf: 'center' } : null;
  return (
    <View style={{ flex: 1, backgroundColor: CREAM }}>
      {head}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={[{ paddingTop: 16, paddingHorizontal: 20, paddingBottom: 22, gap: 14 }, col]} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {foot ? <View style={col}>{foot}</View> : null}
      {overlay}
    </View>
  );
}

/** The status bar's height on a home-screen iPhone; nought in a browser tab. */
const topInset = (px: number) => (web ? (`max(${px}px, calc(var(--epic-sat) + ${px - 32}px))` as unknown as number) : px);

/**
 * The event's photo as the head (G2–G5, G12, G13, G23, G25): 230 tall, a soft
 * ink fade from the top, back and share as 38px squares at 32% ink with no
 * text. On the web the back square is the epic.day wordmark instead.
 */
export function PhotoHead({ uri, webPage, onBack, onShare }: { uri: string | null; webPage?: boolean; onBack?: () => void; onShare?: () => void }) {
  return (
    <View style={{ height: 230, backgroundColor: INACTIVE, flexShrink: 0 }}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
      {web ? React.createElement('div', { style: { position: 'absolute', inset: 0, background: 'linear-gradient(rgba(32,30,29,.35), rgba(32,30,29,0) 40%)' } }) : null}
      <View style={{ position: 'absolute', left: 16, right: 16, top: topInset(44), flexDirection: 'row', justifyContent: 'space-between' }}>
        {webPage
          ? <View style={{ height: 38, paddingHorizontal: 12, backgroundColor: CREAM, justifyContent: 'center' }}><Text style={hx(15)}>epic.day</Text></View>
          : <Press onPress={onBack ?? (() => {})} accessibilityRole="button" accessibilityLabel="Back" style={styles.photoBtn}><Icon name="previous" size={20} color={CREAM} strokeWidth={2.4} /></Press>}
        {onShare ? <Press onPress={onShare} accessibilityRole="button" accessibilityLabel="Share" style={styles.photoBtn}><Icon name="share" size={19} color={CREAM} strokeWidth={2.2} /></Press> : null}
      </View>
    </View>
  );
}

/** The footer: an optional price on the left, the main button (50px, ink) on the right or full width. */
export function Foot({ price, sub, label, onPress, disabled, tone = 'ink' }: {
  price?: string | null; sub?: string | null; label: string; onPress: () => void; disabled?: boolean; tone?: 'ink' | 'grey';
}) {
  const grey = disabled || tone === 'grey';
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: HAIRLINE, paddingTop: 10, paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: CREAM }}>
      {price ? (
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={hx(19)} numberOfLines={1}>{price}</Text>
          {sub ? <Text style={tx(12, '400', INK_MUTED)} numberOfLines={1}>{sub}</Text> : null}
        </View>
      ) : null}
      <Press onPress={disabled ? () => {} : onPress} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}
             style={[{ height: 50, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, backgroundColor: grey ? INACTIVE : INK }, price ? null : { flex: 1 }]}>
        <Text style={[tx(15, '700', grey ? INK_MUTED : CREAM), nowrap]}>{label}</Text>
        <Text style={tx(15, '700', grey ? INK_MUTED : CREAM)}>→</Text>
      </Press>
    </View>
  );
}

// ---------------------------------------------------------------------------
// blocks
// ---------------------------------------------------------------------------

/** 11px, 700, 0.06em, uppercase, grey; an optional moss link on the right. */
export function Kick({ children, link, top = 0 }: { children: string; link?: { label: string; onPress: () => void } | null; top?: number }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginTop: top }}>
      <Text style={tx(11, '700', INK_MUTED, { letterSpacing: 0.66, textTransform: 'uppercase' })} accessibilityRole="header">{children}</Text>
      {link ? <Press onPress={link.onPress} accessibilityRole="link"><Text style={tx(13, '700', MOSS)}>{link.label}</Text></Press> : null}
    </View>
  );
}

/** The title (26px), its line, and an optional warm-grey action on the right. */
export function Title({ title, line, action }: { title: string; line?: string | null; action?: { label: string; onPress: () => void } | null }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={hx(26)} accessibilityRole="header">{title}</Text>
        {line ? <Text style={tx(13.5, '400', INK_MUTED, { lineHeight: 19 })}>{line}</Text> : null}
      </View>
      {action ? <GreyAction label={action.label} onPress={action.onPress} /> : null}
    </View>
  );
}

/** A warm-grey 44px action with the message glyph ("Ask Kate"). */
export function GreyAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" style={{ height: 44, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: INACTIVE }}>
      <Icon name="message" size={16} color={INK} />
      <Text style={[tx(13.5, '700'), nowrap]}>{label}</Text>
    </Press>
  );
}

export type Tag = { label: string; bg: string; fg: string };
/** The lane chip and its neighbours (Drop off): heading font, 11.5px, 800. */
export function Tags({ items }: { items: Tag[] }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
      {items.map((t) => <Text key={t.label} style={[{ paddingVertical: 3, paddingHorizontal: 8, backgroundColor: t.bg }, hx(11.5, t.fg, { lineHeight: 15 }), nowrap]}>{t.label}</Text>)}
    </View>
  );
}

/** The host row: face, name, their reply time, then Ask on the right (or a chevron). */
export function HostRow({ face, name, line, onPress, ask }: { face: string | null; name: string; line: string; onPress?: () => void; ask?: { label: string; onPress: () => void } | null }) {
  return (
    <Press onPress={onPress ?? (() => {})} accessibilityRole={onPress ? 'link' : undefined} style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
      <View style={{ width: 40, height: 40, borderRadius: 999, overflow: 'hidden', backgroundColor: INACTIVE }}>
        {face ? <Image source={{ uri: face }} style={{ width: 40, height: 40 }} accessibilityIgnoresInvertColors /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={tx(14.5, '700')} numberOfLines={1}>{name}</Text>
        <Text style={tx(12.5, '400', INK_MUTED)} numberOfLines={1}>{line}</Text>
      </View>
      {ask ? <GreyAction label={ask.label} onPress={ask.onPress} /> : onPress ? <Text style={tx(14, '700', INK_MUTED)}>›</Text> : null}
    </Press>
  );
}

/** Two or more facts between 1px rules: a grey label over a bold value. */
export function Facts({ items, weights }: { items: { label: string; value: string }[]; weights?: number[] }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, borderTopWidth: 1, borderBottomWidth: 1, borderColor: HAIRLINE }}>
      {items.map((f, i) => (
        <View key={f.label} style={{ flex: weights?.[i] ?? 1, minWidth: 0, paddingVertical: 9, gap: 2 }}>
          <Text style={tx(12, '400', INK_MUTED)}>{f.label}</Text>
          <Text style={tx(14.5, '800', INK, { lineHeight: 18 })}>{f.value}</Text>
        </View>
      ))}
    </View>
  );
}

/** Going ahead? (G2, G29): three cream boxes on the lime tint, then one line. */
export function GoingAhead({ boxes, line, big, bg = LIME_TINT }: { boxes: { label: string; value: string }[]; line: string; big?: string | null; bg?: string }) {
  return (
    <View style={{ backgroundColor: bg, padding: 12, gap: 8 }}>
      <Text style={tx(11, '700', INK_MUTED, { letterSpacing: 0.66, textTransform: 'uppercase' })}>Going ahead?</Text>
      {big ? <Text style={hx(19)}>{big}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {boxes.map((b) => (
          <View key={b.label} style={{ flex: 1, minWidth: 0, backgroundColor: CREAM, paddingVertical: 8, paddingHorizontal: 9, gap: 2 }}>
            <Text style={[tx(11, '400', INK_MUTED), nowrap]}>{b.label}</Text>
            <Text style={[hx(17), nowrap]}>{b.value}</Text>
          </View>
        ))}
      </View>
      <Text style={tx(13, '400', INK, { lineHeight: 18 })}>{line}</Text>
    </View>
  );
}

/** Plain words, 14px. */
export const Para = ({ children, color = INK }: { children: React.ReactNode; color?: string }) => <Text style={tx(14, '400', color, { lineHeight: 21 })}>{children}</Text>;

export type RowItem = { title: string; sub?: string | null; value?: string | null; valueColor?: string; weight?: TextStyle['fontWeight']; onPress?: () => void; key?: string };
/** Ruled rows: title (and a grey line under it), a value on the right, a chevron when it opens. */
export function Rows({ items }: { items: RowItem[] }) {
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: HAIRLINE }}>
      {items.map((r, i) => (
        <Press key={r.key ?? `${r.title}:${i}`} onPress={r.onPress ?? (() => {})} accessibilityRole={r.onPress ? 'button' : undefined}
               style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={tx(14, r.weight ?? '600')}>{r.title}</Text>
            {r.sub ? <Text style={tx(12.5, '400', INK_MUTED)}>{r.sub}</Text> : null}
          </View>
          {r.value ? <Text style={[tx(13.5, '700', r.valueColor ?? INK), nowrap]}>{r.value}</Text> : null}
          {r.onPress ? <Text style={tx(14, '700', INK_MUTED)}>›</Text> : null}
        </Press>
      ))}
    </View>
  );
}

export type Choice = { label: string; sub?: string | null; on: boolean; onPress: () => void; disabled?: boolean; key?: string };
/** Chips that wrap: warm grey off, lime on. */
export function Chips({ items }: { items: Choice[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {items.map((c) => (
        <Press key={c.key ?? c.label} onPress={c.disabled ? () => {} : c.onPress} accessibilityRole="button" accessibilityState={{ selected: c.on, disabled: !!c.disabled }}
               style={{ paddingVertical: 8, paddingHorizontal: 12, backgroundColor: c.on ? LIME : INACTIVE }}>
          <Text style={[tx(13.5, c.on ? '800' : c.disabled ? '500' : '600', c.disabled ? INK_MUTED : INK), nowrap]}>{c.label}</Text>
        </Press>
      ))}
    </View>
  );
}

/** A segment: equal cells, 44 tall, a second grey line under each when it has one. */
export function Seg({ items }: { items: Choice[] }) {
  return (
    <View style={{ flexDirection: 'row', gap: 3 }} accessibilityRole="radiogroup">
      {items.map((c) => (
        <Press key={c.key ?? c.label} onPress={c.onPress} accessibilityRole="radio" accessibilityState={{ checked: c.on }}
               style={{ flex: 1, minWidth: 0, height: 44, alignItems: 'center', justifyContent: 'center', gap: 1, paddingHorizontal: 6, backgroundColor: c.on ? LIME : INACTIVE }}>
          <Text style={[tx(13.5, c.on ? '800' : '600'), nowrap]}>{c.label}</Text>
          {c.sub ? <Text style={[tx(11, '600', INK_MUTED), nowrap]}>{c.sub}</Text> : null}
        </Press>
      ))}
    </View>
  );
}

export type Person = { key: string; name: string; line: string; on: boolean; disabled?: boolean; onPress: () => void; extra?: { label: string; color?: string; onPress?: () => void }[] | null };
/** People to tick (Who's going): a 22px box, lime when ticked; greyed with the reason when they can't go. */
export function People({ items }: { items: Person[] }) {
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: HAIRLINE }}>
      {items.map((p) => (
        <View key={p.key} style={{ gap: 8, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
          <Press onPress={p.disabled ? () => {} : p.onPress} accessibilityRole="checkbox" accessibilityState={{ checked: p.on, disabled: !!p.disabled }}
                 style={{ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: p.disabled ? 0.42 : 1 }}>
            <View style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: p.on ? LIME : CREAM, borderWidth: p.on ? 0 : 1, borderColor: HAIRLINE }}>
              {p.on ? <Icon name="check" size={13} color={INK} strokeWidth={3} /> : null}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={tx(14.5, '700')}>{p.name}</Text>
              <Text style={tx(12.5, '400', INK_MUTED)}>{p.line}</Text>
            </View>
          </Press>
          {p.extra?.length ? (
            <View style={{ marginLeft: 34, flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {p.extra.map((e) => (
                <Press key={e.label} onPress={e.onPress ?? (() => {})} style={{ paddingVertical: 7, paddingHorizontal: 10, backgroundColor: INACTIVE }}>
                  <Text style={tx(12.5, '600', e.color ?? INK)}>{e.label}</Text>
                </Press>
              ))}
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** A field: optional bold label, a 1px box (red when wrong), the error under it. */
export function Field({ label, value, onChange, placeholder, height, error, keyboardType, maxLength, onSubmit }: {
  label?: string; value: string; onChange: (v: string) => void; placeholder?: string; height?: number; error?: string | null;
  keyboardType?: 'default' | 'phone-pad' | 'numeric' | 'email-address'; maxLength?: number; onSubmit?: () => void;
}) {
  // An address is typed as it is: no capital, no autocorrect.
  const email = keyboardType === 'email-address';
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={tx(13, '700')}>{label}</Text> : null}
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={GUEST_PLACEHOLDER} multiline={!!height}
                 keyboardType={keyboardType} maxLength={maxLength} accessibilityLabel={label ?? placeholder}
                 autoCapitalize={email ? 'none' : undefined} autoCorrect={email ? false : undefined} onSubmitEditing={onSubmit}
                 {...(email && Platform.OS === 'web' ? ({ autoComplete: 'email' } as object) : {})}
                 style={[tx(14.5), { borderWidth: 1, borderColor: error ? INK : HAIRLINE, paddingVertical: 12, paddingHorizontal: 13 }, height ? { minHeight: height, textAlignVertical: 'top' } : null]} />
      {/* Red is for destructive confirms only (Roger, 3 Oct 2026): an error is ink, bold. */}
      {error ? <Text style={tx(12.5, '700', INK)}>{error}</Text> : null}
    </View>
  );
}

/** A notice: a filled block, warm grey unless told (lime good news, amber needs-you, lime tint money). */
export function Notice({ children, bg = INACTIVE, weight = '600' }: { children: React.ReactNode; bg?: string; weight?: TextStyle['fontWeight'] }) {
  return <View style={{ backgroundColor: bg, paddingVertical: 11, paddingHorizontal: 13 }}><Text style={tx(13.5, weight, INK, { lineHeight: 19.5 })}>{children}</Text></View>;
}

export type MiniCard = { key: string; photo: string | null; title: string; line: string; price: string; lane: string; left?: string | null; onPress: () => void };
/** Small event cards in a sideways row (the host's events, similar nearby): 220 wide, 136 photo. */
export function Cards({ items }: { items: MiniCard[] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}>
      {items.map((c) => (
        <Press key={c.key} onPress={c.onPress} accessibilityRole="link" style={{ width: 220, gap: 7 }}>
          <View style={{ height: 136, borderRadius: 10, overflow: 'hidden', backgroundColor: INACTIVE }}>
            {c.photo ? <Image source={{ uri: c.photo }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
            <Text style={[{ position: 'absolute', left: 7, top: 7, backgroundColor: CREAM, paddingVertical: 4, paddingHorizontal: 8 }, tx(11, '700')]}>{c.lane}</Text>
            {c.left ? <Text style={[{ position: 'absolute', right: 7, bottom: 7, backgroundColor: LIME, paddingVertical: 4, paddingHorizontal: 8 }, tx(11, '800')]}>{c.left}</Text> : null}
          </View>
          <Text style={tx(14.5, '700', INK, { lineHeight: 18 })} numberOfLines={2}>{c.title}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text style={tx(12, '400', INK_MUTED)} numberOfLines={1}>{c.line}</Text>
            <Text style={[tx(13, '800'), nowrap]}>{c.price}</Text>
          </View>
        </Press>
      ))}
    </ScrollView>
  );
}

export type BookingCard = { key: string; photo: string | null; title: string; line: string; chip: string; chipBg: string; extra?: string | null; dim?: boolean; onPress: () => void };
/** A booking as a row (Plans › Events, Booked): 60px photo at radius 8, title, date, chip and a deep-green extra. */
export function BookingRows({ items }: { items: BookingCard[] }) {
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: HAIRLINE }}>
      {items.map((c) => (
        <Press key={c.key} onPress={c.onPress} accessibilityRole="link"
               style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HAIRLINE, opacity: c.dim ? 0.75 : 1 }}>
          <View style={{ width: 60, height: 60, borderRadius: 8, overflow: 'hidden', backgroundColor: INACTIVE }}>
            {c.photo ? <Image source={{ uri: c.photo }} style={{ width: 60, height: 60 }} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text style={tx(14.5, '700')} numberOfLines={1}>{c.title}</Text>
            <Text style={tx(12.5, '400', INK_MUTED)} numberOfLines={1}>{c.line}</Text>
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <Text style={[{ paddingVertical: 3, paddingHorizontal: 7, backgroundColor: c.chipBg }, tx(11.5, '700'), nowrap]}>{c.chip}</Text>
              {c.extra ? <Text style={[tx(12, '700', DEEP_GREEN), nowrap]}>{c.extra}</Text> : null}
            </View>
          </View>
          <Text style={tx(14, '700', INK_MUTED)}>›</Text>
        </Press>
      ))}
    </View>
  );
}

/** A month, Monday first: only the bookable days lit (lime tint), the picked one lime. */
export function MonthPicker({ month, days, picked, onPick, onPrev, onNext }: {
  month: Date; days: Set<string>; picked: string | null; onPick: (day: string) => void; onPrev: (() => void) | null; onNext: (() => void) | null;
}) {
  const y = month.getUTCFullYear(); const m = month.getUTCMonth();
  const lead = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: count }, (_x, i) => `${y}-${String(m + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)];
  const name = new Date(Date.UTC(y, m, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <View style={{ borderWidth: 1, borderColor: HAIRLINE, padding: 10, gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Press onPress={onPrev ?? (() => {})} accessibilityRole="button" accessibilityLabel="Previous month" style={{ paddingHorizontal: 8, opacity: onPrev ? 1 : 0.3 }}><Text style={tx(14, '700')}>‹</Text></Press>
        <Text style={tx(14, '700')}>{name}</Text>
        <Press onPress={onNext ?? (() => {})} accessibilityRole="button" accessibilityLabel="Next month" style={{ paddingHorizontal: 8, opacity: onNext ? 1 : 0.3 }}><Text style={tx(14, '700')}>›</Text></Press>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <Text key={`h${i}`} style={[{ width: `${100 / 7}%`, textAlign: 'center' }, tx(11, '700', INK_MUTED)]}>{d}</Text>)}
        {cells.map((d, i) => {
          const ok = d != null && days.has(d); const sel = d != null && d === picked;
          return (
            <View key={d ?? `x${i}`} style={{ width: `${100 / 7}%`, padding: 1.5 }}>
              <Press onPress={ok && d ? () => onPick(d) : () => {}} accessibilityRole={ok ? 'button' : undefined} accessibilityState={{ selected: sel, disabled: !ok }}
                     style={{ height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: sel ? LIME : ok ? LIME_TINT : 'transparent' }}>
                <Text style={tx(14, sel ? '800' : ok ? '700' : '500', ok ? INK : GUEST_DAY_OFF)}>{d ? String(Number(d.slice(8))) : ''}</Text>
              </Press>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** Five stars, 38px each, ink when set. */
export function Stars({ label, value, onPick }: { label: string; value: number; onPick: (n: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <Text style={tx(14, '700')}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 4 }} accessibilityRole="adjustable" accessibilityLabel={`${label}, ${value} of 5`}>
        {[1, 2, 3, 4, 5].map((k) => (
          <Press key={k} onPress={() => onPick(k)} accessibilityRole="button" accessibilityLabel={`${k} star${k === 1 ? '' : 's'}`} style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="favourite" size={24} color={k <= value ? INK : HAIRLINE} fill />
          </Press>
        ))}
      </View>
    </View>
  );
}

export type PriceLine = { label: string; value: string; color?: string; bold?: boolean };
/** The price lines between rules; the total bold. */
export function PriceLines({ items }: { items: PriceLine[] }) {
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: HAIRLINE }}>
      {items.map((r) => (
        <View key={r.label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
          <Text style={tx(14, r.bold ? '800' : '600', r.color ?? INK)}>{r.label}</Text>
          <Text style={tx(14, r.bold ? '800' : '600', r.color ?? INK)}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

export type Btn = { label: string; onPress: () => void; tone?: 'ink' | 'grey' | 'red' | 'redText'; icon?: React.ComponentProps<typeof Icon>['name']; key?: string; disabled?: boolean };
/**
 * Buttons (README): secondary is a warm-grey fill, 56 tall, as wide as its label —
 * never a hairline box, never full width unless paired on a row. An ink one is primary.
 */
export function Buttons({ items, row }: { items: Btn[]; row?: boolean }) {
  return (
    <View style={{ flexDirection: row ? 'row' : 'column', alignItems: row ? 'stretch' : 'flex-start', gap: 6 }}>
      {items.map((b) => {
        const bg = b.tone === 'ink' ? INK : b.tone === 'red' ? GUEST_RED : INACTIVE;
        const fg = b.tone === 'ink' || b.tone === 'red' ? CREAM : b.tone === 'redText' ? GUEST_RED : INK;
        return (
          <Press key={b.key ?? b.label} onPress={b.disabled ? () => {} : b.onPress} accessibilityRole="button" accessibilityState={{ disabled: !!b.disabled }}
                 style={[{ height: 56, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: bg }, row ? { flex: 1 } : null, b.disabled ? { opacity: 0.4 } : null]}>
            {b.icon ? <Icon name={b.icon} size={17} color={fg} /> : null}
            <Text style={[tx(14.5, '700', fg), nowrap]}>{b.label}</Text>
          </Press>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// sheet and toast
// ---------------------------------------------------------------------------

/** A sheet from the bottom, pinned to the phone frame when there is one; 21px title and a ×. */
export function GuestSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { framed, origin, width, height } = useViewport();
  const frame: ViewStyle = framed ? { position: 'absolute', left: origin?.x ?? 0, top: origin?.y ?? 0, width, height } : { flex: 1 };
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} visible>
      <View style={frame}>
        <Press onPress={onClose} accessibilityLabel="Close" style={[StyleSheet.absoluteFill, { backgroundColor: GUEST_SCRIM }]} />
        <View style={{ marginTop: 'auto', backgroundColor: CREAM, maxHeight: '82%', width: '100%', maxWidth: 430, alignSelf: 'center' }}>
          <ScrollView contentContainerStyle={{ paddingTop: 16, paddingHorizontal: 20, paddingBottom: 22, gap: 12 }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <Text style={[hx(21), { flex: 1 }]} accessibilityRole="header">{title}</Text>
              <Press onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={{ minWidth: TARGET, minHeight: 28, alignItems: 'flex-end' }}><Icon name="close" size={20} color={INK_MUTED} /></Press>
            </View>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** A toast: an ink bar above the tab bar for 2.4 seconds. */
export function useToast() {
  const [words, setWords] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const show = useCallback((w: string) => {
    if (timer.current) clearTimeout(timer.current);
    setWords(w);
    timer.current = setTimeout(() => setWords(null), 2400);
  }, []);
  const node = words ? (
    <View pointerEvents="none" style={{ position: 'absolute', left: 20, right: 20, bottom: 96, backgroundColor: INK, paddingVertical: 12, paddingHorizontal: 14, zIndex: 8 }} accessibilityLiveRegion="polite">
      <Text style={tx(13.5, '700', CREAM)}>{words}</Text>
    </View>
  ) : null;
  return { show, node };
}

/** The ink promo (G21): "Plan your next day out with Epic", the lime line, and a × that never brings it back. */
export function Promo({ title, line, onPress, onClose }: { title: string; line: string; onPress: () => void; onClose: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, backgroundColor: INK }}>
      <Press onPress={onPress} accessibilityRole="link" style={{ flex: 1, minWidth: 0 }}>
        <Text style={tx(14.5, '700', CREAM)}>{title}</Text>
        <Text style={tx(12.5, '600', LIME, { marginTop: 2 })}>{line}</Text>
      </Press>
      <Press onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss" style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="close" size={18} color={GUEST_WARM} />
      </Press>
    </View>
  );
}

/** Loading, or why it didn't load, in one line. */
export const Waiting = ({ error }: { error?: string | null }) => (
  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: CREAM, padding: 20 }}>
    <Text style={tx(14, '400', INK_MUTED)}>{error ?? 'Loading…'}</Text>
  </View>
);

const styles = StyleSheet.create({
  photoBtn: { width: 38, height: 38, backgroundColor: GUEST_PHOTO_BTN, alignItems: 'center', justifyContent: 'center' },
});

// ---------------------------------------------------------------------------
// words
// ---------------------------------------------------------------------------

/** The lane chip's colours (README): One-off ink · Weekly deep green · Course lime tint · On request warm grey. */
export const LANE_TAG: Record<string, Tag> = {
  oneoff: { label: 'One-off', bg: INK, fg: CREAM },
  weekly: { label: 'Weekly', bg: DEEP_GREEN, fg: CREAM },
  course: { label: 'Course', bg: LIME_TINT, fg: INK },
  onrequest: { label: 'On request', bg: INACTIVE, fg: INK },
};

/** Status chips (README): On ✓ lime · Waiting on numbers, Requested, Changed amber · ready, Rate it lime · Invite lime tint · the rest warm grey. */
export const CHIP_BG: Record<string, string> = {
  on: LIME, waiting: AMBER, requested: AMBER, changed: AMBER, ready: LIME, rate: LIME, invite: LIME_TINT,
  called_off: INACTIVE, cancelled: INACTIVE, waitlist: INACTIVE, not_this_time: INACTIVE,
};

/** £12, £12.50, Free. */
export const gbp = (p: number | null | undefined) => (p == null ? '—' : p === 0 ? 'Free' : `£${(p / 100).toFixed(p % 100 ? 2 : 0)}`);
/** "Sat 3 Oct" from YYYY-MM-DD, read as a calendar day. */
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dayWords = (ymd: string | null | undefined) => {
  if (!ymd) return '';
  // Spelled here rather than by the browser, which says "Sept" in some places and "Sep" in others.
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00Z`);
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
};
/** "3 Oct" from a timestamp, in the phone's own day. */
export const shortDay = (iso: string) => { const d = new Date(iso); return `${d.getDate()} ${MON[d.getMonth()]}`; };
export const firstName = (n: string | null | undefined) => (n ?? '').trim().split(/\s+/)[0] || 'the host';
