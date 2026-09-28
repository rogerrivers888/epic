/**
 * The desk's line chart, as the handover's prototype draws it (Verification's
 * three cards, Accuracy's trend; README v2 "Verification", "Accuracy").
 *
 * A light y-axis of three values (top, middle, bottom), a dashed rule at the
 * top and the middle, a 1px strong rule along the bottom, one line in one
 * colour, the day or hour labels beneath, and the exact value on hover (a tap
 * on a phone). A point that cannot speak — `null`, a month with too few
 * answers — is not drawn and the line breaks round it; it is never drawn as 0.
 *
 * Exported for any desk screen that needs the same chart (Overview may borrow
 * it): `DeskLineChart` and the scale helpers `countScale` / `percentScale`.
 */

import React, { useState } from 'react';
import { Platform, Pressable, Text, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';

import { desk, fonts } from '../../../theme';

const tabular = { fontVariant: ['tabular-nums' as const] };
const NOWRAP = (Platform.OS === 'web' ? { whiteSpace: 'nowrap' } : {}) as object;
const TIP_SHADOW: ViewStyle = Platform.OS === 'web' ? ({ boxShadow: '0 8px 20px rgba(0,0,0,.45)' } as unknown as ViewStyle) : {};

export type DeskLineChartProps = {
  /** One value per column; `null` is a point that cannot speak. */
  series: (number | null)[];
  /** One label per column; '' leaves the column unlabelled. */
  labels: string[];
  /** The words on hover for column i ("12 confirmed · 3h ago"). */
  tip: (i: number) => string;
  /** The line's colour: lime, or amber when the card is watching something. */
  color: string;
  /** The bottom and top of the scale. */
  lo: number;
  hi: number;
  /** How an axis value is written ("90%"). */
  fmt?: (v: number) => string;
  /** The plot's height: 96 on a card, 150 beside a headline. */
  height?: number;
  /** The axis column's width: 24 for counts, 32 for percentages. */
  axisWidth?: number;
  /** Space between the plot and its labels. */
  gap?: number;
};

/** A count's scale: nought to twice a round step, so the middle rule is a round number. */
export function countScale(series: (number | null)[]): { lo: number; hi: number } {
  const top = Math.max(1, ...series.filter((v): v is number => v != null));
  const step = top <= 4 ? 2 : Math.ceil(top / 2 / 5) * 5;
  return { lo: 0, hi: step * 2 };
}

/** A percentage's scale: from the tens below the lowest point (less two) to 100. */
export function percentScale(series: (number | null)[]): { lo: number; hi: number } {
  const known = series.filter((v): v is number => v != null);
  if (!known.length) return { lo: 80, hi: 100 };
  return { lo: Math.max(0, Math.floor((Math.min(...known) - 2) / 10) * 10), hi: 100 };
}

export function DeskLineChart({
  series, labels, tip, color, lo, hi, fmt = (v) => String(Math.round(v)), height = 96, axisWidth = 24, gap = 6,
}: DeskLineChartProps) {
  const [w, setW] = useState(0);
  const [hov, setHov] = useState<number | null>(null);
  const n = series.length;
  const span = hi - lo || 1;
  const px = (i: number) => ((i + 0.5) / Math.max(1, n)) * w;
  const py = (v: number) => (1 - (v - lo) / span) * height;

  // The line breaks round a point that cannot speak.
  const runs: string[] = [];
  let run: string[] = [];
  series.forEach((v, i) => {
    if (v == null) { if (run.length) runs.push(run.join(' ')); run = []; return; }
    run.push(`${px(i).toFixed(1)},${py(v).toFixed(1)}`);
  });
  if (run.length) runs.push(run.join(' '));

  const hv = hov != null && hov < n ? hov : null;
  const hvVal = hv != null ? series[hv] : null;
  const axis = { fontFamily: fonts.body, fontSize: 10.5, lineHeight: 11, color: desk.inkDim, ...tabular };

  return (
    <View style={{ gap }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ width: axisWidth, height, justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <Text style={axis}>{fmt(hi)}</Text>
          <Text style={axis}>{fmt((hi + lo) / 2)}</Text>
          <Text style={axis}>{fmt(lo)}</Text>
        </View>
        <View
          onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
          style={{ flex: 1, minWidth: 0, height, position: 'relative', borderBottomWidth: 1, borderBottomColor: desk.ruleStrong }}
        >
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, borderTopWidth: 1, borderTopColor: desk.rule, borderStyle: 'dashed' }} />
          <View style={{ position: 'absolute', left: 0, right: 0, top: height / 2, borderTopWidth: 1, borderTopColor: desk.rule, borderStyle: 'dashed' }} />
          {hv != null && w ? (
            <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: (hv / n) * w, width: w / n, backgroundColor: desk.lifted }} />
          ) : null}
          {w ? (
            <Svg width={w} height={height} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }} pointerEvents="none">
              {runs.map((pts, i) => (
                pts.includes(' ')
                  ? <Polyline key={i} points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
                  : <Polyline key={i} points={`${pts} ${pts}`} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" />
              ))}
            </Svg>
          ) : null}
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row' }}>
            {series.map((_, i) => (
              <Pressable
                key={i}
                style={{ flex: 1, height: '100%' }}
                onHoverIn={() => setHov(i)}
                onHoverOut={() => setHov((h) => (h === i ? null : h))}
                onPress={() => setHov((h) => (h === i ? null : i))}
                accessibilityLabel={tip(i)}
              />
            ))}
          </View>
          {hv != null && w ? (
            <>
              {hvVal != null ? (
                <View pointerEvents="none" style={{
                  position: 'absolute', left: px(hv) - 4, top: py(hvVal) - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: color,
                }} />
              ) : null}
              <View pointerEvents="none" style={{
                position: 'absolute', left: px(hv) - 120, width: 240, alignItems: 'center', zIndex: 10,
                bottom: height - (hvVal != null ? py(hvVal) : height / 2) + 10,
              }}>
                <View style={[{ backgroundColor: desk.picked, borderWidth: 1, borderColor: desk.ruleStrong, paddingVertical: 4, paddingHorizontal: 8 }, TIP_SHADOW]}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.body, fontSize: 12, fontWeight: '700', color: desk.ink }}>{tip(hv)}</Text>
                </View>
              </View>
            </>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', marginLeft: axisWidth + 8 }}>
        {labels.map((t, i) => (
          <View key={i} style={{ flex: 1, minWidth: 0, alignItems: 'center', overflow: 'visible' }}>
            <Text style={[{ flexShrink: 0, fontFamily: fonts.body, fontSize: 10.5, color: desk.inkDim }, NOWRAP]}>{t}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
