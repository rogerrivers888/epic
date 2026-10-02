/**
 * One-off's own steps (hosting v7 · U1, N2): When, the running order, and
 * What guests tell you. Prototype lines 154–200; the guest side of each toggle
 * is drawn by Preview.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Press } from '../../../../components/press';
import { Icon } from '../../../../components/Icon';
import { CREAM, DEEP_GREEN, HAIRLINE, INACTIVE, INK, INK_MUTED, LIME, LIME_TINT } from '../../../../theme';
import { AddLink, Count, DateBox, Kicker, Labelled, TimeBox, ToggleRow, Tick, TickChip, pointer, tx, hx, v } from '../kit';
import { DIET_WORDS, DAY_SHORT, at, dayWords, dowOf, plusDays, type GuestQuestions, type LaneOffer } from '../model';
import type { StepProps } from '../Setup';

const noOutline = { outlineStyle: 'none' } as object;

/** The event's days: one, or day 1 … day N. */
export function eventDays(o: Pick<LaneOffer, 'startsOn' | 'multiDay' | 'endsOn'>, cap = 4): string[] {
  if (!o.startsOn) return [];
  if (!o.multiDay || !o.endsOn) return [o.startsOn];
  const out: string[] = [];
  for (let d = o.startsOn; d <= o.endsOn && out.length < cap; d = plusDays(d, 1)) out.push(d);
  return out;
}

// ---------------------------------------------------------------------------
// When is it?
// ---------------------------------------------------------------------------

