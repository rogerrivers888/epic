/**
 * The C30/C61 review queue (owner, 2 Oct 2026).
 *
 * The concrete features Google review-spotting raised from the reviews a back
 * office search already fetched — spend-free, our own derived output. Each row is
 * a feature with how many places mention it and an example of the drawer it was
 * seen in; the owner approves it into a fact (then it is verified from owned
 * sources, C33/C35) or ignores it for good. A feature already in our fact list is
 * shown as a verification suggestion rather than something new to approve.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { api, ReviewFeature } from '../../api';
import { colors, spacing, type, BORDER } from '../../theme';
import { useViewport } from '../../hooks/useViewport';
import { AdminPage } from '../kit';
import { Act, Kicker, Word } from '../table';

const drawerWord = (s: string | null) => (s ? s.replace(/-/g, ' ') : '—');

export function ReviewQueue({ canManage }: { canManage: boolean }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminReviewQueue>> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const { width } = useViewport();
  const narrow = width < 760;

  const load = useCallback(() => {
    setData(null);
    api.adminReviewQueue({ limit: 200 }).then(setData).catch(() => setData({ features: [], newCount: 0, knownCount: 0 }));
  }, []);
  useEffect(load, [load]);

  const decide = (f: ReviewFeature, how: 'approve' | 'ignore') => {
    if (!canManage || busy) return;
    setBusy(f.norm); setSaid(null);
    const run: Promise<{ waiting?: string[]; blocked?: { setKey: string; ignoredIn: string[] }[] }> = how === 'approve'
      ? api.adminApproveFeature(f.norm)
      : api.adminIgnoreFeature(f.norm).then(() => ({}));
    Promise.resolve(run)
      .then((res) => {
        // A feature that is already one of our facts is dismissed, not retired.
        if (how === 'ignore') { setSaid(f.known ? `Dismissed “${f.raw}” — still one of our facts.` : `Ignored “${f.raw}”.`); return; }
        // A drawer with no question set yet is asked once a set is attached to it.
        const later = res?.waiting?.length ? ` Asked in ${res.waiting.map(drawerWord).join(', ')} once a set is attached.` : '';
        // A set shared with a drawer that ignored the word is not asked — the ignore stands.
        const held = res?.blocked?.length
          ? ` Not asked in ${res.blocked.map((b) => drawerWord(b.setKey)).join(', ')}: ${res.blocked.flatMap((b) => b.ignoredIn).map(drawerWord).join(', ')} ignored it.`
          : '';
        setSaid(f.known
          ? `Asked “${f.raw}” here — verified from owned sources.${later}${held}`
          : `Approved “${f.raw}” — now a fact, verified from owned sources.${later}${held}`);
      })
      .catch((e: any) => setSaid(e?.body?.message ?? 'That could not be done.'))
      .finally(() => { setBusy(null); load(); });
  };

  if (!data) return <AdminPage><View style={styles.waiting}><ActivityIndicator color={colors.accent} /></View></AdminPage>;

  return (
    <AdminPage>
      <Kicker>Review queue</Kicker>
      <Text style={styles.title}>Features from Google reviews</Text>
      <Text style={styles.sub}>
        {`${data.newCount} new to approve · ${data.knownCount} already facts · spotted free from searches, never from Google's words`}
      </Text>
      {said ? <Text style={styles.said}>{said}</Text> : null}

      {data.features.length === 0 ? (
        <Word muted>Nothing spotted yet — features appear here as back-office searches read Google reviews.</Word>
      ) : (
        <View style={styles.list}>
          {data.features.map((f) => (
            <View key={f.norm} style={[styles.row, narrow && styles.rowPhone]}>
              <View style={styles.what}>
                <Text style={styles.name}>{f.raw}</Text>
                <Text style={styles.meta}>
                  {`${f.places} ${f.places === 1 ? 'place' : 'places'} · ${drawerWord(f.exampleSubcategory)}`}
                  {f.known ? ' · already one of our facts' : f.mostlyAgainst ? ' · mostly mentioned as absent' : ''}
                </Text>
              </View>
              <View style={styles.acts}>
                <Act label={busy === f.norm ? 'Approving…' : f.known ? 'Ask here' : 'Approve'} small disabled={!canManage || busy != null} onPress={() => decide(f, 'approve')} />
                <Act label={f.known ? 'Dismiss' : 'Ignore'} tone="secondary" small disabled={!canManage || busy != null} onPress={() => decide(f, 'ignore')} />
              </View>
            </View>
          ))}
        </View>
      )}
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  waiting: { paddingVertical: spacing.xl, alignItems: 'flex-start' },
  title: { ...type.h2, color: colors.ink, marginTop: spacing.xs },
  sub: { ...type.small, color: colors.inkMuted, marginTop: spacing.xs, marginBottom: spacing.md },
  said: { ...type.small, color: colors.accent, marginBottom: spacing.sm },
  list: { borderTopWidth: BORDER, borderTopColor: colors.ink },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: BORDER, borderBottomColor: colors.line },
  rowPhone: { flexDirection: 'column', alignItems: 'flex-start' },
  what: { flex: 1, minWidth: 0 },
  name: { ...type.body, color: colors.ink },
  meta: { ...type.tiny, color: colors.inkMuted, marginTop: 2 },
  acts: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
