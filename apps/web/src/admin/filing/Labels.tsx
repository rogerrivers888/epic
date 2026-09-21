/**
 * Labels — what we ask, of what kind of place.
 *
 * Three screens behind one segmented control: the question sets, one set, the
 * words a human typed that nothing asks yet, and Epic's whole vocabulary.
 *
 * The rule the whole tab exists to enforce (brief, 20 Sep 2026): **Google may
 * raise a candidate word, but Google may never answer a question about a
 * place.** A candidate is a word read out of rented text and then thrown away;
 * what confirms it is the venue's own page, OSM, Wikipedia, Wikidata or the
 * FSA. That is why the evidence under a candidate is drawn in two registers —
 * kept quotes on a lime rule, the transient review extract on a dashed one —
 * and why an expired extract says so rather than simply vanishing.
 */

import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { Press } from '../../components/press';
import { LIME, ON_LIME, desk, fonts } from '../../theme';
import {
  Act, Alarm, Band, Cell, Col, DeskPill, Head, Kicker, Link, Mark, Nothing, Row, Value, WARN, tabular,
} from './desk';
import { rung, tooManyQuestions } from './say';
import type { Candidate, GlobalLabel, PendingWord, SetDetail, SetQuestion, SetRow, Threshold, VocabRow } from './types';

// ---------------------------------------------------------------------------
// The question sets
// ---------------------------------------------------------------------------

const SET_COLS: Col[] = [
  { w: 300, label: 'Question set' },
  { w: 'auto', label: 'Used by' },
  { w: 100, label: 'Questions', align: 'right' },
  { w: 100, label: 'Places', align: 'right' },
  { w: 140, label: 'Candidates', align: 'right' },
];

