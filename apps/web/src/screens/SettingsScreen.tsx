/**
 * You and yours — Household folded into Settings (Hosts and Events S1 · S2,
 * owner 12 Sep 2026: "merge the Household and Settings into 1 tab").
 *
 * Merged, the screen reads as *you and yours*: your account, then the people,
 * then everything set once and forgotten. The household list keeps its full
 * row anatomy — avatar, name, adult/child, what they eat and do — and gains a
 * "Who's in for trips ›" link, which is where the per-trip ticking lives now.
 * Diets and access become one row rather than a wall of chips. Hosting sits as
 * its own group once you are a host, and is absent before that.
 *
 *   You                the account, or the household while there is no account
 *   Household          the people, each a page of their own (/household/<id>)
 *   Diets and access   one line, opening to who cannot eat what
 *   Where you are      home, how far "close to home" reaches, how you travel
 *   Suggestions        pace, how full a day, whose ratings a row shows
 *   Hosting            only once you host: your state, payouts, your profile
 *   Voice              how Epic listens
 *   Appearance         light / dark
 *   Account            this build, devices, what waits to send, your data
 *
 * Providers — the owner's table of what is wired in and what it costs — keeps
 * its own address, /settings/providers, and is a row at the foot.
 */

import React, { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Press } from '../components/press';
import { api, HostHome, HouseholdResponse, Member } from '../api';
import { colors, fonts, radius, resolveTheme, spacing, TARGET, type, BORDER } from '../theme';
import { Button, Card, Chip, FoldLine, Row, Segmented, SectionTitle, StatusLine, Stepper, minutes } from '../components/ui';
import { useRouter } from '../router';
import { paths, type Route, type SettingsSection } from '../routes';
import { ProvidersTable } from '../components/ProvidersTable';
import { useTheme } from '../hooks/useTheme';
import { useSession } from '../hooks/useSession';
import { getViewer, setViewer } from '../viewer';
import { isAdmin, setAdmin } from '../admin';
import { Icon } from '../components/Icon';
import { Avatar } from '../components/Faces';
import { OfflineCard } from '../components/OfflineCard';
import { AccountCard } from '../components/AccountCard';
import { VOICE_LANGUAGES, VOICE_MODES, VoiceMode, getVoiceConfirm, getVoiceLanguage, getVoiceMode, setVoiceConfirm, setVoiceLanguage, setVoiceMode, voiceLanguageLabel, voiceModeLabel } from '../voice/settings';
import { AddPerson, HomeCard, summarise } from './HouseholdScreen';
import { TRUST_LABEL, dateOnly } from '../components/hosting';

export const SPEAK_KEY = 'epic.speakReplies';
export const getSpeakPref = () => (Platform.OS === 'web' && typeof localStorage !== 'undefined' ? localStorage.getItem(SPEAK_KEY) !== 'off' : true);

const MODE_LABEL: Record<string, string> = { driving: 'Drive', transit: 'Train & bus', walking: 'On foot', cycling: 'Cycle' };

/**
 * Which build answered (owner, 4 Sep 2026: "It seems like it hasn't deployed
 * yet"). The app's own build is the hash in the bundle's file name; the API
 * says which commit it is running. Between them, "is it live" stops being a
 * guess, and a stale browser copy shows up as a build that does not match.
 */
function BuildCard() {
  const [api_, setApi] = useState<string | null>(null);
  const [web, setWeb] = useState<string | null>(null);
  useEffect(() => {
    api.health().then((h: any) => setApi(h.commit ?? 'unknown')).catch(() => setApi('unreachable'));
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const src = Array.from(document.querySelectorAll('script[src]')).map((el) => (el as HTMLScriptElement).src).find((u) => /_expo\/static\/js/.test(u));
    setWeb(src?.match(/index-([0-9a-f]{8})/)?.[1] ?? 'unknown');
  }, []);
  const reload = () => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    navigator.serviceWorker?.getRegistration().then((r) => { r?.waiting?.postMessage('skip-waiting'); r?.update(); }).finally(() => window.location.reload());
  };
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}><Text style={type.small}>App</Text><Text style={[type.small, { fontWeight: '700', color: colors.ink }]}>{web ?? '…'}</Text></Row>
      <Row style={{ justifyContent: 'space-between' }}><Text style={type.small}>API</Text><Text style={[type.small, { fontWeight: '700', color: colors.ink }]}>{api_ ?? '…'}</Text></Row>
      <Text style={[type.tiny, { marginTop: spacing.sm }]}>Quote these two if something looks older than it should be.</Text>
      <Button label="Get the newest version" kind="secondary" onPress={reload} style={{ marginTop: spacing.sm }} />
    </Card>
  );
}

