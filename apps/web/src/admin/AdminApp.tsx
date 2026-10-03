/**
 * The back office — the second of Epic's two profiles.
 *
 * The owner, 4 Sep 2026: "in the Epic desktop app we need to have 2 profiles:
 * web client, web admin, which has all the admin stuff". So this is a whole
 * application rather than a tab: its own rail, its own screens, and a way back
 * to the household app that says which one you are in.
 *
 * It is drawn only for a session holding the `admin` door, and every nav item is
 * hidden unless the capability behind it is held — but neither of those is the
 * security boundary. The API answers 404 to a session without the door and 403
 * to one without the capability, whatever the app chooses to draw (access.js).
 *
 * The rail is Parcelvision's arrangement: navigation down the side on a wide
 * screen, and on a phone the same list becomes a scrolling row of chips —
 * because a back office on a phone is somebody checking one number on a train,
 * not doing a day's work.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from '../router';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '../components/press';
import { Access, api } from '../api';
import { AdminScreen, filingTabOf } from '../routes';
import { colors, desk, fonts, LIME, ON_LIME, spacing, type } from '../theme';
import { Icon, IconName } from '../components/Icon';
import { Wordmark } from '../components/Wordmark';
import { useViewport } from '../hooks/useViewport';
import { useActivity } from '../hooks/useActivity';
import { useAdminTheme } from '../hooks/useAdminTheme';
import { proposes, whoLine } from './who';
import { Explain, Explains } from './explain';
import { SpendAlarm } from './SpendAlarm';
import { AccountsScreen } from '../screens/AccountsScreen';
import { Overview } from './screens/Overview';
import { ApprovalsScreen } from './Approvals';
import { People } from './screens/People';
import { Activity } from './screens/Activity';
import { Reporting } from './screens/Reporting';
import { Overview as SuiteOverview } from './suite/Overview';
import { Money } from './suite/Money';
import { Subscriptions } from './suite/Subscriptions';
import { Customers } from './suite/Customers';
import { Suppliers } from './suite/Suppliers';
import { Behaviour } from './suite/Behaviour';
import { Audit, Roles } from './screens/Governance';
import { Library } from './screens/Library';
import { Places } from './screens/Places';
import { ReviewQueue } from './screens/ReviewQueue';
import { Runs } from './screens/Runs';
import { Demand } from './screens/Demand';
import { Queue } from './screens/Queue';
import { Coverage } from './screens/Coverage';
import { Lookup } from './screens/Lookup';
import { Scout } from './screens/Scout';
import { HowItWorks } from './screens/HowItWorks';
import { VoiceLab } from './screens/VoiceLab';
import { HostingTab } from './hosting/HostingTab';
import { Messages } from './screens/Messages';
import { Billing } from './screens/Billing';
import { Waitlist } from './screens/Waitlist';
import { Staff } from './screens/Staff';
import { Sources } from './screens/Sources';
import { Categories } from './screens/Categories';
import { Desk as Filing } from './desk/Desk';
import { Skills } from './screens/Skills';

const DESKTOP = 900;

/** The back office's screens are `/admin/<screen>`; the list of them lives in routes.ts. */
type Screen = AdminScreen;
type Group = 'Insight' | 'People' | 'What we offer' | 'Commercial' | 'System';

/**
 * The rail.
 *
 * `needs` is the capability that makes an item worth drawing. The owner holds
 * everything, so he sees all of it; a support account sees four items and does
 * not have to wonder what the other four would have said.
 */
/**
 * `group` puts an item under a heading in the rail. The owner asked for the
 * sources screen "in a new folder on the menu called Data" (12 Sep 2026); the
 * atlas, the shelves and the sweep are where they were until he moves them.
 */
