/**
 * Doors and capabilities: who may enter which application, and what they may do
 * once they are inside.
 *
 * The model is Parcelvision's, which the owner asked Epic to mirror
 * (`backend/app/constants/identity.py`). Three ideas, and the reason each is
 * separate from the others:
 *
 *  - **A door** is which application you may enter: `client` (a household's own
 *    Epic) or `admin` (the back office). Somebody without the admin door is not
 *    shown a refusal — the API answers 404, because a household using Epic has
 *    no business learning that a back office exists.
 *  - **A capability** is what you may do inside. Reading and changing are always
 *    a pair, and the trap PV names in its own docstring is worth repeating: a
 *    capability that "nearly fits" gets borrowed, and then the person who may
 *    invite a friend can also delete a household. A new area declares its own.
 *  - **A role** is a named bundle of both, so an administrator grants "Support"
 *    rather than remembering eleven ticks.
 *
 * Money is its own capability. `view_financials` gates revenue, cost and margin
 * everywhere they appear, and a screen refused by it says so rather than
 * rendering an empty table, which would read as "there is nothing here".
 */

import { roleForAccount } from './repositories/roles.js';

export const DOORS = ['client', 'admin'];

/**
 * Everything anybody can be allowed to do, in the order the roles screen shows
 * them. `area` groups the tick boxes; `manages` marks the ones that change
 * something, which the screen draws differently because granting one is a
 * different kind of decision from granting a read.
 */
export const CAPABILITIES = [
  { key: 'view_accounts', area: 'People', label: 'See accounts', note: 'The list of households, their plan, and when they were last in.' },
  { key: 'manage_accounts', area: 'People', label: 'Manage accounts', note: 'Invite, change a plan or ceiling, suspend, remove.', manages: true },
  { key: 'manage_roles', area: 'People', label: 'Manage roles', note: 'Create roles and grant capabilities — including these.', manages: true },
  // Staff are the people who log in to the back office at all. Managing them —
  // adding a colleague, issuing a login link, changing their role, suspending or
  // removing them — is the one capability the owner keeps to himself: it is not
  // granted to any role in the seed, so only the owner (who holds every
  // capability there is) has it until he grants it on purpose. Reading and
  // changing are one capability here rather than a pair, because there is no
  // one who should see the staff list but not be able to act on it.
  { key: 'manage_staff', area: 'People', label: 'Manage staff', note: 'Add people to the back office, issue login links, change roles, suspend and remove.', manages: true },
  { key: 'view_activity', area: 'Behaviour', label: 'See activity', note: 'What a household has done in Epic, and how long they spend in it.' },
  { key: 'view_reporting', area: 'Behaviour', label: 'See reporting', note: 'Engagement, retention and usage across every household.' },
  { key: 'view_financials', area: 'Money', label: 'See financials', note: 'Revenue, what plans earn, and what providers cost.' },
  { key: 'manage_plans', area: 'Money', label: 'Manage plans', note: 'Set what a plan is called, what it costs and what it allows.', manages: true },
  { key: 'view_library', area: 'Atlas', label: 'See the atlas', note: 'The attractions in each county, and the picture library behind them.' },
  { key: 'manage_library', area: 'Atlas', label: 'Manage the atlas', note: 'Run the harvest, publish and hide attractions, approve uploads and delete pictures.', manages: true },
  { key: 'view_audit', area: 'Governance', label: 'See the audit trail', note: 'Who did what to whom, and when.' },
  { key: 'manage_settings', area: 'Governance', label: 'Manage settings', note: 'Providers, sources and estate-wide configuration.', manages: true },
  { key: 'view_hosting', area: 'Hosting', label: 'See hosts and offers', note: 'Who hosts, what is waiting to be read, and what has been reported.' },
  { key: 'manage_hosting', area: 'Hosting', label: 'Review hosts and offers', note: 'Pass or send back a first pitch, set a host’s trust level, and resolve reports.', manages: true },
  // Reading a vocabulary and changing it are separate, as 034 requires. A word
  // approved into the tag list is a word every host is offered afterwards, so
  // it is not the same privilege as reading the queue.
  { key: 'view_skills', area: 'Hosting', label: 'See host skills', note: 'The browse categories, formats, tags, facets, credential types and the review queue.' },
  { key: 'manage_skills', area: 'Hosting', label: 'Manage host skills', note: 'Approve, merge and reject proposed words, edit the vocabularies, and confirm credentials.', manages: true },
  // The same split again, for the questions asked of a place. Promoting a word
  // into a question set changes what every place of that kind is asked
  // afterwards, and running the harvest spends money; reading the queue does
  // neither.
  { key: 'view_questions', area: 'Places', label: 'See question sets', note: 'The questions asked of each kind of place, what places answered, and the words a harvest has raised.' },
  { key: 'manage_questions', area: 'Places', label: 'Manage question sets', note: 'Promote or ignore a harvested word, add and remove questions, and run the harvest.', manages: true },
];

