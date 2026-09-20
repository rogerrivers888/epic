/**
 * Mapping — where each of Google's words points.
 *
 * Google's place types are a business-listing taxonomy, not a taxonomy of days
 * out. It contains *road bridge*, *building complex*, *staff college* and
 * *cemetery* because maps need them. The screen this replaces counted "485
 * words · 483 answered", so completeness is what it rewarded, and the result
 * was thirteen subcategories that are one Google word each and three junk
 * drawers holding footbridges and parish churches.
 *
 * So three things are true of this screen and were not of the last one
 * (Mapping brief, 20 Sep 2026):
 *
 *  - **Not in Epic is a first-class answer**, counted in the header in lime
 *    beside answered and not-sure, because excluding is progress and not a gap.
 *  - **Every destination states its consequence before the click.** "1,240 in ·
 *    1,180 never opened · joins 3" is the highest-value line on the screen.
 *  - **Places brought in is the default sort**, because it is the blast radius
 *    of a decision: a word bringing 1,240 places deserves more attention than
 *    one bringing three.
 */

import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { Icon, IconName } from '../../components/Icon';
import { Press } from '../../components/press';
import { LIME, ON_LIME, desk, fonts } from '../../theme';
import {
  Act, Band, Cell, Col, DeskPill, Head, Kicker, Mark, Nothing, Row, Value, WARN,
} from './desk';
import { Destination, PickCategory, Picker } from './Picker';
import { SORTS, appliedSays, pointsAt, sortLabel, startsDescending } from './say';
import type { SortKey } from './say';
import type { ExcludedRow, MappingEvidence, WordRow } from './types';

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

const WORD_COLS: Col[] = [
  { w: 250, label: 'Google’s word' },
  { w: 120, label: 'Brings in', align: 'right' },
  { w: 120, label: 'Ever opened', align: 'right' },
  { w: 'auto', label: 'Points at' },
  { w: 250, label: 'Flags' },
];

/** Over this many places, a word's blast radius is worth reading twice. */
const BIG = 100;



