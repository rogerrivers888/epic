/**
 * E1 · Host home for a host who already hosts (hosting v4, README E1).
 *
 * Top to bottom: "Host" and the host's face (→ E13); four tiles, 2×2, all
 * greens dark to light — Messages · To do · At risk · Reviews — a tile with
 * nothing in it shows 0 and stays put, At risk turns amber above 0; Next up
 * with the three sessions after it, or "Nothing on yet" and the unfinished
 * draft for a quiet host; the party card for a private host; Earnings in lime
 * (not for a free private host); Your status; and Host something new, fixed
 * above the tab bar.
 */

import { insetTop } from '../../../insets';
import React, { useEffect, useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { Press } from '../../../components/press';
import { Icon } from '../../../components/Icon';
import { useRouter } from '../../../router';
import { paths } from '../../../routes';
import { useViewport } from '../../../hooks/useViewport';
import { api } from '../../../api';
import {
  AMBER, CREAM, DEEP_GREEN, DESK_MESSAGES, DESK_REVIEWS, DESK_RISK, DESK_TODO, HAIRLINE, INACTIVE, INK, INK_MUTED, LIME, NEUTRAL,
} from '../../../theme';
import { LANES, LANE_ORDER } from '../v7/model';
import { HostLanes } from '../v7/HostHome';
import { Bar, Bars, Btn, Kicker, Loading, Section, StatusChip, amberText, hx, tx } from './kit';
import { dayWords, gbp, monthWords, type DeskHome, type SessionCard } from './model';

type Desk = Extract<DeskHome, { home: 'desk' }>;

export function HostDesk({ fallbackCount = 0 }: { fallbackCount?: number }) {
  const [home, setHome] = useState<DeskHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invites, setInvites] = useState<Awaited<ReturnType<typeof api.deskCohostInvites>>['invites']>([]);
  useEffect(() => { api.desk().then(setHome).catch((e) => setError(e.message)); api.deskCohostInvites().then((r) => setInvites(r.invites)).catch(() => null); }, []);
  // The strip, when it shows, is the first row under the status bar and takes its inset; the page below then doesn't (Codex, 3 Oct 2026).
  const strip = invites.length ? <CohostInvites invites={invites} onDone={(id) => setInvites((l) => l.filter((x) => x.id !== id))} /> : null;
  const under = Boolean(strip);
  if (error && !home) return <View style={{ flex: 1 }}>{strip}<HostLanes yours={fallbackCount} under={under} /></View>;
  if (!home) return <Loading />;
  if (home.home === '4e') return <View style={{ flex: 1 }}>{strip}<HostLanes yours={home.helping ?? 0} under={under} /></View>;
  return <View style={{ flex: 1 }}>{strip}<DeskHomeView d={home} under={under} /></View>;
}

/** Asked to co-host: nothing of the event is shown until they accept (Codex, 2 Oct 2026). */
function CohostInvites({ invites, onDone }: { invites: { id: string; offerId: string; title: string | null; host: string }[]; onDone: (id: string) => void }) {
  const { navigate } = useRouter();
  return (
    <View style={{ backgroundColor: LIME, paddingHorizontal: 20, paddingTop: insetTop(10), paddingBottom: 10, gap: 6 }}>
      {invites.map((i) => (
        <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={[tx(14, '700'), { flex: 1 }]} numberOfLines={1}>Co-host {i.title ?? 'an event'} · {i.host}</Text>
          <Btn label="Accept" onPress={() => { api.deskAcceptCohost(i.id).then((r) => { onDone(i.id); navigate(paths.hostEvent(r.offerId)); }).catch(() => null); }} />
        </View>
      ))}
    </View>
  );
}

