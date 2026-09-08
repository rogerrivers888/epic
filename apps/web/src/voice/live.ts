import { api } from '../api';

/**
 * Live captions: a Realtime transcription session the browser holds directly
 * with the provider, for words as they are spoken.
 *
 * The standing key never comes here. The API mints a client secret that can
 * open one session (`POST /api/voice/live-token`) and this connects with it;
 * the audio goes from the microphone to the provider without touching our
 * server, and the seconds it ran are reported back for the ledger afterwards.
 *
 * Built for the connection to drop mid-sentence (the brief: "assume the
 * connection will drop… and design for it"): a close while listening is a
 * reconnect with a fresh secret and a short back-off, the words already heard
 * are kept, and after five failures it gives up quietly — in the hybrid mode
 * the recording has everything anyway, and the screen says so.
 *
 * Live text is unstable by nature: a phrase rewrites as more of it arrives.
 * `committed` is what the provider has settled on; `partial` is what it is
 * still deciding, and the screen draws the two differently so it reads as
 * listening rather than as confusion.
 */

export type LiveStatus = 'idle' | 'connecting' | 'listening' | 'reconnecting' | 'finishing' | 'closed' | 'failed';
export type LiveState = { committed: string; partial: string; status: LiveStatus; error: string | null; model: string | null; reconnects: number };
export type LiveResult = { transcript: string; seconds: number; model: string | null; ms: number; error: string | null; reconnects: number };

const RATE = 24000;
const CHUNK = 2400;               // 100 ms at 24 kHz
const HOLD = RATE * 10;           // ten seconds kept while reconnecting, then the oldest go
const BACKOFF = [300, 800, 1500, 3000, 3000];

const join = (a: string, b: string) => [a.trim(), b.trim()].filter(Boolean).join(' ');

/** The worklet: hand every block of samples to the page. Inlined so no file has to be served. */
const WORKLET = `
class EpicPcm extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(new Float32Array(ch));
    return true;
  }
}
registerProcessor('epic-pcm', EpicPcm);
`;

export const liveSupported = () => typeof WebSocket !== 'undefined' && typeof (globalThis as any).AudioContext !== 'undefined';

export class LiveTranscriber {
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private nodes: AudioNode[] = [];
  private pending: number[] = [];       // int16 samples not yet sent
  private held: string[] = [];          // base64 chunks waiting for a socket
  private items = new Map<string, string>();   // provider items still being written
  private order: string[] = [];
  private committed = '';
  private status: LiveStatus = 'idle';
  private error: string | null = null;
  private model: string | null = null;
  private reconnects = 0;
  private attempts = 0;
  private active = false;
  private stopping = false;
  private startedAt = 0;
  private openedOnce = false;
  private urls: string[] = [];
  private urlIndex = 0;
  private onSettled: (() => void) | null = null;
  private sentAny = false;
  private completions = 0;
  private limitTimer: any = null;
  private maxSeconds = 300;

  constructor(private opts: { language: string | null; sessionId?: string | null; onChange: (s: LiveState) => void }) {}

  private emit() {
    this.opts.onChange({ committed: this.committed, partial: this.partial, status: this.status, error: this.error, model: this.model, reconnects: this.reconnects });
  }
  private get partial() { return this.order.map((id) => this.items.get(id) ?? '').join(' ').replace(/\s+/g, ' ').trim(); }
  private setStatus(s: LiveStatus) { this.status = s; this.emit(); }

  async start(stream: MediaStream) {
    this.active = true;
    this.stopping = false;
    this.startedAt = Date.now();
    this.setStatus('connecting');
    await this.openAudio(stream);
    await this.connect();
  }

  // --- audio ---------------------------------------------------------------

  private async openAudio(stream: MediaStream) {
    const AC = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
    let ctx: AudioContext;
    try { ctx = new AC({ sampleRate: RATE }); } catch { ctx = new AC(); }
    this.ctx = ctx;
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(stream);
    const ratio = ctx.sampleRate / RATE;
    const push = (f32: Float32Array) => this.push(ratio === 1 ? f32 : resample(f32, ratio));
    let tail: AudioNode;
    if (ctx.audioWorklet) {
      try {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        const node = new AudioWorkletNode(ctx, 'epic-pcm', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
        node.port.onmessage = (e: MessageEvent) => push(e.data as Float32Array);
        tail = node;
      } catch {
        tail = this.scriptProcessor(ctx, push);
      }
    } else {
      tail = this.scriptProcessor(ctx, push);
    }
    // A silent sink so the graph keeps running; nothing is played back.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(tail);
    tail.connect(mute);
    mute.connect(ctx.destination);
    this.nodes = [src, tail, mute];
  }

  private scriptProcessor(ctx: AudioContext, push: (f: Float32Array) => void): AudioNode {
    const node = (ctx as any).createScriptProcessor(2048, 1, 1) as ScriptProcessorNode;
    node.onaudioprocess = (e) => push(new Float32Array(e.inputBuffer.getChannelData(0)));
    return node;
  }

  private push(f32: Float32Array) {
    if (!this.active || this.pausedLive || this.stopping && this.status === 'closed') return;
    for (let i = 0; i < f32.length; i += 1) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      this.pending.push(s < 0 ? s * 0x8000 : s * 0x7fff);
    }
    while (this.pending.length >= CHUNK) {
      const chunk = this.pending.splice(0, CHUNK);
      this.send(toBase64(chunk));
    }
  }