export function Words({
  words, counts, evidence, sort, desc, onSort, filters, onFilters, filterOptions,
  picker, undo,
}: {
  words: WordRow[];
  counts: { answered: number; notSure: number; secondary: number; notInEpic: number; flagged: number; words: number };
  /** What the signals could see. An unflagged table is not a clean one. */
  evidence: MappingEvidence | null;
  sort: SortKey;
  desc: boolean;
  onSort: (key: SortKey, desc: boolean) => void;
  /** The filters in play. They combine with AND and show as removable pills. */
  filters: { key: string; name: string }[];
  onFilters: (next: { key: string; name: string }[]) => void;
  /** Everything filterable: states, flags, categories, subcategories, labels. */
  filterOptions: { key: string; name: string; kind: string; note: string }[];
  /** How the row's picker is fed and what it does. */
  picker: {
    categories: PickCategory[];
    subcategoriesIn: (categoryKey: string, word: WordRow) => Destination[];
    labels: (word: WordRow) => Destination[];
    results: (query: string, word: WordRow) => Destination[];
    folds: (word: WordRow) => { key: string; name: string }[];
    onPoint: (word: WordRow, d: Destination) => void;
    onNotInEpic: (word: WordRow) => void;
    onAdopt: (word: WordRow) => void;
    onCarry: (word: WordRow, label: string) => void;
  };
  /** The last change, by name, and how to put it back. */
  undo: { what: string; onPress: () => void } | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [sortMenu, setSortMenu] = useState(false);
  const [filterMenu, setFilterMenu] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const [destQuery, setDestQuery] = useState('');

  const shown = filterOptions.filter((o) => {
    const q = filterQuery.trim().toLowerCase();
    return !q || o.name.toLowerCase().includes(q) || o.kind.toLowerCase().includes(q);
  }).slice(0, 60);

  return (
    <>
      <Band
        title="Where each of Google’s words points"
        stats={[
          { label: 'Answered', value: counts.answered },
          { label: 'Not sure', value: counts.notSure },
          { label: 'Kept as a label', value: counts.secondary },
          { label: 'Flagged', value: counts.flagged, strong: true },
        ]}
        right={
          // Not in Epic is lime and bold: excluding is an answer, and the
          // screen has to stop it reading as a gap in the work.
          <View style={{ gap: 2 }}>
            <Kicker tone="lime">Not in Epic</Kicker>
            <Text style={{
              fontFamily: fonts.body, fontSize: 15, fontWeight: '800', color: LIME,
              fontVariant: ['tabular-nums'],
            }}>
              {counts.notInEpic}
            </Text>
          </View>
        }
      />

      <Blind evidence={evidence} flagged={counts.flagged} />

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <Control
          icon="filters"
          label={filters.length ? `${filters.length} ${filters.length === 1 ? 'filter' : 'filters'}` : 'Filter'}
          lit={filters.length > 0}
          onPress={() => { setFilterMenu(!filterMenu); setSortMenu(false); setFilterQuery(''); }}
        />
        <Control
          icon="list"
          label={sortLabel(sort, desc)}
          onPress={() => { setSortMenu(!sortMenu); setFilterMenu(false); }}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9, flex: 1, minWidth: 0, paddingTop: 2 }}>
          {filters.map((f) => (
            <DeskPill key={f.key} name={f.name} onRemove={() => onFilters(filters.filter((x) => x.key !== f.key))} />
          ))}
          {filters.length === 0 ? (
            <View style={{ paddingTop: 4 }}>
              <Value tone="dim" size={12.5}>{`Everything · ${words.length} words`}</Value>
            </View>
          ) : null}
        </View>
      </View>

      {sortMenu ? (
        <View style={{ width: 460, borderWidth: 1, borderColor: desk.ruleStrong, backgroundColor: desk.well }}>
          {SORTS.map((s) => {
            const on = s.key === sort;
            return (
              <Press key={s.key} effect="none" accessibilityRole="button" accessibilityState={{ selected: on }}
                onPress={() => {
                  onSort(s.key, on ? !desc : startsDescending(s.key));
                  setSortMenu(false);
                }}>
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  paddingVertical: 9, paddingHorizontal: 14,
                  borderBottomWidth: 1, borderBottomColor: desk.rule,
                }}>
                  <View style={{ width: 14 }}>
                    <Icon name={on ? 'check' : 'add'} size={13} color={on ? LIME : desk.ink} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Value size={13} weight={on ? '700' : '500'} tone={on ? 'lime' : 'ink'}>{s.name}</Value>
                  </View>
                  <Value size={11.5} tone="dim">{s.forwards}</Value>
                </View>
              </Press>
            );
          })}
        </View>
      ) : null}

      {filterMenu ? (
        <View style={{ width: 760, borderWidth: 1, borderColor: desk.ruleStrong, backgroundColor: desk.well }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 12,
            paddingVertical: 11, paddingHorizontal: 14,
            borderBottomWidth: 1, borderBottomColor: desk.rule,
          }}>
            <FilterField value={filterQuery} onChange={setFilterQuery} />
            <Act label="close" tone="dim" ruled={false} onPress={() => setFilterMenu(false)} />
          </View>
          <View style={{ maxHeight: 330, paddingVertical: 6 }}>
            {shown.map((o) => {
              const on = filters.some((f) => f.key === o.key);
              return (
                <Press key={o.key} effect="none" accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                  onPress={() => onFilters(on
                    ? filters.filter((f) => f.key !== o.key)
                    : [...filters, { key: o.key, name: o.name }])}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7, paddingHorizontal: 14 }}>
                    <View style={{ width: 14 }}>
                      <Icon name={on ? 'check' : 'add'} size={13} color={on ? LIME : desk.ink} />
                    </View>
                    <View style={{ width: 280, flexGrow: 0, flexShrink: 0, minWidth: 0 }}>
                      <Value size={13} weight={on ? '700' : '500'} tone={on ? 'lime' : 'ink'}>{o.name}</Value>
                    </View>
                    <View style={{ width: 130, flexGrow: 0, flexShrink: 0 }}>
                      <Text style={{
                        fontFamily: fonts.body, fontSize: 11.5, fontWeight: '700',
                        letterSpacing: 0.4, color: desk.inkDim,
                      }}>
                        {o.kind}
                      </Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}><Value size={12} tone="dim">{o.note}</Value></View>
                  </View>
                </Press>
              );
            })}
          </View>
        </View>
      ) : null}

      <View>
        <SortHead cols={WORD_COLS} sort={sort} desc={desc} onSort={onSort} />
        {words.length === 0 ? <Nothing>No words match those filters.</Nothing> : null}
        {words.map((w) => {
          const isOpen = open === w.word;
          return (
            <View key={w.word} style={{
              borderBottomWidth: 1, borderBottomColor: desk.rule,
              backgroundColor: isOpen ? desk.lifted : 'transparent',
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18, paddingVertical: 11, paddingHorizontal: 8 }}>
                <Cell col={WORD_COLS[0]}><Value weight="600">{w.word}</Value></Cell>
                <Cell col={WORD_COLS[1]}>
                  <Value numeric weight={w.brings > BIG ? '800' : '400'}>{w.brings.toLocaleString()}</Value>
                </Cell>
                <Cell col={WORD_COLS[2]}>
                  {/* Never opened is the cleanup signal, so it is red. */}
                  <Value numeric tone={w.opens === 0 ? 'warn' : 'muted'}>
                    {w.opens ? w.opens.toLocaleString() : 'never'}
                  </Value>
                </Cell>
                <Cell col={WORD_COLS[3]}>
                  <Press effect="none" accessibilityRole="button" accessibilityState={{ expanded: isOpen }}
                    onPress={() => { setOpen(isOpen ? null : w.word); setDestQuery(''); }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                      <Value weight="600" tone={w.pointsAt ? 'ink' : w.decision === 'secondary' ? 'muted' : 'lime'}>
                        {pointsAt(w)}
                      </Value>
                      <Icon name="expand" size={13} color={desk.inkDim} strokeWidth={2.2} />
                    </View>
                  </Press>
                </Cell>
                <Cell col={WORD_COLS[4]}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {w.flags.map((f) => (
                      <Mark key={f.key} label={f.name} tone={f.grave ? 'warn' : 'dim'} title={f.why} />
                    ))}
                  </View>
                </Cell>
              </View>

              {isOpen ? (
                <View style={{
                  flexDirection: 'row', gap: 22, alignItems: 'flex-start',
                  paddingTop: 4, paddingBottom: 20, paddingLeft: 268, paddingRight: 8,
                }}>
                  <Picker
                    width={640}
                    categories={picker.categories}
                    subcategoriesIn={(c) => picker.subcategoriesIn(c, w)}
                    labels={picker.labels(w)}
                    results={picker.results(destQuery, w)}
                    query={destQuery}
                    onQuery={setDestQuery}
                    onClose={() => setOpen(null)}
                    onPick={(d) => {
                      if (d.kind === 'label') picker.onCarry(w, d.key);
                      else picker.onPoint(w, d);
                    }}
                    notInEpic={{ on: w.decision === 'notinepic', onPress: () => picker.onNotInEpic(w) }}
                    adopt={{ word: w.word, folds: picker.folds(w), onConfirm: () => picker.onAdopt(w) }}
                  />
                  <View style={{ flex: 1, minWidth: 0, gap: 10 }}>
                    <Kicker>What this word carries</Kicker>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
                      {w.pointsAt ? (
                        <DeskPill name={w.pointsAt.label} onRemove={() => picker.onNotInEpic(w)} />
                      ) : null}
                      {w.labels.map((l) => (
                        <DeskPill key={l} name={l} kind="label" onRemove={() => picker.onCarry(w, l)} />
                      ))}
                    </View>
                    {/*
                      Which of the two things a pick did. A subcategory files
                      the places; a label rides along on every place the word
                      brings — a default, not evidence, and the difference
                      matters when somebody later asks why a place says it has
                      parking.
                    */}
                    <Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim, lineHeight: 19.2 }}>
                      {w.pointsAt
                        ? 'The subcategory files the places. Labels ride along on every place this word brings — a default, not evidence.'
                        : w.decision === 'notinepic'
                          ? `Not in Epic. ${w.brings.toLocaleString()} places stay out, reversible from the excluded list.`
                          : 'Nothing said yet.'}
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20, paddingTop: 4 }}>
        <Value tone="dim" size={12}>click a column header to sort</Value>
        {undo ? <Act label={`Undo · ${undo.what}`} tone="ink" onPress={undo.onPress} /> : null}
      </View>
    </>
  );
}

/**
 * What the signals were working from, when they could not see enough.
 *
 * Drawn only when it changes how the table should be read: a demand signal
 * with too few opens behind it, or rows and drawers that were skipped. One
 * flagged word out of 479 looks like a clean taxonomy and is not.
 */
function Blind({ evidence, flagged }: { evidence: MappingEvidence | null; flagged: number }) {
  if (!evidence) return null;
  const blind = evidence.demandBlind;
  const skipped = evidence.tooThinToJudge + evidence.drawersTooThinToJudge;
  if (!blind && !skipped) return null;
  return (
    <View style={{ borderLeftWidth: 2, borderLeftColor: WARN, paddingLeft: 14, paddingVertical: 4, gap: 4 }}>
      <Value size={13.5} weight="800" tone="warn">
        {flagged
          ? `${flagged} flagged, but the signals could not see everything`
          : 'Nothing is flagged, because the signals could not see'}
      </Value>
      {blind ? (
        <Value size={12.5} tone="muted">
          {`${blind.opens.toLocaleString()} ${blind.opens === 1 ? 'place has' : 'places have'} ever been opened; judging demand needs about ${blind.needs.toLocaleString()}. Until then "nobody goes" would be true of nearly every word, so it is not offered.`}
        </Value>
      ) : null}
      {skipped ? (
        <Value size={12.5} tone="dim">
          {`${evidence.tooThinToJudge} ${evidence.tooThinToJudge === 1 ? 'word' : 'words'} and ${evidence.drawersTooThinToJudge} ${evidence.drawersTooThinToJudge === 1 ? 'drawer' : 'drawers'} held too little to judge · ${evidence.researched.toLocaleString()} of ${evidence.words.toLocaleString()} researched`}
        </Value>
      ) : null}
    </View>
  );
}

/** The header, with the active column carrying its arrow. */
function SortHead({ cols, sort, desc, onSort }: {
  cols: Col[];
  sort: SortKey;
  desc: boolean;
  onSort: (key: SortKey, desc: boolean) => void;
}) {
  const keys: SortKey[] = ['word', 'brings', 'opens', 'points', 'flags'];
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 18,
      borderBottomWidth: 2, borderBottomColor: desk.ruleStrong,
      paddingHorizontal: 8, paddingBottom: 9,
    }}>
      {cols.map((c, i) => {
        const key = keys[i];
        const on = key === sort;
        return (
          <Press key={i} effect="none" accessibilityRole="button"
            onPress={() => onSort(key, on ? !desc : startsDescending(key))}
            style={c.w === 'auto' ? { flex: 1, minWidth: 0 } : { width: c.w, flexGrow: 0, flexShrink: 0 }}>
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              justifyContent: c.align === 'right' ? 'flex-end' : 'flex-start',
            }}>
              <Text style={{
                fontFamily: fonts.body, fontSize: 12.5,
                fontWeight: on ? '800' : '600', color: on ? desk.ink : desk.inkDim,
              }}>
                {c.label}
              </Text>
              {on ? <Icon name={desc ? 'expand' : 'collapse'} size={12} color={LIME} strokeWidth={2.6} /> : null}
            </View>
          </Press>
        );
      })}
    </View>
  );
}

