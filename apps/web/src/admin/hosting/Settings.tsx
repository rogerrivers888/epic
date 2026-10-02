/**
 * Hosting › Settings (hosting v4, BO8l; handover §7).
 *
 * One row per setting, read by the server when it is used and never copied
 * into code. The value is the server's own words for it, so this screen and
 * the change log can never describe the same number two ways. A row opens an
 * editor under itself; saving needs a reason and the owner signed in
 * personally (G7/G11) — anyone else is told so in plain words, with the
 * server's own message, and an agent files it for approval instead.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, ApiError } from '../../api';
import { asText, useQueryState } from '../../router';
import { AMBER_DARK, BORDER, colors, desk, fonts, onThemeChange, spacing, type } from '../../theme';
import { Banner, Choice, PageHead, TextAction } from '../kit';
import { Act, Blank, Footer, Kicker, Ladder, Stat, Word, type Col } from '../table';
import { useLoad, useSorted, when } from './kit';

// ---------------------------------------------------------------------------
// payloads (routes/hostingMoney.js `settingPayload`)
// ---------------------------------------------------------------------------

type Unit = 'pence' | 'percent' | 'ladder' | 'intro' | 'tip' | 'refunds' | 'days' | 'hours' | 'months' | 'on_request' | 'switch' | 'thresholds';

type Setting = {
  key: string;
  label: string;
  unit: Unit | string;
  value: unknown;
  isOn: boolean | null;
  switchable: boolean;
  toSet: boolean;
  words: string;
  changedAt: string | null;
  changedBy: string | null;
  approvalId: string | null;
};

type LadderStep = { pct: number; ratedEvents?: number; avgAtLeast?: number };
type RefundTier = { fullHoursBefore?: number; partHoursBefore?: number; partPct?: number };

const SORTS = ['setting', 'value', 'on', 'changed', 'by'] as const;

function useAmber() {
  const [light, setLight] = useState(() => Platform.OS === 'web' && typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-theme') === 'light');
  useEffect(() => onThemeChange((t) => setLight(t === 'light')), []);
  return light ? AMBER_DARK : desk.amber;
}

// ---------------------------------------------------------------------------
// the tab
// ---------------------------------------------------------------------------

export function SettingsTab() {
  const amber = useAmber();
  const [sort, setSort] = useQueryState<string>('sort', '', { read: (r) => ((SORTS as readonly string[]).includes(r) ? r : null), write: (v) => v || null });
  const [desc, setDesc] = useQueryState<boolean>('desc', false, { read: (r) => r === '1', write: (v) => (v ? '1' : null) });
  const [edit, setEdit] = useQueryState<string>('edit', '', asText);
  const { data, error, reload } = useLoad<{ settings: Setting[] }>(() => api.hostingAdmin<{ settings: Setting[] }>('/settings'), []);

  const rows = useSorted(data?.settings, sort || null, desc, (r, k) => {
    switch (k) {
      case 'setting': return r.label.toLowerCase();
      case 'value': return r.toSet ? null : r.words;
      case 'on': return r.switchable ? (r.isOn === false ? 0 : 1) : null;
      case 'changed': return r.changedAt;
      case 'by': return r.changedBy;
      default: return null;
    }
  });

  const toSet = data ? data.settings.filter((r) => r.toSet).length : null;

  const columns: Col<Setting>[] = [
    { key: 'setting', label: 'Setting', grow: true, sort: 'setting', tip: ['Setting', 'What it controls. Each one is read when it is used, never copied into code.'],
      cell: (r) => <Text style={[s.word, { fontWeight: '600' }, r.toSet && { color: amber }]}>{r.label}</Text> },
    { key: 'value', label: 'Value', width: 440, sort: 'value',
      tip: ['Value', 'What is in force now. A fee change applies to bookings made after it, never to existing ones.'],
      cellTip: (r) => (r.toSet ? ['To set', 'No value yet. Anything depending on it shows a dash.'] : null),
      cell: (r) => (r.toSet
        ? <Text style={[s.word, { color: amber, fontWeight: '700' }]}>— To set</Text>
        : <Text style={[s.word, r.isOn === false && { color: colors.inkMuted }]}>{r.words}</Text>) },
    { key: 'on', label: 'On', width: 60, align: 'centre', sort: 'on',
      tip: ['On', 'Some rules can be switched off without losing their value. A dash where a rule cannot be switched off.'],
      cell: (r) => (r.switchable ? <Word strong={r.isOn !== false} muted={r.isOn === false}>{r.isOn === false ? 'Off' : 'On'}</Word> : <Blank />) },
    { key: 'changed', label: 'Changed', width: 96, sort: 'changed', tip: ['Changed', 'When it was last changed.'],
      cell: (r) => (r.changedAt ? <Word>{when(r.changedAt)}</Word> : <Blank />) },
    { key: 'by', label: 'By', width: 200, sort: 'by', tip: ['By', 'Who changed it last.'],
      cell: (r) => (r.changedBy ? <Word>{r.changedBy}</Word> : <Blank />) },
  ];

  const editing = data?.settings.find((r) => r.key === edit) ?? null;
  const editor = editing ? (
    <SettingEditor key={editing.key} setting={editing}
      onClose={() => setEdit('')}
      onSaved={() => { reload(); }} />
  ) : null;
  const lastIsOpen = rows.length > 0 && rows[rows.length - 1].key === edit;

  return (
    <View style={{ gap: spacing.lg }}>
      <PageHead kicker="Hosting · Settings" title="Rates and rules"
        right={(
          <View style={s.stats}>
            <Stat label="Settings" value={data ? data.settings.length : '—'} tip={['Settings', 'Each one is read when it is used, never copied into code.']} />
            <Stat label="To set" value={toSet ?? '—'} accent={false} tip={['To set', 'No value yet. Anything depending on them shows a dash.']} />
          </View>
        )} />

      {error ? <Banner tone="crit">{error}</Banner> : null}

      {data ? (
        <View>
          <Ladder columns={columns} rows={rows} keyOf={(r) => r.key}
            sort={sort || null} desc={desc}
            onSort={(k) => { if (k === sort) setDesc(!desc); else { setSort(k); setDesc(false); } }}
            onRow={(r) => setEdit(r.key === edit ? '' : r.key)}
            highlight={(r) => r.key === edit}
            label={(r) => `Change ${r.label}`}
            // The editor opens under its own row: drawn as the "heading" of the
            // row after it, or after the table when it is the last row.
            groupOf={(_r, prev) => (prev && prev.key === edit ? editor : null)}
            phoneRow={(r) => ({
              name: r.label,
              note: r.toSet ? '— To set' : r.words,
              chips: [
                ...(r.switchable ? [{ key: 'on', word: r.isOn === false ? 'Off' : 'On', tip: columns[2].tip }] : []),
                { key: 'changed', word: r.changedAt ? when(r.changedAt) : '—', tip: columns[3].tip },
                ...(r.changedBy ? [{ key: 'by', word: r.changedBy, tip: columns[4].tip }] : []),
              ],
            })} />
          {lastIsOpen ? editor : null}
        </View>
      ) : error ? null : <Text style={type.small}>…</Text>}
    </View>
  );
}

// ---------------------------------------------------------------------------
// the editor
// ---------------------------------------------------------------------------

const intOf = (raw: string): number | null => (/^\s*\d+\s*$/.test(raw) ? Number(raw.trim()) : null);
const numOf = (raw: string): number | null => (/^\s*\d+(\.\d+)?\s*$/.test(raw) ? Number(raw.trim()) : null);
const penceOf = (raw: string): number | null => {
  const t = raw.trim().replace(/^£/, '');
  return /^\d+(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : null;
};
const pounds = (p: unknown) => (typeof p === 'number' ? (p / 100).toFixed(2) : '');
const str = (v: unknown) => (v == null ? '' : String(v));

type Parsed = { ok: true; value: unknown } | { ok: false; why: string };

function SettingEditor({ setting, onClose, onSaved }: { setting: Setting; onClose: () => void; onSaved: () => void }) {
  const v = setting.value as any;
  const [f, setF] = useState<Record<string, string>>((): Record<string, string> => {
    switch (setting.unit) {
      case 'pence': return { n: pounds(v) };
      case 'percent': case 'days': case 'hours': case 'months': return { n: str(v) };
      case 'intro': return { days: str(v?.days), bookings: str(v?.bookings) };
      case 'tip': return { pct: str(v?.pct), min: pounds(v?.minPence) };
      case 'on_request': return { notice: str(v?.noticeHours), perWeek: str(v?.perWeek) };
      default: return {};
    }
  });
  const [flag, setFlag] = useState<boolean>(typeof v === 'boolean' ? v : true);
  const [steps, setSteps] = useState<{ pct: string; rated: string; avg: string }[]>(() =>
    (Array.isArray(v) ? v as LadderStep[] : [{ pct: 20 }]).map((x) => ({ pct: str(x.pct), rated: str(x.ratedEvents), avg: str(x.avgAtLeast) })));
  const [tiers, setTiers] = useState<Record<'flexible' | 'moderate' | 'strict', { part: boolean; hours: string; pct: string }>>(() => {
    const t = (x?: RefundTier) => (x?.partHoursBefore != null
      ? { part: true, hours: str(x.partHoursBefore), pct: str(x.partPct) }
      : { part: false, hours: str(x?.fullHoursBefore), pct: '' });
    return { flexible: t(v?.flexible), moderate: t(v?.moderate), strict: t(v?.strict) };
  });
  const [pairs, setPairs] = useState<{ name: string; n: string }[]>(() =>
    (v && typeof v === 'object' && !Array.isArray(v) && setting.unit === 'thresholds'
      ? Object.entries(v as Record<string, number>).map(([name, n]) => ({ name, n: String(n) }))
      : [{ name: '', n: '' }]));
  const [isOn, setIsOn] = useState<boolean>(setting.isOn !== false);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ tone: 'accent' | 'crit'; words: string; detail?: string } | null>(null);

  const parsed: Parsed = useMemo(() => {
    const bad = (why: string): Parsed => ({ ok: false, why });
    switch (setting.unit) {
      case 'pence': { const p = penceOf(f.n ?? ''); return p == null ? bad('Pounds and pence, like 1.50') : { ok: true, value: p }; }
      case 'percent': { const p = numOf(f.n ?? ''); return p == null || p > 100 ? bad('A percentage from 0 to 100') : { ok: true, value: p }; }
      case 'days': case 'hours': case 'months': { const n = intOf(f.n ?? ''); return n == null ? bad('A whole number') : { ok: true, value: n }; }
      case 'switch': return { ok: true, value: flag };
      case 'intro': {
        const days = intOf(f.days ?? ''); const bookings = intOf(f.bookings ?? '');
        return days == null || bookings == null ? bad('Days and bookings are whole numbers') : { ok: true, value: { days, bookings } };
      }
      case 'tip': {
        const pct = numOf(f.pct ?? ''); const minPence = penceOf(f.min ?? '');
        return pct == null || pct > 100 || minPence == null ? bad('A percentage and a minimum in pounds') : { ok: true, value: { pct, minPence } };
      }
      case 'on_request': {
        const noticeHours = intOf(f.notice ?? ''); const perWeek = intOf(f.perWeek ?? '');
        return noticeHours == null || perWeek == null || perWeek < 1 ? bad('Notice in hours, and at least 1 a week') : { ok: true, value: { noticeHours, perWeek } };
      }
      case 'ladder': {
        const out: LadderStep[] = [];
        for (let i = 0; i < steps.length; i += 1) {
          const pct = numOf(steps[i].pct);
          if (pct == null || pct > 100) return bad(`Step ${i + 1}: a percentage`);
          if (i === 0) { out.push({ pct }); continue; }
          const ratedEvents = intOf(steps[i].rated); const avgAtLeast = numOf(steps[i].avg);
          if (ratedEvents == null || ratedEvents < 1 || avgAtLeast == null || avgAtLeast > 5) return bad(`Step ${i + 1}: rated events and an average up to 5`);
          out.push({ pct, ratedEvents, avgAtLeast });
        }
        return { ok: true, value: out };
      }
      case 'refunds': {
        const out: Record<string, RefundTier> = {};
        for (const k of ['flexible', 'moderate', 'strict'] as const) {
          const t = tiers[k]; const hours = intOf(t.hours);
          if (hours == null) return bad(`${k[0].toUpperCase()}${k.slice(1)}: hours before`);
          if (t.part) {
            const pct = numOf(t.pct);
            if (pct == null || pct > 100) return bad(`${k[0].toUpperCase()}${k.slice(1)}: a percentage`);
            out[k] = { partHoursBefore: hours, partPct: pct };
          } else out[k] = { fullHoursBefore: hours };
        }
        return { ok: true, value: out };
      }
      case 'thresholds': {
        const out: Record<string, number> = {};
        for (const p of pairs) {
          if (!p.name.trim() && !p.n.trim()) continue;
          const n = Number(p.n.trim());
          if (!p.name.trim() || p.n.trim() === '' || !Number.isFinite(n)) return bad('Each threshold needs a name and a number');
          out[p.name.trim()] = n;
        }
        return Object.keys(out).length ? { ok: true, value: out } : bad('At least one threshold');
      }
      default: return bad(`Epic does not know how to edit ${setting.unit}`);
    }
  }, [setting.unit, f, flag, steps, tiers, pairs]);

  const valueChanged = parsed.ok && JSON.stringify(parsed.value) !== JSON.stringify(setting.value);
  const onChanged = setting.switchable && isOn !== (setting.isOn !== false);
  const ready = parsed.ok && (valueChanged || onChanged) && why.trim().length > 0 && !busy;

  const save = async () => {
    if (!parsed.ok) return;
    setBusy(true); setSaid(null);
    try {
      const body: Record<string, unknown> = { why: why.trim() };
      if (valueChanged) body.value = parsed.value;
      if (onChanged) body.isOn = isOn;
      await api.hostingAdminPut(`/settings/${encodeURIComponent(setting.key)}`, body);
      setSaid({ tone: 'accent', words: 'Saved' });
      onSaved();
    } catch (e: any) {
      if (e instanceof ApiError && e.code === 'needs_personal_sign_in') {
        setSaid({
          tone: 'crit',
          words: 'This needs the owner signed in personally. An agent files it for approval instead.',
          detail: typeof e.body?.message === 'string' ? e.body.message : undefined,
        });
      } else setSaid({ tone: 'crit', words: e?.message ?? 'That didn’t save.' });
    } finally {
      setBusy(false);
    }
  };

  const box = (key: string, width = 80, placeholder?: string) => (
    <TextInput value={f[key] ?? ''} onChangeText={(t) => setF((x) => ({ ...x, [key]: t }))}
      keyboardType="decimal-pad" placeholder={placeholder} placeholderTextColor={colors.inkMuted}
      style={[s.input, { width }]} accessibilityLabel={`${setting.label} ${key}`} />
  );
  const small = (value: string, onChange: (t: string) => void, label: string, width = 64) => (
    <TextInput value={value} onChangeText={onChange} keyboardType="decimal-pad" placeholderTextColor={colors.inkMuted}
      style={[s.input, { width }]} accessibilityLabel={label} />
  );

  let fields: React.ReactNode;
  switch (setting.unit) {
    case 'pence': fields = <Line><Unit>£</Unit>{box('n', 90, '0.00')}</Line>; break;
    case 'percent': fields = <Line>{box('n')}<Unit>%</Unit></Line>; break;
    case 'hours': fields = <Line>{box('n')}<Unit>hours</Unit></Line>; break;
    case 'days': fields = <Line>{box('n')}<Unit>days before</Unit></Line>; break;
    case 'months': fields = <Line>{box('n')}<Unit>months</Unit></Line>; break;
    case 'switch': fields = <Line><Choice label="On" on={flag} onPress={() => setFlag(true)} /><Choice label="Off" on={!flag} onPress={() => setFlag(false)} /></Line>; break;
    case 'intro': fields = <Line>{box('days')}<Unit>days or</Unit>{box('bookings')}<Unit>bookings</Unit></Line>; break;
    case 'tip': fields = <Line>{box('pct')}<Unit>%, minimum £</Unit>{box('min', 80, '0.30')}</Line>; break;
    case 'on_request': fields = <Line>{box('notice')}<Unit>hours notice ·</Unit>{box('perWeek')}<Unit>a week</Unit></Line>; break;
    case 'ladder': fields = (
      <View style={{ gap: 8 }}>
        {steps.map((st, i) => (
          <Line key={i}>
            <Unit>{i === 0 ? 'To start' : `Step ${i}`}</Unit>
            {small(st.pct, (t) => setSteps((x) => x.map((y, j) => (j === i ? { ...y, pct: t } : y))), `Step ${i} percent`)}
            <Unit>%</Unit>
            {i > 0 ? (
              <>
                <Unit>after</Unit>
                {small(st.rated, (t) => setSteps((x) => x.map((y, j) => (j === i ? { ...y, rated: t } : y))), `Step ${i} rated events`)}
                <Unit>rated events averaging</Unit>
                {small(st.avg, (t) => setSteps((x) => x.map((y, j) => (j === i ? { ...y, avg: t } : y))), `Step ${i} average`)}
                <Unit>+</Unit>
                <TextAction label="Remove" tone="muted" onPress={() => setSteps((x) => x.filter((_y, j) => j !== i))} />
              </>
            ) : null}
          </Line>
        ))}
        {steps.length < 6 ? <TextAction label="Add a step" onPress={() => setSteps((x) => [...x, { pct: '', rated: '', avg: '' }])} /> : null}
      </View>
    ); break;
    case 'refunds': fields = (
      <View style={{ gap: 8 }}>
        {(['flexible', 'moderate', 'strict'] as const).map((k) => {
          const t = tiers[k];
          const set = (patch: Partial<typeof t>) => setTiers((x) => ({ ...x, [k]: { ...x[k], ...patch } }));
          return (
            <Line key={k}>
              <View style={{ width: 80 }}><Unit>{`${k[0].toUpperCase()}${k.slice(1)}`}</Unit></View>
              <Choice label="Full" on={!t.part} onPress={() => set({ part: false })} />
              <Choice label="Part" on={t.part} onPress={() => set({ part: true })} />
              {t.part ? <>{small(t.pct, (x) => set({ pct: x }), `${k} percent`)}<Unit>% up to</Unit></> : <Unit>up to</Unit>}
              {small(t.hours, (x) => set({ hours: x }), `${k} hours`)}
              <Unit>hours before</Unit>
            </Line>
          );
        })}
      </View>
    ); break;
    case 'thresholds': fields = (
      <View style={{ gap: 8 }}>
        {pairs.map((p, i) => (
          <Line key={i}>
            <TextInput value={p.name} onChangeText={(t) => setPairs((x) => x.map((y, j) => (j === i ? { ...y, name: t } : y)))}
              placeholder="name" placeholderTextColor={colors.inkMuted} style={[s.input, { width: 200 }]} accessibilityLabel={`Threshold ${i + 1} name`} />
            {small(p.n, (t) => setPairs((x) => x.map((y, j) => (j === i ? { ...y, n: t } : y))), `Threshold ${i + 1} value`, 80)}
            {pairs.length > 1 ? <TextAction label="Remove" tone="muted" onPress={() => setPairs((x) => x.filter((_y, j) => j !== i))} /> : null}
          </Line>
        ))}
        {pairs.length < 12 ? <TextAction label="Add a threshold" onPress={() => setPairs((x) => [...x, { name: '', n: '' }])} /> : null}
      </View>
    ); break;
    default: fields = <Blank />;
  }

  return (
    <View style={s.editor}>
      <Kicker tip={['Change', 'Saved changes need the owner signed in personally, and appear in Changes with the reason.']}>{setting.label}</Kicker>
      {fields}
      {setting.switchable ? (
        <Line>
          <Unit>Rule is</Unit>
          <Choice label="On" on={isOn} onPress={() => setIsOn(true)} />
          <Choice label="Off" on={!isOn} onPress={() => setIsOn(false)} />
        </Line>
      ) : null}
      {!parsed.ok ? <Text style={[s.word, { color: colors.inkMuted }]}>{parsed.why}</Text> : null}
      <TextInput value={why} onChangeText={setWhy} placeholder="Why" placeholderTextColor={colors.inkMuted}
        style={[s.input, { alignSelf: 'stretch' }]} maxLength={500} accessibilityLabel="Why this is changing" />
      {said ? <Banner tone={said.tone}>{said.words}</Banner> : null}
      {said?.detail ? <Text style={[s.word, { color: colors.inkMuted }]}>{said.detail}</Text> : null}
      <Footer>
        <Act tone="solid" label={busy ? '…' : 'Save'} icon="check" onPress={save} disabled={!ready} />
        <Act tone="secondary" label="Close" onPress={onClose} />
      </Footer>
    </View>
  );
}

const Line = ({ children }: { children: React.ReactNode }) => <View style={s.line}>{children}</View>;
const Unit = ({ children }: { children: React.ReactNode }) => <Text style={s.unit}>{children}</Text>;

const s = StyleSheet.create({
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 34, alignItems: 'flex-end' },
  word: { ...type.body, fontSize: 13.5, color: colors.ink },
  editor: {
    gap: 12, paddingVertical: 16, paddingHorizontal: 12,
    borderTopWidth: BORDER, borderTopColor: colors.ruleMuted, borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted,
  },
  line: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  unit: { ...type.small, fontSize: 13, color: colors.inkMuted },
  input: {
    fontFamily: fonts.body, fontSize: 13.5, color: colors.ink, paddingVertical: 6, paddingHorizontal: 4,
    borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted, backgroundColor: 'transparent', fontVariant: ['tabular-nums'],
  },
});
