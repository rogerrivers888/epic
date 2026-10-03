/**
 * Wording (Markets › Wording). Epic — Markets design v2.2, step 4 increment 3.
 *
 * Not translation: en-GB and en-US, and a rule for choosing. Blank means one
 * thing only — someone looked and judged the two the same; an untouched key
 * reads "Not looked at", never blank. "Not applicable here" is one phrase for
 * the action, the status and the count of a subcategory Epic does not offer in
 * the US at all. No bulk "mark all the same" — deliberately.
 *
 * The screen draws what the API gives (`GET /api/admin/desk/wording/:ns`); the
 * status, counts and "what's left" are the API's.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';

import { useDeskParam, useCrumbs } from './Desk';
import {
  AMBER, LIME, Muted, deskApi, desk, fonts, useToast,
  InfoTip, PageTitle, T, Table, THead, TRow, TCell, TextLink, tableWidth, type TCol,
} from './kit';

type Status = 'same' | 'not-looked-at' | 'changed' | 'needs-review' | 'drift' | 'not-applicable';
type WordRow = {
  namespace: string; key: string; subcategory: string | null;
  enGB: string; enUS: string | null; suggestion: string | null; machineAllowed: boolean;
  status: Status; left: boolean; usCount: number | null;
};

const NAMESPACES: { id: string; name: string }[] = [
  { id: 'interface', name: 'Interface' },
  { id: 'places', name: 'Places & facts' },
  { id: 'collection', name: 'Collection copy' },
];

const STATUS_TEXT: Record<Status, string> = {
  'same': '', 'not-looked-at': 'Not looked at', 'changed': 'Changed',
  'needs-review': 'Needs review', 'drift': 'Needs review · English changed', 'not-applicable': 'Not applicable here',
};
const statusTone = (s: Status) => (s === 'needs-review' || s === 'drift' ? AMBER : s === 'not-looked-at' ? desk.inkMuted : desk.ink);

/** The US count line under a subcategory key — "not applicable here" is never 0. */
function countLine(r: WordRow): { text: string; tone: string } | null {
  if (r.usCount == null) return null;
  if (r.status === 'not-applicable') return { text: 'not applicable here', tone: desk.inkDim };
  if (r.usCount === 0) return { text: '0 places in the US', tone: AMBER };
  return { text: `${r.usCount.toLocaleString()} places in the US`, tone: desk.inkDim };
}

