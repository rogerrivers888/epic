import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { LiveTranscriber, LiveState, liveSupported } from '../voice/live';
import { Recorder, closeMicrophone, openMicrophone, recordingSupported } from '../voice/recorder';
import { transcribeRecording } from '../voice/client';
import { VOICE_MAX_SECONDS, VoiceMode, getVoiceConfirm, getVoiceLanguage, getVoiceMode, onVoiceSettingsChange } from '../voice/settings';

/**
 * Speech in — one hook, five ways of hearing, chosen in Settings › Voice
 * (`voice/settings.ts`; the owner's brief of 8 Sep 2026 asks for the ways to
 * be built side by side and compared).
 *
 * What every caller sees is the same: tap to start, tap Done to stop, never
 * hold; listening runs until Done (owner, 3 Sep 2026: "it cut me off in the
 * middle") and nothing is sent before then. `transcript` is what is on screen
 * while they talk — live captions in the modes that have them, nothing in the
 * ones that record and send. Done ends in `onFinal(text)` with the whole
 * transcript, once.
 *
 * Two things are new against the browser-only version this replaces:
 *
 *  - a `transcribing` phase between Done and the words, in the modes that send
 *    the recording afterwards (the screen says "Writing that down…");
 *  - a `confirm` phase, on by default, where the words are shown in a box to
 *    read and change before Epic plans from them — one of the brief's open
 *    decisions, built both ways so it can be switched.
 *
 * Stage one only. The transcript is faithful — the recogniser is given place
 * names to expect, never asked to tidy — and the reading of it is stage two,
 * on the server (`/api/voice/plan`, or the planner's own interpreter).
 */
export type SpeechPhase = 'idle' | 'listening' | 'transcribing' | 'confirm';

type Recognizer = any;

function getRecognizer(): Recognizer | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const w = window as any;
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

const join = (a: string, b: string) => [a.trim(), b.trim()].filter(Boolean).join(' ');
const browserAvailable = () => Platform.OS === 'web' && typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

/** Which modes this browser can actually run, so a phone that cannot do one falls to one it can. */
function usable(mode: VoiceMode): VoiceMode {
  const rec = recordingSupported();
  const live = rec && liveSupported();
  if (mode === 'browser') return browserAvailable() ? 'browser' : rec ? 'record' : 'browser';
  if (!rec) return browserAvailable() ? 'browser' : mode;
  if ((mode === 'live' || mode === 'hybrid') && !live) return 'record';
  return mode;
}

