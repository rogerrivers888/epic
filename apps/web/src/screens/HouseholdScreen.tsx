/**
 * One person's profile (Settings revised v2 — SE3 editable, SE3b a joined adult
 * read-only, SE4 a child, SE5 the opened states, SE6/SE6b the edit sheet).
 *
 * The page is the person: a head with their face and a camera badge, the pending
 * invite or the host-profile row, a Food & drink / Things to do switch, their
 * diet, likes and dislikes, then allergies and access needs collapsed above
 * "What Epic has noticed". Everything saves as it is changed; the only Save is
 * in the edit sheet. Once an adult has joined, only they can change any of it —
 * for everyone else the page is read-only and the pencil only removes them.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../components/press';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { api, AccessNeed, Constraint, HouseholdResponse, Learned, MainDiet, Member } from '../api';
import { colors, fonts, spacing, TARGET, type, BORDER, LIME, INK, CREAM } from '../theme';
import { Button, Chip, Row, Wrap } from '../components/ui';
import { asOneOf, asFlag, useQueryState, useRouter } from '../router';
import { paths, type Route } from '../routes';
import { Avatar } from '../components/Faces';
import { Icon } from '../components/Icon';
import { SuggestInput } from '../components/SuggestInput';
import { TastePicker } from '../components/TastePicker';
import { BirthdayPicker } from '../components/BirthdayPicker';
import { CompactBand } from '../components/Band';
import { InkMenu } from '../components/InkMenu';
import { Sheet } from '../components/Sheet';
import { showToast } from '../components/Toast';

const FOOD_KINDS = ['dish', 'cuisine', 'ingredient', 'style'];
const ACTIVITY_KINDS = ['experience'];
const RELATIONSHIPS = ['parent', 'partner', 'child', 'grandparent', 'sibling', 'friend', 'other'];
const RELATIONSHIP_LABEL: Record<string, string> = { parent: 'Parent', partner: 'Partner', child: 'Child', grandparent: 'Grandparent', sibling: 'Sibling', friend: 'Friend', other: 'Other' };
const DIET_OPTS: MainDiet[] = ['none', 'vegetarian', 'vegan', 'pescatarian'];
const DIET_LABEL: Record<MainDiet, string> = { none: 'None', vegetarian: 'Vegetarian', vegan: 'Vegan', pescatarian: 'Pescatarian' };

// The UK 14, in reveal order with the labels the profile shows.
const ALLERGEN_LABEL: Record<string, string> = {
  peanuts: 'Peanuts', 'tree nuts': 'Tree nuts', milk: 'Milk', eggs: 'Eggs', gluten: 'Gluten (cereals containing gluten)',
  sesame: 'Sesame', fish: 'Fish', crustaceans: 'Crustaceans', soya: 'Soya', celery: 'Celery', mustard: 'Mustard',
  lupin: 'Lupin', molluscs: 'Molluscs', sulphites: 'Sulphites',
};
const ALLERGENS_COMMON = ['peanuts', 'tree nuts', 'milk', 'eggs', 'gluten', 'sesame', 'fish', 'crustaceans'];
const ALLERGENS_REST = ['soya', 'celery', 'mustard', 'lupin', 'molluscs', 'sulphites'];

const ACCESS_OPTS: { key: AccessNeed; label: string; filters?: boolean }[] = [
  { key: 'step-free', label: 'Step-free access', filters: true },
  { key: 'accessible-toilet', label: 'Accessible toilet' },
  { key: 'lift', label: 'Lift' },
  { key: 'quiet', label: 'Quiet space' },
];

const isActivity = (c: Constraint) => c.conceptKind === 'experience';
const byFavourite = (a: Constraint, b: Constraint) => Number(Boolean(b.favourite)) - Number(Boolean(a.favourite));
const first = (name: string) => name.split(/\s+/)[0];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const prettyMobile = (m?: string | null) => m ?? null;

export function HouseholdScreen({ data, refresh, route }: {
  data: HouseholdResponse | null; refresh: () => Promise<void>;
  route: Extract<Route, { name: 'household' }>;
}) {
  const { navigate } = useRouter();
  if (!data) return <View style={styles.screen}><Text style={[type.small, { padding: spacing.lg }]}>Loading…</Text></View>;
  const member = data.members.find((m) => m.id === route.memberId);
  if (!member) {
    return (
      <View style={styles.screen}>
        <CompactBand title={data.household.name} onBack={() => navigate(paths.settings())} />
        <Text style={[type.small, { padding: spacing.lg }]}>Nobody by that name is in the household any more.</Text>
      </View>
    );
  }
  return (
    <View style={styles.screen}>
      <CompactBand title={data.household.name} onBack={() => navigate(paths.settings())} />
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <PersonProfile data={data} member={member} refresh={refresh} />
      </ScrollView>
    </View>
  );
}

function PersonProfile({ data, member, refresh }: { data: HouseholdResponse; member: Member; refresh: () => Promise<void> }) {
  const { navigate } = useRouter();
  const index = data.members.findIndex((m) => m.id === member.id);
  const isYou = member.id === data.me;
  const joined = member.access?.status === 'active';
  const isChild = member.age != null ? member.age < 18 : member.isMinor;
  const pending = member.access?.status === 'invited';
  // A child is managed by the adults even with a phone of their own — the
  // joined lock is for adults only, matching the server (Codex, 1 Oct 2026).
  const canEdit = isChild || !(joined && !isYou);
  const owner = Boolean(member.access?.isLead);
  const role = owner ? 'OWNER' : isChild ? 'CHILD' : 'ADULT';
  const adultName = data.members.find((m) => !m.isMinor && m.id !== member.id)?.name;

  const [tab, setTab] = useQueryState<'food' | 'things'>('tastes', 'food', asOneOf(['food', 'things'] as const, 'food'));
  const [edit, setEdit] = useQueryState('edit', false, asFlag);
  const [noticed, setNoticed] = useQueryState('noticed', false, asFlag);
  const [photo, setPhoto] = useState(false);

  const relLine = owner ? 'Household owner' : [member.relationship ? RELATIONSHIP_LABEL[member.relationship] : null, member.age != null ? String(member.age) : null].filter(Boolean).join(' · ');
  const learned = data.learned.filter((l) => l.memberId === member.id);

  return (
    <>
      {/* Head */}
      <View style={styles.head}>
        <Press onPress={() => canEdit && setPhoto(true)} disabled={!canEdit} accessibilityRole="button" accessibilityLabel="Change photo">
          <Avatar name={member.name} index={index} size={88} url={member.avatarUrl} />
          {canEdit ? <View style={styles.cameraBadge}><Icon name="camera" size={15} color={CREAM} strokeWidth={2} /></View> : null}
        </Press>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={styles.name} numberOfLines={1}>{member.name}</Text>
          {relLine ? <Text style={styles.relLine}>{relLine}</Text> : null}
          <Row style={{ gap: 6, marginTop: 2 }}>
            <View style={styles.roleChip}><Text style={styles.roleChipText}>{role}</Text></View>
          </Row>
          {isChild && adultName ? <Text style={type.tiny}>Managed by you and {first(adultName)}</Text> : null}
        </View>
        <Press onPress={() => setEdit(true, { replace: true })} accessibilityRole="button" accessibilityLabel="Edit details" style={styles.pencil}><Icon name="edit" size={18} color={colors.ink} /></Press>
      </View>

      {/* Status */}
      {pending ? <PendingInvite member={member} refresh={refresh} /> : null}
      {joined && !isYou ? (
        <Row style={styles.joinedLine}><Icon name="phone" size={15} color={colors.accent} strokeWidth={2} /><Text style={styles.joinedText}>On their own phone{member.access?.activatedAt ? ` since ${shortDate(member.access.activatedAt)}` : ''}</Text></Row>
      ) : null}
      {isYou ? <HostProfileRow /> : null}

      {/* Tastes */}
      <View style={styles.menuWrap}>
        <InkMenu<'food' | 'things'> tabs={[{ key: 'food', label: 'Food & drink' }, { key: 'things', label: 'Things to do' }]} selected={tab} onSelect={(k) => setTab(k, { replace: true })} />
      </View>

      <View style={styles.panel}>
        {tab === 'food' ? (
          <>
            {canEdit ? <DietControl member={member} refresh={refresh} /> : (member.diet !== 'none' || member.halal || member.kosher ? <ReadOnlyDiet member={member} /> : null)}
            <TasteGroup member={member} refresh={refresh} kind="like" activity={false} canEdit={canEdit} />
            <TasteGroup member={member} refresh={refresh} kind="dislike" activity={false} canEdit={canEdit} />
          </>
        ) : (
          <>
            <TasteGroup member={member} refresh={refresh} kind="like" activity canEdit={canEdit} />
            <TasteGroup member={member} refresh={refresh} kind="dislike" activity canEdit={canEdit} />
          </>
        )}
      </View>

      {!canEdit ? (
        <Row style={styles.lockNote}><Icon name="locked" size={15} color={colors.inkMuted} strokeWidth={2} /><Text style={type.small}>{`Only ${first(member.name)} can change ${isChild ? 'their' : 'these'} tastes now they've joined.`}</Text></Row>
      ) : null}

      {/* Allergies (food only) */}
      {/* Allergies sit below the tabbed panel as a profile-level section (SE3 item 5),
          not inside Food & drink — present on either tab. */}
      <AllergiesRow member={member} refresh={refresh} canEdit={canEdit} />

      {/* Access needs */}
      <AccessRow member={member} refresh={refresh} canEdit={canEdit} />

      {/* What Epic has noticed */}
      {canEdit && learned.length ? (
        <Press onPress={() => setNoticed(true, { replace: true })} accessibilityRole="button" style={styles.collapsedRow}>
          <View style={styles.rowTile}><Icon name="sparkle" size={18} color={colors.ink} strokeWidth={2} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>What Epic has noticed</Text>
            <Text style={type.tiny}>{learned.length} things learning from visits</Text>
          </View>
          <Icon name="more" size={18} color={colors.inkFaint} />
        </Press>
      ) : null}

      {photo ? <PhotoSheet member={member} refresh={refresh} onClose={() => setPhoto(false)} /> : null}
      {edit ? <EditSheet data={data} member={member} refresh={refresh} canEdit={canEdit} onClose={() => setEdit(false, { replace: true })} /> : null}
      {noticed ? <NoticedSheet member={member} learned={learned} refresh={refresh} onClose={() => setNoticed(false, { replace: true })} /> : null}
    </>
  );
}

