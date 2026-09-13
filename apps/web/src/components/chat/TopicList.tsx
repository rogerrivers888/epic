import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../press';
import { ChatAnchor, ChatList, ChatShowing, ChatTopic } from '../../api';
import { colors, fonts, BORDER, ON_LIME, TARGET } from '../../theme';
import { Icon } from '../Icon';
import { StatusLine } from '../ui';
import { useViewport } from '../../hooks/useViewport';
import { TOP_INSET } from '../InspireHeader';
import { ChatDoor } from './door';
import { SHOWING_ROWS, headerLine, repliesLine, rowMeta, seenLine, tagKicker } from './words';

/**
 * The list of questions (D3), with its two dropdowns (D4, D5).
 *
 * Two dropdowns, one axis each. Pills work at four tags and collapse at
 * twenty; a two-week trip with twenty activities is the design case. Showing
 * is a single enum defaulting to *questions* — on arrival the useful view is
 * what is live, not what is yours; `waiting` and `answered` are subsets of it
 * and render indented. About is a search field, then the context-level
 * anchors, then only the anchors that have at least one topic — never the
 * full day list. Both persist per context (the query on this address). The
 * header line says what the combination produced.
 *
 * The rules that decide which topic passes which filter live on the API and
 * arrive as `flags` on each row, so this screen never carries a second copy.
 */

const KEY = (ctx: string) => `epic.chat.${ctx}.filters`;
const remembered = (ctx: string): { showing?: ChatShowing; about?: string | null } => {
  try { return Platform.OS === 'web' && typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem(KEY(ctx)) ?? '{}') : {}; } catch { return {}; }
};
const remember = (ctx: string, v: { showing: ChatShowing; about: string | null }) => {
  try { if (Platform.OS === 'web' && typeof localStorage !== 'undefined') localStorage.setItem(KEY(ctx), JSON.stringify(v)); } catch { /* a full store just forgets */ }
};

