/**
 * How it works — the decisions behind what Epic does, written down.
 *
 * The owner, 6 Sep 2026: "I think we need a 'how it works' in the desktop back
 * office thing, and you can put all of these assumptions there in terms of what
 * we've done. This is an example of something: in order to reduce cost, we've
 * decided to estimate the detour. Maybe once the user adds it to their actual
 * trip, not in a short list, then we can recalculate the actual correct number."
 *
 * Three rules keep this page honest, because a page like this is worthless the
 * moment it describes something that is not true:
 *
 *   1. Every entry says whether it is **live** or **decided and not built**.
 *      A plan and a fact look identical in prose, so they are not allowed to.
 *   2. Every entry names the file the rule is actually in, so the page can be
 *      checked against the code rather than believed.
 *   3. Where the answer changes by the minute — whether travel times are real
 *      or estimated right now — it is read from the API, not written here.
 *
 * It is the back office's answer to "why did it say that", and to "what is this
 * going to cost".
 */

import React, { useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { Press } from '../../components/press';
import { api } from '../../api';
import { colors, fonts, spacing, type, BORDER } from '../../theme';
import { Icon, IconName } from '../../components/Icon';
import { AdminPage, Banner, PageHead, Panel, Pill } from '../kit';
import { Explain } from '../explain';
import { useQueryState } from '../../router';
import { howAnchorOf, type HowAnchor } from '../../routes';

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
 * `at` is the section's address inside the page — `/admin/how?at=facts` — and
 * the id the info icons on the filing desk deep-link to. Only the Business
 * mechanics sections carry one; the rest are read top to bottom.
 */
type Section = { key: string; title: string; blurb: string; icon: IconName; decisions: Decision[]; at?: HowAnchor };

/** A path is a path: it reads as one, and it is meant to be copied into an editor. */
const MONO = Platform.OS === 'web' ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined;

const SECTIONS: Section[] = [
  /**
   * Business mechanics — the five objects the filing desk is made of, and one
   * section per screen, in the words of the rename (owner's brief, 26 Sep
   * 2026). Each carries an `at` so the info icon beside that screen's heading
   * lands on it. The owner is supplying a rewritten page; these sections are
   * the anchors it will fill, written in the new words rather than left in
   * the old ones until then.
   */
  {
    key: 'mechanics',
    at: 'mechanics',
    title: 'Business mechanics — what each thing is',
    blurb: 'Three words were each doing several jobs and the back office was unreadable because of it. These are the five objects the filing desk is made of, and the one sentence each one is.',
    icon: 'owned',
    decisions: [
      {
        title: 'A category is where a place is filed',
        rule: 'Fun › Water parks. A place has exactly one home subcategory, which is what stops it drawing twice on Inspire or in a trip’s Activities lanes. A subcategory can be shown in other categories as well, but the place keeps one home.',
        why: 'The owner, on seeing a drawer in two categories: once something is duplicated, if the user sees it in Fun, they don’t need to see it again in Sport. One home is the only rule that makes that true everywhere at once.',
        state: 'live',
        where: 'apps/api/src/domain/moods.js · MAX_SHELVES, shelvesOf() · migration 103',
      },
      {
        title: 'A fact is something we find out about a place',
        rule: 'Indoors, step free, wave machine. Any shape — a yes or no, a range such as Suits ages or Duration, a band such as cost. A fact is read from the place first, then from its drawer’s default, then nowhere. A fact can bring another fact with a value: splash pad brings suits ages 0 to 7.',
        why: 'The owner: there’s a very big difference between what a 5-year-old can do and what a 12-year-old can do. Ages are the clearest case, but the same machinery answers rainy day and step free without a column being added for each. Facts were called labels until 26 Sep 2026, when one word was holding facts, sheets and checks at once.',
        state: 'live',
        where: 'apps/api/src/repositories/placeAttributes.js · resolveFor() · migrations 105, 114–116, 118',
      },
      {
        title: 'A check is one thing we go and find out; a standard check is made on everything',
        rule: 'A check names a fact and goes looking for it on one place. A standard check — step free, parking, toilets, booking required, food on site, duration, cost band — is made on every place, everywhere. A set check is made only on the places a fact sheet covers.',
        why: 'The question a check answers is closed, so two places can be compared: this one has a toddler pool and that one does not. An open question produces prose, and two places described freely cannot be compared.',
        state: 'live',
        where: 'apps/api/src/repositories/questionSets.js · migration 207',
      },
      {
        title: 'A fact sheet is a bundle of checks for one kind of place',
        rule: '“Water parks & pools” is a sheet name, not a subcategory — it covers two. A sheet is attached to one or more subcategories and never owned by one, so water parks, lidos and leisure pools share one sheet rather than three copies of nearly the same thing. What a sheet covers is said on its row, because a sheet is named like a place but is a checklist.',
        why: 'A sheet is the thing people misread most. It looks like a place and it is a list of things to find out — which is why every sheet row says what it covers and how many checks it carries.',
        state: 'live',
        where: 'apps/api/src/repositories/questionSets.js · question_sets, question_set_subcategories',
      },
      {
        title: 'An idea is a rule over facts, which is what a family browses',
        rule: '“It’s raining again” is an idea for a day out: a title, a copy line and a rule over facts — indoors, suits the ages in this household, within reach today. Nothing is ever filed into an idea; it fills itself from whatever the facts say. Ideas were called rows until 26 Sep 2026, and a row is a shape, not a concept.',
        why: 'An idea that is a rule can fill differently in Ascot and in Hungerford without anybody curating either. An idea that is a list has to be kept by hand in every district, and it goes stale in all of them.',
        state: 'live',
        where: 'apps/api/src/domain/browseRows.js · migration 208',
      },
      {
        title: 'What we found is one of four things, and “nothing found” is one of them',
        rule: 'A check on a place has found yes, found no, found nothing, or has not been made yet. Nothing found is stored rather than inferred: we looked, and no owned source mentioned it. Not checked yet means the check was added after this place was last looked at, and is the absence of a row.',
        why: 'A place where nothing anywhere mentioned a toddler pool probably has not got one, and that is worth knowing. If it were drawn the same as a check nobody has got round to yet, the two would be indistinguishable and neither could be trusted.',
        state: 'live',
        where: 'apps/api/src/domain/questions.js · settle()',
      },
    ],
  },
  {
    key: 'categories',
    at: 'categories',
    title: 'Categories — where a place is filed',
    blurb: 'How a place comes to sit in one drawer, what a drawer assumes about everything in it, and what happens when the places disagree.',
    icon: 'shortlist',
    decisions: [
      {
        title: 'A primary fact is a subcategory, and a place has exactly one',
        rule: 'The subcategories are the primary facts about a place. A place gets one and only one, which is its home. A subcategory can be shown in other categories as well, but the place keeps one home and each carousel gives it to one lane.',
        why: 'The owner, on seeing a drawer in two categories: once something is duplicated, if the user sees it in Fun, they don’t need to see it again in Sport.',
        state: 'live',
        where: 'apps/api/src/domain/moods.js · MAX_SHELVES, shelvesOf() · migration 103',
      },
      {
        title: 'Something inside a bigger place is not its own day out',
        rule: 'Amity Beach is part of Thorpe Park. A child is recorded against its parent, one step only, and is dropped from every list: the parent is shown, and it inherits what the child carried — the moods, the experiences, and any fact the parent had nothing to say about.',
        why: 'The owner had seen rides inside Thorpe Park listed on Inspire as separate days out. A family cannot go to Amity Beach; they can go to Thorpe Park, and the beach is a reason to.',
        state: 'live',
        where: 'apps/api/src/repositories/placeParts.js · withoutParts(), rollUp() · migration 106',
        said: {
          who: 'Roger', on: '13 Sep 2026',
          words: 'I’ve seen multiple times activities that actually exist in Thorpe Park being listed as separate activities on the Inspire tab, and we absolutely have to stop that happening… we should only ever display Thorpe Park, not Amity Beach.',
        },
      },
      {
        title: 'Not sure is a list, and a research run fills it in',
        rule: 'Where the mapping cannot settle a place, it goes on a list with its address, its words and the reason it could not be settled — never filed by a guess. A run then asks Claude, with web search, what it is and whether it is part of somewhere bigger. An answer is refused unless it names one of the subcategories offered, gives a sentence saying why, and cites a link. The answer is a proposal; a person settles it, and settling it can write the mapping at the same time.',
        why: 'The owner: I don’t want to have to determine whether Amity Beach is part of Thorpe Park. You should use the Anthropic API to confirm and fill in those blanks. The refusals matter more than the answers — a model that cannot cite a page has not looked anything up.',
        state: 'live',
        where: 'apps/api/src/domain/research.js · apps/api/src/repositories/notSure.js · migrations 117, 119',
      },
      {
        title: 'Twelve real places, before a mapping is saved',
        rule: 'A word can be opened to see twelve real places that carry it, fetched once from Google with a small field mask and nothing stored. The screen groups them by the other words they carry, because the shape they share is the mapping worth writing, and says of each one where the mapping puts it today. Places nothing settles can be sent to the not-sure list from there.',
        why: 'The owner, on adventure sports centre: I don’t know what that is. Twelve gym results shared one shape and twelve water parks had ten different ones — which is the difference between a mapping worth writing and a word that needs looking at one place at a time.',
        state: 'live',
        where: 'apps/api/src/sources/google.js · examplesOfType() · metered as admin.taxonomy.examples',
      },
    ],
  },
  {
    key: 'facts',
    at: 'facts',
    title: 'Facts — what we find out about a place',
    blurb: 'Where facts come from, why a water park and a country walk are checked for different things, and who is allowed to say what a place has.',
    icon: 'question',
    decisions: [
      {
        title: 'The checks come from the places, and a person promotes them',
        rule: 'Epic reads what is written about places of a kind — the open map’s tags, the venue’s own page, Wikipedia — counts which words keep appearing, and offers them as candidates with the share of places each appeared for. Somebody promotes the ones worth checking. A word rejected here is never offered again.',
        why: 'Nobody can sit down and list what matters about fifty-two kinds of place, and a list written from an armchair misses what the places themselves keep saying. The share is the point: wave machine at 10% tells you more than lockers at 95%, which is true of everywhere and separates nothing.',
        state: 'live',
        where: 'apps/api/src/sources/vocabulary.js · freeSweep()',
      },
      {
        title: 'Google may raise a word; it may never answer a check',
        rule: 'Google’s review summaries can be read to find out which words matter for a kind of place. The text is read in memory, turned into counted words, and thrown away — none of it is written to a row, a log or a debug field, and none of it becomes a fact about the place it came from. A check on a place is answered from what Epic owns or may freely read: the venue’s own page, OpenStreetMap, Wikipedia, Wikidata, the hygiene register.',
        why: 'Two reasons and they point the same way. A fact we keep has to be one we are allowed to keep, and a stored copy of somebody else’s writing is not. And a wrong claim about a real business carries real risk — what we found on the venue’s own page can be shown with a link and a date beside it.',
        state: 'live',
        where: 'apps/api/src/domain/questions.js · OWNED_SOURCES · place_answers source check',
      },
      {
        title: 'Everything we found says where it came from, and two sources may disagree',
        rule: 'What we found carries its source, the page it came from and the day it was checked — “Wave machine · from coralreef.co.uk · checked 12 Sep”. Where the venue’s page and the open map say different things, both are kept and the pair is marked unresolved for a person to settle. Nothing resolves it quietly.',
        why: 'A provenance line is what makes a fact checkable a year later. And silently picking a winner between two sources is how a confident wrong answer gets built — the disagreement is itself information.',
        state: 'live',
        where: 'apps/api/src/repositories/questionSets.js · markDisagreement()',
      },
      {
        title: 'A word can be mentioned and denied in the same breath',
        rule: 'When a word is noticed, Epic also records what the sentence did to it: asserted it, denied it, or merely asked about it. “Does it have a wave machine? We couldn’t find one” counts as a question, not as evidence. A candidate whose mentions are mostly denials says so on the row.',
        why: 'It cannot be worked out later. The rented text is discarded within milliseconds of arriving, so if the polarity is not read at that moment there is nothing left to read it from — and a feature nobody has would look exactly like one everybody has.',
        state: 'live',
        where: 'apps/api/src/domain/questions.js · polarityOf()',
      },
      {
        title: 'Only a feature becomes a check, and an unclear word simply waits',
        rule: 'A harvested word is a feature (a wave machine), a condition (busy at weekends) or an opinion (rude staff). Only features can become checks. A word nothing can call sits in a holding pen — not pending, not rejected, not waiting on anybody — and is looked at again when a later harvest raises its count.',
        why: 'A wrong “feature” becomes a check made on thousands of places; an unclear word costs nothing while it waits. And opinions are the Epic score’s job, not a check’s — checking every place for rude staff would be a rating system with extra steps.',
        state: 'live',
        where: 'apps/api/src/sources/vocabulary.js · classifyCandidates()',
      },
      {
        title: 'A fact never checked anywhere is an orphan, and All facts says so in red',
        rule: 'A fact approved into the vocabulary and attached to no sheet is never checked on any place. It is a real fact with nothing behind it, and it sits on the All facts list marked never checked anywhere until somebody attaches it to a sheet or retires it.',
        why: 'Approving a word with no sheet is what creates orphans, so parking one is an explicit act rather than the quiet result of forgetting the second step.',
        state: 'live',
        where: 'apps/api/src/routes/filing.js · GET /labels/vocabulary',
      },
      {
        title: 'Epic asks a venue’s website before it reads it',
        rule: 'Every fetch of a business’s own page checks their robots.txt first, waits the crawl delay they ask for, and identifies itself as EpicBot with a contact address. A site that says no is not read, and yields nothing — the same as a site that is down.',
        why: 'Enrichment reads venue pages on behalf of a household looking at that venue, which is a reasonable thing to do and stops being reasonable the moment it ignores what the site owner asked for. The cost is real: a venue whose robots.txt was written for search engines may lose us a phone number.',
        state: 'live',
        where: 'apps/api/src/sources/politeness.js',
      },
      {
        title: 'Checking a place waits for somebody to want it',
        rule: 'Checks are raised in bulk; they are made one place at a time. A place has its checks made once it crosses a threshold of appearances in search or drawer opens — never by sweeping everywhere. It is triggered by the search rather than by the tap, so by the time somebody opens a place it is usually already checked, and a place never checked still shows what its drawer assumes about places of that kind rather than nothing. The hook is built and switched off.',
        why: 'A small share of places carries most of the searching. Checking all of them up front spends effort on places nobody opens, and it would go stale before anybody read it.',
        state: 'partial',
        where: 'apps/api/src/sources/vocabulary.js · enrichmentQueue() · EPIC_ENRICHMENT',
      },
    ],
  },
  {
    key: 'sheets',
    at: 'sheets',
    title: 'Fact sheets — what we find out, about what kind of place',
    blurb: 'A sheet is named like a place but is a checklist. Why every water park is checked for the same things, why the list is short, and when a kind of place stops costing money.',
    icon: 'question',
    decisions: [
      {
        title: 'A kind of place has a fixed, short list of checks',
        rule: 'Every water park is checked for the same eight things — wave machine, toddler pool, splash area, step free. The list belongs to a fact sheet, and a sheet is shared: water parks, lidos and leisure pools use one between them rather than three copies of nearly the same thing. On top of it, the standard checks are made on everything.',
        why: 'An open question about a place produces prose, and two places described freely cannot be compared. Eight closed checks can be: this one has a toddler pool and that one does not. It is also the only way a filter can ever be honest — “somewhere with a splash area” needs a check, not a paragraph that mentions one.',
        state: 'partial',
        where: 'apps/api/src/repositories/questionSets.js · migration 207',
      },
      {
        title: 'A sheet says what it covers, because its name does not',
        rule: 'Every sheet row reads name · covers these subcategories · so many checks · so many places. A sheet whose name does not say which subcategories it covers is renamed by a person, never silently.',
        why: 'A sheet name that does not tell you which subcategories it covers defeats the point of having one.',
        state: 'live',
        where: 'apps/web/src/admin/filing/Facts.tsx · FactSheets',
      },
      {
        title: 'Once a kind of place has its checks, Google leaves that category',
        rule: 'When a fact sheet stops learning new words, it is settled: the Google pass skips it from then on, and every future place of that kind is checked from the venue’s own page, the open map and the encyclopedias. Attaching a new subcategory to the sheet unsettles it, because it brings vocabulary nobody has harvested.',
        why: 'It is the moment a category stops costing money. Epic buys the vocabulary once and owns it; the alternative is paying to be told about wave machines again every time a new water park opens.',
        state: 'live',
        where: 'apps/api/src/sources/vocabulary.js · settleFromSaturation()',
      },
    ],
  },
  {
    key: 'mapping',
    at: 'mapping',
    title: 'Mapping — where a provider’s word points',
    blurb: 'How a word a provider uses becomes a drawer on the home screen — and why the mappings are written in Epic’s own words rather than a provider’s.',
    icon: 'shortlist',
    decisions: [
      {
        title: 'Providers’ words are mapped to our facts; the mappings are written in our facts',
        rule: 'Every word a provider uses — google:water_park, wikidata:Q1 — points at one of Epic’s own facts. A mapping is then written over Epic’s facts, not over Google’s: when a place carries these facts, it goes in this drawer. A mapping written in our words is stored with scope “ours” and its facts bare; the same mapping reads a word from OpenStreetMap or Wikidata the day that source is added, without being rewritten.',
        why: 'Mappings written over one provider’s vocabulary have to be written again for every other provider, and they break when that provider renames a word. 353 mappings were backfilled from the single-word rules that already existed, and 46 in our own words were written from them.',
        state: 'live',
        where: 'apps/api/src/domain/labels.js · scopeFor() · migrations 107–109',
        said: {
          who: 'Roger', on: '14 Sep 2026',
          words: 'we don’t use Google words; we use our own words. The first exercise is to map Google words to our labels, and then we can add labels. We create rules using our own internal labels, which will change over time because we have other providers other than Google.',
        },
      },
      {
        title: 'A word that describes a place without saying what it is',
        rule: 'Some of a provider’s words — tourist attraction, establishment, point of interest — describe a place without saying what it is. They are kept as a fact rather than mapped to a drawer, and they never settle a place on their own. A place carrying nothing else goes on the not-sure list instead of being filed by one of them.',
        why: 'Filing by tourist attraction would put a castle, a cave and a garden centre in the same drawer. Throwing the word away instead loses real information about the place, so it is kept where it is true: as something the place is, not somewhere it lives.',
        state: 'live',
        where: 'apps/api/src/domain/googleSuggest.js · GENERIC_TYPES · migration 092',
      },
      {
        title: 'The order the mappings are read in',
        rule: 'This place → a mapping over a provider’s words → a mapping over ours → the kind of place → its category → what it was tagged with. A mapping somebody wrote by hand beats one Epic wrote for itself at every level. Mappings in our words sit below mappings over a provider’s, because ours name one fact each and a hand-written combination is more specific than any of them.',
        why: 'Without the ordering, a single word could out-vote a longer mapping that was written precisely because the single word was wrong. It is also why a place taught by hand can never be moved by a later mapping.',
        state: 'live',
        where: 'apps/api/src/domain/moods.js · shelvesForVenue()',
      },
      {
        title: 'Identifiers are proposed, never written unattended',
        rule: 'A skill tag or a fact can carry an outside identifier — a Wikidata QID. A run proposes one for every tag nobody has looked up, with the description that tells the senses apart, and writes nothing. A person accepts. Only where exactly one thing in Wikidata carries that name is it offered for acceptance in a batch; saying no is written down, so no later run proposes the same thing again.',
        why: 'A plain search puts fossil collector above fossil collecting, and foraging has a human sense and an animal one. Accepting four hundred first results would bed in mistakes that nothing downstream would ever surface.',
        state: 'live',
        where: 'apps/api/src/routes/hostSkills.js · /identifiers · migrations 120–121',
      },
    ],
  },
  {
    key: 'defaults',
    at: 'defaults',
    title: 'Defaults — what a drawer assumes',
    blurb: 'A default is assumed for every place in a drawer unless a place says otherwise. Why they are worth having, and the two different ways one can be wrong.',
    icon: 'filters',
    decisions: [
      {
        title: 'A default is read after the place and before nothing',
        rule: 'A fact is read from the place first, then from its drawer’s default, then nowhere. A place that says otherwise wins; a place that says nothing takes what its drawer assumes. A default is a rule over a drawer, never a fact recorded against a place.',
        why: 'Most places never say whether they are indoors, and most drawers can. Answering “indoors?” for every soft play centre at once is what lets a rule over facts fill an idea before any place has been checked.',
        state: 'live',
        where: 'apps/api/src/repositories/placeAttributes.js · resolveFor()',
      },
      {
        title: 'Two columns, because there are two different ways a default can be wrong',
        rule: 'Places contradict it is computed: of the places the default files, how many hold a different value. People called it wrong is human: how many times somebody overrode it by hand. They are never collapsed into one number. Three corrections is where a default stops being a rounding error, and it is drawn loud from there.',
        why: 'A high contradiction count can mean the default is too broad or that the drawer wants splitting — nobody has said anything; the data disagrees with itself. Every override is a person who looked at a place and said no, which makes it the stronger signal of the two.',
        state: 'live',
        where: 'apps/web/src/admin/filing/Defaults.tsx · rule_overrides',
        said: { who: 'Roger', on: '20 Sep 2026', words: 'this rule has been called wrong 41 times — that is the single most useful number in the system.' },
      },
      {
        title: 'Retiring a default never touches a place',
        rule: 'When a default is retired the drawer stops saying it. Every place keeps what it says for itself.',
        why: 'A default was never a fact about any one place, so taking it away cannot remove one.',
        state: 'live',
        where: 'apps/api/src/routes/filing.js · POST /rules/:id/retire',
      },
    ],
  },
  {
    key: 'ideas',
    at: 'ideas',
    title: 'Ideas — what a family browses',
    blurb: 'An idea is a title, a copy line and a rule over facts. Nothing is ever filed into one. How they fill, why hearting one matters, and what a thin district does to the list.',
    icon: 'keep',
    decisions: [
      {
        title: 'An idea is a rule over facts, and it fills itself',
        rule: '“It’s raining again” is indoors, within reach today, suits the ages in this household. Nothing is put into an idea by hand; it fills from whatever the facts say about the places within reach, so the same idea reads differently in Ascot and in Hungerford.',
        why: 'An idea that is a list has to be curated in every district and goes stale in all of them. A rule over facts is written once and is right wherever the facts are.',
        state: 'live',
        where: 'apps/api/src/domain/browseRows.js',
      },
      {
        title: 'A hearted idea rises, and unhearted ones stay mixed in',
        rule: 'Hearting an idea is the highest-signal tap in the product. On Inspire, hearted ideas rise to the top and two or three unhearted ones stay mixed in among them, never only at the bottom. A heart belongs to a member, and the first heart asks whose list this is.',
        why: 'A list that only ever shows you what you have already said yes to has stopped being a way of finding anything.',
        state: 'live',
        where: 'apps/web/src/admin/filing/Ideas.tsx · householdRows()',
      },
      {
        title: 'A hearted idea with too little near you waits quietly',
        rule: 'An idea below its minimum fill in a district shows no shelf at all rather than an empty one. Only a hearted idea waits: an unhearted one below the fill is simply an idea nobody asked for.',
        why: 'An empty shelf reads as “there is nothing good here”; no shelf reads as “not this week”. An idea that fills with twelve places in Ascot returns two in Hungerford, and an idea nobody can fill is not a bad idea — it is one waiting for a district to get denser.',
        state: 'live',
        where: 'apps/web/src/admin/filing/say.ts · waiting(), thinSomewhere()',
      },
    ],
  },
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
    blurb: 'The rules behind the words on screen — what counts as a holiday, what a mood means, what excludes a place and what merely ranks it.',
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
        title: 'A place sits on at most two shelves, and the mapping is taught',
        rule: 'Each shelf carries a weight from 0 to 1. Only the strongest two above the floor are drawn. Anything in `shelf_rules` beats the built-in tables, narrowest rule first.',
        why: 'A flat list of moods put anything arguably two things on four shelves, and the home screen became the same places six times. The tables were also simply wrong in places — the atlas has one word for a Formula One circuit and a football ground — and re-guessing does not fix that; teaching it does.',
        state: 'live',
        where: 'apps/api/src/domain/moods.js · back office › Shelves',
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
        title: 'Red means one of two things, and never anything else',
        rule: 'Red is the heart — a place the household loves — and it is "this needs doing": a trip with dates and nowhere to sleep, a visit nobody has rated. Counts, statuses and totals are never red.',
        why: 'A colour that means five things means nothing. Two meanings, both of which want your attention, is the most it can carry.',
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

function WhatWeOwe() {
  const count = (s: Owed['state']) => OWED.filter((o) => o.state === s).length;
  return (
    <View style={owedStyles.block}>
      <View style={owedStyles.band}>
        <View style={{ flexGrow: 1, flexBasis: 240, minWidth: 0, gap: 5 }}>
          <Explain tip={['/admin/how', 'This page. What is built, what is half-built and what is owed — kept beside the code so it cannot drift from it.']}><Text style={owedStyles.kicker}>/admin/how</Text></Explain>
          <Text style={owedStyles.title}>What we owe</Text>
        </View>
        <View style={owedStyles.stats}>
          <Explain tip={OWED_TIP['Not started']} style={{ gap: 2 }}>
            <Text style={[owedStyles.kicker, { color: colors.accent }]}>Not started</Text>
            <Text style={[owedStyles.statValue, { color: colors.accent }]}>{count('Not started')}</Text>
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

      <View style={owedStyles.head}>
        <Explain tip="whatWeOwe" style={{ flex: 1 }}><Text style={owedStyles.headLabel}>What we owe</Text></Explain>
        <Explain tip="state" style={{ width: 150 }}><Text style={owedStyles.headLabel}>State</Text></Explain>
        <Explain tip="whose" style={{ width: 140 }}><Text style={owedStyles.headLabel}>Whose</Text></Explain>
      </View>
      {OWED.map((o, i) => (
        <View key={o.what} style={[owedStyles.row, i === OWED.length - 1 && { borderBottomWidth: 0 }]}>
          <Explain tip="whatWeOwe" style={{ flex: 1, minWidth: 0 }}><Text style={owedStyles.what}>{o.what}</Text></Explain>
          <Explain tip={OWED_TIP[o.state]} style={{ width: 150 }}>
            <Text style={[owedStyles.state, o.state === 'Not started' && { color: colors.accent, fontWeight: '700' }]}>{o.state}</Text>
          </Explain>
          <Explain tip="whose" style={{ width: 140 }}><Text style={owedStyles.whose}>{o.whose}</Text></Explain>
        </View>
      ))}
    </View>
  );
}

const owedStyles = StyleSheet.create({
  block: { gap: 0 },
  band: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.xl, flexWrap: 'wrap',
          borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted, paddingBottom: 16, marginBottom: 16 },
  kicker: { ...type.tiny, fontSize: 10, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase', color: colors.inkMuted },
  title: { ...type.title, fontSize: 27, letterSpacing: -0.81, lineHeight: 30 },
  stats: { flexDirection: 'row', alignItems: 'flex-end', gap: 30, flexWrap: 'wrap' },
  statValue: { ...type.title, fontSize: 20, fontWeight: '800', color: colors.ink, fontVariant: ['tabular-nums'] },
  head: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, paddingBottom: 9,
          borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted },
  headLabel: { ...type.small, fontSize: 12.5, fontWeight: '600', color: colors.inkMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 11,
         borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  what: { ...type.body, fontSize: 13.5, color: colors.ink },
  state: { ...type.small, fontSize: 13, fontWeight: '600', color: colors.ink },
  whose: { ...type.small, fontSize: 13, color: colors.inkMuted },
});

export function HowItWorks() {
  // What is true this minute rather than in general: are travel times real
  // right now, or is the quota spent and everything an estimate?
  const [sources, setSources] = useState<Awaited<ReturnType<typeof api.sources>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.sources().then(setSources).catch((e) => setError(e.message)); }, []);

  /**
   * Where a link into the page lands. The info icon beside every filing
   * heading arrives with `?at=<section>`, and the page scrolls to it rather
   * than to the top. Each anchored section is a DOM node with a known id on
   * the web, which is the one thing a screen may reach for by name here;
   * the address itself is only ever read through the router.
   */
  const [at] = useQueryState<HowAnchor | null>('at', null, { read: howAnchorOf, write: (v) => v });
  useEffect(() => {
    if (!at || Platform.OS !== 'web') return;
    // After the paint: the section has to exist before it can be scrolled to.
    const id = requestAnimationFrame(() => {
      document.getElementById(anchorId(at))?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(id);
  }, [at]);

  const now = sources?.routingNow ?? null;
  const paused = now ? now.matrix ?? now.route ?? null : null;

  return (
    <AdminPage>
      <PageHead
        title="How it works"
        sub="The decisions behind what Epic does — what each one buys, what it gives up, and where the rule lives."
      />

      <Banner tone={paused ? 'warn' : 'plain'}>
        {sources == null ? 'Reading what the API is doing…'
          : error ? `Could not read the API: ${error}`
            : sources.routing !== 'google-routes' ? 'No routing key is set, so every travel time on screen is worked out from the distance.'
              : paused ? `Google Routes has no quota left just now, so travel times are worked out from the distance until ${new Date(paused.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
                : 'Google Routes is answering, so travel times on screen are real ones.'}
      </Banner>

      <WhatWeOwe />

      {SECTIONS.map((s) => (
        // `nativeID` is the DOM id on the web, so `?at=facts` can find the
        // section. A section with no anchor is an ordinary panel.
        <View key={s.key} nativeID={s.at ? anchorId(s.at) : undefined}
              style={s.at && s.at === at ? styles.landed : undefined}>
        <Panel title={s.title} sub={s.blurb} padded={false}>
          {s.decisions.map((d, i) => (
            <View key={d.title} style={[styles.row, i > 0 && styles.rowLine]}>
              <View style={styles.head}>
                <Icon name={s.icon} size={16} color={colors.inkMuted} />
                <Text style={[type.h3, { flex: 1 }]}>{d.title}</Text>
                <Pill label={STATE[d.state].label} tone={STATE[d.state].tone} />
              </View>
              <Text style={type.body}>{d.rule}</Text>
              <View style={styles.why}>
                <Text style={[type.tiny, styles.whyLabel]}>WHY</Text>
                <Text style={[type.small, { flex: 1 }]}>{d.why}</Text>
              </View>
              {d.said ? (
                <Text style={styles.quote}>“{d.said.words}” — {d.said.who}, {d.said.on}</Text>
              ) : null}
              {d.where ? <Text style={styles.where}>{d.where}</Text> : null}
            </View>
          ))}
        </Panel>
        </View>
      ))}

      <Panel title="Keeping this page honest" sub="What it is for, and how it is meant to be maintained.">
        <Text style={type.body}>
          A page like this is worthless the moment it describes something that is not true, so every entry says whether it is live or
          only decided, and names the file the rule is in. If an entry cannot be checked against the code in a minute, it is written wrong.
        </Text>
        <Text style={type.small}>
          Anything that changes by the minute — whether travel times are real right now — is read from the API at the top of this page rather
          than written down here.
        </Text>
        <Press onPress={() => Linking.openURL('https://github.com/rogerrivers888/epic/blob/main/CLAUDE.md')} accessibilityRole="link">
          <Text style={styles.link}>The working agreements this page draws on →</Text>
        </Press>
      </Panel>
    </AdminPage>
  );
}

/** The DOM id a section is reached by: `how-facts`. */
const anchorId = (at: HowAnchor) => `how-${at}`;

const styles = StyleSheet.create({
  // The section a link landed on, marked with a moss rule so the eye finds
  // it after the scroll. A rule, not a fill: this surface has no boxes.
  landed: { borderLeftWidth: 3, borderLeftColor: colors.accent, paddingLeft: 12, marginLeft: -15 },
  row: { paddingVertical: 13, gap: 6 },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.lineSoft },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  why: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginTop: 2 },
  whyLabel: { width: 34, paddingTop: 2, fontWeight: '700', letterSpacing: 0.6, color: colors.inkFaint },
  quote: { fontFamily: fonts.body, fontSize: 13, fontStyle: 'italic', color: colors.headerSub, lineHeight: 18 },
  // Where a rule lives: the monospace is what marks it as a path, so it needs
  // no fill behind it. A filled token in a list of them reads as a row of chips.
  where: { fontFamily: MONO, fontSize: 11, color: colors.inkMuted, alignSelf: 'flex-start', paddingVertical: 2 },
  link: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.accent },
});
