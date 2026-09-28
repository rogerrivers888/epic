/**
 * How it works — the model behind the filing, and the decisions behind the
 * rest of Epic, written down.
 *
 * The first part of the page is the owner's own document, "Epic — How It
 * Works" v2, updated for the Collections rename and the fact pipeline (owner,
 * 28 Sep 2026; back-office handover §9, Phase 4). It is drawn as the document
 * draws itself — eleven numbered sections, its diagrams as square boxes — and
 * every section carries the anchor the info icons on the desk deep-link to
 * (`HOW_ANCHORS` in routes.ts, `?at=`). Where the handover or the register
 * (Decisions and policies) changed something the document said, the document
 * is corrected here rather than quoted wrong: which tabs exist, fact sheets,
 * the bands, the pipeline's numbers.
 *
 * The page is two document tabs, as the prototype draws it: Business
 * mechanics beside a jump list of its eleven sections, and "The decisions
 * behind the rest of Epic" — the older decision log. The owner, 6 Sep 2026: "I think
 * we need a 'how it works' in the desktop back office thing, and you can put
 * all of these assumptions there in terms of what we've done." Three rules
 * keep it honest, because a page like this is worthless the moment it
 * describes something that is not true:
 *
 *   1. Every entry says whether it is **live** or **decided and not built**.
 *   2. Every entry names the file the rule is actually in, so the page can be
 *      checked against the code rather than believed.
 *   3. Where the answer changes by the minute — whether travel times are real
 *      or estimated right now — it is read from the API, not written here.
 */

import React, { useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Press } from '../../components/press';
import { api } from '../../api';
import { desk, fonts, spacing, type, BORDER, LIME, ON_LIME } from '../../theme';
import { Icon, IconName } from '../../components/Icon';
import { AdminPage, Banner, Panel, Pill } from '../kit';
import { Explain } from '../explain';
import { asOneOf, useQueryState, useRouter } from '../../router';
import { useViewport } from '../../hooks/useViewport';
import { howAnchorOf, HOW_ANCHORS, type HowAnchor } from '../../routes';
import { deskApi } from '../desk/kit';

// ---------------------------------------------------------------------------
// What the document reads live: the settings, and the counts
// ---------------------------------------------------------------------------

/**
 * Every number in the document that is a setting is read from
 * `GET /api/admin/desk/settings` when the page is drawn, never typed here —
 * a threshold changed on Fact automations changes this page the same minute
 * (fix pass, 28 Sep 2026). The shapes are the API's (`desk/settings.js`).
 */
type Band = { key: string; label: string };
type CostBand = { key: string; label: string; to?: number; under?: number; from?: number; over?: number };
type Cfg = {
  spotMentions: number; suggestReviews: number; verifySources: number; venueWins: boolean;
  addPlaces: number; shareMax: number; recheckPhysical: number; recheckAccess: number; recheckFood: number;
  suggestExpiry: number; askPerVisit: number; familiesSettle: number; familiesWrong: number;
  collectionMinPlaces: number; sourceSlow: number; sourceFailing: number;
  ageBands: Band[]; durationBands: Band[];
  costBands: Record<string, { currency: string; bands: CostBand[] }>;
};

/**
 * The counts the document states — subcategories, Google's words, collections.
 * Each is read from the endpoint that owns it; one that cannot be read is
 * `null` and its sentence leaves the number out rather than print a stale one.
 */
type Counts = { categories: number | null; subcategories: number | null; words: number | null; mapped: number | null; collections: number | null };
type Live = { cfg: Cfg | null; cfgFailed: boolean; counts: Counts };

const NO_COUNTS: Counts = { categories: null, subcategories: null, words: null, mapped: null, collections: null };

function useLive(): Live {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [cfgFailed, setCfgFailed] = useState(false);
  const [counts, setCounts] = useState<Counts>(NO_COUNTS);
  useEffect(() => {
    let live = true;
    deskApi.get<{ values: Cfg }>('/settings')
      .then((r) => { if (live) setCfg(r.values); })
      .catch(() => { if (live) setCfgFailed(true); });
    const put = (patch: Partial<Counts>) => { if (live) setCounts((c) => ({ ...c, ...patch })); };
    deskApi.get<{ counts: { subcategories: number }; categories: unknown[] }>('/categories')
      .then((r) => put({ subcategories: r.counts.subcategories, categories: r.categories.length })).catch(() => {});
    deskApi.get<{ counts: { inEpic: number; needs: number; notInEpic: number } }>('/mapping')
      .then((r) => put({ words: r.counts.inEpic + r.counts.needs + r.counts.notInEpic, mapped: r.counts.inEpic + r.counts.notInEpic })).catch(() => {});
    deskApi.get<{ count: number }>('/collections')
      .then((r) => put({ collections: r.count })).catch(() => {});
    return () => { live = false; };
  }, []);
  return { cfg, cfgFailed, counts };
}

/** A setting as the document says it: its number, or "—" while it cannot be read. */
const said = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('en-GB'));
/** "12 months", "1 month", "— months". */
const many = (v: number | null | undefined, one: string, more = `${one}s`) => `${said(v)} ${v === 1 ? one : more}`;

const MONEY: Record<string, string> = { GBP: '£', EUR: '€' };
const COUNTRY: Record<string, string> = { GB: 'UK', IE: 'Ireland' };

/** "Cheap, under £10", "Mid, £10–25" — a cost band as the definition reads it. */
function costBand(b: CostBand, currency: string) {
  const s = MONEY[currency] ?? `${currency} `;
  if (b.under != null) return `${b.label}, under ${s}${b.under}`;
  if (b.over != null) return `${b.label}, over ${s}${b.over}`;
  if (b.from != null && b.to != null) return `${b.label}, ${s}${b.from}–${b.to}`;
  return b.label;
}

// ---------------------------------------------------------------------------
// The document: Epic — How It Works (v2, updated 28 Sep 2026)
// ---------------------------------------------------------------------------

/**
 * A line of the document, with its emphasis written the way the document
 * writes it: `**bold**` and `*italic*`. Nothing else is parsed.
 */
function Rich({ children, style }: { children: string; style?: StyleProp<TextStyle> }) {
  const parts = children.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return (
    <Text style={style}>
      {parts.map((p, i) => p.startsWith('**')
        ? <Text key={i} style={{ fontWeight: '800' }}>{p.slice(2, -2)}</Text>
        : p.startsWith('*')
          ? <Text key={i} style={{ fontStyle: 'italic' }}>{p.slice(1, -1)}</Text>
          : p)}
    </Text>
  );
}

const P = ({ children }: { children: string }) => <Rich style={doc.p}>{children}</Rich>;
const H3 = ({ children }: { children: string }) => <Text style={doc.h3}>{children}</Text>;

function Bullets({ items }: { items: string[] }) {
  return (
    <View style={doc.list}>
      {items.map((t) => (
        <View key={t} style={doc.li}>
          <Text style={doc.dot}>–</Text>
          <Rich style={[doc.p, { flex: 1, marginBottom: 0 }]}>{t}</Rich>
        </View>
      ))}
    </View>
  );
}

/** The document's note: a rule down the left. */
function Note({ children }: { children: string | string[] }) {
  const lines = Array.isArray(children) ? children : [children];
  return (
    <View style={doc.note}>
      {lines.map((l, i) => <Rich key={i} style={[doc.p, { fontSize: 15.5, marginBottom: i === lines.length - 1 ? 0 : 10 }]}>{l}</Rich>)}
    </View>
  );
}

/**
 * A table as the document draws it. On a wide screen the columns share the
 * width in the document's own proportions; on a phone the table keeps a width
 * it can be read at and scrolls sideways inside its own box, so the page
 * itself never does (F4).
 */
function Table({ cols, rows, phone, minWidth = 620 }: {
  cols: { label: string; share: number }[];
  rows: string[][];
  phone: boolean;
  minWidth?: number;
}) {
  const body = (
    <View style={phone ? { width: minWidth } : undefined}>
      <View style={[doc.tr, doc.thRow]}>
        {cols.map((c) => <Text key={c.label} style={[doc.th, { flex: c.share }]}>{c.label}</Text>)}
      </View>
      {rows.map((r, i) => (
        <View key={i} style={doc.tr}>
          {r.map((cell, j) => <Rich key={j} style={[doc.td, { flex: cols[j].share }]}>{cell}</Rich>)}
        </View>
      ))}
    </View>
  );
  return phone
    ? <ScrollView horizontal style={doc.tableBox} contentContainerStyle={{ flexGrow: 0 }}>{body}</ScrollView>
    : <View style={doc.tableBox}>{body}</View>;
}

// --- The diagrams -----------------------------------------------------------

/**
 * The document's four box colours, taken onto the desk's palette. What is real
 * has a lime rule; what the family actually meets is lime itself, with ink
 * type; amber is "works, but watch it"; and what is thrown out is dashed —
 * not red, because red in Epic means danger and an excluded word is not one.
 */
type Tone = 'plain' | 'live' | 'key' | 'wait' | 'out';

function Box({ title, sub, note, tone = 'plain', style }: {
  title: string; sub?: string; note?: string; tone?: Tone; style?: StyleProp<ViewStyle>;
}) {
  const onLime = tone === 'key';
  return (
    <View style={[doc.box, doc[`box_${tone}` as const], style]}>
      <Rich style={[doc.boxTitle, onLime && { color: ON_LIME }, tone === 'out' && { color: desk.inkDim }]}>{title}</Rich>
      {sub ? <Rich style={[doc.boxSub, onLime && { color: ON_LIME }]}>{sub}</Rich> : null}
      {note ? <Text style={[doc.boxNote, onLime && { color: ON_LIME }]}>{note}</Text> : null}
    </View>
  );
}

/** A downward arrow between two boxes: a rule and a chevron, not a glyph. */
function Down() {
  return (
    <View style={doc.down}>
      <View style={doc.downLine} />
      <Icon name="expand" size={14} color={desk.inkDim} strokeWidth={2} />
    </View>
  );
}

/** Boxes side by side on a wide screen; stacked on a phone. */
function Across({ children, phone, gap = 12 }: { children: React.ReactNode; phone: boolean; gap?: number }) {
  return <View style={{ flexDirection: phone ? 'column' : 'row', gap, alignItems: 'stretch' }}>{children}</View>;
}

const Figure = ({ children, caption }: { children: React.ReactNode; caption?: string[] }) => (
  <View style={doc.figure}>
    {children}
    {caption ? <View style={{ marginTop: 14, gap: 4 }}>{caption.map((c) => <Text key={c} style={doc.cap}>{c}</Text>)}</View> : null}
  </View>
);

// --- The sections -------------------------------------------------------------

/**
 * The eleven titles, as the prototype's jump list spells them (logic.js
 * `HOW_SECTIONS`). Section 7 is "How a fact gets born", not the prototype's
 * "check": the pipeline replaced the harvest (fix pass, 28 Sep 2026).
 */
const TITLES: Record<HowAnchor, string> = {
  layers: '1. The three layers',
  categories: '2. Nine categories — and no scores',
  mapping: '3. Google’s words, and where they go',
  place: '4. What a place actually carries',
  facts: '5. Two kinds of check',
  where: '6. Where a value comes from',
  pipeline: '7. How a fact gets born',
  collections: '8. Collections — what a family browses',
  journey: '9. What happens when a family searches',
  counting: '10. Counting honestly',
  state: '11. Where this actually stands',
};

/** What the document's own contents line calls each section: shorter than its heading. */
const NAV: [HowAnchor, string][] = [
  ['layers', 'The three layers'], ['categories', 'The nine categories'], ['mapping', 'Google’s words'],
  ['place', 'A place'], ['facts', 'Two kinds of check'], ['where', 'Where a value comes from'],
  ['pipeline', 'How a fact gets born'], ['collections', 'Collections'], ['journey', 'A family searches'],
  ['counting', 'Counting honestly'], ['state', 'Where we are'],
];

function Section({ at, landed, children }: { at: HowAnchor; landed: boolean; children: React.ReactNode }) {
  // `nativeID` is the DOM id on the web, so `?at=facts` can find the section.
  return (
    <View nativeID={anchorId(at)} style={[doc.section, landed && doc.landed]}>
      <Text style={doc.h2}>{TITLES[at]}</Text>
      {children}
    </View>
  );
}

