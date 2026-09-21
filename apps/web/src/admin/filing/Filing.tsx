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
import { asOneOf, asText, useQueryState, useRouter } from '../../router';
import { api } from '../../api';
import type {
  FilingCategories, FilingCategory, FilingExcluded, FilingLabels, FilingOverview,
  FilingPlaces, FilingSet, FilingSubcategory, FilingVocabulary,
} from '../../api';
import { SegStrip } from './desk';
import { Overview } from './Overview';
import { CategoryBoard, CategoryList, PlacesBoard, SubcategoryBoard } from './Categories';
import { AllLabels, Pending, QuestionSet, QuestionSets } from './Labels';
import { NotInEpic, Words } from './Mapping';
import { HouseholdView, Rows, type HouseState, type RowFilter } from './Rows';
import { Train } from './Train';
import { Rules } from './Rules';
import { DecisionLog, Runs } from './Runs';
import type { Decision, HouseMember, Trail, WordRow } from './types';
import type { SortKey } from './say';

/** The six the strip draws. */
const TABS = ['overview', 'categories', 'labels', 'mapping', 'rules', 'rows'] as const;
/**
 * Runs is a place you can be without being a tab.
 *
 * The handoff puts it behind the corner link and the left nav rather than in
 * the strip — it is where you go to ask "is this working?", not one of the six
 * things you work on. It still has an address, because everything here does.
 */
const PLACES = [...TABS, 'runs'] as const;
type Tab = typeof PLACES[number];

const TAB_LABEL: Record<Tab, string> = {
  overview: 'Overview',
  categories: 'Categories',
  labels: 'Labels',
  mapping: 'Mapping',
  rules: 'Rules',
  rows: 'Rows',
  runs: 'Runs',
};

/** The minimum this surface is drawn at. It is a desktop back office. */
const MIN_WIDTH = 1180;

