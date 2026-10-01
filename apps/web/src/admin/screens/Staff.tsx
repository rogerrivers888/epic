/**
 * Staff — who can log in to the back office, and what their role lets them open.
 *
 * Signed off 1 Oct 2026 (Supporting docs › EPIC staff management, ST1–ST5). The
 * owner adds a colleague, gives them a role and issues a single-use login link;
 * from then on he can change their role, send a new link, log them out
 * everywhere, suspend them or remove them.
 *
 * Drawn on the back office's own dark surface (`desk`), like the filing desk: the
 * design is the pinned-dark back office, and its exact neutrals are the `desk`
 * tokens. Lime is the brand moment — the primary action, the selected role, the
 * invited badge — and always carries ink.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import { Icon } from '../../components/Icon';
import { useViewport } from '../../hooks/useViewport';
import { api, ApiError, type StaffInvitation, type StaffMember, type StaffRole } from '../../api';
import { desk, fonts, LIME, ON_LIME } from '../../theme';

type Filter = 'All' | 'Active' | 'Invited' | 'Suspended';
type Mode = null | 'add' | 'sent' | 'person';

// ---------------------------------------------------------------------------
// dates
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const firstName = (name?: string | null) => String(name || '').trim().split(/\s+/)[0] || 'them';
const pad = (n: number) => String(n).padStart(2, '0');

/** "29 Sep" — day and short month, no year (the list's invited badge). */
const shortDate = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};
/** "29 Sep 2026" — the facts grid. */
const fullDate = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
/** "Today, 09:12" · "Yesterday, 17:40" · "28 Sep 2026" · "Never". */
const lastSeen = (iso?: string | null) => {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return `Today, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay(d, yesterday)) return `Yesterday, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return fullDate(iso);
};

// ---------------------------------------------------------------------------
// screen
// ---------------------------------------------------------------------------

