import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../press';
import { ChatAnchor, ChatAudience, ChatList, ChatTopicView } from '../../api';
import { colors, fonts, BORDER, ON_LIME, TARGET } from '../../theme';
import { Icon, IconName } from '../Icon';
import { StatusLine } from '../ui';
import { useViewport } from '../../hooks/useViewport';
import { useKeyboardInset } from '../../hooks/useKeyboardInset';
import { TOP_INSET } from '../InspireHeader';
import { ChatDoor } from './door';
import { dayKicker, dayLong, hostFirst, todayYmd } from './words';

/**
 * Asking (D6–D8). Kind first, then the thing.
 *
 * Three options everyone can answer instantly — the trip, a day, an activity
 * — each stating its reach in people, because that is what the choice
 * actually controls. Picking a kind reveals one picker of the right type: a
 * searchable activity list grouped as *coming up* then *earlier in the trip*
 * (D7), or a month calendar of the trip's days with dots where questions
 * already are (D8). Nobody scrolls twenty activities to ask about the whole
 * trip. Audience is the last choice, two buttons wide, because it is binary
 * and it should be the thing they are looking at when they post.
 *
 * On a hosted offer the kinds are its aspects and its dates. For the
 * organiser or host a fourth kind, a notice, is the coach-time sort of
 * message. The same screen edits a question (`?edit=`): the asker's tag and
 * audience are theirs to change.
 */

type Kind = 'trip' | 'day' | 'stop' | 'aspect' | 'date' | 'notice';

