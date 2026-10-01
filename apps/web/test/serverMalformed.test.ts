/**
 * One malformed address must not take the web server down (Codex, 1 Oct 2026).
 *
 * `/%E0%A4%A.js` is not valid percent-encoding; decoding it threw out of an
 * async request handler, and on this Node an unhandled rejection ends the
 * process — so one request stopped epic.day until Railway restarted it. This
 * starts the real server on a folder of its own and asks it twice.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('a malformed escape is answered, and the server is still there after', async () => {
  const root = mkdtempSync(join(tmpdir(), 'epic-web-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><html lang="en"><head><title>Epic</title></head><body></body></html>');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, PORT: String(port), EPIC_WEB_ROOT: root, SITE_GATE: 'off' },
    stdio: 'ignore',
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 50; i += 1) {
      try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    for (const bad of ['/%E0%A4%A.js', '/%E0%A4%A', '/x/%ZZ.png']) {
      const res = await fetch(`${base}${bad}`, { headers: { accept: 'text/html' } });
      assert.ok(res.status < 500, `${bad} answered ${res.status}`);
    }
    assert.equal((await fetch(`${base}/health`)).status, 200, 'and it is still serving');
  } finally {
    server.kill();
    rmSync(root, { recursive: true, force: true });
  }
});
