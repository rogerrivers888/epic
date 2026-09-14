/**
 * The expertise field — one component, both ends of the app.
 *
 * Handoff: "Epic Host Skills" (18 artboards, 13 September 2026), S1–S5 host
 * side and S16 guest side. The design's own rule for it: *the model gets more
 * precise while the host is asked less.*
 *
 * A guest asking "What do you love doing?" and a host saying "What are you an
 * expert in?" are the same question over the same vocabulary, so they are the
 * same component, with the same breadcrumbs and the same counts (S16). There
 * are exactly two differences, and both are props:
 *
 *   · the **guest** side never offers "add it as it is" — guests do not grow
 *     the vocabulary (`canAdd`);
 *   · the **host** side never shows a zero count — a count is drawn only when
 *     it flatters, and the API returns null below that floor.
 *
 * Four things this deliberately is not:
 *
 *   **Not a tree browser.** No expand-collapse picker, no category → sub →
 *   sub-sub. Three-level pickers test badly on a phone and cap the host at
 *   whatever depth we happened to build. Type-ahead over an open vocabulary is
 *   the whole design.
 *
 *   **Not navigation.** The breadcrumb gives a tag context in one glance. It is
 *   not tappable and there is nothing to walk.
 *
 *   **Not hashtags.** Every chip is a resolved entity, pending ones included.
 *   Free text with no canonicalisation produces four spellings of one thing
 *   inside a week.
 *
 *   **Never an error.** A word nothing matched is a good day — it is how the
 *   vocabulary grows — so it gets a lime block and a pending chip, never red,
 *   never a dead end, and never a nudge to pick something broader.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, PanResponder, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from './press';
import { api, OfferSkill, SkillSuggestion } from '../api';
import { colors, INK, LIME, fonts } from '../theme';
import { Icon } from './Icon';
import { useViewport } from '../hooks/useViewport';

export type PickedTag = {
  key: string | null; raw: string; label: string; pending: boolean;
  /** They tapped "Add … as it is" with the suggestions on screen. Their choice, not a near miss. */
  asIs?: boolean;
};

/** What an offer already carries, in the shape this component works in. */
export const fromOfferSkills = (rows: OfferSkill[] | undefined): PickedTag[] =>
  (rows ?? []).map((r) => ({ key: r.key, raw: r.raw, label: r.label, pending: r.pending }));