function TheDocument({ at, jump, live, phone }: { at: HowAnchor | null; jump: (a: HowAnchor) => void; live: Live; phone: boolean }) {
  // Side by side on a wide screen. On a phone the boxes stack, and a flex of 1
  // in a column of no fixed height would squash them to nothing.
  const half = phone ? undefined : { flex: 1 };
  const c = live.cfg;
  const k = live.counts;

  // Section 1's line about the filing names only the counts that could be read.
  const filed = [
    k.categories != null ? `${said(k.categories)} categories` : null,
    k.subcategories != null ? `${said(k.subcategories)} subcategories` : null,
    k.mapped != null ? `${said(k.mapped)} of Google’s words mapped` : null,
  ].filter(Boolean).join(', ');

  const bands: string[][] = c ? [
    ['Who it’s for', c.ageBands.map((b) => b.label).join(' · ')],
    ['Duration', c.durationBands.map((b) => b.label).join(' · ')],
    ...Object.entries(c.costBands).map(([country, v]) => [
      `Cost band, ${COUNTRY[country] ?? country} (per person)`, v.bands.map((b) => costBand(b, v.currency)).join(' · '),
    ]),
  ] : [['Who it’s for', '—'], ['Duration', '—'], ['Cost band (per person)', '—']];

  return (
    <View style={doc.wrap}>
      <Text style={doc.eyebrow}>Epic · How the filing works · v2</Text>
      <Text style={[doc.h1, phone && { fontSize: 32, lineHeight: 33 }]}>What is actually going on</Text>
      <Text style={doc.meta}>28 September 2026 · the model behind Overview · Categories · Facts · Mapping · Collections · Fact automations · Changes</Text>

      <Note>{[
        '**Renamed on 26 and 28 September.** On 26 September "labels", "rules" and "rows" were each doing several jobs, so the words changed: labels → **facts** · question set → **fact sheet** · question → **check** · answer → **what we found** · subcategory defaults → **defaults** · rows → **ideas**.',
        'On 28 September ideas became **collections**; the Defaults tab went, and a subcategory’s defaults now sit on its own page; shared fact sheets gave way to **each subcategory’s own list of facts**; and the harvest’s approvals gave way to the **fact pipeline**, which adds facts by rule. Older documents and screenshots use the old words.',
      ]}</Note>

      {live.cfgFailed ? (
        <Text style={doc.cantSpeak}>The settings could not be read just now, so every number below that is a setting reads —.</Text>
      ) : null}

      <Rich style={doc.lede}>Epic holds a very large number of places and has to answer one question well: given this family, this weather, this Saturday and this much time — what should they do? Everything below exists to turn a list of places into an answer to that question.</Rich>

      <View style={doc.nav}>
        {NAV.map(([a, label]) => (
          <Press key={a} effect="none" onPress={() => jump(a)} accessibilityRole="link">
            <Text style={doc.navLink}>{label}</Text>
          </Press>
        ))}
      </View>

      {/* 1 */}
      <Section at="layers" landed={at === 'layers'}>
        <P>Three separate jobs, done in order. Each one is useless without the one above it.</P>
        <Figure>
          <Box title="Census" sub="what exists, and where" style={doc.mid} />
          <Down />
          <Box title="Categories" sub="which drawer each place sits in" style={doc.mid} />
          <Down />
          <Across phone={phone}>
            <Box tone="live" title="Facts" sub="indoors · step free · who it’s for" style={half} />
            <Box tone="live" title="The fact pipeline" sub="spot · verify · add · re-check · families" style={half} />
          </Across>
          <Down />
          <Box tone="key" title="Collections" sub="rules over those facts" style={doc.mid} />
          <Down />
          <Box title="Inspire" sub="what the family actually sees" style={doc.mid} />
        </Figure>
        <P>**The census** says a place exists and roughly where. It is free, permanent, and it has run across the south east.</P>
        <P>{`**Categories** say which drawer a place belongs in. Also done${filed ? `: ${filed}` : ''}.`}</P>
        <P>**Facts** say what a place is *actually like*. Each subcategory keeps its own list of the facts it looks for, and the fact pipeline fills them in from Epic’s own sources, place by place, as households search. This is the half that is unfinished, and it is where the product’s value lives.</P>
        <P>**Collections** turn those facts into things a family recognises. Nothing is ever filed into a collection.</P>
      </Section>

      {/* 2 */}
      <Section at="categories" landed={at === 'categories'}>
        <P>An earlier version of this model carried eight graded axes — how thrilling, how much walking, how much planning, how new, how busy, how much you learn, how smart, how long a day — each scored 0 to 4 on every place. **They have been cancelled.**</P>
        <P>Every one failed the same test. Thrill duplicated the Adrenaline category and could not be scored consistently: nobody can say non-arbitrarily that a climbing wall is 2 and coasteering is 3. Walking was covered by step free plus duration and was obvious to a family anyway. Learning became the Educational category. Busy duplicated the Epic score. Planning collapsed into booking required. Smart was Dining style. Novelty turned out to be a property of the household’s history rather than the place. Duration was a range, not a grade.</P>
        <Note>**The rule that came out of it: if a value cannot be extracted from text, it cannot exist at Epic’s scale.** Every axis was a judgement no person could make twice the same way and no machine could read. Everything that survives is a fact sitting in a sentence on a website.</Note>
        <P>What is left is nine categories, and they do one job: **where a place is filed.**</P>
        <Table phone={phone} minWidth={520} cols={[{ label: 'Category', share: 34 }, { label: 'What it holds', share: 66 }]} rows={[
          ['Fun', 'Theme parks, soft play, cinemas, arcades, water parks'],
          ['Food & drink', 'Restaurants, pubs, cafés, farm shops, breweries'],
          ['Culture', 'Museums, castles, galleries, cathedrals, theatres'],
          ['**Educational**', 'Science centres, discovery centres, learning barns — new, and distinct from Culture'],
          ['Sport', 'Grounds, courses, clubs, and have-a-go activities'],
          ['Active', 'Pools, rinks, climbing, cycling, riding'],
          ['Adrenaline', 'Karting, paintball, high ropes, skydiving, indoor snow'],
          ['Relaxing', 'Gardens, spas, markets, browsing'],
          ['Outdoors', 'Parks, woods, beaches, lakes, trails, viewpoints'],
        ]} />
        <P>A castle is Culture. A science centre is Educational. A farm with a learning barn is Educational and not Culture at all. A museum is both — Culture primary, Educational secondary.</P>
        <P>A place has **one primary subcategory and any number of secondaries**, and it appears in every category it is filed under. It is not shown twice within one browsing session, but its place in a category never depends on what a household has already seen.</P>
      </Section>

      {/* 3 */}
      <Section at="mapping" landed={at === 'mapping'}>
        <P>{`Google describes every place with types from its own list — golf course, race course, road bridge, kebab shop. That list is built for maps, not for days out, so every one of ${k.words != null ? `the ${said(k.words)}` : 'them'} has to be given an answer.`}</P>
        <Figure caption={[
          'A word can land in more than one place — golf course fills a drawer and sets "not indoors"',
          'A word can fill several drawers, and exactly one of them is always its primary',
          'Travel places are held for reachability and never shown as somewhere to go',
        ]}>
          <Box title={k.words != null ? `Google’s ${said(k.words)} words` : 'Google’s words'} sub="golf course · road bridge · kebab shop" style={doc.mid} />
          <Down />
          <View style={doc.five}>
            <Box tone="live" title="A drawer" sub="Golf clubs" style={doc.fiveBox} />
            <Box tone="live" title="A fact" sub="indoors" style={doc.fiveBox} />
            <Box title="Travel" sub="a station" style={doc.fiveBox} />
            <Box title="Useful nearby" sub="a loo" style={doc.fiveBox} />
            <Box tone="out" title="Excluded" sub="a road bridge" style={doc.fiveBox} />
          </View>
        </Figure>
        <P>Excluding a word is a real answer, not a gap. A road bridge is on the map because maps need bridges; nobody is going to spend Saturday at one.</P>
        <H3>How a word is decided</H3>
        <Bullets items={[
          'Every word sits in exactly one of four views: **In Epic · Needs a decision · Not in Epic · Decided**.',
          'A word Google adds later goes straight into Needs a decision, with the machine’s suggestion or "No suggestion — choose where it goes". Until it is decided, its places are not in Epic unless another word carries them.',
          'Decisions are made one at a time — there is no "Accept all" — and each keeps its reason, who made it and when, can be undone, and appears in Changes. A proposal somebody chose to keep is never raised again, and one that would reverse a settled decision is never shown.',
          '**Places affected** counts only places that would actually leave Epic or move. Highgate is not lost if cemetery is excluded, because tourist attraction still carries it.',
          'Tourist attraction no longer files anything. It is kept as a fact only.',
        ]} />
      </Section>

      {/* 4 */}
      <Section at="place" landed={at === 'place'}>
        <Figure>
          <View style={doc.placeFrame}>
            <Text style={doc.boxTitle}>Coral Reef Waterworld</Text>
            <Text style={[doc.boxNote, { marginBottom: 12 }]}>one Google place ID · coordinates held 30 days</Text>
            <View style={{ gap: 12 }}>
              <Across phone={phone}>
                <Box title="Primary subcategory" sub="Fun › Water parks" style={half} />
                <Box title="Secondary subcategories" sub="Active › Pools & leisure centres" style={half} />
              </Across>
              <Across phone={phone}>
                <Box tone="live" title="Standard facts" sub="indoors yes · step free yes · who it’s for 4–10" style={half} />
                <Box tone="live" title="Ranges and cost" sub="2–3 hours · Mid" style={half} />
              </Across>
              <Box tone="live" title="Facts its subcategory looks for · Water parks" sub="wave machine Verified yes · toddler pool Verified yes · lane swimming Don’t know" />
            </View>
          </View>
        </Figure>
        <P>Five kinds of thing, and they do not overlap. The filing says where it lives. The standard facts — yes/no, ranges and the cost band — say what it is like generally, and are looked for at every place. The facts its subcategory looks for say the specific things that only matter for *this kind* of place.</P>
        <H3>What an answer can be</H3>
        <Table phone={phone} minWidth={560} cols={[{ label: 'Answer', share: 24 }, { label: 'Seen by', share: 20 }, { label: 'What it means', share: 56 }]} rows={[
          ['**Verified yes**', 'public, counted', 'Our own sources say so, and none says otherwise.'],
          ['**No**', 'public, counted', 'One of our own sources says it is not there.'],
          ['**Conflict**', 'private', 'Our own sources contradict each other and the venue’s own website says nothing. Never shown; families who visit settle it.'],
          ['**Suggestion**', 'private', `Reviewers raised it and it is in the backlog, to be checked. Deleted once checked, and dropped after ${many(c?.suggestExpiry, 'day')} at the latest.`],
          ['**Don’t know**', 'normal', 'Nothing we own mentions it. Most places do not have most features, so it is never a headline number and never a problem.'],
        ]} />
      </Section>

      {/* 5 */}
      <Section at="facts" landed={at === 'facts'}>
        <Table phone={phone} cols={[{ label: 'Kind', share: 22 }, { label: 'Shape', share: 24 }, { label: 'Asked of', share: 24 }, { label: 'Example', share: 30 }]} rows={[
          ['**Standard check**', 'yes / no, a range, or a band', 'everything', 'indoors · step free · parking · toilets · booking required · food on site · dog friendly · who it’s for · duration · cost band'],
          ['**Subcategory check**', 'yes / no / don’t know', 'the places in each subcategory whose list holds it', `wave machine — looked for only in the subcategories where our own sources have verified it at ${many(c?.addPlaces, 'place')}`],
        ]} />
        <P>The test: **could two reasonable people standing in front of the place disagree?** If no, it is a fact, and a check can find it. If yes, it is a judgement — and since judgements are not stored, it belongs in a collection’s rule instead.</P>
        <Note>**"Rainy day" is none of these.** It is a conclusion drawn from indoors, and storing it separately means the same fact held twice, out of step the moment one changes. Anything that describes how people *feel* about a place is a collection’s rule, not something the place carries. Kid friendly went the same way, in favour of who it’s for.</Note>
        <H3>What the bands mean</H3>
        <P>One set, shared by defaults, facts, collections and the families’ questions, read from Fact automations. A standard fact’s own page shows its definition.</P>
        <Table phone={phone} minWidth={600} cols={[{ label: 'Standard fact', share: 28 }, { label: 'Bands', share: 72 }]} rows={bands} />
        <P>Who it’s for is the sweet spot, not the tolerance: Coral Reef is best for 4–10, even though a two-year-old can paddle. One range per place, and accepted fuzziness where a place spans more than one.</P>
      </Section>

      {/* 6 */}
      <Section at="where" landed={at === 'where'}>
        <P>A fact can be set at three levels. Each is a default for the one below it, and the most specific one wins. The first lives under Mapping; the second on each subcategory’s own page — there is no Defaults tab.</P>
        <Figure>
          <Box title="Set on one of Google’s words" sub={'every place carrying that word · "golf course is not indoors"'} />
          <Down />
          <Box title="Set on a subcategory — a default" sub={'every place in that drawer · "golf clubs need booking"'} />
          <Down />
          <Box tone="key" title="Set on the place itself" sub={'one place · "Swinley suits ages 8+" — our own sources, families who went, or a person said so, and it wins'} />
        </Figure>
        <P>A human’s answer is never overwritten by a default. Change the default afterwards and the places a person has touched keep their own value; the places that say otherwise are counted instead, which is how you find out a default is wrong.</P>
        <Bullets items={[
          'A person can set a standard fact on one subcategory, or tick several on the Categories list and set it across all of them at once. **A default a person sets counts as an answer from Epic**: it is public for every place with no answer of its own.',
          'A default the machine proposes from the places’ own values is private until a person accepts it.',
          'Families never see hedged wording such as "usually indoors".',
          'When most confirmed places contradict a person-set default — three or more confirmed, more than half of them saying otherwise — it is flagged amber on the subcategory’s page ("7 of 10 confirmed places say otherwise") and listed under Needs you on Overview.',
          'Age is never set on a Google word.',
        ]} />
      </Section>

      {/* 7 */}
      <Section at="pipeline" landed={at === 'pipeline'}>
        <P>Nobody sits and writes the facts, and nobody approves them one by one. They come out of what is written about places, are checked against sources Epic owns, and are added by rule. **The machine runs itself: no button starts any of it.** A person corrects what is wrong, removes what should not be looked for, and sets the rules.</P>
        <Note>{[
          '**How Epic grows its knowledge.**',
          '"Epic gets to know the places near each household. The moment someone subscribes, we find the top 20 in every category around their home and check them against their own websites and other sources, so their first search is fast. Scroll past 20 and we fetch the next 20. Each new household overlaps and extends what we know. We never sweep a whole subcategory, area or country — we only look at places families will see."',
        ]}</Note>
        <Figure>
          <Box title="1. Spot" sub="When a household’s search pays Google for a place’s details, the reviews are read in memory for features — and whether each one asserts, denies or merely asks. Features only, never opinions or conditions."
            note={`${many(c?.spotMentions, 'mention')} → we go and look · any denial → a conflict · ${many(c?.suggestReviews, 'asserting review')}, none denying → "Reviewers mention a sauna", in that session only`} />
          <Down />
          <Box tone="live" title="2. Verify" sub="At once, against the venue’s own website, our local copy of OpenStreetMap, the Wikipedia body and Wikidata."
            note={`${many(c?.verifySources, 'source')} saying yes, none saying no → Verified yes · a source says no → No · sources conflict → the venue’s website decides (${c ? (c.venueWins ? 'on' : 'off') : '—'}) · nothing found → Don’t know`} />
          <Down />
          <Box tone="live" title="3. Add" sub="Verified at enough places in a subcategory, the fact joins that subcategory’s list, and is looked for at each place as it next comes up — never as a sweep."
            note={`${many(c?.addPlaces, 'place')} → Active · on more than ${said(c?.shareMax)}% of places → Ignored instead (access and age facts exempt)`} />
          <Down />
          <Box title="4. Re-check" sub="When a place a search surfaces has a fact past its period, it is checked again — never as a sweep."
            note={`physical features ${many(c?.recheckPhysical, 'month')} · access ${many(c?.recheckAccess, 'month')} · food and dietary ${many(c?.recheckFood, 'month')}, worded “the venue says…”`} />
          <Down />
          <Box tone="key" title="5. Families confirm" sub="Families who have visited are one of our own sources. Asked after a visit, only about what matters to them — a toddler pool only to a household with a toddler."
            note={`at most ${many(c?.askPerVisit, 'question')} a visit · ${many(c?.familiesSettle, 'family', 'families')} agreeing, none saying otherwise, settles it · ${said(c?.familiesWrong)} saying a shown fact is wrong hides it until it is re-checked`} />
          <Down />
          <Box tone="out" title="Housekeeping" sub={`A suggestion still in the backlog is dropped after ${many(c?.suggestExpiry, 'day')}. It comes back the next time a search finds the place.`} />
        </Figure>
        <P>{`**Disputed before.** A fact families have hidden is checked again when it is next due. If our own sources confirm it again it is reinstated and marked **disputed before**, and the next families who visit are asked about it first.`}</P>
        <P>**Google may suggest; it never answers.** The only thing derived from Google that is stored is a suggestion — a place ID, a feature, a status and the day it was first seen, with no text, quotes, review ids or counts. It is never public, never counted, never used by a collection or a filter, and it is deleted once checked. A stored fact comes from our own sources, with the source and an evidence quote, because owned text may be kept. Six reviews mentioning a feature and no owned source is Don’t know; two venue pages is Yes. That is the policy working.</P>
        <P>{`A fact’s status in a subcategory is **Active** (Epic looks for it there — confirmed at ${many(c?.addPlaces, 'place')} or more), **Gathering evidence** (seen, and confirmed at fewer, whatever else is true), or **Ignored**, with its reason: on nearly every place, an opinion, a condition, or removed by a person. **New** marks the first 30 days after it became Active. A word on nearly every place of a kind is ignored for a reason of its own: lockers are in every water park, so knowing about lockers tells a family nothing. A fact a person removes is never added back.`}</P>
        <P>{`Every threshold is a setting on **Fact automations**, and changing one is a person’s decision, logged in Changes; the numbers on this page are read from there. What the machine did is reported apart from the settings, under Facts: **Verification** says whether it is running and flowing, with its **Backlog** — a source is Slow at ${said(c?.sourceSlow)}% failures and Failing at ${said(c?.sourceFailing)}%; **Accuracy** compares the machine’s answers with what families said after visiting — where the two differ is a disagreement — and reads "Building" until there are ten answers; **Excluded facts** lists what it chose not to add, with Put back and Include anyway. Nobody works through a queue of exceptions: conflicts and disputes are settled by rules and by families.`}</P>
      </Section>

      {/* 8 */}
      <Section at="collections" landed={at === 'collections'}>
        <P>Nobody browses "Sport". They browse "it’s raining again" and "wear them out". A collection is a title, a line of copy and a rule — and nothing is filed into it.</P>
        <Figure>
          <Across phone={phone}>
            <Box tone="key" title="Toddler-proof" sub="who it’s for overlaps 0–3" note="works today — the fact exists" style={half} />
            <Box tone="wait" title="Big kids" sub="Fun or Adrenaline · ages from ≤12 to ≥60" note="works, but thin — left thin on purpose" style={half} />
          </Across>
          <View style={{ flexDirection: phone ? 'column' : 'row', gap: 12, marginTop: 12 }}>
            <View style={half}>
              <Down />
              <Box title="Every place that answers" sub="whatever drawer it happens to sit in" note="a soft play, a farm, a museum with a play barn" />
            </View>
            <View style={[half, { justifyContent: 'center', gap: 4, paddingTop: phone ? 0 : 30 }]}>
              <Text style={doc.cap}>Change the rule and the collection’s contents change</Text>
              <Text style={doc.cap}>the same afternoon. Nothing is refiled,</Text>
              <Text style={doc.cap}>because nothing was filed in the first place.</Text>
            </View>
          </View>
        </Figure>
        <H3>The rule</H3>
        <Bullets items={[
          'A rule gathers places from any category. Pills in the same group mean "any of"; different groups must all hold; any pill can be turned to "not".',
          'Ages and duration are from–to ranges; cost is Free · Cheap · Mid · Dear.',
          'Who sees it is **derived, never set**: no age condition → everyone; a lower age of 16 or more → households with an adult; otherwise → households with somebody in that age range. "Not visited by this household" is applied on its own when it is shown.',
          `A collection is hidden from a household when fewer than ${many(c?.collectionMinPlaces, 'place')} match within its reach. Thinness is information, not an alarm.`,
        ]} />
        <P>Hearting a collection is the strongest signal in the product, because a collection is a rule — one tap says something about several facts at once, where hearting a single place says something about one place. Hearted collections rise to the top of Inspire; two or three unhearted ones always stay in view; an empty hearted one is never shown; and hearts fade. The first heart asks whose list it is, once.</P>
        <P>A collection may use a household member’s name — "A day to yourself, Sarah" — and never attaches a child’s name to a negative. How often each is shown, opened and hearted is counted per collection and per audience, and reads "—" until there are real households.</P>
        <P>Kept as they were: **Big kids** (Fun or Adrenaline, ages from 12 or under to 60 or over, deliberately thin), **Sneakily educational** (Educational, with Fun as its primary), and the four age collections — Toddler-proof 0–3, Little ones 4–7, Older kids 8–12, Teenager-proof 13–18.</P>
      </Section>

      {/* 9 */}
      <Section at="journey" landed={at === 'journey'}>
        <Figure>
          <Box title="Everything within reach" sub="from the census — free, already known, thousands of places" />
          <Down />
          <Box title="Narrowed by the hard constraints" sub="open now · close enough · suits the youngest · indoors because it is raining" />
          <Down />
          <Box title="Ordered by the Epic score" sub="our own number — never a stored copy of anyone else’s rating" />
          <Down />
          <Box tone="key" title="Re-ordered for this household" sub="what each member will tolerate, what they love, what they have already done" />
        </Figure>
        <P>The constraints do most of the work and cost nothing to apply. A learned model never overrides them: a bad recommendation on a social app costs fifteen seconds, and a wasted Saturday with two children in the car undoes a month of good ones.</P>
        <P>What is shown is what Epic then gets to know. Buying a place’s details to draw it is where the fact pipeline’s Spot step runs, and a household that scrolls past twenty in a category brings in the next twenty. Nothing is swept, and nothing is paid for twice.</P>
      </Section>

      {/* 10 */}
      <Section at="counting" landed={at === 'counting'}>
        <P>Epic’s numbers are floors more often than they are answers, and the discipline that keeps them useful is saying so on the number itself rather than in a flag beside it.</P>
        <H3>A page is not a count</H3>
        <P>Google returns twenty places per request and stops. For a long time the home screen printed the length of that list, so a ring holding 16,258 culture places read **19**. The census count is free, permanent and read from our own tables; it is what gets shown, with the handful bought for display beneath it.</P>
        <H3>Unresolved splits — it does not resolve inward</H3>
        <P>The census works in boxes, and a ring’s edge cuts through them. Those straddling boxes go in an unresolved bucket, and some of what is in them lies inside the ring and some outside. So the true figure sits *between* the counted number and the sum of both, and nothing narrows it but a finer census of the edge.</P>
        <H3>A partial count says it is partial, in the number</H3>
        <P>While a sweep is running, one tile has answered a drawer and another has not. The count reads **"at least 340, sweeping, 4 of 11 tiles"** — the caveat inseparable from the figure — and partial counts sort after finished ones. A labelled wrong number beats an unlabelled stale one, because you can see the first is wrong. A count in the same typeface as a finished one, with a flag beside it, will be read as a count.</P>
        <H3>Every count carries its scope</H3>
        <P>The whole estate by default, with geography as a drill-down: "Wave machine · 2 places" means two everywhere. The location filter on Categories and Collections — a postcode, town or city and a reach, 30 minutes by car unless changed — switches a count to what a household there would see. A place counts once however many subcategories share it, and a sample size is never a denominator.</P>
        <Note>**The rule underneath all of these: every diagnostic has a can’t-speak state.** A signal without enough evidence says so — "Building", "Never run", "—" — rather than recommending an action. Six separate faults this month were the same shape — a number that could not see saying something anyway.</Note>
      </Section>

      {/* 11 */}
      <Section at="state" landed={at === 'state'}>
        <Table phone={phone} cols={[{ label: 'Piece', share: 30 }, { label: 'State', share: 18 }, { label: 'What is left', share: 52 }]} rows={[
          ['Census', 'Done', 'Inner London corrected; nearest-postcode placement next'],
          ['Categories and subcategories', 'Done', 'Educational live; the taxonomy audit waits to be accepted'],
          ['Google’s words mapped', 'Done', 'Re-fenced by type; text-sourced drawers no longer counted; decisions now one at a time, each with its reason'],
          ['Facts (yes/no, ranges, cost band)', 'Working', 'Bands signed off 28 September; defaults set on each subcategory’s page; what we know per place is thin'],
          ['Fact sheets', '**Replaced**', 'Each subcategory keeps its own list of facts, filled by the pipeline'],
          ['The fact pipeline', 'Built', 'Spot, Verify, Add, Re-check and Families confirm run themselves; the families’ question in the app waits on its design brief'],
          ['The eight axes', '**Cancelled**', 'See section 2 — nothing replaces them'],
          ['The corpus', 'Thin', 'Verify reads the venue’s paragraphs and the Wikipedia body; nothing is re-extracted before the prose change lands'],
          ['Collections', 'Built', `${k.collections != null ? `${said(k.collections)} collections, all` : 'All'} rules over facts; engagement reads "—" until there are real households`],
        ]} />
        <P>{`The blockage has moved again. Facts are no longer approved from a harvest: the machine adds one to a subcategory once our own sources have verified it at ${many(c?.addPlaces, 'place')} of its places. So what Epic can learn is bounded by how much owned text it can read about each place — which is why the venue’s own paragraphs and the Wikipedia body come first, and why families who have been are counted as a source.`}</P>
      </Section>
    </View>
  );
}

