/**
 * One introduction, at whatever stage it has reached (Casual meet ups,
 * O7–O10, O12–O14).
 *
 * Each step reveals slightly more, and each step can end silently:
 *
 *   the host is asked first, and adds a detail that fits this one person (O7);
 *   the guest reads an introduction, not a booking — no surname, no
 *   photograph, no contact (O8); both record twenty seconds, blind (O12);
 *   both watch and both must say yes (O13); only then are they introduced
 *   (O14); then ID, both sides, once (O9); then chat, then the meeting place.
 *
 * Nobody is ever told they were turned down. A verdict is never reported
 * until both are in, and a no is reported to nobody at all — which is why
 * "not this time" costs the person answering nothing.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import { api, OpenMatch } from '../../api';
import { colors, INK, LIME } from '../../theme';
import { Icon } from '../../components/Icon';
import { StatusLine } from '../../components/ui';
import { mediaUrl } from '../../components/hosting';
import { useViewport } from '../../hooks/useViewport';
import { useRouter } from '../../router';
import { paths } from '../../routes';
import { Aside, Cta, DoneBlock, FactChip, InfoRow, Nav, RedNote, TintBlock, TwoWay, k, t } from '../../components/hostKit';

const TOP = (Platform.OS === 'web' ? 'max(8px, var(--epic-sat))' : 8) as any;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** "2026-10-04" → "October". Roughly when is as close as either side is ever told. */
const monthOf = (iso?: string | null) => {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { month: 'long' });
};
/** A language is named the way it is written: English, not english. */
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** "chess club and beach walks", in the words they used. */
const listOf = (xs: string[]) => {
  const s = xs.map((x) => x.toLowerCase());
  return s.length > 1 ? `${s.slice(0, -1).join(', ')} and ${s[s.length - 1]}` : s[0] ?? 'the same things';
};

