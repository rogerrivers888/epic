/**
 * One fact at one subcategory: the places that have it (README v2, the fact
 * page's drill-down, reached from a subcategory page). Place · (Answer) ·
 * Area · How we know · Edit; filters country, county, postcode; a search; and
 * "Looked for at 40 places · found at 12". Address:
 * `?tab=categories&sub=<key>&fact=<key>`.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { Press } from '../../../components/press';
import { useViewport } from '../../../hooks/useViewport';
import { useCrumbs, useDeskGo } from '../Desk';
import { Dropdown, LIME, Muted, SearchBox, Table, deskApi, desk, fonts, n, saidOf, tabular, useToast } from '../kit';
import { Failed, OptPill, factName, undoChanges, type Change, type Option } from './shared';

type PlaceRow = {
  ref: string; name: string | null; area: string | null; county: string | null; country: string | null;
  countryCode: string | null; postcode: string | null; how: string | null; answer: string | null; options: Option[];
};
type Places = {
  fact: string; label: string; kind: 'yesno' | 'range' | 'oneof';
  rows: PlaceRow[]; total: number; lookedFor: number; foundAt: number; counties: string[]; countries: string[];
};
type SubHead = { label: string; categoryLabel: string };

/** The first part of a postcode ("SL5 9QR" → "SL5"). */
const outward = (pc: string | null) => (pc ? pc.trim().toUpperCase().split(/\s+/)[0] : null);