function DeskHomeView({ d, under = false }: { d: Desk; under?: boolean }) {
  const { navigate } = useRouter();
  const { width } = useViewport();
  const wide = width >= 900;
  const col = wide ? { width: 560, alignSelf: 'center' as const } : null;
  const t = d.tiles;
  return (
    <View style={{ flex: 1, backgroundColor: CREAM, paddingTop: under ? 0 : insetTop(0) }}>
      <ScrollView contentContainerStyle={[{ paddingBottom: 20 }, col]}>
        <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={hx(32)} accessibilityRole="header">Host</Text>
          <Press onPress={() => navigate(paths.hostSettings())} accessibilityRole="button" accessibilityLabel="Profile and settings">
            {d.host.photo
              ? <Image source={{ uri: d.host.photo }} style={{ width: 36, height: 36, borderRadius: 18 }} accessibilityIgnoresInvertColors />
              : <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: NEUTRAL, alignItems: 'center', justifyContent: 'center' }}><Text style={tx(15, '800')}>{d.host.name.slice(0, 1)}</Text></View>}
          </Press>
        </View>

        <View style={{ paddingHorizontal: 20, gap: 3 }}>
          <View style={{ flexDirection: 'row', gap: 3 }}>
            <Tile kicker="Messages" value={String(t.messages)} ground={DESK_MESSAGES} light onPress={() => navigate(paths.hostMessages())} />
            <Tile kicker="To do" value={String(t.todo)} ground={DESK_TODO} light onPress={() => navigate(paths.hostTodo())} />
          </View>
          <View style={{ flexDirection: 'row', gap: 3 }}>
            <Tile kicker="At risk" value={String(t.atRisk)} ground={t.atRisk > 0 ? AMBER : DESK_RISK} onPress={() => navigate(paths.hostAtRisk())} />
            <Tile kicker="Reviews" aside={[t.reviews.newReviews ? `${t.reviews.newReviews} new` : null, t.reviews.newTips ? `${t.reviews.newTips} ${t.reviews.newTips === 1 ? 'tip' : 'tips'}` : null].filter(Boolean).join(' · ') || null}
              value={t.reviews.avg == null ? '—' : t.reviews.avg.toFixed(1)} star={t.reviews.avg != null} ground={DESK_REVIEWS} onPress={() => navigate(paths.hostReviews())} />
          </View>
        </View>

        {d.nextUp ? <NextUp n={d.nextUp} /> : d.draft ? (
          <Section title="Nothing on yet" link={{ label: 'All events', go: () => navigate(paths.hostEvents()) }}>
            <View style={{ borderWidth: 1, borderColor: HAIRLINE, padding: 14, gap: 10 }}>
              <Text style={hx(19)}>{d.draft.title ?? 'Your draft'}</Text>
              <Bar value={d.draft.step} of={d.draft.of} fill={DEEP_GREEN} />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={tx(13.5, '400', INK_MUTED)}>{d.draft.words}</Text>
                <Btn label="Carry on" onPress={() => navigate(paths.hostSetup(d.draft!.offerId))} />
              </View>
            </View>
          </Section>
        ) : (
          <Section title="Next up" link={{ label: 'All events', go: () => navigate(paths.hostEvents()) }}><Text style={tx(14, '400', INK_MUTED)}>Nothing on yet.</Text></Section>
        )}

        {d.party ? <Party p={d.party} /> : null}
        {d.earnings ? <Earnings e={d.earnings} /> : null}
        <Status d={d} />
      </ScrollView>

      <View style={[{ borderTopWidth: 1, borderTopColor: HAIRLINE, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10, gap: 8, backgroundColor: CREAM }, col]}>
        <Kicker>Host something new</Kicker>
        <View style={{ flexDirection: 'row', gap: 3 }}>
          {LANE_ORDER.map((lane) => (
            <Press key={lane} onPress={() => navigate(paths.hostLane(lane))} accessibilityRole="button" accessibilityLabel={`Host something new: ${LANES[lane].tag}`}
              style={{ flex: 1, height: 58, backgroundColor: LANES[lane].bg, padding: 8, justifyContent: 'space-between' }}>
              <Text style={tx(12.5, '800', LANES[lane].fg)} numberOfLines={1}>{LANES[lane].tag}</Text>
              <View style={{ alignSelf: 'flex-end' }}><Icon name="add" size={16} color={LANES[lane].fg} /></View>
            </Press>
          ))}
        </View>
      </View>
    </View>
  );
}