/** Your own page, if you host: a warm-grey row to your host profile (SE3 item 2). */
function HostProfileRow() {
  const { navigate } = useRouter();
  const [hosts, setHosts] = useState(false);
  useEffect(() => { api.hostHome().then((h) => setHosts(Boolean(h.host))).catch(() => setHosts(false)); }, []);
  if (!hosts) return null;
  return (
    <Press onPress={() => navigate(paths.host())} accessibilityRole="button" style={styles.hostRow}>
      <View style={{ flex: 1 }}><Text style={styles.rowTitle}>Your host profile</Text><Text style={type.tiny}>On the Host tab</Text></View>
      <Icon name="more" size={18} color={colors.inkFaint} />
    </Press>
  );
}

// --- diet -------------------------------------------------------------------

function DietControl({ member, refresh }: { member: Member; refresh: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const setDiet = async (d: MainDiet) => { setOpen(false); await api.updateMember(member.id, { diet: d }); await refresh(); };
  const faith = async (which: 'halal' | 'kosher') => { await api.updateMember(member.id, { [which]: !member[which] } as any); await refresh(); };
  return (
    <View style={{ gap: 10 }}>
      <Press onPress={() => setOpen((o) => !o)} accessibilityRole="button" style={[styles.dropdown, open && styles.dropdownOpen]}>
        <Text style={styles.dropdownLabel}>Diet</Text>
        {/* Nothing is picked by default — the closed box shows only "Diet". */}
        <Text style={styles.dropdownValue}>{member.diet === 'none' ? '' : DIET_LABEL[member.diet]}</Text>
        <Icon name={open ? 'collapse' : 'expand'} size={16} color={colors.ink} strokeWidth={2.2} />
      </Press>
      {open ? (
        <View style={styles.dropdownList}>
          {DIET_OPTS.map((d) => {
            const on = member.diet === d;
            return (
              <Press key={d} onPress={() => setDiet(on && d !== 'none' ? 'none' : d)} accessibilityRole="button" style={styles.dropdownItem}>
                <Text style={[type.body, on && { fontWeight: '700' }]}>{DIET_LABEL[d]}</Text>
                {on ? <View style={styles.limeTick}><Icon name="check" size={13} color={INK} strokeWidth={3} /></View> : null}
              </Press>
            );
          })}
        </View>
      ) : null}
      <Row style={{ gap: 8 }}>
        <FaithTile label="Halal" on={member.halal} onPress={() => faith('halal')} />
        <FaithTile label="Kosher" on={member.kosher} onPress={() => faith('kosher')} />
      </Row>
    </View>
  );
}

function ReadOnlyDiet({ member }: { member: Member }) {
  const bits = [member.diet !== 'none' ? DIET_LABEL[member.diet] : null, member.halal ? 'Halal' : null, member.kosher ? 'Kosher' : null].filter(Boolean);
  return <View><Text style={styles.kicker}>Diet</Text><Text style={type.body}>{bits.join(' · ')}</Text></View>;
}

function FaithTile({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Press onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={styles.faithTile}>
      <View style={[styles.square, on ? styles.squareOn : styles.squareOff]}>{on ? <Icon name="check" size={13} color={INK} strokeWidth={3} /> : null}</View>
      <Text style={styles.faithLabel}>{label}</Text>
    </Press>
  );
}

// --- likes / dislikes -------------------------------------------------------

function TasteGroup({ member, refresh, kind, activity, canEdit }: { member: Member; refresh: () => Promise<void>; kind: 'like' | 'dislike'; activity: boolean; canEdit: boolean }) {
  const [picking, setPicking] = useState(false);
  const all = kind === 'like' ? member.likes : member.dislikes;
  const items = all.filter((c) => (activity ? isActivity(c) : !isActivity(c))).sort(kind === 'like' ? byFavourite : undefined);
  const have = useMemo(() => new Set([...member.likes, ...member.dislikes].map((c) => c.conceptKey).filter(Boolean) as string[]), [member]);
  const add = async (value: string, conceptKey?: string) => { try { await api.addConstraint(member.id, { kind, value, conceptKey }); } catch (e: any) { showToast(e?.body?.message || 'Already on the other list'); } await refresh(); };
  const remove = async (c: Constraint) => { await api.deleteConstraint(c.id); await refresh(); };
  const toggleFav = async (c: Constraint) => { if (kind !== 'like') return; await api.updateConstraint(c.id, { favourite: !c.favourite }); await refresh(); };
  const title = kind === 'like' ? (activity ? 'Loves doing · tap for a favourite' : 'Likes · tap for a favourite') : (activity ? 'Would rather not' : 'Dislikes');

  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.kicker}>{title}</Text>
      <Wrap>
        {items.map((c) => (
          <Chip key={c.id} label={c.value} tone={kind === 'like' ? 'like' : 'dislike'} icon={kind === 'like' && c.favourite ? 'favourite' : undefined} iconFill
            onPress={kind === 'like' && canEdit ? () => toggleFav(c) : undefined}
            onRemove={canEdit ? () => remove(c) : undefined} />
        ))}
        {!items.length && !canEdit ? <Text style={type.tiny}>Nothing set</Text> : null}
      </Wrap>
      {canEdit ? (
        <>
          <SuggestInput
            placeholder={kind === 'like' ? `Add a ${activity ? 'thing you love' : 'like'}` : `Add a ${activity ? 'thing to avoid' : 'dislike'}`}
            kinds={activity ? ACTIVITY_KINDS : FOOD_KINDS}
            onPick={(s) => add(s.label, s.key)} onFree={(v) => add(v)}
            onFocus={() => setPicking(true)}
          />
          {picking ? <TastePicker section={activity ? 'activities' : 'food'} mode={kind} already={have} onPick={(p) => add(p.label, p.key)} onClose={() => setPicking(false)} /> : null}
        </>
      ) : null}
    </View>
  );
}