function Control({ label, onPress, lit, icon }: {
  label: string; onPress: () => void; lit?: boolean; icon: IconName;
}) {
  const fg = lit ? LIME : desk.inkMuted;
  return (
    <Press effect="none" onPress={onPress} accessibilityRole="button">
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 10,
        borderWidth: 1.5, borderColor: lit ? LIME : desk.ruleStrong,
        paddingVertical: 9, paddingHorizontal: 14,
      }}>
        <Icon name={icon} size={14} color={fg} strokeWidth={2.2} />
        <Text style={{ fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: fg }}>{label}</Text>
        <Icon name="expand" size={13} color={fg} strokeWidth={2.2} />
      </View>
    </Press>
  );
}

/** `outlineStyle` is web-only and not in react-native's style type. */
const FIELD = {
  flex: 1,
  minWidth: 0,
  backgroundColor: 'transparent',
  color: desk.ink,
  fontFamily: fonts.body,
  fontSize: 13.5,
  fontWeight: '600',
  paddingVertical: 0,
  outlineStyle: 'none',
} as never;

function FilterField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder="Filter by a category, subcategory, label, state or flag"
      placeholderTextColor={desk.inkDim}
      style={FIELD}
    />
  );
}

// ---------------------------------------------------------------------------
// Not in Epic
// ---------------------------------------------------------------------------