function Tile({ kicker, value, ground, light, onPress, aside, star }: { kicker: string; value: string; ground: string; light?: boolean; onPress: () => void; aside?: string | null; star?: boolean }) {
  const fg = light ? CREAM : INK;
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={`${kicker}: ${value}`}
      style={{ flex: 1, height: 58, backgroundColor: ground, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center' }}>
      <View style={{ flex: 1, gap: 1 }}>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'baseline' }}>
          <Text style={tx(11, '700', fg, { letterSpacing: 0.66, textTransform: 'uppercase' })}>{kicker}</Text>
          {aside ? <Text style={tx(11, '600', fg)} numberOfLines={1}>{aside}</Text> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {star ? <Icon name="favourite" size={16} color={fg} fill /> : null}
          <Text style={hx(21, fg)}>{value}</Text>
        </View>
      </View>
      <View style={{ opacity: 0.7 }}><Icon name="more" size={16} color={fg} /></View>
    </Press>
  );
}

function NextUp({ n }: { n: { first: SessionCard; more: SessionCard[] } }) {
  const { navigate } = useRouter();
  const f = n.first;
  return (
    <Section title="Next up" link={{ label: 'All events', go: () => navigate(paths.hostEvents()) }}>
      {/* The card opens the event; Message guests is its own button beside it, never inside another. */}
      <View style={{ borderWidth: 1, borderColor: HAIRLINE, padding: 14, gap: 8 }}>
        <Press onPress={() => navigate(paths.hostEvent(f.offerId, { session: f.sessionId }))} accessibilityRole="link" accessibilityLabel={`${f.title ?? 'Next up'}, ${dayWords(f.date)}`} style={{ gap: 8 }}>
          <Text style={tx(12.5, '800', DEEP_GREEN)}>{dayWords(f.date)}{f.time ? ` · ${f.time}` : ''}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <Text style={[hx(19), { flex: 1 }]}>{f.title}</Text>
            <StatusChip chip={f.chip} words={f.chipWords} />
          </View>
        </Press>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Text style={tx(13.5, '400', INK_MUTED)}>{f.booked}{f.max ? ` of ${f.max}` : ''} booked</Text>
          <Btn label="Message guests" onPress={() => navigate(paths.hostOfferChat(f.offerId))} />
        </View>
      </View>
      {n.more.length ? (
        <View style={{ flexDirection: 'row', gap: 3 }}>
          {n.more.map((m) => (
            <Press key={m.sessionId ?? m.offerId} onPress={() => navigate(paths.hostEvent(m.offerId, { session: m.sessionId }))} accessibilityRole="button"
              style={{ flex: 1, backgroundColor: INACTIVE, padding: 10, gap: 4 }}>
              <Text style={tx(12.5, '800')}>{dayWords(m.date)}</Text>
              <Text style={tx(13, '700')}>{m.title}</Text>
              <Text style={tx(12, m.underMin ? '700' : '400', m.underMin ? amberText : INK_MUTED)}>{m.booked}{m.max ? ` of ${m.max}` : ''}{m.underMin && m.min ? ` · min ${m.min}` : ''}</Text>
            </Press>
          ))}
        </View>
      ) : null}
    </Section>
  );
}

function Party({ p }: { p: NonNullable<Desk['party']> }) {
  const { navigate } = useRouter();
  return (
    <Section title="Your party">
      <Press onPress={() => navigate(paths.hostEvent(p.offerId))} accessibilityRole="button" style={{ gap: 0 }}>
        <View>
          {p.photo ? <Image source={{ uri: p.photo }} style={{ height: 140, borderRadius: 8 }} accessibilityIgnoresInvertColors /> : <View style={{ height: 140, borderRadius: 8, backgroundColor: DESK_REVIEWS }} />}
          <View style={{ position: 'absolute', left: 10, top: 10, backgroundColor: LIME, paddingHorizontal: 7, paddingVertical: 3 }}><Text style={tx(12, '800')}>{dayWords(p.date)}{p.time ? ` · ${p.time}` : ''}</Text></View>
        </View>
        <View style={{ backgroundColor: INK, padding: 14, gap: 10 }}>
          <Text style={hx(19, CREAM)}>{p.title}</Text>
          <View style={{ flexDirection: 'row', gap: 3 }}>
            {([['Coming', p.coming], ['Can’t come', p.cantCome], ['No reply', p.noReply]] as const).map(([k, v]) => (
              <View key={k} style={{ flex: 1, gap: 2 }}><Text style={hx(24, k === 'Coming' ? LIME : CREAM)}>{v}</Text><Text style={tx(12, '600', CREAM)}>{k}</Text></View>
            ))}
          </View>
        </View>
      </Press>
    </Section>
  );
}

