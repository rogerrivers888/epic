/**
 * Preview (shared): the guest page as it stands, over the step that opened it.
 * Mirrors the prototype's `pv` (Epic Host prototype v7, lines 414–462, and its
 * `pushS` / `cal` / `bring` logic): photo, title, under the title, when, the
 * lane's extras, where, places, your reply (One-off), parents, price. A part
 * not filled in yet is a plain grey block with no caption; the part added at
 * the step just before this one is tinted lime. The guest controls — kids,
 * bring something, somewhere to stay, the On request calendar — are live, on
 * local state only: nothing here is saved, and the button does nothing.
 *
 * Drawn in the tree (not a Modal), so it stays inside the phone frame.
 */

import React, { useMemo, useState } from 'react';
import { DimensionValue, Image, Platform, ScrollView, StyleSheet, Text, TextInput, TextStyle, View } from 'react-native';
import { Press } from '../../../components/press';
import { Icon } from '../../../components/Icon';
import { mediaUrl } from '../../../components/hosting';
import { CREAM, DEEP_GREEN, DISABLED_GREY, EMPTY_BLOCK, HAIRLINE, INACTIVE, INK, INK_MUTED, LIME, LIME_TINT } from '../../../theme';
import {
  DAY_PLURAL, DAY_SHORT, DIET_WORDS, MONTHS_LONG, NEED_WORDS, at, courseRun, dateShort, dayWords, dowOf, dowToMonFirst, gbp, holidayMap,
  iso, lengthWords, plusDays, slotsFor, stepsOf, todayIso, weeklyRun,
  type HostLane, type LaneConfig, type LaneHome, type LaneOffer, type StepKey,
} from './model';
import { Count, Kicker, Tick, TickChip, hx, pointer, textStyles, tx } from './kit';

const noOutline = (Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) as TextStyle;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One part of the page: filled in (`on`) or a grey block of the prototype's size. */
type Sec = {
  id: string; step: StepKey; on: boolean; k?: string; v?: string; extra?: React.ReactNode;
  fs?: number; fw?: TextStyle['fontWeight']; heading?: boolean; gh?: number; gw?: DimensionValue;
};

/** "13:00" → "13:00", null → "" */
const t5 = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');

function whenOneoff(o: LaneOffer): string {
  if (!o.startsOn) return '';
  const end = o.multiDay ? o.endsOn : null;
  if (end && end !== o.startsOn) {
    const days = Math.round((at(end).getTime() - at(o.startsOn).getTime()) / 86400000) + 1;
    return `${dayWords(o.startsOn)}${o.startsAt ? `, ${t5(o.startsAt)}` : ''} – ${dayWords(end)}${o.endsAt ? `, ${t5(o.endsAt)}` : ''} · ${days} days`;
  }
  const time = o.startsAt ? ` · ${t5(o.startsAt)}${o.endsAt ? `–${t5(o.endsAt)}` : ''}` : '';
  return `${dayWords(o.startsOn)}${time}`;
}

function whenWeekly(o: LaneOffer): string {
  const days = [...o.weekdays].sort((a, b) => dowToMonFirst(a) - dowToMonFirst(b)).map((d) => DAY_PLURAL[d]).join(', ');
  return [days, t5(o.startsAt), lengthWords(o.durationMin)].filter(Boolean).join(' · ');
}

/** "Drop in £12 · Book ahead £10" and "10% off for 4+ / 15% off for 4+". */
function priceWeekly(o: LaneOffer): string {
  const top = [o.dropInPence ? `Drop in ${gbp(o.dropInPence)}` : '', o.bookAheadPence ? `Book ahead ${gbp(o.bookAheadPence)}` : ''].filter(Boolean).join(' · ');
  const off = [
    o.dropInGroupPct && o.dropInGroupMin ? `${o.dropInGroupPct}% off for ${o.dropInGroupMin}+` : '',
    o.bookAheadGroupPct && o.bookAheadGroupMin ? `${o.bookAheadGroupPct}% off for ${o.bookAheadGroupMin}+` : '',
  ].filter(Boolean).join(' / ');
  return [top, off].filter(Boolean).join('\n');
}