const NAV: { key: Screen; label: string; icon: IconName; needs?: string; sub: string; group?: Group }[] = [
  /**
   * Actions sits alone at the very top, a lime block with its count (design
   * handover §2a). It is the one place for decisions; until its own queue is
   * built it opens the approvals — an agent cannot spend, lift a hold or make
   * a bulk change itself (G11), so it files the request for the owner, signed
   * in personally, to approve-and-run or decline. `view_activity` is the
   * capability behind the approvals read.
   */
  { key: 'actions', label: 'Actions', icon: 'warning', needs: 'view_activity', sub: 'What needs a person' },
  /**
   * The five groups (design handover §2a, 3 Oct 2026; the handover wins over
   * BOSidebar.dc.html, Roger). Items whose screens are not built yet —
   * Reports, Automations — join their group when they are; an item that opens
   * nothing is a dead end. Retired addresses (`/admin/overview`, `/admin/accounts`,
   * `/admin/households`, `/admin/activity`, `/admin/engagement`, the atlas and
   * sweep screens) still resolve, so a kept link never lands on a 404.
   *
   * Capabilities: the rail advertises what opens. Members and Money read
   * `view_financials`/`view_reporting`; Households (`customers`) reads
   * `/api/admin/suite/customers`, gated on accounts, so the support role sees
   * it and it opens (Codex, 20 Sep 2026).
   */
  { key: 'reporting', label: 'Overview', icon: 'plan', needs: 'view_reporting', sub: 'Is the business growing', group: 'Insight' },
  { key: 'money', label: 'Money', icon: 'money', needs: 'view_reporting', sub: 'Where it comes from, and what margin survives', group: 'Insight' },
  { key: 'behaviour', label: 'Behaviour', icon: 'inspire', needs: 'view_reporting', sub: 'What households actually do, and whether they come back', group: 'Insight' },
  { key: 'demand', label: 'Demand', icon: 'list', needs: 'view_reporting', sub: 'What people asked for, and what we failed to give them', group: 'Insight' },

  { key: 'customers', label: 'Households', icon: 'household', needs: 'view_accounts', sub: 'Every household, and the record behind one', group: 'People' },
  // Keyed `subscriptions` so /admin/subscriptions still resolves (Roger, 3 Oct 2026: "Count memberships, not accounts").
  { key: 'subscriptions', label: 'Members', icon: 'wallet', needs: 'view_financials', sub: 'Who is a member, of what, bought where', group: 'People' },
  { key: 'waitlist', label: 'Waitlist', icon: 'list', needs: 'view_waitlist', sub: 'Everyone who registered interest on epic.day, before launch', group: 'People' },

  { key: 'hosting', label: 'Hosting', icon: 'host', needs: 'view_hosting', sub: 'Hosts, events, bookings and the rules they run by', group: 'What we offer' },
  { key: 'places', label: 'Places', icon: 'places', needs: 'view_library', sub: 'What we know, where, and how good it is', group: 'What we offer' },
  /**
   * Categories is the filing desk (back-office handover, 28 Sep 2026): Overview,
   * Categories, Facts, Mapping, Collections, Fact automations, Changes. The
   * older Categories screen's address (`/admin/categories`) still resolves.
   */
  { key: 'filing', label: 'Categories', icon: 'filters', needs: 'view_library', sub: 'Overview, categories, facts, mapping, collections, fact automations and changes', group: 'What we offer' },
  { key: 'skills', label: 'Skills', icon: 'credential', needs: 'view_skills', sub: 'What hosts say they are expert in, the sixteen buckets it is browsed by, and the words Epic has not heard before', group: 'What we offer' },
  { key: 'queue', label: 'Content queue', icon: 'preview', needs: 'view_library', sub: 'What households have sent us, and whether it is fit to publish', group: 'What we offer' },
  // The places and content review queue — not hosting (design handover §2a).
  { key: 'review', label: 'Review queue', icon: 'list', needs: 'view_questions', sub: 'Features Google review-spotting found, to approve into facts or ignore', group: 'What we offer' },

  // Billing holds the money values; Membership is the old plans screen (Roger, 3 Oct 2026).
  { key: 'billing', label: 'Billing', icon: 'money', needs: 'view_accounts', sub: 'What households and hosts pay, and what is owed back', group: 'Commercial' },
  /**
   * Suppliers asks for `view_reporting`, because that is what loads it: it reads
   * the estate model, so a money-only role saw the item and got a 403 (Codex,
   * 20 Sep 2026). The screen's own `canSeeMoney` says what may be read inside.
   */
  { key: 'suppliers', label: 'Suppliers', icon: 'list', needs: 'view_reporting', sub: 'Who we pay, what for, and whether the pipe is plugged in', group: 'Commercial' },

  { key: 'sources', label: 'Sources', icon: 'list', needs: 'view_reporting', sub: 'Every provider, every field, and which of them we read', group: 'System' },
  { key: 'voice', label: 'Voice lab', icon: 'mic', needs: 'manage_settings', sub: 'The ways of hearing, compared on the same sentences', group: 'System' },
  { key: 'runs', label: 'Runs', icon: 'download', needs: 'view_library', sub: 'What is going, what it cost, and what failed', group: 'System' },
  // manage_staff is owner-only, so only the owner sees it.
  { key: 'staff', label: 'Staff', icon: 'accounts', needs: 'manage_staff', sub: 'Who can log in to the back office, and what their role lets them open', group: 'System' },
  { key: 'roles', label: 'Roles', icon: 'locked', needs: 'view_accounts', sub: 'Doors and capabilities', group: 'System' },
  // Mail is its Sent tab (Roger, 3 Oct 2026); `view_activity` is what Mail always read.
  { key: 'messages', label: 'Messages and emails', icon: 'mail', needs: 'view_activity', sub: 'Every message Epic sends, and what became of it', group: 'System' },
  // "Audit" is called Changes (hosting v4 handover §3.8); the address stays /admin/audit so every kept link lands.
  { key: 'audit', label: 'Changes', icon: 'info', needs: 'view_audit', sub: 'Who did what to whom', group: 'System' },
  // No capability: the decisions behind what Epic does are not a privilege.
  { key: 'how', label: 'How it works', icon: 'owned', sub: 'The decisions, what they cost, and where each rule lives', group: 'System' },
];

