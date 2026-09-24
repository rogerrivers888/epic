/**
 * One full suite on this machine at a time.
 *
 * A stopgap, and named as one. There is no CI in this repository, so "main is
 * green" can only be established by a local run — and a local run is not
 * trustworthy while another session is running one. On 21 Sep 2026 two suites
 * at once failed in thirty-one unrelated database-backed files, every one of
 * which passed alone.
 *
 * The root cause is fixed separately: the pools are capped at two connections
 * under test, where the driver's default of ten meant one suite could reach
 * Postgres's hundred on its own. This lock is belt as well as braces, because
 * eighty-eight files rebuilding eighty-eight databases against one Postgres is
 * contention whatever the pool size, and because a suite that has to be taken
 * on trust is worth nothing.
 *
 * Waits rather than refuses: a session that finds the lock held is told who has
 * it and for how long, and carries on when they are done. A lock older than
 * twenty minutes is assumed dead — a suite that long has been killed — and is
 * taken. Removed on exit, including on Ctrl-C.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A fixed path every session shares.
 *
 * This lived under `os.tmpdir()`, which reads `$TMPDIR` — and the sessions on
 * this machine do not all have the same one, so two of them could each hold
 * "the" lock and run two suites into one database. A whole day of red runs was
 * dismissed as machine load before anybody noticed (owner, 24 Sep 2026: "A lock
 * sessions cannot see is not a lock"). The one thing every session demonstrably
 * shares is this checkout, so the lock lives at its root, git-ignored.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const LOCK = path.join(ROOT, '.epic-suite.lock');
const STALE_MS = 20 * 60_000;
const WAIT_MS = 5_000;

const read = () => {
  try { return JSON.parse(fs.readFileSync(LOCK, 'utf8')); } catch { return null; }
};

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

function take() {
  try {
    // `wx` fails if it exists, which is the whole mechanism.
    fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' });
    return true;
  } catch { return false; }
}

export async function holdSuiteLock() {
  let said = false;
  for (;;) {
    if (take()) break;
    const held = read();
    const age = held ? Date.now() - held.at : Infinity;
    // Nobody is behind it, or it has been there far too long to be real.
    if (!held || age > STALE_MS || !alive(held.pid)) {
      try { fs.unlinkSync(LOCK); } catch { /* somebody else got there first */ }
      continue;
    }
    if (!said) {
      const mins = Math.round(age / 60_000);
      console.log(`[suite] another suite is running (pid ${held.pid}, ${mins} min). Waiting — this is the stopgap for having no CI.`);
      said = true;
    }
    await new Promise((r) => { setTimeout(r, WAIT_MS); });
  }
  const drop = () => { try { fs.unlinkSync(LOCK); } catch { /* already gone */ } };
  process.on('exit', drop);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { drop(); process.exit(1); });
  return drop;
}
