// The cell layer, and the matrix between cells.
//
// The reason these tests exist at all: the matrix is built once and read
// thousands of times, so a mistake in it is silent. A ring that is quietly a
// little too small does not throw — it just never offers the places at the edge,
// and nobody can tell the difference between "there is nothing there" and "we
// stopped looking too soon". So the two properties worth holding are that the
// matrix agrees exactly with the estimate every list is fenced with afterwards,
// and that the bound around the search is generous rather than tight.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BANDS, CAP_MINUTES, bandFor, boundKm, cellCode, labelOf,
  minutesBetween, nearestCell, outcodeOf, reachFrom, recentre, sectorOf,
} from '../src/domain/reach.js';
import { estimateTravelMinutes, kmBetween } from '../src/domain/travel.js';

test('a postcode is read into its sector, and anything else is refused', () => {
  assert.equal(sectorOf('SL4 1QT'), 'SL4 1');
  assert.equal(sectorOf('sl41qt'), 'SL4 1');
  assert.equal(sectorOf('  Sl4   1qt '), 'SL4 1');
  assert.equal(sectorOf('EC1A 1BB'), 'EC1A 1');
  assert.equal(sectorOf('W1A 0AX'), 'W1A 0');
  assert.equal(sectorOf('B1 1AA'), 'B1 1');
  // A wrong cell still answers, so anything that is not a postcode must be null
  // rather than a guess.
  assert.equal(sectorOf('SL4'), null);
  assert.equal(sectorOf('Windsor'), null);
  assert.equal(sectorOf(''), null);
  assert.equal(sectorOf(null), null);
  assert.equal(sectorOf(12345), null);
});

test('a sector knows its district, and a code knows its label', () => {
  assert.equal(outcodeOf('SL4 1'), 'SL4');
  assert.equal(outcodeOf('EC1A 1'), 'EC1A');
  assert.equal(cellCode('sector', 'SL4 1'), 'sector:SL4 1');
  assert.equal(labelOf('sector:SL4 1'), 'SL4 1');
  assert.equal(labelOf(cellCode('sector', 'sl4 1')), 'SL4 1');
});

test('the matrix uses the same estimate every list is fenced with', () => {
  // If these two ever diverge, the matrix offers a place and the exact pass
  // throws it away, and the screen shows a count it cannot then fill.
  const a = { lat: 51.4839, lng: -0.6084 };
  const b = { lat: 51.4545, lng: -2.5879 };
  assert.equal(minutesBetween(a, b, 'driving'), estimateTravelMinutes(a, b, 'driving'));
  assert.equal(minutesBetween(a, b, 'walking'), estimateTravelMinutes(a, b, 'walking'));
});

test('the bound around a search is generous, never tight', () => {
  for (const minutes of [15, 30, 60, 90]) {
    const km = boundKm(minutes, 'driving');
    const at = { lat: 54, lng: -2 };
    const edge = { lat: at.lat + km / 111, lng: at.lng };
    // The bound must be past the point the estimate stops accepting, or the
    // neighbour search silently drops the cells at the edge of the ring.
    assert.ok(estimateTravelMinutes(at, edge, 'driving') > minutes,
      `${minutes} min: the bound of ${km}km is inside the estimate's own reach`);
  }
});

test('a cell reaches itself in nothing, and far cells not at all', () => {
  const cells = [
    { code: 'sector:SL4 1', lat: 51.4839, lng: -0.6084 },   // Windsor
    { code: 'sector:SL5 9', lat: 51.4045, lng: -0.6706 },   // Ascot, nearby
    { code: 'sector:BS1 4', lat: 51.4545, lng: -2.5879 },   // Bristol, far
    { code: 'sector:EH1 1', lat: 55.9533, lng: -3.1883 },   // Edinburgh, much further
  ];
  const rows = reachFrom(cells[0], cells, { mode: 'driving', capMinutes: 30 });
  const by = Object.fromEntries(rows.map((r) => [r.to_cell, r]));

  // Itself, in nothing: a search starting in SL4 1 must find SL4 1's places,
  // and leaving that implied means remembering it in four separate queries.
  assert.equal(by['sector:SL4 1'].minutes, 0);
  assert.ok(by['sector:SL5 9'], 'Ascot is within half an hour of Windsor');
  assert.equal(by['sector:BS1 4'], undefined, 'Bristol is not');
  assert.equal(by['sector:EH1 1'], undefined, 'Edinburgh certainly is not');

  // Every row carries the distance as well as the time, because the exact pass
  // orders on distance and should not have to work it out again.
  assert.ok(Math.abs(by['sector:SL5 9'].km - kmBetween(cells[0], cells[1])) < 0.02);
});