export function Staff({ canManage = true }: { canManage?: boolean } = {}) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [roles, setRoles] = useState<StaffRole[]>([]);
  const [mailOn, setMailOn] = useState(true);
  const [filter, setFilter] = useState<Filter>('All');
  const [mode, setMode] = useState<Mode>(null);
  const [curId, setCurId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // add form
  const [fName, setFName] = useState('');
  const [fEmail, setFEmail] = useState('');
  const [fRole, setFRole] = useState<string | null>(null);
  const [fErr, setFErr] = useState('');

  // sent view
  const [invitation, setInvitation] = useState<StaffInvitation | null>(null);
  const [sentExtra, setSentExtra] = useState('');
  const [copied, setCopied] = useState(false);

  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((t: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(''), 4500);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const load = useCallback(async () => {
    try {
      const data = await api.adminStaff();
      setStaff(data.staff);
      setRoles(data.roles);
      setMailOn(Boolean(data.mail?.configured));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the staff list.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const supportRole = useMemo(() => roles.find((r) => r.key === 'support') ?? roles[0] ?? null, [roles]);
  const cur = useMemo(() => staff.find((s) => s.id === curId) ?? null, [staff, curId]);

  const counts = (k: Filter) => (k === 'All' ? staff.length : staff.filter((s) => s.status === k.toLowerCase()).length);
  const rows = staff.filter((s) => filter === 'All' || s.status === filter.toLowerCase());

  const openAdd = () => {
    setFName(''); setFEmail(''); setFRole(supportRole?.id ?? null); setFErr('');
    setCurId(null); setMode('add');
  };
  const close = () => { setMode(null); setError(null); };

  const submit = async () => {
    const name = fName.trim();
    const email = fEmail.trim().toLowerCase();
    if (!name) return setFErr('Add their name');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setFErr("That email doesn't look right");
    if (staff.some((s) => (s.email || '').toLowerCase() === email)) return setFErr('Already on staff');
    if (!fRole) return setFErr('Pick a role');
    try {
      const res = await api.adminAddStaff({ name, email, roleId: fRole });
      await load();
      setCurId(res.staff.id);
      setInvitation(res.invitation);
      setSentExtra(res.existedAsCustomer ? `${firstName(res.staff.name)} already has an Epic account; they now have back-office access too.` : '');
      setCopied(false);
      setMode('sent');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'already_staff') return setFErr('Already on staff');
      setFErr(e instanceof ApiError ? e.message : 'Could not add them.');
    }
  };

  const openPerson = (id: string) => { setCurId(id); setCopied(false); setMode('person'); };

  const changeRole = async (roleId: string) => {
    if (!cur || cur.roleId === roleId) return;
    try {
      const res = await api.adminStaffRole(cur.id, roleId);
      await load();
      say(`${firstName(res.staff.name)} is now ${res.staff.role}`);
    } catch (e) { say(e instanceof ApiError ? e.message : 'Could not change the role.'); }
  };

  const sendLink = async () => {
    if (!cur) return;
    try {
      const res = await api.adminStaffLink(cur.id);
      await load();
      setInvitation(res.invitation);
      setSentExtra('');
      setCopied(false);
      setMode('sent');
    } catch (e) { say(e instanceof ApiError ? e.message : 'Could not send a link.'); }
  };

  const act = async (fn: () => Promise<unknown>, done: string, thenClose = false) => {
    try { await fn(); await load(); say(done); if (thenClose) setMode(null); }
    catch (e) { say(e instanceof ApiError ? e.message : 'That did not work.'); }
  };

  const copyLink = () => {
    if (!invitation?.url) return;
    try { navigator.clipboard?.writeText(invitation.url); } catch { /* clipboard may be blocked */ }
    setCopied(true);
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* header */}
        <View style={styles.header}>
          <View style={{ flexShrink: 1, gap: 5 }}>
            <Text style={styles.title}>Staff</Text>
            <Text style={styles.sub}>Who can log in to the back office, and what their role lets them open</Text>
          </View>
          {canManage ? (
            <Press onPress={openAdd} style={({ hovered }: any) => [styles.addBtn, hovered && styles.addBtnHover]}>
              <Text style={styles.addLabel}>Add staff</Text>
              <Icon name="add" size={14} color={ON_LIME} strokeWidth={2.4} />
            </Press>
          ) : null}
        </View>

        {/* filter */}
        <View style={styles.filters}>
          {(['All', 'Active', 'Invited', 'Suspended'] as Filter[]).map((k) => {
            const on = filter === k;
            return (
              <Press key={k} onPress={() => setFilter(k)} effect="none" style={[styles.segment, on && styles.segmentOn]}>
                <Text style={[styles.segmentLabel, on && styles.segmentLabelOn]}>{k} {counts(k)}</Text>
              </Press>
            );
          })}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* table */}
        <View>
          <View style={styles.headRow}>
            {['Name', 'Email', 'Role', 'Status', 'Last logged in'].map((h) => (
              <Text key={h} style={styles.headCell}>{h}</Text>
            ))}
          </View>
          {rows.map((p) => (
            <Press key={p.id} onPress={() => openPerson(p.id)} effect="none"
              style={({ hovered }: any) => [styles.row, (hovered || (p.id === curId && mode)) && styles.rowOn]}>
              <Text style={styles.cellName} numberOfLines={1}>{p.name || '—'}</Text>
              <Text style={styles.cellMuted} numberOfLines={1}>{p.email || '—'}</Text>
              <Text style={styles.cell} numberOfLines={1}>{p.role}</Text>
              <Text style={[styles.cell, statusStyle(p.status)]} numberOfLines={1}>{statusLabel(p)}</Text>
              <Text style={styles.cellMuted} numberOfLines={1}>{lastSeen(p.lastSeenAt)}</Text>
            </Press>
          ))}
          {rows.length === 0 ? <Text style={styles.empty}>Nobody here yet.</Text> : null}
        </View>
      </ScrollView>

      {mode ? (
        <Drawer
          mode={mode} cur={cur} roles={roles} mailOn={mailOn} canManage={canManage}
          fName={fName} fEmail={fEmail} fRole={fRole} fErr={fErr}
          setFName={(v) => { setFName(v); setFErr(''); }}
          setFEmail={(v) => { setFEmail(v); setFErr(''); }}
          setFRole={setFRole}
          invitation={invitation} sentExtra={sentExtra} copied={copied}
          onSubmit={submit} onClose={close} onCopy={copyLink}
          onChangeRole={changeRole} onSendLink={sendLink}
          onSuspend={() => cur && act(() => api.adminStaffSuspend(cur.id), `${firstName(cur.name)} is suspended and logged out`)}
          onUnsuspend={() => cur && act(() => api.adminStaffUnsuspend(cur.id), `${firstName(cur.name)} can log in again`)}
          onLogoutAll={() => cur && act(() => api.adminStaffLogoutAll(cur.id), `${firstName(cur.name)} is logged out on every device`)}
          onRemove={() => cur && act(() => api.adminRemoveStaff(cur.id), `${firstName(cur.name)} removed from staff`, true)}
        />
      ) : null}

      {toast ? <Toast text={toast} /> : null}
    </View>
  );
}

const statusLabel = (p: StaffMember) => (p.status === 'invited' ? `Invited · ${shortDate(p.invitedAt)}` : p.status === 'suspended' ? 'Suspended' : 'Active');
const statusStyle = (status: string) => (status === 'invited' ? styles.stInvited : status === 'suspended' ? styles.stSuspended : styles.stActive);

// ---------------------------------------------------------------------------
// the drawer
// ---------------------------------------------------------------------------

function Drawer(props: {
  mode: Mode; cur: StaffMember | null; roles: StaffRole[]; mailOn: boolean; canManage: boolean;
  fName: string; fEmail: string; fRole: string | null; fErr: string;
  setFName: (v: string) => void; setFEmail: (v: string) => void; setFRole: (v: string) => void;
  invitation: StaffInvitation | null; sentExtra: string; copied: boolean;
  onSubmit: () => void; onClose: () => void; onCopy: () => void;
  onChangeRole: (id: string) => void; onSendLink: () => void;
  onSuspend: () => void; onUnsuspend: () => void; onLogoutAll: () => void; onRemove: () => void;
}) {
  const { mode, cur, roles, mailOn, canManage } = props;
  const { width, height, framed, origin } = useViewport();
  const wide = width >= 900;
  const frameBox = framed && origin ? { position: 'absolute' as const, left: origin.x, top: origin.y, width, height, overflow: 'hidden' as const } : null;

  const isOwner = Boolean(cur?.isOwner);
  const first = firstName(cur?.name);
  const kicker = mode === 'add' ? 'NEW STAFF' : mode === 'sent' ? (mailOn ? 'LOGIN LINK SENT' : 'LOGIN LINK READY') : 'STAFF';
  const title = mode === 'add' ? 'Add staff'
    : mode === 'sent' ? (mailOn ? `Sent to ${first}` : `Copy the link to ${first}`)
    : (cur?.name || '');

  return (
    <Modal visible transparent animationType={wide ? 'fade' : 'slide'} onRequestClose={props.onClose}>
      <View style={[styles.backdropWrap, frameBox]}>
        <Press style={styles.backdrop} onPress={props.onClose} accessibilityLabel="Close" effect="none" />
        <ScrollView style={[styles.panel, wide ? styles.panelSide : styles.panelSheet]} contentContainerStyle={styles.panelInner}>
          <View style={styles.drawerHead}>
            <View style={{ flexShrink: 1, gap: 6 }}>
              <Text style={styles.kicker}>{kicker}</Text>
              <Text style={styles.drawerTitle}>{title}</Text>
            </View>
            <Press onPress={props.onClose} effect="none" style={({ hovered }: any) => [styles.close, hovered && styles.closeHover]} accessibilityLabel="Close">
              <Icon name="close" size={16} color={desk.ink} strokeWidth={2.2} />
            </Press>
          </View>

          {mode === 'add' ? (
            <AddForm {...props} />
          ) : mode === 'sent' ? (
            <SentView {...props} />
          ) : (
            <PersonView cur={cur} roles={roles} isOwner={isOwner} canManage={canManage}
              onChangeRole={props.onChangeRole} onSendLink={props.onSendLink}
              onSuspend={props.onSuspend} onUnsuspend={props.onUnsuspend}
              onLogoutAll={props.onLogoutAll} onRemove={props.onRemove} />
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ST2 · Add staff
function AddForm(props: {
  roles: StaffRole[]; fName: string; fEmail: string; fRole: string | null; fErr: string;
  setFName: (v: string) => void; setFEmail: (v: string) => void; setFRole: (v: string) => void;
  onSubmit: () => void; onClose: () => void;
}) {
  const [focus, setFocus] = useState<string | null>(null);
  return (
    <>
      <Field label="Name">
        <TextInput value={props.fName} onChangeText={props.setFName} placeholder="Full name" placeholderTextColor={desk.inkFaint}
          onFocus={() => setFocus('name')} onBlur={() => setFocus(null)}
          style={[styles.input, focus === 'name' && styles.inputFocus]} />
      </Field>
      <Field label="Email">
        <TextInput value={props.fEmail} onChangeText={props.setFEmail} placeholder="name@epic.day" placeholderTextColor={desk.inkFaint}
          autoCapitalize="none" keyboardType="email-address"
          onFocus={() => setFocus('email')} onBlur={() => setFocus(null)}
          style={[styles.input, focus === 'email' && styles.inputFocus]} />
        {props.fErr ? <Text style={styles.fieldErr}>{props.fErr}</Text> : null}
      </Field>
      <Field label="Role">
        <View style={{ gap: 6 }}>
          {props.roles.map((r) => (
            <RoleOption key={r.id} role={r} selected={props.fRole === r.id} withDescription onPick={() => props.setFRole(r.id)} />
          ))}
        </View>
      </Field>
      <View style={styles.formFoot}>
        <Press onPress={props.onSubmit} style={({ hovered }: any) => [styles.primary, hovered && styles.primaryHover]}>
          <Text style={styles.primaryLabel}>Add and send login link</Text>
          <Icon name="forward" size={16} color={ON_LIME} strokeWidth={2.4} />
        </Press>
        <Press onPress={props.onClose} effect="none"><Text style={styles.cancel}>Cancel</Text></Press>
      </View>
    </>
  );
}

// ST3 / ST4 · Login link sent / ready
function SentView({ cur, invitation, mailOn, sentExtra, copied, onCopy, onClose }: {
  cur: StaffMember | null; invitation: StaffInvitation | null; mailOn: boolean; sentExtra: string;
  copied: boolean; onCopy: () => void; onClose: () => void;
}) {
  const line = mailOn
    ? "We've emailed them a login link. You can also copy it and send it yourself."
    : "Mail isn't set up yet, so nothing was sent. Copy the link and send it to them yourself.";
  return (
    <>
      <Text style={styles.sentLine}>{sentExtra ? `${sentExtra} ` : ''}{line}</Text>
      <Field label="Login link">
        <View style={styles.linkBox}>
          <Text style={styles.linkText} numberOfLines={1}>{invitation?.url || ''}</Text>
          <Press onPress={onCopy} effect="none" style={[styles.copyBtn, copied && styles.copyBtnOn]}>
            <Text style={[styles.copyLabel, copied && styles.copyLabelOn]}>{copied ? 'Copied' : 'Copy'}</Text>
          </Press>
        </View>
        <Text style={styles.linkNote}>Works once. Expires {fullDate(invitation?.expiresAt)}.</Text>
      </Field>
      <View style={styles.summary}>
        <SummaryRow label="Name" value={cur?.name || '—'} />
        <SummaryRow label="Email" value={cur?.email || '—'} />
        <SummaryRow label="Role" value={cur?.role || '—'} last />
      </View>
      <View style={styles.formFoot}>
        <Press onPress={onClose} style={({ hovered }: any) => [styles.outline, hovered && styles.outlineHover]}>
          <Text style={styles.outlineLabel}>Done</Text>
        </Press>
      </View>
    </>
  );
}

// ST5 · One person
function PersonView({ cur, roles, isOwner, canManage, onChangeRole, onSendLink, onSuspend, onUnsuspend, onLogoutAll, onRemove }: {
  cur: StaffMember | null; roles: StaffRole[]; isOwner: boolean; canManage: boolean;
  onChangeRole: (id: string) => void; onSendLink: () => void;
  onSuspend: () => void; onUnsuspend: () => void; onLogoutAll: () => void; onRemove: () => void;
}) {
  if (!cur) return null;
  const facts: { k: string; v: string; strong?: boolean }[] = [
    { k: 'Role', v: cur.role ?? '—', strong: true },
    { k: 'Status', v: cur.status === 'invited' ? 'Invited' : cur.status === 'suspended' ? 'Suspended' : 'Active', strong: true },
    { k: 'Invited', v: fullDate(cur.invitedAt) },
    { k: 'First logged in', v: fullDate(cur.activatedAt) },
    { k: 'Last logged in', v: cur.lastSeenAt ? lastSeen(cur.lastSeenAt) : 'Never' },
    { k: 'Log-ins', v: String(cur.signInCount ?? '') },
  ];

  type Action = { label: string; on: () => void };
  const actions: Action[] = [];
  if (cur.status === 'invited') actions.push({ label: 'Send the login link again', on: onSendLink });
  if (cur.status === 'active') actions.push({ label: 'Send a new login link', on: onSendLink }, { label: 'Log out everywhere', on: onLogoutAll });
  if (cur.status === 'suspended') actions.push({ label: 'Unsuspend', on: onUnsuspend });
  else actions.push({ label: 'Suspend', on: onSuspend });
  actions.push({ label: 'Remove from staff', on: onRemove });

  return (
    <>
      <Text style={styles.personEmail}>{cur.email || '—'}</Text>
      <View style={styles.summary}>
        {facts.map((f, i) => (
          <SummaryRow key={f.k} label={f.k} value={f.v} strong={f.strong} last={i === facts.length - 1} />
        ))}
      </View>

      {isOwner ? (
        <Text style={styles.ownerNote}>The owner can't be suspended or removed.</Text>
      ) : canManage ? (
        <>
          <Field label="Role">
            <View style={{ gap: 6 }}>
              {roles.map((r) => (
                <RoleOption key={r.id} role={r} selected={cur.roleId === r.id} onPick={() => onChangeRole(r.id)} />
              ))}
            </View>
          </Field>
          <View style={styles.actionList}>
            {actions.map((a) => (
              <Press key={a.label} onPress={a.on} effect="none"
                style={({ hovered }: any) => [styles.actionRow, hovered && styles.actionRowOn]}>
                {({ hovered }: any) => (
                  <>
                    <Text style={[styles.actionLabel, hovered && styles.actionLabelOn]}>{a.label}</Text>
                    <Icon name="more" size={14} color={hovered ? LIME : desk.ink} strokeWidth={2.2} />
                  </>
                )}
              </Press>
            ))}
          </View>
        </>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// small pieces
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 7 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function RoleOption({ role, selected, withDescription, onPick }: { role: StaffRole; selected: boolean; withDescription?: boolean; onPick: () => void }) {
  return (
    <Press onPress={onPick} effect="none" style={({ hovered }: any) => [
      styles.roleBox,
      { borderColor: selected ? LIME : desk.ruleStrong, alignItems: withDescription ? 'flex-start' : 'center' },
      hovered && styles.roleBoxHover,
    ]}>
      <View style={[styles.radio, { borderColor: selected ? LIME : desk.ruleStrong, marginTop: withDescription ? 2 : 0 }]}>
        <View style={[styles.radioDot, { backgroundColor: selected ? LIME : 'transparent' }]} />
      </View>
      <View style={{ flexShrink: 1, gap: 2 }}>
        <Text style={styles.roleName}>{role.label}</Text>
        {withDescription && role.description ? <Text style={styles.roleDesc}>{role.description}</Text> : null}
      </View>
    </Press>
  );
}

function SummaryRow({ label, value, strong, last }: { label: string; value: string; strong?: boolean; last?: boolean }) {
  return (
    <View style={[styles.summaryRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, strong && { fontWeight: '700' }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function Toast({ text }: { text: string }) {
  const { framed, origin } = useViewport();
  const at = framed && origin ? { position: 'absolute' as const, left: origin.x + 20, top: origin.y + 20 } : { position: 'absolute' as const, top: 20, right: 20 };
  return (
    <View style={[styles.toast, at]} accessibilityRole="alert">
      <Text style={styles.toastText}>{text}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: desk.ground },
  content: { paddingTop: 28, paddingHorizontal: 28, paddingBottom: 40, gap: 20 },

  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 },
  title: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 31, letterSpacing: -1.1, lineHeight: 32, color: desk.ink },
  sub: { fontFamily: fonts.body, fontSize: 13.5, color: desk.inkDim, lineHeight: 20 },

  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 22, backgroundColor: LIME, paddingVertical: 10, paddingHorizontal: 14 },
  addBtnHover: { opacity: 0.88 },
  addLabel: { fontFamily: fonts.heading, fontSize: 13.5, fontWeight: '700', color: ON_LIME },

  filters: { flexDirection: 'row', alignSelf: 'flex-start', borderWidth: 1, borderColor: desk.ruleStrong },
  segment: { paddingVertical: 9, paddingHorizontal: 22 },
  segmentOn: { backgroundColor: desk.ink },
  segmentLabel: { fontFamily: fonts.body, fontSize: 13, color: desk.inkMuted },
  segmentLabelOn: { color: desk.ground, fontWeight: '700' },

  error: { fontFamily: fonts.body, fontSize: 13.5, color: desk.warn },

  headRow: { flexDirection: 'row', gap: 24, borderBottomWidth: 2, borderBottomColor: desk.ruleStrong, paddingBottom: 9 },
  headCell: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600', color: desk.inkDim },

  row: { flexDirection: 'row', gap: 24, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: desk.rule },
  rowOn: { backgroundColor: desk.picked },
  cell: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 14, color: desk.ink },
  cellName: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: desk.ink },
  cellMuted: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 14, color: desk.inkMuted },
  stActive: { color: desk.ink },
  stInvited: { color: LIME, fontWeight: '700' },
  stSuspended: { color: desk.inkDim },
  empty: { fontFamily: fonts.body, fontSize: 14, color: desk.inkDim, paddingVertical: 16 },

  // drawer
  backdropWrap: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10,9,9,0.55)' },
  panel: { backgroundColor: desk.lifted },
  panelSide: { width: 440, maxWidth: '100%', height: '100%', borderLeftWidth: 2, borderLeftColor: desk.ruleStrong },
  panelSheet: { width: '100%', height: '100%' },
  panelInner: { padding: 28, gap: 22 },

  drawerHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  kicker: { fontFamily: fonts.heading, fontSize: 10, fontWeight: '700', letterSpacing: 0.7, color: desk.inkDim },
  drawerTitle: { fontFamily: fonts.heading, fontWeight: '800', fontSize: 26, letterSpacing: -0.78, lineHeight: 28, color: desk.ink },
  close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  closeHover: { backgroundColor: desk.rule },

  fieldLabel: { fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600', color: desk.inkDim },
  input: { height: 42, borderWidth: 1, borderColor: desk.ruleStrong, color: desk.ink, paddingHorizontal: 12, fontFamily: fonts.body, fontSize: 14, backgroundColor: 'transparent' },
  inputFocus: { borderColor: LIME },
  fieldErr: { fontFamily: fonts.body, fontSize: 12.5, color: LIME },

  roleBox: { flexDirection: 'row', gap: 12, paddingVertical: 11, paddingHorizontal: 12, borderWidth: 1 },
  roleBoxHover: { backgroundColor: desk.picked },
  radio: { width: 14, height: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 6, height: 6 },
  roleName: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: desk.ink },
  roleDesc: { fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim, lineHeight: 17 },

  formFoot: { marginTop: 'auto', gap: 12, paddingTop: 4 },
  primary: { height: 46, backgroundColor: LIME, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  primaryHover: { opacity: 0.88 },
  primaryLabel: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: ON_LIME },
  cancel: { fontFamily: fonts.body, fontSize: 13.5, fontWeight: '600', color: desk.inkMuted, paddingLeft: 16 },

  outline: { height: 46, borderWidth: 1, borderColor: desk.ink, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  outlineHover: { backgroundColor: desk.rule },
  outlineLabel: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: desk.ink },

  sentLine: { fontFamily: fonts.body, fontSize: 14, color: desk.inkMuted, lineHeight: 21 },
  linkBox: { flexDirection: 'row', borderWidth: 1, borderColor: desk.ruleStrong },
  linkText: { flex: 1, minWidth: 0, paddingVertical: 11, paddingHorizontal: 12, fontSize: 13, color: desk.inkMuted, fontFamily: 'ui-monospace, Menlo, monospace' },
  copyBtn: { justifyContent: 'center', paddingHorizontal: 14, borderLeftWidth: 1, borderLeftColor: desk.ruleStrong },
  copyBtnOn: { backgroundColor: LIME },
  copyLabel: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: desk.ink },
  copyLabelOn: { color: ON_LIME },
  linkNote: { fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim },

  summary: { borderTopWidth: 2, borderTopColor: desk.ruleStrong },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 24, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: desk.rule },
  summaryLabel: { fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim },
  summaryValue: { flexShrink: 1, textAlign: 'right', fontFamily: fonts.body, fontSize: 13.5, color: desk.ink },

  personEmail: { fontFamily: fonts.body, fontSize: 14, color: desk.inkMuted, marginTop: -14 },
  ownerNote: { fontFamily: fonts.body, fontSize: 13.5, color: desk.inkDim },

  actionList: { borderTopWidth: 2, borderTopColor: desk.ruleStrong },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: desk.rule },
  actionRowOn: {},
  actionLabel: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: desk.ink },
  actionLabelOn: { color: LIME },

  toast: { backgroundColor: LIME, paddingVertical: 11, paddingHorizontal: 16, zIndex: 5 },
  toastText: { fontFamily: fonts.body, fontSize: 13.5, fontWeight: '700', color: ON_LIME },
});
