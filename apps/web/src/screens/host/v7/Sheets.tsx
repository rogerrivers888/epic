/**
 * The publish checklist's sheets (hosting v7): Host profile, Phone, Payouts,
 * Tax details, Checked, Verify your identity, How charges work — and the offer
 * video, which lives in VideoSheet.tsx. Each is a kit `Overlay` drawn in the
 * tree, with a 48px ink bar at its foot.
 *
 * RULINGS.md over the prototype: Epic never collects bank details (Payouts
 * hands over to Stripe Connect's hosted onboarding, no sort code or account
 * number here); the host's date of birth is always asked, 18+, on the 3-step
 * picker; tax details are one box, NI number or UTR; the public share is
 * earned by rating, not by a count of events, and there is no Premium plan.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { Press } from '../../../components/press';
import { Icon, type IconName } from '../../../components/Icon';
import { showToast } from '../../../components/Toast';
import { BirthdayPicker } from '../../../components/BirthdayPicker';
import { pickPhotoBlob } from '../../../components/pickPhoto';
import { api } from '../../../api';
import { CREAM, INACTIVE, INK, INK_MUTED, LIME_TINT } from '../../../theme';
import { ActionBar, Field, Kicker, Labelled, Overlay, goToStripe, hx, pointer, tx, v } from './kit';
import { gbp, type LaneHome, type LaneOffer } from './model';
import { VideoSheet, pickFiles } from './VideoSheet';
import { CardBox, confirmWithCard, finishWithBank, loadStripe } from '../../guest/pay';

export type SheetKind = 'profile' | 'phone' | 'payouts' | 'tax' | 'checked' | 'video' | 'verify' | 'charges' | 'fee_card';
export const SHEET_KINDS: SheetKind[] = ['profile', 'phone', 'payouts', 'tax', 'checked', 'video', 'verify', 'charges', 'fee_card'];

type SheetProps = { offer: LaneOffer; home: LaneHome; onClose: () => void; onChanged: (next?: LaneOffer) => Promise<void> | void };

/** The sheet the address names (`?sheet=`), or nothing. */
export function PublishSheet({ kind, ...props }: SheetProps & { kind: string | null }) {
  switch (kind) {
    case 'profile': return <ProfileSheet {...props} />;
    case 'phone': return <PhoneSheet {...props} />;
    case 'payouts': return <PayoutsSheet {...props} />;
    case 'fee_card': return <FeeCardSheet {...props} />;
    case 'tax': return <TaxSheet {...props} />;
    case 'checked': return <CheckedSheet {...props} />;
    case 'video': return <VideoSheet {...props} />;
    case 'verify': return <VerifySheet {...props} />;
    case 'charges': return <ChargesSheet {...props} />;
    default: return null;
  }
}

/** Run a save: busy while it goes, the server's plain words as a toast if it fails. */
function useSave() {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e: any) { showToast(e?.message ?? 'That didn’t save. Try again.'); } finally { setBusy(false); }
  };
  return { busy, run };
}

/** The prototype's note: warm grey, 12.5 grey text. */
const GreyNote = ({ children }: { children: React.ReactNode }) => (
  <View style={s.greyNote}><Text style={tx(12.5, '400', INK_MUTED, { lineHeight: 18 })}>{children}</Text></View>
);

// ---------------------------------------------------------------------------
// Host profile
// ---------------------------------------------------------------------------

