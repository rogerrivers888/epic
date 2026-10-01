/**
 * Waitlist (WL1, Website & Registration v2): everyone who registered interest
 * on epic.day before launch, and where they came from.
 *
 * Drawn on the back office's dark surface (`desk`), like Staff. The totals and
 * both breakdowns are over every sign-up, never the filter (the API says so),
 * so clicking a breakdown row narrows the table without moving the figure that
 * was clicked. Export takes the rows the filters show; delete is for an erasure
 * request and is gone for good. `view_waitlist` reads; `manage_waitlist`
 * exports and deletes, and the API refuses both without it whatever is drawn.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import { Icon } from '../../components/Icon';
import { useViewport } from '../../hooks/useViewport';
import { api, type WaitlistFilters, type WaitlistResponse, type WaitlistRow } from '../../api';
import { desk, fonts, LIME, MIC_TILE, ON_LIME } from '../../theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
/** "1 Oct 2026, 09:12". */
const when = (iso: string) => { const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
/** A share as a percentage, or a dash where there is nothing to share (the API's null). */
const pct = (share: number | null) => (share == null ? '—' : `${Math.round(share * 100)}%`);

const SOURCES = [{ key: 'home', label: 'Homepage' }, { key: 'host', label: 'Host page' }];
const LOCALES = [{ key: 'en-gb', label: 'en-GB' }, { key: 'en-us', label: 'en-US' }];

type Key = keyof WaitlistFilters;

export function Waitlist({ canManage = false }: { canManage?: boolean } = {}) {
  const { width } = useViewport();
  const wide = width >= 900;
  const [filters, setFilters] = useState<WaitlistFilters>({});
  const [search, setSearch] = useState('');
  const [data, setData] = useState<WaitlistResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<WaitlistRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = (t: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(''), 4500);
  };
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // The search box waits for a pause before it asks.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, search: search.trim() || undefined })), 250);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    try { setData(await api.waitlist(filters)); setError(null); } catch (e: any) { setError(e.message); }
  }, [filters]);
  useEffect(() => { void load(); }, [load]);

  const set = (k: Key, v?: string) => setFilters((f) => ({ ...f, [k]: v || undefined }));
  /** A breakdown row is a toggle: clicking the one in force clears it. */
  const toggle = (k: Key, v: string) => setFilters((f) => ({ ...f, [k]: f[k] === v ? undefined : v }));
  const any = Boolean(filters.source || filters.kind || filters.locale || filters.campaign || filters.search);
  const clear = () => { setSearch(''); setFilters({}); };

  const exportCsv = async () => {
    try { await api.downloadWaitlist(filters); } catch (e: any) { say(e.message || 'Could not export.'); }
  };
  const remove = async () => {
    if (!confirm || busy) return;
    setBusy(true);
    try {
      await api.deleteWaitlistSignup(confirm.id);
      say(`${confirm.email} deleted`);
      setConfirm(null);
      void load();
    } catch (e: any) { say(e.message || 'Could not delete.'); } finally { setBusy(false); }
  };

  const t = data?.totals;
  const kinds = data?.byKind ?? [];
  const campaigns = data?.byCampaign ?? [];
  const total = t?.all ?? 0;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.content, !wide && { paddingHorizontal: 16 }]}>
        <View style={[styles.header, !wide && { flexDirection: 'column', alignItems: 'flex-start' }]}>
          <View style={{ flexShrink: 1, gap: 6 }}>
            <Text style={styles.title} accessibilityRole="header">Waitlist</Text>
            <Text style={styles.sub}>Everyone who registered interest on epic.day, before launch</Text>
          </View>
          {canManage ? (
            <Press onPress={() => { void exportCsv(); }} effect="none" style={({ hovered }: any) => [styles.primary, hovered && styles.primaryHover]} accessibilityLabel="Export CSV">
              <Icon name="download" size={16} color={ON_LIME} strokeWidth={2.2} />
              <Text style={styles.primaryLabel}>Export CSV</Text>
            </Press>
          ) : null}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={[styles.totals, !wide && { flexWrap: 'wrap' }]}>
          {[['ALL SIGN-UPS', t?.all], ['FROM HOMEPAGE', t?.home], ['FROM HOST PAGE', t?.host], ['LAST 7 DAYS', t?.last7]].map(([label, n]) => (
            <View key={label as string} style={[styles.total, !wide && { flexBasis: '50%' }]}>
              <Text style={styles.totalLabel}>{label}</Text>
              <Text style={styles.totalValue}>{n == null ? '—' : Number(n).toLocaleString()}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.breakdowns, !wide && { flexDirection: 'column' }]}>
          <Breakdown title="By host kind" rows={kinds.map((k) => ({ key: k.key, label: k.label, signups: k.signups, share: k.share }))} on={filters.kind} onPick={(k) => toggle('kind', k)} />
          <Breakdown title="By campaign" rows={campaigns.map((c) => ({ key: c.key, label: c.key, signups: c.signups, share: c.share }))} on={filters.campaign} onPick={(k) => toggle('campaign', k)} />
        </View>

        <View style={[styles.filters, !wide && { flexDirection: 'column', alignItems: 'stretch' }]}>
          <TextInput value={search} onChangeText={setSearch} placeholder="Search by email" placeholderTextColor={desk.inkDim}
            autoCapitalize="none" accessibilityLabel="Search by email" style={[styles.search, wide && { flex: 1.4 }]} />
          <Select label="Source" value={filters.source} options={SOURCES} onPick={(v) => set('source', v)} />
          <Select label="Host kind" value={filters.kind} options={kinds.map((k) => ({ key: k.key, label: k.label }))} onPick={(v) => set('kind', v)} />
          <Select label="Locale" value={filters.locale} options={LOCALES} onPick={(v) => set('locale', v)} />
          <Select label="Campaign" value={filters.campaign} options={campaigns.map((c) => ({ key: c.key, label: c.key }))} onPick={(v) => set('campaign', v)} />
        </View>
        <View style={styles.countLine}>
          <Text style={styles.count}>{data ? `${data.count.toLocaleString()} of ${total.toLocaleString()} sign-ups` : 'Loading…'}</Text>
          {any ? (
            <Press onPress={clear} effect="none" accessibilityRole="button">
              {({ hovered }: any) => <Text style={[styles.clear, hovered && { color: LIME }]}>Clear filters</Text>}
            </Press>
          ) : null}
        </View>

        <View>
          {wide ? (
            <View style={styles.headRow}>
              {['Email', 'Source', 'Host kind', 'Locale', 'Campaign', 'Signed up'].map((h) => <Text key={h} style={styles.headCell}>{h}</Text>)}
              {canManage ? <View style={styles.actionCell} /> : null}
            </View>
          ) : null}
          {data && data.rows.length === 0 ? <Text style={styles.empty}>{any ? 'No sign-ups match these filters.' : 'Nobody has signed up yet.'}</Text> : null}
          {(data?.rows ?? []).map((r) => (
            <View key={r.id} style={[styles.row, !wide && { flexWrap: 'wrap', gap: 6 }]}>
              <Text style={[styles.cellStrong, !wide && { flexBasis: '100%' }]} numberOfLines={1}>{r.email}</Text>
              <Text style={styles.cell} numberOfLines={1}>{r.sourceLabel}</Text>
              <Text style={styles.cell} numberOfLines={1}>{r.hostKindLabel ?? '—'}</Text>
              <Text style={styles.cell} numberOfLines={1}>{r.locale}</Text>
              <Text style={styles.cell} numberOfLines={1}>{r.campaign}</Text>
              <Text style={styles.cellMuted} numberOfLines={1}>{when(r.signedUp)}</Text>
              {canManage ? (
                <Press onPress={() => setConfirm(r)} effect="none" accessibilityLabel={`Delete ${r.email}`} style={({ hovered }: any) => [styles.actionCell, styles.del, hovered && { backgroundColor: desk.rule }]}>
                  <Icon name="delete" size={16} color={desk.inkMuted} strokeWidth={2} />
                </Press>
              ) : null}
            </View>
          ))}
        </View>
      </ScrollView>

      {confirm ? <Confirm row={confirm} busy={busy} onCancel={() => setConfirm(null)} onDelete={() => { void remove(); }} /> : null}
      {toast ? (
        <View style={[styles.toast, { position: 'absolute', top: 20, right: 20 }]} accessibilityRole="alert">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Breakdown({ title, rows, on, onPick }: {
  title: string; rows: { key: string; label: string; signups: number; share: number | null }[]; on?: string; onPick: (key: string) => void;
}) {
  return (
    <View style={styles.breakdown}>
      <Text style={styles.breakdownTitle}>{title}</Text>
      <View style={styles.bHead}>
        {['Name', 'Sign-ups', 'Share'].map((h) => <Text key={h} style={styles.headCell}>{h}</Text>)}
      </View>
      {rows.length === 0 ? <Text style={styles.empty}>Nobody yet.</Text> : null}
      {rows.map((r) => (
        <Press key={r.key} onPress={() => onPick(r.key)} effect="none" accessibilityRole="button" accessibilityState={{ selected: on === r.key }}
          style={({ hovered }: any) => [styles.bRow, (hovered || on === r.key) && { backgroundColor: desk.picked }]}>
          <Text style={[styles.cell, on === r.key && { color: LIME, fontWeight: '700' }]} numberOfLines={1}>{r.label}</Text>
          <Text style={styles.cell}>{r.signups.toLocaleString()}</Text>
          <View style={[styles.cellBox, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
            <View style={styles.barTrack}><View style={[styles.bar, { width: `${Math.round((r.share ?? 0) * 100)}%` }]} /></View>
            <Text style={styles.share}>{pct(r.share)}</Text>
          </View>
        </Press>
      ))}
    </View>
  );
}

/** A 36px select on the desk: a lime border and lime words while one is in force. */
function Select({ label, value, options, onPick }: { label: string; value?: string; options: { key: string; label: string }[]; onPick: (key?: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.key === value);
  const on = Boolean(value);
  return (
    <View style={[styles.selectWrap, open && { zIndex: 20 }]}>
      <Press onPress={() => setOpen((o) => !o)} effect="none" accessibilityRole="button" accessibilityLabel={label}
        style={({ hovered }: any) => [styles.select, on && { borderColor: LIME }, hovered && { backgroundColor: desk.picked }]}>
        <Text style={[styles.selectText, on && { color: LIME, fontWeight: '700' }]} numberOfLines={1}>{current ? current.label : label}</Text>
        <Icon name="expand" size={14} color={on ? LIME : desk.inkDim} strokeWidth={2.2} />
      </Press>
      {open ? (
        <View style={styles.menu}>
          {[{ key: '', label: `Any ${label.toLowerCase()}` }, ...options].map((o) => (
            <Press key={o.key || 'any'} onPress={() => { setOpen(false); onPick(o.key || undefined); }} effect="none"
              style={({ hovered }: any) => [styles.menuItem, hovered && { backgroundColor: desk.picked }]}>
              <Text style={[styles.selectText, (o.key || undefined) === value && { color: LIME, fontWeight: '700' }]} numberOfLines={1}>{o.label}</Text>
            </Press>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Confirm({ row, busy, onCancel, onDelete }: { row: WaitlistRow; busy: boolean; onCancel: () => void; onDelete: () => void }) {
  const { width, height, framed, origin } = useViewport();
  const frameBox = framed && origin ? { position: 'absolute' as const, left: origin.x, top: origin.y, width, height, overflow: 'hidden' as const } : null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={[styles.dialogWrap, frameBox]}>
        <Press style={styles.backdrop} onPress={onCancel} accessibilityLabel="Cancel" effect="none" />
        <View style={styles.dialog} accessibilityRole="alert">
          <Text style={styles.dialogTitle}>Delete {row.email}?</Text>
          <Text style={styles.dialogBody}>They're removed from the waitlist and every export. This can't be undone.</Text>
          <View style={styles.dialogFoot}>
            <Press onPress={onCancel} effect="none" accessibilityRole="button">
              {({ hovered }: any) => <Text style={[styles.cancel, hovered && { color: desk.ink }]}>Cancel</Text>}
            </Press>
            <Press onPress={onDelete} disabled={busy} effect="none" accessibilityRole="button" style={({ hovered }: any) => [styles.primary, hovered && styles.primaryHover]}>
              <Text style={styles.primaryLabel}>Delete for good</Text>
            </Press>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: desk.ground },
  content: { paddingTop: 28, paddingHorizontal: 28, paddingBottom: 40, gap: 22 },
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 },
  title: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 31, letterSpacing: -1.1, lineHeight: 32, color: desk.ink },
  sub: { fontFamily: fonts.body, fontSize: 13.5, color: desk.inkDim, lineHeight: 20 },
  error: { fontFamily: fonts.body, fontSize: 13.5, color: desk.warn },

  primary: { height: 40, backgroundColor: LIME, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  primaryHover: { backgroundColor: MIC_TILE },
  primaryLabel: { fontFamily: fonts.body, fontSize: 13.5, fontWeight: '700', color: ON_LIME },

  totals: { flexDirection: 'row', borderTopWidth: 2, borderBottomWidth: 2, borderColor: desk.ruleStrong },
  total: { flex: 1, minWidth: 0, paddingVertical: 14, paddingRight: 16, gap: 6 },
  totalLabel: { fontFamily: fonts.heading, fontSize: 10, fontWeight: '700', letterSpacing: 0.7, color: desk.inkDim },
  totalValue: { fontFamily: fonts.heading, fontSize: 34, fontWeight: '800', letterSpacing: -1, lineHeight: 36, color: desk.ink },

  breakdowns: { flexDirection: 'row', gap: 28 },
  breakdown: { flex: 1, minWidth: 0, gap: 4 },
  breakdownTitle: { fontFamily: fonts.heading, fontSize: 15, fontWeight: '800', letterSpacing: -0.3, color: desk.ink, marginBottom: 6 },
  bHead: { flexDirection: 'row', gap: 16, borderBottomWidth: 2, borderBottomColor: desk.ruleStrong, paddingBottom: 8 },
  bRow: { flexDirection: 'row', gap: 16, alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: desk.rule },
  barTrack: { flex: 1, height: 8, backgroundColor: desk.off },
  bar: { height: 8, backgroundColor: LIME },
  share: { fontFamily: fonts.body, fontSize: 13, color: desk.inkMuted, minWidth: 36 },

  filters: { flexDirection: 'row', gap: 10, alignItems: 'center', zIndex: 10 },
  search: { height: 36, borderWidth: 1, borderColor: desk.ruleStrong, color: desk.ink, paddingHorizontal: 12, fontFamily: fonts.body, fontSize: 13.5 },
  selectWrap: { flex: 1, minWidth: 0, position: 'relative' },
  select: { height: 36, borderWidth: 1, borderColor: desk.ruleStrong, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 12 },
  selectText: { flexShrink: 1, fontFamily: fonts.body, fontSize: 13.5, color: desk.ink },
  menu: { position: 'absolute', top: 38, left: 0, right: 0, backgroundColor: desk.well, borderWidth: 1, borderColor: desk.ruleStrong },
  menuItem: { paddingVertical: 9, paddingHorizontal: 12 },
  countLine: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: -8 },
  count: { fontFamily: fonts.body, fontSize: 13, color: desk.inkDim },
  clear: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: desk.ink },

  headRow: { flexDirection: 'row', gap: 16, borderBottomWidth: 2, borderBottomColor: desk.ruleStrong, paddingBottom: 9 },
  headCell: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600', color: desk.inkDim },
  row: { flexDirection: 'row', gap: 16, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: desk.rule },
  cell: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 14, color: desk.ink },
  cellBox: { flex: 1, minWidth: 0 },
  cellStrong: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: desk.ink },
  cellMuted: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 13.5, color: desk.inkMuted },
  actionCell: { width: 56 },
  del: { height: 32, alignItems: 'center', justifyContent: 'center' },
  empty: { fontFamily: fonts.body, fontSize: 14, color: desk.inkDim, paddingVertical: 16 },

  dialogWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10,9,9,0.55)' },
  dialog: { width: 440, maxWidth: '100%', backgroundColor: desk.lifted, borderWidth: 2, borderColor: desk.ruleStrong, padding: 24, gap: 14 },
  dialogTitle: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 22, letterSpacing: -0.6, lineHeight: 26, color: desk.ink },
  dialogBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: desk.inkMuted },
  dialogFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  cancel: { fontFamily: fonts.body, fontSize: 13.5, fontWeight: '600', color: desk.inkMuted },

  toast: { backgroundColor: LIME, paddingVertical: 11, paddingHorizontal: 16, zIndex: 5 },
  toastText: { fontFamily: fonts.body, fontSize: 13.5, fontWeight: '700', color: ON_LIME },
});
