/**
 * Back office › Places › Saved places and Photo review (owner, 2 Oct 2026,
 * "Saved places — photos and enrichment", Parts 2 and 3, revised 16:45).
 *
 * Saved places: every place the owner added to Places, where its research has
 * got to, what it found and on which page, what it cost, and Re-run.
 *
 * Photo review: places with owned pictures, searchable. Compare fetches
 * Google's photographs live — on the click and only then, priced before it —
 * and draws them beside ours at the same size and crop. The verdict is the
 * owner's; nothing of Google's is kept.
 *
 * Rows and rules, no boxes (the back office's own law).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, spacing, type, BORDER } from '../../theme';
import { useViewport } from '../../hooks/useViewport';
import {
  api, API_URL, ownedImageUrl, type SavedPlaceDetail, type SavedPlaceRow, type SavedPlacesSummary,
  type PhotoReviewRow, type PhotoCompare, type PhotoVerdict, type ReviewPicture, type VenuePhotoRef, type PhotoReviewSummary,
} from '../../api';
import { Ladder, Num, Word, Blank, Tick, Act, Kicker, Stat, type Col } from '../table';
import { Dropdown, ago, pounds } from '../kit';

const Waiting = () => <View style={{ paddingVertical: spacing.xl, alignItems: 'flex-start' }}><ActivityIndicator color={colors.accent} /></View>;

const STATE_WORD: Record<SavedPlaceRow['state'], string> = {
  queued: 'Queued', free: 'Free research', claude: 'Claude pass', done: 'Done', failed: 'Failed',
};
const FIELD_WORD: Record<string, string> = {
  website: 'Website', phone: 'Phone', booking_url: 'Booking', menu_url: 'Menu', socials: 'Social links',
};
const SOURCE_WORD: Record<string, string> = {
  site: "venue's own page", osm: 'OpenStreetMap', wikidata: 'Wikidata', wikipedia: 'Wikipedia',
  other_page: 'another page (not kept)', unknown: "don't know", own: 'free research',
};
const VERDICT_WORD: Record<PhotoVerdict, string> = {
  owned_fine: 'Owned is fine', owned_worse_acceptable: 'Owned is worse but acceptable', owned_not_fit: 'Owned not fit',
};
const pct = (v: number | null) => (v == null ? '—' : `${v}%`);
const pence = (p: number | null | undefined) => (p == null ? '—' : p < 100 ? `${p}p` : pounds(p));

/** A page we read, as a link the owner can open. */
const Page = ({ url }: { url: string | null }) => {
  if (!url) return null;
  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* shown as written */ }
  return (
    <Text style={styles.link} accessibilityRole="link" onPress={() => { if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener'); }}>{host}</Text>
  );
};

// ---------------------------------------------------------------------------
// Saved places
// ---------------------------------------------------------------------------

export function SavedPlacesBoard({ canManage }: { canManage: boolean }) {
  const [data, setData] = useState<{ places: SavedPlaceRow[]; more?: boolean; summary: SavedPlacesSummary } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [quote, setQuote] = useState<{ places: number; pence: number; enrolled: boolean } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => {
    api.adminSavedPlaces().then(setData).catch(() => setData({ places: [], summary: null as any }));
    api.adminSavedBackfillQuote().then(setQuote).catch(() => setQuote(null));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!data) return <Waiting />;
  const s = data.summary;

  const columns: Col<SavedPlaceRow>[] = [
    { key: 'name', label: 'Place', grow: true, cell: (r) => <Text style={styles.rowName}>{r.name}</Text> },
    { key: 'state', label: 'Research', width: 120, cell: (r) => <Word strong={r.state === 'failed'} muted={r.state !== 'done' && r.state !== 'failed'}>{STATE_WORD[r.state]}</Word> },
    { key: 'website', label: 'Website', width: 80, align: 'centre', cell: (r) => <Tick on={r.website} /> },
    { key: 'menu', label: 'Menu', width: 70, align: 'centre', cell: (r) => <Tick on={r.menu} /> },
    { key: 'pictures', label: 'Pictures', width: 80, align: 'right', cell: (r) => <Num n={r.pictures || null} /> },
    { key: 'cost', label: 'Cost', width: 80, align: 'right', cell: (r) => (r.costPence ? <Word>{pence(r.costPence)}</Word> : <Blank />) },
    { key: 'last', label: 'Last run', width: 100, align: 'right', cell: (r) => <Word muted>{r.lastRunAt ? ago(r.lastRunAt) : '—'}</Word> },
  ];

  return (
    <>
      {s ? (
        <View style={styles.subRow}>
          <View style={styles.five}>
            <Stat label="Researched" value={String(s.done)} tip={['Researched', 'Saved places whose research has finished. The rates beside it are over these and say nothing until there is one.']} />
            <Stat label="Website" value={pct(s.websitePct)} tip={['Website', "Share of researched places with a website found on the venue's own page or the open map."]} />
            <Stat label="Menu" value={pct(s.menuPct)} tip={['Menu', "Share with a menu link read on the venue's own page. The dishes are read into the pooled menu."]} />
            <Stat label="Owned image" value={pct(s.ownedImagePct)} tip={['Owned image', "Share with at least one picture from Openverse or the venue's own site (the latter unlicensed, back office only)."]} />
            <Stat label="Per place" value={s.avgCostPerPlacePence == null ? '—' : `${s.avgCostPerPlacePence}p`} tip={['Cost per place', `Everything Claude cost, over every researched place — including those it was never needed for. Target 12p.`]} />
            <Stat label="Per pass" value={s.avgCostPence == null ? '—' : `${s.avgCostPence}p`} tip={['Cost per paid pass', `Over the ${s.paidPasses} Claude passes paid for, ledgered as ${s.purpose}.`]} />
          </View>
        </View>
      ) : null}
      {quote?.enrolled && quote.places > 0 ? (
        <View style={[styles.detailHead, { paddingBottom: spacing.md }]}>
          <Kicker tip={['Not yet researched', 'Your places already in Places from before this was built. Priced at the 12p target each; refused if the count changes before the press.']}>
            {`${quote.places} NOT YET RESEARCHED`}
          </Kicker>
          <Act label={`Research them · up to ${pence(quote.pence)}`} icon="search" small disabled={!canManage}
               onPress={async () => {
                 setMsg(null);
                 try { const r = await api.adminSavedBackfill(quote.places); setMsg(`${r.started} started`); load(); } catch (err: any) { setMsg(err.message); load(); }
               }} />
        </View>
      ) : null}
      {msg ? <Text style={styles.note}>{msg}</Text> : null}
      <Ladder columns={columns} rows={data.places} keyOf={(r) => r.venueRef}
              onRow={(r) => setOpen(open === r.venueRef ? null : r.venueRef)}
              highlight={(r) => r.venueRef === open}
              empty={<Word muted>No saved places researched yet</Word>}
              phoneRow={(r) => ({
                name: r.name, note: STATE_WORD[r.state],
                chips: [
                  { key: 'w', word: r.website ? 'website' : 'no website' },
                  { key: 'm', word: r.menu ? 'menu' : 'no menu' },
                  { key: 'p', word: `${r.pictures} pictures` },
                  ...(r.costPence ? [{ key: 'c', word: pence(r.costPence) }] : []),
                ],
              })} />
      {data.more ? <Text style={styles.note}>Newest 500 shown</Text> : null}
      {open ? <SavedPlaceDetailView key={open} refId={open} canManage={canManage} onChanged={load} /> : null}
    </>
  );
}

function SavedPlaceDetailView({ refId, canManage, onChanged }: { refId: string; canManage: boolean; onChanged: () => void }) {
  const [d, setD] = useState<SavedPlaceDetail | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { api.adminSavedPlace(refId).then(setD).catch(() => setD(null)); }, [refId]);
  if (!d) return <Waiting />;
  const e = d.enrichment;
  const fields = Object.entries(e?.found?.fields ?? {});
  const facts = Object.entries(e?.found?.facts ?? {});

  return (
    <View style={styles.detail}>
      <View style={styles.detailHead}>
        <Kicker>{e ? `${STATE_WORD[e.state].toUpperCase()} · ${e.runs} RUN${e.runs === 1 ? '' : 'S'} · ${pence(e.costPence)}` : 'NOT RESEARCHED'}</Kicker>
        <Act label="Re-run" icon="refresh" tone="secondary" small disabled={!canManage}
             onPress={async () => {
               setMsg(null);
               try { const r = await api.adminSavedPlaceRerun(refId); setMsg(r.started ? 'Re-running' : 'Already running'); onChanged(); } catch (err: any) { setMsg(err.message); }
             }} />
      </View>
      {msg ? <Text style={styles.note}>{msg}</Text> : null}
      {e?.error ? <Text style={styles.note}>{e.error}</Text> : null}

      <Kicker>Found</Kicker>
      {fields.length ? fields.map(([k, f]) => (
        <View key={k} style={styles.line}>
          <Text style={styles.lineKey}>{FIELD_WORD[k] ?? k}</Text>
          <Text style={styles.lineValue} numberOfLines={2}>{f.value == null ? '—' : typeof f.value === 'object' ? Object.keys(f.value as object).join(', ') : String(f.value)}</Text>
          <Text style={styles.lineSource}>{SOURCE_WORD[f.source] ?? f.source}{f.why ? ` · ${f.why}` : ''}</Text>
          <Page url={f.sourceUrl} />
        </View>
      )) : <Word muted>Nothing yet</Word>}

      <Kicker>Fact sheet</Kicker>
      {facts.length ? facts.map(([k, f]) => (
        <View key={k} style={styles.line}>
          <Text style={styles.lineKey}>{f.label}</Text>
          <Text style={styles.lineValue}>{f.answer === 'unknown' ? "Don't know" : f.answer === 'yes' ? 'Yes' : 'No'}</Text>
          <Text style={styles.lineSource}>{f.source ? SOURCE_WORD[f.source] ?? f.source : ''}{f.why ? ` · ${f.why}` : ''}</Text>
          <Page url={f.sourceUrl} />
        </View>
      )) : <Word muted>No questions asked</Word>}

      {(e?.found?.notes ?? []).length ? (
        <>
          <Kicker>Notes</Kicker>
          {e!.found.notes!.map((n, i) => <Text key={i} style={styles.note}>{n}</Text>)}
        </>
      ) : null}

      <Pictures owned={d.ownedPictures} venue={d.venuePictures} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// pictures, at one size and one crop
// ---------------------------------------------------------------------------

const FRAME_W = 240;
const FRAME_H = 160;

function Frame({ uri, caption, sub }: { uri: string | null; caption?: string | null; sub?: React.ReactNode }) {
  return (
    <View style={{ width: FRAME_W, gap: 2 }}>
      <View style={styles.frame}>
        {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill as any} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
      </View>
      {caption ? <Text style={styles.caption} numberOfLines={2}>{caption}</Text> : null}
      {sub}
    </View>
  );
}

const ownedUri = (p: ReviewPicture) => ownedImageUrl(p, 500);
const googleUri = (p: VenuePhotoRef) => (p.ref
  ? `${API_URL}/api/photos/google?name=${encodeURIComponent(p.ref)}&w=480` + (p.sig && p.exp ? `&s=${encodeURIComponent(p.sig)}&e=${p.exp}` : '')
  : p.url ?? null);

function Pictures({ owned, venue }: { owned: ReviewPicture[]; venue: { url: string; pageUrl: string }[] }) {
  return (
    <>
      <Kicker>Our pictures</Kicker>
      <View style={styles.strip}>
        {owned.length ? owned.map((p) => (
          <Frame key={p.id} uri={ownedUri(p)}
                 caption={[p.source, p.licence, p.creator].filter(Boolean).join(' · ')}
                 sub={<View style={{ flexDirection: 'row', gap: 6 }}>{p.moderation !== 'approved' ? <Word muted>waiting for a look</Word> : null}<Page url={p.sourceUrl ?? null} /></View>} />
        )) : <Word muted>None held</Word>}
      </View>
      <Kicker tip={['Venue site', "Pictures on the venue's own website, kept by address only. No licence: shown here and in the owner's account until a licence route is decided."]}>Venue site · no licence</Kicker>
      <View style={styles.strip}>
        {venue.length ? venue.map((v) => <Frame key={v.url} uri={v.url} sub={<Page url={v.pageUrl} />} />) : <Word muted>None found</Word>}
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Photo review
// ---------------------------------------------------------------------------

export function PhotoReviewBoard({ canManage }: { canManage: boolean }) {
  const [q, setQ] = useState('');
  const [asked, setAsked] = useState('');
  const [reviewed, setReviewed] = useState<'' | 'yes' | 'no'>('no');
  const [data, setData] = useState<{ places: PhotoReviewRow[]; more: boolean; comparePence: number; summary: PhotoReviewSummary } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => {
    setData(null);
    api.adminPhotoReview({ q: asked || undefined, reviewed: reviewed || undefined }).then(setData).catch(() => setData({ places: [], more: false, comparePence: 0, summary: null as any }));
  }, [asked, reviewed]);
  useEffect(() => { load(); }, [load]);

  const columns: Col<PhotoReviewRow>[] = [
    { key: 'name', label: 'Place', grow: true, cell: (r) => <Text style={styles.rowName}>{r.name ?? r.venueRef}</Text> },
    { key: 'cat', label: 'Kind', width: 120, cell: (r) => <Word muted>{r.category ?? '—'}</Word> },
    { key: 'pics', label: 'Ours', width: 70, align: 'right', cell: (r) => <Num n={r.pictures} /> },
    { key: 'verdict', label: 'Verdict', width: 220, cell: (r) => (r.verdict ? <Word>{VERDICT_WORD[r.verdict]}</Word> : <Word muted>not reviewed</Word>) },
  ];

  return (
    <>
      <View style={[styles.subRow, { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, alignItems: 'center' }]}>
        <TextInput value={q} onChangeText={setQ} onSubmitEditing={() => setAsked(q.trim())} placeholder="Search a place"
                   placeholderTextColor={colors.inkMuted} style={styles.search} accessibilityLabel="Search a place" />
        <Act label="Search" icon="search" tone="secondary" small onPress={() => setAsked(q.trim())} />
        <Dropdown label="Reviewed" value={reviewed === 'yes' ? 'Reviewed' : reviewed === 'no' ? 'Not reviewed' : 'All'} width={200}
                  options={[{ key: '', label: 'All', on: reviewed === '' }, { key: 'no', label: 'Not reviewed', on: reviewed === 'no' }, { key: 'yes', label: 'Reviewed', on: reviewed === 'yes' }]}
                  onPick={(k) => setReviewed(k as any)} />
      </View>
      {!data ? <Waiting /> : (
        <>
          {data.summary ? (
            <View style={styles.subRow}>
              <View style={styles.five}>
                <Stat label="With owned pictures" value={String(data.summary.places)} tip={['With owned pictures', 'Places holding at least one picture of ours, waiting for a look or approved.']} />
                <Stat label="Reviewed" value={String(data.summary.reviewed)} tip={['Reviewed', 'Places you have given a verdict.']} />
                <Stat label="Owned is fine" value={data.summary.reviewed ? `${Math.round((data.summary.fine / data.summary.reviewed) * 100)}%` : '—'} tip={['Owned is fine', 'Of the places reviewed.']} />
                <Stat label="Worse, acceptable" value={data.summary.reviewed ? `${Math.round((data.summary.acceptable / data.summary.reviewed) * 100)}%` : '—'} tip={['Worse but acceptable', 'Of the places reviewed.']} />
                <Stat label="Not fit" value={data.summary.reviewed ? `${Math.round((data.summary.not_fit / data.summary.reviewed) * 100)}%` : '—'} tip={['Not fit', 'Of the places reviewed.']} />
              </View>
            </View>
          ) : null}
          <Ladder columns={columns} rows={data.places} keyOf={(r) => r.venueRef}
                  onRow={(r) => setOpen(open === r.venueRef ? null : r.venueRef)}
                  highlight={(r) => r.venueRef === open}
                  empty={<Word muted>No places with owned pictures match</Word>}
                  phoneRow={(r) => ({ name: r.name ?? r.venueRef, note: r.verdict ? VERDICT_WORD[r.verdict] : 'not reviewed', chips: [{ key: 'p', word: `${r.pictures} ours` }] })} />
          {data.more ? <Text style={styles.note}>First 200 shown</Text> : null}
          {open ? <CompareView key={open} refId={open} pricePence={data.comparePence} canManage={canManage} onVerdict={load} /> : null}
        </>
      )}
    </>
  );
}

function CompareView({ refId, pricePence, canManage, onVerdict }: { refId: string; pricePence: number; canManage: boolean; onVerdict: () => void }) {
  const { width } = useViewport();
  const [cmp, setCmp] = useState<PhotoCompare | null>(null);
  const [detail, setDetail] = useState<SavedPlaceDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState<PhotoVerdict | null>(null);
  useEffect(() => {
    api.adminSavedPlace(refId).then((d) => { setDetail(d); setSaved(d.review?.verdict ?? null); setNote(d.review?.note ?? ''); }).catch(() => setDetail(null));
  }, [refId]);
  const owned = cmp?.owned ?? detail?.ownedPictures ?? [];
  const venue = cmp?.venuePictures ?? detail?.venuePictures ?? [];
  const sideBySide = width >= 680;

  return (
    <View style={styles.detail}>
      <View style={styles.detailHead}>
        <Kicker>COMPARE</Kicker>
        <Act label={cmp ? 'Compared' : `Compare · ≈${pricePence}p`} icon="image" small disabled={!canManage || busy || !!cmp}
             onPress={async () => {
               setBusy(true); setErr(null);
               try { setCmp(await api.adminPhotoCompare(refId)); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
             }} />
      </View>
      {err ? <Text style={styles.note}>{err}</Text> : null}
      <View style={[styles.sides, !sideBySide && { flexDirection: 'column' }]}>
        <View style={styles.side}>
          <Kicker tip={['Google', 'Fetched live from Google on Compare, drawn once and never stored.']}>Google · live</Kicker>
          <View style={styles.strip}>
            {!cmp ? <Word muted>Press Compare</Word>
              : cmp.google.length ? cmp.google.map((g, i) => <Frame key={g.ref ?? i} uri={googleUri(g)} caption={g.attribution ?? null} />)
                : <Word muted>{cmp.googleWhy === 'not_a_google_place' ? 'Not a Google place' : cmp.googleWhy === 'google_off' ? 'Google is switched off' : 'Google has no photographs'}</Word>}
          </View>
        </View>
        <View style={styles.side}>
          <Kicker>Ours</Kicker>
          <View style={styles.strip}>
            {owned.length ? owned.map((p) => (
              <Frame key={p.id} uri={ownedUri(p)} caption={[p.source, p.licence, p.creator].filter(Boolean).join(' · ')}
                     sub={p.moderation !== 'approved' ? <Word muted>waiting for a look</Word> : undefined} />
            )) : <Word muted>None held</Word>}
            {venue.map((v) => <Frame key={v.url} uri={v.url} caption="Venue site · no licence" sub={<Page url={v.pageUrl} />} />)}
          </View>
        </View>
      </View>
      <Kicker>Verdict</Kicker>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {(Object.keys(VERDICT_WORD) as PhotoVerdict[]).map((v) => (
          <Act key={v} label={VERDICT_WORD[v]} small tone={saved === v ? 'solid' : 'secondary'} disabled={!canManage}
               onPress={async () => {
                 setErr(null);
                 try { await api.adminPhotoVerdict(refId, v, note.trim() || undefined); setSaved(v); onVerdict(); } catch (e: any) { setErr(e.message); }
               }} />
        ))}
      </View>
      <TextInput value={note} onChangeText={setNote} placeholder="Note (optional)" placeholderTextColor={colors.inkMuted}
                 style={[styles.search, { marginTop: spacing.sm, maxWidth: 520 }]} accessibilityLabel="Verdict note" />
    </View>
  );
}

const styles = StyleSheet.create({
  subRow: { paddingVertical: spacing.md },
  five: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xl },
  rowName: { ...type.body, color: colors.ink, fontWeight: '600' },
  detail: { borderTopWidth: BORDER, borderTopColor: colors.line, paddingVertical: spacing.lg, gap: spacing.sm },
  detailHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, flexWrap: 'wrap' },
  line: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, alignItems: 'baseline', paddingVertical: 2 },
  lineKey: { ...type.small, color: colors.ink, fontWeight: '700', width: 160 },
  lineValue: { ...type.small, color: colors.ink, flexShrink: 1, minWidth: 120, maxWidth: 360 },
  lineSource: { ...type.small, color: colors.inkMuted },
  link: { ...type.small, color: colors.ink, textDecorationLine: 'underline' },
  note: { ...type.small, color: colors.inkMuted },
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, paddingVertical: spacing.sm },
  frame: { width: FRAME_W, height: FRAME_H, overflow: 'hidden', backgroundColor: colors.well },
  caption: { ...type.tiny, color: colors.inkMuted },
  sides: { flexDirection: 'row', gap: spacing.xl, alignItems: 'flex-start' },
  side: { flex: 1, minWidth: 0 },
  search: { ...type.body, color: colors.ink, borderBottomWidth: BORDER, borderBottomColor: colors.line, paddingVertical: 6, minWidth: 220, flexGrow: 1, maxWidth: 360 },
});
