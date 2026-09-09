import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../components/press';
import { api, FlightLookup, TravelLeg, TravelMode2, TransferMode, TripDetail, TripTravel } from '../api';
import { colors, fonts, BORDER, TARGET } from '../theme';
import { Icon, IconName } from '../components/Icon';
import { StatusLine } from '../components/ui';
import { useViewport } from '../hooks/useViewport';
import { TOP_INSET } from '../components/InspireHeader';
import { tripName } from './tripName';

/**
 * Getting there (trip rebuild, 7 Sep 2026, screen 5d).
 *
 * A mode strip over two kickers — OUTBOUND and RETURN — and, under them, the
 * transfer from the far terminal to the bed. Every time on the screen that was
 * not typed is worked out: "Leave home by 05:20 · 40 min drive" is the
 * departure minus two hours minus the drive, so changing the flight changes it.
 *
 * What Epic can fill in and what it cannot is said once, in plain words, rather
 * than pretended at. A flight number gives the airline and the airports from
 * open data; the times come off the household's booking, because every schedule
 * feed is a paid one and turning one on is the owner's (CLAUDE.md). That is the
 * line under the field, and it is never a provider's error message.
 */

/**
 * Three ways, and only the ones that mean something here.
 *
 * Ferry is gone (owner, 7 Sep 2026: "a bit of a nonsense"), and which of the
 * other three are drawn is the API's answer, not this screen's guess — it needs
 * the household's home to work out (routes/tripTravel.js `modesFor`).
 */
const MODES: { key: TravelMode2; label: string; icon: IconName }[] = [
  { key: 'fly', label: 'Fly', icon: 'ticket' },
  { key: 'train', label: 'Train', icon: 'transit' },
  { key: 'drive', label: 'Drive', icon: 'driving' },
];

const TRANSFER_ICON: Record<TransferMode, IconName> = { train: 'transit', taxi: 'taxi', hire: 'driving' };

const fmtDay = (iso?: string | null) => (iso
  ? new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
  : null);

const mins = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim());