test('a wider cap reaches at least as far as a narrower one', () => {
  const cells = [
    { code: 'a', lat: 51.48, lng: -0.61 },
    { code: 'b', lat: 51.40, lng: -0.67 },
    { code: 'c', lat: 51.45, lng: -2.59 },
    { code: 'd', lat: 52.48, lng: -1.89 },
  ];
  let last = 0;
  for (const cap of [15, 30, 60, 90, CAP_MINUTES]) {
    const n = reachFrom(cells[0], cells, { capMinutes: cap }).length;
    assert.ok(n >= last, `${cap} minutes reached fewer cells than the cap below it`);
    last = n;
  }
});

test('a cell centre is the running mean of the postcodes seen in it', () => {
  let cell = { lat: 10, lng: 20, points: 1 };
  cell = { ...cell, ...recentre(cell, { lat: 20, lng: 40 }) };
  assert.equal(cell.points, 2);
  assert.equal(cell.lat, 15);
  assert.equal(cell.lng, 30);
  cell = { ...cell, ...recentre(cell, { lat: 30, lng: 60 }) };
  assert.equal(cell.points, 3);
  assert.equal(cell.lat, 20);
  assert.equal(cell.lng, 40);
});

test('a point snaps to the nearest cell, and to nothing when there are none', () => {
  const cells = [
    { code: 'sector:SL4 1', lat: 51.4839, lng: -0.6084 },
    { code: 'sector:BS1 4', lat: 51.4545, lng: -2.5879 },
  ];
  const near = nearestCell({ lat: 51.47, lng: -0.62 }, cells);
  assert.equal(near.code, 'sector:SL4 1');
  assert.ok(near.km < 3, 'the distance to the cell is reported, so a bad snap can be seen');
  assert.equal(nearestCell({ lat: 51.47, lng: -0.62 }, []), null);
});

test('the bands a count is rolled up into cover everything up to the cap', () => {
  assert.deepEqual(BANDS, [15, 30, 45, 60, 90]);
  assert.equal(bandFor(1), 15);
  assert.equal(bandFor(15), 15);
  assert.equal(bandFor(16), 30);
  assert.equal(bandFor(90), 90);
  // Past the cap there is no wider band, so the widest answers rather than
  // undefined — a catchment beyond ninety minutes is not a day out anyway.
  assert.equal(bandFor(1000), 90);
  assert.equal(BANDS[BANDS.length - 1], CAP_MINUTES);
});

// ---------------------------------------------------------------------------
// the score, with its working shown
// ---------------------------------------------------------------------------
//
// The one property that makes a workings screen worth having: the parts it
// prints must add up to the number it claims to explain. They did not at first
// — two accolades worth 0.98 printed as 1.0 and the sum came out a tenth high —
// which is exactly the sort of thing nobody notices until they are arguing with
// a ranking and cannot.

import { workings } from '../src/domain/scoring.js';

test('the working shown adds up to the score it explains', () => {
  const cases = [
    { crowd: 'top', count: 'thousands', accolades: ['michelin-bib', 'aa-rosette'], menuItems: 52, cuisines: ['italian'], website: 'x', summary: 'y', openingHours: 'z' },
    { crowd: 'good', count: 'few', accolades: [], menuItems: 3, cuisines: [], website: 'x' },
    { accolades: ['michelin-star'], chainScale: 'national' },
    { crowd: 'mixed', count: 'hundreds', accolades: ['camra', 'hardens', 'squaremeal', 'wikipedia'], menuItems: 18, cuisines: ['pub'], website: 'x', summary: 'y', openingHours: 'z' },
    {},
  ];
  for (const input of cases) {
    const w = workings(input);
    const round = (x) => Math.round(x * 10) / 10;
    const epic = round(w.parts.reduce((n, p) => n + (p.intoEpic ?? 0), 0) * w.chain.weight);
    const owned = round(w.parts.reduce((n, p) => n + (p.intoOwned ?? 0), 0) * w.chain.weight);
    assert.equal(epic, w.epicScore, `epic score does not match its own working for ${JSON.stringify(input)}`);
    assert.equal(owned, w.ownedScore, `owned score does not match its own working for ${JSON.stringify(input)}`);
  }
});

test('a place with no licensed input is scored and says so', () => {
  const w = workings({ accolades: ['world-heritage'], website: 'x', summary: 'y' });
  assert.equal(w.licensedInput, false);
  assert.equal(w.parts.find((p) => p.key === 'crowd').points, null);
  assert.equal(w.parts.find((p) => p.key === 'crowd').note, 'not held');
  // With nothing from the crowd the two numbers are the same one, which is the
  // whole claim `ownedScore` makes: the ranking does not depend on a provider.
  assert.equal(w.epicScore, w.ownedScore);
  assert.ok(w.epicScore > 0);
});

