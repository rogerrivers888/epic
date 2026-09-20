// Visual system, from the Epic brand pack v1 (September 2026, `Supporting
// docs/Rebrand - EPIC`). Three colours do almost everything: lime is the brand
// and is used big and flat, ink is every letter and every rule, cream is the
// ground for anything you have to read for long. Two supporting tones — lime
// tint and moss — exist for UI only.
//
// The pack replaces the Roam guidelines entirely (owner, 7 Sep 2026: "Retire
// all existing brand guidelines and use the new ones"). What changed:
//   · Mint → lime, white → cream, leaf green → ink.
//   · Square corners throughout. No shadows, no radius.
//   · Rules are ink, and 2px wherever the kit draws them.
//   · Selected is a lime fill with ink type; hover is the lime tint.
//   · Roam red is retired. The single exception the owner kept is meaning
//     rather than brand: allergens and overruns stay red, because they mean
//     danger. Nothing else in the app is red — the loved heart is now ink.
//   · Archivo is the whole type system, wordmark included. Caveat is gone.
//
// Contrast, measured: ink on lime 13.1:1, ink on cream 16.3:1, ink on lime
// tint 15.5:1, moss on cream 6.2:1. Cream on lime is 1.25:1 and is never used
// — the pack forbids it, and so does this file.
//
// Two palettes, one set of names. On the web every colour is a CSS variable
// (react-native-web passes `var(--…)` through untouched), so switching the
// theme is setting the variables on <html>; nothing re-renders and every
// StyleSheet keeps working.

import { Platform } from 'react-native';

export type ThemeName = 'light' | 'dark';
export type ThemePref = ThemeName | 'system';

// The three, straight from the pack. Held here as well as in the palettes
// because the wordmark and the app icons need the brand colour itself, not
// whichever palette happens to be on.
export const LIME = '#C8F542';       // the pack's own hex, and what the pin assets are drawn in
export const INK = '#201E1D';
export const CREAM = '#FFFDF9';
export const LIME_TINT = '#EAFECB';  // oklch(0.97 0.07 125) — UI only
export const MOSS = '#446B00';       // oklch(0.48 0.13 130) — UI only

/**
 * Dark, from the v2 handoff's own table. Not a dimming of the light palette: a
 * deeper ground, a warmer off-white for type, and — the two that matter — a
 * lime tint that is a dark olive rather than a pale wash, and a *lifted* green
 * in place of moss, because moss on this ground fails contrast.
 *
 * Every one of these is the browser's own rendering of the handoff's `oklch`,
 * read back off a screenshot rather than converted by hand.
 */
const D = {
  ground: '#151413',
  sheet: '#242220',
  ink: '#F3F1EC',
  grey700: '#A8A4A2',
  grey500: '#807B78',   // decorative only — never text
  ruleSoft: '#3A3634',
  limeTint: '#2B390B',  // oklch(0.32 0.07 125)
  moss: '#A6D75E',      // oklch(0.82 0.16 128)
  bubble: '#2A2726',
  panelWarm: '#2A2726',    // a warm neutral lift off the ground
};

/**
 * Ink, always, on any lime fill — in both modes.
 *
 * The handoff states it as a rule of its own ("Every lime fill carries ink
 * #201E1D text"), and it is the one thing that cannot be expressed by flipping
 * a palette: `ink` is the *type* colour and becomes cream in the dark, so a
 * control that fills with lime and asks for `colors.ink` gets white-on-lime and
 * fails at 1.25:1. Anything sitting on lime asks for this instead.
 */
export const ON_LIME = INK;

