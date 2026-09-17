/**
 * The content queue — what households have sent us, and whether it is fit to
 * publish.
 *
 * **One queue with a filter, not a queue per kind.** The act is the same every
 * time: somebody looks and decides. So photographs, reviews, ratings, notes,
 * offers and messages are one list, and flagged data quality — the hours three
 * sources disagree about — is in it too, because that is the same act.
 *
 * Two rules that are not negotiable:
 *   · Forty beach photographs can be approved together. **A person's review is
 *     never rejected in a batch.**
 *   · The rejection reason is a closed list, so the common one can be counted
 *     and designed out, and **the message the household receives is written next
 *     to the button that sends it.**
 *
 * Reported content jumps the queue: it is a different job on a different clock.
 * And nothing in here is ever a provider's photograph — if one appears,
 * something is wrong upstream.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import { Icon } from '../../components/Icon';
import { colors, spacing, type, BORDER } from '../../theme';
import { useViewport } from '../../hooks/useViewport';
import { asText, useQueryState } from '../../router';
import { api, type QueueList, type QueueItem, type RejectReason } from '../../api';
import { AdminPage, ago, day, pounds } from '../kit';
import { Explain } from '../explain';
import { Word, Blank, Act, Footer, Kicker, Stat } from '../table';

export function Queue({ canManage }: { canManage: boolean }) {
  const [kind, setKind] = useQueryState<string>('kind', 'all', asText);
  const [state, setState] = useQueryState<string>('state', 'waiting', asText);
  const [where, setWhere] = useQueryState<string>('where', '', asText);
  const [open, setOpen] = useQueryState<string>('item', '', asText);

  const [data, setData] = useState<QueueList | null>(null);
  const [item, setItem] = useState<QueueItem | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const { width } = useViewport();

  const load = useCallback(() => {
    api.adminQueue({ kind: kind === 'all' ? undefined : kind, state, where: where || undefined })
      .then((d) => { setData(d); if (!open && d.rows[0]) setOpen(d.rows[0].id); })
      .catch(() => setData(null));
  }, [kind, state, where, open, setOpen]);
  useEffect(load, [kind, state, where]);
  useEffect(() => {
    if (!open) { setItem(null); return; }
    setItem(null);
    api.adminQueueItem(open).then(setItem).catch(() => setItem(null));
  }, [open]);

  // Counted before the early return: a hook that only runs once the data has
  // arrived changes the order of hooks between renders, and React refuses.
  const batchable = useMemo(
    () => (data?.rows ?? []).filter((r) => picked.has(r.id) && r.batchable).length,
    [data, picked],
  );
  const notBatchable = picked.size - batchable;

  const approve = useCallback(async (ids: string[]) => {
    setBusy(true);
    try { await api.adminQueueApprove(ids); setPicked(new Set()); load(); if (open && ids.includes(open)) setOpen(''); }
    finally { setBusy(false); }
  }, [load, open, setOpen]);

  if (!data) return <AdminPage><Waiting /></AdminPage>;

  return (
    <AdminPage>
      <View style={styles.band}>
        <View style={{ flexGrow: 1, flexBasis: 240, minWidth: 0, gap: 5 }}>
          <Kicker>From households</Kicker>
          <Text style={styles.title}>What has come in</Text>
        </View>
        <View style={styles.five}>
          <Stat label="Reported" value={data.counts.reported} tip="reported" accent />
          <Stat label="Waiting" value={data.counts.state.waiting ?? 0} tip="waiting" />
          <Stat label="Oldest" value={data.counts.oldest ? ago(data.counts.oldest) : '—'}
                tip={['Oldest', 'How long the thing that has waited longest has been waiting.']} />
        </View>
      </View>

      <View style={styles.filters}>
        <View style={styles.filterGroup}>
          <Kicker>Kind</Kicker>
          <View style={styles.words}>
            <Word2 label="All" on={kind === 'all'} onPress={() => setKind('all')} />
            {data.kinds.map((k) => (
              <Word2 key={k.key} label={k.label} n={data.counts.kind[k.key] ?? 0} on={kind === k.key} onPress={() => setKind(k.key)} />
            ))}
          </View>
        </View>
        <View style={styles.filterGroup}>
          <Kicker>State</Kicker>
          <View style={styles.words}>
            {data.states.map((s) => (
              <Word2 key={s} label={s[0].toUpperCase() + s.slice(1)} on={state === s} onPress={() => setState(s)} />
            ))}
          </View>
        </View>
        <View style={[styles.search, { width: 230 }]}>
          <Icon name="search" size={15} strokeWidth={2} color={colors.inkMuted} />
          <TextInput value={where} onChangeText={setWhere} placeholder="Anywhere"
                     placeholderTextColor={colors.inkMuted} style={styles.searchInput} accessibilityLabel="Filter by county" />
        </View>
      </View>

      {data.counts.reported > 0 && state !== 'reported' ? (
        <View style={styles.reported}>
          <Icon name="flag" size={15} strokeWidth={2} color={colors.ink} />
          <Text style={styles.reportedWord}>{`${data.counts.reported} reported`}</Text>
          <View style={{ flex: 1 }} />
          <Act label="Deal with those first" tone="solid" onPress={() => setState('reported')} />
        </View>
      ) : null}

      <View style={[styles.split, width < 1100 && { flexDirection: 'column' }]}>
        <View style={[styles.list, width < 1100 && { width: '100%' }]}>
          {data.rows.length === 0 ? <View style={{ padding: 14 }}><Word muted>Nothing waiting.</Word></View> : null}
          {data.rows.map((r) => (
            <Press key={r.id} effect="none" onPress={() => setOpen(r.id)} accessibilityRole="button"
                   accessibilityLabel={`${r.kind} from ${r.maker ?? 'a household'}`}
                   style={[styles.listRow, open === r.id && styles.listRowOn, r.reported && styles.listRowReported]}>
              <Press effect="none" accessibilityRole="checkbox" accessibilityState={{ checked: picked.has(r.id) }}
                     accessibilityLabel={`Select ${r.kind}`} hitSlop={8}
                     onPress={() => setPicked(toggle(picked, r.id))}
                     style={[styles.box, picked.has(r.id) && styles.boxOn]}>
                {picked.has(r.id) ? <Icon name="check" size={13} strokeWidth={2.6} color={colors.selectedFg} /> : null}
              </Press>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={[styles.listName, open === r.id && styles.strong]} numberOfLines={1}>
                  {`${r.kind[0].toUpperCase()}${r.kind.slice(1)}${r.place ? ` · ${r.place}` : r.ref ? ` · ${r.ref}` : ''}`}
                </Text>
                <Text style={styles.listNote} numberOfLines={1}>
                  {[r.maker ?? 'flagged by us', ago(r.madeAt), r.reported ? 'reported' : r.state].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </Press>
          ))}
          <View style={styles.listFoot}>
            <Text style={styles.listNote}>
              {picked.size ? `${picked.size} selected${notBatchable ? ` · ${notBatchable} cannot be done together` : ' · all photographs'}` : 'Nothing selected'}
            </Text>
            <View style={{ flex: 1 }} />
            {/* Batch approval where it is safe. Never a batch rejection, and
                never a batch that contains something a person wrote. */}
            <Act label={`Approve the ${batchable}`} small tone="secondary"
                 disabled={!canManage || busy || batchable === 0 || notBatchable > 0}
                 onPress={() => approve(data.rows.filter((r) => picked.has(r.id) && r.batchable).map((r) => r.id))} />
          </View>
        </View>

        <View style={[styles.detail, width < 1100 && { width: '100%', borderLeftWidth: 0, paddingLeft: 0 }]}>
          {!item ? <Waiting /> : (
            <ItemPane item={item} canManage={canManage} busy={busy}
                      onApprove={() => approve([item.item.id])}
                      onReject={() => setRejecting(true)} />
          )}
        </View>
      </View>

      {rejecting && item ? (
        <RejectSheet item={item} onClose={() => setRejecting(false)}
                     onDone={() => { setRejecting(false); setOpen(''); load(); }} />
      ) : null}
    </AdminPage>
  );
}

