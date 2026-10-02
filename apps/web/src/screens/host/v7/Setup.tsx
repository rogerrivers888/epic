/**
 * A lane's set-up (hosting v7): the step header, the step, and the action bar.
 *
 * The address decides what is drawn (CLAUDE.md, §13.14):
 *   /host/new/<lane>/what           step 1 before anything is saved (`?mode=say|upload|draft`)
 *   /host/offers/<id>/setup         a draft, at `?step=` (the first step is the bare address)
 *   …?preview=1                     the guest page as it stands, over the step
 *
 * A draft is made on the first save — leaving step 1, or Say it / Upload it
 * building one — never on opening a lane. After that every change is saved as
 * it is made, so "Save and finish later" is always true; the link only takes
 * the host home. The step order and the counter come from the lane's SEQ.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '../../../components/press';
import { Icon } from '../../../components/Icon';
import { showToast } from '../../../components/Toast';
import { api, ApiError } from '../../../api';
import { useRouter } from '../../../router';
import { paths } from '../../../routes';
import { useViewport } from '../../../hooks/useViewport';
import { CREAM, INK, LIME, fonts } from '../../../theme';
import { ActionBar, StepTitle, pointer, tx } from './kit';
import { LANES, SHORT, holidayMap, stepsOf, titleOf, type HostLane, type LaneConfig, type LaneHome, type LaneOffer, type LanePatch, type StepKey } from './model';
import { blankOffer, canGoOn } from './blank';
import { WhatStep, SayIt, UploadIt, YourDraft, type Bar } from './What';
import { STEP_VIEWS } from './steps';
import { Preview } from './Preview';

export type StepProps = {
  offer: LaneOffer;
  lane: HostLane;
  config: LaneConfig;
  home: LaneHome;
  holidays: Map<string, string>;
  update: (patch: LanePatch) => void;
  goStep: (step: StepKey) => void;
  /** Read the draft again (after something saved outside `update`, like an invitation). */
  reload: () => Promise<void>;
};

type Mode = 'say' | 'upload' | 'draft' | null;