// ---------------------------------------------------------------------------
// The frame: the document tabs and the jump list
// ---------------------------------------------------------------------------

/** The two documents on this page, each a tab (prototype `howDocs`). */
const DOCS = ['mechanics', 'decisions'] as const;
type Doc = typeof DOCS[number];
const DOC_NAME: Record<Doc, string> = { mechanics: 'Business mechanics', decisions: 'The decisions behind the rest of Epic' };

/**
 * The tab strip over the document: 15/800, a lime rule under the one that is
 * open, a 2px rule under the whole strip. On a phone the strip scrolls
 * sideways rather than wrapping, so the rule stays one line.
 */
function DocTabs({ value, onChange }: { value: Doc; onChange: (d: Doc) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ flexGrow: 1 }}>
      {DOCS.map((d, i) => (
        <React.Fragment key={d}>
          {i > 0 ? <View style={frame.tabGap} /> : null}
          <Press effect="none" onPress={() => onChange(d)} accessibilityRole="tab" accessibilityState={{ selected: value === d }}>
            <Text style={[frame.tab, { color: value === d ? desk.ink : desk.inkDim, borderBottomColor: value === d ? LIME : desk.ruleStrong }]}>{DOC_NAME[d]}</Text>
          </Press>
        </React.Fragment>
      ))}
      <View style={frame.tabRest} />
    </ScrollView>
  );
}

/**
 * The eleven numbered titles beside the document (prototype template, the How
 * page's 230px column): 13px, the one in view 800 with a lime rule down its
 * left, the rest 500 and dim. On a phone it is a row that scrolls sideways
 * above the document, the rule under each title instead of beside it.
 */
function JumpList({ on, onJump, phone }: { on: HowAnchor; onJump: (a: HowAnchor) => void; phone: boolean }) {
  const items = HOW_ANCHORS.map((a) => (
    <Press key={a} effect="none" onPress={() => onJump(a)} accessibilityRole="link">
      <Text style={[
        frame.jump,
        phone ? frame.jumpPhone : frame.jumpWide,
        { fontWeight: on === a ? '800' : '500', color: on === a ? desk.ink : desk.inkDim },
        phone ? { borderBottomColor: on === a ? LIME : desk.rule } : { borderLeftColor: on === a ? LIME : desk.rule },
      ]}>{TITLES[a]}</Text>
    </Press>
  ));
  return phone
    ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>{items}</ScrollView>
    : <View style={[frame.jumpCol, STICKY]}>{items}</View>;
}

/** The web keeps the jump list in view as the page scrolls; native has no sticky. */
const STICKY = (Platform.OS === 'web' ? { position: 'sticky', top: 16 } : {}) as unknown as ViewStyle;

const frame = StyleSheet.create({
  tab: { fontFamily: fonts.heading, fontSize: 15, fontWeight: '800', paddingBottom: 11, borderBottomWidth: BORDER },
  tabGap: { width: 30, borderBottomWidth: BORDER, borderBottomColor: desk.ruleStrong },
  tabRest: { flexGrow: 1, minWidth: 30, borderBottomWidth: BORDER, borderBottomColor: desk.ruleStrong },
  body: { gap: 28, alignItems: 'flex-start' },
  jumpCol: { width: 230, flexShrink: 0 },
  jump: { fontFamily: fonts.body, fontSize: 13, lineHeight: 17.5 },
  jumpWide: { paddingVertical: 8, paddingLeft: 12, borderLeftWidth: 2 },
  jumpPhone: { paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 2 },
  // The document sits in its own frame, as the prototype's does.
  paper: { flex: 1, minWidth: 0, borderWidth: 1, borderColor: desk.rule, backgroundColor: desk.well, paddingVertical: 48, paddingHorizontal: 20 },
  paperPhone: { alignSelf: 'stretch', paddingVertical: 28, paddingHorizontal: 16 },
});

// ---------------------------------------------------------------------------
// The decision log: the rest of Epic
// ---------------------------------------------------------------------------

/**
 * `live` — Epic does this today.
 * `planned` — decided, and the code does not do it yet.
 * `partial` — the rule is real but only part of it has been built.
 */
type State = 'live' | 'partial' | 'planned';

type Decision = {
  title: string;
  /** What Epic does, in one or two sentences. The rule itself. */
  rule: string;
  /** What it buys and what it costs. The part a decision is actually made on. */
  why: string;
  state: State;
  /** The file the rule lives in, so this page can be checked rather than trusted. */
  where?: string;
  /** The owner's own words, where a decision came from him rather than from the docs. */
  said?: { who: string; on: string; words: string };
};

/**
 * The filing sections that used to open this log (mechanics, categories,
 * facts, sheets, mapping, defaults, ideas) are the document above now; what
 * stays here is everything else Epic has decided.
 */
type Section = { key: string; title: string; blurb: string; icon: IconName; decisions: Decision[] };

/** A path is a path: it reads as one, and it is meant to be copied into an editor. */
const MONO = Platform.OS === 'web' ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined;

