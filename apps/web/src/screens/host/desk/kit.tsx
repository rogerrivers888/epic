/**
 * The parts every existing-host screen is built from (hosting v4, E1–E13):
 * the back line and title, kickers, the status chip, ruled rows, the
 * lime/warm-grey tabs, bars and the sheet. Tokens from the README: Archivo,
 * ink on cream, warm grey cells, 1px rules, radius 0 except photos (8) and
 * avatars, kickers 11px/700/0.06em uppercase grey.
 */

import { insetTop } from '../../../insets';
import React from 'react';
import { Image, Modal, ScrollView, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { Press } from '../../../components/press';
import { Icon } from '../../../components/Icon';
import { useViewport } from '../../../hooks/useViewport';
import {
  AMBER, AMBER_DARK, CHIP_GREY, CREAM, DEEP_GREEN, HAIRLINE, INACTIVE, INK, INK_MUTED, LIME, LIME_TINT, SHEET_SCRIM, TARGET, colors, fonts,
} from '../../../theme';
import type { Chip as ChipKind } from './model';

export const H = fonts.heading;
export const B = fonts.body;
export const tx = (size: number, weight: TextStyle['fontWeight'] = '400', color = INK, extra: TextStyle = {}): TextStyle => ({ fontFamily: B, fontSize: size, fontWeight: weight, color, ...extra });
export const hx = (size: number, color = INK, extra: TextStyle = {}): TextStyle => ({ fontFamily: H, fontSize: size, fontWeight: '800', color, letterSpacing: Math.round(size * -0.03 * 100) / 100, lineHeight: Math.round(size * 1.1), ...extra });
export const RED = colors.overrun; // cancel and blocking deadlines only (README tokens)

/** The page: cream, a 390px column on a wide window so it reads as the phone it was drawn for. */
export function Page({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  const { width } = useViewport();
  const wide = width >= 900;
  return (
    // The Host tab draws its own head (routes.ownsHeader), so each page takes the status bar's height itself.
    <View style={{ flex: 1, backgroundColor: CREAM, paddingTop: insetTop(0) }}>
      <ScrollView contentContainerStyle={[{ paddingBottom: 24 }, wide && { width: 560, alignSelf: 'center' }]}>{children}</ScrollView>
      {footer ? <View style={[wide && { width: 560, alignSelf: 'center' }]}>{footer}</View> : null}
    </View>
  );
}

/** "‹ Host" over the title. */
export function Head({ back, onBack, title, right }: { back: string; onBack: () => void; title?: string; right?: React.ReactNode }) {
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: title ? 12 : 8, borderBottomWidth: 1, borderBottomColor: HAIRLINE, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Press onPress={onBack} accessibilityRole="link" accessibilityLabel={`Back to ${back}`} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 32 }}>
          <Icon name="back" size={16} color={INK} />
          <Text style={tx(15, '700')}>{back}</Text>
        </Press>
        {right}
      </View>
      {title ? <Text style={hx(28)} accessibilityRole="header">{title}</Text> : null}
    </View>
  );
}

export const Kicker = ({ children, style, color = INK_MUTED }: { children: React.ReactNode; style?: TextStyle; color?: string }) => (
  <Text style={[tx(11, '700', color, { letterSpacing: 0.66, textTransform: 'uppercase' }), style]}>{children}</Text>
);