function ProfileSheet({ home, onClose, onChanged }: SheetProps) {
  const h = home.host;
  const [name, setName] = useState(h.name ?? '');
  const [line, setLine] = useState(h.line ?? '');
  const [photoId, setPhotoId] = useState<string | null>(h.photoId ?? null);
  const [photo, setPhoto] = useState<string | null>(h.photo ?? null);
  const [dob, setDob] = useState<string | null>(h.dateOfBirth ?? null);
  const [uploading, setUploading] = useState(false);
  const { busy, run } = useSave();

  const takePhoto = async () => {
    const blob = await pickPhotoBlob();
    if (!blob) return;
    setUploading(true);
    try {
      const m = await api.uploadHostMedia(blob, 'photo', null, 'listing');
      setPhotoId(m.id);
      setPhoto(Platform.OS === 'web' ? URL.createObjectURL(blob) : m.url);
    } catch (e: any) { showToast(e.message); } finally { setUploading(false); }
  };

  const ok = Boolean(name.trim() && photoId && line.trim() && dob);
  const save = () => run(async () => {
    await api.laneProfile({ name: name.trim(), line: line.trim() || null, photoId, dateOfBirth: dob ?? undefined });
    await onChanged();
    onClose();
  });

  return (
    <Overlay title="Your host profile" onClose={onClose} footer={<ActionBar label="Save" onPress={() => { void save(); }} disabled={!ok || uploading} busy={busy} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <View style={s.face}>
          {photo ? <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <Text style={tx(12, '400', INK_MUTED)}>{uploading ? 'Adding…' : 'No photo'}</Text>}
        </View>
        <View style={{ flex: 1, gap: 8 }}>
          <Press onPress={() => { void takePhoto(); }} disabled={uploading} accessibilityRole="button" style={[s.photoBtn, { backgroundColor: INK }, pointer]}>
            <Text style={tx(14, '700', CREAM)}>Take a photo</Text>
          </Press>
          <Press onPress={() => { void takePhoto(); }} disabled={uploading} accessibilityRole="button" style={[s.photoBtn, { backgroundColor: INACTIVE }, pointer]}>
            <Text style={tx(14, '700')}>Choose from photos</Text>
          </Press>
        </View>
      </View>
      <Text style={tx(12.5, '400', INK_MUTED)}>A clear photo of your face · guests see it before they book</Text>
      <Labelled label="Name"><Field value={name} onChange={setName} placeholder="Your name" /></Labelled>
      <Labelled label="A line about you"><Field value={line} onChange={setLine} placeholder="A line about you" maxLength={140} /></Labelled>
      <BirthdayPicker value={dob} onChange={setDob} minAge={home.config.hostMinAge} clearable={false} />
    </Overlay>
  );
}

// ---------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------

function PhoneSheet({ home, onClose, onChanged }: SheetProps) {
  const [mobile, setMobile] = useState(home.host.mobile ?? '');
  const { busy, run } = useSave();
  const ok = mobile.replace(/\D/g, '').length >= 10;
  const save = () => run(async () => { await api.laneProfile({ mobile: mobile.trim() }); await onChanged(); onClose(); });
  return (
    <Overlay title="Phone" onClose={onClose} footer={<ActionBar label="Save" onPress={() => { void save(); }} disabled={!ok} busy={busy} />}>
      <Labelled label="Mobile"><Field value={mobile} onChange={setMobile} placeholder="07700 900 000" keyboard="phone-pad" autoFocus /></Labelled>
    </Overlay>
  );
}

// ---------------------------------------------------------------------------
// Payouts — Stripe Connect's hosted onboarding; Epic never sees bank details
// ---------------------------------------------------------------------------

function PayoutsSheet({ offer, home, onClose }: SheetProps) {
  const pending = home.host.payouts === 'pending';
  const { busy, run } = useSave();
  const go = () => run(async () => { const r = await api.lanePayouts(offer.id); goToStripe(r.url); });
  return (
    <Overlay title="Payouts" onClose={onClose} footer={<ActionBar label={pending ? 'Carry on with Stripe' : 'Continue to Stripe'} onPress={() => { void go(); }} busy={busy} />}>
      <Text style={tx(15, '700')}>{pending ? 'Stripe is finishing it' : 'Paid out by Stripe'}</Text>
      <GreyNote>Stripe asks for your bank details and keeps them. Epic never sees them.</GreyNote>
    </Overlay>
  );
}

// ---------------------------------------------------------------------------
// A card for Epic's fee — pay on the day (register L10). TEMPORARY until Claude Design's sheet: the card field and
// one button. A member's membership card is used without asking.
// ---------------------------------------------------------------------------

function FeeCardSheet({ onClose, onChanged }: SheetProps) {
  const stripe = useRef<any>(null);
  const card = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const { busy, run } = useSave();
  useEffect(() => { void loadStripe().then((s) => { stripe.current = s; setReady(Boolean(s)); }); }, []);
  const save = () => run(async () => {
    const r = await api.laneFeeCard();
    if (!r.saved) {
      if (!stripe.current || !card.current || !r.clientSecret) { showToast('Add your card'); return; }
      let out = await confirmWithCard(stripe.current, r.clientSecret, card.current);
      if (out.state === 'bank') out = await finishWithBank(stripe.current, r.clientSecret);
      if (out.state !== 'paid') { showToast(out.state === 'declined' || out.state === 'failed' ? out.message : 'Approve it in your banking app, then save again'); return; }
      await api.laneFeeCardSaved();
    }
    await onChanged();
    onClose();
  });
  return (
    <Overlay title="A card for Epic’s fee" onClose={onClose} footer={<ActionBar label="Save card" onPress={() => { void save(); }} busy={busy} />}>
      <Text style={tx(15, '700')}>Guests pay you on the day</Text>
      <GreyNote>Epic’s fee goes on this card: up front on who says they’re coming, and topped up after if more came.</GreyNote>
      {ready ? <CardBox stripe={stripe.current} onReady={(c) => { card.current = c; }} /> : null}
    </Overlay>
  );
}

// ---------------------------------------------------------------------------
// Tax details
// ---------------------------------------------------------------------------

function TaxSheet({ home, onClose, onChanged }: SheetProps) {
  const [ref, setRef] = useState('');
  const { busy, run } = useSave();
  const ok = ref.replace(/\s/g, '').length >= 9;
  const save = () => run(async () => { await api.laneTax(ref.trim()); await onChanged(); onClose(); });
  return (
    <Overlay title="Tax details" onClose={onClose} footer={<ActionBar label="Save" onPress={() => { void save(); }} disabled={!ok} busy={busy} />}>
      <Labelled label="National Insurance number or UTR">
        <Field value={ref} onChange={(t) => setRef(t.toUpperCase())} placeholder={home.host.tax ? 'Added · type to replace it' : 'QQ 12 34 56 C'} maxLength={16} autoFocus />
      </Labelled>
      <GreyNote>Needed before your first payout</GreyNote>
    </Overlay>
  );
}

// ---------------------------------------------------------------------------
// Checked — DBS, insurance, two references
// ---------------------------------------------------------------------------

function CheckedSheet({ home, onClose, onChanged }: SheetProps) {
  const h = home.host;
  const [dbs, setDbs] = useState(h.dbs ?? '');
  const [insurance, setInsurance] = useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [refs, setRefs] = useState<{ name: string; email: string }[]>(() => {
    const r = h.referees ?? [];
    return [r[0] ?? { name: '', email: '' }, r[1] ?? { name: '', email: '' }];
  });
  const { busy, run } = useSave();
  const setRef = (i: number, k: 'name' | 'email', val: string) => setRefs((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: val } : r)));

  const pickInsurance = async () => {
    const [file] = await pickFiles('application/pdf,image/*');
    if (!file) return;
    setUploading(true);
    try {
      const m = await api.uploadHostMedia(file, file.type === 'application/pdf' ? 'doc' : 'photo', null, 'evidence');
      setInsurance({ id: m.id, name: file.name });
    } catch (e: any) { showToast(e.message); } finally { setUploading(false); }
  };

  // A certificate already sent stands unless a new one is chosen (Codex, 2 Oct 2026).
  const onFile = Boolean(h.insurance);
  const ok = dbs.length === 12 && (Boolean(insurance) || onFile) && refs.every((r) => r.name.trim() && /.+@.+\..+/.test(r.email.trim()));
  const save = () => run(async () => {
    await api.laneChecked({ dbsNumber: dbs, insuranceMediaId: insurance?.id ?? null, referees: refs.map((r) => ({ name: r.name.trim(), email: r.email.trim() })) });
    await onChanged();
    onClose();
  });

  return (
    <Overlay title="Checked" onClose={onClose} footer={<ActionBar label="Send for checking" onPress={() => { void save(); }} disabled={!ok || uploading} busy={busy} />}>
      <Labelled label="DBS certificate number">
        <Field value={dbs} onChange={(t) => setDbs(t.replace(/\D/g, '').slice(0, 12))} placeholder="001234567890" keyboard="numeric" maxLength={12} />
      </Labelled>
      <Labelled label="Insurance">
        <Press onPress={() => { void pickInsurance(); }} disabled={uploading} accessibilityRole="button" accessibilityLabel="Upload your certificate"
          style={[v.box, { gap: 10 }, pointer]}>
          <Icon name={insurance || onFile ? 'check' : 'upload'} size={18} color={INK} strokeWidth={2.2} />
          <Text style={[v.boxText, { flex: 1 }, !insurance && !onFile && { color: INK_MUTED }]} numberOfLines={1}>
            {uploading ? 'Adding…' : insurance ? insurance.name : onFile ? 'Certificate sent · tap to replace' : 'Upload your certificate'}
          </Text>
        </Press>
      </Labelled>
      <Labelled label="Two references">
        <View style={{ gap: 6 }}>
          {refs.map((r, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 6 }}>
              <Field value={r.name} onChange={(t) => setRef(i, 'name', t)} placeholder="Name" style={{ flex: 1 }} />
              <Field value={r.email} onChange={(t) => setRef(i, 'email', t)} placeholder="Email" keyboard="email-address" style={{ flex: 1.3 }} />
            </View>
          ))}
        </View>
      </Labelled>
      <GreyNote>Because it’s for children</GreyNote>
    </Overlay>
  );
}