test('the workings never carry a provider figure, only our words', () => {
  const w = workings({ crowd: 'top', count: 'thousands', website: 'x' });
  const crowd = w.inputs.find((i) => i.key === 'crowd');
  assert.equal(crowd.kind, 'band');
  assert.equal(crowd.value, 'top');
  // Nothing anywhere in the answer may be a star rating. Four words and four
  // counts are the only things `crowdBand` and `countBand` ever return, and a
  // number between 1 and 5 with a decimal in it would mean the figure had
  // escaped the moment of the call.
  const text = JSON.stringify({ inputs: w.inputs, parts: w.parts.map((p) => ({ ...p, points: null })) });
  assert.ok(!/\b[1-5]\.\d\b/.test(text), 'something that looks like a star rating is in the workings');
});

test('the weights come out of the module, so a screen cannot retype them', () => {
  const { weights } = workings({});
  assert.equal(weights.crowd.top, 1);
  assert.equal(weights.crowdSplit.band, 0.8);
  assert.equal(weights.accoladeStack, 0.7);
  assert.equal(weights.prior, 4.15);
  assert.equal(weights.priorWeight, 150);
  assert.ok(weights.accolade['michelin-star'] > weights.accolade['squaremeal']);
});

// ---------------------------------------------------------------------------
// what the review found
// ---------------------------------------------------------------------------

import { EDGE_MINUTES, HORIZON_MINUTES } from '../src/domain/reach.js';
import { travelMode } from '../src/domain/travel.js';

test('a mode the screens use is the same mode the table holds', () => {
  // The screens say `drive` and `walk`; `reachFrom` writes `driving` and
  // `walking`. A read that did not normalise matched nothing at all and came
  // back empty, which reads exactly like a country with no places in it.
  const cells = [{ code: 'a', lat: 51.48, lng: -0.61 }, { code: 'b', lat: 51.44, lng: -0.65 }];
  for (const [said, held] of [['drive', 'driving'], ['walk', 'walking'], ['car', 'driving'], ['transit', 'transit']]) {
    assert.equal(travelMode(said), held);
    const rows = reachFrom(cells[0], cells, { mode: said, capMinutes: 90 });
    assert.ok(rows.every((r) => r.mode === held), `${said} wrote rows as something other than ${held}`);
  }
});

test('the ring is widened at the edge, because the exact pass can only narrow it', () => {
  // A place near the edge of its sector can be inside the limit while its
  // sector's centre is outside it. Throwing the centre away loses the place for
  // good; keeping it costs one measurement.
  assert.ok(EDGE_MINUTES > 0);
  assert.ok(EDGE_MINUTES <= 10, 'a wide allowance stops being a filter');
});

test('the matrix is built wider than anybody may ask, or the allowance does nothing', () => {
  // Building to the same ninety minutes the cap allows would cancel the edge
  // allowance at exactly the distance it matters most: a place genuinely within
  // ninety minutes whose sector centre estimates at ninety-two would not be in
  // the table at all, and no amount of widening the read could find it.
  assert.ok(HORIZON_MINUTES > CAP_MINUTES, 'the horizon is not past the cap');
  assert.equal(HORIZON_MINUTES, CAP_MINUTES + EDGE_MINUTES);
  // And the widest ask still gets its full allowance inside the horizon.
  assert.ok(CAP_MINUTES + EDGE_MINUTES <= HORIZON_MINUTES);
});

test('the refresh writes the way back, or a new sector is reachable from nowhere', () => {
  // A new cell needs its own neighbours *and* a row from each of them pointing
  // at it. Without the second, the places in a newly swept town are invisible
  // to every search but one that happens to start inside it.
  const existing = [
    { code: 'sector:SL4 1', lat: 51.4839, lng: -0.6084 },
    { code: 'sector:SL5 9', lat: 51.4045, lng: -0.6706 },
  ];
  const fresh = { code: 'sector:ZZ1 1', lat: 51.4900, lng: -0.6100 };
  const all = [...existing, fresh];

  const out = reachFrom(fresh, all, { mode: 'driving', capMinutes: 90 });
  const others = out.filter((r) => r.to_cell !== fresh.code);
  assert.ok(others.length, 'the new cell found no neighbours to write back to');

  // The estimate is a function of the distance between two points and nothing
  // else, which is what makes the reverse row the same row with its ends
  // swapped. If that ever stops being true, the refresh is writing wrong rows.
  for (const r of others) {
    const other = all.find((c) => c.code === r.to_cell);
    const back = reachFrom(other, all, { mode: 'driving', capMinutes: 90 })
      .find((x) => x.to_cell === fresh.code);
    assert.ok(back, `${other.code} cannot reach the new cell`);
    assert.equal(back.minutes, r.minutes, 'the estimate is not symmetric any more');
    assert.equal(back.km, r.km);
  }
});
