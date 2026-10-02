/**
 * A test server listens on 127.0.0.1 itself, never on every address.
 *
 * 2 Oct 2026: the pre-push hook failed fourteen tests in authPassword.test.js —
 * every request a 501 with no body — on a commit whose suite was green in the same
 * worktree an hour before. `app.listen(0)` binds every address (`::`) on a port the
 * OS picks from 49152–65535, and the tests then call `http://127.0.0.1:<port>`. On
 * macOS a process already bound to 127.0.0.1 on that same port coexists with the
 * `::` binding and wins the loopback connection — and the owner's machine has one:
 * the Logitech Options+ plugin (LogiPlugin) listens on 127.0.0.1:63184, 63186 and
 * 63191 and answers 501 to everything. Whenever the OS handed a test that port, the
 * test talked to Logitech. Machine-dependent, rare, and unrepeatable alone — the
 * same family as "machine load" (CLAUDE.md), and found only by capturing it.
 *
 * Listening on 127.0.0.1 explicitly makes the OS pick a port free on that address,
 * so the collision cannot happen. This file keeps every test server that way.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('no test server listens on every address', () => {
  const offenders = [];
  for (const dir of [HERE, path.join(HERE, 'helpers')]) {
    for (const f of fs.readdirSync(dir).filter((n) => /\.(m?js)$/.test(n))) {
      if (f === 'loopbackPort.test.js') continue;
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      // listen(0) or listen(<port>) with no host — or any listen whose host is not loopback.
      for (const m of src.matchAll(/\.listen\(([^)]*)\)/g)) {
        if (!/['"]127\.0\.0\.1['"]/.test(m[1])) offenders.push(`${f}: .listen(${m[1]})`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'listen on 127.0.0.1 — another process on the loopback port wins otherwise');
});
