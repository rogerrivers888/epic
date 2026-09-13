import type { ChatContext, ChatTag, ChatTopic } from '../../api';

/**
 * The words the chat module says (Chat screens, 13 Sep 2026), in one place so
 * the list, a topic and the host inbox never disagree about "5 h ago".
 */

/** "1 h ago", "Yesterday", "Mon 6 Oct" — the age of something said. */
export function ago(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24 && new Date(iso).toDateString() === new Date().toDateString()) return `${hours} h ago`;
  const days = Math.round((+new Date(new Date().toDateString()) - +new Date(new Date(iso).toDateString())) / 86_400_000);
  if (days <= 1) return 'Yesterday';
  if (days < 7) return new Date(iso).toLocaleDateString('en-GB', { weekday: 'long' });
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "SUN 11 · COOKING" — the tag as the row's kicker draws it. */
export function tagKicker(tag: ChatTag): string {
  const label = tag.label ?? '';
  if (tag.kind === 'day' || tag.kind === 'stop') {
    if (tag.date) {
      const day = new Date(`${tag.date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
      const rest = tag.kind === 'day' ? label.replace(/^[A-Za-z]{3} \d{1,2} · /, '') : label;
      return `${day} · ${rest}`.toUpperCase();
    }
    return label.toUpperCase();
  }
  return label.toUpperCase();
}

/** "Sun 11 · cooking · Kate asked" — the line under a topic's title. */
export function topicMeta(t: ChatTopic): string {
  const tag = tagKicker(t.tag);
  const who = t.state === 'notice' ? `${firstOf(t.author.name)} said` : `${firstOf(t.author.name)} asked`;
  return `${tag ? `${tag.charAt(0)}${tag.slice(1).toLowerCase()} · ` : ''}${who}`;
}

export const firstOf = (n: string) => n.trim().split(/\s+/)[0] || n;

/** "Sam · organiser · 1 h ago" — who and when, on a list row. */
export function rowMeta(t: ChatTopic, ctx: ChatContext): string {
  const role = t.author.isHost ? ` · ${ctx.host?.role ?? 'host'}` : t.author.guest ? ' · guest' : '';
  return `${firstOf(t.author.name)}${role} · ${ago(t.at)}`;
}

/** "4 replies", "no replies yet", "Giulia answered" — the third line. */
export function repliesLine(t: ChatTopic): string {
  if (t.state === 'answered' && t.answer) return `${firstOf(t.answer.by)} answered`;
  if (!t.replyCount) return 'no replies yet';
  return `${t.replyCount} ${t.replyCount === 1 ? 'reply' : 'replies'}`;
}

/** "seen by 11 of 12" — never who has not. */
export function seenLine(t: ChatTopic): string {
  if (!t.seenBy) return 'seen by nobody yet';
  return t.audienceCount > t.seenBy ? `seen by ${t.seenBy} of ${t.audienceCount}` : `seen by ${t.seenBy}`;
}

/** The context's own name for the person who holds the host role. */
export const hostFirst = (ctx: ChatContext) => (ctx.host ? firstOf(ctx.host.name) : ctx.type === 'offer' ? 'the host' : 'the organiser');

/** "24 questions · 6 waiting on an answer" — the header line under the dropdowns (D3). */
export function headerLine(showing: string, n: number, waiting: number): string {
  const word = (one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  switch (showing) {
    case 'all': return `${word('thing', 'things')}${waiting ? ` · ${waiting} waiting on an answer` : ''}`;
    case 'questions': return `${word('question', 'questions')}${waiting ? ` · ${waiting} waiting on an answer` : ''}`;
    case 'waiting': return `${word('question', 'questions')} waiting on an answer`;
    case 'answered': return `${word('question', 'questions')} answered`;
    case 'notices': return word('notice', 'notices');
    case 'mine': return `${word('thing', 'things')} you asked or replied to`;
    case 'replies_to_me': return `${word('reply', 'replies')} to you`;
    case 'private': return word('private question', 'private questions');
    default: return String(n);
  }
}

/** The Showing rows (D4), in order, with which two are the indented subsets of `questions`. */
export const SHOWING_ROWS: { key: 'all' | 'questions' | 'waiting' | 'answered' | 'notices' | 'mine' | 'replies_to_me' | 'private'; label: (ctx: ChatContext) => string; sub?: boolean }[] = [
  { key: 'all', label: () => 'Everything' },
  { key: 'questions', label: () => 'Questions' },
  { key: 'waiting', label: () => 'Waiting on an answer', sub: true },
  { key: 'answered', label: () => 'Answered', sub: true },
  { key: 'notices', label: (ctx) => `Notices from the ${ctx.host?.role ?? 'organiser'}` },
  { key: 'mine', label: () => 'Mine — asked or replied' },
  { key: 'replies_to_me', label: () => 'Replies to me' },
  { key: 'private', label: (ctx) => `Private with the ${ctx.host?.role ?? 'organiser'}` },
];

/** "Sun 11 October" — a day, in full, for the calendar's foot (D8). */
export const dayLong = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' });
/** "SUN 11 OCT" — the small date over a picker row (D7). */
export const dayKicker = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
export const todayYmd = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
