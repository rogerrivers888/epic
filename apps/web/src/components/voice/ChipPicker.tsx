/**
 * Tapping a chip opens this (C3b): a bottom sheet with a title, "We heard …",
 * and a way to set the slot by hand — a list with a moss tick on the current
 * value, a search for places, boxes for bands. A modality switch, never a
 * re-record (handoff: "Corrections are taps, never re-recording").
 *
 * A Modal portals out of the tree, so on the desktop's phone frame it pins
 * itself to the frame's origin and size (CLAUDE.md), as the venue drawer does.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, HouseholdResponse, IntakeSlot, Place } from '../../api';
import { colors, fonts, radius } from '../../theme';
import { useViewport } from '../../hooks/useViewport';
import { Boxes, FactChip, ListRow } from './kit';

export type PickerSlot = string;

const MODES = [{ value: 'car', label: 'Car' }, { value: 'public_transport', label: 'Train & bus' }, { value: 'walk', label: 'On foot' }, { value: 'cycle', label: 'Bike' }];
const MODE_ICONS = { car: 'driving', public_transport: 'transit', walk: 'walking', cycle: 'cycle' } as const;
const MINUTES = [{ value: 20, label: '20 min' }, { value: 30, label: '30 min' }, { value: 60, label: '1 hr' }, { value: 120, label: '2 hr' }, { value: 180, label: '3 hr' }];
const VIBES = [{ value: 'fun', label: 'Fun' }, { value: 'cultural', label: 'Cultural' }, { value: 'active', label: 'Active' }, { value: 'relaxed', label: 'Relaxed' }, { value: 'mixed', label: 'A bit of everything' }, { value: 'any', label: 'Don’t mind' }];
const TYPES = [{ value: 'today', label: 'Today' }, { value: 'day_out', label: 'A day out' }, { value: 'weekend', label: 'A weekend' }, { value: 'holiday', label: 'A holiday' }, { value: 'event', label: 'An event' }];
const BANDS = ['0-4', '5-8', '9-12', '13+'];
const DIETS = ['Vegetarian', 'Vegan', 'Pescatarian', 'Halal', 'Kosher', 'Gluten-free', 'Dairy-free'];

const TITLES: Record<string, string> = {
  origin: 'Where from?', destination: 'Where to?', travel_mode: 'How will you travel?', max_minutes: 'How far, each way?', journey: 'How will you travel?',
  who: 'Who’s going?', kids_ages: 'How old are the kids?', vibe: 'What’s the mood?', several_things: 'One thing, or a few?', when: 'When?',
  time_of_day: 'What time of day?', trip_type: 'What kind of day?', indoors: 'Indoors or out?', food: 'Anything on food?',
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const dayOffsets = () => {
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const at = (n: number) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };
  const toSat = (6 - today.getDay() + 7) % 7 || 7;
  const sat = at(toSat), sun = at(toSat + 1), nextSat = at(toSat + 7);
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return [
    { value: iso(today), label: 'Today' }, { value: iso(at(1)), label: 'Tomorrow' },
    { value: iso(sat), label: `This Saturday · ${fmt(sat)}` }, { value: iso(sun), label: `This Sunday · ${fmt(sun)}` },
    { value: iso(nextSat), label: `Next Saturday · ${fmt(nextSat)}` },
  ];
};

export function ChipPicker({ slot, current, heard, household, onSet, onClose }: {
  slot: PickerSlot | null;
  /** The slot as it stands, for the tick. */
  current: IntakeSlot | null;
  /** The words, when this slot was said ("We heard 'Sunningdale'"). */
  heard?: string | null;
  household: HouseholdResponse | null;
  onSet: (slot: string, value: unknown) => void;
  onClose: () => void;
}) {
  const { width, height, framed, origin } = useViewport();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [text, setText] = useState('');
  useEffect(() => { setQ(''); setResults([]); setText(''); }, [slot]);
  useEffect(() => {
    if (!slot || !['origin', 'destination'].includes(slot) || q.trim().length < 2) { setResults([]); return; }
    let live = true;
    const t = setTimeout(() => { api.geocode(q.trim(), 6, { kind: 'area', near: household?.household.home ?? null }).then((r) => { if (live) setResults(r.results); }).catch(() => {}); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, slot, household]);

  const value: any = current?.value ?? null;
  const base = slot?.startsWith('food') ? 'food' : slot === 'journey' ? 'travel_mode' : slot;
  const set = (v: unknown) => { onSet(base!, v); onClose(); };
  const members = household?.members ?? [];
  const home = household?.household.home ?? null;
  const town = (label: string | null | undefined) => { if (!label) return ''; const parts = label.split(',').map((p) => p.trim()).filter((p) => p && !/\d/.test(p)); return parts[parts.length - 1] ?? label; };

  const body = useMemo(() => {
    switch (base) {
      case 'origin': return (
        <>
          <Search q={q} setQ={setQ} placeholder="Search a place" />
          <View>
            {home ? <ListRow icon="home" label={`Home · ${town(home.label)}`} on={value?.kind === 'home'} onPress={() => set({ kind: 'home' })} /> : null}
            <ListRow icon="here" label="Use my location" on={value?.kind === 'current'} onPress={() => set({ kind: 'current' })} />
            {results.map((p) => <ListRow key={`${p.lat},${p.lng}`} icon="address" label={p.label} sub={p.locality && p.locality !== p.label ? p.locality : undefined} on={value?.kind === 'named' && value?.name === p.label} onPress={() => set({ kind: 'named', name: p.locality ?? p.label })} />)}
          </View>
        </>
      );
      case 'destination': return (
        <>
          <Search q={q} setQ={setQ} placeholder="Search a town or place" />
          <View>
            {results.map((p) => <ListRow key={`${p.lat},${p.lng}`} icon="address" label={p.label} sub={p.locality && p.locality !== p.label ? p.locality : undefined} on={value === p.label} onPress={() => set(p.locality ?? p.label)} />)}
            {!results.length && !q ? <Text style={styles.hint}>Type a town, an area or an attraction.</Text> : null}
          </View>
        </>
      );
      case 'travel_mode': return <Boxes options={MODES} value={typeof value === 'object' && value ? value.mode : value} onChange={set} icons={MODE_ICONS} grow />;
      case 'max_minutes': return <Boxes options={MINUTES} value={value} onChange={set} grow />;
      case 'trip_type': return <Boxes options={TYPES} value={value} onChange={set} />;
      case 'vibe': return <Boxes options={VIBES} value={value} onChange={set} />;
      case 'several_things': return <Boxes options={[{ value: 'few', label: 'A few things' }, { value: 'one', label: 'One thing' }]} value={value === true ? 'few' : value === false ? 'one' : null} onChange={(v) => set(v === 'few')} grow />;
      case 'indoors': return <Boxes options={[{ value: 'in', label: 'Indoors' }, { value: 'out', label: 'Outdoors' }]} value={value === true ? 'in' : value === false ? 'out' : null} onChange={(v) => set(v === 'in')} grow />;
      case 'time_of_day': return <Boxes options={[{ value: 'morning', label: 'Morning' }, { value: 'afternoon', label: 'Afternoon' }, { value: 'evening', label: 'Evening' }]} value={value} onChange={set} grow />;
      case 'when': return (
        <View>
          {dayOffsets().map((d) => <ListRow key={d.value} icon="calendar" label={d.label} on={value?.start === d.value} onPress={() => set({ start: d.value, end: null })} />)}
          <View style={styles.typedRow}>
            <TextInput value={text} onChangeText={setText} placeholder="Or a date · 2026-10-15" placeholderTextColor={colors.inkMuted} style={styles.typed} />
            <Pressable onPress={() => { if (/^\d{4}-\d{2}-\d{2}$/.test(text.trim())) set({ start: text.trim(), end: null }); }} accessibilityRole="button" style={styles.use}><Text style={styles.useText}>Use</Text></Pressable>
          </View>
        </View>
      );
      case 'who': return (
        <View>
          <ListRow icon="household" label={members.length ? `All ${members.length} of you` : 'Whole family'} on={value?.kind === 'whole_household'} onPress={() => set({ kind: 'whole_household' })} />
          <ListRow icon="person" label="Just me" on={value?.kind === 'just_me'} onPress={() => set({ kind: 'just_me' })} />
          <Text style={[styles.hint, { marginTop: 8 }]}>Or pick who:</Text>
          <WhoPicker members={members} names={value?.kind === 'named' ? value.names ?? [] : []} onDone={(names) => set({ kind: 'named', names })} />
        </View>
      );
      case 'kids_ages': return <KidsPicker initial={Array.isArray(value) ? value : []} onDone={(kids) => set(kids)} />;
      case 'food': return <FoodPicker current={current} onDone={(food) => set(food)} />;
      default: return null;
    }
  }, [base, q, results, value, text, members, home, current]);

  if (!slot) return null;
  const frameBox = framed && origin ? { position: 'absolute' as const, left: origin.x, top: origin.y, width, height, borderRadius: radius.lg, overflow: 'hidden' as const } : { position: 'absolute' as const, left: 0, right: 0, top: 0, bottom: 0 };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={frameBox}>
        <Pressable onPress={onClose} style={styles.scrim} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <View style={{ alignItems: 'center' }}><View style={styles.handle} /></View>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{TITLES[base ?? ''] ?? 'Change this'}</Text>
            {heard ? <Text style={styles.heard}>We heard “{heard}”</Text> : null}
          </View>
          <ScrollView style={{ maxHeight: Math.min(height * 0.6, 520) }} keyboardShouldPersistTaps="handled">
            <View style={{ gap: 14 }}>{body}</View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Search({ q, setQ, placeholder }: { q: string; setQ: (s: string) => void; placeholder: string }) {
  return (
    <View style={styles.search}>
      <TextInput value={q} onChangeText={setQ} placeholder={placeholder} placeholderTextColor={colors.inkMuted} style={styles.searchInput} autoFocus accessibilityLabel={placeholder} />
    </View>
  );
}

function WhoPicker({ members, names, onDone }: { members: HouseholdResponse['members']; names: string[]; onDone: (names: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>(names);
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {members.map((m) => <FactChip key={m.id} label={m.name} look={picked.includes(m.name) ? 'said' : 'profile'} onPress={() => setPicked((p) => (p.includes(m.name) ? p.filter((x) => x !== m.name) : [...p, m.name]))} />)}
      </View>
      <Pressable onPress={() => picked.length && onDone(picked)} accessibilityRole="button" style={[styles.use, { alignSelf: 'flex-start' }, !picked.length && { opacity: 0.5 }]}><Text style={styles.useText}>Just these</Text></Pressable>
    </View>
  );
}

/** One row per child, four bands; "+ another child" (C4 / O3b). */
export function KidsPicker({ initial, onDone, names = [], inline = false, onChange }: { initial: { name?: string | null; age?: number | null; band?: string | null }[]; onDone?: (kids: { name: string | null; band: string }[]) => void; names?: (string | null)[]; inline?: boolean; onChange?: (kids: { name: string | null; band: string | null }[]) => void }) {
  const [kids, setKids] = useState<{ name: string | null; band: string | null }[]>(() => {
    const seeded = initial.map((k) => ({ name: k.name ?? null, band: k.band ?? (k.age != null ? bandOf(k.age) : null) }));
    while (seeded.length < Math.max(1, names.length)) seeded.push({ name: names[seeded.length] ?? null, band: null });
    return seeded;
  });
  const update = (next: typeof kids) => { setKids(next); onChange?.(next); };
  return (
    <View style={{ gap: 10 }}>
      {kids.map((k, i) => (
        <View key={i} style={styles.kidRow}>
          <View style={[styles.kidTile, k.band ? { backgroundColor: colors.selected } : null]}><Text style={styles.kidTileText}>{k.name ? k.name[0].toUpperCase() : i + 1}</Text></View>
          {k.name ? <Text style={styles.kidName} numberOfLines={1}>{k.name}</Text> : null}
          <View style={{ flex: 1 }} />
          <Boxes options={BANDS.map((b) => ({ value: b, label: b.replace('-', '–') }))} value={k.band} onChange={(band) => update(kids.map((x, j) => (j === i ? { ...x, band } : x)))} />
        </View>
      ))}
      <Pressable onPress={() => update([...kids, { name: null, band: null }])} accessibilityRole="button"><Text style={styles.more}>+ another child</Text></Pressable>
      {!inline && onDone ? (
        <Pressable onPress={() => onDone(kids.filter((k) => k.band).map((k) => ({ name: k.name, band: k.band! })))} accessibilityRole="button" style={[styles.use, { alignSelf: 'flex-start' }, !kids.some((k) => k.band) && { opacity: 0.5 }]}><Text style={styles.useText}>That’s them</Text></Pressable>
      ) : null}
    </View>
  );
}
export const bandOf = (age: number) => (age <= 4 ? '0-4' : age <= 8 ? '5-8' : age <= 12 ? '9-12' : '13+');

function FoodPicker({ current, onDone }: { current: IntakeSlot | null; onDone: (food: { diets?: string[]; must_haves?: string[]; avoids?: string[]; no_preference?: boolean }) => void }) {
  const [diets, setDiets] = useState<string[]>(current?.key === 'food_diet' && typeof current.value === 'string' ? [current.value] : []);
  const [must, setMust] = useState('');
  const [avoid, setAvoid] = useState('');
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {DIETS.map((d) => <FactChip key={d} label={d} look={diets.includes(d) ? 'said' : 'profile'} onPress={() => setDiets((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]))} />)}
      </View>
      <View style={styles.typedRow}>
        <TextInput value={must} onChangeText={setMust} placeholder="Something you want · a pub lunch" placeholderTextColor={colors.inkMuted} style={styles.typed} />
      </View>
      <View style={styles.typedRow}>
        <TextInput value={avoid} onChangeText={setAvoid} placeholder="Something to avoid · seafood" placeholderTextColor={colors.inkMuted} style={styles.typed} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pressable onPress={() => onDone({ diets, must_haves: must.trim() ? [must.trim()] : undefined, avoids: avoid.trim() ? [avoid.trim()] : undefined, no_preference: false })} accessibilityRole="button" style={styles.use}><Text style={styles.useText}>Use this</Text></Pressable>
        <Pressable onPress={() => onDone({ diets: [], must_haves: [], avoids: [], no_preference: true })} accessibilityRole="button" style={[styles.use, { backgroundColor: colors.warm }]}><Text style={[styles.useText, { color: colors.ink }]}>No preference</Text></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(32,30,29,0.35)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.bg, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 36, gap: 14 },
  handle: { width: 40, height: 4, backgroundColor: colors.ruleSoft },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' },
  title: { fontFamily: fonts.heading, fontSize: 22, fontWeight: '800', letterSpacing: -0.44, color: colors.ink },
  heard: { fontSize: 13, color: colors.inkMuted },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.ruleSoft },
  searchInput: { flex: 1, fontSize: 15, color: colors.ink, padding: 0 },
  hint: { fontSize: 13, color: colors.inkMuted },
  typedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typed: { flex: 1, borderWidth: 1, borderColor: colors.ruleSoft, paddingVertical: 10, paddingHorizontal: 12, fontSize: 15, color: colors.ink },
  use: { backgroundColor: colors.primary, paddingVertical: 10, paddingHorizontal: 14 },
  useText: { color: colors.primaryFg, fontWeight: '600', fontSize: 14 },
  kidRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  kidTile: { width: 36, height: 36, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center' },
  kidTileText: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 15, color: colors.ink },
  kidName: { fontSize: 14, fontWeight: '600', color: colors.ink, maxWidth: 90 },
  more: { fontSize: 13, fontWeight: '600', color: colors.accent, paddingVertical: 6 },
});
