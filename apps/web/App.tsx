// First, and deliberately: it moves this device's stored keys from `roam.` to
// `epic.` before any module below reads one. See src/rename.ts.
import './src/rename';
// After the rename, never before it: this reads the session (Codex, 3 Oct 2026).
import { PublicEventPage, PublicHostPage, ShortEvent } from './src/screens/guest/PublicPages';
import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Press } from './src/components/press';
import { StatusBar } from 'expo-status-bar';
import { api, API_URL, HouseholdResponse } from './src/api';
import { prefetch, clearResourceCache, invalidateTabData, inspireNearKey, INSPIRE_DEFAULT_MINUTES, ATLAS_KEY, TRIPS_KEY } from './src/cache/resourceCache';

// A change of session — signing out, a token timing out, or a different person
// signing in on this browser — clears the shared in-memory cache, so the last
// session's rented content is never handed to the next one (cache/resourceCache).
onSessionChange(() => { clearResourceCache(); });
import { colors, radius, spacing, TARGET, type, BORDER, INK } from './src/theme';
import { useTheme } from './src/hooks/useTheme';
import { getViewer, onViewerChange } from './src/viewer';
import { Avatar } from './src/components/Faces';
import { OpenTripOptions, PlanScreen } from './src/screens/PlanScreen';
import { InspireScreen } from './src/screens/InspireScreen';
import { PlacesScreen } from './src/screens/PlacesScreen';
import { TripsScreen, TripSeed } from './src/screens/TripsScreen';
import { SharedTripScreen } from './src/screens/SharedTripScreen';
import { HouseholdScreen } from './src/screens/HouseholdScreen';
import { SayScreen } from './src/screens/voice/SayScreen';
import { StepsScreen } from './src/screens/voice/StepsScreen';
import { HeardScreen } from './src/screens/voice/HeardScreen';
import { AskScreen } from './src/screens/voice/AskScreen';
import { WelcomeScreen, wasWelcomed } from './src/screens/voice/WelcomeScreen';
import { OpeningScreen } from './src/screens/OpeningScreen';
import { SetupScreen } from './src/screens/voice/SetupScreen';
import { TellScreen } from './src/screens/voice/TellScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { HostScreen } from './src/screens/host/HostScreen';
import { HostProfileScreen } from './src/screens/HostProfileScreen';
import { TagScreen } from './src/screens/TagScreen';
import { HostPage } from './src/screens/guest/HostPage';
import { GuestEvent, GuestInvite } from './src/screens/guest/routes';
import { Inbox } from './src/screens/guest/PlansEvents';
import { InspireEvents } from './src/screens/guest/InspireEvents';
import { GuestBooking } from './src/screens/guest/BookingPage';
import { PeopleScreen } from './src/screens/PeopleScreen';
import { CollectionsScreen } from './src/screens/CollectionsScreen';
import { InvitedLinkScreen } from './src/screens/InvitedScreen';
import { ForkScreen, HeardScreen as UpForHeardScreen, ListeningScreen, SavedScreen, TripIntakeScreen, WhoScreen } from './src/screens/open/UpFor';
import { MatchScreen } from './src/screens/open/Match';
import { PrototypesScreen } from './src/screens/PrototypesScreen';
import { JoinScreen } from './src/screens/JoinScreen';
import { OrderTicketScreen } from './src/screens/OrderTicketScreen';
import { AdminApp, firstAdminScreen } from './src/admin/AdminApp';
import { useActivity } from './src/hooks/useActivity';
import { LoginScreen, safeNext } from './src/screens/LoginScreen';
import { takeRememberedNext } from './src/afterSignIn';
import { InScreen } from './src/screens/InScreen';
import { SiteScreen } from './src/site/SiteScreen';
import { AccountScreen } from './src/screens/AccountScreen';
import { Wordmark } from './src/components/Wordmark';
import { useViewport, ViewportProvider } from './src/hooks/useViewport';
import { useOffline } from './src/hooks/useOffline';
import { useOutbox } from './src/hooks/useOutbox';
import { useSession } from './src/hooks/useSession';
import { hydrateSession, onSessionChange, signedIn } from './src/session';
import { Icon, IconName } from './src/components/Icon';
import { Toaster } from './src/components/Toast';
import { UpgradePrompt } from './src/components/UpgradePrompt';
import { RouterProvider, rememberedAddress, useRememberedAddress, useRouter } from './src/router';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { isFullBleed, isImmersive, isTabHome, legacyHref, ownsHeader, parseRoute, paths, Route, splitHref, Tab, TripSection, tabOf, titleOf } from './src/routes';

// Epic opens on Inspire (owner, 5 Sep 2026, "Supporting docs/Roam Inspire"):
// what there is to do, with one search bar above it. The conversational planner
// is still there and still has an address — /plan, and the door at the foot
// of the search screen — it is simply no longer the first thing Epic says.
/** Without a membership (guest handoff G21): only Plans › Events, Messages and Settings. */
const GUEST_TABS: { key: Tab; label: string; icon: IconName; href: string; owner?: true }[] = [
  { key: 'trips', label: 'Plans', icon: 'trips', href: `${paths.trips()}?span=events` },
  { key: 'messages', label: 'Messages', icon: 'message', href: paths.messages() },
  { key: 'settings', label: 'Settings', icon: 'settings', href: paths.settings() },
];
const TABS: { key: Tab; label: string; icon: IconName; href: string; owner?: true }[] = [
  { key: 'inspire', label: 'Inspire', icon: 'inspire', href: paths.inspire() },
  { key: 'places', label: 'Places', icon: 'places', href: paths.places() },
  { key: 'trips', label: 'Plans', icon: 'trips', href: paths.trips() },
  // Five in the bar (owner, 12 Sep 2026): Household folded into Settings to
  // make room for Host. The Host tab is hosting only — guests find experiences
  // in Inspire and Places and book them into Trips.
  { key: 'host', label: 'Host', icon: 'host', href: paths.host() },
  { key: 'settings', label: 'Settings', icon: 'settings', href: paths.settings() },
];

// Mobile-first (V1 is the installed web app on a phone), but on a wide screen
// this is a real desktop app: navigation down the side, two-column content.
const DESKTOP = 900;

// On a wide screen the owner can flip between the two (3 Sep 2026): "Web" is the
// desktop layout at full width; "Mobile" draws the whole app inside a phone-sized
// frame so every screen shows how it will look on the phone. The choice sticks.
type ViewMode = 'web' | 'mobile';
const VIEW_KEY = 'epic.viewMode';
const PHONE = { width: 390, height: 844 };
const TOOLBAR = 44;
const BEZEL = 10;
const readViewMode = (): ViewMode =>
  Platform.OS === 'web' && typeof localStorage !== 'undefined' && localStorage.getItem(VIEW_KEY) === 'mobile' ? 'mobile' : 'web';

