import React, { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, HouseholdResponse, OwnedImage, PhotoFiled, PhotoWhere, Venue } from '../api';
import { useHere, accuracyWords } from '../hooks/useHere';
import { pickPlacePhoto, type PlacePhoto } from './pickPhoto';
import { Button, Row, Segmented, StatusLine } from './ui';
import { VenueRow } from './Visits';
import { MEDIA_RADIUS, MEDIA_RATIO } from './VenueThumb';
import { colors, fonts, radius, spacing, TARGET, type, BORDER } from '../theme';

/**
 * A place, from a photograph (owner, 12 Sep 2026: "it should also support a
 * photograph because I might want to just take a photograph of somewhere that
 * looks cool and just add it. It should just automatically add it to whichever
 * locations are stored that are closest to it").
 *
 * Three steps and no form: take the picture; say which of the places at that
 * spot it is, or name it; and it is in Places, under the location it belongs
 * to, with this photograph as its picture. Where the picture was taken comes
 * from the picture itself where the phone wrote it in, else from where the
 * device is now — asked at the moment of the tap, never on load (useHere).
 */
export type PlaceKind = 'do' | 'eat' | 'stay';
export type PhotoLanded = { venueRef: string; kind: PlaceKind; filed: PhotoFiled | null };

const EATING = new Set(['restaurant', 'cafe', 'pub', 'bar', 'takeaway', 'bakery']);
const SLEEPING = new Set(['hotel', 'lodging']);
const kindOf = (c?: string | null): PlaceKind => (SLEEPING.has(String(c)) ? 'stay' : EATING.has(String(c)) ? 'eat' : 'do');

type Stage = 'pick' | 'locating' | 'uploading' | 'choose' | 'saving';

