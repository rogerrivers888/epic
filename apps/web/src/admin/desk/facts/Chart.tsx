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
// An edge label is anchored to the plot's edge rather than centred on its
// column (web: the text's own box is moved, the column keeps its share).
const EDGE_RIGHT = (Platform.OS === 'web' ? { position: 'absolute', right: 0 } : { alignSelf: 'flex-end' }) as object;
const EDGE_LEFT = (Platform.OS === 'web' ? { position: 'absolute', left: 0 } : { alignSelf: 'flex-start' }) as object;
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
  /**
   * What an empty plot says when no point can speak ("Every day has fewer
   * than 10 answers — Building"): a blank chart is never left to look like
   * a flat line of nothing.
   */
  blank?: string;
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
  series, labels, tip, color, lo, hi, fmt = (v) => String(Math.round(v)), height = 96, axisWidth = 24, gap = 6, blank,
}: DeskLineChartProps) {
  const [w, setW] = useState(0);
  const [hov, setHov] = useState<number | null>(null);
  const [tipW, setTipW] = useState(0);
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
  // A point with no neighbour that can speak — one measured month among
  // Building ones — is a dot the size of the hover dot, or it would not show.
  const lone = series.map((v, i) => (v != null && series[i - 1] == null && series[i + 1] == null ? i : -1)).filter((i) => i >= 0);
  const silent = series.every((v) => v == null);
  // Columns narrower than a label ("Today" under one of thirty days): the
  // edge labels are anchored to the plot's edges so they stay inside it.
  const tight = n > 1 && w > 0 && w / n < 44;

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
              {runs.filter((pts) => pts.includes(' ')).map((pts, i) => (
                <Polyline key={i} points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
              ))}
            </Svg>
          ) : null}
          {w ? lone.map((i) => (
            <View key={`dot${i}`} pointerEvents="none" style={{
              position: 'absolute', left: px(i) - 4, top: py(series[i] as number) - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: color,
            }} />
          )) : null}
          {silent && blank ? (
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }}>
              <Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim, textAlign: 'center', backgroundColor: desk.ground, paddingHorizontal: 8 }}>{blank}</Text>
            </View>
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
              {/* Measured unseen first, then placed centred on the point but
                  clamped inside the card: never past the plot's right edge,
                  never further left than the axis (audit, 28 Sep 2026). */}
              <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: 480, alignItems: 'flex-start', opacity: 0 }}>
                <View onLayout={(e: LayoutChangeEvent) => setTipW(Math.ceil(e.nativeEvent.layout.width))} style={{ borderWidth: 1, paddingVertical: 4, paddingHorizontal: 8 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.body, fontSize: 12, fontWeight: '700' }}>{tip(hv)}</Text>
                </View>
              </View>
              {tipW ? (
                <View pointerEvents="none" style={[{
                  position: 'absolute', zIndex: 10, width: tipW + 1,
                  left: Math.max(-(axisWidth + 8), Math.min(w - tipW - 1, px(hv) - tipW / 2)),
                  bottom: height - (hvVal != null ? py(hvVal) : height / 2) + 10,
                  backgroundColor: desk.picked, borderWidth: 1, borderColor: desk.ruleStrong, paddingVertical: 4, paddingHorizontal: 8,
                }, TIP_SHADOW]}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.body, fontSize: 12, fontWeight: '700', color: desk.ink }}>{tip(hv)}</Text>
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      </View>
      {/* The last label ends at the plot's right edge and the first starts at
          its left, so "Today" under a narrow last column stays inside the
          plot instead of hanging past it. */}
      <View style={{ flexDirection: 'row', marginLeft: axisWidth + 8 }}>
        {labels.map((t, i) => (
          <View key={i} style={{ flex: 1, minWidth: 0, alignItems: 'center', overflow: 'visible' }}>
            <Text style={[{
              flexShrink: 0, fontFamily: fonts.body, fontSize: 10.5, color: desk.inkDim,
            }, NOWRAP, tight && i === n - 1 ? EDGE_RIGHT : null, tight && i === 0 ? EDGE_LEFT : null]}>{t}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
