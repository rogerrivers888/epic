/**
 * Each lane's own steps (hosting v7 · N3, U3, U4):
 *   Weekly     — Every week (more than one day allowed), and its four price boxes;
 *   Course     — The run, By the end, the Session plan, Parents stay or drop off;
 *   On request — Why you, and When you're free (hour ranges, how long, notice,
 *                how many a week — RULINGS › Gaps to build).
 */

import React, { useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Press } from '../../../../components/press';
import { Icon } from '../../../../components/Icon';
import { CREAM, DEEP_GREEN, HAIRLINE, INACTIVE, INK, INK_MUTED, LIME, LIME_TINT } from '../../../../theme';
import { AddLink, Count, DateBox, Field, Kicker, Labelled, LengthBox, MinMax, MonthGrid, Option, TimeBox, ToggleRow, Switch, pointer, tx, hx, v } from '../kit';
import { DAY_LONG, DAY_PLURAL, WEEKDAY_LETTERS, courseRun, dateShort, dayWords, dowOf, gbp, lengthWords, monFirstToDow, dowToMonFirst, pence, poundsText, todayIso, weeklyRun } from '../model';
import { RefundPolicy } from './Shared';
import type { StepProps } from '../Setup';

const noOutline = { outlineStyle: 'none' } as object;

