/**
 * The live strip on a host-page card, frame by frame (HostKindCards draws it):
 * the storyboard of the v6 design (unchanged in v3), kind by kind; the
 * On request strip counts rated events, not events (Host v3 RULINGS). Pure, so it can be tested.
 */
import type { HostLandingStrings, KindKey } from './HostLanding.strings';

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (x: number) => 1 - (1 - x) ** 3;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

/** One frame of a strip; the bar, sparkline or progress line is present for the kind that draws it. */
export type StripFrame = {
  chip: number; rise: number; stripOpacity: number; v: number; status: string;
  /** The result chip's colours, by name (HostKindCards maps them to the theme). */
  result: 'lime' | 'tint' | 'cream';
  pct?: number; full?: boolean; money?: string; spark?: { h: number; current: boolean }[]; progress?: string;
};

/** What a strip shows at time `t` (ms) into its loop — the design's storyboard, kind by kind. */
export function stripAt(kind: KindKey, t: number, looped: boolean, w: HostLandingStrings['strip']): StripFrame {
  const chip = easeOut(clamp((t - 700) / 500));
  const v = easeInOut(clamp((t - 1300) / 1300));
  const rise = easeOut(clamp((t - 2700) / 450));
  const stripOpacity = t > 5500 ? 1 - 0.7 * clamp((t - 5500) / 300) : t < 300 && looped ? 0.3 + 0.7 * clamp(t / 300) : 1;
  const base = { chip, rise, stripOpacity, v };
  if (kind === 'one-off') {
    const n = 4 + v;
    return { ...base, status: w.oneOff.status(Math.round(n)), pct: (n / 5) * 100, full: v >= 0.98, result: 'lime' };
  }
  if (kind === 'weekly') {
    const vals = [72, 84, 90, 96, 108, 108 + 18 * v];
    return {
      ...base, status: w.weekly.status(Math.round(6 + v)), money: w.money(108 + 18 * v),
      spark: vals.map((x, i) => ({ h: Math.round((x / 126) * 30), current: i === 5 })), full: v > 0.98,
      result: 'tint',
    };
  }
  if (kind === 'course') {
    return { ...base, status: w.course.status(Math.round(14 + v)), result: 'lime' };
  }
  // Rated events towards the 10% share (RULINGS › Charges: 10 rated events averaging 4.8+).
  const n = 9 + v;
  return { ...base, status: w.onRequest.status, progress: w.onRequest.progress(Math.round(n)), pct: (n / 10) * 100, result: 'cream' };
}
