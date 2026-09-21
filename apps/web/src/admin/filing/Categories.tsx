/**
 * Categories → a category → a drawer → its places.
 *
 * The drill-down the taxonomy is actually worked through, and the one screen
 * in the desk where a person changes what Epic believes rather than where it
 * files things.
 *
 * Three things here are load-bearing and easy to draw away:
 *
 *   - **Outline is proposed, filled is set.** A default worked out from the
 *     places in a drawer is not the same as one somebody agreed to, and the
 *     shape of the control is where that difference lives. Accepting is its
 *     own action precisely because it changes no value.
 *   - **A drawer whose places disagree has no answer**, and is not offered
 *     one. It is collapsed into the Excluded line, which names the labels the
 *     places argue about. Castles are neither indoors nor out.
 *   - **An empty drawer reads as a problem, in red.** Nothing filling a
 *     subcategory is a mapping gap, not a fact about Britain — five of them
 *     used to read "nothing fills it yet" in the same grey as everything else.
 */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Press } from '../../components/press';
import { Icon } from '../../components/Icon';
import { desk, fonts, LIME } from '../../theme';
import {
  Act, Alarm, Band, Cell, DeskButton, DeskPill, DeskSection, Head, Kicker,
  LimeOutline, Link, Mark, Nothing, Row, Steps, TickBox, Value, WARN, tabular, type Col,
} from './desk';
import { Picker, type Destination, type PickCategory } from './Picker';
import { TextInput } from 'react-native';
import type {
  FilingAnswer, FilingCategories, FilingCategory, FilingPlaces, FilingSubcategory,
} from '../../api';

// ---------------------------------------------------------------------------
// The categories table
// ---------------------------------------------------------------------------

const CAT_COLS: Col[] = [
  { w: 260, label: 'Category' },
  { w: 130, label: 'Subcats', align: 'right' },
  { w: 110, label: 'Places', align: 'right' },
  { w: 'auto', label: 'Question sets' },
  { w: 150, label: 'To review', align: 'right' },
];

