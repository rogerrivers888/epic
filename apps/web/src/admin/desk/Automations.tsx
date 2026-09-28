/**
 * Fact automations — what the machine does on its own, in the order it
 * happens (design README v2 "Fact automations"; prototype block `isFactRules`,
 * its `RULE_STEPS` and `RULE_HOUSEKEEPING`).
 *
 * Five numbered steps — Spot, Verify, Add to the subcategory, Re-check,
 * Families confirm — each a sentence per row with its setting inline, and the
 * step's info box under its rows. Then Housekeeping. No change log here: every
 * change is written to Changes by the API (`PUT /settings/:key`), which hands
 * back the change's id so the toast can offer Undo.
 *
 * **One deliberate departure from the prototype.** The prototype draws each
 * number as − value +. The owner's standing rule is "never a plus/minus on a
 * number — numbers are typed into a small box" (`Stepper` in
 * components/ui.tsx is that box), so the value here is typed, in the
 * prototype's own lime 14px/800 figure inside the same 1px ruled well, and
 * committed on Enter or on leaving the box.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';

import { Icon } from '../../components/Icon';
import { Press } from '../../components/press';
import { Wide } from '../filing/desk';
import { LIME, Muted, ON_LIME, deskApi, desk, fonts, saidOf, tabular, useToast } from './kit';

type Spec = { kind: 'int' | 'bool' | 'bands' | 'cost'; min?: number; max?: number; step?: number; unit?: string };
type SettingsData = { values: Record<string, unknown>; spec: Record<string, Spec> };
type Saved = { changed: boolean; value: unknown; version?: number; change?: string };

/**
 * A row is a sentence in segments: plain text, `#key` a number setting (with a
 * trailing `%` when its unit is a share), `?key` a switch. The prototype's own
 * copy, word for word.
 */
type Seg = string;
const STEPS: { no: string; name: string; rows: Seg[][]; note: string }[] = [
  { no: '1', name: 'Spot', rows: [
    ['A review mentions a feature at a place → we go and look for it on our own sources · ', '#spotMentions', ' mention'],
    ['A household is shown “reviewers mention a sauna” during its search once ', '#suggestReviews', ' separate reviews say so and none say no'],
  ], note: '' },
  { no: '2', name: 'Verify', rows: [
    ['Verified: ', '#verifySources', ' or more of our own sources say yes and none say no · venue page, OpenStreetMap, Wikipedia, Wikidata'],
    ['When our sources disagree, the venue’s own website wins', '?venueWins'],
  ], note: 'One of our own sources must say yes and none say no. If they disagree, the venue’s own website wins. If the website says nothing, it is kept private until families who visit settle it.' },
  { no: '3', name: 'Add to the subcategory', rows: [
    ['Once verified at ', '#addPlaces', ' or more places, it joins the subcategory’s facts, looked for as each place comes up · listed under New facts'],
    ['Not added if more than ', '#shareMax%', ' of places already have it — it tells a family nothing · access and age facts are exempt'],
  ], note: 'Opinions and conditions never become facts — “friendly staff” or “busy at weekends” tell a family nothing they can plan around.' },
  { no: '4', name: 'Re-check', rows: [
    ['Physical features are re-checked every ', '#recheckPhysical', ' months'],
    ['Access features are re-checked every ', '#recheckAccess', ' months'],
    ['Food and dietary facts are re-checked every ', '#recheckFood', ' months'],
  ], note: 'A re-check happens the next time a search brings the place up after that — never a sweep.' },
  { no: '5', name: 'Families confirm', rows: [
    ['Ask families about a fact after their visit, only where it matters to them — a toddler pool only to households with a toddler · at most ', '#askPerVisit', ' question per visit'],
    ['', '#familiesSettle', ' or more families agreeing, none disagreeing, settles a fact'],
    ['If ', '#familiesWrong', ' or more families say a fact is wrong, it’s hidden and re-checked when next due; if our sources confirm it again, the next families who visit are asked'],
    ['A conflict between our sources is never shown; families who visit settle it'],
  ], note: 'Families who have been are one of our own sources. We only ask about what matters to them, once per visit, and their answers settle anything our other sources can’t.' },
];
const HOUSEKEEPING: Seg[] = ['A suggestion still in the backlog is dropped after ', '#suggestExpiry', ' days; it comes back the next time a search finds the place'];