export function SettingsScreen({ data, refresh, route }: {
  data: HouseholdResponse | null; refresh: () => Promise<void>;
  /** The merged screen is `/settings`; the owner's providers table is `/settings/providers`. */
  route: Extract<Route, { name: 'settings' }>;
}) {
  const { navigate } = useRouter();
  const section: SettingsSection = route.section;
  if (!data) return <View style={styles.page}><Text style={type.small}>Loading…</Text></View>;
  if (section === 'providers') {
    return (
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Press onPress={() => navigate(paths.settings())} accessibilityRole="button"><Row><Icon name="back" size={18} /><Text style={type.h3}>You and yours</Text></Row></Press>
        <Text style={type.title}>Providers</Text>
        <Text style={type.small}>Every provider on one row: switch it on or off, what is free, what is paid, what it cost. Tap a row for the detail.</Text>
        <Providers />
      </ScrollView>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <YouAndYours data={data} refresh={refresh} />
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// the merged screen
// ---------------------------------------------------------------------------

function YouAndYours({ data, refresh }: { data: HouseholdResponse; refresh: () => Promise<void> }) {
  const { navigate } = useRouter();
  const { account, isOwner } = useSession();
  const { household, members } = data;
  const [speak, setSpeak] = useState(getSpeakPref());
  const [voiceMode, setVoiceModeState] = useState<VoiceMode>(getVoiceMode());
  const [voiceLanguage, setVoiceLanguageState] = useState<string>(getVoiceLanguage() ?? 'auto');
  const [voiceConfirm, setVoiceConfirmState] = useState(getVoiceConfirm());
  const { pref: themePref, setPref: setThemePref } = useTheme();
  const [viewer, setViewerState] = useState<string | null>(getViewer(members));
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Hosting is its own group once you host, and absent before that.
  const [hosting, setHosting] = useState<HostHome | null>(null);
  useEffect(() => { api.hostHome().then(setHosting).catch(() => setHosting(null)); }, []);

  const you = account?.name ?? members.find((m) => !m.isMinor)?.name ?? household.name;
  const initials = (you ?? 'Epic').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
  const diets = members.flatMap((m) => [...m.allergens.map((c) => ({ m, c, kind: 'allergen' as const })), ...m.diets.map((c) => ({ m, c, kind: 'diet' as const }))]);
  const dietLine = diets.length ? Array.from(new Set(diets.map((d) => d.c.value))).slice(0, 3).join(' · ') + (new Set(diets.map((d) => d.c.value)).size > 3 ? ' …' : '') : 'Nothing set';

  return (
    <>
      {/* You: who this is, before anything that can be changed. */}
      <Text style={type.title}>You and yours</Text>
      <View style={styles.identity}>
        <View style={styles.identityTile}><Text style={styles.identityInitials}>{initials}</Text></View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.identityName} numberOfLines={1}>{you}</Text>
          <Text style={type.small} numberOfLines={1}>{account?.email ?? `${members.length} ${members.length === 1 ? 'person' : 'people'} in the household`}</Text>
        </View>
      </View>

      {/* Household: the people, each a page of their own. */}
      <Row style={styles.groupHead}>
        <Text style={styles.kicker}>Household · {members.length} {members.length === 1 ? 'person' : 'people'}</Text>
        <Press onPress={() => navigate(paths.trips())} accessibilityRole="button"><Text style={styles.link}>Who's in for trips ›</Text></Press>
      </Row>
      <View>
        {members.map((m, i) => (
          <Press key={m.id} onPress={() => navigate(paths.household(m.id))} accessibilityRole="button" accessibilityLabel={`Open ${m.name}`} style={styles.personRow}>
            <Avatar name={m.name} index={i} size={40} url={m.avatarUrl} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={type.h3} numberOfLines={1}>{m.name}</Text>
              <Text style={type.tiny} numberOfLines={1}>{personLine(m, m.name === you)}</Text>
            </View>
            <Text style={type.tiny} numberOfLines={1}>{summarise(m) === 'Nothing set yet' ? 'Nothing set yet' : 'Rates places'}</Text>
            <Icon name="more" size={16} color={colors.inkMuted} />
          </Press>
        ))}
        {adding ? (
          <View style={{ paddingTop: spacing.sm }}>
            <AddPerson onAdded={async (id) => { setAdding(false); await refresh(); if (id) navigate(paths.household(id)); }} onCancel={() => setAdding(false)} />
          </View>
        ) : (
          <Press onPress={() => setAdding(true)} accessibilityRole="button" style={styles.addRow}>
            <View style={styles.addDot}><Icon name="add" size={14} color={colors.accent} /></View>
            <Text style={[type.h3, { color: colors.accent }]}>Add someone</Text>
          </Press>
        )}
        {members.some((m) => summarise(m) === 'Nothing set yet') || !household.home ? (
          <Press onPress={() => navigate(paths.setup())} accessibilityRole="button" style={styles.tellBanner}>
            <View style={styles.tellTile}><Icon name="mic" size={16} color={colors.selectedFg} strokeWidth={2.2} /></View>
            <Text style={[type.small, { flex: 1, color: colors.ink }]}><Text style={{ fontWeight: '600' }}>Tell Epic about your family</Text> — two minutes, and we'll stop asking.</Text>
            <Icon name="more" size={16} color={colors.inkMuted} />
          </Press>
        ) : null}
      </View>

      {/* Diets and access: one row, opening to who. */}
      <View style={styles.rows}>
        <FoldLine label="Diets and access" value={dietLine} icon="allergen">
          <View style={{ gap: spacing.sm }}>
            <Text style={type.tiny}>Allergens exclude places; diets, likes and dislikes only rank them. Change them on each person's page.</Text>
            {members.map((m) => (
              <Press key={m.id} onPress={() => navigate(paths.household(m.id))} accessibilityRole="button" style={{ gap: 4 }}>
                <Text style={type.small}>{m.name}</Text>
                <Row style={{ flexWrap: 'wrap', gap: 6 }}>
                  {m.allergens.map((c) => <Chip key={c.id} label={c.value} tone="allergen" />)}
                  {m.diets.map((c) => <Chip key={c.id} label={c.value} tone="like" />)}
                  {!m.allergens.length && !m.diets.length ? <Text style={type.tiny}>Nothing to avoid</Text> : null}
                </Row>
              </Press>
            ))}
          </View>
        </FoldLine>
      </View>

      {/* Where you are. */}
      {/* The household's name, its front door and a picture of home (owner,
          6 Sep 2026) — the card the Household tab had, kept whole. */}
      <Text style={styles.kicker}>Where you are</Text>
      <HomeCard household={household} refresh={refresh} wide={false} />
      <View style={styles.rows}>
        {household.home ? (
          <FoldLine label="Close to home reaches" value={`${household.homeRadiusMiles ?? 10} miles`} icon="here">
            <Stepper label="Miles from home" value={household.homeRadiusMiles ?? 10} min={1} max={100} format={(v) => `${v} miles`} onChange={async (v) => { await api.updateHousehold({ homeRadiusMiles: v }); await refresh(); }} />
          </FoldLine>
        ) : null}
        <FoldLine label="Default travel mode" value={household.travelMode ? MODE_LABEL[household.travelMode] ?? household.travelMode : 'Not said'} icon="driving">
          <Segmented value={household.travelMode ?? 'driving'} options={[{ value: 'driving', label: 'Drive' }, { value: 'transit', label: 'Train & bus' }, { value: 'walking', label: 'On foot' }, { value: 'cycling', label: 'Cycle' }]} onChange={async (v) => { await api.updateHousehold({ travelMode: v } as any); await refresh(); }} />
        </FoldLine>
      </View>

      {/* Suggestions: how Epic plans for this household. */}
      <Text style={styles.kicker}>Suggestions</Text>
      <View style={styles.rows}>
        <FoldLine label="How full we like a day" value={household.defaultIntensity[0].toUpperCase() + household.defaultIntensity.slice(1)} icon="hours">
          <Segmented value={household.defaultIntensity} options={[{ value: 'relaxed', label: 'Relaxed' }, { value: 'balanced', label: 'Balanced' }, { value: 'packed', label: 'Packed' }]} onChange={async (v) => { await api.updateHousehold({ defaultIntensity: v }); await refresh(); }} />
        </FoldLine>
        <FoldLine label="Our pace" value={`Eat ${minutes(household.pace.food.typicalMinutes)} · do ${minutes(household.pace.activity.typicalMinutes)}`} icon="duration">
          <Text style={type.tiny}>Eating and doing have different rhythms. "Special" is the exception you'd make for somewhere worth going further for.</Text>
          {(['food', 'activity'] as const).map((k) => (
            <View key={k} style={{ gap: 4, marginBottom: spacing.md }}>
              <Text style={type.h3}>{k === 'food' ? 'Food & drink' : 'Things to do'}</Text>
              <Stepper label="Usually spend" value={household.pace[k].typicalMinutes} min={15} max={480} format={minutes} onChange={async (v) => { await api.updateHousehold({ pace: { [k]: { typicalMinutes: v } } }); await refresh(); }} />
              <Stepper label="Longest we'd allow" value={household.pace[k].maxMinutes} min={30} max={720} format={minutes} onChange={async (v) => { await api.updateHousehold({ pace: { [k]: { maxMinutes: v } } }); await refresh(); }} />
              <Stepper label="Usual max travel" value={household.pace[k].maxTravelMinutes} min={5} max={240} format={minutes} onChange={async (v) => { await api.updateHousehold({ pace: { [k]: { maxTravelMinutes: v } } }); await refresh(); }} />
              <Stepper label="…if it's special" value={household.pace[k].maxTravelIfSpecialMinutes} min={5} max={360} format={minutes} onChange={async (v) => { await api.updateHousehold({ pace: { [k]: { maxTravelIfSpecialMinutes: v } } }); await refresh(); }} />
            </View>
          ))}
        </FoldLine>
        <FoldLine label="Ratings shown as" value={viewer ? members.find((m) => m.id === viewer)?.name.split(' ')[0] ?? 'Anyone' : 'Anyone'} icon="favourite">
          <Text style={type.tiny}>A place's row in Places shows one score: this person's. Everyone's are in the drawer. Kept on this device.</Text>
          <Segmented value={viewer ?? ''} options={[{ value: '', label: 'Anyone' }, ...members.map((m) => ({ value: m.id, label: m.name.split(' ')[0] }))]} onChange={(id) => { setViewer(id || null); setViewerState(id || null); }} />
        </FoldLine>
      </View>

      {/* Hosting: only once you are a host. */}
      {hosting?.host ? (
        <>
          <Text style={styles.kicker}>Hosting</Text>
          <View style={styles.rows}>
            <LinkRow label="Host on Epic" value={[hosting.host.checks === 'running' ? 'Checks running' : TRUST_LABEL[hosting.host.trust], `${hosting.stats?.live ?? 0} live`, hosting.stats?.nextPayoutOn ? `next ${dateOnly(hosting.stats.nextPayoutOn)}` : null].filter(Boolean).join(' · ')} onPress={() => navigate(paths.host())} icon="host" />
            <LinkRow label="Payouts" value={hosting.host.payoutStatus === 'connected' ? hosting.host.payoutLabel ?? 'Connected' : 'Not connected'} onPress={() => navigate(paths.hostStart(4))} icon="payout" />
            <LinkRow label="Your host profile" value="Public" onPress={() => navigate(paths.hostProfile(hosting.host!.id))} icon="guest" />
            <StopHosting onDone={() => { setHosting(null); navigate(paths.host()); }} />
          </View>
        </>
      ) : null}

      {/* Voice. */}
      <Text style={styles.kicker}>Voice</Text>
      <View style={styles.rows}>
        <FoldLine label="How Epic listens" value={voiceModeLabel(voiceMode)} icon="mic">
          <View style={{ gap: spacing.sm }}>
            {VOICE_MODES.map((m) => (
              <Press key={m.value} onPress={() => { setVoiceMode(m.value); setVoiceModeState(m.value); }} accessibilityRole="button" accessibilityState={{ selected: voiceMode === m.value }} style={styles.voiceOption}>
                <Chip label={m.label} selected={voiceMode === m.value} onPress={() => { setVoiceMode(m.value); setVoiceModeState(m.value); }} />
                <Text style={type.tiny}>{m.blurb}</Text>
              </Press>
            ))}
          </View>
        </FoldLine>
        <FoldLine label="Language" value={voiceLanguageLabel(voiceLanguage === 'auto' ? null : voiceLanguage)} icon="web">
          <Text style={[type.tiny, { marginBottom: spacing.sm }]}>Telling Epic the language makes it quicker and more accurate. Left to detect, it works it out from the first words.</Text>
          <Row style={{ flexWrap: 'wrap', gap: 6 }}>
            {VOICE_LANGUAGES.map((l) => <Chip key={l.value} label={l.label} selected={voiceLanguage === l.value} onPress={() => { setVoiceLanguage(l.value); setVoiceLanguageState(l.value); }} />)}
          </Row>
        </FoldLine>
        <SwitchRow label="Show me the words before planning" hint="After Done, what Epic heard is shown to check and change. Off, it plans straight away." value={voiceConfirm} onChange={(v) => { setVoiceConfirm(v); setVoiceConfirmState(v); }} />
        <SwitchRow label="Speak replies back when I use my voice" hint="Recordings are never kept: they go to the server, are written down, and are forgotten in the same breath." value={speak} onChange={(v) => { setSpeak(v); if (Platform.OS === 'web') localStorage.setItem(SPEAK_KEY, v ? 'on' : 'off'); }} />
      </View>

      {/* Appearance: two cells, and following the phone until the first tap. */}
      <Text style={styles.kicker}>Appearance</Text>
      <Segmented value={themePref === 'system' ? resolveTheme('system') : themePref} options={[{ value: 'light' as const, label: 'Light' }, { value: 'dark' as const, label: 'Dark' }]} onChange={setThemePref} />
      <Text style={type.tiny}>{themePref === 'system' ? 'Epic follows your phone until you choose here.' : 'Set here. Epic no longer follows the phone.'}</Text>

      {/* Account. */}
      <SectionTitle hint="Which build you are looking at, so 'is that change live yet?' has an answer.">This build</SectionTitle>
      <BuildCard />
      <SectionTitle hint="One passcode for the household, and which devices are using it. Anything written without signal waits here until it can be sent.">Account</SectionTitle>
      <AccountCard />
      <SectionTitle hint="What Epic keeps on this phone so it works with no signal, and what it has researched and owns outright.">On this device</SectionTitle>
      <OfflineCard />
      <SectionTitle hint="Everything the household has generated. Place content from licensed sources is never included, only identifiers and what you wrote.">Your data</SectionTitle>
      <Card>
        <Button label="Export everything (JSON)" kind="secondary" onPress={() => { void api.downloadExport(); }} />
        <Text style={[type.small, { marginTop: spacing.sm }]}>Delete everything Epic holds about this household: people, trips, visits, ratings, captured menus. Type the household name to confirm.</Text>
        <Row>
          <TextInput value={confirm} onChangeText={setConfirm} placeholder={household.name} placeholderTextColor={colors.inkFaint} style={[styles.input, { flex: 1 }]} />
          <Button label="Delete household" kind="danger" disabled={confirm !== household.name} onPress={async () => {
            try { await api.deleteHousehold(confirm); setMsg('Deleted. Run the seed to start again.'); await refresh(); } catch (e: any) { setMsg(e.message); }
          }} />
        </Row>
        {msg ? <StatusLine>{msg}</StatusLine> : null}
      </Card>
      {isOwner ? (
        <View style={[styles.rows, { marginTop: spacing.lg }]}>
          <LinkRow label="Providers and usage" value="The owner's table" onPress={() => navigate(paths.settings('providers'))} icon="owned" />
        </View>
      ) : null}
    </>
  );
}

/**
 * Stop hosting (owner, 12 Sep 2026: "reset me so that I get to see those
 * screens again"). Two taps: the host, every offer and every video go, and the
 * Host tab is the invitation again. Refused by the API while anybody holds a
 * place, and the refusal is shown in its own words.
 */
function StopHosting({ onDone }: { onDone: () => void }) {
  const [arm, setArm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  if (!arm) {
    return (
      <Press onPress={() => setArm(true)} accessibilityRole="button" style={styles.linkRow}>
        <Icon name="delete" size={14} color={colors.overrun} />
        <Text style={[type.small, { color: colors.overrun, fontWeight: '700' }]}>Stop hosting</Text>
      </Press>
    );
  }
  return (
    <View style={{ gap: spacing.sm, padding: spacing.md, borderWidth: BORDER, borderColor: colors.overrun }}>
      <Text style={type.body}>Your host profile, every offer and every video go. The Host tab starts you again from the beginning. Anyone holding a place on an offer has to be told first — call those off on the offer's page.</Text>
      {said ? <StatusLine tone="warn">{said}</StatusLine> : null}
      <Row>
        <Button label="Stop hosting" kind="danger" loading={busy} onPress={async () => { setBusy(true); try { await api.stopHosting(); onDone(); } catch (e: any) { setSaid(e.message); } finally { setBusy(false); } }} />
        <Button label="Keep it" kind="ghost" onPress={() => setArm(false)} />
      </Row>
    </View>
  );
}

/** "You · adult", "Adult", "Child · 9". */
function personLine(m: Member, you: boolean): string {
  const role = m.isMinor || (m.age != null && m.age < 18) ? `Child${m.age != null ? ` · ${m.age}` : ''}` : 'Adult';
  return you ? `You · ${role.toLowerCase()}` : role;
}

function LinkRow({ label, value, onPress, icon }: { label: string; value?: string | null; onPress: () => void; icon: any }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" style={styles.linkRow}>
      <Icon name={icon} size={14} color={colors.inkMuted} />
      <Text style={type.tiny}>{label}</Text>
      <Text style={[type.small, { fontWeight: '600', color: colors.ink, flex: 1 }]} numberOfLines={1}>{value ?? ''}</Text>
      <Icon name="more" size={14} color={colors.inkMuted} />
    </Press>
  );
}

function SwitchRow({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 6 }}>
      <View style={{ flex: 1 }}>
        <Text style={type.body}>{label}</Text>
        <Text style={type.tiny}>{hint}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} />
    </Row>
  );
}

