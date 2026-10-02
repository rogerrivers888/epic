/**
 * E2 · Messages and E4 · Automatic messages (hosting v4, README E2–E4).
 *
 * E2 is the host's inbox over the existing chat module (`/api/chat/inbox`):
 * All · Bookings · Everyone · Questions, each with its waiting count in the
 * corner of the cell, then the rows, then Automatic messages and Quick
 * replies, and the host's response time at the foot. E4 is the five messages
 * Epic sends for the host, each switched and editable, and the saved quick
 * replies.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Press } from '../../../components/press';
import { useRouter, useQueryState, asOneOf } from '../../../router';
import { paths } from '../../../routes';
import { api, type ChatInbox, type ChatInboxItem } from '../../../api';
import { DEEP_GREEN, HAIRLINE, INK, INK_MUTED, LIME, NEUTRAL, TARGET, fonts } from '../../../theme';
import { Switch } from '../v7/kit';
import { Btn, DeskSheet, Empty, Head, Kicker, Loading, Page, Row, Section, Tabs, tx } from './kit';
import { shortDate, type AutoMessage, type DeskProfile } from './model';

type Filter = 'all' | 'bookings' | 'everyone' | 'questions';
const FILTERS = ['all', 'bookings', 'everyone', 'questions'] as const;

const fits: Record<Filter, (t: ChatInboxItem) => boolean> = {
  all: () => true,
  bookings: (t) => t.audience === 'host_only',
  everyone: (t) => t.audience === 'everyone',
  questions: (t) => t.state === 'open',
};

/** "09:12" today, "Yesterday", "Wed" this week, "3 Oct" before that. */
function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((+new Date(today.toDateString()) - +new Date(d.toDateString())) / 86_400_000);
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' });
  return shortDate(d.toISOString());
}

/** "1 h 40 min", "25 min", "2 days". */
export function responseTime(mins: number | null | undefined): string {
  if (mins == null) return '—';
  const m = Math.round(mins);
  if (m < 60) return `${m} min`;
  if (m < 24 * 60) { const h = Math.floor(m / 60); const r = m % 60; return r ? `${h} h ${r} min` : `${h} h`; }
  const d = Math.round(m / (24 * 60));
  return `${d} ${d === 1 ? 'day' : 'days'}`;
}

const inputStyle = { fontFamily: fonts.body, fontSize: 15, color: INK, borderWidth: 1, borderColor: HAIRLINE, paddingHorizontal: 12, paddingVertical: 10, minHeight: TARGET } as const;

// ---------------------------------------------------------------------------
// E2 · the inbox
// ---------------------------------------------------------------------------

