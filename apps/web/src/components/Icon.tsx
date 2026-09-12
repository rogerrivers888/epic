import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Archive, ArrowLeft, ArrowRight, ChevronLeft, Baby, Ban, BedDouble, Beer, Calendar, Camera, Car, CarTaxiFront, Check, ChevronDown, ChevronRight, ChevronUp, CircleCheck,
  Bird, Fish,
  Clock, CloudOff, Coffee, Compass, Database, Download, ExternalLink, Footprints, GripVertical, Heart, Hourglass, House, Info, Landmark, List, LocateFixed, Lock, Map, MapPin, Mic, Minus, Monitor, Navigation, Pencil, Phone, Pin, Plus, Route, Search, Settings, Smartphone,
  MessageSquare, Moon, PoundSterling, RefreshCw, Sparkles, Square, Star, StarHalf, Sun, Ticket, TrainFront, Trash2, TriangleAlert, User, Users, Utensils, Wine, X,
  Copy, Mail, Send, UserCog, UserPlus, Ellipsis, ShoppingBasket, QrCode, Maximize2, SlidersHorizontal,
  Eye, Upload, Image as ImageIcon, Gift, CreditCard, Wallet, Pause, Play, Keyboard,
  Bike, Binoculars, Blocks, BookOpen, Castle, Clapperboard, Drama, Droplets, Dumbbell, FerrisWheel, Gamepad2,
  Mountain, Music, Palette, PartyPopper, Popcorn, Puzzle, Sandwich, Ship, ShoppingBag, Snowflake, Store, Tractor, TreePine, Trophy,
  HandPlatter, Shield, ShieldCheck, BadgeCheck, Video, Megaphone, Repeat, CalendarCheck, Banknote, Laptop, DoorOpen, Handshake, GraduationCap,
  Share2, CircleAlert, UserRound, Award, Presentation, HandHeart,
} from 'lucide-react-native';
import { colors, spacing, type } from '../theme';

/**
 * One icon set for the whole app: Lucide, drawn as SVG at the size and colour
 * the caller asks for. Every icon is named for what it means in Epic, not for
 * the picture, so a screen says `name="favourite"` and the set decides the
 * glyph. Emoji and symbol characters are not icons here (owner, 3 Sep 2026).
 */
