/**
 * The back office's own components — Parcelvision's reporting grammar, in
 * Epic's tokens.
 *
 * The owner asked for PV's suite mirrored: "revenue reporting, mirror that UI,
 * the stuff that we've come up with there, the side draws, the drill-downs,
 * everything" (4 Sep 2026). PV is Tailwind over the DOM and Epic is React
 * Native Web, so what is mirrored is the *grammar*, not the class names:
 *
 *  - **A stat tile is a label, a figure and a caption**, with tone as a left
 *    rule and never a coloured number. PV's own note on why: colouring the
 *    figure reads as "this number is red" rather than "this measure needs
 *    attention", and at tile size it out-shouts the whole row.
 *  - **A tile row auto-fits.** Never a fixed column count — these rows carry
 *    between two and seven tiles depending on the screen.
 *  - **A caption says what the figure counts.** Without it a tile is a bare
 *    integer whose basis lives in somebody's head.
 *  - **A gap is labelled, not drawn as a zero.** `Withheld` is the component for
 *    "you may not see this", which is a different fact from "there is nothing
 *    here" — and the API says which by returning `withheld` rather than 0.
 *
 * Nothing here reads the window: width comes from `useViewport()`, so every
 * screen works inside the shell's phone frame (CLAUDE.md).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '../components/press';
import { colors, spacing, TARGET, type, BORDER } from '../theme';
import { Icon, IconName } from '../components/Icon';
import { Button as BaseButton, Row, Wrap } from '../components/ui';
import { useViewport } from '../hooks/useViewport';

// ---------------------------------------------------------------------------
// saying numbers
// ---------------------------------------------------------------------------

export const money = (usd: number | null | undefined) =>
  usd == null ? '—' : usd >= 0.01 ? `$${usd.toFixed(2)}` : usd > 0 ? '<$0.01' : '$0.00';

export const pounds = (pence: number | null | undefined) =>
  pence == null ? '—' : `£${(pence / 100).toLocaleString(undefined, { minimumFractionDigits: pence % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

export const count = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());

/**
 * "1 view", "2 views" — said properly.
 *
 * Small, and worth it: a back office that says "1 views" reads as software
 * nobody finished, and it is on every row of every table here.
 */
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "2h 14m", "6m", "48s" — time on site, in the units a person would say. */
export function duration(seconds: number | null | undefined): string {
  if (!seconds) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60 ? `${mins % 60}m` : ''}`.trim();
}

/** "3 days ago", "today" — the same words the Accounts screen uses. */
export function ago(iso?: string | null): string {
  if (!iso) return 'never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 31) return `${days} days ago`;
  const months = Math.round(days / 30.4);
  return months < 24 ? `${months} month${months === 1 ? '' : 's'} ago` : `${Math.round(months / 12)} years ago`;
}

export const day = (iso?: string | null) =>
  (iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export const monthLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString([], { month: 'short', year: '2-digit' });
};

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

/**
 * The band at the top of a screen — the Categories v2 grammar, now every
 * screen's (handoff "Category screens v2", 14 Sep 2026).
 *
 * A small uppercase kicker saying what is being counted, the screen's name at
 * 31px, and the figures that matter set to the right 34px apart. One 2px muted
 * rule under the lot. No box: the rule is the only drawn thing, which is the
 * handoff's first constraint — "no tiles, panels, outlined chips or boxes of
 * any kind. Hairlines."
 *
 * `sub` is kept because a sentence under the name is often the honest thing to
 * say; `stats` is the new part, and is what the kicker is counting.
 */
export function PageHead({ title, sub, kicker, stats, right }: {
  /** Absent where the page already has a heading and this is a band inside it. */
  title?: string;
  sub?: string;
  /** The uppercase line over the name — "465 OF 485 ANSWERED". */
  kicker?: string;
  /** Figures to the right of the name, in the band rather than in tiles. */
  stats?: { label: string; value: React.ReactNode }[];
  right?: React.ReactNode;
}) {
  // 31px wide, 24px on a phone — the handoff draws 390 as its own artboard
  // rather than a squeeze, and its title is the smaller one (BO1m).
  const { width } = useViewport();
  return (
    <View style={styles.band}>
      <View style={{ flexGrow: 1, flexBasis: 240, minWidth: 0, gap: 4 }}>
        {kicker ? <Text style={styles.bandKicker}>{kicker}</Text> : null}
        {title ? <Text style={[styles.bandTitle, width < 900 && styles.bandTitlePhone]}>{title}</Text> : null}
        {sub ? <Text style={type.small}>{sub}</Text> : null}
      </View>
      {stats?.length ? (
        <View style={styles.bandStats}>
          {stats.map((s) => (
            <View key={s.label} style={{ gap: 2 }}>
              <Text style={styles.bandKicker}>{s.label}</Text>
              <Text style={styles.bandValue}>{s.value}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {right}
    </View>
  );
}

export type Tone = 'plain' | 'ok' | 'warn' | 'crit' | 'accent';

// The handoff's colour roles: a plain fact is a *muted* rule, not an ink one —
// at 2px down the left of every figure on a page, ink reads as a frame.
const RULE: Record<Tone, string> = {
  plain: colors.ruleMuted,
  ok: colors.like,
  warn: colors.dislike,
  crit: colors.overrun,
  accent: colors.accent,
};

/**
 * One figure. The tone is the 2px rule down its left edge — never the number's
 * colour, which is PV's rule and the design guide's own device.
 *
 * There is no box around it any more: the v2 handoff draws a fact as a left
 * rule and nothing else, and a row of bordered tiles was exactly the thing the
 * owner called "these big white boxes" (12 Sep 2026). The rule alone still
 * separates one figure from the next, which is all the border was doing.
 */
export function Tile({ label, value, sub, tone = 'plain', onPress }: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
  onPress?: () => void;
}) {
  // `flexBasis` on a tile is meant for the *row* it sits in. Inside a Pressable
  // — a column container — the same property becomes a minimum **height**, so a
  // tile you can tap was 180px tall and, because a wrapped row stretches to its
  // tallest child, it dragged every tile beside it to the same size. The wrapper
  // carries the row's flex; the tile inside it carries none.
  const body = (
    <View accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={label}
          style={[styles.tile, onPress && styles.tileInner, { borderLeftColor: RULE[tone] }]}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
      {sub ? <Text style={type.tiny}>{sub}</Text> : null}
    </View>
  );
  return onPress
    ? <Press onPress={onPress} style={{ flexGrow: 1, flexBasis: 160, minWidth: 140, maxWidth: 420 }}>{body}</Press>
    : body;
}

/** The auto-fitting row. Tiles grow to fill it, so two look right and seven do too. */
export function TileRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.tileRow}>{children}</View>;
}

/**
 * A section of the page: a heading, an optional control on the right, a body.
 *
 * It used to be a bordered card. In the v2 grammar a section is its **heading
 * over one 2px muted rule** — the heading at 17px/800 the way the doors are
 * set, and the body hanging off the page's own left edge rather than being
 * inset by a border. Everything a card was doing, a rule does more quietly.
 */
export function Panel({ title, sub, right, children, padded = true }: {
  title?: string; sub?: string; right?: React.ReactNode; children: React.ReactNode; padded?: boolean;
}) {
  return (
    <View style={styles.panel}>
      {title ? (
        <Row style={{ alignItems: 'flex-end', gap: spacing.sm, paddingBottom: 9, borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.panelTitle}>{title}</Text>
            {sub ? <Text style={type.tiny}>{sub}</Text> : null}
          </View>
          {right}
        </Row>
      ) : null}
      <View style={padded ? { paddingTop: spacing.md, gap: spacing.sm } : undefined}>{children}</View>
    </View>
  );
}

/**
 * "You may not see this."
 *
 * The whole reason the API returns `withheld` instead of zeroes: an empty
 * revenue panel reads as "nobody is paying", which is a different and wrong
 * fact. PV's own revenue screen makes the same distinction on a 403.
 */
export function Withheld({ what, capability }: { what: string; capability: string }) {
  return (
    <View style={styles.withheld}>
      <Icon name="locked" size={15} color={colors.inkMuted} />
      <Text style={[type.small, { flex: 1 }]}>
        {what} is not yours to see. Ask an administrator for <Text style={styles.mono}>{capability}</Text>.
      </Text>
    </View>
  );
}

/**
 * Something the screen has to say — a left rule and the sentence, no fill and
 * no frame. The handoff's own colour roles: a 2px muted rule is a plain fact, a
 * lime one is a consequence, a red one is a refusal.
 */
export function Banner({ tone = 'plain', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <View style={[styles.banner, { borderLeftColor: RULE[tone], borderLeftWidth: tone === 'crit' ? 1 : BORDER }]}>
      <Text style={[type.small, { flex: 1, color: tone === 'crit' ? colors.overrun : colors.inkMuted }]}>{children}</Text>
    </View>
  );
}

/**
 * A small state word: a status, a plan, a role.
 *
 * Not a pill any more, whatever it is still called. The handoff settled this
 * one explicitly — "labels are not pills… pills would be a deliberate reversal
 * of the standing instruction" — so it is weight and, where the state is one
 * worth stopping on, colour. The name stays so twelve screens keep compiling.
 */
export function Pill({ label, tone = 'plain', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const colour = tone === 'plain' ? colors.ink : RULE[tone];
  return (
    <View style={styles.pill}>
      {icon ? <Icon name={icon} size={12} color={colour} /> : null}
      <Text style={[type.tiny, { color: colour, fontWeight: '700' }]}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// the table
// ---------------------------------------------------------------------------

export type Column<T> = {
  key: string;
  head: string;
  /** Flex weight on a wide screen. */
  width?: number;
  align?: 'left' | 'right';
  /** What to draw. */
  cell: (row: T) => React.ReactNode;
  /** What to sort by, when the column can be sorted. */
  sort?: (row: T) => number | string;
  /** Kept off the phone layout, where there is room for three columns and no more. */
  wideOnly?: boolean;
};

/**
 * The sortable table.
 *
 * Sorting is done here rather than by asking the server again: this is an
 * estate of households, not a million rows, and a round trip per column would
 * be slower than the sort itself.
 *
 * On a phone the same rows become stacked cards — one tree, two layouts, so
 * flipping the shell's Web/Mobile toggle keeps whatever was open (CLAUDE.md).
 */
export function DataTable<T extends { id?: string }>({ rows, columns, onRow, empty, initialSort }: {
  rows: T[];
  columns: Column<T>[];
  onRow?: (row: T) => void;
  empty?: React.ReactNode;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
}) {
  const { width } = useViewport();
  const wide = width >= 900;
  const [sort, setSort] = useState(initialSort ?? null);

  const sorted = useMemo(() => {
    const column = columns.find((c) => c.key === sort?.key);
    if (!column?.sort) return rows;
    const dir = sort?.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = column.sort!(a);
      const y = column.sort!(b);
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return String(x).localeCompare(String(y)) * dir;
    });
  }, [rows, columns, sort]);

  const shown = columns.filter((c) => wide || !c.wideOnly);

  if (!rows.length) return <View style={styles.empty}>{empty ?? <Text style={type.small}>Nothing here yet.</Text>}</View>;

  return (
    <View>
      {wide ? (
        <Row style={styles.head}>
          {shown.map((c) => (
            <Press
              key={c.key}
              disabled={!c.sort}
              onPress={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key: c.key, dir: 'desc' }))}
              style={{ flex: c.width ?? 2, minWidth: 0, alignItems: c.align === 'right' ? 'flex-end' : 'flex-start' }}
            >
              <Row style={{ gap: 4 }}>
                <Text style={styles.headText}>{c.head}</Text>
                {sort?.key === c.key ? <Icon name={sort.dir === 'desc' ? 'expand' : 'collapse'} size={12} color={colors.inkMuted} /> : null}
              </Row>
            </Press>
          ))}
        </Row>
      ) : null}

      {sorted.map((row, i) => (
        <Press
          key={row.id ?? i}
          onPress={onRow ? () => onRow(row) : undefined}
          style={({ hovered }: any) => [styles.row, wide ? styles.rowWide : styles.rowNarrow, hovered && onRow ? styles.rowHover : null]}
          accessibilityRole={onRow ? 'button' : undefined}
        >
          {shown.map((c) => (
            // `minWidth: 0` is what lets a long description ellipsize instead of
            // running over the next column: a flex child's default minimum is its
            // content, so without it the text refuses to shrink.
            <View key={c.key} style={wide ? { flex: c.width ?? 2, minWidth: 0, alignItems: c.align === 'right' ? 'flex-end' : 'flex-start' } : undefined}>
              {!wide ? <Text style={styles.cellLabel}>{c.head}</Text> : null}
              {c.cell(row)}
            </View>
          ))}
        </Press>
      ))}
    </View>
  );
}

/** One row of filter chips above a table, PV's own arrangement: filters in one row. */
export function FilterRow({ children }: { children: React.ReactNode }) {
  return <Wrap style={{ marginBottom: spacing.sm }}>{children}</Wrap>;
}

/**
 * One filter. An outlined chip at rest was the thing the owner named — "the
 * buttons with white boxes around them" — so at rest it is the word alone, and
 * chosen it is a flat lime block with ink type. Square, as everything is.
 */
export function FilterChip({ label, on, onPress, count: n }: { label: string; on?: boolean; onPress: () => void; count?: number }) {
  return (
    <Press onPress={onPress} style={[styles.filter, on && styles.filterOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[type.small, { color: on ? colors.selectedFg : colors.inkMuted, fontWeight: on ? '700' : '500' }]}>
        {label}{n != null ? ` ${n}` : ''}
      </Text>
    </Press>
  );
}

/**
 * The window every reporting screen is read through. Days, because that is what
 * the API takes.
 *
 * Drawn as the handoff's segmented control: one 1px muted frame around the set,
 * a hairline between the cells, and the one you are in filled lime.
 */
export function RangePicker({ days, onDays }: { days: number; onDays: (d: number) => void }) {
  const options = [7, 30, 90, 365];
  return (
    <Row style={styles.range}>
      {options.map((d, i) => (
        <Press key={d} onPress={() => onDays(d)} style={[styles.rangeItem, i > 0 && styles.rangeDivider, days === d && styles.rangeItemOn]}>
          <Text style={[type.small, { color: days === d ? colors.selectedFg : colors.inkMuted, fontWeight: days === d ? '700' : '600' }]}>
            {d === 365 ? '1y' : `${d}d`}
          </Text>
        </Press>
      ))}
    </Row>
  );
}

/** A scrollable page with the back office's own padding — the handoff's 28px. */
export function AdminPage({ children }: { children: React.ReactNode }) {
  const { width } = useViewport();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }}
                contentContainerStyle={[styles.page, width < 900 && styles.pagePhone, width >= 1200 && { maxWidth: 1400, alignSelf: 'center', width: '100%' }]}>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // 28px, the handoff's content padding, and a wider gap between the parts of a
  // screen now that nothing is fenced off by a border.
  page: { padding: 28, gap: spacing.xl, paddingBottom: spacing.xxl },
  /** 18px on a phone, the handoff's own 390 artboard. */
  pagePhone: { padding: 18, paddingBottom: spacing.xxl, gap: spacing.lg },

  band: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    gap: spacing.xl, flexWrap: 'wrap',
    borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted, paddingBottom: 18,
  },
  bandKicker: { ...type.tiny, fontSize: 10, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase', color: colors.inkMuted },
  bandTitle: { ...type.title, fontSize: 31, letterSpacing: -1.08, lineHeight: 33 },
  bandTitlePhone: { fontSize: 24, letterSpacing: -0.84, lineHeight: 26 },
  bandStats: { flexDirection: 'row', alignItems: 'flex-end', gap: 34, flexWrap: 'wrap' },
  bandValue: { ...type.small, fontSize: 15, fontWeight: '600', color: colors.ink, fontVariant: ['tabular-nums'] },

  tileRow: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md, columnGap: spacing.xl },
  /** Inside a Pressable the wrapper does the growing, so the tile must not. */
  tileInner: { flexGrow: 0, flexBasis: 'auto', minWidth: 0, maxWidth: undefined, width: '100%' },
  tile: {
    // Grows to fill a row, but never past `maxWidth`: a lone tile on the last
    // row of a wrap would otherwise stretch the full width of the page and read
    // as a banner rather than a figure. (CSS grid's auto-fit does not have this
    // problem; flex-wrap does, and this is the fix that keeps one tree.)
    flexGrow: 1, flexBasis: 160, minWidth: 140, maxWidth: 420,
    borderLeftWidth: BORDER, borderColor: colors.ruleMuted,
    paddingLeft: 13, paddingVertical: 2, gap: 2,
  },
  tileLabel: { ...type.tiny, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.7, fontWeight: '700', color: colors.inkMuted },
  tileValue: { ...type.h2, color: colors.ink, fontVariant: ['tabular-nums'] },

  panel: { gap: 0 },
  panelTitle: { ...type.title, fontSize: 17, fontWeight: '800', letterSpacing: -0.34, lineHeight: 21 },

  withheld: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', borderLeftWidth: BORDER, borderLeftColor: colors.ruleMuted, paddingLeft: 13, paddingVertical: 4 },
  banner: { flexDirection: 'row', gap: spacing.sm, borderLeftWidth: BORDER, borderLeftColor: colors.ruleMuted, paddingLeft: 13, paddingVertical: 4 },

  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },

  // The head is a 2px muted rule — toned down from ink, which the owner found
  // "very bright white" on the Google table (13 Sep 2026).
  head: { gap: spacing.sm, paddingBottom: 9, borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted },
  headText: { ...type.small, fontSize: 12.5, fontWeight: '600', color: colors.inkMuted },
  row: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft, minHeight: TARGET },
  rowWide: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 13 },
  rowNarrow: { gap: 6, paddingVertical: 13 },
  rowHover: { backgroundColor: colors.well },
  cellLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.6, color: colors.inkMuted },
  empty: { paddingVertical: spacing.lg },

  filter: { paddingHorizontal: 10, paddingVertical: 4 },
  filterOn: { backgroundColor: colors.selected },

  range: { borderWidth: 1, borderColor: colors.ruleMuted, alignSelf: 'flex-start' },
  rangeItem: { paddingHorizontal: 14, paddingVertical: 6 },
  rangeDivider: { borderLeftWidth: 1, borderLeftColor: colors.ruleMuted },
  rangeItemOn: { backgroundColor: colors.selected },

  mono: { fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) },
});

// ---------------------------------------------------------------------------
// the plain grammar (owner, 12 Sep 2026: "I hate this design… these big
// white boxes, the buttons with white boxes around them"). A section is an
// uppercase kicker over one ink rule; an action is an underlined word; a
// choice among a few is a flat lime word when chosen; a control is plain text
// with a chevron and opens a panel under itself. Lifted from Categories.tsx.
// ---------------------------------------------------------------------------

export function Section({ title, right, children, style }: { title: string; right?: React.ReactNode; children: React.ReactNode; style?: object }) {
  return (
    <View style={style}>
      <View style={plain.sectionHead}>
        <Text style={plain.kicker}>{title}</Text>
        <View style={{ flex: 1 }} />
        {right}
      </View>
      {children}
    </View>
  );
}

export function TextAction({ label, onPress, disabled, tone = 'ink' }: { label: string; onPress: () => void; disabled?: boolean; tone?: 'ink' | 'muted' }) {
  return (
    <Press onPress={onPress} disabled={disabled} accessibilityRole="button" hitSlop={6} style={{ opacity: disabled ? 0.4 : 1 }}>
      <Text style={[plain.action, tone === 'muted' && { color: colors.inkMuted }]}>{label}</Text>
    </Press>
  );
}

export function Choice({ label, on, onPress }: { label: string; on: boolean; onPress?: () => void }) {
  return (
    <Press onPress={onPress} disabled={!onPress} accessibilityRole="button" accessibilityState={{ selected: on }} style={[plain.choice, on && plain.choiceOn]}>
      <Text style={[type.small, { color: on ? colors.selectedFg : colors.inkMuted, fontWeight: on ? '700' : '500' }]}>{label}</Text>
    </Press>
  );
}

export type DropdownOption = { key: string; label: string; on: boolean; count?: number | string | null; group?: string };

/**
 * A control that opens a panel of choices under itself — the owner's ask for
 * the Sources filters (12 Sep 2026): "just a dropdown with tick boxes for me
 * to be able to tick the one I want. The dropdown should appear below the
 * dropdown box. In light mode, it should appear in white." The control itself
 * is plain text with a chevron, never a box (handover v8; Categories).
 *
 * `multi` draws tick marks and keeps the panel open; a single-choice panel
 * closes on the pick. The panel is the surface colour over a 1px rule with a
 * transparent scrim behind it.
 */

/**
 * Close on a click anywhere outside the control — a document listener, on
 * top of the scrim, because a fixed scrim inside a transformed ancestor (the
 * phone frame) or an odd browser can miss the click (owner, 12 Sep 2026: "if
 * I click anywhere on the screen, I can't remove the dropdown").
 */
function useCloseOutside(open: boolean, ref: React.RefObject<any>, close: () => void) {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const onDown = (e: Event) => {
      const node = ref.current as any;
      if (node && typeof node.contains === 'function' && node.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, ref, close]);
}

export function Dropdown({ label, value, options, onPick, multi = false, width = 260, quick, soft = false }: {
  label: string;
  value: string;
  options: DropdownOption[];
  onPick: (key: string) => void;
  multi?: boolean;
  width?: number;
  quick?: { key: string; label: string }[];
  /** Lookup's softer panel: a rounded corner and the soft rule. The control is plain text either way. */
  soft?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = React.useRef<any>(null);
  useCloseOutside(open, wrapRef, useCallback(() => setOpen(false), []));
  const groups = useMemo(() => {
    const out: { title: string | null; items: DropdownOption[] }[] = [];
    for (const o of options) {
      const title = o.group ?? null;
      const g = out.find((x) => x.title === title);
      if (g) g.items.push(o); else out.push({ title, items: [o] });
    }
    return out;
  }, [options]);
  return (
    <View ref={wrapRef} style={[dd.wrap, open && dd.wrapOpen]}>
      <Press
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${label}: ${value}`}
        style={dd.ctl}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      >
        <Text style={dd.ctlLabel}>{label}</Text>
        <Text style={dd.ctlValue} numberOfLines={1}>{value}</Text>
        <Icon name={open ? 'collapse' : 'expand'} size={12} color={colors.ink} strokeWidth={2.6} />
      </Press>
      {open ? (
        <>
          <Press style={dd.scrim} onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close" />
          <View style={[dd.panel, soft && dd.panelSoft, { width }]} accessibilityRole="menu">
            {quick?.length ? (
              <Row style={dd.quick}>
                {quick.map((q) => <TextAction key={q.key} label={q.label} onPress={() => onPick(q.key)} />)}
              </Row>
            ) : null}
            <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
              {groups.map((g) => (
                <View key={g.title ?? '_'}>
                  {g.title ? <Text style={dd.group}>{g.title}</Text> : null}
                  {g.items.map((o) => (
                    <Press
                      key={o.key}
                      onPress={() => { onPick(o.key); if (!multi) setOpen(false); }}
                      accessibilityRole={multi ? 'checkbox' : 'menuitem'}
                      accessibilityState={multi ? { checked: o.on } : { selected: o.on }}
                      style={({ hovered }: any) => [dd.item, hovered && dd.itemHover, !multi && o.on && dd.itemOn]}
                    >
                      <View style={{ width: 16, alignItems: 'center' }}>
                        {o.on ? <Icon name="check" size={13} color={colors.ink} strokeWidth={2.8} /> : null}
                      </View>
                      <Text style={[type.small, { color: colors.ink, flex: 1, fontWeight: o.on ? '600' : '400' }]} numberOfLines={1}>{o.label}</Text>
                      {o.count != null && o.count !== '' ? <Text style={type.tiny}>{String(o.count)}</Text> : null}
                    </Press>
                  ))}
                </View>
              ))}
            </ScrollView>
          </View>
        </>
      ) : null}
    </View>
  );
}