  private send(b64: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64 }));
      this.sentAny = true;
    } else {
      this.held.push(b64);
      if (this.held.length > HOLD / CHUNK) this.held.shift();
    }
  }

  private flushHeld() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    for (const b64 of this.held) { this.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64 })); this.sentAny = true; }
    this.held = [];
  }

  // --- the socket ----------------------------------------------------------

  private async connect(): Promise<void> {
    if (!this.active) return;
    this.attempts += 1;
    let token;
    try {
      token = await api.voiceLiveToken({ language: this.opts.language, sessionId: this.opts.sessionId ?? null });
    } catch (err: any) {
      this.fail(err?.message || "Live captions couldn't start.");
      return;
    }
    this.model = token.model;
    if (token.maxSeconds > 0) this.maxSeconds = token.maxSeconds;
    // The session ends itself at the server's limit: a socket left open in a
    // pocket is a paid minute a minute, and the API only learns of it from
    // what this reports (Codex review, 8 Sep 2026). The recording, if there
    // is one, carries on; the screen says the captions stopped.
    if (!this.limitTimer) {
      const left = this.maxSeconds * 1000 - (Date.now() - this.startedAt);
      this.limitTimer = setTimeout(() => {
        if (!this.active || this.stopping) return;
        this.error = `Live captions stop after ${Math.round(this.maxSeconds / 60)} minutes. Tap Done when you're ready.`;
        this.active = false;
        const ws = this.ws; this.ws = null;
        try { ws?.close(); } catch { /* noop */ }
        this.closeAudio();
        this.setStatus('failed');
        this.report();
      }, Math.max(1000, left));
    }
    if (!this.urls.length) {
      // The address the API gives, and the same without its query as a second
      // try: the two spellings the provider has used for a transcription session.
      this.urls = [token.url, token.url.split('?')[0]].filter((u, i, all) => all.indexOf(u) === i);
    }
    const url = this.urls[this.urlIndex % this.urls.length];
    let ws: WebSocket;
    try {
      ws = new WebSocket(url, ['realtime', `openai-insecure-api-key.${token.token}`]);
    } catch (err: any) {
      this.fail('Live captions are not available in this browser.');
      return;
    }
    this.ws = ws;
    let openedHere = false;
    ws.onopen = () => {
      openedHere = true;
      this.openedOnce = true;
      if (this.attempts > 1) this.reconnects += 1;
      this.setStatus(this.stopping ? 'finishing' : 'listening');
      this.flushHeld();
    };
    ws.onmessage = (e) => this.handle(e.data);
    ws.onerror = () => { /* the close that follows carries on */ };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.active || this.stopping) { this.onSettled?.(); return; }
      // Never opened on this address: try the other spelling before counting it a failure.
      if (!openedHere && !this.openedOnce && this.urls.length > 1 && this.urlIndex < this.urls.length - 1) { this.urlIndex += 1; this.attempts -= 1; }
      this.reconnect();
    };
  }

  private reconnect() {
    if (!this.active || this.stopping) return;
    if (this.attempts >= BACKOFF.length + 1) {
      this.fail('Live captions dropped out. The recording still has everything.');
      return;
    }
    this.setStatus('reconnecting');
    const delay = BACKOFF[Math.min(this.attempts - 1, BACKOFF.length - 1)];
    setTimeout(() => { void this.connect(); }, delay);
  }

  private fail(message: string) {
    this.error = message;
    this.active = false;
    this.setStatus('failed');
    this.closeAudio();
    try { this.ws?.close(); } catch { /* noop */ }
    this.ws = null;
  }

  private handle(raw: any) {
    let ev: any;
    try { ev = JSON.parse(String(raw)); } catch { return; }
    switch (ev.type) {
      case 'conversation.item.input_audio_transcription.delta': {
        const id = String(ev.item_id ?? 'x');
        if (!this.items.has(id)) { this.items.set(id, ''); this.order.push(id); }
        this.items.set(id, (this.items.get(id) ?? '') + String(ev.delta ?? ''));
        this.emit();
        break;
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const id = String(ev.item_id ?? 'x');
        this.items.delete(id);
        this.order = this.order.filter((x) => x !== id);
        this.committed = join(this.committed, String(ev.transcript ?? ''));
        this.completions += 1;
        this.emit();
        if (this.stopping && !this.order.length) this.onSettled?.();
        break;
      }
      case 'conversation.item.input_audio_transcription.failed': {
        const id = String(ev.item_id ?? 'x');
        // Keep whatever was drafted; the recording has the rest.
        if (this.items.has(id)) { this.committed = join(this.committed, this.items.get(id) ?? ''); this.items.delete(id); this.order = this.order.filter((x) => x !== id); }
        this.emit();
        break;
      }
      case 'error': {
        // The provider's words are for the console, not the screen.
        console.warn('live transcription', ev.error?.message ?? ev.error ?? ev);
        break;
      }
      default:
        break;
    }
  }

  // --- pausing -------------------------------------------------------------

  private pausedLive = false;
  /** Stop feeding the provider; the words so far stay on screen (C2b). */
  pause() {
    this.pausedLive = true;
    void this.ctx?.suspend().catch(() => {});
    this.pending = [];
    this.emit();
  }
  resume() {
    this.pausedLive = false;
    void this.ctx?.resume().catch(() => {});
  }
  get isPaused() { return this.pausedLive; }

  // --- ending --------------------------------------------------------------

  /** Done: commit what is in flight, wait briefly for the last words, close, report. */
  async stop(): Promise<LiveResult> {
    const stopAt = Date.now();
    if (!this.active && this.status !== 'failed') return this.result(stopAt);
    this.stopping = true;
    if (this.status !== 'failed') this.setStatus('finishing');
    // The last part-chunk, then the commit.
    if (this.pending.length && this.ws?.readyState === WebSocket.OPEN) { this.send(toBase64(this.pending.splice(0))); }
    if (this.ws?.readyState === WebSocket.OPEN && this.sentAny) {
      // Commit what is in flight, then wait for the provider's last word: the
      // completion of the phrase being spoken when Done was tapped, which may
      // not have produced a single delta yet (Codex review, 8 Sep 2026 — the
      // whole transcript of a short utterance was lost by resolving at once).
      const before = this.completions;
      try { this.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' })); } catch { /* noop */ }
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 3000);
        this.onSettled = () => { if (this.completions > before && !this.order.length) { clearTimeout(t); resolve(); } };
      });
    }
    this.finish();
    return this.result(stopAt);
  }

  /** Cancel: close and keep nothing — the seconds are still reported, because they were spent. */
  cancel() {
    this.stopping = true;
    this.finish();
    this.committed = '';
    this.items.clear();
    this.order = [];
  }

  private finish() {
    this.active = false;
    this.onSettled = null;
    clearTimeout(this.limitTimer);
    this.limitTimer = null;
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch { /* noop */ }
    this.closeAudio();
    if (this.status !== 'failed') this.setStatus('closed');
    this.report();
  }

  private reported = false;
  /** The seconds this session ran, to the ledger — once, however it ended. */
  private report() {
    if (this.reported || !this.openedOnce) return;
    this.reported = true;
    const seconds = Math.round((Date.now() - this.startedAt) / 1000);
    if (seconds >= 1) void api.voiceLiveUsed({ seconds, sessionId: this.opts.sessionId ?? null, model: this.model }).catch(() => {});
  }

  private closeAudio() {
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* noop */ } }
    this.nodes = [];
    const ctx = this.ctx;
    this.ctx = null;
    void ctx?.close().catch(() => {});
    this.pending = [];
    this.held = [];
  }

  private result(stopAt: number): LiveResult {
    return {
      transcript: join(this.committed, this.partial),
      seconds: Math.round((Date.now() - this.startedAt) / 1000),
      model: this.model,
      ms: Date.now() - stopAt,
      error: this.error,
      reconnects: this.reconnects,
    };
  }
}

/** Linear resampling from the context's rate down (or up) to 24 kHz. Good enough for speech. */
function resample(f32: Float32Array, ratio: number): Float32Array {
  const n = Math.floor(f32.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = i * ratio;
    const j = Math.floor(x);
    const t = x - j;
    out[i] = f32[j] * (1 - t) + (f32[Math.min(j + 1, f32.length - 1)] ?? f32[j]) * t;
  }
  return out;
}

function toBase64(samples: number[]): string {
  const bytes = new Uint8Array(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.round(samples[i]);
    bytes[i * 2] = v & 0xff;
    bytes[i * 2 + 1] = (v >> 8) & 0xff;
  }
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return btoa(s);
}