/**
 * Every screen has an address, and the address is what decides which screen is
 * drawn (src/router.tsx, src/routes.ts) — so the router goes outside everything,
 * including the phone frame, the passcode and the choice of profile.
 */
export default function App() {
  // The token lives in the device's secure store; on the web it is read
  // synchronously, but on the phone the Keychain is async, so the app holds the
  // first paint until it has loaded (`hydrateSession`) — otherwise the first
  // request would go out signed-out. On the web this is already true, so nothing
  // waits. (State that is not a secret is synchronous on both platforms and
  // needs no gate.)
  const [ready, setReady] = useState(Platform.OS === 'web');
  useEffect(() => {
    if (ready) return;
    let live = true;
    hydrateSession().finally(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, [ready]);
  if (!ready) return null;
  return (
    <RouterProvider>
      <Frame />
    </RouterProvider>
  );
}

/**
 * The outermost box, which keeps the app clear of the
 * notch and the home indicator; on a full-bleed screen a plain `View`, because
 * the whole point is that the map runs under both (owner, 6 Sep 2026: "all the
 * way to the edge of the screen, including the little pill in the middle of the
 * iPhone"). What must stay clear of them is the sheet and the tab bar, and each
 * of those keeps itself clear.
 */
function Edges({ children, style, bleed, ownFooter, ownHeader }: { children: React.ReactNode; style?: any; bleed?: boolean; ownFooter?: boolean; ownHeader?: boolean }) {
  /**
   * A plain View, deliberately — never `SafeAreaView`.
   *
   * react-native-web's SafeAreaView pads all four edges by the safe area
   * itself, so wrapping the app in one and then adding an inset anywhere inside
   * it counts the same space twice. That is what put a band of dead app above
   * the wordmark and below the tab bar, and it hid from four rounds of testing
   * because the component builds its `env(...)` string at runtime from two
   * halves: it is not in the bundle to be found, and `env()` is nought in a
   * headless browser, so the fault only ever existed on a real phone.
   *
   * The insets are applied here, once, and only where nothing else is going to.
   */
  const Box: any = View;
  // The app draws under the status bar (index.html), so a screen that is not
  // full-bleed puts the inset back on rather than letting the wordmark sit
  // under the clock. `env()` is nought in a browser tab and only bites in the
  // installed app, which is the only place the status bar is ours to use.
  //
  // The *bottom* inset is different, and getting it wrong here is what left a
  // band of empty screen under the tab bar (owner, 7 Sep 2026: "the Inspire,
  // Places and Trips are about 1.5 cm from the bottom of the screen"). Padding
  // the whole app stops everything short of the home indicator, background and
  // all. When a screen carries its own bottom chrome the bar absorbs the inset
  // instead, so its fill and its rule run to the physical edge and only the
  // labels sit clear of the indicator.
  // The top inset is the same bargain as the bottom one: a screen that draws
  // its own head takes the status bar into its own first row, rather than
  // having the frame push everything down and then adding its own 60 on top of
  // that — which is what put the wordmark a long way down the screen.
  const inset = !bleed && Platform.OS === 'web'
    ? {
      ...(ownHeader ? null : { paddingTop: 'var(--epic-sat)' as any }),
      ...(ownFooter ? null : { paddingBottom: 'var(--epic-sab)' as any }),
    }
    : null;
  return <Box style={[style, inset]}>{children}</Box>;
}

function Frame() {
  const window = useWindowDimensions();
  const [mode, setMode] = useState<ViewMode>(readViewMode);
  const choose = (m: ViewMode) => {
    setMode(m);
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') localStorage.setItem(VIEW_KEY, m);
  };

  // Last line of defence. The boundary inside the Shell keeps a broken screen
  // from taking the tabs with it; this one is for everything above the tabs —
  // the passcode, the profile, the frame's own chrome.
  const app = <ErrorBoundary what="Epic"><Routed /></ErrorBoundary>;
  // A narrow window is a phone already: no toggle, no frame. The public website
  // never shows the review toolbar either — a visitor to epic.day must not see
  // "Viewing as Web / Mobile"; the site is fully responsive, so a narrow window
  // shows its phone layout.
  const { path } = useRouter();
  // Nor the sign-in doors and the account page, which people reach signed out
  // (design audit, 2 Oct 2026): /login, /in/<token> and /account.
  if (window.width < DESKTOP || /^\/(en-(gb|us)(\/|$)|e\/|login\/?$|in\/|account\/?$)/.test(path)) return app;

  const frameHeight = Math.min(PHONE.height, window.height - TOOLBAR - spacing.xl * 2 - BEZEL * 2);
  // Where the phone's screen lands in the real window: the stage centres it below the toolbar.
  const origin = { x: (window.width - PHONE.width) / 2, y: TOOLBAR + (window.height - TOOLBAR - frameHeight) / 2 };
  const mobile = mode === 'mobile';
  const viewport = mobile
    ? { width: PHONE.width, height: frameHeight, framed: true, origin }
    : { width: window.width, height: window.height - TOOLBAR, framed: false };
  return (
    <View style={styles.root}>
      <View style={styles.toolbar} testID="view-mode">
        <Text style={type.tiny}>Viewing as</Text>
        <View style={styles.modeSwitch} accessibilityRole="radiogroup">
          {(['web', 'mobile'] as ViewMode[]).map((m) => (
            <Press
              key={m}
              onPress={() => choose(m)}
              accessibilityRole="radio"
              accessibilityState={{ checked: mode === m }}
              style={({ hovered }: any) => [styles.modeBtn, hovered && mode !== m && styles.modeBtnHover, mode === m && styles.modeBtnActive]}
            >
              <View style={styles.modeInner}>
                <Icon name={m} size={14} color={mode === m ? colors.primaryFg : colors.inkMuted} />
                <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>{m === 'web' ? 'Web' : 'Mobile'}</Text>
              </View>
            </Press>
          ))}
        </View>
        {mode === 'mobile' ? <Text style={type.tiny}>{PHONE.width} × {frameHeight}</Text> : null}
      </View>
      {/* Same tree shape in both modes so the Shell (and the screen you're on) survives the switch. */}
      <View style={mobile ? styles.stage : styles.fill}>
        <View style={mobile ? styles.bezel : styles.fill}>
          <View style={mobile ? [styles.screen, { width: PHONE.width, height: frameHeight }] : styles.fill}>
            <ViewportProvider value={viewport}>
              {app}
            </ViewportProvider>
          </View>
        </View>
      </View>
    </View>
  );
}

/**
 * The address, read — and the two kinds of address that are answered before
 * anything else is drawn.
 *
 * A scanned code (`/order/<token>`) is the same shape: a waiter's door into one
 * table's dinner, answered without a session and drawn without any of Epic's
 * chrome, because the person reading it is at work.
 *
 * A shared trip (`/shared/<token>`) is the same idea one layer up: the whole
 * plan, the people and the chat, for somebody with no Epic account at all.
 *
 * An invite link (`/join/<token>`) is somebody else's door into one trip: the
 * checklist a group organiser asked them for, and none of the household's app.
 * It is never behind the passcode, because the API treats it as public too
 * (auth.js), and it is read here so a participant never lands in Plan.
 *
 * The addresses Epic used to have (`/?tab=trips&trip=…`, `/?join=…`) are
 * answered once and replaced with the ones it has now: the owner keeps some of
 * them on his phone, and invite links went to people who have never heard of us.
 */
function Routed() {
  const { path, query, navigate } = useRouter();
  const redirect = useMemo(() => {
    const legacy = legacyHref(path, query);
    if (legacy) return legacy;
    if (path === '/' || path === '') {
      // The query travels: `/?signin=…` is a magic link, and dropping it here
      // would sign nobody in.
      const q = query.toString();
      return q ? `${paths.inspire()}?${q}` : paths.inspire();
    }
    return null;
  }, [path, query]);
  useEffect(() => { if (redirect) navigate(redirect, { replace: true }); }, [redirect, navigate]);

  const route = useMemo(() => parseRoute(path), [path]);

  // A window full of Epic is otherwise seven identical browser tabs.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.title = titleOf(route);
  }, [route]);

  if (redirect) return <View style={styles.waiting} />;
  if (route.name === 'join') return <JoinScreen token={route.token} />;
  // The code on a restaurant table (owner, 7 Sep 2026). Whoever scans it is a
  // waiter holding one link, so it is answered before the passcode, exactly as
  // an invite is, and it opens one sitting's dishes and nothing else of ours.
  if (route.name === 'order') return <OrderTicketScreen token={route.token} />;
  /**
   * A trip somebody was sent (trip rebuild, 7 Sep 2026): "anyone with the link
   * sees the plan, people and chat as a guest — no account needed". Same shape
   * as the two above — answered before the passcode, because the API treats it
   * as public too (auth.js), and drawn without any of the household's app.
   */
  if (route.name === 'shared') return <SharedTripScreen token={route.token} you={query.get('you')} />;
  // Epic Events on the web (3 Oct 2026): a public event or host page is the same page for everybody, signed in or
  // not, in the website's own frame; Book and the host's events lead into the app from there.
  if (route.name === 'publicEvent') return <PublicEventPage code={route.code} locale={route.locale} />;
  if (route.name === 'publicHost') return <PublicHostPage code={route.code} locale={route.locale} />;
  if (route.name === 'shortEvent') return <ShortEvent code={route.code} />;
  /**
   * A host's profile and an experience page (Events & Hosts, 12 Sep 2026)
   * "must work logged-out; account creation happens after the tap". Answered
   * before the passcode like the three above and drawn without the shell's
   * chrome; the booking sheet under an experience needs a session and so goes
   * through the Gate, which is what asks for one.
   */
  // Signed in, a profile and an event page sit in the app under the tab bar (guest handoff G2–G5, G25);
  // signed out they are the web pages — the epic.day wordmark for a back button, and no tab bar (G23, G24).
  if (route.name === 'hostProfile' && route.layer === 'trust') return <HostProfileScreen route={route} />;
  if (route.name === 'hostProfile' && !signedIn()) return <HostPage id={route.hostId} webPage />;
  // An invitation to a private offer (13 Sep 2026): no account, no password — yes or no, and how many.
  // An invitation answered on the web with no account (G12); signed in it sits in the app under Plans (G13).
  if (route.name === 'invited' && !signedIn()) return <GuestInvite token={route.token} webPage />;
  if (route.name === 'invitedLink') return <InvitedLinkScreen token={route.token} />;
  if (route.name === 'experience' && !signedIn() && route.layer !== 'ask') return <GuestEvent route={route} webPage />;
  /**
   * A tag's page (Host Skills, S14): public for the same reason an experience
   * page is — it is where "fossil hunting Jurassic Coast" lands, and asking a
   * stranger for a passcode first would throw the traffic away.
   */
  if (route.name === 'tag') return <TagScreen tagKey={route.key} vocab={route.vocab} />;
  /**
   * Log in (Supporting docs › EPIC staff management, L1/L2). The front door at
   * epic.day/login, public and the same for customers and staff: an email, then
   * a single-use link. Answered before the Gate so it is reachable with no
   * session. The link it asks for is redeemed by the Gate, which then lands staff
   * in the back office and customers on their account page.
   */
  /**
   * The public website (Website & Registration): the homepage, the host page,
   * the legal pages and the campaign landing pages. Public and outside the app —
   * answered before the passcode, drawn in its own frame with no app chrome.
   */
  if (route.name === 'site' || route.name === 'guide') return <SiteScreen route={route} />;
  if (route.name === 'login') return <LoginScreen />;
  // Set your credentials (L4): an invitation or a reset link, before any session.
  if (route.name === 'in') return <InScreen token={route.token} />;
  return <Gate route={route} />;
}

