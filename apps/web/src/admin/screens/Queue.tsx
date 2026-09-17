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
import { ActivityIndicator, Image, Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import { Icon } from '../../components/Icon';
import { colors, spacing, type, BORDER, CREAM, INK, MOSS } from '../../theme';
import { useViewport } from '../../hooks/useViewport';
import { asOneOf, asText, useQueryState } from '../../router';
import { api, type QueueList, type QueueItem, type RejectReason } from '../../api';
import { AdminPage, ago, day, pounds, since } from '../kit';
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
  // In the address, because the sheet is a layer over the queue and a layer is
  // not done until it has one (CLAUDE.md; Codex, 17 Sep 2026).
  const [rejecting, setRejecting] = useQueryState<'tell' | 'quiet' | ''>('reject', '', asOneOf(['tell', 'quiet'] as const, ''));
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
          <Stat label="Oldest" value={data.counts.oldest ? since(data.counts.oldest) : '—'}
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
                  {[r.maker ?? 'flagged by us', since(r.madeAt), r.reported ? 'reported' : r.state].filter(Boolean).join(' · ')}
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
                      onReject={(tell) => setRejecting(tell ? 'tell' : 'quiet')}
                      next={data.rows[data.rows.findIndex((r) => r.id === open) + 1] ?? null}
                      onApproveNext={(id) => approve([id])}
                      onOpenNext={(id) => { setOpen(id); setRejecting('tell'); }} />
          )}
        </View>
      </View>

      {rejecting && item ? (
        <RejectSheet item={item} tell={rejecting === 'tell'} onClose={() => setRejecting('')}
                     onDone={() => { setRejecting(''); setOpen(''); load(); }} />
      ) : null}
    </AdminPage>
  );
}

