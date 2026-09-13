import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../press';
import { ChatReaction, ChatReply, ChatTopic, ChatTopicView } from '../../api';
import { colors, fonts, BORDER, ON_LIME, TARGET } from '../../theme';
import { Icon } from '../Icon';
import { Avatar } from '../Faces';
import { StatusLine } from '../ui';
import { useViewport } from '../../hooks/useViewport';
import { useKeyboardInset } from '../../hooks/useKeyboardInset';
import { TOP_INSET } from '../InspireHeader';
import { ChatDoor } from './door';
import { ChatSheet } from './ChatSheet';
import { ReactionPicker } from './ReactionPicker';
import { TopicMenu } from './TopicMenu';
import { ago, firstOf, hostFirst, tagKicker } from './words';

/**
 * One question, open (E1, C2, E4; D1 and D2 for a private one).
 *
 * The question, then the answer in a bordered block so it is not buried, then
 * the flat replies. Two levels only: a reply can never be replied to, and an
 * inline reply is the quoted line above the composer with an ✕ — a rendered
 * quote, not a sub-thread. Reactions sit under each message; seen-by sits on
 * the meta line, right-aligned, so it costs no vertical space, and never
 * says who has *not* read.
 *
 * A Follow button sits in the header when you are not following, with a line
 * under it saying replying follows it anyway. The ellipsis is grouped by who
 * can do it (TopicMenu). Opening the topic marks every reply in it seen —
 * the API does that on the read.
 */

const colourIndex = (id: string | null) => (id ? [...id].reduce((n, c) => (n + c.charCodeAt(0)) % 6, 0) : 0);