const SECTIONS: Section[] = [
  {
    key: 'money',
    title: 'What things cost, and where we cut',
    blurb: 'Every outbound call is somebody’s money. These are the places Epic deliberately spends less, and what it gives up to do it.',
    icon: 'money',
    decisions: [
      {
        title: 'A detour is estimated while you browse, and measured once you add it',
        rule: 'Browsing "along the route" shows how far off the route each place is, worked out from the distance. Nothing is asked of Google. The moment a place is added to the day, that one place is routed properly and the time on the day is the real one.',
        why: 'A browse is six to thirty candidates and the filters change constantly — routing all of them on every chip tap would spend the day’s quota in a few minutes. One place, once, when somebody has actually chosen it, is a single call. The cost is that a browse row can be out by a few minutes; the day itself never is.',
        state: 'live',
        where: 'apps/api/src/domain/travel.js · apps/api/src/sources/routing.js',
        said: { who: 'the owner', on: '6 Sep 2026', words: 'As long as the detour route minutes are roughly correct, I think that’s okay… once the user adds it to their actual trip, not in a shortlist, then we can recalculate the actual correct number.' },
      },
      {
        title: 'A corridor has a width as well as two ends',
        rule: 'Browsing "along the route" keeps only what is within the detour budget, between the two ends of the journey, and within half of what that budget reaches of the road itself — about 1.8km at fifteen minutes in a car. How many were left just outside is said at the foot of the list, and one tap widens it.',
        why: 'The detour on its own lets in places nobody would call on the way: going back past the house and round really is only ten extra minutes, so Chobham Common kept appearing on the road to Thorpe Park. Being between the two ends is not enough either — a place off to one side still projects onto the route. It is the width that makes a corridor a corridor.',
        state: 'live',
        where: 'apps/api/src/routes/trips.js · GET /:id/along',
        said: { who: 'the owner', on: '6 Sep 2026', words: 'I shouldn’t have any going in the opposite direction from my home, for example. That doesn’t make any sense.' },
      },
      {
        title: 'A stay’s must-haves filter on what a mapper positively said, and silence is not a yes',
        rule: 'Must-haves are counted from the hotel source, which carries a facility list on every bed it returns — a hundred of a hundred in Bath. The catalogue runs to 820 facilities and 253 of them occur in Bath alone, including “Laundry washed per local authority guidelines”, so the screen is driven by a list of about a dozen things households actually decide on (`WANTS`) and the catalogue decides only which of them can be offered here. Each want matches several catalogue ids — a pool is an indoor pool and an outdoor pool and a rooftop pool. The open map’s own tags remain the fallback where there is no hotel source. Nice-to-haves reorder and never remove. The button carries the live count either way.',
        why: 'The last line of this entry used to read “LiteAPI’s list endpoint carries no facilities — the per-hotel detail call does, and that is a call per row”. That was measured and it is wrong: `facilityIds` and `hotelTypeId` arrive on every hotel in the list call the results page already makes, so proper facilities cost nothing at all. OpenStreetMap remains the fallback and its weakness is the reason to prefer the other: it has a tag for a pool and none for the absence of one, and in Windsor not one bed carries parking, so a strict filter would empty the list everywhere the map is thin. Where OSM is all there is, a must-have applies only where somebody around there has answered it, and the screen says so.',
        state: 'partial',
        where: 'apps/api/src/domain/stays.js · WANTS, wantsOnOffer · apps/api/src/sources/osm.js · stayAmenities · GET /api/stays/options',
        said: { who: 'the owner', on: '6 Sep 2026', words: 'I\u2019d like you to look at that and check whether those criteria are available on the API we have… and whether we\u2019re intelligent enough to remove asks when they\u2019re not viable.' },
      },
      {
        title: 'A filter earns its place by dividing the pool, not by existing',
        rule: 'The must-haves offered are counted from the beds already fetched for this patch of map. Anything no bed here has is never drawn — no bed near Thorpe Park has a sea view, so there is no sea-view chip, and no rule about coastlines was written. Anything nearly every bed has is not drawn either: 99 of the 100 beds in Bath have WiFi, so the chip would narrow the list by one. The exception is pool, kitchen and air conditioning, which are shown even at 100% because “all of them have one” is a real answer to a question somebody asked. Every chip carries the number of beds left if it is ticked.',
        why: 'The alternative was a rule per amenity — sea view needs a coast within so many miles, and so on — which is a list that is never finished, wrong at its edges, and still cannot answer what the household is really asking. Counting the pool answers both at once and costs nothing: no call is made that the list was not going to make anyway. It also generalises to any future source without a line of new logic.',
        state: 'live',
        where: 'apps/api/src/domain/stays.js · wantsOnOffer, DISCRIMINATING · apps/api/src/routes/stays.js',
        said: { who: 'the owner', on: '6 Sep 2026', words: 'this trip is the Thought Park, which is nowhere near the ocean, so there\u2019s no point in offering sea views.' },
      },
      {
        title: 'Where to stay is arithmetic on beds we hold, not an isochrone we buy',
        rule: 'Ranking a bed against several planned places is done from the beds already fetched: each one\u2019s estimated travel time to every plan, the median leg, and how many plans are within the walk. No isochrone provider is called. “Within 15 minutes of everything” is a filter on the furthest leg, which is already computed, and when nothing clears the bar the answer carries the best any bed manages so the screen can offer that number instead of an empty list.',
        why: 'Five 15-minute polygons intersected is the textbook answer and it buys nothing here: it is five provider calls for a region, when what is actually needed is an ordering of the forty beds already in memory. TravelTime is trial-only and sales-led (§11) and Google Routes\u2019 quota is spent, so the minutes are straight-line estimates and the screen says “about”. The cost of being wrong is a few minutes on a row; the day itself is routed properly when a place is added.',
        state: 'live',
        where: 'apps/api/src/domain/stays.js · rankStays, withinOfAll',
        said: { who: 'the owner', on: '6 Sep 2026', words: 'I\u2019d like to know what sort of technology you can develop to do that and do it at speed.' },
      },
      {
        title: 'The middle of several plans is the median, not the average',
        rule: 'The point a stay search is measured from is the geometric median of the planned places — the point with the least total travel to all of them — found by Weiszfeld\u2019s algorithm starting from the mean. Two plans or fewer fall back to the midpoint, which is the same thing.',
        why: 'The mean is not the middle. Five things in Bath plus one day trip to Bristol drags the mean a third of the way to Bristol, where a hotel is wrong for five days out of six; the median stays in Bath and cuts total travel across that trip from 29.5km to 19.2km. One outlier pulls on the median once instead of once per mile. A thousand solves take five milliseconds, so there is nothing to wait for and no call to make.',
        state: 'live',
        where: 'apps/api/src/domain/stays.js · centreOfPlans',
        said: { who: 'the owner', on: '6 Sep 2026', words: 'If there\u2019s 1 that\u2019s in the centre of them all, that would be better.' },
      },
      {
        title: 'Where it should be is several conditions at once, not one of three boxes',
        rule: 'Near my plans, near the town and near a station decide what the list is **ranked** by. Each condition — minutes to your plans, minutes to the centre, walk to a platform, minutes on the train — applies whenever it was asked for, whatever the ranking is. “Under 20 minutes from the centre and under a 10-minute walk to the station” is one search. `criteria.applied` says which conditions actually ran.',
        why: 'The three tiles read as three questions and they are one question with several answers. Until this, each condition was applied only when its own tile happened to be selected, so a household could have one or the other and never both. `criteria.applied` exists because the sheet has a number in every box whether or not it is doing anything, and reading “20 min” over a list that was never filtered by it is being misled.',
        state: 'live',
        where: 'apps/api/src/routes/trips.js · GET /:id/stays',
        said: { who: 'the owner', on: '6 Sep 2026', words: 'I want to have a place that\u2019s less than 20 minutes\u2019 travel to the centre of whatever town, and I want it to be less than a 10-minute walk to the train station.' },
      },
      {
        title: 'Stations are held, not asked for',
        rule: 'Every station, tube stop, tram stop and light-rail stop is harvested from OpenStreetMap into `transit_stops` and read from Postgres with a bounding box. Britain is about 3,500 rows. Overpass is still where the data comes from, but it is off the path a search takes: an area nobody has harvested falls back to one live lookup, writes down what comes back, and is a database read from then on. When that fallback fails too, whatever we already hold is returned rather than an exception.',
        why: 'A screen that cannot draw a list unless somebody else\u2019s free server is having a good afternoon is not fit for purpose, and no amount of choosing between mirrors fixes it — on 6 Sep 2026 three of the four public mirrors were failing at once. This is open data under ODbL, which CLAUDE.md lists among the sources we may keep for good, and 3,500 rows is a rounding error next to the atlas. The cost is that a station opened this month is missing until the next harvest, which for a table of railway stations is the right trade.',
        state: 'live',
        where: 'apps/api/migrations/058_transit_stops.sql \u00b7 apps/api/src/repositories/transit.js \u00b7 sources/where.js \u00b7 stationsNear',
        said: { who: 'the owner', on: '6 Sep 2026', words: 'it needs to be reliable. If it\u2019s not reliable, it\u2019s not fit for purpose.' },
      },
      {
        title: 'Never looked here is a different answer from nothing here',
        rule: '`transit_coverage` records which cells have been harvested. No row for a point means we have never looked, and the search falls back to a live lookup; a row saying zero stops means we looked and there are none. A station condition that cannot be evaluated is dropped and reported (`criteria.stationsUnavailable`), never failed by every bed.',
        why: 'Confusing those two is the exact bug that shipped. `stationsNear` swallowed every error and returned an empty list; the empty list then failed every bed\u2019s walk test; and an Overpass outage read on screen as "nowhere near here is by a station". Bath Spa is a main line station and the tile found nothing. The same rule the must-haves already follow: a question nobody has answered is not a question every candidate fails.',
        state: 'live',
        where: 'apps/api/migrations/058_transit_stops.sql \u00b7 apps/api/src/routes/trips.js \u00b7 GET /:id/stays',
      },
      {
        title: 'A tram stop is not a station, and both are worth offering',
        rule: 'Four kinds are kept apart — rail, subway, tram, light_rail — and all four count as "near a station" by default, narrowable with `stationKinds`. Trams come from `railway=tram_stop`, which nothing had ever asked for: Manchester used to return nine stops, every one of them heavy rail, with Metrolink invisible. Rides wearing the same tag are excluded by one shared classifier — miniature, funicular, cable car, heritage, disused, and anything under a metre of gauge.',
        why: '"Ten minutes from a tram stop" and "ten minutes from a station" are different promises and a household choosing where to sleep is entitled to know which they are being offered. The exclusions matter as much: `railway=station` covers Legoland\u2019s Hill Train, and a bed ranked "4 min walk to Hill Train Bottom \u00b7 about 21 min by train" is nonsense dressed up as a fact. One classifier, under test, used by the harvest and by everything reading it — `osmStation` had its own and no sieve at all.',
        state: 'live',
        where: 'apps/api/src/sources/transit.js \u00b7 isServiceStop, kindOf, dedupe',
        said: { who: 'the owner', on: '6 Sep 2026', words: 'fix it all end to end, add trams as well' },
      },
      {
        title: 'The harvest is resumable, and a cell nobody will answer is not fatal',
        rule: 'A region is cut into cells and each is fetched with a pause between. Every cell is recorded on its own and skipped on a re-run, so an interrupted harvest is finished by running it again. A cell no mirror answers is skipped and left uncovered, so the live fallback fills it in later; the region as a whole is only claimed when every cell answered. The API continues it in four-minute slices while it is up, so nobody has to remember to press anything.',
        why: 'Britain is fifty-odd cells and on a bad afternoon for the mirrors that is hours, spread across deploys that land minutes apart. Claiming a region on a partial run would tell the fallback a hole had been filled and it would never be looked at again — which is the one failure this whole table exists to prevent.',
        state: 'live',
        where: 'apps/api/src/sources/transit.js \u00b7 harvestRegion, resumeHarvest \u00b7 POST /api/stays/transit/harvest',
      },
      {
        title: 'One list of Overpass mirrors, and a mirror that refuses gets ten minutes off',
        rule: 'Every Overpass caller shares one list of four mirrors, starts at whichever last answered, and rests one that refuses or hangs for ten minutes. One mirror is given twelve seconds on an interactive path; the background researchers wait far longer but take the same order and report back.',
        why: 'There were five copies of that loop and three of them still began with the two mirrors that are down — measured 6 Sep 2026: overpass-api.de fails in 3s, kumi.systems takes 40s to a timeout, private.coffee answers in 6–10s, osm.ch in 0.12s. The interactive search knew only the two dead ones and gave each thirty seconds, which is where the minute-long stay lookup came from. A worse trap followed: `overpass.osm.ch` was added on the strength of that 0.12s and it is a Switzerland-only extract — 200, fast, and empty for anywhere else, which is exactly what the health rules reward. It became preferred, the others rested behind it, and every search returned nothing. Only planet-wide instances belong on that list, and an answer with nothing in it no longer earns a mirror preference.',
        state: 'live',
        where: 'apps/api/src/sources/overpass.js · mirrorsInOrder, overpassQuery',
        said: { who: 'the owner', on: '6 Sep 2026', words: 'it\u2019s taking a long time to look up… Can you please check if that\u2019s a problem on our side or their API?' },
      },
      {
        title: 'A price from a sandbox key says so on the screen it appears on',
        rule: 'LiteAPI is currently on a sandbox key, which answers with invented hotels at invented prices. Every stay list says so above the rows. Where a live key prices some beds and not others, the line says how many were priced rather than leaving most of the list reading "no price for these nights". A stay with no guest rating shows the operator\u2019s star classification instead — a fact about the building, not a rented opinion.',
        why: 'A made-up number with nothing next to it is a lie, and it is the kind of lie somebody books a holiday on. The API has always reported `pricing.sandbox`; the sheet was ignoring it. Moving to a live key is the owner\u2019s — it holds a secret and it spends money.',
        state: 'partial',
        where: 'apps/api/src/sources/liteapi.js \u00b7 apps/web/src/screens/TripMapScreen.tsx \u00b7 StayList',
      },
      {
        title: 'The stay wizard is three steps, and the third is the list itself',
        rule: 'Where it should be (with the minutes attached to the answer they belong to), then budget and must-haves, then the ranked results. The three chips over the results re-open the step they came from. Every answer is in the address, so a worked-through set of criteria is a page somebody can be sent.',
        why: 'What counts as a reasonable price depends on whether you said “in the middle of my plans” or “anywhere with a station”, so the money cannot come first. Making the results the third step rather than a fourth screen means the wizard is never a thing you have to finish before you see anything.',
        state: 'live',
        where: 'apps/web/src/screens/TripMapScreen.tsx · StayCriteria',
      },
      {
        title: 'A spent quota is a fallback, not a failure',
        rule: 'When Google Routes refuses for want of quota, Epic stops asking for a while — per method, because the quotas are per method — and works every travel time out from the distance instead. Anything worked out that way is flagged, and the screen says so.',
        why: 'The alternative is a screen full of errors, or a retry loop that spends the next day’s quota the moment it resets. A journey with estimated times is still a usable journey.',
        state: 'live',
        where: 'apps/api/src/sources/routing.js',
      },
      {
        title: 'Adding an option must not add a provider call',
        rule: 'A day’s options are composed from one retrieved pool. Asking for another option re-sorts what was already fetched; it never goes back to a provider.',
        why: 'It is the difference between a planning session costing one search and costing fifteen. It also makes the options comparable — they came from the same pool.',
        state: 'live',
        where: 'apps/api/src/domain/options.js',
      },
      {
        title: 'Tripadvisor is opt-in per search',
        rule: 'It runs only when a search names it. Everything else uses the default set.',
        why: 'It bills per location returned — 1,000 free for life, then about 15 cents a search. That is the one source where an idle browse costs real money.',
        state: 'live',
        where: 'apps/api/src/sources/index.js',
      },
      {
        title: 'Every outbound call is attributed to a household and a session',
        rule: 'A row goes into `provider_calls` with the units it consumed, before anything is shown. Settings and Reporting read from that.',
        why: 'Without it, "what did this month cost" is a guess, and a source that starts misbehaving is invisible until the bill arrives.',
        state: 'live',
        where: 'apps/api/src/sources/meter.js',
      },
    ],
  },
  {
    key: 'data',
    title: 'Where the data comes from, and what it costs',
    blurb: 'Measured on 19 September 2026 against ten real places and the whole of SL5, not modelled. The question underneath it is whether the bill grows with the users or flattens.',
    icon: 'web',
    decisions: [
      {
        title: 'What a fact actually costs, measured',
        rule: 'A Google Place Details request is $0.032 — about 2.5p — and is paid again every time it is asked. A Claude web-research pass over one place is $0.1476, about 11.7p, and is paid once. OpenStreetMap, the venue’s own published page and the encyclopedias are free.',
        why: 'These are read back out of `provider_calls` from a run of ten production places, not taken from a rate card. They replace the working estimate of 1p a Google look, which was two and a half times under. The free sources are not a cheaper Google: they are the only layer we are allowed to keep, and all 3,090 owned records we hold were built from them — provenance is OSM 18,636 facts, the venues’ own sites 13,529, Wikipedia 887, and Claude none.',
        state: 'live',
        where: 'bench-data.mjs · apps/api/src/sources/pricing.js · apps/api/src/domain/providerPrices.js',
        said: { who: 'the owner', on: '19 Sep 2026', words: 'These locations get searched 20 times a month, and it costs us 1p each time, but it would cost us 10p to do an Anthropic search to be able to get the data we need.' },
      },
      {
        title: 'Google is the only source of a photograph or a rating, so Google is always called',
        rule: 'Photographs and ratings come from Google on every look, and are never written down. No other source is asked for them.',
        why: 'On the ten-place bench, Google held a rating and a photograph for all of them and every other source held neither, for either — nothing in OpenStreetMap, on a venue’s own page, or reachable by web search replaces them. Photographs decide whether an activity is worth tapping and ratings decide whether a restaurant is; both are essential, and both are rented. This is the cost that does not fall however good our own research gets.',
        state: 'live',
        where: 'apps/api/src/sources/google.js · apps/api/src/sources/rentedPhoto.js · apps/api/src/sources/rentedRating.js',
        said: { who: 'the owner', on: '19 Sep 2026', words: 'Photos are absolutely essential to our business… with restaurants, the reviews are absolutely essential to our business. I think in both instances, we’re always going to be calling Google.' },
      },
      {
        title: 'A third of the Google bill falls away; about half of it never will',
        rule: 'Of $365 spent with Google between 3 and 19 September, roughly $120 is one-off collection that goes to nothing as coverage fills, roughly $172 is photographs and ratings that must be re-bought for ever, and the rest is live querying that scales with the number of households.',
        why: 'It is the difference between a bill that flattens and one that grows. The collection third is already falling: every one of the 2,803 Google identifiers we hold has an owned record beside it, so that place is not seeded twice. The rented half is `atlas.rating` at $144 and the photo lines at $27, and the only lever on it is deciding to show something other than Google’s number.',
        state: 'live',
        where: 'apps/api/src/routes/demand.js · /admin/reporting',
      },
      {
        title: 'Google is asked first; the open map is asked because it holds what Google will not return',
        rule: 'Every search goes to Google. The free sources keep running alongside it, not to save money but because three things never arrive from Google at all: a postcode as a field, a link to a menu, and about a third more places than its own sweep returns.',
        why: 'On the bench Google returned a postcode for none of the eight places and a menu link for none; the open map supplied a postcode for 32 of the 44 SL5 places both sources hold, and a phone number for 18 where Google’s was empty. Postcodes are what the reachability matrix, the area pages and the sweep are all keyed on, and menu links are the whole of menu → order → stars. They cost nothing, so there is no saving in switching them off — only the loss of the owned layer and of everything that has to work with no signal.',
        state: 'live',
        where: 'apps/api/src/sources/own.js · apps/api/src/sources/osm.js · apps/web/src/offline/policy.ts',
        said: { who: 'the owner', on: '19 Sep 2026', words: 'We will just revert to only using APIs and not bother calling other sources unless there is data that Google does not return.' },
      },
      {
        title: 'SL5, asked of both: Google found 113, the open map found 53 more',
        rule: 'A full sweep of SL5 — twelve Text Search requests over food and things to do, 3.2km around Ascot — returned 113 places for $0.38. The same box asked of the open map returned 94 named places for nothing, of which about 50 were places the Google sweep had not returned.',
        why: 'The ones Google missed are weighted to exactly the tab where a photograph matters most: Wentworth Club, Swinley Forest and Royal Ascot golf clubs, Smith’s Lawn polo grounds, Royal Ascot Cricket Club, the Novello Theatre, Englemere Pond nature reserve, Heather Garden. A place we never learn about is a place we never fetch a photograph for. The figure is approximate in one direction only — the diff is matched on name and distance, so a handful of the 53 are the same place under two spellings, and some (blue plaques, a public bookcase) are not places a household would visit.',
        state: 'live',
        where: 'sl5.mjs · apps/api/src/sources/overpass.js · apps/api/src/sources/google.js · sweepArea',
        said: { who: 'the owner', on: '19 Sep 2026', words: 'If we look at an area like SL5 and we literally just ask Google for everything, then can we do other searches to find what’s missing from Google that we can find via other means?' },
      },
      {
        title: 'Research costs 11.7p, so it waits until a place has been looked at more than once',
        rule: 'The Claude research pass is not run on discovery. It is meant to run once a place has been looked at enough times to have paid for itself — about seven looks at today’s prices — and the search log is what will say which places those are.',
        why: 'Researching everything in the index up front is about £3,300 and mostly waste, because most places will never be opened. A place looked at once is not worth 11.7p; a place looked at seven times has already cost more than that in Google requests. The threshold cannot be set from evidence yet: `searches` only began logging on 19 September 2026 and none of it can be backfilled, so the "20 times a month" this is all argued from is still an assumption.',
        state: 'planned',
        where: 'apps/api/migrations/143_a_search_that_found_nothing_is_written_down.sql · /admin/demand',
        said: { who: 'the owner', on: '19 Sep 2026', words: 'Eventually, we may start finding that 10% of our places represent 70% of our search volume, and we could start to build out our own data sources, which I think would be very valuable.' },
      },
      {
        title: 'Our own research is wrong often enough to need checking against something',
        rule: 'Facts taken from the open map and from a venue’s own page are held with the source they came from, and a match that cannot be settled is left unmatched rather than guessed.',
        why: 'Two of the eight bench places carried a wrong postcode in the owned record — the open map had matched a neighbouring branch — and both times Google and a web-search pass agreed with each other against us. Summaries scraped from a venue’s own page arrive as raw markup ("Young&#039;s", "WELCOME TOTHE WHITE HARTE WELCOME TO…") and are not publishable prose. This is the cleansing cost of owning data, and it is real rather than theoretical.',
        state: 'partial',
        where: 'apps/api/src/sources/openMatch.js · apps/api/src/sources/site.js · apps/api/src/sources/own.js',
      },
    ],
  },
  {
    key: 'speed',
    title: 'How fast it is, and what makes it slow',
    blurb: 'A screen that takes three seconds is a different product from one that takes half of one. These are the rules that decide which it is, and the numbers they were decided on.',
    icon: 'search',
    decisions: [
      {
        title: 'The map is worked out once, not on every search',
        rule: 'Every place Epic holds is given a postcode sector \u2014 SL4 1, the district plus one character \u2014 and the travel time between every pair of sectors within ninety minutes is worked out once and kept. A catchment is then a lookup rather than a calculation: everything within thirty minutes of Windsor comes back in about two milliseconds, with no arithmetic and no provider call. The matrix is the filter; a list is still ordered by the exact distance to each place, so being a little generous at the edge costs nothing.',
        why: 'A distance worked out for every row cannot survive millions of rows in several countries. Measured on the first build: 1,296 places fell into 590 sectors, 244,798 pairs, six seconds to build, and 1.5\u20133ms to answer. Times are Epic\u2019s own estimate rather than a route over real roads \u2014 deliberately the same function every list is already fenced with, because a matrix that disagreed with the fence would offer a place the next pass then threw away. A road-network build can replace a region\u2019s rows without anything else changing; every row says which it is.',
        state: 'live',
        where: 'apps/api/src/domain/reach.js \u00b7 apps/api/src/repositories/reach.js \u00b7 migration 139',
        said: {
          who: 'Roger', on: '17 Sep 2026',
          words: 'instead of having to do map distance calculations every time someone does a search, we will already hold and know instantly which activities are within their particular area.',
        },
      },
      {
        title: 'A source too slow to wait for is not a source to drop',
        rule: 'Overpass is marked slow by nature. Once something useful has arrived and every other source has settled, the search answers without it \u2014 but its work carries on, and when it lands the fuller answer replaces what the cache holds. The first look is fast; the next look at the same place is fast and complete.',
        why: 'Measured on production, 6 Sep 2026: Overpass answered three tries in five, at 5.0s, 7.2s and 9.8s, and ran out its cap on the other two \u2014 while returning 120 restaurants in central Manchester where Google returns 7. Too slow to wait for, too good to drop. Before this, every search paid for it and then gave up: with the flag the fan-out answers in 21ms, without it 2,521ms, and not one of those 120 had ever reached a screen.',
        state: 'live',
        where: 'apps/api/src/sources/index.js \u00b7 settleBy, `settling` \u00b7 apps/api/src/sources/osm.js \u00b7 apps/api/src/sources/cache.js',
      },
      {
        title: 'The grace window is for a source that is merely late',
        rule: 'When the first useful answer arrives, the rest get two and a half seconds to join. That window is deliberately not shortened.',
        why: 'It was shortened once and the same search fell from twenty-five places to ten, because it cut sources that were only having a bad second. The fix for the one source that is slow by nature belongs on that source, not on everybody \u2014 which is what the rule above is.',
        state: 'live',
        where: 'apps/api/src/sources/index.js \u00b7 GRACE_MS',
      },
      {
        title: 'Every search goes through the cache \u2014 including the one that did not',
        rule: 'A search is held for twelve hours and a second search for the same area, radius, words and sources is answered from it. Two screens asking at once join one search rather than running two. Only the call that actually fetched is billed to the household.',
        why: 'Places was the last path calling the sources directly, so looking at the same area twice in an afternoon asked Google twice and billed twice \u2014 for an answer that was in memory the whole time. Plan, the taste tables and a trip\u2019s Find tab had gone through the cache since it was written.',
        state: 'live',
        where: 'apps/api/src/routes/places.js \u00b7 apps/api/src/sources/cache.js',
      },
      {
        title: 'What the screens actually take',
        rule: 'Measured against production on 6 Sep 2026: home 0.17s, Places 0.09s, the atlas 0.16s, a place drawer 0.29s, directions 0.22s, a photograph 0.16\u20130.37s cold and 0.07s once held. A first search of an area is about half a second; the same search again is instant.',
        why: 'Written down because \u201cit feels slow\u201d and \u201cit is slow\u201d are different claims and only one of them names a number. The pattern is the point: everything that reads Epic\u2019s own data is one indexed query and lands under 300ms, and all the time that is left is in the calls that leave the building. That is what makes it worth spending effort on the fan-out rather than on the screens.',
        state: 'live',
        where: 'apps/api/src/routes/inspire.js \u00b7 routes/atlas.js \u00b7 routes/places.js',
      },
      {
        title: 'A page cap decides which hundred and twenty, not which places matter',
        rule: 'A search returns at most 120 places. When there are more, the ones we know something about \u2014 a rating, a review count \u2014 are kept before the ones we do not, and the page is then ordered by distance as before.',
        why: 'Taking the nearest 120 was fine until OpenStreetMap started arriving. It knows 120 restaurants within four kilometres of central Manchester and Google knows seven, so by distance alone the seven with a rating and a photograph fell off the end: the screen became 120 names with nothing to choose between them, and Dishoom \u2014 4.8 from ten thousand people \u2014 was not on it. Making a source answer is what exposed the cap as a judgement rather than a limit.',
        state: 'live',
        where: 'apps/api/src/routes/places.js',
      },
      {
        title: 'A search is held for twelve hours, in memory, and a restart empties it',
        rule: 'The same point, radius, words, source set and event window is the same search, and it is answered from what is held for twelve hours \u2014 in memory only. It is never written to disk, so every deploy or restart of the API starts it empty again.',
        why: 'Not an oversight and not a thing to fix: Google\u2019s display content has a retention allowance of *none* (\u00a74). Holding it in memory to draw the screen in front of somebody is what we are allowed to do; writing it down is not. So on a day of deploys a search that was held an hour ago will be asked again, and on an ordinary day it will not. What does survive a restart is the household\u2019s own records \u2014 which is why Find falls back to them rather than to a blank screen.',
        state: 'live',
        where: 'apps/api/src/sources/cache.js \u00b7 docs/technical-constraints.md \u00a74',
        said: { who: 'the owner', on: '7 Sep 2026', words: 'I just want to make sure that we are caching this data for 8 hours. If I do the same search again, we should not have to start calling APIs again.' },
      },
      {
        title: 'A screen gets a clock; a background sweep does not',
        rule: 'Every search somebody is waiting on \u2014 a trip\u2019s Find tab, Browse along the way, the Plan screen\u2019s pool, the taste tables, Places \u2014 passes a deadline. A search filling a cache in the background passes none, and waits for everything.',
        why: 'Passing no deadline means \u201cgive me everything, however long it takes\u201d, which is right for a sweep and wrong for a tab somebody has just tapped. Four paths were doing it because there was nothing to write instead: the Find tab measured 11.1 seconds on a cold search and 0.78 after. The second and third look were 90ms either way \u2014 the cache was never the problem, the first look was.',
        state: 'live',
        where: 'apps/api/src/sources/index.js \u00b7 SCREEN_DEADLINE_MS',
      },
      {
        title: 'A slow source is told apart from a broken one',
        rule: 'A source we chose not to wait for is recorded as `slow`, not as a failure. The cache keeps a degraded answer for ten minutes but a merely-slow one for the full twelve hours.',
        why: 'They look identical on screen and mean opposite things. Treating \u201cwe did not wait\u201d as \u201cit let us down\u201d would re-ask Google every ten minutes all afternoon for a search that was already answered.',
        state: 'live',
        where: 'apps/api/src/sources/index.js \u00b7 apps/api/src/sources/cache.js',
      },
    ],
  },
  {
    key: 'licence',
    title: 'What we may keep, and what is only rented',
    blurb: 'The difference between the two layers is the thing most likely to be broken by accident, because both look like "a place" on screen.',
    icon: 'locked',
    decisions: [
      {
        title: 'Their stars become our word, and the word is what we keep',
        rule: 'A provider\u2019s rating is turned into one of four words \u2014 top, high, good, mixed \u2014 at the moment of the call, and the figure is discarded there. What is kept is our own composite out of ten, built from that word, how many people spoke, the accolades anybody independent has given the place, and how much we actually own about it. A second number is kept beside it with the crowd taken out altogether. Nothing recalculates by adjusting: the score is a pure function of the evidence in front of it, so every sweep works it out from scratch.',
        why: 'The owner asked how a score could be updated three months later if the original rating was never kept. The answer is that nothing is ever updated \u2014 it is recomputed. The word cannot be read backwards into the figure, which is what makes it ours; the second number is the proof that the ranking survives a provider going dark. Few voices are pulled towards the average, because a 5.0 from eleven diners is not better than a 4.6 from two thousand.',
        state: 'live',
        where: 'apps/api/src/domain/scoring.js \u00b7 crowdBand(), countBand(), score()',
        said: {
          who: 'Roger', on: '17 Sep 2026',
          words: 'I thought we were going to be taking all the providers\u2019 stars and come up with our own rating, which we can retain. I should be able to then run an order of how that\u2019s calculated, even if that means hitting the same APIs again to recalculate it. Show me the calculation logic.',
        },
      },
      {
        title: 'The score shows its working',
        rule: 'Any place\u2019s score can be opened: what went in, what each part was worth, what it was weighted by, what it contributed, and the two numbers out. The weights are read out of the scoring module rather than written into the screen. What is deliberately absent is a star rating \u2014 there is nothing behind the word to show, because the figure was never kept.',
        why: 'A ranking nobody can argue with is a ranking nobody can correct. The working has to add up to the number it claims to explain, which it did not at first: two accolades worth 0.98 printed as 1.0 and the total came out a tenth high \u2014 exactly the sort of thing nobody notices until they are disagreeing with a score and cannot see why.',
        state: 'partial',
        where: 'apps/api/src/domain/scoring.js \u00b7 workings() \u00b7 GET /api/admin/score?ref= \u00b7 the screen is not drawn yet',
      },
      {
        title: 'Rented and owned are two different layers',
        rule: 'A household act — shortlist, save, special, visited — claims a place. Epic then researches it from OpenStreetMap, the venue’s own published page and the open encyclopedias, and that research is kept for good. A provider’s name, hours, reviews, photos or rating is never written down.',
        why: 'The licences we hold permit keeping an identifier indefinitely and keeping what we generated ourselves. They do not permit keeping display content. When a drawer needs a fact that survives the signal going, it comes from the owned record.',
        state: 'live',
        where: 'apps/api/src/sources/own.js · docs/technical-constraints.md §13.10',
      },
      {
        title: 'The place ID is the join, and it is the one field we may keep for ever',
        rule: 'An owned record is keyed by the provider\u2019s identifier \u2014 `google:ChIJ\u2026`. Everything factual about the place (name, category, cuisine, diets, hours, address, phone, postcode, nearest station) is researched from open sources and stored against that key. Everything the provider sells (rating, review count, photographs) is fetched against the same key at display and dropped.',
        why: 'It is what makes the two layers meet without mixing. Amalfi on the atlas: its name, W1F and Oxford Circus 150m away are ours for good and work with no signal; its 4.8 stars, 17,191 reviews and its photograph are Google\u2019s and are drawn fresh every time. Google\u2019s retention allowance is place IDs indefinitely, coordinates thirty days, display fields none \u2014 so the identifier is the only thing there is to build on.',
        state: 'live',
        where: 'apps/api/migrations/021_owned_places.sql \u00b7 apps/api/src/sources/own.js \u00b7 docs/technical-constraints.md \u00a74',
      },
      {
        title: 'A device may hold less than the server may',
        rule: 'Every answer passes one file before it is written to the phone. An endpoint not named there is not saved — the fallback is to keep nothing, never to keep it unless it looks licensed.',
        why: 'A phone in a pocket is somewhere we cannot reach to delete anything from, so the rule there is stricter than the rule on the server.',
        state: 'live',
        where: 'apps/web/src/offline/policy.ts',
      },
      {
        title: 'One name is still stored that should not be',
        rule: '`trip_stops.venue_name` holds the household’s name for a stop, including for places that came from a licensed source. It was written as a fixtures-only exception and must become fetch-at-display.',
        why: 'Recorded here rather than left as a comment in a migration, because it is the one known gap in the rule above and it is easy to forget it exists.',
        state: 'partial',
        where: 'apps/api/migrations/001_init.sql · CLAUDE.md',
      },
      {
        title: 'The web bundle never holds a provider key',
        rule: 'Every third-party call goes through the API. `EXPO_PUBLIC_*` values are inlined at build time and are public by definition, so nothing secret is ever one of them.',
        why: 'A key in the bundle is a key on every device that has ever loaded the app, and it cannot be taken back.',
        state: 'live',
        where: 'docs/technical-constraints.md §13.7',
      },
    ],
  },
  {
    key: 'decides',
    title: 'How Epic decides',
    blurb: 'The rules behind the words on screen — what counts as a holiday, what a category means, what excludes a place and what merely ranks it.',
    icon: 'plan',
    decisions: [
      {
        title: 'How far away it is, measured against real roads rather than assumed',
        rule: 'Every list in Epic is fenced by one estimate of how long a journey takes, worked out from the distance and a speed that climbs as the journey lengthens. Those speeds are now fitted to 473 real road times rather than assumed: 32.5 km/h through a town, 102 on the open road, and a road 1.4 times the straight line \u2014 the measured figure, not the 1.25 that was there before. Walking, cycling and public transport are untouched, because only driving was measured.',
        why: 'The old numbers overstated three driving journeys in four \u2014 by five minutes at the median and by as much as thirty-five on a long one. Overstating a journey never shows a household a wrong number; it shows them **fewer places**, because the fence throws away whatever it thinks is out of reach. That is one fault behind two complaints that were treated as separate bugs: Crystal Palace on 6 September (one restaurant on a twenty-mile run) and Bristol on 12 September ("nothing matches" inside an hour). Tested on 393 further pairs from 90 origins the fit never saw: journeys overstated fall from 75% to 41%, and the share wrongly put out of reach at a five-minute allowance from 37% to 10%.',
        state: 'live',
        where: 'apps/api/src/domain/travel.js \u00b7 reach-fit2.mjs \u00b7 train.json + holdout.json',
        said: {
          who: 'Roger', on: '20 Sep 2026',
          words: 'It is a household-facing bug fix \u2014 Inspire and Places are under-showing today \u2014 so treat it that way.',
        },
      },
      {
        title: 'A straight line that crosses water is the one thing the estimate cannot fix',
        rule: 'About one pair in eight has a road more than 1.8 times its straight line \u2014 the Firth of Clyde, the Wester Ross sea lochs, the estuaries, the islands. Those journeys are understated, sometimes badly: twenty-one minutes for a drive that takes ninety. This is accepted as a known limitation rather than patched.',
        why: 'A hand-built coastline penalty is a bespoke geometry system that only ever approximates a road network, and the cases are a small, identifiable set. On the planning paths the exact pass buys a real road time for what is about to be shown and drops them; on the browsing paths there is no exact pass, so the number on screen is simply wrong for those places. A road network is the real fix and it is a separate decision.',
        state: 'partial',
        where: 'apps/api/src/domain/travel.js \u00b7 speedFor',
        said: {
          who: 'Roger', on: '20 Sep 2026',
          words: 'Accept it, don\u2019t build a crossing penalty \u2014 document them as a known limitation and leave it.',
        },
      },
      {
        title: 'Allergens exclude; dislikes rank',
        rule: 'An allergen takes a place out of the running entirely. A dislike moves it down the list and never removes it. They never share a control, a colour, or a code path.',
        why: 'They are different in kind, not in degree. Treating a dislike as an exclusion loses places the family would happily go to; treating an allergen as a ranking is dangerous.',
        state: 'live',
        where: 'apps/api/src/domain/ranking.js',
      },
      {
        title: 'A night away is what makes a holiday',
        rule: 'Trips is divided Day trips | Holidays on nights away. A trip that starts and ends on the same day is a day out, whatever it calls itself.',
        why: 'The handover left the rule open between distance and an overnight stay. An overnight stay is a fact already in the data; a distance would be a threshold somebody has to keep tuning.',
        state: 'live',
        where: 'apps/api/src/routes/trips.js · nightsOf()',
      },
      {
        title: 'An area gets a Hotels tab once it is somewhere you stay',
        rule: 'Activities and Food & drink always. Hotels appears when the household has kept somewhere to stay there, or has ever slept a night there.',
        why: 'Same reasoning as above — the fact rather than a guess about distance. Reading & around never gets one; Puglia got one on the first trip.',
        state: 'live',
        where: 'apps/api/src/routes/atlas.js · city.holiday',
      },
      {
        title: 'A place has one primary subcategory and any number of secondaries, and the mapping is taught',
        rule: 'A place is filed under exactly one primary subcategory and as many secondaries as its Google words point at (register A2, 28 Sep 2026; this replaced the old limit of two categories a place). Within one browsing session a place is shown once. Anything in `shelf_rules` beats the built-in tables, narrowest rule first.',
        why: 'A flat list of categories put anything arguably two things in four of them, and the home screen became the same places six times. The tables were also simply wrong in places — the atlas has one word for a Formula One circuit and a football ground — and re-guessing does not fix that; teaching it does.',
        state: 'live',
        where: 'apps/api/src/domain/moods.js · back office › Categories',
      },
      {
        title: 'A place is hidden only when something says the public cannot go',
        rule: 'Every atlas place carries a visiting verdict: yes, no, or null for "nobody has established it". Only a "no" is kept off the home screen. Null is the common answer and is shown. A verdict set by hand outranks the rule for good \u2014 a later pass never overwrites it.',
        why: 'The atlas is harvested from Wikidata, which measures how notable a building is, not whether you may walk into it \u2014 so the Culture row read Windsor Castle, then Bagshot Park Mansion, which is the Duke of Edinburgh\u2019s house. The tempting rule, hiding any country house nobody has vouched for, was run against the real table first: it would have hidden Chatsworth, Blenheim, Highclere, Leeds Castle and Hever Castle, because a summary that happens not to mention visiting is the ordinary case rather than a signal. Being wrong in the hiding direction is far worse than the bug it fixes, so the rule only ever answers when something answers it.',
        state: 'live',
        where: 'apps/api/src/domain/visiting.js \u00b7 back office \u203a Library',
        said: { who: 'Roger', on: '7 Sep 2026', words: 'That definitely needs to be fixed, and you need to put it into our knowledge bank in the admin section also.' },
      },
      {
        title: 'Four open sources decide it, and a refusal beats them all',
        rule: 'Wikidata types, the OpenStreetMap tags on the same feature, the categories on its Wikipedia article, and \u2014 only for a place we were already asking about \u2014 what Google calls it. A residential veto runs before any of them are allowed to say yes: access=private, access=no, or a building tagged as a dwelling with nothing public on it. Nothing downstream can undo a veto.',
        why: 'The complaint being guarded against can only come from a false yes, so one signal has to be able to overrule the rest. The four are complementary rather than redundant: Highclere Castle is "building=yes historic=castle" on the map and invisible as an attraction, but sits in "Historic house museums in Hampshire" on Wikipedia; Virginia Water Lake is the other way round. OpenStreetMap alone lifts the share of places with an answer from 39% to 85%. Note that access=customers is not a refusal \u2014 Kew Gardens is tagged that way and you buy a ticket.',
        state: 'live',
        where: 'apps/api/src/domain/visiting.js \u00b7 apps/api/src/sources/visitingEvidence.js',
      },
      {
        title: 'The join is the Wikidata id, not the OSM reference',
        rule: 'Atlas places are matched to OpenStreetMap by asking Overpass for features tagged wikidata=Q\u2026, in batches of fifty, and the tags that bear on access are stored.',
        why: 'Only 27 of 500 published attractions carry an OSM reference of their own, but every one carries a Wikidata id, and OSM features tag themselves. Asked that way, 79% of the places the rule could not settle turn out to have an OSM feature. Both sources are free, keyless and licensed for us to keep \u2014 ODbL and CC BY-SA \u2014 so the pass can run over the whole atlas without spending anything, and what comes back is stored so re-judging later costs nothing.',
        state: 'live',
        where: 'apps/api/src/sources/visitingEvidence.js \u00b7 back office \u203a Library',
      },
      {
        title: 'Google answers on a call we were already making, and only ever fills a gap',
        rule: 'The rating fetch that runs once per place on screen also asks for types and primaryType. Google can establish that a place is public; it is never allowed to conclude that one is private, and it never overturns an answer we already have. Only our own one-word conclusion is stored, tagged google.',
        why: 'Places bills a request once, at the highest tier any of its fields belong to \u2014 a rating is Enterprise and a type is Essentials \u2014 so the types cost nothing on a call that already asks for the rating. That means no bulk sweep, no new spend, and no traffic that needs explaining, because we only ask about a place we are about to show somebody. Google has no type for a house, so its silence is mostly a fact about Google: silence leaves the verdict unestablished rather than refused. None of their content is kept \u2014 no name, rating, hours, or the type list itself \u2014 and the rows it touched can be found and dropped in one statement by that one tag.',
        state: 'live',
        where: 'apps/api/src/sources/providerMatch.js \u00b7 noteGoogleVisiting()',
        said: { who: 'Roger', on: '7 Sep 2026', words: "I don't feel like there's a big deal with just checking the Google data to see whether it's a private residence or not, and then recording same or excluding it if it is a private residence." },
      },
      {
        title: 'What settles it is a type, not a sentence',
        rule: 'A place that is a museum, a park, a garden, a nature reserve or a castle is open by definition. A residence of the royal family that is not also a museum is closed \u2014 which separates Bagshot Park, Highgrove and Gatcombe Park from Windsor Castle, Sandringham and Osborne House in one line. Wording is read only where it states the case outright, and the open tests always run first.',
        why: 'Matching prose alone was tried and was dangerously wrong: it marked Osborne House, Bletchley Park, Broughton Castle and the Royal Pavilion as closed, all of them major attractions, because the words private, school and demolished appear in their histories. Wikidata types are stated facts; a Wikipedia sentence is a story. Of 193 published country houses the rule settles six, and each was checked by hand.',
        state: 'live',
        where: 'apps/api/src/domain/visiting.js \u00b7 OPEN_KINDS, CLOSED_KINDS',
      },
      {
        title: 'Voice is interpreted against a closed set that is on screen',
        rule: 'Speech is matched to the vocabulary the screen is already showing, and every voice action has a tap that produces the same state change.',
        why: 'An open-ended interpreter fails invisibly and cannot be corrected. A closed set can only fail in ways somebody can see and fix by tapping.',
        state: 'live',
        where: 'apps/web/src/hooks/useSpeech.ts',
      },
      {
        title: 'Red means danger, and never anything else',
        rule: 'Red is kept for allergen and overrun warnings, the one Stop while a household is speaking, and — in the back office — what is broken: a stalled check, a failing source, accuracy under 90%, a destructive confirm. The loved heart is ink since the rebrand (7 Sep 2026). Counts, statuses and totals are never red.',
        why: 'A colour that means five things means nothing. Danger is the one meaning worth a colour of its own; everything that merely wants attention is amber.',
        state: 'live',
        where: 'apps/web/src/theme.ts',
      },
    ],
  },
  {
    key: 'pictures',
    title: 'Pictures',
    blurb: 'Why some places have a photograph, some have a logo, and some have neither — and why there is no bank of stock food photography.',
    icon: 'camera',
    decisions: [
      {
        title: 'The ladder, and the floor underneath it',
        rule: 'For each place, in order: a photograph the household took, the business’s own published mark, a Wikimedia Commons photograph, a street-level frame of the shopfront from KartaView or Mapillary. If none of those, the category icon on the lime ground.',
        why: 'The delivery apps have one food photo each because the restaurant uploaded it under a contract. We have no such contract, so we go and find the pictures that are already ours to hold. The icon floor is honest by construction — nobody reads it as a photograph of that restaurant’s food.',
        state: 'live',
        where: 'apps/api/src/sources/placePicture.js',
        said: { who: 'the owner', on: '5 Sep 2026', words: 'The only other option is to use generic images (a huge bank) and just mix and match them for all the different restaurants, but that’s a bit misleading.' },
      },
      {
        title: 'Where we own nothing, the provider\u2019s photograph is shown and never kept',
        rule: 'A card prefers our own picture. Where the ladder has found nothing and the place is a licensed one, the provider\u2019s photograph is drawn instead \u2014 fetched at display, never written to the database, and stripped before anything reaches a device. Where a search from the last twelve hours already carried the reference, it costs no call at all. The day the ladder finds a mark for that place, this stops being asked for it.',
        why: 'The ladder finds nothing for most restaurants \u2014 Commons does not photograph the inside of a curry house \u2014 and the alternative was a wall of lime squares. Offline the card falls back to its category icon, which is the honest thing for it to draw: we do not have that picture, we were only ever allowed to look at it.',
        state: 'live',
        where: 'apps/api/src/sources/rentedPhoto.js \u00b7 apps/web/src/offline/policy.ts \u00b7 cleanPlaceRow',
        said: { who: 'the owner', on: '5 Sep 2026', words: 'It means at least that we can have restaurant pictures, which is really useful in some instances.' },
      },
      {
        title: 'A street-level frame has to be of the place, not of the street',
        rule: 'The street rung admits a frame only within 15\u00b0 of the venue and 22m of it. Everything found under the older, looser geometry \u2014 38\u00b0 and 60m \u2014 has been retracted, and those places draw their icon until something better is found.',
        why: 'At 60m, \u201cinside the frame\u201d means somewhere in a photograph of an entire street. The first fourteen were photographs of roads: one was a wet road, a hedge and a windscreen wiper with no building in it. Nine were still on cards after the geometry was tightened, because tightening the rule does not retract what it already let through. The yield falls a long way and should \u2014 the icon is a better answer than somebody\u2019s hedge.',
        state: 'live',
        where: 'apps/api/src/sources/streetLevel.js \u00b7 image_assets.moderation',
        said: { who: 'the owner', on: '6 Sep 2026', words: 'It\u2019s not going to showcase our app if the screens look rubbish\u2026 I think we need to source them from somewhere, not have pictures of streets. That\u2019s not okay.' },
      },
      {
        title: 'A mark is drawn differently from a photograph',
        rule: 'A photograph fills its tile. A logo is contained on the lime ground with room around it. On an area or a trip tile, a photograph is preferred over a mark even when the mark is closer to hand.',
        why: 'Cropping a square logo to fill a wide tile turns a wordmark into a smear. And a restaurant’s blue square says nothing at all about Puglia.',
        state: 'live',
        where: 'apps/web/src/components/VenueThumb.tsx',
      },
      {
        title: 'A credit is a condition, not a nicety',
        rule: 'Where the licence requires it, the credit line is drawn with the picture, by the component that draws the picture.',
        why: 'For every licence but CC0 and public domain, the picture without the line is the licence broken. Putting it in the component rather than in each caller is what stops one screen forgetting.',
        state: 'live',
        where: 'apps/web/src/components/VenueThumb.tsx',
      },
    ],
  },
  {
    key: 'owed',
    title: 'What we owe',
    blurb: 'Obligations this platform has taken on and has not finished. A thing we have not done is said here plainly rather than left off \u2014 the same rule as everything above it.',
    icon: 'alert',
    decisions: [
      {
        title: 'The privacy notice has to say that searches are recorded',
        rule: 'Every search a household makes is recorded against the account that made it: where, what was asked for, what came back, and what they did next. The notice must say so plainly, and say what it is used for.',
        why: 'Recording it against an account is what makes it possible to understand one person\u2019s experience rather than an average, and to follow up with them. It is also personal data, and a notice that does not mention it is what would make the whole log unusable.',
        state: 'planned',
        where: 'the notice itself \u00b7 the log will be written in apps/api/src/routes/discover.js',
        said: {
          who: 'Roger', on: '17 Sep 2026',
          words: 'Are we allowed to retain what account ID did what search? If so, I\u2019d like to do so\u2026 It would just be nice to understand specific user behaviours and then also to be able to target them with specific communication to help their user experience, or maybe follow up with surveys.',
        },
      },
      {
        title: 'Marketing off the back of behaviour needs its own permission',
        rule: 'Analytics and marketing are two different permissions. Using what somebody searched for to send them a message or a survey is direct marketing, and needs consent or the soft opt-in \u2014 an existing customer, a similar product, and an unsubscribe in every message. The flag is built with the search log, not after it.',
        why: 'The data and the permission have to arrive together. Building the log first and the consent afterwards means that on the day the first survey goes out, Epic holds the data and not the right to use it.',
        state: 'planned',
        where: 'accounts.marketing_opt_in \u00b7 not built',
      },
      {
        title: 'A legitimate-interests assessment, written once',
        rule: 'Recording identified searches for product analytics rests on legitimate interests. That has to be assessed and written down \u2014 about two pages \u2014 rather than assumed.',
        why: 'It is the document that gets asked for if anybody ever asks, and it takes an afternoon before there is a log and a great deal longer after there is one.',
        state: 'planned',
      },
      {
        title: 'Erasure has to reach the search log',
        rule: 'Deleting a household takes its searches with it; deleting an account leaves the counts and removes the person. Export has to include both.',
        why: 'A right to be forgotten that stops at the tables somebody remembered to think about is not one.',
        state: 'planned',
        where: 'searches.household_id cascades \u00b7 searches.account_id sets null \u00b7 not built',
      },
      {
        title: 'Every search is kept, until keeping them stops being sensible',
        rule: 'All searches are retained for now, by the owner\u2019s decision. The path that rolls old ones up into counts and drops the detail is built at the same time and left switched off, with the row count that should trigger it named.',
        why: 'Building the switch now means throwing the lever later is a setting rather than a migration written under pressure.',
        state: 'planned',
        said: {
          who: 'Roger', on: '17 Sep 2026',
          words: 'I think we should retain all searches for now, but once that starts to become too big, then we can certainly start to remove or aggregate the data.',
        },
      },
      {
        title: 'Household-made content is not reviewed by anybody yet',
        rule: 'Photographs, reviews, ratings and notes that households make need one queue where they can be filtered, approved or rejected, with the reason from a closed list and a message the person actually receives. Reported content jumps it.',
        why: 'Until it exists, anything a household submits either appears unreviewed or sits where nobody looks, and both are worse than a queue.',
        state: 'planned',
        where: 'not built \u00b7 the atlas\u2019s Uploads section is the only part of it that exists',
      },
      {
        title: 'A provider\u2019s content is being kept on a saved place',
        rule: 'When a household saves a place, the whole search result is sent up and stored on the saved row, and that row has no expiry. For a Google place that means their name, address, opening hours and rating are held indefinitely \u2014 which is the one thing the licence does not allow. Only what is ours may be kept there: where it is, what kind of place it is, the household\u2019s own note, and a name from OpenStreetMap.',
        why: 'Found 17 Sep 2026 while auditing where ratings are persisted. Not patched on the spot because the fix changes where Places, the shortlist and a trip\u2019s stops get their labels from, and the owned record that replaces it is being built as part of the places work.',
        state: 'planned',
        where: 'apps/web/src/screens/PlacesScreen.tsx \u00b7 apps/api/src/routes/places.js \u00b7 apps/api/src/repositories/atlas.js \u00b7 household_places.venue',
      },
      {
        title: 'Which credentials gate which host categories is not set',
        rule: 'Every credential type ships as a badge and nothing is blocked at Publish, because the gates are empty. Food registration is the law for cooking for paying guests and not for a wine-tasting walk, and a browse category is too coarse a net to say so.',
        why: 'Parked by the owner on 17 Sep 2026 \u2014 but while it is empty Epic is not checking, and the terms have to put compliance on the host.',
        state: 'planned',
        where: 'Back office \u203a Skills \u203a Credentials \u00b7 gates_categories is empty on every type',
      },
      {
        title: 'Four things outside the repo are still called Roam',
        rule: 'The ROAM_* variables in Doppler, aliased for now by env.js; the Railpack commands on Railway; the Railway project and service names; and a local .env.',
        why: 'The rebrand was September 2026, and these are the parts an agent cannot change: they hold secrets, or they are platform configuration.',
        state: 'planned',
        where: 'README \u203a The rebrand: what is still called Roam',
      },
      {
        title: 'Heritage Crafts have not been asked about the Red List',
        rule: 'The host skills vocabulary leans on the Heritage Crafts Red List. They should be e-mailed and asked how they would like it referenced.',
        why: 'Using somebody else\u2019s research well means asking them how to credit it, before it is in front of the public rather than after.',
        state: 'planned',
      },
    ],
  },
];

