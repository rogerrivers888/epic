/**
 * The v7 hosting screens' primitives, measured off the prototype
 * (`Supporting docs/Host/Host v3/Epic Host prototype v7.dc.html`) with the
 * README's tokens: Archivo throughout, kickers 11/700 at 0.06em, every rule
 * 1px #D7D3D3 ("No black lines"), radius 0 except photos and record controls.
 * A step asks for one of these rather than sizing anything itself.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, TextStyle, View, ViewStyle } from 'react-native';
import { Press } from '../../../components/press';
import { Icon, IconName } from '../../../components/Icon';
import { CREAM, HAIRLINE, INACTIVE, INK, INK_MUTED, LIME, LIME_TINT, MOSS, DEEP_GREEN, SHEET_SCRIM, TICK_EDGE, fonts } from '../../../theme';
import { MONTHS_LONG, at, iso, todayIso, parseTime, parseLength, lengthWords } from './model';

const web = Platform.OS === 'web';
export const pointer = (web ? { cursor: 'pointer' } : {}) as ViewStyle;
const noOutline = (web ? { outlineStyle: 'none' } : {}) as TextStyle;
const ellipsis = (web ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } : {}) as TextStyle;
const preLine = (web ? { whiteSpace: 'pre-line' } : {}) as TextStyle;

const H = fonts.heading;
const B = fonts.body;
export const tx = (size: number, weight: TextStyle['fontWeight'] = '400', color = INK, extra: TextStyle = {}): TextStyle => ({ fontFamily: B, fontSize: size, fontWeight: weight, color, ...extra });
export const hx = (size: number, track = -0.03, lh = 1.1, color = INK): TextStyle => ({ fontFamily: H, fontSize: size, fontWeight: '800', color, letterSpacing: Math.round(size * track * 100) / 100, lineHeight: Math.round(size * lh) });

export const v = StyleSheet.create({
  kicker: { fontFamily: H, fontSize: 11, fontWeight: '700', letterSpacing: 0.66, textTransform: 'uppercase', color: INK_MUTED },
  kickerGreen: { color: DEEP_GREEN },
  link: tx(13.5, '600', MOSS),
  sub: tx(13, '400', INK_MUTED, { lineHeight: 18 }),
  small: tx(12, '400', INK_MUTED),
  body: tx(15, '400', INK, { lineHeight: 21 }),
  rowTitle: tx(14.5, '600'),
  rowSub: tx(12, '400', INK_MUTED, { marginTop: 2 }),
  title: hx(24, -0.03, 1.1),
  count: tx(12.5, '400', INK_MUTED),
  list: { borderTopWidth: 1, borderTopColor: HAIRLINE },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  box: { height: 46, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: HAIRLINE, backgroundColor: CREAM },
  boxText: tx(15, '400'),
  tint: { backgroundColor: LIME_TINT },
  note: { backgroundColor: LIME_TINT, paddingVertical: 10, paddingHorizontal: 12 },
  noteText: tx(13, '600', DEEP_GREEN),
});

// ---------------------------------------------------------------------------
// type
// ---------------------------------------------------------------------------

export const Kicker = ({ children, green, style }: { children: React.ReactNode; green?: boolean; style?: TextStyle }) => (
  <Text style={[v.kicker, green && v.kickerGreen, style]}>{children}</Text>
);

/** A step's title and its counter, "3 of 8" — always derived from the lane's steps. */
export function StepTitle({ title, count }: { title: string; count?: string | null }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
      <Text style={[v.title, { flex: 1 }]}>{title}</Text>
      {count ? <Text style={[v.count, { flexShrink: 0 }]}>{count}</Text> : null}
    </View>
  );
}

/** "+ Add something": a moss text action. */
export const AddLink = ({ label, onPress, style }: { label: string; onPress: () => void; style?: ViewStyle }) => (
  <Press onPress={onPress} accessibilityRole="button" style={[{ paddingVertical: 6 }, pointer, style]}><Text style={v.link}>+ {label}</Text></Press>
);

export const Note = ({ children }: { children: React.ReactNode }) => <View style={v.note}><Text style={v.noteText}>{children}</Text></View>;

