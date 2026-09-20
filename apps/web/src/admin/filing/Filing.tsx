/**
 * The filing desk: six tabs over one taxonomy.
 *
 * Overview · Categories · Labels · Mapping · Rules · Rows — the Places
 * redesign (Claude Design, 20 Sep 2026). One screen, because the six are one
 * job: a person sits down at it and works the taxonomy until the queues are
 * empty.
 *
 * **Every layer has an address.** The tab and everything inside it are query
 * state, so `/admin/filing?tab=categories&sub=golf` opens on that drawer for
 * whoever it is sent to. A move pushes and a filter replaces, per the house
 * rule; nothing here reads or writes `window.location`.
 *
 * **The breadcrumb only appears below the root.** A root screen never repeats
 * its own tab name — the tab is already lit, and saying "Categories /
 * Categories" is the kind of chrome that makes a back office feel like one.
 *
 * The eleven rail destinations this work does not cover are drawn dimmed and
 * inert by the handoff's own instruction, which is worth restating because it
 * looks like an oversight: dim is more honest than clickable-and-dead.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { Press } from '../../components/press';
import { desk, fonts, LIME } from '../../theme';
import { asOneOf, asText, useQueryState } from '../../router';
import { api } from '../../api';
import type {
  FilingCategories, FilingCategory, FilingExcluded, FilingLabels, FilingOverview,
  FilingPlaces, FilingSet, FilingSubcategory, FilingVocabulary,
} from '../../api';
import { Overview } from './Overview';
import { CategoryBoard, CategoryList, PlacesBoard, SubcategoryBoard } from './Categories';
import { AllLabels, QuestionSet, QuestionSets } from './Labels';
import { NotInEpic } from './Mapping';

const TABS = ['overview', 'categories', 'labels', 'mapping', 'rules', 'rows'] as const;
type Tab = typeof TABS[number];

const TAB_LABEL: Record<Tab, string> = {
  overview: 'Overview',
  categories: 'Categories',
  labels: 'Labels',
  mapping: 'Mapping',
  rules: 'Rules',
  rows: 'Rows',
};

/** The minimum this surface is drawn at. It is a desktop back office. */
const MIN_WIDTH = 1180;