// ---------------------------------------------------------------------------
// Verify your identity (N1-F3) — Stripe Identity
// ---------------------------------------------------------------------------

function VerifySheet({ offer, home, onClose, onChanged }: SheetProps) {
  // The words follow what the check will take: a passport, or a UK licence too while the owner's setting allows it.
  const licence = (home.config.identityDocuments ?? ['passport']).includes('driving_licence');
  const doc = licence ? 'passport or UK driving licence' : 'passport';
  const { busy, run } = useSave();
  // TEMPORARY (3 Oct 2026): the consent tick below is a stand-in built from this sheet's own parts until Claude Design
  // draws the biometric consent screen. The rule it carries is not temporary: no check starts without the yes (L7).
  const [agreed, setAgreed] = useState(false);
  const go = () => run(async () => {
    const r = await api.laneVerify(offer.id, agreed);
    if (r.url) { goToStripe(r.url); return; }
    if (r.processing) showToast('Stripe is checking it. We’ll tick it off when it’s done.');
    await onChanged();
    onClose();
  });
  const row = (icon: IconName, t: string, sub: string) => (
    <View style={[v.row, { paddingVertical: 12 }]}>
      <View style={s.iconTile}><Icon name={icon} size={20} color={INK} strokeWidth={2} /></View>
      <View style={{ flex: 1 }}>
        <Text style={tx(15, '700')}>{t}</Text>
        <Text style={tx(12.5, '400', INK_MUTED)}>{sub}</Text>
      </View>
    </View>
  );
  return (
    <Overlay full title="Verify your identity" onClose={onClose} footer={<ActionBar label="Continue to Stripe" onPress={() => { void go(); }} disabled={!agreed} busy={busy} />}>
      <Text style={tx(13, '400', INK_MUTED, { marginTop: -4 })}>Once, for every host</Text>
      <View style={v.list}>
        {row('identity', licence ? 'Your passport or UK driving licence' : 'Your passport', licence ? 'The photo page, or the front of the card' : 'The photo page')}
        {row('face', 'A quick selfie', 'To match your face to the photo')}
      </View>
      <Text style={tx(13, '400', INK_MUTED, { lineHeight: 18 })}>{`Checked by Stripe. Epic sees the result, never your ${doc}.`}</Text>
      {/* TEMPORARY: stand-in consent row until the designed screen. */}
      <Press onPress={() => setAgreed((a) => !a)} accessibilityRole="checkbox" accessibilityState={{ checked: agreed }}
        accessibilityLabel={`I agree to Stripe matching my selfie to the photo on my ${doc}`} style={[v.box, { gap: 10 }, pointer]}>
        <Icon name={agreed ? 'check' : 'face'} size={18} color={INK} strokeWidth={2.2} />
        <Text style={[v.boxText, { flex: 1 }]}>{`I agree to Stripe using my selfie and the photo on my ${doc} to check it’s me (biometric data)`}</Text>
      </Press>
      <Text style={tx(12.5, '700')}>About 2 minutes</Text>
    </Overlay>
  );
}