export function GettingThereScreen({ trip, onBack, onClose }: {
  trip: TripDetail;
  onBack: () => void;
  onClose: () => void;
}) {
  const { width } = useViewport();
  const wide = width >= 900;
  const id = trip.trip.id;

  const [mode, setMode] = useState<TravelMode2>('fly');
  const [data, setData] = useState<TripTravel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.tripTravel(id)); setError(null); } catch (e: any) { setError(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const legFor = (direction: 'outbound' | 'return') =>
    data?.legs.find((l) => l.direction === direction && l.mode === mode) ?? null;

  /**
   * The strip opens on whatever is already booked, so a household that came
   * back to change the return does not land on an empty Fly tab — and, failing
   * that, on the first way that actually applies.
   */
  useEffect(() => {
    const first = data?.legs[0];
    if (first) { setMode(first.mode); return; }
    const offered = data?.modes;
    if (offered?.length && !offered.includes(mode)) setMode(offered[0]);
  }, [data?.legs.length, data?.modes?.join(',')]);

  const shown = MODES.filter((m) => !data?.modes || data.modes.includes(m.key));

  /**
   * The journey Epic can work out for itself. Asked for only on Train and
   * Drive, and only while nothing is booked on that tab: once the household has
   * typed their own, theirs is the answer.
   */
  const [suggested, setSuggested] = useState<Awaited<ReturnType<typeof api.suggestJourney>> | null>(null);
  const [looking, setLooking] = useState(false);
  const booked = Boolean(legFor('outbound'));
  useEffect(() => {
    let live = true;
    setSuggested(null);
    if (mode === 'fly' || booked) return () => { live = false; };
    setLooking(true);
    api.suggestJourney(id, mode)
      .then((r) => { if (live) setSuggested(r); })
      .catch(() => { if (live) setSuggested(null); })
      .finally(() => { if (live) setLooking(false); });
    return () => { live = false; };
  }, [id, mode, booked]);

  const dates = trip.trip.startDate && trip.trip.endDate && trip.trip.startDate !== trip.trip.endDate
    ? `${fmtDay(trip.trip.startDate)} – ${fmtDay(trip.trip.endDate)}`
    : fmtDay(trip.trip.startDate ?? trip.trip.departAt);

  const save = async (direction: 'outbound' | 'return', body: Parameters<typeof api.saveTravelLeg>[2]) => {
    setBusy(true);
    try { setData(await api.saveTravelLeg(id, direction, body)); setError(null); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const chosen = data?.transfers.find((t) => t.chosen) ?? null;
  const arrival = legFor('outbound');

  return (
    <View style={[styles.page, wide && styles.wide]}>
      <View style={styles.head}>
        <View style={styles.topRow}>
          <Press onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel={`Back to ${tripName(trip.trip)}`}>
            <Icon name="back" size={16} color={colors.ink} strokeWidth={2.4} />
            <Text style={styles.backText} numberOfLines={1}>{tripName(trip.trip)}</Text>
          </Press>
          <Press onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
            <Icon name="close" size={20} color={colors.ink} strokeWidth={2.4} />
          </Press>
        </View>
        <View>
          <Text style={styles.title}>Getting there</Text>
          <Text style={styles.meta}>{[dates, data?.from ? `from ${data.from}` : null].filter(Boolean).join(' · ')}</Text>
        </View>
        <View style={styles.strip}>
          {shown.map((m) => {
            const on = m.key === mode;
            return (
              <Press key={m.key} onPress={() => setMode(m.key)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                <View style={[styles.stripItem, on && styles.stripItemOn]}>
                  <Text style={[styles.stripText, on && styles.stripTextOn]}>{m.label}</Text>
                </View>
              </Press>
            );
          })}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {error ? <StatusLine tone="warn">{error}</StatusLine> : null}

        {/* What Epic worked out, before anybody types anything (owner, 7 Sep
            2026: "surely it should just show the train"). One tap puts it on
            the trip; typing over it is still there underneath. */}
        {mode !== 'fly' && !booked ? (
          <View style={styles.suggest}>
            {looking ? <Text style={styles.hint}>Looking up the journey…</Text> : null}
            {!looking && suggested?.ok ? (
              <>
                <View style={styles.legTop}>
                  <Text style={styles.legEnd}>{[suggested.from, suggested.departAt].filter(Boolean).join(' ')}</Text>
                  <Icon name="forward" size={16} color={colors.inkMuted} strokeWidth={2.2} />
                  <Text style={styles.legEnd}>{[suggested.to, suggested.arriveAt].filter(Boolean).join(' ')}</Text>
                </View>
                <Text style={styles.legSub}>{suggested.says}</Text>
                {(suggested.legs ?? []).filter((l) => l.transit).map((l, i) => (
                  <Text key={i} style={styles.legStep} numberOfLines={2}>
                    {[l.transit?.vehicle ?? 'Train', l.transit?.line, l.transit?.from && l.transit?.to ? `${l.transit.from} → ${l.transit.to}` : null,
                      l.transit?.departs && l.transit?.arrives ? `${l.transit.departs}–${l.transit.arrives}` : null].filter(Boolean).join(' · ')}
                  </Text>
                ))}
                <Press
                  onPress={() => save('outbound', {
                    mode, onDate: trip.trip.startDate ?? null,
                    fromLabel: suggested.from ?? null, toLabel: suggested.to ?? null,
                    carrier: suggested.carrier ?? null, serviceNo: suggested.serviceNo ?? null,
                    note: suggested.says ?? null,
                  })}
                  style={styles.take}
                  accessibilityRole="button"
                >
                  <Icon name="add" size={15} color={colors.primaryFg} strokeWidth={2.4} />
                  <Text style={styles.takeText}>{mode === 'train' ? 'Put this train on the trip' : 'Put this drive on the trip'}</Text>
                </Press>
              </>
            ) : null}
            {!looking && suggested && !suggested.ok ? <Text style={styles.hint}>{suggested.message}</Text> : null}
          </View>
        ) : null}

        <Leg
          tripId={id}
          direction="outbound"
          mode={mode}
          leg={legFor('outbound')}
          date={trip.trip.startDate ?? null}
          says={data?.lookup.says ?? ''}
          busy={busy}
          onSave={(body) => save('outbound', body)}
        />
        <Leg
          tripId={id}
          direction="return"
          mode={mode}
          leg={legFor('return')}
          date={trip.trip.endDate ?? null}
          says={data?.lookup.says ?? ''}
          busy={busy}
          backFrom={legFor('outbound')}
          onSave={(body) => save('return', body)}
        />

        {/* Airport to hotel (5d): three cells, one of which may be picked and
            put on the plan. Nothing here is a fare anybody is held to — they
            are Epic's own estimates for the party, and they say so. */}
        {data && (arrival?.to.code || data.transfers.length) ? (
          <View style={{ paddingTop: 10 }}>
            <View style={styles.transferHead}>
              <Text style={styles.rowTitle}>{mode === 'fly' ? 'Airport to hotel' : 'Getting to where you are staying'}</Text>
              <Text style={styles.transferWhere} numberOfLines={1}>
                {[arrival?.to.label ?? arrival?.to.code, trip.trip.base?.label?.split(',')[0], data.party ? `${data.party} ${data.party === 1 ? 'person' : 'people'}` : null]
                  .filter(Boolean).join(' → ').replace(/ → (\d+ (?:person|people))$/, ' · $1')}
              </Text>
            </View>
            {data.transfers.length ? (
              <View style={styles.cells}>
                {data.transfers.map((t, i) => (
                  <Press
                    key={t.id}
                    onPress={async () => {
                      setBusy(true);
                      try { setData(await api.chooseTransfer(id, t.chosen ? null : t.mode)); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
                    }}
                    style={[styles.cell, i < data.transfers.length - 1 && styles.cellDivider, t.chosen && styles.cellOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: t.chosen }}
                  >
                    <View style={styles.cellHead}>
                      <Icon name={TRANSFER_ICON[t.mode]} size={14} color={colors.ink} strokeWidth={2.2} />
                      <Text style={styles.cellLabel}>{t.label ?? t.mode}</Text>
                    </View>
                    <Text style={styles.cellBig}>{t.minutes != null ? `${t.minutes} min` : '—'}</Text>
                    <Text style={styles.cellDetail}>{t.detail ?? ''}</Text>
                  </Press>
                ))}
              </View>
            ) : (
              <Text style={styles.hint}>{data.transferNote}</Text>
            )}
            {chosen ? (
              <Text style={styles.picked}>
                {`${chosen.label ?? chosen.mode} picked · added to the plan${arrival?.arriveAt ? ` after you land at ${arrival.arriveAt}` : ''}`}
              </Text>
            ) : null}
            <Text style={styles.hint}>Times and costs are Epic's own estimates for {data.party} — nothing is booked here.</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.foot}>
        <Press onPress={onBack} style={styles.primary} accessibilityRole="button">
          <Text style={styles.primaryText}>Done</Text>
          <Icon name="forward" size={18} color={colors.primaryFg} strokeWidth={2.4} />
        </Press>
      </View>
    </View>
  );
}

/**
 * One leg: the resolved row when there is one, the form when there is not.
 *
 * The form is the handoff's — a service-number field, then "Forward booking
 * email" and "Search flights" beneath it — with the times added, because
 * without a schedule feed they are what makes the row mean anything.
 */
function Leg({ tripId, direction, mode, leg, date, says, busy, onSave, backFrom }: {
  tripId: string;
  direction: 'outbound' | 'return';
  mode: TravelMode2;
  leg: TravelLeg | null;
  date: string | null;
  says: string;
  busy: boolean;
  onSave: (body: Parameters<typeof api.saveTravelLeg>[2]) => Promise<void>;
  /** The outbound leg, so the return's empty fields suggest the way back rather than the way out. */
  backFrom?: TravelLeg | null;
}) {
  const [open, setOpen] = useState(false);
  const [service, setService] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [depart, setDepart] = useState('');
  const [arrive, setArrive] = useState('');
  const [terminal, setTerminal] = useState('');
  const [lookup, setLookup] = useState<FlightLookup | null>(null);
  const [ref, setRef] = useState('');
  const [forwarding, setForwarding] = useState(false);

  const kicker = `${direction === 'outbound' ? 'Outbound' : 'Return'}${date ? ` · ${fmtDay(date)}` : ''}`;
  const flying = mode === 'fly';
  const numberLabel = flying ? 'Flight number, e.g. BA 549' : mode === 'train' ? 'Train or booking reference' : 'What you are driving';

  const resolve = async (value: string) => {
    if (!flying || value.trim().length < 3) { setLookup(null); return; }
    try {
      setLookup(await api.lookupFlight(tripId, value, { from: from || undefined, to: to || undefined }));
    } catch { setLookup(null); }
  };

  const commit = async () => {
    await onSave({
      mode,
      onDate: date,
      fromCode: flying && from.length === 3 ? from.toUpperCase() : null,
      fromLabel: flying ? null : from || null,
      toCode: flying && to.length === 3 ? to.toUpperCase() : null,
      toLabel: flying ? null : to || null,
      departAt: depart || null,
      arriveAt: arrive || null,
      serviceNo: service || null,
      terminal: terminal || null,
      bookingRef: ref || null,
    });
    setOpen(false);
    setLookup(null);
  };

  if (leg && !open) {
    return (
      <View>
        <Text style={styles.kicker}>{kicker.toUpperCase()}</Text>
        <View style={styles.legRow}>
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <View style={styles.legTop}>
              <Text style={styles.legEnd}>{[leg.from.code ?? leg.from.label, leg.departAt].filter(Boolean).join(' ') || 'Not said yet'}</Text>
              <Icon name="forward" size={16} color={colors.inkMuted} strokeWidth={2.2} />
              <Text style={styles.legEnd}>{[leg.to.code ?? leg.to.label, leg.arriveAt].filter(Boolean).join(' ') || '…'}</Text>
            </View>
            <Text style={styles.legSub} numberOfLines={2}>
              {[leg.carrier, leg.serviceNo, leg.durationMinutes ? mins(leg.durationMinutes) : null, leg.terminal ? `Terminal ${leg.terminal}` : null]
                .filter(Boolean).join(' · ') || 'Tap Edit to fill in the times'}
            </Text>
            {leg.leaveHome ? (
              <Text style={styles.legLeave}>
                {`Leave home by ${leg.leaveHome.time}${leg.leaveHome.dayBefore ? ' the night before' : ''} · ${leg.leaveHome.minutes} min drive`}
              </Text>
            ) : null}
          </View>
          <Press
            onPress={() => {
              setService(leg.serviceNo ?? '');
              setFrom(leg.from.code ?? leg.from.label ?? '');
              setTo(leg.to.code ?? leg.to.label ?? '');
              setDepart(leg.departAt ?? '');
              setArrive(leg.arriveAt ?? '');
              setTerminal(leg.terminal ?? '');
              setRef(leg.bookingRef ?? '');
              setOpen(true);
            }}
            style={styles.edit}
            accessibilityRole="button"
          >
            <Text style={styles.editText}>Edit</Text>
          </Press>
        </View>
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.kicker}>{kicker.toUpperCase()}</Text>
      <View style={styles.field}>
        <Icon name={flying ? 'ticket' : mode === 'train' ? 'transit' : 'driving'} size={18} color={colors.ink} strokeWidth={2.2} />
        <TextInput
          value={service}
          onChangeText={(v) => { setService(v); resolve(v); }}
          placeholder={numberLabel}
          placeholderTextColor={colors.inkMuted}
          autoCapitalize="characters"
          style={styles.input}
          accessibilityLabel={numberLabel}
        />
      </View>
      {lookup?.ok ? <Text style={styles.lookup}>{lookup.message}</Text> : null}

      <View style={styles.grid}>
        <Small
          label={flying ? 'From (code)' : 'From'}
          value={from}
          onChange={setFrom}
          placeholder={backFrom?.to.code ?? backFrom?.to.label ?? (flying ? 'LHR' : 'Where from')}
        />
        <Small
          label={flying ? 'To (code)' : 'To'}
          value={to}
          onChange={setTo}
          placeholder={backFrom?.from.code ?? backFrom?.from.label ?? (flying ? 'FCO' : 'Where to')}
        />
      </View>
      <View style={styles.grid}>
        <Small label="Leaves" value={depart} onChange={setDepart} placeholder="hh:mm" />
        <Small label="Arrives" value={arrive} onChange={setArrive} placeholder="hh:mm" />
      </View>
      {flying ? (
        <View style={styles.grid}>
          <Small label="Terminal" value={terminal} onChange={setTerminal} placeholder="5" />
          <Small label="Booking reference" value={ref} onChange={setRef} placeholder="Optional" />
        </View>
      ) : null}

      <View style={styles.links}>
        <Press onPress={() => setForwarding((f) => !f)} accessibilityRole="button">
          <Text style={styles.linkOn}>Forward booking email</Text>
        </Press>
        <Text style={styles.link}>{says}</Text>
      </View>
      {forwarding ? (
        <Text style={styles.hint}>
          Forwarding a booking straight onto the trip needs an inbound mail address, which is a key the owner
          adds in Doppler. Until it is there, copy the times across from the email — it is four fields.
        </Text>
      ) : null}

      <View style={styles.legActions}>
        <Press onPress={commit} style={styles.save} accessibilityRole="button" disabled={busy}>
          <Text style={styles.saveText}>{busy ? 'Saving…' : leg ? 'Save changes' : 'Save this leg'}</Text>
        </Press>
        {leg ? (
          <Press onPress={() => setOpen(false)} style={styles.cancel} accessibilityRole="button">
            <Text style={styles.cancelText}>Cancel</Text>
          </Press>
        ) : null}
      </View>
    </View>
  );
}

function Small({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
      <Text style={styles.smallLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.inkMuted}
        style={styles.smallInput}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  wide: { maxWidth: 720, alignSelf: 'center', width: '100%' },
  head: { paddingHorizontal: 20, paddingTop: TOP_INSET, gap: 14 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, minHeight: TARGET },
  backText: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: colors.ink },
  close: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.heading, fontSize: 32, fontWeight: '800', letterSpacing: -0.96, lineHeight: 34, color: colors.ink },
  meta: { fontFamily: fonts.body, fontSize: 14, color: colors.inkMuted, marginTop: 6 },
  strip: { flexDirection: 'row', gap: 18, borderBottomWidth: BORDER, borderBottomColor: colors.line },
  stripItem: { paddingVertical: 6, borderBottomWidth: BORDER, borderBottomColor: 'transparent' },
  stripItemOn: { borderBottomColor: colors.accent },
  stripText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: colors.inkMuted },
  stripTextOn: { color: colors.accent },

  body: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 4 },
  kicker: {
    fontFamily: fonts.body, fontSize: 11, fontWeight: '600', letterSpacing: 0.88,
    textTransform: 'uppercase', color: colors.inkMuted, paddingTop: 16, paddingBottom: 6,
  },

  legRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 4 },
  legTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legEnd: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: colors.ink },
  legSub: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted },
  legStep: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, paddingTop: 2 },
  suggest: { gap: 4, paddingTop: 10, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  take: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12,
    backgroundColor: colors.primary, paddingVertical: 12, paddingHorizontal: 16, alignSelf: 'flex-start',
  },
  takeText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: colors.primaryFg },
  legLeave: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.accent },
  edit: { minHeight: TARGET, justifyContent: 'center', paddingLeft: 8 },
  editText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.ink },

  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10, height: 44, paddingHorizontal: 14,
    borderWidth: BORDER, borderColor: colors.ink, backgroundColor: colors.surface, marginTop: 6,
  },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  lookup: { fontFamily: fonts.body, fontSize: 13, color: colors.accent, fontWeight: '600', paddingTop: 8, lineHeight: 18 },

  grid: { flexDirection: 'row', gap: 12, paddingTop: 10 },
  smallLabel: { fontFamily: fonts.body, fontSize: 12, fontWeight: '600', color: colors.inkMuted },
  smallInput: {
    height: 40, paddingHorizontal: 10, borderWidth: 1, borderColor: colors.lineSoft,
    backgroundColor: colors.surface, fontFamily: fonts.body, fontSize: 15, color: colors.ink,
  },

  links: { flexDirection: 'row', gap: 18, paddingVertical: 12, flexWrap: 'wrap' },
  linkOn: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.ink, textDecorationLine: 'underline' },
  link: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, flexShrink: 1 },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted, lineHeight: 17, paddingTop: 8 },

  legActions: { flexDirection: 'row', gap: 10, paddingTop: 4, paddingBottom: 8 },
  save: { paddingHorizontal: 16, minHeight: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  saveText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: colors.primaryFg },
  cancel: { paddingHorizontal: 16, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderWidth: BORDER, borderColor: colors.ink },
  cancelText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: colors.ink },

  transferHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, paddingTop: 12, paddingBottom: 6 },
  rowTitle: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: colors.ink },
  transferWhere: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted, flexShrink: 1 },
  cells: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.lineSoft },
  cell: { flex: 1, minWidth: 0, padding: 10, gap: 3 },
  cellDivider: { borderRightWidth: 1, borderRightColor: colors.lineSoft },
  cellOn: { backgroundColor: colors.accentSoft },
  cellHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cellLabel: { fontFamily: fonts.body, fontSize: 12, fontWeight: '600', color: colors.ink },
  cellBig: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: colors.ink },
  cellDetail: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },
  picked: { fontFamily: fonts.body, fontSize: 12, fontWeight: '600', color: colors.accent, paddingTop: 8 },

  foot: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.primary, paddingVertical: 16, paddingHorizontal: 18 },
  primaryText: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: colors.primaryFg },
});
