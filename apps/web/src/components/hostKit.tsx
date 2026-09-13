/**
 * The hosting screens' primitives, measured off the canvases.
 *
 * Owner, 13 Sep 2026: "mirror them exactly to the pixel, all of them … pay
 * attention also to spacing and font size, because everything seems a bit
 * more compact and not as aesthetically pleasing as it is on the mockups."
 *
 * So every size here is the prototype's own (`Epic Host prototype.dc.html`,
 * `Epic Host Journey.dc.html`): a screen title is 24–29px / 800 / −0.035em, a
 * blurb 13.5px on 1.5, a form label 13px / 700 with 6px to its field, a field
 * 1px rule with 14px padding and 16px / 500 text, a card 13px padding with a
 * 1px rule that becomes a 2px ink rule on the lime tint when picked, and the
 * primary action a 52px ink bar with its arrow at the far right. Nothing in a
 * hosting screen sets a size of its own; it asks for one of these.
 */

import React from 'react';
import { Platform, StyleSheet, Text, TextInput, TextInputProps, TextStyle, View, ViewStyle } from 'react-native';
import { Press } from './press';
import { colors, fonts, BORDER, LIME, INK } from '../theme';
import { Icon, IconName } from './Icon';
import { PlacePicker as PlacePickerLazy } from './PlacePicker';

// ---------------------------------------------------------------------------
// type
// ---------------------------------------------------------------------------

/** A heading at the canvas's size: Archivo 800, −0.035em, tight leading. */
const heading = (size: number, lh: number, track = -0.035): TextStyle => ({ fontFamily: fonts.heading, fontSize: size, fontWeight: '800', letterSpacing: Math.round(size * track * 100) / 100, lineHeight: Math.round(size * lh), color: colors.ink });
const body = (size: number, lh: number, weight: TextStyle['fontWeight'] = '400', color: string = colors.ink): TextStyle => ({ fontFamily: fonts.body, fontSize: size, fontWeight: weight, lineHeight: Math.round(size * lh), color });

export const t = StyleSheet.create({
  // screen titles
  h31: heading(31, 1.02), h29: heading(29, 1.08), h27: heading(27, 1.05), h26: heading(26, 1.06), h25: heading(25, 1.1), h24: heading(24, 1.1), h23: heading(23, 1.05, -0.03), h22: heading(22, 1.12, -0.03), h21: heading(21, 1.08, -0.03),
  // headings inside rows and cards
  h18: heading(18, 1.2, -0.02), h17: heading(17, 1.2, -0.02), h16: heading(16, 1.2, -0.02), nav: heading(17, 1.2, -0.02),
  // the eyebrow: 11px caps, letter-spaced, in the heading face
  kicker: { fontFamily: fonts.heading, fontSize: 11, fontWeight: '700', letterSpacing: 0.66, textTransform: 'uppercase', color: colors.inkMuted, lineHeight: 14 },
  kickerGreen: { color: colors.accent },
  // body
  sub: body(13.5, 1.5, '400', colors.inkMuted),
  body: body(14.5, 1.45, '400', colors.ink),
  small: body(12.5, 1.45, '400', colors.inkMuted),
  tiny: body(12, 1.4, '400', colors.inkMuted),
  // a form label and a link
  label: body(13, 1.3, '700', colors.ink),
  link: body(12.5, 1.3, '700', colors.accent),
  // text on lime and on the tint
  onLime: { color: colors.onLime },
  // fields
  input: { fontFamily: fonts.body, fontSize: 16, fontWeight: '500', color: colors.ink },
  strong: { fontWeight: '700' },
});

// ---------------------------------------------------------------------------
// boxes
// ---------------------------------------------------------------------------

