/**
 * The shared steps (hosting v7 · S4–S8): Any other hosts, Where, Price ("Is it
 * free?") and Who can come — asked last. RULINGS adds to them: decides-by and
 * the refund policy in Price; the age restriction, the children's path and the
 * public link on Who can come; a per-booking price for On request.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Press } from '../../../../components/press';
import { Icon } from '../../../../components/Icon';
import { PlacePicker } from '../../../../components/PlacePicker';
import { showToast } from '../../../../components/Toast';
import { api, type HostContact, type Place } from '../../../../api';
import { CREAM, DEEP_GREEN, HAIRLINE, INACTIVE, INK, INK_MUTED, LIME, LIME_TINT, MOSS } from '../../../../theme';
import { ActionBar, AddLink, Count, DateBox, Field, Kicker, Labelled, LinkBlock, MinMax, MoneyBox, Note, Option, Overlay, Tick, ToggleRow, Switch, pointer, tx, hx, v } from '../kit';
import { asksParentsOnWho, dayWords, gbp, pence, poundsText, type Cohost, type LaneOffer } from '../model';
import type { StepProps } from '../Setup';

// ---------------------------------------------------------------------------
// Any other hosts? / Who runs it?
// ---------------------------------------------------------------------------

// What a co-host may *do* (edit, message guests, see who's coming) needs them signed in to this
// offer, which is host management's to build; until then only how they are shown is asked
// (Codex, 2 Oct 2026). The role still sets those flags, ready for it.
const PERMS: [keyof Cohost, string][] = [['shownOnPage', 'Shown on the page'], ['withPhoto', 'With their photo']];
const asRole = (role: 'cohost' | 'helper'): Pick<Cohost, 'canEdit' | 'canMessage' | 'shownOnPage' | 'withPhoto' | 'seesGuests'> =>
  role === 'cohost' ? { canEdit: true, canMessage: true, shownOnPage: true, withPhoto: true, seesGuests: true } : { canEdit: false, canMessage: false, shownOnPage: true, withPhoto: true, seesGuests: false };
const roleWords = (c: Cohost) => `${c.role === 'cohost' ? 'Co-host' : 'Helper'} · ${c.shownOnPage ? 'shown on the page' : 'behind the scenes'}`;

export function CohostsStep({ offer, update }: StepProps) {
  const [list, setList] = useState<Cohost[]>(offer.cohosts);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const save = (next: Cohost[]) => { setList(next); update({ cohosts: next }); };
  return (
    <>
      <View style={v.list}>
        {list.map((c, i) => (
          <Press key={`${c.name}-${i}`} onPress={() => setEditing(i)} accessibilityRole="button" accessibilityLabel={c.name}
            style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HAIRLINE }, pointer]}>
            <View style={{ flex: 1 }}>
              <Text style={tx(14.5, '600')}>{c.name}</Text>
              <Text style={tx(12, '400', INK_MUTED)}>{roleWords(c)}</Text>
            </View>
            <View style={{ paddingVertical: 3, paddingHorizontal: 7, backgroundColor: INACTIVE }}><Text style={tx(12, '700')}>{c.role === 'cohost' ? 'Co-host' : 'Helper'}</Text></View>
          </Press>
        ))}
      </View>
      <AddLink label="Add someone" onPress={() => setAdding(true)} />
      {adding ? <AddSomeone onClose={() => setAdding(false)} onPick={(c) => { setAdding(false); save([...list, c]); setEditing(list.length); }} /> : null}
      {editing != null && list[editing] ? (
        <WhatTheyCanDo who={list[editing]} onClose={() => setEditing(null)}
          onSave={(c) => { save(list.map((x, j) => (j === editing ? c : x))); setEditing(null); }}
          onRemove={() => { save(list.filter((_, j) => j !== editing)); setEditing(null); }} />
      ) : null}
    </>
  );
}

/** Add someone (SH-C2): from my Epic contacts, or a new name. */
function AddSomeone({ onClose, onPick }: { onClose: () => void; onPick: (c: Cohost) => void }) {
  const [q, setQ] = useState('');
  const [contacts, setContacts] = useState<HostContact[]>([]);
  useEffect(() => { api.hostContacts().then((r) => setContacts(r.contacts)).catch(() => setContacts([])); }, []);
  const found = contacts.filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8);
  const pick = (name: string, contactId: string | null) => onPick({ name, role: 'helper', contactId, ...asRole('helper') });
  return (
    <Overlay title="Add someone" onClose={onClose}
      footer={<ActionBar label={q.trim() ? `Add ${q.trim().split(' ')[0]}` : 'Add'} disabled={!q.trim()} onPress={() => pick(q.trim(), null)} />}>
      <Field value={q} onChange={setQ} placeholder="Their name" autoFocus />
      {found.length ? (
        <>
          <Kicker>Your Epic contacts</Kicker>
          <View style={v.list}>
            {found.map((c) => (
              <Press key={c.id} onPress={() => pick(c.name, c.id)} accessibilityRole="button" style={[v.row, pointer]}>
                <View style={{ flex: 1 }}>
                  <Text style={v.rowTitle}>{c.name}</Text>
                  <Text style={v.rowSub}>{c.mobile ?? c.email ?? ''}</Text>
                </View>
                <Icon name="add" size={18} color={INK} />
              </Press>
            ))}
          </View>
        </>
      ) : null}
    </Overlay>
  );
}

