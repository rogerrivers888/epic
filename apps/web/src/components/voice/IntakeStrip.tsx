/**
 * What sits above the results (C5, R5b): the fact card folded into one
 * wrapping row under a title — "Saturday, from home", or the question as it
 * was asked — each chip tappable into the picker; and, the first time, the
 * harvest card (D1): "Remember that you're vegetarian and the kids are 6 and
 * 9?" with Yes, remember / Not now and no third option.
 *
 * Also the ask row (R5): one grey row under the category band with a 36px lime
 * mic tile — "Or just ask — 'somewhere for a rainy afternoon with the kids'".
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Press } from '../press';
import { api, HouseholdResponse, Intake, IntakeSlot } from '../../api';
import { colors, fonts } from '../../theme';
import { FactRow } from './FactCard';
import { ChipPicker } from './ChipPicker';
import { MicTile } from './kit';
import { Icon } from '../Icon';
import { useRouter } from '../../router';

const NOT_NOW_KEY = (id: string) => `epic.voice.harvest.notnow.${id}`;

export function IntakeStrip({ intakeId, household, onReask, onLoaded }: { intakeId: string; household: HouseholdResponse | null; onReask: () => void; onLoaded?: (intake: Intake) => void }) {
  const { navigate } = useRouter();
  const [intake, setIntake] = useState<Intake | null>(null);
  const [picking, setPicking] = useState<IntakeSlot | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let live = true;
    api.voiceIntakeGet(intakeId).then((r) => { if (live) { setIntake(r.intake); onLoaded?.(r.intake); } }).catch(() => {});
    try { setHidden(sessionStorage.getItem(NOT_NOW_KEY(intakeId)) === '1'); } catch { /* noop */ }
    return () => { live = false; };
  }, [intakeId]);
  if (!intake) return null;

  const setSlot = async (slot: string, value: unknown) => {
    setBusy(true);
    try {
      const { intake: got } = await api.voiceIntakePatch(intakeId, { set: { [slot]: value } });
      setIntake(got);
      onLoaded?.(got);
      // The results follow the chip: a new range or a new place is a new address.
      if (got.resultsHref !== intake.resultsHref) navigate(got.resultsHref, { replace: true });
    } catch { /* the chip stays as it was */ } finally { setBusy(false); }
  };
  const remember = async () => {
    setBusy(true);
    try { const r = await api.voiceIntakeRemember(intakeId); setIntake(r.intake); } catch { /* noop */ } finally { setBusy(false); }
  };
  const notNow = () => { try { sessionStorage.setItem(NOT_NOW_KEY(intakeId), '1'); } catch { /* noop */ } setHidden(true); };

  const title = intake.asked ? cap(intake.asked.replace(/[.?!]+$/, '')) : titleOf(intake);
  return (
    <View style={styles.wrap}>
      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        <MicTile onPress={onReask} label="Ask again" />
      </View>
      <FactRow intake={intake} onChip={(s) => setPicking(s)} />
      {intake.harvest && !hidden ? (
        <View style={styles.harvest}>
          <Text style={styles.harvestText}>{intake.harvest.text}</Text>
          <Text style={styles.harvestSub}>We’ll stop asking, and plans will fit from the start.</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 2, alignItems: 'center' }}>
            <Press onPress={remember} disabled={busy} accessibilityRole="button" style={styles.yes}><Text style={styles.yesText}>{busy ? 'Saving…' : 'Yes, remember'}</Text></Press>
            <Press onPress={notNow} accessibilityRole="button" style={styles.no}><Text style={styles.noText}>Not now</Text></Press>
          </View>
        </View>
      ) : null}
      <ChipPicker slot={picking?.key ?? null} current={picking} heard={picking?.source === 'said' ? picking.label : null} household={household} wants={intake.resolved.wants ?? []} food={intake.facts.food} onSet={(slot, value) => { void setSlot(slot, value); }} onClose={() => setPicking(null)} />
    </View>
  );
}

/** "Saturday, from home" — the day and the start, in five words. */
function titleOf(intake: Intake): string {
  const when = intake.slots.find((s) => s.key === 'when');
  const origin = intake.slots.find((s) => s.key === 'origin');
  const day = when?.label ?? 'Today';
  const dayWord = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/.test(day) ? ({ Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' } as Record<string, string>)[day.slice(0, 3)] : day;
  const from = origin?.label.startsWith('From home') ? 'from home' : origin?.label.replace(/^From /, 'from ') ?? '';
  const dest = intake.resolved.destination;
  return dest ? `${dest}, ${dayWord.toLowerCase() === 'today' ? 'today' : dayWord}` : `${dayWord}, ${from}`.replace(/, $/, '');
}
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** The ask row (R5). */
export function AskRow({ onPress, example = 'somewhere for a rainy afternoon with the kids' }: { onPress: () => void; example?: string }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityLabel="Just ask" style={styles.askRow}>
      <View style={styles.askTile}><Icon name="mic" size={16} color={colors.selectedFg} strokeWidth={2.2} /></View>
      <Text style={styles.askText} numberOfLines={2}>Or just ask — “{example}”</Text>
    </Press>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { flex: 1, fontFamily: fonts.heading, fontSize: 26, fontWeight: '800', letterSpacing: -0.78, lineHeight: 28, color: colors.ink },
  harvest: { backgroundColor: colors.accentSoft, padding: 16, gap: 10 },
  harvestText: { fontWeight: '600', fontSize: 15, lineHeight: 20, color: colors.ink },
  harvestSub: { fontSize: 13, color: colors.inkMuted },
  yes: { backgroundColor: colors.primary, paddingVertical: 10, paddingHorizontal: 16 },
  yesText: { color: colors.primaryFg, fontWeight: '600', fontSize: 14 },
  no: { paddingVertical: 10, paddingHorizontal: 12 },
  noText: { color: colors.inkMuted, fontWeight: '600', fontSize: 14 },
  askRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.warm, paddingVertical: 12, paddingHorizontal: 14, marginHorizontal: 20, marginTop: 12 },
  askTile: { width: 36, height: 36, backgroundColor: colors.selected, alignItems: 'center', justifyContent: 'center' },
  askText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.inkMuted },
});