const EXCLUDED_COLS: Col[] = [
  { w: 250, label: 'Word' },
  { w: 120, label: 'Would bring', align: 'right' },
  { w: 'auto', label: 'Why it is out' },
  { w: 150, label: '' },
];

/**
 * The excluded list.
 *
 * It exists so that excluding never feels final (Mapping brief §2.3). A
 * decision somebody cannot see and cannot reverse is one they will not make,
 * and "not in Epic" is the right answer for a large fraction of Google's types.
 */
export function NotInEpic({ rows, placesKeptOut, onRestore }: {
  rows: ExcludedRow[];
  placesKeptOut: number;
  onRestore: (word: string) => void;
}) {
  return (
    <>
      <Band
        title={`${rows.length} ${rows.length === 1 ? 'word is' : 'words are'} not in Epic`}
        stats={[{ label: 'Places kept out', value: placesKeptOut.toLocaleString() }]}
      />
      <View>
        <Head cols={EXCLUDED_COLS} />
        {rows.length === 0 ? <Nothing>Nothing is excluded yet.</Nothing> : null}
        {rows.map((r) => (
          <Row key={r.word} padded={false}>
            <Cell col={EXCLUDED_COLS[0]} style={{ paddingVertical: 11 }}>
              <Value weight="600">{r.word}</Value>
            </Cell>
            <Cell col={EXCLUDED_COLS[1]} style={{ paddingVertical: 11 }}>
              <Value numeric>{r.brings.toLocaleString()}</Value>
            </Cell>
            <Cell col={EXCLUDED_COLS[2]} style={{ paddingVertical: 11 }}>
              <Value tone="muted" size={12.5}>{r.why}</Value>
            </Cell>
            <Cell col={EXCLUDED_COLS[3]} style={{ paddingVertical: 11, alignItems: 'flex-end' }}>
              <Act label="Bring it back" ruled={false} onPress={() => onRestore(r.word)} />
            </Cell>
          </Row>
        ))}
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------

export type AuditRow = {
  id: number;
  word: string;
  from: string;
  to: string;
  places: number;
  note: string;
  state: 'open' | 'accepted' | 'rejected';
  /** Proposed but not applicable without a person naming something. */
  advisory: boolean;
};

export type AuditGroup = { key: string; name: string; why: string; rows: AuditRow[] };

/**
 * The audit — scan a list, sign it off.
 *
 * Grouped by the kind of change, because the decision is usually the same for
 * the whole group: forty exclusions of structural map furniture is one
 * decision, not forty.
 *
 * Two things the first production run taught us (epic-1c, 20 Sep 2026) and
 * which the drawing has to carry:
 *
 *  - **An empty run is not a clean taxonomy.** The system held nine opens, so
 *    "never opened" was true of everything and the first run proposed excluding
 *    `restaurant`, `cafe` and `park` under an Accept-all. Where the run could
 *    not see, the screen says so rather than reporting nothing to do.
 *  - **Applying happens once.** A second apply is refused, so Apply disappears
 *    on success and Undo takes its place — and the reply is reported as it
 *    came: "20 applied, 1 still needs you", never as though all were done.
 */
export function Audit({
  groups, effect, applied, blind, onAccept, onReject, onAcceptGroup, onApply, onUndo, onOpenWord,
}: {
  groups: AuditGroup[];
  /** The live consequence of what is accepted so far. */
  effect: { head: string; sub: string; lit: boolean }[];
  /** What the last apply did, or null if it has not been applied. */
  applied: { applied: number; advisory: number } | null;
  /**
   * What the run could not see. Present when demand is too thin for
   * "never opened" to mean anything, or when drawers were too thin to judge.
   */
  blind: { says: string; opens: number; needs: number } | null;
  onAccept: (id: number) => void;
  onReject: (id: number) => void;
  onAcceptGroup: (key: string) => void;
  onApply: () => void;
  onUndo: () => void;
  onOpenWord: (word: string) => void;
}) {
  const open = groups.reduce((n, g) => n + g.rows.filter((r) => r.state === 'open').length, 0);

  return (
    <>
      <Band
        title={`${open} proposed ${open === 1 ? 'change' : 'changes'}`}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            {applied ? (
              <>
                {/* Reported as it came back, not as it was asked for. */}
                <Value size={12.5} weight="700" tone="muted">
                  {appliedSays(applied.applied, applied.advisory)}
                </Value>
                <Act label="Undo the whole audit" tone="ink" onPress={onUndo} />
              </>
            ) : (
              <Press effect={open ? 'sink' : 'none'} accessibilityRole="button"
                accessibilityState={{ disabled: !open }} onPress={() => { if (open) onApply(); }}>
                <View style={{
                  backgroundColor: open ? LIME : desk.off,
                  paddingVertical: 11, paddingHorizontal: 18,
                }}>
                  <Text style={{
                    fontFamily: fonts.body, fontSize: 13, fontWeight: '700',
                    color: open ? ON_LIME : desk.inkDim,
                  }}>
                    Sign the audit off
                  </Text>
                </View>
              </Press>
            )}
          </View>
        }
      />

      {/*
        "I could not see" is a different answer from "there is nothing wrong",
        and the screen must never let the second stand in for the first.
      */}
      {blind ? (
        <View style={{ borderLeftWidth: 2, borderLeftColor: WARN, paddingLeft: 14, paddingVertical: 4, gap: 4 }}>
          <Value size={13.5} weight="800" tone="warn">{blind.says}</Value>
          <Value size={12.5} tone="muted">
            {`${blind.opens} ${blind.opens === 1 ? 'place has' : 'places have'} ever been opened; this signal needs about ${blind.needs}.`}
          </Value>
        </View>
      ) : null}

      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 30,
        borderBottomWidth: 1, borderBottomColor: desk.rule, paddingBottom: 16,
      }}>
        <Kicker>If you sign this off</Kicker>
        {effect.map((e) => (
          <View key={e.head} style={{ gap: 2 }}>
            <Value size={13.5} weight="700" tone={e.lit ? 'lime' : 'dim'}>{e.head}</Value>
            <Value size={11.5} tone="dim">{e.sub}</Value>
          </View>
        ))}
      </View>

      {groups.length === 0 ? <Nothing>The audit found nothing to propose.</Nothing> : null}
      {groups.map((g) => {
        const undecided = g.rows.filter((r) => r.state === 'open');
        return (
          <View key={g.key} style={{ gap: 11, paddingTop: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 16 }}>
              <Kicker>{g.name}</Kicker>
              <View style={{ flex: 1, height: 1, backgroundColor: desk.rule }} />
              <Value size={11.5} tone="dim">{g.why}</Value>
              <Act
                label={undecided.length ? `Accept all ${undecided.length}` : 'all decided'}
                tone={undecided.length ? 'lime' : 'dim'}
                ruled={undecided.length > 0}
                onPress={() => { if (undecided.length) onAcceptGroup(g.key); }}
              />
            </View>
            <View>
              {g.rows.map((r) => {
                const decided = r.state !== 'open';
                return (
                  <View key={r.id} style={{
                    flexDirection: 'row', alignItems: 'center', gap: 18,
                    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: desk.rule,
                    opacity: decided ? 0.5 : 1,
                  }}>
                    <View style={{ width: 230, flexGrow: 0, flexShrink: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Value weight="600">{r.word}</Value>
                        {/* Proposed, but not applicable until somebody names the halves. */}
                        {r.advisory ? <Mark label="NEEDS YOU" tone="dim" title="This one cannot be applied automatically." /> : null}
                      </View>
                    </View>
                    <View style={{ width: 230, flexGrow: 0, flexShrink: 0 }}>
                      <Value size={12.5} tone="dim">{r.from}</Value>
                    </View>
                    <View style={{ width: 270, flexGrow: 0, flexShrink: 0 }}>
                      <Value size={13} weight="700" tone={r.state === 'accepted' ? 'lime' : r.state === 'rejected' ? 'dim' : 'ink'}>
                        {r.to}
                      </Value>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Value size={12} tone="dim">{`${r.places.toLocaleString()} places · ${r.note}`}</Value>
                    </View>
                    <View style={{
                      width: 210, flexGrow: 0, flexShrink: 0, flexDirection: 'row',
                      alignItems: 'center', gap: 14, justifyContent: 'flex-end',
                    }}>
                      <Act label={r.state === 'accepted' ? 'accepted' : 'Accept'} tone="lime"
                        ruled={!decided} onPress={decided ? undefined : () => onAccept(r.id)} />
                      <Act label={r.state === 'rejected' ? 'rejected' : 'Reject'}
                        tone={r.state === 'rejected' ? 'ink' : 'dim'} ruled={false}
                        onPress={decided ? undefined : () => onReject(r.id)} />
                      <Act label="open it" tone="dim" ruled={false} onPress={() => onOpenWord(r.word)} />
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}
    </>
  );
}
