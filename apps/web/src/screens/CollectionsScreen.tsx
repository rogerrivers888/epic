import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, type } from '../theme';
import { useViewport } from '../hooks/useViewport';
import { useRouter } from '../router';
import { paths, withQuery } from '../routes';
import { ScreenTop } from '../components/InspireHeader';
import { CrumbHead } from '../components/ControlRow';
import { CollectionRowView, useCollections, WhoseList } from '../components/CollectionRows';

/**
 * Every collection this household can heart — the prototype's "Rows" phone
 * (Epic Labelling prototype, See as a household › The list / First heart /
 * Waiting row). `/inspire/collections`.
 *
 * Inspire shows the hearted rows and a few more; this is where the rest are
 * found and hearted. Library order, as the API sends it (`list`): a hearted
 * row that has nothing near this week waits here, marked, rather than
 * showing an empty shelf, and comes back when there is.
 */
export function CollectionsScreen() {
  const { width } = useViewport();
  const wide = width >= 900;
  const { back, navigate } = useRouter();
  const coll = useCollections();
  const data = coll.data;
  return (
    <View style={styles.fill}>
      {/* One tree for both widths: the column narrows, nothing else changes. */}
      <View style={[wide && styles.wide]}>
        <ScreenTop>{null}</ScreenTop>
        <CrumbHead
          onBack={() => back(paths.inspire())}
          backLabel="Inspire"
          title="Collections"
          aside={data?.whose ? `${data.whose.name}’s hearts` : null}
        />
      </View>
      <ScrollView contentContainerStyle={[styles.body, wide && styles.wide]}>
        {coll.asking && data ? <WhoseList members={data.members} onChoose={coll.choose} /> : null}
        {!data && !coll.error ? (
          <View style={styles.waiting}><ActivityIndicator color={colors.icon} /></View>
        ) : null}
        {coll.error ? <Text style={[type.small, styles.gutter]}>{coll.error}</Text> : null}
        {data && !data.reach ? (
          <Text style={[type.small, styles.gutter]}>Set your home in Settings and Epic can say which of these are near you.</Text>
        ) : null}
        {data?.reach && !data.list.length ? (
          <Text style={[type.small, styles.gutter]}>Nothing near home to show yet.</Text>
        ) : null}
        {data?.list.map((r) => (
          <CollectionRowView
            key={r.key}
            row={r}
            wide={wide}
            onHeart={coll.heart}
            onOpenPlace={(p) => navigate(withQuery(paths.inspire(), { place: p.ref }))}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  body: { paddingBottom: spacing.xxl },
  wide: { maxWidth: 1120, width: '100%', alignSelf: 'center' },
  gutter: { paddingHorizontal: 18, paddingVertical: spacing.md },
  waiting: { alignItems: 'center', paddingVertical: spacing.xl },
});
