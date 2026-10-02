/**
 * The offer video (hosting v7, README › "Offer video"; prototype lines 355–392
 * and 637–651): the intro with the prompts to cover, then one of three ways —
 * record it now (the prompts advance as you talk and the take stops itself
 * after the last one), or upload one — hosts make their own video (owner, 2 Oct 2026) (plus,
 * for a public event, a ten-second hello). A take lands on the same
 * "recorded" screen: playback, Retake, a cover picture, "Also show on my host
 * profile", then Use this video. The length the checklist shows is the take's.
 *
 * Drawn in the tree (kit `Overlay`), so it stays inside the phone frame. The
 * camera is the browser's (getUserMedia + MediaRecorder); the native app has
 * no recorder here yet and says so in the frame.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { Press } from '../../../components/press';
import { Icon } from '../../../components/Icon';
import { showToast } from '../../../components/Toast';
import { api } from '../../../api';
import { CREAM, HAIRLINE, INACTIVE, INK, INK_MUTED, LIME, LIME_TINT, DEEP_GREEN, RECORD_RED, VIDEO_TOP, VIDEO_BOTTOM, VIDEO_SCRIM, ON_VIDEO_SOFT, ON_VIDEO_FAINT, TICK_EDGE } from '../../../theme';
import { ActionBar, Kicker, Note, Overlay, Tick, ToggleRow, hx, pointer, tx, v } from './kit';
import type { LaneHome, LaneOffer } from './model';

const web = Platform.OS === 'web';

// ---------------------------------------------------------------------------
// small helpers (web only; each answers null / [] where there is no browser)
// ---------------------------------------------------------------------------

/** 48 → "0:48", 75 → "1:15". */
export const mmss = (s: number | null | undefined) => {
  const n = Math.max(0, Math.round(s ?? 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

/** The browser's file picker. Resolves [] on cancel. */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  if (!web || typeof document === 'undefined') return Promise.resolve([]);
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.multiple = multiple;
    let done = false;
    const finish = (files: File[]) => { if (done) return; done = true; resolve(files); };
    input.onchange = () => finish(Array.from(input.files ?? []));
    const onFocus = () => { setTimeout(() => { if (!input.files?.length) finish([]); }, 600); window.removeEventListener('focus', onFocus); };
    window.addEventListener('focus', onFocus);
    input.click();
  });
}

/** A video file's length in seconds, read off its metadata; null when the browser cannot tell. */
function videoSeconds(blob: Blob): Promise<number | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const el = document.createElement('video');
    el.preload = 'metadata';
    el.onloadedmetadata = () => { const d = el.duration; URL.revokeObjectURL(url); resolve(Number.isFinite(d) && d > 0 ? d : null); };
    el.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    el.src = url;
  });
}

function waitFor(el: HTMLElement, event: string, ms: number) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => { el.removeEventListener(event, on); reject(new Error('timeout')); }, ms);
    const on = () => { clearTimeout(t); el.removeEventListener(event, on); resolve(); };
    el.addEventListener(event, on);
  });
}

/** Four stills from the take, for the cover picture. Null if the browser cannot seek it (the tiles stay grey). */
async function grabFrames(blob: Blob, seconds: number, at: number[]): Promise<string[] | null> {
  if (typeof document === 'undefined') return null;
  const url = URL.createObjectURL(blob);
  const el = document.createElement('video');
  el.muted = true; el.playsInline = true; el.preload = 'auto'; el.src = url;
  try {
    if (el.readyState < 2) await waitFor(el, 'loadeddata', 5000);
    const out: string[] = [];
    for (const f of at) {
      el.currentTime = Math.max(0.05, f * seconds);
      await waitFor(el, 'seeked', 4000);
      const c = document.createElement('canvas');
      c.width = 200; c.height = Math.round(200 * ((el.videoHeight || 9) / (el.videoWidth || 16)));
      const g = c.getContext('2d'); if (!g) return null;
      g.drawImage(el, 0, 0, c.width, c.height);
      out.push(c.toDataURL('image/jpeg', 0.72));
    }
    return out;
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}

/** A photo made smaller before it leaves the phone. Anything the canvas cannot read goes up as it is. */
async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bitmap.width * scale); c.height = Math.round(bitmap.height * scale);
    c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
    return (await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.82))) ?? file;
  } catch { return file; }
}