const keyOf = (seg: Seg) => seg.replace(/[#%?]/g, '');
const isNum = (seg: Seg) => seg.startsWith('#');
const isSwitch = (seg: Seg) => seg.startsWith('?');
const pct = (seg: Seg) => seg.endsWith('%');

/** The sentence with its numbers filled in, as Changes records it. */
function sentence(segs: Seg[], values: Record<string, unknown>, over?: Record<string, unknown>) {
  return segs.filter((s) => !isSwitch(s)).map((s) => {
    if (!isNum(s)) return s;
    const k = keyOf(s);
    const v = over && k in over ? over[k] : values[k];
    return `${v ?? '—'}${pct(s) ? '%' : ''}`;
  }).join('');
}

export function Automations({ canManage = false }: { canManage?: boolean }) {
  const toast = useToast();
  const [data, setData] = useState<SettingsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    deskApi.get<SettingsData>('/settings')
      .then((d) => { setData(d); setError(null); })
      .catch((err) => setError(saidOf(err) || 'The settings did not load.'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (segs: Seg[], key: string, value: number | boolean) => {
    if (!data) return;
    const was = data.values[key];
    // Drawn at once; put back if the API refuses.
    setData((d) => (d ? { ...d, values: { ...d.values, [key]: value } } : d));
    try {
      const out = await deskApi.put<Saved>(`/settings/${encodeURIComponent(key)}`, {
        value, what: sentence(segs, data.values, { [key]: value }),
      });
      if (!out.changed) return;
      const unit = data.spec[key]?.unit === '%' ? '%' : '';
      const text = typeof value === 'boolean'
        ? `Rule turned ${value ? 'on' : 'off'}`
        : `Rule changed · ${was}${unit} → ${value}${unit}`;
      const change = out.change;
      toast(text, change ? () => {
        deskApi.post(`/undo/${encodeURIComponent(change)}`)
          .then(() => { load(); toast('Undone'); })
          .catch((err) => toast(saidOf(err)));
      } : null);
    } catch (err) {
      setData((d) => (d ? { ...d, values: { ...d.values, [key]: was } } : d));
      toast(saidOf(err));
    }
  }, [data, load, toast]);

  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>Loading…</Muted>;

  const setting = (segs: Seg[]) => segs.filter(isNum).map((s) => {
    const k = keyOf(s);
    const spec = data.spec[k] ?? { kind: 'int' };
    return (
      <NumberBox
        key={k}
        value={Number(data.values[k])}
        percent={pct(s)}
        min={spec.min ?? 0}
        max={spec.max ?? 999}
        step={spec.step ?? 1}
        editable={canManage}
        onCommit={(v) => { void save(segs, k, v); }}
      />
    );
  });

  const switches = (segs: Seg[]) => segs.filter(isSwitch).map((s) => {
    const k = keyOf(s);
    const on = data.values[k] === true;
    return <Switch key={k} on={on} disabled={!canManage} onFlip={() => { void save(segs, k, !on); }} />;
  });

  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 6, paddingBottom: 4 }}>
        <Text style={{ fontFamily: fonts.heading, fontWeight: '800', fontSize: 31, letterSpacing: -1.085, lineHeight: 32, color: desk.ink }}>Fact automations</Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 13, color: desk.inkDim }}>What the machine does on its own, in the order it happens.</Text>
      </View>

      <Wide min={900}>
        <View style={{ marginTop: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18, borderBottomWidth: 2, borderBottomColor: desk.ruleStrong, paddingTop: 12, paddingBottom: 9 }}>
            <Text style={[headCell, { width: 190 }]}>Step</Text>
            <Text style={[headCell, { flex: 1 }]}>What happens</Text>
            <Text style={[headCell, { width: 300 }]}>Setting</Text>
          </View>
          {STEPS.map((step) => (
            <React.Fragment key={step.no}>
              {step.rows.map((segs, i) => (
                <View key={i} style={{
                  flexDirection: 'row', alignItems: 'center', gap: 18, paddingVertical: 12,
                  borderTopWidth: i === 0 ? 2 : 1, borderTopColor: i === 0 ? desk.ruleStrong : desk.rule,
                }}>
                  <View style={{ width: 190, flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                    {i === 0 ? (
                      <>
                        <Text style={{ fontFamily: fonts.heading, fontSize: 13, fontWeight: '800', color: LIME }}>{step.no}</Text>
                        <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 13, fontWeight: '800', lineHeight: 17, color: desk.ink }}>{step.name}</Text>
                      </>
                    ) : null}
                  </View>
                  <Text style={{ flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 13.5, lineHeight: 20, color: desk.ink }}>{sentence(segs, data.values)}</Text>
                  <View style={{ width: 300, flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    {switches(segs)}
                    {setting(segs)}
                  </View>
                </View>
              ))}
              {step.note ? (
                <View style={{
                  flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginLeft: 208, marginBottom: 14,
                  paddingVertical: 11, paddingHorizontal: 14, backgroundColor: desk.picked, borderWidth: 1, borderColor: desk.rule,
                }}>
                  <View style={{ marginTop: 2 }}><Icon name="info" size={15} color={desk.inkDim} /></View>
                  <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 19.4, color: desk.inkMuted }}>{step.note}</Text>
                </View>
              ) : null}
            </React.Fragment>
          ))}
        </View>
      </Wide>

      <Wide min={900}>
        <View style={{ marginTop: 22 }}>
          <Text style={{
            fontFamily: fonts.heading, fontSize: 10, fontWeight: '700', letterSpacing: 0.7, color: desk.inkDim,
            paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: desk.ruleStrong,
          }}>HOUSEKEEPING</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: desk.rule }}>
            <Text style={{ flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 13.5, lineHeight: 20, color: desk.ink }}>{sentence(HOUSEKEEPING, data.values)}</Text>
            <View style={{ width: 300, flexDirection: 'row' }}>{setting(HOUSEKEEPING)}</View>
          </View>
        </View>
      </Wide>
    </View>
  );
}

