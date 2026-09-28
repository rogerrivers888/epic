/**
 * One subcategory's page (README v2 "Subcategory page"): its defaults, then
 * the facts Epic looks for there, filtered All · Active · Gathering evidence
 * · Ignored. Address: `?tab=categories&sub=<key>` (`state` sets the pill).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Text, View, type ViewStyle } from 'react-native';

import { Press } from '../../../components/press';
import { useViewport } from '../../../hooks/useViewport';
import { useCrumbs, useDeskGo, useDeskParam } from '../Desk';
import { AMBER, LIME, Muted, Table, deskApi, desk, fonts, ago, n, saidOf, tabular, useToast } from '../kit';
import { Count, FACT_ORDER, Failed, HowTip, OptPill, PillBar, factName, undoChanges, type Change, type Option } from './shared';

type DefaultRow = {
  fact: string; label: string; value: string | null; setBy: string | null; setAt: string | null;
  origin: 'person' | 'machine' | null; basis: string | null; contradicted: boolean; contradiction: string | null;
  options: Option[];
};
type FactRow = {
  fact: string; label: string; status: 'active' | 'gathering' | 'ignored'; reason: string | null; isNew: boolean;
  /** Stored Active but confirmed at fewer than `needed` places: shown as Gathering evidence. */
  demoted?: boolean;
  placesWith: number; verifiedPlaces: number; firstSeen: string | null; removedBy: string | null;
};
export type SubPageData = {
  key: string; label: string; category: string; categoryLabel: string;
  defaults: DefaultRow[]; facts: FactRow[]; places: number; secondaryPlaces: number;
  live: number; fresh: number; needed: number | null;
  related: { key: string; label: string; why: string }[];
  /** The places filed here as a second subcategory we may name, with their primary. */
  secondaryList?: { ref: string; name: string; primary: string }[];
  /** Copy facts from another subcategory: those with Active facts, and how many. */
  copyFrom?: { key: string; label: string; n: number }[];
};

/** Held at the left edge of a table that scrolls sideways, so it stays in the frame (web). */
const STICK_LEFT = (Platform.OS === 'web' ? { position: 'sticky', left: 0 } : {}) as unknown as ViewStyle;

type Pill = 'all' | 'active' | 'gathering' | 'ignored';
const PILLS: { key: Pill; name: string }[] = [
  { key: 'all', name: 'All' }, { key: 'active', name: 'Active' }, { key: 'gathering', name: 'Gathering evidence' }, { key: 'ignored', name: 'Ignored' },
];
const STATUS: Record<FactRow['status'], string> = { active: 'Active', gathering: 'Gathering evidence', ignored: 'Ignored' };
const REASON: Record<string, string> = {
  on_nearly_every_place: 'On nearly every place', an_opinion: 'An opinion', a_condition: 'A condition', removed_by_a_person: 'Removed by a person',
};