export const CAPABILITY_KEYS = new Set(CAPABILITIES.map((c) => c.key));

/**
 * Capabilities only the owner may grant to a role.
 *
 * `manage_staff` is in the vocabulary like any other so the roles screen can
 * show it, but granting it is itself a staff decision: an Administrator holds
 * `manage_roles`, so without this they could add `manage_staff` to their own
 * role and let themselves manage staff — the owner-only rule bypassed by one
 * edit. The roles endpoints refuse to grant anything in this set unless the
 * requester is the owner (routes/admin.js).
 */
export const OWNER_ONLY_CAPABILITIES = new Set(['manage_staff']);

/**
 * A session somebody signed into as themselves: a magic link, or Google once it
 * lands. An allowlist, not "anything but the passcode" — an invitation or code
 * session is also nobody's personal sign-in, and a denylist quietly admits
 * every method added later (Codex, 1 Oct 2026). The one definition of
 * "personal"; `accessFor` and every personal-only door read it.
 */
export const PERSONAL_AUTH_METHODS = new Set(['link', 'google']);
export const isPersonalSession = (session) => PERSONAL_AUTH_METHODS.has(session?.auth_method);

/**
 * What an agent session may do: read everything, change nothing (G11, 1 Oct
 * 2026). The owner asked that agents "read, test, propose" — no spending, no
 * lifting holds, no paid grants, no bulk production changes. Tests run on the
 * machine, not through the API; proposing is a pull request, not a write. So
 * through the API an agent holds the reads (the capabilities not marked
 * `manages`) and none of the writes. A coding session signs in on the shared
 * passcode and used to be the owner — everything — which is exactly the hole
 * this closes.
 */
export const VIEW_CAPABILITIES = CAPABILITIES.filter((c) => !c.manages).map((c) => c.key);
const MANAGE_CAPABILITIES = new Set(CAPABILITIES.filter((c) => c.manages).map((c) => c.key));

/**
 * The sections a set of capabilities opens, in the order the roles screen lists
 * them — "People", "Money", "Governance". Used to tell a new staff member what
 * their role lets them open (ST6), so the words come from what they can actually
 * do rather than from a second list that could drift out of step with it.
 */
export function areasFor(capabilities) {
  const held = capabilities instanceof Set ? capabilities : new Set(capabilities ?? []);
  const areas = [];
  for (const c of CAPABILITIES) {
    if (held.has(c.key) && !areas.includes(c.area)) areas.push(c.area);
  }
  return areas;
}

/** The owner's role holds everything there is, including capabilities added later. */
const ALL = () => CAPABILITIES.map((c) => c.key);

/**
 * What this request may do.
 *
 * Three cases, and the middle one is the reason this function exists rather
 * than a column:
 *
 *  - **the shared passcode** — a session with no account. That is the owner, as
 *    it has been since before accounts existed (auth.js), so it holds every
 *    door and every capability.
 *  - **an account with a role** — its role's doors and capabilities, with the
 *    owner role short-circuiting to everything.
 *  - **an account with no role at all** — a household member. The client door,
 *    and nothing else. This is the default, so an account created by a migration
 *    that has not been given a role cannot see the back office by accident.
 */
export async function accessFor(req) {
  const account = req.account ?? null;
  const session = req.session ?? null;
  // A restricted agent is an automated session on the *shared passcode* — a
  // coding session, which has no personal credential. A personal sign-in
  // (a magic link, later Google) is a human even from an automated user agent
  // (okhttp, a bare curl), so it is never caged here (Codex, 1 Oct 2026). This
  // is also why a future native app, which signs in by link, is not read-only.
  const isAgent = session?.kind === 'agent' && session?.auth_method === 'passcode';

  // The baseline: what this account would hold on an ordinary sign-in. Agents
  // are a *downgrade* of this, not a replacement for it — so a household member
  // on an automated user agent is still only a member, never the back office
  // (Codex, 1 Oct 2026). It is the session that is restricted, applied on top
  // of whatever the account already is.
  const base = await baselineAccess(account);

  // Elevated: the owner, signed in personally (a magic link, later Google),
  // from a real device — never the shared passcode, never automated. This is
  // what a privileged action requires (G11), and it is a property of *how* this
  // session signed in, so it is computed here from the session.
  const personal = isPersonalSession(session);
  const notAutomated = session?.kind !== 'agent' && session?.kind !== 'service';
  const elevated = Boolean(base.isOwner && personal && notAutomated);

  if (isAgent) {
    // Read what this account may read, change nothing (G11): the reads it
    // already held, with every `manage_*` removed, and never elevated.
    const reads = new Set([...base.capabilities].filter((k) => !MANAGE_CAPABILITIES.has(k)));
    return {
      doors: base.doors,
      capabilities: reads,
      role: { key: 'agent', label: 'Agent — read & propose', is_owner: false },
      isOwner: false,
      elevated: false,
    };
  }

  return { ...base, elevated };
}

