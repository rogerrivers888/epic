import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { api, ApiError, CollectionPlace, CollectionRow, Collections } from '../api';
import { colors, fonts, type } from '../theme';
import { Icon } from './Icon';
import { Press } from './press';
import { VenueThumb } from './VenueThumb';

/**
 * Collections as a family sees them — the prototype's household phone
 * (Epic Labelling prototype, "See as a household": template `isHousehold`,
 * logic.js `phoneRow`; README v2 "Collections"; handover 4.11, D6–D11).
 *
 * A collection is a row: its title, one line under it, a heart, and — once it
 * is hearted — a shelf of the places it holds near home. What is shown and in
 * what order is decided by the API (routes/collections.js), from the same
 * code the back office's "See as a household" reads; this only draws it.
 *
 * Drawn here once and used by both Inspire and the back office's preview, so
 * the preview is drawn the way a family's phone is. The palette is passed in
 * because the preview always draws the app's light phone inside the dark desk.
 */

export type RowPalette = {
  ink: string; inkMuted: string; warm: string; lineSoft: string; ruleMuted: string; ruleSoft: string;
};

const appPalette = (): RowPalette => ({
  ink: colors.ink, inkMuted: colors.inkMuted, warm: colors.warm, lineSoft: colors.lineSoft,
  ruleMuted: colors.ruleMuted, ruleSoft: colors.ruleSoft,
});

/** "Nothing near you this week" — the prototype's line for a hearted row that is waiting. */
export const WAITING_LINE = 'Nothing near you this week — it comes back when there is';

/** The line under a row's title: its copy, or how many places are near — never a number we could not count. */
export function subOf(r: CollectionRow): string {
  if (r.waiting) return WAITING_LINE;
  if (r.copy) return r.copy;
  if (r.places == null) return '';
  return `${r.places}${r.placesAtLeast ? '+' : ''} ${r.places === 1 && !r.placesAtLeast ? 'place' : 'places'} near you`;
}

