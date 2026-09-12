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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import {
  api, MoodKey, ShelfSubcategory, Taxonomy, TaxonomyLabel, TaxonomyLanding, TaxonomyMatrix, TaxonomyMatrixEntry,
  TaxonomyRule, TaxonomyTry,
} from '../../api';
import { colors, spacing, type, BORDER } from '../../theme';
import { Icon } from '../../components/Icon';
import { Button, FoldLine } from '../../components/ui';
import { ControlButton, ControlRow, Popover, PopoverList } from '../../components/ControlRow';
import { useViewport } from '../../hooks/useViewport';
import { AdminPage, PageHead, ago, count } from '../kit';
import { asOneOf, asText, useQueryState } from '../../router';

const WIDE = 900;

type View_ = 'subcategories' | 'providers' | 'google' | 'words';
const VIEWS: { key: View_; label: string; short: string }[] = [
  { key: 'subcategories', label: 'Subcategories & attributes', short: 'Subcategories' },
  { key: 'providers', label: 'Provider words', short: 'Providers' },
  { key: 'google', label: "Google's categories", short: 'Google' },
  { key: 'words', label: 'Find a word', short: 'Find a word' },
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
    <Press onPress={onPress} disabled={!onPress} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.choice, on && styles.choiceOn]}>
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
function Token({ label, name, onRemove }: { label: string; name?: string | null; onRemove?: () => void }) {
  const key = keyOf(label);
  return (
    <View style={styles.token}>
      <Text style={type.small}>
        <Text style={{ color: colors.inkMuted }}>{sourceWord(nsOf(label))} · </Text>
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

export function Categories({ canManage }: { canManage: boolean }) {
  const { width } = useViewport();
  const wide = width >= WIDE;

  const [tax, setTax] = useState<Taxonomy | null>(null);
  // Which category, which view, which subcategory is open — all in the address.
  const [cat, setCat] = useQueryState<string>('cat', '', asText);
  const [view, setView] = useQueryState<View_>('view', 'subcategories', asOneOf(['subcategories', 'providers', 'google', 'words'] as const, 'subcategories'));
  const [sub, setSub] = useQueryState<string>('sub', '', asText);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Which control's panel is open, and where the panels hang from. */
  const [open, setOpen] = useState<'category' | 'view' | 'sub' | null>(null);
  const [foot, setFoot] = useState(40);
  /** A rule being written from a word, outside the subcategory column. */
  const [editing, setEditing] = useState<{ labels: string[]; subcategory: string | null } | null>(null);

  const load = useCallback(async () => {
    try { setTax(await api.taxonomy()); }
    catch (err) { setNote(String((err as Error).message)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const categories = tax?.categories ?? [];
  const category = categories.find((c) => c.key === cat) ?? categories[0] ?? null;
  const subs = category?.subcategories ?? [];
  const chosen = subs.find((s) => s.key === sub) ?? null;
  const rulesOf = (key: string) => (tax?.rules ?? []).filter((r) => r.subcategory === key);

  const changed = async (said: string) => { setNote(said); await load(); };
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
      <PageHead title="Categories" sub="One category at a time: its subcategories, the attributes that put a place in each, and every provider's words against them" />

      {/* The controls: plain words with chevrons, and the panels hang under them. */}
      <View style={{ position: 'relative', zIndex: 20 }}>
        <View onLayout={(e) => setFoot(e.nativeEvent.layout.height)}>
          <ControlRow
            left={<ControlButton label={category ? category.label : 'Category'} icon="filters" open={open === 'category'} onPress={() => setOpen(open === 'category' ? null : 'category')} spoken={`Category: ${category?.label ?? 'none'}`} />}
            centre={<ControlButton label={(wide ? VIEWS.find((v) => v.key === view)?.label : VIEWS.find((v) => v.key === view)?.short) ?? ''} open={open === 'view'} onPress={() => setOpen(open === 'view' ? null : 'view')} spoken="What to show" />}
            right={view === 'subcategories' && !wide && subs.length ? (
              <ControlButton label={chosen?.label ?? 'All subcategories'} set={Boolean(chosen)} open={open === 'sub'} onPress={() => setOpen(open === 'sub' ? null : 'sub')} spoken="Subcategory" />
            ) : null}
          />
        </View>
        <Popover open={open === 'category'} top={foot} onClose={() => setOpen(null)}>
          <PopoverList
            options={categories.map((c) => ({ key: c.key, label: c.label, count: `${c.subcategories.length}`, on: c.key === category?.key }))}
            onPick={(k) => { setCat(k); setSub(''); setEditing(null); setOpen(null); }}
          />
        </Popover>
        <Popover open={open === 'view'} top={foot} align="centre" onClose={() => setOpen(null)}>
          <PopoverList options={VIEWS.map((v) => ({ key: v.key, label: v.label, on: v.key === view }))} onPick={(k) => { setView(k as View_); setEditing(null); setOpen(null); }} />
        </Popover>
        <Popover open={open === 'sub'} top={foot} align="right" onClose={() => setOpen(null)}>
          <PopoverList
            options={[{ key: '', label: 'All subcategories', on: !chosen }, ...subs.map((s) => ({ key: s.key, label: s.label, count: `${s.rules ?? 0}`, on: s.key === chosen?.key }))]}
            onPick={(k) => { setSub(k); setOpen(null); }}
          />
        </Popover>
      </View>

      {category && (view === 'subcategories' || view === 'providers') ? (
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

      {editing && tax ? (
        <RuleEditor key={editing.labels.join('+')} tax={tax} start={editing.labels} startSubcategory={editing.subcategory} fixedSubcategory={null}
                    canManage={canManage} onClose={() => setEditing(null)} onSaved={async (said) => { setEditing(null); await changed(said); }} />
      ) : null}

      {!tax ? <Text style={type.small}>Loading…</Text> : null}

      {tax && category && view === 'subcategories' ? (
        <View style={[styles.split, wide && styles.splitWide]}>
          {/* Every subcategory of this category with its attributes, in one table. */}
          <Section title="Subcategories and their attributes" style={{ flex: 1, minWidth: 0 }}
                   right={canManage ? <AddSubcategory category={category.key as MoodKey} label={category.label} busy={busy} run={run} /> : undefined}>
            {subs.length === 0 ? <Text style={[type.small, styles.emptyRow]}>No subcategories yet.</Text> : null}
            {subs.filter((s) => wide || !chosen || s.key === chosen.key).map((s) => {
              const rules = rulesOf(s.key);
              const words = rules.flatMap((r) => r.scope === 'place' ? [r.subject_label ?? r.subject] : r.labelList.map((l) => l.name ?? keyOf(l.label)));
              const on = chosen?.key === s.key;
              return (
                <Press key={s.id} onPress={() => setSub(on ? '' : s.key)} accessibilityRole="button" accessibilityState={{ selected: on }}
                       style={[styles.subRow, !wide && styles.subRowNarrow, on && styles.subRowOn]}>
                  <View style={[styles.subName, wide && { width: 200, flexGrow: 0 }]}>
                    <Text style={[type.small, { fontWeight: '700' }]}>{s.label}</Text>
                    <Text style={type.tiny}>
                      {[wide ? null : `${rules.length} rule${rules.length === 1 ? '' : 's'}`, s.indoor === true ? 'indoors' : s.indoor === false ? 'outdoors' : null, s.for_kids === true ? 'for kids' : null, !s.active ? 'off' : null].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <View style={[styles.attrs, wide ? { flex: 1, minWidth: 0 } : { width: '100%' }]}>
                    {words.slice(0, wide ? 14 : 8).map((w, i) => <Text key={`${w}-${i}`} style={styles.attr}>{w}</Text>)}
                    {words.length > (wide ? 14 : 8) ? <Text style={[styles.attr, { color: colors.inkMuted }]}>+{words.length - (wide ? 14 : 8)} more</Text> : null}
                    {words.length === 0 ? <Text style={[type.small, { color: colors.inkMuted }]}>No attributes yet — only places moved here by hand.</Text> : null}
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

      {tax && category && view === 'providers' ? (
        <ProviderWords tax={tax} category={category.key} wide={wide} subLabel={subLabel}
                       onPick={(label, subcategory) => setEditing({ labels: [label], subcategory })} />
      ) : null}

      {tax && view === 'google' ? (
        <GoogleView tax={tax} wide={wide} catLabel={catLabel} subLabel={subLabel} canManage={canManage}
                    onPick={(label, subcategory) => setEditing({ labels: [label], subcategory })} onChanged={changed} />
      ) : null}

      {tax && view === 'words' ? (
        <FindWord tax={tax} catLabel={catLabel} subLabel={subLabel} canManage={canManage} foot={foot}
                  onPick={(label, subcategory) => setEditing({ labels: [label], subcategory })} />
      ) : null}

      <View style={{ marginTop: spacing.md }}>
        <FoldLine label="How this works" value="labels, rules, and what wins">
          <View style={{ gap: spacing.xs, paddingVertical: spacing.xs }}>
            <Text style={type.small}>
              A place carries labels: what each source called it, in that source's own words (Google's type, the map's tag, the
              Wikidata type), plus what Epic read those into (an experience, a venue kind). Those are the attributes.
            </Text>
            <Text style={type.small}>
              A rule says: places carrying all of these labels go in this subcategory. Narrowest wins — a rule about one place,
              then a combination of labels, then a Wikidata type, then the atlas word, then the experience. Naming a subcategory
              settles the category, because a subcategory has exactly one parent.
            </Text>
            <Text style={type.small}>
              Rename freely: keys never change. Move a subcategory and every place in it moves. Teach the type, not the place —
              one rule against “castle” answers for every castle. Switch off rather than delete.
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
  onChanged: (said: string) => Promise<void>; onClose: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(sc.label);
  const [moving, setMoving] = useState(false);
  const [adding, setAdding] = useState(false);

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
        <Text style={[type.small, styles.emptyRow]}>Nothing yet. Only places moved here one at a time on the Shelves screen will show under it.</Text>
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
      <Text style={type.tiny}>This will be {level}. One Wikidata type, atlas word or experience is written at that level, as the Shelves screen writes it; a provider's own word, or several labels together, sits above the type rules and below a rule about one place.</Text>

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
 * Every type Google can give a place — Table A, 478 of them in Google's own
 * nineteen groups — and where each lands in Epic's categories today.
 *
 * The owner, 12 Sep 2026: "view the Google categories and see how they map to
 * our categories… we always need to have a mapping between theirs and ours, so
 * it's defined and clear." One group at a time, picked from a control; the
 * table above it says, for every group, how many of its types are mapped, how
 * many are marked as not a day out, and how many nobody has decided about.
 * Those last are the discrepancies.
 */
function GoogleView({ tax, wide, catLabel, subLabel, canManage, onPick, onChanged }: {
  tax: Taxonomy; wide: boolean; catLabel: (k: string | null | undefined) => string; subLabel: (k: string | null | undefined) => string | null;
  canManage: boolean; onPick: (label: string, subcategory: string | null) => void; onChanged: (said: string) => Promise<void>;
}) {
  const [rows, setRows] = useState<TaxonomyLabel[] | null>(null);
  const [group, setGroup] = useQueryState<string>('group', '', asText);
  const [gaps, setGaps] = useQueryState<string>('gaps', '', asText);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api.taxonomyLabels({ namespace: 'google', all: true, limit: 2000 })
      .then((d) => { if (live) setRows(d.labels); })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [tax]);

  /** Where a type stands: mapped to a subcategory, into a category only, set aside, or undecided. */
  const standing = (r: TaxonomyLabel): 'mapped' | 'category' | 'aside' | 'undecided' =>
    r.active === false ? 'aside' : r.landing.subcategory ? 'mapped' : r.landing.how === 'fallback' || !r.landing.category ? 'undecided' : 'category';

  const groups = useMemo(() => {
    const out: { name: string; types: TaxonomyLabel[]; mapped: number; category: number; aside: number; undecided: number; lands: string[] }[] = [];
    for (const r of rows ?? []) {
      const name = r.note && r.note !== 'read by google.js' ? r.note : 'Not in Table A (read by google.js)';
      let g = out.find((x) => x.name === name);
      if (!g) { g = { name, types: [], mapped: 0, category: 0, aside: 0, undecided: 0, lands: [] }; out.push(g); }
      g.types.push(r);
      g[standing(r)] += 1;
      if (r.active !== false && r.landing.category && r.landing.how !== 'fallback' && !g.lands.includes(r.landing.category)) g.lands.push(r.landing.category);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const chosen = group === '-' ? null : groups.find((g) => g.name === group) ?? groups.find((g) => g.name === 'Entertainment and Recreation') ?? null;
  const shown = (chosen?.types ?? []).filter((r) => gaps !== '1' || standing(r) === 'undecided');
  const totals = groups.reduce((t, g) => ({ mapped: t.mapped + g.mapped, category: t.category + g.category, aside: t.aside + g.aside, undecided: t.undecided + g.undecided, all: t.all + g.types.length }), { mapped: 0, category: 0, aside: 0, undecided: 0, all: 0 });

  const setAside = async (r: TaxonomyLabel, aside: boolean) => {
    setBusyKey(r.key);
    try {
      await api.taxonomySaveLabel({ namespace: 'google', key: r.key, active: !aside });
      setRows((prev) => (prev ?? []).map((x) => (x.key === r.key ? { ...x, active: !aside } : x)));
      await onChanged(aside ? `${r.label ?? r.key} is set aside — not a day out.` : `${r.label ?? r.key} is back in the list.`);
    } catch (err) { await onChanged(String((err as Error).message)); }
    finally { setBusyKey(null); }
  };

  if (!rows) return <Text style={type.small}>Reading Google's list…</Text>;

  return (
    <View style={{ gap: spacing.lg }}>
      <Section title={`Google's ${groups.length} groups against our categories — ${count(totals.all)} types`}>
        <Text style={[type.tiny, { paddingVertical: 6 }]}>
          Google's list is Table A of the Places API, read on 12 Sep 2026. A type is <Text style={{ fontWeight: '700' }}>mapped</Text> when a rule or the code's own map puts it in one of our subcategories, <Text style={{ fontWeight: '700' }}>set aside</Text> when somebody has said it is not a day out — a decision recorded here, not a filter: a place Google also types that way is still filed by its other words — and <Text style={{ fontWeight: '700' }}>undecided</Text> when nothing has been said — those are the discrepancies. Tap a group and its types open under it.
        </Text>
        {wide ? (
          <View style={[styles.tRow, styles.tHead]}>
            <View style={[styles.tFirst, { flex: 1, width: undefined }]}><Text style={styles.kicker}>Google's group</Text></View>
            {['Types', 'Mapped', 'Category only', 'Set aside', 'Undecided'].map((h) => <View key={h} style={[styles.tCell, { width: 100 }]}><Text style={[styles.kicker, { textAlign: 'right' }]} numberOfLines={2}>{h}</Text></View>)}
            <View style={[styles.tCell, { width: 220 }]}><Text style={styles.kicker}>Lands in</Text></View>
          </View>
        ) : null}
        {groups.map((g) => {
          const on = chosen?.name === g.name;
          return (
            <View key={g.name}>
            <Press onPress={() => setGroup(on ? '-' : g.name)} accessibilityRole="button" accessibilityState={{ expanded: on }} style={[styles.tRow, !wide && { alignItems: 'center', gap: spacing.sm }, on && { backgroundColor: colors.well }]}>
              <View style={[styles.tFirst, { flex: 1, width: undefined }]}>
                <Text style={[type.small, { fontWeight: on ? '700' : '600' }]} numberOfLines={2}>{g.name}</Text>
                {/* On a phone the five columns become one line under the name. */}
                {!wide ? <Text style={type.tiny} numberOfLines={2}>{g.types.length} types · {g.mapped} mapped{g.category ? ` · ${g.category} category only` : ''}{g.aside ? ` · ${g.aside} set aside` : ''}{g.lands.length ? ` · ${g.lands.map(catLabel).join(', ')}` : ''}</Text> : null}
              </View>
              {wide ? [g.types.length, g.mapped, g.category, g.aside, g.undecided].map((n, i) => (
                <View key={i} style={[styles.tCell, { width: 100 }]}>
                  <Text style={[type.small, { textAlign: 'right', fontVariant: ['tabular-nums'], color: i === 4 && !n ? colors.inkMuted : colors.ink, fontWeight: i === 4 && n ? '700' : '400' }]}>{n}</Text>
                </View>
              )) : (
                <Text style={[type.small, { fontWeight: g.undecided ? '700' : '400', color: g.undecided ? colors.ink : colors.inkMuted, paddingRight: 6 }]}>{g.undecided} undecided</Text>
              )}
              {wide ? <View style={[styles.tCell, { width: 220 }]}><Text style={type.tiny} numberOfLines={2}>{g.lands.map(catLabel).join(', ') || '—'}</Text></View> : null}
            </Press>
            {/* The group's types, right under its row — never below the fold
                (owner, 12 Sep 2026: "It needs to appear in the same area"). */}
            {on ? (
              <View style={styles.inset}>
                <View style={[styles.line, { flexWrap: 'wrap' }]}>
                  <Text style={[type.tiny, { flex: 1 }]}>{g.types.length} types in {g.name}</Text>
                  <Choice label="Everything" on={gaps !== '1'} onPress={() => setGaps('')} />
                  <Choice label={`Undecided only · ${g.undecided}`} on={gaps === '1'} onPress={() => setGaps('1')} />
                </View>
                {shown.length === 0 ? <Text style={[type.small, styles.emptyRow]}>Nothing undecided in this group.</Text> : null}
                {shown.map((r) => {
                  const st = standing(r);
                  const lands = st === 'aside' ? 'set aside — not a day out'
                    : st === 'mapped' ? `${catLabel(r.landing.category)} · ${subLabel(r.landing.subcategory)}`
                      : st === 'category' ? `${catLabel(r.landing.category)} · no subcategory` : 'undecided';
                  return (
                    <View key={r.key} style={[styles.wordRow, st === 'aside' && { opacity: 0.55 }]}>
                      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                        <Text style={type.small}><Text style={{ fontWeight: '600' }}>{r.label ?? r.key}</Text> <Text style={{ color: colors.inkMuted }}>{r.key}</Text></Text>
                        <Text style={type.tiny} numberOfLines={1}>
                          {[r.seen_count ? `seen ${count(r.seen_count)}` : null, r.landing.derived.length ? `read as ${r.landing.derived.map(keyOf).join(', ')}` : null].filter(Boolean).join(' · ') || ' '}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 1, maxWidth: '40%' }}>
                        <Text style={[type.small, { fontWeight: st === 'undecided' ? '700' : '600', textAlign: 'right' }]} numberOfLines={2}>{lands}</Text>
                        {st !== 'aside' && st !== 'undecided' ? (
                          <Text style={[type.tiny, { textAlign: 'right' }]} numberOfLines={1}>{HOW_WORD[r.landing.how]}{r.landing.via && r.landing.via.scope !== 'default' ? ` · ${r.landing.via.subject_label ?? r.landing.via.subject ?? ''}` : ''}</Text>
                        ) : null}
                      </View>
                      {canManage ? (
                        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                          <TextAction label="Map" onPress={() => onPick(`google:${r.key}`, r.landing.subcategory)} disabled={busyKey === r.key} />
                          <TextAction label={st === 'aside' ? 'Bring back' : 'Set aside'} tone="muted" disabled={busyKey === r.key} onPress={() => void setAside(r, st !== 'aside')} />
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
      </Section>

    </View>
  );
}

// ---------------------------------------------------------------------------
// find a word from any source
// ---------------------------------------------------------------------------

function FindWord({ tax, catLabel, subLabel, canManage, onPick }: {
  tax: Taxonomy; catLabel: (k: string | null | undefined) => string; subLabel: (k: string | null | undefined) => string | null;
  canManage: boolean; foot: number; onPick: (label: string, subcategory: string | null) => void;
}) {
  const [ns, setNs] = useQueryState<string>('ns', '', asText);
  const [q, setQ] = useQueryState<string>('q', '', asText);
  const [typed, setTyped] = useState(q);
  const [rows, setRows] = useState<TaxonomyLabel[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState(false);
  const [foot, setFoot] = useState(36);
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
      <View style={{ position: 'relative', zIndex: 15 }}>
        <View style={[styles.line, { flexWrap: 'wrap' }]} onLayout={(e) => setFoot(e.nativeEvent.layout.height)}>
          <ControlButton label={source ? source.label : 'Any source'} set={Boolean(source)} open={open} onPress={() => setOpen((o) => !o)} spoken="Source" />
          <Field icon="search" value={typed} onChangeText={setTyped} placeholder="A word: stadium, ice_rink, castle, Q23413" style={{ flex: 1, minWidth: 220 }} />
        </View>
        <Popover open={open} top={foot} onClose={() => setOpen(false)}>
          <PopoverList
            options={[{ key: '', label: 'Any source', on: !ns }, ...tax.namespaces.map((n) => ({ key: n.key, label: n.label, count: `${count(n.seen)} / ${count(n.total)}`, on: n.key === ns }))]}
            onPick={(k) => { setNs(k); setOpen(false); }}
          />
        </Popover>
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
  attr: { ...type.tiny, color: colors.ink, fontWeight: '600', backgroundColor: colors.panelWarm, paddingHorizontal: 7, paddingVertical: 3 },
  emptyRow: { color: colors.inkMuted, paddingVertical: spacing.sm },

  ruleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  foundRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 7, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  wordRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },

  editor: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: colors.surfaceMuted, marginVertical: spacing.sm, gap: 4 },
  tokens: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 6 },
  token: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.selected, paddingHorizontal: 8, paddingVertical: 4 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 6, borderBottomWidth: BORDER, borderBottomColor: colors.line, paddingVertical: 2 },
  fieldInput: { flex: 1, paddingVertical: 6, color: colors.ink, fontSize: 14, outlineStyle: 'none' as never, backgroundColor: 'transparent' },
  landing: { paddingVertical: spacing.sm },

  tableWrap: { width: '100%' },
  tRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  tHead: { borderBottomWidth: BORDER, borderBottomColor: colors.line },
  tWork: { backgroundColor: colors.surfaceMuted },
  tFirst: { width: 150, paddingVertical: 8, paddingRight: spacing.sm, justifyContent: 'center' },
  tCell: { paddingVertical: 8, paddingHorizontal: 6, gap: 1, justifyContent: 'center' },
  tCellOn: { backgroundColor: colors.selected },
  inset: { borderLeftWidth: 4, borderLeftColor: colors.selected, paddingLeft: spacing.sm, paddingBottom: spacing.sm, marginBottom: spacing.xs },
});
