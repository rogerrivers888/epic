import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from './press';
import { api, DishNote, HouseholdResponse, Learned, Member, MenuItem, MenuLink, Order, OrderItem, ReadMenu } from '../api';
import { colors, radius, spacing, TARGET, type, BORDER } from '../theme';
import { useViewport } from '../hooks/useViewport';
import { Icon } from './Icon';
import { Button, Card, Chip, Row, Segmented, Wrap } from './ui';
import { QrCode } from './QrCode';
import { paths } from '../routes';
import { useRouter } from '../router';

/**
 * The table half of an evening (owner, 4 Sep 2026): "surface the functionality
 * where I can go through the menu and tick who wants what. It will create it as
 * an order that I can then read to the waiter. After that, I can go in and
 * review or give stars to the particular dishes that we had."
 *
 * Menu and Order are two tabs of the place's own drawer rather than a screen of
 * their own (owner, 4 Sep 2026: "if you can fit it in, menu/order would be
 * amazing… that way you should be straight into what you want"), so the state
 * lives in `useMenuOrder` and the two panels draw on it. Only the screen you
 * hold up to a waiter takes the whole window.
 *
 * The rating rule is the owner's and it is deliberately sparse: stars mean
 * good, a dish nobody touches counts as fine and writes nothing, and "not
 * great" is one tap that only then asks why.
 *
 * Allergens exclude and dislikes rank, and they never share a control or a
 * colour (CLAUDE.md). An allergen the menu declares is the warning red; an
 * allergen that is only *likely* — carrot in a ragù, which no menu has to
 * declare — can never be a clearance, so it asks.
 */

/**
 * Who a plate belongs to: somebody in the household, a guest at tonight's
 * table, or nobody, which is the plate everyone shares.
 *
 * A guest is the owner's, 7 Sep 2026 — "there could be other guests with me…
 * I'd like to be able to say, when I go into the menu, 'Add other guests'" —
 * and they belong to the sitting, not to the family: no allergens Epic knows,
 * no place in Who's coming, and nothing they say goes into the household's
 * tastes. `ref` is this phone's own id for them, which is what keeps their
 * dinner attached to them when the order is written again.
 */
type Diner = { key: string; name: string; kind: 'member' | 'guest' | 'table'; memberId: string | null; guestRef: string | null };
type Guest = { ref: string; name: string };

const memberDiner = (m: Member): Diner => ({ key: `m:${m.id}`, name: m.name.split(' ')[0], kind: 'member', memberId: m.id, guestRef: null });
const guestDiner = (g: Guest): Diner => ({ key: `g:${g.ref}`, name: g.name, kind: 'guest', memberId: null, guestRef: g.ref });
const TABLE: Diner = { key: 'table', name: 'For the table', kind: 'table', memberId: null, guestRef: null };
const keyOf = (memberId: string | null | undefined, guestRef: string | null | undefined) =>
  (memberId ? `m:${memberId}` : guestRef ? `g:${guestRef}` : 'table');

/**
 * What the table is having, keyed by dish and then by person.
 *
 * The note hangs off the pair, not off the dish (owner, 7 Sep 2026: "if 2
 * people are having the same menu item, they each might have different special
 * instructions"). Two people ordering the linguine is two rows, two words for
 * the waiter, and one of them can have no chilli without the other losing it.
 */
type Pick = { on: boolean; note: string };
type Picks = Record<string, Record<string, Pick>>;
/**
 * A dish on the order that is not on the menu Epic holds — because their menu
 * has changed, or because we have never managed to read it. It is carried by
 * name so the order survives either.
 */
type Carried = Record<string, { name: string; price: number | null; priceText: string | null }>;

/** One person, one dish: what goes to the kitchen and what shows in the basket. */
type Line = {
  itemId: string; key: string; who: string; kind: Diner['kind']; memberId: string | null; guestRef: string | null;
  name: string; price: number | null; priceText: string | null; note: string;
};
/**
 * A star belongs to a person and a plate, not to a plate (owner, 7 Sep 2026).
 *
 * Keyed `<orderItemId>:<memberId>`, because a plate for the table is eaten by
 * everybody and each of them has their own answer about it — and because the
 * phone is handed round, so one person's marks must never overwrite another's.
 */
type Marks = Record<string, { stars: number; notGreat: boolean; comment: string; concept: boolean }>;
const markKey = (orderItemId: string, memberId: string) => `${orderItemId}:${memberId}`;
const NO_MARK = { stars: 0, notGreat: false, comment: '', concept: false };

/** Ingredients that carry an allergen without naming it. A prompt, never a clearance. */
const HIDDEN: Record<string, string[]> = {
  carrot: ['soffritto', 'ragù', 'ragu', 'bolognese', 'minestrone', 'stock', 'broth', 'mirepoix', 'slaw', 'stew'],
  celery: ['soffritto', 'stock', 'broth', 'mirepoix', 'bolognese', 'ragù', 'ragu'],
  egg: ['mayonnaise', 'aioli', 'carbonara', 'meringue', 'custard', 'brioche'],
  milk: ['butter', 'cream', 'cheese', 'parmigiano', 'mozzarella', 'burrata', 'gelato', 'béchamel'],
  peanut: ['satay'],
  sesame: ['tahini', 'hummus'],
  fish: ['anchov', 'worcestershire', 'caesar', 'bisque', 'nduja'],
  gluten: ['pasta', 'bread', 'bruschetta', 'pizza', 'breadcrumb', 'flour', 'batter'],
};
const MEAT = ['prosciutto', 'ragù', 'ragu', 'bolognese', 'guanciale', 'beef', 'manzo', 'pollo', 'chicken', 'polpette', 'pork', 'bresaola', 'salame', 'ham', 'bacon', 'lamb', 'duck', 'steak', 'meat', 'carbonara'];
const FISHY = ['fish', 'tuna', 'anchov', 'crab', 'granchio', 'prawn', 'seafood', 'squid', 'octopus', 'mussel', 'clam', 'salmon', 'cod'];

const words = (item: MenuItem) => `${item.name} ${item.description ?? ''}`.toLowerCase();
/**
 * Vegetarian gets one letter after the name rather than a row per person
 * (owner, 4 Sep 2026). The menu's own mark is taken when it makes one; where it
 * says nothing, a dish with meat or fish in it is not vegetarian and a dish
 * with a description and none of either is — a dish with no description at all
 * gets no letter, because silence is not a claim.
 */
const isVeg = (item: MenuItem) => {
  if (item.vegetarian != null) return item.vegetarian;
  const text = words(item);
  if (MEAT.some((w) => text.includes(w)) || FISHY.some((w) => text.includes(w))) return false;
  return item.description ? true : null;
};
const singular = (s: string) => s.replace(/s$/, '');

type Flag = { kind: 'allergen' | 'check' | 'dislike'; who: string; text: string };

/** Only the flags that concern the people at this table, so they stay rare enough to read. */
function flagsFor(item: MenuItem, members: Member[]): Flag[] {
  const text = words(item);
  const declared = (item.allergens ?? '').toLowerCase();
  const out: Flag[] = [];
  for (const m of members) {
    const first = m.name.split(' ')[0];
    for (const a of m.allergens ?? []) {
      const term = singular(a.value.toLowerCase());
      if (declared && declared.includes(term)) { out.push({ kind: 'allergen', who: first, text: `${a.value} — the menu says so` }); continue; }
      if (text.includes(term)) { out.push({ kind: 'check', who: first, text: `${a.value} — ask` }); continue; }
      const hidden = (HIDDEN[term] ?? []).find((h) => text.includes(h));
      if (hidden) out.push({ kind: 'check', who: first, text: `${a.value}? ${hidden} — ask` });
    }
    for (const d of m.dislikes ?? []) {
      const term = singular(d.value.toLowerCase());
      const hit = text.includes(term) || (/(fish|seafood)/.test(term) && FISHY.some((w) => text.includes(w)));
      if (hit) out.push({ kind: 'dislike', who: first, text: d.value });
    }
  }
  return out;
}

const FLAG_STYLE = {
  allergen: { border: colors.allergen, bg: colors.allergenSoft, fg: colors.allergen, icon: 'allergen' as const },
  check: { border: colors.ink, bg: 'transparent', fg: colors.ink, icon: 'allergen' as const },
  dislike: { border: colors.line, bg: 'transparent', fg: colors.inkMuted, icon: 'info' as const },
};

function FlagChip({ flag }: { flag: Flag }) {
  const s = FLAG_STYLE[flag.kind];
  return (
    <View style={[styles.flag, { borderColor: s.border, backgroundColor: s.bg }]}>
      <Icon name={s.icon} size={11} color={s.fg} />
      <Text style={[styles.flagText, { color: s.fg }]}>{flag.who} · {flag.text}</Text>
    </View>
  );
}

/**
 * A face is one person wanting one dish; "Table" is a plate to share.
 *
 * A guest wears the same face with a dashed edge: they are at the table tonight
 * and gone tomorrow, and nothing they order teaches Epic anything about the
 * family's taste.
 */
function Face({ label, on, onPress, size = 30, guest = false }: { label: string; on: boolean; onPress: () => void; size?: number; guest?: boolean }) {
  return (
    <Press
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={guest ? `${label}, a guest` : label}
      style={[styles.face, { width: size, height: size, borderRadius: size / 2 }, guest && styles.faceGuest, on && styles.faceOn]}
    >
      <Text style={[styles.faceText, on && styles.faceTextOn]}>{(label[0] ?? '?').toUpperCase()}</Text>
    </Press>
  );
}

const money = (n: number) => `£${n.toFixed(2).replace(/\.00$/, '')}`;
/** "2026-09-06" is a date nobody says out loud. */
const day = (iso?: string | null) =>
  (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : '');
/** Whose plate this was, in one word: a first name, a guest's name, or the table. */
const whoHad = (i: OrderItem) => i.member?.split(' ')[0] ?? i.guest ?? 'the table';

/* --------------------------------------------------------------- the state */

export type MenuOrderCtl = ReturnType<typeof useMenuOrder>;