function priceOther(o: LaneOffer): string {
  const each = o.per === 'booking' ? 'a booking' : o.per === 'household' ? 'a household' : 'each';
  if (o.priceMode === 'free') return 'Free';
  if (o.priceMode === 'same_each') return `${gbp(o.pricePence)} ${each}${o.childPence ? ` · children ${gbp(o.childPence)}` : ''}`;
  if (o.priceMode === 'by_numbers') {
    if (o.totalPence && o.minCount && o.maxCount) return `From ${gbp(Math.round(o.totalPence / o.maxCount))} to ${gbp(Math.round(o.totalPence / o.minCount))} ${each}, depending on numbers`;
    return `${gbp(o.totalPence)} split`;
  }
  return '';
}

function whereWords(o: LaneOffer): string {
  if (o.venue === 'out_about') return `Out and about${o.venueLabel || o.venueArea ? ` · ${o.venueLabel ?? o.venueArea}` : ''}`;
  if (o.venue === 'your_place') return `At the host’s · area shown until confirmed${o.venueArea ? `\n${o.venueArea}` : ''}`;
  if (o.venue === 'their_place') return `At yours${o.travelRadiusMin ? ` · within ${o.travelRadiusMin} miles${o.venueArea ? ` of ${o.venueArea}` : ''}` : ''}`;
  if (o.venue === 'online') return 'Online · link sent an hour before';
  return '';
}

/** The local time a slot starts, for the notice rule. */
const slotTime = (d: string, t: string) => {
  const [y, m, dd] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number);
  return new Date(y, m - 1, dd, h, mi).getTime();
};

