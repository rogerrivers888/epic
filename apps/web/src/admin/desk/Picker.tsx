/**
 * The desk's picker — one control, two uses (design README v2, 28 Sep 2026):
 *
 *   - **Mapping**: where a Google word points. Search, Category / Fact tabs,
 *     exactly one PRIMARY pinned at the top, "Make primary" on hover, the
 *     primary cannot be unticked, ticking does not close it, and the last line
 *     of the subcategory list is "+ Create a new subcategory", which asks
 *     "Would a household browse this?" first. No impact figures in rows, no
 *     Exclude and no "What this word carries" in here.
 *   - **Collections**: "Which places" — search plus Category / Subcategory /
 *     Fact tabs, each a three-column grid of ticks.
 *
 * Sizes, weights and paddings are the prototype's (`isMapping` picker and the
 * collection editor's). The marks are icons, never a ✓ or + character.
 */

import React, { useMemo, useState } from 'react';
import { Platform, Text, TextInput, View, type ViewStyle } from 'react-native';

import { Icon } from '../../components/Icon';
import { Press } from '../../components/press';
import { useViewport } from '../../hooks/useViewport';
import { LIME, ON_LIME, desk, fonts } from '../../theme';

const web = Platform.OS === 'web';
const noOutline = web ? ({ outlineStyle: 'none' } as object) : null;

/** What the pickers choose from: `GET /mapping/picker`. */
export type Catalogue = {
  categories: { key: string; label: string }[];
  subcategories: { key: string; label: string; category: string }[];
  facts: { key: string; label: string; kind: string; standard?: boolean }[];
};

// ---------------------------------------------------------------------------
// Pieces both pickers share

/** A tick or a plus, 14px wide, lime when on. */
function Mark({ on }: { on: boolean }) {
  return (
    <View style={{ width: 14, alignItems: 'center' }}>
      <Icon name={on ? 'check' : 'add'} size={13} color={on ? LIME : desk.ink} />
    </View>
  );
}

/** The search line across the top: magnifier, the field, a note and "close". */
function SearchLine({ value, onChange, placeholder, note, onClose }: {
  value: string; onChange: (v: string) => void; placeholder: string; note?: string; onClose?: () => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: desk.rule }}>
      <Icon name="search" size={14} color={desk.inkDim} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={desk.inkDim}
        style={[{ flex: 1, minWidth: 0, color: desk.ink, fontFamily: fonts.body, fontSize: 13.5, fontWeight: '600', padding: 0 }, noOutline]}
      />
      {note ? <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: desk.inkDim }}>{note}</Text> : null}
      {onClose ? (
        <Press effect="none" onPress={onClose}>
          <Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim }}>close</Text>
        </Press>
      ) : null}
    </View>
  );
}

/** The tab strip inside a picker: lime when chosen, a hairline between. */
function PickTabs<T extends string>({ tabs, value, onChange, pad }: { tabs: { key: T; name: string }[]; value: T; onChange: (t: T) => void; pad: number }) {
  return (
    <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: desk.rule }}>
      {tabs.map((t, i) => {
        const on = t.key === value;
        return (
          <Press key={t.key} effect="none" onPress={() => onChange(t.key)}>
            <Text style={{
              paddingVertical: pad === 28 ? 11 : 10, paddingHorizontal: pad, fontFamily: fonts.body, fontSize: 13,
              fontWeight: on ? '700' : '600', backgroundColor: on ? LIME : 'transparent', color: on ? ON_LIME : desk.inkDim,
              borderLeftWidth: i ? 1 : 0, borderLeftColor: desk.rule,
            }}>{t.name}</Text>
          </Press>
        );
      })}
    </View>
  );
}

/** A three-column grid of ticks (the Fact tab, and every Collections tab). */
function TickGrid({ items, isOn, onToggle, narrow }: {
  items: { key: string; label: string }[]; isOn: (key: string) => boolean; onToggle: (key: string) => void; narrow: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 10, paddingHorizontal: 6, minHeight: 200, alignContent: 'flex-start' }}>
      {items.map((o) => {
        const on = isOn(o.key);
        return (
          <Press key={o.key} effect="none" onPress={() => onToggle(o.key)} style={{ width: narrow ? '50%' : '33%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, paddingHorizontal: 14 }}>
              <Mark on={on} />
              <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 13, fontWeight: on ? '700' : '500', color: on ? LIME : desk.ink }}>{o.label}</Text>
            </View>
          </Press>
        );
      })}
    </View>
  );
}

