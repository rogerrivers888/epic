/**
 * Categories — Epic's own two levels, every provider's words, and the rules
 * that map one onto the other.
 *
 * The owner, 12 Sep 2026: "I'd like to have a screen where I can manage
 * categories and subcategories… Do we label particular attributes of a place
 * as an attribute, and then could we, for each category or subcategory, add
 * the combination of labels that determine whether that particular activity
 * lives in that particular subcategory?… view all of our providers, categories,
 * and subcategories, maybe in a separate tab… the mappings between our
 * providers' categories… map [our master categories and subcategories] to the
 * providers' subcategories."
 *
 * Three tabs, in that order:
 *
 *   Categories   The two levels. Open a subcategory and it shows what fills
 *                it — every rule, as the labels it names — and a way to add
 *                one: pick labels, see where they land today, save.
 *   Labels       Every word each source uses, with where it lands and what
 *                decided that. Tap a word to write a rule about it.
 *   Providers    The matrix: our subcategories down the side, the sources
 *                across the top, and in each cell the source's words that land
 *                there. The last rows are the work: words filed in a category
 *                with no drawer, and words nothing has read at all.
 *
 * A label is one thing one source said, with the source's name in front
 * (`google:museum`, `osm:leisure=ice_rink`, `wikidata:Q23413`), and Epic's own
 * derived words are labels too (`experience:museum`). A rule says: places
 * carrying *all* of these labels go in this subcategory. Narrowest wins — one
 * place, then a combination, then a Wikidata type, then the atlas word, then
 * the experience — so nothing already filed moves unless a rule about it is
 * written (domain/labels.js, domain/moods.js).
 *
 * Layout follows the shell's rule (CLAUDE.md): width from `useViewport`, one
 * tree with different styles rather than two returns, nothing over 390px
 * except the matrix, which scrolls sideways inside the frame.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import {
  api, MoodKey, ShelfSubcategory, Taxonomy, TaxonomyLabel, TaxonomyLanding, TaxonomyMatrix, TaxonomyMatrixEntry,
  TaxonomyNamespace, TaxonomyRule, TaxonomyTry,
} from '../../api';
import { colors, radius, spacing, type, BORDER } from '../../theme';
import { Icon, IconName } from '../../components/Icon';
import { Button, Chip, Row, Wrap } from '../../components/ui';
import { useViewport } from '../../hooks/useViewport';
import { AdminPage, Banner, FilterChip, FilterRow, PageHead, Panel, Pill, Tile, TileRow, ago, count } from '../kit';
import { asOneOf, asText, useQueryState } from '../../router';

const WIDE = 900;

type Tab = 'categories' | 'labels' | 'providers';
const TABS: { key: Tab; label: string }[] = [
  { key: 'categories', label: 'Categories' },
  { key: 'labels', label: 'Labels' },
  { key: 'providers', label: 'Providers' },
];

/** The eight, as pictures; anything added later gets the pin. */
const CAT_ICON: Record<string, IconName> = {
  fun: 'festival', food: 'restaurant', culture: 'museum', sport: 'bowling', activity: 'sport',
  adrenaline: 'climbing', relaxing: 'walk', outdoors: 'park',
};

/** What decided where a word lands, in words. */
const HOW_WORD: Record<TaxonomyLanding['how'], string> = {
  taught: 'a rule',
  default: 'the code\'s own map',
  fallback: 'nothing knew it',
  none: 'not a place on its own',
};
const HOW_TONE: Record<TaxonomyLanding['how'], 'ok' | 'plain' | 'warn' | 'crit'> = {
  taught: 'ok', default: 'plain', fallback: 'warn', none: 'plain',
};

/** What a rule is about, by where it is written. */
const SCOPE_WORD: Record<string, string> = {
  place: 'this one place',
  labels: 'every place carrying all of these',
  kind: 'every place of this Wikidata type',
  category: 'every place the atlas calls this',
  experience: 'every place read as this experience',
};

const nsOf = (label: string) => label.split(':')[0];
const keyOf = (label: string) => label.split(':').slice(1).join(':');

// ---------------------------------------------------------------------------