export function QuestionSets({ sets, onOpen }: { sets: SetRow[]; onOpen: (key: string) => void }) {
  return (
    <>
      <Band title="What we ask, of what kind of place" />
      <View>
        <Head cols={SET_COLS} />
        {sets.length === 0 ? <Nothing>No question sets yet.</Nothing> : null}
        {sets.map((s) => (
          <Row key={s.key} onPress={() => onOpen(s.key)}>
            <Cell col={SET_COLS[0]}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
                <Link onPress={() => onOpen(s.key)}>{s.name}</Link>
                {s.state === 'settled' ? <Mark label="SETTLED" tone="lime" /> : null}
                {s.state === 'settling' ? <Mark label="SETTLING" tone="dim" /> : null}
                {s.tooFewForTooMany ? (
                  <Mark label="TOO FEW FOR TOO MANY" tone="warn"
                    title="Four or more subcategories share fewer than six questions between them." />
                ) : null}
              </View>
            </Cell>
            <Cell col={SET_COLS[1]}>
              <Value tone="muted" size={12.5}>{s.usedBy.join(' · ') || 'not attached to anything'}</Value>
            </Cell>
            <Cell col={SET_COLS[2]}>
              <Value numeric weight={tooManyQuestions(s.questions) ? '800' : '400'}
                tone={tooManyQuestions(s.questions) ? 'warn' : 'ink'}>
                {s.questions}
              </Value>
            </Cell>
            <Cell col={SET_COLS[3]}><Value numeric>{s.places}</Value></Cell>
            <Cell col={SET_COLS[4]}>
              <Value size={13} weight="700" tone={s.waiting ? 'lime' : 'dim'}>
                {s.waiting ? `${s.waiting} waiting` : '—'}
              </Value>
            </Cell>
          </Row>
        ))}
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// One set
// ---------------------------------------------------------------------------

export function QuestionSet({
  set, questions, globals, candidates, pen, inFlight, thin, thresholds, readNote,
  onRemoveQuestion, onDetach, onPromote, onIgnore,
}: {
  set: SetDetail;
  questions: SetQuestion[];
  globals: GlobalLabel[];
  /** Judgeable, at or above the sightings floor, ordered by how unevenly spread. */
  candidates: Candidate[];
  /** Words the classifier could not call. */
  pen: Candidate[];
  /** Seen and validating — the machine's work, not yours. */
  inFlight: Candidate[];
  /** Below the sightings floor: visible, not promotable. */
  thin: Candidate[];
  thresholds: Record<string, Threshold>;
  /** "620 places were read to find these words · 31 in Berkshire are asked them". */
  readNote: string;
  onRemoveQuestion: (id: number) => void;
  onDetach: (subcategory: string) => void;
  onPromote: (id: number, gate: boolean) => void;
  onIgnore: (id: number) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [promoting, setPromoting] = useState<{ id: number; word: string; gate: boolean } | null>(null);

  const floor = thresholds.sightingFloor?.value ?? 2;

  return (
    <>
      <Band
        title={set.name}
        stats={[
          { label: 'Questions here', value: questions.length, strong: true },
          { label: 'Places', value: set.places },
          { label: 'Candidates', value: candidates.length },
        ]}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {set.usedBy.map((s2) => (
          <DeskPill key={s2.key} name={s2.label} onRemove={() => onDetach(s2.key)} />
        ))}
      </View>

      <View style={{ flexDirection: 'row', gap: 40, alignItems: 'flex-start' }}>
        {/* Asked here, and what every place is asked anyway. */}
        <View style={{ width: 620, flexGrow: 0, flexShrink: 0, gap: 12 }}>
          <Kicker>{`Asked here · ${questions.length}`}</Kicker>
          <View>
            {questions.length === 0 ? <Nothing>Nothing is asked here yet.</Nothing> : null}
            {questions.map((q) => (
              <View key={q.id} style={{
                flexDirection: 'row', alignItems: 'center', gap: 16,
                paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: desk.rule,
              }}>
                <View style={{ width: 220, flexGrow: 0, flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Value weight="600">{q.name}</Value>
                  {q.gate ? <Mark label="GATE" tone="lime" title="A gate keeps a place out of a row rather than describing it." /> : null}
                </View>
                <View style={{ width: 120, flexGrow: 0, flexShrink: 0 }}>
                  <Value tone="dim" size={12.5}>{q.shape}</Value>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  {/* Red where too few places have answered for the share to mean anything. */}
                  <Value size={12.5} tone={q.thin ? 'warn' : 'muted'}>{q.share}</Value>
                </View>
                <View style={{ width: 70, flexGrow: 0, flexShrink: 0, alignItems: 'flex-end' }}>
                  <Act label="remove" tone="dim" ruled={false} onPress={() => onRemoveQuestion(q.id)} />
                </View>
              </View>
            ))}
          </View>

          <View style={{ gap: 11, borderTopWidth: 1, borderTopColor: desk.rule, paddingTop: 14 }}>
            <Kicker>Asked everywhere · inherited</Kicker>
            <View>
              {globals.map((g) => (
                <View key={g.key} style={{
                  flexDirection: 'row', alignItems: 'center', gap: 16,
                  paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: desk.rule,
                }}>
                  <View style={{ width: 220, flexGrow: 0, flexShrink: 0 }}>
                    <Value tone="dim" size={13}>{g.name}</Value>
                  </View>
                  <View style={{ flex: 1 }}><Value tone="dim" size={12.5}>{g.shape}</Value></View>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* The candidates. */}
        <View style={{ flex: 1, minWidth: 0, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <Kicker>Candidates · seen on, which is not said yes</Kicker>
            <Value tone="dim" size={11.5}>by how unevenly spread</Value>
          </View>
          <View style={{ borderLeftWidth: 2, borderLeftColor: desk.ruleStrong, paddingLeft: 11, paddingVertical: 2 }}>
            <Value tone="dim" size={11.5}>
              {`${readNote} · a word needs ${floor} ${floor === 1 ? 'sighting' : 'sightings'} before it can be asked`}
            </Value>
          </View>

          {promoting ? (
            <Promote
              word={promoting.word}
              gate={promoting.gate}
              onGate={(g) => setPromoting({ ...promoting, gate: g })}
              onCancel={() => setPromoting(null)}
              onConfirm={() => { onPromote(promoting.id, promoting.gate); setPromoting(null); }}
            />
          ) : null}

          <View>
            {candidates.length === 0 ? <Nothing>Nothing waiting on you here.</Nothing> : null}
            {candidates.map((c) => (
              <CandidateRow
                key={c.id}
                c={c}
                thresholds={thresholds}
                open={open === c.id}
                onToggle={() => setOpen(open === c.id ? null : c.id)}
                onAsk={() => setPromoting({ id: c.id, word: c.word, gate: c.mark === 'GATE' })}
                onIgnore={() => onIgnore(c.id)}
              />
            ))}
          </View>

          {thin.length ? (
            <>
              <Rule kicker={`Too thin to judge · ${thin.length}`} note="seen once · as likely a typo as a find" />
              <View>
                {thin.map((c) => (
                  <Quiet key={c.id} count={`${c.seen} of ${c.of}`} word={c.word}
                    note={`${c.raised} · waiting for a second sighting`} />
                ))}
              </View>
            </>
          ) : null}

          <Rule kicker={`Holding pen · ${pen.length}`} />
          <View>
            {pen.length === 0 ? <Nothing>Nothing is being held.</Nothing> : null}
            {pen.map((c) => (
              <View key={c.id} style={{
                flexDirection: 'row', alignItems: 'center', gap: 14,
                paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: desk.rule,
              }}>
                <View style={{ width: 86, flexGrow: 0, flexShrink: 0, alignItems: 'flex-end' }}>
                  <Value tone="dim" size={13} numeric>{`${c.seen} of ${c.of}`}</Value>
                </View>
                <View style={{ flex: 1 }}><Value tone="muted" size={13}>{c.word}</Value></View>
                <View style={{ width: 240, flexGrow: 0, flexShrink: 0 }}>
                  <Value tone="dim" size={12}>{c.why ?? 'nobody could call it'}</Value>
                </View>
                <View style={{ width: 130, flexGrow: 0, flexShrink: 0, alignItems: 'flex-end' }}>
                  <Act label="Ask it anyway" ruled={false}
                    onPress={() => setPromoting({ id: c.id, word: c.word, gate: false })} />
                </View>
              </View>
            ))}
          </View>

          <View style={{ borderTopWidth: 1, borderTopColor: desk.rule, paddingTop: 16 }}>
            <Rule kicker="In flight · the machine's work, not yours" />
          </View>
          <View>
            {inFlight.map((c) => (
              // Dimmed as a whole, and with no actions on it: there is nothing
              // for a person to do until the machine has finished.
              <View key={c.id} style={{
                flexDirection: 'row', alignItems: 'center', gap: 14, opacity: 0.62,
                paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: desk.rule,
              }}>
                <View style={{ width: 86, flexGrow: 0, flexShrink: 0, alignItems: 'flex-end' }}>
                  <Value tone="dim" size={13} numeric>{`${c.seen} of ${c.of}`}</Value>
                </View>
                <View style={{ flex: 1 }}><Value tone="muted" size={13}>{c.word}</Value></View>
                <View style={{ width: 150, flexGrow: 0, flexShrink: 0 }}>
                  <Text style={{
                    fontFamily: fonts.body, fontSize: 11.5, fontWeight: '800',
                    letterSpacing: 0.4, color: desk.inkDim,
                  }}>
                    {c.state === 'validating' ? 'VALIDATING' : 'SEEN'}
                  </Text>
                </View>
                <View style={{ width: 240, flexGrow: 0, flexShrink: 0 }}>
                  <Value tone="dim" size={12}>{c.doing ?? 'waiting for validation · nothing for you to do'}</Value>
                </View>
              </View>
            ))}
          </View>
        </View>
      </View>
    </>
  );
}

/** A kicker with a rule running off it, used inside the candidates column. */
function Rule({ kicker, note }: { kicker: string; note?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 14, paddingBottom: 4 }}>
      <Kicker>{kicker}</Kicker>
      <View style={{ flex: 1, height: 1, backgroundColor: desk.rule }} />
      {note ? <Value tone="dim" size={11.5}>{note}</Value> : null}
    </View>
  );
}

/** A row with nothing to decide on it: a count, a word and a note. */
function Quiet({ count, word, note }: { count: string; word: string; note: string }) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 14,
      paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: desk.rule,
    }}>
      <View style={{ width: 86, flexGrow: 0, flexShrink: 0, alignItems: 'flex-end' }}>
        <Value tone="dim" size={13} numeric>{count}</Value>
      </View>
      <View style={{ flex: 1 }}><Value tone="dim" size={13}>{word}</Value></View>
      <View style={{ width: 240, flexGrow: 0, flexShrink: 0 }}><Value tone="dim" size={12}>{note}</Value></View>
    </View>
  );
}

/**
 * One candidate, and its evidence.
 *
 * The count is the loudest thing on the row when the word is *distinctive* —
 * seen on few enough places that it tells two of them apart. A word on nearly
 * every place tells you nothing, and is drawn muted at the same size, so the
 * eye lands on the useful ones without anybody having to sort.
 */
function CandidateRow({ c, thresholds, open, onToggle, onAsk, onIgnore }: {
  c: Candidate;
  thresholds: Record<string, Threshold>;
  open: boolean;
  onToggle: () => void;
  onAsk: () => void;
  onIgnore: () => void;
}) {
  const on = rung(c.seen, c.of, thresholds.distinctLow?.value ?? 0.2, thresholds.distinctHigh?.value ?? 0.8);
  const distinctive = on === 'distinctive';
  const useless = on === 'useless';
  const confirmed = c.state === 'confirmed';

  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: desk.rule }}>
      <Press effect="none" onPress={onToggle} accessibilityRole="button"
        accessibilityState={{ expanded: open }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 12 }}>
          <View style={{ width: 86, flexGrow: 0, flexShrink: 0, alignItems: 'flex-end' }}>
            <Text style={{
              fontFamily: fonts.heading,
              fontSize: distinctive ? 20 : 14,
              fontWeight: '800',
              lineHeight: distinctive ? 22 : 16,
              color: distinctive ? LIME : useless ? desk.inkDim : desk.inkMuted,
              ...tabular,
            }}>
              {`${c.seen} of ${c.of}`}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Value weight={distinctive ? '700' : '500'} tone={useless ? 'dim' : 'ink'}>{c.word}</Value>
              <Mark
                label={STATE_WORD[c.state]}
                tone={confirmed ? 'lime' : c.state === 'notconfirmed' ? 'warn' : 'dim'}
              />
              {c.mark ? <Mark label={c.mark} tone={c.mark === 'GATE' ? 'lime' : 'dim'} /> : null}
            </View>
            <Value tone="muted" size={12}>{c.provenance}</Value>
            {/* Polarity: the same word, meaning the opposite. */}
            {c.denies ? (
              <Value tone="warn" size={11.5}>
                {`${c.denies} of those say it hasn’t got one`}
              </Value>
            ) : null}
          </View>
          <View style={{ width: 88, flexGrow: 0, flexShrink: 0, alignItems: 'flex-end' }}>
            <Value tone="dim" size={11.5}>{c.raised}</Value>
          </View>
          <View style={{
            width: 200, flexGrow: 0, flexShrink: 0, flexDirection: 'row',
            alignItems: 'center', gap: 14, justifyContent: 'flex-end',
          }}>
            <Act label={confirmed ? 'Ask this' : 'Ask it anyway'} onPress={onAsk}
              tone={confirmed ? 'lime' : 'dim'} ruled={confirmed} />
            {/* Ignoring is permanent, and the row says so when it happens. */}
            <Act label="Ignore" tone={c.state === 'notconfirmed' ? 'ink' : 'dim'} ruled={false} onPress={onIgnore} />
          </View>
        </View>
      </Press>

      {open ? (
        <View style={{ gap: 11, paddingLeft: 100, paddingBottom: 16 }}>
          {/* Kept: sources Epic owns or may freely read. These survive. */}
          {c.quotes.map((q, i) => (
            <View key={i} style={{ borderLeftWidth: 2, borderLeftColor: LIME, paddingLeft: 12, paddingVertical: 2 }}>
              <Text style={{ fontFamily: fonts.body, fontSize: 13, color: desk.ink, lineHeight: 19.5 }}>{q.text}</Text>
              <View style={{ marginTop: 3 }}>
                <Value tone="dim" size={11.5}>{`${q.place} · ${q.source} · kept`}</Value>
              </View>
            </View>
          ))}
          {/* Rented: held only while the word is under review, then gone. */}
          {c.snippet && !c.snippet.expired && c.snippet.text ? (
            <View style={{
              borderLeftWidth: 2, borderLeftColor: desk.inkFaint, borderStyle: 'dashed',
              paddingLeft: 12, paddingVertical: 2,
            }}>
              <Text style={{ fontFamily: fonts.body, fontSize: 13, color: desk.inkMuted, lineHeight: 19.5 }}>
                {`“${c.snippet.text}”`}
              </Text>
              <View style={{ marginTop: 3 }}>
                <Value tone="dim" size={11.5}>
                  {`${c.snippet.place} · held only while this word is under review`}
                </Value>
              </View>
            </View>
          ) : null}
          {c.snippet?.expired ? (
            <View style={{
              borderLeftWidth: 2, borderLeftColor: desk.ruleStrong, borderStyle: 'dashed',
              paddingLeft: 12, paddingVertical: 2,
            }}>
              <Value tone="dim" size={12.5}>The review extract has expired. Owned sources only from here.</Value>
            </View>
          ) : null}
          {!c.quotes.length && c.state === 'notconfirmed' ? (
            <View style={{ borderLeftWidth: 2, borderLeftColor: desk.ruleStrong, paddingLeft: 12, paddingVertical: 2 }}>
              <Value tone="dim" size={12.5}>No owned source describes this. Probably review chatter.</Value>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {c.places.map((p) => (
              <View key={p} style={{ borderWidth: 1, borderColor: desk.ruleStrong, paddingVertical: 4, paddingHorizontal: 9 }}>
                <Value tone="muted" size={12}>{p}</Value>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const STATE_WORD: Record<Candidate['state'], string> = {
  confirmed: 'CONFIRMED',
  notconfirmed: 'NOT CONFIRMED',
  validating: 'VALIDATING',
  seen: 'SEEN',
  held: 'HELD',
};

/**
 * Promoting a candidate: an ordinary question, or a gate.
 *
 * The distinction matters downstream. An ordinary question describes a place;
 * a gate keeps it out of a row it would otherwise appear in. Asking the
 * question once, here, is cheaper than discovering later that "hearing loop"
 * was filed as decoration.
 */
function Promote({ word, gate, onGate, onCancel, onConfirm }: {
  word: string;
  gate: boolean;
  onGate: (gate: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <View style={{ gap: 14, padding: 16, backgroundColor: desk.picked, borderWidth: 1, borderColor: desk.ruleStrong }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <Value size={14} weight="800">{word}</Value>
        <Act label="cancel" tone="dim" ruled={false} onPress={onCancel} />
      </View>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Radio label="An ordinary question" on={!gate} onPress={() => onGate(false)} />
        <Radio label="A gate" on={gate} onPress={() => onGate(true)} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <Press effect="sink" onPress={onConfirm} accessibilityRole="button">
          <View style={{ backgroundColor: LIME, paddingVertical: 10, paddingHorizontal: 18 }}>
            <Text style={{ fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: ON_LIME }}>
              Ask it as places turn up
            </Text>
          </View>
        </Press>
        {/* The rule, on the one screen where somebody could forget it. */}
        <Value tone="dim" size={12}>venue pages, OSM, Wikipedia · Google never answers</Value>
      </View>
    </View>
  );
}

function Radio({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Press effect="none" onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: on }}
      style={{ flex: 1 }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14,
        borderWidth: 1.5, borderColor: on ? LIME : desk.ruleStrong,
        backgroundColor: on ? desk.picked : 'transparent',
      }}>
        <View style={{
          width: 13, height: 13, borderWidth: 1.5, borderColor: desk.inkFaint,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <View style={{ width: 7, height: 7, backgroundColor: on ? LIME : 'transparent' }} />
        </View>
        <Value size={13} weight="700">{label}</Value>
      </View>
    </Press>
  );
}

// ---------------------------------------------------------------------------
// Pending — words a human typed
// ---------------------------------------------------------------------------

const PENDING_COLS: Col[] = [
  { w: 240, label: 'Typed' },
  { w: 80, label: 'Times', align: 'right' },
  { w: 'auto', label: 'Closest we have' },
  { w: 200, label: 'A merge repoints' },
  { w: 260, label: '' },
];

/** What is waiting, said as what it is. */
function pendingTitle({ typed, orphans }: { typed: number; orphans: number }): string {
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  if (typed && orphans) return `${n(typed, 'word')} typed, and ${n(orphans, 'label')} nothing asks`;
  if (typed) return `${n(typed, 'word')} a human typed`;
  if (orphans) return `${n(orphans, 'label')} nothing asks`;
  return 'Nothing waiting';
}

export function Pending({ words, sets, why, counts, onApprove, onMerge, onReject, onPark }: {
  words: PendingWord[];
  sets: { key: string; name: string }[];
  /** Why the list is empty, where it is. Never shown beside rows. */
  why?: string | null;
  /** How the list divides, so the title can say what is in it. */
  counts?: { typed: number; orphans: number };
  onApprove: (id: number, setKeys: string[]) => void;
  onMerge: (id: number) => void;
  onReject: (id: number) => void;
  onPark: (id: number) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [picked, setPicked] = useState<Record<number, string[]>>({});

  return (
    <>
      {/*
        The title is what is actually in the list. Two different things arrive
        here — a word somebody typed on a place, and a label approved into the
        vocabulary and never attached — and calling seven orphan labels "words
        a human typed" is a sentence nobody wrote (21 Sep 2026).
      */}
      <Band title={pendingTitle(counts ?? { typed: words.length, orphans: 0 })}
        sub="approve into a set, merge into something we already ask, or reject" />
      <View>
        <Head cols={PENDING_COLS} />
        {/*
          Which kind of empty. "Nothing waiting" and "nothing can produce a row
          here yet" look identical and are not the same news — a reviewer read
          one of these screens as broken (the side-by-side audit, 21 Sep 2026).
        */}
        {words.length === 0 ? <Nothing>{why ?? 'Nothing waiting.'}</Nothing> : null}
        {words.map((w) => {
          const chosen = picked[w.id] ?? [];
          return (
            <View key={w.id}>
              <Row lifted={open === w.id}>
                <Cell col={PENDING_COLS[0]}><Value weight="700">{w.word}</Value></Cell>
                <Cell col={PENDING_COLS[1]}><Value numeric>{w.times}</Value></Cell>
                <Cell col={PENDING_COLS[2]}><Value tone="muted" size={12.5}>{w.near.join(' · ')}</Value></Cell>
                <Cell col={PENDING_COLS[3]}><Value tone="dim" size={12.5}>{w.repoint}</Value></Cell>
                <Cell col={PENDING_COLS[4]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, justifyContent: 'flex-end' }}>
                    <Act label={open === w.id ? 'close' : 'Approve into…'}
                      onPress={() => setOpen(open === w.id ? null : w.id)} />
                    <Act label="Merge" tone="dim" ruled={false} onPress={() => onMerge(w.id)} />
                    <Act label="Reject" tone="dim" ruled={false} onPress={() => onReject(w.id)} />
                  </View>
                </Cell>
              </Row>
              {open === w.id ? (
                <View style={{
                  gap: 14, paddingVertical: 16, paddingHorizontal: 8,
                  backgroundColor: desk.lifted, borderBottomWidth: 1, borderBottomColor: desk.rule,
                }}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                    {sets.map((s) => {
                      const on = chosen.includes(s.key);
                      return (
                        <Press key={s.key} effect="none" accessibilityRole="checkbox"
                          accessibilityState={{ checked: on }}
                          onPress={() => setPicked({
                            ...picked,
                            [w.id]: on ? chosen.filter((k) => k !== s.key) : [...chosen, s.key],
                          })}>
                          <View style={{
                            borderWidth: 1.5, borderColor: on ? LIME : desk.ruleStrong,
                            backgroundColor: on ? LIME : 'transparent',
                            paddingVertical: 6, paddingHorizontal: 12,
                          }}>
                            <Text style={{
                              fontFamily: fonts.body, fontSize: 13, fontWeight: '700',
                              color: on ? ON_LIME : desk.inkMuted,
                            }}>
                              {s.name}
                            </Text>
                          </View>
                        </Press>
                      );
                    })}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                    <Press effect={chosen.length ? 'sink' : 'none'} accessibilityRole="button"
                      accessibilityState={{ disabled: !chosen.length }}
                      onPress={() => { if (chosen.length) { onApprove(w.id, chosen); setOpen(null); } }}>
                      <View style={{
                        backgroundColor: chosen.length ? LIME : desk.off,
                        paddingVertical: 10, paddingHorizontal: 18,
                      }}>
                        <Text style={{
                          fontFamily: fonts.body, fontSize: 13, fontWeight: '700',
                          color: chosen.length ? ON_LIME : desk.inkDim,
                        }}>
                          {chosen.length
                            ? `Approve into ${chosen.length} ${chosen.length === 1 ? 'set' : 'sets'}`
                            : 'Pick a set'}
                        </Text>
                      </View>
                    </Press>
                    {/*
                      Parking is explicit because approving with no set is what
                      creates orphans: a label in the vocabulary that nothing
                      ever asks. All labels then says so in red.
                    */}
                    <Act label="Park it · nothing asks it yet" tone="dim" ruled={false}
                      onPress={() => { onPark(w.id); setOpen(null); }} />
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// All labels
// ---------------------------------------------------------------------------

const VOCAB_COLS: Col[] = [
  { w: 240, label: 'Label' },
  { w: 150, label: 'Asked' },
  { w: 'auto', label: 'Where it is asked', title: 'Everywhere means a global question asks it of every place. In n sets means only the drawers those sets cover. Nowhere is the orphan case \u2014 approved into the vocabulary and never attached, so nothing ever asks it of a place.' },
  { w: 100, label: 'Places', align: 'right' },
  { w: 200, label: '' },
];

export function AllLabels({ rows, onAskIn, onRetire, onOpenSet }: {
  rows: VocabRow[];
  onAskIn: (key: string) => void;
  onRetire: (key: string) => void;
  onOpenSet: (key: string) => void;
}) {
  const everywhere = rows.filter((r) => r.scope === 'everywhere').length;
  const nowhere = rows.filter((r) => r.scope === 'nowhere').length;

  return (
    <>
      <Band
        title="The words"
        stats={[
          { label: 'Asked everywhere', value: everywhere },
          { label: 'Used nowhere', value: nowhere, strong: nowhere > 0 },
        ]}
      />
      {/*
        The "used nowhere" stat is already in the band above, and the column
        beside each row already says "nowhere" in red. A block restating both
        in a sentence is the commentary caption the handoff rules out, so the
        explanation lives on the column instead (the side-by-side audit,
        21 Sep 2026).
      */}
      <View>
        <Head cols={VOCAB_COLS} />
        {rows.map((r) => {
          const orphan = r.scope === 'nowhere';
          return (
            <Row key={r.key} onPress={r.sets.length ? () => onOpenSet(r.sets[0]) : undefined}>
              <Cell col={VOCAB_COLS[0]}>
                <Value weight="600" tone={orphan ? 'warn' : 'ink'}>{r.name}</Value>
              </Cell>
              <Cell col={VOCAB_COLS[1]}>
                <Value size={12.5} weight="600"
                  tone={r.scope === 'everywhere' ? 'muted' : orphan ? 'warn' : 'lime'}>
                  {r.scope === 'everywhere' ? 'everywhere'
                    : orphan ? 'nowhere'
                    : `in ${r.sets.length} ${r.sets.length === 1 ? 'set' : 'sets'}`}
                </Value>
              </Cell>
              <Cell col={VOCAB_COLS[2]}>
                <Value tone="muted" size={12.5}>
                  {r.scope === 'everywhere' ? 'every place, every subcategory'
                    : r.sets.join(' · ') || 'approved but never asked'}
                </Value>
              </Cell>
              <Cell col={VOCAB_COLS[3]}>
                <Value numeric tone={r.places ? 'ink' : 'warn'}>{r.places}</Value>
              </Cell>
              <Cell col={VOCAB_COLS[4]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, justifyContent: 'flex-end' }}>
                  {orphan ? <Act label="Ask it in…" onPress={() => onAskIn(r.key)} /> : null}
                  {/* Retiring takes it out of the vocabulary and out of every set. */}
                  {/* Red, like every other irreversible thing on this surface.
                      Retiring a label stops it being asked anywhere and drops
                      it from every set that had it — the prototype draws it
                      red with a red rule and it was grey. */}
                  <Act label="Retire" tone="warn" onPress={() => onRetire(r.key)} />
                </View>
              </Cell>
            </Row>
          );
        })}
      </View>
    </>
  );
}
