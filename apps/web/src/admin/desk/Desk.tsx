/**
 * The filing desk, as the back-office handover of 28 Sep 2026 draws it.
 *
 * Seven tabs over one taxonomy: Overview · Categories · Facts · Mapping ·
 * Collections · Fact automations · Changes. Defaults and Ideas are gone — a
 * subcategory's defaults live on its own page, and Ideas are Collections
 * everywhere. Runs is a place you can be without being a tab: the corner link
 * beside the toast, and "Recent runs and spend →" on Overview.
 *
 * Two rules the design README makes product rules rather than styling: a
 * screen answers one question, and humans decide while the machine runs
 * itself — there is no button here that starts a job.
 *
 * **Every layer has an address.** The tab and everything inside it are query
 * state, read and written through the router; nothing here touches
 * `window.location`. Each screen owns its own query keys (listed in
 * `routes.ts` beside `FILING_TABS`), its own data and its own crumbs.
 *
 * **The breadcrumb only appears below the root** — more than one level deep,
 * or nothing.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Press } from '../../components/press';
import { useViewport } from '../../hooks/useViewport';
import { asText, useQueryState, useRouter } from '../../router';
import { filingTabOf, type FilingTab } from '../../routes';
import { LIME, desk, fonts } from '../../theme';
import { LocationProvider, ToastLine, ToastProvider } from './kit';
import { SIDE_KEY, SIDE_TABS } from './side';
import { Overview } from './Overview';
import { Categories } from './Categories';
import { Facts } from './Facts';
import { Mapping } from './Mapping';
import { Collections } from './Collections';
import { Automations } from './Automations';
import { Changes } from './Changes';
import { Markets } from './Markets';
import { RunsScreen } from './RunsScreen';

type Tab = FilingTab;
const asTab = { read: filingTabOf, write: (v: Tab | null) => (v == null || v === 'overview' ? null : v) };

/** The strip, in the handover's order. */
const TABS: { key: Tab; name: string }[] = [
  { key: 'overview', name: 'Overview' },
  { key: 'categories', name: 'Categories' },
  { key: 'facts', name: 'Facts' },
  { key: 'mapping', name: 'Mapping' },
  { key: 'collections', name: 'Collections' },
  { key: 'automations', name: 'Fact automations' },
  { key: 'changes', name: 'Changes' },
  { key: 'markets', name: 'Markets' },
];

/**
 * Every query key a screen on the desk may write. Moving to another tab clears
 * all of them, so a tab always opens at its own root.
 */
export const DESK_KEYS = [
  'sub', 'cat', 'fact', 'q', 'view', 'ftab', 'places', 'acc', 'key', 'src', 'word', 'collection', 'place', 'area', 'who', 'state', 'period', 'chart', 'by', 'kind', 'run',
  // Mapping's filters and its picker's tab (agent C, 28 Sep; `sort` below).
  'filters', 'ptab',
  // The picker's list fact opened to its values (round 3, 29 Sep).
  'pfact',
  'sort', 'country', 'county', 'feature',
  // Markets: the market a page is drilled into, and the wording namespace (step 4).
  'market', 'ns',
  // A fact drill-down's postcode filter (agent B, fix pass 28 Sep).
  'pc',
  // Accuracy's expanded category rows, comma-separated (agent B2, 28 Sep).
  'open',
] as const;

// ---------------------------------------------------------------------------
// Crumbs
// ---------------------------------------------------------------------------

export type Crumb = { name: string; go?: () => void };
const CrumbCtx = createContext<(c: Crumb[]) => void>(() => {});

/**
 * A screen names the trail to where it is. The first crumb is the tab's root;
 * the bar is drawn only when there is more than one, and the last crumb is
 * where you are, never a link.
 */
export function useCrumbs(crumbs: Crumb[], deps: React.DependencyList) {
  const set = useContext(CrumbCtx);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { set(crumbs); }, deps);
}

