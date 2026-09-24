/**
 * The health check, as a module the suite can import.
 *
 * It lived inline in server.js, which nothing in the suite ever boots, so on
 * 24 Sep 2026 a handler that called two functions the file never imported
 * passed every test, deployed, and answered 503 to the check Railway restarts
 * the service on. A ReferenceError inside an async handler throws before any
 * `.catch` on the call can see it, which is why "reported, never fatal" was
 * fatal (epic-f0). Each reading is now taken inside its own try, and the
 * imports are this file's own.
 */

import { ping } from './db.js';
import { drawersUnjudged, drawersWithoutABar } from './repositories/placeIndex.js';
import { authConfigured } from './auth.js';

/** A reading that cannot take the check down with it: null when it fails. */
const reading = async (fn) => { try { return await fn(); } catch { return null; } };

/**
 * What the service says about itself. Throws only when the database is down,
 * which is the one thing that *should* fail the check.
 *
 * The invariants are against live data rather than the schema: no active
 * drawer without a bar, and no bar with nothing judged against it. A drawer
 * with no bar makes every place in it read "not set" for ever, and thirteen
 * created through the audit API had that hole for weeks because the test that
 * checks it builds its database from migrations and could not see them
 * (owner, 21 Sep 2026). Reported, never fatal: an unjudged drawer is a thing
 * to fix today, not a reason to restart the service.
 */
export async function healthReport() {
  await ping();
  const bare = await reading(drawersWithoutABar);
  const unjudged = await reading(drawersUnjudged);
  return {
    ok: true, service: 'epic-api', db: 'up',
    // Which build answered: Railway sets the commit on the deployment, so
    // "is my change live yet" is a question the API can answer itself.
    commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    // Reported because an API that is not asking for a passcode is a fact
    // the owner needs to be able to see without reading the logs.
    auth: authConfigured() ? 'on' : 'not-configured',
    ...(bare === null ? {} : { drawersWithoutABar: bare.map((d) => d.key) }),
    // Named separately because it is a different fault with a different fix:
    // one drawer needs a bar, the other needs its places rescoring.
    ...(unjudged === null ? {} : { drawersUnjudged: unjudged.map((d) => d.key) }),
  };
}

export async function health(_req, res) {
  try {
    res.json(await healthReport());
  } catch (err) {
    res.status(503).json({ ok: false, service: 'epic-api', db: 'down', error: err.message });
  }
}
