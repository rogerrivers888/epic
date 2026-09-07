/**
 * Where Epic lives, in one place.
 *
 * The app is at https://epic.day (owner, 7 Sep 2026), behind Cloudflare, which
 * terminates TLS and hands on to Railway, which terminates again and hands on
 * to this process. Everything that needs to name the site — a sign-in link, the
 * address the crawler publishes, the origin the browser is allowed to call from
 * — reads it from here, so moving the domain again is one variable.
 *
 * `EPIC_APP_URL` is the setting, `APP_URL` is accepted as well because that is
 * what the owner asked for it to be called; every other variable in this API is
 * `EPIC_*`, so that is the one documented. Unset, it falls back to the live
 * domain rather than to a Railway hostname — an unset variable should degrade
 * to the right answer, not to the old one.
 */

const clean = (u) => String(u || '').trim().replace(/\/+$/, '');

/** What the environment says, or '' — so a caller can tell "set" from "default". */
export const configuredAppUrl = () => clean(process.env.EPIC_APP_URL || process.env.APP_URL);

export const APP_URL = configuredAppUrl() || 'https://epic.day';

/** `epic.day` — the bare host, for comparing against an incoming `Host:`. */
export const APP_HOST = (() => {
  try { return new URL(APP_URL).host.toLowerCase(); } catch { return 'epic.day'; }
})();

/**
 * The origins a browser may carry a session from, whatever Doppler says.
 *
 * `EPIC_WEB_ORIGIN` is still the list, but the canonical site is always in it:
 * a CORS allowlist that can be emptied by forgetting to set a variable is a
 * way to take the app down with a config change, and the one origin we are
 * certain about does not need to be configurable.
 */
export const canonicalOrigins = () => [APP_URL, `https://www.${APP_HOST.replace(/^www\./, '')}`];

/** Was this request made over HTTPS, according to whatever proxied it? */
export function isSecure(req) {
  // Cloudflare and Railway both set this; Express parses it into `req.protocol`
  // when `trust proxy` is on, and `req.secure` follows from that.
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (proto) return proto === 'https';
  return Boolean(req.secure);
}

/**
 * Where this request should have gone, or null if it is already there.
 *
 * Answers for the wrong host (a `*.up.railway.app` origin somebody bookmarked,
 * or the `www.` that Cloudflare passes through) and for plain HTTP. Callers
 * decide *which* requests to move: on the API, an `/api` path must never be
 * redirected, because a client that followed it would arrive somewhere that
 * does not answer and the failure would look like an outage.
 */
export function canonicalRedirect(req) {
  const host = String(req.headers.host || '').toLowerCase();
  if (!host) return null;
  const wrongHost = host !== APP_HOST;
  const wrongScheme = !isSecure(req);
  if (!wrongHost && !wrongScheme) return null;
  return `${APP_URL}${req.originalUrl || req.url || '/'}`;
}

/**
 * What Epic calls itself when it fetches somebody else's page, and where they
 * can read about it. One string: eleven copies of a hostname is how the last
 * one went stale.
 */
export const userAgent = (purpose) => `EpicBot/1.0 (+${APP_URL}; ${purpose})`;