const LIGHT = {
  // Ground and surfaces
  bg: CREAM,               // screen ground
  surface: CREAM,          // cards, tab bar
  surfaceMuted: LIME_TINT, // open-panel ground, second picture tile, neutral chips
  panel: LIME_TINT,
  well: LIME_TINT,         // row icon squares
  tabbar: CREAM,
  headerBg: LIME,          // the one lime field
  headerSub: INK,          // sub-copy on lime is ink — never cream, never moss
  lime: LIME,
  // Type
  ink: INK,
  inkMuted: '#605D5D',     // grey 700: labels, placeholders, inactive tabs — 6.4:1 on cream
  /**
   * Grey 500 is the handoff's decorative grey and is explicitly never text — it
   * fails AA below 18.66px, which is every size we set it at. So the faintest
   * text is still grey 700, and `decor` is what a hairline or an empty tile uses.
   */
  inkFaint: '#605D5D',
  decor: '#7D7979',
  // Rules are ink (pack §07: "Ink rules, cream fill, no shadow, no radius").
  line: INK,
  // The one exception: a track or a groove is a shape, not a rule, and an ink
  // one reads as already filled.
  lineSoft: '#DCD7CF',
  /**
   * The voice intake's greys (handoff, 8 Sep 2026): a profile chip's warm-grey
   * fill, the 1px light rule between rows, and the dashed border of a gap.
   * The dashed grey is decorative and never text.
   */
  warm: '#F3F1EC',
  ruleSoft: '#D7D3D3',
  /**
   * A rule that has to be seen but not heard: heavier than the hairline, well
   * short of `decor`. The back office's column-header bands use it (owner,
   * 13 Sep 2026, twice: "that bar still needs to be a lighter white as well…
   * it should just be a bit toned down from what it was").
   */
  ruleMuted: '#BDB8B1',
  ghost: '#9B9797',
  // Links and the small text that has to read "green" on cream
  accent: MOSS,
  accentSoft: LIME_TINT,
  icon: INK,               // icons are ink; lime is a ground, not a glyph colour
  // Buttons: a primary is an ink fill with cream type on light grounds
  primary: INK,
  primaryFg: CREAM,
  // Selection is the brand moment: a lime fill with ink type. Hover is the tint.
  selected: LIME,
  selectedFg: ON_LIME,
  hover: LIME_TINT,
  /**
   * The second line on an ink ground — a tile that is on, the map signpost.
   *
   * `inkMuted` is grey 700 and reads as muted against cream; on ink it is very
   * nearly invisible, which is why a hex kept being written into the screens
   * instead (Codex, 8 Sep 2026). This is that grey, named, so the rule that
   * every colour comes from here can actually be kept.
   */
  mutedOnInk: '#C9C5C2',
  /**
   * The three grounds of the v2 menu bar (handoff "Shared header - v2").
   *
   * `switchOff` is the half of the pair you are not in: a warm neutral grey
   * rather than the lime tint, because the tint is *selection* and two green
   * cells would say you were in both. `onLimeMuted` is an unselected word
   * sitting on the lime band - moss on light, a deeper green on dark, since the
   * band stays lime in both modes and the light-mode moss goes muddy there.
   * `bandSub` is the drawer row that opens under a chosen category.
   */
  switchOff: '#F3F1EC',
  onLimeMuted: MOSS,
  bandSub: LIME_TINT,
  /** What a sheet is lifted off. Deeper in the dark, where a 45% veil is barely there. */
  scrim: 'rgba(32,30,29,0.45)',
  /**
   * The lighter veil under a filter dropdown. A panel hanging off the bar is
   * still part of the screen behind it - you are meant to see the list you are
   * about to change - so it dims less than a sheet that has replaced it.
   */
  scrimSoft: 'rgba(32,30,29,0.35)',
  // The heart of a place you love. Ink, not red — the pack retires brand red.
  loved: INK,
  /**
   * What somebody else said, in a thread (trip rebuild, 7 Sep 2026, 5e).
   *
   * A neutral grey, and not `surfaceMuted`: the lime tint is *selection*, and a
   * received bubble drawn in it makes both sides of a conversation green, which
   * is the one thing a chat cannot afford. The handoff names both values.
   */
  bubble: '#EAE7E7',
  /**
   * A warm grey panel — the "Find your stay" row on a multi-day trip (5h).
   *
   * Not the lime tint, which is selection, and not a bubble, which is somebody
   * speaking: this is a shelf, and the handoff names both its values.
   */
  panelWarm: '#F3F1EC',
  // Time bar
  travel: '#D8D3CB',
  dwell: LIME,
  slack: LIME_TINT,
  /**
   * The hosting canvases (13 Sep 2026) draw two things no other screen has:
   * the deep green that sits on a lime block — oklch(0.40 0.11 130), darker
   * than moss so it reads on the brand colour — and the near-black ground a
   * video sits on before anything is recorded. The lime block stays lime in
   * both modes, so its text does too.
   */
  onLime: '#335200',
  videoGround: '#2A2726',
  // Meaning that must still read as danger. The owner kept these red when
  // everything else went (7 Sep 2026): an allergen is not a brand decision.
  overrun: '#C0392B',
  overrunSoft: '#FBE9E7',
  allergen: '#B3261E',
  allergenSoft: '#FBE9E7',
  // Household verdicts are moss, ink and the lime tint — not new colours
  like: MOSS,
  likeSoft: LIME_TINT,
  dislike: '#605D5D',
  dislikeSoft: '#F1EFEA',
  want: MOSS,
  wantSoft: LIME_TINT,
  rating: INK,
};

