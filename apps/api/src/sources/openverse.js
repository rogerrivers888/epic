// Openverse: openly licensed pictures of a place (owner, 2 Oct 2026: "start
// with Commons and Openverse only. Openverse already indexes most Flickr CC,
// so no Flickr key for now").
//
// What it is for. Commons, through the place-picture ladder, finds a picture
// for a place that has a Wikidata item; most saved restaurants and cafés do
// not. Openverse searches Flickr, Commons and a dozen other open collections
// by title and tag, so it can find the photograph somebody took of the pub on
// the green and licensed CC BY.
//
// What it is not. A search by name finds pictures *called* that name, which
// is not the same as pictures *of* that place — "The Crown" is half the pubs
// in England. So nothing found here reaches a card by itself: every picture is
// stored `pending`, linked to the place as a gallery picture, and drawn only
// once somebody has looked at it beside Google's (back office › Photo review).
//
// The licence is the gate, as it is for Commons: `isStorableLicence`, the
// harvest's own allow-list, decides; a non-commercial or no-derivatives
// licence is never stored, whatever the picture.

import crypto from 'node:crypto';
import * as lib from '../repositories/library.js';
import { query } from '../db.js';
import { isStorableLicence } from './wikimedia.js';
import { fetchPublicPicture } from './safeFetch.js';
import { userAgent } from '../origins.js';

const API = 'https://api.openverse.org/v1/images/';
const UA = userAgent('saved-place pictures; roger@epic.day');
const TIMEOUT_MS = 15_000;

/**
 * Openverse's licence code as the words a licence is written in here.
 *
 * `by-nc`, `by-nd` and their kin come out as "CC BY-NC 2.0" and so on, which
 * the allow-list refuses — mapped faithfully rather than dropped here, so the
 * refusal is the allow-list's and is the same refusal everywhere.
 */
export function licenceName(code, version) {
  const c = String(code ?? '').toLowerCase();
  const v = version ? ` ${version}` : '';
  if (c === 'cc0') return `CC0${v || ' 1.0'}`;
  if (c === 'pdm') return 'Public Domain Mark 1.0';
  if (!c) return '';
  return `CC ${c.toUpperCase()}${v}`;
}

/**
 * Search Openverse for pictures of one place.
 *
 * Returns `{ ok: true, results }` or `{ ok: false, why }`. A search that could
 * not be made is not a search that found nothing (CLAUDE.md, "every diagnostic
 * has a can't-speak state"), so the two never share a shape.
 */
