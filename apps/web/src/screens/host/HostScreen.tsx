/**
 * The Host tab (Settings revised v2 · Lane 3, SX7–SX21).
 *
 * Two states. Not a host yet: the learn layer (H1), unchanged. A host: a title
 * band with "Host" and an ink "+ New offer", then four tabs — Upcoming (SX15) ·
 * Stats (SX12) · Money (SX9) · Profile (SX8). Everything below a tab pushes a
 * screen with a back arrow, and every one of those is query state on this same
 * /host address (there is no new route): ?tab=, ?activity=&when=, ?level=1,
 * ?money=, ?skills=1, ?evidence=1 — the way this screen already carried ?view=.
 *
 * The old onboarding, the offer wizard, the per-offer dashboard, the host inbox,
 * the video recorder and the editable profile are untouched: they are the other
 * `route.page`s and are dispatched first, exactly as before.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '../../components/press';
import { api, HostHome, HostMoney, OfferShape, OwnOffer, Visibility } from '../../api';
import { colors, fonts, BORDER, INK, LIME, CREAM } from '../../theme';
import { Icon } from '../../components/Icon';
import { TitleBand, CompactBand } from '../../components/Band';
import { InkMenu } from '../../components/InkMenu';
import { Sheet } from '../../components/Sheet';
import { showToast } from '../../components/Toast';
import { OutstandingSheet, type Outstanding } from '../SettingsScreen';
import { useViewport } from '../../hooks/useViewport';
import { useRouter, useQueryState, asOneOf } from '../../router';
import { paths, type Route } from '../../routes';
import { HostFace, mediaUrl, priceWords, SHAPE_ICON, STATE_LABEL, TRUST_LABEL } from '../../components/hosting';
import { t, k, Tag, Segments } from '../../components/hostKit';
import { Section, Kicker, SummaryCells, Grid2, EqualTable, DateCol, FillBar, NavRow, gbp, todayIso, dateOf, offerDateGroups } from './hostTabKit';
import { LearnExample, LearnExamples, LearnShape, LearnWho } from './Learn';
import { OfferWizard } from './OfferWizard';
import { OfferDashboard } from './OfferDashboard';
import { VideoRecorder } from './VideoRecorder';
import { ProfileScreen } from './ProfileScreen';
import { HostInbox } from '../../components/chat/HostInbox';
import { HostActivity } from './HostActivity';
import { HostLevel } from './HostLevel';
import { HostMoneyDetail, type MoneyScreen } from './HostMoneyDetail';
import { HostSkills, HostEvidence } from './HostExtras';
// Four ways to host (hosting v7): Host home 4e, a lane, its set-up, the checklist, the ending.
import { HostLanes, LaneScreen } from './v7/HostHome';
import { Setup } from './v7/Setup';
import { Publish } from './v7/Publish';
import { Ending } from './v7/Ending';
import { HOST_LANES, type HostLane } from '../../routes';

const WIDE = 900;
const LANE_TAG: Record<HostLane, string> = { oneoff: 'One-off', weekly: 'Weekly', course: 'Course', onrequest: 'On request' };
const HostTab = ['upcoming', 'stats', 'money', 'profile'] as const;
type HostTabKey = typeof HostTab[number];
const MoneyScreens = ['account', 'schedule', 'history', 'tax', 'statements'] as const;

export function HostScreen({ route }: { route: Extract<Route, { name: 'host' }> }) {
  const { width } = useViewport();
  const wide = width >= WIDE;
  const { navigate, query, setQuery, back } = useRouter();
  const [home, setHome] = useState<HostHome | null>(null);
  const [money, setMoney] = useState<HostMoney | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useQueryState<HostTabKey>('tab', 'upcoming', asOneOf(HostTab, 'upcoming'));

  const load = useCallback(async () => {
    try {
      const h = await api.hostHome();
      setHome(h); setError(null);
      if (h.host) { api.hostMoney().then(setMoney).catch(() => setMoney(null)); } else setMoney(null);
    } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load, route.page]);

  // A new offer: the draft is made on the first tap, then it continues on its own address.
  const creating = useRef(false);
  useEffect(() => {
    if (route.page !== 'new' || creating.current) return;
    creating.current = true;
    const shape = (query.get('shape') as OfferShape | null) ?? 'oneoff';
    const vis = (query.get('vis') as Visibility | null) ?? undefined;
    api.createOffer(shape, vis).then((r) => navigate(paths.hostOfferEdit(r.offer.id, 'plan'), { replace: true })).catch((e) => { setError(e.message); creating.current = false; });
  }, [route.page]);
  useEffect(() => { if (route.page === 'start') navigate(paths.hostMe(), { replace: true }); }, [route.page]);

  // Four ways to host — dispatched before anything else, and needing nothing loaded here.
  if (route.page === 'lanes') return <HostLanes />;
  if (route.page === 'lane' && route.param && (HOST_LANES as readonly string[]).includes(route.param)) return <LaneScreen lane={route.param as HostLane} />;
  if (route.page === 'compose' && route.param && (HOST_LANES as readonly string[]).includes(route.param)) return <Setup lane={route.param as HostLane} offerId={null} />;
  if (route.page === 'setup' && route.offerId) return <Setup lane={null} offerId={route.offerId} />;
  if (route.page === 'publish' && route.offerId) return <Publish offerId={route.offerId} />;
  if (route.page === 'done' && route.offerId) return <Ending offerId={route.offerId} />;

  // The existing sub-stacks, dispatched first and unchanged.
  if (route.page === 'shape' && route.param) return <LearnShape shape={route.param as OfferShape} wide={wide} />;
  if (route.page === 'examples') return <LearnExamples wide={wide} />;
  if (route.page === 'example' && route.param) return <LearnExample exampleKey={route.param} wide={wide} />;
  if (route.page === 'who') return <LearnWho wide={wide} />;
  if ((route.page === 'profile' || route.page === 'start') && home) return <ProfileScreen home={home} onChanged={load} />;
  if (route.page === 'edit' && route.offerId) return <OfferWizard offerId={route.offerId} home={home} onChanged={load} />;
  if (route.page === 'offer' && route.offerId) return <OfferDashboard offerId={route.offerId} hostName={home?.host?.name ?? ''} chat={route.chat ?? null} />;
  if (route.page === 'questions') return <HostInbox onBack={() => navigate(paths.host())} onOpen={(offerId, topicId) => navigate(paths.hostOfferChatTopic(offerId, topicId))} />;
  if (route.page === 'video') {
    const offerId = query.get('offer');
    return <VideoRecorder offerId={offerId} onDone={() => navigate(offerId ? paths.hostOfferEdit(offerId, 'extract') : paths.hostMe(), { replace: true })} />;
  }
  if (route.page === 'new' || route.page === 'profile') return <View style={styles.centre}><Text style={t.sub}>{error ?? 'One moment…'}</Text></View>;

  if (!home) return <View style={styles.centre}><Text style={t.sub}>{error ?? 'Loading…'}</Text></View>;
  // Not hosting yet: Host home 4e (hosting v7) — the four ways in.
  // Host home is 4e for everybody (owner, 2 Oct 2026: hosts with offers do not land on the
  // dashboard). The dashboard lives at /host/offers until host management has its own design,
  // and 4e links to it only when there is something there.
  if (route.page !== 'manage') return <HostLanes yours={home.host ? home.offers.length : 0} />;
  if (!home.host || !home.offers.length) return <HostLanes yours={0} />;

  // The Host tab's own sub-screens, all query state on /host. Opening one is a
  // move (a push, below); Back walks the history, or one layer up to /host for
  // somebody who arrived on a shared link.
  const goBack = () => back(paths.hostManage());
  const open = (patch: Record<string, string | null>) => setQuery(patch, { replace: false });
  const activityId = query.get('activity');
  const activity = activityId ? home.offers.find((o) => o.id === activityId) ?? null : null;
  if (activity) return <HostActivity offer={activity} money={money} onBack={goBack} />;
  if (query.get('level')) return money ? <HostLevel money={money} host={home.host} onBack={goBack} /> : <Loading />;
  const moneyScreen = query.get('money') as MoneyScreen | null;
  if (moneyScreen && MoneyScreens.includes(moneyScreen)) {
    return money ? <HostMoneyDetail which={moneyScreen} money={money} host={home.host} onBack={goBack} onChanged={load} /> : <Loading />;
  }
  if (query.get('skills')) return <HostSkills home={home} onBack={goBack} />;
  if (query.get('evidence')) return <HostEvidence home={home} onBack={goBack} />;

  // The four tabs.
  return (
    <View style={k.page}>
      <View style={wide ? k.wide : undefined}>
        <TitleBand title="Host" right={<NewOfferButton onPress={() => navigate(paths.hostLanes())} />} />
        <InkMenu<HostTabKey>
          tabs={[{ key: 'upcoming', label: 'Upcoming' }, { key: 'stats', label: 'Stats' }, { key: 'money', label: 'Money' }, { key: 'profile', label: 'Profile' }]}
          selected={tab}
          onSelect={(key) => setTab(key, { replace: true })}
        />
      </View>
      <ScrollView contentContainerStyle={[styles.body, wide && k.wide]}>
        {tab === 'upcoming' ? <UpcomingTab home={home} money={money} open={open} navigate={navigate} />
          : tab === 'stats' ? <StatsTab home={home} money={money} open={open} onMoney={() => setTab('money', { replace: true })} />
            : tab === 'money' ? <MoneyTab home={home} money={money} open={open} />
              : <ProfileTab home={home} navigate={navigate} open={open} goTab={(key) => setTab(key, { replace: true })} onReset={load} />}
      </ScrollView>
    </View>
  );
}

function Loading() { return <View style={styles.centre}><Text style={t.sub}>One moment…</Text></View>; }

function NewOfferButton({ onPress }: { onPress: () => void }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityLabel="New offer" style={styles.newOffer}>
      <Icon name="add" size={17} color={CREAM} strokeWidth={2.4} />
      <Text style={styles.newOfferText}>New offer</Text>
    </Press>
  );
}

// --- SX15 · Upcoming --------------------------------------------------------

type UpRow = { offer: OwnOffer; on: string | null; heads: number; bookings: number; pence: number };

function UpcomingTab({ home, money, open, navigate }: { home: HostHome; money: HostMoney | null; open: (p: Record<string, string | null>) => void; navigate: (to: string) => void }) {
  const today = todayIso();
  // A set-up left part-way (hosting v7, "Save and finish later") is a draft to carry on, not a date coming up.
  const drafts = home.offers.filter((o) => o.lane && o.state === 'draft');
  const rows: UpRow[] = home.offers
    .filter((o) => !(o.lane && o.state === 'draft'))
    .flatMap((offer) => offerDateGroups(offer).filter((g) => !g.on || g.on >= today).map((g) => ({ offer, ...g })))
    .sort((a, z) => (a.on ?? '').localeCompare(z.on ?? ''));
  const dates = rows.length;
  const booked = rows.reduce((n, r) => n + r.heads, 0);
  const collected = rows.reduce((n, r) => n + r.pence, 0);
  const openRow = (r: UpRow) => {
    const single = offerDateGroups(r.offer).filter((g) => !g.on || g.on >= today).length <= 1;
    if (single) navigate(paths.hostOffer(r.offer.id)); else open({ activity: r.offer.id, when: 'upcoming' });
  };
  return (
    // The cells sit 6px under the tab bar (SX15), so no top pad here.
    <View style={[styles.pad, { paddingTop: 0 }]}>
      <SummaryCells cells={[
        { n: String(dates), label: dates === 1 ? 'date' : 'dates' },
        { n: String(booked), label: 'booked' },
        { n: gbp(collected), label: money?.paymentsReady ? 'collected' : 'recorded' },
      ]} />
      {drafts.length ? (
        <>
          <Section title="Drafts" />
          {drafts.map((o) => (
            <Press key={o.id} onPress={() => navigate(o.draftStep === 'publish' ? paths.hostPublish(o.id) : paths.hostSetup(o.id, o.draftStep))} accessibilityRole="button" style={styles.dateRow}>
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <Text style={[t.body, { fontWeight: '600' }]} numberOfLines={1}>{o.title ?? 'Untitled'}</Text>
                <Text style={t.small}>{LANE_TAG[o.lane!]} · carry on</Text>
              </View>
              <Icon name="more" size={18} color={INK} />
            </Press>
          ))}
        </>
      ) : null}
      <Section title="Coming up" />
      {rows.length === 0 ? <Text style={[t.sub, { lineHeight: 20 }]}>Nothing booked yet. New dates and bookings show here.</Text>
        : rows.map((r, i) => {
          const below = r.offer.minCount != null && r.heads < r.offer.minCount;
          return (
            <Press key={i} onPress={() => openRow(r)} accessibilityRole="button" style={styles.dateRow}>
              {r.on ? <DateCol iso={r.on} /> : <View style={{ width: 46 }}><Text style={t.small}>TBC</Text></View>}
              <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={[t.body, { fontWeight: '600', flex: 1 }]} numberOfLines={1}>{r.offer.title ?? 'Untitled'}</Text>
                  <Text style={[t.body, { fontWeight: '800' }]}>{gbp(r.pence)}</Text>
                </View>
                <Text style={t.small}>{[r.offer.startsAt, priceWords(r.offer)].filter(Boolean).join(' · ')}</Text>
                <FillBar value={r.heads} max={r.offer.maxCount} min={r.offer.minCount} below={below} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Text style={t.tiny}>{[`${r.bookings} booked`, r.offer.minCount ? `min ${r.offer.minCount}` : null, r.offer.maxCount ? `max ${r.offer.maxCount}` : null].filter(Boolean).join(' · ')}</Text>
                  {below && r.offer.minCount ? <View style={styles.needs}><Text style={styles.needsText}>NEEDS {r.offer.minCount - r.heads} MORE</Text></View> : null}
                </View>
              </View>
            </Press>
          );
        })}
    </View>
  );
}

// --- SX12 · Stats -----------------------------------------------------------

type Period = 'month' | 'year' | 'all';
function inPeriod(on: string | null, period: Period): boolean {
  if (period === 'all' || !on) return period === 'all';
  const d = new Date(`${on}T12:00:00`); const now = new Date();
  if (period === 'year') return d.getFullYear() === now.getFullYear();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function StatsTab({ home, money, open, onMoney }: { home: HostHome; money: HostMoney | null; open: (p: Record<string, string | null>) => void; onMoney: () => void }) {
  const [period, setPeriod] = useQueryState<Period>('period', 'month', asOneOf(['month', 'year', 'all'] as const, 'month'));
  const today = todayIso();
  const per = home.offers.map((offer) => {
    const groups = offerDateGroups(offer).filter((g) => g.on && g.on < today && inPeriod(g.on, period));
    return { offer, times: groups.length, guests: groups.reduce((n, g) => n + g.heads, 0), pence: groups.reduce((n, g) => n + g.pence, 0) };
  });
  const times = per.reduce((n, p) => n + p.times, 0);
  const guests = per.reduce((n, p) => n + p.guests, 0);
  const collected = per.reduce((n, p) => n + p.pence, 0);
  const left = money ? Math.max(0, money.trusted.completedNeeded - money.trusted.completed) : null;
  const pct = money && money.trusted.completedNeeded ? Math.min(100, Math.round((money.trusted.completed / money.trusted.completedNeeded) * 100)) : 0;
  const trust = home.host?.trust ?? 'verified';

  return (
    <View style={styles.pad}>
      {/* Level block. */}
      <Press onPress={() => open({ level: '1' })} accessibilityRole="button" style={styles.levelBlock}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <View style={styles.levelTile}><Icon name={trust === 'trusted' ? 'trusted' : trust === 'checked' ? 'checked' : 'verified'} size={22} color={trust === 'trusted' ? LIME : INK} strokeWidth={2.2} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.levelKicker}>YOUR LEVEL</Text>
            <Text style={[t.h18, { color: colors.accent }]}>{TRUST_LABEL[trust]}</Text>
          </View>
          <Icon name="more" size={18} color={colors.accent} />
        </View>
        {trust !== 'trusted' ? (
          <View style={{ gap: 5, marginTop: 10 }}>
            <View style={styles.levelTrack}><View style={[styles.levelFill, { width: `${pct}%` as any }]} /></View>
            <Text style={[t.small, { color: colors.accent }]}>{left != null ? `${left} more completed ${left === 1 ? 'experience' : 'experiences'} to Epic Trusted` : 'Progress to Epic Trusted'}</Text>
          </View>
        ) : null}
      </Press>

      {/* Period switch — it changes every figure. */}
      <View style={{ marginTop: 16 }}>
        <Segments<Period>
          value={period}
          options={[{ value: 'month', label: 'This month' }, { value: 'year', label: 'This year' }, { value: 'all', label: 'All time' }]}
          onPick={(v) => setPeriod(v, { replace: true })}
        />
      </View>

      <View>
        <Grid2 cells={[
          { n: String(times), label: 'times hosted' },
          { n: String(guests), label: 'guests' },
          { n: gbp(collected), label: money?.paymentsReady ? 'collected' : 'recorded' },
          { n: '—', label: 'profile views' },
        ]} />
      </View>

      <Section title="Profile views" />
      <Text style={[t.small, { lineHeight: 18 }]}>Profile views aren't tracked yet — this fills in once they are.</Text>

      {/* SX12: four equal, left-aligned columns. */}
      <Section title="By activity" flush />
      {per.filter((p) => p.times > 0).length === 0 ? (
        <>
          <EqualTable head={['Activity', 'Times', 'Guests', money?.paymentsReady ? 'Collected' : 'Recorded']} rows={[]} />
          <Text style={[t.small, { paddingVertical: 10 }]}>Nothing in this period yet.</Text>
        </>
      ) : (
        <EqualTable
          head={['Activity', 'Times', 'Guests', money?.paymentsReady ? 'Collected' : 'Recorded']}
          rows={per.filter((p) => p.times > 0).map((p) => ({
            key: p.offer.id,
            cells: [p.offer.title ?? 'Untitled', String(p.times), String(p.guests), gbp(p.pence)],
            onPress: () => open({ activity: p.offer.id, when: 'past' }),
          }))}
        />
      )}

      <Press onPress={onMoney} accessibilityRole="button" style={{ paddingVertical: 16 }}>
        <Text style={[t.link, { fontSize: 13.5 }]}>Statements and payouts ›</Text>
      </Press>
    </View>
  );
}