export function Filing({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useQueryState<Tab>('tab', 'overview', asOneOf(TABS, 'overview'));
  const [cat, setCat] = useQueryState<string>('cat', '', asText);
  const [sub, setSub] = useQueryState<string>('sub', '', asText);
  const [set, setSet] = useQueryState<string>('set', '', asText);
  const [view, setView] = useQueryState<string>('view', '', asText);

  const [overview, setOverview] = useState<FilingOverview | null>(null);
  const [categories, setCategories] = useState<FilingCategories | null>(null);
  const [category, setCategory] = useState<FilingCategory | null>(null);
  const [drawer, setDrawer] = useState<FilingSubcategory | null>(null);
  const [places, setPlaces] = useState<FilingPlaces | null>(null);
  const [labels, setLabels] = useState<FilingLabels | null>(null);
  const [oneSet, setOneSet] = useState<FilingSet | null>(null);
  const [vocabulary, setVocabulary] = useState<FilingVocabulary | null>(null);
  const [excluded, setExcluded] = useState<FilingExcluded | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  /** A toast is a sentence that fades. It never carries an error. */
  const said = useCallback((what: string) => {
    setToast(what);
    setTimeout(() => setToast((t) => (t === what ? null : t)), 3200);
  }, []);

  /**
   * Fetch whatever this address needs, and only that.
   *
   * Keyed on every piece of the address so a shared link loads the same screen
   * the sender was looking at, rather than the tab's root.
   */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === 'overview') setOverview(await api.filingOverview());
      if (tab === 'categories') {
        if (sub && view === 'places') {
          const [d, p] = await Promise.all([api.filingSubcategory(sub), api.filingPlaces(sub)]);
          setDrawer(d); setPlaces(p);
        } else if (sub) setDrawer(await api.filingSubcategory(sub));
        else if (cat) setCategory(await api.filingCategory(cat));
        else setCategories(await api.filingCategories());
      }
      if (tab === 'labels') {
        if (view === 'vocabulary') setVocabulary(await api.filingVocabulary());
        else if (set) setOneSet(await api.filingSet(set));
        else setLabels(await api.filingLabels());
      }
      if (tab === 'mapping' && view === 'excluded') setExcluded(await api.filingExcluded());
    } catch (err) {
      // A provider's error never reaches a screen in its own words, and neither
      // does ours: one sentence, and the detail is in the network tab.
      setError(err instanceof Error ? err.message : 'That did not load.');
    } finally {
      setLoading(false);
    }
  }, [tab, cat, sub, set, view]);

  useEffect(() => { void load(); }, [load]);

  /** Every write goes through here, so one of them cannot forget to reload. */
  const run = useCallback(async (key: string, what: () => Promise<string>) => {
    setBusy(key);
    try {
      said(await what());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }, [load, said]);

  const go = useCallback((next: Partial<{ tab: Tab; cat: string; sub: string; set: string; view: string }>) => {
    // Order matters: the tab last, so the layer state is in place before the
    // effect that reads it fires.
    if (next.cat !== undefined) setCat(next.cat);
    if (next.sub !== undefined) setSub(next.sub);
    if (next.set !== undefined) setSet(next.set);
    if (next.view !== undefined) setView(next.view);
    if (next.tab !== undefined) setTab(next.tab);
  }, [setCat, setSub, setSet, setView, setTab]);

  const root = (t: Tab) => go({ tab: t, cat: '', sub: '', set: '', view: '' });

  /** Where a queue card on the Overview lands. */
  const goQueue = (where: string) => {
    if (where === 'labels') return root('labels');
    if (where === 'pen') return go({ tab: 'labels', cat: '', sub: '', set: '', view: '' });
    if (where === 'audit') return go({ tab: 'mapping', cat: '', sub: '', set: '', view: 'audit' });
    if (where === 'arguing') return root('rules');
    return root('overview');
  };

  const trail = crumbs({ tab, cat, sub, set, view, category, drawer, oneSet, go });

  return (
    <ScrollView style={{ flex: 1, backgroundColor: desk.ground }} contentContainerStyle={{ minWidth: MIN_WIDTH }}>
      <View style={{ flex: 1 }}>
        {/* The tab row, and the two things that live to the right of it. */}
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 24,
          paddingHorizontal: 28,
          paddingTop: 18,
        }}>
          <View style={{
            flexDirection: 'row',
            gap: 30,
            flex: 1,
            borderBottomWidth: 2,
            borderBottomColor: desk.ruleStrong,
          }}>
            {TABS.map((t) => (
              <Press key={t} effect="none" onPress={() => root(t)} accessibilityRole="tab"
                     accessibilityState={{ selected: tab === t }}>
                <View style={{
                  paddingBottom: 13,
                  marginBottom: -2,
                  borderBottomWidth: 2,
                  borderBottomColor: tab === t ? LIME : 'transparent',
                }}>
                  <Text style={{
                    fontFamily: fonts.heading,
                    fontSize: 17,
                    fontWeight: '800',
                    letterSpacing: -0.34,
                    color: tab === t ? desk.ink : desk.inkDim,
                  }}>
                    {TAB_LABEL[t]}
                  </Text>
                </View>
              </Press>
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, flexGrow: 0, flexShrink: 0, paddingBottom: 11 }}>
            {toast ? (
              <Text style={{ fontFamily: fonts.body, fontSize: 12, fontWeight: '700', color: LIME }}>{toast}</Text>
            ) : null}
            <Press effect="none" onPress={() => root('rows')} accessibilityRole="button">
              <Text style={{
                fontFamily: fonts.body, fontSize: 12, fontWeight: '700', color: desk.inkMuted,
                borderBottomWidth: 1, borderBottomColor: desk.ruleStrong, paddingBottom: 2,
              }}>
                Runs
              </Text>
            </Press>
          </View>
        </View>

        <View style={{ flex: 1, paddingHorizontal: 28, paddingTop: 20, paddingBottom: 60, gap: 20 }}>
          {trail.length > 1 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 16 }}>
              {trail.map((c, i) => (
                <React.Fragment key={`${c.label}-${i}`}>
                  {i ? (
                    <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkFaint }}>/</Text>
                  ) : null}
                  {c.go ? (
                    <Press effect="none" onPress={c.go} accessibilityRole="link">
                      <Text style={{
                        fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600', color: desk.inkDim,
                        borderBottomWidth: 1, borderBottomColor: desk.ruleStrong, paddingBottom: 1,
                      }}>
                        {c.label}
                      </Text>
                    </Press>
                  ) : (
                    <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '800', color: desk.ink }}>
                      {c.label}
                    </Text>
                  )}
                </React.Fragment>
              ))}
            </View>
          ) : null}

          {error ? (
            <View style={{ borderLeftWidth: 2, borderLeftColor: desk.warn, paddingLeft: 14, paddingVertical: 4 }}>
              <Text style={{ fontFamily: fonts.body, fontSize: 13, color: desk.warn }}>{error}</Text>
            </View>
          ) : null}

          {loading && !anyLoaded({ overview, categories, category, drawer, labels, oneSet, vocabulary, excluded }) ? (
            <View style={{ paddingVertical: 60, alignItems: 'flex-start' }}>
              <ActivityIndicator color={LIME} />
            </View>
          ) : null}

          {tab === 'overview' && overview ? (
            <Overview
              data={overview}
              onGo={goQueue}
              onThreshold={(key, value) => void run(key, async () => {
                const out = await api.filingSetThreshold({ key, value });
                return `${out.threshold.label} → ${out.threshold.value}`;
              })}
            />
          ) : null}

          {tab === 'categories' && !cat && !sub && categories ? (
            <CategoryList data={categories} onOpen={(key) => go({ tab: 'categories', cat: key, sub: '', view: '' })} />
          ) : null}

          {tab === 'categories' && cat && !sub && category ? (
            <CategoryBoard data={category} onOpen={(key) => go({ sub: key, view: '' })} />
          ) : null}

          {tab === 'categories' && sub && view === 'places' && places && drawer ? (
            <PlacesBoard data={places} label={drawer.subcategory.label} />
          ) : null}

          {tab === 'categories' && sub && view !== 'places' && drawer ? (
            <SubcategoryBoard
              data={drawer}
              busy={busy}
              onPlaces={() => go({ view: 'places' })}
              onSet={(key) => go({ tab: 'labels', set: key, cat: '', sub: '', view: '' })}
              onMap={() => go({ tab: 'mapping', cat: '', sub: '', set: '', view: '' })}
              onStrike={(word) => void run(word, async () => `${word} — striking a rule is not wired yet`)}
              onAccept={(attribute) => void run(attribute, async () => {
                const out = await api.filingSetDefault(sub, { attribute, accept: true });
                return `${labelOf(drawer, attribute)} set on ${drawer.subcategory.label}`;
              })}
              onFlip={(attribute) => void run(attribute, async () => {
                await api.filingSetDefault(sub, { attribute, flip: true });
                return `${labelOf(drawer, attribute)} flipped`;
              })}
              onAcceptAll={() => void run('all', async () => {
                const out = await api.filingAcceptAll(sub);
                return `${out.accepted} accepted on ${drawer.subcategory.label}`;
              })}
            />
          ) : null}

          {tab === 'labels' && !set && view !== 'vocabulary' && labels ? (
            <QuestionSets sets={labels.sets} onOpen={(key) => go({ set: key, view: '' })} />
          ) : null}

          {tab === 'labels' && set && oneSet && labels ? (
            <QuestionSet
              set={setRowFor(labels, set, oneSet)}
              questions={oneSet.questions}
              globals={labels.globals}
              candidates={oneSet.candidates}
              pen={oneSet.pen}
              inFlight={oneSet.inFlight}
              thin={oneSet.thin}
              thresholds={thresholdsOf(overview)}
              readNote={oneSet.readNote}
              onRemoveQuestion={() => said('Removing a question is not wired yet')}
              onDetach={() => said('Detaching a subcategory is not wired yet')}
              onPromote={() => said('Promoting a candidate is not wired yet')}
              onIgnore={() => said('Ignoring a candidate is not wired yet')}
            />
          ) : null}

          {tab === 'labels' && view === 'vocabulary' && vocabulary ? (
            <AllLabels
              rows={vocabulary.vocabulary}
              onAskIn={() => said('Asking an orphan label somewhere is not wired yet')}
              onRetire={() => said('Retiring a label is not wired yet')}
              onOpenSet={(key) => go({ set: key, view: '' })}
            />
          ) : null}

          {tab === 'mapping' && view === 'excluded' && excluded ? (
            <NotInEpic
              rows={excluded.excluded}
              placesKeptOut={excluded.counts.places}
              onRestore={() => said('Putting a word back is not wired yet')}
            />
          ) : null}

          {/* The tabs whose screens are drawn but not yet fed. Saying which is
              better than a blank panel: a screen that is coming and a screen
              that is broken look identical otherwise. */}
          {notYet(tab, view) ? (
            <View style={{ paddingVertical: 40, gap: 6 }}>
              <Text style={{ fontFamily: fonts.heading, fontSize: 20, fontWeight: '800', color: desk.ink }}>
                {TAB_LABEL[tab]} is drawn, and not yet fed
              </Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 13, color: desk.inkDim, maxWidth: 620, lineHeight: 20 }}>
                The screen exists and the shape it wants is agreed. What it reads has not landed yet, and
                showing it against invented numbers would be worse than showing nothing.
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}

