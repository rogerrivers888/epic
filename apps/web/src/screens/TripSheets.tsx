import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, TripShare } from '../api';
import { colors, fonts, memberPastel, BORDER, ON_LIME, TARGET, type } from '../theme';
import { Icon, IconName } from '../components/Icon';
import { StatusLine } from '../components/ui';
import { useViewport } from '../hooks/useViewport';

/**
 * The two sheets that hang off a trip's header (trip rebuild, 7 Sep 2026,
 * screens 1c and 3b): the ⋯ menu, and Share trip.
 *
 * Both are `Modal`s, so both pin themselves to the shell's phone frame rather
 * than covering the browser window — the rule every portalled thing in Epic is
 * under (CLAUDE.md, and `VenueDrawer` is the reference).
 */

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { width, height, framed, origin } = useViewport();
  const frameBox = framed && origin
    ? { position: 'absolute' as const, left: origin.x, top: origin.y, width, height, overflow: 'hidden' as const }
    : null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <View style={[styles.frame, frameBox]}>
          <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle} numberOfLines={1}>{title}</Text>
              <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
                <Icon name="close" size={16} color={colors.ink} strokeWidth={2.4} />
              </Pressable>
            </View>
            {children}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// the ⋯ menu
// ---------------------------------------------------------------------------

export type TripMenuAction = 'rename' | 'date' | 'move' | 'share' | 'delete';

/**
 * Rename · Change date · Move to Holidays · **Share trip**, a 2px ink rule, and
 * Delete trip (1c).
 *
 * The ⋯ came back here with a different list from the one the owner removed on
 * 6 Sep — that one was Find, Shortlist and Plan the day, every one of which was
 * already a pill on the map. These five are not on any other screen: four of
 * them change what the trip *is*, and the fifth ends it.
 */
export function TripMenuSheet({ title, isHoliday, datesFixed, onPick, onClose }: {
  title: string;
  isHoliday: boolean;
  datesFixed: boolean;
  onPick: (action: TripMenuAction) => void;
  onClose: () => void;
}) {
  const rows: { key: TripMenuAction; icon: IconName; label: string }[] = [
    { key: 'rename', icon: 'edit', label: 'Rename trip' },
    { key: 'date', icon: 'calendar', label: datesFixed ? 'Change date' : 'Fix a date' },
    { key: 'move', icon: 'refresh', label: isHoliday ? 'Move to Day trips' : 'Move to Holidays' },
    { key: 'share', icon: 'send', label: 'Share trip' },
  ];
  return (
    <Sheet title={title} onClose={onClose}>
      {rows.map((r) => (
        <Pressable key={r.key} onPress={() => onPick(r.key)} style={styles.menuRow} accessibilityRole="button">
          <Icon name={r.icon} size={20} color={colors.ink} strokeWidth={2.2} />
          <Text style={styles.menuText}>{r.label}</Text>
        </Pressable>
      ))}
      <Pressable onPress={() => onPick('delete')} style={[styles.menuRow, styles.menuDanger]} accessibilityRole="button">
        <Icon name="delete" size={20} color={colors.ink} strokeWidth={2.2} />
        <Text style={styles.menuText}>Delete trip</Text>
      </Pressable>
    </Sheet>
  );
}

/**
 * Deleting asks, and says what goes with it.
 *
 * "Delete asks for confirmation; deleting a shared trip notifies participants"
 * — the first half is here. The second is the API's to do once a sender is
 * wired up; until then the sheet says plainly that the guests will lose it,
 * which is the honest version of a notification nobody can send.
 */