// ---------------------------------------------------------------------------
// boxes you type into
// ---------------------------------------------------------------------------

export function Labelled({ label, children, style }: { label: string; children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[{ gap: 6, flex: 1, minWidth: 0 }, style]}><Kicker>{label}</Kicker>{children}</View>;
}

/** A 46px ruled box with text in it. `onBlurValue` lets a typed time or length tidy itself when the host leaves it. */
export function Field({ value, onChange, placeholder, multiline, rows = 2, prefix, onBlur, style, inputStyle, keyboard, autoFocus, maxLength, tinted, accessibilityLabel }: {
  value: string; onChange: (s: string) => void; placeholder?: string; multiline?: boolean; rows?: number; prefix?: string; onBlur?: () => void;
  style?: ViewStyle; inputStyle?: TextStyle; keyboard?: 'numeric' | 'decimal-pad' | 'email-address' | 'phone-pad' | 'default'; autoFocus?: boolean; maxLength?: number; tinted?: boolean; accessibilityLabel?: string;
}) {
  return (
    <View style={[v.box, multiline && { height: undefined, minHeight: 46, alignItems: 'flex-start', paddingVertical: 11 }, tinted && { backgroundColor: CREAM }, style]}>
      {prefix ? <Text style={[v.boxText, { marginRight: 2 }]}>{prefix}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChange}
        onBlur={onBlur}
        placeholder={placeholder}
        placeholderTextColor={INK_MUTED}
        multiline={multiline}
        numberOfLines={multiline ? rows : 1}
        keyboardType={keyboard}
        autoFocus={autoFocus}
        maxLength={maxLength}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        style={[v.boxText, { flex: 1, minWidth: 0, padding: 0, lineHeight: multiline ? 21 : undefined }, multiline && { minHeight: rows * 21 }, noOutline, inputStyle]}
      />
    </View>
  );
}

/** A time, typed: "9" becomes 09:00 when the host leaves the box. */
export function TimeBox({ value, onChange, placeholder = '00:00', style }: { value: string | null; onChange: (t: string | null) => void; placeholder?: string; style?: ViewStyle }) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => { setText(value ?? ''); }, [value]);
  return <Field value={text} onChange={setText} placeholder={placeholder} keyboard="numeric" maxLength={5} style={style}
    onBlur={() => { const t = parseTime(text); setText(t ?? ''); onChange(t); }} accessibilityLabel="Time" />;
}

/** How long, typed: "45", "1 hr", "1h30". Shown back in words. */
export function LengthBox({ value, onChange, style }: { value: number | null; onChange: (m: number | null) => void; style?: ViewStyle }) {
  const [text, setText] = useState(lengthWords(value));
  useEffect(() => { setText(lengthWords(value)); }, [value]);
  return <Field value={text} onChange={setText} placeholder="1 hr" style={style}
    onBlur={() => { const m = parseLength(text); setText(lengthWords(m)); onChange(m); }} accessibilityLabel="How long" />;
}

/** A price box: £ then the figure. Empty is "not set". */
export function MoneyBox({ value, onChange, placeholder, style, big }: { value: string; onChange: (s: string) => void; placeholder?: string; style?: ViewStyle; big?: boolean }) {
  return <Field value={value} onChange={(s) => onChange(s.replace(/[^0-9.]/g, ''))} placeholder={placeholder} prefix="£" keyboard="decimal-pad" style={style}
    inputStyle={big ? hx(20, -0.02, 1.2) : undefined} />;
}

// ---------------------------------------------------------------------------
// switches, ticks, options
// ---------------------------------------------------------------------------

/** The 42×24 switch: lime when on, the knob an ink square. */
export function Switch({ on }: { on: boolean }) {
  return (
    <View style={{ width: 42, height: 24, backgroundColor: on ? LIME : HAIRLINE, flexShrink: 0 }}>
      <View style={{ position: 'absolute', top: 4, left: on ? 22 : 4, width: 16, height: 16, backgroundColor: INK }} />
    </View>
  );
}