/**
 * The passcode, then the app.
 *
 * Epic's API answered anybody until 4 Sep 2026; it now wants a session for
 * everything except health, the invite link and the door itself. This is the
 * door on the app's side of that.
 *
 * `unreachable` deliberately shows the app rather than the passcode screen: a
 * device that was signed in and now has no signal has a whole atlas saved on it
 * (offline/cache.ts), and putting a passcode box in front of somebody on a
 * train — one they cannot get past, because signing in needs the API — would
 * take away the one thing that still works.
 */
function Gate({ route }: { route: Route }) {
  const { href, query, setQuery, navigate } = useRouter();
  const { state, isOwner, access, recheck, account } = useSession();
  // A change of session identity — signing out, a timeout, or a different person
  // signing in on this browser — remounts the app below the gate, so no hook is
  // left showing the previous household's cached rows. The in-memory cache is
  // cleared at the same moment (App.tsx onSessionChange); this is the other half,
  // rebinding every reader. Keyed by an epoch that bumps on each token change,
  // because a direct token→token swap does not change `state` (Codex, D13).
  const [sessionEpoch, setSessionEpoch] = useState(0);
  useEffect(() => onSessionChange(() => setSessionEpoch((n) => n + 1)), []);
  /**
   * A magic link (?signin=<token>) is how everybody except the owner gets in.
   *
   * Read once, before anything else, and taken out of the address bar the moment
   * it has been used: a link left in the URL is a link that gets bookmarked, sent
   * on and pasted into a chat, and this one signs somebody in.
   */
  const [link] = useState(() => query.get('signin'));
  // Where the link was asked for (the free account step, G21), carried in the link
  // itself so it lands there even opened on another device. Vetted like any `next`.
  const [linkNext] = useState(() => query.get('next'));
  // One attempt per page load, whatever the effect's dependencies do. The
  // landing navigation changes the URL, which hands navigate/setQuery new
  // identities and re-runs the effect — and a second POST of the same token is
  // a spent link: a 401 that read as "signed out" and ended the session the
  // first POST had just opened (Virginia, 1 Oct 2026). A ref survives the
  // re-run; the `dropped` flag below only covers unmount mid-flight.
  const redeemAttempted = useRef(false);
  const [redeeming, setRedeeming] = useState(Boolean(link));
  const [linkFailed, setLinkFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!link || redeemAttempted.current) return;
    redeemAttempted.current = true;
    let dropped = false;
    (async () => {
      try {
        // The link exchange already answers with this session's access, so the
        // landing is decided from its result — not a second request that, if it
        // failed after the one-time link was spent, would strand a staff member
        // on /account with no household (Codex, 1 Oct 2026).
        const st = await api.signInWithLink(link);
        if (dropped) return;
        recheck();
        // Where you land is decided by the account, not the link: staff go to the
        // back office, a customer to their own account page (L3). The admin door
        // is what makes somebody staff. Navigating also takes the spent token out
        // of the address bar (a link left in a URL gets pasted into a chat).
        const toAdmin = Boolean(st.access?.doors?.includes('admin'));
        // Land on the first screen their role can open, not a fixed one: a
        // Support member has the admin door but not the Overview's capability.
        const screen = firstAdminScreen(st.access);
        // The page they were going to when they asked for the link, if it was
        // asked for on this device in the last hour (afterSignIn.ts).
        const landing = takeRememberedNext(safeNext) ?? safeNext(linkNext) ?? (toAdmin
          ? (screen === 'filing' ? paths.filing('categories') : paths.admin(screen))
          : paths.account());
        navigate(landing, { replace: true });
        setRedeeming(false);
      } catch (err: any) {
        if (dropped) return;
        setLinkFailed(err?.message ?? 'That link did not work. Ask for a new one.');
        setQuery({ signin: null, next: null }, { replace: true });
        setRedeeming(false);
      }
    })();
    return () => { dropped = true; };
  }, [link, linkNext, recheck, setQuery, navigate]);

  // Signed in but the access check never answered (a 429, or no network):
  // that is not a "no", so the back office says it is busy and asks again
  // every five seconds rather than refusing the page (second audit, 28 Sep).
  const accessUnknown = route.name === 'admin' && !access && (state === 'in' || state === 'unreachable');
  useEffect(() => {
    if (!accessUnknown) return;
    const t = setInterval(() => recheck(), 5000);
    return () => clearInterval(t);
  }, [accessUnknown, recheck]);

  // Signed out: a person signs in at /login with their own account — Google or
  // email + password — and comes straight back to the page they asked for. The
  // household passcode is never shown to a person; it is only the agents' way in,
  // through the API (owner, 2 Oct 2026).
  const signedOut = state === 'out' && !redeeming;
  useEffect(() => {
    if (!signedOut) return;
    const back = href && href !== '/' ? `?next=${encodeURIComponent(href)}` : '';
    const why = linkFailed ? `${back ? '&' : '?'}e=link` : '';
    navigate(`${paths.login()}${back}${why}`, { replace: true });
  }, [signedOut, href, linkFailed, navigate]);

  if (redeeming || state === 'checking' || signedOut) return <View style={styles.waiting} />;
  if (state === 'unconfigured') {
    return <NotHere title="Epic is not set up on this server yet" body="The API has no sign-in configured." href={paths.inspire()} />;
  }

  // Two applications behind one sign-in, and the address says which you are in
  // — so somebody who spent the afternoon in the back office comes back to it
  // on reload, and can send a colleague the exact screen they were looking at.
  //
  // The back office is only reachable by a session holding the `admin` door —
  // and if this app drew it anyway, every request it made would answer 404
  // (api/src/access.js).
  // A customer's own account page (L3), where a magic link lands a household
  // customer. Behind the session — the signed-out branch above has already sent
  // anybody without one to the lock screen.
  if (route.name === 'account') return <AccountScreen />;

  const mayAdminister = Boolean(access?.doors?.includes('admin'));
  if (route.name === 'admin') {
    if (accessUnknown) return <NotHere title="The back office is busy — try again in a moment" body="Trying again by itself every few seconds." href={paths.inspire()} />;
    if (!mayAdminister) return <NotHere title="That is not a page you can open" body="The back office needs an account with the admin door." href={paths.inspire()} />;
    return <AdminApp key={sessionEpoch} access={access} screen={route.screen} onScreen={(s) => navigate(s === 'filing' ? paths.filing('categories') : paths.admin(s))} onLeave={() => navigate(paths.inspire())} />;
  }
  // Booked or replied without a membership (guest handoff G21): Plans · Messages · Settings only.
  return <Shell key={sessionEpoch} route={route} isOwner={isOwner} mayAdminister={mayAdminister} guest={account?.plan === 'guest'} />;
}