export function DeleteTripSheet({ tripId, title, onConfirm, onClose }: {
  tripId: string; title: string; onConfirm: () => Promise<void>; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // Who else has a link to this. Read here rather than passed in, because it is
  // the one thing the sentence needs and nothing else on the trip page wants it.
  const [guests, setGuests] = useState(0);
  useEffect(() => {
    let live = true;
    api.tripShare(tripId).then((r) => { if (live) setGuests(r.guests.length); }).catch(() => {});
    return () => { live = false; };
  }, [tripId]);
  return (
    <Sheet title={`Delete ${title}?`} onClose={onClose}>
      <Text style={styles.body}>
        The days, the stops and the shortlist go with it. Anywhere you have actually been stays on your places —
        it just stops belonging to a trip.
        {guests ? ` ${guests} ${guests === 1 ? 'guest has' : 'guests have'} a link to this trip, and it will stop opening.` : ''}
      </Text>
      <View style={styles.actions}>
        <Pressable
          onPress={async () => { if (busy) return; setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}
          style={styles.danger}
          accessibilityRole="button"
        >
          <Text style={styles.dangerText}>{busy ? 'Deleting…' : 'Delete this trip'}</Text>
        </Pressable>
        <Pressable onPress={onClose} style={styles.ghost} accessibilityRole="button">
          <Text style={styles.ghostText}>Keep it</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

/** Rename, in the sheet the menu opens rather than on a screen of its own. */
export function RenameTripSheet({ title, onSave, onClose }: {
  title: string; onSave: (next: string) => Promise<void>; onClose: () => void;
}) {
  const [text, setText] = useState(title);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title="Rename trip" onClose={onClose}>
      <TextInput
        value={text}
        onChangeText={setText}
        autoFocus
        selectTextOnFocus
        style={styles.input}
        accessibilityLabel="The trip's name"
        onSubmitEditing={async () => { setBusy(true); try { await onSave(text.trim() || title); } finally { setBusy(false); } }}
      />
      <View style={styles.actions}>
        <Pressable
          onPress={async () => { if (busy) return; setBusy(true); try { await onSave(text.trim() || title); } finally { setBusy(false); } }}
          style={styles.primary}
          accessibilityRole="button"
        >
          <Text style={styles.primaryText}>{busy ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// share
// ---------------------------------------------------------------------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Share trip (3b): the household first, then guests, then the link.
 *
 * A household member is Add or Remove — they have an account, so adding them is
 * putting them on the trip. A guest is a name and one contact, and what happens
 * next depends on whether a sender is wired up: where it is not, the sheet says
 * so and hands over the guest's own link to send by hand, which is strictly
 * better than refusing to add the person.
 */
export function ShareTripSheet({ tripId, title, onClose, onChanged }: {
  tripId: string; title: string; onClose: () => void; onChanged?: () => Promise<void> | void;
}) {
  const { height } = useViewport();
  const [data, setData] = useState<TripShare | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await api.tripShare(tripId)); setError(null); } catch (e: any) { setError(e.message); }
  }, [tripId]);
  useEffect(() => { load(); }, [load]);

  const toggle = async (memberId: string, going: boolean) => {
    if (!data) return;
    const next = data.household.filter((m) => (m.id === memberId ? !going : m.going)).map((m) => m.id);
    setBusy(true);
    try { setData(await api.setTripHousehold(tripId, next)); await onChanged?.(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const invite = async () => {
    const who = name.trim();
    const how = contact.trim();
    if (!who || !how || busy) return;
    setBusy(true);
    try {
      setData(await api.inviteGuest(tripId, { name: who, contact: how }));
      setName(''); setContact(''); setError(null);
      await onChanged?.();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const copy = async (text: string, what: string) => {
    try {
      if (Platform.OS === 'web' && navigator?.clipboard) await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2200);
    } catch { setError('This browser would not let Epic copy. Select the link and copy it by hand.'); }
  };

  const senders = data?.canSend;
  const canSend = Boolean(senders?.sms || senders?.email);

  return (
    <Sheet title="Share trip" onClose={onClose}>
      {/* At most two-thirds of the phone, whatever the phone is: a fixed height
          leaves half a row showing on a small one and a lot of empty sheet on a
          large one. */}
      <ScrollView style={{ maxHeight: Math.round(height * 0.62) }} keyboardShouldPersistTaps="handled">
        {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
        {!data ? <Text style={type.small}>Loading…</Text> : null}

        {/* Name, mobile or email — the one field the sheet leads with. */}
        <View style={styles.field}>
          <Icon name="addPerson" size={18} color={colors.ink} strokeWidth={2.2} />
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Name"
            placeholderTextColor={colors.inkMuted}
            style={styles.fieldInput}
            accessibilityLabel="Their name"
          />
        </View>
        <View style={styles.field}>
          <Icon name={EMAIL.test(contact) ? 'mail' : 'phone'} size={18} color={colors.ink} strokeWidth={2.2} />
          <TextInput
            value={contact}
            onChangeText={setContact}
            placeholder="Mobile or email"
            placeholderTextColor={colors.inkMuted}
            autoCapitalize="none"
            style={styles.fieldInput}
            accessibilityLabel="Their mobile or email"
            onSubmitEditing={invite}
          />
          <Pressable onPress={invite} style={styles.add} accessibilityRole="button" accessibilityLabel="Invite them">
            <Text style={styles.addText}>{busy ? '…' : 'Invite'}</Text>
          </Pressable>
        </View>

        {data ? (
          <>
            <Text style={styles.kicker}>Household</Text>
            {data.household.map((m, i) => (
              <View key={m.id} style={styles.personRow}>
                {/* A pastel tile is a light ground in both palettes, so its
                    letter is ink — `colors.ink` is the *type* colour and turns
                    cream in the dark, which is unreadable on a pastel. */}
                <View style={[styles.tile, m.organiser ? styles.tileMe : { backgroundColor: memberPastel(i) }]}>
                  <Text style={[styles.tileText, styles.onPastel]}>{m.name.trim().charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.personName} numberOfLines={1}>{m.name}</Text>
                  <Text style={[styles.personStatus, m.going && !m.organiser && styles.personGoing]} numberOfLines={1}>{m.status}</Text>
                </View>
                {m.organiser ? null : (
                  <Pressable onPress={() => toggle(m.id, m.going)} style={styles.action} accessibilityRole="button">
                    <Text style={styles.actionText}>{m.going ? 'Remove' : 'Add'}</Text>
                  </Pressable>
                )}
              </View>
            ))}

            <Text style={styles.kicker}>Guests</Text>
            {!data.guests.length ? (
              <Text style={styles.body}>Nobody outside the household yet. Add a name and a number above.</Text>
            ) : null}
            {data.guests.map((g) => (
              <View key={g.id} style={styles.personRow}>
                <View style={[styles.tile, styles.tileGuest]}>
                  <Text style={styles.tileText}>{g.name.trim().charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.personName} numberOfLines={1}>{g.contact ? `${g.name} · ${g.contact}` : g.name}</Text>
                  <Text style={styles.personStatus} numberOfLines={2}>{g.says}</Text>
                </View>
                <Pressable
                  onPress={() => (canSend ? api.resendGuest(tripId, g.id).then(setData).catch((e) => setError(e.message)) : g.link && copy(g.link, g.id))}
                  style={styles.action}
                  accessibilityRole="button"
                >
                  <Text style={styles.actionText}>{canSend ? 'Resend' : 'Copy link'}</Text>
                </Pressable>
                <Pressable
                  onPress={() => api.removeGuest(tripId, g.id).then(setData).catch((e) => setError(e.message))}
                  style={styles.action}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${g.name}`}
                >
                  <Icon name="close" size={15} color={colors.inkMuted} />
                </Pressable>
              </View>
            ))}

            <Pressable onPress={() => copy(data.link, 'link')} style={styles.primaryWide} accessibilityRole="button">
              <Text style={styles.primaryText}>{copied === 'link' ? 'Link copied' : 'Copy link'}</Text>
              <Icon name="copy" size={18} color={colors.primaryFg} strokeWidth={2.2} />
            </Pressable>
            <Text style={styles.body}>
              Anyone with the link sees the plan, people and chat as a guest — no account needed.
              {canSend ? '' : ' Epic cannot send invitations yet, so send the link yourself; the people you add here are let straight in when they open it.'}
            </Text>
          </>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  frame: { flex: 1, justifyContent: 'flex-end' },
  scrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.scrim },
  sheet: { backgroundColor: colors.surface, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 34, gap: 6 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10 },
  sheetTitle: { flex: 1, fontFamily: fonts.heading, fontSize: 22, fontWeight: '800', letterSpacing: -0.44, color: colors.ink },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  menuRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: colors.lineSoft, minHeight: TARGET,
  },
  // The one 2px ink rule in the sheet, above the thing that cannot be undone.
  menuDanger: { marginTop: 8, borderTopWidth: BORDER, borderTopColor: colors.line },
  menuText: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: colors.ink },

  body: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, lineHeight: 19, paddingVertical: 8 },
  actions: { flexDirection: 'row', gap: 10, paddingTop: 10 },
  primary: { flex: 1, backgroundColor: colors.primary, paddingVertical: 14, alignItems: 'center' },
  primaryWide: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.primary, paddingVertical: 16, paddingHorizontal: 18, marginTop: 12,
  },
  primaryText: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: colors.primaryFg },
  ghost: { flex: 1, borderWidth: BORDER, borderColor: colors.ink, paddingVertical: 14, alignItems: 'center' },
  ghostText: { fontFamily: fonts.body, fontSize: 15, fontWeight: '700', color: colors.ink },
  // Danger is meaning, not brand: the pack retires red everywhere except this
  // and allergens (theme.ts).
  danger: { flex: 1, backgroundColor: colors.overrunSoft, borderWidth: BORDER, borderColor: colors.overrun, paddingVertical: 14, alignItems: 'center' },
  dangerText: { fontFamily: fonts.body, fontSize: 15, fontWeight: '700', color: colors.overrun },

  input: {
    height: 48, paddingHorizontal: 14, borderWidth: BORDER, borderColor: colors.ink,
    backgroundColor: colors.surface, fontFamily: fonts.body, fontSize: 16, color: colors.ink,
  },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingHorizontal: 14, marginBottom: 8,
    borderWidth: BORDER, borderColor: colors.ink, backgroundColor: colors.surface,
  },
  fieldInput: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  add: { paddingHorizontal: 10, minHeight: 34, justifyContent: 'center' },
  addText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.ink },

  kicker: {
    fontFamily: fonts.body, fontSize: 11, fontWeight: '600', letterSpacing: 0.88, textTransform: 'uppercase',
    color: colors.inkMuted, paddingTop: 14, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft,
  },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  tile: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  tileMe: { backgroundColor: colors.selected },
  tileGuest: { backgroundColor: 'transparent', borderWidth: BORDER, borderColor: colors.ink },
  tileText: { fontFamily: fonts.heading, fontSize: 14, fontWeight: '800', color: colors.ink },
  /** On lime and on the pastels, which are light grounds in both palettes. */
  onPastel: { color: ON_LIME },
  personName: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: colors.ink },
  personStatus: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted },
  personGoing: { color: colors.accent, fontWeight: '600' },
  action: { minHeight: TARGET, paddingHorizontal: 6, justifyContent: 'center' },
  actionText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.ink },
});
