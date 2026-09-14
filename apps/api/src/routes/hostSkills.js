/**
 * Host skills: the three doors onto one vocabulary.
 *
 *   /api/host/skills…     the host's own side. Suggestions as they type, and
 *                         what their offer carries. Local only — no external
 *                         call sits in a host's typing path (brief §5).
 *   /api/skills…          the guest's side, and it is public: a tag landing
 *                         page has to work logged-out, because that is where
 *                         the search traffic arrives. The guest side never
 *                         offers "add it as it is" — guests do not grow the
 *                         vocabulary.
 *   /api/admin/skills…    the back office: the curated lists, the open
 *                         vocabulary, the review queue, credentials and the
 *                         source register. Reading and changing are separate
 *                         capabilities (034), so this declares its own pair
 *                         rather than borrowing one that nearly fits.
 *
 * The only outward calls in this file are on the review screen, where an
 * administrator asks Wikidata for candidate identifiers. They are ledgered in
 * `provider_calls` like every other outbound call and nothing waits on them.
 */

import { Router } from 'express';
import { requires } from '../access.js';
import * as repo from '../repositories/hostSkills.js';
import * as providerCalls from '../repositories/providerCalls.js';
import { searchEntities, subclassOf } from '../sources/wikimedia.js';
import { currentHousehold } from './household.js';
import { hostByHousehold, hostById, offerById, offersOfHost, updateOffer } from '../repositories/hosting.js';
import { missingCredentials } from '../domain/hosting.js';
import {
  AGE_BANDS, CREDENTIAL_STATES, FACET_CAP, FACET_KINDS, PROMPTS, PROPOSAL_STATES, TAG_CAP,
  categoryFrom, credentialDisplay, expired, expiryFor, flatters, keyFor, namesTheThing, normalise, promptFor,
} from '../domain/hostSkills.js';

export const router = Router();
export const publicRouter = Router();
export const adminRouter = Router();

const bad = (message, code = 'bad_request') => Object.assign(new Error(message), { status: 400, code });
const vocabOf = (v) => (v === 'facet' ? 'facet' : 'tag');
const str = (v, max = 200) => (v == null ? null : String(v).trim().slice(0, max) || null);
const actorOf = (req) => req.account?.email ?? 'the owner (passcode)';
const hostOf = (householdId) => hostByHousehold(householdId);

/**
 * The vocabulary is ready before anybody types into it.
 *
 * Every canonical label needs its self-alias or the resolver's first pass
 * misses rows whose hand-written key is not the normalisation of their own
 * label — `ammonites`, `churches`. Run at boot, like the taxonomy's own
 * warm-up, and again whenever a label changes.
 */
let ready = null;
export async function ensureSkillsReady() {
  if (!ready) ready = repo.ensureAliases().catch((e) => { ready = null; throw e; });
  return ready;
}

// ---------------------------------------------------------------------------
// shaping
// ---------------------------------------------------------------------------
/**
 * A suggestion row, exactly as the screens draw it: the label, the parent as
 * context in one glance, and a count **only when it flatters**. "34 hosts"
 * reads as company; "0 hosts" reads as an empty shelf and tells a host they are
 * alone on a platform they have not joined yet, so below the floor the row
 * carries its breadcrumb alone.
 */
const asSuggestion = (row, counts, cats) => {
  const n = counts?.[row.key] ?? 0;
  return {
    key: row.key,
    label: row.label,
    /** "Geology and fossils › Palaeontology" — context in one glance, never navigation. */
    breadcrumb: [cats?.[row.category_key], row.parent_label].filter(Boolean).join(' › ') || null,
    parent: row.parent_label ?? null,
    kind: row.kind ?? null,
    categoryKey: row.category_key ?? null,
    note: row.note ?? null,
    hostCount: flatters(n) ? n : null,
    unmapped: !row.external_id,
  };
};

/**
 * A proposal in the shape the client reads.
 *
 * Spreading a Postgres row straight out sends `created_at` where the screen
 * looks for `createdAt`, so the age stamp and the whole decision trail rendered
 * blank — the two things the queue is read for (Codex, 13 Sep 2026).
 */
const asProposal = (p) => ({
  id: p.id, vocab: p.vocab, norm: p.norm, raw: p.raw, count: p.count, state: p.state,
  targetKey: p.target_key ?? null, note: p.note ?? null,
  decidedBy: p.decided_by ?? null, decidedAt: p.decided_at ?? null,
  createdAt: p.created_at, updatedAt: p.updated_at,
  firstOffer: p.first_offer ?? null,
  offers: Number(p.offers ?? 0),
});

/** What an offer carries, in the host's own order, pending ones included. */
const asOfferSkill = (row) => ({
  key: row.target_key,
  raw: row.raw,
  label: row.tag_label ?? row.facet_label ?? row.raw,
  vocab: row.vocab,
  kind: row.facet_kind ?? null,
  categoryKey: row.category_key ?? null,
  position: row.position,
  /** No key yet: live on the offer, in the queue, drawn dashed — never red. */
  pending: !row.target_key,
});

async function decorate(vocab, rows) {
  const cats = Object.fromEntries((await repo.categories({ all: true })).map((c) => [c.key, c.label]));
  const counts = await repo.hostCounts(vocab, rows.map((r) => r.key));
  return rows.map((r) => asSuggestion(r, counts, cats));
}

// ---------------------------------------------------------------------------
// the host's side
// ---------------------------------------------------------------------------
/**
 * GET /api/host/skills — everything the tag step needs in one answer: the
 * prompt for this host's kind, the categories, the formats, the cap, and the
 * words other hosts near them have used.
 */