// --- allergies (SE5) --------------------------------------------------------

function AllergiesRow({ member, refresh, canEdit }: { member: Member; refresh: () => Promise<void>; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const chosen = useMemo(() => new Set(member.allergens.map((c) => c.value)), [member.allergens]);
  const anyRest = ALLERGENS_REST.some((a) => chosen.has(a));
  const [showAll, setShowAll] = useState(anyRest);
  const [note, setNote] = useState(member.allergenNote ?? '');
  const list = showAll ? [...ALLERGENS_COMMON, ...ALLERGENS_REST] : ALLERGENS_COMMON;
  const toggle = async (key: string) => {
    const existing = member.allergens.find((c) => c.value === key);
    if (existing) await api.deleteConstraint(existing.id);
    else await api.addConstraint(member.id, { kind: 'allergen', value: key });
    await refresh();
  };
  const saveNote = async () => {
    const trimmed = note.trim();
    if (trimmed === (member.allergenNote ?? '')) return;
    // '' is the clear sentinel: updateMember keeps the old value on null,
    // and clears only on the empty string (Codex, 1 Oct 2026).
    await api.updateMember(member.id, { allergenNote: trimmed });
    await refresh();
  };
  // An allergy kept only as a private note (migration 319, or said aloud and
  // unmatched) is still an allergy: it counts and it shows, or there is no way
  // to see or clear what was preserved (Codex, 1 Oct 2026).
  const hasAny = member.allergens.length > 0 || Boolean(member.allergenNote);
  const noteList = [
    ...member.allergens.map((c) => ALLERGEN_LABEL[c.value] ?? cap(c.value)),
    ...(member.allergenNote ? [member.allergenNote] : []),
  ].join(', ');

  if (!open) {
    if (!canEdit && !hasAny) return <View style={styles.collapsedRow}><View style={[styles.rowTile, styles.rowTileRed]}><Icon name="allergen" size={18} color={colors.allergen} strokeWidth={2.2} /></View><Text style={styles.rowTitle}>No allergies</Text></View>;
    return (
      <Press onPress={() => canEdit && setOpen(true)} disabled={!canEdit} accessibilityRole="button" style={styles.collapsedRow}>
        <View style={[styles.rowTile, styles.rowTileRed]}><Icon name="allergen" size={18} color={colors.allergen} strokeWidth={2.2} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{hasAny ? 'Allergies' : 'Any allergies?'}</Text>
          {hasAny ? <Text style={styles.allergenList}>{noteList}</Text> : null}
        </View>
        {canEdit ? <Text style={styles.rowAction}>{hasAny ? 'Edit' : 'Add'}</Text> : null}
        <Icon name="expand" size={18} color={colors.inkFaint} />
      </Press>
    );
  }
  return (
    <View style={styles.openBlock}>
      <Row style={{ gap: 10, alignItems: 'flex-start' }}>
        <Icon name="allergen" size={22} color={colors.allergen} strokeWidth={2.2} />
        <View style={{ flex: 1 }}>
          <Text style={styles.openTitle}>Allergies</Text>
          <Text style={styles.openHint}>Hides places that can't avoid it</Text>
        </View>
        <Press onPress={() => setOpen(false)} accessibilityRole="button"><Icon name="collapse" size={18} color={colors.inkFaint} /></Press>
      </Row>
      <Wrap>
        {list.map((key) => {
          const on = chosen.has(key);
          return (
            <Press key={key} onPress={() => toggle(key)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.allergenChip, on ? styles.allergenOn : styles.allergenOff]}>
              {on ? <Icon name="check" size={13} color={CREAM} strokeWidth={3} /> : null}
              <Text style={[styles.allergenChipText, on && { color: CREAM }]}>{ALLERGEN_LABEL[key]}</Text>
            </Press>
          );
        })}
      </Wrap>
      {!showAll ? <Press onPress={() => setShowAll(true)} accessibilityRole="button"><Text style={styles.showAll}>Show all 14</Text></Press> : null}
      <Text style={styles.openHint}>Anything else — kept as a private note; it can't filter places</Text>
      <TextInput
        value={note}
        onChangeText={setNote}
        onBlur={saveNote}
        placeholder="e.g. latex"
        placeholderTextColor={colors.inkFaint}
        style={styles.input}
      />
    </View>
  );
}