export const k = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  wide: { maxWidth: 720, alignSelf: 'center', width: '100%' },
  gutter: { paddingHorizontal: 20 },
  // the nav row: back · title · spacer (prototype: padding 8 20 0)
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8 },
  navBtn: { width: 30, height: 30, justifyContent: 'center' },
  // progress: label row + bars (padding 12 20 0, gap 8; bars gap 5, 4px)
  prog: { paddingHorizontal: 20, paddingTop: 12, gap: 8 },
  progRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  progBars: { flexDirection: 'row', gap: 5 },
  progBar: { flex: 1, height: 4, backgroundColor: colors.ruleSoft },
  progBarOn: { backgroundColor: LIME },
  // a field: 1px rule, 14px padding, square
  field: { borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface, paddingHorizontal: 14, paddingVertical: 13, minHeight: 50 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  seeded: { borderLeftWidth: 3, borderLeftColor: LIME, paddingLeft: 12 },
  // a card you pick: 13px padding, 1px rule; picked is a 2px ink rule on the tint
  card: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 13, borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface },
  cardOn: { padding: 12, borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surfaceMuted },
  // tiles that hold an icon or a number
  tile30: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  tile34: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  tile36: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  tile38: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  tile44: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  warm: { backgroundColor: colors.warm },
  tint: { backgroundColor: colors.surfaceMuted },
  lime: { backgroundColor: LIME },
  ink: { backgroundColor: colors.primary },
  // the tick that marks a picked card
  tick22: { width: 22, height: 22, backgroundColor: LIME, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  tick24: { width: 24, height: 24, backgroundColor: LIME, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  // a check box: 20px, 1px rule until it is on
  box20: { width: 20, height: 20, borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  box22: { width: 22, height: 22, borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  boxOn: { backgroundColor: LIME, borderColor: LIME },
  // a row in a list, ruled beneath
  rule: { borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  ruleTop: { borderTopWidth: 1, borderTopColor: colors.ruleSoft },
  // a small caps tag: 11 / 700 / .03em, 4×8 padding
  tag: { paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.warm, alignSelf: 'flex-start' },
  tagText: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.33, color: colors.inkMuted, lineHeight: 13 },
  // two or three cells that share a row: ink when picked, the tint otherwise
  // "A segmented control is drawn as 1px ink around the pair with ink fill on the chosen half — not as two grey blocks" (lanes A and B).
  segs: { flexDirection: 'row', borderWidth: 1, borderColor: colors.line },
  seg: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 11, paddingHorizontal: 6, backgroundColor: colors.surface },
  segOn: { backgroundColor: colors.primary },
  segText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.inkMuted, textAlign: 'center' },
  segTextOn: { color: colors.primaryFg },
  // a weekday: lime when on, warm grey otherwise
  day: { flex: 1, alignItems: 'center', paddingVertical: 9, backgroundColor: colors.warm },
  dayOn: { backgroundColor: LIME },
  dayText: { fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: colors.inkMuted },
  dayTextOn: { color: INK },
  // a chip you pick from a set: lime when on
  chip: { paddingHorizontal: 12, paddingVertical: 9, backgroundColor: colors.warm },
  chipOn: { backgroundColor: LIME },
  chipText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.inkMuted, lineHeight: 16 },
  chipTextOn: { color: INK },
  // notes and panels
  panelTint: { backgroundColor: colors.surfaceMuted, paddingVertical: 12, paddingHorizontal: 13 },
  panelWarm: { backgroundColor: colors.warm, paddingVertical: 11, paddingHorizontal: 12 },
  // the lime block at the top of a learn or done screen
  limeBlock: { backgroundColor: LIME, paddingVertical: 16, paddingHorizontal: 18, gap: 9 },
  // dashed drop zone
  dashed: { flexDirection: 'row', gap: 11, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 13, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.ghost },
  // the primary action: 52px ink bar, label left, arrow right
  ctaWrap: { paddingHorizontal: 20, paddingBottom: 8 },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, height: 50, backgroundColor: colors.primary },
  ctaText: { fontFamily: fonts.body, fontSize: 15.5, fontWeight: '700', color: colors.primaryFg },
  ctaLime: { backgroundColor: LIME },
  ctaLimeText: { color: INK },
  ctaQuiet: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.ruleSoft },
  ctaQuietText: { color: colors.ink },
  ctaSub: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkMuted, textAlign: 'center', paddingHorizontal: 20, paddingBottom: 10, lineHeight: 16 },
  // a second, smaller action under the first: 46px, ruled
  ctaLow: { height: 46, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.ruleSoft },
  ctaLowText: { fontFamily: fonts.body, fontSize: 14.5, fontWeight: '600', color: colors.ink },
});

// ---------------------------------------------------------------------------
// pieces
// ---------------------------------------------------------------------------

/** The stack's nav row: a back chevron, the title centred, a spacer the chevron's width. */
export function Nav({ title, onBack, right }: { title: string; onBack: () => void; right?: React.ReactNode }) {
  return (
    <View style={k.nav}>
      <Press onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" style={k.navBtn} hitSlop={8}><Icon name="previous" size={22} color={colors.ink} strokeWidth={2} /></Press>
      <Text style={t.nav}>{title}</Text>
      <View style={{ width: 30, alignItems: 'flex-end' }}>{right ?? null}</View>
    </View>
  );
}

