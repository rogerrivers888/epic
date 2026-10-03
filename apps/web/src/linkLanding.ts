/**
 * Where a sign-in link lands (G21; Codex, 3 Oct 2026).
 *
 * Three candidates, in this order: the page the link itself carries (`next` on
 * the link, vetted), the page this device remembered when a link was asked for
 * (afterSignIn.ts, also vetted), then where the account's role lands. The
 * link's own page wins: a device's remembered page may belong to an older ask
 * on this browser, while the link names the one it was sent for. The caller
 * takes the remembered page out of storage either way, so it can never fire
 * on a later sign-in.
 */
export function linkLanding(linkNext: string | null, remembered: string | null, byRole: string): string {
  return linkNext ?? remembered ?? byRole;
}