export function WhenStep({ offer, update, config }: StepProps) {
  const days = eventDays(offer, config.oneoffMaxDays);
  const setStart = (d: string) => {
    // Keep the number of days when the start moves.
    const span = offer.multiDay && offer.startsOn && offer.endsOn ? Math.round((at(offer.endsOn).getTime() - at(offer.startsOn).getTime()) / 86400000) : 0;
    update({ startsOn: d, ...(offer.multiDay ? { endsOn: plusDays(d, Math.max(1, span)) } : {}) });
  };
  const flipMulti = () => update(offer.multiDay ? { multiDay: false, endsOn: null } : { multiDay: true, endsOn: offer.startsOn ? plusDays(offer.startsOn, 2) : null });
  const moreDay = () => {
    if (!offer.startsOn) return;
    const n = days.length;
    update({ endsOn: n < config.oneoffMaxDays ? plusDays(offer.startsOn, n) : plusDays(offer.startsOn, 1) });
  };
  return (
    <>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Labelled label={offer.multiDay ? 'Start date' : 'Date'} style={{ flex: 1.3 }}>
          <DateBox value={offer.startsOn} words={dayWords(offer.startsOn)} onPick={setStart} />
        </Labelled>
        <Labelled label="From"><TimeBox value={offer.startsAt} onChange={(t) => update({ startsAt: t })} /></Labelled>
      </View>
      <ToggleRow title="Runs over more than one day" on={offer.multiDay} onFlip={flipMulti} />
      {offer.multiDay ? (
        <>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Labelled label="End date" style={{ flex: 1.3 }}>
              <DateBox value={offer.endsOn} words={dayWords(offer.endsOn)} from={offer.startsOn ? plusDays(offer.startsOn, 1) : undefined}
                allow={(d) => !offer.startsOn || (d > offer.startsOn && d <= plusDays(offer.startsOn, config.oneoffMaxDays - 1))} onPick={(d) => update({ endsOn: d })} />
            </Labelled>
            <Labelled label="Until"><TimeBox value={offer.endsAt} onChange={(t) => update({ endsAt: t })} /></Labelled>
          </View>
          {days.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {days.map((d, i) => (
                <View key={d} style={{ width: '32%', flexGrow: 1, backgroundColor: LIME_TINT, paddingVertical: 8, paddingHorizontal: 10 }}>
                  <Text style={[v.kicker, { fontSize: 10.5, letterSpacing: 0.53, color: DEEP_GREEN }]}>Day {i + 1}</Text>
                  <Text style={hx(17, -0.02, 1.2)}>{dayWords(d)}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {offer.startsOn ? (
            <Press onPress={moreDay} accessibilityRole="button" style={pointer}>
              <Text style={v.link}>{days.length < config.oneoffMaxDays ? '+ Add a day' : '− Remove the last day'}</Text>
            </Press>
          ) : null}
        </>
      ) : (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1.3 }} />
          <Labelled label="Until"><TimeBox value={offer.endsAt} onChange={(t) => update({ endsAt: t })} /></Labelled>
        </View>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// What's happening? — the running order
// ---------------------------------------------------------------------------

type OrderRow = { key: string; day: number; time: string | null; title: string; detail: string | null };
let rowSeq = 0;
const rowKey = () => `r${++rowSeq}`;

export function OrderStep({ offer, update }: StepProps) {
  const days = eventDays(offer);
  const [day, setDay] = useState(0);
  const [rows, setRows] = useState<OrderRow[]>(() => offer.runningOrder.map((r) => ({ key: rowKey(), day: r.day ?? 0, time: r.time, title: r.title, detail: r.detail ?? null })));
  const save = (next: OrderRow[]) => {
    setRows(next);
    const sorted = [...next].filter((r) => r.title.trim()).sort((a, b) => a.day - b.day || (a.time ?? '99').localeCompare(b.time ?? '99'));
    update({ runningOrder: sorted.map(({ day: d, time, title, detail }) => ({ day: d, time, title, detail })) });
  };
  const today = days.length > 1 ? Math.min(day, days.length - 1) : 0;
  const shown = rows.filter((r) => (days.length > 1 ? r.day === today : true));
  const set = (key: string, patch: Partial<OrderRow>) => save(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <>
      {days.length > 1 ? (
        <View style={{ flexDirection: 'row', gap: 2 }}>
          {days.map((d, i) => (
            <Press key={d} onPress={() => setDay(i)} accessibilityRole="tab" accessibilityState={{ selected: i === today }}
              style={[{ flex: 1, paddingVertical: 10, paddingHorizontal: 6, backgroundColor: i === today ? LIME : INACTIVE, alignItems: 'center' }, pointer]}>
              <Text style={tx(13, i === today ? '800' : '600')}>{DAY_SHORT[dowOf(d)]} {at(d).getUTCDate()}</Text>
            </Press>
          ))}
        </View>
      ) : null}
      <View style={v.list}>
        {shown.map((r) => (
          <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
            <View style={{ width: 64 }}><TimeBox value={r.time} onChange={(t) => set(r.key, { time: t })} style={{ height: 38, paddingHorizontal: 8 }} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <TextInput value={r.title} onChangeText={(t) => set(r.key, { title: t })} placeholder="Add a time and what happens" placeholderTextColor={INK_MUTED} accessibilityLabel="What happens"
                style={[tx(14.5, '600'), { padding: 0 }, noOutline]} />
              <TextInput value={r.detail ?? ''} onChangeText={(t) => set(r.key, { detail: t || null })} placeholder="A note, if it needs one" placeholderTextColor={INK_MUTED} accessibilityLabel="A note"
                style={[tx(12, '400', INK_MUTED), { padding: 0, marginTop: 2 }, noOutline]} />
            </View>
            <Press onPress={() => save(rows.filter((x) => x.key !== r.key))} accessibilityRole="button" accessibilityLabel="Remove" style={[{ padding: 4 }, pointer]}>
              <Icon name="close" size={16} color={INK_MUTED} />
            </Press>
          </View>
        ))}
      </View>
      <AddLink label={days.length > 1 ? `Add to ${DAY_SHORT[dowOf(days[today])]}` : 'Add to the day'} onPress={() => setRows([...rows, { key: rowKey(), day: today, time: null, title: '', detail: null }])} />
    </>
  );
}

// ---------------------------------------------------------------------------
// What should guests tell you?
// ---------------------------------------------------------------------------

const DIET_KEYS = ['vegetarian', 'vegan', 'gluten_free', 'nut_allergy', 'dairy_free', 'halal'];

export function RsvpStep({ offer, update }: StepProps) {
  const [q, setQ] = useState<GuestQuestions>(() => ({
    plusOne: { on: false, ...offer.guestQuestions.plusOne },
    diet: { on: false, ticks: ['vegetarian', 'vegan', 'gluten_free'], ...offer.guestQuestions.diet },
    kids: { on: false, askAges: true, askNeeds: true, mostPerFamily: 4, ...offer.guestQuestions.kids },
    bring: { on: false, items: [], ...offer.guestQuestions.bring },
    stay: { on: false, nights: [], places: [], ...offer.guestQuestions.stay },
  }));
  const save = (next: GuestQuestions) => { setQ(next); update({ guestQuestions: next }); };
  const days = useMemo(() => eventDays(offer), [offer.startsOn, offer.endsOn, offer.multiDay]);
  const drawer = { backgroundColor: LIME_TINT, paddingVertical: 10, paddingHorizontal: 12 } as const;
  const item = (i: number, patch: Partial<{ name: string; qty: number }>) => save({ ...q, bring: { ...q.bring!, items: q.bring!.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) } });
  const place = (i: number, patch: Partial<{ name: string; note: string | null }>) => save({ ...q, stay: { ...q.stay!, places: q.stay!.places.map((x, j) => (j === i ? { ...x, ...patch } : x)) } });
  const nextId = (p: string, list: { id: string }[]) => `${p}${list.reduce((n, x) => Math.max(n, Number(String(x.id).replace(/\D/g, '')) || 0), 0) + 1}`;

  return (
    <View style={v.list}>
      <ToggleRow title="Plus-ones" sub="Up to one each" on={q.plusOne!.on} onFlip={() => save({ ...q, plusOne: { on: !q.plusOne!.on } })} />

      <ToggleRow title="Dietary needs" sub="Allergies and what they don’t eat" on={q.diet!.on} onFlip={() => save({ ...q, diet: { ...q.diet!, on: !q.diet!.on } })} />
      {q.diet!.on ? (
        <View style={[drawer, { gap: 8 }]}>
          <Kicker green>Guests can tick</Kicker>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {DIET_KEYS.map((k) => <TickChip key={k} label={DIET_WORDS[k]} on={q.diet!.ticks.includes(k)} onPress={() => save({ ...q, diet: { ...q.diet!, ticks: q.diet!.ticks.includes(k) ? q.diet!.ticks.filter((x) => x !== k) : [...q.diet!.ticks, k] } })} />)}
          </View>
          <Text style={tx(12, '400', DEEP_GREEN)}>Plus a box for anything else</Text>
        </View>
      ) : null}

      <ToggleRow title="Kids coming" sub="How many, and their ages" on={q.kids!.on} onFlip={() => save({ ...q, kids: { ...q.kids!, on: !q.kids!.on } })} />
      {q.kids!.on ? (
        <View style={[drawer, { paddingTop: 4 }]}>
          {([['Ask their ages', 'askAges'], ['Ask what they need · high chair, cot, quiet room', 'askNeeds']] as const).map(([t, k]) => (
            <Press key={k} onPress={() => save({ ...q, kids: { ...q.kids!, [k]: !q.kids![k] } })} accessibilityRole="checkbox" accessibilityState={{ checked: q.kids![k] }}
              style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: HAIRLINE }, pointer]}>
              <Text style={[tx(14, '600'), { flex: 1 }]}>{t}</Text>
              <Tick on={q.kids![k]} />
            </Press>
          ))}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9 }}>
            <Text style={tx(14, '600')}>Most per family</Text>
            <View style={{ width: 120 }}><Count value={q.kids!.mostPerFamily} onChange={(n) => save({ ...q, kids: { ...q.kids!, mostPerFamily: n } })} min={1} max={12} size={18} btn={30} label="Most per family" /></View>
          </View>
        </View>
      ) : null}

      <ToggleRow title="Bring something" sub="Guests pick from your list" on={q.bring!.on} onFlip={() => save({ ...q, bring: { ...q.bring!, on: !q.bring!.on } })} />
      {q.bring!.on ? (
        <View style={[drawer, { paddingTop: 4, paddingBottom: 8 }]}>
          {q.bring!.items.map((b, i) => (
            <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
              <View style={{ flex: 1, height: 38, justifyContent: 'center', paddingHorizontal: 10, backgroundColor: CREAM }}>
                <TextInput value={b.name} onChangeText={(name) => item(i, { name })} placeholder="What’s needed" placeholderTextColor={INK_MUTED} accessibilityLabel="What’s needed" style={[tx(14, '400'), { padding: 0 }, noOutline]} />
              </View>
              <View style={{ width: 96 }}><Count value={b.qty} onChange={(qty) => item(i, { qty })} min={1} max={999} size={16} btn={26} label={`How many ${b.name}`} /></View>
              <Press onPress={() => save({ ...q, bring: { ...q.bring!, items: q.bring!.items.filter((_, j) => j !== i) } })} accessibilityRole="button" accessibilityLabel="Remove" style={pointer}>
                <Icon name="close" size={16} color={INK_MUTED} />
              </Press>
            </View>
          ))}
          <AddLink label="Add something" onPress={() => save({ ...q, bring: { ...q.bring!, items: [...q.bring!.items, { id: nextId('i', q.bring!.items), name: '', qty: 1 }] } })} />
        </View>
      ) : null}

      <ToggleRow title="Somewhere to stay" sub="Which nights, and where" on={q.stay!.on} onFlip={() => save({ ...q, stay: { ...q.stay!, on: !q.stay!.on } })} />
      {q.stay!.on ? (
        <View style={[drawer, { gap: 8 }]}>
          <Kicker green>Which nights</Kicker>
          {days.length ? (
            <View style={{ flexDirection: 'row', gap: 2 }}>
              {days.map((d) => {
                const on = q.stay!.nights.includes(d);
                return (
                  <Press key={d} onPress={() => save({ ...q, stay: { ...q.stay!, nights: on ? q.stay!.nights.filter((x) => x !== d) : [...q.stay!.nights, d].sort() } })} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                    style={[{ flex: 1, paddingVertical: 9, paddingHorizontal: 6, alignItems: 'center', backgroundColor: on ? LIME : CREAM }, pointer]}>
                    <Text style={tx(13, on ? '800' : '600')}>{DAY_SHORT[dowOf(d)]} {at(d).getUTCDate()}</Text>
                  </Press>
                );
              })}
            </View>
          ) : <Text style={tx(12.5, '400', INK_MUTED)}>Pick the date first</Text>}
          <Kicker green style={{ marginTop: 4 }}>Where they can stay</Kicker>
          {q.stay!.places.map((p, i) => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: CREAM }}>
              <View style={{ flex: 1 }}>
                <TextInput value={p.name} onChangeText={(name) => place(i, { name })} placeholder="A place to stay" placeholderTextColor={INK_MUTED} accessibilityLabel="A place to stay" style={[tx(14, '600'), { padding: 0 }, noOutline]} />
                <TextInput value={p.note ?? ''} onChangeText={(note) => place(i, { note: note || null })} placeholder="Add a link or a note" placeholderTextColor={INK_MUTED} accessibilityLabel="A link or a note" style={[tx(12, '400', INK_MUTED), { padding: 0 }, noOutline]} />
              </View>
              <Press onPress={() => save({ ...q, stay: { ...q.stay!, places: q.stay!.places.filter((_, j) => j !== i) } })} accessibilityRole="button" accessibilityLabel="Remove" style={pointer}>
                <Icon name="close" size={16} color={INK_MUTED} />
              </Press>
            </View>
          ))}
          <AddLink label="Add a place" onPress={() => save({ ...q, stay: { ...q.stay!, places: [...q.stay!.places, { id: nextId('p', q.stay!.places), name: '', note: null }] } })} />
        </View>
      ) : null}
    </View>
  );
}

void INK; void useEffect;
