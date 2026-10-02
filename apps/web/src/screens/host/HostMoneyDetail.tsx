/**
 * The screens below Money (Settings revised v2, SX16–SX20): the payout account,
 * when you're paid, payout history, tax details, yearly statements. Each is a
 * push with a back header; the figures and fee lines come from the server's
 * money payload, which is the fee engine's own arithmetic.
 *
 * Epic has no payment provider yet, so nothing has been paid: the history is
 * honestly empty and the statements read "Ready in January" rather than showing
 * a fabricated £0 (README · "no payment provider").
 */

import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import { colors, fonts, spacing, BORDER, TARGET, LIME, INK, CREAM } from '../../theme';
import { Icon } from '../../components/Icon';
import { CompactBand } from '../../components/Band';
import { Sheet } from '../../components/Sheet';
import { showToast } from '../../components/Toast';
import { useViewport } from '../../hooks/useViewport';
import { api, HostMoney, OwnHost, PaySchedule, PayoutAccount } from '../../api';
import { t, k } from '../../components/hostKit';
import { Section, Kicker, gbp } from './hostTabKit';

export type MoneyScreen = 'account' | 'schedule' | 'history' | 'tax' | 'statements';

const TITLE: Record<MoneyScreen, string> = {
  account: 'Payout account', schedule: "When you're paid", history: 'Payout history', tax: 'Tax details', statements: 'Yearly statements',
};

export function HostMoneyDetail({ which, money, host, onBack, onChanged }: {
  which: MoneyScreen; money: HostMoney; host: OwnHost; onBack: () => void; onChanged: () => Promise<void>;
}) {
  const { width } = useViewport();
  const wide = width >= 900;
  return (
    <View style={k.page}>
      <CompactBand title={TITLE[which]} onBack={onBack} />
      <ScrollView contentContainerStyle={[styles.body, wide && k.wide]}>
        {which === 'account' ? <PayoutAccounts money={money} onChanged={onChanged} />
          : which === 'schedule' ? <WhenPaid money={money} onChanged={onChanged} />
            : which === 'history' ? <History money={money} />
              : which === 'tax' ? <Tax money={money} onChanged={onChanged} />
                : <Statements money={money} />}
      </ScrollView>
    </View>
  );
}

// --- SX16 · Payout account --------------------------------------------------

function PayoutAccounts({ money, onChanged }: { money: HostMoney; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const activate = async (a: PayoutAccount) => {
    if (a.isActive) return;
    setBusy(a.id);
    try { await api.activatePayoutAccount(a.id); showToast(`Payouts now go to ${a.label} ••${a.last4}`); await onChanged(); }
    catch (e: any) { showToast(e?.body?.message || 'Could not switch account.'); }
    finally { setBusy(null); }
  };
  return (
    <>
      {money.payoutAccounts.length === 0 ? (
        <Text style={[t.sub, { lineHeight: 20 }]}>No bank account on file yet. Adding one is part of Stripe's set-up, and lands here when it does.</Text>
      ) : money.payoutAccounts.map((a) => (
        <Press key={a.id} onPress={() => void activate(a)} accessibilityRole="button" disabled={busy != null} style={styles.acct}>
          <View style={styles.acctTile}><Icon name="payout" size={18} color={colors.ink} strokeWidth={2} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[t.body, { fontWeight: '700', lineHeight: 18 }]} numberOfLines={1}>{a.label} ••{a.last4}</Text>
            <Text style={t.small} numberOfLines={1}>{[a.holderName, a.addedOn ? `added ${monthDay(a.addedOn)}` : null].filter(Boolean).join(' · ')}</Text>
          </View>
          {a.isActive ? <View style={styles.paidHere}><Text style={styles.paidHereText}>PAID HERE</Text></View>
            : busy === a.id ? <Text style={t.small}>…</Text> : null}
        </Press>
      ))}
      <View style={styles.dashed}>
        <Icon name="add" size={18} color={colors.inkFaint} strokeWidth={2} />
        <Text style={[t.body, { color: colors.inkFaint }]}>Add a bank account</Text>
      </View>
      <Text style={[t.small, { lineHeight: 18, marginTop: 4 }]}>Payouts go through Stripe straight to your bank. Epic never holds your money.</Text>
    </>
  );
}

