/**
 * The filing desk's own drawing kit.
 *
 * The Places redesign (Claude Design, 20 Sep 2026) is a denser surface than the
 * rest of the back office: a table wants a hairline between rows, a heavier
 * rule under a header, kickers at 10px over 12.5px cells, and no boxes at all.
 * The handoff is explicit about it — "Nothing is boxed. Sections are a kicker
 * over a rule; rows sit on hairlines; the only filled elements are the selected
 * row, the primary button and the lime pill."
 *
 * These are here rather than in `kit.tsx` because `kit.tsx` draws the rest of
 * the back office on the app's own light-or-dark ladder, and this section is
 * pinned dark on `desk` (theme.ts). Sharing the file would mean every component
 * taking a "which surface am I on" prop, which is how two tables come to be
 * drawn on two different greys.
 *
 * Every colour comes from `theme.ts`. There is no hex in this file and none in
 * any screen that uses it.
 */

import React from 'react';
import { Text, View } from 'react-native';

import { Icon } from '../../components/Icon';
import { Press } from '../../components/press';
import { useViewport } from '../../hooks/useViewport';
import { LIME, ON_LIME, desk, fonts } from '../../theme';

/** The one red on this surface: danger, never decoration. */
export const WARN = desk.warn;

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

/**
 * A section's name: 10px, 700, wide-tracked, muted, upper case.
 *
 * It is a kicker and not a heading because the thing underneath it is a rule
 * and a table, and a heading over a table reads as a title for the page.
 */
export function Kicker({ children, tone = 'dim' }: { children: React.ReactNode; tone?: 'dim' | 'lime' | 'warn' }) {
  return (
    <Text style={{
      fontFamily: fonts.heading,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.7,
      textTransform: 'uppercase',
      color: tone === 'lime' ? LIME : tone === 'warn' ? WARN : desk.inkDim,
    }}>
      {children}
    </Text>
  );
}

/** The page's own name. 31px/800 at −0.035em, which is −1.085px at that size. */
export function Title({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{
      fontFamily: fonts.heading,
      fontSize: 31,
      fontWeight: '800',
      letterSpacing: -1.085,
      lineHeight: 32,
      color: desk.ink,
    }}>
      {children}
    </Text>
  );
}

/**
 * A number that sits in a column with other numbers.
 *
 * Tabular figures throughout (handoff, "Numbers: always font-variant-numeric:
 * tabular-nums"), because a column of counts that jitters as the digits change
 * is unreadable at this density.
 */
export const tabular = { fontVariant: ['tabular-nums' as const] };

// ---------------------------------------------------------------------------
// The page frame
// ---------------------------------------------------------------------------

/**
 * The band across the top of every screen: a title, and the facts about it.
 *
 * Right-aligned stats are a kicker over a value, never a tile — a tile would be
 * a box, and this surface has none.
 */
export function Band({ title, sub, stats, right }: {
  title: React.ReactNode;
  sub?: string | null;
  stats?: { label: string; value: React.ReactNode; strong?: boolean }[];
  right?: React.ReactNode;
}) {
  // On a phone the facts go under the title rather than beside it: a 31px
  // title and a row of stats do not share 390px, and a title that cannot
  // wrap is a title cut off (owner, 25 Sep 2026). One tree either way.
  const narrow = useViewport().width < 900;
  return (
    <View style={{
      flexDirection: narrow ? 'column' : 'row',
      alignItems: narrow ? 'stretch' : 'flex-end',
      justifyContent: 'space-between',
      gap: narrow ? 12 : 24,
      borderBottomWidth: 2,
      borderBottomColor: desk.ruleStrong,
      paddingBottom: 18,
    }}>
      <View style={{ gap: 6, flexShrink: 1, minWidth: 0 }}>
        <Title>{title}</Title>
        {sub ? <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: desk.inkDim }}>{sub}</Text> : null}
      </View>
      <View style={{
        flexDirection: 'row', flexWrap: narrow ? 'wrap' : 'nowrap', alignItems: 'flex-end',
        gap: narrow ? 18 : 30, flexShrink: narrow ? 1 : 0,
      }}>
        {(stats ?? []).map((s) => (
          <View key={s.label} style={{ gap: 2 }}>
            <Kicker>{s.label}</Kicker>
            <Text style={{
              fontFamily: fonts.body,
              fontSize: 15,
              fontWeight: s.strong ? '800' : '600',
              color: desk.ink,
              ...tabular,
            }}>
              {s.value}
            </Text>
          </View>
        ))}
        {right}
      </View>
    </View>
  );
}