/** A search result: mark, name, and what kind of thing it is. */
function ResultRow({ on, name, kind, onPress, nameWidth }: { on: boolean; name: string; kind: string; onPress: () => void; nameWidth: number }) {
  return (
    <Press effect="none" onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 14 }}>
        <Mark on={on} />
        <Text style={{ width: nameWidth, fontFamily: fonts.body, fontSize: 13.5, fontWeight: '600', color: on ? LIME : desk.ink }}>{name}</Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim }}>{kind}</Text>
      </View>
    </Press>
  );
}

const box: ViewStyle = { borderWidth: 1, borderColor: desk.ruleStrong, backgroundColor: desk.well, maxWidth: '100%' };
const match = (q: string) => (s: string) => s.toLowerCase().includes(q);

// ---------------------------------------------------------------------------
// Mapping: where one Google word points

export type WordPickerProps = {
  word: string;
  catalogue: Catalogue;
  /** The word's subcategories, primary first. */
  subs: string[];
  primary: string | null;
  /** The facts the word carries. */
  facts: string[];
  query: string;
  onQuery: (q: string) => void;
  onToggleSub: (key: string) => void;
  onMakePrimary: (key: string) => void;
  onToggleFact: (key: string) => void;
  /** "Yes · make it a subcategory": name and category, after the question. */
  onCreate: (label: string, category: string) => void;
  onClose: () => void;
};

