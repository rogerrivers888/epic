/**
 * Skills — the five vocabularies behind a host offer, and the queue that keeps
 * them usable.
 *
 * Briefs: "Epic Host Skills — Claude Code" §3 (the back office) and the design
 * handoff's S18 (the queue). A host offer used to carry one free-text word, so
 * a fossil walk on the Jurassic Coast and a talk about the Norman conquest were
 * both filed as "History" and neither could be found by somebody who wanted
 * exactly it. There is no skills library for tourism to buy in, so Epic owns
 * one, and this is where it is run.
 *
 * The design is `Categories.tsx` applied to host vocabularies, and for the same
 * reason (owner, 12 Sep 2026): "I want to select a category in the drop-down
 * box. I don't want you just showing a huge scroll ever." So it is **one
 * vocabulary at a time, chosen from a control at the top**. Nothing is boxed;
 * a section is a kicker over one ink rule, rows sit on hairlines, an action is
 * an underlined word, and the only filled things are the selected row and the
 * one primary button.
 *
 * **The queue is the part used daily**, so it opens first and its three
 * decisions are reachable without leaving the row. Merge is the most-used
 * button on it: without merge the vocabulary fills with *fossils*, *Fossils*,
 * *fossil-hunting* and *Fossil Hunting* inside a week — the failure mode that
 * killed every folksonomy that did not have a queue.
 *
 * Reject is an ink outline rather than the red the canvas draws (owner,
 * 13 Sep 2026). Red is retired in Epic apart from allergens, overruns and the
 * Plan screen's Stop; rejecting a word is reversible and nothing here is
 * dangerous, so it is told apart by position and copy instead.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import {
  api, CredentialType, CredentialWaiting, SkillCategory, SkillProposal, SkillSuggestion,
  SkillVocabRow, SkillsOverview, VocabularySource,
} from '../../api';
import { colors, spacing, type, BORDER, LIME, INK } from '../../theme';
import { Icon } from '../../components/Icon';
import { useViewport } from '../../hooks/useViewport';
import { AdminPage, Choice, Dropdown, PageHead, Section, TextAction, ago, count } from '../kit';
import { asOneOf, asText, useQueryState } from '../../router';

const WIDE = 900;

type View_ = 'queue' | 'categories' | 'formats' | 'tags' | 'facets' | 'credentials' | 'sources';
type QueueState = 'open' | 'approved' | 'merged' | 'rejected' | 'all';
const QUEUE_STATES: readonly QueueState[] = ['open', 'approved', 'merged', 'rejected', 'all'];
const VIEWS: { key: View_; label: string; short: string }[] = [
  { key: 'queue', label: 'What hosts have typed', short: 'Queue' },
  { key: 'categories', label: 'The browse row', short: 'Categories' },
  { key: 'formats', label: 'What actually happens', short: 'Formats' },
  { key: 'tags', label: 'Expertise tags', short: 'Tags' },
  { key: 'facets', label: 'Places, species, periods', short: 'Facets' },
  { key: 'credentials', label: 'Credentials', short: 'Credentials' },
  { key: 'sources', label: 'Where the words came from', short: 'Sources' },
];
const VIEW_KEYS = VIEWS.map((v) => v.key);

export function Skills({ canManage }: { canManage: boolean }) {
  const { width } = useViewport();
  const wide = width >= WIDE;
  const [view, setView] = useQueryState<View_>('view', 'queue', asOneOf(VIEW_KEYS as readonly View_[], 'queue'));
  const [over, setOver] = useState<SkillsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setOver(await api.adminSkills()); setError(null); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const waiting = over?.queue.open ?? 0;

  return (
    <AdminPage>
      <PageHead
        title="Skills"
        sub="What a host says they are expert in, the sixteen buckets it is browsed by, and the words Epic has not heard before"
      />

      <View style={[s.controls, wide ? null : { flexDirection: 'column', alignItems: 'flex-start' }]}>
        <Dropdown
          label="Looking at"
          value={VIEWS.find((v) => v.key === view)?.label ?? 'What hosts have typed'}
          options={VIEWS.map((v) => ({
            key: v.key, label: v.label, on: v.key === view,
            count: v.key === 'queue' ? waiting || null : v.key === 'credentials' ? over?.credentialsWaiting || null : null,
          }))}
          onPick={(k) => setView(k as View_)}
          width={300}
        />
        <View style={{ flex: 1 }} />
        {waiting ? <Text style={type.small}>{waiting} waiting{over?.queue.oldest ? ` · oldest ${ago(over.queue.oldest)}` : ''}</Text> : null}
        {over && !over.trigram ? (
          <Text style={type.small}>
            Trigram matching is off on this database, so a typo will not find its tag — the resolver is matching on prefix and substring only.
          </Text>
        ) : null}
      </View>

      {error ? <Text style={type.small}>{error}</Text> : null}

      {view === 'queue' ? <Queue canManage={canManage} onChanged={load} categories={over?.categories ?? []} kinds={over?.facetKinds ?? []} /> : null}
      {view === 'categories' ? <Curated kind="category" rows={over?.categories ?? []} canManage={canManage} onChanged={load} /> : null}
      {view === 'formats' ? <Curated kind="format" rows={over?.formats ?? []} canManage={canManage} onChanged={load} /> : null}
      {view === 'tags' ? <Vocabulary vocab="tag" categories={over?.categories ?? []} canManage={canManage} /> : null}
      {view === 'facets' ? <Vocabulary vocab="facet" categories={over?.categories ?? []} kinds={over?.facetKinds ?? []} canManage={canManage} /> : null}
      {view === 'credentials' ? <Credentials canManage={canManage} onChanged={load} categories={over?.categories ?? []} /> : null}
      {view === 'sources' ? <Sources rows={over?.sources ?? []} /> : null}
    </AdminPage>
  );
}

// ---------------------------------------------------------------------------
// the queue
// ---------------------------------------------------------------------------
/**
 * Every wording Epic could not resolve, ordered by how often it has been typed.
 *
 * A proposal carries the host's words, the offers that produced it and a count;
 * identical wording from another host increments this row rather than making a
 * second, which is what normalisation exists for. Approving repoints every
 * offer carrying those words; merging repoints them at the survivor and keeps
 * the wording as an alternative that resolves to it — which is also what makes
 * a guest searching the wording find the survivor. Rejecting keeps the row, so
 * the same wording never raises a new proposal.
 */
