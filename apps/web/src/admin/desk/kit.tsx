/**
 * The back office's own controls, as the handover of 28 Sep 2026 draws them
 * (`Supporting docs/Back office/Categories & Collections - 280926`, design
 * README v2 and `Epic Labelling prototype.dc.html`).
 *
 * The page frame, type and table rows come from `../filing/desk.tsx`; this
 * file adds what the v2 screens share and the old desk did not have: the (i)
 * tip beside a title, the dropdown, the segmented control, the sortable
 * header, the toast with its Undo, the location filter that Categories and
 * Collections share, and the client for `/api/admin/desk`.
 *
 * Every value here is the prototype's own: sizes, weights, paddings and
 * colours are copied from its inline styles, not approximated. Every colour
 * comes from `theme.ts`.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Text, TextInput, View, type ViewStyle } from 'react-native';

import { Icon } from '../../components/Icon';
import { Press } from '../../components/press';
import { useViewport } from '../../hooks/useViewport';
import { LIME, ON_LIME, desk, fonts } from '../../theme';
import { api } from '../../api';

export const AMBER = desk.amber;
export const RED = desk.warn;
export const tabular = { fontVariant: ['tabular-nums' as const] };
const hover = Platform.OS === 'web';
const SHADOW: ViewStyle = Platform.OS === 'web' ? ({ boxShadow: '0 12px 32px rgba(0,0,0,.5)' } as unknown as ViewStyle) : {};

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

/**
 * `/api/admin/desk`, read and written. Each screen owns the type of what it
 * reads (the shapes are the API's, in `apps/api/src/desk/*.js`); this is only
 * the door, so the screens do not each spell the prefix.
 */
export const deskApi = {
  get: <T,>(path: string, params?: Record<string, string | number | boolean | null | undefined>) =>
    api.deskGet<T>(path, params ?? {}),
  post: <T,>(path: string, body: unknown = {}) => api.deskSend<T>('POST', path, body),
  put: <T,>(path: string, body: unknown = {}) => api.deskSend<T>('PUT', path, body),
};

/** What a failed desk call says, in one sentence, never a provider's words. */
export function saidOf(err: unknown): string {
  const e = err as { status?: number; body?: { error?: string; message?: string } };
  return e?.body?.message ?? e?.body?.error ?? (err instanceof Error ? err.message : 'That did not work.');
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

type ToastState = { text: string; undo?: (() => void) | null } | null;
const ToastCtx = createContext<(text: string, undo?: (() => void) | null) => void>(() => {});

/** Lime, top right, ~4.5s, with Undo when the action can be undone. */
export function useToast() { return useContext(ToastCtx); }

export function ToastProvider({ children, render }: {
  children: React.ReactNode;
  render: (toast: ToastState, clear: () => void) => React.ReactNode;
}) {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string, undo?: (() => void) | null) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ text, undo: undo ?? null });
    timer.current = setTimeout(() => setToast(null), 4500);
  }, []);
  const clear = useCallback(() => setToast(null), []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <ToastCtx.Provider value={show}>
      {render(toast, clear)}
      {children}
    </ToastCtx.Provider>
  );
}

/** The toast as the tab strip draws it: 12px/700 lime, then a white Undo. */
export function ToastLine({ toast, clear }: { toast: ToastState; clear: () => void }) {
  if (!toast) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Text style={{ fontSize: 12, color: LIME, fontWeight: '700', fontFamily: fonts.body }}>{toast.text}</Text>
      {toast.undo ? (
        <Press effect="none" onPress={() => { const u = toast.undo; clear(); u?.(); }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: desk.ink, borderBottomWidth: 1.5, borderBottomColor: desk.ink, fontFamily: fonts.body }}>Undo</Text>
        </Press>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

/** The (i) beside a title: its words on hover (tap on a phone), never a box on the page. */
export function InfoTip({ text, width = 360, size = 17, side = 'left' }: {
  text: string; width?: number; size?: number; side?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ position: 'relative', zIndex: open ? 40 : 1 }}>
      <Press
        effect="none"
        onHoverIn={hover ? () => setOpen(true) : undefined}
        onHoverOut={hover ? () => setOpen(false) : undefined}
        onPress={() => setOpen((o) => !o)}
        accessibilityLabel={text}
      >
        <Icon name="info" size={size} color={desk.inkDim} />
      </Press>
      {open ? (
        <View style={[{
          position: 'absolute', top: size + 8, [side]: -10, width, zIndex: 40,
          backgroundColor: desk.picked, borderWidth: 1, borderColor: desk.ruleStrong,
          paddingVertical: 11, paddingHorizontal: 14,
        }, SHADOW]}>
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '500', lineHeight: 19.4, color: desk.inkMuted }}>{text}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** A page title, 31px/800 at −0.035em, with its (i). */
export function PageTitle({ children, tip, tipWidth }: { children: React.ReactNode; tip?: string; tipWidth?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, zIndex: 20 }}>
      <Text style={{ fontFamily: fonts.heading, fontWeight: '800', fontSize: 31, letterSpacing: -1.085, lineHeight: 32, color: desk.ink }}>{children}</Text>
      {tip ? <InfoTip text={tip} width={tipWidth} /> : null}
    </View>
  );
}