const headCell = { fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600' as const, color: desk.inkDim };

/**
 * The number, typed: the prototype's lime 14px/800 figure in its 1px ruled
 * well, without the − and + either side (owner: numbers are typed into a
 * small box). Committed on Enter or on leaving the box, kept inside the
 * setting's bounds, and put back if what was typed is not a number.
 */
function NumberBox({ value, percent, min, max, step, editable, onCommit }: {
  value: number; percent: boolean; min: number; max: number; step: number; editable: boolean; onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = () => {
    const typed = Number(String(text).replace(/[^0-9]/g, ''));
    if (text.trim() === '' || !Number.isFinite(typed)) { setText(String(value)); return; }
    const stepped = step > 1 ? Math.round(typed / step) * step : Math.round(typed);
    const next = Math.min(max, Math.max(min, stepped));
    setText(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: desk.ruleStrong,
      backgroundColor: desk.well, paddingVertical: 4, paddingHorizontal: 9, minWidth: 58,
    }}>
      <TextInput
        value={text}
        onChangeText={setText}
        onBlur={commit}
        onSubmitEditing={commit}
        editable={editable}
        keyboardType="number-pad"
        inputMode="numeric"
        selectTextOnFocus
        accessibilityLabel="Setting"
        style={[{
          width: String(text).length > 2 ? 36 : 26, padding: 0, textAlign: percent ? 'right' : 'center',
          fontFamily: fonts.heading, fontSize: 14, fontWeight: '800', color: LIME,
        }, tabular, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
      />
      {percent ? <Text style={[{ fontFamily: fonts.heading, fontSize: 14, fontWeight: '800', color: LIME }, tabular]}>%</Text> : null}
    </View>
  );
}

/** The prototype's switch: a 40×22 track, lime when on, and its word beside it. */
function Switch({ on, disabled, onFlip }: { on: boolean; disabled?: boolean; onFlip: () => void }) {
  return (
    <Press effect="none" onPress={disabled ? undefined : onFlip} disabled={disabled} accessibilityRole="switch" accessibilityState={{ checked: on, disabled }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 40, height: 22, backgroundColor: on ? LIME : desk.ruleStrong }}>
          <View style={{ position: 'absolute', top: 2, left: on ? 20 : 2, width: 18, height: 18, backgroundColor: on ? ON_LIME : desk.inkDim }} />
        </View>
        <Text style={{ fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: on ? LIME : desk.inkDim }}>{on ? 'On' : 'Off'}</Text>
      </View>
    </Press>
  );
}
