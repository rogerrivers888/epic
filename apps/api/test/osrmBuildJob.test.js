// The OSRM build as a job the owner approves (jobs/osrmBuild.js): approving
// only marks it; the build service claims it once; a run that died is retired
// so it can be approved again; and a full run builds walking then cycling,
// deletes each graph before the next, recounts the rings and records done.
// OSRM itself is mocked — the state machine is what is under test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const job = await import('../src/jobs/osrmBuild.js');

test.after(() => pool.end());

const reset = () => query(`delete from bo_settings where key = any($1)`, [[job.OSRM_BUILD_KEY, job.OSRM_RINGS_KEY]]);

test('approve marks it, the service claims it once, and approving again while it runs is refused', async () => {
  await reset();
  assert.equal((await job.osrmBuildState()).state, 'none');
  const v = await job.approveOsrmBuild({ by: 'owner@test' });
  assert.equal(v.state, 'approved');
  await assert.rejects(() => job.approveOsrmBuild({ by: 'owner@test' }), (e) => e.status === 409 && /already approved/.test(e.message));
  const first = await job.claimOsrmBuild();
  assert.equal(first.state, 'running');
  assert.equal(await job.claimOsrmBuild(), null, 'a second wake cannot start it twice');
  await assert.rejects(() => job.approveOsrmBuild({ by: 'owner@test' }), (e) => e.status === 409 && /already running/.test(e.message));
  const { rows } = await query(`select count(*)::int n from bo_settings_log where key = $1`, [job.OSRM_BUILD_KEY]);
  assert.ok(rows[0].n >= 2, 'every change is in the settings log');
  await reset();
});

test('a run that has said running for too long is retired, and can be approved again', async () => {
  await reset();
  await job.approveOsrmBuild({ by: 'owner@test' });
  await job.claimOsrmBuild();
  assert.equal(await job.retireStaleRun(), false, 'a fresh run is left alone');
  assert.equal(await job.retireStaleRun({ now: Date.now() + (job.STALE_RUN_HOURS + 1) * 3600_000 }), true);
  assert.equal((await job.osrmBuildState()).state, 'failed');
  assert.equal((await job.approveOsrmBuild({ by: 'owner@test' })).state, 'approved');
  await reset();
});

const mocks = (calls, overrides = {}) => ({
  download: async () => { calls.push('download'); },
  run: async (cmd, args) => { calls.push(`${cmd} ${args[0] === '-p' ? args[1] : ''}`.trim()); },
  startRouted: async () => { calls.push('routed up'); return { url: 'http://x', stop: () => calls.push('routed down') }; },
  allCells: async () => [{ code: 'sector:ZZ1 1', lat: 51.4, lng: -0.6 }],
  buildOsrmMode: async ({ mode }) => { calls.push(`build ${mode}`); return { built: 1, skipped: 0, pairs: 1, runId: 'r' }; },
  osrmTable: () => async () => [],
  // Like the real query: the ring exists before the build and is still stale at
  // its end, and once recounted it is stamped after the build so it drops out.
  ringKeys: (() => { let n = 0; return async () => (++n <= 2 ? [{ cell: 'sector:ZZ1 1', mode: 'walking', minutes: 30 }] : []); })(),
  recountRing: async (k) => { calls.push('recount'); calls.push(`recount ${k.cell}|${k.minutes}`); },
  rmrf: async (p) => { calls.push(`rm ${p.split('/').pop()}`); },
  log: () => {},
  ...overrides,
});

test('nothing approved: the wake does nothing and touches nothing', async () => {
  await reset();
  const calls = [];
  const out = await job.runOsrmBuildJob({ graceMs: 0, dataDir: '/tmp/osrm-job-test', deps: mocks(calls) });
  assert.deepEqual(out, { ran: false, reason: 'nothing approved' });
  assert.deepEqual(calls, []);
});

