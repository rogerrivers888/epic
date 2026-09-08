import { API_URL } from '../api';
import { sessionToken } from '../session';

/**
 * The one upload in the app that is not JSON: a recording, sent as itself to
 * `POST /api/voice/transcribe` (Technical Constraints §13.7 — the provider key
 * is on the server, so the audio goes to our own endpoint and nowhere else).
 *
 * Kept out of `api.ts`'s `request` on purpose: that helper stringifies bodies,
 * caches reads and queues failed writes for later, and a recording must do
 * none of those — a transcription replayed an hour later is a different call
 * that costs money, and the bytes must not land in IndexedDB.
 */

export type Transcription = {
  transcript: string;
  language: string | null;
  model: string;
  fellBack?: boolean;
  /** The provider's own time, on the server. */
  ms: number;
  /** From tapping Done to having the words, as this device saw it. */
  clientMs: number;
  seconds: number;
  mode: 'batch' | 'stream';
};

export class VoiceError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) { super(message); this.code = code; this.status = status; }
}

const qs = (o: Record<string, string | number | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

async function refusal(res: Response): Promise<VoiceError> {
  const body = await res.json().catch(() => ({} as any));
  return new VoiceError(res.status, body.error || 'voice_unavailable', body.message || "Epic couldn't hear that just now. Try again, or type it.");
}

/**
 * Send one recording and get the words back.
 *
 * `stream` asks the API to answer as server-sent events while the provider
 * writes; `onDelta` gets each piece. The upload still happens first — this is
 * not captions — and the resolved value is the same either way.
 */
export async function transcribeRecording({ blob, mime, seconds, language = null, sessionId = null, stream = false, onDelta = null, signal = null }: {
  blob: Blob; mime: string; seconds: number; language?: string | null; sessionId?: string | null;
  stream?: boolean; onDelta?: ((text: string) => void) | null; signal?: AbortSignal | null;
}): Promise<Transcription> {
  const started = Date.now();
  const token = sessionToken();
  const url = `${API_URL}/api/voice/transcribe${qs({ language, seconds: Math.round(seconds * 10) / 10, sessionId, stream: stream ? 1 : null })}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': mime || 'audio/webm', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: blob,
      signal: signal ?? undefined,
    });
  } catch (err: any) {
    if (signal?.aborted) throw new VoiceError(499, 'voice_cancelled', 'Cancelled.');
    throw new VoiceError(0, 'offline', "Epic couldn't reach the server to write that down. Check the signal and try again, or type it.");
  }
  if (!res.ok) throw await refusal(res);

  if (!stream || !/text\/event-stream/i.test(res.headers.get('content-type') || '')) {
    const j = await res.json();
    return { ...j, clientMs: Date.now() - started };
  }

  // The streamed form.
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done: any = null;
  let failed: VoiceError | null = null;
  const handle = (raw: string) => {
    const event = raw.split('\n').find((l) => l.startsWith('event:'))?.slice(6).trim() ?? 'message';
    const data = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
    if (!data) return;
    let j: any;
    try { j = JSON.parse(data); } catch { return; }
    if (event === 'delta' && typeof j.text === 'string') onDelta?.(j.text);
    else if (event === 'done') done = j;
    else if (event === 'error') failed = new VoiceError(502, j.error || 'voice_unavailable', j.message || "Epic couldn't hear that just now.");
  };
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let at: number;
    while ((at = buffer.indexOf('\n\n')) >= 0) { handle(buffer.slice(0, at)); buffer = buffer.slice(at + 2); }
  }
  if (buffer.trim()) handle(buffer);
  if (failed) throw failed;
  if (!done) throw new VoiceError(502, 'voice_unavailable', 'The words never finished arriving. Try again, or type it.');
  return { ...done, clientMs: Date.now() - started };
}
