/**
 * Train — a drawer, a screenful at a time.
 *
 * Two ways of doing the same job. **Grid** is twelve at once with the wrong
 * ones tapped out, which is fast when most are right. **Inspect** is
 * everything about one place, which is where you go when a place is odd
 * rather than when the drawer is.
 *
 * There used to be a third, **Sweep**: one place and one of the eight graded
 * axes at a time, "we think 3". It went with the eight (the axes brief,
 * 25 Sep 2026). A number a person puts on how thrilling somewhere is cannot be
 * extracted from text and is not a fact about the place, so there is nothing
 * left for a sweep to ask. What a place says for itself is now read off its
 * question set, on the right of Inspect.
 */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Press } from '../../components/press';
import { desk, fonts } from '../../theme';
import { Act, Band, DeskButton, DeskSection, Nothing, SegStrip, Value, WARN } from './desk';
import type { FilingTrain, FilingPlace } from '../../api';

type Mode = 'grid' | 'inspect';

export function Train({ data, place, mode, onMode, busy, canManage, onNotSure, onOpen, onHousehold }: {
  data: FilingTrain;
  /** The place Inspect is showing, fetched separately because it is a page of its own. */
  place: FilingPlace | null;
  mode: Mode;
  onMode: (m: Mode) => void;
  busy: string | null;
  canManage: boolean;
  /**
   * The ones a person says do not belong here, off to the not-sure list.
   *
   * `done` is called only when they have actually gone. Clearing the selection
   * and saying so on the click loses the work and claims it succeeded if the
   * request is refused (epic-f2, 21 Sep 2026).
   */
  onNotSure: (refs: string[], done: (said: string) => void) => void;
  onOpen: (ref: string) => void;
  onHousehold: () => void;
}) {
  const [wrong, setWrong] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState<string | null>(null);

  return (
    <>
      <Band
        title={`Train · ${data.subcategory.label}`}
        sub={`${data.subcategory.places.toLocaleString()} places filed here`}
        right={(
          <SegStrip
            value={mode}
            options={[
              { key: 'grid' as Mode, label: 'Grid' },
              { key: 'inspect' as Mode, label: 'Inspect' },
            ]}
            onChange={onMode}
          />
        )}
      />

      {mode === 'grid' ? (
        <>
          <Value tone="dim" size={12.5}>
            Tap the ones that are not {data.subcategory.label.toLowerCase()}. The rest are confirmed together.
          </Value>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
            {data.grid.map((p) => {
              const off = wrong.has(p.ref);
              return (
                <Press key={p.ref} effect="sink" accessibilityRole="checkbox"
                       accessibilityState={{ checked: off }}
                       onPress={() => setWrong((s) => {
                         const next = new Set(s);
                         if (next.has(p.ref)) next.delete(p.ref); else next.add(p.ref);
                         return next;
                       })}>
                  <View style={{ width: 210, gap: 6, opacity: off ? 0.4 : 1 }}>
                    <View style={{
                      height: 132,
                      backgroundColor: desk.picked,
                      borderWidth: 2,
                      borderColor: off ? WARN : 'transparent',
                    }} />
                    <Value weight="700" size={13} tone={off ? 'warn' : 'ink'}>
                      {p.name ?? 'not researched yet'}
                    </Value>
                    <Value tone="dim" size={12}>{off ? 'not this' : p.town ?? ''}</Value>
                  </View>
                </Press>
              );
            })}
            {data.grid.length === 0 ? <Nothing>Nothing is filed here yet.</Nothing> : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
            {/*
              The button does the half that is real. Marking a place as not
              belonging sends it to the not-sure list, where somewhere else
              decides where it should go. Confirming the rest writes nothing,
              because there is nowhere to write it — and a button that reported
              a bulk decision it had not made would be worse than no button
              (Codex, 21 Sep 2026).
            */}
            <DeskButton
              label={wrong.size ? `Send ${wrong.size} back to Not sure` : 'Nothing marked'}
              disabled={!canManage || wrong.size === 0 || Boolean(busy)}
              onPress={() => onNotSure([...wrong], (said) => { setSent(said); setWrong(new Set()); })}
            />
            <Value tone="dim" size={12.5}>
              {sent ?? (wrong.size
                ? `${wrong.size} will go to Not sure, where where-they-belong is decided`
                : 'tap the ones that are not this, and they go to Not sure')}
            </Value>
            {data.grid.length ? (
              <Act label="Look at one" tone="dim" ruled={false}
                   onPress={() => { onOpen(data.grid[0].ref); onMode('inspect'); }} />
            ) : null}
          </View>
        </>
      ) : null}

      {mode === 'inspect' ? (
        place ? <Inspect place={place} onHousehold={onHousehold} />
          : <Nothing>Pick a place from the grid or the drawer&rsquo;s list to look at it.</Nothing>
      ) : null}
    </>
  );
}

/** Everything about one place: what it inherits, and what it has been asked. */
function Inspect({ place, onHousehold }: {
  place: FilingPlace;
  onHousehold: () => void;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 36, alignItems: 'flex-start' }}>
      <View style={{ flex: 1, minWidth: 0, gap: 18 }}>
        <View style={{ flexDirection: 'row', gap: 18, alignItems: 'flex-start' }}>
          <View style={{ width: 150, height: 105, backgroundColor: desk.picked, flexGrow: 0, flexShrink: 0 }} />
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text style={{ fontFamily: fonts.heading, fontSize: 22, fontWeight: '800', letterSpacing: -0.44, color: desk.ink }}>
              {place.place.name ?? 'not researched yet'}
            </Text>
            <Value tone="dim" size={12.5}>
              {[place.place.town, place.place.subcategory?.label].filter(Boolean).join(' · ')}
            </Value>
          </View>
        </View>

        {/* What the place carries, and where each answer came from: a person,
            what we hold, or the drawer it is filed in. */}
        <DeskSection kicker="WHAT IT CARRIES · FROM THE PLACE, WHAT WE HOLD, OR THE DRAWER">
          {place.facets.length === 0 ? (
            <Nothing>Nothing is set on this place or its drawer yet.</Nothing>
          ) : place.facets.map((a) => (
            <View key={a.key} style={{
              flexDirection: 'row', alignItems: 'baseline', gap: 16,
              paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: desk.rule,
            }}>
              <View style={{ width: 200, flexGrow: 0, flexShrink: 0 }}>
                <Value weight="600" size={13}>{a.label}</Value>
              </View>
              <View style={{ width: 120, flexGrow: 0, flexShrink: 0 }}>
                <Value weight="700" size={13} tone={a.value ? 'ink' : 'dim'}>{a.said}</Value>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Value tone={a.from === 'a person' ? 'ink' : 'dim'} size={11.5}>
                  {a.from ? `from ${a.from}` : 'nobody has said'}
                </Value>
              </View>
            </View>
          ))}
        </DeskSection>
      </View>

      <View style={{
        width: 420, flexGrow: 0, flexShrink: 0, gap: 13,
        borderLeftWidth: 1, borderLeftColor: desk.rule, paddingLeft: 30,
      }}>
        <DeskSection
          kicker={place.set
            ? `ASKED OF EVERY ${place.place.subcategory?.label.toUpperCase() ?? 'PLACE'}`
            : place.questions.length ? 'ASKED OF EVERY PLACE' : 'NOTHING IS ASKED HERE'}
          right={place.set ? <Value tone="dim" size={11.5}>{place.set.name}</Value>
            : place.questions.length ? <Value tone="dim" size={11.5}>the global questions only</Value> : undefined}
        >
          {place.questions.length === 0 ? (
            <Nothing>
              No question set is attached to this drawer, so only the global questions are asked of the places in it — and there are none yet.
            </Nothing>
          ) : place.questions.map((q) => (
            <View key={q.id} style={{
              paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: desk.rule, gap: 2,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Value weight="600" size={13}>{q.name}</Value>
                </View>
                {/* Three states, and the middle one is the point: nothing found
                    is a real answer — three sources read and none mentioned it
                    — and a different fact from never having asked. */}
                <Value
                  weight={q.state === 'answered' ? '800' : '500'}
                  tone={q.state === 'answered' ? 'ink' : q.state === 'nothing' ? 'dim' : 'faint'}
                >
                  {q.said}
                </Value>
              </View>
              <Value tone="dim" size={11.5}>{q.source}</Value>
            </View>
          ))}
        </DeskSection>

        <View style={{ borderTopWidth: 1, borderTopColor: desk.rule, paddingTop: 13 }}>
          <Act label="See what a household sees" onPress={onHousehold} />
        </View>
      </View>
    </View>
  );
}