/** What they can do (SH-C3): Co-host or Helper, and five switches. */
function WhatTheyCanDo({ who, onClose, onSave, onRemove }: { who: Cohost; onClose: () => void; onSave: (c: Cohost) => void; onRemove: () => void }) {
  const [c, setC] = useState<Cohost>(who);
  return (
    <Overlay title={c.name} onClose={onClose} footer={<ActionBar label="Save" onPress={() => onSave(c)} link={{ t: 'Take them off', go: onRemove }} />}>
      <View style={{ flexDirection: 'row', gap: 2 }}>
        {(['cohost', 'helper'] as const).map((r) => (
          <Press key={r} onPress={() => setC({ ...c, role: r, ...asRole(r) })} accessibilityRole="radio" accessibilityState={{ selected: c.role === r }}
            style={[{ flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: c.role === r ? LIME : INACTIVE }, pointer]}>
            <Text style={tx(14, c.role === r ? '800' : '600')}>{r === 'cohost' ? 'Co-host' : 'Helper'}</Text>
          </Press>
        ))}
      </View>
      <View style={v.list}>
        {PERMS.map(([k, t]) => <ToggleRow key={k} title={t} on={Boolean(c[k])} onFlip={() => setC({ ...c, [k]: !c[k] })} />)}
      </View>
    </Overlay>
  );
}

// ---------------------------------------------------------------------------
// Where is it? — four kinds of place
// ---------------------------------------------------------------------------

const OWNED_REF = /^(osm|atlas|own):/;
/**
 * A picked place keeps its reference, so whose words the label is stays known: a provider's
 * name is never kept as if the host had typed it, and is named afresh when it is shown
 * (data policy; Codex, 2 Oct 2026). Only an owned place's town is kept as the area.
 */
const placeFields = (p: Place | null) => (p ? {
  venueLabel: p.formatted ?? p.displayName ?? p.label, venueArea: !p.ref || OWNED_REF.test(p.ref) ? (p.address?.town ?? p.locality ?? p.address?.area ?? null) : null,
  venueLat: p.lat, venueLng: p.lng, venueRef: p.ref ?? null,
} : { venueLabel: null, venueArea: null, venueLat: null, venueLng: null, venueRef: null });