const COVER_AT = [0.1, 0.35, 0.6, 0.85];
const PUBLIC_PROMPTS = ['Who you are', 'What you’ll do with people', 'Why you, for this one', 'What to bring or wear'];
const PRIVATE_PROMPTS = ['Hello, and what the day is', 'What to expect', 'Anything to bring'];
const HELLO_PROMPTS = ['Say hello and who you are'];

type Step = 'intro' | 'record';
type Take = { blob: Blob; seconds: number; url: string; from: 'camera' | 'upload' };

// ---------------------------------------------------------------------------
// the sheet
// ---------------------------------------------------------------------------

export function VideoSheet({ offer, home, onClose, onChanged }: {
  offer: LaneOffer; home: LaneHome; onClose: () => void; onChanged: (next?: LaneOffer) => Promise<void> | void;
}) {
  const cfg = home.config;
  const pub = offer.visibility === 'public';
  const [step, setStep] = useState<Step>('intro');
  const [hello, setHello] = useState(false);
  const prompts = hello ? HELLO_PROMPTS : pub ? PUBLIC_PROMPTS : PRIVATE_PROMPTS;
  const maxS = hello ? cfg.videoSeconds.hello : cfg.videoSeconds.max;
  const per = maxS / prompts.length;

  // --- the take ---------------------------------------------------------------
  const [take, setTake] = useState<Take | null>(null);
  const [covers, setCovers] = useState<string[] | null>(null);
  const [cover, setCover] = useState(0);
  const [onProfile, setOnProfile] = useState(offer.video.onProfile ?? true);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (take) URL.revokeObjectURL(take.url); }, [take]);
  useEffect(() => {
    setCovers(null); setCover(0);
    if (!take || hello) return;
    let live = true;
    void grabFrames(take.blob, take.seconds, COVER_AT).then((c) => { if (live) setCovers(c); });
    return () => { live = false; };
  }, [take, hello]);

  // --- the camera -------------------------------------------------------------
  const stream = useRef<MediaStream | null>(null);
  const liveEl = useRef<any>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<BlobPart[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);
  const elapsedRef = useRef(0);
  const cueRef = useRef(0);
  const cueAt = useRef(0);
  const [camera, setCamera] = useState<'off' | 'opening' | 'ready' | 'failed'>('off');
  const [cameraWhy, setCameraWhy] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [cue, setCueState] = useState(0);
  const setCue = (i: number) => { cueRef.current = i; cueAt.current = elapsedRef.current; setCueState(i); };
  const supported = web && typeof navigator !== 'undefined' && Boolean((navigator as any).mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';

  const stopStream = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setCamera('off');
  }, []);
  const clearTimer = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  useEffect(() => () => {
    clearTimer();
    if (recorder.current?.state === 'recording') { recorder.current.onstop = null; recorder.current.stop(); }
    stream.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const openCamera = useCallback(async () => {
    if (!supported) { setCamera('failed'); setCameraWhy('No camera here. Upload one instead.'); return; }
    setCamera('opening'); setCameraWhy(null);
    try {
      const s: MediaStream = await (navigator as any).mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true });
      stream.current = s;
      if (liveEl.current) { liveEl.current.srcObject = s; liveEl.current.muted = true; void liveEl.current.play?.(); }
      setCamera('ready');
    } catch (e: any) {
      setCamera('failed');
      setCameraWhy(e?.name === 'NotAllowedError' ? 'The camera was refused. Allow it in the browser, or upload one instead.' : 'No camera could be opened here. Upload one instead.');
    }
  }, [supported]);

  // The camera is on only while there is something to record.
  useEffect(() => {
    if (step === 'record' && !take && !stream.current && camera !== 'opening' && camera !== 'failed') void openCamera();
    if ((step !== 'record' || take) && stream.current && !recording) stopStream();
  }, [step, take]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = useCallback(() => {
    clearTimer();
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }, []);

  const start = () => {
    if (!stream.current || recording) return;
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => (MediaRecorder as any).isTypeSupported?.(m)) ?? '';
    chunks.current = [];
    const r = new MediaRecorder(stream.current, mime ? { mimeType: mime, videoBitsPerSecond: 1_500_000 } : undefined);
    r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    r.onstop = () => {
      const blob = new Blob(chunks.current, { type: r.mimeType || 'video/webm' });
      const seconds = Math.max(1, Math.round(elapsedRef.current));
      setRecording(false);
      stopStream();
      setTake({ blob, seconds, url: URL.createObjectURL(blob), from: 'camera' });
    };
    recorder.current = r;
    r.start(500);
    startedAt.current = Date.now(); elapsedRef.current = 0; cueRef.current = 0; cueAt.current = 0;
    setElapsed(0); setCueState(0); setRecording(true);
    timer.current = setInterval(() => {
      const e = (Date.now() - startedAt.current) / 1000;
      elapsedRef.current = e; setElapsed(e);
      if (e >= maxS) { stop(); return; }
      if (e - cueAt.current >= per) {
        if (cueRef.current < prompts.length - 1) { cueRef.current += 1; cueAt.current = e; setCueState(cueRef.current); } else stop();
      }
    }, 200);
  };

  const retake = () => {
    const from = take?.from;
    setTake(null);
    setElapsed(0); setCueState(0); cueRef.current = 0;
    if (from === 'upload' && !hello) setStep('intro');
    else { setCamera('off'); setStep('record'); }
  };

  const upload = async () => {
    const [file] = await pickFiles('video/*');
    if (!file) return;
    if (file.size > 80 * 1024 * 1024) { showToast('That video is too big. Thirty to sixty seconds is plenty.'); return; }
    const d = await videoSeconds(file);
    stopStream();
    setStep('record');
    setTake({ blob: file, seconds: Math.max(1, Math.round(d ?? 0)), url: URL.createObjectURL(file), from: 'upload' });
  };

  // --- finishing --------------------------------------------------------------
  const finish = async (body: Parameters<typeof api.laneVideo>[1]) => {
    const r = await api.laneVideo(offer.id, body);
    await onChanged(r.offer);
    onClose();
  };
  const useThis = async () => {
    if (!take || busy) return;
    setBusy(true);
    try {
      const m = await api.uploadHostMedia(take.blob, 'video', take.seconds, 'listing');
      await finish({ videoId: m.id, coverS: covers ? Math.round(COVER_AT[cover] * take.seconds * 10) / 10 : null, onProfile });
    } catch (e: any) { showToast(e.message); } finally { setBusy(false); }
  };


  const close = () => { stop(); stopStream(); onClose(); };

  // --- drawing ----------------------------------------------------------------
  const recorded = step === 'record' && !!take;
  const footer = step === 'record' && take ? <ActionBar label="Use this video" onPress={() => { void useThis(); }} busy={busy} />
    : null;

  return (
    <Overlay title={pub ? 'Offer video' : 'Add a video'} onClose={close} footer={footer}>
      {step === 'intro' ? (
        <>
          {pub ? <Note>Needed for public events · it’s how guests choose</Note> : null}
          <Kicker>What to cover · {cfg.videoSeconds.min} to {cfg.videoSeconds.max} seconds</Kicker>
          <View style={v.list}>
            {prompts.map((p, i) => (
              <View key={p} style={s.promptRow}>
                <Text style={[hx(15, 0, 1.3), { width: 24 }]}>{i + 1}</Text>
                <Text style={[tx(14, '600'), { flex: 1 }]}>{p}</Text>
              </View>
            ))}
          </View>
          <Way onPress={() => { setHello(false); setTake(null); setCamera('off'); setStep('record'); }} title="Record it now" sub="The prompts show as you talk"
            mark={<View style={{ width: 36, height: 36, borderRadius: 999, backgroundColor: RECORD_RED }} />} />
          <Way onPress={() => { void upload(); }} title="Upload one" sub="From your camera roll"
            mark={<View style={[s.wayTile, { backgroundColor: CREAM }]}><Icon name="upload" size={18} color={INK} strokeWidth={2.2} /></View>} />
        </>
      ) : null}

      {step === 'record' ? (
        <>
          <View style={s.frame}>
            {web ? React.createElement('div', { style: { position: 'absolute', inset: 0, background: `linear-gradient(180deg, ${VIDEO_TOP}, ${VIDEO_BOTTOM})` } }) : null}
            {!take && web ? React.createElement('video', {
              ref: (el: any) => { liveEl.current = el; if (el && stream.current && el.srcObject !== stream.current) { el.srcObject = stream.current; el.muted = true; void el.play?.(); } },
              autoPlay: true, muted: true, playsInline: true,
              style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', opacity: camera === 'ready' ? 1 : 0 },
            }) : null}
            {take ? <Playback take={take} hello={hello} pics={0} onRetake={retake} /> : (
              <>
                {/* one segment per prompt across the top */}
                <View style={s.segs}>
                  {prompts.map((p, i) => {
                    const w = i < cue ? 1 : i === cue && recording ? Math.min(1, (elapsed - cueAt.current) / per) : 0;
                    return <View key={p} style={s.seg}><View style={{ height: '100%', width: `${Math.round(w * 100)}%`, backgroundColor: CREAM }} /></View>;
                  })}
                </View>
                {recording ? (
                  <View style={s.clock}>
                    <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: RECORD_RED }} />
                    <Text style={tx(12, '700', CREAM)}>{mmss(elapsed)}</Text>
                  </View>
                ) : null}
                <View style={s.oval} pointerEvents="none" />
                {camera === 'failed' ? (
                  <View style={s.cameraWhy}>
                    <Text style={tx(13, '600', CREAM, { textAlign: 'center' })}>{cameraWhy}</Text>
                    {!hello ? <Press onPress={() => { void upload(); }} accessibilityRole="button" style={[s.pill, { backgroundColor: ON_VIDEO_SOFT }, pointer]}>
                      <Icon name="upload" size={16} color={CREAM} strokeWidth={2.2} /><Text style={tx(14, '700', CREAM)}>Upload one</Text>
                    </Press> : null}
                  </View>
                ) : (
                  <View style={s.pillRow}>
                    <Press onPress={recording ? stop : start} disabled={camera !== 'ready'} accessibilityRole="button" accessibilityLabel={recording ? 'Stop' : 'Record'}
                      style={[s.pill, { backgroundColor: recording ? CREAM : ON_VIDEO_SOFT, opacity: camera === 'ready' ? 1 : 0.5 }, pointer]}>
                      <View style={{ width: 12, height: 12, borderRadius: recording ? 2 : 999, backgroundColor: RECORD_RED }} />
                      <Text style={tx(14, '700', recording ? INK : CREAM)}>{recording ? 'Stop' : 'Record'}</Text>
                    </Press>
                  </View>
                )}
              </>
            )}
          </View>

          {!recorded ? (
            <View style={v.list}>
              {prompts.map((p, i) => {
                const done = i < cue;
                const now = i === cue;
                return (
                  <Press key={p} onPress={() => setCue(i)} accessibilityRole="button" accessibilityLabel={p}
                    style={[s.cueRow, now && { backgroundColor: LIME_TINT, paddingHorizontal: 10 }, pointer]}>
                    {done ? <Tick on /> : (
                      <View style={[s.cueMark, { backgroundColor: now ? INK : CREAM, borderColor: now ? INK : TICK_EDGE }]}>
                        <Text style={hx(12, 0, 1.2, now ? CREAM : INK)}>{i + 1}</Text>
                      </View>
                    )}
                    <Text style={[tx(15, now ? '800' : '600', done ? INK_MUTED : INK), { flex: 1 }]}>{p}</Text>
                    <Text style={[v.kicker, { color: DEEP_GREEN }]}>{now ? (recording ? 'Now' : 'First') : ''}</Text>
                  </Press>
                );
              })}
            </View>
          ) : (
            <>
              {!hello ? (
                <>
                  <Kicker style={{ marginTop: 4 }}>Cover picture</Kicker>
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    {COVER_AT.map((_, i) => (
                      <Press key={i} onPress={() => setCover(i)} accessibilityRole="radio" accessibilityState={{ selected: cover === i }} accessibilityLabel={`Cover ${i + 1}`}
                        style={[{ flex: 1, height: 56, backgroundColor: INACTIVE }, pointer]}>
                        {covers?.[i] ? <Image source={{ uri: covers[i] }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
                        {cover === i ? <View style={[StyleSheet.absoluteFill, { borderWidth: 3, borderColor: LIME }]} /> : null}
                      </Press>
                    ))}
                  </View>
                </>
              ) : null}
              <ToggleRow title="Also show on my host profile" on={onProfile} onFlip={() => setOnProfile(!onProfile)} />
            </>
          )}
        </>
      ) : null}

    </Overlay>
  );
}