/** "Who can come · 2 of 7" over as many bars as there are steps, the done ones lime. */
export function Progress({ label, at, of }: { label: string; at: number; of: number }) {
  return (
    <View style={k.prog}>
      <View style={k.progRow}><Text style={[t.small, { fontWeight: '600', lineHeight: 15 }]}>{label}</Text><Text style={[t.small, { lineHeight: 15 }]}>{at} of {of}</Text></View>
      <View style={k.progBars}>{Array.from({ length: of }, (_, i) => <View key={i} style={[k.progBar, i < at && k.progBarOn]} />)}</View>
    </View>
  );
}

/** A label six pixels above its field, a note beneath, and an optional link on the label's line. */
export function Field({ label, hint, right, gap = 6, children, style }: { label: string; hint?: string | null; right?: React.ReactNode; gap?: number; children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[{ gap }, style]}>
      {right ? <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}><Text style={t.label}>{label}</Text>{right}</View> : <Text style={t.label}>{label}</Text>}
      {children}
      {hint ? <Text style={t.tiny}>{hint}</Text> : null}
    </View>
  );
}

/** The field itself: 16px / 500 inside a 1px rule with 14px padding. `seeded` gives it the 3px lime edge. */
export function Input({ seeded, style, multiline, ...rest }: TextInputProps & { seeded?: boolean }) {
  return (
    <TextInput
      {...rest}
      multiline={multiline}
      placeholderTextColor={colors.ghost}
      style={[k.field, t.input, multiline && { minHeight: 88, lineHeight: 22, textAlignVertical: 'top' }, seeded && k.seeded, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null, style]}
    />
  );
}

/** A field that opens something when tapped — a date, a place — drawn as the input is. */
export function Picker({ value, placeholder, icon, seeded, onPress, trailing }: { value?: string | null; placeholder: string; icon?: IconName; seeded?: boolean; onPress: () => void; trailing?: IconName }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" style={[k.field, k.fieldRow, seeded && k.seeded]}>
      {icon ? <Icon name={icon} size={17} color={colors.inkMuted} strokeWidth={2} /> : null}
      <Text style={[t.input, { flex: 1 }, !value && { color: colors.ghost }]} numberOfLines={1}>{value || placeholder}</Text>
      {trailing ? <Icon name={trailing} size={17} color={colors.ink} strokeWidth={2} /> : null}
    </Press>
  );
}

/** A lime square with an ink tick, the mark of a picked card (22 or 24px). */
export function Tick({ size = 22 }: { size?: 22 | 24 }) {
  return <View style={size === 24 ? k.tick24 : k.tick22}><Icon name="check" size={size === 24 ? 14 : 13} color={INK} strokeWidth={3} /></View>;
}

/** A check box: a 1px rule until it is on, then lime with the tick. */
export function CheckBox({ on, size = 20 }: { on: boolean; size?: 20 | 22 }) {
  return <View style={[size === 22 ? k.box22 : k.box20, on && k.boxOn]}>{on ? <Icon name="check" size={size === 22 ? 13 : 12} color={INK} strokeWidth={3.2} /> : null}</View>;
}

/** A small caps tag — LIVE, SERIES, PUBLIC — on warm grey, lime, the tint or ink. */
export function Tag({ children, tone = 'warm' }: { children: string; tone?: 'warm' | 'lime' | 'tint' | 'ink' | 'plain' }) {
  const bg = tone === 'lime' ? LIME : tone === 'tint' ? colors.surfaceMuted : tone === 'ink' ? colors.primary : tone === 'plain' ? colors.surface : colors.warm;
  const fg = tone === 'lime' ? INK : tone === 'tint' ? colors.accent : tone === 'ink' ? colors.primaryFg : tone === 'plain' ? colors.ink : colors.inkMuted;
  return <View style={[k.tag, { backgroundColor: bg }]}><Text style={[k.tagText, { color: fg }]} numberOfLines={1}>{children}</Text></View>;
}