export function PhotoAdd({ household, onDone, onSearchInstead }: {
  household: HouseholdResponse | null;
  /** It is in Places now, and this is where it filed. */
  onDone: (r: PhotoLanded) => Promise<void> | void;
  /** The photograph could not be placed: the search box is the other way in. */
  onSearchInstead: () => void;
}) {
  const here = useHere();
  const [stage, setStage] = useState<Stage>('pick');
  const [photo, setPhoto] = useState<PlacePhoto | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [point, setPoint] = useState<{ lat: number; lng: number; how: 'photo' | 'device' } | null>(null);
  const [image, setImage] = useState<OwnedImage | null>(null);
  const [where, setWhere] = useState<PhotoWhere | null>(null);
  const [candidates, setCandidates] = useState<Venue[]>([]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PlaceKind>('do');
  const [msg, setMsg] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (preview) URL.revokeObjectURL(preview); }; }, [preview]);

  /** The whole run, from the tap to the list of what is at that spot. */
  const pick = async (camera: boolean) => {
    setMsg(null);
    // Asked now, in the press, alongside the camera: a phone's fix and a
    // browser's permission both belong to the tap that wanted them.
    const fix = here.ask().catch(() => null);
    const p = await pickPlacePhoto({ camera });
    if (!p || !alive.current) return;
    setPhoto(p);
    setPreview(URL.createObjectURL(p.blob));
    setStage('locating');
    let at: { lat: number; lng: number; how: 'photo' | 'device' } | null = p.gps ? { ...p.gps, how: 'photo' } : null;
    if (!at) {
      const h = await fix;
      if (h && h.lat != null && h.lng != null) at = { lat: h.lat, lng: h.lng, how: 'device' };
    }
    if (!alive.current) return;
    if (!at) {
      setStage('pick');
      setMsg(here.error ?? "This picture does not say where it was taken, and your device could not tell us either. Allow location and try again, or search for the place by name.");
      return;
    }
    setPoint(at);
    await place(p, at);
  };

  const place = async (p: PlacePhoto, at: { lat: number; lng: number; how: 'photo' | 'device' }) => {
    setStage('uploading');
    try {
      const up = await api.uploadPlacePhoto(p.blob, { width: p.width, height: p.height, lqip: p.lqip, lat: at.lat, lng: at.lng });
      if (!alive.current) return;
      setImage(up.image); setWhere(up.where);
      // What the sources know is at that spot, a few hundred metres round it.
      let found: Venue[] = [];
      try { found = (await api.searchPlaces({ near: `${at.lat},${at.lng}`, radiusKm: 0.3 })).results.slice(0, 6); } catch { found = []; }
      if (!alive.current) return;
      setCandidates(found);
      setStage('choose');
    } catch (e: any) {
      if (!alive.current) return;
      setMsg(e?.message || 'The photograph could not be sent.');
      setStage('pick');
    }
  };

  const choose = async (v: Venue) => {
    if (!image) return;
    setStage('saving'); setMsg(null);
    try {
      const r = await api.attachPlacePhoto(image.id, { venueRef: v.venueRef, label: v.name, category: v.category, lat: v.lat, lng: v.lng, venue: v });
      await onDone({ venueRef: r.venueRef, kind: kindOf(v.category), filed: r.filed });
    } catch (e: any) { if (alive.current) { setMsg(e?.message || 'Could not save it.'); setStage('choose'); } }
  };

  const own = async () => {
    if (!image || !point) return;
    if (!name.trim()) { setMsg('Give it a name first.'); return; }
    setStage('saving'); setMsg(null);
    try {
      const r = await api.placeFromPhoto(image.id, { name: name.trim(), kind, lat: point.lat, lng: point.lng });
      await onDone({ venueRef: r.venueRef, kind, filed: r.filed });
    } catch (e: any) { if (alive.current) { setMsg(e?.message || 'Could not save it.'); setStage('choose'); } }
  };

  if (!household) return null;
  const filedLine = where?.locality
    ? where.how === 'new' ? `Will make a new location: ${where.locality}` : `Files under ${where.locality}`
    : where ? 'Nowhere in your atlas yet — it will make a new location.' : null;

  return (
    <View style={{ gap: spacing.sm }}>
      {preview ? (
        <Image source={{ uri: preview }} style={styles.preview} resizeMode="cover" accessibilityIgnoresInvertColors accessibilityLabel="Your photograph" />
      ) : null}

      {stage === 'pick' ? (
        <>
          <Text style={type.small}>Take a picture of it, and it goes in under the nearest location you have.</Text>
          <Row style={{ flexWrap: 'wrap' }}>
            <Button label="Take a photo" icon="camera" onPress={() => pick(true)} />
            <Button label="From your photos" icon="picture" kind="secondary" onPress={() => pick(false)} />
            <Button label="Search by name" kind="ghost" onPress={onSearchInstead} />
          </Row>
        </>
      ) : null}

      {stage === 'locating' ? <Text style={type.small}>Working out where this was taken…</Text> : null}
      {stage === 'uploading' ? <Text style={type.small}>Sending the picture and looking at what is there…</Text> : null}

      {stage === 'choose' || stage === 'saving' ? (
        <>
          <View style={{ gap: 2 }}>
            {where?.label ? <Text style={type.body}>{point?.how === 'device' ? 'Taken near ' : 'Taken at '}{where.label}</Text> : null}
            {point?.how === 'device' && here.accuracyM != null ? <Text style={type.tiny}>From where your device is now, {accuracyWords(here.accuracyM)}.</Text> : null}
            {filedLine ? <Text style={type.tiny}>{filedLine}</Text> : null}
          </View>
          {candidates.length ? (
            <View style={{ gap: spacing.sm }}>
              <Text style={type.h3}>Is it one of these?</Text>
              {candidates.map((v) => (
                <VenueRow key={v.venueRef} venue={v} stack action={<Button label="This one" kind="secondary" loading={stage === 'saving'} onPress={() => choose(v)} />} />
              ))}
            </View>
          ) : (
            <Text style={type.small}>Nothing the sources know is at that spot, so name it yourself.</Text>
          )}
          <View style={styles.own}>
            <Text style={type.h3}>{candidates.length ? 'Not one of these? Name it' : 'What is it?'}</Text>
            <TextInput
              value={name} onChangeText={setName} placeholder="A name for it" placeholderTextColor={colors.inkFaint}
              style={styles.input} accessibilityLabel="A name for the place" returnKeyType="done" onSubmitEditing={own}
            />
            <Segmented<PlaceKind>
              value={kind}
              options={[{ value: 'do', label: 'Something to do' }, { value: 'eat', label: 'Somewhere to eat' }, { value: 'stay', label: 'Somewhere to stay' }]}
              onChange={setKind}
            />
            <Row style={{ flexWrap: 'wrap' }}>
              <Button label="Add it" icon="add" loading={stage === 'saving'} onPress={own} />
              <Button label="Different photo" kind="ghost" onPress={() => { setStage('pick'); setPhoto(null); setPreview(null); setImage(null); setCandidates([]); setPoint(null); setWhere(null); }} />
            </Row>
          </View>
        </>
      ) : null}

      {msg ? <StatusLine tone="warn">{msg}</StatusLine> : null}
      {/* `photo` is held so a retry after a failed send does not ask for the picture again. */}
      {stage === 'pick' && photo && point && msg ? <Button label="Try sending again" kind="secondary" onPress={() => place(photo, point)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { width: '100%', aspectRatio: MEDIA_RATIO, borderRadius: MEDIA_RADIUS, backgroundColor: colors.surfaceMuted },
  own: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: BORDER, borderTopColor: colors.line },
  input: {
    minHeight: TARGET, paddingHorizontal: spacing.md, borderRadius: radius.md, fontFamily: fonts.body,
    borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface, fontSize: 15, color: colors.ink,
  },
});
