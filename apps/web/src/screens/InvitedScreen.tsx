/**
 * An invitation to a private offer (Host Journey, 13 Sep 2026): a wedding, a
 * christening, a stag weekend. No account, no password. The page for the day
 * — the times, where it is, anything they need to know, the document to
 * download — and yes or no, with how many they are bringing.
 *
 * Outside the app, like a group invite: the token is the credential.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '../components/press';
import { api, InvitedView } from '../api';
import { colors, fonts, spacing, TARGET, type, BORDER } from '../theme';
import { Button, Row, StatusLine } from '../components/ui';
import { Icon } from '../components/Icon';
import { Wordmark } from '../components/Wordmark';
import { useViewport } from '../hooks/useViewport';
import { HostFace, Kicker, NumberBox, VENUE_ICON, VideoHero, dayLong, dayShort, durationWords, mediaUrl, money } from '../components/hosting';

export function InvitedScreen({ token }: { token: string }) {
  const { width } = useViewport();
  const wide = width >= 900;
  const [v, setV] = useState<InvitedView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [heads, setHeads] = useState('1');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api.invited(token); setV(r); setHeads(String(r.invite.rsvpHeads ?? r.invite.heads)); setError(null); } catch (e: any) { setError(e.message); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  if (error && !v) return <View style={styles.page}><Wordmark height={30} /><Text style={type.h2}>This invitation does not open anything</Text><Text style={type.small}>{error}</Text></View>;
  if (!v) return <View style={styles.page}><Wordmark height={30} /><Text style={type.small}>Opening…</Text></View>;

  const { invite, offer, going } = v;
  const host = offer.host!;
  const first = host.name.split(' ')[0];
  const when = offer.shape === 'oneoff' ? [offer.startsOn ? dayLong(offer.startsOn) : null, offer.startsAt ? `from ${offer.startsAt}` : null, offer.endsAt ? `until ${offer.endsAt}` : durationWords(offer.durationMin)].filter(Boolean).join(' · ')
    : offer.shape === 'series' ? [offer.firstDate ? `From ${dayShort(offer.firstDate)}` : null, offer.startsAt, offer.dates.length ? `${offer.dates.length} times` : null].filter(Boolean).join(' · ')
      : 'Whenever suits — book a time with them';
  const price = offer.money === 'free' ? null : `${money(offer.price.each)} each${offer.money === 'epic' ? ' · Epic collects, charged when you say yes' : ` · paid to ${first} directly`}`;

  const answer = async (rsvp: 'yes' | 'no') => {
    setBusy(true);
    try { const r = await api.answerInvite(token, rsvp, rsvp === 'yes' ? Math.max(1, Number(heads) || 1) : null); setV({ ...v, invite: r.invite }); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <ScrollView contentContainerStyle={[styles.scroll, wide && styles.wide]} keyboardShouldPersistTaps="handled">
      {offer.video || offer.photos[0] ? <VideoHero src={offer.video} poster={offer.photos[0] ?? host.photo} height={wide ? 320 : 240} label={offer.video ? `${first} says hello` : null} /> : null}
      <View style={styles.gutter}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Wordmark height={26} />
          <Text style={type.label}>INVITED BY {host.name.toUpperCase()}</Text>
        </Row>
        <Text style={type.title}>{offer.title ?? 'You are invited'}</Text>
        <Text style={[type.small, { marginTop: 4 }]}>{when}{going ? ` · ${going} going` : ''}</Text>
        {offer.summary || offer.description ? <Text style={[type.body, { marginTop: spacing.md }]}>{offer.summary ?? offer.description}</Text> : null}
        {offer.summary && offer.description ? <Text style={[type.body, { marginTop: spacing.sm }]}>{offer.description}</Text> : null}

        <View style={styles.block}>
          <Kicker>WHERE</Kicker>
          <Row style={{ alignItems: 'flex-start' }}>
            <Icon name={VENUE_ICON[offer.venue]} size={16} />
            <Text style={[type.body, { flex: 1 }]}>{offer.venueLabel ?? offer.venueArea ?? (offer.venue === 'online' ? offer.onlinePlatform ?? 'Online' : 'To be confirmed')}</Text>
          </Row>
          {offer.venueNotes ? <Text style={type.small}>{offer.venueNotes}</Text> : null}
        </View>
        {offer.doc ? (
          <Press onPress={() => { const u = mediaUrl(offer.doc); if (u && typeof window !== 'undefined') window.open(u, '_blank'); }} accessibilityRole="link" style={styles.doc}>
            <Icon name="download" size={16} color={colors.ink} />
            <Text style={[type.h3, { flex: 1 }]}>Everything for the day, as a PDF</Text>
            <Text style={styles.link}>Download</Text>
          </Press>
        ) : null}
        {price ? <View style={styles.block}><Kicker>MONEY</Kicker><Text style={type.body}>{price}</Text></View> : null}
        {offer.facts.length ? (
          <View style={styles.block}>
            {offer.facts.map((f) => <Row key={f.key} style={{ justifyContent: 'space-between' }}><Text style={type.small}>{f.key}</Text><Text style={[type.small, { color: colors.ink, fontWeight: '600' }]}>{f.value}</Text></Row>)}
          </View>
        ) : null}

        <View style={styles.rsvp}>
          <Row><HostFace host={host} size={36} /><Text style={[type.h3, { flex: 1 }]}>{invite.rsvp === 'yes' ? `You said yes, ${invite.name.split(' ')[0]} — ${invite.rsvpHeads ?? invite.heads} of you.` : invite.rsvp === 'no' ? `You said no, ${invite.name.split(' ')[0]}. Change your mind any time.` : `${first} would love to know, ${invite.name.split(' ')[0]}.`}</Text></Row>
          <Row style={{ alignItems: 'center' }}>
            <Text style={[type.small, { flex: 1 }]}>How many of you are coming, including you?</Text>
            <NumberBox value={heads} onChange={setHeads} width={72} />
          </Row>
          {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
          <Row>
            <Button label="Yes, we are coming" icon="check" loading={busy} onPress={() => void answer('yes')} style={{ flex: 1 }} />
            <Button label="No" kind="secondary" onPress={() => void answer('no')} />
          </Row>
          <Text style={type.tiny}>Only {first} sees your answer. No account, no password.</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg },
  scroll: { paddingBottom: 60, backgroundColor: colors.bg },
  wide: { maxWidth: 720, alignSelf: 'center', width: '100%' },
  gutter: { paddingHorizontal: 20, paddingTop: spacing.lg },
  block: { marginTop: spacing.lg, gap: spacing.sm },
  doc: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, padding: spacing.md, borderWidth: BORDER, borderColor: colors.line },
  link: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.accent },
  rsvp: { marginTop: spacing.xl, padding: spacing.md, gap: spacing.md, backgroundColor: colors.surfaceMuted, minHeight: TARGET },
});
