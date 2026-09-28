/**
 * What the four Facts screens share: loading a desk read, the sub-tab strip
 * with its How it works (i), the words for our sources, and the small
 * formatters the prototype's copy needs.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';

import { Icon } from '../../../components/Icon';
import { Press } from '../../../components/press';
import { useRouter } from '../../../router';
import { paths } from '../../../routes';
import { useDeskGo } from '../Desk';
import { LIME, ON_LIME, RED, deskApi, desk, fonts, saidOf, useToast } from '../kit';

export type Fig = { answered: number; agreed: number; disagreements: number; accuracy: number | null; building: boolean };

/** The Facts tab's own sub-tabs, as `ftab` spells them (All facts is the default and not written). */
export type FTab = 'all' | 'verification' | 'accuracy' | 'excluded';
export const ftabOf = (raw: string): FTab => (raw === 'verification' || raw === 'accuracy' || raw === 'excluded' ? raw : 'all');

/** Our sources, as the Facts screens name them (README v2: "Venue websites · OpenStreetMap · Wikipedia · Wikidata · Families"). */
export const SRC_NAME: Record<string, string> = {
  site: 'Venue websites', osm: 'OpenStreetMap', wikipedia: 'Wikipedia', wikidata: 'Wikidata', families: 'Families', fsa: 'Hygiene register', person: 'A person',
};
export const MACHINE_SOURCES = ['site', 'osm', 'wikipedia', 'wikidata'] as const;

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export type Load<T> = { data: T | null; error: string | null; loading: boolean; reload: () => void };

/** One desk read, fetched again whenever its path or params change. */
export function useDesk<T>(path: string | null, params: Record<string, string | number | null | undefined> = {}): Load<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const key = path ? `${path}?${JSON.stringify(params)}` : null;
  const seq = useRef(0);
  useEffect(() => {
    if (!path) return;
    const mine = ++seq.current;
    setLoading(true);
    deskApi.get<T>(path, params)
      .then((d) => { if (mine === seq.current) { setData(d); setError(null); } })
      .catch((e) => { if (mine === seq.current) setError(saidOf(e)); })
      .finally(() => { if (mine === seq.current) setLoading(false); });
  }, [key, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** Text typed into a search box, handed on once the typing stops. */
export function useDebounced(value: string, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/**
 * A write that the API logs in Changes: the toast names it, and offers Undo
 * when the change came back with its id.
 */
export function useWrite(reload: () => void) {
  const toast = useToast();
  return useCallback(async (run: () => Promise<{ id?: string } | null | undefined>, said: string) => {
    try {
      const change = await run();
      reload();
      const id = change?.id;
      toast(said, id ? async () => {
        try { await deskApi.post(`/undo/${id}`); toast('Undone'); reload(); } catch (e) { toast(saidOf(e)); }
      } : null);
    } catch (e) {
      toast(saidOf(e));
    }
  }, [reload, toast]);
}

/** The one line a screen draws while it loads or when its read failed. */
export function LoadLine({ load, what }: { load: Load<unknown>; what: string }) {
  if (load.error) return <Text style={{ fontFamily: fonts.body, fontSize: 13.5, color: RED }}>{`${what} did not load. ${load.error}`}</Text>;
  return <Text style={{ fontFamily: fonts.body, fontSize: 13.5, color: desk.inkDim }}>Loading…</Text>;
}

// ---------------------------------------------------------------------------
// The sub-tabs
// ---------------------------------------------------------------------------

const TABS: { key: FTab; name: string }[] = [
  { key: 'all', name: 'All facts' },
  { key: 'verification', name: 'Verification' },
  { key: 'accuracy', name: 'Accuracy' },
  { key: 'excluded', name: 'Excluded facts' },
];

/**
 * The segmented strip over the four screens, and How it works (i) at its end.
 * Each segment carries its own rule and overlaps its neighbour by a pixel,
 * so on a phone the strip wraps into a clean grid — no box around a ragged
 * second row, no divider left hanging at a row's start (fix pass, 28 Sep).
 */
export function FactTabs({ on }: { on: FTab }) {
  const go = useDeskGo();
  const { navigate } = useRouter();
  const cell = { borderWidth: 1, borderColor: desk.ruleStrong, marginLeft: -1, marginTop: -1 } as const;
  return (
    <View style={{ flexDirection: 'row', alignSelf: 'flex-start', flexWrap: 'wrap', maxWidth: '100%', paddingLeft: 1, paddingTop: 1 }}>
      {TABS.map((t) => {
        const lit = t.key === on;
        return (
          <Press key={t.key} effect="none" onPress={() => go('facts', { ftab: t.key === 'all' ? null : t.key })}>
            <Text style={{
              ...cell, paddingVertical: 9, paddingHorizontal: 22, fontFamily: fonts.body, fontSize: 13, fontWeight: lit ? '700' : '600',
              backgroundColor: lit ? LIME : 'transparent', color: lit ? ON_LIME : desk.inkDim,
            }}>{t.name}</Text>
          </Press>
        );
      })}
      <Press effect="none" onPress={() => navigate(paths.how('facts'))} accessibilityLabel="How it works">
        <View style={{ ...cell, justifyContent: 'center', paddingHorizontal: 12, flexGrow: 1, minHeight: 36 }}>
          <Icon name="info" size={15} color={desk.inkDim} />
        </View>
      </Press>
    </View>
  );
}

/**
 * A hover title on the web (the browser's own tooltip), for a cell cut to
 * one line. React Native Web drops `title`, so it is set on the element.
 */
export function HoverTitle({ title, children }: { title: string; children: React.ReactNode }) {
  const set = useCallback((el: unknown) => {
    const node = el as { setAttribute?: (k: string, v: string) => void } | null;
    if (Platform.OS === 'web' && node?.setAttribute) node.setAttribute('title', title);
  }, [title]);
  return <View ref={set as never}>{children}</View>;
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

/** "← Verification": the way back from a drill-down, 12.5px/700. */
export function BackLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Press effect="none" onPress={onPress} style={{ alignSelf: 'flex-start' }}>
      <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: desk.inkMuted }}>{`← ${label}`}</Text>
    </Press>
  );
}