export function Categories({ canManage }: { canManage: boolean }) {
  const { width } = useViewport();
  const wide = width >= WIDE;

  const [tax, setTax] = useState<Taxonomy | null>(null);
  // Which tab, which subcategory is open, which source and search — all in
  // the address, so a drawer's rules or one provider's words are a link.
  const [tab, setTab] = useQueryState<Tab>('tab', 'categories', asOneOf(['categories', 'labels', 'providers'] as const, 'categories'));
  const [sub, setSub] = useQueryState<string>('sub', '', asText);
  const [ns, setNs] = useQueryState<string>('ns', '', asText);
  const [q, setQ] = useQueryState<string>('q', '', asText);
  const [all, setAll] = useQueryState<string>('all', '', asText);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** A rule being written from the Labels or Providers tab, started from one word. */
  const [editing, setEditing] = useState<{ labels: string[]; subcategory: string | null } | null>(null);

  const load = useCallback(async () => {
    try { setTax(await api.taxonomy()); }
    catch (err) { setNote(String((err as Error).message)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const changed = async (said: string) => { setNote(said); await load(); };
  const failed = (said: string) => setNote(said);

  const known = useMemo(() => (tax?.namespaces ?? []).reduce((n, x) => n + x.total, 0), [tax]);
  const seen = useMemo(() => (tax?.namespaces ?? []).reduce((n, x) => n + x.seen, 0), [tax]);
  const catLabel = (key: string | null | undefined) => tax?.categories.find((c) => c.key === key)?.label ?? key ?? '—';
  const subLabel = (key: string | null | undefined) => tax?.subcategories.find((s) => s.key === key)?.label ?? key ?? null;

  return (
    <AdminPage>
      <PageHead
        title="Categories"
        sub="Epic's own categories and subcategories, every provider's words, and the rules that map one onto the other"
      />

      <TileRow>
        <Tile label="Categories" value={count(tax?.categories.length ?? null)} sub="the chips on the home screen" />
        <Tile label="Subcategories" value={count(tax?.subcategories.length ?? null)} sub="one parent each — that is the no-duplication rule" tone="accent" />
        <Tile label="Rules" value={count(tax?.rules.length ?? null)}
              sub={`${count(tax?.rules.filter((r) => r.scope === 'labels').length ?? 0)} about a combination`} tone="ok" />
        <Tile label="Words known" value={count(known || null)} sub={`${count(seen)} seen on a real place`} />
      </TileRow>

      {note ? <Banner tone="accent">{note}</Banner> : null}

      <Banner>
        A place carries labels: what each source called it, in that source's own words, plus what Epic read those
        into. A rule says which subcategory places carrying a set of labels go in. Narrowest wins — one place, then a
        combination of labels, then a Wikidata type, then the atlas word, then the experience — and naming a
        subcategory settles the category, because a subcategory has exactly one parent.
      </Banner>

      <FilterRow>
        {TABS.map((t) => (
          <FilterChip key={t.key} label={t.label} on={tab === t.key} onPress={() => { setTab(t.key); setEditing(null); }} />
        ))}
      </FilterRow>

      {editing && tax ? (
        <RuleEditor
          key={editing.labels.join('+')}
          tax={tax}
          start={editing.labels}
          startSubcategory={editing.subcategory}
          fixedSubcategory={null}
          canManage={canManage}
          onClose={() => setEditing(null)}
          onSaved={async (said) => { setEditing(null); await changed(said); }}
        />
      ) : null}

      {tab === 'categories' ? (
        <CategoriesTab tax={tax} sub={sub} onOpen={(k) => setSub(k)} canManage={canManage} busy={busy} setBusy={setBusy}
                       onChanged={changed} onFailed={failed} wide={wide} />
      ) : null}

      {tab === 'labels' ? (
        <LabelsTab tax={tax} ns={ns} setNs={setNs} q={q} setQ={setQ} all={all === '1'} setAll={(v) => setAll(v ? '1' : '')}
                   catLabel={catLabel} subLabel={subLabel} canManage={canManage}
                   onPick={(label, subcategory) => setEditing({ labels: [label], subcategory })} />
      ) : null}

      {tab === 'providers' ? (
        <ProvidersTab tax={tax} all={all === '1'} setAll={(v) => setAll(v ? '1' : '')} wide={wide}
                      onNamespace={(k) => { setNs(k); setTab('labels'); }}
                      onPick={(label, subcategory) => setEditing({ labels: [label], subcategory })} />
      ) : null}
    </AdminPage>
  );
}

// ---------------------------------------------------------------------------
// the two levels
// ---------------------------------------------------------------------------

function CategoriesTab({ tax, sub, onOpen, canManage, busy, setBusy, onChanged, onFailed, wide }: {
  tax: Taxonomy | null; sub: string; onOpen: (key: string) => void; canManage: boolean;
  busy: boolean; setBusy: (b: boolean) => void;
  onChanged: (said: string) => Promise<void>; onFailed: (said: string) => void; wide: boolean;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  const [label, setLabel] = useState('');

  const run = async (what: () => Promise<unknown>, said: string) => {
    setBusy(true);
    try { await what(); await onChanged(said); }
    catch (err) { onFailed(String((err as Error).message)); }
    finally { setBusy(false); }
  };

  if (!tax) return <Panel><Text style={type.small}>Loading…</Text></Panel>;

  return (
    <>
      <Panel
        title="Categories and subcategories"
        sub="Tap a subcategory to see what fills it and to add a rule. Renaming is safe; moving a subcategory moves every place in it."
        padded={false}
      >
        {tax.categories.map((c) => (
          <View key={c.key} style={styles.catBlock}>
            <Row style={{ gap: spacing.xs, flexWrap: 'wrap' }}>
              <Icon name={CAT_ICON[c.key] ?? 'place'} size={16} color={colors.icon} />
              <Text style={styles.rowName}>{c.label}</Text>
              <Pill label={`${c.subcategories.length} subcategor${c.subcategories.length === 1 ? 'y' : 'ies'}`} />
              {c.is_door ? <Pill label="a door into Places" tone="accent" /> : null}
              {!c.active ? <Pill label="switched off" tone="warn" /> : null}
              <View style={{ flex: 1 }} />
              {canManage ? (
                <Chip label={c.active ? 'On' : 'Off'} icon={c.active ? 'check' : 'close'} selected={c.active}
                      onPress={() => void run(() => api.shelfSaveCategory({ key: c.key, active: !c.active }),
                        `${c.label} is ${c.active ? 'off the home screen' : 'back on the home screen'}.`)} />
              ) : null}
            </Row>
            {c.blurb ? <Text style={type.tiny}>{c.blurb}</Text> : null}

            <View style={styles.subList}>
              {c.subcategories.map((sc) => (
                <View key={sc.id}>
                  <Press onPress={() => onOpen(sub === sc.key ? '' : sc.key)} style={[styles.subRow, sub === sc.key && styles.subRowOn]}>
                    <Text style={[type.body, { flex: 1, minWidth: 0 }]} numberOfLines={2}>{sc.label}</Text>
                    <Wrap style={{ gap: 4, justifyContent: 'flex-end' }}>
                      <Pill label={`${sc.rules ?? 0} rule${sc.rules === 1 ? '' : 's'}`} tone={sc.rules ? 'plain' : 'warn'} />
                      {sc.indoor === true ? <Pill label="indoors" /> : sc.indoor === false ? <Pill label="outdoors" /> : null}
                      {sc.for_kids === true ? <Pill label="for kids" /> : null}
                      {!sc.active ? <Pill label="off" tone="warn" /> : null}
                    </Wrap>
                    <Icon name={sub === sc.key ? 'collapse' : 'more'} size={16} color={colors.inkMuted} />
                  </Press>
                  {sub === sc.key ? (
                    <SubcategoryPanel sc={sc} tax={tax} canManage={canManage} busy={busy} run={run} wide={wide}
                                      onChanged={onChanged} onFailed={onFailed} />
                  ) : null}
                </View>
              ))}
            </View>

            {canManage ? (
              adding === c.key ? (
                <Row style={{ gap: 4, flexWrap: 'wrap' }}>
                  <TextInput value={label} onChangeText={setLabel} placeholder="Farm shops & pick your own"
                             placeholderTextColor={colors.inkFaint} style={[styles.input, { minWidth: 200, flexGrow: 1 }]} autoFocus
                             onSubmitEditing={() => {
                               const l = label.trim(); setAdding(null); setLabel('');
                               if (l) void run(() => api.shelfSaveSubcategory({ categoryKey: c.key as MoodKey, label: l }), `Added ${l} under ${c.label}.`);
                             }} />
                  <Button label="Add" icon="add" disabled={!label.trim() || busy} onPress={() => {
                    const l = label.trim(); setAdding(null); setLabel('');
                    if (l) void run(() => api.shelfSaveSubcategory({ categoryKey: c.key as MoodKey, label: l }), `Added ${l} under ${c.label}.`);
                  }} />
                  <Button label="Cancel" kind="secondary" onPress={() => { setAdding(null); setLabel(''); }} />
                </Row>
              ) : (
                <Wrap><Chip label="Add a subcategory" icon="add" onPress={() => { setAdding(c.key); setLabel(''); }} /></Wrap>
              )
            ) : null}
          </View>
        ))}
      </Panel>

      <Panel title="How to manage these" sub="The four moves, and what each one does to the home screen">
        <Text style={type.small}>
          <Text style={{ fontWeight: '700' }}>Rename</Text> a category or subcategory freely. The key underneath never changes, so every rule
          pointing at it follows the new name.
        </Text>
        <Text style={type.small}>
          <Text style={{ fontWeight: '700' }}>Move</Text> a subcategory to another category and every place filed in it moves shelf with it. That
          is how to reorganise: move the drawer, not the hundred places inside.
        </Text>
        <Text style={type.small}>
          <Text style={{ fontWeight: '700' }}>Fill</Text> a subcategory with rules. A rule names labels — a Wikidata type, a Google type, a map tag,
          an experience, or several at once — and every place carrying all of them lands there. Teach the type, not the
          place: one rule against “castle” answers for every castle in the country. The Shelves screen is still where a
          single place is moved by hand.
        </Text>
        <Text style={type.small}>
          <Text style={{ fontWeight: '700' }}>Switch off</Text> rather than delete. A category cannot be deleted while it has subcategories; deleting
          a subcategory keeps its rules' weights and simply stops them naming a drawer, so nothing leaves the home screen.
        </Text>
      </Panel>
    </>
  );
}

/**
 * One subcategory, opened: its settings, what fills it, and a way to add a rule.
 */
function SubcategoryPanel({ sc, tax, canManage, busy, run, wide, onChanged, onFailed }: {
  sc: ShelfSubcategory; tax: Taxonomy; canManage: boolean; busy: boolean;
  run: (what: () => Promise<unknown>, said: string) => Promise<void>; wide: boolean;
  onChanged: (said: string) => Promise<void>; onFailed: (said: string) => void;
}) {
  const [rules, setRules] = useState<TaxonomyRule[] | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(sc.label);
  const [adding, setAdding] = useState(false);

  const loadRules = useCallback(async () => {
    try { setRules((await api.taxonomyRules(sc.key)).rules); }
    catch (err) { onFailed(String((err as Error).message)); }
  }, [sc.key, onFailed]);
  useEffect(() => { void loadRules(); }, [loadRules, tax]);

  const tri = (field: 'indoor' | 'forKids', value: boolean | null | undefined, word: string) => (
    <Row style={{ gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      <Text style={type.tiny}>{word}:</Text>
      {([['Yes', true], ['No', false], ['Depends', 'unset']] as const).map(([l, v]) => (
        <Chip key={l} label={l} selected={v === 'unset' ? value == null : value === v}
              onPress={canManage ? () => void run(() => api.shelfSaveSubcategory({ id: sc.id, [field]: v } as never), `${sc.label}: ${word.toLowerCase()} — ${l.toLowerCase()}.`) : undefined} />
      ))}
    </Row>
  );

  return (
    <View style={styles.subPanel}>
      {canManage ? (
        <Row style={{ gap: spacing.xs, flexWrap: 'wrap', alignItems: 'center' }}>
          {renaming ? (
            <>
              <TextInput value={name} onChangeText={setName} style={[styles.input, { minWidth: 180, flexGrow: 1 }]} autoFocus
                         onSubmitEditing={() => { setRenaming(false); void run(() => api.shelfSaveSubcategory({ id: sc.id, label: name.trim() || sc.label }), `Renamed to ${name.trim() || sc.label}.`); }} />
              <Button label="Save" icon="check" onPress={() => { setRenaming(false); void run(() => api.shelfSaveSubcategory({ id: sc.id, label: name.trim() || sc.label }), `Renamed to ${name.trim() || sc.label}.`); }} />
            </>
          ) : (
            <Chip label="Rename" icon="edit" onPress={() => { setName(sc.label); setRenaming(true); }} />
          )}
          <Text style={type.tiny}>Move to:</Text>
          {tax.categories.filter((c) => c.key !== sc.category_key).map((c) => (
            <Chip key={c.key} label={c.label} onPress={() => void run(() => api.shelfSaveSubcategory({ id: sc.id, categoryKey: c.key as MoodKey }), `Moved ${sc.label} to ${c.label} — everything filed in it moved with it.`)} />
          ))}
          <View style={{ flex: 1 }} />
          <Button label="Delete it" icon="close" kind="secondary" disabled={busy}
                  onPress={() => void run(() => api.shelfDeleteSubcategory(sc.id), 'Gone. Its rules keep their weights and stop naming a drawer; nothing left the home screen.')} />
        </Row>
      ) : null}
      {tri('indoor', sc.indoor, 'Indoors')}
      {tri('forKids', sc.for_kids, 'For kids')}

      <View style={styles.divider} />

      <Row style={{ gap: spacing.xs, flexWrap: 'wrap', alignItems: 'center' }}>
        <Text style={[type.small, { fontWeight: '700', flex: 1 }]}>What fills {sc.label}</Text>
        {canManage && !adding ? <Button label="Add a rule" icon="add" onPress={() => setAdding(true)} /> : null}
      </Row>
      <Text style={type.tiny}>
        Every rule that names this drawer. A place carrying all of a rule's labels lands here — unless a narrower rule says otherwise.
      </Text>

      {adding ? (
        <RuleEditor tax={tax} start={[]} startSubcategory={sc.key} fixedSubcategory={sc.key} canManage={canManage}
                    onClose={() => setAdding(false)}
                    onSaved={async (said) => { setAdding(false); await onChanged(said); await loadRules(); }} />
      ) : null}

      {rules === null ? <Text style={type.tiny}>Loading…</Text>
        : rules.length === 0 ? (
          <Text style={type.small}>Nothing fills this yet. Only places moved here one at a time on the Shelves screen will show under it.</Text>
        ) : rules.map((r) => (
          <RuleRow key={r.id} rule={r} wide={wide} canManage={canManage} busy={busy}
                   onForget={() => void run(() => api.shelfForget(r.id), `Forgotten. ${r.subject_label ?? r.subject} falls back to where it started.`).then(loadRules)} />
        ))}
    </View>
  );
}

/** One rule, drawn as the labels it names. */
function RuleRow({ rule, wide, canManage, busy, onForget }: {
  rule: TaxonomyRule; wide: boolean; canManage: boolean; busy: boolean; onForget: () => void;
}) {
  return (
    <View style={[styles.ruleRow, wide && { flexDirection: 'row', alignItems: 'flex-start' }]}>
      <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
        <Wrap style={{ gap: 4 }}>
          {rule.scope === 'place' ? (
            <Chip label={rule.subject_label ?? rule.subject} icon="place" />
          ) : rule.labelList.map((l) => (
            <LabelChip key={l.label} label={l.label} name={l.name} />
          ))}
        </Wrap>
        <Row style={{ gap: spacing.xs, flexWrap: 'wrap' }}>
          <Pill label={SCOPE_WORD[rule.scope] ?? rule.scope} />
          {rule.seeded ? <Pill label="where Epic started" /> : <Pill label="you decided this" tone="accent" />}
          {Object.entries(rule.weights ?? {}).length ? (
            <Pill label={`weights: ${Object.entries(rule.weights).map(([k, v]) => `${k} ${Math.round((v ?? 0) * 100)}`).join(', ')}`} />
          ) : null}
        </Row>
        {rule.reason ? <Text style={type.small}>{rule.reason}</Text> : null}
        <Text style={type.tiny}>{rule.taught_by ? `${rule.taught_by} · ` : ''}{ago(rule.updated_at)}</Text>
      </View>
      {canManage ? <Button label="Forget" icon="close" kind="secondary" disabled={busy} onPress={onForget} /> : null}
    </View>
  );
}

/** A label as a chip: the source, then the English name, with the raw word underneath the name where they differ. */
function LabelChip({ label, name, onPress, onRemove, selected }: {
  label: string; name: string | null; onPress?: () => void; onRemove?: () => void; selected?: boolean;
}) {
  const ns = nsOf(label);
  const key = keyOf(label);
  return <Chip label={`${ns} · ${name && name !== key ? `${name} (${key})` : key}`} onPress={onPress} onRemove={onRemove} selected={selected} />;
}

// ---------------------------------------------------------------------------
// the rule editor: these labels → this subcategory
// ---------------------------------------------------------------------------

/**
 * Pick labels, see where they land today, name the drawer, save.
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

  // The search, across every source, debounced.
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => {
      void api.taxonomyLabels({ q: q.trim(), all: true, limit: 40 }).then((d) => setFound(d.labels)).catch(() => setFound([]));
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

  return (
    <Panel title="A rule" sub="Places carrying all of these labels go in this subcategory"
           right={<Button label="Close" icon="close" kind="secondary" onPress={onClose} />}>
      <Text style={type.small}>Which labels?</Text>
      <Wrap style={{ gap: 4 }}>
        {labels.map((l) => (
          <LabelChip key={l.label} label={l.label} name={l.name} selected
                     onRemove={() => setLabels((prev) => prev.filter((x) => x.label !== l.label))} />
        ))}
        {labels.length === 0 ? <Text style={type.tiny}>None yet — search below.</Text> : null}
      </Wrap>
      <View style={styles.search}>
        <Icon name="search" size={15} color={colors.inkMuted} />
        <TextInput value={q} onChangeText={setQ} placeholder="castle, ice_rink, stadium, Q23413…"
                   placeholderTextColor={colors.inkFaint} style={styles.searchInput} />
      </View>
      {found.length ? (
        <Wrap style={{ gap: 4 }}>
          {found.filter((f) => !chosen.has(`${f.namespace}:${f.key}`)).slice(0, 24).map((f) => (
            <LabelChip key={`${f.namespace}:${f.key}`} label={`${f.namespace}:${f.key}`} name={f.label}
                       onPress={() => { setLabels((prev) => [...prev, { label: `${f.namespace}:${f.key}`, name: f.label ?? keyOf(f.key) }]); setQ(''); setFound([]); }} />
          ))}
        </Wrap>
      ) : q.trim().length >= 2 ? <Text style={type.tiny}>No source uses a word like that.</Text> : null}
      <Text style={type.tiny}>{level.replace(/^a/, 'This will be a')}. A rule about one Wikidata type, atlas word or experience is written at that level, the same as the Shelves screen writes it; a provider's own word, or several labels together, sits above the type rules and below a rule about one place.</Text>

      <View style={styles.divider} />

      {fixedSubcategory ? (
        <Text style={type.small}>Into: <Text style={{ fontWeight: '700' }}>{catLabel(catOf(fixedSubcategory))} · {subLabel(fixedSubcategory)}</Text></Text>
      ) : (
        <>
          <Text style={type.small}>Which subcategory?</Text>
          {tax.categories.map((c) => (
            <Row key={c.key} style={{ gap: 4, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <Chip label={c.label} icon={CAT_ICON[c.key] ?? 'place'} />
              <Wrap style={{ gap: 4, flex: 1 }}>
                {c.subcategories.filter((s) => s.active).map((s) => (
                  <Chip key={s.key} label={s.label} selected={sub === s.key} onPress={() => setSub(s.key)} />
                ))}
              </Wrap>
            </Row>
          ))}
        </>
      )}

      <Banner tone={preview ? (preview.subcategory === sub && sub ? 'ok' : 'accent') : 'plain'}>
        {!labels.length ? 'Pick at least one label to see where it lands today.'
          : !preview ? 'Working out where these land today…'
            : `Today a place with ${labels.length === 1 ? 'this label' : 'these labels'} lands in ${catLabel(preview.category)}${subLabel(preview.subcategory) ? ` · ${subLabel(preview.subcategory)}` : ' with no subcategory'}${preview.because[0] ? ` — because ${preview.because[0].scope === 'default' ? preview.because[0].subject_label ?? 'of the code\'s own map' : `of a ${SCOPE_WORD[preview.because[0].scope]?.replace('every place', 'rule for every place') ?? preview.because[0].scope} rule`}` : ''}.${sub && preview.subcategory !== sub ? ` After saving it will land in ${catLabel(catOf(sub))} · ${subLabel(sub)}.` : ''}`}
      </Banner>

      <Text style={type.small}>Why? (kept on the rule, so it can be argued with later)</Text>
      <TextInput value={reason} onChangeText={setReason} placeholder="A castle that is also a museum is a historic house day, not a ruin."
                 placeholderTextColor={colors.inkFaint} style={styles.input} />
      {err ? <Banner tone="warn">{err}</Banner> : null}
      <Row style={{ gap: spacing.sm, flexWrap: 'wrap' }}>
        <Button label={busy ? 'Saving…' : 'Save the rule'} icon="check" disabled={busy || !canManage || !labels.length || !sub} onPress={() => void save()} />
        <Button label="Cancel" kind="secondary" onPress={onClose} />
      </Row>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// every word each source uses
// ---------------------------------------------------------------------------

function LabelsTab({ tax, ns, setNs, q, setQ, all, setAll, catLabel, subLabel, canManage, onPick }: {
  tax: Taxonomy | null; ns: string; setNs: (k: string) => void; q: string; setQ: (q: string) => void;
  all: boolean; setAll: (v: boolean) => void;
  catLabel: (k: string | null | undefined) => string; subLabel: (k: string | null | undefined) => string | null;
  canManage: boolean; onPick: (label: string, subcategory: string | null) => void;
}) {
  const [rows, setRows] = useState<TaxonomyLabel[] | null>(null);
  const [typed, setTyped] = useState(q);
  const namespace = ns || tax?.namespaces[0]?.key || 'google';

  useEffect(() => { setTyped(q); }, [q]);
  useEffect(() => {
    const t = setTimeout(() => { if (typed !== q) setQ(typed); }, 300);
    return () => clearTimeout(t);
  }, [typed, q, setQ]);

  useEffect(() => {
    let live = true;
    setRows(null);
    void api.taxonomyLabels({ namespace, q: q || undefined, all: all || namespace !== 'wikidata', limit: 400 })
      .then((d) => { if (live) setRows(d.labels); })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [namespace, q, all, tax]);

  const here = tax?.namespaces.find((n) => n.key === namespace) ?? null;

  return (
    <>
      <FilterRow>
        {(tax?.namespaces ?? []).map((n) => (
          <FilterChip key={n.key} label={n.label} count={n.seen || n.total} on={namespace === n.key} onPress={() => setNs(n.key)} />
        ))}
      </FilterRow>

      <Panel title={here?.label ?? namespace} sub={here?.what}>
        <Row style={{ gap: spacing.sm, flexWrap: 'wrap', alignItems: 'center' }}>
          <View style={[styles.search, { flexGrow: 1, flexBasis: 200 }]}>
            <Icon name="search" size={15} color={colors.inkMuted} />
            <TextInput value={typed} onChangeText={setTyped} placeholder="Search this source's words" placeholderTextColor={colors.inkFaint} style={styles.searchInput} />
          </View>
          {namespace === 'wikidata' ? (
            <Chip label={all ? 'Every type' : 'Seen on a place'} icon="filters" selected={all} onPress={() => setAll(!all)} />
          ) : null}
          {here ? <Pill label={`${count(here.total)} known · ${count(here.seen)} seen · ${count(here.taught)} in a rule`} /> : null}
        </Row>
        <Text style={type.tiny}>
          {here?.own === false
            ? 'A licensed source: these are its published words and a count of how often each was seen. Which place carried which word stays in the session.'
            : 'An open source, or Epic\'s own words: safe to keep.'}
          {' '}Tap a word to write a rule about it.
        </Text>
      </Panel>

      <Panel title="Where each word lands" sub="Today's answer for a place carrying only that word, and what decided it" padded={false}>
        {rows === null ? <View style={{ padding: spacing.md }}><Text style={type.small}>Loading…</Text></View>
          : rows.length === 0 ? <View style={{ padding: spacing.md }}><Text style={type.small}>{q ? 'No word like that here.' : namespace === 'wikidata' && !all ? 'No atlas place has carried a type yet. Switch to “Every type”.' : 'Nothing known yet.'}</Text></View>
            : rows.map((r) => (
              <Press key={`${r.namespace}:${r.key}`} onPress={canManage ? () => onPick(`${r.namespace}:${r.key}`, r.landing.subcategory) : undefined} style={styles.labelRow}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Row style={{ gap: spacing.xs, flexWrap: 'wrap' }}>
                    <Text style={styles.rowName}>{r.label ?? r.key}</Text>
                    {r.label && r.label !== r.key ? <Text style={styles.mono}>{r.key}</Text> : null}
                    {r.note ? <Pill label={r.note} /> : null}
                    {r.seen_count ? <Pill label={`seen ${count(r.seen_count)}`} /> : null}
                    {r.active === false ? <Pill label="off" tone="warn" /> : null}
                  </Row>
                  {r.landing.derived.length ? (
                    <Text style={type.tiny} numberOfLines={1}>read as {r.landing.derived.join(', ')}</Text>
                  ) : null}
                </View>
                <Wrap style={{ gap: 4, justifyContent: 'flex-end' }}>
                  <Chip
                    label={r.landing.how === 'none' ? (r.namespace === 'wikidata' ? 'not admitted to the atlas' : 'not a place on its own')
                      : `${catLabel(r.landing.category)}${subLabel(r.landing.subcategory) ? ` · ${subLabel(r.landing.subcategory)}` : ' · no subcategory'}`}
                    icon={r.landing.category ? CAT_ICON[r.landing.category] ?? 'place' : 'place'}
                  />
                  <Pill label={r.landing.how === 'none' && r.namespace === 'wikidata' ? 'the harvest refuses it' : HOW_WORD[r.landing.how]} tone={HOW_TONE[r.landing.how]} />
                  {r.landing.via && r.landing.via.scope !== 'default' ? (
                    <Pill label={`via ${r.landing.via.scope}: ${r.landing.via.subject_label ?? r.landing.via.subject ?? ''}`} tone="ok" />
                  ) : null}
                </Wrap>
                {canManage ? <Icon name="more" size={16} color={colors.inkMuted} /> : null}
              </Press>
            ))}
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
// the matrix: our subcategories × their words
// ---------------------------------------------------------------------------

function ProvidersTab({ tax, all, setAll, wide, onNamespace, onPick }: {
  tax: Taxonomy | null; all: boolean; setAll: (v: boolean) => void; wide: boolean;
  onNamespace: (key: string) => void; onPick: (label: string, subcategory: string | null) => void;
}) {
  const [m, setM] = useState<TaxonomyMatrix | null>(null);
  const [open, setOpen] = useState<{ row: string; ns: string; where: 'cells' | 'unfiled' | 'nowhere' } | null>(null);

  useEffect(() => {
    let live = true;
    setM(null);
    void api.taxonomyMatrix(all).then((d) => { if (live) setM(d); }).catch(() => { if (live) setM(null); });
    return () => { live = false; };
  }, [all, tax]);

  const nsLabel = (k: string) => tax?.namespaces.find((n) => n.key === k)?.label ?? k;
  const cellOf = (where: 'cells' | 'unfiled' | 'nowhere', row: string, ns: string): TaxonomyMatrixEntry[] => m?.[where]?.[row]?.[ns] ?? [];
  const FIRST = wide ? 220 : 150;
  const COL = 118;

  const cell = (where: 'cells' | 'unfiled' | 'nowhere', row: string, ns: string, subcategory: string | null) => {
    const words = cellOf(where, row, ns);
    const on = open?.where === where && open.row === row && open.ns === ns;
    return (
      <Press key={ns} onPress={words.length ? () => setOpen(on ? null : { row, ns, where }) : undefined}
             style={[styles.cell, { width: COL }, on && styles.cellOn, !words.length && { opacity: 0.35 }]}>
        <Text style={[type.small, { fontWeight: '700' }]}>{words.length ? count(words.length) : '·'}</Text>
        {words.length ? (
          <Text style={type.tiny} numberOfLines={2}>{words.slice(0, 3).map((w) => w.label ?? w.key).join(', ')}{words.length > 3 ? '…' : ''}</Text>
        ) : null}
      </Press>
    );
  };

  const opened = open ? cellOf(open.where, open.row, open.ns) : [];
  const openedSub = open?.where === 'cells' ? open.row : null;

  return (
    <>
      <Panel title="The providers" sub="Each source's vocabulary: how much of it is known, how much has been seen on a real place, and how much is named in a rule. Tap one to read its words.">
        <Wrap style={{ gap: 4 }}>
          {(tax?.namespaces ?? []).map((n) => (
            <Chip key={n.key} label={`${n.label} · ${count(n.seen)}/${count(n.total)} seen · ${count(n.taught)} taught`} onPress={() => onNamespace(n.key)} />
          ))}
        </Wrap>
        <Row style={{ gap: spacing.sm, flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip label={all ? 'Every Wikidata type' : 'Wikidata types seen on a place'} icon="filters" selected={all} onPress={() => setAll(!all)} />
          <Text style={[type.tiny, { flex: 1 }]}>
            Each cell is the words from that source which land in that subcategory today. Tap a cell to read them; tap a word to write a rule.
          </Text>
        </Row>
      </Panel>

      {open && opened.length ? (
        <Panel title={`${nsLabel(open.ns)} → ${open.where === 'cells' ? (tax?.subcategories.find((s) => s.key === open.row)?.label ?? open.row) : open.where === 'unfiled' ? `${tax?.categories.find((c) => c.key === open.row)?.label ?? open.row}, no subcategory` : `nothing read it, so ${tax?.categories.find((c) => c.key === open.row)?.label ?? open.row}`}`}
               sub="Tap a word to write a rule about it" right={<Button label="Close" icon="close" kind="secondary" onPress={() => setOpen(null)} />}>
          <Wrap style={{ gap: 4 }}>
            {opened.map((w) => (
              <Chip key={w.key} label={`${w.label && w.label !== w.key ? `${w.label} (${w.key})` : w.key}${w.seen ? ` · ${w.seen}` : ''}`}
                    tone={w.how === 'taught' ? 'accent' : 'neutral'} onPress={() => onPick(`${open.ns}:${w.key}`, openedSub)} />
            ))}
          </Wrap>
        </Panel>
      ) : null}

      <Panel title="Our subcategories against their words" sub={m ? undefined : 'Working it out…'} padded={false}>
        {m ? (
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View>
              <View style={[styles.mRow, styles.mHead]}>
                <View style={[styles.cellFirst, { width: FIRST }]}><Text style={type.tiny}>Subcategory</Text></View>
                {m.namespaces.map((ns) => (
                  <Press key={ns} onPress={() => onNamespace(ns)} style={[styles.cell, { width: COL }]}>
                    <Text style={[type.tiny, { fontWeight: '700' }]} numberOfLines={2}>{nsLabel(ns)}</Text>
                  </Press>
                ))}
              </View>
              {m.categories.map((c) => (
                <React.Fragment key={c.key}>
                  <View style={[styles.mRow, styles.mCat]}>
                    <View style={[styles.cellFirst, { width: FIRST, flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                      <Icon name={CAT_ICON[c.key] ?? 'place'} size={14} color={colors.icon} />
                      <Text style={[type.small, { fontWeight: '700' }]}>{c.label}</Text>
                    </View>
                    {m.namespaces.map((ns) => <View key={ns} style={[styles.cell, { width: COL }]} />)}
                  </View>
                  {c.subcategories.map((s) => (
                    <View key={s.key} style={styles.mRow}>
                      <View style={[styles.cellFirst, { width: FIRST }]}><Text style={type.small} numberOfLines={2}>{s.label}</Text></View>
                      {m.namespaces.map((ns) => cell('cells', s.key, ns, s.key))}
                    </View>
                  ))}
                  {m.unfiled[c.key] ? (
                    <View style={[styles.mRow, styles.mWork]}>
                      <View style={[styles.cellFirst, { width: FIRST }]}><Text style={type.small} numberOfLines={2}>{c.label}, no subcategory</Text></View>
                      {m.namespaces.map((ns) => cell('unfiled', c.key, ns, null))}
                    </View>
                  ) : null}
                  {m.nowhere[c.key] ? (
                    <View style={[styles.mRow, styles.mWork]}>
                      <View style={[styles.cellFirst, { width: FIRST }]}><Text style={type.small} numberOfLines={2}>Nothing read it; falls to {c.label}</Text></View>
                      {m.namespaces.map((ns) => cell('nowhere', c.key, ns, null))}
                    </View>
                  ) : null}
                </React.Fragment>
              ))}
            </View>
          </ScrollView>
        ) : null}
      </Panel>

      <Panel title="Reading the last rows" sub="The two kinds of gap, kept apart">
        <Text style={type.small}>
          <Text style={{ fontWeight: '700' }}>No subcategory</Text> — the word is read into a category but no rule names a drawer, so places carrying
          only that word show under the category unsorted. A rule fixes it.
        </Text>
        <Text style={type.small}>
          <Text style={{ fontWeight: '700' }}>Nothing read it</Text> — no map in the code knows the word, so a place carrying only that word falls to
          the broadest shelf. Most of Google's list is here on purpose (plumbers, banks); the ones that are days out are the work.
        </Text>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  rowName: { ...type.body, fontWeight: '700' },
  mono: { ...type.tiny, color: colors.inkMuted },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    borderWidth: BORDER, borderColor: colors.line, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, paddingVertical: 9, color: colors.ink, outlineStyle: 'none' as never },
  input: {
    borderWidth: BORDER, borderColor: colors.line, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, paddingVertical: 9, color: colors.ink, backgroundColor: colors.surface,
  },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: spacing.xs },
  catBlock: {
    gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderTopWidth: BORDER, borderTopColor: colors.line,
  },
  subList: { gap: 2 },
  subRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap',
    paddingVertical: 8, paddingHorizontal: spacing.sm, borderRadius: radius.sm,
  },
  subRowOn: { backgroundColor: colors.well },
  subPanel: {
    gap: spacing.sm, padding: spacing.md, marginBottom: spacing.xs,
    backgroundColor: colors.surfaceMuted, borderRadius: radius.sm,
  },
  ruleRow: {
    gap: spacing.sm, paddingVertical: spacing.sm,
    borderTopWidth: BORDER, borderTopColor: colors.line,
  },
  labelRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, flexWrap: 'wrap',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderTopWidth: BORDER, borderTopColor: colors.line,
  },
  mRow: { flexDirection: 'row', borderTopWidth: BORDER, borderTopColor: colors.line },
  mHead: { backgroundColor: colors.surfaceMuted, borderTopWidth: 0 },
  mCat: { backgroundColor: colors.well },
  mWork: { backgroundColor: colors.surfaceMuted },
  cellFirst: { paddingVertical: 8, paddingHorizontal: spacing.sm, justifyContent: 'center' },
  cell: { paddingVertical: 8, paddingHorizontal: spacing.xs, gap: 2, borderLeftWidth: BORDER, borderLeftColor: colors.line, justifyContent: 'center' },
  cellOn: { backgroundColor: colors.selected },
});