export function Filing({ canManage }: { canManage: boolean }) {
  const { setQuery } = useRouter();
  const [tab] = useQueryState<Tab>('tab', 'overview', asOneOf(PLACES, 'overview'));
  const [cat] = useQueryState<string>('cat', '', asText);
  const [sub] = useQueryState<string>('sub', '', asText);
  const [set] = useQueryState<string>('set', '', asText);
  const [view] = useQueryState<string>('view', '', asText);

  const [overview, setOverview] = useState<FilingOverview | null>(null);
  const [categories, setCategories] = useState<FilingCategories | null>(null);
  const [category, setCategory] = useState<FilingCategory | null>(null);
  const [drawer, setDrawer] = useState<FilingSubcategory | null>(null);
  const [places, setPlaces] = useState<FilingPlaces | null>(null);
  const [labels, setLabels] = useState<FilingLabels | null>(null);
  const [oneSet, setOneSet] = useState<FilingSet | null>(null);
  const [vocabulary, setVocabulary] = useState<FilingVocabulary | null>(null);
  const [excluded, setExcluded] = useState<FilingExcluded | null>(null);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.adminFilingRows>> | null>(null);
  const [rowFilter, setRowFilter] = useState<RowFilter>('all');
  const [houseState, setHouseState] = useState<HouseState>('list');
  const [district, setDistrict] = useState<string>('');
  const [train, setTrain] = useState<Awaited<ReturnType<typeof api.filingTrain>> | null>(null);
  const [onePlace, setOnePlace] = useState<Awaited<ReturnType<typeof api.filingPlace>> | null>(null);
  const [mode, setMode] = useState<'sweep' | 'grid' | 'inspect'>('sweep');
  const [rules, setRules] = useState<Awaited<ReturnType<typeof api.adminFilingRules>> | null>(null);
  const [runs, setRuns] = useState<Awaited<ReturnType<typeof api.adminFilingRuns>> | null>(null);
  const [decisions, setDecisions] = useState<Awaited<ReturnType<typeof api.adminFilingDecisions>> | null>(null);
  const [decision, setDecision] = useState<Decision['decision'] | 'all'>('all');
  const [decisionSet, setDecisionSet] = useState<string | 'all'>('all');
  const [trails, setTrails] = useState<Record<string, Trail>>({});
  const [mapping, setMapping] = useState<Awaited<ReturnType<typeof api.filingMapping>> | null>(null);
  const [sort, setSort] = useState<SortKey>('brings');
  const [descending, setDescending] = useState(true);
  const [filters, setFilters] = useState<{ key: string; name: string }[]>([]);
  /** Fetched when a row opens, because the consequence depends on the word. */
  const [dests, setDests] = useState<Record<string, Awaited<ReturnType<typeof api.filingDestinations>>>>({});
  const [undo, setUndo] = useState<{ what: string; onPress: () => void } | null>(null);
  const [pending, setPending] = useState<Awaited<ReturnType<typeof api.adminFilingPending>> | null>(null);

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
        } else if (sub && view === 'train') {
          const [d, t] = await Promise.all([api.filingSubcategory(sub), api.filingTrain(sub)]);
          setDrawer(d); setTrain(t);
        } else if (sub) setDrawer(await api.filingSubcategory(sub));
        else if (cat) setCategory(await api.filingCategory(cat));
        else setCategories(await api.filingCategories());
      }
      if (tab === 'labels') {
        if (view === 'pending') setPending(await api.adminFilingPending());
        else if (view === 'vocabulary') setVocabulary(await api.filingVocabulary());
        else if (set) {
          // Both, always. The set screen draws the global labels and its own
          // row from the list, so fetching only the set left a shared link
          // like `?tab=labels&set=water` rendering nothing at all — which is
          // the one promise the addresses here exist to keep (Codex, 20 Sep).
          const [one, list] = await Promise.all([api.filingSet(set), api.filingLabels()]);
          setOneSet(one); setLabels(list);
        } else setLabels(await api.filingLabels());
      }
      if (tab === 'mapping' && view === 'excluded') setExcluded(await api.filingExcluded());
      if (tab === 'mapping' && view !== 'excluded') setMapping(await api.filingMapping());
      if (tab === 'rows') setRows(await api.adminFilingRows());
      if (tab === 'rules') setRules(await api.adminFilingRules());
      if (tab === 'runs') {
        if (view === 'decisions') {
          setDecisions(await api.adminFilingDecisions({
            decision: decision === 'all' ? undefined : decision,
            set: decisionSet === 'all' ? undefined : decisionSet,
          }));
        } else setRuns(await api.adminFilingRuns());
      }
    } catch (err) {
      // A provider's error never reaches a screen in its own words, and neither
      // does ours: one sentence, and the detail is in the network tab.
      setError(err instanceof Error ? err.message : 'That did not load.');
    } finally {
      setLoading(false);
    }
  }, [tab, cat, sub, set, view, decision, decisionSet]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Inspect belongs to the drawer you are in.
   *
   * Leaving Train and opening it for a different drawer kept both the mode and
   * the place, so the new drawer opened showing — and offering to edit — a
   * place from the old one, under the new one's heading (Codex, 21 Sep 2026).
   */
  useEffect(() => { setOnePlace(null); setMode('sweep'); }, [sub]);

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

  /**
   * Move, as one write to the address.
   *
   * `setQuery` reads the live address rather than the render's, so several
   * calls in a handler do compose — but they are several history entries, and
   * a Back out of a drawer would then step through the four intermediate
   * addresses nobody was ever on. One patch, one entry.
   *
   * **A move pushes and a filter replaces** (the house rule). Changing tab or
   * opening a drawer is a move: Back should come out of it. Everything else
   * here is a setting of the page you are already on, and `setQuery` replaces
   * by default, which is why the distinction has to be made explicitly.
   */
  /**
   * Point a word somewhere, and keep the way back.
   *
   * The design brief asks for no confirm step and an undo on the row, so the
   * reply's `before` is turned straight into the undo rather than the screen
   * remembering what it thought the word was.
   */
  const point = useCallback(async (
    w: { word: string; labels: string[] },
    what: { subcategory?: string; decision?: string; carry?: string },
  ) => {
    await run(w.word, async () => {
      if (what.carry) {
        const on = !w.labels.includes(what.carry);
        const out = await api.filingCarry(w.word, { label: what.carry, on });
        setUndo({
          what: out.said,
          onPress: () => void run(w.word, async () => {
            const back = await api.filingCarry(w.word, { label: what.carry!, on: !on });
            setUndo(null);
            return back.said;
          }),
        });
        return out.said;
      }
      const out = await api.filingPoint(w.word, what);
      setUndo({
        what: out.said,
        onPress: () => void run(w.word, async () => {
          const back = await api.filingPoint(w.word, out.before.subcategory
            ? { subcategory: out.before.subcategory }
            : { decision: out.before.decision ?? 'none' });
          setUndo(null);
          return back.said;
        }),
      });
      return out.said;
    });
    setDests({});
  }, [run]);

  /**
   * Heart a row, or take the heart back, as the right person.
   *
   * A heart belongs to a member, so unhearting has to be aimed at whoever owns
   * it — `(row, first member)` deleted nothing in any household where somebody
   * else set it, and the screen said it had worked. The id comes off the row
   * and not the name, because two members of one household can share a name
   * (Codex via epic-f4, 21 Sep 2026).
   *
   * Hearting *on* is a different case: nobody owns it yet, and whose list this
   * is, is the first-heart question. Until the back office asks it, the
   * household's first adult is the honest stand-in and the toast says who.
   */
  const heartRow = useCallback((id: string) => {
    if (!rows) return;
    const row = rows.rows.find((r) => r.id === id);
    const owner = row?.heartedById ?? null;
    const member = row?.hearted
      ? owner
      : (rows.members.find((m) => m.role === 'adult') ?? rows.members[0])?.id ?? null;
    if (!member) {
      said(row?.hearted
        ? 'Nobody in this household owns that heart.'
        : 'Nobody is in this household to heart it as.');
      return;
    }
    const who = rows.members.find((m) => m.id === member)?.name ?? 'somebody';
    void run(id, async () => {
      await api.adminFilingHeart(id, !row?.hearted, member);
      return row?.hearted
        ? `${row?.title ?? id} unhearted for ${who}`
        : `${row?.title ?? id} hearted for ${who}`;
    });
  }, [rows, run, said]);

  const go = useCallback((next: Partial<{ tab: Tab; cat: string; sub: string; set: string; view: string }>) => {
    const patch: Record<string, string | null> = {};
    const put = (k: string, v: string | undefined) => {
      if (v === undefined) return;
      patch[k] = v === '' ? null : v;
    };
    put('cat', next.cat);
    put('sub', next.sub);
    put('set', next.set);
    put('view', next.view);
    if (next.tab !== undefined) patch.tab = next.tab === 'overview' ? null : next.tab;
    const moved = next.tab !== undefined || Boolean(next.cat) || Boolean(next.sub) || Boolean(next.set);
    setQuery(patch, { replace: !moved });
  }, [setQuery]);

  const root = (t: Tab) => go({ tab: t, cat: '', sub: '', set: '', view: '' });

  /** Where a queue card on the Overview lands. */
  const goQueue = (where: string) => {
    if (where === 'labels') return root('labels');
    // The holding pen is the words nobody can call, which live on a set's own
    // screen. Until a set exists to open, Pending is the nearest true thing —
    // and it says so rather than landing on an empty list.
    if (where === 'pen') return go({ tab: 'labels', cat: '', sub: '', set: '', view: 'pending' });
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
            <Press effect="none" onPress={() => root('runs')} accessibilityRole="button">
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
              canManage={canManage}
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

          {tab === 'categories' && sub && view === 'train' && train ? (
            <Train
              data={train}
              place={onePlace}
              mode={mode}
              onMode={setMode}
              busy={busy}
              canManage={canManage}
              onOpen={(ref) => { void api.filingPlace(ref).then(setOnePlace).catch(() => setOnePlace(null)); }}
              onNotSure={(refs, done) => void run('notsure', async () => {
                const out = await api.filingNotSure(sub, refs);
                // Only now. Saying it before the request lands loses the
                // selection and claims the work went through, so a refusal or
                // a dropped connection reads as a success (epic-f2, 21 Sep).
                done(out.said);
                return out.said;
              })}
              // The household *view*, not the back-office list. "See what a
              // household sees" landing on a table of rules was the button
              // saying one thing and doing another.
              onHousehold={() => go({ tab: 'rows', cat: '', sub: '', set: '', view: 'household' })}
              onSet={(ref, attribute, level) => void run(`${ref}:${attribute}`, async () => {
                const out = await api.filingSetPlace(ref, { attribute, value: { level } });
                if (onePlace?.place.ref === ref) setOnePlace(await api.filingPlace(ref));
                return out.said;
              })}
            />
          ) : null}

          {tab === 'categories' && sub && view !== 'places' && view !== 'train' && drawer ? (
            <SubcategoryBoard
              data={drawer}
              busy={busy}
              canManage={canManage}
              onPlaces={() => go({ view: 'places' })}
              onTrain={() => go({ view: 'train' })}
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

          {tab === 'labels' && !set ? (
            <View style={{ flexDirection: 'row' }}>
              {/*
                Persistent across all three Labels screens, as §6 specifies.
                Without it All labels was reachable only by typing the address
                and Pending had no entry point at all — which also left the
                front door's biggest number, the holding pen, landing on an
                empty Question sets list (the side-by-side audit, 21 Sep 2026).
              */}
              <SegStrip
                value={view === 'pending' ? 'pending' : view === 'vocabulary' ? 'vocabulary' : 'sets'}
                options={[
                  { key: 'sets', label: 'Question sets' },
                  { key: 'pending', label: `Pending${pending ? ` · ${pending.pending.length}` : ''}` },
                  { key: 'vocabulary', label: `All labels${vocabulary ? ` · ${vocabulary.counts.labels}` : ''}` },
                ]}
                onChange={(k) => go({ view: k === 'sets' ? '' : k })}
              />
            </View>
          ) : null}

          {tab === 'labels' && view === 'pending' && pending ? (
            <Pending
              words={pending.pending}
              sets={pending.sets}
              why={pending.why}
              counts={pending.counts}
              onApprove={() => said('Approving a word into a set is not wired yet.')}
              onMerge={() => said('Merging a word is not wired yet.')}
              onReject={() => said('Rejecting a word is not wired yet.')}
              onPark={() => said('Parking a word is not wired yet.')}
            />
          ) : null}

          {tab === 'labels' && !set && view !== 'vocabulary' && view !== 'pending' && labels ? (
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

          {tab === 'mapping' && view !== 'excluded' && mapping ? (
            <Words
              // Sorted here, because the table draws what it is given and the
              // header says which order it is in — a strip claiming "most
              // first" over an alphabetical list is worse than no sort at all.
              words={sortWords(mapping.words as WordRow[], sort, descending, filters)}
              counts={mapping.counts}
              evidence={mapping.evidence as never}
              sort={sort}
              desc={descending}
              onSort={(k, d) => { setSort(k); setDescending(d); }}
              filters={filters}
              onFilters={setFilters}
              filterOptions={filterOptionsFor(mapping)}
              undo={undo}
              picker={{
                // The rail is the same for every word; only the notes differ.
                categories: Object.values(dests)[0]?.categories ?? [],
                subcategoriesIn: (categoryKey: string, w: WordRow) =>
                  (dests[w.word]?.subcategories ?? []).filter((x) => x.category === categoryKey)
                    .map((x) => ({ ...x, on: w.pointsAt?.key === x.key })),
                labels: (w: WordRow) => (dests[w.word]?.labels ?? []).map((x) => ({ ...x, on: w.labels.includes(x.key) })),
                results: (q: string, w: WordRow) => {
                  const d = dests[w.word];
                  if (!d || !q.trim()) return [];
                  const needle = q.trim().toLowerCase();
                  return [...d.subcategories, ...d.labels]
                    .filter((x) => x.name.toLowerCase().includes(needle));
                },
                folds: (w: WordRow) => (dests[w.word]?.subcategories ?? []).slice(0, 3)
                  .map((x) => ({ key: x.key, name: x.name })),
                onOpen: (w: WordRow) => {
                  if (dests[w.word]) return;
                  void api.filingDestinations(w.word)
                    .then((d) => setDests((was) => ({ ...was, [w.word]: d })))
                    .catch(() => {});
                },
                onPoint: (w: WordRow, d: { key: string; kind: string }) => void point(w, d.kind === 'label'
                  ? { carry: d.key }
                  : { subcategory: d.key }),
                onNotInEpic: (w: WordRow) => void point(w, { decision: 'aside' }),
                onAdopt: () => said('Adopting a word as a new subcategory is not wired yet.'),
                onCarry: (w: WordRow, label: string) => void point(w, { carry: label }),
              }}
            />
          ) : null}

          {tab === 'mapping' && view === 'excluded' && excluded ? (
            <NotInEpic
              rows={excluded.excluded}
              placesKeptOut={excluded.counts.places}
              onRestore={() => said('Putting a word back is not wired yet')}
            />
          ) : null}

          {tab === 'rows' && rows ? (
            <View style={{ flexDirection: 'row' }}>
              {/*
                §17's household view was built in full — district switch, the
                first-heart question, Inspire with unhearted rows mixed in, the
                waiting row — and imported by nothing. One control turns dead
                code into the screen (the side-by-side audit, 21 Sep 2026).
              */}
              <SegStrip
                value={view === 'household' ? 'household' : 'rows'}
                options={[
                  { key: 'rows', label: `The rows · ${rows.rows.length}` },
                  { key: 'household', label: 'The household view' },
                ]}
                onChange={(k) => go({ view: k === 'household' ? 'household' : '' })}
              />
            </View>
          ) : null}

          {tab === 'rows' && view === 'household' && rows ? (
            <HouseholdView
              state={houseState}
              onState={setHouseState}
              districts={rows.districts}
              district={district || rows.districts[0]?.code || ''}
              onDistrict={setDistrict}
              rows={householdRows(rows, houseState, district || rows.districts[0]?.code || '', rows.minFill)}
              members={rows.members}
              owner={owner(rows, houseState)}
              minFill={rows.minFill}
              hearts={rows.rows.filter((r) => r.hearted).map((r) => ({
                id: r.id, title: r.title, who: r.heartedBy ?? 'somebody', days: r.heartedDays ?? 0,
              }))}
              onHeart={(id) => heartRow(id)}
              onOwner={() => said('Choosing whose list it is happens on the phone, not here.')}
            />
          ) : null}

          {tab === 'rows' && view !== 'household' && rows ? (
            <Rows
              rows={rows.rows}
              districts={rows.districts}
              minFill={rows.minFill ?? 4}
              household={rows.household?.name ?? 'this household'}
              filter={rowFilter}
              onFilter={setRowFilter}
              onHeart={heartRow}
              onEdit={(id, field, value) => {
                if (field === 'rule') {
                  // The shorthand is rendered from the rule; typing over it
                  // cannot set one. Saying so beats saving nothing and
                  // reporting success, which is the prototype's own failure.
                  said('A row\u2019s rule is set as structure, not by typing over its shorthand.');
                  return;
                }
                void run(id, async () => {
                  await api.adminFilingEditRow(id, { [field]: value });
                  return `${field === 'title' ? 'Title' : 'Copy line'} saved`;
                });
              }}
            />
          ) : null}

          {tab === 'rules' && rules ? (
            <Rules
              rows={rules.rules}
              total={rules.counts.rules}
              onRetire={(id) => void run(String(id), async () => {
                await api.adminFilingRetireRule(id);
                return 'The drawer stops saying it. Every place keeps what it says for itself.';
              })}
              onEdit={(rule) => {
                // A default is edited where it lives, which is the drawer — and
                // the drawer is read off the row rather than parsed out of the
                // id, so a rule that has no drawer says so instead of
                // navigating to a subcategory called "123".
                if (!rule.subcategory) {
                  said('That default is not attached to a drawer, so there is nowhere to edit it.');
                  return;
                }
                go({ tab: 'categories', cat: '', sub: rule.subcategory, set: '', view: '' });
              }}
            />
          ) : null}

          {tab === 'runs' ? (
            <View style={{ flexDirection: 'row' }}>
              <SegStrip
                value={view === 'decisions' ? 'decisions' : 'runs'}
                options={[
                  { key: 'runs', label: 'Runs' },
                  { key: 'decisions', label: `Decision log${decisions ? ` · ${decisions.decisions.length}` : ''}` },
                ]}
                onChange={(k) => go({ view: k === 'decisions' ? 'decisions' : '' })}
              />
            </View>
          ) : null}

          {tab === 'runs' && view !== 'decisions' && runs ? (
            <Runs
              headline={runs.headline}
              scope={runs.scope}
              triggers={runs.triggers}
              live={runs.live}
              runs={runs.runs}
              weeks={runs.weeks}
              clears={runs.clears}
              saturation={runs.saturation}
              onTrigger={() => said('Starting a run from here is not wired yet.')}
              onStop={() => said('Stopping a run from here is not wired yet.')}
              // The stage drill has no endpoint behind it yet. Saying so beats
              // an expander that opens on nothing.
              onOpenStage={() => said('Opening a stage is not built yet.')}
              stage={null}
              onStage={() => {}}
            />
          ) : null}

          {tab === 'runs' && view === 'decisions' && decisions ? (
            <DecisionLog
              rows={decisions.decisions}
              sets={decisions.sets}
              decision={decision}
              onDecision={setDecision}
              set={decisionSet}
              onSet={setDecisionSet}
              trailFor={(word) => {
                if (trails[word]) return trails[word];
                void api.adminFilingTrail(word)
                  .then((t) => setTrails((was) => ({ ...was, [word]: t.trail })))
                  .catch(() => {});
                return null;
              }}
            />
          ) : null}

          {/* The tabs whose screens are drawn but not yet fed. Saying which is
              better than a blank panel: a screen that is coming and a screen
              that is broken look identical otherwise. */}
          {notYet() ? (
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
/**
 * The rows the phone would show, in the order it would show them.
 *
 * Five states, and the ordering is the whole of what separates them. Inspire
 * is the one that matters: hearted rows rise, and **two or three unhearted
 * ones stay mixed in among them, never only at the bottom** — a list that
 * only ever shows you what you have already said yes to stops being a way of
 * finding anything.
 */
function householdRows(
  data: { rows: BrowseRowWithFill[]; minFill: number },
  state: HouseState,
  district: string,
  minFill: number,
) {
  const shelf = (r: BrowseRowWithFill) => ({
    ...r,
    shelf: (r.fill?.[district]?.places ?? []).slice(0, 3).map((name) => ({ name, photo: null })),
  });
  const waiting = (r: BrowseRowWithFill) => (r.fill?.[district]?.count ?? 0) < minFill;
  const hearted = data.rows.filter((r) => r.hearted);
  const cold = data.rows.filter((r) => !r.hearted);

  if (state === 'inspire') {
    const ready = hearted.filter((r) => !waiting(r));
    /**
     * Hearted rows rise, and unhearted ones stay *among* them.
     *
     * The handoff is specific that two or three sit mixed in rather than at
     * the bottom: a list that only ever shows you what you have already said
     * yes to has stopped being a way of finding anything.
     *
     * Counted off the insertion point and not off the list's length. The first
     * attempt indexed `cold` by `mixed.length - ready.length + 1`, so whether
     * an insertion happened at all depended on how many hearted rows there
     * were — with five, the first was skipped; with one, nothing mixed in
     * (Codex via epic-f2, 21 Sep 2026).
     */
    const AFTER = [1, 3, 5];
    const mixed: BrowseRowWithFill[] = [];
    let next = 0;
    ready.forEach((r, i) => {
      mixed.push(r);
      if (AFTER.includes(i) && cold[next]) mixed.push(cold[next++]);
    });
    // Where there were too few hearted rows to mix into, the rest follow — so
    // a household with one heart still gets a list rather than one row.
    return [...mixed, ...cold.slice(next, next + 3)].map(shelf);
  }
  if (state === 'thin') {
    const quiet = hearted.filter(waiting);
    return [...(quiet.length ? quiet : hearted.slice(0, 1)), ...hearted.filter((r) => !waiting(r)).slice(0, 2),
      ...cold.slice(0, 3)].map(shelf);
  }
  if (state === 'named') {
    return data.rows.filter((r) => /yourself|Jonah|Big kids|Older kids|Sneakily|Teenager/.test(r.title))
      .map(shelf);
  }
  return data.rows.slice(0, 14).map(shelf);
}

type BrowseRowWithFill = Parameters<typeof Rows>[0]['rows'][number];

/** Whose hearts these are — nobody, until the first-heart question is answered. */
function owner(data: { rows: { hearted: boolean; heartedById: string | null }[]; members: HouseMember[] }, state: HouseState) {
  // "First heart" is the state that exists to ask, so it deliberately has none.
  if (state === 'first') return null;
  const id = data.rows.find((r) => r.hearted)?.heartedById ?? null;
  return data.members.find((m) => m.id === id) ?? null;
}

function notYet(): boolean { return false; }

/**
 * The rows, filtered and in the order the header claims.
 *
 * A name sorts the opposite way round from a count — `desc` on a count is
 * most-first and on a word is Z to A — and one flag meaning both is how a
 * column comes to claim the opposite of what it shows (epic-f4's `say.ts`
 * makes the same point about `startsDescending`).
 */
function sortWords(words: WordRow[], sort: SortKey, desc: boolean, filters: { key: string }[]): WordRow[] {
  const keep = words.filter((w) => filters.every(({ key }) => {
    const [kind, val] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    if (kind === 'state') return w.decision === val;
    if (kind === 'flag') return w.flags.some((f) => f.key === val);
    if (kind === 'sub') return w.pointsAt?.key === val;
    return true;
  }));
  const way = desc ? -1 : 1;
  const text = (a: string, b: string) => a.localeCompare(b) * (desc ? -1 : 1);
  return [...keep].sort((a, b) => {
    if (sort === 'word') return text(a.word, b.word);
    if (sort === 'points') return text(a.pointsAt?.label ?? '', b.pointsAt?.label ?? '');
    if (sort === 'opens') return (a.opens - b.opens) * way;
    if (sort === 'flags') return ((a.flags.length - b.flags.length) * way) || (b.brings - a.brings);
    return (a.brings - b.brings) * way;
  });
}

/**
 * Everything the table can be filtered by, built from what it holds.
 *
 * States and flags come from the rows themselves rather than from a list kept
 * beside them, so a flag the audit stops raising stops being offered.
 */
function filterOptionsFor(m: { words: { decision: string; flags: { key: string; name: string; why: string }[]; pointsAt: { key: string; label: string } | null }[] }) {
  const states: { key: string; name: string; kind: string; note: string }[] = [
    { key: 'state:mapped', name: 'Answered', kind: 'STATE', note: 'points at a drawer' },
    { key: 'state:notsure', name: 'Not sure', kind: 'STATE', note: 'nobody has said' },
    { key: 'state:secondary', name: 'Kept as a label', kind: 'STATE', note: 'a fact, not a drawer' },
    { key: 'state:notinepic', name: 'Not in Epic', kind: 'STATE', note: 'kept out on purpose' },
  ].filter((s) => m.words.some((w) => `state:${w.decision}` === s.key
    || (s.key === 'state:mapped' && w.decision === 'mapped')));
  const flags = new Map<string, { key: string; name: string; kind: string; note: string }>();
  for (const w of m.words) {
    for (const f of w.flags) {
      if (!flags.has(f.key)) flags.set(f.key, { key: `flag:${f.key}`, name: f.name, kind: 'FLAG', note: f.why });
    }
  }
  const drawers = new Map<string, { key: string; name: string; kind: string; note: string }>();
  for (const w of m.words) {
    if (w.pointsAt && !drawers.has(w.pointsAt.key)) {
      drawers.set(w.pointsAt.key, {
        key: `sub:${w.pointsAt.key}`, name: w.pointsAt.label, kind: 'SUBCATEGORY',
        note: 'words pointing here',
      });
    }
  }
  return [...states, ...flags.values(), ...drawers.values()];
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
    if (view === 'train') out.push({ label: 'Train' });
  }
  if (tab === 'runs') {
    if (view === 'decisions') out.push({ label: 'Decision log' });
  }
  if (tab === 'labels') {
    if (set) out.push({ label: oneSet?.set.name ?? set });
    if (view === 'vocabulary') out.push({ label: 'All labels' });
    if (view === 'pending') out.push({ label: 'Pending' });
  }
  if (tab === 'mapping' && view === 'excluded') out.push({ label: 'Not in Epic' });
  // The last crumb is where you are, and is never a link.
  if (out.length) out[out.length - 1] = { label: out[out.length - 1].label };
  return out;
}
