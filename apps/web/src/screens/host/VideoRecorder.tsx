/**
 * Record your video (Events v4 canvas D1; Hosts and Events H2).
 *
 * Self-shot is the default and it should feel like a video message, not a
 * screen test: the camera fills the screen, a prompt script sits over it and
 * ticks itself off as the seconds go by ("Say your name and where you are" /
 * "Say what we are going to do together" / "Say what you love about it"), a
 * take counter, retake, a simple trim, and Use this one. Thirty to sixty
 * seconds is plenty; the recorder stops itself at the cap.
 *
 * One video per offer, plus the profile intro: `?offer=<id>` says which this
 * is for, and the recording lands on that row. Epic-made is offered quietly
 * underneath — send us your raw clips — as a state, not a service that exists.
 *
 * Browser only. The bytes go to `POST /api/host/media` as the body; nothing is
 * transcoded here, and the trim is two marks the player honours.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Press } from '../../components/press';
import { api } from '../../api';
import { colors, fonts, spacing, type, BORDER, INK, LIME, CREAM } from '../../theme';
import { Button, Row, StatusLine } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useViewport } from '../../hooks/useViewport';
import { useRouter } from '../../router';
import { paths } from '../../routes';
import { clock } from '../../components/voice/kit';

const MAX_S = 60;
const SCRIPT = [
  { at: 0, text: 'Say your name and where you are' },
  { at: 12, text: 'Say what we are going to do together' },
  { at: 30, text: 'Say what you love about it' },
];

type Stage = 'ask' | 'ready' | 'recording' | 'review' | 'uploading' | 'done';

export function VideoRecorder({ offerId, title, onDone }: { offerId: string | null; title?: string | null; onDone: (mediaId: string) => void }) {
  const { width } = useViewport();
  const { back } = useRouter();
  const [stage, setStage] = useState<Stage>('ask');
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [take, setTake] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [trim, setTrim] = useState<{ start: number; end: number } | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<BlobPart[]>([]);
  const live = useRef<any>(null);
  const player = useRef<any>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const supported = Platform.OS === 'web' && typeof navigator !== 'undefined' && Boolean((navigator as any).mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';

  const stopStream = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  useEffect(() => () => { stopStream(); if (tick.current) clearInterval(tick.current); }, []);

  const open = useCallback(async () => {
    setError(null);
    try {
      const s = await (navigator as any).mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true });
      stream.current = s;
      if (live.current) { live.current.srcObject = s; live.current.muted = true; void live.current.play?.(); }
      setStage('ready');
    } catch (e: any) {
      setError(e?.name === 'NotAllowedError' ? 'The camera was refused. Allow it in the browser and try again, or upload a video instead.' : 'No camera could be opened here. Upload a video instead.');
    }
  }, []);

  // The live preview element mounts after `ready`; attach the stream then too.
  useEffect(() => { if (live.current && stream.current && (stage === 'ready' || stage === 'recording')) { live.current.srcObject = stream.current; live.current.muted = true; void live.current.play?.(); } }, [stage]);

  const mime = () => ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => (MediaRecorder as any).isTypeSupported?.(m)) ?? '';

  const start = () => {
    if (!stream.current) return;
    chunks.current = [];
    const r = new MediaRecorder(stream.current, mime() ? { mimeType: mime(), videoBitsPerSecond: 1_500_000 } : undefined);
    r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    r.onstop = () => {
      const b = new Blob(chunks.current, { type: r.mimeType || 'video/webm' });
      setBlob(b); setTrim(null); setStage('review');
      if (tick.current) clearInterval(tick.current);
    };
    recorder.current = r;
    r.start(500);
    setSeconds(0); setTake((t) => t + 1); setStage('recording');
    tick.current = setInterval(() => setSeconds((s) => {
      if (s + 1 >= MAX_S) { r.state === 'recording' && r.stop(); return MAX_S; }
      return s + 1;
    }), 1000);
  };
  const stop = () => { if (recorder.current?.state === 'recording') recorder.current.stop(); };
  const retake = () => { setBlob(null); setTrim(null); setStage(stream.current ? 'ready' : 'ask'); if (!stream.current) void open(); };

  const upload = async (file?: Blob, duration?: number) => {
    const b = file ?? blob;
    if (!b) return;
    setStage('uploading'); setError(null);
    try {
      const m = await api.uploadHostMedia(b, 'video', duration ?? seconds);
      if (trim && (trim.start > 0 || trim.end < seconds)) await api.trimHostMedia(m.id, trim.start, trim.end);
      if (offerId) await api.updateOffer(offerId, { videoId: m.id });
      else await api.updateHost({ introVideoId: m.id });
      stopStream();
      setStage('done');
      onDone(m.id);
    } catch (e: any) { setError(e.message); setStage('review'); }
  };

  const pickFile = () => {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'video/*';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      if (f.size > 40 * 1024 * 1024) { setError('That video is too big. Thirty to sixty seconds is plenty.'); return; }
      const url = URL.createObjectURL(f);
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => { const d = Math.round(v.duration || 0); URL.revokeObjectURL(url); setSeconds(d); void upload(f, d || undefined); };
      v.onerror = () => { URL.revokeObjectURL(url); void upload(f); };
      v.src = url;
    };
    input.click();
  };

  const scriptDone = (i: number) => (stage === 'recording' ? seconds >= (SCRIPT[i + 1]?.at ?? MAX_S) : stage === 'review');
  const scriptNow = SCRIPT.findIndex((s, i) => seconds >= s.at && seconds < (SCRIPT[i + 1]?.at ?? MAX_S));
  const height = Math.min(520, Math.round(width * 1.15));
  const previewUrl = blob ? URL.createObjectURL(blob) : null;
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  return (
    <View style={styles.page}>
      <Row style={styles.head}>
        <Press onPress={() => { stopStream(); back(offerId ? paths.hostOfferEdit(offerId) : paths.hostStart(3)); }} accessibilityRole="button" hitSlop={8}><Row><Icon name="back" size={18} /><Text style={type.h3}>Your video</Text></Row></Press>
        <Press onPress={() => { stopStream(); back(offerId ? paths.hostOfferEdit(offerId) : paths.hostStart(3)); }} accessibilityRole="button" hitSlop={8}><Text style={[type.small, { color: colors.accent, fontWeight: '700' }]}>Skip</Text></Press>
      </Row>
      <View style={styles.gutter}>
        <Text style={type.h2}>{title ?? (offerId ? 'A video for this offer' : 'Say hello, in about a minute')}</Text>
        <Text style={type.small}>{offerId ? 'One video per offer — this is not your profile intro.' : 'Look at the camera and talk like you would to someone at the door.'}</Text>
      </View>

      {/* The camera, the recording, or what was recorded. */}
      <View style={[styles.frame, { height }]}>
        {(stage === 'ready' || stage === 'recording') && Platform.OS === 'web' ? (
          React.createElement('video', { ref: live, autoPlay: true, muted: true, playsInline: true, style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', background: INK } })
        ) : null}
        {stage === 'review' && previewUrl && Platform.OS === 'web' ? (
          React.createElement('video', { ref: player, src: previewUrl, controls: true, playsInline: true, style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', background: INK } })
        ) : null}
        {stage === 'ask' ? (
          <View style={styles.askBox}>
            <Icon name="video" size={30} color={CREAM} />
            <Text style={[type.body, { color: CREAM, textAlign: 'center' }]}>{supported ? 'Epic needs the camera and microphone for about a minute.' : 'This browser cannot record video. Upload one instead.'}</Text>
            {supported ? <Button label="Open the camera" icon="camera" onPress={() => void open()} /> : null}
          </View>
        ) : null}
        {stage === 'uploading' ? <View style={styles.askBox}><Text style={[type.body, { color: CREAM }]}>Sending your video…</Text></View> : null}

        {stage === 'recording' || stage === 'ready' ? (
          <View style={styles.timer}>
            <View style={[styles.dot, stage === 'recording' && styles.dotOn]} />
            <Text style={styles.timerText}>{clock(seconds)} / {clock(MAX_S)}</Text>
            {take ? <Text style={styles.timerText}>· Take {take}</Text> : null}
          </View>
        ) : null}

        {/* The prompt script, over the picture, ticking itself off. */}
        {stage === 'ready' || stage === 'recording' ? (
          <View style={styles.script}>
            <Text style={styles.scriptKicker}>READ THIS, IN YOUR OWN WORDS</Text>
            {SCRIPT.map((s, i) => {
              const done = scriptDone(i);
              const now = stage === 'recording' && scriptNow === i;
              return (
                <Row key={s.at} style={{ gap: 8 }}>
                  <View style={[styles.tick, done && styles.tickDone, now && styles.tickNow]}>{done ? <Icon name="check" size={12} color={INK} strokeWidth={3} /> : null}</View>
                  <Text style={[styles.scriptLine, done && { opacity: 0.55 }, now && { color: LIME }]}>{s.text}</Text>
                </Row>
              );
            })}
          </View>
        ) : null}
      </View>

      <View style={styles.gutter}>
        {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
        {stage === 'ready' ? (
          <Row style={{ justifyContent: 'center', marginTop: spacing.sm }}>
            <Press onPress={start} accessibilityRole="button" accessibilityLabel="Start recording" style={styles.record}><View style={styles.recordDot} /></Press>
          </Row>
        ) : null}
        {stage === 'recording' ? (
          <Row style={{ justifyContent: 'center', marginTop: spacing.sm }}>
            <Press onPress={stop} accessibilityRole="button" accessibilityLabel="Stop" style={[styles.record, { borderColor: colors.overrun }]}><View style={styles.stopSquare} /></Press>
          </Row>
        ) : null}
        {stage === 'review' ? (
          <View style={{ gap: spacing.sm }}>
            <Trim seconds={seconds} value={trim} onChange={setTrim} />
            <Row>
              <Button label="Retake" kind="secondary" icon="refresh" onPress={retake} />
              <View style={{ flex: 1 }} />
              <Button label="Use this one" icon="check" onPress={() => void upload()} />
            </Row>
          </View>
        ) : null}
        <Text style={[type.small, { marginTop: spacing.md }]}>Thirty to sixty seconds. Talk like a video message, not a screen test — the wobbly ones book better than the polished ones.</Text>

        <View style={styles.epicMade}>
          <Icon name="video" size={16} color={colors.ink} />
          <View style={{ flex: 1 }}>
            <Text style={type.h3}>Or let Epic make it</Text>
            <Text style={type.small}>Send us your raw clips; we cut it and send it back in a week. Ask from the Host tab once you are live — it is by invitation while we learn what works.</Text>
          </View>
        </View>
        <Press onPress={pickFile} accessibilityRole="button" style={{ paddingVertical: 10 }}><Text style={[type.small, { color: colors.accent, fontWeight: '700', textAlign: 'center' }]}>Upload instead</Text></Press>
      </View>
    </View>
  );
}

/** Two marks, nothing re-encoded. The player honours them. */
function Trim({ seconds, value, onChange }: { seconds: number; value: { start: number; end: number } | null; onChange: (v: { start: number; end: number } | null) => void }) {
  const start = value?.start ?? 0;
  const end = value?.end ?? seconds;
  const step = (which: 'start' | 'end', d: number) => {
    const next = which === 'start' ? { start: Math.max(0, Math.min(end - 3, start + d)), end } : { start, end: Math.min(seconds, Math.max(start + 3, end + d)) };
    onChange(next.start === 0 && next.end === seconds ? null : next);
  };
  return (
    <View style={styles.trim}>
      <Text style={type.small}>Trim</Text>
      <Row><Press onPress={() => step('start', -1)} accessibilityRole="button" hitSlop={6}><Icon name="previous" size={16} /></Press><Text style={type.h3}>{clock(start)}</Text><Press onPress={() => step('start', 1)} accessibilityRole="button" hitSlop={6}><Icon name="more" size={16} /></Press></Row>
      <View style={styles.trimBar}><View style={[styles.trimFill, { left: `${(start / Math.max(1, seconds)) * 100}%` as any, right: `${100 - (end / Math.max(1, seconds)) * 100}%` as any }]} /></View>
      <Row><Press onPress={() => step('end', -1)} accessibilityRole="button" hitSlop={6}><Icon name="previous" size={16} /></Press><Text style={type.h3}>{clock(end)}</Text><Press onPress={() => step('end', 1)} accessibilityRole="button" hitSlop={6}><Icon name="more" size={16} /></Press></Row>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg, paddingBottom: 24 },
  head: { justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: (Platform.OS === 'web' ? 'max(16px, calc(var(--epic-sat) + 10px))' : 16) as any, paddingBottom: spacing.sm },
  gutter: { paddingHorizontal: 20, gap: 4 },
  frame: { marginTop: spacing.md, backgroundColor: INK, position: 'relative', overflow: 'hidden' },
  askBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  timer: { position: 'absolute', top: 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(32,30,29,0.7)', paddingHorizontal: 8, paddingVertical: 4 },
  timerText: { fontFamily: fonts.body, fontSize: 12, fontWeight: '700', color: CREAM },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: CREAM, opacity: 0.5 },
  dotOn: { backgroundColor: colors.overrun, opacity: 1 },
  script: { position: 'absolute', left: 12, right: 12, bottom: 12, backgroundColor: 'rgba(32,30,29,0.78)', padding: spacing.md, gap: 8 },
  scriptKicker: { fontFamily: fonts.body, fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: CREAM, opacity: 0.8 },
  scriptLine: { fontFamily: fonts.heading, fontSize: 15, fontWeight: '800', color: CREAM, flex: 1, letterSpacing: -0.2 },
  tick: { width: 18, height: 18, borderWidth: 2, borderColor: CREAM, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  tickDone: { backgroundColor: LIME, borderColor: LIME },
  tickNow: { borderColor: LIME },
  record: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  recordDot: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.overrun },
  stopSquare: { width: 28, height: 28, backgroundColor: colors.overrun },
  epicMade: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginTop: spacing.lg, padding: spacing.md, backgroundColor: colors.warm },
  trim: { gap: 6, padding: spacing.md, borderWidth: BORDER, borderColor: colors.line },
  trimBar: { height: 8, backgroundColor: colors.lineSoft, position: 'relative' },
  trimFill: { position: 'absolute', top: 0, bottom: 0, backgroundColor: LIME },
});