// --- SX9 · Money ------------------------------------------------------------

function MoneyTab({ home, money, open }: { home: HostHome; money: HostMoney | null; open: (p: Record<string, string | null>) => void }) {
  if (!money) return <View style={styles.pad}><Text style={t.sub}>One moment…</Text></View>;
  const active = money.activeAccount;
  const feeSummary = `Epic's fee: ${money.feeRate}% · ${money.levelLabel}, ${money.linkRate}% on your own links`;
  return (
    <View style={styles.pad}>
      <View style={styles.payout}>
        <Kicker>Next payout</Kicker>
        {money.nextPayout ? (
          <>
            <Text style={styles.payoutBig}>{gbp(money.nextPayout.amountPence)}</Text>
            <Text style={t.small}>{[money.nextPayout.on, money.nextPayout.account ? `to ${money.nextPayout.account}` : null].filter(Boolean).join(' · ')}</Text>
          </>
        ) : (
          <>
            <Text style={[styles.payoutBig, { fontSize: 24 }]}>No payout yet</Text>
            <Text style={[t.small, { lineHeight: 18 }]}>{money.note}</Text>
          </>
        )}
        <Press onPress={() => open({ level: '1' })} accessibilityRole="button" style={{ marginTop: 8 }}>
          <Text style={[t.small, { lineHeight: 18 }]}>{feeSummary} · <Text style={{ color: colors.accent, fontWeight: '700' }}>See levels</Text></Text>
        </Press>
      </View>

      <View style={{ marginTop: 8 }}>
        <NavRow label="Payout account" value={active ? `${active.label} ••${active.last4}` : 'None yet'} icon="payout" onPress={() => open({ money: 'account' })} />
        <NavRow label="When you're paid" value={scheduleWords(money.paySchedule)} icon="calendar" onPress={() => open({ money: 'schedule' })} />
        <NavRow label="Payout history" icon="list" onPress={() => open({ money: 'history' })} />
        <NavRow label="Tax details" value={money.tax.taxReference ?? 'To complete'} icon="identity" onPress={() => open({ money: 'tax' })} />
        <NavRow label="Yearly statements" icon="download" onPress={() => open({ money: 'statements' })} />
      </View>
    </View>
  );
}