/** One of the three ways in, on the intro. */
function Way({ title, sub, mark, onPress }: { title: string; sub: string; mark: React.ReactNode; onPress: () => void }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={title} style={[s.way, pointer]}>
      {mark}
      <View style={{ flex: 1 }}>
        <Text style={tx(15, '700')}>{title}</Text>
        <Text style={tx(12.5, '400', INK_MUTED)}>{sub}</Text>
      </View>
    </Press>
  );
}

/** The frame once there is a take: play, the progress line, the real length, Retake. */
function Playback({ take, hello, pics, onRetake }: { take: Take; hello: boolean; pics: number; onRetake: () => void }) {
  const el = useRef<any>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const toggle = () => { const p = el.current; if (!p) return; if (p.paused) void p.play?.(); else p.pause?.(); };
  return (
    <>
      {web ? React.createElement('video', {
        ref: el, src: take.url, playsInline: true, preload: 'metadata',
        onPlay: () => setPlaying(true), onPause: () => setPlaying(false), onEnded: () => { setPlaying(false); setAt(0); },
        onTimeUpdate: (e: any) => setAt(e.currentTarget.currentTime || 0),
        style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' },
      }) : null}
      <Press onPress={toggle} accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'} style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }, pointer]}>
        {!playing ? <View style={s.play}><Icon name="play" size={24} color={CREAM} fill strokeWidth={2} /></View> : null}
      </Press>
      <View style={s.progress} pointerEvents="none"><View style={{ height: '100%', width: `${Math.min(100, Math.round((at / take.seconds) * 100))}%`, backgroundColor: LIME }} /></View>
      <Text style={[tx(12, '700', CREAM), { position: 'absolute', left: 12, bottom: 22 }]} pointerEvents="none">
        {hello ? `Your ${pics} photos + ${mmss(take.seconds)} of you` : mmss(take.seconds)}
      </Text>
      <Press onPress={onRetake} accessibilityRole="button" accessibilityLabel="Retake" style={[s.retake, pointer]}>
        <Icon name="retake" size={18} color={CREAM} strokeWidth={2.2} />
        <Text style={tx(13.5, '700', CREAM)}>Retake</Text>
      </Press>
    </>
  );
}