test('an approved build runs walking then cycling, deletes each graph, recounts the rings, records done', async () => {
  await reset();
  await job.approveOsrmBuild({ by: 'owner@test' });
  const calls = [];
  const out = await job.runOsrmBuildJob({ graceMs: 0, dataDir: '/tmp/osrm-job-test', deps: mocks(calls) });
  assert.equal(out.ran, true);
  assert.deepEqual(Object.keys(out.result.modes), ['walking', 'cycling']);
  const order = calls.filter((c) => /^(osrm-extract|build|rm|recount$)/.test(c));
  assert.deepEqual(order, [
    'rm gb.osm.pbf',
    'rm foot', 'osrm-extract /opt/foot.lua', 'build walking', 'rm foot',
    'rm bike', 'osrm-extract /opt/bicycle.lua', 'build cycling', 'rm bike',
    'recount',
  ]);
  assert.equal(calls.filter((c) => c === 'routed down').length, 2, 'each router is stopped');
  const st = await job.osrmBuildState();
  assert.equal(st.state, 'done');
  assert.equal(st.result.ringsRecounted, 1, 'the affected ring, once, though seen before and after');
  await reset();
});

test('a build that fails is recorded failed with its reason, and can be approved again', async () => {
  await reset();
  await job.approveOsrmBuild({ by: 'owner@test' });
  const calls = [];
  await assert.rejects(() => job.runOsrmBuildJob({
    graceMs: 0, dataDir: '/tmp/osrm-job-test',
    deps: mocks(calls, { buildOsrmMode: async () => { throw new Error('osrm table 500'); } }),
  }), /osrm table 500/);
  assert.ok(calls.includes('routed down'), 'the router is stopped even when the build throws');
  const st = await job.osrmBuildState();
  assert.equal(st.state, 'failed');
  assert.match(st.why, /osrm table 500/);
  assert.equal((await job.approveOsrmBuild({ by: 'owner@test' })).state, 'approved');
  await reset();
});

test('a rebuild gets a new epoch and skips nothing old; a retry resumes over its own build only', async () => {
  await reset();
  const since = [];
  const capture = (calls) => mocks(calls, { buildOsrmMode: async ({ mode, resume, since: s }) => { since.push({ mode, resume, s }); return { built: 1, skipped: 0, pairs: 1, runId: 'r' }; } });
  await job.approveOsrmBuild({ by: 'owner@test' });
  await job.runOsrmBuildJob({ graceMs: 0, dataDir: '/tmp/osrm-job-test', deps: capture([]) });
  const first = (await job.osrmBuildState()).epoch;
  assert.ok(first);
  assert.ok(since.every((x) => x.resume === true && x.s === first), 'resume is scoped to this build');
  await new Promise((r) => setTimeout(r, 15));
  // A rebuild after it finished: a new epoch, so the old markers are not trusted.
  await job.approveOsrmBuild({ by: 'owner@test' });
  since.length = 0;
  await job.runOsrmBuildJob({ graceMs: 0, dataDir: '/tmp/osrm-job-test', deps: capture([]) });
  const second = (await job.osrmBuildState()).epoch;
  assert.ok(Date.parse(second) > Date.parse(first));
  assert.ok(since.every((x) => x.s === second));
  // That rebuild fails part-way; approved again, the retry keeps its epoch.
  await job.approveOsrmBuild({ by: 'owner@test' });
  await job.runOsrmBuildJob({ graceMs: 0, dataDir: '/tmp/osrm-job-test', deps: mocks([], { buildOsrmMode: async () => { throw new Error('boom'); } }) }).catch(() => {});
  const failedEpoch = (await job.osrmBuildState()).epoch;
  await job.approveOsrmBuild({ by: 'owner@test' });
  assert.equal((await job.osrmBuildState()).retry, true);
  since.length = 0;
  const calls = [];
  await job.runOsrmBuildJob({ graceMs: 0, dataDir: '/tmp/osrm-job-test', deps: capture(calls) });
  assert.ok(since.every((x) => x.s === failedEpoch), 'the retry resumes over the failed build only');
  assert.ok(!calls.includes('rm gb.osm.pbf'), 'a retry keeps the extract it fetched');
  await reset();
});