/**
 * The same control, two levels deep: the first list is the groups, tapping one
 * shows its items with a way back. The owner, on the Categories screen (12 Sep
 * 2026): "it should show all the categories and then the subcategories. If I
 * click on a subcategory, then I see all the subcategories, and then I should
 * be able to navigate back to the categories. It should take me a level in."
 *
 * `extra` are standalone choices on the first level ("Not a day out"). The
 * panel hangs directly under the control; `align: 'right'` hangs it from the
 * control's right edge for a control at the end of a row.
 */
export function DrillDropdown({ label, value, groups, extra = [], onPick, width = 280, align = 'left', set = false, onOpenChange, startIn = null, adopt = null, nudge = 0, stacked = false }: {
  label: string;
  value: string;
  groups: { key: string; label: string; items: DropdownOption[] }[];
  extra?: DropdownOption[];
  onPick: (key: string) => void;
  width?: number;
  align?: 'left' | 'right';
  /** Set away from its default (a suggestion, a filter): the value reads moss. */
  set?: boolean;
  /**
   * Told when the panel opens or closes. A control inside a list needs this:
   * the rows after it paint later, so the row holding an open panel has to
   * lift itself (a zIndex) or the panel is drawn under them.
   */
  onOpenChange?: (open: boolean) => void;
  /** Open a level in, at this group — a mapped row opens at its own category (owner, 13 Sep 2026). */
  startIn?: string | null;
  /**
   * A row on the first level that starts something new: "Adopt Google's
   * word as a new subcategory". Tapping it shows the groups again, and the
   * group picked is where the new thing goes (owner, 13 Sep 2026: "I would
   * like a new one called water park").
   */
  adopt?: { label: string; onPick: (groupKey: string) => void } | null;
  /** Pixels to hold a right-aligned panel off whatever sits to its right. */
  nudge?: number;
  /**
   * The label above the value as an uppercase kicker, rather than beside it.
   * The kicker names the *kind* of answer and the line beneath is the answer,
   * which is how a word's state reads without a chip (the handoff, 14 Sep 2026).
   */
  stacked?: boolean;
}) {
  const [open, setOpenState] = useState(false);
  const [into, setInto] = useState<string | null>(null);
  const [adopting, setAdopting] = useState(false);
  const group = groups.find((g) => g.key === into) ?? null;
  const setOpen = (v: boolean) => { setOpenState(v); onOpenChange?.(v); };
  const close = () => { setOpen(false); setInto(null); setAdopting(false); };
  const wrapRef = React.useRef<any>(null);
  useCloseOutside(open, wrapRef, useCallback(() => { setOpenState(false); setInto(null); setAdopting(false); onOpenChange?.(false); }, [onOpenChange]));
  const pick = (key: string) => { onPick(key); close(); };
  return (
    <View ref={wrapRef} style={[dd.wrap, open && dd.wrapOpen]}>
      <Press
        onPress={() => { if (open) close(); else { setInto(startIn ?? null); setOpen(true); } }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${label}: ${value}`}
        style={dd.ctl}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      >
        {stacked ? (
          <View style={{ gap: 2, alignItems: align === 'right' ? 'flex-end' : 'flex-start', flexShrink: 1, minWidth: 0 }}>
            <Text style={dd.ctlKicker}>{label}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0 }}>
              <Text style={[dd.ctlValue, set && { color: colors.accent }]} numberOfLines={1}>{value}</Text>
              <Icon name={open ? 'collapse' : 'expand'} size={12} color={set ? colors.accent : colors.ink} strokeWidth={2.6} />
            </View>
          </View>
        ) : (
          <>
            <Text style={dd.ctlLabel}>{label}</Text>
            <Text style={[dd.ctlValue, set && { color: colors.accent }]} numberOfLines={1}>{value}</Text>
            <Icon name={open ? 'collapse' : 'expand'} size={12} color={set ? colors.accent : colors.ink} strokeWidth={2.6} />
          </>
        )}
      </Press>
      {open ? (
        <>
          <Press style={dd.scrim} onPress={close} accessibilityRole="button" accessibilityLabel="Close" />
          <View style={[dd.panel, align === 'right' && dd.panelRight, align === 'right' && nudge ? { right: nudge } : null, { width }]} accessibilityRole="menu">
            <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
              {adopting ? (
                <>
                  <Press onPress={() => setAdopting(false)} accessibilityRole="button" accessibilityLabel="Back"
                         style={({ hovered }: any) => [dd.item, dd.back, hovered && dd.itemHover]}>
                    <Icon name="back" size={14} color={colors.ink} strokeWidth={2.4} />
                    <Text style={[type.small, { color: colors.ink, flex: 1, fontWeight: '700' }]} numberOfLines={2}>New subcategory — under which category?</Text>
                  </Press>
                  {groups.map((g) => (
                    <Press key={g.key} onPress={() => { adopt?.onPick(g.key); close(); }} accessibilityRole="menuitem"
                           style={({ hovered }: any) => [dd.item, hovered && dd.itemHover]}>
                      <View style={{ width: 16 }} />
                      <Text style={[type.small, { color: colors.ink, flex: 1 }]} numberOfLines={1}>{g.label}</Text>
                      <Text style={type.tiny}>{g.items.length}</Text>
                    </Press>
                  ))}
                </>
              ) : group ? (
                <>
                  <Press onPress={() => setInto(null)} accessibilityRole="button" accessibilityLabel="Back to the categories"
                         style={({ hovered }: any) => [dd.item, dd.back, hovered && dd.itemHover]}>
                    <Icon name="back" size={14} color={colors.ink} strokeWidth={2.4} />
                    <Text style={[type.small, { color: colors.ink, flex: 1, fontWeight: '700' }]} numberOfLines={1}>{group.label}</Text>
                    <Text style={type.tiny}>all categories</Text>
                  </Press>
                  {group.items.map((o) => (
                    <Press key={o.key} onPress={() => pick(o.key)} accessibilityRole="menuitem" accessibilityState={{ selected: o.on }}
                           style={({ hovered }: any) => [dd.item, hovered && dd.itemHover, o.on && dd.itemOn]}>
                      <View style={{ width: 16, alignItems: 'center' }}>{o.on ? <Icon name="check" size={13} color={colors.ink} strokeWidth={2.8} /> : null}</View>
                      <Text style={[type.small, { color: colors.ink, flex: 1, fontWeight: o.on ? '600' : '400' }]} numberOfLines={1}>{o.label}</Text>
                      {o.count != null && o.count !== '' ? <Text style={type.tiny}>{String(o.count)}</Text> : null}
                    </Press>
                  ))}
                  {/* Inside a category, adopting puts the new subcategory right here. */}
                  {adopt ? (
                    <>
                      <View style={dd.rule} />
                      <Press onPress={() => { adopt.onPick(group.key); close(); }} accessibilityRole="menuitem"
                             style={({ hovered }: any) => [dd.item, hovered && dd.itemHover]}>
                        <View style={{ width: 16, alignItems: 'center' }}><Icon name="add" size={13} color={colors.ink} strokeWidth={2.6} /></View>
                        <Text style={[type.small, { color: colors.ink, flex: 1 }]} numberOfLines={2}>{adopt.label} under {group.label}</Text>
                      </Press>
                      {/* …or somewhere else: the owner opened on the suggested category and
                          took the one row he saw for the only choice (13 Sep 2026). */}
                      <Press onPress={() => setAdopting(true)} accessibilityRole="menuitem"
                             style={({ hovered }: any) => [dd.item, hovered && dd.itemHover]}>
                        <View style={{ width: 16, alignItems: 'center' }}><Icon name="add" size={13} color={colors.ink} strokeWidth={2.6} /></View>
                        <Text style={[type.small, { color: colors.ink, flex: 1 }]} numberOfLines={2}>{adopt.label} under another category</Text>
                        <Icon name="more" size={14} color={colors.inkMuted} />
                      </Press>
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  {extra.map((o) => (
                    <Press key={o.key} onPress={() => pick(o.key)} accessibilityRole="menuitem" accessibilityState={{ selected: o.on }}
                           style={({ hovered }: any) => [dd.item, hovered && dd.itemHover, o.on && dd.itemOn]}>
                      <View style={{ width: 16, alignItems: 'center' }}>{o.on ? <Icon name="check" size={13} color={colors.ink} strokeWidth={2.8} /> : null}</View>
                      <Text style={[type.small, { color: colors.ink, flex: 1, fontWeight: o.on ? '600' : '400' }]} numberOfLines={1}>{o.label}</Text>
                    </Press>
                  ))}
                  {adopt ? (
                    <Press onPress={() => setAdopting(true)} accessibilityRole="menuitem"
                           style={({ hovered }: any) => [dd.item, hovered && dd.itemHover]}>
                      <View style={{ width: 16, alignItems: 'center' }}><Icon name="add" size={13} color={colors.ink} strokeWidth={2.6} /></View>
                      <Text style={[type.small, { color: colors.ink, flex: 1 }]} numberOfLines={2}>{adopt.label}</Text>
                      <Icon name="more" size={14} color={colors.inkMuted} />
                    </Press>
                  ) : null}
                  {extra.length || adopt ? <View style={dd.rule} /> : null}
                  {groups.map((g) => {
                    const within = g.items.some((o) => o.on);
                    return (
                      <Press key={g.key} onPress={() => setInto(g.key)} accessibilityRole="menuitem" accessibilityState={{ expanded: false }}
                             style={({ hovered }: any) => [dd.item, hovered && dd.itemHover]}>
                        <View style={{ width: 16, alignItems: 'center' }}>{within ? <Icon name="check" size={13} color={colors.ink} strokeWidth={2.8} /> : null}</View>
                        <Text style={[type.small, { color: colors.ink, flex: 1, fontWeight: within ? '600' : '400' }]} numberOfLines={1}>{g.label}</Text>
                        <Text style={type.tiny}>{g.items.length}</Text>
                        <Icon name="more" size={14} color={colors.inkMuted} />
                      </Press>
                    );
                  })}
                </>
              )}
            </ScrollView>
          </View>
        </>
      ) : null}
    </View>
  );
}

const plain = StyleSheet.create({
  kicker: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '700', color: colors.inkMuted },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: 6, borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted, minHeight: 32 },
  action: { ...type.small, fontWeight: '600', color: colors.ink, textDecorationLine: 'underline' },
  choice: { paddingHorizontal: 8, paddingVertical: 3 },
  choiceOn: { backgroundColor: colors.selected },
});

const dd = StyleSheet.create({
  wrap: { position: 'relative', zIndex: 20 },
  /** Open, it must sit over the controls beside it as well as the table below. */
  wrapOpen: { zIndex: 60 },
  ctl: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 32, flexShrink: 1, minWidth: 0 },
  ctlLabel: { ...type.small, color: colors.inkMuted },
  ctlKicker: { ...type.tiny, fontSize: 10, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase', color: colors.inkMuted },
  ctlValue: { ...type.small, color: colors.ink, fontWeight: '700', maxWidth: 220 },
  scrim: { position: 'fixed' as any, top: 0, left: 0, right: 0, bottom: 0, zIndex: 25 } as any,
  panel: {
    position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 30,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    paddingVertical: 4,
  },
  panelSoft: { borderColor: colors.lineSoft },
  /** Hung from the control's right edge, for a control at the end of a row. */
  // `left: 'auto'`, not undefined: StyleSheet.create drops an undefined value, so
  // the panel kept `left: 0` and ran off the page to the right (owner, 13 Sep 2026).
  panelRight: { left: 'auto' as never, right: 0 },
  back: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft, marginBottom: 4 },
  rule: { height: 1, backgroundColor: colors.lineSoft, marginVertical: 4 },
  quick: { gap: spacing.md, paddingHorizontal: spacing.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft, flexWrap: 'wrap' },
  group: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '700', color: colors.inkMuted, paddingHorizontal: spacing.sm, paddingTop: 8, paddingBottom: 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: 7 },
  itemHover: { backgroundColor: colors.well },
  itemOn: { backgroundColor: colors.well },
});

// ---------------------------------------------------------------------------
// the back office's own button
// ---------------------------------------------------------------------------

/**
 * `Button`, with the back office's secondary.
 *
 * The pack's secondary is a 2px ink outline (§07), which is right in the
 * household app and wrong here: the v2 brief's first constraint is "no tiles,
 * panels, outlined chips or boxes of any kind. Hairlines", and a screen with
 * seven of them on it reads as seven boxes rather than seven actions. The brief
 * names the replacement itself, on Approve: *an outline that fills on hover —
 * a green label on a 1.5px green underline, going to a solid lime block with
 * ink type.* Twenty of them read as a quiet right-hand column; twenty solid
 * buttons do not.
 *
 * Lime is the *fill*, never the label: lime type on cream is 1.25:1 and the
 * pack forbids it outright, so the resting label is `accent` — moss on cream,
 * the lifted green in the dark — which is the palette's own readable green.
 *
 * Every other kind is the shared `Button` untouched, so a primary here is still
 * the one the pack describes: ink on light grounds, lime on dark.
 */
export function Button(props: React.ComponentProps<typeof BaseButton>) {
  if (props.kind !== 'secondary') return <BaseButton {...props} />;
  const { label, onPress, disabled, loading, style, icon, iconFill } = props;
  return (
    <Press
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      style={({ hovered, pressed }: any) => [
        btn.secondary,
        (hovered || pressed) && !disabled && btn.secondaryOn,
        disabled && { opacity: 0.45 },
        style,
      ]}
    >
      {({ hovered, pressed }: any) => {
        const fg = (hovered || pressed) && !disabled ? colors.selectedFg : colors.accent;
        return (
          <Row style={{ gap: 6, alignItems: 'center' }}>
            {icon ? <Icon name={icon} size={15} color={fg} fill={iconFill} /> : null}
            <Text style={[type.small, { fontSize: 13.5, fontWeight: '700', color: fg }]}>{loading ? '…' : label}</Text>
          </Row>
        );
      }}
    </Press>
  );
}

const btn = StyleSheet.create({
  secondary: {
    alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 7,
    borderBottomWidth: 1.5, borderBottomColor: colors.accent,
  },
  /** Hover and press are the same moment: the underline becomes the block. */
  secondaryOn: { backgroundColor: colors.selected, borderBottomColor: colors.selected },
});

/**
 * `Segmented`, with the back office's weight.
 *
 * Structurally the pack's Selection panel and untouched: a row of choices
 * inside one rule, the chosen one a flat lime block with ink type. Only the
 * rule changes — 1px muted rather than 2px ink, which is what the v2 brief
 * draws (`1px solid` at the 2px rule's colour) and what keeps one control from
 * out-shouting a page whose every other line is a hairline.
 */
export function Segmented<T extends string>({ value, options, onChange }: {
  value: T;
  options: { value: T; label: string; icon?: IconName }[];
  onChange: (v: T) => void;
}) {
  return (
    <View style={seg.wrap}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <Press
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[seg.item, i > 0 && seg.divider, on && seg.itemOn]}
          >
            {o.icon ? <Icon name={o.icon} size={13} color={on ? colors.selectedFg : colors.ink} /> : null}
            <Text numberOfLines={1} style={[type.small, { fontSize: 12.5, fontWeight: on ? '700' : '600', color: on ? colors.selectedFg : colors.inkMuted, flexShrink: 1 }]}>
              {o.label}
            </Text>
          </Press>
        );
      })}
    </View>
  );
}

const seg = StyleSheet.create({
  wrap: { flexDirection: 'row', borderWidth: 1, borderColor: colors.ruleMuted, overflow: 'hidden' },
  item: { flex: 1, minWidth: 0, minHeight: 36, paddingHorizontal: 14, flexDirection: 'row', gap: 5, alignItems: 'center', justifyContent: 'center' },
  divider: { borderLeftWidth: 1, borderLeftColor: colors.ruleMuted },
  itemOn: { backgroundColor: colors.selected },
});

/**
 * `Card`, which in the back office is not one.
 *
 * The household app's card is a bordered surface and right to be; the back
 * office's own brief forbids it outright — "no tiles, panels, outlined chips or
 * boxes of any kind. Hairlines." So the block keeps its spacing and its job of
 * separating one thing from the next, and the frame becomes the rule under it.
 * Named `Card` so the screens that were built on one need only change an import.
 */
export function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  return <View style={[card.card, style]}>{children}</View>;
}

/**
 * `Chip`, which in the back office is a word.
 *
 * "Labels are not pills… pills would be a deliberate reversal of the standing
 * instruction" (v2 handoff). A chip that only says something is its text; a
 * chip you choose between is the `Choice` grammar — a flat lime block with ink
 * type when it is the one you are in, and nothing at all when it is not.
 */
export function Chip({ label, onPress, selected, icon, iconFill }: {
  label: string;
  onPress?: () => void;
  selected?: boolean;
  icon?: IconName;
  iconFill?: boolean;
  /** Accepted and ignored: the back office has no chip tones, only words. */
  tone?: string;
  onRemove?: () => void;
}) {
  const fg = selected ? colors.selectedFg : onPress ? colors.inkMuted : colors.ink;
  const body = (
    <Row style={{ gap: 5, alignItems: 'center' }}>
      {icon ? <Icon name={icon} size={13} color={fg} fill={iconFill} /> : null}
      <Text style={[type.small, { color: fg, fontWeight: selected ? '700' : '600', flexShrink: 1 }]} numberOfLines={1}>{label}</Text>
    </Row>
  );
  if (!onPress) return <View style={card.chip}>{body}</View>;
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }}
           style={[card.chip, selected && card.chipOn]}>
      {body}
    </Press>
  );
}

const card = StyleSheet.create({
  card: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.lineSoft, gap: spacing.sm },
  chip: { paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  chipOn: { backgroundColor: colors.selected },
});