/** Go somewhere inside the desk: a tab and the query that sets it. A move pushes. */
export function useDeskGo() {
  const { setQuery } = useRouter();
  return useCallback((tab: Tab | null, query: Partial<Record<(typeof DESK_KEYS)[number], string | null>> = {}, replace = false) => {
    const cleared = Object.fromEntries(DESK_KEYS.map((k) => [k, null])) as Record<string, string | null>;
    // `side` (Food & drink · Things to do) is shared by the four tabs that
    // draw the toggle, so a move between them keeps it; anywhere else it goes.
    if (!SIDE_TABS.includes(tab ?? 'overview')) cleared[SIDE_KEY] = null;
    // A move pushes, a filter replaces: the router replaces unless told not to.
    setQuery({ ...cleared, ...query, tab: asTab.write(tab) }, { replace });
  }, [setQuery]);
}

// ---------------------------------------------------------------------------
// The desk
// ---------------------------------------------------------------------------

export function Desk({ canManage }: { canManage: boolean }) {
  const { setQuery, query } = useRouter();
  const [tab] = useQueryState<Tab>('tab', 'overview', asTab);
  const go = useDeskGo();
  const narrow = useViewport().width < 900;
  // Crumbs are held against the tab that drew them, so a tab that draws none
  // has none — without a clearing effect, whose order against the screens' own
  // useCrumbs is not guaranteed (React's dev double-invoke ran it after them
  // and wiped every screen whose crumbs were set once).
  const [crumbState, setCrumbState] = useState<{ tab: Tab; list: Crumb[] }>({ tab, list: [] });
  const setCrumbs = useCallback((list: Crumb[]) => setCrumbState({ tab, list }), [tab]);
  const crumbs = crumbState.tab === tab ? crumbState.list : [];

  // An old spelling (`?tab=ideas`) is read across and written over, as a
  // correction rather than a step, so a copied link moves to the new word.
  const rawTab = query.get('tab');
  useEffect(() => {
    if (rawTab != null && rawTab !== asTab.write(tab)) setQuery({ tab: asTab.write(tab) }, { replace: true });
  }, [rawTab, tab, setQuery]);


  const lit = tab === 'runs' ? null : tab;

  // The desk scrolls in its own box: inside the Mobile frame nothing above it
  // scrolls, and a page taller than the frame could not be read (audit, 28 Sep).
  return (
    <ScrollView style={{ flex: 1, backgroundColor: desk.ground }} contentContainerStyle={{ flexGrow: 1 }}>
    <ToastProvider render={(toast, clear) => (
      <DeskChrome
        lit={lit}
        narrow={narrow}
        onTab={(t) => go(t)}
        onRuns={() => go('runs')}
        toast={<ToastLine toast={toast} clear={clear} />}
      />
    )}>
      <LocationProvider>
        <CrumbCtx.Provider value={setCrumbs}>
          <View style={{
            paddingTop: 20, paddingHorizontal: narrow ? 16 : 28, paddingBottom: 60, gap: 20,
            backgroundColor: desk.ground, flexGrow: 1,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 16, flexWrap: 'wrap' }}>
              {crumbs.length > 1 ? crumbs.map((c, i) => {
                const last = i === crumbs.length - 1;
                return (
                  <React.Fragment key={`${i}-${c.name}`}>
                    {i ? <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkFaint }}>/</Text> : null}
                    <Press effect="none" onPress={last ? undefined : c.go}>
                      <Text style={{
                        fontFamily: fonts.body, fontSize: 12.5, fontWeight: last ? '800' : '600',
                        color: last ? desk.ink : desk.inkDim, paddingBottom: 1,
                      }}>{c.name}</Text>
                    </Press>
                  </React.Fragment>
                );
              }) : null}
            </View>
            {tab === 'overview' ? <Overview /> : null}
            {tab === 'categories' ? <Categories canManage={canManage} /> : null}
            {tab === 'facts' ? <Facts canManage={canManage} /> : null}
            {tab === 'mapping' ? <Mapping canManage={canManage} /> : null}
            {tab === 'collections' ? <Collections canManage={canManage} /> : null}
            {tab === 'automations' ? <Automations canManage={canManage} /> : null}
            {tab === 'changes' ? <Changes canManage={canManage} /> : null}
            {tab === 'markets' ? <Markets canManage={canManage} /> : null}
            {tab === 'runs' ? <RunsScreen /> : null}
          </View>
        </CrumbCtx.Provider>
      </LocationProvider>
    </ToastProvider>
    </ScrollView>
  );
}

/**
 * The strip: 16px/800 names on a 2px rule, the lit one ink over a lime rule,
 * the rest muted; the toast and the Runs link at the right.
 */