router.get('/skills', async (req, res, next) => {
  try {
    await ensureSkillsReady();
    const household = await currentHousehold();
    const hostType = str(req.query.hostType) ?? 'skill';
    const [cats, formats, popular] = await Promise.all([
      repo.categories(), repo.formats(),
      repo.listVocabulary('tag', { limit: 12 }),
    ]);
    // "Others near you have said" is, for now, the words most offers carry.
    // Near-you needs a second sweep of host locations and is not worth a slow
    // first paint; the copy is honest either way.
    const starters = (await repo.listVocabulary('tag', { limit: 200 }))
      .sort((a, b) => (b.seen_count ?? 0) - (a.seen_count ?? 0) || a.label.localeCompare(b.label))
      .slice(0, 6);
    // Where the offer happens, turned into a suggestion rather than an answer.
    const lat = req.query.lat == null ? null : Number(req.query.lat);
    const lng = req.query.lng == null ? null : Number(req.query.lng);
    const place = Number.isFinite(lat) && Number.isFinite(lng) ? await repo.placeNear(lat, lng) : null;
    res.json({
      householdId: household?.id ?? null,
      placeSuggestion: place ? { key: place.key, label: place.label, km: Math.round(Number(place.km)) } : null,
      prompt: promptFor(hostType),
      prompts: PROMPTS,
      cap: TAG_CAP,
      facetCap: FACET_CAP,
      ageBands: AGE_BANDS,
      categories: cats.map((c) => ({ key: c.key, label: c.label, blurb: c.blurb, icon: c.icon })),
      formats: formats.map((f) => ({ key: f.key, label: f.label, blurb: f.blurb, icon: f.icon, venueless: f.venueless })),
      starters: await decorate('tag', starters.length ? starters : popular),
    });
  } catch (e) { next(e); }
});

/**
 * GET /api/host/skills/suggest?q=&vocab= — the type-ahead.
 *
 * Local, always. This is the query that must stay under 50ms; if it ever is
 * not, the fix is an index, not a cache of a remote call.
 */
router.get('/skills/suggest', suggestHandler);
publicRouter.get('/skills/suggest', suggestHandler);

async function suggestHandler(req, res, next) {
  try {
    await ensureSkillsReady();
    const vocab = vocabOf(req.query.vocab);
    const q = str(req.query.q, 80) ?? '';
    const rows = await repo.suggest(vocab, q, {
      limit: Math.min(12, Number(req.query.limit) || 8),
      categoryFirst: str(req.query.category) ?? null,
    });
    res.json({
      q,
      vocab,
      /** What the host would be adding if nothing here is it. Never on the guest side. */
      normalised: normalise(q),
      suggestions: await decorate(vocab, rows),
    });
  } catch (e) { next(e); }
}

/** GET /api/host/skills/tag/:key — the detail sheet: the one line, the count, the near-collision. */
router.get('/skills/tag/:key', tagDetail);
publicRouter.get('/skills/tag/:key', tagDetail);

async function tagDetail(req, res, next) {
  try {
    await ensureSkillsReady();
    const vocab = vocabOf(req.query.vocab);
    const [row] = await repo.byKeys(vocab, [req.params.key]);
    if (!row) throw Object.assign(new Error('No such tag.'), { status: 404, code: 'not_found' });
    const [decorated] = await decorate(vocab, [row]);
    const near = await repo.closest(vocab, row.label, { limit: 2, exclude: [row.key] });
    res.json({
      tag: { ...decorated, note: row.note ?? null, externalId: row.external_id ?? null, source: row.source ?? null },
      /** "Not this one?" — how a host tells *Foraging* from *Foraging (animal behaviour)*. */
      near: await decorate(vocab, near),
    });
  } catch (e) { next(e); }
}

/**
 * GET /api/host/credentials — the types this host may claim, and what they have.
 *
 * A credential is evidence, not expertise, so it never enters the tag list and
 * never appears beside one. Blue Badge is a qualification.
 */
router.get('/credentials', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const host = await hostOf(household.id);
    const [types, mine] = await Promise.all([
      repo.credentialTypes(), host ? repo.credentialsFor(host.id) : Promise.resolve([]),
    ]);
    const byKey = Object.fromEntries(types.map((t) => [t.key, t]));
    res.json({
      types: types
        .filter((t) => !host?.type || (t.host_types ?? []).includes(host.type))
        .map((t) => ({
          key: t.key, label: t.label, note: t.note, evidenceRequired: t.evidence_required,
          gatesCategories: t.gates_categories ?? [],
        })),
      held: mine.map((c) => ({
        id: c.id, typeKey: c.type_key, label: c.label, reference: c.reference, detail: c.detail,
        state: c.state, confirmedAt: c.confirmed_at, expiresOn: c.expires_on, note: c.decided_note,
        /** Confirmed once and out of date: it shows nowhere, and the step says so. */
        expired: expired(c),
        /**
         * What a guest would see. A required-evidence type does not display
         * until the back office confirms it, and then displays with the date;
         * one that needs no evidence displays as the host's own claim, labelled
         * as stated. "We have seen this" and "she told us this" are different
         * facts and collapsing them would undo the trust work.
         */
        shows: credentialDisplay(c, byKey[c.type_key]),
      })),
    });
  } catch (e) { next(e); }
});