const STATE: Record<State, { label: string; tone: 'ok' | 'warn' | 'plain' }> = {
  live: { label: 'Live', tone: 'ok' },
  partial: { label: 'Part built', tone: 'warn' },
  planned: { label: 'Decided · not built', tone: 'plain' },
};


// ---------------------------------------------------------------------------
// What we owe
// ---------------------------------------------------------------------------

/**
 * The obligations this work creates, and where each has got to.
 *
 * Owner, 17 Sep 2026: "In that How It Works section, you can add a section about
 * stuff we need to do, and you can add these marketing requirements in there."
 *
 * The same honesty rule as the rest of the page: a thing we have not done is
 * said plainly rather than left off, and **there is no done state until
 * something is done**. A table with a state word per row, and nothing else — no
 * prose, because this is a list of work rather than an argument.
 */
type Owed = { what: string; state: 'Not started' | 'With the log' | 'Built, off' | 'Parked, on purpose'; whose: 'Owner' | 'Engineering' };

const OWED: Owed[] = [
  { what: 'Say in the privacy notice that searches and taps are recorded against an account', state: 'Not started', whose: 'Owner' },
  { what: 'Write the legitimate-interests assessment · two pages, once', state: 'Not started', whose: 'Owner' },
  { what: 'Build the marketing opt-in with the search log, not after it', state: 'With the log', whose: 'Engineering' },
  { what: 'An unsubscribe in every message that is not a service message', state: 'Not started', whose: 'Engineering' },
  { what: 'Export and erasure reach the search log', state: 'With the log', whose: 'Engineering' },
  { what: 'Revisit retention at 50 million rows · the aggregate path is built and switched off', state: 'Built, off', whose: 'Owner' },
  { what: 'Reply to Heritage Crafts about referencing the Red List properly', state: 'Not started', whose: 'Owner' },
  { what: 'Four things outside the repo still called Roam', state: 'Not started', whose: 'Owner' },
  { what: 'Decide which credentials are compulsory to publish, per browse category', state: 'Parked, on purpose', whose: 'Owner' },
];