const scheduleWords = (s: HostMoney['paySchedule']) => (s === 'weekday' ? 'Every weekday' : s === 'monthly' ? 'Once a month' : 'Every Friday');

// --- SX8 · Profile ----------------------------------------------------------

function ProfileTab({ home, navigate, open, goTab, onReset }: { home: HostHome; navigate: (to: string) => void; open: (p: Record<string, string | null>) => void; goTab: (k: HostTabKey) => void; onReset: () => Promise<void> }) {
  const h = home.host!;
  const first = h.name.split(/\s+/)[0];
  const lastInitial = h.name.split(/\s+/)[1]?.[0];
  const [stopping, setStopping] = useState(false);
  const [outstanding, setOutstanding] = useState<Outstanding | null>(null);
  const running = h.checks === 'running';

  const outstandingNow = computeOutstanding(home);
  const onStop = () => {
    if (outstandingNow.blocked) { setOutstanding(outstandingNow); return; }
    setStopping(true);
  };

  return (
    <View style={styles.pad}>
      {/* Head. */}
      <View style={styles.profHead}>
        <HostFace host={{ name: h.name, photo: h.photo }} size={72} />
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          <Text style={t.h21} numberOfLines={1}>{first}{lastInitial ? ` ${lastInitial}.` : ''}</Text>
          <Press onPress={() => open({ level: '1' })} accessibilityRole="button" style={styles.chip}>
            <Icon name={h.trust === 'trusted' ? 'trusted' : h.trust === 'checked' ? 'checked' : 'verified'} size={12} color={h.trust === 'trusted' ? LIME : INK} strokeWidth={2.2} />
            <Text style={[styles.chipText, ]}>{running ? 'CHECKS RUNNING' : TRUST_LABEL[h.trust].toUpperCase()}</Text>
          </Press>
          <Press onPress={() => navigate(paths.hostProfile(h.id))} accessibilityRole="button"><Text style={t.link}>See your public profile ›</Text></Press>
        </View>
      </View>

      <Section title="What guests see" />
      <NavRow label="Intro video" value={h.introVideo ? 'Recorded' : 'None yet'} onPress={() => navigate(paths.hostMe())} />
      <NavRow label="Host name" value={h.name} onPress={() => navigate(paths.hostMe())} />
      <NavRow label="Where you host from" value={h.location ?? 'Not set'} onPress={() => navigate(paths.hostMe())} />
      <NavRow label="Languages" value={h.languages?.length ? h.languages.join(', ') : 'Not set'} onPress={() => navigate(paths.hostMe())} />
      <NavRow label="Your skills" value={`${home.offers.length} ${home.offers.length === 1 ? 'offer' : 'offers'}`} onPress={() => open({ skills: '1' })} />

      <Section title="What backs it up" />
      <NavRow label="Qualifications and evidence" value={`${(h.evidence ?? []).length || 'none'}`} onPress={() => open({ evidence: '1' })} />
      <NavRow label="Checks" value={running ? 'In progress' : 'ID verified'} />

      <Press onPress={onStop} accessibilityRole="button" style={styles.stop}>
        <Text style={styles.stopText}>Stop hosting</Text>
      </Press>

      {stopping ? <StopHostingSheet name={first} onReset={onReset} onBlocked={(o) => { setStopping(false); setOutstanding(o); }} onClose={() => setStopping(false)} /> : null}
      {outstanding ? <OutstandingSheet what="stop hosting" outstanding={outstanding} onClose={() => setOutstanding(null)} onSeeUpcoming={() => { setOutstanding(null); goTab('upcoming'); }} /> : null}
    </View>
  );
}

