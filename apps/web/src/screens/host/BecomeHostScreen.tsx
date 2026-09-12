/**
 * Become a host: four steps, video first (Hosts and Events H1–H4).
 *
 *   1  What hosting is      people book the person, not the listing — which
 *                           is why we ask for your face and your voice first.
 *                           Who you are, what kind of host, and that you are 18.
 *   2  Record your video    a minute of you talking (the recorder is its own
 *                           page, /host/video).
 *   3  Credentials          your intro, credentials as chips, what "verified"
 *                           means, photo ID — and for a Local · Family host,
 *                           your children's ages.
 *   4  Getting paid         Epic collects and pays you out. Stripe is a key and
 *                           keys are the owner's, so this says where that
 *                           stands rather than opening a form that cannot work.
 *
 * `?step=n` is the address. Every step saves as it is left; a host can go live
 * before the checks finish — the profile just says "checks running".
 */

import React, { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import { api, HostHome, HostType, LocalKind, OwnHost, Place } from '../../api';
import { colors, fonts, spacing, TARGET, type, BORDER } from '../../theme';
import { Button, Row, Segmented, StatusLine, Wrap } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { PlacePicker } from '../../components/PlacePicker';
import { useViewport } from '../../hooks/useViewport';
import { asNumber, useQueryState, useRouter } from '../../router';
import { paths } from '../../routes';
import { pickPhotoBlob } from '../../components/pickPhoto';
import { HostFace, LOCAL_LABEL, TYPE_LABEL, TrustBadge, VideoHero } from '../../components/hosting';

const TYPES: { key: HostType; body: string }[] = [
  { key: 'practitioner', body: 'You sell a skill or a craft: the artist, the yoga teacher, the chef, the climbing instructor. People come to do the thing, and often to learn it.' },
  { key: 'local', body: 'You sell access and company, not expertise. "I will take you where I actually go."' },
  { key: 'guide', body: 'You sell knowledge and credentials: a licence, years, languages, insurance. Priced like a professional.' },
];
const LOCALS: { key: LocalKind; body: string }[] = [
  { key: 'family', body: 'A family hosting another family. Playgrounds, soft play, which beach. Daytime, kids present, public places.' },
  { key: 'something_you_do', body: 'You list what you are into and the guest finds a match. There is an activity, not just hanging out.' },
  { key: 'night_out', body: 'A group taking a visitor out properly. Over-18s only, named public venues, a minimum party.' },
  { key: 'neighbourhood', body: 'A walk round where you live, a food crawl.' },
];

export function BecomeHostScreen({ home, onChanged }: { home: HostHome; onChanged: () => Promise<void> }) {
  const { width } = useViewport();
  const wide = width >= 900;
  const { navigate, back } = useRouter();
  const [stepN, setStepN] = useQueryState<number | null>('step', 1, asNumber(1));
  const step = Math.min(4, Math.max(1, stepN ?? 1));
  const host = home.host;
  const [error, setError] = useState<string | null>(null);
  const go = (n: number) => { setError(null); setStepN(n); };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={[styles.scroll, wide && styles.wide]} keyboardShouldPersistTaps="handled">
        <Row style={{ justifyContent: 'space-between' }}>
          <Press onPress={() => (step > 1 ? go(step - 1) : back(paths.host()))} accessibilityRole="button" hitSlop={8}><Row><Icon name="back" size={18} /><Text style={type.h3}>{step === 1 ? 'Host on Epic' : step === 2 ? 'Your video' : step === 3 ? 'About you' : 'Getting paid'}</Text></Row></Press>
          <Text style={type.small}>{step} of 4</Text>
        </Row>
        <View style={styles.progress}>{[1, 2, 3, 4].map((n) => <View key={n} style={[styles.bar, n <= step && styles.barOn]} />)}</View>

        {step === 1 ? <WhatHostingIs host={host} home={home} error={error} setError={setError} onNext={async () => { await onChanged(); go(2); }} /> : null}
        {step === 2 ? <YourVideo host={host} onRecord={() => navigate(paths.hostVideo())} onNext={() => go(3)} /> : null}
        {step === 3 ? <Credentials host={host!} onChanged={onChanged} error={error} setError={setError} onNext={() => go(4)} /> : null}
        {step === 4 ? <GettingPaid host={host!} home={home} onChanged={onChanged} onDone={() => navigate(paths.host(), { replace: true })} /> : null}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// 1 · what hosting is, and who you are
// ---------------------------------------------------------------------------

function WhatHostingIs({ host, home, error, setError, onNext }: { host: OwnHost | null; home: HostHome; error: string | null; setError: (e: string | null) => void; onNext: () => Promise<void> }) {
  const [name, setName] = useState(host?.name ?? home.you?.name ?? '');
  const [kind, setKind] = useState<HostType | null>(host?.type ?? null);
  const [localKind, setLocalKind] = useState<LocalKind | null>(host?.localKind ?? null);
  const [dob, setDob] = useState(host?.dateOfBirth ?? '');
  const [place, setPlace] = useState<Place | null>(host?.location ? { label: host.location, lat: host.lat ?? 0, lng: host.lng ?? 0 } : null);
  const [busy, setBusy] = useState(false);
  const ok = name.trim() && kind && (kind !== 'local' || localKind) && /^\d{4}-\d{2}-\d{2}$/.test(dob);

  const next = async () => {
    if (!ok) { setError('Your name, what kind of host you are, and your date of birth — hosts are 18 or over.'); return; }
    setBusy(true); setError(null);
    try {
      const body = { name: name.trim(), type: kind!, localKind: kind === 'local' ? localKind : null, dateOfBirth: dob, locationLabel: place?.locality ?? place?.label ?? null, lat: place?.lat ?? null, lng: place?.lng ?? null, countryCode: place?.countryCode ?? null };
      if (host) await api.updateHost(body); else await api.becomeHost(body);
      await onNext();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <View style={{ gap: spacing.lg }}>
      <View>
        <Text style={type.title}>People book the person,{'\n'}not the listing.</Text>
        <Text style={[type.small, { marginTop: 6 }]}>Which is why we ask for your face and your voice first.</Text>
      </View>
      <View style={{ gap: spacing.md }}>
        {[
          { n: 1, t: 'A minute of you talking', b: 'What you do, why you know this place. Guests watch it before anything else.' },
          { n: 2, t: 'We check who you are', b: 'Name, photo ID and any qualification you claim. Verified hosts get a badge.' },
          { n: 3, t: 'You get paid through Epic', b: 'Guests pay us, we pay you out three days after it runs. No chasing.' },
        ].map((s) => (
          <Row key={s.n} style={{ alignItems: 'flex-start' }}>
            <View style={styles.num}><Text style={styles.numText}>{s.n}</Text></View>
            <View style={{ flex: 1 }}><Text style={type.h3}>{s.t}</Text><Text style={type.small}>{s.b}</Text></View>
          </Row>
        ))}
      </View>
      <Text style={type.small}>About ten minutes. You can save and come back — nothing goes live until you say so.</Text>

      <Field label="Your name, as guests will see it">
        <TextInput value={name} onChangeText={setName} placeholder="Maria Okafor" placeholderTextColor={colors.inkFaint} style={styles.input} />
      </Field>
      <Field label="Where you are">
        <PlacePicker value={place} onPick={setPlace} kind="area" placeholder="Windsor, or the town you host in" />
      </Field>
      <Field label="What kind of host are you?" hint="A positioning, not a rank. Any of the three can be Verified, Checked or Epic Trusted.">
        {TYPES.map((t) => {
          const on = kind === t.key;
          return (
            <Press key={t.key} onPress={() => setKind(t.key)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.choice, on && styles.choiceOn]}>
              <View style={{ flex: 1 }}><Text style={type.h3}>{TYPE_LABEL[t.key]}</Text><Text style={type.small}>{t.body}</Text></View>
              {on ? <Icon name="check" size={18} color={colors.ink} strokeWidth={2.4} /> : null}
            </Press>
          );
        })}
        {kind === 'local' ? (
          <View style={{ gap: spacing.sm, paddingLeft: spacing.md, borderLeftWidth: BORDER, borderLeftColor: colors.line }}>
            {LOCALS.map((l) => {
              const on = localKind === l.key;
              return (
                <Press key={l.key} onPress={() => setLocalKind(l.key)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.choice, on && styles.choiceOn]}>
                  <View style={{ flex: 1 }}><Text style={type.h3}>{LOCAL_LABEL[l.key]}</Text><Text style={type.small}>{l.body}</Text></View>
                  {on ? <Icon name="check" size={18} color={colors.ink} strokeWidth={2.4} /> : null}
                </Press>
              );
            })}
          </View>
        ) : null}
      </Field>
      <Field label="Date of birth" hint="Hosts on Epic are eighteen or over. Never shown to guests.">
        <TextInput value={dob} onChangeText={setDob} placeholder="YYYY-MM-DD" placeholderTextColor={colors.inkFaint} keyboardType="numbers-and-punctuation" style={[styles.input, { width: 180 }]} />
      </Field>
      {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
      <Button label="Start with the video" icon="video" loading={busy} onPress={() => void next()} />
      <Text style={[type.tiny, { textAlign: 'center' }]}>Four steps · profile, video, credentials, payout</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// 2 · your video
// ---------------------------------------------------------------------------

function YourVideo({ host, onRecord, onNext }: { host: OwnHost | null; onRecord: () => void; onNext: () => void }) {
  return (
    <View style={{ gap: spacing.lg }}>
      <View>
        <Text style={type.title}>Say hello, in about a minute</Text>
        <Text style={[type.small, { marginTop: 6 }]}>Look at the camera and talk like you would to someone at the door.</Text>
      </View>
      <VideoHero src={host?.introVideo ?? null} poster={host?.photo ?? null} height={220} label={host?.introVideo ? 'Your intro' : null} onEmpty={<Row><Icon name="video" size={22} color={colors.inkMuted} /><Text style={type.small}>Nothing recorded yet</Text></Row>} />
      <Field label="Worth covering">
        {['Who you are and where you are', 'What you will actually do together', 'Why you, and not a guidebook'].map((l) => (
          <Row key={l}><View style={styles.tick}><Icon name="check" size={12} color={colors.selectedFg} strokeWidth={3} /></View><Text style={type.body}>{l}</Text></Row>
        ))}
      </Field>
      <Text style={type.small}>30 to 60 seconds is plenty. Re-record as often as you like — only the one you keep is uploaded.</Text>
      <Button label={host?.introVideo ? 'Record it again' : 'Record your video'} icon="video" onPress={onRecord} />
      <Button label={host?.introVideo ? 'Next · about you' : 'Skip for now · about you'} kind="secondary" icon="forward" onPress={onNext} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// 3 · credentials, and what verified means
// ---------------------------------------------------------------------------

function Credentials({ host, onChanged, error, setError, onNext }: { host: OwnHost; onChanged: () => Promise<void>; error: string | null; setError: (e: string | null) => void; onNext: () => void }) {
  const [intro, setIntro] = useState(host.introText ?? '');
  const [creds, setCreds] = useState<string[]>(host.credentials);
  const [langs, setLangs] = useState<string[]>(host.languages);
  const [kids, setKids] = useState<string>(host.childrenAges.join(', '));
  const [adding, setAdding] = useState<'cred' | 'lang' | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setIntro(host.introText ?? ''); setCreds(host.credentials); setLangs(host.languages); }, [host.id]);

  const save = async (patch: Parameters<typeof api.updateHost>[0]) => {
    try { await api.updateHost(patch); await onChanged(); setError(null); } catch (e: any) { setError(e.message); }
  };
  const addPhoto = async () => {
    const blob = await pickPhotoBlob();
    if (!blob) return;
    setBusy(true);
    try { const m = await api.uploadHostMedia(blob, 'photo'); await save({ photoId: m.id }); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const commitAdd = () => {
    const v = draft.trim();
    if (v) {
      if (adding === 'cred') { const next = [...creds, v]; setCreds(next); void save({ credentials: next }); }
      else { const next = [...langs, v]; setLangs(next); void save({ languages: next }); }
    }
    setDraft(''); setAdding(null);
  };

  return (
    <View style={{ gap: spacing.lg }}>
      <Text style={type.title}>What should people know?</Text>
      <Row style={{ alignItems: 'center' }}>
        <Press onPress={() => void addPhoto()} accessibilityRole="button" accessibilityLabel="Your photograph"><HostFace host={host} size={64} /></Press>
        <View style={{ flex: 1 }}><Text style={type.h3}>{host.photo ? 'Your photograph' : 'Add a photograph'}</Text><Text style={type.small}>{busy ? 'Sending…' : 'The face on every card. Your video is the hero; this is the thumbnail.'}</Text></View>
      </Row>
      <Field label="Your intro">
        <TextInput value={intro} onChangeText={setIntro} onBlur={() => void save({ introText: intro })} multiline placeholder="Windsor born. Fifteen years showing people the town that isn't on the postcards." placeholderTextColor={colors.inkFaint} style={[styles.input, { minHeight: 88, paddingTop: 10 }]} />
      </Field>
      <Field label="Credentials" hint="Each offer carries its own why-you line; these are yours as a person.">
        <Wrap>
          {creds.map((c) => <Tag key={c} label={c} onRemove={() => { const next = creds.filter((x) => x !== c); setCreds(next); void save({ credentials: next }); }} />)}
          {adding === 'cred' ? <TextInput value={draft} onChangeText={setDraft} onBlur={commitAdd} onSubmitEditing={commitAdd} autoFocus placeholder="Blue Badge guide" placeholderTextColor={colors.inkFaint} style={[styles.input, { minHeight: 34, width: 200 }]} /> : <Press onPress={() => setAdding('cred')} accessibilityRole="button" style={styles.addTag}><Text style={[type.small, { color: colors.accent, fontWeight: '700' }]}>+ add</Text></Press>}
        </Wrap>
      </Field>
      <Field label="Languages">
        <Wrap>
          {langs.map((c) => <Tag key={c} label={c} onRemove={() => { const next = langs.filter((x) => x !== c); setLangs(next); void save({ languages: next }); }} />)}
          {adding === 'lang' ? <TextInput value={draft} onChangeText={setDraft} onBlur={commitAdd} onSubmitEditing={commitAdd} autoFocus placeholder="English" placeholderTextColor={colors.inkFaint} style={[styles.input, { minHeight: 34, width: 160 }]} /> : <Press onPress={() => setAdding('lang')} accessibilityRole="button" style={styles.addTag}><Text style={[type.small, { color: colors.accent, fontWeight: '700' }]}>+ add</Text></Press>}
        </Wrap>
      </Field>
      {host.type === 'local' && host.localKind === 'family' ? (
        <Field label="Your children's ages" hint="Shown on your profile: guests see both families. Family hosting is daytime, in public, with both families together.">
          <TextInput value={kids} onChangeText={setKids} onBlur={() => void save({ childrenAges: kids.split(/[^0-9]+/).filter(Boolean).map(Number) })} placeholder="9, 4" placeholderTextColor={colors.inkFaint} style={[styles.input, { width: 160 }]} />
        </Field>
      ) : null}

      <View style={styles.verified}>
        <Text style={type.h3}>What "verified" means</Text>
        <Text style={type.small}>We check your photo ID against your name and your face against your video. If you claim a qualification we ask to see it. Nothing is published until it passes.</Text>
        <Row style={{ flexWrap: 'wrap' }}><TrustBadge trust="verified" /><TrustBadge trust="verified" checks="running" /><View style={styles.newChip}><Text style={styles.newChipText}>NEW ON EPIC</Text></View></Row>
        <Text style={type.tiny}>You can go live before the checks finish — your profile just says "checks running" until they do.</Text>
      </View>

      <Field label="Photo ID" hint="Passport or driving licence. We ask to see it; we never keep a copy here.">
        <Segmented value={host.idDocument ?? 'none'} options={[{ value: 'passport', label: 'Passport' }, { value: 'driving_licence', label: 'Driving licence' }, { value: 'none', label: 'Later' }]} onChange={(v) => void save({ idDocument: v === 'none' ? null : (v as any) })} />
      </Field>
      <Press onPress={() => void save({ insuranceConfirmed: !host.insuranceConfirmed })} accessibilityRole="checkbox" accessibilityState={{ checked: host.insuranceConfirmed }} style={styles.checkRow}>
        <View style={[styles.box, host.insuranceConfirmed && styles.boxOn]}>{host.insuranceConfirmed ? <Icon name="check" size={14} color={colors.selectedFg} strokeWidth={3} /> : null}</View>
        <Text style={[type.small, { flex: 1, color: colors.ink }]}>I hold public liability insurance where what I host warrants it, and will show it when asked.</Text>
      </Press>
      {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
      <Button label="Next · getting paid" icon="forward" onPress={onNext} />
      <Text style={[type.tiny, { textAlign: 'center' }]}>Your address and ID are never shown to guests</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// 4 · getting paid
// ---------------------------------------------------------------------------

function GettingPaid({ host, home, onChanged, onDone }: { host: OwnHost; home: HostHome; onChanged: () => Promise<void>; onDone: () => void }) {
  const [tax, setTax] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  const payments = home.config.payments;
  return (
    <View style={{ gap: spacing.lg }}>
      <View>
        <Text style={type.title}>Epic collects, and pays you out</Text>
        <Text style={[type.small, { marginTop: 6 }]}>Public experiences are always paid through Epic — it is what lets a stranger book you safely. Direct payment stays available on private group trips.</Text>
      </View>
      {[
        { t: 'Guest books', b: 'Card charged when they book, or when the minimum is met' },
        { t: 'It runs', b: 'Money is held until the day after' },
        { t: 'You are paid', b: 'Three working days later, one payment per experience' },
      ].map((s, i) => (
        <Row key={i} style={{ alignItems: 'flex-start' }}>
          <View style={styles.dot} />
          <View style={{ flex: 1 }}><Text style={type.h3}>{s.t}</Text><Text style={type.small}>{s.b}</Text></View>
        </Row>
      ))}
      <View style={styles.stripe}>
        <Row><Icon name="payout" size={18} color={colors.ink} /><Text style={type.h3}>{payments.ready ? 'Connect with Stripe' : 'Payouts are not switched on yet'}</Text></Row>
        <Text style={type.small}>{payments.ready ? 'Bank details go to Stripe, not to us. Two minutes.' : `${payments.note} Until it is, you can publish free offers and everything else here; a priced one waits for payouts.`}</Text>
        {payments.ready ? <Button label="Connect with Stripe" kind="secondary" onPress={async () => { try { await api.updateHost({ payoutStatus: 'connected' }); await onChanged(); } catch (e: any) { setSaid(e.message); } }} /> : null}
        <Text style={type.tiny}>Epic's fee TBC · shown before you publish</Text>
      </View>
      <Field label="Tax details" hint="We report host earnings to HMRC, so we need your NI number or UTR before your first payout. Shown back only as its last digits.">
        <Row>
          <TextInput value={tax} onChangeText={setTax} placeholder={host.taxReference ? `Held · ${host.taxReference}` : 'QQ 12 34 56 C, or a 10-digit UTR'} placeholderTextColor={colors.inkFaint} autoCapitalize="characters" style={[styles.input, { flex: 1 }]} />
          <Button label="Save" kind="secondary" disabled={!tax.trim()} onPress={async () => { try { await api.updateHost({ taxReference: tax.trim() }); setTax(''); await onChanged(); setSaid('Saved.'); } catch (e: any) { setSaid(e.message); } }} />
        </Row>
      </Field>
      {said ? <StatusLine>{said}</StatusLine> : null}
      <Button label="Finish · see my profile" icon="check" onPress={onDone} />
      <Text style={[type.tiny, { textAlign: 'center' }]}>You can add payout details later — you just cannot charge until you do</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <View style={{ gap: spacing.sm }}><Text style={styles.fieldLabel}>{label}</Text>{children}{hint ? <Text style={type.tiny}>{hint}</Text> : null}</View>;
}
function Tag({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <View style={styles.tag}>
      <Text style={styles.tagText}>{label}</Text>
      <Press onPress={onRemove} accessibilityRole="button" accessibilityLabel={`Remove ${label}`} hitSlop={8}><Icon name="close" size={12} color={colors.ink} /></Press>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingTop: (Platform.OS === 'web' ? 'max(16px, calc(var(--epic-sat) + 10px))' : 16) as any, paddingBottom: 60, gap: spacing.md },
  wide: { maxWidth: 720, alignSelf: 'center', width: '100%' },
  progress: { flexDirection: 'row', gap: 4, marginBottom: spacing.sm },
  bar: { flex: 1, height: 4, backgroundColor: colors.lineSoft },
  barOn: { backgroundColor: colors.selected },
  num: { width: 28, height: 28, backgroundColor: colors.selected, alignItems: 'center', justifyContent: 'center' },
  numText: { fontFamily: fonts.heading, fontSize: 14, fontWeight: '800', color: colors.selectedFg },
  fieldLabel: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.ink },
  input: { minHeight: TARGET, paddingHorizontal: spacing.md, borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface, fontSize: 15, color: colors.ink, fontFamily: fonts.body },
  choice: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderWidth: BORDER, borderColor: colors.ruleSoft, backgroundColor: colors.surface },
  choiceOn: { borderColor: colors.ink, backgroundColor: colors.surfaceMuted },
  tick: { width: 20, height: 20, backgroundColor: colors.selected, alignItems: 'center', justifyContent: 'center' },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.warm, paddingHorizontal: 10, height: 32 },
  tagText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.ink },
  addTag: { height: 32, justifyContent: 'center', paddingHorizontal: 6 },
  verified: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surfaceMuted },
  newChip: { height: 20, paddingHorizontal: 7, justifyContent: 'center', borderWidth: 1, borderColor: colors.ink },
  newChipText: { fontFamily: fonts.body, fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: colors.ink },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  box: { width: 22, height: 22, borderWidth: BORDER, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  boxOn: { backgroundColor: colors.selected },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.ink, marginTop: 5 },
  stripe: { padding: spacing.md, gap: spacing.sm, borderWidth: BORDER, borderColor: colors.line },
});
