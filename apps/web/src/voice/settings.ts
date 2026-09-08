import { Platform } from 'react-native';

/**
 * The switch the voice experiment runs behind (owner's brief, 8 Sep 2026:
 * "build record-then-send, realtime, and streamed-file behind a switch, and
 * compare them on the same utterances").
 *
 * Four ways of hearing, and the browser's own recogniser kept as the free
 * baseline it was before. The default is the hybrid — the brief's "one to
 * beat": live captions so the household knows they are being heard, and the
 * whole recording transcribed afterwards for the words the plan is made from.
 *
 * On this device only, like the theme: it is an experiment setting, not a
 * household preference, and two phones in one household may well be set
 * differently while the comparison runs.
 */
export type VoiceMode = 'hybrid' | 'record' | 'live' | 'stream' | 'browser';

export const VOICE_MODES: { value: VoiceMode; label: string; short: string; blurb: string }[] = [
  { value: 'hybrid', label: 'Live captions + recording', short: 'Live + recording', blurb: 'Words appear as you speak; when you tap Done the whole recording is written down properly and that is what Epic plans from. Costs both calls.' },
  { value: 'record', label: 'Record, then send', short: 'Record then send', blurb: 'Nothing on screen while you talk. Tap Done and the recording is sent and written down in one go. Cheapest and most accurate; a short wait at the end.' },
  { value: 'live', label: 'Live only', short: 'Live', blurb: 'Words appear as you speak and those are the words Epic plans from. Fastest, and the one most likely to mishear a place name.' },
  { value: 'stream', label: 'Record, streamed back', short: 'Streamed', blurb: 'Like record-then-send, but the words arrive a few at a time once the recording has been sent. Feels quicker on a long recording; no captions while you talk.' },
  { value: 'browser', label: 'This browser’s own recogniser', short: 'Browser', blurb: 'What Epic used before: the browser’s built-in speech recognition. Free, English-leaning, and not available everywhere.' },
];

/** ISO-639-1 codes the language line offers; `auto` leaves detection to the recogniser. */
export const VOICE_LANGUAGES: { value: string; label: string }[] = [
  { value: 'auto', label: 'Detect it' },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
  { value: 'pt', label: 'Português' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'pl', label: 'Polski' },
  { value: 'tr', label: 'Türkçe' },
  { value: 'ar', label: 'العربية' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
];

const MODE_KEY = 'epic.voice.mode';
const LANGUAGE_KEY = 'epic.voice.language';
const CONFIRM_KEY = 'epic.voice.confirm';

const store = () => (Platform.OS === 'web' && typeof localStorage !== 'undefined' ? localStorage : null);

export const getVoiceMode = (): VoiceMode => {
  const v = store()?.getItem(MODE_KEY);
  return VOICE_MODES.some((m) => m.value === v) ? (v as VoiceMode) : 'hybrid';
};
export const setVoiceMode = (mode: VoiceMode) => { store()?.setItem(MODE_KEY, mode); notify(); };

/** `null` means detect: nothing is sent, and the recogniser says what it heard. */
export const getVoiceLanguage = (): string | null => {
  const v = store()?.getItem(LANGUAGE_KEY);
  return v && v !== 'auto' && VOICE_LANGUAGES.some((l) => l.value === v) ? v : null;
};
export const setVoiceLanguage = (code: string) => { store()?.setItem(LANGUAGE_KEY, code); notify(); };

/**
 * Whether the words are shown for checking before Epic plans from them — one of
 * the brief's open decisions, so both answers are built and this picks.
 */
export const getVoiceConfirm = (): boolean => store()?.getItem(CONFIRM_KEY) !== 'off';
export const setVoiceConfirm = (on: boolean) => { store()?.setItem(CONFIRM_KEY, on ? 'on' : 'off'); notify(); };

export const voiceModeLabel = (mode: VoiceMode) => VOICE_MODES.find((m) => m.value === mode)?.short ?? mode;
export const voiceLanguageLabel = (code: string | null) => VOICE_LANGUAGES.find((l) => l.value === (code ?? 'auto'))?.label ?? code ?? 'Detect it';

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());
export const onVoiceSettingsChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** The longest one turn may run, in seconds: the API refuses a longer recording (EPIC_VOICE_MAX_SECONDS, default 300). */
export const VOICE_MAX_SECONDS = 300;