/** Two or three choices sharing one row, the picked one ink. */
export function Segments<T extends string>({ value, options, onPick, gap = 0, pad = 11 }: { value: T | null; options: { value: T; label: string }[]; onPick: (v: T) => void; gap?: number; pad?: number }) {
  return (
    <View style={[k.segs, { gap }]}>
      {options.map((o) => {
        const on = o.value === value;
        return <Press key={o.value} onPress={() => onPick(o.value)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[k.seg, { paddingVertical: pad }, on && k.segOn]}><Text style={[k.segText, on && k.segTextOn]} numberOfLines={1}>{o.label}</Text></Press>;
      })}
    </View>
  );
}

/** M T W T F S S, lime when on; multi or single. */
export function Weekdays({ on, onPress, gap = 4 }: { on: (n: number) => boolean; onPress: (n: number) => void; gap?: number }) {
  const DAYS = [{ n: 1, l: 'M' }, { n: 2, l: 'T' }, { n: 3, l: 'W' }, { n: 4, l: 'T' }, { n: 5, l: 'F' }, { n: 6, l: 'S' }, { n: 0, l: 'S' }];
  return (
    <View style={{ flexDirection: 'row', gap }}>
      {DAYS.map((d) => { const isOn = on(d.n); return <Press key={d.n} onPress={() => onPress(d.n)} accessibilityRole="button" accessibilityState={{ selected: isOn }} style={[k.day, isOn && k.dayOn]}><Text style={[k.dayText, isOn && k.dayTextOn]}>{d.l}</Text></Press>; })}
    </View>
  );
}

/** A chip from a set — Under 5 · 5–8 · 9–12 — lime when picked. */
export function PickChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return <Press onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} style={[k.chip, on && k.chipOn]}><Text style={[k.chipText, on && k.chipTextOn]}>{label}</Text></Press>;
}

/**
 * A number in a small box with its unit beside it — "90 minutes", "2 days" —
 * typed, never nudged (owner, 4 Sep 2026). The box is the prototype's 140px.
 */
export function UnitBox({ value, onChange, onCommit, unit, width = 140, big, prefix, fill }: { value: string; onChange: (v: string) => void; onCommit?: () => void; unit?: string; width?: number; big?: boolean; prefix?: string; fill?: boolean }) {
  return (
    <View style={[k.field, k.fieldRow, fill ? { flex: 1 } : { width }, { paddingVertical: big ? 12 : 13 }]}>
      {prefix ? <Text style={[big ? t.h22 : t.input]}>{prefix}</Text> : null}
      <TextInput value={value} onChangeText={onChange} onBlur={onCommit} onSubmitEditing={onCommit} keyboardType="number-pad" returnKeyType="done" selectTextOnFocus placeholder="0" placeholderTextColor={colors.ghost}
        style={[big ? t.h22 : t.input, { flex: 1, minWidth: 0, padding: 0 }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]} />
      {unit ? <Text style={[t.input, { color: colors.inkMuted }]}>{unit}</Text> : null}
    </View>
  );
}

/**
 * The primary action: a 52px ink bar, label at the left, arrow at the right,
 * with an optional caption beneath. `quiet` is the cream, ruled version the
 * learn screens use ("Show me what people host", "Got it").
 */
export function Cta({ label, onPress, sub, quiet, lime, arrow = true, loading, disabled, icon, style }: { label: string; onPress: () => void; sub?: string | null; quiet?: boolean; lime?: boolean; arrow?: boolean; loading?: boolean; disabled?: boolean; icon?: IconName; style?: ViewStyle }) {
  const fg = quiet || lime ? colors.ink : colors.primaryFg;
  return (
    <View style={[k.ctaWrap, style]}>
      <Press onPress={onPress} disabled={loading || disabled} accessibilityRole="button" style={[k.cta, quiet && k.ctaQuiet, lime && k.ctaLime, (loading || disabled) && { opacity: 0.6 }]}>
        <Text style={[k.ctaText, quiet && k.ctaQuietText, lime && k.ctaLimeText]}>{loading ? 'One moment…' : label}</Text>
        {icon ? <Icon name={icon} size={17} color={fg} strokeWidth={2} /> : arrow && !quiet ? <Icon name="forward" size={17} color={fg} strokeWidth={2} /> : null}
      </Press>
      {sub ? <Text style={[k.ctaSub, { paddingHorizontal: 0, paddingBottom: 0, paddingTop: 6 }]}>{sub}</Text> : null}
    </View>
  );
}