function Earnings({ e }: { e: NonNullable<Desk['earnings']> }) {
  const { navigate } = useRouter();
  return (
    <Section>
      <Press onPress={() => navigate(paths.hostEarnings())} accessibilityRole="button" accessibilityLabel="Earnings" style={{ backgroundColor: LIME, padding: 16, gap: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Kicker color={INK}>Earnings · {monthWords(e.month)}</Kicker>
          {e.changePct != null ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <Icon name={e.changePct >= 0 ? 'ascending' : 'descending'} size={14} color={INK} />
              <Text style={tx(13, '700')}>{Math.abs(e.changePct)}% on {monthWords(e.prevMonth)}</Text>
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
          <Text style={hx(46)}>{gbp(e.pence)}</Text>
          <View style={{ width: 84 }}><Bars values={e.bars.map((b) => b.pence)} selected={e.bars.length - 1} height={40} /></View>
        </View>
        {e.goalPence ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1 }}><Bar value={e.pence} of={e.goalPence} ground={'rgba(32,30,29,0.16)'} /></View>
            <Text style={tx(12.5, '700')}>{gbp(e.pence)} of {gbp(e.goalPence)}</Text>
          </View>
        ) : null}
        <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(32,30,29,0.16)', paddingTop: 10 }}>
          <Text style={tx(13, '600')}>{[e.due ? `${gbp(e.due.pence)} due ${dayWords(e.due.on)}` : null, `${gbp(e.bookedAheadPence)} booked ahead`].filter(Boolean).join(' · ')}</Text>
        </View>
      </Press>
    </Section>
  );
}

function Status({ d }: { d: Desk }) {
  const { navigate } = useRouter();
  const s = d.status;
  const standing = s.standing.words;
  return (
    <Section title="Your status">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: HAIRLINE, paddingVertical: 14 }}>
        <Press onPress={() => navigate(paths.hostFees())} accessibilityRole="button" accessibilityLabel="Fees" style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {s.private ? (
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={hx(20)}>{s.eventPence != null ? `${gbp(s.eventPence)} an event` : '—'}</Text>
              <Text style={tx(12.5, '400', INK_MUTED)}>{[s.proPence != null ? `or Pro ${gbp(s.proPence)} a month` : null, s.paymentFeePct != null ? `${s.paymentFeePct}% on payments through Epic` : null].filter(Boolean).join(' · ')}</Text>
            </View>
          ) : (
            <>
              <Text style={hx(24)}>{s.feePct == null ? '—' : `${s.feePct}%`}</Text>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={tx(13, '600')}>{s.line ?? (s.progress?.next ? '' : 'Your best rate')}</Text>
                {s.progress?.next ? <Bar value={s.progress.ratedEvents} of={s.progress.next.ratedEvents} fill={LIME} ground={HAIRLINE} /> : null}
              </View>
            </>
          )}
        </Press>
        <Press onPress={() => navigate(paths.hostReviews())} accessibilityRole="button" accessibilityLabel="Reviews" style={{ alignItems: 'flex-end', flexDirection: 'row', gap: 6 }}>
          <View style={{ alignItems: 'flex-end' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              {s.rating != null ? <Icon name="favourite" size={14} color={INK} fill /> : null}
              <Text style={tx(14, '800')}>{s.rating == null ? '—' : s.rating.toFixed(1)}</Text>
            </View>
            <Text style={tx(12.5, '700', DEEP_GREEN)}>{standing ?? '—'}</Text>
          </View>
          <Icon name="more" size={16} color={INK} />
        </Press>
      </View>
    </Section>
  );
}