const anyLoaded = (o: Record<string, unknown>) => Object.values(o).some(Boolean);

/** Which tabs have no data behind them yet, so the screen can say so. */
function notYet(tab: Tab, view: string): boolean {
  if (tab === 'rules' || tab === 'rows') return true;
  if (tab === 'mapping' && view !== 'excluded') return true;
  return false;
}

const labelOf = (d: FilingSubcategory, key: string) =>
  [...d.facets, ...d.axes, ...d.excluded].find((a) => a.key === key)?.label ?? key;

/**
 * The set as its own screen wants it.
 *
 * `settling` is a fact about the *queue*, and on the set screen the queue is
 * the three candidate lists sitting beside it — so the detail view carries
 * only settled-or-not and the distinction lives where it can be seen
 * (epic-f4, 20 Sep 2026).
 */
const setRowFor = (labels: FilingLabels, key: string, detail: FilingSet | null) => {
  const row = labels.sets.find((s) => s.key === key);
  return {
    key,
    name: detail?.set.name ?? row?.name ?? key,
    state: row?.state === 'settled' ? ('settled' as const) : null,
    tooFewForTooMany: row?.tooFewForTooMany ?? false,
    // The detail view's pills have to know what they would detach, so this one
    // carries keys where the list carries bare labels.
    usedBy: detail?.set.usedBy ?? (row?.usedBy ?? []).map((label) => ({ key: label, label })),
    questions: row?.questions ?? detail?.questions.length ?? 0,
    places: row?.places ?? detail?.set.places ?? 0,
    waiting: row?.waiting ?? 0,
  };
};

