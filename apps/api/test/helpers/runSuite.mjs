/**
 * The full suite, one session at a time. `npm test` runs this.
 *
 * Individual files are run directly and take no lock: a session checking the
 * files it touched should never wait on anybody. The lock is only for the whole
 * suite, which is the thing that saturates the machine.
 */

import { spawn } from 'node:child_process';
import { holdSuiteLock } from './suiteLock.mjs';

const drop = await holdSuiteLock();
const child = spawn('node', ['--test', 'test/*.test.js'], { stdio: 'inherit', shell: true });
child.on('exit', (code) => { drop(); process.exit(code ?? 1); });