const ICONS = {
  // navigation
  inspire: Sparkles, plan: Sparkles, places: Compass, trips: Route, household: Users, settings: Settings,
  /**
   * The fifth tab (Events & Hosts, 12 Sep 2026): hosting is offering something
   * of your own to strangers, so the glyph is a hand holding a plate out.
   */
  host: HandPlatter,
  /**
   * Hosts and events. The trust ladder is three shields: `verified` the plain
   * outline, `checked` the ticked one, `trusted` the same tick on an ink
   * ground (drawn by the badge, not by a fourth glyph). A host's type is a chip
   * of words, never an icon — the brief forbids anything that reads as a rank.
   */
  verified: Shield, checked: ShieldCheck, trusted: BadgeCheck,
  video: Video, broadcast: Megaphone, series: Repeat, oneoff: CalendarCheck, anytime: Clock, payout: Banknote,
  online: Laptop, theirPlace: DoorOpen, yourPlace: House, outAbout: MapPin, handshake: Handshake, credential: GraduationCap,
  share: Share2, alert: CircleAlert, guest: UserRound, award: Award, pitch: Presentation, family: HandHeart,
  web: Monitor, mobile: Smartphone, person: User,
  // Light and dark mode, on the theme switch
  light: Sun, dark: Moon,
  // actions and states
  mic: Mic, stop: Square, check: Check, close: X, add: Plus, minus: Minus,
  // The voice intake's controls (handoff, 8 Sep 2026): Pause / Resume beside
  // Done, and the keyboard glyph on every "Type instead".
  pause: Pause, resume: Play, keyboard: Keyboard, cycle: Bike,
  back: ArrowLeft, forward: ArrowRight, external: ExternalLink,
  expand: ChevronDown, collapse: ChevronUp, more: ChevronRight,
  /**
   * The other chevron. `more` is the one a row ends in and means "there is a
   * page behind this"; this is its mirror, for the pair of arrows that step a
   * month or nudge a time (trip rebuild, 5a) — where an arrow would read as
   * "go back" rather than "one less".
   */
  previous: ChevronLeft,
  // The ⋯ that opens the rest of a screen's controls. `more` is the chevron a
  // row ends in and means "there is a page behind this"; this one means "there
  // is a menu here", and drawing one as the other reads as a broken link.
  menu: Ellipsis,
  keep: Heart, favourite: Star, halfStar: StarHalf, pinned: Pin,
  /**
   * A shortlist is hearted, not bookmarked (owner, 8 Sep 2026: "Shortlist is
   * now a heart not a bookmark icon"). One glyph for both states — `fill` is
   * what says it is on, the same way the loved heart works everywhere else —
   * so a row that fills in place does not swap shapes as well as colours.
   */
  shortlist: Heart, shortlisted: Heart,
  /** Open this out to the whole screen: the half view's expand glyph. */
  fullscreen: Maximize2,
  /** Narrowing a list down, rather than a single setting: the browse's Filters. */
  filters: SlidersHorizontal,
  allergen: TriangleAlert, archived: Archive, refresh: RefreshCw, delete: Trash2,
  // the device's own copy: no signal, saving it, and what Epic owns outright
  offline: CloudOff, download: Download, owned: Database,
  // facts about a place
  address: MapPin, hours: Clock, children: Baby, phone: Phone, message: MessageSquare, camera: Camera, calendar: Calendar, ticket: Ticket,
  /**
   * How long you would spend there, which is not what time it opens. `hours` is
   * the clock on "Open until 17:15"; this is the glass on "Allow 2h", and they
   * turn up in the same three-row list, so they cannot be the same picture.
   */
  duration: Hourglass,
  // the journey: ways of getting about, booking states, list and map, order
  walking: Footprints, driving: Car, transit: TrainFront, taxi: CarTaxiFront, directions: Navigation, home: House,
  // where the device says the household is standing, right now
  here: LocateFixed,
  // who has Epic, and getting a link to them: the admin module
  accounts: UserCog, mail: Mail, send: Send, copy: Copy,
  // Somebody joining a table for one meal, what the order goes into while it is
  // being chosen, and the code a waiter points a camera at (owner, 7 Sep 2026).
  addPerson: UserPlus, basket: ShoppingBasket, qr: QrCode,
  booked: CircleCheck, full: Ban, locked: Lock, money: PoundSterling, grip: GripVertical, list: List, map: Map, info: Info, search: Search, edit: Pencil,
  // the invite page: what it looks like, and where its picture comes from
  preview: Eye, upload: Upload, picture: ImageIcon, gift: Gift, card: CreditCard,
  // What a thing costs, on the filter line. `money` is the pound sign, which is
  // a currency; this is the budget you are spending in it.
  wallet: Wallet,
  // categories
  restaurant: Utensils, cafe: Coffee, pub: Beer, bar: Wine, takeaway: Sandwich, attraction: Landmark, event: Ticket, hotel: BedDouble, place: MapPin,
  // What a place actually is, over the closed experience vocabulary
  // (api/src/domain/concepts.js). A card with no photograph shows one of these
  // instead, so four playgrounds do not all sit under a Greek temple.
  museum: Landmark, gallery: Palette, theatre: Drama, cinema: Clapperboard, liveMusic: Music, comedy: PartyPopper,
  park: TreePine, walk: Footprints, beach: Droplets, viewpoint: Binoculars, farm: Tractor, zoo: Bird, aquarium: Fish,
  playground: Blocks, arcade: Gamepad2, escapeRoom: Puzzle, themePark: FerrisWheel, bowling: Trophy, sport: Dumbbell,
  swimming: Droplets, climbing: Mountain, iceSkating: Snowflake, cycling: Bike, boat: Ship, festival: PartyPopper,
  market: Store, shopping: ShoppingBag, bookshop: BookOpen, castle: Castle, history: Castle, cinemaSnack: Popcorn,
} as const;

export type IconName = keyof typeof ICONS;

// Icons are ink: ink on cream in light, cream on ink in dark (Epic pack §04 —
// "Ink is every letter and line"). Lime is a ground, never a glyph colour.
// Lucide outline at 1.8px.
export function Icon({ name, size = 18, color = colors.icon, fill, fillColor, strokeWidth = 1.8 }: {
  name: IconName; size?: number; color?: string; fill?: boolean;
  /**
   * A fill that is not the stroke's colour — the tab bar's lime glyph inside an
   * ink outline. Without it a filled icon is one flat shape, and lime on cream
   * has no edge to read against.
   */
  fillColor?: string;
  strokeWidth?: number;
}) {
  /*
    A name that is not in the set draws the pin rather than bringing the screen
    down.

    `ICONS[name]` on a name that is not a key is `undefined`, and rendering
    `undefined` is React error #130 — which is not "this icon is missing", it
    is the whole screen replaced by "This screen stopped working". That is what
    a single `'clock' as IconName` in the place drawer did on 8 Sep 2026: every
    place on Inspire was untappable, and the message said nothing about icons.

    A cast can always get a bad name past the compiler, so the guard is here as
    well as in the types. It is deliberately not silent — the console says which
    name, because a pin where a castle should be is a bug, just a cheap one.
  */
  const Glyph = ICONS[name];
  if (!Glyph) {
    console.warn(`Icon: no glyph called "${name}" — drawing the pin instead.`);
    return <MapPin size={size} color={color} strokeWidth={strokeWidth} fill={fill ? (fillColor ?? color) : 'none'} />;
  }
  return <Glyph size={size} color={color} strokeWidth={strokeWidth} fill={fill ? (fillColor ?? color) : 'none'} />;
}