// --- access needs (SX4) -----------------------------------------------------

function AccessRow({ member, refresh, canEdit }: { member: Member; refresh: () => Promise<void>; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const chosen = member.accessNeeds ?? [];
  const toggle = async (key: AccessNeed) => {
    const next = chosen.includes(key) ? chosen.filter((a) => a !== key) : [...chosen, key];
    await api.updateMember(member.id, { accessNeeds: next }); await refresh();
  };
  if (!open) {
    if (!canEdit && !chosen.length) return <View style={styles.collapsedRow}><View style={styles.rowTile}><Icon name="accessible" size={18} color={colors.ink} strokeWidth={2} /></View><Text style={styles.rowTitle}>No access needs</Text></View>;
    const label = chosen.length ? chosen.map((a) => ACCESS_OPTS.find((o) => o.key === a)?.label).filter(Boolean).join(', ') : null;
    return (
      <Press onPress={() => canEdit && setOpen(true)} disabled={!canEdit} accessibilityRole="button" style={styles.collapsedRow}>
        <View style={styles.rowTile}><Icon name="accessible" size={18} color={colors.ink} strokeWidth={2} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{chosen.length ? 'Access needs' : 'Any access needs?'}</Text>
          {label ? <Text style={type.tiny}>{label}</Text> : null}
        </View>
        {canEdit ? <Text style={styles.rowAction}>{chosen.length ? 'Edit' : 'Add'}</Text> : null}
        <Icon name="expand" size={18} color={colors.inkFaint} />
      </Press>
    );
  }
  return (
    <View style={styles.openBlock}>
      <Row style={{ gap: 10, alignItems: 'flex-start' }}>
        <Icon name="accessible" size={22} color={colors.ink} strokeWidth={2} />
        <View style={{ flex: 1 }}>
          <Text style={styles.openTitle}>Access needs</Text>
          <Text style={styles.openHintMuted}>Ranks places that suit {first(member.name)} higher</Text>
        </View>
        <Press onPress={() => setOpen(false)} accessibilityRole="button"><Icon name="collapse" size={18} color={colors.inkFaint} /></Press>
      </Row>
      {ACCESS_OPTS.map((o) => {
        const on = chosen.includes(o.key);
        return (
          <Press key={o.key} onPress={() => toggle(o.key)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={styles.checkRow}>
            <View style={[styles.square, on ? styles.squareOn : styles.squareOff]}>{on ? <Icon name="check" size={13} color={INK} strokeWidth={3} /> : null}</View>
            <View style={{ flex: 1 }}>
              <Text style={type.body}>{o.label}</Text>
              {o.filters ? <Text style={styles.openHintMuted}>Hides places without step-free access</Text> : null}
            </View>
          </Press>
        );
      })}
    </View>
  );
}

// --- What Epic has noticed (SX5) --------------------------------------------

function NoticedSheet({ member, learned, refresh, onClose }: { member: Member; learned: Learned[]; refresh: () => Promise<void>; onClose: () => void }) {
  const keep = async (l: Learned) => { await api.addConstraint(member.id, { kind: l.kind === 'dislike' ? 'dislike' : 'like', value: l.label, conceptKey: l.conceptKey }); showToast(`${l.label} kept`); await refresh(); };
  const forget = async (l: Learned) => { await api.updateMember(member.id, { neverLearn: [...(member.neverLearn ?? []), l.label] }); showToast(`Epic will stop learning ${l.label}`); await refresh(); onClose(); };
  return (
    <Sheet title="What Epic has noticed" onDone={onClose} onClose={onClose}>
      {learned.map((l) => {
        const seen = Math.min(3, l.count);
        return (
          <View key={l.conceptKey} style={styles.noticedRow}>
            <View style={{ flex: 1 }}>
              <Text style={type.h3}>{l.label}</Text>
              <Text style={[type.tiny, l.confirmed && { color: colors.accent, fontWeight: '700' }]}>{l.confirmed ? 'Learned' : `${seen} of ${l.threshold} visits`}</Text>
              <Row style={{ gap: 4, marginTop: 6 }}>
                {[0, 1, 2].map((i) => <View key={i} style={[styles.seg, (l.confirmed || i < seen) && { backgroundColor: l.confirmed ? LIME : colors.ink }]} />)}
              </Row>
            </View>
            <Press onPress={() => keep(l)} accessibilityRole="button"><Text style={styles.rowAction}>Keep</Text></Press>
            <Press onPress={() => forget(l)} accessibilityRole="button"><Text style={[styles.rowAction, { color: colors.inkMuted }]}>Forget</Text></Press>
          </View>
        );
      })}
    </Sheet>
  );
}

// --- pending invite (SE3 status) --------------------------------------------

function PendingInvite({ member, refresh }: { member: Member; refresh: () => Promise<void> }) {
  const [url, setUrl] = useState<string | null>(null);
  const resend = async () => { try { const r = await api.inviteMember(member.id, { channels: member.access?.email ? ['email'] : ['sms'] }); setUrl(r.invitation.url); showToast(r.invitation.sent ? 'Invite sent' : 'Link ready to copy'); await refresh(); } catch (e: any) { showToast(e?.body?.message || 'Could not resend'); } };
  const copy = async () => { const link = url; if (link && typeof navigator !== 'undefined' && navigator.clipboard) { await navigator.clipboard.writeText(link); showToast('Link copied'); } else { await resend(); } };
  return (
    <View style={styles.tintBlock}>
      <Text style={styles.tintTitle}>Invited{member.access?.invitedAt ? ` ${shortDate(member.access.invitedAt)}` : ''} · not opened yet</Text>
      {member.access?.mobile || member.access?.email ? <Text style={styles.tintBody}>Sent to {member.access?.mobile ?? member.access?.email}</Text> : null}
      <Row style={{ gap: 8, marginTop: 10 }}>
        <Button kind="secondary" label="Resend" onPress={resend} />
        <Button kind="secondary" label="Copy link" onPress={copy} />
      </Row>
    </View>
  );
}

// --- photo flow (SX1–SX3) ---------------------------------------------------

function PhotoSheet({ member, refresh, onClose }: { member: Member; refresh: () => Promise<void>; onClose: () => void }) {
  const prev = member.avatarUrl;
  const set = async (url: string | null) => {
    await api.updateMember(member.id, { avatarUrl: url ?? '' }); await refresh(); onClose();
    showToast(url ? 'Photo saved' : 'Photo removed', { undo: async () => { await api.updateMember(member.id, { avatarUrl: prev ?? '' }); await refresh(); } });
  };
  const pick = async (source: 'camera' | 'library') => { const url = await pickSquarePhoto(source); if (url) await set(url); };
  return (
    <Sheet title={`${first(member.name)}'s photo`} onClose={onClose}>
      <Press onPress={() => pick('camera')} accessibilityRole="button" style={styles.sourceRow}><Icon name="camera" size={18} color={colors.ink} strokeWidth={2} /><Text style={type.body}>Take photo</Text></Press>
      <Press onPress={() => pick('library')} accessibilityRole="button" style={styles.sourceRow}><Icon name="image" size={18} color={colors.ink} strokeWidth={2} /><Text style={type.body}>Choose photo</Text></Press>
      {prev ? <Press onPress={() => set(null)} accessibilityRole="button" style={styles.sourceRow}><Icon name="delete" size={18} color={colors.overrun} strokeWidth={2} /><Text style={[type.body, { color: colors.overrun }]}>Remove photo</Text></Press> : null}
      <Press onPress={onClose} accessibilityRole="button" style={[styles.sourceRow, { justifyContent: 'center' }]}><Text style={[type.body, { color: colors.inkMuted }]}>Cancel</Text></Press>
    </Sheet>
  );
}

/**
 * Take (camera) or choose (library), crop square, resize to 512 and re-encode —
 * which strips EXIF and location (SX1 "Take photo" = capture, "Choose" = library).
 */
async function pickSquarePhoto(source: 'camera' | 'library'): Promise<string | null> {
  const opts = { mediaTypes: 'images' as const, allowsEditing: true, aspect: [1, 1] as [number, number], quality: 1, base64: false };
  const res = await (source === 'camera' ? ImagePicker.launchCameraAsync(opts) : ImagePicker.launchImageLibraryAsync(opts)).catch(() => null);
  if (!res || res.canceled || !res.assets?.[0]) return null;
  const ctx = ImageManipulator.ImageManipulator.manipulate(res.assets[0].uri);
  ctx.resize({ width: 512, height: 512 });
  const rendered = await ctx.renderAsync();
  const saved = await rendered.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: 0.8, base64: true });
  return saved.base64 ? `data:image/jpeg;base64,${saved.base64}` : null;
}