const OWED_TIP: Record<Owed['state'], readonly [string, string]> = {
  'Not started': ['Not started', 'Obligations nobody has begun.'],
  'With the log': ['With this build', 'Obligations that ship alongside the search log, not after it.'],
  'Built, off': ['Built, off', 'Built and deliberately switched off until you decide to switch it on.'],
  'Parked, on purpose': ['Parked', 'Parked on purpose, to be raised again rather than decided now.'],
};

function WhatWeOwe({ phone }: { phone: boolean }) {
  const count = (s: Owed['state']) => OWED.filter((o) => o.state === s).length;
  return (
    <View style={owedStyles.block}>
      <View style={owedStyles.band}>
        <View style={{ flexGrow: 1, flexBasis: 240, minWidth: 0, gap: 5 }}>
          <Explain tip={['/admin/how', 'This page. What is built, what is half-built and what is owed — kept beside the code so it cannot drift from it.']}><Text style={owedStyles.kicker}>/admin/how</Text></Explain>
          <Text style={owedStyles.title}>What we owe</Text>
        </View>
        <View style={[owedStyles.stats, phone && { gap: 20 }]}>
          <Explain tip={OWED_TIP['Not started']} style={{ gap: 2 }}>
            <Text style={[owedStyles.kicker, { color: LIME }]}>Not started</Text>
            <Text style={[owedStyles.statValue, { color: LIME }]}>{count('Not started')}</Text>
          </Explain>
          <Explain tip={OWED_TIP['With the log']} style={{ gap: 2 }}>
            <Text style={owedStyles.kicker}>With this build</Text>
            <Text style={owedStyles.statValue}>{count('With the log')}</Text>
          </Explain>
          <Explain tip={OWED_TIP['Built, off']} style={{ gap: 2 }}>
            <Text style={owedStyles.kicker}>Built, off</Text>
            <Text style={owedStyles.statValue}>{count('Built, off')}</Text>
          </Explain>
          <Explain tip={OWED_TIP['Parked, on purpose']} style={{ gap: 2 }}>
            <Text style={owedStyles.kicker}>Parked</Text>
            <Text style={owedStyles.statValue}>{count('Parked, on purpose')}</Text>
          </Explain>
        </View>
      </View>

      {/* On a phone the table keeps a width it can be read at and scrolls
          sideways inside its own box; the page never does (F4). */}
      <ScrollView horizontal={phone} scrollEnabled={phone} showsHorizontalScrollIndicator={false}>
      <View style={phone ? { width: 640 } : { flex: 1 }}>
      <View style={owedStyles.head}>
        <Explain tip="whatWeOwe" style={{ flex: 1 }}><Text style={owedStyles.headLabel}>What we owe</Text></Explain>
        <Explain tip="state" style={{ width: 150 }}><Text style={owedStyles.headLabel}>State</Text></Explain>
        <Explain tip="whose" style={{ width: 140 }}><Text style={owedStyles.headLabel}>Whose</Text></Explain>
      </View>
      {OWED.map((o, i) => (
        <View key={o.what} style={[owedStyles.row, i === OWED.length - 1 && { borderBottomWidth: 0 }]}>
          <Explain tip="whatWeOwe" style={{ flex: 1, minWidth: 0 }}><Text style={owedStyles.what}>{o.what}</Text></Explain>
          <Explain tip={OWED_TIP[o.state]} style={{ width: 150 }}>
            <Text style={[owedStyles.state, o.state === 'Not started' && { color: LIME, fontWeight: '700' }]}>{o.state}</Text>
          </Explain>
          <Explain tip="whose" style={{ width: 140 }}><Text style={owedStyles.whose}>{o.whose}</Text></Explain>
        </View>
      ))}
      </View>
      </ScrollView>
    </View>
  );
}