export function useSpeech({ onFinal, lang = 'en-GB', confirm, sessionId = null }: {
  onFinal: (text: string) => void;
  /** The browser recogniser's language; the other modes use Settings › Voice. */
  lang?: string;
  /** Whether to show the words for checking before `onFinal`. Default: the setting. A function is asked at the moment of Done. */
  confirm?: boolean | (() => boolean);
  /** The planner session the speech belongs to, for the ledger. */
  sessionId?: string | null;
}) {
  const [mode, setMode] = useState<VoiceMode>(() => usable(getVoiceMode()));
  const [phase, setPhase] = useState<SpeechPhase>('idle');
  const [finalText, setFinalText] = useState('');
  const [interim, setInterim] = useState('');
  const [draft, setDraft] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);

  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;

  const phaseRef = useRef<SpeechPhase>('idle');
  const setPhaseBoth = (p: SpeechPhase) => { phaseRef.current = p; setPhase(p); };

  // The pieces of the modes that record.
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const liveRef = useRef<LiveTranscriber | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef(0);
  const tickRef = useRef<any>(null);

  // The browser recogniser (mode 'browser'), as it always was.
  const recRef = useRef<Recognizer | null>(null);
  const wantRef = useRef(false);
  const browserFinalRef = useRef('');
  const browserInterimRef = useRef('');

  const supported = mode === 'browser' ? browserAvailable() : recordingSupported();

  useEffect(() => onVoiceSettingsChange(() => { if (phaseRef.current === 'idle') setMode(usable(getVoiceMode())); }), []);

  // --- the browser recogniser -------------------------------------------------
  useEffect(() => {
    if (mode !== 'browser') return;
    const rec = getRecognizer();
    if (!rec) return;
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (event: any) => {
      let settled = '';
      let pending = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) settled += chunk; else pending += chunk;
      }
      if (settled) { browserFinalRef.current = join(browserFinalRef.current, settled); setFinalText(browserFinalRef.current); }
      browserInterimRef.current = pending;
      setInterim(pending);
    };
    rec.onerror = (event: any) => {
      const code = event?.error || 'error';
      if (code === 'no-speech' || code === 'network' || code === 'aborted') return;
      wantRef.current = false;
      setError(code === 'not-allowed' || code === 'audio-capture' ? 'Microphone permission was declined.' : `Couldn't hear that (${code}).`);
      setPhaseBoth('idle');
    };
    rec.onend = () => {
      if (!wantRef.current) return;
      if (browserInterimRef.current) { browserFinalRef.current = join(browserFinalRef.current, browserInterimRef.current); browserInterimRef.current = ''; setFinalText(browserFinalRef.current); setInterim(''); }
      const attempt = (n: number) => {
        if (!wantRef.current) return;
        try { rec.start(); } catch {
          if (n < 5) setTimeout(() => attempt(n + 1), 150 * (n + 1));
          else { wantRef.current = false; setPhaseBoth('idle'); setError('The microphone stopped — tap Speak to carry on.'); }
        }
      };
      attempt(0);
    };
    recRef.current = rec;
    return () => { wantRef.current = false; try { rec.abort(); } catch { /* noop */ } recRef.current = null; };
  }, [lang, mode]);

  // --- the clock ------------------------------------------------------------------
  const startClock = () => {
    startedAtRef.current = Date.now();
    setSeconds(0);
    clearInterval(tickRef.current);
    tickRef.current = setInterval(() => setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000)), 500);
  };
  const stopClock = () => { clearInterval(tickRef.current); tickRef.current = null; };
  useEffect(() => () => { stopClock(); teardown(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const teardown = () => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    liveRef.current?.cancel();
    liveRef.current = null;
    closeMicrophone(streamRef.current);
    streamRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const reset = () => {
    setFinalText(''); setInterim(''); setLive(null); setDraft('');
    browserFinalRef.current = ''; browserInterimRef.current = '';
  };

  // --- start ----------------------------------------------------------------------
  const start = useCallback(async () => {
    if (phaseRef.current !== 'idle') return;
    setError(null);
    reset();
    const m = usable(getVoiceMode());
    setMode(m);

    if (m === 'browser') {
      if (!recRef.current) { setError("Voice input isn't available in this browser — typing does exactly the same thing."); return; }
      wantRef.current = true;
      try { recRef.current.start(); setPhaseBoth('listening'); startClock(); } catch {
        wantRef.current = false;
        try { recRef.current.stop(); } catch { /* noop */ }
      }
      return;
    }

    let stream: MediaStream;
    try { stream = await openMicrophone(); } catch (e: any) { setError(e.message); return; }
    streamRef.current = stream;
    setPhaseBoth('listening');
    startClock();

    if (m !== 'live') {
      const rec = new Recorder();
      try { rec.start(stream); recorderRef.current = rec; } catch {
        setError("The microphone couldn't be recorded. Try again, or type it.");
        teardown(); stopClock(); setPhaseBoth('idle');
        return;
      }
    }
    if (m === 'live' || m === 'hybrid') {
      const lt = new LiveTranscriber({ language: getVoiceLanguage(), sessionId: sessionRef.current, onChange: setLive });
      liveRef.current = lt;
      lt.start(stream).catch(() => { /* the state carries the failure */ });
    }
  }, []);

  // --- finish: the words are in; confirm or hand over ------------------------------
  const finish = (text: string, note: string | null = null) => {
    stopClock();
    const t = text.trim();
    if (!t) {
      setError(note ?? "Epic couldn't hear any words. Try again, or type it.");
      setPhaseBoth('idle');
      return;
    }
    if (note) setError(note);
    const c = confirmRef.current;
    const want = getVoiceConfirm() && (typeof c === 'function' ? c() : c ?? true);
    if (want) { setDraft(t); setPhaseBoth('confirm'); return; }
    setPhaseBoth('idle');
    onFinalRef.current(t);
  };

  /** Done: stop listening and, in the modes that send a recording, write it down. */
  const stop = useCallback(async () => {
    if (phaseRef.current !== 'listening') return;
    const m = mode;

    if (m === 'browser') {
      wantRef.current = false;
      try { recRef.current?.stop(); } catch { /* noop */ }
      const text = join(browserFinalRef.current, browserInterimRef.current);
      browserInterimRef.current = '';
      setInterim('');
      finish(text);
      return;
    }

    setPhaseBoth('transcribing');
    const recorder = recorderRef.current;
    const lt = liveRef.current;
    recorderRef.current = null;
    liveRef.current = null;

    const [recording, liveResult] = await Promise.all([
      recorder ? recorder.stop() : Promise.resolve(null),
      lt ? lt.stop() : Promise.resolve(null),
    ]);
    closeMicrophone(streamRef.current);
    streamRef.current = null;

    if (m === 'live') { finish(liveResult?.transcript ?? '', liveResult?.error ?? null); return; }
    if (!recording || !recording.blob.size) { finish(liveResult?.transcript ?? '', 'Nothing was recorded.'); return; }

    const abort = new AbortController();
    abortRef.current = abort;
    setInterim('');
    try {
      const out = await transcribeRecording({
        blob: recording.blob, mime: recording.mime, seconds: recording.seconds,
        language: getVoiceLanguage(), sessionId: sessionRef.current,
        stream: m === 'stream', signal: abort.signal,
        onDelta: (d) => setInterim((cur) => cur + d),
      });
      if (abort.signal.aborted) return;
      finish(out.transcript);
    } catch (e: any) {
      if (abort.signal.aborted) return;
      // The recording could not be written down. In the hybrid mode the
      // captions are a fair second best; say so rather than lose the words.
      if (liveResult?.transcript) finish(liveResult.transcript, `${e.message} Used the live words instead.`);
      else finish('', e.message);
    } finally {
      abortRef.current = null;
    }
  }, [mode]);

  /** Cancel: stop everything and keep nothing. */
  const cancel = useCallback(() => {
    wantRef.current = false;
    try { recRef.current?.abort(); } catch { /* noop */ }
    teardown();
    stopClock();
    reset();
    setError(null);
    setPhaseBoth('idle');
  }, []);

  /** The confirm box's "Use these words". */
  const accept = useCallback(() => {
    if (phaseRef.current !== 'confirm') return;
    const t = draft.trim();
    setPhaseBoth('idle');
    reset();
    if (t) onFinalRef.current(t);
  }, [draft]);

  /** The confirm box's "Say it again". */
  const retry = useCallback(() => { cancel(); void start(); }, [cancel, start]);

  const listening = phase === 'listening';
  const toggle = useCallback(() => (phaseRef.current === 'listening' ? void stop() : void start()), [start, stop]);

  // The hard limit: the API refuses a longer recording, so rather than lose
  // five minutes of talking, Done is tapped for them and the screen says why.
  useEffect(() => {
    if (phase !== 'listening' || seconds < VOICE_MAX_SECONDS) return;
    setError(`That's the limit — ${Math.round(VOICE_MAX_SECONDS / 60)} minutes. Writing it down.`);
    void stop();
  }, [phase, seconds, stop]);

  // What is on screen while they talk: captions where there are any.
  const transcript = mode === 'browser'
    ? join(finalText, interim)
    : phase === 'transcribing' && mode === 'stream'
      ? interim
      : live ? join(live.committed, live.partial) : '';

  return {
    supported, listening, interim, transcript, error, start, stop, cancel, toggle,
    phase, mode, seconds, draft, setDraft, accept, retry,
    /** The captions' two parts and the connection's state, for the screen that draws them. */
    live,
  };
}

/** Speak a reply back when the household used their voice to ask. */
export function speak(text: string) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const synth = (window as any).speechSynthesis;
  if (!synth || !text) return;
  synth.cancel();
  const u = new (window as any).SpeechSynthesisUtterance(text);
  u.rate = 1.02;
  synth.speak(u);
}