function ItemPane({ item, canManage, busy, onApprove, onReject }: {
  item: QueueItem; canManage: boolean; busy: boolean; onApprove: () => void; onReject: () => void;
}) {
  const it = item.item;
  return (
    <View style={{ gap: spacing.lg }}>
      <View>
        <Kicker>Where it would go</Kicker>
        {/* A light card, because this is a preview of what a household sees. */}
        <View style={styles.preview}>
          {item.picture ? <View style={styles.previewImage} /> : null}
          <View style={styles.previewBody}>
            <Text style={styles.previewTitle}>{it.place ?? it.ref ?? 'A place'}</Text>
            <Text style={styles.previewNote}>{[it.area, it.kind].filter(Boolean).join(' · ')}</Text>
            {item.picture ? (
              <Text style={styles.previewCredit}>
                {`Photograph by ${it.maker ?? 'a household'}${item.picture.fetched_at ? `, ${day(item.picture.fetched_at)}` : ''}`}
              </Text>
            ) : null}
            {item.detail?.text ? <Text style={styles.previewText}>{`“${item.detail.text}”`}</Text> : null}
            {item.detail?.disagree ? (
              <View style={{ gap: 4, marginTop: 6 }}>
                {item.detail.disagree.map((d: any) => (
                  <View key={d.source} style={styles.disagree}>
                    <Text style={styles.disagreeSource}>{d.source}</Text>
                    <Text style={styles.disagreeValue} numberOfLines={1}>{typeof d.value === 'object' ? JSON.stringify(d.value) : String(d.value)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </View>
      </View>

      <View>
        <Kicker>About it</Kicker>
        <Fact label="Made by" value={item.made ? `${item.made.name} · ${item.made.kept} kept before` : it.maker ?? '—'} />
        <Fact label="Made" value={day(it.madeAt)} />
        {item.picture ? <Fact label="Size" value={item.picture.width && item.picture.height ? `${item.picture.width} × ${item.picture.height}` : '—'} /> : null}
        {item.picture ? <Fact label="Licence" value={item.picture.licence ?? 'household’s own'} /> : null}
        <Fact label="Earned so far" value={item.made ? pounds(item.made.points) : '—'} last />
      </View>

      {it.state === 'waiting' ? (
        <View style={styles.actions}>
          <Act label="Reject" tone="secondary" disabled={!canManage || busy} onPress={onReject} />
          <Act label="Reject, and tell them why" tone="secondary" disabled={!canManage || busy} onPress={onReject} />
          <Act label="Approve" icon="check" tone="solid" disabled={!canManage || busy} onPress={onApprove} />
        </View>
      ) : (
        <View style={styles.actions}>
          <Word muted>{`${it.state}${it.reason ? ` · ${it.reason}` : ''}${it.told ? ' · they were told' : ''}`}</Word>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// BO5b — the rejection, beside the message it sends
// ---------------------------------------------------------------------------

function RejectSheet({ item, onClose, onDone }: { item: QueueItem; onClose: () => void; onDone: () => void }) {
  const { width, height, framed, origin } = useViewport();
  const [reason, setReason] = useState<RejectReason | null>(item.reasons[1] ?? item.reasons[0] ?? null);
  const [message, setMessage] = useState(item.reasons[1]?.message ?? item.reasons[0]?.message ?? '');
  const [busy, setBusy] = useState(false);
  // A sheet must pin itself to the frame, or it covers the whole browser window
  // instead of the phone the owner is looking at (CLAUDE.md).
  const left = framed && origin ? origin.x : 0;
  const top = framed && origin ? origin.y : 0;

  const send = async (tell: boolean) => {
    if (!reason) return;
    setBusy(true);
    try { await api.adminQueueReject(item.item.id, { reason: reason.key, message: tell ? message : null, tell }); onDone(); }
    finally { setBusy(false); }
  };

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <Press effect="none" style={[styles.scrim, { left, top, width, height }]} onPress={onClose}
             accessibilityRole="button" accessibilityLabel="Close" />
      <View style={[styles.sheet, { left: left + Math.max(0, (width - Math.min(760, width - 32)) / 2), top: top + 40, width: Math.min(760, width - 32), maxHeight: height - 80 }]}>
        <ScrollView contentContainerStyle={{ padding: 26, gap: spacing.lg }}>
          <View style={{ gap: 5, borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted, paddingBottom: 14 }}>
            <Kicker>{`Rejecting · ${item.item.maker ?? 'a household'}`}</Kicker>
            <Text style={styles.sheetTitle}>Why are you turning it down?</Text>
          </View>

          {/* A closed list. The common one is counted so it can be designed out. */}
          <View>
            {item.reasons.map((r) => (
              <Press key={r.key} effect="none" onPress={() => { setReason(r); setMessage(r.message ?? ''); }}
                     accessibilityRole="radio" accessibilityState={{ selected: reason?.key === r.key }}
                     accessibilityLabel={r.label} style={[styles.reason, reason?.key === r.key && styles.reasonOn]}>
                <View style={[styles.radio, reason?.key === r.key && styles.radioOn]} />
                <Text style={[styles.reasonWord, reason?.key === r.key && styles.strong]}>{r.label}</Text>
              </Press>
            ))}
          </View>

          <View style={{ gap: 9, borderTopWidth: BORDER, borderTopColor: colors.ruleMuted, paddingTop: 14 }}>
            <Kicker>The message</Kicker>
            {/* Written next to the button that sends it, not composed afterwards. */}
            <View style={styles.message}>
              <Text style={styles.messageTitle}>{`Thanks for the ${item.item.kind}${item.item.place ? ` of ${item.item.place}` : ''}`}</Text>
              <TextInput value={message} onChangeText={setMessage} multiline
                         style={styles.messageInput} accessibilityLabel="What they will be told"
                         placeholder="What they will be told" placeholderTextColor={colors.inkMuted} />
            </View>
          </View>

          <Footer>
            <Act label="Back" tone="secondary" onPress={onClose} />
            <Act label="Reject without telling them" tone="secondary" disabled={busy || !reason} onPress={() => send(false)} />
            <Act label="Reject and send this" tone="solid" disabled={busy || !reason || !message.trim()} onPress={() => send(true)} />
          </Footer>
        </ScrollView>
      </View>
    </Modal>
  );
}

const Word2 = ({ label, n, on, onPress }: { label: string; n?: number; on: boolean; onPress: () => void }) => (
  <Press effect="none" onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label}
         style={[styles.word2, on && styles.word2On]}>
    <Text style={[styles.word2Text, on && styles.word2TextOn]}>{n == null ? label : `${label} ${n || '—'}`}</Text>
  </Press>
);

const Fact = ({ label, value, last }: { label: string; value: string; last?: boolean }) => (
  <View style={[styles.factRow, last && { borderBottomWidth: 0 }]}>
    <Text style={styles.factLabel}>{label}</Text>
    <Text style={styles.factValue}>{value}</Text>
  </View>
);

const toggle = (set: Set<string>, key: string) => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
};

const Waiting = () => <View style={{ paddingVertical: spacing.xl }}><ActivityIndicator color={colors.accent} /></View>;

const styles = StyleSheet.create({
  band: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    gap: spacing.xl, flexWrap: 'wrap',
    borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted, paddingBottom: 17,
  },
  title: { ...type.title, fontSize: 31, letterSpacing: -1.08, lineHeight: 33 },
  five: { flexDirection: 'row', alignItems: 'flex-end', gap: 30, flexWrap: 'wrap' },

  filters: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl, flexWrap: 'wrap' },
  filterGroup: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  words: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  word2: { paddingBottom: 3, borderBottomWidth: BORDER, borderBottomColor: 'transparent' },
  word2On: { borderBottomColor: colors.selected },
  word2Text: { ...type.small, fontSize: 13.5, color: colors.inkMuted },
  word2TextOn: { fontWeight: '700', color: colors.accent },

  search: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: colors.ruleMuted, paddingHorizontal: 13, paddingVertical: 9 },
  searchInput: { ...type.small, fontSize: 13, color: colors.ink, flex: 1, outlineStyle: 'none' as any },

  reported: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.surfaceMuted, paddingHorizontal: 14, paddingVertical: 11 },
  reportedWord: { ...type.small, fontSize: 13.5, fontWeight: '700', color: colors.ink },

  split: { flexDirection: 'row', gap: spacing.xl, alignItems: 'flex-start' },
  list: { width: 392, flexGrow: 0 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11 },
  listRowOn: { backgroundColor: colors.surfaceMuted, borderLeftWidth: BORDER, borderLeftColor: colors.selected },
  listRowReported: { borderTopWidth: 1, borderTopColor: colors.lineSoft },
  listName: { ...type.small, fontSize: 13, fontWeight: '600', color: colors.ink },
  listNote: { ...type.tiny, fontSize: 11.5, color: colors.inkMuted },
  listFoot: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderTopWidth: BORDER, borderTopColor: colors.ruleMuted },
  box: { width: 18, height: 18, borderWidth: 1.5, borderColor: colors.decor, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.selected, borderColor: colors.selected },

  detail: { flex: 1, minWidth: 0, borderLeftWidth: BORDER, borderLeftColor: colors.ruleMuted, paddingLeft: 26 },
  preview: { width: 334, maxWidth: '100%', backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.lineSoft, marginTop: 8 },
  previewImage: { height: 186, backgroundColor: colors.lineSoft },
  previewBody: { paddingHorizontal: 14, paddingTop: 13, paddingBottom: 15, gap: 4 },
  previewTitle: { ...type.title, fontSize: 19, fontWeight: '800', color: colors.ink },
  previewNote: { ...type.tiny, fontSize: 12.5, color: colors.inkMuted },
  previewCredit: { ...type.tiny, fontSize: 11.5, color: colors.inkMuted },
  previewText: { ...type.small, fontSize: 13, color: colors.ink, marginTop: 6 },
  disagree: { flexDirection: 'row', gap: 10 },
  disagreeSource: { ...type.tiny, fontSize: 11.5, color: colors.inkMuted, width: 90 },
  disagreeValue: { ...type.tiny, fontSize: 12, color: colors.ink, flex: 1 },

  factRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  factLabel: { ...type.tiny, fontSize: 12, color: colors.inkMuted, width: 120 },
  factValue: { ...type.small, fontSize: 12.5, color: colors.ink, flex: 1 },
  actions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  strong: { fontWeight: '700' },

  scrim: { position: 'absolute', backgroundColor: colors.scrim },
  sheet: { position: 'absolute', backgroundColor: colors.bg, borderWidth: BORDER, borderColor: colors.ink },
  sheetTitle: { ...type.title, fontSize: 23, fontWeight: '800', color: colors.ink },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  reasonOn: { backgroundColor: colors.surfaceMuted },
  reasonWord: { ...type.body, fontSize: 13.5, color: colors.ink, flex: 1 },
  radio: { width: 17, height: 17, borderRadius: 999, borderWidth: 1.5, borderColor: colors.decor },
  radioOn: { borderWidth: 5, borderColor: colors.selected },
  message: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.lineSoft, padding: 17, gap: 10 },
  messageTitle: { ...type.title, fontSize: 17, fontWeight: '800', color: colors.ink },
  messageInput: { ...type.small, fontSize: 13.5, color: colors.ink, minHeight: 84, outlineStyle: 'none' as any, textAlignVertical: 'top' },
});