export function DeskMessages() {
  const { navigate, back } = useRouter();
  const [filter, setFilter] = useQueryState<Filter>('filter', 'all', asOneOf(FILTERS, 'all'));
  const [inbox, setInbox] = useState<ChatInbox | null>(null);
  const [profile, setProfile] = useState<DeskProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.chatInbox().then(setInbox).catch((e) => setError(e.message));
    api.deskProfile().then(setProfile).catch(() => null);
  }, []);

  const items = useMemo(
    () => (inbox?.offers ?? []).flatMap((o) => o.topics.map((t) => ({ t, event: o.title }))).sort((a, b) => +new Date(b.t.lastAt) - +new Date(a.t.lastAt)),
    [inbox],
  );
  if (!inbox) return <Loading error={error} />;

  const waitingIn = (f: Filter) => items.filter(({ t }) => fits[f](t) && t.state === 'open').length;
  const shown = items.filter(({ t }) => fits[filter](t));
  const autoOn = profile ? profile.autoMessages.filter((m) => m.on).length : null;
  const quick = profile ? profile.quickReplies.length : null;

  return (
    <Page>
      <Head back="Host" onBack={() => back(paths.host())} title="Messages"
        right={<Press onPress={() => navigate(paths.hostAutoMessages())} accessibilityRole="link"><Text style={tx(15, '800', DEEP_GREEN)}>Automatic</Text></Press>} />
      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 12 }}>
        <Tabs<Filter> value={filter} onPick={(k) => setFilter(k)}
          tabs={[
            { key: 'all', label: 'All', badge: waitingIn('all') },
            { key: 'bookings', label: 'Bookings', badge: waitingIn('bookings') },
            { key: 'everyone', label: 'Everyone', badge: waitingIn('everyone') },
            { key: 'questions', label: 'Questions', badge: waitingIn('questions') },
          ]} />
      </View>

      <View style={{ paddingHorizontal: 20 }}>
        {shown.length ? shown.map(({ t, event }) => {
          const waiting = t.state === 'open';
          return (
            <Press key={t.id} onPress={() => navigate(paths.hostOfferChatTopic(t.offerId, t.id))} accessibilityRole="button" accessibilityLabel={`${t.author.name}: ${t.title}`}
              style={{ flexDirection: 'row', gap: 12, paddingVertical: 14, borderTopWidth: 1, borderTopColor: HAIRLINE }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: NEUTRAL, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={tx(14, '800')}>{t.author.initial}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={[tx(15.5, waiting ? '800' : '700'), { flex: 1 }]} numberOfLines={1}>{t.author.name}</Text>
                  <Text style={tx(13, '400', INK_MUTED)}>{when(t.lastAt)}</Text>
                </View>
                <Text style={tx(13, '400', INK_MUTED)} numberOfLines={1}>{[t.audience === 'everyone' && waiting ? 'Question' : null, event ?? 'Untitled'].filter(Boolean).join(' · ')}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={[tx(14.5, waiting ? '800' : '400'), { flex: 1 }]} numberOfLines={1}>{t.title}</Text>
                  {waiting ? <View style={{ minWidth: 18, height: 18, paddingHorizontal: 4, backgroundColor: LIME, alignItems: 'center', justifyContent: 'center' }}><Text style={tx(11, '800')}>1</Text></View> : null}
                </View>
              </View>
            </Press>
          );
        }) : <Empty>{inbox.host ? 'Nothing here.' : 'You are not hosting yet.'}</Empty>}
      </View>

      <View style={{ paddingHorizontal: 20, marginTop: 18, borderTopWidth: 1, borderTopColor: HAIRLINE }}>
        <Row title="Automatic messages" line={autoOn == null ? null : `${autoOn} sent for you · booking to thank you`} onPress={() => navigate(paths.hostAutoMessages())} />
        <Row title="Quick replies" line={quick == null ? null : `${quick} saved ${quick === 1 ? 'answer' : 'answers'}`} onPress={() => navigate(paths.hostAutoMessages())} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, borderTopWidth: 1, borderBottomWidth: 1, borderColor: HAIRLINE }}>
          <Text style={tx(14, '400', INK_MUTED)}>Your response time</Text>
          <Text style={tx(15, '800')}>{responseTime(profile?.host.responseMinutes)}</Text>
        </View>
      </View>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// E4 · automatic messages and quick replies
// ---------------------------------------------------------------------------

type Editing = { kind: 'auto'; m: AutoMessage } | { kind: 'quick'; id: string | null; body: string } | null;

