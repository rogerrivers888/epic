/**
 * The commercial register: who Epic pays, at what rate, and whether the pipe is
 * plugged in.
 *
 * Read and written, because the supplier record is an editing screen (handoff
 * §5a): the owner edits a rate, confirms one is still right, rotates a
 * credential and turns an adapter off. Three rules hold it together.
 *
 *  · **A rate is inserted, never updated.** A change closes the row in force
 *    and writes a new one with the date it took effect, so the cost of a call
 *    made last quarter stays priced at what it cost then.
 *  · **Confirming is not changing.** "This rate is still right" stamps
 *    `confirmed_at` and writes no new row — which is the whole point of having
 *    the two fields, because "nobody has checked this in six months" is a
 *    different fact from "this changed six months ago".
 *  · **Only a masked credential is ever held here.** The secret is Doppler's
 *    (CLAUDE.md). What is stored is the last few characters and whatever says
 *    which key it is, which is all the screen needs to answer "is the right key
 *    in there".
 *
 * Spend, volume and the twelve-month series are not in this register — they are
 * read from `provider_calls`, joined on `provider_key`. A register that carried
 * its own spend figure would be a second version of the ledger.
 */

import { query, withTransaction } from '../db.js';
import { setSourceOff, sourceKeys, sourceOff } from '../sources/index.js';

export const DIRECTIONS = ['inbound_cost', 'outbound_revenue', 'both'];
export const STATUSES = ['live', 'degraded', 'trial', 'off', 'approved', 'evaluating', 'declined', 'retired'];
export const ADAPTER_STATES = ['none', 'built', 'wired', 'enabled'];

const bad = (message, code) => Object.assign(new Error(message), { status: 400, code });

/** Every counterparty, with the rate in force and when it was last confirmed. */
export async function listCounterparties() {
  const { rows } = await query(
    `select c.*,
            r.id           as rate_id,
            r.says         as rate_says,
            r.amount       as rate_amount,
            r.unit         as rate_unit,
            r.currency     as rate_currency,
            r.confirmed_at as rate_confirmed_at,
            r.confirmed_by as rate_confirmed_by,
            r.source_url   as rate_source_url,
            r.effective_from as rate_from
       from counterparties c
       left join lateral (
         select * from counterparty_rates r
          where r.counterparty_key = c.key and r.sku = 'default' and r.effective_to is null
          order by r.effective_from desc limit 1
       ) r on true
      order by c.position, c.key`,
  );
  return rows.map(shape);
}

export async function counterpartyByKey(key) {
  const all = await listCounterparties();
  return all.find((c) => c.key === key) ?? null;
}

/** Every rate this counterparty has ever been on, newest first. */
export async function rateHistory(key) {
  const { rows } = await query(
    `select says, amount, unit, currency, effective_from, effective_to, confirmed_at, confirmed_by, source_url
       from counterparty_rates
      where counterparty_key = $1
      order by effective_from desc`,
    [key],
  );
  return rows.map((r) => ({
    says: r.says,
    amount: r.amount == null ? null : Number(r.amount),
    unit: r.unit,
    currency: r.currency,
    from: r.effective_from,
    to: r.effective_to,
    confirmedAt: r.confirmed_at,
    confirmedBy: r.confirmed_by,
    sourceUrl: r.source_url,
  }));
}

function shape(r) {
  return {
    key: r.key,
    name: r.name,
    direction: r.direction,
    purpose: r.purpose,
    usedBy: r.used_by,
    costClass: r.cost_class,
    status: r.status,
    adapterState: r.adapter_state,
    unitName: r.unit_name,
    credentialMasked: r.credential_masked,
    credentialExpiry: r.credential_expiry,
    rotatedAt: r.rotated_at,
    allowanceNote: r.allowance_note,
    providerKey: r.provider_key,
    notes: r.notes,
    rate: r.rate_id
      ? {
        id: r.rate_id,
        says: r.rate_says,
        amount: r.rate_amount == null ? null : Number(r.rate_amount),
        unit: r.rate_unit,
        currency: r.rate_currency,
        confirmedAt: r.rate_confirmed_at,
        confirmedBy: r.rate_confirmed_by,
        sourceUrl: r.rate_source_url,
        from: r.rate_from,
      }
      : null,
  };
}

/**
 * Write a new rate row.
 *
 * `says` is the sentence on the provider's own page — "1.5% + 20p" is not one
 * number, and what was confirmed is the sentence. `amount` and `unit` are
 * optional, and are what a future cost calculation would read.
 */
export async function setRate(key, { says, amount, unit, currency, sourceUrl, by }) {
  const clean = String(says ?? '').trim();
  if (!clean) throw bad('A rate needs to say something.', 'bad_rate');
  const { rows: [exists] } = await query('select key from counterparties where key = $1', [key]);
  if (!exists) throw Object.assign(new Error('No such counterparty.'), { status: 404, code: 'not_found' });

  /**
   * One transaction, because the close and the insert are one act.
   *
   * As two autocommit statements, an insert that failed left the counterparty
   * with no current rate at all, and two concurrent edits could leave two open
   * rows (Codex, 20 Sep 2026). Migration 202 adds the unique partial index that
   * makes the second impossible rather than unlikely.
   */
  return withTransaction(async (client) => {
    await client.query(
      `update counterparty_rates set effective_to = now()
        where counterparty_key = $1 and sku = 'default' and effective_to is null`,
      [key],
    );
    const { rows: [row] } = await client.query(
      `insert into counterparty_rates (counterparty_key, says, amount, unit, currency, source_url, confirmed_at, confirmed_by)
       values ($1, $2, $3, $4, coalesce($5, 'GBP'), $6, now(), $7)
       returning id, says, effective_from, confirmed_at`,
      [key, clean, amount == null ? null : Number(amount), unit ?? null, currency ?? null, sourceUrl ?? null, by ?? null],
    );
    // A new rate is confirmed by definition: somebody has just read it off the
    // provider's page and typed it in.
    return row;
  });
}

