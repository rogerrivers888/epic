/**
 * The app's intro screen 1h-1 — the Day out | Trip switch and its list — drawn
 * three ways: W3 chapter 01 on a wide page (`lg`), the same on a phone (`md`,
 * EpicMobile `home`), and inside W4's phone (`sm`, `PhoneScreen1h`).
 *
 * Photos are flat brand-tone blocks and portraits are initials (owner: no stock
 * images). The loop that drives both pages is `useFlipLoop`: it stops while the
 * tab is hidden and after a fixed number of flips (WCAG: motion past five
 * seconds stops after three cycles).
 */
import React, { useEffect, useRef } from 'react';
import { Text, View, type ViewStyle } from 'react-native';
import { CREAM, DEEP_GREEN, HAIRLINE, INK, INK_MUTED, LIME, MOSS, NEUTRAL, fonts } from '../../../theme';
import { useTabVisible } from '../../motion';
import type { PlanRow, PlanWords } from './W3Story.strings';

/** The tones a photo becomes, in the order the brief gives them. */
export const TONES = [MOSS, INK, HAIRLINE, LIME, DEEP_GREEN, NEUTRAL] as const;
const DARK = new Set<string>([MOSS, INK, DEEP_GREEN]);
export const onTone = (tone: string) => (DARK.has(tone) ? CREAM : INK);

/** A photo thumbnail: a flat tone with the design's 8px corner. Decorative. */
export function Thumb({ size, tone }: { size: number; tone: string }) {
  return <View aria-hidden style={{ width: size, height: size, borderRadius: 8, backgroundColor: tone, flexShrink: 0 }} />;
}

/** A portrait: a circle in a tone with the person's initial. Decorative — the name is beside it. */
export function Avatar({ size, tone, name }: { size: number; tone: string; name: string }) {
  return (
    <View aria-hidden style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tone, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Text style={{ fontFamily: fonts.heading, fontWeight: '800', fontSize: Math.round(size * 0.4), color: onTone(tone) }}>{name.charAt(0)}</Text>
    </View>
  );
}

export type PlanSize = 'lg' | 'md' | 'sm';
const SIZE = {
  lg: { sw: 48, swFont: 16, swPad: 14, head: 13, headTop: 0, headBottom: 10, row: 12, gap: 16, time: 56, timeFont: 16, name: 19, meta: 14, nameGap: 3, thumb: 64 },
  md: { sw: 48, swFont: 16, swPad: 14, head: 13, headTop: 0, headBottom: 10, row: 12, gap: 12, time: 46, timeFont: 14, name: 17, meta: 13, nameGap: 2, thumb: 58 },
  sm: { sw: 44, swFont: 15, swPad: 12, head: 12, headTop: 18, headBottom: 9, row: 11, gap: 12, time: 44, timeFont: 13, name: 15, meta: 12, nameGap: 2, thumb: 54 },
} as const;

/**
 * The Day out | Trip switch. The lime indicator is half the width; it moves by
 * translateX(100%) of itself, which the caller animates through `indRef`.
 */
export function ModeSwitch({ size, words, onTrip, indRef, style }: {
  size: PlanSize; words: PlanWords; onTrip: boolean; indRef?: React.Ref<View>; style?: ViewStyle;
}) {
  const s = SIZE[size];
  const cell = { flex: 1, justifyContent: 'center' as const, paddingHorizontal: s.swPad };
  const label = { fontFamily: fonts.body, fontWeight: '700' as const, fontSize: s.swFont, color: INK };
  return (
    <View style={[{ flexDirection: 'row', height: s.sw, borderWidth: 2, borderColor: INK }, style]}>
      <View
        ref={indRef}
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '50%', backgroundColor: LIME, transform: [{ translateX: onTrip ? '100%' : 0 }] }}
      />
      <View style={cell}><Text style={label}>{words.dayOut}</Text></View>
      <View style={[cell, { borderLeftWidth: 2, borderLeftColor: INK }]}><Text style={label}>{words.trip}</Text></View>
    </View>
  );
}

