/**
 * The automation log (K15/K16) — the back-office chat's, written by Epic's own money jobs too.
 *
 * Their `logAutomationRun` (repositories/automations.js) records each automatic action with the rule, the evidence
 * and what was done. Until it is on main this writes nothing, and a key their seed list doesn't hold yet is refused
 * by them and said here once — the job itself never fails for the log. Keys the money jobs use:
 *   decides_by · complaint_auto_refund (seeded by them) and chargeback_evidence · payout_release · later_charge ·
 *   stripe_reconcile (to be seeded).
 */

let mod;
const warned = new Set();

async function logger() {
  if (mod !== undefined) return mod;
  try { mod = await import('../repositories/automations.js'); } catch { mod = null; }
  return mod;
}

export async function logAutomation(entry, client = null) {
  const m = await logger();
  const fn = m?.logAutomationRun ?? m?.logRun;
  if (typeof fn !== 'function') return null;
  try {
    return await fn(entry, client);
  } catch (err) {
    if (!warned.has(entry?.automation)) { warned.add(entry?.automation); console.error(`epic-api: automation log — ${entry?.automation}: ${err.code ?? err.message}`); }
    return null;
  }
}
