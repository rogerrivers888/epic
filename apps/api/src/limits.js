/**
 * How often one caller may ask.
 *
 * Three things need this, and they need different numbers:
 *
 *  - the door, hardest. A passcode with no limit on it is a passcode somebody
 *    guesses overnight;
 *  - anything that spends money. Epic's searches call Google Places and Routes
 *    and every call is billed to this household (`provider_calls`), so an
 *    unthrottled search endpoint is somebody else's hand in the owner's wallet;
 *  - everything else, loosely, so one misbehaving script cannot hold the API
 *    down for the family.
 *
 * In memory, on purpose. Epic is a single API service; a shared counter would
 * mean Redis, and Redis for this would be the sidecar the standard says not to
 * add. The trade is honest and worth naming: a restart forgets the counters and
 * a second instance would count separately. If Epic is ever scaled past one
 * instance, this file is the thing that has to change.
 */

/** window → { key → { count, resetAt } }, one map per limiter. */
const buckets = new Map();

/**
 * Who is calling, through two proxies.
 *
 * Cloudflare sets `CF-Connecting-IP` to the client it accepted the connection
 * from and strips any copy the client sent, so it is the one value in the chain
 * a caller cannot forge. `X-Forwarded-For` is the fallback for anything not
 * behind Cloudflare — a direct Railway hostname, or a local run — where the
 * first entry is the caller.
 */
export function callerOf(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.length) return cf.trim();
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function hit(name, key, windowMs, max) {
  let bucket = buckets.get(name);
  if (!bucket) { bucket = new Map(); buckets.set(name, bucket); }
  const now = Date.now();
  const entry = bucket.get(key);
  if (!entry || entry.resetAt <= now) {
    bucket.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: max - 1, resetAt: now + windowMs };
  }
  entry.count += 1;
  return { ok: entry.count <= max, remaining: Math.max(0, max - entry.count), resetAt: entry.resetAt };
}

/**
 * A limiter. `max` requests per `windowMs` per caller; over that, 429 and the
 * seconds until it clears, so a client can wait rather than hammer.
 */
export function limit({ name, windowMs, max, message, keyOf = callerOf }) {
  return (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    const { ok, remaining, resetAt } = hit(name, keyOf(req), windowMs, max);
    const seconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
    res.setHeader('x-ratelimit-remaining', String(remaining));
    if (ok) return next();
    res.setHeader('retry-after', String(seconds));
    return res.status(429).json({ error: 'too_many_requests', message: message || `Too many requests. Try again in ${seconds}s.`, retryAfter: seconds });
  };
}

const MINUTE = 60_000;

/** The door: ten tries a quarter of an hour, which is nothing to a family and a wall to a script. */
export const signInLimit = limit({
  name: 'sign-in',
  windowMs: 15 * MINUTE,
  max: 10,
  message: 'Too many sign-in attempts. Try again in a few minutes.',
});

/** Anything that can reach a paid provider. */
export const spendLimit = limit({
  name: 'spend',
  windowMs: 5 * MINUTE,
  max: 120,
  message: 'That is a lot of searching at once. Give it a minute.',
});

/**
 * Photographs, which are spend but are not searches.
 *
 * They were under `spendLimit` — a hundred and twenty in five minutes — and a
 * single browse screen draws twenty to thirty of them. Six screens and the
 * pictures stopped: every tile on the trip map fell back to its category icon
 * and the drawer said "That is a lot of searching at once", which is a
 * sentence about searching to somebody who has searched once (found 8 Sep
 * 2026).
 *
 * Still bounded, because a photo can still reach Google and be billed. But the
 * budget is set to what a screen actually costs rather than to what a search
 * does — and most of these never reach Google at all: the proxy holds a
 * fetched photo for an hour and only records a provider call on a miss.
 */
export const photoLimit = limit({
  name: 'photos',
  windowMs: 5 * MINUTE,
  max: 600,
  message: 'That is a lot of pictures at once. Give it a minute.',
});

/**
 * Speech, per household rather than per address.
 *
 * A recording is one request but it is a paid minute, and the live captions
 * mint a token per tap. Thirty of either in five minutes is a family talking a
 * lot; a hundred is a script. Keyed on the account's household, so a shared
 * office address does not lock a second household out — with the caller's
 * address as the key for a session that has no account (the passcode).
 */
export const voiceLimit = limit({
  name: 'voice',
  windowMs: 5 * MINUTE,
  max: 30,
  message: 'That is a lot of talking at once. Give it a minute, or type it.',
  keyOf: (req) => req.account?.household_id ?? `ip:${callerOf(req)}`,
});

/** Everything else. Generous: a screen opening can be a dozen requests. */
export const generalLimit = limit({ name: 'general', windowMs: 5 * MINUTE, max: 900 });

/** Forget windows that have passed, so the maps do not grow for ever. */
const sweep = setInterval(() => {
  const now = Date.now();
  for (const bucket of buckets.values()) {
    for (const [key, entry] of bucket) if (entry.resetAt <= now) bucket.delete(key);
  }
}, 10 * MINUTE);
sweep.unref?.();