export function TagPicker({
  value, onChange, cap = 6, vocab = 'tag', placeholder, guest = false, category = null,
  starters = [], label = 'Your tags', cardLine = true, autoFocus = false,
}: {
  value: PickedTag[];
  onChange: (next: PickedTag[]) => void;
  cap?: number;
  vocab?: 'tag' | 'facet';
  placeholder: string;
  /** The guest side: same rows, same breadcrumbs, no "add it as it is". */
  guest?: boolean;
  /** Put this category's words first, once the first tag has decided one. */
  category?: string | null;
  /** "Others near you have said" — shown while the field is empty. */
  starters?: SkillSuggestion[];
  label?: string;
  /** The lime-tint line naming the card tag. Off on the guest side, where there is no card. */
  cardLine?: boolean;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<SkillSuggestion[]>([]);
  const [open, setOpen] = useState(autoFocus);
  const [detail, setDetail] = useState<string | null>(null);
  /** The word nothing matched, held until they tap Add it (S4). */
  const [unmatched, setUnmatched] = useState<string | null>(null);
  const full = value.length >= cap;
  const held = useMemo(() => new Set(value.map((v) => (v.key ?? v.raw.toLowerCase()))), [value]);

  // Suggestions from the second character, from Epic's own tables. No external
  // call sits in this path: a host who hits a spinner mid-sentence abandons the
  // offer, and this is the riskiest screen in the module.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRows([]); setUnmatched(null); return; }
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const r = await api.skillSuggest(term, { vocab, guest, category });
        if (!live) return;
        setRows(r.suggestions.filter((s) => !held.has(s.key)));
        setUnmatched(r.suggestions.length === 0 ? term : null);
      } catch {
        // Both, not just the rows: leaving the last query's unmatched word
        // behind would offer them one word while the field showed another, and
        // tapping Add would have saved the wrong one (Codex, 14 Sep 2026).
        if (live) { setRows([]); setUnmatched(null); }
      }
    }, 110);
    return () => { live = false; clearTimeout(timer); };
  }, [q, vocab, guest, category, held]);

  const add = useCallback((tag: PickedTag) => {
    if (value.length >= cap) return;
    if (value.some((v) => (tag.key ? v.key === tag.key : v.raw.toLowerCase() === tag.raw.toLowerCase()))) return;
    onChange([...value, tag]);
    setQ(''); setRows([]); setUnmatched(null);
  }, [value, cap, onChange]);

  const remove = (i: number) => onChange(value.filter((_, n) => n !== i));
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= value.length) return;
    const next = value.slice();
    next.splice(to, 0, next.splice(from, 1)[0]);
    onChange(next);
  };

  return (
    <View style={{ gap: 14 }}>
      {/* The field. 1px until it is being typed in, then a 2px ink rule. */}
      <View style={[s.field, open && s.fieldOn]}>
        <Icon name="search" size={17} color={colors.inkMuted} strokeWidth={2} />
        <TextInput
          value={q}
          onChangeText={setQ}
          onFocus={() => setOpen(true)}
          placeholder={full ? `That is ${cap} — remove one to add another` : value.length ? 'Add another' : placeholder}
          placeholderTextColor={colors.ghost}
          editable={!full}
          autoFocus={autoFocus}
          selectionColor={colors.accent}
          style={[s.input, full && { color: colors.inkMuted }]}
          returnKeyType="done"
          onSubmitEditing={() => { if (rows[0]) add(asPicked(rows[0])); else if (unmatched && !guest) add({ key: null, raw: unmatched, label: unmatched, pending: true, asIs: true }); }}
        />
        {q ? <Press onPress={() => setQ('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear"><Icon name="close" size={15} color={colors.inkMuted} strokeWidth={2} /></Press> : null}
      </View>

      {/* Nothing matched (S4) — a lime block, because this is the moment the
          vocabulary grows. Never red, never a dead end. */}
      {unmatched && !guest && !full ? (
        <View style={s.limeBlock}>
          <Text style={s.limeHead}>Nobody has listed “{unmatched}” yet. You would be the first.</Text>
          <Text style={s.limeSub}>We will check it over and it will be live within a day. Your offer goes up now either way.</Text>
          <Press onPress={() => add({ key: null, raw: unmatched, label: unmatched, pending: true, asIs: true })} accessibilityRole="button" style={s.addIt}>
            <Text style={s.addItText}>Add it</Text>
          </Press>
        </View>
      ) : null}

      {/* The suggestions. Label, then the parent as context in one glance, then
          a count only where it flatters. */}
      {rows.length ? (
        <View>
          {rows.map((r) => (
            <Press key={r.key} onPress={() => add(asPicked(r))} accessibilityRole="button" style={s.row}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.rowLabel} numberOfLines={1}>{r.label}</Text>
                {r.breadcrumb ? <Text style={s.crumb} numberOfLines={1}>{r.breadcrumb}</Text> : null}
              </View>
              {r.hostCount != null ? <Text style={s.count}>{r.hostCount} hosts</Text> : null}
              <Press onPress={() => setDetail(r.key)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`What ${r.label} means`}>
                <Icon name="info" size={15} color={colors.inkMuted} strokeWidth={2} />
              </Press>
              <Icon name="add" size={16} color={colors.accent} strokeWidth={2.4} />
            </Press>
          ))}
          {!guest && q.trim().length >= 2 && !unmatched ? (
            <Press onPress={() => add({ key: null, raw: q.trim(), label: q.trim(), pending: true, asIs: true })} accessibilityRole="button" style={s.asIs}>
              <Text style={s.asIsText}>Add “{q.trim()}” as it is</Text>
            </Press>
          ) : null}
        </View>
      ) : null}

      {/* While the field is empty: what other people near them have said. */}
      {!q && !value.length && starters.length ? (
        <View style={{ gap: 9 }}>
          <Text style={s.kicker}>{guest ? 'People near you love' : 'Suggestions, ordered for you'}</Text>
          <View style={s.wrap}>
            {starters.slice(0, 8).map((sug) => (
              <Press key={sug.key} onPress={() => add(asPicked(sug))} accessibilityRole="button" style={s.starter}>
                <Text style={s.starterText}>{sug.label}</Text>
              </Press>
            ))}
          </View>
        </View>
      ) : null}

      {/* What they have chosen. The first is the card's, and the order is theirs. */}
      {value.length ? (
        <View style={{ gap: 9 }}>
          <View style={s.labelRow}>
            <Text style={s.kicker}>{label}</Text>
            <Text style={s.ofCap}>{value.length} of {cap}</Text>
          </View>
          <ChipRow tags={value} onRemove={remove} onMove={move} onOpen={(k) => k && setDetail(k)} />
          {cardLine && value[0] ? (
            <View style={s.tintLine}>
              <Text style={s.tintText}>
                <Text style={{ fontWeight: '700' }}>{value[0].label}</Text> is what shows on your card. Drag to change the order.
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {detail ? <TagSheet tagKey={detail} vocab={vocab} guest={guest} onClose={() => setDetail(null)} onAdd={(t) => { add(t); setDetail(null); }} /> : null}
    </View>
  );
}

const asPicked = (r: SkillSuggestion): PickedTag => ({ key: r.key, raw: r.label, label: r.label, pending: false });

// ---------------------------------------------------------------------------
// the chips, and dragging them
// ---------------------------------------------------------------------------
/**
 * Order matters to the guest, so the chips are dragged rather than re-picked.
 *
 * The handle is what drags; the body opens the tag. The target index is worked
 * out from where the finger is against the chips' own measured boxes, so it
 * behaves the same whether they wrap onto one line or three — which they do at
 * 390px, and which a simple horizontal swap would get wrong.
 */
function ChipRow({ tags, onRemove, onMove, onOpen }: {
  tags: PickedTag[];
  onRemove: (i: number) => void;
  onMove: (from: number, to: number) => void;
  onOpen: (key: string | null) => void;
}) {
  const boxes = useRef<{ x: number; y: number; w: number; h: number }[]>([]);
  /**
   * The drag lives in a ref, not in state.
   *
   * A `PanResponder` is built once and keeps the callbacks it was built with,
   * so a handler that closed over `dragging` read `null` for ever and releasing
   * a chip never moved anything (Codex, 14 Sep 2026). State still drives what is
   * drawn; the refs are what the gesture reads.
   */
  const from = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const move = useRef(onMove);
  move.current = onMove;

  /** Which chip the finger is over, in the row's own coordinates. */
  const indexAt = (x: number, y: number) => {
    let best = null as number | null;
    let bestD = Infinity;
    boxes.current.forEach((b, i) => {
      if (!b) return;
      const d = Math.abs(b.x + b.w / 2 - x) + Math.abs(b.y + b.h / 2 - y) * 2;   // rows count for more than columns
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  };

  return (
    <View style={s.wrap}>
      {tags.map((tag, i) => (
        <Chip
          key={`${tag.key ?? tag.raw}-${i}`}
          tag={tag}
          first={i === 0}
          dragging={dragging === i}
          over={over === i && dragging !== null && dragging !== i}
          onLayout={(box) => { boxes.current[i] = box; }}
          onRemove={() => onRemove(i)}
          onOpen={() => onOpen(tag.key)}
          onDragStart={() => { from.current = i; setDragging(i); }}
          onDragMove={(x, y) => setOver(indexAt(x, y))}
          onDragEnd={(x, y) => {
            const to = indexAt(x, y);
            if (to != null && from.current != null) move.current(from.current, to);
            from.current = null;
            setDragging(null); setOver(null);
          }}
        />
      ))}
    </View>
  );
}

function Chip({ tag, first, dragging, over, onLayout, onRemove, onOpen, onDragStart, onDragMove, onDragEnd }: {
  tag: PickedTag; first: boolean; dragging: boolean; over: boolean;
  onLayout: (box: { x: number; y: number; w: number; h: number }) => void; onRemove: () => void; onOpen: () => void;
  onDragStart: () => void; onDragMove: (x: number, y: number) => void; onDragEnd: (x: number, y: number) => void;
}) {
  // Built once; the handlers it calls are read fresh every time.
  const handlers = useRef({ onDragStart, onDragMove, onDragEnd });
  handlers.current = { onDragStart, onDragMove, onDragEnd };
  /** This chip's own box in the row, from its layout. */
  const box = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  /**
   * The gesture arrives in page coordinates and the boxes are in the row's, so
   * the two are reconciled once at the start of the drag: where the finger went
   * down, minus where inside this chip it went down, minus where this chip sits.
   */
  const offset = useRef({ x: 0, y: 0 });
  const at = (g: { moveX: number; moveY: number }) => [g.moveX - offset.current.x, g.moveY - offset.current.y] as const;
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (_e, g) => {
      offset.current = { x: g.x0 - (box.current?.x ?? 0), y: g.y0 - (box.current?.y ?? 0) };
      handlers.current.onDragStart();
    },
    onPanResponderMove: (_e, g) => handlers.current.onDragMove(...at(g)),
    onPanResponderRelease: (_e, g) => handlers.current.onDragEnd(...at(g)),
    onPanResponderTerminate: (_e, g) => handlers.current.onDragEnd(...at(g)),
  })).current;

  const tone = tag.pending ? s.chipPending : first ? s.chipFirst : s.chipPlain;
  const text = tag.pending ? s.chipPendingText : first ? s.chipFirstText : s.chipPlainText;
  return (
    <View
      onLayout={(e) => {
        const { x, y, width, height } = e.nativeEvent.layout;
        box.current = { x, y, w: width, h: height };
        onLayout(box.current);
      }}
      style={[s.chip, tone, dragging && { opacity: 0.5 }, over && s.chipOver]}
    >
      <View {...pan.panHandlers} style={s.grip} accessibilityRole="adjustable" accessibilityLabel={`Move ${tag.label}`}>
        <Icon name="grip" size={13} color={tag.pending ? colors.accent : first ? INK : colors.inkMuted} strokeWidth={2} />
      </View>
      {tag.pending ? <Icon name="hours" size={12} color={colors.accent} strokeWidth={2} /> : null}
      <Pressable onPress={onOpen} accessibilityRole="button"><Text style={text}>{tag.label}</Text></Pressable>
      <Press onPress={onRemove} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${tag.label}`}>
        <Icon name="close" size={13} color={tag.pending ? colors.accent : first ? INK : colors.inkMuted} strokeWidth={2.2} />
      </Press>
    </View>
  );
}

// ---------------------------------------------------------------------------
// the detail sheet
// ---------------------------------------------------------------------------
/**
 * How a host tells *Foraging* from *Foraging (animal behaviour)* (S5).
 *
 * One line of plain English, the count where it flatters, and the near
 * collision offered as "Not this one?". Two senses of a word is the trap the
 * whole open vocabulary walks into, and this is the only thing in the design
 * that gets somebody out of it.
 */
function TagSheet({ tagKey, vocab, guest, onClose, onAdd }: {
  tagKey: string; vocab: 'tag' | 'facet'; guest: boolean; onClose: () => void; onAdd: (t: PickedTag) => void;
}) {
  const { width, height, framed, origin } = useViewport();
  // Inside the shell's phone frame a Modal still portals to the whole window,
  // so the sheet is pinned to the frame (CLAUDE.md).
  const frameBox = framed && origin ? { position: 'absolute' as const, left: origin.x, top: origin.y, width, height, overflow: 'hidden' as const } : null;
  const [data, setData] = useState<{ tag: SkillSuggestion & { note: string | null }; near: SkillSuggestion[] } | null>(null);
  useEffect(() => { let live = true; api.skillDetail(tagKey, { vocab, guest }).then((r) => { if (live) setData(r); }).catch(() => {}); return () => { live = false; }; }, [tagKey, vocab, guest]);

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={[StyleSheet.absoluteFill, frameBox]}>
        <Press effect="none" onPress={onClose} style={[StyleSheet.absoluteFill, s.dim]} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={s.sheet}>
          <View style={s.sheetHead}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.sheetName}>{data?.tag.label ?? '…'}</Text>
              {data?.tag.breadcrumb ? <Text style={s.crumb}>{data.tag.breadcrumb}</Text> : null}
            </View>
            <Press onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close"><Icon name="close" size={18} color={colors.ink} strokeWidth={2} /></Press>
          </View>
          {data?.tag.note ? <Text style={s.sheetLine}>{data.tag.note}</Text> : null}
          {data?.tag.hostCount != null ? <Text style={s.sheetCount}>{data.tag.hostCount} hosts in Britain</Text> : null}
          {data?.near.length ? (
            <View style={{ gap: 8 }}>
              <Text style={s.kicker}>Not this one?</Text>
              {data.near.map((n) => (
                <Press key={n.key} onPress={() => onAdd({ key: n.key, raw: n.label, label: n.label, pending: false })} accessibilityRole="button" style={s.nearRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.rowLabel} numberOfLines={1}>{n.label}</Text>
                    {n.breadcrumb ? <Text style={s.crumb} numberOfLines={1}>{n.breadcrumb}</Text> : null}
                  </View>
                  <Icon name="more" size={15} color={colors.inkMuted} strokeWidth={2} />
                </Press>
              ))}
            </View>
          ) : null}
          {data ? (
            <Press onPress={() => onAdd({ key: data.tag.key, raw: data.tag.label, label: data.tag.label, pending: false })} accessibilityRole="button" style={s.sheetCta}>
              <Text style={s.sheetCtaText}>Add {data.tag.label}</Text>
            </Press>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface, paddingHorizontal: 13, paddingVertical: 13, minHeight: 50 },
  fieldOn: { borderWidth: 2, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 12 },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 16, fontWeight: '500', color: colors.ink, outlineStyle: 'none' as any },

  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  rowLabel: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: colors.ink, lineHeight: 19 },
  crumb: { fontFamily: fonts.body, fontSize: 11.5, color: colors.inkMuted, lineHeight: 15 },
  count: { fontFamily: fonts.body, fontSize: 12, fontWeight: '700', color: colors.accent },
  asIs: { paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.ghost, marginTop: 10 },
  asIsText: { fontFamily: fonts.body, fontSize: 13.5, fontWeight: '600', color: colors.ink },

  limeBlock: { backgroundColor: LIME, padding: 15, gap: 9 },
  limeHead: { fontFamily: fonts.heading, fontSize: 19, fontWeight: '800', letterSpacing: -0.38, lineHeight: 23, color: INK },
  limeSub: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.onLime },
  addIt: { alignSelf: 'flex-start', backgroundColor: INK, paddingHorizontal: 16, paddingVertical: 10 },
  addItText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: colors.surface },

  kicker: { fontFamily: fonts.heading, fontSize: 11, fontWeight: '700', letterSpacing: 0.66, textTransform: 'uppercase', color: colors.inkMuted },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  ofCap: { fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: colors.ink },

  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  starter: { backgroundColor: colors.warm, paddingHorizontal: 11, paddingVertical: 8 },
  starterText: { fontFamily: fonts.body, fontSize: 13.5, fontWeight: '600', color: colors.ink },

  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 8 },
  chipFirst: { backgroundColor: LIME },
  chipFirstText: { fontFamily: fonts.body, fontSize: 13.5, fontWeight: '700', color: INK },
  chipPlain: { backgroundColor: colors.warm, borderWidth: 1, borderColor: colors.ruleSoft },
  chipPlainText: { fontFamily: fonts.body, fontSize: 13.5, fontWeight: '600', color: colors.ink },
  /** Pending: dashed moss with a clock. In the queue, live on the offer, never red. */
  chipPending: { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.accent, backgroundColor: colors.surface },
  chipPendingText: { fontFamily: fonts.body, fontSize: 13.5, fontWeight: '600', color: colors.accent },
  chipOver: { borderWidth: 1, borderColor: colors.line },
  grip: { paddingRight: 2, cursor: 'grab' as any },

  tintLine: { backgroundColor: colors.surfaceMuted, paddingHorizontal: 12, paddingVertical: 10 },
  tintText: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: colors.ink },

  dim: { backgroundColor: 'rgba(32,30,29,0.32)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopWidth: 2, borderTopColor: colors.line, padding: 18, gap: 13 },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  sheetName: { fontFamily: fonts.heading, fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  sheetLine: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink },
  sheetCount: { fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: colors.accent },
  nearRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  sheetCta: { backgroundColor: LIME, paddingVertical: 14, alignItems: 'center' },
  sheetCtaText: { fontFamily: fonts.body, fontSize: 15, fontWeight: '700', color: INK },
});