export function Preview({ offer: o, lane, config, home, step, onClose }: {
  offer: LaneOffer; lane: HostLane; config: LaneConfig; home: LaneHome; step: StepKey | 'publish' | 'done'; onClose: () => void;
}) {
  const steps = stepsOf(lane);
  const at_ = step === 'publish' || step === 'done' ? steps.length : steps.indexOf(step);
  const reached = (k: StepKey) => { const i = steps.indexOf(k); return i >= 0 && i < at_; };
  /** The part added at the last step: the step just before this one, while a step is open. */
  const newest: StepKey | null = step !== 'publish' && step !== 'done' && at_ > 0 ? steps[at_ - 1] : null;
  const holidays = useMemo(() => holidayMap(config.bankHolidays ?? []), [config.bankHolidays]);
  const gq = o.guestQuestions ?? {};

  // ---- the sections, in the prototype's pushS order ----------------------
  const sec: Sec[] = [];
  sec.push({ id: 'title', step: 'what', on: !!o.title?.trim(), v: o.title ?? '', fs: 23, fw: '800', heading: true, gh: 18, gw: '75%' });
  sec.push({ id: 'line', step: 'what', on: !!o.line?.trim(), v: o.line ?? '', fs: 13.5, fw: '400', gw: '90%' });

  if (lane === 'oneoff') sec.push({ id: 'when', step: 'when', on: !!o.startsOn, k: 'When', v: whenOneoff(o), gw: '55%' });
  if (lane === 'weekly') sec.push({ id: 'when', step: 'weekly', on: o.weekdays.length > 0 && !!o.firstDate, k: 'When', v: whenWeekly(o), gw: '55%' });
  if (lane === 'course') {
    const run = courseRun(o, holidays);
    const on = !!o.firstDate && !!o.sessions && run.dates.length > 0;
    const first = run.dates[0]; const last = run.dates[run.dates.length - 1];
    const dayName = first ? (run.dates.length === 1 ? DAY_PLURAL[dowOf(first)].slice(0, -1) : DAY_PLURAL[dowOf(first)]) : '';
    const words = on ? [`${run.dates.length} ${dayName}`, `${dayWords(first)} – ${dayWords(last)}`, t5(o.startsAt)].filter(Boolean).join(' · ') : '';
    const tiles = [...run.dates.map((d, i) => ({ d, n: String(i + 1), off: false })), ...run.skipped.map((s) => ({ d: s.date, n: 'Off', off: true }))]
      .sort((a, b) => a.d.localeCompare(b.d)).slice(0, 5);
    sec.push({
      id: 'when', step: 'run', on, k: 'When', v: words, gw: '55%',
      extra: on ? (
        <View style={{ flexDirection: 'row', gap: 4, marginTop: 6 }}>
          {tiles.map((t) => (
            <View key={t.d} style={{ flex: 1, minWidth: 0, alignItems: 'center', paddingVertical: 7, backgroundColor: t.off ? INACTIVE : CREAM, borderWidth: 1, borderColor: HAIRLINE }}>
              <Text style={tx(10, '700', INK_MUTED, { letterSpacing: 0.6, textTransform: 'uppercase' })}>{MON[at(t.d).getUTCMonth()]}</Text>
              <Text style={hx(18, -0.02, 1.2, t.off ? INK_MUTED : INK)}>{at(t.d).getUTCDate()}</Text>
              <Text style={tx(11, '700', t.off ? INK_MUTED : DEEP_GREEN)}>{t.n}</Text>
            </View>
          ))}
        </View>
      ) : null,
    });
  }

  if (lane === 'oneoff') {
    const rows = [...o.runningOrder].sort((a, b) => a.day - b.day || t5(a.time).localeCompare(t5(b.time)));
    const multi = o.multiDay && new Set(rows.map((r) => r.day)).size > 1;
    const lines: string[] = [];
    let lastDay = -1;
    for (const r of rows) {
      if (multi && r.day !== lastDay) { lines.push(o.startsOn ? dayWords(plusDays(o.startsOn, r.day)) : `Day ${r.day + 1}`); lastDay = r.day; }
      lines.push([t5(r.time), r.title].filter(Boolean).join(' '));
    }
    sec.push({ id: 'order', step: 'order', on: rows.length > 0, k: 'The day', v: lines.join('\n'), fw: '500', gh: 60, gw: '100%' });
  }
  if (lane === 'course') {
    sec.push({ id: 'outcome', step: 'outcome', on: !!o.outcome?.trim(), k: 'By the end', v: o.outcome ?? '', gw: '100%' });
    const topics = [...o.topics].sort((a, b) => a.n - b.n);
    const total = Math.max(o.sessions ?? 0, topics.length);
    const plan = topics.slice(0, 4).map((t) => `${t.n} ${t.title || '—'}`).join('\n') + (total > 4 ? `\n${total - 4} more` : '');
    sec.push({ id: 'sessions', step: 'sessions', on: topics.length > 0, k: 'Session plan', v: plan, fw: '500', gh: 50, gw: '100%' });
  }
  if (lane === 'onrequest') {
    const name = home.host?.name?.trim();
    sec.push({ id: 'why', step: 'why', on: !!o.whyYou?.trim(), k: 'About your host', v: [name, o.whyYou].filter(Boolean).join('\n'), gw: '80%' });
  }

  sec.push({ id: 'where', step: 'where', on: o.venue != null, k: 'Where', v: whereWords(o), gw: '65%' });

  const priceStep: StepKey = lane === 'weekly' ? 'wprice' : 'price';
  sec.push({
    id: 'places', step: priceStep, on: o.maxCount != null || o.minCount != null, k: 'Places', gw: '50%',
    v: o.minCount && o.maxCount ? `Runs from ${o.minCount} · up to ${o.maxCount}` : o.maxCount ? `Up to ${o.maxCount}` : `Runs from ${o.minCount}`,
  });

  if (lane === 'oneoff') {
    const any = !!(gq.plusOne?.on || gq.diet?.on || gq.kids?.on || gq.bring?.on || gq.stay?.on);
    const diet = (gq.diet?.ticks ?? []).map((t) => DIET_WORDS[t] ?? t);
    const reply = [
      'Coming · Can’t make it',
      gq.plusOne?.on ? 'Bringing a plus-one' : '',
      gq.diet?.on ? `Dietary needs: ${[...diet, 'other'].join(' · ')}` : '',
    ].filter(Boolean).join('\n');
    sec.push({ id: 'rsvp', step: 'rsvp', on: reached('rsvp') || any, k: 'Your reply', v: reply, fw: '500', gw: '80%' });
  }

  const parentsWords = o.parents === 'stay' ? 'Parents stay' : o.parents === 'drop_off' ? 'Drop off' : '';
  if (lane === 'course') sec.push({ id: 'parents', step: 'staydrop', on: !!o.parents, k: 'Parents', v: parentsWords, gw: '40%' });
  else if (o.parents) sec.push({ id: 'parents', step: 'who', on: true, k: 'Parents', v: parentsWords });

  const weeklyPaid = !!(o.dropInPence || o.bookAheadPence);
  const otherPaid = o.priceMode === 'same_each' || o.priceMode === 'by_numbers';
  const pricePaid = lane === 'weekly' ? weeklyPaid : otherPaid;
  sec.push({
    id: 'price', step: priceStep, on: lane === 'weekly' ? weeklyPaid : o.priceMode != null, k: 'Price',
    v: lane === 'weekly' ? priceWeekly(o) : priceOther(o), gw: lane === 'weekly' ? '70%' : '40%',
    extra: pricePaid && o.refundWords ? <Text style={[tx(12, '400', INK_MUTED, { lineHeight: 16, marginTop: 2 }), textStyles.preLine]}>{o.refundWords}</Text> : null,
  });

  if (lane === 'weekly') {
    const today = todayIso();
    // An ongoing class rolls on from today, as publishing and the guest page do.
    const next = weeklyRun({ ...o, firstDate: o.firstDate && o.firstDate < today ? today : o.firstDate }, holidays).dates.filter((d) => d >= today).slice(0, 5);
    if (next.length) sec.push({ id: 'next', step: 'weekly', on: true, k: 'Next dates', v: next.map(dateShort).join(' · '), fw: '500' });
  }

  // ---- the live guest controls (local state only) --------------------------
  const [kidN, setKidN] = useState(0);
  const [ages, setAges] = useState<string[]>([]);
  const [needs, setNeeds] = useState<Record<string, boolean>>({});
  const [claimed, setClaimed] = useState<Record<string, boolean>>({});
  const [nights, setNights] = useState<Record<string, boolean>>({});
  const [stayPick, setStayPick] = useState<number | null>(null);

  // On request: the calendar
  const [now] = useState(() => Date.now());
  const today = todayIso();
  const [month, setMonth] = useState(() => ({ y: at(today).getUTCFullYear(), m: at(today).getUTCMonth() }));
  const [pvDay, setPvDay] = useState<string | null>(null);
  const [pvSlot, setPvSlot] = useState(0);
  const hasFree = lane === 'onrequest' && Object.values(o.freeHours ?? {}).some((r) => r && r.length > 0);
  const lengths = [...(o.sessionLengths ?? [])].filter((n) => n > 0).sort((a, b) => a - b);
  const shortest = lengths[0] ?? 60;
  const earliest = now + Math.max(0, o.noticeHours ?? 0) * 3600000;
  const openSlots = (d: string) => (d < today ? [] : slotsFor(o.freeHours ?? {}, dowOf(d), shortest).filter((t) => slotTime(d, t) >= earliest));
  const first = new Date(Date.UTC(month.y, month.m, 1, 12));
  const lead = dowToMonFirst(first.getUTCDay());
  const daysIn = new Date(Date.UTC(month.y, month.m + 1, 0, 12)).getUTCDate();
  const monthDays = Array.from({ length: daysIn }, (_, i) => iso(new Date(Date.UTC(month.y, month.m, i + 1, 12))));
  const freeDays = new Set(hasFree ? monthDays.filter((d) => openSlots(d).length > 0) : []);
  const selDay = pvDay && freeDays.has(pvDay) ? pvDay : monthDays.find((d) => freeDays.has(d)) ?? null;
  const daySlots = selDay ? openSlots(selDay).slice(0, 4) : [];
  const slotIx = Math.min(pvSlot, Math.max(0, daySlots.length - 1));
  const thisMonth = month.y === at(today).getUTCFullYear() && month.m === at(today).getUTCMonth();
  const go = (d: number) => { setMonth(({ y, m }) => ({ y: m + d < 0 ? y - 1 : m + d > 11 ? y + 1 : y, m: (m + d + 12) % 12 })); setPvDay(null); setPvSlot(0); };

  // ---- the header and the button -------------------------------------------
  const view = o.visibility === 'invite' ? 'Preview · as an invited guest' : o.visibility === 'public' ? 'Preview · as anyone on Epic' : 'Preview';
  const paid = o.paid || pricePaid;
  const cta = hasFree
    ? (selDay && daySlots.length ? `Ask to book ${dayWords(selDay)}, ${daySlots[slotIx]}` : 'Ask to book')
    : o.visibility === 'invite' ? 'Send my reply' : paid ? 'Book a place' : 'Join';
  const ctaBg = o.visibility != null || hasFree ? INK : EMPTY_BLOCK;
  const photo = mediaUrl(o.photos?.[0]?.url);

  const kids = lane === 'oneoff' && gq.kids?.on ? gq.kids : null;
  const kidCap = kids && kids.mostPerFamily > 0 ? kids.mostPerFamily : 10;
  const bring = lane === 'oneoff' && gq.bring?.on ? gq.bring.items.filter((b) => b.name?.trim()) : [];
  const stay = lane === 'oneoff' && gq.stay?.on ? gq.stay : null;
  const stayOptions = stay ? [...stay.places.filter((p) => p.name?.trim()).map((p) => p.name), 'Sorting my own'] : [];

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 30, backgroundColor: CREAM, flexDirection: 'column' }]}>
      <View style={{ borderBottomWidth: 1, borderBottomColor: HAIRLINE, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 20, gap: 12 }}>
        <Press onPress={onClose} accessibilityRole="button" accessibilityLabel="Back to editing" style={[{ flexDirection: 'row', alignItems: 'center', gap: 2 }, pointer]}>
          <Icon name="previous" size={16} color={INK} strokeWidth={2.4} />
          <Text style={tx(14, '700')}>Back to editing</Text>
        </Press>
        <Text style={tx(12, '700', INK_MUTED)} numberOfLines={1}>{view}</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 14, paddingHorizontal: 20, paddingBottom: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        <View style={{ height: 170, borderRadius: 10, overflow: 'hidden', backgroundColor: EMPTY_BLOCK, flexShrink: 0 }}>
          {photo ? <Image source={{ uri: photo }} resizeMode="cover" style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors /> : null}
        </View>

        {sec.map((s) => {
          if (!s.on) return <View key={s.id} style={{ height: s.gh ?? 12, width: s.gw ?? '60%', backgroundColor: EMPTY_BLOCK }} />;
          const tint = s.step === newest;
          const fs = s.fs ?? 14;
          const valueStyle: TextStyle = s.heading
            ? hx(fs, -0.03, 1.25)
            : tx(fs, s.fw ?? '600', INK, { lineHeight: Math.round(fs * 1.25) });
          return (
            <View key={s.id} style={{ marginHorizontal: -12, padding: tint ? 12 : 0, paddingHorizontal: 12, backgroundColor: tint ? LIME_TINT : 'transparent', gap: 3 }}>
              {s.k ? <Kicker>{s.k}</Kicker> : null}
              {s.v ? <Text style={[valueStyle, textStyles.preLine]}>{s.v}</Text> : null}
              {s.extra}
            </View>
          );
        })}

        {hasFree ? (
          <View style={{ marginHorizontal: -12, padding: 12, gap: 10, backgroundColor: newest === 'avail' ? LIME_TINT : 'transparent' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Kicker>Pick a day · {MONTHS_LONG[month.m]}</Kicker>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <Press disabled={thisMonth} onPress={() => go(-1)} accessibilityRole="button" accessibilityLabel="Previous month" style={[{ paddingHorizontal: 6, opacity: thisMonth ? 0.3 : 1 }, !thisMonth && pointer]}>
                  <Icon name="previous" size={16} color={INK} />
                </Press>
                <Press onPress={() => go(1)} accessibilityRole="button" accessibilityLabel="Next month" style={[{ paddingHorizontal: 6 }, pointer]}>
                  <Icon name="more" size={16} color={INK} />
                </Press>
              </View>
            </View>
            <View style={{ backgroundColor: CREAM, padding: 8, flexDirection: 'row', flexWrap: 'wrap' }}>
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((h, i) => (
                <View key={`h${i}`} style={{ width: `${100 / 7}%`, paddingBottom: 3 }}><Text style={tx(11, '700', INK_MUTED, { textAlign: 'center' })}>{h}</Text></View>
              ))}
              {Array.from({ length: lead }, (_, i) => <View key={`l${i}`} style={{ width: `${100 / 7}%`, height: 39 }} />)}
              {monthDays.map((d) => {
                const free = freeDays.has(d); const on = d === selDay;
                return (
                  <View key={d} style={{ width: `${100 / 7}%`, padding: 1.5 }}>
                    <Press disabled={!free} onPress={() => { setPvDay(d); setPvSlot(0); }} accessibilityRole="button" accessibilityLabel={dayWords(d)} accessibilityState={{ selected: on, disabled: !free }}
                      style={[{ height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? LIME : free ? LIME_TINT : 'transparent' }, free && pointer]}>
                      <Text style={tx(14, free ? '700' : '500', free ? INK : DISABLED_GREY)}>{at(d).getUTCDate()}</Text>
                    </Press>
                  </View>
                );
              })}
            </View>
            <Kicker>{selDay ? `${dayWords(selDay)}${lengths.length ? ` · ${lengths.map(lengthWords).join(' or ')}` : ''}` : 'No free days'}</Kicker>
            {daySlots.length ? (
              <View style={{ flexDirection: 'row', gap: 4 }}>
                {daySlots.map((t, i) => (
                  <Press key={t} onPress={() => setPvSlot(i)} accessibilityRole="button" accessibilityState={{ selected: i === slotIx }}
                    style={[{ flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: i === slotIx ? LIME : CREAM }, pointer]}>
                    <Text style={tx(14, i === slotIx ? '800' : '600')}>{t}</Text>
                  </Press>
                ))}
                {Array.from({ length: 4 - daySlots.length }, (_, i) => <View key={`e${i}`} style={{ flex: 1 }} />)}
              </View>
            ) : null}
            <Text style={tx(12, '400', DEEP_GREEN)}>{o.noticeHours > 0 ? `${o.noticeHours} hours’ notice · UK time` : 'UK time'}</Text>
          </View>
        ) : null}

        {kids ? (
          <View style={{ backgroundColor: INACTIVE, marginHorizontal: -12, padding: 12, gap: 10 }}>
            <Kicker>Kids coming</Kicker>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={tx(14.5, '600')}>How many</Text>
              <View style={{ width: 110 }}>
                <Count value={kidN} onChange={(n) => setKidN(n)} min={0} max={kidCap} size={18} btn={30} ground={CREAM} label="Kids coming" />
              </View>
            </View>
            {kids.askAges && kidN > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {Array.from({ length: kidN }, (_, i) => (
                  <View key={i} style={{ width: '48%', flexGrow: 1, height: 42, justifyContent: 'center', paddingHorizontal: 12, backgroundColor: CREAM }}>
                    <TextInput value={ages[i] ?? ''} onChangeText={(t) => setAges((a) => { const n = [...a]; n[i] = t.replace(/\D/g, '').slice(0, 2); return n; })}
                      placeholder="Age" placeholderTextColor={INK_MUTED} keyboardType="numeric" accessibilityLabel={`Age, child ${i + 1}`}
                      style={[tx(15), { padding: 0 }, noOutline]} />
                  </View>
                ))}
              </View>
            ) : null}
            {kids.askNeeds ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {Object.entries(NEED_WORDS).map(([key, word]) => (
                  <TickChip key={key} label={word} on={!!needs[key]} onPress={() => setNeeds((n) => ({ ...n, [key]: !n[key] }))} ground={CREAM} />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {bring.length ? (
          <View style={{ backgroundColor: INACTIVE, marginHorizontal: -12, padding: 12 }}>
            <Kicker style={{ paddingBottom: 6 }}>Bring something</Kicker>
            {bring.map((b) => {
              const mine = !!claimed[b.id];
              const n = mine ? 1 : 0;
              const full = n >= b.qty;
              const label = mine ? 'You’re bringing one' : full ? 'Covered' : 'I’ll bring one';
              return (
                <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={tx(14, '600')}>{b.name} <Text style={tx(14, '500', INK_MUTED)}>· {n} of {b.qty}</Text></Text>
                    {mine ? <Text style={tx(12, '400', INK_MUTED)}>You</Text> : null}
                  </View>
                  <Press disabled={full && !mine} onPress={() => setClaimed((c) => ({ ...c, [b.id]: !c[b.id] }))} accessibilityRole="button" accessibilityState={{ selected: mine }}
                    style={[{ paddingVertical: 5, paddingHorizontal: 9, backgroundColor: mine ? LIME : CREAM }, !(full && !mine) && pointer]}>
                    <Text style={tx(12.5, '700')} numberOfLines={1}>{label}</Text>
                  </Press>
                </View>
              );
            })}
          </View>
        ) : null}

        {stay ? (
          <View style={{ backgroundColor: INACTIVE, marginHorizontal: -12, padding: 12, gap: 8 }}>
            <Kicker>Somewhere to stay</Kicker>
            {stay.nights.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>
                {[...stay.nights].sort().map((d) => {
                  const on = !!nights[d];
                  return (
                    <Press key={d} onPress={() => setNights((x) => ({ ...x, [d]: !x[d] }))} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                      style={[{ width: '32.6%', flexGrow: 1, paddingVertical: 9, paddingHorizontal: 6, alignItems: 'center', backgroundColor: on ? LIME : CREAM }, pointer]}>
                      <Text style={tx(13, on ? '800' : '600')}>{DAY_SHORT[dowOf(d)]} {at(d).getUTCDate()}</Text>
                    </Press>
                  );
                })}
              </View>
            ) : null}
            {stayOptions.map((t, i) => (
              <Press key={`${i}-${t}`} onPress={() => setStayPick(i)} accessibilityRole="radio" accessibilityState={{ selected: stayPick === i }}
                style={[{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, backgroundColor: CREAM }, pointer]}>
                <Tick on={stayPick === i} />
                <Text style={[tx(14, '600'), { flex: 1 }]}>{t}</Text>
              </Press>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <View style={{ paddingTop: 10, paddingHorizontal: 20, paddingBottom: 14, borderTopWidth: 1, borderTopColor: HAIRLINE }}>
        <View accessibilityRole="button" style={{ height: 48, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', backgroundColor: ctaBg }}>
          <Text style={tx(15, '700', CREAM)} numberOfLines={1}>{cta}</Text>
        </View>
      </View>
    </View>
  );
}
