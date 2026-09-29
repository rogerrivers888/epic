/**
 * A place's open status on a back-office record (decision C57, item 5: "Show
 * the status on the place record, with the reason and source").
 *
 * One row in the record's own fact style: the status, then reason · source,
 * then the evidence as it was read — a Wikidata property, an OSM tag, a quote
 * — and the successor where there is one. The back office always sees the
 * place, whatever families are shown; "Hidden" says when they are not.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api, PlaceOpenStatus } from '../api';
import { colors, spacing, type } from '../theme';
import { Row } from '../components/ui';
import { Pill, Tone } from './kit';

export const OPEN_WORD: Record<PlaceOpenStatus['status'], string> = {
  open: 'Open',
  temporarily_closed: 'Temporarily closed',
  permanently_closed: 'Permanently closed',
  unknown: 'Unknown',
};
const TONE: Record<PlaceOpenStatus['status'], Tone> = {
  open: 'ok', temporarily_closed: 'warn', permanently_closed: 'crit', unknown: 'plain',
};
const SOURCE_WORD: Record<string, string> = {
  wikidata: 'Wikidata', osm: 'OpenStreetMap', wikipedia: 'Wikipedia', listing: 'Listing', google: "Google's status", person: 'A person',
};

export function OpenStatusFact({ refId, atlasId, wikidataId }: { refId?: string | null; atlasId?: string | null; wikidataId?: string | null }) {
  const [row, setRow] = useState<PlaceOpenStatus | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setRow(undefined); setFailed(false);
    api.closedPlace({ ref: refId ?? undefined, atlas: atlasId ?? undefined, wikidata: wikidataId ?? undefined })
      .then((r) => { if (live) setRow(r.status); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [refId, atlasId, wikidataId]);

  return (
    <View style={styles.fact}>
      <Text style={styles.factKey}>Open status</Text>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        {failed ? <Text style={[type.small, { color: colors.overrun }]}>Could not read it.</Text>
          : row === undefined ? <Text style={type.tiny}>Reading…</Text>
            : row === null ? <Text style={type.small}>Unknown · not checked</Text>
              : (
                <>
                  <Row style={{ gap: spacing.xs, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Pill label={OPEN_WORD[row.status]} tone={TONE[row.status]} />
                    {!row.confirmed ? <Pill label="Unconfirmed" tone="warn" /> : null}
                    {row.review ? <Pill label="For review" tone="accent" /> : null}
                    {row.hidden ? <Pill label="Hidden from families" tone="crit" />
                      : (row.status !== 'open' && row.status !== 'unknown') || !row.confirmed ? <Pill label="Not applied" tone="plain" /> : null}
                  </Row>
                  <Text style={type.tiny}>
                    {[row.reason, row.source ? SOURCE_WORD[row.source] ?? row.source : null, row.confirmedBy ? `confirmed by ${row.confirmedBy}` : null].filter(Boolean).join(' · ')}
                  </Text>
                  {row.evidence ? <Text style={type.tiny} numberOfLines={3}>{row.evidence}</Text> : null}
                  {row.successor?.name ? <Text style={[type.small, { fontWeight: '700' }]}>Now: {row.successor.name}</Text> : null}
                </>
              )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fact: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start',
    paddingVertical: 13, borderTopWidth: 1, borderTopColor: colors.lineSoft,
  },
  factKey: { ...type.small, fontSize: 12.5, fontWeight: '600', color: colors.inkMuted, width: 84, paddingTop: 2 },
});
