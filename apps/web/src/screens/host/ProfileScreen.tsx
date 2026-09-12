/**
 * You, as a host: one page, every setting (Host Journey S1 · S2 · S3; Hosts
 * and Events H3 · H4). Name and town, a particular address if it helps, date
 * of birth, the kind of host you are, your photograph and intro video, what
 * backs you up, photo ID, insurance, payouts and tax.
 *
 * The set-up asks these one at a time inside a public offer; this is where
 * they are changed afterwards, and where a host who only ever hosts
 * privately never has to come.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import { api, HostHome, HostType, LocalKind, OwnHost, Place } from '../../api';
import { colors, fonts, spacing, TARGET, type, BORDER } from '../../theme';
import { Button, Row, Segmented, StatusLine, Wrap } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { PlacePicker } from '../../components/PlacePicker';
import { BirthdayPicker } from '../../components/BirthdayPicker';
import { useViewport } from '../../hooks/useViewport';
import { useRouter } from '../../router';
import { paths } from '../../routes';
import { pickPhotoBlob } from '../../components/pickPhoto';
import { HostFace, LOCAL_LABEL, TYPE_LABEL, TrustBadge, VideoHero } from '../../components/hosting';

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

/** The kind chooser: one tick at the parent level, one at the child. Sub-kinds are children of Meetups, on its tinted ground. */
export function KindChooser({ kind, sub, onKind, onSub }: { kind: HostType | null; sub: LocalKind | null; onKind: (k: HostType) => void; onSub: (s: LocalKind) => void }) {
  return (
    <View style={{ gap: spacing.sm }}>
      {KIND_ROWS.map((k) => {
        const on = kind === k.key;
        const collapsed = Boolean(kind) && !on && kind === 'meetups' && sub;
        return (
          <Press key={k.key} onPress={() => onKind(k.key)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.choice, on && styles.choiceOn]}>
            <Row style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={type.h3}>{k.title}</Text>
                {!collapsed ? <Text style={type.small}>{k.body}</Text> : null}
              </View>
              {on ? <View style={styles.tick}><Icon name="check" size={14} color={colors.selectedFg} strokeWidth={3} /></View> : null}
            </Row>
            {on && k.foot ? <View style={styles.foot}><Text style={[type.tiny, { color: colors.ink }]}>{k.foot}</Text></View> : null}
            {on && k.key === 'meetups' ? (
              <View style={styles.subs}>
                <Text style={type.tiny}>What are you taking them to?</Text>
                {SUB_ROWS.map((s) => {
                  const son = sub === s.key;
                  return (
                    <Press key={s.key} onPress={() => onSub(s.key)} accessibilityRole="button" accessibilityState={{ selected: son }} style={[styles.sub, son && styles.subOn]}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={[type.h3, son && { color: colors.selectedFg }]}>{s.title}</Text>
                        {son || !sub ? <Text style={[type.tiny, son && { color: colors.selectedFg }]}>{s.body}</Text> : null}
                      </View>
                      {son ? <Icon name="check" size={16} color={colors.selectedFg} strokeWidth={3} /> : null}
                    </Press>
                  );
                })}
              </View>
            ) : null}
          </Press>
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
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView ref={scroller} contentContainerStyle={[styles.scroll, wide && styles.wide]} keyboardShouldPersistTaps="handled">
        <Row style={{ justifyContent: 'space-between' }}>
          <Press onPress={() => back(paths.host())} accessibilityRole="button" hitSlop={8}><Row><Icon name="back" size={18} /><Text style={type.h3}>Host on Epic</Text></Row></Press>
          {h ? <TrustBadge trust={h.trust} checks={h.checks} /> : null}
        </Row>
        <Text style={styles.title}>You, as a host</Text>
        <Text style={type.small}>Everything here saves as you go. Only a public offer needs any of it; a private one needs your name and nothing else.</Text>

        <Row style={{ alignItems: 'center', marginTop: spacing.sm }}>
          <Press onPress={() => void addPhoto()} accessibilityRole="button" accessibilityLabel="Your photograph"><HostFace host={{ name: name || 'You', photo: h?.photo ?? null }} size={64} /></Press>
          <View style={{ flex: 1 }}><Text style={type.h3}>{h?.photo ? 'Your photograph' : 'Add a photograph'}</Text><Text style={type.small}>{busy ? 'Sending…' : 'The face on every card.'}</Text></View>
        </Row>

        <Field label="Your name, as they will see it">
          <TextInput value={name} onChangeText={setName} onBlur={() => void save({ name: name.trim() })} placeholder="Jay Alderton" placeholderTextColor={colors.inkFaint} style={styles.input} />
        </Field>
        <Field label="Where you host">
          <PlacePicker value={place} onPick={(p) => { setPlace(p); if (p) void save({ locationLabel: p.locality ?? p.label, lat: p.lat, lng: p.lng, countryCode: p.countryCode ?? null }); }} kind="area" placeholder="Reading" />
          {showAddr ? (
            <TextInput value={address} onChangeText={setAddress} onBlur={() => void save({ address: address.trim() || null })} placeholder="Street and number, or the park gate" placeholderTextColor={colors.inkFaint} style={styles.input} />
          ) : null}
          <Press onPress={() => setShowAddr(!showAddr)} accessibilityRole="button"><Text style={styles.link}>{showAddr ? 'It is just the town' : 'It happens at a particular address ›'}</Text></Press>
        </Field>
        <BirthdayPicker value={h?.dateOfBirth ?? null} onChange={(iso) => void save({ dateOfBirth: iso })} clearable={false} minAge={18} hint="Hosts are eighteen or over. Never shown to guests." />

        <Field label="Which sounds most like you?">
          <KindChooser kind={h?.type ?? null} sub={h?.localKind ?? null} onKind={(k) => void save({ type: k, localKind: k === 'meetups' ? h?.localKind ?? null : null })} onSub={(s) => void save({ type: 'meetups', localKind: s })} />
        </Field>

        <Field label="A minute of you talking" hint="Your intro. Each public offer then gets a short one of its own.">
          <VideoHero src={h?.introVideo ?? null} poster={h?.photo ?? null} height={200} label={h?.introVideo ? 'Your intro' : null} onEmpty={<Row><Icon name="video" size={20} color={colors.inkMuted} /><Text style={type.small}>Nothing recorded yet</Text></Row>} />
          <Button label={h?.introVideo ? 'Record it again' : 'Record your intro'} kind="secondary" icon="video" onPress={() => navigate(paths.hostVideo())} />
        </Field>
        <Field label="Your intro, in words">
          <TextInput value={intro} onChangeText={setIntro} onBlur={() => void save({ introText: intro })} multiline placeholder="Windsor born. Fifteen years showing people the town that isn't on the postcards." placeholderTextColor={colors.inkFaint} style={[styles.input, { minHeight: 88, paddingTop: 10 }]} />
        </Field>
        <Field label="What you can point to" hint="Each offer says why you for that one; these are yours as a person.">
          <Wrap>
            {creds.map((c) => (
              <View key={c} style={styles.tag}><Text style={styles.tagText}>{c}</Text><Press onPress={() => { const next = creds.filter((x) => x !== c); setCreds(next); void save({ credentials: next }); }} accessibilityRole="button" hitSlop={8}><Icon name="close" size={12} color={colors.ink} /></Press></View>
            ))}
            <TextInput value={draft} onChangeText={setDraft} onBlur={() => { const v = draft.trim(); if (v) { const next = [...creds, v]; setCreds(next); void save({ credentials: next }); } setDraft(''); }} placeholder="+ add one" placeholderTextColor={colors.inkFaint} style={[styles.input, { minHeight: 32, width: 160 }]} />
          </Wrap>
        </Field>

        <Field label="Photo ID" hint="Passport or driving licence. We ask to see it; we never keep a copy here.">
          <Segmented value={h?.idDocument ?? 'none'} options={[{ value: 'passport', label: 'Passport' }, { value: 'driving_licence', label: 'Driving licence' }, { value: 'none', label: 'Later' }]} onChange={(v) => void save({ idDocument: v === 'none' ? null : (v as any) })} />
        </Field>
        <Press onPress={() => void save({ insuranceConfirmed: !h?.insuranceConfirmed })} accessibilityRole="checkbox" accessibilityState={{ checked: Boolean(h?.insuranceConfirmed) }} style={styles.checkRow}>
          <View style={[styles.box, h?.insuranceConfirmed && styles.boxOn]}>{h?.insuranceConfirmed ? <Icon name="check" size={14} color={colors.selectedFg} strokeWidth={3} /> : null}</View>
          <Text style={[type.small, { flex: 1, color: colors.ink }]}>I hold public liability insurance where what I host warrants it, and will show it when asked.</Text>
        </Press>

        <View style={styles.pay}>
          <Row><Icon name="payout" size={18} color={colors.ink} /><Text style={type.h3}>Getting paid</Text></Row>
          <Text style={type.small}>Public things are paid through Epic — charged when they book, held until the day after, paid to you three working days later. {home.config.payments.ready ? 'Bank details go to Stripe, not to us.' : home.config.payments.note}</Text>
          {home.config.payments.ready ? <Button label={h?.payoutStatus === 'connected' ? 'Connected with Stripe' : 'Connect with Stripe'} kind="secondary" disabled={h?.payoutStatus === 'connected'} onPress={() => void save({ payoutStatus: 'connected' })} /> : null}
          <Field label="Tax details" hint="We report host earnings to HMRC, so we need your NI number or UTR before your first payout.">
            <Row>
              <TextInput value={tax} onChangeText={setTax} placeholder={h?.taxReference ? `Held · ${h.taxReference}` : 'QQ 12 34 56 C, or a 10-digit UTR'} placeholderTextColor={colors.inkFaint} autoCapitalize="characters" style={[styles.input, { flex: 1 }]} />
              <Button label="Save" kind="secondary" disabled={!tax.trim()} onPress={async () => { await save({ taxReference: tax.trim() }); setTax(''); }} />
            </Row>
          </Field>
        </View>
        {said ? <StatusLine tone="warn">{said}</StatusLine> : null}
        {h ? <Press onPress={() => navigate(paths.hostProfile(h.id))} accessibilityRole="button" style={{ paddingVertical: 10 }}><Text style={[styles.link, { textAlign: 'center' }]}>See your profile as a guest ›</Text></Press> : null}
      </ScrollView>
    </View>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <View style={{ gap: spacing.sm, marginTop: spacing.sm }}><Text style={styles.fieldLabel}>{label}</Text>{children}{hint ? <Text style={type.tiny}>{hint}</Text> : null}</View>;
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingTop: (Platform.OS === 'web' ? 'max(16px, calc(var(--epic-sat) + 10px))' : 16) as any, paddingBottom: 60, gap: spacing.sm },
  wide: { maxWidth: 720, alignSelf: 'center', width: '100%' },
  title: { fontFamily: fonts.heading, fontSize: 27, fontWeight: '800', letterSpacing: -0.95, lineHeight: 31, color: colors.ink },
  fieldLabel: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.ink },
  input: { minHeight: TARGET, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface, fontSize: 16, color: colors.ink, fontFamily: fonts.body },
  link: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.accent },
  choice: { padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface },
  choiceOn: { borderWidth: BORDER, borderColor: colors.ink, backgroundColor: colors.surfaceMuted },
  tick: { width: 24, height: 24, backgroundColor: colors.selected, alignItems: 'center', justifyContent: 'center' },
  foot: { backgroundColor: colors.selected, padding: spacing.sm },
  subs: { gap: 6, paddingLeft: spacing.md, borderLeftWidth: 2, borderLeftColor: colors.ruleSoft },
  sub: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface },
  subOn: { backgroundColor: colors.selected, borderColor: colors.selected },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.warm, paddingHorizontal: 10, height: 32 },
  tagText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.ink },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.sm },
  box: { width: 22, height: 22, borderWidth: BORDER, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  boxOn: { backgroundColor: colors.selected },
  pay: { marginTop: spacing.lg, padding: spacing.md, gap: spacing.sm, borderWidth: BORDER, borderColor: colors.line },
});