/** Stamp the rate in force as still right. No new row: nothing changed. */
export async function confirmRate(key, { by }) {
  const { rows: [row] } = await query(
    `update counterparty_rates set confirmed_at = now(), confirmed_by = $2
      where counterparty_key = $1 and sku = 'default' and effective_to is null
      returning id, confirmed_at`,
    [key, by ?? null],
  );
  if (!row) throw Object.assign(new Error('No rate to confirm.'), { status: 404, code: 'not_found' });
  return row;
}

/**
 * Rotate the credential — the masked value and the date.
 *
 * The real key goes into Doppler by hand, which is the owner's to do and
 * nobody else's (CLAUDE.md: "anything that holds a secret… is the owner's").
 * What this records is that it happened and which key is in there now, so the
 * screen stops saying the old one.
 */
export async function rotateCredential(key, { masked, expiry }) {
  const clean = String(masked ?? '').trim();
  if (!clean) throw bad('A rotation needs the new masked value.', 'bad_credential');
  if (/^(sk|pk|rk)[-_]?live/i.test(clean) && clean.length > 24) {
    // A pasted whole secret is refused rather than truncated: truncating it
    // would mean it had been in the request body and the logs already.
    throw bad('That looks like a whole key. Paste only the masked form — the secret goes in Doppler.', 'looks_like_secret');
  }
  const { rows: [row] } = await query(
    `update counterparties
        set credential_masked = $2,
            credential_expiry = coalesce($3, credential_expiry),
            rotated_at = now(), updated_at = now()
      where key = $1
      returning key, credential_masked, credential_expiry, rotated_at`,
    [key, clean, expiry ?? null],
  );
  if (!row) throw Object.assign(new Error('No such counterparty.'), { status: 404, code: 'not_found' });
  return row;
}

/**
 * Which search source a counterparty is, if it is one.
 *
 * The register's key and the source registry's key are not the same word —
 * `google-places` and `google-routes` are both `google`, and several
 * counterparties are no source at all. `provider_key` is the join, and it is
 * checked against `sourceKeys()` rather than assumed, so a counterparty
 * pointing at a provider the registry has never heard of turns nothing off
 * silently.
 */
async function sourceFor(key) {
  const { rows: [row] } = await query('select provider_key from counterparties where key = $1', [key]);
  if (!row) return { found: false, source: null };
  const source = row.provider_key && sourceKeys().includes(row.provider_key) ? row.provider_key : null;
  return { found: true, source };
}

/**
 * Turn the adapter off or on — and actually stop the calls.
 *
 * **This was register-only and the comment claimed otherwise** (epic-59, 20 Sep
 * 2026, exercising it live): the control is alarm-red, says "Disable", and used
 * to write `status = 'off'` while `enabledSources()` went on returning the
 * source and the search path went on buying. A red button that records an
 * intention is worse than no button, because the sentence a reader trusts
 * before turning something off to stop a bill was false.
 *
 * So it does both, in this order: the estate's own switch first
 * (`sources/index.js`, the same one `/api/admin/sources/:key` flips), then the
 * register. If the switch fails the register is not written, because a register
 * that says "off" over a source that is still running is the state this exists
 * to prevent.
 *
 * Where the counterparty is **not** a search source — Fly.io, Neon, Stripe —
 * there is nothing to flip, and the answer says so rather than implying the
 * calls stopped. It still never deletes a key and never touches Doppler.
 */
export async function setAdapter(key, { on }) {
  const { found, source } = await sourceFor(key);
  if (!found) throw Object.assign(new Error('No such counterparty.'), { status: 404, code: 'not_found' });

  if (source) await setSourceOff(source, !on);

  const { rows: [row] } = await query(
    `update counterparties
        set adapter_state = $2, status = $3, updated_at = now()
      where key = $1
      returning key, adapter_state, status`,
    [key, on ? 'enabled' : 'none', on ? 'live' : 'off'],
  );
  return {
    ...row,
    /** The registry key that was flipped, so the screen can say what happened. */
    source,
    /** True where the calls have actually stopped, not only been recorded. */
    stopped: !!source && !on && sourceOff(source),
  };
}

/** The plain-sentence fields: what it is for, who reads it, which class. */
export async function describe(key, { purpose, usedBy, costClass, unitName, allowanceNote, notes, direction, status }) {
  if (direction && !DIRECTIONS.includes(direction)) throw bad('Not a direction.', 'bad_direction');
  if (status && !STATUSES.includes(status)) throw bad('Not a status.', 'bad_status');
  const { rows: [row] } = await query(
    `update counterparties
        set purpose        = coalesce($2, purpose),
            used_by        = coalesce($3, used_by),
            cost_class     = coalesce($4, cost_class),
            unit_name      = coalesce($5, unit_name),
            allowance_note = coalesce($6, allowance_note),
            notes          = coalesce($7, notes),
            direction      = coalesce($8, direction),
            status         = coalesce($9, status),
            updated_at     = now()
      where key = $1
      returning key`,
    [key, purpose ?? null, usedBy ?? null, costClass ?? null, unitName ?? null,
      allowanceNote ?? null, notes ?? null, direction ?? null, status ?? null],
  );
  if (!row) throw Object.assign(new Error('No such counterparty.'), { status: 404, code: 'not_found' });
  return row;
}