/**
 * The bucket a one-tap approval would file it in: the one its nearest existing
 * words already sit in. Null when they disagree or there are none, which is
 * when the screen asks instead of guessing.
 */
function quickCategory(p: SkillProposal): string | null {
  if (p.vocab !== 'tag') return null;
  const keys = p.targets.map((t) => t.categoryKey).filter(Boolean) as string[];
  return keys.length && keys.every((k) => k === keys[0]) ? keys[0] : null;
}

function Queue({ canManage, onChanged, categories, kinds }: { canManage: boolean; onChanged: () => void; categories: SkillCategory[]; kinds: string[] }) {
  const categoryLabel = (p: SkillProposal) => categories.find((c) => c.key === quickCategory(p))?.label ?? quickCategory(p) ?? '';
  const [state, setState] = useQueryState<QueueState>('state', 'open', asOneOf(QUEUE_STATES, 'open'));
  const [rows, setRows] = useState<SkillProposal[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows((await api.adminSkillQueue(state)).proposals); } catch (e: any) { setSaid(e.message); }
  }, [state]);
  useEffect(() => { void load(); }, [load]);

  const decide = async (p: SkillProposal, body: Parameters<typeof api.adminDecideProposal>[1]) => {
    setBusy(p.id); setSaid(null);
    try { await api.adminDecideProposal(p.id, body); await load(); onChanged(); }
    catch (e: any) { setSaid(e.message); } finally { setBusy(null); setEditing(null); }
  };

  return (
    <Section
      title="Pending words"
      right={
        <View style={{ flexDirection: 'row', gap: 2 }}>
          {(['open', 'approved', 'merged', 'rejected'] as QueueState[]).map((k) => (
            <Choice key={k} label={k} on={state === k} onPress={() => setState(k)} />
          ))}
        </View>
      }
    >
      {said ? <Text style={[type.small, { paddingTop: 8 }]}>{said}</Text> : null}
      {rows && !rows.length ? (
        <Text style={[type.small, { paddingVertical: spacing.md }]}>
          {state === 'open' ? 'Nothing waiting. Every word a host has typed resolved to something Epic already knew.' : 'Nothing here.'}
        </Text>
      ) : null}
      {(rows ?? []).map((p) => (
        <View key={p.id} style={s.proposal}>
          <View style={s.proposalHead}>
            <Text style={s.term}>“{p.raw}”</Text>
            <Text style={type.small}>{ago(p.createdAt)}</Text>
            {p.count > 1 ? <Text style={s.times}>typed {p.count} times</Text> : null}
            <View style={{ flex: 1 }} />
            <Text style={type.small}>{p.vocab === 'facet' ? 'a place or subject' : 'an expertise tag'}</Text>
          </View>
          <Text style={type.small}>
            {p.offers} offer{p.offers === 1 ? '' : 's'} carry it now, and {p.offers === 1 ? 'it is' : 'they are'} live with the host’s own wording on the card.
          </Text>

          {p.state === 'open' && p.targets.length ? (
            <View style={{ paddingTop: 8 }}>
              <Text style={s.kicker}>Closest existing</Text>
              {p.targets.map((t) => (
                <View key={t.key} style={s.targetRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.targetLabel} numberOfLines={1}>{t.label}</Text>
                    <Text style={type.small} numberOfLines={1}>{[t.breadcrumb, t.hostCount != null ? `${t.hostCount} hosts` : null].filter(Boolean).join(' · ')}</Text>
                  </View>
                  <TextAction label="Merge" onPress={() => decide(p, { decision: 'merge', targetKey: t.key })} disabled={!canManage || busy === p.id} />
                </View>
              ))}
            </View>
          ) : null}

          {p.state !== 'open' ? (
            <Text style={type.small}>
              {p.state === 'approved' ? 'Approved' : p.state === 'merged' ? 'Merged' : 'Rejected'}
              {p.targetKey ? ` into ${p.targetKey}` : ''}{p.decidedBy ? ` by ${p.decidedBy}` : ''}{p.decidedAt ? `, ${ago(p.decidedAt)}` : ''}.
            </Text>
          ) : editing === p.id ? (
            <Approve proposal={p} categories={categories} kinds={kinds} onCancel={() => setEditing(null)} onApprove={(body) => decide(p, body)} />
          ) : (
            <View style={s.actions}>
              {/**
                * One tap, where one tap is honest.
                *
                * A tag has to land in one of the sixteen, because that is what
                * decides where an offer carrying it is listed. The nearest
                * existing words are almost always in the right bucket, so that
                * is what Approve sends; where they are not, or where there are
                * none, Approve opens Edit and asks (Codex, 13 Sep 2026).
                */}
              <Press
                onPress={() => (quickCategory(p) ? decide(p, { decision: 'approve', categoryKey: quickCategory(p) }) : setEditing(p.id))}
                disabled={!canManage || busy === p.id}
                accessibilityRole="button"
                style={[s.primary, (!canManage || busy === p.id) && { opacity: 0.4 }]}
              >
                <Text style={s.primaryText}>Approve{quickCategory(p) ? ` into ${categoryLabel(p)}` : '…'}</Text>
              </Press>
              <Press onPress={() => setEditing(p.id)} disabled={!canManage} accessibilityRole="button" style={[s.outline, !canManage && { opacity: 0.4 }]}>
                <Text style={s.outlineText}>Edit</Text>
              </Press>
              <Press onPress={() => decide(p, { decision: 'reject' })} disabled={!canManage || busy === p.id} accessibilityRole="button" style={[s.outline, (!canManage || busy === p.id) && { opacity: 0.4 }]}>
                <Text style={s.outlineText}>Reject</Text>
              </Press>
            </View>
          )}
        </View>
      ))}
    </Section>
  );
}

