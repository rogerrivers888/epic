/**
 * The picker — one control, used in two places.
 *
 * The handoff is explicit that this is a single component (§4): it is the
 * category screen's bulk control *and* the Mapping row's destination chooser,
 * and the two were drawn the same on purpose. Somebody who has learnt to point
 * one Google word at a drawer has learnt to point forty subcategories at a
 * label, and a second control shaped almost-but-not-quite the same is how that
 * stops being true.
 *
 * The thing it exists to do is **show the consequence before the click**. The
 * Mapping brief calls that "the single highest-value thing on this screen":
 *
 *     Landmarks & monuments — 1,240 in · 1,180 never opened · joins 3
 *
 * That line would have prevented most of the mess the redesign is cleaning up,
 * so `note` is required on every destination rather than optional. A picker
 * that cannot say what an option would do is not this component.
 *
 * Epic's half of it (Categories) is epic-fe's; Mapping's is mine. It lives
 * here rather than in either screen so neither owns it.
 */

import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { Icon } from '../../components/Icon';
import { Press } from '../../components/press';
import { LIME, ON_LIME, desk, fonts } from '../../theme';
import { Act, Kicker, Value } from './desk';

/** Something a pick could land on, and what landing there would do. */
export type Destination = {
  key: string;
  name: string;
  /** 'subcategory' or 'label' — what kind of thing it is; a label is drawn as a fact. */
  kind: string;
  /** The consequence, written server-side. Required, never optional. */
  note: string;
  /** Whether the note is bad news — "never opened" is drawn red. */
  grave?: boolean;
  /** Already picked. */
  on?: boolean;
};

/** A category on the left rail, and how many drawers are in it. */
export type PickCategory = { key: string; name: string; count: number };

/**
 * The field a picker is searched with. `outlineStyle` is web-only and is not in
 * react-native's style type, which is why it is cast here once rather than at
 * every input.
 */
const FIELD = {
  flex: 1,
  minWidth: 0,
  backgroundColor: 'transparent',
  color: desk.ink,
  fontFamily: fonts.body,
  fontSize: 13.5,
  fontWeight: '600',
  paddingVertical: 0,
  outlineStyle: 'none',
} as never;