// ---------------------------------------------------------------------------
// Providers: one table for what is wired in, what it costs and what it has used.
// ---------------------------------------------------------------------------

function Providers() {
  const [admin, setAdminState] = useState(isAdmin());
  return (
    <>
      <ProvidersTable />
      <SectionTitle hint="For judging each provider's data before paying for it. On this device only; households never see it.">Admin</SectionTitle>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={type.body}>Show where every record came from</Text>
            <Text style={type.tiny}>Adds a Data section to each trip on the web layout, a source filter on the plan's browse lists and shortlist searches, and a "via" line under each result.</Text>
          </View>
          <Switch value={admin} onValueChange={(v) => { setAdmin(v); setAdminState(v); }} />
        </Row>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  voiceOption: { gap: 4, alignItems: 'flex-start' },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: BORDER, borderBottomColor: colors.line, marginBottom: spacing.sm },
  identityTile: { width: 52, height: 52, backgroundColor: colors.selected, alignItems: 'center', justifyContent: 'center' },
  identityInitials: { fontFamily: fonts.heading, fontSize: 18, fontWeight: '800', color: colors.selectedFg },
  identityName: { fontFamily: fonts.body, fontSize: 17, fontWeight: '600', color: colors.ink },
  kicker: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.66, textTransform: 'uppercase', color: colors.inkMuted, marginTop: spacing.lg, marginBottom: 4 },
  groupHead: { justifyContent: 'space-between', alignItems: 'baseline' },
  link: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.accent },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: TARGET },
  addDot: { width: 28, height: 28, borderRadius: 14, borderWidth: BORDER, borderStyle: 'dashed', borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  tellBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surfaceMuted, marginTop: spacing.sm },
  tellTile: { width: 30, height: 30, backgroundColor: colors.selected, alignItems: 'center', justifyContent: 'center' },
  rows: { gap: 2 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 34, paddingHorizontal: 4 },
  page: { padding: spacing.lg, gap: spacing.sm, width: '100%', maxWidth: 760, alignSelf: 'center' },
  input: { minHeight: TARGET, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface, fontSize: 15, color: colors.ink },
});