// ---------------------------------------------------------------------------
// How charges work (N1-F1, with RULINGS' rating-based share)
// ---------------------------------------------------------------------------

function ChargesSheet({ offer, home, onClose }: SheetProps) {
  const cfg = home.config;
  const rungs = cfg.publicShare;
  const current = offer.charges.kind === 'public_paid' ? Math.max(0, rungs.findIndex((r) => r.pct === offer.charges.sharePct)) : 0;
  const rungWords = (r: (typeof rungs)[number]) => (r.ratedEvents ? `After ${r.ratedEvents} rated events averaging ${r.avgAtLeast}+` : 'To start');
  return (
    <Overlay full title="Hosting charges" onClose={onClose}>
      <Kicker>Private</Kicker>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        <View style={[s.tile, { backgroundColor: INACTIVE }]}>
          <Text style={hx(26, -0.02, 1.15)}>{gbp(cfg.privateEventPence)}</Text>
          <Text style={tx(13, '700')}>Per event</Text>
        </View>
        <View style={[s.tile, { backgroundColor: LIME_TINT }]}>
          <Text style={hx(26, -0.02, 1.15)}>{gbp(cfg.proMonthlyPence)}<Text style={tx(14, '700')}> a month</Text></Text>
          <Text style={tx(13, '700')}>Included in Pro</Text>
        </View>
      </View>
      <Text style={tx(13, '400', INK_MUTED, { lineHeight: 18 })}>If guests pay through Epic: {cfg.privateCollectPct}% of what you collect, card fees included.</Text>
      <Kicker style={{ marginTop: 8 }}>Public · Epic’s share of each booking</Kicker>
      {rungs.map((r, i) => (
        <View key={r.pct} style={[s.rung, { backgroundColor: i === current ? LIME_TINT : INACTIVE }]}>
          <Text style={[hx(26, -0.02, 1.15), { width: 64 }]}>{r.pct}%</Text>
          <View style={{ flex: 1 }}>
            <Text style={tx(14.5, '700')}>{rungWords(r)}</Text>
            {i === current && offer.charges.kind === 'public_paid' ? <Text style={tx(12, '400', INK_MUTED)}>You’re here</Text> : null}
          </View>
        </View>
      ))}
      <Text style={tx(12.5, '400', INK_MUTED)}>Card fees included · free public events cost nothing</Text>
    </Overlay>
  );
}

const s = StyleSheet.create({
  greyNote: { flexDirection: 'row', gap: 10, padding: 12, backgroundColor: INACTIVE },
  face: { width: 88, height: 88, borderRadius: 999, backgroundColor: INACTIVE, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  photoBtn: { height: 40, alignItems: 'center', justifyContent: 'center' },
  iconTile: { width: 36, height: 36, backgroundColor: INACTIVE, alignItems: 'center', justifyContent: 'center' },
  tile: { flex: 1, padding: 12 },
  rung: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
});
