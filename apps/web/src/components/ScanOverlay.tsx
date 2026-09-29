import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { CREAM, INK, LIME, fonts } from '../theme';

/**
 * The X-ray search (trip redesign 8a, animation B — owner 29 Sep 2026).
 *
 * A bright lime line sweeps down the map; the ground below it is dimmed, places
 * flash lime as the line passes them, and the count ticks up with it. It runs
 * for 4.4s, eased in and out, then holds the result for 1.6s before handing over
 * to the feed — deliberately longer than a loader so it can be read. It draws in
 * screen space over the map area; the detour zone underneath is the real
 * geographic band (MapGL's `shade`). The old magnifying-glass sweep it replaces
 * is gone with the pin-search flow.
 *
 * `act`/`food` are the real band counts once the search returns; while they are
 * still 0 the caption simply counts to 0 and the payoff line lands when they
 * arrive. `onDone` fires once, after the hold.
 */
export function ScanOverlay({ width, height, minutes, act, food, dur = 4400, hold = 1600, onDone }: {
  width: number;
  height: number;
  minutes: number;
  act: number;
  food: number;
  dur?: number;
  hold?: number;
  onDone: () => void;
}) {
  const [t, setT] = useState(0);
  const [done, setDone] = useState(false);
  const raf = useRef<number | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneCb = useRef(onDone);
  doneCb.current = onDone;

  useEffect(() => {
    const t0 = performance.now();
    const step = (now: number) => {
      const el = now - t0;
      if (el >= dur) {
        setT(dur);
        setDone(true);
        holdTimer.current = setTimeout(() => doneCb.current(), hold);
        return;
      }
      setT(el);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      if (holdTimer.current) clearTimeout(holdTimer.current);
    };
  }, [dur, hold]);

  // Places that flash as the line reaches them. Seeded so they hold still across
  // renders, and gathered toward the middle band where the zone sits.
  const spots = useMemo(() => {
    let s = 1337;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    return Array.from({ length: 22 }, () => ({
      x: width * (0.12 + rnd() * 0.76),
      y: height * (0.08 + rnd() * 0.82),
      r: 3.5 + rnd() * 1.5,
    }));
  }, [width, height]);

  const eio = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
  const cl = (x: number) => Math.max(0, Math.min(1, x));

  const sp = cl(t / (dur * 0.8));
  const y = -20 + (height + 40) * eio(sp);
  const la = 1 - cl((t - dur * 0.8) / (dur * 0.1)); // the line and dim fade out at the end
  const passed = spots.filter((s) => s.y < y).length;
  const fr = done ? 1 : spots.length ? passed / spots.length : 0;

  const a = Math.round(act * fr);
  const f = Math.round(food * fr);
  const countLine = done
    ? `${act} things to do and ${food} places to eat nearby`
    : `${a} things to do · ${f} places to eat`;

  // The 15-minute marker, out from the destination zone toward the zone edge.
  // Positioned in the upper-middle where a destination usually fits on the map;
  // it fades in once the sweep is past halfway.
  const markerIn = done ? 1 : cl((t - dur * 0.5) / (dur * 0.22));
  const my = height * 0.44;
  const mx0 = width * 0.36;
  const mx1 = width * 0.64;
  const tagW = 52;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="scanGlow" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={LIME} stopOpacity={0} />
            <Stop offset="1" stopColor={LIME} stopOpacity={0.55} />
          </LinearGradient>
        </Defs>
        {/* The ground below the line, dimmed 7%. */}
        <Rect x={0} y={y} width={width} height={Math.max(0, height - y)} fill={INK} opacity={0.07 * la} />
        {/* Places flashing as the line passes them. */}
        {spots.map((s, i) => {
          const d = y - s.y;
          if (d <= 0 || d >= 60) return null;
          return <Circle key={i} cx={s.x} cy={s.y} r={s.r} fill={LIME} stroke={INK} strokeWidth={1.2} opacity={1 - d / 60} />;
        })}
        {/* The glow above the line, the lime line, and its ink core. */}
        <Rect x={0} y={y - 80} width={width} height={80} fill="url(#scanGlow)" opacity={la} />
        <Rect x={0} y={y - 2} width={width} height={4} fill={LIME} opacity={la} />
        <Rect x={0} y={y - 0.6} width={width} height={1.2} fill={INK} opacity={0.7 * la} />
        {/* The 15-minute marker: an ink line to the edge of the zone with an end
            tick, fading in once the sweep has passed the destination zone. */}
        {markerIn > 0 ? (
          <>
            <Rect x={mx0} y={my - 0.75} width={mx1 - mx0} height={1.5} fill={INK} opacity={markerIn} />
            <Rect x={mx1 - 1.5} y={my - 5} width={1.5} height={10} fill={INK} opacity={markerIn} />
          </>
        ) : null}
      </Svg>

      {/* The marker's tag: "N min" in lime on ink. */}
      {markerIn > 0 ? (
        <View style={[styles.minTag, { top: my - 10, left: mx0 - tagW }, { opacity: markerIn }]}>
          <Text style={styles.minTagText}>{minutes} min</Text>
        </View>
      ) : null}

      {/* The caption card, 16px from the bottom of the map. */}
      <View style={styles.caption}>
        <View style={styles.line1}>
          <Text style={styles.plain}>Finding things within</Text>
          <View style={styles.chip}><Text style={styles.chipText}>{minutes} minutes</Text></View>
          <Text style={styles.plain}>of your trip</Text>
        </View>
        <Text style={styles.count}>{countLine}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  caption: {
    position: 'absolute', left: 16, right: 16, bottom: 16,
    backgroundColor: CREAM, borderRadius: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 11, gap: 3,
    shadowColor: INK, shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  line1: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5 },
  plain: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: INK },
  chip: { backgroundColor: INK, paddingHorizontal: 6, paddingVertical: 2 },
  chipText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '800', color: LIME },
  count: { fontFamily: fonts.heading, fontSize: 17, fontWeight: '800', letterSpacing: -0.34, color: INK },
  minTag: { position: 'absolute', backgroundColor: INK, paddingHorizontal: 6, paddingVertical: 3 },
  minTagText: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', color: LIME },
});