const CATEGORY: Record<string, IconName> = { restaurant: 'restaurant', cafe: 'cafe', pub: 'pub', bar: 'bar', takeaway: 'takeaway', attraction: 'attraction', event: 'event', hotel: 'hotel', lodging: 'hotel' };

/**
 * The experience vocabulary the sources answer with, in this set's names. A
 * place says it is a playground or a castle long before it says what category
 * it is, and that is the more useful thing to draw.
 */
const EXPERIENCE: Record<string, IconName> = {
  museum: 'museum', 'art-gallery': 'gallery', theatre: 'theatre', cinema: 'cinema', 'live-music': 'liveMusic', comedy: 'comedy',
  park: 'park', walk: 'walk', beach: 'beach', viewpoint: 'viewpoint', farm: 'farm', zoo: 'zoo', aquarium: 'aquarium',
  playground: 'playground', arcade: 'arcade', 'escape-room': 'escapeRoom', 'theme-park': 'themePark', bowling: 'bowling',
  'mini-golf': 'bowling', 'sports-game': 'sport', swimming: 'swimming', climbing: 'climbing', trampoline: 'sport',
  'ice-skating': 'iceSkating', cycling: 'cycling', 'boat-trip': 'boat', festival: 'festival', market: 'market',
  shopping: 'shopping', bookshop: 'bookshop', castle: 'castle', history: 'history',
};

/**
 * The atlas's own eight words for what a place is (sources/wikimedia.js
 * ATTRACTION_ROOTS). A separate table from the one above because it is a
 * separate vocabulary — the experiences list is closed and voice is
 * interpreted against it, so the atlas's words are not folded into it.
 */
const ATLAS: Record<string, IconName> = {
  heritage: 'castle', museum: 'museum', arts: 'gallery', outdoors: 'park',
  animals: 'zoo', family: 'playground', active: 'sport', landmark: 'attraction',
};

/**
 * The best icon for a place: what the atlas researched it to be, then what a
 * source tagged it, then what kind of place it is. Used where a card has no
 * photograph and the tile has to carry the meaning on its own.
 */
export function iconFor({ category, experiences, atlasCategory }: {
  category?: string | null; experiences?: string[] | null; atlasCategory?: string | null;
}): IconName {
  if (atlasCategory && ATLAS[atlasCategory]) return ATLAS[atlasCategory];
  for (const e of experiences ?? []) if (EXPERIENCE[e]) return EXPERIENCE[e];
  return CATEGORY[category ?? ''] ?? 'place';
}

/** The icon for a place's category; a pin when the category is unknown. */
export function CategoryIcon({ category, size = 18, color = colors.icon }: { category?: string | null; size?: number; color?: string }) {
  return <Icon name={CATEGORY[category ?? ''] ?? 'place'} size={size} color={color} />;
}

/** A line of small text led by an icon: an address, opening hours, a note about children. */
export function IconText({ name, children, color = colors.icon, style }: { name: IconName; children: React.ReactNode; color?: string; style?: object }) {
  return (
    <View style={styles.line}>
      <View style={styles.lineIcon}><Icon name={name} size={15} color={color} /></View>
      <Text style={[type.small, { flex: 1 }, style]}>{children}</Text>
    </View>
  );
}

/** A rating: a filled star and the number, with whatever follows it in muted text. */
export function Rating({ value, children }: { value: number; children?: React.ReactNode }) {
  return (
    <View style={styles.line}>
      <Icon name="favourite" size={14} color={colors.icon} fill />
      <Text style={type.small}><Text style={{ fontWeight: '700', color: colors.ink }}>{value.toFixed(1)}</Text>{children}</Text>
    </View>
  );
}

/**
 * A rating drawn as stars (owner, 4 Sep 2026: reviews should have stars). Five
 * glyphs, filled to the nearest half, in ink — never a ★ character, and never
 * a colour: Epic has no rating yellow and no brand red to reach for.
 */
export function Stars({ value, size = 15, children }: { value: number; size?: number; children?: React.ReactNode }) {
  const halves = Math.max(0, Math.min(10, Math.round(value * 2)));
  return (
    <View style={styles.line} accessibilityRole="text" accessibilityLabel={`${value} out of 5`}>
      <View style={[styles.stars, { paddingTop: 1 }]}>
        {[0, 1, 2, 3, 4].map((i) => {
          const filled = halves >= (i + 1) * 2;
          const half = !filled && halves === i * 2 + 1;
          return <Icon key={i} name={half ? 'halfStar' : 'favourite'} size={size} fill={filled || half} />;
        })}
      </View>
      {children ? <Text style={type.small}>{children}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  stars: { flexDirection: 'row', gap: 1 },
  lineIcon: { paddingTop: 2 },
});
