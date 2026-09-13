/**
 * You, as a host: one page, every setting (Host Journey S1 · S2 · S3; Hosts
 * and Events H3 · H4). Name and town, a particular address if it helps, date
 * of birth, the kind of host you are, your photograph and intro video, what
 * backs you up, photo ID, insurance, payouts and tax.
 *
 * The set-up asks these one at a time inside a public offer; this is where
 * they are changed afterwards, and where a host who only ever hosts
 * privately never has to come. Sizes are the canvases', through the kit.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '../../components/press';
import { api, HostHome, HostType, LocalKind, Place } from '../../api';
import { colors, INK } from '../../theme';
import { Button, Segmented, StatusLine } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { BirthdayPicker, birthdayWords } from '../../components/BirthdayPicker';
import { useViewport } from '../../hooks/useViewport';
import { useRouter } from '../../router';
import { paths } from '../../routes';
import { pickPhotoBlob } from '../../components/pickPhoto';
import { HostFace, VideoHero } from '../../components/hosting';
import { CheckBox, Field, Input, Nav, Picker, PlaceField, Tag, Tick, k, t } from '../../components/hostKit';

export const KIND_ROWS: { key: HostType; title: string; body: string; foot?: string }[] = [
  { key: 'skill', title: 'I have a skill', body: 'You teach it or you do it with them — painting, sourdough, climbing, code. They come away having done the thing.' },
  { key: 'meetups', title: 'Meetups and mini tours', body: 'No lesson and no qualification. They join what you are already doing, or you show them round where you live.' },
  { key: 'expert', title: 'Expert guide', body: 'You know a subject deeply — history, architecture, birds, food. It need not be your job; it does need to be real.', foot: 'We ask what backs it up — a qualification, a publication, years of it — and a licence only where the city legally requires one.' },
];
export const SUB_ROWS: { key: LocalKind; title: string; body: string }[] = [
  { key: 'family', title: 'Our family, with yours', body: 'Both families together, in the daytime, in public places — a playground, a beach, a soft play. Your children and ours are there throughout, and we are never alone with your child. Free, almost always.' },
  { key: 'already_do', title: 'Something I already do', body: 'A Saturday run, a swim, a skate, a market. You are not teaching it — they are coming along to what was happening anyway.' },
  { key: 'night_out', title: 'A night out', body: 'Over-18s only. Named venues, a set end time, and never one host with one guest.' },
  { key: 'neighbourhood', title: 'Round where I live', body: 'A walk, a food crawl, the bits of the neighbourhood a map will not tell you.' },
];

/**
 * The kind chooser (prototype `kind`): three cards, 14px padding, a 2px ink rule
 * on the tint when picked, the tick top right. Once one is picked the others
 * fold to their titles. Meetups opens a tinted panel beneath it — "What are you
 * taking them to?" — with the four sub-kinds as rows, the picked one lime.
 */