export function TopicScreen({ door, topicId, onBack, onEdit, shareHref, insetBottom = 0 }: {
  door: ChatDoor;
  topicId: string;
  onBack: () => void;
  /** The asker's edit: the question, its tag, its audience — the composer again, filled in. */
  onEdit: (topicId: string) => void;
  /** The address of this question, for "Copy link". */
  shareHref: string;
  insetBottom?: number;
}) {
  const { width } = useViewport();
  const wide = width >= 900;
  const keyboard = useKeyboardInset();
  const [view, setView] = useState<ChatTopicView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [quoting, setQuoting] = useState<ChatReply | null>(null);
  const [picker, setPicker] = useState<{ targetType: 'topic' | 'reply'; targetId: string } | null>(null);
  const [menu, setMenu] = useState(false);
  const [picking, setPicking] = useState(false);
  const [where, setWhere] = useState<ChatReply | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  /** D1: the host's private reply, and whether to ask the asker about publishing it. */
  const [privateSend, setPrivateSend] = useState<'just' | 'ask'>('just');
  /** D2: the asker's three answers, anonymous preselected. */
  const [decision, setDecision] = useState<'anonymous' | 'named' | 'declined'>('anonymous');
  const scroller = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    try { setView(await door.topic(topicId)); setError(null); } catch (e: any) { setError(e.message); }
  }, [door, topicId]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<ChatTopicView | void>) => {
    setBusy(true); setError(null);
    try { const v = await fn(); if (v) setView(v); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  if (error && !view) {
    return (
      <View style={[styles.page, wide && styles.wide]}>
        <Head onBack={onBack} title="Not here" meta={error} />
      </View>
    );
  }
  if (!view) return <View style={[styles.page, wide && styles.wide]}><Head onBack={onBack} title="Opening…" meta="" /></View>;

  const { context: ctx, topic: t, replies } = view;
  const me = ctx.me;
  const host = hostFirst(ctx);
  const isPrivate = t.audience === 'host_only';
  const hostReplyingPrivately = Boolean(me?.isHost && isPrivate && !t.mine && door.type);
  const askerName = firstOf(t.author.name);
  const pending = view.publishRequests.find((r) => r.forMe) ?? null;
  const suggested = view.askCount != null && view.askCount >= view.suggestPublishAt;
  const destination = ctx.type === 'offer' ? 'faq' : 'group';

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setText('');
    const quote = quoting?.id ?? null;
    setQuoting(null);
    await run(async () => {
      try {
        return await door.reply(t.id, { body, quotesReplyId: quote, publishRequest: hostReplyingPrivately && privateSend === 'ask' ? destination : null });
      } catch (e) { setText(body); throw e; }
    });
    setPrivateSend('just');
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
  };

  const react = (targetType: 'topic' | 'reply', targetId: string, emoji: string) => run(() => door.react(t.id, { targetType, targetId, emoji }));

  const onMenu = async (key: string) => {
    setMenu(false);
    switch (key) {
      case 'follow': await run(async () => { await door.follow(t.id, true); return door.topic(t.id); }); break;
      case 'unfollow': await run(async () => { await door.follow(t.id, false); return door.topic(t.id); }); break;
      case 'link': {
        const full = `${originOf()}${shareHref}`;
        try { await (globalThis as any).navigator?.clipboard?.writeText(full); setSaid('Link copied.'); } catch { setSaid(full); }
        setTimeout(() => setSaid(null), 2500);
        break;
      }
      case 'seen': setSaid(`${t.seenBy}${t.audienceCount > t.seenBy ? ` of ${t.audienceCount}` : ''} have opened this. Nobody is told who has not.`); setTimeout(() => setSaid(null), 4000); break;
      case 'edit': onEdit(t.id); break;
      case 'answer': setPicking(true); setSaid('Tap "Mark as the answer" under the reply that answers it.'); setTimeout(() => setSaid(null), 4000); break;
      case 'pin': await run(() => door.edit!(t.id, { pinned: true })); break;
      case 'unpin': await run(() => door.edit!(t.id, { pinned: false })); break;
      case 'report': setReporting(true); break;
      default: break;
    }
  };

  const markAnswer = async (r: ChatReply, publish: 'faq' | null = null) => {
    setPicking(false); setWhere(null);
    await run(() => door.answer!(t.id, { replyId: r.id, publish }));
  };

  return (
    <View style={[styles.page, wide && styles.wide]}>
      <Head
        onBack={onBack}
        title={t.title}
        meta={`${lower(tagKicker(t.tag))}${isPrivate ? ' · private' : ''} · ${t.state === 'notice' ? `${askerName} said` : `${askerName} asked`}`}
        trailing={me ? (
          <View style={styles.headRight}>
            {t.state !== 'notice' ? (
              <Press onPress={() => onMenu(t.following ? 'unfollow' : 'follow')} accessibilityRole="button" accessibilityState={{ selected: t.following }} style={[styles.follow, t.following && styles.following]} disabled={busy}>
                <Icon name={t.following ? 'bell' : 'bell'} size={15} color={colors.ink} strokeWidth={2.2} />
                <Text style={styles.followText}>{t.following ? 'Following' : 'Follow'}</Text>
              </Press>
            ) : null}
            <Press onPress={() => setMenu(true)} accessibilityRole="button" accessibilityLabel="More" style={[styles.more, menu && styles.moreOn]}>
              <Icon name="menu" size={20} color={colors.ink} strokeWidth={2.2} />
            </Press>
          </View>
        ) : null}
      />

      {me && !t.following && t.state !== 'notice' ? (
        <View style={styles.banner}>
          <Icon name="bellOff" size={16} color={colors.inkMuted} />
          <Text style={styles.bannerText}>You are not following this. Reply or tap <Text style={{ fontWeight: '700' }}>Follow</Text> and you will get new answers.</Text>
        </View>
      ) : null}
      {isPrivate ? (
        <View style={styles.banner}>
          <Icon name="locked" size={16} color={colors.inkMuted} />
          <Text style={styles.bannerText}>
            {me?.isHost && !t.mine
              ? `${askerName} asked privately. Your reply is private unless you ask ${askerName}.`
              : `Nothing here is shown to the group. ${host} can ask to answer publicly if it would help others.`}
          </Text>
        </View>
      ) : null}
      {said ? <View style={{ paddingHorizontal: 20, paddingTop: 6 }}><StatusLine tone="good">{said}</StatusLine></View> : null}
      {error ? <View style={{ paddingHorizontal: 20, paddingTop: 6 }}><StatusLine tone="warn">{error}</StatusLine></View> : null}

      <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={styles.thread} keyboardShouldPersistTaps="handled">
        <Message
          who={t.author} at={t.at} seen={t.seenBy} of={t.audienceCount} body={t.body ? `${t.title}\n\n${t.body}` : t.title}
          role={t.author.isHost ? ctx.host?.role ?? null : null}
          reactions={t.reactions} canReact={Boolean(me)}
          onReact={(e) => react('topic', t.id, e)} onPick={() => setPicker({ targetType: 'topic', targetId: t.id })}
          onLongPress={() => setPicker({ targetType: 'topic', targetId: t.id })}
          mine={t.mine} isHost={t.author.isHost} roleWord={ctx.host?.role ?? 'host'}
        />

        {replies.map((r) => (r.isAnswer ? (
          <View key={r.id} style={styles.answer}>
            <View style={styles.answerBar}>
              <Icon name="check" size={14} color={ON_LIME} strokeWidth={3} />
              <Text style={styles.answerBarText}>{`THE ANSWER · ${firstOf(r.author.name).toUpperCase()}`}</Text>
              <View style={{ flex: 1 }} />
              <Seen n={r.seenBy} of={t.audienceCount} onLime />
            </View>
            <Press onLongPress={me ? () => setPicker({ targetType: 'reply', targetId: r.id }) : undefined} delayLongPress={400} style={styles.answerBody} accessibilityRole="text">
              {r.quotes ? <Quote by={r.quotes.by} body={r.quotes.body} /> : null}
              <Text style={styles.bodyText}>{r.body}</Text>
              <Reactions reactions={r.reactions} canReact={Boolean(me)} onReact={(e) => react('reply', r.id, e)} onPick={() => setPicker({ targetType: 'reply', targetId: r.id })} />
            </Press>
            {ctx.can.answer && me?.isHost ? (
              <Press onPress={() => run(() => door.answer!(t.id, { replyId: null }))} accessibilityRole="button" style={styles.unmark}><Text style={styles.unmarkText}>Not the answer after all</Text></Press>
            ) : null}
          </View>
        ) : (
          <View key={r.id}>
            <Message
              who={r.author} at={r.at} seen={r.seenBy} body={r.body} quote={r.quotes}
              role={r.author.isHost ? ctx.host?.role ?? null : null}
              reactions={r.reactions} canReact={Boolean(me)}
              onReact={(e) => react('reply', r.id, e)} onPick={() => setPicker({ targetType: 'reply', targetId: r.id })}
              onLongPress={() => setPicker({ targetType: 'reply', targetId: r.id })}
              mine={r.mine} isHost={r.author.isHost} roleWord={ctx.host?.role ?? 'host'}
              onQuote={me ? () => { setQuoting(r); } : undefined}
              trailing={picking && me?.isHost ? (
                <Press onPress={() => (ctx.type === 'offer' && !isPrivate ? setWhere(r) : markAnswer(r))} accessibilityRole="button" style={styles.markBtn}>
                  <Icon name="check" size={14} color={ON_LIME} strokeWidth={3} />
                  <Text style={styles.markText}>Mark as the answer</Text>
                </Press>
              ) : r.publishRequest && me?.isHost ? (
                <Text style={styles.requestLine}>
                  {r.publishRequest.decision === null ? `Asked ${askerName} if it can go ${destination === 'faq' ? 'in the FAQ' : 'to the group'} · waiting`
                    : r.publishRequest.decision === 'declined' ? `${askerName} kept it private`
                      : `${askerName} said yes${r.publishRequest.decision === 'named' ? ', with their name' : ', anonymously'} — it is ${destination === 'faq' ? 'in the FAQ' : 'with the group'}`}
                </Text>
              ) : null}
            />
          </View>
        )))}

        {/* D2: the host has asked. The asker decides — three answers, not two. */}
        {pending ? (
          <View style={styles.decide}>
            <View style={styles.decideHead}>
              <Icon name="question" size={14} color={colors.accent} strokeWidth={2.4} />
              <Text style={styles.decideKicker}>{`${(pending.askedBy ?? host).split(/\s+/)[0].toUpperCase()} HAS ASKED YOU SOMETHING`}</Text>
            </View>
            <View style={styles.decideBody}>
              <Text style={styles.bodyText}>
                {suggestedWords(view.askCount)}May {firstOf(pending.askedBy ?? host)} put this {pending.destination === 'faq' ? 'in the FAQ' : 'to the whole group'}?
              </Text>
              <View style={styles.preview}>
                <Text style={styles.previewKicker}>HOW IT WOULD READ</Text>
                <Text style={styles.previewQ}>{pending.preview.question}</Text>
                <Text style={styles.previewA}>{pending.preview.answer}</Text>
                <Text style={styles.previewNote}>{decision === 'named' ? `Asked by ${me?.name ?? 'you'}` : 'Asked by someone on an earlier date'}</Text>
              </View>
              {([
                ['anonymous', 'Yes, but keep me anonymous'],
                ['named', 'Yes, and you can use my name'],
                ['declined', 'No, keep it private'],
              ] as const).map(([k, label]) => (
                <Press key={k} onPress={() => setDecision(k)} accessibilityRole="radio" accessibilityState={{ checked: decision === k }} style={[styles.choice, decision === k && styles.choiceOn]}>
                  <View style={[styles.checkbox, decision === k && styles.checkboxOn]}>{decision === k ? <Icon name="check" size={12} color={ON_LIME} strokeWidth={3} /> : null}</View>
                  <Text style={styles.choiceText}>{label}</Text>
                </Press>
              ))}
              <Press onPress={() => run(() => door.decide!(t.id, pending.id, decision))} disabled={busy} accessibilityRole="button" style={styles.primary}>
                <Text style={styles.primaryText}>{decision === 'declined' ? 'Keep it private' : decision === 'named' ? 'Publish it, with my name' : 'Publish it, anonymously'}</Text>
                <Icon name="forward" size={18} color={colors.primaryFg} strokeWidth={2.4} />
              </Press>
              <Text style={styles.decideNote}>Saying no costs you nothing — {firstOf(pending.askedBy ?? host)} has already answered you. Your reason is never published.</Text>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* The composer. For a host answering a private question, D1: who sees the reply. */}
      {me ? (
        <View style={[styles.composerWrap, { paddingBottom: 10 + (keyboard ? 0 : insetBottom) + keyboard }]}>
          {quoting ? (
            <View style={styles.quoteStrip}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.quoteKicker}>{`REPLYING TO ${firstOf(quoting.author.name).toUpperCase()}`}</Text>
                <Text style={styles.quoteText} numberOfLines={1}>{quoting.body}</Text>
              </View>
              <Press onPress={() => setQuoting(null)} accessibilityRole="button" accessibilityLabel="Stop quoting" style={styles.quoteClose}><Icon name="close" size={16} color={colors.ink} strokeWidth={2.4} /></Press>
            </View>
          ) : null}
          {hostReplyingPrivately ? (
            <View style={styles.privateBox}>
              <Text style={styles.fieldKicker}>YOUR REPLY</Text>
              <TextInput value={text} onChangeText={setText} placeholder={`Reply to ${askerName}`} placeholderTextColor={colors.inkMuted} multiline style={styles.privateField} accessibilityLabel="Your reply" />
              <Text style={styles.fieldKicker}>WHO SEES YOUR REPLY</Text>
              <Press onPress={() => setPrivateSend('just')} accessibilityRole="radio" accessibilityState={{ checked: privateSend === 'just' }} style={[styles.option, privateSend === 'just' && styles.optionOn]}>
                <View style={styles.optionIcon}><Icon name="locked" size={16} color={colors.ink} strokeWidth={2} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionTitle}>Just {askerName}</Text>
                  <Text style={styles.optionHint}>Stays private. Nothing is published.</Text>
                </View>
              </Press>
              <Press onPress={() => setPrivateSend('ask')} accessibilityRole="radio" accessibilityState={{ checked: privateSend === 'ask' }} style={[styles.option, privateSend === 'ask' && styles.optionOn]}>
                <View style={[styles.optionIcon, privateSend === 'ask' && { backgroundColor: colors.lime }]}><Icon name="faq" size={16} color={colors.ink} strokeWidth={2} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionTitle}>Ask {askerName} if it can go {destination === 'faq' ? 'in the FAQ' : 'to the group'}</Text>
                  <Text style={styles.optionHint}>{askerName} decides — and whether their name is on it. You cannot publish it yourself.</Text>
                </View>
                {privateSend === 'ask' ? <Icon name="check" size={16} color={colors.ink} strokeWidth={2.6} /> : null}
              </Press>
              {suggested ? (
                <View style={styles.suggested}>
                  <Text style={styles.suggestedText}><Text style={{ fontWeight: '700' }}>Suggested</Text> — {view.askCount} people have asked this. Asking costs you nothing, and {askerName} can say no or say yes anonymously.</Text>
                </View>
              ) : null}
              <Press onPress={send} disabled={busy || !text.trim()} accessibilityRole="button" style={[styles.primary, (!text.trim() || busy) && { opacity: 0.5 }]}>
                <Text style={styles.primaryText}>{privateSend === 'ask' ? `Send reply, and ask ${askerName}` : 'Send reply'}</Text>
                <Icon name="forward" size={18} color={colors.primaryFg} strokeWidth={2.4} />
              </Press>
            </View>
          ) : (
            <View style={styles.composer}>
              <Press onPress={() => setPicker({ targetType: 'topic', targetId: t.id })} accessibilityRole="button" accessibilityLabel="React" style={styles.smile}>
                <Icon name="emoji" size={20} color={colors.ink} strokeWidth={2} />
              </Press>
              <TextInput
                value={text} onChangeText={setText} placeholder={t.state === 'notice' ? 'Reply' : quoting ? `Reply to ${firstOf(quoting.author.name)}` : 'Reply to this question'}
                placeholderTextColor={colors.inkMuted} multiline style={styles.field} accessibilityLabel="Reply" blurOnSubmit={false}
              />
              <Press onPress={send} disabled={busy || !text.trim()} accessibilityRole="button" accessibilityLabel="Send" style={[styles.send, (!text.trim() || busy) && { opacity: 0.5 }]}>
                <Icon name="forward" size={20} color={ON_LIME} strokeWidth={2.4} />
              </Press>
            </View>
          )}
        </View>
      ) : null}

      {menu ? <TopicMenu groups={view.menu} onPick={onMenu} onClose={() => setMenu(false)} /> : null}
      {picker ? (
        <ReactionPicker
          quick={view.picker.quick} mostUsed={view.picker.mostUsed} yours={view.picker.yours}
          onPick={(e) => { const p = picker; setPicker(null); react(p.targetType, p.targetId, e); }}
          onClose={() => setPicker(null)}
        />
      ) : null}
      {where ? (
        <ChatSheet title="Where this goes" onClose={() => setWhere(null)}>
          <View style={{ padding: 16, gap: 10 }}>
            <Press onPress={() => markAnswer(where, null)} accessibilityRole="button" style={styles.option}>
              <View style={styles.optionIcon}><Icon name="everyone" size={16} color={colors.ink} strokeWidth={2} /></View>
              <View style={{ flex: 1 }}><Text style={styles.optionTitle}>To everyone booked</Text><Text style={styles.optionHint}>Answers it for this date only.</Text></View>
            </Press>
            <Press onPress={() => markAnswer(where, 'faq')} accessibilityRole="button" style={[styles.option, styles.optionOn]}>
              <View style={[styles.optionIcon, { backgroundColor: colors.lime }]}><Icon name="faq" size={16} color={colors.ink} strokeWidth={2} /></View>
              <View style={{ flex: 1 }}><Text style={styles.optionTitle}>Into the FAQ for this offer</Text><Text style={styles.optionHint}>Answers it for everyone, now and on every future date. Shows on the listing before people book.</Text></View>
            </Press>
            <Text style={styles.decideNote}>{askerName} is told either way. Published answers never carry the asker's name.</Text>
          </View>
        </ChatSheet>
      ) : null}
      {reporting ? (
        <ChatSheet title="Report this" onClose={() => setReporting(false)}>
          <View style={{ padding: 16, gap: 10 }}>
            <Text style={styles.bannerText}>Say what is wrong. Somebody at Epic reads every report.</Text>
            <TextInput value={reason} onChangeText={setReason} placeholder="What is wrong with it" placeholderTextColor={colors.inkMuted} multiline style={styles.privateField} accessibilityLabel="What is wrong" />
            <Press onPress={async () => { setReporting(false); await run(async () => { const r = await door.report(t.id, { reason: reason.trim() || null }); setSaid(r.message); setReason(''); }); }} accessibilityRole="button" style={styles.primary}>
              <Text style={styles.primaryText}>Send the report</Text>
            </Press>
          </View>
        </ChatSheet>
      ) : null}
    </View>
  );
}

