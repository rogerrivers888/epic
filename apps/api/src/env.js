import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * The environment, loaded once and carried across the rebrand.
 *
 * Every variable this API reads moved from `ROAM_*` to `EPIC_*` when Roam
 * became Epic (owner, 7 Sep 2026). The values themselves live in Doppler and
 * are injected into Railway by an integration the owner configures by hand, so
 * the code cannot rename them — only he can, one key at a time.
 *
 * So this reads both. Any `ROAM_*` variable with no `EPIC_*` counterpart is
 * aliased to the new name before anything asks for it, which means the deploy
 * running now keeps working on the old keys, each key can be renamed in Doppler
 * whenever it suits, and a key renamed there immediately wins over the old one.
 * When Doppler holds only `EPIC_*` names this file can drop the alias and keep
 * the dotenv load.
 *
 * Imported first by `db.js`, and directly by every entry point, because some
 * modules read `process.env` at module scope and an ES module body runs after
 * all of its imports have been evaluated.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env'), quiet: true });

/** The old names still standing in for new ones, for the back office to show. */
export const aliasedFromRoam = [];

for (const [key, value] of Object.entries(process.env)) {
  if (!key.startsWith('ROAM_')) continue;
  const next = `EPIC_${key.slice('ROAM_'.length)}`;
  if (process.env[next] !== undefined) continue;
  process.env[next] = value;
  aliasedFromRoam.push(key);
}
