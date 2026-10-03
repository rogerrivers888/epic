/**
 * What a free guest account may reach (G21, owner 3 Oct 2026).
 *
 * "Ask to book and joining a waiting list create the same free account as
 * booking (bookings, messages, payments only)." The web app already draws a
 * guest only Plans · Messages · Settings (App.tsx GUEST_TABS); this is the same
 * rule on the server, where it is enforced — a tab that is not drawn is not a
 * door that is shut.
 *
 * An allowlist, not a denylist: a route added later is closed to a guest until
 * somebody decides it is a guest's. What is on it:
 *
 *  - **bookings** — booking, asking to book, the waiting list, the quote;
 *    Plans › Events and every booking page beneath `/api/booked`; the older
 *    `/api/bookings`; an invitation's book;
 *  - **messages** — the guest inbox (`/api/messages`), the chat on a booked
 *    offer (`/api/chat`, which checks who may read each thread itself), and the
 *    notifications;
 *  - **payments** — Settings › Payments and the receipts (`/api/payments`); the
 *    booking's own pay and tip doors are under `/api/booked`;
 *  - **settings** — their own household (who is going on a booking, their
 *    profile, export, delete), their devices, the one telemetry write.
 *
 * Everything else — Inspire, Places, the planner, trips, voice, atlas, menus,
 * hosting, anything that can reach Google or Claude — answers a plain-words
 * 403. The paid gate refuses a guest household as well (sources/paidGate.js,
 * claude.js), so a door that slipped this list still could not spend.
 *
 * Public paths (event pages, host pages, booking options) never reach this:
 * `requireSession` passes them without an account.
 */

export const GUEST_PLAN = 'guest';

export const isGuestAccount = (account) => account?.plan === GUEST_PLAN;

const ANY = null;
/** [methods or ANY, path pattern] — the path is the request's full path, trailing slash removed. */
const ALLOWED = [
  // Settings: their own household and profile, devices, telemetry.
  [['GET', 'PATCH', 'DELETE'], /^\/api\/household$/],
  [['GET'], /^\/api\/household\/export$/],
  [['POST'], /^\/api\/household\/members$/],
  [['PATCH', 'DELETE'], /^\/api\/household\/members\/[^/]+$/],
  [['POST'], /^\/api\/household\/members\/[^/]+\/constraints$/],
  [['PATCH', 'DELETE'], /^\/api\/household\/constraints\/[^/]+$/],
  // Leaving is allowed; inviting somebody in makes an account, which a guest does not.
  [['DELETE'], /^\/api\/household\/members\/[^/]+\/invite$/],
  [ANY, /^\/api\/sessions(\/[^/]+)?$/],
  [['POST'], /^\/api\/activity$/],
  // Bookings.
  [['POST'], /^\/api\/experiences\/[^/]+\/booking(\/quote)?$/],
  [['POST', 'DELETE'], /^\/api\/experiences\/[^/]+\/waitlist$/],
  [['GET'], /^\/api\/experiences\/[^/]+\/mine$/],
  [ANY, /^\/api\/booked(\/.*)?$/],
  [ANY, /^\/api\/bookings(\/[^/]+(\/(cancel|review))?)?$/],
  [['POST'], /^\/api\/invited\/[^/]+\/book$/],
  // Messages.
  [['GET'], /^\/api\/messages$/],
  [ANY, /^\/api\/chat(\/.*)?$/],
  [['GET'], /^\/api\/notifications$/],
  [['POST'], /^\/api\/notifications\/read$/],
  // Payments.
  [['GET'], /^\/api\/payments$/],
];

export function guestMayReach(method, path) {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const m = String(method).toUpperCase();
  return ALLOWED.some(([methods, re]) => (methods === ANY || methods.includes(m) || (m === 'HEAD' && methods.includes('GET'))) && re.test(p));
}

/** Mounted after `requireSession` (server.js): a guest account outside its list is refused, in plain words. */
export function guestDoor(req, res, next) {
  if (req.method === 'OPTIONS' || !isGuestAccount(req.account)) return next();
  if (guestMayReach(req.method, req.path)) return next();
  return res.status(403).json({
    error: 'guest_account',
    message: 'Your free account is for bookings, messages and payments. The rest of Epic comes with a membership.',
  });
}