const humanise = (w: string) => w.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function WordPicker(p: WordPickerProps) {
  const vw = useViewport().width;
  const narrow = vw < 900;
  const [tab, setTab] = useState<'cat' | 'fact'>('cat');
  const primaryCat = p.catalogue.subcategories.find((s) => s.key === p.primary)?.category ?? null;
  const [cat, setCat] = useState<string | null>(primaryCat ?? p.catalogue.categories[0]?.key ?? null);
  const [hover, setHover] = useState<string | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [newName, setNewName] = useState(humanise(p.word));
  const q = p.query.trim().toLowerCase();

  const subsOf = useMemo(() => {
    const m = new Map<string, Catalogue['subcategories']>();
    for (const s of p.catalogue.subcategories) m.set(s.category, [...(m.get(s.category) ?? []), s]);
    return m;
  }, [p.catalogue.subcategories]);
  // A word can only carry a yes: the Fact tab offers yes-or-no facts.
  const yesno = useMemo(() => p.catalogue.facts.filter((f) => f.kind === 'yesno'), [p.catalogue.facts]);
  const primaryName = p.catalogue.subcategories.find((s) => s.key === p.primary)?.label ?? null;
  const catName = p.catalogue.categories.find((c) => c.key === cat)?.label ?? '';

  const results = q ? [
    ...p.catalogue.categories.filter((c) => match(q)(c.label)).map((c) => ({ key: `c:${c.key}`, name: c.label, kind: 'category', on: c.key === primaryCat, go: () => { setCat(c.key); setTab('cat'); p.onQuery(''); } })),
    ...p.catalogue.subcategories.filter((s) => match(q)(s.label)).map((s) => ({ key: `s:${s.key}`, name: s.label, kind: 'subcategory', on: p.subs.includes(s.key), go: () => p.onToggleSub(s.key) })),
    ...yesno.filter((f) => match(q)(f.label)).map((f) => ({ key: `f:${f.key}`, name: f.label, kind: 'fact', on: p.facts.includes(f.key), go: () => p.onToggleFact(f.key) })),
  ] : [];

  return (
    // On a phone the picker sits inside a table that scrolls sideways, so it is
    // sized to the screen rather than to the table.
    <View style={[box, { width: narrow ? Math.min(640, vw - 48) : 640 }]}>
      <SearchLine value={p.query} onChange={p.onQuery} placeholder="Search every subcategory and fact" note={q ? 'searching' : 'type to search'} onClose={p.onClose} />
      {q ? (
        <View style={{ minHeight: 240, paddingVertical: 6 }}>
          {results.map((r) => <ResultRow key={r.key} on={r.on} name={r.name} kind={r.kind} onPress={r.go} nameWidth={narrow ? 170 : 230} />)}
          {!results.length ? <Text style={{ paddingVertical: 9, paddingHorizontal: 14, fontFamily: fonts.body, fontSize: 13, color: desk.inkDim }}>Nothing called that.</Text> : null}
        </View>
      ) : (
        <>
          <PickTabs tabs={[{ key: 'cat', name: 'Category' }, { key: 'fact', name: 'Fact' }]} value={tab} onChange={setTab} pad={28} />
          {tab === 'cat' ? (
            <>
              {primaryName ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingVertical: 9, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: desk.rule, backgroundColor: desk.lifted }}>
                  <Mark on />
                  <Text style={{ width: narrow ? undefined : 210, fontFamily: fonts.body, fontSize: 13.5, fontWeight: '800', color: desk.ink }}>{primaryName}</Text>
                  <PrimaryTag />
                  <View style={{ flex: 1 }} />
                  <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: desk.inkDim }}>to change it, hover another ticked subcategory</Text>
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'stretch', minHeight: 240 }}>
                <View style={{ width: narrow ? 130 : 210, borderRightWidth: 1, borderRightColor: desk.rule, paddingVertical: 6 }}>
                  {p.catalogue.categories.map((c) => {
                    const on = c.key === cat;
                    const n = subsOf.get(c.key)?.length ?? 0;
                    return (
                      <Press key={c.key} effect="none" onPress={() => setCat(c.key)}>
                        <View style={{ gap: 2, paddingVertical: 7, paddingHorizontal: 14, backgroundColor: on ? desk.picked : 'transparent' }}>
                          <Text style={{ fontFamily: fonts.body, fontSize: 13, fontWeight: on ? '700' : '500', color: on ? desk.ink : desk.inkMuted }}>{c.label}</Text>
                          <Text style={{ fontFamily: fonts.body, fontSize: 11, color: desk.inkDim }}>{n} {n === 1 ? 'subcategory' : 'subcategories'}</Text>
                        </View>
                      </Press>
                    );
                  })}
                </View>
                <View style={{ flex: 1, minWidth: 0, paddingVertical: 6 }}>
                  {(subsOf.get(cat ?? '') ?? []).map((s) => {
                    const on = p.subs.includes(s.key);
                    const isPrimary = on && p.primary === s.key;
                    const key = s.key;
                    return (
                      <Press
                        key={key}
                        effect="none"
                        onHoverIn={web ? () => setHover(key) : undefined}
                        onHoverOut={web ? () => setHover((h) => (h === key ? null : h)) : undefined}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7, paddingHorizontal: 14 }}>
                          {/* The tick is the mark and the name; the primary cannot be unticked — to take a word out of Epic, use Exclude. */}
                          <Press effect="none" style={{ flex: 1, minWidth: 0 }} onPress={isPrimary ? undefined : () => p.onToggleSub(key)}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                              <Mark on={on} />
                              <Text style={{ flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 13.5, fontWeight: on ? '800' : '500', color: on ? LIME : desk.ink }}>{s.label}</Text>
                            </View>
                          </Press>
                          {isPrimary ? <PrimaryTag /> : null}
                          {/* "Make primary" on hover only (a tap on a phone shows it too, as there is no hover). */}
                          {on && !isPrimary && (hover === key || !web) ? (
                            <Press effect="none" onPress={() => p.onMakePrimary(key)}>
                              <Text style={{ fontFamily: fonts.body, fontSize: 11.5, fontWeight: '700', color: desk.inkMuted, borderBottomWidth: 1, borderBottomColor: desk.ruleStrong }}>Make primary</Text>
                            </Press>
                          ) : null}
                        </View>
                      </Press>
                    );
                  })}
                  <Press effect="none" onPress={() => setAdopting(true)}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 14, marginTop: 4, borderTopWidth: 1, borderTopColor: desk.rule }}>
                      <View style={{ width: 14, alignItems: 'center' }}><Icon name="add" size={13} color={desk.inkDim} /></View>
                      <Text style={{ fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: desk.inkMuted }}>Create a new subcategory</Text>
                    </View>
                  </Press>
                </View>
              </View>
            </>
          ) : (
            <TickGrid items={yesno} isOn={(k) => p.facts.includes(k)} onToggle={p.onToggleFact} narrow={narrow} />
          )}
        </>
      )}
      {adopting ? (
        <View style={{ gap: 12, padding: 15, borderTopWidth: 1, borderTopColor: desk.rule, backgroundColor: desk.picked }}>
          <Text style={{ fontFamily: fonts.body, fontSize: 14, fontWeight: '800', color: desk.ink }}>Would a household browse this?</Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkMuted, lineHeight: 18.75 }}>
            A subcategory is something someone scrolls to. If this is just where a word has to go, exclude it or file it under something broader.
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9, alignItems: 'center' }}>
            <Text style={{ fontFamily: fonts.body, fontSize: 11.5, fontWeight: '700', letterSpacing: 0.69, color: desk.inkDim }}>FOLD INTO INSTEAD</Text>
            {(subsOf.get(cat ?? '') ?? []).filter((s) => !p.subs.includes(s.key)).slice(0, 3).map((s) => (
              <Press key={s.key} effect="none" onPress={() => { setAdopting(false); p.onToggleSub(s.key); }}>
                <Text style={{ borderWidth: 1.5, borderColor: desk.ruleStrong, color: desk.inkMuted, fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', paddingVertical: 5, paddingHorizontal: 11 }}>{s.label}</Text>
              </Press>
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="Its name"
              placeholderTextColor={desk.inkDim}
              style={[{ width: 260, maxWidth: '100%', backgroundColor: desk.well, borderWidth: 1, borderColor: desk.ruleStrong, color: desk.ink, fontFamily: fonts.body, fontSize: 13, fontWeight: '600', paddingVertical: 7, paddingHorizontal: 9 }, noOutline]}
            />
            <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>in {catName}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <Press effect="none" disabled={!newName.trim() || !cat} onPress={() => { if (newName.trim() && cat) { setAdopting(false); p.onCreate(newName.trim(), cat); } }}>
              <Text style={{ backgroundColor: newName.trim() ? LIME : desk.off, color: newName.trim() ? ON_LIME : desk.inkDim, paddingVertical: 10, paddingHorizontal: 18, fontFamily: fonts.body, fontSize: 13, fontWeight: '700' }}>Yes · make it a subcategory</Text>
            </Press>
            <Press effect="none" onPress={() => setAdopting(false)}>
              <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>cancel</Text>
            </Press>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** PRIMARY, ink on lime, 10.5px/800. */
function PrimaryTag() {
  return (
    <Text style={{ fontFamily: fonts.body, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.525, color: ON_LIME, backgroundColor: LIME, paddingVertical: 2, paddingHorizontal: 6 }}>PRIMARY</Text>
  );
}

// ---------------------------------------------------------------------------
// Collections: which places a rule gathers

export type RuleKind = 'cats' | 'subs' | 'facts';

export function RulePicker({ catalogue, isOn, onToggle }: {
  catalogue: Catalogue; isOn: (kind: RuleKind, key: string) => boolean; onToggle: (kind: RuleKind, key: string) => void;
}) {
  const narrow = useViewport().width < 900;
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<RuleKind>('cats');
  const s = q.trim().toLowerCase();
  // A rule asks a fact is yes (or, with "not", that it is not): yes-or-no facts only.
  const facts = useMemo(() => catalogue.facts.filter((f) => f.kind === 'yesno'), [catalogue.facts]);
  const subs = useMemo(() => [...catalogue.subcategories].sort((a, b) => a.label.localeCompare(b.label)), [catalogue.subcategories]);
  const lists: Record<RuleKind, { key: string; label: string }[]> = { cats: catalogue.categories, subs, facts };
  const KIND: Record<RuleKind, string> = { cats: 'category', subs: 'subcategory', facts: 'fact' };
  const results = s
    ? (['cats', 'subs', 'facts'] as RuleKind[]).flatMap((k) => lists[k].filter((o) => match(s)(o.label)).map((o) => ({ k, o }))).slice(0, 14)
    : [];
  return (
    <View style={[box, { width: narrow ? '100%' : 640 }]}>
      <SearchLine value={q} onChange={setQ} placeholder="Search categories, subcategories and facts" />
      {s ? (
        <View style={{ minHeight: 200, paddingVertical: 6 }}>
          {results.map(({ k, o }) => <ResultRow key={`${k}:${o.key}`} on={isOn(k, o.key)} name={o.label} kind={KIND[k]} onPress={() => onToggle(k, o.key)} nameWidth={narrow ? 170 : 240} />)}
          {!results.length ? <Text style={{ paddingVertical: 8, paddingHorizontal: 14, fontFamily: fonts.body, fontSize: 13, color: desk.inkDim }}>Nothing called that.</Text> : null}
        </View>
      ) : (
        <>
          <PickTabs tabs={[{ key: 'cats', name: 'Category' }, { key: 'subs', name: 'Subcategory' }, { key: 'facts', name: 'Fact' }]} value={tab} onChange={setTab} pad={24} />
          <TickGrid items={lists[tab]} isOn={(k) => isOn(tab, k)} onToggle={(k) => onToggle(tab, k)} narrow={narrow} />
        </>
      )}
    </View>
  );
}
