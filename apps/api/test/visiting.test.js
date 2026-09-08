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

test('only the defining sentence counts, not the history after it', () => {
  // Every one of these was wrongly hidden on production by a rule that read the
  // whole summary. The offending words are all in sentences about 1536, 1955
  // and 2013 respectively.
  assert.notEqual(say(['Q2750108'],
    'Reigate Priory is a Grade I listed building in Reigate. Following its dissolution in 1536, the buildings were converted to a private residence for William Howard.').visiting, 'no');
  assert.notEqual(say(['Q422211'],
    'Godstone Ponds is a biological Site of Special Scientific Interest in Surrey. Bay Pond is an educational nature reserve closed to the public.').visiting, 'no');
  assert.notEqual(say(['Q16970'],
    'St Mary de Castro is a medieval Grade I listed church in Leicester. The tower was closed to the public in 2013.').visiting, 'no');
});

test('a palace is somewhere you buy a ticket', () => {
  // Holyrood is "the official residence of the monarch in Scotland" in its own
  // first sentence, and is one of Scotland's most visited buildings.
  assert.equal(say(['Q131986827', 'Q481289', 'Q16560'],
    'The Palace of Holyroodhouse is the official residence of the monarch of the United Kingdom in Scotland.').visiting, 'yes');
  assert.equal(say(['Q15835'],
    'The Japanese garden at Cowden is near Dollar. It was closed to the public in 1955 after vandalism.').visiting, 'yes');
});

test('a stated refusal is honoured', () => {
  assert.equal(say(['Q1343246'], 'Chequers is the country house of the prime minister of the United Kingdom.').visiting, 'no');
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
  // The pass may overwrite its own earlier conclusions, under any of the source
  // names the rule uses, and nothing else. A person's name is not in that list,
  // which is the whole promise: somebody who actually looked outranks the rule
  // permanently.
  const m = src.match(/visiting_by is null or visiting_by in \(([^)]*)\)/);
  assert.ok(m, 'rejudgeVisiting must restrict what it is allowed to overwrite');
  const allowed = m[1].split(',').map((x) => x.trim().replace(/'/g, ''));
  assert.deepEqual(allowed.sort(), ['google', 'kinds', 'osm', 'rule', 'summary', 'veto', 'wikipedia'],
    'only the rule\u2019s own verdicts may be overwritten');
});

test('Google only ever fills a gap, and never says a place is private', () => {
  const src = readFileSync(new URL('../src/sources/providerMatch.js', import.meta.url), 'utf8');
  // Google has no type for a house, so its silence is a fact about Google. The
  // update must therefore be positive-only and conditional on nothing else
  // having answered.
  assert.match(src, /set visiting = 'yes'/, 'Google may only establish that a place is public');
  assert.match(src, /and visiting is null/, 'Google must not overturn an answer we already have');
  assert.ok(!/set visiting = 'no'[\s\S]{0,200}google/i.test(src), 'Google must never conclude a place is private');
});

test('nothing of Google\u2019s is written down but our own conclusion', () => {
  const src = readFileSync(new URL('../src/sources/providerMatch.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('async function noteGoogleVisiting'), src.indexOf('export async function ratingsFor'));
  for (const field of ['rating', 'userRatingCount', 'types', 'primaryType', 'displayName']) {
    assert.ok(!new RegExp(`\\$\\d[^]*${field}|${field}[^]*values`).test(fn),
      `${field} is Google's content and is not ours to keep`);
  }
  assert.match(fn, /visiting_by = 'google'/, 'the rows it touched must be findable and droppable in one statement');
});

test('a whole-place claim outranks a tag on one structure', () => {
  // Run absolutely, the residential veto hid Hatfield House, Nostell Priory,
  // Muncaster Castle, Castle Campbell, Forde Abbey and The Homewood — several
  // of them National Trust. The mansion at Nostell really is `building=house`
  // and the estate road at Balmoral really is `access=private`; a tag describes
  // one feature, and "Historic house museums in West Yorkshire" describes the
  // institution. Checked by hand against the refusals, the category calls 15 of
  // 18 genuinely-open places public and none of 18 private houses.
  const open = (name, kinds, categories, osm) => {
    const got = judgeVisiting({ kinds, categories, osm });
    assert.equal(got.visiting, 'yes', `${name} must survive the veto, got ${got.visiting}`);
  };
  open('Nostell Priory', ['Q1343246'], ['Historic house museums in West Yorkshire'], { building: 'detached' });
  open('Hatfield House', ['Q1343246'], ['Historic house museums in Hertfordshire'], { access: 'private' });
  open('Balmoral Castle', ['Q23413', 'Q131986827'], ['Art museums and galleries in Aberdeenshire'], { access: 'private' });
});

test('a house nobody calls an attraction is still refused', () => {
  for (const [name, kinds, osm] of [
    ['Bagshot Park', ['Q131986827', 'Q1343246'], { building: 'house', historic: 'castle' }],
    ['Highgrove House', ['Q131986827', 'Q1343246'], { building: 'house' }],
    ['Tittenhurst Park', ['Q1343246'], { building: 'house' }],
    ['Treago Castle', ['Q23413'], { building: 'residential' }],
  ]) {
    const got = judgeVisiting({ kinds, osm, categories: [] });
    assert.equal(got.visiting, 'no', `${name} must stay hidden, got ${got.visiting}`);
  }
});

test('historic=* is about fabric and never means the public may come in', () => {
  // Chequers is historic=manor and Fort Belvedere is historic=castle, and both
  // are somebody's home. Ruins and abbeys are carried by their Wikipedia
  // category instead, which is a claim about the institution.
  const chequers = judgeVisiting({
    kinds: ['Q1343246'], categories: [], osm: { building: 'yes', historic: 'manor' },
    summary: 'Chequers is the country house of the prime minister of the United Kingdom.',
  });
  assert.equal(chequers.visiting, 'no');
  const belvedere = judgeVisiting({ kinds: ['Q1343246'], categories: [], osm: { building: 'yes', historic: 'castle' } });
  assert.equal(belvedere.visiting, null, 'nothing establishes it either way, and unestablished is not shown');
});

test('a strong type beats the veto and a weak one does not', () => {
  // A museum in a mansion is still a museum. A castle that is somebody's house
  // is still somebody's house.
  assert.equal(judgeVisiting({ kinds: ['Q2087181'], osm: { building: 'house' } }).visiting, 'yes');
  assert.equal(judgeVisiting({ kinds: ['Q23413'], osm: { building: 'house' } }).visiting, 'no');
});

test('access=customers is not a refusal', () => {
  // Kew Gardens is tagged that way and you buy a ticket.
  const got = judgeVisiting({ kinds: [], categories: [], osm: { access: 'customers', leisure: 'garden' } });
  assert.equal(got.visiting, 'yes');
});
