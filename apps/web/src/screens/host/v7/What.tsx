/**
 * Step 1, "What is it?" (shared, signed off — Epic Hosting v7 › Step 1 revised),
 * and the two ways Epic fills it in:
 *
 *   · the box: tap it and the categories drop down, tap one and its
 *     subcategories, with a back row; type and the list becomes matches plus
 *     "+ Use '…'". Picked, the choice is a lime chip, then Title, a photo and
 *     "Under the title" (Suggested until edited);
 *   · Say it: the lane's prompts tick off as each is heard, over a live
 *     transcript and a waveform, then Done · build my draft;
 *   · Upload it: Files · Photos · Notes · Paste, read with a progress bar,
 *     ticking off what it finds;
 *   · Here's your draft: what was filled in, the gaps marked Add in moss, each
 *     row a link to its step.
 *
 * On a later step the header mic opens Say it for that step alone: what is
 * said fills that step's fields (RULINGS › Say it).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, Text, TextInput, View } from 'react-native';
import { Press } from '../../../components/press';
import { Icon, IconName } from '../../../components/Icon';
import { showToast } from '../../../components/Toast';
import { mediaUrl } from '../../../components/hosting';
import { pickPhotoBlob } from '../../../components/pickPhoto';
import { useSpeech } from '../../../hooks/useSpeech';
import { api } from '../../../api';
import { CREAM, HAIRLINE, INACTIVE, INK, INK_MUTED, LIME, LIME_TINT, MOSS, TRACK, fonts } from '../../../theme';
import { Field, Kicker, StepTitle, Tick, pointer, tx, hx, v, textStyles } from './kit';
import { LANES, SUGGESTED_LINE, draftRows, titleOf, type LaneOffer, type StepKey } from './model';
import type { StepProps } from './Setup';

const web = Platform.OS === 'web';

// ---------------------------------------------------------------------------
// the box
// ---------------------------------------------------------------------------

export function WhatStep({ offer, lane, update, onSay, onUpload }: StepProps & { onSay: () => void; onUpload: () => void }) {
  const look = LANES[lane];
  const [focus, setFocus] = useState(false);
  const [typed, setTyped] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const q = typed.trim().toLowerCase();
  const all = useMemo(() => Object.entries(look.cats).flatMap(([c, subs]) => subs.map((t) => ({ t, c }))), [look]);

  const pick = (label: string, category: string | null) => {
    const suggested = category ? SUGGESTED_LINE[category] ?? null : null;
    update({
      whatLabel: label, whatCategory: category,
      title: offer.title?.trim() ? offer.title : label,
      ...(offer.line && !offer.lineSuggested ? {} : { line: suggested, lineSuggested: Boolean(suggested) }),
    });
    setTyped(''); setFocus(false); setCat(null);
  };

  if (offer.whatLabel) return <Picked offer={offer} update={update} onClear={() => { update({ whatLabel: null, whatCategory: null }); setFocus(true); }} />;

  const rows: { t: string; s?: string; r?: string; go: () => void }[] = q
    ? all.filter((x) => x.t.toLowerCase().includes(q)).slice(0, 5).map((x) => ({ t: x.t, s: `${x.c} › ${x.t}`, go: () => pick(x.t, x.c) }))
    : cat ? look.cats[cat].map((t) => ({ t, go: () => pick(t, cat) }))
      : Object.entries(look.cats).map(([c, subs]) => ({ t: c, r: `${subs.length} ›`, go: () => setCat(c) }));

  return (
    <>
      <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, paddingHorizontal: 14, borderWidth: 1, borderColor: focus ? INK : HAIRLINE }]}>
        <Icon name="search" size={18} color={INK_MUTED} strokeWidth={2} />
        <TextInput value={typed} onChangeText={(s) => { setTyped(s); setFocus(true); setCat(null); }} onFocus={() => setFocus(true)} placeholder={look.placeholder}
          placeholderTextColor={INK_MUTED} accessibilityLabel="What is it?" style={[tx(16, '400'), { flex: 1, padding: 0 }, web && ({ outlineStyle: 'none' } as object)]} />
      </View>
      {focus ? (
        <View style={{ marginTop: -12, borderWidth: 1, borderTopWidth: 0, borderColor: HAIRLINE }}>
          {cat && !q ? (
            <Press onPress={() => setCat(null)} accessibilityRole="button" style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 11, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: HAIRLINE, backgroundColor: INACTIVE }, pointer]}>
              <Icon name="previous" size={16} color={INK} strokeWidth={2} /><Text style={tx(14, '700')}>{cat}</Text>
            </Press>
          ) : null}
          {rows.map((r) => (
            <Press key={`${r.t}-${r.s ?? ''}`} onPress={r.go} accessibilityRole="button" style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: HAIRLINE }, pointer]}>
              <View style={{ flex: 1 }}>
                <Text style={tx(15, '600')}>{r.t}</Text>
                {r.s ? <Text style={tx(12, '400', INK_MUTED)}>{r.s}</Text> : null}
              </View>
              {r.r ? <Text style={tx(13, '400', INK_MUTED)}>{r.r}</Text> : null}
            </Press>
          ))}
          {q ? (
            <Press onPress={() => pick(typed.trim(), null)} accessibilityRole="button" style={[{ paddingVertical: 11, paddingHorizontal: 14 }, pointer]}>
              <Text style={tx(14, '600', MOSS)}>+ Use “{typed.trim()}”</Text>
            </Press>
          ) : null}
        </View>
      ) : (
        <View style={{ gap: 10, marginTop: 6 }}>
          <Kicker>Or let Epic fill it in</Kicker>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <WayTile icon="mic" iconBg={LIME} title="Say it" sub="We prompt you as you talk" onPress={onSay} />
            <WayTile icon="upload" iconBg={CREAM} title="Upload it" sub="An invite, a flyer, a PDF or a note" onPress={onUpload} />
          </View>
        </View>
      )}
    </>
  );
}

function WayTile({ icon, iconBg, title, sub, onPress }: { icon: IconName; iconBg: string; title: string; sub: string; onPress: () => void }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={title}
      style={[{ flex: 1, minHeight: 128, backgroundColor: INACTIVE, paddingVertical: 14, paddingHorizontal: 12, gap: 12 }, pointer]}>
      <View style={{ width: 40, height: 40, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={20} color={INK} strokeWidth={2} /></View>
      <View>
        <Text style={tx(16, '800')}>{title}</Text>
        <Text style={tx(12.5, '400', INK_MUTED, { lineHeight: 17 })}>{sub}</Text>
      </View>
    </Press>
  );
}

/** Picked: the chip in the box, then Title, a photo, and "Under the title". */
function Picked({ offer, update, onClear }: { offer: LaneOffer; update: StepProps['update']; onClear: () => void }) {
  const [uploading, setUploading] = useState(false);
  const photo = offer.photos[0]?.url ? mediaUrl(offer.photos[0].url) : null;
  const addPhoto = async () => {
    const blob = await pickPhotoBlob();
    if (!blob) return;
    setUploading(true);
    try {
      const m = await api.uploadHostMedia(blob, 'photo', null, 'listing');
      update({ photoIds: [m.id], photos: [{ id: m.id, url: `/api/media/${m.id}` }] } as never);
    } catch (e: any) { showToast(e.message); } finally { setUploading(false); }
  };
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', height: 52, paddingLeft: 14, paddingRight: 8, borderWidth: 1, borderColor: HAIRLINE }}>
        <Press onPress={onClear} accessibilityRole="button" accessibilityLabel={`${offer.whatLabel} — change`}
          style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: LIME, paddingVertical: 5, paddingHorizontal: 10 }, pointer]}>
          <Text style={tx(14.5, '700')}>{offer.whatLabel}</Text>
          <Icon name="close" size={13} color={INK} strokeWidth={2.6} />
        </Press>
      </View>
      <View style={{ gap: 6 }}>
        <Kicker>Title</Kicker>
        <Field value={offer.title ?? ''} onChange={(title) => update({ title })} accessibilityLabel="Title" />
      </View>
      <Press onPress={() => { void addPhoto(); }} accessibilityRole="button" accessibilityLabel={photo ? 'Change the photo' : 'Add a photo'}
        style={[{ height: 140, borderRadius: 10, overflow: 'hidden', backgroundColor: INACTIVE, alignItems: 'center', justifyContent: 'center' }, pointer]}>
        {photo ? <Image source={{ uri: photo }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} resizeMode="cover" /> : null}
        {photo ? null : (
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Icon name="camera" size={22} color={INK} />
            <Text style={tx(13.5, '700')}>{uploading ? 'Adding…' : 'Add a photo'}</Text>
          </View>
        )}
      </Press>
      <View style={{ gap: 6 }}>
        <Kicker>Under the title</Kicker>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingVertical: 11, paddingHorizontal: 12, borderWidth: 1, borderColor: HAIRLINE }}>
          <TextInput value={offer.line ?? ''} onChangeText={(line) => update({ line, lineSuggested: false })} multiline numberOfLines={2} accessibilityLabel="Under the title"
            style={[tx(15, '400', INK, { lineHeight: 21 }), { flex: 1, padding: 0, minHeight: 42 }, web && ({ outlineStyle: 'none' } as object)]} />
          {offer.lineSuggested ? <Text style={[v.kicker, { color: MOSS, marginTop: 3, letterSpacing: 0.55 }]}>Suggested</Text> : null}
        </View>
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Say it
// ---------------------------------------------------------------------------

