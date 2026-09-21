/**
 * Train — teaching one place at a time.
 *
 * Three ways of doing the same job, because the job has three shapes. **Sweep**
 * is one place and one question at a time, which is what you want when the
 * answer needs looking at. **Grid** is twelve at once with the wrong ones
 * tapped out, which is faster when most are right. **Inspect** is everything
 * about one place, which is where you go when a place is odd rather than when
 * the drawer is.
 *
 * The panel beside a sweep matters more than it looks. "A human set this"
 * means somebody has already been here and the drawer disagrees — worth
 * reading before overruling. "No rule matched" means the value is the
 * drawer's and nobody has ever checked it, and that one is drawn in red,
 * because a number nobody has looked at is the thing this screen exists to
 * find.
 */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Press } from '../../components/press';
import { desk, fonts, LIME, ON_LIME } from '../../theme';
import { Act, Band, DeskButton, DeskSection, Kicker, Nothing, SegStrip, Steps, Value, WARN } from './desk';
import type { FilingTrain, FilingPlace } from '../../api';

type Mode = 'sweep' | 'grid' | 'inspect';

export function Train({ data, place, mode, onMode, busy, canManage, onSet, onOpen, onHousehold }: {
  data: FilingTrain;
  /** The place Inspect is showing, fetched separately because it is a page of its own. */
  place: FilingPlace | null;
  mode: Mode;
  onMode: (m: Mode) => void;
  busy: string | null;
  canManage: boolean;
  onSet: (ref: string, attribute: string, level: number) => void;
  onOpen: (ref: string) => void;
  onHousehold: () => void;
}) {
  const [at, setAt] = useState(0);
  const [wrong, setWrong] = useState<Set<string>>(new Set());

  const queue = data.queue;
  const current = queue[Math.min(at, Math.max(0, queue.length - 1))] ?? null;
  const ask = current?.asks[0] ?? null;

  return (
    <>
      <Band
        title={`Train · ${data.subcategory.label}`}
        sub={`${queue.length} of ${data.subcategory.places.toLocaleString()} places have something worth looking at`}
        right={(
          <SegStrip
            value={mode}
            options={[
              { key: 'sweep' as Mode, label: 'Sweep' },
              { key: 'grid' as Mode, label: 'Grid' },
              { key: 'inspect' as Mode, label: 'Inspect' },
            ]}
            onChange={onMode}
          />
        )}
      />

      {mode === 'sweep' ? (
        queue.length === 0 || !current || !ask ? (
          <Nothing>Nothing here argues with the drawer. There is nothing to teach.</Nothing>
        ) : (
          <View style={{ flexDirection: 'row', gap: 36, alignItems: 'flex-start' }}>
            <View style={{ flex: 1, minWidth: 0, gap: 18 }}>
              <View style={{ flexDirection: 'row', gap: 18, alignItems: 'flex-start' }}>
                <View style={{ width: 180, height: 126, backgroundColor: desk.picked, flexGrow: 0, flexShrink: 0 }} />
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <Text style={{ fontFamily: fonts.heading, fontSize: 22, fontWeight: '800', letterSpacing: -0.44, color: desk.ink }}>
                    {current.name ?? 'not researched yet'}
                  </Text>
                  <Value tone="dim" size={12.5}>{current.town ?? 'we do not hold where it is'}</Value>
                  {current.facts.length ? (
                    <View style={{ marginTop: 4 }}>
                      <Value tone="muted" size={12.5}>{current.facts.join(' · ')}</Value>
                    </View>
                  ) : null}
                </View>
              </View>

              <DeskSection kicker={ask.label.toUpperCase()}>
                <Value tone="dim" size={12}>{ask.anchor ?? ''}</Value>
                <View style={{ marginTop: 10 }}>
                  <Text style={{ fontFamily: fonts.body, fontSize: 13.5, fontWeight: '700', color: desk.ink }}>
                    {ask.level == null ? 'We have no idea.' : `We think ${ask.level}.`}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                  {[0, 1, 2, 3, 4].map((n) => (
                    <Press key={n} effect="sink" accessibilityRole="button"
                           onPress={canManage && !busy ? () => {
                             onSet(current.ref, ask.key, n);
                             setAt((i) => i + 1);
                           } : undefined}>
                      <View style={{
                        width: 86,
                        paddingVertical: 16,
                        alignItems: 'center',
                        borderWidth: 1.5,
                        borderColor: n === ask.level ? LIME : desk.ruleStrong,
                        backgroundColor: n === ask.level ? LIME : 'transparent',
                      }}>
                        <Text style={{
                          fontFamily: fonts.heading,
                          fontSize: 20,
                          fontWeight: '800',
                          color: n === ask.level ? ON_LIME : desk.ink,
                        }}>
                          {n}
                        </Text>
                      </View>
                    </Press>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', gap: 20, marginTop: 16, alignItems: 'center' }}>
                  <Act label="Skip" tone="dim" ruled={false} onPress={() => setAt((i) => i + 1)} />
                  <Act label="Back" tone="dim" ruled={false} onPress={() => setAt((i) => Math.max(0, i - 1))} />
                  <Value tone="dim" size={12}>{Math.min(at + 1, queue.length)} of {queue.length}</Value>
                </View>
              </DeskSection>
            </View>

            <View style={{
              width: 380, flexGrow: 0, flexShrink: 0, gap: 12,
              borderLeftWidth: 1, borderLeftColor: desk.rule, paddingLeft: 30,
            }}>
              <Kicker>WHAT WE THOUGHT, AND WHY</Kicker>
              <Text style={{
                fontFamily: fonts.body, fontSize: 13, lineHeight: 20,
                color: ask.tone === 'warn' ? WARN : LIME,
              }}>
                {ask.why}
              </Text>
              {current.asks.length > 1 ? (
                <Value tone="dim" size={12}>
                  {current.asks.length - 1} more {current.asks.length === 2 ? 'question' : 'questions'} about this place
                </Value>
              ) : null}
              <View style={{ marginTop: 8 }}>
                <Act label="Everything about this place" onPress={() => { onOpen(current.ref); onMode('inspect'); }} />
              </View>
            </View>
          </View>
        )
      ) : null}

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
            <DeskButton
              label={`Confirm the other ${Math.max(0, data.grid.length - wrong.size)}`}
              disabled={!canManage || data.grid.length === 0}
              onPress={() => setWrong(new Set())}
            />
            <Value tone="dim" size={12.5}>
              {wrong.size
                ? `${wrong.size} marked as not belonging here`
                : 'nothing marked — confirming says the drawer is right about all twelve'}
            </Value>
          </View>
        </>
      ) : null}

      {mode === 'inspect' ? (
        place ? <Inspect place={place} busy={busy} canManage={canManage} onSet={onSet} onHousehold={onHousehold} />
          : <Nothing>Pick a place from Sweep or the drawer&rsquo;s list to look at it.</Nothing>
      ) : null}
    </>
  );
}

/** Everything about one place, and the three states an answer can be in. */
function Inspect({ place, busy, canManage, onSet, onHousehold }: {
  place: FilingPlace;
  busy: string | null;
  canManage: boolean;
  onSet: (ref: string, attribute: string, level: number) => void;
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

        <DeskSection kicker="THE EIGHT · FILLED IS SOMEBODY&rsquo;S OWN ANSWER">
          {place.axes.map((a) => (
            <View key={a.key} style={{
              flexDirection: 'row', alignItems: 'center', gap: 16,
              paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: desk.rule,
            }}>
              <View style={{ width: 200, flexGrow: 0, flexShrink: 0 }}>
                <Value weight="600" size={13}>{a.label}</Value>
                {a.anchor ? (
                  <Text style={{ fontFamily: fonts.body, fontSize: 11, color: desk.inkDim, marginTop: 2 }}>{a.anchor}</Text>
                ) : null}
              </View>
              <Steps
                value={a.value?.level ?? null}
                settled={a.mine}
                human={a.from === 'a person'}
                onPick={canManage && !busy ? (n) => onSet(place.place.ref, a.key, n) : undefined}
              />
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
          kicker={place.set ? `ASKED OF EVERY ${place.place.subcategory?.label.toUpperCase() ?? 'PLACE'}` : 'NOTHING IS ASKED HERE'}
          right={place.set ? <Value tone="dim" size={11.5}>{place.set.name}</Value> : undefined}
        >
          {place.questions.length === 0 ? (
            <Nothing>
              No question set is attached to this drawer, so nothing is asked of the places in it.
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