/** An address that is not a page — mistyped, or one Epic used to have and no longer does. */
function NotHere({ title, body, href }: { title: string; body: string; href: string }) {
  const { navigate } = useRouter();
  return (
    <Edges style={[styles.root, { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm }]}>
      <Wordmark height={40} />
      <Text style={type.h3}>{title}</Text>
      <Text style={[type.small, { textAlign: 'center' }]}>{body}</Text>
      <Press onPress={() => navigate(href, { replace: true })} accessibilityRole="button" style={styles.notHereBtn}>
        <Icon name="inspire" size={16} color={colors.primaryFg} />
        <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>Take me home</Text>
      </Press>
    </Edges>
  );
}

function Shell({ route, isOwner, mayAdminister = false, guest = false }: { route: Route; isOwner: boolean; mayAdminister?: boolean; guest?: boolean }) {
  const { width } = useViewport();
  const { href, navigate } = useRouter();
  const desktop = width >= DESKTOP;
  // Messages is its own tab for a guest; a member reaches it from the Plans header, so it lights Plans.
  const tab = guest && route.name === 'messages' ? 'messages' : tabOf(route);
  /**
   * A screen that draws to every edge: no lime band above it, and the tab bar
   * over it rather than under it. A trip is one, because the trip is a map now.
   */
  const fullBleed = !desktop && isFullBleed(route);
  /** Whether the tab bar is on screen, and therefore what carries the bottom inset. */
  const { query } = splitHref(href);
  const hasTabs = !desktop && !isImmersive(route, query);
  // A screen that is all form takes the tab bar's strip too.
  const immersive = !desktop && isImmersive(route, query);
  /**
   * Where each tab was left (owner, 4 Sep 2026: "I come back 10 minutes later
   * after navigating off that tab, everything's disappeared").
   *
   * The tab in the rail carries that address; a typed `/places` still means the
   * atlas list. An address that quietly turned into a different page would not
   * be an address.
   *
   * Two things are left out of what is remembered: the magic-link token, which
   * must never be written down anywhere, and an open drawer, which is something
   * you were reading rather than somewhere you were.
   *
   * And a record is not a place either. `isTabHome` says which addresses a tab
   * may be left pointing at; standing on one that is not — inside a trip, on
   * the new-trip form — writes nothing down, so the tab keeps the last *list*
   * it saw, filters and all, and tapping Trips arrives at the trips (owner,
   * 7 Sep 2026).
   */
  const here = useMemo(() => {
    const { path, query } = splitHref(href);
    query.delete('signin');
    query.delete('place');
    const q = query.toString();
    return q ? `${path}?${q}` : path;
  }, [href]);
  useRememberedAddress(tab ?? 'nowhere', isTabHome(route) ? here : null);
  // The admin module is the owner's. Everybody else's app is exactly what it
  // was before accounts existed.
  const tabs = useMemo(
    () => (guest ? GUEST_TABS : TABS.filter((t) => !t.owner || isOwner)).map((t) => ({ ...t, href: t.key === tab ? t.href : rememberedAddress(t.key, t.href) })),
    [isOwner, tab, here, guest],
  );
  const [health, setHealth] = useState<'checking' | 'ok' | 'down'>('checking');
  const [household, setHousehold] = useState<HouseholdResponse | null>(null);
  /**
   * The place a new trip is *for* — the one somebody tapped "Create trip" on.
   *
   * This is the one thing the address deliberately does not carry. A half-filled
   * form is not a page: `/trips/new` is the form, and what somebody had typed
   * into it is theirs, not something to send to anybody. The place's name and
   * country do travel in the query, because those are the question rather than
   * the answer.
   */
  const [tripSeed, setTripSeed] = useState<TripSeed | null>(null);
  const offline = useOffline();
  const outbox = useOutbox();
  // Which screen, and that somebody is here. Two events, nothing identifying,
  // and always written against this session's own household (useActivity). The
  // tab, not the address: a trip's identifier is nobody's business but ours.
  useActivity(tab ?? 'unknown');
  // Showing the saved copy: the browser says there is no connection, the app has
  // already had to fall back to the device, or the API cannot be reached at all
  // and there is something saved to fall back to.
  const showingSaved = !offline.online || offline.serving || (health === 'down' && offline.pages > 0);

  const refreshHousehold = useCallback(async () => {
    try {
      const h = await api.household();
      // "3 pm" means 3 pm where the family is: keep the household's timezone in step with the device.
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz && h.household.timezone && h.household.timezone !== tz) {
        try { await api.updateHousehold({ timezone: tz }); h.household.timezone = tz; } catch { /* keep server value */ }
      }
      setHousehold(h);
    } catch { setHousehold(null); }
  }, []);

  useEffect(() => {
    api.health().then((h) => setHealth(h.ok ? 'ok' : 'down')).catch(() => setHealth('down'));
    refreshHousehold();
  }, [refreshHousehold]);

  // First run: a household with no home and nobody in it yet is shown the
  // opening once — the postcards opener and the four intro screens (Welcome
  // screens, 1h) — and marked welcomed on the way out, so it is seen once.
  // Anyone who has already set anything up has been here.
  const welcomedOnce = useRef(false);
  useEffect(() => {
    if (welcomedOnce.current || !household || route.name !== 'inspire' || wasWelcomed()) return;
    if (household.household.home || household.members.length) return;
    welcomedOnce.current = true;
    navigate(paths.opening(), { replace: true });
  }, [household, route.name, navigate]);

  // Keep the device's copy fresh without being asked (owner, 4 Sep 2026: they
  // should not have to research every time they come back). Once a day, a few
  // seconds after the app settles so it never competes with the first screen,
  // and only the pages the API answers for free — the atlas place lists can ask
  // Google what kind of place a row is, and those are saved by opening Places.
  // A free guest account (G21) holds none of those pages — the API refuses them — so it warms nothing.
  useEffect(() => {
    if (guest) return undefined;
    const t = setTimeout(() => { void api.keepDeviceCopyFresh(); }, 8000);
    return () => clearTimeout(t);
  }, [guest]);

  // No spinner on the first arrival either (owner, D13: "start loading Inspire's
  // data the moment login succeeds, and on app open when already logged in").
  // The Shell only mounts once a session is in hand — a sign-in or an app open
  // that was already signed in — so the moment the household is known, warm the
  // three tabs' data into the shared in-memory cache, in parallel, and the page
  // is ready when the family lands on it. Inspire is warmed for the home ring at
  // the defaults the screen opens on (home, driving, an hour); a searched town
  // is a genuine miss and draws the skeleton, never a spinner. `prefetch` skips
  // anything already fresh, so a household refresh does not re-fetch. Nothing
  // here is written to disk — the Inspire pool is rented (offline/policy.ts).
  useEffect(() => {
    if (!household || guest) return;
    const home = household.household.home;
    if (home) {
      const p = { lat: home.lat, lng: home.lng, label: home.label, locality: home.locality ?? null, from: null, mode: 'drive' as const, minutes: INSPIRE_DEFAULT_MINUTES };
      prefetch(inspireNearKey(p), () => api.inspireNear(p));
    }
    prefetch(ATLAS_KEY, () => api.atlas());
    prefetch(TRIPS_KEY, () => api.trips());
  }, [household, guest]);

  // Coming back online after being offline, the cached tabs may be holding the
  // saved copy the offline layer served — real, but possibly days old, and the
  // cache cannot tell a fallback from a fresh read, so it would otherwise treat
  // it as fresh for ten minutes (Codex, D13). The browser's online flag is the
  // real connectivity signal to key this on: marking the tab data stale on the
  // transition back online means the next visit refreshes it, and a fetch that
  // succeeds replaces it, so there is no loop. (The per-request "serving saved"
  // flag is deliberately not used — it flaps once per request during a partial
  // API outage and would invalidate the tabs over and over, Codex.)
  const wasOnline = useRef(offline.online);
  useEffect(() => {
    if (offline.online && !wasOnline.current) invalidateTabData();
    wasOnline.current = offline.online;
  }, [offline.online]);

  /** Somewhere to eat is Places' question, and it arrives there already asked. */
  const openFood = () => navigate(`${paths.placesHome()}?kind=eat`);
  /**
   * Opening a trip from somewhere else — the planner's handoff, a taste table,
   * an idea — carries how Find should be set, because that is part of the page
   * being opened rather than a message passed behind the address bar.
   */
  const openTrip = (id: string, opts?: OpenTripOptions) => {
    const q = new URLSearchParams();
    if (opts?.findRadiusKm) q.set('km', String(opts.findRadiusKm));
    if (opts?.findCat) q.set('cat', opts.findCat);
    if (opts?.findPrices?.length) q.set('prices', opts.findPrices.join(','));
    const href = paths.trip(id, (opts?.section as TripSection | undefined) ?? null);
    navigate(q.toString() ? `${href}?${q}` : href);
  };

  const screen = (
    <>
      {route.name === 'inspire' ? (
        <InspireScreen
          route={route}
          household={household}
          onOpenTrip={openTrip}
          onPlanner={() => navigate(paths.plan())}
          onFood={openFood}
          onCreateTrip={({ place, seed }) => {
            setTripSeed({ place, seed, kind: 'outing' });
            navigate(`${paths.newTrip()}?kind=outing&place=${encodeURIComponent(place.label ?? seed.name)}`);
          }}
        />
      ) : null}
      {route.name === 'plan' ? <PlanScreen household={household} onOpenTrip={openTrip} /> : null}
      {route.name === 'places' ? (
        <PlacesScreen
          route={route}
          household={household}
          refreshHousehold={refreshHousehold}
          onPlanTrip={(p) => {
            setTripSeed(p);
            const q = new URLSearchParams();
            if (p.placeText) q.set('place', p.placeText);
            if (p.countryCode) q.set('country', p.countryCode);
            navigate(`${paths.newTrip()}${q.toString() ? `?${q}` : ''}`);
          }}
        />
      ) : null}
      {route.name === 'trips' ? (
        <TripsScreen
          route={route}
          household={household}
          refreshHousehold={refreshHousehold}
          seed={tripSeed}
          onSeedUsed={() => setTripSeed(null)}
        />
      ) : null}
      {route.name === 'household' && !route.voice ? <HouseholdScreen data={household} refresh={refreshHousehold} route={route} /> : null}
      {/* Hosting (12 Sep 2026): the tab, and every page inside it. */}
      {route.name === 'host' ? <HostScreen route={route} /> : null}
      {route.name === 'people' ? <PeopleScreen household={household} /> : null}
      {route.name === 'collections' ? <CollectionsScreen /> : null}
      {route.name === 'booking' ? <GuestBooking route={route} /> : null}
      {route.name === 'experience' ? <GuestEvent route={route} webPage={false} /> : null}
      {route.name === 'hostProfile' ? <HostPage id={route.hostId} webPage={false} /> : null}
      {route.name === 'messages' ? <Inbox /> : null}
      {route.name === 'invited' ? <GuestInvite token={route.token} webPage={false} /> : null}
      {route.name === 'events' ? <InspireEvents /> : null}
      {/* What you are up for, and the introductions it leads to (Casual meet ups). */}
      {route.name === 'open' && route.matchId ? <MatchScreen matchId={route.matchId} chat={route.chat} /> : null}
      {route.name === 'open' && !route.matchId && route.page === 'fork' ? <ForkScreen /> : null}
      {route.name === 'open' && route.page === 'say' ? <ListeningScreen tripId={route.tripId} /> : null}
      {route.name === 'open' && route.page === 'heard' ? <UpForHeardScreen tripId={route.tripId} /> : null}
      {route.name === 'open' && route.page === 'saved' ? <SavedScreen tripId={null} /> : null}
      {route.name === 'open' && route.page === 'who' ? <WhoScreen tripId={route.tripId} /> : null}
      {route.name === 'open' && route.page === 'trip' && route.tripId ? <TripIntakeScreen tripId={route.tripId} /> : null}
      {route.name === 'open' && route.page === 'card' && route.tripId ? <SavedScreen tripId={route.tripId} /> : null}
      {route.name === 'household' && route.voice && route.memberId ? <TellScreen memberId={route.memberId} mode={route.voice} household={household} refresh={refreshHousehold} /> : null}
      {/* Voice intake (handoff, 8 Sep 2026): the mic, the wizard, the card, its questions; first run and the two-minute set-up. */}
      {route.name === 'say' && !route.intakeId && !route.steps ? <SayScreen household={household} /> : null}
      {route.name === 'say' && route.steps ? <StepsScreen household={household} /> : null}
      {route.name === 'say' && route.intakeId && !route.ask ? <HeardScreen intakeId={route.intakeId} household={household} onOpenTrip={(id) => openTrip(id)} /> : null}
      {route.name === 'say' && route.intakeId && route.ask ? <AskScreen intakeId={route.intakeId} household={household} /> : null}
      {route.name === 'welcome' ? <WelcomeScreen /> : null}
      {/* The opening (Welcome screens, 1h): the postcards opener and four intro screens, shown once after sign-up. */}
      {route.name === 'opening' ? <OpeningScreen /> : null}
      {route.name === 'setup' ? <SetupScreen household={household} refresh={refreshHousehold} /> : null}
      {route.name === 'settings' ? <SettingsScreen data={household} refresh={refreshHousehold} route={route} /> : null}
      {route.name === 'prototypes' ? <PrototypesScreen route={route} /> : null}
      {route.name === 'unknown' ? (
        <NotHere
          title="There is no page at that address"
          body={`Epic has nothing at ${route.path}. It may be a link from an older version of the app, or a typo.`}
          href={paths.inspire()}
        />
      ) : null}
    </>
  );

  // A banner above a screen that draws its own head is the first thing under
  // the status bar, so on a phone it takes the notch's inset itself; the
  // screen's own inset then sits below it (Codex review, 9 Sep 2026).
  // Only the first banner drawn takes it: two would open a gap between them
  // (Codex, twelfth pass). The outbox banner comes first, then the offline or
  // API one — the same order they are laid out below.
  const inset = !desktop && Platform.OS === 'web' && ownsHeader(route) ? { paddingTop: `calc(${spacing.sm}px + var(--epic-sat))` as any } : null;
  const outboxShown = Boolean(outbox.waiting || outbox.rejected);
  const bannerInset = outboxShown ? null : inset;
  const waitingInset = outboxShown ? inset : null;
  const banner = (
    <View style={[styles.banner, bannerInset, health === 'down' && styles.bannerDown]}>
      <Text style={type.small}>{health === 'checking' ? `Reaching API at ${API_URL}…` : `Can't reach the API at ${API_URL}. Is it running?`}</Text>
    </View>
  );

  // No signal is not a failure (owner, 4 Sep 2026): everything the household has
  // already looked at is on the device, so this says which and gets out of the
  // way. It replaces the "can't reach the API" banner, which would be the wrong
  // thing to say to someone on a train.
  //
  // `navigator.onLine` is not the test. It only says whether the device has a
  // network interface, so a phone attached to a train's wifi with no working
  // connection behind it reports itself online. What is actually true is
  // whether the answers on screen came from the device, which is what
  // `serving` says (src/offline/cache.ts).
  // Writes made without signal are on the device and go on their own
  // (offline/outbox.ts). Saying so is the difference between "it saved" and the
  // family wondering whether it did.
  const waitingBanner = outbox.waiting || outbox.rejected ? (
    <View style={[styles.banner, waitingInset]}>
      <View style={styles.bannerRow}>
        <Icon name={outbox.rejected ? 'allergen' : 'offline'} size={14} color={outbox.rejected ? colors.overrun : colors.ink} />
        <Text style={type.small}>
          {outbox.rejected
            ? `${outbox.rejected} change${outbox.rejected === 1 ? '' : 's'} couldn't be sent and ${outbox.rejected === 1 ? 'is' : 'are'} kept on this device — Settings › Account.`
            : outbox.sending
              ? `Sending ${outbox.waiting} change${outbox.waiting === 1 ? '' : 's'}…`
              : `${outbox.waiting} change${outbox.waiting === 1 ? '' : 's'} saved on this device, waiting for signal.`}
        </Text>
      </View>
    </View>
  ) : null;

  const offlineBanner = (
    <View style={[styles.banner, bannerInset]}>
      <View style={styles.bannerRow}>
        <Icon name="offline" size={14} color={colors.ink} />
        <Text style={type.small}>
          {offline.pages
            ? `No signal — showing what's saved on this device. Your places, trips and visits are all here.`
            : `No signal, and nothing saved on this device yet. What you open is kept here once you're back online.`}
        </Text>
      </View>
    </View>
  );

  // One tree for both layouts, with the screen in the same slot, so flipping
  // between desktop and phone (window resize or the Web/Mobile toggle) keeps
  // whatever is open on the screen — the trip you were looking at, a search.
  return (
    <Edges style={styles.root} bleed={fullBleed} ownFooter={hasTabs} ownHeader={ownsHeader(route)}>
      <StatusBar style="dark" />
      <View style={desktop ? styles.desktop : styles.fill}>
        {desktop ? (
          <View style={styles.sidebar}>
            <View style={styles.sideBrand}><Wordmark height={44} ground={colors.surface} /></View>
            <Text style={[type.tiny, { marginBottom: spacing.lg }]}>Seize the day</Text>
            {tabs.map((t) => (
              <NavItem key={t.key} icon={t.icon} label={t.label} href={t.href} on={tab === t.key} />
            ))}
            {/* Not a tab any more, but not gone: the conversational planner, which
                Inspire's search screen also opens. Named here so it is findable. */}
            <NavItem icon="message" label="Plan" href={paths.plan()} on={tab === 'plan'} />
            {/* Desktop only: the served mock-up pages, for review — not part of the phone app. */}
            <NavItem icon="list" label="Prototypes" href={tab === 'prototypes' ? paths.prototypes() : rememberedAddress('prototypes', paths.prototypes())} on={tab === 'prototypes'} />
            <View style={{ flex: 1 }} />
            {/* The other application, for whoever holds its door. Named rather
                than hidden behind an icon: switching profile is a deliberate act. */}
            {mayAdminister ? <NavItem icon="accounts" label="Back office" href={paths.admin('overview')} on={false} quiet /> : null}
            {/* The corner is who you are and how the app looks — not the API's address (owner, 4 Sep 2026). */}
            <You household={household} onOpen={() => navigate(paths.settings())} />
          </View>
        ) : fullBleed || ownsHeader(route) ? null : (
          <View style={styles.header}>
            <Wordmark height={34} />
            {mayAdminister ? (
              <Press onPress={() => navigate(paths.admin('overview'))} style={styles.headerAdmin} accessibilityRole="link" accessibilityLabel="Back office">
                <Icon name="accounts" size={16} color={colors.inkMuted} />
              </Press>
            ) : null}
          </View>
        )}
        {!desktop ? waitingBanner : null}
        {!desktop && showingSaved ? offlineBanner : !desktop && health !== 'ok' ? banner : null}
        <View style={styles.content}>
          {desktop ? waitingBanner : null}
          {desktop && showingSaved ? offlineBanner : desktop && health === 'down' ? banner : null}
          {/* A screen that throws loses the screen, not the app: the tabs stay
              under it, and moving to another one clears it (resetKey is the
              address). Owner, 7 Sep 2026: "I get a blank page". */}
          <ErrorBoundary resetKey={here}>{screen}</ErrorBoundary>
        </View>
        {hasTabs ? (
          // On a full-bleed screen the tab bar floats over the map instead of
          // taking a strip off the bottom of it, so the map really does reach
          // every edge (owner, 6 Sep 2026).
          <View style={[styles.tabs, fullBleed && styles.tabsOver]} accessibilityRole="tablist">
            {tabs.map((t) => (
              <Press key={t.key} onPress={() => navigate(t.href)} style={styles.tab} accessibilityRole="tab" accessibilityState={{ selected: tab === t.key }}>
                {/* New navigation (owner, 30 Sep 2026, §8): the active tab is
                    ink, not lime — lime is the header and nothing else. The
                    weight is carried by a heavier stroke (2.4 vs 1.8) and a
                    bolder label, never a fill. */}
                <Icon name={t.icon} size={22} color={tab === t.key ? colors.ink : colors.inkMuted} strokeWidth={tab === t.key ? 2.4 : 1.8} />
                <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
              </Press>
            ))}
          </View>
        ) : null}
        {/* One toaster for the app, inside the frame so it pins to the phone on
            the Mobile toggle rather than across the whole window (Settings v2). */}
        <Toaster />
        <UpgradePrompt />
      </View>
    </Edges>
  );
}

