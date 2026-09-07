import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { judgeVisiting } from '../src/domain/visiting.js';

/**
 * Whether the public can actually go there.
 *
 * The cases below are all real rows from the atlas, kept because each one is a
 * way this went wrong before it shipped. The danger here is entirely on one
 * side: a private house left on the screen is the bug being fixed, but a
 * cathedral wrongly hidden is a place nobody can find and nobody knows is gone.
 */

const say = (kinds, summary) => judgeVisiting({ kinds, summary });

test('a residence of the royal family is closed unless it is also a museum', () => {
  // The exact pair from the owner's Culture row. Both carry Q131986827.
  assert.equal(say(['Q131986827', 'Q1343246'], 'Bagshot Park is a royal residence near Bagshot.').visiting, 'no');
  assert.equal(say(['Q131986827', 'Q53536964', 'Q2087181', 'Q1343246'],
    'Sandringham House is a country house in Norfolk. It is one of the royal residences of Charles III.').visiting, 'yes');
});

test('the famous houses everybody can visit are not touched', () => {
  // Every one of these is a real published row whose summary says nothing
  // whatever about visiting. Hiding the unvouched-for would have lost the lot.
  for (const name of ['Chatsworth House', 'Blenheim Palace', 'Highclere Castle', 'Leeds Castle', 'Hever Castle', 'Belton House']) {
    const got = say(['Q1343246'], `${name} is a country house in England.`);
    assert.equal(got.visiting, null, `${name} must be left alone, got ${got.visiting}`);
  }
});

test('prose about the past is not a fact about now', () => {
  // Osborne House, Bletchley Park, Broughton Castle and the Royal Pavilion were
  // all marked closed by an earlier rule that matched words anywhere in a
  // history. All four are major attractions.
  assert.equal(say(['Q16735822', 'Q2087181', 'Q1343246'],
    'Osborne House is a former royal residence in East Cowes.').visiting, 'yes');
  assert.notEqual(say(['Q1343246'],
    'Wentworth Woodhouse … was – until it ceased to be privately owned – often listed as the largest private residence in the United Kingdom.').visiting, 'no');
  assert.notEqual(say(['Q1343246'],
    'Bletchley Park was the site of the Government Code and Cypher School. It is now a museum.').visiting, 'no');
});

test('a stated refusal is honoured', () => {
  assert.equal(say(['Q1343246'], 'Chequers is the country house of the prime minister of the United Kingdom.').visiting, 'no');
  assert.equal(say(['Q1343246'], 'Updown Court … the most expensive private home in the country.').visiting, 'no');
  assert.equal(say(['Q917182'], 'The Royal Military Academy Sandhurst is the British Army officer training centre.').visiting, 'no');
});

test('an open kind beats a closed word, because the open tests run first', () => {
  // Windsor Castle is a royal residence and a historic house museum at once.
  const got = say(['Q131986827', 'Q23413', 'Q2087181'], 'Windsor Castle is a royal residence at Windsor.');
  assert.equal(got.visiting, 'yes');
});

test('nobody has said is the common answer, and it is shown', () => {
  const got = say(['Q1343246'], 'Foliejon Park is a country house in Berkshire.');
  assert.equal(got.visiting, null);
  assert.equal(got.because, null);
});

test('every verdict carries the sentence behind it', () => {
  for (const c of [say(['Q131986827'], 'x'), say(['Q33506'], 'x'), say([], 'a private residence')]) {
    assert.ok(c.because && c.because.length > 8, 'a hidden place with no explanation reads as a bug');
  }
});

test('the home screen skips refusals and keeps the unestablished', () => {
  const sql = readFileSync(new URL('../src/repositories/library.js', import.meta.url), 'utf8');
  assert.match(sql, /a\.visiting is distinct from 'no'/,
    "must skip only 'no' — `= 'yes'` would hide everything nobody has settled");
  assert.ok(!/a\.visiting = 'yes'/.test(sql), 'that would hide most of the atlas');
});

test('a verdict set by hand survives the next pass', () => {
  const src = readFileSync(new URL('../src/repositories/library.js', import.meta.url), 'utf8');
  assert.match(src, /visiting_by is null or visiting_by = 'rule'/,
    'rejudgeVisiting must never overwrite somebody who actually looked');
});
