#!/usr/bin/env node
/**
 * Turn the census resume passphrase into the hash the server holds (G10).
 *
 *   node scripts/census-resume-hash.mjs
 *
 * Run it yourself, in your own terminal. It asks for the passphrase twice with
 * nothing echoed, and prints one line: the value for EPIC_CENSUS_RESUME_KEY_HASH
 * in Doppler. The passphrase is never written anywhere, never printed, and
 * never passes through a chat; the hash is safe to paste, because it cannot
 * resume anything.
 *
 * Choose something long: five or more ordinary words. A slow hash protects a
 * passphrase worth guessing slowly, and anybody who can read the server's
 * variables can try guesses against it. Fewer than 20 characters is refused.
 */

import { hashResumeKey, verifyResumeKey, MIN_PASSPHRASE } from '../apps/api/src/domain/resumeKey.js';

/** One line from the terminal with nothing shown as it is typed. */
function ask(prompt) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) { reject(new Error('Run this in a terminal: it reads the passphrase without echoing it.')); return; }
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let typed = '';
    const done = (value, err) => {
      stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData); stdout.write('\n');
      if (err) reject(err); else resolve(value);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done(typed);
        if (ch === '\u0003') return done(null, new Error('Stopped.'));
        if (ch === '\u007f' || ch === '\b') typed = typed.slice(0, -1);
        else if (ch >= ' ') typed += ch;
      }
    };
    stdin.on('data', onData);
  });
}

try {
  const first = await ask('Passphrase (not shown): ');
  if (first.length < MIN_PASSPHRASE) throw new Error(`Too short: use at least ${MIN_PASSPHRASE} characters — five or more words.`);
  const again = await ask('Again: ');
  if (again !== first) throw new Error('The two did not match. Nothing was made.');
  const hash = hashResumeKey(first);
  if (!(await verifyResumeKey(first, hash))) throw new Error('The hash did not check against the passphrase. Nothing was made.');
  process.stdout.write(`\nEPIC_CENSUS_RESUME_KEY_HASH=${hash}\n`);
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