/** One line of the rail. It carries an address rather than a screen name. */
function NavItem({ icon, label, href, on, quiet }: { icon: IconName; label: string; href: string; on: boolean; quiet?: boolean }) {
  const { navigate } = useRouter();
  return (
    <Press
      onPress={() => navigate(href)}
      style={[styles.navItem, on && styles.navItemActive, quiet && styles.navItemQuiet]}
      accessibilityRole={quiet ? 'button' : 'tab'}
      accessibilityState={{ selected: on }}
    >
      <View style={styles.navIcon}><Icon name={icon} size={18} color={on ? colors.selectedFg : colors.inkMuted} /></View>
      <Text style={[styles.navLabel, on && { color: colors.selectedFg }]}>{label}</Text>
    </Press>
  );
}

/**
 * The foot of the sidebar, the way Parcelvision's rail does it (owner, 4 Sep
 * 2026): one row above a rule — who is using the app, and a single square icon
 * button on the right that flips light and dark. The icon is the mode you would
 * go to, not the one you are in, so it reads as the switch it is.
 *
 * Tapping the person opens Settings for now; this is where a profile and sign-in
 * will live once there is one. There is no sign-in yet, so "you" is whoever the
 * device is set to — Settings › Ratings shown as.
 */
function You({ household, onOpen }: { household: HouseholdResponse | null; onOpen: () => void }) {
  const members = household?.members ?? [];
  const [id, setId] = useState<string | null>(null);
  const { theme, setPref } = useTheme();
  useEffect(() => onViewerChange(setId), []);
  const viewer = id && members.some((m) => m.id === id) ? id : getViewer(members);
  const index = Math.max(0, members.findIndex((m) => m.id === viewer));
  const me = members[index];
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <View style={styles.foot}>
      <Press
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={me ? `${me.name} — your profile and settings` : 'Your profile and settings'}
        style={({ hovered }: any) => [styles.you, hovered && styles.youHover]}
      >
        {me ? <Avatar name={me.name} index={index} size={30} url={me.avatarUrl} /> : <Icon name="person" size={20} color={colors.inkMuted} />}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.youName} numberOfLines={1}>{me ? me.name : 'Sign in'}</Text>
          <Text style={type.tiny} numberOfLines={1}>Your profile</Text>
        </View>
      </Press>
      <Press
        onPress={() => setPref(next)}
        accessibilityRole="button"
        accessibilityLabel={next === 'dark' ? 'Switch to dark mode' : 'Switch to light mode'}
        testID="theme-switch"
        style={({ hovered, pressed }: any) => [styles.themeBtn, hovered && styles.themeBtnHover, pressed && { opacity: 0.85 }]}
      >
        <Icon name={next} size={16} color={colors.inkMuted} />
      </Press>
    </View>
  );
}

