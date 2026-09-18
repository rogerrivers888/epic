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
import { AdminPage, Aside, ago, day, pounds, since } from '../kit';
import { Explain, type Tip, type TipKey } from '../explain';
import { Word, Blank, Act, Footer, Kicker, Stat } from '../table';

/**
 * The word a sentence uses for a kind, not the word a column header uses.
 *
 * "Thanks for the photograph", never "Thanks for the photo" — the message used
 * to interpolate the key itself (17 Sep 2026, the verification audit). The API
 * carries `said` on each kind; this is the fallback for one it does not name.
 */
const SAID: Record<string, string> = {
  photo: 'photograph', review: 'review', rating: 'rating',
  note: 'note on a dish', offer: 'offer', message: 'message', data: 'flag',
};
const said = (kind: string) => SAID[kind] ?? kind;

/**
 * The word the *row* uses, which is the word the filter chip uses.
 *
 * "Photograph" in the row beside "Photo" in the chip was one kind with two
 * names on one screen (18 Sep 2026, the separate audit). BO5a's own rows read
 * "Photo · Dinton Pastures" and "Note on a dish · Bhel Puri House", so the note
 * is the one that says more than its chip.
 */
const ROW_WORD: Record<string, string> = {
  photo: 'Photo', review: 'Review', rating: 'Rating',
  note: 'Note on a dish', offer: 'Offer', message: 'Message', data: 'Flag',
};
const kindWord = (kind: string, kinds: { key: string; label: string }[]) =>
  ROW_WORD[kind] ?? kinds.find((k) => k.key === kind)?.label
  ?? `${said(kind)[0].toUpperCase()}${said(kind).slice(1)}`;

/**
 * A value, said rather than serialised.
 *
 * An empty object is a blank, not `{}`; an object of facts is its facts in
 * words; a list is its items. Nothing is ever printed as JSON. The place
 * drawer's Compare tab has the same helper for the same reason, and the two
 * read the same way on purpose.
 */
function say(v: unknown): string {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) {
    const parts = v.map((x) => (x && typeof x === 'object'
      ? String((x as any).label ?? (x as any).key ?? (x as any).name ?? '')
      : String(x))).filter(Boolean);
    return parts.length ? parts.join(', ') : '—';
  }
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'object') {
    const held = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x != null && x !== '' && x !== false)
      .map(([k, x]) => (x === true ? k.replace(/([A-Z])/g, ' $1').toLowerCase() : `${k.replace(/([A-Z])/g, ' $1').toLowerCase()} ${say(x)}`));
    return held.length ? held.join(', ') : '—';
  }
  return String(v);
}

/**
 * The thing a note is about, in words.
 *
 * A concept is held as `namespace:key` — `cuisine:italian`, `experience:park` —
 * and a machine string does not belong on a screen somebody reads.
 */
const dishWord = (key?: string | null) =>
  (key ? key.split(':').pop()!.replace(/[-_]/g, ' ') : null);

/** The fact three sources disagree about, in our own words. */
const FIELD_WORD: Record<string, string> = {
  opening_hours: 'hours', website: 'website', phone: 'telephone number', address: 'address',
};

/**
 * The two closed lists this screen filters on, so an address that names
 * something else falls back to the default *and* stops saying it.
 *
 * `asText` kept whatever was in the address: `?state=done` drew the waiting
 * lane with no chip lit and the address still claiming otherwise, which is the
 * screen and the address disagreeing — and the address is what decides what is
 * drawn (CLAUDE.md). Found in the live audit, 18 Sep 2026.
 */
// `repositories/contentQueue.js` KINDS and STATES are the source; these mirror
// them so the address can be read before the first answer arrives.
const QUEUE_STATES = ['waiting', 'approved', 'rejected', 'reported'] as const;
const QUEUE_KINDS = ['all', 'photo', 'review', 'rating', 'note', 'offer', 'message', 'data'] as const;
type QueueState = typeof QUEUE_STATES[number];
type QueueKind = typeof QUEUE_KINDS[number];