export function WhereStep({ offer, update }: StepProps) {
  const [radius, setRadius] = useState(offer.travelRadiusMin);
  const [charge, setCharge] = useState(poundsText(offer.travelChargePence));
  const current: Place | null = offer.venueLabel ? { label: offer.venueLabel, lat: 0, lng: 0 } as Place : null;
  const area: Place | null = offer.venueArea ? { label: offer.venueArea, lat: 0, lng: 0 } as Place : null;
  return (
    <>
      <Option title="Out and about" sub="A venue, a park, a hall" on={offer.venue === 'out_about'} onPick={() => update({ venue: 'out_about' })}>
        <Labelled label="Address"><PlacePicker value={current} placeholder="Search for the place" onPick={(p) => update(placeFields(p) as never)} onText={(t) => update({ venueLabel: t.trim() || null, venueRef: null, venueLat: null, venueLng: null } as never)} /></Labelled>
      </Option>
      <Option title="Your place" sub="They come to you" on={offer.venue === 'your_place'} onPick={() => update({ venue: 'your_place' })}>
        <Labelled label="Address"><PlacePicker value={current} placeholder="Your address" onPick={(p) => update(placeFields(p) as never)} onText={(t) => update({ venueLabel: t.trim() || null, venueRef: null, venueLat: null, venueLng: null } as never)} /></Labelled>
        <Labelled label="Getting there"><Field value={offer.venueNotes ?? ''} onChange={(venueNotes) => update({ venueNotes })} placeholder="Parking, the side gate, the bell" tinted /></Labelled>
      </Option>
      <Option title="Their place" sub="You go to them" on={offer.venue === 'their_place'} onPick={() => update({ venue: 'their_place', travelRadiusMin: offer.travelRadiusMin ?? 10 })}>
        <Labelled label="Based near"><PlacePicker value={area} kind="area" placeholder="Your town or postcode" onPick={(p) => update({ venueArea: p ? (p.formatted ?? p.label) : null, venueLat: p?.lat ?? null, venueLng: p?.lng ?? null } as never)} /></Labelled>
        <Labelled label="How far you’ll go">
          <View style={{ flexDirection: 'row', gap: 2 }}>
            {[5, 10, 20, 30].map((mi) => (
              <Press key={mi} onPress={() => { setRadius(mi); update({ travelRadiusMin: mi }); }} accessibilityRole="radio" accessibilityState={{ selected: radius === mi }}
                style={[{ flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: radius === mi ? LIME : CREAM }, pointer]}>
                <Text style={tx(14, radius === mi ? '800' : '600')}>{mi} mi</Text>
              </Press>
            ))}
          </View>
        </Labelled>
        <Labelled label="Travel charge (optional)">
          <MoneyBox value={charge} onChange={(s) => { setCharge(s); update({ travelChargePence: pence(s) }); }} placeholder="0" />
        </Labelled>
      </Option>
      <Option title="Online" sub="A video call" on={offer.venue === 'online'} onPick={() => update({ venue: 'online', onlineMode: offer.onlineMode ?? 'epic', timeZone: offer.timeZone ?? 'Europe/London' })}>
        {([['epic', 'Epic makes the call link', 'Sent to guests an hour before'], ['own', 'I’ll use my own', 'Zoom, Teams, Meet']] as const).map(([k, t, s]) => (
          <Press key={k} onPress={() => update({ onlineMode: k })} accessibilityRole="radio" accessibilityState={{ selected: offer.onlineMode === k }}
            style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: CREAM }, pointer]}>
            <Tick on={offer.onlineMode === k} />
            <View style={{ flex: 1 }}><Text style={tx(14.5, '700')}>{t}</Text><Text style={tx(12, '400', INK_MUTED)}>{s}</Text></View>
          </Press>
        ))}
        {offer.onlineMode === 'own' ? <Labelled label="Call link"><Field value={offer.onlineLink ?? ''} onChange={(onlineLink) => update({ onlineLink })} placeholder="https://" tinted /></Labelled> : null}
        <Labelled label="Time zone"><View style={[v.box, { backgroundColor: CREAM }]}><Text style={v.boxText}>London (UK time)</Text></View></Labelled>
      </Option>
    </>
  );
}

// ---------------------------------------------------------------------------
// Is it free? / What does it cost? — shared by One-off, Course, On request
// ---------------------------------------------------------------------------

/** Decides by, and what happens under the minimum (RULINGS › Decides-by date). */
export function DecidesBy({ offer, update }: Pick<StepProps, 'offer' | 'update'>) {
  if (!offer.minCount || offer.lane === 'weekly' || offer.lane === 'onrequest') return null;
  const shown = offer.decidesOn ?? offer.decidesOnDefault;
  return (
    <>
      <Labelled label="Decides by">
        <DateBox value={shown} words={dayWords(shown)} onPick={(d) => update({ decidesOn: d })} placeholder="A week before it starts" />
      </Labelled>
      <Text style={tx(12.5, '400', DEEP_GREEN)}>Under {offer.minCount} by then and it’s called off · everyone gets a full refund</Text>
    </>
  );
}

