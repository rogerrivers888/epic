/**
 * Epic Events on the web (brief, 3 Oct 2026): a public event page (G23) and a
 * host page (G25) for anybody — signed out, or Google. The website's own
 * header and footer; the event title is the page's one H1; the host is
 * "Hannah R." and the place is the town, never the address, until somebody
 * books. Booking, accounts and the app stay behind the sign-in: Book goes to
 * the booking screen, through Log in when there is no session.
 *
 * The web server writes this page's title, description, canonical and
 * schema.org into the HTML first (events.mjs); this draws the page itself.
 */

import React, { useEffect, useState } from 'react';
import { Image, Platform, Text, View } from 'react-native';
import { api, API_URL, type PublicCard, type PublicEvent as Ev, type PublicHostPage as Host, type PublicReviews } from '../../api';
import { eventPrice } from '../../components/InspireBody';
import { SiteLayout } from '../../site/SiteLayout';
import { paths, type SiteLocale } from '../../routes';
import { useRouter } from '../../router';
import { signedIn } from '../../session';
import { useViewport } from '../../hooks/useViewport';
import { Buttons, Cards, Facts, HostRow, INK_MUTED, Kick, Notice, Para, PhotoHead, Rows, Tags, Waiting, dayWords, hx, tx, LIME, INACTIVE, INK } from './kit';

const pic = (path: string | null | undefined) => (path ? `${API_URL}${path}` : null);
const H1 = ({ children }: { children: string }) => (
  // The page's one H1 (brief §2a); react-native-web draws role heading at level 1 as <h1>.
  <Text style={hx(30)} {...({ role: 'heading', 'aria-level': 1 } as object)}>{children}</Text>
);
const H2 = ({ children, top = 6 }: { children: string; top?: number }) => (
  <Text style={[tx(12, '800', INK_MUTED, { letterSpacing: 0.6, textTransform: 'uppercase' }), { marginTop: top }]} {...({ role: 'heading', 'aria-level': 2 } as object)}>{children}</Text>
);

function useTitle(title: string | null) {
  useEffect(() => { if (title && Platform.OS === 'web' && typeof document !== 'undefined') document.title = title; }, [title]);
}

function cardsOf(list: PublicCard[] | undefined, go: (path: string) => void) {
  return (list ?? []).map((c) => ({
    key: c.code, photo: pic(c.photo), title: c.title ?? 'An event', price: eventPrice({ price: c.price, who: { ageMin: null, ageMax: null, dropOff: false } } as never),
    line: [c.date ? dayWords(c.date) : c.kind, c.area].filter(Boolean).join(' · '), lane: c.kind ?? '', onPress: () => go(c.path),
  }));
}

function ReviewList({ reviews, host }: { reviews: PublicReviews; host: string }) {
  if (!reviews.items.length) return null;
  return (
    <>
      <H2>{`Reviews · ${reviews.rating != null ? `${reviews.rating.toFixed(1)} from ` : ''}${reviews.total}`}</H2>
      <Rows items={reviews.items.map((r, i) => ({
        key: `r${i}`, title: r.text ? `“${r.text}”` : `${r.stars} out of 5`, weight: '600' as const,
        sub: [r.who, `${r.stars} out of 5`, r.reply ? `${host.split(' ')[0]} replied: “${r.reply}”` : null].filter(Boolean).join(' · '),
      }))} />
    </>
  );
}

function Frame({ locale, children }: { locale: SiteLocale; children: React.ReactNode }) {
  const { width } = useViewport();
  return (
    <SiteLayout locale={locale} header={{ tone: 'cream', left: 'wordmark' }}>
      <View style={{ width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: width >= 680 ? 32 : 20, paddingTop: 16, paddingBottom: 40, gap: 14 }}>{children}</View>
    </SiteLayout>
  );
}

function whenWords(e: Ev): string {
  const ss = e.when?.sessions ?? [];
  if (e.lane === 'onrequest') return 'On request · pick a day and a time';
  if (!ss.length) return e.when?.last ? `Last on ${dayWords(e.when.last)}` : '';
  const t = ss[0].time ? ` · ${ss[0].time}${ss[0].endsAt ? `–${ss[0].endsAt}` : ''}` : '';
  if (e.lane === 'weekly') return `Weekly · next ${dayWords(ss[0].date)}${t}`;
  if (e.lane === 'course') return `${ss.length} sessions from ${dayWords(ss[0].date)}${t}`;
  return `${dayWords(ss[0].date)}${t}`;
}

function whoWords(e: Ev): string {
  const w = e.who;
  if (!w) return '';
  const ages = w.ageMin != null && w.ageMax != null ? `Ages ${w.ageMin}–${w.ageMax}` : w.ageMin != null ? (w.ageMin >= 18 ? 'Adults' : `Ages ${w.ageMin} and up`) : w.ageMax != null ? `Up to ${w.ageMax}` : 'Everyone';
  // Children's events say who they're for and that the host is Checked (brief §5).
  return w.dropOff ? `${ages} · Drop off${w.checked ? ' · host Checked' : ''}` : ages;
}

