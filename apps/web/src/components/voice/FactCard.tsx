/**
 * The fact card: the chips, grouped (C3 "Here's what we heard", B4 "Your day,
 * as we heard it", R3 "Here's the plan"). The groups differ by door — the
 * boards say so — but a chip is a chip: tap it and the picker opens.
 */

import React from 'react';
import { View } from 'react-native';
import type { Intake, IntakeSlot } from '../../api';
import { ChipGroup, FactChip } from './kit';

type Grouping = { title: string; keys: string[] }[];

const FIRST: Grouping = [
  { title: 'Where & how far', keys: ['destination', 'origin', 'travel_mode', 'max_minutes', 'journey'] },
  { title: 'When', keys: ['trip_type', 'when', 'time_of_day'] },
  { title: 'Who', keys: ['who', 'kids_ages'] },
  { title: 'What', keys: ['vibe', 'several_things', 'indoors'] },
  { title: 'Food', keys: ['food_diet', 'food_allergy', 'food_cuisine', 'food_must', 'food_avoid', 'food_place', 'food_pref'] },
];
const STEPS: Grouping = [
  { title: 'Where & how far', keys: ['destination', 'origin', 'travel_mode', 'max_minutes', 'journey', 'when', 'trip_type', 'time_of_day'] },
  { title: 'Who & what', keys: ['who', 'kids_ages', 'vibe', 'several_things', 'indoors'] },
  { title: 'Food & budget', keys: ['food_diet', 'food_allergy', 'food_cuisine', 'food_must', 'food_avoid', 'food_place', 'food_pref'] },
];
const RETURNING: Grouping = [
  { title: 'Where & when', keys: ['destination', 'when', 'trip_type', 'time_of_day'] },
  { title: 'Getting there', keys: ['origin', 'journey', 'travel_mode', 'max_minutes'] },
  { title: 'Who', keys: ['who', 'kids_ages'] },
  { title: 'What', keys: ['vibe', 'several_things', 'indoors'] },
  { title: 'Food', keys: ['food_diet', 'food_allergy', 'food_cuisine', 'food_must', 'food_avoid', 'food_place', 'food_pref'] },
];

export function groupingFor(intake: Pick<Intake, 'flow' | 'mode'>): Grouping {
  if (intake.flow === 'returning' || intake.flow === 'inspire') return RETURNING;
  return intake.mode === 'steps' ? STEPS : FIRST;
}

/** When the journey is known, the separate mode and range chips say the same thing twice; keep the journey. */
function tidy(slots: IntakeSlot[]): IntakeSlot[] {
  const hasJourney = slots.some((s) => s.key === 'journey');
  return hasJourney ? slots.filter((s) => s.key !== 'travel_mode') : slots;
}

export const lookOf = (slot: IntakeSlot) => (slot.key === 'food_allergy' ? 'allergy' : slot.key === 'food_avoid' ? 'said' : slot.source);

export function FactCard({ intake, onChip, hideGaps = false }: { intake: Intake; onChip?: (slot: IntakeSlot) => void; hideGaps?: boolean }) {
  const slots = tidy(intake.slots).filter((s) => !(hideGaps && s.source === 'gap'));
  const groups = groupingFor(intake).map((g) => ({ ...g, slots: g.keys.flatMap((k) => slots.filter((s) => s.key === k)) })).filter((g) => g.slots.length);
  return (
    <View style={{ gap: 20 }}>
      {groups.map((g) => (
        <ChipGroup key={g.title} title={g.title}>
          {g.slots.map((s, i) => <FactChip key={`${s.key}-${i}`} label={s.label} icon={s.icon} look={lookOf(s)} onPress={onChip ? () => onChip(s) : undefined} />)}
        </ChipGroup>
      ))}
    </View>
  );
}

/** The card folded into one wrapping row (C5, R5b): the same chips, no kickers. */
export function FactRow({ intake, onChip, small = false }: { intake: Intake; onChip?: (slot: IntakeSlot) => void; small?: boolean }) {
  const order = groupingFor(intake).flatMap((g) => g.keys);
  const slots = tidy(intake.slots).filter((s) => s.source !== 'gap' && s.key !== 'trip_type' && s.key !== 'several_things').sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {slots.map((s, i) => <FactChip key={`${s.key}-${i}`} label={shortLabel(s)} icon={s.icon} look={lookOf(s)} small={small} onPress={onChip ? () => onChip(s) : undefined} />)}
    </View>
  );
}

/** "Up to 1 hr each way" is "1 hr" in a strip; "From home · Ascot" is "From home". */
function shortLabel(s: IntakeSlot): string {
  if (s.key === 'max_minutes') return s.label.replace(/^Up to /, '').replace(/ each way$/, '');
  if (s.key === 'origin' && s.label.startsWith('From home')) return 'From home';
  if (s.key === 'who' && /^Whole family · (\d+)$/.test(s.label)) return s.label.replace('Whole family · ', '');
  return s.label;
}