/** A section: kicker, an optional link on the right, then its content. */
export function Section({ title, link, children, style }: { title?: string; link?: { label: string; go: () => void } | null; children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[{ paddingHorizontal: 20, paddingTop: 18, gap: 10 }, style]}>
      {title || link ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          {title ? <Kicker>{title}</Kicker> : <View />}
          {link ? <Press onPress={link.go} accessibilityRole="link"><Text style={tx(14, '700', DEEP_GREEN)}>{link.label}</Text></Press> : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

const CHIP_GROUND: Record<ChipKind, string> = {
  on: LIME, waiting: AMBER, request: AMBER, changed: CHIP_GREY, in_review: CHIP_GREY, draft: INACTIVE, finished: INACTIVE, called_off: INACTIVE, cohost: INACTIVE,
};

/** The status chip. "On" carries a tick drawn from the icon set, never a glyph. */
export function StatusChip({ chip, words }: { chip: ChipKind; words: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: CHIP_GROUND[chip], paddingHorizontal: 7, paddingVertical: 3, alignSelf: 'flex-start' }}>
      <Text style={tx(12, '800')}>{words}</Text>
      {chip === 'on' ? <Icon name="check" size={12} color={INK} /> : null}
    </View>
  );
}

export function LaneTag({ words, dark = true }: { words: string; dark?: boolean }) {
  return <View style={{ backgroundColor: dark ? DEEP_GREEN : INACTIVE, paddingHorizontal: 7, paddingVertical: 3, alignSelf: 'flex-start' }}><Text style={tx(12, '800', dark ? CREAM : INK)}>{words}</Text></View>;
}

/** A ruled row that opens something: title, a line under it, a value right, a chevron. */
export function Row({ title, line, right, rightSub, onPress, red, muted, dim, leading }: {
  title: string; line?: string | null; right?: string | null; rightSub?: string | null; onPress?: (() => void) | null; red?: boolean; muted?: boolean; dim?: boolean; leading?: React.ReactNode;
}) {
  const body = (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, borderTopWidth: 1, borderTopColor: HAIRLINE }, dim && { opacity: 0.7 }]}>
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={tx(15.5, '800')}>{title}</Text>
        {line ? <Text style={tx(13, '400', INK_MUTED)}>{line}</Text> : null}
      </View>
      {right != null ? (
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={tx(14, '800', red ? RED : muted ? INK_MUTED : INK)}>{right}</Text>
          {rightSub ? <Text style={tx(12, '400', INK_MUTED)}>{rightSub}</Text> : null}
        </View>
      ) : null}
      {onPress ? <Icon name="more" size={16} color={INK} /> : null}
    </View>
  );
  return onPress ? <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>{body}</Press> : body;
}

/** Tabs: lime selected, warm grey the others, 38px (README E9, E13). */
export function Tabs<K extends string>({ tabs, value, onPick, height = 38 }: { tabs: { key: K; label: string; badge?: number | null }[]; value: K; onPick: (k: K) => void; height?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      {tabs.map((t) => (
        <Press key={t.key} onPress={() => onPick(t.key)} accessibilityRole="tab" accessibilityState={{ selected: value === t.key }}
          style={{ flex: 1, minHeight: Math.max(height, 32), alignItems: 'center', justifyContent: 'center', backgroundColor: value === t.key ? LIME : INACTIVE, paddingHorizontal: 4 }}>
          <Text style={tx(13.5, value === t.key ? '800' : '600')} numberOfLines={1}>{t.label}</Text>
          {t.badge ? <View style={{ position: 'absolute', top: 3, right: 3, minWidth: 16, height: 16, paddingHorizontal: 3, backgroundColor: INK, alignItems: 'center', justifyContent: 'center' }}><Text style={tx(10, '800', CREAM)}>{t.badge}</Text></View> : null}
        </Press>
      ))}
    </View>
  );
}

/** Underlined text tabs (E8: Guests · Waiting list · Money). */
export function TextTabs<K extends string>({ tabs, value, onPick }: { tabs: { key: K; label: string }[]; value: K; onPick: (k: K) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: 18, borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
      {tabs.map((t) => (
        <Press key={t.key} onPress={() => onPick(t.key)} accessibilityRole="tab" accessibilityState={{ selected: value === t.key }}
          style={{ paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: value === t.key ? INK : 'transparent', marginBottom: -1 }}>
          <Text style={tx(15, value === t.key ? '800' : '600', value === t.key ? INK : INK_MUTED)}>{t.label}</Text>
        </Press>
      ))}
    </View>
  );
}

/** A thin bar with an optional tick (the minimum) on it. */
export function Bar({ value, of, tick, ground = HAIRLINE, fill = INK, height = 6 }: { value: number; of: number; tick?: number | null; ground?: string; fill?: string; height?: number }) {
  const pct = of > 0 ? Math.max(0, Math.min(1, value / of)) : 0;
  return (
    <View style={{ height, backgroundColor: ground }}>
      <View style={{ width: `${pct * 100}%`, height, backgroundColor: fill }} />
      {tick != null && of > 0 ? <View style={{ position: 'absolute', left: `${Math.min(1, tick / of) * 100}%`, top: -3, width: 2, height: height + 6, backgroundColor: INK }} /> : null}
    </View>
  );
}