// --- SX17 · When you're paid ------------------------------------------------

function WhenPaid({ money, onChanged }: { money: HostMoney; onChanged: () => Promise<void> }) {
  const [sched, setSched] = useState<PaySchedule>(money.paySchedule);
  const opts: { v: PaySchedule; label: string }[] = [
    { v: 'weekly', label: 'Every Friday' }, { v: 'weekday', label: 'Every weekday' }, { v: 'monthly', label: 'Once a month (on the 1st)' },
  ];
  const choose = async (v: PaySchedule) => {
    setSched(v);
    try { await api.updateHost({ paySchedule: v }); await onChanged(); }
    catch (e: any) { showToast(e?.body?.message || 'Could not save.'); }
  };
  return (
    <>
      {opts.map((o) => (
        <Press key={o.v} onPress={() => void choose(o.v)} accessibilityRole="button" accessibilityState={{ selected: sched === o.v }} style={styles.optionRow}>
          <Text style={[t.body, { flex: 1 }]}>{o.label}</Text>
          <View style={[styles.tick, sched === o.v ? styles.tickOn : styles.tickOff]}>{sched === o.v ? <Icon name="check" size={16} color={INK} strokeWidth={2.6} /> : null}</View>
        </Press>
      ))}
      <Text style={[t.small, { lineHeight: 18, marginTop: 10 }]}>A date's money is released two days after it runs, then paid on the next payout day.</Text>
    </>
  );
}

// --- SX18 · Payout history --------------------------------------------------

function History({ money }: { money: HostMoney }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!money.history.length) {
    return <Text style={[t.sub, { lineHeight: 20 }]}>{money.paymentsReady ? 'No payouts yet. When a date runs, its money is released two days later and paid on your next payout day.' : money.note}</Text>;
  }
  return (
    <>
      {money.history.map((p) => (
        <View key={p.id}>
          <Press onPress={() => setOpen(open === p.id ? null : p.id)} accessibilityRole="button" style={styles.payRow}>
            <Text style={[t.body, { flex: 1, fontWeight: '600' }]}>{monthDay(p.on)}</Text>
            <Text style={[t.body, { fontWeight: '800' }]}>{gbp(p.netPence)}</Text>
            <View style={[styles.statusChip, p.status === 'scheduled' ? styles.statusScheduled : styles.statusPaid]}>
              <Text style={[styles.statusText, p.status === 'scheduled' ? { color: INK } : { color: colors.inkMuted }]}>{p.status.toUpperCase()}</Text>
            </View>
            <Icon name={open === p.id ? 'collapse' : 'more'} size={18} color={colors.inkFaint} />
          </Press>
          {open === p.id ? (
            <View style={styles.payDetail}>
              {p.dates.map((d, i) => (
                <View key={i} style={{ paddingVertical: 4 }}>
                  <Text style={t.small}>{monthDay(d.on)} · {d.title ?? 'A date'} · {d.guests} {d.guests === 1 ? 'guest' : 'guests'} {gbp(d.grossPence)}</Text>
                  <Text style={[t.tiny]}>{d.line.label}</Text>
                </View>
              ))}
              {p.accountLabel ? <Text style={[t.small, { fontWeight: '800', marginTop: 4 }]}>Paid to {p.accountLabel}</Text> : null}
            </View>
          ) : null}
        </View>
      ))}
    </>
  );
}

// --- SX19 · Tax details -----------------------------------------------------