export function CategoryList({ data, onOpen }: {
  data: FilingCategories;
  onOpen: (key: string) => void;
}) {
  return (
    <>
      <Band
        title="Categories"
        stats={[
          { label: 'CATEGORIES', value: data.counts.categories },
          { label: 'SUBCATEGORIES', value: data.counts.subcategories },
          { label: 'PLACES', value: data.counts.places.toLocaleString() },
          { label: 'VALUES TO REVIEW', value: data.counts.review.toLocaleString(), strong: true },
        ]}
      />
      <View>
        <Head cols={CAT_COLS} />
        {data.categories.length === 0 ? <Nothing>Nothing here yet.</Nothing> : null}
        {data.categories.map((c) => (
          <Row key={c.key} onPress={() => onOpen(c.key)}>
            <Cell col={CAT_COLS[0]}><Link onPress={() => onOpen(c.key)}>{c.label}</Link></Cell>
            <Cell col={CAT_COLS[1]}><Value numeric>{c.subs}</Value></Cell>
            <Cell col={CAT_COLS[2]}><Value numeric>{c.places.toLocaleString()}</Value></Cell>
            <Cell col={CAT_COLS[3]}>
              <Value tone="muted" size={12.5}>{c.sets.length ? c.sets.join(' · ') : '—'}</Value>
            </Cell>
            <Cell col={CAT_COLS[4]}>
              <Value tone={c.review ? 'lime' : 'dim'} weight="700" size={13}>
                {c.review ? `${c.review} values` : 'none'}
              </Value>
            </Cell>
          </Row>
        ))}
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// One category
// ---------------------------------------------------------------------------

const SUB_COLS: Col[] = [
  { w: 20 },
  { w: 250, label: 'Subcategory' },
  { w: 270, label: 'Also in' },
  { w: 90, label: 'Places', align: 'right' },
  { w: 'auto', label: 'Labels' },
  { w: 130, label: 'To review', align: 'right' },
];

export function CategoryBoard({ data, canManage, busy, picker, onOpen, onAdd, onApply }: {
  data: FilingCategory;
  canManage: boolean;
  busy: string | null;
  /** The shared control (§4), fed for this category. */
  picker: {
    categories: PickCategory[];
    subcategoriesIn: (categoryKey: string) => Destination[];
    labels: Destination[];
    results: (query: string) => Destination[];
  };
  onOpen: (key: string) => void;
  onAdd: (label: string) => void;
  onApply: (subcategories: string[], picks: { kind: string; key: string }[]) => void;
}) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [picks, setPicks] = useState<Destination[]>([]);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const tick = (key: string) => setTicked((was) => {
    const next = new Set(was);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <>
      <Band
        title={data.category.label}
        stats={[
          { label: 'SUBCATEGORIES', value: data.counts.subcategories },
          { label: 'PLACES', value: data.counts.places.toLocaleString() },
          { label: 'TICKED', value: ticked.size, strong: ticked.size > 0 },
        ]}
      />

      {/*
        The bulk control, which only exists once something is ticked. Picks
        land as pills and the summary says what is about to happen in words —
        "applied 3" is not a sentence anybody can check against what they meant.
      */}
      {ticked.size ? (
        <>
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 20,
            borderTopWidth: 2, borderTopColor: LIME,
            borderBottomWidth: 1, borderBottomColor: desk.rule,
            backgroundColor: desk.lifted, paddingVertical: 13, paddingHorizontal: 8, minHeight: 56,
          }}>
            <Value weight="800">{ticked.size} ticked</Value>
            <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {picks.length === 0 ? (
                <Value tone="dim" size={13}>Pick below — they land here as pills</Value>
              ) : picks.map((p) => (
                <DeskPill key={`${p.kind}:${p.key}`} name={p.name} kind={p.kind === 'label' ? 'label' : 'sub'}
                  onRemove={() => setPicks((was) => was.filter((x) => x.key !== p.key))} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, flexGrow: 0, flexShrink: 0 }}>
              <DeskButton
                label={picks.length ? `Apply to ${ticked.size}` : 'Apply'}
                disabled={!canManage || !picks.length || Boolean(busy)}
                onPress={() => { onApply([...ticked], picks.map((p) => ({ kind: p.kind, key: p.key }))); setPicks([]); }}
              />
              <Act label="×" tone="dim" ruled={false} onPress={() => { setTicked(new Set()); setPicks([]); }} />
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: 24, alignItems: 'flex-start' }}>
            <Picker
              width={660}
              categories={picker.categories}
              subcategoriesIn={(k) => picker.subcategoriesIn(k).map((x) => ({ ...x, on: picks.some((p) => p.key === x.key) }))}
              labels={picker.labels.map((x) => ({ ...x, on: picks.some((p) => p.key === x.key) }))}
              results={picker.results(query)}
              query={query}
              onQuery={setQuery}
              onPick={(d) => setPicks((was) => (was.some((p) => p.key === d.key) ? was : [...was, d]))}
              onClose={() => setPicks([])}
            />
            <View style={{ flex: 1, minWidth: 0, gap: 10 }}>
              <Kicker>ABOUT TO LAND</Kicker>
              <Value tone="muted" size={12.5}>{aboutToLand(picks, [...ticked], data)}</Value>
            </View>
          </View>
        </>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        {adding ? (
          <>
            <TextInput
              value={name}
              onChangeText={setName}
              autoFocus
              placeholder="Name the subcategory"
              placeholderTextColor={desk.inkDim}
              onSubmitEditing={() => { if (name.trim()) { onAdd(name.trim()); setName(''); setAdding(false); } }}
              onKeyPress={(e) => { if ((e as unknown as { nativeEvent: { key: string } }).nativeEvent.key === 'Escape') { setAdding(false); setName(''); } }}
              style={{
                width: 300, backgroundColor: desk.well, borderWidth: 1.5, borderColor: LIME,
                color: desk.ink, fontFamily: fonts.body, fontSize: 13.5, fontWeight: '600',
                paddingVertical: 10, paddingHorizontal: 12,
              }}
            />
            <DeskButton label="Add it" disabled={!name.trim()}
              onPress={() => { onAdd(name.trim()); setName(''); setAdding(false); }} />
            <Act label="cancel" tone="dim" ruled={false} onPress={() => { setAdding(false); setName(''); }} />
          </>
        ) : canManage ? (
          <LimeOutline label="Add a subcategory" plus onPress={() => setAdding(true)} />
        ) : null}
        {data.subcategories.length ? (
          <>
            <Act
              label={ticked.size === data.subcategories.length ? 'Clear the ticks' : `Tick all ${data.subcategories.length}`}
              tone="ink"
              onPress={() => setTicked(ticked.size === data.subcategories.length
                ? new Set()
                : new Set(data.subcategories.map((s) => s.key)))}
            />
            <Value tone="dim" size={12}>click a row to tick it · the name opens it</Value>
          </>
        ) : null}
      </View>

      <View>
        <Head cols={SUB_COLS} />
        {data.subcategories.length === 0 ? <Nothing>Nothing here yet.</Nothing> : null}
        {data.subcategories.map((s) => (
          <Row key={s.key} align="flex-start" padded={false} lifted={ticked.has(s.key)}>
            <View style={{ flexDirection: 'row', gap: 18, flex: 1, paddingVertical: 12 }}>
              <Cell col={SUB_COLS[0]}>
                <TickBox on={ticked.has(s.key)} onPress={() => tick(s.key)} />
              </Cell>
              <Cell col={SUB_COLS[1]}>
                <Link onPress={() => onOpen(s.key)}>{s.label}</Link>
                {s.words.length ? (
                  <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: desk.inkDim, marginTop: 3 }}>
                    {s.words.slice(0, 2).join(' · ')}
                    {s.words.length > 2 ? ` and ${s.words.length - 2} more` : ''}
                  </Text>
                ) : null}
              </Cell>
              <Cell col={SUB_COLS[2]}>
                <Value tone="muted" size={12.5}>{s.alsoIn.length ? s.alsoIn.join(' · ') : '—'}</Value>
              </Cell>
              <Cell col={SUB_COLS[3]}><Value numeric>{s.places.toLocaleString()}</Value></Cell>
              <Cell col={SUB_COLS[4]}>
                {/* An empty drawer is a mapping gap and has to look like one. */}
                {s.empty ? (
                  <Value tone="warn" weight="700" size={12.5}>nothing fills it — a mapping gap</Value>
                ) : (
                  <Value tone="muted" size={12.5}>{s.labels.length ? s.labels.join(' · ') : 'nothing set'}</Value>
                )}
              </Cell>
              <Cell col={SUB_COLS[5]}>
                <Value tone={s.review ? 'lime' : 'dim'} weight="700" size={12.5}>
                  {s.review ? `${s.review} to review` : 'all set'}
                </Value>
              </Cell>
            </View>
          </Row>
        ))}
      </View>
    </>
  );
}