const styles = StyleSheet.create({
  waiting: { flex: 1, backgroundColor: colors.bg },
  root: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  toolbar: {
    height: TOOLBAR, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.md,
    // A warm neutral, not the lime tint: this is chrome, and lime means the
    // live thing (owner, 14 Sep 2026: "there is not supposed to be any green
    // bar at the top").
    paddingHorizontal: spacing.lg, backgroundColor: colors.panelWarm, borderBottomWidth: BORDER, borderBottomColor: colors.line,
  },
  modeSwitch: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.pill, borderWidth: BORDER, borderColor: colors.line, padding: 2 },
  modeBtn: { minHeight: 28, paddingHorizontal: spacing.md, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  modeBtnActive: { backgroundColor: colors.selected },
  modeBtnHover: { backgroundColor: colors.surfaceMuted },
  foot: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: BORDER, borderTopColor: colors.line },
  you: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.xs, borderRadius: radius.md },
  themeBtn: { width: 34, height: 34, borderRadius: radius.md, borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  themeBtnHover: { backgroundColor: colors.accentSoft, borderColor: colors.icon },
  youHover: { backgroundColor: colors.accentSoft },
  youName: { fontSize: 14, fontWeight: '700', color: colors.ink },
  modeInner: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  modeText: { fontSize: 12, fontWeight: '600', color: colors.inkMuted },
  modeTextActive: { color: colors.selectedFg },
  // The ground the phone frame sits on, in the owner's review view. A neutral
  // one: `surfaceMuted` is the lime tint, which in dark is a deep olive and
  // turned the whole desk green.
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, padding: spacing.xl },
  bezel: {
    padding: BEZEL, borderRadius: 36, backgroundColor: INK,
    boxShadow: '0 12px 30px rgba(0,0,0,0.25)',
  },
  // The screen is exactly the size the app is told it has; the bezel sits outside it.
  screen: { borderRadius: 36 - BEZEL, backgroundColor: colors.bg, overflow: 'hidden' },
  desktop: { flex: 1, flexDirection: 'row' },
  sidebar: { width: 220, padding: spacing.lg, borderRightWidth: BORDER, borderRightColor: colors.line, backgroundColor: colors.surface, gap: 4 },
  // The one lime field (Epic pack §07): no shadow, just its colour.
  // The header centres the wordmark, so the back-office door floats at its
  // right edge rather than joining the column and pushing the mark off centre.
  headerAdmin: { position: 'absolute', right: spacing.md, top: spacing.md, padding: 6 },
  navItemQuiet: { opacity: 0.9 },
  notHereBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, paddingHorizontal: spacing.lg, minHeight: TARGET, borderRadius: radius.md, backgroundColor: colors.primary, justifyContent: 'center' },
  header: { alignItems: 'center', paddingVertical: spacing.md, backgroundColor: colors.headerBg, borderBottomWidth: BORDER, borderBottomColor: colors.line },
  sideBrand: { paddingVertical: spacing.sm },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: TARGET, paddingHorizontal: spacing.sm, borderRadius: radius.md },
  // The tab you are on is the selection moment: a lime fill with ink type.
  navItemActive: { backgroundColor: colors.selected },
  navIcon: { width: 22, alignItems: 'center' },
  navLabel: { fontSize: 15, fontWeight: '600', color: colors.ink },
  content: { flex: 1 },
  banner: { padding: spacing.sm, backgroundColor: colors.accentSoft, alignItems: 'center' },
  bannerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  bannerDown: { backgroundColor: colors.overrunSoft },
  /**
   * As close to the bottom as the phone allows, and no closer.
   *
   * The design's 28px is measured on a drawing with no home indicator in it, so
   * taking it literally left half a centimetre of dead app under the labels
   * (owner, 7 Sep 2026: "it can probably move at least half a centimetre
   * down"). On a phone that has an indicator the inset *is* the clearance the
   * labels need and nothing more; on one that has none, 8px is enough to keep
   * them off the edge.
   */
  // Reserving the whole safe-area inset read as a centimetre of dead app under
  // the labels (owner, 30 Sep 2026, third time: "much lower down"). Dropping them
  // to the very edge put them into the indicator's strip, though (Codex), so the
  // owner picked the middle: about half a centimetre lower, keeping ~18px of
  // clearance on the common 34px inset — under the labels, above the pill.
  tabs: {
    // §8: a 1px soft rule, not the 2px ink one — the bar is the ground with a
    // hairline on it, cream in light and the dark ground in dark.
    flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.ruleSoft, backgroundColor: colors.tabbar,
    // At the foot of the screen (owner, 2 Oct 2026, on his iPhone: "It needs to be
    // right at the foot of the screen. There should not be this big white gap"),
    // which reverses the 30 Sep lift: on a phone with a home indicator the labels
    // sit just above the pill (inset − 18), and 12px off the edge without one.
    paddingBottom: (Platform.OS === 'web' ? 'max(12px, calc(var(--epic-sab) - 18px))' : 18) as any,
  },
  // Floating over the map, and clear of the home indicator on a phone that has
  // one — the map runs under the indicator, the labels must not.
  tabsOver: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingBottom: (Platform.OS === 'web' ? 'max(12px, calc(var(--epic-sab) - 18px))' : 18) as any,
  },
  // A 44pt target with no slack around it: the icon and its label are 37 of
  // those 44, and the ten extra were another few millimetres of nothing.
  // The icons sit ~3mm under the bar's line, not on it (owner, 2 Oct 2026: "the
  // icons are almost touching the bar above… move the icons down about 3 mm").
  // §8 / 4a: 4px between the icon and its label.
  tab: { flex: 1, minHeight: TARGET, alignItems: 'center', justifyContent: 'flex-start', gap: 4, paddingTop: 22 },
  tabText: { fontSize: 10, fontWeight: '500', color: colors.inkMuted },  // §8: inactive 500, grey 700 both modes
  tabTextActive: { color: colors.ink, fontWeight: '700' },              // §8: active 700 ink
});
