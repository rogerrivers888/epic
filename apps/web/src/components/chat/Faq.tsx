import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Press } from '../press';
import { api, FaqEntry } from '../../api';
import { colors, fonts, ON_LIME, TARGET } from '../../theme';
import { Icon } from '../Icon';

/**
 * The FAQ on the listing (C7): what people actually asked, answered by the
 * host in their own words, with how many times it came up. The payoff of the
 * whole module — an answered public question is an asset that outlives the
 * booking, and it is better sales copy than anything a host writes unprompted.
 *
 * Public, like the listing. Every entry is either a question that was public
 * to begin with or one its asker agreed to publish, and the text is the
 * host's answer to a normalised question — never the guest's own wording.
 */
export function Faq({ offerId, hostName, onAsk }: { offerId: string; hostName: string; onAsk: () => void }) {
  const [faq, setFaq] = useState<FaqEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    api.experienceFaq(offerId).then((r) => { if (live) setFaq(r.faq); }).catch(() => { if (live) setFaq([]); });
    return () => { live = false; };
  }, [offerId]);
  const first = hostName.split(/\s+/)[0];
  return (
    <View style={styles.block}>
      {faq?.length ? (
        <>
          <View style={styles.banner}>
            <Icon name="faq" size={18} color={ON_LIME} strokeWidth={2} />
            <Text style={styles.bannerText}><Text style={{ fontWeight: '800' }}>What people have asked {first}.</Text> Answered by {pronoun(hostName)}, not by us.</Text>
          </View>
          {faq.map((e) => (
            <View key={e.id} style={styles.entry}>
              <View style={styles.qRow}>
                <Text style={styles.qMark}>?</Text>
                <Text style={styles.q}>{e.question}</Text>
              </View>
              <Text style={styles.a}>{e.answer}</Text>
              <Text style={styles.asked}>{`Asked ${e.askCount === 1 ? 'once' : `${e.askCount} times`}`}{e.askedBy ? ` · ${e.askedBy}` : ''}</Text>
            </View>
          ))}
        </>
      ) : null}
      <Press onPress={onAsk} accessibilityRole="button" style={styles.askRow}>
        <Text style={styles.qMark}>?</Text>
        <Text style={styles.askText}>{faq?.length ? `Ask ${first} something else` : `Ask ${first} something`}</Text>
        <Icon name="more" size={16} color={colors.inkMuted} />
      </Press>
      <Text style={styles.note}>You do not have to book first. Your question goes to {first} privately unless you are booked on.</Text>
    </View>
  );
}

const pronoun = (_name: string) => 'them';

const styles = StyleSheet.create({
  block: { marginTop: 20, gap: 4 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.lime, padding: 12, marginBottom: 6 },
  bannerText: { flex: 1, fontFamily: fonts.body, fontSize: 13.5, color: ON_LIME, lineHeight: 19 },
  entry: { paddingVertical: 12, gap: 6, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  qRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  qMark: { width: 16, fontFamily: fonts.heading, fontSize: 14, fontWeight: '800', color: colors.accent, lineHeight: 20 },
  q: { flex: 1, fontFamily: fonts.heading, fontSize: 15, fontWeight: '800', letterSpacing: -0.2, lineHeight: 20, color: colors.ink },
  a: { fontFamily: fonts.body, fontSize: 14, color: colors.ink, lineHeight: 20, paddingLeft: 26 },
  asked: { fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: colors.accent, paddingLeft: 26 },
  askRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: TARGET, paddingVertical: 6 },
  askText: { flex: 1, fontFamily: fonts.heading, fontSize: 15, fontWeight: '800', color: colors.ink },
  note: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkMuted, lineHeight: 18 },
});
