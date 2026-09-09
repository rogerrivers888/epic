import React, { useCallback, useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../components/press';
import { api, ChatMessage, SharedTrip } from '../api';
import { colors, fonts, BORDER, type } from '../theme';
import { Icon } from '../components/Icon';
import { Wordmark } from '../components/Wordmark';
import { Thread, Composer } from '../components/Thread';
import { StatusLine } from '../components/ui';
import { useViewport } from '../hooks/useViewport';

/**
 * Somebody else's door into one trip (trip rebuild, 7 Sep 2026, screen 3b).
 *
 * "Anyone with the link sees the plan, people and chat as a guest — no account
 * needed." So this screen is outside the app: no tabs, no household, no atlas,
 * and every read is answered from the link rather than from a session
 * (`api/routes/shared.js`).
 *
 * The way in is a contact and a one-time code. Where Epic has no way to send a
 * code — neither Twilio nor the mail key is Epic's to switch on (CLAUDE.md) —
 * somebody the organiser wrote down by hand is let straight in, because that is
 * the same vouching the code would have established, and everybody else is told
 * in one sentence to ask for their own link. Nothing here pretends.
 */

const KEY = (token: string) => `epic.shared.${token}`;
const held = (token: string) => {
  try { return Platform.OS === 'web' && typeof localStorage !== 'undefined' ? localStorage.getItem(KEY(token)) : null; } catch { return null; }
};
const hold = (token: string, you: string) => {
  try { if (Platform.OS === 'web' && typeof localStorage !== 'undefined') localStorage.setItem(KEY(token), you); } catch { /* a full store just means asking again */ }
};

const mins = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`);

export function SharedTripScreen({ token, you: fromLink }: {
  token: string;
  /** `?you=` on the link the organiser sent, which is that guest's own door. */
  you?: string | null;
}) {
  const { width } = useViewport();
  const wide = width >= 900;
  const [you, setYou] = useState<string | null>(fromLink ?? held(token));
  const [data, setData] = useState<SharedTrip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'plan' | 'chat'>('plan');

  useEffect(() => { if (fromLink) hold(token, fromLink); }, [token, fromLink]);

  const load = useCallback(async () => {
    try { setData(await api.sharedTrip(token, you)); setError(null); } catch (e: any) { setError(e.message); }
  }, [token, you]);
  useEffect(() => { load(); }, [load]);

  const joined = Boolean(data?.you?.joined);

  return (
    <View style={styles.page}>
      <View style={[styles.head, wide && styles.wide]}>
        <Wordmark height={26} ground={colors.bg} />
        {data ? (
          <>
            <Text style={styles.title} numberOfLines={2}>{data.trip.title}</Text>
            <Text style={styles.meta} numberOfLines={2}>
              {[data.trip.dates, data.trip.where, data.trip.from ? `shared by ${data.trip.from}` : null].filter(Boolean).join(' · ')}
            </Text>
          </>
        ) : null}
      </View>

      {error ? <View style={{ padding: 20 }}><StatusLine tone="warn">{error}</StatusLine></View> : null}

      {!data ? <Text style={[type.small, { padding: 20 }]}>Opening…</Text> : !joined ? (
        <EnterDoor
          token={token}
          canSend={data.canSend ?? { sms: false, email: false }}
          onIn={(next, payload) => { setYou(next); hold(token, next); if (payload) setData(payload); }}
        />
      ) : (
        <>
          <View style={[styles.tabs, wide && styles.wide]}>
            {([{ key: 'plan' as const, label: 'The plan' }, { key: 'chat' as const, label: 'Chat' }]).map((t) => {
              const on = t.key === tab;
              return (
                <Press key={t.key} onPress={() => setTab(t.key)} style={[styles.tab, on && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                  <Text style={[styles.tabText, on && styles.tabTextOn]}>{t.label}</Text>
                </Press>
              );
            })}
          </View>
          {tab === 'plan' ? <Plan data={data} wide={wide} /> : <GuestChat token={token} you={you!} />}
        </>
      )}
    </View>
  );
}

/** The plan, the travel and the people — everything a guest is shown. */
function Plan({ data, wide }: { data: SharedTrip; wide: boolean }) {
  return (
    <ScrollView contentContainerStyle={[styles.body, wide && styles.wide]}>
      {data.travel.length ? <Text style={styles.kicker}>Getting there</Text> : null}
      {data.travel.map((l, i) => (
        <View key={`${l.direction}-${i}`} style={styles.row}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={styles.rowName} numberOfLines={1}>
              {[l.from, l.to].filter(Boolean).join(' → ') || (l.direction === 'outbound' ? 'Out' : 'Back')}
            </Text>
            <Text style={styles.rowSub} numberOfLines={1}>
              {[l.direction === 'outbound' ? 'Out' : 'Back', [l.departAt, l.arriveAt].filter(Boolean).join(' → '), l.carrier, l.serviceNo].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
      ))}

      {data.days.map((d) => (
        <View key={d.id}>
          <Text style={styles.kicker}>{d.label ?? 'The day'}</Text>
          {!d.stops.length ? <Text style={styles.blank}>Nothing planned for this day yet.</Text> : null}
          {d.stops.map((s) => (
            <View key={s.id} style={styles.row}>
              <Text style={styles.time}>{s.startTime ?? ''}</Text>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={styles.rowName} numberOfLines={2}>{s.name}</Text>
                {s.dwellMinutes ? <Text style={styles.rowSub}>{mins(s.dwellMinutes)}</Text> : null}
              </View>
            </View>
          ))}
        </View>
      ))}

      <Text style={styles.kicker}>Who's coming</Text>
      <View style={styles.faces}>
        {[...data.people.members, ...data.people.guests].map((p, i) => (
          <View key={`${p.name}-${i}`} style={styles.face}>
            <Text style={styles.faceText}>{p.initial}</Text>
          </View>
        ))}
        <Text style={styles.rowSub}>
          {[...data.people.members.map((m) => m.name), ...data.people.guests.map((g) => `${g.name} (guest)`)].join(', ')}
        </Text>
      </View>
    </ScrollView>
  );
}

function GuestChat({ token, you }: { token: string; you: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api.sharedChat(token, you); setMessages(r.messages); setError(null); } catch (e: any) { setError(e.message); }
  }, [token, you]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      {error ? <View style={{ paddingHorizontal: 20 }}><StatusLine tone="warn">{error}</StatusLine></View> : null}
      <Thread messages={messages} empty="Nothing said yet — you can start it." />
      <Composer
        placeholder="Message the group"
        busy={busy}
        onSend={async (body) => {
          setBusy(true);
          try { const r = await api.sharedSend(token, { you, body }); setMessages(r.messages); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
        }}
      />
    </>
  );
}

/** Name, contact, code. Three fields, no account, no password. */
function EnterDoor({ token, canSend, onIn }: {
  token: string;
  canSend: { sms: boolean; email: boolean };
  onIn: (you: string, payload?: SharedTrip) => void;
}) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [guestId, setGuestId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [says, setSays] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const enter = async () => {
    if (busy || !contact.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.sharedEnter(token, { name: name.trim() || undefined, contact: contact.trim() });
      // Let straight in: the organiser had already written this contact down.
      if (r.token) { onIn(r.token, r as any); return; }
      setGuestId(r.guestId);
      setSays(r.message ?? null);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const verify = async () => {
    if (busy || !guestId || code.trim().length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.sharedVerify(token, { guestId, code: code.trim() });
      onIn(r.token, r);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const sending = canSend.sms || canSend.email;

  return (
    <View style={styles.door}>
      <Text style={styles.doorTitle}>Say who you are</Text>
      <Text style={styles.doorBody}>
        You will see the plan, who is coming and the chat. There is nothing to sign up for and nothing to pay.
      </Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Your name"
        placeholderTextColor={colors.inkMuted}
        style={styles.input}
        accessibilityLabel="Your name"
      />
      <TextInput
        value={contact}
        onChangeText={setContact}
        placeholder="Mobile or email"
        placeholderTextColor={colors.inkMuted}
        autoCapitalize="none"
        style={styles.input}
        accessibilityLabel="Your mobile or email"
        onSubmitEditing={enter}
      />
      {!guestId ? (
        <Press onPress={enter} style={styles.primary} accessibilityRole="button" disabled={busy}>
          <Text style={styles.primaryText}>{busy ? 'One moment…' : sending ? 'Send me a code' : 'Open the trip'}</Text>
        </Press>
      ) : (
        <>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="The six digits"
            placeholderTextColor={colors.inkMuted}
            keyboardType="number-pad"
            style={styles.input}
            accessibilityLabel="The code you were sent"
            onSubmitEditing={verify}
          />
          <Press onPress={verify} style={styles.primary} accessibilityRole="button" disabled={busy}>
            <Text style={styles.primaryText}>{busy ? 'Checking…' : 'Open the trip'}</Text>
          </Press>
        </>
      )}
      {says ? <Text style={styles.doorBody}>{says}</Text> : null}
      {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  wide: { maxWidth: 680, alignSelf: 'center', width: '100%' },
  head: { paddingHorizontal: 20, paddingTop: 16, gap: 10 },
  title: { fontFamily: fonts.heading, fontSize: 30, fontWeight: '800', letterSpacing: -0.9, lineHeight: 32, color: colors.ink },
  meta: { fontFamily: fonts.body, fontSize: 14, color: colors.inkMuted },

  tabs: { flexDirection: 'row', marginTop: 16, marginHorizontal: 20, borderWidth: BORDER, borderColor: colors.line },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: colors.surface },
  tabOn: { backgroundColor: colors.selected },
  tabText: { fontFamily: fonts.heading, fontSize: 16, fontWeight: '800', letterSpacing: -0.32, color: colors.inkMuted },
  tabTextOn: { color: colors.selectedFg },

  body: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 40 },
  kicker: {
    fontFamily: fonts.body, fontSize: 11, fontWeight: '600', letterSpacing: 0.88, textTransform: 'uppercase',
    color: colors.inkMuted, paddingTop: 20, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  time: { width: 48, fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.ink },
  rowName: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: colors.ink },
  rowSub: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted },
  blank: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, paddingVertical: 12 },

  faces: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingVertical: 12 },
  face: { width: 28, height: 28, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  faceText: { fontFamily: fonts.heading, fontSize: 12, fontWeight: '800', color: colors.ink },

  door: { padding: 20, gap: 12 },
  doorTitle: { fontFamily: fonts.heading, fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  doorBody: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, lineHeight: 19 },
  input: {
    height: 48, paddingHorizontal: 14, borderWidth: BORDER, borderColor: colors.ink,
    backgroundColor: colors.surface, fontFamily: fonts.body, fontSize: 16, color: colors.ink,
  },
  primary: { backgroundColor: colors.primary, paddingVertical: 16, alignItems: 'center' },
  primaryText: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: colors.primaryFg },
});