/** If someone cancels: Flexible · Moderate · Strict, paid events only (SH-P4). */
export function RefundPolicy({ offer, update, config }: Pick<StepProps, 'offer' | 'update' | 'config'>) {
  const chosen = offer.refundPolicy;
  const words = config.refunds.find((r) => r.key === chosen)?.words;
  return (
    <View style={{ gap: 8, marginTop: 4 }}>
      <Kicker>If someone cancels</Kicker>
      <View style={{ flexDirection: 'row', gap: 2 }}>
        {config.refunds.map((r) => (
          <Press key={r.key} onPress={() => update({ refundPolicy: r.key })} accessibilityRole="radio" accessibilityState={{ selected: chosen === r.key }}
            style={[{ flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: chosen === r.key ? LIME : INACTIVE }, pointer]}>
            <Text style={tx(14, chosen === r.key ? '800' : '600')}>{r.key[0].toUpperCase() + r.key.slice(1)}</Text>
          </Press>
        ))}
      </View>
      {words ? <Text style={tx(12.5, '400', INK_MUTED)}>{words}</Text> : null}
    </View>
  );
}

/** Who collects it, on a private paid event (SH-P4): Epic, or the host directly. Public and paid is always Epic. */
function WhoCollects({ offer, update }: Pick<StepProps, 'offer' | 'update'>) {
  if (offer.visibility === 'public') return null;
  const on = offer.money === 'direct' ? 'direct' : 'epic';
  return (
    <View style={{ gap: 8, marginTop: 4 }}>
      <Kicker>Who collects it?</Kicker>
      {([['epic', 'Epic collects', 'Card at booking · paid out after'], ['direct', 'They pay me directly', 'Cash or bank transfer']] as const).map(([k, t, s]) => (
        <Press key={k} onPress={() => update({ money: k })} accessibilityRole="radio" accessibilityState={{ selected: on === k }}
          style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: CREAM }, pointer]}>
          <Tick on={on === k} />
          <View style={{ flex: 1 }}><Text style={tx(14.5, '700')}>{t}</Text><Text style={tx(12, '400', INK_MUTED)}>{s}</Text></View>
        </Press>
      ))}
    </View>
  );
}