export function Queue({ canManage }: { canManage: boolean }) {
  const [kind, setKind] = useQueryState<QueueKind>('kind', 'all', asOneOf(QUEUE_KINDS, 'all'));
  const [state, setState] = useQueryState<QueueState>('state', 'waiting', asOneOf(QUEUE_STATES, 'waiting'));
  const [where, setWhere] = useQueryState<string>('where', '', asText);
  const [open, setOpen] = useQueryState<string>('item', '', asText);

  const [data, setData] = useState<QueueList | null>(null);
  const [item, setItem] = useState<QueueItem | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // In the address, because the sheet is a layer over the queue and a layer is
  // not done until it has one (CLAUDE.md; Codex, 17 Sep 2026).
  const [rejecting, setRejecting] = useQueryState<'tell' | 'quiet' | ''>('reject', '', asOneOf(['tell', 'quiet'] as const, ''));
  const [busy, setBusy] = useState(false);
  /** What just happened, where it is not what was asked for. */
  const [note, setNote] = useState<string | null>(null);
  /** Every id a row stands for — a grouped photograph row is one decision. */
  const batchOf = useCallback(
    (id: string) => data?.rows.find((r) => r.id === id)?.batch ?? [id],
    [data],
  );
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
  // Photographs, counted as photographs rather than as rows: a row can stand
  // for twelve of them (17 Sep 2026, the verification audit).
  const batchable = useMemo(
    () => (data?.rows ?? []).filter((r) => picked.has(r.id) && r.batchable)
      .reduce((n, r) => n + (r.of ?? 1), 0),
    [data, picked],
  );
  const notBatchable = useMemo(
    () => (data?.rows ?? []).filter((r) => picked.has(r.id) && !r.batchable).length,
    [data, picked],
  );

  /** Somebody has flagged it. It jumps the queue and lands in its own lane. */
  const report = useCallback(async (id: string) => {
    setBusy(true);
    try { await api.adminQueueReport(id, 'flagged in the back office'); load(); }
    finally { setBusy(false); }
  }, [load]);

  const approve = useCallback(async (ids: string[]) => {
    setBusy(true);
    try {
      const out = await api.adminQueueApprove(ids);
      setPicked(new Set());
      load();
      // What was held back stays open and says why. A household can rewrite
      // something after the row was raised, and approving it would be a
      // decision about words nobody has read — closing the drawer over that
      // said the opposite of what happened (Codex, 18 Sep 2026).
      const held = out.stale ?? [];
      setNote(held.length ? `${held.length === 1 ? 'That was' : `${held.length} were`} ${out.why ?? 'rewritten while you were reading, so still waiting'}.` : null);
      if (open && ids.includes(open) && !held.includes(open)) setOpen('');
    } finally { setBusy(false); }
  }, [load, open, setOpen]);

  if (!data) return <AdminPage><Waiting /></AdminPage>;

  return (
    <AdminPage>
      {/* One line, where what happened is not what was asked for. */}
      {note ? (
        <Aside says={note}
               more="A household can change what they wrote while it is sitting here. Approving would be a decision about words nobody has read, so the row stays where it is and waits to be read again." />
      ) : null}
      <View style={styles.band}>
        <View style={{ flexGrow: 1, flexBasis: 240, minWidth: 0, gap: 5 }}>
          <Kicker tip="sectionFromHouseholds">From households</Kicker>
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
          <Kicker tip="sectionKind">Kind</Kicker>
          <View style={styles.words}>
            <Word2 label="All" on={kind === 'all'} onPress={() => setKind('all')} />
            {data.kinds.map((k) => (
              <Word2 key={k.key} label={k.label} n={data.counts.kind[k.key] ?? 0} on={kind === k.key} onPress={() => setKind(k.key as QueueKind)}
                     tip={[k.label, `${data.counts.kind[k.key] ?? 0} ${said(k.key)}${(data.counts.kind[k.key] ?? 0) === 1 ? '' : 's'} ${state}. A ${said(k.key)} is ${k.batch ? 'one of the things that can be decided in a batch' : 'decided on its own, never in a batch'}.`]} />
            ))}
          </View>
        </View>
        <View style={styles.filterGroup}>
          <Kicker tip="sectionState">State</Kicker>
          <View style={styles.words}>
            {data.states.map((s) => (
              <Word2 key={s} label={s[0].toUpperCase() + s.slice(1)} on={state === s} onPress={() => setState(s as QueueState)} />
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
          {/* The design's mark is the warning triangle, not a flag. */}
          <Icon name="alert" size={15} strokeWidth={2} color={colors.ink} />
          <Text style={styles.reportedWord}>{`${data.counts.reported} reported`}</Text>
          <View style={{ flex: 1 }} />
          <Act label="Deal with those first" tone="solid" onPress={() => setState('reported')} />
        </View>
      ) : null}

      <View style={[styles.split, width < 1100 && { flexDirection: 'column' }]}>
        <View style={[styles.list, width < 1100 && { width: '100%' }]}>
          {/* What is empty, in its own words — "Nothing waiting" under STATE:
              Approved was the wrong sentence (18 Sep 2026, the separate audit).
              And an area nobody has heard of says so rather than reading as an
              empty queue. */}
          {data.rows.length === 0 ? (
            <View style={{ padding: 14 }}>
              <Word muted>{where && !data.where ? `We hold no area called ${where}.` : `Nothing ${state}.`}</Word>
            </View>
          ) : null}
          {/* Opening one is a move, not a filter, so it pushes: Back closes the
              layer rather than leaving the back office (CLAUDE.md, "a move
              pushes, a filter replaces"; 18 Sep 2026, the separate audit). */}
          {data.rows.map((r) => (
            <Press key={r.id} effect="none" onPress={() => setOpen(r.id, { replace: false })} accessibilityRole="button"
                   accessibilityLabel={`${r.kind} from ${r.maker ?? 'a household'}`}
                   style={[styles.listRow, open === r.id && styles.listRowOn, r.reported && styles.listRowReported]}>
              <Press effect="none" accessibilityRole="checkbox" accessibilityState={{ checked: picked.has(r.id) }}
                     accessibilityLabel={`Select ${r.kind}`} hitSlop={8}
                     onPress={() => setPicked(toggle(picked, r.id))}
                     style={[styles.box, picked.has(r.id) && styles.boxOn]}>
                {picked.has(r.id) ? <Icon name="check" size={13} strokeWidth={2.6} color={colors.selectedFg} /> : null}
              </Press>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                {/* The row says the thing, in its own words: "Note on a dish ·
                    Bhel Puri House", and a flagged fact says what disagrees
                    rather than the word "Data" (BO5a). The state is only on the
                    row being decided — on every row it was noise (17 Sep 2026,
                    the verification audit). */}
                <Text style={[styles.listName, open === r.id && styles.strong]} numberOfLines={1}>
                  {r.kind === 'data'
                    ? `Three sources disagree${r.field ? ` on the ${FIELD_WORD[r.field] ?? r.field}` : ''}`
                    : `${kindWord(r.kind, data.kinds)}${r.place ? ` · ${r.place}` : r.ref ? ' · a place we hold no name for' : ''}${(r.of ?? 1) > 1 ? `, ${r.of} of them` : ''}`}
                </Text>
                <Text style={styles.listNote} numberOfLines={1}>
                  {r.kind === 'data'
                    ? [r.place ?? 'a place we hold no name for', 'flagged by us', since(r.madeAt)].filter(Boolean).join(' · ')
                    : [
                      // "4 households" where a batch came from several of them.
                      (r.makers?.length ?? 0) > 1 ? `${r.makers.length} households` : (r.maker ?? 'flagged by us'),
                      since(r.madeAt),
                      r.reported ? 'reported' : (open === r.id ? r.state : null),
                    ].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </Press>
          ))}
          <View style={styles.listFoot}>
            <Text style={styles.listNote}>
              {/* The same arithmetic the button does. It counted rows beside a
                  button that counts photographs, so one selected batch of
                  twelve read "1 selected" next to "Approve the 12" (18 Sep
                  2026, the separate audit; README law 4). */}
              {picked.size ? `${batchable + notBatchable} selected${notBatchable ? ` · ${notBatchable} cannot be done together` : ' · all photographs'}` : 'Nothing selected'}
            </Text>
            <View style={{ flex: 1 }} />
            {/* Batch approval where it is safe. Never a batch rejection, and
                never a batch that contains something a person wrote. */}
            <Act label={`Approve the ${batchable}`} small tone="secondary"
                 disabled={!canManage || busy || batchable === 0 || notBatchable > 0}
                 onPress={() => approve(data.rows
                   .filter((r) => picked.has(r.id) && r.batchable)
                   // Every id the row stands for, not the row's own.
                   .flatMap((r) => r.batch ?? [r.id]))} />
          </View>
        </View>

        <View style={[styles.detail, width < 1100 && { width: '100%', borderLeftWidth: 0, paddingLeft: 0 }]}>
          {/* Nothing to decide is not something still loading: an empty queue
              drew a spinner that never stopped (18 Sep 2026, the separate
              audit). */}
          {!item && !data.rows.length ? <View style={{ padding: 14 }}><Word muted>Nothing to decide.</Word></View>
            : !item ? <Waiting /> : (
            <ItemPane item={item} canManage={canManage} busy={busy}
                      /* Every photograph the row stands for, not the one whose
                         id it happens to carry: the row says "12 of them" and
                         pressing Approve left eleven of them waiting (Codex,
                         18 Sep 2026). The footer's batch button has always
                         done this; the drawer's had not. */
                      onApprove={() => approve(batchOf(item.item.id))}
                      onReject={(tell) => setRejecting(tell ? 'tell' : 'quiet', { replace: false })}
                      onReport={() => report(item.item.id)}
                      next={data.rows[data.rows.findIndex((r) => r.id === open) + 1] ?? null}
                      onApproveNext={(id) => approve(batchOf(id))}
                      onOpenNext={(id) => { setOpen(id, { replace: false }); setRejecting('tell', { replace: false }); }} />
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

function ItemPane({ item, canManage, busy, onApprove, onReject, onReport, next, onApproveNext, onOpenNext }: {
  item: QueueItem; canManage: boolean; busy: boolean; onApprove: () => void; onReject: (tell: boolean) => void;
  /** Reported content jumps the queue. `view_library` is enough — reporting is not deciding. */
  onReport: () => void;
  next: QueueList['rows'][number] | null;
  onApproveNext: (id: string) => void; onOpenNext: (id: string) => void;
}) {
  const it = item.item;
  return (
    <View style={{ gap: spacing.lg }}>
      <View>
        <Kicker tip="sectionWhereItWouldGo">Where it would go</Kicker>
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
            {item.detail?.title ? <Text style={styles.previewCredit}>{item.detail.title}</Text> : null}
            {/* A rating is a verdict and sometimes a dish, and often no words at
                all — a wordless one showed the reviewer a place name and
                nothing else to decide about (Codex, 18 Sep 2026). */}
            {item.detail?.take ? (
              <Text style={styles.previewCredit}>
                {[dishWord(item.detail.dish),
                  item.detail.take === 'loved' ? 'loved it' : item.detail.take === 'fine' ? 'fine' : 'not for me',
                  item.detail.score ? `${item.detail.score} out of 5` : null].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
            {item.detail?.text ? <Text style={styles.previewText}>{`“${item.detail.text}”`}</Text> : null}
            {/* An open entry is often chips rather than a sentence, and a
                reviewer cannot decide about a thing they cannot see. */}
            {item.detail?.interests?.length || item.detail?.level || item.detail?.where ? (
              <Text style={styles.previewNote}>
                {[...(item.detail.interests ?? []), item.detail.level, item.detail.where].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
            {item.detail?.disagree ? (
              <View style={{ gap: 4, marginTop: 6 }}>
                {item.detail.disagree.map((d: any) => (
                  <View key={d.source} style={styles.disagree}>
                    <Text style={styles.disagreeSource}>{d.source}</Text>
                    {/* Said, not serialised. Nothing is ever printed as JSON —
                        that is a database's own output and not a thing anybody
                        reads (17 Sep 2026, the verification audit). */}
                    <Text style={styles.disagreeValue} numberOfLines={1}>{say(d.value)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </View>
      </View>

      <View>
        <Kicker tip="sectionAboutIt">About it</Kicker>
        {/* BO5a: "The Hartleys · 4 photographs before, all kept". */}
        <Fact tip="madeBy" label="Made by" value={item.made
          ? `${item.made.name}${item.made.kept ? ` · ${item.made.kept} ${item.made.kept === 1 ? 'thing' : 'things'} before, all kept` : ' · nothing before this'}`
          : it.maker ?? '—'} />
        <Fact tip="whenItWasMade" label={item.picture ? 'Taken' : 'Made'} value={day(it.madeAt)} />
        {/* One of the five rejection reasons is "somebody's face is in it", so
            the screen has to say whether anything has looked. Nothing does yet,
            and saying so is the honest answer rather than "none found". */}
        {item.picture ? <Fact tip="facesInIt" label="Faces" value={item.faces} /> : null}
        {item.picture ? <Fact tip="pictureSize" label="Size" value={item.picture.width && item.picture.height ? `${item.picture.width} × ${item.picture.height}` : '—'} /> : null}
        {item.picture ? <Fact tip="pictureLicence" label="Licence" value={item.picture.licence ?? 'the household’s own'} /> : null}
        <Fact tip="earnedSoFar" label="Earned so far" value={item.made ? `${pounds(item.made.points)} of credit` : '—'} last />
      </View>

      {it.state === 'waiting' ? (
        <View style={styles.actions}>
          {/* Two different acts: the silent one still needs a reason from the
              closed list, so the common one can be counted — it simply does not
              send a message (Codex, 17 Sep 2026). */}
          {/* Reported jumps the queue and has a lane of its own, and nothing
              in the app could put anything in it — the route was written and
              unreachable, so the lane was permanently empty (17 Sep 2026, the
              verification audit). */}
          {!it.reported ? (
            <Act label="Report it" tone="secondary" disabled={!canManage || busy} onPress={onReport} />
          ) : null}
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
          <Kicker tip="sectionNextInQueue">{`Next · ${nextWord(next.kind)}`}</Kicker>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
            <Text style={styles.nextName}>{next.place ?? next.ref ?? cap(nextWord(next.kind))}</Text>
            <Text style={styles.listNote}>{[next.maker, since(next.madeAt)].filter(Boolean).join(' · ')}</Text>
          </View>
          {/* The words themselves. BO5a prints the review in full and the block
              printed a name and a date, which is not enough to decide on
              (17 Sep 2026, the verification audit). */}
          {next.preview ? <Text style={styles.previewText}>{`“${next.preview}”`}</Text> : null}
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
            <Kicker tip="sectionRejecting">{`Rejecting · ${item.item.maker ?? 'a household'}`}</Kicker>
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
            <Kicker tip="sectionTheMessage">{tell ? 'The message' : 'The message · not being sent'}</Kicker>
            {/* Written next to the button that sends it, not composed afterwards. */}
            <View style={styles.message}>
              {/* The word, not the key: "photograph", not "photo" — and the
                  same sentence the e-mail carries (17 Sep 2026). */}
              <Text style={styles.messageTitle}>{`Thanks for the ${said(item.item.kind)}${item.item.place ? ` of ${item.item.place}` : ''}`}</Text>
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

const Word2 = ({ label, n, on, onPress, tip }: { label: string; n?: number; on: boolean; onPress: () => void; tip?: Tip }) => (
  <Explain tip={tip ?? null} cursor="pointer">
    <Press effect="none" onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label}
           style={[styles.word2, on && styles.word2On]}>
      <Text style={[styles.word2Text, on && styles.word2TextOn]}>{n == null ? label : `${label} ${n || '—'}`}</Text>
    </Press>
  </Explain>
);

/**
 * One fact about the thing being decided — and it explains itself.
 *
 * Six of these were the only labels on the board with no hover, which is the
 * one law the owner names by hand: "when I hover over any one of the headers it
 * should tell me what it is" (18 Sep 2026, the separate audit).
 */
const Fact = ({ label, value, last, tip }: { label: string; value: string; last?: boolean; tip?: TipKey | Tip }) => (
  <Explain tip={tip ?? null} style={[styles.factRow, last && { borderBottomWidth: 0 }]}>
    <Text style={styles.factLabel}>{label}</Text>
    <Text style={styles.factValue}>{value}</Text>
  </Explain>
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
  // The filter groups wrap and shrink: seven kind chips at a 16px gap do not fit
  // 390 on one line (live phone audit, 18 Sep 2026).
  filterGroup: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap', flexShrink: 1, minWidth: 0 },
  words: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap', flexShrink: 1, minWidth: 0 },
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
