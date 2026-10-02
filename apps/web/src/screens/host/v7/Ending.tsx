/**
 * The endings (hosting v7; prototype lines 337–347, SH-E1–E3):
 *   private, sent      "Invites are out." and how many are on their way
 *   public, in review  "Sent for review." and when Epic answers
 *   public, live       "It’s live."
 * Then the offer's row, what is still to do (public: Checked before it goes
 * live, tax details before the first payout — each opens its sheet here), the
 * invite link for a private one, "See the page guests see" and "Back to Host".
 *
 *   /host/offers/<id>/done            the ending
 *   …?sheet=checked|tax               a still-to-do sheet over it
 *   …?preview=1                       the guest page
 */

import { mediaUrl } from '../../../components/hosting';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '../../../components/press';
import { api, ApiError } from '../../../api';
import { useRouter } from '../../../router';
import { paths } from '../../../routes';
import { useViewport } from '../../../hooks/useViewport';
import { CREAM, HAIRLINE, INACTIVE, INK_MUTED, LIME } from '../../../theme';
import { ActionBar, Kicker, LinkBlock, Tick, hx, pointer, tx, v } from './kit';
import { LANES, gbp, type LaneHome, type LaneOffer } from './model';
import { PublishSheet } from './Sheets';
import { Preview } from './Preview';

export function Ending({ offerId }: { offerId: string }) {
  const { navigate, query, setQuery, back } = useRouter();
  const { width } = useViewport();
  const wide = width >= 900;
  const [offer, setOffer] = useState<LaneOffer | null>(null);
  const [home, setHome] = useState<LaneHome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sheetParam = query.get('sheet');
  const sheet = sheetParam === 'checked' || sheetParam === 'tax' ? sheetParam : null;
  const previewing = query.get('preview') === '1';

  const reload = useCallback(async (next?: LaneOffer) => {
    const [o, h] = await Promise.all([next ? Promise.resolve({ offer: next }) : api.laneOffer(offerId), api.laneHome()]);
    // Still a draft: its checklist is where it lives.
    if (o.offer.state === 'draft') { navigate(paths.hostPublish(o.offer.id), { replace: true }); return; }
    setOffer(o.offer); setHome(h);
  }, [offerId, navigate]);
  useEffect(() => {
    reload().catch((e) => setError(e instanceof ApiError && e.status === 404 ? 'That one isn’t yours.' : e.message));
  }, [reload]);

  const openedHere = useRef(false);
  const openSheet = (k: 'checked' | 'tax') => { openedHere.current = true; setQuery({ sheet: k }, { replace: false }); };
  const closeSheet = () => {
    if (openedHere.current) { openedHere.current = false; back(paths.hostDone(offerId)); }
    else setQuery({ sheet: null }, { replace: true });
  };

  if (error && !offer) return <View style={styles.centre}><Text style={tx(14, '400')}>{error}</Text></View>;
  if (!offer || !home) return <View style={styles.centre}><Text style={tx(14, '400')}>One moment…</Text></View>;

  const cfg = home.config;
  const look = LANES[offer.lane];
  const pub = offer.visibility === 'public';
  const invited = offer.invites.reduce((n, i) => n + (i.heads || 1), 0);

  const big = pub ? (offer.state === 'in_review' ? 'Sent for review.' : 'It’s live.') : 'Invites are out.';
  const sub = pub
    ? (offer.state === 'in_review' ? `Back to you within ${cfg.reviewHours} hours` : 'People can book from today')
    : invited === 0 ? 'Share the invite link to ask people'
      : invited === 1 ? '1 text or email on its way' : `${invited} texts and emails on their way`;
  const fee = home.isPro || offer.privateFeeState === 'included' ? 'Included in Pro'
    : offer.privateFeeState === 'paid' ? `${gbp(cfg.privateEventPence)} paid` : null;
  const meta = pub ? `${look.tag} · public · ${offer.state === 'in_review' ? 'in review' : 'live'}` : [look.tag, 'private', fee].filter(Boolean).join(' · ');
  const stillToDo = pub ? offer.checklist.filter((i) => (i.key === 'checked' || i.key === 'tax') && !i.done) : [];
  const thumb = mediaUrl(offer.photos?.[0]?.url ?? null);

  return (
    <View style={[styles.page, wide && styles.wide]}>
      <View style={styles.band}>
        <Text style={hx(30, -0.04, 1)}>{big}</Text>
        <Text style={tx(14, '600')}>{sub}</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body}>
        <View style={styles.offerRow}>
          <View style={styles.thumb}>{thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}</View>
          <View style={{ flex: 1 }}>
            <Text style={tx(14.5, '700')} numberOfLines={2}>{offer.title ?? offer.whatLabel ?? look.tag}</Text>
            <Text style={tx(12, '400', INK_MUTED, { marginTop: 2 })}>{meta}</Text>
          </View>
        </View>

        {stillToDo.length ? (
          <>
            <Kicker>Still to do</Kicker>
            <View style={v.list}>
              {stillToDo.map((it) => {
                const can = !(it.key === 'checked' && it.submitted);
                const row = (
                  <>
                    <Tick on={false} />
                    <View style={{ flex: 1 }}>
                      <Text style={tx(14.5, '700')}>{it.t}</Text>
                      <Text style={tx(12, '400', INK_MUTED)}>{it.key === 'checked' && !it.submitted ? 'DBS, insurance, references' : it.s}</Text>
                    </View>
                  </>
                );
                return can
                  ? <Press key={it.key} onPress={() => openSheet(it.key as 'checked' | 'tax')} accessibilityRole="button" accessibilityLabel={it.t} style={[styles.item, pointer]}>{row}</Press>
                  : <View key={it.key} style={styles.item}>{row}</View>;
              })}
            </View>
          </>
        ) : null}

        {!pub ? <LinkBlock label="Invite link" url={offer.inviteUrl} /> : offer.state === 'live' ? <LinkBlock label="Link to the page" url={offer.pageUrl} /> : null}

        <Press onPress={() => setQuery({ preview: '1' }, { replace: false })} accessibilityRole="button" style={[{ alignSelf: 'flex-start' }, pointer]}>
          <Text style={[v.link, { fontWeight: '700' }]}>See the page guests see</Text>
        </Press>
      </ScrollView>

      <ActionBar label="Back to Host" onPress={() => navigate(paths.host())} />

      {sheet ? <PublishSheet kind={sheet} offer={offer} home={home} onClose={closeSheet} onChanged={(next) => reload(next)} /> : null}
      {previewing ? <Preview offer={offer} lane={offer.lane} config={cfg} home={home} step="done" onClose={() => back(paths.hostDone(offer.id))} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: CREAM },
  wide: { maxWidth: 560, width: '100%', alignSelf: 'center' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: CREAM },
  band: { backgroundColor: LIME, paddingTop: 24, paddingHorizontal: 20, paddingBottom: 18, gap: 4 },
  body: { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  offerRow: { flexDirection: 'row', gap: 11, alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  thumb: { width: 48, height: 48, borderRadius: 8, overflow: 'hidden', backgroundColor: INACTIVE },
  item: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
});