/** PUT /api/host/credentials — claim one, or correct the number on one already claimed. */
router.put('/credentials', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const host = await hostOf(household.id);
    if (!host) throw bad('Set your host profile up first.');
    const typeKey = str(req.body?.typeKey, 40);
    const types = await repo.credentialTypes();
    const type = types.find((t) => t.key === typeKey);
    if (!type) throw bad('Not one of the credentials Epic asks about.');
    if (host.type && !(type.host_types ?? []).includes(host.type)) throw bad('That one is not asked of your kind of hosting.');
    // Re-claiming a confirmed one puts it back in the queue, which is right —
    // the number changed, so what was checked is no longer what is claimed —
    // but not while live offers are standing on it.
    const holding = await holdingUp(host, typeKey);
    if (type.evidence_required && holding.length) {
      throw bad(`${holding.length === 1 ? 'A live offer is' : `${holding.length} live offers are`} relying on this one. Pause ${holding.length === 1 ? 'it' : 'them'} before changing it, and we will check the new one.`, 'in_use');
    }
    const credential = await repo.claimCredential({
      hostId: host.id, typeKey,
      reference: str(req.body?.reference, 120), detail: str(req.body?.detail, 400),
      // Evidence required means it waits for a person. Nothing else can set
      // `confirmed`, here or anywhere on the host's side.
      state: type.evidence_required ? 'pending' : 'stated',
    });
    res.json({ credential: { id: credential.id, typeKey, state: credential.state } });
  } catch (e) { next(e); }
});

/**
 * DELETE — with one refusal.
 *
 * Where a credential is a *condition* of hosting rather than a badge, taking it
 * away would leave live, bookable offers standing on evidence Epic no longer
 * has (Codex, 14 Sep 2026). Quietly pausing somebody's listings is not ours to
 * do either — a control they questioned is a thing to make clear, not to act on
 * behind them. So this says which offers depend on it and leaves the decision
 * with the host: pause those, or keep the credential.
 */
router.delete('/credentials/:typeKey', async (req, res, next) => {
  try {
    const household = await currentHousehold();
    const host = await hostOf(household.id);
    if (host) {
      const holding = await holdingUp(host, req.params.typeKey);
      if (holding.length) {
        throw bad(`${holding.length === 1 ? 'A live offer needs' : `${holding.length} live offers need`} this — ${holding.map((o) => o.title || 'an untitled one').join(', ')}. Pause ${holding.length === 1 ? 'it' : 'them'} first, or keep this.`, 'in_use');
      }
      await repo.removeCredential(host.id, req.params.typeKey);
    }
    res.json({ removed: req.params.typeKey });
  } catch (e) { next(e); }
});

/**
 * The live offers that would be left without their evidence if this credential
 * went — or came back as a fresh claim waiting to be checked.
 */
async function holdingUp(host, typeKey) {
  const [types, credentials, offers] = await Promise.all([
    repo.credentialTypes({ all: true }), repo.credentialsFor(host.id), offersOfHost(host.id),
  ]);
  const type = types.find((t) => t.key === typeKey);
  if (!(type?.gates_categories ?? []).length) return [];
  /**
   * Asked properly: would this offer actually fail without it?
   *
   * A category gated by two awards is cleared by either, so a host holding the
   * other one is not relying on this at all — and neither is one withdrawing a
   * claim that was only ever pending. Telling them to pause everything in the
   * category would be a refusal they could not act on (Codex, 14 Sep 2026).
   */
  const without = credentials.filter((c) => c.type_key !== typeKey);
  // Live only. A paused offer cannot be booked, so pausing one is exactly how a
  // host withdraws the credential holding it up — and telling them to pause it
  // and then refusing anyway would be an instruction they could not follow
  // (Codex, 14 Sep 2026). Resuming asks again.
  return offers.filter((o) => o.state === 'live' && o.visibility === 'public'
    && missingCredentials(o, host, { types, credentials: without }).length > 0);
}

// ---------------------------------------------------------------------------
// the guest's side
// ---------------------------------------------------------------------------
/** GET /api/skills — the browse row and the formats, for filtering. Sixteen categories, chosen once. */
publicRouter.get('/skills', async (_req, res, next) => {
  try {
    await ensureSkillsReady();
    // The guest's browse row draws a count against each bucket.
    const [cats, formats] = await Promise.all([repo.categories({ counts: true }), repo.formats()]);
    res.json({
      // The public count is of listings a guest could actually open — not
      // drafts, not private ones (Codex, 13 Sep 2026).
      categories: cats.map((c) => ({ key: c.key, label: c.label, blurb: c.blurb, icon: c.icon, offers: Number(c.public_offers) })),
      formats: formats.map((f) => ({ key: f.key, label: f.label, blurb: f.blurb, icon: f.icon })),
    });
  } catch (e) { next(e); }
});

/**
 * GET /api/skills/tag/:key/hosts — the tag landing page.
 *
 * Public and logged-out, because "fossil hunting Jurassic Coast" is a search
 * people actually make and the long tail is built out of exactly these pages.
 * A sparse answer is not an empty shelf: one host is the rarest thing on Epic
 * this week, and the screen says so.
 */