export function KindChooser({ kind, sub, onKind, onSub }: { kind: HostType | null; sub: LocalKind | null; onKind: (kd: HostType) => void; onSub: (s: LocalKind) => void }) {
  return (
    <View style={{ gap: 9 }}>
      {KIND_ROWS.map((row) => {
        const on = kind === row.key;
        const folded = Boolean(kind) && !on;
        return (
          <View key={row.key}>
            <Press onPress={() => onKind(row.key)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.kind, on && styles.kindOn]}>
              <View style={{ flex: 1 }}>
                <Text style={t.h18}>{row.title}</Text>
                {!folded ? <Text style={[t.sub, { lineHeight: 20, marginTop: 2 }]}>{row.body}</Text> : null}
              </View>
              {on ? <Tick size={24} /> : null}
            </Press>
            {on && row.foot ? <View style={styles.kindFoot}><Text style={[t.small, { color: colors.onLime, lineHeight: 17 }]}>{row.foot}</Text></View> : null}
            {on && row.key === 'meetups' ? (
              <View style={styles.subs}>
                <Text style={[t.tiny, { fontWeight: '700', color: colors.accent, marginBottom: 2 }]}>What are you taking them to?</Text>
                {SUB_ROWS.map((s) => {
                  const son = sub === s.key;
                  return (
                    <Press key={s.key} onPress={() => onSub(s.key)} accessibilityRole="button" accessibilityState={{ selected: son }} style={[styles.sub, son && styles.subOn]}>
                      <Text style={[t.body, { fontSize: 14, fontWeight: '600', lineHeight: 18, flex: 1 }, son && { color: INK }]}>{s.title}</Text>
                      {son ? <Icon name="check" size={14} color={INK} strokeWidth={3} /> : null}
                    </Press>
                  );
                })}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export function ProfileScreen({ home, onChanged }: { home: HostHome; onChanged: () => Promise<void> }) {
  const { width } = useViewport();
  const wide = width >= 900;
  const { navigate, back, query } = useRouter();
  const h = home.host;
  const [name, setName] = useState(h?.name ?? home.you?.name ?? '');
  const [place, setPlace] = useState<Place | null>(h?.location ? { label: h.location, lat: h.lat ?? 0, lng: h.lng ?? 0 } : null);
  const [address, setAddress] = useState(h?.address ?? '');
  const [showAddr, setShowAddr] = useState(Boolean(h?.address));
  const [openDob, setOpenDob] = useState(false);
  const [intro, setIntro] = useState(h?.introText ?? '');
  const [creds, setCreds] = useState<string[]>(h?.credentials ?? []);
  const [draft, setDraft] = useState('');
  const [tax, setTax] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scroller = useRef<ScrollView>(null);
  useEffect(() => { if (query.get('at') === 'payouts') setTimeout(() => scroller.current?.scrollToEnd({ animated: false }), 300); }, []);
  useEffect(() => { if (h) { setName(h.name); setIntro(h.introText ?? ''); setCreds(h.credentials); setAddress(h.address ?? ''); } }, [h?.id]);

  const save = async (patch: Parameters<typeof api.updateHost>[0]) => {
    try {
      if (h) await api.updateHost(patch); else await api.becomeHost({ name: name.trim() || 'A host', ...patch });
      await onChanged(); setSaid(null);
    } catch (e: any) { setSaid(e.message); }
  };
  const addPhoto = async () => {
    const blob = await pickPhotoBlob();
    if (!blob) return;
    setBusy(true);
    try { const m = await api.uploadHostMedia(blob, 'photo'); await save({ photoId: m.id }); } catch (e: any) { setSaid(e.message); } finally { setBusy(false); }
  };

  return (
    <View style={k.page}>
      <View style={[wide && k.wide, { paddingTop: TOP }]}>
        <Nav title="Host on Epic" onBack={() => back(paths.host())} />
      </View>
      <ScrollView ref={scroller} contentContainerStyle={[styles.scroll, wide && k.wide]} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 6 }}>
          <Text style={t.h27}>You, as a host</Text>
          <Text style={t.sub}>Everything here saves as you go. Only a public offer needs any of it; a private one needs your name and nothing else.</Text>
        </View>

        <Press onPress={() => void addPhoto()} accessibilityRole="button" accessibilityLabel="Your photograph" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <HostFace host={{ name: name || 'You', photo: h?.photo ?? null }} size={64} />
          <View style={{ flex: 1 }}><Text style={[t.body, { fontWeight: '700' }]}>{h?.photo ? 'Your photograph' : 'Add a photograph'}</Text><Text style={t.small}>{busy ? 'Sending…' : 'The face on every card.'}</Text></View>
        </Press>

        <Field label="Your name, as they will see it"><Input value={name} onChangeText={setName} onBlur={() => void save({ name: name.trim() })} placeholder="Jay Alderton" /></Field>
        <Field label="Where you host">
          <PlaceField value={place} kind="area" onPick={(p: Place | null) => { setPlace(p); if (p) void save({ locationLabel: p.locality ?? p.label, lat: p.lat, lng: p.lng, countryCode: p.countryCode ?? null }); }} placeholder="Reading" />
          <Press onPress={() => setShowAddr(!showAddr)} accessibilityRole="button"><Text style={t.link}>{showAddr ? 'It is just the town' : 'It happens at a particular address ›'}</Text></Press>
          {showAddr ? <Input value={address} onChangeText={setAddress} onBlur={() => void save({ address: address.trim() || null })} placeholder="Street and number, or the park gate" /> : null}
        </Field>
        <Field label="Date of birth" hint="Hosts are eighteen or over. Never shown to guests.">
          {openDob || !h?.dateOfBirth
            ? <BirthdayPicker value={h?.dateOfBirth ?? null} onChange={(iso) => { void save({ dateOfBirth: iso }); setOpenDob(false); }} clearable={false} minAge={18} label="" />
            : <Picker value={birthdayWords(h.dateOfBirth)} placeholder="Tap to choose" trailing="calendar" onPress={() => setOpenDob(true)} />}
        </Field>

        <Field label="Which sounds most like you?" gap={9}>
          <KindChooser kind={h?.type ?? null} sub={h?.localKind ?? null} onKind={(kd) => void save({ type: kd, localKind: kd === 'meetups' ? h?.localKind ?? null : null })} onSub={(s) => void save({ type: 'meetups', localKind: s })} />
        </Field>

        <Field label="A minute of you talking" hint="Your intro. Each public offer then gets a short one of its own." gap={8}>
          <VideoHero src={h?.introVideo ?? null} poster={h?.photo ?? null} height={200} label={h?.introVideo ? 'Your intro' : null} onEmpty={<View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Icon name="video" size={20} color={colors.inkMuted} /><Text style={t.small}>Nothing recorded yet</Text></View>} />
          <Button label={h?.introVideo ? 'Record it again' : 'Record your intro'} kind="secondary" icon="video" onPress={() => navigate(paths.hostVideo())} />
        </Field>
        <Field label="Your intro, in words">
          <Input value={intro} onChangeText={setIntro} onBlur={() => void save({ introText: intro })} multiline placeholder="Windsor born. Fifteen years showing people the town that isn't on the postcards." style={{ fontSize: 15, fontWeight: '400' }} />
        </Field>
        <Field label="What you can point to" hint="Each offer says why you for that one; these are yours as a person." gap={8}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {creds.map((c) => (
              <View key={c} style={styles.cred}><Text style={[t.label, { fontWeight: '600' }]}>{c}</Text><Press onPress={() => { const next = creds.filter((x) => x !== c); setCreds(next); void save({ credentials: next }); }} accessibilityRole="button" accessibilityLabel={`Remove ${c}`} hitSlop={8}><Icon name="close" size={12} color={colors.ink} /></Press></View>
            ))}
            <Input value={draft} onChangeText={setDraft} onBlur={() => { const v = draft.trim(); if (v) { const next = [...creds, v]; setCreds(next); void save({ credentials: next }); } setDraft(''); }} placeholder="+ add one" style={{ minHeight: 36, paddingVertical: 6, width: 160, fontSize: 14 }} />
          </View>
        </Field>

        <Field label="Photo ID" hint="Passport or driving licence. We ask to see it; we never keep a copy here." gap={8}>
          <Segmented value={h?.idDocument ?? 'none'} options={[{ value: 'passport', label: 'Passport' }, { value: 'driving_licence', label: 'Driving licence' }, { value: 'none', label: 'Later' }]} onChange={(v) => void save({ idDocument: v === 'none' ? null : (v as any) })} />
        </Field>
        <Press onPress={() => void save({ insuranceConfirmed: !h?.insuranceConfirmed })} accessibilityRole="checkbox" accessibilityState={{ checked: Boolean(h?.insuranceConfirmed) }} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ marginTop: 1 }}><CheckBox on={Boolean(h?.insuranceConfirmed)} /></View>
          <Text style={[t.small, { flex: 1, color: colors.ink, lineHeight: 18 }]}>I hold public liability insurance where what I host warrants it, and will show it when asked.</Text>
        </Press>

        <View style={styles.pay}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Icon name="payout" size={18} color={colors.ink} /><Text style={t.h16}>Getting paid</Text></View>
          <Text style={[t.small, { lineHeight: 18 }]}>Public things are paid through Epic — charged when they book, held until the day after, paid to you three working days later. {home.config.payments.ready ? 'Bank details go to Stripe, not to us.' : home.config.payments.note}</Text>
          {home.config.payments.ready ? <Button label={h?.payoutStatus === 'connected' ? 'Connected with Stripe' : 'Connect with Stripe'} kind="secondary" disabled={h?.payoutStatus === 'connected'} onPress={() => void save({ payoutStatus: 'connected' })} /> : null}
          <Field label="Tax details" hint="We report host earnings to HMRC, so we need your NI number or UTR before your first payout.">
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Input value={tax} onChangeText={setTax} placeholder={h?.taxReference ? `Held · ${h.taxReference}` : 'QQ 12 34 56 C, or a 10-digit UTR'} autoCapitalize="characters" style={{ flex: 1 }} />
              <Button label="Save" kind="secondary" disabled={!tax.trim()} onPress={async () => { await save({ taxReference: tax.trim() }); setTax(''); }} />
            </View>
          </Field>
        </View>
        {said ? <StatusLine tone="warn">{said}</StatusLine> : null}
        {h ? <Press onPress={() => navigate(paths.hostProfile(h.id))} accessibilityRole="button" style={{ paddingVertical: 10 }}><Text style={[t.link, { fontSize: 13, textAlign: 'center' }]}>See your profile as a guest ›</Text></Press> : null}
        {h ? <View style={{ alignItems: 'center' }}><Tag>{`${h.trust.toUpperCase()}${h.checks === 'running' ? ' · CHECKS RUNNING' : ''}`}</Tag></View> : null}
      </ScrollView>
    </View>
  );
}

const TOP = (Platform.OS === 'web' ? 'max(8px, var(--epic-sat))' : 8) as any;

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 60, gap: 16 },
  kind: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 14, borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface },
  kindOn: { padding: 13, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.surfaceMuted },
  kindFoot: { backgroundColor: colors.lime, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 2, borderTopWidth: 0, borderColor: colors.line },
  subs: { gap: 6, paddingTop: 12, paddingHorizontal: 14, paddingBottom: 14, backgroundColor: colors.surfaceMuted, borderWidth: 2, borderTopWidth: 0, borderColor: colors.line },
  sub: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 11, paddingHorizontal: 13, borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface },
  subOn: { backgroundColor: colors.lime, borderColor: colors.lime },
  cred: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.warm, paddingHorizontal: 10, height: 34 },
  pay: { marginTop: 8, padding: 14, gap: 10, borderWidth: 2, borderColor: colors.line },
});
