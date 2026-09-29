/**
 * Mail — every e-mail Epic sent, and what became of it.
 *
 * Owner, 13 Sep 2026, on why the sender is Postmark: "we get send and read
 * receipts, and bounced email reporting." So this is the receipt: counts by
 * outcome over the window, then the rows, newest first, narrowed by one
 * dropdown. A status is always a word beside its detail, never a colour on
 * its own (Parcelvision's Emails screen keeps the same rule). Nothing is
 * boxed; the rows are the kit's table.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { api, AdminMail, MailRow } from '../../api';
import { colors, spacing, type, BORDER } from '../../theme';
import { Act } from '../table';
import { StatusLine } from '../../components/ui';
import { AdminPage, Banner, DataTable, Dropdown, PageHead, RangePicker, Tile, TileRow, ago } from '../kit';

const FILTERS: { key: string; label: string }[] = [
  { key: '', label: 'Any outcome' }, { key: 'sent', label: 'Sent' }, { key: 'delivered', label: 'Delivered' }, { key: 'opened', label: 'Opened' },
  { key: 'not_delivered', label: 'Not delivered' }, { key: 'bounced', label: 'Bounced' }, { key: 'soft_bounced', label: 'Delayed' }, { key: 'complained', label: 'Marked as spam' }, { key: 'failed', label: 'Not sent' }, { key: 'sending', label: 'Sending' },
];
const purposeLabel = (p: string) => { const w = (p || '').replace(/_/g, ' ').trim(); return w ? w[0].toUpperCase() + w.slice(1) : '—'; };

export function Mail({ canSend = false }: { canSend?: boolean } = {}) {
  const [days, setDays] = useState(30);
  const [status, setStatus] = useState('');
  const [data, setData] = useState<AdminMail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { setData(await api.adminMail(days, status || null)); setError(null); } catch (e: any) { setError(e.message); } }, [days, status]);
  useEffect(() => { void load(); }, [load]);
  // One test message, to see the sender work end to end; it lands in the list below.
  const [testTo, setTestTo] = useState('roger@epic.day');
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<string | null>(null);
  const sendTest = useCallback(async () => {
    setTesting(true); setTested(null);
    try {
      const out = await api.adminMailTest(testTo.trim());
      setTested(out.sent ? `Sent to ${testTo.trim()}` : (out.message ?? 'Not sent'));
    } catch (e: any) { setTested(e.message); } finally { setTesting(false); void load(); }
  }, [testTo, load]);

  const c = data?.counts ?? {};
  const n = (k: string) => c[k] ?? 0;
  const sentAll = Object.values(c).reduce((a, b) => a + b, 0);
  const delivered = data?.filters?.delivered ?? n('delivered') + n('opened');
  const notDelivered = data?.filters?.not_delivered ?? n('bounced') + n('soft_bounced') + n('complained') + n('failed');
  const words = data?.words ?? {};
  const outcome = (r: MailRow) => {
    const when = r.status === 'opened' ? r.opened_at : r.status === 'delivered' ? r.delivered_at : r.bounced_at;
    return `${words[r.status] ?? r.status}${when ? ` · ${ago(when)}` : ''}`;
  };
  const columns = [
    { key: 'when', head: 'Sent', width: 1, cell: (r: MailRow) => <Text style={type.small}>{ago(r.sent_at)}</Text>, sort: (r: MailRow) => r.sent_at },
    { key: 'to', head: 'To', width: 2, cell: (r: MailRow) => <Text style={type.body} numberOfLines={1}>{r.to_address}</Text>, sort: (r: MailRow) => r.to_address },
    { key: 'purpose', head: 'What', width: 1, cell: (r: MailRow) => <Text style={type.small}>{purposeLabel(r.purpose)}</Text>, sort: (r: MailRow) => r.purpose, wideOnly: true },
    { key: 'subject', head: 'Subject', width: 3, cell: (r: MailRow) => <Text style={type.small} numberOfLines={1}>{r.subject}</Text>, wideOnly: true },
    { key: 'status', head: 'Outcome', width: 2, cell: (r: MailRow) => (
      <View>
        <Text style={[type.body, (r.status === 'bounced' || r.status === 'complained' || r.status === 'failed') && { color: colors.overrun }]}>{outcome(r)}</Text>
        {r.failure ? <Text style={type.tiny} numberOfLines={2}>{r.failure}</Text> : null}
      </View>
    ), sort: (r: MailRow) => r.status },
  ];

  return (
    <AdminPage>
      <PageHead title="Mail" sub="Every e-mail sent, and what Postmark said became of it — delivered, opened, bounced, marked as spam" right={<RangePicker days={days} onDays={setDays} />} />
      {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
      {data && !data.sender.configured ? <Banner tone="warn">{data.sender.message ?? 'No mail sender is configured.'}</Banner> : null}
      {data && data.sender.configured && !data.sender.events ? <Banner tone="warn">Sends go out, but nothing comes back: add POSTMARK_WEBHOOK_TOKEN in Doppler and give Postmark the webhook address, so deliveries, opens and bounces land here.</Banner> : null}
      {data?.sender.configured && canSend ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' }}>
          <TextInput value={testTo} onChangeText={setTestTo} autoCapitalize="none" keyboardType="email-address"
                     accessibilityLabel="Send a test to" style={[type.body, { minWidth: 220, flexShrink: 1, borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted, paddingVertical: 4 }]} />
          <Act label={testing ? 'Sending…' : 'Send a test'} small tone="secondary" disabled={testing || !testTo.includes('@')} onPress={() => { void sendTest(); }} />
          {tested ? <Text style={type.small}>{tested}</Text> : null}
        </View>
      ) : null}
      <TileRow>
        <Tile label="Sent" value={String(sentAll)} sub={`in ${days} days`} />
        <Tile label="Delivered" value={String(delivered)} sub="accepted by their server" tone="ok" onPress={() => setStatus('delivered')} />
        <Tile label="Opened" value={String(n('opened'))} sub="read receipts" tone="ok" onPress={() => setStatus('opened')} />
        <Tile label="Not delivered" value={String(notDelivered)} sub="bounced, delayed, spam or not sent" tone={notDelivered ? 'warn' : 'plain'} onPress={() => setStatus('not_delivered')} />
      </TileRow>
      <Dropdown label="Show" value={FILTERS.find((f) => f.key === status)?.label ?? 'Any outcome'} width={240} options={FILTERS.map((f) => ({ key: f.key, label: f.label, on: f.key === status, count: f.key ? (f.key === 'not_delivered' ? notDelivered : f.key === 'delivered' ? delivered : n(f.key)) : sentAll }))} onPick={setStatus} />
      <DataTable rows={data?.rows ?? []} columns={columns} initialSort={{ key: 'when', dir: 'desc' }} empty={<Text style={type.small}>{data ? 'Nothing sent in this window.' : 'Loading…'}</Text>} />
    </AdminPage>
  );
}