/** A row with a switch. Tapping anywhere on it flips it. */
export function ToggleRow({ title, sub, on, onFlip, right }: { title: string; sub?: string | null; on: boolean; onFlip: () => void; right?: React.ReactNode }) {
  return (
    <Press onPress={onFlip} accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={title} style={[v.row, pointer]}>
      <View style={{ flex: 1 }}>
        <Text style={v.rowTitle}>{title}</Text>
        {sub ? <Text style={v.rowSub}>{sub}</Text> : null}
      </View>
      {right}
      <Switch on={on} />
    </Press>
  );
}

/** A square tick box: lime and ticked, or cream with a grey edge. */
export function Tick({ on, size = 22, mark }: { on: boolean; size?: number; mark?: React.ReactNode }) {
  return (
    <View style={{ width: size, height: size, backgroundColor: on ? LIME : CREAM, borderWidth: 1, borderColor: on ? LIME : TICK_EDGE, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {mark ?? (on ? <Icon name="check" size={Math.round(size * 0.6)} color={INK} strokeWidth={3} /> : null)}
    </View>
  );
}

/**
 * An option you pick (Where, Is it free?, Parents, Who can come): lime tint
 * and a lime tick when chosen, and its own settings open in place beneath it.
 */
export function Option({ title, sub, on, onPick, children }: { title: string; sub?: string | null; on: boolean; onPick: () => void; children?: React.ReactNode }) {
  return (
    <View>
      <Press onPress={onPick} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={title}
        style={[{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 12, paddingHorizontal: 14, backgroundColor: on ? LIME_TINT : CREAM, borderWidth: 1, borderColor: HAIRLINE }, pointer]}>
        <View style={{ flex: 1 }}>
          <Text style={tx(15, '700')}>{title}</Text>
          {sub ? <Text style={tx(12.5, '400', INK_MUTED, { lineHeight: 17.5, marginTop: 2 })}>{sub}</Text> : null}
        </View>
        <View style={{ width: 20, height: 20, borderWidth: 1, borderColor: on ? LIME : TICK_EDGE, backgroundColor: on ? LIME : CREAM, flexShrink: 0 }} />
      </Press>
      {on && children ? <View style={{ backgroundColor: LIME_TINT, paddingVertical: 12, paddingHorizontal: 14, gap: 10 }}>{children}</View> : null}
    </View>
  );
}

/** Chips you tick (dietary ticks, needs): lime when on. */
export function TickChip({ label, on, onPress, ground = CREAM }: { label: string; on: boolean; onPress: () => void; ground?: string }) {
  return (
    <Press onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={[{ paddingVertical: 6, paddingHorizontal: 10, backgroundColor: on ? LIME : ground }, pointer]}>
      <Text style={tx(13, '700')}>{label}</Text>
    </Press>
  );
}

// ---------------------------------------------------------------------------
// numbers
// ---------------------------------------------------------------------------

/**
 * A number with − and + either side, as the design draws it — and the number
 * itself is a box you can type into, so a big number is never twenty taps.
 */
export function Count({ value, onChange, min = 1, max = 100000, size = 24, btn = 28, ground = CREAM, label, gap = 8 }: {
  value: number | null; onChange: (n: number) => void; min?: number; max?: number; size?: number; btn?: number; ground?: string; label: string; gap?: number;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => { setText(value == null ? '' : String(value)); }, [value]);
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const commit = () => { const n = Number(text.replace(/\D/g, '')); if (text.trim() && Number.isFinite(n)) onChange(clamp(n)); else setText(value == null ? '' : String(value)); };
  const step = (d: number) => onChange(clamp((value ?? min - d) + d));
  const button = (sign: '−' | '+', d: number) => (
    <Press onPress={() => step(d)} accessibilityRole="button" accessibilityLabel={`${d < 0 ? 'Fewer' : 'More'} — ${label}`}
      style={[{ width: btn, height: btn, backgroundColor: ground, alignItems: 'center', justifyContent: 'center' }, pointer]}>
      <Text style={tx(16, '700')}>{sign}</Text>
    </Press>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap }}>
      {button('−', -1)}
      <TextInput value={text} onChangeText={setText} onBlur={commit} onSubmitEditing={commit} keyboardType="numeric" accessibilityLabel={label}
        style={[hx(size, -0.02, 1.2), { textAlign: 'center', minWidth: 22, maxWidth: 72, flexShrink: 1, padding: 0 }, noOutline]} />
      {button('+', 1)}
    </View>
  );
}