/** A status dot (the prototype's round 8–9px mark beside Running / Healthy). */
export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, flexShrink: 0 }} />;
}

/** A 31px title with an optional line under it, above a 2px rule. */
export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontFamily: fonts.heading, fontWeight: '800', fontSize: 31, letterSpacing: -1.085, lineHeight: 32, color: desk.ink }}>{children}</Text>;
}

/** An accuracy figure: "Building" under ten answers, red under 90%. */
export function pctCell(f: Pick<Fig, 'accuracy' | 'building'>) {
  if (f.building || f.accuracy == null) return { text: 'Building', tone: desk.inkDim, weight: '500' as const };
  return { text: `${f.accuracy}%`, tone: f.accuracy < 90 ? RED : desk.ink, weight: '800' as const };
}

// Spelled by hand: en-GB writes September as "Sept".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const dayMon = (at: string | Date) => { const d = new Date(at); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
export const monShort = (at: string | Date) => MONTHS[new Date(at).getMonth()];
export const monthYear = (at: string | Date) => { const d = new Date(at); return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`; };
export const weekday = (at: string | Date) => DAYS[new Date(at).getDay()];

/** How long something has waited: "2 days", "1 day", "5 hours", "40 min". */
export function dur(mins: number) {
  const m = Math.max(0, Math.round(mins));
  if (m >= 2880) return `${Math.floor(m / 1440)} days`;
  if (m >= 1440) return '1 day';
  if (m >= 120) return `${Math.floor(m / 60)} hours`;
  return `${m} min`;
}

export const plural = (k: number, one: string, many = `${one}s`) => `${k.toLocaleString('en-GB')} ${k === 1 ? one : many}`;

/** A fact column's width: the longest name and an inch (README v2 "All facts"). */
export const nameWidth = (names: string[], min = 4) => Math.ceil(Math.max(min, ...names.map((x) => x.length)) * 7.8) + 96;
