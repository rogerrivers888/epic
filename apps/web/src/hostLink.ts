/**
 * The host's own link (hosting v4, E10): `/hosts/<id>?via=<token>`. A guest who
 * arrives by it keeps the token for that host while they look around this
 * visit, so the booking they make can say it came through the host — the
 * host-link rate is earned by the token, never by a flag (Codex, 2 Oct 2026).
 *
 * Held in memory only, never written to the device: nothing here needs a line
 * in the Cookie and Storage Notice. A reload forgets it, which costs the host
 * the link rate on that one booking and nothing else.
 */

let held: { hostId: string; token: string } | null = null;

export function rememberHostLink(hostId: string, token: string | null | undefined) {
  if (!hostId || !token || !/^[0-9a-f]{16,64}$/.test(token)) return;
  held = { hostId, token };
}

/** The token for this host, if the guest arrived by their link during this visit. */
export function hostLinkFor(hostId: string | null | undefined): string | null {
  return hostId && held && held.hostId === hostId ? held.token : null;
}