export function PublicEventPage({ code, locale }: { code: string; locale: SiteLocale }) {
  const { navigate } = useRouter();
  const [e, setE] = useState<Ev | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.publicEvent(code).then(setE).catch((x) => setError(x?.status === 404 ? 'This event isn’t on Epic.' : x?.message ?? 'That didn’t load.')); }, [code]);
  useTitle(e?.title ? `${e.title}${e.where?.area ? ` · ${e.where.area}` : ''} · Epic Events` : null);
  if (!e) return <Frame locale={locale}><Waiting error={error} /></Frame>;

  const book = () => {
    const to = paths.experienceBook(e.offerId!);
    navigate(signedIn() ? to : `${paths.login()}?next=${encodeURIComponent(to)}`);
  };
  const price = eventPrice({ price: e.price!, who: { ageMin: e.who?.ageMin ?? null, ageMax: e.who?.ageMax ?? null, dropOff: e.who?.dropOff ?? false } } as never);
  const open = e.status === 'live';
  return (
    <Frame locale={locale}>
      {e.photos?.[0] ? <View style={{ marginHorizontal: -20 }}><PhotoHead uri={pic(e.photos[0])} webPage /></View> : null}
      {/* Over, for whatever reason: the page stays up and says so (Roger, 3 Oct 2026). */}
      {e.ended === 'finished' ? <Notice bg={INACTIVE} weight="800">{`This has finished${e.on ? ` · ${dayWords(e.on)}` : ''}`}</Notice> : null}
      {e.ended === 'called_off' ? <Notice bg={INACTIVE} weight="800">This one was called off</Notice> : null}
      {e.ended === 'host' ? <Notice bg={INACTIVE} weight="800">This host isn’t hosting just now</Notice> : null}
      <Tags items={[{ label: e.kind ?? 'Event', bg: INK, fg: LIME }, ...(e.subcategory ? [{ label: e.subcategory, bg: INACTIVE, fg: INK }] : [])]} />
      <H1>{e.title ?? 'An event'}</H1>
      {e.summary ? <Text style={tx(15, '400', INK_MUTED, { lineHeight: 21 })}>{e.summary}</Text> : null}
      <Facts items={[{ label: 'When', value: whenWords(e) }, { label: 'Where', value: e.where?.online ? 'Online' : e.where?.area ?? 'Shared when you book' }, { label: 'Price', value: price }, { label: 'Who', value: whoWords(e) }]} />
      {open ? <Buttons items={[{ label: e.lane === 'onrequest' ? 'Ask to book' : 'Book', tone: 'ink', onPress: book }]} /> : null}

      {e.description ? (<><H2>What you’ll do</H2><Para>{e.description}</Para></>) : null}
      {(e.when?.sessions?.length ?? 0) > 1 ? (
        <><H2>When</H2><Rows items={e.when!.sessions.map((s, i) => ({ key: `s${i}`, title: dayWords(s.date), value: s.time ?? '' }))} /></>
      ) : null}
      <H2>Where</H2>
      <Para>{e.where?.online ? 'Online. The link comes when you book.' : `${e.where?.area ?? 'The area'}. The exact place is shared when you book.`}</Para>
      {e.refundWords ? (<><H2>Refunds</H2><Para>{e.refundWords}</Para></>) : null}

      {e.host ? (
        <>
          <H2>Your host</H2>
          <HostRow face={pic(e.host.photo)} name={e.host.name} line={[e.host.checked ? 'Checked' : null, e.host.since ? `Hosting since ${e.host.since.slice(0, 4)}` : null].filter(Boolean).join(' · ')} onPress={() => navigate(e.host!.path)} />
        </>
      ) : null}
      {e.reviews && e.host ? <ReviewList reviews={e.reviews} host={e.host.name} /> : null}
      {e.moreFromHost?.length ? (<><H2>{`More from ${e.host?.name.split(' ')[0] ?? 'this host'}`}</H2><Cards items={cardsOf(e.moreFromHost, navigate)} /></>) : null}
      {e.similar?.length ? (<><H2>More like this nearby</H2><Cards items={cardsOf(e.similar, navigate)} /></>) : null}
    </Frame>
  );
}

export function PublicHostPage({ code, locale }: { code: string; locale: SiteLocale }) {
  const { navigate } = useRouter();
  const [h, setH] = useState<Host | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.publicHost(code).then(setH).catch((x) => setError(x?.status === 404 ? 'This host isn’t on Epic.' : x?.message ?? 'That didn’t load.')); }, [code]);
  const what = [h?.subcategory, h?.town ? `in ${h.town}` : null].filter(Boolean).join(' ');
  useTitle(h?.name ? `${h.name}${what ? ` · ${what}` : ''} · Epic Hosts` : null);
  if (!h) return <Frame locale={locale}><Waiting error={error} /></Frame>;
  if (h.status === 'gone') return <Frame locale={locale}><H1>This host isn’t hosting just now</H1></Frame>;
  return (
    <Frame locale={locale}>
      {h.photo ? <Image source={{ uri: pic(h.photo)! }} style={{ width: 96, height: 96, borderRadius: 48 }} accessibilityIgnoresInvertColors /> : null}
      <H1>{h.name ?? 'An Epic host'}</H1>
      {what ? <Text style={tx(15, '400', INK_MUTED)}>{what}</Text> : null}
      <Text style={tx(13.5, '600', INK_MUTED)}>{[h.checked ? 'Checked' : null, h.since ? `Hosting since ${h.since.slice(0, 4)}` : null].filter(Boolean).join(' · ')}</Text>
      {h.events?.length ? (<><H2>Events</H2><Cards items={cardsOf(h.events, navigate)} /></>) : <Para color={INK_MUTED}>Nothing on just now.</Para>}
      {h.reviews ? <ReviewList reviews={h.reviews} host={h.name ?? ''} /> : null}
      {h.intro ? (<><H2>About</H2><Para>{h.intro}</Para></>) : null}
      {h.finished?.length ? (<><H2>Recently</H2><Cards items={cardsOf(h.finished, navigate)} /></>) : null}
    </Frame>
  );
}

/** The short link, if the app is ever asked for it directly (the web server 301s it first). */
export function ShortEvent({ code }: { code: string }) {
  const { navigate } = useRouter();
  useEffect(() => { api.publicEvent(code).then((e) => navigate(e.path, { replace: true })).catch(() => navigate(paths.siteHome(), { replace: true })); }, [code]);
  return <Waiting />;
}