/**
 * The thresholds, keyed, with the name the screens index them by.
 *
 * The API calls it `label` because that is what it is called everywhere else
 * a label is drawn; the filing screens call it `name`. Carried rather than
 * renamed on either side, so neither vocabulary has to give way.
 */
const thresholdsOf = (o: FilingOverview | null) =>
  Object.fromEntries((o?.thresholds ?? []).map((t) => [t.key, {
    ...t,
    name: t.label,
    // A threshold with no floor has one of nought: every one of these is a
    // count or a share, and neither runs backwards.
    min: t.min ?? 0,
    max: t.max ?? Number.MAX_SAFE_INTEGER,
  }]));

/**
 * The trail, built from the address rather than from where you came from.
 *
 * A root screen contributes one crumb and the bar is not drawn, which is the
 * handoff's rule: more than one level deep, or nothing.
 */
function crumbs({ tab, cat, sub, set, view, category, drawer, oneSet, go }: {
  tab: Tab; cat: string; sub: string; set: string; view: string;
  category: FilingCategory | null; drawer: FilingSubcategory | null; oneSet: FilingSet | null;
  go: (next: Partial<{ tab: Tab; cat: string; sub: string; set: string; view: string }>) => void;
}): { label: string; go?: () => void }[] {
  const out: { label: string; go?: () => void }[] = [{ label: TAB_LABEL[tab], go: () => go({ tab, cat: '', sub: '', set: '', view: '' }) }];
  if (tab === 'categories') {
    if (cat || sub) {
      const name = drawer?.subcategory.category?.label ?? category?.category.label ?? cat;
      const key = drawer?.subcategory.category?.key ?? cat;
      out.push({ label: name, go: () => go({ cat: key, sub: '', view: '' }) });
    }
    if (sub) out.push({ label: drawer?.subcategory.label ?? sub, go: view ? () => go({ view: '' }) : undefined });
    if (view === 'places') out.push({ label: 'All places' });
  }
  if (tab === 'labels') {
    if (set) out.push({ label: oneSet?.set.name ?? set });
    if (view === 'vocabulary') out.push({ label: 'All labels' });
  }
  if (tab === 'mapping' && view === 'excluded') out.push({ label: 'Not in Epic' });
  // The last crumb is where you are, and is never a link.
  if (out.length) out[out.length - 1] = { label: out[out.length - 1].label };
  return out;
}