const owedStyles = StyleSheet.create({
  block: { gap: 0 },
  band: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.xl, flexWrap: 'wrap',
          borderBottomWidth: BORDER, borderBottomColor: desk.ruleStrong, paddingBottom: 16, marginBottom: 16 },
  kicker: { ...type.tiny, fontSize: 10, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase', color: desk.inkDim },
  title: { ...type.title, fontSize: 27, letterSpacing: -0.81, lineHeight: 30, color: desk.ink },
  stats: { flexDirection: 'row', alignItems: 'flex-end', gap: 30, flexWrap: 'wrap' },
  statValue: { ...type.title, fontSize: 20, fontWeight: '800', color: desk.ink, fontVariant: ['tabular-nums'] },
  head: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, paddingBottom: 9,
          borderBottomWidth: BORDER, borderBottomColor: desk.ruleStrong },
  headLabel: { ...type.small, fontSize: 12.5, fontWeight: '600', color: desk.inkDim },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 11,
         borderBottomWidth: 1, borderBottomColor: desk.rule },
  what: { ...type.body, fontSize: 13.5, color: desk.ink },
  state: { ...type.small, fontSize: 13, fontWeight: '600', color: desk.ink },
  whose: { ...type.small, fontSize: 13, color: desk.inkDim },
});