export function useMenuOrder({ venueRef, venueLabel, website, enabled = true }: {
  venueRef: string; venueLabel: string; website?: string | null; enabled?: boolean;
}) {
  const [menu, setMenu] = useState<ReadMenu | null | undefined>(undefined);
  const [link, setLink] = useState<MenuLink | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Why it stopped, when the reason is a ceiling rather than their menu: the
  // heading must not blame the restaurant for a limit of ours (owner, 6 Sep
  // 2026).
  const [held, setHeld] = useState(false);
  const [how, setHow] = useState<string[]>([]);
  const [household, setHousehold] = useState<HouseholdResponse | null>(null);
  const [section, setSection] = useState<string | null>(null);
  const [picks, setPicks] = useState<Picks>({});
  // Who else is at the table tonight, and the field that asks their names.
  const [guests, setGuests] = useState<Guest[]>([]);
  const [seating, setSeating] = useState(false);
  // Dishes on the order that the held menu does not list (see `Carried`).
  const [carried, setCarried] = useState<Carried>({});
  // Tonight's order, held aside while an older meal is being rated.
  const [tonight, setTonight] = useState<Order | null>(null);
  // The basket, so a tap is visibly a thing that happened (owner, 7 Sep 2026:
  // "maybe I could see it going into a basket or something, so I know it's
  // actually worked"). `added` is the line just put in, said once and faded.
  const [peek, setPeek] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [marks, setMarks] = useState<Marks>({});
  const [busy, setBusy] = useState(false);
  const [staff, setStaff] = useState(false);
  // Where the Order tab is: the order itself, the stars afterwards, what was kept.
  const [phase, setPhase] = useState<'order' | 'rate' | 'saved'>('order');
  // Whose hands the phone is in (owner, 7 Sep 2026: "I can give it to Phoenix…
  // and then I can give it to Gina"). Null is the board, where it is handed on.
  const [turn, setTurn] = useState<string | null>(null);
  // Who has had their turn, and what they said, so the board can show it.
  const [tookATurn, setTookATurn] = useState<Record<string, boolean>>({});
  // What the household's stars have added up to, per person per dish — the
  // answer to "how are you going to use them" (routes/household.js `learned`).
  const [learned, setLearned] = useState<Learned[] | null>(null);
  // An order that was already here when the drawer opened is one the table has
  // placed; the meal comes after it, so that is the only one offered "we ate
  // it" (owner, 4 Sep 2026). One being written now is still being written.
  const [resumed, setResumed] = useState(false);
  const [noting, setNoting] = useState<Record<string, boolean>>({});
  // "What's this?": a menu often gives a name in another language and nothing
  // else. Asked for one dish at a time, on a tap, and kept once written.
  const [asked, setAsked] = useState<Record<string, DishNote | 'asking' | 'failed'>>({});
  // What this household ate here before, which is both the record of the meal
  // and what a table orders from when it comes back (owner, 4 Sep 2026).
  const [history, setHistory] = useState<(Order & { visitedOn: string | null })[]>([]);
  const [again, setAgain] = useState<Record<string, boolean>>({});
  /**
   * Who is eating tonight (owner, 7 Sep 2026: "I can say who's dining, or is it
   * the same people? Do you want to add new ones?").
   *
   * It starts as whoever ate here last time, because a family coming back is
   * usually the same family; taking one person off is one tap, and it takes
   * their old plates off the order with them.
   */
  const [dining, setDining] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    api.household().then((h) => live && setHousehold(h)).catch(() => {});
    api.orderHistory(venueRef).then((d) => {
      if (!live) return;
      setHistory(d.orders);
      // Coming back, everything the household had last time is ticked: taking
      // two things off is quicker than putting six on. A guest's plate is not
      // — a guest belongs to one evening (migration 060), and assuming Kate is
      // coming again is the kind of guess that puts a stranger's dinner on
      // tonight's order. Her plates tick themselves the moment she is seated.
      setAgain(Object.fromEntries((d.orders[0]?.items ?? []).map((i) => [i.id, !i.guestId])));
      // And whoever was eating is who is eating, until somebody says otherwise.
      setDining(Object.fromEntries((d.orders[0]?.items ?? []).map((i) => i.memberId).filter(Boolean).map((id) => [id as string, true])));
    }).catch(() => {});
    api.order(venueRef).then((d) => {
      if (!live || !d.order || d.order.visitId) return;
      setOrder(d.order);
      setResumed(true);
      // The picks are what the menu draws and what saving writes, so an order
      // that came back from the server has to become picks again or editing it
      // would quietly wipe it — and the people it was for have to come back
      // with it, or a guest's dinner would have nobody to belong to.
      setGuests(d.order.guests.map((g) => ({ ref: g.ref, name: g.name })));
      const read = picksOf(d.order);
      setPicks(read.picks);
      setCarried(read.carried);
    }).catch(() => {});
    return () => { live = false; };
  }, [venueRef, enabled]);

  // The menu we hold, and where theirs is — asked again when the website
  // changes, because a place whose record was thin when the drawer opened gets
  // researched while it is open, and the answer arriving is the whole point
  // (owner, 5 Sep 2026).
  const menuFor = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    // A different place is a clean slate; the same place asked again is only
    // ever adding what we did not have, so a menu already read stays read.
    const fresh = menuFor.current !== venueRef;
    menuFor.current = venueRef;
    if (fresh) { setMenu(undefined); setLink(null); setSection(null); setError(null); }
    api.heldMenu(venueRef, website ?? null)
      .then((d) => {
        if (!live) return;
        if (fresh) { setMenu(d.menu); setLink(d.link ?? null); setSection(d.menu?.sections[0]?.title ?? null); return; }
        setMenu((held) => held ?? d.menu);
        setLink((had) => d.link ?? had);
        setSection((at) => at ?? d.menu?.sections[0]?.title ?? null);
      })
      .catch((e) => { if (live) { setMenu((held) => held ?? null); setError(e.message); } });
    return () => { live = false; };
  }, [venueRef, enabled, website]);

  const members = household?.members ?? [];
  const sections = menu?.sections ?? [];
  const shown = sections.find((s) => s.title === section) ?? sections[0];
  const itemsById = useMemo(() => {
    const map = new Map<string, MenuItem & { section: string }>();
    for (const s of sections) for (const i of s.items) map.set(i.id, { ...i, section: s.title });
    return map;
  }, [menu]);

  /** Everybody a dish can be ticked for, in the order the faces are drawn. */
  const diners = useMemo<Diner[]>(
    () => [...members.map(memberDiner), ...guests.map(guestDiner), TABLE],
    [members, guests],
  );
  const dinerOf = (key: string) => diners.find((d) => d.key === key) ?? TABLE;

  const pickOf = (itemId: string, key: string): Pick => picks[itemId]?.[key] ?? { on: false, note: '' };
  const setPick = (itemId: string, key: string, next: Partial<Pick>) =>
    setPicks((p) => ({ ...p, [itemId]: { ...(p[itemId] ?? {}), [key]: { ...pickOf(itemId, key), ...next } } }));

  /** Who has this dish, so the row can give each of them their own note. */
  const onThis = (itemId: string) => diners.filter((d) => pickOf(itemId, d.key).on);

  /**
   * One person, one dish — the shape the basket draws and the kitchen is sent.
   * Walked in menu order rather than in the order things were tapped, so the
   * basket reads like the menu and does not reshuffle itself as it fills.
   */
  const linesFrom = (from: Picks, who: Diner[] = diners, extra: Carried = carried): Line[] => {
    const lines: Line[] = [];
    const push = (itemId: string, dish: { name: string; price: number | null; priceText: string | null }) => {
      const at = from[itemId];
      if (!at) return;
      for (const d of who) {
        const p = at[d.key];
        if (!p?.on) continue;
        lines.push({
          itemId, key: d.key, who: d.name, kind: d.kind, memberId: d.memberId, guestRef: d.guestRef,
          name: dish.name, price: dish.price, priceText: dish.priceText, note: p.note ?? '',
        });
      }
    };
    for (const [itemId, item] of itemsById) push(itemId, { name: item.name, price: item.price ?? null, priceText: item.priceText ?? null });
    // Then the dishes that are not on the menu we hold. A plate ordered last
    // time is still a plate whether or not their menu still lists it — and at a
    // place whose menu Epic has never read, it is every plate there is.
    for (const [itemId, dish] of Object.entries(extra)) if (!itemsById.has(itemId)) push(itemId, dish);
    return lines;
  };
  const chosen = useMemo(() => linesFrom(picks), [picks, itemsById, diners, carried]);
  const total = chosen.reduce((n, r) => n + (r.price ?? 0), 0);

  /**
   * An order from the server, read back into picks: the inverse of `linesFrom`.
   *
   * A row with no menu item behind it — a dish typed at a place whose menu Epic
   * has never read, or one their menu no longer lists — is carried by its own
   * name so that editing the order cannot quietly drop it.
   */
  function picksOf(from: Order): { picks: Picks; carried: Carried } {
    const next: Picks = {};
    const kept: Carried = {};
    for (const i of from.items) {
      const id = i.menuItemId && itemsById.has(i.menuItemId) ? i.menuItemId : `past:${i.id}`;
      if (!itemsById.has(id)) kept[id] = { name: i.name, price: i.price ?? null, priceText: i.priceText ?? null };
      const key = keyOf(i.memberId, i.guestRef);
      next[id] = { ...(next[id] ?? {}), [key]: { on: true, note: i.note ?? '' } };
    }
    return { picks: next, carried: kept };
  }

  /**
   * Somebody else at the table. Written straight away, because a guest added
   * before anything is ordered is still a guest, and a name typed into a phone
   * that forgets it on the next screen was never worth typing.
   */
  async function addGuest(name: string, ref?: string) {
    const first = name.trim().slice(0, 40);
    if (!first) return;
    // Somebody who was here before keeps the id they had, so the plates they
    // ordered last time are still theirs when they are seated again.
    const guest = { ref: ref ?? `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: first };
    if (guests.some((g) => g.ref === guest.ref)) return;
    const next = [...guests, guest];
    setGuests(next);
    setBusy(true);
    try { await writeOrder(picks, next); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  /** They have gone home, or were a typo. Their dishes go with them. */
  async function removeGuest(ref: string) {
    const next = guests.filter((g) => g.ref !== ref);
    const key = `g:${ref}`;
    const clean: Picks = Object.fromEntries(
      Object.entries(picks).map(([itemId, at]) => [itemId, Object.fromEntries(Object.entries(at).filter(([k]) => k !== key))]),
    );
    setGuests(next);
    setPicks(clean);
    setBusy(true);
    try { await writeOrder(clean, next); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  /**
   * A dish ticked for one person, and said out loud.
   *
   * The basket line is announced rather than the count changing quietly: the
   * owner asked to be able to see that a tap worked, and a number going from 3
   * to 4 in the corner is not that.
   */
  function togglePick(itemId: string, key: string) {
    const now = pickOf(itemId, key);
    setPick(itemId, key, { on: !now.on });
    const d = dinerOf(key);
    const item = itemsById.get(itemId);
    setAdded(!now.on && item ? `${d.kind === 'table' ? 'For the table' : d.name} · ${item.name}` : null);
  }

  async function readTheMenu() {
    setReading(true); setError(null); setHeld(false); setHow([]);
    try {
      const d = await api.readMenu({ ref: venueRef, label: venueLabel, website: website ?? undefined, url: link?.url ?? undefined });
      setMenu(d.menu); setSection(d.menu.sections[0]?.title ?? null); setHow(d.menu.how ?? []);
    } catch (e: any) {
      setError(e.message || 'Their menu would not open.');
      setHeld(e?.code === 'model_budget_reached' || e?.code === 'spend_bound_reached');
      setHow(e.body?.how ?? []);
    } finally {
      setReading(false);
    }
  }

  async function writeOrder(from: Picks = picks, who: Guest[] = guests, extra: Carried = carried) {
    const seated = [...members.map(memberDiner), ...who.map(guestDiner), TABLE];
    /**
     * A meal that has become a visit is history and is never written over.
     *
     * It can be *loaded* — that is how a past meal gets its stars (§13.16) —
     * and from there a tap on the menu is somebody starting tonight's dinner,
     * not editing last week's. Dropping the client id makes the next save a new
     * order rather than a rewrite of the one the visit hangs off.
     */
    const writing = order?.visitId ? null : order;
    const d = await api.saveOrder({
      clientId: writing?.clientId ?? undefined,
      ref: venueRef,
      label: venueLabel,
      menuId: menu?.id ?? null,
      guests: who,
      items: linesFrom(from, seated, extra).map((l) => ({
        menuItemId: l.itemId.startsWith('past:') ? null : l.itemId, memberId: l.memberId, guestRef: l.guestRef,
        name: l.name, priceText: l.priceText, note: l.note || null,
      })),
    });
    setOrder(d.order);
    // Read straight back: the rows the server just wrote have ids of their own,
    // and a dish carried by name (`Carried`) has to be keyed by the row it is
    // now, or taking it off the order later would find nothing to take off.
    const read = picksOf(d.order);
    setPicks(read.picks);
    setCarried(read.carried);
    return d.order;
  }

  async function toTheOrder() {
    setBusy(true);
    try { await writeOrder(); setPhase('order'); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  /** Take one plate off the order — one person's, not everybody's. */
  async function dropLine(itemId: string, key: string) {
    const next: Picks = { ...picks, [itemId]: { ...(picks[itemId] ?? {}), [key]: { ...pickOf(itemId, key), on: false } } };
    setPicks(next);
    setAdded(null);
    setBusy(true);
    try { await writeOrder(next); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  /** Which pick a row on the order came from — a menu dish, or one carried by name. */
  const pickIdOf = (item: OrderItem) =>
    (item.menuItemId && itemsById.has(item.menuItemId) ? item.menuItemId : `past:${item.id}`);

  /** The same, from the order itself, where a row already knows whose it is. */
  async function removeFromOrder(item: OrderItem) {
    await dropLine(pickIdOf(item), keyOf(item.memberId, item.guestRef));
  }

  /**
   * A word for the waiter, changed on the order rather than back on the menu.
   * It belongs to this person's plate, so changing Gina's leaves Roger's alone.
   */
  async function noteOnOrder(item: OrderItem, note: string) {
    const id = pickIdOf(item);
    const key = keyOf(item.memberId, item.guestRef);
    const next: Picks = {
      ...picks,
      [id]: { ...(picks[id] ?? {}), [key]: { ...pickOf(id, key), note } },
    };
    setPicks(next);
    try { await writeOrder(next); } catch (e: any) { setError(e.message); }
  }

  /** The table changed its mind: the order in progress goes, the menu stays. */
  async function startAgain() {
    setBusy(true);
    try {
      if (order && !order.visitId) await api.clearOrder(order.id);
      setOrder(null); setPicks({}); setGuests([]); setMarks({}); setResumed(false); setPhase('order');
      setAdded(null); setPeek(false); setTurn(null); setTookATurn({}); setCarried({});
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  /**
   * What one person ate: their own plates, and everything the table shared.
   *
   * A plate for the middle of the table is eaten by all of them, so it is
   * offered to each of them in turn and each gets their own answer about it —
   * which is also the only way a shared plate could ever be rated at all.
   */
  const platesFor = (memberId: string): OrderItem[] =>
    (order?.items ?? []).filter((i) => i.memberId === memberId || (!i.memberId && !i.guestId));

  /**
   * Who is handed the phone: everybody with a plate of their own.
   *
   * If the whole order was for the middle of the table, everybody in the
   * household who was there gets a turn instead — otherwise a shared meal
   * would have nobody to rate it.
   */
  const raters = useMemo(() => {
    const own = new Set((order?.items ?? []).map((i) => i.memberId).filter(Boolean) as string[]);
    return own.size ? members.filter((m) => own.has(m.id)) : members;
  }, [order, members]);

  /** Stars already given, so coming back to a meal shows what was said before. */
  function marksOf(from: Order): Marks {
    const next: Marks = {};
    for (const i of from.items) {
      for (const r of i.ratings ?? []) {
        if (!r.memberId) continue;
        next[markKey(i.id, r.memberId)] = {
          stars: r.score ?? 0,
          notGreat: r.take === 'not_for_me',
          comment: r.comment ?? '',
          concept: Boolean(i.concept),
        };
      }
    }
    return next;
  }

  const markOf = (orderItemId: string, memberId: string) => marks[markKey(orderItemId, memberId)] ?? NO_MARK;
  const setMark = (orderItemId: string, memberId: string, next: Partial<Marks[string]>) =>
    setMarks((s) => ({ ...s, [markKey(orderItemId, memberId)]: { ...markOf(orderItemId, memberId), ...next } }));

  /**
   * "Rate the meal" (owner, 7 Sep 2026: "what I'd like is an actual call to
   * action, like 'Rate the meal', that I can give to Phoenix").
   *
   * The meal becomes a visit here, because the stars hang off the visit — and
   * it is dated from the order rather than from now, so a table rated over
   * breakfast is still recorded as having eaten last night.
   */
  async function rateTheMeal() {
    if (!order) return;
    setBusy(true);
    try {
      const ate = new Set(order.items.map((i) => i.memberId).filter(Boolean) as string[]);
      const d = order.visitId ? { order } : await api.orderEaten(order.id, {
        visitedOn: (order.createdAt ?? '').slice(0, 10) || undefined,
        attendeeIds: ate.size ? [...ate] : undefined,
      });
      setOrder(d.order);
      setMarks(marksOf(d.order));
      setTookATurn(Object.fromEntries((d.order.items.flatMap((i) => i.ratings ?? [])).map((r) => [r.memberId, true])));
      setPhase('rate');
      setTurn(null);
      api.learned().then((l) => setLearned(l.learned)).catch(() => {});
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  /** Hand it over. Nobody sees anybody else's plates on their turn. */
  const handTo = (memberId: string) => { setTurn(memberId); setError(null); };

  /**
   * One person's turn is over: what they said is written now rather than at the
   * end, so a phone put down halfway round the table keeps what it was given.
   */
  async function finishTurn() {
    if (!order || !turn) return;
    const memberId = turn;
    setBusy(true);
    try {
      const d = await api.rateOrder(order.id, platesFor(memberId).map((i) => {
        const m = markOf(i.id, memberId);
        return {
          orderItemId: i.id,
          memberId,
          score: m.stars || null,
          notGreat: m.notGreat,
          comment: m.comment || null,
          conceptKey: m.concept ? i.conceptSuggestion?.key ?? null : null,
        };
      }));
      setOrder(d.order);
      setTookATurn((t) => ({ ...t, [memberId]: true }));
      setTurn(null);
      api.learned().then((l) => setLearned(l.learned)).catch(() => {});
      api.orderHistory(venueRef).then((h) => setHistory(h.orders)).catch(() => {});
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  /**
   * A meal that is already in the history, opened to be rated.
   *
   * The order at a place stops being "the order" the moment it becomes a
   * visit, which left a meal that was eaten before anybody starred it with no
   * way back to the stars at all — you could only ever rate in the one sitting
   * where you said you had eaten it. This is that way back, and it is also how
   * somebody who was not at the table when the phone went round gets their go.
   */
  function rateThatMeal(meal: Order) {
    // Whatever was being written for tonight, so that going back to rating an
    // old meal is not a way to lose it.
    setTonight(order?.visitId ? null : order);
    setOrder(meal);
    setGuests(meal.guests.map((g) => ({ ref: g.ref, name: g.name })));
    setMarks(marksOf(meal));
    setTookATurn(Object.fromEntries(meal.items.flatMap((i) => i.ratings ?? []).map((r) => [r.memberId, true])));
    setPhase('rate');
    setTurn(null);
    setError(null);
    api.learned().then((l) => setLearned(l.learned)).catch(() => {});
  }

  /** Everybody has had a go. */
  function finishRating() {
    setPhase('saved');
    api.orderHistory(venueRef).then((h) => setHistory(h.orders)).catch(() => {});
  }

  /** Back to what was being ordered before an old meal was opened to rate it. */
  function backToTonight() {
    if (!tonight) return;
    setOrder(tonight);
    const read = picksOf(tonight);
    setPicks(read.picks);
    setCarried(read.carried);
    setGuests(tonight.guests.map((g) => ({ ref: g.ref, name: g.name })));
    setTonight(null);
    setPhase('order');
    setTurn(null);
  }

  /**
   * The same again: last time's order becomes this one, minus anything unticked.
   *
   * Anybody who was a guest that night comes back with the dishes that are still
   * ticked and nobody else — a table of six last time should not seat four
   * strangers tonight because their name was on an old order.
   */
  async function orderAgain(from: Order) {
    const byName = (name: string) => [...itemsById.values()].find((i) => i.name.toLowerCase() === name.toLowerCase());
    const next: Picks = {};
    const kept: Carried = {};
    const seatedRefs = new Set<string>();
    for (const i of from.items) {
      if (!again[i.id]) continue;
      // The same dish on the menu we hold, or the dish as it was written down
      // that night. A menu Epic has never read is not a reason to refuse to
      // order what you had last time.
      const id = (i.menuItemId && itemsById.has(i.menuItemId) ? i.menuItemId : byName(i.name)?.id) ?? `past:${i.id}`;
      if (!itemsById.has(id)) kept[id] = { name: i.name, price: i.price ?? null, priceText: i.priceText ?? null };
      if (i.guestRef) seatedRefs.add(i.guestRef);
      next[id] = { ...(next[id] ?? {}), [keyOf(i.memberId, i.guestRef)]: { on: true, note: i.note ?? '' } };
    }
    // Whoever is at the table now: the guests seated on the way in, not the
    // ones who happened to be here the last time (owner, 7 Sep 2026).
    const who = guests.length ? guests : from.guests.filter((g) => seatedRefs.has(g.ref)).map((g) => ({ ref: g.ref, name: g.name }));
    setPicks(next);
    setCarried(kept);
    setGuests(who);
    setBusy(true);
    try {
      await writeOrder(next, who, kept);
      setResumed(false);
      setPhase('order');
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function whatIsThis(item: MenuItem) {
    if (asked[item.id]) { setAsked(({ [item.id]: _drop, ...rest }) => rest); return; }   // tapping again folds it away
    setAsked((a) => ({ ...a, [item.id]: 'asking' }));
    try {
      const d = await api.dishNote(item.name, venueLabel);
      setAsked((a) => ({ ...a, [item.id]: d.dish }));
    } catch {
      setAsked((a) => ({ ...a, [item.id]: 'failed' }));
    }
  }

  /**
   * The order, by whose plate it is: the family, then tonight's guests, then
   * what everybody shares. A person with nothing on the order still gets a
   * heading, so an empty one reads as "nothing for Gina yet" rather than as
   * Gina not being here; the table only appears when there is something on it.
   */
  const groups = useMemo(() => {
    const list = order?.items ?? [];
    return [TABLE, ...members.map(memberDiner), ...guests.map(guestDiner)]
      .map((d) => ({ ...d, items: list.filter((i) => keyOf(i.memberId, i.guestRef) === d.key) }))
      .filter((g) => g.items.length || g.kind !== 'table');
  }, [order, members, guests]);

  const allergenLines = members.flatMap((m) => (m.allergens ?? []).map((a) => `${m.name.split(' ')[0]} is allergic to ${a.value.toLowerCase()}.`));
  const dietLines = members.flatMap((m) => (m.diets ?? []).map((d) => `${m.name.split(' ')[0]} is ${d.value.toLowerCase()}.`));

  return {
    venueRef, venueLabel, menu, link, reading, error, held, how, members, sections, shown, section, setSection, itemsById,
    picks, pickOf, setPick, togglePick, onThis, diners, guests, seating, setSeating, addGuest, removeGuest,
    peek, setPeek, added, chosen, total, dropLine, order, resumed, marks, setMarks, markOf, setMark, busy, staff, setStaff, phase, setPhase,
    noting, setNoting, asked, groups, allergenLines, dietLines, history, again, setAgain,
    turn, setTurn, tookATurn, raters, platesFor, learned, handTo, finishTurn, finishRating, rateTheMeal, rateThatMeal,
    dining, setDining, tonight, backToTonight,
    readTheMenu, toTheOrder, removeFromOrder, noteOnOrder, startAgain, whatIsThis, orderAgain,
  };
}

/* ---------------------------------------------------------------- the menu */

/**
 * Who is at this table tonight (owner, 7 Sep 2026).
 *
 * The household is a line of names, because Epic already knows them. A guest is
 * a name somebody types, one at a time, and stays only for this meal — so the
 * control says what that means rather than leaving somebody to wonder whether
 * they have just added a person to the family.
 */
function WhoIsHere({ ctl }: { ctl: MenuOrderCtl }) {
  const [name, setName] = useState('');
  const add = async () => {
    const first = name.trim();
    if (!first) return;
    setName('');
    await ctl.addGuest(first);
  };
  return (
    <View style={styles.who}>
      <Row style={{ flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <Icon name="household" size={15} color={colors.inkMuted} />
        <Text style={[type.tiny, { flexShrink: 1 }]}>{ctl.members.map((m) => m.name.split(' ')[0]).join(', ') || 'Just you'}</Text>
        {ctl.guests.map((g) => (
          <Chip key={g.ref} label={g.name} icon="person" onRemove={() => ctl.removeGuest(g.ref)} />
        ))}
        <Chip
          label={ctl.seating ? 'Done' : ctl.guests.length ? 'Add another' : 'Add other guests'}
          icon={ctl.seating ? 'check' : 'addPerson'}
          selected={ctl.seating}
          onPress={() => ctl.setSeating(!ctl.seating)}
        />
      </Row>
      {ctl.seating ? (
        <View style={{ gap: 6 }}>
          <Row>
            <TextInput
              value={name}
              onChangeText={setName}
              autoFocus
              placeholder="their first name"
              placeholderTextColor={colors.inkFaint}
              onSubmitEditing={add}
              returnKeyType="done"
              style={[styles.noteInput, { flex: 1 }]}
              accessibilityLabel="A guest's first name"
            />
            <Button label="Add" icon="add" onPress={add} disabled={!name.trim() || ctl.busy} />
          </Row>
          <Text style={type.tiny}>
            A first name is enough. They get a face on every dish and their own word for the waiter; they are here for this
            meal only, and nothing they order changes what Epic knows about your family's taste.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The basket, opened out (owner, 7 Sep 2026: "maybe I could see it going into a
 * basket or something, so I know it's actually worked").
 *
 * One row per person per dish, with what they asked for underneath, and each
 * one removable on its own — so two of the same dish are visibly two things and
 * taking one back does not take the other with it.
 */
function BasketPeek({ ctl }: { ctl: MenuOrderCtl }) {
  return (
    <View style={styles.peek}>
      <ScrollView style={{ maxHeight: 190 }} contentContainerStyle={{ padding: spacing.sm, gap: 2 }}>
        {ctl.chosen.map((l) => (
          <Row key={`${l.itemId}:${l.key}`} style={{ alignItems: 'center' }}>
            {l.kind === 'table'
              ? <Icon name="household" size={15} color={colors.inkMuted} />
              : <Face label={l.who} on size={22} guest={l.kind === 'guest'} onPress={() => {}} />}
            <View style={{ flex: 1 }}>
              <Text style={type.small}>{l.name}</Text>
              {l.note ? <Text style={type.tiny}>{l.note}</Text> : null}
            </View>
            <Text style={type.tiny}>{l.priceText ?? ''}</Text>
            <Press
              onPress={() => ctl.dropLine(l.itemId, l.key)}
              disabled={ctl.busy}
              accessibilityRole="button"
              accessibilityLabel={`Take ${l.who === 'For the table' ? 'the table' : l.who}'s ${l.name} out of the basket`}
              style={styles.rowBtn}
            >
              <Icon name="close" size={14} color={colors.inkMuted} />
            </Press>
          </Row>
        ))}
      </ScrollView>
    </View>
  );
}

