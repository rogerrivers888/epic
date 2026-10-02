/**
 * The host's own link (hosting v4, E10): `/hosts/<id>?via=<token>`. A guest who
 * arrives by it keeps the token for that host while they look around, so the
 * booking they make can say it came through the host — the host-link rate is
 * earned by the token, never by a flag (Codex, 2 Oct 2026). Kept a day.
 */

import { storage } from './storage';

const KEY = 'epic.hostLink';
const DAY = 86_400_000;

export function rememberHostLink(hostId: string, token: string | null | undefined) {
  if (!hostId || !token || !/^[0-9a-f]{16,64}$/.test(token)) return;
  storage.setItem(KEY, JSON.stringify({ hostId, token, at: Date.now() }));
}

/** The token for this host, if the guest arrived by their link in the last day. */
export function hostLinkFor(hostId: string | null | undefined): string | null {
  if (!hostId) return null;
  try {
    const v = JSON.parse(storage.getItem(KEY) ?? 'null');
    return v && v.hostId === hostId && Date.now() - v.at < DAY ? String(v.token) : null;
  } catch { return null; }
}
