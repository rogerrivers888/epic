/**
 * The publish checklist (hosting v7; prototype lines 314–323, SH-G1–G3,
 * N1-F2/F5): what is left before the invites go or the offer goes for review.
 *
 * The address decides what is drawn (§13.14):
 *   /host/offers/<id>/publish                  the checklist
 *   …?sheet=profile|phone|payouts|tax|checked|video|verify|charges   a sheet over it
 *   …?preview=1                                the guest page as it stands
 *   …?back=payouts|verified|paid               just back from Stripe: read what it says now
 *
 * The items, what each blocks and the button's words are the server's
 * (`offer.checklist`, `offer.blockers`, `offer.action`) — a tick is a fact
 * read from the host, the account and the offer, never one the screen sets.
 * The only thing chosen here is the private plan (this event, or Pro), sent
 * with the publish.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '../../../components/press';
import { Icon } from '../../../components/Icon';
import { showToast } from '../../../components/Toast';
import { api, ApiError } from '../../../api';
import { useRouter } from '../../../router';
import { paths } from '../../../routes';
import { useViewport } from '../../../hooks/useViewport';
import { CREAM, HAIRLINE, INK, INK_MUTED, LIME, LIME_TINT, MOSS, TICK_EDGE, fonts } from '../../../theme';
import { Note, Tick, hx, pointer, tx, v } from './kit';
import { LANES, gbp, type CheckItem, type LaneHome, type LaneOffer } from './model';
import { PublishSheet, SHEET_KINDS, type SheetKind } from './Sheets';
import { mmss } from './VideoSheet';
import { Preview } from './Preview';

type Plan = 'event' | 'pro';

export function Publish({ offerId }: { offerId: string }) {
  const { navigate, query, setQuery, back } = useRouter();
  const { width } = useViewport();
  const wide = width >= 900;
  const [offer, setOffer] = useState<LaneOffer | null>(null);
  const [home, setHome] = useState<LaneHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);

  const sheetParam = query.get('sheet');
  const sheet: SheetKind | null = sheetParam && (SHEET_KINDS as string[]).includes(sheetParam) ? (sheetParam as SheetKind) : null;
  const previewing = query.get('preview') === '1';
  const backFrom = query.get('back');

  // --- loading ---------------------------------------------------------------
  const take = useCallback((o: LaneOffer) => {
    if (o.state !== 'draft') { navigate(paths.hostDone(o.id), { replace: true }); return false; }
    setOffer(o);
    return true;
  }, [navigate]);

  const reload = useCallback(async (next?: LaneOffer) => {
    const [o, h] = await Promise.all([next ? Promise.resolve({ offer: next }) : api.laneOffer(offerId), api.laneHome()]);
    setHome(h);
    take(o.offer);
  }, [offerId, take]);

  useEffect(() => {
    reload().catch((e) => setError(e instanceof ApiError && e.status === 404 ? 'That draft isn’t one of yours.' : e.message));
  }, [reload]);

  // --- publishing ------------------------------------------------------------
  const publishing = useRef(false);
  const publish = useCallback(async (o: LaneOffer, chosen: Plan | undefined) => {
    if (publishing.current) return;
    publishing.current = true;
    setBusy(true);
    try {
      const r = await api.lanePublish(o.id, o.visibility === 'public' ? undefined : chosen);
      if (r.pay?.url) { window.location.assign(r.pay.url); return; }
      navigate(paths.hostDone(o.id), { replace: true });
    } catch (e: any) {
      showToast(e.message);
      api.laneOffer(o.id).then((r) => take(r.offer)).catch(() => null);
    } finally { publishing.current = false; setBusy(false); }
  }, [navigate, take]);

  // --- back from Stripe: read it once, then take `back` off the address -------
  const synced = useRef<string | null>(null);
  useEffect(() => {
    if (!backFrom || synced.current === backFrom) return;
    synced.current = backFrom;
    (async () => {
      try {
        const r = await api.laneSync(offerId);
        const h = await api.laneHome();
        setHome(h);
        setQuery({ back: null }, { replace: true });
        if (!take(r.offer)) return;
        if (backFrom === 'paid' && (r.offer.privateFeeState === 'paid' || r.offer.privateFeeState === 'included')) await publish(r.offer, undefined);
      } catch (e: any) { showToast(e.message); setQuery({ back: null }, { replace: true }); }
    })();
  }, [backFrom]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- sheets ----------------------------------------------------------------
  const openedHere = useRef(false);
  const openSheet = (k: SheetKind) => { openedHere.current = true; setQuery({ sheet: k }, { replace: false }); };
  const closeSheet = () => {
    if (openedHere.current) { openedHere.current = false; back(paths.hostPublish(offerId)); }
    else setQuery({ sheet: null }, { replace: true });
  };

  if (error && !offer) return <View style={styles.centre}><Text style={tx(14, '400')}>{error}</Text></View>;
  if (!offer || !home) return <View style={styles.centre}><Text style={tx(14, '400')}>One moment…</Text></View>;

  const cfg = home.config;
  const look = LANES[offer.lane];
  const pub = offer.visibility === 'public';
  const steps = offer.steps?.length ? offer.steps : [];
  const counted = offer.checklist.filter((i) => !i.info);
  const doneCount = counted.filter((i) => i.done).length;

  // The plan: Pro subscribers and paid fees choose nothing.
  const feeDone = home.isPro || offer.privateFeeState === 'paid' || offer.privateFeeState === 'included' || offer.action.key === 'send';
  const showPlan = !pub && !feeDone;
  const chosen: Plan = plan ?? offer.privatePlan ?? 'event';
  const label = pub ? offer.action.label
    : feeDone ? 'Send the invites'
      : chosen === 'pro' ? 'Join Pro · send the invites' : `Pay ${gbp(cfg.privateEventPence)} · send the invites`;

  const chargeWords = pub ? offer.charges.words
    : `${home.isPro || (showPlan && chosen === 'pro') || offer.privateFeeState === 'included' ? 'Included in Pro' : `${gbp(cfg.privateEventPence)} for this event`}${offer.throughEpic ? ` · ${cfg.privateCollectPct}% of what you collect` : ''}`;

  // Stripe is needed for a paid-through-Epic offer, a private fee still to pay, or the public ID check.
  const needsStripe = offer.throughEpic || showPlan || (pub && offer.action.key === 'verify');
  const stripeNote = !needsStripe ? null : !cfg.stripe.ready ? 'Card payments aren’t switched on yet.' : cfg.stripe.mode === 'test' ? 'Payments are in test mode until Epic switches them on.' : null;

  const verifying = offer.action.key === 'verify';
  const dim = offer.blockers.length > 0 && !verifying;

  /** Where an item goes when it is tapped (null: nowhere). */
  const goFor = (it: CheckItem): (() => void) | null => {
    switch (it.key) {
      case 'email': return it.done ? null : () => navigate('/settings');
      case 'phone': return () => openSheet('phone');
      case 'profile': return () => openSheet('profile');
      case 'verified': return it.done ? null : () => openSheet('verify');
      case 'video': return () => openSheet('video');
      case 'checked': return it.done || it.submitted ? null : () => openSheet('checked');
      case 'payouts': return it.done ? null : () => openSheet('payouts');
      case 'tax': return () => openSheet('tax');
      default: return null;
    }
  };

  const words = (it: CheckItem): { t: string; s: string } => {
    if (it.key === 'video') {
      const t = pub ? it.t : 'Offer video · optional';
      if (!it.done) return { t, s: pub ? it.s : 'Guests see it on the invite' };
      if (offer.video.madeBy === 'epic') return { t, s: pub ? `Made by Epic · with ${mmss(offer.video.helloSeconds ?? cfg.videoSeconds.hello)} of you` : 'Made by Epic' };
      return { t, s: offer.video.seconds ? `Recorded · ${mmss(offer.video.seconds)}` : 'Recorded' };
    }
    if (it.key === 'email' && !it.done) return { t: it.t, s: 'Add your email · in Settings' };
    return { t: it.t, s: it.s };
  };

  const press = () => {
    if (busy) return;
    if (verifying) { openSheet('verify'); return; }
    if (offer.blockers.length) {
      const first = offer.checklist.find((i) => i.key === offer.blockers[0]);
      const go = first ? goFor(first) : null;
      if (go) go(); else showToast('Finish the list first.');
      return;
    }
    void publish(offer, showPlan ? chosen : undefined);
  };

  return (
    <View style={[styles.page, wide && styles.wide]}>
      {/* The step header, every bar reached. */}
      <View style={{ backgroundColor: look.bg }}>
        <View style={styles.headRow}>
          <Press onPress={() => back(paths.hostSetup(offer.id, steps[steps.length - 1] ?? 'who'))} accessibilityRole="button" accessibilityLabel="Back" style={[{ paddingVertical: 4 }, pointer]}>
            <Icon name="previous" size={22} color={look.fg} strokeWidth={2} />
          </Press>
          <View style={styles.tag}><Text style={styles.tagText}>{look.tag}</Text></View>
          <View style={{ flex: 1 }} />
          <Press onPress={() => setQuery({ preview: '1' }, { replace: false })} accessibilityRole="button" accessibilityLabel="Preview"
            style={[styles.preview, { backgroundColor: look.chip }, pointer]}>
            <Icon name="preview" size={15} color={look.fg} strokeWidth={2} />
            <Text style={tx(13, '700', look.fg)}>Preview</Text>
          </Press>
        </View>
        <View style={styles.bars}>
          {(steps.length ? steps : ['x']).map((k) => <View key={k} style={[styles.bar, { backgroundColor: look.fg }]} />)}
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={v.title}>{pub ? 'Before it goes live' : 'Before the invites go'}</Text>
        <Text style={[tx(12.5, '400', INK_MUTED), { marginTop: -6 }]}>{pub ? 'Public' : 'Private'} · {offer.paid ? 'paid' : 'free'} · {doneCount} of {counted.length} done</Text>

        <View style={v.list}>
          {offer.checklist.map((it) => {
            const go = goFor(it);
            const w = words(it);
            const row = (
              <>
                <Tick on={it.done} />
                <View style={{ flex: 1 }}>
                  <Text style={tx(14.5, '700', it.done ? INK_MUTED : INK)}>{w.t}</Text>
                  <Text style={tx(12, '400', INK_MUTED)}>{w.s}</Text>
                </View>
              </>
            );
            return go
              ? <Press key={it.key} onPress={go} accessibilityRole="button" accessibilityLabel={w.t} style={[styles.item, pointer]}>{row}</Press>
              : <View key={it.key} style={styles.item}>{row}</View>;
          })}
        </View>

        {showPlan ? (
          <>
            <PlanRow on={chosen === 'event'} onPick={() => setPlan('event')} t="This event" s="One-off" p={gbp(cfg.privateEventPence)} />
            <PlanRow on={chosen === 'pro'} onPick={() => setPlan('pro')} t="Included in Pro" s="Every private event · Epic Pro" p={`${gbp(cfg.proMonthlyPence)}/mo`} />
          </>
        ) : null}

        <View style={styles.charges}>
          <Text style={[tx(13.5, '600'), { flex: 1 }]}>{chargeWords}</Text>
          <Press onPress={() => openSheet('charges')} accessibilityRole="button" style={pointer}><Text style={tx(13.5, '700', MOSS)}>How charges work</Text></Press>
        </View>

        {stripeNote ? <Note>{stripeNote}</Note> : null}
      </ScrollView>

      {/* The bar: dimmed while something blocks it, and pressing it then opens what is missing. */}
      <View style={styles.foot}>
        <Press onPress={() => navigate(paths.host())} accessibilityRole="button" style={[{ paddingVertical: 4, alignSelf: 'flex-start' }, pointer]}><Text style={v.link}>Save and finish later</Text></Press>
        <Press onPress={press} accessibilityRole="button" accessibilityState={{ disabled: dim || busy }}
          style={[styles.cta, { opacity: dim ? 0.35 : 1 }, pointer]}>
          <Text style={tx(15, '700', CREAM)}>{busy ? 'One moment…' : label}</Text>
          <Icon name="forward" size={18} color={CREAM} strokeWidth={2.2} />
        </Press>
      </View>

      {sheet ? <PublishSheet kind={sheet} offer={offer} home={home} onClose={closeSheet} onChanged={(next) => reload(next)} /> : null}
      {previewing ? <Preview offer={offer} lane={offer.lane} config={cfg} home={home} step="publish" onClose={() => back(paths.hostPublish(offer.id))} /> : null}
    </View>
  );
}