export function FactAtSub({ sub, fact, canManage }: { sub: string; fact: string; canManage: boolean }) {
  const go = useDeskGo();
  const toast = useToast();
  const { width } = useViewport();
  const narrow = width < 900;
  const [head, setHead] = useState<SubHead | null>(null);
  const [base, setBase] = useState<Places | null>(null);
  const [data, setData] = useState<Places | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  const [q, setQ] = useState('');
  const [country, setCountry] = useState<string | null>(null);
  const [county, setCounty] = useState<string | null>(null);
  const [postcode, setPostcode] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  // The subcategory's name and path, and every place with the fact here
  // (the filters' options and the header's count come from this).
  useEffect(() => {
    let live = true;
    setErr(null);
    Promise.all([
      deskApi.get<SubHead>(`/subcategories/${encodeURIComponent(sub)}`),
      deskApi.get<Places>(`/facts/${encodeURIComponent(fact)}/places`, { sub }),
    ]).then(([h, p]) => { if (live) { setHead(h); setBase(p); } }).catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [sub, fact, tick]);

  const filtered = Boolean(q.trim() || country || county || postcode);
  useEffect(() => {
    if (!filtered) { setData(null); return; }
    let live = true;
    const t = setTimeout(() => {
      deskApi.get<Places>(`/facts/${encodeURIComponent(fact)}/places`, { sub, q: q.trim() || null, country, county, postcode })
        .then((p) => { if (live) setData(p); }).catch((e) => { if (live) setErr(e); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [sub, fact, q, country, county, postcode, tick, filtered]);

  const title = base ? factName(base.fact, base.label) : '';
  useCrumbs([
    { name: 'Categories', go: () => go('categories') },
    { name: head?.label ?? '…', go: () => go('categories', { sub }) },
    { name: title || '…' },
  ], [head?.label, title, sub]);

  if (err) return <Failed err={err} />;
  if (!base || !head) return <Muted>Loading</Muted>;

  // The API matches a postcode by prefix; "RG1" is not "RG10", so the outward code is matched exactly here.
  const got = filtered ? data : base;
  const shown = got && postcode ? { ...got, rows: got.rows.filter((r) => outward(r.postcode) === postcode) } : got;
  const ranged = base.kind !== 'yesno';
  const postcodes = [...new Set(base.rows.map((r) => outward(r.postcode)).filter(Boolean) as string[])].sort();

  const correct = async (r: PlaceRow, o: Option) => {
    setEditing(null);
    try {
      const c = await deskApi.put<Change>(`/places/${encodeURIComponent(r.ref)}/facts/${encodeURIComponent(fact)}`, { option: o.key });
      toast(`${title} on ${r.name ?? 'this place'} → ${o.label} · logged as a correction`, () => undoChanges([c.id], toast, reload));
      reload();
    } catch (e) { toast(saidOf(e)); }
  };

  const drop = (label: string, all: string, values: string[], value: string | null, set: (v: string | null) => void) => (
    <Dropdown
      label={value ?? all}
      value={value ?? '__all'}
      width={170}
      options={[{ key: '__all', name: all }, ...values.map((v) => ({ key: v, name: v }))]}
      onChange={(v) => set(v === '__all' ? null : v)}
      key={label}
    />
  );

  // Place 230 · (Answer 110) · Area 160 · How we know 200 · Edit 150, on a 16px gap.
  const cols = [230, ...(ranged ? [110] : []), 160, 200, 150];
  const tableW = cols.reduce((s, w) => s + w, 0) + 16 * (cols.length - 1);

  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 6, borderBottomWidth: 2, borderBottomColor: desk.ruleStrong, paddingBottom: 18 }}>
        <Text style={{ fontFamily: fonts.heading, fontWeight: '800', fontSize: 31, letterSpacing: -1.085, lineHeight: 32, color: desk.ink }}>{title}</Text>
        <Text style={[{ fontFamily: fonts.body, fontSize: 15, fontWeight: '800', color: LIME }, tabular]}>
          {ranged ? 'Answered at ' : 'Found at '}{n(base.foundAt)} {base.foundAt === 1 ? 'place' : 'places'}
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>{head.categoryLabel} › {head.label}</Text>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, zIndex: 30 }}>
        <SearchBox value={q} onChange={setQ} placeholder="Search places" width={narrow ? Math.min(260, width - 32) : 260} />
        {drop('country', 'All countries', base.countries, country, setCountry)}
        {drop('county', 'All counties', base.counties, county, setCounty)}
        {drop('postcode', 'All postcodes', postcodes, postcode, setPostcode)}
      </View>

      <Table width={tableW}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, borderBottomWidth: 2, borderBottomColor: desk.ruleStrong, paddingBottom: 9 }}>
          {['Place', ...(ranged ? ['Answer'] : []), 'Area', 'How we know', ''].map((h, i) => (
            <Text key={i} style={{ width: cols[i], fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600', color: desk.inkDim }}>{h}</Text>
          ))}
        </View>
        {!shown ? <Muted size={13}>Loading</Muted> : null}
        {shown && shown.rows.length === 0 ? <Text style={{ paddingVertical: 18, fontFamily: fonts.body, fontSize: 13, color: desk.inkDim }}>No places match.</Text> : null}
        {shown?.rows.map((r) => {
          const isEditing = editing === r.ref;
          const current = ranged ? r.options.find((o) => o.label === r.answer)?.key ?? null : 'yes';
          let i = 0;
          return (
            <View key={r.ref} style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: desk.rule }}>
              <Text style={{ width: cols[i++], fontFamily: fonts.body, fontSize: 13.5, fontWeight: '700', color: r.name ? desk.ink : desk.inkDim }}>{r.name ?? '—'}</Text>
              {ranged ? <Text style={{ width: cols[i++], fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: desk.ink }}>{r.answer ?? '—'}</Text> : null}
              <Text style={{ width: cols[i++], fontFamily: fonts.body, fontSize: 13, color: desk.inkMuted }}>{r.area ?? '—'}</Text>
              <Text style={{ width: cols[i++], fontFamily: fonts.body, fontSize: 12.5, color: desk.inkMuted }}>{r.how ?? '—'}</Text>
              <View style={{ width: cols[i++], flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
                {canManage && isEditing ? r.options.map((o) => <OptPill key={o.key} label={o.label} on={o.key === current} onPress={() => correct(r, o)} />) : null}
                {canManage && !isEditing ? (
                  <Press effect="none" onPress={() => setEditing(r.ref)}>
                    <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>Edit</Text>
                  </Press>
                ) : null}
              </View>
            </View>
          );
        })}
        <Text style={[{ paddingTop: 8, fontFamily: fonts.body, fontSize: 12, color: desk.inkDim }, tabular]}>
          {ranged ? 'Asked at ' : 'Looked for at '}{n(base.lookedFor)} places · {ranged ? 'answered at ' : 'found at '}{n(base.foundAt)}
          {base.total > base.rows.length ? ` · showing the first ${n(base.rows.length)}` : ''}
        </Text>
      </Table>
    </View>
  );
}
