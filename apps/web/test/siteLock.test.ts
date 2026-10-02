/**
 * The website stays behind the gate until the owner opens it (owner, 2 Oct
 * 2026: "Keep the Basic-Auth site gate on. The site doesn't go public until
 * I've replaced the placeholder privacy wording."). The real server, in each
 * of its three states: gate off, gate on with its password, gate on without.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore -- a plain .mjs helper shared with server.mjs, no types
import { siteLock } from '../gate.mjs';

async function serve(env: Record<string, string>, fn: (base: string) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'epic-web-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><html lang="en"><head><title>Epic</title><meta name="description" content="x" /><link rel="canonical" href="https://epic.day/" /></head><body></body></html>');
  const port = 20000 + Math.floor(Math.random() * 20000);
  // This process's environment, less anything the gate reads, plus this case's.
  const childEnv = { ...process.env, PORT: String(port), EPIC_WEB_ROOT: root } as NodeJS.ProcessEnv;
  delete childEnv.GATE_USER; delete childEnv.GATE_PASSWORD; delete childEnv.SITE_GATE;
  Object.assign(childEnv, env);
  const server = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], { env: childEnv, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 50; i += 1) {
      try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    await fn(base);
  } finally { server.kill(); rmSync(root, { recursive: true, force: true }); }
}
const page = (base: string, path: string, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { redirect: 'manual', headers: { accept: 'text/html', ...headers } });
const basic = (u: string, p: string) => ({ authorization: `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}` });

test('gate on with no password configured: the site is not there, and / is the app as before', async () => {
  await serve({ SITE_GATE: 'on' }, async (base) => {
    assert.equal((await page(base, '/en-gb/')).status, 404);
    assert.equal((await page(base, '/en-gb/host')).status, 404);
    assert.equal((await page(base, '/sitemap.xml')).status, 404);
    assert.equal((await page(base, '/')).status, 200, 'no redirect to the site');
    assert.equal((await page(base, '/login')).status, 200);
  });
});

test('gate on with its password: asked for it, and let in with it', async () => {
  await serve({ SITE_GATE: 'on', GATE_USER: 'epic', GATE_PASSWORD: 'not-yet' }, async (base) => {
    const asked = await page(base, '/en-gb/');
    assert.equal(asked.status, 401);
    assert.match(asked.headers.get('www-authenticate') || '', /^Basic /);
    assert.equal((await page(base, '/en-gb/', basic('epic', 'wrong'))).status, 401);
    const inside = await page(base, '/en-gb/host', basic('epic', 'not-yet'));
    assert.equal(inside.status, 200);
    const html = await inside.text();
    assert.match(html, /<title>Epic Hosting/);
    assert.match(html, /<meta name="epic-page" content="site" \/>/, 'marked as a site page for the app (served.ts)');
    assert.equal((await page(base, '/')).status, 200, 'still no redirect while the gate is up');
    assert.equal((await page(base, '/', basic('epic', 'not-yet'))).status, 200, 'not even for someone holding the password');
    assert.doesNotMatch(await (await page(base, '/login')).text(), /epic-page/, 'the app shell carries no site mark');
  });
});

test('gate off: the site is public and / sends a visitor to it', async () => {
  await serve({ SITE_GATE: 'off' }, async (base) => {
    assert.equal((await page(base, '/en-gb/')).status, 200);
    const root = await page(base, '/');
    assert.equal(root.status, 302);
    assert.equal(root.headers.get('location'), '/en-gb/');
  });
});

test('siteLock reads the gate the way the API does: unset is on', () => {
  const before = { ...process.env };
  try {
    delete process.env.SITE_GATE; delete process.env.GATE_USER; delete process.env.GATE_PASSWORD;
    assert.deepEqual(siteLock({ headers: {} }), { status: 404 });
    process.env.SITE_GATE = 'off';
    assert.equal(siteLock({ headers: {} }), null);
  } finally { process.env = before; }
});
