/**
 * What the Categories screens share: the shapes they read from
 * `/api/admin/desk` (apps/api/src/desk/categories.js and facts.js), the
 * standard facts' names as README v2 spells them, and the toast's Undo.
 */

import React, { useState } from 'react';
import { Platform, Text, View } from 'react-native';

import { Icon } from '../../../components/Icon';
import { Press } from '../../../components/press';
import { useRouter } from '../../../router';
import { paths } from '../../../routes';
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
        fontFamily: fonts.body, fontSize: 15, fontWeight: weight, color: lime ? desk.link : desk.ink,
        borderBottomWidth: lime ? 1.5 : 0, borderBottomColor: LIME,
      }, tabular]}>{n}</Text>
    </View>
  );
  return onPress ? <Press effect="none" onPress={onPress}>{body}</Press> : body;
}

/**
 * The status pills: 1px ruled, the chosen one lime with ink letters. Every
 * pill carries its own rule and overlaps its neighbour's by one pixel, so a
 * row that wraps at 390px draws a clean grid rather than a box with a
 * dangling divider (fix pass, 28 Sep).
 */
export function PillBar<T extends string>({ options, value, onChange, padH = 16, padV = 8 }: {
  options: { key: T; name: string }[]; value: T | null; onChange: (v: T) => void; padH?: number; padV?: number;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'flex-start', maxWidth: '100%', paddingLeft: 1, paddingTop: 1 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Press key={o.key} effect="none" onPress={() => onChange(o.key)}>
            <Text style={{
              paddingVertical: padV, paddingHorizontal: padH, fontFamily: fonts.body, fontSize: 12.5,
              fontWeight: on ? '700' : '600', backgroundColor: on ? LIME : 'transparent', color: on ? ON_LIME : desk.inkDim,
              borderWidth: 1, borderColor: desk.ruleStrong, marginLeft: -1, marginTop: -1,
            }}>{o.name}</Text>
          </Press>
        );
      })}
    </View>
  );
}

/**
 * The page title's (i): its words on hover, and a click opens How it works
 * at the Categories section (the prototype's `how.categories`).
 */
export function HowTip({ text, size = 17 }: { text: string; size?: number }) {
  const { navigate } = useRouter();
  const [open, setOpen] = useState(false);
  const web = Platform.OS === 'web';
  return (
    <View style={{ position: 'relative', zIndex: open ? 40 : 1 }}>
      <Press
        effect="none"
        onHoverIn={web ? () => setOpen(true) : undefined}
        onHoverOut={web ? () => setOpen(false) : undefined}
        onPress={() => navigate(paths.how('categories'))}
        accessibilityLabel="How it works"
      >
        <Icon name="info" size={size} color={desk.inkDim} />
      </Press>
      {open ? (
        <View style={{
          position: 'absolute', top: size + 8, left: -10, width: 360, zIndex: 40,
          backgroundColor: desk.picked, borderWidth: 1, borderColor: desk.ruleStrong, paddingVertical: 11, paddingHorizontal: 14,
        }}>
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '500', lineHeight: 19.4, color: desk.inkMuted }}>{text}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** A count that is not a number yet says so: "—", never a 0 that means "we could not tell". */
export const count = (v: number | null | undefined, plus = '') => (v == null ? '—' : `${v.toLocaleString('en-GB')}${v ? plus : ''}`);

/** A small in-place option pill ("Yes", "No"), lime-ruled when it is the value. */
export function OptPill({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Press effect="none" onPress={onPress}>
      <Text style={{
        fontFamily: fonts.body, fontSize: 12, fontWeight: '700', borderWidth: 1.5,
        borderColor: on ? LIME : desk.ruleStrong, color: on ? desk.link : desk.inkMuted, paddingVertical: 3, paddingHorizontal: 8,
      }} numberOfLines={1}>{label}</Text>
    </Press>
  );
}

/** One plain sentence for a failed read. */
export function Failed({ err }: { err: unknown }) {
  return <Text style={{ fontFamily: fonts.body, fontSize: 13.5, color: desk.inkDim, paddingVertical: 22, paddingHorizontal: 8 }}>{saidOf(err)}</Text>;
}