// --- edit sheet (SE6 / SE6b) ------------------------------------------------

function EditSheet({ data, member, refresh, canEdit, onClose }: { data: HouseholdResponse; member: Member; refresh: () => Promise<void>; canEdit: boolean; onClose: () => void }) {
  const { navigate } = useRouter();
  const isYou = member.id === data.me;
  const owner = Boolean(member.access?.isLead);
  const [name, setName] = useState(member.name);
  const [rel, setRel] = useState(member.relationship ?? '');
  const [birth, setBirth] = useState<string | null>(member.birthDate ?? null);
  const [mobile, setMobile] = useState(member.mobile ?? '');
  const [login, setLogin] = useState(Boolean(member.access && member.access.status !== 'none'));
  const [resend, setResend] = useState(true);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);

  const isPending = member.access?.status === 'invited';
  const numberChanged = (mobile.trim() || null) !== (member.mobile ?? null);
  const age = birth ? ageFromISO(birth) : member.age;
  const thirteenPlus = age == null ? !member.isMinor : age >= 13;
  // Who may remove: the owner anyone but self; a joined adult children only.
  const callerOwner = data.members.find((m) => m.id === data.me)?.access?.isLead;
  const targetIsChild = (member.age != null ? member.age < 18 : member.isMinor);
  const mayRemove = !isYou && (callerOwner || targetIsChild);

  const save = async () => {
    setBusy(true);
    try {
      await api.updateMember(member.id, {
        name: name.trim() || undefined,
        relationship: isYou ? undefined : (rel || null),
        birthDate: birth,
        mobile: thirteenPlus ? (mobile.trim() || null) : null,
      });
      if (login && thirteenPlus && member.access?.status === 'none' && mobile.trim()) {
        await api.inviteMember(member.id, { mobile: mobile.trim(), channels: ['sms'] }).catch(() => null);
      }
      // SE6b: a pending invite whose number changed, with the resend box on,
      // re-sends to the new number on save.
      if (isPending && numberChanged && resend && mobile.trim()) {
        await api.inviteMember(member.id, { mobile: mobile.trim(), channels: ['sms'] }).catch(() => null);
        await refresh(); onClose();
        showToast(`Saved · invite sent to ${mobile.trim()}`);
        return;
      }
      await refresh(); onClose();
    } catch (e: any) { showToast(e?.body?.message || 'Could not save'); } finally { setBusy(false); }
  };

  if (confirmRemove) {
    const body = member.access?.status === 'invited'
      ? `Their invite to ${member.access?.mobile ?? member.access?.email ?? 'them'} is cancelled, and their allergies, diet and likes are deleted.`
      : member.access?.status === 'active'
        ? `${first(member.name)} loses access to the household straight away. Their own profile and tastes leave with them.`
        : `${first(member.name)}'s allergies, diet and likes are deleted.`;
    return (
      <Sheet title={`Remove ${first(member.name)} from the household?`} onCancel={() => setConfirmRemove(false)} cancelLabel="Cancel" onClose={onClose}>
        <Text style={type.body}>{body}</Text>
        <Button kind="danger" label={`Remove ${first(member.name)}`} onPress={async () => {
          // Soft delete: hide at once, hard-delete when the 3.5s Undo lapses.
          onClose();
          let undone = false;
          showToast(`${first(member.name)} removed`, { undo: () => { undone = true; } });
          setTimeout(async () => { if (undone) return; try { await api.deleteMember(member.id); navigate(paths.settings(), { replace: true }); await refresh(); } catch (e: any) { showToast(e?.body?.message || 'Could not remove'); } }, 3500);
        }} />
      </Sheet>
    );
  }

  return (
    <Sheet title={`${first(member.name)}'s details`} fromTop={56} onCancel={onClose} cancelLabel="Cancel" onDone={canEdit ? save : onClose} doneLabel={canEdit ? 'Save' : 'Done'} doneDisabled={busy} onClose={onClose}>
      <Field label="Name"><TextInput editable={canEdit} value={name} onChangeText={setName} style={styles.input} placeholderTextColor={colors.inkFaint} /></Field>
      {!isYou ? (
        <Field label={`Relationship to ${first(data.members.find((m) => m.access?.isLead)?.name ?? 'you')}`}>
          <Wrap>{RELATIONSHIPS.map((r) => <Chip key={r} label={RELATIONSHIP_LABEL[r]} selected={rel === r} onPress={canEdit ? () => setRel(r) : undefined} />)}</Wrap>
        </Field>
      ) : null}
      <View>
        <BirthdayPicker label="Birthday" value={birth} onChange={(iso) => setBirth(iso ?? null)} />
        <Text style={type.tiny}>Only the age is shown{age != null ? `: ${age}` : ''}</Text>
      </View>
      {thirteenPlus ? (
        <>
          <Field label="Mobile"><TextInput editable={canEdit} value={mobile} onChangeText={setMobile} keyboardType="phone-pad" placeholder="07700 900000" placeholderTextColor={colors.inkFaint} style={styles.input} /></Field>
          {member.access?.status === 'none' ? (
            <Press onPress={() => canEdit && setLogin((v) => !v)} accessibilityRole="switch" accessibilityState={{ checked: login }} style={styles.checkRow}>
              <View style={[styles.square, login ? styles.squareOn : styles.squareOff]}>{login ? <Icon name="check" size={13} color={INK} strokeWidth={3} /> : null}</View>
              <View style={{ flex: 1 }}><Text style={type.body}>Give {first(member.name)} their own login</Text><Text style={type.tiny}>Sends an invite to the number above</Text></View>
            </Press>
          ) : null}
          {/* SE6b: a pending invite whose number is being changed. On by default;
              saving with it on re-sends to the new number. */}
          {isPending && numberChanged ? (
            <Press onPress={() => canEdit && setResend((v) => !v)} accessibilityRole="switch" accessibilityState={{ checked: resend }} style={[styles.checkRow, styles.resendTint]}>
              <View style={[styles.square, resend ? styles.squareOn : styles.squareOff]}>{resend ? <Icon name="check" size={13} color={INK} strokeWidth={3} /> : null}</View>
              <Text style={[type.body, { flex: 1, color: colors.accent }]}>Resend the invite to the new number</Text>
            </Press>
          ) : null}
        </>
      ) : null}
      {mayRemove ? (
        <View style={styles.removeFoot}>
          <Press onPress={() => setConfirmRemove(true)} accessibilityRole="button"><Text style={styles.removeLink}>Remove {first(member.name)} from household</Text></Press>
        </View>
      ) : null}
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={{ gap: 6 }}><Text style={styles.kicker}>{label}</Text>{children}</View>;
}