export function DeskAutoMessages() {
  const { back } = useRouter();
  const [p, setP] = useState<DeskProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const load = useCallback(() => api.deskProfile().then((x) => { setP(x); setError(null); }).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (!p) return <Loading error={error} />;

  const open = (e: NonNullable<Editing>) => { setEditing(e); setDraft(e.kind === 'auto' ? e.m.body : e.body); setSheetError(null); };
  const close = () => { setEditing(null); setSheetError(null); };

  const flip = async (m: AutoMessage) => {
    const on = !m.on;
    setP({ ...p, autoMessages: p.autoMessages.map((x) => (x.kind === m.kind ? { ...x, on } : x)) });
    try { await api.deskAutoMessage(m.kind, { on }); } catch (e: any) { setError(e.message); load(); }
  };

  const save = async () => {
    if (!editing) return;
    const body = draft.trim();
    if (!body) { setSheetError('Write something first.'); return; }
    setBusy(true);
    try {
      if (editing.kind === 'auto') await api.deskAutoMessage(editing.m.kind, { on: editing.m.on, body });
      else {
        await api.deskAddQuickReply(body);
        if (editing.id) await api.deskDeleteQuickReply(editing.id);
      }
      close();
      await load();
    } catch (e: any) { setSheetError(e.message); } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try { await api.deskDeleteQuickReply(id); close(); await load(); } catch (e: any) { setSheetError(e.message); } finally { setBusy(false); }
  };

  return (
    <Page>
      <Head back="Messages" onBack={() => back(paths.hostMessages())} title="Automatic messages" />
      {error ? <Text style={[tx(13.5, '400', INK_MUTED), { paddingHorizontal: 20, paddingTop: 10 }]}>{error}</Text> : null}
      <Section title="Sent for you">
        <View>
          {p.autoMessages.map((m) => (
            <View key={m.kind} style={{ borderTopWidth: 1, borderTopColor: HAIRLINE, paddingVertical: 14, gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={tx(15.5, '800')}>{m.title}</Text>
                  <Text style={tx(13, '400', INK_MUTED)}>{m.when}</Text>
                </View>
                <Press onPress={() => flip(m)} accessibilityRole="switch" accessibilityState={{ checked: m.on }} accessibilityLabel={m.title}><Switch on={m.on} /></Press>
              </View>
              <Press onPress={() => open({ kind: 'auto', m })} accessibilityRole="button" accessibilityLabel={`Edit ${m.title}`} style={{ gap: 8 }}>
                <Text style={tx(14, '400', m.on ? INK : INK_MUTED, { lineHeight: 20 })} numberOfLines={3}>{m.body}</Text>
                <Text style={tx(13.5, '800', DEEP_GREEN)}>Edit</Text>
              </Press>
            </View>
          ))}
        </View>
      </Section>

      <Section title="Quick replies">
        <View>
          {p.quickReplies.map((q) => (
            <Press key={q.id} onPress={() => open({ kind: 'quick', id: q.id, body: q.body })} accessibilityRole="button" accessibilityLabel={`Edit ${q.body}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: 1, borderTopColor: HAIRLINE }}>
              <Text style={[tx(15), { flex: 1 }]} numberOfLines={2}>{q.body}</Text>
              <Text style={tx(13.5, '800', DEEP_GREEN)}>Edit</Text>
            </Press>
          ))}
          <Press onPress={() => open({ kind: 'quick', id: null, body: '' })} accessibilityRole="button"
            style={{ paddingVertical: 13, borderTopWidth: 1, borderBottomWidth: 1, borderColor: HAIRLINE }}>
            <Text style={tx(15, '800')}>+ Add a quick reply</Text>
          </Press>
        </View>
      </Section>

      {editing ? (
        <DeskSheet title={editing.kind === 'auto' ? editing.m.title : editing.id ? 'Quick reply' : 'Add a quick reply'} onClose={close}
          footer={(
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {editing.kind === 'quick' && editing.id ? <Btn label="Delete" kind="grey" disabled={busy} onPress={() => remove(editing.id!)} style={{ flex: 1 }} /> : null}
              <Btn label="Save" disabled={busy} onPress={save} style={{ flex: 1 }} />
            </View>
          )}>
          {editing.kind === 'auto' ? <Kicker>{editing.m.when}</Kicker> : null}
          <TextInput value={draft} onChangeText={setDraft} multiline autoFocus accessibilityLabel="Message"
            style={[inputStyle, { minHeight: editing.kind === 'auto' ? 120 : 64, textAlignVertical: 'top' }]} />
          {sheetError ? <Text style={tx(13.5, '600', INK_MUTED)}>{sheetError}</Text> : null}
        </DeskSheet>
      ) : null}
    </Page>
  );
}