export function MatchScreen({ matchId }: { matchId: string }) {
  const { width } = useViewport();
  const wide = width >= 900;
  const { navigate, back } = useRouter();
  const [match, setMatch] = useState<OpenMatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setMatch((await api.openMatch(matchId)).match); setError(null); } catch (e: any) { setError(e.message); }
  }, [matchId]);
  useEffect(() => { void load(); }, [load]);

  const answer = async (fn: () => Promise<{ match: OpenMatch }>) => {
    setBusy(true);
    try { setMatch((await fn()).match); setError(null); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const home = () => navigate(paths.host(), { replace: true });

  if (error && !match) {
    return (
      <View style={k.page}>
        <View style={[wide && k.wide, { paddingTop: TOP }]}><Nav title="Epic" onBack={home} /></View>
        <View style={[k.gutter, { paddingTop: 24, gap: 12 }]}>
          <Text style={t.h24}>Nothing here</Text>
          <Text style={t.sub}>{error}</Text>
          <Cta quiet label="Back to hosting" onPress={home} style={{ paddingHorizontal: 0 }} />
        </View>
      </View>
    );
  }
  if (!match) return <View style={[k.page, k.gutter, { paddingTop: 24 }]}><Text style={t.sub}>Opening…</Text></View>;

  const m = match;
  // The header is where you are in this: your own town when you are the one at
  // home, and the direction you are travelling when you are the one visiting.
  const j = m.you?.journey;
  const nav = j?.to
    ? `${j.from ? `${j.from} → ` : ''}${j.to}`
    : m.side === 'host' ? (m.from ? String(m.from) : 'Near you') : m.introduction?.town ?? 'Epic';

  const body = () => {
    // O7 / O10 — the host is asked first, and adds the detail for this guest.
    if (m.stage === 'host_asked' && m.side === 'host') return <HostAsked match={m} busy={busy} onAnswer={(a, where, note) => answer(() => api.openHostAnswer(m.id, { answer: a, where, note }))} />;
    // O8 — the guest reads the introduction.
    if (m.stage === 'guest_asked' && m.side === 'guest') return <GuestAsked match={m} busy={busy} onAnswer={(a) => answer(() => api.openGuestAnswer(m.id, a))} />;
    // O12 / O13 — twenty seconds each, blind, then both decide.
    if (m.stage === 'videos') return <Swap match={m} busy={busy} onSent={setMatch} onDecide={(a) => answer(() => api.openDecide(m.id, a))} onError={setError} />;
    // O14 / O9 — both said yes; then ID, once each, before anything is exchanged.
    if (m.stage === 'both_yes' || m.stage === 'verified') return <BothYes match={m} busy={busy} onVerify={() => answer(() => api.openVerify(m.id))} />;
    if (m.stage === 'chat') return <Introduced match={m} />;
    return <Waiting match={m} />;
  };

  return (
    <View style={k.page}>
      <View style={[wide && k.wide, { paddingTop: TOP }]}><Nav title={nav} onBack={() => back(paths.host())} /></View>
      <ScrollView contentContainerStyle={[styles.scroll, wide && k.wide]} keyboardShouldPersistTaps="handled">
        {body()}
        {error ? <View style={[k.gutter, { paddingTop: 12 }]}><StatusLine tone="warn">{error}</StatusLine></View> : null}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// O7 · O10 — the host is asked first
// ---------------------------------------------------------------------------

function HostAsked({ match: m, busy, onAnswer }: { match: OpenMatch; busy: boolean; onAnswer: (a: 'yes' | 'no', where: string | null, note: string | null) => void }) {
  const [where, setWhere] = useState(m.detail?.where ?? '');
  const [note, setNote] = useState(m.detail?.note ?? '');
  const said = listOf(m.interests);
  const family = m.kind === 'family';
  // Where from and roughly when — never a date, never an address, never a name.
  const month = monthOf(m.when);

  return (
    <View>
      <View style={[k.gutter, { paddingTop: 16 }]}>
        {family ? (
          <TintBlock title={`Another family is up for ${said}`}>
            Visiting {m.from ?? 'here'}{month ? ` in ${month}` : ''}, with children in the same age band as yours.
          </TintBlock>
        ) : (
          <TintBlock title="We have a match">
            Somebody visiting {m.from ?? 'your town'}{m.origin ? ` from ${m.origin}` : ''}{month ? ` in ${month}` : ''} is up for <Text style={[t.strong, { color: colors.ink }]}>{said}</Text>.
          </TintBlock>
        )}
      </View>
      <View style={[k.gutter, { paddingTop: 14, gap: 12 }]}>
        {family ? (
          <>
            <Text style={t.kicker}>What we matched on</Text>
            <View style={styles.chipWrap}>{[...(m.childAgeBands ?? []).map((b) => `Ages ${b}`), ...m.interests, 'Daytime', 'Free'].map((c) => <FactChip key={c} label={c} />)}</View>
            <Text style={t.kicker}>How family meets work</Text>
            <View>
              <InfoRow icon="park" title="Daytime, and always somewhere public" line="A park, a beach, soft play, a café." />
              <InfoRow icon="household" title="Both families there throughout" line="Never one adult and another family’s child. Both adults ID-checked first." />
            </View>
            <RedNote>No child’s name or photograph, ever — and we do not match or filter by a child’s sex.</RedNote>
          </>
        ) : (
          <>
            <Aside>They do not know you exist. Nothing goes to them until you answer.</Aside>
            <Text style={t.kicker}>Before we tell them anything</Text>
            <View style={{ gap: 10 }}>
              <View style={{ gap: 5 }}>
                <Text style={[t.label, { fontSize: 12.5 }]}>Where, and when?</Text>
                <TextInput value={where} onChangeText={setWhere} placeholder="The Turk’s Head, Thursdays from seven" placeholderTextColor={colors.ghost}
                  style={[styles.field, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]} />
              </View>
              <View style={{ gap: 5 }}>
                <Text style={[t.label, { fontSize: 12.5 }]}>Anything they should know?</Text>
                <TextInput value={note} onChangeText={setNote} multiline placeholder="Bring nothing. Boards are there, first game is usually blitz." placeholderTextColor={colors.ghost}
                  style={[styles.field, { minHeight: 64, textAlignVertical: 'top' }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]} />
              </View>
            </View>
          </>
        )}
        <View style={{ gap: 7 }}>
          <Text style={[t.label, { fontSize: 12.5 }]}>Are you up for this one?</Text>
          <TwoWay yes="Yes, tell them" no="Not this time" busy={busy} wide={family ? 1.4 : 1}
            onYes={() => onAnswer('yes', where.trim() || null, note.trim() || null)}
            onNo={() => onAnswer('no', null, null)} />
        </View>
        <Aside>“Not this time” is silent. They are never told they were turned down.</Aside>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// O8 — what the guest sees
// ---------------------------------------------------------------------------

function GuestAsked({ match: m, busy, onAnswer }: { match: OpenMatch; busy: boolean; onAnswer: (a: 'yes' | 'no') => void }) {
  const i = m.introduction!;
  const thing = (i.interests[0] ?? 'the same things').toLowerCase();
  const rest = i.interests.slice(1).map((x) => x.toLowerCase());
  const speaks = i.language ? `You both speak ${cap(i.language.name)}.` : '';
  return (
    <View>
      <View style={[k.gutter, { paddingTop: 16 }]}>
        <View style={{ backgroundColor: colors.surfaceMuted, padding: 15, gap: 6 }}>
          <Text style={[t.h21, { fontSize: 20, lineHeight: 23 }]}>{i.name} in {i.town ?? 'town'} is up for {thing}</Text>
          <Text style={[t.label, { fontWeight: '400', color: colors.accent, lineHeight: 19 }]}>
            {i.name} is up for you tagging along{rest.length ? `, and is also up for ${listOf(rest)}` : ''}.{' '}
            {speaks ? <Text style={[t.strong, { color: colors.ink }]}>{speaks}</Text> : null}
          </Text>
        </View>
      </View>
      <View style={[k.gutter, { paddingTop: 14, gap: 12 }]}>
        <Text style={t.kicker}>What {i.name} told us</Text>
        <View>
          {i.where ? <InfoRow icon="address" title={i.where} line={i.note ?? undefined} /> : null}
          {i.interests.slice(1).map((x) => <InfoRow key={x} icon="walking" title={`Also up for ${x.toLowerCase()}`} />)}
          {!i.where && !i.interests.length ? <InfoRow icon="household" title="Up for the same things as you" /> : null}
        </View>
        <Aside>No surname, no photograph, no contact details — and none of yours have gone to them.</Aside>
        <TwoWay yes="I am interested" no="No thanks" tone="ink" icon="message" busy={busy} onYes={() => onAnswer('yes')} onNo={() => onAnswer('no')} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// O12 · O13 — twenty seconds each, blind, then both decide
// ---------------------------------------------------------------------------

function Swap({ match: m, busy, onSent, onDecide, onError }: {
  match: OpenMatch; busy: boolean; onSent: (m: OpenMatch) => void; onDecide: (a: 'yes' | 'no') => void; onError: (e: string) => void;
}) {
  // Yours first: you record before you see theirs, which is what makes a no cost nothing.
  if (!m.video.mine) return <Record match={m} onSent={onSent} onError={onError} />;
  if (m.video.waiting || !m.video.theirs) return <Waiting match={m} />;
  return <Watch match={m} busy={busy} onDecide={onDecide} />;
}

/**
 * The example on O12, put in your own words: your first name, the journey you
 * are actually making, and the thing the two of you already share. It is an
 * example of what to say, so it has to sound like you rather than like a
 * stranger on a mock-up.
 */
function example(m: OpenMatch) {
  const name = m.you?.name;
  const j = m.you?.journey;
  const month = monthOf(j?.when);
  const thing = (m.interests[0] ?? 'the same things').toLowerCase();
  const head = [name ? `I am ${name}` : null, j?.to ? `over in ${j.to}${month ? ` in ${month}` : ''}` : null].filter(Boolean).join(', ');
  return `“${head ? `${head}. ` : ''}I am up for ${thing}, if you fancy it.”`;
}

/** O12 — one take, twenty seconds, no editing. It goes to one person and then it goes. */
function Record({ match: m, onSent, onError }: { match: OpenMatch; onSent: (m: OpenMatch) => void; onError: (e: string) => void }) {
  const seconds = m.video.seconds;
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<BlobPart[]>([]);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopAll = useCallback(() => {
    if (tick.current) { clearInterval(tick.current); tick.current = null; }
    recorderRef.current?.state === 'recording' && recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((t2) => t2.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => () => stopAll(), [stopAll]);

  const start = async () => {
    if (Platform.OS !== 'web') return;
    try {
      const stream = await (navigator as any).mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.muted = true; await videoRef.current.play().catch(() => {}); }
      chunks.current = [];
      const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm' });
      rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      rec.onstop = () => { setBlob(new Blob(chunks.current, { type: 'video/webm' })); stopAll(); setRecording(false); };
      recorderRef.current = rec;
      rec.start();
      setRecording(true); setElapsed(0); setBlob(null);
      tick.current = setInterval(() => setElapsed((s) => { const next = s + 1; if (next >= seconds) rec.state === 'recording' && rec.stop(); return next; }), 1000);
    } catch { onError('Epic could not reach the camera. Check the browser has permission.'); }
  };
  const send = async () => {
    if (!blob) return;
    setBusy(true);
    try { onSent((await api.openHello(m.id, blob, elapsed || seconds)).match); }
    catch (e: any) { onError(e.message); } finally { setBusy(false); }
  };

  return (
    <View>
      <View style={[k.gutter, { paddingTop: 16, gap: 5 }]}>
        <Text style={t.h24}>Say hello, twenty seconds</Text>
        <Text style={[t.label, { fontWeight: '400', color: colors.inkMuted, lineHeight: 19 }]}>You both record one. Neither of you sees the other until both are in.</Text>
      </View>
      <View style={[k.gutter, { paddingTop: 14, gap: 12 }]}>
        <View style={styles.recorder}>
          {Platform.OS === 'web' ? <video ref={videoRef} playsInline muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
          <View style={styles.recChip}>
            <View style={{ width: 8, height: 8, backgroundColor: colors.overrun }} />
            <Text style={[t.tiny, { fontSize: 11.5, fontWeight: '700', color: colors.bg }]}>{clock(elapsed)} / {clock(seconds)}</Text>
          </View>
          <Press onPress={() => (recording ? recorderRef.current?.stop() : void start())} accessibilityRole="button" accessibilityLabel={recording ? 'Stop' : 'Record'} style={styles.recButton}>
            <View style={{ width: 22, height: 22, backgroundColor: colors.overrun, borderRadius: recording ? 0 : 11 }} />
          </Press>
        </View>
        <Text style={t.kicker}>What to say</Text>
        <View>
          <InfoRow icon="person" title="Who you are, and what you fancy doing" line={example(m)} />
          <InfoRow icon="locked" title="Nobody else ever sees it" line="Not on your profile, not searchable. It goes to this one person and then it goes." />
        </View>
        <Aside>One take, twenty seconds, no editing. If you hate it, record it again.</Aside>
      </View>
      <Cta label={blob ? 'Send it' : 'Record it first'} loading={busy} disabled={!blob} onPress={() => void send()} style={{ paddingTop: 14, paddingBottom: 14 }} />
    </View>
  );
}

/** O13 — theirs is in. Watch it, then say whether you would like to be introduced. */
function Watch({ match: m, busy, onDecide }: { match: OpenMatch; busy: boolean; onDecide: (a: 'yes' | 'no') => void }) {
  const src = mediaUrl(m.video.theirs);
  const them = m.side === 'guest' ? m.introduction?.name ?? 'They' : m.name ?? 'They';
  // Where they are from: their town if you are the visitor, the town they are
  // travelling from if you are the one at home. Never anything closer than that.
  const town = m.side === 'guest' ? m.introduction?.town ?? null : m.origin ?? null;
  return (
    <View>
      <View style={[k.gutter, { paddingTop: 16, gap: 5 }]}>
        <Text style={t.h24}>{them} sent theirs too</Text>
        <Text style={[t.label, { fontWeight: '400', color: colors.inkMuted, lineHeight: 19 }]}>Watch it, then say whether you would like to be introduced.</Text>
      </View>
      <View style={[k.gutter, { paddingTop: 14, gap: 12 }]}>
        <View style={styles.player}>
          {Platform.OS === 'web' && src ? <video src={src} controls playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="video" size={28} color={colors.bg} />}
        </View>
        <View style={{ gap: 3 }}>
          <Text style={[t.body, { fontWeight: '700', lineHeight: 18 }]}>{them}{town ? ` · ${town}` : ''}</Text>
          <Text style={t.small}>{[m.language ? `${m.language.level === 'fluent' ? 'Fluent' : 'Some'} ${cap(m.language.name)}` : null, ...m.interests.map((i) => i.toLowerCase())].filter(Boolean).join(' · ')}</Text>
        </View>
        <TwoWay yes="Introduce us" no="No thanks" icon="keep" busy={busy} wide={1.3} onYes={() => onDecide('yes')} onNo={() => onDecide('no')} />
        <Aside><Text style={[t.strong, { color: colors.ink }]}>They have already answered</Text>, and you will not be told what they said until you have answered too. Nobody is ever told they were turned down.</Aside>
        <Aside>Still waiting for theirs? We hold yours, unseen, and nudge them once. After a week it lapses and neither of you hears any more about it.</Aside>
      </View>
    </View>
  );
}

/** Yours is in and theirs is not, or theirs is in and you have answered. Either way: nothing to do. */
function Waiting({ match: m }: { match: OpenMatch }) {
  const gone = ['lapsed', 'ended'].includes(m.stage);
  return (
    <View>
      <View style={[k.gutter, { paddingTop: 16 }]}>
        <TintBlock title={gone ? 'This one has gone quiet' : 'Yours is in'}>
          {gone
            ? 'Nothing more will come of this one. Nobody is told why, and nobody is told anything about you.'
            : 'We hold it, unseen, until theirs is in. We nudge them once; after a week it lapses and neither of you hears any more about it.'}
        </TintBlock>
      </View>
      <View style={[k.gutter, { paddingTop: 14, gap: 12 }]}>
        <Aside>Nobody is ever told they were turned down.</Aside>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// O14 · O9 — both said yes, then ID, then details
// ---------------------------------------------------------------------------

function BothYes({ match: m, busy, onVerify }: { match: OpenMatch; busy: boolean; onVerify: () => void }) {
  // O14 says you are introduced and what is left; O9 is the gate itself. They
  // are two screens because the ID is a separate decision from the yes.
  const [atGate, setAtGate] = useState(false);
  const mine = m.verified.you;
  // O14 — both said yes, separately. Nothing is exchanged yet.
  if (!mine && !atGate) {
    return (
      <View>
        <View style={[k.gutter, { paddingTop: 16 }]}><DoneBlock title="You are introduced" line="You both said yes, separately." /></View>
        <View style={[k.gutter, { paddingTop: 14, gap: 12 }]}>
          <Text style={t.kicker}>What happens now</Text>
          <View>
            <InfoRow icon="verified" title="A quick ID check, both of you" line="Once each. Nothing is exchanged until it clears." />
            <InfoRow icon="message" title="Then chat opens, inside Epic" line="Numbers and emails stay out of it until you choose." />
            <InfoRow icon="address" title="Then the meeting place" line="The club, the café, the park gate — somewhere public." />
          </View>
          <Aside>The videos are gone. They were for this decision and nothing else.</Aside>
        </View>
        <Cta label="Verify and continue" onPress={() => setAtGate(true)} style={{ paddingTop: 14, paddingBottom: 14 }} />
      </View>
    );
  }
  // O9 — the gate. The only point Epic ever asks for ID, and it asks both sides.
  if (!mine) {
    return (
      <View>
        <View style={[k.gutter, { paddingTop: 16, gap: 5 }]}>
          <Text style={t.h24}>Before you two swap details</Text>
          <Text style={[t.label, { fontWeight: '400', color: colors.inkMuted, lineHeight: 19 }]}>You have both said yes. This is the only point we ask for ID.</Text>
        </View>
        <View style={[k.gutter, { paddingTop: 14, gap: 12 }]}>
          <Text style={t.kicker}>Both of you</Text>
          <View>
            <InfoRow icon="identity" title="A photograph of your ID" line="Passport or driving licence. We check it and keep nothing but the result." />
            <InfoRow icon="face" title="A selfie, once" line="So we know the ID is yours. Never shown to anybody." />
          </View>
          <Text style={t.kicker}>What unlocks when it clears</Text>
          <View>
            <InfoRow icon="message" title="Chat, inside Epic" line="Numbers and emails stay out of it until you choose." />
            <InfoRow icon="address" title="The meeting place" line="The club, the café, the park gate — a public place, always." />
          </View>
          <RedNote>Home addresses are never shared by Epic, and a first meet is never at one.</RedNote>
        </View>
        <Cta label="Verify and continue" loading={busy} onPress={onVerify} style={{ paddingTop: 14, paddingBottom: 14 }} />
      </View>
    );
  }
  return (
    <View>
      <View style={[k.gutter, { paddingTop: 16 }]}>
        <TintBlock title="Yours has cleared">Waiting on theirs. Nothing is exchanged until both are done.</TintBlock>
      </View>
      <View style={[k.gutter, { paddingTop: 14, gap: 12 }]}>
        <Text style={t.kicker}>What unlocks when it clears</Text>
        <View>
          <InfoRow icon="message" title="Chat, inside Epic" line="Numbers and emails stay out of it until you choose." />
          <InfoRow icon="address" title="The meeting place" line="The club, the café, the park gate — a public place, always." />
        </View>
        <RedNote>Home addresses are never shared by Epic, and a first meet is never at one.</RedNote>
      </View>
    </View>
  );
}

function Introduced({ match: m }: { match: OpenMatch }) {
  const them = m.side === 'guest' ? m.introduction?.name ?? 'They' : m.name ?? 'They';
  return (
    <View>
      <View style={[k.gutter, { paddingTop: 16 }]}><DoneBlock title={`You and ${them} are introduced`} line="Both ID checks have cleared." /></View>
      <View style={[k.gutter, { paddingTop: 14, gap: 12 }]}>
        <Text style={t.kicker}>What happens now</Text>
        <View>
          <InfoRow icon="message" title="Chat, inside Epic" line="Numbers and emails stay out of it until you choose." />
          <InfoRow icon="address" title="The meeting place" line="The club, the café, the park gate — a public place, always." />
        </View>
        <RedNote>Home addresses are never shared by Epic, and a first meet is never at one.</RedNote>
        <Aside>The videos are gone. They were for this decision and nothing else.</Aside>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 20 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  field: { borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface, paddingVertical: 11, paddingHorizontal: 12, fontFamily: t.input.fontFamily, fontSize: 14, fontWeight: '500', lineHeight: 19, color: colors.ink },
  recorder: { height: 250, backgroundColor: colors.videoGround, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 16, overflow: 'hidden' },
  recChip: { position: 'absolute', top: 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.primary, paddingVertical: 5, paddingHorizontal: 9 },
  recButton: { width: 58, height: 58, borderRadius: 999, borderWidth: 3, borderColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  player: { height: 224, backgroundColor: colors.videoGround, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