/** One collection row, as the prototype's `phoneRow` draws it. */
export function CollectionRowView({ row, onHeart, onOpenPlace, wide = false, palette }: {
  row: CollectionRow;
  onHeart: (row: CollectionRow) => void;
  onOpenPlace?: (place: CollectionPlace, row: CollectionRow) => void;
  /** A wider window gets bigger tiles; the tree is the same. */
  wide?: boolean;
  palette?: RowPalette;
}) {
  const p = palette ?? appPalette();
  const sub = subOf(row);
  const tileW = wide ? 150 : 106;
  const tileH = wide ? 104 : 74;
  // The prototype: a shelf on a hearted row that is not waiting.
  const showShelf = row.hearted && !row.waiting && row.shelf.length > 0;
  return (
    <View style={{ gap: 3, paddingVertical: 11, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: p.lineSoft, backgroundColor: row.hearted ? p.warm : 'transparent' }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={{ fontFamily: fonts.heading, fontSize: 16.5, fontWeight: '800', letterSpacing: -0.33, color: p.ink }}>{row.title}</Text>
            {row.waiting ? (
              <Text style={{ fontFamily: fonts.body, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.38, borderWidth: 1, borderColor: p.inkMuted, color: p.inkMuted, paddingVertical: 1, paddingHorizontal: 5 }}>WAITING</Text>
            ) : null}
          </View>
          {sub ? <Text style={{ fontFamily: fonts.body, fontSize: 13, lineHeight: 18.2, color: p.inkMuted }}>{sub}</Text> : null}
        </View>
        <Press
          effect="none"
          onPress={() => onHeart(row)}
          accessibilityRole="button"
          accessibilityLabel={row.hearted ? `Unheart ${row.title}` : `Heart ${row.title}`}
          style={{ paddingTop: 2 }}
        >
          <Icon name="keep" size={21} color={p.ink} fill={row.hearted} fillColor={p.ink} strokeWidth={2} />
        </Press>
      </View>
      {showShelf ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 7 }}>
          {row.shelf.map((place) => (
            <Press
              key={place.ref}
              effect="sink"
              disabled={!onOpenPlace}
              onPress={() => onOpenPlace?.(place, row)}
              accessibilityRole="button"
              accessibilityLabel={place.name}
              style={{ width: tileW, gap: 5 }}
            >
              {place.image ? (
                <VenueThumb name={place.name} image={place.image} width={tileW} height={tileH} credit={false} />
              ) : (
                // The prototype's tile: the drawer's name on a dashed warm ground.
                <View style={{ width: tileW, height: tileH, borderRadius: 8, backgroundColor: p.warm, borderWidth: 1, borderStyle: 'dashed', borderColor: p.ruleMuted, justifyContent: 'flex-end', padding: 7 }}>
                  <Text style={{ fontFamily: fonts.body, fontSize: 10, fontWeight: '700', letterSpacing: 0.3, lineHeight: 12, color: p.inkMuted }}>{place.kind ?? ''}</Text>
                </View>
              )}
              <Text numberOfLines={2} style={{ fontFamily: fonts.body, fontSize: 11.5, fontWeight: '600', lineHeight: 14.4, color: p.ink }}>{place.name}</Text>
            </Press>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

/** "Whose list is this?" — asked on the first heart, once (prototype `askWho`). */
export function WhoseList({ members, onChoose, palette }: {
  members: Collections['members'];
  onChoose: (member: { id: string; name: string }) => void;
  palette?: RowPalette;
}) {
  const p = palette ?? appPalette();
  return (
    <View style={{ gap: 12, paddingTop: 14, paddingHorizontal: 18, paddingBottom: 18, borderTopWidth: 1, borderBottomWidth: 1, borderColor: p.ruleSoft, backgroundColor: p.warm }}>
      <Text style={{ fontFamily: fonts.body, fontSize: 16, fontWeight: '700', lineHeight: 20.8, color: p.ink }}>Whose list is this?</Text>
      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
        {members.map((m) => (
          <Press key={m.id} effect="sink" style={{ flex: 1, minWidth: 64 }} onPress={() => onChoose(m)} accessibilityRole="button" accessibilityLabel={m.name}>
            <View style={{ alignItems: 'center', gap: 6 }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: p.ink, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: fonts.heading, fontSize: 17, fontWeight: '800', color: p.ink }}>{m.name.slice(0, 1)}</Text>
              </View>
              <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600', color: p.ink, textAlign: 'center' }}>{m.name}{!m.adult && m.age != null ? ` · ${m.age}` : ''}</Text>
            </View>
          </Press>
        ))}
      </View>
      <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: p.inkMuted }}>Asked once. Every heart after this is attributed to them.</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// The household's own collections, and its hearts.

/** Whose list this device is — the answer to the first heart, kept on the device. */
const WHOSE_KEY = 'epic.collections.whose';
const canStore = Platform.OS === 'web' && typeof localStorage !== 'undefined';
// Where the device cannot store it (the phone apps), the answer is still kept
// for as long as the app is open — never asked again at every heart (Codex).
let whoseInMemory: string | null = null;
const savedWhose = () => (canStore ? localStorage.getItem(WHOSE_KEY) : whoseInMemory);
const saveWhose = (id: string | null) => {
  whoseInMemory = id;
  if (!canStore) return;
  if (id) localStorage.setItem(WHOSE_KEY, id); else localStorage.removeItem(WHOSE_KEY);
};

/**
 * The household's collections, with the heart and the first-heart question.
 * A heart is shown at once and the list is asked again for its order, so a
 * hearted row rises the way the API says it does.
 */
export function useCollections() {
  const [data, setData] = useState<Collections | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The row whose heart is waiting on "Whose list is this?". */
  const [asking, setAsking] = useState<CollectionRow | null>(null);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  const load = useCallback(async () => {
    try {
      const got = await api.collections(savedWhose());
      if (!live.current) return;
      // A name the API did not recognise is forgotten, and asked again.
      if (savedWhose() && !got.whose && !got.whoseFixed) saveWhose(null);
      setData(got); setError(null);
    } catch (err) {
      if (live.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const mark = (key: string, on: boolean) => setData((d) => (d ? {
    ...d,
    inspire: d.inspire.map((r) => (r.key === key ? { ...r, hearted: on } : r)),
    list: d.list.map((r) => (r.key === key ? { ...r, hearted: on } : r)),
  } : d));

  const send = async (row: CollectionRow, on: boolean, member: string | null) => {
    mark(row.key, on);
    try {
      await api.heartCollection(row.key, { on, member });
    } catch (err) {
      mark(row.key, !on);
      if (err instanceof ApiError && err.code === 'whose_list') { saveWhose(null); setAsking(row); }
      else setError(err instanceof Error ? err.message : String(err));
    }
    await load();
  };

  const heart = (row: CollectionRow) => {
    const who = data?.whose?.id ?? null;
    if (row.hearted) { void send(row, false, who); return; }
    // The first heart asks whose list this is (prototype `toggleHeart`).
    if (!who) { setAsking(row); return; }
    void send(row, true, who);
  };

  const choose = (m: { id: string }) => {
    saveWhose(m.id);
    const row = asking;
    setAsking(null);
    if (row) void send(row, true, m.id); else void load();
  };

  return { data, error, heart, asking, choose, cancelAsk: () => setAsking(null), reload: load };
}

/** The head over a run of collection rows: its name, and whose hearts they are. */
export function CollectionsHead({ title, whose, action, onAction }: {
  title: string; whose: Collections['whose']; action?: string; onAction?: () => void;
}) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6, paddingHorizontal: 18, paddingBottom: 8 }}>
      <Text style={type.h2}>{title}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 14 }}>
        {whose ? <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: colors.inkMuted }}>{whose.name}’s hearts</Text> : null}
        {action && onAction ? (
          <Press effect="none" onPress={onAction} accessibilityRole="button">
            <Text style={[type.small, { color: colors.accent, fontWeight: '700' }]}>{action}</Text>
          </Press>
        ) : null}
      </View>
    </View>
  );
}