/** A bulleted rule: a 6px ink square and the words. */
export function Bullet({ children, color }: { children: string; color?: string }) {
  return <View style={{ flexDirection: 'row', gap: 9, alignItems: 'flex-start' }}><View style={{ width: 6, height: 6, backgroundColor: colors.ink, marginTop: 6 }} /><Text style={[t.label, { fontWeight: '400', lineHeight: 19, flex: 1 }, color ? { color } : null]}>{children}</Text></View>;
}

/**
 * Where: the town or the venue, drawn as the prototype's field with a pin once
 * it is known, and the search only when it is not or when it is tapped.
 */
export function PlaceField({ value, onPick, placeholder, kind, seeded }: { value: { label: string } | null; onPick: (p: any) => void; placeholder: string; kind?: 'area'; seeded?: boolean }) {
  const [editing, setEditing] = React.useState(false);
  if (value && !editing) return <Picker icon="address" value={value.label} placeholder={placeholder} seeded={seeded} onPress={() => setEditing(true)} />;
  return <View style={seeded ? k.seeded : undefined}><PlacePickerLazy value={null} onPick={(p: any) => { onPick(p); if (p) setEditing(false); }} placeholder={placeholder} kind={kind} autoFocus={editing} /></View>;
}

/** A 30px circle with an initial: the guest in a list (lanes A and B: "avatars 999px"). */
export function Avatar({ name, size = 30 }: { name: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: 999, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: colors.ink }}>{(name.trim()[0] ?? '?').toUpperCase()}</Text></View>;
}

/** INVITED · ACCEPTED · MIN · MAX — the status row's cell (C2). */
export function StatCell({ label, value, hot }: { label: string; value: string; hot?: boolean }) {
  return (
    <View style={[{ flex: 1, borderWidth: 1, borderColor: colors.ruleSoft, paddingVertical: 9, paddingHorizontal: 8, gap: 2, minWidth: 0 }, hot && { borderWidth: 2, borderColor: colors.line, backgroundColor: colors.surfaceMuted, paddingVertical: 8, paddingHorizontal: 7 }]}>
      <Text style={{ fontFamily: fonts.body, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.52, color: colors.inkMuted, lineHeight: 12 }}>{label}</Text>
      <Text style={{ fontFamily: fonts.heading, fontSize: 19, fontWeight: '800', letterSpacing: -0.38, color: colors.ink, lineHeight: 23 }}>{value}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// the pieces "what you are up for" draws (Casual meet ups, O1–O14)
// ---------------------------------------------------------------------------

/**
 * A plain fact, carrying a guarantee: a 2px ink left rule, 11px of padding and
 * no fill. The board uses it for every promise the flow makes — "they do not
 * know you exist", "a no is silent" — so it is one component, not a style
 * copied per screen.
 */
export function Aside({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ borderLeftWidth: 2, borderLeftColor: colors.line, paddingLeft: 11, paddingVertical: 1 }}>
      <Text style={[t.small, { lineHeight: 18 }]}>{children}</Text>
    </View>
  );
}

/** A refusal: a 1px red rule and red type. The two family rules, and the one about addresses. */
export function RedNote({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: 9, alignItems: 'flex-start', paddingVertical: 11, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.overrun }}>
      <Icon name="alert" size={15} color={colors.overrun} strokeWidth={2} />
      <Text style={[t.small, { flex: 1, fontWeight: '600', color: colors.overrun, lineHeight: 17 }]}>{children}</Text>
    </View>
  );
}

/**
 * A chip. Lime is what you said this time and carries an × to take it off;
 * warm grey is a fact from your profile or the trip, and taps to change it.
 * The project keeps this pairing everywhere, so the colour is the meaning.
 */
export function SaidChip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <View style={[styles.chipBase, { backgroundColor: LIME, borderColor: LIME }]}>
      <Text style={[t.body, { fontSize: 13.5, fontWeight: '600', color: INK, lineHeight: 17 }]}>{label}</Text>
      {onRemove ? <Press onPress={onRemove} accessibilityRole="button" accessibilityLabel={`Take off ${label}`} hitSlop={8}><Icon name="close" size={13} color={INK} strokeWidth={2.4} /></Press> : null}
    </View>
  );
}

