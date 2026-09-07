import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, OrderTicket } from '../api';
import { colors, radius, spacing, type, BORDER } from '../theme';
import { Row, Segmented } from '../components/ui';
import { Icon } from '../components/Icon';
import { Wordmark } from '../components/Wordmark';

/**
 * What the code on the table opens (owner, 7 Sep 2026).
 *
 *   > "Maybe there could be a QR code that the waiter could scan to then see
 *   > what I've ordered, because standing there holding the phone while they
 *   > take a note of what I want to order was quite awkward."
 *
 * So this is written for somebody standing up, holding their own phone, in a
 * room where they cannot lean in: big type, one column, the words for the
 * kitchen under the dish they belong to, and the allergens where they cannot be
 * scrolled past. It is not the Epic app — there is no tab bar, no sign-in and
 * nothing to tap through to — because the person reading it is at work.
 *
 * It reads itself again every twenty seconds. The table goes on choosing after
 * the waiter has scanned, and a ticket that quietly went stale in somebody's
 * hand would be worse than no ticket at all.
 */
export function OrderTicketScreen({ token }: { token: string }) {
  const [ticket, setTicket] = useState<OrderTicket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<Date | null>(null);
  const [by, setBy] = useState<'person' | 'course'>('person');

  const load = useCallback(async () => {
    try {
      setTicket(await api.orderTicket(token));
      setAt(new Date());
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'That code did not open an order.');
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const every = setInterval(load, 20_000);
    return () => clearInterval(every);
  }, [load]);

  const people = useMemo(() => {
    if (!ticket) return [];
    const order = [...new Set(ticket.items.map((i) => i.who ?? ''))];
    return order.map((who) => ({
      who: who || 'For the table',
      shared: !who,
      items: ticket.items.filter((i) => (i.who ?? '') === who),
    }));
  }, [ticket]);

  const courses = useMemo(() => {
    if (!ticket) return [];
    const order = [...new Set(ticket.items.map((i) => i.section ?? 'Ordered'))];
    return order.map((title) => ({ title, items: ticket.items.filter((i) => (i.section ?? 'Ordered') === title) }));
  }, [ticket]);

  if (error) {
    return (
      <View style={styles.middle}>
        <Wordmark />
        <Text style={type.h2}>That code does not open an order</Text>
        <Text style={type.small}>Ask the table to show it again — a new order gets a new code.</Text>
      </View>
    );
  }
  if (!ticket) {
    return (
      <View style={styles.middle}>
        <ActivityIndicator color={colors.icon} />
        <Text style={type.small}>Opening the order…</Text>
      </View>
    );
  }

  const covers = new Set(ticket.items.map((i) => i.who).filter(Boolean)).size;

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.body}>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.venue}>{ticket.venue ?? 'The order'}</Text>
          {/* Covers counts everybody with a plate, guests included, so it is
              not said twice. */}
          <Text style={type.small}>
            {ticket.items.length} {ticket.items.length === 1 ? 'plate' : 'plates'}
            {covers ? ` · ${covers} ${covers === 1 ? 'person' : 'people'}` : ''}
          </Text>
        </View>
        <Wordmark />
      </Row>

      {/* The allergens first and in the warning red: they are the one thing on
          this page that changes what happens in the kitchen. Epic can never
          clear a dish of something a menu does not have to declare, so it says
          to ask rather than pretending to know. */}
      {ticket.allergens.length ? (
        <View style={styles.alert}>
          <Row style={{ alignItems: 'flex-start' }}>
            <Icon name="allergen" size={20} color={colors.allergen} />
            <Text style={[styles.alertText, { flex: 1 }]}>{ticket.allergens.join(' ')}</Text>
          </Row>
          <Text style={styles.alertSmall}>Please check anything cooked in a stock, a soffritto or a shared fryer.</Text>
        </View>
      ) : null}
      {ticket.diets.length ? <Text style={styles.diet}>{ticket.diets.join(' ')}</Text> : null}

      <Segmented value={by} onChange={setBy} options={[{ value: 'person', label: 'By person' }, { value: 'course', label: 'By course' }]} />

      {(by === 'person' ? people : courses.map((c) => ({ who: c.title, shared: false, items: c.items }))).map((g) => (
        <View key={g.who} style={{ gap: 4 }}>
          <Text style={styles.who}>{g.who}</Text>
          {g.items.map((i, n) => (
            <View key={`${i.name}:${n}`} style={styles.line}>
              <Row style={{ alignItems: 'flex-start' }}>
                <Text style={[styles.dish, { flex: 1 }]}>{i.name}</Text>
                <Text style={type.small}>{i.priceText ?? ''}</Text>
              </Row>
              {/* One person's own words, under their own plate: two people
                  having the same dish can ask for different things. */}
              {i.note ? <Text style={styles.note}>{i.note}</Text> : null}
              {by === 'course' ? <Text style={type.small}>{i.who ? `for ${i.who}` : 'for the table'}</Text> : null}
            </View>
          ))}
        </View>
      ))}

      {ticket.total ? (
        <Row style={styles.total}>
          <Text style={type.h3}>Total as printed</Text>
          <Text style={type.h3}>£{ticket.total.toFixed(2).replace(/\.00$/, '')}</Text>
        </Row>
      ) : null}
      <Text style={type.tiny}>
        This is the table's order as it stands{at ? `, read at ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}.
        The page keeps itself up to date while it is open, so anything they add appears here.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  middle: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  venue: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, color: colors.ink },
  who: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 1, fontWeight: '800', marginTop: spacing.sm },
  line: { paddingVertical: 6, borderTopWidth: BORDER, borderTopColor: colors.line, gap: 2 },
  dish: { fontSize: 21, fontWeight: '800', letterSpacing: -0.4, color: colors.ink, lineHeight: 26 },
  note: { fontSize: 16, fontWeight: '700', color: colors.accent, lineHeight: 21 },
  diet: { fontSize: 15, fontWeight: '600', color: colors.ink },
  alert: { borderWidth: 2, borderColor: colors.allergen, borderRadius: radius.sm, padding: spacing.sm, gap: 4 },
  alertText: { fontSize: 17, fontWeight: '800', color: colors.allergen, lineHeight: 22 },
  alertSmall: { fontSize: 13, fontWeight: '600', color: colors.allergen },
  total: { borderTopWidth: BORDER, borderTopColor: colors.ink, paddingTop: spacing.sm, justifyContent: 'space-between' },
});