function Tax({ money, onChanged }: { money: HostMoney; onChanged: () => Promise<void> }) {
  const [edit, setEdit] = useState<null | 'name' | 'address' | 'ref' | 'company'>(null);
  const tax = money.tax;
  const year = new Date().getFullYear();
  // Company reporting needs the company's number, so switching it on with
  // none on file asks for the number first; saving it turns the switch on in
  // the same request (Codex, 2 Oct 2026).
  const toggleCompany = async () => {
    if (!tax.taxIsCompany && !tax.companyNumber) { setEdit('company'); return; }
    try { await api.updateHost({ taxIsCompany: !tax.taxIsCompany }); await onChanged(); }
    catch (e: any) { showToast(e?.body?.message || 'Could not save.'); }
  };
  return (
    <>
      <View style={styles.notice}>
        <Text style={styles.noticeText}>Each January Epic sends HMRC a summary of what you earned the year before, as UK platform rules require. You still declare it yourself.</Text>
      </View>
      <TaxRow label="Legal name" value={tax.legalName} onEdit={() => setEdit('name')} />
      <TaxRow label="Address" value={tax.address} onEdit={() => setEdit('address')} />
      <TaxRow label="UTR or National Insurance number" value={tax.taxReference} onEdit={() => setEdit('ref')} />
      {/* Date of birth is asked once, on the profile, and only read here. */}
      <View style={styles.taxRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.taxLabel}>Date of birth</Text>
          <Text style={styles.taxValue}>{tax.dateOfBirth ? ageWords(tax.dateOfBirth) : 'On your profile'}</Text>
        </View>
        <Text style={[t.link, { color: colors.inkMuted }]}>On your profile ›</Text>
      </View>

      <Press onPress={() => void toggleCompany()} accessibilityRole="switch" accessibilityState={{ checked: tax.taxIsCompany }} style={styles.companyRow}>
        <View style={{ flex: 1 }}>
          <Text style={[t.body, { fontWeight: '600' }]}>Hosting as a company</Text>
          <Text style={t.small}>Reported under the company, not you.</Text>
        </View>
        <View style={[styles.track, { backgroundColor: tax.taxIsCompany ? colors.ink : colors.ruleSoft }]}>
          <View style={[styles.knob, { backgroundColor: tax.taxIsCompany ? LIME : CREAM, alignSelf: tax.taxIsCompany ? 'flex-end' : 'flex-start' }]} />
        </View>
      </Press>
      {tax.taxIsCompany ? <TaxRow label="Company number" value={tax.companyNumber} placeholder="8 digits, from Companies House" onEdit={() => setEdit('company')} /> : null}

      <Text style={[t.small, { marginTop: 14, fontWeight: '700', color: tax.taxReference ? colors.accent : colors.inkMuted }]}>
        {tax.taxReference ? `Complete for the ${year} report` : `Add your UTR or NI number for the ${year} report`}
      </Text>

      {edit ? (
        <EditField
          which={edit}
          current={edit === 'name' ? tax.legalName : edit === 'address' ? tax.address : edit === 'company' ? tax.companyNumber : ''}
          onClose={() => setEdit(null)}
          onSave={async (v) => {
            // Tax identity only — the legal name and tax address have their own
            // columns; this never writes the guest-facing host name or the
            // operational hosting address (Codex).
            const patch = edit === 'name' ? { legalName: v } : edit === 'address' ? { taxAddress: v } : edit === 'company' ? { companyNumber: v, taxIsCompany: true } : { taxReference: v };
            try { await api.updateHost(patch as any); showToast('Saved'); await onChanged(); } catch (e: any) { showToast(e?.body?.message || 'Could not save.'); }
            setEdit(null);
          }}
        />
      ) : null}
    </>
  );
}

function TaxRow({ label, value, placeholder, onEdit }: { label: string; value: string | null; placeholder?: string; onEdit: () => void }) {
  return (
    <View style={styles.taxRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.taxLabel}>{label}</Text>
        <Text style={[styles.taxValue, !value && { color: colors.inkFaint }]} numberOfLines={1}>{value || placeholder || 'Not set'}</Text>
      </View>
      <Press onPress={onEdit} accessibilityRole="button"><Text style={styles.editLink}>Edit</Text></Press>
    </View>
  );
}

function EditField({ which, current, onClose, onSave }: { which: 'name' | 'address' | 'ref' | 'company'; current: string | null; onClose: () => void; onSave: (v: string) => Promise<void> }) {
  const [v, setV] = useState(which === 'ref' || which === 'company' ? '' : current ?? '');
  const title = which === 'name' ? 'Legal name' : which === 'address' ? 'Address' : which === 'company' ? 'Company number' : 'UTR or NI number';
  const ph = which === 'company' ? '8 digits, from Companies House' : which === 'ref' ? 'QQ 12 34 56 C, or a 10-digit UTR' : title;
  return (
    <Sheet title={title} onCancel={onClose} cancelLabel="Cancel" onDone={() => void onSave(v.trim())} doneLabel="Save" doneDisabled={!v.trim()} onClose={onClose}>
      <TextInput value={v} onChangeText={setV} placeholder={ph} placeholderTextColor={colors.inkFaint} autoFocus autoCapitalize={which === 'ref' || which === 'company' ? 'characters' : 'words'} style={styles.input} />
    </Sheet>
  );
}

