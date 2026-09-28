/**
 * What the Categories screens share: the shapes they read from
 * `/api/admin/desk` (apps/api/src/desk/categories.js and facts.js), the
 * standard facts' names as README v2 spells them, and the toast's Undo.
 */

import React from 'react';
import { Text, View } from 'react-native';

import { Press } from '../../../components/press';
import { LIME, ON_LIME, deskApi, desk, fonts, saidOf, tabular } from '../kit';

export type Change = { id: string; at?: string };
export type Option = { key: string; label: string };

/** The ten standard facts in README v2's words, in the handover's order. */
export const FACT_NAME: Record<string, string> = {
  indoor: 'Indoors',
  'step-free': 'Step free',
  parking: 'Parking',
  toilets: 'Toilets',
  'food-on-site': 'Food on site',
  'booking-required': 'Booking required',
  'dog-friendly': 'Dog friendly',
  'suits-ages': 'Who is it for',
  duration: 'Duration',
  'cost-band': 'Cost band',
};
/** README v2's order for the bulk bar's dropdown. */
export const FACT_ORDER = ['indoor', 'step-free', 'parking', 'toilets', 'food-on-site', 'booking-required', 'dog-friendly', 'suits-ages', 'duration', 'cost-band'];
export const factName = (key: string, label?: string | null) => FACT_NAME[key] ?? label ?? key;

/**
 * Undo one or several changes, newest first — the API refuses to undo an
 * older change to a thing while a newer one stands.
 */
export async function undoChanges(ids: string[], toast: (t: string) => void, after: () => void) {
  try {
    for (const id of [...ids].reverse()) await deskApi.post(`/undo/${id}`);
    toast('Undone');
  } catch (err) {
    toast(saidOf(err));
  }
  after();
}

/** The header count as the prototype draws it: kicker over a 15px number, centred. */
export function Count({ label, n, onPress, lime, align = 'center', weight = '800' }: {
  label: string; n: React.ReactNode; onPress?: () => void; lime?: boolean; align?: 'center' | 'flex-start' | 'flex-end'; weight?: '600' | '800';
}) {
  const body = (
    <View style={{ alignItems: align, gap: 2 }}>
      <Text style={{ fontFamily: fonts.heading, fontSize: 10, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase', color: desk.inkDim }}>{label}</Text>
      <Text style={[{
        fontFamily: fonts.body, fontSize: 15, fontWeight: weight, color: lime ? LIME : desk.ink,
        borderBottomWidth: lime ? 1.5 : 0, borderBottomColor: LIME,
      }, tabular]}>{n}</Text>
    </View>
  );
  return onPress ? <Press effect="none" onPress={onPress}>{body}</Press> : body;
}

/** The status pills: 1px ruled, the chosen one lime with ink letters. */
export function PillBar<T extends string>({ options, value, onChange, padH = 16, padV = 8 }: {
  options: { key: T; name: string }[]; value: T | null; onChange: (v: T) => void; padH?: number; padV?: number;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, borderColor: desk.ruleStrong, alignSelf: 'flex-start' }}>
      {options.map((o, i) => {
        const on = o.key === value;
        return (
          <Press key={o.key} effect="none" onPress={() => onChange(o.key)}>
            <Text style={{
              paddingVertical: padV, paddingHorizontal: padH, fontFamily: fonts.body, fontSize: 12.5,
              fontWeight: on ? '700' : '600', backgroundColor: on ? LIME : 'transparent', color: on ? ON_LIME : desk.inkDim,
              borderLeftWidth: i ? 1 : 0, borderLeftColor: desk.ruleStrong,
            }}>{o.name}</Text>
          </Press>
        );
      })}
    </View>
  );
}

/** A small in-place option pill ("Yes", "No"), lime-ruled when it is the value. */
export function OptPill({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Press effect="none" onPress={onPress}>
      <Text style={{
        fontFamily: fonts.body, fontSize: 12, fontWeight: '700', borderWidth: 1.5,
        borderColor: on ? LIME : desk.ruleStrong, color: on ? LIME : desk.inkMuted, paddingVertical: 3, paddingHorizontal: 8,
      }}>{label}</Text>
    </Press>
  );
}

/** One plain sentence for a failed read. */
export function Failed({ err }: { err: unknown }) {
  return <Text style={{ fontFamily: fonts.body, fontSize: 13.5, color: desk.inkDim, paddingVertical: 22, paddingHorizontal: 8 }}>{saidOf(err)}</Text>;
}
