/**
 * The role chip and the invite block on a person's page (personRole). The
 * design audit of 2 Oct 2026: the owner's own page said "Invited · not opened
 * yet", "Parent" and ADULT, because it read the account linked to their person
 * — an old, never-opened invite — rather than who was signed in.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isHouseholdOwner, personRole } from '../src/screens/personRole.ts';

const roger = { id: 'm-roger', age: 52, isMinor: false, access: { status: 'invited', isLead: false } as any };
const maya = { id: 'm-maya', age: 48, isMinor: false, access: { status: 'invited', isLead: false } as any };
const theo = { id: 'm-theo', age: 9, isMinor: true, access: null };

test("the lead's own page is OWNER and never a pending invite, whatever account is linked to their person", () => {
  const data = { me: 'm-roger', meIsLead: true };
  assert.deepEqual(personRole(data, roger), { owner: true, pending: false, role: 'OWNER' });
});

test('somebody else invited and not yet joined is still pending, and an adult', () => {
  const data = { me: 'm-roger', meIsLead: true };
  assert.deepEqual(personRole(data, maya), { owner: false, pending: true, role: 'ADULT' });
  assert.deepEqual(personRole(data, theo), { owner: false, pending: false, role: 'CHILD' });
});

test('a non-lead viewer is not made owner by looking at their own page', () => {
  const data = { me: 'm-maya', meIsLead: false };
  assert.equal(isHouseholdOwner(data, maya), false);
  assert.equal(personRole(data, maya).pending, false);
});

test("the owner is still read from the person's own access record when somebody else looks", () => {
  const lead = { ...roger, access: { status: 'active', isLead: true } as any };
  assert.equal(isHouseholdOwner({ me: 'm-maya', meIsLead: false }, lead), true);
  assert.equal(isHouseholdOwner({ me: null, meIsLead: true }, maya), false);
});

test("on your own page the session's 'not the owner' wins over a linked lead account (Codex)", () => {
  const linkedLead = { ...maya, access: { status: 'active', isLead: true } as any };
  assert.equal(isHouseholdOwner({ me: 'm-maya', meIsLead: false }, linkedLead), false);
  // An older response without meIsLead still falls back to the linked account.
  assert.equal(isHouseholdOwner({ me: 'm-maya' } as any, linkedLead), true);
});