export function PriceStep(props: StepProps) {
  const { offer, update } = props;
  const [each, setEach] = useState(poundsText(offer.pricePence));
  const [child, setChild] = useState(poundsText(offer.childPence));
  const [total, setTotal] = useState(poundsText(offer.totalPence));
  const mode = offer.priceMode;
  const minMax = <MinMax min={offer.minCount} max={offer.maxCount} onMin={(n) => update({ minCount: n })} onMax={(n) => update({ maxCount: n })} />;
  const paidExtras = <><WhoCollects {...props} /><RefundPolicy {...props} /></>;
  const tot = pence(total) ?? 0;
  return (
    <>
      <Option title="Free" on={mode === 'free'} onPick={() => { setEach(''); setChild(''); setTotal(''); update({ priceMode: 'free' }); }}>
        {minMax}
        <DecidesBy {...props} />
      </Option>
      <Option title="Same each" sub={offer.lane === 'onrequest' ? 'Per person or per booking' : 'Per person, with an optional child price'} on={mode === 'same_each'}
        onPick={() => { setTotal(''); update({ priceMode: 'same_each', per: offer.per === 'booking' ? 'booking' : 'person' }); }}>
        {offer.lane === 'onrequest' ? (
          <View style={{ flexDirection: 'row', gap: 2 }}>
            {(['person', 'booking'] as const).map((p) => (
              <Press key={p} onPress={() => update({ per: p })} accessibilityRole="radio" accessibilityState={{ selected: (offer.per ?? 'person') === p }}
                style={[{ flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: (offer.per ?? 'person') === p ? LIME : CREAM }, pointer]}>
                <Text style={tx(14, (offer.per ?? 'person') === p ? '800' : '600')}>{p === 'person' ? 'Per person' : 'Per booking'}</Text>
              </Press>
            ))}
          </View>
        ) : null}
        {minMax}
        <DecidesBy {...props} />
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Labelled label={offer.lane === 'onrequest' && offer.per === 'booking' ? 'Each booking' : 'Each'}><MoneyBox value={each} onChange={(s) => { setEach(s); update({ pricePence: pence(s) }); }} placeholder="0" /></Labelled>
          {offer.lane === 'onrequest' && offer.per === 'booking' ? <View style={{ flex: 1 }} />
            : <Labelled label="Child (optional)"><MoneyBox value={child} onChange={(s) => { setChild(s); update({ childPence: pence(s) }); }} placeholder="—" /></Labelled>}
        </View>
        {paidExtras}
      </Option>
      <Option title="Depends on numbers" sub="A fixed total, split" on={mode === 'by_numbers'} onPick={() => { setEach(''); setChild(''); update({ priceMode: 'by_numbers', minCount: offer.minCount ?? 1 }); }}>
        <Labelled label="Total cost of the event"><MoneyBox value={total} onChange={(s) => { setTotal(s); update({ totalPence: pence(s) }); }} placeholder="0" /></Labelled>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {([['Min people', offer.minCount, (n: number) => update({ minCount: n }), INACTIVE, 1, offer.maxCount ?? 100000],
            ['Max people', offer.maxCount, (n: number) => update({ maxCount: n }), LIME_TINT, offer.minCount ?? 1, 100000]] as const).map(([l, n, on, bg, lo, hi]) => (
            <View key={l} style={{ flex: 1, backgroundColor: bg }}>
              <View style={{ paddingVertical: 10, paddingHorizontal: 12, gap: 6 }}>
                <Kicker style={{ color: bg === INACTIVE ? INK_MUTED : DEEP_GREEN }}>{l}</Kicker>
                <Count value={n} onChange={on} min={lo} max={hi} label={l} />
              </View>
              <View style={{ paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: HAIRLINE, gap: 2 }}>
                <Kicker style={{ color: bg === INACTIVE ? INK_MUTED : DEEP_GREEN }}>Cost per person</Kicker>
                <Text style={hx(24, -0.02, 1.2)}>{n && tot ? gbp(Math.ceil(tot / n)) : '—'}</Text>
              </View>
            </View>
          ))}
        </View>
        {offer.minCount && tot ? <Text style={tx(12.5, '400', DEEP_GREEN)}>Guests pay {gbp(Math.ceil(tot / offer.minCount))}; the difference comes back once numbers are final</Text> : null}
        <DecidesBy {...props} />
        {paidExtras}
      </Option>
    </>
  );
}

// ---------------------------------------------------------------------------
// Who can come? — asked last
// ---------------------------------------------------------------------------

