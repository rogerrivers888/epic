/**
 * Settings, revised (Settings revised v2, owner 1 Oct 2026). One long scroll
 * becomes two tabs under a title band — Household (SE1) and My Account (SE2) —
 * with the How-Epic-plans pickers as bottom sheets (SE7–SE11), the person's
 * page a push of its own (HouseholdScreen), and the device log, providers and
 * data export moved a level down.
 *
 *   SE1  Household     the people as faces, the plan defaults
 *   SE2  My Account    voice, appearance, whose ratings, devices, sign out
 *   SE12 Solo           no face row; just you, and the upsell to Household
 *   SX6  Signed-in devices (a push)
 *
 * My Account is SE2 and nothing else (owner, 2 Oct 2026: the offline card, "Save
 * everything for offline" and the rest "was not in any of the screenshots I
 * signed off on, so you need to remove all of that"). The providers table, the
 * data export and the on-device store's controls are no longer shown here; the
 * device still keeps its offline copy quietly (useOffline).
 */

import React, { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../components/press';
import { api, HouseholdResponse, Member, MainDiet, Place, RatingsView, TravelMode } from '../api';
import { PlacePicker } from '../components/PlacePicker';
import { pickSquarePhoto } from './HouseholdScreen';
import { colors, fonts, spacing, type, BORDER, TARGET, LIME, INK, CREAM } from '../theme';
import { Button } from '../components/ui';
import { useRouter, useQueryState, asOneOf, asFlag, asText } from '../router';
import { paths, type Route } from '../routes';
import { storage } from '../storage';
import { NotificationsSettings } from '../components/chat/NotificationsSettings';
import { ProvidersTable } from '../components/ProvidersTable';
import { useTheme } from '../hooks/useTheme';
import { useSession } from '../hooks/useSession';
import { Icon } from '../components/Icon';
import { Avatar } from '../components/Faces';
import { TitleBand, CompactBand } from '../components/Band';
import { InkMenu } from '../components/InkMenu';
import { Sheet } from '../components/Sheet';
import { showToast } from '../components/Toast';
import { isAdmin } from '../admin';

export const SPEAK_KEY = 'epic.speakReplies';
export const getSpeakPref = () => storage.getItem(SPEAK_KEY) !== 'off';
const VOICE_CONFIRM_KEY = 'epic.showWords';
const getVoiceConfirmPref = () => storage.getItem(VOICE_CONFIRM_KEY) !== 'off';

// --- labels for the How-Epic-plans rows -------------------------------------

const HOUR = (h: number) => { const am = h < 12; const h12 = h % 12 === 0 ? 12 : h % 12; return `${h12}${am ? 'am' : 'pm'}`; };
const CLOSE_LABEL = (m: number | null | undefined) =>
  m == null ? 'Any distance' : m === 30 ? 'Up to 30 min' : m === 60 ? 'Up to 1 hr' : m === 90 ? 'Up to 1½ hrs' : m === 120 ? 'Up to 2 hrs' : `Up to ${m} min`;
const MODE_LABEL: Record<TravelMode, string> = { car: 'Car', train: 'Train', bus: 'Bus', walking: 'Walking', bike: 'Bike' };
const MODE_ORDER: TravelMode[] = ['car', 'train', 'bus', 'walking', 'bike'];
const modesLabel = (modes: TravelMode[] = []) => (modes.length ? MODE_ORDER.filter((m) => modes.includes(m)).map((m) => MODE_LABEL[m]).join(' · ') : 'Not set');
const INTENSITY_LABEL: Record<string, string> = { relaxed: 'Relaxed', balanced: 'Balanced', packed: 'Packed' };
const DIET_LABEL: Record<MainDiet, string> = { none: 'None', vegetarian: 'Vegetarian', vegan: 'Vegan', pescatarian: 'Pescatarian' };

// ---------------------------------------------------------------------------

export function SettingsScreen({ data, refresh, route }: {
  data: HouseholdResponse | null; refresh: () => Promise<void>;
  route: Extract<Route, { name: 'settings' }>;
}) {
  const { navigate } = useRouter();
  const section = route.section;

  if (section === 'notifications') {
    return (
      <View style={styles.screen}>
        <CompactBand title="Notifications" onBack={() => navigate(paths.settings())} />
        <NotificationsSettings onBack={() => navigate(paths.settings())} />
      </View>
    );
  }
  if (section === 'providers') {
    return (
      <View style={styles.screen}>
        <CompactBand title="Providers" onBack={() => navigate(paths.settings())} />
        <ScrollView contentContainerStyle={styles.page}><ProvidersTable /></ScrollView>
      </View>
    );
  }
  if (!data) return <View style={styles.screen}><Text style={[type.small, { padding: spacing.lg }]}>Loading…</Text></View>;
  if (section === 'devices') {
    return (
      <View style={styles.screen}>
        <CompactBand title="Signed-in devices" onBack={() => navigate(paths.settings())} />
        <ScrollView contentContainerStyle={styles.page}><DevicesList /></ScrollView>
      </View>
    );
  }
  return <SettingsHome data={data} refresh={refresh} />;
}

function SettingsHome({ data, refresh }: { data: HouseholdResponse; refresh: () => Promise<void> }) {
  const [tab, setTab] = useQueryState<'household' | 'account'>('tab', 'household', asOneOf(['household', 'account'], 'household'));
  return (
    <View style={styles.screen}>
      <TitleBand title="Settings" />
      <InkMenu<'household' | 'account'>
        tabs={[{ key: 'household', label: 'Household' }, { key: 'account', label: 'My Account' }]}
        selected={tab}
        onSelect={(k) => setTab(k, { replace: true })}
      />
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        {tab === 'household' ? <HouseholdTab data={data} refresh={refresh} /> : <MyAccountTab data={data} refresh={refresh} />}
      </ScrollView>
    </View>
  );
}

// --- SE1 · Household --------------------------------------------------------

function HouseholdTab({ data, refresh }: { data: HouseholdResponse; refresh: () => Promise<void> }) {
  const { navigate } = useRouter();
  const { account } = useSession();
  const { household, members } = data;
  const solo = account?.plan === 'solo';
  const [editingHome, setEditingHome] = useState(false);
  if (solo) return <SoloHousehold data={data} refresh={refresh} />;

  const place = household.home?.label?.split(',')[0]?.trim();
  return (
    <>
      {/* Household name + address edit (the editor itself is a later item). */}
      <View style={styles.nameRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.householdName} numberOfLines={1}>{household.name}</Text>
          <Text style={type.small}>{[place, `${members.length} ${members.length === 1 ? 'person' : 'people'}`].filter(Boolean).join(' · ')}</Text>
        </View>
        <Press onPress={() => setEditingHome(true)} accessibilityRole="button"><Text style={styles.editLink}>Edit</Text></Press>
      </View>
      {editingHome ? <HouseholdEditSheet household={household} refresh={refresh} onClose={() => setEditingHome(false)} /> : null}

      <FaceRow members={members} me={data.me} cap={household.planCap ?? 6} onOpen={(id) => navigate(paths.household(id))} onAdded={refresh} />

      {/* How Epic plans */}
      <SectionHead>How Epic plans</SectionHead>
      <Text style={[type.small, { marginTop: -6, marginBottom: 6 }]}>Defaults for every plan. A trip request can change them.</Text>
      <PlanRows household={household} refresh={refresh} />
    </>
  );
}

function PlanRows({ household, refresh }: { household: HouseholdResponse['household']; refresh: () => Promise<void> }) {
  const [plan, setPlan] = useQueryState<string | null>('plan', null, asText as any);
  const close = () => setPlan(null, { replace: true });
  return (
    <>
      <ValueRow label="Close to home" value={CLOSE_LABEL(household.closeToHomeMinutes)} onPress={() => setPlan('close')} />
      <ValueRow label="Getting there" value={modesLabel(household.travelModes)} onPress={() => setPlan('there')} />
      <ValueRow label="How busy a day" value={INTENSITY_LABEL[household.defaultIntensity]} onPress={() => setPlan('busy')} />
      <ValueRow label="When your day runs" value={`${HOUR(household.dayStart ?? 10)}–${HOUR(household.dayEnd ?? 18)}`} onPress={() => setPlan('day')} />
      {plan === 'close' ? <CloseToHomeSheet household={household} refresh={refresh} onClose={close} /> : null}
      {plan === 'there' ? <GettingThereSheet household={household} refresh={refresh} onClose={close} /> : null}
      {plan === 'busy' ? <HowBusySheet household={household} refresh={refresh} onClose={close} /> : null}
      {plan === 'day' ? <DayRunsSheet household={household} refresh={refresh} onClose={close} /> : null}
    </>
  );
}

// --- the household's name, home and picture ----------------------------------

/**
 * The household's name, home address and home picture. The design's own
 * household editor is a later item; until it lands, these stay editable here,
 * because a household that moves must be able to say so — planning reads the
 * home (Codex, 2 Oct 2026; the old Household card's editing, carried over).
 */
function HouseholdEditSheet({ household, refresh, onClose }: { household: HouseholdResponse['household']; refresh: () => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(household.name);
  const [busy, setBusy] = useState(false);
  const [changingHome, setChangingHome] = useState(!household.home);
  const address = household.home?.formatted ?? household.home?.label ?? null;
  const save = async () => {
    const v = name.trim();
    if (!v || v === household.name) { onClose(); return; }
    setBusy(true);
    try { await api.updateHousehold({ name: v }); await refresh(); showToast('Saved'); onClose(); }
    catch (e: any) { showToast(e?.body?.message || 'Could not save'); }
    finally { setBusy(false); }
  };
  const setHome = async (p: Place | null) => {
    if (!p) return;
    try { await api.updateHousehold({ home: p }); await refresh(); setChangingHome(false); showToast('Home saved'); }
    catch (e: any) { showToast(e?.body?.message || 'Could not save the home'); }
  };
  const setPhoto = async () => {
    const url = await pickSquarePhoto('library', { aspect: [3, 2], width: 900, height: 600 });
    if (!url) return;
    try { await api.updateHousehold({ homePhotoUrl: url }); await refresh(); showToast('Picture saved'); }
    catch (e: any) { showToast(e?.body?.message || 'Could not save the picture'); }
  };
  return (
    <Sheet title="Your household" onCancel={onClose} cancelLabel="Cancel" onDone={save} doneLabel="Save" doneDisabled={busy} onClose={onClose}>
      <Text style={type.small}>Name</Text>
      <TextInput value={name} onChangeText={setName} placeholder="Household name" placeholderTextColor={colors.inkFaint} accessibilityLabel="Household name" style={styles.input} />
      <Text style={[type.small, { marginTop: 12 }]}>Home</Text>
      {address && !changingHome ? (
        <Press onPress={() => setChangingHome(true)} accessibilityRole="button"><Text style={type.body}>{address} <Text style={styles.editLink}>Change</Text></Text></Press>
      ) : (
        <PlacePicker value={household.home} onPick={setHome} placeholder="House name or number, street, town, postcode" />
      )}
      <Press onPress={() => void setPhoto()} accessibilityRole="button" style={{ marginTop: 12 }}>
        <Text style={styles.editLink}>{household.homePhotoUrl ? 'Change the picture of home' : 'Add a picture of home'}</Text>
      </Press>
    </Sheet>
  );
}

// --- the face row -----------------------------------------------------------

function FaceRow({ members, me, cap, onOpen, onAdded }: { members: Member[]; me: string | null; cap: number; onOpen: (id: string) => void; onAdded: () => Promise<void> }) {
  const atCap = members.length >= cap;
  const [adding, setAdding] = useState(false);
  return (
    <View style={{ marginTop: spacing.md }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.faces}>
        {members.map((m, i) => {
          const pending = m.access?.status === 'invited';
          return (
            <Press key={m.id} onPress={() => onOpen(m.id)} accessibilityRole="button" accessibilityLabel={`Open ${m.name}`} style={styles.faceCell}>
              <View>
                <Avatar name={m.name} index={i} size={60} url={m.avatarUrl} />
                {pending ? <View style={styles.sendBadge}><Icon name="send" size={12} color={INK} strokeWidth={2.2} /></View> : null}
              </View>
              <Text style={styles.faceLabel} numberOfLines={1}>{m.id === me ? 'You' : m.name.split(/\s+/)[0]}</Text>
              {pending ? <Text style={styles.invited} numberOfLines={1}>Invited</Text> : null}
            </Press>
          );
        })}
        <Press onPress={() => !atCap && setAdding(true)} disabled={atCap} accessibilityRole="button" accessibilityLabel="Add someone" style={[styles.faceCell, atCap && { opacity: 0.35 }]}>
          <View style={styles.addCircle}><Icon name="add" size={22} color={colors.inkMuted} strokeWidth={2.2} /></View>
          <Text style={styles.faceLabel}>Add</Text>
        </Press>
      </ScrollView>
      <View style={styles.rule2} />
      {atCap ? <Text style={[type.small, { marginTop: 8 }]}>Your Household plan covers up to {cap} people.</Text> : null}
      {adding ? <AddPersonInline onDone={async (id) => { setAdding(false); await onAdded(); if (id) onOpen(id); }} onCancel={() => setAdding(false)} /> : null}
    </View>
  );
}

/** A minimal add (the fuller flow is a later item): a name, and into the household. */
function AddPersonInline({ onDone, onCancel }: { onDone: (id?: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const add = async () => {
    if (!name.trim()) return;
    setBusy(true); setErr(null);
    try { const r = await api.addMember({ name: name.trim() }); onDone(r.member?.id); }
    catch (e: any) { setErr(e?.body?.message || e?.message || 'Could not add.'); }
    finally { setBusy(false); }
  };
  return (
    <View style={{ marginTop: spacing.md, gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={colors.inkFaint} style={styles.input} autoFocus onSubmitEditing={add} />
        <Button label="Add" onPress={add} loading={busy} />
      </View>
      {err ? <Text style={[type.small, { color: colors.overrun }]}>{err}</Text> : null}
      <Press onPress={onCancel}><Text style={styles.cancelLink}>Cancel</Text></Press>
    </View>
  );
}

// --- SE12 · Solo ------------------------------------------------------------

function SoloHousehold({ data, refresh }: { data: HouseholdResponse; refresh: () => Promise<void> }) {
  const { navigate } = useRouter();
  const you = data.members[0];
  return (
    <>
      {you ? (
        <Press onPress={() => navigate(paths.household(you.id))} accessibilityRole="button" style={styles.soloHead}>
          <Avatar name={you.name} index={0} size={60} url={you.avatarUrl} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={type.h2} numberOfLines={1}>{you.name}</Text>
            <Text style={type.small}>Solo plan · just you</Text>
          </View>
        </Press>
      ) : null}
      {you ? <ValueRow label="Your tastes, allergies and access" onPress={() => navigate(paths.household(you.id))} /> : null}
      <View style={styles.tintBlock}>
        <Text style={styles.tintTitle}>Planning for more than you?</Text>
        <Text style={styles.tintBody}>The Household plan covers up to {data.household.householdPlanCap ?? 6} people, each with their own tastes and allergies.</Text>
        <Button label="Switch to Household" onPress={() => showToast('Plan and billing is coming soon')} style={{ marginTop: 10 }} />
      </View>
      <SectionHead>How Epic plans</SectionHead>
      <PlanRows household={data.household} refresh={refresh} />
    </>
  );
}

// --- SE2 · My Account -------------------------------------------------------

function MyAccountTab({ data, refresh }: { data: HouseholdResponse; refresh: () => Promise<void> }) {
  const { navigate } = useRouter();
  const { account, isOwner } = useSession();
  const { pref, setPref } = useTheme();
  const [speak, setSpeak] = useState(getSpeakPref());
  const [showWords, setShowWords] = useState(getVoiceConfirmPref());
  const me = data.members.find((m) => m.id === data.me) ?? data.members[0];
  // The household's lead (its first account) pays and may delete it; the
  // estate owner is a different thing and keeps only "Providers and usage"
  // (Codex, 2 Oct 2026). The shared passcode is the founding household's lead.
  const isLead = isOwner || Boolean(data.meIsLead) || Boolean(data.members.find((m) => m.id === data.me)?.access?.isLead);
  const [ratingsOpen, setRatingsOpen] = useQueryState('ratings', false, asFlag);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [devices, setDevices] = useState<number | null>(null);
  useEffect(() => { api.devices().then((d) => setDevices(d.sessions.length)).catch(() => setDevices(null)); }, []);

  return (
    <>
      <SectionHead>Voice</SectionHead>
      <ToggleRow label="Show words before planning" value={showWords} onChange={(v) => { setShowWords(v); storage.setItem(VOICE_CONFIRM_KEY, v ? 'on' : 'off'); }} />
      <ToggleRow label="Speak replies" value={speak} onChange={(v) => { setSpeak(v); storage.setItem(SPEAK_KEY, v ? 'on' : 'off'); }} />
      <ValueRow label="Language" value="English (UK)" onPress={() => showToast('Language options are coming soon')} />

      {/* SE2: Notifications, ratings and appearance follow Voice without heads of their own. */}
      <View style={{ marginTop: 10 }}>
        <ValueRow label="Notifications" value="Reminders, replies" onPress={() => navigate(paths.settingsNotifications())} />
      </View>
      <ValueRow label="Whose ratings to show" value={`${ratingsViewLabel(me?.ratingsView, data.members)} · your setting`} onPress={() => setRatingsOpen(true, { replace: true })} />
      <View style={styles.apBlock}>
        <Text style={styles.rowLabel}>Appearance</Text>
        <Appearance value={pref === 'system' ? 'match' : pref} onChange={(v) => setPref(v === 'match' ? 'system' : v)} />
      </View>

      <SectionHead>Account</SectionHead>
      {isLead ? <ValueRow label="Plan and billing" value={account?.plan === 'solo' ? 'Solo' : 'Household'} onPress={() => showToast('Plan and billing is coming soon')} /> : null}
      <ValueRow label="Signed-in devices" value={devices == null ? undefined : String(devices)} onPress={() => navigate(paths.settings('devices'))} />
      {/* A plain row, no arrow: it does, it does not open (SE2). */}
      <Press onPress={async () => { await api.signOut(); if (Platform.OS === 'web' && typeof location !== 'undefined') location.reload(); }} accessibilityRole="button" style={styles.row}>
        <Text style={styles.rowLabel}>Sign out</Text>
      </Press>
      {isLead
        ? <DangerRow label="Delete household" onPress={() => setConfirmDelete(true)} />
        : <DangerRow label="Leave household" onPress={() => setConfirmLeave(true)} />}

      <Footer />

      {ratingsOpen && me ? <RatingsSheet member={me} members={data.members} refresh={refresh} onClose={() => setRatingsOpen(false, { replace: true })} /> : null}
      {confirmDelete ? <DeleteHouseholdSheet name={data.household.name} refresh={refresh} onClose={() => setConfirmDelete(false)} /> : null}
      {confirmLeave ? <LeaveHouseholdSheet name={data.household.name} me={data.me} ownerName={data.members.find((m) => m.access?.isLead)?.name ?? null} onClose={() => setConfirmLeave(false)} /> : null}
    </>
  );
}

function ratingsViewLabel(rv: RatingsView | undefined, members: Member[]): string {
  if (!rv || rv.mode === 'all') return 'Everyone in the household';
  if (rv.mode === 'mine') return 'Only mine';
  return `${rv.who.length} ${rv.who.length === 1 ? 'person' : 'people'}`;
}

// --- Appearance (SE2) -------------------------------------------------------

function Appearance({ value, onChange }: { value: 'light' | 'dark' | 'match'; onChange: (v: 'light' | 'dark' | 'match') => void }) {
  const opts: { key: 'light' | 'dark' | 'match'; label: string; icon: string; flex: number }[] = [
    { key: 'light', label: 'Light', icon: 'light', flex: 1 },
    { key: 'dark', label: 'Dark', icon: 'dark', flex: 1 },
    { key: 'match', label: 'Match phone', icon: 'phone', flex: 1.4 },
  ];
  return (
    <View style={styles.apTrack}>
      {opts.map((o) => {
        const on = value === o.key;
        return (
          <Press key={o.key} onPress={() => onChange(o.key)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.apCell, { flex: o.flex }, on && styles.apCellOn]}>
            <Icon name={o.icon as any} size={16} color={on ? LIME : colors.ink} strokeWidth={2.2} />
            <Text numberOfLines={1} style={[styles.apLabel, on && styles.apLabelOn]}>{o.label}</Text>
          </Press>
        );
      })}
    </View>
  );
}

// --- SX6 · Signed-in devices ------------------------------------------------

function DevicesList() {
  const [rows, setRows] = useState<{ id: string; label: string; lastSeen: string; current: boolean }[] | null>(null);
  const [confirm, setConfirm] = useState<{ id?: string; all?: boolean; label: string } | null>(null);
  const load = () => api.devices().then((d) => setRows(d.sessions as any)).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  if (!rows) return <Text style={type.small}>Loading…</Text>;
  const others = rows.filter((r) => !r.current);
  return (
    <>
      {rows.map((r) => (
        <View key={r.id} style={styles.deviceRow}>
          <View style={[styles.deviceTile, r.current && { backgroundColor: LIME }]}><Icon name={r.current ? "phone" : "laptop"} size={18} color={r.current ? INK : colors.ink} strokeWidth={2} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={type.h3} numberOfLines={1}>{r.label || 'A device'}{r.current ? ' · this device' : ''}</Text>
            <Text style={type.tiny}>Last active {whenAgo(r.lastSeen)}</Text>
          </View>
          {!r.current ? <Press onPress={() => setConfirm({ id: r.id, label: r.label || 'that device' })} accessibilityRole="button"><Text style={styles.signOut}>Sign out</Text></Press> : null}
        </View>
      ))}
      {others.length ? <View style={{ marginTop: spacing.lg }}><Button kind="danger" label="Sign out all other devices" onPress={() => setConfirm({ all: true, label: 'all other devices' })} /></View> : null}
      {confirm ? (
        <ConfirmSheet
          title={confirm.all ? 'Sign out all other devices?' : `Sign out of ${confirm.label}?`}
          body={confirm.all ? "You'll need to sign in again on each of them." : "You'll need to sign in again on that device."}
          danger="Sign out"
          onConfirm={async () => {
            if (confirm.all) { await api.signOutOtherDevices(); showToast('Signed out of all other devices'); }
            else if (confirm.id) { await api.signOutDevice(confirm.id); showToast('Signed out'); }
            setConfirm(null); await load();
          }}
          onClose={() => setConfirm(null)}
        />
      ) : null}
    </>
  );
}

const whenAgo = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} days ago`;
};

// --- the How-Epic-plans sheets (SE7–SE11) -----------------------------------

function CloseToHomeSheet({ household, refresh, onClose }: SheetProps) {
  const opts: { v: number; label: string }[] = [
    { v: 30, label: 'Up to 30 min' }, { v: 60, label: 'Up to 1 hr' }, { v: 90, label: 'Up to 1½ hrs' }, { v: 120, label: 'Up to 2 hrs' }, { v: 0, label: 'Any distance' },
  ];
  const current = household.closeToHomeMinutes ?? 0;
  const place = household.home?.label?.split(',')[0]?.trim();
  const save = async (v: number) => { await api.updateHousehold({ closeToHomeMinutes: v }); await refresh(); setTimeout(onClose, 220); };
  return (
    <Sheet title="Close to home" onDone={onClose} onClose={onClose}>
      {place ? <Text style={[type.small, { marginBottom: 6 }]}>{`From ${place}${(household.travelModes?.length ?? 0) > 1 ? ' · by any way you ticked' : ''}`}</Text> : null}
      {opts.map((o) => <OptionRow key={o.v} label={o.label} on={current === o.v} onPress={() => save(o.v)} />)}
    </Sheet>
  );
}

function GettingThereSheet({ household, refresh, onClose }: SheetProps) {
  const [modes, setModes] = useState<TravelMode[]>(household.travelModes ?? []);
  const toggle = async (m: TravelMode) => {
    const next = modes.includes(m) ? modes.filter((x) => x !== m) : [...modes, m];
    setModes(next); await api.updateHousehold({ travelModes: next }); await refresh();
  };
  return (
    <Sheet title="Getting there" onDone={onClose} onClose={onClose}>
      <Text style={[type.small, { marginBottom: 6 }]}>Pick all that work.</Text>
      {MODE_ORDER.map((m) => <OptionRow key={m} label={MODE_LABEL[m]} on={modes.includes(m)} onPress={() => toggle(m)} />)}
    </Sheet>
  );
}

function HowBusySheet({ household, refresh, onClose }: SheetProps) {
  const cards: { v: 'relaxed' | 'balanced' | 'packed'; label: string; sub: string }[] = [
    { v: 'relaxed', label: 'Relaxed', sub: '2–3 stops, long lunch' },
    { v: 'balanced', label: 'Balanced', sub: '3–4 stops' },
    { v: 'packed', label: 'Packed', sub: '5 or more stops' },
  ];
  const save = async (v: string) => { await api.updateHousehold({ defaultIntensity: v as any }); await refresh(); setTimeout(onClose, 220); };
  return (
    <Sheet title="How busy a day" onDone={onClose} onClose={onClose}>
      {cards.map((c) => {
        const on = household.defaultIntensity === c.v;
        return (
          <Press key={c.v} onPress={() => save(c.v)} accessibilityRole="button" style={[styles.busyCard, on && styles.busyCardOn]}>
            <Text style={[type.h3, on && { color: colors.ink }]}>{c.label}</Text>
            <Text style={type.small}>{c.sub}</Text>
          </Press>
        );
      })}
    </Sheet>
  );
}

function DayRunsSheet({ household, refresh, onClose }: SheetProps) {
  const [start, setStart] = useState(household.dayStart ?? 10);
  const [end, setEnd] = useState(household.dayEnd ?? 18);
  const save = async (s: number, e: number) => { setStart(s); setEnd(e); await api.updateHousehold({ dayStart: s, dayEnd: e }); await refresh(); };
  return (
    <Sheet title="When your day runs" onDone={onClose} onClose={onClose}>
      <StepperRow label="Start" value={HOUR(start)} onMinus={start > 7 && end - (start - 1) >= 4 ? () => save(start - 1, end) : null} onPlus={start < 12 && end - (start + 1) >= 4 ? () => save(start + 1, end) : null} />
      <StepperRow label="Finish" value={HOUR(end)} onMinus={end > 14 && (end - 1) - start >= 4 ? () => save(start, end - 1) : null} onPlus={end < 22 ? () => save(start, end + 1) : null} />
    </Sheet>
  );
}

function RatingsSheet({ member, members, refresh, onClose }: { member: Member; members: Member[]; refresh: () => Promise<void>; onClose: () => void }) {
  const [rv, setRv] = useState<RatingsView>(member.ratingsView ?? { mode: 'all', who: [] });
  const choose = async (next: RatingsView, close = false) => { setRv(next); await api.updateMember(member.id, { ratingsView: next }); await refresh(); if (close) setTimeout(onClose, 220); };
  return (
    <Sheet title="Whose ratings to show" onDone={onClose} onClose={onClose}>
      <OptionRow label="Everyone in the household" on={rv.mode === 'all'} onPress={() => choose({ mode: 'all', who: [] }, true)} />
      <OptionRow label="Only mine" on={rv.mode === 'mine'} onPress={() => choose({ mode: 'mine', who: [] }, true)} />
      <OptionRow label="Choose people" on={rv.mode === 'some'} onPress={() => choose({ mode: 'some', who: rv.who })} />
      {rv.mode === 'some' ? (
        <View style={styles.whoGrid}>
          {members.map((m, i) => {
            const on = rv.who.includes(m.id);
            return (
              <Press key={m.id} onPress={() => choose({ mode: 'some', who: on ? rv.who.filter((x) => x !== m.id) : [...rv.who, m.id] })} accessibilityRole="button" style={styles.whoCell}>
                <View style={on ? styles.whoOn : styles.whoOff}><Avatar name={m.name} index={i} size={52} url={m.avatarUrl} /></View>
                <Text style={styles.faceLabel} numberOfLines={1}>{m.name.split(/\s+/)[0]}</Text>
              </Press>
            );
          })}
        </View>
      ) : null}
    </Sheet>
  );
}

// --- the destructive confirms -----------------------------------------------

function DeleteHouseholdSheet({ name, refresh, onClose }: { name: string; refresh: () => Promise<void>; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [outstanding, setOutstanding] = useState<Outstanding | null>(null);
  const del = async () => {
    setBusy(true);
    try { await api.deleteHousehold(typed); showToast('Deleted'); await refresh(); onClose(); }
    catch (e: any) {
      if (e?.code === 'has_outstanding') setOutstanding(e.body?.details ?? { blocked: true });
      else showToast(e?.body?.message || 'Could not delete.');
    } finally { setBusy(false); }
  };
  if (outstanding) return <OutstandingSheet what="delete the household" outstanding={outstanding} onClose={onClose} />;
  return (
    <Sheet title={`Delete ${name}?`} onCancel={onClose} cancelLabel="Cancel" onClose={onClose}>
      <Text style={type.body}>Everything Epic holds for this household — people, trips, visits, ratings — is deleted. Type the household name to confirm.</Text>
      <TextInput value={typed} onChangeText={setTyped} placeholder={name} placeholderTextColor={colors.inkFaint} style={styles.input} />
      <Button kind="danger" label={`Delete ${name}`} disabled={typed !== name} loading={busy} onPress={del} />
    </Sheet>
  );
}

function LeaveHouseholdSheet({ name, me, ownerName, onClose }: { name: string; me: string | null; ownerName: string | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const owner = ownerName ? ownerName.split(/\s+/)[0] : 'the owner';
  const leave = async () => {
    if (!me) return;
    setBusy(true);
    // Leaving drops your own sign-in but keeps your profile and tastes; the
    // household's trips and How-Epic-plans stay. Then this device signs out.
    try { await api.removeMemberAccess(me); } catch (e: any) { setBusy(false); showToast(e?.body?.message || 'Could not leave'); return; }
    await api.signOut();
    if (Platform.OS === 'web' && typeof location !== 'undefined') location.reload();
  };
  return (
    <Sheet title={`Leave ${name}?`} onCancel={onClose} cancelLabel="Cancel" onClose={onClose}>
      <Text style={type.body}>You keep your own profile and tastes. Shared trips and How Epic plans stay with the household, and {owner} can invite you back.</Text>
      <Button kind="danger" label="Leave household" loading={busy} onPress={leave} />
    </Sheet>
  );
}

export type Outstanding = { blocked: boolean; upcomingDates?: number; guests?: number; payout?: { amountPence: number; on: string } | null };

/** SX21 — stop hosting / delete household, blocked while anything is outstanding. */
export function OutstandingSheet({ what, outstanding, onClose, onSeeUpcoming }: { what: string; outstanding: Outstanding; onClose: () => void; onSeeUpcoming?: () => void }) {
  const { navigate } = useRouter();
  return (
    <Sheet title={`You can't ${what} yet`} onClose={onClose}>
      <Text style={type.body}>Finish or call off what's outstanding first.</Text>
      {outstanding.upcomingDates ? <Text style={styles.outRow}>{`${outstanding.upcomingDates} upcoming ${outstanding.upcomingDates === 1 ? 'date' : 'dates'} · ${outstanding.guests ?? 0} ${outstanding.guests === 1 ? 'guest' : 'guests'} booked`}</Text> : null}
      {outstanding.payout ? <Text style={styles.outRow}>{`Payout of ${gbp(outstanding.payout.amountPence)} on ${outstanding.payout.on}`}</Text> : null}
      <Button label="See upcoming" onPress={() => { onClose(); (onSeeUpcoming ?? (() => navigate(paths.host())))(); }} />
      <Button kind="ghost" label="OK" onPress={onClose} />
    </Sheet>
  );
}

const gbp = (pence: number) => `£${(pence / 100).toFixed(2)}`;

function ConfirmSheet({ title, body, danger, onConfirm, onClose }: { title: string; body: string; danger: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Sheet title={title} onCancel={onClose} cancelLabel="Cancel" onClose={onClose}>
      <Text style={type.body}>{body}</Text>
      <Button kind="danger" label={danger} onPress={onConfirm} />
    </Sheet>
  );
}

// --- the footer (build) -----------------------------------------------------

function Footer() {
  const [hashes, setHashes] = useState<{ app: string | null; api: string | null } | null>(null);
  const reveal = () => {
    api.health().then((h: any) => {
      let web: string | null = null;
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const src = Array.from(document.querySelectorAll('script[src]')).map((el) => (el as HTMLScriptElement).src).find((u) => /_expo\/static\/js/.test(u));
        web = src?.match(/index-([0-9a-f]{8})/)?.[1] ?? 'unknown';
      }
      setHashes({ app: web, api: h.commit ?? 'unknown' });
    }).catch(() => setHashes({ app: 'unknown', api: 'unreachable' }));
  };
  return (
    <Press onLongPress={reveal} delayLongPress={500} accessibilityRole="button" style={{ paddingTop: 16, paddingBottom: 20 }}>
      <Text style={styles.footer}>Epic 4.12.0 · <Text style={{ textDecorationLine: 'underline' }} onPress={() => { if (Platform.OS === 'web') window.location.reload(); }}>Get newest version</Text></Text>
      {hashes ? <Text style={[styles.footer, { marginTop: 4 }]}>app {hashes.app} · api {hashes.api}</Text> : null}
    </Press>
  );
}

// --- small shared rows/controls ---------------------------------------------

type SheetProps = { household: HouseholdResponse['household']; refresh: () => Promise<void>; onClose: () => void };

function SectionHead({ children }: { children: React.ReactNode }) {
  return <View style={styles.sectionHead}><Text style={styles.sectionHeadText}>{children}</Text></View>;
}

function ValueRow({ label, value, onPress }: { label: string; value?: string; onPress: () => void }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" style={styles.row}>
      <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
      {value != null ? <Text style={styles.rowValue} numberOfLines={1}>{value}</Text> : null}
      <Icon name="more" size={18} color={colors.inkFaint} />
    </Press>
  );
}

function DangerRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    // SE2: set apart from Sign out by 22px, and no line under it.
    <Press onPress={onPress} accessibilityRole="button" style={styles.danger}>
      <Text style={styles.dangerLabel}>{label}</Text>
    </Press>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { flex: 1 }]}>{label}</Text>
      <Toggle value={value} onChange={onChange} />
    </View>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Press onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityState={{ checked: value }} style={[styles.track, { backgroundColor: value ? colors.ink : colors.ruleSoft }]}>
      <View style={[styles.knob, { backgroundColor: value ? LIME : CREAM, alignSelf: value ? 'flex-end' : 'flex-start' }]} />
    </Press>
  );
}

function OptionRow({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} style={styles.optionRow}>
      <Text style={[type.body, { flex: 1 }]}>{label}</Text>
      <View style={[styles.tick, on ? styles.tickOn : styles.tickOff]}>{on ? <Icon name="check" size={16} color={INK} strokeWidth={2.6} /> : null}</View>
    </Press>
  );
}

function StepperRow({ label, value, onMinus, onPlus }: { label: string; value: string; onMinus: (() => void) | null; onPlus: (() => void) | null }) {
  return (
    <View style={styles.stepRow}>
      <Text style={[type.body, { flex: 1 }]}>{label}</Text>
      <Press onPress={onMinus ?? undefined} disabled={!onMinus} style={[styles.stepBtn, !onMinus && { opacity: 0.35 }]} accessibilityRole="button" accessibilityLabel="Less"><Icon name="minus" size={18} color={colors.ink} /></Press>
      <Text style={styles.stepValue}>{value}</Text>
      <Press onPress={onPlus ?? undefined} disabled={!onPlus} style={[styles.stepBtn, !onPlus && { opacity: 0.35 }]} accessibilityRole="button" accessibilityLabel="More"><Icon name="add" size={18} color={colors.ink} /></Press>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  page: { padding: spacing.lg, paddingBottom: 60, width: '100%', maxWidth: 760, alignSelf: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 6 },
  householdName: { fontFamily: fonts.heading, fontSize: 22, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  editLink: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: colors.ink, textDecorationLine: 'underline' },
  faces: { gap: 6, paddingVertical: spacing.sm },
  faceCell: { width: 68, alignItems: 'center', gap: 6 },
  faceLabel: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.ink, maxWidth: 68, textAlign: 'center' },
  invited: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', color: colors.accent },
  sendBadge: { position: 'absolute', top: -2, right: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: LIME, alignItems: 'center', justifyContent: 'center' },
  addCircle: { width: 60, height: 60, borderRadius: 30, borderWidth: BORDER, borderStyle: 'dashed', borderColor: colors.ruleSoft, alignItems: 'center', justifyContent: 'center' },
  rule2: { height: BORDER, backgroundColor: colors.line, marginTop: spacing.sm },
  sectionHead: { marginTop: spacing.xl, marginBottom: spacing.md, borderBottomWidth: BORDER, borderBottomColor: colors.line, paddingBottom: 6 },
  sectionHeadText: { fontFamily: fonts.heading, fontSize: 19, fontWeight: '800', letterSpacing: -0.38, color: colors.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  rowLabel: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: colors.ink },
  rowValue: { flex: 1, textAlign: 'right', fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted },
  // Solo
  soloHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  tintBlock: { backgroundColor: colors.surfaceMuted, padding: 14, marginTop: spacing.md },
  tintTitle: { fontFamily: fonts.heading, fontSize: 17, fontWeight: '800', color: colors.accent },
  tintBody: { fontFamily: fonts.body, fontSize: 13, color: colors.accent, marginTop: 4, lineHeight: 18 },
  // Appearance
  apTrack: { flexDirection: 'row', backgroundColor: colors.warm, padding: 4, gap: 4 },
  apCell: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 10 },
  apCellOn: { backgroundColor: INK },
  apLabel: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: colors.ink },
  apLabelOn: { color: CREAM },
  // devices
  deviceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  deviceTile: { width: 40, height: 40, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center' },
  signOut: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: colors.ink },
  // option rows / sheets
  optionRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingVertical: 12 },
  tick: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  tickOn: { backgroundColor: LIME },
  tickOff: { borderWidth: BORDER, borderColor: colors.ruleSoft },
  busyCard: { padding: 14, borderWidth: BORDER, borderColor: colors.ruleSoft, gap: 2 },
  busyCardOn: { backgroundColor: colors.surfaceMuted, borderColor: colors.ink },
  stepRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52, gap: spacing.sm },
  stepBtn: { width: 44, height: 44, borderWidth: BORDER, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  stepValue: { width: 76, textAlign: 'center', fontFamily: fonts.heading, fontSize: 19, fontWeight: '800', color: colors.ink },
  whoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  whoCell: { width: 64, alignItems: 'center', gap: 4 },
  whoOn: { borderRadius: 999, borderWidth: 3, borderColor: LIME },
  whoOff: { opacity: 0.45 },
  outRow: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: colors.ink, marginTop: 2 },
  // toggles
  track: { width: 46, height: 26, padding: 2, justifyContent: 'center' },
  knob: { width: 22, height: 22 },
  // misc
  input: { minHeight: TARGET, paddingHorizontal: spacing.md, borderWidth: 1.5, borderColor: colors.ruleSoft, backgroundColor: colors.surface, fontSize: 15, color: colors.ink, flex: 1 },
  cancelLink: { fontFamily: fonts.body, fontSize: 14, color: colors.inkMuted, paddingVertical: 6 },
  footer: { fontFamily: fonts.body, fontSize: 12, color: colors.inkFaint },
  danger: { paddingTop: 22, paddingBottom: 4 },
  dangerLabel: { fontFamily: fonts.body, fontSize: 15, fontWeight: '700', color: colors.overrun },
  apBlock: { paddingTop: 14, paddingBottom: 16, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
});
