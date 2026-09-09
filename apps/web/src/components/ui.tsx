import React, { useEffect, useState } from 'react';
import { StyleSheet, StyleProp, Text, TextInput, View, ViewStyle, ActivityIndicator } from 'react-native';
import { Press } from './press';
import { colors, fonts, radius, spacing, type, TARGET, BORDER } from '../theme';
import { Icon, IconName } from './Icon';

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={type.h2}>{children}</Text>
      {hint ? <Text style={type.small}>{hint}</Text> : null}
    </View>
  );
}

type ChipTone = 'neutral' | 'allergen' | 'like' | 'dislike' | 'want' | 'accent';
const chipTones: Record<ChipTone, { bg: string; fg: string; border: string }> = {
  // Every chip carries the same ink rule; the tone is what fills it. The one
  // exception is an allergen, whose rule stays red because it means danger.
  neutral: { bg: colors.surface, fg: colors.ink, border: colors.line },
  allergen: { bg: colors.allergenSoft, fg: colors.allergen, border: colors.allergen },
  like: { bg: colors.likeSoft, fg: colors.like, border: colors.line },
  dislike: { bg: colors.dislikeSoft, fg: colors.dislike, border: colors.line },
  want: { bg: colors.wantSoft, fg: colors.want, border: colors.line },
  accent: { bg: colors.accentSoft, fg: colors.accent, border: colors.line },
};

export function Chip({
  label,
  tone = 'neutral',
  onPress,
  onRemove,
  selected,
  icon,
  iconFill,
}: {
  label: string;
  tone?: ChipTone;
  onPress?: () => void;
  onRemove?: () => void;
  selected?: boolean;
  /** An icon from the set, drawn in the chip's own colour before the label. */
  icon?: IconName;
  /** Fill the icon (a kept heart, a favourite star). */
  iconFill?: boolean;
}) {
  // Selected is the brand moment: a lime fill with ink type, inside the same
  // ink rule as every other chip (Epic pack §07). Tones are the lime tint,
  // moss and ink — there are no other colours.
  const t = selected ? { bg: colors.selected, fg: colors.selectedFg, border: colors.ink } : chipTones[tone];
  const body = (
    <View style={[styles.chip, { backgroundColor: t.bg, borderColor: t.border }]}>
      {icon ? <View style={{ marginRight: 5 }}><Icon name={icon} size={14} color={t.fg} fill={iconFill} /></View> : null}
      <Text style={[styles.chipText, { color: t.fg, flexShrink: 1 }]}>{label}</Text>
      {onRemove ? (
        <Press onPress={onRemove} hitSlop={10} accessibilityLabel={`Remove ${label}`} style={{ marginLeft: 6 }}>
          <Icon name="close" size={14} color={t.fg} />
        </Press>
      ) : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} style={{ maxWidth: '100%' }}>
      {body}
    </Press>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  loading,
  style,
  icon,
  iconFill,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  /** An icon from the set before the label, in the button's text colour. */
  icon?: IconName;
  iconFill?: boolean;
}) {
  // A primary is an ink fill with cream type on light grounds and a lime fill
  // with ink type on dark ones — which is what `primary`/`primaryFg` already
  // are in each palette. A secondary is a 2px ink outline (Epic pack §07).
  const bg = kind === 'primary' ? colors.primary : kind === 'danger' ? colors.overrunSoft : kind === 'secondary' ? colors.surface : 'transparent';
  const fg = kind === 'primary' ? colors.primaryFg : kind === 'danger' ? colors.overrun : colors.ink;
  const border = kind === 'secondary' ? colors.ink : kind === 'ghost' ? colors.line : 'transparent';
  return (
    <Press
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : (
        <View style={styles.buttonInner}>
          {icon ? <Icon name={icon} size={16} color={fg} fill={iconFill} /> : null}
          <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>
        </View>
      )}
    </Press>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  /** `icon` draws one from the set before the label — Car / Train & metro (Hotels 2 §16). */
  options: { value: T; label: string; icon?: IconName }[];
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <Press
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.segment, i > 0 && styles.segmentDivider, active && styles.segmentActive]}
          >
            {/* One line, always. Four tabs across a 390px phone leaves about
                86px each, and a label that does not fit must shorten rather
                than wrap the control to two rows or run out of it. */}
            {o.icon ? <Icon name={o.icon} size={13} color={active ? colors.selectedFg : colors.ink} /> : null}
            <Text numberOfLines={1} style={[styles.segmentText, active && styles.segmentTextActive]}>{o.label}</Text>
          </Press>
        );
      })}
    </View>
  );
}

/**
 * A number you type (owner, 4 Sep 2026: "I never want to see a plus/minus sign
 * on a number… just click into the box and type your number instead of clicking
 * plus 24 times"). The label is on the left, the box is small and on the right,
 * and a `format` turns the number into words beside it — you type 90, it says
 * 1h 30m. Out-of-range typing is clamped when the field is left, never as it
 * is typed, so a 9 on the way to 90 is not fought with.
 */