export function WhoStep(props: StepProps & { reload: () => Promise<void> }) {
  const { offer, update, reload, config } = props;
  // Who is it for: Adults (where every event starts — no children, so no children's checks),
  // Anyone, or an age range (owner, 2 Oct 2026: "the default should be adults, so the checks
  // don't kick in unless they select Anyone").
  type Who = 'adults' | 'anyone' | 'range';
  const whoOf = (): Who => (offer.ageMin == null && offer.ageMax == null ? 'anyone' : offer.ageMin === config.adultAge && offer.ageMax == null ? 'adults' : 'range');
  const [who, setWho] = useState<Who>(whoOf);
  const ranged = who === 'range';
  const [from, setFrom] = useState(whoOf() === 'range' && offer.ageMin != null ? String(offer.ageMin) : '');
  const [to, setTo] = useState(whoOf() === 'range' && offer.ageMax != null ? String(offer.ageMax) : '');
  const asks = asksParentsOnWho({ lane: offer.lane, ageMax: offer.ageMax }, config.adultAge);
  const setAges = (f: string, t: string) => {
    const a = f.trim() ? Math.min(120, Math.max(0, Number(f.replace(/\D/g, '')))) : null;
    const b = t.trim() ? Math.min(120, Math.max(0, Number(t.replace(/\D/g, '')))) : null;
    // An empty or backwards range is not an answer: it stays open, and Next waits (Codex, 2 Oct 2026).
    if (a == null && b == null) { update({ ageRangePending: true } as never); return; }
    if (a != null && b != null && a > b) { showToast('The youngest age is above the oldest.'); update({ ageRangePending: true } as never); return; }
    update({ ageMin: a, ageMax: b, ageRangePending: false, ...(b == null || b >= config.adultAge ? (offer.lane === 'course' ? {} : { parents: null }) : {}) } as never);
  };
  return (
    <>
      <Option title="Private" sub="Only people you invite" on={offer.visibility === 'invite'} onPick={() => update({ visibility: 'invite' })} />
      <Option title="Public" sub="Listed on Epic" on={offer.visibility === 'public'} onPick={() => update({ visibility: 'public' })} />

      <Kicker style={{ marginTop: 4 }}>Who is it for?</Kicker>
      <View style={{ flexDirection: 'row', gap: 2 }}>
        {([['Adults', 'adults'], ['Anyone', 'anyone'], ['An age range', 'range']] as const).map(([t, k]) => (
          <Press key={k} onPress={() => {
            setWho(k);
            const clearParents = offer.lane === 'course' ? {} : { parents: null };
            if (k === 'adults') { setFrom(''); setTo(''); update({ ageMin: config.adultAge, ageMax: null, ageRangePending: false, ...clearParents } as never); }
            if (k === 'anyone') { setFrom(''); setTo(''); update({ ageMin: null, ageMax: null, ageRangePending: false, ...clearParents } as never); }
            // The last real answer stays saved until a range is typed.
            if (k === 'range') { setFrom(''); setTo(''); update({ ageRangePending: true } as never); }
          }}
            accessibilityRole="radio" accessibilityState={{ selected: who === k }}
            style={[{ flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: who === k ? LIME : INACTIVE }, pointer]}>
            <Text style={tx(14, who === k ? '800' : '600')}>{t}</Text>
          </Press>
        ))}
      </View>
      {ranged ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Labelled label="From"><Field value={from} onChange={(s) => setFrom(s.replace(/\D/g, ''))} onBlur={() => setAges(from, to)} keyboard="numeric" placeholder="Any" maxLength={3} /></Labelled>
          <Labelled label="To"><Field value={to} onChange={(s) => setTo(s.replace(/\D/g, ''))} onBlur={() => setAges(from, to)} keyboard="numeric" placeholder="Any" maxLength={3} /></Labelled>
        </View>
      ) : null}
      {asks ? (
        <>
          <Kicker style={{ marginTop: 4 }}>Parents stay or drop off</Kicker>
          <Option title="Parents stay" sub="For the whole time" on={offer.parents === 'stay'} onPick={() => update({ parents: 'stay' })} />
          <Option title="Drop off" sub="Parents leave the children with you · extra checks" on={offer.parents === 'drop_off'} onPick={() => update({ parents: 'drop_off' })} />
        </>
      ) : null}

      {offer.visibility === 'invite' ? <PrivateWho offer={offer} reload={reload} /> : null}
      {offer.visibility === 'public' ? (
        <>
          {offer.pageUrl ? <LinkBlock label="Link to the page" url={offer.pageUrl} /> : null}
          <Note>Public adds an ID check, a short video and a 48-hour review</Note>
        </>
      ) : null}
    </>
  );
}