export function Picker({
  width = 640,
  categories,
  subcategoriesIn,
  labels,
  results,
  query,
  onQuery,
  onPick,
  onClose,
  /** Mapping only: the two answers that are not a subcategory. */
  notInEpic,
  adopt,
}: {
  width?: number;
  categories: PickCategory[];
  /** The drawers in whichever category is showing, with their consequence lines. */
  subcategoriesIn: (categoryKey: string) => Destination[];
  labels: Destination[];
  /** What the search found, across subcategories and labels. */
  results: Destination[];
  query: string;
  onQuery: (q: string) => void;
  onPick: (d: Destination) => void;
  onClose: () => void;
  notInEpic?: { on: boolean; onPress: () => void };
  adopt?: {
    /** The word being adopted, so the panel can name what it would create. */
    word: string;
    /** Drawers it could be folded into instead, offered before creating. */
    folds: { key: string; name: string }[];
    onConfirm: () => void;
  };
}) {
  const [tab, setTab] = useState<'cat' | 'label'>('cat');
  const [cat, setCat] = useState<string>(categories[0]?.key ?? '');
  const [adopting, setAdopting] = useState(false);
  const searching = query.trim().length > 0;

  return (
    <View style={{
      width, flexGrow: 0, flexShrink: 0,
      borderWidth: 1, borderColor: desk.ruleStrong, backgroundColor: desk.well,
    }}>
      {/* Search across everything. Typing switches the panel to results. */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingVertical: 11, paddingHorizontal: 14,
        borderBottomWidth: 1, borderBottomColor: desk.rule,
      }}>
        <Icon name="search" size={14} color={desk.inkDim} />
        <TextInput
          value={query}
          onChangeText={onQuery}
          placeholder="Search every subcategory and fact"
          placeholderTextColor={desk.inkDim}
          style={FIELD}
        />
        <Value tone="dim" size={11.5}>
          {searching
            ? `${results.length} ${results.length === 1 ? 'match' : 'matches'}`
            : 'type to search'}
        </Value>
        <Act label="close" tone="dim" ruled={false} onPress={onClose} />
      </View>

      {searching ? (
        <View style={{ minHeight: 240, paddingVertical: 6 }}>
          {results.length === 0 ? (
            <View style={{ paddingVertical: 20, paddingHorizontal: 14 }}>
              <Value tone="dim" size={13}>Nothing by that name.</Value>
            </View>
          ) : null}
          {results.map((r) => (
            <Option key={`${r.kind}:${r.key}`} d={r} onPress={() => onPick(r)} nameWidth={230} kindWidth={110} />
          ))}
        </View>
      ) : (
        <>
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: desk.rule }}>
            <Tab label="Category" on={tab === 'cat'} onPress={() => setTab('cat')} />
            <Tab label="Fact" on={tab === 'label'} onPress={() => setTab('label')} bordered />
            {/*
              The two answers that are not a drawer. They sit on the tab strip
              rather than in the list because they are a different kind of
              answer: "this is not a day out" and "this is a new kind of day
              out" are both decisions about the taxonomy, not picks from it.
            */}
            {notInEpic || adopt ? (
              <View style={{
                flex: 1, flexDirection: 'row', alignItems: 'center',
                justifyContent: 'flex-end', gap: 16, paddingHorizontal: 14,
              }}>
                {notInEpic ? (
                  <Act label="Not in Epic" onPress={notInEpic.onPress}
                    tone={notInEpic.on ? 'lime' : 'ink'} ruled={notInEpic.on} />
                ) : null}
                {adopt ? (
                  <Act label="Adopt as new" tone="dim" ruled={false} onPress={() => setAdopting(true)} />
                ) : null}
              </View>
            ) : null}
          </View>

          {tab === 'cat' ? (
            <View style={{ flexDirection: 'row', alignItems: 'stretch', minHeight: 240 }}>
              <View style={{
                width: 210, flexGrow: 0, flexShrink: 0,
                borderRightWidth: 1, borderRightColor: desk.rule, paddingVertical: 6,
              }}>
                {categories.map((c) => {
                  const on = c.key === cat;
                  return (
                    <Press key={c.key} effect="none" onPress={() => setCat(c.key)} accessibilityRole="button"
                      accessibilityState={{ selected: on }}>
                      <View style={{
                        gap: 2, paddingVertical: 7, paddingHorizontal: 14,
                        backgroundColor: on ? desk.picked : 'transparent',
                      }}>
                        <Value size={13} weight={on ? '700' : '500'} tone={on ? 'ink' : 'muted'}>{c.name}</Value>
                        <Value size={11} tone="dim">
                          {`${c.count} ${c.count === 1 ? 'subcategory' : 'subcategories'}`}
                        </Value>
                      </View>
                    </Press>
                  );
                })}
              </View>
              <View style={{ flex: 1, minWidth: 0, paddingVertical: 6 }}>
                {subcategoriesIn(cat).map((d) => (
                  <Option key={d.key} d={d} onPress={() => onPick(d)} nameWidth={210} />
                ))}
              </View>
            </View>
          ) : (
            <View style={{
              flexDirection: 'row', flexWrap: 'wrap', alignContent: 'flex-start',
              minHeight: 240, paddingVertical: 10, paddingHorizontal: 6,
            }}>
              {labels.map((l) => (
                <Press key={l.key} effect="none" onPress={() => onPick(l)} accessibilityRole="button"
                  accessibilityState={{ selected: Boolean(l.on) }}
                  style={{ width: '33%' }}>
                  <View style={{
                    flexDirection: 'row', alignItems: 'center', gap: 10,
                    paddingVertical: 7, paddingHorizontal: 14,
                  }}>
                    <Mark on={Boolean(l.on)} />
                    <Value size={13} weight={l.on ? '700' : '500'} tone={l.on ? 'lime' : 'ink'}>{l.name}</Value>
                  </View>
                </Press>
              ))}
            </View>
          )}

          {/*
            Adopting needs friction. Thirteen one-word subcategories are the
            evidence that "adopt as new" being one click away is too cheap
            relative to excluding (Mapping brief §2.5), so it asks the question
            and offers folding first.
          */}
          {adopting && adopt ? (
            <View style={{
              gap: 12, padding: 15,
              borderTopWidth: 1, borderTopColor: desk.rule, backgroundColor: desk.picked,
            }}>
              <Value size={14} weight="800">Would a household browse this?</Value>
              <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkMuted, lineHeight: 18.75 }}>
                A subcategory is something someone scrolls to. If this is just where a word has to go,
                exclude it or file it under something broader.
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9, alignItems: 'center' }}>
                <Kicker>Fold into instead</Kicker>
                {adopt.folds.map((f) => (
                  <Press key={f.key} effect="none" accessibilityRole="button"
                    onPress={() => { setAdopting(false); onPick({ key: f.key, name: f.name, kind: 'subcategory', note: '' }); }}>
                    <View style={{ borderWidth: 1.5, borderColor: desk.ruleStrong, paddingVertical: 5, paddingHorizontal: 11 }}>
                      <Value size={12.5} weight="700" tone="muted">{f.name}</Value>
                    </View>
                  </Press>
                ))}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                <Press effect="sink" accessibilityRole="button"
                  onPress={() => { setAdopting(false); adopt.onConfirm(); }}>
                  <View style={{ backgroundColor: LIME, paddingVertical: 10, paddingHorizontal: 18 }}>
                    <Text style={{ fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: ON_LIME }}>
                      Yes · make it a subcategory
                    </Text>
                  </View>
                </Press>
                <Act label="cancel" tone="dim" ruled={false} onPress={() => setAdopting(false)} />
              </View>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