export function Setup({ lane: laneIn, offerId }: { lane: HostLane | null; offerId: string | null }) {
  const { navigate, query, setQuery, back } = useRouter();
  const { width } = useViewport();
  const wide = width >= 900;
  const [home, setHome] = useState<LaneHome | null>(null);
  const [offer, setOffer] = useState<LaneOffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modeBar, setModeBar] = useState<Bar | null>(null);

  // --- what the address says ------------------------------------------------
  const lane: HostLane | null = offer?.lane ?? laneIn;
  const steps = lane ? stepsOf(lane) : [];
  const stepParam = query.get('step') as StepKey | null;
  const step: StepKey = stepParam && steps.includes(stepParam) ? stepParam : 'what';
  const index = Math.max(0, steps.indexOf(step));
  const modeParam = query.get('mode');
  const mode: Mode = modeParam === 'say' || modeParam === 'upload' || modeParam === 'draft' ? modeParam : null;
  const previewing = query.get('preview') === '1';

  // --- loading ---------------------------------------------------------------
  useEffect(() => { api.laneHome().then(setHome).catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    // A fresh step 1 (including after Start again) starts from a blank draft, never the deleted one (Codex, 2 Oct 2026).
    if (!offerId) { if (laneIn) setOffer((o) => (o && !o.id ? o : blankOffer(laneIn))); return; }
    api.laneOffer(offerId).then((r) => {
      // A draft that has gone out is not set up any more: its checklist or its ending is where it lives.
      if (r.offer.state !== 'draft') { navigate(paths.hostDone(r.offer.id), { replace: true }); return; }
      setOffer(r.offer);
    }).catch((e) => setError(e instanceof ApiError && e.status === 404 ? 'That draft isn’t one of yours.' : e.message));
  }, [offerId, laneIn]);

  // --- saving: optimistic, debounced, never clobbering what is being typed ---
  const pending = useRef<LanePatch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const version = useRef(0);
  const inflight = useRef<Promise<LaneOffer | null> | null>(null);

  const flush = useCallback(async (extra: LanePatch = {}): Promise<LaneOffer | null> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (inflight.current) await inflight.current;
    const body = { ...pending.current, ...extra };
    pending.current = {};
    if (!offer?.id) return offer;
    if (!Object.keys(body).length) return offer;
    const mine = ++version.current;
    const run = api.saveLaneOffer(offer.id, body).then((r) => {
      // Only the newest save's answer is drawn; an older one would undo keys typed since.
      // The server's draft, keeping what only the screen knows (an age range still being typed).
      if (mine === version.current && !Object.keys(pending.current).length) setOffer((prev) => ({ ...r.offer, ageRangePending: (prev as { ageRangePending?: boolean } | null)?.ageRangePending } as LaneOffer));
      setError(null);
      return r.offer;
    }).catch((e) => {
      // Put what failed back, so the next save sends it again rather than losing it (Codex, 2 Oct 2026).
      pending.current = { ...body, ...pending.current };
      setError(e.message); showToast(e.message); return null;
    });
    inflight.current = run;
    const out = await run;
    inflight.current = null;
    return out;
  }, [offer]);

  const update = useCallback((patch: LanePatch) => {
    setOffer((o) => (o ? { ...o, ...(patch as Partial<LaneOffer>) } : o));
    // Screen-only keys never go to the server.
    const { ageRangePending: _local, ...saved } = patch as LanePatch & { ageRangePending?: boolean };
    if (!Object.keys(saved).length) return;
    pending.current = { ...pending.current, ...saved };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 700);
  }, [flush]);
  // Leaving by the browser's back, a reload or closing the tab still sends what was typed in
  // the last moment before the save fired (Codex, 2 Oct 2026).
  const idRef = useRef<string | null>(null);
  idRef.current = offer?.id || null;
  useEffect(() => {
    const send = () => {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      const body = pending.current; const id = idRef.current;
      if (!id || !Object.keys(body).length) return;
      pending.current = {};
      // After any save still in flight, never alongside it, so the newest edit lands last (Codex, 2 Oct 2026).
      const go = () => api.saveLaneOfferOnLeave(id, body).catch(() => null);
      if (inflight.current) void inflight.current.then(go, go); else void go();
    };
    const w = typeof window !== 'undefined' && typeof window.addEventListener === 'function' ? window : null;
    w?.addEventListener('pagehide', send);
    return () => { w?.removeEventListener('pagehide', send); send(); };
  }, []);

  /** Make the draft if there is none yet, with everything chosen so far. */
  const ensureSaved = useCallback(async (extra: LanePatch = {}): Promise<LaneOffer | null> => {
    if (!lane || !offer) return null;
    if (offer.id) return flush(extra);
    const body: LanePatch = { whatCategory: offer.whatCategory, whatLabel: offer.whatLabel, title: offer.title, line: offer.line, lineSuggested: offer.lineSuggested, ...pending.current, ...extra } as LanePatch;
    pending.current = {};
    if ((offer.photos ?? []).length) (body as any).photoIds = offer.photos.map((p) => p.id);
    const r = await api.createLaneOffer(lane, { ...body, draftSource: offer.draftSource ?? 'typed' } as LanePatch);
    setOffer(r.offer);
    return r.offer;
  }, [lane, offer, flush]);

  // --- moving --------------------------------------------------------------
  const goStep = useCallback(async (to: StepKey) => {
    const saved = await ensureSaved({ draftStep: to } as LanePatch);
    if (!saved) return;
    navigate(paths.hostSetup(saved.id, to), { replace: !offerId });
  }, [ensureSaved, navigate, offerId]);

  const next = async () => {
    if (!offer || !lane) return;
    setBusy(true);
    try {
      if (mode === 'draft') await goStep(steps[1]);
      else if (index < steps.length - 1) await goStep(steps[index + 1]);
      else {
        const saved = await ensureSaved({ draftStep: 'publish' } as LanePatch);
        if (saved) navigate(paths.hostPublish(saved.id));
      }
    } catch (e: any) { setError(e.message); showToast(e.message); } finally { setBusy(false); }
  };

  const goBack = async () => {
    if (mode) { setQuery({ mode: null }, { replace: false }); return; }
    if (offer?.id) await flush();
    if (index === 0) { if (lane) navigate(paths.hostLane(lane)); return; }
    back(offer?.id ? paths.hostSetup(offer.id, steps[index - 1]) : paths.host());
  };

  const finishLater = async () => {
    setBusy(true);
    try {
      if (offer && (offer.id || offer.whatLabel)) {
        // Only leave once it is saved: a failed save keeps the host here, with the message shown (Codex, 2 Oct 2026).
        const saved = await ensureSaved({ draftStep: step } as LanePatch);
        if (!saved) return;
      }
      navigate(paths.host());
    } catch (e: any) { showToast(e.message); } finally { setBusy(false); }
  };

  if (error && !offer) return <View style={styles.centre}><Text style={tx(14, '400')}>{error}</Text></View>;
  if (!offer || !lane || !home) return <View style={styles.centre}><Text style={tx(14, '400')}>One moment…</Text></View>;

  const look = LANES[lane];
  const holidays = holidayMap(home.config.bankHolidays);
  const reload = async () => { if (!offer.id) return; await flush(); const r = await api.laneOffer(offer.id); setOffer(r.offer); };
  const props: StepProps = { offer, lane, config: home.config, home, holidays, update, goStep: (s) => { void goStep(s); }, reload };
  const View_ = STEP_VIEWS[step];

  // Say it, Upload it and the draft are modes over step 1 (and the mic's Say it over any step).
  // Only once the draft is really gone: a failed delete keeps the host on it and says so (Codex, 2 Oct 2026).
  const startAgain = async () => {
    if (offer.id) { try { await api.deleteLaneOffer(offer.id); } catch (e: any) { showToast(e.message); return; } }
    navigate(paths.hostCompose(lane), { replace: true });
  };
  const body = mode === 'say' ? <SayIt {...props} step={step} setBar={setModeBar} onBuilt={(o) => { setOffer(o); if (step === 'what') navigate(paths.hostSetup(o.id, 'what', 'draft'), { replace: true }); else navigate(paths.hostSetup(o.id, step), { replace: true }); }} />
    : mode === 'upload' ? <UploadIt {...props} setBar={setModeBar} onBuilt={(o) => { setOffer(o); navigate(paths.hostSetup(o.id, 'what', 'draft'), { replace: true }); }} />
      : mode === 'draft' ? <YourDraft {...props} onStartAgain={() => { void startAgain(); }} />
        : step === 'what' ? <WhatStep {...props} onSay={() => setQuery({ mode: 'say' }, { replace: false })} onUpload={() => setQuery({ mode: 'upload' }, { replace: false })} />
          : View_ ? <View_ {...props} /> : null;

  const ok = mode ? true : canGoOn(offer, step, home.config.adultAge);
  const label = mode === 'say' || mode === 'upload' ? '' : mode === 'draft' ? 'Go through it step by step'
    : index < steps.length - 1 ? `Next · ${SHORT[steps[index + 1]]}` : 'Next · Publish';
  const link = step === 'cohosts' && !mode ? { t: 'Just me — skip', go: () => { update({ cohosts: [] }); void next(); } }
    : mode === 'draft' ? { t: 'Start again', go: () => { void startAgain(); } }
      : mode ? null : { t: 'Save and finish later', go: () => { void finishLater(); } };
  const reached = index;
  const showTitle = !mode;

  return (
    <View style={[styles.page, wide && styles.wide]}>
      {/* The step header: the lane's band, back, the tag, Preview, the mic; then a bar per step. */}
      <View style={{ backgroundColor: look.bg }}>
        <View style={styles.headRow}>
          <Press onPress={() => { void goBack(); }} accessibilityRole="button" accessibilityLabel="Back" style={[{ paddingVertical: 4 }, pointer]}>
            <Icon name="previous" size={22} color={look.fg} strokeWidth={2} />
          </Press>
          <View style={styles.tag}><Text style={styles.tagText}>{look.tag}</Text></View>
          <View style={{ flex: 1 }} />
          <Press onPress={() => setQuery({ preview: '1' }, { replace: false })} accessibilityRole="button" accessibilityLabel="Preview"
            style={[styles.preview, { backgroundColor: look.chip }, pointer]}>
            <Icon name="preview" size={15} color={look.fg} strokeWidth={2} />
            <Text style={tx(13, '700', look.fg)}>Preview</Text>
          </Press>
          <Press onPress={() => setQuery({ mode: mode === 'say' ? null : 'say' }, { replace: false })} accessibilityRole="button" accessibilityLabel={mode === 'say' ? 'Stop listening' : 'Say it'}
            style={[styles.mic, { backgroundColor: mode === 'say' ? INK : LIME }, pointer]}>
            <Icon name="mic" size={17} color={mode === 'say' ? LIME : INK} strokeWidth={2.2} />
          </Press>
        </View>
        <View style={styles.bars}>
          {steps.map((s, i) => <View key={s} style={[styles.bar, { backgroundColor: i <= reached ? look.fg : look.lo }]} />)}
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {showTitle ? <StepTitle title={titleOf(lane, step)} count={`${index + 1} of ${steps.length}`} /> : null}
        {body}
      </ScrollView>

      {mode === 'say' || mode === 'upload'
        ? (modeBar ? <ActionBar label={modeBar.label} onPress={modeBar.onPress} disabled={modeBar.disabled} busy={modeBar.busy} /> : null)
        : <ActionBar label={label} onPress={() => { void next(); }} disabled={!ok} busy={busy} link={link} />}

      {previewing ? <Preview offer={offer} lane={lane} config={home.config} home={home} step={step} onClose={() => back(offer.id ? paths.hostSetup(offer.id, step) : paths.hostCompose(lane))} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: CREAM },
  wide: { maxWidth: 560, width: '100%', alignSelf: 'center' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: CREAM },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 12, paddingHorizontal: 20 },
  tag: { backgroundColor: LIME, paddingVertical: 3, paddingHorizontal: 7 },
  tagText: { fontFamily: fonts.heading, fontSize: 13, fontWeight: '800', color: INK },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 11 },
  mic: { width: 36, height: 32, alignItems: 'center', justifyContent: 'center' },
  bars: { flexDirection: 'row', gap: 4, paddingTop: 14, paddingHorizontal: 20, paddingBottom: 14 },
  bar: { flex: 1, height: 3 },
  body: { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
});