/**
 * The first back-office screen a session may actually open, from the same NAV
 * the rail filters by. A magic link lands staff in the back office, but a Support
 * role has the admin door without `view_reporting`, so sending everyone to the
 * Overview would greet them with a screen whose first request is a 403. This
 * answers "where does this person's back office begin"; `how` has no capability,
 * so there is always an answer.
 */
export function firstAdminScreen(access?: { capabilities?: string[] | null } | null): Screen {
  const held = new Set(access?.capabilities ?? []);
  // Actions is top of the rail but is never where the back office *begins* —
  // it is an alert, not a landing. Begin on the first real destination (the
  // reporting Overview for most), exactly as before Approvals joined the rail.
  const item = NAV.find((n) => n.key !== 'actions' && (!n.needs || held.has(n.needs)));
  return item?.key ?? 'how';
}

/**
 * Light or dark, for the back office alone.
 *
 * Two words rather than a switch, because a switch has to say what it is a
 * switch *for* and these say it themselves. The household app keeps its own
 * setting either way.
 */
function Lights() {
  const { pref, setPref } = useAdminTheme();
  const now = pref === 'follow' ? 'dark' : pref;
  return (
    <View style={styles.lights}>
      {(['dark', 'light'] as const).map((k) => (
        <Press key={k} effect="none" onPress={() => setPref(k)} accessibilityRole="button"
               accessibilityState={{ selected: now === k }} accessibilityLabel={`${k} back office`}
               style={[styles.light, now === k && styles.lightOn]}>
          <Text style={[styles.lightText, now === k && styles.lightTextOn]}>{k === 'dark' ? 'Dark' : 'Light'}</Text>
        </Press>
      ))}
    </View>
  );
}

/** Which written explanation each rail group carries. */
// The rail's two headings. The first group has none, here and on the design's
// own sidebar, so there is no third entry — one was carried for a group nothing
// belongs to, which is a tooltip that could never be shown (18 Sep 2026, the
// separate audit).
const GROUP_TIP: Record<Group, 'railInsight' | 'railPeople' | 'railOffer' | 'railCommercial' | 'railSystem'> = {
  Insight: 'railInsight', People: 'railPeople', 'What we offer': 'railOffer', Commercial: 'railCommercial', System: 'railSystem',
};