/**
 * A kicker over a hairline, with anything you like on the right of it.
 *
 * The handoff's section rule: the kicker names the section and a rule carries
 * it across, so a section costs one line rather than a panel.
 */
export function DeskSection({ kicker, right, children, gap = 11 }: {
  kicker: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  gap?: number;
}) {
  return (
    <View style={{ gap }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Kicker>{kicker}</Kicker>
        <View style={{ flex: 1, height: 1, backgroundColor: desk.rule }} />
        {right}
      </View>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export type Col = {
  /** Fixed width in px, or 'auto' to take the slack. */
  w: number | 'auto';
  label?: string;
  /**
   * The reason, on hover. Where a column needs explaining it explains itself
   * here rather than in a caption under the table — "no prose on screen, no
   * commentary captions" (the handoff's Interactions section).
   */
  title?: string;
  align?: 'left' | 'right';
};

/** A table header: 12.5px/600 muted cells over a 2px rule. */
export function Head({ cols }: { cols: Col[] }) {
  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: 18,
      borderBottomWidth: 2,
      borderBottomColor: desk.ruleStrong,
      paddingHorizontal: 8,
      paddingBottom: 9,
    }}>
      {cols.map((c, i) => (
        <View key={i} style={c.w === 'auto' ? { flex: 1, minWidth: 0 } : { width: c.w, flexGrow: 0, flexShrink: 0 }}>
          {c.label ? (
            <Text
              // @ts-expect-error react-native-web passes `title` through to the
              // DOM node, which is how every other hover reason on this surface
              // is drawn (`Mark`).
              title={c.title}
              style={{
                fontFamily: fonts.body,
                fontSize: 12.5,
                fontWeight: '600',
                color: desk.inkDim,
                textAlign: c.align === 'right' ? 'right' : 'left',
                ...(c.title ? { textDecorationLine: 'underline', textDecorationStyle: 'dotted' } : null),
              }}>
              {c.label}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** A table row on a hairline. Pressable where the whole row goes somewhere. */
export function Row({ children, onPress, lifted, align = 'center', padded = true }: {
  children: React.ReactNode;
  onPress?: () => void;
  lifted?: boolean;
  align?: 'center' | 'flex-start';
  padded?: boolean;
}) {
  const body = (
    <View style={{
      flexDirection: 'row',
      alignItems: align,
      gap: 18,
      paddingVertical: padded ? 13 : 0,
      paddingHorizontal: 8,
      borderBottomWidth: 1,
      borderBottomColor: desk.rule,
      backgroundColor: lifted ? desk.lifted : 'transparent',
    }}>
      {children}
    </View>
  );
  if (!onPress) return body;
  return <Press effect="none" onPress={onPress} accessibilityRole="button">{body}</Press>;
}

/** One cell of a row, sized from the same column list the header used. */
export function Cell({ col, children, style }: { col: Col; children?: React.ReactNode; style?: object }) {
  return (
    <View style={[
      col.w === 'auto' ? { flex: 1, minWidth: 0 } : { width: col.w, flexGrow: 0, flexShrink: 0 },
      col.align === 'right' ? { alignItems: 'flex-end' } : null,
      style,
    ]}>
      {children}
    </View>
  );
}

/** A value in a cell: 13.5px, tabular where it is a number. */
export function Value({ children, tone = 'ink', weight = '400', size = 13.5, numeric }: {
  children: React.ReactNode;
  tone?: 'ink' | 'muted' | 'dim' | 'faint' | 'lime' | 'warn';
  weight?: '400' | '500' | '600' | '700' | '800';
  size?: number;
  numeric?: boolean;
}) {
  const color = tone === 'lime' ? LIME
    : tone === 'warn' ? WARN
    : tone === 'muted' ? desk.inkMuted
    : tone === 'dim' ? desk.inkDim
    // Faint is not text you are meant to read — it is a placeholder standing
    // in for text that is not there ("no copy line").
    : tone === 'faint' ? desk.inkFaint
    : desk.ink;
  return (
    <Text style={{ fontFamily: fonts.body, fontSize: size, fontWeight: weight, color, ...(numeric ? tabular : null) }}>
      {children}
    </Text>
  );
}

/**
 * A name that opens something: lime-underlined, never lime-coloured.
 *
 * Lime type on this ground would be the second lime thing on the row, and the
 * handoff keeps lime for "the one filled thing". The underline carries the
 * affordance instead.
 */
export function Link({ children, onPress, weight = '700', size = 13.5 }: {
  children: React.ReactNode;
  onPress?: () => void;
  weight?: '600' | '700' | '800';
  size?: number;
}) {
  return (
    <Press effect="none" onPress={onPress ?? (() => {})} accessibilityRole="link">
      <Text style={{
        fontFamily: fonts.body,
        fontSize: size,
        fontWeight: weight,
        color: desk.ink,
        borderBottomWidth: 1.5,
        borderBottomColor: LIME,
        paddingBottom: 2,
        alignSelf: 'flex-start',
      }}>
        {children}
      </Text>
    </Press>
  );
}

// ---------------------------------------------------------------------------
// Marks, pills and controls
// ---------------------------------------------------------------------------

/**
 * A quiet mark on a row: SETTLED, GATE, CONFIRMED, a flag.
 *
 * Outlined, 9.5px, never filled — "a flag is a suggestion and plenty will be
 * wrong" (Mapping brief §3), so it is never drawn as an error.
 */
export function Mark({ label, tone = 'dim', title }: {
  label: string;
  tone?: 'lime' | 'dim' | 'warn' | 'ink';
  title?: string;
}) {
  const color = tone === 'lime' ? LIME : tone === 'warn' ? WARN : tone === 'ink' ? desk.ink : desk.inkDim;
  const border = tone === 'dim' ? desk.inkFaint : color;
  return (
    <View
      // The reason lives on hover, which on web is the title attribute. It is a
      // suggestion; it does not get a line of its own on the row.
      {...(title ? ({ title } as object) : null)}
      style={{ borderWidth: 1, borderColor: border, paddingVertical: 1, paddingHorizontal: 5 }}
    >
      <Text style={{ fontFamily: fonts.body, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.4, color }}>
        {label}
      </Text>
    </View>
  );
}

/**
 * A pick, as a pill.
 *
 * Three states the handoff names: a subcategory is a solid lime pill with ink
 * text, a label is an outlined lime pill with a tag icon, and a typed term
 * nothing matched is outlined and dashed because it is pending.
 */
export function DeskPill({ name, kind = 'sub', pending, onRemove }: {
  name: string;
  kind?: 'sub' | 'label';
  pending?: boolean;
  onRemove?: () => void;
}) {
  const solid = kind === 'sub' && !pending;
  return (
    <Press effect="none" onPress={onRemove ?? (() => {})} accessibilityRole="button">
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: solid ? LIME : 'transparent',
        borderWidth: 1.5,
        borderColor: LIME,
        borderStyle: pending ? 'dashed' : 'solid',
        paddingVertical: 5,
        paddingHorizontal: 11,
      }}>
        {kind === 'label' ? <Icon name="keep" size={12} color={LIME} /> : null}
        <Text style={{ fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: solid ? ON_LIME : LIME }}>
          {name}
        </Text>
        {onRemove ? (
          <View style={{ opacity: 0.55 }}>
            <Icon name="close" size={12} color={solid ? ON_LIME : LIME} />
          </View>
        ) : null}
      </View>
    </Press>
  );
}

/**
 * The primary action: a lime fill with ink on it.
 *
 * Disabled is a dark fill with dim text rather than a faded lime, because a
 * faded brand colour still reads as the brand colour.
 */
export function DeskButton({ label, onPress, disabled, tone = 'primary' }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'outline' | 'warn';
}) {
  const off = Boolean(disabled);
  const bg = tone === 'primary' && !off ? LIME : 'transparent';
  const fg = off ? desk.inkDim : tone === 'primary' ? ON_LIME : tone === 'warn' ? WARN : desk.inkMuted;
  return (
    <Press effect={off ? 'none' : 'sink'} onPress={off ? () => {} : onPress} accessibilityRole="button"
      accessibilityState={{ disabled: off }}>
      <View style={{
        backgroundColor: off && tone === 'primary' ? desk.off : bg,
        borderWidth: tone === 'primary' ? 0 : 1.5,
        borderColor: tone === 'warn' ? WARN : desk.ruleStrong,
        paddingVertical: tone === 'primary' ? 11 : 9.5,
        paddingHorizontal: tone === 'primary' ? 18 : 16,
      }}>
        <Text style={{ fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: fg }}>{label}</Text>
      </View>
    </Press>
  );
}

/** An outlined lime action — "Add a category", a likely-type chip. */
export function LimeOutline({ label, onPress, plus }: { label: string; onPress: () => void; plus?: boolean }) {
  return (
    <Press effect="sink" onPress={onPress} accessibilityRole="button">
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        borderWidth: 1.5,
        borderColor: LIME,
        paddingVertical: 9,
        paddingHorizontal: 16,
      }}>
        {plus ? (
          <Text style={{ fontFamily: fonts.body, fontSize: 15, fontWeight: '700', color: LIME, lineHeight: 15 }}>+</Text>
        ) : null}
        <Text style={{ fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: LIME }}>{label}</Text>
      </View>
    </Press>
  );
}

/**
 * A word that does something, underlined when it is the live one.
 *
 * "Accept" on a proposed answer is underlined lime; "set" on one already
 * settled is the same word with no rule under it and no colour, because there
 * is nothing left to press.
 */
export function Act({ label, onPress, tone = 'lime', ruled = true }: {
  label: string;
  onPress?: () => void;
  tone?: 'lime' | 'ink' | 'dim' | 'warn';
  ruled?: boolean;
}) {
  if (!label) return null;
  const color = tone === 'lime' ? LIME : tone === 'warn' ? WARN : tone === 'dim' ? desk.inkDim : desk.ink;
  const body = (
    <Text style={{
      fontFamily: fonts.body,
      fontSize: 12.5,
      fontWeight: tone === 'dim' ? '400' : '700',
      color,
      borderBottomWidth: ruled ? 1.5 : 0,
      borderBottomColor: color,
      paddingBottom: ruled ? 2 : 0,
    }}>
      {label}
    </Text>
  );
  if (!onPress) return body;
  return <Press effect="none" onPress={onPress} accessibilityRole="button">{body}</Press>;
}

// The five-step control the eight graded axes were drawn with lived here.
// It went with them (the axes brief, 25 Sep 2026): a judgement nobody makes
// twice the same way is not a fact a control should offer to set.

/** A tick box on a row: lime when ticked, an outline when not. */
export function TickBox({ on, onPress }: { on: boolean; onPress: () => void }) {
  return (
    <Press effect="none" onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
      <View style={{
        width: 20,
        height: 20,
        borderWidth: 1.5,
        borderColor: on ? LIME : desk.inkFaint,
        backgroundColor: on ? LIME : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {on ? <Icon name="check" size={13} color={ON_LIME} strokeWidth={3.4} /> : null}
      </View>
    </Press>
  );
}

/**
 * The segmented control that sits under the tab row on Labels, Mapping, Rows
 * and Runs. One outlined strip, the live one filled lime.
 */
export function SegStrip<T extends string>({ value, options, onChange }: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (key: T) => void;
}) {
  return (
    <View style={{
      flexDirection: 'row',
      borderWidth: 1,
      borderColor: desk.ruleStrong,
      alignSelf: 'flex-start',
    }}>
      {options.map((o, i) => {
        const on = o.key === value;
        return (
          <Press key={o.key} effect="none" onPress={() => onChange(o.key)} accessibilityRole="tab"
            accessibilityState={{ selected: on }}>
            <View style={{
              paddingVertical: 9,
              paddingHorizontal: 22,
              backgroundColor: on ? LIME : 'transparent',
              borderLeftWidth: i ? 1 : 0,
              borderLeftColor: desk.ruleStrong,
            }}>
              <Text style={{
                fontFamily: fonts.body,
                fontSize: 13,
                fontWeight: on ? '700' : '600',
                color: on ? ON_LIME : desk.inkDim,
              }}>
                {o.label}
              </Text>
            </View>
          </Press>
        );
      })}
    </View>
  );
}

/** Where a list has nothing in it and that is worth saying out loud. */
export function Nothing({ children }: { children: string }) {
  return (
    <View style={{ paddingVertical: 26, paddingHorizontal: 8 }}>
      <Text style={{ fontFamily: fonts.body, fontSize: 13.5, color: desk.inkDim }}>{children}</Text>
    </View>
  );
}

/**
 * A red left-ruled block: a mapping gap, a set with too few questions.
 *
 * Red because it is a problem to fix, and left-ruled rather than boxed because
 * nothing on this surface is boxed.
 */
export function Alarm({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <View style={{ borderLeftWidth: 2, borderLeftColor: WARN, paddingLeft: 14, paddingVertical: 4, gap: 12 }}>
      <Text style={{ fontFamily: fonts.body, fontSize: 13.5, fontWeight: '800', color: WARN }}>{title}</Text>
      {children}
    </View>
  );
}