function DeskChrome({ lit, narrow, onTab, onRuns, toast }: {
  lit: Tab | null; narrow: boolean; onTab: (t: Tab) => void; onRuns: () => void; toast: React.ReactNode;
}) {
  // On a phone the strip scrolls sideways, and the lit tab is brought into
  // view — "Changes" lit at the far end was off the frame (audit, 28 Sep).
  // Measured, never timed: every tab's place and the strip's own width come
  // from onLayout, and the lit tab is brought into view whenever any of them
  // (or the lit tab) changes — on the frame after, once the scroller knows its
  // content is wider than itself (second audit CH.9).
  const scroller = useRef<ScrollView | null>(null);
  const spans = useRef<Partial<Record<Tab, { x: number; w: number }>>>({});
  const view = useRef({ w: 0, at: 0 });
  const [laid, setLaid] = useState(0);
  const relaid = useCallback(() => setLaid((n) => n + 1), []);
  useEffect(() => {
    if (!narrow || !lit) return;
    const span = spans.current[lit];
    const { w } = view.current;
    if (!span || !w) return;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f: () => void) => setTimeout(f, 0) as unknown as number;
    const caf = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : (h: number) => clearTimeout(h);
    const h = raf(() => {
      const { at } = view.current;
      // Already wholly in view: leave the strip where the person put it.
      if (span.x >= at && span.x + span.w <= at + w) return;
      const x = span.x < at ? span.x - 24 : span.x + span.w - w + 24;
      scroller.current?.scrollTo({ x: Math.max(0, x), animated: false });
    });
    return () => caf(h);
  }, [lit, narrow, laid]);
  const runs = (
    <Press effect="none" onPress={onRuns}>
      <Text style={{ fontFamily: fonts.body, fontSize: 12, fontWeight: '700', color: desk.inkMuted }}>Runs</Text>
    </Press>
  );
  // One tree for both widths: the strip always sits in a sideways scroller
  // (on a wide screen it never needs to move), Runs always on the strip's
  // line; only the toast moves under it on a phone, where there is no room.
  return (
    <View style={{ paddingTop: 18, paddingHorizontal: narrow ? 16 : 28, backgroundColor: desk.ground }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: narrow ? 14 : 24 }}>
        <ScrollView
          ref={scroller}
          horizontal
          scrollEnabled={narrow}
          showsHorizontalScrollIndicator={false}
          style={{ flex: 1, minWidth: 0, flexGrow: 1 }}
          contentContainerStyle={{ flexGrow: 1 }}
          onLayout={(e) => { view.current.w = e.nativeEvent.layout.width; relaid(); }}
          onContentSizeChange={relaid}
          onScroll={(e) => { view.current.at = e.nativeEvent.contentOffset.x; }}
          scrollEventThrottle={16}
        >
          <View style={{ flexDirection: 'row', gap: 24, borderBottomWidth: 2, borderBottomColor: desk.ruleStrong, flexGrow: 1 }}>
            {TABS.map((t) => {
              const on = lit === t.key;
              return (
                <Press
                  key={t.key}
                  effect="none"
                  onPress={() => onTab(t.key)}
                  onLayout={(e) => { const { x, width } = e.nativeEvent.layout; spans.current[t.key] = { x, w: width }; if (on) relaid(); }}
                >
                  <View style={{ paddingBottom: 13, marginBottom: -2, borderBottomWidth: 2, borderBottomColor: on ? LIME : 'transparent' }}>
                    <Text style={{ fontFamily: fonts.heading, fontSize: 16, fontWeight: '800', letterSpacing: -0.32, color: on ? desk.ink : desk.inkDim }}>{t.name}</Text>
                  </View>
                </Press>
              );
            })}
          </View>
        </ScrollView>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingBottom: 11 }}>
          {narrow ? null : toast}
          {runs}
        </View>
      </View>
      {narrow ? <View style={{ paddingTop: 8 }}>{toast}</View> : null}
    </View>
  );
}

/** The query value for a desk key, as text ('' when absent). */
export function useDeskParam(key: (typeof DESK_KEYS)[number]) {
  return useQueryState<string>(key, '', asText);
}

export const useMemoOnce = useMemo;