export function TopicList({ door, onBack, onOpen, onAsk, onBell, fixedAbout, embedded, insetBottom = 0, onCount }: {
  door: ChatDoor;
  onBack?: () => void;
  onOpen: (topicId: string) => void;
  onAsk: (opts?: { tag?: string | null; private?: boolean }) => void;
  onBell?: () => void;
  /** Pin the About axis to one anchor — a stop's own Ask tab (3d) — and hide the dropdown. */
  fixedAbout?: string | null;
  /** Drawn inside another screen's head (the stop's Ask tab): no head of its own. */
  embedded?: boolean;
  insetBottom?: number;
  /** How many topics the pinned anchor has, for a tab label. */
  onCount?: (n: number) => void;
}) {
  const { width } = useViewport();
  const wide = width >= 900;
  const [data, setData] = useState<ChatList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctxKey = `${door.type}`;
  const initial = remembered(ctxKey);
  const [showing, setShowing] = useState<ChatShowing>(initial.showing ?? 'questions');
  const [about, setAbout] = useState<string | null>(fixedAbout ?? initial.about ?? null);
  const [open, setOpen] = useState<null | 'showing' | 'about'>(null);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try { setData(await door.list()); setError(null); } catch (e: any) { setError(e.message); }
  }, [door]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!fixedAbout) remember(ctxKey, { showing, about }); }, [ctxKey, showing, about, fixedAbout]);
  useEffect(() => { if (data && onCount) onCount(data.topics.filter((t) => !fixedAbout || `${t.tag.kind}:${t.tag.ref ?? ''}` === fixedAbout).length); }, [data, fixedAbout, onCount]);

  const ctx = data?.context;
  const topics = data?.topics ?? [];

  // Everything the person may see, narrowed by About first: the Showing
  // counts (D4) are counted inside the chosen anchor, as the board draws them.
  const inAbout = useMemo(() => topics.filter((t) => !about || `${t.tag.kind}:${t.tag.ref ?? ''}` === about), [topics, about]);
  const counts = useMemo(() => Object.fromEntries(SHOWING_ROWS.map((r) => [r.key, inAbout.filter((t) => t.flags[r.key]).length])) as Record<ChatShowing, number>, [inAbout]);
  const inShowing = useMemo(() => topics.filter((t) => t.flags[showing]), [topics, showing]);
  const list = useMemo(() => {
    const rows = inAbout.filter((t) => t.flags[showing]);
    const rank = (t: ChatTopic) => (t.pinned ? 0 : t.state === 'open' ? 1 : 2);
    return rows.sort((a, b) => rank(a) - rank(b) || b.lastAt.localeCompare(a.lastAt));
  }, [inAbout, showing]);

  // About (D5): the level anchors always, then only anchors with a topic — search covers all of them.
  const anchors = useMemo(() => {
    if (!ctx) return { level: [] as (ChatAnchor & { count: number })[], rest: [] as (ChatAnchor & { count: number })[], all: 0 };
    const count = (a: ChatAnchor) => inShowing.filter((t) => `${t.tag.kind}:${t.tag.ref ?? ''}` === a.key).length;
    const level = ctx.anchors.level.map((a) => ({ ...a, count: count(a) }));
    const rest = [...ctx.anchors.days, ...ctx.anchors.stops].map((a) => ({ ...a, count: count(a) }));
    return { level, rest, all: rest.length };
  }, [ctx, inShowing]);
  const needle = q.trim().toLowerCase();
  const restShown = needle
    ? anchors.rest.filter((a) => a.label.toLowerCase().includes(needle) || (a.sub ?? '').toLowerCase().includes(needle))
    : anchors.rest.filter((a) => a.count > 0);
  const aboutLabel = !about ? 'Anything' : [...anchors.level, ...anchors.rest].find((a) => a.key === about)?.label ?? 'One thing';
  const showingRow = SHOWING_ROWS.find((r) => r.key === showing)!;

  const roleWord = ctx?.host?.role ?? 'organiser';

  const rows = (
    <>
      {!embedded && ctx ? (
        <View style={styles.dropdowns}>
          <Control kicker="SHOWING" label={`${showingRow.label(ctx)} · ${counts[showing]}`} open={open === 'showing'} onPress={() => setOpen(open === 'showing' ? null : 'showing')} />
          {!fixedAbout ? <Control kicker="ABOUT" label={aboutLabel} open={open === 'about'} onPress={() => setOpen(open === 'about' ? null : 'about')} /> : null}
        </View>
      ) : null}
      {embedded && ctx ? (
        <View style={styles.dropdowns}>
          <Control kicker="SHOWING" label={`${showingRow.label(ctx)} · ${counts[showing]}`} open={open === 'showing'} onPress={() => setOpen(open === 'showing' ? null : 'showing')} />
        </View>
      ) : null}

      {ctx ? (
        <View style={styles.headerLine}>
          <Text style={styles.headerText} numberOfLines={1}>{headerLine(showing, list.length, counts.waiting)}</Text>
          {(showing === 'questions' || showing === 'all') && counts.waiting ? <Text style={styles.headerAside}>Waiting first</Text> : null}
        </View>
      ) : null}

      {error ? <View style={{ paddingHorizontal: 20, paddingTop: 8 }}><StatusLine tone="warn">{error}</StatusLine></View> : null}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.list, { paddingBottom: 96 + insetBottom }]} keyboardShouldPersistTaps="handled">
        {data && !list.length ? (
          <Text style={styles.empty}>
            {topics.length ? 'Nothing here with these two set this way.'
              : ctx?.type === 'offer' ? 'Nothing asked yet. Ask the first thing.'
              : ctx?.type === 'meet' ? 'Nothing said yet. Say hello, or ask where and when suits.'
              : 'Nothing asked yet. Ask something and everybody on the trip can answer.'}
          </Text>
        ) : null}
        {list.map((t) => <Row key={t.id} t={t} roleWord={roleWord} onPress={() => onOpen(t.id)} />)}
        {ctx?.type === 'offer' && data?.faqFromEarlier ? (
          <View style={styles.note}>
            <Icon name="faq" size={16} color={colors.ink} />
            <Text style={styles.noteText}><Text style={{ fontWeight: '700' }}>{data.faqFromEarlier === 1 ? 'One answer came' : `${data.faqFromEarlier} answers came`} with this booking</Text> — already in the FAQ from people on earlier dates.</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* The two panels hang under the dropdowns; a tap anywhere else closes them. */}
      {/* The scrim starts where the panel does, so the other control stays live: tapping About while Showing is open switches panels in one tap. */}
      {open ? <Press style={[styles.scrim, { top: embedded ? 64 : 128 }]} onPress={() => setOpen(null)} accessibilityLabel="Close" /> : null}
      {open === 'showing' && ctx ? (
        <View style={[styles.panel, embedded && styles.panelEmbedded]}>
          <View style={styles.panelHead}><Text style={styles.panelKicker}>SHOW ME</Text></View>
          {SHOWING_ROWS.map((r) => {
            const on = r.key === showing;
            return (
              <Press key={r.key} onPress={() => { setShowing(r.key); setOpen(null); }} accessibilityRole="menuitem" accessibilityState={{ selected: on }} style={[styles.panelRow, on && styles.panelRowOn, r.sub && styles.panelRowSub]}>
                <Text style={[styles.panelLabel, on && styles.panelLabelOn]}>{r.label(ctx)}</Text>
                <Text style={styles.panelCount}>{counts[r.key]}</Text>
                {on ? <Icon name="check" size={16} color={colors.ink} strokeWidth={2.6} /> : null}
              </Press>
            );
          })}
        </View>
      ) : null}
      {open === 'about' && ctx ? (
        <View style={styles.panel}>
          <View style={styles.search}>
            <Icon name="search" size={16} color={colors.inkMuted} />
            <TextInput value={q} onChangeText={setQ} placeholder={ctx.type === 'offer' ? 'Find a date or a week' : 'Find a day or an activity'} placeholderTextColor={colors.inkMuted} style={styles.searchField} accessibilityLabel="Find a day or an activity" />
          </View>
          <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
            <PanelRow label="Anything" count={inShowing.length} on={!about} onPress={() => { setAbout(null); setOpen(null); }} />
            {!needle ? (
              <>
                <View style={styles.panelHead}><Text style={styles.panelKicker}>{ctx.type === 'offer' ? 'THIS OFFER' : 'THE TRIP'}</Text><Text style={styles.panelKicker}>{anchors.level.reduce((n, a) => n + a.count, 0)}</Text></View>
                {anchors.level.map((a) => <PanelRow key={a.key} label={a.label} count={a.count} on={about === a.key} onPress={() => { setAbout(a.key); setOpen(null); }} />)}
              </>
            ) : null}
            <View style={styles.panelHead}>
              <Text style={styles.panelKicker}>{needle ? 'FOUND' : ctx.type === 'offer' ? 'DATES AND WEEKS WITH QUESTIONS' : 'DAYS AND ACTIVITIES WITH QUESTIONS'}</Text>
              <Text style={styles.panelKicker}>{needle ? restShown.length : `${restShown.length} of ${anchors.all}`}</Text>
            </View>
            {restShown.map((a) => <PanelRow key={a.key} label={a.label} count={a.count} on={about === a.key} onPress={() => { setAbout(a.key); setOpen(null); setQ(''); }} />)}
            {!restShown.length ? <Text style={styles.panelEmpty}>{needle ? 'Nothing by that name.' : 'Nothing tagged to a day or an activity yet — search finds them all.'}</Text> : null}
          </ScrollView>
        </View>
      ) : null}
    </>
  );

  if (embedded) return <View style={{ flex: 1 }}>{rows}</View>;

  return (
    <View style={[styles.page, wide && styles.wide]}>
      <View style={styles.head}>
        {onBack ? (
          <Press onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
            <Icon name="back" size={22} color={colors.ink} strokeWidth={2} />
          </Press>
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1}>{ctx?.name ?? 'Chat'}{ctx?.subtitle ? `, ${ctx.subtitle}` : ''}</Text>
          <Text style={styles.sub} numberOfLines={1}>{ctx ? `${ctx.sub} · ${topics.filter((t) => t.state !== 'notice').length} ${topics.filter((t) => t.state !== 'notice').length === 1 ? 'question' : 'questions'}` : ''}</Text>
        </View>
        {onBell && door.href.bell ? (
          <Press onPress={onBell} style={styles.bell} accessibilityRole="button" accessibilityLabel="What you get told about">
            <Icon name="bell" size={20} color={colors.ink} strokeWidth={2} />
          </Press>
        ) : null}
      </View>
      {rows}
      {ctx?.can.ask ? (
        <View style={[styles.foot, { paddingBottom: 12 + insetBottom }]}>
          <Press onPress={() => onAsk()} style={styles.ask} accessibilityRole="button">
            <Text style={styles.askText}>{ctx.type === 'offer' ? (ctx.me?.isHost ? 'Say something' : 'Ask the group') : 'Ask something'}</Text>
            <Icon name="add" size={18} color={colors.primaryFg} strokeWidth={2.4} />
          </Press>
          {ctx.type === 'offer' && !ctx.me?.isHost && ctx.can.private ? (
            <Press onPress={() => onAsk({ private: true })} style={styles.lock} accessibilityRole="button" accessibilityLabel={`Ask ${ctx.host?.name ?? 'the host'} privately`}>
              <Icon name="locked" size={18} color={colors.ink} strokeWidth={2} />
            </Press>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Control({ kicker, label, open, onPress }: { kicker: string; label: string; open: boolean; onPress: () => void }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityState={{ expanded: open }} style={[styles.control, open && styles.controlOpen]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.controlKicker}>{kicker}</Text>
        <Text style={styles.controlLabel} numberOfLines={1}>{label}</Text>
      </View>
      <Icon name={open ? 'collapse' : 'expand'} size={16} color={colors.ink} strokeWidth={2.4} />
    </Press>
  );
}

function PanelRow({ label, count, on, onPress }: { label: string; count: number; on: boolean; onPress: () => void }) {
  return (
    <Press onPress={onPress} accessibilityRole="menuitem" accessibilityState={{ selected: on }} style={[styles.panelRow, on && styles.panelRowOn]}>
      <Text style={[styles.panelLabel, on && styles.panelLabelOn]} numberOfLines={1}>{label}</Text>
      <Text style={styles.panelCount}>{count}</Text>
      {on ? <Icon name="check" size={16} color={colors.ink} strokeWidth={2.6} /> : null}
    </Press>
  );
}

/** One topic on the list: kicker + tag, the question, who and when, replies and seen-by. */
function Row({ t, roleWord, onPress }: { t: ChatTopic; roleWord: string; onPress: () => void }) {
  const notice = t.state === 'notice';
  const answered = t.state === 'answered';
  const unread = !t.opened || t.unreadReplies > 0;
  return (
    <Press onPress={onPress} accessibilityRole="button" style={styles.row}>
      <View style={styles.kickers}>
        {notice ? (
          <View style={styles.kickerInk}><Text style={styles.kickerInkText}>{`FROM ${t.author.name.split(/\s+/)[0].toUpperCase()}`}</Text></View>
        ) : answered ? (
          <View style={styles.kickerLime}><Icon name="check" size={11} color={ON_LIME} strokeWidth={3} /><Text style={styles.kickerLimeText}>ANSWERED</Text></View>
        ) : (
          <Text style={styles.kickerOpen}>OPEN</Text>
        )}
        {t.audience === 'host_only' ? (
          <View style={styles.kickerGrey}><Icon name="locked" size={11} color={colors.ink} strokeWidth={2.4} /><Text style={styles.kickerGreyText}>PRIVATE</Text></View>
        ) : null}
        {t.pinned ? <View style={styles.kickerGrey}><Icon name="pinned" size={11} color={colors.ink} strokeWidth={2.4} /><Text style={styles.kickerGreyText}>PINNED</Text></View> : null}
        <View style={styles.kickerTint}><Text style={styles.kickerTintText} numberOfLines={1}>{tagKicker(t.tag)}</Text></View>
      </View>
      <Text style={styles.rowTitle}>{t.title}</Text>
      <Text style={styles.rowMeta}>{`${t.author.name.split(/\s+/)[0]}${t.author.isHost ? ` · ${roleWord}` : t.author.guest ? ' · guest' : ''} · ${rowMetaAgo(t)}`}</Text>
      <View style={styles.rowFoot}>
        <Icon name="reply" size={13} color={colors.accent} strokeWidth={2.4} />
        <Text style={styles.rowReplies}>{repliesLine(t)}</Text>
        <Text style={styles.rowSeen}>{` · ${seenLine(t)}`}</Text>
        {unread ? <View style={styles.unread} accessibilityLabel="Unread" /> : null}
      </View>
    </Press>
  );
}

const rowMetaAgo = (t: ChatTopic) => rowMeta(t, { host: null } as any).split(' · ').pop() ?? '';

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  wide: { maxWidth: 720, alignSelf: 'center', width: '100%' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: TOP_INSET, paddingHorizontal: 12, paddingBottom: 10 },
  back: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.heading, fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  sub: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, marginTop: 2 },
  bell: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center' },

  dropdowns: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingBottom: 10 },
  control: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 50, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface },
  controlOpen: { borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surfaceMuted },
  controlKicker: { fontFamily: fonts.body, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: colors.inkMuted },
  controlLabel: { fontFamily: fonts.heading, fontSize: 15, fontWeight: '800', letterSpacing: -0.2, color: colors.ink, marginTop: 1 },

  headerLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, paddingHorizontal: 20, paddingBottom: 6 },
  headerText: { flexShrink: 1, fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted },
  headerAside: { fontFamily: fonts.body, fontSize: 12, fontWeight: '700', color: colors.accent },

  list: { paddingHorizontal: 20, paddingTop: 4 },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.inkMuted, lineHeight: 20, paddingVertical: 24 },

  row: { paddingVertical: 14, gap: 6, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  kickers: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  kickerOpen: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.88, color: colors.inkMuted },
  kickerInk: { backgroundColor: colors.ink, paddingHorizontal: 7, paddingVertical: 3 },
  kickerInkText: { fontFamily: fonts.body, fontSize: 11, fontWeight: '800', letterSpacing: 0.88, color: colors.bg },
  kickerLime: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.lime, paddingHorizontal: 7, paddingVertical: 3 },
  kickerLimeText: { fontFamily: fonts.body, fontSize: 11, fontWeight: '800', letterSpacing: 0.88, color: ON_LIME },
  kickerGrey: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.warm, paddingHorizontal: 7, paddingVertical: 3 },
  kickerGreyText: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.88, color: colors.ink },
  kickerTint: { backgroundColor: colors.surfaceMuted, paddingHorizontal: 7, paddingVertical: 3, maxWidth: '100%' },
  kickerTintText: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.88, color: colors.ink },
  rowTitle: { fontFamily: fonts.heading, fontSize: 17, fontWeight: '800', letterSpacing: -0.34, lineHeight: 22, color: colors.ink },
  rowMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted },
  rowFoot: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowReplies: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.accent },
  rowSeen: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, flexShrink: 1 },
  unread: { width: 8, height: 8, backgroundColor: colors.lime, marginLeft: 4 },

  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.warm, padding: 14, marginTop: 16 },
  noteText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.ink, lineHeight: 19 },

  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5, backgroundColor: 'transparent' },
  panel: { position: 'absolute', left: 20, right: 20, top: 128, zIndex: 6, backgroundColor: colors.surface, borderWidth: BORDER, borderColor: colors.line },
  panelEmbedded: { top: 64 },
  panelHead: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.warm, paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  panelKicker: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.88, color: colors.inkMuted },
  panelRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, minHeight: 44, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  panelRowSub: { paddingLeft: 30 },
  panelRowOn: { backgroundColor: colors.surfaceMuted },
  panelLabel: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  panelLabelOn: { fontWeight: '700' },
  panelCount: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted },
  panelEmpty: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, padding: 14 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 44, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  searchField: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink, minHeight: 44 },

  foot: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 10, backgroundColor: colors.bg },
  ask: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.primary, paddingHorizontal: 18, minHeight: 54 },
  askText: { fontFamily: fonts.heading, fontSize: 16, fontWeight: '800', letterSpacing: -0.32, color: colors.primaryFg },
  lock: { width: 54, minHeight: 54, alignItems: 'center', justifyContent: 'center', borderWidth: BORDER, borderColor: colors.line },
});
