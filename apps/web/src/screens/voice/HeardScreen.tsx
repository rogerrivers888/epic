/**
 * Here's what we heard (C3), Your day as we heard it (B4), Here's the plan (R3).
 *
 * The chips, grouped; tap one and the picker opens (C3b); the mic tile in the
 * header adds to the reading. Gaps are dashed. The one button is what the door
 * decides: **Show me plans** (first time — through the one or two gap
 * questions first, if there are any) or **Create trip** (returning — the trip
 * exists before any browsing).
 *
 * An ambiguity the reading raised ("Windsor in Berkshire, or Windsor,
 * Ontario?") is drawn as a question above the card, with its options as chips.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { api, HouseholdResponse, Intake, IntakeSlot } from '../../api';
import { paths } from '../../routes';
import { useRouter } from '../../router';
import { useSpeech } from '../../hooks/useSpeech';
import { Captions, FactChip, MicControl, MicTile, PrimaryCta, TextLink, VoiceHeader, VoiceScreen, clock } from '../../components/voice/kit';
import { FactCard } from '../../components/voice/FactCard';
import { ChipPicker } from '../../components/voice/ChipPicker';
import { StatusLine } from '../../components/ui';
import { colors, type } from '../../theme';

export function HeardScreen({ intakeId, household, onOpenTrip }: { intakeId: string; household: HouseholdResponse | null; onOpenTrip: (id: string) => void }) {
  const { navigate, back } = useRouter();
  const [intake, setIntake] = useState<Intake | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState<IntakeSlot | null>(null);

  useEffect(() => {
    let live = true;
    api.voiceIntakeGet(intakeId).then((r) => { if (live) setIntake(r.intake); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [intakeId]);

  // "Tap the mic to add more": another breath laid over this reading.
  const append = useCallback(async (transcript: string) => {
    setBusy('Adding that…');
    try {
      const { intake: got } = await api.voiceIntake({ transcript, flow: intake?.flow ?? 'first', mode: 'said', intakeId });
      setIntake(got);
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  }, [intake?.flow, intakeId]);
  const speech = useSpeech({ onFinal: (t) => { void append(t); }, confirm: false });

  const setSlot = useCallback(async (slot: string, value: unknown) => {
    setBusy('Changing that…');
    try { const { intake: got } = await api.voiceIntakePatch(intakeId, { set: { [slot]: value } }); setIntake(got); } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  }, [intakeId]);

  const go = useCallback(async () => {
    if (!intake) return;
    const returning = intake.flow === 'returning';
    if (!returning) {
      if (intake.questions.length) { navigate(paths.ask(intake.id)); return; }
      navigate(intake.resultsHref);
      return;
    }
    setBusy('Making the trip…');
    try {
      const trip = await api.createTripV3(intake.tripDraft);
      const id = (trip as any).trip?.id ?? (trip as any).id;
      await api.voiceIntakePatch(intake.id, { tripId: id }).catch(() => {});
      // The places they named are on the list before they see it (owner,
      // 9 Sep 2026: "Windsor Castle should already be in my activities list").
      // Each is looked up by name around the trip and put on the shortlist as a
      // must-do; a name nothing answers to is simply not added.
      const named = intake.resolved.wants.filter((w) => w.kind === 'place');
      for (const w of named.slice(0, 4)) {
        try {
          const found = await api.shortlistSearch(id, { q: w.name });
          const hit = found.results.find((r) => r.name.toLowerCase().includes(w.name.toLowerCase().split(' ')[0])) ?? found.results[0];
          if (hit && hit.lat != null && hit.lng != null) await api.addToShortlist(id, { venueRef: `${hit.source}:${hit.sourcePlaceId}`, venueLabel: hit.name, kind: 'do', category: hit.category ?? null, lat: hit.lat, lng: hit.lng, mustDo: true });
        } catch { /* not found: the list still opens */ }
      }
      // Straight into Activities, not the map (owner, 9 Sep 2026).
      navigate(`${paths.trip(id)}?pill=activities`, { replace: true });
    } catch (e: any) { setError(e.message); setBusy(null); }
  }, [intake, navigate]);

  if (speech.phase === 'listening' || speech.phase === 'transcribing') {
    return (
      <VoiceScreen scroll={false}>
        <VoiceHeader onBack={speech.cancel} right={<Text style={styles.timer}>{clock(speech.seconds)}{speech.paused ? ' · paused' : ''}</Text>} title={speech.phase === 'transcribing' ? 'Got it…' : speech.paused ? 'Paused' : 'Anything to add?'} />
        <Captions committed={speech.live?.committed ?? (speech.mode === 'browser' ? speech.transcript : '')} partial={speech.live?.partial ?? ''} paused={speech.paused} placeholder={speech.mode === 'record' || speech.mode === 'stream' ? 'Recording. The words are read when you tap Done.' : ''} />
        <View style={{ flex: 1 }} />
        {speech.phase === 'listening' ? <MicControl state={speech.paused ? 'paused' : 'listening'} onStart={() => {}} onPause={speech.pause} onResume={speech.resume} onDone={() => { void speech.stop(); }} canPause={speech.canPause} /> : <StatusLine>Writing that down…</StatusLine>}
      </VoiceScreen>
    );
  }

  const returning = intake?.flow === 'returning';
  const title = !intake ? '' : returning ? 'Here’s the plan' : intake.mode === 'steps' ? 'Your day, as we heard it' : 'Here’s what we heard';
  const sub = !intake ? null : returning ? 'Lime is what you said. Grey is from your profile — tap to change for this trip.' : 'Tap anything that’s wrong. Tap the mic to add more.';
  const heardFor = (slot: IntakeSlot) => (slot.source === 'said' ? slot.label.replace(/^From /, '') : null);

  return (
    <VoiceScreen footer={intake ? (
      <PrimaryCta label={returning ? 'Next · activities' : 'Show me plans'} onPress={go} busy={!!busy} />
    ) : null}>
      <VoiceHeader onBack={() => back(intake?.flow === 'returning' ? paths.trips() : paths.say())} right={<MicTile onPress={() => { void speech.start(); }} label="Add more" />} title={title} sub={sub} />
      {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
      {busy ? <StatusLine>{busy}</StatusLine> : null}
      {intake?.ambiguities.length ? (
        <View style={styles.ask}>
          {intake.ambiguities.slice(0, 2).map((a, i) => (
            <View key={i} style={{ gap: 8 }}>
              <Text style={type.h3}>{a.question}</Text>
              {a.options.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {a.options.map((o) => <FactChip key={o} label={o} look="gap" onPress={() => setSlot(slotFor(a.slot), o)} />)}
                </View>
              ) : <TextLink label="Change it" onPress={() => { const s = intake.slots.find((x) => x.key === slotFor(a.slot)); if (s) setPicking(s); }} />}
            </View>
          ))}
        </View>
      ) : null}
      {intake ? <FactCard intake={intake} onChip={(s) => setPicking(s)} /> : null}
      {intake && !returning && intake.questions.length ? (
        <Text style={type.small}>{intake.questions.length === 1 ? 'One quick question next, then the plans.' : 'Two quick questions next, then the plans.'}</Text>
      ) : null}
      <ChipPicker
        slot={picking?.key ?? null}
        current={picking}
        heard={picking ? heardFor(picking) : null}
        household={household}
        onSet={(slot, value) => { void setSlot(slot, value); }}
        onClose={() => setPicking(null)}
      />
    </VoiceScreen>
  );
}

/** The reading's own name for a slot → the chip key. */
const slotFor = (s: string) => (s === 'when' ? 'when' : s.startsWith('food') ? 'food' : s === 'travel' ? 'travel_mode' : s);

const styles = {
  timer: { fontSize: 13, fontWeight: '600' as const, color: colors.inkMuted },
  ask: { backgroundColor: colors.accentSoft, padding: 14, gap: 14 },
};
