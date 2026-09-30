// reach-check — the real counts for a fixed home, per time and per mode.
//
// The owner, 30 Sep 2026: after the "changing the time does nothing" fix, prove
// on production that the count rises with the minutes and shrinks on foot, and
// send the actual numbers. This reads the census count for the reach only — the
// free `?count=1` path on /api/inspire/around — so it spends nothing and needs
// no paid grant. A count is not a search.
//
//   node scripts/reach-check.mjs [baseUrl]
//
// Passcode from EPIC_PASSCODE or ROAM_PASSCODE (or arg 2). Default host epic.day.

const BASE = (process.argv[2] || process.env.EPIC_BASE || 'https://epic.day').replace(/\/$/, '');
const PASSCODE = process.argv[3] || process.env.EPIC_PASSCODE || process.env.ROAM_PASSCODE;
const WHERE = process.env.EPIC_WHERE || 'SL5 0JD'; // Sunningdale — a full postcode resolves to a sector; a bare outcode may not
const MINUTES = [30, 60, 120];
const MODES = ['drive', 'walk', 'transit'];

if (!PASSCODE) { console.error('No passcode: set EPIC_PASSCODE or ROAM_PASSCODE, or pass it as arg 3.'); process.exit(2); }

const signIn = async () => {
  const r = await fetch(`${BASE}/api/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passcode: PASSCODE, label: 'reach-check' }),
  });
  if (!r.ok) throw new Error(`sign-in ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const { token } = await r.json();
  if (!token) throw new Error('sign-in returned no token');
  return token;
};

const countFor = async (token, minutes, mode) => {
  const url = `${BASE}/api/inspire/around?where=${encodeURIComponent(WHERE)}&minutes=${minutes}&mode=${mode}&count=1`;
  const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`around ${minutes}/${mode} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  // Category memberships within the reach (a place can sit in more than one
  // drawer), not distinct places — the census counts once per drawer. It is a
  // faithful "does the reach grow with time and mode?" figure, which is the
  // question. The per-category `counts` beside it are the real per-drawer count.
  return j.categoryMemberships ?? 0;
};

const main = async () => {
  const token = await signIn();
  const grid = {};
  for (const mode of MODES) {
    grid[mode] = {};
    for (const m of MINUTES) grid[mode][m] = await countFor(token, m, mode);
  }
  const pad = (s, n) => String(s).padStart(n);
  console.log(`\nCensus reach of ${WHERE.toUpperCase()} — category memberships (free count-only), ${BASE}\n`);
  console.log(`  ${pad('mode', 9)} ${MINUTES.map((m) => pad(`${m}m`, 8)).join('')}`);
  for (const mode of MODES) {
    console.log(`  ${pad(mode, 9)} ${MINUTES.map((m) => pad(grid[mode][m], 8)).join('')}`);
  }
  // The two claims the owner asked to see hold:
  const rises = (mode) => MINUTES.every((m, i) => i === 0 || grid[mode][m] >= grid[mode][MINUTES[i - 1]]);
  const risesStrict = (mode) => grid[mode][30] < grid[mode][120];
  console.log('');
  for (const mode of MODES) console.log(`  ${mode}: rises 30→60→120 ? ${rises(mode) && risesStrict(mode) ? 'yes' : 'NO'}`);
  console.log(`  walk 30 (${grid.walk[30]}) far fewer than drive 30 (${grid.drive[30]}) ? ${grid.walk[30] * 2 < grid.drive[30] ? 'yes' : 'check'}`);
  console.log('');
};

main().catch((e) => { console.error(e.message || e); process.exit(1); });