export function FactChip({ label, onPress }: { label: string; onPress?: () => void }) {
  const body = (
    <View style={[styles.chipBase, { backgroundColor: colors.warm, borderColor: colors.ruleSoft }]}>
      <Text style={[t.body, { fontSize: 13.5, fontWeight: '600', color: colors.ink, lineHeight: 17 }]}>{label}</Text>
    </View>
  );
  return onPress ? <Press onPress={onPress} accessibilityRole="button">{body}</Press> : body;
}

/** One of a set you pick from: lime and 700 when it is on, warm grey when it is not. */
export function ChoiceChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.chipBase, { paddingVertical: 9, paddingHorizontal: 12, backgroundColor: on ? LIME : colors.warm, borderColor: on ? LIME : colors.ruleSoft }]}>
      <Text style={[t.body, { fontSize: 13.5, fontWeight: on ? '700' : '600', color: on ? INK : colors.ink, lineHeight: 17 }]}>{label}</Text>
      {on ? <Icon name="check" size={13} color={INK} strokeWidth={3} /> : null}
    </Press>
  );
}

/** A ruled row: a 30px warm tile, a title and a line under it. The board's workhorse. */
export function InfoRow({ icon, title, line, onPress }: { icon: IconName; title: string; line?: string | null; onPress?: () => void }) {
  const body = (
    <View style={{ flexDirection: 'row', gap: 11, alignItems: 'flex-start', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft }}>
      <View style={[k.tile30, k.warm, { borderWidth: 1, borderColor: colors.ruleSoft }]}><Icon name={icon} size={15} color={INK} strokeWidth={2} /></View>
      <View style={{ flex: 1 }}>
        <Text style={[t.body, { fontWeight: '700', lineHeight: 18 }]}>{title}</Text>
        {line ? <Text style={[t.small, { lineHeight: 17, marginTop: 1 }]}>{line}</Text> : null}
      </View>
      {onPress ? <Icon name="more" size={16} color={colors.inkMuted} strokeWidth={2} /> : null}
    </View>
  );
  return onPress ? <Press onPress={onPress} accessibilityRole="button">{body}</Press> : body;
}

/** The lime success block: a 44px ink square with a lime tick, a heading and a deep-green line. */
export function DoneBlock({ title, line }: { title: string; line: string }) {
  return (
    <View style={[k.limeBlock, { padding: 18, flexDirection: 'row', gap: 12, alignItems: 'center' }]}>
      <View style={[k.tile44, k.ink]}><Icon name="check" size={24} color={LIME} strokeWidth={3} /></View>
      <View style={{ flex: 1 }}>
        <Text style={[t.h21, { color: INK }]}>{title}</Text>
        <Text style={[t.small, { color: colors.onLime, marginTop: 2, lineHeight: 16 }]}>{line}</Text>
      </View>
    </View>
  );
}

/** A consequence, at size: lime tint, no rule, deep-green type. */
export function TintBlock({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: colors.surfaceMuted, padding: 15, gap: 6 }}>
      {title ? <Text style={[t.h21, { lineHeight: 24 }]}>{title}</Text> : null}
      <Text style={[t.label, { fontWeight: '400', color: colors.accent, lineHeight: 19 }]}>{children}</Text>
    </View>
  );
}

/** Two buttons side by side: one filled, one ruled. The answer to every question in this flow. */
export function TwoWay({ yes, no, onYes, onNo, tone = 'lime', icon, busy, wide = 1.4 }: {
  yes: string; no: string; onYes: () => void; onNo: () => void; tone?: 'lime' | 'ink'; icon?: IconName; busy?: boolean; wide?: number;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Press onPress={onYes} disabled={busy} accessibilityRole="button" style={[styles.answer, { flex: wide, backgroundColor: tone === 'lime' ? LIME : colors.primary }, busy && { opacity: 0.6 }]}>
        {icon ? <Icon name={icon} size={16} color={tone === 'lime' ? INK : colors.primaryFg} strokeWidth={2} /> : null}
        <Text style={[t.body, { fontWeight: '700', color: tone === 'lime' ? INK : colors.primaryFg }]}>{yes}</Text>
      </Press>
      <Press onPress={onNo} disabled={busy} accessibilityRole="button" style={[styles.answer, { flex: 1, borderWidth: 1, borderColor: colors.line }, busy && { opacity: 0.6 }]}>
        <Text style={[t.body, { fontWeight: '700' }]}>{no}</Text>
      </Press>
    </View>
  );
}

const styles = StyleSheet.create({
  chipBase: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 8, paddingHorizontal: 11, borderWidth: 1 },
  answer: { height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
