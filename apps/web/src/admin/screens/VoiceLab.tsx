/**
 * The voice lab — the back office screen for the experiment the owner's brief
 * of 8 Sep 2026 asks for: "build record-then-send, realtime, and streamed-file
 * behind a switch, and compare them on the same utterances for accuracy,
 * perceived speed, and how they feel to use."
 *
 * Two sections, because they are two different questions:
 *
 *   Try one    Read a sentence from the list (place names, self-corrections,
 *              a few not in English) or say your own. One recording is heard
 *              every way at once: live captions while you speak, then the
 *              recording sent whole and sent streamed. The three transcripts
 *              sit side by side with the time each took, the word error rate
 *              against the sentence, and what stage two made of each — and
 *              whether the live words would have produced a different plan.
 *   The tally  Every run so far, added up per mode: how wrong, how slow, how
 *              often the captions and the recording disagreed, and how often
 *              that changed the plan. The numbers the default is chosen on.
 *
 * The lab always runs every mode whatever Settings › Voice is set to; the
 * setting is what the household app uses, and is recorded against each run.
 *
 * Layout follows the shell's rule (CLAUDE.md): width from `useViewport`, one
 * tree with different styles rather than two returns, nothing over 390px.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, VoiceCaptureMode, VoiceLabInfo, VoiceModeResult, VoiceProbe, VoiceRun, VoiceRuns, VoiceUtterance } from '../../api';
import { colors, spacing, type, BORDER } from '../../theme';
import { Button, Row, Wrap } from '../../components/ui';
import { useViewport } from '../../hooks/useViewport';
import { AdminPage, Banner, DataTable, FilterChip, FilterRow, PageHead, Panel, Pill, Tile, TileRow, ago } from '../kit';
import { LiveTranscriber, LiveState } from '../../voice/live';
import { Recorder, closeMicrophone, openMicrophone, pickMime, recordingSupported } from '../../voice/recorder';
import { transcribeRecording } from '../../voice/client';
import { getVoiceMode, voiceModeLabel } from '../../voice/settings';

const WIDE = 900;
const MODES: { key: VoiceCaptureMode; label: string; what: string }[] = [
  { key: 'live', label: 'Live', what: 'captions while you spoke' },
  { key: 'batch', label: 'Recording', what: 'the whole recording, sent after Done' },
  { key: 'stream', label: 'Streamed', what: 'the same recording, answered a few words at a time' },
];

type Stage = 'idle' | 'recording' | 'working' | 'done';
type Live = { text: string; ms: number | null; model: string | null; error: string | null; reconnects: number };

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const ms = (v: number | null | undefined) => (v == null ? '—' : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`);
const device = () => {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return 'native';
  const ua = navigator.userAgent;
  const browser = /CriOS|Chrome/.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : 'other';
  return `${browser} on ${os} · ${pickMime().split(';')[0] || 'no recorder'}`;
};

export function VoiceLab() {
  const { width } = useViewport();
  const wide = width >= WIDE;

  const [info, setInfo] = useState<VoiceLabInfo | null>(null);
  const [runs, setRuns] = useState<VoiceRuns | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pick, setPick] = useState<string>('lisbon-correction');
  const [stage, setStage] = useState<Stage>('idle');
  const [live, setLive] = useState<LiveState | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [streamText, setStreamText] = useState('');
  const [partial, setPartial] = useState<Partial<Record<VoiceCaptureMode, VoiceModeResult>>>({});
  const [run, setRun] = useState<VoiceRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [probe, setProbe] = useState<VoiceProbe | 'busy' | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const liveRef = useRef<LiveTranscriber | null>(null);
  const tickRef = useRef<any>(null);
  const startedRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const [i, r] = await Promise.all([api.voiceLab(), api.voiceRuns(200)]);
      setInfo(i); setRuns(r); setLoadError(null);
    } catch (e: any) { setLoadError(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { clearInterval(tickRef.current); recorderRef.current?.cancel(); liveRef.current?.cancel(); closeMicrophone(streamRef.current); }, []);

  const utterance: VoiceUtterance | null = useMemo(() => info?.utterances.find((u) => u.id === pick) ?? null, [info, pick]);

  const record = async () => {
    setError(null); setRun(null); setPartial({}); setStreamText(''); setLive(null);
    let stream: MediaStream;
    try { stream = await openMicrophone(); } catch (e: any) { setError(e.message); return; }
    streamRef.current = stream;
    const rec = new Recorder();
    try { rec.start(stream); } catch { setError('The microphone could not be recorded in this browser.'); closeMicrophone(stream); return; }
    recorderRef.current = rec;
    const lt = new LiveTranscriber({ language: utterance?.language ?? null, onChange: setLive });
    liveRef.current = lt;
    lt.start(stream).catch(() => {});
    startedRef.current = Date.now();
    setSeconds(0);
    clearInterval(tickRef.current);
    tickRef.current = setInterval(() => setSeconds(Math.floor((Date.now() - startedRef.current) / 1000)), 500);
    setStage('recording');
  };

  const done = async () => {
    clearInterval(tickRef.current);
    setStage('working');
    const rec = recorderRef.current; const lt = liveRef.current;
    recorderRef.current = null; liveRef.current = null;
    const [recording, liveResult] = await Promise.all([rec ? rec.stop() : Promise.resolve(null), lt ? lt.stop() : Promise.resolve(null)]);
    closeMicrophone(streamRef.current); streamRef.current = null;
    const results: Partial<Record<VoiceCaptureMode, VoiceModeResult>> = {};
    if (liveResult) results.live = { transcript: liveResult.transcript || null, ms: liveResult.ms, model: liveResult.model, error: liveResult.error };
    setPartial({ ...results });
    if (!recording?.blob.size) { setError('Nothing was recorded.'); setStage('idle'); return; }
    const language = utterance?.language ?? null;
    const common = { blob: recording.blob, mime: recording.mime, seconds: recording.seconds, language };
    const [batch, stream] = await Promise.all([
      transcribeRecording({ ...common, stream: false }).then((o) => ({ transcript: o.transcript, ms: o.clientMs, model: o.model, error: null }), (e) => ({ transcript: null, ms: null, model: null, error: e.message })),
      transcribeRecording({ ...common, stream: true, onDelta: (d) => setStreamText((t) => t + d) }).then((o) => ({ transcript: o.transcript, ms: o.clientMs, model: o.model, error: null }), (e) => ({ transcript: null, ms: null, model: null, error: e.message })),
    ]);
    results.batch = batch; results.stream = stream;
    setPartial({ ...results });
    try {
      const saved = await api.voiceRecordRun({
        utteranceId: utterance?.id ?? null, reference: utterance?.text ?? null, language, mode: getVoiceMode(),
        results, device: device(), plan: true,
      });
      setRun(saved.run);
      setStage('done');
      void load();
    } catch (e: any) { setError(e.message); setStage('done'); }
  };

  const cancel = () => {
    clearInterval(tickRef.current);
    recorderRef.current?.cancel(); recorderRef.current = null;
    liveRef.current?.cancel(); liveRef.current = null;
    closeMicrophone(streamRef.current); streamRef.current = null;
    setStage('idle'); setLive(null);
  };

  const remove = async (id: string) => { await api.voiceDeleteRun(id).catch(() => {}); setOpen(null); void load(); };

  const columns = useMemo(() => [
    { key: 'when', head: 'When', width: 1, cell: (r: VoiceRun) => <Text style={type.small}>{ago(r.created_at)}</Text>, sort: (r: VoiceRun) => r.created_at },
    { key: 'what', head: 'Sentence', width: 2, cell: (r: VoiceRun) => <Text style={type.small} numberOfLines={1}>{r.utterance_id ?? (r.reference ? 'own sentence' : 'free speech')}</Text> },
    { key: 'live', head: 'Live', width: 1, align: 'right' as const, cell: (r: VoiceRun) => <Text style={type.small}>{pct(r.accuracy.live?.wer)} · {ms(r.results.live?.ms)}</Text>, sort: (r: VoiceRun) => r.accuracy.live?.wer ?? 9 },
    { key: 'batch', head: 'Recording', width: 1, align: 'right' as const, cell: (r: VoiceRun) => <Text style={type.small}>{pct(r.accuracy.batch?.wer)} · {ms(r.results.batch?.ms)}</Text>, sort: (r: VoiceRun) => r.accuracy.batch?.wer ?? 9 },
    { key: 'stream', head: 'Streamed', width: 1, align: 'right' as const, wideOnly: true, cell: (r: VoiceRun) => <Text style={type.small}>{pct(r.accuracy.stream?.wer)} · {ms(r.results.stream?.ms)}</Text> },
    { key: 'agree', head: 'Live vs rec.', width: 1, align: 'right' as const, wideOnly: true, cell: (r: VoiceRun) => <Text style={type.small}>{r.live_vs_batch == null ? '—' : pct(r.live_vs_batch)}</Text>, sort: (r: VoiceRun) => r.live_vs_batch ?? -1 },
    { key: 'plan', head: 'Plan', width: 1, wideOnly: true, cell: (r: VoiceRun) => r.plan_changed == null ? <Text style={type.small}>—</Text> : <Pill label={r.plan_changed ? 'changed' : 'same'} tone={r.plan_changed ? 'warn' : 'ok'} /> },
  ], []);

  const t = runs?.tally;
  const a = runs?.agreement;
  const shownLive = live ? [live.committed, live.partial].filter(Boolean).join(' ') : '';

  return (
    <AdminPage>
      <PageHead title="Voice lab" sub="One recording, heard three ways. Read a sentence, tap Done, and see which way got the words — and the plan — right." />

      {loadError ? <Banner tone="warn">{loadError}</Banner> : null}
      {info && !info.configured ? <Banner tone="warn">Voice is not set up on this server: OPENAI_API_KEY is missing. Adding it is the owner's, in Doppler.</Banner> : null}
      {info?.switchedOff ? <Banner tone="warn">OpenAI voice is switched off in Settings › Providers. Nothing here will run until it is on.</Banner> : null}
      {!recordingSupported() ? <Banner tone="warn">This browser cannot record. Open the lab in Chrome or Safari on a device with a microphone.</Banner> : null}

      {/* The provider's own words, when something refuses. The household's
          screens say "Epic couldn't hear that just now" and no more; this is
          the one place the sentence behind that belongs. */}
      <Panel title="The connection" sub="Opens one live session and sends a fifth of a second of silence to the file endpoint, and says what came back — a wrong model name or a refused setting reads as a sentence here rather than a guess." right={<Button label={probe === 'busy' ? 'Checking…' : 'Check now'} kind="secondary" onPress={async () => { setProbe('busy'); try { setProbe(await api.voiceProbe()); } catch (e: any) { setProbe({ configured: false, switchedOff: false, live: { ok: false, code: 'failed', message: e.message, detail: null }, transcribe: null }); } }} disabled={probe === 'busy'} />}>
        {probe && probe !== 'busy' ? (
          <View style={{ gap: 6 }}>
            {(['live', 'transcribe'] as const).map((k) => {
              const r = probe[k];
              if (!r) return <Text key={k} style={type.small}>{k === 'live' ? 'Live session' : 'File endpoint'}: not tried{!probe.configured ? ' — no key' : probe.switchedOff ? ' — switched off' : ''}.</Text>;
              return (
                <View key={k} style={{ gap: 2 }}>
                  <Row><Pill label={r.ok ? 'ok' : 'refused'} tone={r.ok ? 'ok' : 'crit'} /><Text style={type.small}>{k === 'live' ? 'Live session' : 'File endpoint'}{r.ok ? ` · ${r.model}${r.fellBack ? ' (fell back)' : ''}${r.dropped?.length ? ` · without ${r.dropped.join(', ')}` : ''}${'ms' in r ? ` · ${ms(r.ms)}` : ''}` : ` · ${r.code}: ${r.message}`}</Text></Row>
                  {!r.ok && r.detail ? <Text style={[type.tiny, { color: colors.overrun }]}>Provider said: {r.detail}</Text> : null}
                  {r.ok && 'url' in r ? <Text style={type.tiny}>{r.url}</Text> : null}
                </View>
              );
            })}
          </View>
        ) : <Text style={type.tiny}>Costs a fraction of a cent. Nothing is kept.</Text>}
      </Panel>

      {/* --- Try one ------------------------------------------------------- */}
      <Panel title="Try one" sub={`The app is set to “${voiceModeLabel(getVoiceMode())}”; the lab runs every way regardless. Models: ${info ? `${info.models.live} · ${info.models.transcribe} · ${info.models.plan}` : '…'}`}>
        <FilterRow>
          {(info?.utterances ?? []).map((u) => <FilterChip key={u.id} label={`${u.id} · ${u.language}`} on={pick === u.id} onPress={() => stage === 'idle' || stage === 'done' ? setPick(u.id) : null} />)}
          <FilterChip label="say your own" on={pick === 'free'} onPress={() => stage === 'idle' || stage === 'done' ? setPick('free') : null} />
        </FilterRow>
        {utterance ? (
          <View style={styles.reference}>
            <Text style={type.tiny}>READ THIS ALOUD, MISTAKES AND ALL</Text>
            <Text style={styles.referenceText}>{utterance.text}</Text>
            {utterance.note ? <Text style={type.tiny}>{utterance.note}</Text> : null}
          </View>
        ) : <Text style={type.small}>Say anything about a trip or a day out. With no sentence to compare against there is no word error rate, but the three transcripts, their timings and whether the plans agree are still recorded.</Text>}

        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Row>
            {stage === 'recording' ? <View style={styles.dot} /> : null}
            <Text style={type.body}>{stage === 'recording' ? `Recording · ${seconds}s` : stage === 'working' ? 'Hearing it three ways…' : stage === 'done' ? 'Done' : 'Ready'}</Text>
            {stage === 'working' ? <ActivityIndicator color={colors.accent} /> : null}
          </Row>
          <Row>
            {stage === 'recording' ? <Button label="Cancel" kind="ghost" onPress={cancel} /> : null}
            {stage === 'recording'
              ? <Button label="Done" icon="stop" onPress={done} disabled={seconds < 1} />
              : <Button label={stage === 'done' ? 'Record another' : 'Record'} icon="mic" onPress={record} disabled={stage === 'working' || !recordingSupported() || !info?.configured} />}
          </Row>
        </Row>

        {stage === 'recording' || (stage === 'working' && shownLive) ? (
          <View style={styles.captions}>
            <Text style={type.tiny}>LIVE · {live?.status ?? 'connecting'}{live?.reconnects ? ` · reconnected ${live.reconnects}×` : ''}</Text>
            <Text style={styles.captionText}>{live?.committed}{live?.partial ? <Text style={{ color: colors.inkMuted }}>{live.committed ? ' ' : ''}{live.partial}</Text> : null}{!shownLive ? <Text style={{ color: colors.inkFaint }}>{live?.status === 'failed' ? live.error : 'Listening…'}</Text> : null}</Text>
          </View>
        ) : null}

        {stage === 'working' || stage === 'done' ? (
          <View style={[styles.columns, !wide && styles.columnsPhone]}>
            {MODES.map((m) => {
              const r = run?.results[m.key] ?? partial[m.key];
              const acc = run?.accuracy[m.key];
              const plan = run?.plans[m.key];
              const text = r?.transcript ?? (m.key === 'stream' && stage === 'working' ? streamText : null);
              return (
                <View key={m.key} style={[styles.column, !wide && styles.columnPhone]}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Text style={type.h3}>{m.label}</Text>
                    {r?.ms != null ? <Pill label={ms(r.ms)} tone="plain" /> : stage === 'working' ? <ActivityIndicator color={colors.accent} /> : null}
                  </Row>
                  <Text style={type.tiny}>{m.what}{r?.model ? ` · ${r.model}` : ''}</Text>
                  <Text style={[styles.transcript, !text && { color: colors.inkFaint }]}>{text || (r?.error ? r.error : '…')}</Text>
                  {acc ? <Text style={type.small}><Text style={{ fontWeight: '700', color: colors.ink }}>{pct(acc.wer)} wrong</Text> · {acc.errors} of {acc.words} words ({acc.substitutions} swapped, {acc.deletions} missed, {acc.insertions} added)</Text> : null}
                  {plan?.intent ? (
                    <View style={styles.plan}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Text style={type.tiny}>STAGE TWO · {ms(plan.ms)}</Text>
                        {plan.expectation ? <Pill label={plan.expectation.ok ? 'right' : `missed ${plan.expectation.misses.length}`} tone={plan.expectation.ok ? 'ok' : 'warn'} /> : null}
                      </Row>
                      <Text style={type.small}>{plan.intent.summary}</Text>
                      <Text style={type.tiny}>
                        {[plan.intent.destination && `to ${plan.intent.destination}`, plan.intent.origin && `from ${plan.intent.origin}`, plan.intent.dates.start && `${plan.intent.dates.start}${plan.intent.dates.end ? `→${plan.intent.dates.end}` : ''}`, plan.intent.dates.duration_days && `${plan.intent.dates.duration_days} days`, plan.intent.party.adults != null && `${plan.intent.party.adults} adults`, plan.intent.party.children != null && `${plan.intent.party.children} children${plan.intent.party.ages.length ? ` (${plan.intent.party.ages.join(', ')})` : ''}`, plan.intent.budget.amount != null && `${plan.intent.budget.amount} ${plan.intent.budget.currency ?? ''}${plan.intent.budget.per ? ` per ${plan.intent.budget.per}` : ''}`, plan.intent.budget.level, plan.intent.trip_type, plan.intent.language && `lang ${plan.intent.language}`].filter(Boolean).join(' · ')}
                      </Text>
                      {plan.intent.interests.length ? <Text style={type.tiny}>wants: {plan.intent.interests.join(', ')}</Text> : null}
                      {plan.intent.exclusions.length ? <Text style={type.tiny}>not: {plan.intent.exclusions.join(', ')}</Text> : null}
                      {plan.intent.accessibility.length ? <Text style={type.tiny}>access: {plan.intent.accessibility.join(', ')}</Text> : null}
                      {plan.intent.corrections.length ? <Text style={type.tiny}>corrected: {plan.intent.corrections.map((c) => `${c.field} ${c.from} → ${c.to}`).join('; ')}</Text> : null}
                      {plan.intent.ambiguities.length ? <Text style={type.tiny}>would ask: {plan.intent.ambiguities.map((q) => q.question).join(' ')}</Text> : null}
                      {plan.expectation && !plan.expectation.ok ? <Text style={[type.tiny, { color: colors.overrun }]}>missed: {plan.expectation.misses.map((x) => `${x.path} wanted ${JSON.stringify(x.want)}, got ${JSON.stringify(x.got)}`).join('; ')}</Text> : null}
                    </View>
                  ) : plan?.error ? <Text style={[type.tiny, { color: colors.overrun }]}>Stage two: {plan.error}</Text> : null}
                </View>
              );
            })}
          </View>
        ) : null}

        {run ? (
          <Banner tone={run.plan_changed ? 'warn' : run.plan_changed === false ? 'ok' : 'plain'}>
            {run.live_vs_batch == null
              ? 'Live and the recording could not be compared on this run.'
              : `Live and the recording differed by ${pct(run.live_vs_batch)} of the words${run.plan_changed == null ? '.' : run.plan_changed ? `, and that changed the plan: ${run.plan_diff.map((d) => d.field).join(', ')}.` : ', and the plan came out the same.'}`}
          </Banner>
        ) : null}
        {error ? <Banner tone="crit">{error}</Banner> : null}
      </Panel>

      {/* --- The tally ----------------------------------------------------- */}
      <Panel title="The tally" sub={runs ? `${runs.runs.length} runs. Word error rate is the share of words wrong against the sentence read; time is from tapping Done to having the words.` : 'Loading…'}>
        {t ? (
          <TileRow>
            {MODES.map((m) => <Tile key={m.key} label={m.label} value={pct(t[m.key].meanWer)} sub={`wrong on average · ${ms(t[m.key].medianMs)} to words · plan right ${pct(t[m.key].planRight)} · ${t[m.key].runs} runs${t[m.key].errors ? `, ${t[m.key].errors} failed` : ''}`} tone={m.key === 'batch' ? 'accent' : 'plain'} />)}
            <Tile label="Live vs recording" value={pct(a?.disagreementRate)} sub={`of ${a?.compared ?? 0} runs disagreed · ${pct(a?.meanLiveVsBatch)} of words apart on average`} tone={a?.disagreementRate ? 'warn' : 'plain'} />
            <Tile label="Changed the plan" value={pct(a?.planChangedRate)} sub={`of ${a?.planJudged ?? 0} runs where both plans were made`} tone={a?.planChangedRate ? 'crit' : 'ok'} />
          </TileRow>
        ) : null}
        {runs ? (
          <DataTable
            rows={runs.runs}
            columns={columns}
            onRow={(r) => setOpen((cur) => (cur === r.id ? null : r.id))}
            empty="No runs yet. Read a sentence above."
            initialSort={{ key: 'when', dir: 'desc' }}
          />
        ) : null}
        {open ? (() => {
          const r = runs?.runs.find((x) => x.id === open);
          if (!r) return null;
          return (
            <View style={styles.detail}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={type.h3}>{r.utterance_id ?? 'free speech'} · {ago(r.created_at)}</Text>
                <Button label="Delete this run" kind="ghost" onPress={() => remove(r.id)} />
              </Row>
              <Text style={type.tiny}>{r.device ?? ''}{r.mode ? ` · app set to ${r.mode}` : ''}{r.language ? ` · ${r.language}` : ''}</Text>
              {r.reference ? <Text style={type.small}><Text style={{ fontWeight: '700', color: colors.ink }}>Read: </Text>{r.reference}</Text> : null}
              {MODES.map((m) => r.results[m.key] ? (
                <Text key={m.key} style={type.small}>
                  <Text style={{ fontWeight: '700', color: colors.ink }}>{m.label} ({pct(r.accuracy[m.key]?.wer)} · {ms(r.results[m.key]?.ms)}): </Text>
                  {r.results[m.key]?.transcript ?? r.results[m.key]?.error ?? '—'}
                </Text>
              ) : null)}
              {r.plan_diff.length ? <Text style={type.tiny}>Plan differed on: {r.plan_diff.map((d) => `${d.field} (live ${JSON.stringify(d.a)} vs recording ${JSON.stringify(d.b)})`).join('; ')}</Text> : null}
            </View>
          );
        })() : null}
      </Panel>

      <Panel title="What is measured, and what is not">
        <Text style={type.small}>Word error rate: the reference sentence and the transcript are folded to lower-case words with no punctuation, then compared word by word. A place name misheard is one substitution, which is exactly what it should be.</Text>
        <Text style={type.small}>Time: for the recording and the streamed form, from tapping Done to having the whole transcript on this device, upload included. For live, from tapping Done to the last caption settling — the words were already there.</Text>
        <Text style={type.small}>Stage two runs on each transcript separately, on the server, through the same purse as the app. The plan is judged changed when any field but the summary differs between the live and the recording transcripts.</Text>
        <Text style={type.small}>Nothing here keeps the audio. The transcripts are kept — they are the household's own words — so a run can be argued with later; delete a run and they go.</Text>
      </Panel>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  reference: { gap: 4, padding: spacing.md, borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface },
  referenceText: { fontSize: 18, lineHeight: 26, color: colors.ink },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.overrun },
  captions: { gap: 4, padding: spacing.md, borderWidth: BORDER, borderColor: colors.accent, minHeight: 80 },
  captionText: { fontSize: 18, lineHeight: 26, color: colors.ink },
  columns: { flexDirection: 'row', gap: spacing.md },
  columnsPhone: { flexDirection: 'column' },
  column: { flex: 1, gap: 6, padding: spacing.md, borderWidth: BORDER, borderColor: colors.line, minWidth: 0 },
  columnPhone: { flex: 0 },
  transcript: { fontSize: 15, lineHeight: 22, color: colors.ink },
  plan: { gap: 3, marginTop: 4, paddingTop: 6, borderTopWidth: 1, borderTopColor: colors.line },
  detail: { gap: 6, padding: spacing.md, borderWidth: BORDER, borderColor: colors.line, marginTop: spacing.sm },
});
