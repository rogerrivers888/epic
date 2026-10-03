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
import { colors, spacing, type } from '../theme';
import { Icon, IconName } from '../components/Icon';
import { Wordmark } from '../components/Wordmark';
import { useViewport } from '../hooks/useViewport';
import { useActivity } from '../hooks/useActivity';
import { useAdminTheme } from '../hooks/useAdminTheme';
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
import { Audit, Plans, Roles } from './screens/Governance';
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
import { Mail } from './screens/Mail';
import { Waitlist } from './screens/Waitlist';
import { Staff } from './screens/Staff';
import { Sources } from './screens/Sources';
import { Categories } from './screens/Categories';
import { Desk as Filing } from './desk/Desk';
import { Skills } from './screens/Skills';

const DESKTOP = 900;

/** The back office's screens are `/admin/<screen>`; the list of them lives in routes.ts. */
type Screen = AdminScreen;

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
const NAV: { key: Screen; label: string; icon: IconName; needs?: string; sub: string; group?: string }[] = [
  /**
   * Approvals sits alone at the very top, above the Reporting folder, with no
   * group heading of its own. It is the one rail item that is not a report but
   * a thing waiting on the owner: an agent cannot spend, lift a hold or make a
   * bulk change itself (G11), so it files the request here for the owner,
   * signed in personally, to approve-and-run or decline. The rail draws it in
   * lime with a count when any are waiting, so it cannot be missed (owner,
   * 1 Oct 2026). `view_activity` is the capability behind the queue's read.
   */
  { key: 'approvals', label: 'Approvals', icon: 'locked', needs: 'view_activity', sub: 'What an agent has asked you to authorise' },
  /**
   * The four that used to be at the top of this rail — Overview, Accounts,
   * Households, Activity — are gone from it (owner, 20 Sep 2026: "The whole
   * top 4 tabs can be removed completely").
   *
   * Each one was answering a question the suite below now answers better, and
   * the two things only they could do came with them: Households' summary of
   * the estate and Accounts' invite are both on **Customers**. Activity's feed
   * and the old estate overview had no such remainder.
   *
   * Their addresses still resolve — `/admin/overview`, `/admin/accounts`,
   * `/admin/households`, `/admin/activity` — because that is this repo's rule
   * for a screen that leaves the rail, and because a link somebody kept should
   * land somewhere rather than on a 404 (routes.ts). They are simply not a way
   * in any more.
   */
  /**
   * Reporting. Six sections over one estate model (handoff "Reporting &
   * overview", 20 Sep 2026), answering five questions: is the business growing,
   * where does the money come from and what margin survives, what are we
   * selling and at what price, who are the customers, and what do households
   * actually do in the product.
   *
   * Two of them are editing screens rather than reports — Subscriptions sets
   * prices and published benefits, and a supplier's record corrects a rate —
   * so they need their own capabilities rather than `view_reporting`.
   *
   * The old engagement/revenue/usage screen moved to `/admin/engagement`. It is
   * still resolvable and no longer in the rail: `/admin/reporting`, which is
   * the address every handover link already uses, now lands on the Overview
   * below, which is the same question asked better.
   */
  { key: 'reporting', label: 'Overview', icon: 'plan', needs: 'view_reporting', sub: 'Is the business growing', group: 'Reporting' },
  { key: 'money', label: 'Money', icon: 'money', needs: 'view_reporting', sub: 'Where it comes from, and what margin survives', group: 'Reporting' },
  { key: 'subscriptions', label: 'Subscriptions', icon: 'wallet', needs: 'view_financials', sub: 'What we sell, at what price, and what it says you get', group: 'Reporting' },
  /**
   * Customers is `view_accounts` and stays that way: it reads
   * `/api/admin/suite/customers`, which is gated on accounts rather than on
   * reporting, so the support role sees the item and it opens. What they pay is
   * withheld server-side without `view_financials` (Codex, 20 Sep 2026 — it
   * used to read the whole reporting model and answer 403).
   */
  { key: 'customers', label: 'Customers', icon: 'household', needs: 'view_accounts', sub: 'Every household, and the record behind one', group: 'Reporting' },
  // Under the households (Website & Registration › WL1): everyone who
  // registered interest on epic.day before launch.
  { key: 'waitlist', label: 'Waitlist', icon: 'list', needs: 'view_waitlist', sub: 'Everyone who registered interest on epic.day, before launch', group: 'Reporting' },
  /**
   * Suppliers asks for `view_reporting`, because that is what loads it.
   *
   * It is money end to end, so moving the gate to `view_financials` looked
   * right — and it reads the estate model, which is `view_reporting`, so a role
   * holding only the money capability saw the item and got a 403 (Codex, 20 Sep
   * 2026, having just watched me fix the same fault on Customers the other way
   * round). The rail advertises what opens; the screen's own `canSeeMoney`
   * says what may be read inside it, which is how Money already works.
   */
  { key: 'suppliers', label: 'Suppliers', icon: 'list', needs: 'view_reporting', sub: 'Who we pay, what for, and whether the pipe is plugged in', group: 'Reporting' },
  { key: 'behaviour', label: 'Behaviour', icon: 'inspire', needs: 'view_reporting', sub: 'What households actually do, and whether they come back', group: 'Reporting' },
  /**
   * Data. Five screens that were each bound to a different table became three
   * bound to three questions (17 Sep 2026): Places is what we know and where,
   * Demand is what people asked for and what we failed to give them, and the
   * content queue is what households sent us. Runs is the monitor for the long
   * jobs — starting one happens on Places, where the gap is.
   *
   * Atlas, the sweep, Coverage and Lookup dissolved into Places. Their addresses
   * still resolve so nothing anybody kept lands on a 404; they are simply not in
   * this rail any more.
   */
  { key: 'places', label: 'Places', icon: 'places', needs: 'view_library', sub: 'What we know, where, and how good it is', group: 'Data' },
  { key: 'demand', label: 'Demand', icon: 'list', needs: 'view_reporting', sub: 'What people asked for, and what we failed to give them', group: 'Data' },
  { key: 'sources', label: 'Sources', icon: 'list', needs: 'view_reporting', sub: 'Every provider, every field, and which of them we read', group: 'Data' },
  /**
   * Categories is the filing desk (back-office handover, 28 Sep 2026): the
   * design's rail has one Categories item, and it opens the seven tabs —
   * Overview, Categories, Facts, Mapping, Collections, Fact automations,
   * Changes. The older Categories screen is no longer in the rail; its address
   * (`/admin/categories`) still resolves, so nothing anybody kept is a 404.
   */
  { key: 'filing', label: 'Categories', icon: 'filters', needs: 'view_library', sub: 'Overview, categories, facts, mapping, collections, fact automations and changes', group: 'Data' },
  { key: 'voice', label: 'Voice lab', icon: 'mic', needs: 'manage_settings', sub: 'The ways of hearing, compared on the same sentences', group: 'Data' },
  { key: 'hosting', label: 'Hosting', icon: 'host', needs: 'view_hosting', sub: 'Review · Hosts · Events · Money · Safety · Settings · Reports · Changes', group: 'Data' },
  { key: 'skills', label: 'Skills', icon: 'credential', needs: 'view_skills', sub: 'What hosts say they are expert in, the sixteen buckets it is browsed by, and the words Epic has not heard before', group: 'Data' },
  { key: 'queue', label: 'Content queue', icon: 'preview', needs: 'view_library', sub: 'What households have sent us, and whether it is fit to publish', group: 'Data' },
  { key: 'review', label: 'Review queue', icon: 'list', needs: 'view_questions', sub: 'Features Google review-spotting found, to approve into facts or ignore', group: 'Data' },
  { key: 'runs', label: 'Runs', icon: 'download', needs: 'view_library', sub: 'What is going, what it cost, and what failed', group: 'Data' },
  // First in the Admin group, above Roles (Supporting docs › EPIC staff
  // management). manage_staff is owner-only, so only the owner sees it.
  { key: 'staff', label: 'Staff', icon: 'accounts', needs: 'manage_staff', sub: 'Who can log in to the back office, and what their role lets them open', group: 'Admin' },
  { key: 'roles', label: 'Roles', icon: 'locked', needs: 'view_accounts', sub: 'Doors and capabilities', group: 'Admin' },
  { key: 'mail', label: 'Mail', icon: 'mail', needs: 'view_activity', sub: 'Every e-mail sent, and whether it was delivered, opened or bounced', group: 'Admin' },
  { key: 'plans', label: 'Memberships', icon: 'money', needs: 'view_accounts', sub: 'What a household can be on', group: 'Admin' },
  // "Audit" is called Changes (hosting v4 handover §3.8); the address stays /admin/audit so every kept link lands.
  { key: 'audit', label: 'Changes', icon: 'info', needs: 'view_audit', sub: 'Who did what to whom', group: 'Admin' },
  // No capability: the decisions behind what Epic does are not a privilege, and
  // an account that can see any of this should be able to see why.
  { key: 'how', label: 'How it works', icon: 'owned', sub: 'The decisions, what they cost, and where each rule lives', group: 'Admin' },
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
  // Approvals is top of the rail but is never where the back office *begins* —
  // it is an alert, not a landing. Begin on the first real destination (the
  // reporting Overview for most), exactly as before Approvals joined the rail.
  const item = NAV.find((n) => n.key !== 'approvals' && (!n.needs || held.has(n.needs)));
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
          <Text style={[type.tiny, { fontWeight: '700', color: now === k ? colors.selectedFg : colors.inkMuted }]}>
            {k === 'dark' ? 'Dark' : 'Light'}
          </Text>
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
const GROUP_TIP: Record<string, 'railData' | 'railAdmin' | 'railReporting'> = {
  Reporting: 'railReporting', Data: 'railData', Admin: 'railAdmin',
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

  // How many approvals are waiting, for the rail's "Approvals (n)" badge. Read
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

  const current = items.find((n) => n.key === screen) ?? items[0];
  /**
   * The lit item follows the screen (handover §7). On the desk that is
   * Categories only while a Categories page is open; Facts, Mapping,
   * Collections, Fact automations, Changes and the desk's own Overview and
   * Runs live under the desk's tabs and light nothing here (design README v2).
   */
  const { query } = useRouter();
  const deskTab = filingTabOf(query.get('tab')) ?? 'overview';
  const lit = (key: string) => key === screen && !(screen === 'filing' && deskTab !== 'categories');

  const body = (
    <>
      {screen === 'approvals' ? <ApprovalsScreen onCount={setPending} /> : null}
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
      {screen === 'mail' ? <Mail canSend={can('manage_settings')} /> : null}
      {screen === 'waitlist' ? <Waitlist canManage={can('manage_waitlist')} /> : null}
      {screen === 'roles' ? <Roles canManage={can('manage_roles')} /> : null}
      {screen === 'plans' ? <Plans canManage={can('manage_plans')} /> : null}
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
            // Approvals lights lime whenever something waits, even when it is not
            // the open screen — the one item that is an alert, not a destination.
            const hot = n.key === 'approvals' && pending > 0;
            const on = lit(n.key) || hot;
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
                style={[styles.navItem, on && styles.navItemOn, n.group ? styles.navItemGrouped : null]}
                accessibilityRole="tab"
                accessibilityState={{ selected: lit(n.key) }}
              >
                <Icon name={n.icon} size={15} strokeWidth={1.8} color={on ? colors.selectedFg : colors.ink} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.navLabel, on && { color: colors.selectedFg, fontWeight: '700' }]}>
                    {hot ? `${n.label} (${pending})` : n.label}
                  </Text>
                </View>
              </Press>
            </React.Fragment>
            );
          })}

          <View style={{ flex: 1 }} />

          {/* Which profile you are in, and the way back. Never a silent switch:
              the two applications hold the same account and different powers. */}
          <View style={styles.profile}>
            <Text style={type.tiny}>Signed in as</Text>
            {/* The person and their role, never a role alone; and a session that cannot act directly says so, since
                its changes go to Approvals (Roger, 3 Oct 2026). */}
            <Text style={[type.small, { color: colors.ink, fontWeight: '700' }]}>
              {[access?.name?.trim().split(/\s+/)[0] || (access?.role?.key === 'owner' ? 'Shared passcode' : null), access?.role?.label].filter(Boolean).join(' · ') || '—'}
            </Text>
            {access?.role?.key === 'owner' && !access?.elevated ? <Text style={type.tiny}>Changes go to Approvals until you sign in personally</Text> : null}
            <Press onPress={onLeave} style={styles.leave} accessibilityRole="button">
              <Icon name="back" size={14} color={colors.ink} />
              <Text style={[type.small, { color: colors.ink }]}>The household app</Text>
            </Press>
            <Lights />
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
              const hot = n.key === 'approvals' && pending > 0;
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
                <Text style={[type.tiny, { color: on ? colors.selectedFg : colors.ink }, on && { fontWeight: '700' }]}>{hot ? `${n.label} (${pending})` : n.label}</Text>
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

  // 196px and a hairline edge — the handoff's own measurements ("Category
  // screens v2", 14 Sep 2026). The rail stands on the same ground as the page:
  // a second surface colour behind it would be the panel the handoff forbids,
  // and the one rule is enough to say where the page starts.
  railBox: { width: 196, flexGrow: 0, flexShrink: 0, borderRightWidth: 1, borderRightColor: colors.lineSoft },
  rail: { flexGrow: 1, paddingVertical: 20, paddingHorizontal: spacing.sm, gap: 1 },
  brand: { gap: 3, marginBottom: 20, paddingHorizontal: spacing.xs },
  badge: {
    ...type.tiny, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1.3, fontWeight: '700',
    color: colors.inkMuted,
  },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 7, paddingHorizontal: spacing.md },
  /** The live row is a flat lime block with ink type — the brand moment, square. */
  navItemOn: { backgroundColor: colors.selected },
  /** A folder in the rail: a small heading over the items it holds. */
  navGroup: { ...type.tiny, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.2, fontWeight: '700', color: colors.inkMuted, paddingHorizontal: spacing.md, paddingTop: 18, paddingBottom: 7 },
  navItemGrouped: {},
  navLabel: { ...type.small, fontSize: 13.5, color: colors.ink },

  profile: { gap: 1, paddingTop: spacing.lg, marginTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingHorizontal: spacing.xs },
  lights: { flexDirection: 'row', alignSelf: 'flex-start', marginTop: spacing.sm },
  light: { paddingHorizontal: 9, paddingVertical: 4 },
  lightOn: { backgroundColor: colors.selected },
  leave: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 13 },

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
