/**
 * A photograph's own key, so an `<img>` does not need a cookie.
 *
 * The fault this fixes, found 8 Sep 2026: on the deployed site the rented
 * photographs were blank — "there are no images, none, in activities". Not the
 * data. `/api/photos/google` is behind the door, and an `<img>` tag cannot
 * carry an `Authorization` header, so it was authorised by the session cookie
 * instead (auth.js `cookieAllowed`). That cookie is set on the API's own
 * hostname and read from `epic.day`, which makes it a **third-party cookie** —
 * `SameSite=None`. Safari blocks those outright and Chrome is retiring them. So
 * every browser that does the modern thing got a 401 for every photograph, and
 * the tiles fell back to their category icon.
 *
 * The owned library (`/api/images`) is outside the door and never had the
 * problem, which is exactly why some rows had pictures and the ones with no
 * owned picture had none at all.
 *
 * The fix is to stop asking the browser to prove who it is for a picture, and
 * to let the *link* prove it instead: every photo reference leaves here with a
 * short-lived signature over its name. A signed link cannot be used to look up
 * an arbitrary photograph, cannot be minted by anyone without the key, and
 * stops working within hours — which is the whole of what the cookie was
 * protecting (somebody else spending the household's Google quota).
 *
 * **The key lives for one process and is never written down.** It does not need
 * to survive a restart: a link is good for hours, the pages that hold one are
 * open for minutes, and a deploy simply means the next render signs new ones.
 * That way there is no secret to add in Doppler, nothing to leak, and nothing
 * for the owner to configure — the standing rule being that a secret is his to
 * hold, so the best kind here is one that does not exist (CLAUDE.md).
 *
 * The durable answer is to stop being cross-site at all — serve the API from
 * `epic.day/api` through Cloudflare, as the README already contemplates — and
 * then the cookie is first-party and none of this is needed. This works either
 * way, and today.
 */

import crypto from 'node:crypto';

/** One process, one key, never persisted. */
const KEY = crypto.randomBytes(32);

/** Six hours: longer than anybody keeps a page open, shorter than a quota is worth. */
const LIFETIME_MS = 6 * 60 * 60 * 1000;

const sign = (name, expiry) =>
  crypto.createHmac('sha256', KEY).update(`${name}|${expiry}`).digest('base64url');

/**
 * What a photo reference travels with. The client appends both to the URL it
 * builds; nothing here reveals the key, and a signature is only good for the
 * one photograph it was made for.
 */
export function stampPhoto(photo) {
  if (!photo?.ref) return photo;
  const expiry = Date.now() + LIFETIME_MS;
  return { ...photo, exp: expiry, sig: sign(photo.ref, expiry) };
}

export const stampPhotos = (photos) => (Array.isArray(photos) ? photos.map(stampPhoto) : photos);

/**
 * Whether this request carries a good link for the photograph it is asking for.
 *
 * Constant-time, and it checks the name it was signed for rather than any name:
 * a signature lifted from one picture cannot fetch another.
 */
export function photoLinkValid(query) {
  // `s` and `e` are the names on the wire — an image URL is read by people in
  // logs and network panels, and two letters keep it short. `sig`/`exp` are
  // accepted too, because that is what `stampPhoto` calls them on the object.
  const q = query ?? {};
  const name = q.name;
  const sig = q.s ?? q.sig;
  const exp = q.e ?? q.exp;
  if (!name || !exp || !sig) return false;
  const expiry = Number(exp);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;
  const expected = Buffer.from(sign(String(name), expiry), 'utf8');
  const given = Buffer.from(String(sig), 'utf8');
  if (expected.length !== given.length) {
    crypto.timingSafeEqual(expected, expected);
    return false;
  }
  return crypto.timingSafeEqual(expected, given);
}

/**
 * The same door, for a picture of our own that is not yet public.
 *
 * A household's photograph of a place waits in the library pending a look
 * (migration 036) and is drawn for that household alone (migration 082). The
 * bytes still have to reach an `<img>`, which cannot prove who it is — so the
 * link proves it instead, signed over the image id the way a rented reference
 * is signed over its name. Anyone else with the bare id gets a 404.
 */
export function stampImage(image) {
  if (!image?.id) return image;
  const expiry = Date.now() + LIFETIME_MS;
  return { ...image, exp: expiry, sig: sign(`image:${image.id}`, expiry) };
}

/** Whether this request carries a good link for the image it is asking for. */
export const imageLinkValid = (id, query) => photoLinkValid({ name: `image:${id}`, s: query?.s ?? query?.sig, e: query?.e ?? query?.exp });