/** Minimum and maximum side by side: the grey and lime-tint pair that means a range. */
export function MinMax({ min, max, onMin, onMax, suffix = '', cap = 100000 }: { min: number | null; max: number | null; onMin: (n: number) => void; onMax: (n: number) => void; suffix?: string; cap?: number }) {
  const cell = (label: string, value: number | null, on: (n: number) => void, bg: string, lo: number, hi: number) => (
    <View style={{ flex: 1, backgroundColor: bg, paddingVertical: 10, paddingHorizontal: 12, gap: 6 }}>
      <Kicker>{label}{suffix}</Kicker>
      <Count value={value} onChange={on} min={lo} max={hi} label={label} />
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {cell('Min people', min, onMin, INACTIVE, 1, max ?? cap)}
      {cell('Max people', max, onMax, LIME_TINT, min ?? 1, cap)}
    </View>
  );
}

// ---------------------------------------------------------------------------
// a date, picked off a month
// ---------------------------------------------------------------------------

/**
 * The prototype's month calendar: ‹ month › and a Monday-first grid. The
 * picked day is lime; `marked` days (a course's run) are tinted; `allow`
 * limits which days can be picked (a weekly class's weekdays).
 */
export function MonthGrid({ value, onPick, marked = [], allow, from = todayIso() }: { value: string | null; onPick: (d: string) => void; marked?: string[]; allow?: (d: string) => boolean; from?: string }) {
  const start = value ?? from;
  const [month, setMonth] = useState(() => ({ y: at(start).getUTCFullYear(), m: at(start).getUTCMonth() }));
  const marks = useMemo(() => new Set(marked), [marked]);
  const first = new Date(Date.UTC(month.y, month.m, 1, 12));
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(month.y, month.m + 1, 0, 12)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => iso(new Date(Date.UTC(month.y, month.m, i + 1, 12))))];
  const go = (d: number) => setMonth(({ y, m }) => ({ y: m + d < 0 ? y - 1 : m + d > 11 ? y + 1 : y, m: (m + d + 12) % 12 }));
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Press onPress={() => go(-1)} accessibilityLabel="Previous month" style={[{ paddingHorizontal: 6 }, pointer]}><Icon name="previous" size={18} color={INK} /></Press>
        <Text style={tx(14, '700')}>{MONTHS_LONG[month.m]} {month.y}</Text>
        <Press onPress={() => go(1)} accessibilityLabel="Next month" style={[{ paddingHorizontal: 6 }, pointer]}><Icon name="more" size={18} color={INK} /></Press>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((h, i) => <View key={`h${i}`} style={{ width: `${100 / 7}%` }}><Text style={tx(11, '700', INK_MUTED, { textAlign: 'center' })}>{h}</Text></View>)}
        {cells.map((d, i) => {
          const can = d != null && d >= from && (!allow || allow(d));
          const on = d != null && d === value;
          const mark = d != null && marks.has(d);
          return (
            <View key={i} style={{ width: `${100 / 7}%`, padding: 1.5 }}>
              {d ? (
                <Press disabled={!can} onPress={() => onPick(d)} accessibilityLabel={d}
                  style={[{ height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? LIME : mark ? LIME_TINT : 'transparent' }, can && pointer]}>
                  <Text style={tx(14, on ? '800' : mark ? '700' : '500', can ? INK : TICK_EDGE)}>{at(d).getUTCDate()}</Text>
                </Press>
              ) : <View style={{ height: 34 }} />}
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** A date box that drops the month calendar open beneath it. */
export function DateBox({ value, words, onPick, placeholder = 'Pick a date', allow, marked, from, compact }: {
  value: string | null; words: string; onPick: (d: string) => void; placeholder?: string; allow?: (d: string) => boolean; marked?: string[]; from?: string;
  /** A narrow box (three to a row): the date only, without the Calendar hint. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Press onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityLabel={value ? words : placeholder}
        style={[v.box, { justifyContent: 'space-between', borderColor: open ? INK : HAIRLINE }, compact && { paddingHorizontal: 10 }, pointer]}>
        <Text style={[v.boxText, !value && { color: INK_MUTED }]} numberOfLines={1}>{value ? words : placeholder}</Text>
        {compact ? null : <Text style={tx(13, '400', INK_MUTED)}>{open ? 'Close' : 'Calendar'}</Text>}
      </Press>
      {open ? (
        <View style={{ borderWidth: 1, borderTopWidth: 0, borderColor: HAIRLINE, padding: 10 }}>
          <MonthGrid value={value} onPick={(d) => { onPick(d); setOpen(false); }} allow={allow} marked={marked} from={from} />
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// the link blocks on Who can come
// ---------------------------------------------------------------------------

/** "Invite link" / "Link to the page": the link on one line, Share and Copy ("Copied" in lime for 1.6s). */
export function LinkBlock({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 1600); return () => clearTimeout(t); }, [copied]);
  const shown = url.replace(/^https?:\/\//, '');
  const copy = async () => { try { await (navigator as any)?.clipboard?.writeText(url); } catch { /* the link is still on screen */ } setCopied(true); };
  const share = async () => {
    const nav = (globalThis as any).navigator;
    if (nav?.share) { try { await nav.share({ url }); return; } catch { return; } }
    void copy();
  };
  const btn = (icon: IconName, text: string, onPress: () => void, bg: string) => (
    <Press onPress={onPress} accessibilityRole="button" style={[{ flex: 1, height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: bg }, pointer]}>
      <Icon name={icon} size={16} color={INK} strokeWidth={2} /><Text style={tx(14, '700')}>{text}</Text>
    </Press>
  );
  return (
    <View style={{ backgroundColor: INACTIVE, padding: 12, gap: 10 }}>
      <Kicker>{label}</Kicker>
      <Text style={[tx(15, '600'), ellipsis]} numberOfLines={1}>{shown}</Text>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {btn('share', 'Share', share, CREAM)}
        {btn('copy', copied ? 'Copied' : 'Copy', copy, copied ? LIME : CREAM)}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// the action bar, and the overlays
// ---------------------------------------------------------------------------

/** The 48px ink bar with its arrow at the far right, and the moss link above it when there is one. */
export function ActionBar({ label, onPress, disabled, link, busy, bordered }: { label: string; onPress: () => void; disabled?: boolean; link?: { t: string; go: () => void } | null; busy?: boolean; bordered?: boolean }) {
  return (
    <View style={[{ paddingTop: 10, paddingHorizontal: 20, paddingBottom: 14, gap: 6, backgroundColor: CREAM }, bordered && { borderTopWidth: 1, borderTopColor: HAIRLINE }]}>
      {link ? <Press onPress={link.go} accessibilityRole="button" style={[{ paddingVertical: 4, alignSelf: 'flex-start' }, pointer]}><Text style={v.link}>{link.t}</Text></Press> : null}
      <Press onPress={disabled || busy ? undefined : onPress} accessibilityRole="button" accessibilityState={{ disabled: !!disabled || !!busy }}
        style={[{ height: 48, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: INK, opacity: disabled ? 0.35 : 1 }, !disabled && pointer]}>
        <Text style={tx(15, '700', CREAM)}>{busy ? 'One moment…' : label}</Text>
        <Icon name="forward" size={18} color={CREAM} strokeWidth={2.2} />
      </Press>
    </View>
  );
}

/** A sheet over the screen (the checklist's sheets): a scrim, then cream from 90px down, its title and a close. Drawn in the tree, so it stays inside the phone frame. */
export function Overlay({ title, onClose, children, footer, full }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; full?: boolean }) {
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 20 }]}>
      <Press onPress={onClose} accessibilityLabel="Close" style={[StyleSheet.absoluteFill, { backgroundColor: SHEET_SCRIM }]} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: full ? 0 : 90, backgroundColor: CREAM }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
          <Text style={hx(18, -0.02, 1.2)}>{title}</Text>
          <Press onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={pointer}><Icon name="close" size={20} color={INK} /></Press>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 14, paddingHorizontal: 20, paddingBottom: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer}
      </View>
    </View>
  );
}

export const textStyles = { ellipsis, preLine };