/**
 * Whether a prompt has been covered yet, read off the words as they arrive.
 * A rough, free reading on the device — the real reading is the server's,
 * once Done is tapped. It only ever ticks forward.
 */
const HEARD: RegExp[][] = [
  [/\b(party|wedding|class|club|course|lesson|tour|night|group|session|walk|for (the )?(kids|children|adults|everyone|beginners))\b/i],
  [/\b(mon|tues|wednes|thurs|fri|satur|sun)day|\b\d{1,2}(st|nd|rd|th)?\b|\b(january|february|march|april|may|june|july|august|september|october|november|december|week|weeks|morning|evening|afternoon|o'?clock|am|pm|till|until)\b/i],
  [/\b(at|in|near|venue|hall|park|centre|center|our place|my place|yours|theirs|online|zoom|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i],
  [/\b(then|first|after|lunch|drinks|dinner|speeches|band|games|years|experience|because|able to|learn|teach)\b/i],
  [/\b(invite|inviting|friends|family|everyone|anyone|people|places|£|pounds?|free|price|cost|each|per)\b/i],
];

export function SayIt({ offer, lane, step, onBuilt, setBar }: StepProps & { step: StepKey; onBuilt: (o: LaneOffer) => void; setBar?: (b: Bar | null) => void }) {
  const look = LANES[lane];
  const scoped = step !== 'what';
  const prompts = scoped ? [titleOf(lane, step)] : look.prompts;
  const [reading, setReading] = useState(false);
  const [ticked, setTicked] = useState(0);
  const sent = useRef(false);
  const speech = useSpeech({
    confirm: false,
    onFinal: async (text) => {
      if (sent.current) return;
      sent.current = true;
      if (!text.trim()) { showToast('Nothing came through. Try again, or type it in.'); sent.current = false; return; }
      setReading(true);
      try {
        const r = await api.laneExtract({ lane, offerId: offer.id || null, step: scoped ? step : null, text, source: 'said' });
        onBuilt(r.offer);
      } catch (e: any) { showToast(e.message); sent.current = false; } finally { setReading(false); }
    },
  });
  useEffect(() => { if (speech.supported) speech.start(); return () => { speech.cancel?.(); }; }, []);
  const words = `${speech.transcript ?? ''} ${speech.interim ?? ''}`.trim();
  useEffect(() => {
    if (scoped) { setTicked(words ? 1 : 0); return; }
    let n = ticked;
    while (n < prompts.length && HEARD[n]?.some((re) => re.test(words))) n += 1;
    if (n > ticked) setTicked(n);
  }, [words]);
  const [wave, setWave] = useState(0);
  useEffect(() => { if (!speech.listening) return; const t = setInterval(() => setWave((w) => w + 1), 220); return () => clearInterval(t); }, [speech.listening]);
  const secs = speech.seconds ?? 0;
  const clock = `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;

  useEffect(() => {
    setBar?.({ label: reading ? 'Building your draft…' : scoped ? 'Done · fill this step' : 'Done · build my draft', busy: reading, disabled: !words && !speech.listening, onPress: () => speech.stop() });
    return () => setBar?.(null);
  }, [reading, words, speech.listening]);

  if (!speech.supported) {
    return (
      <>
        <StepTitle title="Say it" />
        <Text style={v.body}>This browser can’t listen. Type it in instead — it takes a minute.</Text>
      </>
    );
  }
  return (
    <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={hx(24, -0.03, 1.1)}>{scoped ? titleOf(lane, step) : 'Say it'}</Text>
        <Text style={v.count}>{clock}</Text>
      </View>
      <View style={v.list}>
        {prompts.map((p, i) => {
          const done = i < ticked; const now = i === ticked;
          return (
            <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
              <Tick on={done} size={22} />
              <Text style={tx(15, now ? '800' : '600', done ? INK_MUTED : INK)}>{p}</Text>
            </View>
          );
        })}
      </View>
      <View style={{ backgroundColor: INACTIVE, padding: 14, minHeight: 120 }}>
        <Text style={tx(15, '400', INK, { lineHeight: 22.5 })}>{words ? `“${words}${speech.listening ? '…' : ''}”` : speech.listening ? '“…”' : ''}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, height: 44 }} accessibilityElementsHidden>
        {Array.from({ length: 16 }, (_, i) => <View key={i} style={{ flex: 1, height: speech.listening ? 8 + ((i * 7 + wave * 5) % 30) : 6, backgroundColor: INK }} />)}
      </View>
      {speech.error ? <Text style={tx(13, '400', INK_MUTED)}>{speech.error}</Text> : null}
    </>
  );
}

export type Bar = { label: string; onPress: () => void; disabled?: boolean; busy?: boolean };

// ---------------------------------------------------------------------------
// Upload it
// ---------------------------------------------------------------------------

type Source = 'Files' | 'Photos' | 'Notes' | 'Paste';
const SOURCE_ICON: Record<Source, IconName> = { Files: 'file', Photos: 'picture', Notes: 'note', Paste: 'paste' };

function chooseFile(accept: string, capture = false): Promise<File | null> {
  if (!web || typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    if (capture) input.setAttribute('capture', 'environment');
    input.onchange = () => resolve(input.files?.[0] ?? null);
    const onFocus = () => { setTimeout(() => { if (!input.files?.length) resolve(null); }, 400); window.removeEventListener('focus', onFocus); };
    window.addEventListener('focus', onFocus);
    input.click();
  });
}

async function asJpeg(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return (await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85))) ?? file;
  } catch { return file; }
}

const FOUND_LABEL: Record<string, string> = {
  whatLabel: 'What it is', title: 'Title', line: 'Under the title', startsOn: 'When', firstDate: 'When', weekdays: 'Which days', startsAt: 'Time', place: 'Where', venue: 'Where',
  runningOrder: 'Running order', whyYou: 'Why you', freeHours: 'When you’re free', outcome: 'By the end', topics: 'Session plan', sessions: 'How many sessions',
  priceMode: 'Price', pricePence: 'Price', dropInPence: 'Price', bookAheadPence: 'Price', totalPence: 'Price', maxCount: 'How many', minCount: 'How many', visibility: 'Who can come', otherHosts: 'Other hosts',
};

export function UploadIt({ offer, lane, onBuilt, setBar }: StepProps & { onBuilt: (o: LaneOffer) => void; setBar?: (b: Bar | null) => void }) {
  const [source, setSource] = useState<Source | null>(null);
  const [file, setFile] = useState<{ name: string; kind: string } | null>(null);
  const [state, setState] = useState<'idle' | 'reading' | 'read'>('idle');
  const [pct, setPct] = useState(0);
  const [found, setFound] = useState<string[]>([]);
  const [built, setBuilt] = useState<LaneOffer | null>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    if (state !== 'reading') return;
    const t = setInterval(() => setPct((p) => Math.min(90, p + 9)), 250);
    return () => clearInterval(t);
  }, [state]);

  const read = async (blob: Blob, name: string, kind: string) => {
    setFile({ name, kind }); setState('reading'); setPct(8); setFound([]);
    try {
      const r = await api.laneRead(lane, offer.id || null, blob);
      setFound([...new Set(r.found.map((k) => FOUND_LABEL[k] ?? k))]);
      setBuilt(r.offer); setPct(100); setState('read');
    } catch (e: any) { showToast(e.message); setState('idle'); setFile(null); }
  };
  const go = async (s: Source) => {
    setSource(s);
    if (s === 'Paste' || s === 'Notes') return;
    const f = await chooseFile(s === 'Photos' ? 'image/*' : 'application/pdf,text/plain,image/*', false);
    if (!f) return;
    // A photo goes up as a JPEG: an iPhone's HEIC is something the reader cannot look at, and the browser can redraw it.
    const blob = f.type.startsWith('image/') || /\.hei[cf]$/i.test(f.name) ? await asJpeg(f) : f;
    await read(blob, f.name, f.type === 'application/pdf' ? 'PDF' : f.type.startsWith('image/') ? 'Photo' : 'Note');
  };
  const readText = async () => {
    if (!text.trim()) return;
    setFile({ name: source === 'Notes' ? 'Your note' : 'What you pasted', kind: 'Note' }); setState('reading'); setPct(8);
    try {
      const r = await api.laneExtract({ lane, offerId: offer.id || null, text, source: 'pasted' });
      setFound([...new Set(r.found.map((k) => FOUND_LABEL[k] ?? k))]);
      setBuilt(r.offer); setPct(100); setState('read');
    } catch (e: any) { showToast(e.message); setState('idle'); setFile(null); }
  };

  const typing = (source === 'Paste' || source === 'Notes') && state === 'idle';
  useEffect(() => {
    setBar?.(typing
      ? { label: 'Read it', onPress: () => { void readText(); }, disabled: !text.trim() }
      : { label: 'Build my draft', onPress: () => { if (built) onBuilt(built); }, disabled: !built, busy: state === 'reading' });
    return () => setBar?.(null);
  }, [typing, text, built, state]);

  const expected = lane === 'onrequest' ? ['What it is', 'Title', 'Why you', 'When you’re free', 'Where'] : ['What it is', 'Title', 'When', 'Where', lane === 'oneoff' ? 'Running order' : lane === 'course' ? 'By the end' : 'Price'];
  return (
    <>
      <Text style={hx(24, -0.03, 1.1)}>Upload it</Text>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {(['Files', 'Photos', 'Notes', 'Paste'] as Source[]).map((s) => (
          <Press key={s} onPress={() => { void go(s); }} accessibilityRole="button" accessibilityLabel={s}
            style={[{ flex: 1, backgroundColor: source === s ? LIME_TINT : INACTIVE, paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center', gap: 8 }, pointer]}>
            <Icon name={SOURCE_ICON[s]} size={20} color={INK} strokeWidth={2} />
            <Text style={tx(13, '700')}>{s}</Text>
          </Press>
        ))}
      </View>
      {typing ? (
        <View style={{ borderWidth: 1, borderColor: INK, paddingVertical: 12, paddingHorizontal: 14, minHeight: 240 }}>
          <TextInput value={text} onChangeText={setText} multiline numberOfLines={10} autoFocus accessibilityLabel={source === 'Notes' ? 'Your note' : 'Paste it'}
            placeholder={source === 'Notes' ? 'Paste your note here' : 'Paste the invite or the details here'} placeholderTextColor={INK_MUTED}
            style={[tx(14.5, '400', INK, { lineHeight: 21.75 }), { minHeight: 210, padding: 0 }, web && ({ outlineStyle: 'none' } as object)]} />
        </View>
      ) : null}
      {file ? (
        <>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 12, backgroundColor: INACTIVE }}>
            <View style={{ width: 40, height: 48, backgroundColor: CREAM, alignItems: 'center', justifyContent: 'center' }}><Icon name={file.kind === 'Photo' ? 'picture' : 'file'} size={18} color={INK} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[tx(14.5, '700'), textStyles.ellipsis]} numberOfLines={1}>{file.name}</Text>
              <Text style={tx(12, '400', INK_MUTED, { marginTop: 2 })}>{file.kind} · {state === 'read' ? 'read' : 'reading'}</Text>
              <View style={{ height: 4, backgroundColor: TRACK, marginTop: 8 }}><View style={{ height: '100%', width: `${pct}%`, backgroundColor: LIME }} /></View>
            </View>
          </View>
          <View style={v.list}>
            {expected.map((k) => {
              const got = found.includes(k);
              return (
                <View key={k} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
                  <Tick on={got} size={20} />
                  <Text style={tx(13.5, '700')}>{k}</Text>
                </View>
              );
            })}
          </View>
        </>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Here's your draft
// ---------------------------------------------------------------------------

export function YourDraft({ offer, goStep }: StepProps & { onStartAgain: () => void }) {
  const rows = draftRows(offer);
  const filled = rows.filter((r) => r.v).length;
  return (
    <>
      <View style={{ gap: 4 }}>
        <Text style={hx(24, -0.03, 1.1)}>Here’s your draft</Text>
        <Text style={tx(13, '400', INK_MUTED)}>{filled} of {rows.length} filled in</Text>
      </View>
      <View style={v.list}>
        {rows.map((r) => (
          <Press key={r.k} onPress={() => goStep(r.step)} accessibilityRole="button" accessibilityLabel={`${r.k}: ${r.v ?? 'Add'}`}
            style={[{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: HAIRLINE }, pointer]}>
            <Tick on={Boolean(r.v)} size={20} />
            <Text style={[tx(14, '700'), { width: 118 }]}>{r.k}</Text>
            <Text style={[tx(13.5, r.v ? '400' : '700', r.v ? INK : MOSS), { flex: 1, minWidth: 0 }, textStyles.ellipsis]} numberOfLines={1}>{r.v ?? 'Add'}</Text>
            <Icon name="more" size={15} color={INK_MUTED} strokeWidth={2} />
          </Press>
        ))}
      </View>
    </>
  );
}

void fonts; void useMemo;