const s = StyleSheet.create({
  promptRow: { flexDirection: 'row', gap: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: HAIRLINE, alignItems: 'baseline' },
  way: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 13, paddingHorizontal: 14, backgroundColor: INACTIVE },
  wayTile: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  frame: { height: 360, backgroundColor: VIDEO_TOP, position: 'relative', overflow: 'hidden' },
  segs: { position: 'absolute', top: 10, left: 10, right: 10, flexDirection: 'row', gap: 4 },
  seg: { flex: 1, height: 3, backgroundColor: ON_VIDEO_FAINT },
  clock: { position: 'absolute', top: 22, left: 10, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingHorizontal: 8, backgroundColor: VIDEO_SCRIM },
  oval: { position: 'absolute', left: '50%', top: '44%', marginLeft: -75, marginTop: -95, width: 150, height: 190, borderRadius: 999, borderWidth: 1.5, borderStyle: 'dashed', borderColor: ON_VIDEO_FAINT },
  pillRow: { position: 'absolute', left: 0, right: 0, bottom: 16, alignItems: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingLeft: 12, paddingRight: 16, borderRadius: 999 },
  cameraWhy: { position: 'absolute', left: 20, right: 20, bottom: 16, alignItems: 'center', gap: 10 },
  cueMark: { width: 22, height: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  cueRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  play: { width: 56, height: 56, borderRadius: 999, backgroundColor: ON_VIDEO_SOFT, alignItems: 'center', justifyContent: 'center', paddingLeft: 4 },
  progress: { position: 'absolute', left: 12, right: 12, bottom: 56, height: 3, backgroundColor: ON_VIDEO_FAINT },
  retake: { position: 'absolute', right: 12, bottom: 12, height: 36, paddingLeft: 10, paddingRight: 14, borderRadius: 999, backgroundColor: ON_VIDEO_SOFT, flexDirection: 'row', alignItems: 'center', gap: 7 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -1.5 },
  cell: { width: '33.333%', aspectRatio: 1, padding: 1.5 },
  picTick: { position: 'absolute', right: 5, top: 5, width: 22, height: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
