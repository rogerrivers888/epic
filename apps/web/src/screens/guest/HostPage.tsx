/**
 * A host's profile, as a guest sees it (guest handoff G25): the offer video,
 * face, name, place and how soon they usually reply, the Verified · Checked
 * badges, rating and hosting since, About, their events, and reviews with the
 * host's replies — and Report this host, which goes to the back office's Safety.
 */

import React, { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { api, type HostProfile } from '../../api';
import { paths } from '../../routes';
import { useRouter } from '../../router';
import { signedIn } from '../../session';
import {
  Buttons, CREAM, Cards, Facts, Field, GuestPage, GuestSheet, HostRow, INACTIVE, INK, INK_MUTED, Kick, LANE_TAG, LIME, Para, PhotoHead, Rows, Tags, Waiting,
  dayWords, firstName, gbp, useToast,
} from './kit';
import { mediaUrl } from '../../components/hosting';

const sinceWords = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

export function HostPage({ id, webPage }: { id: string; webPage: boolean }) {
  const { navigate, back } = useRouter();
  const toast = useToast();
  const [d, setD] = useState<HostProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => { api.hostProfile(id).then(setD).catch((e) => setError(e?.message ?? 'That profile didn’t load.')); }, [id]);
  if (!d) return <Waiting error={error} />;

  const h = d.host;
  const first = firstName(h.name);
  const total = d.reviewTotal ?? h.reviewCount ?? d.reviews.length;
  const shown = all ? d.reviews : d.reviews.slice(0, 3);
  const head = d.offers.find((o) => o.photos.length)?.photos[0] ?? h.photo;

  const report = async () => {
    const r = reason.trim();
    if (!r) return;
    try { const out = await api.reportHost(h.id, r, null); setReporting(false); setReason(''); toast.show(out.message); }
    catch (e: any) { toast.show(e?.message ?? 'That didn’t send.'); }
  };

  const blocks: React.ReactNode[] = [];
  if (h.introVideo) blocks.push(<Buttons key="video" items={[{ label: `Watch ${first}’s intro`, icon: 'play', tone: 'ink', onPress: () => { const u = mediaUrl(h.introVideo); if (u) void Linking.openURL(u); } }]} />);
  blocks.push(
    <HostRow key="host" face={h.photo ? mediaUrl(h.photo) : null} name={h.name} line={[h.location, h.replyWords].filter(Boolean).join(' · ')} />,
    <Tags key="trust" items={[{ label: 'Verified', bg: INACTIVE, fg: INK }, ...(h.checked ? [{ label: 'Checked', bg: LIME, fg: INK }] : [])]} />,
    <Facts key="facts" items={[
      { label: 'Rating', value: h.rating != null && total ? `${h.rating.toFixed(1)} · ${total} review${total === 1 ? '' : 's'}` : 'No reviews yet' },
      { label: 'Hosting since', value: sinceWords(h.since) },
    ]} />,
  );
  if (h.introText) blocks.push(<Kick key="about-k" top={4}>About</Kick>, <Para key="about">{h.introText}</Para>);
  if (d.offers.length) {
    blocks.push(<Kick key="ev-k" top={4}>Events</Kick>, <Cards key="ev" items={d.offers.map((o) => ({
      key: o.id, photo: o.photos[0] ? mediaUrl(o.photos[0]) : null, title: o.title ?? 'An event', price: o.price?.each ? gbp(o.price.each) : 'Free',
      line: o.startsOn ? dayWords(o.startsOn) : LANE_TAG[o.lane ?? 'oneoff'].label, lane: LANE_TAG[o.lane ?? 'oneoff'].label, left: o.standing?.full ? 'Full' : null,
      onPress: () => navigate(paths.experience(o.id)),
    }))} />);
  }
  if (d.reviews.length) {
    blocks.push(
      <Kick key="rv-k" top={4} link={!all && total > shown.length ? { label: `All ${total}`, onPress: () => setAll(true) } : null}>Reviews</Kick>,
      <Rows key="rv" items={shown.map((r, i) => ({
        key: `r${i}`, title: r.text ? `“${r.text}”` : `${r.stars} out of 5`, weight: '600' as const,
        sub: [r.who, `${r.stars} out of 5`, r.reply ? `${first} replied: “${r.reply}”` : r.title].filter(Boolean).join(' · '),
      }))} />,
    );
  }
  blocks.push(<Rows key="report" items={[{ title: 'Report this host', weight: '700', onPress: () => setReporting(true) }]} />);

  const sheet = reporting ? (
    <GuestSheet title={`Report ${first}`} onClose={() => setReporting(false)}>
      <Field value={reason} onChange={setReason} placeholder="What happened, or what looks wrong" height={96} maxLength={1000} />
      <Para color={INK_MUTED}>Somebody at Epic reads every report.</Para>
      <Buttons items={[{ label: 'Send', tone: 'ink', onPress: report }]} />
    </GuestSheet>
  ) : null;

  return (
    <GuestPage head={<PhotoHead uri={head ? mediaUrl(head) : null} webPage={webPage} onBack={() => back(paths.inspire())} />} overlay={<>{toast.node}{sheet}</>}>
      {blocks}
    </GuestPage>
  );
  void CREAM; void signedIn;
}