/**
 * Approving with a change of mind about the words.
 *
 * The host typed what they call it; Epic's label is Epic's to write, and this
 * is where. The parent is set here too and only here: Wikidata's own subclasses
 * are offered as a suggestion beside the identifier, and never written
 * unattended, because the class graph has cycles and a naive closure from
 * *foraging* pulls in animal behaviour and psychology.
 */
function Approve({ proposal, categories, kinds, onApprove, onCancel }: {
  proposal: SkillProposal;
  categories: SkillCategory[];
  kinds: string[];
  onApprove: (body: Parameters<typeof api.adminDecideProposal>[1]) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(proposal.raw);
  const [note, setNote] = useState('');
  const [parent, setParent] = useState<SkillSuggestion | null>(null);
  /**
   * A tag has to land in one of the sixteen, because the browse category is
   * derived from the tags. Taking a parent sets it; a genuinely new word with
   * no parent needs one chosen here, or the approval is refused and there is
   * nowhere to answer it (Codex, 13 Sep 2026).
   */
  const [category, setCategory] = useState<string | null>(null);
  /** A facet's kind, which decides whether it can ever be suggested from a location. */
  const [kind, setKind] = useState<string>('place');
  const [parents, setParents] = useState<SkillSuggestion[]>([]);
  const [candidates, setCandidates] = useState<{ qid: string; label: string; description: string | null }[] | null>(null);
  const [qid, setQid] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

  useEffect(() => {
    let live = true;
    api.skillSuggest(label, { vocab: proposal.vocab, guest: true, limit: 6 })
      .then((r) => { if (live) setParents(r.suggestions); }).catch(() => {});
    return () => { live = false; };
  }, [label, proposal.vocab]);

  const look = async () => {
    setLooking(true);
    try { setCandidates((await api.adminSkillCandidates(label)).candidates); } catch { setCandidates([]); } finally { setLooking(false); }
  };

  return (
    <View style={{ gap: 10, paddingTop: 10 }}>
      <Field label="What Epic calls it">
        <TextInput value={label} onChangeText={setLabel} style={s.input} placeholder="Bell ringing" placeholderTextColor={colors.ghost} />
      </Field>
      <Field label="One line of plain English, for the detail sheet">
        <TextInput value={note} onChangeText={setNote} style={s.input} placeholder="Ringing church bells in changes, on a rope." placeholderTextColor={colors.ghost} />
      </Field>
      <Field label="Its parent — set by you, never by Wikidata">
        <View style={s.wrap}>
          {parents.map((p) => (
            <Choice key={p.key} label={p.label} on={parent?.key === p.key} onPress={() => setParent(parent?.key === p.key ? null : p)} />
          ))}
          {!parents.length ? <Text style={type.small}>Nothing close. It will sit at the top of its category.</Text> : null}
        </View>
      </Field>
      {proposal.vocab === 'tag' ? (
        <Field label={parent?.categoryKey ? 'Which of the sixteen — taken from its parent, and yours to move' : 'Which of the sixteen it reads under'}>
          <View style={s.wrap}>
            {categories.map((c) => (
              <Choice
                key={c.key} label={c.label}
                on={(category ?? parent?.categoryKey ?? null) === c.key}
                onPress={() => setCategory(category === c.key ? null : c.key)}
              />
            ))}
          </View>
        </Field>
      ) : (
        <Field label="What kind of thing it is — a place is the only kind an offer's location can suggest">
          <View style={s.wrap}>
            {(kinds.length ? kinds : ['place', 'subject', 'species', 'monument', 'period']).map((k) => (
              <Choice key={k} label={k} on={kind === k} onPress={() => setKind(k)} />
            ))}
          </View>
        </Field>
      )}
      <Field label="An identifier, if one fits">
        <View style={{ gap: 6 }}>
          <TextAction label={looking ? 'Asking Wikidata…' : 'Find candidates on Wikidata'} onPress={look} disabled={looking} />
          {(candidates ?? []).map((c) => (
            <Press key={c.qid} onPress={() => setQid(qid === c.qid ? null : c.qid)} accessibilityRole="button" style={[s.candidate, qid === c.qid && { backgroundColor: colors.selected }]}>
              <Text style={[type.small, { fontWeight: '700', color: qid === c.qid ? colors.selectedFg : colors.ink }]}>{c.label} · {c.qid}</Text>
              {/* The description tells *foraging* the human activity from
                  *foraging* the animal behaviour. Shown, never stored. */}
              {c.description ? <Text style={[type.small, qid === c.qid && { color: colors.selectedFg }]}>{c.description}</Text> : null}
            </Press>
          ))}
          {candidates && !candidates.length ? <Text style={type.small}>Nothing came back. A tag with no identifier is legitimate — it reads as unmapped.</Text> : null}
        </View>
      </Field>
      <View style={s.actions}>
        <Press
          onPress={() => onApprove({
            decision: 'approve', label, note: note || null,
            parentKey: parent?.key ?? null,
            categoryKey: category ?? parent?.categoryKey ?? null,
            kind: proposal.vocab === 'facet' ? kind : undefined,
            source: qid ? 'wikidata' : null, externalId: qid ?? undefined,
          })}
          disabled={proposal.vocab === 'tag' && !(category ?? parent?.categoryKey)}
          accessibilityRole="button"
          style={[s.primary, proposal.vocab === 'tag' && !(category ?? parent?.categoryKey) && { opacity: 0.4 }]}
        >
          <Text style={s.primaryText}>Approve as “{label}”</Text>
        </Press>
        <Press onPress={onCancel} accessibilityRole="button" style={s.outline}><Text style={s.outlineText}>Cancel</Text></Press>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// the curated lists
// ---------------------------------------------------------------------------
/**
 * Categories and formats: short lists an administrator maintains.
 *
 * Both deactivate rather than delete. A category no longer offered must still
 * render on the offers already carrying it, so switching one off stops it being
 * suggested and leaves those alone; deleting one in use is refused by the API
 * with a count of the offers affected.
 */
function Curated({ kind, rows, canManage, onChanged }: {
  kind: 'category' | 'format';
  rows: any[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const [said, setSaid] = useState<string | null>(null);
  const save = async (key: string, patch: Record<string, unknown>) => {
    setSaid(null);
    try {
      if (kind === 'category') await api.adminSaveSkillCategory({ key, ...patch } as any);
      else await api.adminSaveSkillFormat({ key, ...patch } as any);
      onChanged();
    } catch (e: any) { setSaid(e.message); }
  };
  const remove = async (key: string) => {
    setSaid(null);
    try { await api.adminRemoveSkillValue(kind, key); onChanged(); } catch (e: any) { setSaid(e.message); }
  };

  return (
    <Section
      title={kind === 'category' ? 'Sixteen buckets, in the order a guest scrolls them' : 'What physically happens'}
      right={<Text style={type.small}>{rows.filter((r) => r.active).length} live</Text>}
    >
      {said ? <Text style={[type.small, { paddingTop: 8 }]}>{said}</Text> : null}
      {kind === 'category' ? (
        <Text style={[type.small, { paddingVertical: 6 }]}>
          The row must not grow with the vocabulary. Thousands of tags live behind search, the cards and the tag pages; a filter row that grows stops working by month three.
        </Text>
      ) : null}
      {rows.map((r, i) => (
        <View key={r.key} style={s.row}>
          <Text style={s.pos}>{i + 1}</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.rowLabel, !r.active && { color: colors.inkMuted }]} numberOfLines={1}>{r.label}</Text>
            <Text style={type.small} numberOfLines={1}>{[r.blurb, r.venueless ? 'no venue step' : null, r.seeded ? 'shipped with Epic' : 'added here'].filter(Boolean).join(' · ')}</Text>
          </View>
          <Text style={type.small}>{count(r.offers)} offer{Number(r.offers) === 1 ? '' : 's'}</Text>
          <TextAction label={r.active ? 'Switch off' : 'Switch on'} onPress={() => save(r.key, { active: !r.active })} disabled={!canManage} />
          {!Number(r.offers) ? <TextAction label="Delete" tone="muted" onPress={() => remove(r.key)} disabled={!canManage} /> : null}
        </View>
      ))}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// the open vocabulary
// ---------------------------------------------------------------------------
/** Tags and facets: a few hundred rows, searched rather than scrolled. */
function Vocabulary({ vocab, categories, kinds = [], canManage }: {
  vocab: 'tag' | 'facet';
  categories: SkillCategory[];
  kinds?: string[];
  canManage: boolean;
}) {
  const [q, setQ] = useQueryState<string>('q', '', asText);
  const [all, setAll] = useState(false);
  const [rows, setRows] = useState<SkillVocabRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows((await api.adminSkillVocabulary(vocab, { q, all })).rows); } catch (e: any) { setSaid(e.message); }
  }, [vocab, q, all]);
  useEffect(() => { const t = setTimeout(() => void load(), 150); return () => clearTimeout(t); }, [load]);

  const byCat = useMemo(() => Object.fromEntries(categories.map((c) => [c.key, c.label])), [categories]);
  const unmapped = (rows ?? []).filter((r) => !r.external_id).length;

  return (
    <Section
      title={vocab === 'tag' ? 'What hosts say they are expert in' : 'Places, species, monuments and periods'}
      right={<Choice label={all ? 'Including switched off' : 'Live only'} on={all} onPress={() => setAll(!all)} />}
    >
      <View style={s.searchRow}>
        <Icon name="search" size={15} color={colors.inkMuted} strokeWidth={2} />
        <TextInput value={q} onChangeText={setQ} placeholder={vocab === 'tag' ? 'fossil, sourdough, blacksmith…' : 'Jurassic, orchid, long barrow…'} placeholderTextColor={colors.ghost} style={s.input} />
        <Text style={type.small}>{rows ? `${rows.length} shown` : ''}{unmapped ? ` · ${unmapped} unmapped` : ''}</Text>
      </View>
      {said ? <Text style={type.small}>{said}</Text> : null}
      {(rows ?? []).map((r) => (
        <View key={r.key}>
          <Press onPress={() => setOpen(open === r.key ? null : r.key)} accessibilityRole="button" style={[s.row, open === r.key && { backgroundColor: colors.selected }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[s.rowLabel, open === r.key && { color: colors.selectedFg }, !r.active && { color: colors.inkMuted }]} numberOfLines={1}>{r.label}</Text>
              <Text style={[type.small, open === r.key && { color: colors.selectedFg }]} numberOfLines={1}>
                {[byCat[r.category_key ?? ''], r.parent_label, r.kind].filter(Boolean).join(' › ') || 'top of its category'}
              </Text>
            </View>
            {/* A tag with no external identifier is legitimate; it is said here
                and nowhere a host or a guest can see. */}
            <Text style={[type.small, open === r.key && { color: colors.selectedFg }]}>{r.external_id ?? 'unmapped'}</Text>
            <Text style={[type.small, open === r.key && { color: colors.selectedFg }]}>{count(r.hosts)} host{r.hosts === 1 ? '' : 's'}</Text>
            <Icon name={open === r.key ? 'collapse' : 'more'} size={14} color={open === r.key ? colors.selectedFg : colors.inkMuted} />
          </Press>
          {open === r.key ? <VocabDetail row={r} vocab={vocab} categories={categories} kinds={kinds} canManage={canManage} onSaved={load} /> : null}
        </View>
      ))}
    </Section>
  );
}

function VocabDetail({ row, vocab, categories, kinds, canManage, onSaved }: {
  row: SkillVocabRow; vocab: 'tag' | 'facet'; categories: SkillCategory[]; kinds: string[]; canManage: boolean; onSaved: () => void;
}) {
  const [label, setLabel] = useState(row.label);
  const [note, setNote] = useState(row.note ?? '');
  const [qid, setQid] = useState(row.external_id ?? '');
  const [candidates, setCandidates] = useState<{ qid: string; label: string; description: string | null }[] | null>(null);
  const [suggested, setSuggested] = useState<{ qid: string; label: string | null }[] | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  const save = async (patch: Record<string, unknown>) => {
    setSaid(null);
    try {
      if (vocab === 'tag') await api.adminSaveTag({ key: row.key, ...patch } as any);
      else await api.adminSaveFacet({ key: row.key, ...patch } as any);
      onSaved();
    } catch (e: any) { setSaid(e.message); }
  };

  return (
    <View style={s.detail}>
      <Field label="Epic’s own English — changing it changes it everywhere, and the identifier stays put">
        <TextInput value={label} onChangeText={setLabel} onBlur={() => label.trim() && label !== row.label && save({ label: label.trim() })} style={s.input} />
      </Field>
      <Field label="One line, for the detail sheet a host taps">
        <TextInput value={note} onChangeText={setNote} onBlur={() => note !== (row.note ?? '') && save({ note: note || null })} style={s.input} placeholder="Finding and identifying wild plants, seaweed and fungi that are safe to eat." placeholderTextColor={colors.ghost} />
      </Field>
      {vocab === 'tag' ? (
        <Field label="Which bucket it reads under">
          <View style={s.wrap}>
            {categories.map((c) => <Choice key={c.key} label={c.label} on={row.category_key === c.key} onPress={canManage ? () => save({ categoryKey: c.key }) : undefined} />)}
          </View>
        </Field>
      ) : (
        <Field label="What kind of thing it is">
          <View style={s.wrap}>
            {kinds.map((k) => <Choice key={k} label={k} on={row.kind === k} onPress={canManage ? () => save({ kind: k }) : undefined} />)}
          </View>
        </Field>
      )}
      <Field label="The identifier — a QID where one fits, blank where none does">
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <TextInput value={qid} onChangeText={setQid} onBlur={() => qid !== (row.external_id ?? '') && save({ externalId: qid || null, source: qid ? 'wikidata' : null })} style={[s.input, { flex: 0, minWidth: 120 }]} placeholder="Q12345" placeholderTextColor={colors.ghost} />
            <TextAction label="Find it" onPress={async () => { try { setCandidates((await api.adminSkillCandidates(row.label)).candidates); } catch (e: any) { setSaid(e.message); } }} disabled={!canManage} />
            {row.external_id ? <TextAction label="What Wikidata calls its parents" onPress={async () => { try { setSuggested((await api.adminSkillParents(row.external_id!)).parents); } catch (e: any) { setSaid(e.message); } }} disabled={!canManage} /> : null}
          </View>
          {(candidates ?? []).map((c) => (
            <Press key={c.qid} onPress={() => { setQid(c.qid); void save({ externalId: c.qid, source: 'wikidata' }); }} accessibilityRole="button" style={s.candidate}>
              <Text style={[type.small, { fontWeight: '700' }]}>{c.label} · {c.qid}</Text>
              {c.description ? <Text style={type.small}>{c.description}</Text> : null}
            </Press>
          ))}
          {suggested ? (
            <Text style={type.small}>
              Wikidata puts it under {suggested.map((p) => p.label ?? p.qid).join(', ') || 'nothing'} — a suggestion only. The parent Epic uses is the one you set, because the class graph has cycles and a walk of it pulls in branches nobody meant.
            </Text>
          ) : null}
        </View>
      </Field>
      <View style={s.actions}>
        <TextAction label={row.active ? 'Switch off — existing offers keep it' : 'Switch on'} onPress={() => save({ active: !row.active })} disabled={!canManage} />
        <Text style={type.small}>{count(row.offers)} offer{row.offers === 1 ? '' : 's'} · seen {count(row.seen_count)}</Text>
      </View>
      {said ? <Text style={type.small}>{said}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// credentials
// ---------------------------------------------------------------------------
/**
 * Evidence, and never expertise.
 *
 * A type that requires evidence does not display on a host's page until
 * somebody here confirms it, and then displays with the date; one that does not
 * displays as the host's own claim, labelled as stated. A refusal stops it
 * displaying, tells the host, and keeps the record. None of it is a trust rung:
 * `hosts.trust` is the only ladder and it is set on the Hosting screen.
 */
/** The three kinds of host (079), in the owner's own words for them. */
const HOST_TYPES = [
  { key: 'skill', label: 'I have a skill' },
  { key: 'meetups', label: 'Meetups and mini tours' },
  { key: 'expert', label: 'Expert guide' },
];
const toggle = (list: string[], key: string) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);

function Credentials({ canManage, onChanged, categories }: { canManage: boolean; onChanged: () => void; categories: SkillCategory[] }) {
  const [types, setTypes] = useState<CredentialType[]>([]);
  const [waiting, setWaiting] = useState<CredentialWaiting[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await api.adminCredentials(); setTypes(r.types); setWaiting(r.waiting); } catch (e: any) { setSaid(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const decide = async (id: string, state: 'confirmed' | 'rejected') => {
    setSaid(null);
    try { await api.adminDecideCredential(id, { state }); await load(); onChanged(); } catch (e: any) { setSaid(e.message); }
  };
  /** A rule change is a write of the whole row, so the rest of it travels with the change. */
  const save = async (t: CredentialType, patch: Partial<CredentialType>) => {
    setSaid(null);
    try { await api.adminSaveCredentialType({ ...t, ...patch }); await load(); onChanged(); } catch (e: any) { setSaid(e.message); }
  };

  return (
    <View style={{ gap: spacing.lg }}>
      <Section title="Waiting to be confirmed" right={<Text style={type.small}>{waiting.length}</Text>}>
        {said ? <Text style={type.small}>{said}</Text> : null}
        {!waiting.length ? <Text style={[type.small, { paddingVertical: spacing.md }]}>Nothing waiting. A credential shows to a guest only once somebody here has seen the evidence.</Text> : null}
        {waiting.map((c) => (
          <View key={c.id} style={s.row}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.rowLabel} numberOfLines={1}>{c.host_name} · {c.label}</Text>
              <Text style={type.small} numberOfLines={1}>{[c.reference, c.detail, ago(c.created_at)].filter(Boolean).join(' · ')}</Text>
            </View>
            <TextAction label="Confirm" onPress={() => decide(c.id, 'confirmed')} disabled={!canManage} />
            <TextAction label="Refuse" tone="muted" onPress={() => decide(c.id, 'rejected')} disabled={!canManage} />
          </View>
        ))}
      </Section>

      <Section title="The credentials Epic asks about">
        <Text style={[type.small, { paddingVertical: 6 }]}>
          A credential is evidence, not expertise — it never goes in the tag list and it is never a rung on the trust ladder.
          Every one of these ships as a badge. Making one a **condition** of hosting is a decision about one kind of activity, and a
          browse category is a bucket of sixteen: a food business registration is the law for cooking for people who pay, and not
          for a wine-tasting walk. Set one and it is enforced at Publish; where a category is guarded by more than one, any of them clears it.
        </Text>
        {types.map((t) => (
          <View key={t.key}>
            <Press onPress={() => setOpen(open === t.key ? null : t.key)} accessibilityRole="button" style={[s.row, open === t.key && { backgroundColor: colors.selected }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[s.rowLabel, open === t.key && { color: colors.selectedFg }, !t.active && { color: colors.inkMuted }]} numberOfLines={1}>{t.label}</Text>
                <Text style={[type.small, open === t.key && { color: colors.selectedFg }]} numberOfLines={2}>
                  {[t.note, (t.host_types ?? []).join(', '), t.evidence_required ? 'evidence seen before it shows' : 'the host’s own claim, labelled as stated',
                    (t.gates_categories ?? []).length ? `a condition of hosting in ${(t.gates_categories ?? []).join(', ')}` : 'a badge',
                    t.expires_months ? `asked again after ${t.expires_months} months` : 'does not expire'].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Icon name={open === t.key ? 'collapse' : 'more'} size={14} color={open === t.key ? colors.selectedFg : colors.inkMuted} />
            </Press>
            {open === t.key ? (
              <View style={s.detail}>
                <Field label="Who is asked about it">
                  <View style={s.wrap}>
                    {HOST_TYPES.map((h) => (
                      <Choice
                        key={h.key} label={h.label} on={(t.host_types ?? []).includes(h.key)}
                        onPress={canManage ? () => save(t, { host_types: toggle(t.host_types ?? [], h.key) }) : undefined}
                      />
                    ))}
                  </View>
                </Field>
                <Field label="Do we check it?">
                  <View style={s.wrap}>
                    <Choice label="We see the evidence first" on={t.evidence_required} onPress={canManage ? () => save(t, { evidence_required: true }) : undefined} />
                    <Choice label="Their own words, labelled as stated" on={!t.evidence_required} onPress={canManage ? () => save(t, { evidence_required: false }) : undefined} />
                  </View>
                  {!t.evidence_required && (t.gates_categories ?? []).length ? (
                    <Text style={type.small}>
                      A condition nobody checks is a weak one: a host clears it by saying they have it.
                    </Text>
                  ) : null}
                </Field>
                <Field label="A condition of hosting in — leave empty and it is a badge">
                  <View style={s.wrap}>
                    {categories.map((c) => (
                      <Choice
                        key={c.key} label={c.label} on={(t.gates_categories ?? []).includes(c.key)}
                        onPress={canManage ? () => save(t, { gates_categories: toggle(t.gates_categories ?? [], c.key) }) : undefined}
                      />
                    ))}
                  </View>
                </Field>
                <Field label="How long a confirmation lasts">
                  <View style={s.wrap}>
                    {[null, 12, 24, 36, 60].map((m) => (
                      <Choice
                        key={String(m)} label={m ? `${m} months` : 'It does not expire'} on={(t.expires_months ?? null) === m}
                        onPress={canManage ? () => save(t, { expires_months: m }) : undefined}
                      />
                    ))}
                  </View>
                </Field>
                <TextAction label={t.active ? 'Switch off — nobody is asked about it again' : 'Switch on'} onPress={() => save(t, { active: !t.active })} disabled={!canManage} />
              </View>
            ) : null}
          </View>
        ))}
      </Section>
    </View>
  );
}

// ---------------------------------------------------------------------------
// the source register
// ---------------------------------------------------------------------------
/**
 * Where each vocabulary came from, what it obliges us to say, and whether the
 * data itself may be kept.
 *
 * Drawn like `Sources.tsx`: a row is the fact and a count, and nothing is
 * repeated per source. **None of these is a runtime dependency** — the only
 * outward call in the skills work is an administrator asking Wikidata for a
 * candidate identifier, which is ledgered like every other.
 */
function Sources({ rows }: { rows: VocabularySource[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Section title="Where the words came from" right={<Text style={type.small}>{rows.length}</Text>}>
      <Text style={[type.small, { paddingVertical: 6 }]}>
        We take identifiers and write our own labels, so “may be kept” is no far more often than a reader expects. Only the CC BY and ODC-By sources oblige us to say anything on screen, and never Wikidata, which is CC0.
      </Text>
      {rows.map((r) => (
        <View key={r.key}>
          <Press onPress={() => setOpen(open === r.key ? null : r.key)} accessibilityRole="button" style={s.row}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.rowLabel} numberOfLines={1}>{r.label}</Text>
              <Text style={type.small} numberOfLines={1}>{r.what_we_take}</Text>
            </View>
            <Text style={type.small}>{r.licence}</Text>
            <Text style={type.small}>{count(r.tags + r.facets)} words</Text>
            <Icon name={open === r.key ? 'collapse' : 'more'} size={14} color={colors.inkMuted} />
          </Press>
          {open === r.key ? (
            <View style={s.detail}>
              {r.attribution ? <Field label="The exact wording the licence requires"><Text style={type.small}>{r.attribution}</Text></Field> : null}
              <Field label="May the data itself be kept?"><Text style={type.small}>{r.may_retain ? 'Yes — it loads into our own tables.' : 'No. We take an identifier and write our own label.'}</Text></Field>
              {r.resolves ? <Field label="How it is read"><Text style={type.small}>{r.resolves}</Text></Field> : null}
              {r.note ? <Text style={type.small}>{r.note}</Text> : null}
              <Text style={type.small}>{r.last_refreshed ? `Last refreshed ${ago(r.last_refreshed)}.` : 'Never refreshed since it was imported.'}</Text>
            </View>
          ) : null}
        </View>
      ))}
    </Section>
  );
}

// ---------------------------------------------------------------------------
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.kicker}>{label}</Text>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  controls: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingBottom: 4, flexWrap: 'wrap' },
  kicker: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '700', color: colors.inkMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  rowLabel: { ...type.small, fontWeight: '700', color: colors.ink },
  pos: { ...type.small, color: colors.inkMuted, width: 20, fontVariant: ['tabular-nums'] },
  detail: { gap: 12, paddingVertical: 12, paddingLeft: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  input: { flex: 1, ...type.small, color: colors.ink, paddingVertical: 6, outlineStyle: 'none' as any },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },

  proposal: { gap: 5, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  proposalHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  term: { fontSize: 17, fontWeight: '800', letterSpacing: -0.34, color: colors.ink },
  times: { ...type.small, fontWeight: '700', color: colors.accent },
  targetRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  targetLabel: { ...type.small, fontWeight: '600', color: colors.ink },
  candidate: { gap: 2, paddingVertical: 7, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },

  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10, flexWrap: 'wrap' },
  /** The one filled button. */
  primary: { backgroundColor: LIME, paddingHorizontal: 16, paddingVertical: 9 },
  primaryText: { ...type.small, fontWeight: '700', color: INK },
  /** Edit and Reject: 1px ink, ink type. Red is retired (owner, 13 Sep 2026). */
  outline: { borderWidth: 1, borderColor: colors.line, paddingHorizontal: 16, paddingVertical: 9 },
  outlineText: { ...type.small, fontWeight: '600', color: colors.ink },
});
