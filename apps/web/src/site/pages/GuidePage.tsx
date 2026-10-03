/**
 * A subcategory guide (/{locale}/events/{slug}), built from `EpicGuide.dc.html`
 * (Supporting docs › Website & Registration › Landing pages, 3 Oct 2026): GP1/GP2
 * Pottery and GF1/GF2 Fossil hunting, the launch state, at 1280 and 390 and fluid
 * between. SiteLayout draws the Events · Host · Log in header and the footer.
 *
 * At launch there are no hosts and no events, so the guide is the page: the
 * intro, the numbered sections, Epic's own places, "coming soon" with the Tell me
 * when form, the host block, the FAQs and the review date. Never on it: prices,
 * events, host names, ratings, or placeholder cards (brief, "Never on the launch
 * page"). The V2 "On now" row waits for hosts and is not built.
 *
 * Every section is one of a few shapes — compare, steps, list, table, tiles,
 * note — so the next guide is new copy in guides.json, never a new layout. The
 * design's sizes are `clamp(min, n·cqw, max)` against the page's width; `fluid`
 * below is the same sum, so the page reflows between the two drawn widths.
 */
import React, { useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { CREAM, HAIRLINE, INACTIVE, INK, INK_HOVER, INK_MUTED, LIME, LIME_TINT, MOSS, MUTED, ON_INK_MUTED, fonts } from '../../theme';
import { useViewport } from '../../hooks/useViewport';
import { useRouter } from '../../router';
import { paths, type SiteLocale } from '../../routes';
import { GUIDES } from '../guides/content';
import { reviewedWords, type Guide, type GuideBlock, type GuideSlug } from '../guides';
import { GuideAlertForm } from '../GuideAlertForm';
import { SiteH1, SiteH2, SiteP } from '../type';

const web = Platform.OS === 'web';
/**
 * The design caps a measure in characters (`max-width: 68ch`), so it widens with
 * the type: one `ch` of Archivo is 0.5727em (measured, 739.9px for 68ch at 19px).
 */
const ch = (n: number, fontSize: number) => n * 0.5727 * fontSize;
/** The line height the design's text inherits wherever it sets none (its body rule). */
const LH = 1.55;
/** The placeholder grey of an unfilled photo slot, and the ink of its brief (the design's #3a3735). */
const SLOT = HAIRLINE;
const SLOT_INK = INK_HOVER;

export function GuidePage({ locale, guide: slug }: { locale: SiteLocale; guide: GuideSlug }) {
  const g = GUIDES[slug];
  const { width } = useViewport();
  const { navigate } = useRouter();
  const phone = width < 700;
  /** `clamp(min, n·cqw, max)`, as the design sizes everything against the page's width. */
  const fluid = (min: number, cqw: number, max: number) => Math.max(min, Math.min(max, (width * cqw) / 100));
  const pad = fluid(20, 4.4, 56);
  const h1 = fluid(52, 10, 132);
  const inner = width - 2 * pad;

  // "In this guide" sits beside the sections while both fit at their basis
  // (220 and 560, flex 1 and 3); below that they stack, as the phone draws them.
  const guideGap = fluid(40, 5, 64);
  const sideBySide = inner >= 220 + 560 + guideGap;
  const blocksWidth = sideBySide ? 560 + ((inner - guideGap - 780) * 3) / 4 : inner;

  const scrollTo = (id: string) => {
    if (!web || typeof document === 'undefined') return;
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const blocks = g.blocks.map((b, i) => ({ ...b, n: String(i + 1).padStart(2, '0') }));
  // Coming soon and the host block sit side by side while each has 320px, as the design's auto-fit grid does.
  const stacked = width < 640;
  const tellId = `${slug}-tell`;

  return (
    <View style={{ backgroundColor: CREAM }}>
      {/* Breadcrumb, H1, intro and the three facts. */}
      <View style={{ paddingTop: fluid(18, 2.2, 28), paddingHorizontal: pad, gap: fluid(18, 2.4, 30) }}>
        <View {...(web ? ({ role: 'navigation', 'aria-label': 'Breadcrumb' } as object) : {})} style={s.crumbs}>
          {['Events', g.category.name, g.name].map((t, i, all) => (
            <View key={t} style={s.crumb}>
              {i > 0 ? <Text style={[s.crumbText, { color: MUTED }]} {...(web ? ({ 'aria-hidden': true } as object) : {})}>›</Text> : null}
              <Text style={[s.crumbText, i === all.length - 1 && { color: INK_MUTED }]} {...(web && i === all.length - 1 ? ({ 'aria-current': 'page' } as object) : {})}>{t}</Text>
            </View>
          ))}
        </View>
        <SiteH1 style={[s.h1, { fontSize: h1, letterSpacing: -0.055 * h1, lineHeight: h1 * 0.92 }]}>
          <Text style={[s.h1Lime, { paddingHorizontal: h1 * 0.12, paddingBottom: h1 * 0.05, marginLeft: -h1 * 0.12 }, web && ({ boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' } as object)]}>{g.h1a}</Text>
          {` ${g.h1b}`}
        </SiteH1>
        <View style={[s.introRow, { paddingTop: fluid(18, 2, 24), columnGap: fluid(32, 4.4, 56) }, phone && { flexDirection: 'column' }]}>
          <SiteP style={[s.intro, { fontSize: fluid(19, 1.8, 23), lineHeight: fluid(19, 1.8, 23) * 1.45 }, !phone && { flexGrow: 2, flexShrink: 1, flexBasis: 460 }]}>{g.intro}</SiteP>
          <View style={!phone ? { flexGrow: 1, flexShrink: 1, flexBasis: 240 } : null}>
            {g.facts.map(([a, b]) => (
              <View key={a} style={s.fact}>
                <Text style={s.factA}>{a}</Text>
                <Text style={s.factB}>{b}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* Three photo slots, 4px apart. The first screen: loaded at once. */}
      <View style={[s.strip, { paddingTop: fluid(24, 3, 40) }]}>
        {g.photos.map((p, i) => (
          // The tag and the brief in the flow, not pinned: in a 127px phone cell the tag
          // wraps, and the cell grows rather than letting the two overlap.
          <View key={i} style={[s.stripCell, { minHeight: fluid(130, 22, 300) }]}>
            {p.src ? <Image source={{ uri: p.src }} accessibilityLabel={p.alt} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
            <Text style={s.stripTag}>{p.tag}</Text>
            {p.src ? null : <Text style={[s.stripBrief, { fontSize: fluid(12, 1.2, 15), lineHeight: fluid(12, 1.2, 15) * 1.3 }]}>{p.want}</Text>}
          </View>
        ))}
      </View>

      {/* "In this guide", and the numbered sections. */}
      <View style={[s.guideRow, { paddingTop: fluid(40, 5.6, 72), paddingHorizontal: pad, columnGap: guideGap, rowGap: 28 }, !sideBySide && { flexDirection: 'column', alignItems: 'stretch' }]}>
        <View style={sideBySide ? { flexGrow: 1, flexShrink: 1, flexBasis: 220 } : null}>
          <Text style={[s.kicker, { paddingBottom: 12 }]}>In this guide</Text>
          <View {...(web ? ({ role: 'navigation', 'aria-label': 'In this guide' } as object) : {})} style={{ borderTopWidth: 1, borderTopColor: HAIRLINE }}>
            {blocks.map((b) => (
              <Pressable
                key={b.id}
                accessibilityRole="link"
                {...(web ? ({ href: `#${b.id}` } as object) : {})}
                onPress={(e: any) => { e?.preventDefault?.(); scrollTo(b.id); }}
                style={s.tocRow}
              >
                {({ hovered }: any) => (
                  <>
                    <Text style={[s.tocN]}>{b.n}</Text>
                    <Text style={[s.tocH, hovered && { color: MOSS }]}>{b.h2}</Text>
                  </>
                )}
              </Pressable>
            ))}
          </View>
        </View>
        <View style={sideBySide ? { flexGrow: 3, flexShrink: 1, flexBasis: 560, minWidth: 0 } : null}>
          {blocks.map((b) => (
            <Section key={b.id} b={b} n={b.n} width={blocksWidth} phone={phone} fluid={fluid} published={g.published} />
          ))}
        </View>
      </View>

      {/* Epic's own places: Wikidata, Historic England, OSM — never Google (J8). */}
      <View style={{ paddingTop: fluid(16, 2, 24), paddingBottom: fluid(48, 5.6, 72), paddingHorizontal: pad, gap: 18 }}>
        <Text style={[s.kicker, { borderTopWidth: 1, borderTopColor: HAIRLINE, paddingTop: fluid(28, 3, 40) }]}>From Epic's places</Text>
        <SiteH2 style={[s.h2Big, { marginTop: -6, fontSize: fluid(34, 4.4, 56), letterSpacing: -0.045 * fluid(34, 4.4, 56), lineHeight: fluid(34, 4.4, 56) }]}>{g.placesH2}</SiteH2>
        <Places g={g} phone={phone} />
      </View>

      {/* Coming soon (ink) and the host block (lime): side by side while each has 320px. */}
      <View style={[s.pair, stacked && { flexDirection: 'column' }]}>
        <View nativeID={tellId} style={[s.soon, !stacked && s.half, { paddingTop: fluid(32, 4.4, 56), paddingBottom: fluid(36, 4.4, 56), paddingHorizontal: pad }]}>
          <SiteH2 style={[s.pairH2, { color: LIME, fontSize: fluid(38, 4.6, 60), letterSpacing: -0.05 * fluid(38, 4.6, 60), lineHeight: fluid(38, 4.6, 60) * 0.95 }]}>{g.soonH2}</SiteH2>
          <SiteP style={[s.pairP, { color: ON_INK_MUTED, fontSize: fluid(17, 1.5, 19), lineHeight: fluid(17, 1.5, 19) * 1.5, maxWidth: ch(52, fluid(17, 1.5, 19)) }]}>{g.soonLine}</SiteP>
          <GuideAlertForm locale={locale} slug={slug} guide={g} />
        </View>
        <View style={[s.host, !stacked && s.half, { paddingTop: fluid(32, 4.4, 56), paddingBottom: fluid(36, 4.4, 56), paddingHorizontal: pad }]}>
          <SiteH2 style={[s.pairH2, { fontSize: fluid(38, 4.6, 60), letterSpacing: -0.05 * fluid(38, 4.6, 60), lineHeight: fluid(38, 4.6, 60) * 0.95 }]}>{g.hostH2}</SiteH2>
          <SiteP style={[s.pairP, { fontWeight: '500', fontSize: fluid(17, 1.5, 19), lineHeight: fluid(17, 1.5, 19) * 1.5, maxWidth: ch(52, fluid(17, 1.5, 19)) }]}>{g.hostP}</SiteP>
          {/* The host version of this page (/host/{subcategory}) is not designed yet; the host page is where hosting is explained. */}
          <Pressable
            accessibilityRole="link"
            {...(web ? ({ href: paths.siteHost(locale) } as object) : {})}
            onPress={(e: any) => { e?.preventDefault?.(); navigate(paths.siteHost(locale)); }}
            style={({ hovered }: any) => [s.hostButton, hovered && { backgroundColor: INK_HOVER }]}
          >
            <Text style={s.hostButtonText}>See how hosting works</Text>
            <Arrow color={CREAM} />
          </Pressable>
        </View>
      </View>

      <Faqs g={g} pad={pad} fluid={fluid} phone={phone} />

      <Text style={[s.reviewed, { paddingTop: fluid(28, 3, 40), paddingBottom: fluid(40, 4.4, 56), paddingHorizontal: pad }]}>
        Last reviewed {reviewedWords(g.reviewed)}
      </Text>
    </View>
  );
}

type Fluid = (min: number, cqw: number, max: number) => number;

/** How many columns of at least `min` fit in `width` with `gap` between, as CSS grid's auto-fit does. */
const colsFor = (width: number, min: number, gap: number, most: number) => Math.max(1, Math.min(most, Math.floor((width + gap) / (min + gap))));

/**
 * The design's `repeat(auto-fit, minmax(min, 1fr))`: as many equal columns as fit
 * the width the grid actually has (measured, not worked out from the page), and
 * every cell in a row as tall as the tallest, as a CSS grid row is — each cell
 * is a column its card grows to fill.
 */
function Grid({ width, min, gap, rowGap = gap, count, children }: { width: number; min: number; gap: number; rowGap?: number; count: number; children: React.ReactNode[] }) {
  const [measured, setMeasured] = useState<number | null>(null);
  const w = measured ?? width;
  const cols = colsFor(w, min, gap, count);
  const cell = (w - gap * (cols - 1)) / cols;
  return (
    <View onLayout={(e) => setMeasured(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', columnGap: gap, rowGap }}>
      {/* A hair under the column and allowed to grow back to it: a fractional width
          that adds up to a hair over the row wraps the last card (900px, 3 Oct 2026). */}
      {children.map((c, i) => <View key={i} style={cols === 1 ? { width: '100%' } : { flexBasis: cell - 1, flexGrow: 1, maxWidth: cell, flexDirection: 'column' }}>{c}</View>)}
    </View>
  );
}

function Section({ b, n, width, phone, fluid, published }: { b: GuideBlock; n: string; width: number; phone: boolean; fluid: Fluid; published: boolean }) {
  const body: TextStyle = { fontSize: fluid(17, 1.5, 19), lineHeight: fluid(17, 1.5, 19) * 1.6, maxWidth: ch(68, fluid(17, 1.5, 19)) };
  const h2 = fluid(32, 3.8, 48);
  return (
    <View nativeID={b.id} style={[s.block, { paddingTop: fluid(24, 2.6, 32), paddingBottom: fluid(40, 4.4, 56) }, web && ({ scrollMarginTop: 12 } as object)]}>
      <Text style={s.blockN}>{n}</Text>
      <SiteH2 style={[s.h2, { marginTop: -8, fontSize: h2, letterSpacing: -0.04 * h2, lineHeight: h2 }]}>{b.h2}</SiteH2>
      {b.img ? (
        <View style={[s.slot, { height: fluid(220, 30, 380) }]}>
          <Text style={[s.slotBrief, { fontSize: fluid(14, 1.3, 16), lineHeight: fluid(14, 1.3, 16) * 1.35, left: 16, right: 16, bottom: 16, maxWidth: ch(52, fluid(14, 1.3, 16)) }]}>{b.img}</Text>
          <Text style={[s.slotTag, { left: 16, top: 16 }]}>Photo to license</Text>
        </View>
      ) : null}
      {(b.p ?? []).map((p, i) => <SiteP key={i} style={[s.para, body]}>{p}</SiteP>)}

      {b.tiles ? (
        <Grid width={width} min={220} gap={8} count={b.tiles.length}>
          {b.tiles.map((x) => (
            <View key={x.t} style={{ flexGrow: 1, backgroundColor: INACTIVE }}>
              <View style={[s.slot, { aspectRatio: 4 / 3 }]}>
                <Text style={[s.slotBrief, { fontSize: 13, lineHeight: 17, left: 12, right: 12, bottom: 12 }]}>{x.want}</Text>
                <Text style={[s.slotTag, { fontSize: 10.5, lineHeight: 10.5 * LH }]}>Photo to license</Text>
              </View>
              <View style={s.tileText}>
                <Text style={s.tileT} {...(web ? ({ role: 'heading', 'aria-level': 3 } as object) : {})}>{x.t}</Text>
                <Text style={s.tileD}>{x.d}</Text>
                <Text style={s.tileWhere}>{x.where}</Text>
              </View>
            </View>
          ))}
        </Grid>
      ) : null}

      {b.compare ? (
        <Grid width={width} min={250} gap={8} count={b.compare.length}>
          {b.compare.map((c) => (
            <View key={c.t} style={s.compare}>
              <Text style={s.compareT} {...(web ? ({ role: 'heading', 'aria-level': 3 } as object) : {})}>{c.t}</Text>
              <Text style={s.compareLine}>{c.line}</Text>
              <View {...(web ? ({ role: 'list' } as object) : {})} style={{ marginTop: 4 }}>
                {c.pts.map((x) => <Text key={x} {...(web ? ({ role: 'listitem' } as object) : {})} style={s.comparePt}>{x}</Text>)}
              </View>
            </View>
          ))}
        </Grid>
      ) : null}

      {b.steps ? (
        <View {...(web ? ({ role: 'list' } as object) : {})} style={{ borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
          {b.steps.map((x, j) => (
            <View key={x.t} {...(web ? ({ role: 'listitem' } as object) : {})} style={s.step}>
              <Text style={s.stepN}>{String(j + 1).padStart(2, '0')}</Text>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.stepT}>{x.t}</Text>
                <Text style={s.stepD}>{x.d}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {b.list ? (
        <View {...(web ? ({ role: 'list' } as object) : {})}>
          <Grid width={width} min={260} gap={32} rowGap={0} count={2}>
            {b.list.map((x) => (
              <View key={x.t} {...(web ? ({ role: 'listitem' } as object) : {})} style={s.listRow}>
                <View style={s.bullet} />
                <View style={{ flex: 1, alignItems: 'flex-start', gap: 4 }}>
                  <Text style={s.listT}>{x.t}</Text>
                  <Text style={s.listD}>{x.d}</Text>
                  {x.chk && !published ? <Text style={s.check}>Check before publishing</Text> : null}
                </View>
              </View>
            ))}
          </Grid>
        </View>
      ) : null}

      {b.table ? <Table head={b.table.head} rows={b.table.rows} phone={phone} /> : null}

      {(b.p2 ?? []).map((p, i) => <SiteP key={i} style={[s.para, body]}>{p}</SiteP>)}
      {b.note ? (
        <SiteP style={s.note}><Text style={s.noteT}>{b.note.t}</Text>{` ${b.note.d}`}</SiteP>
      ) : null}
    </View>
  );
}

/** Three equal columns, left-aligned; on a phone each row stacks with its column labels. */
function Table({ head, rows, phone }: { head: string[]; rows: string[][]; phone: boolean }) {
  const r = (role: string) => (web ? ({ role } as object) : {});
  if (phone) {
    return (
      <View {...r('table')} style={{ borderTopWidth: 1, borderTopColor: HAIRLINE }}>
        {rows.map((row) => (
          <View key={row[0]} {...r('row')} style={s.tableMobRow}>
            <Text {...r('rowheader')} style={s.tableMobA}>{row[0]}</Text>
            {row.slice(1).map((v, k) => (
              <View key={k} {...r('cell')} style={{ gap: 2 }}>
                <Text style={s.tableMobH}>{head[k + 1]}</Text>
                <Text style={s.tableCell}>{v}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  }
  return (
    <View {...r('table')}>
      <View {...r('row')} style={[s.tableRow, { paddingVertical: 12, borderTopWidth: 1, borderTopColor: HAIRLINE }]}>
        {head.map((h) => <Text key={h} {...r('columnheader')} style={[s.kicker, s.tableCol]}>{h}</Text>)}
      </View>
      {rows.map((row) => (
        <View key={row[0]} {...r('row')} style={[s.tableRow, { paddingVertical: 14 }]}>
          <Text {...r('rowheader')} style={[s.tableCell, s.tableCol, { fontWeight: '700' }]}>{row[0]}</Text>
          {row.slice(1).map((v, k) => <Text key={k} {...r('cell')} style={[s.tableCell, s.tableCol]}>{v}</Text>)}
        </View>
      ))}
    </View>
  );
}

function Places({ g, phone }: { g: Guide; phone: boolean }) {
  const source = (p: Guide['places'][number]) => (p.confirm && !g.published ? `${p.src} · confirm in Epic data` : p.src);
  if (phone) {
    return (
      <View style={{ borderTopWidth: 1, borderTopColor: HAIRLINE }}>
        {g.places.map((p) => (
          <View key={p.n} style={s.placeMob}>
            <Text style={[s.placeN, { fontSize: 19, lineHeight: 19 * LH }]} {...(web ? ({ role: 'heading', 'aria-level': 3 } as object) : {})}>{p.n}</Text>
            <Text style={s.placeWhere}>{p.where}</Text>
            <Text style={s.tableCell}>{p.what}</Text>
            <Text style={[s.placeWhere, { fontSize: 13, lineHeight: 13 * LH }]}>Source: {source(p)}</Text>
          </View>
        ))}
      </View>
    );
  }
  return (
    <View style={{ marginTop: 6 }}>
      <View style={[s.tableRow, { paddingVertical: 12, borderTopWidth: 1, borderTopColor: HAIRLINE }]}>
        {['Place', "What's there", 'Source'].map((h) => <Text key={h} style={[s.kicker, s.tableCol]}>{h}</Text>)}
      </View>
      {g.places.map((p) => (
        <View key={p.n} style={[s.tableRow, { paddingVertical: 16 }]}>
          <View style={[s.tableCol, { gap: 3 }]}>
            <Text style={s.placeN} {...(web ? ({ role: 'heading', 'aria-level': 3 } as object) : {})}>{p.n}</Text>
            <Text style={s.placeWhere}>{p.where}</Text>
          </View>
          <Text style={[s.tableCell, s.tableCol]}>{p.what}</Text>
          <Text style={[s.placeWhere, s.tableCol]}>{source(p)}</Text>
        </View>
      ))}
    </View>
  );
}

/** The FAQs as an accordion, the first one open (FAQPage: the same questions the server writes into the head). */
function Faqs({ g, pad, fluid, phone }: { g: Guide; pad: number; fluid: Fluid; phone: boolean }) {
  const [open, setOpen] = useState(0);
  const h2 = fluid(34, 4.4, 56);
  return (
    <View style={[s.faqRow, { paddingTop: fluid(40, 5.6, 72), paddingHorizontal: pad, columnGap: fluid(40, 5, 64) }, phone && { flexDirection: 'column', alignItems: 'stretch' }]}>
      <SiteH2 style={[s.h2Big, { fontSize: h2, letterSpacing: -0.045 * h2, lineHeight: h2 }, !phone && { flexGrow: 1, flexShrink: 1, flexBasis: 220 }]}>{g.faqH2}</SiteH2>
      <View style={[{ borderBottomWidth: 1, borderBottomColor: HAIRLINE }, !phone && { flexGrow: 3, flexShrink: 1, flexBasis: 560, minWidth: 0 }]}>
        {g.faqs.map(([q, a], i) => {
          const on = open === i;
          const answerId = `faq-${i}`;
          return (
            <View key={q} style={{ borderTopWidth: 1, borderTopColor: HAIRLINE }}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: on }}
                {...(web ? ({ 'aria-controls': answerId, 'aria-expanded': on } as object) : {})}
                onPress={() => setOpen(on ? -1 : i)}
                style={s.faqQ}
              >
                {({ hovered }: any) => (
                  <>
                    <Text style={[s.faqQText, { fontSize: fluid(18, 1.6, 21), lineHeight: fluid(18, 1.6, 21) * LH, letterSpacing: -0.01 * fluid(18, 1.6, 21) }, hovered && { color: MOSS }]}>{q}</Text>
                    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={hovered ? MOSS : INK} strokeWidth={2.4} strokeLinecap="square">
                      <Path d={on ? 'M5 12h14' : 'M12 5v14M5 12h14'} />
                    </Svg>
                  </>
                )}
              </Pressable>
              {on ? <SiteP nativeID={answerId} style={s.faqA}>{a}</SiteP> : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function Arrow({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  );
}

const body: TextStyle = { fontFamily: fonts.body, color: INK };
const head: TextStyle = { fontFamily: fonts.heading, color: INK, fontWeight: '800' };
const row: ViewStyle = { flexDirection: 'row' };

const s = StyleSheet.create({
  crumbs: { ...row, flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  crumb: { ...row, alignItems: 'center', gap: 8 },
  crumbText: { fontFamily: fonts.heading, fontSize: 15, lineHeight: 15 * LH, fontWeight: '600', color: INK },
  h1: { ...head, margin: 0 },
  h1Lime: { backgroundColor: LIME },
  introRow: { ...row, flexWrap: 'wrap', rowGap: 24, borderTopWidth: 1, borderTopColor: HAIRLINE },
  intro: { ...body, fontWeight: '500', maxWidth: 760 },
  fact: { ...row, flexWrap: 'wrap', alignItems: 'baseline', columnGap: 10, rowGap: 4, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  factA: { ...head, fontSize: 20, lineHeight: 20 * LH, letterSpacing: -0.4 },
  factB: { ...body, fontSize: 16, lineHeight: 16 * LH, color: INK_MUTED },

  strip: { ...row, gap: 4 },
  stripCell: { flex: 1, minWidth: 0, backgroundColor: SLOT, overflow: 'hidden', position: 'relative', padding: 12, justifyContent: 'space-between', gap: 10 },
  stripTag: { alignSelf: 'flex-start', backgroundColor: CREAM, fontFamily: fonts.heading, fontSize: 11, lineHeight: 11 * LH, fontWeight: '700', letterSpacing: 0.66, textTransform: 'uppercase', paddingVertical: 4, paddingHorizontal: 8, color: INK },
  stripBrief: { fontFamily: fonts.heading, fontWeight: '700', color: SLOT_INK },
  slot: { position: 'relative', backgroundColor: SLOT, overflow: 'hidden' },
  slotBrief: { position: 'absolute', fontFamily: fonts.heading, fontWeight: '700', color: SLOT_INK },
  slotTag: { position: 'absolute', left: 12, top: 12, backgroundColor: CREAM, fontFamily: fonts.heading, fontSize: 11, lineHeight: 11 * LH, fontWeight: '700', letterSpacing: 0.66, textTransform: 'uppercase', paddingVertical: 4, paddingHorizontal: 8, color: INK },

  guideRow: { ...row, flexWrap: 'wrap', alignItems: 'flex-start' },
  kicker: { fontFamily: fonts.heading, fontSize: 13, lineHeight: 13 * LH, fontWeight: '700', letterSpacing: 0.78, textTransform: 'uppercase', color: INK },
  tocRow: { ...row, gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  tocN: { width: 26, fontFamily: fonts.heading, fontSize: 16, fontWeight: '700', color: INK_MUTED, lineHeight: 21 },
  tocH: { flex: 1, fontFamily: fonts.heading, fontSize: 16, fontWeight: '700', color: INK, lineHeight: 21 },

  block: { gap: 20, borderTopWidth: 1, borderTopColor: HAIRLINE },
  blockN: { ...head, fontSize: 16, lineHeight: 16 * LH, color: MOSS },
  h2: { ...head, ...(web ? ({ textWrap: 'balance' } as object) : {}) },
  h2Big: { ...head, ...(web ? ({ textWrap: 'balance' } as object) : {}) },
  para: { ...body, ...(web ? ({ textWrap: 'pretty' } as object) : {}) },

  tileText: { paddingTop: 14, paddingHorizontal: 16, paddingBottom: 16, gap: 5 },
  tileT: { ...head, fontSize: 20, letterSpacing: -0.4, lineHeight: 22 },
  tileD: { ...body, fontSize: 15, lineHeight: 22 },
  tileWhere: { ...body, fontSize: 14, color: INK_MUTED, lineHeight: 20 },

  compare: { flexGrow: 1, backgroundColor: INACTIVE, paddingTop: 22, paddingHorizontal: 22, paddingBottom: 12, gap: 10 },
  compareT: { ...head, fontSize: 28, letterSpacing: -0.98, lineHeight: 28 },
  compareLine: { ...body, fontSize: 16, lineHeight: 24 },
  comparePt: { ...body, fontSize: 16, lineHeight: 23, paddingVertical: 11, borderTopWidth: 1, borderTopColor: HAIRLINE },

  step: { ...row, gap: 12, paddingVertical: 16, borderTopWidth: 1, borderTopColor: HAIRLINE },
  stepN: { ...head, width: 48, fontSize: 22, letterSpacing: -0.44, lineHeight: 24 },
  stepT: { ...head, fontSize: 19, letterSpacing: -0.29, lineHeight: 23 },
  stepD: { ...body, fontSize: 16, lineHeight: 24, maxWidth: ch(62, 16) },

  listRow: { ...row, flexGrow: 1, gap: 14, paddingVertical: 16, borderTopWidth: 1, borderTopColor: HAIRLINE },
  bullet: { width: 10, height: 10, backgroundColor: LIME, marginTop: 7 },
  listT: { ...head, fontSize: 18, letterSpacing: -0.27, lineHeight: 22 },
  listD: { ...body, fontSize: 16, lineHeight: 24 },
  check: { marginTop: 4, borderWidth: 1, borderColor: HAIRLINE, fontFamily: fonts.heading, fontSize: 11, lineHeight: 11 * LH, fontWeight: '700', letterSpacing: 0.66, textTransform: 'uppercase', paddingVertical: 3, paddingHorizontal: 7, color: INK_MUTED },

  tableRow: { ...row, gap: 24, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  tableCol: { flex: 1, minWidth: 0 },
  tableCell: { ...body, fontSize: 16, lineHeight: 23 },
  tableMobRow: { gap: 8, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  tableMobA: { ...head, fontSize: 18, lineHeight: 22 },
  tableMobH: { fontFamily: fonts.heading, fontSize: 12, lineHeight: 12 * LH, fontWeight: '700', letterSpacing: 0.72, textTransform: 'uppercase', color: INK_MUTED },

  note: { backgroundColor: LIME_TINT, paddingVertical: 18, paddingHorizontal: 20, ...body, fontSize: 17, lineHeight: 25.5, maxWidth: ch(68, 17) },
  noteT: { fontFamily: fonts.heading, fontWeight: '800' },

  placeMob: { gap: 6, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  placeN: { ...head, fontSize: 20, lineHeight: 20 * LH, letterSpacing: -0.4 },
  placeWhere: { ...body, fontSize: 15, lineHeight: 15 * LH, color: INK_MUTED },

  pair: { ...row },
  half: { flex: 1, minWidth: 0 },
  soon: { backgroundColor: INK, gap: 18 },
  host: { backgroundColor: LIME, gap: 18 },
  pairH2: { ...head, ...(web ? ({ textWrap: 'balance' } as object) : {}) },
  pairP: { ...body, ...(web ? ({ textWrap: 'pretty' } as object) : {}) },
  hostButton: { height: 56, backgroundColor: INK, ...row, alignItems: 'center', justifyContent: 'space-between', gap: 24, paddingHorizontal: 18, marginTop: 'auto' },
  hostButtonText: { fontFamily: fonts.heading, fontSize: 17, fontWeight: '700', color: CREAM },

  faqRow: { ...row, flexWrap: 'wrap', alignItems: 'flex-start', rowGap: 20 },
  faqQ: { ...row, justifyContent: 'space-between', alignItems: 'center', gap: 16, paddingVertical: 18 },
  faqQText: { flex: 1, fontFamily: fonts.heading, fontWeight: '700', letterSpacing: -0.2, color: INK },
  faqA: { ...body, fontSize: 17, lineHeight: 27.2, paddingBottom: 22, maxWidth: ch(68, 17), ...(web ? ({ textWrap: 'pretty' } as object) : {}) },

  reviewed: { fontFamily: fonts.heading, fontSize: 15, lineHeight: 15 * LH, fontWeight: '600', color: INK_MUTED },
});
