import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, PressableProps, PressableStateCallbackType, StyleSheet, View, ViewStyle } from 'react-native';
import { colors } from '../theme';
import { at, POP, PressEffect, RING, SINK } from './pressMotion';

export type { PressEffect } from './pressMotion';

/**
 * A `Pressable` that answers the finger.
 *
 * Every button in Epic is one of these (owner, 9 Sep 2026). The default is
 * the *sink*: the control is pushed 2px into the page and shrinks 3% while it
 * is held, and eases back when it is let go. `effect="pop"` is for the one
 * button that adds something to a trip — a squash and a spring that
 * overshoots. `effect="none"` keeps the plain Pressable for things that are
 * tapped but are not buttons (a row that is being dragged).
 *
 * It takes exactly what `Pressable` takes, including a style function and a
 * transform of its own, so swapping one for the other changes nothing but the
 * motion. Someone who has asked their system for less motion gets none.
 */
export const Press = React.forwardRef<View, PressableProps & { effect?: PressEffect; children?: React.ReactNode | ((s: PressableStateCallbackType) => React.ReactNode) }>(function Press(
  { effect = 'sink', style, onPressIn, onPressOut, onHoverIn, onHoverOut, onFocus, onBlur, disabled, ...rest },
  ref,
) {
  const v = useRef(new Animated.Value(0)).current;
  const [pressed, setPressed] = useState(false);
  // The animated Pressable cannot take a style function, so the state a
  // caller's function reads — pressed, and on the web hovered and focused —
  // is tracked here from the same events and handed to it unchanged.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // Read at the moment of the press, not at render: Reduce Motion can be
  // switched on while a row is mounted, and a native answer arrives after it.
  const animate = () => effect !== 'none' && !reducedMotion();

  // When the press began, and a release waiting for the way down to finish.
  const since = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); }, []);

  const down = useCallback((e: any) => {
    setPressed(true);
    onPressIn?.(e);
    if (!animate()) return;
    if (pending.current) { clearTimeout(pending.current); pending.current = null; }
    since.current = Date.now();
    v.stopAnimation();
    Animated.timing(v, { toValue: 1, duration: effect === 'pop' ? POP.downMs : SINK.downMs, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }).start();
  }, [effect, onPressIn, v]);

  const release = useCallback(() => {
    pending.current = null;
    v.stopAnimation();
    if (effect === 'pop') Animated.spring(v, { toValue: 0, ...POP.spring, useNativeDriver: NATIVE }).start();
    else Animated.timing(v, { toValue: 0, duration: SINK.upMs, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }).start();
  }, [effect, v]);

  const up = useCallback((e: any) => {
    setPressed(false);
    onPressOut?.(e);
    // Motion switched off between the press and the release: the driver must
    // not be left where the press put it, or the control stays sunk.
    if (!animate()) { v.stopAnimation(); v.setValue(0); return; }
    // A tap is shorter than the way down. The press plays through to the
    // bottom before it comes back up, so a quick tap is still seen.
    const hold = effect === 'pop' ? POP.holdMs : SINK.holdMs;
    const left = hold - (Date.now() - since.current);
    if (left > 0) pending.current = setTimeout(release, left);
    else release();
  }, [effect, onPressOut, release, v]);

  const resolved = typeof style === 'function' ? style({ pressed, hovered, focused } as PressableStateCallbackType) : style;
  const flat = (StyleSheet.flatten(resolved) ?? {}) as ViewStyle;
  // The transform is always wired; with motion off the driver never leaves 0, so it is the identity.
  const own = effect !== 'none' ? transformFor(effect, v) : [];
  const transform = own.length ? [...((flat.transform as any[]) ?? []), ...own] : flat.transform;

  return (
    <AnimatedPressable
      ref={ref}
      disabled={disabled}
      // react-native-web waits 50ms before it says a press has started, which
      // is half of a tap. The press starts when the finger lands. (The web
      // reads `delayPressIn`, which the native types do not declare.)
      unstable_pressDelay={0}
      {...NO_DELAY}
      onPressIn={down}
      onPressOut={up}
      onHoverIn={(e) => { setHovered(true); onHoverIn?.(e); }}
      onHoverOut={(e) => { setHovered(false); onHoverOut?.(e); }}
      onFocus={(e) => { setFocused(true); onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); onBlur?.(e); }}
      style={transform ? [flat, { transform }] : flat}
      {...rest}
    />
  );
});

const NATIVE = Platform.OS !== 'web';
const NO_DELAY = { delayPressIn: 0 } as unknown as Record<string, never>;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function transformFor(effect: PressEffect, v: Animated.Value) {
  if (effect === 'pop') return [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, POP.scaleDown] }) }];
  if (effect === 'sink') return [{ translateY: v.interpolate(SINK.translateY) }, { scale: v.interpolate(SINK.scale) }];
  return [];
}

/**
 * The ring a heart sends out when it turns on.
 *
 * Sits absolutely in the centre of whatever holds it (the parent must be
 * `position: relative` or a plain View, which it is by default), and plays
 * once each time `pulse` changes to a value above zero. It is a circle
 * because a ring is — the one round thing Epic draws beside a person's face
 * — and it is ink because everything drawn in Epic is, unless it sits on a
 * photograph, where the caller hands it the colour that shows.
 *
 * Only upwards: the caller bumps `pulse` when the heart goes on, never when it
 * comes off, for the reason the shortlist heartbeat has — taking something off
 * a list is not the moment to celebrate.
 */
export function Ring({ pulse, size = 40, color = colors.ink }: { pulse: number; size?: number; color?: string }) {
  const v = useRef(new Animated.Value(1)).current;
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!pulse || reducedMotion()) return;
    v.setValue(0);
    setLive(true);
    const a = Animated.timing(v, { toValue: 1, duration: RING.ms, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE });
    a.start(({ finished }) => { if (finished) setLive(false); });
    return () => a.stop();
  }, [pulse, v]);
  if (!live) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: '50%', top: '50%',
        width: size, height: size,
        marginLeft: -size / 2, marginTop: -size / 2,
        borderRadius: size / 2,
        borderWidth: RING.stroke,
        borderColor: color,
        opacity: v.interpolate(RING.opacity),
        transform: [{ scale: v.interpolate(RING.scale) }],
      }}
    />
  );
}

/**
 * True when the person has asked their system for less motion. One media query
 * for the whole app on the web, read live each time — so a change of setting is
 * honoured without a reload, and three hundred rows do not each build a query
 * per render. On a phone it is the system's Reduce Motion switch, asked once
 * and listened to from then on.
 */
export function reducedMotion(): boolean {
  if (Platform.OS !== 'web') return nativeStill;
  if (query === undefined) {
    query = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
  }
  return query?.matches ?? false;
}
let query: MediaQueryList | null | undefined;
let nativeStill = false;
if (Platform.OS !== 'web') {
  AccessibilityInfo.isReduceMotionEnabled().then((on) => { nativeStill = on; }).catch(() => {});
  AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => { nativeStill = on; });
}

/** For anything that wants the sink's numbers without Animated — a test, a static preview. */
export const sinkAt = (v: number) => ({ translateY: at(SINK.translateY, v), scale: at(SINK.scale, v) });
