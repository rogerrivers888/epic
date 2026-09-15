/**
 * Categories — one category at a time: its subcategories, the attributes that
 * put a place in each, and every provider's words lined up against them.
 *
 * The owner, 12 Sep 2026: "I'd like to have a screen where I can manage
 * categories and subcategories… for each category or subcategory, add the
 * combination of labels that determine whether that particular activity lives
 * in that particular subcategory… view all of our providers, categories, and
 * subcategories… map [ours] to the providers' subcategories."
 *
 * And, on the first draft, the same day: "I want to select a category in the
 * drop-down box. I don't want you just showing a huge scroll ever. Just let me
 * select a category and let me see the attributes for that category." And: "I
 * hate this design… these big white boxes, the buttons with white boxes
 * around them."
 *
 * So the screen is one category, chosen from a control at the top, and three
 * ways of looking at it: its subcategories with their attributes in one table,
 * every provider's words that land in it, and a search for any word. Nothing
 * is boxed. The design follows what the research and the owner's own earlier
 * handover agree on (NN/g on visual hierarchy: borders and backgrounds
 * sparingly, whitespace and weight do the work, at most three type sizes;
 * NN/g on tables: hairlines to track rows, a human-readable first column, and
 * edit in a panel beside the table rather than a modal; handover v8: "control
 * rows are plain text with chevrons, never boxed buttons"). The one ink rule
 * is the section rule; rows are 1px hairlines; the only filled things are the
 * selected row, the chosen labels, and the one primary button.
 *
 * A label is one thing one source said (`google:museum`, `osm:leisure=ice_rink`,
 * `wikidata:Q23413`) or one of Epic's own derived words (`experience:museum`).
 * A rule says: places carrying *all* of these labels go in this subcategory.
 * Narrowest wins — one place, then a combination, then a Wikidata type, then
 * the atlas word, then the experience (domain/labels.js, domain/moods.js).
 *
 * Layout follows the shell's rule (CLAUDE.md): width from `useViewport`, one
 * tree with different styles rather than two returns, nothing over 390px.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import {
  api, AttributeValue, MoodKey, SecondaryLabel, NotSurePlace, NotSureRun, PlaceAttribute, PlacePart, ShelfSubcategory, Taxonomy, TaxonomyAttributes, TaxonomyExamples, TaxonomyLabel, TaxonomyLanding, TaxonomyMatrix, TaxonomyMatrixEntry,
  TaxonomyRule, TaxonomyTry,
} from '../../api';
import { colors, spacing, type, BORDER } from '../../theme';
import { Icon } from '../../components/Icon';
import { Button, FoldLine } from '../../components/ui';
import { useViewport } from '../../hooks/useViewport';
import { AdminPage, DrillDropdown, Dropdown, PageHead, ago, count } from '../kit';
import { Shelves } from './Shelves';
import { asOneOf, asText, useQueryState } from '../../router';

const WIDE = 900;

type View_ = 'subcategories' | 'providers' | 'google' | 'words' | 'left';
/** The three doors across the top: a provider's words, ours, and the categories. */
type Door = 'words' | 'ours' | 'cats' | 'notsure' | 'shelves';
const VIEWS: { key: View_; label: string; short: string; needsCategory: boolean }[] = [
  { key: 'subcategories', label: 'Our categories', short: 'Ours', needsCategory: true },
  { key: 'providers', label: 'Providers\' words, one of ours', short: 'Providers', needsCategory: true },
  { key: 'google', label: 'Google mapped to ours', short: 'Google', needsCategory: false },
  { key: 'left', label: 'What is left, hardest first', short: 'What is left', needsCategory: false },
  { key: 'words', label: 'Find a word', short: 'Find a word', needsCategory: false },
];

/** What decided where a word lands, in words. */
const HOW_WORD: Record<TaxonomyLanding['how'], string> = {
  taught: 'a rule', default: 'the code\'s own map', fallback: 'nothing knew it', none: 'not a place on its own',
};

/** What a rule is about, by where it is written. */
const SCOPE_WORD: Record<string, string> = {
  place: 'this one place',
  labels: 'every place carrying all of these',
  kind: 'every place of this Wikidata type',
  category: 'every place the atlas calls this',
  experience: 'every place read as this experience',
};

/** The sources, said the short way beside a word. */
const SOURCE_WORD: Record<string, string> = {
  google: 'Google', osm: 'OpenStreetMap', wikidata: 'Wikidata', tripadvisor: 'Tripadvisor', ticketmaster: 'Ticketmaster',
  seatgeek: 'SeatGeek', predicthq: 'PredictHQ', datathistle: 'Data Thistle', atlas: 'Atlas word', experience: 'Experience',
  venue: 'Venue kind', style: 'Style', flag: 'Flag',
};

const nsOf = (label: string) => label.split(':')[0];
const keyOf = (label: string) => label.split(':').slice(1).join(':');
const sourceWord = (ns: string) => SOURCE_WORD[ns] ?? ns;

// ---------------------------------------------------------------------------
// the quiet pieces: a rule, a hairline, a word, a text action
// ---------------------------------------------------------------------------

/** A section: a small heading over one ink rule. No box. */
function Section({ title, right, children, style }: { title: string; right?: React.ReactNode; children: React.ReactNode; style?: object }) {
  return (
    <View style={[{ gap: 0 }, style]}>
      <View style={styles.sectionHead}>
        <Text style={styles.kicker}>{title}</Text>
        <View style={{ flex: 1 }} />
        {right}
      </View>
      {children}
    </View>
  );
}

/** An action said as a word, not drawn as a box. */
function TextAction({ label, onPress, disabled, tone = 'ink' }: { label: string; onPress: () => void; disabled?: boolean; tone?: 'ink' | 'muted' }) {
  return (
    <Press onPress={onPress} disabled={disabled} accessibilityRole="button" hitSlop={6} style={{ opacity: disabled ? 0.4 : 1 }}>
      <Text style={[styles.action, tone === 'muted' && { color: colors.inkMuted }]}>{label}</Text>
    </Press>
  );
}

/** One of a few choices in a line: the chosen one is a flat lime word. */
function Choice({ label, on, onPress }: { label: string; on: boolean; onPress?: () => void }) {
  return (
    <Press effect="none" onPress={onPress} disabled={!onPress} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.choice, on && styles.choiceOn]}>
      <Text style={[type.small, { color: on ? colors.selectedFg : colors.inkMuted, fontWeight: on ? '700' : '500' }]}>{label}</Text>
    </Press>
  );
}

/** A label as words: the source in grey, the word in ink. */
function Word({ label, name, muted }: { label: string; name?: string | null; muted?: boolean }) {
  const key = keyOf(label);
  return (
    <Text style={[type.small, muted && { color: colors.inkMuted }]} numberOfLines={1}>
      <Text style={{ color: colors.inkMuted }}>{sourceWord(nsOf(label))} · </Text>
      <Text style={{ fontWeight: '600', color: muted ? colors.inkMuted : colors.ink }}>{name && name !== key ? name : key}</Text>
      {name && name !== key ? <Text style={{ color: colors.inkMuted }}> {key}</Text> : null}
    </Text>
  );
}

/** A label that has been chosen: a flat lime-tint token with an × — the only filled thing in a form. */
/**
 * One label, with a way to take it off. **Not a pill.**
 *
 * "Labels are not pills. The primary label carries weight and a lime underline;
 * secondary labels are plain text... This was considered and settled — pills
 * would be a deliberate reversal of the standing instruction." It was a solid
 * lime pill until the audit found it (15 Sep 2026).
 */
function Token({ label, name, onRemove }: { label: string; name?: string | null; onRemove?: () => void }) {
  const key = keyOf(label);
  return (
    <View style={styles.token}>
      <Text style={type.small}>
        {nsOf(label) === 'epic' ? null : <Text style={{ color: colors.inkMuted }}>{sourceWord(nsOf(label))} · </Text>}
        <Text style={{ fontWeight: '700' }}>{name && name !== key ? name : key}</Text>
      </Text>
      {onRemove ? (
        <Press onPress={onRemove} hitSlop={8} accessibilityLabel={`Remove ${name ?? key}`}><Icon name="close" size={13} color={colors.ink} /></Press>
      ) : null}
    </View>
  );
}

/** A text field with one rule under it, not a box round it. */
function Field({ value, onChangeText, placeholder, autoFocus, onSubmitEditing, style, icon }: {
  value: string; onChangeText: (t: string) => void; placeholder?: string; autoFocus?: boolean; onSubmitEditing?: () => void; style?: object; icon?: 'search';
}) {
  return (
    <View style={[styles.field, style]}>
      {icon ? <Icon name={icon} size={14} color={colors.inkMuted} /> : null}
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.inkMuted}
                 autoFocus={autoFocus} onSubmitEditing={onSubmitEditing} style={styles.fieldInput} />
    </View>
  );
}

// ---------------------------------------------------------------------------