// "Night · lime": the pack's reverse lockup taken across the whole app. Ink is
// the ground, cream is every letter, and lime carries the things light mode
// gives to ink — links, selection, the primary button.
const DARK: typeof LIGHT = {
  bg: D.ground,
  surface: D.sheet,        // a sheet, a card, anything lifted off the ground
  surfaceMuted: D.limeTint,
  panel: D.sheet,
  well: D.limeTint,
  tabbar: D.ground,        // the bar is the ground with a rule on it, not a shelf
  headerBg: D.ground,
  headerSub: D.grey700,
  lime: LIME,
  ink: D.ink,              // "ink" is the type colour, whatever the ground
  inkMuted: D.grey700,
  inkFaint: D.grey700,     // grey 500 is never text, in either mode
  warm: D.panelWarm,
  ruleSoft: D.ruleSoft,
  ruleMuted: '#5A5450',
  ghost: D.grey500,
  decor: D.grey500,
  // The strong rule is the type colour, as the table says. It only reads as
  // loud on a ground that is not dark enough — which the old one was not.
  line: D.ink,
  lineSoft: D.ruleSoft,
  // The lifted green. Moss itself fails on this ground, so the selected
  // category, the sub-strip and "Open until" all use this instead.
  accent: D.moss,
  accentSoft: D.limeTint,
  icon: D.ink,
  // Primary inverts: ink-fill/cream-text becomes lime-fill/ink-text.
  primary: LIME,
  primaryFg: ON_LIME,
  selected: LIME,
  selectedFg: ON_LIME,
  hover: D.limeTint,
  mutedOnInk: '#C9C5C2',
  switchOff: D.bubble,
  onLimeMuted: '#335200',  // oklch(0.40 0.11 130) - on the band, which stays lime in the dark
  bandSub: '#34440D',      // oklch(0.36 0.08 125)
  scrim: 'rgba(0,0,0,0.62)',
  scrimSoft: 'rgba(0,0,0,0.55)',
  loved: D.ink,
  bubble: D.bubble,
  panelWarm: D.panelWarm,
  travel: D.ruleSoft,
  dwell: LIME,
  slack: D.sheet,
  onLime: '#335200',
  videoGround: D.bubble,
  overrun: '#E8776B',
  overrunSoft: '#3E1F1B',
  allergen: '#EA7A70',
  allergenSoft: '#3D1E1B',
  like: D.moss,
  likeSoft: D.limeTint,
  dislike: D.grey700,
  dislikeSoft: D.sheet,
  want: D.moss,
  wantSoft: D.limeTint,
  rating: D.moss,
};

export const PALETTES: Record<ThemeName, typeof LIGHT> = { light: LIGHT, dark: DARK };
export type ColorName = keyof typeof LIGHT;

const isWeb = Platform.OS === 'web' && typeof document !== 'undefined';
// Text that sits on a filled shape uses `colors.primaryFg` on a primary fill
// and `colors.bg` on a status fill: each is the inverse of its ground in both palettes.
export const colors: typeof LIGHT = isWeb
  ? (Object.fromEntries(Object.keys(LIGHT).map((k) => [k, `var(--epic-${k})`])) as typeof LIGHT)
  : LIGHT;