/** A section title inside a page ("By source"): 17px/800, sentence case. */
export function SectionTitle({ children, tip }: { children: React.ReactNode; tip?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, zIndex: 15 }}>
      <Text style={{ fontFamily: fonts.heading, fontWeight: '800', fontSize: 17, letterSpacing: -0.34, color: desk.ink }}>{children}</Text>
      {tip ? <InfoTip text={tip} size={15} /> : null}
    </View>
  );
}

/** A kicker: 10px/700, 0.07em, upper case, muted. */
export function Kicker({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <Text style={{ fontFamily: fonts.heading, fontSize: 10, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase', color: tone ?? desk.inkDim }}>
      {children}
    </Text>
  );
}

/**
 * The header counts beside a title — a kicker over a number, 15px/800,
 * underlined when it is a door ("Subcategories 118 · Places 2,431").
 */
export function HeadCount({ label, n, onPress, on, tone }: {
  label: string; n: React.ReactNode; onPress?: () => void; on?: boolean; tone?: string;
}) {
  const body = (
    <View style={{ alignItems: 'flex-start', gap: 2 }}>
      <Kicker>{label}</Kicker>
      <Text style={[{
        fontFamily: fonts.heading, fontSize: 15, fontWeight: '800', color: tone ?? (on ? LIME : desk.ink),
        borderBottomWidth: onPress ? 1.5 : 0, borderBottomColor: on ? LIME : desk.ruleStrong,
      }, tabular]}>{n}</Text>
    </View>
  );
  return onPress ? <Press effect="none" onPress={onPress}>{body}</Press> : body;
}

/** A line of muted text: the one thing an empty table says. */
export function Muted({ children, size = 13.5, pad = true }: { children: React.ReactNode; size?: number; pad?: boolean }) {
  return <Text style={{ fontFamily: fonts.body, fontSize: size, color: desk.inkDim, paddingVertical: pad ? 22 : 0, paddingHorizontal: pad ? 8 : 0 }}>{children}</Text>;
}

/** An underlined text link: 12.5px/700. */
export function TextLink({ children, onPress, tone = desk.ink, size = 12.5, rule }: {
  children: React.ReactNode; onPress?: () => void; tone?: string; size?: number; rule?: string;
}) {
  return (
    <Press effect="none" onPress={onPress}>
      <Text style={{ fontFamily: fonts.body, fontSize: size, fontWeight: '700', color: tone, borderBottomWidth: 1.5, borderBottomColor: rule ?? tone, paddingBottom: 1 }}>{children}</Text>
    </Press>
  );
}

/** A quiet outlined action ("Change", "Put back"): 12.5px/700 on a 1px rule. */
export function Outline({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Press effect="none" onPress={disabled ? undefined : onPress} disabled={disabled}>
      <Text style={{
        fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: disabled ? desk.inkFaint : desk.inkMuted,
        borderWidth: 1, borderColor: desk.ruleStrong, paddingVertical: 5, paddingHorizontal: 12,
      }}>{label}</Text>
    </Press>
  );
}

/** The primary button: lime, ink letters, square. */
export function Primary({ label, onPress, disabled, danger }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Press effect="none" onPress={disabled ? undefined : onPress} disabled={disabled}>
      <Text style={{
        fontFamily: fonts.body, fontSize: 13, fontWeight: '800',
        color: disabled ? desk.inkFaint : ON_LIME, backgroundColor: disabled ? desk.off : danger ? RED : LIME,
        paddingVertical: 9, paddingHorizontal: 16,
      }}>{label}</Text>
    </Press>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export type Opt<T extends string = string> = { key: T; name: string };

/**
 * The prototype's dropdown: a 1px ruled well with a chevron, a raised list
 * below that closes on selection.
 */
export function Dropdown<T extends string>({ label, options, value, onChange, width = 180, listWidth, maxHeight = 320 }: {
  label: string; options: Opt<T>[]; value: T | null; onChange: (v: T) => void;
  width?: number; listWidth?: number; maxHeight?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ position: 'relative', zIndex: open ? 30 : 1 }}>
      <Press effect="none" onPress={() => setOpen((o) => !o)}>
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          borderWidth: 1, borderColor: desk.ruleStrong, backgroundColor: desk.well, paddingVertical: 9, paddingHorizontal: 12, width,
        }}>
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: desk.ink }}>{label}</Text>
          <Icon name="expand" size={13} color={desk.inkDim} />
        </View>
      </Press>
      {open ? (
        <View style={[{
          position: 'absolute', top: 44, left: 0, width: listWidth ?? Math.max(width, 170), maxHeight, zIndex: 30,
          backgroundColor: desk.picked, borderWidth: 1, borderColor: desk.ruleStrong, paddingVertical: 4,
          overflow: 'scroll' as ViewStyle['overflow'],
        }, SHADOW]}>
          {options.map((o) => (
            <Press key={o.key} effect="none" onPress={() => { setOpen(false); onChange(o.key); }}>
              <Text style={{
                paddingVertical: 8, paddingHorizontal: 12, fontFamily: fonts.body, fontSize: 13,
                fontWeight: o.key === value ? '700' : '500', color: o.key === value ? LIME : desk.inkMuted,
              }}>{o.name}</Text>
            </Press>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** The segmented control: 1px ruled, the chosen segment lime with ink letters. */
export function Seg<T extends string>({ options, value, onChange, pad = 22, size = 13 }: {
  options: Opt<T>[]; value: T; onChange: (v: T) => void; pad?: number; size?: number;
}) {
  return (
    <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: desk.ruleStrong, alignSelf: 'flex-start', flexWrap: 'wrap' }}>
      {options.map((o, i) => {
        const on = o.key === value;
        return (
          <Press key={o.key} effect="none" onPress={() => onChange(o.key)}>
            <Text style={{
              paddingVertical: 9, paddingHorizontal: pad, fontFamily: fonts.body, fontSize: size,
              fontWeight: on ? '700' : '600', backgroundColor: on ? LIME : 'transparent', color: on ? ON_LIME : desk.inkDim,
              borderLeftWidth: i ? 1 : 0, borderLeftColor: desk.ruleStrong,
            }}>{o.name}</Text>
          </Press>
        );
      })}
    </View>
  );
}

/** The search well: a 1px ruled box with a magnifier. */
export function SearchBox({ value, onChange, placeholder = 'Search', width = 240, icon = 'search' }: {
  value: string; onChange: (v: string) => void; placeholder?: string; width?: number; icon?: 'search' | 'pin';
}) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: desk.ruleStrong,
      backgroundColor: desk.well, paddingVertical: 9, paddingHorizontal: 12, width,
    }}>
      <Icon name={icon === 'pin' ? 'outAbout' : 'search'} size={14} color={desk.inkDim} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={desk.inkDim}
        style={[{ flex: 1, minWidth: 0, color: desk.ink, fontFamily: fonts.body, fontSize: 13.5, fontWeight: '600', padding: 0 }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
      />
    </View>
  );
}

/** A tick box, 20px, lime when on. */
export function Tick({ on, onPress, size = 20 }: { on: boolean; onPress: () => void; size?: number }) {
  return (
    <Press effect="none" onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
      <View style={{
        width: size, height: size, borderWidth: on ? 0 : 1.5, borderColor: desk.ruleStrong,
        backgroundColor: on ? LIME : 'transparent', alignItems: 'center', justifyContent: 'center',
      }}>
        {on ? <Icon name="check" size={13} color={ON_LIME} /> : null}
      </View>
    </Press>
  );
}

/** Small option pills in place ("Yes · No"), the chosen one lime-ruled. */
export function Pills<T extends string>({ options, value, onChange }: { options: Opt<T>[]; value: T | null; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Press key={o.key} effect="none" onPress={() => onChange(o.key)}>
            <Text style={{
              fontFamily: fonts.body, fontSize: 12, fontWeight: '700', borderWidth: 1.5,
              borderColor: on ? LIME : desk.ruleStrong, color: on ? LIME : desk.inkMuted, paddingVertical: 3, paddingHorizontal: 8,
            }}>{o.name}</Text>
          </Press>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * A column. The standing rule (README v2): every column the same distance
 * from the next, headers and values left-aligned, compact tables that do not
 * stretch — so a column has a fixed width and the table is `max-content`.
 */
export type TCol<K extends string = string> = {
  key: K; name: string; width: number; tip?: string;
  /** How the first click sorts: text and Places ascend, other numbers descend. */
  first?: 'asc' | 'desc';
  sortable?: boolean;
};

export type SortState<K extends string = string> = { key: K; dir: 'asc' | 'desc' } | null;

/** Click a header to sort; click again to reverse. */
export function nextSort<K extends string>(col: TCol<K>, sort: SortState<K>): SortState<K> {
  if (sort?.key === col.key) return { key: col.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
  return { key: col.key, dir: col.first ?? 'asc' };
}

export function sortRows<T>(rows: T[], sort: SortState, value: (row: T, key: string) => string | number | null | undefined): T[] {
  if (!sort) return rows;
  const d = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = value(a, sort.key); const y = value(b, sort.key);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * d;
    return String(x).localeCompare(String(y)) * d;
  });
}

/** A header row: 12.5px, the sorted column bold with a lime arrow; a 2px strong rule under it. */
export function THead<K extends string>({ cols, sort, onSort, gap = 18, lead, pad = 8 }: {
  cols: TCol<K>[]; sort?: SortState<K>; onSort?: (s: SortState<K>) => void; gap?: number; lead?: React.ReactNode; pad?: number;
}) {
  const [tip, setTip] = useState<string | null>(null);
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap, borderBottomWidth: 2, borderBottomColor: desk.ruleStrong,
      paddingTop: 12, paddingBottom: 9, paddingHorizontal: pad, zIndex: 5, backgroundColor: desk.ground,
    }}>
      {lead}
      {cols.map((c) => {
        const on = sort?.key === c.key;
        const canSort = onSort && c.sortable !== false;
        return (
          <View key={c.key} style={{ width: c.width, position: 'relative', zIndex: tip === c.key ? 30 : 1 }}>
            <Press
              effect="none"
              onPress={canSort ? () => onSort!(nextSort(c, sort ?? null)) : undefined}
              onHoverIn={hover && c.tip ? () => setTip(c.key) : undefined}
              onHoverOut={hover && c.tip ? () => setTip(null) : undefined}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{
                  fontFamily: fonts.body, fontSize: 12.5, fontWeight: on ? '800' : '600', color: on ? desk.ink : desk.inkDim,
                  borderBottomWidth: c.tip ? 1 : 0, borderBottomColor: desk.ruleStrong, borderStyle: 'dotted',
                }}>{c.name}</Text>
                {on ? <Text style={{ fontSize: 11, color: LIME }}>{sort!.dir === 'asc' ? '↑' : '↓'}</Text> : null}
              </View>
            </Press>
            {tip === c.key && c.tip ? (
              <View style={[{
                position: 'absolute', top: 28, left: 0, width: 320, zIndex: 30, backgroundColor: desk.picked,
                borderWidth: 1, borderColor: desk.ruleStrong, paddingVertical: 14, paddingHorizontal: 16, gap: 6,
              }, SHADOW]}>
                <Text style={{ fontFamily: fonts.heading, fontSize: 14, fontWeight: '800', color: desk.ink }}>{c.name}</Text>
                <Text style={{ fontFamily: fonts.body, fontSize: 13, lineHeight: 19.5, color: desk.inkMuted, fontWeight: '500' }}>{c.tip}</Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** A table row on a 1px hairline. */
export function TRow({ children, onPress, gap = 18, lifted, pad = 8, align = 'center' }: {
  children: React.ReactNode; onPress?: () => void; gap?: number; lifted?: boolean; pad?: number; align?: 'center' | 'flex-start';
}) {
  const [over, setOver] = useState(false);
  const body = (
    <View style={{
      flexDirection: 'row', alignItems: align, gap, paddingVertical: 11, paddingHorizontal: pad,
      borderBottomWidth: 1, borderBottomColor: desk.rule, backgroundColor: lifted || (onPress && over) ? desk.lifted : 'transparent',
    }}>{children}</View>
  );
  return onPress ? (
    <Press effect="none" onPress={onPress} onHoverIn={hover ? () => setOver(true) : undefined} onHoverOut={hover ? () => setOver(false) : undefined}>{body}</Press>
  ) : body;
}

/** A cell of a fixed width. */
export function TCell({ width, children, style }: { width: number; children?: React.ReactNode; style?: ViewStyle }) {
  return <View style={[{ width, minWidth: 0 }, style]}>{children}</View>;
}

/** A cell's text: 13.5px, ink unless told. */
export function T({ children, tone = desk.ink, weight = '400', size = 13.5, num, lines }: {
  children: React.ReactNode; tone?: string; weight?: '400' | '500' | '600' | '700' | '800'; size?: number; num?: boolean; lines?: number;
}) {
  return (
    <Text numberOfLines={lines} style={[{ fontFamily: fonts.body, fontSize: size, fontWeight: weight, color: tone }, num ? tabular : null]}>{children}</Text>
  );
}

/** A compact table: `max-content`, empty space on the right, scrolls sideways on a phone. */
export function Table({ children, width }: { children: React.ReactNode; width: number }) {
  const narrow = useViewport().width < 900;
  return (
    <View style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
      {narrow ? (
        <HScroll><View style={{ width }}>{children}</View></HScroll>
      ) : <View style={{ width }}>{children}</View>}
    </View>
  );
}

function HScroll({ children }: { children: React.ReactNode }) {
  // Lazy import keeps this file free of a ScrollView where none is needed.
  const { ScrollView } = require('react-native') as typeof import('react-native');
  return <ScrollView horizontal style={{ flexGrow: 0 }}>{children}</ScrollView>;
}

/** Sum of column widths plus the gaps and padding between them. */
export const tableWidth = (cols: { width: number }[], gap = 18, pad = 8, extra = 0) =>
  cols.reduce((n, c) => n + c.width, 0) + gap * Math.max(0, cols.length - 1) + pad * 2 + extra;

// ---------------------------------------------------------------------------
// Numbers and time
// ---------------------------------------------------------------------------

export const n = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('en-GB'));

/** "4 min ago", "3 weeks ago" — the prototype's words for a moment. */
export function ago(at: string | Date | null | undefined): string {
  if (!at) return '—';
  const s = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} day${d === 1 ? '' : 's'} ago`;
  const w = Math.round(d / 7);
  if (d < 60) return `${w} weeks ago`;
  const mo = Math.round(d / 30);
  return `${mo} months ago`;
}

/** "19 Sep" */
export const dayMonth = (at: string | Date | null | undefined) =>
  at ? new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';

// ---------------------------------------------------------------------------
// The location filter (shared by Categories and Collections)
// ---------------------------------------------------------------------------

export type Mode = 'car' | 'transit';
export type LocState = { where: string; minutes: number; mode: Mode };
export type LocAnswer = {
  known: boolean; label: string | null; chip: string | null; approx?: boolean; capped?: boolean;
};

const LocCtx = createContext<{ loc: LocState; setLoc: (l: LocState) => void; answer: LocAnswer | null; setAnswer: (a: LocAnswer | null) => void }>({
  loc: { where: '', minutes: 30, mode: 'car' }, setLoc: () => {}, answer: null, setAnswer: () => {},
});

/** One piece of state for Categories and Collections (README v2). */
export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [loc, setLoc] = useState<LocState>({ where: '', minutes: 30, mode: 'car' });
  const [answer, setAnswer] = useState<LocAnswer | null>(null);
  const value = useMemo(() => ({ loc, setLoc, answer, setAnswer }), [loc, answer]);
  return <LocCtx.Provider value={value}>{children}</LocCtx.Provider>;
}
export const useLocation = () => useContext(LocCtx);

/** The query a list is fetched with: nothing when the filter is empty. */
export function locParams(loc: LocState): Record<string, string | number> {
  return loc.where.trim() ? { where: loc.where.trim(), minutes: loc.minutes, mode: loc.mode } : {};
}

const REACHES = [5, 15, 30, 60, 120];
const MODE_NAME: Record<Mode, string> = { car: 'Car', transit: 'Public transport' };
const reachLabel = (l: LocState) => `${l.minutes} min ${l.mode === 'car' ? 'by car' : 'by public transport'}`;

/**
 * "Postcode, town or city" and a reach dropdown ("30 min by car", Car /
 * Public transport tabs, 5 · 15 · 30 · 60 · 120 min). Empty is the whole
 * estate. The list it sits on reports back whether the place was known
 * (`answer`), so the chip and the unknown line are drawn from the server's
 * answer, not guessed here.
 */
export function LocationFilter() {
  const { loc, setLoc, answer } = useLocation();
  const [text, setText] = useState(loc.where);
  const [open, setOpen] = useState(false);
  useEffect(() => { setText(loc.where); }, [loc.where]);
  useEffect(() => {
    const t = setTimeout(() => { if (text !== loc.where) setLoc({ ...loc, where: text }); }, 350);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  const filled = loc.where.trim().length > 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', zIndex: 25 }}>
      <SearchBox value={text} onChange={setText} placeholder="Postcode, town or city" width={240} icon="pin" />
      <View style={{ position: 'relative', zIndex: open ? 30 : 1 }}>
        <Press effect="none" onPress={() => setOpen((o) => !o)}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderWidth: 1,
            borderColor: desk.ruleStrong, backgroundColor: desk.well, paddingVertical: 9, paddingHorizontal: 12, width: 210,
          }}>
            <Text style={{ fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: desk.ink }}>{reachLabel(loc)}</Text>
            <Icon name="expand" size={13} color={desk.inkDim} />
          </View>
        </Press>
        {open ? (
          <View style={[{
            position: 'absolute', top: 44, left: 0, width: 230, zIndex: 30, backgroundColor: desk.picked,
            borderWidth: 1, borderColor: desk.ruleStrong, paddingVertical: 4,
          }, SHADOW]}>
            <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: desk.rule, marginTop: 4, marginHorizontal: 8, marginBottom: 6 }}>
              {(['car', 'transit'] as Mode[]).map((m) => {
                const on = loc.mode === m;
                return (
                  <Press key={m} effect="none" style={{ flex: 1 }} onPress={() => setLoc({ ...loc, mode: m })}>
                    <Text style={{
                      textAlign: 'center', paddingVertical: 7, fontFamily: fonts.body, fontSize: 12.5,
                      fontWeight: on ? '700' : '500', color: on ? desk.ink : desk.inkDim,
                      borderBottomWidth: 2, borderBottomColor: on ? LIME : 'transparent',
                    }}>{MODE_NAME[m]}</Text>
                  </Press>
                );
              })}
            </View>
            {REACHES.map((r) => {
              const on = loc.minutes === r;
              return (
                <Press key={r} effect="none" onPress={() => { setOpen(false); setLoc({ ...loc, minutes: r }); }}>
                  <Text style={{
                    paddingVertical: 8, paddingHorizontal: 12, fontFamily: fonts.body, fontSize: 13,
                    fontWeight: on ? '700' : '500', color: on ? LIME : desk.inkMuted,
                  }}>{r} min</Text>
                </Press>
              );
            })}
          </View>
        ) : null}
      </View>
      {filled && answer?.known ? (
        <Press effect="none" onPress={() => { setText(''); setLoc({ ...loc, where: '' }); }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: LIME, paddingVertical: 6, paddingHorizontal: 10 }}>
            <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: desk.ink }}>{answer.chip}</Text>
            <Text style={{ color: LIME, fontSize: 14, lineHeight: 14 }}>×</Text>
          </View>
        </Press>
      ) : null}
      {filled && answer && !answer.known ? (
        <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>Not a place we know yet — try a town or the first part of a postcode</Text>
      ) : null}
    </View>
  );
}

export { LIME, ON_LIME, desk, fonts };