publicRouter.get('/skills/tag/:key/hosts', async (req, res, next) => {
  try {
    await ensureSkillsReady();
    const vocab = vocabOf(req.query.vocab);
    const [row] = await repo.byKeys(vocab, [req.params.key]);
    if (!row) throw Object.assign(new Error('No such tag.'), { status: 404, code: 'not_found' });
    const [decorated] = await decorate(vocab, [row]);
    const country = str(req.query.country, 2);
    const [hosts, hostCount, near, cats] = await Promise.all([
      repo.hostsForTag(vocab, row.key, { country }),
      // Not `hosts.length`: that is a page of them, and a tag with forty-one
      // hosts would read as exactly forty for ever (Codex, 13 Sep 2026).
      repo.hostCountForTag(vocab, row.key, { country }),
      repo.neighbours(vocab, row.key),
      repo.categories({ all: true }),
    ]);
    const byKey = Object.fromEntries(cats.map((c) => [c.key, c.label]));
    res.json({
      tag: { ...decorated, note: row.note ?? null, hostCount },
      hosts: hosts.map((h) => ({
        hostId: h.host_id, name: h.host_name, type: h.host_type, trust: h.trust,
        location: h.location_label, photoId: h.photo_id,
        offerId: h.offer_id, title: h.title, shape: h.shape, state: h.state,
        area: h.venue_area, category: byKey[h.category_key] ?? null,
        // `by_numbers` keeps its figure in `total_pence`, so a whole-group
        // offer showed a dash on its own tag page (Codex, 14 Sep 2026).
        priceMode: h.price_mode, pricePence: h.price_pence, totalPence: h.total_pence, per: h.per,
      })),
      /** `Close to it` — where a sparse page sends somebody next. */
      near: await decorate(vocab, near),
    });
  } catch (e) { next(e); }
});

/**
 * GET /api/skills/attribution — the one credits line.
 *
 * Only the CC BY and ODC-By sources trigger it, never Wikidata, which is CC0.
 * We take labels as inspiration and identifiers as pointers rather than
 * redistributing datasets, so the obligation is one page linked from tag pages
 * — not a byline under every chip.
 */