/** A plan's heading and its three timed rows. `toneFrom` offsets the photo tones. */
export function PlanList({ size, head, rows, toneFrom = 0 }: { size: PlanSize; head: string; rows: PlanRow[]; toneFrom?: number }) {
  const s = SIZE[size];
  return (
    <View>
      <Text style={{
        fontFamily: fonts.body, fontWeight: '700', fontSize: s.head, letterSpacing: s.head * 0.06, textTransform: 'uppercase', color: INK,
        paddingTop: s.headTop, paddingBottom: s.headBottom, borderBottomWidth: 2, borderBottomColor: INK,
      }}>{head}</Text>
      {rows.map((r, i) => (
        <View key={r.t + r.name} style={{ flexDirection: 'row', alignItems: 'center', gap: s.gap, paddingVertical: s.row, borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
          <Text style={{ width: s.time, fontFamily: fonts.body, fontWeight: '700', fontSize: s.timeFont, color: INK }}>{r.t}</Text>
          <View style={{ flex: 1, minWidth: 0, gap: s.nameGap }}>
            <Text style={{ fontFamily: fonts.body, fontWeight: '700', fontSize: s.name, color: INK }}>{r.name}</Text>
            <Text style={{ fontFamily: fonts.body, fontSize: s.meta, color: INK_MUTED }}>{r.meta}</Text>
          </View>
          <Thumb size={s.thumb} tone={TONES[(toneFrom + i) % TONES.length]} />
        </View>
      ))}
    </View>
  );
}

/**
 * Runs `onFlip` after `first` ms, then every `every` ms, `max` times in all.
 * Paused while the tab is hidden (the count carries on where it stopped) and
 * never started while `enabled` is false.
 */
export function useFlipLoop({ enabled, first, every, max, onFlip }: {
  enabled: boolean; first: number; every: number; max: number; onFlip: (n: number) => void;
}) {
  const visible = useTabVisible();
  const count = useRef(0);
  const cb = useRef(onFlip);
  cb.current = onFlip;
  useEffect(() => {
    if (!enabled || !visible || count.current >= max) return;
    let iv: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      count.current += 1;
      cb.current(count.current);
      if (count.current >= max && iv) clearInterval(iv);
    };
    const t = setTimeout(() => {
      tick();
      if (count.current < max) iv = setInterval(tick, every);
    }, count.current === 0 ? first : every);
    return () => { clearTimeout(t); if (iv) clearInterval(iv); };
  }, [enabled, visible, first, every, max]);
}

/** Cancels any Web Animations on these nodes, so their inline (final) styles show. */
export function settle(...nodes: unknown[]) {
  for (const n of nodes) {
    const el = n as { getAnimations?: () => { cancel: () => void }[] } | null;
    el?.getAnimations?.().forEach((a) => a.cancel());
  }
}

/**
 * W4's phone screen: progress bars, the lime "One day. Or ten." block, the
 * switch and the list. The list swaps on `onTrip`; the indicator's slide is
 * animated by the caller through `indRef`.
 */
export function PhoneScreen1h({ words, title, sub, onTrip, indRef }: {
  words: PlanWords; title: string; sub: string; onTrip: boolean; indRef?: React.Ref<View>;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: CREAM, paddingTop: 56, paddingHorizontal: 18 }}>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[INK, NEUTRAL, NEUTRAL, NEUTRAL].map((c, i) => <View key={i} style={{ flex: 1, height: 4, backgroundColor: c }} />)}
      </View>
      <View style={{ marginTop: 20, marginHorizontal: -18, paddingTop: 24, paddingHorizontal: 18, paddingBottom: 22, backgroundColor: LIME }}>
        <Text style={{ fontFamily: fonts.heading, fontWeight: '800', fontSize: 36, letterSpacing: -36 * 0.035, lineHeight: 36, color: INK }}>{title}</Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 15, marginTop: 10, color: INK }}>{sub}</Text>
      </View>
      <ModeSwitch size="sm" words={words} onTrip={onTrip} indRef={indRef} style={{ marginTop: 22 }} />
      <PlanList
        size="sm"
        head={onTrip ? words.tripHead : words.dayHead}
        rows={onTrip ? words.tripRows : words.dayRows}
        toneFrom={onTrip ? 3 : 0}
      />
    </View>
  );
}
