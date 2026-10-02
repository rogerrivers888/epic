/**
 * The legal documents' Markdown, drawn in the site's type (LegalPage).
 *
 * Only what the legal pack uses: `###` headings (each an <h2>), paragraphs,
 * `- ` lists, `| … |` tables (the first row is the header; the `---` row is
 * skipped), and **bold** / *italic* inside a line. Tables become rows of label
 * and value on a phone, where three columns of a privacy table do not fit 390px.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { HAIRLINE, INK, fonts } from '../../../theme';
import { useViewport } from '../../../hooks/useViewport';
import { SiteH2, SiteP } from '../../type';
import { parseLegal } from './legalParse';

/** **bold** and *italic* inside one line. */
function Inline({ text }: { text: string }) {
  // `\*` is a literal star (a family of names, epic.voice.*), never emphasis.
  const STAR = '\u0000';
  const plain = (t: string) => t.split(STAR).join('*');
  const parts = text.replace(/\\\*/g, STAR).split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => (p.startsWith('**') ? <Text key={i} style={{ fontWeight: '700' }}>{plain(p.slice(2, -2))}</Text>
        : p.startsWith('*') && p.length > 2 ? <Text key={i} style={{ fontStyle: 'italic' }}>{plain(p.slice(1, -1))}</Text>
          : <Text key={i}>{plain(p)}</Text>))}
    </>
  );
}

export function LegalMarkdown({ md }: { md: string }) {
  const { width } = useViewport();
  const phone = width < 700;
  const body = [styles.body, phone && { fontSize: 17 }];
  return (
    <View style={{ gap: 14 }}>
      {parseLegal(md).map((b, i) => {
        if (b.kind === 'h') return <View key={i} style={styles.rule}><SiteH2 style={styles.h2}>{b.text}</SiteH2></View>;
        if (b.kind === 'p') return <SiteP key={i} style={body}><Inline text={b.text} /></SiteP>;
        if (b.kind === 'ul') {
          return (
            <View key={i} style={{ gap: 8 }}>
              {b.items.map((it, j) => (
                <View key={j} style={styles.li}>
                  <Text style={[styles.body, styles.dash]}>—</Text>
                  <Text style={[body, { flex: 1 }]}><Inline text={it} /></Text>
                </View>
              ))}
            </View>
          );
        }
        // A table: columns side by side when there is room, one card-less block a row on a phone.
        return (
          <View key={i} style={styles.table}>
            {!phone ? (
              <View style={[styles.tr, styles.th]}>
                {b.head.map((h, j) => <Text key={j} style={[styles.cell, styles.headCell]}><Inline text={h} /></Text>)}
              </View>
            ) : null}
            {b.rows.map((r, j) => (
              <View key={j} style={[styles.tr, phone && { flexDirection: 'column', gap: 4 }]}>
                {r.map((c, k) => (
                  phone ? (
                    <Text key={k} style={styles.cell}>
                      {k > 0 && b.head[k] ? <Text style={styles.headCell}>{b.head[k]}: </Text> : null}
                      <Text style={k === 0 ? { fontWeight: '700' } : undefined}><Inline text={c} /></Text>
                    </Text>
                  ) : <Text key={k} style={styles.cell}><Inline text={c} /></Text>
                ))}
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rule: { borderTopWidth: 2, borderTopColor: INK, paddingTop: 16, marginTop: 14 },
  h2: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 22, color: INK },
  body: { fontFamily: fonts.body, fontSize: 18, lineHeight: 27, color: INK },
  li: { flexDirection: 'row', gap: 10 },
  dash: { width: 18 },
  table: { borderTopWidth: 2, borderTopColor: INK },
  tr: { flexDirection: 'row', gap: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  th: { borderBottomWidth: 2, borderBottomColor: INK },
  cell: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: INK },
  headCell: { fontWeight: '700' },
});
