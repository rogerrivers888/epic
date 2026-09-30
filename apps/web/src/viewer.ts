// Whose rating a place's row shows (owner, 3 Sep 2026: "just need to see my own
// rating"). There is no sign-in yet, so the device remembers who is looking;
// Settings › Preferences › Ratings shown as. Defaults to the first person in
// the household.
import { storage } from './storage';

export const VIEWER_KEY = 'epic.viewer';

/**
 * "Anyone", written down. Nobody in particular is a real answer — the Places
 * redesign's Anyone ▾ chip (handover, 5 Sep 2026) — and it has to survive a
 * reload, so it is a value in the same key rather than the absence of one.
 */
const ANYONE = 'anyone';

export function getViewer(members: { id: string }[]): string | null {
  const saved = storage.getItem(VIEWER_KEY);
  if (saved === ANYONE) return null;
  if (saved && members.some((m) => m.id === saved)) return saved;
  return members[0]?.id ?? null;
}

/** One person's verdicts, or null for the household's between them. */
export function setViewer(memberId: string | null) {
  storage.setItem(VIEWER_KEY, memberId ?? ANYONE);
  listeners.forEach((fn) => fn(memberId));
}

const listeners = new Set<(id: string | null) => void>();
export const onViewerChange = (fn: (id: string | null) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