/**
 * Mirrors the server's outstandingFrom: places still held on dates still to
 * come. A waitlisted request holds no place, so it never blocks — the server
 * calls the waitlist off and tells them on the way out (Codex, 2 Oct 2026).
 */
function computeOutstanding(home: HostHome): Outstanding {
  const today = todayIso();
  const held = home.offers.flatMap((o) => o.bookings
    .filter((b) => ['pending', 'confirmed'].includes(b.state))
    .map((b) => ({ o, b, on: dateOf(o, b.occurrence) }))
    .filter((x) => !x.on || x.on >= today));
  const dates = new Set(held.map((x) => `${x.o.id}|${x.b.occurrence ?? ''}`));
  const guests = held.reduce((n, x) => n + (x.b.heads ?? 1), 0);
  return { blocked: held.length > 0, upcomingDates: dates.size, guests, payout: null };
}

function StopHostingSheet({ name, onReset, onBlocked, onClose }: { name: string; onReset: () => Promise<void>; onBlocked: (o: Outstanding) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const stop = async () => {
    setBusy(true);
    try { await api.stopHosting(); showToast('You have stopped hosting'); await onReset(); onClose(); }
    catch (e: any) {
      if (e?.code === 'has_bookings') onBlocked(e.body?.details ?? { blocked: true });
      else showToast(e?.body?.message || 'Could not stop hosting.');
    } finally { setBusy(false); }
  };
  return (
    <Sheet title="Stop hosting?" onCancel={onClose} cancelLabel="Cancel" onClose={onClose}>
      <Text style={t.body}>Your host profile and offers stay as they are until you confirm. Anyone with a place to come must be finished or called off first.</Text>
      <Press onPress={() => void stop()} disabled={busy} accessibilityRole="button" style={styles.stopConfirm}>
        <Text style={styles.stopConfirmText}>{busy ? 'One moment…' : `Stop hosting, ${name}`}</Text>
      </Press>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
  body: { paddingBottom: 48 },
  pad: { paddingHorizontal: 20, paddingTop: 16 },
  newOffer: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 12, backgroundColor: INK },
  newOfferText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: CREAM },
  dateRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  needs: { backgroundColor: colors.surfaceMuted, paddingHorizontal: 7, paddingVertical: 2 },
  needsText: { fontFamily: fonts.body, fontSize: 10, fontWeight: '800', letterSpacing: 0.4, color: colors.accent },
  // Stats level block.
  levelBlock: { backgroundColor: colors.surfaceMuted, padding: 14 },
  levelTile: { width: 44, height: 44, backgroundColor: LIME, alignItems: 'center', justifyContent: 'center' },
  levelKicker: { fontFamily: fonts.body, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.8, color: colors.accent },
  levelTrack: { height: 6, backgroundColor: colors.surface },
  levelFill: { height: 6, backgroundColor: LIME },
  // Money.
  payout: { backgroundColor: colors.surfaceMuted, padding: 16, gap: 2 },
  payoutBig: { fontFamily: fonts.heading, fontSize: 40, fontWeight: '800', letterSpacing: -1, color: colors.ink, lineHeight: 44 },
  // Profile.
  profHead: { flexDirection: 'row', gap: 14, alignItems: 'center', paddingVertical: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", backgroundColor: LIME, paddingHorizontal: 8, paddingVertical: 4 },
  chipText: { fontFamily: fonts.body, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.4, color: INK },
  stop: { paddingVertical: 18, marginTop: 10 },
  stopText: { fontFamily: fonts.body, fontSize: 15.5, fontWeight: '700', color: colors.overrun },
  stopConfirm: { height: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overrun },
  stopConfirmText: { fontFamily: fonts.body, fontSize: 15.5, fontWeight: '700', color: CREAM },
});