export function Wording({ canManage }: { canManage: boolean }) {
  const toast = useToast();
  useCrumbs([], []);
  const [ns] = useDeskParam('ns');
  const active = NAMESPACES.some((x) => x.id === ns) ? ns : 'interface';
  const [rows, setRows] = useState<Record<string, WordRow[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [onlyLeft, setOnlyLeft] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // Only the newest refresh applies, so a stale reload (after a rapid action)
  // cannot overwrite a newer one.
  const reqRef = useRef(0);
  const load = useCallback(() => {
    const seq = reqRef.current + 1;
    reqRef.current = seq;
    Promise.all(NAMESPACES.map((x) => deskApi.get<{ wording: WordRow[] }>(`/wording/${x.id}`).then((d) => [x.id, d.wording] as const)))
      .then((pairs) => { if (seq === reqRef.current) { setRows(Object.fromEntries(pairs)); setError(null); } })
      .catch((err) => { if (seq === reqRef.current) setError((err as Error)?.message || 'Wording did not load.'); });
  }, []);
  useEffect(() => { load(); return () => { reqRef.current += 1; }; }, [load]);

  const go = useDeskParam('ns')[1];
  const dk = (r: WordRow) => `${r.namespace}/${r.key}`;
  // Clear a draft after it lands. With `expect`, only clear if the draft is
  // still what was saved — an edit typed while the save was in flight survives.
  const clearDraft = (key?: string, expect?: string) => {
    if (!key) return;
    setDrafts((d) => {
      // Clear only if the draft is still what it was when the action started
      // (`expect` undefined = there was none) — an edit typed during the request
      // survives, whether or not a draft existed at the click.
      if (d[key] !== expect) return d;
      const { [key]: _drop, ...rest } = d;
      return rest;
    });
  };
  const post = async (path: string, body: object, done: string, opts: { undoable?: boolean; clearKey?: string; expect?: string } = {}) => {
    const { undoable = true, clearKey, expect } = opts;
    try {
      const res = await deskApi.post<{ change?: string }>(path, body);
      clearDraft(clearKey, expect);
      load();
      if (undoable && res.change) {
        const id = res.change;
        toast(done, async () => { try { await deskApi.post(`/undo/${id}`, {}); clearDraft(clearKey, expect); load(); } catch (e) { toast((e as Error)?.message || 'Could not undo that.'); } });
      } else toast(done);
    } catch (err) { toast((err as Error)?.message || 'That did not save.'); }
  };

  if (error) return <Muted>{error}</Muted>;
  if (!rows[active]) return <Muted>Loading…</Muted>;

  const all = rows[active];
  const shown = onlyLeft ? all.filter((r) => r.left) : all;
  const leftOf = (id: string) => (rows[id] ?? []).filter((r) => r.left).length;
  const counts = {
    keys: all.length,
    notLooked: all.filter((r) => r.status === 'not-looked-at').length,
    changed: all.filter((r) => r.status === 'changed').length,
    review: all.filter((r) => r.status === 'needs-review' || r.status === 'drift').length,
    na: all.filter((r) => r.status === 'not-applicable').length,
  };

  const cols: TCol<string>[] = [
    { key: 'key', name: 'Key', width: 220 },
    { key: 'engb', name: 'en-GB', width: 260 },
    { key: 'enus', name: 'en-US', width: 260 },
    { key: 'status', name: 'Status', width: 220 },
  ];

  const commit = (r: WordRow) => {
    const draft = drafts[dk(r)];
    if (draft == null || draft === (r.enUS ?? '')) return;
    post(`/wording/${r.namespace}/${encodeURIComponent(r.key)}`, { enUS: draft }, `${r.key} · en-US saved`, { clearKey: dk(r), expect: draft });
  };

  return (
    <View style={{ gap: 16 }}>
      <PageTitle tip="Every user-visible string in en-GB and en-US, and a rule for choosing. Blank means someone looked and it is the same; an untouched key reads Not looked at.">Wording</PageTitle>

      {/* Namespace tabs, each showing what is left to look at. */}
      <View style={{ flexDirection: 'row', gap: 20 }}>
        {NAMESPACES.map((x) => {
          const on = x.id === active;
          const left = leftOf(x.id);
          return (
            <TextLink key={x.id} tone={on ? desk.ink : desk.inkDim} onPress={() => go(x.id)}>
              {`${x.name}${left ? ` · ${left} left` : ''}`}
            </TextLink>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
        <T tone={desk.inkDim} size={12.5}>{counts.keys} keys · {counts.notLooked} not looked at · {counts.changed} changed · {counts.review} needs review · {counts.na} not applicable</T>
        <TextLink tone={onlyLeft ? desk.link : desk.inkDim} onPress={() => setOnlyLeft((v) => !v)}>{onlyLeft ? '✓ ' : ''}Only what's left to look at</TextLink>
      </View>

      <Table width={tableWidth(cols, 22)}>
        <THead cols={cols} sort={{ key: 'key', dir: 'asc' }} onSort={() => {}} gap={22} />
        {shown.map((r) => {
          const cl = countLine(r);
          const na = r.status === 'not-applicable';
          const draftVal = drafts[dk(r)] ?? (r.enUS ?? '');
          return (
            <TRow key={r.key} gap={22} vpad={11} align="flex-start">
              <TCell width={220}>
                <View>
                  <T size={12.5} tone={desk.inkDim}>{r.key}</T>
                  {cl ? <T size={11.5} tone={cl.tone}>{cl.text}</T> : null}
                </View>
              </TCell>
              <TCell width={260}><T tone={na ? desk.inkFaint : desk.ink}>{r.enGB}</T></TCell>
              <TCell width={260}>
                {na
                  ? <T tone={desk.inkDim}>not applicable here</T>
                  : canManage
                    ? (
                      <TextInput
                        value={draftVal}
                        placeholder={r.suggestion ? `Suggested: ${r.suggestion}` : ''}
                        placeholderTextColor={desk.inkFaint}
                        onChangeText={(t) => setDrafts((d) => ({ ...d, [dk(r)]: t }))}
                        // Enter to save — not on blur, so clicking a row action
                        // (Same in both, Not applicable) never races an autosave.
                        onSubmitEditing={() => commit(r)}
                        style={{ fontFamily: fonts.body, fontSize: 13.5, color: desk.ink, paddingVertical: 2, paddingHorizontal: 6, backgroundColor: desk.well, borderWidth: 1, borderColor: desk.rule, minWidth: 240 }}
                      />
                    )
                    : <T tone={desk.inkMuted}>{r.enUS ?? (r.suggestion ? `Suggested: ${r.suggestion}` : '')}</T>}
              </TCell>
              <TCell width={220}>
                <View style={{ gap: 4 }}>
                  {STATUS_TEXT[r.status] ? <T tone={statusTone(r.status)} size={12.5}>{STATUS_TEXT[r.status]}</T> : <T tone={desk.inkFaint} size={12.5}>—</T>}
                  {canManage ? (
                    <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
                      {/* Each row decision clears the row's draft (the new server
                          value stands), but preserves an edit typed while the
                          request was in flight — `expect` is the draft at click. */}
                      {r.status === 'needs-review' && r.suggestion
                        ? <TextLink tone={desk.link} onPress={() => post(`/wording/${r.namespace}/${encodeURIComponent(r.key)}`, { enUS: r.suggestion }, `${r.key} · suggestion used`, { clearKey: dk(r), expect: drafts[dk(r)] })}>Use suggestion</TextLink> : null}
                      {/* "Same in both" is the looked-at-and-fine path, and the reject path
                          for a suggestion — offered for any not-looked-at or suggested key,
                          subcategories included. */}
                      {(r.status === 'not-looked-at' || r.status === 'needs-review')
                        ? <TextLink onPress={() => post(`/wording/${r.namespace}/${encodeURIComponent(r.key)}/same`, {}, `${r.key} · same in both`, { clearKey: dk(r), expect: drafts[dk(r)] })}>Same in both</TextLink> : null}
                      {r.status === 'drift'
                        ? <TextLink onPress={() => post(`/wording/${r.namespace}/${encodeURIComponent(r.key)}`, { enUS: r.enUS ?? '' }, `${r.key} · still right`, { clearKey: dk(r), expect: drafts[dk(r)] })}>Still right</TextLink> : null}
                      {r.subcategory && !na && !r.enUS
                        ? <TextLink tone={AMBER} onPress={() => post(`/wording/${r.namespace}/${encodeURIComponent(r.key)}/not-applicable`, { applicable: false }, `${r.subcategory} · not applicable here`, { clearKey: dk(r), expect: drafts[dk(r)] })}>Not applicable here</TextLink> : null}
                      {na
                        ? <TextLink onPress={() => post(`/wording/${r.namespace}/${encodeURIComponent(r.key)}/not-applicable`, { applicable: true }, `${r.subcategory} · applies in the US again`, { clearKey: dk(r), expect: drafts[dk(r)] })}>Applies again</TextLink> : null}
                    </View>
                  ) : null}
                </View>
              </TCell>
            </TRow>
          );
        })}
      </Table>
      {active === 'collection' ? (
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <T tone={desk.inkDim} size={12.5}>Written by a person only.</T>
          <InfoTip text="Collection copy — the voice of the product — is never machine-written, in any variant. An American line is written by a real American, or the British line shows meanwhile." />
        </View>
      ) : null}
    </View>
  );
}