/** "19 Sep" — three letters, as the prototype writes it (en-GB would say "Sept"). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (at: string) => { const d = new Date(at); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };

export function SubPage({ sub, canManage }: { sub: string; canManage: boolean }) {
  const go = useDeskGo();
  const toast = useToast();
  const [state, setState] = useDeskParam('state');
  const pill: Pill = (['active', 'gathering', 'ignored'] as string[]).includes(state) ? (state as Pill) : 'all';
  const [data, setData] = useState<SubPageData | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const vw = useViewport().width;
  const phone = vw < 900; // where the Defaults table scrolls sideways (kit `Table`)
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let live = true;
    setErr(null);
    deskApi.get<SubPageData>(`/subcategories/${encodeURIComponent(sub)}`).then((d) => { if (live) setData(d); }).catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [sub, tick]);

  const name = data?.label ?? '';
  useCrumbs([{ name: 'Categories', go: () => go('categories') }, { name: name || '…' }], [name, sub]);

  if (err) return <Failed err={err} />;
  if (!data) return <Muted>Loading</Muted>;

  const setDefault = async (d: DefaultRow, o: Option) => {
    setEditing(null);
    try {
      const out = await deskApi.post<{ changes: Change[] }>('/categories/defaults', { subs: [sub], fact: d.fact, option: o.key });
      toast(`${factName(d.fact, d.label)} set to ${o.label} on ${data.label}`, () => undoChanges(out.changes.map((c) => c.id), toast, reload));
      reload();
    } catch (e) { toast(saidOf(e)); }
  };
  const accept = async (d: DefaultRow) => {
    try {
      const c = await deskApi.post<Change>(`/subcategories/${encodeURIComponent(sub)}/defaults/${encodeURIComponent(d.fact)}/accept`);
      toast(`${factName(d.fact, d.label)} accepted on ${data.label}`, () => undoChanges([c.id], toast, reload));
      reload();
    } catch (e) { toast(saidOf(e)); }
  };
  const copyFrom = async (o: { key: string; label: string }) => {
    setCopying(false);
    try {
      const c = await deskApi.post<Change & { copied: number }>(`/subcategories/${encodeURIComponent(sub)}/copy-facts`, { from: o.key });
      toast(`${c.copied} ${c.copied === 1 ? 'fact' : 'facts'} copied from ${o.label}`, () => undoChanges([c.id], toast, reload));
      reload();
    } catch (e) { toast(saidOf(e)); }
  };
  const remove = async (f: FactRow) => {
    try {
      const c = await deskApi.post<Change>(`/subcategories/${encodeURIComponent(sub)}/facts/${encodeURIComponent(f.fact)}/remove`);
      toast(`${f.label} removed from ${data.label} · it stays removed`, () => undoChanges([c.id], toast, reload));
      reload();
    } catch (e) { toast(saidOf(e)); }
  };

  const count = (k: Pill) => data.facts.filter((f) => k === 'all' || f.status === k).length;
  const facts = data.facts.filter((f) => pill === 'all' || f.status === pill);
  const needed = data.needed;
  const progress = (f: FactRow) => (needed == null ? '—'
    : `Confirmed at ${f.verifiedPlaces} of ${needed} places needed${f.firstSeen ? ` · first seen ${shortDate(f.firstSeen)}` : ''}`);
  const why = (f: FactRow) => (f.reason === 'removed_by_a_person' ? `Removed by ${f.removedBy ?? 'a person'}` : (f.reason ? REASON[f.reason] ?? 'Ignored' : 'Ignored'));

  // Defaults: 150 · 130 · 150 · 280+ · 170 on a 24px gap (the prototype's grid).
  const DG = 24;
  const dW = [150, 130, 150, 300, 170];
  const defaultsW = dW.reduce((s, w) => s + w, 0) + DG * (dW.length - 1) + 16;
  const fW = [250, 230, 340];
  const factsW = fW.reduce((s, w) => s + w, 0) + 18 * 2 + 16;

  return (
    <View style={{ gap: 14 }}>
      <View style={{
        flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24,
        borderBottomWidth: 2, borderBottomColor: desk.ruleStrong, paddingBottom: 18, zIndex: 20,
      }}>
        <View style={{ gap: 6, flexShrink: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={{ fontFamily: fonts.heading, fontWeight: '800', fontSize: 31, letterSpacing: -1.085, lineHeight: 32, color: desk.ink, flexShrink: 1 }}>{data.label}</Text>
            <HowTip text="Defaults are assumed for a place here until a person or one of our sources says otherwise. Facts are what Epic looks for at every place in this subcategory." />
          </View>
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>{data.categoryLabel} › {data.label}</Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 30, maxWidth: '100%', flexShrink: 1 }}>
          <Count label="Places" n={n(data.places)} align="flex-start" />
          <Count label="Looking for" n={n(data.live)} align="flex-start" weight="600" />
          <Count label="New · 30 days" n={n(data.fresh)} align="flex-start" />
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Text style={{ fontFamily: fonts.heading, fontSize: 10, fontWeight: '700', letterSpacing: 0.7, color: desk.inkDim }}>VIEW</Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: desk.ink }}>Whole estate</Text>
          </View>
        </View>
      </View>

      {data.secondaryPlaces > 0 || data.related.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 6 }}>
          {data.secondaryPlaces > 0 ? (
            <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkMuted }}>
              {data.secondaryPlaces} {data.secondaryPlaces === 1 ? 'place is' : 'places are'} filed here as a second subcategory
              {(data.secondaryList ?? []).map((p) => ` · ${p.name} (primary: ${p.primary})`).join('')}
              {data.secondaryPlaces > (data.secondaryList ?? []).length && (data.secondaryList ?? []).length
                ? ` · and ${n(data.secondaryPlaces - (data.secondaryList ?? []).length)} more` : ''}
            </Text>
          ) : null}
          {data.related.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 4 }}>
              <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>Related subcategories</Text>
              {data.related.map((r) => (
                <Press key={r.key} effect="none" onPress={() => go('categories', { sub: r.key })}>
                  <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: desk.ink, borderBottomWidth: 1, borderBottomColor: desk.ruleStrong }}>{r.label}</Text>
                </Press>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 22, rowGap: 10 }}>
        <PillBar options={PILLS.map((p) => ({ key: p.key, name: `${p.name} · ${count(p.key)}` }))} value={pill} onChange={(k) => setState(k === 'all' ? '' : k, { replace: true })} />
        {canManage ? (
          <Press effect="none" onPress={() => setCopying((c) => !c)}>
            <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: desk.inkMuted }}>Copy facts from another subcategory</Text>
          </Press>
        ) : null}
      </View>

      {/* Defaults */}
      <View style={{ marginTop: 12, gap: 0 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 14, paddingBottom: 8 }}>
          <Text style={{ fontFamily: fonts.heading, fontSize: 10, fontWeight: '700', letterSpacing: 0.7, color: desk.inkDim }}>DEFAULTS</Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: desk.inkDim }}>assumed for a place until a person or source says otherwise</Text>
        </View>
        <Table width={defaultsW}>
          <View style={{ flexDirection: 'row', gap: DG, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: desk.ruleStrong, paddingHorizontal: 8, paddingBottom: 9 }}>
            {['Fact', 'Default', 'Set by', 'Basis', ''].map((h, i) => (
              <Text key={i} style={{ width: dW[i], fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600', color: desk.inkDim }}>{h}</Text>
            ))}
          </View>
          {[...data.defaults].sort((a, b) => FACT_ORDER.indexOf(a.fact) - FACT_ORDER.indexOf(b.fact)).map((d) => {
            const person = d.origin === 'person';
            const machine = d.origin === 'machine';
            const isEditing = editing === d.fact;
            const current = d.options.find((o) => o.label === d.value)?.key ?? null;
            // Change opens the values in place across Default, Set by and Basis, so
            // the six age bands and All ages lie in a row or two rather than a
            // stack in the Default column (decision, fix pass 28 Sep).
            const spanW = dW[1] + dW[2] + dW[3] + DG * 2;
            // On a phone the values open under the row, held at the frame's
            // left edge, never across columns scrolled out of view (audit, 28 Sep).
            const inRow = isEditing && !phone;
            const pills = d.options.map((o) => <OptPill key={o.key} label={o.label} on={o.key === current} onPress={() => setDefault(d, o)} />);
            return (
              <View key={d.fact} style={{ borderBottomWidth: 1, borderBottomColor: desk.rule }}>
              <View style={{ flexDirection: 'row', gap: DG, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 8 }}>
                <Text style={{ width: dW[0], fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: desk.ink }}>{factName(d.fact, d.label)}</Text>
                {inRow ? (
                  <View style={{ width: spanW, flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>{pills}</View>
                ) : null}
                {!inRow ? (
                  <Text style={{ width: dW[1], fontFamily: fonts.body, fontSize: 13.5, fontWeight: '700', color: d.value == null ? desk.inkDim : person ? desk.ink : desk.inkMuted }}>{d.value ?? 'Not set'}</Text>
                ) : null}
                {!inRow ? (
                  <Text style={{ width: dW[2], fontFamily: fonts.body, fontSize: 12.5, color: person ? desk.ink : desk.inkDim }}>
                    {person ? `${d.setBy ?? 'A person'} · ${ago(d.setAt)}` : machine ? 'Machine · proposed' : '—'}
                  </Text>
                ) : null}
                {!inRow ? (
                  <View style={{ width: dW[3], flexDirection: 'row', flexWrap: 'wrap', columnGap: 10 }}>
                    <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>{d.basis ?? '—'}</Text>
                    {d.contradicted && d.contradiction ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: AMBER }}>{d.contradiction} ·</Text>
                        <Press effect="none" onPress={() => go('categories', { sub, fact: d.fact, view: 'review' })}>
                          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: AMBER, borderBottomWidth: 1.5, borderBottomColor: AMBER }}>Review</Text>
                        </Press>
                      </View>
                    ) : null}
                  </View>
                ) : null}
                <View style={{ width: dW[4], flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
                  {canManage && machine && d.value != null ? (
                    <Press effect="none" onPress={() => accept(d)}>
                      <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: LIME, borderBottomWidth: 1.5, borderBottomColor: LIME, paddingBottom: 1 }}>Accept</Text>
                    </Press>
                  ) : null}
                  {canManage ? (
                    <Press effect="none" onPress={() => setEditing(isEditing ? null : d.fact)}>
                      <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: desk.inkMuted, borderWidth: 1, borderColor: desk.ruleStrong, paddingVertical: 4, paddingHorizontal: 10 }}>
                        {isEditing ? 'Cancel' : 'Change'}
                      </Text>
                    </Press>
                  ) : null}
                </View>
              </View>
              {isEditing && phone ? (
                <View style={[{ width: Math.max(200, Math.min(defaultsW, vw - 48)), flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingHorizontal: 8, paddingBottom: 12 }, STICK_LEFT]}>{pills}</View>
              ) : null}
              </View>
            );
          })}
        </Table>
      </View>

      {copying ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {(data.copyFrom ?? []).length === 0 ? (
            <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>Nothing to copy.</Text>
          ) : null}
          {(data.copyFrom ?? []).map((o) => (
            <Press key={o.key} effect="none" onPress={() => copyFrom(o)}>
              <Text style={{ borderWidth: 1.5, borderColor: desk.ruleStrong, color: desk.inkMuted, fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', paddingVertical: 5, paddingHorizontal: 11 }}>
                {o.label} · {o.n} {o.n === 1 ? 'fact' : 'facts'}
              </Text>
            </Press>
          ))}
        </View>
      ) : null}

      {/* Facts */}
      <Table width={factsW}>
        <View style={{ flexDirection: 'row', gap: 18, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: desk.ruleStrong, paddingTop: 12, paddingBottom: 9, paddingHorizontal: 8 }}>
          {['Fact', 'Status', 'Places with it'].map((h, i) => (
            <Text key={h} style={{ width: fW[i], fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600', color: desk.inkDim }}>{h}</Text>
          ))}
        </View>
        {facts.length === 0 ? <Muted>No facts yet.</Muted> : null}
        {facts.map((f) => (
          <View key={f.fact} style={{ flexDirection: 'row', gap: 18, alignItems: 'center', paddingVertical: 11, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: desk.rule }}>
            <View style={{ width: fW[0], minWidth: 0 }}>
              <Press effect="none" onPress={f.status === 'active' ? () => go('categories', { sub, fact: f.fact }) : undefined}>
                <Text style={{ fontFamily: fonts.body, fontSize: 13.5, fontWeight: '700', color: desk.ink }}>{f.label}</Text>
              </Press>
            </View>
            <View style={{ width: fW[1], flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontFamily: fonts.body, fontSize: 13, color: desk.inkMuted }}>{STATUS[f.status]}</Text>
              {f.isNew ? (
                <>
                  <Text style={{ fontFamily: fonts.body, fontSize: 13, color: desk.inkMuted }}>New</Text>
                  {canManage ? (
                    <Press effect="none" onPress={() => remove(f)}>
                      <Text style={{ fontFamily: fonts.body, fontSize: 12, fontWeight: '700', color: desk.inkMuted, borderBottomWidth: 1, borderBottomColor: desk.ruleStrong }}>Remove</Text>
                    </Press>
                  ) : null}
                </>
              ) : null}
            </View>
            <View style={{ width: fW[2] }}>
              {f.status === 'active'
                ? <Text style={[{ fontFamily: fonts.body, fontSize: 13.5, fontWeight: '800', color: desk.ink }, tabular]}>{n(f.placesWith)}</Text>
                : <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>{f.status === 'gathering' ? progress(f) : why(f)}</Text>}
            </View>
          </View>
        ))}
      </Table>
    </View>
  );
}