/** What an account holds on an ordinary (non-agent) sign-in, before the session narrows it. */
async function baselineAccess(account) {
  if (!account) {
    // The shared passcode with no claimed owner account: the owner's ordinary
    // way in, so every door and capability.
    return { doors: DOORS, capabilities: new Set(ALL()), role: { key: 'owner', label: 'Owner', isOwner: true }, isOwner: true };
  }
  const role = account.role_id ? await roleForAccount(account.id) : null;
  // `accounts.role` is the older column and still says 'owner' for the founding
  // account; it is honoured so that claiming the owner account never locks the
  // owner out of the back office he built.
  const isOwner = Boolean(role?.is_owner) || account.role === 'owner';
  if (isOwner) {
    return { doors: DOORS, capabilities: new Set(ALL()), role: role ?? { key: 'owner', label: 'Owner', is_owner: true }, isOwner: true };
  }
  if (!role) return { doors: ['client'], capabilities: new Set(), role: null, isOwner: false };
  return {
    doors: Array.isArray(role.doors) ? role.doors : ['client'],
    capabilities: new Set(role.capabilities ?? []),
    role,
    isOwner: false,
  };
}

/** Attached by `requireSession`, so every route below it can ask without a query. */
export const accessOf = (req) => req.access ?? { doors: ['client'], capabilities: new Set(), isOwner: false, role: null, elevated: false };

export const hasDoor = (req, door) => accessOf(req).doors.includes(door);
export const can = (req, capability) => accessOf(req).capabilities.has(capability);

/**
 * The back office's front door.
 *
 * 404, not 403: somebody who may not enter should not learn there is anything
 * to enter. Every admin route sits behind this before any capability is asked
 * about, so an unauthorised caller cannot map the API by comparing refusals.
 */
export function requireDoor(door) {
  return (req, res, next) => {
    if (hasDoor(req, door)) return next();
    return res.status(404).json({ error: 'not_found', message: 'Not found.' });
  };
}

/**
 * One capability, inside a door already granted.
 *
 * This one *is* a 403 with a name in it, and deliberately: the caller is a
 * colleague who is allowed in the building, and "you do not have permission to
 * see financial figures" is something they can act on — ask for it — where an
 * empty screen would read as "there is no revenue".
 */
export function requires(capability) {
  return (req, res, next) => {
    if (can(req, capability)) return next();
    const known = CAPABILITIES.find((c) => c.key === capability);
    return res.status(403).json({
      error: 'not_permitted',
      capability,
      message: `You do not have permission to ${known ? known.label.toLowerCase() : 'do that'}. Ask an administrator for “${known?.label ?? capability}”.`,
    });
  };
}

/**
 * A privileged action: the owner, personally signed in — not the shared
 * passcode, not an agent (G11, owner 1 Oct 2026).
 *
 * "Lift the hold, paid grants, bulk production changes, anything that spends
 * money or overrides a safeguard must require my own signed-in account
 * (roger@epic.day via the e-mail link), and be logged with my name." So this
 * sits in front of those routes, above any capability check, and refuses every
 * session that did not sign in personally — with a 403 that says how to clear
 * it, because the caller is the owner on the wrong kind of session, not an
 * intruder. The action's audit row carries the actor; the route writes it.
 *
 * `action` is a short verb for the message ("lift a census hold").
 */
export function requireOwnerSignedIn(action = 'do that') {
  return (req, res, next) => {
    if (accessOf(req).elevated) return next();
    // Not elevated: refused, with what to file for approval so an agent can ask
    // the owner rather than ask in chat (G11 Approvals). The owner, signed in,
    // then does it. The request line names the call for the approval.
    return res.status(403).json({
      error: 'needs_personal_sign_in',
      message: `This needs you signed in personally to ${action} — open Epic and sign in with your e-mail link. A shared-passcode or agent session can't; file it for approval instead.`,
      request: `${req.method} ${String(req.originalUrl || req.url || '').split('?')[0]}`,
      action,
    });
  };
}

/** What the app is told about itself, so it draws only the doors it holds. */
export function accessPayload(req) {
  const access = accessOf(req);
  return {
    doors: access.doors,
    capabilities: [...access.capabilities],
    role: access.role ? { key: access.role.key, label: access.role.label } : null,
    isOwner: access.isOwner,
    elevated: Boolean(access.elevated),
  };
}