// --- helpers ----------------------------------------------------------------

const shortDate = (iso: string) => { try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); } catch { return ''; } };
const ageFromISO = (iso: string) => { const b = new Date(iso); const n = new Date(); let a = n.getFullYear() - b.getFullYear(); if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a -= 1; return a; };

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  page: { padding: 0, paddingBottom: 60, width: '100%', maxWidth: 760, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: 20 },
  cameraBadge: { position: "absolute", right: -2, bottom: -2, width: 30, height: 30, borderRadius: 15, backgroundColor: INK, borderWidth: 3, borderColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: fonts.heading, fontSize: 28, fontWeight: '800', letterSpacing: -0.56, color: colors.ink },
  relLine: { fontFamily: fonts.body, fontSize: 14, color: colors.inkMuted },
  roleChip: { backgroundColor: colors.warm, paddingHorizontal: 8, paddingVertical: 3 },
  roleChipText: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: colors.inkMuted },
  pencil: { width: 44, height: 44, borderWidth: BORDER, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  joinedLine: { gap: 8, paddingHorizontal: 20, paddingBottom: 12 },
  hostRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.warm, padding: 14, marginHorizontal: 20, marginBottom: 6 },
  joinedText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.accent },
  menuWrap: { marginTop: 4 },
  panel: { padding: 22, gap: 16 },
  kicker: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.88, textTransform: 'uppercase', color: colors.inkMuted },
  // diet dropdown
  dropdown: { height: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderWidth: 1.5, borderColor: colors.ruleSoft },
  dropdownOpen: { borderWidth: BORDER, borderColor: colors.ink },
  dropdownLabel: { fontFamily: fonts.body, fontSize: 15, color: colors.inkMuted },
  dropdownValue: { flex: 1, fontFamily: fonts.body, fontSize: 15, fontWeight: '700', color: colors.ink },
  dropdownList: { borderWidth: BORDER, borderColor: colors.ink, borderTopWidth: 0, marginTop: -10 },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48, borderTopWidth: 1, borderTopColor: colors.ruleSoft },
  faithTile: { flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderWidth: 1.5, borderColor: colors.ruleSoft },
  faithLabel: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: colors.ink },
  square: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  squareOn: { backgroundColor: LIME },
  limeTick: { width: 22, height: 22, backgroundColor: LIME, alignItems: 'center', justifyContent: 'center' },
  squareOff: { borderWidth: 1.5, borderColor: colors.ruleSoft },
  // collapsed rows
  collapsedRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 15, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  rowTile: { width: 36, height: 36, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center' },
  rowTileRed: {},
  rowTitle: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: colors.ink },
  rowAction: { fontFamily: fonts.body, fontSize: 14.5, fontWeight: '700', color: colors.ink },
  allergenList: { fontFamily: fonts.body, fontSize: 13.5, fontWeight: '700', color: colors.allergen, marginTop: 2 },
  lockNote: { gap: 8, backgroundColor: colors.warm, padding: 12, marginHorizontal: 20 },
  // open blocks
  openBlock: { padding: 20, gap: 14, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  openTitle: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 20, letterSpacing: -0.4, color: colors.ink },
  openHint: { fontFamily: fonts.body, fontSize: 13.5, fontWeight: '600', color: colors.allergen, marginTop: 3 },
  openHintMuted: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.inkMuted },
  allergenChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 12 },
  allergenOn: { backgroundColor: colors.allergen },
  allergenOff: { borderWidth: 1.5, borderColor: colors.ruleSoft },
  allergenChipText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: colors.ink },
  showAll: { fontFamily: fonts.body, fontSize: 13.5, fontWeight: '700', color: colors.ink, textDecorationLine: 'underline' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  resendTint: { backgroundColor: colors.surfaceMuted, paddingHorizontal: 12 },
  // noticed
  noticedRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  seg: { width: 26, height: 6, backgroundColor: colors.ruleSoft },
  // tint block (pending)
  tintBlock: { backgroundColor: colors.surfaceMuted, padding: 14, marginHorizontal: 20, marginBottom: 6 },
  tintTitle: { fontFamily: fonts.body, fontSize: 15, fontWeight: '700', color: colors.accent },
  tintBody: { fontFamily: fonts.body, fontSize: 13, color: colors.accent, marginTop: 2 },
  // photo source
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  // edit
  input: { minHeight: 48, paddingHorizontal: 12, borderWidth: 1.5, borderColor: colors.ruleSoft, backgroundColor: colors.surface, fontSize: 15, color: colors.ink },
  removeFoot: { marginTop: 12, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.ruleSoft },
  removeLink: { fontFamily: fonts.body, fontSize: 15, fontWeight: '700', color: colors.overrun },
});
