import { api, ChatAskBody, ChatContextType, ChatList, ChatTopicView } from '../../api';
import { paths } from '../../routes';

/**
 * How the chat component reaches the API, and where its four layers live.
 *
 * "One component, two contexts" (Chat screens README §2) — and three doors
 * onto them: a household member on a trip or an offer, and a guest holding a
 * trip's share link, who is answered from the token rather than a session.
 * The component asks the door; it never spells a URL itself.
 */
export type ChatDoor = {
  type: ChatContextType;
  list: () => Promise<ChatList>;
  read: () => Promise<unknown>;
  topic: (id: string) => Promise<ChatTopicView>;
  ask: (body: ChatAskBody) => Promise<ChatTopicView>;
  edit?: (id: string, body: Partial<ChatAskBody> & { pinned?: boolean }) => Promise<ChatTopicView>;
  reply: (id: string, body: { body: string; quotesReplyId?: string | null; publishRequest?: 'faq' | 'group' | null }) => Promise<ChatTopicView>;
  answer?: (id: string, body: { replyId: string | null; publish?: 'faq' | null }) => Promise<ChatTopicView>;
  follow: (id: string, on: boolean) => Promise<unknown>;
  react: (id: string, body: { targetType: 'topic' | 'reply'; targetId: string; emoji: string }) => Promise<ChatTopicView>;
  decide?: (id: string, requestId: string, decision: 'anonymous' | 'named' | 'declined') => Promise<ChatTopicView>;
  report: (id: string, body: { reason?: string | null; replyId?: string | null }) => Promise<{ message: string }>;
  prefs?: () => Promise<{ prefs: import('../../api').ChatPrefs; digestAt: string; anchorsOn: string[] }>;
  setPrefs?: (p: Partial<import('../../api').ChatPrefs>) => Promise<unknown>;
  /** The addresses of the layers. `bell` is null where there is no bell — a guest is told at the contact on the invite. */
  href: { list: string; topic: (id: string) => string; ask: (tag?: string | null) => string; bell: string | null };
};

/** A household member, on a trip or on a hosted offer. */
export function householdDoor(type: ChatContextType, id: string, href: ChatDoor['href']): ChatDoor {
  return {
    type,
    list: () => api.chat(type, id),
    read: () => api.chatRead(type, id),
    topic: (t) => api.chatTopic(type, id, t),
    ask: (body) => api.chatAsk(type, id, body),
    edit: (t, body) => api.chatEdit(type, id, t, body),
    reply: (t, body) => api.chatReply(type, id, t, body),
    answer: (t, body) => api.chatAnswer(type, id, t, body),
    follow: (t, on) => api.chatFollow(type, id, t, on),
    react: (t, body) => api.chatReact(type, id, t, body),
    decide: (t, r, d) => api.chatDecide(type, id, t, r, d),
    report: (t, body) => api.chatReport(type, id, t, body),
    prefs: () => api.chatPrefs(type, id),
    setPrefs: (p) => api.setChatPrefs(type, id, p),
    href,
  };
}

export const tripDoor = (tripId: string) => householdDoor('trip', tripId, {
  list: paths.tripChat(tripId), topic: (t) => paths.tripChatTopic(tripId, t), ask: (tag) => paths.tripChatAsk(tripId, tag), bell: paths.tripChatBell(tripId),
});
export const bookingDoor = (bookingId: string, offerId: string) => householdDoor('offer', offerId, {
  list: paths.bookingChat(bookingId), topic: (t) => paths.bookingChatTopic(bookingId, t), ask: (tag) => paths.bookingChatAsk(bookingId, tag), bell: paths.bookingChatBell(bookingId),
});
export const hostOfferDoor = (offerId: string) => householdDoor('offer', offerId, {
  list: paths.hostOfferChat(offerId), topic: (t) => paths.hostOfferChatTopic(offerId, t), ask: (tag) => paths.hostOfferChatAsk(offerId, tag), bell: paths.hostOfferChatBell(offerId),
});

/**
 * A guest holding a trip's share link (README §12). Same rooms, smaller key:
 * `everyone` topics only, never `host_only`, never the answer. The layers are
 * the query on the shared page — the page is outside the app and has one
 * address — so `href` is spelled by the screen that mounts this.
 */
export function guestDoor(token: string, you: string, href: ChatDoor['href']): ChatDoor {
  return {
    type: 'trip',
    list: () => api.sharedChat(token, you),
    read: async () => undefined,
    topic: (t) => api.sharedTopic(token, you, t),
    ask: (body) => api.sharedSend(token, { you, body: body.body ?? body.title, title: body.title, tag: body.tag }),
    reply: (t, body) => api.sharedSend(token, { you, body: body.body, topicId: t, quotesReplyId: body.quotesReplyId ?? null }),
    follow: (t, on) => api.sharedFollow(token, you, t, on),
    react: (t, body) => api.sharedReact(token, you, t, body),
    report: (t, body) => api.sharedReport(token, you, t, body),
    href,
  };
}