/** Six bars, the chosen one ink and the rest 32% ink (E1 sparkline, E9 chart). */
export function Bars({ values, selected, onPick, height = 44, labels }: { values: number[]; selected: number; onPick?: (i: number) => void; height?: number; labels?: string[] }) {
  const max = Math.max(1, ...values);
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height }}>
        {values.map((v, i) => {
          const bar = <View style={{ height: Math.max(3, (v / max) * height), backgroundColor: INK, opacity: i === selected ? 1 : 0.32 }} />;
          return onPick
            ? <Press key={i} onPress={() => onPick(i)} accessibilityRole="button" accessibilityLabel={labels?.[i] ?? `Bar ${i + 1}`} style={{ flex: 1, justifyContent: 'flex-end', height }}>{bar}</Press>
            : <View key={i} style={{ flex: 1, justifyContent: 'flex-end' }}>{bar}</View>;
        })}
      </View>
      {labels ? <View style={{ flexDirection: 'row', gap: 6 }}>{labels.map((l, i) => <Text key={l} style={[tx(11.5, i === selected ? '800' : '500', i === selected ? INK : INK_MUTED), { flex: 1, textAlign: 'center' }]}>{l}</Text>)}</View> : null}
    </View>
  );
}

/** A warm-grey cell with a kicker and a figure. */
export function Cell({ kicker, value, sub, ground = INACTIVE, flex = 1, valueColor = INK }: { kicker: string; value: string; sub?: string | null; ground?: string; flex?: number; valueColor?: string }) {
  return (
    <View style={{ flex, backgroundColor: ground, paddingVertical: 10, paddingHorizontal: 12, gap: 2 }}>
      <Kicker>{kicker}</Kicker>
      <Text style={hx(20, valueColor)} numberOfLines={1}>{value}</Text>
      {sub ? <Text style={tx(12, '400', INK_MUTED)}>{sub}</Text> : null}
    </View>
  );
}

export function Photo({ uri, height, radius = 8, style }: { uri: string | null; height: number; radius?: number; style?: ViewStyle }) {
  return uri
    ? <Image source={{ uri }} style={[{ height, borderRadius: radius, backgroundColor: INACTIVE }, style as any]} resizeMode="cover" accessibilityIgnoresInvertColors />
    : <View style={[{ height, borderRadius: radius, backgroundColor: LIME_TINT }, style]} />;
}

/** A button: ink, lime, or warm grey; red only for a cancel. */
export function Btn({ label, onPress, kind = 'ink', disabled, icon, style }: { label: string; onPress: () => void; kind?: 'ink' | 'lime' | 'grey' | 'red'; disabled?: boolean; icon?: string; style?: ViewStyle }) {
  const ground = kind === 'ink' ? INK : kind === 'lime' ? LIME : kind === 'red' ? RED : INACTIVE;
  const fg = kind === 'ink' || kind === 'red' ? CREAM : INK;
  return (
    <Press onPress={disabled ? undefined : onPress} accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled) }}
      style={[{ minHeight: TARGET, paddingHorizontal: 14, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: ground, opacity: disabled ? 0.45 : 1 }, style]}>
      {icon ? <Icon name={icon as any} size={16} color={fg} /> : null}
      <Text style={tx(14.5, '800', fg)}>{label}</Text>
    </Press>
  );
}

/** A bottom sheet pinned to the frame (the Web/Mobile toggle), as VenueDrawer does. */
export function DeskSheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const { framed, origin, width, height } = useViewport();
  const frame: ViewStyle = framed ? { position: 'absolute', left: origin?.x ?? 0, top: origin?.y ?? 0, width, height } : { flex: 1 };
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} visible>
      <View style={frame}>
        <Press onPress={onClose} accessibilityLabel="Close" style={[StyleSheet.absoluteFill, { backgroundColor: SHEET_SCRIM }]} />
        <View style={{ marginTop: 'auto', backgroundColor: CREAM, maxHeight: '88%', width: '100%', maxWidth: 560, alignSelf: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
            <Text style={hx(20)} accessibilityRole="header">{title}</Text>
            <Press onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={{ minWidth: TARGET, minHeight: TARGET, alignItems: 'flex-end', justifyContent: 'center' }}><Icon name="close" size={20} color={INK} /></Press>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>{children}</ScrollView>
          {footer ? <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: HAIRLINE, gap: 8 }}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

/** Nothing to show yet, said in one line. */
export const Empty = ({ children }: { children: React.ReactNode }) => <Text style={[tx(14, '400', INK_MUTED), { paddingVertical: 14 }]}>{children}</Text>;

export const Loading = ({ error }: { error?: string | null }) => (
  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: CREAM, padding: 20 }}>
    <Text style={tx(14, '400', INK_MUTED)}>{error ?? 'Loading…'}</Text>
  </View>
);

export const amberText = AMBER_DARK;
