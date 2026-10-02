/**
 * The website while the launch gate is up (owner, 2 Oct 2026): not public until
 * he opens it, and never a browser password dialog for anybody — a signed-in
 * person must not see one. So the server sends the pages with no challenge,
 * marked noindex and carrying the gate's state for the app, keeps the sitemap
 * back, and leaves `/` as the app; the app draws the site only for somebody
 * signed in (SiteScreen). The real server, gate up and gate down.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function serve(env: Record<string, string>, fn: (base: string) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'epic-web-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><html lang="en"><head><title>Epic</title><meta name="description" content="x" /><link rel="canonical" href="https://epic.day/" /></head><body></body></html>');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const childEnv = { ...process.env, PORT: String(port), EPIC_WEB_ROOT: root } as NodeJS.ProcessEnv;
  delete childEnv.SITE_GATE;
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
const page = (base: string, path: string) => fetch(`${base}${path}`, { redirect: 'manual', headers: { accept: 'text/html' } });

test('published, with the launch gate still up: the site is public and indexable, the app is not', async () => {
  // seo.json › public is true (owner, 2 Oct 2026: "publish it as soon as you're ready").
  await serve({ SITE_GATE: 'on' }, async (base) => {
    const host = await page(base, '/en-gb/host');
    assert.equal(host.status, 200);
    assert.equal(host.headers.get('www-authenticate'), null, 'never a browser password dialog');
    assert.equal(host.headers.get('x-robots-tag'), null, 'an open page may be indexed');
    assert.match(await host.text(), /<meta name="epic-gate" content="off" \/>/);
    assert.equal((await page(base, '/en-gb/go/crew')).headers.get('x-robots-tag'), 'noindex', 'a campaign page never is');
    const sitemap = await page(base, '/sitemap.xml');
    assert.equal(sitemap.status, 200);
    assert.equal(sitemap.headers.get('x-robots-tag'), null);
    const root = await page(base, '/');
    assert.equal(root.status, 302);
    assert.equal(root.headers.get('location'), '/en-gb/');
    // The app itself stays behind the gate: still noindex.
    assert.equal((await page(base, '/inspire')).headers.get('x-robots-tag'), 'noindex');
    assert.equal((await page(base, '/login')).headers.get('x-robots-tag'), 'noindex');
  });
});

test('gate down: the site is public, says so, and / sends a visitor to it', async () => {
  await serve({ SITE_GATE: 'off' }, async (base) => {
    const home = await page(base, '/en-gb/');
    assert.equal(home.status, 200);
    assert.match(await home.text(), /<meta name="epic-gate" content="off" \/>/);
    const root = await page(base, '/');
    assert.equal(root.status, 302);
    assert.equal(root.headers.get('location'), '/en-gb/');
    assert.equal((await page(base, '/sitemap.xml')).status, 200);
  });
});
