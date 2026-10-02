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

const reset = () => query(`delete from bo_settings where key = $1`, [job.OSRM_BUILD_KEY]);

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
  recountRings: async () => { calls.push('recount'); return [1, 2, 3]; },
  rmrf: async (p) => { calls.push(`rm ${p.split('/').pop()}`); },
  log: () => {},
  ...overrides,
});

test('nothing approved: the wake does nothing and touches nothing', async () => {
  await reset();
  const calls = [];
  const out = await job.runOsrmBuildJob({ dataDir: '/tmp/osrm-job-test', deps: mocks(calls) });
  assert.deepEqual(out, { ran: false, reason: 'nothing approved' });
  assert.deepEqual(calls, []);
});

test('an approved build runs walking then cycling, deletes each graph, recounts the rings, records done', async () => {
  await reset();
  await job.approveOsrmBuild({ by: 'owner@test' });
  const calls = [];
  const out = await job.runOsrmBuildJob({ dataDir: '/tmp/osrm-job-test', deps: mocks(calls) });
  assert.equal(out.ran, true);
  assert.deepEqual(Object.keys(out.result.modes), ['walking', 'cycling']);
  const order = calls.filter((c) => /^(osrm-extract|build|rm|recount)/.test(c));
  assert.deepEqual(order, [
    'rm gb.osm.pbf',
    'rm foot', 'osrm-extract /opt/foot.lua', 'build walking', 'rm foot',
    'rm bike', 'osrm-extract /opt/bicycle.lua', 'build cycling', 'rm bike',
    'recount',
  ]);
  assert.equal(calls.filter((c) => c === 'routed down').length, 2, 'each router is stopped');
  const st = await job.osrmBuildState();
  assert.equal(st.state, 'done');
  assert.equal(st.result.ringsRecounted, 3);
  await reset();
});

test('a build that fails is recorded failed with its reason, and can be approved again', async () => {
  await reset();
  await job.approveOsrmBuild({ by: 'owner@test' });
  const calls = [];
  await assert.rejects(() => job.runOsrmBuildJob({
    dataDir: '/tmp/osrm-job-test',
    deps: mocks(calls, { buildOsrmMode: async () => { throw new Error('osrm table 500'); } }),
  }), /osrm table 500/);
  assert.ok(calls.includes('routed down'), 'the router is stopped even when the build throws');
  const st = await job.osrmBuildState();
  assert.equal(st.state, 'failed');
  assert.match(st.why, /osrm table 500/);
  assert.equal((await job.approveOsrmBuild({ by: 'owner@test' })).state, 'approved');
  await reset();
});

test('a rebuild after a finished build starts fresh; a retry after a failure resumes', async () => {
  await reset();
  const seen = [];
  const deps = (calls) => mocks(calls, { buildOsrmMode: async ({ mode, resume }) => { seen.push(`${mode}:${resume}`); return { built: 1, skipped: 0, pairs: 1, runId: 'r' }; } });
  await job.approveOsrmBuild({ by: 'owner@test' });
  assert.equal((await job.osrmBuildState()).resume, false, 'the first build is fresh');
  await job.runOsrmBuildJob({ dataDir: '/tmp/osrm-job-test', deps: deps([]) });
  // Approved again after it finished: a rebuild, so no origin is skipped.
  await job.approveOsrmBuild({ by: 'owner@test' });
  assert.equal((await job.osrmBuildState()).resume, false);
  await job.runOsrmBuildJob({ dataDir: '/tmp/osrm-job-test', deps: deps([]) });
  assert.deepEqual(seen, ['walking:false', 'cycling:false', 'walking:false', 'cycling:false']);
  // A failure, then approval: a retry, which resumes and keeps its extract.
  await job.approveOsrmBuild({ by: 'owner@test' });
  await job.runOsrmBuildJob({ dataDir: '/tmp/osrm-job-test', deps: mocks([], { buildOsrmMode: async () => { throw new Error('boom'); } }) }).catch(() => {});
  await job.approveOsrmBuild({ by: 'owner@test' });
  assert.equal((await job.osrmBuildState()).resume, true);
  const calls = [];
  seen.length = 0;
  await job.runOsrmBuildJob({ dataDir: '/tmp/osrm-job-test', deps: { ...deps(calls) } });
  assert.deepEqual(seen, ['walking:true', 'cycling:true']);
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
