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

import React, { useMemo } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '../components/press';
import { Access } from '../api';
import { AdminScreen } from '../routes';
import { colors, spacing, type } from '../theme';
import { Icon, IconName } from '../components/Icon';
import { Wordmark } from '../components/Wordmark';
import { useViewport } from '../hooks/useViewport';
import { useActivity } from '../hooks/useActivity';
import { useAdminTheme } from '../hooks/useAdminTheme';
import { Explain, Explains } from './explain';
import { AccountsScreen } from '../screens/AccountsScreen';
import { Overview } from './screens/Overview';
import { People } from './screens/People';
import { Activity } from './screens/Activity';
import { Reporting } from './screens/Reporting';
import { Audit, Plans, Roles } from './screens/Governance';
import { Library } from './screens/Library';
import { Places } from './screens/Places';
import { Runs } from './screens/Runs';
import { Demand } from './screens/Demand';
import { Queue } from './screens/Queue';
import { Coverage } from './screens/Coverage';
import { Lookup } from './screens/Lookup';
import { Scout } from './screens/Scout';
import { HowItWorks } from './screens/HowItWorks';
import { VoiceLab } from './screens/VoiceLab';
import { Hosting } from './screens/Hosting';
import { Mail } from './screens/Mail';
import { Sources } from './screens/Sources';
import { Categories } from './screens/Categories';
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
  { key: 'overview', label: 'Overview', icon: 'plan', sub: 'The estate at a glance' },
  { key: 'accounts', label: 'Accounts', icon: 'accounts', needs: 'view_accounts', sub: 'Invite people and manage their plan' },
  { key: 'households', label: 'Households', icon: 'household', needs: 'view_accounts', sub: 'What each one does, and what it costs' },
  { key: 'activity', label: 'Activity', icon: 'list', needs: 'view_activity', sub: 'Everything that has happened' },
  { key: 'reporting', label: 'Reporting', icon: 'places', needs: 'view_reporting', sub: 'Engagement, revenue and usage' },
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
  { key: 'categories', label: 'Categories', icon: 'filters', needs: 'view_library', sub: 'Categories and subcategories, every provider\'s words, and the rules that map one onto the other', group: 'Data' },
  { key: 'voice', label: 'Voice lab', icon: 'mic', needs: 'manage_settings', sub: 'The ways of hearing, compared on the same sentences', group: 'Data' },
  { key: 'hosting', label: 'Hosting', icon: 'host', needs: 'view_hosting', sub: 'First pitches to read within 48 hours, the trust ladder, and reports', group: 'Data' },
  { key: 'skills', label: 'Skills', icon: 'credential', needs: 'view_skills', sub: 'What hosts say they are expert in, the sixteen buckets it is browsed by, and the words Epic has not heard before', group: 'Data' },
  { key: 'queue', label: 'Content queue', icon: 'preview', needs: 'view_library', sub: 'What households have sent us, and whether it is fit to publish', group: 'Data' },
  { key: 'runs', label: 'Runs', icon: 'download', needs: 'view_library', sub: 'What is going, what it cost, and what failed', group: 'Data' },
  { key: 'mail', label: 'Mail', icon: 'mail', needs: 'view_activity', sub: 'Every e-mail sent, and whether it was delivered, opened or bounced', group: 'Admin' },
  { key: 'roles', label: 'Roles', icon: 'locked', needs: 'view_accounts', sub: 'Doors and capabilities', group: 'Admin' },
  { key: 'plans', label: 'Plans', icon: 'money', needs: 'view_accounts', sub: 'What a household can be on', group: 'Admin' },
  { key: 'audit', label: 'Audit', icon: 'info', needs: 'view_audit', sub: 'Who did what to whom', group: 'Admin' },
  // No capability: the decisions behind what Epic does are not a privilege, and
  // an account that can see any of this should be able to see why.
  { key: 'how', label: 'How it works', icon: 'owned', sub: 'The decisions, what they cost, and where each rule lives', group: 'Admin' },
];

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
const GROUP_TIP: Record<string, 'railData' | 'railAdmin' | 'railMain'> = {
  Data: 'railData', Admin: 'railAdmin', Main: 'railMain',
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

  // The back office reports its own use like every other screen: an
  // administrator's time is activity too, and leaving it out would make the
  // estate's own numbers quietly wrong.
  useActivity(`admin.${screen}`);

  const current = items.find((n) => n.key === screen) ?? items[0];

  const body = (
    <>
      {screen === 'overview' ? <Overview /> : null}
      {screen === 'accounts' ? <AccountsScreen /> : null}
      {screen === 'households' ? <People canManageRoles={can('manage_roles')} /> : null}
      {screen === 'activity' ? <Activity /> : null}
      {screen === 'reporting' ? <Reporting canSeeMoney={can('view_financials')} /> : null}
      {screen === 'lookup' ? <Lookup canManage={can('manage_library')} /> : null}
      {screen === 'coverage' ? <Coverage /> : null}
      {screen === 'places' ? <Places canManage={can('manage_library')} /> : null}
      {/* Two capabilities, because two different things: starting a run is the
          library's, and setting the month's ceiling is the settings'. One flag
          gave a library manager an enabled box that always answered 403, and
          gave a settings manager no box at all (Codex, 17 Sep 2026). */}
      {screen === 'runs' ? <Runs canManage={can('manage_library')} canSetCeiling={can('manage_settings')} /> : null}
      {screen === 'demand' ? <Demand canManage={can('manage_library')} /> : null}
      {screen === 'queue' ? <Queue canManage={can('manage_library')} /> : null}
      {screen === 'library' ? <Library canManage={can('manage_library')} /> : null}
      {screen === 'scout' ? <Scout canManage={can('manage_library')} /> : null}
      {screen === 'sources' ? <Sources /> : null}
      {/* Shelves stopped being its own rail item when the two were merged
          (owner, 13 Sep 2026); every link anybody has kept still lands. */}
      {screen === 'categories' || screen === 'shelves'
        ? <Categories canManage={can('manage_library')} startAt={screen === 'shelves' ? 'shelves' : undefined} /> : null}
      {screen === 'voice' ? <VoiceLab /> : null}
      {screen === 'hosting' ? <Hosting canManage={can('manage_hosting')} /> : null}
      {screen === 'skills' ? <Skills canManage={can('manage_skills')} /> : null}
      {screen === 'mail' ? <Mail /> : null}
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
        <View style={styles.rail}>
          <View style={styles.brand}>
            <Wordmark height={30} ground={colors.bg} />
            <Explain tip="railBackOffice" cursor="help"><Text style={styles.badge}>Back office</Text></Explain>
          </View>

          {items.map((n, i) => (
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
                style={[styles.navItem, screen === n.key && styles.navItemOn, n.group ? styles.navItemGrouped : null]}
                accessibilityRole="tab"
                accessibilityState={{ selected: screen === n.key }}
              >
                <Icon name={n.icon} size={15} strokeWidth={1.8} color={screen === n.key ? colors.selectedFg : colors.ink} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.navLabel, screen === n.key && { color: colors.selectedFg, fontWeight: '700' }]}>{n.label}</Text>
                </View>
              </Press>
            </React.Fragment>
          ))}

          <View style={{ flex: 1 }} />

          {/* Which profile you are in, and the way back. Never a silent switch:
              the two applications hold the same account and different powers. */}
          <View style={styles.profile}>
            <Text style={type.tiny}>Signed in as</Text>
            <Text style={[type.small, { color: colors.ink, fontWeight: '700' }]}>{access?.role?.label ?? 'Owner'}</Text>
            <Press onPress={onLeave} style={styles.leave} accessibilityRole="button">
              <Icon name="back" size={14} color={colors.ink} />
              <Text style={[type.small, { color: colors.ink }]}>The household app</Text>
            </Press>
            <Lights />
          </View>
        </View>
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
            {items.map((n) => (
              <Press
                key={n.key}
                onPress={() => setScreen(n.key)}
                style={[styles.chip, screen === n.key && styles.chipOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: screen === n.key }}
              >
                <Icon name={n.icon} size={13} color={screen === n.key ? colors.selectedFg : colors.ink} />
                <Text style={[type.tiny, { color: screen === n.key ? colors.selectedFg : colors.ink }, screen === n.key && { fontWeight: '700' }]}>{n.label}</Text>
              </Press>
            ))}
          </ScrollView>
        </View>
      )}

      {/* One tooltip panel for the whole back office, positioned in the page's
          own coordinate space so it lands where it should inside the shell's
          phone frame as well (explain.tsx). */}
      <View style={styles.content}>{body}</View>
    </View>
    </Explains>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  content: { flex: 1 },

  // 196px and a hairline edge — the handoff's own measurements ("Category
  // screens v2", 14 Sep 2026). The rail stands on the same ground as the page:
  // a second surface colour behind it would be the panel the handoff forbids,
  // and the one rule is enough to say where the page starts.
  rail: {
    width: 196, borderRightWidth: 1, borderRightColor: colors.lineSoft,
    paddingVertical: 20, paddingHorizontal: spacing.sm, gap: 1,
  },
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