export function AskScreen({ door, onBack, onPosted, initialTag, initialPrivate, editTopicId, insetBottom = 0 }: {
  door: ChatDoor;
  onBack: () => void;
  onPosted: (topicId: string) => void;
  /** `kind:ref` — set when opened from a stop's own Ask tab. */
  initialTag?: string | null;
  initialPrivate?: boolean;
  editTopicId?: string | null;
  insetBottom?: number;
}) {
  const { width } = useViewport();
  const wide = width >= 900;
  const keyboard = useKeyboardInset();
  const [data, setData] = useState<ChatList | null>(null);
  const [editing, setEditing] = useState<ChatTopicView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<Kind | null>(null);
  const [anchor, setAnchor] = useState<string | null>(initialTag ?? null);
  const [title, setTitle] = useState('');
  const [audience, setAudience] = useState<ChatAudience>(initialPrivate ? 'host_only' : 'everyone');
  const [layer, setLayer] = useState<null | 'stop' | 'day' | 'aspect'>(null);

  const load = useCallback(async () => {
    try {
      const list = await door.list();
      setData(list);
      if (editTopicId && door.edit) {
        const v = await door.topic(editTopicId);
        setEditing(v);
        setTitle(v.topic.body ? `${v.topic.title}\n\n${v.topic.body}` : v.topic.title);
        setAudience(v.topic.audience);
        setAnchor(`${v.topic.tag.kind}:${v.topic.tag.ref ?? ''}`);
      }
      setError(null);
    } catch (e: any) { setError(e.message); }
  }, [door, editTopicId]);
  useEffect(() => { load(); }, [load]);

  const ctx = data?.context ?? null;
  const topics = data?.topics ?? [];
  const isOffer = ctx?.type === 'offer';
  const host = ctx ? hostFirst(ctx) : 'the host';

  // The kind follows the anchor when one arrived with the address or the edit.
  useEffect(() => {
    if (!ctx || kind || !anchor) return;
    const k = anchor.split(':')[0];
    if (k === 'stop') setKind('stop');
    else if (k === 'day') setKind('day');
    else if (k === 'offer_aspect') setKind(anchor.startsWith('offer_aspect:date:') || anchor.startsWith('offer_aspect:week:') ? 'date' : 'aspect');
    else setKind('trip');
  }, [ctx, kind, anchor]);
  useEffect(() => { if (editing?.topic.state === 'notice') setKind('notice'); }, [editing]);

  const all = useMemo(() => (ctx ? [...ctx.anchors.level, ...ctx.anchors.days, ...ctx.anchors.stops] : []), [ctx]);
  const countOn = (key: string) => topics.filter((t) => t.state !== 'notice' && `${t.tag.kind}:${t.tag.ref ?? ''}` === key).length;
  const picked = all.find((a) => a.key === anchor) ?? null;
  const people = ctx ? ctx.people.count : 0;
  const booked = ctx ? Math.max(0, ctx.people.count - ctx.people.members.filter((m) => m.isHost).length) : 0;

  const kinds: { key: Kind; icon: IconName; title: string; hint: string }[] = ctx
    ? isOffer
      ? [
        { key: 'aspect', icon: 'faq', title: 'About the whole thing', hint: `${ctx.me?.booked ? `Everyone booked gets it — ${booked} ${booked === 1 ? 'person' : 'people'}.` : `Goes to ${host}.`} What to bring, getting there, money.` },
        ...(ctx.anchors.stops.length ? [{ key: 'date' as Kind, icon: 'calendar' as IconName, title: ctx.anchors.stops.some((a) => a.ref.startsWith('week:')) ? 'About a date or a week' : 'About a date', hint: 'Only the people booked on it, and the host.' }] : []),
        ...(ctx.can.notice ? [{ key: 'notice' as Kind, icon: 'broadcast' as IconName, title: 'A notice from you', hint: 'The parking sort of message. Everyone booked gets it.' }] : []),
      ]
      : [
        { key: 'trip', icon: 'map', title: 'About the trip', hint: `Everyone gets it — packing, money, the group.` },
        { key: 'day', icon: 'calendar', title: 'About a day', hint: 'Only the people on that day.' },
        { key: 'stop', icon: 'ticket', title: 'About an activity', hint: 'Only the people booked on it, and its host.' },
        ...(ctx.can.notice ? [{ key: 'notice' as Kind, icon: 'broadcast' as IconName, title: 'A notice from you', hint: 'The coach-time sort of message. Everyone on the trip gets it.' }] : []),
      ]
    : [];

  const chooseKind = (k: Kind) => {
    setKind(k);
    if (k === 'trip' || k === 'notice') { if (!anchor || !anchor.startsWith('trip:')) setAnchor(isOffer ? 'offer_aspect:offer' : 'trip:trip'); }
    if (k === 'aspect') { if (!anchor || !anchor.startsWith('offer_aspect:') || anchor.includes(':date:') || anchor.includes(':week:')) setAnchor('offer_aspect:offer'); }
    if (k === 'stop') { if (!anchor?.startsWith('stop:')) { setAnchor(null); setLayer('stop'); } }
    if (k === 'day') { if (!anchor?.startsWith('day:')) { setAnchor(null); setLayer('day'); } }
    if (k === 'date') { if (!anchor || !(anchor.includes(':date:') || anchor.includes(':week:'))) { setAnchor(null); setLayer('aspect'); } }
    if (k === 'notice') setAudience('everyone');
  };

  const reach = (): string => {
    if (!ctx) return '';
    if (audience === 'host_only') return isOffer ? `Just ${host}. Nobody else sees it.` : `A private message to ${host}. Nobody else sees it.`;
    if (isOffer) return `${booked} ${booked === 1 ? 'person is' : 'people are'} booked on this. Nobody else is pinged.`;
    if (kind === 'trip' || kind === 'notice') return `Everyone gets it — ${people} ${people === 1 ? 'person' : 'people'}.`;
    // On a group trip the roster says who is on the day or the activity; on a plain trip it is everyone.
    const on = picked?.people ?? people;
    if (kind === 'day') return `${on} ${on === 1 ? 'person is' : 'people are'} on this day. Nobody else is pinged.`;
    return `${on} ${on === 1 ? 'person is' : 'people are'} on this one${ctx.roster ? '' : ' — everyone on the trip'}. Nobody else is pinged.`;
  };

  const canPost = Boolean(ctx && title.trim() && anchor && (kind !== 'notice' || ctx.can.notice));

  const post = async () => {
    if (!canPost || !anchor || busy) return;
    setBusy(true); setError(null);
    try {
      const [k, ...rest] = anchor.split(':');
      const [first, ...more] = title.trim().split(/\n\s*\n/);
      const body = { title: first.trim(), body: more.join('\n\n').trim() || null, tag: { kind: k as any, ref: rest.join(':') }, audience, notice: kind === 'notice' };
      const v = editTopicId && door.edit ? await door.edit(editTopicId, body) : await door.ask(body);
      onPosted(v.topic.id);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  if (layer === 'stop' && ctx) {
    return <ActivityPicker ctx={ctx} anchors={isOffer ? [] : ctx.anchors.stops} countOn={countOn} picked={anchor} onPick={(key) => { setAnchor(key); setLayer(null); }} onBack={() => setLayer(null)} />;
  }
  if (layer === 'day' && ctx) {
    return <DayPicker ctx={ctx} countOn={countOn} picked={anchor} onPick={(key) => { setAnchor(key); setLayer(null); }} onPickStop={(key) => { setKind('stop'); setAnchor(key); setLayer(null); }} onBack={() => setLayer(null)} />;
  }
  if (layer === 'aspect' && ctx) {
    return <ActivityPicker ctx={ctx} anchors={ctx.anchors.stops} countOn={countOn} picked={anchor} onPick={(key) => { setAnchor(key); setLayer(null); }} onBack={() => setLayer(null)} dates />;
  }

  return (
    <View style={[styles.page, wide && styles.wide]}>
      <View style={styles.head}>
        <Press onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel="Back"><Icon name="back" size={22} color={colors.ink} strokeWidth={2} /></Press>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>{editTopicId ? 'Edit the question' : kind === 'notice' ? 'Say something' : 'Ask something'}</Text>
          <Text style={styles.sub} numberOfLines={1}>{ctx ? `${ctx.name}${ctx.subtitle ? `, ${ctx.subtitle}` : ''}` : ''}</Text>
        </View>
      </View>
      {error ? <View style={{ paddingHorizontal: 20 }}><StatusLine tone="warn">{error}</StatusLine></View> : null}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.body, { paddingBottom: 120 + insetBottom + keyboard }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.kicker}>WHAT KIND OF {kind === 'notice' ? 'THING' : 'QUESTION'}?</Text>
        {kinds.map((k) => {
          const on = kind === k.key;
          return (
            <Press key={k.key} onPress={() => chooseKind(k.key)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={[styles.card, on && styles.cardOn]}>
              <View style={[styles.cardIcon, on && { backgroundColor: colors.lime }]}><Icon name={k.icon} size={18} color={colors.ink} strokeWidth={2} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.cardTitle}>{k.title}</Text>
                <Text style={styles.cardHint}>{k.hint}</Text>
              </View>
              {on ? <Icon name="check" size={18} color={colors.ink} strokeWidth={2.6} /> : null}
            </Press>
          );
        })}

        {/* Then the thing: one picker of the right type. */}
        {ctx && (kind === 'trip' || kind === 'notice' || kind === 'aspect') ? (
          <>
            <Text style={styles.kicker}>{kind === 'aspect' || isOffer ? 'WHICH PART?' : 'WHICH PART OF THE TRIP?'}</Text>
            <View style={styles.chips}>
              {ctx.anchors.level.map((a) => {
                const on = anchor === a.key;
                return (
                  <Press key={a.key} onPress={() => setAnchor(a.key)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={[styles.chip, on && styles.chipOn]}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{a.label}</Text>
                    {countOn(a.key) ? <Text style={[styles.chipCount, on && styles.chipTextOn]}>{countOn(a.key)}</Text> : null}
                  </Press>
                );
              })}
            </View>
          </>
        ) : null}
        {ctx && (kind === 'stop' || kind === 'day' || kind === 'date') ? (
          <>
            <Text style={styles.kicker}>{kind === 'stop' ? 'WHICH ACTIVITY?' : kind === 'day' ? 'WHICH DAY?' : 'WHICH DATE?'}</Text>
            <Press onPress={() => setLayer(kind === 'stop' ? 'stop' : kind === 'day' ? 'day' : 'aspect')} accessibilityRole="button" style={[styles.dropdown, picked && styles.dropdownOn]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                {picked?.date ? <Text style={styles.dropKicker}>{dayKicker(picked.date)}</Text> : null}
                <Text style={styles.dropLabel} numberOfLines={1}>{picked ? (kind === 'day' && picked.date ? dayLong(picked.date) : picked.label) : kind === 'stop' ? 'Pick an activity' : kind === 'day' ? 'Pick a day' : 'Pick a date'}</Text>
              </View>
              <Icon name="expand" size={18} color={colors.ink} strokeWidth={2.4} />
            </Press>
          </>
        ) : null}
        {kind && anchor ? <Text style={styles.reach}>{reach()}</Text> : null}

        {kind ? (
          <>
            <Text style={styles.kicker}>{kind === 'notice' ? 'WHAT TO SAY' : 'YOUR QUESTION'}</Text>
            <TextInput
              value={title} onChangeText={setTitle}
              placeholder={kind === 'notice' ? 'The coach leaves at 8:40, not 9.' : isOffer ? `Ask ${ctx?.me?.booked ? 'the group' : host}…` : 'Anything for someone who does not eat dairy?'}
              placeholderTextColor={colors.inkMuted} multiline style={styles.field} accessibilityLabel="Your question"
            />
            <Text style={styles.fieldHint}>A blank line after the question keeps any detail underneath it.</Text>
          </>
        ) : null}

        {ctx && kind && kind !== 'notice' ? (
          <View style={styles.audience}>
            {ctx.me?.booked !== false ? (
              <Press onPress={() => setAudience('everyone')} accessibilityRole="radio" accessibilityState={{ checked: audience === 'everyone' }} style={[styles.audBtn, audience === 'everyone' && styles.audBtnOn]}>
                <Icon name="everyone" size={16} color={colors.ink} strokeWidth={2} />
                <Text style={styles.audText}>Everyone on it</Text>
              </Press>
            ) : null}
            {ctx.can.private ? (
              <Press onPress={() => setAudience('host_only')} accessibilityRole="radio" accessibilityState={{ checked: audience === 'host_only' }} style={[styles.audBtn, audience === 'host_only' && styles.audBtnOn]}>
                <Icon name="locked" size={16} color={colors.ink} strokeWidth={2} />
                <Text style={styles.audText}>Just {host}</Text>
              </Press>
            ) : null}
          </View>
        ) : null}
        {ctx && kind && kind !== 'notice' && !ctx.can.private ? <Text style={styles.fieldHint}>A private question needs an Epic account — everything you ask here is for everyone on the trip.</Text> : null}
      </ScrollView>

      <View style={[styles.foot, { paddingBottom: 12 + (keyboard ? 0 : insetBottom) }]}>
        <Press onPress={post} disabled={!canPost || busy} accessibilityRole="button" style={[styles.primary, (!canPost || busy) && { opacity: 0.5 }]}>
          <Text style={styles.primaryText}>{editTopicId ? 'Save the question' : kind === 'notice' ? 'Post the notice' : 'Post the question'}</Text>
          <Icon name="forward" size={18} color={colors.primaryFg} strokeWidth={2.4} />
        </Press>
      </View>
    </View>
  );
}

/** D7: twenty activities, searchable, grouped as coming up then earlier in the trip, with question counts. */
function ActivityPicker({ ctx, anchors, countOn, picked, onPick, onBack, dates }: {
  ctx: ChatList['context']; anchors: ChatAnchor[]; countOn: (key: string) => number; picked: string | null; onPick: (key: string) => void; onBack: () => void; dates?: boolean;
}) {
  const { width } = useViewport();
  const wide = width >= 900;
  const [q, setQ] = useState('');
  const today = todayYmd();
  const needle = q.trim().toLowerCase();
  const rows = anchors.filter((a) => !needle || a.label.toLowerCase().includes(needle) || (a.sub ?? '').toLowerCase().includes(needle) || (a.date ? dayKicker(a.date).toLowerCase().includes(needle) : false));
  // Days with nothing on them still appear in their place, greyed, so "Sun 12 — nothing booked" is not a gap in the calendar.
  const freeDays = dates ? [] : ctx.anchors.days.filter((d) => !anchors.some((a) => a.dayId === d.ref) && (!needle || d.label.toLowerCase().includes(needle)));
  type Item = { key: string; date: string | null; label: string; count: number; free?: boolean };
  const items: Item[] = [
    ...rows.map((a) => ({ key: a.key, date: a.date ?? null, label: a.label, count: countOn(a.key) })),
    ...freeDays.map((d) => ({ key: d.key, date: d.date ?? null, label: 'Free day — nothing booked', count: 0, free: true })),
  ].sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')));
  const coming = items.filter((i) => !i.date || i.date >= today);
  const earlier = items.filter((i) => i.date && i.date < today);
  const Group = ({ title, list }: { title: string; list: Item[] }) => (list.length ? (
    <>
      <View style={styles.groupHead}><Text style={styles.groupKicker}>{title}</Text></View>
      {list.map((i) => {
        const on = picked === i.key;
        return (
          <Press key={i.key} onPress={i.free ? undefined : () => onPick(i.key)} disabled={i.free} accessibilityRole="button" accessibilityState={{ selected: on, disabled: i.free }} style={[styles.pickRow, on && styles.pickRowOn]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              {i.date ? <Text style={styles.dropKicker}>{dayKicker(i.date)}</Text> : null}
              <Text style={[styles.pickLabel, on && { fontWeight: '800' }, i.free && { color: colors.inkMuted }]} numberOfLines={1}>{i.label}</Text>
            </View>
            {i.count ? <Text style={styles.pickCount}>{on ? `${i.count} ${i.count === 1 ? 'question' : 'questions'}` : String(i.count)}</Text> : null}
            {on ? <Icon name="check" size={16} color={colors.ink} strokeWidth={2.6} /> : null}
          </Press>
        );
      })}
    </>
  ) : null);
  return (
    <View style={[styles.page, wide && styles.wide]}>
      <View style={styles.head}>
        <Press onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel="Back"><Icon name="back" size={22} color={colors.ink} strokeWidth={2} /></Press>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>{dates ? 'Which date?' : 'Which activity?'}</Text>
          <Text style={styles.sub} numberOfLines={1}>{ctx.name}{ctx.subtitle ? `, ${ctx.subtitle}` : ''} · {anchors.length} {dates ? 'dates' : 'activities'}</Text>
        </View>
      </View>
      <View style={styles.search}>
        <Icon name="search" size={16} color={colors.inkMuted} />
        <TextInput value={q} onChangeText={setQ} placeholder={dates ? 'Type a date, or a week' : 'Type a name, or a day'} placeholderTextColor={colors.inkMuted} style={styles.searchField} accessibilityLabel="Find one" autoFocus={false} />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.pickList} keyboardShouldPersistTaps="handled">
        <View style={styles.pickBox}>
          <Group title="COMING UP" list={coming} />
          <Group title={dates ? 'EARLIER' : 'EARLIER IN THE TRIP'} list={earlier} />
          {!items.length ? <Text style={styles.empty}>{needle ? 'Nothing by that name.' : dates ? 'No dates on this yet.' : 'Nothing booked on this trip yet — ask about the whole trip, or a day.'}</Text> : null}
        </View>
      </ScrollView>
    </View>
  );
}

/** D8: a month calendar of the trip's days — tinted, everything outside greyed and untappable, dots where questions are. */
function DayPicker({ ctx, countOn, picked, onPick, onPickStop, onBack }: {
  ctx: ChatList['context']; countOn: (key: string) => number; picked: string | null; onPick: (key: string) => void; onPickStop: (key: string) => void; onBack: () => void;
}) {
  const { width } = useViewport();
  const wide = width >= 900;
  const days = ctx.anchors.days;
  const byDate = new Map(days.map((d) => [d.date!, d]));
  const first = days[0]?.date ?? todayYmd();
  const last = days[days.length - 1]?.date ?? first;
  const [chosen, setChosen] = useState<string | null>(() => days.find((d) => d.key === picked)?.date ?? null);
  const startOf = (ymd: string) => { const d = new Date(`${ymd}T12:00:00`); return { year: d.getFullYear(), month: d.getMonth() }; };
  const [{ year, month }, setMonth] = useState(startOf(chosen ?? first));
  const floor = startOf(first); const ceil = startOf(last);
  const atFloor = year < floor.year || (year === floor.year && month <= floor.month);
  const atCeil = year > ceil.year || (year === ceil.year && month >= ceil.month);
  const cells = useMemo(() => {
    const lead = (new Date(year, month, 1).getDay() + 6) % 7;
    const n = new Date(year, month + 1, 0).getDate();
    const out: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= n; d += 1) out.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    while (out.length % 7) out.push(null);
    return out;
  }, [year, month]);
  const title = new Date(year, month, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const day = chosen ? byDate.get(chosen) ?? null : null;
  const onDay = chosen ? ctx.anchors.stops.filter((s) => s.date === chosen) : [];
  const people = day?.people ?? ctx.people.count;
  return (
    <View style={[styles.page, wide && styles.wide]}>
      <View style={styles.head}>
        <Press onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel="Back"><Icon name="back" size={22} color={colors.ink} strokeWidth={2} /></Press>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>Which day?</Text>
          <Text style={styles.sub} numberOfLines={1}>{ctx.name}{ctx.subtitle ? `, ${ctx.subtitle}` : ''} · {days.length} {days.length === 1 ? 'day' : 'days'}</Text>
        </View>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.monthRow}>
          <Text style={styles.monthTitle}>{title}</Text>
          <View style={{ flexDirection: 'row' }}>
            <Press onPress={() => { if (!atFloor) { const d = new Date(year, month - 1, 1); setMonth({ year: d.getFullYear(), month: d.getMonth() }); } }} disabled={atFloor} accessibilityRole="button" accessibilityLabel="Earlier month" style={styles.arrow}><Icon name="previous" size={18} color={atFloor ? colors.decor : colors.ink} /></Press>
            <Press onPress={() => { if (!atCeil) { const d = new Date(year, month + 1, 1); setMonth({ year: d.getFullYear(), month: d.getMonth() }); } }} disabled={atCeil} accessibilityRole="button" accessibilityLabel="Later month" style={styles.arrow}><Icon name="more" size={18} color={atCeil ? colors.decor : colors.ink} /></Press>
          </View>
        </View>
        <View style={styles.weekRow}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((l, i) => <Text key={i} style={styles.weekLetter}>{l}</Text>)}</View>
        <View style={styles.grid}>
          {cells.map((c, i) => {
            const d = c ? byDate.get(c) : null;
            const on = Boolean(c && chosen === c);
            const n = d ? Math.min(3, countOn(d.key)) : 0;
            return (
              <View key={i} style={styles.cellWrap}>
                {c ? (
                  <Press onPress={d ? () => setChosen(c) : undefined} disabled={!d} accessibilityRole="button" accessibilityState={{ selected: on, disabled: !d }} accessibilityLabel={c} style={[styles.cell, d && styles.cellOn, on && styles.cellPicked]}>
                    <Text style={[styles.cellText, !d && { color: colors.decor }, on && { fontWeight: '800' }]}>{Number(c.slice(8))}</Text>
                    <View style={styles.dots}>{Array.from({ length: n }).map((_, k) => <View key={k} style={styles.dot} />)}</View>
                  </Press>
                ) : null}
              </View>
            );
          })}
        </View>
        <View style={styles.legend}>
          <View style={[styles.legendSwatch, { backgroundColor: colors.surfaceMuted }]} /><Text style={styles.legendText}>On the trip</Text>
          <View style={styles.dots}><View style={styles.dot} /><View style={styles.dot} /></View><Text style={styles.legendText}>Has questions</Text>
        </View>
        {chosen && day ? (
          <View style={{ gap: 8, marginTop: 8 }}>
            <Text style={styles.kicker}>{dayLong(chosen).toUpperCase()}</Text>
            {onDay.length ? onDay.map((s) => (
              <Press key={s.key} onPress={() => onPickStop(s.key)} accessibilityRole="button" style={styles.dayStop}>
                <Text style={styles.dayStopName} numberOfLines={1}>{s.label}</Text>
                <Text style={styles.pickCount}>{[countOn(s.key) ? `${countOn(s.key)} ${countOn(s.key) === 1 ? 'question' : 'questions'}` : null, ctx.roster && s.people != null ? `${s.people} on it` : null].filter(Boolean).join(' · ') || '—'}</Text>
              </Press>
            )) : <Text style={styles.empty}>Nothing booked on this day yet.</Text>}
            <View style={styles.note}>
              <Text style={styles.noteText}>Asking about <Text style={{ fontWeight: '700' }}>the whole day</Text> reaches all {people} {people === 1 ? 'person' : 'people'} on it.{onDay.length ? ' To reach only the people booked on one thing, pick the activity instead.' : ''}</Text>
            </View>
          </View>
        ) : null}
      </ScrollView>
      <View style={styles.foot}>
        <Press onPress={() => day && onPick(day.key)} disabled={!day} accessibilityRole="button" style={[styles.primary, !day && { opacity: 0.5 }]}>
          <Text style={styles.primaryText}>{chosen ? `Ask about ${dayLong(chosen)}` : 'Pick a day'}</Text>
          <Icon name="forward" size={18} color={colors.primaryFg} strokeWidth={2.4} />
        </Press>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  wide: { maxWidth: 720, alignSelf: 'center', width: '100%' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: TOP_INSET, paddingHorizontal: 12, paddingBottom: 8 },
  back: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.heading, fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  sub: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, marginTop: 2 },
  body: { paddingHorizontal: 20, paddingTop: 8, gap: 10 },
  kicker: { fontFamily: fonts.body, fontSize: 11, fontWeight: '800', letterSpacing: 0.88, color: colors.inkMuted, marginTop: 6 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.ruleSoft, padding: 12, backgroundColor: colors.surface },
  cardOn: { borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surfaceMuted },
  cardIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.warm },
  cardTitle: { fontFamily: fonts.heading, fontSize: 15, fontWeight: '800', color: colors.ink },
  cardHint: { fontFamily: fonts.body, fontSize: 12.5, color: colors.inkMuted, lineHeight: 17 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: 38, borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.selected, borderColor: colors.ink },
  chipText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: colors.ink },
  chipTextOn: { color: ON_LIME, fontWeight: '800' },
  chipCount: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },
  dropdown: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.ruleSoft, paddingHorizontal: 14, minHeight: 54, backgroundColor: colors.surface },
  dropdownOn: { borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surfaceMuted },
  dropKicker: { fontFamily: fonts.body, fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: colors.inkMuted },
  dropLabel: { fontFamily: fonts.heading, fontSize: 16, fontWeight: '800', letterSpacing: -0.2, color: colors.ink },
  reach: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted },
  field: { minHeight: 64, maxHeight: 200, padding: 14, borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface, fontFamily: fonts.body, fontSize: 16, color: colors.ink, textAlignVertical: 'top' },
  fieldHint: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },
  audience: { flexDirection: 'row', gap: 10, marginTop: 4 },
  audBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface },
  audBtnOn: { backgroundColor: colors.selected, borderWidth: BORDER, borderColor: colors.ink },
  audText: { fontFamily: fonts.heading, fontSize: 14, fontWeight: '800', color: colors.ink },
  foot: { paddingHorizontal: 20, paddingTop: 10, backgroundColor: colors.bg },
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.primary, paddingHorizontal: 18, minHeight: 54 },
  primaryText: { fontFamily: fonts.heading, fontSize: 16, fontWeight: '800', letterSpacing: -0.32, color: colors.primaryFg },

  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, paddingHorizontal: 12, minHeight: 46, borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface },
  searchField: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink, minHeight: 44 },
  pickList: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40 },
  pickBox: { borderWidth: 1, borderColor: colors.ruleSoft },
  groupHead: { backgroundColor: colors.warm, paddingHorizontal: 14, paddingVertical: 8 },
  groupKicker: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.88, color: colors.inkMuted },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, minHeight: 48, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  pickRowOn: { backgroundColor: colors.surfaceMuted },
  pickLabel: { fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  pickCount: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted },
  empty: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, padding: 14 },

  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthTitle: { fontFamily: fonts.heading, fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  arrow: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  weekRow: { flexDirection: 'row' },
  weekLetter: { flex: 1, textAlign: 'center', fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: colors.inkMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cellWrap: { width: '14.2857%', padding: 2 },
  cell: { height: 46, alignItems: 'center', justifyContent: 'center', gap: 2 },
  cellOn: { backgroundColor: colors.surfaceMuted },
  cellPicked: { backgroundColor: colors.selected, borderWidth: BORDER, borderColor: colors.ink },
  cellText: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: colors.ink },
  dots: { flexDirection: 'row', gap: 2, height: 4 },
  dot: { width: 4, height: 4, backgroundColor: colors.accent },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  legendSwatch: { width: 14, height: 14 },
  legendText: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted, marginRight: 8 },
  dayStop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 36 },
  dayStopName: { flex: 1, fontFamily: fonts.heading, fontSize: 15, fontWeight: '800', color: colors.ink },
  note: { backgroundColor: colors.surfaceMuted, padding: 12 },
  noteText: { fontFamily: fonts.body, fontSize: 13, color: colors.ink, lineHeight: 19 },
});