/* -------------------------------------------------- the phone, going round */

/**
 * Where the phone is handed on (owner, 7 Sep 2026: "I can give it to Phoenix…
 * and then I can give it to Gina").
 *
 * One row per person who ate, with what they have already said. A guest is not
 * on it: there is nowhere to put a guest's stars, because Epic only learns from
 * the household's own palate.
 */
function RatingBoard({ ctl, footer }: { ctl: MenuOrderCtl; footer?: React.ReactNode }) {
  const { order, raters, tookATurn, busy } = ctl;
  if (!order) return null;
  const guests = [...new Set(order.items.filter((i) => i.guestId).map((i) => i.guest ?? ''))].filter(Boolean);
  const left = raters.filter((m) => !tookATurn[m.id]).length;
  return (
    <>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={type.h3}>Pass the phone round</Text>
        <Text style={type.small}>
          Give it to each of them in turn. They see their own plates and nothing else of yours, star whatever they would
          have again, and hand it back.
        </Text>
        {raters.map((m) => {
          const first = m.name.split(' ')[0];
          const plates = ctl.platesFor(m.id);
          const stars = plates.filter((i) => (i.ratings ?? []).some((r) => r.memberId === m.id && r.score)).length;
          const said = Boolean(tookATurn[m.id]);
          return (
            <Press
              key={m.id}
              onPress={() => ctl.handTo(m.id)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={said ? `${first} has rated their meal — go again` : `Give the phone to ${first}`}
              style={[styles.handRow, said && styles.handRowDone]}
            >
              {/* Filled in once they have had their turn, so the board can be
                  read across a table at a glance. */}
              <View style={[styles.face, { width: 40, height: 40, borderRadius: 20 }, said && styles.faceOn]}>
                <Text style={[styles.faceText, said && styles.faceTextOn, { fontSize: 16 }]}>{first[0]?.toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={type.h3}>{first}</Text>
                <Text style={type.tiny}>
                  {plates.length} {plates.length === 1 ? 'plate' : 'plates'}
                  {said ? ` · ${stars ? `starred ${stars}` : 'nothing starred, so all fine'}` : ''}
                </Text>
              </View>
              {said
                ? <Icon name="check" size={20} color={colors.accent} />
                : <Chip label="Give it to them" icon="forward" />}
            </Press>
          );
        })}
        {guests.length ? (
          <Text style={type.tiny}>
            {guests.join(' and ')} {guests.length === 1 ? 'was a guest, so that plate is' : 'were guests, so those plates are'} not
            rated — Epic only learns your family's taste.
          </Text>
        ) : null}
        {ctl.error ? <Text style={[type.tiny, { color: colors.allergen }]}>{ctl.error}</Text> : null}
        {footer}
      </ScrollView>
      <View style={styles.bar}>
        <Button
          label={ctl.tonight ? "Tonight's order" : 'The order'}
          icon="back"
          kind="ghost"
          style={styles.barBtn}
          onPress={() => (ctl.tonight ? ctl.backToTonight() : ctl.setPhase('order'))}
          disabled={busy}
        />
        <View style={{ flex: 1, alignItems: 'center' }}>
          {left ? <Text style={type.tiny}>{left} still to go</Text> : null}
        </View>
        <Button label="That's everyone" icon="check" style={styles.barBtn} onPress={ctl.finishRating} disabled={busy} />
      </View>
    </>
  );
}

/**
 * One person's meal, in their hands.
 *
 * Their own plates and whatever the table shared, and nothing anybody else had.
 * The rating rule is the owner's and stays sparse (4 Sep 2026): stars mean
 * good, a plate left alone counts as fine and writes nothing at all, and "not
 * great" is one tap that only then asks why.
 */
function Turn({ ctl, memberId, footer }: { ctl: MenuOrderCtl; memberId: string; footer?: React.ReactNode }) {
  const { order, busy, venueLabel } = ctl;
  const member = ctl.members.find((m) => m.id === memberId);
  const first = member?.name.split(' ')[0] ?? 'Your';
  const plates = ctl.platesFor(memberId);
  const starred = plates.filter((i) => ctl.markOf(i.id, memberId).stars).length;
  const bad = plates.filter((i) => ctl.markOf(i.id, memberId).notGreat).length;
  if (!order) return null;
  return (
    <>
      <ScrollView contentContainerStyle={styles.body}>
        <Row style={{ alignItems: 'center' }}>
          <View style={[styles.face, styles.faceOn, { width: 44, height: 44, borderRadius: 22 }]}>
            <Text style={[styles.faceText, styles.faceTextOn, { fontSize: 18 }]}>{first[0]?.toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={type.h2}>{first}</Text>
            <Text style={type.small}>{venueLabel ? `your dinner at ${venueLabel}` : 'your dinner'}</Text>
          </View>
        </Row>
        <Card>
          <Text style={type.small}>
            <Text style={{ fontWeight: '700' }}>Star anything you would have again.</Text> Leave the rest alone — that means it
            was fine, which is the answer for most plates. Say so only when it was not.
          </Text>
        </Card>
        {plates.map((i) => {
          const m = ctl.markOf(i.id, memberId);
          const set = (next: Partial<typeof m>) => ctl.setMark(i.id, memberId, next);
          const shared = !i.memberId;
          return (
            <View key={i.id} style={styles.row}>
              <Row style={{ alignItems: 'center' }}>
                <Text style={[type.body, { flex: 1, fontWeight: '700' }]}>{i.name}</Text>
                {shared ? <Text style={type.tiny}>shared</Text> : null}
              </Row>
              {i.note ? <Text style={type.tiny}>{i.note}</Text> : null}
              <Row style={{ gap: spacing.md, flexWrap: 'wrap' }}>
                <Row style={{ gap: 3 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Press key={n} onPress={() => set({ stars: m.stars === n ? 0 : n, notGreat: false })}
                      accessibilityRole="button" accessibilityLabel={`${n} star${n > 1 ? 's' : ''} for ${i.name}`} hitSlop={6}>
                      <Icon name="favourite" size={30} fill={m.stars >= n} color={m.stars >= n ? colors.rating : colors.inkFaint} />
                    </Press>
                  ))}
                </Row>
                <Chip label="Not great" icon="close" selected={m.notGreat} onPress={() => set({ notGreat: !m.notGreat, stars: 0 })} />
              </Row>
              {m.stars || m.notGreat ? (
                <>
                  <TextInput
                    value={m.comment}
                    onChangeText={(t) => set({ comment: t })}
                    placeholder={m.notGreat ? 'what was wrong with it?' : 'what made it good?'}
                    placeholderTextColor={colors.inkFaint}
                    style={[styles.noteInput, { flex: 1, width: '100%' }]}
                    accessibilityLabel={`A word about ${i.name}`}
                  />
                  {/*
                    A star on a plate is a star on the dish itself, and that is
                    what Epic plans from — so a menu's own words are matched to
                    the family's ("Spaghettoni al Ragù" → bolognese) on a tap,
                    never silently (Epic 2 C7).
                  */}
                  {i.conceptSuggestion ? (
                    <Chip
                      label={`This is ${i.conceptSuggestion.label.toLowerCase()}`}
                      icon={m.concept ? 'check' : 'add'}
                      selected={m.concept}
                      onPress={() => set({ concept: !m.concept })}
                    />
                  ) : i.concept ? (
                    <Text style={type.tiny}>→ {i.concept.label}, so it counts everywhere</Text>
                  ) : null}
                </>
              ) : null}
            </View>
          );
        })}
        {ctl.error ? <Text style={[type.tiny, { color: colors.allergen }]}>{ctl.error}</Text> : null}
        {footer}
      </ScrollView>
      <View style={styles.bar}>
        <View style={{ flex: 1 }}>
          <Text style={type.body}>{starred} starred · {bad} not great</Text>
          <Text style={type.tiny}>{plates.length - starred - bad} left as fine</Text>
        </View>
        <Button label="Done — pass it back" icon="check" style={styles.barBtn} onPress={ctl.finishTurn} disabled={busy} />
      </View>
    </>
  );
}

/**
 * The table, before the order (owner, 7 Sep 2026).
 *
 * Coming back to a place asks one question first — is it the same people? —
 * and answers it with last time's table already laid: the household who ate
 * here, and the guests who were with them offered by name. Taking a person off
 * takes their old plates off the order; seating a guest again brings hers back,
 * because she keeps the id she had (`addGuest(name, ref)`).
 */
function WhosEating({ ctl, last }: { ctl: MenuOrderCtl; last: Order & { visitedOn: string | null } }) {
  const [name, setName] = useState('');
  const seated = (ref: string) => ctl.guests.some((g) => g.ref === ref);
  const platesOf = (key: string) => last.items.filter((i) => keyOf(i.memberId, i.guestRef) === key);

  /** On, and their plates come back; off, and they go with them. */
  const toggleMember = (id: string) => {
    const on = !ctl.dining[id];
    ctl.setDining((d) => ({ ...d, [id]: on }));
    const theirs = platesOf(`m:${id}`);
    if (theirs.length) ctl.setAgain((a) => ({ ...a, ...Object.fromEntries(theirs.map((i) => [i.id, on])) }));
  };
  const toggleGuest = async (g: { ref: string; name: string }) => {
    const theirs = platesOf(`g:${g.ref}`);
    if (seated(g.ref)) {
      ctl.setAgain((a) => ({ ...a, ...Object.fromEntries(theirs.map((i) => [i.id, false])) }));
      await ctl.removeGuest(g.ref);
    } else {
      ctl.setAgain((a) => ({ ...a, ...Object.fromEntries(theirs.map((i) => [i.id, true])) }));
      await ctl.addGuest(g.name, g.ref);
    }
  };
  const add = async () => {
    const first = name.trim();
    if (!first) return;
    setName('');
    await ctl.addGuest(first);
  };

  const coming = ctl.members.filter((m) => ctl.dining[m.id]).length + ctl.guests.length;
  return (
    <Card>
      <Text style={type.h3}>Who is eating tonight?</Text>
      <Text style={type.tiny}>
        {coming ? `${coming} at the table` : 'Nobody yet'} · tap a face to take somebody off, and their plates come off with them.
      </Text>
      <Row style={{ flexWrap: 'wrap', gap: 6 }}>
        {ctl.members.map((m) => (
          <Face key={m.id} label={m.name.split(' ')[0]} on={!!ctl.dining[m.id]} onPress={() => toggleMember(m.id)} size={34} />
        ))}
      </Row>
      {/* Last time's guests, by name, and never assumed. */}
      {last.guests.length || ctl.guests.length ? (
        <Wrap>
          {last.guests.map((g) => (
            <Chip
              key={g.ref}
              label={g.name}
              icon={seated(g.ref) ? 'check' : 'addPerson'}
              selected={seated(g.ref)}
              onPress={() => toggleGuest(g)}
            />
          ))}
          {ctl.guests.filter((g) => !last.guests.some((o) => o.ref === g.ref)).map((g) => (
            <Chip key={g.ref} label={g.name} icon="person" selected onRemove={() => ctl.removeGuest(g.ref)} />
          ))}
        </Wrap>
      ) : null}
      {ctl.seating ? (
        <Row>
          <TextInput
            value={name}
            onChangeText={setName}
            autoFocus
            placeholder="their first name"
            placeholderTextColor={colors.inkFaint}
            onSubmitEditing={add}
            returnKeyType="done"
            style={[styles.noteInput, { flex: 1 }]}
            accessibilityLabel="A guest's first name"
          />
          <Button label="Add" icon="add" onPress={add} disabled={!name.trim() || ctl.busy} />
        </Row>
      ) : null}
      <Wrap>
        <Chip
          label={ctl.seating ? 'Done' : last.guests.length ? 'Somebody else' : 'Add other guests'}
          icon={ctl.seating ? 'check' : 'addPerson'}
          selected={ctl.seating}
          onPress={() => ctl.setSeating(!ctl.seating)}
        />
      </Wrap>
    </Card>
  );
}

export function MenuPanel({ ctl, onOrder }: { ctl: MenuOrderCtl; onOrder: () => void }) {
  const { menu, link, reading, error, held, members, how, sections, shown, chosen, total, asked } = ctl;
  // Opening the Menu tab is the household asking for the menu: read it, rather
  // than offering a button that says so (owner, 4 Sep 2026 — "I shouldn't even
  // have to click Read the menu because I'm clicking on the menu tab"). Once
  // per venue; if it fails, the button comes back as a way to try again.
  const tried = useRef(false);
  useEffect(() => { tried.current = false; }, [ctl.venueRef]);
  useEffect(() => {
    if (menu === null && !reading && !error && !tried.current) { tried.current = true; ctl.readTheMenu(); }
  }, [menu, reading, error]);
  return (
    <>
      <ScrollView contentContainerStyle={styles.body}>
        {menu === undefined ? <Text style={type.small}>Looking for the menu we hold…</Text> : null}

        {menu === null ? (
          <Card>
            {/* A ceiling of ours is not their menu failing, and the heading is
                the first thing read (owner, 6 Sep 2026). */}
            <Text style={type.h3}>{reading ? 'Reading their menu…' : held ? 'Not until the budget is raised' : error ? 'Their menu would not open' : 'Their menu'}</Text>
            {reading ? (
              <Row><ActivityIndicator color={colors.icon} /><Text style={type.small}>{link?.url ? `From ${link.url.replace(/^https?:\/\//, '').slice(0, 48)}` : 'Looking on their website…'}</Text></Row>
            ) : null}
            {!reading && !error && !link?.url ? <Text style={type.small}>{link?.why ?? 'Looking on their website…'}</Text> : null}
            {how.length ? <Text style={type.tiny}>{how.join(' · ')}</Text> : null}
            {error ? <Text style={[type.small, { color: colors.allergen }]}>{error}</Text> : null}
            {!reading && error ? (
              <Wrap>
                <Button label="Try again" icon="restaurant" onPress={ctl.readTheMenu} />
                {/* We know where their menu is even when we cannot read it: a
                    link beats a dead end (owner, 4 Sep 2026). */}
                {link?.url ? <Button label="Open their menu" icon="external" kind="secondary" onPress={() => Linking.openURL(link.url!)} /> : null}
              </Wrap>
            ) : null}
          </Card>
        ) : null}

        {menu ? (
          <>
            {/*
              Two ways to the same menu (owner, 5 Sep 2026): "their menu on their
              website" and "their menu digitised in a standardised format, like
              our own digital copy that we will use to let people then go through
              and create their own order".

              Both are named, and which one you are looking at is said out loud —
              because they are not the same thing and can disagree. Ours is what
              Epic read on a date, in one shape whatever the restaurant published;
              theirs is whatever is on their site this minute. When a price
              matters, the honest answer is "we read this on the 4th, go and look".
            */}
            <View style={styles.twoWays}>
              <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                <Text style={type.small}>Epic's copy</Text>
                <Text style={type.tiny}>
                  {menu.items} {menu.items === 1 ? 'dish' : 'dishes'}, tap a face to order
                  {menu.stale ? ` · read ${menu.ageDays} days ago` : ''}
                </Text>
              </View>
              <Button
                label="On their site"
                icon="external"
                kind="secondary"
                onPress={() => Linking.openURL(link?.url ?? menu.sourceUrl)}
              />
            </View>
            <WhoIsHere ctl={ctl} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
              {sections.map((s) => (
                <Chip key={s.title} label={s.title} selected={s.title === shown?.title} onPress={() => ctl.setSection(s.title)} />
              ))}
            </ScrollView>
            {shown?.note ? <Text style={type.tiny}>{shown.note}</Text> : null}
            <Text style={type.tiny}>(V) is vegetarian.{ctl.dietLines.length ? ` ${ctl.dietLines.join(' ')}` : ''}</Text>
            {shown?.items.map((item) => {
              const flags = flagsFor(item, members);
              const having = ctl.onThis(item.id);
              const note = asked[item.id];
              return (
                <View key={item.id} style={[styles.row, having.length > 0 && styles.rowPicked]}>
                  <Row style={{ alignItems: 'center' }}>
                    <Text style={[type.body, styles.itemName]}>
                      {item.name}
                      {isVeg(item) ? <Text style={styles.veg}> (V)</Text> : null}
                    </Text>
                    <Text style={styles.price}>{item.priceText ?? ''}</Text>
                    <Press
                      onPress={() => ctl.whatIsThis(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`What is ${item.name}?`}
                      style={styles.rowBtn}
                    >
                      <Icon name="info" size={14} color={note ? colors.icon : colors.inkMuted} />
                    </Press>
                  </Row>
                  {item.description ? <Text style={type.small}>{item.description}</Text> : null}
                  {note ? (
                    <View style={styles.whatIs}>
                      {note === 'asking' ? <Text style={type.tiny}>Looking it up…</Text> : null}
                      {note === 'failed' ? <Text style={type.tiny}>Could not look that one up just now.</Text> : null}
                      {typeof note === 'object' ? (
                        <>
                          <Text style={type.small}>{note.known ? note.what : `Not a dish Epic knows — ask at the table. ${note.what}`}</Text>
                          {note.origin ? <Text style={type.tiny}>{note.origin}</Text> : null}
                          <Text style={type.tiny}>Epic's own words about the dish, not the restaurant's.</Text>
                        </>
                      ) : null}
                    </View>
                  ) : null}
                  {item.kcal || item.allergens ? (
                    <Text style={type.tiny}>
                      {item.kcal ? `${item.kcal} kcal` : ''}{item.kcal && item.allergens ? ' · ' : ''}{item.allergens ?? ''}
                    </Text>
                  ) : null}
                  {flags.length ? <Wrap>{flags.map((f, i) => <FlagChip key={i} flag={f} />)}</Wrap> : null}
                  <Row style={{ flexWrap: 'wrap', gap: 6 }}>
                    {ctl.diners.filter((d) => d.kind !== 'table').map((d) => (
                      <Face
                        key={d.key}
                        label={d.name}
                        guest={d.kind === 'guest'}
                        on={ctl.pickOf(item.id, d.key).on}
                        onPress={() => ctl.togglePick(item.id, d.key)}
                      />
                    ))}
                    <Chip
                      label="Table"
                      icon="household"
                      selected={ctl.pickOf(item.id, TABLE.key).on}
                      onPress={() => ctl.togglePick(item.id, TABLE.key)}
                    />
                  </Row>
                  {/*
                    A word for the waiter, one per person (owner, 7 Sep 2026).
                    Two people having the same dish get two boxes, so "no
                    chilli" belongs to whoever said it and does not follow the
                    dish onto somebody else's plate.
                  */}
                  {having.map((d) => (
                    <Row key={d.key} style={{ alignItems: 'center' }}>
                      {d.kind === 'table'
                        ? <Icon name="household" size={16} color={colors.inkMuted} />
                        : <Face label={d.name} on size={22} guest={d.kind === 'guest'} onPress={() => ctl.togglePick(item.id, d.key)} />}
                      <TextInput
                        value={ctl.pickOf(item.id, d.key).note}
                        onChangeText={(t) => ctl.setPick(item.id, d.key, { note: t })}
                        placeholder={having.length > 1 ? `${d.name}: no chilli` : 'no chilli'}
                        placeholderTextColor={colors.inkFaint}
                        style={[styles.noteInput, { flex: 1 }]}
                        accessibilityLabel={`What ${d.kind === 'table' ? 'the table' : d.name} wants said about ${item.name}`}
                      />
                    </Row>
                  ))}
                </View>
              );
            })}
            <Text style={type.tiny}>
              {menu.how?.join(' · ')} · {new URL(menu.sourceUrl).hostname}
              {menu.stale ? ` · prices as printed ${menu.ageDays} days ago` : ''}
            </Text>
          </>
        ) : null}
      </ScrollView>
      {/*
        The basket. It says what just went in and opens to show everything in
        it, because a count that ticks up in the corner is not the same as
        seeing your dinner land somewhere (owner, 7 Sep 2026).
      */}
      {menu ? (
        <>
          {ctl.peek && chosen.length ? <BasketPeek ctl={ctl} /> : null}
          <View style={styles.bar}>
            <Press
              onPress={() => ctl.setPeek(!ctl.peek)}
              disabled={!chosen.length}
              accessibilityRole="button"
              accessibilityLabel={ctl.peek ? 'Close the basket' : 'See what is in the basket'}
              style={{ flex: 1 }}
            >
              <Row style={{ alignItems: 'center' }}>
                <Icon name="basket" size={18} color={chosen.length ? colors.icon : colors.inkFaint} />
                <View style={{ flex: 1 }}>
                  <Text style={type.body}>
                    {chosen.length ? `${chosen.length} ${chosen.length === 1 ? 'thing' : 'things'}${total ? ` · ${money(total)}` : ''}` : 'Nothing chosen yet'}
                  </Text>
                  <Text style={type.tiny} numberOfLines={1}>
                    {ctl.added ? `Added · ${ctl.added}`
                      : !chosen.length ? 'Tap a face on a dish'
                        : ctl.peek ? 'Tap to close the basket'
                          : total ? 'Tap to see what is in it' : 'Priced by the set menu — tap to see what is in it'}
                  </Text>
                </View>
                {chosen.length ? <Icon name={ctl.peek ? 'collapse' : 'expand'} size={16} color={colors.inkMuted} /> : null}
              </Row>
            </Press>
            <Button label="The order" icon="forward" style={styles.barBtn} onPress={async () => { await ctl.toTheOrder(); onOrder(); }} disabled={!chosen.length || ctl.busy} />
          </View>
        </>
      ) : null}
    </>
  );
}

/* --------------------------------------------------------------- the order */

export function OrderPanel({ ctl, onMenu, footer }: { ctl: MenuOrderCtl; onMenu: () => void; footer?: React.ReactNode }) {
  const { order, groups, busy, phase, turn, noting, setNoting, allergenLines, dietLines, resumed } = ctl;
  // The drawer sits inside the app's own router, so "go and look at it" can be
  // an actual button rather than a sentence naming a screen (§13.14).
  const { navigate } = useRouter();
  /**
   * A meal that has become a visit is the household's history, and history is
   * not edited from the order screen: the stars are the only thing about it
   * that can still change (Requirements §5, and the rule this file has always
   * had about a visit being the boundary).
   */
  const eaten = Boolean(order?.visitId);

  if (!order || !order.items.length) {
    const last = ctl.history[0];
    const picked = last ? last.items.filter((i) => ctl.again[i.id]).length : 0;
    return (
      <ScrollView contentContainerStyle={styles.body}>
        {last ? (
          <>
            {/*
              The stars for a meal that is already history.
              An order stops being "the order" the moment it becomes a visit,
              which used to mean the only chance to rate a meal was the sitting
              in which you said you had eaten it — close the drawer and the
              plates were unrateable for good. This is the way back, and it is
              how anybody who missed their turn gets one (owner, 7 Sep 2026).
            */}
            {(() => {
              const stars = last.items.flatMap((i) => i.ratings ?? []).filter((r) => r.score).length;
              return (
                <Card>
                  <Row style={{ alignItems: 'center' }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={type.h3}>{stars ? 'What everyone thought' : 'Nobody has rated this meal'}</Text>
                      <Text style={type.tiny}>
                        {last.visitedOn ? `You ate here on ${day(last.visitedOn)}` : 'Your last meal here'}
                        {stars ? ` · ${stars} starred so far` : ' · hand the phone round and each of you stars your own plates'}
                      </Text>
                    </View>
                    <Button label={stars ? 'Rate more' : 'Rate the meal'} icon="favourite" onPress={() => ctl.rateThatMeal(last)} disabled={busy} />
                  </Row>
                </Card>
              );
            })()}
            {/*
              Who is eating, before what they are eating (owner, 7 Sep 2026: "I
              can say who's dining, or is it the same people? Do you want to add
              new ones? Then I can reuse the order").

              It opens on the table you had last time, so the common case is no
              taps at all; taking somebody off takes their plates off with them,
              and a guest from last time is offered by name rather than assumed
              — seating her again brings back what she ordered.
            */}
            <WhosEating ctl={ctl} last={last} />
            <Text style={type.h3}>The same again?</Text>
            <Text style={type.small}>
              What you had here{last.visitedOn ? ` on ${day(last.visitedOn)}` : ' last time'}. Untick anything nobody wants twice, order the rest,
              and add to it from the menu.
            </Text>
            {[{ key: 'table', name: 'For the table', kind: 'table' as const },
              ...ctl.members.filter((m) => ctl.dining[m.id]).map((m) => ({ key: `m:${m.id}`, name: m.name.split(' ')[0], kind: 'member' as const })),
              // Only the guests actually seated tonight; the rest are offered
              // by name in the row above and bring their plates when they sit.
              ...ctl.guests.map((g) => ({ key: `g:${g.ref}`, name: g.name, kind: 'guest' as const }))]
              .map((g) => ({ ...g, items: last.items.filter((i) => keyOf(i.memberId, i.guestRef) === g.key) }))
              .filter((g) => g.items.length)
              .map((g) => (
                <View key={g.key} style={{ gap: 4 }}>
                  <Row>
                    {g.kind === 'table' ? <Icon name="household" size={18} /> : <Face label={g.name} on guest={g.kind === 'guest'} onPress={() => {}} size={26} />}
                    <Text style={type.h3}>{g.name}</Text>
                    {g.kind === 'guest' ? <Text style={type.tiny}>a guest that night</Text> : null}
                  </Row>
                  {g.items.map((i) => {
                    const on = !!ctl.again[i.id];
                    const r = i.ratings[0];
                    return (
                      <Press
                        key={i.id}
                        onPress={() => ctl.setAgain((a) => ({ ...a, [i.id]: !a[i.id] }))}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        style={styles.orderRow}
                      >
                        <Row style={{ alignItems: 'center' }}>
                          <View style={[styles.tick, on && styles.tickOn]}>
                            {on ? <Icon name="check" size={13} color={colors.primaryFg} /> : null}
                          </View>
                          <Text style={[type.body, { flex: 1 }, !on && { color: colors.inkMuted }]}>{i.name}</Text>
                          {r?.score ? (
                            <Row style={{ gap: 1 }}>
                              {[1, 2, 3, 4, 5].map((n) => <Icon key={n} name="favourite" size={12} fill={(r.score ?? 0) >= n} color={(r.score ?? 0) >= n ? colors.rating : colors.inkFaint} />)}
                            </Row>
                          ) : r?.take === 'not_for_me' ? <Text style={type.tiny}>not great</Text> : null}
                          <Text style={type.small}>{i.priceText ?? ''}</Text>
                        </Row>
                        {i.note ? <Text style={type.tiny}>{i.note}</Text> : null}
                      </Press>
                    );
                  })}
                </View>
              ))}
            {ctl.error ? <Text style={[type.tiny, { color: colors.allergen }]}>{ctl.error}</Text> : null}
            <Wrap>
              <Button label={`Order these${picked ? ` (${picked})` : ''}`} icon="check" onPress={() => ctl.orderAgain(last)} disabled={!picked || ctl.busy} />
              <Button label="Start from the menu" icon="restaurant" kind="secondary" onPress={onMenu} />
            </Wrap>
          </>
        ) : (
          <>
            <Text style={type.small}>Nothing ordered here yet.</Text>
            <Text style={type.tiny}>Open the menu, tap a face on a dish to say who wants it, and the order builds itself.</Text>
            <Wrap><Button label="The menu" icon="restaurant" kind="secondary" onPress={onMenu} /></Wrap>
          </>
        )}
        {footer}
      </ScrollView>
    );
  }

  /**
   * Rating a meal is the phone going round the table (owner, 7 Sep 2026).
   *
   *   > "What I'd like is an actual call to action, like 'Rate the meal', that
   *   > I can give to Phoenix. It can show Phoenix his meal, and then I can
   *   > give it to Gina, and it can show Gina her meal."
   *
   * So there are two screens, not one list of everybody's dinner: the board,
   * where the phone is handed on, and one person's turn, which shows their
   * plates and nobody else's. Each turn is written when it ends, so a phone put
   * down halfway round the table keeps what it has already been given.
   */
  if (phase === 'rate') {
    if (!turn) return <RatingBoard ctl={ctl} footer={footer} />;
    return <Turn ctl={ctl} memberId={turn} footer={footer} />;
  }
  /**
   * What the stars did, said plainly (owner, 7 Sep 2026: "I'd like to see how I
   * can then find those ratings and how you're going to be using them").
   *
   * Three things, in the order they matter: what each person said, what it adds
   * up to for that person and that dish — the count toward the threshold at
   * which Epic starts planning around it — and where to go and look at it later.
   */
  if (phase === 'saved') {
    const rated = order.items.flatMap((i) => (i.ratings ?? []).map((r) => ({ item: i, r })));
    const loved = rated.filter((x) => x.r.score);
    // Two people starring one shared plate is two stars and one plate.
    const platesStarred = new Set(loved.map((x) => x.item.id)).size;
    // Every dish this meal could have taught Epic something about: the ones a
    // menu names outright, and the ones somebody matched by hand on their turn.
    const concepts = [...new Set(order.items.flatMap((i) => [i.concept?.key, i.conceptSuggestion?.key]).filter(Boolean) as string[])];
    const counting = (ctl.learned ?? []).filter((l) => concepts.includes(l.conceptKey));
    // Starred, but not a dish Epic has a name for — so the star is kept against
    // this plate and this place, and cannot follow the dish anywhere else. Said
    // out loud, because the alternative is wondering why a five-star plate
    // never turned up in what Epic thinks you like.
    const unknown = [...new Set(order.items
      .filter((i) => !i.concept && !i.conceptSuggestion && (i.ratings ?? []).some((r) => r.score))
      .map((i) => i.name))];
    const yetToGo = ctl.raters.filter((m) => !ctl.tookATurn[m.id]).map((m) => m.name.split(' ')[0]);
    const nameOf = (memberId: string | null) => ctl.members.find((m) => m.id === memberId)?.name.split(' ')[0] ?? 'the table';
    return (
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={type.h3}>{platesStarred ? `${platesStarred} ${platesStarred === 1 ? 'plate' : 'plates'} starred` : 'Saved'}</Text>
        <Text style={type.small}>
          The meal is a visit now, kept under this place in Places, with the order and what each of you said under it.
        </Text>
        {order.items.map((i) => {
          const rs = (i.ratings ?? []).filter((r) => r.score || r.take === 'not_for_me');
          return (
            <View key={i.id} style={styles.orderRow}>
              <Row style={{ alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Text style={type.body}>{i.name}</Text>
                  {i.guestId ? <Text style={type.tiny}>{i.guest}'s, a guest — not scored</Text> : null}
                  {!i.guestId && !rs.length ? <Text style={type.tiny}>nothing said, so it counts as fine</Text> : null}
                </View>
              </Row>
              {rs.map((r, n) => (
                <Row key={n} style={{ alignItems: 'center' }}>
                  <Text style={[type.tiny, { flex: 1 }]}>
                    {nameOf(r.memberId)}
                    {r.take === 'not_for_me' ? ' would not have it again' : ''}
                    {r.comment ? ` — “${r.comment}”` : ''}
                  </Text>
                  {r.score ? (
                    <Row style={{ gap: 1 }}>
                      {[1, 2, 3, 4, 5].map((n2) => <Icon key={n2} name="favourite" size={13} fill={(r.score ?? 0) >= n2} color={(r.score ?? 0) >= n2 ? colors.rating : colors.inkFaint} />)}
                    </Row>
                  ) : null}
                </Row>
              ))}
            </View>
          );
        })}

        {/*
          What it counts toward. A star is not filed away — it is one of three
          before Epic will plan around it (routes/household.js LEARN_THRESHOLD),
          and saying which number you are on is the difference between a rating
          somebody keeps giving and a rating that feels like it went nowhere.
        */}
        {counting.length || unknown.length ? (
          <Card>
            <Text style={type.h3}>What this counts toward</Text>
            {counting.map((l) => (
              <Row key={`${l.memberId}:${l.conceptKey}`} style={{ alignItems: 'center' }}>
                <Text style={[type.small, { flex: 1 }]}>
                  {l.name.split(' ')[0]} · {l.label}
                </Text>
                <Text style={type.tiny}>
                  {l.confirmed
                    ? `${l.kind === 'like' ? 'Epic plans around it' : 'ranked lower'} · ${l.count} meals`
                    : `${l.count} of ${l.threshold}`}
                </Text>
              </Row>
            ))}
            {counting.length ? (
              <Text style={type.tiny}>
                A star goes to the dish as well as to the plate, so it counts the next time you are anywhere that serves it —
                at {counting[0].threshold} it becomes a reason on a card and a table of its own on the home screen.
                “Not great” lowers that one dish and nothing else. Fine changes nothing.
              </Text>
            ) : null}
            {unknown.length ? (
              <Text style={type.tiny}>
                {unknown.join(', ')} — {unknown.length === 1 ? 'not a dish' : 'not dishes'} Epic has a name for yet, so
                {unknown.length === 1 ? ' that star stays' : ' those stars stay'} with this plate and this place rather than
                following the dish to anywhere else that serves it.
              </Text>
            ) : null}
          </Card>
        ) : null}

        {/* Where to find it again, in the two places it actually lives — and a
            way to go straight there, because "it is in Household somewhere" is
            not an answer to "how do I find these" (owner, 7 Sep 2026). */}
        <Card>
          <Text style={type.h3}>Where to find this</Text>
          <Text style={type.small}>· Here, under “What we had here”: every meal at this place, and who loved what.</Text>
          <Text style={type.small}>· Household → the person → Food → “Learned from visits”: what their stars add up to.</Text>
          <Wrap><Button label="Open Household" icon="household" kind="secondary" onPress={() => navigate(paths.household())} /></Wrap>
          <Text style={type.tiny}>
            Epic uses it when it ranks anywhere to eat: a dish somebody has starred enough times becomes a reason on the card
            (“Phoenix loves this”) and a table of its own on the home screen, and one they would not have again ranks a place
            lower without ever hiding it.
          </Text>
        </Card>

        {yetToGo.length ? (
          <Text style={type.small}>{yetToGo.join(' and ')} {yetToGo.length === 1 ? 'has' : 'have'} not had a go yet.</Text>
        ) : null}
        <Wrap>
          <Button
            label={yetToGo.length ? 'Pass it round again' : 'Rate it again'}
            icon="favourite"
            kind={yetToGo.length ? 'primary' : 'secondary'}
            onPress={() => { ctl.setTurn(null); ctl.setPhase('rate'); }}
          />
          {/* An old meal was opened to be rated while tonight's was being
              written: this is the way back to it. */}
          {ctl.tonight ? <Button label="Back to tonight's order" icon="back" kind="secondary" onPress={ctl.backToTonight} /> : null}
        </Wrap>
        {footer}
      </ScrollView>
    );
  }

  return (
    <>
      <ScrollView contentContainerStyle={styles.body}>
        {/*
          The call to action the owner asked for (7 Sep 2026): "there is no
          option to rate this, and I think what I'd like is an actual call to
          action, like 'Rate the meal'". It used to appear only on an order that
          was already on the server when the drawer opened — which is never the
          one you have just written at the table, so a meal ordered and eaten in
          one sitting could not be rated at all.
        */}
        {order.items.length ? (
          <Card>
            <Row style={{ alignItems: 'center' }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={type.h3}>{eaten ? 'What did everyone think?' : 'Eaten it?'}</Text>
                <Text style={type.tiny}>
                  {eaten
                    ? 'This meal is in your history now — anybody who has not had a go still can.'
                    : 'Hand the phone round the table and each of you stars your own plates.'}
                </Text>
              </View>
              <Button label="Rate the meal" icon="favourite" onPress={ctl.rateTheMeal} disabled={busy} />
            </Row>
          </Card>
        ) : null}
        {/* Who is at the table is a thing about tonight; a meal already eaten
            has the table it had. */}
        {eaten ? null : <WhoIsHere ctl={ctl} />}
        {groups.map((g) => (
          <View key={g.key} style={{ gap: 4 }}>
            <Row>
              {g.kind === 'table' ? <Icon name="household" size={18} /> : <Face label={g.name} on guest={g.kind === 'guest'} onPress={() => {}} size={26} />}
              <Text style={type.h3}>{g.name}</Text>
              {g.kind === 'guest' ? <Text style={type.tiny}>a guest tonight</Text> : null}
            </Row>
            {g.items.length ? g.items.map((i) => (
              <View key={i.id} style={styles.orderRow}>
                <Row style={{ alignItems: 'center' }}>
                  <Text style={[type.body, { flex: 1 }]}>{i.name}</Text>
                  <Text style={type.small}>{i.priceText ?? ''}</Text>
                  {eaten ? null : (
                    <>
                      <Press
                        onPress={() => setNoting((n) => ({ ...n, [i.id]: !n[i.id] }))}
                        accessibilityRole="button"
                        accessibilityLabel={`${i.note ? 'Change the' : 'Add a'} word for the waiter about ${i.name}`}
                        style={styles.rowBtn}
                      >
                        <Icon name="edit" size={14} color={i.note ? colors.icon : colors.inkMuted} />
                      </Press>
                      <Press
                        onPress={() => ctl.removeFromOrder(i)}
                        disabled={busy}
                        accessibilityRole="button"
                        accessibilityLabel={`Take ${i.name} off the order`}
                        style={styles.rowBtn}
                      >
                        <Icon name="close" size={15} color={colors.inkMuted} />
                      </Press>
                    </>
                  )}
                </Row>
                {i.note && !noting[i.id] ? <Text style={type.tiny}>{i.note}</Text> : null}
                {noting[i.id] ? (
                  <TextInput
                    defaultValue={i.note ?? ''}
                    autoFocus
                    onEndEditing={(e) => { ctl.noteOnOrder(i, e.nativeEvent.text); setNoting((n) => ({ ...n, [i.id]: false })); }}
                    onBlur={(e: any) => { ctl.noteOnOrder(i, e?.nativeEvent?.text ?? ''); setNoting((n) => ({ ...n, [i.id]: false })); }}
                    placeholder="a word for the waiter"
                    placeholderTextColor={colors.inkFaint}
                    style={[styles.noteInput, { marginTop: 4 }]}
                    accessibilityLabel={`A word about ${i.name}`}
                  />
                ) : null}
              </View>
            )) : <Text style={type.tiny}>Nothing yet</Text>}
          </View>
        ))}
        {order.total ? (
          <Row style={styles.totalRow}>
            <Text style={type.h3}>Total</Text><Text style={type.h3}>{money(order.total)}</Text>
          </Row>
        ) : (
          <Text style={type.tiny}>These courses are priced by the set menu, not one by one, so there is no total to show.</Text>
        )}
        {allergenLines.length ? (
          <View style={styles.warn}>
            <Icon name="allergen" size={14} color={colors.allergen} />
            <Text style={[type.small, { color: colors.allergen, flex: 1 }]}>
              {allergenLines.join(' ')} Epic can never clear a dish of an allergen a menu does not have to declare — ask at the table.
            </Text>
          </View>
        ) : null}
        {dietLines.length ? <Text style={type.tiny}>{dietLines.join(' ')}</Text> : null}
        {footer}
      </ScrollView>
      <View style={styles.bar}>
        {eaten ? (
          <>
            <Button label="The menu" icon="restaurant" kind="ghost" style={styles.barBtn} onPress={onMenu} />
            <View style={{ flex: 1, alignItems: 'center' }}><Text style={type.tiny}>Eaten — the stars are all that can change</Text></View>
            <Button label="Rate the meal" icon="favourite" style={styles.barBtn} onPress={ctl.rateTheMeal} disabled={busy} />
          </>
        ) : (
          <>
            <Button label="Restart" icon="refresh" kind="ghost" style={styles.barBtn} onPress={ctl.startAgain} disabled={busy} />
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Button label="Add/Change" icon="edit" kind="secondary" style={styles.barBtn} onPress={onMenu} disabled={busy} />
            </View>
            <Button label="Show staff" icon="list" style={styles.barBtn} onPress={() => ctl.setStaff(true)} disabled={!order.items.length} />
          </>
        )}
      </View>
    </>
  );
}

/**
 * What we ate here, and what each of us made of it (owner, 4 Sep 2026: "I
 * really want to see what they ordered… what each person loved"). It is a
 * record, not a form: the stars are given once, on the order, after the meal.
 */
export function PastMeals({ ctl, onRate }: { ctl: MenuOrderCtl; onRate?: () => void }) {
  if (!ctl.history.length) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={type.h3}>What we had here</Text>
      {ctl.history.map((meal) => {
        // A plate for the table is rated by everybody who ate it, so a meal is
        // counted in stars given rather than in plates starred.
        const stars = meal.items.flatMap((i) => i.ratings ?? []).filter((r) => r.score).length;
        return (
          <View key={meal.id} style={{ gap: 4 }}>
            <Row style={{ alignItems: 'center' }}>
              <Text style={[styles.mealWhen, { flex: 1 }]}>{meal.visitedOn ? day(meal.visitedOn) : 'A visit'}{stars ? ` · ${stars} starred` : ''}</Text>
              {/* Every meal here can still be starred, by whoever has not yet
                  (owner, 7 Sep 2026) — including one from months ago. */}
              {onRate ? (
                <Chip
                  label={stars ? 'Rate more' : 'Rate the meal'}
                  icon="favourite"
                  onPress={() => { ctl.rateThatMeal(meal); onRate(); }}
                />
              ) : null}
            </Row>
            {meal.items.map((i) => {
              const rs = (i.ratings ?? []).filter((r) => r.score || r.take === 'not_for_me');
              const who = whoHad(i);
              return (
                <View key={i.id} style={styles.orderRow}>
                  <Row style={{ alignItems: 'flex-start' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={type.body}>{i.name}</Text>
                      <Text style={type.tiny}>{who}{rs.length ? '' : ' · nobody said, so it was fine'}</Text>
                    </View>
                  </Row>
                  {rs.map((r, n) => {
                    // Whose star this is, said only when it is not obvious: a
                    // plate of Roger's starred by Roger does not need his name
                    // twice, a plate for the table starred by three people does.
                    const rater = ctl.members.find((m) => m.id === r.memberId)?.name.split(' ')[0] ?? who;
                    const said = [rater === who ? null : rater, r.take === 'not_for_me' ? 'not great' : null].filter(Boolean).join(' · ');
                    return (
                    <Row key={n} style={{ alignItems: 'center' }}>
                      <Text style={[type.tiny, { flex: 1 }]}>
                        {said}
                        {r.comment ? `${said ? ' — ' : ''}“${r.comment}”` : ''}
                      </Text>
                      {r.score ? (
                        <Row style={{ gap: 1 }}>
                          {[1, 2, 3, 4, 5].map((n2) => <Icon key={n2} name="favourite" size={12} fill={(r.score ?? 0) >= n2} color={(r.score ?? 0) >= n2 ? colors.rating : colors.inkFaint} />)}
                        </Row>
                      ) : null}
                    </Row>
                    );
                  })}
                </View>
              );
            })}
          </View>
        );
      })}
      <Text style={type.tiny}>A plate nobody starred was fine. Stars are given on the order, after the meal — “Rate the meal” on the Order tab.</Text>
    </View>
  );
}

/* ------------------------------------------- the screen you hold up to them */

export function StaffSheet({ ctl }: { ctl: MenuOrderCtl }) {
  const { width, height, framed, origin } = useViewport();
  const { order, groups, itemsById, allergenLines, dietLines } = ctl;
  /**
   * The code first, when there is one (owner, 7 Sep 2026): "standing there
   * holding the phone while they take a note of what I want to order was quite
   * awkward". A waiter with a camera reads it off the table and walks away with
   * it; the two written-out views are still there for one who would rather look.
   */
  const link = useMemo(() => {
    if (!order?.shareToken) return null;
    const base = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : 'https://epic.app';
    return `${base}${paths.order(order.shareToken)}`;
  }, [order?.shareToken]);
  const [by, setBy] = useState<'code' | 'person' | 'course'>(link ? 'code' : 'person');
  const frameBox = framed && origin
    ? { position: 'absolute' as const, left: origin.x, top: origin.y, width, height }
    : null;

  // Keep the screen awake while it is being read across a table.
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    let lock: any;
    (navigator as any).wakeLock?.request?.('screen').then((l: any) => { lock = l; }).catch(() => {});
    return () => { lock?.release?.().catch(() => {}); };
  }, []);

  if (!order) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => ctl.setStaff(false)}>
      <View style={[styles.staffWrap, frameBox]}>
        <ScrollView contentContainerStyle={[styles.body, { gap: spacing.sm }]}>
          <Row style={{ alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Segmented
                value={by}
                onChange={setBy}
                options={[
                  ...(link ? [{ value: 'code' as const, label: 'Scan it', icon: 'qr' as const }] : []),
                  { value: 'person', label: 'By person' },
                  { value: 'course', label: 'By course' },
                ]}
              />
            </View>
            <Press onPress={() => ctl.setStaff(false)} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
              <Icon name="close" size={22} color={colors.ink} />
            </Press>
          </Row>
          {by === 'code' && link ? (
            <View style={{ alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md }}>
              <QrCode value={link} size={Math.min(260, width - spacing.lg * 4)} />
              <Text style={styles.staffDish}>Point your camera at this</Text>
              <Text style={[type.small, { textAlign: 'center' }]}>
                It opens the whole order — every dish, who it is for, what each of them asked for, and what we cannot eat.
                Nothing else, and no account needed.
              </Text>
              <Text style={type.tiny} selectable numberOfLines={2}>{link}</Text>
              {allergenLines.length ? (
                <View style={styles.staffAlert}>
                  <Text style={styles.staffAlertText}>{allergenLines.join(' ')}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          {by === 'code' ? null : by === 'person'
            ? groups.filter((g) => g.items.length).map((g) => (
                <View key={g.key} style={{ gap: 2 }}>
                  <Text style={styles.staffWho}>{g.name}</Text>
                  {g.items.map((i) => (
                    <View key={i.id}>
                      <Text style={styles.staffDish}>{i.name}</Text>
                      {i.note ? <Text style={type.small}>{i.note}</Text> : null}
                    </View>
                  ))}
                </View>
              ))
            : [...new Set(order.items.map((i) => itemsById.get(i.menuItemId ?? '')?.section ?? 'Ordered'))].map((sec) => (
                <View key={sec} style={{ gap: 2 }}>
                  <Text style={styles.staffWho}>{sec}</Text>
                  {order.items
                    .filter((i) => (itemsById.get(i.menuItemId ?? '')?.section ?? 'Ordered') === sec)
                    .map((i) => (
                      <View key={i.id}>
                        <Text style={styles.staffDish}>{i.name}</Text>
                        <Text style={type.small}>{whoHad(i) === 'the table' ? 'for the table' : `for ${whoHad(i)}`}{i.note ? ` · ${i.note}` : ''}</Text>
                      </View>
                    ))}
                </View>
              ))}
          {by !== 'code' && allergenLines.length ? (
            <View style={styles.staffAlert}>
              <Text style={styles.staffAlertText}>{allergenLines.join(' ')} Please check anything cooked in a stock or a soffritto.</Text>
            </View>
          ) : null}
          {by !== 'code' && dietLines.length ? <Text style={styles.staffDiet}>{dietLines.join(' ')}</Text> : null}
          <Text style={type.tiny}>
            {by === 'code'
              ? 'The code is on the order, so it works with no signal on this phone — the waiter needs their own.'
              : 'Big type, no chrome, the screen stays awake. Works with no signal.'}
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xl },
  close: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center' },
  row: { gap: 6, paddingVertical: spacing.sm, borderTopWidth: BORDER, borderTopColor: colors.line },
  rowPicked: { backgroundColor: colors.surfaceMuted, borderRadius: radius.sm, paddingHorizontal: spacing.sm },
  itemName: { flex: 1, fontWeight: '700' },
  veg: { color: colors.accent, fontWeight: '800', fontSize: 13 },
  price: { ...type.body, fontWeight: '700' },
  flag: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: BORDER, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  flagText: { fontSize: 11, fontWeight: '700' },
  face: { alignItems: 'center', justifyContent: 'center', borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface },
  // A guest is here for one meal: the same face, drawn with a dashed edge.
  faceGuest: { borderStyle: 'dashed', borderColor: colors.inkMuted },
  faceOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  faceText: { fontSize: 12, fontWeight: '800', color: colors.inkMuted },
  faceTextOn: { color: colors.primaryFg },
  whatIs: { backgroundColor: colors.surfaceMuted, borderRadius: radius.sm, padding: spacing.sm, gap: 2 },
  rowBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 15, borderWidth: BORDER, borderColor: colors.line, marginLeft: 6 },
  noteInput: {
    height: 32, minWidth: 120, borderWidth: BORDER, borderColor: colors.line, borderRadius: radius.sm,
    paddingHorizontal: 10, color: colors.ink, backgroundColor: colors.surface, fontSize: 13,
  },
  // The two ways to the menu, side by side: ours on the left with what is in
  // it, theirs as a button. One line on a phone, still one line at 390px.
  twoWays: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap',
    borderWidth: BORDER, borderColor: colors.line, borderRadius: radius.md,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
  },
  // Who is at the table, above the menu: the family in a line, tonight's guests
  // as chips, and the one control that adds another.
  who: {
    gap: 6, borderWidth: BORDER, borderColor: colors.line, borderRadius: radius.md,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
  },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    padding: spacing.md, borderTopWidth: BORDER, borderTopColor: colors.line, backgroundColor: colors.surface,
  },
  // The basket opened out, sitting on the bar it belongs to.
  peek: { borderTopWidth: BORDER, borderTopColor: colors.line, backgroundColor: colors.surfaceMuted },
  // One person on the board where the phone is handed round: a big target,
  // because it is tapped by whoever is holding it and passed across a table.
  handRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: BORDER, borderColor: colors.line, borderRadius: radius.md,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, minHeight: TARGET + 12,
  },
  handRowDone: { backgroundColor: colors.surfaceMuted, borderColor: colors.accentSoft },
  // Three labelled buttons on one row inside 390px: tighter padding than the
  // standard button, and the bar's own gap trimmed to match (owner, 4 Sep 2026).
  barBtn: { paddingHorizontal: 10 },
  orderRow: { paddingVertical: 6, borderTopWidth: BORDER, borderTopColor: colors.line },
  tick: { width: 22, height: 22, borderRadius: 4, borderWidth: BORDER, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  tickOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  mealWhen: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 1, fontWeight: '800', marginTop: spacing.sm },
  totalRow: { borderTopWidth: BORDER, borderTopColor: colors.ink, paddingTop: spacing.sm, justifyContent: 'space-between' },
  warn: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start', borderWidth: BORDER, borderColor: colors.allergen,
    backgroundColor: colors.allergenSoft, borderRadius: radius.sm, padding: spacing.sm,
  },
  staffWrap: { flex: 1, backgroundColor: colors.bg },
  staffWho: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 1, fontWeight: '800', marginTop: spacing.sm },
  staffDish: { fontSize: 21, fontWeight: '800', letterSpacing: -0.4, color: colors.ink, lineHeight: 26 },
  staffDiet: { fontSize: 15, fontWeight: '600', color: colors.ink },
  staffAlert: { borderWidth: 2, borderColor: colors.allergen, borderRadius: radius.sm, padding: spacing.sm, marginTop: spacing.sm },
  staffAlertText: { fontSize: 16, fontWeight: '800', color: colors.allergen, lineHeight: 21 },
});