/** Excluded dates: bank holidays added automatically (no ×), the host's own with ×, then "+ Add another date" on the class's days. */
function Excluded({ skipped, own, onRemove, onAdd, allow, from }: {
  skipped: { date: string; why: 'bank' | 'host'; name?: string }[]; own: string[]; onRemove: (d: string) => void; onAdd: (d: string) => void; allow: (d: string) => boolean; from: string;
}) {
  const [picking, setPicking] = useState(false);
  const rows = [...skipped.filter((s) => s.why === 'bank'), ...own.map((d) => ({ date: d, why: 'host' as const }))].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <>
      <Kicker>Excluded dates</Kicker>
      <View style={v.list}>
        {rows.map((r) => (
          <View key={`${r.why}-${r.date}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
            <View style={{ flex: 1 }}>
              <Text style={tx(14.5, '600')}>{dayWords(r.date)}</Text>
              <Text style={tx(12, '400', INK_MUTED)}>{r.why === 'bank' ? `${'name' in r && r.name ? r.name : 'Bank holiday'} · bank holiday` : 'Added by you'}</Text>
            </View>
            {r.why === 'host' ? (
              <Press onPress={() => onRemove(r.date)} accessibilityRole="button" accessibilityLabel={`Put ${dayWords(r.date)} back`} style={[{ padding: 4 }, pointer]}>
                <Icon name="close" size={16} color={INK_MUTED} />
              </Press>
            ) : null}
          </View>
        ))}
      </View>
      <AddLink label="Add another date" onPress={() => setPicking(!picking)} />
      {picking ? (
        <View style={{ borderWidth: 1, borderColor: HAIRLINE, padding: 10 }}>
          <MonthGrid value={null} from={from} allow={(d) => allow(d) && !own.includes(d)} onPick={(d) => { onAdd(d); setPicking(false); }} />
        </View>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Weekly
// ---------------------------------------------------------------------------

export function EveryWeekStep({ offer, update, holidays }: StepProps) {
  const days = offer.weekdays;
  const run = useMemo(() => weeklyRun(offer, holidays), [offer.firstDate, offer.weekdays, offer.skippedDates, offer.excludeBankHolidays, holidays]);
  const flip = (dow: number) => {
    const next = days.includes(dow) ? days.filter((d) => d !== dow) : [...days, dow].sort();
    // A start that is no longer one of the class's days moves to the next one that is.
    let first = offer.firstDate;
    if (first && next.length && !next.includes(dowOf(first))) { for (let i = 1; i <= 7; i += 1) { const d = new Date(`${first}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i); const iso = d.toISOString().slice(0, 10); if (next.includes(d.getUTCDay())) { first = iso; break; } } }
    update({ weekdays: next, firstDate: first });
  };
  return (
    <>
      <Kicker>Every</Kicker>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {WEEKDAY_LETTERS.map((t, i) => {
          const dow = monFirstToDow(i); const on = days.includes(dow);
          return (
            <Press key={i} onPress={() => flip(dow)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={DAY_PLURAL[dow]}
              style={[{ flex: 1, height: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? LIME : INACTIVE }, pointer]}>
              <Text style={tx(14, on ? '800' : '600', on ? INK : INK_MUTED)}>{t}</Text>
            </Press>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <Labelled label="Time"><TimeBox value={offer.startsAt} onChange={(t) => update({ startsAt: t })} /></Labelled>
        <Labelled label="How long"><LengthBox value={offer.durationMin} onChange={(m) => update({ durationMin: m })} /></Labelled>
        <Labelled label="Starts" style={{ flex: 1.2 }}>
          <DateBox compact value={offer.firstDate} words={dayWords(offer.firstDate)} placeholder="Pick" allow={(d) => !days.length || days.includes(dowOf(d))} onPick={(d) => update({ firstDate: d })} />
        </Labelled>
      </View>
      <ToggleRow title="Exclude bank holidays" sub="England and Wales" on={offer.excludeBankHolidays} onFlip={() => update({ excludeBankHolidays: !offer.excludeBankHolidays })} />
      <Excluded skipped={offer.excludeBankHolidays ? run.skipped : []} own={offer.skippedDates} from={offer.firstDate ?? todayIso()}
        allow={(d) => days.includes(dowOf(d))}
        onRemove={(d) => update({ skippedDates: offer.skippedDates.filter((x) => x !== d) })}
        onAdd={(d) => update({ skippedDates: [...offer.skippedDates, d].sort() })} />
    </>
  );
}

export function WeeklyPriceStep(props: StepProps) {
  const { offer, update } = props;
  const [dropIn, setDropIn] = useState(poundsText(offer.dropInPence));
  const [ahead, setAhead] = useState(poundsText(offer.bookAheadPence));
  const [dPct, setDPct] = useState(offer.dropInGroupPct == null ? '' : String(offer.dropInGroupPct));
  const [aPct, setAPct] = useState(offer.bookAheadGroupPct == null ? '' : String(offer.bookAheadGroupPct));
  const maxN = Math.max(2, offer.maxCount ?? 40);
  const priceBox = (value: string, set: (s: string) => void, key: 'dropInPence' | 'bookAheadPence') => (
    <View style={{ flex: 1, backgroundColor: INACTIVE, padding: 12, gap: 6 }}>
      <Kicker>Price</Kicker>
      <View style={{ flexDirection: 'row', alignItems: 'center', height: 42, paddingHorizontal: 10, backgroundColor: CREAM }}>
        <Text style={hx(20, -0.02, 1.2)}>£</Text>
        <TextInput value={value} onChangeText={(s) => { const c = s.replace(/[^0-9.]/g, ''); set(c); update({ [key]: pence(c) }); }} keyboardType="decimal-pad" placeholder="—" placeholderTextColor={INK_MUTED}
          accessibilityLabel={key === 'dropInPence' ? 'Drop in price' : 'Book ahead price'} style={[hx(20, -0.02, 1.2), { flex: 1, padding: 0 }, noOutline]} />
      </View>
      <Text style={tx(12, '400', INK_MUTED)}>a session</Text>
    </View>
  );
  const discountBox = (value: string, set: (s: string) => void, pctKey: 'dropInGroupPct' | 'bookAheadGroupPct', minKey: 'dropInGroupMin' | 'bookAheadGroupMin') => (
    <View style={{ flex: 1, backgroundColor: LIME_TINT, padding: 12, gap: 6 }}>
      <Kicker>Group discount</Kicker>
      <View style={{ flexDirection: 'row', alignItems: 'center', height: 42, paddingHorizontal: 10, backgroundColor: CREAM }}>
        <TextInput value={value} onChangeText={(s) => { const c = s.replace(/\D/g, '').slice(0, 2); set(c); update({ [pctKey]: c ? Number(c) : null, ...(c && !offer[minKey] ? { [minKey]: Math.min(4, maxN) } : {}) }); }}
          keyboardType="numeric" placeholder="—" placeholderTextColor={INK_MUTED} accessibilityLabel="Group discount" style={[hx(20, -0.02, 1.2), { flex: 1, padding: 0 }, noOutline]} />
        <Text style={hx(20, -0.02, 1.2)}>%</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Text style={tx(12, '400', INK_MUTED)}>for</Text>
        <View style={{ width: 80 }}><Count value={offer[minKey] ?? 4} onChange={(n) => update({ [minKey]: n })} min={2} max={maxN} size={16} btn={24} gap={2} label="People in a group" /></View>
        <Text style={tx(12, '400', INK_MUTED)}>or more</Text>
      </View>
    </View>
  );
  return (
    <>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        <Text style={[hx(15, -0.02, 1.2), { flex: 1, paddingVertical: 4 }]}>Drop in</Text>
        <Text style={[hx(15, -0.02, 1.2), { flex: 1, paddingVertical: 4 }]}>Book ahead</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {priceBox(dropIn, setDropIn, 'dropInPence')}
        {priceBox(ahead, setAhead, 'bookAheadPence')}
      </View>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {discountBox(dPct, setDPct, 'dropInGroupPct', 'dropInGroupMin')}
        {discountBox(aPct, setAPct, 'bookAheadGroupPct', 'bookAheadGroupMin')}
      </View>
      <View style={{ marginTop: 4 }}>
        <MinMax min={offer.minCount} max={offer.maxCount} onMin={(n) => update({ minCount: n })} onMax={(n) => update({ maxCount: n })} suffix=" each week" />
      </View>
      {offer.minCount ? <Text style={tx(12.5, '400', DEEP_GREEN)}>Each session decides a day before · under {offer.minCount} and that session is called off</Text> : null}
      {offer.dropInPence || offer.bookAheadPence ? <RefundPolicy {...props} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Course
// ---------------------------------------------------------------------------

export function RunStep({ offer, update, holidays, config }: StepProps) {
  const run = useMemo(() => courseRun({ ...offer, sessions: offer.sessions ?? 8 }, holidays), [offer.firstDate, offer.sessions, offer.skippedDates, offer.excludeBankHolidays, holidays]);
  const n = offer.sessions ?? 8;
  const day = offer.firstDate ? DAY_LONG[dowOf(offer.firstDate)] : null;
  const summary = offer.firstDate && run.dates.length
    ? `${n} sessions · ${dayWords(run.dates[0])} to ${dayWords(run.dates[run.dates.length - 1])}${run.skipped.length ? ` · ${run.skipped.length} skipped` : ''}`
    : 'Pick the first session to see the dates';
  return (
    <>
      <Labelled label="First session">
        <DateBox value={offer.firstDate} words={offer.firstDate ? `${dayWords(offer.firstDate)} ${offer.firstDate.slice(0, 4)}` : ''} marked={run.dates}
          onPick={(d) => update({ firstDate: d, sessions: offer.sessions ?? 8 })} />
      </Labelled>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Labelled label="Time"><TimeBox value={offer.startsAt} onChange={(t) => update({ startsAt: t })} /></Labelled>
        <Labelled label="How long"><LengthBox value={offer.durationMin} onChange={(m) => update({ durationMin: m })} /></Labelled>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 12, backgroundColor: INACTIVE }}>
        <View>
          <Text style={tx(14.5, '700')}>How many sessions</Text>
          <Text style={tx(12, '400', INK_MUTED)}>Every {day ?? 'week, from the date you pick'}</Text>
        </View>
        <View style={{ width: 120 }}><Count value={n} onChange={(s) => update({ sessions: s })} min={config.courseSessions.min} max={config.courseSessions.max} size={20} btn={30} label="How many sessions" /></View>
      </View>
      <ToggleRow title="Exclude bank holidays" sub="England and Wales" on={offer.excludeBankHolidays} onFlip={() => update({ excludeBankHolidays: !offer.excludeBankHolidays })} />
      <Excluded skipped={offer.excludeBankHolidays ? run.skipped : []} own={offer.skippedDates} from={offer.firstDate ?? todayIso()}
        allow={(d) => Boolean(offer.firstDate) && dowOf(d) === dowOf(offer.firstDate!) && d > offer.firstDate!}
        onRemove={(d) => update({ skippedDates: offer.skippedDates.filter((x) => x !== d) })}
        onAdd={(d) => update({ skippedDates: [...offer.skippedDates, d].sort() })} />
      <View style={{ backgroundColor: LIME_TINT, paddingVertical: 10, paddingHorizontal: 12 }}><Text style={tx(13, '600', DEEP_GREEN)}>{summary}</Text></View>
    </>
  );
}

export function OutcomeStep({ offer, update }: StepProps) {
  return <Field value={offer.outcome ?? ''} onChange={(outcome) => update({ outcome })} multiline rows={5} placeholder="Swim a width on their own, and float on their back." accessibilityLabel="By the end" />;
}

export function SessionsStep({ offer, update, holidays }: StepProps) {
  const run = useMemo(() => courseRun({ ...offer, sessions: offer.sessions ?? 8 }, holidays), [offer.firstDate, offer.sessions, offer.skippedDates, offer.excludeBankHolidays, holidays]);
  const n = offer.sessions ?? 8;
  const [topics, setTopics] = useState<string[]>(() => Array.from({ length: n }, (_, i) => offer.topics.find((t) => t.n === i + 1)?.title ?? ''));
  const set = (i: number, title: string) => {
    const next = [...topics]; next[i] = title; setTopics(next);
    update({ topics: next.map((t, j) => ({ n: j + 1, title: t })).filter((t) => t.title.trim()) });
  };
  return (
    <View style={v.list}>
      {Array.from({ length: n }, (_, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
          <Text style={[tx(12.5, '700'), { width: 58 }]}>{run.dates[i] ? dateShort(run.dates[i]) : `Wk ${i + 1}`}</Text>
          <View style={{ flex: 1, height: 40, justifyContent: 'center', paddingHorizontal: 10, backgroundColor: topics[i] ? INACTIVE : CREAM }}>
            <TextInput value={topics[i] ?? ''} onChangeText={(t) => set(i, t)} placeholder="Add a topic" placeholderTextColor={INK_MUTED} accessibilityLabel={`Session ${i + 1}`}
              style={[tx(14.5, '600'), { padding: 0 }, noOutline]} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function StayDropStep({ offer, update }: StepProps) {
  return (
    <>
      <Option title="Parents stay" sub="For every session" on={offer.parents === 'stay'} onPick={() => update({ parents: 'stay' })} />
      <Option title="Drop off" sub="Parents leave the children with you · extra checks" on={offer.parents === 'drop_off'} onPick={() => update({ parents: 'drop_off' })} />
    </>
  );
}

// ---------------------------------------------------------------------------
// On request
// ---------------------------------------------------------------------------

export function WhyStep({ offer, update }: StepProps) {
  return <Field value={offer.whyYou ?? ''} onChange={(whyYou) => update({ whyYou })} multiline rows={5} placeholder="Twelve years as a field geologist on this coast." accessibilityLabel="Why you" />;
}

export function AvailStep({ offer, update, config }: StepProps) {
  const [hours, setHours] = useState<Record<string, [string, string][]>>(offer.freeHours);
  const save = (next: Record<string, [string, string][]>) => {
    setHours(next);
    const clean: Record<string, [string, string][]> = {};
    for (const [d, rs] of Object.entries(next)) { const ok = rs.filter(([a, b]) => a && b && a < b); if (ok.length) clean[d] = ok; }
    update({ freeHours: clean });
  };
  const lengths = offer.sessionLengths;
  const [notice, setNotice] = useState(String(offer.noticeHours ?? config.onRequest.noticeHours));
  const [perWeek, setPerWeek] = useState(String(offer.perWeekMax ?? config.onRequest.perWeek));
  return (
    <>
      <View style={v.list}>
        {Array.from({ length: 7 }, (_, i) => {
          const dow = monFirstToDow(i); const key = String(dow);
          const rs = hours[key] ?? []; const on = rs.length > 0;
          return (
            <View key={key} style={{ paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: HAIRLINE, gap: 8 }}>
              <Press onPress={() => save({ ...hours, [key]: on ? [] : [['09:00', '12:00']] })} accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={DAY_PLURAL[dow]}
                style={[{ flexDirection: 'row', alignItems: 'center', gap: 12 }, pointer]}>
                <Text style={[tx(14.5, '700', on ? INK : INK_MUTED), { flex: 1 }]}>{DAY_PLURAL[dow]}</Text>
                <Text style={tx(12.5, '400', INK_MUTED)}>{on ? rs.map(([a, b]) => `${a}–${b}`).join(', ') : ''}</Text>
                <Switch on={on} />
              </Press>
              {on ? (
                <>
                  {rs.map(([a, b], j) => (
                    <View key={j} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ width: 84 }}><TimeBox value={a} onChange={(t) => save({ ...hours, [key]: rs.map((r, x) => (x === j ? [t ?? '', r[1]] : r)) as [string, string][] })} style={{ height: 38, backgroundColor: INACTIVE, borderWidth: 0, paddingHorizontal: 10 }} /></View>
                      <Text style={tx(13, '400', INK_MUTED)}>to</Text>
                      <View style={{ width: 84 }}><TimeBox value={b} onChange={(t) => save({ ...hours, [key]: rs.map((r, x) => (x === j ? [r[0], t ?? ''] : r)) as [string, string][] })} style={{ height: 38, backgroundColor: INACTIVE, borderWidth: 0, paddingHorizontal: 10 }} /></View>
                      <View style={{ flex: 1 }} />
                      <Press onPress={() => save({ ...hours, [key]: rs.filter((_, x) => x !== j) })} accessibilityRole="button" accessibilityLabel="Remove these hours" style={pointer}>
                        <Icon name="close" size={16} color={INK_MUTED} />
                      </Press>
                    </View>
                  ))}
                  <Press onPress={() => save({ ...hours, [key]: [...rs, ['14:00', '17:00']] })} accessibilityRole="button" style={pointer}><Text style={tx(13, '600', DEEP_GREEN)}>+ Add hours</Text></Press>
                </>
              ) : null}
            </View>
          );
        })}
      </View>
      <Kicker style={{ marginTop: 4 }}>How long</Kicker>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>
        {config.onRequest.lengths.map((m) => {
          const on = lengths.includes(m);
          return (
            <Press key={m} onPress={() => update({ sessionLengths: on ? lengths.filter((x) => x !== m) : [...lengths, m].sort((a, b) => a - b) })} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
              style={[{ flexGrow: 1, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center', backgroundColor: on ? LIME : INACTIVE }, pointer]}>
              <Text style={tx(14, on ? '800' : '600')}>{lengthWords(m)}</Text>
            </Press>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Labelled label="Notice (hours)"><Field value={notice} onChange={(s) => setNotice(s.replace(/\D/g, ''))} onBlur={() => update({ noticeHours: notice ? Number(notice) : config.onRequest.noticeHours })} keyboard="numeric" maxLength={3} /></Labelled>
        <Labelled label="Most a week"><Field value={perWeek} onChange={(s) => setPerWeek(s.replace(/\D/g, ''))} onBlur={() => update({ perWeekMax: perWeek ? Math.max(1, Number(perWeek)) : config.onRequest.perWeek })} keyboard="numeric" maxLength={3} /></Labelled>
      </View>
    </>
  );
}

void gbp; void dowToMonFirst;