test('an interrupted download leaves neither the extract nor a partial file', async () => {
  const { mkdtemp, readdir } = await import('node:fs/promises');
  const os = await import('node:os');
  const dir = await mkdtemp(`${os.tmpdir()}/osrm-dl-`);
  const dest = `${dir}/gb.osm.pbf`;
  const broken = async () => ({
    ok: true,
    body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.error(new Error('connection reset')); } }),
  });
  await assert.rejects(() => job.download('http://x', dest, { fetchImpl: broken }), /connection reset/);
  assert.deepEqual(await readdir(dir), [], 'nothing left for a retry to mistake for an extract');
  const whole = async () => ({ ok: true, body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.close(); } }) });
  await job.download('http://x', dest, { fetchImpl: whole });
  assert.deepEqual(await readdir(dir), ['gb.osm.pbf']);
});

test('a ring dropped mid-build is still owed after a failure, and the retry recounts it', async () => {
  await reset();
  await job.approveOsrmBuild({ by: 'owner@test' });
  const dropped = { cell: 'sector:ZZ9 7', mode: 'walking', minutes: 60 };
  await assert.rejects(() => job.runOsrmBuildJob({
    graceMs: 0, dataDir: '/tmp/osrm-job-test',
    deps: mocks([], {
      ringKeys: async () => [],
      buildOsrmMode: async ({ onRingsDropped }) => { await onRingsDropped([dropped]); throw new Error('died mid-build'); },
    }),
  }), /died mid-build/);
  assert.deepEqual((await job.pendingRings()).map(({ run, ...k }) => k), [dropped], 'kept where the retry can find it');
  await job.approveOsrmBuild({ by: 'owner@test' });
  const calls = [];
  await job.runOsrmBuildJob({ graceMs: 0, dataDir: '/tmp/osrm-job-test', deps: mocks(calls, { ringKeys: async () => [] }) });
  assert.ok(calls.includes('recount sector:ZZ9 7|60'), 'the retry recounts the ring the failed run dropped');
  assert.deepEqual(await job.pendingRings(), [], 'and forgets it once recounted');
  await reset();
});

test('a run retired and replaced cannot write its ending over the newer build', async () => {
  await reset();
  await job.approveOsrmBuild({ by: 'owner@test' });
  await job.runOsrmBuildJob({
    graceMs: 0, dataDir: '/tmp/osrm-job-test',
    deps: mocks([], {
      buildOsrmMode: async ({ mode }) => {
        if (mode === 'cycling') {
          // While this run is still going it is retired for silence and approved again.
          await job.retireStaleRun({ now: Date.now() + (job.STALE_RUN_HOURS + 1) * 3600_000 });
          await job.approveOsrmBuild({ by: 'owner@test' });
        }
        return { built: 1, skipped: 0, pairs: 1, runId: 'r' };
      },
    }),
  });
  assert.equal((await job.osrmBuildState()).state, 'approved', 'the newer approval stands');
  await reset();
});

test('an idle wake settles a recount a finished build still owes', async () => {
  await reset();
  await job.rememberRings([{ cell: 'sector:ZZ9 8', mode: 'cycling', minutes: 30 }], 'run-1');
  const calls = [];
  const out = await job.runOsrmBuildJob({ graceMs: 0, dataDir: '/tmp/osrm-job-test', deps: mocks(calls) });
  assert.equal(out.reason, 'settled owed ring recounts');
  assert.ok(calls.includes('recount sector:ZZ9 8|30'));
  assert.deepEqual(await job.pendingRings(), []);
  await reset();
});

test('an older run cannot forget an obligation a newer run renewed', async () => {
  await reset();
  const k = { cell: 'sector:ZZ9 9', mode: 'walking', minutes: 60 };
  await job.rememberRings([k], 'old-run');
  const readByOld = await job.pendingRings();
  await job.rememberRings([k], 'new-run');          // the replacement drops it again
  await job.forgetRings(readByOld);                  // the old run finishes its recount
  assert.deepEqual((await job.pendingRings()).map((e) => e.run), ['new-run'], 'still owed, to the newer run');
  await reset();
});