/** Private: Invited · Accepted · Min · Max, the invite link, and who is invited (SH-WC2/WC3). */
function PrivateWho({ offer, reload }: { offer: LaneOffer; reload: () => Promise<void> }) {
  const [contacts, setContacts] = useState<HostContact[]>([]);
  const [adding, setAdding] = useState(false);
  useEffect(() => { api.hostContacts().then((r) => setContacts(r.contacts)).catch(() => setContacts([])); }, []);
  const invitedHeads = offer.invites.reduce((n, i) => n + (i.heads ?? 1), 0);
  const accepted = offer.invites.filter((i) => i.rsvp === 'yes').reduce((n, i) => n + (i.rsvpHeads ?? i.heads ?? 1), 0);
  const byContact = useMemo(() => new Map(offer.invites.map((i) => [i.contact ?? `name:${i.name}`, i])), [offer.invites]);
  const flip = async (c: HostContact) => {
    if (!offer.id) return;
    const key = c.mobile ?? c.email ?? `name:${c.name}`;
    const existing = byContact.get(key);
    try {
      if (existing) await api.removeInvite(offer.id, existing.id);
      else await api.addInvites(offer.id, [{ name: c.name, mobile: c.mobile, email: c.email }], false);
      await reload();
    } catch (e: any) { showToast(e.message); }
  };
  const cells: [string, number | string, string][] = [['Invited', invitedHeads, INACTIVE], ['Accepted', accepted, INACTIVE], ['Min', offer.minCount ?? '—', INACTIVE], ['Max', offer.maxCount ?? '—', LIME_TINT]];
  return (
    <>
      <View style={{ flexDirection: 'row', gap: 2 }}>
        {cells.map(([l, n, bg]) => (
          <View key={l} style={{ flex: 1, backgroundColor: bg, paddingVertical: 8, paddingHorizontal: 10 }}>
            <Text style={[v.kicker, { fontSize: 10.5 }]}>{l}</Text>
            <Text style={hx(20, -0.02, 1.2)}>{n}</Text>
          </View>
        ))}
      </View>
      {offer.inviteUrl ? <LinkBlock label="Invite link" url={offer.inviteUrl} /> : null}
      <View style={v.list}>
        {contacts.map((c) => {
          const on = byContact.has(c.mobile ?? c.email ?? `name:${c.name}`);
          return (
            <Press key={c.id} onPress={() => { void flip(c); }} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={c.name}
              style={[{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HAIRLINE }, pointer]}>
              <View style={{ width: 34, height: 34, borderRadius: 999, backgroundColor: INACTIVE, alignItems: 'center', justifyContent: 'center' }}><Text style={tx(13, '700')}>{c.name.slice(0, 1)}</Text></View>
              <View style={{ flex: 1 }}><Text style={tx(14.5, '600')}>{c.name}</Text><Text style={tx(12, '400', INK_MUTED)}>{c.mobile ?? c.email ?? ''}</Text></View>
              <Tick on={on} />
            </Press>
          );
        })}
        {offer.invites.filter((i) => !contacts.some((c) => (c.mobile ?? c.email) === i.contact)).map((i) => (
          <View key={i.id} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
            <View style={{ width: 34, height: 34, borderRadius: 999, backgroundColor: INACTIVE, alignItems: 'center', justifyContent: 'center' }}><Text style={tx(13, '700')}>{i.name.slice(0, 1)}</Text></View>
            <View style={{ flex: 1 }}><Text style={tx(14.5, '600')}>{i.name}</Text><Text style={tx(12, '400', INK_MUTED)}>{i.contact ?? ''}</Text></View>
            <Tick on />
          </View>
        ))}
      </View>
      <AddLink label="New contact" onPress={() => setAdding(true)} />
      {adding ? <NewContact onClose={() => setAdding(false)} onAdd={async (c) => {
        try {
          const r = await api.addHostContact(c);
          setContacts((cs) => [r.contact, ...cs]);
          if (offer.id) { await api.addInvites(offer.id, [{ name: c.name, mobile: c.mobile, email: c.email }], false); await reload(); }
          setAdding(false);
        } catch (e: any) { showToast(e.message); }
      }} /> : null}
    </>
  );
}

/** New contact (SH-WC3): a name, and a mobile or an email. */
function NewContact({ onClose, onAdd }: { onClose: () => void; onAdd: (c: { name: string; mobile: string | null; email: string | null }) => void }) {
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const ok = name.trim() && (mobile.trim() || email.trim());
  return (
    <Overlay title="New contact" onClose={onClose} footer={<ActionBar label="Add" disabled={!ok} onPress={() => onAdd({ name: name.trim(), mobile: mobile.trim() || null, email: email.trim() || null })} />}>
      <Labelled label="Name"><Field value={name} onChange={setName} autoFocus /></Labelled>
      <Labelled label="Mobile"><Field value={mobile} onChange={setMobile} keyboard="phone-pad" placeholder="Add a mobile or an email" /></Labelled>
      <Labelled label="Email"><Field value={email} onChange={setEmail} keyboard="email-address" /></Labelled>
      <Text style={tx(12.5, '400', INK_MUTED)}>Saved to My Epic contacts</Text>
    </Overlay>
  );
}

void Switch; void MOSS;