export const THEME_KEY = 'epic.theme';
export const getThemePref = (): ThemePref => {
  if (!isWeb || typeof localStorage === 'undefined') return 'light';
  // A device that last ran under the old name kept this as `roam.theme`;
  // `src/rename.ts` has already moved it by the time anything here runs.
  const v = localStorage.getItem(THEME_KEY);
  return v === 'dark' || v === 'light' || v === 'system' ? v : 'system';
};
const systemTheme = (): ThemeName => (isWeb && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
export const resolveTheme = (pref: ThemePref = getThemePref()): ThemeName => (pref === 'system' ? systemTheme() : pref);

const listeners = new Set<(t: ThemeName) => void>();
export const onThemeChange = (fn: (t: ThemeName) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** Write the palette onto <html> so every var(--epic-…) resolves; also the browser chrome colour and the map tiles. */
export function applyTheme(name: ThemeName = resolveTheme()) {
  if (!isWeb) return;
  const root = document.documentElement;
  const p = PALETTES[name];
  for (const [k, v] of Object.entries(p)) root.style.setProperty(`--epic-${k}`, v);
  root.setAttribute('data-theme', name);
  root.style.colorScheme = name;
  document.body.style.backgroundColor = p.bg;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', p.headerBg);
  listeners.forEach((fn) => fn(name));
}

export function setThemePref(pref: ThemePref) {
  if (isWeb && typeof localStorage !== 'undefined') localStorage.setItem(THEME_KEY, pref);
  applyTheme(resolveTheme(pref));
}

/**
 * The back office has a theme of its own.
 *
 * The owner, 17 Sep 2026: "pin the back office to dark, please, but I may want
 * to toggle it, so retain the ability to switch." It is dark by default and the
 * household app is not, so the two cannot share one preference. `follow` hands
 * it back to whatever the app is set to.
 */
export type AdminThemePref = ThemeName | 'follow';
export const ADMIN_THEME_KEY = 'epic.theme.admin';
export const getAdminThemePref = (): AdminThemePref => {
  if (!isWeb || typeof localStorage === 'undefined') return 'dark';
  const v = localStorage.getItem(ADMIN_THEME_KEY);
  return v === 'dark' || v === 'light' || v === 'follow' ? v : 'dark';
};
export function setAdminThemePref(pref: AdminThemePref) {
  if (isWeb && typeof localStorage !== 'undefined') localStorage.setItem(ADMIN_THEME_KEY, pref);
  applyTheme(pref === 'follow' ? resolveTheme() : pref);
}

/**
 * True while the back office is holding the palette.
 *
 * The system listener below re-resolves the *app's* preference, so a laptop
 * flipping to dark at sunset repainted the back office in whatever the app was
 * set to and took its dark away (Codex, 17 Sep 2026). While the back office is
 * on screen its own choice wins, and the listener leaves it alone.
 */
let adminHolds: AdminThemePref | null = null;
export const adminHoldsTheme = (pref: AdminThemePref | null) => { adminHolds = pref; };

if (isWeb) {
  applyTheme();
  if (typeof window.matchMedia === 'function') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      if (adminHolds) { applyTheme(adminHolds === 'follow' ? resolveTheme() : adminHolds); return; }
      if (getThemePref() === 'system') applyTheme();
    });
  }
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

// Square corners throughout (pack §07). The names are kept so every existing
// StyleSheet keeps compiling; they all resolve to a right angle now. A face is
// still a circle — a person is not a card — and those set their own radius.
export const radius = { sm: 0, md: 0, lg: 0, pill: 0 };

// Rules are 2px wherever the kit draws them; a hairline inside a dense row may
// still be 1. Held here so a screen asks for `BORDER` rather than guessing.
export const BORDER = 2;

// Type: Archivo, one family, three weights (pack §05). Display 800 at −0.04em,
// headings 800 at −0.02em, labels 600 at 0.08em caps, body 400 at 16/1.5.
// Everything is flush left. The wordmark is the same family at 800 and
// −0.06em — there is no second face in Epic.
export const fonts = {
  heading: Platform.OS === 'web' ? 'Archivo, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' : undefined,
  body: Platform.OS === 'web' ? 'Archivo, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' : undefined,
  wordmark: Platform.OS === 'web' ? 'Archivo, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' : undefined,
};

export const type = {
  title: { fontFamily: fonts.heading, fontSize: 28, fontWeight: '800' as const, color: colors.ink, letterSpacing: -0.56, lineHeight: 32 },
  h2: { fontFamily: fonts.heading, fontSize: 20, fontWeight: '800' as const, color: colors.ink, letterSpacing: -0.4 },
  h3: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600' as const, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: 15, color: colors.ink, lineHeight: 21 },
  small: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, lineHeight: 18 },
  tiny: { fontFamily: fonts.body, fontSize: 11, color: colors.inkFaint, lineHeight: 15 },
  // A label needs room between it and the thing it names (owner, 4 Sep 2026:
  // "you need to give the headers room to breathe").
  label: { fontFamily: fonts.body, fontSize: 12, fontWeight: '700' as const, color: colors.inkMuted, letterSpacing: 0.72, textTransform: 'uppercase' as const, marginBottom: 6, marginTop: 4 },
};

// Every interactive target is at least 44pt (research §12).
export const TARGET = 44;

