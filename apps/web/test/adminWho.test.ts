/**
 * The back office's footer: who is signed in, and whether their changes go to
 * Approvals (design handover §2a, 3 Oct 2026; G11).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { proposes, whoLine } from '../src/admin/who.ts';

const owner = { key: 'owner', label: 'Owner' };

test('a personal sign-in reads "Roger · Owner" and applies directly', () => {
  const access = { name: 'Roger Sumner-Rivers', role: owner, elevated: true };
  assert.equal(whoLine(access), 'Roger · Owner');
  assert.equal(proposes(access), false);
});

test('the shared passcode reads "Shared passcode · Owner" and proposes to Approvals', () => {
  const access = { name: null, role: owner, elevated: false };
  assert.equal(whoLine(access), 'Shared passcode · Owner');
  assert.equal(proposes(access), true);
});

test('an owner signed in personally with no name is still never a bare role mistaken for the passcode', () => {
  assert.equal(whoLine({ name: '', role: owner, elevated: true }), 'Owner');
});

test('staff read as their own name and role; a session with nothing to say says a dash', () => {
  assert.equal(whoLine({ name: 'Gina Ray', role: { key: 'support', label: 'Support' }, elevated: false }), 'Gina · Support');
  assert.equal(proposes({ role: { key: 'support', label: 'Support' }, elevated: false }), false);
  assert.equal(whoLine(null), '—');
});