function ItemPane({ item, canManage, busy, onApprove, onReject, next, onApproveNext, onOpenNext }: {
  item: QueueItem; canManage: boolean; busy: boolean; onApprove: () => void; onReject: (tell: boolean) => void;
  next: QueueList['rows'][number] | null;
  onApproveNext: (id: string) => void; onOpenNext: (id: string) => void;
}) {
  const it = item.item;
  return (
    <View style={{ gap: spacing.lg }}>
      <View>
        <Kicker>Where it would go</Kicker>
        {/* A light card, because this is a preview of what a household sees. */}
        <View style={styles.preview}>
          {item.picture ? (
            <View style={styles.previewImage}>
              {/* On the signed link the API stamped: a photograph still in the
                  queue is not public, and the bare id is a 404 by design. */}
              <Image source={{ uri: api.imageUrl(item.picture, 700) }} style={StyleSheet.absoluteFill as any} resizeMode="cover" />
            </View>
          ) : null}
          <View style={styles.previewBody}>
            <Text style={styles.previewTitle}>{it.place ?? it.ref ?? 'A place'}</Text>
            <Text style={styles.previewNote}>{[it.area, it.subjectType === 'image' ? null : it.kind].filter(Boolean).join(' · ')}</Text>
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
        <Fact label={item.picture ? 'Taken' : 'Made'} value={day(it.madeAt)} />
        {/* One of the five rejection reasons is "somebody's face is in it", so
            the screen has to say whether anything has looked. Nothing does yet,
            and saying so is the honest answer rather than "none found". */}
        {item.picture ? <Fact label="Faces" value={item.faces} /> : null}
        {item.picture ? <Fact label="Size" value={item.picture.width && item.picture.height ? `${item.picture.width} × ${item.picture.height}` : '—'} /> : null}
        {item.picture ? <Fact label="Licence" value={item.picture.licence ?? 'the household’s own'} /> : null}
        <Fact label="Earned so far" value={item.made ? pounds(item.made.points) : '—'} last />
      </View>

      {it.state === 'waiting' ? (
        <View style={styles.actions}>
          {/* Two different acts: the silent one still needs a reason from the
              closed list, so the common one can be counted — it simply does not
              send a message (Codex, 17 Sep 2026). */}
          <Act label="Reject" tone="secondary" disabled={!canManage || busy} onPress={() => onReject(false)} />
          <Act label="Reject, and tell them why" tone="secondary" disabled={!canManage || busy} onPress={() => onReject(true)} />
          <Act label="Approve" icon="check" tone="solid" disabled={!canManage || busy} onPress={onApprove} />
        </View>
      ) : (
        <View style={styles.actions}>
          <Word muted>{`${it.state}${it.reason ? ` · ${it.reason}` : ''}${it.told ? ' · they were told' : ''}`}</Word>
        </View>
      )}

      {/* What is next, in full, so the queue keeps moving rather than sending
          you back to the list between every decision. */}
      {next ? (
        <View style={styles.next}>
          <Kicker>{`Next · ${nextWord(next.kind)}`}</Kicker>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
            <Text style={styles.nextName}>{next.place ?? next.ref ?? cap(nextWord(next.kind))}</Text>
            <Text style={styles.listNote}>{[next.maker, since(next.madeAt)].filter(Boolean).join(' · ')}</Text>
          </View>
          <View style={styles.actions}>
            <Act label="Approve" icon="check" tone="solid" disabled={!canManage || busy} onPress={() => onApproveNext(next.id)} />
            <Act label="Reject, and tell them why" tone="secondary" disabled={!canManage || busy} onPress={() => onOpenNext(next.id)} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
const nextWord = (kind: string) => ({ photo: 'a photograph', review: 'a review', rating: 'a rating', note: 'a note', data: 'a disagreement', offer: 'an offer', message: 'a message' } as Record<string, string>)[kind] ?? kind;

// ---------------------------------------------------------------------------
// BO5b — the rejection, beside the message it sends
// ---------------------------------------------------------------------------

function RejectSheet({ item, tell, onClose, onDone }: {
  item: QueueItem; tell: boolean; onClose: () => void; onDone: () => void;
}) {
  const { width, height, framed, origin } = useViewport();
  const [reason, setReason] = useState<RejectReason | null>(item.reasons[0] ?? null);
  const [message, setMessage] = useState(item.reasons[0]?.message ?? '');
  const [busy, setBusy] = useState(false);
  // Which reason gets used most, so the common one can be designed out rather
  // than argued about — the board prints it beside the first row.
  const [used, setUsed] = useState<Record<string, number>>({});
  useEffect(() => {
    api.adminQueueReasons()
      .then((r) => setUsed(Object.fromEntries(r.used.filter((u) => u.kind === item.item.kind).map((u) => [u.reason, u.used]))))
      .catch(() => setUsed({}));
  }, [item.item.kind]);
  const commonest = Object.entries(used).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  // A sheet must pin itself to the frame, or it covers the whole browser window
  // instead of the phone the owner is looking at (CLAUDE.md).
  const left = framed && origin ? origin.x : 0;
  const top = framed && origin ? origin.y : 0;

  const [why, setWhy] = useState<string | null>(null);
  const send = async (tell: boolean) => {
    if (!reason) return;
    setBusy(true); setWhy(null);
    try {
      const out = await api.adminQueueReject(item.item.id, { reason: reason.key, message: tell ? message : null, tell });
      // The rejection stands either way; whether they were told is a separate
      // fact and the sheet says which happened (Codex, 17 Sep 2026).
      if (tell && !out.told && out.why) { setWhy(out.why); return; }
      onDone();
    } finally { setBusy(false); }
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
                <Text style={styles.reasonUsed}>{commonest === r.key ? 'most used' : ''}</Text>
              </Press>
            ))}
          </View>

          {/* The message is only composed where it is going to be sent. */}
          <View style={{ gap: 9, borderTopWidth: BORDER, borderTopColor: colors.ruleMuted, paddingTop: 14, opacity: tell ? 1 : 0.55 }}>
            <Kicker>{tell ? 'The message' : 'The message · not being sent'}</Kicker>
            {/* Written next to the button that sends it, not composed afterwards. */}
            <View style={styles.message}>
              <Text style={styles.messageTitle}>{`Thanks for the ${item.item.kind}${item.item.place ? ` of ${item.item.place}` : ''}`}</Text>
              <TextInput value={message} onChangeText={setMessage} multiline
                         style={styles.messageInput} accessibilityLabel="What they will be told"
                         placeholder="What they will be told" placeholderTextColor={colors.inkMuted} />
            </View>
          </View>

          {why ? (
            <View style={styles.didNotSend}>
              <Icon name="alert" size={15} strokeWidth={2} color={colors.ink} />
              <Text style={styles.didNotSendWord}>{`Turned down, but ${why}.`}</Text>
              <View style={{ flex: 1 }} />
              <Act label="Close" tone="secondary" onPress={onDone} />
            </View>
          ) : null}
          {/* The three acts wrap rather than run off the sheet: nothing is
              allowed to overflow 390px (CLAUDE.md, and Codex 17 Sep 2026). */}
          <View style={styles.sheetActs}>
            <Act label="Back" tone="secondary" onPress={onClose} />
            <Act label="Reject without telling them" tone="secondary" disabled={busy || !reason} onPress={() => send(false)} />
            <Act label="Reject and send this" tone="solid" disabled={busy || !reason || !message.trim()} onPress={() => send(true)} />
          </View>
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
  /**
   * Cream, and ink type on it — this is a preview of what a household sees, and
   * the household app is a light surface whatever the back office is set to
   * (Codex, 17 Sep 2026: the style said `colors.bg`, which is the dark ground).
   */
  preview: { width: 334, maxWidth: '100%', backgroundColor: CREAM, borderWidth: 1, borderColor: INK, marginTop: 8 },
  previewImage: { height: 186, backgroundColor: colors.lineSoft, overflow: 'hidden' },
  previewBody: { paddingHorizontal: 14, paddingTop: 13, paddingBottom: 15, gap: 4 },
  previewTitle: { ...type.title, fontSize: 19, fontWeight: '800', color: INK },
  previewNote: { ...type.tiny, fontSize: 12.5, color: MOSS },
  previewCredit: { ...type.tiny, fontSize: 11.5, color: MOSS },
  previewText: { ...type.small, fontSize: 13, color: INK, marginTop: 6 },
  disagree: { flexDirection: 'row', gap: 10 },
  disagreeSource: { ...type.tiny, fontSize: 11.5, color: colors.inkMuted, width: 90 },
  disagreeValue: { ...type.tiny, fontSize: 12, color: colors.ink, flex: 1 },

  factRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  factLabel: { ...type.tiny, fontSize: 12, color: colors.inkMuted, width: 120 },
  factValue: { ...type.small, fontSize: 12.5, color: colors.ink, flex: 1 },
  actions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  next: { gap: 9, borderTopWidth: BORDER, borderTopColor: colors.ruleMuted, paddingTop: 14 },
  nextName: { ...type.body, fontSize: 13.5, fontWeight: '700', color: colors.ink },
  strong: { fontWeight: '700' },

  scrim: { position: 'absolute', backgroundColor: colors.scrim },
  sheet: { position: 'absolute', backgroundColor: colors.bg, borderWidth: BORDER, borderColor: colors.ink },
  sheetTitle: { ...type.title, fontSize: 23, fontWeight: '800', color: colors.ink },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  reasonOn: { backgroundColor: colors.surfaceMuted },
  reasonWord: { ...type.body, fontSize: 13.5, color: colors.ink, flex: 1 },
  reasonUsed: { ...type.tiny, fontSize: 12, color: colors.inkMuted, width: 80, textAlign: 'right' },
  didNotSend: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.surfaceMuted, paddingHorizontal: 14, paddingVertical: 11 },
  didNotSendWord: { ...type.small, fontSize: 13, color: colors.ink },
  sheetActs: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end',
               borderTopWidth: BORDER, borderTopColor: colors.ruleMuted, paddingTop: 15 },
  radio: { width: 17, height: 17, borderRadius: 999, borderWidth: 1.5, borderColor: colors.decor },
  radioOn: { borderWidth: 5, borderColor: colors.selected },
  // The same rule: this is the message a household will read, so it is drawn on
  // the ground they will read it on.
  message: { backgroundColor: CREAM, borderWidth: 1, borderColor: INK, padding: 17, gap: 10 },
  messageTitle: { ...type.title, fontSize: 17, fontWeight: '800', color: INK },
  messageInput: { ...type.small, fontSize: 13.5, color: INK, minHeight: 84, outlineStyle: 'none' as any, textAlignVertical: 'top' },
});