export function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max = 9,
  format,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  /** Ignored: kept so callers that used to nudge by a step still compile. */
  step?: number;
  format?: (v: number) => string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = () => {
    const n = Number(String(text).replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(n) || text.trim() === '') { setText(String(value)); return; }
    const next = Math.min(max, Math.max(min, Math.round(n)));
    setText(String(next));
    if (next !== value) onChange(next);
  };
  return (
    <View style={styles.stepper}>
      <Text style={[type.small, { flex: 1 }]}>{label}</Text>
      {format ? <Text style={type.tiny}>{format(value)}</Text> : null}
      <TextInput
        value={text}
        onChangeText={setText}
        onBlur={commit}
        onSubmitEditing={commit}
        keyboardType="number-pad"
        returnKeyType="done"
        selectTextOnFocus
        accessibilityLabel={label}
        style={styles.numberBox}
      />
    </View>
  );
}

export function StatusLine({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'warn' | 'good' }) {
  const color = tone === 'warn' ? colors.overrun : tone === 'good' ? colors.like : colors.inkMuted;
  return <Text style={[type.small, { color }]}>{children}</Text>;
}

/**
 * How much of an allowance has gone. Colour is meaning (theme): calm until
 * 70%, amber to 90%, then the overrun red — the same scale a day's time bar uses.
 */
export function Meter({ used, limit, label }: { used: number; limit: number; label?: string }) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;
  const fill = ratio >= 0.9 ? colors.overrun : ratio >= 0.7 ? colors.dislike : colors.accent;
  return (
    <View style={{ gap: 4 }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: limit, now: Math.min(used, limit) }} accessibilityLabel={label}>
      <View style={styles.meterTrack}><View style={[styles.meterFill, { width: `${Math.round(ratio * 100)}%`, backgroundColor: fill }]} /></View>
      {label ? <Text style={type.tiny}>{label}</Text> : null}
    </View>
  );
}

/**
 * One line that says what a setting is, with everything it could be folded
 * behind it — "Who's coming · The family", "Getting there · Driving". The
 * pattern the Plan screen already uses, so a form is a short list of answers
 * rather than a wall of controls (owner, 4 Sep 2026: "compact it all down").
 */
export function FoldLine({ label, value, children, icon, startOpen = false }: {
  label: string;
  /** What it is set to now, in a few words. */
  value: string;
  /** The controls, shown only once the line is tapped. */
  children: React.ReactNode;
  icon?: IconName;
  startOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(startOpen);
  return (
    <View>
      <Press onPress={() => setOpen((o) => !o)} style={styles.foldLine} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }}>
        {icon ? <Icon name={icon} size={14} color={colors.inkMuted} /> : null}
        <Text style={type.tiny}>{label}</Text>
        <Text style={[type.small, { fontWeight: '600', color: colors.ink, flex: 1 }]} numberOfLines={1}>{value}</Text>
        <Icon name={open ? 'collapse' : 'more'} size={14} color={colors.inkMuted} />
      </Press>
      {open ? <View style={{ marginTop: 4 }}>{children}</View> : null}
    </View>
  );
}

export const Row = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => (
  <View style={[styles.row, style]}>{children}</View>
);

export const Wrap = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => (
  <View style={[styles.wrap, style]}>{children}</View>
);

export const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: BORDER,
    borderColor: colors.line,
    gap: spacing.sm,
  },
  sectionTitle: { marginTop: spacing.lg, marginBottom: spacing.sm, gap: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '100%',
    paddingHorizontal: 12,
    minHeight: 34,
    borderRadius: radius.pill,
    borderWidth: BORDER,
  },
  chipText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600' },
  button: {
    minHeight: TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  buttonText: { fontFamily: fonts.body, fontSize: 15, fontWeight: '700' },
  // A row of choices inside one ink rule, divided by the same rule — the
  // pack's Selection panel. No track, no inset, no radius.
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: BORDER,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  segment: { flex: 1, minWidth: 0, minHeight: 38, paddingHorizontal: 4, flexDirection: 'row', gap: 5, alignItems: 'center', justifyContent: 'center' },
  segmentDivider: { borderLeftWidth: BORDER, borderLeftColor: colors.line },
  // The selected segment is a lime fill with ink type, like a selected chip.
  segmentActive: { backgroundColor: colors.selected },
  segmentText: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkMuted, fontWeight: '600', flexShrink: 1 },
  segmentTextActive: { color: colors.selectedFg },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: TARGET },
  numberBox: {
    width: 72, minHeight: TARGET - 6, borderRadius: radius.md, borderWidth: BORDER, borderColor: colors.line,
    backgroundColor: colors.surface, textAlign: 'center', fontFamily: fonts.body, fontSize: 16, fontWeight: '700', color: colors.ink,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // A groove is a shape, not a rule: an ink one would read as already full.
  meterTrack: { height: 6, borderRadius: radius.pill, backgroundColor: colors.lineSoft, overflow: 'hidden' },
  meterFill: { height: 6, borderRadius: radius.pill },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  foldLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 34, paddingHorizontal: 4 },
});

export const minutes = (m: number) => {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
};

export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