publicRouter.get('/skills/attribution', async (_req, res, next) => {
  try { res.json({ sources: await repo.attributionOwed() }); } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// the back office
// ---------------------------------------------------------------------------
adminRouter.get('/', requires('view_skills'), async (_req, res, next) => {
  try {
    await ensureSkillsReady();
    const [cats, formats, types, sources, waiting, credentials] = await Promise.all([
      repo.categories({ all: true, counts: true }), repo.formats({ all: true, counts: true }), repo.credentialTypes({ all: true }),
      repo.sources({ all: true }), repo.openCount(), repo.credentialsWaiting(),
    ]);
    res.json({
      categories: cats, formats, credentialTypes: types, sources,
      queue: { open: waiting.n, oldest: waiting.oldest },
      credentialsWaiting: credentials.length,
      cap: TAG_CAP,
      facetKinds: FACET_KINDS,
      trigram: await repo.hasTrigram(),
    });
  } catch (e) { next(e); }
});

adminRouter.get('/vocabulary', requires('view_skills'), async (req, res, next) => {
  try {
    const vocab = vocabOf(req.query.vocab);
    const rows = await repo.listVocabulary(vocab, {
      all: req.query.all === '1', q: str(req.query.q, 80),
      limit: Math.min(500, Number(req.query.limit) || 300),
      offset: Math.max(0, Number(req.query.offset) || 0),
    });
    const counts = await repo.hostCounts(vocab, rows.map((r) => r.key));
    res.json({ vocab, rows: rows.map((r) => ({ ...r, offers: Number(r.offers), hosts: counts[r.key] ?? 0 })) });
  } catch (e) { next(e); }
});

adminRouter.put('/category', requires('manage_skills'), async (req, res, next) => {
  try {
    const key = str(req.body?.key, 40);
    if (!key) throw bad('A category needs a key.');
    res.json({ category: await repo.saveCategory({ ...req.body, key }) });
  } catch (e) { next(e); }
});

adminRouter.put('/format', requires('manage_skills'), async (req, res, next) => {
  try {
    const key = str(req.body?.key, 40);
    if (!key) throw bad('A format needs a key.');
    res.json({ format: await repo.saveFormat({ ...req.body, key }) });
  } catch (e) { next(e); }
});

/**
 * Deleting a value in use is refused with a count.
 *
 * Deactivation is the ordinary answer: a category no longer offered must still
 * render on the offers already carrying it. Only an unused row can actually go.
 */
const removeValue = (what) => async (req, res, next) => {
  try {
    const { offers, tags } = await repo.offersUsing(what, req.params.key);
    if (offers > 0) {
      throw bad(`${offers} offer${offers === 1 ? '' : 's'} still ${offers === 1 ? 'carries' : 'carry'} this. Switch it off instead — it stays on those and stops being offered.`, 'in_use');
    }
    if (tags > 0) {
      throw bad(`${tags} tag${tags === 1 ? '' : 's'} read${tags === 1 ? 's' : ''} under this, and a tag with no bucket cannot tell an offer where to be listed. Move them first, or switch this off instead.`, 'in_use');
    }
    if (what === 'category') await repo.removeCategory(req.params.key); else await repo.removeFormat(req.params.key);
    res.json({ removed: req.params.key });
  } catch (e) { next(e); }
};
adminRouter.delete('/category/:key', requires('manage_skills'), removeValue('category'));
adminRouter.delete('/format/:key', requires('manage_skills'), removeValue('format'));

adminRouter.put('/tag', requires('manage_skills'), async (req, res, next) => {
  try {
    const key = str(req.body?.key, 60) || keyFor(req.body?.label ?? '');
    if (!key) throw bad('A tag needs a label.');
    if (req.body?.parentKey === key) throw bad('A tag cannot be its own parent.');
    const [was] = await repo.byKeys('tag', [key]);
    const tag = await repo.saveTag({ ...req.body, key });
    /**
     * A rename claims its new wording only if nobody else has it. It stands
     * aside rather than taking it, and the screen is told: two rows quietly
     * answering to one word is the failure this whole vocabulary exists to
     * avoid (Codex, 14 Sep 2026).
     */
    let taken = null;
    if (req.body?.label) {
      const landed = await repo.addAlias('tag', normalise(req.body.label), key, req.body.label);
      if (!landed) taken = `Somebody already answers to “${req.body.label}”, so searches for it still go there. Merge them if they are the same thing.`;
    }
    /**
     * Moving a tag into another bucket re-files the offers that carry it.
     *
     * The browse category is derived from the tags, so changing where a tag
     * reads has to change where its offers are listed — otherwise they stay
     * under the old bucket for ever, and a later save mistakes that stale value
     * for a category the host chose (Codex, 14 Sep 2026).
     */
    let paused = [];
    if (was && tag.category_key !== was.category_key) {
      const moved = await repo.recomputeCategories(await repo.offersWithTag(key), key, undefined, { wasCategory: was.category_key });
      paused = await pauseWhatNoLongerQualifies(moved);
    }
    res.json({ tag, paused, taken });
  } catch (e) { next(e); }
});

adminRouter.put('/facet', requires('manage_skills'), async (req, res, next) => {
  try {
    const key = str(req.body?.key, 60) || keyFor(req.body?.label ?? '');
    if (!key) throw bad('A facet needs a label.');
    if (req.body?.kind && !FACET_KINDS.includes(req.body.kind)) throw bad('Not one of the facet kinds.');
    // The same guard the tag endpoint has: Postgres is happy with a row that
    // points at itself, and the breadcrumb and the neighbours are not (Codex,
    // 14 Sep 2026).
    if (req.body?.parentKey === key) throw bad('A facet cannot be its own parent.');
    const facet = await repo.saveFacet({ ...req.body, key });
    let taken = null;
    if (req.body?.label) {
      const landed = await repo.addAlias('facet', normalise(req.body.label), key, req.body.label);
      if (!landed) taken = `Somebody already answers to “${req.body.label}”, so searches for it still go there. Merge them if they are the same thing.`;
    }
    res.json({ facet, taken });
  } catch (e) { next(e); }
});

adminRouter.get('/aliases', requires('view_skills'), async (req, res, next) => {
  try {
    res.json({ aliases: await repo.aliasesFor(vocabOf(req.query.vocab), str(req.query.key, 60)) });
  } catch (e) { next(e); }
});

// --- the review queue ------------------------------------------------------
/**
 * GET /api/admin/skills/queue — the part used daily.
 *
 * Ordered by how often each has been typed, because the wording six hosts used
 * is worth a decision before the one somebody typed once.
 */
adminRouter.get('/queue', requires('view_skills'), async (req, res, next) => {
  try {
    const state = str(req.query.state, 20) ?? 'open';
    /**
     * Fifty a page, and the decorating done once for the page rather than once
     * per row.
     *
     * Each proposal needs its closest three, which is a query apiece and cannot
     * be helped; what can be helped is asking for the categories and the host
     * counts again for every one of them. Two hundred rows that way was six
     * hundred round trips to a database in another data centre, on the screen
     * that is opened daily (Codex, 13 Sep 2026).
     */
    const rows = await repo.proposals({ state, limit: 50 });
    const cats = Object.fromEntries((await repo.categories({ all: true })).map((c) => [c.key, c.label]));
    const near = await Promise.all(rows.map((p) => repo.closest(p.vocab, p.raw, { limit: 3 })));
    const counts = {
      tag: await repo.hostCounts('tag', near.flat().filter((r) => r.kind == null).map((r) => r.key)),
      facet: await repo.hostCounts('facet', near.flat().filter((r) => r.kind != null).map((r) => r.key)),
    };
    const out = rows.map((p, i) => ({
      ...asProposal(p),
      /** Up to three merge targets. Merge is the most-used button on this screen. */
      targets: near[i].map((r) => asSuggestion(r, counts[p.vocab] ?? {}, cats)),
    }));
    res.json({ proposals: out, ...(await repo.openCount()) });
  } catch (e) { next(e); }
});

adminRouter.get('/queue/:id', requires('view_skills'), async (req, res, next) => {
  try {
    const p = await repo.proposalById(req.params.id);
    if (!p) throw Object.assign(new Error('No such proposal.'), { status: 404, code: 'not_found' });
    const [offers, near] = await Promise.all([
      repo.proposalOffers(p.vocab, p.norm), repo.closest(p.vocab, p.raw, { limit: 3 }),
    ]);
    res.json({ proposal: asProposal(p), offers, targets: await decorate(p.vocab, near) });
  } catch (e) { next(e); }
});

/**
 * POST /api/admin/skills/queue/:id — approve, merge or reject.
 *
 *   approve  it becomes canonical and every offer carrying those words
 *            repoints. No further editing needed.
 *   merge    the offers repoint to the survivor and the wording is kept as an
 *            alternative that resolves to it — which is also what makes a guest
 *            searching the wording find the survivor.
 *   reject   the host keeps their words, and the same wording never raises a
 *            new proposal. The row stays; that is what closes it.
 */
adminRouter.post('/queue/:id', requires('manage_skills'), async (req, res, next) => {
  try {
    const p = await repo.proposalById(req.params.id);
    if (!p) throw Object.assign(new Error('No such proposal.'), { status: 404, code: 'not_found' });
    const decision = str(req.body?.decision, 20);
    if (!['approve', 'merge', 'reject'].includes(decision)) throw bad('Approve, merge or reject.');
    // Approving writes an alias and repoints every offer carrying the wording,
    // so a second tap from a stale screen must not be able to follow it with a
    // different decision (Codex, 13 Sep 2026).
    if (p.state !== 'open') throw bad(`That one was already ${p.state}${p.decided_by ? ` by ${p.decided_by}` : ''}. Open the queue again to see where it stands.`, 'not_open');
    const by = actorOf(req);

    if (decision === 'reject') {
      const proposal = await repo.decideProposal(p.id, { state: 'rejected', note: str(req.body?.note, 400), by });
      if (!proposal) throw bad('Somebody else has just decided that one.', 'not_open');
      return res.json({ proposal: asProposal(proposal) });
    }

    if (decision === 'merge') {
      const target = str(req.body?.targetKey, 60);
      if (!target) throw bad('Say which tag it merges into.');
      const [row] = await repo.byKeys(p.vocab, [target]);
      if (!row) throw bad('That tag does not exist.');
      /**
       * The decision and what it does are one act.
       *
       * Claiming it first stops a second administrator repointing the same
       * wording at a different survivor; doing it in a transaction means a
       * failure half-way leaves the proposal open to be tried again, rather
       * than closed with nothing to show for it (Codex, 13 Sep 2026).
       */
      const done = await repo.withTransaction(async (client) => {
        const proposal = await repo.decideProposal(p.id, { state: 'merged', targetKey: target, note: str(req.body?.note, 400), by }, client);
        if (!proposal) return null;
        await repo.addAlias(p.vocab, p.norm, target, p.raw, client, { steal: true });
        const moved = await repo.repoint(p.vocab, p.norm, target, client);
        return { proposal, moved };
      });
      if (!done) throw bad('Somebody else has just decided that one.', 'not_open');
      const paused = await pauseWhatNoLongerQualifies(done.moved);
      return res.json({ proposal: asProposal(done.proposal), target: row, paused });
    }

    // Approve. The label is the administrator's — the host's wording is what
    // was typed, not necessarily what Epic should call it — but it defaults to
    // their words so the common case is one tap.
    const label = str(req.body?.label, 80) ?? p.raw;
    const key = str(req.body?.key, 60) || keyFor(label);
    /**
     * A tag has to land in a bucket.
     *
     * The browse category is *derived from the tags*, so a canonical tag with
     * no category cannot take part in the one thing the whole design turns on:
     * every offer carrying it would have to be filed by hand (Codex, 13 Sep
     * 2026). Named, or taken from the parent it was placed under; and if
     * neither, this says so rather than quietly making a tag that does not
     * work. A facet is not asked — it is not what a browse row is built from.
     */
    /**
     * Approving into a key that already exists is a merge, and has to be said
     * as one.
     *
     * `saveTag` upserts, so this would have quietly rewritten the label,
     * parent and bucket of a canonical row while recording the proposal as
     * approved — and a long wording truncating onto an existing key would do it
     * without anybody typing the same thing twice (Codex, 14 Sep 2026).
     */
    const [clash] = await repo.byKeys(p.vocab, [key]);
    if (clash) {
      throw bad(`“${clash.label}” already has that name. Merge into it instead, or approve this one under a different one.`, 'already_exists');
    }
    const parentKey = str(req.body?.parentKey, 60);
    let categoryKey = str(req.body?.categoryKey, 40);
    if (p.vocab === 'tag' && !categoryKey && parentKey) {
      const [parent] = await repo.byKeys('tag', [parentKey]);
      categoryKey = parent?.category_key ?? null;
    }
    if (p.vocab === 'tag' && !categoryKey) {
      throw bad('Say which of the sixteen it reads under — that is what decides where an offer carrying it is listed.', 'category_required');
    }
    // Five writes, one act. A parent or a category that does not exist is a
    // foreign key away from failing, and that must leave the queue as it was.
    const done = await repo.withTransaction(async (client) => {
      const proposal = await repo.decideProposal(p.id, { state: 'approved', targetKey: key, by }, client);
      if (!proposal) return null;
      const saved = p.vocab === 'facet'
        ? await repo.saveFacet({ key, label, kind: str(req.body?.kind, 20) ?? 'subject', parentKey, note: str(req.body?.note, 400), source: str(req.body?.source, 40), externalId: str(req.body?.externalId, 40) }, client)
        : await repo.saveTag({ key, label, parentKey, categoryKey, note: str(req.body?.note, 400), source: str(req.body?.source, 40), externalId: str(req.body?.externalId, 40) }, client);
      /**
       * The new row has to answer to its own name.
       *
       * If that wording is already another row's alias this stands aside — and
       * ignoring that left a canonical row whose own label searched to
       * somebody else (Codex, 14 Sep 2026). Inside the transaction, so the
       * refusal takes the row and the decision with it.
       */
      const named = await repo.addAlias(p.vocab, normalise(label), key, label, client);
      if (!named) throw bad(`Something else already answers to “${label}”. Merge into it, or give this one a name of its own.`, 'already_exists');
      await repo.addAlias(p.vocab, p.norm, key, p.raw, client, { steal: true });
      const moved = await repo.repoint(p.vocab, p.norm, key, client);
      return { proposal, saved, moved };
    });
    if (!done) throw bad('Somebody else has just decided that one.', 'not_open');
    const paused = await pauseWhatNoLongerQualifies(done.moved);
    res.json({ proposal: asProposal(done.proposal), tag: done.saved, paused });
  } catch (e) { next(e); }
});

/**
 * A decision here can move a live offer into a different bucket — and which
 * bucket an offer is in decides which credentials are a condition of hosting
 * it. So anything that lands somewhere its host does not qualify for comes out
 * of the window, exactly as an edit by the host would (Codex, 14 Sep 2026).
 * The screen is told which, because an administrator's approval having paused
 * somebody's listing is not a thing to find out later.
 */
async function pauseWhatNoLongerQualifies(offerIds) {
  const out = [];
  for (const id of offerIds ?? []) {
    const offer = await offerById(id);
    if (offer?.state !== 'live') continue;
    const host = await hostById(offer.host_id);
    if (!host) continue;
    const [types, credentials] = await Promise.all([repo.credentialTypes({ all: true }), repo.credentialsFor(host.id)]);
    const missing = missingCredentials(offer, host, { types, credentials });
    if (!missing.length) continue;
    await updateOffer(offer.id, { state: 'paused', pausedUntil: null });
    out.push({ offerId: offer.id, title: offer.title, hostId: host.id, host: host.name, why: missing[0] });
  }
  return out;
}

/**
 * GET /api/admin/skills/candidates?q= — Wikidata, asked by a person.
 *
 * The only outward call in the skills work, and it happens here rather than
 * anywhere near a host's keyboard. The description comes back so an
 * administrator can tell *foraging* the human activity from *foraging* the
 * animal behaviour, and is shown rather than stored.
 */
adminRouter.get('/candidates', requires('manage_skills'), async (req, res, next) => {
  try {
    const q = str(req.query.q, 120);
    if (!q) throw bad('Give it a word to look up.');
    const household = await currentHousehold().catch(() => null);
    const candidates = await searchEntities(q, { limit: 8 });
    await providerCalls.record(household?.id ?? null, 'wikidata', 'skills candidate lookup', candidates.length);
    res.json({ q, candidates });
  } catch (e) { next(e); }
});

/**
 * GET /api/admin/skills/identifiers — how much of the vocabulary is named.
 */
adminRouter.get('/identifiers', requires('view_skills'), async (req, res, next) => {
  try {
    const [counts, waiting, refused] = await Promise.all([
      repo.identifierCounts(),
      repo.identifierProposals({ exactOnly: req.query.exact === '1' }),
      repo.refusedIdentifiers(),
    ]);
    res.json({ counts, waiting, refused });
  } catch (e) { next(e); }
});

/**
 * POST /api/admin/skills/identifiers/propose — one run over every unnamed tag.
 *
 * It writes nothing into `external_id`. Wikidata is asked once per tag and the
 * best candidate is put *beside* the tag with the description that tells the
 * senses apart, because a plain search cannot: *foraging* has an
 * animal-behaviour sense and *fossil collector* outranks *fossil collecting*.
 * A proposal whose wording matches letter for letter is marked exact, which is
 * the only thing safe to accept in a batch.
 *
 * It answers straight away and reads in the background — 465 lookups is well
 * past what a gateway will hold a request open for.
 */
let lookingUp = false;
adminRouter.post('/identifiers/propose', requires('manage_skills'), async (req, res, next) => {
  try {
    // One run at a time, and the flag is taken *before* the first await: two
    // clicks arriving together both saw it clear while the queue was still
    // being read, and both ran (Codex, 14 Sep 2026, twice).
    if (lookingUp) return res.json({ started: 0, already: true });
    lookingUp = true;
    let todo;
    try {
      // "Look again" drops the proposals nobody has acted on first, so a run
      // can re-judge them. Accepted identifiers and refusals are decisions and
      // are never touched.
      if (req.body?.again) await repo.clearProposals();
      const limit = Math.min(600, Math.max(1, Number(req.body?.limit ?? 600)));
      todo = (await repo.withoutIdentifier()).slice(0, limit);
    } catch (e) { lookingUp = false; throw e; }
    if (!todo.length) { lookingUp = false; return res.json({ started: 0 }); }
    res.json({ started: todo.length });
    const household = await currentHousehold().catch(() => null);
    void (async () => {
      let asked = 0;
      try {
      for (const tag of todo) {
        try {
          const candidates = await searchEntities(tag.label, { limit: 5 });
          asked += 1;
          const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
          // Exact means *one* entity is called this, not "the first one that is".
          // Wikidata has several items called foraging — the human activity and
          // the animal behaviour — and taking the first of those in a batch of
          // four hundred is exactly the mistake this run exists to avoid
          // (Codex, 14 Sep 2026). Two of a name is an ambiguity for a person.
          // Named the same *and* actually the thing. A unique name match is
          // not a safe match: the only item called Bell Ringing is an episode
          // of Teletubbies and the only one called Beach Days is a painting,
          // and both looked like certainties on the first run (14 Sep 2026).
          const named = candidates.filter((c) => same(c.label, tag.label));
          const real = named.filter((c) => namesTheThing(c.description));
          const best = real[0] ?? named[0] ?? candidates[0];
          if (!best) continue;
          await repo.propose({
            key: tag.key, qid: best.qid, label: best.label, note: best.description,
            exact: real.length === 1 && named.length === real.length,
          });
        } catch { /* one word failing is not the run failing */ }
      }
      } finally { lookingUp = false; }
      await providerCalls.record(household?.id ?? null, 'wikidata', 'skills identifier run', asked).catch(() => {});
    })();
  } catch (e) { next(e); }
});

/**
 * PUT /api/admin/skills/identifiers — a person accepts or refuses proposals.
 *
 * This is the only thing that turns a proposal into an identifier. Refusing
 * leaves the tag with none, which is a legitimate state and reads as unmapped.
 */
adminRouter.put('/identifiers', requires('manage_skills'), async (req, res, next) => {
  try {
    const keys = Array.isArray(req.body?.keys) ? req.body.keys.map((k) => str(k, 80)).filter(Boolean) : [];
    if (!keys.length) throw bad('Which tags?');
    const took = req.body?.reopen ? await repo.reopenIdentifiers(keys)
      : req.body?.take === false ? await repo.refuseProposals(keys)
      : await repo.acceptProposals(keys);
    res.json({ changed: took, counts: await repo.identifierCounts() });
  } catch (e) { next(e); }
});

/**
 * GET /api/admin/skills/parents?qid= — what Wikidata says it is a subclass of.
 *
 * A suggestion for a person placing a tag, and nothing else. P279 never writes
 * unattended: the class graph has cycles, and a naive closure from *foraging*
 * pulls in animal behaviour and psychology.
 */
adminRouter.get('/parents', requires('manage_skills'), async (req, res, next) => {
  try {
    const qid = str(req.query.qid, 20);
    if (!qid) throw bad('Give it a QID.');
    const household = await currentHousehold().catch(() => null);
    const parents = await subclassOf(qid);
    await providerCalls.record(household?.id ?? null, 'wikidata', 'skills parent suggestion', parents.length);
    res.json({ qid, parents, note: 'Wikidata’s own subclasses, as a suggestion. The parent Epic uses is the one you set.' });
  } catch (e) { next(e); }
});

// --- credentials -----------------------------------------------------------
adminRouter.get('/credentials', requires('view_skills'), async (_req, res, next) => {
  try {
    const [types, waiting] = await Promise.all([repo.credentialTypes({ all: true }), repo.credentialsWaiting()]);
    res.json({ types, waiting });
  } catch (e) { next(e); }
});

adminRouter.put('/credential-type', requires('manage_skills'), async (req, res, next) => {
  try {
    const key = str(req.body?.key, 40);
    if (!key) throw bad('A credential type needs a key.');
    const [was] = (await repo.credentialTypes({ all: true })).filter((t) => t.key === key);
    const type = await repo.saveCredentialType({ ...req.body, key });
    /**
     * Making a credential a condition applies it to what is already out there.
     *
     * Otherwise the rule sits there doing nothing until a guest happens to try
     * to book — and the first person to find out is that guest, who is turned
     * away (Codex, 14 Sep 2026). So every live listing in a bucket this rule
     * now guards is checked at the moment the rule is made, and the ones whose
     * host does not qualify come off the window with a reason.
     */
    const nowGated = type.gates_categories ?? [];
    const before = new Set(was?.gates_categories ?? []);
    const hostsBefore = new Set(was?.host_types ?? []);
    // Stricter by any of its four axes: a bucket added, evidence now asked for,
    // the whole type switched back on — or a kind of host newly covered by a
    // rule that was already a condition, which is the same thing for everyone
    // who has just been brought inside it (Codex, 14 Sep 2026).
    // …and a shortened life, which `saveCredentialType` has just applied to
    // every confirmation it made — some of which may now be in the past
    // (Codex, 14 Sep 2026).
    const shorter = nowGated.length > 0 && type.expires_months != null
      && (was?.expires_months == null || type.expires_months < was.expires_months);
    const stricter = nowGated.filter((c) => !before.has(c)).length > 0
      || (type.evidence_required && !was?.evidence_required)
      || (was?.active === false && type.active)
      || (nowGated.length > 0 && (type.host_types ?? []).some((h) => !hostsBefore.has(h)))
      || shorter;
    const affected = stricter ? await repo.liveOffersIn(nowGated) : [];
    const paused = await pauseWhatNoLongerQualifies(affected.map((o) => o.id));
    res.json({ type, paused });
  } catch (e) { next(e); }
});

/**
 * POST /api/admin/skills/credentials/:id — confirm or refuse one.
 *
 * Confirmation is a back-office act, consistent with the rule that a host never
 * sets their own trust level. A refusal stops the credential displaying, tells
 * the host, and keeps the record.
 */
adminRouter.post('/credentials/:id', requires('manage_skills'), async (req, res, next) => {
  try {
    /**
     * Two answers, and only two.
     *
     * `CREDENTIAL_STATES` is the column's whole vocabulary; this door is the
     * one where somebody says whether they have seen the evidence. Letting it
     * write `stated` would take a required claim out of the queue without
     * anybody deciding it, and `pending` would stamp a decision that had not
     * been made (Codex, 14 Sep 2026).
     */
    const state = str(req.body?.state, 20);
    if (!['confirmed', 'rejected'].includes(state)) throw bad('Confirm it, or refuse it.');
    const types = await repo.credentialTypes({ all: true });
    const waiting = await repo.credentialsWaiting();
    const row = waiting.find((c) => c.id === req.params.id) ?? null;
    const type = types.find((t) => t.key === row?.type_key) ?? null;
    if (!row) throw bad('That one has already been decided. Open the list again to see where it stands.', 'not_pending');
    const credential = await repo.decideCredential(req.params.id, {
      state,
      expiresOn: state === 'confirmed' ? expiryFor(type) : null,
      note: str(req.body?.note, 400),
      by: actorOf(req),
    });
    // The row was pending a moment ago and is not now: somebody else decided it
    // between the screen loading and this call.
    if (!credential) throw bad('Somebody else has just decided that one.', 'not_pending');
    res.json({ credential });
  } catch (e) { next(e); }
});

// --- the source register ---------------------------------------------------
adminRouter.get('/sources', requires('view_skills'), async (_req, res, next) => {
  try { res.json({ sources: await repo.sources({ all: true }) }); } catch (e) { next(e); }
});

adminRouter.put('/source', requires('manage_skills'), async (req, res, next) => {
  try {
    const key = str(req.body?.key, 40);
    if (!key) throw bad('A source needs a key.');
    res.json({ source: await repo.saveSource({ ...req.body, key }) });
  } catch (e) { next(e); }
});

export { PROPOSAL_STATES, categoryFrom, credentialDisplay };
export default router;