export function Categories({ canManage, startAt }: { canManage: boolean; startAt?: Door }) {
  const { width } = useViewport();
  const wide = width >= WIDE;

  const [tax, setTax] = useState<Taxonomy | null>(null);
  // Which category, which view, which subcategory is open — all in the address.
  const [cat, setCat] = useQueryState<string>('cat', '', asText);
  const [view, setView] = useQueryState<View_>('view', 'subcategories', asOneOf(['subcategories', 'providers', 'google', 'words', 'left'] as const, 'subcategories'));
  /** Which of the three doors is open (the handoff, 14 Sep 2026). */
  const [door, setDoor] = useQueryState<Door>('door', 'words', asOneOf(['words', 'ours', 'cats', 'notsure', 'shelves'] as const, 'words'));

  // Anyone arriving on the old /admin/shelves address gets the door it became,
  // rather than the words list they did not ask for. The address is read by the
  // router and handed down, never read here.
  useEffect(() => { if (startAt && door !== startAt) setDoor(startAt); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  /**
   * The door decides which views are behind it, so a door and a view that do
   * not go together would draw nothing at all — which is what a clean address
   * with no query on it used to do (Codex, 14 Sep 2026). The view is read
   * through the door rather than beside it.
   */
  const BEHIND: Record<Door, View_[]> = { words: ['google', 'left', 'providers', 'words'], ours: [], cats: ['subcategories'], notsure: [], shelves: [] };
  const shown: View_ = BEHIND[door].includes(view) ? view : (BEHIND[door][0] ?? view);
  const [sub, setSub] = useQueryState<string>('sub', '', asText);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The Google view, read by Google's categories or by ours. */
  const [by, setBy] = useQueryState<'google' | 'ours' | 'subs'>('by', 'google', asOneOf(['google', 'ours', 'subs'] as const, 'google'));
  /** A rule being written from a word, outside the subcategory column. */
  const [editing, setEditing] = useState<{ labels: string[]; subcategory: string | null } | null>(null);

  const load = useCallback(async () => {
    try { setTax(await api.taxonomy()); }
    catch (err) { setNote(String((err as Error).message)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  /** Our secondary labels, so a screen can name one rather than print its key. */
  const [ourSecondary, setOurSecondary] = useState<PlaceAttribute[]>([]);
  useEffect(() => {
    let live = true;
    void api.taxonomyAttributes().then((d) => { if (live) setOurSecondary(d.attributes.filter((a) => a.active)); }).catch(() => null);
    return () => { live = false; };
  }, []);

  const categories = tax?.categories ?? [];
  // How many of a provider's words there are and how many are answered, for the
  // door's own sub-line. Read once when the screen loads.
  const [googleCount, setGoogleCount] = useState('Google’s list');
  const [notSureCount, setNotSureCount] = useState('none waiting');
  useEffect(() => {
    let live = true;
    void api.taxonomyNotSure()
      .then((d) => {
        if (!live) return;
        const waiting = d.counts.waiting ?? 0; const answered = d.counts.answered ?? 0;
        setNotSureCount(waiting || answered ? `${waiting} waiting · ${answered} answered` : 'none waiting');
      })
      .catch(() => null);
    return () => { live = false; };
  }, [note]);
  useEffect(() => {
    let live = true;
    void api.taxonomyLabels({ namespace: 'google', all: true, limit: 2000 })
      .then((d) => {
        if (!live) return;
        const answered = d.labels.filter((r) => r.decision || r.landing.subcategory).length;
        setGoogleCount(`${d.labels.length} · ${answered} answered`);
      })
      .catch(() => null);
    return () => { live = false; };
  }, []);
  // No category until one is chosen (owner, 12 Sep 2026: "it should probably
  // be empty when I arrive on the page and I select the category").
  const category = categories.find((c) => c.key === cat) ?? null;
  // Our labels has no views behind it and needs no category. Without this it
  // inherits the fallback view's requirement and asks you to pick one that is
  // not on screen (Codex, 14 Sep 2026).
  const needsCategory = door === 'cats' && (VIEWS.find((v) => v.key === shown)?.needsCategory ?? false);
  const subs = category?.subcategories ?? [];
  const chosen = subs.find((s) => s.key === sub) ?? null;
  const rulesOf = (key: string) => (tax?.rules ?? []).filter((r) => r.subcategory === key);

  /**
   * What just happened, and the way back from it.
   *
   * The prototype specifies this and it was missing: a lime band at the foot
   * with a tick, what changed, and **Undo**, gone after four seconds. The
   * README says BO1's behaviour is "specified by the prototype, not by prose",
   * and undo is one of the six things it lists.
   */
  const [toast, setToast] = useState<{ text: string; undo?: () => Promise<void> } | null>(null);
  const changed = async (said: string, undo?: () => Promise<void>) => {
    setNote(said);
    setToast({ text: said, undo });
    await load();
  };
  const run = async (what: () => Promise<unknown>, said: string) => {
    setBusy(true);
    try { await what(); await changed(said); }
    catch (err) { setNote(String((err as Error).message)); }
    finally { setBusy(false); }
  };

  const catLabel = (key: string | null | undefined) => tax?.categories.find((c) => c.key === key)?.label ?? key ?? '—';
  const subLabel = (key: string | null | undefined) => tax?.subcategories.find((s) => s.key === key)?.label ?? null;

  return (
    <AdminPage>
      {/* Three doors, one screen: a provider's words, our own labels, and the
          eight categories. The head that used to sit here is now the band under
          whichever door is open (the handoff, 14 Sep 2026). */}
      <Doors
        at={door}
        on={(d) => { setDoor(d); setEditing(null); if (d === 'words') setView('google'); if (d === 'cats') setView('subcategories'); }}
        counts={{
          words: googleCount,
          ours: `${(tax?.subcategories ?? []).filter((x) => x.active).length} primary`,
          cats: String((tax?.categories ?? []).filter((c) => c.active).length),
          notsure: notSureCount,
          shelves: 'what the rules actually did',
        }}
      />

      {/* The controls, left-aligned, each panel hanging directly under its own box
          (owner, 12 Sep 2026: "they should both be left-aligned with the start of the text"). */}
      <View style={[styles.line, { flexWrap: 'wrap', gap: spacing.lg, zIndex: 20 }, (door === 'ours' || door === 'shelves') && { display: 'none' }]}>
        {/* The door decides the view, so Show only offers the ways of looking
            *within* it: the provider matrix and Find a word live behind Google's
            words (14 Sep 2026). */}
        {door === 'words' ? (
          <Dropdown label="Show" value={VIEWS.find((v) => v.key === shown)?.label ?? ''} width={300}
                    options={VIEWS.filter((v) => v.key !== 'subcategories').map((v) => ({ key: v.key, label: v.label, on: v.key === shown }))}
                    onPick={(k) => { setView(k as View_); setEditing(null); }} />
        ) : null}
        {needsCategory ? (
          <Dropdown label="Category" value={category?.label ?? 'Select a category'} width={240}
                    options={categories.map((c) => ({ key: c.key, label: c.label, count: `${c.subcategories.length}`, on: c.key === category?.key }))}
                    onPick={(k) => { setCat(k); setSub(''); setEditing(null); }} />
        ) : null}
        {shown === 'subcategories' && !wide && subs.length ? (
          <Dropdown label="Subcategory" value={chosen?.label ?? 'All'} width={260}
                    options={[{ key: '', label: 'All subcategories', on: !chosen }, ...subs.map((s) => ({ key: s.key, label: s.label, count: `${s.rules ?? 0}`, on: s.key === chosen?.key }))]}
                    onPick={(k) => setSub(k)} />
        ) : null}
        {shown === 'google' ? (
          <Dropdown label="By" value={by === 'ours' ? 'our categories' : by === 'subs' ? 'our subcategories' : "Google's categories"} width={240}
                    options={[
                      { key: 'google', label: "Google's categories", on: by === 'google' },
                      { key: 'ours', label: 'Our categories', on: by === 'ours' },
                      // BO1i draws our 59 as the rows, not the eight cabinets
                      // above them (the audit, 15 Sep 2026).
                      { key: 'subs', label: 'Our subcategories', on: by === 'subs' },
                    ]}
                    onPick={(k) => setBy(k as 'google' | 'ours' | 'subs')} />
        ) : null}
      </View>

      {door !== 'ours' && category && (shown === 'subcategories' || shown === 'providers') ? (
        <View style={styles.catLine}>
          <Text style={[type.small, { flex: 1, minWidth: 200 }]}>
            {category.blurb ? `${category.blurb} ` : ''}
            <Text style={{ color: colors.inkMuted }}>
              {subs.length} subcategor{subs.length === 1 ? 'y' : 'ies'} · {subs.reduce((n, s) => n + (s.rules ?? 0), 0)} rules
              {category.is_door ? ' · a door into Places' : ''}{!category.active ? ' · switched off' : ''}
            </Text>
          </Text>
          {canManage && (tax?.rules ?? []).some((r) => r.subcategory && subs.some((s) => s.key === r.subcategory) && r.labelList.some((l) => l.label.startsWith('wikidata:') && !l.name)) ? (
            <TextAction label="Name the Wikidata types" tone="muted" disabled={busy}
                        onPress={() => void run(async () => { const r = await api.shelfNameKinds(600); if (!r.named) throw new Error('Every type here already has a name.'); return r; }, 'Named the types from Wikidata.')} />
          ) : null}
          {canManage ? (
            <TextAction label={category.active ? 'Switch off' : 'Switch on'} tone="muted" disabled={busy}
                        onPress={() => void run(() => api.shelfSaveCategory({ key: category.key, active: !category.active }),
                          `${category.label} is ${category.active ? 'off the home screen' : 'back on the home screen'}.`)} />
          ) : null}
        </View>
      ) : null}

      {note ? <Text style={[type.small, styles.note]}>{note}</Text> : null}
      <Toast at={toast} onGone={() => setToast(null)} />

      {editing && tax ? (
        <RuleEditor key={editing.labels.join('+')} tax={tax} start={editing.labels} startSubcategory={editing.subcategory} fixedSubcategory={null}
                    canManage={canManage} onClose={() => setEditing(null)} onSaved={async (said) => { setEditing(null); await changed(said); }} />
      ) : null}

      {!tax ? <Text style={type.small}>Loading…</Text> : null}
      {needsCategory && tax && !category ? <Text style={[type.small, { color: colors.inkMuted }]}>Select a category above.</Text> : null}

      {door === 'cats' && tax && category && shown === 'subcategories' ? (
        <View style={[styles.split, wide && styles.splitWide]}>
          {/* Every subcategory of this category with its secondary labels, in one table. */}
          <Section title="Subcategories and what fills them" style={{ flex: 1, minWidth: 0 }}
                   right={canManage ? <AddSubcategory category={category.key as MoodKey} label={category.label} busy={busy} run={run} /> : undefined}>
            {subs.length === 0 ? <Text style={[type.small, styles.emptyRow]}>No subcategories yet.</Text> : null}
            {subs.filter((s) => wide || !chosen || s.key === chosen.key).map((s) => {
              const rules = rulesOf(s.key);
              const words = rules.flatMap((r) => r.scope === 'place' ? [r.subject_label ?? r.subject] : r.labelList.map((l) => l.name ?? keyOf(l.label)));
              const on = chosen?.key === s.key;
              return (
                <Press key={s.id} effect="none" onPress={() => setSub(on ? '' : s.key)} accessibilityRole="button" accessibilityState={{ selected: on }}
                       style={[styles.subRow, !wide && styles.subRowNarrow, on && styles.subRowOn]}>
                  <View style={[styles.subName, wide && { width: 200, flexGrow: 0 }]}>
                    <Text style={[type.small, { fontWeight: '700' }]}>{s.label}</Text>
                    <Text style={type.tiny}>
                      {[wide ? null : `${rules.length} rule${rules.length === 1 ? '' : 's'}`, s.indoor === true ? 'indoors' : s.indoor === false ? 'outdoors' : null, s.for_kids === true ? 'for kids' : null, !s.active ? 'off' : null].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <View style={[styles.attrs, wide ? { flex: 1, minWidth: 0 } : { width: '100%' }]}>
                    {/* Plain text on one line separated by middots. These are the
                        words the rules name, which are neither pills nor
                        secondary labels; calling them either was the three-way
                        confusion the vocabulary rule exists to stop (the audit,
                        15 Sep 2026). */}
                    {words.length ? (
                      <Text style={type.small} numberOfLines={wide ? 3 : 4}>
                        {words.slice(0, wide ? 14 : 8).join(' · ')}
                        {words.length > (wide ? 14 : 8) ? <Text style={{ color: colors.inkMuted }}>{` · +${words.length - (wide ? 14 : 8)} more`}</Text> : null}
                      </Text>
                    ) : (
                      <Text style={[type.small, { color: colors.inkMuted }]}>Nothing fills it yet — only places moved here by hand.</Text>
                    )}
                  </View>
                  {wide ? <Text style={[type.tiny, styles.subCount]}>{rules.length}</Text> : null}
                  {wide ? <Icon name={on ? 'collapse' : 'more'} size={14} color={colors.inkMuted} /> : null}
                </Press>
              );
            })}
          </Section>

          {chosen ? (
            <SubcategoryDetail key={chosen.id} sc={chosen} tax={tax} rules={rulesOf(chosen.key)} canManage={canManage} busy={busy} run={run} wide={wide}
                               onChanged={changed} onClose={() => setSub('')} />
          ) : null}
        </View>
      ) : null}

      {door === 'words' && tax && category && shown === 'providers' ? (
        <ProviderWords tax={tax} category={category.key} wide={wide} subLabel={subLabel}
                       onPick={(label, subcategory) => setEditing({ labels: [label], subcategory })} />
      ) : null}

      {door === 'words' && tax && (shown === 'google' || shown === 'left') ? (
        <GoogleView tax={tax} wide={wide} roomy={width >= 1200} by={by} view={shown} catLabel={catLabel} subLabel={subLabel} canManage={canManage} onChanged={changed} />
      ) : null}

      {door === 'words' && tax && shown === 'words' ? (
        <FindWord tax={tax} catLabel={catLabel} subLabel={subLabel} canManage={canManage}
                  onPick={(label, subcategory) => setEditing({ labels: [label], subcategory })} />
      ) : null}

      {/* Shelves was its own rail item with a tab called Categories, beside this
          screen's own (owner, 13 Sep 2026: merge them). It is the same work seen
          from the other end — the words and the rules are written here, and what
          they actually did to real places is behind this door. */}
      {door === 'shelves' ? <Shelves canManage={canManage} embedded /> : null}

      {tax && door === 'ours' ? (
        <OurLabels tax={tax} wide={wide} canManage={canManage} onChanged={changed} />
      ) : null}

      {tax && door === 'notsure' ? (
        <>
          <NotSure tax={tax} wide={wide} canManage={canManage} onChanged={changed} />
          <PartsOfPlaces canManage={canManage} tax={tax} secondary={ourSecondary} onChanged={changed} />
        </>
      ) : null}

      <View style={{ marginTop: spacing.md }}>
        <FoldLine label="How this works" value="labels, rules, and what wins">
          <View style={{ gap: spacing.xs, paddingVertical: spacing.xs }}>
            <Text style={type.small}>
              A place carries labels: what each source called it, in that source's own words (Google's type, the map's tag, the
              Wikidata type), plus what Epic read those into (an experience, a venue kind). Those are the secondary labels.
            </Text>
            <Text style={type.small}>
              A rule says: places carrying all of these labels go in this subcategory. Narrowest wins — a rule about one place,
              then a combination of labels, then a Wikidata type, then the atlas word, then the experience. Naming a subcategory
              settles the category, because a subcategory has exactly one home.
            </Text>
            <Text style={type.small}>
              One place, one subcategory, one home category. That never changes, and it is what stops the same place being
              counted twice. A subcategory may still be shown in more than one category: Skateboard park lives in Sport and is
              listed under Fun and Outdoors, so somebody who opens Fun hoping for a skate park finds one. Set that on the
              subcategory itself, under “Also show it in”.
            </Text>
            <Text style={type.small}>
              Where several categories are drawn at once — Inspire's carousels, a trip's Activities lanes — each place is given
              to one of them, its home if that lane is on screen, so nothing is ever drawn twice. Where one category is open on
              its own, everything listed under it shows, including the drawers whose home is elsewhere. The count on a category
              is what is behind it, which is why it can be larger than the row of cards above it.
            </Text>
            <Text style={type.small}>
              Rename freely: keys never change. Move a subcategory and every place in it moves. Teach the type, not the place —
              one rule against “castle” answers for every castle. Switch off rather than delete.
            </Text>
            <Text style={type.small}>
              Google's categories: Google has 20 categories and 478 subcategories of its own (its "types"). A Google subcategory
              is mapped once it has one of our subcategories, or is excluded from Epic, or is travel (stations, airports,
              parking), or useful nearby (a loo, a visitor centre). Whole categories that are plainly not for Epic — car dealers,
              banks, plumbers, petrol stations — and the travel and nearby kinds are decided by Epic without asking; the rest
              Epic maps where it is sure, and only the judgement calls wait for you.
            </Text>
            <Text style={type.small}>
              The fifth answer is “a secondary label, not a category”. Some of Google's words describe a place without saying what
              kind of place it is: tourist attraction, adventure sports centre, establishment. They cannot decide which
              subcategory a place goes in, so marking one takes it out of the mapping queue and stops any rule filing by it.
              What it still does is describe: the word stays on the place and hands out whatever it tells us. Open one and
              “the words it catches” lists the specific words seen on the same places, each mappable from there. Use Showing to
              find every word with the same answer.
            </Text>
            <Text style={type.small}>
              Examples is one live Google search near your home, fenced to that word. It shows real places, what else Google
              calls them, and where each of those words lands. Nothing is stored and it costs one provider call, so it only ever
              happens on a press. It is the honest way to settle what one of Google's words actually holds: it is how event
              venue turned out to be a room you hire, and dance hall a dance class.
            </Text>
          </View>
        </FoldLine>
      </View>
    </AdminPage>
  );
}

/** "Add a subcategory", as a word that opens a field. */
function AddSubcategory({ category, label, busy, run }: { category: MoodKey; label: string; busy: boolean; run: (what: () => Promise<unknown>, said: string) => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const save = () => {
    const l = name.trim(); setAdding(false); setName('');
    if (l) void run(() => api.shelfSaveSubcategory({ categoryKey: category, label: l }), `Added ${l} under ${label}.`);
  };
  if (!adding) return <TextAction label="Add a subcategory" onPress={() => setAdding(true)} disabled={busy} />;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <Field value={name} onChangeText={setName} placeholder="Farm shops & pick your own" autoFocus onSubmitEditing={save} style={{ minWidth: 200 }} />
      <TextAction label="Add" onPress={save} disabled={!name.trim()} />
      <TextAction label="Cancel" tone="muted" onPress={() => { setAdding(false); setName(''); }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// one subcategory: its settings, what fills it, and a way to add a rule
// ---------------------------------------------------------------------------

function SubcategoryDetail({ sc, tax, rules, canManage, busy, run, wide, onChanged, onClose }: {
  sc: ShelfSubcategory; tax: Taxonomy; rules: TaxonomyRule[]; canManage: boolean; busy: boolean;
  run: (what: () => Promise<unknown>, said: string) => Promise<void>; wide: boolean;
  onChanged: (said: string, undo?: () => Promise<void>) => Promise<void>; onClose: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(sc.label);
  const [moving, setMoving] = useState(false);
  const [adding, setAdding] = useState(false);
  /**
   * BO8 — what would land here, before you save. Twelve real places fetched
   * once against the busiest provider word pointing at this drawer, each marked
   * settled or not sure. Eight of twelve water parks were settled by the words;
   * the four that were not go on the not-sure list rather than being quietly
   * filed wrong. It costs a provider call, so it happens on a press.
   */
  const [landing, setLanding] = useState<TaxonomyExamples | null>(null);
  const [looking, setLooking] = useState(false);
  const busiest = useMemo(() => {
    const words = rules
      .filter((r) => r.scope === 'labels' || r.scope === 'ours')
      .flatMap((r) => r.labelList.map((l) => l.label))
      .filter((l) => l.startsWith('google:'));
    return words[0] ?? null;
  }, [rules]);
  const lookAtIt = async () => {
    if (!busiest) return;
    setLooking(true);
    try { setLanding(await api.taxonomyExamples(busiest, true)); await onChanged(`Looked at ${busiest.replace('google:', '')}.`); }
    catch (err) { await onChanged(String((err as Error).message)); }
    finally { setLooking(false); }
  };

  const rename = () => { setRenaming(false); void run(() => api.shelfSaveSubcategory({ id: sc.id, label: name.trim() || sc.label }), `Renamed to ${name.trim() || sc.label}.`); };
  const tri = (field: 'indoor' | 'forKids', value: boolean | null | undefined, word: string) => (
    <View style={styles.line}>
      <Text style={[type.tiny, { width: 64 }]}>{word}</Text>
      {([['Yes', true], ['No', false], ['Depends', 'unset']] as const).map(([l, v]) => (
        <Choice key={l} label={l} on={v === 'unset' ? value == null : value === v}
                onPress={canManage ? () => void run(() => api.shelfSaveSubcategory({ id: sc.id, [field]: v } as never), `${sc.label}: ${word.toLowerCase()} — ${l.toLowerCase()}.`) : undefined} />
      ))}
    </View>
  );

  return (
    <Section title={sc.label} style={[styles.detail, wide && styles.detailWide]} right={<TextAction label="Close" tone="muted" onPress={onClose} />}>
      {canManage ? (
        <View style={styles.line}>
          {renaming ? (
            <>
              <Field value={name} onChangeText={setName} autoFocus onSubmitEditing={rename} style={{ flex: 1, minWidth: 160 }} />
              <TextAction label="Save" onPress={rename} />
              <TextAction label="Cancel" tone="muted" onPress={() => setRenaming(false)} />
            </>
          ) : (
            <>
              <TextAction label="Rename" onPress={() => { setName(sc.label); setRenaming(true); }} />
              <TextAction label={moving ? 'Move to…' : 'Move'} onPress={() => setMoving((m) => !m)} />
              <View style={{ flex: 1 }} />
              <TextAction label="Delete" tone="muted" disabled={busy}
                          onPress={() => void run(() => api.shelfDeleteSubcategory(sc.id), 'Gone. Its rules keep their weights and stop naming a drawer; nothing left the home screen.').then(onClose)} />
            </>
          )}
        </View>
      ) : null}
      {moving ? (
        <View style={[styles.line, { flexWrap: 'wrap' }]}>
          <Text style={[type.tiny, { width: 64 }]}>Move to</Text>
          {tax.categories.filter((c) => c.key !== sc.category_key).map((c) => (
            <Choice key={c.key} label={c.label} on={false}
                    onPress={() => { setMoving(false); void run(() => api.shelfSaveSubcategory({ id: sc.id, categoryKey: c.key as MoodKey }), `Moved ${sc.label} to ${c.label} — everything filed in it moved with it.`); }} />
          ))}
        </View>
      ) : null}
      {tri('indoor', sc.indoor, 'Indoors')}
      {tri('forKids', sc.for_kids, 'For kids')}

      <View style={[styles.sectionHead, { marginTop: spacing.md }]}>
        <Text style={styles.kicker}>What puts a place here</Text>
        <View style={{ flex: 1 }} />
        {canManage && !adding ? <Button label="Add a rule" icon="add" onPress={() => setAdding(true)} /> : null}
      </View>

      {adding ? (
        <RuleEditor tax={tax} start={[]} startSubcategory={sc.key} fixedSubcategory={sc.key} canManage={canManage}
                    onClose={() => setAdding(false)} onSaved={async (said) => { setAdding(false); await onChanged(said); }} />
      ) : null}

      {rules.length === 0 ? (
        <Text style={[type.small, styles.emptyRow]}>Nothing yet. Only places moved here one at a time, behind the Shelves door, will show under it.</Text>
      ) : rules.map((r) => (
        <View key={r.id} style={styles.ruleRow}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            {r.scope === 'place' ? (
              <Text style={[type.small, { fontWeight: '600' }]}>{r.subject_label ?? r.subject}</Text>
            ) : r.labelList.map((l) => <Word key={l.label} label={l.label} name={l.name} />)}
            <Text style={type.tiny}>
              {SCOPE_WORD[r.scope] ?? r.scope}{r.seeded ? ' · where Epic started' : ' · you decided this'}
              {r.reason ? ` · ${r.reason}` : ''}{r.taught_by ? ` · ${r.taught_by}` : ''} · {ago(r.updated_at)}
            </Text>
          </View>
          {canManage ? (
            <TextAction label="Forget" tone="muted" disabled={busy}
                        onPress={() => void run(() => api.shelfForget(r.id), `Forgotten. ${r.subject_label ?? r.subject} falls back to where it started.`)} />
          ) : null}
        </View>
      ))}

      {/* BO8 — what would land here, before you save. */}
      {canManage && busiest ? (
        <View style={{ gap: 6, paddingTop: spacing.md }}>
          <Text style={styles.bandKicker}>What would land here</Text>
          {!landing ? (
            <>
              <Text style={type.tiny}>
                Twelve real places carrying {busiest.replace('google:', '').replace(/_/g, ' ')}, one of the words that fills
                this drawer. It costs one provider call and nothing is stored.
              </Text>
              <TextAction label={looking ? 'Looking…' : 'Look at twelve real ones'} disabled={looking} onPress={() => void lookAtIt()} />
            </>
          ) : landing.problem ? (
            <Text style={type.tiny}>Could not look: {landing.problem}</Text>
          ) : (
            <>
              <Text style={type.tiny}>
                {landing.places.filter((pl) => pl.landsIn).length} of {landing.places.length} settled by the labels
                {landing.places.filter((pl) => !pl.landsIn).length
                  ? ` · ${landing.places.filter((pl) => !pl.landsIn).length} went to the not-sure list`
                  : ' · none left over'}
              </Text>
              {landing.places.map((pl) => {
                // The resolver's answer, sent with the place, so the row and the
                // count above it can never disagree (Codex, 14 Sep 2026).
                const settled = Boolean(pl.landsIn);
                return (
                  <View key={pl.id} style={styles.egRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={type.small} numberOfLines={1}>{pl.name ?? pl.id}</Text>
                      <Text style={type.tiny} numberOfLines={1}>{pl.address}</Text>
                    </View>
                    <Text style={[type.tiny, settled ? null : { color: colors.overrun }]}>{settled ? 'settled' : 'not sure'}</Text>
                  </View>
                );
              })}
            </>
          )}
        </View>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// the rule editor: these labels → this subcategory
// ---------------------------------------------------------------------------

/**
 * Pick labels, see where they land today, name the subcategory, save.
 *
 * The preview is the API's own answer for a place carrying exactly these
 * labels (POST /try), so what the form says will happen and what the home
 * screen does cannot disagree. Nothing is written until Save.
 */
function RuleEditor({ tax, start, startSubcategory, fixedSubcategory, canManage, onClose, onSaved }: {
  tax: Taxonomy; start: string[]; startSubcategory: string | null; fixedSubcategory: string | null; canManage: boolean;
  onClose: () => void; onSaved: (said: string) => Promise<void> | void;
}) {
  const [labels, setLabels] = useState<{ label: string; name: string | null }[]>(start.map((l) => ({ label: l, name: null })));
  const [q, setQ] = useState('');
  const [found, setFound] = useState<TaxonomyLabel[]>([]);
  const [sub, setSub] = useState<string | null>(fixedSubcategory ?? startSubcategory);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<TaxonomyTry | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Names for the labels handed in, from the vocabulary.
  useEffect(() => {
    const unnamed = labels.filter((l) => l.name === null);
    if (!unnamed.length) return;
    void Promise.all(unnamed.map((l) => api.taxonomyLabels({ namespace: nsOf(l.label), q: keyOf(l.label), all: true, limit: 50 })
      .then((d) => d.labels.find((x) => `${x.namespace}:${x.key}` === l.label)?.label ?? null).catch(() => null)))
      .then((names) => setLabels((prev) => prev.map((l) => {
        const i = unnamed.findIndex((u) => u.label === l.label);
        return i >= 0 ? { ...l, name: names[i] ?? keyOf(l.label) } : l;
      })));
  }, [labels]);

  // The search, across every source, debounced; never a list until something is typed.
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => {
      void api.taxonomyLabels({ q: q.trim(), all: true, limit: 30 }).then((d) => setFound(d.labels)).catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  // Where these labels land today.
  useEffect(() => {
    if (!labels.length) { setPreview(null); return; }
    void api.taxonomyTry(labels.map((l) => l.label)).then(setPreview).catch(() => setPreview(null));
  }, [labels]);

  const chosen = new Set(labels.map((l) => l.label));
  const catOf = (key: string | null) => tax.subcategories.find((s) => s.key === key)?.category_key ?? null;
  const catLabel = (key: string | null | undefined) => tax.categories.find((c) => c.key === key)?.label ?? key ?? '—';
  const subLabel = (key: string | null | undefined) => tax.subcategories.find((s) => s.key === key)?.label ?? null;
  const one = labels.length === 1 ? nsOf(labels[0].label) : null;
  const level = one === 'wikidata' ? 'a rule about this Wikidata type'
    : one === 'atlas' ? 'a rule about this atlas word'
      : one === 'experience' ? 'a rule about this experience'
        : labels.length > 1 ? 'a rule that fires only when a place carries all of these' : 'a rule about this word';

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.taxonomySaveRule({ labels: labels.map((l) => l.label), subcategory: sub, reason: reason.trim() || null });
      await onSaved(`Taught: ${r.rule.subject_label ?? r.rule.subject} → ${catLabel(catOf(sub))}${subLabel(sub) ? ` · ${subLabel(sub)}` : ''}.`);
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setBusy(false); }
  };

  const why = preview?.because?.[0];
  const landing = !labels.length ? 'Pick at least one label to see where it lands today.'
    : !preview ? 'Working out where these land today…'
      : `Today a place with ${labels.length === 1 ? 'this label' : 'these labels'} lands in ${catLabel(preview.category)}${subLabel(preview.subcategory) ? ` · ${subLabel(preview.subcategory)}` : ' with no subcategory'}${why ? (why.scope === 'default' ? ` — ${why.subject_label ?? 'the code\'s own map'}` : ` — a rule for ${SCOPE_WORD[why.scope] ?? why.scope}`) : ''}.${sub && preview.subcategory !== sub ? ` After saving: ${catLabel(catOf(sub))} · ${subLabel(sub)}.` : ''}`;

  return (
    <View style={styles.editor}>
      <View style={styles.sectionHead}>
        <Text style={styles.kicker}>A rule</Text>
        <View style={{ flex: 1 }} />
        <TextAction label="Close" tone="muted" onPress={onClose} />
      </View>

      <Text style={[type.tiny, { marginTop: spacing.sm }]}>Labels — places carrying all of these</Text>
      <View style={styles.tokens}>
        {labels.map((l) => <Token key={l.label} label={l.label} name={l.name} onRemove={() => setLabels((prev) => prev.filter((x) => x.label !== l.label))} />)}
        {labels.length === 0 ? <Text style={[type.small, { color: colors.inkMuted }]}>None yet.</Text> : null}
      </View>
      <Field icon="search" value={q} onChangeText={setQ} placeholder="Type a word from any source: castle, ice_rink, stadium, Q23413" />
      {found.filter((f) => !chosen.has(`${f.namespace}:${f.key}`)).slice(0, 12).map((f) => (
        <Press key={`${f.namespace}:${f.key}`} accessibilityRole="button" style={styles.foundRow}
               onPress={() => { setLabels((prev) => [...prev, { label: `${f.namespace}:${f.key}`, name: f.label ?? keyOf(f.key) }]); setQ(''); setFound([]); }}>
          <View style={{ flex: 1, minWidth: 0 }}><Word label={`${f.namespace}:${f.key}`} name={f.label} /></View>
          <Text style={type.tiny}>{f.landing.subcategory ? subLabel(f.landing.subcategory) : f.landing.category ? catLabel(f.landing.category) : ''}</Text>
          <Icon name="add" size={14} color={colors.ink} />
        </Press>
      ))}
      {q.trim().length >= 2 && !found.length ? <Text style={[type.tiny, { paddingVertical: 6 }]}>No source uses a word like that.</Text> : null}
      <Text style={type.tiny}>This will be {level}. One Wikidata type, atlas word or experience is written at that level; a provider's own word, or several labels together, sits above the type rules and below a rule about one place.</Text>

      {fixedSubcategory ? (
        <Text style={[type.small, { marginTop: spacing.sm }]}>Into <Text style={{ fontWeight: '700' }}>{catLabel(catOf(fixedSubcategory))} · {subLabel(fixedSubcategory)}</Text></Text>
      ) : (
        <View style={{ marginTop: spacing.sm, gap: 4 }}>
          <Text style={type.tiny}>Into which subcategory</Text>
          {tax.categories.map((c) => (
            <View key={c.key} style={[styles.line, { flexWrap: 'wrap', alignItems: 'flex-start' }]}>
              <Text style={[type.tiny, { width: 80, paddingTop: 5 }]}>{c.label}</Text>
              <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>
                {c.subcategories.filter((s) => s.active).map((s) => <Choice key={s.key} label={s.label} on={sub === s.key} onPress={() => setSub(s.key)} />)}
              </View>
            </View>
          ))}
        </View>
      )}

      <Text style={[type.small, styles.landing, preview && sub && preview.subcategory === sub && { color: colors.accent }]}>{landing}</Text>

      <Field value={reason} onChangeText={setReason} placeholder="Why — kept on the rule so it can be argued with later" />
      {err ? <Text style={[type.small, { color: colors.overrun }]}>{err}</Text> : null}
      <View style={[styles.line, { marginTop: spacing.sm }]}>
        <Button label={busy ? 'Saving…' : 'Save the rule'} icon="check" disabled={busy || !canManage || !labels.length || !sub} onPress={() => void save()} />
        <TextAction label="Cancel" tone="muted" onPress={onClose} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// every provider's words that land in this category
// ---------------------------------------------------------------------------

function ProviderWords({ tax, category, wide, subLabel, onPick }: {
  tax: Taxonomy; category: string; wide: boolean; subLabel: (k: string | null | undefined) => string | null;
  onPick: (label: string, subcategory: string | null) => void;
}) {
  const [m, setM] = useState<TaxonomyMatrix | null>(null);
  const [open, setOpen] = useState<{ row: string; ns: string; where: 'cells' | 'unfiled' | 'nowhere' } | null>(null);

  useEffect(() => {
    let live = true;
    void api.taxonomyMatrix(false).then((d) => { if (live) setM(d); }).catch(() => { if (live) setM(null); });
    return () => { live = false; };
  }, [tax]);
  // An opened cell belongs to the category it was opened in (Codex, 12 Sep 2026).
  useEffect(() => { setOpen(null); }, [category]);

  const cat = m?.categories.find((c) => c.key === category) ?? null;
  const nsLabel = (k: string) => tax.namespaces.find((n) => n.key === k)?.label ?? k;
  const cellOf = (where: 'cells' | 'unfiled' | 'nowhere', row: string, ns: string): TaxonomyMatrixEntry[] => m?.[where]?.[row]?.[ns] ?? [];
  // Only the sources that say anything about this category: an empty column is noise.
  const namespaces = useMemo(() => {
    if (!m || !cat) return [];
    return m.namespaces.filter((ns) => cat.subcategories.some((s) => cellOf('cells', s.key, ns).length) || cellOf('unfiled', cat.key, ns).length || cellOf('nowhere', cat.key, ns).length);
  }, [m, cat]);

  const rowsOf = (): { key: string; label: string; where: 'cells' | 'unfiled' | 'nowhere'; row: string }[] => {
    if (!cat) return [];
    return [
      ...cat.subcategories.map((s) => ({ key: s.key, label: s.label, where: 'cells' as const, row: s.key })),
      ...(m?.unfiled[cat.key] ? [{ key: '_unfiled', label: `${cat.label}, no subcategory`, where: 'unfiled' as const, row: cat.key }] : []),
      ...(m?.nowhere[cat.key] ? [{ key: '_nowhere', label: `Nothing read it; falls to ${cat.label}`, where: 'nowhere' as const, row: cat.key }] : []),
    ];
  };
  const opened = open ? cellOf(open.where, open.row, open.ns) : [];
  const COL = wide ? 130 : 110;

  if (!m) return <Text style={type.small}>Working it out…</Text>;
  if (!cat) return <Text style={type.small}>Nothing to show.</Text>;

  return (
    <View style={{ gap: spacing.md }}>
      <Section title={`Each source's words that land in ${cat.label}`}>
        <Text style={[type.tiny, { paddingVertical: 6 }]}>A number is how many of that source's words land in the row; tap it to read them, and tap a word to write a rule about it. The last rows are the work: words read into {cat.label} with no subcategory, and words nothing read at all.</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tableWrap}>
          <View>
            <View style={[styles.tRow, styles.tHead]}>
              <View style={[styles.tFirst, wide && { width: 220 }]}><Text style={styles.kicker}>Subcategory</Text></View>
              {namespaces.map((ns) => <View key={ns} style={[styles.tCell, { width: COL }]}><Text style={styles.kicker} numberOfLines={2}>{nsLabel(ns)}</Text></View>)}
            </View>
            {rowsOf().map((r) => (
              <View key={r.key} style={[styles.tRow, r.where !== 'cells' && styles.tWork]}>
                <View style={[styles.tFirst, wide && { width: 220 }]}><Text style={[type.small, { fontWeight: r.where === 'cells' ? '600' : '400' }]} numberOfLines={2}>{r.label}</Text></View>
                {namespaces.map((ns) => {
                  const words = cellOf(r.where, r.row, ns);
                  const on = open?.where === r.where && open.row === r.row && open.ns === ns;
                  return (
                    <Press key={ns} disabled={!words.length} onPress={() => setOpen(on ? null : { row: r.row, ns, where: r.where })} accessibilityRole="button"
                           style={[styles.tCell, { width: COL }, on && styles.tCellOn]}>
                      <Text style={[type.small, { fontWeight: '700', color: words.length ? colors.ink : colors.inkMuted }]}>{words.length ? count(words.length) : '–'}</Text>
                      {words.length ? <Text style={type.tiny} numberOfLines={1}>{words.slice(0, 2).map((w) => w.label ?? w.key).join(', ')}{words.length > 2 ? '…' : ''}</Text> : null}
                    </Press>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      </Section>

      {open && opened.length ? (
        <Section title={`${nsLabel(open.ns)} → ${open.where === 'cells' ? subLabel(open.row) ?? open.row : open.where === 'unfiled' ? 'no subcategory' : 'nothing read it'}`}
                 right={<TextAction label="Close" tone="muted" onPress={() => setOpen(null)} />}>
          {opened.map((w) => (
            <Press key={w.key} accessibilityRole="button" style={styles.foundRow} onPress={() => onPick(`${open.ns}:${w.key}`, open.where === 'cells' ? open.row : null)}>
              <View style={{ flex: 1, minWidth: 0 }}><Word label={`${open.ns}:${w.key}`} name={w.label} /></View>
              <Text style={type.tiny}>{w.how === 'taught' ? 'a rule' : w.how === 'default' ? 'the code\'s map' : ''}{w.seen ? ` · seen ${count(w.seen)}` : ''}</Text>
              <Icon name="more" size={14} color={colors.inkMuted} />
            </Press>
          ))}
        </Section>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Google's categories, against ours
// ---------------------------------------------------------------------------

/**
 * Google's categories against ours.
 *
 * Google has twenty categories and 478 subcategories of its own — Table A of
 * the Places API — and this is where each of Google's subcategories is mapped
 * to one of ours, or marked not a day out. Read by Google's categories or by
 * ours (the `by` control at the top); either way a row is a category, tapping
 * it opens its subcategories directly under it, and each subcategory carries
 * its mapping in a dropdown: a suggestion to approve, or any of our
 * subcategories to pick, two levels deep. A group's suggestions can be
 * approved in one press.
 *
 * Mapped means one of ours, or not a day out. Unmapped is everything else,
 * including a subcategory the code reads into a category of ours but no
 * subcategory yet. The owner, 12 Sep 2026: "do we not just have mapped or
 * unmapped?" — so those are the two columns, and a total at the bottom.
 */
/** The answers a Google word can carry, as the filter names them. */
const STANDINGS = [
  { key: '', label: 'Every answer' },
  { key: 'mapped', label: 'Mapped to one of ours' },
  // Not a seventh answer — the six are the six. This is *mapped*, incompletely:
  // a rule naming a category and no drawer, which is a work queue (Codex,
  // 14 Sep 2026) and is named as one so it cannot read as an answer of its own
  // (the audit, 15 Sep 2026).
  { key: 'category', label: 'Mapped, but no subcategory yet' },
  { key: 'generic', label: 'A secondary label, not a category' },
  { key: 'travel', label: 'Travel' },
  { key: 'nearby', label: 'Useful nearby' },
  { key: 'aside', label: 'Excluded from Epic' },
  { key: 'undecided', label: 'Nothing said yet' },
];


/**
 * The three doors, from the handoff (BO1a…BO11, 14 Sep 2026).
 *
 * One screen holding three vocabularies: the provider's words, our own labels,
 * and the eight categories. A 2px rule underneath with a lime one under the
 * door you are in — the only lime on the screen bar an action.
 */
function Doors({ at, on, counts }: {
  at: Door; on: (d: Door) => void;
  counts: { words: string; ours: string; cats: string; notsure: string; shelves: string };
}) {
  const items: { key: Door; label: string; sub: string }[] = [
    { key: 'words', label: "Google's words", sub: counts.words },
    { key: 'ours', label: 'Our labels', sub: counts.ours },
    { key: 'cats', label: 'Categories', sub: counts.cats },
    { key: 'notsure', label: 'Not sure', sub: counts.notsure },
    { key: 'shelves', label: 'Shelves', sub: counts.shelves },
  ];
  return (
    <View style={styles.doors}>
      {items.map((d) => (
        <Press key={d.key} effect="none" onPress={() => on(d.key)} accessibilityRole="tab"
               accessibilityState={{ selected: at === d.key }}
               style={[styles.door, at === d.key && styles.doorOn]}>
          <Text style={[styles.doorLabel, { color: at === d.key ? colors.ink : colors.inkMuted }]}>{d.label}</Text>
          <Text style={styles.doorSub}>{d.sub}</Text>
        </Press>
      ))}
    </View>
  );
}

/** The band under the doors: what this is, and the numbers that matter about it. */
/**
 * What just happened, with the way back — the prototype's toast.
 *
 * Lime ground, ink type, a tick, and Undo underlined beside it; gone in four
 * seconds. Never cream or white type on lime, so ink on lime is the only
 * pairing here (CLAUDE.md). It sits over everything because it is the one
 * thing you may want before it goes.
 */
function Toast({ at, onGone }: { at: { text: string; undo?: () => Promise<void> } | null; onGone: () => void }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!at) return undefined;
    const t = setTimeout(onGone, 4000);
    return () => clearTimeout(t);
  }, [at, onGone]);
  if (!at) return null;
  return (
    <View style={styles.toast} accessibilityRole="alert">
      <Icon name="check" size={15} color={colors.selectedFg} strokeWidth={3.2} />
      <Text style={styles.toastText} numberOfLines={2}>{at.text}</Text>
      {at.undo ? (
        <Press effect="none" disabled={busy} accessibilityRole="button"
               onPress={async () => { setBusy(true); try { await at.undo?.(); } finally { setBusy(false); onGone(); } }}>
          <Text style={styles.toastUndo}>{busy ? 'Undoing\u2026' : 'Undo'}</Text>
        </Press>
      ) : null}
    </View>
  );
}

function Band({ kicker, title, stats }: { kicker: string; title: string; stats: { label: string; value: string }[] }) {
  const { width } = useViewport();
  const phone = width < WIDE;
  return (
    <View style={styles.band}>
      <View style={{ gap: 6, minWidth: 0, flexShrink: 1 }}>
        <Text style={styles.bandKicker}>{kicker}</Text>
        <Text style={[styles.bandTitle, phone && styles.bandTitlePhone]}>{title}</Text>
      </View>
      <View style={styles.bandStats}>
        {stats.map((st) => (
          <View key={st.label} style={styles.bandStat}>
            <Text style={styles.bandKicker} numberOfLines={1}>{st.label}</Text>
            <Text style={styles.bandValue} numberOfLines={2}>{st.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** A sentence that changes what you do next: a 2px rule beside it, never a box. */
function Said({ lead, children }: { lead: string; children: string }) {
  return (
    <View style={styles.said}>
      <Text style={[type.small, { color: colors.inkMuted, lineHeight: 19 }]}>
        <Text style={{ color: colors.ink, fontWeight: '700' }}>{lead}</Text> {children}
      </Text>
    </View>
  );
}


/**
 * One place's secondary labels, and where each answer came from.
 *
 * "Override it on a single place, where you can see what was inherited and say
 * why you changed it." Four provenances, and only the first is somebody's
 * typing: **place** is set here, **word** came from one of its own provider
 * words, **came** was brought by another label, **subcategory** is its drawer's
 * default. The three that nobody typed are lime, which is the standing rule for
 * anything that arrived rather than being chosen.
 */
function PlaceLabels({ ref_, name, subcategory, words, onChanged }: {
  ref_: string; name: string; subcategory: string; words: string[];
  onChanged: (said: string, undo?: () => Promise<void>) => Promise<void>;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.taxonomyPlaceLabels>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const load = useCallback(async () => {
    try { setData(await api.taxonomyPlaceLabels({ ref: ref_, subcategory, words })); } catch { setData(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref_, subcategory, words.join(',')]);
  useEffect(() => { void load(); }, [load]);
  if (!data) return <Text style={[type.tiny, { paddingLeft: spacing.md }]}>Reading what it is…</Text>;

  const set = async (a: PlaceAttribute, value: AttributeValue | null) => {
    setBusy(true);
    try {
      await api.taxonomySetPlaceLabel({ ref: ref_, attribute: a.key, value, reason: why.trim() || null });
      setWhy('');
      await load();
      await onChanged(value ? `${name}: ${a.label} set here.` : `${name}: ${a.label} back to what it inherits.`);
    } finally { setBusy(false); }
  };
  const cameFrom = (v: AttributeValue) => (v.setAt === 'place' ? 'set here'
    : v.setAt === 'word' ? 'from its own words'
      : v.setAt === 'came' ? `came with ${v.came ?? 'another label'}`
        : 'from its drawer');

  return (
    <View style={styles.placeLabels}>
      {data.attributes.filter((a) => a.active).map((a) => {
        const v = data.values[a.key];
        const mine = v?.setAt === 'place';
        const says = (x?: AttributeValue) => (!x ? 'nothing said'
          : x.from != null || x.to != null ? `${x.from ?? 0} to ${x.to ?? 99}`
            : x.choice ? x.choice : x.yesno === false ? 'no' : 'yes');
        // What clearing would restore. The whole point of the screen is seeing
        // it *before* you change anything (Codex, 15 Sep 2026).
        const under = mine ? data.inherited?.[a.key] : undefined;
        return (
          <View key={a.key} style={{ paddingVertical: 4, gap: 2 }}>
            <View style={[styles.line, { gap: spacing.md }]}>
              <Text style={[type.tiny, { width: 110 }]} numberOfLines={1}>{a.label}</Text>
              <Text style={[type.small, { fontWeight: '600', color: v && !mine ? colors.accent : colors.ink, flex: 1, minWidth: 0 }]} numberOfLines={1}>
                {says(v)}
                {v ? <Text style={[type.tiny, { fontWeight: '400', color: colors.inkMuted }]}>{`  ${cameFrom(v)}`}</Text> : null}
              </Text>
              {a.kind === 'range' ? (
                <View style={[styles.line, { gap: 6 }]}>
                  {/* A range takes two numbers. Offering yes/no here wrote a
                      value whose shape disagreed with its own kind, so ages
                      could not be set at all (Codex, 15 Sep 2026). */}
                  <TextInput value={from} onChangeText={setFrom} placeholder={String(a.range_min ?? 0)} placeholderTextColor={colors.ghost}
                             inputMode="numeric" style={[styles.field, { width: 54 }]} />
                  <Text style={type.tiny}>to</Text>
                  <TextInput value={to} onChangeText={setTo} placeholder={String(a.range_max ?? 18)} placeholderTextColor={colors.ghost}
                             inputMode="numeric" style={[styles.field, { width: 54 }]} />
                  <TextAction label="Set" disabled={busy} onPress={() => void set(a, { from: Number(from) || 0, to: Number(to) || (a.range_max ?? 18) })} />
                  {mine ? <TextAction label="Clear" tone="muted" disabled={busy} onPress={() => void set(a, null)} /> : null}
                </View>
              ) : (
                <DrillDropdown
                  label={a.label} value={mine ? 'change' : 'say otherwise'} width={240} align="right"
                  groups={[{ key: a.key, label: a.label, items: a.kind === 'oneof'
                    ? a.options.map((o) => ({ key: o, label: o, on: v?.choice === o }))
                    : [{ key: 'yes', label: 'Yes', on: v?.yesno === true }, { key: 'no', label: 'No', on: v?.yesno === false }] }]}
                  startIn={a.key}
                  extra={mine ? [{ key: '\u2717', label: 'Back to what it inherits', on: false }] : []}
                  onPick={(k) => { if (!busy) void set(a, k === '\u2717' ? null : a.kind === 'oneof' ? { choice: k } : { yesno: k === 'yes' }); }}
                />
              )}
            </View>
            {mine ? (
              <Text style={[type.tiny, { paddingLeft: 110 + spacing.md }]} numberOfLines={2}>
                <Text style={{ color: colors.inkMuted }}>{`inherits ${says(under)}`}</Text>
                {/* The reason, for whoever reads this later — which was the
                    point of asking for it (Codex, 15 Sep 2026). */}
                {v?.reason ? <Text style={{ color: colors.inkMuted }}>{` · “${v.reason}”`}</Text> : null}
              </Text>
            ) : null}
          </View>
        );
      })}
      <View style={[styles.line, { gap: spacing.sm, paddingTop: 4 }]}>
        <Text style={type.tiny}>Why it differs</Text>
        <TextInput value={why} onChangeText={setWhy} placeholder="the reason, for whoever reads this later"
                   placeholderTextColor={colors.ghost} style={[styles.field, { flex: 1, minWidth: 140 }]} />
      </View>
    </View>
  );
}

/**
 * BO1i — our 59, as the rows.
 *
 * "Our subcategory | Home, and also in | Google words | Places." Grouping by
 * the eight categories is a different question and has its own option; this is
 * the one that answers "what fills Water park, and where is it listed".
 *
 * There is no place total, and saying so is the honest thing: one place carries
 * several of a provider's words, so adding the words' counts would count the
 * same place more than once. The biggest single word is a true lower bound and
 * is given as one.
 */
function OurSubcategories({ tax, rows, wide, catLabel }: {
  tax: Taxonomy; rows: TaxonomyLabel[]; wide: boolean;
  catLabel: (k: string | null | undefined) => string;
}) {
  const byDrawer = useMemo(() => {
    const m = new Map<string, TaxonomyLabel[]>();
    for (const r of rows) {
      const k = r.landing?.subcategory;
      if (!k) continue;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return m;
  }, [rows]);
  const subs = tax.subcategories.filter((sc) => sc.active);
  return (
    <View>
      <View style={[styles.tRow, styles.tHeadSoft, styles.stick]}>
        <View style={[styles.tFirst, styles.headCell, { flex: 1, width: undefined }]}><Text style={styles.colHead}>Our subcategory</Text></View>
        {wide ? <View style={[styles.tCell, styles.headCell, { width: 220 }]}><Text style={styles.colHead}>Home, and also in</Text></View> : null}
        <View style={[styles.tCell, styles.headCell, { flex: wide ? 1.4 : 1 }]}><Text style={styles.colHead}>Google words</Text></View>
        <View style={[styles.tCell, styles.headCell, { width: wide ? 130 : 84 }]}><Text style={[styles.colHead, { textAlign: 'right' }]}>Places</Text></View>
      </View>
      {subs.map((sc) => {
        const words = byDrawer.get(sc.key) ?? [];
        const most = words.reduce((n, w) => Math.max(n, w.seen_count ?? 0), 0);
        return (
          <View key={sc.key} style={styles.wordRow}>
            <View style={[styles.tFirst, { flex: 1, width: undefined, minWidth: 0 }]}>
              <Text style={[type.small, { fontWeight: '600' }]} numberOfLines={1}>{sc.label}</Text>
              {!wide ? (
                <Text style={type.tiny} numberOfLines={1}>
                  {catLabel(sc.category_key)}
                  {(sc.also_in ?? []).length ? <Text style={{ color: colors.accent }}>{` · also in ${(sc.also_in ?? []).map((k) => catLabel(k)).join(', ')}`}</Text> : null}
                </Text>
              ) : null}
            </View>
            {wide ? (
              <View style={[styles.tCell, { width: 220 }]}>
                <Text style={type.small} numberOfLines={2}>
                  {catLabel(sc.category_key)}
                  {/* Lime: also-in is a listing, not a home. */}
                  {(sc.also_in ?? []).length ? <Text style={{ color: colors.accent }}>{` · ${(sc.also_in ?? []).map((k) => catLabel(k)).join(' · ')}`}</Text> : null}
                </Text>
              </View>
            ) : null}
            <View style={[styles.tCell, { flex: wide ? 1.4 : 1, minWidth: 0 }]}>
              <Text style={type.small} numberOfLines={2}>
                {words.length ? words.map((w) => w.label ?? w.key.replace(/_/g, ' ')).join(' · ')
                  : <Text style={{ color: colors.inkMuted }}>nothing points here yet</Text>}
              </Text>
            </View>
            <View style={[styles.tCell, { width: wide ? 130 : 84 }]}>
              <Text style={[type.small, { textAlign: 'right', fontVariant: ['tabular-nums'], color: most ? colors.ink : colors.inkMuted }]}>
                {most ? `at least ${count(most)}` : '—'}
              </Text>
            </View>
          </View>
        );
      })}
      <Text style={[type.tiny, styles.emptyRow]}>
        “At least”, because one place carries several of a provider’s words and adding the counts would count the same
        place more than once. The biggest single word is a true floor.
      </Text>
    </View>
  );
}

/**
 * BO8 — a subcategory, on its own page: the rule, then real places.
 *
 * The owner, 15 Sep 2026: "B08 clearly shows that you should be able to click
 * through on a subcategory and see all of the associated examples and labels.
 * Please confirm how I actually get to this." He could not: this was an inline
 * strip inside another screen, and a primary label was inert text. It is a page
 * now, reached from Our labels › Primary, with its own address.
 *
 * Left: the rule that fills it, written in our labels, and the note that no
 * provider word appears there. Then the secondary labels every place in here
 * inherits, then name, category, also-show-it-in, switched on.
 *
 * Right: what would land here, before you save. Twelve real places, each with
 * its address and our labels on it, marked settled or not sure — and the four
 * that were not go to a list rather than being quietly filed wrong.
 */
function PrimaryLabel({ sc, tax, wide, canManage, secondary, defaults, nameOf, broughtAs, back, backLabel, onChanged }: {
  sc: ShelfSubcategory; tax: Taxonomy; wide: boolean; canManage: boolean;
  secondary: PlaceAttribute[]; defaults: Record<string, AttributeValue>;
  nameOf: (k: string) => string;
  broughtAs: (b: { key: string; value: AttributeValue }) => string;
  back: () => void; backLabel: string;
  onChanged: (said: string, undo?: () => Promise<void>) => Promise<void>;
}) {
  const [rules, setRules] = useState<TaxonomyRule[] | null>(null);
  const [landing, setLanding] = useState<TaxonomyExamples | null>(null);
  const [looking, setLooking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(sc.label);
  const [editing, setEditing] = useState(false);
  /** Which of the twelve has its own secondary labels open. */
  const [onPlace, setOnPlace] = useState('');

  const load = useCallback(async () => {
    try { setRules((await api.taxonomyRules(sc.key)).rules); } catch { setRules([]); }
  }, [sc.key]);
  useEffect(() => { void load(); setLanding(null); setName(sc.label); }, [load, sc.label]);

  const run = async (what: () => Promise<unknown>, said: string) => {
    setBusy(true);
    try { await what(); await onChanged(said); } catch (err) { await onChanged(String((err as Error).message)); }
    finally { setBusy(false); }
  };

  /**
   * The busiest word that fills this drawer, which is what twelve real places
   * are fetched against. A rule in our own labels names our key, so the word is
   * found through what points at it.
   */
  const busiest = useMemo(() => {
    const words = (rules ?? [])
      .filter((r) => r.scope === 'labels' || r.scope === 'ours')
      .flatMap((r) => (r.labelList ?? []).map((l) => l.label))
      .filter((l) => l.startsWith('google:'));
    return words[0] ?? null;
  }, [rules]);

  const look = async () => {
    if (!busiest) return;
    setLooking(true);
    try { setLanding(await api.taxonomyExamples(busiest, false)); }
    catch (err) { await onChanged(String((err as Error).message)); }
    finally { setLooking(false); }
  };

  const settled = (landing?.places ?? []).filter((pl) => pl.landsIn);
  const notSure = (landing?.places ?? []).filter((pl) => !pl.landsIn);
  const ourWords = (pl: { types: string[] }) => (pl.types ?? [])
    .map((t) => (rules ?? []).flatMap((r) => r.labelList ?? []).find((l) => l.label === `google:${t}`)?.name
      ?? tax.subcategories.find((x) => x.key === t)?.label ?? null)
    .filter(Boolean).slice(0, 4).join(' \u00b7 ');

  const cat = tax.categories.find((c) => c.key === sc.category_key);
  const fires = landing ? `${settled.length} of ${landing.places.length}` : '\u2014';
  /** One of ours, by its own name — a primary label or a secondary one. */
  const subLabelOf = (k: string) => tax.subcategories.find((x) => x.key === k)?.label
    ?? secondary.find((a) => a.key === k)?.label ?? k.replace(/-/g, ' ');

  return (
    <View style={{ gap: spacing.lg }}>
      <Press effect="none" onPress={back} accessibilityRole="button" style={styles.backLine}>
        <Icon name="back" size={14} color={colors.accent} strokeWidth={2.6} />
        <Text style={styles.backText}>{backLabel}</Text>
      </Press>
      <Band
        kicker="A primary label · the name that prints"
        title={sc.label}
        stats={[
          { label: 'Category', value: cat?.label ?? sc.category_key },
          { label: 'Places', value: String(landing?.places.length ?? '\u2014') },
          { label: 'Rule fires on', value: fires },
        ]}
      />
      <View style={[{ gap: spacing.lg }, wide && { flexDirection: 'row', alignItems: 'flex-start' }]}>
        {/* ---- the rule that fills it ---------------------------------- */}
        <View style={[{ gap: spacing.md, minWidth: 0 }, wide && { flex: 1 }]}>
          <Text style={styles.bandKicker}>The rule that fills it · written in our labels</Text>
          <Said lead="No provider word appears here.">
            {`Google\u2019s word, OpenStreetMap\u2019s tag and Wikidata\u2019s type all point at our label first, so one rule serves every provider \u2014 including ones we have not signed up.`}
          </Said>
          {/* In our labels, or not at all. A rule may still be stored against a
              provider's word — 383 of them are — and printing "Google ·
              water_park" one line under "No provider word appears here" is a
              contradiction on the screen (the audit, 15 Sep 2026). So each word
              is shown as the label of ours it means, and a rule holding a word
              that means nothing of ours yet says so instead of pretending. */}
          {(rules ?? []).filter((r) => r.scope === 'ours' || r.scope === 'labels').map((r) => {
            const ours = (r.labelList ?? []).map((l) => ({ ...l, mine: l.pointsAt }));
            const strays = ours.filter((l) => !l.mine);
            return (
              <View key={r.id} style={{ gap: 3 }}>
                <View style={styles.ruleLine}>
                  <Text style={[type.tiny, { width: 96 }]}>a place with</Text>
                  <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    {ours.map((l, i) => (
                      <Text key={l.label} style={type.small}>
                        {i ? <Text style={{ color: colors.inkMuted }}>+ </Text> : null}
                        <Text style={{ fontWeight: '600', color: l.mine ? colors.ink : colors.inkMuted }}>
                          {l.mine ? subLabelOf(l.mine) : (l.name ?? keyOf(l.label))}
                        </Text>
                      </Text>
                    ))}
                  </View>
                </View>
                {strays.length ? (
                  <Text style={[type.tiny, { color: colors.overrun }]}>
                    {strays.length === 1 ? 'One word in this rule' : `${strays.length} words in this rule`} still
                    {strays.length === 1 ? ' means' : ' mean'} nothing of ours — {strays.map((l) => keyOf(l.label)).join(', ')}.
                    Map {strays.length === 1 ? 'it' : 'them'} on Google’s words and this rule becomes one of ours.
                  </Text>
                ) : null}
              </View>
            );
          })}
          {(rules ?? []).length === 0 ? (
            <Text style={type.small}>No rule fills this drawer yet — only places moved here by hand.</Text>
          ) : null}
          <View style={styles.ruleLine}>
            <Text style={[type.tiny, { width: 96 }]}>gets</Text>
            <Text style={styles.gets}>{sc.label}</Text>
            <Text style={type.tiny}>its own name, as the primary</Text>
          </View>
          {canManage ? (
            <TextAction label="Add one of our labels" disabled={busy} onPress={() => setEditing(true)} />
          ) : null}

          {/* ---- the secondary labels every place in here inherits ------- */}
          <Text style={[styles.bandKicker, { paddingTop: spacing.sm }]}>Secondary labels every place in here inherits</Text>
          {secondary.map((a) => {
            const v = defaults[a.key];
            const reads = !v ? 'Not set \u2014 each place answers'
              : v.from != null || v.to != null ? `${v.from ?? 0} to ${v.to ?? 99}`
                : v.choice ? v.choice : v.yesno === false ? 'No' : 'Yes';
            const brings = (a.brings ?? []).map(broughtAs).join(', ');
            return (
              <View key={a.key} style={styles.wordRow}>
                <Text style={[type.small, { fontWeight: '600', flex: 1, minWidth: 0 }]}>{a.label}</Text>
                {canManage ? (
                  <DrillDropdown
                    label={a.label} value={reads} set={Boolean(v)} align="right" width={260}
                    groups={a.kind === 'oneof'
                      ? [{ key: a.key, label: a.label, items: a.options.map((o) => ({ key: o, label: o, on: v?.choice === o })) }]
                      : [{ key: a.key, label: a.label, items: [
                        { key: 'yes', label: 'Yes', on: v?.yesno === true },
                        { key: 'no', label: 'No', on: v?.yesno === false },
                      ] }]}
                    startIn={a.key}
                    extra={v ? [{ key: '\u2717', label: 'Not set \u2014 each place answers', on: false }] : []}
                    onPick={(k) => void run(
                      () => api.taxonomySetDefault({
                        subcategory: sc.key, attribute: a.key,
                        value: k === '\u2717' ? null : a.kind === 'oneof' ? { choice: k } : { yesno: k === 'yes' },
                      }),
                      k === '\u2717' ? `${a.label} is each place\u2019s own answer now.` : `Every ${sc.label.toLowerCase()} is ${a.label.toLowerCase()} \u00b7 ${k}.`,
                    )}
                  />
                ) : <Text style={type.small}>{reads}</Text>}
                {/* Lime, because nobody typed it: it arrived with another label. */}
                {brings ? <Text style={[type.tiny, { color: colors.accent }]} numberOfLines={1}>brings {brings}</Text> : null}
              </View>
            );
          })}

          {/* ---- name, category, also show it in, switched on ------------ */}
          <View style={styles.wordRow}>
            <Text style={[type.tiny, { width: 96 }]}>Name</Text>
            {renaming ? (
              <>
                <Field value={name} onChangeText={setName} autoFocus style={{ flex: 1, minWidth: 140 }}
                       onSubmitEditing={() => { setRenaming(false); void run(() => api.shelfSaveSubcategory({ id: sc.id, label: name.trim() || sc.label }), `Renamed to ${name.trim() || sc.label}.`); }} />
                <TextAction label="Save" onPress={() => { setRenaming(false); void run(() => api.shelfSaveSubcategory({ id: sc.id, label: name.trim() || sc.label }), `Renamed to ${name.trim() || sc.label}.`); }} />
              </>
            ) : (
              <>
                <Text style={[type.small, { fontWeight: '600', flex: 1 }]}>{sc.label}</Text>
                {canManage ? <TextAction label="Rename" onPress={() => { setName(sc.label); setRenaming(true); }} /> : null}
              </>
            )}
          </View>
          <View style={styles.wordRow}>
            <Text style={[type.tiny, { width: 96 }]}>Category</Text>
            {canManage ? (
              <DrillDropdown
                label="Category" value={cat?.label ?? sc.category_key} align="right" width={240}
                groups={[{ key: 'c', label: 'Categories', items: tax.categories.filter((c) => c.active).map((c) => ({ key: c.key, label: c.label, on: c.key === sc.category_key })) }]}
                startIn="c"
                onPick={(k) => void run(() => api.shelfSaveSubcategory({ id: sc.id, categoryKey: k }), `${sc.label} sits in ${tax.categories.find((c) => c.key === k)?.label ?? k} now \u2014 and every place in it with it.`)}
              />
            ) : <Text style={type.small}>{cat?.label ?? sc.category_key}</Text>}
            <Text style={type.tiny}>where every place in it lives</Text>
          </View>
          <View style={styles.wordRow}>
            <Text style={[type.tiny, { width: 96 }]}>Also show it in</Text>
            <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {(sc.also_in ?? []).map((k) => (
                <Token key={k} label={tax.categories.find((c) => c.key === k)?.label ?? k}
                       onRemove={canManage ? () => void run(() => api.shelfSaveSubcategory({ id: sc.id, alsoIn: (sc.also_in ?? []).filter((x) => x !== k) }), `${sc.label} no longer shows in ${tax.categories.find((c) => c.key === k)?.label ?? k}.`) : undefined} />
              ))}
              {canManage ? (
                <DrillDropdown
                  label="Add" value="+ Add" align="left" width={240}
                  groups={[{ key: 'c', label: 'Categories', items: tax.categories.filter((c) => c.active && c.key !== sc.category_key && !(sc.also_in ?? []).includes(c.key)).map((c) => ({ key: c.key, label: c.label, on: false })) }]}
                  startIn="c"
                  onPick={(k) => void run(() => api.shelfSaveSubcategory({ id: sc.id, alsoIn: [...(sc.also_in ?? []), k as MoodKey] }), `${sc.label} also shows in ${tax.categories.find((c) => c.key === k)?.label ?? k}.`)}
                />
              ) : null}
            </View>
            <Text style={type.tiny}>which menus list it — not what a place is</Text>
          </View>
          <View style={styles.wordRow}>
            <Text style={[type.tiny, { width: 96 }]}>Switched on</Text>
            {canManage ? (
              <Press effect="none" accessibilityRole="switch" accessibilityState={{ checked: sc.active }}
                     accessibilityLabel={`${sc.label} is ${sc.active ? 'on' : 'off'}`}
                     onPress={() => void run(() => api.shelfSaveSubcategory({ id: sc.id, active: !sc.active }), sc.active ? `${sc.label} is switched off.` : `${sc.label} is switched on.`)}
                     style={[styles.toggle, sc.active && styles.toggleOn]}>
                <View style={[styles.toggleBlock, sc.active && styles.toggleBlockOn]} />
              </Press>
            ) : <Text style={type.small}>{sc.active ? 'On' : 'Off'}</Text>}
          </View>
        </View>

        {/* ---- what would land here, before you save -------------------- */}
        <View style={[{ gap: spacing.sm, minWidth: 0 }, wide && { flex: 1 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.md, flexWrap: 'wrap' }}>
            <Text style={[styles.bandKicker, { flex: 1, minWidth: 0 }]}>What would land here · before you save</Text>
            <Text style={type.tiny}>{landing ? `${landing.places.length} real places, fetched once` : 'one provider call, nothing stored'}</Text>
          </View>
          {!landing ? (
            <TextAction label={looking ? 'Looking\u2026' : busiest ? 'Look at twelve real ones' : 'No provider word fills this drawer yet'}
                        disabled={looking || !busiest || !canManage} onPress={() => void look()} />
          ) : landing.problem ? (
            <Text style={type.tiny}>Could not look: {landing.problem}</Text>
          ) : (
            <>
              {landing.places.map((pl) => (
                <View key={pl.id}>
                  <View style={[styles.egRow, { alignItems: 'flex-start' }]}>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Text style={[type.small, { fontWeight: '600' }]} numberOfLines={1}>{pl.name ?? pl.id}</Text>
                      <Text style={type.tiny} numberOfLines={1}>{pl.address}</Text>
                      <Text style={type.tiny} numberOfLines={1}>our labels: {ourWords(pl) || '\u2014'}</Text>
                    </View>
                    <Text style={[type.tiny, pl.landsIn ? null : { color: colors.overrun }]}>{pl.landsIn ? 'settled' : 'not sure'}</Text>
                    {/* "Override it on a single place, where you can see what was
                        inherited and say why you changed it." The endpoint had
                        existed since the start with no way to reach it from
                        anywhere (the audit, 15 Sep 2026). */}
                    {canManage ? (
                      <TextAction label={onPlace === pl.id ? 'Close' : 'Its labels'}
                                  onPress={() => setOnPlace(onPlace === pl.id ? '' : pl.id)} />
                    ) : null}
                  </View>
                  {onPlace === pl.id ? (
                    <PlaceLabels
                      ref_={`google:${pl.id}`} name={pl.name ?? pl.id}
                      // Where it actually lands, not the page we are on: a place
                      // in this sample may settle into another drawer, and using
                      // this page's would report the wrong defaults as inherited
                      // (Codex, 15 Sep 2026).
                      subcategory={pl.landsIn ?? sc.key}
                      words={(pl.types ?? []).map((t) => `google:${t}`)}
                      onChanged={onChanged}
                    />
                  ) : null}
                </View>
              ))}
              {canManage ? (
                <View style={{ gap: 6, paddingTop: spacing.sm }}>
                  {/* There is no Save. Everything on the left is written the
                      moment it is changed, and a button that writes nothing is
                      worse than no button (the audit, 15 Sep 2026: "Save is a
                      no-op"). What the screen owes is the count and the one
                      thing still to decide. */}
                  <Text style={type.tiny}>
                    {settled.length} of {landing.places.length} settled by the labels. Everything on the left is saved as
                    you change it.
                  </Text>
                  {notSure.length ? (
                    <Press effect="none" disabled={busy} accessibilityRole="button" style={styles.save}
                           onPress={() => void run(
                             () => api.taxonomyQueueNotSure({
                               subcategory: sc.key,
                               places: notSure.map((pl) => ({
                                 ref: `google:${pl.id}`, name: pl.name, address: pl.address, words: pl.types ?? [],
                                 reason: `Nothing it carries settles it, and it turned up in ${sc.label}\u2019s own sample.`,
                               })),
                             }),
                             `${notSure.length} went to the not-sure list.`,
                           )}>
                      <Icon name="check" size={14} color={colors.selectedFg} strokeWidth={2.8} />
                      <Text style={[type.small, { fontWeight: '700', color: colors.selectedFg }]}>
                        Send {notSure.length} to the not-sure list
                      </Text>
                    </Press>
                  ) : null}
                </View>
              ) : null}
              <Said lead={`${settled.length} of ${landing.places.length} were settled by the labels; ${notSure.length} were not.`}>
                {`The ${notSure.length} are named and go to a list, never quietly filed wrong.`}
              </Said>
            </>
          )}
        </View>
      </View>
      {editing ? (
        <RuleEditor tax={tax} start={[]} startSubcategory={sc.key} fixedSubcategory={sc.key} canManage={canManage}
                    onClose={() => setEditing(false)}
                    onSaved={async (saidWhat) => { setEditing(false); await load(); await onChanged(saidWhat); }} />
      ) : null}
    </View>
  );
}

/**
 * BO7a — our labels.
 *
 * A primary label is a subcategory's own name; a place gets exactly one,
 * because it is what prints under the name. Everything else true about a place
 * is a secondary label and a place can carry any number.
 *
 * What arrives automatically is drawn in lime, so it is never confused with
 * what somebody chose. Nothing is in a box.
 */
function OurLabels({ tax, wide, canManage, onChanged }: {
  tax: Taxonomy; wide: boolean; canManage: boolean; onChanged: (said: string, undo?: () => Promise<void>) => Promise<void>;
}) {
  const [data, setData] = useState<TaxonomyAttributes | null>(null);
  const [half, setHalf] = useQueryState<'secondary' | 'primary'>('half', 'secondary', asOneOf(['secondary', 'primary'] as const, 'secondary'));
  /** Which primary label is open, in the address like every other layer. */
  const [openLabel, setOpenLabel] = useQueryState<string>('label', '', asText);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.taxonomyAttributes()); } catch { setData(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const pointing = useMemo(() => {
    // How many of a provider's words point at each of ours, from the rules.
    const n = new Map<string, number>();
    for (const r of tax.rules) {
      if (!r.subcategory) continue;
      n.set(r.subcategory, (n.get(r.subcategory) ?? 0) + 1);
    }
    return n;
  }, [tax.rules]);

  const kindOf = (a: PlaceAttribute) => (a.kind === 'yesno' ? 'Yes or no'
    : a.kind === 'range' ? `A range · ${a.range_min ?? 0} to ${a.range_max ?? 99}`
      : `One of ${a.options.length}`);
  const setIn = (key: string) => Object.values(data?.defaults ?? {}).filter((m) => m[key]).length;
  /** Places that say this on their own — a count, not the coverage beside it. */
  const places = (key: string) => data?.places?.[key] ?? 0;

  /**
   * "Create one, with a name **and a kind**: yes or no, a range such as ages 3
   * to 14, or one of a list." The kind was hard-coded to yes/no, so the two
   * kinds that carry a value could not be made at all (the audit, 15 Sep 2026).
   */
  const [newKind, setNewKind] = useState<'yesno' | 'range' | 'oneof'>('yesno');
  const [choices, setChoices] = useState('');
  const add = async () => {
    const l = name.trim();
    setAdding(false); setName(''); setChoices('');
    if (!l) return;
    setBusy(true);
    try {
      await api.taxonomySaveAttribute({
        label: l, kind: newKind,
        // A range needs bounds to draw a control at all; one-of starts empty and
        // is filled in on the row.
        ...(newKind === 'range' ? { rangeMin: 0, rangeMax: 18, unit: 'years' } : {}),
        // A one-of with no choices is unusable: every control that assigns it
        // is built from this list (Codex, 15 Sep 2026).
        ...(newKind === 'oneof' ? { options: choices.split(',').map((c) => c.trim()).filter(Boolean) } : {}),
      });
      setNewKind('yesno');
      await load();
      await onChanged(`${l} is one of our secondary labels now.`);
    } catch (err) { await onChanged(String((err as Error).message)); }
    finally { setBusy(false); }
  };

  /** Renaming is safe: the key never changes, so nothing that points here moves. */
  const rename = async (a: PlaceAttribute, to: string) => {
    const l = to.trim();
    if (!l || l === a.label) return;
    setBusy(true);
    try { await api.taxonomySaveAttribute({ key: a.key, label: l }); await load(); await onChanged(`${a.label} is called ${l} now.`); }
    catch (err) { await onChanged(String((err as Error).message)); }
    finally { setBusy(false); }
  };
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState('');

  const secondary = (data?.attributes ?? []).filter((a) => a.active);
  const nameOf = (k: string) => (data?.attributes ?? []).find((o) => o.key === k)?.label ?? k;
  const [openKey, setOpenKey] = useState<string | null>(null);
  /** Which brought label is waiting for its value to be said. */
  const [asking, setAsking] = useState<{ from: PlaceAttribute; to: PlaceAttribute } | null>(null);
  const [fromV, setFromV] = useState('');
  const [toV, setToV] = useState('');

  /**
   * Add or take away a label that always comes with this one. It arrives as the
   * value its own kind can hold: a range as a range, never as a bare yes.
   */
  const bring = async (a: PlaceAttribute, k: string, value?: AttributeValue) => {
    const has = (a.brings ?? []).some((b) => b.key === k) && value === undefined;
    const other = (data?.attributes ?? []).find((o) => o.key === k);
    // A range or a one-of has to be said, not guessed: "suits ages 0 to 7" is
    // the whole point and 0 to 99 says nothing (Codex, 14 Sep 2026). So the row
    // opens a small form rather than saving something nobody chose.
    if (!has && !value && other && other.kind !== 'yesno') {
      setAsking({ from: a, to: other });
      setFromV(''); setToV('');
      return;
    }
    setBusy(true);
    try {
      await api.taxonomySetBrings({ attribute: a.key, brings: k, value: has ? null : (value ?? { yesno: true }) });
      await load();
      setAsking(null);
      await onChanged(has ? `${nameOf(k)} no longer comes with ${a.label}.` : `${nameOf(k)} comes with ${a.label} now.`);
    } catch (err) { await onChanged(String((err as Error).message)); }
    finally { setBusy(false); }
  };

  /** What a brought label reads as: its name, and its value where it has one. */
  const broughtAs = (b: { key: string; value: AttributeValue }) => {
    const v = b.value ?? {};
    if (v.from != null || v.to != null) return `${nameOf(b.key)} ${v.from ?? 0} to ${v.to ?? 99}`;
    if (v.choice) return `${nameOf(b.key)} · ${v.choice}`;
    return v.yesno === false ? `not ${nameOf(b.key)}` : nameOf(b.key);
  };
  const primary = tax.subcategories.filter((sc) => sc.active);
  const total = tax.rules.filter((r) => r.subcategory).length;

  // BO8 — one primary label, on its own page.
  const open = openLabel ? primary.find((sc) => sc.key === openLabel) ?? null : null;
  if (open) {
    return (
      <PrimaryLabel
        sc={open} tax={tax} wide={wide} canManage={canManage}
        secondary={secondary} defaults={data?.defaults?.[open.key] ?? {}}
        nameOf={nameOf} broughtAs={broughtAs}
        back={() => setOpenLabel('')} backLabel={`Primary labels · ${primary.length}`}
        onChanged={async (said) => { await load(); await onChanged(said); }}
      />
    );
  }

  return (
    <View style={{ gap: spacing.lg }}>
      <Band
        kicker={`${primary.length} primary · ${secondary.length} secondary`}
        title="Our labels"
        stats={[
          { label: 'Primary', value: String(primary.length) },
          { label: 'Secondary', value: String(secondary.length) },
          { label: 'Provider words pointing at them', value: count(total) },
        ]}
      />
      <Said lead="A primary label is a subcategory’s own name.">
        {`There are ${primary.length} and a place gets exactly one, because it is what prints under the name. Everything else true about a place is a secondary label, and a place can carry any number.`}
      </Said>

      <View style={[styles.line, { justifyContent: 'space-between', flexWrap: 'wrap' }]}>
        <View style={styles.halves}>
          {([['secondary', 'Secondary'], ['primary', `Primary · ${primary.length}`]] as const).map(([k, l], i) => (
            <Press key={k} effect="none" onPress={() => setHalf(k)} accessibilityRole="button"
                   accessibilityState={{ selected: half === k }}
                   style={[styles.halfItem, i > 0 && styles.halfDivider, half === k && styles.halfOn]}>
              <Text style={[type.small, { fontWeight: '700', color: half === k ? colors.selectedFg : colors.inkMuted }]}>{l}</Text>
            </Press>
          ))}
        </View>
        <View style={[styles.line, { gap: spacing.md }]}>
          <Text style={type.tiny}><Text style={{ color: colors.accent, fontWeight: '700' }}>lime</Text> comes automatically</Text>
          {canManage && half === 'secondary' ? (
            adding ? (
              <>
                <TextInput value={name} onChangeText={setName} placeholder="Name it" placeholderTextColor={colors.inkFaint}
                           autoFocus onSubmitEditing={() => void add()} style={[styles.field, { minWidth: 180 }]} />
                <DrillDropdown
                  label="Kind" value={newKind === 'yesno' ? 'Yes or no' : newKind === 'range' ? 'A range' : 'One of a list'}
                  set width={240}
                  groups={[{ key: 'k', label: 'What kind of answer', items: [
                    { key: 'yesno', label: 'Yes or no', on: newKind === 'yesno' },
                    { key: 'range', label: 'A range — ages 3 to 14', on: newKind === 'range' },
                    { key: 'oneof', label: 'One of a list', on: newKind === 'oneof' },
                  ] }]}
                  startIn="k"
                  onPick={(k) => setNewKind(k as 'yesno' | 'range' | 'oneof')}
                />
                {newKind === 'oneof' ? (
                  <TextInput value={choices} onChangeText={setChoices} placeholder="its choices, separated by commas"
                             placeholderTextColor={colors.ghost} style={[styles.field, { minWidth: 220 }]} />
                ) : null}
                <TextAction label="Make it" disabled={busy || (newKind === 'oneof' && !choices.trim())} onPress={() => void add()} />
              </>
            ) : <TextAction label="New secondary label" disabled={busy} onPress={() => { setAdding(true); setName(''); setNewKind('yesno'); }} />
          ) : null}
        </View>
      </View>

      {half === 'secondary' ? (
        <View>
          <View style={[styles.tRow, styles.tHeadSoft]}>
            <View style={[styles.tFirst, styles.headCell, { flex: 1, width: undefined }]}><Text style={styles.colHead}>Secondary label</Text></View>
            {wide ? <View style={[styles.tCell, styles.headCell, { width: 150 }]}><Text style={styles.colHead}>Kind</Text></View> : null}
            {wide ? <View style={[styles.tCell, styles.headCell, { width: 210 }]}><Text style={styles.colHead}>Always comes with it</Text></View> : null}
            <View style={[styles.tCell, styles.headCell, { width: wide ? 190 : 120 }]}><Text style={styles.colHead}>Set by default in</Text></View>
            {/* Two columns, two units, and they must not be merged (the handoff,
                BO7a): set by default in is coverage across 59 drawers, and this
                is a count of places. */}
            <View style={[styles.tCell, styles.headCell, { width: wide ? 120 : 80 }]}><Text style={[styles.colHead, { textAlign: 'right' }]}>Places</Text></View>
          </View>
          {secondary.length === 0 ? <Text style={[type.small, styles.emptyRow]}>None yet.</Text> : null}
          {secondary.map((a) => (
            <View key={a.key} style={[styles.wordRow, !wide && { flexDirection: 'column', alignItems: 'stretch', gap: 4 }, openKey === a.key && { zIndex: 40 }]}>
              <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                {renaming === a.key ? (
                  <View style={[styles.line, { gap: spacing.sm }]}>
                    <TextInput value={renameTo} onChangeText={setRenameTo} autoFocus
                               onSubmitEditing={() => { setRenaming(null); void rename(a, renameTo); }}
                               style={[styles.field, { minWidth: 160 }]} />
                    <TextAction label="Save" onPress={() => { setRenaming(null); void rename(a, renameTo); }} />
                  </View>
                ) : (
                  <View style={[styles.line, { gap: spacing.md }]}>
                    <Text style={type.small}><Text style={{ fontWeight: '600' }}>{a.label}</Text></Text>
                    {/* "Rename it" — there was no way to (the audit, 15 Sep 2026).
                        Safe, because the key never changes and nothing that
                        points here moves. */}
                    {canManage ? <TextAction label="Rename" tone="muted" onPress={() => { setRenaming(a.key); setRenameTo(a.label); }} /> : null}
                  </View>
                )}
                {a.blurb ? <Text style={type.tiny} numberOfLines={2}>{a.blurb}</Text> : null}
                {/* At 390 the Kind and Comes-with columns come off, and they are
                    the point of the screen, so they are said here instead of
                    being lost (the audit). */}
                {!wide ? (
                  <Text style={type.tiny} numberOfLines={2}>
                    {kindOf(a)}
                    {(a.brings ?? []).length ? <Text style={{ color: colors.accent }}>{` · comes with ${(a.brings ?? []).map(broughtAs).join(', ')}`}</Text> : null}
                  </Text>
                ) : null}
              </View>
              {wide ? <View style={[styles.tCell, { width: 150 }]}><Text style={type.small}>{kindOf(a)}</Text></View> : null}
              {!wide && canManage ? (
                <DrillDropdown
                  label={(a.brings ?? []).length ? 'Comes with' : 'Add one'}
                  value={(a.brings ?? []).map(broughtAs).join(' · ') || 'nothing chosen'}
                  set={(a.brings ?? []).length > 0} width={260}
                  groups={[{
                    key: 'secondary', label: 'Our secondary labels',
                    items: secondary.filter((o) => o.key !== a.key)
                      .map((o) => ({ key: o.key, label: o.label, on: (a.brings ?? []).some((b) => b.key === o.key) })),
                  }]}
                  onPick={(k) => void bring(a, k)}
                  onOpenChange={(o) => setOpenKey(o ? a.key : null)}
                />
              ) : null}
              {wide ? (
                <View style={[styles.tCell, { width: 210 }]}>
                  {/* What arrives automatically is lime, so it is never confused
                      with what somebody chose (owner, 14 Sep 2026). */}
                  {canManage ? (
                    <DrillDropdown
                      label={(a.brings ?? []).length ? 'Comes with' : 'Add one'}
                      value={(a.brings ?? []).map(broughtAs).join(' · ') || 'nothing chosen'}
                      set={(a.brings ?? []).length > 0} align="right" width={280}
                      groups={[{
                        key: 'secondary',
                        label: 'Our secondary labels',
                        items: secondary.filter((o) => o.key !== a.key)
                          .map((o) => ({ key: o.key, label: o.label, on: (a.brings ?? []).some((b) => b.key === o.key) })),
                      }]}
                      onPick={(k) => void bring(a, k)}
                      onOpenChange={(o) => setOpenKey(o ? a.key : null)}
                    />
                  ) : (
                    <Text style={[type.small, (a.brings ?? []).length ? { color: colors.accent } : null]}>
                      {(a.brings ?? []).map(broughtAs).join(' · ') || 'nothing chosen'}
                    </Text>
                  )}
                </View>
              ) : null}
              <View style={[styles.tCell, { width: wide ? 190 : 120 }]}>
                <Text style={type.small}>{setIn(a.key) ? `${setIn(a.key)} of ${primary.length} subcategories` : 'nowhere yet'}</Text>
              </View>
              {/* An em dash, not a nought: where a label is only ever a drawer
                  default, what we know about it is the coverage to the left, and
                  a nought would claim we had counted places and found none
                  (the handoff, BO7a). */}
              <View style={[styles.tCell, { width: wide ? 120 : 80 }]}>
                <Text style={[type.small, { textAlign: 'right', fontVariant: ['tabular-nums'], color: places(a.key) ? colors.ink : colors.inkMuted }]}>
                  {places(a.key) ? count(places(a.key)) : '\u2014'}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <View>
          <View style={[styles.tRow, styles.tHeadSoft]}>
            <View style={[styles.tFirst, styles.headCell, { flex: 1, width: undefined }]}><Text style={styles.colHead}>Primary label</Text></View>
            <View style={[styles.tCell, styles.headCell, { width: wide ? 200 : 120 }]}><Text style={styles.colHead}>Its category</Text></View>
            {wide ? <View style={[styles.tCell, styles.headCell, { width: 210 }]}><Text style={styles.colHead}>Also shown in</Text></View> : null}
            <View style={[styles.tCell, styles.headCell, { width: wide ? 160 : 90 }]}><Text style={[styles.colHead, { textAlign: 'right' }]}>Rules</Text></View>
          </View>
          {primary.map((sc) => (
            // Every primary label is a door. The handoff draws BO8 as the page
            // behind it — the rule that fills it on the left, twelve real
            // places on the right — and it was reachable from nowhere (owner,
            // 15 Sep 2026: "B08 clearly shows that you should be able to click
            // through on a subcategory and see all of the associated examples").
            <Press key={sc.key} effect="none" onPress={() => setOpenLabel(sc.key)} accessibilityRole="button"
                   style={({ hovered }: any) => [styles.wordRow, hovered && { backgroundColor: colors.well }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={type.small}><Text style={{ fontWeight: '600' }}>{sc.label}</Text> <Text style={{ color: colors.inkMuted }}>{sc.key}</Text></Text>
              </View>
              <View style={[styles.tCell, { width: wide ? 200 : 120 }]}>
                <Text style={type.small}>{tax.categories.find((c) => c.key === sc.category_key)?.label ?? sc.category_key}</Text>
              </View>
              {wide ? (
                <View style={[styles.tCell, { width: 210 }]}>
                  <Text style={[type.small, { color: colors.accent }]} numberOfLines={1}>
                    {(sc.also_in ?? []).map((k) => tax.categories.find((c) => c.key === k)?.label ?? k).join(' · ') || ''}
                  </Text>
                </View>
              ) : null}
              <View style={[styles.tCell, { width: wide ? 160 : 90 }]}>
                <Text style={[type.small, { textAlign: 'right', fontVariant: ['tabular-nums'] }]}>{pointing.get(sc.key) ?? 0}</Text>
              </View>
              <Icon name="more" size={14} color={colors.inkMuted} />
            </Press>
          ))}
        </View>
      )}

      {/* Saying what a range or a one-of is brought as, rather than guessing it. */}
      {asking ? (
        <View style={styles.asking}>
          <Text style={styles.bandKicker}>{asking.from.label} brings {asking.to.label}</Text>
          {asking.to.kind === 'range' ? (
            <View style={[styles.line, { gap: spacing.sm, flexWrap: 'wrap' }]}>
              <Text style={type.small}>from</Text>
              <TextInput value={fromV} onChangeText={setFromV} placeholder={String(asking.to.range_min ?? 0)}
                         placeholderTextColor={colors.inkFaint} style={[styles.field, { minWidth: 60 }]} />
              <Text style={type.small}>to</Text>
              <TextInput value={toV} onChangeText={setToV} placeholder={String(asking.to.range_max ?? 99)}
                         placeholderTextColor={colors.inkFaint} style={[styles.field, { minWidth: 60 }]} />
              <TextAction label="Save" disabled={busy} onPress={() => void bring(asking.from, asking.to.key, {
                // Nullish, not falsy: a range whose top is 0 is a range, and || would
                // quietly save 99 instead (Codex, 14 Sep 2026).
                from: fromV.trim() ? Number(fromV) : asking.to.range_min ?? 0,
                to: toV.trim() ? Number(toV) : asking.to.range_max ?? 99,
              })} />
              <TextAction label="Cancel" onPress={() => setAsking(null)} />
            </View>
          ) : (
            <View style={[styles.line, { gap: spacing.md, flexWrap: 'wrap' }]}>
              {asking.to.options.map((o) => (
                <TextAction key={o} label={o} disabled={busy} onPress={() => void bring(asking.from, asking.to.key, { choice: o })} />
              ))}
              <TextAction label="Cancel" onPress={() => setAsking(null)} />
            </View>
          )}
        </View>
      ) : null}

      {/* The refusal, on the screen because the argument for it is the kind that
          gets forgotten and then made again. */}
      <View style={styles.refusal}>
        <Text style={[styles.bandKicker, { color: colors.overrun }]}>One label that will not be made</Text>
        <Text style={[type.small, { color: colors.inkMuted, lineHeight: 19 }]}>
          <Text style={{ color: colors.ink, fontWeight: '700' }}>There is no secondary label called “outdoors”. </Text>
          Indoors already exists as a yes or no, and outdoors is simply Indoors set to no. The Outdoors category is a kind of
          day out; Indoors is a property of a place. Two different things that were about to share a word.
        </Text>
      </View>
    </View>
  );
}


/**
 * BO5 — what is left, hardest first.
 *
 * At 465 of 485 the job is no longer getting through a list, it is spending
 * judgement where it moves something. Gym has been seen on 32 places and
 * adventure sports centre on none, so alphabetical order puts the pointless one
 * first. The default is by consequence and it stays that way.
 */
function WhatIsLeft({ rows, tax, wide, catLabel, subLabel, canManage, busyKey, onDecide, onExamples, egKey, children }: {
  rows: TaxonomyLabel[]; tax: Taxonomy; wide: boolean;
  catLabel: (k: string | null | undefined) => string;
  subLabel: (k: string | null | undefined) => string | null;
  canManage: boolean; busyKey: string | null;
  onDecide: (r: TaxonomyLabel, choice: { subcategory?: string | null; aside?: boolean; nearby?: boolean; travel?: boolean; generic?: boolean }, why?: string) => void;
  onExamples: (key: string) => void; egKey: string;
  children?: (r: TaxonomyLabel) => React.ReactNode;
}) {
  const [order, setOrder] = useQueryState<'places' | 'az' | 'oldest'>('order', 'places', asOneOf(['places', 'az', 'oldest'] as const, 'places'));
  const left = useMemo(() => {
    const list = [...rows];
    if (order === 'az') return list.sort((a, b) => (a.label ?? a.key).localeCompare(b.label ?? b.key));
    // Longest unanswered first — the ones that have been sitting there since the
    // first sweep read them, rather than the ones Google added last week.
    if (order === 'oldest') {
      return list.sort((a, b) => String(a.first_seen ?? '').localeCompare(String(b.first_seen ?? ''))
        || (a.label ?? a.key).localeCompare(b.label ?? b.key));
    }
    return list.sort((a, b) => (b.seen_count ?? 0) - (a.seen_count ?? 0) || (a.label ?? a.key).localeCompare(b.label ?? b.key));
  }, [rows, order]);
  const nothingKnows = left.filter((r) => !r.seen_count);
  const known = left.filter((r) => r.seen_count);
  const places = left.reduce((n, r) => n + (r.seen_count ?? 0), 0);

  const rowFor = (r: TaxonomyLabel) => {
    const sug = r.suggestion ?? null;
    const says = sug?.generic ? 'kept as a secondary label' : sug?.aside ? 'excluded from Epic' : sug?.travel ? 'travel'
      : sug?.nearby ? 'useful nearby'
        : sug?.subcategory ? `${catLabel(tax.subcategories.find((s) => s.key === sug.subcategory)?.category_key)} · ${subLabel(sug.subcategory)}` : null;
    return (
      <View key={r.key}>
        <View style={[styles.wordRow, !wide && { flexDirection: 'column', alignItems: 'stretch', gap: 4 }]}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={type.small}><Text style={{ fontWeight: '600' }}>{r.label ?? r.key}</Text> <Text style={{ color: colors.inkMuted }}>{r.key}</Text></Text>
            {r.why ? <Text style={[type.tiny, { lineHeight: 16 }]}>{r.why}</Text> : null}
            {canManage ? <TextAction label={egKey === r.key ? 'Hide examples' : 'Examples · one search, it costs'} onPress={() => onExamples(r.key)} /> : null}
          </View>
          <View style={[styles.tCell, { width: wide ? 90 : 60 }]}>
            <Text style={[type.small, { textAlign: 'center', fontVariant: ['tabular-nums'], color: r.seen_count ? colors.ink : colors.inkMuted }]}>{count(r.seen_count)}</Text>
          </View>
          {canManage ? (
            <View style={{ width: wide ? 300 : undefined, alignItems: 'flex-end' }}>
              <DrillDropdown
                label={says ? 'Epic would say' : 'Nothing said yet'}
                value={busyKey === r.key ? 'Saving…' : says ?? 'choose one'} stacked set={Boolean(says)} align="right" width={300}
                extra={[
                  { key: '=', label: 'Keep as a secondary label \u2014 it describes the place, it does not say what it is', on: false },
                  { key: '-', label: 'Excluded from Epic', on: false },
                  { key: '>', label: 'Travel \u2014 getting there, parking', on: false },
                  { key: '~', label: 'Useful nearby \u2014 a loo, a visitor centre', on: false },
                ]}
                groups={tax.categories.filter((c) => c.active).map((c) => ({
                  key: c.key, label: c.label,
                  items: c.subcategories.filter((sc) => sc.active).map((sc) => ({ key: sc.key, label: sc.label, on: false })),
                }))}
                onPick={(k) => onDecide(r, k === '-' ? { aside: true } : k === '>' ? { travel: true } : k === '~' ? { nearby: true } : k === '=' ? { generic: true } : { subcategory: k })}
              />
            </View>
          ) : null}
        </View>
        {children ? children(r) : null}
      </View>
    );
  };

  return (
    <View style={{ gap: spacing.lg }}>
      <Band
        kicker={`${rows.length} left`}
        title="What is left"
        stats={[
          { label: 'Left', value: String(rows.length) },
          { label: 'Places they decide', value: count(places) },
          { label: 'Nothing knows these', value: String(nothingKnows.length) },
        ]}
      />
      <View style={[styles.line, { gap: spacing.md }]}>
        <Text style={styles.bandKicker}>Order by</Text>
        {/* The chosen one reads as chosen; it was three plain words with no
            state at all (the audit). "Oldest" is the canvas's third. */}
        {([['places', 'Places it decides'], ['az', 'A to Z'], ['oldest', 'Oldest']] as const).map(([k, l]) => (
          <Choice key={k} label={l} on={order === k} onPress={() => setOrder(k)} />
        ))}
        <Text style={type.tiny}>{order === 'places' ? 'Consequence first, and it stays that way' : 'Alphabetical, which puts the pointless one first'}</Text>
      </View>
      <View style={[styles.tRow, styles.tHeadSoft]}>
        <View style={[styles.tFirst, styles.headCell, { flex: 1, width: undefined }]}><Text style={styles.colHead}>Google's word, and why it is a judgement call</Text></View>
        <View style={[styles.tCell, styles.headCell, { width: wide ? 90 : 60 }]}><Text style={[styles.colHead, { textAlign: 'center' }]}>Places</Text></View>
        {canManage ? <View style={[styles.tCell, styles.headCell, { width: wide ? 300 : 0 }]}><Text style={[styles.colHead, { textAlign: 'right' }]}>Suggestion</Text></View> : null}
      </View>
      {known.map(rowFor)}
      {nothingKnows.length ? (
        <View style={{ gap: 4, paddingTop: spacing.md }}>
          <Text style={styles.bandKicker}>Nothing knows these · {nothingKnows.length} words, {count(nothingKnows.reduce((n, r) => n + (r.seen_count ?? 0), 0))} places between them</Text>
          <Text style={type.tiny}>Surfaced here so it is not a separate errand. Answering one costs nothing and gains nothing, so they go last.</Text>
          {nothingKnows.map(rowFor)}
        </View>
      ) : null}
    </View>
  );
}


/**
 * BO1h / BO9 — real places carrying a word, and the shape they share.
 *
 * One live provider search, fenced to the word and fetched only on a press. It
 * is used from the words list and from what-is-left alike, so it lives here
 * rather than being written twice.
 */
function ExamplesPanel({ eg, egBusy, canManage, catLabel, subLabel, word, tax, onChanged, onRefetch }: {
  eg: TaxonomyExamples | null; egBusy: boolean; canManage: boolean; word: TaxonomyLabel;
  catLabel: (k: string | null | undefined) => string;
  subLabel: (k: string | null | undefined) => string | null;
  tax: Taxonomy; onChanged: (said: string, undo?: () => Promise<void>) => Promise<void>;
  onRefetch: () => void;
}) {
  const r = word;
  /**
   * BO9 — the rule builder, on the row.
   *
   * The handoff's own reason for this screen: "Combination rules have existed
   * since 12 September and have never once been used, because the builder is
   * buried in a view nobody opens. BO9 exists to fix that." Stating the rule in
   * prose and leaving him to go and find the builder was the same bug in a new
   * place, so the rule is written from here.
   */
  const [writing, setWriting] = useState(false);
  const shape = eg?.shapes?.[0];
  /**
   * Our labels for the shape, never the provider's words. A word that points at
   * nothing of ours cannot go in a rule at all, and is dropped here rather than
   * smuggled in as `google:whatever`.
   */
  const ourLabels = useMemo(() => {
    if (!shape) return [];
    const points = new Map((eg?.travels ?? []).map((t) => [t.key, t.points_at]));
    const mine = r.points_at ?? null;
    return [...new Set([mine, ...shape.words.map((w) => points.get(w) ?? null)].filter(Boolean))] as string[];
  }, [shape, eg?.travels, r.points_at]);
  /**
   * What it would have caught, **counted against the twelve already fetched**.
   * The handoff is exact about saying so: "8 of the 12 in this sample, not 8 of
   * 32", because Epic stores no places and a screen implying a total it cannot
   * know is worse than one admitting a sample.
   */
  const caught = useMemo(() => {
    if (!eg || !shape) return 0;
    const need = [r.key, ...shape.words];
    return eg.places.filter((pl) => need.every((w) => (pl.types ?? []).includes(w))).length;
  }, [eg, shape, r.key]);
  return (
                <View style={{ paddingLeft: canManage ? 34 : 6, paddingBottom: spacing.sm, gap: 4 }}>
                  {egBusy ? <Text style={type.tiny}>Asking Google for a few real ones…</Text> : null}
                  {!egBusy && eg?.problem ? <Text style={type.tiny}>Could not look: {eg.problem}</Text> : null}
                  {!egBusy && eg && !eg.problem && !eg.places.length ? <Text style={type.tiny}>Google knows no place of this type near {eg.near}.</Text> : null}
                  {!egBusy && eg && eg.places.length ? (
                    <>
                      <View style={[styles.line, { gap: spacing.md, flexWrap: 'wrap' }]}>
                        <Text style={[type.tiny, { flex: 1, minWidth: 0 }]}>{eg.places.length} near {eg.near}. Read live, never stored.{eg.fenced ? '' : ' Google will not filter by this word, so these were found by words and then kept only where it really appears.'}</Text>
                        {/* "Fetch again" (BO1h). Another search, another charge,
                            said as such rather than looking free. */}
                        {canManage ? <TextAction label="Fetch again · costs another search" tone="muted" onPress={onRefetch} /> : null}
                      </View>
                      {/* Whether the word is worth keeping as a label even if it is
                          not a category: if nothing else on the place is mapped,
                          throwing it away leaves us knowing nothing (owner, 14 Sep
                          2026: "the Activity Centre then gives us that context"). */}
                      {eg.alone != null ? (
                        <Text style={[type.tiny, eg.alone > eg.places.length / 2 && { color: colors.ink, fontWeight: '600' }]}>
                          {eg.alone === 0
                            ? 'Every one of them carries another word we have already mapped, so this word adds nothing on its own.'
                            : `${eg.alone} of ${eg.places.length} carry nothing else we have mapped — for those, this word is all we would know.`}
                        </Text>
                      ) : null}
                      {/* BO9 leads with the shape, not a list (the handoff). The
                          band first, then the words that point at nothing of
                          ours, then the ones that do -- and the places after
                          all of it. */}
                      <View style={styles.shapeBand}>
                        {[
                          { label: 'Places looked at', value: String(eg.places.length) },
                          { label: 'Shapes found', value: String(eg.shapes?.length ?? 0) },
                          { label: 'Biggest shape', value: shape ? `${shape.on} of ${eg.places.length}` : '—' },
                        ].map((st) => (
                          <View key={st.label} style={{ gap: 2 }}>
                            <Text style={styles.bandKicker}>{st.label}</Text>
                            <Text style={styles.bandValue}>{st.value}</Text>
                          </View>
                        ))}
                      </View>
                      {/* The words that sit on everything. They are on all twelve
                          and say nothing, which is exactly why the count matters
                          more than the list -- and the handoff asks for them to
                          be marked as pointing at no label of ours. */}
                      {(eg.everywhere ?? []).length ? (
                        <View style={{ gap: 3, paddingTop: 6 }}>
                          {(eg.everywhere ?? []).map((w) => (
                            <View key={w.key} style={styles.barRow}>
                              <Text style={[type.tiny, { width: 200, color: colors.inkMuted }]} numberOfLines={1}>
                                {w.key.replace(/_/g, ' ')} — points at no label of ours
                              </Text>
                              {/* The same flexing track the shape bars below use.
                                  The percentage belongs to the track, not the
                                  row: at 100% it took the whole row and
                                  collapsed the label (Codex, 15 Sep 2026). */}
                              <View style={[styles.barTrack, { flex: 1 }]}>
                                <View style={[styles.barFill, { width: `${Math.round((w.on / Math.max(1, eg.places.length)) * 100)}%`, backgroundColor: colors.line }]} />
                              </View>
                              <Text style={[type.tiny, { width: 62, textAlign: 'right' }]}>{w.on} of {eg.places.length}</Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                      {/* BO9 — the shape is the rule worth writing. The words
                          that travel with this one, how often, and the
                          combination worth naming. Opened from the row it
                          came from, holding that word. */}
                      {eg.shapes?.length ? (
                        <View style={{ paddingTop: 8, gap: 5 }}>
                          <Text style={styles.bandKicker}>
                            {eg.shapes[0].on > 1
                              ? `${eg.shapes[0].on} of ${eg.places.length} share one shape`
                              : `${eg.shapes.length} shapes from ${eg.places.length} places — no rule to write`}
                          </Text>
                          {eg.shapes[0].on > 1 ? (
                            <>
                              {eg.travels.slice(0, 5).map((t) => (
                                <View key={t.key} style={{ gap: 2 }}>
                                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                                    <Text style={type.tiny} numberOfLines={1}>
                                      {t.label ?? t.key.replace(/_/g, ' ')}
                                      {t.points_at ? '' : ' — points at no label of ours'}
                                    </Text>
                                    <Text style={type.tiny}>{t.on} of {eg.places.length}</Text>
                                  </View>
                                  <View style={styles.barTrack}>
                                    <View style={[styles.barFill, { width: `${Math.round((t.on / Math.max(1, eg.places.length)) * 100)}%` }, !t.points_at && { backgroundColor: colors.lineSoft }]} />
                                  </View>
                                </View>
                              ))}
                              {canManage && r.landing ? (
                                <View style={{ paddingTop: 6, gap: 4 }}>
                                  <Text style={type.tiny}>
                                    The rule worth writing: a place with {[r.label ?? r.key, ...eg.shapes[0].words.map((w) => eg.travels.find((t) => t.key === w)?.label ?? w)].join(' and ')}.
                                  </Text>
                                  {/* Counted against the sample, and said so.
                                      Epic stores no places, and a screen
                                      implying a total it cannot know is worse
                                      than one admitting a sample (the handoff). */}
                                  <Text style={type.tiny}>
                                    It would catch {caught} of the {eg.places.length} in this sample
                                    {r.seen_count ? `, not ${caught} of ${r.seen_count}` : ''}.
                                  </Text>
                                  {ourLabels.length > 1 ? (
                                    <TextAction label={`Write it \u2014 ${ourLabels.map((k) => subLabel(k) ?? k).join(' + ')}`} onPress={() => setWriting(true)} />
                                  ) : (
                                    <Text style={type.tiny}>
                                      There is no rule to write yet: {ourLabels.length ? 'only one of these words points at a label of ours' : 'none of these words points at a label of ours'}, and a rule is
                                      written in our labels or not at all.
                                    </Text>
                                  )}
                                  {writing ? (
                                    <RuleEditor
                                      tax={tax}
                                      start={ourLabels.map((k) => `epic:${k}`)}
                                      startSubcategory={r.landing.subcategory ?? null}
                                      fixedSubcategory={null}
                                      canManage={canManage}
                                      onClose={() => setWriting(false)}
                                      onSaved={async (saidWhat) => { setWriting(false); await onChanged(saidWhat); }}
                                    />
                                  ) : null}
                                </View>
                              ) : null}
                            </>
                          ) : (
                            <Text style={type.tiny}>
                              Every one is its own shape, so there is nothing here to name. The answer for this word is a
                              rule on our label, not on what Google happens to send with it.
                            </Text>
                          )}
                        </View>
                      ) : null}
                      {/* The places, after the shape. "It leads with the shape,
                          not a list" (the handoff, BO9) -- and each one says
                          every other word on it, which is what the drawer is
                          for (BO1h). */}
                      {eg.places.map((pl) => {
                        const others = (pl.types ?? []).filter((t) => t !== r.key && !(eg.everywhere ?? []).some((e) => e.key === t));
                        const caughtHere = shape ? [r.key, ...shape.words].every((w) => (pl.types ?? []).includes(w)) : false;
                        return (
                          <View key={pl.id} style={[styles.egRow, { alignItems: 'flex-start' }]}>
                            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                              <Text style={type.small} numberOfLines={1}><Text style={{ fontWeight: '600' }}>{pl.name ?? pl.id}</Text></Text>
                              <Text style={type.tiny} numberOfLines={1}>{[pl.address, pl.primaryType ? `Google leads with ${pl.primaryType.replace(/_/g, ' ')}` : null].filter(Boolean).join(' · ')}</Text>
                              {others.length ? (
                                <Text style={type.tiny} numberOfLines={2}>
                                  Google also calls it {others.map((t) => eg.travels.find((x) => x.key === t)?.label ?? t.replace(/_/g, ' ')).join(' · ')}
                                </Text>
                              ) : null}
                            </View>
                            {shape && shape.on > 1 ? (
                              <Text style={[type.tiny, caughtHere ? null : { color: colors.inkMuted }]}>{caughtHere ? 'caught' : '— not caught'}</Text>
                            ) : null}
                            {pl.mapsUrl ? <TextAction label="Map" onPress={() => void Linking.openURL(pl.mapsUrl as string)} /> : null}
                          </View>
                        );
                      })}
                      {eg.alsoCalled.length ? (
                        <View style={{ paddingTop: 6, gap: 2 }}>
                          <Text style={styles.colHead}>Also called, on those places</Text>
                          {eg.alsoCalled.map((w) => (
                            <Text key={w.key} style={type.tiny} numberOfLines={1}>
                              <Text style={{ fontWeight: '600', color: colors.ink }}>{w.label ?? w.key.replace(/_/g, ' ')}</Text>
                              {` · on ${w.on} of ${eg.places.length} · `}
                              {w.decision === 'generic' ? 'a secondary label'
                                : w.decision === 'aside' ? 'excluded from Epic'
                                : w.decision === 'travel' ? 'travel'
                                : w.decision === 'nearby' ? 'useful nearby'
                                : w.landing.subcategory ? `${catLabel(w.landing.category)} · ${subLabel(w.landing.subcategory)}` : 'unmapped'}
                            </Text>
                          ))}
                        </View>
                      ) : null}
                    </>
                  ) : null}
                </View>
  );
}


/**
 * BO10 — the not-sure list, and the run that goes and finds out.
 *
 * A place the labels could not settle is named here with the reason, never
 * quietly filed wrong. Tick some and send them to be looked up; what comes back
 * carries the sentence it relied on and where that came from, and nothing is
 * applied until you say so.
 */
/** 250 places per run — "a cap you can raise beats a budget you discover afterwards". */
const CEILING = 250;

function NotSure({ tax, wide, canManage, onChanged }: {
  tax: Taxonomy; wide: boolean; canManage: boolean; onChanged: (said: string, undo?: () => Promise<void>) => Promise<void>;
}) {
  const [data, setData] = useState<{ places: NotSurePlace[]; counts: Record<string, number>; runs: NotSureRun[] } | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  /**
   * The ceiling for the next run (the handoff, BO10): 250 places, raised by
   * hand on the run that needs it and never by itself. Deliberately not in the
   * address and deliberately not remembered — a raised ceiling that survived
   * into the next run would be a ceiling that raised itself.
   */
  const [cap, setCap] = useState(CEILING);

  const load = useCallback(async () => {
    try { const d = await api.taxonomyNotSure(); setData(d); } catch { setData(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const places = data?.places ?? [];
  const waiting = places.filter((p) => p.state === 'waiting');
  const answered = places.filter((p) => p.state === 'answered');
  const last = data?.runs?.[0] ?? null;
  const subLabel = (k: string | null) => tax.subcategories.find((s) => s.key === k)?.label ?? k ?? null;

  const run = async () => {
    const refs = [...ticked];
    if (!refs.length) return;
    setBusy(true);
    try {
      // The run answers straight away and reads afterwards, because six places
      // of web search is minutes and a request gets twenty-eight seconds
      // (14 Sep 2026). So the list is reloaded as the answers land rather than
      // once at the end, and the run's own receipt fills in when it finishes.
      const { started, stoppedAt } = await api.taxonomyResearch(refs, cap === CEILING ? undefined : cap);
      setTicked(new Set());
      setCap(CEILING);
      await load();
      await onChanged(stoppedAt
        ? `Looking at ${started} of the ${stoppedAt.asked} you ticked \u2014 the ceiling is ${cap}. Raise it and run the rest.`
        : `Looking at ${started} place${started === 1 ? '' : 's'}. The answers fill in as they come back.`);
      for (const wait of [15000, 30000, 45000, 60000]) setTimeout(() => void load(), wait);
    } catch (err) { await onChanged(String((err as Error).message)); }
    finally { setBusy(false); }
  };

  const settle = async (p: NotSurePlace, as: string | null) => {
    setBusy(true);
    try {
      await api.taxonomySettle(p.venue_ref, as);
      await load();
      await onChanged(as ? `${p.name ?? p.venue_ref} → ${subLabel(as)}.` : `${p.name ?? p.venue_ref} dropped from the list.`);
    } catch (err) { await onChanged(String((err as Error).message)); }
    finally { setBusy(false); }
  };

  const row = (p: NotSurePlace) => (
    <View key={p.venue_ref} style={[styles.wordRow, openKey === p.venue_ref && { zIndex: 40 }, !wide && { flexDirection: 'column', alignItems: 'stretch', gap: 4 }]}>
      {canManage && p.state === 'waiting' ? (
        <Press effect="none" onPress={() => setTicked((prev) => { const n = new Set(prev); if (n.has(p.venue_ref)) n.delete(p.venue_ref); else n.add(p.venue_ref); return n; })}
               accessibilityRole="checkbox" accessibilityState={{ checked: ticked.has(p.venue_ref) }} style={styles.tickCell}>
          <View style={[styles.tick, ticked.has(p.venue_ref) && styles.tickOn]}>
            {ticked.has(p.venue_ref) ? <Icon name="check" size={13} color={colors.selectedFg} strokeWidth={3.2} /> : null}
          </View>
        </Press>
      ) : null}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={type.small}><Text style={{ fontWeight: '600' }}>{p.name ?? p.venue_ref}</Text></Text>
        <Text style={[type.tiny, { lineHeight: 16 }]}>{p.address ? `${p.address} · ` : ''}{p.reason}</Text>
        {p.part_of_name ? <Text style={[type.tiny, { color: colors.accent }]}>It says this sits inside {p.part_of_name}.</Text> : null}
        {p.because ? (
          <Text style={[type.tiny, { color: colors.accent, lineHeight: 16 }]} numberOfLines={3}>
            {p.because}{p.source ? ` — ${p.source}` : ''}
          </Text>
        ) : null}
      </View>
      {canManage ? (
        <View style={{ width: wide ? 300 : undefined, alignItems: 'flex-end', gap: 4 }}>
          <DrillDropdown
            label={p.said ? 'It says' : 'Nothing said yet'}
            value={busy ? 'Working…' : subLabel(p.said) ?? 'choose one'} stacked set={Boolean(p.said)} align="right" width={300}
            groups={tax.categories.filter((c) => c.active).map((c) => ({
              key: c.key, label: c.label,
              items: c.subcategories.filter((sc) => sc.active).map((sc) => ({ key: sc.key, label: sc.label, on: p.said === sc.key })),
            }))}
            onPick={(k) => void settle(p, k)}
            onOpenChange={(o) => setOpenKey(o ? p.venue_ref : null)}
          />
          <TextAction label="Not one of ours" disabled={busy} onPress={() => void settle(p, null)} />
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={{ gap: spacing.lg }}>
      <Band
        kicker={`${waiting.length} waiting · ${answered.length} answered`}
        title="Not sure"
        stats={[
          { label: 'Waiting', value: String(waiting.length) },
          { label: 'Answered, waiting on you', value: String(answered.length) },
          { label: 'Last run', value: last ? `${last.looked_at} looked at${last.cost_pence != null ? ` · £${(last.cost_pence / 100).toFixed(2)}` : ''}` : 'none yet' },
        ]}
      />
      <Said lead="The labels could not settle these.">
        Each one is named with the reason. Tick some and send them to be looked up: what comes back carries the sentence it
        relied on and where that came from. Nothing is applied until you say so.
      </Said>
      {canManage && ticked.size ? (
        <View style={[styles.line, { gap: spacing.md, justifyContent: 'flex-end', flexWrap: 'wrap' }]}>
          {/* The ceiling, named on the run rather than kept anywhere (the
              handoff, BO10): "a cap you can raise beats a budget you discover
              afterwards". It goes back to 250 the moment the run is sent, so
              nothing it did can raise it for next time. */}
          <Text style={[type.tiny, { flex: 1, minWidth: 0 }]}>
            The ceiling is {cap} places for this run. It never raises itself.
            {ticked.size > cap ? ` You have ticked ${ticked.size} — raise it or the rest wait.` : ''}
          </Text>
          <DrillDropdown
            label="Ceiling" value={String(cap)} set={cap !== CEILING} align="right" width={220}
            groups={[{ key: 'c', label: 'Places in this one run', items: [250, 400, 600, 1000].map((n) => ({ key: String(n), label: String(n), on: n === cap })) }]}
            startIn="c"
            onPick={(k) => setCap(Number(k) || CEILING)}
          />
          <TextAction label="Clear" onPress={() => setTicked(new Set())} />
          <Press effect="none" onPress={() => void run()} disabled={busy} accessibilityRole="button"
                 style={({ hovered }: any) => [styles.approve, hovered && styles.approveOn, busy && { opacity: 0.5 }]}>
            {({ hovered }: any) => (
              <Text style={[type.small, { fontWeight: '700', color: hovered ? colors.selectedFg : colors.accent }]}>
                {busy ? 'Looking…' : `Go and find out · ${Math.min(ticked.size, cap)}`}
              </Text>
            )}
          </Press>
        </View>
      ) : null}
      {places.length === 0 ? <Text style={[type.small, styles.emptyRow]}>Nothing on the list. Every place the labels met was settled by them.</Text> : null}
      {answered.length ? (
        <View style={{ gap: 4 }}>
          <Text style={styles.bandKicker}>Answered, waiting on you</Text>
          {answered.map(row)}
        </View>
      ) : null}
      {waiting.length ? (
        <View style={{ gap: 4, paddingTop: answered.length ? spacing.md : 0 }}>
          <Text style={styles.bandKicker}>Waiting to be looked at</Text>
          {waiting.map(row)}
        </View>
      ) : null}
    </View>
  );
}


/**
 * BO11 — a place that is part of another place.
 *
 * The owner, 14 Sep 2026: "if you know something is part of Thorpe Park, it all
 * lives in Thorpe Park, and we should only ever display Thorpe Park, not Amity
 * Beach." A proposal from a research run waits here; confirming it takes the
 * child off every list and sends what it knows up to its parent.
 */
function PartsOfPlaces({ canManage, tax, secondary, onChanged }: {
  canManage: boolean; tax: Taxonomy; secondary: PlaceAttribute[];
  onChanged: (said: string, undo?: () => Promise<void>) => Promise<void>;
}) {
  const subLabel = (k: string) => tax.subcategories.find((x) => x.key === k)?.label ?? k.replace(/-/g, ' ');
  const labelName = (k: string) => secondary.find((a) => a.key === k)?.label ?? k.replace(/-/g, ' ');
  const [rows, setRows] = useState<PlacePart[] | null>(null);
  const [settled, setSettled] = useState<PlacePart[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const d = await api.taxonomyParts(); setRows(d.proposed); setSettled(d.told ?? []); }
    catch { setRows([]); setSettled([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const say = async (p: PlacePart, yes: boolean) => {
    setBusy(true);
    try {
      await api.taxonomySetPart({ child: p.child_ref, parent: yes ? p.parent_ref : null, note: p.note });
      await load();
      await onChanged(yes ? `${p.child_ref} is part of ${p.parent_ref}; it is off its own lists now.`
        : `${p.child_ref} stands on its own.`);
    } catch (err) { await onChanged(String((err as Error).message)); }
    finally { setBusy(false); }
  };

  /** A name if we have one; a reference is not something anybody can read. */
  const nameOf = (ref: string, given: string | null | undefined) => given ?? ref;

  /**
   * One part-of, said the way the handoff draws it: part of · on its own · what
   * goes up. The third line is lime because nobody typed it — it arrived from
   * the child, which is the same rule as a label that comes with another.
   */
  const one = (p: PlacePart, confirmed: boolean) => (
    <View key={p.child_ref} style={[styles.wordRow, { alignItems: 'flex-start' }]}>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={[type.small, { fontWeight: '700' }]}>{nameOf(p.child_ref, p.child_name)}</Text>
        <Text style={type.tiny}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>Part of</Text> {nameOf(p.parent_ref, p.parent_name)}
        </Text>
        <Text style={type.tiny}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>On its own</Text> never listed, never searchable
        </Text>
        {/* Lime: it arrived, nobody typed it. Named rather than described —
            "what Thorpe Park knows because of it: Water park, Swimming, Suits
            ages 0 to 12" (the handoff, BO11; the audit found the whole section
            missing). */}
        <Text style={[type.tiny, { color: colors.accent }]} numberOfLines={3}>
          <Text style={{ fontWeight: '700' }}>What goes up </Text>
          {(() => {
            const up = [
              p.goes_up?.primary ? subLabel(p.goes_up.primary) : null,
              ...(p.goes_up?.secondary ?? []).map((k) => labelName(k)),
            ].filter(Boolean);
            return up.length
              ? `${up.join(', ')} — so ${nameOf(p.parent_ref, p.parent_name)} knows it has one`
              : `its primary label and every secondary label it carries, to ${nameOf(p.parent_ref, p.parent_name)}`;
          })()}
        </Text>
        {p.note ? <Text style={[type.tiny, { lineHeight: 16 }]} numberOfLines={3}>{p.note}</Text> : null}
      </View>
      {canManage && !confirmed ? (
        <View style={[styles.line, { gap: spacing.md }]}>
          <TextAction label="It is" disabled={busy} onPress={() => void say(p, true)} />
          <TextAction label="It stands alone" disabled={busy} onPress={() => void say(p, false)} />
        </View>
      ) : canManage ? (
        <TextAction label="It stands alone" tone="muted" disabled={busy} onPress={() => void say(p, false)} />
      ) : null}
    </View>
  );

  return (
    <View style={{ gap: spacing.md, paddingTop: spacing.lg }}>
      <Text style={styles.bandKicker}>
        Inside somewhere else · {rows?.length ?? 0} to confirm{settled.length ? ` · ${settled.length} settled` : ''}
      </Text>
      <Said lead="No rule can tell these apart.">
        Amity Beach and a standalone water park carry the same words, so what separates them is that one is inside the other.
        Confirm and the child is never listed on its own; what it knows goes up to its parent instead.
      </Said>
      {rows?.length ? rows.map((p) => one(p, false)) : (
        <Text style={[type.small, styles.emptyRow]}>
          Nothing waiting. Every place the research run found inside another one has been answered.
        </Text>
      )}
      {settled.length ? (
        <View style={{ gap: 4, paddingTop: spacing.md }}>
          <Text style={styles.bandKicker}>Already inside something · {settled.length}</Text>
          {settled.map((p) => one(p, true))}
        </View>
      ) : null}
      {/* The test, on the screen, because it is the whole point and it is the
          kind of thing that gets forgotten and then re-argued (the handoff). */}
      <View style={styles.theTest}>
        <Text style={[type.tiny, { lineHeight: 17 }]}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>The test: </Text>
          a family searching for a water park should find Thorpe Park, and never a listing called Amity Beach that they
          cannot buy a ticket to.
        </Text>
      </View>
    </View>
  );
}

/** A secondary label's value, in one short phrase. */
function said(v: AttributeValue): string {
  if (v.choice) return v.choice;
  if (v.from != null || v.to != null) return `${v.from ?? ''}\u2013${v.to ?? ''}`;
  return v.yesno === false ? 'no' : 'yes';
}

/**
 * What a provider's word says besides where it sends a place.
 *
 * The owner, 14 Sep 2026: "I see a fine dining restaurant, but no label for
 * fine dining. It's just mapped to food and drinks, restaurants." Both answers
 * live on the same row because they are both answers about the same word, and
 * they never compete: `italian_restaurant` lands a place in Restaurants *and*
 * says Italian. Drawn in lime, because nobody typed it on the place.
 */
function Carries({ r, secondary, onChanged }: {
  r: TaxonomyLabel; secondary: SecondaryLabel[]; onChanged: (said: string, undo?: () => Promise<void>) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const label = `${r.namespace}:${r.key}`;
  const has = r.carries ?? [];
  const set = async (attribute: string, value: AttributeValue | null) => {
    setBusy(true);
    try {
      await api.taxonomySetCarries({ label, attribute, value });
      const name = secondary.find((x) => x.key === attribute)?.label ?? attribute;
      await onChanged(value ? `${r.key.replace(/_/g, ' ')} also says ${name} \u00b7 ${said(value)}.` : `${r.key.replace(/_/g, ' ')} no longer says ${name}.`);
    } finally { setBusy(false); }
  };
  // Only the one-of labels are offered here: a yes/no or a range belongs to a
  // drawer or a place, not to a word Google happens to use.
  const offerable = secondary.filter((a) => a.kind === 'oneof');
  if (!offerable.length) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
      {offerable.map((a) => {
        const on = has.find((c) => c.key === a.key);
        return (
          <DrillDropdown
            key={a.key}
            label={a.label}
            value={on ? said(on.value) : '\u2014'}
            set={Boolean(on)}
            width={260}
            groups={[{ key: a.key, label: a.label, items: a.options.map((o) => ({ key: o, label: o, on: on?.value.choice === o })) }]}
            startIn={a.key}
            extra={on ? [{ key: '\u2717', label: `Not ${a.label.toLowerCase()}`, on: false }] : []}
            onPick={(k) => { if (!busy) void set(a.key, k === '\u2717' ? null : { choice: k }); }}
          />
        );
      })}
    </View>
  );
}

function GoogleView({ tax, wide, roomy, by, view, catLabel, subLabel, canManage, onChanged }: {
  tax: Taxonomy; wide: boolean; roomy: boolean; by: 'google' | 'ours' | 'subs'; view: View_;
  catLabel: (k: string | null | undefined) => string; subLabel: (k: string | null | undefined) => string | null;
  canManage: boolean; onChanged: (said: string, undo?: () => Promise<void>) => Promise<void>;
}) {
  const [rows, setRows] = useState<TaxonomyLabel[] | null>(null);
  const [group, setGroup] = useQueryState<string>('group', '', asText);
  /** Mapped, unmapped or all — a tab across the top (owner, 13 Sep 2026). */
  const [tab, setTab] = useQueryState<'mapped' | 'unmapped' | 'all'>('tab', 'all', asOneOf(['mapped', 'unmapped', 'all'] as const, 'all'));
  /** "Not a day out" is noise: hidden from every view unless this is on. */
  const [noise, setNoise] = useQueryState<string>('noise', '', asText);
  /** Inside one of our categories: only the words mapped to this subcategory. */
  const [only, setOnly] = useQueryState<string>('only', '', asText);
  /**
   * One kind of answer at a time (owner, 14 Sep 2026: "where do I find these
   * words? Can I have a filter for them on the categories list, and then I can
   * do it myself?"). Sits over the tabs: Unmapped + attributes is empty on
   * purpose, because a word kept as a label is decided.
   */
  const [std, setStd] = useQueryState<string>('std', '', asText);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  /** The row whose dropdown is open, lifted over the rows after it. */
  const [openKey, setOpenKey] = useState<string | null>(null);
  /**
   * The generic word whose company is open (owner, 13 Sep 2026: "instead
   * surface all the subcategories and map those accordingly"). A word like
   * `tourist_attraction` says nothing on its own, so what is worth seeing is
   * the specific words Google puts on the same places — each mappable here.
   */
  /**
   * The word whose real places are open (owner, 13 Sep 2026: "I definitely need
   * a means to be able to click through and see some examples of some of these
   * places. Adventure Sports Centre: I don't know what that is"). One live
   * provider call, so it is asked for on a press and never on a page load.
   */
  // Deliberately *not* in the address. Every other layer of this screen is
  // (routes.ts is the rule), but opening this one spends a Google call, and a
  // refreshed tab, a shared link or a Back would spend another without anybody
  // pressing anything (Codex, 13 Sep 2026). Nothing here is stored, so there is
  // nothing at that address to share either.
  const [egKey, setEg] = useState('');
  const [eg, setEgData] = useState<TaxonomyExamples | null>(null);
  const [egBusy, setEgBusy] = useState(false);
  const wantedEg = useRef('');
  const loadEg = useCallback(async (key: string) => {
    wantedEg.current = key; setEgBusy(true);
    // `queue`: the ones the labels could not settle go on the not-sure list
    // rather than being quietly filed wrong (the handoff, BO8).
    try { const d = await api.taxonomyExamples(`google:${key}`, true); if (wantedEg.current === key) setEgData(d); }
    catch { if (wantedEg.current === key) setEgData(null); }
    finally { if (wantedEg.current === key) setEgBusy(false); }
  }, []);
  useEffect(() => { if (!egKey) { setEgData(null); return; } setEgData(null); void loadEg(egKey); }, [egKey, loadEg]);

  const [withKey, setWith] = useQueryState<string>('with', '', asText);
  const [withWords, setWithWords] = useState<TaxonomyLabel[] | null>(null);
  // The answer is only drawn if it is still the row that was asked about: two
  // rows opened quickly would otherwise show one's words under the other, with
  // mapping controls for the wrong word (Codex, 13 Sep 2026).
  const wantedWith = useRef('');
  const loadWith = useCallback(async (key: string) => {
    wantedWith.current = key;
    try { const d = await api.taxonomyPairs(`google:${key}`); if (wantedWith.current === key) setWithWords(d.words); }
    catch { if (wantedWith.current === key) setWithWords([]); }
  }, []);
  useEffect(() => { if (!withKey) { setWithWords(null); return; } setWithWords(null); void loadWith(withKey); }, [withKey, loadWith]);

  /** The secondary labels a word can be given, for the control on its row. */
  const [secondary, setSecondary] = useState<SecondaryLabel[]>([]);
  const reload = useCallback(async () => {
    const d = await api.taxonomyLabels({ namespace: 'google', all: true, limit: 2000 });
    setRows(d.labels); setSecondary(d.secondary ?? []);
  }, []);
  useEffect(() => {
    let live = true;
    void api.taxonomyLabels({ namespace: 'google', all: true, limit: 2000 })
      .then((d) => { if (live) { setRows(d.labels); setSecondary(d.secondary ?? []); } })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [tax]);

  /** Where a Google subcategory stands: mapped to one of ours, a category only, not a day out, a label, or nothing said. */
  const standing = (r: TaxonomyLabel): 'mapped' | 'category' | 'aside' | 'nearby' | 'travel' | 'generic' | 'undecided' =>
    r.decision === 'aside' || r.active === false ? 'aside' : r.decision === 'nearby' ? 'nearby' : r.decision === 'travel' ? 'travel'
      : r.decision === 'generic' ? 'generic'
      : r.landing.subcategory ? 'mapped' : r.landing.how === 'fallback' || !r.landing.category ? 'undecided' : 'category';
  const decided = (r: TaxonomyLabel) => { const st = standing(r); return st === 'mapped' || st === 'aside' || st === 'nearby' || st === 'travel' || st === 'generic'; };
  /** Ticked rows, for approving several at once. */
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const tick = (key: string, on: boolean) => setTicked((prev) => { const n = new Set(prev); if (on) n.add(key); else n.delete(key); return n; });

  /** The rows every view is built from: without the noise unless asked, and by the tab. */
  const inView = (r: TaxonomyLabel) => {
    if (std && standing(r) !== std) return false;
    if (noise !== '1' && standing(r) === 'aside' && std !== 'aside') return false;
    if (tab === 'mapped') return decided(r);
    if (tab === 'unmapped') return !decided(r);
    return true;
  };
  type Group = { key: string; name: string; types: TaxonomyLabel[]; mapped: number; unmapped: number; places: number; aside: string };
  const groups = useMemo<Group[]>(() => {
    const out: Group[] = [];
    const put = (key: string, name: string, r: TaxonomyLabel) => {
      let g = out.find((x) => x.key === key);
      if (!g) { g = { key, name, types: [], mapped: 0, unmapped: 0, places: 0, aside: '' }; out.push(g); }
      g.types.push(r);
      g.places += r.seen_count ?? 0;
      if (decided(r)) g.mapped += 1; else g.unmapped += 1;
    };
    const rowsIn = (rows ?? []).filter(inView);
    if (by === 'google') {
      for (const r of rowsIn) {
        const name = r.note && r.note !== 'read by google.js' ? r.note : 'Not in Table A (seen on a place)';
        put(name, name, r);
      }
      out.sort((a, b) => a.name.localeCompare(b.name));
      // The right-hand column: which of our categories the group's words land in.
      for (const g of out) {
        const lands = [...new Set(g.types.filter((r) => r.active !== false && !r.decision && r.landing.category && r.landing.how !== 'fallback').map((r) => r.landing.category as string))];
        g.aside = lands.map(catLabel).join(', ') || '—';
      }
    } else {
      for (const c of tax.categories) {
        for (const r of rowsIn) if (r.active !== false && !r.decision && r.landing.category === c.key && r.landing.how !== 'fallback') put(c.key, c.label, r);
      }
      for (const r of rowsIn) if (standing(r) === 'generic') put('_generic', 'Secondary labels, not categories', r);
      for (const r of rowsIn) if (standing(r) === 'travel') put('_travel', 'Travel', r);
      for (const r of rowsIn) if (standing(r) === 'nearby') put('_nearby', 'Useful nearby', r);
      for (const r of rowsIn) if (standing(r) === 'aside') put('_aside', 'Excluded from Epic', r);
      for (const r of rowsIn) if (standing(r) === 'undecided') put('_none', 'Unmapped', r);
      // The right-hand column: our subcategories the words are in, with counts.
      for (const g of out) {
        const per = new Map<string, number>();
        for (const r of g.types) if (r.landing.subcategory) per.set(r.landing.subcategory, (per.get(r.landing.subcategory) ?? 0) + 1);
        g.aside = [...per.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${subLabel(k)} ${n}`).join(' · ') || '—';
      }
    }
    // A category with nothing left in it after the switch and the tab is noise too.
    return out.filter((g) => g.types.length);
  }, [rows, by, tab, noise, std, tax, catLabel, subLabel]);

  const chosen = group === '-' ? null : groups.find((g) => g.key === group) ?? null;
  const total = groups.reduce((t, g) => ({ types: t.types + g.types.length, places: t.places + g.places, mapped: t.mapped + g.mapped, unmapped: t.unmapped + g.unmapped }), { types: 0, places: 0, mapped: 0, unmapped: 0 });

  /** One Google subcategory decided, on the fly: one of ours, or not a day out. */
  /**
   * Undo is the server's, not the browser's.
   *
   * The first version of this snapshotted each word's answer here and sent it
   * back as another batch, and Codex took it apart three times over: the old
   * answer is often *no answer*, which the batch endpoint refuses, so Undo
   * failed silently for every word Approve-all had touched; and deciding a word
   * generic deletes every combination rule naming it, which the browser has no
   * way of giving back. The write now records what it is about to destroy and
   * hands back a token, and this sends the token.
   */
  const putBack = (id: string | null) => (id ? async () => {
    await api.taxonomyUndo(id);
    await reload();
    // The parent's copy of the rules was refreshed after the change and would
    // otherwise still hold it (Codex, 15 Sep 2026).
    await onChanged('Put back.');
  } : undefined);

  const decide = async (r: TaxonomyLabel, choice: { subcategory?: string | null; aside?: boolean; nearby?: boolean; travel?: boolean; generic?: boolean }, why?: string) => {
    setBusyKey(r.key);
    try {
      const out = await api.taxonomyBatch([{ labels: [`google:${r.key}`], subcategory: choice.subcategory ?? null, aside: Boolean(choice.aside), nearby: Boolean(choice.nearby), travel: Boolean(choice.travel), generic: Boolean(choice.generic), reason: why ?? null }]);
      if (out.failed.length) throw new Error(out.failed[0].error);
      await reload();
      if (withKey) void loadWith(withKey);
      await onChanged(choice.aside ? `${r.label ?? r.key}: excluded from Epic.` : choice.travel ? `${r.label ?? r.key}: travel.` : choice.nearby ? `${r.label ?? r.key}: useful nearby.` : choice.generic ? `${r.label ?? r.key}: a label, not a subcategory.` : `${r.label ?? r.key} → ${catLabel(tax.subcategories.find((s) => s.key === choice.subcategory)?.category_key)} · ${subLabel(choice.subcategory)}.`, putBack(out.undo));
    } catch (err) { await onChanged(String((err as Error).message)); }
    finally { setBusyKey(null); }
  };

  /**
   * Google's word becomes a subcategory of ours, under the category picked,
   * and the word is mapped to it (owner, 13 Sep 2026: "if they call it water
   * park… I would like a new one called water park, and likewise with marina").
   */
  const adoptWord = async (r: TaxonomyLabel, categoryKey: string) => {
    setBusyKey(r.key);
    try {
      const { subcategory, created } = await api.taxonomyAdopt({ label: `google:${r.key}`, categoryKey, name: r.label ?? r.key });
      await reload();
      await onChanged(`${created ? 'New subcategory' : 'Subcategory'} ${subcategory.label} under ${catLabel(categoryKey)}, with ${r.label ?? r.key} mapped to it.`);
    } catch (err) { await onChanged(String((err as Error).message)); }
    finally { setBusyKey(null); }
  };

  /**
   * One answer for every ticked word (owner, 13 Sep 2026: "I guess that's a
   * bulk action, so then you'd need to add a toolbar above where I can bulk
   * apply a particular category or subcategory (the same control)").
   */
  const applyMany = async (rows: TaxonomyLabel[], choice: { subcategory?: string | null; aside?: boolean; nearby?: boolean; travel?: boolean; generic?: boolean }) => {
    if (!rows.length) return;
    const said = choice.aside ? 'excluded from Epic' : choice.travel ? 'travel' : choice.nearby ? 'useful nearby' : choice.generic ? 'a label, not a subcategory' : `${catLabel(tax.subcategories.find((s) => s.key === choice.subcategory)?.category_key)} · ${subLabel(choice.subcategory)}`;
    setBusyKey('*');
    try {
      const out = await api.taxonomyBatch(rows.map((r) => ({
        labels: [`google:${r.key}`], subcategory: choice.subcategory ?? null,
        aside: Boolean(choice.aside), nearby: Boolean(choice.nearby), travel: Boolean(choice.travel), generic: Boolean(choice.generic),
        reason: `Set in bulk from the Categories screen: ${said}.`,
      })));
      setTicked(new Set());
      await reload();
      await onChanged(`${out.done.length} of ${rows.length} → ${said}${out.failed.length ? ` — ${out.failed.length} failed: ${out.failed[0].error}` : ''}.`, putBack(out.undo));
    } catch (err) { await onChanged(String((err as Error).message)); }
    finally { setBusyKey(null); }
  };

  /** Every unmapped subcategory in a group with a suggestion, approved in one press. */
  const approveAll = async (types: TaxonomyLabel[]) => {
    const items = types.filter((r) => !decided(r) && r.suggestion).map((r) => ({
      labels: [`google:${r.key}`], subcategory: r.suggestion?.subcategory ?? null, aside: Boolean(r.suggestion?.aside), nearby: Boolean(r.suggestion?.nearby), travel: Boolean(r.suggestion?.travel), generic: Boolean(r.suggestion?.generic), reason: `Approved: ${r.suggestion?.why}.`,
    }));
    if (!items.length) return;
    setBusyKey('*');
    try {
      const out = await api.taxonomyBatch(items);
      setTicked(new Set());
      await reload();
      await onChanged(`Approved ${out.done.length} of ${items.length}${out.failed.length ? ` — ${out.failed.length} failed: ${out.failed[0].error}` : ''}.`, putBack(out.undo));
    } catch (err) { await onChanged(String((err as Error).message)); }
    finally { setBusyKey(null); }
  };

  if (!rows) return <Text style={type.small}>Reading Google's list…</Text>;

  // Four number columns, the last column and the padding have to leave the
  // name room from the 900px breakpoint up, not only on a big screen (Codex, 12 Sep 2026).
  const COL = roomy ? 132 : wide ? 88 : 58;
  const LAST = roomy ? 320 : 200;
  const MAP = roomy ? 380 : 300;
  const COLS = wide ? ['Subcategories', 'Places', 'Mapped', 'Unmapped'] : ['Subs', 'Mapped', 'Unmapped'];
  const cells = (g: { types: TaxonomyLabel[]; places: number; mapped: number; unmapped: number }) => (wide ? [g.types.length, g.places, g.mapped, g.unmapped] : [g.types.length, g.mapped, g.unmapped]);
  const cellsTotal = wide ? [total.types, total.places, total.mapped, total.unmapped] : [total.types, total.mapped, total.unmapped];
  const placesAt = wide ? 1 : -1; const unmappedAt = wide ? 3 : 2;
  const first = by === 'google' ? "Google's category / subcategory" : 'Our category / subcategory';
  const last = by === 'google' ? 'Lands in' : 'Our subcategories';

  const asideCount = (rows ?? []).filter((r) => standing(r) === 'aside').length;
  return (
    <View>
      {/* Lifted, like the Show/By row above it: every React Native Web view is
          its own stacking context, so without this the Showing menu opens
          underneath the table and reads as see-through (owner, 14 Sep 2026). */}
      {/* BO5 — what is left, hardest first. Same rows, same actions, ordered by
          what answering one actually moves. */}
      {/* BO1i — our 59, as rows. "Our subcategory | Home, and also in | Google
          words | Places". The eight categories above them are a different
          question and stay behind their own option (the audit, 15 Sep 2026). */}
      {by === 'subs' && view !== 'left' ? (
        <OurSubcategories tax={tax} rows={rows ?? []} wide={wide} catLabel={catLabel} />
      ) : null}
      {view === 'left' ? (
        <WhatIsLeft
          rows={(rows ?? []).filter((r) => !decided(r))}
          tax={tax} wide={wide} catLabel={catLabel} subLabel={subLabel} canManage={canManage}
          busyKey={busyKey}
          onDecide={(r, choice) => void decide(r, choice)}
          onExamples={(k) => { setEg(egKey === k ? '' : k); setWith(''); }}
          egKey={egKey}
          children={(r) => (egKey === r.key ? <ExamplesPanel eg={eg} egBusy={egBusy} canManage={canManage} word={r} catLabel={catLabel} subLabel={subLabel} tax={tax} onChanged={onChanged} onRefetch={() => void loadEg(r.key)} /> : null)}
        />
      ) : null}
      {view === 'left' ? null : (
      <>
      {/* Open a category and it becomes its own page: a way back carrying the
          local count, then a band for the category you are in (the handoff,
          BO1a). Closed, the band is the whole of Google's list. */}
      {chosen ? (
        <View style={{ gap: spacing.md }}>
          {/* The back link carries the **local** count, and the top-level view
              carries the global one. The handoff is explicit that the two
              scopes must not be mixed, and this said the global figure while
              standing inside one category, which reads as though the whole job
              were done from in here. Hence "answered here". */}
          <TextAction
            label={`All ${groups.length} ${by === 'ours' ? 'of our categories' : "Google's categories"} · ${chosen.mapped} of ${chosen.types.length} answered here`}
            onPress={() => { setGroup('-'); setOnly(''); setTicked(new Set()); setEg(''); }}
          />
          <Band
            kicker={by === 'ours' ? 'Our category' : "Google's category"}
            title={chosen.name}
            stats={[
              { label: 'Subcategories', value: String(chosen.types.length) },
              { label: 'Mapped', value: String(chosen.mapped) },
              { label: 'Unmapped', value: String(chosen.unmapped) },
              { label: 'Lands in', value: chosen.aside },
            ]}
          />
        </View>
      ) : (
        <Band
          kicker={by === 'ours' ? 'By our categories' : "By Google's categories"}
          title="Google's words"
          stats={[
            { label: 'Words', value: count(total.types) },
            { label: 'Answered', value: count(total.mapped) },
            { label: 'Left', value: count(total.unmapped) },
          ]}
        />
      )}
      <View style={[styles.line, { flexWrap: 'wrap', gap: spacing.md, paddingBottom: spacing.md, zIndex: 20 }]}>
        <View style={[styles.tabs, { width: wide ? 360 : '100%' }]}>
          {([['mapped', 'Mapped'], ['unmapped', 'Unmapped'], ['all', 'All']] as const).map(([v, l], i) => (
            <Press key={v} effect="none" onPress={() => { setTab(v); setGroup('-'); setTicked(new Set()); }} accessibilityRole="button" accessibilityState={{ selected: tab === v }}
                   style={[styles.tabItem, i > 0 && styles.tabDivider, tab === v && styles.tabOn]}>
              <Text style={[type.small, { fontWeight: '700', color: tab === v ? colors.selectedFg : colors.inkMuted }]}>{l}</Text>
            </Press>
          ))}
        </View>
        <Dropdown
          label="Showing" value={STANDINGS.find((o) => o.key === std)?.label ?? 'Every answer'}
          options={STANDINGS.map((o) => ({ key: o.key, label: o.label, on: std === o.key }))}
          onPick={(k) => { setStd(k); setGroup('-'); setTicked(new Set()); }}
        />
        <View style={{ flex: 1 }} />
        <Press effect="none" onPress={() => setNoise(noise === '1' ? '' : '1')} accessibilityRole="switch" accessibilityState={{ checked: noise === '1' }}
               style={[styles.barControl, noise === '1' && styles.barControlOn]}>
          <Text style={[type.small, { fontWeight: '700', color: colors.ink }]}>{noise === '1' ? 'Showing' : 'Show'} excluded · {asideCount}</Text>
        </Press>
      </View>
      {chosen || by === 'subs' ? null : (
        <View style={[styles.tRow, styles.tHeadSoft, styles.gRow, styles.stick]}>
          <View style={[styles.tFirst, styles.headCell, { flex: 1, width: undefined }]}><Text style={styles.colHead} numberOfLines={2}>{first}</Text></View>
          {COLS.map((h) => <View key={h} style={[styles.tCell, styles.headCell, { width: COL }]}><Text style={[styles.colHead, { textAlign: 'center' }]} numberOfLines={1}>{h}</Text></View>)}
          {wide ? <View style={[styles.tCell, styles.headCell, styles.gLast, { width: LAST }]}><Text style={styles.colHead} numberOfLines={1}>{last}</Text></View> : null}
        </View>
      )}
      {(by === 'subs' ? [] : chosen ? [chosen] : groups).map((g) => {
        const on = chosen?.key === g.key;
        // Inside one of our categories, one subcategory at a time if asked.
        const subsHere = by === 'ours' && !g.key.startsWith('_')
          ? tax.subcategories.filter((sc) => sc.category_key === g.key).map((sc) => ({ ...sc, n: g.types.filter((r) => r.landing.subcategory === sc.key).length })).filter((sc) => sc.n)
          : [];
        const shown = g.types.filter((r) => !only || by !== 'ours' || r.landing.subcategory === only);
        const suggestible = g.types.filter((r) => !decided(r) && r.suggestion).length;
        // Ticked rows in this group that have a suggestion to approve.
        // Anything on screen can be ticked, not only the ones with a suggestion:
        // the tick is how several words are given the same answer at once
        // (owner, 13 Sep 2026: "you'd need to add a toolbar above where I can
        // bulk apply a particular category or subcategory").
        const tickable = shown;
        const tickedHere = tickable.filter((r) => ticked.has(r.key));
        const allTicked = tickable.length > 0 && tickedHere.length === tickable.length;
        const tickedWithSuggestion = tickedHere.filter((r) => !decided(r) && r.suggestion);
        return (
          <View key={g.key} style={on && openKey ? { zIndex: 40 } : undefined}>
          {/* Opening another category clears the ticks: they mean "these rows,
              here", and a bulk apply must never quietly skip ones out of sight
              (Codex, 13 Sep 2026). */}
          {on ? null : (
          <Press effect="none" onPress={() => { setGroup(g.key); setOnly(''); setTicked(new Set()); setEg(''); }} accessibilityRole="button" style={[styles.tRow, styles.gRow, { alignItems: 'center' }]}>
            <View style={[styles.tFirst, { flex: 1, width: undefined }]}>
              <Text style={[type.small, { fontWeight: on ? '700' : '600' }]} numberOfLines={2}>{g.name}</Text>
              {!wide && g.aside !== '—' ? <Text style={type.tiny} numberOfLines={1}>{g.aside}</Text> : null}
            </View>
            {cells(g).map((n, i) => (
              <View key={i} style={[styles.tCell, { width: COL }]}>
                {/* No sum of places over a category: one place carries several of
                    Google's words, so the sum would count it more than once. The
                    number is exact on each subcategory row below. */}
                <Text style={[type.small, { textAlign: 'center', fontVariant: ['tabular-nums'], color: (i === unmappedAt && !n) || i === placesAt ? colors.inkMuted : colors.ink, fontWeight: i === unmappedAt && n ? '700' : '400' }]}>{i === placesAt ? '—' : n}</Text>
              </View>
            ))}
            {wide ? <View style={[styles.tCell, styles.gLast, { width: LAST }]}><Text style={[type.tiny, { lineHeight: 17 }]} numberOfLines={2}>{g.aside}</Text></View> : null}
          </Press>
          )}
          {/* Inside a category: its words, and nothing else on the page. */}
          {on ? (
            <View style={styles.opened}>
              {/* Every React Native Web view is its own stacking context, so a
                  menu opened in the bar has to lift the bar itself or the rows
                  under it paint straight over the panel (13 Sep 2026). */}
              <View style={[styles.stickGroup, openKey === `bulk:${g.key}` && { zIndex: 60 }]}>
              {/* At 390 the tray docks to the bottom with the count reduced to a
                  number (the handoff, BO1m). Above that it is the hairline band
                  at the top of the list. */}
              <View style={[
                styles.groupBar,
                openKey === `bulk:${g.key}` && { zIndex: 60 },
                !wide && tickedHere.length ? styles.trayDocked : null,
              ]}>
                {subsHere.length ? (
                  <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
                    <Choice label={`All · ${g.types.length}`} on={!only} onPress={() => setOnly('')} />
                    {subsHere.map((sc) => <Choice key={sc.key} label={`${sc.label} · ${sc.n}`} on={only === sc.key} onPress={() => setOnly(only === sc.key ? '' : sc.key)} />)}
                  </View>
                ) : <View style={{ flex: 1 }} />}
                {/* Ticked rows get one answer between them, from the same control
                    the single rows use. */}
                {canManage && tickable.length ? (
                  <TextAction label={!wide && tickedHere.length ? String(tickedHere.length) : allTicked ? 'Untick all' : `Tick all ${tickable.length}`}
                              onPress={() => setTicked((prev) => { const n = new Set(prev); for (const r of tickable) { if (allTicked) n.delete(r.key); else n.add(r.key); } return n; })} />
                ) : null}
                {canManage && tickedHere.length ? (
                  <>
                    <TextAction label="Clear" onPress={() => setTicked(new Set())} />
                    <DrillDropdown
                      label={busyKey === '*' ? 'Saving…' : `Apply to ${tickedHere.length} ticked`} value="choose one" align="right" width={300} set
                      extra={[
                        { key: '=', label: 'Keep as a secondary label \u2014 it describes the place, it does not say what it is', on: false },
                        { key: '-', label: 'Excluded from Epic', on: false },
                        { key: '>', label: 'Travel \u2014 getting there, parking', on: false },
                        { key: '~', label: 'Useful nearby \u2014 a loo, a visitor centre', on: false },
                      ]}
                      groups={tax.categories.filter((c) => c.active).map((c) => ({
                        key: c.key, label: c.label,
                        items: c.subcategories.filter((sc) => sc.active).map((sc) => ({ key: sc.key, label: sc.label, on: false })),
                      }))}
                      onPick={(k) => void applyMany(tickedHere, k === '-' ? { aside: true } : k === '>' ? { travel: true } : k === '~' ? { nearby: true } : k === '=' ? { generic: true } : { subcategory: k })}
                      onOpenChange={(o) => setOpenKey(o ? `bulk:${g.key}` : null)}
                      nudge={10}
                    />
                  </>
                ) : null}
                {/* An outline that fills when you reach for it. Twenty solid lime
                    buttons read as a band across the page; twenty outlines read
                    as a quiet right-hand column (the handoff, BO1a). */}
                {canManage && (tickedWithSuggestion.length || (!tickedHere.length && suggestible)) ? (
                  <Press effect="none" onPress={() => void approveAll(tickedHere.length ? tickedWithSuggestion : g.types)} disabled={busyKey != null} accessibilityRole="button"
                         style={({ hovered }: any) => [styles.approve, hovered && styles.approveOn, busyKey != null && { opacity: 0.5 }]}>
                    {({ hovered }: any) => (
                      <>
                        <Icon name="check" size={13} color={hovered ? colors.selectedFg : colors.accent} strokeWidth={2.6} />
                        <Text style={[type.small, { fontWeight: '700', color: hovered ? colors.selectedFg : colors.accent }]}>
                          {busyKey === '*' ? 'Approving…' : tickedWithSuggestion.length ? `Approve ${tickedWithSuggestion.length} suggested` : `Approve all ${suggestible} suggestions`}
                        </Text>
                      </>
                    )}
                  </Press>
                ) : null}
              </View>
              {/* The columns this view actually has — which are not the group
                  table's. He asked for the duplicated header to go (13 Sep 2026:
                  "it looks really weird to duplicate the header") and these are
                  not it: Word, Places and the answer, held in place so a list of
                  166 food words still says what its columns are 900px down
                  (owner, 14 Sep 2026: "the column header should be sticky so
                  that when I scroll, I can still see the stuff at the top"). */}
              <View style={[styles.tRow, styles.tHeadSoft, { paddingVertical: 6 }]}>
                <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.colHead} numberOfLines={1}>Word</Text></View>
                {wide ? <View style={{ width: COL }} /> : null}
                {wide ? <View style={[styles.tCell, { width: COL }]}><Text style={[styles.colHead, { textAlign: 'center' }]}>Places</Text></View> : null}
                {canManage ? (
                  <View style={{ width: wide ? COL * 2 + LAST : undefined, alignItems: 'flex-end' }}>
                    <Text style={styles.colHead} numberOfLines={1}>What it means, and what else it says</Text>
                  </View>
                ) : null}
              </View>
              </View>
              {/* No second header. It repeated the one above it word for word,
                  and the indent and the lime bar already say whose subcategories
                  these are (owner, 13 Sep 2026: "it looks really weird to
                  duplicate the header… I'm wondering whether we just show it
                  indented, and that's enough"). Tick-all moved up into the bar. */}
              {shown.length === 0 ? <Text style={[type.small, styles.emptyRow]}>Nothing here.</Text> : null}
              {shown.map((r) => {
                const st = standing(r);
                const sug = r.suggestion ?? null;
                const sugText = sug?.generic ? 'a secondary label' : sug?.aside ? 'excluded from Epic' : sug?.travel ? 'travel' : sug?.nearby ? 'useful nearby' : sug?.subcategory ? `${catLabel(tax.subcategories.find((s) => s.key === sug.subcategory)?.category_key)} · ${subLabel(sug.subcategory)}${sug.cuisine ? ` · ${sug.cuisine}` : ''}` : null;
                // What the control says: where it is, or where it could go, or that nobody knows.
                // The kicker names the kind of answer, the line beneath is the
                // answer itself, so a word's state reads without a single chip
                // (the handoff, BO1c).
                const ctlLabel = st === 'aside' ? 'Excluded'
                  : st === 'generic' ? 'Secondary label'
                    : st === 'travel' ? 'Travel'
                      : st === 'nearby' ? 'Useful nearby'
                        : st === 'mapped' ? 'Mapped to'
                          : sugText ? 'Suggested' : 'Nothing said yet';
                const ctlValue = busyKey === r.key ? 'Saving…'
                  : st === 'aside' ? 'from Epic'
                    : st === 'generic' ? 'it describes, it does not name'
                    : st === 'travel' ? 'getting there, parking'
                    : st === 'nearby' ? 'a loo, a visitor centre'
                    : st === 'mapped' ? `${catLabel(r.landing.category)} · ${subLabel(r.landing.subcategory)}`
                      : sugText ?? (st === 'category' ? `${catLabel(r.landing.category)} · choose one` : 'choose one');
                return (
                  <View key={r.key} style={openKey === r.key ? { zIndex: 40 } : undefined}>
                  <View style={[styles.wordRow, !wide && { flexDirection: 'column', alignItems: 'stretch', gap: 4 }, st === 'aside' && { opacity: 0.55 }]}>
                    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, wide ? { flex: 1, minWidth: 0 } : null]}>
                    {canManage ? (
                      <Press effect="none" onPress={() => tick(r.key, !ticked.has(r.key))}
                             accessibilityRole="checkbox" accessibilityState={{ checked: ticked.has(r.key) }} accessibilityLabel={`Tick ${r.label ?? r.key}`} style={styles.tickCell}>
                        <View style={[styles.tick, ticked.has(r.key) && styles.tickOn]}>{ticked.has(r.key) ? <Icon name="check" size={13} color={colors.selectedFg} strokeWidth={3.2} /> : null}</View>
                      </Press>
                    ) : null}
                    <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                      <Text style={type.small}><Text style={{ fontWeight: '600' }}>{r.label ?? r.key}</Text> <Text style={{ color: colors.inkMuted }}>{r.key}</Text></Text>
                      {/* A reason only where it says something: the cuisine kept, or the
                          Google category that makes it not a day out. */}
                      {(() => {
                        const bits = [
                          !wide ? `${count(r.seen_count)} ${r.seen_count === 1 ? 'place' : 'places'}` : null,
                          !decided(r) && sug && !/^the obvious/.test(sug.why) ? sug.why : null,
                          st === 'mapped' && r.landing.how === 'taught' ? (r.landing.via?.by === 'Epic' ? 'mapped by Epic' : 'mapped by you') : st === 'mapped' ? 'mapped by the code' : null,
                        ].filter(Boolean);
                        return (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
                            {bits.length ? <Text style={type.tiny} numberOfLines={1}>{bits.join(' · ')}</Text> : null}
                            {/* One live Google search, on a press — and the endpoint
                                asks for manage_library, so a read-only admin is not
                                offered a button that can only 403 (Codex, 13 Sep 2026). */}
                            {canManage ? <TextAction label={egKey === r.key ? 'Hide examples' : 'Examples · one search, it costs'} onPress={() => { setEg(egKey === r.key ? '' : r.key); setWith(''); }} /> : null}
                          </View>
                        );
                      })()}
                      {/* What else the word says. The owner, 14 Sep 2026: "I see a
                          fine dining restaurant, but no label for fine dining. It's
                          just mapped to food and drinks, restaurants." Where it
                          sends a place is one answer; this is the other, and the
                          two never compete — italian_restaurant still lands in
                          Restaurants and also says Italian. */}
                      {canManage ? (
                        <Carries r={r} secondary={secondary} onChanged={onChanged} />
                      ) : (r.carries ?? []).length ? (
                        <Text style={[type.tiny, { color: colors.accent }]} numberOfLines={1}>
                          Also says {(r.carries ?? []).map((c) => `${c.label} · ${said(c.value)}`).join(' · ')}
                        </Text>
                      ) : null}
                    </View>
                    </View>
                    {wide ? <View style={{ width: COL }} /> : null}
                    {wide ? (
                      <View style={[styles.tCell, { width: COL }]}>
                        <Text style={[type.small, { textAlign: 'center', fontVariant: ['tabular-nums'], color: r.seen_count ? colors.ink : colors.inkMuted }]}>{count(r.seen_count)}</Text>
                      </View>
                    ) : null}
                    {canManage ? (
                      <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', flexShrink: 1, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '100%', alignSelf: wide ? 'center' : 'flex-end', width: wide ? COL * 2 + LAST : undefined }}>
                        <DrillDropdown
                          label={ctlLabel} value={ctlValue} stacked set={!decided(r) && Boolean(sugText)} align="right" width={300}
                          extra={[
                            { key: '=', label: 'Keep as a secondary label \u2014 it describes the place, it does not say what it is', on: st === 'generic' },
                            { key: '-', label: 'Excluded from Epic', on: st === 'aside' },
                            { key: '>', label: 'Travel — getting there, parking', on: st === 'travel' },
                            { key: '~', label: 'Useful nearby — a loo, a visitor centre', on: st === 'nearby' },
                          ]}
                          groups={tax.categories.filter((c) => c.active).map((c) => ({
                            key: c.key, label: c.label,
                            items: c.subcategories.filter((sc) => sc.active).map((sc) => ({ key: sc.key, label: sc.label, on: st === 'mapped' && r.landing.subcategory === sc.key })),
                          }))}
                          onPick={(k) => void decide(r, k === '-' ? { aside: true } : k === '>' ? { travel: true } : k === '~' ? { nearby: true } : k === '=' ? { generic: true } : { subcategory: k })}
                          onOpenChange={(o) => setOpenKey(o ? r.key : null)}
                          adopt={{
                            label: `Adopt Google's “${r.label ?? r.key}” as a new subcategory`,
                            onPick: (cat) => void adoptWord(r, cat),
                          }}
                          startIn={st === 'mapped' || st === 'category' ? r.landing.category ?? null : sug?.subcategory ? tax.subcategories.find((x) => x.key === sug.subcategory)?.category_key ?? null : null}
                        />
                        {/* "Approve is an outline that fills on hover — lime label
                            on a 1.5px lime underline, going to solid lime
                            ink-on-lime. Twenty of them read as a quiet right-hand
                            column; twenty solid lime buttons do not." It was a
                            plain ink word (the audit, 15 Sep 2026). */}
                        {!decided(r) && sug ? (
                          <Press effect="none" onPress={() => void decide(r, sug, `Approved: ${sug.why}.`)}
                                 disabled={busyKey != null} accessibilityRole="button"
                                 style={({ hovered }: any) => [styles.approve, hovered && styles.approveOn, busyKey != null && { opacity: 0.5 }]}>
                            {({ hovered }: any) => (
                              <Text style={[type.small, { fontWeight: '700', color: hovered ? colors.selectedFg : colors.accent }]}>Approve</Text>
                            )}
                          </Press>
                        ) : null}
                      </View>
                    ) : (
                      <View style={{ width: wide ? COL * 2 + LAST : undefined, maxWidth: '100%', alignSelf: wide ? 'center' : 'flex-end' }}>
                        <Text style={[type.small, { fontWeight: '600', textAlign: 'right' }]} numberOfLines={2}>{ctlValue}</Text>
                      </View>
                    )}
                  </View>
                  {/* Real places carrying this word, so it can be looked at
                      rather than guessed at (owner, 13 Sep 2026). */}
                  {egKey === r.key ? (
                    <ExamplesPanel eg={eg} egBusy={egBusy} canManage={canManage} word={r} catLabel={catLabel} subLabel={subLabel} tax={tax} onChanged={onChanged} onRefetch={() => void loadEg(r.key)} />
                  ) : null}
                  {/* What a generic word actually catches: the source's own
                      specific words seen on the same places, each mappable
                      from here (owner, 13 Sep 2026). */}
                  {st === 'generic' ? (
                    <View style={{ paddingLeft: canManage ? 34 : 6, paddingBottom: withKey === r.key ? spacing.sm : 6 }}>
                      <TextAction label={withKey === r.key ? 'Hide the words it catches' : 'The words it catches'}
                                  onPress={() => { setWith(withKey === r.key ? '' : r.key); setOnly(''); }} />
                      {withKey === r.key ? (
                        withWords == null ? <Text style={type.tiny}>Looking…</Text>
                          : withWords.length === 0
                            ? <Text style={type.tiny}>Nothing counted yet. Nothing about a place is stored, so the words seen beside this one are counted as searches run.</Text>
                            : withWords.map((w) => {
                              const wst = standing(w);
                              return (
                                <View key={w.key} style={[styles.pairRow, openKey === w.key ? { zIndex: 40 } : undefined, !wide && { flexDirection: 'column', alignItems: 'stretch', gap: 4 }]}>
                                  <View style={[{ flex: 1, minWidth: 0 }, !wide && { width: '100%' }]}>
                                    <Text style={type.small} numberOfLines={1}>
                                      <Text style={{ fontWeight: '600' }}>{w.label ?? w.key}</Text> <Text style={{ color: colors.inkMuted }}>{w.key}</Text>
                                    </Text>
                                    {!wide ? <Text style={type.tiny}>{count(w.seen_count)} {w.seen_count === 1 ? 'place' : 'places'}</Text> : null}
                                  </View>
                                  {/* The same three slots as the row above, so Places stays
                                      in the Places column (owner, 13 Sep 2026). */}
                                  {wide ? <View style={{ width: COL }} /> : null}
                                  {wide ? (
                                    <View style={[styles.tCell, { width: COL }]}>
                                      <Text style={[type.small, { textAlign: 'center', fontVariant: ['tabular-nums'] }]}>{count(w.seen_count)}</Text>
                                    </View>
                                  ) : null}
                                  {canManage ? (
                                    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', width: wide ? COL * 2 + LAST : undefined, maxWidth: '100%', alignSelf: wide ? 'center' : 'flex-end' }}>
                                    <DrillDropdown
                                      label={wst === 'mapped' ? 'Mapped' : wst === 'aside' ? 'Excluded' : wst === 'generic' ? 'Kept as' : wst === 'travel' || wst === 'nearby' ? 'Mapped' : 'Choose a subcategory'}
                                      value={busyKey === w.key ? 'Saving…'
                                        : wst === 'mapped' ? `${catLabel(w.landing.category)} · ${subLabel(w.landing.subcategory)}`
                                          : wst === 'aside' ? 'from Epic' : wst === 'generic' ? 'a secondary label'
                                            : wst === 'travel' ? 'travel' : wst === 'nearby' ? 'useful nearby' : '…'}
                                      align="right" width={300}
                                      extra={[
                                        { key: '=', label: 'Keep as a secondary label \u2014 it describes the place, it does not say what it is', on: wst === 'generic' },
                                        { key: '-', label: 'Excluded from Epic', on: wst === 'aside' },
                                        { key: '>', label: 'Travel — getting there, parking', on: wst === 'travel' },
                                        { key: '~', label: 'Useful nearby — a loo, a visitor centre', on: wst === 'nearby' },
                                      ]}
                                      groups={tax.categories.filter((c) => c.active).map((c) => ({
                                        key: c.key, label: c.label,
                                        items: c.subcategories.filter((sc) => sc.active).map((sc) => ({ key: sc.key, label: sc.label, on: wst === 'mapped' && w.landing.subcategory === sc.key })),
                                      }))}
                                      onPick={(k) => void decide(w, k === '-' ? { aside: true } : k === '>' ? { travel: true } : k === '~' ? { nearby: true } : k === '=' ? { generic: true } : { subcategory: k })}
                                      onOpenChange={(o) => setOpenKey(o ? w.key : null)}
                                      adopt={{ label: `Adopt Google\u2019s \u201C${w.label ?? w.key}\u201D as a new subcategory`, onPick: (cat) => void adoptWord(w, cat) }}
                                      startIn={wst === 'mapped' ? w.landing.category ?? null : null}
                                    />
                                    </View>
                                  ) : null}
                                </View>
                              );
                            })
                      ) : null}
                    </View>
                  ) : null}
                  </View>
                );
              })}
            </View>
          ) : null}
          </View>
        );
      })}
      {/* The total, at the bottom of the list, over one ink rule. */}
      {chosen ? null : (
        <View style={[styles.tRow, styles.tTotal, styles.gRow]}>
          <View style={[styles.tFirst, { flex: 1, width: undefined }]}><Text style={[type.small, { fontWeight: '700' }]}>Total</Text></View>
          {cellsTotal.map((n, i) => (
            <View key={i} style={[styles.tCell, { width: COL }]}><Text style={[type.small, { textAlign: 'center', fontWeight: '700', fontVariant: ['tabular-nums'], color: i === placesAt ? colors.inkMuted : colors.ink }]}>{i === placesAt ? '—' : count(n)}</Text></View>
          ))}
          {wide ? <View style={[styles.tCell, styles.gLast, { width: LAST }]} /> : null}
        </View>
      )}

      {/* Move on without going back: the other categories and how far each is,
          so finishing one does not mean a trip back to the list (BO1a). */}
      {chosen ? (
        <View style={{ gap: 6, paddingTop: spacing.lg }}>
          <Text style={styles.bandKicker}>Move on without going back</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
            {groups.filter((g) => g.key !== chosen.key).map((g) => (
              <Press key={g.key} effect="none" onPress={() => { setGroup(g.key); setOnly(''); setTicked(new Set()); setEg(''); }}
                     accessibilityRole="button" style={styles.moveOn}>
                <Text style={type.small} numberOfLines={1}>{g.name}</Text>
                <Text style={[type.tiny, g.unmapped ? { color: colors.ink, fontWeight: '700' } : null]}>{g.mapped}/{g.types.length}</Text>
              </Press>
            ))}
          </View>
        </View>
      ) : null}
      </>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// find a word from any source
// ---------------------------------------------------------------------------

function FindWord({ tax, catLabel, subLabel, canManage, onPick }: {
  tax: Taxonomy; catLabel: (k: string | null | undefined) => string; subLabel: (k: string | null | undefined) => string | null;
  canManage: boolean; onPick: (label: string, subcategory: string | null) => void;
}) {
  const [ns, setNs] = useQueryState<string>('ns', '', asText);
  const [q, setQ] = useQueryState<string>('q', '', asText);
  const [typed, setTyped] = useState(q);
  const [rows, setRows] = useState<TaxonomyLabel[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const generation = React.useRef(0);
  const PAGE = 50;
  const source = tax.namespaces.find((n) => n.key === ns) ?? null;

  useEffect(() => { setTyped(q); }, [q]);
  useEffect(() => { const t = setTimeout(() => { if (typed !== q) setQ(typed); }, 300); return () => clearTimeout(t); }, [typed, q, setQ]);

  // Nothing is listed until there is a word or a source to list: never a huge scroll.
  useEffect(() => {
    generation.current += 1;
    // The old list goes at once, so its "next page" cannot be asked for with the
    // new filters, and a page still on its way for the old ones cannot hold the
    // new list's next page (Codex, 12 Sep 2026).
    setRows(null); setMore(false); setLoadingMore(false);
    if (!q.trim() && !ns) return;
    let live = true;
    void api.taxonomyLabels({ namespace: ns || undefined, q: q.trim() || undefined, all: Boolean(q.trim()) || (ns !== 'wikidata' && ns !== ''), limit: PAGE })
      .then((d) => { if (live) { setRows(d.labels); setMore(d.more); } })
      .catch(() => { if (live) { setRows([]); setMore(false); } });
    return () => { live = false; };
  }, [ns, q, tax]);

  const showMore = async () => {
    if (loadingMore) return;
    const asked = generation.current;
    setLoadingMore(true);
    try {
      const d = await api.taxonomyLabels({ namespace: ns || undefined, q: q.trim() || undefined, all: Boolean(q.trim()) || (ns !== 'wikidata' && ns !== ''), limit: PAGE, offset: rows?.length ?? 0 });
      if (asked !== generation.current) return;
      setRows((prev) => [...(prev ?? []), ...d.labels]);
      setMore(d.more);
    } catch { /* the list stands */ }
    finally { if (asked === generation.current) setLoadingMore(false); }
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={[styles.line, { flexWrap: 'wrap', zIndex: 15 }]}>
        <Dropdown label="Source" value={source ? source.label : 'Any'} width={260}
                  options={[{ key: '', label: 'Any source', on: !ns }, ...tax.namespaces.map((n) => ({ key: n.key, label: n.label, count: `${count(n.seen)} / ${count(n.total)}`, on: n.key === ns }))]}
                  onPick={(k) => setNs(k)} />
        <Field icon="search" value={typed} onChangeText={setTyped} placeholder="A word: stadium, ice_rink, castle, Q23413" style={{ flex: 1, minWidth: 220 }} />
      </View>
      {source ? <Text style={type.tiny}>{source.what}. {count(source.total)} known, {count(source.seen)} seen on a real place, {count(source.taught)} in a rule.</Text> : null}

      {rows === null ? (
        <Text style={[type.small, { color: colors.inkMuted }]}>Type a word, or pick a source, and the words that match are listed with where each one lands today.</Text>
      ) : rows.length === 0 ? (
        <Text style={[type.small, { color: colors.inkMuted }]}>No word like that.</Text>
      ) : (
        <Section title={`${rows.length}${more ? '+' : ''} words`}>
          {rows.map((r) => {
            const label = `${r.namespace}:${r.key}`;
            const lands = r.landing.how === 'none' ? (r.namespace === 'wikidata' && r.active === false ? 'excluded from the atlas' : 'not a place on its own')
              : `${catLabel(r.landing.category)}${subLabel(r.landing.subcategory) ? ` · ${subLabel(r.landing.subcategory)}` : ' · no subcategory'}`;
            return (
              <Press key={label} disabled={!canManage} onPress={() => onPick(label, r.landing.subcategory)} accessibilityRole="button" style={styles.wordRow}>
                <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                  <Word label={label} name={r.label} />
                  <Text style={type.tiny} numberOfLines={1}>
                    {[r.note, r.seen_count ? `seen ${count(r.seen_count)}` : null, r.landing.derived.length ? `read as ${r.landing.derived.map(keyOf).join(', ')}` : null].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 1, maxWidth: '45%' }}>
                  <Text style={[type.small, { fontWeight: '600', textAlign: 'right' }]} numberOfLines={2}>{lands}</Text>
                  <Text style={[type.tiny, { textAlign: 'right' }]} numberOfLines={1}>
                    {HOW_WORD[r.landing.how]}{r.landing.via && r.landing.via.scope !== 'default' ? ` · ${r.landing.via.subject_label ?? r.landing.via.subject ?? ''}` : ''}
                  </Text>
                </View>
                {canManage ? <Icon name="more" size={14} color={colors.inkMuted} /> : null}
              </Press>
            );
          })}
          {more ? <View style={{ paddingVertical: spacing.sm }}><TextAction label={loadingMore ? 'Loading…' : `Show the next ${PAGE}`} disabled={loadingMore} onPress={() => void showMore()} /></View> : null}
        </Section>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  kicker: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '700', color: colors.inkMuted },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: 6, borderBottomWidth: BORDER, borderBottomColor: colors.line, minHeight: 32 },
  action: { ...type.small, fontWeight: '600', color: colors.ink, textDecorationLine: 'underline' },
  choice: { paddingHorizontal: 8, paddingVertical: 3 },
  choiceOn: { backgroundColor: colors.selected },
  catLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap', paddingVertical: 2 },
  note: { color: colors.accent, fontWeight: '600' },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },

  split: { gap: spacing.lg },
  splitWide: { flexDirection: 'row', alignItems: 'flex-start' },
  detail: { width: '100%' },
  detailWide: { width: 420, flexGrow: 0, flexShrink: 0 },

  subRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 9, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: colors.lineSoft, borderLeftWidth: 4, borderLeftColor: 'transparent' },
  subRowNarrow: { flexWrap: 'wrap', rowGap: 4 },
  subRowOn: { backgroundColor: colors.well, borderLeftColor: colors.selected },
  subName: { flexGrow: 1, flexBasis: 140, minWidth: 0, gap: 1 },
  subCount: { width: 24, textAlign: 'right', fontVariant: ['tabular-nums'] },
  attrs: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' },
  emptyRow: { color: colors.inkMuted, paddingVertical: spacing.sm },

  ruleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  foundRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 7, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  // 13px, from the handoff's geometry table (the audit found 8).
  wordRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  /** BO8's own furniture: the way back, the rule lines, and the one lime action. */
  backLine: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, alignSelf: 'flex-start' },
  backText: { ...type.small, fontWeight: '700', color: colors.accent },
  ruleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6, flexWrap: 'wrap' },
  // 34x19 with a 12px block, from the handoff's geometry table. There was no
  // toggle in the admin at all; on and off were two words (the audit).
  toggle: { width: 34, height: 19, borderWidth: 1, borderColor: colors.line, justifyContent: 'center', paddingHorizontal: 2 },
  toggleOn: { backgroundColor: colors.selected, borderColor: colors.selected },
  toggleBlock: { width: 12, height: 12, backgroundColor: colors.inkMuted, alignSelf: 'flex-start' },
  toggleBlockOn: { backgroundColor: colors.selectedFg, alignSelf: 'flex-end' },
  placeLabels: { gap: 2, paddingLeft: spacing.md, paddingVertical: 6, borderLeftWidth: 2, borderLeftColor: colors.lime, marginLeft: spacing.md },
  shapeBand: { flexDirection: 'row', gap: 34, paddingTop: 8, paddingBottom: 4, flexWrap: 'wrap' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  toast: {
    position: 'fixed' as any, left: '50%', bottom: 28, transform: [{ translateX: '-50%' as any }],
    flexDirection: 'row', alignItems: 'center', gap: 10, zIndex: 200,
    backgroundColor: colors.selected, paddingVertical: 12, paddingHorizontal: 18, maxWidth: 560,
  },
  toastText: { ...type.small, fontWeight: '700', color: colors.selectedFg, flexShrink: 1, minWidth: 0 },
  toastUndo: { ...type.small, fontWeight: '700', color: colors.selectedFg, textDecorationLine: 'underline' },
  /** A consequence, not a fact: a lime left rule and no fill (the handoff's colour roles). */
  theTest: { borderLeftWidth: 2, borderLeftColor: colors.lime, paddingLeft: spacing.md, paddingVertical: 8, marginTop: spacing.sm },
  gets: { ...type.small, fontWeight: '700', color: colors.ink, borderBottomWidth: 2, borderBottomColor: colors.lime, paddingBottom: 3, paddingRight: 40 },
  save: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 36, paddingHorizontal: 14, backgroundColor: colors.selected },
  // A word a generic one was seen with: inside the row above it, so it reads as
  // "what this catches" rather than as another subcategory of Google's.
  pairRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6, paddingLeft: spacing.md, borderLeftWidth: 2, borderLeftColor: colors.lineSoft },
  egRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 5, paddingLeft: spacing.md, borderLeftWidth: 2, borderLeftColor: colors.lineSoft },

  // A 2px ink left rule, not a filled panel: "No tiles, panels, outlined chips
  // or boxes of any kind. Hairlines." (the audit, 15 Sep 2026).
  editor: { paddingVertical: spacing.sm, paddingLeft: spacing.md, borderLeftWidth: 2, borderLeftColor: colors.line, marginVertical: spacing.sm, gap: 4 },
  tokens: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 6 },
  token: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3, borderBottomWidth: 1.5, borderBottomColor: colors.lime },
  field: { flexDirection: 'row', alignItems: 'center', gap: 6, borderBottomWidth: BORDER, borderBottomColor: colors.line, paddingVertical: 2 },
  fieldInput: { flex: 1, paddingVertical: 6, color: colors.ink, fontSize: 14, outlineStyle: 'none' as never, backgroundColor: 'transparent' },
  landing: { paddingVertical: spacing.sm },

  tableWrap: { width: '100%' },
  tRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  tHead: { borderBottomWidth: BORDER, borderBottomColor: colors.line },
  /** The Google table's header rule: soft, not ink (owner, 13 Sep 2026: "very bright white"). */
  // A header's rule and the tab frame sit between the ink rule and the hairline:
  // the owner found the ink one too bright and the hairline invisible (13 Sep 2026).
  tHeadSoft: { borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted },
  /**
   * The column header stays put while the list scrolls under it (owner, 14 Sep
   * 2026: "the column header should be sticky so that when I scroll, I can
   * still see the stuff at the top"). A list of 166 food words is a long way
   * from its headings otherwise. Web only — there is no sticky on native, and
   * `position` is typed loosely enough in React Native Web to say so here.
   */
  /** The bar and the column heads together, so both stay put while the list runs under them. */
  trayDocked: Platform.OS === 'web'
    ? ({
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 120,
      backgroundColor: colors.bg, borderTopWidth: 2, borderTopColor: colors.line,
      paddingHorizontal: spacing.md, paddingVertical: 10,
    } as any)
    : {},
  stickGroup: Platform.OS === 'web'
    ? ({ position: 'sticky', top: 0, zIndex: 4, backgroundColor: colors.bg } as any)
    : {},
  stick: Platform.OS === 'web'
    ? ({ position: 'sticky', top: 0, zIndex: 3, backgroundColor: colors.bg } as any)
    : {},
  headCell: { paddingTop: 10, paddingBottom: 2 },
  colHead: { ...type.small, fontWeight: '500', color: colors.inkMuted },
  // The three doors: 30px apart, a 2px rule under the lot, a lime one under the
  // door you are in. Measurements from the handoff.
  doors: { flexDirection: 'row', gap: 30, borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted, flexWrap: 'wrap' },
  door: { gap: 3, paddingBottom: 11, marginBottom: -BORDER, borderBottomWidth: BORDER, borderBottomColor: 'transparent' },
  doorOn: { borderBottomColor: colors.lime },
  doorLabel: { ...type.title, fontSize: 17, fontWeight: '800', letterSpacing: -0.34, lineHeight: 20 },
  doorSub: { ...type.tiny, color: colors.inkMuted },
  band: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.xl,
    borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted, paddingBottom: 18, flexWrap: 'wrap' },
  bandTitle: { ...type.title, fontSize: 31, letterSpacing: -1.08, lineHeight: 33 },
  // Shrinkable, or a long value — "Food & drink · Restaurants" — pushes the last
  // stat off the right edge at 390 instead of wrapping (15 Sep 2026, on the
  // deployed site at 390, which the handoff says is reviewed like the wide one).
  bandStats: { flexDirection: 'row', alignItems: 'flex-end', gap: 34, flexWrap: 'wrap', flexShrink: 1, minWidth: 0 },
  bandStat: { gap: 2, flexShrink: 1, minWidth: 0 },
  /** 31px is the wide title; the handoff draws 390 as its own artboard at 24 (BO1m). */
  bandTitlePhone: { fontSize: 24, letterSpacing: -0.8, lineHeight: 27 },
  bandValue: { ...type.small, fontSize: 15, fontWeight: '600' },
  said: { borderLeftWidth: BORDER, borderLeftColor: colors.ruleMuted, paddingLeft: 13, paddingVertical: 2 },
  bandKicker: { ...type.tiny, fontSize: 10, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase', color: colors.inkMuted },
  halves: { flexDirection: 'row', borderWidth: 1, borderColor: colors.ruleMuted, overflow: 'hidden' },
  halfItem: { minHeight: 34, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  halfDivider: { borderLeftWidth: 1, borderLeftColor: colors.ruleMuted },
  halfOn: { backgroundColor: colors.selected },
  refusal: { borderLeftWidth: 1, borderLeftColor: colors.overrun, paddingLeft: 13, paddingVertical: 4, gap: 4, marginTop: spacing.sm },
  asking: { borderLeftWidth: BORDER, borderLeftColor: colors.lime, paddingLeft: 13, paddingVertical: 6, gap: 6 },
  // Open, a category is marked by a lime rule beside it, never a lime band
  // across it (owner, 14 Sep 2026: "there's not supposed to be any green bar at
  // the top or in the middle").
  gRowOpen: { borderLeftWidth: 3, borderLeftColor: colors.lime, marginLeft: -3 },
  // Inside a category there is nothing to indent away from: it is the page.
  opened: { paddingBottom: spacing.sm },
  moveOn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  // The shape, drawn as a proportion rather than a list: what the count says
  // matters more than which words are in it (the handoff, BO9).
  barTrack: { height: 4, backgroundColor: colors.lineSoft, maxWidth: 420 },
  barFill: { height: 4, backgroundColor: colors.lime },
  approve: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderBottomWidth: 2, borderBottomColor: colors.lime },
  approveOn: { backgroundColor: colors.lime },
  tabs: { flexDirection: 'row', borderWidth: 1, borderColor: colors.decor, overflow: 'hidden', backgroundColor: colors.panelWarm },
  tabItem: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  tabDivider: { borderLeftWidth: 1, borderLeftColor: colors.decor },
  tabOn: { backgroundColor: colors.selected },
  tWork: { backgroundColor: colors.surfaceMuted },
  tFirst: { width: 150, paddingVertical: 8, paddingRight: spacing.sm, justifyContent: 'center' },
  tCell: { paddingVertical: 8, paddingHorizontal: 6, gap: 1, justifyContent: 'center' },
  tCellOn: { backgroundColor: colors.selected },
  tTotal: { borderTopWidth: BORDER, borderTopColor: colors.line, borderBottomWidth: 0 },
  inset: { borderLeftWidth: 4, borderLeftColor: colors.selected, paddingLeft: spacing.sm - 4, paddingRight: spacing.sm, paddingBottom: spacing.sm, marginBottom: spacing.xs },
  /** The Google table's rows: padded from the edge, a little taller. */
  gRow: { paddingHorizontal: spacing.sm, minHeight: 44 },
  gLast: { paddingLeft: spacing.md },
  /** The opened group's controls: one height, room above and below. */
  groupBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm, flexWrap: 'wrap', paddingVertical: spacing.md },
  // A hairline, not a filled block — BO1g rejects the block by name.
  barControl: { height: 36, paddingHorizontal: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  barControlOn: { borderBottomWidth: 1.5, borderBottomColor: colors.lime },
  barButton: { backgroundColor: colors.primary },
  tickCell: { width: 24, alignItems: 'center', justifyContent: 'center' },
  // Lime fill, ink tick, 20px (the handoff's geometry and BO1g; the audit found
  // ink fill and a cream tick at 16, which is the one thing lime is *for* —
  // "the moment something is selected").
  tick: { width: 20, height: 20, borderWidth: 1, borderColor: colors.line, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  tickOn: { backgroundColor: colors.selected, borderColor: colors.selected },
});
