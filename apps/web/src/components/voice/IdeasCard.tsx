/**
 * The ideas card (R4): on a trip made by voice, a lime-tint card in the drawer
 * — "Three ideas for the kids — Windsor Castle · Legoland · Savill Garden, plus
 * The Two Brewers for a veggie-friendly pub lunch" — built from what was said,
 * each name tappable to add as a stop; and the mic tile beside the title to
 * refine by voice ("actually make it the afternoon").
 *
 * The ideas come from the same pool Inspire draws: our own atlas around the
 * trip's place, the top three things ranked for children when children were
 * said, and one place to eat that fits the diet. No extra provider call.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api, Intake, InspireItem } from '../../api';
import { colors, fonts } from '../../theme';
import { MicTile } from './kit';

export function IdeasCard({ intake, place, onAdd, onRefine, added = new Set() }: {
  intake: Intake;
  place: { lat: number; lng: number; label: string | null };
  onAdd: (item: InspireItem) => void;
  onRefine: () => void;
  added?: Set<string>;
}) {
  const [items, setItems] = useState<InspireItem[] | null>(null);
  useEffect(() => {
    let live = true;
    api.inspireNear({ lat: place.lat, lng: place.lng, label: place.label ?? undefined, km: Math.min(60, Math.max(8, Math.round((intake.resolved.maxMinutes || 60) / 3))) })
      .then((r) => { if (live) setItems(r.items); }).catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [place.lat, place.lng, place.label, intake.resolved.maxMinutes]);

  const kids = Boolean(intake.slots.find((s) => s.key === 'kids_ages') || intake.facts.who.kids_mentioned);
  const vibe = intake.resolved.vibe;
  const diets = [...intake.facts.food.diets, ...intake.slots.filter((s) => s.key === 'food_diet').map((s) => String(s.value))].map((d) => d.toLowerCase());
  const wantsFood = intake.facts.food.must_haves.length > 0 || intake.facts.food.cuisines.length > 0 || Boolean(intake.facts.food.place);

  const picks = useMemo(() => {
    if (!items) return null;
    const things = items.filter((i) => !i.moods.includes('food' as any) && i.category !== 'restaurant' && i.category !== 'cafe' && i.category !== 'pub' && i.category !== 'bar');
    const food = items.filter((i) => i.moods.includes('food' as any) || ['restaurant', 'cafe', 'pub', 'bar'].includes(i.category));
    const score = (i: InspireItem) => (i.rating ?? 0) * Math.log10((i.ratingCount ?? 0) + 2) + (kids && i.goodForChildren ? 1 : 0) + (vibe && i.moods.includes(vibeMood(vibe) as any) ? 0.8 : 0);
    const top = [...things].sort((a, b) => score(b) - score(a)).slice(0, 3);
    const pub = intake.facts.food.must_haves.some((m) => /pub/i.test(m));
    const meal = [...food].sort((a, b) => score(b) - score(a)).find((i) => (pub ? i.category === 'pub' : true) && (!diets.length || i.cuisines.some((c) => diets.some((d) => c.toLowerCase().includes(d))) || !i.cuisines.length)) ?? food[0] ?? null;
    return { top, meal: wantsFood ? meal : null };
  }, [items, kids, vibe, diets, wantsFood, intake.facts.food.must_haves]);

  if (!picks || (!picks.top.length && !picks.meal)) return null;
  const who = kids ? 'for the kids' : vibe ? `for a ${vibe === 'mixed' ? 'mixed' : vibe} day` : 'to start with';
  const dietWord = diets[0] ? (diets[0].startsWith('veg') ? 'veggie-friendly' : `${diets[0]}-friendly`) : null;
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>{picks.top.length === 3 ? 'Three ideas' : picks.top.length === 2 ? 'Two ideas' : 'An idea'} {who}</Text>
        <MicTile onPress={onRefine} size={36} label="Refine by voice" />
      </View>
      <Text style={styles.body}>
        {picks.top.map((i, n) => (
          <Text key={i.venueRef}>
            {n ? ' · ' : ''}
            <Text style={[styles.link, added.has(i.venueRef) && styles.added]} onPress={() => onAdd(i)}>{i.name}</Text>
          </Text>
        ))}
        {picks.meal ? <Text> — plus <Text style={[styles.link, added.has(picks.meal.venueRef) && styles.added]} onPress={() => onAdd(picks.meal!)}>{picks.meal.name}</Text>{dietWord ? ` for a ${dietWord} ${intake.facts.food.must_haves.find((m) => /lunch|dinner|tea|breakfast/i.test(m))?.toLowerCase() ?? 'meal'}` : ''}</Text> : null}
        . Tap to add, or tell Epic what you’d rather.
      </Text>
    </View>
  );
}

const vibeMood = (v: string) => ({ fun: 'fun', cultural: 'culture', active: 'activity', relaxed: 'relaxing', mixed: 'fun' } as Record<string, string>)[v] ?? v;

const styles = StyleSheet.create({
  card: { backgroundColor: colors.accentSoft, padding: 14, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  title: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 15, color: colors.ink, flex: 1 },
  body: { fontSize: 14, lineHeight: 21, color: colors.ink },
  link: { fontWeight: '700', textDecorationLine: 'underline' },
  added: { textDecorationLine: 'none', color: colors.accent },
});

export type { Pressable };
