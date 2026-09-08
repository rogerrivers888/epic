import { Platform } from 'react-native';

/**
 * The microphone, and a recording of it.
 *
 * `MediaRecorder` on the web (V1 is a home-screen web app; a native build
 * would swap this for AVFoundation behind the same three calls). The container
 * is whatever the browser will give: WebM/Opus in Chrome and in Safari from
 * 18.4, MP4/AAC in older Safari (ux-research §2.1). The API accepts both and
 * the screen never promises a format.
 *
 * Permission is asked for on the tap, never on load: an installed web app on
 * iOS asks again every session, so the sentence above the prompt has to make
 * sense the tenth time (ux-research §2.1).
 */

export const recordingSupported = () =>
  Platform.OS === 'web' && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof (globalThis as any).MediaRecorder !== 'undefined';

/** The first container this browser can record in. */
export function pickMime(): string {
  const MR = (globalThis as any).MediaRecorder;
  if (!MR?.isTypeSupported) return '';
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MR.isTypeSupported(t)) return t;
  }
  return '';
}

/** Open the microphone. Throws a plain sentence when it cannot. */
export async function openMicrophone(): Promise<MediaStream> {
  if (!recordingSupported()) throw new Error('This browser cannot record — typing does exactly the same thing.');
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false,
    });
  } catch (err: any) {
    const name = err?.name || '';
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new Error('Microphone permission was declined. Allow it in the browser and tap Speak again — or type it.');
    if (name === 'NotFoundError') throw new Error('No microphone was found on this device.');
    throw new Error("The microphone couldn't be opened. Try again, or type it.");
  }
}

export function closeMicrophone(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => { try { t.stop(); } catch { /* noop */ } });
}

export type Recording = { blob: Blob; mime: string; seconds: number };

/** One recording, from `start` to `stop`. The bytes stay in memory and go nowhere but the API. */
export class Recorder {
  private rec: any = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  mime = '';

  start(stream: MediaStream) {
    const MR = (globalThis as any).MediaRecorder;
    this.mime = pickMime();
    this.rec = this.mime ? new MR(stream, { mimeType: this.mime, audioBitsPerSecond: 48_000 }) : new MR(stream);
    this.mime = this.rec.mimeType || this.mime || 'audio/webm';
    this.chunks = [];
    this.rec.ondataavailable = (e: any) => { if (e.data?.size) this.chunks.push(e.data); };
    this.startedAt = Date.now();
    // A timeslice so a tab that dies mid-sentence still has most of it.
    this.rec.start(1000);
  }

  get seconds() { return this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0; }

  stop(): Promise<Recording> {
    const rec = this.rec;
    if (!rec) return Promise.resolve({ blob: new Blob([], { type: this.mime || 'audio/webm' }), mime: this.mime || 'audio/webm', seconds: 0 });
    return new Promise((resolve) => {
      const finish = () => {
        const seconds = Math.round(this.seconds * 10) / 10;
        const type = (this.mime || 'audio/webm').split(';')[0];
        resolve({ blob: new Blob(this.chunks, { type }), mime: type, seconds });
        this.rec = null;
      };
      rec.onstop = finish;
      try { if (rec.state !== 'inactive') rec.stop(); else finish(); } catch { finish(); }
    });
  }

  /** Stop and keep nothing. */
  cancel() {
    try { if (this.rec && this.rec.state !== 'inactive') { this.rec.ondataavailable = null; this.rec.onstop = null; this.rec.stop(); } } catch { /* noop */ }
    this.rec = null;
    this.chunks = [];
  }
}
