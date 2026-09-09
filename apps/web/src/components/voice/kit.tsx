/**
 * The voice intake's parts (handoff, 8 Sep 2026 — "Visual language").
 *
 * Every screen in the three flows is made of the same dozen things: a header
 * with a back arrow and a big title, kicker labels, chips that say where a fact
 * came from, the mic in its three states, captions that settle from grey to
 * ink, and one ink block of a button with the label left and an arrow right.
 * They are here once, sized to the boards, so C3, B4, R3 and O5 cannot drift.
 *
 * Nothing here reads the window: `useViewport` where a size matters.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Platform, ScrollView, StyleSheet, Text, TextInput, View, ViewStyle } from 'react-native';
import { Press } from '../press';
import { colors, fonts, spacing, type, ON_LIME } from '../../theme';
import { Icon, IconName } from '../Icon';
import type { ChipSource } from '../../api';

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

/** A whole voice screen: cream ground, 20px gutters, the header on top. */
export function VoiceScreen({ children, footer, scroll = true }: { children: React.ReactNode; footer?: React.ReactNode; scroll?: boolean }) {
  const body = <View style={styles.body}>{children}</View>;
  return (
    <View style={styles.screen}>
      {scroll ? <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">{body}</ScrollView> : <View style={[styles.scroll, { flex: 1 }]}>{body}</View>}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

/** Back arrow, something on the right (a timer, a mic tile, progress), then the title. */
export function VoiceHeader({ onBack, right, title, sub, big = false }: { onBack?: () => void; right?: React.ReactNode; title?: string | null; sub?: string | null; big?: boolean }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        {onBack ? (
          <Press onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" style={styles.backBox} hitSlop={8}>
            <Icon name="back" size={20} color={colors.ink} strokeWidth={2.2} />
          </Press>
        ) : <View />}
        {right ?? null}
      </View>
      {title ? <Text style={[styles.title, big && styles.titleBig]}>{title}</Text> : null}
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
  );
}

/** The 11/600 uppercase label above a group. */
export function Kicker({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'danger' }) {
  return <Text style={[styles.kicker, tone === 'danger' && { color: colors.overrun }]}>{children}</Text>;
}

/** Ink block, cream label left, arrow right. The one primary action on a voice screen. */
export function PrimaryCta({ label, onPress, disabled, busy }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean }) {
  return (
    <Press onPress={onPress} disabled={disabled || busy} accessibilityRole="button" style={[styles.cta, (disabled || busy) && { opacity: 0.5 }]}>
      <Text style={styles.ctaText}>{busy ? 'One moment…' : label}</Text>
      <Icon name="forward" size={18} color={colors.primaryFg} strokeWidth={2.2} />
    </Press>
  );
}

/** A moss link, 14/600, with an optional glyph. */
export function TextLink({ label, onPress, icon, tone = 'moss', style }: { label: string; onPress: () => void; icon?: IconName; tone?: 'moss' | 'grey'; style?: ViewStyle }) {
  const color = tone === 'moss' ? colors.accent : colors.inkMuted;
  return (
    <Press onPress={onPress} accessibilityRole="button" style={[styles.link, style]} hitSlop={6}>
      {icon ? <Icon name={icon} size={16} color={color} strokeWidth={2.2} /> : null}
      <Text style={[styles.linkText, { color }]}>{label}</Text>
    </Press>
  );
}

/** "Type instead" — the keyboard fallback every voice screen carries. */
export const TypeInstead = ({ onPress, label = 'Type instead' }: { onPress: () => void; label?: string }) => (
  <View style={{ alignItems: 'center' }}><TextLink label={label} icon="keyboard" onPress={onPress} /></View>
);

/** n segments, the done ones ink, and "n of N". */
export function Progress({ step, of }: { step: number; of: number }) {
  return (
    <View style={styles.progress}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {Array.from({ length: of }, (_, i) => <View key={i} style={[styles.segment, i < step && { backgroundColor: colors.ink }]} />)}
      </View>
      <Text style={styles.progressText}>{step} of {of}</Text>
    </View>
  );
}

/** The grey block with one example sentence: "Try: …". */
export function Example({ children }: { children: string }) {
  return (
    <View style={styles.example}>
      <Text style={styles.exampleText}><Text style={{ fontWeight: '600', color: colors.ink }}>Try: </Text>“{children}”</Text>
    </View>
  );
}

/** Prompts as "·" bullets under a wizard title. */
export function Bullets({ items }: { items: string[] }) {
  return <View style={{ gap: 6 }}>{items.map((t) => <Text key={t} style={styles.bullet}>· {t}</Text>)}</View>;
}

// ---------------------------------------------------------------------------
// chips
// ---------------------------------------------------------------------------

export type ChipLook = ChipSource | 'avoid' | 'allergy' | 'add';

/**
 * One fact. Lime = said this time; warm grey = from the profile (or a default);
 * dashed = a gap; grey with a line through = an avoid; red border = an allergy.
 */
export function FactChip({ label, icon, look = 'said', onPress, small = false, selected }: {
  label: string; icon?: string | null; look?: ChipLook; onPress?: () => void; small?: boolean; selected?: boolean;
}) {
  const styleFor: Record<ChipLook, ViewStyle> = {
    said: styles.chipSaid, default: styles.chipSaid, profile: styles.chipProfile, gap: styles.chipGap,
    avoid: styles.chipProfile, allergy: styles.chipAllergy, add: styles.chipGap,
  };
  const color = look === 'gap' || look === 'add' ? colors.inkMuted : look === 'allergy' ? colors.overrun : colors.ink;
  const iconName = (icon && icon in ICON_NAMES ? icon : null) as IconName | null;
  const body = (
    <View style={[styles.chip, styleFor[look], small && styles.chipSmall, selected && styles.chipSaid]}>
      {look === 'allergy' ? <Icon name="allergen" size={13} color={colors.overrun} strokeWidth={2.2} /> : iconName ? <Icon name={iconName} size={15} color={color} strokeWidth={2.2} /> : null}
      <Text style={[styles.chipText, small && styles.chipTextSmall, { color }, look === 'avoid' && { textDecorationLine: 'line-through' }]} numberOfLines={2}>{label}</Text>
    </View>
  );
  return onPress ? <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>{body}</Press> : body;
}
// The set of icon names a chip may ask for; anything else is drawn without one.
const ICON_NAMES: Record<string, true> = {
  home: true, address: true, here: true, driving: true, transit: true, walking: true, cycle: true, hours: true, calendar: true,
  household: true, person: true, children: true, restaurant: true, allergen: true, list: true, inspire: true, fun: true, culture: true,
  activity: true, relaxing: true, outdoors: true, sport: true, mic: true,
};

/** A kicker and a wrapping row of chips. */
export function ChipGroup({ title, children, tone }: { title: string; children: React.ReactNode; tone?: 'plain' | 'danger' }) {
  return (
    <View style={{ gap: 8 }}>
      <Kicker tone={tone}>{title}</Kicker>
      <View style={styles.wrap}>{children}</View>
    </View>
  );
}

/** A row of boxes to choose one from (age bands, travel modes, how far). */
export function Boxes<T extends string | number>({ options, value, onChange, icons, grow = false }: {
  options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void; icons?: Partial<Record<string, IconName>>; grow?: boolean;
}) {
  return (
    <View style={[styles.boxes, grow && { alignSelf: 'stretch' }]}>
      {options.map((o) => {
        const on = o.value === value;
        const icon = icons?.[String(o.value)];
        return (
          <Press key={String(o.value)} onPress={() => onChange(o.value)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={[styles.box, grow && { flex: 1 }, on && styles.boxOn]}>
            {icon ? <Icon name={icon} size={18} color={on ? ON_LIME : colors.ink} strokeWidth={2} /> : null}
            <Text style={[styles.boxText, on && { color: ON_LIME }]} numberOfLines={1}>{o.label}</Text>
          </Press>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// the mic
// ---------------------------------------------------------------------------

/**
 * Idle: one lime square. Listening: Pause (big, lime, two thin rings) beside
 * Done (small, ink, lime stop glyph). Paused: Pause becomes Resume in place —
 * grey, a mic glyph, rings off — so un-pausing is the same tap.
 */
export function MicControl({ state, onStart, onPause, onResume, onDone, size = 'big', canPause = true, label = 'Tap and just say it' }: {
  state: 'idle' | 'listening' | 'paused' | 'busy';
  onStart: () => void; onPause?: () => void; onResume?: () => void; onDone: () => void;
  size?: 'big' | 'small'; canPause?: boolean; label?: string | null;
}) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (state !== 'listening') { pulse.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.45, duration: 800, useNativeDriver: false }),
      Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse, state]);

  if (state === 'idle' || state === 'busy') {
    const px = size === 'big' ? 96 : 64;
    return (
      <View style={{ alignItems: 'center', gap: 12 }}>
        {label && size === 'big' ? <Text style={type.small}>{label}</Text> : null}
        <Press onPress={onStart} disabled={state === 'busy'} accessibilityRole="button" accessibilityLabel="Speak"
          style={[styles.micIdle, { width: px, height: px }, state === 'busy' && { opacity: 0.5 }]}>
          <Icon name="mic" size={size === 'big' ? 40 : 28} color={ON_LIME} strokeWidth={2.2} />
        </Press>
      </View>
    );
  }
  const paused = state === 'paused';
  return (
    <View style={styles.micRow}>
      <View style={{ alignItems: 'center', gap: 6 }}>
        <View style={styles.micBigWrap}>
          {!paused ? <Animated.View style={[styles.ring, { inset: -12, borderColor: colors.selected, opacity: pulse }]} /> : null}
          {!paused ? <Animated.View style={[styles.ring, { inset: -24, borderColor: colors.accentSoft, opacity: pulse }]} /> : null}
          <Press
            onPress={paused ? onResume : onPause}
            disabled={!canPause}
            accessibilityRole="button" accessibilityLabel={paused ? 'Resume' : 'Pause'}
            style={[styles.micBig, paused && { backgroundColor: colors.warm }, !canPause && { opacity: 0.4 }]}>
            <Icon name={paused ? 'mic' : 'pause'} size={34} color={ON_LIME} strokeWidth={2.2} />
          </Press>
        </View>
        <Text style={styles.micLabel}>{paused ? 'Resume' : 'Pause'}</Text>
      </View>
      <View style={{ alignItems: 'center', gap: 6 }}>
        <Press onPress={onDone} accessibilityRole="button" accessibilityLabel="Done" style={styles.doneBox}>
          <Icon name="stop" size={22} color={colors.lime} strokeWidth={2.2} />
        </Press>
        <Text style={styles.micLabel}>Done</Text>
      </View>
    </View>
  );
}

/** The 40px lime mic tile in a header ("tap the mic to add more"). */
export function MicTile({ onPress, size = 40, label = 'Speak' }: { onPress: () => void; size?: number; label?: string }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={[styles.micTile, { width: size, height: size }]}>
      <Icon name="mic" size={Math.round(size * 0.45)} color={ON_LIME} strokeWidth={2.2} />
    </Press>
  );
}

/**
 * Live captions at 20px: settled words in ink, the tail still settling in grey,
 * a lime caret. Paused turns everything ink.
 */
export function Captions({ committed, partial, paused = false, placeholder, minHeight = 120 }: {
  committed: string; partial?: string; paused?: boolean; placeholder?: string; minHeight?: number;
}) {
  const empty = !committed && !partial;
  return (
    <View style={{ minHeight }}>
      <Text style={styles.captions}>
        {empty ? <Text style={{ color: colors.ghost }}>{placeholder ?? ''}</Text> : null}
        {committed ? <Text style={{ color: colors.ink }}>{committed}</Text> : null}
        {partial ? <Text style={{ color: paused ? colors.ink : colors.ghost }}>{committed ? ' ' : ''}{partial}</Text> : null}
        {!empty ? <View style={styles.caret} /> : null}
      </Text>
    </View>
  );
}

/** The one field of the typed fallback: a whole sentence, or just a place. */
export function SentenceField({ value, onChange, onSubmit, placeholder, autoFocus = true }: { value: string; onChange: (t: string) => void; onSubmit: () => void; placeholder: string; autoFocus?: boolean }) {
  return (
    <View style={styles.field}>
      <Icon name="search" size={16} color={colors.inkMuted} strokeWidth={2.2} />
      <TextInput
        value={value} onChangeText={onChange} onSubmitEditing={onSubmit} placeholder={placeholder} placeholderTextColor={colors.inkMuted}
        style={styles.fieldInput} autoFocus={autoFocus} returnKeyType="go" accessibilityLabel={placeholder}
      />
    </View>
  );
}

/** A row in a list: glyph, label, and a moss tick when it is the current value. */
export function ListRow({ label, icon, on, onPress, sub, right }: { label: string; icon?: IconName; on?: boolean; onPress: () => void; sub?: string; right?: React.ReactNode }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!on }} style={styles.listRow}>
      {icon ? <Icon name={icon} size={18} color={on ? colors.ink : colors.inkMuted} strokeWidth={2.2} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.listText, on && { fontWeight: '600' }]} numberOfLines={1}>{label}</Text>
        {sub ? <Text style={type.tiny}>{sub}</Text> : null}
      </View>
      {right ?? (on ? <Icon name="check" size={18} color={colors.accent} strokeWidth={2.2} /> : null)}
    </Press>
  );
}

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const styles = StyleSheet.create({
  // These screens own their head (routes.ts `ownsHeader`), so the shell no
  // longer pads the notch for them; the inset is taken here instead (Codex
  // review, 9 Sep 2026), the same variable the shell and the drawers use.
  screen: { flex: 1, backgroundColor: colors.bg, paddingTop: (Platform.OS === 'web' ? 'var(--epic-sat)' : 0) as any },
  scroll: { flexGrow: 1 },
  body: { flex: 1, gap: 20, paddingHorizontal: 20, paddingBottom: 40 },
  footer: { paddingHorizontal: 20, paddingBottom: 24, paddingTop: 8, gap: 12, backgroundColor: colors.bg },
  header: { paddingTop: 16, paddingHorizontal: 20, gap: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 40 },
  backBox: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  title: { fontFamily: fonts.heading, fontSize: 26, fontWeight: '800', letterSpacing: -0.78, lineHeight: 28, color: colors.ink },
  titleBig: { fontSize: 30, letterSpacing: -0.9, lineHeight: 32 },
  sub: { fontSize: 14, lineHeight: 21, color: colors.inkMuted, marginTop: -6 },
  kicker: { fontFamily: fonts.body, fontSize: 11, fontWeight: '600', letterSpacing: 0.88, textTransform: 'uppercase', color: colors.inkMuted },
  cta: { backgroundColor: colors.primary, paddingVertical: 14, paddingHorizontal: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ctaText: { color: colors.primaryFg, fontWeight: '600', fontSize: 15 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  linkText: { fontSize: 14, fontWeight: '600' },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  segment: { width: 18, height: 3, backgroundColor: colors.ruleSoft },
  progressText: { fontSize: 12, fontWeight: '600', color: colors.inkMuted },
  example: { backgroundColor: colors.warm, paddingVertical: 14, paddingHorizontal: 16 },
  exampleText: { fontSize: 14, lineHeight: 21, color: colors.inkMuted },
  bullet: { fontSize: 15, lineHeight: 22, color: colors.inkMuted },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 12, maxWidth: '100%' },
  chipSmall: { paddingVertical: 6, paddingHorizontal: 10 },
  chipSaid: { backgroundColor: colors.selected },
  chipProfile: { backgroundColor: colors.warm },
  chipGap: { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.ghost },
  chipAllergy: { borderWidth: 1, borderColor: colors.overrun },
  chipText: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
  chipTextSmall: { fontSize: 13 },
  boxes: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  box: { paddingVertical: 10, paddingHorizontal: 10, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center', gap: 6, minWidth: 56 },
  boxOn: { backgroundColor: colors.selected },
  boxText: { fontSize: 13, fontWeight: '600', color: colors.inkMuted },
  micIdle: { backgroundColor: colors.selected, alignItems: 'center', justifyContent: 'center' },
  micRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', gap: 14, paddingVertical: 8 },
  micBigWrap: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderWidth: 1 },
  micBig: { width: 84, height: 84, backgroundColor: colors.selected, alignItems: 'center', justifyContent: 'center' },
  doneBox: { width: 56, height: 56, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  micLabel: { fontSize: 12, fontWeight: '600', color: colors.inkMuted },
  micTile: { backgroundColor: colors.selected, alignItems: 'center', justifyContent: 'center' },
  captions: { fontSize: 20, lineHeight: 29, letterSpacing: -0.2 },
  caret: { width: 2, height: 20, backgroundColor: colors.selected, marginLeft: 2, transform: [{ translateY: 3 }] },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.ruleSoft },
  fieldInput: { flex: 1, fontSize: 15, color: colors.ink, padding: 0 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  listText: { fontSize: 15, color: colors.ink, fontWeight: '500' },
});

export const voiceStyles = styles;
export { spacing };