export async function search(q, { pageSize = 10, fetchImpl = fetch } = {}) {
  const url = `${API}?${new URLSearchParams({ q, page_size: String(pageSize), mature: 'false' })}`;
  let res;
  try {
    res = await fetchImpl(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) { return { ok: false, why: `openverse_unreachable: ${err.name}` }; }
  if (!res.ok) return { ok: false, why: `openverse_http_${res.status}` };
  let body;
  try { body = await res.json(); } catch { return { ok: false, why: 'openverse_unreadable' }; }
  if (!Array.isArray(body?.results)) return { ok: false, why: 'openverse_unreadable' };
  return {
    ok: true,
    results: body.results.map((r) => ({
      id: r.id,
      title: r.title ?? null,
      url: r.url ?? null,
      thumbnail: r.thumbnail ?? null,
      width: r.width ?? null,
      height: r.height ?? null,
      creator: r.creator ?? null,
      creatorUrl: r.creator_url ?? null,
      licence: licenceName(r.license, r.license_version),
      licenceUrl: r.license_url ?? null,
      landing: r.foreign_landing_url ?? null,
      provider: r.provider ?? r.source ?? null,
    })),
  };
}

/**
 * Find and keep up to `keep` openly licensed pictures of a place.
 *
 * Stored `pending` and linked as gallery pictures, never as the hero: a name
 * search is a guess until somebody has looked. Returns what happened, for the
 * enrichment record: `{ ok, stored: [{ imageId, licence, creator, landing }], refused, why }`.
 */
export async function picturesFor({ venueRef, name, locality = null }, { keep = 3, fetchImpl, fetchPictureImpl = fetchPublicPicture } = {}) {
  if (!venueRef || !name) return { ok: false, why: 'no_name', stored: [], refused: 0 };
  const q = [name, locality].filter(Boolean).join(' ');
  const found = await search(q, { fetchImpl });
  if (!found.ok) return { ok: false, why: found.why, stored: [], refused: 0 };
  const stored = [];
  let refused = 0;
  for (const r of found.results) {
    if (stored.length >= keep) break;
    if (!isStorableLicence(r.licence)) { refused += 1; continue; }
    // A picture we already hold was judged for the place it was found for.
    // Its moderation is the picture's, not the link's, so attaching it to a
    // second place by name would carry an approval across untested — "The
    // Crown" is half the pubs in England (Codex, 2 Oct 2026). Left alone.
    const { rows: held } = await query(
      `select i.id, i.moderation, exists (select 1 from image_links l where l.image_id = i.id and l.subject_type = 'place') as linked
         from image_assets i where i.source = 'openverse' and i.source_ref = $1`, [`openverse:${r.id}`]);
    // Held already and linked to a place, in any state: left exactly as it is —
    // its moderation, its link and its role (an approved card picture stays the
    // card picture) — and not counted as found again (Codex, 2 Oct 2026).
    if (held.length && held[0].linked) continue;
    // Held but linked to nothing — a pass stopped between storing it and
    // linking it. Still waiting for a look, it is linked here rather than lost
    // for good; anything already decided is left alone (Codex, 2 Oct 2026).
    if (held.length) {
      if (held[0].moderation !== 'pending') continue;
      await lib.linkImage(held[0].id, { subjectType: 'place', subjectId: venueRef, role: 'gallery', position: 10 + stored.length });
      stored.push({ imageId: held[0].id, licence: r.licence, creator: r.creator, landing: r.landing });
      continue;
    }
    // Openverse's own thumbnail: a few hundred pixels, which is what a card
    // draws, and a polite size to take from somebody else's server.
    const pic = await fetchPictureImpl(r.thumbnail ?? r.url);
    if (!pic) continue;
    const image = await lib.saveImage({
      source: 'openverse',
      sourceRef: `openverse:${r.id}`,
      sourcePageUrl: r.landing ?? r.url,
      licence: r.licence,
      licenceUrl: r.licenceUrl,
      attributionRequired: !/^(cc0|public domain)/i.test(r.licence),
      mayStore: true,
      creator: r.creator,
      creatorUrl: r.creatorUrl,
      creditLine: [r.title, r.creator && `by ${r.creator}`, r.licence].filter(Boolean).join(', '),
      title: r.title,
      tags: [name, locality, 'openverse', r.provider].filter(Boolean),
      mime: pic.mime,
      // The original's size, not the thumbnail's: "at least 1200 px on the long
      // edge" is asked of the photograph, and only Openverse knows it.
      width: r.width ?? pic.width ?? null,
      height: r.height ?? pic.height ?? null,
      bytes: pic.bytes,
      sha256: crypto.createHash('sha256').update(pic.body).digest('hex'),
      moderation: 'pending',
    }, [{ width: 500, actualWidth: pic.width ?? null, actualHeight: pic.height ?? null, mime: pic.mime, bytes: pic.bytes, body: pic.body }]);
    await lib.linkImage(image.id, { subjectType: 'place', subjectId: venueRef, role: 'gallery', position: 10 + stored.length });
    // Two passes can find the same picture at once, each before the other has
    // linked it. A picture's moderation is one for every place it is linked
    // to, so it must belong to one place: if another has it too, this link is
    // withdrawn (Codex, 2 Oct 2026). Both withdrawing loses a picture; neither
    // shares an approval.
    const { rows: [others] } = await query(
      `select count(*)::int as n from image_links where image_id = $1 and subject_type = 'place' and subject_id <> $2`, [image.id, venueRef]);
    if (others.n > 0) { await lib.unlinkImage(image.id, 'place', venueRef); continue; }
    stored.push({ imageId: image.id, licence: r.licence, creator: r.creator, landing: r.landing });
  }
  return { ok: true, stored, refused, looked: found.results.length };
}
