import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Press } from './press';
import { colors, fonts, radius, spacing, type, BORDER } from '../theme';
import { Button, Row } from './ui';
import { Icon } from './Icon';

/**
 * The free month (Group Trips v2, Epic 7).
 *
 * Somebody who came in through a friend's invite now has an account they did
 * not ask for, so this page answers the two questions they actually have: what
 * happens on day 30, and what happens to the trip they just paid towards. The
 * answers are "nothing, unless you add a card" and "nothing at all" — and the
 * trip's payments are listed underneath, separately, because they are not a
 * subscription and must never read as one.
 *
 * Epic cannot take a card yet: there is no payment provider connected (Open
 * question A1). Keeping Epic therefore says so rather than opening a form that
 * cannot charge anything.
 */

const TRIAL_DAYS = 30;
const money = (p: number) => `£${(p / 100).toLocaleString('en-GB', { minimumFractionDigits: p % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
const dayOf = (iso?: string | null) => {
  if (!iso) return null;
  const left = Math.round((new Date(`${iso.slice(0, 10)}T12:00:00`).getTime() - Date.now()) / 86400000);
  return { left: Math.max(0, left), day: Math.min(TRIAL_DAYS, Math.max(1, TRIAL_DAYS - left)) };
};
const onDay = (endsOn: string, n: number) =>
  new Date(new Date(`${endsOn.slice(0, 10)}T12:00:00`).getTime() - (TRIAL_DAYS - n) * 86400000)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export function FreeMonth({ trialEndsOn, tripName, payments = [], onBack, onDone, doneLabel }: {
  trialEndsOn: string | null;
  tripName?: string | null;
  payments?: { label: string; pence: number; on?: string | null }[];
  onBack?: () => void; onDone?: () => void; doneLabel?: string;
}) {
  const [note, setNote] = useState(false);
  const t = dayOf(trialEndsOn);
  const pct = t ? t.day / TRIAL_DAYS : 0;
  // Day 30 with no card (Group Trips v2, Epic 7 AC3 — G28): planning is
  // paused, nothing was taken, and everything they made is still here.
  const ended = Boolean(trialEndsOn && t && t.left === 0 && new Date(`${trialEndsOn.slice(0, 10)}T12:00:00`).getTime() < Date.now());
  if (ended) {
    return (
      <View style={{ gap: spacing.md }}>
        <Row style={{ justifyContent: 'space-between' }}>
          {onBack ? <Press onPress={onBack} accessibilityRole="button"><Icon name="back" size={18} /></Press> : <View />}
          <Text style={type.h2}>Your Epic</Text>
          <View style={{ width: 18 }} />
        </Row>
        <View style={[styles.hero, { backgroundColor: colors.warm }]}>
          <Text style={type.label}>FREE TRIAL · ENDED {new Date(`${trialEndsOn!.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase()}</Text>
          <Text style={type.title}>Planning is paused.</Text>
          <Text style={type.body}>Nothing was taken — you never added a card. Everything you made is still here, waiting.</Text>
        </View>
        <View style={{ gap: spacing.sm }}>
          <Text style={type.label}>WHAT YOU KEEP</Text>
          {[
            { t: tripName ?? 'Your group trip', b: `Your place, your picks${payments.length ? ` and your ${money(payments.reduce((n, p) => n + p.pence, 0))}` : ''} — untouched`, keep: true },
            { t: 'Your trips', b: 'Every saved trip and everything on them', keep: true },
            { t: 'Your household', b: 'Everyone stays as they are', keep: true },
            { t: 'Planning new trips', b: 'Inspire, Places and new trips are paused', keep: false },
            { t: 'Shortlists and hearts', b: 'Saved, but you cannot add more for now', keep: false },
          ].map((k, i) => (
            <Row key={i} style={{ alignItems: 'flex-start' }}>
              <Icon name={k.keep ? 'check' : 'pause'} size={16} color={k.keep ? colors.accent : colors.inkMuted} />
              <View style={{ flex: 1 }}><Text style={type.h3}>{k.t}</Text><Text style={type.small}>{k.b}</Text></View>
            </Row>
          ))}
        </View>
        <Button label="Start planning again · £4.99 a month" icon="forward" onPress={() => setNote(true)} />
        {note ? <Text style={[type.small, { color: colors.headerSub }]}>There is nothing to pay yet — Epic has no card provider connected. You'll be asked properly before that changes.</Text> : <Text style={[type.small, { textAlign: 'center' }]}>Cancel any time · your trips are never deleted</Text>}
        {payments.length ? (
          <View style={{ gap: 4, borderTopWidth: BORDER, borderTopColor: colors.line, paddingTop: spacing.sm }}>
            {payments.map((p, n) => (
              <Row key={n} style={{ justifyContent: 'space-between' }}>
                <Text style={type.small}>{n === 0 ? 'Trip payments' : ''}</Text>
                <Text style={[type.small, { color: colors.ink, fontWeight: '700' }]}>{p.label} {money(p.pence)}{p.on ? ` · paid ${new Date(p.on).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}</Text>
              </Row>
            ))}
          </View>
        ) : null}
        {onDone ? <Button label={doneLabel ?? 'See my list'} kind="ghost" onPress={onDone} /> : null}
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        {onBack ? <Press onPress={onBack} accessibilityRole="button"><Icon name="back" size={18} /></Press> : <View />}
        <Text style={type.h2}>Your Epic</Text>
        <View style={{ width: 18 }} />
      </Row>

      <View style={styles.hero}>
        <Text style={[type.label, { color: colors.headerSub }]}>FREE TRIAL{t ? ` · DAY ${t.day} OF ${TRIAL_DAYS}` : ''}</Text>
        <Text style={type.title}>{t ? `${t.left} day${t.left === 1 ? '' : 's'} left of the full app.` : 'The full app, free for 30 days.'}</Text>
        <Text style={[type.body, { color: colors.headerSub }]}>
          Nothing happens on day {TRIAL_DAYS} unless you add a card.
          {tripName ? ` Your ${tripName} booking is separate and stays exactly as it is.` : ''}
        </Text>
        <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(pct * 100)}%` }]} /></View>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text style={type.label}>WHAT WE'LL SEND</Text>
        {[
          { n: 1, text: `Welcome. You're in ${tripName ?? 'the trip'}; here's the rest of Epic.` },
          { n: 23, text: 'A week left. One tap to keep it — or do nothing and it just stops.' },
          { n: 30, text: 'Trial ends. Your trips and household stay; planning pauses until you subscribe.' },
        ].map((m) => {
          const done = t ? t.day >= m.n : false;
          return (
            <Row key={m.n} style={{ alignItems: 'flex-start' }}>
              <View style={[styles.dot, done && styles.dotOn]} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={type.label}>DAY {m.n}{trialEndsOn ? ` · ${onDay(trialEndsOn, m.n)}` : ''}</Text>
                <Text style={type.body}>{m.text}</Text>
              </View>
            </Row>
          );
        })}
      </View>

      <View style={{ gap: 6 }}>
        <Button label="Keep Epic · £4.99 a month" icon="forward" onPress={() => setNote(true)} />
        {note ? (
          <Text style={[type.small, { color: colors.headerSub }]}>
            There is nothing to pay yet — Epic has no card provider connected, so day {TRIAL_DAYS} will not take anything from you.
            You'll be asked properly before that changes.
          </Text>
        ) : (
          <Row style={{ justifyContent: 'center' }}>
            <Icon name="card" size={14} color={colors.inkMuted} />
            <Text style={type.small}>Add a card only when you choose to. Cancel any time.</Text>
          </Row>
        )}
      </View>

      {payments.length ? (
        <View style={{ gap: 4, borderTopWidth: BORDER, borderTopColor: colors.line, paddingTop: spacing.sm }}>
          {payments.map((p, n) => (
            <Row key={n} style={{ justifyContent: 'space-between' }}>
              <Text style={type.small}>{n === 0 ? 'Trip payments' : ''}</Text>
              <Text style={[type.small, { color: colors.ink, fontWeight: '700' }]}>
                {p.label} {money(p.pence)}{p.on ? ` · paid ${new Date(p.on).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}
              </Text>
            </Row>
          ))}
        </View>
      ) : null}

      {onDone ? <Button label={doneLabel ?? 'See my list'} kind="ghost" onPress={onDone} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.lime, borderRadius: radius.lg, padding: spacing.lg, gap: 6 },
  track: { height: 8, borderRadius: 4, backgroundColor: 'rgba(32,30,29,0.14)', marginTop: spacing.sm, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: colors.ink },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.surface },
  dotOn: { backgroundColor: colors.accent, borderColor: colors.accent },
});