const lower = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const suggestedWords = (n: number | null) => (n && n >= 3 ? `${n - 1 === 1 ? 'One other person has' : `${n - 1} others have`} asked about this. ` : '');
/** Where the app is served from, for a link somebody can paste. Not the address bar: only the origin. */
const originOf = () => (Platform.OS === 'web' && typeof globalThis !== 'undefined' && (globalThis as any).location ? String((globalThis as any).location.origin) : '');

function Head({ onBack, title, meta, trailing }: { onBack: () => void; title: string; meta: string; trailing?: React.ReactNode }) {
  return (
    <View style={styles.head}>
      <Press onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
        <Icon name="back" size={22} color={colors.ink} strokeWidth={2} />
      </Press>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        {meta ? <Text style={styles.meta} numberOfLines={1}>{meta}</Text> : null}
      </View>
      {trailing}
    </View>
  );
}

function Seen({ n, of, onLime }: { n: number; of?: number; onLime?: boolean }) {
  if (!n) return null;
  const colour = onLime ? ON_LIME : colors.inkMuted;
  return (
    <View style={styles.seen} accessibilityLabel={`Seen by ${n}${of && of > n ? ` of ${of}` : ''}`}>
      <Icon name="preview" size={13} color={colour} strokeWidth={2.2} />
      <Text style={[styles.seenText, { color: colour }]}>{of && of > n ? `${n} of ${of}` : String(n)}</Text>
    </View>
  );
}

