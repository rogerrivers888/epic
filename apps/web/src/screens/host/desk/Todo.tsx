/**
 * E5 · To do (hosting v4, README E5).
 *
 * Most urgent first, grouped Today · This week · Soon. Each row says what,
 * what it is holding up, and the deadline on the right — red when it is today
 * or blocking money. A row opens the place where the thing gets done.
 */

import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from '../../../router';
import { paths } from '../../../routes';
import { api } from '../../../api';
import { HAIRLINE } from '../../../theme';
import { Empty, Head, Loading, Page, Row, Section } from './kit';
import { dayWords, shortDate, ukDay, type DeskTodo as Todo, type TodoItem } from './model';

const GROUPS: { key: keyof Todo; title: string }[] = [
  { key: 'today', title: 'Today' },
  { key: 'week', title: 'This week' },
  { key: 'soon', title: 'Soon' },
];

const plain = (e: unknown) => {
  const m = e instanceof Error ? e.message : '';
  return !m || /^HTTP \d+/.test(m) ? 'To do could not be loaded. Try again in a moment.' : m;
};

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
const day = (iso: string) => dayWords(ukDay(iso));
const dayMonth = (iso: string) => shortDate(iso);

/** How long ago a question was asked. */
function age(askedIso: string, now: number) {
  const mins = Math.max(0, Math.round((now - new Date(askedIso).getTime()) / 60_000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`;
}

/** The deadline on the right and the word under it, from the kind of item. */
function deadline(it: TodoItem, now: number): { right: string | null; sub: string | null } {
  if (it.kind === 'tax' || it.kind === 'payouts' || (it.now && !it.due)) return { right: 'Now', sub: null };
  if (!it.due) return { right: null, sub: null };
  switch (it.kind) {
    case 'ask_to_book': return { right: time(it.due), sub: 'reply by' };
    case 'question': return { right: it.asked ? age(it.asked, now) : null, sub: it.asked ? 'asked' : null };
    case 'attendance':
    case 'changes': return { right: day(it.due), sub: 'by' };
    case 'insurance':
    case 'checked': return { right: dayMonth(it.due), sub: null };
    default: return { right: day(it.due), sub: 'by' };
  }
}

/** Where a row goes. */
function target(it: TodoItem): string | null {
  switch (it.kind) {
    case 'ask_to_book': return it.offerId ? paths.hostOfferChat(it.offerId) : null;
    case 'question': return it.offerId ? (it.ref ? paths.hostOfferChatTopic(it.offerId, it.ref) : paths.hostOfferChat(it.offerId)) : null;
    case 'attendance': return it.offerId ? paths.hostEvent(it.offerId, { session: it.ref }) : null;
    case 'changes':
    case 'draft': return it.offerId ? paths.hostSetup(it.offerId) : null;
    case 'tax':
    case 'payouts': return paths.hostSettings('settings');
    case 'insurance':
    case 'checked': return paths.hostSettings('checks');
    default: return null;
  }
}

export function DeskTodo() {
  const { navigate, back } = useRouter();
  const [todo, setTodo] = useState<Todo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.deskTodo().then(setTodo).catch((e) => setError(plain(e))); }, []);

  const head = <Head back="Host" onBack={() => back(paths.host())} title="To do" />;
  if (!todo) return <Page>{head}<Loading error={error} /></Page>;

  const now = Date.now();
  const groups = GROUPS.filter((g) => todo[g.key].length > 0);
  return (
    <Page>
      {head}
      {groups.length === 0 ? (
        <Section><Empty>Nothing to do.</Empty></Section>
      ) : groups.map((g) => (
        <Section key={g.key} title={g.title} style={{ gap: 0 }}>
          <View style={{ marginTop: 10, borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
            {todo[g.key].map((it, i) => {
              const d = deadline(it, now);
              const to = target(it);
              return (
                <Row key={`${it.kind}-${it.offerId ?? ''}-${it.ref ?? ''}-${i}`} title={it.title} line={it.line}
                  right={d.right} rightSub={d.sub} red={it.red} onPress={to ? () => navigate(to) : null} />
              );
            })}
          </View>
        </Section>
      ))}
    </Page>
  );
}