export function HowItWorks() {
  const { width } = useViewport();
  const phone = width < 900;
  const { setQuery } = useRouter();
  const live = useLive();

  // What is true this minute rather than in general: are travel times real
  // right now, or is the quota spent and everything an estimate?
  const [sources, setSources] = useState<Awaited<ReturnType<typeof api.sources>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.sources().then(setSources).catch((e) => setError(e.message)); }, []);

  /**
   * Which document is open is part of the address (`?doc=decisions`), and
   * opening the other one is a move, so it pushes: Back returns to the one
   * you were reading. The section anchor belongs to Business mechanics only.
   */
  const [docTab] = useQueryState<Doc>('doc', 'mechanics', asOneOf(DOCS, 'mechanics'));
  const openDoc = (d: Doc) => setQuery({ doc: d === 'mechanics' ? null : d, at: null }, { replace: false });

  /**
   * Where a link into the page lands. The info icon beside every filing
   * heading arrives with `?at=<section>`, and the page scrolls to it rather
   * than to the top. Each anchored section is a DOM node with a known id on
   * the web, which is the one thing a screen may reach for by name here;
   * the address itself is only ever read through the router.
   */
  const [at, setAt] = useQueryState<HowAnchor | null>('at', null, { read: howAnchorOf, write: (v) => v });
  useEffect(() => {
    if (!at || docTab !== 'mechanics' || Platform.OS !== 'web') return;
    // After the paint: the section has to exist before it can be scrolled to.
    const id = requestAnimationFrame(() => {
      document.getElementById(anchorId(at))?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(id);
  }, [at, docTab]);

  /**
   * The section in view, for the jump list. It follows the scroll on the web;
   * it is not written to the address, which says where a link landed, not
   * where the reader has got to.
   */
  const [inView, setInView] = useState<HowAnchor | null>(null);
  useEffect(() => {
    if (docTab !== 'mechanics' || Platform.OS !== 'web' || typeof IntersectionObserver === 'undefined') return;
    const seen = new Map<HowAnchor, boolean>();
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target.id.replace(/^how-/, '') as HowAnchor, e.isIntersecting);
      const first = HOW_ANCHORS.find((a) => seen.get(a));
      if (first) setInView(first);
    }, { rootMargin: '0px 0px -65% 0px' });
    const id = requestAnimationFrame(() => {
      for (const a of HOW_ANCHORS) { const el = document.getElementById(anchorId(a)); if (el) obs.observe(el); }
    });
    return () => { cancelAnimationFrame(id); obs.disconnect(); };
  }, [docTab]);

  /**
   * A jump writes the address like any other link into the page, and scrolls
   * at once as well, so a second tap on the section already in the address
   * still goes there. Moving within one document replaces.
   */
  const jump = (a: HowAnchor) => {
    setAt(a);
    setInView(a);
    if (Platform.OS === 'web') document.getElementById(anchorId(a))?.scrollIntoView({ block: 'start' });
  };

  const now = sources?.routingNow ?? null;
  const paused = now ? now.matrix ?? now.route ?? null : null;

  return (
    <AdminPage>
      <DocTabs value={docTab} onChange={openDoc} />

      {docTab === 'mechanics' ? (
        <View style={[frame.body, { flexDirection: phone ? 'column' : 'row' }]}>
          <JumpList on={inView ?? at ?? 'layers'} onJump={jump} phone={phone} />
          <View style={[frame.paper, phone && frame.paperPhone]}>
            <TheDocument at={at} jump={jump} live={live} phone={phone} />
          </View>
        </View>
      ) : null}

      {docTab === 'decisions' ? (
        <>
          <Banner tone={paused ? 'warn' : 'plain'}>
            {sources == null && !error ? 'Reading what the API is doing…'
              : error || sources == null ? 'Could not read what the API is doing just now, so this page cannot say whether travel times are real or estimated.'
                : sources.routing !== 'google-routes' ? 'No routing key is set, so every travel time on screen is worked out from the distance.'
                  : paused ? `Google Routes has no quota left just now, so travel times are worked out from the distance until ${new Date(paused.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
                    : 'Google Routes is answering, so travel times on screen are real ones.'}
          </Banner>

          <WhatWeOwe phone={phone} />

          {SECTIONS.map((s) => (
            <Panel key={s.key} title={s.title} sub={s.blurb} padded={false}>
              {s.decisions.map((d, i) => (
                <View key={d.title} style={[styles.row, i > 0 && styles.rowLine]}>
                  <View style={styles.head}>
                    <Icon name={s.icon} size={16} color={desk.inkDim} />
                    <Text style={[type.h3, { flex: 1, color: desk.ink }]}>{d.title}</Text>
                    <Pill label={STATE[d.state].label} tone={STATE[d.state].tone} />
                  </View>
                  <Text style={[type.body, { color: desk.ink }]}>{d.rule}</Text>
                  <View style={styles.why}>
                    <Text style={[type.tiny, styles.whyLabel]}>WHY</Text>
                    <Text style={[type.small, { flex: 1, color: desk.inkMuted }]}>{d.why}</Text>
                  </View>
                  {d.said ? (
                    <Text style={styles.quote}>“{d.said.words}” — {d.said.who}, {d.said.on}</Text>
                  ) : null}
                  {d.where ? <Text style={styles.where}>{d.where}</Text> : null}
                </View>
              ))}
            </Panel>
          ))}

          <Panel title="Keeping this page honest" sub="What it is for, and how it is meant to be maintained.">
            <Text style={[type.body, { color: desk.ink }]}>
              A page like this is worthless the moment it describes something that is not true, so every entry in the decision log says whether it
              is live or only decided, and names the file the rule is in. If an entry cannot be checked against the code in a minute, it is written wrong.
              Business mechanics is the owner’s own document, corrected wherever the back-office handover or the register of decisions has since changed it,
              and every number in it that is a setting is read from Fact automations.
            </Text>
            <Text style={[type.small, { color: desk.inkMuted }]}>
              Anything that changes by the minute — whether travel times are real right now — is read from the API rather than written down here.
            </Text>
            <Press onPress={() => Linking.openURL('https://github.com/rogerrivers888/epic/blob/main/CLAUDE.md')} accessibilityRole="link">
              <Text style={styles.link}>The working agreements this page draws on →</Text>
            </Press>
          </Panel>
        </>
      ) : null}
    </AdminPage>
  );
}

/** The DOM id a section is reached by: `how-facts`. */
const anchorId = (at: HowAnchor) => `how-${at}`;

const styles = StyleSheet.create({
  row: { paddingVertical: 13, gap: 6 },
  rowLine: { borderTopWidth: 1, borderTopColor: desk.rule },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  why: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginTop: 2 },
  whyLabel: { width: 34, paddingTop: 2, fontWeight: '700', letterSpacing: 0.6, color: desk.inkFaint },
  quote: { fontFamily: fonts.body, fontSize: 13, fontStyle: 'italic', color: desk.inkMuted, lineHeight: 18 },
  // Where a rule lives: the monospace is what marks it as a path, so it needs
  // no fill behind it. A filled token in a list of them reads as a row of chips.
  where: { fontFamily: MONO, fontSize: 11, color: desk.inkDim, alignSelf: 'flex-start', paddingVertical: 2 },
  link: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: LIME },
});

/**
 * The document's own measures (v2 stylesheet): a 760px reading column, 17px
 * body at 1.6, the title 48/700, each section 56px below the last under a 2px
 * ink rule. Archivo throughout — the document's three faces are Epic's one —
 * and the desk's colours, lime for links and rules.
 */
const doc = StyleSheet.create({
  wrap: { maxWidth: 760, width: '100%', alignSelf: 'center' },
  eyebrow: { fontFamily: fonts.body, fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', color: desk.inkDim, marginBottom: 14 },
  h1: { fontFamily: fonts.heading, fontSize: 48, lineHeight: 49, fontWeight: '700', letterSpacing: -0.96, color: desk.ink },
  meta: { fontFamily: fonts.body, fontSize: 13, color: desk.inkMuted, marginTop: 12 },
  cantSpeak: { fontFamily: fonts.body, fontSize: 13.5, color: desk.amber, marginBottom: 6 },
  lede: { fontFamily: fonts.body, fontSize: 19, lineHeight: 29.5, color: desk.ink, marginTop: 24 },
  nav: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 6, marginTop: 26 },
  navLink: { fontFamily: fonts.heading, fontSize: 14, fontWeight: '600', color: LIME, borderBottomWidth: 1, borderBottomColor: desk.rule },
  section: { marginTop: 56, paddingTop: 18, borderTopWidth: BORDER, borderTopColor: desk.ink },
  // The section a link landed on, marked with a lime rule so the eye finds it
  // after the scroll. A rule, not a fill.
  landed: { borderLeftWidth: 3, borderLeftColor: LIME, paddingLeft: 12, marginLeft: -15 },
  h2: { fontFamily: fonts.heading, fontSize: 24, lineHeight: 29, fontWeight: '700', letterSpacing: -0.24, color: desk.ink, marginBottom: 12 },
  h3: { fontFamily: fonts.heading, fontSize: 17, fontWeight: '700', color: desk.ink, marginTop: 26, marginBottom: 6 },
  p: { fontFamily: fonts.body, fontSize: 17, lineHeight: 27, color: desk.ink, marginBottom: 14 },
  list: { gap: 8, marginBottom: 14 },
  li: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  dot: { fontFamily: fonts.body, fontSize: 17, lineHeight: 27, color: desk.inkDim },
  note: { borderWidth: 1, borderColor: desk.rule, borderLeftWidth: 3, borderLeftColor: LIME, backgroundColor: desk.lifted, paddingVertical: 12, paddingHorizontal: 16, marginVertical: 18 },
  tableBox: { marginTop: 14, marginBottom: 18 },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: desk.rule },
  thRow: { borderBottomWidth: BORDER, borderBottomColor: desk.ink, backgroundColor: desk.picked },
  th: { fontFamily: fonts.heading, fontSize: 13, fontWeight: '700', color: desk.ink, padding: 8 },
  td: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: desk.ink, padding: 8 },
  figure: { marginTop: 20, marginBottom: 22 },
  cap: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: desk.inkDim },
  mid: { alignSelf: 'center', width: '100%', maxWidth: 340 },
  five: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  fiveBox: { flexGrow: 1, flexBasis: 120, minWidth: 104 },
  placeFrame: { borderWidth: 1, borderStyle: 'dashed', borderColor: desk.ruleStrong, padding: 20 },
  box: { paddingVertical: 12, paddingHorizontal: 16, gap: 4, borderWidth: 1 },
  box_plain: { borderColor: desk.ruleStrong, backgroundColor: desk.lifted },
  box_live: { backgroundColor: desk.picked, borderColor: LIME },
  box_key: { backgroundColor: LIME, borderColor: LIME },
  box_wait: { borderColor: desk.amber, borderLeftWidth: 4, backgroundColor: desk.lifted },
  box_out: { borderColor: desk.ruleStrong, borderStyle: 'dashed' },
  boxTitle: { fontFamily: fonts.heading, fontSize: 14, fontWeight: '700', color: desk.ink },
  boxSub: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: desk.inkMuted },
  boxNote: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, fontWeight: '600', color: desk.inkDim },
  down: { alignItems: 'center', height: 30, justifyContent: 'flex-end' },
  downLine: { width: 1, flex: 1, backgroundColor: desk.inkDim, marginBottom: -4 },
});