// --- SX20 · Yearly statements -----------------------------------------------

function Statements({ money }: { money: HostMoney }) {
  return (
    <>
      <View style={styles.stmtHead}>
        <Text style={[styles.stmtH, { flex: 1.1 }]}>Year</Text>
        <Text style={[styles.stmtH, { flex: 1.4 }]}>Epic's fee</Text>
        <Text style={[styles.stmtH, { flex: 1.2, textAlign: 'right' }]}>Paid to you</Text>
        <Text style={[styles.stmtH, { flex: 1.3, textAlign: 'right' }]}>Statement</Text>
      </View>
      {money.statements.map((s) => (
        <View key={s.year} style={styles.stmtRow}>
          <Text style={[styles.stmtCell, { flex: 1.1, fontWeight: '700' }]}>{s.year}</Text>
          <Text style={[styles.stmtCell, { flex: 1.4 }]} numberOfLines={2}>{s.feeLabel}</Text>
          <Text style={[styles.stmtCell, { flex: 1.2, textAlign: 'right' }]}>{s.netPence == null ? '—' : gbp(s.netPence)}</Text>
          <Text style={[styles.stmtCell, { flex: 1.3, textAlign: 'right', color: s.ready ? colors.accent : colors.inkMuted, fontWeight: s.ready ? '700' : '400' }]}>{s.ready ? 'Download' : 'Ready in January'}</Text>
        </View>
      ))}
    </>
  );
}

// --- helpers ----------------------------------------------------------------

const monthDay = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
function ageWords(iso: string) {
  const b = new Date(iso); const n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a -= 1;
  return `${a}`;
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 48, gap: 6 },
  acct: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  acctTile: { width: 40, height: 40, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  paidHere: { backgroundColor: LIME, paddingHorizontal: 8, paddingVertical: 3 },
  paidHereText: { fontFamily: fonts.body, fontSize: 10, fontWeight: '800', letterSpacing: 0.5, color: INK },
  dashed: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.ghost, marginTop: 10 },
  optionRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingVertical: 12 },
  tick: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  tickOn: { backgroundColor: LIME },
  tickOff: { borderWidth: BORDER, borderColor: colors.ruleSoft },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  statusChip: { paddingHorizontal: 7, paddingVertical: 3 },
  statusScheduled: { backgroundColor: LIME },
  statusPaid: { backgroundColor: colors.warm },
  statusText: { fontFamily: fonts.body, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  payDetail: { paddingVertical: 8, paddingHorizontal: 2, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft, backgroundColor: colors.surfaceMuted },
  notice: { backgroundColor: colors.surfaceMuted, padding: 14, marginBottom: 10 },
  noticeText: { fontFamily: fonts.body, fontSize: 13, color: colors.accent, lineHeight: 18 },
  taxRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  taxLabel: { fontFamily: fonts.body, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', color: colors.inkMuted, marginBottom: 3 },
  taxValue: { fontFamily: fonts.body, fontSize: 15.5, fontWeight: '600', color: colors.ink },
  editLink: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: colors.ink, textDecorationLine: 'underline' },
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  track: { width: 46, height: 26, padding: 2, justifyContent: 'center' },
  knob: { width: 22, height: 22 },
  input: { minHeight: TARGET, paddingHorizontal: spacing.md, borderWidth: 1.5, borderColor: colors.ruleSoft, backgroundColor: colors.surface, fontSize: 15, color: colors.ink },
  stmtHead: { flexDirection: 'row', gap: 8, paddingBottom: 8, borderBottomWidth: BORDER, borderBottomColor: colors.line },
  stmtH: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colors.inkMuted },
  stmtRow: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  stmtCell: { fontFamily: fonts.body, fontSize: 13.5, color: colors.ink },
});