/**
 * What is about to happen, in words.
 *
 * "Applied 3" is not a sentence anybody can check against what they meant, and
 * a bulk action is exactly where being wrong is expensive. A label becomes a
 * default on every ticked drawer; a drawer means the *cabinet* that drawer is
 * in, because "Also in" holds categories and not other drawers.
 */
function aboutToLand(picks: Destination[], ticked: string[], data: FilingCategory): string {
  if (!picks.length) return 'Nothing picked yet. Ticked rows show what is about to land, in lime.';
  const names = ticked.map((k) => data.subcategories.find((s) => s.key === k)?.label ?? k);
  const said = picks.map((p) => (p.kind === 'label'
    ? `${p.name} set on ${names.length === 1 ? names[0] : `${names.length} drawers`}`
    : `${names.length === 1 ? names[0] : `${names.length} drawers`} also listed wherever ${p.name} is`));
  return said.join(' · ');
}

// ---------------------------------------------------------------------------
// One drawer
// ---------------------------------------------------------------------------

const RULE_COLS: Col[] = [
  { w: 250 },
  { w: 130, align: 'right' },
  { w: 130, align: 'right' },
  { w: 'auto' },
  { w: 200, align: 'right' },
];

export function SubcategoryBoard({ data, busy, canManage, onAccept, onFlip, onAcceptAll, onPlaces, onTrain, onSet, onStrike, onMap }: {
  data: FilingSubcategory;
  busy: string | null;
  /**
   * Without it the screen is a reading of the taxonomy rather than a way of
   * changing it. Every write here needs `manage_library`, so offering the
   * controls to somebody who only has `view_library` buys them a 403 for
   * their trouble (Codex, 20 Sep 2026).
   */
  canManage: boolean;
  onAccept: (attribute: string) => void;
  onFlip: (attribute: string) => void;
  onAcceptAll: () => void;
  onPlaces: () => void;
  onTrain: () => void;
  onSet: (key: string) => void;
  onStrike: (word: string) => void;
  onMap: (word: string) => void;
}) {
  const [openRule, setOpenRule] = useState<string | null>(null);
  const s = data.subcategory;

  return (
    <>
      <Band
        title={s.label}
        sub={ruleSummary(data)}
        stats={[
          { label: 'PLACES', value: s.places.toLocaleString() },
          { label: 'PROPOSED', value: s.proposed, strong: true },
        ]}
        right={s.set ? (
          <Press effect="none" onPress={() => onSet(s.set!.key)} accessibilityRole="button">
            <Text style={{ fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: desk.ink }}>
              {s.set.name ?? s.set.key}
            </Text>
          </Press>
        ) : (
          <Text style={{ fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: desk.inkDim }}>
            no question set
          </Text>
        )}
      />

      <DeskSection kicker={`WHAT FILLS IT · ${data.rules.length} ${data.rules.length === 1 ? 'RULE' : 'RULES'}`}>
        {s.places === 0 ? (
          <Alarm title="Nothing fills it — that is a mapping gap, not a fact about Britain">
            {data.likely.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9, alignItems: 'center' }}>
                <Kicker>LIKELY TYPES</Kicker>
                {data.likely.map((t) => (
                  <Press key={t.word} effect="sink" onPress={() => onMap(t.word)} accessibilityRole="button">
                    <View style={{ borderWidth: 1.5, borderColor: LIME, paddingVertical: 5, paddingHorizontal: 11 }}>
                      <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: LIME }}>
                        {t.word} · {t.brings.toLocaleString()} places
                      </Text>
                    </View>
                  </Press>
                ))}
              </View>
            ) : (
              // An empty list is a real answer and has to be said. Five orphans
              // came back with nothing to suggest, and a silent gap where the
              // chips should be reads as a screen that failed to load.
              <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkMuted }}>
                Nothing unanswered looks like it belongs here. Either the type Google uses for it is
                already pointed somewhere else, or there is not one.
              </Text>
            )}
          </Alarm>
        ) : null}

        <View>
          {data.rules.map((r) => (
            <View key={r.id} style={{ borderBottomWidth: 1, borderBottomColor: desk.rule }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18, paddingVertical: 10 }}>
                <Cell col={RULE_COLS[0]}>
                  <Press effect="none" onPress={() => setOpenRule(openRule === r.id ? null : r.id)}
                         accessibilityRole="button">
                    <Text style={{ fontFamily: fonts.body, fontSize: 13.5, fontWeight: '600', color: desk.ink }}>
                      {r.words.join(' · ') || r.label}
                    </Text>
                  </Press>
                </Cell>
                <Cell col={RULE_COLS[1]}><Value numeric>{r.brings.toLocaleString()}</Value></Cell>
                <Cell col={RULE_COLS[2]}>
                  {/* Red only where never-opened is a fact about the rule. Below
                      the corpus floor it is a fact about the product's age, and
                      every row would wear it. */}
                  <Value tone={r.opens === 0 && data.demandReadable ? 'warn' : 'muted'} numeric size={13}>
                    {r.opens ? `${r.opens.toLocaleString()} opened`
                      : data.demandReadable ? 'never opened' : 'no opens to read yet'}
                  </Value>
                </Cell>
                <Cell col={RULE_COLS[3]} />
                <Cell col={RULE_COLS[4]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                    <Act
                      label={openRule === r.id ? 'hide what it brought' : 'what it brought'}
                      tone="dim" ruled={false}
                      onPress={() => setOpenRule(openRule === r.id ? null : r.id)}
                    />
                    {canManage ? (
                      <Act label="Strike it" tone="warn" onPress={() => onStrike(r.words[0] ?? r.subject)} />
                    ) : null}
                  </View>
                </Cell>
              </View>
              {openRule === r.id ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 15 }}>
                  {r.brought.length === 0 ? (
                    <Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim }}>
                      It has brought nothing in.
                    </Text>
                  ) : r.brought.map((p) => (
                    <View key={p.ref} style={{ borderWidth: 1, borderColor: desk.ruleStrong, paddingVertical: 4, paddingHorizontal: 9 }}>
                      <Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkMuted }}>
                        {/* A place we have not researched has no name we may print. */}
                        {p.name ?? 'not researched yet'}
                      </Text>
                    </View>
                  ))}
                  {r.brings > r.brought.length ? (
                    <Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim, paddingVertical: 4, paddingHorizontal: 4 }}>
                      and {(r.brings - r.brought.length).toLocaleString()} more
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          ))}
          {data.rules.length === 0 && s.places > 0 ? (
            <Nothing>No rule points here, yet places are filed here — they arrived another way.</Nothing>
          ) : null}
        </View>
      </DeskSection>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20 }}>
        <DeskButton label={`Train · ${data.disagreeing.length} to look at`} onPress={onTrain} />
        <DeskButton label={`All ${s.places.toLocaleString()} places`} tone="outline" onPress={onPlaces} />
        {s.set ? (
          <DeskButton label={`Question set · ${s.set.name ?? s.set.key}`} tone="outline" onPress={() => onSet(s.set!.key)} />
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', gap: 36, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 0, gap: 14 }}>
          <DeskSection
            kicker="DEFAULTS · PROPOSED FROM THE PLACES THAT HAVE VALUES"
            right={<Value tone="dim" size={11.5}>accept, correct or skip</Value>}
          >
            <View>
              {data.facets.map((f) => (
                <FacetRow key={f.key} a={f} busy={busy === f.key} canManage={canManage}
                          onAccept={onAccept} onFlip={onFlip} />
              ))}
              {data.facets.length === 0 ? <Nothing>Nothing to propose here yet.</Nothing> : null}
            </View>
          </DeskSection>

          {/* The labels the places argue about, named rather than offered. */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingTop: 6, paddingBottom: 2 }}>
            <View style={{ width: 150, flexGrow: 0, flexShrink: 0 }}>
              <Value tone="dim" weight="600" size={13}>Excluded · {data.excluded.length}</Value>
            </View>
            <View style={{ flex: 1 }}>
              <Value tone="dim" size={12.5}>
                {data.excluded.length
                  ? `${data.excluded.map((e) => e.label).join(' · ')} — the places disagree, so each answers`
                  : 'nothing — the places agree on everything'}
              </Value>
            </View>
          </View>

          <DeskSection kicker="THE EIGHT · OUTLINE IS PROPOSED, FILLED IS SET">
            <View>
              {data.axes.map((a) => (
                <AxisRow key={a.key} a={a} busy={busy === a.key} canManage={canManage} onAccept={onAccept} />
              ))}
            </View>
          </DeskSection>

          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 18,
            borderTopWidth: 2,
            borderTopColor: desk.ruleStrong,
            paddingTop: 15,
          }}>
            <DeskButton
              label={s.proposed ? `Accept all ${s.proposed}` : 'Nothing to accept'}
              disabled={!canManage || !s.proposed || busy === 'all'}
              onPress={onAcceptAll}
            />
            <Value tone="muted" size={12.5}>
              {data.disagreeing.filter((d) => d.human).length} places keep what a human set
            </Value>
          </View>
        </View>

        <View style={{
          width: 420,
          flexGrow: 0,
          flexShrink: 0,
          gap: 13,
          borderLeftWidth: 1,
          borderLeftColor: desk.rule,
          paddingLeft: 30,
        }}>
          <DeskSection
            kicker={`WHAT DISAGREES · ${data.disagreeing.length}`}
            right={<Value tone="dim" size={11.5}>of {s.places.toLocaleString()}</Value>}
          >
            <View>
              {data.disagreeing.length === 0 ? (
                <Nothing>Nothing argues with the defaults.</Nothing>
              ) : data.disagreeing.slice(0, 8).map((p) => (
                <View key={p.ref} style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                  paddingVertical: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: desk.rule,
                }}>
                  <View style={{ width: 66, height: 46, flexGrow: 0, flexShrink: 0, backgroundColor: desk.picked }} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Value weight="700" size={13}>{p.name ?? 'not researched yet'}</Value>
                    <View style={{ marginTop: 2 }}>
                      <Value tone={p.human ? 'warn' : 'muted'} size={12}>
                        {p.diff}{p.more ? ` · and ${p.more} more` : ''}
                      </Value>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </DeskSection>
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 16,
            borderTopWidth: 1,
            borderTopColor: desk.rule,
            paddingTop: 13,
          }}>
            <Link onPress={onPlaces} weight="700">All {s.places.toLocaleString()} places</Link>
            <Value tone="dim" size={12}>
              {data.splitting ? 'a lot of disagreement — this may want splitting' : 'the defaults are holding'}
            </Value>
          </View>
        </View>
      </View>
    </>
  );
}