export function AdminApp({ access, screen, onScreen, onLeave }: {
  access: Access | null;
  /** Which screen the address asks for — `/admin/reporting` and so on. */
  screen: Screen;
  onScreen: (screen: Screen) => void;
  onLeave: () => void;
}) {
  const { width } = useViewport();
  const desktop = width >= DESKTOP;
  const setScreen = onScreen;

  const held = useMemo(() => new Set(access?.capabilities ?? []), [access]);
  const items = NAV.filter((n) => !n.needs || held.has(n.needs));
  const can = (c: string) => held.has(c);

  // How many approvals are waiting, for the rail's "Actions (n)". Read
  // once on mount and again whenever the screen changes (so declining one and
  // stepping away refreshes it); the Approvals screen also reports its own
  // count through `onCount` so a decision made there updates the badge at once.
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (!held.has('view_activity')) return;
    let live = true;
    api.approvals('review').then((r) => { if (live) setPending(r.approvals.length); }).catch(() => {});
    return () => { live = false; };
  }, [held, screen]);

  // The back office reports its own use like every other screen: an
  // administrator's time is activity too, and leaving it out would make the
  // estate's own numbers quietly wrong.
  useActivity(`admin.${screen}`);

  /**
   * The lit item follows the screen (handover §7). On the desk that is
   * Categories only while a Categories page is open; Facts, Mapping,
   * Collections, Fact automations, Changes and the desk's own Overview and
   * Runs live under the desk's tabs and light nothing here (design README v2).
   */
  const { query } = useRouter();
  const deskTab = filingTabOf(query.get('tab')) ?? 'overview';
  const home: Partial<Record<Screen, Screen>> = { approvals: 'actions', plans: 'billing', mail: 'messages' };
  const at = home[screen] ?? screen;
  const lit = (key: string) => key === at && !(at === 'filing' && deskTab !== 'categories');

  const body = (
    <>
      {/* Actions opens the approvals until its own queue is built; the old
          address still draws them, though `legacyHref` sends it here first. */}
      {screen === 'actions' || screen === 'approvals' ? <ApprovalsScreen onCount={setPending} title="Actions" /> : null}
      {screen === 'billing' || screen === 'plans' ? <Billing canManage={can('manage_plans')} /> : null}
      {screen === 'messages' || screen === 'mail' ? <Messages canSend={can('manage_settings')} /> : null}
      {screen === 'overview' ? <Overview /> : null}
      {screen === 'accounts' ? <AccountsScreen /> : null}
      {screen === 'households' ? <People canManageRoles={can('manage_roles')} /> : null}
      {screen === 'activity' ? <Activity /> : null}
      {/* The suite. `reporting` is its Overview; the screen that used to be at
          that address is at `engagement` and still answers there. */}
      {screen === 'reporting' ? <SuiteOverview /> : null}
      {screen === 'money' ? <Money canSeeMoney={can('view_financials')} /> : null}
      {screen === 'subscriptions'
        ? <Subscriptions canSeeMoney={can('view_financials')} canManage={can('manage_plans')} /> : null}
      {screen === 'customers' ? <Customers canSeeMoney={can('view_financials')} canManage={can('manage_accounts')} /> : null}
      {screen === 'suppliers'
        ? <Suppliers canSeeMoney={can('view_financials')} canManage={can('manage_settings')} /> : null}
      {screen === 'behaviour' ? <Behaviour /> : null}
      {screen === 'engagement' ? <Reporting canSeeMoney={can('view_financials')} /> : null}
      {screen === 'lookup' ? <Lookup canManage={can('manage_library')} /> : null}
      {screen === 'coverage' ? <Coverage /> : null}
      {screen === 'filing' ? <Filing canManage={can('manage_library')} /> : null}
      {screen === 'places' ? <Places canManage={can('manage_library')} canSettings={can('manage_settings')} /> : null}
      {screen === 'review' ? <ReviewQueue canManage={can('manage_questions')} /> : null}
      {/* Two capabilities, because two different things: starting a run is the
          library's, and setting the month's ceiling is the settings'. One flag
          gave a library manager an enabled box that always answered 403, and
          gave a settings manager no box at all (Codex, 17 Sep 2026). */}
      {screen === 'runs' ? <Runs canManage={can('manage_library')} canSetCeiling={can('manage_settings')} /> : null}
      {screen === 'demand' ? <Demand canManage={can('manage_library')} /> : null}
      {screen === 'queue' ? <Queue canManage={can('manage_library')} /> : null}
      {screen === 'library' ? <Library canManage={can('manage_library')} canSettings={can('manage_settings')} /> : null}
      {screen === 'scout' ? <Scout canManage={can('manage_library')} /> : null}
      {screen === 'sources' ? <Sources /> : null}
      {/* Shelves stopped being its own rail item when the two were merged
          (owner, 13 Sep 2026); every link anybody has kept still lands. */}
      {screen === 'categories' || screen === 'shelves'
        ? <Categories canManage={can('manage_library')} startAt={screen === 'shelves' ? 'shelves' : undefined} /> : null}
      {screen === 'voice' ? <VoiceLab /> : null}
      {screen === 'hosting' ? <HostingTab canManage={can('manage_hosting')} /> : null}
      {screen === 'skills' ? <Skills canManage={can('manage_skills')} /> : null}
      {screen === 'staff' ? <Staff canManage={can('manage_staff')} /> : null}
      {screen === 'waitlist' ? <Waitlist canManage={can('manage_waitlist')} /> : null}
      {screen === 'roles' ? <Roles canManage={can('manage_roles')} /> : null}
      {screen === 'audit' ? <Audit /> : null}
      {screen === 'how' ? <HowItWorks /> : null}
    </>
  );

  return (
    // A row on a wide screen (rail beside the page), a column on a phone (a
    // strip of chips above it). One tree either way, so switching the shell's
    // Web/Mobile toggle keeps the screen you were on (CLAUDE.md).
    //
    // `Explains` wraps the whole shell, not only the page. It used to wrap the
    // page alone, so the rail's own headings had handlers and nowhere to draw
    // — three headers that gave no tooltip however they were wired (17 Sep
    // 2026, the verification audit).
    <Explains>
    <View style={[styles.root, !desktop && styles.rootPhone]}>
      {desktop ? (
        // The rail scrolls in its own box: taller than a 900px window, it made
        // the window scroll as well as the desk — two scrollers and a blank
        // band under the page (second audit CH.10).
        <ScrollView style={styles.railBox} contentContainerStyle={styles.rail}>
          <View style={styles.brand}>
            <Wordmark height={30} ground={colors.bg} />
            <Explain tip="railBackOffice" cursor="help"><Text style={styles.badge}>Back office</Text></Explain>
          </View>

          {items.map((n, i) => {
            // Actions is a lime block whatever is open, with its count when
            // something waits (design handover §2a); it is an alert as well as a place.
            if (n.key === 'actions') {
              return (
                <Press key={n.key} onPress={() => setScreen(n.key)} style={styles.actions}
                       accessibilityRole="tab" accessibilityState={{ selected: lit(n.key) }}>
                  <Icon name={n.icon} size={14} strokeWidth={2.2} color={ON_LIME} />
                  <Text style={styles.actionsLabel}>{pending > 0 ? `${n.label} (${pending})` : n.label}</Text>
                </Press>
              );
            }
            const on = lit(n.key);
            return (
            <React.Fragment key={n.key}>
              {/* A group heading is a header, and the owner asked for a tooltip
                  on any of them (17 Sep 2026). */}
              {n.group && items[i - 1]?.group !== n.group ? (
                <Explain tip={GROUP_TIP[n.group] ?? null} cursor="help">
                  <Text style={styles.navGroup}>{n.group}</Text>
                </Explain>
              ) : null}
              <Press
                onPress={() => setScreen(n.key)}
                style={[styles.navItem, on && styles.navItemOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Icon name={n.icon} size={14} strokeWidth={2} color={on ? desk.ink : desk.inkDim} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.navLabel, on && styles.navLabelOn]}>{n.label}</Text>
                </View>
              </Press>
            </React.Fragment>
            );
          })}

          <View style={{ flex: 1 }} />

          {/* Which profile you are in, and the way back. Never a silent switch:
              the two applications hold the same account and different powers. */}
          <View style={styles.profile}>
            <Text style={styles.signedIn}>Signed in as</Text>
            {/* "Signed in as Roger · Owner" for a personal sign-in, "Shared passcode · Owner" for the shared one
                (design handover §2a); a session that cannot act directly says its changes go to Approvals. */}
            <Text style={styles.who}>{whoLine(access)}</Text>
            {proposes(access) ? <Text style={styles.signedIn}>Changes go to Approvals until you sign in personally</Text> : null}
            <View style={{ marginTop: 10 }}><Lights /></View>
            <Press onPress={onLeave} style={styles.leave} accessibilityRole="button">
              <Icon name="back" size={13} color={desk.inkDim} />
              <Text style={styles.leaveText}>The household app</Text>
            </Press>
          </View>
        </ScrollView>
      ) : (
        <View style={styles.phoneHead}>
          <View style={styles.phoneHeadTop}>
            <Explain tip="railBackOffice" cursor="help"><Text style={styles.badge}>Back office</Text></Explain>
            <View style={{ flex: 1 }} />
            <Lights />
            <Press onPress={onLeave} accessibilityRole="button" style={styles.leaveSmall}>
              <Icon name="back" size={13} color={colors.ink} />
              <Text style={type.tiny}>The app</Text>
            </Press>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {items.map((n) => {
              const hot = n.key === 'actions';
              const on = lit(n.key) || hot;
              return (
              <Press
                key={n.key}
                onPress={() => setScreen(n.key)}
                style={[styles.chip, on && styles.chipOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: lit(n.key) }}
              >
                <Icon name={n.icon} size={13} color={on ? colors.selectedFg : colors.ink} />
                <Text style={[type.tiny, { color: on ? colors.selectedFg : colors.ink }, on && { fontWeight: '700' }]}>{hot && pending > 0 ? `${n.label} (${pending})` : n.label}</Text>
              </Press>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* One tooltip panel for the whole back office, positioned in the page's
          own coordinate space so it lands where it should inside the shell's
          phone frame as well (explain.tsx). */}
      <View style={styles.content}><SpendAlarm />{body}</View>
    </View>
    </Explains>
  );
}

const styles = StyleSheet.create({
  // Held to the window: the rail and the page each scroll in their own box.
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg, minHeight: 0 },
  content: { flex: 1 },

  // The design's rail (prototype, 3 Oct 2026): 206px on the raised ground with
  // a 1px rule, items 13.5px with a 3px edge that turns lime on the open one.
  railBox: { width: 206, flexGrow: 0, flexShrink: 0, backgroundColor: desk.raised, borderRightWidth: 1, borderRightColor: desk.rule },
  rail: { flexGrow: 1, paddingTop: 22, paddingBottom: 26, gap: 2 },
  brand: { gap: 3, marginBottom: 20, paddingHorizontal: 18 },
  badge: {
    ...type.tiny, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1.3, fontWeight: '700',
    color: colors.inkMuted,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 9, marginHorizontal: 12, marginBottom: 6, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: LIME },
  actionsLabel: { fontFamily: fonts.body, fontSize: 13, fontWeight: '800', color: ON_LIME },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, paddingHorizontal: 18, borderLeftWidth: 3, borderLeftColor: 'transparent' },
  navItemOn: { backgroundColor: desk.hover, borderLeftColor: LIME },
  /** A group: a small heading over the items it holds. */
  navGroup: { fontFamily: fonts.heading, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, fontWeight: '800', color: desk.inkFaint, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 6 },
  navLabel: { fontFamily: fonts.body, fontSize: 13.5, color: desk.inkDim },
  navLabelOn: { color: desk.ink, fontWeight: '700' },

  profile: { gap: 3, paddingTop: 18, marginTop: spacing.lg, borderTopWidth: 1, borderTopColor: desk.rule, paddingHorizontal: 18 },
  signedIn: { fontFamily: fonts.body, fontSize: 11.5, color: desk.inkDim },
  who: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: desk.ink },
  lights: { flexDirection: 'row', alignSelf: 'flex-start', gap: 3, padding: 2, borderWidth: 1, borderColor: desk.ruleStrong },
  light: { paddingHorizontal: 10, paddingVertical: 5 },
  lightOn: { backgroundColor: LIME },
  lightText: { fontFamily: fonts.body, fontSize: 12, fontWeight: '600', color: desk.inkDim },
  lightTextOn: { fontWeight: '800', color: ON_LIME },
  leave: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 13 },
  leaveText: { fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim },

  rootPhone: { flexDirection: 'column' },
  phoneHead: {
    borderBottomWidth: 1, borderBottomColor: colors.lineSoft,
    paddingTop: Platform.OS === 'web' ? spacing.sm : spacing.lg, gap: 6,
  },
  phoneHeadTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md },
  leaveSmall: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chips: { gap: 6, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5 },
  chipOn: { backgroundColor: colors.selected },
});
