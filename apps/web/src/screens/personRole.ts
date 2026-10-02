/**
 * Who a person is on their profile (Settings revised v2 · Roles): the role chip
 * (OWNER / ADULT / CHILD), "Household owner" in place of a relationship, and
 * whether the pending-invite block shows.
 *
 * Pure, so the rule can be tested without a screen.
 *
 * Why the viewer's own page asks the session rather than the person's access
 * record (design audit, 2 Oct 2026): `member.access` describes the account
 * *linked to that person* (`accounts.member_id`). A household's lead can sign
 * in on an account with no person linked — `currentMember()` then falls back to
 * the first adult, which is them — while that person still carries an older
 * invited, never-opened account of their own. Read from `member.access`, the
 * owner's own page said "Invited · not opened yet", "Parent" and ADULT. The
 * server already says whether the person asking is the lead (`meIsLead`, read
 * from their account), and somebody looking at their own page is signed in, so
 * it is never a pending invite.
 */

import type { HouseholdResponse, Member } from '../api';

export type PersonRole = { owner: boolean; pending: boolean; role: 'OWNER' | 'ADULT' | 'CHILD' };

type Who = Pick<HouseholdResponse, 'me' | 'meIsLead'>;
type Person = Pick<Member, 'id' | 'age' | 'isMinor' | 'access'>;

/** Whether this person is the household's owner (the lead who pays). */
export function isHouseholdOwner(data: Who, member: Person): boolean {
  // On your own page the session's answer decides, yes or no; the linked account
  // is only the fallback for an older response that does not carry it (Codex).
  if (data.me != null && member.id === data.me && typeof data.meIsLead === 'boolean') return data.meIsLead;
  return Boolean(member.access?.isLead);
}

export function personRole(data: Who, member: Person): PersonRole {
  const owner = isHouseholdOwner(data, member);
  const isChild = member.age != null ? member.age < 18 : member.isMinor;
  const isYou = data.me != null && member.id === data.me;
  return {
    owner,
    // You are signed in to be looking: your own page is never an open invite.
    pending: !isYou && member.access?.status === 'invited',
    role: owner ? 'OWNER' : isChild ? 'CHILD' : 'ADULT',
  };
}