function Quote({ by, body }: { by: string; body: string }) {
  return (
    <View style={styles.quote}>
      <Text style={styles.quoteBy}>{firstOf(by).toUpperCase()}</Text>
      <Text style={styles.quoteBody} numberOfLines={2}>{body}</Text>
    </View>
  );
}

function Reactions({ reactions, canReact, onReact, onPick }: { reactions: ChatReaction[]; canReact: boolean; onReact: (emoji: string) => void; onPick: () => void }) {
  if (!reactions.length && !canReact) return null;
  return (
    <View style={styles.reactions}>
      {reactions.map((r) => (
        <Press key={r.emoji} onPress={canReact ? () => onReact(r.emoji) : undefined} accessibilityRole="button" accessibilityState={{ selected: r.mine }} accessibilityLabel={`${r.emoji} ${r.count}`} style={[styles.reaction, r.mine && styles.reactionMine]}>
          <Text style={styles.reactionEmoji}>{r.emoji}</Text>
          <Text style={styles.reactionCount}>{r.count}</Text>
        </Press>
      ))}
      {canReact ? (
        <Press onPress={onPick} accessibilityRole="button" accessibilityLabel="Add a reaction" style={styles.reactionAdd}>
          <Icon name="react" size={15} color={colors.inkMuted} strokeWidth={2} />
        </Press>
      ) : null}
    </View>
  );
}