/** One destination, with what picking it would do. */
function Option({ d, onPress, nameWidth, kindWidth }: {
  d: Destination;
  onPress: () => void;
  nameWidth: number;
  kindWidth?: number;
}) {
  return (
    <Press effect="none" onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: Boolean(d.on) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7, paddingHorizontal: 14 }}>
        <Mark on={Boolean(d.on)} />
        <View style={{ width: nameWidth, flexGrow: 0, flexShrink: 0, minWidth: 0 }}>
          <Value size={13.5} weight={d.on ? '700' : '500'} tone={d.on ? 'lime' : 'ink'}>{d.name}</Value>
        </View>
        {kindWidth ? (
          <View style={{ width: kindWidth, flexGrow: 0, flexShrink: 0 }}>
            <Value size={12} tone="dim">{d.kind}</Value>
          </View>
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Value size={11.5} tone={d.grave ? 'warn' : 'dim'}>{d.note}</Value>
        </View>
      </View>
    </Press>
  );
}

function Tab({ label, on, onPress, bordered }: { label: string; on: boolean; onPress: () => void; bordered?: boolean }) {
  return (
    <Press effect="none" onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: on }}>
      <View style={{
        paddingVertical: 11, paddingHorizontal: 28,
        backgroundColor: on ? LIME : 'transparent',
        borderLeftWidth: bordered ? 1 : 0, borderLeftColor: desk.rule,
      }}>
        <Text style={{
          fontFamily: fonts.body, fontSize: 13, fontWeight: on ? '700' : '600',
          color: on ? ON_LIME : desk.inkDim,
        }}>
          {label}
        </Text>
      </View>
    </Press>
  );
}

/** Picked or not: a tick where it is, a plus where it could be. */
function Mark({ on }: { on: boolean }) {
  return (
    <View style={{ width: 14, flexGrow: 0, flexShrink: 0 }}>
      <Icon name={on ? 'check' : 'add'} size={13} color={on ? LIME : desk.ink} />
    </View>
  );
}