// The household's own people keep their colours: they are people, not rows.
// Re-cut around the lime/ink axis so a row of faces sits in the new system.
export const memberColors = ['#446B00', '#7A4A18', '#2F4E8A', '#7A2F5E', '#3F6B2E', '#8A5A00'];
export const memberColor = (index: number) => memberColors[index % memberColors.length];
/**
 * The pastel face (Hotels 2 §12): a soft fill, the initial in ink, a 2px ink
 * ring. Used where a face is a row you tap rather than a token beside a name —
 * at 44px the saturated fill is a lot of colour, and the ring is what makes it
 * read as a control. The saturated set above is still the small-avatar look.
 */
export const memberPastels = [LIME_TINT, '#F6E7C8', '#E3DCF0', '#F5E38A', '#D6E8C5', '#EFDCCB'];
export const memberPastel = (index: number) => memberPastels[index % memberPastels.length];

/**
 * The filing desk's own ladder (the Places redesign, 20 Sep 2026).
 *
 * The back office is pinned dark, and the drawing this section is built from
 * works on a warmer, lighter ground than the app's dark mode with more rungs
 * between the ground and the type than a palette meant for a phone needs: a
 * table wants a hairline between rows, a heavier rule under a header and a
 * third weight again for a border, and the app's dark has one `ruleSoft` for
 * all three. They are here rather than in the screens because a hex in a
 * screen is how two tables come to be drawn on two different greys.
 *
 * Lime and ink are the brand's own and are not restated: every lime fill here
 * is `LIME` and everything sitting on one is `ON_LIME`, as everywhere else.
 * Red is the app's `overrun` for the same reason it is red anywhere — danger,
 * not decoration — and is the only colour on this screen that is not from the
 * lime/ink/cream axis.
 */
export const desk = {
  /** The screen itself, and the sidebar. */
  ground: '#1A1817',
  /** A panel lifted off it — the picker, an input. Darker, not lighter. */
  well: '#141212',
  /** A row that is open, hearted, or otherwise the one being worked on. */
  lifted: '#1F1D1C',
  /** A row that is ticked, and the left rail's selection. */
  picked: '#232120',
  /** Every letter. */
  ink: '#F2EFEC',
  /** A second line under a name: still read, quieter. */
  inkMuted: '#CFCAC7',
  /** A label, a count, a note. The quietest thing that is still text. */
  inkDim: '#9A9492',
  /** Not text — a rule that has to disappear, or a disabled word. */
  inkFaint: '#6B6664',
  /** Between rows in a table. */
  rule: '#2E2A29',
  /** Under a table header, round a panel, and the tab strip's own line. */
  ruleStrong: '#46413F',
  /** The fill of a control that is off — a disabled button, an empty step. */
  off: '#2E2A29',
  /**
   * The one colour here that is not lime, ink or cream.
   *
   * Red on this surface means the same as red anywhere in Epic — danger, not
   * decoration (owner, 7 Sep 2026) — and it is what a never-opened mapping, a
   * district below its minimum fill and a provisional threshold are drawn in.
   *
   * It is its own value rather than `colors.overrun` because `colors` follows
   * the app's light-or-dark setting and this surface is pinned dark: a screen
   * reading `colors.overrun` in light mode would draw the desk's warnings in
   * the light red, which is four shades too dark to read on `ground`. The
   * value is the handoff's own `oklch(0.72 0.19 25)` converted to sRGB.
   */
  warn: '#FF6A65',
} as const;

/**
 * The household surface, as the back office previews it.
 *
 * The Rows tab draws a 390px column of what a household would actually see, and
 * that column is **pinned light** whatever the back office is set to. It has to
 * be: it is a picture of the app, and a picture of the app that follows the
 * back office's dark setting is a picture of something nobody will ever be
 * shown. Reading `colors` here would do exactly that.
 *
 * So these are the light palette's own values, fixed. Cream is the reading
 * ground, ink is every letter, and the two rules are the app's own — the
 * heavier one between sections, the hairline between rows.
 */
export const house = {
  ground: CREAM,
  ink: INK,
  /** A second line under a row's title. */
  inkMuted: '#605D5D',
  /** Between sections, and round the frame. */
  rule: '#D7D3D3',
  /** Between rows. */
  ruleSoft: '#EAE6DE',
  /** A hearted row, and the panel the first-heart question sits in. */
  warm: '#F4F1EA',
} as const;