function Message({ who, at, seen, of, body, quote, role, reactions, canReact, onReact, onPick, onLongPress, mine, isHost, roleWord, onQuote, trailing }: {
  who: ChatTopic['author']; at: string; seen: number; of?: number; body: string; quote?: ChatReply['quotes'];
  role: string | null; reactions: ChatReaction[]; canReact: boolean; onReact: (e: string) => void; onPick: () => void; onLongPress: () => void;
  mine: boolean; isHost: boolean; roleWord: string; onQuote?: () => void; trailing?: React.ReactNode;
}) {
  return (
    <Press onLongPress={canReact ? onLongPress : undefined} delayLongPress={400} style={styles.message} accessibilityRole="text">
      <Avatar name={who.name} index={colourIndex(who.memberId ?? who.guestId)} size={36} url={who.avatarUrl} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={styles.metaRow}>
          <Text style={styles.name} numberOfLines={1}>{mine ? 'You' : firstOf(who.name)}</Text>
          {isHost ? <View style={styles.hostChip}><Text style={styles.hostChipText}>{roleWord.toUpperCase()}</Text></View> : who.guest ? <Text style={styles.metaText}>guest</Text> : null}
          <Text style={styles.metaText}>{ago(at)}</Text>
          <View style={{ flex: 1 }} />
          <Seen n={seen} of={of} />
        </View>
        {quote ? <Quote by={quote.by} body={quote.body} /> : null}
        <Text style={styles.bodyText}>{body}</Text>
        <View style={styles.underRow}>
          <Reactions reactions={reactions} canReact={canReact} onReact={onReact} onPick={onPick} />
          {onQuote ? (
            <Press onPress={onQuote} accessibilityRole="button" accessibilityLabel="Reply to this" style={styles.quoteBtn}>
              <Icon name="reply" size={14} color={colors.inkMuted} strokeWidth={2.2} />
            </Press>
          ) : null}
        </View>
        {trailing}
      </View>
    </Press>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  wide: { maxWidth: 720, alignSelf: 'center', width: '100%' },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingTop: TOP_INSET, paddingHorizontal: 12, paddingBottom: 8 },
  back: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center', marginTop: -6 },
  title: { fontFamily: fonts.heading, fontSize: 18, fontWeight: '800', letterSpacing: -0.36, lineHeight: 22, color: colors.ink },
  meta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkMuted, marginTop: 3 },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: -4 },
  follow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.ink, backgroundColor: colors.surface },
  following: { borderColor: colors.ruleSoft },
  followText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.ink },
  more: { width: 40, height: 36, alignItems: 'center', justifyContent: 'center' },
  moreOn: { backgroundColor: colors.surfaceMuted },

  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.warm, marginHorizontal: 20, marginTop: 6, padding: 12 },
  bannerText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, lineHeight: 18 },

  thread: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, gap: 6 },
  message: { flexDirection: 'row', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  name: { fontFamily: fonts.heading, fontSize: 15, fontWeight: '800', color: colors.ink },
  metaText: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkMuted },
  hostChip: { backgroundColor: colors.ink, paddingHorizontal: 6, paddingVertical: 2 },
  hostChipText: { fontFamily: fonts.body, fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: colors.bg },
  seen: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  seenText: { fontFamily: fonts.body, fontSize: 12 },
  bodyText: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: colors.ink },
  underRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reactions: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4, flexShrink: 1 },
  reaction: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, minHeight: 30, backgroundColor: colors.warm },
  reactionMine: { backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.lime },
  reactionEmoji: { fontSize: 15, lineHeight: 20 },
  reactionCount: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.ink },
  reactionAdd: { minHeight: 30, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.ruleSoft },
  quoteBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', marginTop: 4 },

  quote: { borderLeftWidth: 3, borderLeftColor: colors.accent, backgroundColor: colors.warm, paddingHorizontal: 10, paddingVertical: 6, gap: 2 },
  quoteBy: { fontFamily: fonts.body, fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: colors.accent },
  quoteBody: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, lineHeight: 18 },

  answer: { borderWidth: BORDER, borderColor: colors.line, marginVertical: 8 },
  answerBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.lime, paddingHorizontal: 12, minHeight: 34 },
  answerBarText: { fontFamily: fonts.body, fontSize: 11, fontWeight: '800', letterSpacing: 0.88, color: ON_LIME },
  answerBody: { padding: 14, gap: 8 },
  unmark: { paddingHorizontal: 14, paddingBottom: 10 },
  unmarkText: { fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: colors.inkMuted },
  markBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: colors.lime, paddingHorizontal: 12, minHeight: 36, marginTop: 6 },
  markText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '800', color: ON_LIME },
  requestLine: { fontFamily: fonts.body, fontSize: 12.5, color: colors.accent, fontWeight: '700', marginTop: 4 },

  decide: { borderWidth: BORDER, borderColor: colors.line, marginTop: 12 },
  decideHead: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surfaceMuted, paddingHorizontal: 12, minHeight: 36 },
  decideKicker: { fontFamily: fonts.body, fontSize: 11, fontWeight: '800', letterSpacing: 0.88, color: colors.accent },
  decideBody: { padding: 14, gap: 10 },
  preview: { backgroundColor: colors.warm, padding: 12, gap: 4 },
  previewKicker: { fontFamily: fonts.body, fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: colors.inkMuted },
  previewQ: { fontFamily: fonts.heading, fontSize: 15, fontWeight: '800', color: colors.ink },
  previewA: { fontFamily: fonts.body, fontSize: 14, color: colors.ink, lineHeight: 20 },
  previewNote: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.ruleSoft, paddingHorizontal: 12, minHeight: 46 },
  choiceOn: { borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surfaceMuted },
  checkbox: { width: 20, height: 20, borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: colors.lime, borderColor: colors.ink },
  choiceText: { fontFamily: fonts.heading, fontSize: 14, fontWeight: '800', color: colors.ink },
  decideNote: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkMuted, lineHeight: 18, textAlign: 'center' },

  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.primary, paddingHorizontal: 16, minHeight: 50 },
  primaryText: { fontFamily: fonts.heading, fontSize: 15, fontWeight: '800', color: colors.primaryFg },

  composerWrap: { paddingHorizontal: 20, paddingTop: 8, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.ruleSoft },
  quoteStrip: { flexDirection: 'row', alignItems: 'center', gap: 8, borderLeftWidth: 3, borderLeftColor: colors.accent, backgroundColor: colors.warm, paddingLeft: 10, paddingRight: 4, paddingVertical: 6, marginBottom: 8 },
  quoteKicker: { fontFamily: fonts.body, fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: colors.accent },
  quoteText: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted },
  quoteClose: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  smile: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.ruleSoft },
  field: { flex: 1, minHeight: 48, maxHeight: 120, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface, fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  send: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.lime },

  privateBox: { gap: 8 },
  fieldKicker: { fontFamily: fonts.body, fontSize: 11, fontWeight: '800', letterSpacing: 0.88, color: colors.inkMuted, marginTop: 4 },
  privateField: { minHeight: 80, padding: 12, borderWidth: 1, borderColor: colors.ruleSoft, borderLeftWidth: 3, borderLeftColor: colors.lime, backgroundColor: colors.surface, fontFamily: fonts.body, fontSize: 15, color: colors.ink, textAlignVertical: 'top' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.ruleSoft, padding: 10, backgroundColor: colors.surface },
  optionOn: { borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surfaceMuted },
  optionIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.warm },
  optionTitle: { fontFamily: fonts.heading, fontSize: 14, fontWeight: '800', color: colors.ink },
  optionHint: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkMuted, lineHeight: 17 },
  suggested: { backgroundColor: colors.lime, padding: 10 },
  suggestedText: { fontFamily: fonts.body, fontSize: 12.5, color: ON_LIME, lineHeight: 18 },
});