/** A plan option (prototype G.pay): the tick at the left, the price at the right. */
function PlanRow({ on, onPick, t, s, p }: { on: boolean; onPick: () => void; t: string; s: string; p: string }) {
  return (
    <Press onPress={onPick} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={t}
      style={[styles.plan, { backgroundColor: on ? LIME_TINT : CREAM }, pointer]}>
      <View style={{ width: 22, height: 22, backgroundColor: on ? LIME : CREAM, borderWidth: 1, borderColor: on ? LIME : TICK_EDGE }} />
      <View style={{ flex: 1 }}>
        <Text style={tx(15, '700')}>{t}</Text>
        <Text style={tx(12.5, '400', INK_MUTED)}>{s}</Text>
      </View>
      <Text style={hx(19, -0.02, 1.2)}>{p}</Text>
    </Press>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: CREAM },
  wide: { maxWidth: 560, width: '100%', alignSelf: 'center' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: CREAM },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 12, paddingHorizontal: 20 },
  tag: { backgroundColor: LIME, paddingVertical: 3, paddingHorizontal: 7 },
  tagText: { fontFamily: fonts.heading, fontSize: 13, fontWeight: '800', color: INK },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 11 },
  bars: { flexDirection: 'row', gap: 4, paddingTop: 14, paddingHorizontal: 20, paddingBottom: 14 },
  bar: { flex: 1, height: 3 },
  body: { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  item: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  plan: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 13, paddingHorizontal: 14, borderWidth: 1, borderColor: HAIRLINE },
  charges: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, paddingVertical: 6 },
  foot: { paddingTop: 10, paddingHorizontal: 20, paddingBottom: 14, gap: 6, backgroundColor: CREAM },
  cta: { height: 48, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: INK },
});