/**
 * "from Google: golf_course", and only when it really is from Google.
 *
 * A drawer is filled by rules of several scopes — a provider's word, a
 * Wikidata kind, one of our own labels — and the first draft of this stripped
 * every namespace and called the lot Google, so a golf drawer announced
 * itself as "from Google: Q2022036". Naming the wrong source is worse than
 * naming none.
 */
function ruleSummary(data: FilingSubcategory): string {
  const google = data.rules
    .flatMap((r) => r.labels)
    .filter((l) => l.startsWith('google:'))
    .map((l) => l.slice('google:'.length));
  if (google.length) {
    const shown = google.slice(0, 3).join(', ');
    return `from Google: ${shown}${google.length > 3 ? `, and ${google.length - 3} more` : ''}`;
  }
  const rules = data.rules.length;
  if (!rules) return 'no rule points here';
  return `${rules} ${rules === 1 ? 'rule fills it' : 'rules fill it'}, none of them a Google type`;
}

function FacetRow({ a, busy, canManage, onAccept, onFlip }: {
  a: FilingAnswer; busy: boolean; canManage: boolean;
  onAccept: (k: string) => void; onFlip: (k: string) => void;
}) {
  const nothing = !a.value;
  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 16,
      paddingVertical: 11,
      borderBottomWidth: 1,
      borderBottomColor: desk.rule,
    }}>
      <View style={{ width: 150, flexGrow: 0, flexShrink: 0 }}>
        <Value weight="600" size={13}>{a.label}</Value>
      </View>
      <View style={{ width: 150, flexGrow: 0, flexShrink: 0 }}>
        {/* Lime until somebody has agreed to it, then it is simply the answer. */}
        <Value tone={nothing ? 'dim' : a.settled ? 'ink' : 'lime'} weight="700">{a.said}</Value>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Value tone="dim" size={11.5}>{a.why}</Value>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flexGrow: 0, flexShrink: 0 }}>
        {nothing || a.settled || !canManage ? (
          <Value tone="dim" size={12.5}>{a.settled ? 'set' : a.proposed ? 'proposed' : ''}</Value>
        ) : (
          <>
            <Act label={busy ? 'accepting…' : 'Accept'} onPress={busy ? undefined : () => onAccept(a.key)} />
            {a.kind === 'yesno' ? (
              <Act label="flip it" tone="dim" ruled={false} onPress={busy ? undefined : () => onFlip(a.key)} />
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

function AxisRow({ a, busy, canManage, onAccept }: {
  a: FilingAnswer; busy: boolean; canManage: boolean; onAccept: (k: string) => void;
}) {
  const level = a.value?.level ?? null;
  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      paddingVertical: 9,
      borderBottomWidth: 1,
      borderBottomColor: desk.rule,
    }}>
      <View style={{ width: 200, flexGrow: 0, flexShrink: 0 }}>
        <Value weight="600" size={13}>{a.label}</Value>
        {a.anchor ? (
          <Text style={{ fontFamily: fonts.body, fontSize: 11, color: desk.inkDim, marginTop: 2 }}>{a.anchor}</Text>
        ) : null}
      </View>
      <Steps value={level} settled={a.settled} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Value tone={a.settled || !a.value ? 'dim' : 'lime'} size={11.5}>{a.why}</Value>
      </View>
      <View style={{ flexGrow: 0, flexShrink: 0 }}>
        {a.value && !a.settled && canManage ? (
          <Act label={busy ? 'accepting…' : 'Accept'} onPress={busy ? undefined : () => onAccept(a.key)} />
        ) : (
          <Value tone="dim" size={12.5}>{a.settled ? 'set' : a.proposed ? 'proposed' : ''}</Value>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Every place in a drawer
// ---------------------------------------------------------------------------

const PLACE_COLS: Col[] = [
  { w: 60 },
  { w: 300 },
  { w: 180 },
  { w: 'auto' },
  { w: 150, align: 'right' },
];

export function PlacesBoard({ data, label }: { data: FilingPlaces; label: string }) {
  return (
    <>
      <Band title={`${data.counts.places.toLocaleString()} ${data.counts.places === 1 ? 'place' : 'places'}`} sub={label} />
      <View>
        {data.places.length === 0 ? <Nothing>Nothing is filed here.</Nothing> : null}
        {data.places.map((p) => (
          <Row key={p.ref}>
            <Cell col={PLACE_COLS[0]}>
              <View style={{ width: 60, height: 42, backgroundColor: desk.picked }} />
            </Cell>
            <Cell col={PLACE_COLS[1]}>
              <Value weight="700">{p.name ?? 'not researched yet'}</Value>
            </Cell>
            <Cell col={PLACE_COLS[2]}><Value tone="dim" size={12.5}>{p.town ?? '—'}</Value></Cell>
            <Cell col={PLACE_COLS[3]}>
              <Value tone="muted" size={12.5}>{p.summary.join(' · ')}</Value>
            </Cell>
            <Cell col={PLACE_COLS[4]}>
              <Value tone={p.human ? 'lime' : 'dim'} weight="700" size={12}>
                {p.human ? 'a human answered' : p.answered ? 'defaults' : 'never asked'}
              </Value>
            </Cell>
          </Row>
        ))}
      </View>
    </>
  );
}
