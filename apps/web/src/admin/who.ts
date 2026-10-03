/**
 * Who is signed in to the back office, as its footer says it — pure, so it can
 * be tested without drawing anything.
 */
import type { Access } from '../api';

/**
 * Who is signed in, as the rail's footer says it (design handover §2a):
 * "Roger · Owner" for a personal sign-in, "Shared passcode · Owner" for the
 * shared one. The person and their role, never a role alone.
 */
export function whoLine(access: Pick<Access, 'name' | 'role' | 'elevated'> | null | undefined): string {
  const first = access?.name?.trim().split(/\s+/)[0];
  const shared = access?.role?.key === 'owner' && !access?.elevated;
  return [first || (shared ? 'Shared passcode' : null), access?.role?.label].filter(Boolean).join(' · ') || '—';
}

/**
 * Whether this session's owner-only changes are filed to Approvals rather than
 * applied: the owner's powers without a personal sign-in — the shared
 * passcode, or an agent (G11; Roger, 3 Oct 2026). Personal sign-in is the
 * signal, not a name, since an owner may have none (Codex, 3 Oct 2026).
 */
export function proposes(access: Pick<Access, 'role' | 'elevated'> | null | undefined): boolean {
  if (access?.elevated) return false;
  return access?.role?.key === 'owner' || access?.role?.key === 'agent';
}
